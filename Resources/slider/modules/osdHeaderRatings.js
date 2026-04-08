import { getSessionInfo, getAuthHeader } from "/Plugins/JMSFusion/runtime/api.js";
import { getConfig, getPauseFeaturesRuntimeConfig } from "./config.js";
import { getTomatoIconHtml } from "./customIcons.js";

const HOST_ID = "jms-osd-header-ratings-v4";
const SESSION_POLL_INTERVAL_MS = 10_000;

function getCommunityRatingValue(communityRating) {
  const raw = Array.isArray(communityRating)
    ? communityRating.reduce((sum, value) => sum + Number(value || 0), 0) /
      Math.max(1, communityRating.length)
    : Number(communityRating);

  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 10) / 10;
}

function getOsdHeaderRatingsState(cfg = {}) {
  const pauseCfg = cfg?.pauseOverlay || {};
  const hasPauseKey = (key) =>
    Object.prototype.hasOwnProperty.call(pauseCfg, key);
  const pauseRuntime = getPauseFeaturesRuntimeConfig(cfg);

  return {
    enabled: pauseRuntime.enablePauseOsdHeaderRatings && (
      hasPauseKey("showOsdHeaderRatings")
        ? pauseCfg.showOsdHeaderRatings !== false
        : cfg?.showRatingInfo !== false
    ),
    showCommunity: hasPauseKey("showOsdHeaderCommunityRating")
      ? pauseCfg.showOsdHeaderCommunityRating !== false
      : cfg?.showCommunityRating !== false,
    showCritic: hasPauseKey("showOsdHeaderCriticRating")
      ? pauseCfg.showOsdHeaderCriticRating !== false
      : cfg?.showCriticRating !== false,
    showOfficial: hasPauseKey("showOsdHeaderOfficialRating")
      ? pauseCfg.showOsdHeaderOfficialRating !== false
      : !!cfg?.showOfficialRating
  };
}

function shouldRenderRatings(cfg = {}) {
  const ratingsState = getOsdHeaderRatingsState(cfg);
  if (!ratingsState.enabled) return false;
  return (
    ratingsState.showCommunity ||
    ratingsState.showCritic ||
    ratingsState.showOfficial
  );
}

function isPlaybackScreenActive() {
  const hasControls = !!document.querySelector(
    ".videoOsdBottom.videoOsdBottom-maincontrols .buttons"
  );
  const hasPlayerContainer = !!document.querySelector(".videoPlayerContainer");
  const hasVideo = !!document.querySelector(
    ".videoPlayerContainer video.htmlvideoplayer, .videoPlayerContainer video"
  );
  return hasControls || (hasPlayerContainer && hasVideo);
}

function pickOsdHeaderAndTitleEl() {
  const header =
    document.querySelector(".skinHeader.osdHeader") ||
    document.querySelector(".skinHeader.focuscontainer-x.osdHeader") ||
    document.querySelector(".osdHeader") ||
    document.querySelector(".skinHeader");

  if (!header) return { header: null, titleEl: null };

  const titleEl =
    header.querySelector(".pageTitle") ||
    header.querySelector(".headerTitle") ||
    header.querySelector(".headerLeft .title") ||
    header.querySelector("h1,h2,.sectionTitle,.headerName") ||
    null;

  return { header, titleEl };
}

function syncHostPlacement(titleEl, host) {
  if (!(titleEl instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
  if (
    host.parentElement !== titleEl.parentElement ||
    host.previousElementSibling !== titleEl
  ) {
    titleEl.insertAdjacentElement("afterend", host);
  }
}

function ensureHost() {
  const { header, titleEl } = pickOsdHeaderAndTitleEl();
  if (!header || !titleEl) return null;

  let host = header.querySelector(`#${HOST_ID}`);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;

    Object.assign(host.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      color: 'rgb(255, 255, 255)',
      fontWeight: '600',
      alignSelf: 'center',
      lineHeight: '1',
      opacity: '1',
      transform: 'translate3d(0px, 0px, 0px)',
      transition: 'opacity 0.25s ease-in-out, transform 0.25s ease-in-out',
      willChange: 'opacity, transform',
      padding: '4px 6px',
      margin: '0 0 0 .3em'
    });
  }
  syncHostPlacement(titleEl, host);
  return host;
}

function removeExistingHost() {
  const host = document.getElementById(HOST_ID);
  if (!host) return false;
  host.innerHTML = "";
  host.remove();
  return true;
}

async function fetchSessions() {
  const s =
    (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
  const headers = {
    "X-Emby-Authorization":
      typeof getAuthHeader === "function" ? getAuthHeader() : "",
    "X-Emby-Token": s.accessToken || "",
  };

  const url = `/Sessions?ActiveWithinSeconds=120`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sessions HTTP ${res.status}`);
  return await res.json();
}

function pickBestNowPlayingSession(sessions, userId) {
  const list = Array.isArray(sessions) ? sessions : [];
  const candidates = list.filter((x) => {
    if (!x) return false;
    if (userId && String(x.UserId || "") !== String(userId)) return false;
    return !!x.NowPlayingItem;
  });
  if (!candidates.length) return null;

  const score = (sess) => {
    const last = Date.parse(sess.LastActivityDate || "") || 0;
    const isPaused = !!sess.PlayState?.IsPaused;
    return last + (isPaused ? -5000 : 0);
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0];
}

function buildStarRatingHtml(communityRating) {
  const ratingValue = getCommunityRatingValue(communityRating);
  if (ratingValue == null) return "";
  const ratingPercentage = ratingValue * 10;

  return `
    <span class="jms-rating-container" data-jms-rating="star" style="opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;">
      <span class="jms-star-wrapper" aria-label="Community rating">
        <span class="jms-star-box">
          <span class="jms-star-filled" style="clip-path: inset(${100 - ratingPercentage}% 0 0 0);">
            <i class="fa-solid fa-star" data-jms-star="full"></i>
          </span>
          <i class="fa-regular fa-star" data-jms-star="empty"></i>
        </span>
      </span>
      <span class="jms-rating-value">${ratingValue}</span>
    </span>
  `.trim();
}

function buildTomatoHtml(criticRating) {
  const raw = Array.isArray(criticRating) ? criticRating[0] : criticRating;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";

  return `
    <span class="jms-tomato-container" data-jms-rating="tomato" style="opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;">
      ${getTomatoIconHtml({ size: "1.25em" })}
      <span class="jms-tomato-value">${Math.round(n)}</span>
    </span>
  `.trim();
}

function buildOfficialHtml(officialRating) {
  const v = String(
    Array.isArray(officialRating) ? officialRating[0] : officialRating || ""
  ).trim();
  if (!v) return "";
  return `
    <span class="jms-official-container" data-jms-rating="official" style="opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;">
      <i class="fa-solid fa-user-group"></i>
      <span class="jms-official-value">${v}</span>
    </span>
  `.trim();
}

function applyModernStyles(host) {
  if (!host) return;

  Object.assign(host.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    alignSelf: "center",
    lineHeight: "1",
    color: "#fff",
  });

  host.querySelectorAll(".jms-rating-container, .jms-tomato-container, .jms-official-container").forEach((container) => {
    if (!(container instanceof HTMLElement)) return;

    Object.assign(container.style, {
      display: "flex",
      alignItems: "center",
      gap: "3px",
      pointerEvents: "none",
      userSelect: "none",
      lineHeight: "1",
      color: "#fff",
      fontWeight: "650",
      fontSize: "0.9em",
      justifyContent: 'center',
    });
  });

  host.querySelectorAll(".jms-star-wrapper").forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    Object.assign(wrapper.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: "1",
    });
  });

  host.querySelectorAll(".jms-star-box").forEach((box) => {
    if (!(box instanceof HTMLElement)) return;

    Object.assign(box.style, {
      position: "relative",
      display: "inline-grid",
    });
  });

  host.querySelectorAll(".jms-star-filled").forEach((filled) => {
    if (!(filled instanceof HTMLElement)) return;

    Object.assign(filled.style, {
      position: "absolute",
      inset: "0",
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "1"
    });
  });

  host.querySelectorAll('[data-jms-star="empty"]').forEach((star) => {
    if (!(star instanceof HTMLElement)) return;

    Object.assign(star.style, {
      position: "relative",
      zIndex: "2",
      padding: "0",
      lineHeight: "1",
      color: "#ffffff",
      opacity: "0.95",
      WebkitTextStroke: "0.6px rgba(0,0,0,0.55)"
    });
  });

  host.querySelectorAll('[data-jms-star="full"]').forEach((star) => {
    if (!(star instanceof HTMLElement)) return;

    Object.assign(star.style, {
      position: "relative",
      zIndex: "1",
      padding: "0",
      lineHeight: "1",
      color: "#ffd54a",
      opacity: "1",
      display: "block"
    });
  });

  host.querySelectorAll(".jms-rating-value, .jms-tomato-value, .jms-official-value").forEach((value) => {
    if (!(value instanceof HTMLElement)) return;

    Object.assign(value.style, {
      color: "#ffffff",
      textShadow: "0 1px 2px rgba(0,0,0,0.75)",
      fontWeight: "700",
      letterSpacing: "0.01em"
    });
  });

  host.querySelectorAll(".jms-rating-value").forEach((value) => {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#ffe082";
  });

  host.querySelectorAll(".jms-tomato-value").forEach((value) => {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#ffd0c7";
  });

  host.querySelectorAll(".jms-official-value").forEach((value) => {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#d8e6ff";
  });

}

function addAnimationStyles() {
  if (document.getElementById("jms-rating-animations")) return;

  const style = document.createElement("style");
  style.id = "jms-rating-animations";
  style.textContent = `
    @keyframes jmsRatingFadeIn {
      0% {
        opacity: 0;
        transform: scale(0.9);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes jmsRatingFadeOut {
      0% {
        opacity: 1;
        transform: scale(1);
      }
      100% {
        opacity: 0;
        transform: scale(0.9);
      }
    }
  .headerLeft .pageTitle {
        display: flex !important;
    }
  `;
  document.head.appendChild(style);
}

function animateHost(host, show) {
  if (!host) return;

  if (show) {
    host.style.display = "inline-flex";
    requestAnimationFrame(() => {
      Object.assign(host.style, {
        opacity: "1",
        transform: "translate3d(0,0,0)"
      });
    });
  } else {
    Object.assign(host.style, {
      opacity: "0",
      transform: "translate3d(-10px,0,0)"
    });

    setTimeout(() => {
      if (host.style.opacity === "0") {
        host.style.display = "none";
      }
    }, 250);
  }
}

function render(host, item, cfg) {
  if (!host) return;

  if (!item) {
    host.innerHTML = "";
    animateHost(host, false);
    return;
  }

  const ratingsState = getOsdHeaderRatingsState(cfg);
  if (!ratingsState.enabled) {
    host.innerHTML = "";
    animateHost(host, false);
    return;
  }

  const communityHtml = ratingsState.showCommunity ? buildStarRatingHtml(item.CommunityRating) : "";
  const tomatoHtml = ratingsState.showCritic ? buildTomatoHtml(item.CriticRating) : "";
  const officialHtml = ratingsState.showOfficial ? buildOfficialHtml(item.OfficialRating) : "";

  const html = [communityHtml, tomatoHtml, officialHtml].filter(Boolean).join("");

  if (host.innerHTML !== html) {
    if (html) {
      host.innerHTML = html;
      applyModernStyles(host);
      animateHost(host, true);
    } else {
      host.innerHTML = "";
      animateHost(host, false);
    }
  }
}

export function initOsdHeaderRatings() {
  if (window.__jmsOsdHeaderRatings?.active) {
    return window.__jmsOsdHeaderRatings.destroy;
  }

  const cfg = (() => {
    try {
      return (typeof getConfig === "function" ? getConfig() : {}) || {};
    } catch {
      return {};
    }
  })();

  if (!shouldRenderRatings(cfg)) {
    const staleHost = document.getElementById(HOST_ID);
    if (staleHost) staleHost.remove();
    const style = document.getElementById("jms-rating-animations");
    if (style) style.remove();
    window.__jmsOsdHeaderRatings = { active: false, destroy: null };
    return () => {};
  }

  addAnimationStyles();

  let destroyed = false;
  let intervalId = null;
  let lastKey = "";
  let bodyObserver = null;
  let quickSyncScheduled = false;
  let tickRunning = false;

  const tick = async () => {
    if (destroyed || document.hidden) return;

    if (!isPlaybackScreenActive()) {
      lastKey = "";
      removeExistingHost();
      return;
    }

    const host = ensureHost();
    if (!host) return;

    let sessionInfo = null;
    try {
      sessionInfo =
        (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
    } catch {}

    const userId = sessionInfo?.userId || sessionInfo?.UserId || null;

    try {
      const sessions = await fetchSessions();
      const sess = pickBestNowPlayingSession(sessions, userId);
      const item = sess?.NowPlayingItem || null;

      const key = item
        ? `${item.Id || ""}:${item.CriticRating || ""}:${item.CommunityRating || ""}:${item.OfficialRating || ""}`
        : "";

      if (key && key === lastKey) return;
      lastKey = key;

      render(host, item, cfg);
    } catch {
      lastKey = "";
      render(host, null, cfg);
    }
  };

  const runTick = async () => {
    if (destroyed || document.hidden || tickRunning) return;
    tickRunning = true;
    try {
      await tick();
    } finally {
      tickRunning = false;
    }
  };

  const stopPolling = () => {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  };

  const startPolling = () => {
    if (destroyed || intervalId || document.hidden) return;
    intervalId = window.setInterval(() => {
      runTick().catch(() => {});
    }, SESSION_POLL_INTERVAL_MS);
  };

  const queueQuickSync = () => {
    if (destroyed || document.hidden || quickSyncScheduled) return;
    quickSyncScheduled = true;
    requestAnimationFrame(() => {
      quickSyncScheduled = false;
      if (destroyed || document.hidden) return;

      if (!isPlaybackScreenActive()) {
        lastKey = "";
        removeExistingHost();
        return;
      }

      runTick().catch(() => {});
    });
  };

  const onRouteLikeChange = () => {
    queueQuickSync();
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopPolling();
      return;
    }
    queueQuickSync();
    startPolling();
  };

  runTick().catch(() => {});
  startPolling();

  try {
    window.addEventListener("hashchange", onRouteLikeChange, { passive: true });
    window.addEventListener("popstate", onRouteLikeChange, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  } catch {}

  try {
    bodyObserver = new MutationObserver(() => {
      if (destroyed || document.hidden) return;
      if (!isPlaybackScreenActive() && !document.getElementById(HOST_ID)) return;
      queueQuickSync();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  } catch {}

  const destroy = () => {
    destroyed = true;
    stopPolling();
    quickSyncScheduled = false;

    try {
      window.removeEventListener("hashchange", onRouteLikeChange);
      window.removeEventListener("popstate", onRouteLikeChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    } catch {}
    try { bodyObserver?.disconnect?.(); } catch {}
    bodyObserver = null;

    const el = document.getElementById(HOST_ID);
    if (el) {
      Object.assign(el.style, {
        opacity: "0",
        transform: "translateX(-10px)"
      });

      setTimeout(() => {
        if (el && el.parentNode) {
          el.remove();
        }
      }, 250);
    }

    const style = document.getElementById("jms-rating-animations");
    if (style) style.remove();

    window.__jmsOsdHeaderRatings = { active: false, destroy: null };
  };

  window.__jmsOsdHeaderRatings = { active: true, destroy };
  return destroy;
}
