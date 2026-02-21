import { getSessionInfo, makeApiRequest, playNow } from "./api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, ensureJmsDetailsOverlay } from "./utils.js";
import { setupScroller } from "./personalRecommendations.js";
import { openDetailsModal } from "./detailsModal.js";
import {
  openDirRowsDB,
  makeScope,
  upsertItem,
  getMeta,
  setMeta,
} from "./dirRowsDb.js";
import { withServer, withServerSrcset } from "./jfUrl.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
const PLACEHOLDER_URL = (config.placeholderImage) || "./slider/src/images/placeholder.png";
const ENABLE_RECENT_MASTER = (config.enableRecentRows !== false);
const ENABLE_RECENT_MOVIES   = ENABLE_RECENT_MASTER && (config.enableRecentMoviesRow !== false);
const ENABLE_RECENT_SERIES   = ENABLE_RECENT_MASTER && (config.enableRecentSeriesRow !== false);
const ENABLE_RECENT_EPISODES = ENABLE_RECENT_MASTER && (config.enableRecentEpisodesRow !== false);
const DEFAULT_RECENT_ROWS_COUNT = 15;
const RECENT_MOVIES_CARD_COUNT =
  Number.isFinite(config.recentMoviesCardCount) ? Math.max(1, config.recentMoviesCardCount|0)
  : DEFAULT_RECENT_ROWS_COUNT;

const RECENT_SERIES_CARD_COUNT =
  Number.isFinite(config.recentSeriesCardCount) ? Math.max(1, config.recentSeriesCardCount|0)
  : DEFAULT_RECENT_ROWS_COUNT;

const RECENT_EP_CARD_COUNT =
  Number.isFinite(config.recentEpisodesCardCount) ? Math.max(1, config.recentEpisodesCardCount|0)
  : 10;

const ENABLE_CONTINUE_MOVIES  = (config.enableContinueMovies !== false);
const CONT_MOVIES_CARD_COUNT  = Number.isFinite(config.continueMoviesCardCount) ? Math.max(1, config.continueMoviesCardCount|0) : 10;
const ENABLE_CONTINUE_SERIES  = (config.enableContinueSeries !== false);
const CONT_SERIES_CARD_COUNT  = Number.isFinite(config.continueSeriesCardCount) ? Math.max(1, config.continueSeriesCardCount|0) : 10;
const EFFECTIVE_RECENT_MOVIES_COUNT = IS_MOBILE ? Math.min(RECENT_MOVIES_CARD_COUNT, 8) : Math.min(RECENT_MOVIES_CARD_COUNT, 12);
const EFFECTIVE_RECENT_SERIES_COUNT = IS_MOBILE ? Math.min(RECENT_SERIES_CARD_COUNT, 8) : Math.min(RECENT_SERIES_CARD_COUNT, 12);
const EFFECTIVE_CONT_MOV_CNT  = IS_MOBILE ? Math.min(CONT_MOVIES_CARD_COUNT, 8) : Math.min(CONT_MOVIES_CARD_COUNT, 12);
const EFFECTIVE_CONT_SER_CNT  = IS_MOBILE ? Math.min(CONT_SERIES_CARD_COUNT, 8) : Math.min(CONT_SERIES_CARD_COUNT, 12);
const EFFECTIVE_RECENT_EP_CNT = IS_MOBILE ? Math.min(RECENT_EP_CARD_COUNT, 8) : Math.min(RECENT_EP_CARD_COUNT, 12);

const HOVER_MODE = (config.recentRowsHoverPreviewMode === "studioMini" || config.recentRowsHoverPreviewMode === "modal")
  ? config.recentRowsHoverPreviewMode
  : "inherit";

const STATE = {
  started: false,
  wrapEl: null,
  serverId: null,
  userId: null,
  defaultTvHash: null,
  defaultMoviesHash: null,
  tvLibs: [],
  db: null,
  scope: null,
};

let __wrapInserted = false;

const TTL_RECENT_MS   = Number.isFinite(config.recentRowsCacheTTLms) ? Math.max(5_000, config.recentRowsCacheTTLms|0) : 90_000;
const TTL_CONTINUE_MS = Number.isFinite(config.continueRowsCacheTTLms) ? Math.max(5_000, config.continueRowsCacheTTLms|0) : 45_000;

function metaKey(kind, type){ return `rr:${kind}:${type}`; }
function tvLibMetaSuffix(tvLibId){ return tvLibId ? `@tv:${tvLibId}` : ""; }

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
    const ids = Array.isArray(rec?.ids) ? rec.ids.filter(Boolean) : [];
    const updatedAt = Number(rec?.updatedAt) || 0;
    const fresh = (Date.now() - updatedAt) <= ttlMs;
    return { ids, fresh };
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
  st.id = "recent-rows-perf-css";
  st.textContent = `
    #recent-rows .recent-row-section {
      contain-intrinsic-size: 260px 600px;
      margin-bottom: 8px;
    }
    #recent-rows .personal-recs-row {
      contain-intrinsic-size: 260px 400px;
      contain: layout style paint;
    }
    #recent-rows .personal-recs-card {
      contain: layout style paint;
      will-change: transform;
    }
    .skeleton-line {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: skeleton-pulse 1.5s ease-in-out infinite;
      border-radius: 4px;
    }
    @keyframes skeleton-pulse {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    img.is-lqip {
      filter: blur(8px);
      transform: translateZ(0);
      transition: filter 0.3s ease;
    }
    img.is-lqip.__hydrated { filter: none; }
  `;
  document.head.appendChild(st);
})();

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
  "UserData",
  "RemoteTrailers",
  "SeriesId",
  "SeriesName",
  "ParentId",
  "IndexNumber",
  "ParentIndexNumber"
].join(",");

function buildPosterUrl(item, height = 540, quality = 72) {
  const tag = item?.ImageTags?.Primary || item?.PrimaryImageTag;
  if (!tag) return null;

  const path =
    `/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}` +
    `&maxHeight=${height}&quality=${quality}&EnableImageEnhancers=false`;

  return withServer(path);
}

function buildPosterUrlHQ(item){ return buildPosterUrl(item, 540, 72); }

function buildPosterUrlLQ(item){ return buildPosterUrl(item, 80, 20); }

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  const tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!tag) return null;

  const path =
    `/Items/${item.Id}/Images/Logo?tag=${encodeURIComponent(tag)}` +
    `&maxWidth=${width}&quality=${quality}&EnableImageEnhancers=false`;

  return withServer(path);
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;

  const tag =
    (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item.BackdropImageTag ||
    (item.ImageTags && item.ImageTags.Backdrop);

  if (!tag) return null;

  const path =
    `/Items/${item.Id}/Images/Backdrop?tag=${encodeURIComponent(tag)}` +
    `&maxWidth=${width}&quality=${quality}&EnableImageEnhancers=false`;

  return withServer(path);
}

function buildBackdropUrlHQ(item){ return buildBackdropUrl(item, 1920, 80); }

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function scheduleImgRetry(img, phase /* "lq"|"hi" */, delayMs) {
  if (!img) return;
  const st = (img.__retryState ||= { lq: { tries: 0 }, hi: { tries: 0 } });
  const slot = st[phase] || (st[phase] = { tries: 0 });
  const maxTries = (phase === "hi") ? 8 : 6;
  if (slot.tries >= maxTries) return;

  slot.tries++;
  clearTimeout(slot.tid);

  slot.tid = setTimeout(() => {
    const data = img.__data || {};
    const fb = data.fallback || PLACEHOLDER_URL;

    try { img.removeAttribute("srcset"); } catch {}
    try { img.src = ""; } catch {}

    if (phase === "hi" && data.hqSrc) {
      img.__phase = "hi";
      img.__hiRequested = true;
      img.src = withCacheBust(data.hqSrc);
      requestIdleCallback(() => {
        if (data.hqSrcset) img.srcset = data.hqSrcset;
      });
      return;
    }

    img.__phase = "lq";
    img.__hiRequested = false;
    img.src = withCacheBust(data.lqSrc || fb);
  }, Math.max(250, delayMs|0));
}

function buildPosterSrcSet(item) {
  const hs = [240, 360, 540];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;

  const raw = hs
    .map(h => {
      const tag = item?.ImageTags?.Primary || item?.PrimaryImageTag;
      if (!tag) return "";
      const path =
        `/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}` +
        `&maxHeight=${h}&quality=${q}&EnableImageEnhancers=false`;
      return `${path} ${Math.round(h * ar)}w`;
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
      if (!img.__hiRequested) {
        img.__hiRequested = true;
        img.__phase = "hi";
        if (data.hqSrc) {
          img.src = data.hqSrc;
          requestIdleCallback(() => {
            if (img.__hiRequested && data.hqSrcset) img.srcset = data.hqSrcset;
          });
        }
      }
    }
  }, { rootMargin: IS_MOBILE ? "400px 0px" : "600px 0px", threshold: 0.1 });
  window.__JMS_RECENT_IMGIO = __imgIO;
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;

  img.__data = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = "lq";
  img.__hiRequested = false;

  try {
    img.removeAttribute("srcset");
    img.loading = "lazy";
  } catch {}

  img.src = lqSrc || fb;
  img.classList.add("is-lqip");
  img.__hydrated = false;

  const onError = () => {
  const data = img.__data || {};
  const fb = data.fallback || PLACEHOLDER_URL;

  try { img.removeAttribute("srcset"); } catch {}
  try { img.src = fb; } catch {}

  img.__hiRequested = false;
  if (img.__phase === "hi") {
    const delay = 800 * Math.min(6, (img.__retryState?.hi?.tries || 0) + 1);
    scheduleImgRetry(img, "hi", delay);
  } else {
    const delay = 600 * Math.min(5, (img.__retryState?.lq?.tries || 0) + 1);
    scheduleImgRetry(img, "lq", delay);
  }
};

const onLoad = () => {
  if (img.__retryState) {
    try { clearTimeout(img.__retryState.lq?.tid); } catch {}
    try { clearTimeout(img.__retryState.hi?.tid); } catch {}
    img.__retryState.lq && (img.__retryState.lq.tries = 0);
    img.__retryState.hi && (img.__retryState.hi.tries = 0);
  }

  if (img.__phase === "hi") {
    img.classList.add("__hydrated");
    img.classList.remove("is-lqip");
    img.__hydrated = true;
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

function normalizeAgeChip(rating) {
  if (!rating) return null;
  const r = String(rating).toUpperCase().trim();
  if (/(18\+|R18|NC-17|XXX|AO)/.test(r)) return "18+";
  if (/(17\+|R|TV-MA)/.test(r)) return "17+";
  if (/(16\+|R16|M)/.test(r)) return "16+";
  if (/(15\+|TV-15)/.test(r)) return "15+";
  if (/(13\+|TV-14|PG-13)/.test(r)) return "13+";
  if (/(12\+|TV-12)/.test(r)) return "12+";
  if (/(10\+|TV-Y10)/.test(r)) return "10+";
  if (/(7\+|TV-Y7|E10\+)/.test(r)) return "7+";
  if (/(G|PG|TV-G|TV-PG|E|U|UC)/.test(r)) return "7+";
  if (/(ALL AGES|ALL|TV-Y|KIDS|Y)/.test(r)) return "0+";
  return r;
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
  if (!cardEl || !itemLike?.Id) return;
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
      safeOpenHoverModal(itemLike.Id, cardEl);

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
  if (mode === "studioMini") {
    attachMiniPosterHover(cardEl, itemLike);
    __boundPreview.set(cardEl, { mode: "studioMini", onEnter: ()=>{}, onLeave: ()=>{} });
  } else {
    attachHoverTrailer(cardEl, itemLike);
  }
}

function gotoHash(hash) {
  try { window.location.hash = hash; }
  catch { try { window.location.href = hash; } catch {} }
}

const DEFAULT_TV_PAGE = "#/tv";
const DEFAULT_MOVIES_PAGE = "#/movies";

async function resolveDefaultPages(userId) {
  try {
    const data = await makeApiRequest(`/Users/${userId}/Views`);
    const items = Array.isArray(data?.Items) ? data.Items : [];

    const tvLibs = items.filter(x => (x?.CollectionType === "tvshows")).map(x => ({
      Id: x?.Id,
      Name: x?.Name || "",
      CollectionType: x?.CollectionType
    })).filter(x => x.Id);
    STATE.tvLibs = tvLibs;

    const tvLib = tvLibs[0] || null;
    const movLib = items.find(x => (x?.CollectionType === "movies")) || null;

    if (tvLib?.Id) {
      STATE.defaultTvHash = `#/tv?topParentId=${encodeURIComponent(tvLib.Id)}&collectionType=tvshows&tab=1`;
    }
    if (movLib?.Id) {
      STATE.defaultMoviesHash = `#/movies?topParentId=${encodeURIComponent(movLib.Id)}&collectionType=movies&tab=1`;
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

function resolveTvLibSelection(kind) {
  const all = (STATE.tvLibs || []).map(x => x.Id).filter(Boolean);
  if (!all.length) return [];
  const sel = getSelectedTvLibIds(kind);
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

function openLatestPage(type /* Movie|Series|Episode */) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function openResumePage(type /* Movie|Series|Episode */) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function createRecommendationCard(item, serverId, { aboveFold=false, showProgress=false } = {}) {
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  card.dataset.itemId = item.Id;

  const posterSource = item?.__posterSource || item;

  const posterUrlHQ = buildPosterUrlHQ(posterSource);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(posterSource) : "";
  const posterUrlLQ = buildPosterUrlLQ(posterSource);

  const year = item.ProductionYear || posterSource.ProductionYear || "";
  const ageChip = normalizeAgeChip(item.OfficialRating || posterSource.OfficialRating || "");

  const runtimeTicks =
    item.Type === "Series" ? item.CumulativeRunTimeTicks :
    item.Type === "Episode" ? item.RunTimeTicks :
    item.RunTimeTicks;

  const runtime = formatRuntime(runtimeTicks);

  const genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 2).join(", ") : "";
  const isSeries = item.Type === "Series";
  const isEpisode = item.Type === "Episode";

  const typeLabel =
    isEpisode ? (config.languageLabels.episode || "Bölüm") :
    isSeries ? (config.languageLabels.dizi || "Dizi") :
    (config.languageLabels.film || "Film");

  const typeIcon =
    isEpisode ? "🎞️" :
    isSeries ? "🎬" :
    "🎞️";

  const community = Number.isFinite(posterSource.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${posterSource.CommunityRating.toFixed(1)}</div>`
    : "";

  const progress = showProgress ? getPlaybackPercent(item) : 0;
  const progressHtml = (showProgress && progress > 0.02 && progress < 0.999)
    ? `<div class="rr-progress-wrap" aria-label="${escapeHtml(config.languageLabels.progress || "İlerleme")}">
         <div class="rr-progress-bar" style="width:${Math.round(progress*100)}%"></div>
       </div>`
    : "";

  const mainTitle = isEpisode ? (item.SeriesName || posterSource.Name || item.Name) : (item.Name || "");
  const subTitle = isEpisode ? formatEpisodeLabel(item) : "";

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${getDetailsUrl(item.Id, serverId)}">
        <div class="cardImageContainer" style="position:relative;">
          <img class="cardImage"
            alt="${escapeHtml(mainTitle)}"
            loading="${aboveFold ? "eager" : "lazy"}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ""}>
          <div class="prc-top-badges">
            ${community}
            <div class="prc-type-badge">
              <span class="prc-type-icon">${typeIcon}</span>
              ${typeLabel}
            </div>
          </div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-meta">
              ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
              ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
              ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
            </div>
            <div class="prc-genres">
              ${isEpisode
                ? `<div style="font-weight:800;">${escapeHtml(clampText(mainTitle, 42))}</div>
                   ${subTitle ? `<div style="opacity:.9;">${escapeHtml(subTitle)}</div>` : ``}`
                : (genres ? escapeHtml(genres) : "")
              }
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

    try {
      const hostEl = card.querySelector(".cardImageContainer");
      if (hostEl) {
      ensureJmsDetailsOverlay({
        hostEl,
        itemId: item.Id,
        serverId,
        onDetails: async (e) => {
        const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
        await openDetailsModal({
          itemId: item.Id,
          serverId,
          preferBackdropIndex: backdropIndex,
          originEl: hostEl?.querySelector?.('img.cardImage') || hostEl,
          originEvent: e
        });
      },
      onPlay: async () => playNow(item.Id),
      showPlay: false,
    });
  }
} catch {}

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
    if (card.isConnected) attachPreviewByMode(card, { Id: item.Id, Name: item.Name }, mode);
  }, 500);

  card.addEventListener("dblclick", (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof playNow === "function") playNow(item.Id);
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

function createRowHeroCard(item, serverId, labelText) {
  const hero = document.createElement("div");
  hero.className = "dir-row-hero";
  hero.dataset.itemId = item.Id;

  const posterSource = item?.__posterSource || item;
  const bg   = buildBackdropUrlHQ(posterSource) || buildPosterUrlHQ(posterSource) || PLACEHOLDER_URL;
  const logo = buildLogoUrl(posterSource);
  const year = posterSource.ProductionYear || "";
  const plot = clampText(posterSource.Overview, 240);
  const ageChip = normalizeAgeChip(posterSource.OfficialRating || "");
  const isSeries = posterSource.Type === "Series";
  const isEpisode = item.Type === "Episode";

  const runtimeTicks =
    item.Type === "Series" ? (item.CumulativeRunTimeTicks || posterSource.CumulativeRunTimeTicks) :
    item.Type === "Episode" ? (item.RunTimeTicks || posterSource.RunTimeTicks) :
    (item.RunTimeTicks || posterSource.RunTimeTicks);

  const runtime = formatRuntime(runtimeTicks);
  const heroProgress = getPlaybackPercent(item);
  const heroProgressPct = Math.round(heroProgress * 100);
  const heroProgressHtml = (heroProgress > 0.02 && heroProgress < 0.999)
    ? `
      <div class="dir-hero-progress-wrap" aria-label="${escapeHtml(config.languageLabels.progress || "İlerleme")}">
        <div class="dir-hero-progress-bar" style="width:${heroProgressPct}%"></div>
      </div>
      <div class="dir-hero-progress-pct">${heroProgressPct}%</div>
    `
    : "";

  const typeLabel =
    isEpisode ? (config.languageLabels.episode || "Bölüm") :
    isSeries ? (config.languageLabels.dizi || "Dizi") :
    (config.languageLabels.film || "Film");

  const genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 3).join(", ") : "";
  const metaParts = [];
  if (ageChip) metaParts.push(ageChip);
  if (year) metaParts.push(year);
  if (runtime) metaParts.push(getRuntimeWithIcons(runtime));
  if (genres) metaParts.push(genres);

  const meta = metaParts.join(" • ");
  const heroTitle = isEpisode ? (item.SeriesName || posterSource.Name || item.Name) : posterSource.Name;
  const heroSub = isEpisode ? formatEpisodeLabel(item) : "";

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg" src="${bg}" alt="${escapeHtml(heroTitle)}">
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

        ${heroSub
          ? `<div class="dir-row-hero-meta">${escapeHtml(heroSub)}</div>`
          : (meta ? `<div class="dir-row-hero-meta">${escapeHtml(meta)}</div>` : "")
        }

        ${plot ? `<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>` : ""}

        <div class="dir-row-hero-actions">
          <button type="button" class="dir-row-hero-details">
            ${config.languageLabels.details || "Ayrıntılar"}
          </button>
        </div>
      </div>
    </div>
    ${heroProgressHtml}
  `;

  const goDetails = () => {
    try { window.location.hash = getDetailsUrl(item.Id, serverId); }
    catch { window.location.href = getDetailsUrl(item.Id, serverId); }
  };

  hero.addEventListener("click", goDetails);
  hero.classList.add("active");

  const detailsBtn = hero.querySelector('.dir-row-hero-details');
  if (detailsBtn) {
    detailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goDetails();
    });
  }

  try {
    const backdropImg = hero.querySelector(".dir-row-hero-bg");
    const RemoteTrailers =
      posterSource.RemoteTrailers ||
      posterSource.RemoteTrailerItems ||
      posterSource.RemoteTrailerUrls ||
      [];

    createTrailerIframe({
      config,
      RemoteTrailers,
      slide: hero,
      backdropImg,
      itemId: item.Id,
      serverId,
      detailsUrl: getDetailsUrl(item.Id, serverId),
      detailsText: config.languageLabels.details || "Ayrıntılar",
    });
  } catch (err) {
    console.error("RecentRows hero createTrailerIframe hata:", err);
  }

  hero.addEventListener("jms:cleanup", () => {
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

async function fetchRecent(userId, type /* Movie|Series */, limit, parentId /* optional */) {
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
        for (const it of out) await upsertItem(STATE.db, STATE.scope, it);
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: recent fetch error:", type, e);
    return [];
  }
}

async function fetchContinue(userId, type /* Movie|Series */, limit, parentId /* optional */) {
  const url =
    `/Users/${userId}/Items/Resume?` +
    `IncludeItemTypes=${encodeURIComponent(type)}&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(10, limit * 2)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const out = uniqById(items).slice(0, limit);
    try {
      if (STATE.db && STATE.scope) {
        for (const it of out) await upsertItem(STATE.db, STATE.scope, it);
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: continue fetch error:", type, e);
    return [];
  }
}

async function fetchItemsByIds(ids) {
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) return [];
  const chunkSize = 100;
  const out = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const url =
      `/Items?Ids=${encodeURIComponent(chunk.join(","))}` +
      `&Fields=${encodeURIComponent(COMMON_FIELDS)}` +
      `&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;
    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      out.push(...items);
    } catch (e) {
      console.warn("recentRows: fetchItemsByIds error:", e);
    }
  }
  return uniqById(out);
}

async function fetchRecentEpisodes(userId, limit, parentId /* optional */) {
  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Episode&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DateCreated&SortOrder=Descending&Limit=${Math.max(20, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  try {
    const data = await makeApiRequest(url);
    const eps = Array.isArray(data?.Items) ? data.Items : [];
    const uniqEps = uniqById(eps);

    const seriesIds = [];
    for (const ep of uniqEps) {
      const sid = ep?.SeriesId || null;
      if (sid) seriesIds.push(sid);
    }
    const series = await fetchItemsByIds(Array.from(new Set(seriesIds)));
    const byId = new Map(series.map(s => [s.Id, s]));

    const mapped = [];
    for (const ep of uniqEps) {
      const sid = ep?.SeriesId;
      const s = sid ? byId.get(sid) : null;
      if (s) ep.__posterSource = s;
      mapped.push(ep);
      if (mapped.length >= limit) break;
    }
    return mapped;
  } catch (e) {
    console.warn("recentRows: recent episodes fetch error:", e);
    return [];
  }
}

async function fetchContinueEpisodes(userId, limit, parentId /* optional */) {
  const url =
    `/Users/${userId}/Items/Resume?` +
    `IncludeItemTypes=Episode&Recursive=true&Fields=${encodeURIComponent(COMMON_FIELDS)}&` +
    `EnableUserData=true&` +
    (parentId ? `ParentId=${encodeURIComponent(parentId)}&` : ``) +
    `SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(20, limit * 3)}&` +
    `ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo`;

  try {
    const data = await makeApiRequest(url);
    const eps = Array.isArray(data?.Items) ? data.Items : [];
    const uniqEps = uniqById(eps);

    const seriesIds = [];
    for (const ep of uniqEps) {
      const sid = ep?.SeriesId || null;
      if (sid) seriesIds.push(sid);
    }
    const series = await fetchItemsByIds(Array.from(new Set(seriesIds)));
    const byId = new Map(series.map(s => [s.Id, s]));

    const mapped = [];
    for (const ep of uniqEps) {
      const sid = ep?.SeriesId;
      const s = sid ? byId.get(sid) : null;
      if (s) ep.__posterSource = s;
      mapped.push(ep);
      if (mapped.length >= limit) break;
    }
    return mapped;
  } catch (e) {
    console.warn("recentRows: continue episodes fetch error:", e);
    return [];
  }
}

async function attachSeriesPosterSourceToEpisodes(eps) {
  const list = Array.isArray(eps) ? eps : [];
  if (!list.length) return list;

  const seriesIds = [];
  for (const ep of list) {
    const sid = ep?.SeriesId || null;
    if (sid) seriesIds.push(sid);
  }

  const uniqSeriesIds = Array.from(new Set(seriesIds));
  if (!uniqSeriesIds.length) return list;

  const series = await fetchItemsByIds(uniqSeriesIds);
  const byId = new Map(series.map(s => [s.Id, s]));

  for (const ep of list) {
    const sid = ep?.SeriesId;
    const s = sid ? byId.get(sid) : null;
    if (s) ep.__posterSource = s;
  }
  return list;
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
        <span class="material-icons">keyboard_arrow_right</span>
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

  appendSection(wrap, section);
  renderSkeletonRow(row, cardCount);

  let __renderToken = (Date.now() ^ (Math.random()*1e9)) | 0;
  section.__renderToken = __renderToken;

  let cachedItems = [];
  try {
    if (typeof fetcher?.cachedItems === "function") {
      cachedItems = await fetcher.cachedItems();
    }
  } catch {}

  if (cachedItems?.length) {
    try {
      await (async () => {
        const pool = cachedItems.slice();
        const best = pool[0] || null;
        const remaining = best ? pool.filter(x => x?.Id && x.Id !== best.Id) : pool.slice();

        heroHost.innerHTML = "";
        if (best) heroHost.appendChild(createRowHeroCard(best, STATE.serverId, heroLabel));

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
    if (sameIdList(a, b)) return true;
  }

  const pool = items.slice();

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
  if (best) heroHost.appendChild(createRowHeroCard(best, STATE.serverId, heroLabel));

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

  const initialCount = IS_MOBILE ? 3 : 4;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < Math.min(initialCount, remaining.length); i++) {
    fragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, {
      aboveFold: i < 2,
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
  if (hsc) return { parent: hsc, anchor: null };

  const pr = document.getElementById("personal-recommendations");
  if (config.enablePersonalRecommendations && pr) {
    const titleEl =
      pr.querySelector("h2.sectionTitle.sectionTitle-cards.prc-title") ||
      pr.querySelector(".sectionTitleContainer.sectionTitleContainer-cards") ||
      pr.querySelector(".prc-title") ||
      null;

    if (titleEl) {
      return { parent: titleEl.parentElement || pr, anchor: titleEl };
    }
    if (pr.parentElement) {
      return { parent: pr.parentElement, anchor: pr };
    }
  }
  return { parent: document.body, anchor: null };
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
  const { parent, anchor } = pickRecentRowsParentAndAnchor();

  if (wrap.parentElement !== parent) {
    insertAfter(parent, wrap, anchor);
    return true;
  }

  if (anchor && wrap.previousElementSibling !== anchor) {
    insertAfter(parent, wrap, anchor);
    return true;
  }
  return false;
}

export function mountRecentRowsLazy() {
  if (!getActiveHomePage()) {
    cleanupRecentRows();
    return;
  }
  const cfg = getConfig();
  const recentMaster = (cfg.enableRecentRows !== false);
  const anyRecent =
    (recentMaster && (cfg.enableRecentMoviesRow !== false)) ||
    (recentMaster && (cfg.enableRecentSeriesRow !== false)) ||
    (recentMaster && (cfg.enableRecentEpisodesRow !== false));

  const anyEnabled =
    anyRecent ||
    (cfg.enableContinueMovies !== false) ||
    (cfg.enableContinueSeries !== false);

  if (!anyEnabled) return;

  let wrap = document.getElementById("recent-rows");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "recent-rows";
    wrap.className = "homeSection director-rows-wrapper";
  }

  const pin = getPinnedHomeContainer();
  const homeParent = findRealHomeSectionsContainer();
  if (!homeParent) return;
  const pr = document.getElementById("personal-recommendations");

  let parent = (pin && pin.parent) ? pin.parent : homeParent;
  let anchor = (pin && "anchor" in pin) ? pin.anchor : null;
  let usePrepend = false;

  if (!pin) {
    if (pr && pr.isConnected && pr.parentElement === parent) {
      anchor = pr;
    } else {
      usePrepend = true;
    }
  }

  const doInsert = () => {
    if (usePrepend) insertFirst(parent, wrap);
    else insertAfter(parent, wrap, anchor);
  };

  if (!__wrapInserted) {
    doInsert();
    __wrapInserted = true;
  } else {
    if (wrap.parentElement !== parent) {
      try { doInsert(); } catch {}
    } else if (!usePrepend && anchor && wrap.previousElementSibling !== anchor) {
      try { doInsert(); } catch {}
    } else if (usePrepend && wrap !== parent.firstElementChild) {
      try { doInsert(); } catch {}
    }
  }

  const start = () => { try { initAndRender(wrap); } catch (e) { console.error(e); } };
  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", () => setTimeout(start, 0), { once: true });
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
  }
  const { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE.wrapEl = wrap;
  STATE.userId = userId;
  STATE.serverId = serverId;

  await ensureRecentDb();
  await resolveDefaultPages(userId);

  const tasks = [];

  if (ENABLE_RECENT_MOVIES) {
    tasks.push(fillSectionWithItems({
      wrap,
      titleText: config.languageLabels.recentMovies || "Son eklenen filmler",
      badgeType: 'new',
      heroLabel: config.languageLabels.recentMoviesHero || "Son eklenen film",
      cardCount: EFFECTIVE_RECENT_MOVIES_COUNT,
      showProgress: false,
      fetcher: Object.assign(
        () => fetchRecent(userId, "Movie", EFFECTIVE_RECENT_MOVIES_COUNT + 1).then(async (items) => {
          const ids = items.map(x=>x?.Id).filter(Boolean);
          await writeCachedList("recent", "Movie", ids);
          return items;
        }),
        {
          cachedItems: async () => {
            const { ids } = await readCachedList("recent", "Movie", TTL_RECENT_MS);
            if (!ids.length) return [];
            const items = await fetchItemsByIds(ids.slice(0, EFFECTIVE_RECENT_MOVIES_COUNT + 1));
            return items.slice(0, EFFECTIVE_RECENT_MOVIES_COUNT + 1);
          }
        }
      ),
      onSeeAll: () => openLatestPage("Movie")
    }));
  }

  if (ENABLE_RECENT_SERIES) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("recentSeries");

    if (!split) {
      tasks.push(fillSectionWithItems({
        wrap,
        titleText: (config.languageLabels.recentSeries || "Son eklenen diziler"),
        badgeType: 'new',
        heroLabel: (config.languageLabels.recentSeriesHero || "Son eklenen dizi"),
        cardCount: EFFECTIVE_RECENT_SERIES_COUNT,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecent(userId, "Series", EFFECTIVE_RECENT_SERIES_COUNT + 1 /* no parentId */).then(async (items) => {
            await writeCachedList("recent", "Series", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: async () => {
              const { ids } = await readCachedList("recent", "Series", TTL_RECENT_MS);
              if (!ids.length) return [];
              const items = await fetchItemsByIds(ids.slice(0, EFFECTIVE_RECENT_SERIES_COUNT + 1));
              return items.slice(0, EFFECTIVE_RECENT_SERIES_COUNT + 1);
            }
          }
        ),
        onSeeAll: () => openLatestPage("Series")
      }));
    } else {
      for (const tvLibId of tvIds) {
        const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
        tasks.push(fillSectionWithItems({
          wrap,
          titleText: (config.languageLabels.recentSeries || "Son eklenen diziler") + (libName ? ` • ${libName}` : ""),
          badgeType: 'new',
          heroLabel: (config.languageLabels.recentSeriesHero || "Son eklenen dizi") + (libName ? ` • ${libName}` : ""),
          cardCount: EFFECTIVE_RECENT_SERIES_COUNT,
          showProgress: false,
          fetcher: Object.assign(
            () => fetchRecent(userId, "Series", EFFECTIVE_RECENT_SERIES_COUNT + 1, tvLibId).then(async (items) => {
              await writeCachedList("recent", "Series" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: async () => {
                const { ids } = await readCachedList("recent", "Series" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS);
                if (!ids.length) return [];
                const items = await fetchItemsByIds(ids.slice(0, EFFECTIVE_RECENT_SERIES_COUNT + 1));
                return items.slice(0, EFFECTIVE_RECENT_SERIES_COUNT + 1);
              }
            }
          ),
          onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`)
        }));
      }
    }
  }

  if (ENABLE_RECENT_EPISODES) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("recentEpisodes");

    if (!split) {
      tasks.push(fillSectionWithItems({
        wrap,
        titleText: (config.languageLabels.recentEpisodes || "Son eklenen bölümler"),
        badgeType: 'new',
        heroLabel: (config.languageLabels.recentEpisodesHero || "Son eklenen bölüm"),
        cardCount: EFFECTIVE_RECENT_EP_CNT,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecentEpisodes(userId, EFFECTIVE_RECENT_EP_CNT + 1 /* no parentId */).then(async (items) => {
            await writeCachedList("recent", "Episode", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: async () => {
              const { ids } = await readCachedList("recent", "Episode", TTL_RECENT_MS);
              if (!ids.length) return [];
              const eps = await fetchItemsByIds(ids.slice(0, EFFECTIVE_RECENT_EP_CNT + 1));
              await attachSeriesPosterSourceToEpisodes(eps);
              return eps.slice(0, EFFECTIVE_RECENT_EP_CNT + 1);
            }
          }
        ),
        onSeeAll: () => openLatestPage("Episode")
      }));
    } else {
      for (const tvLibId of tvIds) {
      const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
      tasks.push(fillSectionWithItems({
        wrap,
        titleText: (config.languageLabels.recentEpisodes || "Son eklenen bölümler") + (libName ? ` • ${libName}` : ""),
        badgeType: 'new',
        heroLabel: (config.languageLabels.recentEpisodesHero || "Son eklenen bölüm") + (libName ? ` • ${libName}` : ""),
        cardCount: EFFECTIVE_RECENT_EP_CNT,
        showProgress: false,
        fetcher: Object.assign(
          () => fetchRecentEpisodes(userId, EFFECTIVE_RECENT_EP_CNT + 1, tvLibId).then(async (items) => {
            await writeCachedList("recent", "Episode" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: async () => {
              const { ids } = await readCachedList("recent", "Episode" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS);
              if (!ids.length) return [];
              const eps = await fetchItemsByIds(ids.slice(0, EFFECTIVE_RECENT_EP_CNT + 1));
              await attachSeriesPosterSourceToEpisodes(eps);
              return eps.slice(0, EFFECTIVE_RECENT_EP_CNT + 1);
            }
          }
        ),
        onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`)
      }));
      }
    }
  }

  if (ENABLE_CONTINUE_MOVIES) {
    tasks.push(fillSectionWithItems({
      wrap,
      titleText: config.languageLabels.continueMovies || "Film izlemeye devam et",
      badgeType: 'continue',
      heroLabel: config.languageLabels.continueMoviesHero || "İzlemeye devam (Film)",
      cardCount: EFFECTIVE_CONT_MOV_CNT,
      showProgress: true,
      fetcher: Object.assign(
        () => fetchContinue(userId, "Movie", EFFECTIVE_CONT_MOV_CNT + 1).then(async (items) => {
          await writeCachedList("resume", "Movie", items.map(x=>x?.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: async () => {
            const { ids } = await readCachedList("resume", "Movie", TTL_CONTINUE_MS);
            if (!ids.length) return [];
            const items = await fetchItemsByIds(ids.slice(0, EFFECTIVE_CONT_MOV_CNT + 1));
            return items.slice(0, EFFECTIVE_CONT_MOV_CNT + 1);
          }
        }
      ),
      onSeeAll: () => openResumePage("Movie"),
      randomHero: true,
    }));
  }

  if (ENABLE_CONTINUE_SERIES) {
    const split = (getConfig()?.recentRowsSplitTvLibs !== false);
    const tvIds = resolveTvLibSelection("continueSeries");

    if (!split) {
      tasks.push(fillSectionWithItems({
        wrap,
        titleText: (config.languageLabels.continueSeries || "Dizi izlemeye devam et"),
        badgeType: 'continue',
        heroLabel: (config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)"),
        cardCount: EFFECTIVE_CONT_SER_CNT,
        showProgress: true,
        fetcher: Object.assign(
          () => fetchContinueEpisodes(userId, EFFECTIVE_CONT_SER_CNT + 1 /* no parentId */).then(async (items) => {
            await writeCachedList("resume", "Episode", items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: async () => {
              const { ids } = await readCachedList("resume", "Episode", TTL_CONTINUE_MS);
              if (!ids.length) return [];
              const eps = await fetchItemsByIds(ids.slice(0, EFFECTIVE_CONT_SER_CNT + 1));
              await attachSeriesPosterSourceToEpisodes(eps);
              return eps.slice(0, EFFECTIVE_CONT_SER_CNT + 1);
            }
          }
        ),
        onSeeAll: () => openResumePage("Episode"),
        randomHero: true,
      }));
    } else {
      for (const tvLibId of tvIds) {
      const libName = (STATE.tvLibs || []).find(x => x.Id === tvLibId)?.Name || "";
      tasks.push(fillSectionWithItems({
        wrap,
        titleText: (config.languageLabels.continueSeries || "Dizi izlemeye devam et") + (libName ? ` • ${libName}` : ""),
        badgeType: 'continue',
        heroLabel: (config.languageLabels.continueSeriesHero || "İzlemeye devam (Dizi)") + (libName ? ` • ${libName}` : ""),
        cardCount: EFFECTIVE_CONT_SER_CNT,
        showProgress: true,
        fetcher: Object.assign(
          () => fetchContinueEpisodes(userId, EFFECTIVE_CONT_SER_CNT + 1, tvLibId).then(async (items) => {
            await writeCachedList("resume", "Episode" + tvLibMetaSuffix(tvLibId), items.map(x=>x?.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: async () => {
              const { ids } = await readCachedList("resume", "Episode" + tvLibMetaSuffix(tvLibId), TTL_CONTINUE_MS);
              if (!ids.length) return [];
              const eps = await fetchItemsByIds(ids.slice(0, EFFECTIVE_CONT_SER_CNT + 1));
              await attachSeriesPosterSourceToEpisodes(eps);
              return eps.slice(0, EFFECTIVE_CONT_SER_CNT + 1);
            }
          }
        ),
        onSeeAll: () => gotoHash(`#/tv?topParentId=${encodeURIComponent(tvLibId)}&collectionType=tvshows&tab=1`),
        randomHero: true,
      }));
      }
    }
  }

  if (tasks.length) {
    await Promise.allSettled(tasks);
  }

  if (!wrap.querySelector(".recent-row-section")) {
    try { wrap.parentElement?.removeChild(wrap); } catch {}
  }
}

export function cleanupRecentRows() {
  try {
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
    __wrapInserted = false;
  } catch (e) {
    console.warn("recent rows cleanup error:", e);
  }
}

function getHomeSectionsContainer(indexPage) {
  const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    document.body;

  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    page;
}

(function bindRecentRowsRouteGuard() {
  if (window.__jmsRecentRowsRouteGuard) return;
  window.__jmsRecentRowsRouteGuard = true;

  const tick = () => {
    if (getActiveHomePage()) mountRecentRowsLazy();
    else cleanupRecentRows();
  };

  window.addEventListener("hashchange", () => setTimeout(tick, 0), { passive: true });
  window.addEventListener("popstate",  () => setTimeout(tick, 0), { passive: true });

  setTimeout(tick, 0);
})();

window.addEventListener("online", () => {
  document.querySelectorAll("img.is-lqip").forEach(img => {
    try { scheduleImgRetry(img, img.__phase === "hi" ? "hi" : "lq", 300); } catch {}
  });
});
