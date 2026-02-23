import { getSessionInfo, makeApiRequest, getCachedUserTopGenres, playNow } from "./api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openGenreExplorer, openPersonalExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, ensureJmsDetailsOverlay } from "./utils.js";
import { openDetailsModal } from "./detailsModal.js";
import { withServer, withServerSrcset } from "./jfUrl.js";
import {
  openPrcDB,
  makeScope,
  putItems,
  getMeta,
  setMeta,
  purgePrcDb
} from "./prcDb.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
const PERSONAL_RECS_LIMIT = Number.isFinite(config.personalRecsCardCount)
  ? Math.max(1, config.personalRecsCardCount | 0)
  : 3;
const EFFECTIVE_CARD_COUNT = PERSONAL_RECS_LIMIT;
const MIN_RATING = Number.isFinite(config.studioHubsMinRating)
  ? Math.max(0, Number(config.studioHubsMinRating))
  : 0;
const PLACEHOLDER_URL = (config.placeholderImage) || './slider/src/images/placeholder.png';
const ENABLE_GENRE_HUBS = !!config.enableGenreHubs;
const GENRE_ROWS_COUNT = Number.isFinite(config.studioHubsGenreRowsCount)
  ? Math.max(1, config.studioHubsGenreRowsCount | 0)
  : 4;
const GENRE_ROW_CARD_COUNT = Number.isFinite(config.studioHubsGenreCardCount)
  ? Math.max(1, config.studioHubsGenreCardCount | 0)
  : 10;
const EFFECTIVE_GENRE_ROWS = Number.isFinite(config.studioHubsGenreRowsCount)
  ? GENRE_ROWS_COUNT
  : 50;
const EFFECTIVE_GENRE_ROW_CARD_COUNT = GENRE_ROW_CARD_COUNT;
const __hoverIntent = new WeakMap();
const __enterTimers = new WeakMap();
const __enterSeq     = new WeakMap();
const __cooldownUntil= new WeakMap();
const __openTokenMap = new WeakMap();
const __boundPreview = new WeakMap();
const GENRE_LAZY = true;
const GENRE_BATCH_SIZE = Number(getConfig()?.genreRowsBatchSize) || (IS_MOBILE ? 1 : 1);
const GENRE_ROOT_MARGIN = '500px 0px';
const GENRE_FIRST_SCROLL_PX = Number(getConfig()?.genreRowsFirstBatchScrollPx) || 200;
const PRC_LOCK_DOWN_SCROLL = (getConfig()?.prcLockDownScrollDuringLoad === true);

const ENABLE_BYW = (getConfig()?.enableBecauseYouWatched !== false);
const BYW_CARD_COUNT = Number.isFinite(getConfig()?.becauseYouWatchedCardCount)
  ? Math.max(1, getConfig()?.becauseYouWatchedCardCount | 0)
  : EFFECTIVE_CARD_COUNT;

const BYW_ROW_COUNT = Number.isFinite(getConfig()?.becauseYouWatchedRowCount)
  ? Math.max(1, getConfig()?.becauseYouWatchedRowCount | 0)
  : 1;

const PRC_DB_STATE = {
  db: null,
  scope: null,
  userId: null,
  serverId: null,
  failed: false,
};

function __appendCb(url, cb) {
  if (!url) return url;
  const u = String(url);
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}cb=${encodeURIComponent(String(cb))}`;
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
  const clean = (ids || []).filter(Boolean);
  if (!cfg.validateUserData || !clean.length) return clean;

  const played = new Set();
  const CHUNK = 60;
  const PAR = 2;

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
              const items = Array.isArray(r?.Items) ? r.Items : (Array.isArray(r) ? r : []);
              for (const it of items) {
                if (it?.Id && it?.UserData?.Played === true) played.add(it.Id);
              }
            })
            .catch(() => {})
        );
      }
      await Promise.all(ps);
    }
    return clean.filter(id => !played.has(id));
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
    arrow.innerHTML = `<span class="material-icons">expand_more</span>`;
    arrow.removeAttribute('aria-busy');
  }
}

let __genreScrollIdleTimer = null;
let __genreScrollIdleAttached = false;
let __genreArrowObserver = null;
let __genreScrollHandler = null;
let __personalRecsInitDone = false;

export function lockDownScroll() {
  if (!PRC_LOCK_DOWN_SCROLL) return;
  try { document.documentElement.dataset.jmsSoftBlock = "1"; } catch {}
}

export function unlockDownScroll() {
  try { delete document.documentElement.dataset.jmsSoftBlock; } catch {}
}

function attachGenreScrollIdleLoader() {
  if (__genreScrollIdleAttached) return;
  __genreScrollIdleAttached = true;

  if (!GENRE_STATE.wrap || !GENRE_STATE.genres || !GENRE_STATE.genres.length) return;
  if (GENRE_STATE.nextIndex >= GENRE_STATE.genres.length) return;

  if (!GENRE_STATE._loadMoreArrow) {
    const arrow = document.createElement('button');
    arrow.className = 'genre-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = `<span class="material-icons">expand_more</span>`;
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

  const onScroll = () => {
  if (!GENRE_STATE.wrap) return;

  const rect = GENRE_STATE.wrap.getBoundingClientRect();
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;

  if (rect.bottom - viewportH <= GENRE_FIRST_SCROLL_PX) {
    if (__genreScrollIdleTimer) return;
    __genreScrollIdleTimer = setTimeout(() => {
      __genreScrollIdleTimer = null;

      if (GENRE_STATE.nextIndex >= GENRE_STATE.sections.length) {
        detachGenreScrollIdleLoader();
        return;
      }

      loadNextGenreViaArrow();

      if (GENRE_STATE.nextIndex >= GENRE_STATE.sections.length) {
        detachGenreScrollIdleLoader();
      }
    }, 220);
  }
};

  __genreScrollHandler = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  requestAnimationFrame(onScroll);
  setGenreArrowLoading(!!GENRE_STATE.loading);
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
      const icon = btn.querySelector('.material-icons');
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

function __shouldRequestHiRes() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c?.saveData) return false;
    const et = String(c?.effectiveType || "");
    if (/^2g$|slow-2g/i.test(et)) return false;
  } catch {}
  return true;
}

function mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold=false } = {}) {
  if (!heroHost || !heroItem?.Id) return;

  const existing = heroHost.querySelector('.dir-row-hero');
  const same = existing && (existing.dataset.itemId === String(heroItem.Id));

  if (same) {
    const lbl = existing.querySelector('.dir-row-hero-label');
    if (lbl && heroLabel) lbl.textContent = heroLabel;
    return;
  }

  if (existing) {
    existing.classList.add('is-leaving');
    setTimeout(() => { try { existing.remove(); } catch {} }, 180);
  }

  const hero = createGenreHeroCard(heroItem, serverId, heroLabel, { aboveFold });
  hero.classList.add('is-entering');
  heroHost.appendChild(hero);
  requestAnimationFrame(() => hero.classList.remove('is-entering'));
}

const __imgIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    const img = ent.target;
    const data = img.__data || {};
    if (ent.isIntersecting) {
        if (!__shouldRequestHiRes()) continue;

        const now = Date.now();
        const retryAfter = Number(img.__retryAfter || 0);
        const canRetry = !retryAfter || now >= retryAfter;

        if (img.__hiFailed && !canRetry) continue;

        if (!img.__hiRequested || (img.__hiFailed && canRetry)) {
          img.__hiRequested = true;
          img.__hiFailed = false;
          img.__phase = 'hi';

          const data = img.__data || {};
          const token = (img.__retryToken = (Number(img.__retryToken || 0) + 1));
          const hqSrc = data.hqSrc
            ? (img.__hiFailed ? __appendCb(data.hqSrc, `${now}-${token}`) : data.hqSrc)
            : null;
          const hqSrcset = data.hqSrcset
            ? data.hqSrcset.split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(part => {
                  const m = part.match(/^(\S+)\s+(.*)$/);
                  if (!m) return part;
                  const u = img.__hiFailed ? __appendCb(m[1], `${now}-${token}`) : m[1];
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
            img.__hiFailed = true;
            img.__hiRequested = false;
            img.__phase = 'lq';
            img.__retryAfter = Date.now() + 12_000;
            try { __imgIO.unobserve(img); } catch {}
            try { __imgIO.observe(img); } catch {}
          });
        }
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
   const tp = it?.Type === "Series" ? "series" : "movie";
   return `${tp}::${nm}|${yr}`;
 }

function makePRCLooseKey(it) {
  const nm = String(it?.Name || "")
    .normalize?.('NFKD')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();

  const tp = it?.Type === "Series" ? "series" : "movie";
  return `${tp}::${nm}`;
}

(function injectPerfCssOnce(){
  if (document.getElementById('prc-perf-css')) return;
  const st = document.createElement('style');
  st.id = 'prc-perf-css';
  st.textContent = `
    .personal-recs-row, .genre-row {
      content-visibility: auto;
      contain-intrinsic-size: 260px 1200px;
      contain: layout paint style;
    }
    .dir-row-hero-host { min-height: 260px; }

    .dir-row-hero {
      transition: opacity .18s ease, transform .18s ease;
      will-change: opacity, transform;
    }
    .dir-row-hero.is-entering { opacity: 0; transform: translateY(2px); }
    .dir-row-hero.is-leaving  { opacity: 0; }

    .personal-recs-card .cardImage {
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      display: block;
    }

    .personal-recs-card .cardImage.is-lqip {
      filter: blur(10px);
      transform: translateZ(0);
      transition: filter .25s ease;
    }
    .personal-recs-card .cardImage.__hydrated {
      filter: none;
    }

    .personal-recs-card { contain: paint; }
    @media (max-width: 820px) {
      .personal-recs-card .cardImage { aspect-ratio: 2/3; }
    }
    .personal-recs-card .prc-top-badges,
    .personal-recs-card .prc-overlay {
      will-change: transform;
      transform: translateZ(0);
      backface-visibility: hidden;
    }
  `;
  document.head.appendChild(st);
})();

function buildPosterUrlLQ(item) {
  return buildPosterUrl(item, 120, 25);
}

function buildPosterUrlHQ(item) {
  return buildPosterUrl(item, 540, 72);
}

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  const tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!tag) return null;

  const url = `/Items/${item.Id}/Images/Logo` +
         `?tag=${encodeURIComponent(tag)}` +
         `&maxWidth=${width}` +
         `&quality=${quality}` +
         `&EnableImageEnhancers=false`;
        return withServer(url);
    }

function buildBackdropUrl(item, width = "auto", quality = 90) {
  if (!item) return null;

  const tag =
    (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item.BackdropImageTag ||
    (item.ImageTags && item.ImageTags.Backdrop);

  if (!tag) return null;

  const url = `/Items/${item.Id}/Images/Backdrop` +
          `?tag=${encodeURIComponent(tag)}` +
          `&maxWidth=${width}` +
          `&quality=${quality}` +
          `&EnableImageEnhancers=false`;
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
  return (
    indexPage.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    indexPage
  );
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  const apply = () => {
    const container =
      (indexPage && indexPage.querySelector(".homeSectionsContainer")) ||
      document.querySelector(".homeSectionsContainer");
    if (!container) return false;

    const ref = placeAfterId ? document.getElementById(placeAfterId) : null;
    if (ref && ref.parentElement === container) {
      ref.insertAdjacentElement('afterend', el);
    } else if (el.parentElement !== container) {
      container.appendChild(el);
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

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    ref.insertAdjacentElement('afterend', node);
  } else {
    parent.appendChild(node);
  }
}

function enforceOrder(homeSectionsHint) {
  const cfg = getConfig();
  const studio = document.getElementById('studio-hubs');
  const recs  = document.getElementById('personal-recommendations');
  const genre = document.getElementById('genre-hubs');
  const parent = (studio && studio.parentElement) || homeSectionsHint || getHomeSectionsContainer(currentIndexPage());
  if (!parent) return;

  if (cfg.placePersonalRecsUnderStudioHubs && studio && recs) {
    insertAfter(parent, recs, studio);
  }

  const bywSections = Array.from(parent.querySelectorAll('[id^="because-you-watched--"]'))
    .filter(el => el && el.parentElement === parent)
    .sort((a,b) => (Number(a.id.split('--')[1]) || 0) - (Number(b.id.split('--')[1]) || 0));

  if (bywSections.length) {
    if (genre && genre.parentElement === parent) {
      let ref = genre;
      for (let i = bywSections.length - 1; i >= 0; i--) {
        const sec = bywSections[i];
        try { parent.insertBefore(sec, ref); } catch {}
        ref = sec;
      }
    } else {
      const anchor =
        (cfg.enablePersonalRecommendations && recs && recs.parentElement === parent) ? recs :
        (studio && studio.parentElement === parent) ? studio :
        null;
      if (anchor) {
        let ref = anchor;
        for (const sec of bywSections) {
          insertAfter(parent, sec, ref);
          ref = sec;
        }
      }
    }
  }

  if (cfg.placeGenreHubsUnderStudioHubs && studio && genre) {
  const recent = document.getElementById("recent-rows");
  const wantUnderRecent = !!(recent && recent.parentElement === parent);
  const wantUnderPersonal =
    !wantUnderRecent &&
    !!(cfg.enablePersonalRecommendations && recs && recs.parentElement === parent);

    if (wantUnderRecent)  { insertAfter(parent, genre, recent); return; }
    if (wantUnderPersonal){ insertAfter(parent, genre, recs);   return; }
    if (studio && studio.parentElement === parent) {
      insertAfter(parent, genre, studio);
      return;
    }
    if (genre.parentElement !== parent) parent.appendChild(genre);
  }
}

function placeSection(sectionEl, homeSections, underStudio) {
  if (!sectionEl) return;
  const studio = document.getElementById('studio-hubs');
  const targetParent = (studio && studio.parentElement) || homeSections || getHomeSectionsContainer(currentIndexPage());
  const placeNow = () => {
    if (underStudio && studio && targetParent) {
      insertAfter(targetParent, sectionEl, studio);
    } else {
      (targetParent || document.body).appendChild(sectionEl);
    }
    enforceOrder(targetParent);
  };

  placeNow();
  try { ensureIntoHomeSections(sectionEl, currentIndexPage()); } catch {}
  if (underStudio && !studio) {
    let mo = null;
    let tries = 0;
    const maxTries = 50;
    const stop = () => { try { mo.disconnect(); } catch {} mo = null; };

    mo = new MutationObserver(() => {
      tries++;
      const s = document.getElementById('studio-hubs');
      if (s && s.parentElement) {
        const newParent = s.parentElement;
        insertAfter(newParent, sectionEl, s);
        enforceOrder(newParent);
        stop();
      } else if (tries >= maxTries) {
        stop();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      const s = document.getElementById('studio-hubs');
      if (s && s.parentElement) {
        insertAfter(s.parentElement, sectionEl, s);
        enforceOrder(s.parentElement);
        stop();
      }
    }, 3000);
  }
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;
  const wantsHi = __shouldRequestHiRes() && (hqSrc || hqSrcset);

  try { __imgIO.unobserve(img); } catch {}
  try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
  try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}

  img.__data = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;
  img.__hiFailed = false;

  try { img.removeAttribute('srcset'); } catch {}
  try { img.classList.remove('__hydrated'); } catch {}
  if (lqSrc) {
    if (img.src !== lqSrc) img.src = lqSrc;
  } else {
    img.src = fb;
  }
  img.classList.add('is-lqip');
  img.__hydrated = false;

  const onError = () => {
    if (img.__phase === 'hi') {
      img.__hiFailed = true;
      img.__hiRequested = false;
      img.__retryAfter = Date.now() + 12_000;

      try { img.removeAttribute('srcset'); } catch {}
      try { img.classList.remove('__hydrated'); } catch {}

      if (lqSrc) {
        const lq = __appendCb(lqSrc, `lq-${Date.now()}`);
        if (img.src !== lq) img.src = lq;
      } else {
        img.src = fb;
      }

      img.classList.add('is-lqip');
      img.__phase = 'lq';

      try { __imgIO.unobserve(img); } catch {}
      try { __imgIO.observe(img); } catch {}
    } else {
      try { img.src = fb; } catch {}
    }
  };

  const onLoad = () => {
    if (img.__phase === 'hi' || !wantsHi) {
      img.classList.add('__hydrated');
      img.classList.remove('is-lqip');
      img.__hydrated = true;
      try { __imgIO.unobserve(img); } catch {}
      try { img.removeEventListener('error', onError); } catch {}
      try { img.removeEventListener('load',  onLoad); } catch {}
      delete img.__onErr;
      delete img.__onLoad;
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
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr;
  delete img.__onLoad;
  delete img.__hiFailed;
  delete img.__hiRequested;
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

function pageReady() {
  try {
    const page = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
    if (!page) return false;
    const hasSections = !!(page.querySelector(".homeSectionsContainer") || document.querySelector(".homeSectionsContainer"));
    return !!page && (hasSections || true);
  } catch { return false; }
}

let __recsRetryTimer = null;
function scheduleRecsRetry(ms = 600) {
  clearTimeout(__recsRetryTimer);
  __recsRetryTimer = setTimeout(() => {
    __recsRetryTimer = null;
    renderPersonalRecommendations();
  }, ms);
}

export async function renderPersonalRecommendations() {
  if (!config.enablePersonalRecommendations && !ENABLE_GENRE_HUBS) return;

  if (__personalRecsInitDone) {
  const personalOk = !!document.querySelector("#personal-recommendations .personal-recs-card:not(.skeleton)");
  const genreOk = !ENABLE_GENRE_HUBS || !!document.querySelector("#genre-hubs .genre-hub-section");
  if (personalOk && genreOk) {
    scheduleHomeScrollerRefresh(0);
    return;
  }
}
  __personalRecsInitDone = true;

  if (__personalRecsBusy) return;
  if (!pageReady()) {
    scheduleRecsRetry(700);
    return;
  }
  __personalRecsBusy = true;

  try {
    lockDownScroll();
    try {
      const { userId, serverId } = getSessionInfo();
      await ensurePrcDb(userId, serverId);
    } catch {}
    const indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) return;

    const tasks = [];

    if (config.enablePersonalRecommendations) {
      const section = ensurePersonalRecsContainer(indexPage);
      const row = section?.querySelector?.(".personal-recs-row") || null;
      if (row) {
        if (!row.dataset.mounted || row.childElementCount === 0) {
          row.dataset.mounted = "1";
          renderSkeletonCards(row, EFFECTIVE_CARD_COUNT);
          setupScroller(row);
        }

        tasks.push((async () => {
          try {
            const { userId, serverId } = getSessionInfo();
            const recommendations = await fetchPersonalRecommendations(userId, EFFECTIVE_CARD_COUNT, MIN_RATING);
            renderRecommendationCards(row, recommendations, serverId);
            schedulePrunePlayedAfterPaint(row, userId, 360);
          } catch (e) {
            console.error("Kişisel öneriler alınırken hata:", e);
          }
        })());
      }
    }

    if (ENABLE_BYW) {
      tasks.push((async () => {
        try { await renderBecauseYouWatchedAuto(indexPage); }
        catch (e) { console.warn("BYW render failed:", e); }
      })());
    }

    if (ENABLE_GENRE_HUBS) {
      tasks.push((async () => {
        try { await renderGenreHubs(indexPage); }
        catch (e) {
          console.error("Genre hubs render hatası:", e);
          try { __signalGenreHubsDone(); } catch {}
        }
      })());
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }

    try {
      const hsc = getHomeSectionsContainer(indexPage);
      enforceOrder(hsc);
    } catch {}

  } catch (error) {
    console.error("Kişisel öneriler / tür hub render hatası:", error);
  } finally {
    unlockDownScroll();
    __personalRecsBusy = false;
  }
}

function ensureBecauseContainer(indexPage, key = "0") {
  const homeSections = getHomeSectionsContainer(indexPage);
  const id = `because-you-watched--${key}`;
  let existing = document.getElementById(id);
  if (existing) {
    const parent = (document.getElementById('studio-hubs')?.parentElement) || homeSections || getHomeSectionsContainer(currentIndexPage());
    const genreWrap = document.getElementById('genre-hubs');
    if (parent && genreWrap && genreWrap.parentElement === parent) {
      try { parent.insertBefore(existing, genreWrap); } catch {}
    } else {
      placeSection(existing, homeSections, false);
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
  section.insertBefore(heroHost, scrollWrap);
  section.__heroHost = heroHost;

  const parent = (document.getElementById('studio-hubs')?.parentElement) || homeSections || getHomeSectionsContainer(currentIndexPage());
  const genreWrap = document.getElementById('genre-hubs');
  if (parent && genreWrap && genreWrap.parentElement === parent) {
    try { parent.insertBefore(section, genreWrap); }
    catch { placeSection(section, homeSections, false); }
  } else {
    placeSection(section, homeSections, false);
  }
  try { enforceOrder(parent); } catch {}
  return section;
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
  };
  if (['tur','eng','deu','fre','rus'].includes(base)) return base;
  if (map2to3[base]) return map2to3[base];
  return 'tur';
}

function getLangKeyCandidates() {
  let raw = '';
  try { raw = String(getDefaultLanguage?.() || '').trim(); } catch {}

  const lower = raw.toLowerCase();
  const base = lower.split('-')[0];
  const map2to3 = { tr:'tur', en:'eng', de:'deu', fr:'fre', ru:'rus' };
  const three = map2to3[base] || base;
  const out = [];
  if (lower) out.push(lower);
  if (base)  out.push(base);
  if (three) out.push(three);
  out.push('tur', 'eng');

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
      `/Users/${encodeURIComponent(userId)}/Items/Resume?` +
      `Limit=${Math.max(1, count)}&Fields=${encodeURIComponent(fields)}`;
    const r = await makeApiRequest(url);
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items.filter(x => x?.Id);
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

async function fetchBecauseYouWatched(userId, targetCount, minRating, seedKey) {
  const cfg = __prcCfg();
  const { serverId } = getSessionInfo();
  const st = await ensurePrcDb(userId, serverId);

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

async function renderBecauseYouWatchedAuto(indexPage) {
  const { userId, serverId } = getSessionInfo();
  const seedsRaw = await fetchLastPlayedSeedItems(userId, Math.max(1, BYW_ROW_COUNT * 2));
  shuffleCrypto(seedsRaw);
  const seen = new Set();
  const seeds = [];
  for (const it of seedsRaw) {
    const id = it?.Id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    seeds.push(it);
    if (seeds.length >= BYW_ROW_COUNT) break;
  }
  if (!seeds.length) return;

  const ctxs = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const seedId = seed.Id;
    const seedName = seed.Name || "";
    const section = ensureBecauseContainer(indexPage, String(i));
    setBywTitle(section, seedName);
    const row = section.querySelector(".byw-row");
    if (!row) continue;
    renderSkeletonCards(row, BYW_CARD_COUNT);
    setupScroller(row);
    ctxs.push({ i, seed, seedId, seedName, section, row });
  }

  const jobs = ctxs.map((ctx) => async () => {
    const { i, seed, seedId, seedName, section, row } = ctx;
    const { items } = await fetchBecauseYouWatched(userId, BYW_CARD_COUNT, MIN_RATING, seedId);
    shuffleCrypto(items);
    clearRowWithCleanup(row);
    if (!items || !items.length) {
      row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || labels.noRecommendations || "Öneri bulunamadı"}</div>`;
      triggerScrollerUpdate(row);
      return;
    }

    try {
      const heroHost = section.__heroHost || section.querySelector('.dir-row-hero-host');
      if (heroHost) {
        const heroItem = seed || items[0];
        if (heroItem?.Id) {
          const heroLabel = formatBecauseYouWatchedTitle(seedName);
          mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold: i === 0 });
          try {
            const heroEl = heroHost.querySelector('.dir-row-hero');
            const backdropImg = heroEl?.querySelector?.('.dir-row-hero-bg');
            const RemoteTrailers =
              heroItem.RemoteTrailers ||
              heroItem.RemoteTrailerItems ||
              heroItem.RemoteTrailerUrls ||
              [];
            createTrailerIframe({
              config,
              RemoteTrailers,
              slide: heroEl,
              backdropImg,
              itemId: heroItem.Id,
              serverId,
              detailsUrl: getDetailsUrl(heroItem.Id, serverId),
              detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
            });
          } catch {}
        }
      }
    } catch {}

    const frag = document.createDocumentFragment();
    for (let k = 0; k < Math.min(items.length, BYW_CARD_COUNT); k++) {
      frag.appendChild(createRecommendationCard(items[k], serverId, k < (IS_MOBILE ? 2 : 3)));
    }
    row.appendChild(frag);
    try { applyResumeLabelsToCards(Array.from(row.querySelectorAll('.personal-recs-card')), userId); } catch {}
    triggerScrollerUpdate(row);
  });

  await runWithConcurrency(jobs, IS_MOBILE ? 1 : 2);
}

function ensurePersonalRecsContainer(indexPage) {
  const homeSections = getHomeSectionsContainer(indexPage);
  let existing = document.getElementById("personal-recommendations");
  if (existing) {
    placeSection(existing, homeSections, !!getConfig().placePersonalRecsUnderStudioHubs);
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
        <span class="material-icons">keyboard_arrow_right</span>
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

      placeSection(section, homeSections, !!getConfig().placePersonalRecsUnderStudioHubs);
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

async function fetchPersonalRecommendations(userId, targetCount = EFFECTIVE_CARD_COUNT, minRating = 0) {
  const cfg = __prcCfg();
  const cacheGoal = Math.min(
    cfg.maxCacheIds,
    Math.max(targetCount * 12, 40)
  );

  try {
    const { serverId } = getSessionInfo();
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

        if (candidates.length < Math.max(6, targetCount * 2)) {
          candidates = ids.slice();
        }
        shuffle(candidates);

        const sampleIds = candidates.slice(0, Math.min(candidates.length, cacheGoal));
        const aliveIds = await filterOutPlayedIds(userId, sampleIds);
        const itemsFromDb = await dbGetItemsByIds(st.db, st.scope, aliveIds);

        shuffle(itemsFromDb);

        const picked = filterAndTrimByRating(itemsFromDb, minRating, targetCount);
        if (picked.length >= targetCount) {
          try {
            await setMeta(st.db, __metaKeyPersonalLast(st.scope), {
              ids: picked.map(x => x.Id).filter(Boolean),
              ts: Date.now()
            });
          } catch {}
          return picked.slice(0, targetCount);
        }
      }
    }
  } catch {}

  const requested = Math.max(targetCount * 4, 80);
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
  const final = uniq.slice(0, targetCount);

  try {
    const { serverId } = getSessionInfo();
    const st = await ensurePrcDb(userId, serverId);
    if (st?.db && st?.scope && final?.length) {
      await setMeta(st.db, __metaKeyPersonalLast(st.scope), {
        ids: final.map(x => x.Id).filter(Boolean),
        ts: Date.now()
      });
    }
  } catch {}

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
  clearRowWithCleanup(row);
  if (!items || !items.length) {
    row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || labels.noRecommendations || "Öneri bulunamadı"}</div>`;
    return;
  }

  const unique = items;
  const rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn,0));
  const slice = unique;
  const aboveFoldCount = IS_MOBILE ? Math.min(4, slice.length) : Math.min(6, slice.length);
  const f1 = document.createDocumentFragment();
  const domSeen = new Set();
  const aboveCards = [];

  for (let i = 0; i < aboveFoldCount; i++) {
    const c = createRecommendationCard(slice[i], serverId, true);
    aboveCards.push(c);
    const k = c?.dataset?.key || c?.getAttribute?.('data-key');
    if (k) domSeen.add(k);
    f1.appendChild(c);
  }

  row.appendChild(f1);

  try {
    const { userId } = getSessionInfo();
    scheduleResumeLabels(aboveCards, userId);
  } catch {}

  let idx = aboveFoldCount;
  let rendered = aboveFoldCount;

  function pump() {
    if (rendered >= EFFECTIVE_CARD_COUNT) return;
    if (idx >= slice.length) return;
    const chunk = IS_MOBILE ? 2 : 10;
    const fx = document.createDocumentFragment();
    const justAddedCards = [];

    let added = 0;

    while (added < chunk && idx < slice.length) {
      const it = slice[idx++];
      const k = makePRCKey(it);
      if (!k || domSeen.has(k)) continue;
      domSeen.add(k);
      const c = createRecommendationCard(it, serverId, false);
      justAddedCards.push(c);
      fx.appendChild(c);
      added++;
      if (rendered + added >= EFFECTIVE_CARD_COUNT) break;
    }
    if (added) {
      row.appendChild(fx);
      rendered += added;
    }
    if (added) {
      try {
        const { userId } = getSessionInfo();
        scheduleResumeLabels(justAddedCards, userId);
      } catch {}
    }
    if (rendered < EFFECTIVE_CARD_COUNT) {
      rIC(pump);
    }
  }
  rIC(pump);
}

const LIGHT_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "BackdropImageTags",
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
  "BackdropImageTags",
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
  const hs = [240, 360, 540, 720];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  const raw = hs
    .map(h => `${buildPosterUrl(item, h, q)} ${Math.round(h * ar)}w`)
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

function normalizeAgeChip(rating) {
  if (!rating) return null;
  const r = String(rating).toUpperCase().trim();
  if (/(18\+|R18|ADULT|NC-17|X-RATED|XXX|ADULTS ONLY|AO)/.test(r)) return "18+";
  if (/(17\+|R|TV-MA)/.test(r)) return "17+";
  if (/(16\+|R16|M|MATURE)/.test(r)) return "16+";
  if (/(15\+|TV-15)/.test(r)) return "15+";
  if (/(13\+|TV-14|PG-13|TEEN)/.test(r)) return "13+";
  if (/(12\+|TV-12)/.test(r)) return "12+";
  if (/(10\+|TV-Y10)/.test(r)) return "10+";
  if (/(7\+|TV-Y7|E10\+|E10)/.test(r)) return "7+";
  if (/(G|PG|TV-G|TV-PG|E|EVERYONE|U|UC|UNIVERSAL)/.test(r)) return "7+";
  if (/(ALL AGES|ALL|TV-Y|KIDS|Y)/.test(r)) return "0+";
  return r;
}

function getRuntimeWithIcons(runtime) {
  if (!runtime) return '';
  return runtime.replace(/(\d+)s/g, `$1${config.languageLabels?.sa || 'sa'}`)
  .replace(/(\d+)d/g, `$1${config.languageLabels?.dk || 'dk'}`);
}

function getDetailsUrl(itemId, serverId) {
  return `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}`;
}

function buildPosterUrl(item, height = 540, quality = 72) {
  const tag = item.ImageTags?.Primary || item.PrimaryImageTag;
  if (!tag) return null;
  const url = `/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxHeight=${height}&quality=${quality}&EnableImageEnhancers=false`;
  return withServer(url);
}

function createGenreHeroCard(item, serverId, genreName, { aboveFold = false } = {}) {
  const hero = document.createElement('div');
  hero.className = 'dir-row-hero';
  hero.dataset.itemId = item.Id;

  const bgLQ = buildBackdropUrlLQ(item) || buildPosterUrlLQ(item) || null;
  const bgHQ = buildBackdropUrlHQ(item) || buildPosterUrlHQ(item) || null;

  const logo = buildLogoUrl(item);
  const year = item.ProductionYear || '';
  const plot = clampText(item.Overview, 240);
  const ageChip = normalizeAgeChip(item.OfficialRating || '');
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  const metaParts = [];
  if (ageChip) metaParts.push(ageChip);
  if (year) metaParts.push(year);
  if (genres) metaParts.push(genres);
  const meta = metaParts.join(" • ");

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg"
           alt="${escapeHtml(item.Name)}"
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
                 alt="${escapeHtml(item.Name)} logo"
                 decoding="async"
                 loading="lazy">
          </div>
        ` : ``}

        <div class="dir-row-hero-title">${escapeHtml(item.Name)}</div>

        <div class="dir-row-hero-submeta">
          ${meta ? `<span class="dir-row-hero-meta">${escapeHtml(meta)}</span>` : ""}
        </div>

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

  const goDetails = () => {
    try { window.location.hash = getDetailsUrl(item.Id, serverId); }
    catch { window.location.href = getDetailsUrl(item.Id, serverId); }
  };

  hero.addEventListener('click', () => { goDetails(); });

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

function createRecommendationCard(item, serverId, aboveFold = false) {
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  card.dataset.itemId = item.Id;
  card.setAttribute('data-key', makePRCKey(item));

  const posterUrlHQ = buildPosterUrlHQ(item);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  const posterUrlLQ = buildPosterUrlLQ(item);
  const year = item.ProductionYear || "";
  const ageChip = normalizeAgeChip(item.OfficialRating || "");
  const runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  const runtime = formatRuntime(runtimeTicks);
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";
  const isSeries = item.Type === "Series";
  const typeLabel = isSeries
    ? ((config.languageLabels && config.languageLabels.dizi) || "Dizi")
    : ((config.languageLabels && config.languageLabels.film) || "Film");
  const typeIcon = isSeries ? 'live_tv' : 'movie';
  const community = Number.isFinite(item.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${item.CommunityRating.toFixed(1)}</div>`
    : "";

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${getDetailsUrl(item.Id, serverId)}">
        <div class="cardImageContainer">
          <img class="cardImage"
            alt="${escapeHtml(item.Name)}"
            loading="${aboveFold ? 'eager' : 'lazy'}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ''}>
          <div class="prc-top-badges">
            ${community}
            <div class="prc-type-badge">
              <span class="prc-type-icon material-icons">${typeIcon}</span>
              ${typeLabel}
            </div>
          </div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-titleline">
              ${escapeHtml(clampText(item.Name, 42))}
              </div>
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

  const img = card.querySelector('.cardImage');
  try {
  const sizesMobile = '(max-width: 640px) 45vw, (max-width: 820px) 38vw, 220px';
  const sizesDesk   = '(max-width: 1200px) 22vw, 220px';
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
    noImg.style.minHeight = '220px';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    card.querySelector('.cardImageContainer')?.prepend(noImg);
  }

  try {
    const hostEl = card.querySelector(".cardImageContainer");
    if (hostEl) {
      ensureJmsDetailsOverlay({
        hostEl,
        itemId: item.Id,
        serverId,
        onDetails: async () => {
          const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
          await openDetailsModal({
            itemId: item.Id,
            serverId,
            preferBackdropIndex: backdropIndex,
            originEl: hostEl?.querySelector?.('img.cardImage') || hostEl,
          });
        },
        onPlay: async () => {
          await playNow(item.Id);
        },
        showPlay: false,
      });
    }
  } catch (e) {
    console.warn("ensureJmsDetailsOverlay failed:", e);
  }

  const mode = (getConfig()?.globalPreviewMode === 'studioMini') ? 'studioMini' : 'modal';
  const defer = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  defer(() => attachPreviewByMode(card, item, mode));
  card.addEventListener('jms:cleanup', () => {
    unobserveImage(img);
    detachPreviewHandlers(card);
  }, { once: true });
  return card;
}

function cleanupScroller(row) {
  const s = row && row.__scroller;
  if (!s) { try { row.dataset.scrollerMounted = "0"; } catch {} return; }

  try { s.mo?.disconnect?.(); } catch {}
  try { s.ro?.disconnect?.(); } catch {}

  try { row.removeEventListener("wheel", s.onWheel); } catch {}
  try { row.removeEventListener("scroll", s.onScroll); } catch {}
  try { row.removeEventListener("touchstart", s.onTs); } catch {}
  try { row.removeEventListener("touchmove", s.onTm); } catch {}
  try { row.removeEventListener("load", s.onLoadCapture, true); } catch {}

  try { s.btnL?.removeEventListener?.("click", s.onClickL); } catch {}
  try { s.btnR?.removeEventListener?.("click", s.onClickR); } catch {}

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
  const STEP_PCT = 0.88;
  const stepPx   = () => Math.max(320, Math.floor(row.clientWidth * STEP_PCT));

  let _rafToken = null;

  const updateButtonsNow = () => {
    const scrollable = canScroll();
    if (btnL) { btnL.setAttribute("aria-disabled", scrollable ? "false" : "true"); btnL.disabled = !scrollable; }
    if (btnR) { btnR.setAttribute("aria-disabled", scrollable ? "false" : "true"); btnR.disabled = !scrollable; }
  };

  const scheduleUpdate = () => {
    if (_rafToken) return;
    _rafToken = requestAnimationFrame(() => {
      _rafToken = null;
      updateButtonsNow();
    });
  };

  const mo = new MutationObserver(() => scheduleUpdate());
  mo.observe(row, { childList: true, subtree: true });

  const onLoadCapture = () => scheduleUpdate();
  row.addEventListener("load", onLoadCapture, true);

  let _animSeq = 0;
  function animateScrollTo(targetLeft, duration = 320) {
    const start = row.scrollLeft;
    const dist  = targetLeft - start;
    if (Math.abs(dist) < 1) { row.scrollLeft = targetLeft; scheduleUpdate(); try { row.classList.remove('is-animating'); } catch {} return; }

    const seq = ++_animSeq;
    try { row.classList.add('is-animating'); } catch {}
    let startTs = null;
    const easeInOutCubic = t =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function tick(ts) {
      if (seq !== _animSeq) return;
      if (startTs == null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / duration);
      row.scrollLeft = start + dist * easeInOutCubic(p);
      if (p < 1) requestAnimationFrame(tick);
      else {
        scheduleUpdate();
        if (seq === _animSeq) { try { row.classList.remove('is-animating'); } catch {} }
      }
    }
    requestAnimationFrame(tick);
  }

  function doScroll(dir, evt) {
    if (!canScroll()) return;
    const fast = evt?.shiftKey ? 1.35 : 1;
    const delta = (dir < 0 ? -1 : 1) * stepPx() * fast;
    const max = Math.max(0, row.scrollWidth - row.clientWidth);
    const left = row.scrollLeft;
    let target;
    if (dir > 0 && left >= max - 1) target = 0;
    else if (dir < 0 && left <= 1) target = max;
    else target = Math.max(0, Math.min(max, left + delta));

    const dist = Math.abs(target - left);
    const duration = Math.max(180, Math.min(650, Math.round(dist / 3.2)));
    animateScrollTo(target, duration);
  }

  const onClickL = (e) => { e.preventDefault(); e.stopPropagation(); doScroll(-1, e); };
  const onClickR = (e) => { e.preventDefault(); e.stopPropagation(); doScroll( 1, e); };
  if (btnL) btnL.addEventListener("click", onClickL);
  if (btnR) btnR.addEventListener("click", onClickR);

  const onWheel = (e) => {
    const horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if (!horizontalIntent) return;
    _animSeq++;
    try { row.classList.remove('is-animating'); } catch {}
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    row.scrollLeft += delta;
    e.preventDefault();
    scheduleUpdate();
  };
  row.addEventListener("wheel", onWheel, { passive: false });

  const onTs = (e)=>e.stopPropagation();
  const onTm = (e)=>e.stopPropagation();
  row.addEventListener("touchstart", onTs, { passive: true });
  row.addEventListener("touchmove", onTm, { passive: true });

  const onScroll = () => scheduleUpdate();
  row.addEventListener("scroll", onScroll, { passive: true });

  const ro = new ResizeObserver(() => scheduleUpdate());
  ro.observe(row);
  row.__scroller = { btnL, btnR, onClickL, onClickR, onWheel, onScroll, onTs, onTm, ro, mo, onLoadCapture };
  row.addEventListener("jms:cleanup", () => {
    try { cleanupScroller(row); } catch {}
  }, { once: true });

  requestAnimationFrame(() => updateButtonsNow());
  setTimeout(() => updateButtonsNow(), 400);
}

function getGenreHubsAnchor(parent) {
  if (!getConfig().placeGenreHubsUnderStudioHubs) return null;

  const recent = document.getElementById("recent-rows");
  if (recent && recent.parentElement === parent) return recent;

  const pr = document.getElementById("personal-recommendations");
  if (getConfig().enablePersonalRecommendations && pr && pr.parentElement === parent) return pr;

  return null;
}

async function renderGenreHubs(indexPage) {
  try { window.__jmsGenreHubsStarted = true; } catch {}
  __resetGenreHubsDoneSignal();
  detachGenreScrollIdleLoader();
  const homeSections = getHomeSectionsContainer(indexPage);

  let wrap = document.getElementById("genre-hubs");
  if (wrap) {
    try { abortAllGenreFetches(); } catch {}
    try {
      wrap.querySelectorAll('.personal-recs-card,.genre-row').forEach(el => {
        el.dispatchEvent(new Event('jms:cleanup'));
      });
    } catch {}
    wrap.innerHTML = '';
    __globalGenreHeroLoose.clear();
    __globalGenreHeroStrict.clear();
  } else {
    wrap = document.createElement("div");
    wrap.id = "genre-hubs";
    wrap.className = "homeSection genre-hubs-wrapper";
  }

  const parent = homeSections || getHomeSectionsContainer(indexPage) || document.body;
  const recent = document.getElementById("recent-rows");
  if (recent && recent.isConnected) {
    const p = recent.parentElement || parent;
    insertAfter(p, wrap, recent);
  } else {
    placeSection(wrap, homeSections, false);
  }

  try { ensureIntoHomeSections(wrap, indexPage); } catch {}
  enforceOrder(homeSections);

  const { userId, serverId } = getSessionInfo();
  const allGenres = await getCachedGenresWeekly(userId);
  if (!allGenres || !allGenres.length) { __signalGenreHubsDone(); return; }

  const picked = pickOrderedFirstK(allGenres, EFFECTIVE_GENRE_ROWS);
  if (!picked.length) { __signalGenreHubsDone(); return; }

  GENRE_STATE.wrap     = wrap;
  GENRE_STATE.genres   = picked;
  GENRE_STATE.sections = new Array(picked.length);
  GENRE_STATE.nextIndex = 0;
  GENRE_STATE.loading   = false;
  GENRE_STATE.serverId  = serverId;

  await ensureGenreLoaded(0);
  GENRE_STATE.nextIndex = 1;

  __maybeSignalGenreHubsDone();

  if (GENRE_STATE.nextIndex < GENRE_STATE.genres.length) {
    attachGenreScrollIdleLoader();
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
          <span class="material-icons">keyboard_arrow_right</span>
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
  renderSkeletonCards(row, EFFECTIVE_GENRE_ROW_CARD_COUNT);

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

      const chunk = IS_MOBILE ? 2 : 10;
      const f = document.createDocumentFragment();

      let added = 0;
      for (let k = 0; k < chunk && j < list.length; k++, j++) {
        f.appendChild(createRecommendationCard(list[j], serverId, false));
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
      const items = await fetchItemsBySingleGenre(userId, genre, GENRE_ROW_CARD_COUNT * 3, MIN_RATING);
      if (rec.seq !== mySeq) return;

      row.innerHTML = '';
      setupScroller(row);

      if (!items || !items.length) {
        row.innerHTML = `<div class="no-recommendations">${labels.noRecommendations || "Uygun içerik yok"}</div>`;
        if (heroHost) heroHost.innerHTML = "";
        triggerScrollerUpdate(row);
        return;
      }

      const pool = dedupeStrong(items).slice();
      shuffle(pool);

      let best = null;
      let bestIndex = -1;
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

      const remaining = (bestIndex >= 0) ? pool.filter((_, i) => i !== bestIndex) : pool.slice();

      if (heroHost) {
        heroHost.innerHTML = "";
        if (best) {
          mountHero(heroHost, best, serverId, genre, { aboveFold: idx === 0 });
          try {
            const heroEl = heroHost.querySelector('.dir-row-hero');
            const backdropImg = heroEl?.querySelector?.('.dir-row-hero-bg');
            const RemoteTrailers = best.RemoteTrailers || best.RemoteTrailerItems || best.RemoteTrailerUrls || [];
            createTrailerIframe({
              config,
              RemoteTrailers,
              slide: heroEl,
              backdropImg,
              itemId: best.Id,
              serverId,
              detailsUrl: getDetailsUrl(best.Id, serverId),
              detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
            });
          } catch {}
        }
      }

      if (!remaining.length) {
        row.innerHTML = `<div class="no-recommendations">${labels.noRecommendations || "Uygun içerik yok"}</div>`;
        triggerScrollerUpdate(row);
        return;
      }

      const unique = remaining.slice(0, GENRE_ROW_CARD_COUNT);
      const head = Math.min(unique.length, IS_MOBILE ? 4 : 6);

      const f1 = document.createDocumentFragment();
      for (let i = 0; i < head; i++) {
        f1.appendChild(createRecommendationCard(unique[i], serverId, i < 2));
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
      try {
        row.innerHTML = `<div class="no-recommendations">${labels.noRecommendations || "Uygun içerik yok"}</div>`;
        if (heroHost) heroHost.innerHTML = "";
        setupScroller(row);
        triggerScrollerUpdate(row);
      } catch {}
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
  try {
    const { serverId } = getSessionInfo();
    const st = await ensurePrcDb(userId, serverId);
    const cfg = __prcCfg();
    if (st?.db && st?.scope) {
      const key = __metaKeyGenre(st.scope, genre);
      const cache = await getMeta(st.db, key);
      const ts = Number(cache?.ts || 0);
      const ids = Array.isArray(cache?.ids) ? cache.ids : [];
      const fresh = ts && (Date.now() - ts) <= cfg.genreTtlMs;
      if (fresh && ids.length) {
        const aliveIds = await filterOutPlayedIds(userId, ids);
        const itemsFromDb = await dbGetItemsByIds(st.db, st.scope, aliveIds);
        const picked = filterAndTrimByRating(itemsFromDb, minRating, limit);
        if (picked.length >= limit) {
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
  if (!cardEl || !itemLike?.Id) return;
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
      safeOpenHoverModal(itemLike.Id, cardEl);

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
  if (mode === 'studioMini') {
    attachMiniPosterHover(cardEl, itemLike);
    __boundPreview.set(cardEl, { mode: 'studioMini', onEnter: ()=>{}, onLeave: ()=>{} });
  } else {
    attachHoverTrailer(cardEl, itemLike);
  }
}

window.addEventListener("jms:all-slides-ready", () => {
  if (!__personalRecsBusy) scheduleRecsRetry(0);
}, { once: true, passive: true });

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
  try { detachGenreScrollIdleLoader(); } catch {}
  try { abortAllGenreFetches(); } catch {}

  __personalRecsInitDone = false;
  __personalRecsBusy = false;

  GENRE_STATE.genres = [];
  GENRE_STATE.sections = [];
  GENRE_STATE.nextIndex = 0;
  GENRE_STATE.loading = false;
  GENRE_STATE.wrap = null;
  GENRE_STATE.serverId = null;

  try { __globalGenreHeroLoose.clear(); } catch {}
  try { __globalGenreHeroStrict.clear(); } catch {}
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
}

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
  document.querySelectorAll('img.cardImage').forEach(img => {
    if (!img || !img.__data) return;
    img.__hiFailed = false;
    img.__hiRequested = false;
    img.__retryAfter = 0;
    try { __imgIO.unobserve(img); } catch {}
    try { __imgIO.observe(img); } catch {}
  });
}

window.addEventListener('online', __forceRetryAllBroken);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) __forceRetryAllBroken();
});

