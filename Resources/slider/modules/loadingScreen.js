import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";

let loadingScreenElement = null;
let loadingProgress = 0;
let hideTimeout = null;
let isAlreadyHidden = false;
let simInterval = null;
let tipInterval = null;
let tipIndex = 0;
let currentTips = [];

const GRADIENT_COLORS = [
  ["#667eea", "#764ba2"],
  ["#f093fb", "#f5576c"],
  ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"],
  ["#fa709a", "#fee140"],
];

function getLabelsSafe() {
  try {
    const lang = getDefaultLanguage?.() || 'tur';
    return getLanguageLabels?.(lang) || {};
  } catch {
    return {};
  }
}

function pickFirstLabel(labels, keys, fallback) {
  for (const k of keys) {
    const v = labels?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
}

function L(keyOrKeys, fallback) {
  const labels = getLabelsSafe();
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  return pickFirstLabel(labels, keys, fallback);
}

function getCfgSafe() {
  try {
    return getConfig?.() || {};
  } catch {
    return {};
  }
}

function isEnabledByConfig(cfg) {
  if (cfg && typeof cfg.enableLoadingScreen === "boolean") return cfg.enableLoadingScreen;
  if (cfg && cfg.disableLoadingScreen === true) return false;
  return true;
}

function isTipsEnabled(cfg) {
  if (cfg && typeof cfg.loadingScreenShowTips === "boolean") return cfg.loadingScreenShowTips;
  return true;
}

function shouldSimulateProgress(cfg) {
  if (cfg && typeof cfg.loadingScreenSimulateProgress === "boolean") return cfg.loadingScreenSimulateProgress;
  return true;
}

function getLoadingMessages() {
  const cfg = getCfgSafe();
  const raw = String(cfg.loadingScreenMessages || "").trim();
  if (raw) {
    const arr = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (arr.length) return arr;
  }

  return [
    L(["loadingMsgPreparingLibrary", "loadingMsgLibrary"], "Kütüphanenizi hazırlıyoruz..."),
    L(["loadingMsgLoadingMoviesSeries", "loadingMsgMoviesTv"], "Filmler ve diziler yükleniyor..."),
    L(["loadingMsgBuildingRecs", "loadingMsgRecs"], "Önerileriniz oluşturuluyor..."),
    L(["loadingMsgCheckingQualities", "loadingMsgQuality"], "Medya kaliteleri kontrol ediliyor..."),
    L(["loadingMsgUpdatingRecents", "loadingMsgRecent"], "Son eklenenler güncelleniyor..."),
    L(["loadingMsgPreparingList", "loadingMsgList"], "Kişisel listeniz hazırlanıyor..."),
  ];
}

function getLoadingTips() {
  const cfg = getCfgSafe();
  const raw = cfg.loadingScreenTips;

  if (Array.isArray(raw)) {
    const arr = raw.map(s => String(s || "").trim()).filter(Boolean);
    if (arr.length) return arr;
  } else if (typeof raw === "string" && raw.trim()) {
    const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (arr.length) return arr;
  }

  const labels = getLabelsSafe();
  const tipsFromLabels = Object.keys(labels)
    .filter(k => /^loadingTip\d+$/.test(k))
    .sort((a, b) => Number(a.replace("loadingTip", "")) - Number(b.replace("loadingTip", "")))
    .map(k => String(labels[k]).trim())
    .filter(Boolean);

  if (tipsFromLabels.length) return tipsFromLabels;

  return [
    "MonWUI ayarlar paneline F2 ile ulaşabilirsiniz.",
    "Rastgele slider için API sorgu parametrelerinde &sortBy ve &sortOrder alanlarını silebilir ya da &sortBy=Random yapabilirsiniz.",
    "API sorgu parametrelerinde IncludeItemTypes=Movie,Series,BoxSet kullanabilir; sadece filmler için IncludeItemTypes=Movie, sadece diziler için IncludeItemTypes=Series yapabilirsiniz.",
    "2 farklı HoverTrailer modalı bulunmaktadır. HoverTrailer ayarlarından seçebilirsiniz.",
    "Yükleme ekranını F2 > MonWUI ayarları altında etkinleştirip kapatabilirsiniz.",
  ];
}


function getRandomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getVersionRaw() {
  try {
    const config = getCfgSafe();
    return (config.version ?? "").toString().trim() || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function normalizeVersionLabel(v) {
  const s = String(v || "").trim();
  if (!s) return "v1.0.0";
  if (/^v/i.test(s)) return "v" + s.replace(/^v+/i, "").trim();
  return "v" + s;
}

let __resolvedJfLogoUrl = null;

function isHomeVisibleNow() {
  try {
    return !!document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  } catch {
    return false;
 }
}

let __waitHomeObserver = null;
function waitForHomeVisibleOnce(timeoutMs = 15000) {
  if (isHomeVisibleNow()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { __waitHomeObserver?.disconnect?.(); } catch {}
      __waitHomeObserver = null;
      resolve(!!ok);
    };
    try {
      __waitHomeObserver?.disconnect?.();
      __waitHomeObserver = new MutationObserver(() => {
        if (isHomeVisibleNow()) finish(true);
      });
      __waitHomeObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    } catch {}
    setTimeout(() => finish(isHomeVisibleNow()), Math.max(0, timeoutMs|0));
  });
}

async function resolveJellyfinLogoUrl() {
  if (__resolvedJfLogoUrl) return __resolvedJfLogoUrl;

  const baseEl = document.querySelector("base");
  const baseFromTag = baseEl?.href || "";
  const href = location.href;
  const webRootFromLocation = (() => {
    const i = href.indexOf("/web/");
    if (i === -1) return "";
    return href.slice(0, i + "/web/".length);
  })();

  const webRootDefault = location.origin + "/web/";
  const baseCandidates = [
    baseFromTag,
    webRootFromLocation,
    webRootDefault,
  ].filter(Boolean);

  const candidates = [
    "assets/img/icon-transparent.png",
    "assets/img/icon.png",
    "assets/img/logo.png",
    "assets/img/banner-light.png",
    "assets/img/banner.png",
    "assets/img/jellyfin-logo.png",
    "assets/img/icon-192.png",
    "assets/img/icon-512.png",
    "img/icon-transparent.png",
    "img/icon.png",
    "img/logo.png",
  ];

  async function exists(url) {
    try {
      let res = await fetch(url, { method: "HEAD", cache: "force-cache" });
      if (res.ok) return true;
      if (res.status === 405 || res.status === 404) {
        res = await fetch(url, { method: "GET", cache: "force-cache" });
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  for (const baseHref of baseCandidates) {
    for (const p of candidates) {
      const url = new URL(p, baseHref).toString();
      if (await exists(url)) {
        __resolvedJfLogoUrl = url;
        return url;
      }
    }
  }

  __resolvedJfLogoUrl = null;
  return null;
}

function extractCleanTitle(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.split(" - ")[0].trim();
}

function resolveJellyfinAppTitleFromDom() {
  const selectors = [
    ".pageTitle",
    ".headerTitle",
    ".topHeader .headerTitle",
    ".skinHeader .headerLogoText",
    ".skinHeader .headerLogo",
    "header .headerTitle",
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const txt = el?.textContent?.trim();
    if (txt) return txt;
    const alt = el?.getAttribute?.("title") || el?.getAttribute?.("aria-label");
    if (alt) return String(alt).trim();
  }
  return "";
}

function resolveJellyfinAppTitle() {
  const fromDom = resolveJellyfinAppTitleFromDom();
  if (fromDom) return extractCleanTitle(fromDom);

  const fromDoc = extractCleanTitle(document.title);
  if (fromDoc) return fromDoc;

  return "Jellyfin";
}

function formatTemplate(template, vars) {
  let out = String(template ?? "");
  out = out.replace(/\{j-title\}|\{jTitle\}/gi, vars?.jTitle ?? "");
  out = out.replace(/\{title\}/gi, vars?.jTitle ?? "");
  out = out.replace(/\{version\}/gi, vars?.version ?? "");
  return out;
}

function buildLoadingTitle() {
  const baseTitle = resolveJellyfinAppTitle();
  const versionLabel = normalizeVersionLabel(getVersionRaw());
  const tpl = L(
    ["loadingScreenTitleTemplate", "loadingScreenTitle", "loadingTitleTemplate"],
    "{j-title} hazırlanıyor..."
  );

  return formatTemplate(tpl, {
    jTitle: baseTitle,
    version: versionLabel,
  }).trim();
}

function createLoadingScreenHTML() {
  const cfg = getCfgSafe();
  const tipsEnabled = isTipsEnabled(cfg);

  const gradient = getRandomFromArray(GRADIENT_COLORS);
  const msgs = getLoadingMessages();
  const randomMessage = getRandomFromArray(msgs);

  const year = new Date().getFullYear();
  const versionLabel = normalizeVersionLabel(getVersionRaw());

  return `
    <div id="jms-loading-screen" class="jms-loading-screen" style="--gradient-start: ${gradient[0]}; --gradient-end: ${gradient[1]}">
      <div class="loading-screen-background">
        <div class="gradient-animation"></div>
        <div class="particles-container"></div>
      </div>

      <div class="loading-screen-content">
        <div class="loading-logo">
        <img
            class="logo-icon"
            alt="Jellyfin"
            loading="eager"
            decoding="async"
            draggable="false"
            style="display:none;"
          />
          <div class="logo-fallback" aria-hidden="true">
            <svg class="logo-svg" viewBox="0 0 100 100" width="60" height="60">
              <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:${gradient[0]};stop-opacity:1" />
                  <stop offset="100%" style="stop-color:${gradient[1]};stop-opacity:1" />
                </linearGradient>
              </defs>
              <path d="M50,10 L90,30 L90,70 L50,90 L10,70 L10,30 Z" fill="url(#logoGradient)" />
              <path d="M50,25 L75,40 L75,60 L50,75 L25,60 L25,40 Z" fill="white" opacity="0.9" />
              <circle cx="50" cy="50" r="15" fill="url(#logoGradient)" />
            </svg>
          </div>
        </div>

        <div class="loading-title">
          <h1 class="jms-loading-title">${buildLoadingTitle()}</h1>
          <p class="subtitle">${L(["loadingScreenBrandSubtitle", "loadingSubtitle"], "Medya Kütüphanesi")}</p>
        </div>

        <div class="loading-progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 0%"></div>
            <div class="progress-glow"></div>
          </div>
          <div class="progress-text">${randomMessage}</div>
          <div class="progress-percent">%0</div>
        </div>

        <div class="loading-details">
          <div class="loading-step">
            <span class="step-icon">🎬</span>
            <span class="step-text">${L(
              ["loadingScreenStep1Text", "loadingStepSlider"],
              "Slider içeriği hazırlanıyor"
            )}</span>
            <span class="step-status loading"></span>
          </div>
          <div class="loading-step">
            <span class="step-icon">🌟</span>
            <span class="step-text">${L(
              ["loadingScreenStep2Text", "loadingStepRecs"],
              "Kişisel öneriler hesaplanıyor"
            )}</span>
            <span class="step-status pending"></span>
          </div>
          <div class="loading-step">
            <span class="step-icon">🎯</span>
            <span class="step-text">${L(
              ["loadingScreenStep3Text", "loadingStepRecent"],
              "Son eklenenler güncelleniyor"
            )}</span>
            <span class="step-status pending"></span>
          </div>
        </div>

        <div class="loading-tips" style="${tipsEnabled ? "" : "display:none;"}">
          <div class="tip-icon">💡</div>
          <div class="tip-content">
            <p class="jms-tip-text"></p>
          </div>
        </div>
      </div>

      <div class="loading-screen-footer">
        <span class="footer-text">© ${year} ${L(["loadingFooterBrand", "loadingScreenFooterBrand"], "Jellyfin MonWUI Plugin")}</span>
        <span class="footer-version">${versionLabel}</span>
      </div>
    </div>
  `;
}

function createParticles(container) {
  if (!container) return;
  const particleCount = 20;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";

    const size = Math.random() * 4 + 1;
    const posX = Math.random() * 100;
    const posY = Math.random() * 100;
    const duration = Math.random() * 20 + 10;
    const delay = Math.random() * 5;

    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${posX}%`;
    particle.style.top = `${posY}%`;
    particle.style.animationDuration = `${duration}s`;
    particle.style.animationDelay = `${delay}s`;

    container.appendChild(particle);
  }
}

function updateStepStatus() {
  if (!loadingScreenElement || isAlreadyHidden) return;

  const steps = loadingScreenElement.querySelectorAll(".loading-step");

  steps.forEach((step, index) => {
    const status = step.querySelector(".step-status");
    if (!status) return;

    const progressThresholds = [30, 60, 90];
    const currentProgress = loadingProgress;

    if (currentProgress >= progressThresholds[index]) {
      status.className = "step-status completed";
      status.textContent = "✓";
    } else if (currentProgress >= progressThresholds[index] - 15) {
      status.className = "step-status loading";
      status.textContent = "⌛";
    } else {
      status.className = "step-status pending";
      status.textContent = "";
    }
  });
}

export function updateProgress(percent, message = null) {
  if (!loadingScreenElement || isAlreadyHidden) return;

  loadingProgress = Math.min(100, Math.max(0, percent));

  const progressFill = loadingScreenElement.querySelector(".progress-fill");
  const progressPercent = loadingScreenElement.querySelector(".progress-percent");
  const progressText = loadingScreenElement.querySelector(".progress-text");

  if (progressFill) progressFill.style.width = `${loadingProgress}%`;
  if (progressPercent) progressPercent.textContent = `%${Math.round(loadingProgress)}`;
  if (message && progressText) progressText.textContent = message;

  updateStepStatus();
}

export function showLoadingScreen() {
  const cfg = getCfgSafe();
  if (!isEnabledByConfig(cfg)) return;
  if (!isHomeVisibleNow()) {
    try { hideLoadingScreenForce(); } catch {}
    return;
  }
  if (loadingScreenElement && document.body.contains(loadingScreenElement)) return;

  const existing = document.getElementById("jms-loading-screen");
  if (existing) existing.remove();

  document.body.insertAdjacentHTML("beforeend", createLoadingScreenHTML());
  loadingScreenElement = document.getElementById("jms-loading-screen");

  try {
  const titleEl = loadingScreenElement?.querySelector(".jms-loading-title");
  if (titleEl) {
    const updateTitle = () => {
      if (isAlreadyHidden || !loadingScreenElement) return;
      titleEl.textContent = buildLoadingTitle();
    };

    updateTitle();

    const titleNode = document.querySelector("head > title");
    if (titleNode) {
      const mo = new MutationObserver(() => updateTitle());
      mo.observe(titleNode, { childList: true, subtree: true, characterData: true });
      const oldHide = hideLoadingScreen;
    }
  }
} catch {}

  (async () => {
    try {
      const url = await resolveJellyfinLogoUrl();
      const img = loadingScreenElement?.querySelector(".loading-logo .logo-icon");
      const fallback = loadingScreenElement?.querySelector(".loading-logo .logo-fallback");
      if (!img) return;

      if (url) {
        img.src = url;
        img.style.display = "";
        if (fallback) fallback.style.display = "none";
      } else {
        img.style.display = "none";
        if (fallback) fallback.style.display = "";
      }
    } catch (e) {
      console.warn("[JMS] logo resolve failed:", e);
    }
  })();

  const particlesContainer = loadingScreenElement?.querySelector(".particles-container");
  if (particlesContainer) createParticles(particlesContainer);

  isAlreadyHidden = false;
  loadingProgress = 0;

  injectLoadingScreenCSS();

  if (shouldSimulateProgress(cfg)) simulateProgress();

    try {
    startTipsRotation();
    } catch (e) {
    console.warn("[JMS] tips rotation failed:", e);
    }

  console.debug("[JMS] Loading screen shown");
}

export function hideLoadingScreen() {
  if (!loadingScreenElement || isAlreadyHidden) return;

  isAlreadyHidden = true;

  if (hideTimeout) clearTimeout(hideTimeout);
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  stopTipsRotation();
  updateProgress(100, L(["loadingScreenReadyText", "loadingReady"], "Hazır!"));

  hideTimeout = setTimeout(() => {
    if (loadingScreenElement) {
      loadingScreenElement.classList.add("fade-out");

      setTimeout(() => {
        if (loadingScreenElement && document.body.contains(loadingScreenElement)) {
          loadingScreenElement.remove();
          loadingScreenElement = null;
        }
      }, 500);
    }
  }, 800);

  console.debug("[JMS] Loading screen hidden");
}

function simulateProgress() {
  if (isAlreadyHidden || !loadingScreenElement) return;

  const messages = getLoadingMessages();
  let currentStep = 0;

  if (simInterval) clearInterval(simInterval);

  simInterval = setInterval(() => {
    if (isAlreadyHidden || !loadingScreenElement) {
      clearInterval(simInterval);
      simInterval = null;
      return;
    }

    const increment = Math.random() * 5 + 2;
    const newProgress = Math.min(loadingProgress + increment, 95);

    if (newProgress >= currentStep * 30 && currentStep < messages.length - 1) {
      currentStep++;
      updateProgress(newProgress, messages[currentStep]);
    } else {
      updateProgress(newProgress);
    }

    if (newProgress >= 95) {
      clearInterval(simInterval);
      simInterval = null;
    }
  }, 500);
}

function setTipText(text) {
  if (!loadingScreenElement || isAlreadyHidden) return;
  const el = loadingScreenElement.querySelector(".jms-tip-text");
  if (!el) return;

  el.classList.add("tip-fade");
  setTimeout(() => {
    el.textContent = text || "";
    el.classList.remove("tip-fade");
  }, 120);
}

function startTipsRotation() {
  const cfg = getCfgSafe();
  if (!isTipsEnabled(cfg)) return;

  currentTips = getLoadingTips();
  if (!currentTips.length) return;

  tipIndex = Math.floor(Math.random() * currentTips.length);
  setTipText(currentTips[tipIndex]);

  const intervalMs = Number(cfg.loadingScreenTipIntervalMs) || 4000;

  if (tipInterval) clearInterval(tipInterval);
  tipInterval = setInterval(() => {
    if (isAlreadyHidden || !loadingScreenElement) {
      clearInterval(tipInterval);
      tipInterval = null;
      return;
    }
    tipIndex = (tipIndex + 1) % currentTips.length;
    setTipText(currentTips[tipIndex]);
  }, Math.max(1500, intervalMs));
}

function stopTipsRotation() {
  if (tipInterval) {
    clearInterval(tipInterval);
    tipInterval = null;
  }
}


function injectLoadingScreenCSS() {
  if (document.getElementById("jms-loading-screen-css")) return;

  const css = `
    .jms-loading-screen {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, var(--gradient-start, #667eea), var(--gradient-end, #764ba2));
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      color: white;
      overflow: hidden;
      transition: opacity 0.5s ease-out;
    }

    .jms-loading-screen.fade-out {
      opacity: 0;
      pointer-events: none;
    }

    .loading-screen-background {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
    }

    .jms-tip-text.tip-fade {
  opacity: 0.2;
  transition: opacity 0.12s ease;
}
.jms-tip-text {
  transition: opacity 0.12s ease;
}

    .gradient-animation {
      position: absolute;
      width: 200%;
      height: 200%;
      background: linear-gradient(
        45deg,
        rgba(255,255,255,0.1) 0%,
        rgba(255,255,255,0) 25%,
        rgba(255,255,255,0) 50%,
        rgba(255,255,255,0.1) 75%,
        rgba(255,255,255,0.1) 100%
      );
      animation: gradientMove 20s linear infinite;
    }

    @keyframes gradientMove {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }

    .particles-container {
      position: absolute;
      width: 100%;
      height: 100%;
    }

    .particle {
      position: absolute;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      pointer-events: none;
      animation: floatParticle linear infinite;
    }

    @keyframes floatParticle {
      0% { transform: translateY(0) translateX(0); opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { transform: translateY(-100px) translateX(20px); opacity: 0; }
    }

    .loading-screen-content {
      text-align: center;
      max-width: 600px;
      width: min(600px, 92vw);
      padding: 2rem;
      background: rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      z-index: 1;
    }

    .loading-logo {
      margin-bottom: 1.5rem;
      animation: logoFloat 3s ease-in-out infinite;
    }

    .loading-logo .logo-icon {
        width: 72px;
        height: 72px;
        object-fit: contain;
        filter: drop-shadow(0 10px 18px rgba(0,0,0,0.25));
        user-select: none;
        -webkit-user-drag: none;
    }

    .loading-logo .logo-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .loading-logo .logo-svg {
      width: 72px;
      height: 72px;
      filter: drop-shadow(0 10px 18px rgba(0,0,0,0.25));
    }

    @keyframes logoFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    .loading-title h1 {
      font-size: 3rem;
      font-weight: 700;
      margin: 0;
      background: linear-gradient(to right, #fff, rgba(255,255,255,0.8));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .loading-title .subtitle {
      font-size: 1rem;
      opacity: 0.8;
      margin-top: 0.5rem;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .loading-progress-container {
      margin: 2rem 0;
    }

    .progress-bar {
      position: relative;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 1rem;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(to right, #00ff88, #00ccff);
      border-radius: 4px;
      transition: width 0.3s ease-out;
      position: relative;
    }

    .progress-glow {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(255,255,255,0.4) 50%,
        transparent 100%);
      animation: glowMove 2s ease-in-out infinite;
    }

    @keyframes glowMove {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    .progress-text {
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
      min-height: 1.2em;
      overflow-wrap: anywhere;
    }

    .progress-percent {
      font-size: 1.5rem;
      font-weight: 700;
      color: #00ff88;
    }

    .loading-details {
      margin: 2rem 0;
      text-align: left;
    }

    .loading-step {
      display: flex;
      align-items: center;
      margin: 0.75rem 0;
      padding: 0.5rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      transition: all 0.3s ease;
      gap: 8px;
    }

    .loading-step:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(5px);
    }

    .step-icon {
      font-size: 1.2rem;
      width: 30px;
      text-align: center;
      flex: 0 0 auto;
    }

    .step-text {
      flex: 1 1 auto;
      font-size: 0.9rem;
      overflow-wrap: anywhere;
    }

    .step-status {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 0.8rem;
      font-weight: bold;
      flex: 0 0 auto;
    }

    .step-status.pending { background: rgba(255, 255, 255, 0.1); }
    .step-status.loading { background: rgba(255, 193, 7, 0.2); color: #ffc107; animation: pulse 1.5s infinite; }
    .step-status.completed { background: rgba(0, 255, 136, 0.2); color: #00ff88; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .loading-tips {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1rem;
      margin-top: 1.5rem;
      border-left: 3px solid #00ccff;
      gap: 10px;
    }

    .tip-icon { font-size: 1.5rem; flex: 0 0 auto; }
    .tip-content { flex: 1 1 auto; min-width: 0; }
    .tip-content p {
      margin: 0;
      font-size: 0.85rem;
      opacity: 0.9;
      text-align: left;
      overflow-wrap: anywhere;
    }

    .loading-screen-footer {
      position: absolute;
      bottom: 2rem;
      left: 0;
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 2rem;
      font-size: 0.8rem;
      opacity: 0.7;
      gap: 12px;
      flex-wrap: wrap;
    }

    .footer-text {
      flex: 1 1 auto;
      min-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 70vw;
    }

    .footer-version {
        flex: 0 0 auto;
        background: rgba(0, 0, 0, 0.2);
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-family: 'Courier New', monospace;
        white-space: nowrap;
        max-width: 40vw;
        overflow: hidden;
        text-overflow: ellipsis;
        left: -50px;
        position: relative;
        backdrop-filter: blur(10px);
    }

    @media (max-width: 768px) {
      .loading-screen-content { padding: 1.5rem; }
      .loading-title h1 { font-size: 2rem; }
      .loading-screen-footer {
        bottom: 1.25rem;
        padding: 0 1rem;
      }
      .footer-text {
        white-space: normal;
        max-width: 100%;
      }
    }

    @media (max-width: 480px) {
      .loading-screen-content { padding: 1rem; }
      .loading-details { margin: 1rem 0; }
      .loading-step {
        flex-direction: row;
        text-align: left;
      }
      .footer-version { max-width: 80vw; }
    }
  `;

  const style = document.createElement("style");
  style.id = "jms-loading-screen-css";
  style.textContent = css;
  document.head.appendChild(style);
}

export function hideLoadingScreenForce() {
  try {
    if (!loadingScreenElement) return;
    isAlreadyHidden = true;
    try { if (hideTimeout) clearTimeout(hideTimeout); } catch {}
    try { if (simInterval)  clearInterval(simInterval); } catch {}
    try { stopTipsRotation(); } catch {}
    loadingScreenElement.remove();
    loadingScreenElement = null;
  } catch {}
}

export function autoHideOnHomeReady() {
  if (!isHomeVisibleNow()) return;
  const checkAndHide = () => {
    const homePage = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
    const sliderContainer = document.querySelector("#slides-container");
    const slides = document.querySelectorAll(".slide");
    const planned = Number(window.__totalSlidesPlanned || 0);
    const created = Number(window.__slidesCreated || 0);
    const allReady = planned > 0 && created >= planned;
    if (homePage && sliderContainer && slides.length > 0 && allReady) {
      hideLoadingScreen();
      return true;
    }
    return false;
  };

  if (checkAndHide()) return;

  const onAllReady = () => {
    try {
      hideLoadingScreen();
    } catch {}
  };
  document.addEventListener("jms:all-slides-ready", onAllReady, { once: true });

  const observer = new MutationObserver(() => {
    if (checkAndHide()) observer.disconnect();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    document.removeEventListener("jms:all-slides-ready", onAllReady);
  }, 30000);
}

export function initLoadingScreen() {
  const cfg = getCfgSafe();
  if (!isEnabledByConfig(cfg)) {
    const api = { hide: () => {}, show: () => {}, updateProgress: () => {} };
    try { window.__jmsLoadingScreen = api; } catch {}
    return api;
  }

  const api = {
    hide: hideLoadingScreen,
    show: async () => {
      const cfg2 = getCfgSafe();
      if (!isEnabledByConfig(cfg2)) return;
      if (!isHomeVisibleNow()) {
        await waitForHomeVisibleOnce(15000);
      }
      if (!isHomeVisibleNow()) return;
      showLoadingScreen();
      autoHideOnHomeReady();
    },
    updateProgress,
    force: hideLoadingScreenForce,
  };

  try { window.__jmsLoadingScreen = api; } catch {}
  try { api.show(); } catch {}
  return api;
}
