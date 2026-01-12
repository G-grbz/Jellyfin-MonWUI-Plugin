import { saveCredentials, saveApiKey, getAuthToken } from "./auth.js";
import { getConfig } from "./modules/config.js";
import { getCurrentIndex, setCurrentIndex } from "./modules/sliderState.js";
import { startSlideTimer, stopSlideTimer } from "./modules/timer.js";
import { ensureProgressBarExists, resetProgressBar } from "./modules/progressBar.js";
import { createSlide } from "./modules/slideCreator.js";
import { changeSlide, createDotNavigation, primePeakFirstPaint, updatePeakClasses } from "./modules/navigation.js";
import { attachMouseEvents } from "./modules/events.js";
import { fetchItemDetails as fetchItemDetailsNet, getSessionInfo, getAuthHeader, waitForAuthReadyStrict, isAuthReadyStrict, withServer } from "./modules/api.js";
import {
  cachedFetchJson,
  cachedFetchText,
  createCachedItemDetailsFetcher,
  startLibraryDeltaWatcher
} from "./modules/sliderCache.js";
import { forceHomeSectionsTop, forceSkinHeaderPointerEvents } from "./modules/positionOverrides.js";
import { setupPauseScreen } from "./modules/pauseModul.js";
import { updateHeaderUserAvatar, initAvatarSystem } from "./modules/userAvatar.js";
import { initializeQualityBadges, primeQualityFromItems, annotateDomWithQualityHints } from "./modules/qualityBadges.js";
import { initNotifications, forcejfNotifBtnPointerEvents } from "./modules/notifications.js";
import { startUpdatePolling } from "./modules/update.js";
import { ensureStudioHubsMounted } from "./modules/studioHubs.js";
import { updateSlidePosition } from "./modules/positionUtils.js";
import { renderPersonalRecommendations } from "./modules/personalRecommendations.js";
import { mountDirectorRowsLazy } from "./modules/directorRows.js";
import { setupHoverForAllItems  } from "./modules/hoverTrailerModal.js";
import { teardownAnimations } from "./modules/animations.js";
import { mountRecentRowsLazy, cleanupRecentRows } from "./modules/recentRows.js";

const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
window.__totalSlidesPlanned = 0;
window.__slidesCreated = 0;
window.__cycleStartAt = 0;
window.__cycleArmTimeout = null;
window.__cycleExpired = window.__cycleExpired || false;
window.__peakBooting = true;

(function earlyCssBoot(){
  const D = document;
  const HEAD = D.head || D.documentElement;
  const criticalCSS = `
    html[data-jms-notif="0"] .skinHeader .headerRight #jfNotifBtn { display:none !important; }
    .skinHeader .headerRight #jfNotifBtn { order: -9999; }
   `;
  if (!D.getElementById('jms-critical-css')) {
    const s = D.createElement('style');
    s.id = 'jms-critical-css';
    s.textContent = criticalCSS;
    HEAD.prepend(s);
  }

  function addCSS(href, id){
    if (!href || D.getElementById(id)) return;
    const l = D.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    const normalized =
      (typeof href === 'string' && href.startsWith('/slider/'))
        ? ('/web' + href)
        : href;
    l.href = (typeof withServer === 'function') ? withServer(normalized) : normalized;
    try { l.fetchPriority = 'high'; } catch {}
    l.setAttribute('fetchpriority','high');
    HEAD.prepend(l);
  }

  function getCssVariant() {
    try {
      if (typeof getConfig === 'function') {
        const cfg = getConfig() || {};
        return cfg.cssVariant || 'normalslider';
      }
    } catch {}
    try {
      const cfg = JSON.parse(localStorage.getItem('jms-config')||'{}');
      return cfg.cssVariant || 'normalslider';
    } catch {}
    return 'normalslider';
  }

  const variant = getCssVariant();
  addCSS('/slider/src/notifications.css', 'jms-css-notifications');
  addCSS('/slider/src/pauseModul.css', 'jms-css-pause');
  addCSS('/slider/src/personalRecommendations.css', 'jms-css-recs');
  addCSS('/slider/src/studioHubs.css', 'jms-css-studiohubs');
  addCSS('/slider/src/detailsModal.css', 'jms-css-detailsModal');
  addCSS('/slider/src/studioHubsMini.css', 'jms-css-studioHubsMini');

  const vmap = {
    peakslider: '/slider/src/peakslider.css',
    fullslider: '/slider/src/fullslider.css',
    normalslider: '/slider/src/normalslider.css',
    slider: '/slider/src/slider.css'
  };
  addCSS(vmap[variant] || vmap.normalslider, 'jms-css-variant');

  document.documentElement.dataset.cssVariant =
    variant === 'slider' ? 'slider' : variant;
  window.__cssVariant = document.documentElement.dataset.cssVariant;
  try {
    const cfg = (typeof getConfig === 'function' ? getConfig() : {}) || {};
    document.documentElement.setAttribute('data-jms-notif', cfg.enableNotifications ? '1' : '0');
  } catch {}
})();

(async function requestPersistentStorageOnce(){
  try {
    const supported = !!(navigator.storage && navigator.storage.persist);
    if (!supported) return;
    const already = await navigator.storage.persisted();
    if (already) return;
    await navigator.storage.persist().catch(()=>{});
  } catch {}
})();

async function waitAuthWarmupFallback(maxMs = 5000){
  try {
    if (typeof isAuthReadyStrict === "function" && isAuthReadyStrict()) return true;
    if (typeof waitForAuthReadyStrict === "function") {
      return await waitForAuthReadyStrict(maxMs);
    }
  } catch {}
  return false;
}

async function waitForStylesReady() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .filter(l => !l.disabled);
  await Promise.all(links.map(l => {
    if (l.sheet) return Promise.resolve();
    return new Promise(res => {
      l.addEventListener('load', res, { once:true });
      l.addEventListener('error', res, { once:true });
      setTimeout(res, 2000);
    });
  }));
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }
}

function clearCycleArm() {
  try { clearTimeout(window.__cycleArmTimeout); } catch {}
  window.__cycleArmTimeout = null;
}

function getPerSlideDurationMs() {
  const pb = document.querySelector(".slide-progress-bar");
  if (pb) {
    const raw = getComputedStyle(pb).getPropertyValue("--slide-duration-ms");
    const v = parseInt(raw, 10);
    if (Number.isFinite(v) && v > 0) return v;
    const td = getComputedStyle(pb).transitionDuration;
    if (td && td.endsWith("s")) {
      const sec = parseFloat(td);
      if (sec > 0) return Math.round(sec * 1000);
    }
  }
  const cfg = getConfig?.() || {};
  return Number.isFinite(cfg.sliderDuration) ? cfg.sliderDuration
       : Number.isFinite(cfg.slideDurationMs) ? cfg.slideDurationMs
       : Number.isFinite(cfg.autoSlideIntervalMs) ? cfg.autoSlideIntervalMs
       : 15000;
}

function getCycleDurationMs() {
  const per = getPerSlideDurationMs();
  const total = getPlannedTotalSlides();
  return per * total;
}

function armCycleReset() {
  clearCycleArm();
  const cycleMs = getCycleDurationMs();
  const elapsed = Math.max(0, Date.now() - (window.__cycleStartAt || 0));
  const remain = Math.max(0, cycleMs - elapsed);

  window.__cycleArmTimeout = setTimeout(() => {
  window.__cycleExpired = true;
  }, remain);
}

function startNewCycleClock() {
  window.__cycleStartAt = Date.now();
  window.__cycleExpired = false;
  armCycleReset();
}

function markSlideCreated() {
  window.__slidesCreated = (window.__slidesCreated || 0) + 1;
  if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
    try {
      document.dispatchEvent(new CustomEvent("jms:all-slides-ready"));
    } catch {}
  }
}

function hardProgressReset() {
  ensureProgressBarExists();
  const pb = document.querySelector(".slide-progress-bar");
  if (!pb) return;
  console.debug("[JMS] hardProgressReset()");
  pb.style.transition = "none";
  pb.style.animation = "none";
  pb.style.width = "0%";
  pb.style.opacity = "1";
  void pb.offsetWidth;
  try { resetProgressBar?.(); } catch {}
  const newPb = pb.cloneNode(true);
  pb.replaceWith(newPb);
}

function getPlannedTotalSlides() {
  let n = parseInt(window.__totalSlidesPlanned || "0", 10);
  if (!Number.isFinite(n) || n <= 0) {
    const ls = parseInt(localStorage.getItem("limit") || "0", 10);
    if (Number.isFinite(ls) && ls > 0) n = ls;
  }
  if ((!Number.isFinite(n) || n <= 0) && typeof getConfig === "function") {
    const cfg = getConfig();
    const c = parseInt(cfg?.limit || cfg?.savedLimit || "0", 10);
    if (Number.isFinite(c) && c > 0) n = c;
  }
  return Math.max(1, n);
}

function getPlannedLastIndex() {
  return getPlannedTotalSlides() - 1;
}

function isPlannedLastIndex(idx) {
  return Number.isFinite(idx) && idx === getPlannedLastIndex();
}

async function scheduleSliderRebuild(reason = "cycle-complete") {
  if (window.__rebuildingSlider) return;
  window.__rebuildingSlider = true;
  try {
    clearCycleArm();
    window.__cycleExpired = false;
    try { teardownAnimations(); } catch {}
    try { window.__cleanupActiveWatch?.(); } catch {}
    try { window.cleanupModalObserver?.(); } catch {}
    try { stopSlideTimer?.(); } catch {}
    try { hardProgressReset?.(); } catch {}
    try { fullSliderReset(); } catch {}
    document.querySelectorAll(".dot-navigation-container").forEach(n => n.remove());
    await new Promise(r => setTimeout(r, 30));
    window.__initOnHomeOnce = false;
    initializeSliderOnHome();
  } finally {
    window.__rebuildingSlider = false;
  }
}

function getSlidesNodeList() {
  const idxPage = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  return idxPage ? idxPage.querySelectorAll(".slide") : null;
}
function getSlideIndex(el) {
  const slides = getSlidesNodeList();
  return slides ? Array.from(slides).indexOf(el) : -1;
}
function getTotalSlides() {
  const slides = getSlidesNodeList();
  return slides ? slides.length : 0;
}
function isLastIndex(i) {
  const total = getTotalSlides();
  return total > 0 && i === total - 1;
}

function getSlideDurationMs() {
  const pb = document.querySelector(".slide-progress-bar");
  if (pb) {
    const raw = getComputedStyle(pb).getPropertyValue("--slide-duration-ms");
    const v = parseInt(raw, 10);
    if (Number.isFinite(v) && v > 0) return v;
    const td = getComputedStyle(pb).transitionDuration;
    if (td && td.endsWith("s")) {
      const sec = parseFloat(td);
      if (sec > 0) return Math.round(sec * 1000);
    }
  }

  if (config && Number.isFinite(config.autoSlideIntervalMs)) return config.autoSlideIntervalMs;
  if (config && Number.isFinite(config.slideDurationMs)) return config.slideDurationMs;
  return 15000;
}

(function applySafePauseShim() {
  try {
    if (window.__safePauseShim) return;
    window.__safePauseShim = true;
    const EP = window.Element && window.Element.prototype;
    if (!EP) return;
    if (!("pause" in EP)) {
      Object.defineProperty(EP, "pause", {
        value: function pause() {},
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  } catch (err) {
    console.warn("safePauseShim init error:", err);
  }
})();

const config = getConfig();
let cleanupPauseOverlay = null;
let pauseBooted = false;
let navObsBooted = false;
window.sliderResetInProgress = window.sliderResetInProgress || false;
window.__slidesInitRunning = window.__slidesInitRunning || false;
window.__shuffleSavedThisLoad = false;

function startPauseOverlayOnce() {
  if (pauseBooted) return;
  cleanupPauseOverlay = setupPauseScreen();
  pauseBooted = true;
}
function restartPauseOverlay() {
  if (cleanupPauseOverlay) {
    try {
      cleanupPauseOverlay();
    } catch {}
  }
  pauseBooted = false;
  startPauseOverlayOnce();
}

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

function isHomeVisible() {
  return !!document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
}

function uniqueByIdStable(arr) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const id = it && (it.Id || it.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

function setupGlobalModalInit() {
  setupHoverForAllItems();
  idle(() => {
    if (!window.hls) loadHls().catch(() => {});
  });
  const observer = observeDOMChanges();
  return () => observer.disconnect();
}
const cleanupModalObserver = setupGlobalModalInit();
window.cleanupModalObserver = cleanupModalObserver;

forceSkinHeaderPointerEvents();
forceHomeSectionsTop();
const NOTIF_ENABLED = !!(config && config.enableNotifications);
 forcejfNotifBtnPointerEvents();
 updateHeaderUserAvatar();
 if (NOTIF_ENABLED) {
   initNotifications();
 } else {
   document.getElementById('jfNotifBtn')?.remove();
   document.getElementById('jfNotifModal')?.remove();
   document.querySelector('.jf-notif-panel')?.remove();
   document.documentElement.dataset.jmsNotif = '0';
 }

document.addEventListener("DOMContentLoaded", () => {
  if (config.enableQualityBadges && !window.__qualityBadgesBooted) {
    window.__qualityBadgesBooted = true;
    try {
      window.cleanupQualityBadges = initializeQualityBadges();
    } catch {}
  }
});

window.__recsRebuildTimer = window.__recsRebuildTimer || null;

function schedulePersonalRecsReinit(delayMs = 10000) {
  try { clearTimeout(window.__recsRebuildTimer); } catch {}
  window.__recsRebuildTimer = setTimeout(() => {
    try {
      const cfg = (typeof getConfig === 'function' ? getConfig() : {}) || {};

      if (cfg.enablePersonalRecommendations || cfg.enableGenreHubs) {
        renderPersonalRecommendations();
      }

      if (cfg.enableDirectorRows && typeof mountDirectorRowsLazy === 'function') {
        mountDirectorRowsLazy();
      }

      if (cfg.enableRecentRows && typeof mountRecentRowsLazy === 'function') {
        mountRecentRowsLazy();
      }

    } catch (e) {
      console.warn("schedulePersonalRecsReinit hata:", e);
    }
  }, Math.max(0, delayMs|0));
}

function fullSliderReset() {
  try { teardownAnimations(); } catch {}
  forceSkinHeaderPointerEvents();
  forceHomeSectionsTop();

  if (window.intervalChangeSlide) {
    clearInterval(window.intervalChangeSlide);
    window.intervalChangeSlide = null;
  }
  if (window.sliderTimeout) {
    clearTimeout(window.sliderTimeout);
    window.sliderTimeout = null;
  }
  if (window.autoSlideTimeout) {
    clearTimeout(window.autoSlideTimeout);
    window.autoSlideTimeout = null;
  }

  setCurrentIndex(0);
  stopSlideTimer();
  cleanupSlider();
  clearCycleArm();
  try { window.__peakBooting = true; } catch {}
  window.__cycleStartAt = 0;
  window.__cycleExpired = false;
  window.mySlider = {};
  window.cachedListContent = "";
  try { delete window.__recsWiresBooted; } catch {}
  try { schedulePersonalRecsReinit(5000); } catch {}
}

function extractItemTypesFromQuery(query) {
  const match = query.match(/IncludeItemTypes=([^&]+)/i);
  if (!match) return [];
  return match[1].split(",").map((t) => t.trim());
}
function hasAllTypes(targetTypes, requiredTypes) {
  return requiredTypes.every((t) => targetTypes.includes(t));
}

function parseImageTypesFromQuery(query) {
  if (!query) return [];
  const m = query.match(/(?:^|[?&])imageTypes=([^&]+)/i);
  if (!m) return [];
  return decodeURIComponent(m[1])
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function itemHasImageType(item, type) {
  if (!item) return false;
  const tags = item.ImageTags || {};
  const lower = String(type).toLowerCase();
  if (lower === "logo") {
    return !!(tags.Logo || tags.Logotype);
  }

  if (lower === "backdrop") {
    const b = item.BackdropImageTags || [];
    if (Array.isArray(b) && b.length > 0) return true;
    return !!tags.Backdrop;
  }

  const key =
    type in tags
      ? type
      : type.charAt(0).toUpperCase() + type.slice(1);
  return !!tags[key];
}

function filterByStrictImageTypes(items, query) {
  const requested = parseImageTypesFromQuery(query);
  if (!requested.length) return items;
  return items.filter((it) =>
    requested.every((t) => itemHasImageType(it, t))
  );
}

export async function loadHls() {
  if (window.hls) return;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = (typeof withServer === 'function')
      ? withServer(`/web/slider/modules/hlsjs/hls.min.js`)
      : `/web/slider/modules/hlsjs/hls.min.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("hls yüklenemedi"));
    document.head.appendChild(script);
  });
}

function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    if (document.documentElement.dataset.jmsSoftBlock === "1") return;
    mutations.forEach((mutation) => {
      if (!mutation.addedNodes.length) return;
      const relevantContainers = ["cardImageContainer"];

      const isRelevant = Array.from(mutation.addedNodes).some((node) => {
        if (node.nodeType === 1 && relevantContainers.some((c) => node.classList?.contains(c))) {
          return true;
        }
        return relevantContainers.some((c) => node.querySelector?.(`.${c}`));
      });

      if (isRelevant) {
        setupHoverForAllItems();
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-id", "class"],
  });

  return observer;
}

function hydrateSlideMedia(slide) {
  if (!slide) return;
  slide
    .querySelectorAll("img[data-src],img[data-lazy],img[data-original],img[data-image]")
    .forEach((img) => {
      const src =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy") ||
        img.getAttribute("data-original") ||
        img.getAttribute("data-image");
      if (src && !img.src) {
        img.src = src;
        img.removeAttribute("data-src");
        img.removeAttribute("data-lazy");
        img.removeAttribute("data-original");
        img.removeAttribute("data-image");
      }
    });
  const overlay = slide.querySelector(".gradient-overlay");
  let bg =
    slide.getAttribute("data-backdrop") ||
    slide.getAttribute("data-bg") ||
    slide.getAttribute("data-bg-src") ||
    overlay?.getAttribute("data-backdrop") ||
    overlay?.getAttribute("data-bg") ||
    overlay?.getAttribute("data-bg-src");
    if (overlay && bg && !overlay.style.backgroundImage) {
    overlay.style.backgroundImage = `url("${bg}")`;
  }
  slide.querySelectorAll("[data-backdrop],[data-bg],[data-bg-src]").forEach((el) => {
    const u = el.getAttribute("data-backdrop") || el.getAttribute("data-bg") || el.getAttribute("data-bg-src");
    if (u && !el.style.backgroundImage) el.style.backgroundImage = `url("${u}")`;
  });
  slide.style.visibility = "visible";
  slide.removeAttribute("aria-hidden");
  slide.style.opacity = "";
  slide.style.filter = "";
  slide.style.display = "";
  slide.classList.remove("lazyloaded", "lazyload");
  slide.classList.remove("is-loading", "hidden", "hide");
}

function safeRaf(fn) {
  return requestAnimationFrame(() => requestAnimationFrame(fn));
}
function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function upsertSlidesContainerAtTop(indexPage) {
  if (!indexPage) return null;
  let c = indexPage.querySelector("#slides-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "slides-container";
  } else {
    if (c.parentElement) c.parentElement.removeChild(c);
  }

  const deepAnchor = indexPage.querySelector(".homeSectionsContainer");
  let anchorTop = null;
  if (deepAnchor) {
    let cur = deepAnchor;
    while (cur && cur.parentElement && cur.parentElement !== indexPage) {
      cur = cur.parentElement;
    }
    if (cur && cur.parentElement === indexPage) {
      anchorTop = cur;
    }
  }

  if (anchorTop) {
    indexPage.insertBefore(c, anchorTop);
  } else if (indexPage.firstElementChild) {
    indexPage.insertBefore(c, indexPage.firstElementChild);
  } else {
    indexPage.appendChild(c);
  }
  try {
    updateSlidePosition();
  } catch {}
  return c;
}

function isVisible(el) {
  if (!el) return false;
  if (el.classList?.contains("hide")) return false;
  const rect = el.getBoundingClientRect?.();
  return !!rect && rect.width >= 1 && rect.height >= 1;
}

export function waitForAnyVisible(selectors, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const check = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          cleanup();
          resolve(el);
          return true;
        }
      }
      return false;
    };
    const mo = new MutationObserver(() => {
      check();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const to = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);
    function cleanup() {
      clearTimeout(to);
      mo.disconnect();
    }
    if (check()) return;
  });
}

async function waitForVisibleIndexPage(timeout = 20000) {
  const candidates = ["#indexPage:not(.hide)", "#homePage:not(.hide)", ".homeSectionsContainer"];
  return await waitForAnyVisible(candidates, { timeout });
}

function isAbs(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function normalizeWithServer(u) {
  const s = String(u || "").trim();
  if (!s) return s;
  if (isAbs(s)) return s;
  if (s.startsWith("/slider/")) return withServer("/web" + s);
  if (s.startsWith("slider/"))  return withServer("/web/" + s);
  if (s.startsWith("/web/")) return withServer(s);
  if (s.startsWith("/")) return withServer(s);
  return s;
}

function safeFetch(url, opts) {
  const finalUrl = normalizeWithServer(url);
  return fetch(finalUrl, opts);
}

async function fetchJsonViaSafeFetch(url, opts){
  const res = await safeFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}
async function fetchTextViaSafeFetch(url, opts){
  const res = await safeFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function looksLikeUrl(v) {
  return typeof v === "string" && (v.startsWith("http") || v.startsWith("/") || v.includes("/Items/"));
}

function setBg(el, url) {
  if (!el || !url) return;
  const wrapped = `url("${url}")`;
  el.style.setProperty("--bg-url", wrapped);
  if (!el.style.backgroundImage || !el.style.backgroundImage.includes(url)) {
    el.style.backgroundImage = wrapped;
  }
  if (!el.style.backgroundSize) el.style.backgroundSize = "cover";
  if (!el.style.backgroundPosition) el.style.backgroundPosition = "50% 50%";
}

function hydrateFirstSlide(indexPage) {
  if (!indexPage) return;
  const firstActive = indexPage.querySelector(".slide.active") || indexPage.querySelector(".slide");
  if (!firstActive) return;

  firstActive.style.visibility = "visible";
  firstActive.removeAttribute("aria-hidden");
  firstActive.style.opacity = "";
  firstActive.classList.remove("is-loading", "hidden", "hide", "lazyload", "lazyloaded");

  const imgs = firstActive.querySelectorAll("img, picture img");
  imgs.forEach((img) => {
    const ds = img.getAttribute("data-src");
    if (ds && img.src !== ds) img.src = ds;
    const dss = img.getAttribute("data-srcset");
    if (dss && img.srcset !== dss) img.srcset = dss;
    if (img.loading === "lazy") img.loading = "eager";
    img.removeAttribute("loading");
    img.style.visibility = "visible";
    img.style.opacity = "";
  });

  const sources = firstActive.querySelectorAll("source");
  sources.forEach((s) => {
    const dss = s.getAttribute("data-srcset");
    if (dss && s.srcset !== dss) s.srcset = dss;
  });

  const bgCandidates = [
    firstActive.querySelector(".horizontal-gradient-overlay"),
    firstActive.querySelector(".slide-backdrop"),
    firstActive.querySelector(".backdrop"),
    firstActive.querySelector(".background"),
    firstActive,
  ].filter(Boolean);

  let urlFromDataset = "";
  const ds = firstActive.dataset || {};
  for (const [k, v] of Object.entries(ds)) {
    if (looksLikeUrl(v)) {
      urlFromDataset = v;
      break;
    }
  }
  const attrKeys = ["data-bg", "data-backdrop", "data-bg-src", "data-image", "data-poster", "data-img", "data-src"];
  let urlFromAttr = "";
  for (const key of attrKeys) {
    const v = firstActive.getAttribute(key);
    if (looksLikeUrl(v)) {
      urlFromAttr = v;
      break;
    }
  }
  const finalUrl = urlFromDataset || urlFromAttr;
  bgCandidates.forEach((el) => setBg(el, finalUrl));
}

function primeProgressBar(indexPage) {
  if (!indexPage) return;
  const pb = indexPage.querySelector(".slide-progress-bar");
  if (!pb) return;
  try {
    resetProgressBar?.();
  } catch {}
  pb.style.transition = "none";
  pb.style.opacity = "0";
  pb.style.width = "0%";
  void pb.offsetWidth;
  pb.style.transition = "";
}

function ensureInitialActivation(indexPage) {
  if (!indexPage) return;
  const slides = indexPage.querySelectorAll(".slide");
  if (!slides.length) return;
  const cur = getCurrentIndex();
  const idx = Number.isFinite(cur) && cur >= 0 ? cur : 0;
  setCurrentIndex(idx);
  slides.forEach((s, i) => s.classList.toggle("active", i === idx));
}

function triggerSlideEnterHooks(indexPage) {
  const active = indexPage.querySelector(".slide.active") || indexPage.querySelector(".slide");
  if (!active) return;
  try {
    if (typeof changeSlide === "function") changeSlide(0);
  } catch {}
  try {
    active.dispatchEvent(new CustomEvent("jms:slide-enter", { bubbles: true }));
  } catch {}
}

function startTimerAndRevealPB(indexPage) {
  if (!indexPage) return;
  const pb = indexPage.querySelector(".slide-progress-bar");
  startSlideTimer();
  safeRaf(() => {
    if (pb) pb.style.opacity = "1";
  });
}

function restartSlideTimerDeterministic() {
  console.debug("[JMS] restartSlideTimerDeterministic()");
  hardProgressReset();
   try {
     if (window.intervalChangeSlide) { clearInterval(window.intervalChangeSlide); window.intervalChangeSlide = null; }
     if (window.sliderTimeout)      { clearTimeout(window.sliderTimeout);       window.sliderTimeout = null; }
     if (window.autoSlideTimeout)   { clearTimeout(window.autoSlideTimeout);    window.autoSlideTimeout = null; }
   } catch {}

  try { stopSlideTimer(); } catch {}
   try { startSlideTimer(); } catch {}
}

function watchActiveSlideChanges() {
  let lastActive = document.querySelector("#indexPage:not(.hide) .slide.active, #homePage:not(.hide) .slide.active");

  const hardResetNextFrame = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        hardProgressReset();
        restartSlideTimerDeterministic();
        try { warmUpcomingBackdrops(4); } catch {}
      });
    });
  };

  const handleChange = () => {
    const cur = document.querySelector("#indexPage:not(.hide) .slide.active, #homePage:not(.hide) .slide.active");
    if (!cur || cur === lastActive) return;
    hardResetNextFrame();
    const curIdx = getSlideIndex(cur);
    lastActive = cur;
  };

  const mo = new MutationObserver(handleChange);
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  handleChange();
  return () => mo.disconnect();
}

function warmUpcomingBackdrops(count = 3) {
  try {
    const indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) return;

    const slides = [...indexPage.querySelectorAll(".slide")];
    const active = indexPage.querySelector(".slide.active") || slides[0];
    const i = slides.indexOf(active);
    for (let k = 1; k <= count; k++) {
      const s = slides[i + k];
      if (!s) break;
      const candidate =
        s.dataset.background ||
        s.dataset.backdropUrl ||
        s.dataset.landscapeUrl ||
        s.dataset.primaryUrl;
      if (candidate) {
        try {
          window.__backdropWarmQueue?.enqueue(candidate, { shortPreload: true });
        } catch {}
      }
    }
  } catch {}
}

export async function slidesInit() {
  if (window.__slidesInitRunning) {
    console.debug("[JMS] slidesInit() skipped (already running)");
    return;
  }
   if (!isHomeVisible()) {
    console.debug("[JMS] slidesInit() skipped (home not visible)");
    return;
  }
  window.__slidesInitRunning = true;
  window.__shuffleSavedThisLoad = false;
  try {
    await waitAuthWarmupFallback(5000);
  } catch {}
  try {
    forceSkinHeaderPointerEvents();
    forceHomeSectionsTop();

    if (window.sliderResetInProgress) return;
    window.sliderResetInProgress = true;
    fullSliderReset();

    let userId = null, accessToken = null;
    let fetchItemDetailsCached = window.__jmsFetchItemDetailsCached || null;

    function isQuotaErr(e){ return e && (e.name === 'QuotaExceededError' || e.code === 22); }

    function safeLocalGet(key, fallback="[]"){
      try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    }

    function safeLocalRemove(key){
      try { localStorage.removeItem(key); } catch {}
    }

    function safeLocalSet(key, value){
      try { localStorage.setItem(key, value); return true; }
      catch(e){
        if(!isQuotaErr(e)) return false;
        try { sessionStorage.setItem(key, value); return true; } catch {}
        try { localStorage.removeItem(key); } catch {}
        return false;
      }
    }

    function getShuffleHistory(userId) {
      const key = `slider-shuffle-history-${userId}`;
      try {
        const raw = safeLocalGet(key, "[]");
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }

    function saveShuffleHistory(userId, ids) {
      const key = `slider-shuffle-history-${userId}`;
      const limit = Math.max(10, parseInt(config.shuffleSeedLimit || "100", 10));
      let arr = Array.from(new Set(ids)).slice(-limit);
      if (safeLocalSet(key, JSON.stringify(arr))) return;
      const cuts = [Math.floor(limit*0.75), Math.floor(limit*0.5), 20, 10];
      for (const n of cuts) {
        arr = arr.slice(-n);
        if (safeLocalSet(key, JSON.stringify(arr))) return;
      }
      safeLocalRemove(key);
    }

    function resetShuffleHistory(userId) {
      const key = `slider-shuffle-history-${userId}`;
      safeLocalRemove(key);
    }

    try {
      if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
        await waitAuthWarmupFallback(1000);
    }
      const s = getSessionInfo();
      userId = s.userId;
      accessToken = s.accessToken;
    } catch (e) {
      console.error("Oturum bilgisi okunamadı:", e);
      return;
    }

    if (!fetchItemDetailsCached) {
      const bulkBatchSize = Number(config?.detailsBulkBatchSize) || 60;

      const fetchMany = async (ids) => {
        let tok = accessToken;
        try { tok = getSessionInfo?.()?.accessToken || tok; } catch {}

        const headers = {
          "X-Emby-Authorization": getAuthHeader(),
          "X-Emby-Token": tok,
        };

        const qs = new URLSearchParams();
        qs.set("Ids", ids.join(","));
        qs.set("EnableUserData", "true");
        qs.set("EnableTotalRecordCount", "false");
        qs.set(
          "Fields",
          [
            "ImageTags",
            "BackdropImageTags",
            "UserData",
            "PrimaryImageAspectRatio",
            "RunTimeTicks",
            "Overview",
            "Genres",
            "People",
            "Studios",
            "ProductionYear",
            "ProductionLocations",
            "Taglines",
            "OriginalTitle",
            "MediaStreams",
            "Chapters",
            "DateCreated",
            "ProviderIds",
            "ExternalUrls",
            "TrailerUrls"
          ].join(",")
        );

        const data = await fetchJsonViaSafeFetch(`/Users/${userId}/Items?${qs.toString()}`, { headers });
        return data?.Items || data || [];
      };

      fetchItemDetailsCached = window.__jmsFetchItemDetailsCached =
        createCachedItemDetailsFetcher({
          fetchOne: fetchItemDetailsNet,
          fetchMany,
          batchSize: bulkBatchSize,
          ttlMs: Number(config?.itemDetailsCacheTtlMs) || (24 * 60 * 60 * 1000),
          allowStaleOnError: true,
          maxConcurrent: Number(config?.detailsFetchConcurrency) || 6,
        });
    }

    try {
      window.__stopJmsLibraryWatcher?.();
      window.__stopJmsLibraryWatcher = startLibraryDeltaWatcher({
        userId,
        fetchJson: fetchJsonViaSafeFetch,
        getAuthHeaders: () => {
          let tok = accessToken;
          try { tok = getSessionInfo?.()?.accessToken || tok; } catch {}
          return {
            "X-Emby-Authorization": getAuthHeader(),
            "X-Emby-Token": tok,
          };
        },
        fetchItemDetailsCached,
        intervalMs: Number(config?.libraryWatchIntervalMs) || 60_000,
        limit: Number(config?.libraryWatchLimit) || 50,
      });
    } catch {}

    const cfgLimit =
      Number.isFinite(Number(config?.limit)) ? Number(config.limit) :
      Number.isFinite(Number(config?.savedLimit)) ? Number(config.savedLimit) :
      undefined;
    const savedLimit = Number.isFinite(cfgLimit)
      ? cfgLimit
      : parseInt(localStorage.getItem("limit") || "20", 10);
    window.myUserId = userId;
    window.myListUrl = `/slider/list/list_${userId}.txt`;

    let items = [];

    try {
      let listItems = null;

      if (config.useManualList && config.manualListIds) {
        listItems = config.manualListIds.split(",").map((id) => id.trim()).filter(Boolean);
      } else if (config.useListFile) {
        let text = null;
        try {
          text = await cachedFetchText({
            keyParts: ["listfile", userId, window.myListUrl],
            url: window.myListUrl,
            fetchText: fetchTextViaSafeFetch,
            ttlMs: Number(config?.listFileCacheTtlMs) || 60_000,
            allowStaleOnError: true,
          });
        } catch (e) {
          console.warn("list.txt alınamadı, fallback API devrede.", e);
        }

        if (text) {
          window.cachedListContent = text;
          if (text.length >= 10) {
            listItems = text.split("\n").map(l => l.trim()).filter(Boolean);
          } else {
            console.warn("list.txt çok küçük, fallback API devrede.");
          }
        } else {
          console.warn("list.txt alınamadı, fallback API devrede.");
        }
      }

      if (Array.isArray(listItems) && listItems.length) {
        const details = await fetchItemDetailsCached.many(listItems);
        items = details.filter((x) => x);
      } else {
        const baseQS = (config.customQueryString || '').replace(/^[?&]+/, '');
        const onlyUnwatched = !!config.onlyUnwatchedRandom;
        const hasIsPlayed = /(?:^|[?&])IsPlayed=/i.test(baseQS);
        const queryString = (onlyUnwatched && !hasIsPlayed)
          ? (baseQS ? baseQS + '&IsPlayed=false' : 'IsPlayed=false')
          : baseQS;

        const includeItemTypes = extractItemTypesFromQuery(queryString);
        const shouldBalanceTypes =
          config.balanceItemTypes &&
          (hasAllTypes(includeItemTypes, ["Movie", "Series"]) || hasAllTypes(includeItemTypes, ["Movie", "Series", "BoxSet"]));
        const shouldShuffle = !config.sortingKeywords?.some(
          (k) => queryString.includes(k) || queryString.includes("SortBy=") || queryString.includes("SortOrder=")
        );

        let playingItems = [];
        const playingLimit = (onlyUnwatched ? 0 : parseInt(config.playingLimit || 0, 10));
        const authHeaders = {
        "X-Emby-Authorization": getAuthHeader(),
        "X-Emby-Token": accessToken
      };

        if (playingLimit > 0) {
          try {
            const data = await cachedFetchJson({
            keyParts: ["resume", userId, playingLimit * 2],
            url: `/Users/${userId}/Items/Resume?Limit=${playingLimit * 2}`,
            opts: { headers: authHeaders },
            fetchJson: fetchJsonViaSafeFetch,
            ttlMs: Number(config?.resumeCacheTtlMs) || 30_000,
            allowStaleOnError: true,
          });
            let fetchedItems = data.Items || [];

            if (config.excludeEpisodesFromPlaying) {
              playingItems = fetchedItems.filter((item) => item.Type !== "Episode").slice(0, playingLimit);
            } else {
              playingItems = fetchedItems.slice(0, playingLimit);
            }
          } catch (err) {
            console.error("İzlenen içerikler alınırken hata:", err);
          }
        }

        const maxShufflingLimit = parseInt(config.maxShufflingLimit || "2000", 10);
        const data = await cachedFetchJson({
        keyParts: ["itemsPool", userId, queryString, maxShufflingLimit],
        url: `/Users/${userId}/Items?${queryString}&Limit=${maxShufflingLimit}&EnableTotalRecordCount=false`,
        opts: { headers: authHeaders },
        fetchJson: fetchJsonViaSafeFetch,
        ttlMs: Number(config?.itemsPoolCacheTtlMs) || 120_000,
        allowStaleOnError: true,
      });
        let allItems = data.Items || [];
        if (playingItems.length && allItems.length) {
          const playingIds = new Set(playingItems.map((it) => it && it.Id).filter(Boolean));
          allItems = allItems.filter((it) => it && !playingIds.has(it.Id));
        }

        if (queryString.includes("IncludeItemTypes=Season") || queryString.includes("IncludeItemTypes=Episode")) {
          const detailedSeasons = await Promise.all(
            allItems.map(async (item) => {
              try {
                const seasonRes = await safeFetch(`/Users/${userId}/Items/${item.Id}`, { headers: authHeaders });
                const seasonData = await seasonRes.json();
                if (seasonData.SeriesId) {
                  const seriesRes = await safeFetch(`/Users/${userId}/Items/${seasonData.SeriesId}`, { headers: authHeaders });
                  seasonData.SeriesData = await seriesRes.json();
                }
                return seasonData;
              } catch (error) {
                console.error("Season detay alınırken hata:", error);
                return item;
              }
            })
          );
          allItems = detailedSeasons.filter((item) => item && item.Id);
        }

         if (playingItems.length) {
          const beforePlayingFilter = playingItems.length;
          const episodes = [];
          const nonEpisodes = [];

          for (const it of playingItems) {
            if (it && it.Type === "Episode") {
              episodes.push(it);
            } else {
              nonEpisodes.push(it);
            }
          }

          const filteredNonEpisodes = filterByStrictImageTypes(nonEpisodes, queryString);
          playingItems = [
            ...episodes,
            ...filteredNonEpisodes
          ];

          console.debug(
            "[JMS] playingItems before imageType filter:",
            beforePlayingFilter,
            "after (episodes kept):",
            playingItems.length
          );
        }

        const beforePoolFilter = allItems.length;
        allItems = filterByStrictImageTypes(allItems, queryString);
        console.debug(
          "[JMS] allItems before imageType filter:",
          beforePoolFilter,
          "after:",
          allItems.length
        );

        let selectedItems = [];
        selectedItems = [...playingItems.slice(0, playingLimit)];
        const remainingSlots = Math.max(0, savedLimit - selectedItems.length);

        if (remainingSlots > 0) {
          if (shouldBalanceTypes) {
            const itemsByType = {};
            allItems.forEach((item) => {
              const type = item.Type;
              if (!itemsByType[type]) itemsByType[type] = [];
              itemsByType[type].push(item);
            });
            const types = Object.keys(itemsByType);
            const itemsPerType = Math.floor(remainingSlots / types.length);
            types.forEach((type) => {
              const itemsOfType = itemsByType[type] || [];
              const shuffled = shouldShuffle ? shuffleArray(itemsOfType) : itemsOfType;
              selectedItems.push(...shuffled.slice(0, itemsPerType));
            });
            const finalRemaining = savedLimit - selectedItems.length;
            if (finalRemaining > 0) {
              const allShuffled = shouldShuffle ? shuffleArray(allItems) : allItems;
              selectedItems.push(...allShuffled.slice(0, finalRemaining));
            }
          } else if (shouldShuffle) {
            const allItemIds = allItems.map((item) => item.Id);
            const alwaysShuffle = config.sortingKeywords?.some((keyword) => (config.keywords || "").toLowerCase().includes(keyword.toLowerCase()));
            if (alwaysShuffle) {
              const shuffled = shuffleArray(allItemIds);
              const selectedItemsFromShuffle = allItems.filter((item) => shuffled.slice(0, remainingSlots).includes(item.Id));
              selectedItems.push(...selectedItemsFromShuffle);
            } else {
              const shuffleSeedLimit = parseInt(config.shuffleSeedLimit || "100", 10);
              const alreadySelected = new Set(selectedItems.map((i) => i.Id));

              let history = getShuffleHistory(userId);
              const allSet = new Set(allItemIds);
              history = Array.from(new Set(history.filter((id) => allSet.has(id))));
              if (history.length >= shuffleSeedLimit) {
                resetShuffleHistory(userId);
                history = [];
              }
              let attempt = 0;
              let pickedIds = [];
              let updatedHistory = history.slice();
              while (attempt < 2 && pickedIds.length < remainingSlots) {
                let unseenIds = allItemIds.filter(
                  (id) => !updatedHistory.includes(id) && !alreadySelected.has(id)
                );
                if ((unseenIds.length < remainingSlots || updatedHistory.length >= shuffleSeedLimit) && attempt === 0) {
                  resetShuffleHistory(userId);
                  updatedHistory = [];
                  attempt++;
                  continue;
                }
                const shuffled = shuffleArray(unseenIds);
                const need = remainingSlots - pickedIds.length;
                pickedIds = pickedIds.concat(shuffled.slice(0, need));
                break;
              }
              if (pickedIds.length < remainingSlots) {
                const need = remainingSlots - pickedIds.length;
                const fallbackPool = allItemIds.filter((id) => !alreadySelected.has(id) && !pickedIds.includes(id));
                pickedIds = pickedIds.concat(fallbackPool.slice(0, need));
              }
              const selectedItemsFromShuffle = allItems.filter((item) => pickedIds.includes(item.Id));
              selectedItems.push(...selectedItemsFromShuffle);
              if (!window.__shuffleSavedThisLoad) {
  const newHistory = Array.from(new Set([...history, ...pickedIds])).slice(-shuffleSeedLimit);
  try {
    saveShuffleHistory(userId, newHistory);
    console.debug("[JMS] shuffle history kaydedildi:", userId, newHistory.length);
  } catch (e) {
    console.warn("[JMS] shuffle history kaydedilemedi:", e);
  }
  window.__shuffleSavedThisLoad = true;
}
            }
          } else {
            selectedItems.push(...allItems.slice(0, remainingSlots));
          }
        }

        if (shouldShuffle) {
          if (selectedItems.length > playingItems.length) {
            const nonPlayingItems = selectedItems.slice(playingItems.length);
            const shuffledNonPlaying = shuffleArray(nonPlayingItems);
            selectedItems = [...selectedItems.slice(0, playingItems.length), ...shuffledNonPlaying];
          }
        }

        const beforeUniq = selectedItems.length;
        selectedItems = uniqueByIdStable(selectedItems).slice(0, savedLimit);
        console.debug(
          "[JMS] selectedItems before uniq:",
          beforeUniq,
          "after uniq:",
          selectedItems.length,
          "limit:",
          savedLimit
        );

        const detailed = await fetchItemDetailsCached.many(selectedItems.map(i => i.Id));
        items = detailed.filter((x) => x);
      }
    } catch (err) {
      console.error("Slide verisi hazırlanırken hata:", err);
    }

    try { primeQualityFromItems(items); } catch {}
    if (!items.length) {
    console.warn("Hiçbir slayt verisi elde edilemedi.");
    return;
  }
  window.__totalSlidesPlanned = items.length;
  window.__slidesCreated = 0;

    const first = items[0];
    await createSlide(first);
    try { annotateDomWithQualityHints(document); } catch {}
    markSlideCreated();

    const idxPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
    if (idxPage) upsertSlidesContainerAtTop(idxPage);
    try {
      updateSlidePosition();
    } catch {}

    initializeSlider();
    const rest = items.slice(1);
    idle(() => {
      (async () => {
        for (const it of rest) {
          try {
            await createSlide(it);
            try { annotateDomWithQualityHints(document); } catch {}
            markSlideCreated();
            if (config.peakSlider) {
            const idxPage = document.querySelector('#indexPage:not(.hide), #homePage:not(.hide)');
            const sc = idxPage?.querySelector('#slides-container');
            const slides = idxPage?.querySelectorAll('.slide');
            if (sc && slides?.length) {
            const spanLeft  = Number(config?.peakSpanLeft  ?? 2);
            const spanRight = Number(config?.peakSpanRight ?? spanLeft);
            const diagonal  = !!config?.peakDiagonal;

            if (sc.classList.contains('peak-ready')) {
                updatePeakClasses(slides, getCurrentIndex(), { spanLeft, spanRight, diagonal });
                } else {
                primePeakFirstPaint(slides, getCurrentIndex(), sc, { spanLeft, spanRight, diagonal });
                }
              }
            }
          } catch (e) {
            console.warn("Arka plan slayt oluşturma hatası:", e);
          }
        }
        try {
        } catch (e) {
          console.warn("Dot navigation yeniden kurulamadı:", e);
        }
      })();
    });
  } catch (e) {
    console.error("slidesInit hata:", e);
  } finally {
    window.sliderResetInProgress = false;
    window.__slidesInitRunning = false;
  }
}

function initializeSlider() {
  try {
    const indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)") ||
      document.querySelector(".homeSectionsContainer")?.closest("#indexPage, #homePage") ||
      document.querySelector("#indexPage");
    if (!indexPage) return;

    ensureProgressBarExists();
    primeProgressBar(indexPage);
    ensureInitialActivation(indexPage);
    hydrateFirstSlide(indexPage);
    if (config.peakSlider) {
    const sc = indexPage.querySelector('#slides-container');
    const slides = indexPage.querySelectorAll('.slide');
    if (sc && slides.length) {
    const spanLeft  = Number(config?.peakSpanLeft  ?? 2);
    const spanRight = Number(config?.peakSpanRight ?? spanLeft);
    const diagonal  = !!config?.peakDiagonal;
    primePeakFirstPaint(slides, getCurrentIndex(), sc, { spanLeft, spanRight, diagonal });
  }
}
    triggerSlideEnterHooks(indexPage);

    try {
      updateSlidePosition();
    } catch {}

    const slides = indexPage.querySelectorAll(".slide");
    const slidesContainer = indexPage.querySelector("#slides-container");
    let focusedSlide = null;
    let keyboardActive = false;

    const pb = indexPage.querySelector(".slide-progress-bar");
    if (pb) {
      pb.style.opacity = "0";
      pb.style.width = "0%";
    }

function queueHardResetNextFrame() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      restartSlideTimerDeterministic();
    });
  });
}

function startWhenAllReady() {
  try {
    const oldDots = document.querySelector(".dot-navigation-container");
    if (oldDots) oldDots.remove();
    createDotNavigation();
  } catch {}

  primeProgressBar(indexPage);
  ensureInitialActivation(indexPage);
  hydrateFirstSlide(indexPage);
  startNewCycleClock();
  safeRaf(() => {
    hardProgressReset();
    startSlideTimer();
    if (pb) pb.style.opacity = "1";
  });

    try {
      window.__peakBooting = false;
      if (config.peakSlider) {
        const sc = indexPage.querySelector('#slides-container');
        const slides = indexPage.querySelectorAll('.slide');
        if (sc && slides.length) {
          const spanLeft  = Number(config?.peakSpanLeft  ?? 2);
          const spanRight = Number(config?.peakSpanRight ?? spanLeft);
          const diagonal  = !!config?.peakDiagonal;
          sc.classList.add('peak-ready');
          sc.classList.remove('peak-init');
          updatePeakClasses(slides, getCurrentIndex(), { spanLeft, spanRight, diagonal });
        }
      }
    } catch {}

  try { window.__cleanupActiveWatch?.(); } catch {}
  window.__cleanupActiveWatch = watchActiveSlideChanges();

  document.removeEventListener("jms:all-slides-ready", startWhenAllReady);
}

if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
  startWhenAllReady();
} else {
  document.addEventListener("jms:all-slides-ready", startWhenAllReady, { once: true });
}
    attachMouseEvents();
    const firstImg = indexPage.querySelector(".slide.active img");
    if (firstImg && !firstImg.complete && firstImg.decode) {
      firstImg.decode().catch(() => {}).finally(() => {});
    }
    slides.forEach((slide) => {
      slide.addEventListener(
        "focus",
        () => {
          focusedSlide = slide;
          slidesContainer?.classList.remove("disable-interaction");
        },
        true
      );
      slide.addEventListener(
        "blur",
        () => {
          if (focusedSlide === slide) focusedSlide = null;
        },
        true
      );
    });

    indexPage.addEventListener("keydown", (e) => {
      if (!keyboardActive) return;
      if (e.keyCode === 37) {
        changeSlide(-1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 39) {
        changeSlide(1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 13 && focusedSlide) window.location.href = focusedSlide.dataset.detailUrl;
    });

    indexPage.addEventListener("focusin", (e) => {
      if (e.target.closest("#slides-container")) {
        keyboardActive = true;
        slidesContainer?.classList.remove("disable-interaction");
      }
    });
    indexPage.addEventListener("focusout", (e) => {
      if (!e.target.closest("#slides-container")) {
        keyboardActive = false;
        slidesContainer?.classList.add("disable-interaction");
      }
    });
    try {
      window.__cleanupActiveWatch?.();
    } catch {}
    window.__cleanupActiveWatch = watchActiveSlideChanges();
    document.addEventListener("jms:per-slide-complete", (ev) => {
  try {
    const active = document.querySelector("#indexPage:not(.hide) .slide.active, #homePage:not(.hide) .slide.active");
    const idx = getSlideIndex(active);

    if (window.__cycleExpired && isPlannedLastIndex(idx)) {
      ev.preventDefault();
      window.__cycleExpired = false;
      scheduleSliderRebuild("cycle-expired-and-last-finished");
    }
  } catch (e) {
    console.warn("per-slide-complete handler hata:", e);
  }
}, true);
} catch (e) {
    console.error("initializeSlider hata:", e);
  } finally {
    window.sliderResetInProgress = false;
  }
}

function setupNavigationObserver() {
  if (navObsBooted) return () => {};
  navObsBooted = true;

  let previousUrl = window.location.href;
  let isOnHomePage = !!document.querySelector("#indexPage:not(.hide)") || window.location.pathname === "/";

  const checkPageChange = async () => {
    const currentUrl = window.location.href;
    const nowOnHomePage = !!document.querySelector("#indexPage:not(.hide)") || window.location.pathname === "/";

    if (currentUrl !== previousUrl || nowOnHomePage !== isOnHomePage) {
      previousUrl = currentUrl;
      isOnHomePage = nowOnHomePage;

      if (isOnHomePage) {
        window.__initOnHomeOnce = false;
        fullSliderReset();
        if (!(config && config.enableNotifications)) {
          document.getElementById('jfNotifBtn')?.remove();
          document.querySelector('.jf-notif-panel')?.remove();
        }
        const ok = await waitForVisibleIndexPage(12000);
        if (ok) {
          window.__initOnHomeOnce = false;
          initializeSliderOnHome();
        } else {
          const stop = observeWhenHomeReady(() => {
            window.__initOnHomeOnce = false;
            initializeSliderOnHome();
            stop();
          }, 20000);
        }
      } else {
        try { cleanupRecentRows?.(); } catch {}
        cleanupSlider();
        window.__initOnHomeOnce = false;
      }
      startPauseOverlayOnce();
        }
    };
  setTimeout(checkPageChange, 0);
  const observerInterval = setInterval(checkPageChange, 300);

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    checkPageChange();
  };
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    checkPageChange();
  };
  window.addEventListener("popstate", checkPageChange);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) checkPageChange();
  });

  return () => clearInterval(observerInterval);
}

function initializeSliderOnHome() {
  const hasContainer = !!document.querySelector('#indexPage:not(.hide) #slides-container, #homePage:not(.hide) #slides-container');
  const willEarlyReturn = (window.__initOnHomeOnce && hasContainer);

  function bootPersonalRecsWires() {
  if (window.__recsWiresBooted) return;
  window.__recsWiresBooted = true;

  const indexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  let __recsBooted = false;
  const onAllReady = () => {
    if (__recsBooted) return;
    __recsBooted = true;
    const cfg = (typeof getConfig === 'function' ? getConfig() : {}) || {};

    try {
      if (cfg.enablePersonalRecommendations || cfg.enableGenreHubs) {
        renderPersonalRecommendations();
      }

      if (cfg.enableDirectorRows && typeof mountDirectorRowsLazy === 'function') {
        mountDirectorRowsLazy();
      }

      if (cfg.enableRecentRows && typeof mountRecentRowsLazy === 'function') {
        mountRecentRowsLazy();
      }

    } catch (e) {
      console.warn("bootPersonalRecsWires onAllReady hata:", e);
    }
  };

  document.addEventListener("jms:all-slides-ready", onAllReady, { once: true });
    if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
      onAllReady();
    }
    setTimeout(() => { if (!__recsBooted) onAllReady(); }, 5000);
    document.addEventListener("jms:slide-enter", () => { onAllReady(); }, { once: true });

    Promise.resolve().then(onAllReady);
  }

  if (willEarlyReturn) {
    bootPersonalRecsWires();
    return;
  }
  window.__initOnHomeOnce = true;
  const indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  fullSliderReset();
  bootPersonalRecsWires();
  upsertSlidesContainerAtTop(indexPage);
  const sc = indexPage.querySelector('#slides-container');
  if (config.peakSlider && sc) {
    sc.scrollLeft = 0;
    sc.classList.remove('peak-ready');
    sc.classList.add('peak-init');
    try { delete sc.dataset.peakPrimed; } catch {}
  }
  forceHomeSectionsTop();
  forceSkinHeaderPointerEvents();
  try {
    updateSlidePosition();
  } catch {}
  ensureProgressBarExists();
  const pb = document.querySelector(".slide-progress-bar");
  if (pb) {
    pb.style.opacity = "0";
    pb.style.width = "0%";
  }
  (async () => {
    try {
      await waitAuthWarmupFallback(1000);
    } catch {}
    slidesInit();
  })();

  if (config.enableStudioHubs) {
    ensureStudioHubsMounted({ eager:true });
  }
}

function cleanupSlider() {
  try { teardownAnimations(); } catch {}
  try { cleanupRecentRows?.(); } catch {}
  if (window.mySlider) {
    if (window.mySlider.autoSlideTimeout) {
      clearTimeout(window.mySlider.autoSlideTimeout);
    }
    if (window.mySlider.sliderTimeout) {
      clearTimeout(window.mySlider.sliderTimeout);
    }
    if (window.mySlider.intervalChangeSlide) {
      clearInterval(window.mySlider.intervalChangeSlide);
    }
    window.mySlider = {};
  }

  const host =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");

  if (host) {
    const sliderContainer = host.querySelector("#slides-container");
    if (sliderContainer) {
      try {
        sliderContainer.scrollLeft = 0;
        sliderContainer.classList.remove('peak-ready');
        sliderContainer.classList.remove('peak-diagonal');
        sliderContainer.classList.remove('peak-init');
        delete sliderContainer.dataset.peakPrimed;
      } catch {}
      sliderContainer.remove();
    }
  }
}

function observeWhenHomeReady(cb, maxMs = 20000) {
  const start = Date.now();
  const mo = new MutationObserver(() => {
    const ready =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)") ||
      document.querySelector(".homeSectionsContainer");
    if (ready) {
      cleanup();
      cb();
    } else if (Date.now() - start > maxMs) {
      cleanup();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  const to = setTimeout(() => {
    cleanup();
  }, maxMs + 1000);
  function cleanup() {
    clearTimeout(to);
    mo.disconnect();
  }
  return cleanup;
}

(async function robustBoot() {
  try {
    try {
      await waitAuthWarmupFallback(1000);
    } catch {}

    const fastIndex = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
    if (fastIndex) {
      startPauseOverlayOnce();
      initializeSliderOnHome();
    } else {
      const stop = observeWhenHomeReady(() => {
        startPauseOverlayOnce();
        initializeSliderOnHome();
        stop();
      }, 15000);
    }

    idle(async () => {
      try {
        await waitForStylesReady();
      } catch {}
      try {
        startUpdatePolling({
          intervalMs: 60 * 60 * 1000,
          minGapMs: 60 * 60 * 1000,
          dedupScope: "forever",
          remindEveryMs: 12 * 60 * 60 * 1000,
        });
      } catch {}
      idle(() => {
        try {
          if (config && config.enableNotifications) {
            initNotifications();
          } else {
            document.getElementById('jfNotifBtn')?.remove();
            document.getElementById('jfNotifModal')?.remove();
            document.querySelector('.jf-notif-panel')?.remove();
            document.documentElement.dataset.jmsNotif = '0';
          }
        } catch {}
        if (config.enableQualityBadges && !window.__qualityBadgesBooted) {
          window.__qualityBadgesBooted = true;
          try { window.cleanupQualityBadges = initializeQualityBadges(); } catch {}
        }
      });
    });

    setupNavigationObserver();
    idle(() => { if (config.enableStudioHubs) ensureStudioHubsMounted(); });
  } catch (e) {
    console.warn("robustBoot (fast) hata:", e);
  }
})();

window.addEventListener(
  "resize",
  debounce(() => {
    try {
      updateSlidePosition();
    } catch {}
  }, 150)
);
window.addEventListener("pageshow", () => {
  try {
    updateSlidePosition();
  } catch {}
});

window.addEventListener("unhandledrejection", (event) => {
  if (event?.reason?.message && event.reason.message.includes("quality badge")) {
    console.warn("Kalite badge hatası:", event.reason);
    event.preventDefault();
  }
});

window.slidesInit = slidesInit;
const cleanupAvatarSystem = initAvatarSystem();
window.cleanupAvatarSystem = cleanupAvatarSystem;

(function installCardOverlayFixEverywhere(){
  const KEY = "jms-cardOverlay-after-fix";
  const CSS = `
html body .cardOverlayContainer.cardOverlayContainer::after {
  content: none !important;
  background: transparent !important;
  top: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  transition: none !important;
  transform: none !important;
}
`.trim();

  const injectedRoots = new WeakSet();

  function injectIntoRoot(root) {
    if (!root || injectedRoots.has(root)) return;
    injectedRoots.add(root);

    try {
      if (root.adoptedStyleSheets && typeof CSSStyleSheet !== "undefined") {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      }
    } catch {}

    try {
      const doc = root.ownerDocument || document;
      const style = doc.createElement("style");
      style.setAttribute("data-jms", KEY);
      style.textContent = CSS;

      if (root instanceof ShadowRoot) {
        root.appendChild(style);
      } else {
        (doc.head || doc.documentElement).appendChild(style);
      }
    } catch {}
  }

  function scanAndInject() {
    const nodes = document.querySelectorAll(".cardOverlayContainer");
    nodes.forEach(el => {
      const r = el.getRootNode?.();
      injectIntoRoot(r instanceof ShadowRoot ? r : document);
    });
  }

  scanAndInject();

  const mo = new MutationObserver(() => {
    scanAndInject();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
