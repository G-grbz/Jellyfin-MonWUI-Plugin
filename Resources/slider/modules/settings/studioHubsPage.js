import { getAdminTargetProfile, getDeviceProfileAuto } from "../config.js";
import { getGlobalTmdbApiKey } from "../jmsPluginConfig.js";
import { createCheckbox, createSection, createNumberInput } from "../settings.js";
import { applySettings } from "./applySettings.js";
import { fetchItemDetails, makeApiRequest } from "/Plugins/JMSFusion/runtime/api.js";
import {
  JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT,
  buildStudioHubLogoUrl,
  createStudioHubManualEntry,
  deleteStudioHubLogo,
  deleteStudioHubManualEntry,
  deleteStudioHubVideo,
  fetchStudioHubManualEntries,
  fetchStudioHubVisibility,
  fetchStudioHubVideoEntries,
  findStudioHubManualEntry,
  findStudioHubVideoEntry,
  getStudioHubAllowedNames,
  sanitizeStudioHubHiddenNames,
  sanitizeStudioHubOrderNames,
  uploadStudioHubLogo,
  uploadStudioHubVideo
} from "../studioHubsShared.js";

const DEFAULT_ORDER = [
  "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
  "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures",
  "Paramount Pictures","Netflix","DreamWorks Animation"
];

const ALIASES = {
  "Marvel Studios": ["marvel studios","marvel","marvel entertainment","marvel studios llc"],
  "Pixar": ["pixar","pixar animation studios","disney pixar"],
  "Walt Disney Pictures": ["walt disney","walt disney pictures"],
  "Disney+": ["disney+","disney plus","disney+ originals","disney plus originals","disney+ studio"],
  "DC": ["dc entertainment","dc"],
  "Warner Bros. Pictures": ["warner bros","warner bros.","warner bros pictures","warner bros. pictures","warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm","lucasfilm ltd","lucasfilm ltd."],
  "Columbia Pictures": ["columbia","columbia pictures","columbia pictures industries"],
  "Paramount Pictures": ["paramount","paramount pictures","paramount pictures corporation"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks","dreamworks animation","dreamworks pictures"]
};

const JUNK_WORDS = [
  "ltd","ltd.","llc","inc","inc.","company","co.","corp","corp.","the",
  "pictures","studios","animation","film","films","pictures.","studios."
];
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const TMDB_FILTERED_LOGO_BASE = "https://media.themoviedb.org/t/p/h100_filter(negate,000,666)";

const nbase = s =>
  (s || "")
    .toLowerCase()
    .replace(/[().,™©®\-:_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const strip = s => {
  let out = " " + nbase(s) + " ";
  for (const w of JUNK_WORDS) out = out.replace(new RegExp(`\\s${w}\\s`, "g"), " ");
  return out.trim();
};

const toks = s => strip(s).split(" ").filter(Boolean);

const CANONICALS = new Map(DEFAULT_ORDER.map(n => [n.toLowerCase(), n]));

const ALIAS_TO_CANON = (() => {
  const m = new Map();
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    m.set(canon.toLowerCase(), canon);
    for (const a of aliases) m.set(String(a).toLowerCase(), canon);
  }
  return m;
})();

function toCanonicalStudioName(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  return ALIAS_TO_CANON.get(key) || CANONICALS.get(key) || null;
}

function mergeOrder(defaults, custom) {
  const out = [];
  const seen = new Set();
  for (const n of (custom || [])) {
    const canon = toCanonicalStudioName(n) || n;
    const k = String(canon).toLowerCase();
    if (!seen.has(k)) { out.push(canon); seen.add(k); }
  }
  for (const n of defaults) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { out.push(n); seen.add(k); }
  }
  return out;
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

const DEFAULT_NAME_KEYS = new Set(DEFAULT_ORDER.map(nameKey));

function isDefaultStudioHub(name) {
  return DEFAULT_NAME_KEYS.has(nameKey(name));
}

function createHiddenInput(id, value) {
  const inp = document.createElement("input");
  inp.type = "hidden";
  inp.id = id;
  inp.name = id;
  inp.value = value;
  return inp;
}

function ensureStudioHubsSpinnerStyles() {
  if (document.getElementById("jms-studio-hubs-spinner-style")) return;
  const style = document.createElement("style");
  style.id = "jms-studio-hubs-spinner-style";
  style.textContent = `
    @keyframes jmsStudioHubsSpin {
      to { transform: rotate(360deg); }
    }
    .dnd-name {
     text-decoration-color: var(--accent, #ff6b6b);
   }
  `;
  document.head.appendChild(style);
}

function setButtonBusy(button, textEl, spinnerEl, busy, options = {}) {
  if (!button) return;
  const idleText = options.idleText;
  const busyText = options.busyText;
  button.disabled = !!busy;
  if (textEl) {
    const nextText = busy ? busyText : idleText;
    if (nextText != null) textEl.textContent = nextText;
  }
  if (spinnerEl) spinnerEl.style.display = busy ? "inline-block" : "none";
}

function buildTmdbStudioQueries(studioName) {
  const cleanName = String(studioName || "").trim();
  if (!cleanName) return [];

  const canonical = toCanonicalStudioName(cleanName);
  const aliases = canonical ? (ALIASES[canonical] || []) : [];
  return dedupeNames([cleanName, canonical, ...aliases]);
}

function scoreTmdbCompanyCandidate(candidate, studioName) {
  const targetName = String(studioName || "").trim();
  const candidateName = String(candidate?.name || candidate?.Name || "").trim();
  if (!targetName || !candidateName) return Number.NEGATIVE_INFINITY;

  const targetCanonical = toCanonicalStudioName(targetName) || targetName;
  const candidateCanonical = toCanonicalStudioName(candidateName) || candidateName;
  const targetNorm = nbase(targetName);
  const candidateNorm = nbase(candidateName);
  const targetStripped = strip(targetName);
  const candidateStripped = strip(candidateName);
  const targetTokens = new Set(toks(targetName));
  const candidateTokens = new Set(toks(candidateName));

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
  targetTokens.forEach(token => {
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

async function fetchTmdbCompanyResults(studioName) {
  const apiKey = await getGlobalTmdbApiKey().catch(() => "");
  if (!apiKey) return [];

  const queries = buildTmdbStudioQueries(studioName);
  const allResults = [];
  const seenIds = new Set();

  for (const query of queries) {
    const url = new URL(`${TMDB_API_BASE}/search/company`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");

    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) continue;

    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results : [];
    results.forEach(result => {
      const id = String(result?.id || "").trim();
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      allResults.push(result);
    });
  }

  return allResults;
}

async function resolveTmdbLogoFileForStudio(studioName) {
  const results = await fetchTmdbCompanyResults(studioName);
  if (!results.length) return null;

  const best = results
    .map(result => ({ result, score: scoreTmdbCompanyCandidate(result, studioName) }))
    .sort((a, b) => b.score - a.score)[0];

  const candidate = best?.result || null;
  const minAcceptableScore = 4;
  const logoPath = String(candidate?.logo_path || "").trim();
  if (!candidate || best.score < minAcceptableScore || !logoPath) return null;

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
}

function refreshStudioHubHiddenInputs(list, orderInput, hiddenInput) {
  const names = [...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name).filter(Boolean);
  const hiddenNames = [...list.querySelectorAll('.dnd-item[data-hidden="1"]')].map(li => li.dataset.name).filter(Boolean);
  orderInput.value = JSON.stringify(dedupeNames(names));
  hiddenInput.value = JSON.stringify(dedupeNames(hiddenNames));
}

function applyDnDItemState(li, labels, state = {}) {
  if (!li) return;
  const sharedVideos = Array.isArray(state.sharedVideos) ? state.sharedVideos : [];
  const manualEntries = Array.isArray(state.manualEntries) ? state.manualEntries : [];
  const visibilityDisabled = state.visibilityDisabled === true;

  const hidden = li.dataset.hidden === "1";
  li.style.opacity = hidden ? "0.58" : "1";
  li.style.filter = hidden ? "saturate(0.65)" : "";

  const txt = li.querySelector(".dnd-name");
  if (txt) {
    if (hidden) {
      txt.style.textDecoration = "line-through";
      txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";
    } else {
      txt.style.textDecoration = "none";
    }
  }

  const toggleBtn = li.querySelector(".dnd-btn-visibility");
  if (toggleBtn) {
    const showText = labels?.showCollection || "Göster";
    const hideText = labels?.hideCollection || "Gizle";
    toggleBtn.textContent = hidden ? showText : hideText;
    toggleBtn.disabled = visibilityDisabled;
    toggleBtn.title = visibilityDisabled
      ? (labels?.showCollectionLockedHint || "Bu ayar global modda sadece admin tarafından değiştirilebilir")
      : (hidden ? (labels?.showCollectionHint || "Koleksiyonu göster") : (labels?.hideCollectionHint || "Koleksiyonu gizle"));
    toggleBtn.style.opacity = visibilityDisabled ? "0.55" : "";
    toggleBtn.style.cursor = visibilityDisabled ? "not-allowed" : "";
  }

  const manualBadge = li.querySelector(".dnd-manual-badge");
  if (manualBadge) {
    manualBadge.style.display = li.dataset.manual === "1" ? "" : "none";
  }

  const removeBtn = li.querySelector(".dnd-btn-remove");
  if (removeBtn) {
    removeBtn.style.display = li.dataset.manual === "1" ? "" : "none";
  }

  const videoBadge = li.querySelector(".dnd-video-badge");
  const hasSharedVideo = !!findStudioHubVideoEntry(sharedVideos, li.dataset.name);
  const manualEntry = findStudioHubManualEntry(manualEntries, li.dataset.studioId || li.dataset.name);
  const hasCustomLogo = !!buildStudioHubLogoUrl(manualEntry);
  if (videoBadge) {
    videoBadge.textContent = hasSharedVideo ? (labels?.hoverVideoAvailable || "Video") : "";
    videoBadge.style.color = "var(--accent, #10b981)";
    videoBadge.style.display = hasSharedVideo ? "" : "none";
  }

  const deleteVideoBtn = li.querySelector(".dnd-btn-delete-video");
  if (deleteVideoBtn) {
    deleteVideoBtn.disabled = !hasSharedVideo;
    deleteVideoBtn.style.display = hasSharedVideo ? "" : "none";
    deleteVideoBtn.title = labels?.deleteHoverVideo || "Yüklü videoyu sil";
  }

  const logoBadge = li.querySelector(".dnd-logo-badge");
  if (logoBadge) {
    logoBadge.textContent = hasCustomLogo ? (labels?.logoAvailable || "Logo") : "";
    logoBadge.style.color = "var(--accent, #10b981)";
    logoBadge.style.display = hasCustomLogo ? "" : "none";
  }

  const deleteLogoBtn = li.querySelector(".dnd-btn-delete-logo");
  if (deleteLogoBtn) {
    deleteLogoBtn.disabled = !hasCustomLogo;
    deleteLogoBtn.style.display = (li.dataset.manual === "1" && hasCustomLogo) ? "" : "none";
    deleteLogoBtn.title = labels?.deleteLogo || "Yüklü logoyu sil";
  }

  const uploadLogoBtn = li.querySelector(".dnd-btn-upload-logo");
  if (uploadLogoBtn) {
    uploadLogoBtn.style.display = li.dataset.manual === "1" ? "" : "none";
  }
}

function createDraggableList(id, items, labels, options = {}) {
  const enableStudioControls = options.enableStudioControls === true;
  const hiddenNames = new Set((options.hiddenNames || []).map(nameKey));
  const sharedVideos = Array.isArray(options.sharedVideos) ? options.sharedVideos : [];
  const manualEntries = Array.isArray(options.manualEntries) ? options.manualEntries : [];
  const isAdmin = options.isAdmin === true;
  const visibilityDisabled = options.visibilityDisabled === true;

  const wrap = document.createElement("div");
  wrap.className = "setting-input setting-dnd";

  const lab = document.createElement("div");
  lab.textContent = labels?.studioHubsOrderLabel || "Sıralama (sürükle-bırak)";
  lab.style.display = "block";
  lab.style.marginBottom = "6px";

  const list = document.createElement("ul");
  list.id = id;
  list.className = "dnd-list";
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.margin = "0";
  list.style.border = "1px solid var(--theme-text-color, #8882)";
  list.style.borderRadius = "8px";
  list.style.maxHeight = "320px";
  list.style.overflow = "auto";

  dedupeNames(items).forEach(name => {
    list.appendChild(createDnDItem(name, labels, {
      enableStudioControls,
      hidden: hiddenNames.has(nameKey(name)),
      isManual: !!findStudioHubManualEntry(manualEntries, name),
      studioId: String(findStudioHubManualEntry(manualEntries, name)?.studioId || findStudioHubManualEntry(manualEntries, name)?.StudioId || "").trim(),
      isAdmin,
      visibilityDisabled,
      manualEntries,
      sharedVideos
    }));
  });

  let dragEl = null;

  list.addEventListener("dragstart", (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    dragEl = li;
    li.style.opacity = "0.6";
    e.dataTransfer?.setData?.("text/plain", li.dataset.name || "");
    e.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragend", (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    li.style.opacity = "";
    dragEl = null;
  });

  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    const over = e.target.closest(".dnd-item");
    if (!dragEl || !over || over === dragEl) return;
    const rect = over.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    list.insertBefore(dragEl, before ? over : over.nextSibling);
  });

  const __cleanup = () => { };
  wrap.addEventListener('jms:cleanup', __cleanup, { once:true });

  list.addEventListener("click", (e) => {
    const btnUp = e.target.closest?.(".dnd-btn-up");
    const btnDown = e.target.closest?.(".dnd-btn-down");
    if (!btnUp && !btnDown) return;
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    if (btnUp && li.previousElementSibling) {
      li.parentElement.insertBefore(li, li.previousElementSibling);
    } else if (btnDown && li.nextElementSibling) {
      li.parentElement.insertBefore(li.nextElementSibling, li);
    }
  });

  const wrapAll = document.createElement("div");
  wrapAll.appendChild(lab);
  wrapAll.appendChild(list);
  return { wrap: wrapAll, list };
}

function createDnDItem(name, labels, options = {}) {
  if (!options.enableStudioControls) {
    const li = document.createElement("li");
    li.className = "dnd-item";
    li.draggable = true;
    li.dataset.name = name;
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.gap = "8px";
    li.style.padding = "8px 10px";
    li.style.borderBottom = "1px solid #0002";
    li.style.background = "var(--theme-background, rgba(255,255,255,0.02))";

    const handle = document.createElement("span");
    handle.className = "dnd-handle";
    handle.textContent = "↕";
    handle.title = labels?.dragToReorder || "Sürükle-bırak";
    handle.style.cursor = "grab";
    handle.style.userSelect = "none";
    handle.style.fontWeight = "700";

    const txt = document.createElement("span");
    txt.textContent = name;
    txt.style.flex = "1";
    txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";

    const btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "6px";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "dnd-btn-up";
    up.textContent = "↑";
    up.title = labels?.moveUp || "Yukarı taşı";
    up.style.minWidth = "28px";

    const down = document.createElement("button");
    down.type = "button";
    down.className = "dnd-btn-down";
    down.textContent = "↓";
    down.title = labels?.moveDown || "Aşağı taşı";
    down.style.minWidth = "28px";

    btns.appendChild(up);
    btns.appendChild(down);

    li.appendChild(handle);
    li.appendChild(txt);
    li.appendChild(btns);
    return li;
  }

  const li = document.createElement("li");
  li.className = "dnd-item";
  li.draggable = true;
  li.dataset.name = name;
  li.dataset.hidden = options.hidden ? "1" : "0";
  li.dataset.manual = options.isManual ? "1" : "0";
  li.dataset.studioId = String(options.studioId || "").trim();
  li.dataset.visibilityDisabled = options.visibilityDisabled ? "1" : "0";
  li.style.display = "flex";
  li.style.alignItems = "center";
  li.style.gap = "8px";
  li.style.padding = "8px 10px";
  li.style.flexWrap = "wrap";
  li.style.borderBottom = "1px solid #0002";
  li.style.background = "var(--theme-background, rgba(255,255,255,0.02))";

  const handle = document.createElement("span");
  handle.className = "dnd-handle";
  handle.textContent = "↕";
  handle.title = labels?.dragToReorder || "Sürükle-bırak";
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";
  handle.style.fontWeight = "700";

  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.flex = "1";
  content.style.minWidth = "0";
  content.style.flexDirection = "column";
  content.style.gap = "4px";

  const txt = document.createElement("span");
  txt.className = "dnd-name";
  txt.textContent = name;
  txt.style.flex = "1";
  txt.style.fontWeight = "600";
  txt.style.wordBreak = "break-word";
  txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";

  const meta = document.createElement("div");
  meta.style.display = "flex";
  meta.style.gap = "6px";
  meta.style.flexWrap = "wrap";
  meta.style.fontSize = "12px";

  const manualBadge = document.createElement("span");
  manualBadge.className = "dnd-manual-badge";
  manualBadge.textContent = labels?.manualCollectionBadge || "Manuel";
  manualBadge.style.padding = "2px 6px";
  manualBadge.style.borderRadius = "999px";
  manualBadge.style.background = "rgba(16,185,129,0.18)";

  const videoBadge = document.createElement("span");
  videoBadge.className = "dnd-video-badge";
  videoBadge.style.padding = "2px 6px";
  videoBadge.style.borderRadius = "999px";
  videoBadge.style.background = "rgba(255,255,255,0.08)";

  const logoBadge = document.createElement("span");
  logoBadge.className = "dnd-logo-badge";
  logoBadge.style.padding = "2px 6px";
  logoBadge.style.borderRadius = "999px";
  logoBadge.style.background = "rgba(255,255,255,0.08)";

  meta.appendChild(manualBadge);
  meta.appendChild(logoBadge);
  meta.appendChild(videoBadge);
  content.appendChild(txt);
  content.appendChild(meta);

  const btns = document.createElement("div");
  btns.style.display = "flex";
  btns.style.gap = "6px";
  btns.style.flexWrap = "wrap";
  btns.style.justifyContent = "flex-end";

  const toggleVisibility = document.createElement("button");
  toggleVisibility.type = "button";
  toggleVisibility.className = "dnd-btn-visibility";
  toggleVisibility.style.minWidth = "56px";

  const uploadVideo = document.createElement("button");
  uploadVideo.type = "button";
  uploadVideo.className = "dnd-btn-upload-video";
  uploadVideo.textContent = labels?.uploadHoverVideo || "Video";
  uploadVideo.title = labels?.uploadHoverVideoHint || "Hover videosu yükle";
  uploadVideo.style.minWidth = "56px";

  const uploadLogo = document.createElement("button");
  uploadLogo.type = "button";
  uploadLogo.className = "dnd-btn-upload-logo";
  uploadLogo.textContent = labels?.uploadLogoShort || "Logo";
  uploadLogo.title = labels?.uploadLogoHint || "Logo yükle";
  uploadLogo.style.minWidth = "56px";

  const deleteLogo = document.createElement("button");
  deleteLogo.type = "button";
  deleteLogo.className = "dnd-btn-delete-logo";
  deleteLogo.textContent = labels?.deleteLogoShort || "Logo Sil";
  deleteLogo.style.minWidth = "72px";

  const deleteVideo = document.createElement("button");
  deleteVideo.type = "button";
  deleteVideo.className = "dnd-btn-delete-video";
  deleteVideo.textContent = labels?.deleteHoverVideoShort || "Sil";
  deleteVideo.style.minWidth = "44px";

  const up = document.createElement("button");
  up.type = "button";
  up.className = "dnd-btn-up";
  up.textContent = "↑";
  up.title = labels?.moveUp || "Yukarı taşı";
  up.style.minWidth = "28px";

  const down = document.createElement("button");
  down.type = "button";
  down.className = "dnd-btn-down";
  down.textContent = "↓";
  down.title = labels?.moveDown || "Aşağı taşı";
  down.style.minWidth = "28px";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "dnd-btn-remove";
  remove.textContent = labels?.removeCollection || "Kaldır";
  remove.title = labels?.removeCollectionHint || "Manuel koleksiyonu kaldır";
  remove.style.minWidth = "60px";

  btns.appendChild(toggleVisibility);
  if (options.isAdmin) {
    btns.appendChild(uploadLogo);
    btns.appendChild(deleteLogo);
    btns.appendChild(uploadVideo);
    btns.appendChild(deleteVideo);
  }
  btns.appendChild(remove);
  btns.appendChild(up);
  btns.appendChild(down);

  li.appendChild(handle);
  li.appendChild(content);
  li.appendChild(btns);
  applyDnDItemState(li, labels, {
    visibilityDisabled: options.visibilityDisabled,
    sharedVideos: options.sharedVideos,
    manualEntries: options.manualEntries
  });
  return li;
}

export function createStudioHubsPanel(config, labels) {
  ensureStudioHubsSpinnerStyles();
  const panel = document.createElement('div');
  panel.id = 'studio-panel';
  panel.className = 'setting-item';

  const section = createSection(
    labels?.studioHubsSettings ||
    config.languageLabels.studioHubsSettings ||
    'Stüdyo Koleksiyonları Ayarları'
  );

  const enableCheckbox = createCheckbox(
    'enableStudioHubs',
    labels?.enableStudioHubs || config.languageLabels.enableStudioHubs || 'Stüdyo Koleksiyonlarını Etkinleştir',
    config.enableStudioHubs
  );
  section.appendChild(enableCheckbox);

  const countWrap = createNumberInput(
    'studioHubsCardCount',
    labels?.studioHubsCardCount || 'Gösterilecek kart sayısı (Ana ekran)',
    Number.isFinite(config.studioHubsCardCount) ? config.studioHubsCardCount : 10,
    1,
    100
  );
  section.appendChild(countWrap);

  const baseOrder = mergeOrder(
    DEFAULT_ORDER,
    Array.isArray(config.studioHubsOrder) && config.studioHubsOrder.length
      ? config.studioHubsOrder
      : []
  );
  const isForceGlobal = config.forceGlobalUserSettings === true;
  const isAdmin = config.currentUserIsAdmin === true;
  const visibilityDisabled = isForceGlobal && !isAdmin;
  const useGlobalVisibility = isForceGlobal;
  const useGlobalOrder = isForceGlobal;

  const autoAddFromWatchlistCopyCheckbox = createCheckbox(
    'studioHubsAutoAddFromWatchlistCopy',
    labels?.studioHubsAutoAddFromWatchlistCopy || 'Watchlist stüdyo ID kopyasında koleksiyonu otomatik ekle',
    config.studioHubsAutoAddFromWatchlistCopy === true
  );
  autoAddFromWatchlistCopyCheckbox.style.display = isAdmin ? '' : 'none';
  section.appendChild(autoAddFromWatchlistCopyCheckbox);

  const autoAddFromWatchlistCopyHint = document.createElement("div");
  autoAddFromWatchlistCopyHint.className = "description-text2";
  autoAddFromWatchlistCopyHint.style.margin = "4px 0 10px";
  autoAddFromWatchlistCopyHint.style.display = isAdmin ? "" : "none";
  autoAddFromWatchlistCopyHint.textContent =
    labels?.studioHubsAutoAddFromWatchlistCopyHint ||
    "Açıkken admin kullanıcı, watchlist önizlemesinde stüdyoya tıklayıp ID kopyaladığında ilgili stüdyo koleksiyonu otomatik oluşturulur veya güncellenir.";
  section.appendChild(autoAddFromWatchlistCopyHint);

  let manualEntries = [];
  let manualEntriesLoaded = false;
  let sharedVideos = [];
  let currentOrderNames = dedupeNames(baseOrder);
  let currentHiddenNames = useGlobalVisibility
    ? dedupeNames(Array.isArray(config.studioHubsHidden) ? config.studioHubsHidden : [])
    : [];
  const getVisibilityProfile = () => ((isForceGlobal && isAdmin) ? getAdminTargetProfile() : getDeviceProfileAuto());

  const orderHiddenInput = createHiddenInput('studioHubsOrder', JSON.stringify(dedupeNames(baseOrder)));
  const hiddenHiddenInput = createHiddenInput('studioHubsHidden', JSON.stringify(currentHiddenNames));
  const { wrap: dndWrap, list } = createDraggableList('studioHubsOrderList', baseOrder, labels, {
    enableStudioControls: true,
    hiddenNames: currentHiddenNames,
    isAdmin,
    visibilityDisabled,
    manualEntries,
    sharedVideos
  });

  const normalizeOrderNamesForState = (names) => (
    manualEntriesLoaded
      ? sanitizeStudioHubOrderNames(names, manualEntries)
      : dedupeNames(names)
  );

  const normalizeHiddenNamesForState = (names) => (
    manualEntriesLoaded
      ? sanitizeStudioHubHiddenNames(names, manualEntries)
      : dedupeNames(names)
  );

  const getAllowedNames = () => (
    manualEntriesLoaded
      ? getStudioHubAllowedNames(manualEntries)
      : dedupeNames([
          ...[...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name).filter(Boolean),
          ...DEFAULT_ORDER
        ])
  );

  const pruneInvalidListItems = () => {
    if (!manualEntriesLoaded) return;
    const allowedKeys = new Set(getAllowedNames().map(nameKey));
    [...list.querySelectorAll(".dnd-item")].forEach(li => {
      if (!allowedKeys.has(nameKey(li.dataset.name))) {
        li.remove();
      }
    });
  };

  const syncHiddenNamesFromInput = () => {
    try {
      const parsed = JSON.parse(hiddenHiddenInput.value || "[]");
      currentHiddenNames = normalizeHiddenNamesForState(Array.isArray(parsed) ? parsed : []);
    } catch {
      currentHiddenNames = [];
    }
    return currentHiddenNames;
  };

  const syncOrderNamesFromInput = () => {
    try {
      const parsed = JSON.parse(orderHiddenInput.value || "[]");
      currentOrderNames = normalizeOrderNamesForState(Array.isArray(parsed) ? parsed : []);
    } catch {
      currentOrderNames = dedupeNames(baseOrder);
    }
    return currentOrderNames;
  };

  const applyOrderNamesToList = (orderNames) => {
    currentOrderNames = normalizeOrderNamesForState(orderNames);
    pruneInvalidListItems();
    const desiredOrder = mergeOrder(
      getAllowedNames(),
      currentOrderNames
    );
    const itemsByKey = new Map(
      [...list.querySelectorAll(".dnd-item")].map(li => [nameKey(li.dataset.name), li])
    );

    desiredOrder.forEach(name => {
      const key = nameKey(name);
      const li = itemsByKey.get(key);
      if (!li) return;
      list.appendChild(li);
      itemsByKey.delete(key);
    });

    itemsByKey.forEach(li => li.remove());
    refreshListState();
  };

  const applyHiddenNamesToList = (hiddenNames) => {
    currentHiddenNames = normalizeHiddenNamesForState(hiddenNames);
    pruneInvalidListItems();
    const hiddenSet = new Set(currentHiddenNames.map(nameKey));
    [...list.querySelectorAll(".dnd-item")].forEach(li => {
      li.dataset.hidden = hiddenSet.has(nameKey(li.dataset.name)) ? "1" : "0";
    });
    refreshListState();
  };

  const findListItemsByManualEntry = (entry) => {
    const name = String(entry?.name || entry?.Name || "").trim();
    const studioId = String(entry?.studioId || entry?.StudioId || "").trim();
    return [...list.querySelectorAll(".dnd-item")].filter(li => {
      const sameStudioId = studioId && nameKey(li.dataset.studioId) === nameKey(studioId);
      const sameName = name && nameKey(li.dataset.name) === nameKey(name);
      return sameStudioId || sameName;
    });
  };

  const upsertManualEntryInList = (entry) => {
    const name = String(entry?.name || entry?.Name || "").trim();
    const studioId = String(entry?.studioId || entry?.StudioId || "").trim();
    if (!name || !studioId) return null;

    const matches = findListItemsByManualEntry(entry);
    const existing = matches[0] || null;
    if (existing) {
      existing.dataset.name = name;
      existing.dataset.studioId = studioId;
      existing.dataset.manual = "1";
      const nameEl = existing.querySelector(".dnd-name");
      if (nameEl) nameEl.textContent = name;
      matches.slice(1).forEach(li => li.remove());
      return existing;
    }

    const li = createDnDItem(name, labels, {
      enableStudioControls: true,
      hidden: currentHiddenNames.some(item => nameKey(item) === nameKey(name)),
      isManual: true,
      studioId,
      isAdmin,
      visibilityDisabled,
      manualEntries,
      sharedVideos
    });
    list.appendChild(li);
    return li;
  };

  const refreshListState = () => {
    pruneInvalidListItems();
    refreshStudioHubHiddenInputs(list, orderHiddenInput, hiddenHiddenInput);
    syncOrderNamesFromInput();
    syncHiddenNamesFromInput();
    [...list.querySelectorAll(".dnd-item")].forEach(li => applyDnDItemState(li, labels, {
      visibilityDisabled: li.dataset.visibilityDisabled === "1",
      sharedVideos,
      manualEntries
    }));
  };

  const statusText = document.createElement("div");
  statusText.className = "description-text2";
  statusText.style.margin = "8px 0 12px";
  statusText.style.minHeight = "18px";

  const setStatus = (text = "", tone = "") => {
    statusText.textContent = text;
    statusText.style.color =
      tone === "error" ? "#ff7b7b" :
      tone === "success" ? "var(--accent, #10b981)" :
      "";
  };

  const handleExternalManualEntryAdded = (event) => {
    const entry = event?.detail?.entry || null;
    const entries = Array.isArray(event?.detail?.entries) ? event.detail.entries : null;
    const studioId = String(entry?.studioId || entry?.StudioId || "").trim();
    const name = String(entry?.name || entry?.Name || "").trim();
    if (!entries && !studioId && !name) return;

    if (entries) {
      manualEntries = entries;
    } else if (entry) {
      const existing = findStudioHubManualEntry(manualEntries, studioId || name);
      manualEntries = existing
        ? manualEntries.map((item) => {
            const sameStudioId = studioId && nameKey(item?.studioId || item?.StudioId) === nameKey(studioId);
            const sameName = name && nameKey(item?.name || item?.Name) === nameKey(name);
            return (sameStudioId || sameName) ? entry : item;
          })
        : [...manualEntries, entry];
    }

    if (entry) {
      upsertManualEntryInList(entry);
    } else if (entries) {
      entries.forEach(nextEntry => upsertManualEntryInList(nextEntry));
    }

    refreshListState();

    if (event?.detail?.source === "watchlist-auto-add" && name) {
      setStatus(
        formatLabel("studioHubAutoAddedFromWatchlist", "{name} koleksiyon listesine eklendi.", {
          name
        }),
        "success"
      );
    }
  };

  window.addEventListener(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, handleExternalManualEntryAdded);

  const formatLabel = (key, fallback, vars = {}) => {
    let text = String(labels?.[key] || fallback);
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value ?? ""));
    }
    return text;
  };

  const manualAddWrap = document.createElement("div");
  manualAddWrap.className = "input-container";
  manualAddWrap.style.display = isAdmin ? "" : "none";

  const manualAddLabel = document.createElement("div");
  manualAddLabel.textContent = labels?.addManualCollection || "Yeni koleksiyon ekle";
  manualAddWrap.appendChild(manualAddLabel);

  const manualAddHint = document.createElement("div");
  manualAddHint.className = "description-text2";
  manualAddHint.style.marginBottom = "8px";
  manualAddHint.textContent = labels?.manualCollectionStudioIdHint || "Studio ID girin. Başlık otomatik çözülür; logo ve video yükleme opsiyoneldir.";
  manualAddWrap.appendChild(manualAddHint);

  const studioIdLabel = document.createElement("label");
  studioIdLabel.textContent = labels?.studioIdPlaceholder || "Studio ID";
  studioIdLabel.htmlFor = "studioHubsManualStudioId";
  studioIdLabel.style.display = "block";
  studioIdLabel.style.marginBottom = "6px";
  manualAddWrap.appendChild(studioIdLabel);

  const manualAddRow = document.createElement("div");
  manualAddRow.style.display = "flex";
  manualAddRow.style.gap = "8px";
  manualAddRow.style.flexWrap = "wrap";

  const studioIdInput = document.createElement("input");
  studioIdInput.type = "text";
  studioIdInput.id = "studioHubsManualStudioId";
  studioIdInput.name = "studioHubsManualStudioId";
  studioIdInput.placeholder = labels?.studioIdPlaceholder || "Studio ID";
  studioIdInput.style.flex = "1";
  studioIdInput.style.minWidth = "240px";

  const manualAddBtn = document.createElement("button");
  manualAddBtn.type = "button";
  manualAddBtn.style.display = "inline-flex";
  manualAddBtn.style.alignItems = "center";
  manualAddBtn.style.justifyContent = "center";
  manualAddBtn.style.gap = "8px";

  const manualAddSpinner = document.createElement("span");
  manualAddSpinner.setAttribute("aria-hidden", "true");
  manualAddSpinner.style.display = "none";
  manualAddSpinner.style.width = "14px";
  manualAddSpinner.style.height = "14px";
  manualAddSpinner.style.border = "2px solid currentColor";
  manualAddSpinner.style.borderRightColor = "transparent";
  manualAddSpinner.style.borderRadius = "50%";
  manualAddSpinner.style.animation = "jmsStudioHubsSpin 0.7s linear infinite";

  const manualAddBtnText = document.createElement("span");
  manualAddBtnText.textContent = labels?.addCollectionButton || "Ekle";
  manualAddBtn.append(manualAddSpinner, manualAddBtnText);

  manualAddRow.appendChild(studioIdInput);
  manualAddRow.appendChild(manualAddBtn);
  manualAddWrap.appendChild(manualAddRow);

  const manualAssetRow = document.createElement("div");
  manualAssetRow.style.display = "flex";
  manualAssetRow.style.gap = "8px";
  manualAssetRow.style.flexWrap = "wrap";
  manualAssetRow.style.marginTop = "8px";

  const manualLogoWrap = document.createElement("div");
  manualLogoWrap.style.display = "flex";
  manualLogoWrap.style.flexDirection = "column";
  manualLogoWrap.style.gap = "6px";

  const manualLogoLabel = document.createElement("label");
  manualLogoLabel.textContent = labels?.optionalLogoTitle || "Opsiyonel logo";
  manualLogoLabel.htmlFor = "studioHubsManualLogoInput";

  const manualLogoInput = document.createElement("input");
  manualLogoInput.type = "file";
  manualLogoInput.id = "studioHubsManualLogoInput";
  manualLogoInput.name = "studioHubsManualLogoInput";
  manualLogoInput.accept = "image/png,image/webp,image/svg+xml,image/jpeg,.png,.webp,.svg,.jpg,.jpeg";
  manualLogoInput.title = labels?.optionalLogoTitle || "Opsiyonel logo";

  const manualVideoWrap = document.createElement("div");
  manualVideoWrap.style.display = "flex";
  manualVideoWrap.style.flexDirection = "column";
  manualVideoWrap.style.gap = "6px";

  const manualVideoLabel = document.createElement("label");
  manualVideoLabel.textContent = labels?.optionalVideoTitle || "Opsiyonel hover video";
  manualVideoLabel.htmlFor = "studioHubsManualVideoInput";

  const manualVideoInput = document.createElement("input");
  manualVideoInput.type = "file";
  manualVideoInput.id = "studioHubsManualVideoInput";
  manualVideoInput.name = "studioHubsManualVideoInput";
  manualVideoInput.accept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.m4v,.mov";
  manualVideoInput.title = labels?.optionalVideoTitle || "Opsiyonel hover video";

  manualLogoWrap.append(manualLogoLabel, manualLogoInput);
  manualVideoWrap.append(manualVideoLabel, manualVideoInput);
  manualAssetRow.append(manualLogoWrap, manualVideoWrap);
  manualAddWrap.appendChild(manualAssetRow);

  const sharedVideoHint = document.createElement("div");
  sharedVideoHint.className = "description-text2";
  sharedVideoHint.style.marginBottom = "8px";
  sharedVideoHint.textContent = isAdmin
    ? (labels?.hoverVideoAdminHint || "Hover videoları anında sunucuya kaydedilir ve tüm kullanıcılar kullanır.")
    : (labels?.hoverVideoAdminOnlyHint || "Hover video yükleme ve silme sadece admin kullanıcılar içindir.");

  const videoFileInput = document.createElement("input");
  videoFileInput.type = "file";
  videoFileInput.id = "studioHubsSharedVideoFileInput";
  videoFileInput.name = "studioHubsSharedVideoFileInput";
  videoFileInput.accept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.m4v,.mov";
  videoFileInput.style.display = "none";
  videoFileInput.setAttribute("aria-hidden", "true");

  const logoFileInput = document.createElement("input");
  logoFileInput.type = "file";
  logoFileInput.id = "studioHubsSharedLogoFileInput";
  logoFileInput.name = "studioHubsSharedLogoFileInput";
  logoFileInput.accept = "image/png,image/webp,image/svg+xml,image/jpeg,.png,.webp,.svg,.jpg,.jpeg";
  logoFileInput.style.display = "none";
  logoFileInput.setAttribute("aria-hidden", "true");

  let pendingVideoTarget = "";
  let pendingLogoTargetStudioId = "";
  let manualAddBusy = false;

  panel.addEventListener("jms:cleanup", () => {
    window.removeEventListener(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, handleExternalManualEntryAdded);
  }, { once: true });

  const setManualAddBusy = (busy) => {
    manualAddBusy = !!busy;
    setButtonBusy(manualAddBtn, manualAddBtnText, manualAddSpinner, manualAddBusy, {
      idleText: labels?.addCollectionButton || "Ekle",
      busyText: labels?.addCollectionBusy || "Ekleniyor..."
    });
    studioIdInput.disabled = manualAddBusy;
    manualLogoInput.disabled = manualAddBusy;
    manualVideoInput.disabled = manualAddBusy;
  };

  const addManualCollection = async () => {
    if (manualAddBusy) return;
    const studioId = String(studioIdInput.value || "").trim();
    if (!studioId) {
      setStatus(labels?.manualCollectionEmpty || "Önce Studio ID girin.", "error");
      return;
    }

    setManualAddBusy(true);
    try {
      setStatus(labels?.studioResolving || "Stüdyo çözümleniyor...");
      const item = await fetchItemDetails(studioId).catch(() => null);
      const resolvedName = String(item?.Name || "").trim();
      if (!resolvedName) {
        setStatus(labels?.studioResolveFailed || "Bu Studio ID için başlık çözümlenemedi.", "error");
        return;
      }
      const canonicalName = toCanonicalStudioName(resolvedName) || resolvedName;

      if (isDefaultStudioHub(canonicalName)) {
        setStatus(labels?.manualCollectionDuplicate || "Bu koleksiyon zaten ekli.", "error");
        return;
      }

      const existing = findStudioHubManualEntry(manualEntries, studioId) || findStudioHubManualEntry(manualEntries, canonicalName);
      if (existing) {
        setStatus(labels?.manualCollectionDuplicate || "Bu koleksiyon zaten ekli.", "error");
        return;
      }

      const existingListName = [...list.querySelectorAll(".dnd-item")].some(li => nameKey(li.dataset.name) === nameKey(canonicalName));
      if (existingListName) {
        setStatus(labels?.manualCollectionDuplicate || "Bu koleksiyon zaten listede var.", "error");
        return;
      }

      const created = await createStudioHubManualEntry({ studioId, name: canonicalName });
      manualEntries = Array.isArray(created?.entries) ? created.entries : manualEntries;
      upsertManualEntryInList(created?.entry || { studioId, name: canonicalName });

      const logoFile = manualLogoInput.files?.[0];
      let autoLogoUploaded = false;
      if (logoFile) {
        const logoRes = await uploadStudioHubLogo(studioId, logoFile);
        manualEntries = Array.isArray(logoRes?.entries) ? logoRes.entries : manualEntries;
      } else {
        setStatus(formatLabel("studioHubTmdbLogoSearching", "{name} için TMDB logosu aranıyor...", {
          name: canonicalName
        }));
        const tmdbLogoFile = await resolveTmdbLogoFileForStudio(canonicalName).catch(() => null);
        if (tmdbLogoFile) {
          const logoRes = await uploadStudioHubLogo(studioId, tmdbLogoFile);
          manualEntries = Array.isArray(logoRes?.entries) ? logoRes.entries : manualEntries;
          autoLogoUploaded = true;
        }
      }

      const videoFile = manualVideoInput.files?.[0];
      if (videoFile) {
        const videoRes = await uploadStudioHubVideo(canonicalName, videoFile);
        sharedVideos = Array.isArray(videoRes?.entries) ? videoRes.entries : sharedVideos;
      }

      studioIdInput.value = "";
      manualLogoInput.value = "";
      manualVideoInput.value = "";
      refreshListState();
      setStatus(
        autoLogoUploaded
          ? formatLabel("studioHubManualCollectionAddedWithTmdbLogo", "{name} eklendi. TMDB logosu otomatik kaydedildi.", {
            name: canonicalName
          })
          : formatLabel("studioHubManualCollectionAdded", "{name} eklendi.", {
            name: canonicalName
          }),
        "success"
      );
    } catch (error) {
      setStatus(error?.message || (labels?.studioHubManualCollectionAddFailed || "Koleksiyon eklenemedi."), "error");
    } finally {
      setManualAddBusy(false);
    }
  };

  manualAddBtn.addEventListener("click", addManualCollection);
  studioIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addManualCollection();
    }
  });

  videoFileInput.addEventListener("change", async () => {
    const file = videoFileInput.files?.[0];
    const targetName = pendingVideoTarget;
    pendingVideoTarget = "";
    videoFileInput.value = "";

    if (!file || !targetName) return;

    setStatus(formatLabel("studioHubHoverVideoUploading", "{name} için video yükleniyor...", {
      name: targetName
    }));
    try {
      const result = await uploadStudioHubVideo(targetName, file);
      sharedVideos = Array.isArray(result?.entries) ? result.entries : sharedVideos;
      refreshListState();
      setStatus(formatLabel("studioHubHoverVideoSaved", "{name} için hover videosu kaydedildi.", {
        name: targetName
      }), "success");
    } catch (error) {
      setStatus(error?.message || (labels?.studioHubHoverVideoUploadFailed || "Hover videosu yüklenemedi."), "error");
    }
  });

  logoFileInput.addEventListener("change", async () => {
    const file = logoFileInput.files?.[0];
    const studioId = pendingLogoTargetStudioId;
    pendingLogoTargetStudioId = "";
    logoFileInput.value = "";

    if (!file || !studioId) return;

    const target = findStudioHubManualEntry(manualEntries, studioId);
    const targetName = String(target?.name || target?.Name || studioId);

    setStatus(formatLabel("studioHubLogoUploading", "{name} için logo yükleniyor...", {
      name: targetName
    }));
    try {
      const result = await uploadStudioHubLogo(studioId, file);
      manualEntries = Array.isArray(result?.entries) ? result.entries : manualEntries;
      refreshListState();
      setStatus(formatLabel("studioHubLogoSaved", "{name} için logo kaydedildi.", {
        name: targetName
      }), "success");
    } catch (error) {
      setStatus(error?.message || (labels?.studioHubLogoUploadFailed || "Logo yüklenemedi."), "error");
    }
  });

  section.appendChild(dndWrap);
  section.appendChild(statusText);
  if (isAdmin) section.appendChild(manualAddWrap);
  section.appendChild(sharedVideoHint);
  section.appendChild(videoFileInput);
  section.appendChild(logoFileInput);
  section.appendChild(orderHiddenInput);
  section.appendChild(hiddenHiddenInput);

  (async () => {
    try {
      const ctrl = new AbortController();
      panel.addEventListener('jms:cleanup', () => ctrl.abort(), { once: true });
      const url = `/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
      const data = await makeApiRequest(url, { signal: ctrl.signal });
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      const existing = new Set(
        [...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name.toLowerCase())
      );

      const toAdd = [];
      for (const s of items) {
        const canon = toCanonicalStudioName(s?.Name);
        if (!canon) continue;
        if (!existing.has(canon.toLowerCase())) {
          existing.add(canon.toLowerCase());
          toAdd.push(canon);
        }
      }

      if (toAdd.length) {
        const appendSorted = toAdd.sort(
          (a, b) => DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b)
        );

        for (const name of appendSorted) {
          list.appendChild(createDnDItem(name, labels, {
            enableStudioControls: true,
            hidden: currentHiddenNames.some(item => nameKey(item) === nameKey(name)),
            isManual: false,
            isAdmin,
            visibilityDisabled,
            manualEntries,
            sharedVideos
          }));
        }

        applyOrderNamesToList(currentOrderNames);
        refreshListState();
      }
    } catch (e) {
      console.warn("studioHubsPage: Studios genişletme başarısız:", e);
    }
  })();

  list.addEventListener("click", async (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li) return;

    const toggleBtn = e.target.closest(".dnd-btn-visibility");
    if (toggleBtn) {
      if (toggleBtn.disabled || li.dataset.visibilityDisabled === "1") return;
      li.dataset.hidden = li.dataset.hidden === "1" ? "0" : "1";
      refreshListState();
      return;
    }

    const removeBtn = e.target.closest(".dnd-btn-remove");
    if (removeBtn) {
      const studioId = li.dataset.studioId || "";
      if (!studioId) return;
      const targetName = li.dataset.name || formatLabel("studioHubCollectionFallbackName", "Koleksiyon");
      setStatus(formatLabel("studioHubCollectionRemoving", "{name} kaldırılıyor...", {
        name: targetName
      }));
      try {
        const result = await deleteStudioHubManualEntry(studioId);
        manualEntries = Array.isArray(result?.manualEntries) ? result.manualEntries : manualEntries;
        sharedVideos = Array.isArray(result?.videoEntries) ? result.videoEntries : sharedVideos;
        li.remove();
        refreshListState();
        setStatus(labels?.manualCollectionRemoved || "Koleksiyon listeden kaldırıldı.", "success");
      } catch (error) {
        setStatus(error?.message || (labels?.studioHubManualCollectionRemoveFailed || "Koleksiyon kaldırılamadı."), "error");
      }
      return;
    }

    const uploadLogoBtn = e.target.closest(".dnd-btn-upload-logo");
    if (uploadLogoBtn) {
      pendingLogoTargetStudioId = li.dataset.studioId || "";
      logoFileInput.click();
      return;
    }

    const deleteLogoBtn = e.target.closest(".dnd-btn-delete-logo");
    if (deleteLogoBtn && !deleteLogoBtn.disabled) {
      const studioId = li.dataset.studioId || "";
      const targetName = li.dataset.name || "";
      setStatus(formatLabel("studioHubLogoDeleting", "{name} için logo siliniyor...", {
        name: targetName
      }));
      try {
        const result = await deleteStudioHubLogo(studioId);
        manualEntries = Array.isArray(result?.entries) ? result.entries : manualEntries;
        refreshListState();
        setStatus(formatLabel("studioHubLogoDeleted", "{name} için logo silindi.", {
          name: targetName
        }), "success");
      } catch (error) {
        setStatus(error?.message || (labels?.studioHubLogoDeleteFailed || "Logo silinemedi."), "error");
      }
      return;
    }

    const uploadBtn = e.target.closest(".dnd-btn-upload-video");
    if (uploadBtn) {
      pendingVideoTarget = li.dataset.name || "";
      videoFileInput.click();
      return;
    }

    const deleteVideoBtn = e.target.closest(".dnd-btn-delete-video");
    if (deleteVideoBtn && !deleteVideoBtn.disabled) {
      const targetName = li.dataset.name || "";
      setStatus(formatLabel("studioHubHoverVideoDeleting", "{name} için hover videosu siliniyor...", {
        name: targetName
      }));
      try {
        const result = await deleteStudioHubVideo(targetName);
        sharedVideos = Array.isArray(result?.entries) ? result.entries : [];
        refreshListState();
        setStatus(formatLabel("studioHubHoverVideoDeleted", "{name} için hover videosu silindi.", {
          name: targetName
        }), "success");
      } catch (error) {
        setStatus(error?.message || (labels?.studioHubHoverVideoDeleteFailed || "Hover videosu silinemedi."), "error");
      }
    }
  });

  list.addEventListener("dragend", refreshListState);
  list.addEventListener("drop", refreshListState);
  list.addEventListener("click", (e) => {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshListState();
  });
  refreshListState();

  if (useGlobalVisibility) {
    if (useGlobalOrder) applyOrderNamesToList(currentOrderNames);
    applyHiddenNamesToList(currentHiddenNames);
  } else {
    (async () => {
      try {
        const visibility = await fetchStudioHubVisibility({
          force: true,
          profile: getVisibilityProfile()
        });
        applyOrderNamesToList(
          Array.isArray(visibility?.orderNames) && visibility.orderNames.length
            ? visibility.orderNames
            : currentOrderNames
        );
        applyHiddenNamesToList(visibility?.hiddenNames || []);
      } catch (e) {
        console.warn("studioHubsPage: visibility alınamadı:", e);
      }
    })();
  }

  (async () => {
    try {
      manualEntries = await fetchStudioHubManualEntries();
      manualEntriesLoaded = true;
      manualEntries.forEach(entry => upsertManualEntryInList(entry));
      sharedVideos = await fetchStudioHubVideoEntries();
      applyOrderNamesToList(currentOrderNames);
      refreshListState();
    } catch (e) {
      console.warn("studioHubsPage: shared data alınamadı:", e);
    }
  })();

  const enableHoverVideo = createCheckbox(
    'studioHubsHoverVideo',
    labels?.studioHubsHoverVideo || 'Hoverda video oynat',
    config.studioHubsHoverVideo
  );
  section.appendChild(enableHoverVideo);

  const subheading = document.createElement('h3');
  subheading.textContent = labels?.personalRecommendations || 'Kişisel Öneriler';
  section.appendChild(subheading);

  const enableForYouCheckbox = createCheckbox(
    'enablePersonalRecommendations',
    labels?.enableForYou || config.languageLabels.enableForYou || 'Sana Özel Koleksiyonları Etkinleştir',
    config.enablePersonalRecommendations
  );
  section.appendChild(enableForYouCheckbox);

  const placeRecsUnderStudio = createCheckbox(
  'placePersonalRecsUnderStudioHubs',
  (labels?.hubsUnderStudioHubs) || 'Sana özel önerileri #studio-hubs altına yerleştir',
  !!config.placePersonalRecsUnderStudioHubs
  );
  section.appendChild(placeRecsUnderStudio);

  const ratingWrap = createNumberInput(
   'studioHubsMinRating',
   labels?.studioHubsMinRating || 'Minimum Derecelendirme',
   Number.isFinite(config.studioHubsMinRating) ? config.studioHubsMinRating : 6.5,
   1,
   10,
   0.1
  );
  section.appendChild(ratingWrap);

  const personalcountWrap = createNumberInput(
    'personalRecsCardCount',
    labels?.studioHubsCardCount || 'Gösterilecek kart sayısı (Ana ekran)',
    Number.isFinite(config.personalRecsCardCount) ? config.personalRecsCardCount : 9,
    1,
    20
  );
  section.appendChild(personalcountWrap);

  const raHeading = document.createElement('h3');
  raHeading.textContent =
    labels?.recentAndContinueHeading ||
    'Son Eklenenler & İzlemeye Devam Et';
  section.appendChild(raHeading);

  const enableRecentRows = createCheckbox(
    'enableRecentRows',
    labels?.enableRecentRows || 'Son eklenenler (master) satırlarını göster',
    config.enableRecentRows !== false
  );
  section.appendChild(enableRecentRows);

  const recentSubWrap = document.createElement("div");
  recentSubWrap.style.paddingLeft = "8px";
  recentSubWrap.style.borderLeft = "2px solid #0002";
  recentSubWrap.style.marginBottom = "10px";
  section.appendChild(recentSubWrap);

  const showRecentRowsHeroCards = createCheckbox(
    'showRecentRowsHeroCards',
    labels?.showRecentRowsHeroCards || 'Hero kartını göster (Son Eklenenler)',
    config.showRecentRowsHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentRowsHeroCards);

  const enableRecentMoviesRow = createCheckbox(
    'enableRecentMoviesRow',
    labels?.enableRecentMoviesRow || 'Son eklenen filmler satırı',
    config.enableRecentMoviesRow !== false
  );
  recentSubWrap.appendChild(enableRecentMoviesRow);

  const recentMoviesCountWrap = createNumberInput(
    'recentMoviesCardCount',
    labels?.recentMoviesCardCount || 'Son eklenen filmler kart sayısı',
    Number.isFinite(config.recentMoviesCardCount) ? config.recentMoviesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentMoviesCountWrap);

  const enableRecentSeriesRow = createCheckbox(
    'enableRecentSeriesRow',
    labels?.enableRecentSeriesRow || 'Son eklenen diziler satırı',
    config.enableRecentSeriesRow !== false
  );
  recentSubWrap.appendChild(enableRecentSeriesRow);

  const recentSeriesCountWrap = createNumberInput(
    'recentSeriesCardCount',
    labels?.recentSeriesCardCount || 'Son eklenen diziler kart sayısı',
    Number.isFinite(config.recentSeriesCardCount) ? config.recentSeriesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentSeriesCountWrap);

  const enableRecentMusicRow = createCheckbox(
    'enableRecentMusicRow',
    labels?.enableRecentMusicRow || 'Son eklenen Albüm Bölümü',
    config.enableRecentMusicRow !== false
  );
  recentSubWrap.appendChild(enableRecentMusicRow);

  const enableRecentMusicTracksRow = createCheckbox(
    'enableRecentMusicTracksRow',
    labels?.enableRecentMusicTracksRow || 'Son Dinlenen Parçalar',
    config.enableRecentMusicTracksRow !== false
  );
  recentSubWrap.appendChild(enableRecentMusicTracksRow);

  const recentMusicCountWrap = createNumberInput(
    'recentMusicCardCount',
    labels?.recentMusicCardCount || 'Son eklenen müzikler kart sayısı',
    Number.isFinite(config.recentMusicCardCount) ? config.recentMusicCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentMusicCountWrap);

  const enableRecentEpisodesRow = createCheckbox(
    'enableRecentEpisodesRow',
    labels?.enableRecentEpisodesRow || 'Son eklenen bölümler',
    config.enableRecentEpisodesRow !== false
  );
  recentSubWrap.appendChild(enableRecentEpisodesRow);

  const recentEpisodesCountWrap = createNumberInput(
    'recentEpisodesCardCount',
    labels?.recentEpisodesCardCount || 'Son eklenen bölümler kart sayısı',
    Number.isFinite(config.recentEpisodesCardCount) ? config.recentEpisodesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentEpisodesCountWrap);

  const getCb = wrap => wrap?.querySelector?.('input[type="checkbox"]');
  const masterCb = getCb(enableRecentRows);
  const recMovCb = getCb(enableRecentMoviesRow);
  const recSerCb = getCb(enableRecentSeriesRow);
  const recMusicCb = getCb(enableRecentMusicRow);
  const recTracksCb = getCb(enableRecentMusicTracksRow);
  const recEpCb  = getCb(enableRecentEpisodesRow);

  function syncRecentSubState() {
    const on = !!masterCb?.checked;
    recentSubWrap.style.display = on ? '' : 'none';
    if (!on) {
      if (recMovCb) recMovCb.checked = false;
      if (recSerCb) recSerCb.checked = false;
      if (recMusicCb) recMusicCb.checked = false;
      if (recTracksCb) recTracksCb.checked = false;
      if (recEpCb)  recEpCb.checked  = false;
    }
  }
  syncRecentSubState();
  enableRecentRows.addEventListener('change', syncRecentSubState, { passive: true });

  const enableContinueMovies = createCheckbox(
    'enableContinueMovies',
    labels?.enableContinueMovies || 'İzlemeye devam et (Filmler) satırını göster',
    !!config.enableContinueMovies
  );
  section.appendChild(enableContinueMovies);

  const continueMoviesCountWrap = createNumberInput(
    'continueMoviesCardCount',
    labels?.continueMoviesCardCount || 'İzlemeye devam et (Filmler) kart sayısı',
    Number.isFinite(config.continueMoviesCardCount) ? config.continueMoviesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueMoviesCountWrap);

  const enableContinueSeries = createCheckbox(
    'enableContinueSeries',
    labels?.enableContinueSeries || 'İzlemeye devam et (Diziler) satırını göster',
    !!config.enableContinueSeries
  );
  section.appendChild(enableContinueSeries);

  const continueSeriesCountWrap = createNumberInput(
    'continueSeriesCardCount',
    labels?.continueSeriesCardCount || 'İzlemeye devam et (Diziler) kart sayısı',
    Number.isFinite(config.continueSeriesCardCount) ? config.continueSeriesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueSeriesCountWrap);

  const splitTvLibRows = createCheckbox(
    'recentRowsSplitTvLibs',
    labels?.recentRowsSplitTvLibs || 'Dizi Kütüphanelerini Ayrı Bölümle',
    config.recentRowsSplitTvLibs !== false
  );
  section.appendChild(splitTvLibRows);

  const tvLibBox = document.createElement("div");
  tvLibBox.className = "setting-item tvshows";
  tvLibBox.style.paddingLeft = "8px";
  tvLibBox.style.borderLeft = "2px solid #0002";
  tvLibBox.style.marginBottom = "10px";
  section.appendChild(tvLibBox);

  const splitCb = splitTvLibRows?.querySelector?.('input[type="checkbox"]');
  function syncTvLibBoxVisibility() {
    const splitOn = !!splitCb?.checked;
    tvLibBox.style.display = splitOn ? "" : "none";
  }
  syncTvLibBoxVisibility();
  splitTvLibRows.addEventListener("change", syncTvLibBoxVisibility, { passive: true });

  const tvLibTitle = document.createElement("div");
  tvLibTitle.style.fontWeight = "700";
  tvLibTitle.style.margin = "6px 0";
  tvLibTitle.textContent = labels?.tvLibSelectHeading || "Gösterilecek Dizi Kütüphaneleri";
  tvLibBox.appendChild(tvLibTitle);

  function readJsonArr(k) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw || raw === "[object Object]") return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(x=>String(x||"").trim()).filter(Boolean) : [];
    } catch { return []; }
  }
  function writeJsonArr(k, arr) {
    try { localStorage.setItem(k, JSON.stringify((arr||[]).filter(Boolean))); } catch {}
  }
  function mkHidden(k, initialArr) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.id = k;
    inp.name = k;
    inp.value = JSON.stringify((initialArr||[]).filter(Boolean));
    return inp;
  }

  const hiddenRecentSeries   = mkHidden("recentSeriesTvLibIds",   readJsonArr("recentSeriesTvLibIds"));
  const hiddenRecentEpisodes = mkHidden("recentEpisodesTvLibIds", readJsonArr("recentEpisodesTvLibIds"));
  const hiddenContinueSeries = mkHidden("continueSeriesTvLibIds", readJsonArr("continueSeriesTvLibIds"));
  tvLibBox.appendChild(hiddenRecentSeries);
  tvLibBox.appendChild(hiddenRecentEpisodes);
  tvLibBox.appendChild(hiddenContinueSeries);

  const tvLibHint = document.createElement("div");
  tvLibHint.style.opacity = "0.85";
  tvLibHint.style.fontSize = "0.95em";
  tvLibHint.style.marginBottom = "6px";
  tvLibHint.textContent = labels?.tvLibSelectHint || "Boş bırakırsan: tüm Dizi kütüphaneleri aktif sayılır.";
  tvLibBox.appendChild(tvLibHint);

  const tvLibGrid = document.createElement("div");
  tvLibGrid.style.display = "grid";
  tvLibGrid.style.gridTemplateColumns = "1fr";
  tvLibGrid.style.gap = "8px";
  tvLibBox.appendChild(tvLibGrid);

  const OTHER_CT_EXCLUDE = new Set(["movies","tvshows","music"]);

  function readJsonArrGeneric(k) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw || raw === "[object Object]") return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(x=>String(x||"").trim()).filter(Boolean) : [];
    } catch { return []; }
  }

  function writeJsonArrGeneric(k, arr) {
    try { localStorage.setItem(k, JSON.stringify((arr||[]).filter(Boolean))); } catch {}
  }

  async function fetchTvLibs() {
    try {
      const me = await makeApiRequest(`/Users/Me`);
      const uid = me?.Id;
      if (!uid) return [];
      const v = await makeApiRequest(`/Users/${uid}/Views`);
      const items = Array.isArray(v?.Items) ? v.Items : [];
      return items.filter(x => x?.CollectionType === "tvshows" && x?.Id).map(x => ({
        Id: x.Id,
        Name: x.Name || (labels?.studioHubTvLibraryFallbackName || "TV")
      }));
    } catch {
      return [];
    }
  }

  async function fetchAllViews() {
    try {
      const me = await makeApiRequest(`/Users/Me`);
      const uid = me?.Id;
      if (!uid) return [];
      const v = await makeApiRequest(`/Users/${uid}/Views`);
      const items = Array.isArray(v?.Items) ? v.Items : [];
      return items
        .filter(x => x?.Id)
        .map(x => ({
          Id: x.Id,
          Name: x.Name || (labels?.studioHubLibraryFallbackName || "Library"),
          CollectionType: (x.CollectionType || "").toString()
        }));
    } catch { return []; }
  }

  (async () => {
    const libs = await fetchTvLibs();
    if (!libs.length) {
      const warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels?.tvLibSelectNoLibs || "Dizi kütüphanesi bulunamadı.";
      tvLibGrid.appendChild(warn);
      return;
    }

    const makeRow = (title, key, hiddenInp) => {
      const box = document.createElement("div");
      box.style.border = "1px solid #0002";
      box.style.borderRadius = "8px";
      box.style.padding = "8px";

      const h = document.createElement("div");
      h.style.fontWeight = "700";
      h.style.marginBottom = "6px";
      h.textContent = title;
      box.appendChild(h);

      const selected = new Set(readJsonArr(key));
      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gridTemplateColumns = "1fr";
      list.style.gap = "6px";

      const sync = () => {
        const arr = Array.from(selected);
        hiddenInp.value = JSON.stringify(arr);
        writeJsonArr(key, arr);
      };

      for (const lib of libs) {
        const line = document.createElement("label");
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.gap = "8px";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(lib.Id);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(lib.Id);
          else selected.delete(lib.Id);
          sync();
        }, { passive: true });

        const t = document.createElement("span");
        t.textContent = lib.Name;

        line.appendChild(cb);
        line.appendChild(t);
        list.appendChild(line);
      }

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";

      const btnAll = document.createElement("button");
      btnAll.type = "button";
      btnAll.textContent = labels?.selectAll || "Hepsini seç";
      btnAll.addEventListener("click", () => {
        selected.clear();
        libs.forEach(l => selected.add(l.Id));
        [...list.querySelectorAll("input[type=checkbox]")].forEach(i => i.checked = true);
        sync();
      });

      const btnNone = document.createElement("button");
      btnNone.type = "button";
      btnNone.textContent = labels?.selectNone || "Hepsini kaldır";
      btnNone.addEventListener("click", () => {
        selected.clear();
        [...list.querySelectorAll("input[type=checkbox]")].forEach(i => i.checked = false);
        sync();
      });

      actions.appendChild(btnAll);
      actions.appendChild(btnNone);

      box.appendChild(list);
      box.appendChild(actions);

      sync();
      return box;
    };

    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowRecentSeries || "Görüntülemek istediğiniz son eklenen diziler için kütüphane seçin",
      "recentSeriesTvLibIds",
      hiddenRecentSeries
    ));
    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowRecentEpisodes || "Görüntülemek istediğiniz son eklenen bölüm kartları için kütüphane seçin",
      "recentEpisodesTvLibIds",
      hiddenRecentEpisodes
    ));
    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowContinueSeries || "Görüntülemek istediğiniz İzlemeye devam kartları için kütüphane seçin",
      "continueSeriesTvLibIds",
      hiddenContinueSeries
    ));
  })();

  const otherLibsHeading = document.createElement("div");
  otherLibsHeading.style.fontWeight = "800";
  otherLibsHeading.style.margin = "14px 0 6px";
  otherLibsHeading.textContent = labels?.otherLibrariesHeading || "Diğer Kütüphaneler";
  section.appendChild(otherLibsHeading);

  const enableOtherLibRows = createCheckbox(
    "enableOtherLibRows",
    labels?.enableOtherLibRows || "Diğer kütüphane bölümleirni göster (Son Eklenen / Devam / Bölüm)",
    !!config.enableOtherLibRows
  );
  section.appendChild(enableOtherLibRows);

  const otherLibBox = document.createElement("div");
  otherLibBox.style.paddingLeft = "8px";
  otherLibBox.style.borderLeft = "2px solid #0002";
  otherLibBox.style.marginBottom = "10px";
  section.appendChild(otherLibBox);

  const otherRecentCountWrap = createNumberInput(
    "otherLibrariesRecentCardCount",
    labels?.otherLibrariesRecentCardCount || "Diğer kütüphaneler • Son eklenen kart sayısı",
    Number.isFinite(config.otherLibrariesRecentCardCount) ? config.otherLibrariesRecentCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherRecentCountWrap);

  const otherContinueCountWrap = createNumberInput(
    "otherLibrariesContinueCardCount",
    labels?.otherLibrariesContinueCardCount || "Diğer kütüphaneler • İzlemeye devam kart sayısı",
    Number.isFinite(config.otherLibrariesContinueCardCount) ? config.otherLibrariesContinueCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherContinueCountWrap);

  const otherEpisodesCountWrap = createNumberInput(
    "otherLibrariesEpisodesCardCount",
    labels?.otherLibrariesEpisodesCardCount || "Diğer kütüphaneler • Son eklenen bölüm kart sayısı",
    Number.isFinite(config.otherLibrariesEpisodesCardCount) ? config.otherLibrariesEpisodesCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherEpisodesCountWrap);

  const hiddenOtherLibIds = (() => {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.id = "otherLibrariesIds";
    inp.name = "otherLibrariesIds";
    inp.value = JSON.stringify(readJsonArrGeneric("otherLibrariesIds"));
    return inp;
  })();
  otherLibBox.appendChild(hiddenOtherLibIds);

  const otherHint = document.createElement("div");
  otherHint.style.opacity = "0.85";
  otherHint.style.fontSize = "0.95em";
  otherHint.style.margin = "6px 0";
  otherHint.textContent = labels?.otherLibrariesHint || "Boş bırakırsan: tüm diğer kütüphaneler aktif sayılır.";
  otherLibBox.appendChild(otherHint);

  const otherGrid = document.createElement("div");
  otherGrid.style.display = "grid";
  otherGrid.style.gridTemplateColumns = "1fr";
  otherGrid.style.gap = "6px";
  otherLibBox.appendChild(otherGrid);

  const otherActions = document.createElement("div");
  otherActions.style.display = "flex";
  otherActions.style.gap = "8px";
  otherActions.style.marginTop = "8px";
  otherLibBox.appendChild(otherActions);

  const btnOtherAll = document.createElement("button");
  btnOtherAll.type = "button";
  btnOtherAll.textContent = labels?.selectAll || "Hepsini seç";
  otherActions.appendChild(btnOtherAll);

  const btnOtherNone = document.createElement("button");
  btnOtherNone.type = "button";
  btnOtherNone.textContent = labels?.selectNone || "Hepsini kaldır";
  otherActions.appendChild(btnOtherNone);

  const otherMasterCb = enableOtherLibRows?.querySelector?.('input[type="checkbox"]');
  function syncOtherBoxVisibility() {
    const on = !!otherMasterCb?.checked;
    otherLibBox.style.display = on ? "" : "none";
    if (!on) {
      hiddenOtherLibIds.value = "[]";
      writeJsonArrGeneric("otherLibrariesIds", []);
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(i => (i.checked = false));
    }
  }
  syncOtherBoxVisibility();
  enableOtherLibRows.addEventListener("change", syncOtherBoxVisibility, { passive: true });

  (async () => {
    const all = await fetchAllViews();
    const others = all.filter(v => {
      const ct = (v.CollectionType || "").toLowerCase();
      return !OTHER_CT_EXCLUDE.has(ct);
    });

    if (!others.length) {
      const warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels?.otherLibrariesNone || "Diğer kütüphane bulunamadı.";
      otherGrid.appendChild(warn);
      return;
    }

    const selected = new Set(readJsonArrGeneric("otherLibrariesIds"));
    const sync = () => {
      const arr = Array.from(selected);
      hiddenOtherLibIds.value = JSON.stringify(arr);
      writeJsonArrGeneric("otherLibrariesIds", arr);
    };

    for (const lib of others) {
      const line = document.createElement("label");
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.gap = "8px";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(lib.Id);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(lib.Id);
        else selected.delete(lib.Id);
        sync();
      }, { passive: true });

      const t = document.createElement("span");
      const ct = (lib.CollectionType || "").toLowerCase();
      const ctLabel = ct ? ` (${ct})` : "";
      t.textContent = `${lib.Name}${ctLabel}`;

      line.appendChild(cb);
      line.appendChild(t);
      otherGrid.appendChild(line);
    }

    btnOtherAll.addEventListener("click", () => {
      selected.clear();
      others.forEach(l => selected.add(l.Id));
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(i => (i.checked = true));
      sync();
    });

    btnOtherNone.addEventListener("click", () => {
      selected.clear();
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(i => (i.checked = false));
      sync();
    });

    sync();
  })();

  const becauseYouWatchedSection = createSection(
    labels?.becauseYouWatchedSettings ||
    config.languageLabels?.becauseYouWatchedSettings ||
    'İzlediğin İçin Öneriler'
  );

  const enableBecauseYouWatched = createCheckbox(
    'enableBecauseYouWatched',
    labels?.enableBecauseYouWatched || 'Öneri Bazlı Koleksiyonları Etkinleştir',
    config.enableBecauseYouWatched !== false
  );
  becauseYouWatchedSection.appendChild(enableBecauseYouWatched);

  const showPersonalRecsHeroCards = createCheckbox(
    'showPersonalRecsHeroCards',
    labels?.showPersonalRecsHeroCards || 'Hero kartını göster (İzlediğin İçin Öneriler)',
    config.showPersonalRecsHeroCards !== false
  );
  becauseYouWatchedSection.appendChild(showPersonalRecsHeroCards);

  const bywRowCountWrap = createNumberInput(
    'becauseYouWatchedRowCount',
    labels?.becauseYouWatchedRowCount || 'Ekranda gösterilecek Öneri sırası sayısı',
    Number.isFinite(config.becauseYouWatchedRowCount) ? config.becauseYouWatchedRowCount : 1,
    1,
    50
  );
  becauseYouWatchedSection.appendChild(bywRowCountWrap);

  const bywCardCountWrap = createNumberInput(
    'becauseYouWatchedCardCount',
    labels?.becauseYouWatchedCardCount || 'Her öneri sırası için kart sayısı',
    Number.isFinite(config.becauseYouWatchedCardCount) ? config.becauseYouWatchedCardCount : 10,
    1,
    20
  );
  becauseYouWatchedSection.appendChild(bywCardCountWrap);

  const genreSection = createSection(
    labels?.genreHubsSettings ||
    config.languageLabels?.genreHubsSettings ||
    'Tür Bazlı Koleksiyonlar'
  );

  const enableGenreHubs = createCheckbox(
    'enableGenreHubs',
    labels?.enableGenreHubs || 'Tür Bazlı Koleksiyonları Etkinleştir',
    !!config.enableGenreHubs
  );
  genreSection.appendChild(enableGenreHubs);

  const rowsCountWrap = createNumberInput(
    'studioHubsGenreRowsCount',
    labels?.studioHubsGenreRowsCount || 'Ekranda gösterilecek Tür sırası sayısı',
    Number.isFinite(config.studioHubsGenreRowsCount) ? config.studioHubsGenreRowsCount : 4,
    1,
    50
  );
  genreSection.appendChild(rowsCountWrap);

  const perRowCountWrap = createNumberInput(
    'studioHubsGenreCardCount',
    labels?.studioHubsGenreCardCount || 'Her Tür sırası için kart sayısı',
    Number.isFinite(config.studioHubsGenreCardCount) ? config.studioHubsGenreCardCount : 10,
    1,
    20
  );
  genreSection.appendChild(perRowCountWrap);

  const genreHidden = createHiddenInput('genreHubsOrder', JSON.stringify(Array.isArray(config.genreHubsOrder) ? config.genreHubsOrder : []));
  genreSection.appendChild(genreHidden);

  const { wrap: genreDndWrap, list: genreList } = createDraggableList('genreHubsOrderList', Array.isArray(config.genreHubsOrder) && config.genreHubsOrder.length ? config.genreHubsOrder : [], labels);
  genreSection.appendChild(genreDndWrap);

  (async () => {
    try {
      const ctrl = new AbortController(); panel.addEventListener('jms:cleanup', ()=>ctrl.abort(), {once:true});
      const genres = await fetchGenresForSettings(ctrl);
      const existing = new Set(
        [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name.toLowerCase())
      );
      let appended = 0;
      for (const g of genres) {
        const k = String(g).toLowerCase();
        if (!existing.has(k)) {
          existing.add(k);
          genreList.appendChild(createDnDItem(g, labels));
          appended++;
        }
      }
      if (appended > 0) {
        const names = [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
        genreHidden.value = JSON.stringify(names);
      }
    } catch (e) {
      console.warn("Tür listesi ayarlara eklenemedi:", e);
    }
  })();

  const refreshGenreHidden = () => {
    const names = [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
    genreHidden.value = JSON.stringify(names);
  };
  genreList.addEventListener("dragend", refreshGenreHidden);
  genreList.addEventListener("drop", refreshGenreHidden);
  genreList.addEventListener("click", (e) => {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshGenreHidden();
  });

  const dirSection = createSection(labels?.directorRowsSettings || 'Yönetmen Koleksiyon Ayarları');

  const enableDirectorRows = createCheckbox(
    'enableDirectorRows',
    labels?.enableDirectorRows || 'Yönetmen Koleksiyonlarını Etkinleştir',
    !!config.enableDirectorRows
  );
  dirSection.appendChild(enableDirectorRows);

  const showDirectorRowsHeroCards = createCheckbox(
    'showDirectorRowsHeroCards',
    labels?.showDirectorRowsHeroCards || 'Hero kartını göster (Yönetmen Koleksiyonları)',
    config.showDirectorRowsHeroCards !== false
  );
  dirSection.appendChild(showDirectorRowsHeroCards);

  const directorRowsUseTopGenres = createCheckbox(
    'directorRowsUseTopGenres',
    labels?.directorRowsUseTopGenres || 'En çok izlediğiniz filmlerin yönetmenlerini seç',
    config.directorRowsUseTopGenres !== false
  );
  dirSection.appendChild(directorRowsUseTopGenres);

  const dirCount = createNumberInput(
    'directorRowsCount',
    labels?.directorRowsCount || 'Yönetmen sayısı',
    Number.isFinite(config.directorRowsCount) ? config.directorRowsCount : 5,
    1, 50
  );
  dirSection.appendChild(dirCount);

  const dirPerRow = createNumberInput(
    'directorRowCardCount',
    labels?.directorRowCardCount || 'Her satırda kart sayısı',
    Number.isFinite(config.directorRowCardCount) ? config.directorRowCardCount : 10,
    1, 20
  );
  dirSection.appendChild(dirPerRow);

  const directorRowsMinItemsPerDirector = createNumberInput(
    'directorRowsMinItemsPerDirector',
    labels?.directorRowsMinItemsPerDirector || 'Minimum Yönetmen İçerik Sayısı',
    Number.isFinite(config.directorRowsMinItemsPerDirector) ? config.directorRowsMinItemsPerDirector : 10,
    1, 20
  );
  dirSection.appendChild(directorRowsMinItemsPerDirector);

  panel.appendChild(section);
  panel.appendChild(becauseYouWatchedSection);
  panel.appendChild(genreSection);
  panel.appendChild(dirSection);

  return panel;
}

async function fetchGenresForSettings(ctrl) {
  try {
    const url = `/Genres?Recursive=true&SortBy=SortName&SortOrder=Ascending&IncludeItemTypes=Movie,Series`;
    const data = await makeApiRequest(url, { signal: ctrl?.signal });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
    const names = [];
    for (const it of items) {
      const name = (it?.Name || "").trim();
      if (name) names.push(name);
    }
    return uniqueCaseInsensitive(names);
  } catch (e) {
    console.warn("fetchGenresForSettings hatası:", e);
    return [];
  }
}

function uniqueCaseInsensitive(list) {
  const seen = new Set();
  const out = [];
  for (const g of list) {
    const k = String(g).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
}
