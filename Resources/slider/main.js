import { saveCredentials, saveApiKey, getAuthToken } from "/Plugins/JMSFusion/runtime/auth.js";
import {
  getConfig,
  getHomeSectionsRuntimeConfig,
  getPauseFeaturesRuntimeConfig,
  isDetailsModalModuleEnabled,
  isSubtitleCustomizerModuleEnabled
} from "./modules/config.js";
import { getLanguageLabels, getDefaultLanguage } from "./language/index.js";
import { getCurrentIndex, setCurrentIndex } from "./modules/sliderState.js";
import { startSlideTimer, stopSlideTimer, pauseSlideTimer, resumeSlideTimer } from "./modules/timer.js";
import { ensureProgressBarExists, resetProgressBar, pauseProgressBar, resumeProgressBar, updateProgressBarPosition } from "./modules/progressBar.js";
import { createSlide } from "./modules/slideCreator.js";
import { changeSlide, createDotNavigation, enablePeakNeighborActivation, getPeakDisplayOptions, initSwipeEvents, primePeakFirstPaint, syncPeakStructureNow, updatePeakClasses } from "./modules/navigation.js";
import { attachMouseEvents } from "./modules/events.js";
import { fetchItemDetails as fetchItemDetailsNet, getSessionInfo, getAuthHeader, waitForAuthReadyStrict, isAuthReadyStrict, AUTH_PROFILE_CHANGED_EVENT } from "/Plugins/JMSFusion/runtime/api.js";
import { cachedFetchJson, createCachedItemDetailsFetcher, startLibraryDeltaWatcher } from "./modules/sliderCache.js";
import { forceHomeSectionsTop, forceSkinHeaderPointerEvents } from "./modules/positionOverrides.js";
import { initAvatarSystem } from "./modules/userAvatar.js";
import { initializeQualityBadges, primeQualityFromItems, annotateDomWithQualityHints } from "./modules/qualityBadges.js";
import { startUpdatePolling } from "./modules/update.js";
import { updateSlidePosition } from "./modules/positionUtils.js";
import { teardownAnimations, hardCleanupSlide } from "./modules/animations.js";
import { isVisible, waitForAnyVisible } from "./modules/domVisibility.js";
import { resolveSliderAssetHref } from "./modules/assetLinks.js";
import { withServer } from "./modules/jfUrl.js";
import { initUserProfileAvatarPicker } from "./modules/avatarPicker.js";
import { startBackgroundCollectionIndexer, getBackgroundCollectionIndexerStatus } from "./modules/collectionIndexer.js";
import { initProfileChooser, syncProfileChooserHeaderButtonVisibility } from "./modules/profileChooser.js";
export { loadCSS } from "./modules/playerStyles.js";
export { waitForAnyVisible };
const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
const cancelIdle = window.cancelIdleCallback || ((id) => clearTimeout(id));
const MATERIAL_ICONS_REPAIR_STYLE_ID = "jms-material-icons-utf8-repair";
const MATERIAL_ICONS_PROBE_CLASS = "_10k";
const MATERIAL_ICONS_PROBE_CONTENT = "\ue951";
const CUSTOM_SPLASH_ACTIVE_ATTR = "data-jms-custom-splash";
const CUSTOM_SPLASH_HIDDEN_ATTR = "data-jms-custom-splash-hidden";
const CUSTOM_SPLASH_TITLE_ATTR = "data-jms-custom-splash-title";
const CUSTOM_SPLASH_CAPTION_ATTR = "data-jms-custom-splash-caption";
const CUSTOM_SPLASH_LAYER_ID = "jms-boot-splash-layer";
const CUSTOM_SPLASH_LOGO_ID = "jms-boot-splash-logo";
const CUSTOM_SPLASH_STORAGE_KEY = "enableCustomSplashScreen";
const CUSTOM_SPLASH_TITLE_VAR = "--jms-custom-splash-title";
const CUSTOM_SPLASH_CAPTION_VAR = "--jms-custom-splash-caption";
const CUSTOM_SPLASH_PROGRESS_KEY = "__JMS_CUSTOM_SPLASH_PROGRESS__";
const CUSTOM_SPLASH_TIMEOUT_MS = 12_000;
const CUSTOM_SPLASH_CLEANUP_MS = 420;
const CUSTOM_SPLASH_EXIT_SYNC_MS = 120;
const AUTH_CONTEXT_REBOOT_DEBOUNCE_MS = 180;
let materialIconsRepairPromise = null;
let __notificationsModulePromise = null;
let __detailsModalLoaderPromise = null;
let __hoverTrailerModulePromise = null;
let __personalRecommendationsModulePromise = null;
let __directorRowsModulePromise = null;
let __recentRowsModulePromise = null;
let __studioHubsModulePromise = null;
let __customSplashObserver = null;
let __customSplashCleanupTimer = 0;
let __customSplashHideTimer = 0;
let __customSplashHardTimer = 0;
let __authContextRecoveryTimer = 0;
let __lastRecoveredAuthContextKey = "";
const __customSplashProgressState = {
  authReady: false,
  dataPoolReady: false,
  selectionReady: false,
  firstSlideReady: false,
  allSlidesReady: false,
  uiReady: false,
  totalSlides: 0,
  createdSlides: 0,
  poolCount: 0
};

async function getNotificationsModule() {
  if (!__notificationsModulePromise) {
    __notificationsModulePromise = import("./modules/notifications.js").catch((error) => {
      __notificationsModulePromise = null;
      throw error;
    });
  }

  return __notificationsModulePromise;
}

function bootNotificationsOnce() {
  if (window.__jmsNotificationsBooted) return;
  window.__jmsNotificationsBooted = true;

  void getNotificationsModule()
    .then(async (mod) => {
      try { mod?.forcejfNotifBtnPointerEvents?.(); } catch {}
      await mod?.initNotifications?.();
    })
    .catch((error) => {
      window.__jmsNotificationsBooted = false;
      console.warn("initNotifications failed:", error);
    });
}

function getDomObserveRoot() {
  return document.body || document.documentElement;
}

function isElementNode(node) {
  return !!node && node.nodeType === 1;
}

function nodeTouchesSelectors(node, selectors = "") {
  const selectorText = Array.isArray(selectors) ? selectors.join(",") : String(selectors || "");
  if (!isElementNode(node) || !selectorText) return false;

  try {
    if (node.matches?.(selectorText)) return true;
  } catch {}

  try {
    return !!node.querySelector?.(selectorText);
  } catch {
    return false;
  }
}

function mutationsTouchSelectors(mutations, selectors = "") {
  const selectorText = Array.isArray(selectors) ? selectors.join(",") : String(selectors || "");
  if (!Array.isArray(mutations) || !selectorText) return false;

  for (const mutation of mutations) {
    if (nodeTouchesSelectors(mutation.target, selectorText)) return true;

    const addedNodes = Array.from(mutation.addedNodes || []);
    for (const node of addedNodes) {
      if (nodeTouchesSelectors(node, selectorText)) return true;
    }

    const removedNodes = Array.from(mutation.removedNodes || []);
    for (const node of removedNodes) {
      if (nodeTouchesSelectors(node, selectorText)) return true;
    }
  }

  return false;
}

function stripComputedContentQuotes(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "");
}

function readMaterialIconsProbeState() {
  const host = document.body || document.documentElement;
  if (!host) return { ready: false, broken: false, content: "" };

  const probe = document.createElement("span");
  probe.className = `material-icons ${MATERIAL_ICONS_PROBE_CLASS}`;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none"
  ].join(";");

  host.appendChild(probe);

  let content = "";
  try {
    content = stripComputedContentQuotes(getComputedStyle(probe, "::before").content);
  } catch {}

  probe.remove();

  if (!content || content === "none" || content === "normal") {
    return { ready: false, broken: false, content };
  }

  const normalized = content.toLowerCase();
  if (content === MATERIAL_ICONS_PROBE_CONTENT || normalized === "\\e951" || normalized === "\\ue951") {
    return { ready: true, broken: false, content };
  }

  return {
    ready: true,
    broken: Array.from(content).length !== 1 || content !== MATERIAL_ICONS_PROBE_CONTENT,
    content
  };
}

function escapeNonAsciiCss(cssText) {
  let out = "";
  for (const ch of String(cssText || "")) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) {
      out += ch;
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    out += `\\${code.toString(16)} `;
  }
  return out;
}

function scoreMaterialIconsHref(href) {
  const text = String(href || "");
  let score = 0;
  if (/\/46967\./i.test(text)) score += 100;
  if (/\/\d+\.[^/]+\.css(?:[?#].*)?$/i.test(text)) score += 25;
  if (/main\.jellyfin\./i.test(text)) score -= 10;
  return score;
}

async function loadMaterialIconsStylesheetUtf8() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
  const hrefs = [...new Set(
    links
      .map((link) => link.href)
      .filter(Boolean)
      .sort((a, b) => scoreMaterialIconsHref(b) - scoreMaterialIconsHref(a))
  )];

  for (const href of hrefs) {
    try {
      const response = await fetch(href, {
        credentials: "same-origin",
        cache: "force-cache"
      });
      if (!response.ok) continue;

      const cssText = new TextDecoder("utf-8").decode(await response.arrayBuffer());
      if (!/font-family\s*:\s*Material Icons/i.test(cssText)) continue;
      return { href, cssText };
    } catch {}
  }

  return null;
}

function injectMaterialIconsRepair(cssText, sourceHref) {
  const doc = document;
  const root = doc.head || doc.documentElement;
  if (!root) return false;

  let style = doc.getElementById(MATERIAL_ICONS_REPAIR_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = MATERIAL_ICONS_REPAIR_STYLE_ID;
    style.setAttribute("data-jms", "material-icons-utf8-repair");
    root.appendChild(style);
  }

  if (sourceHref) {
    style.setAttribute("data-source-href", sourceHref);
  }
  style.textContent = escapeNonAsciiCss(cssText);
  return true;
}

async function ensureMaterialIconsUtf8Integrity() {
  if (materialIconsRepairPromise) return materialIconsRepairPromise;

  materialIconsRepairPromise = (async () => {
    const state = readMaterialIconsProbeState();
    if (!state.ready || !state.broken) return false;

    const stylesheet = await loadMaterialIconsStylesheetUtf8();
    if (!stylesheet?.cssText) return false;

    const repaired = injectMaterialIconsRepair(stylesheet.cssText, stylesheet.href);
    if (repaired) {
      console.warn("[jms] Material Icons UTF-8 repair applied", {
        source: stylesheet.href,
        brokenContent: state.content
      });
    }
    return repaired;
  })().finally(() => {
    materialIconsRepairPromise = null;
  });

  return materialIconsRepairPromise;
}

function installMaterialIconsUtf8Guard() {
  if (window.__jmsMaterialIconsUtf8GuardInstalled) return;
  window.__jmsMaterialIconsUtf8GuardInstalled = true;

  const mayAffectMaterialIcons = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === MATERIAL_ICONS_REPAIR_STYLE_ID) return true;
    if (node.matches?.('link[rel="stylesheet"][href]')) return true;
    return !!node.querySelector?.('link[rel="stylesheet"][href]');
  };

  const shouldScheduleCheck = (mutations) => {
    for (const mutation of mutations || []) {
      if (mutation.type === "attributes") {
        if (mutation.target?.matches?.('link[rel="stylesheet"][href]')) return true;
        continue;
      }
      for (const node of mutation.addedNodes || []) {
        if (mayAffectMaterialIcons(node)) return true;
      }
      for (const node of mutation.removedNodes || []) {
        if (mayAffectMaterialIcons(node)) return true;
      }
    }
    return false;
  };

  const scheduleCheck = (delay = 0) => {
    setTimeout(() => {
      ensureMaterialIconsUtf8Integrity().catch(() => {});
    }, delay);
  };

  [0, 250, 1200, 3000].forEach(scheduleCheck);
  window.addEventListener("load", () => scheduleCheck(0), { once: true });

  try {
    const head = document.head || document.documentElement;
    if (!head) return;
    const observer = new MutationObserver((mutations) => {
      if (!shouldScheduleCheck(mutations)) return;
      clearTimeout(window.__jmsMaterialIconsUtf8GuardTimer);
      window.__jmsMaterialIconsUtf8GuardTimer = setTimeout(() => {
        ensureMaterialIconsUtf8Integrity().catch(() => {});
      }, 80);
    });
    observer.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel", "media", "disabled"]
    });
    window.__jmsMaterialIconsUtf8GuardObserver = observer;
  } catch {}
}

installMaterialIconsUtf8Guard();

function getCustomSplashRoot() {
  return document.documentElement;
}

function getCustomSplashProgressApi() {
  try {
    return window[CUSTOM_SPLASH_PROGRESS_KEY] || null;
  } catch {
    return null;
  }
}

function setCustomSplashProgress(value, options = {}) {
  try {
    return getCustomSplashProgressApi()?.set?.(value, options) ?? null;
  } catch {
    return null;
  }
}

function completeCustomSplashProgress(options = {}) {
  try {
    return getCustomSplashProgressApi()?.complete?.(options) ?? null;
  } catch {
    return null;
  }
}

function resetCustomSplashProgressState() {
  __customSplashProgressState.authReady = false;
  __customSplashProgressState.dataPoolReady = false;
  __customSplashProgressState.selectionReady = false;
  __customSplashProgressState.firstSlideReady = false;
  __customSplashProgressState.allSlidesReady = false;
  __customSplashProgressState.uiReady = false;
  __customSplashProgressState.totalSlides = 0;
  __customSplashProgressState.createdSlides = 0;
  __customSplashProgressState.poolCount = 0;
}

function formatSplashLabel(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function splashLabel(key, fallback, values = {}) {
  try {
    return formatSplashLabel(__getLabelsSafe?.()?.[key] || fallback, values);
  } catch {
    return formatSplashLabel(fallback, values);
  }
}

function syncCustomSplashProgress(patch = {}) {
  const root = getCustomSplashRoot();
  if (!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) {
    return null;
  }

  const { stage: stageOverride, detail: detailOverride, ...statePatch } = patch || {};
  Object.assign(__customSplashProgressState, statePatch);

  const state = __customSplashProgressState;
  const totalSlides = Math.max(0, Number(state.totalSlides) || 0);
  const createdSlides = Math.max(
    0,
    Math.min(totalSlides || Number.MAX_SAFE_INTEGER, Number(state.createdSlides) || 0)
  );
  const poolCount = Math.max(0, Number(state.poolCount) || 0);

  let progress = 0.06;
  let stage = splashLabel("customSplashStageLock", "KILIT");
  let detail = splashLabel("customSplashDetailLock", "Kabuk katmanı sabitleniyor");

  if (document.readyState !== "loading") {
    progress = Math.max(progress, 0.12);
    stage = splashLabel("customSplashStageStructure", "OMURGA");
    detail = splashLabel("customSplashDetailStructure", "Arayüz omurgası senkrona girdi");
  }

  if (state.authReady) {
    progress = Math.max(progress, 0.24);
    stage = splashLabel("customSplashStageAuth", "YETKI");
    detail = splashLabel("customSplashDetailAuth", "Oturum anahtarı doğrulandı");
  }

  if (state.dataPoolReady) {
    progress = Math.max(progress, 0.38);
    stage = splashLabel("customSplashStagePool", "HAVUZ");
    detail = poolCount > 0
      ? splashLabel("customSplashDetailPool", "{count} içerik havuza alındı", { count: poolCount })
      : splashLabel("customSplashDetailPoolEmpty", "İçerik havuzu bağlandı");
  }

  if (state.selectionReady) {
    progress = Math.max(progress, 0.48);
    stage = splashLabel("customSplashStageCompose", "KURGU");
    detail = totalSlides > 0
      ? splashLabel("customSplashDetailSelection", "{count} sahne sıraya alındı", { count: totalSlides })
      : splashLabel("customSplashDetailSelectionEmpty", "Sahne akışı hazırlandı");
  }

  if (totalSlides > 0) {
    progress = Math.max(progress, 0.48 + (createdSlides / totalSlides) * 0.34);
    stage = splashLabel("customSplashStageRender", "RENDER");
    detail = splashLabel("customSplashDetailRender", "{current}/{total} katman örülüyor", {
      current: createdSlides,
      total: totalSlides
    });
  }

  if (state.firstSlideReady) {
    progress = Math.max(progress, 0.9);
    stage = splashLabel("customSplashStageFrame", "KADRAJ");
    detail = totalSlides > 0
      ? splashLabel("customSplashDetailFrame", "{current}/{total} katman canlı", {
        current: createdSlides,
        total: totalSlides
      })
      : splashLabel("customSplashDetailFrameEmpty", "İlk kadraj ışığa çıktı");
  }

  if (state.allSlidesReady) {
    progress = Math.max(progress, 0.96);
    stage = splashLabel("customSplashStageSurface", "YUZEY");
    detail = splashLabel("customSplashDetailSurface", "Son katmanlar hizalanıyor");
  }

  if (state.uiReady) {
    progress = 1;
    stage = splashLabel("customSplashStageReady", "HAZIR");
    detail = splashLabel("customSplashDetailReady", "MonWui çevrimiçi");
  }

  return setCustomSplashProgress(progress, {
    stage: stageOverride || stage,
    detail: detailOverride || detail
  });
}

function readCustomSplashEnabled(defaultValue = true) {
  try {
    const raw = localStorage.getItem(CUSTOM_SPLASH_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return defaultValue;
}

function splashTextValue(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || String(fallback ?? "").trim();
}

function getCustomSplashCurrentHour() {
  try {
    const hour = Number(new Date().getHours());
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour;
  } catch {}
  return 9;
}

function resolveCustomSplashGreetingPart(hour = getCustomSplashCurrentHour()) {
  const safeHour = Number(hour);
  if (!Number.isFinite(safeHour)) return "Morning";
  if (safeHour >= 5 && safeHour < 12) return "Morning";
  if (safeHour >= 12 && safeHour < 18) return "Afternoon";
  if (safeHour >= 18 && safeHour < 22) return "Evening";
  return "Night";
}

function getCustomSplashGreetingFallback(lang = "tur", part = "Morning") {
  const greetings = {
    tur: {
      Morning: "Günaydın",
      Afternoon: "Tünaydın",
      Evening: "İyi akşamlar",
      Night: "İyi geceler"
    },
    eng: {
      Morning: "Good morning",
      Afternoon: "Good afternoon",
      Evening: "Good evening",
      Night: "Hello"
    },
    deu: {
      Morning: "Guten Morgen",
      Afternoon: "Guten Tag",
      Evening: "Guten Abend",
      Night: "Hallo"
    },
    fre: {
      Morning: "Bonjour",
      Afternoon: "Bon après-midi",
      Evening: "Bonsoir",
      Night: "Bonsoir"
    },
    spa: {
      Morning: "Buenos días",
      Afternoon: "Buenas tardes",
      Evening: "Buenas noches",
      Night: "Buenas noches"
    },
    rus: {
      Morning: "Доброе утро",
      Afternoon: "Добрый день",
      Evening: "Добрый вечер",
      Night: "Здравствуйте"
    }
  };

  return splashTextValue(greetings?.[lang]?.[part] || greetings?.eng?.[part]);
}

function getCurrentCustomSplashUserName() {
  try {
    const api =
      window.ApiClient ||
      window.apiClient ||
      window.MediaBrowser?.ApiClient ||
      null;
    const sessionInfo = getSessionInfo?.() || {};

    return splashTextValue(
      sessionInfo?.UserName ||
      sessionInfo?.userName ||
      sessionInfo?.User?.Name ||
      sessionInfo?.User?.Username ||
      api?._currentUser?.Name ||
      api?._currentUser?.Username ||
      api?._currentUser?.userName ||
      api?._serverInfo?.User?.Name ||
      api?._serverInfo?.User?.Username ||
      api?._serverInfo?.UserName ||
      sessionStorage.getItem("currentUserName")
    );
  } catch {
    return "";
  }
}

function getCustomSplashLoadingFallback(title) {
  const safeTitle = String(title || "MonWui").trim() || "MonWui";
  const lang = (typeof getDefaultLanguage === "function" ? getDefaultLanguage() : null) || "tur";

  switch (lang) {
    case "eng":
      return `${safeTitle} is starting`;
    case "deu":
      return `${safeTitle} wird vorbereitet`;
    case "fre":
      return `${safeTitle} se prepare`;
    case "spa":
      return `${safeTitle} se esta preparando`;
    case "rus":
      return `${safeTitle} подготавливается`;
    case "tur":
    default:
      return `${safeTitle} hazırlanıyor`;
  }
}

function resolveCustomSplashDefaults(labels = {}) {
  const defaultTitle = String(labels.customSplashTitle || "MonWui").trim() || "MonWui";
  const fallbackCaption = getCustomSplashLoadingFallback(defaultTitle);
  const defaultCaption = String(labels.customSplashLoadingText || fallbackCaption).trim()
    || fallbackCaption;
  return { defaultTitle, defaultCaption };
}

function buildCustomSplashCaption(title, labels = {}) {
  const { defaultTitle, defaultCaption } = resolveCustomSplashDefaults(labels);
  const safeTitle = String(title || "").trim() || defaultTitle;

  if (defaultCaption.includes(defaultTitle)) {
    return defaultCaption.replace(defaultTitle, safeTitle);
  }

  return defaultCaption;
}

function buildCustomSplashDisplayTitle(title, labels = {}, lang = "tur") {
  const safeTitle = splashTextValue(title, "MonWui");
  const userName = getCurrentCustomSplashUserName();
  if (!userName) return safeTitle;

  const greetingPart = resolveCustomSplashGreetingPart();
  const greetingKey = `customSplashGreeting${greetingPart}`;
  const greeting = splashTextValue(
    labels?.[greetingKey],
    getCustomSplashGreetingFallback(lang, greetingPart)
  );

  return splashTextValue(`${greeting} ${userName}`, safeTitle);
}

function getCustomSplashCopy() {
  const cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
  const lang = cfg.defaultLanguage || getDefaultLanguage?.();
  const labels = cfg.languageLabels || getLanguageLabels(lang) || {};
  const { defaultTitle } = resolveCustomSplashDefaults(labels);
  const title = String(cfg.customSplashTitle || "").trim() || defaultTitle;
  return {
    title,
    displayTitle: buildCustomSplashDisplayTitle(title, labels, lang),
    caption: buildCustomSplashCaption(title, labels)
  };
}

function applyCustomSplashCopy() {
  const root = getCustomSplashRoot();
  if (!root) return;
  const copy = getCustomSplashCopy();
  root.setAttribute(CUSTOM_SPLASH_TITLE_ATTR, copy.displayTitle || copy.title);
  root.setAttribute(CUSTOM_SPLASH_CAPTION_ATTR, copy.caption);
  root.style.setProperty(CUSTOM_SPLASH_TITLE_VAR, JSON.stringify(copy.displayTitle || copy.title));
  root.style.setProperty(CUSTOM_SPLASH_CAPTION_VAR, JSON.stringify(copy.caption));
  const logo = document.getElementById(CUSTOM_SPLASH_LOGO_ID);
  if (logo) {
    logo.setAttribute("aria-label", copy.title);
    logo.setAttribute("title", copy.title);
  }
  try {
    getCustomSplashProgressApi()?.syncCopy?.(copy);
  } catch {}
}

function cleanupCustomSplashAttrs() {
  const root = getCustomSplashRoot();
  if (__customSplashHideTimer) {
    clearTimeout(__customSplashHideTimer);
    __customSplashHideTimer = 0;
  }
  if (!root) return;
  root.removeAttribute(CUSTOM_SPLASH_ACTIVE_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_TITLE_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_CAPTION_ATTR);
  root.style.removeProperty(CUSTOM_SPLASH_TITLE_VAR);
  root.style.removeProperty(CUSTOM_SPLASH_CAPTION_VAR);
  document.getElementById(CUSTOM_SPLASH_LAYER_ID)?.remove();
  document.getElementById(CUSTOM_SPLASH_LOGO_ID)?.remove();
}

function hasCustomSplashVisibleShell() {
  return !!document.querySelector(
    "#indexPage:not(.hide), #homePage:not(.hide), .skinHeader, .mainDrawer, .mainDrawerButton, [data-role='page']:not(.hide)"
  );
}

function getCustomSplashVisiblePage() {
  return document.querySelector(
    "#reactRoot [data-role='page']:not(.hide), [data-role='page']:not(.hide), #reactRoot #indexPage:not(.hide), #reactRoot #homePage:not(.hide)"
  );
}

function isCustomSplashHomePageElement(page) {
  if (!page) return false;

  const pageId = String(page.id || "").toLowerCase();
  if (pageId === "indexpage" || pageId === "homepage") {
    return true;
  }

  const routeHint = String(
    page.getAttribute?.("data-url") ||
    page.getAttribute?.("data-page") ||
    page.dataset?.url ||
    ""
  ).toLowerCase();

  return /(?:^|\/)(?:index|home)(?:\.html)?(?:[?#/]|$)/i.test(routeHint);
}

function hasCustomSplashVisibleNonHomePage() {
  const page = getCustomSplashVisiblePage();
  if (!page) return false;
  if (isCustomSplashHomePageElement(page)) return false;

  const pageId = String(page.id || "").trim();
  const routeHint = String(
    page.getAttribute?.("data-url") ||
    page.getAttribute?.("data-page") ||
    page.dataset?.url ||
    ""
  ).trim();

  return !!(pageId || routeHint);
}

function getCustomSplashCandidateSlide(targetSlide = null) {
  if (targetSlide?.isConnected) {
    return targetSlide;
  }

  return document.querySelector(
    "#indexPage:not(.hide) #monwui-slides-container .monwui-slide.active, " +
    "#homePage:not(.hide) #monwui-slides-container .monwui-slide.active, " +
    "#monwui-slides-container .monwui-slide.active, " +
    "#indexPage:not(.hide) #monwui-slides-container .monwui-slide, " +
    "#homePage:not(.hide) #monwui-slides-container .monwui-slide, " +
    "#monwui-slides-container .monwui-slide"
  );
}

function isCustomSplashSlideVisuallyReady(targetSlide = null) {
  const slide = getCustomSplashCandidateSlide(targetSlide);
  if (!slide?.isConnected) return false;

  const container = slide.closest?.("#monwui-slides-container");
  if (!container || !isVisible(container)) return false;
  if (!isVisible(slide)) return false;
  if (!slide.classList.contains("active")) return false;
  if (slide.classList.contains("is-hidden") || slide.classList.contains("peak-batch-pending")) {
    return false;
  }

  try {
    const slideStyle = getComputedStyle(slide);
    if (slideStyle.display === "none" || slideStyle.visibility === "hidden") {
      return false;
    }
    if (Number.parseFloat(slideStyle.opacity || "1") < 0.04) {
      return false;
    }
  } catch {}

  const backdrop = slide.__backdropImg || slide.querySelector?.(".monwui-backdrop");
  if (!backdrop?.isConnected) return false;

  const backdropReady =
    slide.classList.contains("backdrop-ready") ||
    !!String(slide.dataset?.backdropReady || "").trim() ||
    (!!backdrop.complete && Number(backdrop.naturalWidth || 0) > 0);
  if (!backdropReady) return false;

  try {
    const backdropStyle = getComputedStyle(backdrop);
    if (backdropStyle.display === "none" || backdropStyle.visibility === "hidden") {
      return false;
    }
    if (Number.parseFloat(backdropStyle.opacity || "1") < 0.04 && !slide.classList.contains("backdrop-ready")) {
      return false;
    }
  } catch {}

  if (container.classList.contains("peak-mode")) {
    if (!container.classList.contains("peak-ready")) return false;
    if (
      container.classList.contains("peak-first-reveal") &&
      !container.classList.contains("peak-first-reveal-active")
    ) {
      return false;
    }
  }

  return true;
}

function hasCustomSplashFirstSlideReady() {
  try {
    return isCustomSplashSlideVisuallyReady();
  } catch {
    return false;
  }
}

function isCustomSplashReady() {
  const root = getCustomSplashRoot();
  if (!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return true;
  if (isCustomSplashSliderDisabled()) return true;
  if (hasCustomSplashFirstSlideReady()) return true;
  if (hasCustomSplashVisibleNonHomePage()) return true;
  return false;
}

function isCustomSplashSliderDisabled() {
  try {
    return (typeof getConfig === "function" ? getConfig()?.enableSlider : true) === false;
  } catch {
    return false;
  }
}

function stopCustomSplashWatchers() {
  if (__customSplashObserver) {
    try { __customSplashObserver.disconnect(); } catch {}
    __customSplashObserver = null;
  }
  if (__customSplashHardTimer) {
    clearTimeout(__customSplashHardTimer);
    __customSplashHardTimer = 0;
  }
}

function finalizeCustomSplashHide(reason = "ready") {
  const root = getCustomSplashRoot();
  if (!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return false;
  if (root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR)) return true;

  if (__customSplashCleanupTimer) {
    clearTimeout(__customSplashCleanupTimer);
  }

  root.setAttribute(CUSTOM_SPLASH_HIDDEN_ATTR, "1");
  root.setAttribute("data-jms-custom-splash-reason", reason);

  const hasSlides = !!document.querySelector(
    "#indexPage:not(.hide) .monwui-slide, #homePage:not(.hide) .monwui-slide"
  );
  if (hasSlides) {
    if (!hasStartedCycleClock()) {
      startNewCycleClock();
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { restartSlideTimerDeterministic(); } catch {}
      });
    });
  }

  __customSplashCleanupTimer = window.setTimeout(() => {
    cleanupCustomSplashAttrs();
    try {
      getCustomSplashRoot()?.removeAttribute("data-jms-custom-splash-reason");
    } catch {}
    __customSplashCleanupTimer = 0;
  }, CUSTOM_SPLASH_CLEANUP_MS);

  return true;
}

function hideCustomSplash(reason = "ready") {
  const root = getCustomSplashRoot();
  if (!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return false;
  if (root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR)) return true;

  stopCustomSplashWatchers();
  if (__customSplashCleanupTimer) {
    clearTimeout(__customSplashCleanupTimer);
  }
  if (__customSplashHideTimer) {
    return true;
  }

  const readyStage = splashLabel("customSplashStageReady", "HAZIR");
  const closingDetail = reason === "timeout"
    ? splashLabel("customSplashDetailForcedExit", "Zorunlu geçiş devreye alınıyor")
    : splashLabel("customSplashDetailReady", "MonWui çevrimiçi");

  syncCustomSplashProgress({
    uiReady: true,
    stage: readyStage,
    detail: closingDetail
  });
  completeCustomSplashProgress({
    stage: readyStage,
    detail: closingDetail
  });

  root.setAttribute("data-jms-custom-splash-reason", reason);
  const delay = (reason === "config-disabled" || reason === "slider-disabled") ? 0 : CUSTOM_SPLASH_EXIT_SYNC_MS;
  __customSplashHideTimer = window.setTimeout(() => {
    __customSplashHideTimer = 0;
    finalizeCustomSplashHide(reason);
  }, delay);
  return true;
}

function scheduleCustomSplashCheck(delay = 0) {
  window.setTimeout(() => {
    if (isCustomSplashReady()) {
      hideCustomSplash("ui-ready");
    }
  }, Math.max(0, delay | 0));
}

function initCustomSplash() {
  const root = getCustomSplashRoot();
  const api = {
    hide: hideCustomSplash,
    isBlocking() {
      return !!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR) && !root?.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
    },
    syncFromConfig(forceEnabled) {
      const sliderDisabled = isCustomSplashSliderDisabled();
      const enabled = typeof forceEnabled === "boolean"
        ? forceEnabled
        : ((typeof getConfig === "function" ? getConfig()?.enableCustomSplashScreen : true) !== false);

      if (!enabled) {
        hideCustomSplash("config-disabled");
        cleanupCustomSplashAttrs();
        return false;
      }

      if (sliderDisabled) {
        hideCustomSplash("slider-disabled");
        return false;
      }

      if (!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return true;
      applyCustomSplashCopy();
      scheduleCustomSplashCheck(0);
      return true;
    }
  };

  try {
    window.__JMS_CUSTOM_SPLASH__ = api;
  } catch {}

  if (!root) return api;
  if (!readCustomSplashEnabled(true)) {
    cleanupCustomSplashAttrs();
    return api;
  }
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) {
    return api;
  }

  resetCustomSplashProgressState();
  applyCustomSplashCopy();
  syncCustomSplashProgress();

  if (isCustomSplashSliderDisabled()) {
    hideCustomSplash("slider-disabled");
    return api;
  }

  if (isCustomSplashReady()) {
    requestAnimationFrame(() => hideCustomSplash("already-ready"));
    return api;
  }

  if (typeof MutationObserver === "function") {
    __customSplashObserver = new MutationObserver(() => {
      if (isCustomSplashReady()) {
        hideCustomSplash("mutation-ready");
      }
    });
    __customSplashObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    });
  }

  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "loading") {
      scheduleCustomSplashCheck(0);
    }
  });
  if (window.__jmsFirstSlideReady) {
    scheduleCustomSplashCheck(0);
  } else {
    document.addEventListener("jms:first-slide-ready", () => {
      hideCustomSplash("first-slide-ready");
    }, { once: true });
  }
  window.addEventListener("load", () => scheduleCustomSplashCheck(180), { once: true });
  window.addEventListener("pageshow", () => scheduleCustomSplashCheck(0), { passive: true });

  __customSplashHardTimer = window.setTimeout(() => {
    hideCustomSplash("timeout");
  }, CUSTOM_SPLASH_TIMEOUT_MS);

  scheduleCustomSplashCheck(1500);
  return api;
}

initCustomSplash();
document.addEventListener("readystatechange", () => {
  syncCustomSplashProgress();
});
syncCustomSplashProgress();

function loadDetailsModalLoader() {
  return __detailsModalLoaderPromise || (__detailsModalLoaderPromise = import("./modules/detailsModalLoader.js"));
}

async function openDetailsModalLazy(options = {}) {
  const { openDetailsModal } = await loadDetailsModalLoader();
  return openDetailsModal(options);
}

function loadHoverTrailerModule() {
  return __hoverTrailerModulePromise || (__hoverTrailerModulePromise = import("./modules/hoverTrailerModal.js"));
}

function queueHoverModuleBoot() {
  idle(() => {
    loadHoverTrailerModule()
      .then(({ setupHoverForAllItems }) => {
        try { setupHoverForAllItems?.(); } catch {}
      })
      .catch(() => {});
  });
}

function loadPersonalRecommendationsModule() {
  return __personalRecommendationsModulePromise || (__personalRecommendationsModulePromise = import("./modules/personalRecommendations.js"));
}

function loadDirectorRowsModule() {
  return __directorRowsModulePromise || (__directorRowsModulePromise = import("./modules/directorRows.js"));
}

function loadRecentRowsModule() {
  return __recentRowsModulePromise || (__recentRowsModulePromise = import("./modules/recentRows.js"));
}

function loadStudioHubsModule() {
  return __studioHubsModulePromise || (__studioHubsModulePromise = import("./modules/studioHubs.js"));
}

function renderPersonalRecommendationsLazy(options = {}) {
  return loadPersonalRecommendationsModule()
    .then(({ renderPersonalRecommendations }) => renderPersonalRecommendations?.(options))
    .catch(() => {});
}

function mountDirectorRowsLazyModule(options = {}) {
  return loadDirectorRowsModule()
    .then(({ mountDirectorRowsLazy }) => mountDirectorRowsLazy?.(options))
    .catch(() => {});
}

function mountRecentRowsLazyModule(options = {}) {
  return loadRecentRowsModule()
    .then(({ mountRecentRowsLazy }) => mountRecentRowsLazy?.(options))
    .catch(() => {});
}

function cleanupRecentRowsLazy() {
  return loadRecentRowsModule()
    .then(({ cleanupRecentRows }) => cleanupRecentRows?.())
    .catch(() => {});
}

function cleanupDirectorRowsLazy() {
  return loadDirectorRowsModule()
    .then(({ cleanupDirectorRows }) => cleanupDirectorRows?.())
    .catch(() => {});
}

function resetPersonalRecommendationsLazy() {
  return loadPersonalRecommendationsModule()
    .then(({ resetPersonalRecsAndGenreState }) => resetPersonalRecsAndGenreState?.())
    .catch(() => {});
}

function ensureStudioHubsMountedLazy(options = {}) {
  return loadStudioHubsModule()
    .then(({ ensureStudioHubsMounted }) => ensureStudioHubsMounted?.(options))
    .catch(() => {});
}

function cleanupStudioHubsLazy() {
  return loadStudioHubsModule()
    .then(({ cleanupStudioHubs }) => cleanupStudioHubs?.())
    .catch(() => {});
}

let homeSectionMountSeq = 0;
const homeSectionMountTimers = new Set();
let managedHomeSectionRecoverySeq = 0;
const managedHomeSectionRecoveryTimers = new Set();

function homeSectionLog() {}

function homeSectionWarn() {}

function clearHomeSectionMountTimers() {
  for (const timer of homeSectionMountTimers) {
    clearTimeout(timer);
  }
  homeSectionMountTimers.clear();
}

function scheduleHomeSectionMount(seq, fn, delayMs = 0) {
  const timer = window.setTimeout(() => {
    homeSectionMountTimers.delete(timer);
    if (homeSectionMountSeq !== seq) return;
    try { fn?.(); } catch (e) { console.warn("scheduleHomeSectionMount hata:", e); }
  }, Math.max(0, delayMs | 0));

  homeSectionMountTimers.add(timer);
}

function clearManagedHomeSectionRecoveryTimers() {
  managedHomeSectionRecoverySeq += 1;
  for (const timer of Array.from(managedHomeSectionRecoveryTimers)) {
    clearTimeout(timer);
    managedHomeSectionRecoveryTimers.delete(timer);
  }
}

function hasRenderableDom(selector) {
  try {
    return !!document.querySelector(selector);
  } catch {
    return false;
  }
}

function hasRenderablePersonalRecommendationUi(cfg = getMainConfig()) {
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  const personalOk =
    !homeSectionsConfig.enablePersonalRecommendations ||
    hasRenderableDom(
      "#personal-recommendations .personal-recs-row .personal-recs-card:not(.skeleton), #personal-recommendations .personal-recs-row .no-recommendations"
    );
  const becauseYouWatchedOk =
    !homeSectionsConfig.enableBecauseYouWatched ||
    hasRenderableDom(
      '[id^="because-you-watched--"] .byw-row .personal-recs-card:not(.skeleton), [id^="because-you-watched--"] .byw-row .no-recommendations, #because-you-watched .byw-row .personal-recs-card:not(.skeleton), #because-you-watched .byw-row .no-recommendations'
    );
  const genreOk =
    !homeSectionsConfig.enableGenreHubs ||
    hasRenderableDom(
      "#genre-hubs .genre-hub-section .genre-row .personal-recs-card:not(.skeleton), #genre-hubs .genre-hub-section .genre-row .no-recommendations"
    );
  return personalOk && becauseYouWatchedOk && genreOk;
}

function hasRenderableRecentRowsUi(cfg = getMainConfig()) {
  if (!shouldRenderRecentRowsUi(cfg)) return true;
  return hasRenderableDom(
    "#recent-rows .recent-row-section .personal-recs-card:not(.skeleton), #recent-rows .recent-row-section .no-recommendations, #recent-rows .recent-row-section .dir-row-hero, #continue-rows .recent-row-section .personal-recs-card:not(.skeleton), #continue-rows .recent-row-section .no-recommendations, #continue-rows .recent-row-section .dir-row-hero"
  );
}

function hasRenderableDirectorRowsUi(cfg = getMainConfig()) {
  if (!shouldRenderDirectorRowsUi(cfg)) return true;
  return hasRenderableDom(
    "#director-rows .dir-row-section .personal-recs-card:not(.skeleton), #director-rows .dir-row-section .no-recommendations, #director-rows .dir-row-section .dir-row-hero"
  );
}

function hasRenderableStudioHubsUi(cfg = getMainConfig()) {
  if (!shouldRenderStudioHubsUi(cfg)) return true;
  return hasRenderableDom(
    "#studio-hubs .studio-hub-card, #studio-hubs .studio-card, #studio-hubs .no-recommendations"
  );
}

function getManagedHomeSectionStatus(cfg = getMainConfig()) {
  return {
    studio: hasRenderableStudioHubsUi(cfg),
    personal: hasRenderablePersonalRecommendationUi(cfg),
    recent: hasRenderableRecentRowsUi(cfg),
    director: hasRenderableDirectorRowsUi(cfg),
  };
}

function needsManagedHomeSectionRecovery(cfg = getMainConfig()) {
  const status = getManagedHomeSectionStatus(cfg);
  return !(status.studio && status.personal && status.recent && status.director);
}

async function runManagedHomeSectionRecovery({
  eagerStudioHubs = true,
  seq = managedHomeSectionRecoverySeq,
} = {}) {
  if (managedHomeSectionRecoverySeq !== seq) return false;
  if (!isHomeRouteActive()) {
    homeSectionWarn("managedRecovery:skip:not-home-route", { seq, eagerStudioHubs });
    return false;
  }
  const visible = await waitForVisibleIndexPage(12000);
  if (managedHomeSectionRecoverySeq !== seq) return false;
  if (!visible || !isHomeVisible()) {
    homeSectionWarn("managedRecovery:skip:not-visible", {
      seq,
      eagerStudioHubs,
      visible,
    });
    return false;
  }

  const cfg = getMainConfig();
  const statusBefore = getManagedHomeSectionStatus(cfg);
  homeSectionLog("managedRecovery:start", {
    seq,
    eagerStudioHubs,
    statusBefore,
  });
  if (!needsManagedHomeSectionRecovery(cfg)) {
    homeSectionLog("managedRecovery:skip:already-rendered", {
      seq,
      statusBefore,
    });
    return true;
  }

  const results = await Promise.allSettled([
    shouldRenderStudioHubsUi(cfg)
      ? ensureStudioHubsMountedLazy({ eager: eagerStudioHubs })
      : Promise.resolve(),
    shouldRenderPersonalRecommendationUi(cfg)
      ? renderPersonalRecommendationsLazy()
      : Promise.resolve(),
    shouldRenderRecentRowsUi(cfg)
      ? mountRecentRowsLazyModule()
      : Promise.resolve(),
    shouldRenderDirectorRowsUi(cfg)
      ? mountDirectorRowsLazyModule()
      : Promise.resolve(),
  ]);

  const statusAfter = getManagedHomeSectionStatus(cfg);
  const ok = !needsManagedHomeSectionRecovery(cfg);
  homeSectionLog("managedRecovery:complete", {
    seq,
    ok,
    statusBefore,
    statusAfter,
    moduleResults: {
      studio: results[0]?.status || null,
      personal: results[1]?.status || null,
      recent: results[2]?.status || null,
      director: results[3]?.status || null,
    },
  });
  return ok;
}

function scheduleManagedHomeSectionRecovery({
  delaysMs = [300, 1200, 2600, 4800, 7600],
  eagerStudioHubs = true,
} = {}) {
  clearManagedHomeSectionRecoveryTimers();
  const seq = managedHomeSectionRecoverySeq;
  homeSectionLog("managedRecovery:schedule", {
    seq,
    delaysMs: Array.isArray(delaysMs) ? delaysMs.slice() : [],
    eagerStudioHubs,
  });

  for (const rawDelay of delaysMs) {
    const delayMs = Math.max(0, Number(rawDelay) || 0);
    const timer = window.setTimeout(() => {
      managedHomeSectionRecoveryTimers.delete(timer);
      if (managedHomeSectionRecoverySeq !== seq) return;
      void runManagedHomeSectionRecovery({ eagerStudioHubs, seq }).then((ok) => {
        if (ok && managedHomeSectionRecoverySeq === seq) {
          clearManagedHomeSectionRecoveryTimers();
        }
      });
    }, delayMs);
    managedHomeSectionRecoveryTimers.add(timer);
  }
}

function bootHomeSections(cfg, { eagerStudioHubs = false, forceManagedSections = false } = {}) {
  homeSectionMountSeq += 1;
  const seq = homeSectionMountSeq;
  clearHomeSectionMountTimers();
  let delayMs = 0;
  const sections = {
    studio: shouldRenderStudioHubsUi(cfg),
    personal: shouldRenderPersonalRecommendationUi(cfg),
    recent: shouldRenderRecentRowsUi(cfg),
    director: shouldRenderDirectorRowsUi(cfg),
  };
  homeSectionLog("bootHomeSections", {
    seq,
    eagerStudioHubs,
    forceManagedSections,
    sections,
  });

  if (sections.studio) {
    scheduleHomeSectionMount(seq, () => {
      void ensureStudioHubsMountedLazy({ eager: eagerStudioHubs });
    }, delayMs);
    delayMs += 180;
  }

  if (sections.personal) {
    scheduleHomeSectionMount(seq, () => {
      void renderPersonalRecommendationsLazy({ force: forceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
  if (sections.recent) {
    scheduleHomeSectionMount(seq, () => {
      void mountRecentRowsLazyModule({ force: forceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
  if (sections.director) {
    scheduleHomeSectionMount(seq, () => {
      void mountDirectorRowsLazyModule({ force: forceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
}

function kickManagedHomeSectionsNow(
  cfg = getMainConfig(),
  {
    eagerStudioHubs = true,
    forceManagedSections = false,
    reason = "direct-kick",
  } = {}
) {
  const sections = {
    studio: shouldRenderStudioHubsUi(cfg),
    personal: shouldRenderPersonalRecommendationUi(cfg),
    recent: shouldRenderRecentRowsUi(cfg),
    director: shouldRenderDirectorRowsUi(cfg),
  };

  homeSectionLog("kickManagedHomeSectionsNow", {
    reason,
    eagerStudioHubs,
    forceManagedSections,
    sections,
  });

  if (sections.studio) {
    void ensureStudioHubsMountedLazy({
      eager: eagerStudioHubs,
      force: forceManagedSections,
    });
  }
  if (sections.personal) {
    void renderPersonalRecommendationsLazy({ force: forceManagedSections });
  }
  if (sections.recent) {
    void mountRecentRowsLazyModule({ force: forceManagedSections });
  }
  if (sections.director) {
    void mountDirectorRowsLazyModule({ force: forceManagedSections });
  }
}

function installHomeTabSliderOnlyGate() {
  if (window.__homeTabSliderOnlyGateInstalled) return;
  window.__homeTabSliderOnlyGateInstalled = true;

  const setFlagsFromConfig = () => {
    try {
      const cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
      const on = !!cfg.onlyShowSliderOnHomeTab;
      document.documentElement.dataset.jmsHomeSliderOnly = on ? "1" : "0";
      return on;
    } catch {
      document.documentElement.dataset.jmsHomeSliderOnly = "0";
      return false;
    }
  };

  function isHomeTabActive() {
  const homeBtn =
    document.querySelector('button.emby-tab-button[data-index="0"]') ||
    document.querySelector('button.emby-tab-button');

  if (!homeBtn) {
    return !!document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  }

  return (
    homeBtn.classList.contains("emby-tab-button-active") ||
    homeBtn.classList.contains("active") ||
    homeBtn.getAttribute("aria-selected") === "true"
  );
}

  function apply() {
    const onlyHome = setFlagsFromConfig();
    if (!onlyHome) {
      document.documentElement.dataset.jmsHomeTabActive = "1";
      if (window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = false;
        try { resumeSlideTimer?.(); } catch {}
        try { resumeProgressBar?.(); } catch {}
      }
      return;
    }

    const active = isHomeTabActive();
    document.documentElement.dataset.jmsHomeTabActive = active ? "1" : "0";

    if (typeof isSliderEnabled === "function" && !isSliderEnabled()) return;

    if (!active) {
      if (!window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = true;
        try { pauseSlideTimer?.(); } catch {}
        try { pauseProgressBar?.(); } catch {}
      }
    } else {
      if (window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = false;
        try { resumeProgressBar?.(); } catch {}
        try { resumeSlideTimer?.(); } catch {}
      }
    }
  }

  apply();

  const mo = new MutationObserver(() => apply());
  mo.observe(getDomObserveRoot(), { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  const tick = () => apply();
  window.addEventListener("popstate", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("focus", tick);

  window.__cleanupHomeTabSliderOnlyGate = () => {
    try { mo.disconnect(); } catch {}
    window.removeEventListener("popstate", tick);
    window.removeEventListener("pageshow", tick);
    window.removeEventListener("focus", tick);
  };
}

function __getLabelsSafe() {
  try {
    const lang = (typeof getDefaultLanguage === "function" ? getDefaultLanguage() : null) || "tur";
    return (typeof getLanguageLabels === "function" ? getLanguageLabels(lang) : {}) || {};
  } catch {
    return {};
  }
}

function __pickFirstLabel(labels, keys, fallback) {
  for (const k of keys) {
    const v = labels?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
}

function L(keyOrKeys, fallback) {
  const labels = __getLabelsSafe();
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  return __pickFirstLabel(labels, keys, fallback);
}

window.__totalSlidesPlanned = 0;
window.__slidesCreated = 0;
window.__cycleStartAt = 0;
window.__cycleArmTimeout = null;
window.__cycleExpired = window.__cycleExpired || false;
window.__peakBooting = true;
window.__jmsFirstSlideReady = window.__jmsFirstSlideReady || false;
window.__jmsNonCriticalBooted = window.__jmsNonCriticalBooted || false;
window.__jmsNotificationsBooted = window.__jmsNotificationsBooted || false;
window.__jmsMusicSchedulerBooted = window.__jmsMusicSchedulerBooted || false;
window.__jmsSliderBootToken = Number(window.__jmsSliderBootToken || 0);
window.__jmsSlidesInitToken = Number(window.__jmsSlidesInitToken || 0);
window.__jmsSliderResetToken = Number(window.__jmsSliderResetToken || 0);
window.__jmsStartWhenAllReadyHandler = window.__jmsStartWhenAllReadyHandler || null;
window.__jmsSliderIdleHandles = window.__jmsSliderIdleHandles || new Set();

function clearStartWhenAllReadyHandler() {
  const handler = window.__jmsStartWhenAllReadyHandler;
  if (typeof handler === "function") {
    try { document.removeEventListener("jms:all-slides-ready", handler); } catch {}
  }
  window.__jmsStartWhenAllReadyHandler = null;
}

function clearPendingSliderIdleTasks() {
  const handles = window.__jmsSliderIdleHandles;
  if (!(handles instanceof Set) || !handles.size) return;
  for (const handle of Array.from(handles)) {
    try { cancelIdle(handle); } catch {}
    handles.delete(handle);
  }
}

function invalidateSliderBootSession() {
  window.__jmsSliderBootToken = (Number(window.__jmsSliderBootToken) || 0) + 1;
  clearStartWhenAllReadyHandler();
  clearPendingSliderIdleTasks();
}

function beginSliderBootSession() {
  invalidateSliderBootSession();
  return Number(window.__jmsSliderBootToken) || 0;
}

function isSliderBootTokenCurrent(token, { requireHomeVisible = true, requireContainer = false } = {}) {
  if (!Number.isFinite(token) || token <= 0) return false;
  if ((Number(window.__jmsSliderBootToken) || 0) !== token) return false;
  if (requireHomeVisible && !isHomeVisible()) return false;
  if (requireContainer) {
    return !!document.querySelector(
      "#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container"
    );
  }
  return true;
}

function scheduleSliderIdleTask(cb) {
  const handles = window.__jmsSliderIdleHandles instanceof Set
    ? window.__jmsSliderIdleHandles
    : (window.__jmsSliderIdleHandles = new Set());
  let handle = 0;
  handle = idle(() => {
    handles.delete(handle);
    try { cb?.(); } catch (e) { console.warn("scheduleSliderIdleTask hata:", e); }
  });
  handles.add(handle);
  return handle;
}

function waitForFirstSlideVisualReady(
  slideEl,
  bootToken = Number(window.__jmsSliderBootToken) || 0,
  { timeoutMs = 3200 } = {}
) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) {
    return Promise.resolve(false);
  }

  if (isCustomSplashSlideVisuallyReady(slideEl)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let done = false;
    let rafA = 0;
    let rafB = 0;
    let timer = 0;
    let observer = null;

    const cleanup = () => {
      if (rafA) cancelAnimationFrame(rafA);
      if (rafB) cancelAnimationFrame(rafB);
      if (timer) clearTimeout(timer);
      try { observer?.disconnect?.(); } catch {}
      try { document.removeEventListener("jms:slide-enter", scheduleCheck, true); } catch {}
      try { window.removeEventListener("pageshow", scheduleCheck); } catch {}
      try { document.removeEventListener("visibilitychange", scheduleCheck); } catch {}
      rafA = 0;
      rafB = 0;
      timer = 0;
      observer = null;
    };

    const finish = (ready = false) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(ready);
    };

    const check = () => {
      if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) {
        finish(false);
        return;
      }
      if (isCustomSplashSlideVisuallyReady(slideEl)) {
        finish(true);
      }
    };

    function scheduleCheck() {
      if (done || rafA || rafB) return;
      rafA = requestAnimationFrame(() => {
        rafA = 0;
        rafB = requestAnimationFrame(() => {
          rafB = 0;
          check();
        });
      });
    }

    observer = new MutationObserver(() => {
      scheduleCheck();
    });

    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden"]
      });
    } catch {}

    document.addEventListener("jms:slide-enter", scheduleCheck, true);
    window.addEventListener("pageshow", scheduleCheck);
    document.addEventListener("visibilitychange", scheduleCheck);

    timer = window.setTimeout(() => {
      finish(isCustomSplashSlideVisuallyReady(slideEl));
    }, Math.max(800, Number(timeoutMs) || 0));

    scheduleCheck();
  });
}

function markFirstSlideReady(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) return;
  if (window.__jmsFirstSlideReady) return;
  window.__jmsFirstSlideReady = true;
  syncCustomSplashProgress({ firstSlideReady: true });
  try {
    document.dispatchEvent(new CustomEvent("jms:first-slide-ready"));
  } catch {}
}

function whenFirstSlideReadyOrTimeout(cb, timeoutMs = 7000) {
  let done = false;
  let to = null;
  const finish = () => {
    if (done) return;
    done = true;
    try { clearTimeout(to); } catch {}
    try { document.removeEventListener("jms:first-slide-ready", onReady); } catch {}
    try { cb(); } catch {}
  };
  const onReady = () => finish();

  if (window.__jmsFirstSlideReady) {
    finish();
    return;
  }
  document.addEventListener("jms:first-slide-ready", onReady, { once: true });
  to = setTimeout(finish, Math.max(1000, timeoutMs | 0));
}

(function earlyCssBoot(){
  const D = document;
  const HEAD = D.head || D.documentElement;
  const raf =
    window.requestAnimationFrame ||
    ((cb) => setTimeout(cb, 16));
  const criticalCSS = `
    html[data-jms-notif="0"] .skinHeader .headerRight #jfNotifBtn { display:none !important; }
    .skinHeader .headerRight #jfNotifBtn { order: -9999; }

    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] #monwui-slides-container,
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] .monwui-slide-progress-bar,
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] .monwui-slide-progress-seconds,
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] .monwui-dot-navigation-container {
      display: none !important;
    }
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] .jms-slider,
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] .homeSlider,
    html[data-jms-home-slider-only="1"][data-jms-home-tab-active="0"] #monwui-slides-container {
      display: none !important;
    }
  `;
  if (!D.getElementById('jms-critical-css')) {
    const s = D.createElement('style');
    s.id = 'jms-critical-css';
    s.textContent = criticalCSS;
    HEAD.prepend(s);
  }

  function syncCSS(href, id, enabled = true) {
    const existing = D.getElementById(id);
    if (!enabled) {
      existing?.remove();
      return;
    }
    if (!href) return;

    const resolved = resolveSliderAssetHref(href);

    if (existing) {
      if (existing.href !== resolved) existing.href = resolved;
      try { existing.fetchPriority = 'high'; } catch {}
      existing.setAttribute('fetchpriority', 'high');
      return;
    }

    const l = D.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = resolved;
    try { l.fetchPriority = 'high'; } catch {}
    l.setAttribute('fetchpriority','high');
    HEAD.prepend(l);
  }

  function removeCssByHref(patterns = []) {
    if (!patterns.length) return;
    D.querySelectorAll('link[rel="stylesheet"][href]').forEach((link) => {
      const href = String(link.getAttribute('href') || link.href || '');
      if (!href) return;
      if (patterns.some((pattern) => href.includes(pattern))) {
        link.remove();
      }
    });
  }

  function getLiveConfig() {
    try {
      if (typeof getConfig === 'function') {
        return getConfig() || {};
      }
    } catch {}
    return {};
  }

  function getCssVariant(cfg = getLiveConfig()) {
    return cfg.cssVariant || 'normalslider';
  }

  function matchesAny(selectors = []) {
    return selectors.some((selector) => {
      try {
        return !!D.querySelector(selector);
      } catch {
        return false;
      }
    });
  }

  function isSliderCssActive(cfg) {
    return cfg.enableSlider !== false || matchesAny([
      '#monwui-slides-container',
      '.monwui-slide-progress-bar',
      '.monwui-dot-navigation-container'
    ]);
  }

  function isNotificationsCssActive(cfg) {
    return cfg.enableNotifications !== false || matchesAny([
      '#jfNotifBtn',
      '#jfNotifModal',
      '.jf-notif-panel'
    ]);
  }

  function shouldRenderPersonalRecommendationUi(cfg) {
    const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enablePersonalRecommendations ||
      homeSectionsConfig.enableGenreHubs ||
      homeSectionsConfig.enableBecauseYouWatched
    );
  }

  function shouldRenderDirectorRowsUi(cfg) {
    return getHomeSectionsRuntimeConfig(cfg).enableDirectorRows;
  }

  function shouldRenderRecentRowsUi(cfg) {
    const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enableRecentRows ||
      homeSectionsConfig.enableContinueMovies ||
      homeSectionsConfig.enableContinueSeries ||
      homeSectionsConfig.enableOtherLibRows
    );
  }

  function shouldRenderStudioHubsUi(cfg) {
    return getHomeSectionsRuntimeConfig(cfg).enableStudioHubs;
  }

  function isRecommendationCssActive(cfg) {
    const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enablePersonalRecommendations ||
      homeSectionsConfig.enableGenreHubs ||
      homeSectionsConfig.enableBecauseYouWatched ||
      homeSectionsConfig.enableDirectorRows ||
      homeSectionsConfig.enableRecentRows ||
      homeSectionsConfig.enableContinueMovies ||
      homeSectionsConfig.enableContinueSeries ||
      homeSectionsConfig.enableOtherLibRows
    ) || matchesAny([
      '#personal-recommendations',
      '#genre-hubs',
      '#director-rows',
      '#recent-rows',
      '#continue-rows',
      '#because-you-watched',
      '[id^="because-you-watched--"]'
    ]);
  }

  function isStudioHubsCssActive(cfg) {
    return shouldRenderStudioHubsUi(cfg) || matchesAny([
      '#studio-hubs',
      '.hub-preview-popover'
    ]);
  }

  function isDetailsModalCssActive(cfg) {
    const modalDomPresent = matchesAny([
      '#jms-details-modal-root',
      '.jmsdm-backdrop',
      '.jmsdm-card'
    ]);

    if (!isDetailsModalModuleEnabled(cfg)) {
      return modalDomPresent;
    }

    return (
      isSliderCssActive(cfg) ||
      isNotificationsCssActive(cfg) ||
      isRecommendationCssActive(cfg) ||
      isStudioHubsCssActive(cfg) ||
      modalDomPresent
    );
  }

  function isMiniPopoverCssActive(cfg) {
    return !!(
      isSliderCssActive(cfg) ||
      isRecommendationCssActive(cfg) ||
      isStudioHubsCssActive(cfg) ||
      cfg.studioHubsHoverVideo ||
      (cfg.globalPreviewMode === 'studioMini' && cfg.studioMiniTrailerPopover)
    ) || matchesAny([
      '.mini-poster-popover',
      '.mini-trailer-popover',
      '.hub-preview-popover'
    ]);
  }

  function isAvatarPickerCssActive(cfg) {
    return !!(
      cfg.createAvatar ||
      (window.location.hash || '').startsWith('#/userprofile')
    ) || matchesAny([
      '.jms-avatarBackdrop',
      '.jms-avatarModal',
      '.jms-avatarPickBtn'
    ]);
  }

  function isProfileChooserCssActive(cfg) {
    return cfg.enableProfileChooser !== false || matchesAny([
      '#jfProfileChooserOverlay',
      '#jfProfileChooserBtn',
      '.jf-profile-overlay',
      '.jf-profile-header-btn'
    ]);
  }

  function isPauseFeatureCssActive(cfg) {
    const pauseConfig = getPauseFeaturesRuntimeConfig(cfg);
    return !!(
      pauseConfig.enablePauseOverlay ||
      pauseConfig.enableSmartAutoPause
    ) || matchesAny([
      '#jms-pause-overlay',
      '#jms-overlay-progress',
      '#pause-status-bottom-right',
      '#jms-reco-panel',
      '.rating-genre-overlay',
      '.rating-icons-overlay'
    ]);
  }

  function isSubtitleCustomizerCssActive(cfg) {
    return isSubtitleCustomizerModuleEnabled(cfg) && matchesAny([
      '.videoOsdBottom.videoOsdBottom-maincontrols .buttons',
      '.btnJmsSubtitleCustomizer',
      '[data-jms-subtitle-dialog]',
      '#jms-subtitle-dialog',
      '.jms-subtitle-dialog'
    ]);
  }

  const FEATURE_CSS_SYNC_SELECTOR_TEXT = [
    '#indexPage',
    '#homePage',
    '.homeSectionsContainer',
    '#monwui-slides-container',
    '.monwui-slide-progress-bar',
    '.monwui-dot-navigation-container',
    '#jfNotifBtn',
    '#jfNotifModal',
    '.jf-notif-panel',
    '#personal-recommendations',
    '#genre-hubs',
    '#director-rows',
    '#recent-rows',
    '#continue-rows',
    '#because-you-watched',
    '[id^="because-you-watched--"]',
    '#studio-hubs',
    '.hub-preview-popover',
    '#jms-details-modal-root',
    '.jmsdm-backdrop',
    '.jmsdm-card',
    '.mini-poster-popover',
    '.mini-trailer-popover',
    '.jms-avatarBackdrop',
    '.jms-avatarModal',
    '.jms-avatarPickBtn',
    '#jfProfileChooserOverlay',
    '#jfProfileChooserBtn',
    '.jf-profile-overlay',
    '.jf-profile-header-btn',
    '#jms-pause-overlay',
    '#jms-overlay-progress',
    '#pause-status-bottom-right',
    '#jms-reco-panel',
    '.rating-genre-overlay',
    '.rating-icons-overlay',
    '.videoOsdBottom.videoOsdBottom-maincontrols .buttons',
    '.btnJmsSubtitleCustomizer',
    '[data-jms-subtitle-dialog]',
    '#jms-subtitle-dialog',
    '.jms-subtitle-dialog'
  ].join(',');
  const FEATURE_CSS_SYNC_MIN_DELAY_MS = 160;

  function shouldQueueFeatureCssSyncFromMutations(mutations) {
    return mutationsTouchSelectors(mutations, FEATURE_CSS_SYNC_SELECTOR_TEXT);
  }

  const vmap = {
    peakslider: '/slider/src/peakslider.css',
    fullslider: '/slider/src/fullslider.css',
    normalslider: '/slider/src/normalslider.css',
    slider: '/slider/src/slider.css',
    auroraslider: '/slider/src/auroraSlider.css'
  };

  function applyFeatureCss() {
    const cfg = getLiveConfig();
    const variant = getCssVariant(cfg);
    const notificationsCssEnabled = isNotificationsCssActive(cfg);
    const recommendationCssEnabled = isRecommendationCssActive(cfg);
    const studioHubsCssEnabled = isStudioHubsCssActive(cfg);
    const detailsModalCssEnabled = isDetailsModalCssActive(cfg);
    const miniPopoverCssEnabled = isMiniPopoverCssActive(cfg);
    const avatarPickerCssEnabled = isAvatarPickerCssActive(cfg);
    const profileChooserCssEnabled = isProfileChooserCssActive(cfg);
    const pauseFeatureCssEnabled = isPauseFeatureCssActive(cfg);
    const subtitleCustomizerCssEnabled = isSubtitleCustomizerCssActive(cfg);
    const sliderCssEnabled = isSliderCssActive(cfg);

    syncCSS('/slider/src/fontawesome/all.min.css', 'jms-css-fontawesome', true);
    D.getElementById('jms-css-notifications')?.remove();
    syncCSS('/slider/src/pauseModul.css', 'jms-css-pause', pauseFeatureCssEnabled);
    syncCSS('/slider/src/personalRecommendations.css', 'jms-css-recs', recommendationCssEnabled);
    syncCSS('/slider/src/studioHubs.css', 'jms-css-studiohubs', studioHubsCssEnabled);
    syncCSS('/slider/src/detailsModal.css', 'jms-css-detailsModal', detailsModalCssEnabled);
    syncCSS('/slider/src/studioHubsMini.css', 'jms-css-studioHubsMini', miniPopoverCssEnabled);
    syncCSS('/slider/src/avatarPicker.css', 'jms-css-avatarPicker', avatarPickerCssEnabled);
    syncCSS('/slider/src/profileChooser.css', 'jms-css-profileChooser', profileChooserCssEnabled);
    syncCSS('/slider/src/subtitleCustomizer.css', 'jms-css-subtitleCustomizer', subtitleCustomizerCssEnabled);
    syncCSS(vmap[variant] || vmap.normalslider, 'jms-css-variant', sliderCssEnabled);

    if (!notificationsCssEnabled) {
      removeCssByHref([
        'slider/src/notifications.css',
        'slider/src/notifications2.css',
        'slider/src/notifications3.css',
        'slider/src/notifications4.css'
      ]);
    }
    if (!recommendationCssEnabled) {
      removeCssByHref(['slider/src/personalRecommendations.css']);
    }
    if (!studioHubsCssEnabled) {
      removeCssByHref(['slider/src/studioHubs.css']);
    }
    if (!detailsModalCssEnabled) {
      removeCssByHref(['slider/src/detailsModal.css']);
    }
    if (!miniPopoverCssEnabled) {
      removeCssByHref(['slider/src/studioHubsMini.css']);
    }
    if (!avatarPickerCssEnabled) {
      removeCssByHref(['slider/src/avatarPicker.css']);
    }
    if (!profileChooserCssEnabled) {
      removeCssByHref(['slider/src/profileChooser.css']);
    }
    if (!pauseFeatureCssEnabled) {
      removeCssByHref(['slider/src/pauseModul.css']);
    }
    if (!subtitleCustomizerCssEnabled) {
      removeCssByHref(['slider/src/subtitleCustomizer.css']);
    }
    if (!sliderCssEnabled) {
      removeCssByHref([
        'slider/src/peakslider.css',
        'slider/src/fullslider.css',
        'slider/src/normalslider.css',
        'slider/src/slider.css',
        'slider/src/auroraSlider.css'
      ]);
    }

    document.documentElement.dataset.cssVariant =
      variant === 'slider' ? 'slider' : variant;
    window.__cssVariant = document.documentElement.dataset.cssVariant;
    document.documentElement.setAttribute('data-jms-notif', cfg.enableNotifications ? '1' : '0');
  }

  let cssSyncQueued = false;
  let cssSyncTimer = 0;
  let cssLastSyncAt = 0;
  function queueFeatureCssSync(options = {}) {
    const force = options?.force === true;
    if (cssSyncQueued) return;
    if (cssSyncTimer) {
      if (!force) return;
      clearTimeout(cssSyncTimer);
      cssSyncTimer = 0;
    }

    const elapsed = Date.now() - cssLastSyncAt;
    const delay = force ? 0 : Math.max(0, FEATURE_CSS_SYNC_MIN_DELAY_MS - elapsed);

    cssSyncTimer = window.setTimeout(() => {
      cssSyncTimer = 0;
      if (cssSyncQueued) return;
      cssSyncQueued = true;
      raf(() => {
        cssSyncQueued = false;
        cssLastSyncAt = Date.now();
        applyFeatureCss();
      });
    }, delay);
  }

  try {
    window.__jmsQueueFeatureCssSync = queueFeatureCssSync;
  } catch {}

  applyFeatureCss();

  D.addEventListener('DOMContentLoaded', () => queueFeatureCssSync({ force: true }), { once: true });
  window.addEventListener('hashchange', () => queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListener('popstate', () => queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListener('pageshow', () => queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListener('jms:globalPreviewModeChanged', () => queueFeatureCssSync({ force: true }), { passive: true });

  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver((mutations) => {
      if (!shouldQueueFeatureCssSyncFromMutations(mutations)) return;
      queueFeatureCssSync();
    });
    mo.observe(getDomObserveRoot(), {
      childList: true,
      subtree: true
    });
  }
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
  const pb = document.querySelector(".monwui-slide-progress-bar");
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

function hasStartedCycleClock() {
  return Number(window.__cycleStartAt || 0) > 0;
}

function isCustomSplashBlockingNow() {
  try {
    const root = getCustomSplashRoot();
    return !!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR) && !root?.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  } catch {
    return false;
  }
}

function markSlideCreated(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) return;
  window.__slidesCreated = (window.__slidesCreated || 0) + 1;
  const totalSlides = Math.max(0, Number(window.__totalSlidesPlanned) || 0);
  const createdSlides = Math.max(0, Number(window.__slidesCreated) || 0);
  syncCustomSplashProgress({
    totalSlides,
    createdSlides,
    allSlidesReady: totalSlides > 0 && createdSlides >= totalSlides
  });
  if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
    try {
      document.dispatchEvent(new CustomEvent("jms:all-slides-ready"));
    } catch {}
  }
}

function chunkArray(arr, size = 2) {
  const out = [];
  const safeSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < arr.length; i += safeSize) {
    out.push(arr.slice(i, i + safeSize));
  }
  return out;
}

function wrapIndex(index, len) {
  if (!len) return 0;
  return ((index % len) + len) % len;
}

function buildPeakCreationBatches(total, peakOpts = {}) {
  if (!Number.isFinite(total) || total <= 0) return [];

  const { spanLeft = 1, spanRight = 1 } = peakOpts || {};
  const seen = new Set();
  const firstBatch = [];
  const laterVisible = [];
  const initialLeft = Math.min(Math.max(0, spanLeft), 5);
  const initialRight = Math.min(Math.max(0, spanRight), 5);
  const add = (target, idx) => {
    const safe = wrapIndex(idx, total);
    if (seen.has(safe)) return;
    seen.add(safe);
    target.push(safe);
  };

  add(firstBatch, 0);
  for (let step = 1; step <= initialRight; step++) {
    add(firstBatch, step);
  }
  for (let step = 1; step <= initialLeft; step++) {
    add(firstBatch, total - step);
  }

  const maxVisibleSpan = Math.max(spanLeft, spanRight, initialLeft, initialRight);
  for (let step = 1; step <= maxVisibleSpan; step++) {
    if (step > initialRight && step <= spanRight) add(laterVisible, step);
    if (step > initialLeft && step <= spanLeft) add(laterVisible, total - step);
  }

  const background = [];
  for (let idx = 0; idx < total; idx++) {
    add(background, idx);
  }

  return [firstBatch, ...chunkArray([...laterVisible, ...background], 2)].filter((batch) => batch.length);
}

function hardProgressReset() {
  ensureProgressBarExists();
  const pb = document.querySelector(".monwui-slide-progress-bar");
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
  if (!isSliderEnabled()) return;
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
    document.querySelectorAll(".monwui-dot-navigation-container").forEach(n => n.remove());
    await new Promise(r => setTimeout(r, 30));
    window.__initOnHomeOnce = false;
    initializeSliderOnHome({ forceManagedSectionsBoot: true });
  } finally {
    window.__rebuildingSlider = false;
  }
}

function getSlidesNodeList() {
  const idxPage = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  return idxPage ? idxPage.querySelectorAll(".monwui-slide") : null;
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
  const pb = document.querySelector(".monwui-slide-progress-bar");
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
syncProfileChooserHeaderButtonVisibility(config?.enableProfileChooser !== false);

function getMainConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function shouldRenderPersonalRecommendationUi(cfg = getMainConfig()) {
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  return !!(
    homeSectionsConfig.enablePersonalRecommendations ||
    homeSectionsConfig.enableGenreHubs ||
    homeSectionsConfig.enableBecauseYouWatched
  );
}

function shouldRenderDirectorRowsUi(cfg = getMainConfig()) {
  return getHomeSectionsRuntimeConfig(cfg).enableDirectorRows;
}

function shouldRenderRecentRowsUi(cfg = getMainConfig()) {
  const homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  return !!(
    homeSectionsConfig.enableRecentRows ||
    homeSectionsConfig.enableContinueMovies ||
    homeSectionsConfig.enableContinueSeries ||
    homeSectionsConfig.enableOtherLibRows
  );
}

function shouldRenderStudioHubsUi(cfg = getMainConfig()) {
  return getHomeSectionsRuntimeConfig(cfg).enableStudioHubs;
}

function getPauseRuntimeConfig(cfg = getMainConfig()) {
  return getPauseFeaturesRuntimeConfig(cfg);
}

function shouldBootPauseModule(cfg = getMainConfig()) {
  const pauseConfig = getPauseRuntimeConfig(cfg);
  return !!(pauseConfig.enablePauseOverlay || pauseConfig.enableSmartAutoPause);
}

function shouldBootPauseOsdHeaderRatings(cfg = getMainConfig()) {
  return getPauseRuntimeConfig(cfg).enablePauseOsdHeaderRatings;
}

function isSliderEnabled() {
  try {
    const cfg = getMainConfig();
    return cfg.enableSlider !== false;
  } catch {
    return true;
  }
}

let cleanupPauseOverlay = null;
let pauseModulePromise = null;
let pauseBooted = false;
let cleanupSubtitleCustomizer = null;
let subtitleCustomizerBooted = false;
let subtitleCustomizerModulePromise = null;
let cleanupOsdHeaderRatings = null;
let osdHeaderRatingsBooted = false;
let osdHeaderRatingsModulePromise = null;
let navObsBooted = false;
window.sliderResetInProgress = window.sliderResetInProgress || false;
window.__slidesInitRunning = window.__slidesInitRunning || false;

async function loadPauseModule() {
  if (!pauseModulePromise) {
    pauseModulePromise = import("./modules/pauseModul.js");
  }
  return pauseModulePromise;
}

async function loadSubtitleCustomizerModule() {
  if (!subtitleCustomizerModulePromise) {
    subtitleCustomizerModulePromise = import("./modules/subtitleCustomizer.js");
  }
  return subtitleCustomizerModulePromise;
}

async function loadOsdHeaderRatingsModule() {
  if (!osdHeaderRatingsModulePromise) {
    osdHeaderRatingsModulePromise = import("./modules/osdHeaderRatings.js");
  }
  return osdHeaderRatingsModulePromise;
}

function destroyPauseOverlay() {
  if (cleanupPauseOverlay) {
    try {
      cleanupPauseOverlay();
    } catch {}
  }
  cleanupPauseOverlay = null;
  pauseBooted = false;
  try {
    window.__jmsPauseOverlay?.destroy?.();
  } catch {}
}

function destroySubtitleCustomizer() {
  if (cleanupSubtitleCustomizer) {
    try {
      cleanupSubtitleCustomizer();
    } catch {}
  }
  cleanupSubtitleCustomizer = null;
  subtitleCustomizerBooted = false;
  try {
    window.cleanupSubtitleCustomizer = null;
  } catch {}
}

function destroyOsdHeaderRatings() {
  if (cleanupOsdHeaderRatings) {
    try {
      cleanupOsdHeaderRatings();
    } catch {}
  }
  cleanupOsdHeaderRatings = null;
  osdHeaderRatingsBooted = false;
  try {
    window.__jmsOsdHeaderRatings?.destroy?.();
  } catch {}
  try {
    window.cleanupOsdHeaderRatings = null;
  } catch {}
}

async function startPauseOverlayOnce() {
  if (!shouldBootPauseModule()) {
    destroyPauseOverlay();
    return false;
  }
  if (pauseBooted) return true;

  pauseBooted = true;
  try {
    const mod = await loadPauseModule();
    if (!shouldBootPauseModule()) {
      pauseBooted = false;
      return false;
    }
    cleanupPauseOverlay = mod?.setupPauseScreen?.() || null;
    return true;
  } catch (e) {
    pauseBooted = false;
    console.warn("startPauseOverlayOnce hata:", e);
    return false;
  }
}

async function restartPauseOverlay() {
  destroyPauseOverlay();
  return startPauseOverlayOnce();
}

async function refreshSubtitleCustomizer() {
  if (!isSubtitleCustomizerModuleEnabled(getMainConfig())) {
    destroySubtitleCustomizer();
    return false;
  }
  if (subtitleCustomizerBooted) return true;

  subtitleCustomizerBooted = true;
  try {
    const mod = await loadSubtitleCustomizerModule();
    if (!isSubtitleCustomizerModuleEnabled(getMainConfig())) {
      subtitleCustomizerBooted = false;
      return false;
    }
    cleanupSubtitleCustomizer = mod?.initSubtitleCustomizer?.() || null;
    window.cleanupSubtitleCustomizer = cleanupSubtitleCustomizer;
    return true;
  } catch (e) {
    subtitleCustomizerBooted = false;
    console.warn("refreshSubtitleCustomizer hata:", e);
    return false;
  }
}

async function refreshPauseOsdHeaderRatings({ force = false } = {}) {
  if (!shouldBootPauseOsdHeaderRatings()) {
    destroyOsdHeaderRatings();
    return false;
  }
  if (osdHeaderRatingsBooted && !force) return true;

  destroyOsdHeaderRatings();
  osdHeaderRatingsBooted = true;
  try {
    const mod = await loadOsdHeaderRatingsModule();
    if (!shouldBootPauseOsdHeaderRatings()) {
      osdHeaderRatingsBooted = false;
      return false;
    }
    cleanupOsdHeaderRatings = mod?.initOsdHeaderRatings?.() || null;
    window.cleanupOsdHeaderRatings = cleanupOsdHeaderRatings;
    return true;
  } catch (e) {
    osdHeaderRatingsBooted = false;
    console.warn("refreshPauseOsdHeaderRatings hata:", e);
    return false;
  }
}

async function refreshOptionalModules({ forcePause = false } = {}) {
  const tasks = [
    refreshSubtitleCustomizer(),
    forcePause ? restartPauseOverlay() : startPauseOverlayOnce(),
    refreshPauseOsdHeaderRatings({ force: forcePause })
  ];

  const results = await Promise.allSettled(tasks);
  try {
    window.__jmsQueueFeatureCssSync?.();
  } catch {}
  return results;
}

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

function isHomeRouteActive() {
  const hash = String(window.location.hash || "").toLowerCase().trim();
  return hash.startsWith("#/home") || hash.startsWith("#/index") || hash === "" || hash === "#";
}

function getVisibleHomePageEl() {
  return document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
}

function getVisibleHomeSectionsContainerEl(page = getVisibleHomePageEl()) {
  const container = page?.querySelector?.(".homeSectionsContainer");
  return container?.isConnected ? container : null;
}

function hasVisibleHomePage() {
  return !!getVisibleHomePageEl();
}

function isHomeVisible() {
  return hasVisibleHomePage() && isHomeRouteActive();
}

function ensureLayerPropertySanitizer() {
  if (window.__jmsLayerSanitizerReady) return;
  window.__jmsLayerSanitizerReady = true;

  const root = document.documentElement;
  const CLASS_NAME = "jms-layer-sanitized";
  const STYLE_ID = "jms-layer-sanitizer-css";

  // Keep peakslider and the live subtitle transform pipeline out of the
  // default sanitizer; those flows still rely on targeted compositor hints.
  const nonPeakSliderTargets = [
    "#monwui-slides-container",
    "#monwui-slides-container .monwui-slide",
    "#monwui-slides-container .monwui-bckdrp-cntnr",
    "#monwui-slides-container .monwui-backdrop",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay:before",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay:after",
    "#monwui-slides-container .monwui-logo-container",
    "#monwui-slides-container .monwui-logo-container .logo-img",
    "#monwui-slides-container .monwui-title-container",
    "#monwui-slides-container .monwui-plot-container",
    "#monwui-slides-container .monwui-provider-container",
    "#monwui-slides-container .monwui-info-container",
    "#monwui-slides-container .monwui-language-container",
    "#monwui-slides-container .monwui-status-container",
    "#monwui-slides-container .monwui-meta-container",
    "#monwui-slides-container .monwui-slider-wrapper",
    "#monwui-slides-container .monwui-button-container",
    "#monwui-slides-container .monwui-button-container *",
    "#monwui-slides-container .monwui-dot-navigation-container",
    "#monwui-slides-container .monwui-dot",
    "#monwui-slides-container .monwui-poster-dot",
    "#monwui-slides-container img.monwui-dot-poster-image"
  ];

  const pluginSurfaceTargets = [
    ".video-preview-modal",
    ".video-preview-modal *",
    ".mini-poster-popover",
    ".mini-poster-popover *",
    ".mini-trailer-popover",
    ".mini-trailer-popover *",
    ".genre-explorer-overlay",
    ".genre-explorer",
    ".genre-explorer *",
    ".ge-card",
    ".ge-card *",
    "#jms-details-modal-root",
    "#jms-details-modal-root *",
    "#studio-hubs",
    "#studio-hubs *",
    ".hub-preview-popover",
    ".hub-preview-popover *",
    "#jms-pause-overlay",
    "#jms-pause-overlay *",
    "#jms-reco-panel",
    "#jms-reco-panel *",
    "#jms-reco-badge",
    "#jms-reco-badge *",
    ".rating-genre-overlay",
    ".rating-genre-overlay *",
    ".rating-icons-overlay",
    ".rating-icons-overlay *",
    ".jms-cast-modal",
    ".jms-cast-modal *",
    ".jms-cast-slide",
    ".jms-cast-slide *",
    ".gmmp-radio-modal",
    ".gmmp-radio-modal *",
    "#modern-music-player",
    "#modern-music-player *",
    "#player-lyrics-container",
    "#player-lyrics-container *",
    ".jellyfin-playlist-modal",
    ".jellyfin-playlist-modal *",
    ".playlistselect-modal",
    ".playlistselect-modal *",
    ".top-tracks-modal",
    ".top-tracks-modal *"
  ];

  const nativeHomeCardTargets = [
    "#indexPage:not(.hide) .itemsContainer .cardBox",
    "#indexPage:not(.hide) .itemsContainer .cardBox *",
    "#indexPage:not(.hide) .itemsContainer .cardScalable",
    "#indexPage:not(.hide) .itemsContainer .cardScalable *",
    "#indexPage:not(.hide) .itemsContainer .cardOverlayContainer",
    "#indexPage:not(.hide) .itemsContainer .cardOverlayContainer *",
    "#indexPage:not(.hide) .itemsContainer .cardImageContainer",
    "#indexPage:not(.hide) .itemsContainer .cardImageContainer *",
    "#indexPage:not(.hide) .itemsContainer .cardText",
    "#indexPage:not(.hide) .itemsContainer .cardText *",
    "#homePage:not(.hide) .itemsContainer .cardBox",
    "#homePage:not(.hide) .itemsContainer .cardBox *",
    "#homePage:not(.hide) .itemsContainer .cardScalable",
    "#homePage:not(.hide) .itemsContainer .cardScalable *",
    "#homePage:not(.hide) .itemsContainer .cardOverlayContainer",
    "#homePage:not(.hide) .itemsContainer .cardOverlayContainer *",
    "#homePage:not(.hide) .itemsContainer .cardImageContainer",
    "#homePage:not(.hide) .itemsContainer .cardImageContainer *",
    "#homePage:not(.hide) .itemsContainer .cardText",
    "#homePage:not(.hide) .itemsContainer .cardText *"
  ];

  const sanitizeRule = `
    contain: none !important;
    content-visibility: visible !important;
    contain-intrinsic-size: auto !important;
    will-change: auto !important;
    backface-visibility: visible !important;
    -webkit-backface-visibility: visible !important;
  `;

  const scoped = (selectors, prefix) =>
    selectors.map((selector) => `${prefix} ${selector}`).join(",\n");

  const injectStyle = () => {
    if (!document.head || document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      ${scoped(nonPeakSliderTargets, `html.${CLASS_NAME}:not([data-css-variant=peakslider])`)} {
        ${sanitizeRule}
      }

      ${scoped(pluginSurfaceTargets, `html.${CLASS_NAME}`)} {
        ${sanitizeRule}
      }

      ${scoped(nativeHomeCardTargets, `html.${CLASS_NAME}`)} {
        ${sanitizeRule}
      }
    `;
    document.head.appendChild(st);
  };

  root?.classList.add(CLASS_NAME);

  if (document.head) {
    injectStyle();
  } else {
    document.addEventListener("DOMContentLoaded", injectStyle, { once: true });
  }
}

ensureLayerPropertySanitizer();

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

async function mapLimit(arr, limit, mapper) {
  const list = Array.isArray(arr) ? arr : [];
  const out = new Array(list.length);
  let i = 0;
  const workers = new Array(Math.max(1, limit | 0)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        out[idx] = await mapper(list[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function setupGlobalModalInit() {
  whenFirstSlideReadyOrTimeout(() => {
    queueHoverModuleBoot();
  }, 2500);
  const observer = observeDOMChanges();
  return () => observer.disconnect();
}
const cleanupModalObserver = setupGlobalModalInit();
window.cleanupModalObserver = cleanupModalObserver;

function runNonCriticalUiBootOnce() {
  if (window.__jmsNonCriticalBooted) return;
  window.__jmsNonCriticalBooted = true;

  whenFirstSlideReadyOrTimeout(() => {
    idle(() => {
      try {
        if (!window.cleanupProfileChooser) {
          window.cleanupProfileChooser = initProfileChooser();
        }
      } catch {}

      try {
        if (!window.cleanupAvatarSystem) {
          window.cleanupAvatarSystem = initAvatarSystem();
        }
      } catch {}

      try {
        const liveCfg = getMainConfig();
        if (liveCfg.enableNotifications !== false) {
          bootNotificationsOnce();
        } else {
          document.getElementById("jfNotifBtn")?.remove();
          document.getElementById("jfNotifModal")?.remove();
          document.querySelector(".jf-notif-panel")?.remove();
          document.documentElement.dataset.jmsNotif = "0";
        }
      } catch {}

      if (config.enableQualityBadges && !window.__qualityBadgesBooted) {
        window.__qualityBadgesBooted = true;
        try { window.cleanupQualityBadges = initializeQualityBadges(); } catch {}
      }

    });
  }, 7000);
}

forceSkinHeaderPointerEvents();
forceHomeSectionsTop();
const cleanupAvatarPicker = initUserProfileAvatarPicker();
window.cleanupAvatarPicker = cleanupAvatarPicker;
window.__jmsRefreshOptionalModules = (options = {}) => {
  return refreshOptionalModules(options);
};
void refreshOptionalModules();

const NOTIF_ENABLED = getMainConfig().enableNotifications !== false;
try {
  if (!window.cleanupProfileChooser) {
    window.cleanupProfileChooser = initProfileChooser();
  }
} catch {}

if (!NOTIF_ENABLED) {
  document.documentElement.dataset.jmsNotif = "0";
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
window.__jmsIndexerRetryTimer = window.__jmsIndexerRetryTimer || null;
window.__jmsIndexerRetryInFlight = window.__jmsIndexerRetryInFlight || false;
window.__jmsIndexerAutoStartTimer = window.__jmsIndexerAutoStartTimer || null;
window.__jmsIndexerAutoStartReady = window.__jmsIndexerAutoStartReady || false;
window.__jmsIndexerAutoStartPending = window.__jmsIndexerAutoStartPending || false;

function fullSliderReset({ preserveHomeSections = true, invalidateBoot = true } = {}) {
  try { teardownAnimations(); } catch {}
  forceSkinHeaderPointerEvents();
  forceHomeSectionsTop();
  if (invalidateBoot) {
    invalidateSliderBootSession();
  }

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
  try { window.__cleanupActiveWatch?.(); } catch {}
  window.__cleanupActiveWatch = null;
  clearQueuedHomeSectionsBoot();
  cleanupSlider({ preserveHomeSections, invalidateBoot: false });
  clearCycleArm();
  try { window.__peakBooting = true; } catch {}
  window.__jmsFirstSlideReady = false;
  window.__cycleStartAt = 0;
  window.__cycleExpired = false;
  window.mySlider = {};
  try { delete window.__recsWiresBooted; } catch {}
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

function observeDOMChanges() {
  let scheduled = false;
  const scheduleHoverRefresh = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      queueHoverModuleBoot();
    });
  };

  const observer = new MutationObserver((mutations) => {
    if (document.documentElement.dataset.jmsSoftBlock === "1") return;
    const hasRelevantAddition = mutations.some((mutation) => {
      if (!mutation.addedNodes.length) return false;
      return Array.from(mutation.addedNodes).some((node) => {
        if (node.nodeType !== 1) return false;
        if (node.classList?.contains("cardImageContainer")) return true;
        return !!node.querySelector?.(".cardImageContainer");
      });
    });

    if (hasRelevantAddition) {
      scheduleHoverRefresh();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  return observer;
}

function hydrateSlideMedia(slideEl) {
  if (!slideEl) return;
  slideEl
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
  slideEl.querySelectorAll("[data-backdrop],[data-bg],[data-bg-src]").forEach((el) => {
    const u = el.getAttribute("data-backdrop") || el.getAttribute("data-bg") || el.getAttribute("data-bg-src");
    if (u && !el.style.backgroundImage) el.style.backgroundImage = `url("${u}")`;
  });
  slideEl.style.visibility = "visible";
  slideEl.removeAttribute("aria-hidden");
  slideEl.style.opacity = "";
  slideEl.style.filter = "";
  slideEl.style.display = "";
  slideEl.classList.remove("lazyloaded", "lazyload");
  slideEl.classList.remove("is-loading", "hidden", "hide");
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
  let c = indexPage.querySelector("#monwui-slides-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "monwui-slides-container";
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

async function waitForVisibleIndexPage(timeout = 20000) {
  const candidates = [
    "#indexPage:not(.hide) .homeSectionsContainer",
    "#homePage:not(.hide) .homeSectionsContainer",
    "#indexPage:not(.hide)",
    "#homePage:not(.hide)"
  ];
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

function requiresAuthRequest(url = "") {
  try {
    const input = String(url || "");
    const path = /^https?:\/\//i.test(input) ? new URL(input).pathname : input;
    return /\/Users\/|\/Sessions\b|\/Items\/[^/]+\/PlaybackInfo\b|\/Videos\//i.test(path);
  } catch {
    return true;
  }
}

function withApiKeyIfNeeded(url, token) {
  const raw = String(url || "").trim();
  const apiKey = String(token || "").trim();
  if (!raw || !apiKey || !requiresAuthRequest(raw)) return raw;

  try {
    const u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    if (!u.searchParams.get("api_key")) {
      u.searchParams.set("api_key", apiKey);
    }
    return /^https?:\/\//i.test(raw)
      ? u.toString()
      : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const sep = raw.includes("?") ? "&" : "?";
    return raw.includes("api_key=") ? raw : `${raw}${sep}api_key=${encodeURIComponent(apiKey)}`;
  }
}

function buildSafeFetchHeaders(url, incomingHeaders) {
  const headers = new Headers(incomingHeaders || {});
  if (!requiresAuthRequest(url)) return headers;

  const session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
  const token = String(session.accessToken || getAuthToken() || "").trim();
  const userId = String(session.userId || "").trim();
  const authHeader = String((typeof getAuthHeader === "function" ? getAuthHeader() : "") || "").trim();

  if (!String(headers.get("Authorization") || "").trim() && authHeader) {
    headers.set("Authorization", authHeader);
  }

  if (!String(headers.get("X-Emby-Token") || "").trim() && token) {
    headers.set("X-Emby-Token", token);
  }
  if (!String(headers.get("X-Emby-UserId") || "").trim() && userId) {
    headers.set("X-Emby-UserId", userId);
  }

  return headers;
}

async function safeFetch(url, opts = {}) {
  const normalizedUrl = normalizeWithServer(url);
  if (requiresAuthRequest(normalizedUrl)) {
    if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
      try { await waitForAuthReadyStrict(5000); } catch {}
    }

    const session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
    const token = String(session.accessToken || getAuthToken() || "").trim();
    if (!token) {
      const err = new Error(`Auth not ready for ${url}`);
      err.status = 0;
      throw err;
    }
    const finalUrl = withApiKeyIfNeeded(normalizedUrl, token);
    return fetch(finalUrl, {
      ...opts,
      credentials: opts?.credentials || "same-origin",
      headers: buildSafeFetchHeaders(finalUrl, opts?.headers)
    });
  }

  return fetch(normalizedUrl, {
    ...opts,
    credentials: opts?.credentials || "same-origin",
    headers: buildSafeFetchHeaders(normalizedUrl, opts?.headers)
  });
}

async function fetchJsonViaSafeFetch(url, opts){
  const res = await safeFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
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
  const firstActive = indexPage.querySelector(".monwui-slide.active") || indexPage.querySelector(".monwui-slide");
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
    firstActive.querySelector(".monwui-horizontal-gradient-overlay"),
    firstActive.querySelector(".monwui-slide-backdrop"),
    firstActive.querySelector(".monwui-backdrop"),
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
  const pb = document.querySelector(".monwui-slide-progress-bar");
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
  const slides = indexPage.querySelectorAll(".monwui-slide");
  if (!slides.length) return;
  const cur = getCurrentIndex();
  const idx = Number.isFinite(cur) && cur >= 0 ? cur : 0;
  setCurrentIndex(idx);
  slides.forEach((s, i) => s.classList.toggle("active", i === idx));
}

function triggerSlideEnterHooks(indexPage) {
  const active = indexPage.querySelector(".monwui-slide.active") || indexPage.querySelector(".monwui-slide");
  if (!active) return;
  try {
    active.dispatchEvent(new CustomEvent("jms:slide-enter", { bubbles: true }));
  } catch {}
}

function repairVisibleSliderLayout({ forcePrime = false } = {}) {
  if (document.hidden) return;
  const indexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  const slides = Array.from(indexPage.querySelectorAll(".monwui-slide"));
  if (!slides.length) return;

  const cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
  const isPeak = !!cfg.peakSlider;
  const slidesContainer = indexPage.querySelector("#monwui-slides-container");
  const safeIndex = Math.min(
    Math.max(Number(getCurrentIndex()) || 0, 0),
    Math.max(0, slides.length - 1)
  );

  setCurrentIndex(safeIndex);

  if (slidesContainer) {
    slidesContainer.classList.remove("peak-shifting");
    if (isPeak) {
      slidesContainer.classList.add("peak-mode");
      if (forcePrime) {
        slidesContainer.classList.remove("peak-ready");
        slidesContainer.classList.add("peak-init");
        try { delete slidesContainer.dataset.peakPrimed; } catch {}
      }
    } else {
      slidesContainer.classList.remove("peak-mode", "peak-ready", "peak-init");
      try { delete slidesContainer.dataset.peakPrimed; } catch {}
    }
  }

  slides.forEach((slideEl, index) => {
    try { hardCleanupSlide(slideEl); } catch {}
    slideEl.classList.remove("peak-batch-pending", "peak-snap-in");
    slideEl.style.removeProperty("left");
    slideEl.style.removeProperty("top");

    const active = index === safeIndex;
    slideEl.classList.toggle("active", active);

    if (isPeak) {
      slideEl.classList.remove("is-hidden");
      slideEl.style.removeProperty("display");
      slideEl.style.removeProperty("opacity");
      return;
    }

    slideEl.classList.toggle("is-visible", active);
    slideEl.classList.toggle("is-hidden", !active);
    if (active) {
      slideEl.style.removeProperty("display");
      slideEl.style.removeProperty("opacity");
    } else {
      slideEl.style.opacity = "0";
      slideEl.style.display = "none";
    }
  });

  hydrateFirstSlide(indexPage);
  try { updateSlidePosition(); } catch {}

  if (isPeak) {
    try { syncPeakStructureNow(indexPage, { forcePrime: forcePrime || !slidesContainer?.classList.contains("peak-ready") }); } catch {}
  }

  try { updateProgressBarPosition(); } catch {}
  triggerSlideEnterHooks(indexPage);
}

let __sliderRepairRafA = 0;
let __sliderRepairRafB = 0;
let __sliderRepairForcePrime = false;

function cancelPendingSliderRepair() {
  if (__sliderRepairRafA) cancelAnimationFrame(__sliderRepairRafA);
  if (__sliderRepairRafB) cancelAnimationFrame(__sliderRepairRafB);
  __sliderRepairRafA = 0;
  __sliderRepairRafB = 0;
}

function scheduleVisibleSliderRepair({ forcePrime = false } = {}) {
  if (document.hidden) return;
  __sliderRepairForcePrime = __sliderRepairForcePrime || !!forcePrime;
  cancelPendingSliderRepair();
  __sliderRepairRafA = requestAnimationFrame(() => {
    __sliderRepairRafA = 0;
    __sliderRepairRafB = requestAnimationFrame(() => {
      __sliderRepairRafB = 0;
      const doForcePrime = __sliderRepairForcePrime;
      __sliderRepairForcePrime = false;
      repairVisibleSliderLayout({ forcePrime: doForcePrime });
    });
  });
}

function shouldRepairVisibleSliderOnRestore({ forcePrime = false } = {}) {
  if (document.hidden) return false;

  const indexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return false;

  const slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer || !isVisible(slidesContainer)) return false;

  const slides = Array.from(indexPage.querySelectorAll(".monwui-slide"));
  if (!slides.length) return false;

  const safeIndex = Math.min(
    Math.max(Number(getCurrentIndex()) || 0, 0),
    Math.max(0, slides.length - 1)
  );
  const activeSlide = slides[safeIndex] || slides.find((slideEl) => slideEl.classList.contains("active")) || slides[0];
  if (!activeSlide) return true;
  if (!activeSlide.classList.contains("active")) return true;

  const activeRect = activeSlide.getBoundingClientRect?.();
  if (!activeRect || activeRect.width < 1 || activeRect.height < 1) return true;
  if (activeSlide.classList.contains("is-hidden")) return true;
  if (activeSlide.style.display === "none") return true;

  const cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
  if (!cfg.peakSlider) return false;

  if (!slidesContainer.classList.contains("peak-mode")) return true;
  if (!slidesContainer.classList.contains("peak-ready")) return !!forcePrime;
  if (activeSlide.style.opacity === "0") return true;

  return false;
}

function scheduleVisibleSliderRestoreRepair(options = {}) {
  if (!shouldRepairVisibleSliderOnRestore(options)) return;
  scheduleVisibleSliderRepair(options);
}

function startTimerAndRevealPB(indexPage) {
  if (!indexPage) return;
  const pb = document.querySelector(".monwui-slide-progress-bar");
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
  let lastActive = document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
  let resetRafA = 0;
  let resetRafB = 0;

  const cancelPendingReset = () => {
    if (resetRafA) cancelAnimationFrame(resetRafA);
    if (resetRafB) cancelAnimationFrame(resetRafB);
    resetRafA = 0;
    resetRafB = 0;
  };

  const hardResetNextFrame = () => {
    cancelPendingReset();
    resetRafA = requestAnimationFrame(() => {
      resetRafA = 0;
      resetRafB = requestAnimationFrame(() => {
        resetRafB = 0;
        hardProgressReset();
        restartSlideTimerDeterministic();
        try { warmUpcomingBackdrops(4); } catch {}
      });
    });
  };

  const handleChange = (ev) => {
    const eventSlide = ev?.target?.closest?.('.monwui-slide');
    const cur = eventSlide?.classList?.contains('active')
      ? eventSlide
      : document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
    if (!cur || cur === lastActive) return;
    lastActive = cur;
    hardResetNextFrame();
  };

  document.addEventListener("slideActive", handleChange, true);
  handleChange();
  return () => {
    cancelPendingReset();
    document.removeEventListener("slideActive", handleChange, true);
  };
}

function warmUpcomingBackdrops(count = 3) {
  try {
    const indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) return;

    const slides = [...indexPage.querySelectorAll(".monwui-slide")];
    const active = indexPage.querySelector(".monwui-slide.active") || slides[0];
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
  if (!isSliderEnabled()) {
    console.debug("[JMS] slidesInit() skipped (slider disabled)");
    return;
  }
  if (window.__slidesInitRunning) {
    const runningToken = Number(window.__jmsSlidesInitToken) || 0;
    if (isSliderBootTokenCurrent(runningToken, { requireHomeVisible: false })) {
      console.debug("[JMS] slidesInit() skipped (already running)");
      return;
    }
    window.__slidesInitRunning = false;
  }
  if (!isHomeVisible()) {
    console.debug("[JMS] slidesInit() skipped (home not visible)");
    return;
  }
  const bootToken = beginSliderBootSession();
  window.__jmsSlidesInitToken = bootToken;
  const isBootActive = ({ requireHomeVisible = true, requireContainer = false } = {}) =>
    isSliderBootTokenCurrent(bootToken, { requireHomeVisible, requireContainer });
  window.__slidesInitRunning = true;
  try {
    await waitAuthWarmupFallback(5000);
  } catch {}
  if (!isBootActive({ requireHomeVisible: false })) return;
  syncCustomSplashProgress({ authReady: true });
  try {
    forceSkinHeaderPointerEvents();
    forceHomeSectionsTop();

    const activeResetToken = Number(window.__jmsSliderResetToken) || 0;
    if (window.sliderResetInProgress && !isSliderBootTokenCurrent(activeResetToken, { requireHomeVisible: false })) {
      window.sliderResetInProgress = false;
      window.__jmsSliderResetToken = 0;
    }
    if (!isBootActive()) return;
    if (window.sliderResetInProgress) return;
    window.sliderResetInProgress = true;
    window.__jmsSliderResetToken = bootToken;
    fullSliderReset({ invalidateBoot: false });

    let userId = null, accessToken = null;
    let fetchItemDetailsCached = window.__jmsFetchItemDetailsCached || null;
    const config = getMainConfig();

    function isQuotaErr(e){ return e && (e.name === 'QuotaExceededError' || e.code === 22); }

    function safeLocalGet(key, fallback="[]"){
      try {
        const localValue = localStorage.getItem(key);
        if (localValue != null) return localValue;
      } catch {}
      try {
        const sessionValue = sessionStorage.getItem(key);
        if (sessionValue != null) return sessionValue;
      } catch {}
      return fallback;
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
    if (!isBootActive()) return;

    if (!fetchItemDetailsCached) {
      const bulkBatchSize = Number(config?.detailsBulkBatchSize) || 60;

      const fetchMany = async (ids) => {
        let tok = accessToken;
        try { tok = getSessionInfo?.()?.accessToken || tok; } catch {}

        const headers = {
          "Authorization": getAuthHeader(),
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
            "RemoteTrailers",
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
            "Authorization": getAuthHeader(),
            "X-Emby-Token": tok,
          };
        },
        fetchItemDetailsCached,
        intervalMs: Number(config?.libraryWatchIntervalMs) || 60_000,
        limit: Number(config?.libraryWatchLimit) || 50,
      });
    } catch {}
    if (!isBootActive()) return;

    const cfgLimit =
      Number.isFinite(Number(config?.limit)) ? Number(config.limit) :
      Number.isFinite(Number(config?.savedLimit)) ? Number(config.savedLimit) :
      undefined;
    const savedLimit = Number.isFinite(cfgLimit)
      ? cfgLimit
      : parseInt(localStorage.getItem("limit") || "20", 10);
    window.myUserId = userId;

    let items = [];

    try {
      let listItems = null;

      if (config.useManualList && config.manualListIds) {
        listItems = config.manualListIds.split(",").map((id) => id.trim()).filter(Boolean);
      }

      if (Array.isArray(listItems) && listItems.length) {
        const details = await fetchItemDetailsCached.many(listItems);
        items = details.filter((x) => x);
        syncCustomSplashProgress({
          dataPoolReady: true,
          poolCount: items.length
        });
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
        const hasExplicitSort =
          /(?:^|[?&])sortby=/i.test(queryString) ||
          /(?:^|[?&])sortorder=/i.test(queryString);
        const shouldShuffle = !hasExplicitSort && !config.sortingKeywords?.some(
          (keyword) => queryString.toLowerCase().includes(String(keyword || "").toLowerCase())
        );

        let playingItems = [];
        const playingLimit = (onlyUnwatched ? 0 : parseInt(config.playingLimit || 0, 10));
        const authHeaders = {
        "Authorization": getAuthHeader(),
        "X-Emby-Token": accessToken
      };

        if (playingLimit > 0) {
          try {
            const data = await cachedFetchJson({
            keyParts: ["resume", userId, playingLimit * 2],
            url: `/Users/${userId}/Items?Filters=IsResumable&MediaTypes=Video&Recursive=true&EnableUserData=true&Fields=${encodeURIComponent("Type,UserData,ImageTags,BackdropImageTags,PrimaryImageAspectRatio,Series,SeriesId,CollectionIds,MediaStreams")}&SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=${Math.max(10, playingLimit * 3)}`,
            opts: { headers: authHeaders },
            fetchJson: fetchJsonViaSafeFetch,
            ttlMs: Number(config?.resumeCacheTtlMs) || 30_000,
            allowStaleOnError: true,
          });
            let fetchedItems = Array.isArray(data?.Items) ? data.Items : [];
            fetchedItems = fetchedItems.filter((item) => Number(item?.UserData?.PlaybackPositionTicks || 0) > 0);

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
        syncCustomSplashProgress({
          dataPoolReady: true,
          poolCount: Array.isArray(allItems) ? allItems.length : 0
        });
        if (playingItems.length && allItems.length) {
          const playingIds = new Set(playingItems.map((it) => it && it.Id).filter(Boolean));
          allItems = allItems.filter((it) => it && !playingIds.has(it.Id));
        }

        if (queryString.includes("IncludeItemTypes=Season") || queryString.includes("IncludeItemTypes=Episode")) {
          const seasonDetailConcurrency = Math.max(
            1,
            Number(config?.seasonDetailFetchConcurrency) || 4
          );
          const detailedSeasons = await mapLimit(
            allItems,
            seasonDetailConcurrency,
            async (item) => {
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
            }
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
              let historyWasReset = false;
              if (history.length >= shuffleSeedLimit) {
                resetShuffleHistory(userId);
                history = [];
                historyWasReset = true;
              }
              let pickedIds = [];
              const pickedSet = new Set();
              const pushFromPool = (poolIds, count) => {
                if (count <= 0 || !Array.isArray(poolIds) || !poolIds.length) return;
                const uniquePool = poolIds.filter(
                  (id) => !alreadySelected.has(id) && !pickedSet.has(id)
                );
                if (!uniquePool.length) return;
                const chosen = shuffleArray(uniquePool).slice(0, count);
                chosen.forEach((id) => pickedSet.add(id));
                pickedIds = pickedIds.concat(chosen);
              };

              const unseenIds = allItemIds.filter(
                (id) => !history.includes(id) && !alreadySelected.has(id)
              );
              pushFromPool(unseenIds, remainingSlots);

              if (pickedIds.length < remainingSlots) {
                if (history.length) {
                  resetShuffleHistory(userId);
                  history = [];
                  historyWasReset = true;
                }
                const need = remainingSlots - pickedIds.length;
                const fallbackPool = allItemIds.filter(
                  (id) => !alreadySelected.has(id) && !pickedSet.has(id)
                );
                pushFromPool(fallbackPool, need);
              }
              const selectedItemsFromShuffle = allItems.filter((item) => pickedSet.has(item.Id));
              selectedItems.push(...selectedItemsFromShuffle);
              const historyBase = historyWasReset ? [] : history;
              const newHistory = Array.from(new Set([...historyBase, ...pickedIds])).slice(-shuffleSeedLimit);
              try {
                saveShuffleHistory(userId, newHistory);
                console.debug("[JMS] shuffle history kaydedildi:", userId, newHistory.length);
              } catch (e) {
                console.warn("[JMS] shuffle history kaydedilemedi:", e);
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

        const selectedById = new Map(
          selectedItems
            .filter((it) => it?.Id)
            .map((it) => [it.Id, it])
        );
        const detailed = await fetchItemDetailsCached.many(selectedItems.map(i => i.Id));
        items = detailed
          .map((detail, idx) => {
            const base = selectedById.get(detail?.Id || selectedItems[idx]?.Id) || selectedItems[idx] || null;
            if (!detail) return base;
            if (!base) return detail;

            const baseTicks = Number(base?.UserData?.PlaybackPositionTicks || 0);
            const detailTicks = Number(detail?.UserData?.PlaybackPositionTicks || 0);
            const mergedUserData =
              (baseTicks > detailTicks)
                ? { ...(detail?.UserData || {}), ...(base?.UserData || {}) }
                : { ...(base?.UserData || {}), ...(detail?.UserData || {}) };

            return {
              ...base,
              ...detail,
              UserData: mergedUserData,
              RunTimeTicks: detail?.RunTimeTicks || base?.RunTimeTicks || 0,
              MediaStreams: Array.isArray(detail?.MediaStreams) && detail.MediaStreams.length
                ? detail.MediaStreams
                : (base?.MediaStreams || []),
              RemoteTrailers: Array.isArray(detail?.RemoteTrailers) && detail.RemoteTrailers.length
                ? detail.RemoteTrailers
                : (base?.RemoteTrailers || []),
            };
          })
          .filter((x) => x);
      }
    } catch (err) {
      console.error("Slide verisi hazırlanırken hata:", err);
    }

    if (!isBootActive()) return;
    try { primeQualityFromItems(items); } catch {}
    if (!items.length) {
    console.warn("Hiçbir slayt verisi elde edilemedi.");
    return;
  }
  window.__totalSlidesPlanned = items.length;
  window.__slidesCreated = 0;
  syncCustomSplashProgress({
    selectionReady: true,
    totalSlides: items.length,
    createdSlides: 0
  });

    const peakBatches = config.peakSlider ? buildPeakCreationBatches(items.length, getPeakDisplayOptions()) : [];
    const markSlideReadyWhenVisualSyncOpens = (slideEl) => {
      if (!isBootActive({ requireHomeVisible: false })) return;
      const finalizeWhenVisible = () => {
        waitForFirstSlideVisualReady(slideEl, bootToken, {
          timeoutMs: config.peakSlider ? 4600 : 3200
        }).then((ready) => {
          if (!ready) return;
          markFirstSlideReady(bootToken);
        }).catch(() => {});
      };
      if (typeof slideEl?.__waitForBackdropReady === "function") {
        slideEl.__waitForBackdropReady({
          timeoutMs: config.peakSlider ? 2200 : 1400
        }).finally(() => {
          finalizeWhenVisible();
        });
        return;
      }
      finalizeWhenVisible();
    };
    const createItemAt = async (itemIndex, options = {}) => {
      if (!isBootActive()) return null;
      const item = items[itemIndex];
      if (!item) return null;
      const slideEl = await createSlide(item, { insertAt: itemIndex, ...options });
      if (!isBootActive()) {
        const staleContainer = slideEl?.closest?.("#monwui-slides-container") || null;
        try { slideEl?.__cleanupSlide?.(); } catch {}
        try { slideEl?.remove?.(); } catch {}
        try {
          if (staleContainer && !staleContainer.querySelector(".monwui-slide")) {
            staleContainer.remove();
          }
        } catch {}
        return null;
      }
      if (itemIndex === 0) {
        markSlideReadyWhenVisualSyncOpens(slideEl);
      }
      try { annotateDomWithQualityHints(document); } catch {}
      markSlideCreated(bootToken);
      return slideEl;
    };

    if (config.peakSlider) {
      const [firstBatch = [0]] = peakBatches;
      for (const itemIndex of firstBatch) {
        if (!isBootActive()) return;
        await createItemAt(itemIndex, {
          suppressInitialDisplay: true,
          deferPeakReveal: itemIndex !== 0
        });
      }
    } else {
      if (!isBootActive()) return;
      const first = items[0];
      const firstSlide = await createSlide(first);
      if (!isBootActive()) {
        const staleContainer = firstSlide?.closest?.("#monwui-slides-container") || null;
        try { firstSlide?.__cleanupSlide?.(); } catch {}
        try { firstSlide?.remove?.(); } catch {}
        try {
          if (staleContainer && !staleContainer.querySelector(".monwui-slide")) {
            staleContainer.remove();
          }
        } catch {}
        return;
      }
      markSlideReadyWhenVisualSyncOpens(firstSlide);
      try { annotateDomWithQualityHints(document); } catch {}
      markSlideCreated(bootToken);
    }

    if (!isBootActive()) return;
    const idxPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
    if (idxPage) upsertSlidesContainerAtTop(idxPage);
    try {
      updateSlidePosition();
    } catch {}

    if (config.peakSlider) {
      window.__peakBooting = false;
    }
    initializeSlider(bootToken);
    const rest = config.peakSlider
      ? peakBatches.slice(1)
      : chunkArray(items.map((_, index) => index).slice(1), 1);
    scheduleSliderIdleTask(() => {
      (async () => {
        if (!isBootActive({ requireContainer: true })) return;
        for (const batch of rest) {
          if (!isBootActive({ requireContainer: true })) return;
          try {
            const createdSlides = [];
            for (const itemIndex of batch) {
              if (!isBootActive({ requireContainer: true })) return;
              const slideEl = await createItemAt(itemIndex, {
                suppressInitialDisplay: true,
                deferPeakReveal: config.peakSlider
              });
              if (slideEl) createdSlides.push(slideEl);
            }
            if (!isBootActive({ requireContainer: true })) return;
            if (config.peakSlider) {
              const idxPage = document.querySelector('#indexPage:not(.hide), #homePage:not(.hide)');
              if (idxPage) syncPeakStructureNow(idxPage);
              const releasePending = () => {
                createdSlides.forEach((slideEl) => {
                  if (typeof slideEl?.__releasePeakReveal === "function") {
                    slideEl.__releasePeakReveal();
                    return;
                  }
                  slideEl?.classList?.remove('peak-batch-pending');
                });
              };
              const container = idxPage?.querySelector?.('#monwui-slides-container');
              if (container?.classList?.contains('peak-ready')) {
                requestAnimationFrame(releasePending);
              } else {
                requestAnimationFrame(() => {
                  requestAnimationFrame(releasePending);
                });
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
    if ((Number(window.__jmsSlidesInitToken) || 0) === bootToken) {
      window.__jmsSlidesInitToken = 0;
    }
    if ((Number(window.__jmsSliderResetToken) || 0) === bootToken) {
      window.__jmsSliderResetToken = 0;
    }
    window.sliderResetInProgress = false;
    window.__slidesInitRunning = false;
  }
}

function initializeSlider(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  try {
    if (!isSliderBootTokenCurrent(bootToken, { requireContainer: true })) return;
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
    initSwipeEvents();
    if (config.peakSlider) {
      const sc = indexPage.querySelector('#monwui-slides-container');
      const slides = indexPage.querySelectorAll('.monwui-slide');
      if (sc && slides.length) {
        sc.classList.add('peak-mode');
        primePeakFirstPaint(slides, getCurrentIndex(), sc, getPeakDisplayOptions());
        enablePeakNeighborActivation();
      }
    }
    triggerSlideEnterHooks(indexPage);

    try {
      updateSlidePosition();
    } catch {}

    const slides = indexPage.querySelectorAll(".monwui-slide");
    const slidesContainer = indexPage.querySelector("#monwui-slides-container");
    let focusedSlide = null;
    let keyboardActive = false;

    const pb = document.querySelector(".monwui-slide-progress-bar");
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
  if (!isSliderBootTokenCurrent(bootToken, { requireContainer: true })) {
    if (window.__jmsStartWhenAllReadyHandler === startWhenAllReady) {
      window.__jmsStartWhenAllReadyHandler = null;
    }
    try { document.removeEventListener("jms:all-slides-ready", startWhenAllReady); } catch {}
    return;
  }

  const shouldStartTimer = !hasStartedCycleClock() && !isCustomSplashBlockingNow();

  try {
    const oldDots = document.querySelector(".monwui-dot-navigation-container");
    if (oldDots) oldDots.remove();
    createDotNavigation();
  } catch {}

  if (shouldStartTimer) {
    primeProgressBar(indexPage);
  }
  ensureInitialActivation(indexPage);
  hydrateFirstSlide(indexPage);
  initSwipeEvents();
  if (shouldStartTimer) {
    startNewCycleClock();
    safeRaf(() => {
      hardProgressReset();
      startSlideTimer();
      if (pb) pb.style.opacity = "1";
    });
  } else {
    try { updateProgressBarPosition(); } catch {}
    if (pb) pb.style.opacity = "1";
  }

    try {
      window.__peakBooting = false;
      if (config.peakSlider) {
        const sc = indexPage.querySelector('#monwui-slides-container');
        const slides = indexPage.querySelectorAll('.monwui-slide');
        if (sc && slides.length) {
          sc.classList.add('peak-ready');
          sc.classList.remove('peak-init');
          updatePeakClasses(slides, getCurrentIndex(), getPeakDisplayOptions());
        }
      }
    } catch {}

  try { window.__cleanupActiveWatch?.(); } catch {}
  window.__cleanupActiveWatch = watchActiveSlideChanges();

  if (window.__jmsStartWhenAllReadyHandler === startWhenAllReady) {
    window.__jmsStartWhenAllReadyHandler = null;
  }
  document.removeEventListener("jms:all-slides-ready", startWhenAllReady);
}

clearStartWhenAllReadyHandler();
window.__jmsStartWhenAllReadyHandler = startWhenAllReady;
if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
  startWhenAllReady();
} else {
  document.addEventListener("jms:all-slides-ready", startWhenAllReady, { once: true });
}
    attachMouseEvents();
    const firstImg = indexPage.querySelector(".monwui-slide.active img");
    if (firstImg && !firstImg.complete && firstImg.decode) {
      firstImg.decode().catch(() => {}).finally(() => {});
    }
    slides.forEach((slideEl) => {
      slideEl.addEventListener(
        "focus",
        () => {
          focusedSlide = slideEl;
          slidesContainer?.classList.remove("disable-interaction");
        },
        true
      );
      slideEl.addEventListener(
        "blur",
        () => {
          if (focusedSlide === slideEl) focusedSlide = null;
        },
        true
      );
    });

    indexPage.addEventListener("keydown", async (e) => {
      if (!keyboardActive) return;
      if (e.keyCode === 37) {
        changeSlide(-1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 39) {
        changeSlide(1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 13 && focusedSlide) {
        e.preventDefault();
        const itemId = focusedSlide.dataset.itemId;
        if (!itemId) return;
        const preferBackdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
        const originEl = focusedSlide.__backdropImg || focusedSlide.querySelector?.(".monwui-backdrop") || focusedSlide;
        try {
          await openDetailsModalLazy({
            itemId,
            serverId: getSessionInfo?.()?.serverId || "",
            preferBackdropIndex,
            originEl,
          });
        } catch (err) {
          console.warn("openDetailsModal failed (slider keyboard):", err);
        }
      }
    });

    indexPage.addEventListener("focusin", (e) => {
      if (e.target.closest("#monwui-slides-container")) {
        keyboardActive = true;
        slidesContainer?.classList.remove("disable-interaction");
      }
    });
    indexPage.addEventListener("focusout", (e) => {
      if (!e.target.closest("#monwui-slides-container")) {
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
    const active = document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
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
  let isOnHomePage = isHomeVisible() || isHomeRouteActive();
  let scheduledTimer = 0;
  let disposed = false;

  const checkPageChange = async () => {
    const currentUrl = window.location.href;
    const nowOnHomePage = isHomeVisible() || isHomeRouteActive();

    if (currentUrl !== previousUrl || nowOnHomePage !== isOnHomePage) {
      homeSectionLog("navigation:page-change", {
        fromUrl: previousUrl,
        toUrl: currentUrl,
        wasOnHomePage: isOnHomePage,
        nowOnHomePage,
      });
      previousUrl = currentUrl;
      isOnHomePage = nowOnHomePage;

      if (isOnHomePage) {
        window.__initOnHomeOnce = false;
        fullSliderReset();
        if (getMainConfig().enableNotifications === false) {
          document.getElementById('jfNotifBtn')?.remove();
          document.querySelector('.jf-notif-panel')?.remove();
        }
        const ok = await waitForVisibleIndexPage(12000);
        if (ok) {
          homeSectionLog("navigation:home-ready", {
            currentUrl,
            visible: ok,
          });
          window.__initOnHomeOnce = false;
          initializeSliderOnHome({ forceManagedSectionsBoot: true });
        } else {
          homeSectionWarn("navigation:home-not-ready:observe", {
            currentUrl,
          });
          const stop = observeWhenHomeReady(() => {
            window.__initOnHomeOnce = false;
            initializeSliderOnHome({ forceManagedSectionsBoot: true });
            stop();
          }, 20000);
        }
      } else {
        homeSectionLog("navigation:left-home", {
          currentUrl,
        });
        cleanupSlider();
        window.__initOnHomeOnce = false;
      }
      startPauseOverlayOnce();
    }
  };

  const scheduleCheck = (delay = 0) => {
    if (disposed || scheduledTimer) return;
    scheduledTimer = window.setTimeout(() => {
      scheduledTimer = 0;
      void checkPageChange();
    }, Math.max(0, delay | 0));
  };

  const isHomeMutationTarget = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === "indexPage" || node.id === "homePage") return true;
    if (node.classList?.contains("homeSectionsContainer")) return true;
    return !!node.querySelector?.("#indexPage, #homePage, .homeSectionsContainer");
  };

  const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (isHomeMutationTarget(mutation.target)) {
          scheduleCheck();
          return;
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (isHomeMutationTarget(node)) {
          scheduleCheck();
          return;
        }
      }
    }
  });

  domObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  scheduleCheck();

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    scheduleCheck();
  };
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    scheduleCheck();
  };

  const onPopState = () => scheduleCheck();
  const onHashChange = () => scheduleCheck();
  const onPageShow = () => scheduleCheck();
  const onViewShow = () => scheduleCheck();
  const onViewShown = () => scheduleCheck();
  const onFocus = () => scheduleCheck(50);

  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("viewshow", onViewShow);
  document.addEventListener("viewshown", onViewShown);
  window.addEventListener("focus", onFocus, { passive: true });

  return () => {
    disposed = true;
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = 0;
    }
    try { domObserver.disconnect(); } catch {}
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("viewshow", onViewShow);
    document.removeEventListener("viewshown", onViewShown);
    window.removeEventListener("focus", onFocus);
  };
}

let homeSectionsBootTimer = 0;
let homeSectionsBootSeq = 0;
const HOME_SECTIONS_BOOT_RETRY_DELAYS_MS = [700, 1400, 2400, 3800, 5600, 8000];

function clearQueuedHomeSectionsBoot() {
  if (homeSectionsBootTimer) {
    clearTimeout(homeSectionsBootTimer);
    homeSectionsBootTimer = 0;
  }
  homeSectionsBootSeq += 1;
}

function queueHomeSectionsBoot({
  delayMs = 0,
  eagerStudioHubs = false,
  requireSliderDisabled = false,
  forceManagedSections = false,
  maxRetryCount = HOME_SECTIONS_BOOT_RETRY_DELAYS_MS.length
} = {}) {
  homeSectionsBootSeq += 1;
  const seq = homeSectionsBootSeq;

  if (homeSectionsBootTimer) {
    clearTimeout(homeSectionsBootTimer);
    homeSectionsBootTimer = 0;
  }

  homeSectionLog("queueHomeSectionsBoot:schedule", {
    seq,
    delayMs,
    eagerStudioHubs,
    requireSliderDisabled,
    forceManagedSections,
    maxRetryCount,
  });

  const scheduleAttempt = (waitMs, attemptIndex) => {
    if (homeSectionsBootSeq !== seq) return;
    if (homeSectionsBootTimer) {
      clearTimeout(homeSectionsBootTimer);
      homeSectionsBootTimer = 0;
    }

    homeSectionsBootTimer = window.setTimeout(() => {
      homeSectionsBootTimer = 0;
      idle(() => {
        if (homeSectionsBootSeq !== seq) return;
        if (!isHomeRouteActive()) {
          homeSectionWarn("queueHomeSectionsBoot:skip:not-home-route", {
            seq,
            attemptIndex,
            waitMs,
            requireSliderDisabled,
            forceManagedSections,
          });
          return;
        }
        if (requireSliderDisabled && isSliderEnabled()) {
          homeSectionWarn("queueHomeSectionsBoot:skip:slider-still-enabled", {
            seq,
            attemptIndex,
            waitMs,
            requireSliderDisabled,
            forceManagedSections,
          });
          return;
        }

        const visibleHomePage = getVisibleHomePageEl();
        const visibleHomeSections = getVisibleHomeSectionsContainerEl(visibleHomePage);
        const homeReady = !!(visibleHomePage && visibleHomeSections && isHomeVisible());
        homeSectionLog("queueHomeSectionsBoot:attempt", {
          seq,
          attemptIndex,
          waitMs,
          eagerStudioHubs,
          requireSliderDisabled,
          forceManagedSections,
          visiblePageId: visibleHomePage?.id || null,
          hasVisibleHomeSections: !!visibleHomeSections,
          homeReady,
        });

        if (homeReady) {
          try {
            const cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
            bootHomeSections(cfg, { eagerStudioHubs, forceManagedSections });
          } catch (e) {
            console.warn("queueHomeSectionsBoot hata:", e);
          }
        } else {
          homeSectionWarn("queueHomeSectionsBoot:not-ready", {
            seq,
            attemptIndex,
            waitMs,
            eagerStudioHubs,
            requireSliderDisabled,
            forceManagedSections,
          });
        }

        if (attemptIndex >= Math.max(0, maxRetryCount | 0)) return;
        const nextDelay = HOME_SECTIONS_BOOT_RETRY_DELAYS_MS[
          Math.min(attemptIndex, HOME_SECTIONS_BOOT_RETRY_DELAYS_MS.length - 1)
        ] || 2000;
        scheduleAttempt(nextDelay, attemptIndex + 1);
      });
    }, Math.max(0, waitMs | 0));
  };

  scheduleAttempt(delayMs, 0);
}

function initializeSliderOnHome({ forceManagedSectionsBoot = false } = {}) {
  try { window.__jmsHomeTabPaused = false; } catch {}
  homeSectionLog("initializeSliderOnHome:start", {
    forceManagedSectionsBoot,
  });

  if (!isSliderEnabled()) {
    try { cleanupSlider(); } catch {}
    try { stopSlideTimer?.(); } catch {}
    try { clearCycleArm(); } catch {}
    homeSectionWarn("initializeSliderOnHome:slider-disabled", {
      forceManagedSectionsBoot,
    });

    queueHomeSectionsBoot({
      delayMs: 500,
      requireSliderDisabled: true,
      forceManagedSections: forceManagedSectionsBoot
    });
    scheduleManagedHomeSectionRecovery();

    return;
  }

  const hasContainer = !!document.querySelector('#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container');
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
        bootHomeSections(cfg);
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
    if (window.__jmsFirstSlideReady) {
      idle(() => onAllReady());
    } else {
      document.addEventListener("jms:first-slide-ready", () => {
        idle(() => onAllReady());
      }, { once: true });
    }
  }

  if (willEarlyReturn) {
    homeSectionLog("initializeSliderOnHome:early-return", {
      forceManagedSectionsBoot,
      hasContainer,
    });
    bootPersonalRecsWires();
    queueHomeSectionsBoot({
      delayMs: 600,
      forceManagedSections: true
    });
    scheduleManagedHomeSectionRecovery();
    return;
  }
  window.__initOnHomeOnce = true;
  const indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
  if (!indexPage) {
    homeSectionWarn("initializeSliderOnHome:no-visible-index-page", {
      forceManagedSectionsBoot,
    });
    return;
  }

  fullSliderReset();
  bootPersonalRecsWires();
  upsertSlidesContainerAtTop(indexPage);
  const sc = indexPage.querySelector('#monwui-slides-container');
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
  const pb = document.querySelector(".monwui-slide-progress-bar");
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

  queueHomeSectionsBoot({
    delayMs: 1800,
    forceManagedSections: forceManagedSectionsBoot
  });
  scheduleManagedHomeSectionRecovery();
  homeSectionLog("initializeSliderOnHome:booted", {
    forceManagedSectionsBoot,
    indexPageId: indexPage.id,
  });
}

function cleanupSlider({ preserveHomeSections = false, invalidateBoot = true } = {}) {
  homeSectionLog("cleanupSlider:start", {
    preserveHomeSections,
    invalidateBoot,
  });
  const shouldPreserveManagedHomeSectionBoot =
    preserveHomeSections && isHomeRouteActive();
  try { teardownAnimations(); } catch {}
  if (invalidateBoot) {
    invalidateSliderBootSession();
  }
  if (!shouldPreserveManagedHomeSectionBoot) {
    clearHomeSectionMountTimers();
    clearManagedHomeSectionRecoveryTimers();
    homeSectionMountSeq += 1;
    clearQueuedHomeSectionsBoot();
  } else {
    homeSectionLog("cleanupSlider:preserving-home-section-boot", {
      preserveHomeSections,
      invalidateBoot,
    });
  }
  if (!preserveHomeSections) {
    void cleanupRecentRowsLazy();
    void cleanupDirectorRowsLazy();
    void resetPersonalRecommendationsLazy();
    void cleanupStudioHubsLazy();
  }
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

  try { resetProgressBar?.(); } catch {}
  try {
    document
      .querySelectorAll(".monwui-dot-navigation-container, .monwui-slide-progress-seconds")
      .forEach((node) => node.remove());
  } catch {}

  const host =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");

  if (host) {
    const sliderContainer = host.querySelector("#monwui-slides-container");
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

function getAuthContextRecoveryKey(profile = {}) {
  const serverId = String(profile?.serverId || "").trim();
  const serverBase = String(profile?.serverBase || "").trim().replace(/\/+$/, "");
  const userId = String(profile?.userId || "").trim();
  return [serverId, serverBase, userId].join("|");
}

function bootHomeAfterAuthContextReset() {
  window.__initOnHomeOnce = false;
  initializeSliderOnHome({ forceManagedSectionsBoot: true });
}

function scheduleAuthContextRecovery(detail = {}) {
  if (!detail?.serverChanged && !detail?.userChanged) return;

  const nextKey =
    getAuthContextRecoveryKey(detail.next) ||
    getAuthContextRecoveryKey(detail.prev);

  if (nextKey && nextKey === __lastRecoveredAuthContextKey) return;
  if (nextKey) __lastRecoveredAuthContextKey = nextKey;

  if (__authContextRecoveryTimer) {
    clearTimeout(__authContextRecoveryTimer);
    __authContextRecoveryTimer = 0;
  }

  __authContextRecoveryTimer = window.setTimeout(async () => {
    __authContextRecoveryTimer = 0;
    console.log("[jms] Auth context degisti -> slider yeniden hazirlaniyor", detail);

    try { fullSliderReset({ preserveHomeSections: false }); } catch {}
    window.__initOnHomeOnce = false;

    if (!(isHomeVisible() || isHomeRouteActive())) return;

    const visible = await waitForVisibleIndexPage(12000);
    if (visible) {
      bootHomeAfterAuthContextReset();
      return;
    }

    const stop = observeWhenHomeReady(() => {
      bootHomeAfterAuthContextReset();
      stop();
    }, 20000);
  }, AUTH_CONTEXT_REBOOT_DEBOUNCE_MS);
}

function installAuthContextRecovery() {
  if (window.__jmsAuthContextRecoveryInstalled) return;
  window.__jmsAuthContextRecoveryInstalled = true;

  document.addEventListener(AUTH_PROFILE_CHANGED_EVENT, (event) => {
    scheduleAuthContextRecovery(event?.detail || {});
  }, true);
}

function observeWhenHomeReady(cb, maxMs = 20000) {
  const start = Date.now();
  const mo = new MutationObserver(() => {
    const ready =
      document.querySelector("#indexPage:not(.hide) .homeSectionsContainer") ||
      document.querySelector("#homePage:not(.hide) .homeSectionsContainer") ||
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (ready) {
      homeSectionLog("observeWhenHomeReady:ready", {
        maxMs,
        waitedMs: Date.now() - start,
      });
      cleanup();
      cb();
    } else if (Date.now() - start > maxMs) {
      homeSectionWarn("observeWhenHomeReady:timeout", {
        maxMs,
        waitedMs: Date.now() - start,
      });
      cleanup();
    }
  });
  mo.observe(getDomObserveRoot(), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const to = setTimeout(() => {
    homeSectionWarn("observeWhenHomeReady:hard-timeout", {
      maxMs,
      waitedMs: Date.now() - start,
    });
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
    const INDEXER_INTERVAL_MS = 2 * 60 * 60 * 1000;

    function isIndexerAutoStartEnabled() {
      try {
        const cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
        return cfg.enableCollectionIndexerAutoStart !== false;
      } catch {
        return true;
      }
    }

    function getIndexerAutoStartDelayMs() {
      try {
        const cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
        const raw = Number(cfg.collectionIndexerAutoStartDelayMs);
        if (Number.isFinite(raw) && raw > 0) {
          return Math.max(60_000, Math.min(90_000, raw | 0));
        }
      } catch {}
      return 75_000;
    }

    function clearIndexerAutoStartTimer() {
      if (!window.__jmsIndexerAutoStartTimer) return;
      clearTimeout(window.__jmsIndexerAutoStartTimer);
      window.__jmsIndexerAutoStartTimer = null;
    }

    function requestIndexerAutoStart(reason = "boot-idle") {
      if (!isIndexerAutoStartEnabled()) return false;
      if (!window.__jmsIndexerAutoStartReady) return false;
      if (document.hidden) return false;
      if (window.__jmsIndexerAutoStartPending) return true;

      window.__jmsIndexerAutoStartPending = true;
      idle(() => {
        Promise.resolve(
          runIndexerIfDue({ intervalMs: INDEXER_INTERVAL_MS, reason })
        ).catch(() => {}).finally(() => {
          window.__jmsIndexerAutoStartPending = false;
        });
      });
      return true;
    }

    function armIndexerAutoStart(reason = "boot-idle") {
      if (!isIndexerAutoStartEnabled()) return false;
      if (window.__jmsIndexerAutoStartReady) {
        return requestIndexerAutoStart(reason);
      }
      if (window.__jmsIndexerAutoStartTimer) return true;

      window.__jmsIndexerAutoStartTimer = setTimeout(() => {
        window.__jmsIndexerAutoStartTimer = null;
        window.__jmsIndexerAutoStartReady = true;
        requestIndexerAutoStart(reason);
      }, getIndexerAutoStartDelayMs());
      return true;
    }

    async function bootIndexerOnce() {
      if (window.__JMS_INDEXER_BOOTED__) return;
      window.__JMS_INDEXER_BOOTED__ = true;

      try { await waitAuthWarmupFallback(5000); } catch {}

      try {
        await new Promise(r => setTimeout(r, 2000));

        const ret = await startBackgroundCollectionIndexer({
          mode: "boxsetFirst",
          aggressive: true,
          boxsetThrottleMs: 120,
        });
        window.__JMS_INDEXER_STARTED__ = !!ret?.started;
        if (ret?.started) {
          clearIndexerAutoStartTimer();
          window.__jmsIndexerAutoStartReady = true;
          markIndexerRunNow();
        }
      } catch (e) {
        console.error("[JMS][INDEXER] crashed ❌", e);
        window.__JMS_INDEXER_STARTED__ = false;
      }
    }

    function getIndexerGateKey() {
      try {
        const s = getSessionInfo?.() || {};
        const uid = s?.userId || "anon";
        return `jms_indexer_lastRun_v1::${uid}`;
      } catch {
        return `jms_indexer_lastRun_v1::anon`;
      }
    }

    function shouldRunIndexerNow(intervalMs) {
      const key = getIndexerGateKey();
      const now = Date.now();
      const last = parseInt(localStorage.getItem(key) || "0", 10);
      return !Number.isFinite(last) || last <= 0 || (now - last) >= intervalMs;
    }

    async function getIndexerGateDecision(intervalMs) {
      const status = await getBackgroundCollectionIndexerStatus?.().catch(() => null);
      if (status?.dbLikelyEmpty || !status?.doneAt) {
        return {
          shouldRun: true,
          resumePending: true,
          status,
        };
      }

      if (status?.resumePending) {
        return {
          shouldRun: true,
          resumePending: true,
          status,
        };
      }

      return {
        shouldRun: shouldRunIndexerNow(intervalMs),
        resumePending: false,
        status,
      };
    }

    function markIndexerRunNow() {
      const key = getIndexerGateKey();
      try { localStorage.setItem(key, String(Date.now())); } catch {}
    }

    function scheduleIndexerRetry(delayMs = 2000, reason = "retry") {
      if (!isIndexerAutoStartEnabled()) return;
      if (window.__jmsIndexerRetryTimer) return;
      window.__jmsIndexerRetryTimer = setTimeout(() => {
        window.__jmsIndexerRetryTimer = null;
        if (window.__jmsIndexerRetryInFlight) return;
        window.__jmsIndexerRetryInFlight = true;
        runIndexerIfDue({ intervalMs: 2 * 60 * 60 * 1000, reason }).finally(() => {
          window.__jmsIndexerRetryInFlight = false;
        });
      }, Math.max(1000, delayMs | 0));
    }

    async function runIndexerIfDue({ intervalMs = 2 * 60 * 60 * 1000, reason = "scheduled" } = {}) {
      try {
        if (!isIndexerAutoStartEnabled()) {
          return false;
        }
        const gate = await getIndexerGateDecision(intervalMs);
        if (!gate.shouldRun) {
          return false;
        }

        try { await waitAuthWarmupFallback(5000); } catch {}
        await new Promise(r => setTimeout(r, 1500));

        try {
          const ret = await startBackgroundCollectionIndexer({
            mode: "boxsetFirst",
            aggressive: true,
            boxsetThrottleMs: 120,
          });
          window.__JMS_INDEXER_STARTED__ = !!ret?.started;
          if (ret?.started) {
            clearIndexerAutoStartTimer();
            window.__jmsIndexerAutoStartReady = true;
            if (window.__jmsIndexerRetryTimer) {
              clearTimeout(window.__jmsIndexerRetryTimer);
              window.__jmsIndexerRetryTimer = null;
            }
            markIndexerRunNow();
            return true;
          }
          if (ret?.reason !== "already-running") {
            scheduleIndexerRetry(
              gate.resumePending ? 2000 : 3000,
              gate.resumePending ? "resume-retry" : "start-retry"
            );
          }
          return false;
        } catch (e) {
          console.error("[JMS][INDEXER] crashed ❌", e);
          window.__JMS_INDEXER_STARTED__ = false;
          scheduleIndexerRetry(
            gate.resumePending ? 3000 : 4000,
            gate.resumePending ? "resume-crash-retry" : "crash-retry"
          );
          return false;
        }
      } catch (e) {
        console.warn("[JMS][INDEXER] runIndexerIfDue error:", e);
        scheduleIndexerRetry(3000, "runIndexerIfDue-error");
        return false;
      }
    }

    try { window.__jmsBootIndexer = bootIndexerOnce; } catch {}

    (function scheduleIndexerStart() {
      armIndexerAutoStart("boot-idle");

      const onReady = () => {
        requestIndexerAutoStart("all-slides-ready");
      };

      document.addEventListener("jms:all-slides-ready", onReady, { once: true });

      setTimeout(() => {
        requestIndexerAutoStart("fallback-timeout");
      }, 10_000);

      setInterval(() => {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("interval-arm");
          return;
        }
        requestIndexerAutoStart("interval-tick");
      }, 5 * 60 * 1000);
    })();

    if (!window.__jmsIndexerResumeHooksBound) {
      window.__jmsIndexerResumeHooksBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("visible-arm");
          return;
        }
        scheduleIndexerRetry(1200, "visible-retry");
      }, { passive: true });
      window.addEventListener("focus", () => {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("focus-arm");
          return;
        }
        scheduleIndexerRetry(1200, "focus-retry");
      }, { passive: true });
      window.addEventListener("pageshow", () => {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("pageshow-arm");
          return;
        }
        scheduleIndexerRetry(1200, "pageshow-retry");
      }, { passive: true });
    }

    const fastIndex = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
    if (fastIndex) {
      startPauseOverlayOnce();
      initializeSliderOnHome({ forceManagedSectionsBoot: true });
    } else {
      const stop = observeWhenHomeReady(() => {
        startPauseOverlayOnce();
        initializeSliderOnHome({ forceManagedSectionsBoot: true });
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
      runNonCriticalUiBootOnce();
    });

    setupNavigationObserver();
    installAuthContextRecovery();
    installHomeTabSliderOnlyGate();
    idle(() => {
      if (shouldRenderStudioHubsUi(getMainConfig())) {
        void ensureStudioHubsMountedLazy();
      }
    });
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
    try {
      if (getConfig()?.peakSlider) scheduleVisibleSliderRepair({ forcePrime: false });
    } catch {}
  }, 150)
);
window.addEventListener("pageshow", () => {
  scheduleVisibleSliderRestoreRepair({ forcePrime: true });
});

if (!window.__sliderRestoreRepairBound) {
  window.__sliderRestoreRepairBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    scheduleVisibleSliderRestoreRepair({ forcePrime: true });
  }, { passive: true });
  window.addEventListener("focus", () => {
    scheduleVisibleSliderRestoreRepair({ forcePrime: true });
  }, { passive: true });
}

window.addEventListener("unhandledrejection", (event) => {
  if (event?.reason?.message && event.reason.message.includes("quality badge")) {
    console.warn("Kalite badge hatası:", event.reason);
    event.preventDefault();
  }
});

window.slidesInit = slidesInit;

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
  const CARD_OVERLAY_FIX_TRIGGER_SELECTOR_TEXT = [
    '.cardOverlayContainer',
    '.genre-row',
    '.personal-recs-row',
    '#genre-hubs',
    '#personal-recommendations',
    '.genre-hub-section',
    '.personal-recs-section'
  ].join(',');

  const injectedRoots = new WeakSet();
  const lockedRows = new WeakSet();

  function lockLayoutInlineImportant() {
    try {
      const sels = [
        "#genre-hubs .genre-row",
        "#personal-recommendations .personal-recs-row",
        ".genre-hub-section .genre-row",
        ".itemsContainer.personal-recs-row",
        ".personal-recs-section .personal-recs-row",
      ];
      const nodes = document.querySelectorAll(sels.join(","));
      nodes.forEach((el) => {
        if (lockedRows.has(el)) return;
        el.style.setProperty("display", "grid", "important");
        el.style.setProperty("overflow-x", "auto", "important");
        el.style.setProperty("overflow-y", "hidden", "important");
        lockedRows.add(el);
      });
    } catch {}
  }

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
      const host =
        (root instanceof ShadowRoot)
          ? root
          : (doc.head || doc.documentElement);
      const existing = host.querySelector?.(`style[data-jms="${KEY}"]`);
      if (existing) return;

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
  lockLayoutInlineImportant();

  let __rafLock = 0;
  const runPatchPass = () => {
    __rafLock = 0;
    scanAndInject();
    lockLayoutInlineImportant();
  };
  const mo = new MutationObserver((mutations) => {
    if (!mutationsTouchSelectors(mutations, CARD_OVERLAY_FIX_TRIGGER_SELECTOR_TEXT)) return;
    if (__rafLock) return;
    __rafLock = requestAnimationFrame(runPatchPass);
  });
  mo.observe(getDomObserveRoot(), { childList: true, subtree: true });
})();
