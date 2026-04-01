import { fetchJmsPluginConfig, getGlobalTmdbApiKey } from "./jmsPluginConfig.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

export const JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT = "jms:studio-hub-manual-entry-added";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const TMDB_FILTERED_LOGO_BASE = "https://media.themoviedb.org/t/p/h100_filter(negate,000,666)";

const STUDIO_NAME_ALIASES = {
  "Marvel Studios": ["marvel studios", "marvel", "marvel entertainment", "marvel studios llc"],
  "Pixar": ["pixar", "pixar animation studios", "disney pixar"],
  "Walt Disney Pictures": ["walt disney", "walt disney pictures"],
  "Disney+": ["disney+", "disney plus", "disney+ originals", "disney plus originals", "disney+ studio"],
  "DC": ["dc entertainment", "dc"],
  "Warner Bros. Pictures": ["warner bros", "warner bros.", "warner bros pictures", "warner bros. pictures", "warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm", "lucasfilm ltd", "lucasfilm ltd."],
  "Columbia Pictures": ["columbia", "columbia pictures", "columbia pictures industries"],
  "Paramount Pictures": ["paramount", "paramount pictures", "paramount pictures corporation"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks", "dreamworks animation", "dreamworks pictures"]
};

const STUDIO_JUNK_WORDS = [
  "ltd", "ltd.", "llc", "inc", "inc.", "company", "co.", "corp", "corp.", "the",
  "pictures", "studios", "animation", "film", "films", "pictures.", "studios."
];

const STUDIO_CANONICAL_NAME_MAP = new Map(
  Object.keys(STUDIO_NAME_ALIASES).map((name) => [String(name || "").toLowerCase(), name])
);

const STUDIO_ALIAS_NAME_MAP = (() => {
  const out = new Map();
  for (const [canonical, aliases] of Object.entries(STUDIO_NAME_ALIASES)) {
    out.set(String(canonical || "").toLowerCase(), canonical);
    for (const alias of aliases || []) {
      out.set(String(alias || "").toLowerCase(), canonical);
    }
  }
  return out;
})();
const STUDIO_HUB_DEFAULT_NAME_KEYS = new Set(
  Object.keys(STUDIO_NAME_ALIASES).map((name) => String(name || "").trim().toLowerCase())
);

const tmdbCompanyResultsCache = new Map();
const tmdbStudioLogoFileCache = new Map();

function getTokenSafe() {
  try {
    return window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken || "";
  } catch {
    return "";
  }
}

async function getUserIdSafe() {
  try {
    const user = await window.ApiClient?.getCurrentUser?.();
    return user?.Id || "";
  } catch {
    return "";
  }
}

async function getAuthHeaders() {
  const headers = {
    Accept: "application/json"
  };

  const token = getTokenSafe();
  const userId = await getUserIdSafe();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

async function readError(res) {
  try {
    const data = await res.json();
    return localizeStudioHubError(data?.error || data?.message || `HTTP ${res.status}`);
  } catch {
    try {
      const text = await res.text();
      return localizeStudioHubError(text || `HTTP ${res.status}`);
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}

function getStudioHubLabel(key, fallback) {
  try {
    const value = getConfig?.()?.languageLabels?.[key];
    return (typeof value === "string" && value.trim()) ? value : fallback;
  } catch {
    return fallback;
  }
}

function localizeStudioHubError(message) {
  const raw = String(message || "").trim();
  if (!raw) return raw;

  const mapped = {
    "Bu işlem sadece admin kullanıcılar içindir.": getStudioHubLabel("studioHubAdminOnlyAction", "This action is only available to admin users."),
    "StudioId ve başlık gerekli.": getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."),
    "StudioId gerekli.": getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."),
    "Yüklenecek logo gerekli.": getStudioHubLabel("studioHubLogoFileRequired", "A logo file is required for upload."),
    "Yüklenecek video gerekli.": getStudioHubLabel("studioHubVideoFileRequired", "A video file is required for upload."),
    "Koleksiyon adı gerekli.": getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."),
    "Manuel koleksiyon bulunamadı.": getStudioHubLabel("studioHubManualCollectionNotFound", "Manual collection not found."),
    "X-Emby-UserId gerekli.": getStudioHubLabel("ctrlApiUserHeaderRequired", "X-Emby-UserId header is required."),
  };

  return mapped[raw] || raw;
}

export function normalizeStudioHubName(name) {
  return String(name || "").trim().toLowerCase();
}

function nameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupeNames(items) {
  const out = [];
  const seen = new Set();

  for (const item of items || []) {
    const clean = String(item || "").trim();
    if (!clean) continue;
    const key = nameKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function normalizeStudioNameBase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[().,\u2122©®\-:_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripStudioName(value) {
  let out = ` ${normalizeStudioNameBase(value)} `;
  for (const word of STUDIO_JUNK_WORDS) {
    out = out.replace(new RegExp(`\\s${word}\\s`, "g"), " ");
  }
  return out.trim();
}

function getStudioNameTokens(value) {
  return stripStudioName(value).split(" ").filter(Boolean);
}

function toCanonicalStudioName(name) {
  if (!name) return null;
  const key = String(name || "").toLowerCase();
  return STUDIO_ALIAS_NAME_MAP.get(key) || STUDIO_CANONICAL_NAME_MAP.get(key) || null;
}

export function getCanonicalStudioHubName(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return "";
  return toCanonicalStudioName(cleanName) || cleanName;
}

function buildStudioHubAllowedNameMap(manualEntries = []) {
  const out = new Map();
  const addName = (value) => {
    const cleanName = String(value || "").trim();
    if (!cleanName) return;
    const resolvedName = getCanonicalStudioHubName(cleanName);
    const key = nameKey(resolvedName);
    if (!key || out.has(key)) return;
    out.set(key, resolvedName);
  };

  Object.keys(STUDIO_NAME_ALIASES).forEach(addName);
  for (const entry of manualEntries || []) {
    addName(entry?.name || entry?.Name);
  }

  return out;
}

function sanitizeStudioHubNames(names, manualEntries = []) {
  const allowedNameMap = buildStudioHubAllowedNameMap(manualEntries);
  const out = [];
  const seen = new Set();

  for (const value of names || []) {
    const cleanName = String(value || "").trim();
    if (!cleanName) continue;
    const canonicalName = getCanonicalStudioHubName(cleanName);
    const resolvedName =
      allowedNameMap.get(nameKey(cleanName)) ||
      allowedNameMap.get(nameKey(canonicalName)) ||
      "";
    if (!resolvedName) continue;
    const key = nameKey(resolvedName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolvedName);
  }

  return out;
}

export function getStudioHubAllowedNames(manualEntries = []) {
  return [...buildStudioHubAllowedNameMap(manualEntries).values()];
}

export function sanitizeStudioHubOrderNames(names, manualEntries = []) {
  return sanitizeStudioHubNames(names, manualEntries);
}

export function sanitizeStudioHubHiddenNames(names, manualEntries = []) {
  return sanitizeStudioHubNames(names, manualEntries);
}

export function isDefaultStudioHubName(name) {
  const canonicalName = getCanonicalStudioHubName(name);
  return !!canonicalName && STUDIO_HUB_DEFAULT_NAME_KEYS.has(nameKey(canonicalName));
}

function buildTmdbStudioQueries(studioName) {
  const cleanName = String(studioName || "").trim();
  if (!cleanName) return [];

  const canonical = toCanonicalStudioName(cleanName);
  const aliases = canonical ? (STUDIO_NAME_ALIASES[canonical] || []) : [];
  return dedupeNames([cleanName, canonical, ...aliases]);
}

function scoreTmdbCompanyCandidate(candidate, studioName) {
  const targetName = String(studioName || "").trim();
  const candidateName = String(candidate?.name || candidate?.Name || "").trim();
  if (!targetName || !candidateName) return Number.NEGATIVE_INFINITY;

  const targetCanonical = toCanonicalStudioName(targetName) || targetName;
  const candidateCanonical = toCanonicalStudioName(candidateName) || candidateName;
  const targetNorm = normalizeStudioNameBase(targetName);
  const candidateNorm = normalizeStudioNameBase(candidateName);
  const targetStripped = stripStudioName(targetName);
  const candidateStripped = stripStudioName(candidateName);
  const targetTokens = new Set(getStudioNameTokens(targetName));
  const candidateTokens = new Set(getStudioNameTokens(candidateName));

  let score = 0;
  if (nameKey(targetCanonical) === nameKey(candidateCanonical)) score += 8;
  if (candidateStripped && targetStripped && candidateStripped === targetStripped) score += 7;
  if (candidateNorm && targetNorm && candidateNorm === targetNorm) score += 5;
  if (
    candidateStripped &&
    targetStripped &&
    candidateStripped !== targetStripped &&
    (candidateStripped.includes(targetStripped) || targetStripped.includes(candidateStripped))
  ) {
    score += 3;
  }

  let overlap = 0;
  targetTokens.forEach((token) => {
    if (candidateTokens.has(token)) overlap += 1;
  });
  score += overlap * 0.6;
  if (candidate?.logo_path) score += 1.25;
  score += Math.min(Math.max(Number(candidate?.popularity || 0), 0), 40) / 100;
  return score;
}

function guessTmdbLogoExtension(path, mimeType) {
  const extMatch = String(path || "").match(/\.([a-z0-9]+)(?:$|\?)/i);
  const ext = String(extMatch?.[1] || "").toLowerCase();
  if (["png", "svg", "webp", "jpg", "jpeg"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }

  const type = String(mimeType || "").toLowerCase();
  if (type.includes("svg")) return "svg";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg")) return "jpg";
  return "png";
}

export function normalizeStudioHubProfile(profile) {
  const value = String(profile || "").trim().toLowerCase();
  return (value === "mobile" || value === "m") ? "mobile" : "desktop";
}

export function normalizeStudioHubHiddenNames(names) {
  const out = [];
  const seen = new Set();

  for (const name of names || []) {
    const clean = String(name || "").trim();
    if (!clean) continue;
    const key = normalizeStudioHubName(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

const studioHubVisibilityCache = new Map();

export function getStudioHubVideoEntriesFromConfig(cfg) {
  const raw = cfg?.studioHubVideoEntries ?? cfg?.StudioHubVideoEntries ?? [];
  return Array.isArray(raw) ? raw : [];
}

export function getStudioHubManualEntriesFromConfig(cfg) {
  const raw = cfg?.studioHubManualEntries ?? cfg?.StudioHubManualEntries ?? [];
  return Array.isArray(raw) ? raw : [];
}

export async function fetchStudioHubVideoEntries({ force = false } = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/video${force ? `?ts=${Date.now()}` : ""}`), {
    method: "GET",
    cache: "no-store",
    headers
  });
  if (!res.ok) throw new Error(await readError(res));
  const payload = await res.json().catch(() => ({}));
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

export async function fetchStudioHubManualEntries({ force = false } = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/collection${force ? `?ts=${Date.now()}` : ""}`), {
    method: "GET",
    cache: "no-store",
    headers
  });
  if (!res.ok) throw new Error(await readError(res));
  const payload = await res.json().catch(() => ({}));
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

export function findStudioHubVideoEntry(entries, name) {
  const wanted = normalizeStudioHubName(name);
  if (!wanted) return null;
  return (entries || []).find(entry => normalizeStudioHubName(entry?.name || entry?.Name) === wanted) || null;
}

export function findStudioHubManualEntry(entries, studioIdOrName) {
  const rawWanted = String(studioIdOrName || "").trim();
  const wanted = rawWanted.toLowerCase();
  if (!wanted) return null;

  const wantedName = normalizeStudioHubName(rawWanted);
  const wantedCanonicalName = normalizeStudioHubName(getCanonicalStudioHubName(rawWanted));

  return (entries || []).find(entry => {
    const studioId = String(entry?.studioId || entry?.StudioId || "").trim().toLowerCase();
    const rawName = String(entry?.name || entry?.Name || "").trim();
    const name = normalizeStudioHubName(rawName);
    const canonicalName = normalizeStudioHubName(getCanonicalStudioHubName(rawName));
    return studioId === wanted || name === wantedName || canonicalName === wantedCanonicalName;
  }) || null;
}

function resolveStudioHubExistingEntry(entries, { studioId, name } = {}) {
  const cleanStudioId = String(studioId || "").trim();
  const cleanName = String(name || "").trim();
  const canonicalName = getCanonicalStudioHubName(cleanName);
  const manualEntry =
    findStudioHubManualEntry(entries, cleanStudioId) ||
    findStudioHubManualEntry(entries, cleanName) ||
    (canonicalName && canonicalName !== cleanName
      ? findStudioHubManualEntry(entries, canonicalName)
      : null) ||
    null;

  if (manualEntry) {
    return {
      entry: manualEntry,
      canonicalName,
      builtIn: false
    };
  }

  if (isDefaultStudioHubName(canonicalName)) {
    return {
      entry: {
        studioId: cleanStudioId,
        name: canonicalName,
        isDefault: true,
        isBuiltIn: true
      },
      canonicalName,
      builtIn: true
    };
  }

  return {
    entry: null,
    canonicalName,
    builtIn: false
  };
}

export function buildStudioHubVideoUrl(entry) {
  const fileName = String(entry?.fileName || entry?.FileName || "").trim();
  if (!fileName) return null;
  const updatedAt = Number(entry?.updatedAtUtc || entry?.UpdatedAtUtc || Date.now());
  return withServer(`/Plugins/JMSFusion/studio-hubs/video/${encodeURIComponent(fileName)}?v=${encodeURIComponent(updatedAt)}`);
}

export function buildStudioHubLogoUrl(entry) {
  const fileName = String(entry?.logoFileName || entry?.LogoFileName || "").trim();
  if (!fileName) return null;
  const updatedAt = Number(entry?.updatedAtUtc || entry?.UpdatedAtUtc || Date.now());
  return withServer(`/Plugins/JMSFusion/studio-hubs/logo/${encodeURIComponent(fileName)}?v=${encodeURIComponent(updatedAt)}`);
}

export function buildStudioHubHref(studioId, serverId = "") {
  const cleanStudioId = String(studioId || "").trim();
  const cleanServerId = String(serverId || "").trim();
  return `#/list?studioId=${encodeURIComponent(cleanStudioId)}${cleanServerId ? `&serverId=${encodeURIComponent(cleanServerId)}` : ""}`;
}

export function clearStudioHubVisibilityCache(profile) {
  if (profile == null) {
    studioHubVisibilityCache.clear();
    return;
  }

  studioHubVisibilityCache.delete(normalizeStudioHubProfile(profile));
}

export async function fetchStudioHubVisibility({ force = false, profile } = {}) {
  const normalizedProfile = normalizeStudioHubProfile(profile);
  if (!force && studioHubVisibilityCache.has(normalizedProfile)) {
    const cached = studioHubVisibilityCache.get(normalizedProfile);
    return {
      ...cached,
      hiddenNames: [...(cached?.hiddenNames || [])]
    };
  }

  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/visibility?profile=${encodeURIComponent(normalizedProfile)}&ts=${Date.now()}`), {
    method: "GET",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const result = {
    profile: normalizeStudioHubProfile(payload?.profile || normalizedProfile),
    hiddenNames: normalizeStudioHubHiddenNames(payload?.hiddenNames),
    orderNames: normalizeStudioHubHiddenNames(payload?.orderNames),
    updatedAtUtc: Number(payload?.updatedAtUtc || 0)
  };

  studioHubVisibilityCache.set(result.profile, result);
  return {
    ...result,
    hiddenNames: [...result.hiddenNames]
  };
}

export async function saveStudioHubVisibility(hiddenNames, { profile, orderNames } = {}) {
  const normalizedProfile = normalizeStudioHubProfile(profile);
  const normalizedHiddenNames = normalizeStudioHubHiddenNames(hiddenNames);
  const normalizedOrderNames = normalizeStudioHubHiddenNames(orderNames);
  const headers = await getAuthHeaders();
  headers["Content-Type"] = "application/json";

  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/visibility?profile=${encodeURIComponent(normalizedProfile)}`), {
    method: "POST",
    headers,
    body: JSON.stringify({
      profile: normalizedProfile,
      hiddenNames: normalizedHiddenNames,
      orderNames: normalizedOrderNames
    }),
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const result = {
    profile: normalizeStudioHubProfile(payload?.profile || normalizedProfile),
    hiddenNames: normalizeStudioHubHiddenNames(payload?.hiddenNames ?? normalizedHiddenNames),
    orderNames: normalizeStudioHubHiddenNames(payload?.orderNames ?? normalizedOrderNames),
    updatedAtUtc: Number(payload?.updatedAtUtc || Date.now())
  };

  studioHubVisibilityCache.set(result.profile, result);

  try {
    window.dispatchEvent(new CustomEvent("jms:studio-hubs-visibility-updated", {
      detail: {
        profile: result.profile,
        hiddenNames: [...result.hiddenNames],
        orderNames: [...result.orderNames]
      }
    }));
  } catch {}

  return {
    ...result,
    hiddenNames: [...result.hiddenNames]
  };
}

export async function createStudioHubManualEntry({ studioId, name }) {
  const cleanStudioId = String(studioId || "").trim();
  const cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  const headers = await getAuthHeaders();
  headers["Content-Type"] = "application/json";

  const res = await fetch(withServer("/Plugins/JMSFusion/studio-hubs/collection"), {
    method: "POST",
    headers,
    body: JSON.stringify({ studioId: cleanStudioId, name: cleanName }),
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const entries = await fetchStudioHubManualEntries({ force: true }).catch(() => (
    Array.isArray(payload?.entries) ? payload.entries : []
  ));

  return {
    entry: payload?.entry || null,
    entries
  };
}

export async function ensureStudioHubManualEntry({ studioId, name, manualEntries = null } = {}) {
  const cleanStudioId = String(studioId || "").trim();
  const cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  const existingEntries = Array.isArray(manualEntries)
    ? manualEntries
    : await fetchStudioHubManualEntries().catch(() => []);
  const resolvedExisting = resolveStudioHubExistingEntry(existingEntries, {
    studioId: cleanStudioId,
    name: cleanName
  });
  const existingEntry = resolvedExisting.entry;

  if (existingEntry) {
    return {
      entry: existingEntry,
      entries: existingEntries,
      created: false,
      existing: true,
      builtIn: resolvedExisting.builtIn === true
    };
  }

  const targetName = resolvedExisting.canonicalName || cleanName;
  const created = await createStudioHubManualEntry({ studioId: cleanStudioId, name: targetName });
  const nextEntries = Array.isArray(created?.entries) ? created.entries : existingEntries;
  const nextResolved = resolveStudioHubExistingEntry(nextEntries, {
    studioId: cleanStudioId,
    name: targetName
  });
  const nextEntry =
    created?.entry ||
    nextResolved.entry ||
    { studioId: cleanStudioId, name: targetName };

  return {
    entry: nextEntry,
    entries: nextEntries,
    created: true,
    existing: false,
    builtIn: false
  };
}

export async function deleteStudioHubManualEntry(studioId) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));

  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/collection?studioId=${encodeURIComponent(cleanStudioId)}`), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const manualEntries = await fetchStudioHubManualEntries({ force: true }).catch(() => (
    Array.isArray(payload?.manualEntries) ? payload.manualEntries : []
  ));
  const videoEntries = await fetchStudioHubVideoEntries({ force: true }).catch(() => (
    Array.isArray(payload?.videoEntries) ? payload.videoEntries : []
  ));

  clearStudioHubVisibilityCache();
  try {
    window.dispatchEvent(new CustomEvent("jms:studio-hubs-visibility-updated"));
  } catch {}

  return { manualEntries, videoEntries };
}

export async function uploadStudioHubLogo(studioId, file) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));
  if (!(file instanceof File)) throw new Error(getStudioHubLabel("studioHubLogoFileRequired", "A logo file is required for upload."));

  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append("studioId", cleanStudioId);
  formData.append("file", file, file.name || `${cleanStudioId}.png`);

  const res = await fetch(withServer("/Plugins/JMSFusion/studio-hubs/logo"), {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const entries = await fetchStudioHubManualEntries({ force: true }).catch(() => (
    Array.isArray(payload?.entries) ? payload.entries : []
  ));

  return {
    entry: payload?.entry || null,
    entries
  };
}

export async function fetchTmdbCompanyResults(studioName) {
  const cleanStudioName = String(studioName || "").trim();
  if (!cleanStudioName) return [];

  const apiKey = await getGlobalTmdbApiKey().catch(() => "");
  if (!apiKey) return [];

  const cacheKey = `${apiKey}::${nameKey(cleanStudioName)}`;
  if (tmdbCompanyResultsCache.has(cacheKey)) {
    return tmdbCompanyResultsCache.get(cacheKey);
  }

  const promise = (async () => {
    const queries = buildTmdbStudioQueries(cleanStudioName);
    const allResults = [];
    const seenIds = new Set();

    for (const query of queries) {
      const url = new URL(`${TMDB_API_BASE}/search/company`);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("query", query);
      url.searchParams.set("page", "1");

      const res = await fetch(url.toString(), { method: "GET", cache: "no-store" }).catch(() => null);
      if (!res?.ok) continue;

      const data = await res.json().catch(() => ({}));
      const results = Array.isArray(data?.results) ? data.results : [];
      results.forEach((result) => {
        const id = String(result?.id || "").trim();
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);
        allResults.push(result);
      });
    }

    return allResults;
  })();

  tmdbCompanyResultsCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    tmdbCompanyResultsCache.delete(cacheKey);
    throw error;
  }
}

export async function resolveTmdbLogoFileForStudio(studioName) {
  const cleanStudioName = String(studioName || "").trim();
  if (!cleanStudioName) return null;

  const apiKey = await getGlobalTmdbApiKey().catch(() => "");
  if (!apiKey) return null;

  const cacheKey = `${apiKey}::${nameKey(cleanStudioName)}`;
  if (tmdbStudioLogoFileCache.has(cacheKey)) {
    return tmdbStudioLogoFileCache.get(cacheKey);
  }

  const promise = (async () => {
    const results = await fetchTmdbCompanyResults(cleanStudioName);
    if (!results.length) return null;

    const best = results
      .map((result) => ({ result, score: scoreTmdbCompanyCandidate(result, cleanStudioName) }))
      .sort((left, right) => right.score - left.score)[0];

    const candidate = best?.result || null;
    const minAcceptableScore = 4;
    const logoPath = String(candidate?.logo_path || "").trim();
    if (!candidate || best?.score < minAcceptableScore || !logoPath) return null;

    const logoUrls = logoPath.startsWith("http")
      ? [logoPath]
      : [`${TMDB_FILTERED_LOGO_BASE}${logoPath}`, `${TMDB_IMAGE_BASE}${logoPath}`];

    let blob = null;
    for (const logoUrl of logoUrls) {
      const res = await fetch(logoUrl, { method: "GET", cache: "no-store" }).catch(() => null);
      if (!res?.ok) continue;
      const nextBlob = await res.blob().catch(() => null);
      if (nextBlob?.size) {
        blob = nextBlob;
        break;
      }
    }

    if (!blob?.size) return null;

    const ext = guessTmdbLogoExtension(logoPath, blob.type);
    const fileName = `tmdb-studio-${String(candidate?.id || "logo").trim() || "logo"}.${ext}`;

    try {
      return new File([blob], fileName, { type: blob.type || undefined });
    } catch {
      return null;
    }
  })();

  tmdbStudioLogoFileCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    tmdbStudioLogoFileCache.delete(cacheKey);
    throw error;
  }
}

export async function ensureStudioHubLogoFromTmdb({ studioId, name, manualEntries = null } = {}) {
  const cleanStudioId = String(studioId || "").trim();
  const cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  const entries = Array.isArray(manualEntries)
    ? manualEntries
    : await fetchStudioHubManualEntries().catch(() => []);
  const resolvedExisting = resolveStudioHubExistingEntry(entries, {
    studioId: cleanStudioId,
    name: cleanName
  });
  const currentEntry = resolvedExisting.entry;

  if (resolvedExisting.builtIn) {
    return {
      attempted: false,
      uploaded: false,
      skipped: true,
      reason: "default-studio",
      entry: currentEntry,
      entries
    };
  }

  if (buildStudioHubLogoUrl(currentEntry)) {
    return {
      attempted: false,
      uploaded: false,
      skipped: true,
      reason: "already-has-logo",
      entry: currentEntry,
      entries
    };
  }

  const tmdbLogoFile = await resolveTmdbLogoFileForStudio(resolvedExisting.canonicalName || cleanName).catch(() => null);
  if (!tmdbLogoFile) {
    return {
      attempted: true,
      uploaded: false,
      skipped: true,
      reason: "tmdb-logo-not-found",
      entry: currentEntry,
      entries
    };
  }

  const uploadResult = await uploadStudioHubLogo(cleanStudioId, tmdbLogoFile);
  const nextEntries = Array.isArray(uploadResult?.entries) ? uploadResult.entries : entries;
  const nextResolved = resolveStudioHubExistingEntry(nextEntries, {
    studioId: cleanStudioId,
    name: resolvedExisting.canonicalName || cleanName
  });
  const nextEntry =
    uploadResult?.entry ||
    nextResolved.entry ||
    currentEntry;

  return {
    attempted: true,
    uploaded: true,
    skipped: false,
    reason: "uploaded",
    entry: nextEntry,
    entries: nextEntries
  };
}

export async function deleteStudioHubLogo(studioId) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));

  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/logo?studioId=${encodeURIComponent(cleanStudioId)}`), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const entries = await fetchStudioHubManualEntries({ force: true }).catch(() => (
    Array.isArray(payload?.entries) ? payload.entries : []
  ));

  return {
    entry: payload?.entry || null,
    entries
  };
}

export async function uploadStudioHubVideo(name, file) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error(getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."));
  if (!(file instanceof File)) throw new Error(getStudioHubLabel("studioHubVideoFileRequired", "A video file is required for upload."));

  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append("name", cleanName);
  formData.append("file", file, file.name || `${cleanName}.mp4`);

  const res = await fetch(withServer("/Plugins/JMSFusion/studio-hubs/video"), {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const entries = await fetchStudioHubVideoEntries({ force: true }).catch(() => (
    Array.isArray(payload?.entries) ? payload.entries : []
  ));

  return {
    entry: payload?.entry || null,
    entries
  };
}

export async function deleteStudioHubVideo(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error(getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."));

  const headers = await getAuthHeaders();
  const res = await fetch(withServer(`/Plugins/JMSFusion/studio-hubs/video?name=${encodeURIComponent(cleanName)}`), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const payload = await res.json().catch(() => ({}));
  const entries = await fetchStudioHubVideoEntries({ force: true }).catch(() => (
    Array.isArray(payload?.entries) ? payload.entries : []
  ));

  return { entries };
}
