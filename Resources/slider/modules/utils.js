import { getConfig } from "./config.js";
import {
  fetchItemDetails,
  getIntroVideoUrl,
  getVideoStreamUrl,
  fetchLocalTrailers,
  pickBestLocalTrailer,
  getAuthHeader,
  playNow,
} from "./api.js";
import { openDetailsModal } from "./detailsModal.js";
import { withServer, withServerSrcset, invalidateServerBaseCache, resolveServerBase } from "./jfUrl.js";

const config = getConfig();
const S = (u) => {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return withServer(u);
};

export function getYoutubeEmbedUrl(input) {
  if (!input || typeof input !== "string") return input;

  const isHttps = (() => {
    try { return window.location.protocol === "https:"; } catch { return false; }
  })();
  const host = (() => {
    try { return new URL(window.location.href).hostname; } catch { return ""; }
  })();
  const isPrivateHost = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
  const canUseOriginAndJSAPI = isHttps && !isPrivateHost;

  if (/^[a-zA-Z0-9_-]{10,}$/.test(input) && !/youtu\.?be|youtube\.com/i.test(input)) {
    const params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      modestbranding: "1",
      iv_load_policy: "3",
      enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
      playsinline: "1",
      mute: "0",
      controls: "1",
    });

    try {
      const orig = window.location?.origin || "";
        if (canUseOriginAndJSAPI && orig && /^https:\/\//i.test(orig)) {
          params.set("origin", orig);
        }
      } catch {}
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(input)}?${params.toString()}`;
  }

  const isMobile = (() => {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
             (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 1024);
    } catch { return false; }
  })();

  const parseYouTubeTime = (t) => {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m) return 0;
    const h = parseInt(m[1] || "0", 10);
    const min = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    return h * 3600 + min * 60 + s;
  };

  const ensureUrl = (raw) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    const lower = raw.toLowerCase();
    const isYT = /\b(youtu\.be|youtube\.com)\b/.test(lower);
    const scheme = (() => {
      try { return window.location.protocol === "https:" ? "https:" : "http:"; } catch { return "http:"; }
    })();
    return `${scheme}//${raw}`;
  };

  let parsed;
  try {
    parsed = new URL(ensureUrl(input));
  } catch {
    return input;
  }

  const ytHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube = ytHost === "youtu.be" || ytHost.endsWith("youtube.com");
  if (!isYouTube) return input;

  let videoId = "";
  if (ytHost === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else {
    if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else {
      videoId = parsed.searchParams.get("v") || "";
    }
  }
  if (!videoId) return input;

  const startParam = parsed.searchParams.get("start");
  const tParam = parsed.searchParams.get("t");
  const start = startParam ? parseInt(startParam, 10) : parseYouTubeTime(tParam);

  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
    playsinline: "1",
    mute: "0",
    controls: "1",
  });
  try {
    const orig = (typeof window !== "undefined" && window.location?.origin) || "";
    if (canUseOriginAndJSAPI && orig && /^https:\/\//i.test(orig)) {
      params.set("origin", orig);
    }
  } catch {}

  if (Number.isFinite(start) && start > 0) params.set("start", String(start));

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    videoId
  )}?${params.toString()}`;
}

export function getProviderUrl(provider, id, slug = "") {
  if (!provider || !id) return "#";

  const normalizedProvider = provider.toString().trim().toLowerCase();
  const cleanId = id.toString().trim();
  const cleanSlug = slug.toString().trim();

  switch (normalizedProvider) {
    case "imdb":
      return `https://www.imdb.com/title/${cleanId}/`;
    case "tmdb":
      return `https://www.themoviedb.org/movie/${cleanId}`;
    case "tvdb": {
      const pathSegment = cleanSlug || cleanId;
      const isSeries = /series/i.test(pathSegment) || /^series[-_]/i.test(pathSegment);
      return `https://www.thetvdb.com/${isSeries ? "series" : "movies"}/${pathSegment}`;
    }
    default:
      return "#";
  }
}

export function debounce(func, wait = 300, immediate = false) {
  let timeout;
  return function (...args) {
    const context = this;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function __jmsIsHoverDesktop() {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  } catch { return false; }
}

export function ensureJmsDetailsOverlay({
  hostEl,
  itemId,
  serverId,
  detailsHref,
  onDetails,
  onPlay,
  showPlay = true,
} = {}) {
  if (!hostEl || !itemId) return null;

  const _detailsHref =
    detailsHref ||
    (itemId && serverId ? `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}` : null);

  try {
    const cs = getComputedStyle(hostEl);
    if (cs.position === "static") hostEl.style.position = "relative";
  } catch {}

  let wrap = hostEl.querySelector(".jms-details-overlay");
  if (wrap) return wrap;

  const isHoverDesktop = __jmsIsHoverDesktop();

  wrap = document.createElement("div");
  wrap.className = "jms-details-overlay";
  Object.assign(wrap.style, {
    position: "absolute",
    left: "clamp(10px, 1vw, 22px)",
    bottom: "clamp(10px, 1vw, 22px)",
    zIndex: "999999",
    pointerEvents: "none",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  });

  if (isHoverDesktop) {
    wrap.dataset.hoverOnly = "1";
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jms-details-btn";
  btn.setAttribute("aria-label", "Ayrıntılar");

  const arrowIcon = document.createElement("span");
  arrowIcon.className = "jms-details-arrow";
  arrowIcon.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5v14M5 12l7 7 7-7"/>
    </svg>
  `;
  btn.appendChild(arrowIcon);

  Object.assign(btn.style, {
    pointerEvents: "auto",
    cursor: "pointer",
    borderRadius: "50%",
    padding: "16px",
    border: "2px solid rgba(255,255,255,0.25)",
    background: "rgba(15,23,42,.62)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  });

  if (isHoverDesktop) {
    btn.style.opacity = "0";
    btn.style.transform = "translateY(4px)";
    btn.style.pointerEvents = "none";
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (typeof onDetails === "function") {
      try { await onDetails(e); return; } catch {}
    }

    if (_detailsHref) {
      try { window.location.hash = String(_detailsHref).replace(/^#/, ""); }
      catch { window.location.href = _detailsHref; }
    }
  });

  wrap.appendChild(btn);

  if (showPlay) {
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "jms-play-btn";
    playBtn.setAttribute("aria-label", "Şimdi Oynat");
    playBtn.innerHTML = `
      <span class="jms-play-icon" style="display:flex;align-items:center;justify-content:center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      </span>
    `;
    Object.assign(playBtn.style, {
      pointerEvents: "auto",
      cursor: "pointer",
      borderRadius: "50%",
      padding: "16px",
      border: "2px solid rgba(255,255,255,0.25)",
      background: "rgba(15,23,42,.62)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    });

    if (isHoverDesktop) {
      playBtn.style.opacity = "0";
      playBtn.style.transform = "translateY(4px)";
      playBtn.style.pointerEvents = "none";
    }

    playBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onPlay === "function") {
        try { await onPlay(); } catch {}
      }
    });

  wrap.appendChild(playBtn);
  }

  hostEl.appendChild(wrap);

  if (isHoverDesktop) {
    const show = () => wrap.classList.add("is-hover");
    const hide = () => wrap.classList.remove("is-hover");
    hostEl.addEventListener("mouseenter", show, { passive: true });
    hostEl.addEventListener("mouseleave", hide, { passive: true });
    try {
      if (hostEl.matches(":hover")) show();
    } catch {}
  }
  return wrap;
}

export function createTrailerIframe({ config, RemoteTrailers, slide, backdropImg, itemId, serverId, detailsUrl, detailsText }) {
  if (config?.disableAllPlayback === true) {
    try {
      slide?.classList.remove("video-active", "intro-active", "trailer-active");
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
    return;
  }

  try {
    const cs = getComputedStyle(slide);
    if (cs.position === "static") slide.style.position = "relative";
  } catch {}

  const _detailsHref =
  detailsUrl ||
  (itemId && serverId ? `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}` : null);

  let arrowIntervalId = null;

  function ensureDetailsOverlay() {
    if (!_detailsHref || !slide) return null;
    const wrap = ensureJmsDetailsOverlay({
      hostEl: slide,
      itemId,
      serverId,
      detailsHref: _detailsHref,
      onDetails: async (e) => {
  try {
    isMouseOver = false;
    latestHoverId++;
    abortController?.abort?.("details-modal");
    abortController = new AbortController();
    if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    try { fullCleanup(); } catch {}
    const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    const origin = backdropImg || slide;

    await openDetailsModal({
      itemId,
      serverId,
      preferBackdropIndex: backdropIndex,
      originEl: origin
    });
  } catch (err) {
    console.error("openDetailsModal error:", err);
    navigateToDetails();
  }
},
      onPlay: async () => {
        try {
          isMouseOver = false;
          latestHoverId++;
          abortController?.abort?.("playnow");
          abortController = new AbortController();
          if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
          try { fullCleanup(); } catch {}
          await playNow(itemId);
        } catch (err) {
          console.error("PlayNow click error:", err);
          if (typeof window.showMessage === "function") {
            window.showMessage("PlayNow çalıştırılırken hata oluştu", "error");
          }
        }
      },
      showPlay: true,
    });
    return wrap;
  }

    function navigateToDetails() {
    try {
      isMouseOver = false;
      latestHoverId++;
      abortController?.abort?.("navigate");
      abortController = new AbortController();
      if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    } catch {}

    try { fullCleanup(); } catch {}
    try { detachGuards?.(); } catch {}
    try { classObserver?.disconnect(); } catch {}

    try {
      window.location.hash = String(_detailsHref || "").replace(/^#/, "");
    } catch {
      window.location.href = _detailsHref;
    }
  }

  function showDetailsOverlay() {
    const wrap = ensureDetailsOverlay();
    if (wrap) wrap.style.display = "flex";
  }

  function hideDetailsOverlay() {
    const wrap = slide?.querySelector?.(".jms-details-overlay");
    if (wrap) wrap.style.display = "none";
  }

  const isActiveSlide = () => slide?.classList?.contains('active');
  const savedMode = localStorage.getItem("previewPlaybackMode");
  const mode =
    savedMode === "trailer" ||
    savedMode === "video" ||
    savedMode === "trailerThenVideo"
      ? savedMode
      : config.enableTrailerPlayback
      ? "trailer"
      : "video";

  if (!itemId) return;

  const videoContainer = document.createElement("div");
  videoContainer.className = "intro-video-container";
  Object.assign(videoContainer.style, {
    width: "70%",
    height: "100%",
    border: "none",
    display: "none",
    position: "absolute",
    top: "0%",
    right: "0%",
  });

  const videoElement = document.createElement("video");
  videoElement.controls = true;
  videoElement.dataset.jmsPreview = "1";
  videoElement.dataset.jmsIgnorePauseOverlay = "1";
  videoElement.muted = false;
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.transition = "opacity 0.2s ease-in-out";
  videoElement.style.opacity = "0";

  videoContainer.appendChild(videoElement);
  slide.appendChild(videoContainer);

  function setPreviewPlaybackFlag(kind, itemId) {
  try {
    window.__JMS_PREVIEW_PLAYBACK = {
      active: true,
      kind,
      itemId: itemId || null,
      startedAt: Date.now()
    };
  } catch {}
}

function clearPreviewPlaybackFlag() {
  try {
    const cur = window.__JMS_PREVIEW_PLAYBACK;
    if (cur) window.__JMS_PREVIEW_PLAYBACK = { active: false };
  } catch {}
}

  let ytIframe = null;
  let playingKind = null;
  let isMouseOver = false;
  let latestHoverId = 0;
  let abortController = new AbortController();
  let enterTimeout = null;
  let detachGuards = null;

  const _detailsCache = new Map();

  async function getDetailsCached(id, { signal } = {}) {
    if (!id) return null;
    if (_detailsCache.has(id)) return _detailsCache.get(id);
    try {
      const d = await fetchItemDetails(id, { signal });
      _detailsCache.set(id, d || null);
      return d || null;
    } catch {
      _detailsCache.set(id, null);
      return null;
    }
  }

  function ticksToSeconds(ticks) {
    const n = Number(ticks) || 0;
    return n > 0 ? (n / 10_000_000) : 0;
  }

  async function getSmartStartSeconds(id, { signal } = {}) {
    const LEGACY = 600;
    const d = await getDetailsCached(id, { signal });
    const type = (d?.Type || "").toString();

    if (type === "Audio" || type === "MusicAlbum" || type === "AudioBook") return 0;

    const durSec =
      ticksToSeconds(d?.RunTimeTicks) ||
      ticksToSeconds(d?.CumulativeRunTimeTicks) ||
      0;

    if (durSec > 0 && durSec < 12 * 60) return 0;
    if (durSec > 0) return Math.max(0, Math.min(LEGACY, Math.max(0, durSec - 30)));

    return LEGACY;
  }

  const enableHls = config.enableHls === true;
  const delayRaw = config && (config.gecikmeSure ?? config.gecikmesure);
  const delay = Number.isFinite(+delayRaw) ? +delayRaw : 500;

  const canUseYTApiPostMessage = (() => {
    try {
      const isHttps = window.location.protocol === "https:";
      const host = new URL(window.location.href).hostname;
      const isPrivateHost = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
      return isHttps && !isPrivateHost;
    } catch { return false; }
  })();

  const stopYoutube = (iframe) => {
    try {
      if (!canUseYTApiPostMessage) return;
      if (!iframe) return;
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "stopVideo", args: [] }),
        "*"
      );
    } catch {}
  };

  const destroyHlsIfAny = () => {
    if (videoElement.hls) {
      try {
        videoElement.hls.destroy();
      } catch {}
      delete videoElement.hls;
    }
  };

  const hardStopVideo = () => {
    clearPreviewPlaybackFlag();
    try {
      videoElement.pause();
    } catch {}
    destroyHlsIfAny();
    try {
      videoElement.removeAttribute("src");
      videoElement.load();
    } catch {}
    videoContainer.style.display = "none";
    videoElement.style.opacity = "0";
    slide.classList.remove("video-active", "intro-active", "trailer-active");
  };

  const hardStopIframe = () => {
    clearPreviewPlaybackFlag();
    if (ytIframe) {
      try { stopYoutube(ytIframe); } catch {}
      try { ytIframe.src = "about:blank"; } catch {}
      try { ytIframe.remove(); } catch {}
      ytIframe = null;
    }
    slide.classList.remove("trailer-active");
  };

  const fullCleanup = () => {
    clearPreviewPlaybackFlag();
    hideDetailsOverlay();
    hardStopVideo();
    hardStopIframe();
    try {
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
    if (arrowIntervalId) { clearInterval(arrowIntervalId); arrowIntervalId = null; }
    playingKind = null;
  };

  async function loadStreamFor(itemIdToPlay, hoverId, startSeconds = 0) {
    const introUrl = await getVideoStreamUrl(
      itemIdToPlay,
      1920,
      0,
      null,
      ["h264"],
      ["aac"],
      false,
      false,
      enableHls,
      { signal: abortController.signal }
    );
    if (!isMouseOver || hoverId !== latestHoverId) throw new Error("HoverAbortError");
    if (!introUrl || introUrl === "null") return false;

    if (
      enableHls &&
      typeof window.Hls !== "undefined" &&
      window.Hls.isSupported() &&
      introUrl &&
      /\.m3u8(\?|$)/.test(introUrl)
    ) {
      const hls = new window.Hls();
      videoElement.hls = hls;
      hls.loadSource(introUrl);
      hls.attachMedia(videoElement);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (!isMouseOver || hoverId !== latestHoverId) {
          destroyHlsIfAny();
          return;
        }
        videoElement.currentTime = startSeconds;
        videoElement
          .play()
          .then(() => {
            videoElement.style.opacity = "1";
          })
          .catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        console.error("HLS ERROR", data);
        if (data.fatal) fullCleanup();
      });
    } else {
      videoElement.src = introUrl;
      videoElement.load();
      const onMeta = () => {
        videoElement.removeEventListener("loadedmetadata", onMeta);
        if (!isMouseOver || hoverId !== latestHoverId) {
          fullCleanup();
          return;
        }
        videoElement.currentTime = startSeconds;
        videoElement
          .play()
          .then(() => {
            videoElement.style.opacity = "1";
          })
          .catch(() => {});
      };
      videoElement.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    return true;
  }

  async function tryPlayLocalTrailer(hoverId) {
    if (!isActiveSlide()) return false;
    const locals = await fetchLocalTrailers(itemId, { signal: abortController.signal });
    if (!isMouseOver || hoverId !== latestHoverId || !isActiveSlide()) throw new Error("HoverAbortError");
    const best = pickBestLocalTrailer(locals);
    if (!best?.Id) return false;

    if (!isActiveSlide()) return false;
    if (backdropImg) backdropImg.style.opacity = "0";
    hardStopIframe();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "localTrailer";
    setPreviewPlaybackFlag("localTrailer", best.Id);
    await loadStreamFor(best.Id, hoverId, 0);
    return true;
  }

  async function tryPlayRemoteTrailer(_hoverId) {
    if (!isActiveSlide()) return false;
    const trailer = Array.isArray(RemoteTrailers) && RemoteTrailers.length ? RemoteTrailers[0] : null;
    if (!trailer?.Url) return false;

    const url = getYoutubeEmbedUrl(trailer.Url);
    if (!isValidUrl(url) || !isActiveSlide()) return false;

    if (backdropImg) backdropImg.style.opacity = "0";
    hardStopVideo();

    if (!ytIframe) {
      ytIframe = document.createElement("iframe");
      ytIframe.dataset.jmsPreview = "1";
      ytIframe.dataset.jmsIgnorePauseOverlay = "1";
      ytIframe.allow = "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.referrerPolicy = "origin-when-cross-origin";
      "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.setAttribute("playsinline", "");
      ytIframe.allowFullscreen = true;
      Object.assign(ytIframe.style, {
        width: "70%",
        height: "100%",
        border: "none",
        display: "none",
        position: "absolute",
        top: "0%",
        right: "0%",
        bottom: "0",
      });
      slide.appendChild(ytIframe);
    }

    if (!isActiveSlide()) return false;
    ytIframe.style.display = "block";
    ytIframe.src = url;
    showDetailsOverlay();
    slide.classList.add("trailer-active");
    playingKind = "remoteTrailer";
    setPreviewPlaybackFlag("remoteTrailer", itemId);
    return true;
  }

  async function playMainVideo(hoverId) {
    if (!isActiveSlide()) return false;
    if (backdropImg) backdropImg.style.opacity = "0";
    hardStopIframe();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "video";
    setPreviewPlaybackFlag("videoPreview", itemId);
    const startSeconds = await getSmartStartSeconds(itemId, { signal: abortController.signal });
    const ok = await loadStreamFor(itemId, hoverId, startSeconds);
    if (!ok) {
      fullCleanup();
      return false;
    }
    return true;
  }

  const handleEnter = () => {
    if (!isActiveSlide()) return;

    isMouseOver = true;
    showDetailsOverlay();
    latestHoverId++;
    const thisHoverId = latestHoverId;
    abortController.abort("hover-cancel");
    abortController = new AbortController();

    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }

    enterTimeout = setTimeout(async () => {
      if (!isMouseOver || thisHoverId !== latestHoverId || !isActiveSlide()) return;
      try {
        if (mode === "video") {
          if (await playMainVideo(thisHoverId)) return;
        } else {
          if (await tryPlayLocalTrailer(thisHoverId)) return;
          if (await tryPlayRemoteTrailer(thisHoverId)) return;
          if (mode === "trailerThenVideo") {
            if (await playMainVideo(thisHoverId)) return;
          } else {
            fullCleanup();
          }
        }
      } catch (e) {
        if (e.name === "AbortError" || e.message === "HoverAbortError") return;
        console.error("Hover/play error:", e);
        fullCleanup();
      }
    }, delay);
  };

  const handleLeave = () => {
    isMouseOver = false;
    latestHoverId++;
    abortController.abort("hover-cancel");
    abortController = new AbortController();
    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }
    fullCleanup();
  };

  function attachAutoCleanupGuards(slideEl) {
    const cleanups = [];

    const viewport =
      slideEl.closest(".swiper") ||
      slideEl.closest(".splide__track") ||
      slideEl.closest(".embla__viewport") ||
      slideEl.closest(".flickity-viewport") ||
      slideEl.closest("[data-slider-viewport]") ||
      null;

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === slideEl) {
              const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
              if (!visible) handleLeave();
            }
          }
        },
        { root: viewport || null, threshold: [0, 0.5, 1] }
      );
      io.observe(slideEl);
      cleanups.push(() => io.disconnect());
    }

    const mo = new MutationObserver(() => {
      if (!document.body.contains(slideEl)) {
        try {
          handleLeave();
        } catch {}
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => mo.disconnect());

    const onVis = () => {
      if (document.hidden) handleLeave();
    };
    document.addEventListener("visibilitychange", onVis);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVis));
    const onPageHide = () => handleLeave();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    cleanups.push(() => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    });

    const swiperHost = slideEl.closest(".swiper");
    const swiperInst = swiperHost && swiperHost.swiper;
    if (swiperInst?.on && swiperInst?.off) {
      const onSwiperChange = () => handleLeave();
      swiperInst.on("slideChangeTransitionStart", onSwiperChange);
      swiperInst.on("slideChange", onSwiperChange);
      swiperInst.on("transitionStart", onSwiperChange);
      cleanups.push(() => {
        try {
          swiperInst.off("slideChangeTransitionStart", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("slideChange", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("transitionStart", onSwiperChange);
        } catch {}
      });
    }

    const splideRoot = slideEl.closest(".splide");
    const splideInst = splideRoot && (splideRoot.__splide || window.splide);
    if (splideInst?.on && splideInst?.off) {
      const onMove = () => handleLeave();
      splideInst.on("move", onMove);
      splideInst.on("moved", onMove);
      cleanups.push(() => {
        try {
          splideInst.off("move", onMove);
        } catch {}
        try {
          splideInst.off("moved", onMove);
        } catch {}
      });
    }

    const flktyRoot = slideEl.closest(".flickity-enabled");
    const flktyInst = flktyRoot && flktyRoot.flickity;
    if (flktyInst?.on && flktyInst?.off) {
      const onChange = () => handleLeave();
      flktyInst.on("change", onChange);
      flktyInst.on("select", onChange);
      cleanups.push(() => {
        try {
          flktyInst.off("change", onChange);
        } catch {}
        try {
          flktyInst.off("select", onChange);
        } catch {}
      });
    }

    const emblaViewport = slideEl.closest(".embla__viewport");
    const emblaInst = emblaViewport && emblaViewport.__embla;
    if (emblaInst?.on) {
      const onSelect = () => handleLeave();
      const onReInit = () => handleLeave();
      emblaInst.on("select", onSelect);
      emblaInst.on("reInit", onReInit);
      cleanups.push(() => {
        try {
          emblaInst.off("select", onSelect);
        } catch {}
        try {
          emblaInst.off("reInit", onReInit);
        } catch {}
      });
    }

    return () => cleanups.forEach((fn) => { try { fn(); } catch {} });
  }

  let lastActive = isActiveSlide();
  let leavingLock = false;
  detachGuards = attachAutoCleanupGuards(slide);

  const classObserver = new MutationObserver(() => {
  const nowActive = isActiveSlide();

    if (lastActive && !nowActive && !leavingLock) {
      leavingLock = true;
      (typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn))(() => {
        try { handleLeave(); } finally { leavingLock = false; }
      });
    }

    lastActive = nowActive;
  });

  classObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });

  const hoverTarget = slide;
  hoverTarget.addEventListener("mouseenter", handleEnter, { passive: true });
  hoverTarget.addEventListener("mouseleave", handleLeave, { passive: true });

  const mo = new MutationObserver(() => {
    if (!document.body.contains(slide)) {
      try { hoverTarget.removeEventListener("mouseenter", handleEnter); } catch {}
      try { hoverTarget.removeEventListener("mouseleave", handleLeave); } catch {}
      try { detachGuards?.(); } catch {}
      try { classObserver.disconnect(); } catch {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

const _bestBackdropCache = new Map();

export function ensureImagePreconnect() {
  let host = "";
  try {
    host = new URL(S("/")).origin;
  } catch {
    host = window.location?.origin || "";
  }
  if (!host) return;
  if (document.querySelector(`link[rel="preconnect"][href="${host}"]`)) return;
  const l = document.createElement("link");
  l.rel = "preconnect";
  l.href = host;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

let _supportsWebP;
export function supportsWebP() {
  if (_supportsWebP != null) return _supportsWebP;
  try {
    _supportsWebP = document.createElement("canvas").toDataURL("image/webp").includes("webp");
  } catch {
    _supportsWebP = false;
  }
  return _supportsWebP;
}

export function warmImageOnce(url) {
  if (!url) return;
  const abs = S(url);
  if (document.querySelector(`link[rel="preload"][as="image"][href="${abs}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = abs;
  try { link.fetchPriority = "high"; } catch {}
  document.head.appendChild(link);
}

export function idleWarmImages(urls = []) {
  const doWarm = () => urls.forEach((u) => warmImageOnce(u));
  const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  ric(doWarm, { timeout: 800 });
}

export function buildBackdropResponsive(item, index = "0", cfg = getConfig()) {
  const pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const maxTarget = Math.max(1280, (cfg.backdropMaxWidth || 1920) * pixelRatio);
  const fmt = supportsWebP() ? "&format=webp" : "";
  const tag = (item.ImageTags?.Backdrop?.[index] || "").toString();
  const id = item.Id;

  const widths = [1280, 1920, 2560, 3840].filter((w) => w <= 1.25 * maxTarget);

  const src = S(`/Items/${id}/Images/Backdrop/${index}?tag=${tag}&quality=90&maxWidth=${Math.floor(
     maxTarget
  )}${fmt}`);
  const srcset = withServerSrcset(
  widths
    .map(
      (w) =>
        `/Items/${id}/Images/Backdrop/${index}?tag=${tag}&quality=90&maxWidth=${w}${fmt} ${w}w`
    )
    .join(", ")
);

   return { src, srcset, sizes: "100vw" };
 }

export async function getHighestQualityBackdropIndex(itemId, { signal } = {}) {
  const cfg = getConfig();
  if (cfg.indexZeroSelection) return "0";
  if (_bestBackdropCache.has(itemId)) return _bestBackdropCache.get(itemId);
  let details;
  try {
    details = await fetchItemDetails(itemId, { signal });
  } catch {
    return "0";
  }
  const tags = details?.BackdropImageTags || [];
  if (!tags.length) return "0";
  if (cfg.manualBackdropSelection) return "0";
  const maxProbe = Number(cfg.limit ?? 6);
  const idxList = Array.from({ length: Math.min(maxProbe, tags.length) }, (_, i) => String(i));
  const results = [];
  const conc = 3;
  for (let i = 0; i < idxList.length; i += conc) {
    const batch = idxList.slice(i, i + conc);
    await Promise.all(
      batch.map(async (idxStr) => {
        const url = S(`/Items/${itemId}/Images/Backdrop/${idxStr}`);
        const bytes = await getImageSizeInBytes(url, { signal }).catch(() => NaN);
        if (Number.isFinite(bytes)) {
          results.push({ index: idxStr, kb: bytes / 1024 });
        }
      })
    );
  }

  if (!results.length) return "0";
  const useSizeFilter = Boolean(cfg.enableImageSizeFilter ?? false);
  const minKB = Number(cfg.minImageSizeKB ?? 800);
  const maxKB = Number(cfg.maxImageSizeKB ?? 1500);

  let best;
  if (useSizeFilter) {
    const inRange = results.filter((r) => r.kb >= minKB && r.kb <= maxKB);
    if (inRange.length) {
      best = inRange.reduce((a, b) => (b.kb > a.kb ? b : a));
    } else {
      best = results.reduce((a, b) => (b.kb > a.kb ? b : a));
    }
  } else {
    best = results.reduce((a, b) => (b.kb > a.kb ? b : a));
  }

  const chosen = best?.index ?? "0";
  _bestBackdropCache.set(itemId, chosen);
  return chosen;
}

async function kbInRange(url, minKB, maxKB) {
  const bytes = await getImageSizeInBytes(url).catch(() => NaN);
  if (!Number.isFinite(bytes)) return false;
  const kb = bytes / 1024;
  return kb >= minKB && kb <= maxKB;
}

async function getImageSizeInBytes(url, { signal } = {}) {
  try {
    const res = await fetch(S(url), {
      method: "HEAD",
      headers: { Authorization: getAuthHeader() },
      signal,
    });
    const size = res.headers.get("Content-Length") || res.headers.get("content-length");
    if (!size) throw new Error("Content-Length yok");
    const n = parseInt(size, 10);
    if (!Number.isFinite(n)) throw new Error("Content-Length parse edilemedi");
    return n;
  } catch {
    return NaN;
  }
}

export function prefetchImages(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  window.addEventListener(
    "load",
    () => {
      urls.forEach((url) => {
        if (!url) return;
        const abs = S(url);
        if (document.querySelector(`link[rel="prefetch"][href="${abs}"]`)) return;
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = abs;
        document.head.appendChild(link);
      });
    },
    { once: true }
  );
}

export async function getHighResImageUrls(item, backdropIndex) {
  const itemId = item.Id;
  const imageTag = item.ImageTags?.Primary || "";
  const logoTag = item.ImageTags?.Logo || "";
  const pixelRatio = window.devicePixelRatio || 1;
  const logoHeight = Math.floor(720 * pixelRatio);
  const fmt = supportsWebP() ? "&format=webp" : "";
  const index = backdropIndex !== undefined ? backdropIndex : "0";
  const backdropMaxWidth = (config.backdropMaxWidth || 1920) * pixelRatio;
  const backdropTag = item.ImageTags?.Backdrop?.[index] || "";

  const backdropUrl = S(`/Items/${itemId}/Images/Backdrop/${index}?tag=${backdropTag}&quality=90&maxWidth=${Math.floor(
    backdropMaxWidth
  )}${fmt}`);
  const placeholderUrl = S(`/Items/${itemId}/Images/Primary?tag=${imageTag}&maxHeight=50&blur=15`);
  const logoUrl = S(`/Items/${itemId}/Images/Logo?tag=${logoTag}&quality=90&maxHeight=${logoHeight}${fmt}`);

  return { backdropUrl, placeholderUrl, logoUrl };
}

export function createImageWarmQueue({ concurrency = 3 } = {}) {
  const q = [];
  let active = 0;

  const runNext = () => {
    if (!q.length || active >= concurrency) return;
    const job = q.shift();
    active++;
    (async () => {
      try {
        if (job.shortPreload) {
          const link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          try { link.fetchPriority = 'low'; } catch {}
          link.href = S(job.url);
          document.head.appendChild(link);
          setTimeout(() => link.remove(), 1500);
        }
        await new Promise((res) => {
          const img = new Image();
          img.decoding = 'async';
          img.loading = 'eager';
          img.src = S(job.url);
          img.onload = async () => {
            try { await img.decode?.(); } catch {}
            res();
          };
          img.onerror = () => res();
        });
      } finally {
        active--;
        runNext();
      }
    })();
  };
  const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));

  function enqueue(url, { shortPreload = true } = {}) {
    if (!url) return;
    enqueue._seen ||= new Set();
    if (enqueue._seen.has(url)) return;
    enqueue._seen.add(url);
    q.push({ url, shortPreload });
    ric(runNext, { timeout: 1000 });
  }
  return { enqueue };
}
