import { getConfig } from './config.js';

let homeTopObserver = null;
let skinHeaderObserver = null;
let applyHomeTop = null;
let applySkinHeader = null;
let homeTopLifecycleBound = false;
let skinHeaderLifecycleBound = false;

const OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: false
};

function scheduleBurst(fn) {
  if (typeof fn !== 'function') return;
  const delays = [0, 60, 180, 420];
  for (const delay of delays) {
    setTimeout(() => {
      try { fn(); } catch {}
    }, delay);
  }
}

function reconnectObserver(observer) {
  const root = document.body || document.documentElement;
  if (!observer || !root || document.visibilityState === 'hidden') return;
  try { observer.disconnect(); } catch {}
  try { observer.observe(root, OBSERVER_OPTIONS); } catch {}
}

function bindHomeTopLifecycle() {
  if (homeTopLifecycleBound) return;
  homeTopLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applyHomeTop?.(); } catch {}
      reconnectObserver(homeTopObserver);
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { homeTopObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { homeTopObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
}

function bindSkinHeaderLifecycle() {
  if (skinHeaderLifecycleBound) return;
  skinHeaderLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applySkinHeader?.(); } catch {}
      reconnectObserver(skinHeaderObserver);
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { skinHeaderObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { skinHeaderObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
}

function isMobileDevice() {
  const widthNarrow = window.matchMedia?.('(max-width: 768px)')?.matches;
  const coarse     = window.matchMedia?.('(pointer: coarse)')?.matches;
  const hoverNone  = window.matchMedia?.('(hover: none)')?.matches;
  const touchPts   = navigator.maxTouchPoints || 0;
  const uaMobile   = navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent);

  return widthNarrow && (coarse || hoverNone || touchPts > 0 || uaMobile);
}

function normalizeVariant(x) {
  const s = String(x ?? '').toLowerCase().trim();
  if (!s) return 'slider';

  if (s.includes('normalslider') || s.includes('normal')) return 'normalslider';
  if (s.includes('fullslider') || s.includes('full'))   return 'fullslider';
  if (s.includes('peakslider') || s.includes('peak'))   return 'peakslider';
  if (s.includes('slider')) return 'slider';
  return 'slider';
}

function detectCssVariantFromDom() {
  if (window.__cssVariant) return normalizeVariant(window.__cssVariant);

  const dv = document.documentElement?.dataset?.cssVariant;
  if (dv) return normalizeVariant(dv);

  const has = (s) => !!document.querySelector(`link[href*="${s}"]`);
  if (has('peakslider.css'))   return 'peakslider';
  if (has('normalslider.css')) return 'normalslider';
  if (has('fullslider.css')) return 'fullslider';
  if (has('slider.css')) return 'slider';
  return 'slider';
}

function computeEffectiveTop() {
  const cfg = (typeof getConfig === 'function') ? getConfig() : {};
  const userTop = readUserTopFromLocalStorage();
  if (userTop !== null) return userTop;
  if (cfg?.enableSlider === false || cfg?.enableSlider === 'false') return 0;

  const rawVariant = (cfg && 'cssVariant' in cfg) ? cfg.cssVariant : undefined;
  const variant = normalizeVariant(rawVariant ?? detectCssVariantFromDom());

  try {
  } catch {}

  return getDefaultTopByVariant(variant);
}

function getDefaultTopByVariant(variant) {
  const mobile = isMobileDevice();
  if (mobile) {
    switch (variant) {
      case 'normalslider': return -12;
      case 'fullslider': return -16;
      case 'peakslider': return 2;
      case 'slider': return 4;
      default: return 0;
    }
  } else {
    switch (variant) {
      case 'normalslider': return -15;
      case 'fullslider': return 6;
      case 'peakslider': return -2;
      case 'slider': return 2;
      default: return 0;
    }
  }
}

function readUserTopFromLocalStorage() {
  const raw = localStorage.getItem('homeSectionsTop');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function coerceBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function shouldAffectFavoritesTab(cfg) {
  const raw = localStorage.getItem('onlyShowSliderOnHomeTab');
  if (raw === 'true' || raw === 'false') return raw === 'false';
  return !coerceBoolean(cfg?.onlyShowSliderOnHomeTab, true);
}

function applyTopToElements(vh, affectFavoritesTab = true) {
  const value = `${vh}vh`;
  const targets = [...document.querySelectorAll('.homeSectionsContainer')]
    .filter(el => affectFavoritesTab || el?.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    const fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  for (const el of targets) {
    if (!el) continue;
    if (el.style.top !== value) {
      el.style.setProperty('top', value, 'important');
    }
  }
}

function clearFavoritesTabTopOverride() {
  const el = document.querySelector('#favoritesTab');
  if (!el) return;
  el.style.removeProperty('top');
}

function waitForFavoritesTabAndApply(topValue) {
  let tries = 0;
  function attempt() {
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    if (!shouldAffectFavoritesTab(cfg)) return;

    const el = document.querySelector('#favoritesTab');
    if (el) {
      el.style.setProperty('top', `${topValue}vh`, 'important');
      return;
    }
    if (++tries < 30) setTimeout(attempt, 100);
  }
  attempt();
}

export function forceHomeSectionsTop() {
  const applyAlways = () => {
    const top = computeEffectiveTop();
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    const affectFavoritesTab = shouldAffectFavoritesTab(cfg);

    applyTopToElements(top, affectFavoritesTab);
    if (affectFavoritesTab) {
      waitForFavoritesTabAndApply(top);
    } else {
      clearFavoritesTabTopOverride();
    }
  };

  applyHomeTop = applyAlways;
  bindHomeTopLifecycle();

  if (!homeTopObserver) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(applyAlways), { once: true });
    } else {
      scheduleBurst(applyAlways);
    }

    homeTopObserver = new MutationObserver(() => {
      try { applyHomeTop?.(); } catch {}
    });
    reconnectObserver(homeTopObserver);
  } else {
    scheduleBurst(applyAlways);
    reconnectObserver(homeTopObserver);
  }
}

export function forceSkinHeaderPointerEvents() {
  const apply = () => {
    document.querySelectorAll('html .skinHeader').forEach(el => {
      el.style.setProperty('pointer-events', 'all', 'important');
    });

    const playerToggle = document.querySelector('button#jellyfinPlayerToggle');
    if (playerToggle) {
      playerToggle.style.setProperty('display', 'block', 'important');
      playerToggle.style.setProperty('opacity', '1', 'important');
      playerToggle.style.setProperty('pointer-events', 'all', 'important');
      playerToggle.style.setProperty('background', 'none', 'important');
      playerToggle.style.setProperty('text-shadow', 'rgb(255, 255, 255) 0px 0px 2px', 'important');
      playerToggle.style.setProperty('cursor', 'pointer', 'important');
      playerToggle.style.setProperty('border', 'none', 'important');
    }
  };

  applySkinHeader = apply;
  bindSkinHeaderLifecycle();

  if (!skinHeaderObserver) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(apply), { once: true });
    } else {
      scheduleBurst(apply);
    }

    skinHeaderObserver = new MutationObserver(() => {
      try { applySkinHeader?.(); } catch {}
    });
    reconnectObserver(skinHeaderObserver);
  } else {
    scheduleBurst(apply);
    reconnectObserver(skinHeaderObserver);
  }
}
