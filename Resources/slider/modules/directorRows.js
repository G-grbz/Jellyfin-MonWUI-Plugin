import { getSessionInfo, makeApiRequest, getCachedUserTopGenres } from "/Plugins/JMSFusion/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openDirectorExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import {
  withServer,
  isKnownMissingImage,
  markImageMissing,
  clearMissingImage
} from "./jfUrl.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import { setupScroller } from "./personalRecommendations.js";
import {
  bindManagedSectionsBelowNative,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import { waitForManagedSectionGate } from "./homeSectionChain.js";
import {
  openDirRowsDB,
  makeScope,
  upsertDirector,
  upsertItem,
  linkDirectorItem,
  listDirectors,
  getItemsForDirector,
  deleteItemsAndRelationsByIds,
  getMeta,
  setMeta
} from "./dirRowsDb.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
const UNIFIED_ROW_ITEM_LIMIT = 20;

const PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
const MIN_RATING = 0;
const SHOW_DIRECTOR_ROWS_HERO_CARDS = (config.showDirectorRowsHeroCards !== false);
const HOVER_MODE = (config.directorRowsHoverPreviewMode === 'studioMini' || config.directorRowsHoverPreviewMode === 'modal')
  ? config.directorRowsHoverPreviewMode
  : 'inherit';
const DIRECTOR_ROW_BATCH_SIZE = IS_MOBILE ? 2 : 1;
const DIRECTOR_ROW_FILL_YIELD_MS = IS_MOBILE ? 48 : 24;
const DIRECTOR_MOBILE_CARD_DELAY_MS = 90;
const IMAGE_RETRY_LIMITS = { lq: 2, hi: 2 };
function dirRowsLog() {}
function dirRowsWarn() {}

function clampConfiguredCount(value, fallback, max = UNIFIED_ROW_ITEM_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n | 0));
}

function getDirectorRowsCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.directorRowsCount, 5, 50);
}

function getDirectorRowCardCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.directorRowCardCount, 10);
}

const STATE = {
  directors: [],
  nextIndex: 0,
  batchSize: DIRECTOR_ROW_BATCH_SIZE,
  started: false,
  loading: false,
  batchObserver: null,
  wrapEl: null,
  serverId: null,
  userId: null,
  renderedCount: 0,
  maxRenderCount: getDirectorRowsCount(),
  sectionIOs: new Set(),
  autoPumpScheduled: false,
  _db: null,
  _scope: null,
  _bgStarted: false,
  _backfillRunning: false,
};

let __dirScrollIdleTimer = null;
let __dirScrollIdleAttached = false;
let __dirArrowObserver = null;
let __dirSyncInterval = null;
let __dirBackfillInterval = null;
let __dirBackfillIdleHandle = null;
let __dirAutoPumpHandle = null;
let __dirDeferredWarmTimer = null;
let __dirInitSeq = 0;
let __dirWarmPromise = null;
let __dirWarmScope = "";
let __dirWarmCache = { scope: "", directors: [], fromCache: false, warmedAt: 0, minContents: 0 };
let __dirPrimePromise = null;
let __dirPrimeScope = "";
let __dirKickBackfillPromise = null;
let __dirKickBackfillScope = "";
let __dirEligibilityRefreshRunning = false;
let __dirEligibilityRefreshScope = "";
let __directorMountPromise = null;
let __directorDeferredStartPromise = null;
let __directorDeferredSeq = 0;

function isDirectorRowsWorkerActive() {
  return !!(STATE.started || STATE._bgStarted);
}

function getDirectorMinContents() {
  const liveConfig = getConfig?.() || config || {};
  const raw = Number(liveConfig.directorRowsMinItemsPerDirector);
  return Number.isFinite(raw) ? Math.max(1, raw | 0) : 10;
}

function getDirectorWarmCache(scope) {
  if (!scope || __dirWarmCache.scope !== scope) return null;
  if (__dirWarmCache.minContents !== getDirectorMinContents()) return null;
  const directors = Array.isArray(__dirWarmCache.directors) ? __dirWarmCache.directors : [];
  if (!directors.length) return null;
  return {
    directors: directors.slice(),
    fromCache: !!__dirWarmCache.fromCache,
  };
}

function getDirectorPrimeMinItems() {
  return getDirectorRowCardCount() + 1;
}

function setDirectorWarmCache(scope, result) {
  if (!scope) return;
  __dirWarmCache = {
    scope,
    directors: Array.isArray(result?.directors) ? result.directors.filter(Boolean).slice() : [],
    fromCache: !!result?.fromCache,
    warmedAt: Date.now(),
    minContents: getDirectorMinContents(),
  };
}

async function ensureDirectorRowsSession({ userId, serverId }) {
  if (!userId) return { db: null, scope: null };
  const scope = makeScope({ serverId, userId });

  STATE.userId = userId;
  STATE.serverId = serverId;

  if (STATE._db && STATE._scope === scope) {
    return { db: STATE._db, scope };
  }

  const db = await openDirRowsDB();
  STATE._db = db;
  STATE._scope = scope;
  return { db, scope };
}

function setDirectorArrowLoading(isLoading) {
  const arrow = STATE._loadMoreArrow;
  if (!arrow) return;

  if (isLoading) {
    arrow.classList.add('is-loading');
    arrow.disabled = true;
    arrow.innerHTML = `<span class="gh-spinner" aria-hidden="true"></span>`;
    arrow.setAttribute('aria-busy', 'true');
  } else {
    arrow.classList.remove('is-loading');
    arrow.disabled = false;
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.removeAttribute('aria-busy');
  }
}

function attachDirectorScrollIdleLoader() {
  if (__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = true;

  if (!STATE.wrapEl) return;
  if (!STATE._loadMoreArrow) {
    const arrow = document.createElement('button');
    arrow.className = 'dir-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.setAttribute(
      'aria-label',
      (labels.loadMoreDirectors ||
        config.languageLabels?.loadMoreDirectors ||
        'Daha fazla yönetmen göster')
    );

    STATE.wrapEl.appendChild(arrow);
    STATE._loadMoreArrow = arrow;

    arrow.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        !STATE.loading &&
        STATE.nextIndex < STATE.directors.length &&
        STATE.renderedCount < STATE.maxRenderCount
      ) {
        renderNextDirectorBatch(false);
      }
    }, { passive: false });
  }

  if (__dirArrowObserver) {
    try { __dirArrowObserver.disconnect(); } catch {}
  }

  __dirArrowObserver = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    if (!ent.isIntersecting) continue;
    if (STATE.loading) continue;
    if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
      detachDirectorScrollIdleLoader();
      return;
    }
    renderNextDirectorBatch(false);
    break;
  }
}, {
  root: null,
  rootMargin: '0px 0px 0px 0px',
  threshold: 0.6,
});

  if (STATE._loadMoreArrow) {
    __dirArrowObserver.observe(STATE._loadMoreArrow);
  }
}

function detachDirectorScrollIdleLoader() {
  if (!__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = false;

  if (__dirArrowObserver) {
    try {
      if (STATE._loadMoreArrow) {
        __dirArrowObserver.unobserve(STATE._loadMoreArrow);
      }
      __dirArrowObserver.disconnect();
    } catch {}
    __dirArrowObserver = null;
  }

  if (STATE._loadMoreArrow && STATE._loadMoreArrow.parentElement) {
    try { STATE._loadMoreArrow.parentElement.removeChild(STATE._loadMoreArrow); } catch {}
  }
  STATE._loadMoreArrow = null;

  if (__dirScrollIdleTimer) {
    clearTimeout(__dirScrollIdleTimer);
    __dirScrollIdleTimer = null;
  }
}

function scheduleDirectorAutoPump(timeout = 120) {
  if (STATE.autoPumpScheduled) return;
  if (!STATE.started || !STATE.wrapEl?.isConnected) return;
  if (STATE.loading) return;
  if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) return;

  STATE.autoPumpScheduled = true;

  if (__dirAutoPumpHandle) {
    try { __cancelIdle(__dirAutoPumpHandle); } catch {}
    __dirAutoPumpHandle = null;
  }

  __dirAutoPumpHandle = __idle(async () => {
    __dirAutoPumpHandle = null;
    STATE.autoPumpScheduled = false;

    if (!STATE.started || !STATE.wrapEl?.isConnected) return;
    if (STATE.loading) return;
    if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) return;

    try {
      await renderNextDirectorBatch();
    } catch (e) {
      dirRowsWarn("directorRows: auto pump failed:", e);
    }
  }, Math.max(40, timeout | 0));
}

function yieldToMain(timeout = DIRECTOR_ROW_FILL_YIELD_MS) {
  return new Promise((resolve) => {
    __idle(() => resolve(), Math.max(16, timeout | 0));
  });
}

function registerSectionObserver(io) {
  if (!io) return io;
  STATE.sectionIOs.add(io);
  return io;
}

function unregisterSectionObserver(io) {
  if (!io) return;
  try { io.disconnect(); } catch {}
  STATE.sectionIOs.delete(io);
}

function scheduleLazyDirectorWork(target, init, {
  rootMargin = IS_MOBILE ? '120px 0px' : '280px 0px',
  timeout = IS_MOBILE ? 700 : 260,
  eager = false,
  observeVisibility = true,
} = {}) {
  if (!target || typeof init !== 'function') return () => {};

  let started = false;
  let idleHandle = null;
  let io = null;

  const clearIdleHandle = () => {
    if (!idleHandle) return;
    try { __cancelIdle(idleHandle); } catch {}
    idleHandle = null;
  };

  const cleanup = () => {
    clearIdleHandle();
    unregisterSectionObserver(io);
    io = null;
    try { target.removeEventListener('pointerenter', onIntent); } catch {}
    try { target.removeEventListener('pointerdown', onIntent); } catch {}
    try { target.removeEventListener('focusin', onIntent); } catch {}
  };

  const start = () => {
    if (started || !target?.isConnected) return;
    started = true;
    cleanup();
    try { init(); } catch (e) {
      dirRowsWarn('directorRows: lazy init failed:', e);
    }
  };

  const scheduleIdleStart = () => {
    if (started || idleHandle) return;
    idleHandle = __idle(() => {
      idleHandle = null;
      start();
    }, Math.max(80, timeout | 0));
  };

  const onIntent = () => start();

  try { target.addEventListener('pointerenter', onIntent, { passive: true }); } catch {}
  try { target.addEventListener('pointerdown', onIntent, { passive: true }); } catch {}
  try { target.addEventListener('focusin', onIntent, { passive: true }); } catch {}

  if (eager) {
    scheduleIdleStart();
    return cleanup;
  }

  if (observeVisibility && typeof IntersectionObserver === 'function') {
    io = registerSectionObserver(new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        scheduleIdleStart();
        break;
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    }));

    try { io.observe(target); } catch {}
  } else {
    scheduleIdleStart();
  }

  return cleanup;
}

(function ensurePerfCssOnce(){
  if (document.getElementById('dir-rows-perf-css')) return;
  const st = document.createElement('style');
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
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "UserData",
  "People",
  "Overview",
  "RemoteTrailers"
].join(",");

function getDirectorRowCardTypeBadge(itemType) {
  const ll = config.languageLabels || {};
  if (itemType === "Series") {
    return { label: ll.dizi || labels.dizi || "Dizi", icon: "tv" };
  }
  if (itemType === "BoxSet") {
    return {
      label: ll.collectionTitle || ll.boxset || labels.collectionTitle || labels.boxset || "Collection",
      icon: "layerGroup"
    };
  }
  return { label: ll.film || labels.film || "Film", icon: "film" };
}

function pickBestItemByRating(items) {
  if (!items || !items.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const it of items) {
    if (!it) continue;
    const score = Number(it.CommunityRating);
    const s = Number.isFinite(score) ? score : 0;
    if (!best || s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best || items[0] || null;
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
  const qs = [];

  if (!skipTag && candidate.tag) qs.push(`tag=${encodeURIComponent(candidate.tag)}`);
  if (candidate.imageType === "Primary") {
    qs.push(`maxHeight=${height}`);
  } else {
    const aspectRatio = Number(candidate.aspectRatio) || (16 / 9);
    qs.push(`maxWidth=${Math.max(96, Math.round(height * aspectRatio))}`);
  }
  qs.push(`quality=${quality}`);
  qs.push(`EnableImageEnhancers=false`);

  return withServer(`/Items/${candidate.itemId}/Images/${candidate.imageType}?${qs.join("&")}`);
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

  if (!tag) return null;

  const omitTag = shouldPreferTaglessImages(item);
  const qs = [];
  if (!omitTag) qs.push(`tag=${encodeURIComponent(tag)}`);
  qs.push(`maxWidth=${width}`);
  qs.push(`quality=${quality}`);
  qs.push(`EnableImageEnhancers=false`);
  return withServer(`/Items/${item.Id}/Images/Logo?${qs.join("&")}`);
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;
  const candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;

  const omitTag = shouldPreferTaglessImages(item);
  const qs = [];
  if (!omitTag && candidate.tag) qs.push(`tag=${encodeURIComponent(candidate.tag)}`);
  qs.push(`maxWidth=${width}`);
  qs.push(`quality=${quality}`);
  qs.push(`EnableImageEnhancers=false`);
  return withServer(`/Items/${candidate.itemId}/Images/Backdrop?${qs.join("&")}`);
}

function buildBackdropUrlLQ(item) {
  return buildBackdropUrl(item, 480, 25);
}

function buildBackdropUrlHQ(item) {
  return buildBackdropUrl(item, 1920, 80);
}

function buildPosterSrcSet(item) {
  const primaryCandidate = getPrimaryImageCandidate(item);
  if (!primaryCandidate) return "";

  const hs = [240, 360, 540];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  const omitTag = shouldPreferTaglessImages(item);
  return hs
    .map(h => {
      const url = buildCandidateImageUrl(item, primaryCandidate, h, q, { omitTag });
      return url ? `${withCacheBust(url)} ${Math.round(h * ar)}w` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
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

    if (phase === "hi") {
      if (!data.hqSrc) return;
      img.__phase = "hi";
      img.__hiRequested = true;
      img.src = withCacheBust(data.hqSrc);

      const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
      _rIC(() => {
        if (img.__hiRequested && data.hqSrcset) img.srcset = data.hqSrcset;
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

  const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  _rIC(() => {
    if (img.__hiRequested && data.hqSrcset) {
      img.srcset = data.hqSrcset;
    }
  });
}

let __imgIO = window.__JMS_DIR_IMGIO;

if (!__imgIO) {
  const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
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
  }, {
    rootMargin: IS_MOBILE ? '400px 0px' : '600px 0px',
    threshold: 0.1
  });
  window.__JMS_DIR_IMGIO = __imgIO;
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;
  if (IS_MOBILE) {
    try { __imgIO.unobserve(img); } catch {}
    try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
    try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}
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
    try { img.removeAttribute('srcset'); } catch {}
    const staticSrc = hqSrc || lqSrc || fb;
    const alreadyStatic = (img.__mobileStaticSrc === staticSrc && img.src === staticSrc);
    try { img.loading = "lazy"; } catch {}
    if (!alreadyStatic && img.src !== staticSrc) img.src = staticSrc;
    img.__mobileStaticSrc = staticSrc;
    img.classList.remove('is-lqip');
    img.classList.add('__hydrated');
    img.__phase = 'static';
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

  try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
  try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}

  img.__data = { lqSrc, hqSrc, hqSrcset, lqSrcNoTag, hqSrcNoTag, hqSrcsetNoTag, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;
  img.__fallbackState = { lqNoTagTried: false, hiNoTagTried: false };
  img.__lqLoaded = false;
  img.__pendingHi = false;
  delete img.__disableRecovery;
  delete img.__disableHi;

  try {
    img.removeAttribute('srcset');
    if (img.getAttribute('loading') !== 'eager') img.loading = 'lazy';
  } catch {}

  if (hasKnownMissingImage(img.__data)) {
    markImageSettled(img, fb, { disableRecovery: true });
    return;
  }

  img.src = lqSrc || fb;
  img.classList.add('is-lqip');
  try { img.classList.remove('__hydrated'); } catch {}
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

      const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
      _rIC(() => {
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
  img.addEventListener('error', onError, { passive:true });
  img.addEventListener('load',  onLoad,  { passive:true });
  __imgIO.observe(img);
}

function unobserveImage(img) {
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr; delete img.__onLoad;
  try { img.removeAttribute('srcset'); } catch {}
  try { delete img.__data; } catch {}
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

if (!window.__directorRowsImageRecoveryBound) {
  window.__directorRowsImageRecoveryBound = true;

  const kick = () => {
    try { retryRecoverableImages(); } catch {}
  };

  window.addEventListener("online", kick);
  window.addEventListener("focus", kick, { passive: true });
  window.addEventListener("pageshow", kick, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kick();
  }, { passive: true });
  window.__directorRowsImageRecoveryTimer = true;
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
  if (!runtime) return '';
  return runtime.replace(/(\d+)s/g, `$1${config.languageLabels?.sa || 'sa'}`)
               .replace(/(\d+)d/g, `$1${config.languageLabels?.dk || 'dk'}`);
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

function createRecommendationCard(item, serverId, aboveFold = false) {
  const { itemId, itemName } = primeItemIdentity(item);
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  if (itemId) card.dataset.itemId = itemId;

  const posterUrlHQ = buildPosterUrlHQ(item);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  const posterUrlLQ = buildPosterUrlLQ(item);
  const year = item.ProductionYear || "";
  const ageChip = formatOfficialRatingLabel(item.OfficialRating || "");
  const runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  const runtime = formatRuntime(runtimeTicks);
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(", ") : "";
  const { label: typeLabel, icon: typeIcon } = getDirectorRowCardTypeBadge(item.Type);
  const community = Number.isFinite(item.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${item.CommunityRating.toFixed(1)}</div>`
    : "";
  const progress = getPlaybackPercent(item);
  const progressHtml = (progress > 0.02 && progress < 0.999)
    ? `<div class="rr-progress-wrap" aria-label="${escapeHtml(config.languageLabels?.progress || "İlerleme")}">
         <div class="rr-progress-bar" style="width:${Math.round(progress * 100)}%"></div>
       </div>`
    : "";

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${itemId ? getDetailsUrl(itemId, serverId) : '#'}">
        <div class="cardImageContainer">
          <img class="cardImage"
            alt="${escapeHtml(itemName)}"
            loading="${aboveFold ? 'eager' : 'lazy'}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ''}>
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
            ${escapeHtml(clampText(itemName, 42))}
          </div>
            <div class="prc-meta">
              ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
              ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
              ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
            </div>
            ${genres ? `<div class="prc-genres">${genres}</div>` : ""}
          </div>
          ${progressHtml}
        </div>
      </a>
    </div>
  `;

  const img = card.querySelector('.cardImage');
  try {
    const sizesMobile = '(max-width: 640px) 45vw, (max-width: 820px) 38vw, 200px';
    const sizesDesk   = '(max-width: 1200px) 20vw, 200px';
    img.setAttribute('sizes', IS_MOBILE ? sizesMobile : sizesDesk);
  } catch {}

  if (posterUrlHQ) {
    hydrateBlurUp(img, {
      lqSrc: posterUrlLQ,
      hqSrc: posterUrlHQ,
      hqSrcset: posterSetHQ,
      fallback: PLACEHOLDER_URL
    });
  } else {
    try { img.style.display = 'none'; } catch {}
    const noImg = document.createElement('div');
    noImg.className = 'prc-noimg-label';
    noImg.textContent =
      (config.languageLabels && (config.languageLabels.noImage || config.languageLabels.loadingText))
      || (labels.noImage || 'Görsel yok');
    noImg.style.minHeight = '200px';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    card.querySelector('.cardImageContainer')?.prepend(noImg);
  }

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
        dirRowsWarn("openDetailsModal failed (director card):", err);
      }
    }, { passive: false });
  }

  const mode = (HOVER_MODE === 'inherit')
    ? (getConfig()?.globalPreviewMode === 'studioMini' ? 'studioMini' : 'modal')
    : HOVER_MODE;

  const cleanupLazyPreview = scheduleLazyDirectorWork(card, () => {
    if (!card.isConnected) return;
    attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode);
  }, {
    eager: aboveFold && !IS_MOBILE,
    timeout: aboveFold ? 220 : 480,
    observeVisibility: false,
  });

  card.addEventListener('jms:cleanup', () => {
    try { cleanupLazyPreview(); } catch {}
    unobserveImage(img);
    detachPreviewHandlers(card);
    try { cleanupImageResourceRefs(card, { revokeDetachedBlobs: true }); } catch {}
  }, { once:true });
  return card;
}

function isHomeRoute() {
  const h = String(window.location.hash || '').toLowerCase();
  return h.startsWith('#/home') || h.startsWith('#/index') || h === '' || h === '#';
}

function createDirectorHeroCard(item, serverId, directorName) {
  const { itemId, itemName } = primeItemIdentity(item);
  const hero = document.createElement('div');
  hero.className = 'dir-row-hero';
  if (itemId) hero.dataset.itemId = itemId;

  const bgLQ = buildBackdropUrlLQ(item) || buildPosterUrlLQ(item) || null;
  const bgHQ = buildBackdropUrlHQ(item) || buildPosterUrlHQ(item) || null;
  const logo = buildLogoUrl(item);
  const year = item.ProductionYear || '';
  const plot = clampText(item.Overview, 1200);
  const ageChip = formatOfficialRatingLabel(item.OfficialRating || '');
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  const heroMetaItems = [];
  if (ageChip) heroMetaItems.push({ text: ageChip, variant: "age" });
  if (year) heroMetaItems.push({ text: year, variant: "year" });
  if (genres) heroMetaItems.push({ text: genres, variant: "genres" });
  const metaHtml = heroMetaItems.length
    ? heroMetaItems
        .map(({ text, variant }) =>
          `<span class="dir-row-hero-meta dir-row-hero-meta--${variant}">${escapeHtml(text)}</span>`
        )
        .join("")
    : "";
  const heroProgress = getPlaybackPercent(item);
  const heroProgressPct = Math.round(heroProgress * 100);
  const heroProgressHtml = (heroProgress > 0.02 && heroProgress < 0.999)
    ? `
      <div class="dir-hero-progress-wrap" aria-label="${escapeHtml(config.languageLabels?.progress || "İlerleme")}">
        <div class="dir-hero-progress-bar" style="width:${heroProgressPct}%"></div>
      </div>
      <div class="dir-hero-progress-pct">${heroProgressPct}%</div>
    `
    : "";

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg" alt="${escapeHtml(itemName)}" loading="lazy" decoding="async">
    </div>

    <div class="dir-row-hero-inner">
      <div class="dir-row-hero-meta-container">
        <div class="dir-row-hero-label">
          ${(config.languageLabels?.yonetmen || "yönetmen")} ${escapeHtml(directorName || "")}
        </div>

        ${logo ? `
          <div class="dir-row-hero-logo">
            <img src="${logo}" alt="${escapeHtml(itemName)} logo">
          </div>
        ` : ``}

        <div class="dir-row-hero-title">${escapeHtml(itemName)}</div>

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
      dirRowsWarn("openDetailsModal failed (director hero):", err);
    }
  };

  hero.addEventListener('click', openDetails);
  hero.tabIndex = 0;
  hero.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openDetails(e);
  });

  hero.classList.add('active');

  try {
    const bgImg = hero.querySelector('.dir-row-hero-bg');
    if (bgImg) {
      if (bgHQ || bgLQ) {
        hydrateBlurUp(bgImg, {
          lqSrc: bgLQ,
          hqSrc: bgHQ,
          hqSrcset: "",
          fallback: PLACEHOLDER_URL
        });
      } else {
        bgImg.src = PLACEHOLDER_URL;
        bgImg.classList.add('__hydrated');
      }
    }
  } catch (e) {
    dirRowsWarn("dir-row-hero-bg hydrate failed:", e);
  }

  const cleanupLazyHeroTrailer = scheduleLazyDirectorWork(hero, () => {
    try {
      const backdropImg = hero.querySelector('.dir-row-hero-bg');
      const heroInner = hero.querySelector('.dir-row-hero-inner');
      const RemoteTrailers =
        item.RemoteTrailers ||
        item.RemoteTrailerItems ||
        item.RemoteTrailerUrls ||
        [];

      createTrailerIframe({
        config,
        RemoteTrailers,
        slide: hero,
        backdropImg,
        extraHoverTargets: [heroInner],
        itemId,
        serverId,
        detailsUrl: itemId ? getDetailsUrl(itemId, serverId) : "#",
        detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
        showDetailsOverlay: false,
      });
    } catch (err) {
      console.error("Director hero için createTrailerIframe hata:", err);
    }
  }, {
    eager: !IS_MOBILE,
    timeout: IS_MOBILE ? 900 : 420,
  });

  hero.addEventListener('jms:cleanup', () => {
    try { cleanupLazyHeroTrailer(); } catch {}
    try {
      const bgImg = hero.querySelector('.dir-row-hero-bg');
      if (bgImg) unobserveImage(bgImg);
    } catch {}
    detachPreviewHandlers(hero);
    try { cleanupImageResourceRefs(hero, { revokeDetachedBlobs: true }); } catch {}
  }, { once: true });

  return hero;
}

const __hoverIntent = new WeakMap();
const __enterTimers = new WeakMap();
const __enterSeq     = new WeakMap();
const __cooldownUntil= new WeakMap();
const __openTokenMap = new WeakMap();
const __boundPreview = new WeakMap();

let __lastMoveTS = 0;
let __pmLast = 0;
window.addEventListener('pointermove', () => {
  const now = Date.now();
  if (now - __pmLast > 100) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});

let __touchStickyOpen = false;
let __touchLastOpenTS = 0;
const TOUCH_STICKY_GRACE_MS = 1200;

function hardWipeHoverModalDom() {
  const modal = document.querySelector('.video-preview-modal');
  if (!modal) return;
  try { modal.dataset.itemId = ""; } catch {}
  modal.querySelectorAll('img').forEach(img => {
    try { img.removeAttribute('src'); img.removeAttribute('srcset'); } catch {}
  });
  modal.querySelectorAll('[data-field="title"],[data-field="subtitle"],[data-field="meta"],[data-field="genres"]').forEach(el => {
    el.textContent = '';
  });
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound_dir) return;
  window.__jmsTouchCloserBound_dir = true;
  document.addEventListener('pointerdown', (e) => {
    if (!__touchStickyOpen) return;
    const inModal = e.target?.closest?.('.video-preview-modal');
    if (!inModal) {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!__touchStickyOpen) return;
    if (e.key === 'Escape') {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  });
})();

function isHoveringCardOrModal(cardEl) {
  try {
    const overCard  = cardEl?.isConnected && cardEl.matches(':hover');
    const overModal = !!document.querySelector('.video-preview-modal:hover');
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
  if (typeof window.tryOpenHoverModal === 'function') {
    try { window.tryOpenHoverModal(itemId, anchorEl, { bypass: true }); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.open === 'function') {
    try { window.__hoverTrailer.open({ itemId, anchor: anchorEl, bypass: true }); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:open', { detail: { itemId, anchor: anchorEl, bypass: true }}));
}

function safeCloseHoverModal() {
  if (typeof window.closeHoverPreview === 'function') {
    try { window.closeHoverPreview(); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.close === 'function') {
    try { window.__hoverTrailer.close(); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:close'));
  try { hardWipeHoverModalDom(); } catch {}
}

function attachHoverTrailer(cardEl, itemLike) {
  const itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl?.dataset?.itemId);
  if (!cardEl || !itemId) return;
  if (!__enterSeq.has(cardEl)) __enterSeq.set(cardEl, 0);

  const onEnter = (e) => {
    const isTouch = e?.pointerType === 'touch';
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
        if (!cardEl.isConnected || !cardEl.matches(':hover')) return;
      }
      try { window.dispatchEvent(new Event('closeAllMiniPopovers')); } catch {}

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
    const isTouch = e?.pointerType === 'touch';
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);
    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) return;
      __touchStickyOpen = false;
    }

    const rt = e?.relatedTarget || null;
    const goingToModal = !!(rt && (rt.closest ? rt.closest('.video-preview-modal') : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 4, 120);
  };

  cardEl.addEventListener('pointerenter', onEnter, { passive: true });
  const onDown = (e) => { if (e?.pointerType === 'touch') onEnter(e); };
  cardEl.addEventListener('pointerdown', onDown, { passive: true });
  cardEl.addEventListener('pointerleave', onLeave,  { passive: true });
  __boundPreview.set(cardEl, { mode: 'modal', onEnter, onLeave, onDown });
}

function detachPreviewHandlers(cardEl) {
  const rec = __boundPreview.get(cardEl);
  if (!rec) return;
  try { cardEl.removeEventListener('pointerenter', rec.onEnter); } catch {}
  try { cardEl.removeEventListener('pointerleave', rec.onLeave); } catch {}
  try { if (rec.onDown) cardEl.removeEventListener('pointerdown', rec.onDown); } catch {}
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
  if (mode === 'studioMini') {
    attachMiniPosterHover(cardEl, normalizedItem);
    __boundPreview.set(cardEl, { mode: 'studioMini', onEnter: ()=>{}, onLeave: ()=>{} });
  } else {
    attachHoverTrailer(cardEl, normalizedItem);
  }
}

function renderSkeletonRow(row, count = getDirectorRowCardCount()) {
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

function filterAndTrimByRating(items, minRating, maxCount) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it || !it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
    if (out.length >= maxCount) break;
  }
  return out;
}

async function getDirectorContentCount(userId, directorId) {
  const url =
    `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&` +
    `PersonIds=${encodeURIComponent(directorId)}&` +
    `Limit=1&SortBy=DateCreated&SortOrder=Descending`;
  try {
    const data = await makeApiRequest(url);
    return Number(data?.TotalRecordCount) || 0;
  } catch (e) {
    dirRowsWarn('directorRows: count check failed for', directorId, e);
    return null;
  }
}

async function pMapLimited(list, limit, mapper) {
  const ret = new Array(list.length);
  let i = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const cur = i++;
      ret[cur] = await mapper(list[cur], cur);
    }
  });
  await Promise.all(workers);
  return ret;
}

function runDirectorBackgroundTask(task, label = "directorRows: background task failed:", timeout = 800) {
  const runner = () => {
    Promise.resolve()
      .then(task)
      .catch((e) => {
        dirRowsWarn(label, e);
      });
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(runner, { timeout: Math.max(200, timeout | 0) });
  } else {
    setTimeout(runner, Math.min(Math.max(0, timeout | 0), 250));
  }
}

function ensureDirectorSyncLoop({ forceImmediate = false } = {}) {
  if (__dirSyncInterval) return;

  if (forceImmediate) {
    runDirectorBackgroundTask(
      () => checkAndSyncNewItems({ force: true }),
      "directorRows: startup sync failed:",
      2400
    );
  }

  __dirSyncInterval = setInterval(() => {
    if (!isDirectorRowsWorkerActive()) return;
    checkAndSyncNewItems().catch(() => {});
  }, Number.isFinite(config.directorRowsNewCheckIntervalMs)
      ? Math.max(30_000, config.directorRowsNewCheckIntervalMs | 0)
      : 15 * 60 * 1000);
}

function scheduleDirectorDeferredWarmTasks() {
  if (__dirDeferredWarmTimer) {
    clearTimeout(__dirDeferredWarmTimer);
    __dirDeferredWarmTimer = null;
  }
}

function cleanupDirectorRowsMount(host) {
  if (!host) return;

  try {
    const targets = new Set();
    if (host.matches?.(".personal-recs-card, .dir-row-hero")) {
      targets.add(host);
    }
    host.querySelectorAll?.(".personal-recs-card, .dir-row-hero").forEach((node) => targets.add(node));
    targets.forEach((node) => {
      try { node.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
    });
  } catch {}

  try { cleanupImageResourceRefs(host, { revokeDetachedBlobs: true }); } catch {}
}

function refreshCachedDirectorEligibility(userId, cachedRows, { db, scope, limit = 0 } = {}) {
  if (!userId || !db || !scope || !Array.isArray(cachedRows) || !cachedRows.length) return;
  if (__dirEligibilityRefreshRunning && __dirEligibilityRefreshScope === scope) return;
  const minContents = getDirectorMinContents();

  const head = cachedRows
    .filter((d) => d?.directorId)
    .slice(0, Math.max(1, limit | 0))
    .map((d) => ({
      Id: d.directorId,
      Name: d.name,
      Count: d.countHint || 0,
    }));

  if (!head.length) return;

  __dirEligibilityRefreshRunning = true;
  __dirEligibilityRefreshScope = scope;

  runDirectorBackgroundTask(async () => {
    try {
      const checks = await pMapLimited(head, 3, async (d) => {
        const total = await getDirectorContentCount(userId, d.Id);
        return {
          d,
          total,
          ok: Number.isFinite(total) && total >= minContents,
        };
      });

      for (const x of checks) {
        if (!Number.isFinite(x.total)) continue;
        await upsertDirector(db, scope, {
          Id: x.d.Id,
          Name: x.d.Name,
          Count: x.d.Count || 0,
          eligible: x.ok,
          countActual: x.total,
          qualifiedMinItems: minContents,
        });
      }
    } finally {
      if (__dirEligibilityRefreshScope === scope) {
        __dirEligibilityRefreshRunning = false;
      }
    }
  }, "directorRows: cached eligibility refresh failed:", 1600);
}

function persistItemsToDbLater(items) {
  if (!STATE._db || !STATE._scope || !Array.isArray(items) || !items.length) return;
  const db = STATE._db;
  const scope = STATE._scope;
  const uniqItems = uniqById(items);
  if (!uniqItems.length) return;

  runDirectorBackgroundTask(async () => {
    for (const it of uniqItems) {
      await upsertItem(db, scope, it);
    }
  }, "directorRows: cached item hydration persist failed:", 600);
}

function persistDirectorItemsToDbLater(dir, items) {
  if (!STATE._db || !STATE._scope || !dir?.Id || !Array.isArray(items) || !items.length) return;
  const db = STATE._db;
  const scope = STATE._scope;
  const uniqItems = uniqById(items);
  if (!uniqItems.length) return;

  runDirectorBackgroundTask(async () => {
    for (const it of uniqItems) {
      await upsertItem(db, scope, it);
      await linkDirectorItem(db, scope, dir.Id, it.Id);
    }

    await upsertDirector(db, scope, {
      Id: dir.Id,
      Name: dir.Name,
      Count: dir.Count || 0,
      eligible: true,
    });
  }, "directorRows: DB write-through failed:", 600);
}

function pruneDeletedDirectorItemsLater(itemIds) {
  if (!STATE._db || !STATE._scope) return;
  const clean = Array.isArray(itemIds) ? Array.from(new Set(itemIds.map(x => String(x || "").trim()).filter(Boolean))) : [];
  if (!clean.length) return;

  runDirectorBackgroundTask(async () => {
    await deleteItemsAndRelationsByIds(STATE._db, STATE._scope, clean);
  }, "directorRows: prune deleted items failed:", 700);
}

async function pickRandomDirectorsFromTopGenres(userId, targetCount = getDirectorRowsCount()) {
  const requestedPrimary = 300;
  const requestedFallback = 600;
  const fields = COMMON_FIELDS;
  const minContents = getDirectorMinContents();
  const topGenres = (config.directorRowsUseTopGenres !== false)
    ? (await getCachedUserTopGenres(2).catch(()=>[]))
    : [];
  const peopleMap = new Map();

  async function scanItems(url, takeUntil) {
    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      for (const it of items) {
        const ppl = Array.isArray(it?.People) ? it.People : [];
        for (const p of ppl) {
          if (!p?.Id || !p?.Name) continue;
          if (String(p?.Type || '').toLowerCase() !== 'director') continue;
          const entry = peopleMap.get(p.Id) || { Id: p.Id, Name: p.Name, Count: 0 };
          entry.Count++;
          peopleMap.set(p.Id, entry);
          if (peopleMap.size >= takeUntil) break;
        }
        if (peopleMap.size >= takeUntil) break;
      }
    } catch (e) {
      dirRowsWarn("directorRows: people scan error:", e);
    }
  }

  if (topGenres?.length) {
    const g = encodeURIComponent(topGenres.join("|"));
    const url = `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&EnableUserData=true&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=${requestedPrimary}&Genres=${g}`;
    await scanItems(url, targetCount * 8);
  }
  if (peopleMap.size < targetCount * 2) {
    const url = `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&EnableUserData=true&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=${requestedFallback}`;
    await scanItems(url, targetCount * 12);
  }

  let directors = [...peopleMap.values()];
  if (!directors.length) return [];
  directors.sort((a,b)=>b.Count-a.Count);
  const head = directors.slice(0, Math.min(60, directors.length));
  const checks = await pMapLimited(head, 3, async (d) => {
    const total = await getDirectorContentCount(userId, d.Id);
    return {
      d,
      total,
      ok: Number.isFinite(total) && total >= minContents,
    };
  });
  const eligible = checks
    .filter(x => x.ok)
    .map(x => ({ ...x.d, countActual: x.total, qualifiedMinItems: minContents }));

  if (!eligible.length) return [];

  shuffle(eligible);
  return eligible.slice(0, targetCount);
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=(Math.random()*(i+1))|0;
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

async function fetchItemsByDirector(userId, directorId, limit = getDirectorRowCardCount() * 2) {
  const rowCount = getDirectorRowsCount();
  const rowCardCount = getDirectorRowCardCount();
  const fields = COMMON_FIELDS;

  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&EnableUserData=true&` +
    `PersonIds=${encodeURIComponent(directorId)}&` +
    `SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&` +
    `Limit=${Math.max(rowCount, limit)}`;

  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const NEED = rowCardCount + 1;
    return filterAndTrimByRating(items, MIN_RATING, NEED);
  } catch (e) {
    dirRowsWarn("directorRows: yönetmen içerik çekilemedi:", e);
    return [];
  }
}

async function loadDirectorsFromDbOrApi(userId) {
  const rowCount = getDirectorRowsCount();
  const wantFloor = Math.max(1, STATE.maxRenderCount || rowCount);
  const WANT = Math.max(rowCount * 3, wantFloor);
  const db = STATE._db;
  const scope = STATE._scope;
  const minContents = getDirectorMinContents();

  if (db && scope) {
    try {
      const cached = await listDirectors(db, scope, { limit: Math.max(WANT * 4, rowCount * 20) });

      if (cached?.length) {
        const cachedPool = cached
          .filter(d => d?.directorId)
          .map(d => ({
            Id: d.directorId,
            Name: d.name,
            Count: d.countHint || 0,
            countActual: Number.isFinite(Number(d.countActual)) ? Number(d.countActual) : null,
            qualifiedMinItems: Number.isFinite(Number(d.qualifiedMinItems)) ? Number(d.qualifiedMinItems) : null,
          }));

        const knownEligible = cachedPool.filter((d) =>
          Number.isFinite(d.countActual) && d.countActual >= minContents
        );
        const unknownPool = cachedPool.filter((d) => !Number.isFinite(d.countActual));
        const validated = [];
        const seen = new Set();

        shuffle(knownEligible);
        for (const d of knownEligible) {
          if (seen.has(d.Id)) continue;
          seen.add(d.Id);
          validated.push(d);
          if (validated.length >= WANT) break;
        }

        if (validated.length < WANT && unknownPool.length) {
          shuffle(unknownPool);
          const toCheck = unknownPool.slice(0, Math.min(unknownPool.length, Math.max(WANT * 3, rowCount * 8)));
          const checks = await pMapLimited(toCheck, 3, async (d) => {
            const total = await getDirectorContentCount(userId, d.Id);
            return {
              d,
              total,
              ok: Number.isFinite(total) && total >= minContents,
            };
          });

          for (const x of checks) {
            if (Number.isFinite(x.total)) {
              await upsertDirector(db, scope, {
                Id: x.d.Id,
                Name: x.d.Name,
                Count: x.d.Count || 0,
                eligible: x.ok,
                countActual: x.total,
                qualifiedMinItems: minContents,
              });
            }
            if (!x.ok || seen.has(x.d.Id)) continue;
            seen.add(x.d.Id);
            validated.push({ ...x.d, countActual: x.total, qualifiedMinItems: minContents });
            if (validated.length >= WANT) break;
          }
        }

        if (validated.length) {
          refreshCachedDirectorEligibility(userId, cached, {
            db,
            scope,
            limit: Math.min(cached.length, Math.max(WANT * 2, rowCount * 6)),
          });
          return { directors: validated.slice(0, WANT), fromCache: true };
        }
      }
    } catch (e) {
      dirRowsWarn("directorRows: DB director load failed:", e);
    }
  }

  const seen = new Set();
  const directors = [];

  for (let attempt = 0; attempt < 6 && directors.length < WANT; attempt++) {
    const need = WANT - directors.length;
    const batch = await pickRandomDirectorsFromTopGenres(userId, need);
    for (const d of batch) {
      if (!d?.Id) continue;
      if (seen.has(d.Id)) continue;
      seen.add(d.Id);
      directors.push(d);
      if (directors.length >= WANT) break;
    }
  }

  if (db && scope) {
    try {
      for (const d of directors) {
        await upsertDirector(db, scope, {
          Id: d.Id,
          Name: d.Name,
          Count: d.Count || 0,
          eligible: true,
          countActual: d.countActual,
          qualifiedMinItems: minContents,
        });
      }
    } catch {}
  }

  return { directors: directors.slice(0, WANT), fromCache: false };
}

export async function warmDirectorRowsDb({ force = false } = {}) {
  const cfg = getConfig?.() || config || {};
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  if (!homeSectionsConfig.enableDirectorRows) {
    return { directors: [], fromCache: false, skipped: true };
  }

  const { userId, serverId } = getSessionInfo?.() || {};
  if (!userId) {
    return { directors: [], fromCache: false, skipped: true };
  }

  const scope = makeScope({ serverId, userId });
  if (!force && __dirWarmPromise && __dirWarmScope === scope) {
    return __dirWarmPromise;
  }

  __dirWarmScope = scope;
  __dirWarmPromise = (async () => {
    STATE._bgStarted = true;

    try {
      await ensureDirectorRowsSession({ userId, serverId });
    } catch (e) {
      dirRowsWarn("directorRows: background DB init failed:", e);
      STATE._db = null;
      STATE._scope = null;
      return { directors: [], fromCache: false, skipped: true };
    }

    let result = force ? null : getDirectorWarmCache(STATE._scope);
    if (!result) {
      result = await loadDirectorsFromDbOrApi(userId);
      setDirectorWarmCache(STATE._scope, result);
    }

    return result;
  })().finally(() => {
    if (__dirWarmScope === scope) {
      __dirWarmPromise = null;
    }
  });

  return __dirWarmPromise;
}

async function ensureDirectorItemsCachedForWarmup(dir, minItems = getDirectorPrimeMinItems()) {
  const db = STATE._db;
  const scope = STATE._scope;
  const userId = STATE.userId;
  if (!db || !scope || !userId || !dir?.Id) return;

  try {
    const existing = await getItemsForDirector(db, scope, dir.Id, minItems);
    if ((existing?.length || 0) >= minItems) return;
  } catch {}

  const apiItems = await fetchItemsByDirector(
    userId,
    dir.Id,
    Math.max(minItems * 3, getDirectorRowCardCount() * 2)
  );

  const items = uniqById(apiItems || []);
  if (!items.length) return;

  for (const it of items) {
    await upsertItem(db, scope, it);
    await linkDirectorItem(db, scope, dir.Id, it.Id);
  }

  await upsertDirector(db, scope, {
    Id: dir.Id,
    Name: dir.Name,
    Count: dir.Count || 0,
    eligible: true
  });
}

function startDirectorItemsPrime(directors, { force = false } = {}) {
  const db = STATE._db;
  const scope = STATE._scope;
  const userId = STATE.userId;
  const list = Array.isArray(directors) ? directors.filter(d => d?.Id) : [];
  if (!db || !scope || !userId || !list.length) return null;

  if (!force && __dirPrimePromise && __dirPrimeScope === scope) {
    return __dirPrimePromise;
  }

  const primeList = list.slice(0, Math.max(getDirectorRowsCount(), 1));
  __dirPrimeScope = scope;
  __dirPrimePromise = (async () => {
    try {
      await pMapLimited(primeList, 2, async (dir) => {
        await ensureDirectorItemsCachedForWarmup(dir);
      });
    } catch (e) {
      dirRowsWarn("directorRows: startup prime failed:", e);
    }
  })().finally(() => {
    if (__dirPrimeScope === scope) {
      __dirPrimePromise = null;
    }
  });

  return __dirPrimePromise;
}

function kickDirectorBackfillNow({ force = false } = {}) {
  const scope = STATE._scope;
  if (!scope || !STATE._db || !STATE.userId) return null;

  if (!force && __dirKickBackfillPromise && __dirKickBackfillScope === scope) {
    return __dirKickBackfillPromise;
  }

  const cfg = getConfig?.() || config || {};
  const pagesPerRun = Number.isFinite(cfg.directorRowsBackfillPagesPerRun)
    ? Math.max(1, Math.min(6, cfg.directorRowsBackfillPagesPerRun | 0))
    : 1;
  const perPage = Number.isFinite(cfg.directorRowsBackfillLimit)
    ? Math.max(50, Math.min(400, cfg.directorRowsBackfillLimit | 0))
    : 200;

  __dirKickBackfillScope = scope;
  __dirKickBackfillPromise = runDirectorBackfillOnce({ pagesPerRun, limit: perPage }).catch((e) => {
    dirRowsWarn("directorRows: immediate backfill failed:", e);
  }).finally(() => {
    if (__dirKickBackfillScope === scope) {
      __dirKickBackfillPromise = null;
    }
  });

  return __dirKickBackfillPromise;
}

function getDateCreatedTicks(it) {
  const t = Number(it?.DateCreatedTicks ?? it?.dateCreatedTicks ?? 0);
  if (t) return t;

  const iso = it?.DateCreated || it?.dateCreated;
  if (!iso) return 0;

  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? (ms * 10000) : 0;
}

async function fetchItemsByIdsDetailed(userId, ids, fields = COMMON_FIELDS) {
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) {
    return { items: [], foundIds: [], missingIds: [], failedIds: [] };
  }

  const out = [];
  const found = new Set();
  const failed = new Set();
  const chunkSize = 80;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const url =
      `/Users/${userId}/Items?` +
      `Ids=${encodeURIComponent(chunk.join(","))}` +
      `&Fields=${encodeURIComponent(fields)}` +
      `&EnableUserData=true`;

    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      out.push(...items);
      for (const it of items) {
        if (it?.Id) found.add(String(it.Id));
      }
    } catch (e) {
      dirRowsWarn("directorRows: fetchItemsByIds failed:", e);
      for (const id of chunk) {
        failed.add(String(id));
      }
    }
  }
  const failedIds = Array.from(failed);
  const missingIds = clean
    .map((id) => String(id || "").trim())
    .filter((id) => id && !found.has(id) && !failed.has(id));

  return {
    items: uniqById(out),
    foundIds: Array.from(found),
    missingIds,
    failedIds,
  };
}

async function fetchItemsByIds(userId, ids, fields = COMMON_FIELDS) {
  const res = await fetchItemsByIdsDetailed(userId, ids, fields);
  return res.items;
}

function extractDirectorPeople(it) {
  const ppl = Array.isArray(it?.People) ? it.People : [];
  const out = [];
  for (const p of ppl) {
    if (!p?.Id || !p?.Name) continue;
    if (String(p?.Type || "").toLowerCase() !== "director") continue;
    out.push({ Id: p.Id, Name: p.Name });
  }
  return out;
}

async function startDirectorIncrementalSync() {
  const db = STATE._db;
  const scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;

  try {
    const metaKey = `dirRows:lastSync:${scope}`;
    const last = (await getMeta(db, metaKey)) || 0;
    const fieldsMini = "People,DateCreated,DateCreatedTicks";
    const url =
      `/Users/${STATE.userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
      `&Fields=${fieldsMini}` +
      `&SortBy=DateCreated&SortOrder=Descending&Limit=200`;

    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];

    let newestSeen = last;
    const newIds = [];
    const relPairs = [];

    for (const it of items) {
      const dct = getDateCreatedTicks(it);
      if (dct && dct > newestSeen) newestSeen = dct;
      if (last && dct && dct <= last) continue;

      if (it?.Id) newIds.push(it.Id);
      const dirs = extractDirectorPeople(it);
      for (const d of dirs) {
        relPairs.push({ directorId: d.Id, directorName: d.Name, itemId: it.Id });
      }
     }

    if (!newIds.length) {
      if (newestSeen && newestSeen !== last) {
        await setMeta(db, metaKey, newestSeen);
      }
      return;
    }

    const fullItems = await fetchItemsByIds(STATE.userId, newIds, COMMON_FIELDS);
    for (const it of fullItems) {
      await upsertItem(db, scope, it);
    }

    for (const r of relPairs) {
      if (!r.directorId || !r.itemId) continue;
      await upsertDirector(db, scope, { Id: r.directorId, Name: r.directorName, Count: 0, eligible: true });
      await linkDirectorItem(db, scope, r.directorId, r.itemId);
    }

    if (newestSeen && newestSeen !== last) {
      await setMeta(db, metaKey, newestSeen);
    }
  } catch (e) {
    dirRowsWarn("directorRows: incremental sync failed:", e);
  }
}

async function fetchLibraryHeadTick(userId) {
  const fields = "DateCreated,DateCreatedTicks";
  const url =
    `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
    `&Fields=${fields}` +
    `&SortBy=DateCreated&SortOrder=Descending&Limit=1`;

  try {
    const data = await makeApiRequest(url);
    const it = (Array.isArray(data?.Items) && data.Items[0]) ? data.Items[0] : null;
    return it ? getDateCreatedTicks(it) : 0;
  } catch (e) {
    dirRowsWarn("directorRows: head tick check failed:", e);
    return 0;
  }
}

async function checkAndSyncNewItems({ force = false } = {}) {
  const db = STATE._db;
  const scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;
  if (!isDirectorRowsWorkerActive()) return;
  if (document.hidden && !force) return;
  if (STATE._backfillRunning) return;

  const headKey = `dirRows:lastHeadTick:${scope}`;
  const prev = Number(await getMeta(db, headKey)) || 0;
  const now = await fetchLibraryHeadTick(STATE.userId);
  if (!now) return;
  if (!force && prev && now <= prev) return;
  try { await setMeta(db, headKey, now); } catch {}
  await startDirectorIncrementalSync();
}

function __idle(cb, timeout = 1200) {
  if (typeof requestIdleCallback === "function") {
    const h = requestIdleCallback(() => cb(), { timeout });
    return { type: "ric", h };
  }
  const h = setTimeout(() => cb(), Math.max(0, timeout | 0));
  return { type: "to", h };
}

function __cancelIdle(handle) {
  if (!handle) return;
  try {
    if (handle.type === "ric" && typeof cancelIdleCallback === "function") cancelIdleCallback(handle.h);
    if (handle.type === "to") clearTimeout(handle.h);
  } catch {}
}

async function runDirectorBackfillOnce({ pagesPerRun = 1, limit = 200 } = {}) {
  const db = STATE._db;
  const scope = STATE._scope;
  const userId = STATE.userId;
  if (!db || !scope || !userId) return;
  if (STATE._backfillRunning) return;

  STATE._backfillRunning = true;
  try {
    const cursorKey = `dirRows:backfillCursor:${scope}`;
    const doneKey   = `dirRows:backfillDoneAt:${scope}`;
    let startIndex  = Number(await getMeta(db, cursorKey)) || 0;

    const fields = COMMON_FIELDS;
    const perPage = Math.max(50, Math.min(400, limit | 0));
    const pages   = Math.max(1, Math.min(6, pagesPerRun | 0));

    for (let p = 0; p < pages; p++) {
      if (!isDirectorRowsWorkerActive() || !STATE._db || !STATE._scope) break;

      const url =
        `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
        `&Fields=${fields}` +
        `&EnableUserData=true` +
        `&SortBy=DateCreated&SortOrder=Descending` +
        `&StartIndex=${startIndex}` +
        `&Limit=${perPage}`;

      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      if (!items.length) {
        startIndex = 0;
        await setMeta(db, cursorKey, startIndex);
        await setMeta(db, doneKey, Date.now());
        break;
      }

      for (const it of items) {
        if (!it?.Id) continue;
        await upsertItem(db, scope, it);

        const ppl = Array.isArray(it?.People) ? it.People : [];
        for (const person of ppl) {
          if (!person?.Id || !person?.Name) continue;
          if (String(person?.Type || "").toLowerCase() !== "director") continue;
          await upsertDirector(db, scope, { Id: person.Id, Name: person.Name, eligible: true });
          await linkDirectorItem(db, scope, person.Id, it.Id);
        }
      }

      startIndex += items.length;
      await setMeta(db, cursorKey, startIndex);

      if (items.length < perPage) {
        startIndex = 0;
        await setMeta(db, cursorKey, startIndex);
        await setMeta(db, doneKey, Date.now());
        break;
      }
    }
  } catch (e) {
    dirRowsWarn("directorRows: backfill failed:", e);
  } finally {
    STATE._backfillRunning = false;
  }
}

function startDirectorBackfillLoop() {
  const cfg = getConfig?.() || config || {};
  const enabled = (cfg.directorRowsBackfillEnabled !== false);
  if (!enabled) return;

  if (__dirBackfillInterval) return;

  const intervalMs = Number.isFinite(cfg.directorRowsBackfillIntervalMs)
    ? Math.max(15_000, cfg.directorRowsBackfillIntervalMs | 0)
    : 45_000;

  const pagesPerRun = Number.isFinite(cfg.directorRowsBackfillPagesPerRun)
    ? Math.max(1, Math.min(6, cfg.directorRowsBackfillPagesPerRun | 0))
    : 1;

  const perPage = Number.isFinite(cfg.directorRowsBackfillLimit)
    ? Math.max(50, Math.min(400, cfg.directorRowsBackfillLimit | 0))
    : 200;
  const initialDelayMs = Number.isFinite(cfg.directorRowsBackfillInitialDelayMs)
    ? Math.max(30_000, cfg.directorRowsBackfillInitialDelayMs | 0)
    : Math.max(120_000, intervalMs);

  const schedule = async () => {
    if (!isDirectorRowsWorkerActive()) return;
    if (!STATE._db || !STATE._scope || !STATE.userId) return;
    if (document.hidden) return;
    try {
      const doneKey = `dirRows:backfillDoneAt:${STATE._scope}`;
      const doneAt = await getMeta(STATE._db, doneKey);
      if (doneAt) {
        try { clearInterval(__dirBackfillInterval); } catch {}
        __dirBackfillInterval = null;
       return;
      }
    } catch {}
    if (__dirBackfillIdleHandle) return;

    __dirBackfillIdleHandle = __idle(async () => {
      __dirBackfillIdleHandle = null;
      await runDirectorBackfillOnce({ pagesPerRun, limit: perPage });
    }, 1500);
  };

  __dirBackfillIdleHandle = __idle(async () => {
    __dirBackfillIdleHandle = null;
    await schedule();
  }, initialDelayMs);
  __dirBackfillInterval = setInterval(schedule, intervalMs);
}

function waitForGenreHubsDone(timeoutMs = 0) {
  try {
    const cfg = getConfig?.() || config || {};
    const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    if (!homeSectionsConfig.enableGenreHubs) return Promise.resolve();
  } catch {}

  if (window.__jmsGenreHubsDone) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { document.removeEventListener("jms:genre-hubs-done", onReady); } catch {}
      try { if (t) clearTimeout(t); } catch {}
      resolve();
    };
    const onReady = () => finish();
    document.addEventListener("jms:genre-hubs-done", onReady, { once: true });
    const t = (timeoutMs && timeoutMs > 0)
      ? setTimeout(finish, Math.max(0, timeoutMs | 0))
      : null;
  });
}

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
}

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    if (node === ref) return;
    if (node.parentElement === parent && node.previousElementSibling === ref) return;
    const next = ref.nextElementSibling;
    if (next) {
      if (next === node) return;
      parent.insertBefore(node, next);
    } else {
      appendToParent(parent, node);
    }
    return;
  }
  appendToParent(parent, node);
}

function hasRenderableDirectorRowsContent(wrap) {
  if (!wrap) return false;
  return !!wrap.querySelector(
    ".dir-row-section .personal-recs-card:not(.skeleton), .dir-row-section .no-recommendations, .dir-row-section .dir-row-hero"
  );
}

function scheduleDirectorInitWhenReady(wrap, { force = false } = {}) {
  if (force) {
    __directorDeferredSeq += 1;
    __directorDeferredStartPromise = null;
  }

  if (__directorDeferredStartPromise) {
    return __directorDeferredStartPromise;
  }

  const seq = __directorDeferredSeq;
  const run = (async () => {
    try {
      await waitForManagedSectionGate("directorRows", { timeoutMs: 25000 });
      if (seq !== __directorDeferredSeq) return false;
      await waitForGenreHubsDone(25000);
      if (seq !== __directorDeferredSeq) return false;
      if (!wrap?.isConnected || !isHomeRoute()) return false;
      if (!force && hasRenderableDirectorRowsContent(wrap)) return true;
      if (STATE.started && STATE.wrapEl === wrap && wrap.isConnected) return true;
      await initAndRenderFirstBatch(wrap);
      return true;
    } catch (e) {
      console.error(e);
      try { cleanupDirectorRows(); } catch {}
      return false;
    }
  })();

  __directorDeferredStartPromise = run;
  run.finally(() => {
    if (__directorDeferredStartPromise === run) {
      __directorDeferredStartPromise = null;
    }
  });
  return run;
}

export async function mountDirectorRowsLazy(options = {}) {
  const force = options?.force === true;
  if (__directorMountPromise) {
    if (!force) return __directorMountPromise;
    try { await __directorMountPromise; } catch {}
  }
  const cfg = getConfig();
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  if (!homeSectionsConfig.enableDirectorRows) {
    try { cleanupDirectorRows(); } catch {}
    const existing = document.getElementById('director-rows');
    if (existing) { try { existing.remove(); } catch {} }
    return;
  }
  if (!isHomeRoute()) {
    return;
  }

  const run = (async () => {
    if (force) {
      cleanupDirectorRows();
    }

    const host = await waitForVisibleHomeSections({
      timeout: force ? 5000 : 12000
    });
    if (!host?.container || !isHomeRoute()) return false;
    const homeParent = host.page?.querySelector?.(".homeSectionsContainer");
    if (!homeParent) return false;
    bindManagedSectionsBelowNative(homeParent);

    let wrap = document.getElementById('director-rows');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'director-rows';
      wrap.className = 'homeSection director-rows-wrapper';
    }

    if (wrap.parentElement !== homeParent) {
      appendToParent(homeParent, wrap);
    }
    try {
      ensureIntoHomeSections(wrap, host.page, {
        placeAfterId: homeSectionsConfig.enableGenreHubs ? "genre-hubs" : "recent-rows"
      });
    } catch {}

    if (!wrap.isConnected) return false;
    if (!force && hasRenderableDirectorRowsContent(wrap)) {
      return true;
    }

    scheduleDirectorInitWhenReady(wrap, { force });
    return true;
  })();

  __directorMountPromise = run;
  try {
    return await run;
  } finally {
    if (__directorMountPromise === run) {
      __directorMountPromise = null;
    }
  }
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  const apply = () => {
    const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
    if (!page) return;
    const container =
      page.querySelector(".homeSectionsContainer") ||
      document.querySelector(".homeSectionsContainer");
    if (!container) return false;

    const ref = placeAfterId ? document.getElementById(placeAfterId) : null;
    if (ref && ref.parentElement === container) {
      insertAfter(container, el, ref);
    } else {
      appendToParent(container, el);
    }
    return true;
  };

  if (apply()) return;

  let tries = 0;
  const maxTries = 100;
  const mo = new MutationObserver(() => {
    tries++;
    if (apply() || tries >= maxTries) { try { mo.disconnect(); } catch {} }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setTimeout(apply, 3000);
}

function getHomeSectionsContainer(indexPage) {
  const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!page) return;
  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
  page;
}

async function initAndRenderFirstBatch(wrap) {
  if (STATE.started) {
    const stale =
      !STATE.wrapEl ||
      !STATE.wrapEl.isConnected ||
      (wrap && STATE.wrapEl !== wrap);
    if (!stale) return;
    try { cleanupDirectorRows(); } catch {}
  }
  if (!wrap || !wrap.isConnected) return;

  const initSeq = ++__dirInitSeq;
  const { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE._bgStarted = true;
  STATE.wrapEl = wrap;
  STATE.userId = userId;
  STATE.serverId = serverId;

  let warmResult = null;
  try {
    warmResult = await warmDirectorRowsDb();
  } catch (e) {
    dirRowsWarn("directorRows: warmup failed during init:", e);
  }

  if (!STATE._db || !STATE._scope) {
    try {
      await ensureDirectorRowsSession({ userId, serverId });
    } catch (e) {
      dirRowsWarn("directorRows: IndexedDB init failed:", e);
      STATE._db = null;
      STATE._scope = null;
    }
  }
  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== wrap || !wrap.isConnected) return;

  let directorSource = warmResult || getDirectorWarmCache(STATE._scope);
  if (!directorSource) {
    directorSource = await loadDirectorsFromDbOrApi(userId);
    setDirectorWarmCache(STATE._scope, directorSource);
  }

  const { directors, fromCache } = directorSource;
  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== wrap || !wrap.isConnected) return;
  const rowCount = getDirectorRowsCount();
  STATE.directors = directors || [];
  STATE.maxRenderCount = rowCount;

  if (STATE.directors.length < rowCount) {
    dirRowsWarn(`DirectorRows: sadece ${STATE.directors.length}/${rowCount} yönetmen bulunabildi (kütüphane kısıtlı olabilir).`);
  }

  STATE.nextIndex = 0;
  STATE.renderedCount = 0;

  dirRowsLog(`DirectorRows: ${STATE.directors.length} yönetmen (${fromCache ? "DB cache" : "API"}) , ilk row hemen render ediliyor...`);

  const originalBatchSize = Math.max(1, Number(STATE.batchSize) || DIRECTOR_ROW_BATCH_SIZE);
  STATE.batchSize = DIRECTOR_ROW_BATCH_SIZE;
  await renderNextDirectorBatch();
  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== wrap || !wrap.isConnected) return;
  STATE.batchSize = originalBatchSize;

  attachDirectorScrollIdleLoader();
  scheduleDirectorDeferredWarmTasks();
}

async function renderNextDirectorBatch() {
  if (STATE.loading || STATE.renderedCount >= STATE.maxRenderCount) {
    return;
  }

  if (STATE.nextIndex >= STATE.directors.length) {
    dirRowsLog('Tüm yönetmenler render edildi.');
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
    }
    return;
  }

  STATE.loading = true;
  setDirectorArrowLoading(true);
  const remainingCapacity = Math.max(0, STATE.maxRenderCount - STATE.renderedCount);
  const end = Math.min(
    STATE.nextIndex + Math.min(STATE.batchSize, remainingCapacity),
    STATE.directors.length
  );
  const slice = STATE.directors.slice(STATE.nextIndex, end);

  dirRowsLog(`Render batch: ${STATE.nextIndex}-${end} (${slice.length} yönetmen)`);

  const prevCount = STATE.renderedCount;

  const sectionShells = slice.map((dir) => renderDirectorSection(dir, { deferContent: true }));
  if (sectionShells.length) {
    for (let i = 0; i < sectionShells.length; i++) {
      const shell = sectionShells[i];
      try {
        await fillRowWhenReady(shell.row, shell.dir, shell.heroHost);
      } catch (e) {
        dirRowsWarn('directorRows: section fill failed:', e);
      }
      STATE.renderedCount++;

      if (i < sectionShells.length - 1) {
        await yieldToMain();
      }
    }
  }

  if (!window.__directorFirstRowReady && prevCount === 0 && STATE.renderedCount > 0) {
    window.__directorFirstRowReady = true;
    try {
      document.dispatchEvent(new Event("jms:director-first-ready"));
    } catch {}
  }

  STATE.nextIndex = end;
  STATE.loading = false;
  setDirectorArrowLoading(false);

  if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
    dirRowsLog('Tüm yönetmen rowları yüklendi.');
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
      STATE.batchObserver = null;
    }
    detachDirectorScrollIdleLoader();
  } else {
    scheduleDirectorAutoPump(prevCount === 0 ? 60 : 120);
  }

  dirRowsLog(`Render tamamlandı. Toplam: ${STATE.renderedCount}/${STATE.directors.length} yönetmen`);
}

function getDirectorUrl(directorId, directorName, serverId) {
  return `#/details?id=${directorId}&serverId=${encodeURIComponent(serverId)}`;
}

function buildDirectorTitle(name) {
  const lbl = (getConfig()?.languageLabels || {}).showDirector || "Director {name}";
  const safeName = escapeHtml(name || "");
  if (lbl.includes("{name}")) {
    return lbl.replace("{name}", safeName);
  }
  return `${escapeHtml(lbl)} ${safeName}`;
}

function renderDirectorSection(dir, { deferContent = false } = {}) {
  const section = document.createElement('section');
  section.className = 'dir-row-section';

  const title = document.createElement('div');
  title.className = 'sectionTitleContainer sectionTitleContainer-cards';
  const dirTitleText = buildDirectorTitle(dir.Name);
  title.innerHTML = `
    <h2 class="sectionTitle sectionTitle-cards dir-row-title">
      <span class="dir-row-title-text" role="button" tabindex="0"
        aria-label="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}: ${dirTitleText}">
        ${dirTitleText}
      </span>
      <div class="dir-row-see-all"
           aria-label="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}"
           title="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}">
        ${faIconHtml("chevronRight")}
      </div>
      <span class="dir-row-see-all-tip">${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}</span>
    </h2>
  `;

  const titleBtn = title.querySelector('.dir-row-title-text');
  const seeAllBtn = title.querySelector('.dir-row-see-all');

  if (titleBtn) {
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    };
    titleBtn.addEventListener('click', open, { passive: false });
    titleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }

  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    }, { passive: false });
  }

  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'personal-recs-scroll-wrap';

  const heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = SHOW_DIRECTOR_ROWS_HERO_CARDS ? '' : 'none';

  const btnL = document.createElement('button');
  btnL.className = 'hub-scroll-btn hub-scroll-left';
  btnL.setAttribute('aria-label', (config.languageLabels?.scrollLeft) || "Sola kaydır");
  btnL.setAttribute('aria-disabled', 'true');
  btnL.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;

  const row = document.createElement('div');
  row.className = 'itemsContainer personal-recs-row';
  row.setAttribute('role', 'list');

  const btnR = document.createElement('button');
  btnR.className = 'hub-scroll-btn hub-scroll-right';
  btnR.setAttribute('aria-label', (config.languageLabels?.scrollRight) || "Sağa kaydır");
  btnR.setAttribute('aria-disabled', 'true');
  btnR.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`;

  scrollWrap.appendChild(btnL);
  scrollWrap.appendChild(row);
  scrollWrap.appendChild(btnR);

  section.appendChild(title);
  section.appendChild(heroHost);
  section.appendChild(scrollWrap);

  if (STATE._loadMoreArrow && STATE._loadMoreArrow.parentElement === STATE.wrapEl) {
    STATE.wrapEl.insertBefore(section, STATE._loadMoreArrow);
  } else {
    STATE.wrapEl.appendChild(section);
  }
  row.innerHTML = `<div class="dir-row-loading">${(config.languageLabels?.loadingText) || 'Yükleniyor…'}</div>`;
  if (deferContent) {
    return { section, row, heroHost, dir };
  }
  fillRowWhenReady(row, dir, heroHost).catch((e) => {
    dirRowsWarn('directorRows: deferred section fill failed:', e);
  });
  return { section, row, heroHost, dir };
}

function uniqById(list) {
  const seen = new Set();
  const out = [];
  for (const it of list || []) {
    if (!it?.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
  }
  return out;
}

function scheduleDirectorCardPump(row, items, serverId, {
  startIndex = 0,
  limit = getDirectorRowCardCount(),
  chunkSize = getDirectorRowCardCount(),
  delay = DIRECTOR_MOBILE_CARD_DELAY_MS,
} = {}) {
  let currentIndex = Math.max(0, startIndex | 0);

  const pump = () => {
    if (!row?.isConnected) return;
    if (currentIndex >= items.length || row.childElementCount >= limit) return;

    const frag = document.createDocumentFragment();
    let appended = 0;

    for (let i = 0; i < chunkSize && currentIndex < items.length; i++) {
      if (row.childElementCount + appended >= limit) break;
      frag.appendChild(createRecommendationCard(items[currentIndex], serverId, false));
      currentIndex++;
      appended++;
    }

    if (!appended) return;

    row.appendChild(frag);
    try { row.dispatchEvent(new Event('scroll')); } catch {}

    if (currentIndex < items.length && row.childElementCount < limit) {
      window.setTimeout(pump, Math.max(16, delay | 0));
    }
  };

  window.setTimeout(pump, Math.max(16, delay | 0));
}

async function fillRowWhenReady(row, dir, heroHost){
  try {
    const rowCardCount = getDirectorRowCardCount();
    const NEED = rowCardCount + 1;

    let items = [];

    if (STATE._db && STATE._scope) {
      try {
        items = await getItemsForDirector(
          STATE._db,
          STATE._scope,
          dir.Id,
          NEED
        );
      } catch (e) {
        dirRowsWarn("directorRows: getItemsForDirector failed:", e);
      }
    }

    if ((items?.length || 0) > 0 && STATE.userId) {
      try {
        const hydrateIds = (items || []).map(it => it?.Id).filter(Boolean).slice(0, NEED);
        const cachedById = new Map((items || []).filter(it => it?.Id).map(it => [it.Id, it]));
        const resolved = await fetchItemsByIdsDetailed(STATE.userId, hydrateIds, COMMON_FIELDS);

        if (resolved.items?.length) {
          persistItemsToDbLater(resolved.items);
        }
        if (resolved.missingIds?.length) {
          pruneDeletedDirectorItemsLater(resolved.missingIds);
        }

        if (resolved.items?.length || resolved.missingIds?.length) {
          const liveById = new Map((resolved.items || []).filter(it => it?.Id).map(it => [it.Id, it]));
          const failedSet = new Set((resolved.failedIds || []).filter(Boolean));
          const reconciled = [];
          const seen = new Set();

          for (const id of hydrateIds) {
            const it = liveById.get(id) || (failedSet.has(id) ? cachedById.get(id) : null);
            if (!it?.Id || seen.has(it.Id)) continue;
            seen.add(it.Id);
            reconciled.push(it);
          }

          items = reconciled;
        }
      } catch (e) {
        dirRowsWarn("directorRows: cached items hydration failed:", e);
      }
    }

    if ((items?.length || 0) < NEED) {
      const apiItems = await fetchItemsByDirector(
        STATE.userId,
        dir.Id,
        Math.max(NEED * 3, rowCardCount * 2)
      );

      items = uniqById([...(items || []), ...(apiItems || [])]);

      if (items?.length && STATE._db && STATE._scope) {
        persistDirectorItemsToDbLater(dir, items);
      }
    }

    if (!items?.length) {
      cleanupDirectorRowsMount(row);
      row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || (labels.noRecommendations || "Uygun içerik yok")}</div>`;
      if (heroHost) {
        cleanupDirectorRowsMount(heroHost);
        heroHost.innerHTML = "";
      }
      setupScroller(row);
      return;
    }

    const pool = items.slice();
    const best = pickBestItemByRating(pool) || pool[0] || null;
    const remaining = best ? pool.filter(x => x?.Id !== best.Id) : pool;

    if (heroHost) {
      cleanupDirectorRowsMount(heroHost);
      heroHost.innerHTML = "";
      if (SHOW_DIRECTOR_ROWS_HERO_CARDS && best) {
        heroHost.appendChild(createDirectorHeroCard(best, STATE.serverId, dir.Name));
      }
    }

    cleanupDirectorRowsMount(row);
    row.innerHTML = "";

    if (!remaining?.length) {
      row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || (labels.noRecommendations || "Uygun içerik yok")}</div>`;
      setupScroller(row);
      return;
    }

    if (IS_MOBILE) {
      const mobileLimit = Math.min(rowCardCount, remaining.length);
      const initialCount = Math.min(rowCardCount, mobileLimit);
      const mobileFragment = document.createDocumentFragment();

      for (let i = 0; i < initialCount; i++) {
        mobileFragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, i < Math.min(6, initialCount)));
      }

      row.appendChild(mobileFragment);
      setupScroller(row);
      if (initialCount < mobileLimit) {
        scheduleDirectorCardPump(row, remaining, STATE.serverId, {
          startIndex: initialCount,
          limit: mobileLimit,
        });
      }
      return;
    }

    const initialCount = Math.min(rowCardCount, remaining.length);
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < Math.min(initialCount, remaining.length); i++) {
      fragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, i < Math.min(6, initialCount)));
    }
    row.appendChild(fragment);

    let currentIndex = initialCount;

    await new Promise((resolve) => {
      const finalize = () => {
        if (row.isConnected) {
          setupScroller(row);
        }
        resolve();
      };

      const pumpMore = () => {
        if (!row.isConnected) {
          resolve();
          return;
        }

        if (currentIndex >= remaining.length || row.childElementCount >= rowCardCount) {
          finalize();
          return;
        }

        const chunkSize = rowCardCount;
        const frag = document.createDocumentFragment();

        for (let i = 0; i < chunkSize && currentIndex < remaining.length; i++) {
          if (row.childElementCount >= rowCardCount) break;
          frag.appendChild(createRecommendationCard(remaining[currentIndex], STATE.serverId, false));
          currentIndex++;
        }

        row.appendChild(frag);
        try { row.dispatchEvent(new Event('scroll')); } catch {}
        setTimeout(pumpMore, 0);
      };

      setTimeout(pumpMore, 0);
    });

  } catch (error) {
    console.error('Yönetmen içerik yükleme hatası:', error);
    row.innerHTML = `<div class="no-recommendations">Yüklenemedi</div>`;
    setupScroller(row);
  }
}

export function cleanupDirectorRows() {
  try {
    __dirInitSeq++;
    __directorDeferredSeq++;
    __directorMountPromise = null;
    __directorDeferredStartPromise = null;
    try { window.__directorFirstRowReady = false; } catch {}
    if (__dirDeferredWarmTimer) {
      clearTimeout(__dirDeferredWarmTimer);
      __dirDeferredWarmTimer = null;
    }
    detachDirectorScrollIdleLoader();
    STATE.batchObserver?.disconnect();
    STATE.sectionIOs.forEach(io => io.disconnect());
    STATE.sectionIOs.clear();

    if (__dirSyncInterval) {
      try { clearInterval(__dirSyncInterval); } catch {}
      __dirSyncInterval = null;
    }

    if (__dirBackfillInterval) {
      try { clearInterval(__dirBackfillInterval); } catch {}
      __dirBackfillInterval = null;
    }
    if (__dirBackfillIdleHandle) {
      try { __cancelIdle(__dirBackfillIdleHandle); } catch {}
      __dirBackfillIdleHandle = null;
    }
    if (__dirAutoPumpHandle) {
      try { __cancelIdle(__dirAutoPumpHandle); } catch {}
      __dirAutoPumpHandle = null;
    }

    const wrapEl = STATE.wrapEl;
    if (wrapEl) {
      try { wrapEl.__pinMO?.disconnect?.(); } catch {}
      try {
        if (wrapEl.__pinHashChange) {
          window.removeEventListener('hashchange', wrapEl.__pinHashChange);
        }
      } catch {}
      try {
        if (wrapEl.__pinVisibilityChange) {
          document.removeEventListener('visibilitychange', wrapEl.__pinVisibilityChange);
        }
      } catch {}
      try { delete wrapEl.__pinMO; } catch {}
      try { delete wrapEl.__pinHashChange; } catch {}
      try { delete wrapEl.__pinVisibilityChange; } catch {}
      cleanupDirectorRowsMount(wrapEl);
      try { wrapEl.replaceChildren(); } catch {}
      try {
        if (wrapEl.isConnected) {
          wrapEl.parentElement?.removeChild(wrapEl);
        }
      } catch {}
    }
    Object.keys(STATE).forEach(key => {
      if (key !== 'maxRenderCount') {
        STATE[key] = Array.isArray(STATE[key]) ? [] :
                    typeof STATE[key] === 'number' ? 0 :
                    typeof STATE[key] === 'boolean' ? false : null;
      }
    });
    STATE.batchSize = DIRECTOR_ROW_BATCH_SIZE;
    STATE.maxRenderCount = getDirectorRowsCount();
    STATE.sectionIOs = new Set();
    STATE.autoPumpScheduled = false;
    STATE._db = null;
    STATE._scope = null;

  } catch (e) {
    dirRowsWarn('Director rows cleanup error:', e);
  }
}

function clampText(s, max = 220) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 1) + "…") : t;
}

function escapeHtml(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
