import { getConfig } from "./config.js";
import {
  makeApiRequest,
  fetchLocalTrailers,
  pickBestLocalTrailer,
  getVideoStreamUrl
} from "../../Plugins/JMSFusion/runtime/api.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";

let __pop = null;
let __timer = null;
let __cleanup = null;
let __presenceTimer = null;
let __openSeq = 0;
let __navSeq  = 0;
let __tombstoneUntil = 0;
let __lastItemId = null;
const TRAILER_LRU_MAX = 200;
const trailerUrlCache = new Map();

function clearPopoverWillChange() {
  try {
    const pop = document.querySelector('.mini-trailer-popover');
    if (pop) {
      pop.style.removeProperty('will-change');
      pop.querySelectorAll('[style*="will-change"]').forEach(el => {
        el.style.removeProperty('will-change');
      });
    }
  } catch {}

  const SELS = [
    '.mini-trailer-popover',
    '.studio-trailer-video',
    '.studio-trailer-iframe'
  ];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (!rule || !rule.selectorText || !rule.style) continue;
          const match = SELS.some(s => rule.selectorText.includes(s));
          if (match && rule.style.willChange) {
            rule.style.removeProperty('will-change');
          }
        }
      } catch {  }
    }
  } catch {}
}

function killAndTombstone(ms = 1200) {
  __tombstoneUntil = Date.now() + ms;
  window.__studioTrailerKillToken = (window.__studioTrailerKillToken || 0) + 1;
}

function isMobileLike() {
  return (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    || (window.innerWidth <= 768);
}

function getBaseEl(anchor) {
  const mini = document.querySelector(".mini-poster-popover.visible");
  if (mini && document.contains(mini)) return mini;
  if (anchor && document.contains(anchor)) return anchor;
  return null;
}

function ensureEl() {
  if (__pop) return __pop;

  const el = document.createElement("div");
  el.className = "mini-trailer-popover";
  el.style.position = "fixed";
  el.style.zIndex = "10000";
  el.style.left = "0";
  el.style.top = "0";
  el.style.display = "none";
  el.style.visibility = "hidden";
  el.innerHTML = `
    <div class="mtp-inner">
      <div class="mtp-player"></div>
    </div>
  `;

  (document.body || document.documentElement).appendChild(el);
  el.addEventListener("pointerenter", () => {
    if (__timer) { clearTimeout(__timer); __timer = null; }
  }, { passive: true });
  el.addEventListener("pointerleave", (e) => {
    const to = e?.relatedTarget || null;
    const intoMini = !!(to && to.closest?.(".mini-poster-popover"));
    if (intoMini) return;
    hideTrailerPopover(140);
  }, { passive: true });
  __pop = el;
  return el;
}

function destroyPopover() {
  if (!__pop) return;
  try {
    stopAndClearMedia();
    cleanupImageResourceRefs(__pop, { revokeDetachedBlobs: true });
    const host = __pop.querySelector(".mtp-player");
    if (host) host.innerHTML = "";
    __pop.remove();
  } catch {}
  __pop = null;
}

function clearPlayerContainer(container) {
  if (!container) return;

  const vid = container.querySelector("video");
  if (vid) {
    try {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    } catch {}
  }

  const iframe = container.querySelector("iframe");
  if (iframe) {
    try { iframe.src = ""; } catch {}
  }

  try { cleanupImageResourceRefs(container, { revokeDetachedBlobs: true }); } catch {}
  container.innerHTML = "";
}

function measure(pop) {
  const prevDisplay = pop.style.display;
  const prevOpacity = pop.style.opacity;
  const prevVis     = pop.style.visibility;
  pop.style.display = "block";
  pop.style.opacity = "0";
  pop.style.visibility = "hidden";
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const mW = Math.min(vw - 16, 720);
  const mH = Math.round(Math.min( Math.max(vh * 0.35, 220), 420 ));
  const pw = pop.offsetWidth || (isMobileLike() ? mW : 420);
  const ph = pop.offsetHeight || (isMobileLike() ? mH : 252);
  pop.style.display = prevDisplay || "";
  pop.style.opacity = prevOpacity || "";
  pop.style.visibility = prevVis || "";
  return { pw, ph };
}

function placeNear(anchor) {
  if (!__pop) return false;
  const base = getBaseEl(anchor);
  if (!base) return false;

  const r = base.getBoundingClientRect();
  const { pw, ph } = measure(__pop);
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const margin = 8;
  const vGap = 14;
  const spaceBottom = (vh - r.bottom) - margin;
  const spaceTop    = (r.top) - margin;
  let place;
  if (isMobileLike()) {
    place = "mobile-bottom";
  } else if (spaceBottom >= ph) {
    place = "bottom";
  } else if (spaceTop >= ph) {
    place = "top";
  } else {
    place = "top";
  }

  let left = r.left + (r.width - pw) / 2;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  let top;
  if (place === "mobile-bottom") {
    left = margin;
    top  = vh - ph - margin;
    __pop.style.width  = `${vw - margin*2}px`;
    __pop.style.maxWidth = "720px";
    __pop.style.left   = `${Math.round((vw - Math.min(vw - margin*2, 720)) / 2)}px`;
  } else if (place === "bottom") {
    top = r.bottom + vGap;
    if (top + ph + margin > vh) {
      place = "top";
      top = r.top - vGap - ph;
      if (top < margin) top = margin;
    }
  }
  if (place === "top") {
    top = r.top - vGap - ph;
    if (top < margin) top = margin;
  }

  __pop.style.left = `${Math.round(left)}px`;
  __pop.style.top  = `${Math.round(top)}px`;
  return true;
}

function settlePlacement(anchor, frames = 6) {
  let left = frames;
  const tick = () => {
    if (!__pop) return;
    placeNear(anchor);
    if (--left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupLiveSync(anchor) {
  teardownLiveSync();
  const onReflow = () => {
    const base = getBaseEl(anchor);
    if (!base || !document.contains(base)) { hardClose(true); return; }
    placeNear(anchor);
  };

  window.addEventListener("scroll", onReflow, true);
  window.addEventListener("resize", onReflow, true);
  const onOrient = () => settlePlacement(anchor, 6);
  window.addEventListener("orientationchange", onOrient, { passive: true });
  const ro = new ResizeObserver(onReflow);
  const base = getBaseEl(anchor);
  if (base) ro.observe(base);

  if (__presenceTimer) clearInterval(__presenceTimer);
  __presenceTimer = setInterval(() => {
    const base2 = getBaseEl(anchor);
    if (!base2 || !document.contains(base2)) hardClose(true);
  }, 400);

  __cleanup = () => {
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow, true);
    window.removeEventListener("orientationchange", onOrient);
    try { ro.disconnect(); } catch {}
    if (__presenceTimer) { clearInterval(__presenceTimer); __presenceTimer = null; }
    __cleanup = null;
  };
}

function teardownLiveSync() {
  if (typeof __cleanup === "function") {
    __cleanup();
  }
}

function ytEmbed(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
    let id = "";
    if (host.includes("youtu.be")) id = u.pathname.slice(1);
    else id = u.searchParams.get("v") || "";
    if (!id) return null;

    const params = new URLSearchParams({
      autoplay: "1",
      mute: isMobileLike() ? "1" : "0",
      controls: "0",
      playsinline: "1",
      rel: "0",
      modestbranding: "1",
    });

    if (location.protocol === "https:") {
      params.set("enablejsapi", "1");
      params.set("origin", location.origin);
    }
    return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
  } catch {}
  return null;
}

async function resolveBestTrailerUrl(itemId) {
  const cached = trailerUrlCache.get(itemId);
  if (cached) return cached;

  const cachePut = (key, val) => {
    trailerUrlCache.set(key, val);
    if (trailerUrlCache.size > TRAILER_LRU_MAX) {
      trailerUrlCache.delete(trailerUrlCache.keys().next().value);
    }
  };

  try {
    const locals = await fetchLocalTrailers(itemId);
    const best = pickBestLocalTrailer(locals);
    if (best?.Id) {
      const url = await getVideoStreamUrl(best.Id, 360, 0);
      if (url) {
        const out = { type: "video", src: url };
        cachePut(itemId, out);
        return out;
      }
    }
  } catch {}

  let full = null;
  try { full = await makeApiRequest(`/Items/${itemId}`); } catch {}

  try {
    const remotes = Array.isArray(full?.RemoteTrailers) ? full.RemoteTrailers : [];
    if (remotes.length) {
      const yt = remotes.find(r => ytEmbed(r?.Url));
      if (yt) {
        const out = { type: "youtube", src: ytEmbed(yt.Url) };
        cachePut(itemId, out);
        return out;
      }
      const first = remotes.find(r => typeof r?.Url === "string");
      if (first) {
        const out = { type: "video", src: first.Url };
        cachePut(itemId, out);
        return out;
      }
    }
  } catch {}

  const t = String(full?.Type || "");
  const seriesId =
    (t === "Episode" || t === "Season") ? (full?.SeriesId || null) : null;

  if (seriesId && seriesId !== itemId) {
    try {
      const localsS = await fetchLocalTrailers(seriesId);
      const bestS = pickBestLocalTrailer(localsS);
      if (bestS?.Id) {
        const urlS = await getVideoStreamUrl(bestS.Id, 360, 0);
        if (urlS) {
          const out = { type: "video", src: urlS };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
      }
    } catch {}

    try {
      const seriesFull = await makeApiRequest(`/Items/${seriesId}`).catch(() => null);
      const remS = Array.isArray(seriesFull?.RemoteTrailers) ? seriesFull.RemoteTrailers : [];
      if (remS.length) {
        const ytS = remS.find(r => ytEmbed(r?.Url));
        if (ytS) {
          const out = { type: "youtube", src: ytEmbed(ytS.Url) };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
        const firstS = remS.find(r => typeof r?.Url === "string");
        if (firstS) {
          const out = { type: "video", src: firstS.Url };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
      }
    } catch {}
  }

  return null;
}

function renderPlayer(container, kind, src) {
  clearPlayerContainer(container);
  if (kind === "youtube") {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.sandbox = "allow-same-origin allow-scripts allow-popups allow-presentation";
    iframe.frameBorder = "0";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.classList.add("studio-trailer-iframe");
    container.appendChild(iframe);
    return;
  }

  const video = document.createElement("video");
  video.src = src;
  video.autoplay = true;
  video.muted = isMobileLike();
  video.controls = false;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.classList.add("studio-trailer-video");
  container.appendChild(video);
}

function stopAndClearMedia() {
  if (!__pop) return;
  const host = __pop.querySelector(".mtp-player");
  if (!host) return;

  clearPlayerContainer(host);
  clearPopoverWillChange();
}

function hardClose(destroy = false) {
  __openSeq++;
  try { hideTrailerPopover(0); } catch {}
  stopAndClearMedia();
  if (destroy) destroyPopover();
  __lastItemId = null;
}

(() => {
  if (window.__studioTrailerNavGuardsInstalled) return;
  window.__studioTrailerNavGuardsInstalled = true;

  const markNav = () => {
    if (window.__JMS_SUPPRESS_CARD_NAV && Date.now() < (window.__JMS_SUPPRESS_CARD_NAV_TS || 0)) {
    window.__JMS_SUPPRESS_CARD_NAV_TS = 0;
    return;
  }
    __navSeq++;
    __tombstoneUntil = Date.now() + 1500;
    window.__studioTrailerKillToken = (window.__studioTrailerKillToken || 0) + 1;
    hardClose(true);
  };

  ["pushState", "replaceState"].forEach((fn) => {
    const orig = history[fn];
    if (typeof orig === "function") {
      history[fn] = function (...args) {
        const ret = orig.apply(this, args);
        markNav();
        return ret;
      };
    }
  });
  window.addEventListener("popstate", markNav, true);
  window.addEventListener("hashchange", markNav, true);
  window.addEventListener("pagehide", () => markNav(), true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) markNav(); }, true);
  window.addEventListener("studiohubs:navigated", markNav, true);
  document.addEventListener("click", (e) => {
   const a = e.target?.closest?.("a,[data-link],[data-href]");
   if (!a) return;
   setTimeout(markNav, 0);
 }, true);
})();

try {
   window.addEventListener("studiohubs:miniHidden", () => {
    killAndTombstone(1200);
    hideTrailerPopover(0);
    hardClose(true);
   }, true);
   window.addEventListener("studiohubs:miniDestroyed", () => {
    killAndTombstone(1500);
    hardClose(true);
   }, true);
   window.addEventListener("studiohubs:miniShown", () => {
    __tombstoneUntil = 0;
  }, true);
 } catch {}

export async function tryOpenTrailerPopover(anchorEl, itemId, opts = {}) {
  const { requireMini = false } = opts;
  const cfg = getConfig();
  const localOk  = !!cfg?.studioHubsHoverVideo;
  const globalOk = (cfg?.globalPreviewMode === 'studioMini') && !!cfg?.studioMiniTrailerPopover;
   if (!localOk && !globalOk) return false;
   if (!anchorEl || !document.contains(anchorEl)) return false;
   if (Date.now() < __tombstoneUntil) return false;
   if (requireMini && !document.querySelector(".mini-poster-popover.visible")) return false;

   const myOpenSeq = ++__openSeq;
   const myNavSeq  = __navSeq;
   const myKill    = window.__studioTrailerKillToken || 0;

   const best = await resolveBestTrailerUrl(itemId);
   if (!best) return false;
   if (Date.now() < __tombstoneUntil) return false;
   if (myOpenSeq !== __openSeq || myNavSeq !== __navSeq) return false;
   if ((window.__studioTrailerKillToken || 0) !== myKill) return false;
   if (!document.contains(anchorEl)) return false;
   if (requireMini && !document.querySelector(".mini-poster-popover.visible")) return false;

   const pop = ensureEl();
   const host = pop.querySelector(".mtp-player");
   renderPlayer(host, best.type, best.src);

  const placed = placeNear(anchorEl);
  if (!placed) { hardClose(true); return false; }

  setupLiveSync(anchorEl);
  requestAnimationFrame(() => {
    if (!__pop) return;
    if (Date.now() < __tombstoneUntil) { hardClose(true); return; }
    if (myOpenSeq !== __openSeq || myNavSeq !== __navSeq) return;
    if ((window.__studioTrailerKillToken || 0) !== myKill) return;
    if (!document.contains(anchorEl)) { hardClose(true); return; }
    if (requireMini && !document.querySelector(".mini-poster-popover.visible")) { hardClose(true); return; }

    __lastItemId = itemId || null;
    __pop.style.display = "block";
    __pop.style.visibility = "";
    __pop.classList.add("visible");
    settlePlacement(anchorEl, 4);
  });

  return true;
}

export function hideTrailerPopover(delay = 120) {
  if (!__pop) return;
  if (__timer) { clearTimeout(__timer); __timer = null; }
  __timer = setTimeout(() => {
    if (!__pop) return;
    __pop.classList.remove("visible");
    teardownLiveSync();
    stopAndClearMedia();
    try { clearPopoverWillChange(); } catch {}
  }, delay);
}
