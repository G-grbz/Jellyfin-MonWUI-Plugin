import { getSessionInfo, makeApiRequest, playNow, waitForAuthReadyStrict } from "/Plugins/JMSFusion/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import { setupScroller } from "./personalRecommendations.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { openDirRowsDB, makeScope, upsertItemsBatchIdle, getMeta, setMeta, getItemsByIds, } from "./recentRowsDb.js";
import {
  withServer,
  withServerSrcset,
  isKnownMissingImage,
  markImageMissing,
  clearMissingImage
} from "./jfUrl.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  bindManagedSectionsBelowNative,
  getLastNativeHomeSection,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
const UNIFIED_ROW_ITEM_LIMIT = 20;
const PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
const ENABLE_RECENT_MASTER = (config.enableRecentRows !== false);
const SHOW_RECENT_ROWS_HERO_CARDS = (config.showRecentRowsHeroCards !== false);
const ENABLE_RECENT_MOVIES   = ENABLE_RECENT_MASTER && (config.enableRecentMoviesRow !== false);
const ENABLE_RECENT_SERIES   = ENABLE_RECENT_MASTER && (config.enableRecentSeriesRow !== false);
const ENABLE_RECENT_EPISODES = ENABLE_RECENT_MASTER && (config.enableRecentEpisodesRow !== false);
const ENABLE_RECENT_MUSIC    = ENABLE_RECENT_MASTER && (config.enableRecentMusicRow !== false);
const ENABLE_RECENT_TRACKS   = ENABLE_RECENT_MASTER && (config.enableRecentMusicTracksRow !== false);
const DEFAULT_RECENT_ROWS_COUNT = 15;
const ENABLE_OTHER_LIB_ROWS = !!config.enableOtherLibRows;
const OTHER_RECENT_CARD_COUNT   = UNIFIED_ROW_ITEM_LIMIT;
const OTHER_CONTINUE_CARD_COUNT = UNIFIED_ROW_ITEM_LIMIT;
const OTHER_EP_CARD_COUNT       = UNIFIED_ROW_ITEM_LIMIT;
const RECENT_MOVIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
const RECENT_SERIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
const RECENT_EP_CARD_COUNT      = UNIFIED_ROW_ITEM_LIMIT;
const RECENT_MUSIC_CARD_COUNT   = UNIFIED_ROW_ITEM_LIMIT;
const RECENT_TRACKS_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;

const ENABLE_CONTINUE_MOVIES  = (config.enableContinueMovies !== false);
const CONT_MOVIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
const ENABLE_CONTINUE_SERIES  = (config.enableContinueSeries !== false);
const CONT_SERIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_RECENT_MOVIES_COUNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_RECENT_SERIES_COUNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_CONT_MOV_CNT  = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_CONT_SER_CNT  = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_RECENT_EP_CNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_RECENT_MUSIC_COUNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_RECENT_TRACKS_COUNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_OTHER_RECENT_CNT   = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_OTHER_CONTINUE_CNT = UNIFIED_ROW_ITEM_LIMIT;
const EFFECTIVE_OTHER_EP_CNT       = UNIFIED_ROW_ITEM_LIMIT;

const HOVER_MODE = (config.recentRowsHoverPreviewMode === "studioMini" || config.recentRowsHoverPreviewMode === "modal")
  ? config.recentRowsHoverPreviewMode
  : "inherit";
const RECENT_ROW_RENDER_CONCURRENCY = 2;
const IMAGE_RETRY_LIMITS = { lq: 2, hi: 2 };

function getLiveConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function clampPositiveCount(value, fallback) {
  return Number.isFinite(value) ? Math.max(1, value | 0) : fallback;
}

function getEffectiveRowCount(value) {
  return clampPositiveCount(value, UNIFIED_ROW_ITEM_LIMIT);
}

function getRecentRowsRuntimeConfig(source = getLiveConfig()) {
  const cfg = source || {};
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  const enableRecentMaster = homeSectionsConfig.enableRecentRows;

  return {
    showHeroCards: cfg.showRecentRowsHeroCards !== false,
    enableRecentMovies: enableRecentMaster && (cfg.enableRecentMoviesRow !== false),
    enableRecentSeries: enableRecentMaster && (cfg.enableRecentSeriesRow !== false),
    enableRecentEpisodes: enableRecentMaster && (cfg.enableRecentEpisodesRow !== false),
    enableRecentMusic: enableRecentMaster && (cfg.enableRecentMusicRow !== false),
    enableRecentTracks: enableRecentMaster && (cfg.enableRecentMusicTracksRow !== false),
    enableContinueMovies: homeSectionsConfig.enableContinueMovies,
    enableContinueSeries: homeSectionsConfig.enableContinueSeries,
    enableOtherLibRows: homeSectionsConfig.enableOtherLibRows,
    effectiveRecentMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMoviesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentSeriesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentEpisodesCardCount, 10)),
    effectiveRecentMusicCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMusicCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentTracksCount: getEffectiveRowCount(clampPositiveCount(cfg.recentTracksCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveContinueMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueMoviesCardCount, 10)),
    effectiveContinueSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueSeriesCardCount, 10)),
    effectiveOtherRecentCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesRecentCardCount, 10)),
    effectiveOtherContinueCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesContinueCardCount, 10)),
    effectiveOtherEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesEpisodesCardCount, 10)),
  };
}

const STATE = {
    started: false,
    wrapEl: null,
    serverId: null,
    userId: null,
    defaultTvHash: null,
    defaultMoviesHash: null,
    defaultMusicHash: null,
    movieLibs: [],
    tvLibs: [],
    otherLibs: [],
    db: null,
    scope: null,
};

const __albumPreviewTrackCache = new Map();

let __wrapInserted = false;
let __recentMountPromise = null;

const TTL_RECENT_MS   = Number.isFinite(config.recentRowsCacheTTLms) ? Math.max(5_000, config.recentRowsCacheTTLms|0) : 90_000;
const TTL_CONTINUE_MS = Number.isFinite(config.continueRowsCacheTTLms) ? Math.max(5_000, config.continueRowsCacheTTLms|0) : 45_000;

function metaKey(kind, type){ return `rr:${kind}:${type}`; }
function movieLibMetaSuffix(movieLibId){ return movieLibId ? `@movie:${movieLibId}` : ""; }
function tvLibMetaSuffix(tvLibId){ return tvLibId ? `@tv:${tvLibId}` : ""; }

function isRecentRowsHomeRoute() {
  const h = String(window.location.hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function setRecentRowsDone(done) {
  const next = !!done;
  let prev = false;
  try { prev = window.__jmsRecentRowsDone === true; } catch {}
  try { window.__jmsRecentRowsDone = next; } catch {}
  if (next && !prev) {
    try { document.dispatchEvent(new Event("jms:recent-rows-done")); } catch {}
  }
}

async function ensureRecentDb() {
  if (STATE.db && STATE.scope) return;
  try {
    const db = await openDirRowsDB();
    STATE.db = db;
    STATE.scope = makeScope({ serverId: STATE.serverId, userId: STATE.userId });
  } catch (e) {
    console.warn("recentRows: DB open error:", e);
    STATE.db = null;
    STATE.scope = null;
  }
}

async function readCachedList(kind, type, ttlMs) {
  if (!STATE.db || !STATE.scope) return { ids: [], fresh: false };
  try {
    const rec = await getMeta(STATE.db, metaKey(kind, type) + "|" + STATE.scope);
    const ids = Array.isArray(rec?.ids) ? Array.from(new Set(rec.ids.filter(Boolean))) : [];
    const updatedAt = Number(rec?.updatedAt) || 0;
    const fresh = (Date.now() - updatedAt) <= ttlMs;

    let liveIds = ids;
    try {
      const reconciled = await filterExistingCachedIds(ids);
      liveIds = reconciled.ids;
      if (reconciled.validated && !sameIdList(ids, liveIds)) {
        await writeCachedList(kind, type, liveIds);
      }
    } catch {}

    return { ids: liveIds, fresh };
  } catch { return { ids: [], fresh: false }; }
}

async function writeCachedList(kind, type, ids) {
  if (!STATE.db || !STATE.scope) return;
  try {
    await setMeta(STATE.db, metaKey(kind, type) + "|" + STATE.scope, {
      ids: (ids || []).filter(Boolean),
      updatedAt: Date.now(),
    });
  } catch {}
}

async function loadCachedRowItems(kind, type, ttlMs, { limit = 0, afterLoad = null } = {}) {
  const { ids, fresh } = await readCachedList(kind, type, ttlMs);
  if (!ids.length) return { items: [], fresh: false };

  const take = limit > 0 ? Math.max(1, limit | 0) : ids.length;
  const items = await fetchItemsByIds(ids.slice(0, take));
  if (typeof afterLoad === "function") {
    await afterLoad(items);
  }

  return {
    items: items.slice(0, take),
    fresh,
  };
}

async function filterExistingCachedIds(ids) {
  const clean = Array.isArray(ids)
    ? Array.from(new Set(ids.map((x) => String(x || "").trim()).filter(Boolean)))
    : [];
  if (!clean.length || !STATE.userId) return { ids: clean, validated: false };

  const out = new Set();
  const failed = new Set();
  let validated = false;
  const chunkSize = 80;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const url =
      `/Users/${encodeURIComponent(STATE.userId)}/Items?` +
      `Ids=${encodeURIComponent(chunk.join(","))}&Fields=Id`;
    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      validated = true;
      for (const it of items) {
        if (it?.Id) out.add(String(it.Id));
      }
    } catch {
      for (const id of chunk) failed.add(id);
    }
  }

  if (!validated) return { ids: clean, validated: false };
  return {
    ids: clean.filter((id) => out.has(id) || failed.has(id)),
    validated: true,
  };
}

function sameIdList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i=0;i<a.length;i++) if (a[i] !== b[i]) return false;
  return true;
}

(function ensurePerfCssOnce(){
  if (document.getElementById("recent-rows-perf-css")) return;
  const st = document.createElement("style");
})();

const COMMON_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "PrimaryImageTag",
  "ThumbImageTag",
  "BackdropImageTags",
  "BackdropImageTag",
  "LogoImageTag",
  "AlbumId",
  "AlbumPrimaryImageTag",
  "ParentBackdropItemId",
  "ParentBackdropImageTags",
  "SeriesBackdropImageTag",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "Overview",
  "UserData",
  "RemoteTrailers",
  "SeriesId",
  "SeriesName",
  "ParentId",
  "IndexNumber",
  "ParentIndexNumber"
].join(",");

function getRecentRowsCardTypeBadge(itemType) {
  const ll = config.languageLabels || {};
  switch (itemType) {
    case "Photo":
      return { label: ll.photo || labels.photo || "Fotoğraf", icon: "image" };
    case "PhotoAlbum":
      return { label: ll.photoAlbum || labels.photoAlbum || "Albüm", icon: "images" };
    case "Video":
      return { label: ll.video || labels.video || "Video", icon: "video" };
    case "Folder":
      return { label: ll.folder || labels.folder || "Klasör", icon: "folder" };
    case "Episode":
      return { label: ll.episode || labels.episode || "Bölüm", icon: "tv" };
    case "Season":
      return { label: ll.season || labels.season || "Sezon", icon: "layerGroup" };
    case "Series":
      return { label: ll.dizi || labels.dizi || "Dizi", icon: "tv" };
    case "MusicAlbum":
      return { label: ll.album || labels.album || "Albüm", icon: "compactDisc" };
    case "Audio":
      return { label: ll.track || labels.track || "Parça", icon: "music" };
    case "BoxSet":
      return {
        label: ll.collectionTitle || ll.boxset || labels.collectionTitle || labels.boxset || "Collection",
        icon: "layerGroup"
      };
    default:
      return { label: ll.film || labels.film || "Film", icon: "film" };
  }
}

function shouldPreferTaglessImages(item) {
  return item?.__preferTaglessImages === true;
}

function sanitizeResolvedId(value) {
  if (value == null) return null;
  const out = String(value).trim();
  if (!out || out === "undefined" || out === "null") return null;
  return out;
}

function resolveItemId(item) {
  return (
    sanitizeResolvedId(item?.Id) ||
    sanitizeResolvedId(item?.itemId) ||
    sanitizeResolvedId(item?.id) ||
    sanitizeResolvedId(item?.__posterSource?.Id) ||
    sanitizeResolvedId(item?.__posterSource?.itemId) ||
    sanitizeResolvedId(item?.__posterSource?.id) ||
    sanitizeResolvedId(item?.AlbumId) ||
    sanitizeResolvedId(item?.ParentBackdropItemId) ||
    sanitizeResolvedId(item?.ParentId) ||
    sanitizeResolvedId(item?.SeriesId) ||
    null
  );
}

function resolveItemName(item) {
  return String(
    item?.Name ||
    item?.SeriesName ||
    item?.__posterSource?.Name ||
    item?.__posterSource?.SeriesName ||
    ""
  ).trim();
}

function primeItemIdentity(item) {
  if (!item || typeof item !== "object") return { item, itemId: null, itemName: "" };
  const itemId = resolveItemId(item);
  const itemName = resolveItemName(item);
  if (itemId && !sanitizeResolvedId(item?.Id)) {
    try { item.Id = itemId; } catch {}
  }
  if (itemName && !item?.Name) {
    try { item.Name = itemName; } catch {}
  }
  if (item?.__posterSource && typeof item.__posterSource === "object") {
    const posterId = resolveItemId(item.__posterSource);
    if (posterId && !sanitizeResolvedId(item.__posterSource?.Id)) {
      try { item.__posterSource.Id = posterId; } catch {}
    }
  }
  return { item, itemId, itemName };
}

function getPrimaryImageCandidate(item) {
  const itemId = item?.Id || item?.AlbumId || null;
  const tag =
    item?.ImageTags?.Primary ||
    item?.PrimaryImageTag ||
    item?.AlbumPrimaryImageTag ||
    null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Primary", tag };
}

function getThumbImageCandidate(item) {
  const itemId = item?.Id || null;
  const tag = item?.ImageTags?.Thumb || item?.ThumbImageTag || null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Thumb", tag, aspectRatio: 16 / 9 };
}

function getBackdropImageCandidate(item) {
  const itemId = item?.ParentBackdropItemId || item?.Id || null;
  const tag =
    (Array.isArray(item?.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) ||
    (Array.isArray(item?.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item?.SeriesBackdropImageTag ||
    item?.BackdropImageTag ||
    item?.ImageTags?.Backdrop ||
    null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Backdrop", tag, aspectRatio: 16 / 9 };
}

function getPosterLikeImageCandidate(item) {
  return (
    getPrimaryImageCandidate(item) ||
    getThumbImageCandidate(item) ||
    getBackdropImageCandidate(item) ||
    null
  );
}

function buildCandidateImageUrl(item, candidate, height = 540, quality = 72, { omitTag = false } = {}) {
  if (!candidate?.itemId || !candidate?.imageType) return null;
  const skipTag = omitTag || shouldPreferTaglessImages(item);

  const parts = [];
  if (!skipTag && candidate.tag) parts.push(`tag=${encodeURIComponent(candidate.tag)}`);
  if (candidate.imageType === "Primary") {
    parts.push(`maxHeight=${height}`);
  } else {
    const aspectRatio = Number(candidate.aspectRatio) || (16 / 9);
    parts.push(`maxWidth=${Math.max(96, Math.round(height * aspectRatio))}`);
  }
  parts.push(`quality=${quality}`);
  parts.push(`EnableImageEnhancers=false`);

  return withServer(`/Items/${candidate.itemId}/Images/${candidate.imageType}?${parts.join("&")}`);
}

function buildPosterUrl(item, height = 540, quality = 72, { omitTag = false } = {}) {
  const candidate = getPosterLikeImageCandidate(item);
  return buildCandidateImageUrl(item, candidate, height, quality, { omitTag });
}

function buildPosterUrlHQ(item){ return buildPosterUrl(item, 540, 72); }

function buildPosterUrlLQ(item){ return buildPosterUrl(item, 80, 20); }

function toNoTagUrl(url) {
  if (!url) return "";
  const s = String(url);
  try {
    const u = new URL(s, window.location?.origin || "http://localhost");
    u.searchParams.delete("tag");
    return u.toString();
  } catch {
    const [base, q = ""] = s.split("?");
    if (!q) return s;
    const rest = q.split("&").filter(Boolean).filter(p => !/^tag=/i.test(p));
    return rest.length ? `${base}?${rest.join("&")}` : base;
  }
}

function toNoTagSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return "";
  return srcset
    .split(",")
    .map(part => {
      const p = part.trim();
      if (!p) return "";
      const m = p.match(/^(\S+)(\s+.+)?$/);
      if (!m) return p;
      return `${toNoTagUrl(m[1])}${m[2] || ""}`;
    })
    .filter(Boolean)
    .join(", ");
}

function promoteTaglessImageData(data) {
  if (!data || data.__taglessPromoted) return data;
  if (data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) data.lqSrc = data.lqSrcNoTag;
  if (data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) data.hqSrc = data.hqSrcNoTag;
  if (data.hqSrcsetNoTag && data.hqSrcsetNoTag !== data.hqSrcset) data.hqSrcset = data.hqSrcsetNoTag;
  data.__taglessPromoted = true;
  return data;
}

function markImageSettled(img, src, { disableRecovery = false } = {}) {
  if (!img) return;
  try { img.removeAttribute("srcset"); } catch {}
  if (src) {
    try { img.src = src; } catch {}
  }
  img.__phase = "settled";
  img.__hiRequested = false;
  img.classList.add("__hydrated");
  img.classList.remove("is-lqip");
  img.__hydrated = true;
  img.__disableRecovery = disableRecovery === true;
  if (disableRecovery) {
    try { __imgIO.unobserve(img); } catch {}
  }
}

function hasKnownMissingImage(data) {
  return !!(isKnownMissingImage(data?.lqSrc) || isKnownMissingImage(data?.hqSrc));
}

function markImageTerminalFailure(img, data, fallbackSrc = PLACEHOLDER_URL) {
  const brokenUrl = data?.lqSrc || data?.hqSrc || img?.currentSrc || img?.src || "";
  if (brokenUrl) markImageMissing(brokenUrl);
  markImageSettled(img, fallbackSrc, { disableRecovery: true });
  img.__disableHi = true;
}

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  const tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!item?.Id) return null;
  if (!tag) return null;
  const omitTag = shouldPreferTaglessImages(item);

  const base = `/Items/${item.Id}/Images/Logo`;
  const parts = [];
  if (!omitTag) parts.push(`tag=${encodeURIComponent(tag)}`);
  parts.push(`maxWidth=${width}`);
  parts.push(`quality=${quality}`);
  parts.push(`EnableImageEnhancers=false`);
  const qs = `?${parts.join("&")}`;
  const path = base + qs;

  return withServer(path);
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;
  const candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;
  const omitTag = shouldPreferTaglessImages(item);
  const base = `/Items/${candidate.itemId}/Images/Backdrop`;
  const parts = [];
  if (!omitTag && candidate.tag) parts.push(`tag=${encodeURIComponent(candidate.tag)}`);
  parts.push(`maxWidth=${width}`);
  parts.push(`quality=${quality}`);
  parts.push(`EnableImageEnhancers=false`);
  const qs = `?${parts.join("&")}`;
  const path = base + qs;

  return withServer(path);
}

function buildBackdropUrlLQ(item){ return buildBackdropUrl(item, 420, 25); }
function buildBackdropUrlHQ(item){ return buildBackdropUrl(item, 1920, 80); }

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

const __rIC = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));

function requestHiResImage(img) {
  if (!img || !img.isConnected) return;
  const data = img.__data || {};
  if (img.__disableRecovery === true || img.__disableHi === true || hasKnownMissingImage(data)) return;
  if (img.__hiRequested) return;
  if (!data.hqSrc) {
    markImageSettled(img, data.lqSrc || img.currentSrc || img.src || data.fallback || PLACEHOLDER_URL, { disableRecovery: true });
    return;
  }

  img.__pendingHi = false;
  img.__hiRequested = true;
  img.__phase = "hi";
  img.src = data.hqSrc;
  __rIC(() => {
    if (img.__hiRequested && data.hqSrcset) img.srcset = data.hqSrcset;
  });
}

function scheduleImgRetry(img, phase, delayMs) {
  if (!img || !img.isConnected) return false;
  const st = (img.__retryState ||= { lq: { tries: 0 }, hi: { tries: 0 } });
  const slot = st[phase] || (st[phase] = { tries: 0 });
  clearTimeout(slot.tid);
  if (img.__disableRecovery) return false;

  const limit = IMAGE_RETRY_LIMITS[phase] || 2;
  if ((slot.tries || 0) >= limit) return false;
  slot.tries = (slot.tries || 0) + 1;

  slot.tid = setTimeout(() => {
    if (!img || !img.isConnected) return;
    const data = img.__data || {};
    if (img.__disableRecovery || hasKnownMissingImage(data)) {
      markImageTerminalFailure(img, data, data.fallback || PLACEHOLDER_URL);
      return;
    }
    img.__fallbackRecoveryActive = false;

    try { img.removeAttribute("srcset"); } catch {}
    try { img.src = ""; } catch {}

    if (phase === "hi") {
      if (!data.hqSrc) return;
      img.__phase = "hi";
      img.__hiRequested = true;
      img.src = withCacheBust(data.hqSrc);
      __rIC(() => {
        if (data.hqSrcset) img.srcset = data.hqSrcset;
      });
      return;
    }

    if (!data.lqSrc) return;
    img.__phase = "lq";
    img.__hiRequested = false;
    img.src = withCacheBust(data.lqSrc);
  }, Math.max(250, Math.min(30_000, delayMs|0)));
  return true;
}

function buildPosterSrcSet(item) {
  const primaryCandidate = getPrimaryImageCandidate(item);
  if (!primaryCandidate) return "";

  const hs = [240, 360, 540];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  const omitTag = shouldPreferTaglessImages(item);

  const raw = hs
    .map(h => {
      const url = buildCandidateImageUrl(item, primaryCandidate, h, q, { omitTag });
      return url ? `${url} ${Math.round(h * ar)}w` : "";
    })
    .filter(Boolean)
    .join(", ");

  return withServerSrcset(raw);
}

let __imgIO = window.__JMS_RECENT_IMGIO;
if (!__imgIO) {
  __imgIO = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const img = ent.target;
      const data = img.__data || {};
      if (img.__disableRecovery === true || img.__disableHi === true || hasKnownMissingImage(data)) {
        continue;
      }
      if (data.lqSrc && img.__lqLoaded !== true) {
        img.__pendingHi = true;
        continue;
      }
      requestHiResImage(img);
    }
  }, { rootMargin: IS_MOBILE ? "400px 0px" : "600px 0px", threshold: 0.1 });
  window.__JMS_RECENT_IMGIO = __imgIO;
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;
  if (IS_MOBILE) {
    try { __imgIO.unobserve(img); } catch {}
    try { if (img.__onErr) img.removeEventListener("error", img.__onErr); } catch {}
    try { if (img.__onLoad) img.removeEventListener("load",  img.__onLoad); } catch {}
    delete img.__onErr;
    delete img.__onLoad;
    try {
      if (img.__retryState) {
        clearTimeout(img.__retryState.lq?.tid);
        clearTimeout(img.__retryState.hi?.tid);
      }
    } catch {}
    delete img.__retryState;
    delete img.__fallbackState;
    try { img.removeAttribute("srcset"); } catch {}
    const staticSrc = hqSrc || lqSrc || fb;
    const alreadyStatic = (img.__mobileStaticSrc === staticSrc && img.src === staticSrc);
    try { img.loading = "lazy"; } catch {}
    if (!alreadyStatic && img.src !== staticSrc) img.src = staticSrc;
    img.__mobileStaticSrc = staticSrc;
    img.classList.remove("is-lqip");
    img.classList.add("__hydrated");
    img.__phase = "static";
    img.__hiRequested = true;
    img.__disableHi = true;
    img.__hydrated = true;
    img.__lqLoaded = true;
    img.__pendingHi = false;
    return;
  }

  const lqSrcNoTag = toNoTagUrl(lqSrc);
  const hqSrcNoTag = toNoTagUrl(hqSrc);
  const hqSrcsetNoTag = toNoTagSrcset(hqSrcset);

  try { __imgIO.unobserve(img); } catch {}
  try { if (img.__onErr) img.removeEventListener("error", img.__onErr); } catch {}
  try { if (img.__onLoad) img.removeEventListener("load",  img.__onLoad); } catch {}

  img.__data = { lqSrc, hqSrc, hqSrcset, lqSrcNoTag, hqSrcNoTag, hqSrcsetNoTag, fallback: fb };
  img.__phase = "lq";
  img.__hiRequested = false;
  img.__fallbackState = { lqNoTagTried: false, hiNoTagTried: false };
  img.__lqLoaded = false;
  img.__pendingHi = false;
  delete img.__disableRecovery;
  delete img.__disableHi;

  try {
    img.removeAttribute("srcset");
    if (img.getAttribute("loading") !== "eager") img.loading = "lazy";
  } catch {}

  if (hasKnownMissingImage(img.__data)) {
    markImageSettled(img, fb, { disableRecovery: true });
    return;
  }

  img.src = lqSrc || fb;
  img.classList.add("is-lqip");
  try { img.classList.remove("__hydrated"); } catch {}
  img.__hydrated = false;

  const onError = () => {
  const data = img.__data || {};
  const fb = data.fallback || PLACEHOLDER_URL;
  const st = (img.__fallbackState ||= { lqNoTagTried: false, hiNoTagTried: false });

  try { img.removeAttribute("srcset"); } catch {}

  img.__hiRequested = false;
  if (img.__phase === "hi") {
    if (!st.hiNoTagTried && data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) {
      st.hiNoTagTried = true;
      promoteTaglessImageData(data);
      img.__phase = "hi";
      img.__hiRequested = true;
      img.src = withCacheBust(data.hqSrc);
      __rIC(() => {
        if (img.__hiRequested && data.hqSrcset) img.srcset = data.hqSrcset;
      });
      return;
    }

    img.classList.add("__hydrated");
    img.classList.remove("is-lqip");
    img.__hydrated = true;

    const delay = 800 * Math.min(6, (img.__retryState?.hi?.tries || 0) + 1);
    const queued = scheduleImgRetry(img, "hi", delay);
    if (!queued) {
      const settleSrc = data.lqSrc || img.currentSrc || img.src || fb;
      img.__disableHi = true;
      markImageSettled(img, settleSrc, { disableRecovery: true });
    }
  } else {
    if (!st.lqNoTagTried && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
      st.lqNoTagTried = true;
      promoteTaglessImageData(data);
      img.__phase = "lq";
      img.src = withCacheBust(data.lqSrc);
      return;
    }

    img.__fallbackRecoveryActive = true;
    try { img.src = fb; } catch {}
    const delay = 600 * Math.min(5, (img.__retryState?.lq?.tries || 0) + 1);
    const queued = scheduleImgRetry(img, "lq", delay);
    if (!queued) {
      markImageTerminalFailure(img, data, fb);
    }
  }
};

const onLoad = () => {
  const data = img.__data || {};
  const fallbackRecoveryActive = !!img.__fallbackRecoveryActive;

  if (img.__retryState && !fallbackRecoveryActive) {
    try { clearTimeout(img.__retryState.lq?.tid); } catch {}
    try { clearTimeout(img.__retryState.hi?.tid); } catch {}
    img.__retryState.lq && (img.__retryState.lq.tries = 0);
    img.__retryState.hi && (img.__retryState.hi.tries = 0);
  }

  if (img.__phase === "lq" && !fallbackRecoveryActive) {
    img.__lqLoaded = true;
    img.classList.add("__hydrated");
    img.classList.add("is-lqip");
    img.__hydrated = true;

    if (!data.hqSrc && !data.hqSrcset) {
      img.classList.remove("is-lqip");
      img.__phase = "settled";
      return;
    }

    if (img.__pendingHi) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!img.isConnected || img.__phase !== "lq" || img.__pendingHi !== true) return;
          requestHiResImage(img);
        });
      });
    }
    return;
  }

  if (img.__phase === "hi" || img.__phase === "settled" || fallbackRecoveryActive) {
    img.classList.add("__hydrated");
    img.classList.remove("is-lqip");
    img.__hydrated = true;
    img.__pendingHi = false;
  }

  const loadedSrc = img.currentSrc || img.src || "";
  if (loadedSrc && loadedSrc !== fb) {
    clearMissingImage(loadedSrc);
    clearMissingImage(data.lqSrc);
    clearMissingImage(data.hqSrc);
  }

  if (!fallbackRecoveryActive) {
    delete img.__fallbackRecoveryActive;
  }
};

  img.__onErr = onError;
  img.__onLoad = onLoad;
  img.addEventListener("error", onError, { passive:true });
  img.addEventListener("load",  onLoad,  { passive:true });
  __imgIO.observe(img);
}

function unobserveImage(img) {
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener("error", img.__onErr); } catch {}
  try { img.removeEventListener("load",  img.__onLoad); } catch {}
  delete img.__onErr; delete img.__onLoad;
  try { img.removeAttribute("srcset"); img.removeAttribute("src"); } catch {}
  try {
    if (img.__retryState) {
      clearTimeout(img.__retryState.lq?.tid);
      clearTimeout(img.__retryState.hi?.tid);
    }
  } catch {}
  delete img.__retryState;
  delete img.__fallbackState;
  delete img.__fallbackRecoveryActive;
  delete img.__disableRecovery;
  delete img.__disableHi;
  delete img.__lqLoaded;
  delete img.__pendingHi;
}

function retryRecoverableImages() {
  document.querySelectorAll("img.cardImage, img.dir-row-hero-bg").forEach((img) => {
    if (!img?.__data || !img.isConnected) return;
    if (img.__disableRecovery === true || hasKnownMissingImage(img.__data)) return;

    const hasRetries =
      !!((img.__retryState?.lq?.tries || 0) > 0 || (img.__retryState?.hi?.tries || 0) > 0);
    const shouldRetry =
      img.__fallbackRecoveryActive === true ||
      img.__hydrated === false ||
      hasRetries ||
      (img.complete && img.naturalWidth === 0);

    if (!shouldRetry) return;

    const { lqSrc, hqSrc, hqSrcset, fallback } = img.__data;
    try {
      hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback });
    } catch {}
  });
}

function formatRuntime(ticks) {
  if (!ticks) return null;
  const minutes = Math.floor(ticks / 600000000);
  if (minutes < 60) return `${minutes}d`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}s ${remainingMinutes}d` : `${hours}s`;
}

function getRuntimeWithIcons(runtime) {
  if (!runtime) return "";
  return runtime
    .replace(/(\d+)s/g, `$1${(config.languageLabels && config.languageLabels.sa) || "sa"}`)
    .replace(/(\d+)d/g, `$1${(config.languageLabels && config.languageLabels.dk) || "dk"}`);
}

function clampText(s, max = 220) {
  const t0 = String(s || "").replace(/\s+/g, " ").trim();
  if (!t0) return "";
  return t0.length > max ? (t0.slice(0, max - 1) + "…") : t0;
}

function escapeHtml(s){
  return String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function getDetailsUrl(itemId, serverId) {
  return `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}`;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function getPlaybackPercent(item) {
  const ud = item?.UserData || item?.UserDataDto || null;
  if (!ud) return 0;

  const p = Number(ud.PlayedPercentage);
  if (Number.isFinite(p) && p > 0) return clamp01(p / 100);

  const pos = Number(ud.PlaybackPositionTicks);
  if (!Number.isFinite(pos) || pos <= 0) return 0;

  const durTicks =
    (item?.Type === "Series" ? Number(item?.CumulativeRunTimeTicks) : Number(item?.RunTimeTicks)) ||
    Number(item?.RunTimeTicks) ||
    0;

  if (!Number.isFinite(durTicks) || durTicks <= 0) return 0;
  return clamp01(pos / durTicks);
}

function samePlaybackProgressByOrder(a, b, limit) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  const cap = Number.isFinite(limit) ? Math.max(0, limit | 0) : Math.max(left.length, right.length);
  const n = Math.min(cap, left.length, right.length);
  for (let i = 0; i < n; i++) {
    const pa = Math.round(getPlaybackPercent(left[i]) * 1000);
    const pb = Math.round(getPlaybackPercent(right[i]) * 1000);
    if (pa !== pb) return false;
  }
  return true;
}

const __hoverIntent = new WeakMap();
const __enterTimers = new WeakMap();
const __enterSeq     = new WeakMap();
const __cooldownUntil= new WeakMap();
const __openTokenMap = new WeakMap();
const __boundPreview = new WeakMap();

let __lastMoveTS = 0;
let __pmLast = 0;
window.addEventListener("pointermove", () => {
  const now = Date.now();
  if (now - __pmLast > 100) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});

let __touchStickyOpen = false;
let __touchLastOpenTS = 0;
const TOUCH_STICKY_GRACE_MS = 1200;

function hardWipeHoverModalDom() {
  const modal = document.querySelector(".video-preview-modal");
  if (!modal) return;
  try { modal.dataset.itemId = ""; } catch {}
  modal.querySelectorAll("img").forEach(img => {
    try { img.removeAttribute("src"); img.removeAttribute("srcset"); } catch {}
  });
  modal.querySelectorAll('[data-field="title"],[data-field="subtitle"],[data-field="meta"],[data-field="genres"]').forEach(el => {
    el.textContent = "";
  });
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound_recent) return;
  window.__jmsTouchCloserBound_recent = true;
  document.addEventListener("pointerdown", (e) => {
    if (!__touchStickyOpen) return;
    const inModal = e.target?.closest?.(".video-preview-modal");
    if (!inModal) {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (!__touchStickyOpen) return;
    if (e.key === "Escape") {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  });
})();

function isHoveringCardOrModal(cardEl) {
  try {
    const overCard  = cardEl?.isConnected && cardEl.matches(":hover");
    const overModal = !!document.querySelector(".video-preview-modal:hover");
    return !!(overCard || overModal);
  } catch { return false; }
}

function schedulePostOpenGuard(cardEl, token, delay=300) {
  setTimeout(() => {
    if (__openTokenMap.get(cardEl) !== token) return;
    if (!isHoveringCardOrModal(cardEl)) {
      try { safeCloseHoverModal(); } catch {}
    }
  }, delay);
}

function scheduleClosePollingGuard(cardEl, tries=4, interval=120) {
  let count = 0;
  const iid = setInterval(() => {
    count++;
    if (isHoveringCardOrModal(cardEl)) { clearInterval(iid); return; }
    if (Date.now() - __lastMoveTS > 120 || count >= tries) {
      try { safeCloseHoverModal(); } catch {}
      clearInterval(iid);
    }
  }, interval);
}

function clearEnterTimer(cardEl) {
  const t = __enterTimers.get(cardEl);
  if (t) { clearTimeout(t); __enterTimers.delete(cardEl); }
}

function safeOpenHoverModal(itemId, anchorEl) {
  if (typeof window.tryOpenHoverModal === "function") {
    try { window.tryOpenHoverModal(itemId, anchorEl, { bypass: true }); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.open === "function") {
    try { window.__hoverTrailer.open({ itemId, anchor: anchorEl, bypass: true }); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent("jms:hoverTrailer:open", { detail: { itemId, anchor: anchorEl, bypass: true }}));
}

function safeCloseHoverModal() {
  if (typeof window.closeHoverPreview === "function") {
    try { window.closeHoverPreview(); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.close === "function") {
    try { window.__hoverTrailer.close(); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent("jms:hoverTrailer:close"));
  try { hardWipeHoverModalDom(); } catch {}
}

function attachHoverTrailer(cardEl, itemLike) {
  const itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl?.dataset?.itemId);
  if (!cardEl || !itemId) return;
  if (!__enterSeq.has(cardEl)) __enterSeq.set(cardEl, 0);

  const onEnter = (e) => {
    const isTouch = e?.pointerType === "touch";
    const until = __cooldownUntil.get(cardEl) || 0;
    if (Date.now() < until) return;

    __hoverIntent.set(cardEl, true);
    clearEnterTimer(cardEl);

    const seq = (__enterSeq.get(cardEl) || 0) + 1;
    __enterSeq.set(cardEl, seq);

    const timer = setTimeout(() => {
      if ((__enterSeq.get(cardEl) || 0) !== seq) return;
      if (!__hoverIntent.get(cardEl)) return;
      if (!isTouch) {
        if (!cardEl.isConnected || !cardEl.matches(":hover")) return;
      }
      try { window.dispatchEvent(new Event("closeAllMiniPopovers")); } catch {}

      const token = (Date.now() ^ Math.random()*1e9) | 0;
      __openTokenMap.set(cardEl, token);

      try { hardWipeHoverModalDom(); } catch {}
      safeOpenHoverModal(itemId, cardEl);

      if (isTouch) {
        __touchStickyOpen = true;
        __touchLastOpenTS = Date.now();
      }
      if (!isTouch) schedulePostOpenGuard(cardEl, token, 300);
    }, OPEN_HOVER_DELAY_MS);

    __enterTimers.set(cardEl, timer);
  };

  const onLeave = (e) => {
    const isTouch = e?.pointerType === "touch";
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);

    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) return;
      return;
    }

    const rt = e?.relatedTarget || null;
    const goingToModal = !!(rt && (rt.closest ? rt.closest(".video-preview-modal") : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 4, 120);
  };

  cardEl.addEventListener("pointerenter", onEnter, { passive: true });
  cardEl.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") onEnter(e); }, { passive: true });
  cardEl.addEventListener("pointerleave", onLeave,  { passive: true });
  __boundPreview.set(cardEl, { mode: "modal", onEnter, onLeave });
}

function detachPreviewHandlers(cardEl) {
  const rec = __boundPreview.get(cardEl);
  if (!rec) return;
  try { cardEl.removeEventListener("pointerenter", rec.onEnter); } catch {}
  try { cardEl.removeEventListener("pointerleave", rec.onLeave); } catch {}
  clearEnterTimer(cardEl);
  __hoverIntent.delete(cardEl);
  __openTokenMap.delete(cardEl);
  __boundPreview.delete(cardEl);
}

function attachPreviewByMode(cardEl, itemLike, mode) {
  detachPreviewHandlers(cardEl);
  const itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl?.dataset?.itemId);
  if (!itemId) return;
  const normalizedItem = { ...(itemLike || {}), Id: itemId, Name: resolveItemName(itemLike) };
  if (mode === "studioMini") {
    attachMiniPosterHover(cardEl, normalizedItem);
    __boundPreview.set(cardEl, { mode: "studioMini", onEnter: ()=>{}, onLeave: ()=>{} });
  } else {
    attachHoverTrailer(cardEl, normalizedItem);
  }
}

function gotoHash(hash) {
  const sid = (STATE.serverId || getSessionInfo()?.serverId || "").toString();
  const fixed = ensureServerIdInHash(hash, sid);
  try { window.location.hash = fixed; }
  catch { try { window.location.href = fixed; } catch {} }
}

function ensureServerIdInHash(hash, serverId) {
  if (!hash) return hash;
  if (!serverId) return hash;
  if (/\bserverId=/.test(hash)) return hash;
  if (!hash.startsWith("#/")) return hash;
  const sep = hash.includes("?") ? "&" : "?";
  return `${hash}${sep}serverId=${encodeURIComponent(serverId)}`;
}

const DEFAULT_TV_PAGE = "#/tv";
const DEFAULT_MOVIES_PAGE = "#/movies";
const DEFAULT_MUSIC_PAGE = "#/music";

async function resolveDefaultPages(userId) {
  try {
    const data = await makeApiRequest(`/Users/${userId}/Views`);
    const items = Array.isArray(data?.Items) ? data.Items : [];

    const movieLibs = items.filter(x => (x?.CollectionType === "movies")).map(x => ({
      Id: x?.Id,
      Name: x?.Name || "",
      CollectionType: x?.CollectionType
    })).filter(x => x.Id);
    STATE.movieLibs = movieLibs;

    const tvLibs = items.filter(x => (x?.CollectionType === "tvshows")).map(x => ({
      Id: x?.Id,
      Name: x?.Name || "",
      CollectionType: x?.CollectionType
    })).filter(x => x.Id);
    STATE.tvLibs = tvLibs;

    const other = items
      .filter(x => x?.Id)
      .map(x => ({
        Id: x.Id,
        Name: x.Name || "",
        CollectionType: (x.CollectionType || "").toString()
      }))
      .filter(x => {
        const ct = (x.CollectionType || "").toLowerCase();
        return ct !== "movies" && ct !== "tvshows" && ct !== "music";
      });
    STATE.otherLibs = other;

    const tvLib = tvLibs[0] || null;
    const movLib = movieLibs[0] || null;
    const musicLib = items.find(x => (x?.CollectionType === "music")) || null;

    if (tvLib?.Id) {
      STATE.defaultTvHash = `#/tv?topParentId=${encodeURIComponent(tvLib.Id)}&collectionType=tvshows&tab=1`;
    }
    if (movLib?.Id) {
      STATE.defaultMoviesHash = `#/movies?topParentId=${encodeURIComponent(movLib.Id)}&collectionType=movies&tab=1`;
    }
    if (musicLib?.Id) {
      STATE.defaultMusicHash = `#/music?topParentId=${encodeURIComponent(musicLib.Id)}&collectionType=music&tab=1`;
    }
  } catch (e) {
    console.warn("recentRows: resolveDefaultPages error:", e);
  }
}

function readJsonArrayLs(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw === "[object Object]") return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map(x => String(x || "").trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function getSelectedTvLibIds(kind) {
  const k =
    kind === "recentSeries"   ? "recentSeriesTvLibIds" :
    kind === "recentEpisodes" ? "recentEpisodesTvLibIds" :
    kind === "continueSeries" ? "continueSeriesTvLibIds" :
    "";
  if (!k) return [];

  const fromLs = readJsonArrayLs(k);
  if (fromLs && fromLs.length) return fromLs;

  const cfg = getConfig?.() || {};
  const fromCfg =
    kind === "recentSeries"   ? cfg.recentSeriesTvLibIds :
    kind === "recentEpisodes" ? cfg.recentEpisodesTvLibIds :
    kind === "continueSeries" ? cfg.continueSeriesTvLibIds :
    null;
  return Array.isArray(fromCfg) ? fromCfg.map(x => String(x||"").trim()).filter(Boolean) : [];
}

function getSelectedMovieLibIds() {
  const fromLs = readJsonArrayLs("recentMoviesLibIds");
  if (fromLs && fromLs.length) return fromLs;

  const cfg = getConfig?.() || {};
  const fromCfg = cfg.recentMoviesLibIds;
  return Array.isArray(fromCfg) ? fromCfg.map(x => String(x || "").trim()).filter(Boolean) : [];
}

function resolveMovieLibSelection() {
  const all = (STATE.movieLibs || []).map(x => x.Id).filter(Boolean);
  if (!all.length) return [];
  const sel = getSelectedMovieLibIds();
  const filtered = sel.filter(id => all.includes(id));
  return filtered.length ? filtered : all;
}

function resolveTvLibSelection(kind) {
  const all = (STATE.tvLibs || []).map(x => x.Id).filter(Boolean);
  if (!all.length) return [];
  const sel = getSelectedTvLibIds(kind);
  const filtered = sel.filter(id => all.includes(id));
  return filtered.length ? filtered : all;
}

function getSelectedOtherLibIds() {
  const fromLs = readJsonArrayLs("otherLibrariesIds");
  if (fromLs && fromLs.length) return fromLs;
  const cfg = getConfig?.() || {};
  const fromCfg = cfg.otherLibrariesIds || cfg.otherLibIds || null;
  return Array.isArray(fromCfg) ? fromCfg.map(x => String(x||"").trim()).filter(Boolean) : [];
}

function resolveOtherLibSelection() {
  const all = (STATE.otherLibs || []).map(x => x.Id).filter(Boolean);
  if (!all.length) return [];
  const sel = getSelectedOtherLibIds();
  const filtered = sel.filter(id => all.includes(id));
  return filtered.length ? filtered : all;
}

function getTvHashFallback() {
  return (
    config.latestSeriesHash ||
    config.resumeSeriesHash ||
    STATE.defaultTvHash ||
    DEFAULT_TV_PAGE
  );
}

function getMoviesHashFallback() {
  return (
    config.latestMoviesHash ||
    config.resumeMoviesHash ||
    STATE.defaultMoviesHash ||
    DEFAULT_MOVIES_PAGE
  );
}

function getMoviesLibraryHash(libId) {
  return `#/movies?topParentId=${encodeURIComponent(libId)}&collectionType=movies&tab=1`;
}

function getMusicHashFallback() {
  return (
    config.latestMusicHash ||
    STATE.defaultMusicHash ||
    DEFAULT_MUSIC_PAGE
  );
}

function openLatestPage(type) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  if (type === "MusicAlbum" || type === "Audio") {
    gotoHash(getMusicHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function openResumePage(type) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function createRecommendationCard(item, serverId, { aboveFold=false, showProgress=false } = {}) {
  const { itemId, itemName } = primeItemIdentity(item);
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  if (itemId) card.dataset.itemId = itemId;

  const posterSource = item?.__posterSource || item;

  const posterUrlHQ = buildPosterUrlHQ(posterSource);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(posterSource) : "";
  const posterUrlLQ = buildPosterUrlLQ(posterSource);

  const year = item.ProductionYear || posterSource.ProductionYear || "";
  const ageChip = formatOfficialRatingLabel(item.OfficialRating || posterSource.OfficialRating || "");

  const runtimeTicks =
    item.Type === "Series" ? item.CumulativeRunTimeTicks :
    item.Type === "Episode" ? item.RunTimeTicks :
    item.RunTimeTicks;

  const runtime = formatRuntime(runtimeTicks);

  const genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 2).join(", ") : "";
  const isEpisode = item.Type === "Episode";
  const isSeason  = item.Type === "Season";
  const { label: typeLabel, icon: typeIcon } = getRecentRowsCardTypeBadge(item.Type);

  const community = Number.isFinite(posterSource.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${posterSource.CommunityRating.toFixed(1)}</div>`
    : "";

  const progress = showProgress ? getPlaybackPercent(item) : 0;
  const progressHtml = (showProgress && progress > 0.02 && progress < 0.999)
    ? `<div class="rr-progress-wrap" aria-label="${escapeHtml(config.languageLabels.progress || "İlerleme")}">
         <div class="rr-progress-bar" style="width:${Math.round(progress*100)}%"></div>
       </div>`
    : "";

  const mainTitle =
    (isEpisode || isSeason)
      ? (item.Name || posterSource.Name || item.SeriesName || "")
      : (item.Name || "");

  const subTitle =
    isEpisode ? formatEpisodeSubline(item) :
    isSeason  ? formatSeasonSubline(item) :
    "";

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${itemId ? getDetailsUrl(itemId, serverId) : '#'}">
        <div class="cardImageContainer" style="position:relative;">
          <img class="cardImage"
            alt="${escapeHtml(mainTitle)}"
            loading="${aboveFold ? "eager" : "lazy"}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ""}>
          <div class="prc-top-badges">
            ${community}
            <div class="prc-type-badge">
              ${faIconHtml(typeIcon, "prc-type-icon")}
              ${typeLabel}
            </div>
          </div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-titleline">
              ${escapeHtml(clampText(mainTitle, 42))}
              ${isEpisode && subTitle ? `<div class="prc-subtitleline">${escapeHtml(subTitle)}</div>` : ``}
            </div>

            <div class="prc-meta">
              ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
              ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
              ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
            </div>

            <div class="prc-genres">
              ${(!isEpisode && genres) ? escapeHtml(genres) : ""}
            </div>
          </div>
          ${progressHtml}
        </div>
      </a>
    </div>
  `;

  const img = card.querySelector(".cardImage");
  try {
    const sizesMobile = "(max-width: 640px) 45vw, (max-width: 820px) 38vw, 200px";
    const sizesDesk   = "(max-width: 1200px) 20vw, 200px";
    img.setAttribute("sizes", IS_MOBILE ? sizesMobile : sizesDesk);
  } catch {}

  const cardLink = card.querySelector(".cardLink");
  if (cardLink) {
    cardLink.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!itemId) return;
      const hostEl = card.querySelector(".cardImageContainer");
      const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
      try {
        await openDetailsModal({
          itemId,
          serverId,
          preferBackdropIndex: backdropIndex,
          originEl: hostEl?.querySelector?.("img.cardImage") || hostEl || card,
          originEvent: e,
        });
      } catch (err) {
        console.warn("openDetailsModal failed (recent card):", err);
      }
    }, { passive: false });
  }

  if (posterUrlHQ) {
    hydrateBlurUp(img, { lqSrc: posterUrlLQ, hqSrc: posterUrlHQ, hqSrcset: posterSetHQ, fallback: PLACEHOLDER_URL });
  } else {
    try { img.style.display = "none"; } catch {}
    const noImg = document.createElement("div");
    noImg.className = "prc-noimg-label";
    noImg.textContent = config.languageLabels.noImage || "Görsel yok";
    noImg.style.minHeight = "200px";
    noImg.style.display = "flex";
    noImg.style.alignItems = "center";
    noImg.style.justifyContent = "center";
    noImg.style.textAlign = "center";
    noImg.style.padding = "12px";
    noImg.style.fontWeight = "600";
    card.querySelector(".cardImageContainer")?.prepend(noImg);
  }

  const mode = (HOVER_MODE === "inherit")
    ? (getConfig()?.globalPreviewMode === "studioMini" ? "studioMini" : "modal")
    : HOVER_MODE;

  setTimeout(() => {
    if (card.isConnected) attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode);
  }, 500);

  card.addEventListener("dblclick", (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (itemId && typeof playNow === "function") playNow(itemId);
    } catch {}
  });

  card.addEventListener("jms:cleanup", () => { unobserveImage(img); }, { once:true });
  return card;
}

function formatEpisodeLabel(ep) {
  if (!ep) return "";
  const s = Number(ep.ParentIndexNumber);
  const e = Number(ep.IndexNumber);
  const sTxt = Number.isFinite(s) && s > 0 ? `S${String(s).padStart(2,"0")}` : "";
  const eTxt = Number.isFinite(e) && e > 0 ? `E${String(e).padStart(2,"0")}` : "";
  const se = (sTxt || eTxt) ? `${sTxt}${eTxt ? ` • ${eTxt}` : ""}` : "";
  const name = ep.Name ? clampText(ep.Name, 38) : "";
  return se && name ? `${se} • ${name}` : (se || name || "");
}

function formatSeasonLabel(season) {
  if (!season) return "";
  const s = Number(season.IndexNumber);
  const sTxt = Number.isFinite(s) && s > 0 ? `S${String(s).padStart(2,"0")}` : "";
  const name = season.Name ? clampText(season.Name, 38) : "";
  return sTxt && name ? `${sTxt} • ${name}` : (sTxt || name || "");
}

function formatEpisodeSubline(ep) {
  if (!ep) return "";

  const s = Number(ep.ParentIndexNumber);
  const e = Number(ep.IndexNumber);

  const sTxt = Number.isFinite(s) && s > 0 ? `S${String(s).padStart(2,"0")}` : "";
  const eTxt = Number.isFinite(e) && e > 0 ? `E${String(e).padStart(2,"0")}` : "";

  const se = (sTxt || eTxt) ? `${sTxt}${eTxt ? ` • ${eTxt}` : ""}` : "";
  const series = (ep.SeriesName || "").trim();

  if (series && se) return `${series} • ${se}`;
  return series || se || "";
}

function formatSeasonSubline(season) {
  if (!season) return "";

  const s = Number(season.IndexNumber);
  const sTxt = Number.isFinite(s) && s > 0 ? `S${String(s).padStart(2,"0")}` : "";
  const series = (season.SeriesName || "").trim();

  if (series && sTxt) return `${series} • ${sTxt}`;
  return series || sTxt || "";
}

function getSeriesIdFromItem(it) {
  if (!it) return null;
  if (it.Type === "Episode") return it.SeriesId || null;
  if (it.Type === "Season") return it.SeriesId || it.ParentId || null;

  return null;
}

function isAudioPreviewItem(item) {
  if (!item) return false;
  const type = String(item.Type || "");
  return type === "Audio" || type === "MusicVideo";
}

function getMusicAlbumId(item) {
  if (!item) return null;
  if (item.Type === "MusicAlbum") return item.Id || null;
  if (isAudioPreviewItem(item)) return item.AlbumId || item.ParentId || null;
  return null;
}

async function attachMusicPosterSources(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return list;

  const albumIds = [];
  for (const it of list) {
    if (!it?.Id) continue;
    if (it.Type === "MusicAlbum") {
      it.__posterSource = it;
      continue;
    }
    if (!isAudioPreviewItem(it)) continue;
    const albumId = getMusicAlbumId(it);
    if (albumId) albumIds.push(albumId);
  }

  const uniqAlbumIds = Array.from(new Set(albumIds.filter(Boolean)));
  if (!uniqAlbumIds.length) return list;

  let albums = [];
  try {
    albums = await fetchItemsByIds(uniqAlbumIds);
  } catch (e) {
    console.warn("recentRows: music poster source resolve error:", e);
    return list;
  }

  const albumById = new Map((albums || []).filter(x => x?.Id).map(x => [x.Id, x]));
  for (const it of list) {
    if (!it?.Id || !isAudioPreviewItem(it) || it.__posterSource) continue;
    const albumId = getMusicAlbumId(it);
    const album = albumId ? albumById.get(albumId) : null;
    if (album) it.__posterSource = album;
  }
  return list;
}

async function fetchAlbumPreviewTrackId(albumId) {
  const key = String(albumId || "").trim();
  if (!key || !STATE.userId) return null;
  if (__albumPreviewTrackCache.has(key)) {
    return await __albumPreviewTrackCache.get(key);
  }

  const task = (async () => {
    const url =
      `/Users/${STATE.userId}/Items?` +
      `ParentId=${encodeURIComponent(key)}&` +
      `IncludeItemTypes=Audio&Recursive=true&` +
      `Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
      `EnableUserData=true&` +
      `SortBy=ParentIndexNumber,IndexNumber,SortName,DateCreated&SortOrder=Ascending&Limit=1&` +
      `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
    try {
      const data = await makeApiRequest(url);
      const best = Array.isArray(data?.Items) ? data.Items.find(x => x?.Id) : null;
      try {
        if (best?.Id && STATE.db && STATE.scope) {
          upsertItemsBatchIdle(STATE.db, STATE.scope, [best], { timeout: 1500 });
        }
      } catch {}
      return best?.Id || null;
    } catch (e) {
      console.warn("recentRows: album preview track resolve error:", e);
      return null;
    }
  })();

  __albumPreviewTrackCache.set(key, task);
  const resolved = await task;
  __albumPreviewTrackCache.set(key, resolved);
  return resolved;
}

async function resolveHeroPreviewItemId(item) {
  const itemId = resolveItemId(item);
  if (!itemId) return null;
  if (isAudioPreviewItem(item)) return itemId;
  if (item.Type === "MusicAlbum") {
    return await fetchAlbumPreviewTrackId(itemId);
  }
  return itemId;
}

async function createRowHeroCard(item, serverId, labelText, { showProgress = false } = {}) {
  const { itemId } = primeItemIdentity(item);
  const hero = document.createElement("div");
  hero.className = "dir-row-hero";
  if (itemId) hero.dataset.itemId = itemId;

  try {
    await attachMusicPosterSources([item]);
  } catch {}

  const posterSource = item?.__posterSource || item;
  const bgLQ = buildBackdropUrlLQ(posterSource) || buildPosterUrlLQ(posterSource) || null;
  const bgHQ = buildBackdropUrlHQ(posterSource) || buildPosterUrlHQ(posterSource) || null;
  const logo = buildLogoUrl(posterSource);
  const year = posterSource.ProductionYear || "";
  const plot = clampText(item.Overview || posterSource.Overview, 1200);
  const ageChip = formatOfficialRatingLabel(posterSource.OfficialRating || "");
  const isSeries = posterSource.Type === "Series";
  const isEpisode = item.Type === "Episode";
  const isSeason  = item.Type === "Season";
  const isMusicAlbum = item.Type === "MusicAlbum";
  const isAudio = isAudioPreviewItem(item);
  const isPhoto = item.Type === "Photo";
  const isPhotoAlbum = item.Type === "PhotoAlbum";
  const isVideo = item.Type === "Video";
  const isFolder = item.Type === "Folder";

  const runtimeTicks =
    item.Type === "Series" ? (item.CumulativeRunTimeTicks || posterSource.CumulativeRunTimeTicks) :
    item.Type === "Episode" ? (item.RunTimeTicks || posterSource.RunTimeTicks) :
    (item.RunTimeTicks || posterSource.RunTimeTicks);

  const runtime = formatRuntime(runtimeTicks);
  const heroProgress = showProgress ? getPlaybackPercent(item) : 0;
  const heroProgressPct = Math.round(heroProgress * 100);
  const heroProgressHtml = (showProgress && heroProgress > 0.02 && heroProgress < 0.999)
    ? `
      <div class="dir-hero-progress-wrap" aria-label="${escapeHtml(config.languageLabels.progress || "İlerleme")}">
        <div class="dir-hero-progress-bar" style="width:${heroProgressPct}%"></div>
      </div>
      <div class="dir-hero-progress-pct">${heroProgressPct}%</div>
    `
    : "";

  const typeLabel =
    isPhoto ? (config.languageLabels.photo || "Fotoğraf") :
    isPhotoAlbum ? (config.languageLabels.photoAlbum || "Albüm") :
    isMusicAlbum ? (config.languageLabels.album || "Albüm") :
    isAudio ? (config.languageLabels.track || "Parça") :
    isVideo ? (config.languageLabels.video || "Video") :
    isFolder ? (config.languageLabels.folder || "Klasör") :
    isEpisode ? (config.languageLabels.episode || "Bölüm") :
    isSeries ? (config.languageLabels.dizi || "Dizi") :
    (config.languageLabels.film || "Film");

  const heroSub = isEpisode ? formatEpisodeLabel(item) : (isSeason ? formatSeasonLabel(item) : "");
  const genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 3).join(", ") : "";
  const runtimeWithIcons = runtime ? getRuntimeWithIcons(runtime) : "";
  const heroMetaItems = [];
  if (heroSub) {
    heroMetaItems.push({ text: heroSub, variant: "subline" });
  } else {
    if (ageChip) heroMetaItems.push({ text: ageChip, variant: "age" });
    if (year) heroMetaItems.push({ text: year, variant: "year" });
    if (runtimeWithIcons) heroMetaItems.push({ text: runtimeWithIcons, variant: "runtime" });
    if (genres) heroMetaItems.push({ text: genres, variant: "genres" });
  }
  const metaHtml = heroMetaItems.length
    ? heroMetaItems
        .map(({ text, variant }) =>
          `<span class="dir-row-hero-meta dir-row-hero-meta--${variant}">${escapeHtml(text)}</span>`
        )
        .join("")
    : "";
  const heroTitle =
    (isEpisode || isSeason)
      ? (item.SeriesName || posterSource.Name || item.Name)
      : (isAudio ? (item.Name || posterSource.Name || "") : (posterSource.Name || item.Name || ""));

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg"
           alt="${escapeHtml(heroTitle)}"
           decoding="async"
           loading="${IS_MOBILE ? "eager" : "lazy"}"
           ${IS_MOBILE ? 'fetchpriority="high"' : ""}>
    </div>

    <div class="dir-row-hero-inner">
      <div class="dir-row-hero-meta-container">
        <div class="dir-row-hero-label">${escapeHtml(labelText || "")}</div>

        ${logo ? `
          <div class="dir-row-hero-logo">
            <img src="${logo}" alt="${escapeHtml(heroTitle)} logo">
          </div>
        ` : ``}

        <div class="dir-row-hero-title">${escapeHtml(heroTitle)}</div>

        ${metaHtml ? `<div class="dir-row-hero-submeta">${metaHtml}</div>` : ""}

        ${plot ? `<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>` : ""}

      </div>
    </div>
    ${heroProgressHtml}
  `;

  const openDetails = async (e) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch {}
    const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    const originEl = hero.querySelector(".dir-row-hero-bg") || hero;
    try {
      if (!itemId) return;
      await openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex: backdropIndex,
        originEl,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (recent hero):", err);
    }
  };

  hero.addEventListener("click", openDetails);
  hero.tabIndex = 0;
  hero.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openDetails(e);
  });
  hero.classList.add("active");

  try {
    const backdropImg = hero.querySelector(".dir-row-hero-bg");
    if (backdropImg) {
      if (bgHQ || bgLQ) {
        hydrateBlurUp(backdropImg, {
          lqSrc: bgLQ,
          hqSrc: bgHQ || PLACEHOLDER_URL,
          hqSrcset: "",
          fallback: PLACEHOLDER_URL
        });
      } else {
        backdropImg.src = PLACEHOLDER_URL;
        backdropImg.classList.add("__hydrated");
      }
    }
  } catch (e) {
    console.warn("recentRows hero bg hydrate failed:", e);
  }

  try {
    const backdropImg = hero.querySelector(".dir-row-hero-bg");
    const RemoteTrailers =
      posterSource.RemoteTrailers ||
      posterSource.RemoteTrailerItems ||
      posterSource.RemoteTrailerUrls ||
      [];
    const previewItemId = await resolveHeroPreviewItemId(item);

    createTrailerIframe({
      config,
      RemoteTrailers,
      slide: hero,
      backdropImg,
      itemId,
      previewItemId: previewItemId || itemId,
      serverId,
      detailsUrl: itemId ? getDetailsUrl(itemId, serverId) : "#",
      detailsText: config.languageLabels.details || "Ayrıntılar",
      showDetailsOverlay: false,
    });
  } catch (err) {
    console.error("RecentRows hero createTrailerIframe hata:", err);
  }

  hero.addEventListener("jms:cleanup", () => {
    try {
      const backdropImg = hero.querySelector(".dir-row-hero-bg");
      if (backdropImg) unobserveImage(backdropImg);
    } catch {}
    detachPreviewHandlers(hero);
  }, { once: true });

  return hero;
}

function renderSkeletonRow(row, count) {
  row.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (let i=0; i<count; i++) {
    const el = document.createElement("div");
    el.className = "card personal-recs-card skeleton";
    el.innerHTML = `
      <div class="cardBox">
        <div class="cardImageContainer">
          <div class="cardImage"></div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-meta">
              <span class="skeleton-line" style="width:42px;height:18px;border-radius:999px;"></span>
              <span class="prc-dot">•</span>
              <span class="skeleton-line" style="width:38px;height:12px;"></span>
              <span class="prc-dot">•</span>
              <span class="skeleton-line" style="width:38px;height:12px;"></span>
            </div>
            <div class="prc-genres">
              <span class="skeleton-line" style="width:90px;height:12px;"></span>
            </div>
          </div>
        </div>
      </div>
    `;
    fragment.appendChild(el);
  }
  row.appendChild(fragment);
}

function uniqById(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it?.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
  }
  return out;
}

function pickRandomIndex(n) {
  if (!Number.isFinite(n) || n <= 0) return -1;
  return Math.floor(Math.random() * n);
}

async function fetchRecent(userId, type, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=${encodeURIComponent(type)}&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DateCreated&SortOrder=Descending&Limit=${Math.max(10, limit * 2)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const out = uniqById(items).slice(0, limit);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: recent fetch error:", type, e);
    return [];
  }
}

async function fetchContinue(userId, type, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `Filters=IsResumable&MediaTypes=Video&IncludeItemTypes=${encodeURIComponent(type)}&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(10, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const out = uniqById(
      items
        .filter((it) => Number(it?.UserData?.PlaybackPositionTicks || 0) > 0)
        .sort((a, b) => getLastPlayedTs(b) - getLastPlayedTs(a))
    ).slice(0, limit);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: continue fetch error:", type, e);
    return [];
  }
}

function getLastPlayedTs(it) {
  const ud = it?.UserData || it?.UserDataDto || null;
  const s = ud?.LastPlayedDate || ud?.LastPlayedDateUtc || it?.DatePlayed || null;
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

async function fetchRecentlyPlayedTracks(userId, limit, parentId) {
  const want = Math.max(30, limit * 6);
  const base =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Audio&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DatePlayed&SortOrder=Descending&Limit=${want}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  const urlPlayed = base + `&Filters=IsPlayed`;
  const normalize = async (data) => {
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const played = items
      .filter(it => getLastPlayedTs(it) > 0)
      .sort((a, b) => getLastPlayedTs(b) - getLastPlayedTs(a));

    return uniqById(played).slice(0, limit);
  };

  try {
    let data = await makeApiRequest(urlPlayed);
    let out = await normalize(data);

    if (out.length < Math.min(limit, 6)) {
      data = await makeApiRequest(base);
      out = await normalize(data);
    }

    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}

    return out;
  } catch (e) {
    console.warn("recentRows: recently played tracks fetch error:", e);
    return [];
  }
}

async function fetchItemsByIds(ids) {
  const clean = Array.isArray(ids) ? ids.map(x => String(x||"").trim()).filter(Boolean) : [];
  if (!clean.length) return [];

  let hydrated = [];
  try {
    if (!STATE.db || !STATE.scope) await ensureRecentDb();
    if (STATE.db && STATE.scope) {
      hydrated = await getItemsByIds(STATE.db, STATE.scope, clean);
    }
  } catch {}

  const hydratedById = new Map((hydrated || []).filter(x=>x?.Id).map(x => [x.Id, x]));
  const missing = clean.filter(id => !hydratedById.has(id));

  let fetched = [];
  if (missing.length) {
    const chunkSize = 100;
    const out = [];
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      const userScoped = !!STATE.userId;
      const basePath = userScoped ? `/Users/${STATE.userId}/Items` : `/Items`;
      const url =
        `${basePath}?Ids=${encodeURIComponent(chunk.join(","))}` +
        `&Fields=${encodeURIComponent(COMMON_FIELDS)}` +
        (userScoped ? `&EnableUserData=true` : ``) +
        `&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
      try {
        const data = await makeApiRequest(url);
        const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
        out.push(...items);
      } catch (e) {
        console.warn("recentRows: fetchItemsByIds missing fetch error:", e);
      }
    }
    fetched = uniqById(out);

    try {
      if (fetched?.length && STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, fetched, { timeout: 1500 });
      }
    } catch {}
  }

  const fetchedById = new Map((fetched || []).filter(x=>x?.Id).map(x => [x.Id, x]));
  const final = [];
  const seen = new Set();
  for (const id of clean) {
    const it = hydratedById.get(id) || fetchedById.get(id) || null;
    if (!it?.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    final.push(it);
  }

  for (const it of fetched || []) {
    if (!it?.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    final.push(it);
  }
  return final;
}

function isRealTvEpisode(it) {
  if (!it) return false;
  if (it.Type !== "Episode") return false;
  const hasSeries = !!(it.SeriesId || (it.SeriesName && String(it.SeriesName).trim()));
  if (!hasSeries) return false;

  const epNo = Number(it.IndexNumber);
  if (!Number.isFinite(epNo) || epNo <= 0) return false;

  return true;
}

async function fetchRecentEpisodes(userId, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Episode&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `ExcludeItemTypes=Playlist&` +
    `SortBy=DateCreated&SortOrder=Descending&Limit=${Math.max(20, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  try {
    const data = await makeApiRequest(url);
    const eps = Array.isArray(data?.Items) ? data.Items : [];
    const uniqEps = uniqById(eps).filter(isRealTvEpisode);

    await attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: recent episodes fetch error:", e);
    return [];
  }
}

async function fetchContinueEpisodes(userId, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `Filters=IsResumable&MediaTypes=Video&IncludeItemTypes=Episode&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `ExcludeItemTypes=Playlist&` +
    `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(20, limit * 4)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  try {
    const data = await makeApiRequest(url);
    const eps = Array.isArray(data?.Items) ? data.Items : [];
    const uniqEps = uniqById(
      eps
        .filter((it) => Number(it?.UserData?.PlaybackPositionTicks || 0) > 0)
        .sort((a, b) => getLastPlayedTs(b) - getLastPlayedTs(a))
    ).filter(isRealTvEpisode);

    await attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: continue episodes fetch error:", e);
    return [];
  }
}

async function attachSeriesPosterSourceToEpsAndSeasons(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;

  const directSeriesIds = [];
  const needParentResolve = [];

  for (const it of list) {
    if (!it?.Id) continue;
    const sid = getSeriesIdFromItem(it);
    if (sid) directSeriesIds.push(sid);
    else if (it.ParentId) needParentResolve.push(it.ParentId);
  }

  const seasonToSeries = new Map();
  const resolvedSeriesIds = [];
  if (needParentResolve.length) {
    const uniqParentIds = Array.from(new Set(needParentResolve.filter(Boolean)));
    const parents = await fetchItemsByIds(uniqParentIds);
    for (const p of parents) {
      if (!p?.Id) continue;
      const sid =
        (p.Type === "Season") ? (p.SeriesId || p.ParentId || null) :
        (p.Type === "Series") ? p.Id :
        null;
      if (sid) {
        seasonToSeries.set(p.Id, sid);
        resolvedSeriesIds.push(sid);
      }
    }
  }

  const allSeriesIds = Array.from(new Set([...directSeriesIds, ...resolvedSeriesIds].filter(Boolean)));
  if (!allSeriesIds.length) return list;

  const series = await fetchItemsByIds(allSeriesIds);
  const seriesById = new Map((series || []).filter(s=>s?.Id).map(s => [s.Id, s]));

  for (const it of list) {
    if (!it) continue;

    let sid = getSeriesIdFromItem(it);
    if (!sid && it.ParentId) sid = seasonToSeries.get(it.ParentId) || null;
    const s = sid ? seriesById.get(sid) : null;
    if (s) it.__posterSource = s;
  }

  return list;
}

async function fetchRecentGeneric(userId, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DateCreated&SortOrder=Descending&Limit=${Math.max(10, limit * 2)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const out = uniqById(items).slice(0, limit);
    await attachSeriesPosterSourceToEpsAndSeasons(out);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: other recent fetch error:", e);
    return [];
  }
}

async function fetchContinueGeneric(userId, limit, parentId) {
  const url =
    `/Users/${userId}/Items?` +
    `Filters=IsResumable&MediaTypes=Video&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(10, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const out = uniqById(
      items
        .filter((it) => Number(it?.UserData?.PlaybackPositionTicks || 0) > 0)
        .sort((a, b) => getLastPlayedTs(b) - getLastPlayedTs(a))
    ).slice(0, limit);
    await attachSeriesPosterSourceToEpsAndSeasons(out);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: other continue fetch error:", e);
    return [];
  }
}

function buildSectionSkeleton({ titleText, badgeType, onSeeAll }) {
  const section = document.createElement("section");
  section.className = "recent-row-section dir-row-section";

  const title = document.createElement("div");
  title.className = "sectionTitleContainer sectionTitleContainer-cards";

  const seeAllText = config.languageLabels.seeAll || "Tümünü gör";

  title.innerHTML = `
    <h2 class="sectionTitle sectionTitle-cards dir-row-title">
      <span class="dir-row-title-text" role="button" tabindex="0"
        aria-label="${escapeHtml(seeAllText)}: ${escapeHtml(titleText)}">
        ${escapeHtml(titleText)}
      </span>

      <div class="dir-row-see-all"
          aria-label="${escapeHtml(seeAllText)}"
          title="${escapeHtml(seeAllText)}">
        ${faIconHtml("chevronRight")}
      </div>
      <span class="dir-row-see-all-tip">${escapeHtml(seeAllText)}</span>
    </h2>
  `;

  const titleBtn = title.querySelector(".dir-row-title-text");
  const seeAllBtn = title.querySelector(".dir-row-see-all");

  const doSeeAll = (e) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch {}
    if (typeof onSeeAll === "function") {
      try { onSeeAll(); } catch (err) { console.error("RecentRows seeAll error:", err); }
    }
  };

  if (titleBtn) {
    titleBtn.addEventListener("click", doSeeAll, { passive: false });
    titleBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") doSeeAll(e);
    });
  }
  if (seeAllBtn) seeAllBtn.addEventListener("click", doSeeAll, { passive: false });

  const heroHost = document.createElement("div");
  heroHost.className = "dir-row-hero-host";
  heroHost.style.display = getRecentRowsRuntimeConfig().showHeroCards ? "" : "none";

  const scrollWrap = document.createElement("div");
  scrollWrap.className = "personal-recs-scroll-wrap";
  try { scrollWrap.style.position = "relative"; } catch {}
  scrollWrap.classList.add("rr-scroll-pending");

  const btnL = document.createElement("button");
  btnL.className = "hub-scroll-btn hub-scroll-left";
  btnL.setAttribute("aria-label", config.languageLabels.scrollLeft || "Sola kaydır");
  btnL.setAttribute("aria-disabled", "true");
  btnL.disabled = true;
  btnL.style.visibility = "hidden";
  btnL.style.pointerEvents = "none";
  btnL.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;

  const row = document.createElement("div");
  row.className = "itemsContainer personal-recs-row";
  row.setAttribute("role", "list");

  const btnR = document.createElement("button");
  btnR.className = "hub-scroll-btn hub-scroll-right";
  btnR.setAttribute("aria-label", config.languageLabels.scrollRight || "Sağa kaydır");
  btnR.setAttribute("aria-disabled", "true");
  btnR.disabled = true;
  btnR.style.visibility = "hidden";
  btnR.style.pointerEvents = "none";
  btnR.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`;

  scrollWrap.appendChild(btnL);
  scrollWrap.appendChild(row);
  scrollWrap.appendChild(btnR);

  section.appendChild(title);
  section.appendChild(heroHost);
  section.appendChild(scrollWrap);

  return { section, row, heroHost, scrollWrap, btnL, btnR };
}

function getBadgeText(type) {
  switch(type) {
    case 'new': return config.languageLabels.badgeNew || "Yeni";
    case 'continue': return config.languageLabels.badgeContinue || "Devam";
    case 'episode': return config.languageLabels.badgeEpisode || "Bölüm";
    case 'series': return config.languageLabels.badgeSeries || "Dizi";
    case 'movie': return config.languageLabels.badgeMovie || "Film";
    default: return config.languageLabels.badgeNew || "Yeni";
  }
}

function appendSection(wrap, sectionEl) {
  wrap.appendChild(sectionEl);
}

async function fillSectionWithItems({
  wrap,
  titleText,
  badgeType = 'new',
  heroLabel,
  fetcher,
  cardCount,
  showProgress,
  onSeeAll,
  randomHero = false,
}) {
  const { section, row, heroHost, scrollWrap, btnL, btnR } = buildSectionSkeleton({
    titleText,
    badgeType,
    onSeeAll
  });
  const runtimeCfg = getRecentRowsRuntimeConfig();

  appendSection(wrap, section);
  renderSkeletonRow(row, cardCount);

  let __renderToken = (Date.now() ^ (Math.random()*1e9)) | 0;
  section.__renderToken = __renderToken;

  let cachedItems = [];
  let cachedFresh = false;
  try {
    if (typeof fetcher?.cachedItems === "function") {
      const cached = await fetcher.cachedItems();
      if (Array.isArray(cached)) {
        cachedItems = cached;
      } else {
        cachedItems = Array.isArray(cached?.items) ? cached.items : [];
        cachedFresh = !!cached?.fresh;
      }
    }
  } catch {}

  if (cachedItems?.length) {
    try {
      await (async () => {
        const pool = cachedItems.slice();
        await attachMusicPosterSources(pool);
        const best = pool[0] || null;
        const remaining = best ? pool.filter(x => x?.Id && x.Id !== best.Id) : pool.slice();

        heroHost.innerHTML = "";
        if (runtimeCfg.showHeroCards && best) {
          heroHost.appendChild(await createRowHeroCard(best, STATE.serverId, heroLabel, { showProgress }));
        }

        row.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < Math.min(remaining.length, cardCount); i++) {
          fragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, {
            aboveFold: i < 2,
            showProgress
          }));
        }

        row.appendChild(fragment);
        setupScroller(row);

        try { scrollWrap?.classList?.remove("rr-scroll-pending"); } catch {}
        try {
          if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; btnL.disabled = false; }
          if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; btnR.disabled = false; }
        } catch {}
        return true;
      })();
    } catch {}
  }

  if (cachedFresh) {
    return true;
  }

  let items = [];
  try {
    items = await fetcher();
  } catch (e) {
    console.warn("recentRows: fillSection fetcher error:", e);
    items = [];
  }

  if (!items?.length) {
    if (!cachedItems?.length) {
      try { section.parentElement?.removeChild(section); } catch {}
      return false;
    }
    return true;
   }

  if (cachedItems?.length) {
    const a = cachedItems.map(x => x?.Id).filter(Boolean).slice(0, cardCount+1);
    const b = items.map(x => x?.Id).filter(Boolean).slice(0, cardCount+1);
    if (sameIdList(a, b)) {
      const progressUnchanged =
        !showProgress ||
        samePlaybackProgressByOrder(cachedItems, items, cardCount + 1);
      if (progressUnchanged) return true;
    }
  }

  const pool = items.slice();
  await attachMusicPosterSources(pool);

  let best = null;
  if (pool.length) {
    if (randomHero) {
      const idx = pickRandomIndex(pool.length);
      best = idx >= 0 ? pool[idx] : pool[0];
    } else {
      best = pool[0];
    }
  }

  const remaining = best ? pool.filter(x => x?.Id && x.Id !== best.Id) : pool.slice();

  heroHost.innerHTML = "";
  if (runtimeCfg.showHeroCards && best) {
    heroHost.appendChild(await createRowHeroCard(best, STATE.serverId, heroLabel, { showProgress }));
  }

  row.innerHTML = "";
  if (!remaining.length) {
    row.innerHTML = `<div class="no-recommendations">${escapeHtml(config.languageLabels.noRecommendations || "Uygun içerik yok")}</div>`;
    setupScroller(row);
    try { scrollWrap?.classList?.remove("rr-scroll-pending"); } catch {}
    try {
      if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; }
      if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; }
      btnL && (btnL.disabled = false);
      btnR && (btnR.disabled = false);
    } catch {}
    return true;
  }

  if (IS_MOBILE) {
    const mobileFrag = document.createDocumentFragment();
    const mobileLimit = Math.min(remaining.length, cardCount);
    for (let i = 0; i < mobileLimit; i++) {
      mobileFrag.appendChild(createRecommendationCard(remaining[i], STATE.serverId, {
        aboveFold: i < 4,
        showProgress
      }));
    }
    row.appendChild(mobileFrag);
    setupScroller(row);
    try { scrollWrap?.classList?.remove("rr-scroll-pending"); } catch {}
    try {
      if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; btnL.disabled = false; }
      if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; btnR.disabled = false; }
    } catch {}
    return true;
  }

  const initialCount = Math.min(cardCount, remaining.length);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < Math.min(initialCount, remaining.length); i++) {
    fragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, {
      aboveFold: i < Math.min(6, initialCount),
      showProgress
    }));
  }
  row.appendChild(fragment);

  let currentIndex = initialCount;
  const pumpMore = () => {
    if (currentIndex >= remaining.length || row.childElementCount >= cardCount) {
      setupScroller(row);
      try { scrollWrap?.classList?.remove("rr-scroll-pending"); } catch {}
      try {
        if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; }
        if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; }
        btnL && (btnL.disabled = false);
        btnR && (btnR.disabled = false);
      } catch {}
      return;
    }
    const chunkSize = IS_MOBILE ? 2 : 6;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < chunkSize && currentIndex < remaining.length; i++) {
      if (row.childElementCount >= cardCount) break;
      frag.appendChild(createRecommendationCard(remaining[currentIndex], STATE.serverId, {
        aboveFold: false,
        showProgress
      }));
      currentIndex++;
    }
    row.appendChild(frag);
    try {
      if (!row.__rrScrollRaf) {
        row.__rrScrollRaf = requestAnimationFrame(() => {
          row.__rrScrollRaf = 0;
          try { row.dispatchEvent(new Event("scroll")); } catch {}
        });
      }
    } catch {}
    setTimeout(pumpMore, 0);
  };
  setTimeout(pumpMore, 200);

  return true;
}

function getActiveHomePage() {
   return document.querySelector("#homePage:not(.hide), #indexPage:not(.hide)");
}

function findRealHomeSectionsContainer() {
  const page = getActiveHomePage();
  if (!page) return null;
  const hsc = page.querySelector(".homeSectionsContainer");
  return (hsc && hsc.isConnected) ? hsc : null;
}

function pickRecentRowsParentAndAnchor() {
  const hsc = findRealHomeSectionsContainer();
  if (hsc) {
    const nativeAnchor = getLastNativeHomeSection(hsc);
    if (nativeAnchor && nativeAnchor.parentElement === hsc) {
      return { parent: hsc, anchor: nativeAnchor, prepend: false };
    }

    const pr = hsc.querySelector("#personal-recommendations");
    if (pr && pr.parentElement === hsc) {
      return { parent: hsc, anchor: pr, prepend: false };
    }

    const studio = hsc.querySelector("#studio-hubs");
    if (studio && studio.parentElement === hsc) {
      return { parent: hsc, anchor: studio, prepend: false };
    }

    return { parent: hsc, anchor: studio || pr || null, prepend: false };
  }

  const homeSectionsConfig = getHomeSectionsRuntimeConfig(getLiveConfig());
  const pr = document.getElementById("personal-recommendations");
  if (homeSectionsConfig.enablePersonalRecommendations && pr) {
    const titleEl =
      pr.querySelector("h2.sectionTitle.sectionTitle-cards.prc-title") ||
      pr.querySelector(".sectionTitleContainer.sectionTitleContainer-cards") ||
      pr.querySelector(".prc-title") ||
      null;

    if (titleEl) {
      return { parent: titleEl.parentElement || pr, anchor: titleEl };
    }
    if (pr.parentElement) {
      return { parent: pr.parentElement, anchor: pr, prepend: false };
    }
  }
  return { parent: document.body, anchor: null, prepend: false };
}

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    ref.insertAdjacentElement("afterend", node);
  } else {
    parent.appendChild(node);
  }
}

function insertFirst(parent, node) {
  if (!parent || !node) return;
  if (parent.firstElementChild) parent.insertBefore(node, parent.firstElementChild);
  else parent.appendChild(node);
}

function ensureRecentRowsPlacement(wrap) {
  const { parent, anchor, prepend } = pickRecentRowsParentAndAnchor();

  if (wrap.parentElement !== parent) {
    if (prepend) insertFirst(parent, wrap);
    else insertAfter(parent, wrap, anchor);
    return true;
  }

  if (anchor && wrap.previousElementSibling !== anchor) {
    insertAfter(parent, wrap, anchor);
    return true;
  }

  if (prepend && wrap !== parent.firstElementChild) {
    insertFirst(parent, wrap);
    return true;
  }
  return false;
}

function hasRenderableRecentRowsContent(wrap) {
  if (!wrap) return false;
  return !!wrap.querySelector(
    ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations, .recent-row-section .dir-row-hero"
  );
}

export async function mountRecentRowsLazy(options = {}) {
  const force = options?.force === true;
  if (__recentMountPromise) {
    if (!force) return __recentMountPromise;
    try { await __recentMountPromise; } catch {}
  }
  if (!getActiveHomePage() && !isRecentRowsHomeRoute()) {
    return false;
  }
  const cfg = getConfig();
  const runtimeCfg = getRecentRowsRuntimeConfig(cfg);
  const anyRecent =
    runtimeCfg.enableRecentMovies ||
    runtimeCfg.enableRecentSeries ||
    runtimeCfg.enableRecentEpisodes ||
    runtimeCfg.enableRecentMusic ||
    runtimeCfg.enableRecentTracks;

  const anyEnabled =
    anyRecent ||
    runtimeCfg.enableContinueMovies ||
    runtimeCfg.enableContinueSeries ||
    runtimeCfg.enableOtherLibRows;

  if (!anyEnabled) {
    cleanupRecentRows();
    return;
  }

  const run = (async () => {
    if (force) {
      cleanupRecentRows();
    }

    const host = await waitForVisibleHomeSections({
      timeout: force ? 5000 : 12000
    });
    if (!host?.container || !getActiveHomePage()) return false;
    const homeParent = findRealHomeSectionsContainer();
    if (!homeParent) return false;
    bindManagedSectionsBelowNative(homeParent);

    let wrap = document.getElementById("recent-rows");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "recent-rows";
      wrap.className = "homeSection director-rows-wrapper";
    }

    try {
      ensureRecentRowsPlacement(wrap);
      __wrapInserted = wrap.isConnected;
    } catch {
      __wrapInserted = false;
    }

    if (!wrap.isConnected) return false;
    if (!force && hasRenderableRecentRowsContent(wrap)) {
      setRecentRowsDone(true);
      return true;
    }

    try {
      await initAndRender(wrap);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  })();

  __recentMountPromise = run;
  try {
    return await run;
  } finally {
    if (__recentMountPromise === run) {
      __recentMountPromise = null;
    }
  }
}

function getPinnedHomeContainer() {
  const root = getActiveHomePage();
  if (!root) return null;
  const scroller = root.querySelector(
    ".padded-top-focusscale.padded-bottom-focusscale.emby-scroller"
  );
  if (scroller) return { parent: scroller.parentElement || document.body, anchor: scroller };
  const vertical = root.querySelector(
    ".verticalSection.verticalSection-extrabottompadding"
  );
  if (vertical) return { parent: vertical, anchor: null };
  return null;
}

async function initAndRender(wrap) {
  if (!getActiveHomePage()) return;
  if (!wrap || !wrap.isConnected) return;
  if (STATE.started) {
    const stale =
      !STATE.wrapEl ||
      !STATE.wrapEl.isConnected ||
      (wrap && STATE.wrapEl !== wrap);
    if (!stale) return;
    STATE.started = false;
    STATE.wrapEl = null;
    STATE.serverId = null;
    STATE.userId = null;
    STATE.defaultTvHash = null;
    STATE.defaultMoviesHash = null;
    STATE.defaultMusicHash = null;
    STATE.movieLibs = [];
    STATE.tvLibs = [];
    STATE.otherLibs = [];
  }
  try {
    if (typeof waitForAuthReadyStrict === "function") {
      await waitForAuthReadyStrict(5000);
    }
  } catch {}
  const { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE.wrapEl = wrap;
  STATE.userId = userId;
  STATE.serverId = serverId;
  setRecentRowsDone(false);

  try {
    await ensureRecentDb();
    await resolveDefaultPages(userId);
    const runtimeCfg = getRecentRowsRuntimeConfig();

    const recentPlans   = [];
    const continuePlans = [];
    const episodePlans  = [];
    const pushPlan = (bucket, fn) => { if (typeof fn === "function") bucket.push(fn); };

  if (runtimeCfg.enableRecentMovies) {
    const split = getConfig()?.recentRowsSplitMovieLibs === true;
    const movieLibIds = resolveMovieLibSelection();

    if (!split || !movieLibIds.length) {
      pushPlan(recentPlans, () => fillSectionWithItems({
        wrap,
        titleText: config.languageLabels.recentMovies || "Son eklenen filmler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentMoviesHero || "Son eklenen film",
        cardCount: runtimeCfg.effectiveRecentMoviesCount,
        showProgress: false,
        fetcher: Object.assign(
            () => fetchRecent(userId, "Movie", runtimeCfg.effectiveRecentMoviesCount + 1).then(async (items) => {
            await writeCachedList("recent", "Movie", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("recent", "Movie", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentMoviesCount + 1
            })
          }
        ),
        onSeeAll: () => openLatestPage("Movie")
      }));
    } else {
      for (const movieLibId of movieLibIds) {
        const libName = (STATE.movieLibs || []).find(x => x.Id === movieLibId)?.Name || "";
        pushPlan(recentPlans, () => fillSectionWithItems({
          wrap,
          titleText: (config.languageLabels.recentMovies || "Son eklenen filmler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentMoviesHero || "Son eklenen film") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentMoviesCount,
          showProgress: false,
          fetcher: Object.assign(
              () => fetchRecent(userId, "Movie", runtimeCfg.effectiveRecentMoviesCount + 1, movieLibId).then(async (items) => {
              await writeCachedList("recent", "Movie" + movieLibMetaSuffix(movieLibId), items.map(x=>x?.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: () => loadCachedRowItems("recent", "Movie" + movieLibMetaSuffix(movieLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentMoviesCount + 1
              })
            }
          ),
          onSeeAll: () => gotoHash(getMoviesLibraryHash(movieLibId))
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentSeries) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("recentSeries");

    if (!split) {
      pushPlan(recentPlans, () => fillSectionWithItems({
        wrap,
        titleText: config.languageLabels.recentSeries || "Son eklenen diziler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentSeriesHero || "Son eklenen dizi",
        cardCount: runtimeCfg.effectiveRecentSeriesCount,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecent(userId, "Series", runtimeCfg.effectiveRecentSeriesCount + 1).then(async (items) => {
            await writeCachedList("recent", "Series", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("recent", "Series", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentSeriesCount + 1
            })
          }
        ),
        onSeeAll: () => openLatestPage("Series")
      }));
    } else {
      for (const tvLibId of tvIds) {
        const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
        pushPlan(recentPlans, () => fillSectionWithItems({
          wrap,
          titleText: (config.languageLabels.recentSeries || "Son eklenen diziler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentSeriesHero || "Son eklenen dizi") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentSeriesCount,
          showProgress: false,
          fetcher: Object.assign(
            () => fetchRecent(userId, "Series", runtimeCfg.effectiveRecentSeriesCount + 1, tvLibId).then(async (items) => {
              await writeCachedList("recent", "Series" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: () => loadCachedRowItems("recent", "Series" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentSeriesCount + 1
              })
            }
          ),
          onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`)
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentEpisodes) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("recentEpisodes");

    if (!split) {
      pushPlan(recentPlans, () => fillSectionWithItems({
        wrap,
        titleText: config.languageLabels.recentEpisodes || "Son eklenen bölümler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentEpisodesHero || "Son eklenen bölüm",
        cardCount: runtimeCfg.effectiveRecentEpisodesCount,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecentEpisodes(userId, runtimeCfg.effectiveRecentEpisodesCount + 1).then(async (items) => {
            await writeCachedList("recent", "Episode", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("recent", "Episode", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentEpisodesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: () => openLatestPage("Episode")
      }));
    } else {
      for (const tvLibId of tvIds) {
        const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
        pushPlan(recentPlans, () => fillSectionWithItems({
          wrap,
          titleText: (config.languageLabels.recentEpisodes || "Son eklenen bölümler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentEpisodesHero || "Son eklenen bölüm") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentEpisodesCount,
          showProgress: false,
          fetcher: Object.assign(
            () => fetchRecentEpisodes(userId, runtimeCfg.effectiveRecentEpisodesCount + 1, tvLibId).then(async (items) => {
              await writeCachedList("recent", "Episode" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: () => loadCachedRowItems("recent", "Episode" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentEpisodesCount + 1,
                afterLoad: attachSeriesPosterSourceToEpsAndSeasons
              })
            }
          ),
          onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`)
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentMusic) {
    pushPlan(recentPlans, () => fillSectionWithItems({
      wrap,
      titleText: config.languageLabels.recentMusic || "Son eklenen Albüm",
      badgeType: "new",
      heroLabel: config.languageLabels.recentMusicHero || "Son eklenen albüm",
      cardCount: runtimeCfg.effectiveRecentMusicCount,
      showProgress: false,
      fetcher: Object.assign(
        () => fetchRecent(userId, "MusicAlbum", runtimeCfg.effectiveRecentMusicCount + 1).then(async (items) => {
          await writeCachedList("recent", "MusicAlbum", items.map(x=>x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: () => loadCachedRowItems("recent", "MusicAlbum", TTL_RECENT_MS, {
            limit: runtimeCfg.effectiveRecentMusicCount + 1
          })
        }
      ),
      onSeeAll: () => openLatestPage("MusicAlbum"),
      randomHero: false
    }));
  }

  if (runtimeCfg.enableRecentTracks) {
  pushPlan(continuePlans, () => fillSectionWithItems({
    wrap,
    titleText: (config.languageLabels.recentlyPlayedTracks || config.languageLabels.recRecentTracks) || "Son dinlenen parçalar",
    badgeType: "continue",
    heroLabel: (config.languageLabels.recentlyPlayedTracksHero || config.languageLabels.recentTracksHero) || "Son dinlenen parça",
    cardCount: runtimeCfg.effectiveRecentTracksCount,
    showProgress: false,
    fetcher: Object.assign(
      () => fetchRecentlyPlayedTracks(userId, runtimeCfg.effectiveRecentTracksCount + 1).then(async (items) => {
        await writeCachedList("played", "Audio", items.map(x=>x?.Id).filter(Boolean));
        return items;
      }),
      {
        cachedItems: () => loadCachedRowItems("played", "Audio", TTL_CONTINUE_MS, {
          limit: runtimeCfg.effectiveRecentTracksCount + 1
        })
      }
    ),
    onSeeAll: () => openLatestPage("Audio"),
    randomHero: false
  }));
}

  if (runtimeCfg.enableContinueMovies) {
    pushPlan(continuePlans, () => fillSectionWithItems({
      wrap,
      titleText: config.languageLabels.continueMovies || "Film izlemeye devam et",
      badgeType: "continue",
      heroLabel: config.languageLabels.continueMoviesHero || "İzlemeye devam (Film)",
      cardCount: runtimeCfg.effectiveContinueMoviesCount,
      showProgress: true,
      fetcher: Object.assign(
        () => fetchContinue(userId, "Movie", runtimeCfg.effectiveContinueMoviesCount + 1).then(async (items) => {
          await writeCachedList("resume", "Movie", items.map(x=>x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: () => loadCachedRowItems("resume", "Movie", TTL_CONTINUE_MS, {
            limit: runtimeCfg.effectiveContinueMoviesCount + 1
          })
        }
      ),
      onSeeAll: () => openResumePage("Movie"),
      randomHero: true
    }));
  }

  if (runtimeCfg.enableContinueSeries) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("continueSeries");

    if (!split) {
      pushPlan(continuePlans, () => fillSectionWithItems({
        wrap,
        titleText: config.languageLabels.continueSeries || "Dizi izlemeye devam et",
        badgeType: "continue",
        heroLabel: config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)",
        cardCount: runtimeCfg.effectiveContinueSeriesCount,
        showProgress: true,
        fetcher: Object.assign(
          () => fetchContinueEpisodes(userId, runtimeCfg.effectiveContinueSeriesCount + 1).then(async (items) => {
            await writeCachedList("resume", "Episode", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("resume", "Episode", TTL_CONTINUE_MS, {
              limit: runtimeCfg.effectiveContinueSeriesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: () => openResumePage("Episode"),
        randomHero: true
      }));
    } else {
      for (const tvLibId of tvIds) {
        const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
        pushPlan(continuePlans, () => fillSectionWithItems({
          wrap,
          titleText: (config.languageLabels.continueSeries || "Dizi izlemeye devam et") + (libName ? ` • ${libName}` : ""),
          badgeType: "continue",
          heroLabel: (config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveContinueSeriesCount,
          showProgress: true,
          fetcher: Object.assign(
            () => fetchContinueEpisodes(userId, runtimeCfg.effectiveContinueSeriesCount + 1, tvLibId).then(async (items) => {
              await writeCachedList("resume", "Episode" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: () => loadCachedRowItems("resume", "Episode" + tvLibMetaSuffix(tvLibId), TTL_CONTINUE_MS, {
                limit: runtimeCfg.effectiveContinueSeriesCount + 1,
                afterLoad: attachSeriesPosterSourceToEpsAndSeasons
              })
            }
          ),
          onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`),
          randomHero: true
        }));
      }
    }
  }

  if (runtimeCfg.enableOtherLibRows) {
    const otherIds = resolveOtherLibSelection();
    const otherDefs = otherIds.map((libId) => {
      const lib = (STATE.otherLibs || []).find(x => x.Id === libId) || null;
      return { libId, libName: lib?.Name || "Library" };
    });

    for (const { libId, libName } of otherDefs) {
      pushPlan(recentPlans, () => fillSectionWithItems({
        wrap,
        titleText: `${config.languageLabels.otherLibRecent || "Son eklenenler"} • ${libName}`,
        badgeType: "new",
        heroLabel: `${config.languageLabels.otherLibRecentHero || "Son eklenen"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherRecentCount,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecentGeneric(userId, runtimeCfg.effectiveOtherRecentCount + 1, libId).then(async (items) => {
            await writeCachedList("other_recent", `lib:${libId}`, items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("other_recent", `lib:${libId}`, TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveOtherRecentCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: () => gotoHash(`#/list.html?parentId=${encodeURIComponent(libId)}`)
      }));
    }

    for (const { libId, libName } of otherDefs) {
      pushPlan(continuePlans, () => fillSectionWithItems({
        wrap,
        titleText: `${config.languageLabels.otherLibContinue || "İzlemeye devam et"} • ${libName}`,
        badgeType: "continue",
        heroLabel: `${config.languageLabels.otherLibContinueHero || "Devam"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherContinueCount,
        showProgress: true,
        fetcher: Object.assign(
          () => fetchContinueGeneric(userId, runtimeCfg.effectiveOtherContinueCount + 1, libId).then(async (items) => {
            await writeCachedList("other_resume", `lib:${libId}`, items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("other_resume", `lib:${libId}`, TTL_CONTINUE_MS, {
              limit: runtimeCfg.effectiveOtherContinueCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: () => gotoHash(`#/list.html?parentId=${encodeURIComponent(libId)}&tab=resume`),
        randomHero: true
      }));
    }

    for (const { libId, libName } of otherDefs) {
      pushPlan(episodePlans, () => fillSectionWithItems({
        wrap,
        titleText: `${config.languageLabels.recentEpisodes || "Son eklenen bölümler"} • ${libName}`,
        badgeType: "episode",
        heroLabel: `${config.languageLabels.recentEpisodesHero || "Bölüm"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherEpisodesCount,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecentEpisodes(userId, runtimeCfg.effectiveOtherEpisodesCount + 1, libId).then(async (items) => {
            await writeCachedList("other_recent", `ep:${libId}`, items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: () => loadCachedRowItems("other_recent", `ep:${libId}`, TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveOtherEpisodesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: () => gotoHash(`#/list.html?parentId=${encodeURIComponent(libId)}&includeItemTypes=Episode`)
      }));
    }
  }

    const runners = [...recentPlans, ...episodePlans, ...continuePlans];

    async function runWithLimit(fns, limit) {
      const pool = new Set();
      const results = [];
      for (const fn of fns) {
        const p = Promise.resolve().then(fn);
        results.push(p);
        pool.add(p);
        p.finally(() => pool.delete(p));
        if (pool.size >= limit) {
          try { await Promise.race(pool); } catch {}
        }
      }
      return Promise.allSettled(results);
    }

    const limit = RECENT_ROW_RENDER_CONCURRENCY;
    if (runners.length) {
      await runWithLimit(
        runners.map((run) => async () => {
          try { return await run(); }
          catch (e) { console.warn("recentRows: runner error:", e); }
        }),
        limit
      );
    }

    if (!wrap.querySelector(".recent-row-section")) {
      try { wrap.parentElement?.removeChild(wrap); } catch {}
    }
  } finally {
    setRecentRowsDone(true);
  }
}

export function cleanupRecentRows() {
  try {
    __recentMountPromise = null;
    setRecentRowsDone(false);
    if (STATE.wrapEl) {
      STATE.wrapEl.querySelectorAll(".personal-recs-card, .dir-row-hero").forEach(el => {
        try { el.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
      STATE.wrapEl.querySelectorAll(".personal-recs-row").forEach(row => {
        try { row.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
    }

    try {
      if (STATE.wrapEl && STATE.wrapEl.isConnected) {
        STATE.wrapEl.parentElement?.removeChild(STATE.wrapEl);
      }
    } catch {}

    STATE.started = false;
    STATE.wrapEl = null;
    STATE.serverId = null;
    STATE.userId = null;
    STATE.defaultTvHash = null;
    STATE.defaultMoviesHash = null;
    STATE.defaultMusicHash = null;
    STATE.movieLibs = [];
    STATE.tvLibs = [];
    STATE.otherLibs = [];
    __wrapInserted = false;
  } catch (e) {
    console.warn("recent rows cleanup error:", e);
  }
}

export function releaseRecentRowsDbConnection() {
  try { STATE.db?.close?.(); } catch {}
  STATE.db = null;
  STATE.scope = null;
}

(function bindRecentRowsDbReleaseOnce() {
  if (window.__jmsRecentRowsDbReleaseBound) return;
  window.__jmsRecentRowsDbReleaseBound = true;

  window.addEventListener('jms:indexeddb:release', (event) => {
    const dbName = event?.detail?.dbName;
    if (!dbName || dbName === 'monwui_recent_db' || dbName === '*') {
      releaseRecentRowsDbConnection();
    }
  });
})();

function getHomeSectionsContainer(indexPage) {
  const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    document.body;

  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    page;
}

if (!window.__recentRowsImageRecoveryBound) {
  window.__recentRowsImageRecoveryBound = true;

  const kick = () => {
    try { retryRecoverableImages(); } catch {}
  };

  window.addEventListener("online", kick);
  window.addEventListener("focus", kick, { passive: true });
  window.addEventListener("pageshow", kick, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kick();
  }, { passive: true });
}
