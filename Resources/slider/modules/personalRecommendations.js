import { getSessionInfo, makeApiRequest, getCachedUserTopGenres } from "/Plugins/JMSFusion/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openGenreExplorer, openPersonalExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import {
  withServer,
  withServerSrcset,
  isKnownMissingImage,
  markImageMissing,
  clearMissingImage
} from "./jfUrl.js";
import { faIconHtml, findFaIcon } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  openPrcDB,
  makeScope,
  putItems,
  getMeta,
  setMeta,
  purgePrcDb
} from "./prcDb.js";
import {
  bindManagedSectionsBelowNative,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import {
  waitForManagedSectionDependencyCompletion,
  waitForManagedSectionGate
} from "./homeSectionChain.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
const UNIFIED_ROW_ITEM_LIMIT = 20;
const MIN_RATING = Number.isFinite(config.studioHubsMinRating)
  ? Math.max(0, Number(config.studioHubsMinRating))
  : 0;
const PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
const PRC_IMAGE_RETRY_LIMITS = { lq: 2, hi: 2 };
const ENABLE_GENRE_HUBS = !!config.enableGenreHubs;
const __hoverIntent = new WeakMap();
const __enterTimers = new WeakMap();
const __enterSeq     = new WeakMap();
const __cooldownUntil= new WeakMap();
const __openTokenMap = new WeakMap();
const __boundPreview = new WeakMap();
const GENRE_LAZY = true;
const MOBILE_ROW_BATCH_SIZE = 2;
const DESKTOP_INITIAL_GENRE_LOADS = 2;
const GENRE_BATCH_SIZE = Number(getConfig()?.genreRowsBatchSize) || (IS_MOBILE ? MOBILE_ROW_BATCH_SIZE : 1);
const GENRE_ROOT_MARGIN = '500px 0px';
const GENRE_FIRST_SCROLL_PX = Number(getConfig()?.genreRowsFirstBatchScrollPx) || 200;
const MIN_GENRE_VISIBLE_CARD_COUNT = 3;
const PRC_LOCK_DOWN_SCROLL = (getConfig()?.prcLockDownScrollDuringLoad === true);

function clampConfiguredCount(value, fallback, max = UNIFIED_ROW_ITEM_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n | 0));
}

function getPersonalRecsCardCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.personalRecsCardCount, 9);
}

function getBywRowCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.becauseYouWatchedRowCount, 1, 50);
}

function getBywCardCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.becauseYouWatchedCardCount, 10);
}

function getGenreRowsCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.studioHubsGenreRowsCount, 4, 50);
}

function getGenreRowCardCount(source = null) {
  const cfg = source || getConfig?.() || config || {};
  return clampConfiguredCount(cfg.studioHubsGenreCardCount, 10);
}

function getGenreRenderableMin(source = null) {
  return Math.max(getGenreRowCardCount(source) + 1, 6);
}

function getHomeRecommendationRuntimeConfig(source = null) {
  return getHomeSectionsRuntimeConfig(source || (getConfig?.() || config || {}));
}

function isPersonalRecsHeroEnabled() {
  return getConfig()?.showPersonalRecsHeroCards !== false;
}

function isGenreHubsHeroEnabled() {
  return getConfig()?.showGenreHubsHeroCards !== false;
}

function prcLog() {}

function prcWarn() {}

const PRC_DB_STATE = {
  db: null,
  scope: null,
  userId: null,
  serverId: null,
  failed: false,
};

const PRC_SESSION_PERSONAL_CACHE = new Map();
const PRC_SESSION_BYW_SEEDS_CACHE = new Map();
const PRC_SESSION_BYW_ITEMS_CACHE = new Map();

function getPrcSessionScope(userId, serverId) {
  return makeScope({ userId, serverId });
}

function __appendCb(url, cb) {
  if (!url) return url;
  const u = String(url);
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}cb=${encodeURIComponent(String(cb))}`;
}

function __appendCbToSrcset(srcset, cb) {
  if (!srcset || typeof srcset !== 'string') return '';
  return srcset
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(part => {
      const m = part.match(/^(\S+)(\s+.+)?$/);
      if (!m) return part;
      return `${__appendCb(m[1], cb)}${m[2] || ''}`;
    })
    .join(', ');
}

function __preloadOk(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = src;
  });
}

async function __preloadDecode(src) {
  if (!src) return false;
  try {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    if (typeof im.decode === 'function') {
      await im.decode();
    } else {
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; });
    }
    return true;
  } catch {
    return false;
  }
}

function __prcCfg() {
  const cfg = getConfig?.() || config || {};
  return {
    enabled: (cfg.prcUseDirRowsDb !== false),
    personalTtlMs: Number.isFinite(cfg.prcDbPersonalTtlMs) ? Math.max(60_000, cfg.prcDbPersonalTtlMs|0) : 6 * 60 * 60 * 1000,
    genreTtlMs:    Number.isFinite(cfg.prcDbGenreTtlMs)    ? Math.max(60_000, cfg.prcDbGenreTtlMs|0)    : 12 * 60 * 60 * 1000,
    bywTtlMs:      Number.isFinite(cfg.prcDbBywTtlMs)      ? Math.max(60_000, cfg.prcDbBywTtlMs|0)      : 4 * 60 * 60 * 1000,
    validateUserData: (cfg.prcDbValidateUserData !== false),
    maxCacheIds: Number.isFinite(cfg.prcDbMaxIds) ? Math.max(20, cfg.prcDbMaxIds|0) : 140,
  };
}

function __metaKeyGenresList(scope){ return `prc:genresList:${scope}`; }

function __isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  const y = date.getUTCFullYear();
  return `${y}-W${String(weekNo).padStart(2, '0')}`;
}

function __metaKeyPersonal(scope){ return `prc:personal:${scope}`; }
function __metaKeyPersonalLast(scope){ return `prc:personal:lastShown:${scope}`; }
function __metaKeyGenre(scope, genre){
  return `prc:genre:${scope}:${String(genre||"").trim().toLowerCase()}`;
}
function __metaKeyByw(scope){ return `prc:byw:${scope}`; }
function __metaKeyBywSeed(scope){ return `prc:byw:seed:${scope}`; }
function __metaKeyBywLast(scope){ return `prc:byw:lastShown:${scope}`; }
function __metaKeyBywScoped(scope, seedKey){ return `prc:byw:${seedKey}:${scope}`; }
function __metaKeyBywLastScoped(scope, seedKey){ return `prc:byw:lastShown:${seedKey}:${scope}`; }

const PRC_PURGE_KEY = (scope) => `prc:purge:last:${scope}`;

function getPrcTypeToken(itemType) {
  if (itemType === "Series") return "series";
  if (itemType === "BoxSet") return "boxset";
  return "movie";
}

function getPrcCardTypeBadge(itemType) {
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

async function maybePurgePrcDb(st) {
  try {
    const cfg = __prcCfg();
    if (!st?.db || !st?.scope) return;

    const last = await getMeta(st.db, PRC_PURGE_KEY(st.scope));
    const lastTs = Number(last?.ts || 0);
    if (lastTs && (Date.now() - lastTs) < 24 * 60 * 60 * 1000) return;

    await purgePrcDb(st.db, st.scope, {
      items: {
        ttlMs: Math.max(cfg.genreTtlMs, cfg.personalTtlMs, cfg.bywTtlMs) * 6,
        maxItems: Math.max(600, cfg.maxCacheIds * 20),
        maxScan: 9000,
      },
      meta: {
        ttlMs: 45 * 24 * 60 * 60 * 1000,
        prefix: 'prc:',
        maxScan: 4000,
      }
    });

    await setMeta(st.db, PRC_PURGE_KEY(st.scope), { ts: Date.now() });
  } catch {}
}

async function ensurePrcDb(userId, serverId) {
  const cfg = __prcCfg();
  if (!cfg.enabled) return null;
  if (PRC_DB_STATE.failed) return null;

  const scope = makeScope({ userId, serverId });
  if (PRC_DB_STATE.db && PRC_DB_STATE.scope === scope) return PRC_DB_STATE;

  try {
    PRC_DB_STATE.db = await openPrcDB();
    PRC_DB_STATE.scope = scope;
    PRC_DB_STATE.userId = userId;
    PRC_DB_STATE.serverId = serverId;
    PRC_DB_STATE.failed = false;
    try { await maybePurgePrcDb(PRC_DB_STATE); } catch {}
    return PRC_DB_STATE;
  } catch (e) {
    console.warn("PRC DB init failed:", e);
    PRC_DB_STATE.failed = true;
    PRC_DB_STATE.db = null;
    PRC_DB_STATE.scope = null;
    return null;
  }
}

function normalizeCachedItemLocal(rec) {
  if (!rec) return null;
  const Id = rec.Id || rec.itemId || null;
  if (!Id) return null;
  return {
    Id,
    Name: rec.Name || rec.name || "",
    Type: rec.Type || rec.type || "",
    ProductionYear: rec.ProductionYear ?? rec.productionYear ?? null,
    OfficialRating: rec.OfficialRating || rec.officialRating || "",
    CommunityRating: (rec.CommunityRating ?? rec.communityRating ?? null),
    ImageTags: rec.ImageTags || rec.imageTags || null,
    BackdropImageTags: rec.BackdropImageTags || rec.backdropImageTags || null,
    PrimaryImageAspectRatio: rec.PrimaryImageAspectRatio ?? rec.primaryImageAspectRatio ?? null,
    Overview: rec.Overview || rec.overview || "",
    Genres: rec.Genres || rec.genres || [],
    RunTimeTicks: rec.RunTimeTicks ?? rec.runTimeTicks ?? null,
    CumulativeRunTimeTicks: rec.CumulativeRunTimeTicks ?? rec.cumulativeRunTimeTicks ?? null,
    RemoteTrailers: rec.RemoteTrailers || rec.remoteTrailers || [],
    DateCreatedTicks: rec.DateCreatedTicks ?? rec.dateCreatedTicks ?? 0,
    People: rec.People || rec.people || [],
    PrimaryImageTag: rec.PrimaryImageTag || rec.primaryImageTag || null,
    __preferTaglessImages: true,
  };
}

async function dbGetItemsByIds(db, scope, ids) {
  const clean = (ids || []).filter(Boolean);
  if (!db || !scope || !clean.length) return [];

  return new Promise((resolve) => {
    const out = [];
    let pending = 0;
    let aborted = false;

    let tx = null;
    try {
      tx = db.transaction(["items"], "readonly");
    } catch {
      resolve([]);
      return;
    }
    const store = tx.objectStore("items");

    tx.onabort = () => { aborted = true; resolve(out); };
    tx.onerror = () => { aborted = true; resolve(out); };
    tx.oncomplete = () => resolve(out);

    for (const id of clean) {
      pending++;
      let req;
      try {
        req = store.get(`${scope}|${id}`);
      } catch {
        pending--;
        continue;
      }
      req.onsuccess = () => {
        if (aborted) return;
        const norm = normalizeCachedItemLocal(req.result);
        if (norm) out.push(norm);
        pending--;
      };
      req.onerror = () => { pending--; };
    }
  });
}

async function dbWriteThroughItems(db, scope, items) {
  if (!db || !scope || !items?.length) return;
  try {
    await putItems(db, scope, items);
  } catch (e) {
    console.warn("PRC DB write-through failed:", e);
  }
}

async function filterOutPlayedIds(userId, ids) {
  const cfg = __prcCfg();
  const clean = Array.isArray(ids) ? Array.from(new Set(ids.filter(Boolean))) : [];
  if (!cfg.validateUserData || !clean.length) return clean;

  const played = new Set();
  const alive = new Set();
  const failed = new Set();
  const CHUNK = 60;
  const PAR = 2;
  let hadSuccess = false;

  try {
    for (let i = 0; i < clean.length; i += CHUNK * PAR) {
      const ps = [];
      for (let j = i; j < Math.min(clean.length, i + CHUNK * PAR); j += CHUNK) {
        const chunk = clean.slice(j, j + CHUNK);
        const url =
          `/Users/${encodeURIComponent(userId)}/Items?` +
          `Ids=${encodeURIComponent(chunk.join(","))}&Fields=UserData`;

        ps.push(
          makeApiRequest(url)
            .then((r) => {
              hadSuccess = true;
              const items = Array.isArray(r?.Items) ? r.Items : (Array.isArray(r) ? r : []);
              for (const it of items) {
                if (!it?.Id) continue;
                alive.add(it.Id);
                if (it?.UserData?.Played === true) played.add(it.Id);
              }
            })
            .catch(() => {
              for (const id of chunk) failed.add(id);
            })
        );
      }
      await Promise.all(ps);
    }
    if (!hadSuccess) return clean;
    return clean.filter(id => (alive.has(id) && !played.has(id)) || failed.has(id));
  } catch {
    return clean;
  }
}

const GENRE_STATE = {
  genres: [],
  sections: [],
  nextIndex: 0,
  loading: false,
  wrap: null,
  batchObserver: null,
  serverId: null,
  _loadMoreArrow: null,
};

function __resetGenreHubsDoneSignal() {
  try { window.__jmsGenreHubsDone = false; } catch {}
}

function __signalGenreHubsDone() {
  try {
    if (window.__jmsGenreHubsDone) return;
    window.__jmsGenreHubsDone = true;
  } catch {}
  try { document.dispatchEvent(new Event("jms:genre-hubs-done")); } catch {}
}

function __maybeSignalGenreHubsDone() {
  try {
    const total = (GENRE_STATE.genres && GENRE_STATE.genres.length) || 0;
    if (!total) return;
    if (GENRE_STATE.nextIndex >= total) __signalGenreHubsDone();
  } catch {}
}

function setGenreArrowLoading(isLoading) {
  const arrow = GENRE_STATE._loadMoreArrow;
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

let __genreScrollIdleTimer = null;
let __genreScrollIdleAttached = false;
let __genreArrowObserver = null;
let __genreScrollHandler = null;
let __genreAutoPumpTimer = null;
let __personalRecsInitDone = false;
let __genreHubsBusy = false;
let __deferredHomeSectionSeq = 0;
let __bywDeferredPromise = null;
let __genreDeferredPromise = null;
let __personalRecsRetryTo = null;

function isPersonalRecsHomeRoute() {
  const h = String(window.location.hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function setDoneFlag(flagName, eventName, done) {
  const next = !!done;
  let prev = false;
  try { prev = window[flagName] === true; } catch {}
  try { window[flagName] = next; } catch {}
  if (next && !prev && eventName) {
    try { document.dispatchEvent(new Event(eventName)); } catch {}
  }
}

function setPersonalRecsDone(done) {
  setDoneFlag("__jmsPersonalRecsDone", "jms:personal-recommendations-done", done);
}

function getPersonalRecsDone() {
  try { return window.__jmsPersonalRecsDone === true; } catch {}
  return false;
}

function setBywDone(done) {
  setDoneFlag("__jmsBywDone", "jms:because-you-watched-done", done);
}

function getBywDone() {
  try { return window.__jmsBywDone === true; } catch {}
  return false;
}

function hasActivePersonalRecsHomeSections() {
  if (!isPersonalRecsHomeRoute()) return false;
  const page = currentIndexPage();
  return !!page?.querySelector?.(".homeSectionsContainer");
}

function clearPersonalRecsRetry() {
  if (__personalRecsRetryTo) {
    clearTimeout(__personalRecsRetryTo);
    __personalRecsRetryTo = null;
  }
}

function schedulePersonalRecsRetry(ms = 1000, options = {}, reason = "retry") {
  clearPersonalRecsRetry();
  prcWarn("retry:scheduled", {
    delayMs: Math.max(120, ms | 0),
    reason,
    force: options?.force === true,
  });
  __personalRecsRetryTo = setTimeout(() => {
    __personalRecsRetryTo = null;
    void renderPersonalRecommendations(options);
  }, Math.max(120, ms | 0));
}

function scheduleDeferredBecauseYouWatchedRender({ force = false, seq = __deferredHomeSectionSeq } = {}) {
  if (force) {
    __bywDeferredPromise = null;
    prcWarn("BYW:force-reset", { force, seq });
  }
  if (__bywDeferredPromise) {
    prcLog("BYW:reuse-existing-promise", { force, seq });
    return __bywDeferredPromise;
  }

  const run = (async () => {
    try {
      prcLog("BYW:start", { force, seq });
      prcLog("BYW:wait:managed-gate", { force, seq });
      await waitForManagedSectionGate("becauseYouWatched", { timeoutMs: 25000 });
      if (seq !== __deferredHomeSectionSeq) return false;
      await waitForManagedSectionDependencyCompletion("becauseYouWatched", { timeoutMs: 25000 });
      if (seq !== __deferredHomeSectionSeq) return false;
      if (!hasActivePersonalRecsHomeSections()) {
        prcWarn("BYW:abort:no-home-sections", { force, seq });
        return false;
      }
      await renderBecauseYouWatchedAuto(currentIndexPage(), { force });
      prcLog("BYW:success", { force, seq });
      return true;
    } catch (e) {
      console.warn("BYW deferred render failed:", e);
      prcWarn("BYW:error", {
        force,
        seq,
        error: e?.message || String(e),
      });
      setBywDone(true);
      return false;
    }
  })();

  __bywDeferredPromise = run;
  run.finally(() => {
    if (__bywDeferredPromise === run) {
      __bywDeferredPromise = null;
    }
  });
  return run;
}

function scheduleDeferredGenreHubsRender({ force = false, seq = __deferredHomeSectionSeq } = {}) {
  if (force) {
    __genreDeferredPromise = null;
    prcWarn("GENRE:force-reset", { force, seq });
  }
  if (__genreDeferredPromise) {
    prcLog("GENRE:reuse-existing-promise", { force, seq });
    return __genreDeferredPromise;
  }

  const run = (async () => {
    try {
      prcLog("GENRE:start", { force, seq });
      prcLog("GENRE:wait:managed-gate", { force, seq });
      await waitForManagedSectionGate("genreHubs", { timeoutMs: 25000 });
      if (seq !== __deferredHomeSectionSeq) return false;
      await waitForManagedSectionDependencyCompletion("genreHubs", { timeoutMs: 25000 });
      if (seq !== __deferredHomeSectionSeq) return false;
      if (!hasActivePersonalRecsHomeSections()) {
        prcWarn("GENRE:abort:no-home-sections", { force, seq });
        return false;
      }
      await renderGenreHubs(currentIndexPage());
      prcLog("GENRE:success", { force, seq });
      return true;
    } catch (e) {
      console.error("Genre hubs deferred render hatası:", e);
      prcWarn("GENRE:error", {
        force,
        seq,
        error: e?.message || String(e),
      });
      try { __signalGenreHubsDone(); } catch {}
      return false;
    }
  })();

  __genreDeferredPromise = run;
  run.finally(() => {
    if (__genreDeferredPromise === run) {
      __genreDeferredPromise = null;
    }
  });
  return run;
}

export function lockDownScroll() {
  if (!PRC_LOCK_DOWN_SCROLL) return;
  try { document.documentElement.dataset.jmsSoftBlock = "1"; } catch {}
}

export function unlockDownScroll() {
  try { delete document.documentElement.dataset.jmsSoftBlock; } catch {}
}

function getInitialGenreLoadCount() {
  return Math.max(
    1,
    Math.max(GENRE_BATCH_SIZE, IS_MOBILE ? MOBILE_ROW_BATCH_SIZE : DESKTOP_INITIAL_GENRE_LOADS)
  );
}

function isGenreLoadTriggerNearViewport() {
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
  const preloadPx = Math.max(120, Number(GENRE_FIRST_SCROLL_PX) || 0);
  const arrow = GENRE_STATE._loadMoreArrow;

  if (arrow?.isConnected) {
    const rect = arrow.getBoundingClientRect();
    if (rect.top <= (viewportH + preloadPx) && rect.bottom >= -preloadPx) {
      return true;
    }
  }

  const wrap = GENRE_STATE.wrap;
  if (!wrap?.isConnected) return false;

  const rect = wrap.getBoundingClientRect();
  return rect.bottom <= (viewportH + preloadPx);
}

function queueGenreViewportLoad(delayMs = 220) {
  if (!__genreScrollIdleAttached) return;
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres?.length || 0)) {
    detachGenreScrollIdleLoader();
    return;
  }
  if (__genreScrollIdleTimer) return;
  if (!isGenreLoadTriggerNearViewport()) return;

  __genreScrollIdleTimer = setTimeout(() => {
    __genreScrollIdleTimer = null;

    if (!__genreScrollIdleAttached) return;
    if (GENRE_STATE.loading) return;
    if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres?.length || 0)) {
      detachGenreScrollIdleLoader();
      return;
    }
    if (!isGenreLoadTriggerNearViewport()) return;

    loadNextGenreViaArrow();
  }, Math.max(60, delayMs | 0));
}

function attachGenreScrollIdleLoader() {
  if (__genreScrollIdleAttached) return;
  if (!GENRE_STATE.wrap || !GENRE_STATE.genres || !GENRE_STATE.genres.length) return;
  if (GENRE_STATE.nextIndex >= GENRE_STATE.genres.length) return;
  __genreScrollIdleAttached = true;

  if (!GENRE_STATE._loadMoreArrow) {
    const arrow = document.createElement('button');
    arrow.className = 'genre-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.setAttribute(
      'aria-label',
      (labels.loadMoreGenres ||
        config.languageLabels?.loadMoreGenres ||
        'Daha fazla tür göster')
    );

    GENRE_STATE.wrap.appendChild(arrow);
    GENRE_STATE._loadMoreArrow = arrow;

    arrow.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadNextGenreViaArrow();
    }, { passive: false });
  }

  if (__genreArrowObserver) {
    try { __genreArrowObserver.disconnect(); } catch {}
    __genreArrowObserver = null;
  }

  if (typeof IntersectionObserver === "function") {
    __genreArrowObserver = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        queueGenreViewportLoad(180);
        break;
      }
    }, {
      root: null,
      rootMargin: GENRE_ROOT_MARGIN,
      threshold: 0.01,
    });

    try { __genreArrowObserver.observe(GENRE_STATE._loadMoreArrow); } catch {}
  }

  const onScroll = () => {
    queueGenreViewportLoad(220);
    scheduleGenreAutoPump(110, 0);
  };

  __genreScrollHandler = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  requestAnimationFrame(onScroll);
  setTimeout(onScroll, 180);

  setGenreArrowLoading(!!GENRE_STATE.loading);
  scheduleGenreAutoPump(80, 0);
}

function isGenreArrowNearViewport() {
  return isGenreLoadTriggerNearViewport();
}

function scheduleGenreAutoPump(delayMs = 90, retryCount = 0) {
  if (__genreAutoPumpTimer) return;
  if (!__genreScrollIdleAttached) return;
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres?.length || 0)) return;

  __genreAutoPumpTimer = window.setTimeout(() => {
    __genreAutoPumpTimer = null;

    if (!__genreScrollIdleAttached) return;
    if (GENRE_STATE.loading) return;
    if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres?.length || 0)) {
      detachGenreScrollIdleLoader();
      return;
    }
    if (!isGenreArrowNearViewport()) {
      if (retryCount < 4) {
        scheduleGenreAutoPump(Math.min(420, Math.max(90, delayMs + 70)), retryCount + 1);
      }
      return;
    }

    loadNextGenreViaArrow();
  }, Math.max(32, delayMs | 0));
}

function loadNextGenreViaArrow() {
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres?.length || 0)) {
    detachGenreScrollIdleLoader();
    return;
  }

  GENRE_STATE.loading = true;
  setGenreArrowLoading(true);
  lockDownScroll();

  const start = GENRE_STATE.nextIndex;
  const end = Math.min(start + GENRE_BATCH_SIZE, GENRE_STATE.genres.length);

  GENRE_STATE.nextIndex = end;

  (async () => {
    for (let i = start; i < end; i++) {
      await ensureGenreLoaded(i);
    }
  })().finally(() => {
    GENRE_STATE.loading = false;
    setGenreArrowLoading(false);
    unlockDownScroll();

    if (GENRE_STATE.nextIndex >= GENRE_STATE.genres.length) {
      detachGenreScrollIdleLoader();
      __maybeSignalGenreHubsDone();
    } else {
      scheduleGenreAutoPump(70);
    }
  });
}

function detachGenreScrollIdleLoader() {
  if (!__genreScrollIdleAttached) return;
  __genreScrollIdleAttached = false;

  if (__genreArrowObserver) {
    try { __genreArrowObserver.disconnect(); } catch {}
    __genreArrowObserver = null;
  }

  if (GENRE_STATE._loadMoreArrow && GENRE_STATE._loadMoreArrow.parentElement) {
    try { GENRE_STATE._loadMoreArrow.parentElement.removeChild(GENRE_STATE._loadMoreArrow); } catch {}
  }
  GENRE_STATE._loadMoreArrow = null;

  if (__genreScrollIdleTimer) {
    clearTimeout(__genreScrollIdleTimer);
    __genreScrollIdleTimer = null;
  }

  if (__genreAutoPumpTimer) {
    clearTimeout(__genreAutoPumpTimer);
    __genreAutoPumpTimer = null;
  }

  if (__genreScrollHandler) {
    try {
      window.removeEventListener('scroll', __genreScrollHandler);
      window.removeEventListener('resize', __genreScrollHandler);
    } catch {}
    __genreScrollHandler = null;
  }
}

function setPrimaryCtaText(cardEl, text, isResume = false) {
  const btn =
    cardEl.querySelector('.dir-row-hero-play') ||
    cardEl.querySelector('.preview-play-button') ||
    cardEl.querySelector('.cardImageContainer .play') ||
    null;

  if (btn) {
    if (btn.classList.contains('dir-row-hero-play')) {
      const icon = findFaIcon(btn);
      btn.innerHTML = `${icon ? icon.outerHTML : ''} ${escapeHtml(text)}`;
    } else {
      btn.textContent = text;
    }
  }

  try { cardEl.dataset.prcResume = isResume ? '1' : '0'; } catch {}
}

function __idle(fn, timeout = 800) {
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") return ric(fn, { timeout });
  return setTimeout(fn, 0);
}

async function prunePlayedCardsInRow(rowEl, userId) {
  try {
    const cards = Array.from(rowEl?.querySelectorAll?.('.personal-recs-card') || []);
    if (!cards.length) return;

    const ids = cards.map(el => el?.dataset?.itemId).filter(Boolean);
    if (!ids.length) return;

    const alive = await filterOutPlayedIds(userId, ids);
    const aliveSet = new Set((alive || []).filter(Boolean));

    if (aliveSet.size === ids.length) return;

    for (const el of cards) {
      const id = el?.dataset?.itemId;
      if (id && !aliveSet.has(id)) {
        try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        try { el.remove(); } catch { try { el.parentElement?.removeChild(el); } catch {} }
      }
    }

    try { triggerScrollerUpdate(rowEl); } catch {}
  } catch {}
}

function schedulePrunePlayedAfterPaint(rowEl, userId, delayMs = 380) {
  try {
    setTimeout(() => {
      __idle(() => { prunePlayedCardsInRow(rowEl, userId); }, 1200);
    }, Math.max(0, delayMs|0));
  } catch {}
}

async function applyResumeLabelsToCards(cardEls, userId) {
  const ids = cardEls
    .map(el => el?.dataset?.itemId)
    .filter(Boolean);

  if (!ids.length) return;
  const url =
    `/Users/${encodeURIComponent(userId)}/Items?` +
    `Ids=${encodeURIComponent(ids.join(','))}&Fields=UserData`;

  let items = [];
  try {
    const r = await makeApiRequest(url);
    items = Array.isArray(r?.Items) ? r.Items : (Array.isArray(r) ? r : []);
  } catch {
    return;
  }

  const byId = new Map(items.map(it => [it.Id, it]));
  for (const el of cardEls) {
    const id = el?.dataset?.itemId;
    const it = byId.get(id);
    const pos = Number(it?.UserData?.PlaybackPositionTicks || 0);
    const isResume = pos > 0;
    const resumeText = (config.languageLabels?.devamet || 'Sürdür');
    const playText   = (config.languageLabels?.izle    || 'Oynat');
    setPrimaryCtaText(el, isResume ? resumeText : playText, isResume);
  }
}

function scheduleResumeLabels(cardEls, userId) {
  try {
    setTimeout(() => __idle(() => applyResumeLabelsToCards(cardEls, userId), 900), 420);
  } catch {}
}

let __personalRecsBusy = false;
let   __lastMoveTS   = 0;
let __pmLast = 0;
window.addEventListener('pointermove', () => {
  const now = Date.now();
  if (now - __pmLast > 80) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});
let __touchStickyOpen = false;
let __touchLastOpenTS = 0;
let __activeGenre = null;
let __currentGenreCtrl = null;
const __genreCache = new Map();
const __globalGenreHeroLoose = new Set();
const __globalGenreHeroStrict = new Set();
const TOUCH_STICKY_GRACE_MS = 1500;
const SCROLLER_BUSY_ATTR = "data-jms-scroll-active";
const SCROLLER_BUSY_IDLE_MS = 140;
const SCROLLER_BUSY_COOLDOWN_MS = 220;
const SCROLLER_BUSY_MAX_MS = 700;
const SCROLLER_BUSY_RETRY_MS = 90;

function __shouldRequestHiRes() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c?.saveData) return false;
    const et = String(c?.effectiveType || "");
    if (/^2g$|slow-2g/i.test(et)) return false;
  } catch {}
  return true;
}

function getScrollerMediaHost(node) {
  return node?.closest?.(".itemsContainer.personal-recs-row, .personal-recs-row, .genre-row") || null;
}

export function isScrollerMediaBusy(node) {
  const row = getScrollerMediaHost(node);
  if (!row) return false;
  if (row.getAttribute?.(SCROLLER_BUSY_ATTR) === "1") return true;
  return Number(row.__jmsScrollerBusyUntil || 0) > Date.now();
}

export function clearScrollerAwareHiResUpgrade(img) {
  if (!img) return;
  const tid = Number(img.__pendingHiTimer || 0);
  if (tid > 0) {
    try { clearTimeout(tid); } catch {}
  }
  delete img.__pendingHiTimer;
}

export function scheduleScrollerAwareHiResUpgrade(img, requestFn, delayMs = SCROLLER_BUSY_RETRY_MS) {
  if (!img || typeof requestFn !== "function") return;
  img.__pendingHi = true;
  if (img.__pendingHiTimer) return;

  const run = () => {
    delete img.__pendingHiTimer;
    if (!img?.isConnected || img.__pendingHi !== true) return;
    if (isScrollerMediaBusy(img)) {
      img.__pendingHiTimer = window.setTimeout(run, Math.max(32, delayMs | 0));
      return;
    }
    requestFn(img);
  };

  img.__pendingHiTimer = window.setTimeout(run, Math.max(32, delayMs | 0));
}

function clearHeroHost(heroHost) {
  if (!heroHost) return;
  try {
    heroHost.querySelectorAll('.dir-row-hero').forEach(el => {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  heroHost.innerHTML = '';
}

function mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold=false } = {}) {
  const heroItemId = resolveItemId(heroItem);
  if (!heroHost || !heroItemId) return { hero: null, changed: false };

  const existing = heroHost.querySelector('.dir-row-hero');
  const same = existing && (existing.dataset.itemId === String(heroItemId));

  if (same) {
    const lbl = existing.querySelector('.dir-row-hero-label');
    if (lbl && heroLabel) lbl.textContent = heroLabel;
    return { hero: existing, changed: false };
  }

  if (existing) {
    clearHeroHost(heroHost);
  }

  const hero = createGenreHeroCard(heroItem, serverId, heroLabel, { aboveFold });
  hero.classList.add('is-entering');
  heroHost.appendChild(hero);
  requestAnimationFrame(() => hero.classList.remove('is-entering'));
  return { hero, changed: true };
}

function hasKnownMissingImage(data) {
  return !!(isKnownMissingImage(data?.lqSrc) || isKnownMissingImage(data?.hqSrc));
}

function getImageFailureCounts(img) {
  return (img.__imageFailureCounts ||= { lq: 0, hi: 0 });
}

function incrementImageFailure(img, phase) {
  const counts = getImageFailureCounts(img);
  counts[phase] = (counts[phase] || 0) + 1;
  return counts[phase];
}

function resetImageFailures(img, phase = null) {
  if (!img) return;
  const counts = getImageFailureCounts(img);
  if (!phase) {
    counts.lq = 0;
    counts.hi = 0;
    return;
  }
  counts[phase] = 0;
}

function markImageSettled(img, src, { disableRecovery = false, disableHi = false } = {}) {
  if (!img) return;
  clearScrollerAwareHiResUpgrade(img);
  try { img.removeAttribute('srcset'); } catch {}
  if (src) {
    try { img.src = src; } catch {}
  }
  img.__phase = 'settled';
  img.__hiRequested = false;
  img.__hiFailed = false;
  img.__hydrated = true;
  img.__disableRecovery = disableRecovery === true;
  if (disableHi) img.__disableHi = true;
  delete img.__allowLqHydrate;
  delete img.__retryAfter;
  img.classList.add('__hydrated');
  img.classList.remove('is-lqip');
  try { __imgIO.unobserve(img); } catch {}
}

function markImageTerminalFailure(img, data, fallbackSrc = PLACEHOLDER_URL) {
  const brokenUrl = data?.lqSrc || data?.hqSrc || img?.currentSrc || img?.src || '';
  if (brokenUrl) markImageMissing(brokenUrl);
  markImageSettled(img, fallbackSrc, { disableRecovery: true, disableHi: true });
}

function requestHiResImage(img) {
  if (!img || !img.isConnected) return;
  const data = img.__data || {};
  if (img.__disableRecovery || hasKnownMissingImage(data)) {
    markImageSettled(img, data.fallback || PLACEHOLDER_URL, { disableRecovery: true, disableHi: true });
    return;
  }
  if (img.__disableHi) return;
  if (!__shouldRequestHiRes()) return;
  if (isScrollerMediaBusy(img)) {
    scheduleScrollerAwareHiResUpgrade(img, requestHiResImage);
    return;
  }
  clearScrollerAwareHiResUpgrade(img);

  const now = Date.now();
  const retryAfter = Number(img.__retryAfter || 0);
  const canRetry = !retryAfter || now >= retryAfter;
  const retryingHi = img.__hiFailed === true;

  if (retryingHi && !canRetry) return;
  if (img.__hiRequested && !(retryingHi && canRetry)) return;

  img.__pendingHi = false;
  img.__hiRequested = true;
  img.__hiFailed = false;
  img.__phase = 'hi';

  const token = (img.__retryToken = (Number(img.__retryToken || 0) + 1));
  const hqSrc = data.hqSrc
    ? (retryingHi ? __appendCb(data.hqSrc, `${now}-${token}`) : data.hqSrc)
    : null;
  const hqSrcset = data.hqSrcset
    ? data.hqSrcset.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(part => {
          const m = part.match(/^(\S+)\s+(.*)$/);
          if (!m) return part;
          const u = retryingHi ? __appendCb(m[1], `${now}-${token}`) : m[1];
          return `${u} ${m[2]}`;
        })
        .join(', ')
    : null;

  (async () => {
    if (hqSrc) {
      const ok = await __preloadDecode(hqSrc);
      if (!ok) throw new Error('decode failed');
    }
    if (hqSrcset) { try { img.srcset = hqSrcset; } catch {} }
    if (hqSrc)    { try { img.src = hqSrc; } catch {} }
  })().catch(() => {
    const hiFailures = incrementImageFailure(img, 'hi');
    if (hiFailures >= (PRC_IMAGE_RETRY_LIMITS.hi || 2)) {
      const settleSrc = img.currentSrc || img.src || data.lqSrc || data.fallback || PLACEHOLDER_URL;
      markImageSettled(img, settleSrc, { disableRecovery: true, disableHi: true });
      return;
    }
    img.__hiFailed = true;
    img.__hiRequested = false;
    img.__phase = 'lq';
    img.__retryAfter = Date.now() + 12_000;
    try { __imgIO.unobserve(img); } catch {}
    try { __imgIO.observe(img); } catch {}
  });
}

const __imgIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    const img = ent.target;
    const data = img.__data || {};
    if (ent.isIntersecting) {
        if (img.__disableRecovery || hasKnownMissingImage(data)) {
          markImageSettled(img, data.fallback || PLACEHOLDER_URL, { disableRecovery: true, disableHi: true });
          continue;
        }
        if (img.__disableHi) continue;
        if (!__shouldRequestHiRes()) continue;

        if (data.lqSrc && img.__lqLoaded !== true) {
          img.__pendingHi = true;
          continue;
        }

        requestHiResImage(img);
      } else {
    }
  }
}, { rootMargin: '300px 0px' });

function makePRCKey(it) {
  const nm = String(it?.Name || "")
    .normalize?.('NFKD')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
  const yr = it?.ProductionYear
    ? String(it.ProductionYear)
    : (it?.PremiereDate ? String(new Date(it.PremiereDate).getUTCFullYear() || '') : '');
   const tp = getPrcTypeToken(it?.Type);
   return `${tp}::${nm}|${yr}`;
 }

function makePRCLooseKey(it) {
  const nm = String(it?.Name || "")
    .normalize?.('NFKD')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();

  const tp = getPrcTypeToken(it?.Type);
  return `${tp}::${nm}`;
}

function buildPosterUrlLQ(item) {
  return buildPosterUrl(item, 120, 25);
}

function buildPosterUrlHQ(item) {
  return buildPosterUrl(item, 540, 72);
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

function isRenderableGenreCardItem(item) {
  if (!item || typeof item !== "object") return false;
  const { itemId, itemName } = primeItemIdentity(item);
  if (!itemId || !itemName) return false;

  const mediaType = String(item?.Type || "").trim();
  if (mediaType && !["Movie", "Series", "BoxSet"].includes(mediaType)) {
    return false;
  }

  return true;
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

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  const tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!tag) return null;

  const omitTag = shouldPreferTaglessImages(item);
  const parts = [];
  if (!omitTag) parts.push(`tag=${encodeURIComponent(tag)}`);
  parts.push(`maxWidth=${width}`);
  parts.push(`quality=${quality}`);
  parts.push(`EnableImageEnhancers=false`);
  const url = `/Items/${item.Id}/Images/Logo?${parts.join("&")}`;
  return withServer(url);
}

function buildBackdropUrl(item, width = "auto", quality = 90) {
  if (!item) return null;
  const candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;

  const omitTag = shouldPreferTaglessImages(item);
  const parts = [];
  if (!omitTag && candidate.tag) parts.push(`tag=${encodeURIComponent(candidate.tag)}`);
  parts.push(`maxWidth=${width}`);
  parts.push(`quality=${quality}`);
  parts.push(`EnableImageEnhancers=false`);
  const url = `/Items/${candidate.itemId}/Images/Backdrop?${parts.join("&")}`;
  return withServer(url);
}

function buildBackdropUrlLQ(item) {
  return buildBackdropUrl(item, 420, 25);
}

function buildBackdropUrlHQ(item) {
  return buildBackdropUrl(item, 1920, 80);
}

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
  try {
    const matchBtn = modal.querySelector('.preview-match-button');
    if (matchBtn) {
      matchBtn.textContent = '';
      matchBtn.style.display = 'none';
    }
  } catch {}
  try {
    const btns = modal.querySelector('.preview-buttons');
    if (btns) {
      btns.style.opacity = '0';
      btns.style.pointerEvents = 'none';
    }
    const playBtn = modal.querySelector('.preview-play-button');
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    const favBtn = modal.querySelector('.preview-favorite-button');
    if (favBtn) {
      favBtn.classList.remove('favorited');
      favBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    }
    const volBtn = modal.querySelector('.preview-volume-button');
    if (volBtn) volBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  } catch {}

  modal.classList.add('is-skeleton');
}

function currentIndexPage() {
  return document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)") || document.body;
}

function getHomeSectionsContainer(indexPage) {
  const scopedContainer = indexPage?.querySelector?.(".homeSectionsContainer");
  if (scopedContainer) return scopedContainer;
  if (indexPage && indexPage !== document.body) return indexPage;

  return (
    document.querySelector("#indexPage:not(.hide) .homeSectionsContainer, #homePage:not(.hide) .homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    indexPage
  );
}

function getScopedSection(id, indexPage = currentIndexPage()) {
  if (!id) return null;
  const selector = `#${id}`;
  return indexPage?.querySelector?.(selector) || document.getElementById(id);
}

function getParentSection(parent, id, indexPage = currentIndexPage()) {
  if (!parent || !id) return null;
  const selector = `#${id}`;
  const localMatch =
    indexPage?.querySelector?.(selector) ||
    parent.querySelector?.(selector) ||
    document.getElementById(id);
  return localMatch?.parentElement === parent ? localMatch : null;
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  const apply = () => {
    const container = indexPage?.querySelector?.(".homeSectionsContainer") || (
      (!indexPage || indexPage === document.body)
        ? (
            document.querySelector("#indexPage:not(.hide) .homeSectionsContainer, #homePage:not(.hide) .homeSectionsContainer") ||
            document.querySelector(".homeSectionsContainer")
          )
        : null
    );
    if (!container) return false;

    const ref = placeAfterId ? getScopedSection(placeAfterId, indexPage) : null;
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

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
}

function insertBefore(parent, node, ref) {
  if (!parent || !node) return;
  if (!ref || ref.parentElement !== parent) {
    appendToParent(parent, node);
    return;
  }
  if (node === ref) return;
  if (node.parentElement === parent && node.nextElementSibling === ref) return;
  parent.insertBefore(node, ref);
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
  } else {
    appendToParent(parent, node);
  }
}

function enforceOrder(homeSectionsHint) {
  const indexPage = homeSectionsHint?.closest?.("#indexPage, #homePage") || currentIndexPage();
  const parent = homeSectionsHint || getHomeSectionsContainer(indexPage);
  if (!parent) return;
  bindManagedSectionsBelowNative(parent);
  try { parent.__jmsManagedBelowNativeSchedule?.(); } catch {}
}

function placeSection(sectionEl, homeSections) {
  if (!sectionEl) return;
  const targetParent = homeSections || getHomeSectionsContainer(currentIndexPage());
  appendToParent(targetParent || document.body, sectionEl);
  enforceOrder(targetParent);
  try { ensureIntoHomeSections(sectionEl, currentIndexPage()); } catch {}
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;
  if (IS_MOBILE) {
    try { __imgIO.unobserve(img); } catch {}
    try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
    try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}
    delete img.__onErr;
    delete img.__onLoad;
    try { img.removeAttribute('srcset'); } catch {}
    const staticSrc = (isKnownMissingImage(hqSrc) || isKnownMissingImage(lqSrc))
      ? fb
      : (hqSrc || lqSrc || fb);
    const useMobileBlurTransition = img?.classList?.contains?.('cardImage') === true;
    const alreadyStatic = (img.__mobileStaticSrc === staticSrc && img.src === staticSrc);
    try { img.loading = "lazy"; } catch {}
    img.__mobileStaticSrc = staticSrc;
    img.__phase = 'static';
    img.__hiRequested = true;
    img.__disableHi = true;
    img.__pendingHi = false;
    if (!useMobileBlurTransition) {
      if (!alreadyStatic && img.src !== staticSrc) img.src = staticSrc;
      img.classList.remove('is-lqip');
      img.classList.add('__hydrated');
      img.__hydrated = true;
      img.__lqLoaded = true;
      return;
    }

    const cleanupMobileStaticListeners = () => {
      try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
      try { if (img.__onLoad) img.removeEventListener('load', img.__onLoad); } catch {}
      delete img.__onErr;
      delete img.__onLoad;
    };

    const finishMobileStaticHydration = () => {
      cleanupMobileStaticListeners();
      img.classList.add('__hydrated');
      requestAnimationFrame(() => {
        try { img.classList.remove('is-lqip'); } catch {}
      });
      img.__hydrated = true;
      img.__lqLoaded = true;
    };

    const failMobileStaticHydration = () => {
      cleanupMobileStaticListeners();
      markImageSettled(img, fb, { disableRecovery: true, disableHi: true });
      img.__disableHi = true;
      img.__pendingHi = false;
    };

    if (alreadyStatic && img.__hydrated === true) {
      img.classList.remove('is-lqip');
      img.classList.add('__hydrated');
      img.__lqLoaded = true;
      return;
    }

    img.classList.add('is-lqip');
    try { img.classList.remove('__hydrated'); } catch {}
    img.__hydrated = false;
    img.__lqLoaded = false;

    img.__onLoad = () => finishMobileStaticHydration();
    img.__onErr = () => failMobileStaticHydration();
    img.addEventListener('load', img.__onLoad, { once: true });
    img.addEventListener('error', img.__onErr, { once: true });

    if (!alreadyStatic && img.src !== staticSrc) {
      img.src = staticSrc;
    } else if (img.complete) {
      if (img.naturalWidth > 0) finishMobileStaticHydration();
      else failMobileStaticHydration();
    }
    return;
  }

  const wantsHi = __shouldRequestHiRes() && (hqSrc || hqSrcset);
  const lqSrcNoTag = toNoTagUrl(lqSrc);
  const hqSrcNoTag = toNoTagUrl(hqSrc);
  const hqSrcsetNoTag = toNoTagSrcset(hqSrcset);

  try { __imgIO.unobserve(img); } catch {}
  try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
  try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}

  img.__data = { lqSrc, hqSrc, hqSrcset, lqSrcNoTag, hqSrcNoTag, hqSrcsetNoTag, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;
  img.__hiFailed = false;
  img.__disableHi = false;
  img.__allowLqHydrate = false;
  img.__fallbackState = { lqNoTagTried: false, hiNoTagTried: false };
  img.__disableRecovery = false;
  img.__imageFailureCounts = { lq: 0, hi: 0 };
  img.__lqLoaded = false;
  img.__pendingHi = false;

  try { img.removeAttribute('srcset'); } catch {}
  try { img.classList.remove('__hydrated'); } catch {}
  if (hasKnownMissingImage(img.__data)) {
    markImageSettled(img, fb, { disableRecovery: true, disableHi: true });
    return;
  }
  if (lqSrc) {
    if (img.src !== lqSrc) img.src = lqSrc;
  } else {
    img.src = fb;
  }
  img.classList.add('is-lqip');
  img.__hydrated = false;

  const onError = () => {
    const data = img.__data || {};
    const st = (img.__fallbackState ||= { lqNoTagTried: false, hiNoTagTried: false });
    if (img.__phase === 'hi') {
      if (!st.hiNoTagTried && data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) {
        st.hiNoTagTried = true;
        promoteTaglessImageData(data);
        img.__phase = 'hi';
        img.__hiRequested = true;
        img.__hiFailed = false;
        try { img.removeAttribute('srcset'); } catch {}
        const cb = `hq-notag-${Date.now()}`;
        if (data.hqSrcset) {
          try { img.srcset = __appendCbToSrcset(data.hqSrcset, cb); } catch {}
        }
        try { img.src = __appendCb(data.hqSrc, cb); } catch {}
        return;
      }

      const hiFailures = incrementImageFailure(img, 'hi');
      if (hiFailures >= (PRC_IMAGE_RETRY_LIMITS.hi || 2)) {
        const settleSrc = data.lqSrc || img.currentSrc || img.src || fb;
        markImageSettled(img, settleSrc, { disableRecovery: true, disableHi: true });
        return;
      }

      img.__hiFailed = true;
      img.__hiRequested = false;
      img.__retryAfter = Date.now() + 12_000;
      if (st.hiNoTagTried || !data.hqSrcNoTag || data.hqSrcNoTag === data.hqSrc) {
        img.__disableHi = true;
      }

      try { img.removeAttribute('srcset'); } catch {}
      try { img.classList.remove('__hydrated'); } catch {}

      if (!st.lqNoTagTried && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        st.lqNoTagTried = true;
        promoteTaglessImageData(data);
        const lqNoTag = __appendCb(data.lqSrc, `lq-notag-${Date.now()}`);
        if (img.src !== lqNoTag) img.src = lqNoTag;
      } else if (data.lqSrc) {
        const lq = __appendCb(data.lqSrc, `lq-${Date.now()}`);
        if (img.src !== lq) img.src = lq;
      } else {
        img.src = fb;
      }

      img.__allowLqHydrate = true;
      img.classList.add('is-lqip');
      img.__phase = 'lq';

      try { __imgIO.unobserve(img); } catch {}
      try { __imgIO.observe(img); } catch {}
    } else {
      if (!st.lqNoTagTried && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        st.lqNoTagTried = true;
        promoteTaglessImageData(data);
        const lqNoTag = __appendCb(data.lqSrc, `lq-notag-${Date.now()}`);
        if (img.src !== lqNoTag) img.src = lqNoTag;
        return;
      }
      const lqFailures = incrementImageFailure(img, 'lq');
      if (lqFailures >= (PRC_IMAGE_RETRY_LIMITS.lq || 2) || hasKnownMissingImage(data)) {
        markImageTerminalFailure(img, data, fb);
        return;
      }
      img.__allowLqHydrate = true;
      img.__retryAfter = Date.now() + 12_000;
      try { img.src = fb; } catch {}
    }
  };

  const onLoad = () => {
    const data = img.__data || {};
    const fallbackRecoveryActive = !!img.__allowLqHydrate;

    const loadedSrc = img.currentSrc || img.src || '';
    if (loadedSrc && loadedSrc !== fb) {
      clearMissingImage(loadedSrc);
      clearMissingImage(data.lqSrc);
      clearMissingImage(data.hqSrc);
      resetImageFailures(img);
    }

    if (img.__phase === 'lq' && !fallbackRecoveryActive) {
      img.__lqLoaded = true;
      img.classList.add('__hydrated');
      img.classList.add('is-lqip');
      img.__hydrated = true;

      if (!wantsHi) {
        img.classList.remove('is-lqip');
        try { __imgIO.unobserve(img); } catch {}
        return;
      }

      if (img.__pendingHi) {
        scheduleScrollerAwareHiResUpgrade(img, requestHiResImage, 32);
      }
      return;
    }

    if (img.__phase === 'hi' || !wantsHi) {
      img.classList.add('__hydrated');
      img.classList.remove('is-lqip');
      img.__hydrated = true;
      img.__pendingHi = false;
      try { __imgIO.unobserve(img); } catch {}
      try { img.removeEventListener('error', onError); } catch {}
      try { img.removeEventListener('load',  onLoad); } catch {}
      delete img.__onErr;
      delete img.__onLoad;
      delete img.__allowLqHydrate;
      delete img.__retryAfter;
      return;
    }

    if (fallbackRecoveryActive) {
      img.classList.add('__hydrated');
      img.classList.remove('is-lqip');
      img.__hydrated = true;
      img.__hiRequested = false;
      img.__pendingHi = false;
      img.__retryAfter = Math.max(Number(img.__retryAfter || 0), Date.now() + 12_000);
      try { __imgIO.unobserve(img); } catch {}
      try { __imgIO.observe(img); } catch {}
    }
  };

  img.__onErr = onError;
  img.__onLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  if (wantsHi) {
    __imgIO.observe(img);
  }
}

function unobserveImage(img) {
  clearScrollerAwareHiResUpgrade(img);
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr;
  delete img.__onLoad;
  delete img.__hiFailed;
  delete img.__hiRequested;
  delete img.__disableHi;
  delete img.__disableRecovery;
  delete img.__allowLqHydrate;
  delete img.__retryAfter;
  delete img.__retryToken;
  delete img.__fallbackState;
  delete img.__imageFailureCounts;
  delete img.__lqLoaded;
  delete img.__pendingHi;
  if (img) {
    try { img.removeAttribute('srcset'); } catch {}
    try { delete img.__data; } catch {}
  }
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound) return;
  window.__jmsTouchCloserBound = true;
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

window.addEventListener('jms:hoverTrailer:close', () => {
  __touchStickyOpen = false;
  __touchLastOpenTS = 0;
}, { passive: true });
window.addEventListener('jms:hoverTrailer:closed', () => {
  __touchStickyOpen = false;
  __touchLastOpenTS = 0;
}, { passive: true });

function clearEnterTimer(cardEl) {
  const t = __enterTimers.get(cardEl);
  if (t) { clearTimeout(t); __enterTimers.delete(cardEl); }
}

function isHoveringCardOrModal(cardEl) {
  try {
    const overCard  = cardEl?.isConnected && cardEl.matches(':hover');
    const overModal = !!document.querySelector('.video-preview-modal:hover');
    return !!(overCard || overModal);
  } catch { return false; }
}

function schedulePostOpenGuard(cardEl, token, delay=340) {
  setTimeout(() => {
    if (__openTokenMap.get(cardEl) !== token) return;
    if (!isHoveringCardOrModal(cardEl)) {
      try { safeCloseHoverModal(); } catch {}
    }
  }, delay);
}

function scheduleClosePollingGuard(cardEl, tries=6, interval=90) {
  let count = 0;
  const iid = setInterval(() => {
    count++;
    if (isHoveringCardOrModal(cardEl)) { clearInterval(iid); return; }
    if (Date.now() - __lastMoveTS > 240 || count >= tries) {
      try { safeCloseHoverModal(); } catch {}
      clearInterval(iid);
    }
  }, interval);
}

function hasActiveHomePage() {
  return !!(document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)"));
}

function hasRenderablePersonalRecsContent(indexPage) {
  const section = getScopedSection("personal-recommendations", indexPage);
  if (!section) return false;
  return !!section.querySelector(
    ".personal-recs-row .personal-recs-card:not(.skeleton), .personal-recs-row .no-recommendations"
  );
}

function getBecauseYouWatchedSections(indexPage) {
  return Array.from(
    indexPage?.querySelectorAll?.('[id^="because-you-watched--"], #because-you-watched') || []
  ).filter((section) => !!section?.isConnected);
}

function hasRenderableBecauseYouWatchedContent(indexPage) {
  const sections = getBecauseYouWatchedSections(indexPage);
  if (!sections.length) return false;
  return sections.some((section) => !!section.querySelector(
    ".byw-row .personal-recs-card:not(.skeleton), .byw-row .no-recommendations"
  ));
}

function hasReadyBecauseYouWatchedState(indexPage) {
  if (hasRenderableBecauseYouWatchedContent(indexPage)) return true;
  const sections = getBecauseYouWatchedSections(indexPage);
  return sections.length === 0 && getBywDone();
}

function hasMountedRecommendationUi(runtimeConfig, indexPage) {
  if (!indexPage) return false;

  const personalOk =
    !runtimeConfig.enablePersonalRecommendations ||
    hasRenderablePersonalRecsContent(indexPage);
  const genreOk =
    !runtimeConfig.enableGenreHubs ||
    hasRenderableGenreHubContent(getScopedSection("genre-hubs", indexPage));
  const bywOk =
    !runtimeConfig.enableBecauseYouWatched ||
    hasReadyBecauseYouWatchedState(indexPage);

  return personalOk && genreOk && bywOk;
}

export async function renderPersonalRecommendations(options = {}) {
  const force = options?.force === true;
  if (force) {
    __deferredHomeSectionSeq += 1;
    __bywDeferredPromise = null;
    __genreDeferredPromise = null;
    prcWarn("render:force-reset-deferred", {
      force,
      seq: __deferredHomeSectionSeq,
    });
  }
  const deferredSeq = __deferredHomeSectionSeq;
  const runtimeConfig = getHomeRecommendationRuntimeConfig();
  prcLog("render:start", {
    force,
    deferredSeq,
    enablePersonalRecommendations: runtimeConfig.enablePersonalRecommendations,
    enableGenreHubs: runtimeConfig.enableGenreHubs,
    enableBecauseYouWatched: runtimeConfig.enableBecauseYouWatched,
  });
  let activeIndexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (
    !runtimeConfig.enablePersonalRecommendations &&
    !runtimeConfig.enableGenreHubs &&
    !runtimeConfig.enableBecauseYouWatched
  ) {
    prcLog("render:skip:disabled", { force, deferredSeq });
    clearPersonalRecsRetry();
    resetPersonalRecsAndGenreState();
    return;
  }

  if (!activeIndexPage) {
    if (!isPersonalRecsHomeRoute()) {
      prcWarn("render:skip:not-home-route", { force, deferredSeq });
      return;
    }
    const host = await waitForVisibleHomeSections({
      timeout: 12000
    });
    activeIndexPage = host?.page || null;
    if (!activeIndexPage) {
      prcWarn("render:retry:no-active-page-after-wait", {
        force,
        deferredSeq,
        hostPageId: host?.page?.id || null,
        hasContainer: !!host?.container,
      });
      schedulePersonalRecsRetry(1000, options, "no-active-page-after-wait");
      return false;
    }
  }

  if (!activeIndexPage.querySelector(".homeSectionsContainer")) {
    const host = await waitForVisibleHomeSections({
      timeout: 12000
    });
    activeIndexPage = host?.page || activeIndexPage;
  }

  if (!activeIndexPage?.querySelector(".homeSectionsContainer")) {
    __personalRecsInitDone = false;
    prcWarn("render:retry:no-homeSectionsContainer", {
      force,
      deferredSeq,
      activePageId: activeIndexPage?.id || null,
    });
    schedulePersonalRecsRetry(900, options, "no-homeSectionsContainer");
    return false;
  }

  if (!force && hasMountedRecommendationUi(runtimeConfig, activeIndexPage)) {
    prcLog("render:skip:already-rendered", {
      force,
      deferredSeq,
      activePageId: activeIndexPage?.id || null,
    });
    clearPersonalRecsRetry();
    __personalRecsInitDone = true;
    if (runtimeConfig.enablePersonalRecommendations) {
      setPersonalRecsDone(true);
    }
    if (runtimeConfig.enableBecauseYouWatched) {
      setBywDone(true);
    }
    if (runtimeConfig.enableGenreHubs) {
      try { __signalGenreHubsDone(); } catch {}
    }
    scheduleHomeScrollerRefresh(0);
    return;
  }

  if (__personalRecsInitDone) {
    const personalOk =
      !runtimeConfig.enablePersonalRecommendations ||
      (getPersonalRecsDone() && hasRenderablePersonalRecsContent(activeIndexPage));
    const genreOk =
      !runtimeConfig.enableGenreHubs ||
      (!!window.__jmsGenreHubsDone && hasRenderableGenreHubContent(getScopedSection("genre-hubs", activeIndexPage)));
    const bywOk =
      !runtimeConfig.enableBecauseYouWatched ||
      hasReadyBecauseYouWatchedState(activeIndexPage);
    if (personalOk && genreOk && bywOk) {
      prcLog("render:skip:init-already-complete", {
        force,
        deferredSeq,
      });
      scheduleHomeScrollerRefresh(0);
      return;
    }
  }
  __personalRecsInitDone = true;

  if (__personalRecsBusy) {
    prcWarn("render:retry:busy", {
      force,
      deferredSeq,
    });
    schedulePersonalRecsRetry(1200, options, "busy");
    return false;
  }
  __personalRecsBusy = true;

  try {
    lockDownScroll();
    try {
      const { userId, serverId } = getSessionInfo();
      await ensurePrcDb(userId, serverId);
    } catch {}
    const indexPage = activeIndexPage;
    if (!indexPage) {
      __personalRecsInitDone = false;
      prcWarn("render:retry:no-index-page-inside-run", {
        force,
        deferredSeq,
      });
      schedulePersonalRecsRetry(1000, options, "no-index-page-inside-run");
      return false;
    }
    const hasHomeSections = !!(
      indexPage.querySelector(".homeSectionsContainer")
    );
    if (!hasHomeSections) {
      __personalRecsInitDone = false;
      prcWarn("render:retry:no-homeSections-inside-run", {
        force,
        deferredSeq,
        indexPageId: indexPage?.id || null,
      });
      schedulePersonalRecsRetry(900, options, "no-homeSections-inside-run");
      return false;
    }

    const tasks = [];

    if (runtimeConfig.enablePersonalRecommendations) {
      setPersonalRecsDone(false);
      const personalCardCount = getPersonalRecsCardCount();
      const section = ensurePersonalRecsContainer(indexPage);
      const row = section?.querySelector?.(".personal-recs-row") || null;
      if (row) {
        if (!row.dataset.mounted || row.childElementCount === 0) {
          row.dataset.mounted = "1";
          renderSkeletonCards(row, personalCardCount);
          setupScroller(row);
        }

        tasks.push((async () => {
          try {
            prcLog("PERSONAL:wait:managed-gate", {
              force,
              seq: deferredSeq,
            });
            await waitForManagedSectionGate("personalRecommendations", { timeoutMs: 25000 });
            if (deferredSeq !== __deferredHomeSectionSeq) return;
            await waitForManagedSectionDependencyCompletion("personalRecommendations", { timeoutMs: 25000 });
            if (deferredSeq !== __deferredHomeSectionSeq) return;
            if (!row.isConnected || !hasActivePersonalRecsHomeSections()) {
              prcWarn("PERSONAL:abort:gate-invalidated", {
                force,
                seq: deferredSeq,
              });
              return;
            }
            const { userId, serverId } = getSessionInfo();
            const recommendations = await fetchPersonalRecommendations(
              userId,
              personalCardCount,
              MIN_RATING,
              { force }
            );
            renderRecommendationCards(row, recommendations, serverId);
            setPersonalRecsDone(true);
            schedulePrunePlayedAfterPaint(row, userId, 360);
          } catch (e) {
            console.error("Kişisel öneriler alınırken hata:", e);
            setPersonalRecsDone(true);
          }
        })());
      }
    }

    if (runtimeConfig.enableBecauseYouWatched) {
      setBywDone(false);
      scheduleDeferredBecauseYouWatchedRender({ force, seq: deferredSeq });
    }

    if (runtimeConfig.enableGenreHubs) {
      scheduleDeferredGenreHubsRender({ force, seq: deferredSeq });
    }

    prcLog("render:deferred-sections-scheduled", {
      force,
      deferredSeq,
      personalTaskCount: tasks.length,
      enableBecauseYouWatched: runtimeConfig.enableBecauseYouWatched,
      enableGenreHubs: runtimeConfig.enableGenreHubs,
    });

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }

    try {
      const hsc = getHomeSectionsContainer(indexPage);
      enforceOrder(hsc);
    } catch {}

    const personalMounted =
      !runtimeConfig.enablePersonalRecommendations ||
      hasRenderablePersonalRecsContent(indexPage);
    if (personalMounted) {
      prcLog("render:success:personal-block-ready", {
        force,
        deferredSeq,
        indexPageId: indexPage?.id || null,
      });
      clearPersonalRecsRetry();
    } else {
      prcWarn("render:retry:personal-block-empty", {
        force,
        deferredSeq,
        indexPageId: indexPage?.id || null,
      });
      schedulePersonalRecsRetry(1400, options, "personal-block-empty");
    }

  } catch (error) {
    console.error("Kişisel öneriler / tür hub render hatası:", error);
    prcWarn("render:error", {
      force,
      deferredSeq,
      error: error?.message || String(error),
    });
    schedulePersonalRecsRetry(1400, options, "render-error");
  } finally {
    unlockDownScroll();
    __personalRecsBusy = false;
  }
}

function ensureBecauseContainer(indexPage, key = "0") {
  const homeSections = getHomeSectionsContainer(indexPage);
  const id = `because-you-watched--${key}`;
  let existing = getScopedSection(id, indexPage);
  if (existing) {
    const parent = homeSections || getHomeSectionsContainer(indexPage) || getHomeSectionsContainer(currentIndexPage());
    placeSection(existing, homeSections, false);
    const heroHost = existing.querySelector('.dir-row-hero-host');
    if (heroHost) {
      const showHero = isPersonalRecsHeroEnabled();
      heroHost.style.display = showHero ? '' : 'none';
      if (!showHero) clearHeroHost(heroHost);
    }
    try { enforceOrder(parent); } catch {}
    return existing;
  }

  const section = document.createElement("div");
  section.id = id;
  section.classList.add("homeSection", "personal-recs-section", "byw-section");
  section.innerHTML = `
    <div class="sectionTitleContainer sectionTitleContainer-cards">
      <h2 class="sectionTitle sectionTitle-cards">
        <span class="byw-title-text">${(config.languageLabels?.becauseYouWatched) || (labels.becauseYouWatched) || "İzlediğin için"}</span>
      </h2>
    </div>
    <div class="personal-recs-scroll-wrap">
      <button class="hub-scroll-btn hub-scroll-left" aria-label="${(config.languageLabels?.scrollLeft) || "Sola kaydır"}" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <div class="itemsContainer personal-recs-row byw-row" role="list"></div>
      <button class="hub-scroll-btn hub-scroll-right" aria-label="${(config.languageLabels?.scrollRight) || "Sağa kaydır"}" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      </button>
    </div>
  `;
  const scrollWrap = section.querySelector('.personal-recs-scroll-wrap');
  const heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = isPersonalRecsHeroEnabled() ? '' : 'none';
  section.insertBefore(heroHost, scrollWrap);
  section.__heroHost = heroHost;

  const parent = homeSections || getHomeSectionsContainer(indexPage) || getHomeSectionsContainer(currentIndexPage());
  placeSection(section, homeSections, false);
  try { enforceOrder(parent); } catch {}
  return section;
}

function cleanupBecauseYouWatchedSection(section) {
  if (!section) return;
  try {
    section.querySelectorAll('.personal-recs-card, .dir-row-hero').forEach((el) => {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    section.querySelectorAll('.byw-row').forEach((row) => {
      try { row.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    const heroHost = section.__heroHost || section.querySelector('.dir-row-hero-host');
    if (heroHost) clearHeroHost(heroHost);
  } catch {}
  try { section.remove(); } catch {}
}

function getEffectiveLang3() {
  let l = '';
  try { l = String(getDefaultLanguage?.() || '').toLowerCase().trim(); } catch {}

  const base = l.split('-')[0];

  const map2to3 = {
    tr: 'tur',
    en: 'eng',
    de: 'deu',
    fr: 'fre',
    ru: 'rus',
    es: 'spa',
  };
  if (['tur','eng','deu','fre','rus','spa'].includes(base)) return base;
  if (map2to3[base]) return map2to3[base];
  return 'eng';
}

function getLangKeyCandidates() {
  let raw = '';
  try { raw = String(getDefaultLanguage?.() || '').trim(); } catch {}

  const lower = raw.toLowerCase();
  const base = lower.split('-')[0];
  const map2to3 = { tr:'tur', en:'eng', de:'deu', fr:'fre', ru:'rus', es:'spa' };
  const three = map2to3[base] || base;
  const out = [];
  if (lower) out.push(lower);
  if (base)  out.push(base);
  if (three) out.push(three);
  out.push('eng', 'tur');

  return Array.from(new Set(out.filter(Boolean)));
}

function pickTpl(raw) {
  if (!raw) return null;

  if (typeof raw === 'string') return raw;

  if (raw && typeof raw === 'object') {
    const cand = getLangKeyCandidates();
    for (const k of cand) {
      if (raw[k]) return raw[k];
    }
  }
  return null;
}

function formatBecauseYouWatchedTitle(seedName) {
  const title = String(seedName || "").trim();
  if (!title) return "";

  const raw =
    config.languageLabels?.becauseYouWatched ??
    labels.becauseYouWatched ??
    null;

  let tpl = pickTpl(raw);
  if (!tpl) {
    const cand = getLangKeyCandidates();
    if (cand.includes('de') || cand.includes('deu')) tpl = "Weil du {title} angesehen hast";
    else if (cand.includes('eng') || cand.includes('en')) tpl = "Because you watched {title}";
    else tpl = "{title} izlediğiniz için";
  }

  return String(tpl).replace("{title}", title);
}

function setBywTitle(section, seedName) {
  const el = section?.querySelector?.(".byw-title-text");
  if (!el) return;
  el.textContent = formatBecauseYouWatchedTitle(seedName);
}

async function fetchLastPlayedSeedItems(userId, count = 1) {
  const fields = COMMON_FIELDS + ",UserData";
  try {
    const url =
      `/Users/${encodeURIComponent(userId)}/Items?` +
      `Recursive=true&IncludeItemTypes=Movie,Series&Filters=IsPlayed&` +
      `SortBy=DatePlayed,LastPlayedDate&SortOrder=Descending&Limit=${Math.max(1, count)}&Fields=${encodeURIComponent(fields)}`;
    const r = await makeApiRequest(url);
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items.filter(x => x?.Id);
  } catch {}

  try {
    const url =
      `/Users/${encodeURIComponent(userId)}/Items?` +
      `Recursive=true&Filters=IsResumable&MediaTypes=Video&EnableUserData=true&` +
      `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(1, count)}&Fields=${encodeURIComponent(fields)}`;
    const r = await makeApiRequest(url);
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items.filter(x => x?.Id && Number(x?.UserData?.PlaybackPositionTicks || 0) > 0);
  } catch {}

  return [];
}

async function fetchBecauseYouWatchedPool(userId, seedId, limit = 60, minRating = 0) {
  const url =
    `/Items/${encodeURIComponent(seedId)}/Similar?` +
    `UserId=${encodeURIComponent(userId)}&Limit=${Math.max(60, limit)}&Fields=${encodeURIComponent(COMMON_FIELDS)}`;
  try {
    const r = await makeApiRequest(url);
    const items = Array.isArray(r?.Items) ? r.Items : (Array.isArray(r) ? r : []);
    return filterAndTrimByRating(items, minRating, limit);
  } catch {
    return [];
  }
}

async function fetchBecauseYouWatched(userId, targetCount, minRating, seedKey, options = {}) {
  const force = options?.force === true;
  const cfg = __prcCfg();
  const { serverId } = getSessionInfo();
  const st = await ensurePrcDb(userId, serverId);
  const sessionScope = getPrcSessionScope(userId, serverId);

  let seedId = String(seedKey || "").trim();
  if (!seedId) return { seedId: null, items: [] };
  try {
    if (!seedId && st?.db && st?.scope) {
      const seed = await getMeta(st.db, __metaKeyBywSeed(st.scope));
      if (seed?.id) seedId = seed.id;
    }
  } catch {}

  if (!seedId) {
    const seedItem = await fetchLastPlayedSeedItem(userId);
    seedId = seedItem?.Id || null;
    if (seedId && st?.db && st?.scope) {
      try { await setMeta(st.db, __metaKeyBywSeed(st.scope), { id: seedId, ts: Date.now() }); } catch {}
    }
  }
  if (!seedId) return { seedId: null, items: [] };

  const bywSessionKey = `${sessionScope}|${seedId}`;
  if (!force) {
    const sessionItems = PRC_SESSION_BYW_ITEMS_CACHE.get(bywSessionKey);
    if (Array.isArray(sessionItems) && sessionItems.length >= targetCount) {
      return { seedId, items: sessionItems.slice(0, targetCount) };
    }
  }

  try {
    if (st?.db && st?.scope) {
      const cache = await getMeta(st.db, __metaKeyBywScoped(st.scope, seedId));
      const ts = Number(cache?.ts || 0);
      const ids = Array.isArray(cache?.ids) ? cache.ids : [];
      const cacheSeed = String(cache?.seedId || "");
      const fresh = ts && (Date.now() - ts) <= cfg.bywTtlMs;

      if (fresh && ids.length && cacheSeed === String(seedId)) {
        let lastShownIds = [];
        try {
          const last = await getMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId));
          lastShownIds = Array.isArray(last?.ids) ? last.ids : [];
        } catch {}
        const lastSet = new Set(lastShownIds);

        let candidates = ids.filter(id => id && !lastSet.has(id));
        if (candidates.length < Math.max(6, targetCount * 2)) candidates = ids.slice();
        shuffle(candidates);

        const alive = await filterOutPlayedIds(userId, candidates.slice(0, Math.min(candidates.length, cfg.maxCacheIds)));
        const itemsFromDb = await dbGetItemsByIds(st.db, st.scope, alive);
        shuffle(itemsFromDb);

        const picked = filterAndTrimByRating(itemsFromDb, minRating, targetCount);
        if (picked.length >= targetCount) {
          PRC_SESSION_BYW_ITEMS_CACHE.set(bywSessionKey, picked.slice(0, targetCount));
          try { await setMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId), { ids: picked.map(x=>x.Id).filter(Boolean), ts: Date.now() }); } catch {}
          return { seedId, items: picked.slice(0, targetCount) };
        }
      }
    }
  } catch {}

  const pool = await fetchBecauseYouWatchedPool(
    userId,
    seedId,
    Math.max(60, targetCount * 4),
    minRating
  );

  shuffle(pool);
  let uniq = dedupeStrong(pool).slice(0, cfg.maxCacheIds);
  shuffle(uniq);

  try {
    if (st?.db && st?.scope && uniq.length) {
      await dbWriteThroughItems(st.db, st.scope, uniq);
      await setMeta(st.db, __metaKeyBywScoped(st.scope, seedId), { seedId, ids: uniq.map(x=>x.Id).filter(Boolean), ts: Date.now() });
      await setMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId), {
        ids: uniq.slice(0, targetCount).map(x=>x.Id).filter(Boolean),
        ts: Date.now()
      });
    }
  } catch {}

  PRC_SESSION_BYW_ITEMS_CACHE.set(bywSessionKey, uniq.slice(0, targetCount));

  return { seedId, items: uniq.slice(0, targetCount) };
}

function runWithConcurrency(fns, limit = 2) {
  const queue = (fns || []).slice();
  const n = Math.max(1, Math.min(limit | 0, queue.length || 1));
  const workers = new Array(n).fill(0).map(async () => {
    while (queue.length) {
      const fn = queue.shift();
      if (!fn) continue;
      try { await fn(); } catch {}
    }
  });
  return Promise.all(workers);
}

async function renderBecauseYouWatchedAuto(indexPage, options = {}) {
  const force = options?.force === true;
  const bywRowCount = getBywRowCount();
  const bywCardCount = getBywCardCount();
  const { userId, serverId } = getSessionInfo();
  const sessionScope = getPrcSessionScope(userId, serverId);
  let seeds = (!force ? PRC_SESSION_BYW_SEEDS_CACHE.get(sessionScope) : null) || null;

  if (!Array.isArray(seeds) || seeds.length < bywRowCount) {
    const seedsRaw = await fetchLastPlayedSeedItems(userId, Math.max(1, bywRowCount * 2));
    shuffleCrypto(seedsRaw);
    const seen = new Set();
    seeds = [];
    for (const it of seedsRaw) {
      const id = it?.Id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      seeds.push(it);
      if (seeds.length >= bywRowCount) break;
    }
    PRC_SESSION_BYW_SEEDS_CACHE.set(sessionScope, seeds.slice());
  }

  if (!seeds.length) {
    for (const section of getBecauseYouWatchedSections(indexPage)) {
      cleanupBecauseYouWatchedSection(section);
    }
    scheduleHomeScrollerRefresh(0);
    setBywDone(true);
    return;
  }

  const activeSectionIds = new Set(
    seeds.map((_, index) => `because-you-watched--${index}`)
  );
  for (const section of getBecauseYouWatchedSections(indexPage)) {
    const sectionId = String(section?.id || "").trim();
    if (!activeSectionIds.has(sectionId)) {
      cleanupBecauseYouWatchedSection(section);
    }
  }

  const ctxs = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const seedId = seed.Id;
    const seedName = seed.Name || "";
    const section = ensureBecauseContainer(indexPage, String(i));
    setBywTitle(section, seedName);
    const row = section.querySelector(".byw-row");
    if (!row) continue;
    renderSkeletonCards(row, bywCardCount);
    setupScroller(row);
    ctxs.push({ i, seed, seedId, seedName, section, row });
  }

  const jobs = ctxs.map((ctx) => async () => {
    const { i, seedId, seedName, section, row } = ctx;
    const showHero = isPersonalRecsHeroEnabled();
    const fetchCount = showHero
      ? Math.min(UNIFIED_ROW_ITEM_LIMIT, bywCardCount + 1)
      : bywCardCount;
    const { items } = await fetchBecauseYouWatched(userId, fetchCount, MIN_RATING, seedId, { force });
    clearRowWithCleanup(row);
    if (!items || !items.length) {
      cleanupBecauseYouWatchedSection(section);
      return;
    }

    const heroItem = showHero ? (items[0] || null) : null;
    let rowItems = showHero
      ? items.slice(1, 1 + bywCardCount)
      : items.slice(0, bywCardCount);
    if (!rowItems.length) rowItems = items.slice(0, bywCardCount);

    try {
      const heroHost = section.__heroHost || section.querySelector('.dir-row-hero-host');
      if (heroHost) {
        heroHost.style.display = showHero ? '' : 'none';
        if (!showHero) {
          clearHeroHost(heroHost);
        } else {
          if (resolveItemId(heroItem)) {
            const heroLabel = formatBecauseYouWatchedTitle(seedName);
            const { hero: heroEl, changed } = mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold: i === 0 });
            try {
              const backdropImg = heroEl?.querySelector?.('.dir-row-hero-bg');
              const RemoteTrailers =
                heroItem.RemoteTrailers ||
                heroItem.RemoteTrailerItems ||
                heroItem.RemoteTrailerUrls ||
                [];
              if (heroEl && (changed || !heroEl.querySelector('.intro-video-container'))) {
                createTrailerIframe({
                  config,
                  RemoteTrailers,
                  slide: heroEl,
                  backdropImg,
                  itemId: heroItem.Id,
                  serverId,
                  detailsUrl: getDetailsUrl(heroItem.Id, serverId),
                  detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
                  showDetailsOverlay: false,
                });
              }
            } catch {}
          } else {
            clearHeroHost(heroHost);
          }
        }
      }
    } catch {}

    const frag = document.createDocumentFragment();
    for (let k = 0; k < Math.min(rowItems.length, bywCardCount); k++) {
      frag.appendChild(createRecommendationCard(rowItems[k], serverId, {
        aboveFold: k < (IS_MOBILE ? 2 : 3),
        sizeHint: "byw"
      }));
    }
    row.appendChild(frag);
    try { applyResumeLabelsToCards(Array.from(row.querySelectorAll('.personal-recs-card')), userId); } catch {}
    triggerScrollerUpdate(row);
  });

  await runWithConcurrency(jobs, IS_MOBILE ? MOBILE_ROW_BATCH_SIZE : 2);
  try { enforceOrder(getHomeSectionsContainer(indexPage)); } catch {}
  scheduleHomeScrollerRefresh(0);
  setBywDone(true);
}

function ensurePersonalRecsContainer(indexPage) {
  const homeSections = getHomeSectionsContainer(indexPage);
  let existing = getScopedSection("personal-recommendations", indexPage);
  if (existing) {
    placeSection(existing, homeSections);
    return existing;
  }
  const section = document.createElement("div");
  section.id = "personal-recommendations";
  section.classList.add("homeSection", "personal-recs-section");
  section.innerHTML = `
  <div class="sectionTitleContainer sectionTitleContainer-cards">
    <h2 class="sectionTitle sectionTitle-cards prc-title">
      <span class="prc-title-text" role="button" tabindex="0"
        aria-label="${(config.languageLabels?.seeAll || 'Tümünü gör')}: ${(config.languageLabels?.personalRecommendations) || labels.personalRecommendations || "Sana Özel Öneriler"}">
        ${(config.languageLabels?.personalRecommendations) || labels.personalRecommendations || "Sana Özel Öneriler"}
      </span>
      <div class="prc-see-all"
           aria-label="${(config.languageLabels?.seeAll) || "Tümünü gör"}"
           title="${(config.languageLabels?.seeAll) || "Tümünü gör"}">
        ${faIconHtml("chevronRight")}
      </div>
      <span class="prc-see-all-tip">${(config.languageLabels?.seeAll) || "Tümünü gör"}</span>
    </h2>
  </div>

  <div class="personal-recs-scroll-wrap">
    <button class="hub-scroll-btn hub-scroll-left" aria-label="${(config.languageLabels && config.languageLabels.scrollLeft) || "Sola kaydır"}" aria-disabled="true">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
    </button>
    <div class="itemsContainer personal-recs-row" role="list"></div>
    <button class="hub-scroll-btn hub-scroll-right" aria-label="${(config.languageLabels && config.languageLabels.scrollRight) || "Sağa kaydır"}" aria-disabled="true">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
    </button>
  </div>
`;

  const t = section.querySelector('.prc-title-text');
    if (t) {
      const open = (e) => { e.preventDefault(); e.stopPropagation(); openPersonalExplorer(); };
      t.addEventListener('click', open, { passive:false });
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
    }
    const seeAll = section.querySelector('.prc-see-all');
    if (seeAll) {
      seeAll.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPersonalExplorer(); }, { passive:false });
    }

      placeSection(section, homeSections);
      return section;
    }

function renderSkeletonCards(row, count = 1) {
  row.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "card personal-recs-card skeleton";
    el.innerHTML = `
      <div class="cardBox">
        <div class="cardImageContainer">
          <div class="cardImage"></div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-type-badge skeleton-line" style="width:40px;height:18px;border-radius:4px;"></div>
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
    row.appendChild(el);
  }
}

async function fetchPersonalRecommendations(userId, targetCount = null, minRating = 0, options = {}) {
  const force = options?.force === true;
  const effectiveTargetCount = clampConfiguredCount(targetCount, getPersonalRecsCardCount());
  const cfg = __prcCfg();
  const cacheGoal = Math.min(
    cfg.maxCacheIds,
    Math.max(effectiveTargetCount * 12, 40)
  );
  const { serverId } = getSessionInfo();
  const sessionScope = getPrcSessionScope(userId, serverId);

  if (!force) {
    const sessionItems = PRC_SESSION_PERSONAL_CACHE.get(sessionScope);
    if (Array.isArray(sessionItems) && sessionItems.length >= effectiveTargetCount) {
      return sessionItems.slice(0, effectiveTargetCount);
    }
  }

  try {
    const st = await ensurePrcDb(userId, serverId);

    if (st?.db && st?.scope) {
      const cache = await getMeta(st.db, __metaKeyPersonal(st.scope));
      const ts = Number(cache?.ts || 0);
      const ids = Array.isArray(cache?.ids) ? cache.ids : [];
      const fresh = ts && (Date.now() - ts) <= cfg.personalTtlMs;

      if (fresh && ids.length) {
        let lastShownIds = [];
        try {
          const last = await getMeta(st.db, __metaKeyPersonalLast(st.scope));
          lastShownIds = Array.isArray(last?.ids) ? last.ids : [];
        } catch {}

        const lastSet = new Set(lastShownIds);

        let candidates = ids.filter(id => id && !lastSet.has(id));

        if (candidates.length < Math.max(6, effectiveTargetCount * 2)) {
          candidates = ids.slice();
        }
        shuffle(candidates);

        const sampleIds = candidates.slice(0, Math.min(candidates.length, cacheGoal));
        const aliveIds = await filterOutPlayedIds(userId, sampleIds);
        const itemsFromDb = await dbGetItemsByIds(st.db, st.scope, aliveIds);

        shuffle(itemsFromDb);

        const picked = filterAndTrimByRating(itemsFromDb, minRating, effectiveTargetCount);
        if (picked.length >= effectiveTargetCount) {
          PRC_SESSION_PERSONAL_CACHE.set(sessionScope, picked.slice(0, effectiveTargetCount));
          try {
            await setMeta(st.db, __metaKeyPersonalLast(st.scope), {
              ids: picked.map(x => x.Id).filter(Boolean),
              ts: Date.now()
            });
          } catch {}
          return picked.slice(0, effectiveTargetCount);
        }
      }
    }
  } catch {}

  const requested = Math.max(effectiveTargetCount * 4, 80);
  const fallbackP = getFallbackRecommendations(userId, requested).catch(()=>[]);
  const topGenres = await getCachedUserTopGenres(3).catch(()=>[]);
  let pool = [];

  if (topGenres && topGenres.length) {
    const byGenre = await fetchUnwatchedByGenres(userId, topGenres, requested, minRating).catch(()=>[]);
    pool = pool.concat(byGenre);
  }
  const fallback = await fallbackP;
  pool = pool.concat(fallback);

  shuffle(pool);

  const seen = new Set();
  const uniq = [];

  for (const item of pool) {
    if (!item?.Id) continue;

    const key = makePRCKey(item);
    if (!key || seen.has(key)) continue;

    const score = Number(item.CommunityRating);
    if (minRating > 0 && !(Number.isFinite(score) && score >= minRating)) continue;

    seen.add(key);
    uniq.push(item);

    if (uniq.length >= cacheGoal) break;
  }

  if (uniq.length < cacheGoal) {
    for (const item of pool) {
      if (!item?.Id) continue;

      const key = makePRCKey(item);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      uniq.push(item);

      if (uniq.length >= cacheGoal) break;
    }
  }

  shuffle(uniq);
  const final = uniq.slice(0, effectiveTargetCount);

  try {
    const st = await ensurePrcDb(userId, serverId);
    if (st?.db && st?.scope && final?.length) {
      await setMeta(st.db, __metaKeyPersonalLast(st.scope), {
        ids: final.map(x => x.Id).filter(Boolean),
        ts: Date.now()
      });
    }
  } catch {}

  PRC_SESSION_PERSONAL_CACHE.set(sessionScope, final.slice(0, effectiveTargetCount));

  return final;
}

function dedupeStrong(items = []) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = makePRCKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function fetchUnwatchedByGenres(userId, genres, targetCount = 20, minRating = 0) {
  if (!genres || !genres.length) {
    const fb = await getFallbackRecommendations(userId, targetCount * 3);
    return filterAndTrimByRating(fb, minRating, targetCount);
  }

  const genresParam = encodeURIComponent(genres.join("|"));
  const fields = LIGHT_FIELDS;
  const requested = Math.max(targetCount * 2, 20);
  const sort = "Random,CommunityRating,DateCreated";

  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&` +
    `Genres=${genresParam}&Fields=${fields}&` +
    `SortBy=${sort}&SortOrder=Descending&Limit=${requested}`;

  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    return filterAndTrimByRating(items, minRating, targetCount);
  } catch (err) {
    console.error("Türe göre içerik alınırken hata:", err);
    const fb = await getFallbackRecommendations(userId, requested);
    return filterAndTrimByRating(fb, minRating, targetCount);
  }
}

async function getFallbackRecommendations(userId, limit = 20) {
  const fields = LIGHT_FIELDS;
  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&` +
    `Fields=${fields}&` +
    `SortBy=Random,CommunityRating&SortOrder=Descending&Limit=${limit}`;

  try {
    const data = await makeApiRequest(url);
    return Array.isArray(data?.Items) ? data.Items : [];
  } catch (err) {
    console.error("Fallback öneriler alınırken hata:", err);
    return [];
  }
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

function filterAndTrimByRating(items, minRating, maxCount) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it || !it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    const score = Number(it.CommunityRating);
    if (minRating > 0 && !(Number.isFinite(score) && score >= minRating)) continue;
    out.push(it);
    if (out.length >= maxCount) break;
  }
  return out;
}

function clearRowWithCleanup(row) {
  if (!row) return;
  try {
    row.querySelectorAll('.personal-recs-card').forEach(el => {
      el.dispatchEvent(new Event('jms:cleanup'));
    });
  } catch {}
  row.innerHTML = '';
}

function cleanupRow(row) {
  if (!row) return;
  try {
    row.querySelectorAll('.personal-recs-card').forEach(el => {
      el.dispatchEvent(new Event('jms:cleanup'));
    });
  } catch {}
  row.innerHTML = '';
}

function renderRecommendationCards(row, items, serverId) {
  const personalCardCount = getPersonalRecsCardCount();
  clearRowWithCleanup(row);
  if (!items || !items.length) {
    row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || labels.noRecommendations || "Öneri bulunamadı"}</div>`;
    return;
  }

  const unique = items;
  const slice = unique;
  if (IS_MOBILE) {
    const mobileCards = [];
    const mobileFrag = document.createDocumentFragment();
    const limit = Math.min(slice.length, personalCardCount);

    for (let i = 0; i < limit; i++) {
      const c = createRecommendationCard(slice[i], serverId, {
        aboveFold: i < 4,
        sizeHint: "personal"
      });
      mobileCards.push(c);
      mobileFrag.appendChild(c);
    }

    row.appendChild(mobileFrag);

    try {
      const { userId } = getSessionInfo();
      scheduleResumeLabels(mobileCards, userId);
    } catch {}
    return;
  }

  const aboveFoldCount = Math.min(6, slice.length);
  const frag = document.createDocumentFragment();
  const domSeen = new Set();
  const allCards = [];
  let rendered = 0;

  for (let i = 0; i < slice.length && rendered < personalCardCount; i++) {
    const it = slice[i];
    const k = makePRCKey(it);
    if (k && domSeen.has(k)) continue;
    if (k) domSeen.add(k);
    const c = createRecommendationCard(it, serverId, {
      aboveFold: rendered < aboveFoldCount,
      sizeHint: "personal"
    });
    allCards.push(c);
    frag.appendChild(c);
    rendered++;
  }

  row.appendChild(frag);
  triggerScrollerUpdate(row);

  try {
    const { userId } = getSessionInfo();
    scheduleResumeLabels(allCards, userId);
  } catch {}
}

const LIGHT_FIELDS = [
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
  "RunTimeTicks"
].join(",");

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
  "Overview",
  "RemoteTrailers"
].join(",");

function buildPosterSrcSet(item) {
  const primaryCandidate = getPrimaryImageCandidate(item);
  if (!primaryCandidate) return "";

  const hs = [240, 360, 540, 720];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  const omitTag = shouldPreferTaglessImages(item);
  const raw = hs
    .map(h => {
      const u = buildCandidateImageUrl(item, primaryCandidate, h, q, { omitTag });
      return u ? `${u} ${Math.round(h * ar)}w` : "";
    })
    .filter(Boolean)
    .join(", ");
  return withServerSrcset(raw);
}

function clampText(s, max = 220) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 1) + "…") : t;
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

function buildPosterUrl(item, height = 540, quality = 72, { omitTag = false } = {}) {
  const candidate = getPosterLikeImageCandidate(item);
  return buildCandidateImageUrl(item, candidate, height, quality, { omitTag });
}

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

function createGenreHeroCard(item, serverId, genreName, { aboveFold = false } = {}) {
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

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg"
           alt="${escapeHtml(itemName)}"
           decoding="async"
           loading="${aboveFold ? 'eager' : 'lazy'}"
           ${aboveFold ? 'fetchpriority="high"' : ''}>
    </div>

    <div class="dir-row-hero-inner">
      <div class="dir-row-hero-meta-container">

        <div class="dir-row-hero-label">
          ${escapeHtml(genreName || "")}
        </div>

        ${logo ? `
          <div class="dir-row-hero-logo">
            <img src="${logo}"
                 alt="${escapeHtml(itemName)} logo"
                 decoding="async"
                 loading="lazy">
          </div>
        ` : ``}

        <div class="dir-row-hero-title">${escapeHtml(itemName)}</div>

        ${metaHtml ? `<div class="dir-row-hero-submeta">${metaHtml}</div>` : ""}

        ${plot ? `<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>` : ""}

      </div>
    </div>
  `;

  try {
    const img = hero.querySelector('.dir-row-hero-bg');
    if (img) {
      if (bgHQ || bgLQ) {
        hydrateBlurUp(img, {
          lqSrc: bgLQ,
          hqSrc: bgHQ,
          hqSrcset: null,
          fallback: PLACEHOLDER_URL
        });
      } else {
        img.src = PLACEHOLDER_URL;
      }
    }
  } catch {}

  const openDetails = async (e) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch {}
    const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    const originEl = hero.querySelector('.dir-row-hero-bg') || hero;
    try {
      if (!itemId) return;
      await openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex: backdropIndex,
        originEl,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (personal hero):", err);
    }
  };

  hero.addEventListener('click', openDetails);
  hero.tabIndex = 0;
  hero.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openDetails(e);
  });

  hero.classList.add('active');

  hero.addEventListener('jms:cleanup', () => {
    detachPreviewHandlers(hero);
    try {
      const img = hero.querySelector('.dir-row-hero-bg');
      if (img) unobserveImage(img);
    } catch {}
  }, { once: true });

  return hero;
}

function queueEnterAnimation(el) {
  if (!el) return el;
  el.classList.add('is-entering');
  const clear = () => {
    try { el.classList.remove('is-entering'); } catch {}
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

function createRecommendationCard(item, serverId, renderOptions = false) {
  const normalizedOptions = (typeof renderOptions === "object" && renderOptions !== null)
    ? renderOptions
    : { aboveFold: !!renderOptions };
  const {
    aboveFold = false,
    sizeHint = "personal"
  } = normalizedOptions;
  const { itemId, itemName } = primeItemIdentity(item);
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  queueEnterAnimation(card);
  if (itemId) card.dataset.itemId = itemId;
  card.setAttribute('data-key', makePRCKey(item));

  const posterUrlHQ = buildPosterUrlHQ(item);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  const posterUrlLQ = buildPosterUrlLQ(item);
  const year = item.ProductionYear || "";
  const ageChip = formatOfficialRatingLabel(item.OfficialRating || "");
  const runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  const runtime = formatRuntime(runtimeTicks);
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";
  const { label: typeLabel, icon: typeIcon } = getPrcCardTypeBadge(item.Type);
  const community = Number.isFinite(item.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${item.CommunityRating.toFixed(1)}</div>`
    : "";
  const logoUrl = buildLogoUrl(item);
  const fallbackTitleHtml = `
    <div class="prc-titleline">
      ${escapeHtml(clampText(itemName, 42))}
    </div>
  `;
  const titleBlockHtml = logoUrl
    ? `
      <div class="prc-card-logo">
        <img src="${escapeHtml(logoUrl)}"
          alt="${escapeHtml(itemName)} logo"
          loading="${aboveFold ? 'eager' : 'lazy'}"
          decoding="async"
          ${aboveFold ? 'fetchpriority="high"' : ''}>
      </div>
    `
    : fallbackTitleHtml;

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
            ${titleBlockHtml}
            <div class="prc-meta">
              ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
              ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
              ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
            </div>
            ${genres ? `<div class="prc-genres">${genres}</div>` : ""}
          </div>
        </div>
      </a>
    </div>
  `;

  const logoImg = card.querySelector('.prc-card-logo img');
  if (logoImg) {
    logoImg.addEventListener('error', () => {
      try {
        const logoWrap = logoImg.closest('.prc-card-logo');
        if (!logoWrap?.isConnected) return;
        logoWrap.outerHTML = fallbackTitleHtml;
      } catch {}
    }, { once: true });
  }

  const img = card.querySelector('.cardImage');
  try {
    const sizePreset = sizeHint === "byw"
      ? {
          mobile: '(max-width: 640px) 42vw, (max-width: 820px) 37vw, 252px',
          desktop: '(max-width: 1200px) 21vw, 252px'
        }
      : sizeHint === "genre"
        ? {
            mobile: '(max-width: 640px) 44vw, (max-width: 820px) 39vw, 276px',
            desktop: '(max-width: 1200px) 23vw, 276px'
          }
        : {
            mobile: '(max-width: 640px) 48vw, (max-width: 820px) 42vw, 300px',
            desktop: '(max-width: 1200px) 27vw, 300px'
          };
    img.setAttribute('sizes', IS_MOBILE ? sizePreset.mobile : sizePreset.desktop);
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
    noImg.style.minHeight = '100%';
    noImg.style.height = '100%';
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
        console.warn("openDetailsModal failed (personal card):", err);
      }
    }, { passive: false });
  }

  const mode = (getConfig()?.globalPreviewMode === 'studioMini') ? 'studioMini' : 'modal';
  const defer = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  defer(() => attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode));
  card.addEventListener('jms:cleanup', () => {
    unobserveImage(img);
    detachPreviewHandlers(card);
  }, { once: true });
  return card;
}

function cleanupScroller(row) {
  const s = row && row.__scroller;
  if (!s) {
    try { row.classList.remove("is-animating"); } catch {}
    try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
    try { delete row.__jmsScrollerBusyUntil; } catch {}
    try { row.dataset.scrollerMounted = "0"; } catch {}
    return;
  }

  try { s.clearAnimCleanupTimer?.(); } catch {}
  try { s.mo?.disconnect?.(); } catch {}
  try { s.ro?.disconnect?.(); } catch {}

  try { row.removeEventListener("wheel", s.onWheel); } catch {}
  try { row.removeEventListener("scroll", s.onScroll); } catch {}
  try { row.removeEventListener("scrollend", s.onScrollEnd); } catch {}
  try { row.removeEventListener("touchstart", s.onTouchStartStop); } catch {}
  try { row.removeEventListener("touchmove", s.onTouchMoveStop); } catch {}
  try { row.removeEventListener("load", s.onLoadCapture, true); } catch {}

  try { s.btnL?.removeEventListener?.("click", s.onClickL); } catch {}
  try { s.btnR?.removeEventListener?.("click", s.onClickR); } catch {}
  try { row.classList.remove("is-animating"); } catch {}
  try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
  try { delete row.__jmsScrollerBusyUntil; } catch {}

  try { delete row.__scroller; } catch { row.__scroller = null; }
  try { delete row.__ro; } catch {}
  try { row.dataset.scrollerMounted = "0"; } catch {}
}

export function setupScroller(row) {
  if (row.dataset.scrollerMounted === "1") {
    const s = row.__scroller;
    const btnOk =
      !!(s && (s.btnL?.isConnected || s.btnR?.isConnected));
    if (btnOk) {
      requestAnimationFrame(() => row.dispatchEvent(new Event("scroll")));
      return;
    }
    try { cleanupScroller(row); } catch {}
  }

  row.dataset.scrollerMounted = "1";

  const wrap = row.closest(".personal-recs-scroll-wrap") || row.parentElement;
  const btnL = wrap?.querySelector?.(".hub-scroll-left") || null;
  const btnR = wrap?.querySelector?.(".hub-scroll-right") || null;
  const canScroll = () => row.scrollWidth > row.clientWidth + 2;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const supportsNativeSmoothScroll =
    typeof row.scrollTo === "function" &&
    "scrollBehavior" in document.documentElement.style;
  const scrollIdleMs = prefersReducedMotion || !supportsNativeSmoothScroll ? 40 : SCROLLER_BUSY_IDLE_MS;
  const scrollMaxMs = prefersReducedMotion || !supportsNativeSmoothScroll ? 140 : SCROLLER_BUSY_MAX_MS;
  const stepPx = () => Math.max(240, Math.floor(row.clientWidth * 0.9));
  const SNAP_EPSILON = 2;
  const maxScrollLeft = () => Math.max(0, row.scrollWidth - row.clientWidth);

  let _rafToken = null;
  let _animCleanupTimer = 0;
  let _animHardStopTimer = 0;

  const clearAnimCleanupTimer = () => {
    if (_animCleanupTimer) {
      clearTimeout(_animCleanupTimer);
      _animCleanupTimer = 0;
    }
    if (_animHardStopTimer) {
      clearTimeout(_animHardStopTimer);
      _animHardStopTimer = 0;
    }
  };

  const endProgrammaticScroll = () => {
    clearAnimCleanupTimer();
    try { row.classList.remove("is-animating"); } catch {}
    try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
    row.__jmsScrollerBusyUntil = Date.now() + SCROLLER_BUSY_COOLDOWN_MS;
  };

  const armProgrammaticScroll = () => {
    clearAnimCleanupTimer();
    try { row.setAttribute(SCROLLER_BUSY_ATTR, "1"); } catch {}
    row.__jmsScrollerBusyUntil = Date.now() + scrollMaxMs + SCROLLER_BUSY_COOLDOWN_MS;
    _animCleanupTimer = window.setTimeout(endProgrammaticScroll, scrollIdleMs);
    _animHardStopTimer = window.setTimeout(endProgrammaticScroll, scrollMaxMs);
  };

  const updateButtonsNow = () => {
    const scrollable = canScroll();
    const max = maxScrollLeft();
    const atStart = row.scrollLeft <= SNAP_EPSILON;
    const atEnd = row.scrollLeft >= max - SNAP_EPSILON;
    if (btnL) {
      btnL.setAttribute("aria-disabled", scrollable ? "false" : "true");
      btnL.disabled = !scrollable;
      if (scrollable && atStart) {
        btnL.dataset.wrapTarget = "end";
      } else {
        delete btnL.dataset.wrapTarget;
      }
    }
    if (btnR) {
      btnR.setAttribute("aria-disabled", scrollable ? "false" : "true");
      btnR.disabled = !scrollable;
      if (scrollable && atEnd) {
        btnR.dataset.wrapTarget = "start";
      } else {
        delete btnR.dataset.wrapTarget;
      }
    }
  };

  const scheduleUpdate = () => {
    if (_rafToken) return;
    _rafToken = requestAnimationFrame(() => {
      _rafToken = null;
      updateButtonsNow();
    });
  };

  const mo = new MutationObserver(() => scheduleUpdate());
  mo.observe(row, { childList: true });

  const onLoadCapture = () => scheduleUpdate();
  row.addEventListener("load", onLoadCapture, true);

  const scrollToPosition = (left) => {
    if (!canScroll()) return;
    armProgrammaticScroll();
    const target = Math.max(0, Math.min(maxScrollLeft(), Number(left) || 0));
    if (prefersReducedMotion || !supportsNativeSmoothScroll) {
      row.scrollLeft = target;
      scheduleUpdate();
      return;
    }
    try {
      row.scrollTo({ left: target, behavior: "smooth" });
    } catch {
      row.scrollLeft = target;
    }
    scheduleUpdate();
  };

  const scrollByStep = (dir, evt) => {
    if (!canScroll()) return;
    const fast = evt?.shiftKey ? 1.35 : 1;
    const delta = stepPx() * fast * dir;
    scrollToPosition(row.scrollLeft + delta);
  };

  function doScroll(dir, evt) {
    if (!canScroll()) return;
    const max = maxScrollLeft();
    if (dir > 0 && row.scrollLeft >= max - SNAP_EPSILON) {
      scrollToPosition(0);
      return;
    }
    if (dir < 0 && row.scrollLeft <= SNAP_EPSILON) {
      scrollToPosition(max);
      return;
    }
    scrollByStep(dir, evt);
  }

  const onClickL = (e) => { e.preventDefault(); e.stopPropagation(); doScroll(-1, e); };
  const onClickR = (e) => { e.preventDefault(); e.stopPropagation(); doScroll( 1, e); };
  const blurAfterPointerClick = (btn, e) => {
    if (!btn) return;
    if ((e?.detail || 0) <= 0) return;
    requestAnimationFrame(() => { try { btn.blur(); } catch {} });
  };
  const onClickL2 = (e) => { onClickL(e); blurAfterPointerClick(btnL, e); };
  const onClickR2 = (e) => { onClickR(e); blurAfterPointerClick(btnR, e); };
  if (btnL) btnL.addEventListener("click", onClickL2);
  if (btnR) btnR.addEventListener("click", onClickR2);

  const onWheel = (e) => {
    const horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if (!horizontalIntent) return;
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    row.scrollLeft += delta;
    e.preventDefault();
    scheduleUpdate();
  };
  row.addEventListener("wheel", onWheel, { passive: false });

  const onTouchStartStop = (e) => { e.stopPropagation(); };
  const onTouchMoveStop = (e) => { e.stopPropagation(); };
  row.addEventListener("touchstart", onTouchStartStop, { passive: true });
  row.addEventListener("touchmove", onTouchMoveStop, { passive: true });

  const onScroll = () => {
    if (row.getAttribute?.(SCROLLER_BUSY_ATTR) === "1") {
      if (_animCleanupTimer) clearTimeout(_animCleanupTimer);
      _animCleanupTimer = window.setTimeout(endProgrammaticScroll, scrollIdleMs);
      row.__jmsScrollerBusyUntil = Date.now() + scrollIdleMs + SCROLLER_BUSY_COOLDOWN_MS;
    }
    scheduleUpdate();
  };
  row.addEventListener("scroll", onScroll, { passive: true });
  const onScrollEnd = () => endProgrammaticScroll();
  if ("onscrollend" in row) {
    row.addEventListener("scrollend", onScrollEnd, { passive: true });
  }

  const ro = new ResizeObserver(() => scheduleUpdate());
  ro.observe(row);
  row.__scroller = {
    btnL,
    btnR,
    onClickL: onClickL2,
    onClickR: onClickR2,
    onWheel,
    onScroll,
    onScrollEnd,
    onTouchStartStop,
    onTouchMoveStop,
    ro,
    mo,
    onLoadCapture,
    clearAnimCleanupTimer
  };
  row.addEventListener("jms:cleanup", () => {
    try { cleanupScroller(row); } catch {}
  }, { once: true });

  requestAnimationFrame(() => updateButtonsNow());
  setTimeout(() => updateButtonsNow(), 400);
}

function normalizeGenreKey(genre) {
  return String(genre || "").trim().toLowerCase();
}

function makeGenreHubsRenderKey(userId, serverId, genres) {
  return [
    String(serverId || ""),
    String(userId || ""),
    (genres || []).map(normalizeGenreKey).join("|"),
  ].join("::");
}

function hasRenderableGenreHubContent(wrap) {
  if (!wrap) return false;
  return !!wrap.querySelector(
    ".genre-hub-section .genre-row .personal-recs-card:not(.skeleton), .genre-hub-section .genre-row .no-recommendations"
  );
}

async function renderGenreHubs(indexPage) {
  try { window.__jmsGenreHubsStarted = true; } catch {}
  const homeSections = getHomeSectionsContainer(indexPage);

  let wrap = getScopedSection("genre-hubs", indexPage);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "genre-hubs";
    wrap.className = "homeSection genre-hubs-wrapper";
  }

  const parent = homeSections || getHomeSectionsContainer(indexPage) || document.body;
  placeSection(wrap, homeSections, false);

  try { ensureIntoHomeSections(wrap, indexPage); } catch {}
  enforceOrder(homeSections);

  const { userId, serverId } = getSessionInfo();
  const allGenres = await getCachedGenresWeekly(userId);
  if (!allGenres || !allGenres.length) { __signalGenreHubsDone(); return; }

  const picked = pickOrderedFirstK(allGenres, getGenreRowsCount());
  if (!picked.length) { __signalGenreHubsDone(); return; }
  const renderKey = makeGenreHubsRenderKey(userId, serverId, picked);
  const sameRender =
    wrap.dataset.genreRenderKey === renderKey &&
    GENRE_STATE.wrap === wrap &&
    Array.isArray(GENRE_STATE.sections) &&
    GENRE_STATE.sections.length === picked.length &&
    GENRE_STATE.sections.some(Boolean);

  if (sameRender && hasRenderableGenreHubContent(wrap)) {
    GENRE_STATE.wrap = wrap;
    GENRE_STATE.genres = picked;
    GENRE_STATE.serverId = serverId;
    GENRE_STATE.nextIndex = Math.max(
      Number(GENRE_STATE.nextIndex) || 0,
      Math.min(wrap.querySelectorAll(".genre-hub-section").length, picked.length)
    );

    if (GENRE_STATE.nextIndex < GENRE_STATE.genres.length) {
      attachGenreScrollIdleLoader();
    } else {
      detachGenreScrollIdleLoader();
      __signalGenreHubsDone();
    }
    return;
  }

  if (__genreHubsBusy && wrap.dataset.genreRenderKey === renderKey) {
    return;
  }

  __genreHubsBusy = true;
  try {
    __resetGenreHubsDoneSignal();
    detachGenreScrollIdleLoader();
    try { window.__jmsGenreFirstReady = false; } catch {}
    wrap.dataset.genreRenderKey = renderKey;

    if (wrap.childElementCount > 0) {
      try { abortAllGenreFetches(); } catch {}
      try {
        wrap.querySelectorAll('.personal-recs-card,.genre-row').forEach(el => {
          el.dispatchEvent(new Event('jms:cleanup'));
        });
      } catch {}
      wrap.innerHTML = '';
    }
    __globalGenreHeroLoose.clear();
    __globalGenreHeroStrict.clear();

    GENRE_STATE.wrap     = wrap;
    GENRE_STATE.genres   = picked;
    GENRE_STATE.sections = new Array(picked.length);
    GENRE_STATE.nextIndex = 0;
    GENRE_STATE.loading   = false;
    GENRE_STATE.serverId  = serverId;

    const initialLoads = Math.min(getInitialGenreLoadCount(), picked.length);
    const initialJobs = [];
    for (let i = 0; i < initialLoads; i++) initialJobs.push(ensureGenreLoaded(i));
    await Promise.allSettled(initialJobs);
    GENRE_STATE.nextIndex = initialLoads;

    __maybeSignalGenreHubsDone();

    if (GENRE_STATE.nextIndex < GENRE_STATE.genres.length) {
      attachGenreScrollIdleLoader();
    }
  } finally {
    __genreHubsBusy = false;
  }
}

function ensureGenreSectionElement(idx) {
  const genres = GENRE_STATE.genres || [];
  const wrap   = GENRE_STATE.wrap;
  const serverId = GENRE_STATE.serverId;

  if (!wrap || !genres[idx]) return null;

  let rec = GENRE_STATE.sections[idx];
  if (rec && rec.section && rec.row) return rec;

  const genre = genres[idx];

  const section = document.createElement("div");
  section.className = "homeSection genre-hub-section";
  section.dataset.genreKey = normalizeGenreKey(genre);
  section.innerHTML = `
    <div class="sectionTitleContainer sectionTitleContainer-cards">
      <h2 class="sectionTitle sectionTitle-cards gh-title">
        <span class="gh-title-text" role="button" tabindex="0"
          aria-label="${(config.languageLabels?.seeAll || 'Tümünü gör')}: ${escapeHtml(genre)}">
          ${escapeHtml(genre)}
        </span>
        <div class="gh-see-all" data-genre="${escapeHtml(genre)}"
             aria-label="${(config.languageLabels?.seeAll) || "Tümünü gör"}"
             title="${(config.languageLabels?.seeAll) || "Tümünü gör"}">
          ${faIconHtml("chevronRight")}
        </div>
        <span class="gh-see-all-tip">${(config.languageLabels?.seeAll) || "Tümünü gör"}</span>
      </h2>
    </div>
    <div class="personal-recs-scroll-wrap">
      <button class="hub-scroll-btn hub-scroll-left" aria-label="${(config.languageLabels && config.languageLabels.scrollLeft) || "Sola kaydır"}" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <div class="itemsContainer genre-row" role="list"></div>
      <button class="hub-scroll-btn hub-scroll-right" aria-label="${(config.languageLabels && config.languageLabels.scrollRight) || "Sağa kaydır"}" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      </button>
    </div>
  `;

  const scrollWrap = section.querySelector('.personal-recs-scroll-wrap');
  const heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = isPersonalRecsHeroEnabled() ? '' : 'none';
  section.insertBefore(heroHost, scrollWrap);
  const titleBtn  = section.querySelector('.gh-title-text');
  const seeAllBtn = section.querySelector('.gh-see-all');
  if (titleBtn) {
    const open = (e) => { e.preventDefault(); e.stopPropagation(); openGenreExplorer(genre); };
    titleBtn.addEventListener('click', open, { passive: false });
    titleBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openGenreExplorer(genre); }, { passive: false });
  }

  const row = section.querySelector(".genre-row");
  renderSkeletonCards(row, getGenreRowCardCount());

  const arrow = GENRE_STATE._loadMoreArrow;
  if (arrow && arrow.parentElement === wrap) {
    wrap.insertBefore(section, arrow);
  } else {
    wrap.appendChild(section);
  }

  rec = {
  genre, section, row,
  loaded: false,
  loading: false,
  loadingPromise: null,
  seq: 0,
  serverId,
  heroHost
};
  GENRE_STATE.sections[idx] = rec;
  return rec;
}

function skipGenreSection(rec) {
  if (!rec) return;
  try {
    rec.section?.querySelectorAll?.('.personal-recs-card, .dir-row-hero')?.forEach((el) => {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    if (rec.heroHost) clearHeroHost(rec.heroHost);
  } catch {}
  try { rec.section?.remove?.(); } catch {}

  rec.section = null;
  rec.row = null;
  rec.heroHost = null;
  rec.loaded = true;
  rec.loading = false;
  rec.loadingPromise = null;
}

async function ensureGenreLoaded(idx) {
  let rec = GENRE_STATE.sections[idx];
  if (!rec) rec = ensureGenreSectionElement(idx);
  if (!rec) return;

  if (rec.loaded) return;
  if (rec.loadingPromise) return rec.loadingPromise;

  rec.loading = true;
  const mySeq = ++rec.seq;

  rec.loadingPromise = (async () => {
    const { genre, row, serverId, heroHost } = rec;
    const { userId } = getSessionInfo();
    const rIC = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 650 })
    : (fn) => setTimeout(fn, 0);

  function pumpRemainder(list, startIndex) {
    let j = startIndex;

    (function pump() {
      if (rec.seq !== mySeq) return;
      if (!row || !row.isConnected) return;

      const chunk = IS_MOBILE ? 2 : 4;
      const f = document.createDocumentFragment();

      let added = 0;
      for (let k = 0; k < chunk && j < list.length; k++, j++) {
        f.appendChild(createRecommendationCard(list[j], serverId, {
          aboveFold: false,
          sizeHint: "genre"
        }));
        added++;
      }

      if (added) row.appendChild(f);
      triggerScrollerUpdate(row);

      if (j < list.length) rIC(pump);
      else {
        if (idx === 0 && !window.__jmsGenreFirstReady) {
          window.__jmsGenreFirstReady = true;
          try { document.dispatchEvent(new Event("jms:genre-first-ready")); } catch {}
        }
      }
    })();
  }

    try {
      const genreRowCardCount = getGenreRowCardCount();
      const items = await fetchItemsBySingleGenre(userId, genre, genreRowCardCount * 3, MIN_RATING);
      if (rec.seq !== mySeq) return;

      row.innerHTML = '';
      setupScroller(row);

      if (!items || !items.length) {
        skipGenreSection(rec);
        return;
      }

      const pool = dedupeStrong(items).filter(isRenderableGenreCardItem).slice();
      shuffle(pool);
      const showHero = isGenreHubsHeroEnabled();

      let best = null;
      let bestIndex = -1;
      if (showHero) {
        for (let i = 0; i < pool.length; i++) {
          const it = pool[i];
          const kLoose  = makePRCLooseKey(it);
          const kStrict = makePRCKey(it);
          if ((kLoose && __globalGenreHeroLoose.has(kLoose)) || (kStrict && __globalGenreHeroStrict.has(kStrict))) continue;
          best = it; bestIndex = i;
          if (kLoose)  __globalGenreHeroLoose.add(kLoose);
          if (kStrict) __globalGenreHeroStrict.add(kStrict);
          break;
        }
        if (!best && pool.length) {
          best = pool[0]; bestIndex = 0;
          const kLoose  = makePRCLooseKey(best);
          const kStrict = makePRCKey(best);
          if (kLoose)  __globalGenreHeroLoose.add(kLoose);
          if (kStrict) __globalGenreHeroStrict.add(kStrict);
        }
      }

      const remaining = (showHero && bestIndex >= 0)
        ? pool.filter((_, i) => i !== bestIndex)
        : pool.slice();

      if (heroHost) {
        heroHost.style.display = showHero ? '' : 'none';
        if (!showHero || !best) {
          clearHeroHost(heroHost);
        } else {
          const { hero: heroEl, changed } = mountHero(heroHost, best, serverId, genre, { aboveFold: idx === 0 });
          try {
            const backdropImg = heroEl?.querySelector?.('.dir-row-hero-bg');
            const RemoteTrailers = best.RemoteTrailers || best.RemoteTrailerItems || best.RemoteTrailerUrls || [];
            if (heroEl && (changed || !heroEl.querySelector('.intro-video-container'))) {
              createTrailerIframe({
                config,
                RemoteTrailers,
                slide: heroEl,
                backdropImg,
                itemId: best.Id,
                serverId,
                detailsUrl: getDetailsUrl(best.Id, serverId),
                detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
                showDetailsOverlay: false,
              });
            }
          } catch {}
        }
      }

      if (remaining.length < MIN_GENRE_VISIBLE_CARD_COUNT) {
        skipGenreSection(rec);
        return;
      }

      const unique = remaining.slice(0, genreRowCardCount);

      if (IS_MOBILE) {
        const mobileFrag = document.createDocumentFragment();
        for (let i = 0; i < unique.length; i++) {
          mobileFrag.appendChild(createRecommendationCard(unique[i], serverId, {
            aboveFold: i < Math.min(6, unique.length),
            sizeHint: "genre"
          }));
        }
        row.appendChild(mobileFrag);
        triggerScrollerUpdate(row);

        if (rec.seq === mySeq) rec.loaded = true;
        if (idx === 0 && !window.__jmsGenreFirstReady) {
          window.__jmsGenreFirstReady = true;
          try { document.dispatchEvent(new Event("jms:genre-first-ready")); } catch {}
        }
        return;
      }

      const head = Math.min(unique.length, genreRowCardCount);

      const f1 = document.createDocumentFragment();
      for (let i = 0; i < head; i++) {
        f1.appendChild(createRecommendationCard(unique[i], serverId, {
          aboveFold: i < Math.min(6, head),
          sizeHint: "genre"
        }));
      }
      row.appendChild(f1);
      triggerScrollerUpdate(row);

      if (rec.seq === mySeq) rec.loaded = true;
      if (idx === 0 && !window.__jmsGenreFirstReady) {
        window.__jmsGenreFirstReady = true;
        try { document.dispatchEvent(new Event("jms:genre-first-ready")); } catch {}
      }

      pumpRemainder(unique, head);

    } catch (err) {
      if (rec.seq !== mySeq) return;
      console.warn('Genre hub load failed:', rec?.genre, err);
      skipGenreSection(rec);
    } finally {
      if (rec.seq === mySeq) {
        rec.loading = false;
        rec.loadingPromise = null;
      }
    }
  })();

  return rec.loadingPromise;
}

function triggerScrollerUpdate(row) {
  if (!row) return;
  try { row.dispatchEvent(new Event('scroll')); } catch {}
  if (row.__tsuRaf) return;
  row.__tsuRaf = requestAnimationFrame(() => {
    row.__tsuRaf = 0;
    try { row.dispatchEvent(new Event('scroll')); } catch {}
  });
}

async function fetchItemsBySingleGenre(userId, genre, limit = 30, minRating = 0) {
  const genreRenderableMin = getGenreRenderableMin();
  try {
    const { serverId } = getSessionInfo();
    const st = await ensurePrcDb(userId, serverId);
    const cfg = __prcCfg();
    const scope = st?.scope || makeScope({ userId, serverId });
    const memKey = `${scope}|${normalizeGenreKey(genre)}`;
    const mem = __genreCache.get(memKey);
    if (mem?.ts && Array.isArray(mem?.items) && (Date.now() - mem.ts) <= cfg.genreTtlMs) {
      const pickedFromMem = filterAndTrimByRating(mem.items, minRating, limit);
      if (pickedFromMem.length >= Math.min(limit, genreRenderableMin)) {
        return pickedFromMem.slice(0, limit);
      }
    }

    if (st?.db && st?.scope) {
      const key = __metaKeyGenre(st.scope, genre);
      const cache = await getMeta(st.db, key);
      const ts = Number(cache?.ts || 0);
      const ids = Array.isArray(cache?.ids) ? cache.ids : [];
      const fresh = ts && (Date.now() - ts) <= cfg.genreTtlMs;
      if (fresh && ids.length) {
        const aliveIds = await filterOutPlayedIds(userId, ids);
        const itemsFromDb = await dbGetItemsByIds(st.db, st.scope, aliveIds);
        if (itemsFromDb.length) {
          __genreCache.set(memKey, { ts: Date.now(), items: itemsFromDb.slice() });
        }
        const picked = filterAndTrimByRating(itemsFromDb, minRating, limit);
        if (picked.length >= Math.min(limit, genreRenderableMin)) {
          return picked.slice(0, limit);
        }
      }
    }
  } catch {}
  const fields = COMMON_FIELDS;
  const g = encodeURIComponent(genre);
  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&` +
    `Genres=${g}&Fields=${fields}&` +
    `SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=${Math.max(60, limit * 3)}`;

  const ctrl = new AbortController();
  __genreFetchCtrls.add(ctrl);
  try {
    const data = await makeApiRequest(url, { signal: ctrl.signal });
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const picked = filterAndTrimByRating(items, minRating, limit);

    try {
      const { serverId } = getSessionInfo();
      const st = await ensurePrcDb(userId, serverId);
      const cfg = __prcCfg();
      const scope = st?.scope || makeScope({ userId, serverId });
      const memKey = `${scope}|${normalizeGenreKey(genre)}`;
      if (items.length) {
        __genreCache.set(memKey, { ts: Date.now(), items: items.slice() });
      }
      if (st?.db && st?.scope && items.length) {
        await dbWriteThroughItems(st.db, st.scope, items);
        const ids = items.map(x => x?.Id).filter(Boolean).slice(0, cfg.maxCacheIds);
        await setMeta(st.db, __metaKeyGenre(st.scope, genre), { ids, ts: Date.now() });
      }
    } catch {}

    return picked;
  } catch (e) {
    if (e?.name !== 'AbortError') console.error("fetchItemsBySingleGenre hata:", e);
    return [];
  } finally {
    __genreFetchCtrls.delete(ctrl);
  }
}

const __genreFetchCtrls = new Set();
function abortAllGenreFetches(){
  for (const c of __genreFetchCtrls) { try { c.abort(); } catch {} }
  __genreFetchCtrls.clear();
}

function pickOrderedFirstK(allGenres, k) {
  const order = Array.isArray(config.genreHubsOrder) && config.genreHubsOrder.length
    ? config.genreHubsOrder
    : allGenres;
  const setAvail = new Set(allGenres.map(g => String(g).toLowerCase()));
  const picked = [];
  for (const g of order) {
    if (!g) continue;
    if (setAvail.has(String(g).toLowerCase())) {
      picked.push(g);
      if (picked.length >= k) break;
    }
  }
  if (picked.length < k) {
    for (const g of allGenres) {
      if (picked.includes(g)) continue;
      picked.push(g);
      if (picked.length >= k) break;
    }
  }
  return picked;
}

function shuffleCrypto(arr) {
  if (!Array.isArray(arr)) return arr;
  const a = arr;
  const rnd = new Uint32Array(1);

  for (let i = a.length - 1; i > 0; i--) {
    let j;
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(rnd);
      j = rnd[0] % (i + 1);
    } else {
      j = (Math.random() * (i + 1)) | 0;
    }
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function getCachedGenresWeekly(userId) {
  const weekKey = __isoWeekKey();

  try {
    const { serverId } = getSessionInfo();
    const st = await ensurePrcDb(userId, serverId);
    const scope = st?.scope || makeScope({ userId, serverId });

    if (st?.db && scope) {
      const cache = await getMeta(st.db, __metaKeyGenresList(scope));
      const cachedWeek = String(cache?.weekKey || "");
      const cachedList = Array.isArray(cache?.genres) ? cache.genres : [];
      if (cachedWeek === weekKey && cachedList.length) {
        return cachedList;
      }
    }

    const lsKey = `prc:genresListLS:${scope}`;
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const obj = JSON.parse(raw);
        const cachedWeek = String(obj?.weekKey || "");
        const cachedList = Array.isArray(obj?.genres) ? obj.genres : [];
        if (cachedWeek === weekKey && cachedList.length) {
          return cachedList;
        }
      }
    } catch {}

    const list = await fetchAllGenres(userId);
    const genres = uniqueNormalizedGenres(list).slice(0, 400);
    const payload = { weekKey, genres, ts: Date.now() };

    if (st?.db && scope) {
      try { await setMeta(st.db, __metaKeyGenresList(scope), payload); } catch {}
    }
    try { localStorage.setItem(lsKey, JSON.stringify(payload)); } catch {}

    return genres;
  } catch (e) {
    console.warn("Weekly genre cache failed, falling back to live fetch:", e);
    try {
      const list = await fetchAllGenres(userId);
      return uniqueNormalizedGenres(list);
    } catch {
      return [];
    }
  }
}

async function fetchAllGenres(userId) {
  const url =
    `/Items/Filters?UserId=${encodeURIComponent(userId)}` +
    `&IncludeItemTypes=Movie,Series&Recursive=true`;

  const r = await makeApiRequest(url);
  const genres = Array.isArray(r?.Genres) ? r.Genres : [];
  return genres.map(g => String(g || "").trim()).filter(Boolean);
}

function uniqueNormalizedGenres(list) {
  const seen = new Set();
  const out = [];
  for (const g of list) {
    const k = g.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
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

const CACHE_ITEM_FIELDS = [
  "Id","Name","Type","ImageTags","PrimaryImageTag",
  "CommunityRating","OfficialRating","ProductionYear","RunTimeTicks","CumulativeRunTimeTicks",
  "Genres",
  "RemoteTrailers"
];

function toSlimItem(it){
  if (!it) return null;
  const slim = {};
  for (const k of CACHE_ITEM_FIELDS) slim[k] = it[k];
  if (!slim.Type) {
    if (it?.Type) {
      slim.Type = it.Type;
    } else if (it?.Series || it?.SeriesId || it?.SeriesName) {
      slim.Type = "Series";
    } else {
      slim.Type = "Movie";
    }
  }
  if (!slim.Name) {
    slim.Name = it?.SeriesName || it?.Name || "";
    if (!slim.ProductionYear && it?.PremiereDate) {
  const y = new Date(it.PremiereDate).getUTCFullYear();
  if (y) slim.ProductionYear = y;
}
  }
  return slim;
}
function toSlimList(list){ return (list||[]).map(toSlimItem).filter(Boolean); }

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
      try { document.dispatchEvent(new Event('closeAllMiniPopovers')); } catch {}

      const token = (Date.now() ^ Math.random()*1e9) | 0;
      __openTokenMap.set(cardEl, token);

      try { hardWipeHoverModalDom(); } catch {}
      safeOpenHoverModal(itemId, cardEl);

      if (isTouch) {
        __touchStickyOpen = true;
        __touchLastOpenTS = Date.now();
      }
      if (!isTouch) schedulePostOpenGuard(cardEl, token, 340);
    }, OPEN_HOVER_DELAY_MS);

    __enterTimers.set(cardEl, timer);
  };

  const onLeave = (e) => {
    const isTouch = e?.pointerType === 'touch';
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);
    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) {
        return;
      } else {
        __touchStickyOpen = false;
      }
    }

    const rt = e?.relatedTarget || null;
    const goingToModal = !!(rt && (rt.closest ? rt.closest('.video-preview-modal') : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 6, 90);
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
  cardEl.removeEventListener('pointerenter', rec.onEnter);
  cardEl.removeEventListener('pointerleave', rec.onLeave);
  if (rec.onDown) cardEl.removeEventListener('pointerdown', rec.onDown);
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

window.addEventListener('jms:globalPreviewModeChanged', (ev) => {
  const mode = ev?.detail?.mode === 'studioMini' ? 'studioMini' : 'modal';
  document.querySelectorAll('.personal-recs-card').forEach(cardEl => {
    const itemId = cardEl?.dataset?.itemId;
    if (!itemId) return;
    const itemLike = {
   Id: itemId,
   Name: cardEl.querySelector('.cardImage')?.alt || ''
 };
    attachPreviewByMode(cardEl, itemLike, mode);
  });
}, { passive: true });

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

export function resetPersonalRecsAndGenreState() {
  prcLog("cleanup:start", {
    genreSections: GENRE_STATE.sections?.length || 0,
  });
  clearPersonalRecsRetry();
  try { detachGenreScrollIdleLoader(); } catch {}
  try { abortAllGenreFetches(); } catch {}

  __deferredHomeSectionSeq += 1;
  __bywDeferredPromise = null;
  __genreDeferredPromise = null;
  __personalRecsInitDone = false;
  __personalRecsBusy = false;
  setPersonalRecsDone(false);
  setBywDone(false);

  GENRE_STATE.genres = [];
  GENRE_STATE.sections = [];
  GENRE_STATE.nextIndex = 0;
  GENRE_STATE.loading = false;
  GENRE_STATE.wrap = null;
  GENRE_STATE.serverId = null;

  try { __globalGenreHeroLoose.clear(); } catch {}
  try { __globalGenreHeroStrict.clear(); } catch {}
  try { window.__jmsGenreFirstReady = false; } catch {}
  __genreHubsBusy = false;
  try { detachGenreScrollIdleLoader(); } catch {}
  try {
    const bywSections = Array.from(document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched'));
    for (const sec of bywSections) {
      if (!sec) continue;
      try {
        sec.querySelectorAll('.personal-recs-card').forEach(el => {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        sec.querySelectorAll('.dir-row-hero').forEach(el => {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        const row = sec.querySelector('.byw-row');
        if (row) {
          row.dispatchEvent(new Event('jms:cleanup'));
        }
      } catch {}
    }
  } catch {}

  try {
    const sections = Array.from(new Set([
      document.getElementById("personal-recommendations"),
      document.getElementById("genre-hubs"),
      ...Array.from(document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched'))
    ].filter(Boolean)));

    for (const section of sections) {
      try {
        section.querySelectorAll('.personal-recs-card, .dir-row-hero').forEach(el => {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        section.querySelectorAll('.personal-recs-row, .genre-row, .byw-row').forEach(row => {
          try { row.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try { section.remove(); } catch {}
    }
  } catch {}

  try { __resetGenreHubsDoneSignal(); } catch {}
}

export function releasePrcDbConnection() {
  try { PRC_DB_STATE.db?.close?.(); } catch {}
  PRC_DB_STATE.db = null;
  PRC_DB_STATE.scope = null;
  PRC_DB_STATE.userId = null;
  PRC_DB_STATE.serverId = null;
  PRC_DB_STATE.failed = false;

  try { PRC_SESSION_PERSONAL_CACHE.clear(); } catch {}
  try { PRC_SESSION_BYW_SEEDS_CACHE.clear(); } catch {}
  try { PRC_SESSION_BYW_ITEMS_CACHE.clear(); } catch {}
}

(function bindPrcDbReleaseOnce() {
  if (window.__jmsPrcDbReleaseBound) return;
  window.__jmsPrcDbReleaseBound = true;

  window.addEventListener('jms:indexeddb:release', (event) => {
    const dbName = event?.detail?.dbName;
    if (!dbName || dbName === 'jms_prc_db' || dbName === '*') {
      releasePrcDbConnection();
    }
  });
})();

let __homeScrollerRefreshTimer = null;

function refreshHomeScrollers() {
  const page = currentIndexPage();
  if (!page) return;
  page.querySelectorAll(".personal-recs-row, .genre-row").forEach(row => {
    try { setupScroller(row); } catch {}
    try { triggerScrollerUpdate(row); } catch {}
  });
}

function scheduleHomeScrollerRefresh(ms = 120) {
  clearTimeout(__homeScrollerRefreshTimer);
  __homeScrollerRefreshTimer = setTimeout(() => {
    __homeScrollerRefreshTimer = null;
    refreshHomeScrollers();
  }, ms);
}

(function bindHomeScrollerRefreshOnce(){
  if (window.__jmsHomeScrollerRefreshBound) return;
  window.__jmsHomeScrollerRefreshBound = true;

  window.addEventListener("hashchange", () => scheduleHomeScrollerRefresh(180), { passive: true });
  window.addEventListener("pageshow",   () => scheduleHomeScrollerRefresh(0),   { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleHomeScrollerRefresh(0);
  });

  document.addEventListener("viewshow",  () => scheduleHomeScrollerRefresh(0));
  document.addEventListener("viewshown", () => scheduleHomeScrollerRefresh(0));
})();

function __forceRetryAllBroken() {
  document.querySelectorAll('img.cardImage, img.dir-row-hero-bg').forEach(img => {
    if (!img?.__data || !img.isConnected) return;
    if (img.__disableRecovery === true || hasKnownMissingImage(img.__data)) return;
    const retryAt = Number(img.__retryAfter || 0);
    const retryDue = retryAt > 0 && retryAt <= Date.now();

    const shouldRetry =
      (img.__allowLqHydrate === true && (retryAt === 0 || retryDue)) ||
      (img.__hiFailed === true && (retryAt === 0 || retryDue)) ||
      img.__hydrated === false ||
      retryDue ||
      (img.complete && img.naturalWidth === 0);

    if (!shouldRetry) return;

    const { lqSrc, hqSrc, hqSrcset, fallback } = img.__data;
    try {
      hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback });
    } catch {}
  });
}

window.addEventListener('online', __forceRetryAllBroken);
window.addEventListener('focus', __forceRetryAllBroken, { passive: true });
window.addEventListener('pageshow', __forceRetryAllBroken, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) __forceRetryAllBroken();
});

if (!window.__prcImageRecoveryTimer) {
  window.__prcImageRecoveryTimer = true;
}
