import { getSessionInfo, makeApiRequest, playNow, waitForAuthReadyStrict, getCachedUserTopGenres } from "../../Plugins/JMSFusion/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig, getManagedHomeSectionRuntimeOrder } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import {
  cleanupManagedImage,
  progressivelyRenderCardRow,
  resolveManagedCardTitleRender,
  setManagedImageSource,
  setupScroller
} from "./personalRecommendations.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { openDirRowsDB, makeScope, upsertItemsBatchIdle, getMeta, setMeta, getItemsByIds, } from "./recentRowsDb.js";
import { getGlobalTmdbApiKey } from "./jmsPluginConfig.js";
import {
  withServer
} from "./jfUrl.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  getActiveHomePageEl,
  keepManagedSectionsBelowNative,
  bindManagedSectionsBelowNative,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import {
  enqueueManagedSectionRender,
  registerManagedHomeRowAnchor,
  waitForManagedHomeRowRelease
} from "./homeSectionChain.js";

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
const TOP10_ROW_CARD_COUNT = 10;
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
const HOME_DEBUG_STORAGE_KEY = "jms:debug:home-sections";
const HOME_TRACE_STORAGE_KEY = "jms:trace:home-sections";
// Recent rows can expand into many sub-sections. The generic release gate is
// useful for very long home pages, but on this module it can stall lower rows
// behind the first visible ones and make them appear nondeterministic.
const RECENT_ROWS_EAGER_RELEASE_COUNT = 1024;

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
    showRecentMoviesHeroCards: cfg.showRecentMoviesHeroCards !== false,
    showRecentSeriesHeroCards: cfg.showRecentSeriesHeroCards !== false,
    showRecentMusicHeroCards: cfg.showRecentMusicHeroCards !== false,
    showRecentTracksHeroCards: cfg.showRecentTracksHeroCards !== false,
    showRecentEpisodesHeroCards: cfg.showRecentEpisodesHeroCards !== false,
    showNextUpHeroCards: cfg.showNextUpHeroCards !== false,
    enableTop10Movies: enableRecentMaster && (cfg.enableTop10MoviesRow !== false),
    enableTop10Series: enableRecentMaster && (cfg.enableTop10SeriesRow !== false),
    enableTmdbTopMovies: enableRecentMaster && (cfg.enableTmdbTopMoviesRow !== false),
    enableRecentMovies: enableRecentMaster && (cfg.enableRecentMoviesRow !== false),
    enableRecentSeries: enableRecentMaster && (cfg.enableRecentSeriesRow !== false),
    enableRecentEpisodes: enableRecentMaster && (cfg.enableRecentEpisodesRow !== false),
    enableRecentMusic: enableRecentMaster && (cfg.enableRecentMusicRow !== false),
    enableRecentTracks: enableRecentMaster && (cfg.enableRecentMusicTracksRow !== false),
    enableContinueMovies: homeSectionsConfig.enableContinueMovies,
    enableContinueSeries: homeSectionsConfig.enableContinueSeries,
    enableNextUp: homeSectionsConfig.enableNextUpRowsSection,
    showContinueMoviesHeroCards: cfg.showContinueMoviesHeroCards !== false,
    showContinueSeriesHeroCards: cfg.showContinueSeriesHeroCards !== false,
    enableOtherLibRows: homeSectionsConfig.enableOtherLibRows,
    showOtherLibrariesHeroCards: cfg.showOtherLibrariesHeroCards !== false,
    effectiveRecentMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMoviesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentSeriesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentEpisodesCardCount, 10)),
    effectiveRecentMusicCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMusicCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentTracksCount: getEffectiveRowCount(clampPositiveCount(cfg.recentTracksCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveContinueMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueMoviesCardCount, 10)),
    effectiveContinueSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueSeriesCardCount, 10)),
    effectiveNextUpCount: getEffectiveRowCount(clampPositiveCount(cfg.nextUpCardCount, 10)),
    effectiveOtherRecentCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesRecentCardCount, 10)),
    effectiveOtherContinueCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesContinueCardCount, 10)),
    effectiveOtherEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesEpisodesCardCount, 10)),
  };
}

function isRecentRowsDebugEnabled() {
  try {
    if (window.__JMS_DEBUG_HOME_SECTIONS === true) return true;
    if (window.__JMS_DEBUG_HOME_SECTIONS === false) return false;
    const raw = localStorage.getItem(HOME_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return window.__JMS_DEBUG_HOME_SECTIONS === true;
  }
}

function buildRecentRowsDebugPayload(payload) {
  const extra = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : { value: payload };
  return {
    at: new Date().toISOString(),
    hash: String(window.location.hash || ""),
    page: getActiveHomePage?.()?.id || null,
    ...extra,
  };
}

function recentRowsLog(event, payload = {}) {
  if (!isRecentRowsDebugEnabled()) return;
  try { console.log("[JMS:RECENT]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function recentRowsWarn(event, payload = {}) {
  if (!isRecentRowsDebugEnabled()) return;
  try { console.warn("[JMS:RECENT]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function isRecentRowsTraceEnabled() {
  try {
    if (window.__JMS_TRACE_HOME_SECTIONS === true) return true;
    if (window.__JMS_TRACE_HOME_SECTIONS === false) return false;
    const raw = localStorage.getItem(HOME_TRACE_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return false;
  }
}

function recentRowsTrace(event, payload = {}) {
  if (!isRecentRowsTraceEnabled()) return;
  try { console.warn("[JMS:RECENT:TRACE]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function buildTraceStack(limit = 6) {
  try {
    return new Error().stack?.split("\n").slice(0, Math.max(2, limit | 0)).join("\n") || "";
  } catch {
    return "";
  }
}

const STATE = {
    started: false,
    wrapEl: null,
    hostEl: null,
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
    hadMountedSections: false,
};

const __albumPreviewTrackCache = new Map();

let __recentMountPromise = null;
let __recentRowsRetryTo = null;
let __recentRowsSelfHealObserver = null;
let __recentRowsSelfHealTimer = null;
let __recentRowsSelfHealPending = false;

const RECENT_ROW_SECTION_META = Object.freeze({
  top10SeriesRows: {
    id: "top10-series-rows",
    flag: "__jmsTop10SeriesRowsDone",
    event: "jms:top10-series-rows-done"
  },
  top10MovieRows: {
    id: "top10-movie-rows",
    flag: "__jmsTop10MovieRowsDone",
    event: "jms:top10-movie-rows-done"
  },
  tmdbTopMoviesRows: {
    id: "tmdb-top-movie-rows",
    flag: "__jmsTmdbTopMoviesRowsDone",
    event: "jms:tmdb-top-movie-rows-done"
  },
  recentRows: {
    id: "recent-rows",
    flag: "__jmsRecentRowsDone",
    event: "jms:recent-rows-done"
  },
  continueRows: {
    id: "continue-rows",
    flag: "__jmsContinueRowsDone",
    event: "jms:continue-rows-done"
  },
  nextUpRows: {
    id: "nextup-rows",
    flag: "__jmsNextUpRowsDone",
    event: "jms:nextup-rows-done"
  }
});

const TTL_RECENT_MS   = Number.isFinite(config.recentRowsCacheTTLms) ? Math.max(5_000, config.recentRowsCacheTTLms|0) : 90_000;
const TTL_CONTINUE_MS = Number.isFinite(config.continueRowsCacheTTLms) ? Math.max(5_000, config.continueRowsCacheTTLms|0) : 45_000;
const TTL_TOP10_MS    = 2 * 60 * 60 * 1000;
const TOP10_CACHE_POOL_SIZE = 20;
const TOP_RANK_QUERY_POOL_MULTIPLIER = 4;
const TMDB_TOP_MOVIE_POOL_SIZE = 240;
const TMDB_TOP_RATED_PAGE_LIMIT = 8;
const TOP_RANK_PROFILE_TTL_MS = 10 * 60 * 1000;
const TOP_RANK_GENRE_WEIGHTS = Object.freeze([1, 0.86, 0.74, 0.62, 0.5]);
const FAMILY_FRIENDLY_RATINGS = new Set(["G", "PG", "TV-G", "TV-PG"]);

const __topRankProfileCache = new Map();

function metaKey(kind, type){ return `rr:${kind}:${type}`; }
function movieLibMetaSuffix(movieLibId){ return movieLibId ? `@movie:${movieLibId}` : ""; }
function tvLibMetaSuffix(tvLibId){ return tvLibId ? `@tv:${tvLibId}` : ""; }

function isRecentRowsHomeRoute() {
  const h = String(window.location.hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function getRecentRowSectionMeta(sectionKey = "recentRows") {
  return RECENT_ROW_SECTION_META[sectionKey] || RECENT_ROW_SECTION_META.recentRows;
}

function getManagedRecentRowsSectionPrefix(sectionKey = "recentRows") {
  return `${getRecentRowSectionMeta(sectionKey).id}--`;
}

function makeManagedRecentRowsSectionId(sectionKey = "recentRows", index = 0) {
  return `${getManagedRecentRowsSectionPrefix(sectionKey)}${Math.max(0, index | 0)}`;
}

function getManagedRecentRowsSections(sectionKey = "recentRows", root = getActiveHomePage() || document) {
  const prefix = getManagedRecentRowsSectionPrefix(sectionKey);
  return Array.from(root?.querySelectorAll?.(`[id^="${prefix}"]`) || [])
    .filter((el) => el?.isConnected)
    .sort((left, right) => {
      const li = Number(String(left.id || "").slice(prefix.length)) || 0;
      const ri = Number(String(right.id || "").slice(prefix.length)) || 0;
      return li - ri;
    });
}

function cleanupManagedRecentRowsSections(sectionKey = "recentRows", root = getActiveHomePage() || document) {
  for (const section of getManagedRecentRowsSections(sectionKey, root)) {
    try {
      section.querySelectorAll(".personal-recs-card, .dir-row-hero").forEach((el) => {
        try { el.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
      section.querySelectorAll(".personal-recs-row").forEach((row) => {
        try { row.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
    } catch {}
    try { section.remove(); } catch {}
  }
}

function getMountedRecentRowsPage() {
  const visiblePage =
    getActiveHomePageEl?.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  if (visiblePage?.isConnected) {
    const visibleHasManagedRows = Object.values(RECENT_ROW_SECTION_META).some((meta) => (
      !!visiblePage.querySelector?.(`#${meta.id}, [id^="${meta.id}--"]`)
    ));
    if (visibleHasManagedRows) return visiblePage;
  }

  for (const meta of Object.values(RECENT_ROW_SECTION_META)) {
    const wrap = document.getElementById(meta.id);
    const wrapPage = wrap?.closest?.("#indexPage, #homePage");
    if (wrapPage?.isConnected) return wrapPage;

    const section = document.querySelector(`[id^="${meta.id}--"]`);
    const sectionPage = section?.closest?.("#indexPage, #homePage");
    if (sectionPage?.isConnected) return sectionPage;
  }
  return visiblePage?.isConnected ? visiblePage : null;
}

function setManagedRecentRowsDone(sectionKey, done) {
  const meta = getRecentRowSectionMeta(sectionKey);
  const next = !!done;
  let prev = false;
  try { prev = window[meta.flag] === true; } catch {}
  try { window[meta.flag] = next; } catch {}
  if (next && !prev) {
    recentRowsTrace("section:done", {
      sectionKey,
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    try { document.dispatchEvent(new Event(meta.event)); } catch {}
  }
}

function setRecentRowsDone(done) {
  setManagedRecentRowsDone("recentRows", done);
}

function setContinueRowsDone(done) {
  setManagedRecentRowsDone("continueRows", done);
}

function setNextUpRowsDone(done) {
  setManagedRecentRowsDone("nextUpRows", done);
}

function hasTop10SeriesRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTop10Series === true;
}

function hasTop10MovieRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTop10Movies === true;
}

function hasTmdbTopMoviesRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTmdbTopMovies === true;
}

function hasRecentRowsSectionEnabled(runtimeCfg) {
  return !!(
    runtimeCfg.enableRecentMovies ||
    runtimeCfg.enableRecentSeries ||
    runtimeCfg.enableRecentEpisodes ||
    runtimeCfg.enableRecentMusic ||
    runtimeCfg.enableOtherLibRows
  );
}

function hasContinueRowsSectionEnabled(runtimeCfg) {
  return !!(
    runtimeCfg.enableRecentTracks ||
    runtimeCfg.enableContinueMovies ||
    runtimeCfg.enableContinueSeries ||
    runtimeCfg.enableOtherLibRows
  );
}

function hasNextUpRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableNextUp === true;
}

function getOrderedRecentRowSectionKeys(cfg, runtimeCfg) {
  const enabled = new Set();
  if (hasTop10SeriesRowsSectionEnabled(runtimeCfg)) enabled.add("top10SeriesRows");
  if (hasTop10MovieRowsSectionEnabled(runtimeCfg)) enabled.add("top10MovieRows");
  if (hasTmdbTopMoviesRowsSectionEnabled(runtimeCfg)) enabled.add("tmdbTopMoviesRows");
  if (hasRecentRowsSectionEnabled(runtimeCfg)) enabled.add("recentRows");
  if (hasContinueRowsSectionEnabled(runtimeCfg)) enabled.add("continueRows");
  if (hasNextUpRowsSectionEnabled(runtimeCfg)) enabled.add("nextUpRows");
  if (!enabled.size) return [];

  const ordered = getManagedHomeSectionRuntimeOrder(cfg, { enabledOnly: true })
    .filter((key) => enabled.has(key));
  return ordered.length ? ordered : Array.from(enabled);
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

async function readCachedList(kind, type, ttlMs, {
  validateIds = true
} = {}) {
  if (!STATE.db || !STATE.scope) return { ids: [], fresh: false };
  try {
    const rec = await getMeta(STATE.db, metaKey(kind, type) + "|" + STATE.scope);
    const ids = Array.isArray(rec?.ids) ? Array.from(new Set(rec.ids.filter(Boolean))) : [];
    const updatedAt = Number(rec?.updatedAt) || 0;
    const fresh = (Date.now() - updatedAt) <= ttlMs;

    let liveIds = ids;
    if (validateIds) {
      try {
        const reconciled = await filterExistingCachedIds(ids);
        liveIds = reconciled.ids;
        if (reconciled.validated && !sameIdList(ids, liveIds)) {
          await writeCachedList(kind, type, liveIds);
        }
      } catch {}
    }

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

async function loadCachedRowItems(kind, type, ttlMs, {
  limit = 0,
  afterLoad = null,
  refreshUserData = false,
  validateIds = true,
  transformItems = null
} = {}) {
  const { ids, fresh } = await readCachedList(kind, type, ttlMs, { validateIds });
  if (!ids.length) return { items: [], fresh: false };

  const take = limit > 0 ? Math.max(1, limit | 0) : ids.length;
  let items = await fetchItemsByIds(ids.slice(0, take), { refreshUserData });
  if (typeof afterLoad === "function") {
    await afterLoad(items);
  }
  if (typeof transformItems === "function") {
    try {
      const nextItems = await transformItems(items);
      if (Array.isArray(nextItems)) {
        items = nextItems;
      }
    } catch {}
  }

  return {
    items: items.slice(0, take),
    fresh,
  };
}

function filterCachedTop10PlayableItems(items = []) {
  return uniqById(
    (Array.isArray(items) ? items : [])
      .filter((item) => item?.Id && !hasPlaybackActivity(item))
  );
}

async function loadCachedLocalTop10Items(kind, type, ttlMs) {
  const cached = await loadCachedRowItems(kind, type, ttlMs, {
    limit: TOP10_CACHE_POOL_SIZE,
    refreshUserData: true,
    validateIds: false,
    transformItems: filterCachedTop10PlayableItems
  });

  return {
    items: (Array.isArray(cached?.items) ? cached.items : []).slice(0, TOP10_ROW_CARD_COUNT),
    fresh: !!cached?.fresh && ((Array.isArray(cached?.items) ? cached.items.length : 0) > 0),
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

function buildPosterImageUrl(item) {
  return buildPosterUrl(item, 540, 72) || buildPosterUrl(item, 80, 20) || null;
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

function buildBackdropImageUrl(item) {
  return buildBackdropUrl(item, 1920, 80) || buildBackdropUrl(item, 420, 25) || buildPosterImageUrl(item) || null;
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

function hasPlaybackActivity(item) {
  const ud = item?.UserData || item?.UserDataDto || null;
  if (!ud) return false;
  if (ud.Played === true) return true;

  const playedPct = Number(ud.PlayedPercentage);
  if (Number.isFinite(playedPct) && playedPct > 0) return true;

  const pos = Number(ud.PlaybackPositionTicks);
  if (Number.isFinite(pos) && pos > 0) return true;

  const lastPlayedTs = getLastPlayedTs(item);
  return lastPlayedTs > 0;
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

function normalizeIdList(ids) {
  return Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
}

function resolveScopedParentIds(allIds, selectedIds) {
  const all = normalizeIdList(allIds);
  if (!all.length) return [];

  const selected = normalizeIdList(selectedIds).filter((id) => all.includes(id));
  if (!selected.length || selected.length >= all.length) {
    return [];
  }
  return selected;
}

function buildTopRowMetaType(type, parentIds = []) {
  const scoped = normalizeIdList(parentIds).sort();
  return scoped.length ? `${type}@top:${scoped.join(",")}` : type;
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function toTimestamp(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function getProviderIdValue(item, key) {
  const bag = item?.ProviderIds || item?.Providerids || item?.providerIds || null;
  if (!bag || !key) return "";
  const candidates = [
    bag[key],
    bag[String(key).toLowerCase()],
    bag[String(key).toUpperCase()],
    key === "Tmdb" ? bag.TMDb : null,
    key === "Imdb" ? bag.IMDb : null,
    key === "Tmdb" ? bag.MovieDb : null,
  ].filter(Boolean);
  return String(candidates[0] || "").trim();
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function getItemYear(item) {
  const year = Number(item?.ProductionYear);
  if (Number.isFinite(year) && year > 0) return year | 0;
  const premiereTs = toTimestamp(item?.PremiereDate);
  if (!premiereTs) return 0;
  return new Date(premiereTs).getUTCFullYear();
}

function buildTitleYearKey(title, year) {
  const normalizedTitle = normalizeComparableText(title);
  const normalizedYear = Number(year);
  if (!normalizedTitle || !Number.isFinite(normalizedYear) || normalizedYear <= 0) return "";
  return `${normalizedTitle}|${normalizedYear | 0}`;
}

function getTmdbResultYear(result) {
  return getItemYear({
    ProductionYear: result?.release_date ? new Date(result.release_date).getUTCFullYear() : null,
    PremiereDate: result?.release_date || null
  });
}

async function getTopRankUserProfile(userId) {
  const cacheKey = String(userId || STATE.userId || "").trim() || "default";
  const now = Date.now();
  const cached = __topRankProfileCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached?.pending) {
    return cached.pending;
  }

  const pending = (async () => {
    const rawTopGenres = await getCachedUserTopGenres(5).catch(() => []);
    const topGenres = Array.isArray(rawTopGenres) ? rawTopGenres : [];
    const normalizedGenres = [];
    const queryGenres = [];
    const seen = new Set();
    for (const genre of topGenres) {
      const key = normalizeComparableText(genre);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalizedGenres.push(key);
      queryGenres.push(String(genre || "").trim());
      if (normalizedGenres.length >= TOP_RANK_GENRE_WEIGHTS.length) break;
    }

    const genreWeights = new Map();
    normalizedGenres.forEach((genre, index) => {
      genreWeights.set(genre, TOP_RANK_GENRE_WEIGHTS[index] ?? 0.4);
    });

    return {
      currentYear: new Date().getFullYear(),
      topGenres: normalizedGenres,
      queryGenres,
      genreWeights,
    };
  })()
    .then((value) => {
      __topRankProfileCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + TOP_RANK_PROFILE_TTL_MS,
        pending: null
      });
      return value;
    })
    .catch((error) => {
      __topRankProfileCache.delete(cacheKey);
      throw error;
    });

  __topRankProfileCache.set(cacheKey, {
    value: cached?.value || null,
    expiresAt: cached?.expiresAt || 0,
    pending
  });
  return pending;
}

function getTopRankGenreMatch(item, profile) {
  const itemGenres = Array.isArray(item?.Genres) ? item.Genres : [];
  if (!itemGenres.length || !(profile?.genreWeights instanceof Map) || !profile.genreWeights.size) {
    return { score: 0, matches: 0 };
  }

  let score = 0;
  let matches = 0;
  const matched = new Set();

  for (const genre of itemGenres) {
    const key = normalizeComparableText(genre);
    if (!key || matched.has(key)) continue;
    const weight = profile.genreWeights.get(key);
    if (!Number.isFinite(weight)) continue;
    matched.add(key);
    matches++;
    score += 14 * weight;
  }

  if (matches >= 2) score += 5;
  if (matches >= 3) score += 4;
  return { score, matches };
}

function scoreTopRankCommunityRating(rating) {
  const value = clampNumber(rating, 0, 10);
  if (value >= 9.2) return 18;
  if (value >= 8.7) return 15;
  if (value >= 8.2) return 11;
  if (value >= 7.6) return 7;
  if (value >= 6.9) return 4;
  return 0;
}

function scoreTopRankCriticRating(critic) {
  const value = clampNumber(critic, 0, 100);
  if (value >= 95) return 16;
  if (value >= 90) return 13;
  if (value >= 82) return 10;
  if (value >= 74) return 6;
  if (value >= 65) return 3;
  return 0;
}

function getTopRankMatchPercentage(item, profile, sourceCount = 1) {
  const playedPct = clampNumber(item?.UserData?.PlayedPercentage, 0, 100);
  const rating = clampNumber(item?.CommunityRating, 0, 10);
  const critic = clampNumber(item?.CriticRating, 0, 100);
  const year = getItemYear(item);
  const age = year > 0 && profile?.currentYear ? Math.max(0, profile.currentYear - year) : null;
  const genreMatch = getTopRankGenreMatch(item, profile);

  let score = 38;
  score += genreMatch.score;
  score += scoreTopRankCommunityRating(rating);
  score += scoreTopRankCriticRating(critic);

  if (age != null) {
    if (age <= 3) score += 6;
    else if (age <= 8) score += 4;
    else if (age <= 15) score += 2;
  }

  if (item?.UserData?.IsFavorite === true) score += 6;
  if (playedPct > 0 && playedPct < 85) score += 4;
  if (FAMILY_FRIENDLY_RATINGS.has(String(item?.OfficialRating || "").trim())) score += 2;
  if (sourceCount >= 4) score += 8;
  else if (sourceCount === 3) score += 6;
  else if (sourceCount === 2) score += 3;

  if (hasPlaybackActivity(item)) score -= 8;
  if (!String(item?.Overview || "").trim()) score -= 2;

  if (rating >= 9 && critic < 70 && genreMatch.matches === 0 && sourceCount < 2) {
    score -= 16;
  } else if (rating >= 8.6 && critic <= 0 && genreMatch.matches === 0 && sourceCount < 2) {
    score -= 10;
  }

  return clampNumber(Math.round(score), 0, 100);
}

function getTopRankCompositeBoost(entry, profile) {
  const sourceCount = entry?.sources instanceof Set ? entry.sources.size : 1;
  const matchPercentage = getTopRankMatchPercentage(entry?.item, profile, sourceCount);
  const critic = clampNumber(entry?.item?.CriticRating, 0, 100);
  const community = clampNumber(entry?.item?.CommunityRating, 0, 10);

  let boost = matchPercentage * 6.2;
  if (critic >= 85 && community >= 7.8) boost += 22;
  if (sourceCount >= 3) boost += 10;
  if (sourceCount === 1 && community >= 8.8 && critic <= 0) boost -= 18;
  return boost;
}

function getTopRankSignals(item, index = 0, modeKey = "rating", queryWeight = 1) {
  const playedPct = clampNumber(item?.UserData?.PlayedPercentage, 0, 100);
  const year = getItemYear(item);
  const now = Date.now();
  const premiereAgeDays = (() => {
    const ts = toTimestamp(item?.PremiereDate);
    if (!ts) return null;
    return Math.max(0, (now - ts) / 86400000);
  })();
  const createdAgeDays = (() => {
    const ts = toTimestamp(item?.DateCreated);
    if (!ts) return null;
    return Math.max(0, (now - ts) / 86400000);
  })();

  const orderBias =
    modeKey === "playCount" ? 1.08 :
    modeKey === "profile" ? 0.98 :
    modeKey === "premiere" ? 0.96 :
    modeKey === "created" ? 0.9 :
    0.72;
  const orderScore = Math.max(0, 64 - index) * 4.15 * queryWeight * orderBias;
  const ratingScore = scoreTopRankCommunityRating(item?.CommunityRating) * 1.3;
  const criticScore = scoreTopRankCriticRating(item?.CriticRating) * 1.15;
  const yearScore = year > 0 ? Math.max(0, year - 1998) * 0.18 : 0;
  const freshnessScore = hasPlaybackActivity(item) ? 0 : 12;
  const favoriteScore = item?.UserData?.IsFavorite === true ? 10 : 0;
  const progressScore = (
    Number.isFinite(playedPct) && playedPct > 0 && playedPct < 95
      ? Math.max(0, 10 - Math.abs(50 - playedPct) * 0.14)
      : 0
  );
  const premiereScore = premiereAgeDays == null ? 0 : Math.max(0, 2400 - premiereAgeDays) * 0.0065;
  const createdScore = createdAgeDays == null ? 0 : Math.max(0, 540 - createdAgeDays) * 0.014;
  const modeBonus =
    modeKey === "playCount" ? 24 :
    modeKey === "profile" ? 16 :
    modeKey === "rating" ? 5 :
    modeKey === "premiere" ? 13 :
    8;

  return orderScore + ratingScore + criticScore + yearScore + freshnessScore + favoriteScore + progressScore + premiereScore + createdScore + modeBonus;
}

const TOP_RANK_SORT_MODES = Object.freeze([
  { key: "playCount", sortBy: "PlayCount,CommunityRating,PremiereDate,DateCreated", weight: 1.0 },
  { key: "rating", sortBy: "CommunityRating,PremiereDate,DateCreated", weight: 0.56 },
  { key: "premiere", sortBy: "PremiereDate,CommunityRating,DateCreated", weight: 0.76 },
  { key: "created", sortBy: "DateCreated,CommunityRating,PremiereDate", weight: 0.62 }
]);

const TOP_RANK_FIELDS = [
  COMMON_FIELDS,
  "CriticRating",
  "DateCreated",
  "PremiereDate",
  "ProviderIds",
  "OriginalTitle"
].join(",");

function mergeRankedEntry(map, item, score, sourceKey) {
  if (!item?.Id || !Number.isFinite(score)) return;
  const prev = map.get(item.Id);
  if (!prev) {
    map.set(item.Id, { item, score, sources: new Set([sourceKey]) });
    return;
  }

  if (!prev.sources.has(sourceKey)) {
    const previousScore = prev.score;
    prev.score = Math.max(previousScore, score) + (Math.min(previousScore, score) * 0.35);
    prev.sources.add(sourceKey);
    if (score >= previousScore) prev.item = item;
    return;
  }

  if (score > prev.score) {
    prev.score = score;
    prev.item = item;
  }
}

async function fetchTopRankedEntryPool(userId, type, poolSize, parentId, { filters = "" } = {}) {
  const want = Math.max(24, poolSize | 0);
  const merged = new Map();
  let lastError = null;
  const profile = await getTopRankUserProfile(userId).catch(() => null);

  for (const mode of TOP_RANK_SORT_MODES) {
    const url =
      `/Users/${userId}/Items?` +
      `IncludeItemTypes=${encodeURIComponent(type)}&Recursive=true&Fields=${encodeURIComponent(TOP_RANK_FIELDS)}&` +
      `EnableUserData=true&` +
      (filters ? `Filters=${encodeURIComponent(filters)}&` : ``) +
      (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
      `SortBy=${encodeURIComponent(mode.sortBy)}&SortOrder=Descending&Limit=${want}&` +
      `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
    try {
      const data = await makeApiRequest(url);
      const items = uniqById(Array.isArray(data?.Items) ? data.Items : [])
        .filter((it) => it?.Type === type)
        .slice(0, want);
      if (!items.length) continue;

      try {
        if (STATE.db && STATE.scope) {
          upsertItemsBatchIdle(STATE.db, STATE.scope, items, { timeout: 1500 });
        }
      } catch {}

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const score = getTopRankSignals(item, i, mode.key, mode.weight);
        mergeRankedEntry(merged, item, score, mode.key);
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (profile?.queryGenres?.length) {
    const url =
      `/Users/${userId}/Items?` +
      `IncludeItemTypes=${encodeURIComponent(type)}&Recursive=true&Fields=${encodeURIComponent(TOP_RANK_FIELDS)}&` +
      `EnableUserData=true&` +
      (filters ? `Filters=${encodeURIComponent(filters)}&` : ``) +
      (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
      `Genres=${encodeURIComponent(profile.queryGenres.join("|"))}&` +
      `SortBy=${encodeURIComponent("CommunityRating,PremiereDate,DateCreated")}&SortOrder=Descending&Limit=${want}&` +
      `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
    try {
      const data = await makeApiRequest(url);
      const items = uniqById(Array.isArray(data?.Items) ? data.Items : [])
        .filter((it) => it?.Type === type)
        .slice(0, want);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const score = getTopRankSignals(item, i, "profile", 0.88);
        mergeRankedEntry(merged, item, score, "profile");
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (merged.size) {
    return Array.from(merged.values())
      .map((entry) => ({
        ...entry,
        score: entry.score + getTopRankCompositeBoost(entry, profile)
      }))
      .sort((a, b) => b.score - a.score);
  }

  if (lastError) {
    console.warn("recentRows: top ranked fetch error:", type, parentId || "all", lastError);
  }
  return [];
}

async function fetchTopRankedEntryPoolAcrossParents(userId, type, poolSize, parentIds = [], { filters = "" } = {}) {
  const scopedParents = normalizeIdList(parentIds);
  if (!scopedParents.length) {
    return fetchTopRankedEntryPool(userId, type, poolSize, null, { filters });
  }
  if (scopedParents.length === 1) {
    return fetchTopRankedEntryPool(userId, type, poolSize, scopedParents[0], { filters });
  }

  const candidateLists = await Promise.all(
    scopedParents.map(async (parentId) => ({
      parentId,
      entries: await fetchTopRankedEntryPool(userId, type, poolSize, parentId, { filters })
    }))
  );

  const merged = new Map();
  for (const entry of candidateLists) {
    for (let i = 0; i < entry.entries.length; i++) {
      const ranked = entry.entries[i];
      if (!ranked?.item?.Id) continue;
      const libraryScore = ranked.score + Math.max(0, 36 - i) * 2.6;
      mergeRankedEntry(merged, ranked.item, libraryScore, `lib:${entry.parentId}`);
    }
  }

  const out = Array.from(merged.values()).sort((a, b) => b.score - a.score);
  if (out.length) return out;
  return fetchTopRankedEntryPool(userId, type, poolSize, null, { filters });
}

async function fetchTopRankedAcrossParents(userId, type, limit, parentIds = [], { poolSize = null } = {}) {
  const resolvedPoolSize = Math.max(limit, poolSize || (limit * TOP_RANK_QUERY_POOL_MULTIPLIER));
  const entries = await fetchTopRankedEntryPoolAcrossParents(userId, type, resolvedPoolSize, parentIds);
  const items = entries.map((entry) => entry.item);
  return items.slice(0, limit);
}

async function fetchTopRankedUnplayedFirstAcrossParents(userId, type, limit, parentIds = [], { poolSize = null } = {}) {
  const resolvedPoolSize = Math.max(limit, poolSize || (limit * TOP_RANK_QUERY_POOL_MULTIPLIER));
  const unseenEntries = await fetchTopRankedEntryPoolAcrossParents(
    userId,
    type,
    resolvedPoolSize,
    parentIds,
    { filters: "IsUnplayed" }
  );
  const unseenItems = unseenEntries
    .map((entry) => entry.item)
    .filter((item) => item && !hasPlaybackActivity(item));
  if (unseenItems.length >= limit) {
    return unseenItems.slice(0, limit);
  }

  const fallbackEntries = await fetchTopRankedEntryPoolAcrossParents(userId, type, resolvedPoolSize, parentIds);
  const seenIds = new Set(unseenItems.map((item) => item?.Id).filter(Boolean));
  const fallbackItems = fallbackEntries
    .map((entry) => entry.item)
    .filter((item) => item?.Id && !seenIds.has(item.Id));

  return [...unseenItems, ...fallbackItems].slice(0, limit);
}

function buildTmdbMovieLookup(items = []) {
  const byTmdbId = new Map();
  const byTitleYear = new Map();

  for (const item of items) {
    if (!item?.Id) continue;
    const tmdbId =
      getProviderIdValue(item, "Tmdb") ||
      getProviderIdValue(item, "TMDb") ||
      getProviderIdValue(item, "MovieDb");
    if (tmdbId && !byTmdbId.has(tmdbId)) {
      byTmdbId.set(tmdbId, item);
    }

    const year = getItemYear(item);
    for (const title of [item?.Name, item?.OriginalTitle]) {
      const key = buildTitleYearKey(title, year);
      if (key && !byTitleYear.has(key)) {
        byTitleYear.set(key, item);
      }
    }
  }

  return { byTmdbId, byTitleYear };
}

function resolveTmdbResultToLocalMovie(result, lookup) {
  const tmdbId = String(result?.id || "").trim();
  if (tmdbId && lookup?.byTmdbId?.has(tmdbId)) {
    return lookup.byTmdbId.get(tmdbId) || null;
  }

  const releaseYear = getTmdbResultYear(result);
  const years = releaseYear > 0 ? [releaseYear, releaseYear - 1, releaseYear + 1] : [];
  const titles = [result?.title, result?.original_title];

  for (const title of titles) {
    for (const year of years) {
      const key = buildTitleYearKey(title, year);
      if (key && lookup?.byTitleYear?.has(key)) {
        return lookup.byTitleYear.get(key) || null;
      }
    }
  }

  return null;
}

async function tmdbFetchJson(path, { signal } = {}) {
  const apiKey = await getGlobalTmdbApiKey().catch(() => "");
  if (!apiKey) throw new Error("TMDb API key missing");

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString(), {
    method: "GET",
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDb HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchTmdbTopRatedMoviesInLibraries(userId, limit, parentIds = []) {
  const apiKey = await getGlobalTmdbApiKey().catch(() => "");
  if (!apiKey) {
    return {
      items: [],
      reason: "missingKey"
    };
  }

  const rankedPool = await fetchTopRankedEntryPoolAcrossParents(
    userId,
    "Movie",
    TMDB_TOP_MOVIE_POOL_SIZE,
    parentIds
  );
  const lookup = buildTmdbMovieLookup(rankedPool.map((entry) => entry.item));
  if (!lookup.byTmdbId.size && !lookup.byTitleYear.size) {
    return {
      items: [],
      reason: "noLocalCandidates"
    };
  }

  const matched = [];
  const seenIds = new Set();
  const language = String(navigator.language || "en-US").trim() || "en-US";

  for (let page = 1; page <= TMDB_TOP_RATED_PAGE_LIMIT && matched.length < limit; page++) {
    let data = null;
    try {
      data = await tmdbFetchJson(`/movie/top_rated?language=${encodeURIComponent(language)}&page=${page}`);
    } catch (e) {
      console.warn("recentRows: tmdb top rated fetch error:", e);
      return {
        items: matched.slice(0, limit),
        reason: matched.length ? "partial" : "fetchError"
      };
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) break;

    for (const result of results) {
      const localItem = resolveTmdbResultToLocalMovie(result, lookup);
      if (!localItem?.Id || seenIds.has(localItem.Id)) continue;
      seenIds.add(localItem.Id);
      matched.push(localItem);
      if (matched.length >= limit) break;
    }
  }

  return {
    items: matched.slice(0, limit),
    reason: matched.length ? "ok" : "noMatches"
  };
}

function getTopMovieParentIds() {
  return resolveScopedParentIds(
    (STATE.movieLibs || []).map((lib) => lib.Id),
    resolveMovieLibSelection()
  );
}

function getTopSeriesParentIds() {
  return resolveScopedParentIds(
    (STATE.tvLibs || []).map((lib) => lib.Id),
    resolveTvLibSelection("recentSeries")
  );
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

function queueEnterAnimation(el) {
  if (!el) return el;
  el.classList.add("is-entering");
  const clear = () => {
    try { el.classList.remove("is-entering"); } catch {}
  };
  try {
    requestAnimationFrame(() => {
      requestAnimationFrame(clear);
    });
  } catch {
    setTimeout(clear, 34);
  }
  return el;
}

function createRecommendationCard(item, serverId, {
  aboveFold = false,
  showProgress = false,
  variant = "default",
  rank = null
} = {}) {
  const { itemId, itemName } = primeItemIdentity(item);
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  const isTop10 = variant === "top10";
  if (isTop10) card.classList.add("top10-card");
  queueEnterAnimation(card);
  if (itemId) card.dataset.itemId = itemId;
  if (isTop10 && Number.isFinite(rank)) card.dataset.rank = String(rank);

  const posterSource = item?.__posterSource || item;

  const posterUrlStatic = buildPosterImageUrl(posterSource);

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
  const top10IsFresh = isTop10 && !hasPlaybackActivity(item);

  const community = Number.isFinite(posterSource.CommunityRating)
    ? `<div class="community-rating" title="${escapeHtml(config.languageLabels.communityRating || "Community Rating")}">⭐ ${posterSource.CommunityRating.toFixed(1)}</div>`
    : "";
  const top10RankHtml = (isTop10 && Number.isFinite(rank))
    ? `<div class="top10-rank" aria-hidden="true">${Math.max(1, rank | 0)}</div>`
    : "";
  const top10FreshBadgeHtml = top10IsFresh
    ? `<div class="top10-fresh-badge">${escapeHtml(getBadgeText("new"))}</div>`
    : "";
  const topBadgesHtml = isTop10
    ? `
      <div class="prc-top-badges top10-top-badges">
        <div class="prc-type-badge top10-type-badge">
          ${faIconHtml(typeIcon, "prc-type-icon")}
          ${typeLabel}
        </div>
      </div>
    `
    : `
      <div class="prc-top-badges">
        ${community}
        <div class="prc-type-badge">
          ${faIconHtml(typeIcon, "prc-type-icon")}
          ${typeLabel}
        </div>
      </div>
    `;

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
  const logoUrl =
    buildLogoUrl(item) ||
    (posterSource !== item ? buildLogoUrl(posterSource) : null);
  const escapedTitleHtml = escapeHtml(clampText(mainTitle, isTop10 ? 38 : 42));
  const escapedSubTitle = isEpisode && subTitle ? escapeHtml(subTitle) : "";
  const logoAltSuffix = (config.languageLabels && config.languageLabels.logoAltSuffix) || "logo";
  const fallbackTitleHtml = isTop10
    ? `
      <div class="prc-titleline">
        ${escapedTitleHtml}
        ${escapedSubTitle ? `<div class="prc-subtitleline">${escapedSubTitle}</div>` : ``}
      </div>
    `
    : "";
  const managedTitleRender = isTop10
    ? null
    : resolveManagedCardTitleRender({
        titleText: mainTitle,
        subtitleText: subTitle,
        logoUrl,
        logoAltText: `${mainTitle} ${logoAltSuffix}`.trim(),
        aboveFold,
        maxTitleLength: 42,
      });
  const titleBlockHtml = isTop10
    ? (logoUrl
      ? `
        <div class="prc-card-logo">
          <img src="${escapeHtml(logoUrl)}"
            alt="${escapeHtml(`${mainTitle} ${logoAltSuffix}`.trim())}"
            loading="${aboveFold ? "eager" : "lazy"}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ""}>
        </div>
        ${escapedSubTitle ? `<div class="prc-subtitleline prc-logo-subtitle">${escapedSubTitle}</div>` : ``}
      `
      : fallbackTitleHtml)
    : managedTitleRender.html;

  const metaHtml = isTop10
    ? `
      <div class="prc-meta">
        ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
        ${year ? `<span class="prc-year">${year}</span>` : ""}
      </div>
    `
    : `
      <div class="prc-meta">
        ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
        ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
        ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
      </div>
    `;

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${itemId ? getDetailsUrl(itemId, serverId) : '#'}">
        <div class="cardImageContainer" style="position:relative;">
          ${top10RankHtml}
          <img class="cardImage"
            alt="${escapeHtml(mainTitle)}"
            loading="${aboveFold ? "eager" : "lazy"}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ""}>
          ${topBadgesHtml}
          ${top10FreshBadgeHtml}
          <div class="prc-gradient${isTop10 ? " top10-gradient" : ""}"></div>
          <div class="prc-overlay${isTop10 ? " top10-overlay" : ""}">
            ${titleBlockHtml}

            ${metaHtml}

            <div class="prc-genres">
              ${(!isEpisode && genres) ? escapeHtml(genres) : ""}
            </div>
          </div>
          ${progressHtml}
        </div>
      </a>
    </div>
  `;

  const logoImg = card.querySelector(".prc-card-logo img");
  if (logoImg) {
    logoImg.addEventListener("error", () => {
      try {
        const logoWrap = logoImg.closest(".prc-card-logo");
        if (!logoWrap?.isConnected) return;
        if (isTop10) {
          logoWrap.outerHTML = fallbackTitleHtml;
          const logoSubtitle = card.querySelector(".prc-logo-subtitle");
          if (logoSubtitle) logoSubtitle.remove();
          return;
        }
        logoWrap.remove();
      } catch {}
    }, { once: true });
  }

  const img = card.querySelector(".cardImage");
  try {
    const sizesMobile = isTop10
      ? "(max-width: 640px) 48vw, (max-width: 820px) 42vw, 300px"
      : showProgress
        ? "(max-width: 640px) 78vw, (max-width: 820px) 72vw, 320px"
        : "(max-width: 640px) 44vw, (max-width: 820px) 38vw, 262px";
    const sizesDesk = isTop10
      ? "(max-width: 1200px) 27vw, 300px"
      : showProgress
        ? "(max-width: 1200px) 34vw, 390px"
        : "(max-width: 1200px) 22vw, 262px";
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

  if (posterUrlStatic) {
    setManagedImageSource(img, posterUrlStatic, { fallback: PLACEHOLDER_URL });
  } else {
    try { img.style.display = "none"; } catch {}
    const noImg = document.createElement("div");
    noImg.className = "prc-noimg-label";
    noImg.textContent = config.languageLabels.noImage || "Görsel yok";
    noImg.style.minHeight = "100%";
    noImg.style.height = "100%";
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

  card.addEventListener("jms:cleanup", () => { cleanupManagedImage(img); }, { once:true });
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
  const bgSrc = buildBackdropImageUrl(posterSource);
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
  const heroLogoAltSuffix = (config.languageLabels && config.languageLabels.logoAltSuffix) || "logo";

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
            <img src="${logo}" alt="${escapeHtml(`${heroTitle} ${heroLogoAltSuffix}`.trim())}">
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
      setManagedImageSource(backdropImg, bgSrc, { fallback: PLACEHOLDER_URL });
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
      if (backdropImg) cleanupManagedImage(backdropImg);
    } catch {}
    detachPreviewHandlers(hero);
  }, { once: true });

  return hero;
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

async function fetchItemsByIds(ids, { refreshUserData = false } = {}) {
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
  const networkIds = refreshUserData ? clean.slice() : missing;

  let fetched = [];
  if (networkIds.length) {
    const chunkSize = 100;
    const out = [];
    for (let i = 0; i < networkIds.length; i += chunkSize) {
      const chunk = networkIds.slice(i, i + chunkSize);
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
    const it = fetchedById.get(id) || hydratedById.get(id) || null;
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

async function fetchNextUpEpisodes(userId, limit) {
  const url =
    `/Shows/NextUp?` +
    `UserId=${encodeURIComponent(userId)}&` +
    `Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    `Limit=${Math.max(20, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  try {
    const data = await makeApiRequest(url);
    const eps = Array.isArray(data?.Items) ? data.Items : [];
    const uniqEps = uniqById(eps).filter(isRealTvEpisode);

    await attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: next up episodes fetch error:", e);
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
  section.className = "homeSection recent-row-section dir-row-section";

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

function appendSection(sectionKey, sectionEl) {
  const scopedHost =
    STATE.hostEl?.classList?.contains?.("homeSectionsContainer")
      ? STATE.hostEl
      : (STATE.hostEl?.querySelector?.(".homeSectionsContainer") || null);
  const parent = scopedHost || findRealHomeSectionsContainer() || getActiveHomePage() || document.body;
  if (!parent || !sectionEl) return;

  const owned = getManagedRecentRowsSections(sectionKey, parent);
  const lastOwned = owned[owned.length - 1] || null;
  if (lastOwned?.parentElement === parent) {
    lastOwned.insertAdjacentElement("afterend", sectionEl);
  } else {
    appendToParent(parent, sectionEl);
  }
  STATE.hadMountedSections = true;
  try { keepManagedSectionsBelowNative(parent); } catch {}
}

function hasAnyManagedRecentRowsSections(sectionKeys = []) {
  return (sectionKeys || []).some((sectionKey) => getManagedRecentRowsSections(sectionKey).length > 0);
}

function isRecentRowsSelfHealDisabled() {
  try {
    const cfg = getConfig?.() || config || {};
    return cfg.enableSlider === false;
  } catch {
    return false;
  }
}

function scheduleRecentRowsSelfHeal(reason = "mutation", delayMs = 180) {
  if (isRecentRowsSelfHealDisabled()) {
    __recentRowsSelfHealPending = false;
    if (__recentRowsSelfHealTimer) {
      clearTimeout(__recentRowsSelfHealTimer);
      __recentRowsSelfHealTimer = null;
    }
    if (reason !== "observer") {
      recentRowsTrace("self-heal:skip:slider-disabled", { reason });
    }
    return;
  }
  __recentRowsSelfHealPending = true;
  if (__recentRowsSelfHealTimer) return;
  __recentRowsSelfHealTimer = setTimeout(() => {
    __recentRowsSelfHealTimer = null;
    if (!__recentRowsSelfHealPending) return;
    if (__recentMountPromise) {
      scheduleRecentRowsSelfHeal("post-mount", Math.max(220, delayMs | 0));
      return;
    }
    __recentRowsSelfHealPending = false;
    if (!STATE.hadMountedSections) return;
    if (!isRecentRowsHomeRoute() || !getActiveHomePage()) return;

    const cfg = getConfig();
    if (cfg?.enableSlider === false) return;
    const runtimeCfg = getRecentRowsRuntimeConfig(cfg);
    const sectionKeys = getOrderedRecentRowSectionKeys(cfg, runtimeCfg);
    if (!sectionKeys.length) return;
    if (hasAnyManagedRecentRowsSections(sectionKeys)) return;

    recentRowsWarn("self-heal:remount", {
      reason,
      sectionKeys,
    });
    void mountRecentRowsLazy({ force: true });
  }, Math.max(120, delayMs | 0));
}

function bindRecentRowsSelfHealObserver() {
  if (isRecentRowsSelfHealDisabled()) return;
  if (__recentRowsSelfHealObserver || typeof MutationObserver !== "function") return;
  const target = document.body || document.documentElement || null;
  if (!target) return;

  __recentRowsSelfHealObserver = new MutationObserver(() => {
    scheduleRecentRowsSelfHeal("observer");
  });

  try {
    __recentRowsSelfHealObserver.observe(target, {
      childList: true,
      subtree: true,
    });
  } catch {
    __recentRowsSelfHealObserver = null;
  }
}

function isDeferredRecentRowsSection(sectionKey) {
  return (
    sectionKey === "top10SeriesRows" ||
    sectionKey === "top10MovieRows" ||
    sectionKey === "tmdbTopMoviesRows"
  );
}

function hasMountedRecentRowsShell(sectionKey) {
  return getManagedRecentRowsSections(sectionKey).length > 0;
}

function hasAcceptedRecentRowsMountState(sectionKey) {
  if (hasRenderableRecentRowsContent(sectionKey)) return true;
  if (!isDeferredRecentRowsSection(sectionKey)) return false;
  return hasMountedRecentRowsShell(sectionKey);
}

async function fillSectionWithItems({
  sectionKey = "recentRows",
  sectionId = "",
  titleText,
  badgeType = 'new',
  heroLabel,
  fetcher,
  cardCount,
  showProgress,
  onSeeAll,
  randomHero = false,
  hideHero = false,
  sectionClassName = "",
  rowClassName = "",
  cardVariant = "default",
  allowEmptyRow = false,
  emptyMessage = "",
  deferNetworkRender = false,
}) {
  const { section, row, heroHost, scrollWrap, btnL, btnR } = buildSectionSkeleton({
    titleText,
    badgeType,
    onSeeAll
  });
  const resolveEmptyMessage = () => {
    const raw = typeof emptyMessage === "function" ? emptyMessage() : emptyMessage;
    return String(raw || config.languageLabels.noRecommendations || "Uygun içerik yok").trim();
  };
  const runtimeCfg = getRecentRowsRuntimeConfig();
  const useHero = runtimeCfg.showHeroCards && !hideHero;
  if (sectionClassName) section.classList.add(...String(sectionClassName).split(/\s+/).filter(Boolean));
  if (rowClassName) row.classList.add(...String(rowClassName).split(/\s+/).filter(Boolean));
  if (!useHero) heroHost.style.display = "none";
  if (sectionId) section.id = sectionId;
  section.dataset.managedSectionKey = sectionKey;

  try {
    await waitForManagedHomeRowRelease({
      anchor: getRecentRowsSectionAnchor(sectionKey, STATE.hostEl || getActiveHomePage() || document),
      eagerRows: RECENT_ROWS_EAGER_RELEASE_COUNT,
      timeoutMs: 25000,
      rootMargin: "0px 0px 0px 0px",
    });
  } catch {}
  appendSection(sectionKey, section);
  try { registerManagedHomeRowAnchor(section); } catch {}

  let __renderToken = (Date.now() ^ (Math.random()*1e9)) | 0;
  section.__renderToken = __renderToken;
  let __renderPass = 0;
  let progressiveHandle = null;

  const isRenderCurrent = () => (
    section.__renderToken === __renderToken &&
    !!section.isConnected &&
    isRecentRowsHomeRoute() &&
    !!section.closest?.("#indexPage, #homePage")?.isConnected
  );

  const stopProgressiveRender = () => {
    try { progressiveHandle?.cancel?.(); } catch {}
    progressiveHandle = null;
  };

  const finalizeScroller = () => {
    setupScroller(row);
    try { scrollWrap?.classList?.remove("rr-scroll-pending"); } catch {}
    try {
      if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; btnL.disabled = false; }
      if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; btnR.disabled = false; }
    } catch {}
  };

  const renderEmptyState = (message) => {
    stopProgressiveRender();
    if (!isRenderCurrent()) return false;
    row.innerHTML = `<div class="no-recommendations">${escapeHtml(message)}</div>`;
    finalizeScroller();
    return true;
  };

  const removeSection = () => {
    stopProgressiveRender();
    try { section.parentElement?.removeChild(section); } catch {}
    return false;
  };

  const renderResolvedItems = async (sourceItems, { aboveFoldLimit = 2 } = {}) => {
    stopProgressiveRender();
    const renderPass = ++__renderPass;
    const isPassCurrent = () => isRenderCurrent() && __renderPass === renderPass;
    if (!Array.isArray(sourceItems) || !sourceItems.length || !isRenderCurrent()) {
      return false;
    }

    const pool = sourceItems.slice();
    await attachMusicPosterSources(pool);
    if (!isPassCurrent()) return false;

    let best = null;
    if (useHero && pool.length) {
      if (randomHero) {
        const idx = pickRandomIndex(pool.length);
        best = idx >= 0 ? pool[idx] : pool[0];
      } else {
        best = pool[0];
      }
    }

    const remaining = useHero && best
      ? pool.filter((x) => x?.Id && x.Id !== best.Id)
      : pool.slice();

    heroHost.innerHTML = "";
    if (useHero && best) {
      const hero = await createRowHeroCard(best, STATE.serverId, heroLabel, { showProgress });
      if (!isPassCurrent()) return false;
      heroHost.appendChild(hero);
      queueEnterAnimation(hero);
    }

    row.innerHTML = "";
    if (!remaining.length) {
      return renderEmptyState(config.languageLabels.noRecommendations || "Uygun içerik yok");
    }
    const targetCount = Math.min(cardCount, remaining.length);
    let scrollerReady = false;
    const requestScrollSync = () => {
      try {
        if (!row.__rrScrollRaf) {
          row.__rrScrollRaf = requestAnimationFrame(() => {
            row.__rrScrollRaf = 0;
            try { row.dispatchEvent(new Event("scroll")); } catch {}
          });
        }
      } catch {}
    };

    return await new Promise((resolve) => {
      progressiveHandle = progressivelyRenderCardRow({
        row,
        items: remaining,
        limit: targetCount,
        initialCount: Math.min(
          targetCount,
          IS_MOBILE
            ? Math.max(2, Math.min(targetCount, aboveFoldLimit))
            : Math.max(3, Math.min(5, targetCount))
        ),
        chunkSize: IS_MOBILE ? 2 : 3,
        delayMs: IS_MOBILE ? 78 : 32,
        isCurrent: isPassCurrent,
        appendCard: (item, index) => createRecommendationCard(item, STATE.serverId, {
          aboveFold: index < Math.max(1, Math.min(aboveFoldLimit, IS_MOBILE ? 2 : 4)),
          showProgress,
          variant: cardVariant,
          rank: cardVariant === "top10" ? (index + 1) : null
        }),
        onAppend: () => {
          if (!scrollerReady) {
            finalizeScroller();
            scrollerReady = true;
          } else {
            requestScrollSync();
          }
        },
        onComplete: ({ aborted = false } = {}) => {
          progressiveHandle = null;
          if (isPassCurrent()) {
            if (!scrollerReady) {
              finalizeScroller();
            } else {
              requestScrollSync();
            }
          }
          resolve(!aborted && isPassCurrent());
        }
      });
    });
  };

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
      await renderResolvedItems(cachedItems, { aboveFoldLimit: 2 });
    } catch {}
  }

  if (cachedFresh) {
    return true;
  }

  const fetchAndRender = async () => {
    let items = [];
    try {
      items = await fetcher();
    } catch (e) {
      console.warn("recentRows: fillSection fetcher error:", e);
      items = [];
    }

    if (!isRenderCurrent()) {
      return false;
    }

    if (!items?.length) {
      if (!cachedItems?.length) {
        if (allowEmptyRow) {
          return renderEmptyState(resolveEmptyMessage());
        }
        return removeSection();
      }
      return true;
    }

    if (cachedItems?.length) {
      const compareCount = cardCount + (useHero ? 1 : 0);
      const a = cachedItems.map((x) => x?.Id).filter(Boolean).slice(0, compareCount);
      const b = items.map((x) => x?.Id).filter(Boolean).slice(0, compareCount);
      if (sameIdList(a, b)) {
        const progressUnchanged =
          !showProgress ||
          samePlaybackProgressByOrder(cachedItems, items, compareCount);
        if (progressUnchanged) return true;
      }
    }

    return renderResolvedItems(items, {
      aboveFoldLimit: IS_MOBILE ? 4 : 6
    });
  };

  if (deferNetworkRender) {
    void fetchAndRender();
    return true;
  }

  return fetchAndRender();
}

function getActiveHomePage() {
  const visiblePage =
    getActiveHomePageEl?.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  if (visiblePage?.isConnected) {
    return visiblePage;
  }
  const mountedPage = getMountedRecentRowsPage();
  if (mountedPage?.isConnected) {
    return mountedPage;
  }
  return null;
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
    return { parent: hsc, anchor: null, prepend: false };
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

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
}

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    ref.insertAdjacentElement("afterend", node);
  } else {
    appendToParent(parent, node);
  }
}

function insertFirst(parent, node) {
  if (!parent || !node) return;
  if (parent.firstElementChild) parent.insertBefore(node, parent.firstElementChild);
  else appendToParent(parent, node);
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

function cleanupLegacyRecentRowsWrap(sectionKey) {
  const meta = getRecentRowSectionMeta(sectionKey);
  const wrap = document.getElementById(meta.id);
  if (!wrap) return;
  try {
    wrap.replaceChildren();
  } catch {}
  try { wrap.remove(); } catch {}
}

function hasRenderableRecentRowsContent(sectionKey) {
  return getManagedRecentRowsSections(sectionKey).some((section) => !!section.querySelector(
    ".personal-recs-card, .no-recommendations, .dir-row-hero"
  ));
}

function resolveRecentRowsMountState(homeParent = null, targetPage = null) {
  const page =
    (targetPage?.isConnected ? targetPage : null) ||
    getMountedRecentRowsPage() ||
    getActiveHomePage() ||
    null;
  const container =
    (homeParent?.isConnected ? homeParent : null) ||
    page?.querySelector?.(".homeSectionsContainer") ||
    findRealHomeSectionsContainer() ||
    null;
  return { page, container };
}

function isRecentRowsMountStateValid(state) {
  return !!state?.page?.isConnected && !!state?.container?.isConnected && isRecentRowsHomeRoute();
}

function getRecentRowsSectionAnchor(sectionKey, root = null) {
  const sections = getManagedRecentRowsSections(sectionKey, root || getActiveHomePage() || document);
  return sections.length ? sections[sections.length - 1] : null;
}

function clearRecentRowsRetry() {
  if (__recentRowsRetryTo) {
    clearTimeout(__recentRowsRetryTo);
    __recentRowsRetryTo = null;
  }
}

function scheduleRecentRowsRetry(ms = 1000, options = {}, reason = "retry") {
  clearRecentRowsRetry();
  recentRowsWarn("retry:scheduled", {
    delayMs: Math.max(120, ms | 0),
    reason,
    force: options?.force === true,
  });
  __recentRowsRetryTo = setTimeout(() => {
    __recentRowsRetryTo = null;
    void mountRecentRowsLazy(options);
  }, Math.max(120, ms | 0));
}

async function mountRecentRowsSection(sectionKey, { force = false, options = {}, homeParent = null } = {}) {
  const mountState = resolveRecentRowsMountState(homeParent);
  if (mountState.container?.isConnected) {
    STATE.hostEl = mountState.container;
  }

  if (!force && hasAcceptedRecentRowsMountState(sectionKey)) {
    recentRowsLog("mount:skip:already-rendered", {
      force,
      sectionKey,
      sectionCount: getManagedRecentRowsSections(sectionKey).length,
    });
    clearRecentRowsRetry();
    setManagedRecentRowsDone(sectionKey, true);
    try { mountState.container?.__jmsManagedBelowNativeSchedule?.(); } catch {}
    return true;
  }

  try {
    setManagedRecentRowsDone(sectionKey, false);
    return await enqueueManagedSectionRender(sectionKey, async () => {
      const currentMountState = resolveRecentRowsMountState(homeParent, mountState.page);
      if (!isRecentRowsMountStateValid(currentMountState)) {
        recentRowsWarn("mount:retry:container-invalid", {
          force,
          sectionKey,
          hasPage: !!currentMountState.page,
          hasContainer: !!currentMountState.container,
        });
        scheduleRecentRowsRetry(800, options, `container-invalid:${sectionKey}`);
        return false;
      }
      STATE.hostEl = currentMountState.container;
      recentRowsLog("render:start", {
        force,
        sectionKey,
        sectionCount: getManagedRecentRowsSections(sectionKey).length,
      });
      cleanupManagedRecentRowsSections(sectionKey, currentMountState.container);
      cleanupLegacyRecentRowsWrap(sectionKey);
      await initAndRender({
        sectionKey,
        mountState: currentMountState,
      });
      if (!hasAcceptedRecentRowsMountState(sectionKey)) {
        recentRowsWarn("render:done-but-empty", {
          force,
          sectionKey,
          sectionCount: getManagedRecentRowsSections(sectionKey).length,
        });
        scheduleRecentRowsRetry(1400, options, `render-done-but-empty:${sectionKey}`);
        return false;
      }
      recentRowsLog("render:success", {
        force,
        sectionKey,
        sectionCount: getManagedRecentRowsSections(sectionKey).length,
      });
      clearRecentRowsRetry();
      try { currentMountState.container?.__jmsManagedBelowNativeSchedule?.(); } catch {}
      return true;
    }, {
      timeoutMs: 25000,
      force,
      getAnchor: () => getRecentRowsSectionAnchor(sectionKey, mountState.container),
      isStillValid: () => isRecentRowsMountStateValid(
        resolveRecentRowsMountState(homeParent, mountState.page)
      ),
    });
  } catch (e) {
    console.error(e);
    recentRowsWarn("render:error", {
      force,
      sectionKey,
      error: e?.message || String(e),
    });
    scheduleRecentRowsRetry(1400, options, `render-error:${sectionKey}`);
    return false;
  }
}

export async function mountRecentRowsLazy(options = {}) {
  bindRecentRowsSelfHealObserver();
  const force = options?.force === true;
  if (__recentMountPromise) {
    if (!force) {
      recentRowsLog("mount:skip:existing-promise", { force });
      return __recentMountPromise;
    }
    recentRowsWarn("mount:force:await-existing-promise", { force });
    try { await __recentMountPromise; } catch {}
  }
  if (!getActiveHomePage() && !isRecentRowsHomeRoute()) {
    recentRowsWarn("mount:skip:not-home", { force });
    return false;
  }
  const cfg = getConfig();
  const runtimeCfg = getRecentRowsRuntimeConfig(cfg);
  const sectionKeys = getOrderedRecentRowSectionKeys(cfg, runtimeCfg);
  const anyEnabled = sectionKeys.length > 0;

  if (!anyEnabled) {
    recentRowsLog("mount:skip:disabled", { force });
    clearRecentRowsRetry();
    cleanupRecentRows();
    return;
  }
  recentRowsLog("mount:start", {
    force,
    sectionKeys,
    anyEnabled,
  });
  recentRowsTrace("mount:start", {
    force,
    sectionKeys,
    anyEnabled,
    tmdbEnabled: runtimeCfg.enableTmdbTopMovies === true,
    top10SeriesEnabled: runtimeCfg.enableTop10Series === true,
    top10MovieEnabled: runtimeCfg.enableTop10Movies === true,
    lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    stack: force ? buildTraceStack() : "",
  });

  const run = (async () => {
    if (force) {
      recentRowsWarn("mount:force:cleanup-before-render", { force });
      cleanupRecentRows();
    }

    const host = await waitForVisibleHomeSections({
      timeout: 12000
    });
    if (!host?.container || !getActiveHomePage()) {
      recentRowsWarn("mount:retry:no-visible-home-sections", {
        force,
        hostPageId: host?.page?.id || null,
        hasContainer: !!host?.container,
      });
      scheduleRecentRowsRetry(1000, options, "no-visible-home-sections");
      return false;
    }
    const homeParent = findRealHomeSectionsContainer();
    if (!homeParent) {
      recentRowsWarn("mount:retry:no-homeSectionsContainer", {
        force,
        hostPageId: host?.page?.id || null,
      });
      scheduleRecentRowsRetry(900, options, "no-homeSectionsContainer");
      return false;
    }
    bindManagedSectionsBelowNative(homeParent);
    recentRowsTrace("mount:host-ready", {
      force,
      sectionKeys,
      hostPageId: host?.page?.id || null,
      activePageId: getActiveHomePage()?.id || null,
      homeParentChildCount: homeParent?.children?.length || 0,
    });
    for (const key of Object.keys(RECENT_ROW_SECTION_META)) {
      if (sectionKeys.includes(key)) continue;
      recentRowsTrace("mount:cleanup-disabled-section", {
        activeSectionKey: key,
        requestedSectionKeys: sectionKeys.slice(),
      });
      cleanupManagedRecentRowsSections(key, document);
      cleanupLegacyRecentRowsWrap(key);
      setManagedRecentRowsDone(key, false);
    }

    let allOk = true;
    for (const sectionKey of sectionKeys) {
      recentRowsTrace("mount:section:start", {
        sectionKey,
        force,
        stack: force ? buildTraceStack() : "",
      });
      const ok = await mountRecentRowsSection(sectionKey, { force, options, homeParent });
      recentRowsTrace("mount:section:done", {
        sectionKey,
        force,
        ok,
      });
      if (ok === false) {
        allOk = false;
      }
    }
    return allOk;
  })();

  __recentMountPromise = run;
  try {
    return await run;
  } finally {
    if (__recentMountPromise === run) {
      __recentMountPromise = null;
    }
    if (STATE.hadMountedSections) {
      scheduleRecentRowsSelfHeal("mount-finalize", 260);
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

function yieldRecentRowsSectionStep(timeout = IS_MOBILE ? 96 : 40) {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), {
        timeout: Math.max(24, timeout | 0)
      });
      return;
    }
    setTimeout(resolve, Math.max(16, timeout | 0));
  });
}

async function initAndRender({ sectionKey = "recentRows", mountState = null } = {}) {
  if (!isRecentRowsMountStateValid(mountState)) return;
  const mountKey = mountState.page || mountState.container;
  if (STATE.started) {
    const stale =
      !STATE.wrapEl ||
      !STATE.wrapEl.isConnected ||
      (mountKey && STATE.wrapEl !== mountKey);
    if (stale) {
      STATE.started = false;
      STATE.wrapEl = null;
      STATE.hostEl = null;
      STATE.serverId = null;
      STATE.userId = null;
      STATE.defaultTvHash = null;
      STATE.defaultMoviesHash = null;
      STATE.defaultMusicHash = null;
      STATE.movieLibs = [];
      STATE.tvLibs = [];
      STATE.otherLibs = [];
    }
  }
  try {
    if (typeof waitForAuthReadyStrict === "function") {
      await waitForAuthReadyStrict(5000);
    }
  } catch {}
  const { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE.wrapEl = mountKey;
  STATE.hostEl = mountState.container || findRealHomeSectionsContainer() || STATE.hostEl || getActiveHomePage() || mountKey;
  STATE.userId = userId;
  STATE.serverId = serverId;
  setManagedRecentRowsDone(sectionKey, false);

  try {
    await ensureRecentDb();
    await resolveDefaultPages(userId);
    const runtimeCfg = getRecentRowsRuntimeConfig();
    recentRowsTrace("init:runtime", {
      sectionKey,
      userId,
      serverId,
      tmdbEnabled: runtimeCfg.enableTmdbTopMovies === true,
      top10SeriesEnabled: runtimeCfg.enableTop10Series === true,
      top10MovieEnabled: runtimeCfg.enableTop10Movies === true,
    });

    const top10SeriesPlans = [];
    const top10MoviePlans  = [];
    const tmdbTopMoviePlans = [];
    const recentPlans      = [];
    const continuePlans    = [];
    const nextUpPlans      = [];
    const episodePlans     = [];
    const pushPlan = (bucket, fn) => { if (typeof fn === "function") bucket.push(fn); };
    let plannedSectionIndex = 0;
    const buildManagedSection = (options) => fillSectionWithItems({
      sectionKey,
      sectionId: makeManagedRecentRowsSectionId(sectionKey, plannedSectionIndex++),
      ...options,
    });

  if (runtimeCfg.enableTop10Series) {
    const topSeriesParentIds = getTopSeriesParentIds();
    const topSeriesMetaType = buildTopRowMetaType("Series", topSeriesParentIds);
    pushPlan(top10SeriesPlans, () => buildManagedSection({
      titleText: config.languageLabels.top10Series || "Top 10 Diziler",
      badgeType: "series",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      sectionClassName: "top10-section",
      rowClassName: "top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assign(
        () => fetchTopRankedUnplayedFirstAcrossParents(userId, "Series", TOP10_CACHE_POOL_SIZE, topSeriesParentIds).then(async (items) => {
          await writeCachedList("top", topSeriesMetaType, items.map((x) => x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: () => loadCachedLocalTop10Items("top", topSeriesMetaType, TTL_TOP10_MS)
        }
      ),
      onSeeAll: () => openLatestPage("Series")
    }));
  }

  if (runtimeCfg.enableTop10Movies) {
    const topMovieParentIds = getTopMovieParentIds();
    const topMovieMetaType = buildTopRowMetaType("Movie", topMovieParentIds);
    pushPlan(top10MoviePlans, () => buildManagedSection({
      titleText: config.languageLabels.top10Movies || "Top 10 Filmler",
      badgeType: "movie",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      sectionClassName: "top10-section",
      rowClassName: "top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assign(
        () => fetchTopRankedUnplayedFirstAcrossParents(userId, "Movie", TOP10_CACHE_POOL_SIZE, topMovieParentIds).then(async (items) => {
          await writeCachedList("top", topMovieMetaType, items.map((x) => x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: () => loadCachedLocalTop10Items("top", topMovieMetaType, TTL_TOP10_MS)
        }
      ),
      onSeeAll: () => openLatestPage("Movie")
    }));
  }

  if (runtimeCfg.enableTmdbTopMovies) {
    const tmdbMovieParentIds = getTopMovieParentIds();
    const tmdbMovieMetaType = buildTopRowMetaType("TmdbMovie", tmdbMovieParentIds);
    let tmdbEmptyMessage = "";
    recentRowsTrace("tmdb:plan", {
      sectionKey,
      tmdbMovieParentIds,
      tmdbMovieMetaType,
    });
    pushPlan(tmdbTopMoviePlans, () => buildManagedSection({
      titleText: config.languageLabels.tmdbTopMovies || "TMDb En Iyi Filmler",
      badgeType: "movie",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      allowEmptyRow: true,
      emptyMessage: () => tmdbEmptyMessage,
      sectionClassName: "top10-section tmdb-top10-section",
      rowClassName: "top10-row tmdb-top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assign(
        async () => {
          recentRowsTrace("tmdb:fetch:start", {
            sectionKey,
            tmdbMovieParentIds,
            limit: TOP10_ROW_CARD_COUNT,
          });
          const result = await fetchTmdbTopRatedMoviesInLibraries(
            userId,
            TOP10_ROW_CARD_COUNT,
            tmdbMovieParentIds
          );
          tmdbEmptyMessage =
            result?.reason === "missingKey"
              ? (config.languageLabels.tmdbKeyMissing || "TMDb API key girilmemis. Ayarlardan ekleyebilirsin.")
              : (config.languageLabels.tmdbTopMoviesEmpty || "Secili film kutuphanelerinde TMDb top rated eslesmesi bulunamadi.");
          const items = Array.isArray(result?.items) ? result.items : [];
          recentRowsTrace("tmdb:fetch:done", {
            sectionKey,
            reason: result?.reason || "",
            itemCount: items.length,
            emptyMessage: tmdbEmptyMessage,
          });
          await writeCachedList("tmdb_top", tmdbMovieMetaType, items.map((x) => x?.Id).filter(Boolean));
          return items;
        },
        {
          cachedItems: () => loadCachedRowItems("tmdb_top", tmdbMovieMetaType, TTL_TOP10_MS, {
            limit: TOP10_ROW_CARD_COUNT,
            refreshUserData: false,
            validateIds: false
          })
        }
      ),
      onSeeAll: () => openLatestPage("Movie")
    }));
  }

  if (runtimeCfg.enableRecentMovies) {
    const split = getConfig()?.recentRowsSplitMovieLibs === true;
    const movieLibIds = resolveMovieLibSelection();

    if (!split || !movieLibIds.length) {
      pushPlan(recentPlans, () => buildManagedSection({
        titleText: config.languageLabels.recentMovies || "Son eklenen filmler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentMoviesHero || "Son eklenen film",
        cardCount: runtimeCfg.effectiveRecentMoviesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentMoviesHeroCards === false,
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
        pushPlan(recentPlans, () => buildManagedSection({
          titleText: (config.languageLabels.recentMovies || "Son eklenen filmler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentMoviesHero || "Son eklenen film") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentMoviesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentMoviesHeroCards === false,
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
      pushPlan(recentPlans, () => buildManagedSection({
        titleText: config.languageLabels.recentSeries || "Son eklenen diziler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentSeriesHero || "Son eklenen dizi",
        cardCount: runtimeCfg.effectiveRecentSeriesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentSeriesHeroCards === false,
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
        pushPlan(recentPlans, () => buildManagedSection({
          titleText: (config.languageLabels.recentSeries || "Son eklenen diziler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentSeriesHero || "Son eklenen dizi") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentSeriesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentSeriesHeroCards === false,
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
      pushPlan(recentPlans, () => buildManagedSection({
        titleText: config.languageLabels.recentEpisodes || "Son eklenen bölümler",
        badgeType: "new",
        heroLabel: config.languageLabels.recentEpisodesHero || "Son eklenen bölüm",
        cardCount: runtimeCfg.effectiveRecentEpisodesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentEpisodesHeroCards === false,
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
        pushPlan(recentPlans, () => buildManagedSection({
          titleText: (config.languageLabels.recentEpisodes || "Son eklenen bölümler") + (libName ? ` • ${libName}` : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentEpisodesHero || "Son eklenen bölüm") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveRecentEpisodesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentEpisodesHeroCards === false,
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
    pushPlan(recentPlans, () => buildManagedSection({
      titleText: config.languageLabels.recentMusic || "Son eklenen Albüm",
      badgeType: "new",
      heroLabel: config.languageLabels.recentMusicHero || "Son eklenen albüm",
      cardCount: runtimeCfg.effectiveRecentMusicCount,
      showProgress: false,
      hideHero: runtimeCfg.showRecentMusicHeroCards === false,
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

  if (runtimeCfg.enableContinueMovies) {
    pushPlan(continuePlans, () => buildManagedSection({
      titleText: config.languageLabels.continueMovies || "Film izlemeye devam et",
      badgeType: "continue",
      heroLabel: config.languageLabels.continueMoviesHero || "İzlemeye devam (Film)",
      cardCount: runtimeCfg.effectiveContinueMoviesCount,
      showProgress: true,
      hideHero: runtimeCfg.showContinueMoviesHeroCards === false,
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
      pushPlan(continuePlans, () => buildManagedSection({
        titleText: config.languageLabels.continueSeries || "Dizi izlemeye devam et",
        badgeType: "continue",
        heroLabel: config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)",
        cardCount: runtimeCfg.effectiveContinueSeriesCount,
        showProgress: true,
        hideHero: runtimeCfg.showContinueSeriesHeroCards === false,
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
        pushPlan(continuePlans, () => buildManagedSection({
          titleText: (config.languageLabels.continueSeries || "Dizi izlemeye devam et") + (libName ? ` • ${libName}` : ""),
          badgeType: "continue",
          heroLabel: (config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)") + (libName ? ` • ${libName}` : ""),
          cardCount: runtimeCfg.effectiveContinueSeriesCount,
          showProgress: true,
          hideHero: runtimeCfg.showContinueSeriesHeroCards === false,
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

  if (runtimeCfg.enableNextUp) {
    pushPlan(nextUpPlans, () => buildManagedSection({
      titleText: config.languageLabels.nextUpEpisodes || "Sıradaki Bölümler",
      badgeType: "episode",
      heroLabel: config.languageLabels.nextUpEpisodesHero || "Sıradaki bölüm",
      cardCount: runtimeCfg.effectiveNextUpCount,
      showProgress: true,
      hideHero: runtimeCfg.showNextUpHeroCards === false,
      fetcher: Object.assign(
        () => fetchNextUpEpisodes(userId, runtimeCfg.effectiveNextUpCount + 1).then(async (items) => {
          await writeCachedList("nextup", "Episode", items.map((x) => x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: () => loadCachedRowItems("nextup", "Episode", TTL_CONTINUE_MS, {
            limit: runtimeCfg.effectiveNextUpCount + 1,
            afterLoad: attachSeriesPosterSourceToEpsAndSeasons
          })
        }
      ),
      onSeeAll: () => gotoHash(STATE.defaultTvHash || DEFAULT_TV_PAGE),
      randomHero: true
    }));
  }

  if (runtimeCfg.enableOtherLibRows) {
    const otherIds = resolveOtherLibSelection();
    const otherDefs = otherIds.map((libId) => {
      const lib = (STATE.otherLibs || []).find(x => x.Id === libId) || null;
      return {
        libId,
        libName: lib?.Name || config.languageLabels.studioHubLibraryFallbackName || "Library"
      };
    });

    for (const { libId, libName } of otherDefs) {
      pushPlan(recentPlans, () => buildManagedSection({
        titleText: `${config.languageLabels.otherLibRecent || "Son eklenenler"} • ${libName}`,
        badgeType: "new",
        heroLabel: `${config.languageLabels.otherLibRecentHero || "Son eklenen"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherRecentCount,
        showProgress: false,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
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
      pushPlan(continuePlans, () => buildManagedSection({
        titleText: `${config.languageLabels.otherLibContinue || "İzlemeye devam et"} • ${libName}`,
        badgeType: "continue",
        heroLabel: `${config.languageLabels.otherLibContinueHero || "Devam"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherContinueCount,
        showProgress: true,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
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
      pushPlan(episodePlans, () => buildManagedSection({
        titleText: `${config.languageLabels.recentEpisodes || "Son eklenen bölümler"} • ${libName}`,
        badgeType: "episode",
        heroLabel: `${config.languageLabels.recentEpisodesHero || "Bölüm"} • ${libName}`,
        cardCount: runtimeCfg.effectiveOtherEpisodesCount,
        showProgress: false,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
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

  if (runtimeCfg.enableRecentTracks) {
    pushPlan(continuePlans, () => buildManagedSection({
      titleText: (config.languageLabels.recentlyPlayedTracks || config.languageLabels.recRecentTracks) || "Son dinlenen parçalar",
      badgeType: "continue",
      heroLabel: (config.languageLabels.recentlyPlayedTracksHero || config.languageLabels.recentTracksHero) || "Son dinlenen parça",
      cardCount: runtimeCfg.effectiveRecentTracksCount,
      showProgress: false,
      hideHero: runtimeCfg.showRecentTracksHeroCards === false,
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

    const runners = (
      sectionKey === "top10SeriesRows" ? [...top10SeriesPlans] :
      sectionKey === "top10MovieRows" ? [...top10MoviePlans] :
      sectionKey === "tmdbTopMoviesRows" ? [...tmdbTopMoviePlans] :
      sectionKey === "continueRows" ? [...continuePlans] :
      sectionKey === "nextUpRows" ? [...nextUpPlans] :
      [...recentPlans, ...episodePlans]
    );

    if (runners.length) {
      recentRowsTrace("init:runners", {
        sectionKey,
        runnerCount: runners.length,
      });
      for (let i = 0; i < runners.length; i++) {
        const run = runners[i];
        if (!isRecentRowsMountStateValid(mountState)) break;
        try {
          await run();
        } catch (e) {
          console.warn("recentRows: runner error:", e);
        }
        if (i < runners.length - 1 && isRecentRowsMountStateValid(mountState)) {
          await yieldRecentRowsSectionStep();
        }
      }
    }
  } finally {
    setManagedRecentRowsDone(sectionKey, true);
  }
}

export function cleanupRecentRows() {
  try {
    recentRowsLog("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl?.isConnected,
    });
    recentRowsTrace("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl?.isConnected,
      sectionShellCounts: Object.fromEntries(
        Object.keys(RECENT_ROW_SECTION_META).map((sectionKey) => [
          sectionKey,
          getManagedRecentRowsSections(sectionKey, document).length,
        ])
      ),
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    clearRecentRowsRetry();
    __recentMountPromise = null;
    Object.keys(RECENT_ROW_SECTION_META).forEach((sectionKey) => {
      setManagedRecentRowsDone(sectionKey, false);
      cleanupManagedRecentRowsSections(sectionKey, document);
      cleanupLegacyRecentRowsWrap(sectionKey);
    });

    STATE.started = false;
    STATE.wrapEl = null;
    STATE.hostEl = null;
    STATE.serverId = null;
    STATE.userId = null;
    STATE.defaultTvHash = null;
    STATE.defaultMoviesHash = null;
    STATE.defaultMusicHash = null;
    STATE.movieLibs = [];
    STATE.tvLibs = [];
    STATE.otherLibs = [];
    STATE.hadMountedSections = false;
    __recentRowsSelfHealPending = false;
    if (__recentRowsSelfHealTimer) {
      clearTimeout(__recentRowsSelfHealTimer);
      __recentRowsSelfHealTimer = null;
    }
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
    getMountedRecentRowsPage() ||
    getActiveHomePageEl?.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    document.body;

  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    page;
}
