import { fetchJmsPluginConfig } from "./jmsPluginConfig.js";
import { withServer } from "./jfUrl.js";

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
    return data?.error || data?.message || `HTTP ${res.status}`;
  } catch {
    try {
      const text = await res.text();
      return text || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}

export function normalizeStudioHubName(name) {
  return String(name || "").trim().toLowerCase();
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
  const cfg = await fetchJmsPluginConfig({ force });
  return getStudioHubVideoEntriesFromConfig(cfg);
}

export async function fetchStudioHubManualEntries({ force = false } = {}) {
  const cfg = await fetchJmsPluginConfig({ force });
  return getStudioHubManualEntriesFromConfig(cfg);
}

export function findStudioHubVideoEntry(entries, name) {
  const wanted = normalizeStudioHubName(name);
  if (!wanted) return null;
  return (entries || []).find(entry => normalizeStudioHubName(entry?.name || entry?.Name) === wanted) || null;
}

export function findStudioHubManualEntry(entries, studioIdOrName) {
  const wanted = String(studioIdOrName || "").trim().toLowerCase();
  if (!wanted) return null;

  return (entries || []).find(entry => {
    const studioId = String(entry?.studioId || entry?.StudioId || "").trim().toLowerCase();
    const name = normalizeStudioHubName(entry?.name || entry?.Name);
    return studioId === wanted || name === wanted;
  }) || null;
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
  if (!cleanStudioId || !cleanName) throw new Error("StudioId ve başlık gerekli.");

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

export async function deleteStudioHubManualEntry(studioId) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error("StudioId gerekli.");

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

  return { manualEntries, videoEntries };
}

export async function uploadStudioHubLogo(studioId, file) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error("StudioId gerekli.");
  if (!(file instanceof File)) throw new Error("Geçerli bir logo seçin.");

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

export async function deleteStudioHubLogo(studioId) {
  const cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error("StudioId gerekli.");

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
  if (!cleanName) throw new Error("Koleksiyon adı gerekli.");
  if (!(file instanceof File)) throw new Error("Geçerli bir video seçin.");

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
  if (!cleanName) throw new Error("Koleksiyon adı gerekli.");

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
