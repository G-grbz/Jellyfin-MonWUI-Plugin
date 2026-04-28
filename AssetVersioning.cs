using System;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.JMSFusion
{
    internal static class AssetVersioning
    {
        private const string CacheControlValue = "public, max-age=0, must-revalidate";
        private static readonly string s_assetVersion = BuildAssetVersion();

        public static string AssetVersion => s_assetVersion;

        public static string AppendVersionQuery(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return path ?? string.Empty;
            }

            if (path.IndexOf("v=", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return path;
            }

            var separator = path.Contains('?', StringComparison.Ordinal) ? '&' : '?';
            return $"{path}{separator}v={Uri.EscapeDataString(AssetVersion)}";
        }

        public static string BuildBootstrapScript()
        {
            var version = AssetVersion;
            return $$"""
<script>
(function () {
  var root = document.documentElement;
  window.__JMS_ASSET_VERSION__ = "{{version}}";
  if (root) {
    root.setAttribute("data-jms-asset-version", "{{version}}");
  }

  var STORAGE_KEY = "enableCustomSplashScreen";
  var STYLE_ID = "jms-boot-splash-style";
  var LAYER_ID = "jms-boot-splash-layer";
  var SHELL_ID = "jms-boot-splash-shell";
  var LOGO_ID = "jms-boot-splash-logo";
  var TITLE_ID = "jms-boot-splash-title";
  var CAPTION_ID = "jms-boot-splash-caption-line";
  var PROGRESS_PANEL_ID = "jms-boot-splash-progress";
  var PROGRESS_ECHO_ID = "jms-boot-splash-progress-echo";
  var PROGRESS_FILL_ID = "jms-boot-splash-progress-fill";
  var PROGRESS_ORB_ID = "jms-boot-splash-progress-orb";
  var PROGRESS_VALUE_ID = "jms-boot-splash-progress-value";
  var PROGRESS_STAGE_ID = "jms-boot-splash-progress-stage";
  var PROGRESS_DETAIL_ID = "jms-boot-splash-progress-detail";
  var ACTIVE_ATTR = "data-jms-custom-splash";
  var HIDDEN_ATTR = "data-jms-custom-splash-hidden";
  var TITLE_ATTR = "data-jms-custom-splash-title";
  var CAPTION_ATTR = "data-jms-custom-splash-caption";
  var REASON_ATTR = "data-jms-custom-splash-reason";
  var PROGRESS_API_KEY = "__JMS_CUSTOM_SPLASH_PROGRESS__";
  var FALLBACK_TIMEOUT_MS = 16000;
  var FALLBACK_CLEANUP_MS = 460;
  var PING_PATHS = ["/JMSFusion/ping", "/Plugins/JMSFusion/ping"];

  function toCssContent(value) {
    return '"' + String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"') + '"';
  }

  function readEnabled() {
    try {
      var raw = window.localStorage ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw === "false") return false;
      if (raw === "true") return true;
    } catch {}
    return true;
  }

  function isHomeRouteHashValue(value) {
    var hash = String(value || "").toLowerCase().trim();
    return hash === "" || hash === "#" || hash.indexOf("#/home") === 0 || hash.indexOf("#/index") === 0;
  }

  function getVisibleSplashPage() {
    return document.querySelector(
      "#reactRoot [data-role='page']:not(.hide), [data-role='page']:not(.hide), #reactRoot #indexPage:not(.hide), #reactRoot #homePage:not(.hide), #indexPage:not(.hide), #homePage:not(.hide)"
    );
  }

  function isHomeSplashPage(page) {
    if (!page) return false;

    var pageId = String(page.id || "").toLowerCase();
    if (pageId === "indexpage" || pageId === "homepage") {
      return true;
    }

    var routeHint = String(
      (page.getAttribute && (page.getAttribute("data-url") || page.getAttribute("data-page"))) ||
      (page.dataset && page.dataset.url) ||
      ""
    ).toLowerCase();

    return /(?:^|\/)(?:index|home)(?:\.html)?(?:[?#/]|$)/i.test(routeHint);
  }

  function isHomeSplashContext() {
    var visiblePage = getVisibleSplashPage();
    if (visiblePage) {
      return isHomeSplashPage(visiblePage);
    }

    return isHomeRouteHashValue(window.location && window.location.hash);
  }

  function buildPingProbeUrl(path) {
    var raw = String(path || "").trim();
    if (!raw) return "";

    var suffix = "_ts=" + Date.now();
    var version = String(window.__JMS_ASSET_VERSION__ || "").trim();
    if (version) {
      suffix += "&v=" + encodeURIComponent(version);
    }

    return raw + (raw.indexOf("?") >= 0 ? "&" : "?") + suffix;
  }

  function canReachPluginPresenceSync() {
    // Fail closed when cached bootstrap code survives after the plugin is gone.
    for (var i = 0; i < PING_PATHS.length; i += 1) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", buildPingProbeUrl(PING_PATHS[i]), false);
        xhr.setRequestHeader("Cache-Control", "no-store, no-cache, max-age=0");
        xhr.setRequestHeader("Pragma", "no-cache");
        xhr.send(null);
        var status = Number(xhr.status || 0);
        if ((status >= 200 && status < 300) || status === 401 || status === 403) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  if (!root || !readEnabled() || !isHomeSplashContext() || !canReachPluginPresenceSync()) {
    return;
  }

  function detectBrowserLangKey() {
    var candidates = [];
    try {
      if (Array.isArray(window.navigator && window.navigator.languages) && window.navigator.languages.length) {
        candidates = window.navigator.languages.slice();
      } else {
        candidates = [
          (window.navigator && (window.navigator.language || window.navigator.userLanguage)) ||
          root.getAttribute("lang") ||
          ""
        ];
      }
    } catch {
      candidates = [root.getAttribute("lang") || ""];
    }

    for (var i = 0; i < candidates.length; i += 1) {
      var value = String(candidates[i] || "").toLowerCase();
      var base = value.split(/[-_]/)[0];
      if (value === "tur" || base === "tr") return "tur";
      if (value === "eng" || base === "en") return "eng";
      if (value === "deu" || base === "de") return "deu";
      if (value === "fre" || value === "fra" || base === "fr") return "fre";
      if (value === "spa" || base === "es") return "spa";
      if (value === "rus" || base === "ru") return "rus";
    }

    return "tur";
  }

  var lang = "";
  try {
    lang = String(
      (window.localStorage && localStorage.getItem("defaultLanguage")) ||
      root.getAttribute("lang") ||
      detectBrowserLangKey()
    ).toLowerCase();
  } catch {
    lang = detectBrowserLangKey();
  }

  function resolveLangKey(raw) {
    var value = String(raw || "").toLowerCase();
    if (!value || value === "auto") return detectBrowserLangKey();
    if (value === "tur" || value === "eng" || value === "deu" || value === "fre" || value === "spa" || value === "rus") {
      return value;
    }
    if (value === "fra") return "fre";
    var base = value.split(/[-_]/)[0];
    if (base === "tr") return "tur";
    if (base === "en") return "eng";
    if (base === "de") return "deu";
    if (base === "fr") return "fre";
    if (base === "es") return "spa";
    if (base === "ru") return "rus";
    return detectBrowserLangKey();
  }

  var captions = {
    tur: "MonWui hazırlanıyor",
    eng: "MonWui is starting",
    deu: "MonWui wird vorbereitet",
    fre: "MonWui se prépare",
    spa: "MonWui se está preparando",
    rus: "MonWui подготавливается"
  };

  var splashLocale = {
    tur: {
      stageLock: "KİLİT",
      detailLock: "Kabuk katmanı sabitleniyor",
      stageStructure: "OMURGA",
      detailStructure: "Arayüz omurgası senkrona giriyor",
      stageTakeover: "DEVRALMA",
      detailTakeover: "{title} motoru kontrolü alıyor",
      stageFlow: "AKIŞ",
      detailFlow: "Gerçek zamanlı yükleme metrikleri eşleniyor",
      stageFallback: "GEÇİŞ",
      detailFallback: "Varsayılan Jellyfin arayüzü açılıyor",
      stageReady: "HAZIR",
      detailReady: "{title} çevrimiçi"
    },
    eng: {
      stageLock: "LOCK",
      detailLock: "Shell layer is locking in",
      stageStructure: "CORE",
      detailStructure: "Interface core is entering sync",
      stageTakeover: "TAKEOVER",
      detailTakeover: "{title} engine is taking control",
      stageFlow: "FLOW",
      detailFlow: "Real-time loading metrics are syncing",
      stageFallback: "FALLBACK",
      detailFallback: "Falling back to the Jellyfin interface",
      stageReady: "READY",
      detailReady: "{title} online"
    },
    deu: {
      stageLock: "SPERRE",
      detailLock: "Die Shell-Schicht verriegelt sich",
      stageStructure: "KERN",
      detailStructure: "Der UI-Kern geht in den Sync",
      stageTakeover: "UEBERNAHME",
      detailTakeover: "{title} uebernimmt die Kontrolle",
      stageFlow: "FLUSS",
      detailFlow: "Echtzeit-Lademetriken werden abgeglichen",
      stageFallback: "RUECKFALL",
      detailFallback: "Wechsel zur Jellyfin-Oberflaeche",
      stageReady: "BEREIT",
      detailReady: "{title} ist online"
    },
    fre: {
      stageLock: "VERROU",
      detailLock: "La couche shell se verrouille",
      stageStructure: "NOYAU",
      detailStructure: "Le noyau de l'interface entre en synchro",
      stageTakeover: "PRISE",
      detailTakeover: "Le moteur {title} prend le controle",
      stageFlow: "FLUX",
      detailFlow: "Les metriques de chargement en temps reel se synchronisent",
      stageFallback: "REPLI",
      detailFallback: "Retour a l'interface Jellyfin",
      stageReady: "PRET",
      detailReady: "{title} est en ligne"
    },
    spa: {
      stageLock: "BLOQUEO",
      detailLock: "La capa shell se esta fijando",
      stageStructure: "NUCLEO",
      detailStructure: "El nucleo de la interfaz entra en sincronizacion",
      stageTakeover: "CONTROL",
      detailTakeover: "El motor de {title} toma el control",
      stageFlow: "FLUJO",
      detailFlow: "Las metricas de carga en tiempo real se estan sincronizando",
      stageFallback: "RESPALDO",
      detailFallback: "Volviendo a la interfaz de Jellyfin",
      stageReady: "LISTO",
      detailReady: "{title} en linea"
    },
    rus: {
      stageLock: "БЛОК",
      detailLock: "Оболочка фиксируется",
      stageStructure: "ЯДРО",
      detailStructure: "Ядро интерфейса входит в синхронизацию",
      stageTakeover: "ЗАХВАТ",
      detailTakeover: "Движок {title} берёт управление",
      stageFlow: "ПОТОК",
      detailFlow: "Метрики загрузки в реальном времени синхронизируются",
      stageFallback: "РЕЗЕРВ",
      detailFallback: "Переход к интерфейсу Jellyfin",
      stageReady: "ГОТОВО",
      detailReady: "{title} в сети"
    }
  };

  var greetingLocale = {
    tur: {
      morning: "Günaydın",
      afternoon: "Tünaydın",
      evening: "İyi akşamlar",
      night: "İyi geceler"
    },
    eng: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
      night: "Hello"
    },
    deu: {
      morning: "Guten Morgen",
      afternoon: "Guten Tag",
      evening: "Guten Abend",
      night: "Hallo"
    },
    fre: {
      morning: "Bonjour",
      afternoon: "Bon après-midi",
      evening: "Bonsoir",
      night: "Bonsoir"
    },
    spa: {
      morning: "Buenos días",
      afternoon: "Buenas tardes",
      evening: "Buenas noches",
      night: "Buenas noches"
    },
    rus: {
      morning: "Доброе утро",
      afternoon: "Добрый день",
      evening: "Добрый вечер",
      night: "Здравствуйте"
    }
  };

  function formatLocaleTemplate(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, function (_, key) {
      return String(values && values[key] != null ? values[key] : "");
    });
  }

  function getSplashHourNow() {
    try {
      var now = new Date();
      var hour = Number(now && now.getHours ? now.getHours() : NaN);
      if (isFinite(hour) && hour >= 0 && hour <= 23) return hour;
    } catch {}
    return 9;
  }

  function resolveGreetingPartByHour(hour) {
    var safeHour = Number(hour);
    if (!isFinite(safeHour)) return "morning";
    if (safeHour >= 5 && safeHour < 12) return "morning";
    if (safeHour >= 12 && safeHour < 18) return "afternoon";
    if (safeHour >= 18 && safeHour < 22) return "evening";
    return "night";
  }

  function text(value, fallback) {
    var output = String(value == null ? "" : value).trim();
    if (output) return output;
    return String(fallback == null ? "" : fallback).trim();
  }

  function buildSplashDisplayTitle(userName) {
    var safeUserName = text(userName);
    if (!safeUserName) return customTitle;

    var greetingPack = greetingLocale[resolvedLang] || greetingLocale.eng || greetingLocale.tur;
    var greetingPart = resolveGreetingPartByHour(getSplashHourNow());
    var greetingText = text(greetingPack && greetingPack[greetingPart]);
    return text(greetingText ? greetingText + " " + safeUserName : safeUserName, customTitle);
  }

  function getSplashApiClient() {
    return (
      window.ApiClient ||
      window.apiClient ||
      (window.MediaBrowser && window.MediaBrowser.ApiClient) ||
      null
    );
  }

  function getCurrentSplashUserIdSync() {
    try {
      var api = getSplashApiClient();
      var apiUser = api && api._currentUser ? api._currentUser : null;
      var serverInfo = api && api._serverInfo ? api._serverInfo : null;
      var serverUser = serverInfo && serverInfo.User ? serverInfo.User : null;

      if (api && typeof api.getCurrentUserId === "function") {
        var liveUserId = text(api.getCurrentUserId());
        if (liveUserId) return liveUserId;
      }

      return text(
        (api && api._currentUserId) ||
        (apiUser && apiUser.Id) ||
        (serverUser && serverUser.Id) ||
        (serverInfo && (serverInfo.UserId || serverInfo.userId)) ||
        (window.sessionStorage ? sessionStorage.getItem("currentUserId") : "")
      );
    } catch {
      return "";
    }
  }

  function persistCurrentSplashUserName(value) {
    var nextValue = text(value);
    if (!nextValue) return "";
    try {
      if (window.sessionStorage) {
        var currentUserId = getCurrentSplashUserIdSync();
        if (currentUserId) {
          sessionStorage.setItem("currentUserId", currentUserId);
        }
        sessionStorage.setItem("currentUserName", nextValue);
      }
    } catch {}
    return nextValue;
  }

  function getCurrentSplashUserNameSync() {
    try {
      var api = getSplashApiClient();
      var apiUser = api && api._currentUser ? api._currentUser : null;
      var serverInfo = api && api._serverInfo ? api._serverInfo : null;
      var serverUser = serverInfo && serverInfo.User ? serverInfo.User : null;
      var currentUserId = getCurrentSplashUserIdSync();
      var storedUserId = window.sessionStorage ? sessionStorage.getItem("currentUserId") : "";
      var storedUserName = window.sessionStorage ? sessionStorage.getItem("currentUserName") : "";
      var canUseStoredUser = !currentUserId || !storedUserId || currentUserId === storedUserId;

      return text(
        (apiUser && (apiUser.Name || apiUser.Username || apiUser.userName || apiUser.username)) ||
        (serverUser && (serverUser.Name || serverUser.Username || serverUser.userName || serverUser.username)) ||
        (serverInfo && (serverInfo.UserName || serverInfo.Username || serverInfo.userName || serverInfo.username)) ||
        (canUseStoredUser ? storedUserName : "")
      );
    } catch {
      return "";
    }
  }

  var defaultTitle = "MonWui";
  var customTitle = defaultTitle;
  try {
    var rawCustomTitle = window.localStorage ? localStorage.getItem("customSplashTitle") : null;
    if (typeof rawCustomTitle === "string" && rawCustomTitle.trim()) {
      customTitle = rawCustomTitle.trim();
    }
  } catch {}

  var resolvedLang = resolveLangKey(lang);
  var localeCopy = splashLocale[resolvedLang] || splashLocale.eng;
  var captionTemplate = captions[resolvedLang] || captions.eng || "MonWui is starting";
  var caption = captionTemplate.indexOf(defaultTitle) !== -1
    ? captionTemplate.replace(defaultTitle, customTitle)
    : captionTemplate;
  var splashUserName = persistCurrentSplashUserName(getCurrentSplashUserNameSync());
  var displayTitle = buildSplashDisplayTitle(splashUserName);

  root.setAttribute(ACTIVE_ATTR, "1");
  root.setAttribute(TITLE_ATTR, displayTitle);
  root.setAttribute(CAPTION_ATTR, caption);
  root.style.setProperty("--jms-custom-splash-title", toCssContent(displayTitle));
  root.style.setProperty("--jms-custom-splash-caption", toCssContent(caption));

  function ensureMountNode() {
    return document.body || root;
  }

  function ensureSplashLayer(title, captionText, logoLabel) {
    if (!root || !root.hasAttribute(ACTIVE_ATTR)) {
      return document.getElementById(LAYER_ID);
    }

    var layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = LAYER_ID;
      layer.setAttribute("aria-hidden", "true");

      var shell = document.createElement("div");
      shell.id = SHELL_ID;

      var logo = document.createElement("div");
      logo.id = LOGO_ID;
      logo.className = "splashLogo";
      logo.setAttribute("role", "img");

      var copyWrap = document.createElement("div");
      copyWrap.className = "jms-boot-splash-copy";

      var titleEl = document.createElement("div");
      titleEl.id = TITLE_ID;

      var captionEl = document.createElement("div");
      captionEl.id = CAPTION_ID;

      copyWrap.appendChild(titleEl);
      copyWrap.appendChild(captionEl);

      var progressPanel = document.createElement("div");
      progressPanel.id = PROGRESS_PANEL_ID;

      var head = document.createElement("div");
      head.className = "jms-boot-splash-progress-head";

      var stageEl = document.createElement("div");
      stageEl.id = PROGRESS_STAGE_ID;

      var valueEl = document.createElement("div");
      valueEl.id = PROGRESS_VALUE_ID;

      head.appendChild(stageEl);
      head.appendChild(valueEl);

      var track = document.createElement("div");
      track.className = "jms-boot-splash-track";

      var echo = document.createElement("div");
      echo.id = PROGRESS_ECHO_ID;

      var fill = document.createElement("div");
      fill.id = PROGRESS_FILL_ID;

      var orb = document.createElement("div");
      orb.id = PROGRESS_ORB_ID;

      track.appendChild(echo);
      track.appendChild(fill);
      track.appendChild(orb);

      var detailEl = document.createElement("div");
      detailEl.id = PROGRESS_DETAIL_ID;

      progressPanel.appendChild(head);
      progressPanel.appendChild(track);
      progressPanel.appendChild(detailEl);

      shell.appendChild(logo);
      shell.appendChild(copyWrap);
      shell.appendChild(progressPanel);
      layer.appendChild(shell);
    }

    var mountNode = ensureMountNode();
    if (layer.parentNode !== mountNode) {
      mountNode.appendChild(layer);
    }

    var logoEl = layer.querySelector("#" + LOGO_ID);
    if (logoEl) {
      var resolvedLogoLabel = text(logoLabel, title);
      logoEl.setAttribute("aria-label", resolvedLogoLabel);
      logoEl.setAttribute("title", resolvedLogoLabel);
    }

    var titleNode = layer.querySelector("#" + TITLE_ID);
    if (titleNode) titleNode.textContent = title;

    var captionNode = layer.querySelector("#" + CAPTION_ID);
    if (captionNode) captionNode.textContent = captionText;

    return layer;
  }

  function syncDisplayedTitle(nextTitle, options) {
    options = options || {};
    displayTitle = options.raw
      ? text(nextTitle, buildSplashDisplayTitle(splashUserName))
      : buildSplashDisplayTitle(nextTitle);
    root.setAttribute(TITLE_ATTR, displayTitle);
    root.style.setProperty("--jms-custom-splash-title", toCssContent(displayTitle));
    ensureSplashLayer(displayTitle, caption, customTitle);
  }

  function updateTitleFromCurrentUser(nextUserTitle) {
    var resolvedUserTitle = persistCurrentSplashUserName(nextUserTitle);
    if (!resolvedUserTitle) return false;
    splashUserName = resolvedUserTitle;
    syncDisplayedTitle(resolvedUserTitle);
    renderProgress();
    return true;
  }

  function resolveCurrentUserTitleAsync() {
    if (updateTitleFromCurrentUser(getCurrentSplashUserNameSync())) {
      return;
    }

    var api = getSplashApiClient();
    if (!api || typeof api.getCurrentUser !== "function") {
      return;
    }

    try {
      Promise.resolve(api.getCurrentUser())
        .then(function (user) {
          var resolvedUserTitle = text(
            user && (user.Name || user.Username || user.userName || user.username)
          );
          updateTitleFromCurrentUser(resolvedUserTitle);
        })
        .catch(function () {});
    } catch {}
  }

  function scheduleSplashUserTitleRefresh() {
    var delays = [0, 180, 720, 1600];
    for (var i = 0; i < delays.length; i += 1) {
      (function (delay) {
        window.setTimeout(function () {
          resolveCurrentUserTitleAsync();
        }, delay);
      })(delays[i]);
    }
  }

  function clamp01(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  var layer = ensureSplashLayer(displayTitle, caption, customTitle);

  var progressState = {
    current: 0.04,
    target: 0.04,
    stage: localeCopy.stageLock,
    detail: formatLocaleTemplate(localeCopy.detailLock, { title: customTitle }),
    raf: 0
  };
  var fallbackTimeoutId = 0;
  var fallbackCleanupId = 0;

  function cancelProgressRaf() {
    if (!progressState.raf) return;
    try { cancelAnimationFrame(progressState.raf); } catch {}
    progressState.raf = 0;
  }

  function clearFallbackTimeout() {
    if (!fallbackTimeoutId) return;
    try { clearTimeout(fallbackTimeoutId); } catch {}
    fallbackTimeoutId = 0;
  }

  function clearFallbackCleanup() {
    if (!fallbackCleanupId) return;
    try { clearTimeout(fallbackCleanupId); } catch {}
    fallbackCleanupId = 0;
  }

  function cleanupSplashFallback() {
    clearFallbackCleanup();
    if (!root) return false;

    try { root.removeAttribute(REASON_ATTR); } catch {}
    root.removeAttribute(ACTIVE_ATTR);
    root.removeAttribute(HIDDEN_ATTR);
    root.removeAttribute(TITLE_ATTR);
    root.removeAttribute(CAPTION_ATTR);
    root.style.removeProperty("--jms-custom-splash-title");
    root.style.removeProperty("--jms-custom-splash-caption");

    var activeLayer = document.getElementById(LAYER_ID);
    if (activeLayer && activeLayer.parentNode) {
      activeLayer.parentNode.removeChild(activeLayer);
    }

    return true;
  }

  function renderProgress() {
    if (!root || !root.hasAttribute(ACTIVE_ATTR)) return;

    var activeLayer = ensureSplashLayer(displayTitle, caption, customTitle);
    if (!activeLayer) return;

    var pct = Math.round(clamp01(progressState.current) * 100);
    activeLayer.style.setProperty("--jms-splash-progress", clamp01(progressState.current).toFixed(4));

    var valueEl = activeLayer.querySelector("#" + PROGRESS_VALUE_ID);
    if (valueEl) {
      valueEl.textContent = String(pct).padStart(2, "0") + "%";
    }

    var stageEl = activeLayer.querySelector("#" + PROGRESS_STAGE_ID);
    if (stageEl) {
      stageEl.textContent = progressState.stage || localeCopy.stageLock;
    }

    var detailEl = activeLayer.querySelector("#" + PROGRESS_DETAIL_ID);
    if (detailEl) {
      detailEl.textContent = progressState.detail || caption;
    }
  }

  function animateProgress() {
    var diff = progressState.target - progressState.current;
    if (Math.abs(diff) < 0.0015) {
      progressState.current = progressState.target;
      progressState.raf = 0;
      renderProgress();
      return;
    }

    progressState.current += diff * (diff > 0 ? 0.18 : 0.24);
    renderProgress();
    progressState.raf = requestAnimationFrame(animateProgress);
  }

  function setProgress(value, options) {
    options = options || {};
    var next = clamp01(value);

    if (options.forceValue) {
      progressState.target = next;
    } else {
      progressState.target = Math.max(progressState.target, next);
    }

    if (typeof options.stage === "string" && options.stage.trim()) {
      progressState.stage = options.stage.trim();
    }

    if (typeof options.detail === "string" && options.detail.trim()) {
      progressState.detail = options.detail.trim();
    }

    if (options.instant) {
      cancelProgressRaf();
      progressState.current = progressState.target;
      renderProgress();
      return progressState.target;
    }

    renderProgress();
    if (!progressState.raf) {
      progressState.raf = requestAnimationFrame(animateProgress);
    }
    return progressState.target;
  }

  function dismissSplashFallback(reason, options) {
    options = options || {};
    if (!root || !root.hasAttribute(ACTIVE_ATTR)) return false;
    if (root.getAttribute(HIDDEN_ATTR) === "1") return true;

    clearFallbackTimeout();
    clearFallbackCleanup();

    if (options.updateProgress !== false) {
      setProgress(1, {
        stage: options.stage || localeCopy.stageFallback || localeCopy.stageReady,
        detail: options.detail || formatLocaleTemplate(localeCopy.detailFallback || localeCopy.detailReady, { title: customTitle }),
        forceValue: true,
        instant: !!options.instant
      });
    }

    try {
      root.setAttribute(REASON_ATTR, text(reason, "bootstrap-timeout"));
    } catch {}
    root.setAttribute(HIDDEN_ATTR, "1");

    var cleanupDelayMs = options.cleanupDelayMs == null
      ? FALLBACK_CLEANUP_MS
      : Number(options.cleanupDelayMs);

    fallbackCleanupId = window.setTimeout(function () {
      fallbackCleanupId = 0;
      cleanupSplashFallback();
    }, Math.max(0, isFinite(cleanupDelayMs) ? cleanupDelayMs : FALLBACK_CLEANUP_MS));

    return true;
  }

  function enforceSplashHomeOnly() {
    if (!root || !root.hasAttribute(ACTIVE_ATTR)) return false;
    if (isHomeSplashContext()) return true;
    return dismissSplashFallback("bootstrap-route-not-home", {
      updateProgress: false,
      instant: true,
      cleanupDelayMs: 0
    });
  }

  function armSplashFallbackTimeout() {
    clearFallbackTimeout();
    fallbackTimeoutId = window.setTimeout(function () {
      fallbackTimeoutId = 0;
      dismissSplashFallback("bootstrap-timeout");
    }, FALLBACK_TIMEOUT_MS);
  }

  window[PROGRESS_API_KEY] = {
    set: setProgress,
    complete: function (options) {
      options = options || {};
      return setProgress(1, {
        stage: options.stage || localeCopy.stageReady,
        detail: options.detail || formatLocaleTemplate(localeCopy.detailReady, { title: customTitle }),
        forceValue: true,
        instant: !!options.instant
      });
    },
    syncCopy: function (copy) {
      var nextTitle = String(copy && copy.title || customTitle || "").trim() || customTitle;
      var nextDisplayTitle = String(copy && copy.displayTitle || "").trim();
      var nextCaption = String(copy && copy.caption || caption || "").trim() || caption;
      customTitle = nextTitle;
      caption = nextCaption;
      root.setAttribute(CAPTION_ATTR, nextCaption);
      root.style.setProperty("--jms-custom-splash-caption", toCssContent(nextCaption));
      if (nextDisplayTitle) {
        syncDisplayedTitle(nextDisplayTitle, { raw: true });
      } else {
        syncDisplayedTitle(splashUserName);
      }
      renderProgress();
    },
    getState: function () {
      return {
        current: progressState.current,
        target: progressState.target,
        stage: progressState.stage,
        detail: progressState.detail
      };
    },
    dismiss: dismissSplashFallback
  };

  renderProgress();

  function syncBootstrapReadyState() {
    if (document.readyState === "loading") {
      setProgress(0.06, {
        stage: localeCopy.stageLock,
        detail: formatLocaleTemplate(localeCopy.detailLock, { title: customTitle })
      });
      return;
    }

    if (document.readyState === "interactive") {
      setProgress(0.12, {
        stage: localeCopy.stageStructure,
        detail: formatLocaleTemplate(localeCopy.detailStructure, { title: customTitle })
      });
      return;
    }

    setProgress(0.18, {
      stage: localeCopy.stageTakeover,
      detail: formatLocaleTemplate(localeCopy.detailTakeover, { title: customTitle })
    });
  }

  document.addEventListener("readystatechange", syncBootstrapReadyState);
  document.addEventListener("readystatechange", enforceSplashHomeOnly);
  window.addEventListener("load", function () {
    setProgress(0.22, {
      stage: localeCopy.stageFlow,
      detail: formatLocaleTemplate(localeCopy.detailFlow, { title: customTitle })
    });
  }, { once: true });
  window.addEventListener("hashchange", enforceSplashHomeOnly, { passive: true });
  window.addEventListener("popstate", enforceSplashHomeOnly, { passive: true });
  window.addEventListener("pageshow", enforceSplashHomeOnly, { passive: true });
  syncBootstrapReadyState();
  enforceSplashHomeOnly();
  armSplashFallbackTimeout();
  scheduleSplashUserTitleRefresh();
  window.addEventListener("load", resolveCurrentUserTitleAsync, { once: true });

  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
html[data-jms-custom-splash="1"] {
  background: #05070b !important;
}
html[data-jms-custom-splash="1"] #reactRoot {
  transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
html[data-jms-custom-splash="1"]:not([data-jms-custom-splash-hidden="1"]) body {
  overflow: hidden !important;
}
html[data-jms-custom-splash="1"]:not([data-jms-custom-splash-hidden="1"]) #reactRoot,
html[data-jms-custom-splash="1"]:not([data-jms-custom-splash-hidden="1"]) #reactRoot .splashLogo {
  opacity: 0 !important;
  visibility: hidden !important;
}
html[data-jms-custom-splash="1"] #${LAYER_ID} {
  --jms-splash-progress: 0.04;
  --jms-splash-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --jms-splash-font-display: var(--jms-splash-font-ui);
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
  isolation: isolate;
  opacity: 1;
  visibility: visible;
  background: linear-gradient(155deg, rgba(4, 8, 14, 0.98) 0%, rgba(6, 10, 18, 0.94) 46%, rgba(2, 4, 6, 0.98) 100%);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 420ms;
}
html[data-jms-custom-splash="1"] #${LAYER_ID}::before,
html[data-jms-custom-splash="1"] #${LAYER_ID}::after {
  position: fixed;
  inset: 0;
  content: "";
  pointer-events: none;
}
html[data-jms-custom-splash="1"] #${LAYER_ID}::before {
  inset: -14%;
  background:
    radial-gradient(circle at 16% 18%, rgba(80, 126, 255, 0.34), transparent 26%),
    radial-gradient(circle at 82% 10%, rgba(52, 237, 255, 0.18), transparent 24%),
    radial-gradient(circle at 54% 78%, rgba(27, 218, 163, 0.18), transparent 20%),
    linear-gradient(120deg, rgba(255, 255, 255, 0.02), transparent 32%, rgba(255, 255, 255, 0.02) 68%, transparent);
  filter: blur(18px) saturate(132%);
  animation: jmsBootSplashNebula 6200ms ease-in-out infinite;
}
html[data-jms-custom-splash="1"] #${LAYER_ID}::after {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 100%),
    linear-gradient(0deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 100%);
  background-size: 36px 36px;
  opacity: 0.2;
  mask-image: radial-gradient(circle at center, rgba(0, 0, 0, 0.92), transparent 84%);
}
html[data-jms-custom-splash="1"] #${SHELL_ID} {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: min(500px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  padding: 30px 28px 24px;
  display: grid;
  justify-items: center;
  gap: 18px;
  border-radius: 30px;
  background:
    linear-gradient(160deg, rgba(14, 22, 36, 0.9), rgba(7, 13, 22, 0.72)),
    radial-gradient(circle at top, rgba(80, 126, 255, 0.12), transparent 58%);
  border: 1px solid rgba(143, 191, 255, 0.14);
  box-shadow:
    0 28px 84px rgba(0, 0, 0, 0.52),
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 -20px 48px rgba(6, 16, 28, 0.4);
  backdrop-filter: blur(18px) saturate(140%);
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease;
  animation: jmsBootSplashShellFloat 4200ms ease-in-out infinite;
}
html[data-jms-custom-splash="1"] #${SHELL_ID}::before {
  content: "";
  position: absolute;
  inset: 1px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  pointer-events: none;
}
html[data-jms-custom-splash="1"] #${LOGO_ID} {
  position: static !important;
  inset: auto !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  bottom: auto !important;
  z-index: 1;
  display: block;
  place-self: center;
  justify-self: center !important;
  align-self: center !important;
  width: min(72vw, 320px);
  height: min(38vw, 125px);
  min-width: 188px;
  max-width: 340px;
  aspect-ratio: 16 / 10;
  margin: 0 auto 4px !important;
  padding: 0 !important;
  opacity: 1;
  visibility: visible;
  background-position: center center !important;
  background-repeat: no-repeat !important;
  background-size: contain !important;
  filter:
    drop-shadow(0 20px 40px rgba(0, 0, 0, 0.46))
    drop-shadow(0 0 32px rgba(112, 165, 255, 0.2));
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease;
  transform: none !important;
}
html[data-jms-custom-splash="1"] .jms-boot-splash-copy {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  width: min(100%, 420px);
  max-width: 100%;
  min-width: 0;
  display: grid;
  gap: 6px;
  text-align: center;
  justify-items: center;
}
html[data-jms-custom-splash="1"] #${TITLE_ID} {
  font-family: var(--jms-splash-font-display);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  background: linear-gradient(135deg, rgba(160, 180, 220, 0.9), rgba(120, 140, 200, 0.7));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
html[data-jms-custom-splash="1"] #${CAPTION_ID} {
  font-family: var(--jms-splash-font-ui);
  font-weight: 500;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: rgba(220, 235, 255, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  max-width: min(100%, 400px);
  line-height: 1.4;
}
html[data-jms-custom-splash="1"] #${PROGRESS_PANEL_ID} {
  box-sizing: border-box;
  width: min(100%, 420px);
  max-width: 100%;
  min-width: 0;
  display: grid;
  gap: 10px;
}
html[data-jms-custom-splash="1"] .jms-boot-splash-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
html[data-jms-custom-splash="1"] #${PROGRESS_STAGE_ID} {
  color: rgba(176, 214, 255, 0.86);
  font: 700 11px/1.2 var(--jms-splash-font-ui);
  letter-spacing: 0.16em;
  min-width: 0;
  overflow-wrap: anywhere;
}
html[data-jms-custom-splash="1"] #${PROGRESS_VALUE_ID} {
  box-sizing: border-box;
  flex: 0 0 auto;
  min-width: 68px;
  padding: 8px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(11, 24, 44, 0.92), rgba(14, 44, 68, 0.72));
  border: 1px solid rgba(136, 197, 255, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 12px 28px rgba(5, 14, 25, 0.36);
  color: rgba(239, 247, 255, 0.94);
  font: 700 11px/1 var(--jms-splash-font-ui);
  letter-spacing: 0.14em;
  text-align: center;
}
html[data-jms-custom-splash="1"] .jms-boot-splash-track {
  position: relative;
  height: 18px;
  overflow: hidden;
  border-radius: 999px;
  clip-path: polygon(0 50%, 14px 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 14px 100%);
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
    rgba(6, 11, 18, 0.92);
  border: 1px solid rgba(132, 176, 255, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -8px 18px rgba(0, 0, 0, 0.38);
}
html[data-jms-custom-splash="1"] .jms-boot-splash-track::before {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 0 14px,
    transparent 14px 28px
  );
  opacity: 0.34;
}
html[data-jms-custom-splash="1"] #${PROGRESS_ECHO_ID},
html[data-jms-custom-splash="1"] #${PROGRESS_FILL_ID} {
  position: absolute;
  inset: 1px;
  width: calc(100% - 2px);
  transform-origin: left center;
  transform: scaleX(var(--jms-splash-progress));
  border-radius: inherit;
}
html[data-jms-custom-splash="1"] #${PROGRESS_ECHO_ID} {
  background: linear-gradient(90deg, rgba(77, 117, 255, 0.18), rgba(81, 230, 255, 0.3), rgba(23, 226, 154, 0.16));
  filter: blur(12px);
  opacity: 0.9;
}
html[data-jms-custom-splash="1"] #${PROGRESS_FILL_ID} {
  background:
    linear-gradient(90deg, rgba(92, 115, 255, 0.84) 0%, rgba(83, 213, 255, 0.98) 48%, rgba(45, 232, 171, 0.9) 100%);
  box-shadow:
    0 0 18px rgba(84, 191, 255, 0.28),
    0 0 34px rgba(22, 232, 173, 0.18);
  animation: jmsBootSplashBeam 1450ms linear infinite;
}
html[data-jms-custom-splash="1"] #${PROGRESS_FILL_ID}::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.48) 38%, transparent 66%),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.14) 0 10px, transparent 10px 22px);
  mix-blend-mode: screen;
  opacity: 0.68;
}
html[data-jms-custom-splash="1"] #${PROGRESS_ORB_ID} {
  position: absolute;
  top: 50%;
  left: clamp(16px, calc(var(--jms-splash-progress) * 100%), calc(100% - 16px));
  width: 34px;
  height: 34px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 18%, rgba(131, 229, 255, 0.92) 32%, rgba(78, 122, 255, 0.42) 58%, transparent 78%);
  box-shadow:
    0 0 20px rgba(100, 201, 255, 0.46),
    0 0 34px rgba(42, 226, 191, 0.28);
  mix-blend-mode: screen;
  animation: jmsBootSplashOrbPulse 1600ms ease-in-out infinite;
}
html[data-jms-custom-splash="1"] #${PROGRESS_DETAIL_ID} {
  color: rgba(201, 218, 243, 0.72);
  font: 500 11px/1.45 var(--jms-splash-font-ui);
  letter-spacing: 0.04em;
  text-align: center;
  max-width: 100%;
  overflow-wrap: anywhere;
}
html[data-jms-custom-splash="1"][data-jms-custom-splash-hidden="1"] #${LAYER_ID} {
  opacity: 0;
  visibility: hidden;
  transform: scale(1.02);
}
html[data-jms-custom-splash="1"][data-jms-custom-splash-hidden="1"] #${SHELL_ID} {
  opacity: 0;
  transform: translateY(-10px) scale(0.985);
}
html[data-jms-custom-splash="1"][data-jms-custom-splash-hidden="1"] #${LOGO_ID} {
  opacity: 0;
  transform: translateY(-18px) scale(0.96);
}
@keyframes jmsBootSplashNebula {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.78; }
  50% { transform: translate3d(0, -2%, 0) scale(1.04); opacity: 1; }
}
@keyframes jmsBootSplashShellFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes jmsBootSplashBeam {
  0% { filter: saturate(100%) brightness(0.96); background-position: 0% 50%; }
  50% { filter: saturate(118%) brightness(1.06); background-position: 100% 50%; }
  100% { filter: saturate(100%) brightness(0.96); background-position: 0% 50%; }
}
@keyframes jmsBootSplashOrbPulse {
  0%, 100% { transform: translate(-50%, -50%) scale(0.96); opacity: 0.82; }
  50% { transform: translate(-50%, -50%) scale(1.06); opacity: 1; }
}
@media (max-width: 640px) {
  html[data-jms-custom-splash="1"] #${SHELL_ID} {
    width: min(440px, calc(100vw - 16px));
    max-width: calc(100vw - 16px);
    padding: 26px 18px 20px;
    gap: 16px;
  }
  html[data-jms-custom-splash="1"] #${LOGO_ID} {
    width: min(76vw, 250px);
    min-width: 164px;
    height: min(38vw, 125px);
  }
  html[data-jms-custom-splash="1"] #${CAPTION_ID} {
    font-size: 12px;
    letter-spacing: 0.12em;
  }
  html[data-jms-custom-splash="1"] #${PROGRESS_VALUE_ID} {
    min-width: 62px;
    padding: 7px 10px;
  }
  html[data-jms-custom-splash="1"] .jms-boot-splash-progress-head {
    gap: 10px;
  }
  html[data-jms-custom-splash="1"] .jms-boot-splash-track {
    height: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  html[data-jms-custom-splash="1"] #${LAYER_ID}::before,
  html[data-jms-custom-splash="1"] #${SHELL_ID},
  html[data-jms-custom-splash="1"] #${PROGRESS_FILL_ID},
  html[data-jms-custom-splash="1"] #${PROGRESS_ORB_ID} {
    animation: none !important;
  }
}
`;
    (document.head || root).appendChild(style);
  }
})();
</script>
""";
        }

        public static bool TryHandleConditionalGet(HttpContext context, string cacheKey)
        {
            var etag = BuildEtag(cacheKey);
            ApplyHeaders(context.Response.Headers, etag);

            var ifNoneMatch = context.Request.Headers[HeaderNames.IfNoneMatch].ToString();
            if (!string.IsNullOrWhiteSpace(ifNoneMatch) &&
                ifNoneMatch.IndexOf(etag, StringComparison.Ordinal) >= 0)
            {
                context.Response.StatusCode = StatusCodes.Status304NotModified;
                return true;
            }

            return false;
        }

        public static void ApplyStaticFileHeaders(StaticFileResponseContext context)
        {
            var cacheKey = context.Context.Request.Path.Value ?? string.Empty;
            var etag = BuildEtag(cacheKey);
            ApplyHeaders(context.Context.Response.Headers, etag);
        }

        private static void ApplyHeaders(IHeaderDictionary headers, string etag)
        {
            headers[HeaderNames.CacheControl] = CacheControlValue;
            headers[HeaderNames.ETag] = etag;
        }

        private static string BuildEtag(string cacheKey)
        {
            var normalized = (cacheKey ?? string.Empty).Replace("\"", string.Empty, StringComparison.Ordinal);
            return $"\"{AssetVersion}:{normalized}\"";
        }

        private static string BuildAssetVersion()
        {
            var assembly = typeof(JMSFusionPlugin).Assembly;
            var version = assembly.GetName().Version?.ToString() ?? "0.0.0.0";
            var mvid = assembly.ManifestModule.ModuleVersionId.ToString("N");
            return $"{version}-{mvid[..12]}";
        }
    }
}
