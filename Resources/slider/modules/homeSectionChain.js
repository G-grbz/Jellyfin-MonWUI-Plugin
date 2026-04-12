import { getConfig, getHomeSectionsRuntimeConfig } from "./config.js";

const SECTION_DEPENDENCIES = {
  personalRecommendations: ["studioHubs"],
  becauseYouWatched: ["recentRows", "personalRecommendations", "studioHubs"],
  genreHubs: ["becauseYouWatched", "recentRows", "personalRecommendations", "studioHubs"],
  directorRows: ["genreHubs", "becauseYouWatched", "recentRows", "personalRecommendations", "studioHubs"],
};
const HOME_SCROLL_INTENT_EVENT = "jms:home-scroll-intent";
const HOME_SCROLL_INTENT_TTL_MS = 30_000;
const HOME_SCROLL_INTENT_MIN_MARGIN_PX = 140;
const HOME_SCROLL_TRACKER = {
  installed: false,
  rafId: 0,
  mutationObserver: null,
  elementTargets: new Set(),
  lastIntentAt: 0,
  routeKey: "",
  pendingUserCheck: false,
  lastWindowScrollPx: 0,
  targetScrollPx: new WeakMap(),
  nextTokenId: 0,
  pendingTokenId: 0,
  consumedTokenId: 0,
};

function isHomeRouteHash(hash = window.location.hash || "") {
  const h = String(hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function getCurrentHomeRouteKey() {
  try {
    return String(window.location.hash || "").toLowerCase();
  } catch {
    return "";
  }
}

function getActiveHomeRoot() {
  const page =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!page) return null;
  return page.querySelector(".homeSectionsContainer") || page;
}

function isScrollableElement(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  try {
    const style = window.getComputedStyle?.(el);
    const overflowY = `${style?.overflowY || ""} ${style?.overflow || ""}`.toLowerCase();
    return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > (el.clientHeight + 2);
  } catch {
    return false;
  }
}

function collectHomeScrollElementTargets() {
  const out = [];
  const seen = new Set();
  let node = getActiveHomeRoot();
  while (node) {
    if (isScrollableElement(node) && !seen.has(node)) {
      seen.add(node);
      out.push(node);
    }
    node = node.parentElement;
  }
  return out;
}

function getScrollTargetViewportSize(target) {
  if (target === window || target === document) {
    const docEl = document.scrollingElement || document.documentElement;
    return Math.max(window.innerHeight || 0, docEl?.clientHeight || 0);
  }
  return Math.max(0, target?.clientHeight || 0);
}

function getRemainingScrollPx(target) {
  if (target === window || target === document) {
    const docEl = document.scrollingElement || document.documentElement;
    const top = Math.max(
      window.scrollY || 0,
      docEl?.scrollTop || 0,
      document.documentElement?.scrollTop || 0,
      document.body?.scrollTop || 0
    );
    const viewport = getScrollTargetViewportSize(window);
    const scrollHeight = Math.max(
      docEl?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    return scrollHeight - top - viewport;
  }

  return (target?.scrollHeight || 0) - (target?.scrollTop || 0) - (target?.clientHeight || 0);
}

function getCurrentScrollPx(target) {
  if (target === window || target === document) {
    const docEl = document.scrollingElement || document.documentElement;
    return Math.max(
      window.scrollY || 0,
      docEl?.scrollTop || 0,
      document.documentElement?.scrollTop || 0,
      document.body?.scrollTop || 0
    );
  }
  return Math.max(0, target?.scrollTop || 0);
}

function getMaxScrollablePx(target) {
  const viewport = getScrollTargetViewportSize(target);
  if (target === window || target === document) {
    const docEl = document.scrollingElement || document.documentElement;
    const scrollHeight = Math.max(
      docEl?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    return Math.max(0, scrollHeight - viewport);
  }
  return Math.max(0, (target?.scrollHeight || 0) - viewport);
}

function isNearScrollEnd(target) {
  const remaining = getRemainingScrollPx(target);
  if (!Number.isFinite(remaining)) return false;
  const maxScrollable = getMaxScrollablePx(target);
  if (!Number.isFinite(maxScrollable) || maxScrollable <= 24) return false;
  if (getCurrentScrollPx(target) <= 2) return false;
  const viewport = getScrollTargetViewportSize(target);
  const margin = Math.max(HOME_SCROLL_INTENT_MIN_MARGIN_PX, Math.min(360, Math.round(viewport * 0.14)));
  return remaining <= margin;
}

function markHomeScrollIntent() {
  if (!isHomeRouteHash()) return;
  const now = Date.now();
  const routeKey = getCurrentHomeRouteKey();
  const nextTokenId = HOME_SCROLL_TRACKER.nextTokenId + 1;

  HOME_SCROLL_TRACKER.routeKey = routeKey;
  HOME_SCROLL_TRACKER.lastIntentAt = now;
  HOME_SCROLL_TRACKER.nextTokenId = nextTokenId;
  HOME_SCROLL_TRACKER.pendingTokenId = nextTokenId;
  HOME_SCROLL_TRACKER.consumedTokenId = 0;

  try { document.dispatchEvent(new Event(HOME_SCROLL_INTENT_EVENT)); } catch {}
}

function hasFreshHomeScrollIntent({ maxAgeMs = HOME_SCROLL_INTENT_TTL_MS } = {}) {
  if (!isHomeRouteHash()) return false;
  if (HOME_SCROLL_TRACKER.routeKey !== getCurrentHomeRouteKey()) return false;
  if (!HOME_SCROLL_TRACKER.pendingTokenId) return false;
  if (HOME_SCROLL_TRACKER.pendingTokenId === HOME_SCROLL_TRACKER.consumedTokenId) return false;
  const age = Date.now() - (HOME_SCROLL_TRACKER.lastIntentAt || 0);
  return age >= 0 && age <= Math.max(0, maxAgeMs | 0);
}

function consumeHomeScrollIntent({ maxAgeMs = HOME_SCROLL_INTENT_TTL_MS } = {}) {
  if (!hasFreshHomeScrollIntent({ maxAgeMs })) return false;
  HOME_SCROLL_TRACKER.consumedTokenId = HOME_SCROLL_TRACKER.pendingTokenId;
  return true;
}

function refreshHomeScrollTrackerTargets() {
  const nextTargets = new Set(collectHomeScrollElementTargets());

  for (const target of Array.from(HOME_SCROLL_TRACKER.elementTargets)) {
    if (!nextTargets.has(target) || !target?.isConnected) {
      try { target.removeEventListener("scroll", handleHomeUserActivity); } catch {}
      HOME_SCROLL_TRACKER.elementTargets.delete(target);
    }
  }

  for (const target of nextTargets) {
    if (HOME_SCROLL_TRACKER.elementTargets.has(target)) continue;
    try {
      target.addEventListener("scroll", handleHomeUserActivity, { passive: true });
      HOME_SCROLL_TRACKER.targetScrollPx.set(target, getCurrentScrollPx(target));
    } catch {}
    HOME_SCROLL_TRACKER.elementTargets.add(target);
  }
}

function checkHomeScrollIntentNow() {
  if (!isHomeRouteHash()) {
    HOME_SCROLL_TRACKER.lastIntentAt = 0;
    HOME_SCROLL_TRACKER.routeKey = "";
    HOME_SCROLL_TRACKER.pendingUserCheck = false;
    HOME_SCROLL_TRACKER.pendingTokenId = 0;
    HOME_SCROLL_TRACKER.consumedTokenId = 0;
    HOME_SCROLL_TRACKER.targetScrollPx = new WeakMap();
    return false;
  }

  const fromUser = HOME_SCROLL_TRACKER.pendingUserCheck === true;
  HOME_SCROLL_TRACKER.pendingUserCheck = false;

  let prevWindowScrollPx = HOME_SCROLL_TRACKER.lastWindowScrollPx || 0;
  if (!Number.isFinite(prevWindowScrollPx)) prevWindowScrollPx = 0;
  const currentWindowScrollPx = getCurrentScrollPx(window);
  const advancedWindow = currentWindowScrollPx > (prevWindowScrollPx + 2);
  HOME_SCROLL_TRACKER.lastWindowScrollPx = currentWindowScrollPx;

  for (const target of HOME_SCROLL_TRACKER.elementTargets) {
    if (!target?.isConnected) continue;
    let prevTargetScrollPx = HOME_SCROLL_TRACKER.targetScrollPx.get(target) || 0;
    if (!Number.isFinite(prevTargetScrollPx)) prevTargetScrollPx = 0;
    const currentTargetScrollPx = getCurrentScrollPx(target);
    const advancedTarget = currentTargetScrollPx > (prevTargetScrollPx + 2);
    HOME_SCROLL_TRACKER.targetScrollPx.set(target, currentTargetScrollPx);

    if (fromUser && advancedTarget && isNearScrollEnd(target)) {
      markHomeScrollIntent();
      return true;
    }
  }

  if (fromUser && advancedWindow && (isNearScrollEnd(window) || isNearScrollEnd(document))) {
    markHomeScrollIntent();
    return true;
  }

  return false;
}

function scheduleHomeScrollIntentCheck({ fromUser = false } = {}) {
  if (fromUser) {
    HOME_SCROLL_TRACKER.pendingUserCheck = true;
  }
  if (HOME_SCROLL_TRACKER.rafId) return;
  HOME_SCROLL_TRACKER.rafId = requestAnimationFrame(() => {
    HOME_SCROLL_TRACKER.rafId = 0;
    refreshHomeScrollTrackerTargets();
    checkHomeScrollIntentNow();
  });
}

function handleHomeUserActivity() {
  scheduleHomeScrollIntentCheck({ fromUser: true });
}

function handleHomePassiveActivity() {
  scheduleHomeScrollIntentCheck();
}

function ensureHomeScrollIntentTracking() {
  if (HOME_SCROLL_TRACKER.installed) {
    scheduleHomeScrollIntentCheck();
    return;
  }

  HOME_SCROLL_TRACKER.installed = true;
  HOME_SCROLL_TRACKER.lastWindowScrollPx = getCurrentScrollPx(window);
  window.addEventListener("scroll", handleHomeUserActivity, { passive: true, capture: true });
  document.addEventListener("scroll", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("resize", handleHomePassiveActivity, { passive: true });
  window.addEventListener("wheel", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("touchmove", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("touchend", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("hashchange", handleHomePassiveActivity, { passive: true });

  const observerTarget = document.body || document.documentElement || null;
  if (observerTarget && typeof MutationObserver === "function") {
    HOME_SCROLL_TRACKER.mutationObserver = new MutationObserver(() => {
      handleHomePassiveActivity();
    });
    try {
      HOME_SCROLL_TRACKER.mutationObserver.observe(observerTarget, {
        childList: true,
        subtree: true,
      });
    } catch {
      HOME_SCROLL_TRACKER.mutationObserver = null;
    }
  }

  scheduleHomeScrollIntentCheck();
}

function getSectionState(source = null) {
  const cfg = source || getConfig?.() || {};
  const runtime = getHomeSectionsRuntimeConfig(cfg);
  return {
    cfg,
    runtime,
    recentRows:
      !!(
        runtime.enableRecentRows ||
        runtime.enableContinueMovies ||
        runtime.enableContinueSeries ||
        runtime.enableOtherLibRows
      ),
    personalRecommendations: runtime.enablePersonalRecommendations !== false,
    becauseYouWatched: runtime.enableBecauseYouWatched !== false,
    genreHubs: runtime.enableGenreHubs !== false,
    directorRows: runtime.enableDirectorRows !== false,
    studioHubs: runtime.enableStudioHubs !== false,
  };
}

function isSectionEnabled(key, state) {
  return !!state?.[key];
}

export function getManagedSectionDependencyKeys(targetKey, source = null) {
  const state = getSectionState(source);
  const deps = Array.isArray(SECTION_DEPENDENCIES[targetKey])
    ? SECTION_DEPENDENCIES[targetKey]
    : [];
  return deps.filter((key) => isSectionEnabled(key, state));
}

function hasSectionReady(key) {
  try {
    if (key === "recentRows") return window.__jmsRecentRowsDone === true;
    if (key === "personalRecommendations") return window.__jmsPersonalRecsDone === true;
    if (key === "becauseYouWatched") return window.__jmsBywDone === true;
    if (key === "genreHubs") {
      return window.__jmsGenreFirstReady === true || window.__jmsGenreHubsDone === true;
    }
  } catch {}
  return key === "studioHubs";
}

function getSectionReadyEvents(key) {
  if (key === "recentRows") return ["jms:recent-rows-done"];
  if (key === "personalRecommendations") return ["jms:personal-recommendations-done"];
  if (key === "becauseYouWatched") return ["jms:because-you-watched-done"];
  if (key === "genreHubs") return ["jms:genre-first-ready", "jms:genre-hubs-done"];
  return [];
}

function hasRenderableCards(root, selector) {
  if (!root?.isConnected) return false;
  try {
    return !!root.querySelector(selector);
  } catch {
    return false;
  }
}

function hasSectionRenderableContent(key) {
  if (key === "recentRows") {
    return hasRenderableCards(
      document.getElementById("recent-rows"),
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations, .recent-row-section .dir-row-hero"
    );
  }

  if (key === "personalRecommendations") {
    return hasRenderableCards(
      document.getElementById("personal-recommendations"),
      ".personal-recs-row .personal-recs-card:not(.skeleton), .personal-recs-row .no-recommendations"
    );
  }

  if (key === "becauseYouWatched") {
    return getBecauseYouWatchedSections().some((section) => hasRenderableCards(
      section,
      ".byw-row .personal-recs-card:not(.skeleton), .byw-row .no-recommendations"
    ));
  }

  if (key === "genreHubs") {
    return hasRenderableCards(
      document.getElementById("genre-hubs"),
      ".genre-hub-section .genre-row .personal-recs-card:not(.skeleton), .genre-hub-section .genre-row .no-recommendations"
    );
  }

  if (key === "directorRows") {
    return hasRenderableCards(
      document.getElementById("director-rows"),
      ".dir-row-section .personal-recs-card:not(.skeleton), .dir-row-section .no-recommendations, .dir-row-section .dir-row-hero"
    );
  }

  return false;
}

function isSectionReadyForGate(key) {
  return hasSectionReady(key) || hasSectionRenderableContent(key);
}

export function waitForManagedSectionReady(key, { timeoutMs = 20000 } = {}) {
  if (!key || isSectionReadyForGate(key)) {
    return Promise.resolve();
  }

  const events = getSectionReadyEvents(key);
  if (!events.length && typeof MutationObserver !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    let timeoutId = null;
    let observer = null;

    const finish = () => {
      if (done) return;
      done = true;
      for (const eventName of events) {
        try { document.removeEventListener(eventName, onReady); } catch {}
      }
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      resolve();
    };

    const onReady = () => {
      if (isSectionReadyForGate(key)) {
        finish();
      }
    };

    for (const eventName of events) {
      document.addEventListener(eventName, onReady);
    }

    const observerTarget = document.body || document.documentElement || null;
    if (observerTarget && typeof MutationObserver === "function") {
      observer = new MutationObserver(() => {
        onReady();
      });

      try {
        observer.observe(observerTarget, {
          childList: true,
          subtree: true,
        });
      } catch {
        observer = null;
      }
    }

    timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
    onReady();
  });
}

function getBecauseYouWatchedSections() {
  return Array.from(
    document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched')
  )
    .filter((el) => el?.isConnected)
    .sort((left, right) => {
      const li = Number(String(left.id || "").split("--")[1]) || 0;
      const ri = Number(String(right.id || "").split("--")[1]) || 0;
      return li - ri;
    });
}

function resolveAnchorElementByKey(key) {
  if (key === "recentRows") {
    return document.getElementById("recent-rows");
  }
  if (key === "personalRecommendations") {
    return document.getElementById("personal-recommendations");
  }
  if (key === "becauseYouWatched") {
    const sections = getBecauseYouWatchedSections();
    return sections.length ? sections[sections.length - 1] : null;
  }
  if (key === "genreHubs") {
    return document.getElementById("genre-hubs");
  }
  if (key === "directorRows") {
    return document.getElementById("director-rows");
  }
  if (key === "studioHubs") {
    return document.getElementById("studio-hubs");
  }
  return null;
}

export function resolveManagedSectionAnchor(keys = []) {
  for (const key of keys || []) {
    const anchor = resolveAnchorElementByKey(key);
    if (anchor?.isConnected) {
      return anchor;
    }
  }
  return null;
}

function parseBottomRootMargin(rootMargin) {
  const parts = String(rootMargin || "").trim().split(/\s+/).filter(Boolean);
  const bottom = parts[2] || parts[0] || "0px";
  const value = Number.parseFloat(bottom);
  return Number.isFinite(value) ? value : 0;
}

function ensureTailSentinel(anchor) {
  if (!anchor) return null;
  const existing = anchor.__jmsChainTailSentinel;
  if (existing?.isConnected) return existing;

  const sentinel = document.createElement("span");
  sentinel.className = "jms-chain-tail-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.style.cssText = [
    "display:block",
    "width:1px",
    "height:1px",
    "margin-top:-1px",
    "opacity:0",
    "pointer-events:none"
  ].join(";");

  try { anchor.appendChild(sentinel); } catch { return null; }
  anchor.__jmsChainTailSentinel = sentinel;
  return sentinel;
}

export function waitForSectionTailReveal(anchor, {
  timeoutMs = 20000,
  rootMargin = "0px 0px 240px 0px",
} = {}) {
  ensureHomeScrollIntentTracking();
  if (!anchor?.isConnected) {
    return Promise.resolve();
  }

  const sentinel = ensureTailSentinel(anchor);
  if (!sentinel?.isConnected) {
    return Promise.resolve();
  }

  const preloadPx = parseBottomRootMargin(rootMargin);
  const maxIntentAgeMs = Math.max(HOME_SCROLL_INTENT_TTL_MS, Math.max(0, timeoutMs | 0));
  const isNearViewport = () => {
    if (!sentinel.isConnected) return true;
    const rect = sentinel.getBoundingClientRect?.();
    if (!rect) return true;
    return rect.top <= ((window.innerHeight || 0) + preloadPx);
  };
  const isReady = () => {
    if (isNearViewport()) return true;
    return consumeHomeScrollIntent({ maxAgeMs: maxIntentAgeMs });
  };

  if (isReady()) {
    return Promise.resolve();
  }

  if (typeof IntersectionObserver !== "function") {
    return new Promise((resolve) => {
      let done = false;
      let timeoutId = null;

      const finish = () => {
        if (done) return;
        done = true;
        try { window.removeEventListener("scroll", onScroll, true); } catch {}
        try { document.removeEventListener("scroll", onScroll, true); } catch {}
        try { window.removeEventListener("resize", onScroll, true); } catch {}
        try { document.removeEventListener(HOME_SCROLL_INTENT_EVENT, onScroll); } catch {}
        if (timeoutId) {
          try { clearTimeout(timeoutId); } catch {}
        }
        resolve();
      };

      const onScroll = () => {
        if (isReady()) {
          finish();
        }
      };

      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      document.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("resize", onScroll, { passive: true, capture: true });
      document.addEventListener(HOME_SCROLL_INTENT_EVENT, onScroll);
      timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
      onScroll();
    });
  }

  return new Promise((resolve) => {
    let done = false;
    let timeoutId = null;
    let observer = null;
    let resizeObserver = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      try { window.removeEventListener("scroll", onActivity, true); } catch {}
      try { document.removeEventListener("scroll", onActivity, true); } catch {}
      try { window.removeEventListener("resize", onActivity, true); } catch {}
      try { document.removeEventListener(HOME_SCROLL_INTENT_EVENT, onActivity); } catch {}
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
      }
      resolve();
    };
    const onActivity = () => {
      if (isReady()) {
        finish();
      }
    };

    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== sentinel) continue;
        if (entry.isIntersecting) {
          finish();
          break;
        }
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    });

    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    window.addEventListener("resize", onActivity, { passive: true, capture: true });
    document.addEventListener(HOME_SCROLL_INTENT_EVENT, onActivity);
    observer.observe(sentinel);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        onActivity();
      });
      try { resizeObserver.observe(anchor); } catch {}
    }
    timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
    if (isReady()) {
      finish();
    }
  });
}

export async function waitForManagedSectionGate(targetKey, options = {}) {
  ensureHomeScrollIntentTracking();
  const dependencyKeys = getManagedSectionDependencyKeys(targetKey, options.source);
  const dependencyKey = dependencyKeys[0] || null;

  if (dependencyKey) {
    await waitForManagedSectionReady(dependencyKey, options);
  }

  const anchorEl = resolveManagedSectionAnchor(dependencyKeys);
  if (anchorEl) {
    await waitForSectionTailReveal(anchorEl, options);
  }

  return { dependencyKey, anchorEl };
}
