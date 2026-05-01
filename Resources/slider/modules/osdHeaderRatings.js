import { getSessionInfo, getAuthHeader } from "../../Plugins/JMSFusion/runtime/api.js";
import { getConfig, getPauseFeaturesRuntimeConfig } from "./config.js";
import { getTomatoIconHtml } from "./customIcons.js";
import { withServer } from "./jfUrl.js";

const HOST_ID = "jms-osd-header-ratings-v4";
const SESSION_POLL_INTERVAL_MS = 10_000;
const ITEM_DETAILS_CACHE_TTL_MS = 2_500;
const LEGACY_LOGO_SELECTOR = '[data-jms-osd-legacy-logo="1"]';
const HOST_BRAND_SELECTOR = '[data-jms-osd-header-brand="1"]';
const HOST_RATINGS_SELECTOR = '[data-jms-osd-header-ratings="1"]';
const LEGACY_HEADER_TITLE_SELECTORS = [
  ".pageTitle",
  ".headerTitle",
  ".headerLeft .title",
  "h1",
  "h2",
  ".sectionTitle",
  ".headerName",
].join(", ");
const MUI_PLAYBACK_HEADER_SELECTOR = ".MuiToolbar-root";
const MUI_PLAYBACK_ACTION_STRONG_SELECTOR = [
  '[aria-controls="app-sync-play-menu"]',
  '[aria-controls="app-remote-play-menu"]',
].join(", ");
const MUI_PLAYBACK_ACTION_WEAK_SELECTOR = "#jellyfinPlayerToggle";
const MUI_BACK_LABEL_TOKENS = ["geri", "back", "zuruck", "zurück", "retour", "volver", "назад"];

function buildAuthHeaders() {
  const s =
    (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};

  return {
    "Authorization":
      typeof getAuthHeader === "function" ? getAuthHeader() : "",
    "X-Emby-Token": s.accessToken || "",
  };
}

function getCurrentUserId() {
  try {
    const sessionInfo =
      (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
    return sessionInfo?.userId || sessionInfo?.UserId || null;
  } catch {
    return null;
  }
}

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

function isRenderableNode(el) {
  if (!(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  if (el.closest(".hide,[hidden],[aria-hidden='true']")) return false;

  try {
    const style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === "none" || style.visibility === "hidden") return false;
  } catch {}

  return true;
}

function isVisibleBox(el) {
  if (!(el instanceof Element)) return false;
  if (!isRenderableNode(el)) return false;

  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;
  return rect.width > 0 && rect.height > 0;
}

function getActiveVideoContainer() {
  const containers = Array.from(document.querySelectorAll(".videoPlayerContainer"));
  for (const container of containers) {
    if (!isVisibleBox(container)) continue;
    const video = container.querySelector("video.htmlvideoplayer, video");
    if (video && isRenderableNode(video)) return container;
  }
  return null;
}

function isPlaybackScreenActive() {
  const activeContainer = getActiveVideoContainer();
  if (!activeContainer) return false;

  const controls = document.querySelector(
    ".videoOsdBottom.videoOsdBottom-maincontrols .buttons"
  );
  if (controls && isRenderableNode(controls)) return true;

  const video = activeContainer.querySelector("video.htmlvideoplayer, video");
  if (!(video instanceof HTMLMediaElement)) return false;
  if (!String(video.currentSrc || video.src || "").trim()) return false;
  return true;
}

function isArrowBackButton(button) {
  if (!(button instanceof HTMLElement)) return false;
  if (!isRenderableNode(button)) return false;

  try {
    if (button.querySelector('svg[data-testid="ArrowBackIcon"]')) return true;
  } catch {}

  const rawLabel = String(
    button.getAttribute("aria-label") ||
    button.getAttribute("title") ||
    button.textContent ||
    ""
  ).trim();
  if (!rawLabel) return false;

  const normalized = rawLabel
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return MUI_BACK_LABEL_TOKENS.some((token) => normalized.includes(token));
}

function findMuiPlaybackHeaderMount() {
  const toolbars = Array.from(
    document.querySelectorAll(MUI_PLAYBACK_HEADER_SELECTOR)
  ).filter(isVisibleBox);
  if (!toolbars.length) return null;

  let best = null;
  let bestScore = -Infinity;

  toolbars.forEach((toolbar, index) => {
    const buttons = Array.from(toolbar.querySelectorAll("button"));
    const backButton = buttons.find(isArrowBackButton) || null;
    if (!backButton) return;

    const hasStrongPlaybackActions = !!toolbar.querySelector(MUI_PLAYBACK_ACTION_STRONG_SELECTOR);
    const hasWeakPlaybackActions = !!toolbar.querySelector(MUI_PLAYBACK_ACTION_WEAK_SELECTOR);
    const hasNotificationButton = !!toolbar.querySelector("#jfNotifBtn");
    const rect = toolbar.getBoundingClientRect?.() || null;

    let score = index / 1000;
    if (hasStrongPlaybackActions) score += 50;
    if (hasWeakPlaybackActions) score += 16;
    if (hasNotificationButton) score += 2;
    if (backButton.classList.contains("MuiIconButton-edgeStart")) score += 8;
    if (rect) {
      if (rect.top >= -4 && rect.top <= Math.max(220, (window.innerHeight || 0) * 0.28)) score += 20;
      if (rect.width > 120) score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = {
        header: toolbar,
        anchorEl: backButton,
        containerEl: backButton.parentElement || toolbar,
        kind: "mui",
        playbackStrength: hasStrongPlaybackActions ? 2 : (hasWeakPlaybackActions ? 1 : 0),
      };
    }
  });

  return best;
}

function findLastRenderableChild(container) {
  if (!(container instanceof HTMLElement)) return null;
  for (let i = container.children.length - 1; i >= 0; i -= 1) {
    const child = container.children[i];
    if (child?.id === HOST_ID) continue;
    if (isRenderableNode(child)) return child;
  }
  return null;
}

function pickLegacyOsdHeaderMount() {
  const activeContainer = getActiveVideoContainer();
  if (!activeContainer) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  const headers = Array.from(document.querySelectorAll(
    ".skinHeader.osdHeader, .skinHeader.focuscontainer-x.osdHeader, .osdHeader"
  )).filter(isVisibleBox);
  const header = headers.length ? headers[headers.length - 1] : null;

  if (!header) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  const headerLeft =
    header.querySelector(".headerLeft") ||
    header.querySelector(".skinHeader .headerLeft") ||
    null;

  const titleEl =
    header.querySelector(".pageTitle") ||
    header.querySelector(".headerTitle") ||
    header.querySelector(".headerLeft .title") ||
    header.querySelector("h1,h2,.sectionTitle,.headerName") ||
    null;

  const containerEl =
    headerLeft instanceof HTMLElement && isRenderableNode(headerLeft)
      ? headerLeft
      : titleEl instanceof HTMLElement && titleEl.parentElement instanceof HTMLElement
        ? titleEl.parentElement
        : null;

  if (!(containerEl instanceof HTMLElement) || !isRenderableNode(containerEl)) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  const anchorEl =
    titleEl instanceof HTMLElement && titleEl.parentElement === containerEl
      ? titleEl
      : findLastRenderableChild(containerEl);

  return {
    header,
    anchorEl,
    containerEl,
    kind: "legacy",
    playbackStrength: 2,
  };
}

function pickOsdHeaderMount() {
  const mui = findMuiPlaybackHeaderMount();
  const legacy = pickLegacyOsdHeaderMount();
  if (legacy?.header && legacy?.containerEl && (!mui?.header || (mui?.playbackStrength || 0) < 2)) {
    return legacy;
  }
  if (mui?.header && mui?.anchorEl) return mui;
  if (legacy?.header && legacy?.containerEl) return legacy;
  return { header: null, anchorEl: null, containerEl: null, kind: "unknown" };
}

function syncHostPlacement(anchorEl, host, containerEl = null) {
  if (!(host instanceof HTMLElement)) return;

  const parent =
    containerEl instanceof HTMLElement
      ? containerEl
      : anchorEl instanceof HTMLElement
        ? anchorEl.parentElement
        : null;
  if (!(parent instanceof HTMLElement)) return;

  if (anchorEl instanceof HTMLElement && anchorEl.parentElement === parent) {
    if (
      host.parentElement !== parent ||
      host.previousElementSibling !== anchorEl
    ) {
      anchorEl.insertAdjacentElement("afterend", host);
    }
    return;
  }

  if (host.parentElement !== parent || host !== parent.lastElementChild) {
    parent.appendChild(host);
  }
}

function getHostMode(host) {
  return String(host?.getAttribute?.("data-jms-osd-header-kind") || "legacy").trim() || "legacy";
}

function getHostVisibleDisplay(mode) {
  return mode === "mui" ? "flex" : "inline-flex";
}

function getHostBrandEl(host) {
  return host?.querySelector?.(HOST_BRAND_SELECTOR) || null;
}

function getHostRatingsEl(host) {
  return host?.querySelector?.(HOST_RATINGS_SELECTOR) || null;
}

function ensureHostStructure(host) {
  if (!(host instanceof HTMLElement)) return { brandEl: null, ratingsEl: null };

  let brandEl = getHostBrandEl(host);
  if (!brandEl) {
    brandEl = document.createElement("div");
    brandEl.setAttribute("data-jms-osd-header-brand", "1");
    host.appendChild(brandEl);
  }

  let ratingsEl = getHostRatingsEl(host);
  if (!ratingsEl) {
    ratingsEl = document.createElement("div");
    ratingsEl.setAttribute("data-jms-osd-header-ratings", "1");
    host.appendChild(ratingsEl);
  }

  return { brandEl, ratingsEl };
}

function applyHostModeStyles(host, mode) {
  if (!(host instanceof HTMLElement)) return;
  const prevMode = getHostMode(host);
  if (prevMode === "legacy" && mode !== "legacy") {
    clearLegacyBrand(host);
  }
  const { brandEl, ratingsEl } = ensureHostStructure(host);
  const display = host.style.display === "none" ? "none" : getHostVisibleDisplay(mode);

  host.setAttribute("data-jms-osd-header-kind", mode || "legacy");
  Object.assign(host.style, {
    display,
    alignItems: "center",
    gap: mode === "mui" ? "12px" : "10px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    color: "rgb(255, 255, 255)",
    fontWeight: "600",
    alignSelf: "center",
    lineHeight: "1",
    opacity: "1",
    transform: "translate3d(0px, 0px, 0px)",
    transition: "opacity 0.25s ease-in-out, transform 0.25s ease-in-out",
    willChange: "opacity, transform",
    padding: mode === "mui" ? "2px 8px" : "4px 6px",
    margin: mode === "mui" ? "6px" : "0 0 0 .3em",
    minWidth: mode === "mui" ? "0" : "",
    overflow: mode === "mui" ? "hidden" : "visible",
  });

  if (brandEl) {
    Object.assign(brandEl.style, {
      display: mode === "mui" ? "inline-flex" : "none",
      alignItems: "center",
      flex: mode === "mui" ? "1 1 auto" : "0 0 auto",
      minWidth: "0",
      overflow: "hidden",
    });
  }

  if (ratingsEl) {
    Object.assign(ratingsEl.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      lineHeight: "1",
      color: "#fff",
      marginLeft: "0",
      flex: "0 0 auto",
    });
  }
}

function clearBrand(host) {
  const brandEl = getHostBrandEl(host);
  if (brandEl) {
    brandEl.replaceChildren();
    brandEl.removeAttribute("data-brand-key");
    brandEl.style.display = "none";
  }
  clearLegacyBrand(host);
}

function getLegacyHeaderTitleEl(host) {
  if (!(host instanceof HTMLElement)) return null;
  if (getHostMode(host) !== "legacy") return null;

  const container = host.parentElement;
  if (!(container instanceof HTMLElement)) return null;

  const candidate = container.querySelector(LEGACY_HEADER_TITLE_SELECTORS);
  if (!(candidate instanceof HTMLElement)) return null;
  if (candidate === host || candidate.closest?.(`#${HOST_ID}`)) return null;
  return candidate;
}

function getLegacyLogoEl(host) {
  if (!(host instanceof HTMLElement)) return null;
  const titleEl = getLegacyHeaderTitleEl(host);
  const container = titleEl?.parentElement;
  if (!(container instanceof HTMLElement)) return null;
  const candidate = container.querySelector(LEGACY_LOGO_SELECTOR);
  return candidate instanceof HTMLElement ? candidate : null;
}

function syncLegacyHeaderTitleVisibility(host, hidden) {
  const titleEl = getLegacyHeaderTitleEl(host);
  if (!(titleEl instanceof HTMLElement)) return;

  if (hidden) {
    if (!titleEl.hasAttribute("data-jms-osd-prev-display")) {
      titleEl.setAttribute("data-jms-osd-prev-display", titleEl.style.display || "");
    }
    titleEl.style.setProperty("display", "none", "important");
    return;
  }

  const prevDisplay = titleEl.getAttribute("data-jms-osd-prev-display");
  if (prevDisplay != null) {
    if (prevDisplay) {
      titleEl.style.display = prevDisplay;
    } else {
      titleEl.style.removeProperty("display");
    }
    titleEl.removeAttribute("data-jms-osd-prev-display");
  }
}

function clearLegacyBrand(host) {
  const logoEl = getLegacyLogoEl(host);
  if (logoEl) {
    logoEl.replaceChildren();
    logoEl.removeAttribute("data-brand-key");
    try { logoEl.remove(); } catch {}
  }
  syncLegacyHeaderTitleVisibility(host, false);
}

function ensureLegacyLogoEl(host) {
  const titleEl = getLegacyHeaderTitleEl(host);
  if (!(titleEl instanceof HTMLElement)) return null;

  let logoEl = getLegacyLogoEl(host);
  if (!logoEl) {
    logoEl = document.createElement("div");
    logoEl.setAttribute("data-jms-osd-legacy-logo", "1");
    titleEl.insertAdjacentElement("beforebegin", logoEl);
  }

  Object.assign(logoEl.style, {
    display: "none",
    alignItems: "center",
    flex: "0 0 auto",
    minWidth: "0",
    maxWidth: "min(34vw, 240px)",
    overflow: "hidden",
    margin: "0 0.35em 0 0.2em",
    pointerEvents: "none",
    userSelect: "none",
  });

  return logoEl;
}

function renderLegacyBrand(host, item) {
  const logoEl = ensureLegacyLogoEl(host);
  if (!logoEl || !item) {
    clearLegacyBrand(host);
    return false;
  }

  const title = buildBrandTitle(item);
  const logoUrl = buildItemLogoUrl(item);
  if (!logoUrl) {
    clearLegacyBrand(host);
    return false;
  }

  const brandKey = `${logoUrl}|${title}`;
  if (logoEl.getAttribute("data-brand-key") === brandKey && logoEl.childNodes.length > 0) {
    logoEl.style.display = "inline-flex";
    syncLegacyHeaderTitleVisibility(host, true);
    return true;
  }

  logoEl.setAttribute("data-brand-key", brandKey);
  logoEl.replaceChildren();

  const img = document.createElement("img");
  img.alt = title || "";
  img.decoding = "async";
  img.loading = "eager";
  img.src = logoUrl;
  Object.assign(img.style, {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: "clamp(26px, 4.5vh, 42px)",
    objectFit: "contain",
    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.78))",
  });

  img.addEventListener("error", () => {
    if (logoEl.getAttribute("data-brand-key") !== brandKey) return;
    clearLegacyBrand(host);
  }, { once: true });

  logoEl.appendChild(img);
  logoEl.style.display = "inline-flex";
  syncLegacyHeaderTitleVisibility(host, true);
  return true;
}

function createTitleFallbackNode(title) {
  const text = document.createElement("span");
  text.className = "jms-osd-header-title";
  text.textContent = title;
  Object.assign(text.style, {
    display: "block",
    minWidth: "0",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "clamp(14px, 1.45vw, 18px)",
    letterSpacing: "0.01em",
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  });
  return text;
}

function buildBrandTitle(item) {
  if (!item) return "";
  const type = String(item?.Type || "").trim().toLowerCase();
  if (type === "episode") {
    return String(item?.SeriesName || item?.Name || item?.OriginalTitle || "").trim();
  }
  return String(item?.Name || item?.OriginalTitle || item?.SeriesName || "").trim();
}

function getLogoCandidate(item) {
  if (!item) return null;

  const directTag =
    item?.ImageTags?.Logo ||
    item?.ImageTags?.logo ||
    item?.ImageTags?.LogoImageTag ||
    item?.LogoImageTag ||
    "";
  const parentLogoItemId = String(item?.ParentLogoItemId || item?.ParentId || "").trim();
  const parentLogoTag = String(item?.ParentLogoImageTag || "").trim();
  const seriesId = String(item?.SeriesId || "").trim();
  const seriesLogoTag = String(item?.SeriesLogoImageTag || "").trim();
  const itemId = String(item?.Id || "").trim();
  const type = String(item?.Type || "").trim().toLowerCase();

  if (type === "episode" && seriesId && seriesLogoTag) {
    return { itemId: seriesId, tag: seriesLogoTag };
  }
  if (itemId && directTag) {
    return { itemId, tag: String(directTag).trim() };
  }
  if (parentLogoItemId && parentLogoTag) {
    return { itemId: parentLogoItemId, tag: parentLogoTag };
  }
  if (seriesId && seriesLogoTag) {
    return { itemId: seriesId, tag: seriesLogoTag };
  }
  return null;
}

function buildItemLogoUrl(item, width = 260, quality = 80) {
  const candidate = getLogoCandidate(item);
  if (!candidate?.itemId || !candidate?.tag) return "";

  const qs = new URLSearchParams();
  qs.set("maxWidth", String(width));
  qs.set("quality", String(quality));
  qs.set("EnableImageEnhancers", "false");
  qs.set("tag", String(candidate.tag));

  try {
    const token = String(getSessionInfo?.()?.accessToken || "").trim();
    if (token) qs.set("api_key", token);
  } catch {}

  return withServer(`/Items/${encodeURIComponent(String(candidate.itemId))}/Images/Logo?${qs.toString()}`);
}

function buildItemRenderKey(host, item) {
  if (!item) return "";

  const mode = getHostMode(host);
  const logo = getLogoCandidate(item);
  const logoKey = logo ? `${logo.itemId}:${logo.tag}` : "";
  const title = buildBrandTitle(item);

  return [
    mode,
    String(item?.Id || ""),
    String(item?.CriticRating || ""),
    String(item?.CommunityRating || ""),
    String(item?.OfficialRating || ""),
    logoKey,
    title,
  ].join("|");
}

function hasHostVisibleContent(host) {
  if (!(host instanceof HTMLElement)) return false;
  const brandEl = getHostBrandEl(host);
  const ratingsEl = getHostRatingsEl(host);
  const brandVisible = !!(
    brandEl &&
    brandEl.style.display !== "none" &&
    (brandEl.querySelector("img") || String(brandEl.textContent || "").trim())
  );
  const ratingsVisible = !!String(ratingsEl?.innerHTML || "").trim();
  return brandVisible || ratingsVisible;
}

function renderBrand(host, item) {
  const brandEl = getHostBrandEl(host);
  if (!brandEl) return false;

  const mode = getHostMode(host);
  if ((mode !== "mui" && mode !== "legacy") || !item) {
    clearBrand(host);
    return false;
  }

  if (mode === "legacy") {
    brandEl.replaceChildren();
    brandEl.removeAttribute("data-brand-key");
    brandEl.style.display = "none";
    return renderLegacyBrand(host, item);
  }

  clearLegacyBrand(host);

  const title = buildBrandTitle(item);
  const logoUrl = buildItemLogoUrl(item);
  const brandKey = `${logoUrl}|${title}`;
  const allowTitleFallback = mode === "mui";

  if (brandEl.getAttribute("data-brand-key") === brandKey && hasHostVisibleContent(host)) {
    const hasBrandContent = brandEl.childNodes.length > 0;
    brandEl.style.display = hasBrandContent ? "inline-flex" : "none";
    syncLegacyHeaderTitleVisibility(host, mode === "legacy" && !!logoUrl && hasBrandContent);
    return brandEl.childNodes.length > 0;
  }

  brandEl.setAttribute("data-brand-key", brandKey);
  brandEl.replaceChildren();

  Object.assign(brandEl.style, {
    display: "none",
    alignItems: "center",
    flex: mode === "mui" ? "1 1 auto" : "0 0 auto",
    minWidth: "0",
    overflow: "hidden",
  });

  if (logoUrl) {
    const img = document.createElement("img");
    img.alt = title || "";
    img.decoding = "async";
    img.loading = "eager";
    img.src = logoUrl;
    Object.assign(img.style, {
      display: "block",
      width: "auto",
      height: "auto",
      maxWidth: "min(42vw, 260px)",
      maxHeight: "clamp(24px, 4.3vh, 40px)",
      objectFit: "contain",
      filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.78))",
    });
    img.addEventListener("error", () => {
      if (brandEl.getAttribute("data-brand-key") !== brandKey) return;
      brandEl.replaceChildren();
      if (!allowTitleFallback || !title) {
        brandEl.style.display = "none";
        syncLegacyHeaderTitleVisibility(host, false);
        return;
      }
      brandEl.appendChild(createTitleFallbackNode(title));
      brandEl.style.display = "inline-flex";
      syncLegacyHeaderTitleVisibility(host, false);
    }, { once: true });

    brandEl.appendChild(img);
    brandEl.style.display = "inline-flex";
    syncLegacyHeaderTitleVisibility(host, mode === "legacy");
    return true;
  }

  if (!allowTitleFallback || !title) {
    brandEl.style.display = "none";
    syncLegacyHeaderTitleVisibility(host, false);
    return false;
  }

  brandEl.appendChild(createTitleFallbackNode(title));
  brandEl.style.display = "inline-flex";
  syncLegacyHeaderTitleVisibility(host, false);
  return true;
}

function ensureHost() {
  const { header, anchorEl, containerEl, kind } = pickOsdHeaderMount();
  if (!header || !(containerEl instanceof HTMLElement || anchorEl instanceof HTMLElement)) return null;

  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.display = "none";
  }
  ensureHostStructure(host);
  applyHostModeStyles(host, kind);
  syncHostPlacement(anchorEl, host, containerEl);
  return host;
}

function removeExistingHost() {
  const host = document.getElementById(HOST_ID);
  if (!host) return false;
  clearBrand(host);
  host.innerHTML = "";
  host.remove();
  return true;
}

async function fetchSessions() {
  const headers = buildAuthHeaders();
  const url = `/Sessions?ActiveWithinSeconds=120`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sessions HTTP ${res.status}`);
  return await res.json();
}

function getActiveVideoEl() {
  const container = getActiveVideoContainer();
  if (!container) return null;
  return container.querySelector("video.htmlvideoplayer, video");
}

function getItemIdFromDom() {
  const selectors = [
    '.videoOsdBottom-hidden > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    'div.page:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    ".btnUserRating",
    '[data-id][is="paper-icon-button-light"].btnUserRating',
    ".btnUserRating[data-id]",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const id = String(el?.getAttribute?.("data-id") || "").trim();
    if (id) return id;
  }
  return null;
}

function parsePlayableIdFromVideo(videoEl) {
  try {
    const rawSrc = String(videoEl?.currentSrc || videoEl?.src || "").trim();
    if (!rawSrc) return null;

    const url = new URL(rawSrc, window.location.href);
    const itemId = url.searchParams.get("ItemId") || url.searchParams.get("itemId");
    if (itemId) return itemId;

    const pathId = url.pathname.match(/\/(?:Videos|Audio)\/([^/?#]+)/i)?.[1];
    if (pathId) return decodeURIComponent(pathId);
    return null;
  } catch {
    return null;
  }
}

function getPlaybackItemIdFromDom() {
  const videoId = parsePlayableIdFromVideo(getActiveVideoEl());
  if (videoId) return videoId;
  return getItemIdFromDom();
}

const __itemDetailsCache = {
  key: "",
  at: 0,
  value: null,
};

async function fetchItemDetails(itemId, userId) {
  const id = String(itemId || "").trim();
  if (!id) return null;

  const cacheKey = `${String(userId || "")}:${id}`;
  if (
    __itemDetailsCache.key === cacheKey &&
    (Date.now() - __itemDetailsCache.at) <= ITEM_DETAILS_CACHE_TTL_MS
  ) {
    return __itemDetailsCache.value || null;
  }

  const path = userId
    ? `/Users/${encodeURIComponent(String(userId))}/Items/${encodeURIComponent(id)}`
    : `/Items/${encodeURIComponent(id)}`;
  const fields = encodeURIComponent([
    "CommunityRating",
    "CriticRating",
    "OfficialRating",
    "Name",
    "OriginalTitle",
    "Type",
    "SeriesId",
    "SeriesName",
    "SeriesLogoImageTag",
    "LogoImageTag",
    "ParentLogoItemId",
    "ParentLogoImageTag",
    "ParentId",
    "ImageTags",
    "IndexNumber",
    "ParentIndexNumber",
  ].join(","));
  const url = `${path}?Fields=${fields}`;

  const res = await fetch(url, { headers: buildAuthHeaders() });
  if (!res.ok) throw new Error(`Item HTTP ${res.status}`);
  const item = await res.json();

  __itemDetailsCache.key = cacheKey;
  __itemDetailsCache.at = Date.now();
  __itemDetailsCache.value = item || null;

  return item || null;
}

async function resolveCurrentPlaybackItem(userId, {
  suppressItemId = "",
  allowSessionsFallback = true,
} = {}) {
  const suppressedId = String(suppressItemId || "").trim();
  const isSuppressed = (value) => {
    const id = String(value || "").trim();
    return !!(suppressedId && id && id === suppressedId);
  };

  const videoItemId = parsePlayableIdFromVideo(getActiveVideoEl());
  const domItemId = getItemIdFromDom();
  const directItemIds = [videoItemId, domItemId]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  for (const itemId of directItemIds) {
    if (isSuppressed(itemId)) continue;
    try {
      const item = await fetchItemDetails(itemId, userId);
      if (item?.Id) return item;
    } catch {}
  }

  if (!allowSessionsFallback) return null;

  const sessions = await fetchSessions();
  const sess = pickBestNowPlayingSession(sessions, userId);
  const item = sess?.NowPlayingItem || null;
  if (isSuppressed(item?.Id)) return null;
  if (!item?.Id) return item;

  try {
    return await fetchItemDetails(item.Id, userId);
  } catch {
    return item;
  }
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
  const ratingsEl = getHostRatingsEl(host) || host;
  const mode = getHostMode(host);

  Object.assign(ratingsEl.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    lineHeight: "1",
    color: "#fff",
    marginLeft: "0",
  });

  host.querySelectorAll(".jms-rating-container, .jms-tomato-container, .jms-official-container").forEach((container) => {
    if (!(container instanceof HTMLElement)) return;

    Object.assign(container.style, {
      display: "flex",
      alignItems: "center",
      gap: "5px",
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
  `;
  document.head.appendChild(style);
}

function animateHost(host, show) {
  if (!host) return;

  if (show) {
    host.style.display = getHostVisibleDisplay(getHostMode(host));
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
  const ratingsEl = getHostRatingsEl(host) || host;

  if (!item) {
    clearBrand(host);
    ratingsEl.innerHTML = "";
    animateHost(host, false);
    return;
  }

  const ratingsState = getOsdHeaderRatingsState(cfg);
  if (!ratingsState.enabled) {
    clearBrand(host);
    ratingsEl.innerHTML = "";
    animateHost(host, false);
    return;
  }

  const communityHtml = ratingsState.showCommunity ? buildStarRatingHtml(item.CommunityRating) : "";
  const tomatoHtml = ratingsState.showCritic ? buildTomatoHtml(item.CriticRating) : "";
  const officialHtml = ratingsState.showOfficial ? buildOfficialHtml(item.OfficialRating) : "";

  const html = [communityHtml, tomatoHtml, officialHtml].filter(Boolean).join("");
  const hasBrand = renderBrand(host, item);

  if (ratingsEl.innerHTML !== html) {
    ratingsEl.innerHTML = html;
  }

  applyModernStyles(host);

  if (html || hasBrand) {
    animateHost(host, true);
  } else {
    animateHost(host, false);
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
    if (staleHost) {
      clearBrand(staleHost);
      staleHost.remove();
    }
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
  let videoEventCleanup = null;
  let trackedVideoEl = null;
  let playbackInactive = false;
  let suppressedItemId = "";

  const clearPlaybackInactive = () => {
    playbackInactive = false;
    suppressedItemId = "";
  };

  const markPlaybackInactive = (candidateId = "") => {
    const nextId = String(candidateId || getPlaybackItemIdFromDom() || "").trim();
    if (nextId) suppressedItemId = nextId;
    playbackInactive = true;
    lastKey = "";
    removeExistingHost();
  };

  const bindVideoSignals = () => {
    const nextVideo = getActiveVideoEl();
    if (trackedVideoEl === nextVideo) return;

    try { videoEventCleanup?.(); } catch {}
    videoEventCleanup = null;
    trackedVideoEl = nextVideo || null;

    if (!nextVideo) return;

    const onVideoWake = () => {
      clearPlaybackInactive();
      queueQuickSync();
    };

    const onVideoTerminal = () => {
      markPlaybackInactive(
        getPlaybackItemIdFromDom() || parsePlayableIdFromVideo(nextVideo)
      );
    };

    const wakeEvents = ["loadstart", "loadedmetadata", "canplay", "play", "playing"];
    const terminalEvents = ["ended", "emptied", "abort", "error"];

    wakeEvents.forEach((eventName) => {
      try { nextVideo.addEventListener(eventName, onVideoWake, { passive: true }); } catch {}
    });
    terminalEvents.forEach((eventName) => {
      try { nextVideo.addEventListener(eventName, onVideoTerminal, { passive: true }); } catch {}
    });

    videoEventCleanup = () => {
      wakeEvents.forEach((eventName) => {
        try { nextVideo.removeEventListener(eventName, onVideoWake); } catch {}
      });
      terminalEvents.forEach((eventName) => {
        try { nextVideo.removeEventListener(eventName, onVideoTerminal); } catch {}
      });
    };
  };

  const tick = async () => {
    if (destroyed || document.hidden) return;

    if (!isPlaybackScreenActive()) {
      clearPlaybackInactive();
      lastKey = "";
      removeExistingHost();
      return;
    }

    const activeVideo = getActiveVideoEl();
    if (activeVideo?.ended) {
      markPlaybackInactive(parsePlayableIdFromVideo(activeVideo));
      return;
    }

    const host = ensureHost();
    if (!host) return;

    const userId = getCurrentUserId();

    try {
      const item = await resolveCurrentPlaybackItem(userId, {
        suppressItemId: playbackInactive ? suppressedItemId : "",
        allowSessionsFallback: !playbackInactive,
      });

      if (!item) {
        lastKey = "";
        render(host, null, cfg);
        return;
      }

      const key = buildItemRenderKey(host, item);
      const hostHasContent = hasHostVisibleContent(host);
      if (key && key === lastKey && hostHasContent) return;
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
        clearPlaybackInactive();
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
  bindVideoSignals();

  try {
    window.addEventListener("hashchange", onRouteLikeChange, { passive: true });
    window.addEventListener("popstate", onRouteLikeChange, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  } catch {}

  try {
    bodyObserver = new MutationObserver(() => {
      if (destroyed || document.hidden) return;
      bindVideoSignals();
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
    try { videoEventCleanup?.(); } catch {}
    videoEventCleanup = null;
    trackedVideoEl = null;
    clearPlaybackInactive();

    const el = document.getElementById(HOST_ID);
    if (el) {
      clearBrand(el);
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
