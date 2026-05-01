import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import {
  getSessionInfo,
  isAuthReadyStrict,
  waitForAuthReadyStrict,
  persistAuthSnapshotFromApiClient,
  getAuthHeader,
} from "../../Plugins/JMSFusion/runtime/api.js";
import { getRandomAvatarUrl } from "./avatarPicker.js";
import { createConfiguredUserAvatar } from "./userAvatar.js";
import { saveCredentials, saveApiKey, clearCredentials } from "../../Plugins/JMSFusion/runtime/auth.js";
import { enhanceFormAccessibility } from "./accessibility.js";
import { findHeaderMountTarget, getHeaderMountWaitSelector } from "./headerCompat.js";

const OVERLAY_ID = "jfProfileChooserOverlay";
const HEADER_BTN_ID = "jfProfileChooserBtn";
const TOKEN_STORE_PREFIX = "jf_profile_tokens_v1::";
const TOKEN_STORE_REV_KEY = "jf_profile_tokens_rev::";
const AUTOOPEN_FLAG = "jf_profileChooser_autoopened";
const LAST_PICK_KEY = "jf_profileChooser_lastUser";
const LAST_ACTIVE_KEY_PREFIX = "jf_profileChooser_lastActive::";
const AUTOOPEN_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const CUSTOM_SPLASH_ACTIVE_ATTR = "data-jms-custom-splash";
const CUSTOM_SPLASH_HIDDEN_ATTR = "data-jms-custom-splash-hidden";

let headerHideMo = null;

function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...(lastArgs || []));
    });
  };
}

function timeoutThrottle(fn, wait = 250) {
  let t = null;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (t) return;
    t = setTimeout(() => {
      t = null;
      fn(...(lastArgs || []));
    }, wait);
  };
}

const LEGACY_HIDE_STYLE_ID = "jfProfileChooserLegacyHideStyle";
const NATIVE_HEADER_USER_SELECTOR = ".headerUserButtonRound, .headerUserButton, [aria-controls=\"app-user-menu\"]";
const NATIVE_HEADER_USER_MARKER = "data-jfpc-hidden-native-user-btn";
const MUI_USER_MENU_TRIGGER_SELECTOR = '[aria-controls="app-user-menu"]';

function hideLegacyHeaderUserButtons(root = document) {
  const nodes = [];
  try {
    if (root?.nodeType === 1 && root.matches?.(NATIVE_HEADER_USER_SELECTOR)) nodes.push(root);
    if (root?.querySelectorAll) {
      root.querySelectorAll(NATIVE_HEADER_USER_SELECTOR).forEach((el) => nodes.push(el));
    }
  } catch {}

  for (const el of nodes) {
    try {
      el.setAttribute(NATIVE_HEADER_USER_MARKER, "1");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("tabindex", "-1");
    } catch {}
  }
}

function ensureLegacyHeaderUserButtonHidden() {
  if (!document.getElementById(LEGACY_HIDE_STYLE_ID)) {
    const st = document.createElement("style");
    st.id = LEGACY_HIDE_STYLE_ID;
    st.textContent = `
      ${NATIVE_HEADER_USER_SELECTOR} {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  hideLegacyHeaderUserButtons(document);

  if (headerHideMo) return;
  headerHideMo = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      if (mut.type === "attributes") {
        hideLegacyHeaderUserButtons(mut.target);
        continue;
      }
      for (const node of mut.addedNodes || []) {
        hideLegacyHeaderUserButtons(node);
      }
    }
  });

  try {
    headerHideMo.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch {}
}

function cleanupLegacyHeaderUserButtonHidden() {
  try { headerHideMo?.disconnect?.(); } catch {}
  headerHideMo = null;
  try {
    document.querySelectorAll(`[${NATIVE_HEADER_USER_MARKER}="1"]`).forEach((el) => {
      el.style.removeProperty("display");
      el.style.removeProperty("visibility");
      el.style.removeProperty("pointer-events");
      el.removeAttribute("aria-hidden");
      if (el.getAttribute("tabindex") === "-1") el.removeAttribute("tabindex");
      el.removeAttribute(NATIVE_HEADER_USER_MARKER);
    });
  } catch {}
  const st = document.getElementById(LEGACY_HIDE_STYLE_ID);
  if (st) st.remove();
}

export function syncProfileChooserHeaderButtonVisibility(enabled) {
  const shouldHide = enabled ?? (() => {
    try {
      return ((typeof getConfig === "function" ? getConfig() : {}) || {}).enableProfileChooser !== false;
    } catch {
      return true;
    }
  })();

  if (!shouldHide) {
    cleanupLegacyHeaderUserButtonHidden();
    return;
  }
  ensureLegacyHeaderUserButtonHidden();
}

function isSafeMode() {
  try {
    const p = new URLSearchParams(location.search || "");
    if (p.get("safe") === "1") return true;
    if (localStorage.getItem("jf_profileChooser_disabled") === "1") return true;
  } catch {}
  return false;
}

function normalizeBase(s) {
  return (typeof s === "string" ? s : "").trim().replace(/\/+$/, "");
}

function getServerIdentity() {
  try {
    const si = getSessionInfo?.() || {};
    const sid = String(si.serverId || "").trim();
    if (sid) return sid;
    const base = normalizeBase(si.serverAddress || "");
    if (base) return base;
  } catch {}
  try {
    const ac = window.ApiClient || window.apiClient || null;
    const sid = ac?._serverInfo?.SystemId || ac?._serverInfo?.Id || null;
    if (sid) return String(sid);
    const base =
      (typeof ac?.serverAddress === "function" ? ac.serverAddress() :
       (typeof ac?.serverAddress === "string" ? ac.serverAddress : "")) || "";
    const nb = normalizeBase(base);
    if (nb) return nb;
  } catch {}
  return "default";
}

function tokenStoreKey() {
  return TOKEN_STORE_PREFIX + getServerIdentity();
}

function tokenStoreRevKey() {
  return TOKEN_STORE_REV_KEY + getServerIdentity();
}

function lastActiveKey() {
  return LAST_ACTIVE_KEY_PREFIX + getServerIdentity();
}

function readLastActiveTs() {
  try {
    return parseInt(localStorage.getItem(lastActiveKey()) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

function writeLastActiveTs(ts = Date.now()) {
  try { localStorage.setItem(lastActiveKey(), String(ts)); } catch {}
}

function bumpTokenStoreRev() {
  try {
    const k = tokenStoreRevKey();
    const v = (parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1;
    localStorage.setItem(k, String(v));
  } catch {}
}

function readTokenStoreRev() {
  try {
    return localStorage.getItem(tokenStoreRevKey()) || "0";
  } catch {
    return "0";
  }
}

function readTokenStore() {
  try {
    const raw = localStorage.getItem(tokenStoreKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeTokenStore(obj) {
  try { localStorage.setItem(tokenStoreKey(), JSON.stringify(obj || {})); } catch {}
  bumpTokenStoreRev();
}

function rememberUserToken({ userId, name, accessToken, primaryImageTag }) {
  if (!userId || !accessToken) return;
  const store = readTokenStore();
  store[userId] = {
    accessToken,
    name: name || store[userId]?.name || "",
    primaryImageTag: primaryImageTag || store[userId]?.primaryImageTag || "",
    ts: Date.now(),
  };
  writeTokenStore(store);
}

function getRememberedToken(userId) {
  const store = readTokenStore();
  const rec = store?.[userId] || null;
  return rec?.accessToken ? rec : null;
}

function hasRememberedQuickLogin() {
  try {
    const store = readTokenStore();
    return Object.values(store || {}).some(rec => !!String(rec?.accessToken || "").trim());
  } catch {
    return false;
  }
}

function forgetRememberedToken(userId) {
  if (!userId) return false;
  try {
    const store = readTokenStore();
    if (store && store[userId]) {
      delete store[userId];
      writeTokenStore(store);
      return true;
    }
  } catch {}
  return false;
}

function clearAllRememberedTokensForServer() {
  const purge = (storage) => {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k) continue;
        if (k.includes("jf_profile_tokens") || k.includes("jf_profile_tokens_rev")) {
          keys.push(k);
        }
      }
      for (const k of keys) {
        try { storage.removeItem(k); } catch {}
      }
    } catch {}
  };

  purge(localStorage);
  purge(sessionStorage);

  try { localStorage.setItem(tokenStoreKey(), "{}"); } catch {}
  try { localStorage.removeItem(tokenStoreRevKey()); } catch {}
}

function pickCredsStorageKey() {
  try {
    if (localStorage.getItem("jellyfin_credentials")) return "jellyfin_credentials";
    if (localStorage.getItem("emby_credentials")) return "emby_credentials";
  } catch {}
  return "jellyfin_credentials";
}

function hardClearJellyfinWebAuth() {
  const key = pickCredsStorageKey();
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}

  try { localStorage.removeItem("accessToken"); } catch {}
  try { sessionStorage.removeItem("accessToken"); } catch {}

  try { localStorage.removeItem("embyToken"); } catch {}
  try { sessionStorage.removeItem("embyToken"); } catch {}

  try { localStorage.removeItem("userId"); } catch {}
  try { sessionStorage.removeItem("userId"); } catch {}

  try { localStorage.removeItem("serverId"); } catch {}
  try { sessionStorage.removeItem("serverId"); } catch {}
}

async function tryServerLogout() {
  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.logout === "function") {
      await ac.logout();
      return true;
    }
  } catch {}
  return false;
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function applyAuthToJellyfinCredentials({ userId, userName, accessToken }) {
  if (!userId || !accessToken) return false;

  const key = pickCredsStorageKey();
  const raw = (() => { try { return localStorage.getItem(key) || ""; } catch { return ""; } })();
  const creds = safeParse(raw) || {};

  try {
    const servers = Array.isArray(creds.Servers) ? creds.Servers : [];
    let target = null;

    const sid =
      creds.ServerId ||
      (typeof localStorage !== "undefined" && (localStorage.getItem("serverId") || sessionStorage.getItem("serverId"))) ||
      null;

    if (sid && servers.length) {
      target = servers.find(s =>
        String(s?.Id || "").trim() === String(sid).trim() ||
        String(s?.SystemId || "").trim() === String(sid).trim()
      ) || null;
    }

    if (!target && servers.length) {
      const baseFromAc = (() => {
        try {
          const ac = window.ApiClient || window.apiClient || null;
          const base =
            (typeof ac?.serverAddress === "function" ? ac.serverAddress() :
             (typeof ac?.serverAddress === "string" ? ac.serverAddress : "")) || "";
          return normalizeBase(base);
        } catch { return ""; }
      })();
      const baseFromLs = (() => {
        try { return normalizeBase(localStorage.getItem("jf_serverAddress") || sessionStorage.getItem("jf_serverAddress") || ""); }
        catch { return ""; }
      })();
      const base = baseFromAc || baseFromLs;

      if (base) {
        target = servers.find(s => {
          const m = normalizeBase(s?.ManualAddress || "");
          const l = normalizeBase(s?.LocalAddress || "");
          return m === base || l === base;
        }) || null;
      }
    }

    if (!target && servers.length) target = servers[0];

    if (target) {
      target.AccessToken = accessToken;
      target.UserId = userId;
      if (userName) target.UserName = userName;
      try { target.DateLastAccessed = new Date().toISOString(); } catch {}
    }
  } catch {}

  try {
    creds.AccessToken = accessToken;
    creds.UserId = userId;
    creds.userId = userId;
    creds.User = creds.User && typeof creds.User === "object" ? creds.User : {};
    creds.User.Id = userId;
    if (userName) creds.User.Name = userName;
  } catch {}

  const normalized = JSON.stringify(creds);
  try { localStorage.setItem(key, normalized); } catch {}
  try { sessionStorage.setItem(key, normalized); } catch {}

  try { localStorage.setItem("accessToken", accessToken); sessionStorage.setItem("accessToken", accessToken); } catch {}
  try { localStorage.setItem("embyToken", accessToken); sessionStorage.setItem("embyToken", accessToken); } catch {}
  try { localStorage.setItem("userId", userId); sessionStorage.setItem("userId", userId); } catch {}

  return true;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = opts.signal || controller.signal;
    return await fetch(url, { ...opts, signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchPublicUsers({ signal } = {}) {
  const url = withServer("/Users/Public");
  const headers = { Accept: "application/json" };
  const res = await fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : (Array.isArray(data?.Items) ? data.Items : []);
}

async function fetchAllUsersAuthed({ signal } = {}) {
  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getUsers === "function") {
      const u = await ac.getUsers().catch(() => null);
      if (Array.isArray(u)) return u;
    }
  } catch {}

  const url = withServer("/Users");
  const headers = { Accept: "application/json" };
  try {
    const ah = getAuthHeader?.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  const res = await fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function fetchUserByIdAuthed(userId, { signal } = {}) {
  if (!userId) return null;

  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getUser === "function") {
      const u = await ac.getUser(userId).catch(() => null);
      if (u && (u.Id || u.id)) return u;
    }
  } catch {}

  const url = withServer(`/Users/${encodeURIComponent(String(userId))}`);
  const headers = { Accept: "application/json" };
  try {
    const ah = getAuthHeader?.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  const res = await fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

async function fetchSessionsAuthed({ signal } = {}) {
  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getSessions === "function") {
      const data = await ac.getSessions().catch(() => null);
      if (Array.isArray(data)) return data;
      const filtered = await ac.getSessions({ ControllableByUserId: "" }).catch(() => null);
      if (Array.isArray(filtered)) return filtered;
    }
  } catch {}

  const url = withServer("/Sessions");
  const headers = { Accept: "application/json" };
  try {
    const ah = getAuthHeader?.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  try {
    const res = await fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function goToMyPreferencesMenu() {
  try { location.hash = "#/mypreferencesmenu"; } catch {}
}

function goToUserProfile(userId) {
  try {
    if (!userId) return;
    const next = `#/userprofile?userId=${encodeURIComponent(String(userId))}`;
    location.hash = next;
  } catch {}
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function userAvatarUrl({ Id, PrimaryImageTag }, size = 220) {
  const id = Id;
  if (!id) return "";

  const qs = new URLSearchParams();
  qs.set("quality", "90");
  qs.set("maxHeight", String(size));
  qs.set("maxWidth", String(size));

  const tag = PrimaryImageTag || "";
  if (tag) qs.set("tag", tag);
  try {
    const token = String(getSessionInfo?.()?.accessToken || "").trim();
    if (token) qs.set("api_key", token);
  } catch {}

  return withServer(`/Users/${encodeURIComponent(String(id))}/Images/Primary?${qs.toString()}`);
}

function avatarFallbackHtml(name, { big = false } = {}) {
  const initial = String(name || "P").slice(0, 1).toUpperCase() || "P";
  return `<div class="jf-profile-fallback${big ? " big" : ""}">${escapeHtml(initial)}</div>`;
}

function avatarSeedForUser(user) {
  const id = String(user?.Id || "").trim();
  const name = String(user?.Name || user?.userName || "").trim();
  return id || name || "profile";
}

function getProfileAvatarRenderSize(slot, fallback = 64) {
  const rect = slot?.getBoundingClientRect?.() || null;
  const measured = Math.round(
    Math.max(
      rect?.width || 0,
      rect?.height || 0,
      slot?.clientWidth || 0,
      slot?.clientHeight || 0
    )
  );
  if (measured > 0) return measured;
  if (slot?.classList?.contains("jf-profile-header-avatar")) return 28;
  if (slot?.classList?.contains("jf-profile-login-avatar")) return 120;
  if (slot?.classList?.contains("jf-profile-avatar")) return 110;
  return Math.min(Math.max(Number(fallback) || 64, 24), 128);
}

function resetProfileAvatarSlotState(slot) {
  if (!slot?.classList) return;
  slot.classList.remove("jf-profile-header-avatar-dicebear");
}

function hasRenderableAvatarContent(slot) {
  if (!slot?.isConnected) return false;
  try {
    return !!slot.querySelector("img, svg, .jf-profile-fallback");
  } catch {
    return false;
  }
}

function isCustomSplashBlockingProfileHeader() {
  try {
    const root = document.documentElement;
    return !!root?.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)
      && !root?.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  } catch {
    return false;
  }
}

function setAvatarFallback(slot, user, { requestId, big = false } = {}) {
  if (!slot) return;
  if (requestId && slot.getAttribute("data-avatar-request") !== requestId) return;
  resetProfileAvatarSlotState(slot);
  slot.innerHTML = avatarFallbackHtml(user?.Name || user?.userName || "P", { big });
}

function loadAvatarIntoSlot(slot, url, { requestId, eager = false, onError } = {}) {
  if (!slot || !url) {
    onError?.();
    return;
  }

  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";

  img.addEventListener("load", () => {
    if (slot.getAttribute("data-avatar-request") !== requestId) return;
    resetProfileAvatarSlotState(slot);
    slot.replaceChildren(img);
  }, { once: true });

  img.addEventListener("error", () => {
    if (slot.getAttribute("data-avatar-request") !== requestId) return;
    onError?.();
  }, { once: true });

  img.src = url;
}

async function assignRandomAvatarToSlot(slot, user, { requestId, eager = false, big = false } = {}) {
  const randomUrl = await getRandomAvatarUrl(avatarSeedForUser(user)).catch(() => "");
  if (!slot || slot.getAttribute("data-avatar-request") !== requestId) return;
  if (!randomUrl) {
    setAvatarFallback(slot, user, { requestId, big });
    return;
  }

  loadAvatarIntoSlot(slot, randomUrl, {
    requestId,
    eager,
    onError: () => setAvatarFallback(slot, user, { requestId, big }),
  });
}

async function assignGeneratedAvatarToSlot(slot, user, { requestId, size = 64 } = {}) {
  if (!slot) return false;
  try {
    if ((getConfig?.() || {}).createAvatar === false) return false;

    const avatar = await createConfiguredUserAvatar(user, {
      size: getProfileAvatarRenderSize(slot, size),
      fitSlot: true,
      scale: 1,
      fixedPosition: false,
      animate: false,
    });

    if (!avatar || slot.getAttribute("data-avatar-request") !== requestId) return false;

    const isSvgAvatar = avatar.tagName?.toLowerCase?.() === "svg";
    const isHeaderDicebear = !!(
      isSvgAvatar &&
      slot.classList?.contains("jf-profile-header-avatar")
    );

    slot.classList.toggle("jf-profile-header-avatar-dicebear", isHeaderDicebear);
    avatar.classList.add("custom-user-avatar", "jf-profile-generated-avatar");
    avatar.style.width = "100%";
    avatar.style.height = "100%";
    avatar.style.maxWidth = "100%";
    avatar.style.maxHeight = "100%";
    avatar.style.margin = "0";
    avatar.style.opacity = "1";
    avatar.style.transition = "none";

    if (isSvgAvatar) {
      avatar.setAttribute("width", "100%");
      avatar.setAttribute("height", "100%");
      avatar.style.display = "block";
    }

    slot.replaceChildren(avatar);
    return true;
  } catch {
    return false;
  }
}

async function assignPreferredFallbackAvatarToSlot(slot, user, opts = {}) {
  const usedGeneratedAvatar = await assignGeneratedAvatarToSlot(slot, user, opts).catch(() => false);
  if (usedGeneratedAvatar) return;
  await assignRandomAvatarToSlot(slot, user, opts);
}

function renderProfileAvatarSlot(slot, user, { size = 220, eager = false, big = false, primaryImageTag } = {}) {
  if (!slot) return;

  const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  slot.setAttribute("data-avatar-request", requestId);
  setAvatarFallback(slot, user, { requestId, big });

  const userId = String(user?.Id || "").trim();
  const tag = String(primaryImageTag ?? user?.PrimaryImageTag ?? "").trim();
  if (!userId) {
    assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catch(() => {});
    return;
  }

  const url = userAvatarUrl({ Id: userId, PrimaryImageTag: tag }, size);
  if (!url) {
    assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catch(() => {});
    return;
  }

  loadAvatarIntoSlot(slot, url, {
    requestId,
    eager,
    onError: () => {
      assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catch(() => {
        setAvatarFallback(slot, user, { requestId, big });
      });
    },
  });
}

function buildOverlayDom(L) {
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "jf-profile-overlay";
  overlay.innerHTML = `
    <div class="jf-profile-shell" role="dialog" aria-modal="true" aria-label="${escapeHtml(L("profileChooserAriaLabel", "Profil seçimi"))}">
      <button class="jf-profile-close" type="button" aria-label="${escapeHtml(L("kapat", "Kapat"))}">✕</button>
      <button class="jf-profile-settings" type="button" aria-label="${escapeHtml(L("ayarlar", "Ayarlar"))}">⚙</button>

      <div class="jf-profile-title">${escapeHtml(L("kimIzliyor", "Kim izliyor?"))}</div>
      <div class="jf-profile-subtitle">${escapeHtml(L("profilSecAlt", "Devam etmek için profil seç."))}</div>

      <div class="jf-profile-grid" role="list"></div>

      <div class="jf-profile-login hidden">
        <div class="jf-profile-login-card">
          <div class="jf-profile-login-avatar"></div>
          <div class="jf-profile-login-name"></div>

          <label class="jf-profile-login-label">${escapeHtml(L("sifre", "Şifre"))}</label>
          <input class="jf-profile-login-input" type="password" autocomplete="current-password" />

          <div class="jf-profile-login-actions">
            <button class="jf-profile-btn secondary" type="button" data-action="back">${escapeHtml(L("geri", "Geri"))}</button>
            <button class="jf-profile-btn primary" type="button" data-action="login">${escapeHtml(L("devam", "Devam"))}</button>
          </div>

          <div class="jf-profile-login-hint"></div>
        </div>
      </div>

      <div class="jf-profile-footer">
        <button class="jf-profile-footer-btn" type="button" data-action="signout">${escapeHtml(L("cikis", "Çıkış"))}</button>
      </div>
    </div>
  `;
  enhanceFormAccessibility(overlay, { prefix: "profile-chooser" });
  return overlay;
}

function installHeaderButton(open, L, { isOverlayOpen } = {}) {
  let installed = false;
  let headerObserver = null;
  let bodyObserver = null;
  let rootObserver = null;
  let cancelled = false;
  let warmupRefreshIds = [];

  let __siCache = null, __siCacheTs = 0;
  const getSessionInfoCached = (ttl = 1500) => {
    const now = Date.now();
    if (__siCache && (now - __siCacheTs) < ttl) return __siCache;
    __siCacheTs = now;
    try { __siCache = getSessionInfo?.() || {}; } catch { __siCache = {}; }
    return __siCache;
  };

  let __tsCache = null, __tsCacheTs = 0;
  let __tsRevSeen = "0";
  const readTokenStoreCached = (ttl = 5000) => {
    const now = Date.now();
    const rev = readTokenStoreRev();
    if (__tsCache && __tsRevSeen === rev && (now - __tsCacheTs) < ttl) return __tsCache;
    __tsCacheTs = now;
    __tsRevSeen = rev;
    __tsCache = readTokenStore();
    return __tsCache;
  };

  function findHeaderRight() {
    return findHeaderMountTarget({ variant: "profile" }).element;
  }

  function clearWarmupRefreshes() {
    for (const timerId of warmupRefreshIds) {
      try { clearTimeout(timerId); } catch {}
    }
    warmupRefreshIds = [];
  }

  function scheduleWarmupRefreshes() {
    clearWarmupRefreshes();
    const placeholder = String(L("profil", "Profil") || "Profil").trim();
    const delays = [120, 420, 900, 1800, 3600, 7200];

    warmupRefreshIds = delays.map((delay) => window.setTimeout(() => {
      if (cancelled) return;
      const btn = document.getElementById(HEADER_BTN_ID);
      if (!btn) return;

      const nameText = String(btn.querySelector(".jf-profile-header-name")?.textContent || "").trim();
      const avatarSlot = btn.querySelector(".jf-profile-header-avatar");
      const needsRefresh =
        !nameText ||
        nameText === placeholder ||
        !hasRenderableAvatarContent(avatarSlot);

      if (needsRefresh) refreshHeaderButton();
    }, delay));
  }

  function waitForElement(selector, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const to = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);

      const origResolve = resolve;
      resolve = (v) => { clearTimeout(to); origResolve(v); };
    });
  }

  const mountOnce = (headerRightEl = null) => {
    if (cancelled) return false;
    const headerTarget = findHeaderMountTarget({ variant: "profile" });
    const headerRight = headerTarget?.element || headerRightEl;
    const headerMode = String(headerTarget?.mode || "unknown").trim() || "unknown";
    if (!headerRight) return false;

    let btn = document.getElementById(HEADER_BTN_ID);
    if (installed && btn && btn.parentElement === headerRight) {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      return true;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = HEADER_BTN_ID;
      btn.type = "button";
      btn.className = "jf-profile-header-btn";
      btn.innerHTML = `
        <span class="jf-profile-header-avatar"></span>
        <span class="jf-profile-header-name"></span>
        <span class="jf-profile-header-caret">▾</span>
      `;
      const avatarSlot = btn.querySelector(".jf-profile-header-avatar");
      const nameSlot = btn.querySelector(".jf-profile-header-name");
      if (avatarSlot && !hasRenderableAvatarContent(avatarSlot)) {
        setAvatarFallback(avatarSlot, { Name: L("profil", "Profil") });
      }
      if (nameSlot && !String(nameSlot.textContent || "").trim()) {
        nameSlot.textContent = L("profil", "Profil");
      }
      btn.setAttribute("aria-label", L("profilDegistir", "Profil değiştir"));
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        open?.({ source: "header" });
      });
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      headerRight.appendChild(btn);
    } else if (btn.parentElement !== headerRight) {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      try { headerRight.appendChild(btn); } catch {}
    } else {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
    }

    try { window.__jmsQueueFeatureCssSync?.({ force: true }); } catch {}

    installed = true;
    scheduleWarmupRefreshes();
    return true;
  };

  const refreshHeaderButton = () => {
    const btn = document.getElementById(HEADER_BTN_ID);
    if (!btn) return;

    const avatarSlot = btn.querySelector(".jf-profile-header-avatar");
    const nameSlot = btn.querySelector(".jf-profile-header-name");
    const hasSettledHeaderState =
      !!String(nameSlot?.textContent || "").trim()
      && hasRenderableAvatarContent(avatarSlot);
    if (typeof isOverlayOpen === "function" && isOverlayOpen() && hasSettledHeaderState) return;

    const si = getSessionInfoCached(1500);
    const userId = String(si.userId || "").trim();
    const userName = String(si?.UserName || si?.User?.Name || si?.userName || "").trim();
    const accessToken = String(si?.accessToken || "").trim();
    const authState =
      accessToken || (typeof isAuthReadyStrict === "function" && isAuthReadyStrict())
        ? "ready"
        : "cold";
    const splashState = isCustomSplashBlockingProfileHeader() ? "splash" : "live";

    if (nameSlot) {
      const next = userName || L("profil", "Profil");
      if (nameSlot.textContent !== next) nameSlot.textContent = next;
    }

    if (avatarSlot) {
      const store = readTokenStoreCached(5000);
      const rec = userId ? store?.[userId] : null;
      const tag = rec?.primaryImageTag || "";
      const nextKey = `${userId}|${userName}|${tag}|${authState}|${splashState}`;
      const prev = avatarSlot.getAttribute("data-avatar-key") || "";
      const shouldForceRefresh = !hasRenderableAvatarContent(avatarSlot);
      if (prev !== nextKey || shouldForceRefresh) {
        avatarSlot.setAttribute("data-avatar-key", nextKey);
        renderProfileAvatarSlot(
          avatarSlot,
          { Id: userId, Name: userName, PrimaryImageTag: tag },
          { size: 64, eager: true }
        );
      }
    }
  };

  const tick = timeoutThrottle(() => {
    if (cancelled) return;
    if (!document.getElementById(HEADER_BTN_ID)) mountOnce();
    refreshHeaderButton();
  }, 350);

  const onHash = () => tick();
  window.addEventListener("hashchange", onHash);

  (async () => {
    try {
      const headerRight =
        findHeaderRight() ||
        await waitForElement(getHeaderMountWaitSelector("profile"), 10000);
      if (cancelled) return;
      mountOnce(headerRight);
      refreshHeaderButton();

      try {
        headerObserver?.disconnect?.();
        headerObserver = new MutationObserver(() => {
          if (cancelled) return;
          if (!document.getElementById(HEADER_BTN_ID)) mountOnce(headerRight);
        });
        headerObserver.observe(headerRight, { childList: true, subtree: false });
      } catch {}

      try {
        bodyObserver?.disconnect?.();
        const onBodyMut = timeoutThrottle(() => {
          if (cancelled) return;
          const hr = findHeaderRight();
          if (!hr) return;
          if (hr !== headerRight) {
            try { headerObserver?.disconnect?.(); } catch {}
            try {
              headerObserver = new MutationObserver(() => {
                if (cancelled) return;
                if (!document.getElementById(HEADER_BTN_ID)) mountOnce(hr);
              });
              headerObserver.observe(hr, { childList: true, subtree: false });
            } catch {}
            mountOnce(hr);
            refreshHeaderButton();
          }
        }, 300);

        bodyObserver = new MutationObserver(() => onBodyMut());
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      } catch {}

      try {
        const root = document.documentElement;
        if (root && typeof MutationObserver === "function") {
          rootObserver?.disconnect?.();
          rootObserver = new MutationObserver(() => {
            if (cancelled) return;
            tick();
          });
          rootObserver.observe(root, {
            attributes: true,
            attributeFilter: [CUSTOM_SPLASH_ACTIVE_ATTR, CUSTOM_SPLASH_HIDDEN_ATTR],
          });
        }
      } catch {}
    } catch {
      tick();
    }
  })();

  return () => {
    cancelled = true;
    clearWarmupRefreshes();
    try { window.removeEventListener("hashchange", onHash); } catch {}
    try { headerObserver?.disconnect?.(); } catch {}
    try { bodyObserver?.disconnect?.(); } catch {}
    try { rootObserver?.disconnect?.(); } catch {}
  };
}

async function authenticateByName(userName, password) {
  const ac = window.ApiClient || window.apiClient || null;

  if (ac && typeof ac.authenticateUserByName === "function") {
    return await ac.authenticateUserByName(userName, password);
  }

  const url = withServer("/Users/AuthenticateByName");
  const res = await fetch(url, {
    method: "POST",
    headers: (() => {
      const h = { "Content-Type": "application/json", Accept: "application/json" };
      try { const ah = getAuthHeader?.(); if (ah) h["Authorization"] = ah; } catch {}
      return h;
    })(),
    body: JSON.stringify({ Username: userName, Pw: password || "" }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Login başarısız (${res.status}) ${t}`.trim());
  }
  return await res.json();
}

function pauseBackground() {
  try { document.documentElement.dataset.jmsProfileChooserOpen = "1"; } catch {}
  try { window.__jmsHomeTabPaused = true; } catch {}
}
function resumeBackground() {
  try { delete document.documentElement.dataset.jmsProfileChooserOpen; } catch {}
}

export function initProfileChooser(options = {}) {
  if (isSafeMode()) return () => {};

  const cfg = (() => {
    try { return (typeof getConfig === "function" ? getConfig() : {}) || {}; } catch { return {}; }
  })();

  const L = (key, fallback = "") =>
    (cfg.languageLabels && cfg.languageLabels[key]) || fallback;

  if (cfg.enableProfileChooser === false) return () => {};

  syncProfileChooserHeaderButtonVisibility(true);

  const autoOpen = options.autoOpen ?? (cfg.profileChooserAutoOpen !== false);
  const autoOpenRequireQuickLogin = cfg.profileChooserAutoOpenRequireQuickLogin !== false;
  const rememberTokens = cfg.profileChooserRememberTokens !== false;

  let overlay = null;
  let cleanupHeader = null;
  let destroyed = false;
  let pendingSplashWaitPromise = null;
  let finishPendingSplashWait = null;

  let currentList = [];
  let currentUserId = "";
  let currentUserName = "";
  let refreshInFlight = null;
  const presenceByUserId = new Map();
  let overlayPresenceTimer = null;

  function presenceScore(p) {
    if (!p) return 0;
    if (p.isPlaying) return 4;
    if (p.isPaused) return 3;
    if (p.title) return 2;
    if (p.online) return 1;
    return 0;
  }

  const state = {
    mode: "grid",
    selectedUser: null,
  };

  function clearPendingSplashWait(reason = "aborted") {
    try { finishPendingSplashWait?.(reason); } catch {}
  }

  function waitForCustomSplashToClear() {
    if (!isCustomSplashBlockingProfileHeader()) {
      return Promise.resolve("clear");
    }
    if (pendingSplashWaitPromise) return pendingSplashWaitPromise;

    pendingSplashWaitPromise = new Promise((resolve) => {
      let settled = false;
      let observer = null;

      const cleanup = () => {
        try { observer?.disconnect?.(); } catch {}
        observer = null;
        if (finishPendingSplashWait === finish) {
          finishPendingSplashWait = null;
        }
        pendingSplashWaitPromise = null;
      };

      const finish = (reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(reason);
      };

      const syncState = () => {
        if (destroyed) {
          finish("aborted");
          return true;
        }
        if (!isCustomSplashBlockingProfileHeader()) {
          finish("clear");
          return true;
        }
        return false;
      };

      finishPendingSplashWait = finish;

      if (syncState()) return;

      const root = document.documentElement;
      if (!root || typeof MutationObserver !== "function") {
        finish("unsupported");
        return;
      }

      observer = new MutationObserver(() => {
        syncState();
      });

      try {
        observer.observe(root, {
          attributes: true,
          attributeFilter: [CUSTOM_SPLASH_ACTIVE_ATTR, CUSTOM_SPLASH_HIDDEN_ATTR],
        });
      } catch {
        finish("observe-failed");
        return;
      }

      syncState();
    });

    return pendingSplashWaitPromise;
  }

  const isOverlayOpen = () => !!overlay;

  let __avatarSyncTs = 0;
  async function syncCurrentUserAvatarTagOnce(minIntervalMs = 15000) {
    try {
      const now = Date.now();
      if ((now - __avatarSyncTs) < minIntervalMs) return;
      __avatarSyncTs = now;

      if (!(typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false)) return;

      const si = getSessionInfo?.() || {};
      const uid = String(si.userId || "").trim();
      if (!uid) return;

      const u = await fetchUserByIdAuthed(uid).catch(() => null);
      const newTag = String(u?.PrimaryImageTag || "").trim();
      if (!newTag) return;

      const store = readTokenStore();
      const cur = store?.[uid] || null;
      const oldTag = String(cur?.primaryImageTag || "").trim();
      if (newTag === oldTag) return;

      store[uid] = {
        accessToken: cur?.accessToken || "",
        name: cur?.name || String(u?.Name || "").trim() || "",
        primaryImageTag: newTag,
        ts: Date.now(),
      };
      writeTokenStore(store);
    } catch {}
  }

  const close = () => {
    if (!overlay) return;
    try { clearInterval(overlayPresenceTimer); } catch {}
    overlayPresenceTimer = null;

    try { window.removeEventListener("keydown", onKeydown); } catch {}
    try { overlay.removeEventListener("click", onOverlayClick); } catch {}
    try { overlay.removeEventListener("click", onOverlayDelegatedClick); } catch {}

    overlay.classList.remove("open");
    overlay.remove();
    overlay = null;

    state.mode = "grid";
    state.selectedUser = null;

    resumeBackground();
  };

  function onKeydown(e) {
    if (!overlay) return;
    if (e.key === "Escape") close();
  }

  function onOverlayClick(e) {
    if (!overlay) return;
    if (e.target === overlay) close();
  }

  function getInstalledHeaderMode() {
    const mountedMode = String(
      document.getElementById(HEADER_BTN_ID)?.getAttribute("data-jfpc-header-mode") || ""
    ).trim();
    if (mountedMode) return mountedMode;
    try {
      return String(findHeaderMountTarget({ variant: "profile" })?.mode || "").trim() || "unknown";
    } catch {
      return "unknown";
    }
  }

  function openMuiUserMenuFromHeader() {
    if (getInstalledHeaderMode() !== "mui-user") return false;

    let trigger = null;
    try {
      const mountTarget = findHeaderMountTarget({ variant: "profile" })?.element || null;
      trigger =
        mountTarget?.querySelector?.(MUI_USER_MENU_TRIGGER_SELECTOR) ||
        document.querySelector(MUI_USER_MENU_TRIGGER_SELECTOR);
    } catch {}

    if (!trigger) return false;

    close();
    requestAnimationFrame(() => {
      try { trigger.click(); } catch {}
    });
    return true;
  }

  function goSettings() {
    if (openMuiUserMenuFromHeader()) return;
    goToMyPreferencesMenu();
    close();
  }

  async function refreshUsers() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      currentUserId = "";
      currentUserName = "";
      try {
        const si = getSessionInfo?.() || {};
        currentUserId = String(si.userId || "").trim();
        currentUserName = String(si?.UserName || si?.User?.Name || si?.userName || "").trim();
      } catch {}

      let users = await fetchPublicUsers().catch(() => []);

      if (users.length <= 1) {
        try {
          const ready = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false);
          if (ready) {
            await waitForAuthReadyStrict?.(2000).catch(() => {});
            const more = await fetchAllUsersAuthed().catch(() => []);
            if (more.length > users.length) users = more;
          }
        } catch {}
      }

      currentList = users
        .filter(u => (u?.Id || u?.id) && (u?.Name || u?.name))
        .map(u => ({
          Id: String(u.Id || u.id),
          Name: String(u.Name || u.name),
          HasPassword: !!u.HasPassword,
          PrimaryImageTag: u.PrimaryImageTag || "",
        }));

      if (!currentList.length && currentUserId) {
        currentList = [{
          Id: currentUserId,
          Name: currentUserName || L("profil", "Profil"),
          HasPassword: false,
          PrimaryImageTag: "",
        }];
      }

      presenceByUserId.clear();
      try {
        const ready = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false);
        if (ready) {
          const sessions = await fetchSessionsAuthed().catch(() => []);
          for (const s of (Array.isArray(sessions) ? sessions : [])) {
            const sid = String(s?.UserId || "").trim();
            if (!sid) continue;
            const nowPlaying = s?.NowPlayingItem || null;
            const isPaused = !!s?.PlayState?.IsPaused;
            const isPlaying = !!(nowPlaying && !isPaused);
            const mediaType = String(nowPlaying?.MediaType || "").trim().toLowerCase();
            const itemType = String(nowPlaying?.Type || "").trim().toLowerCase();
            const isAudio = mediaType === "audio" || itemType === "audio";
            const series = String(nowPlaying?.SeriesName || "").trim();
            const name = String(nowPlaying?.Name || "").trim();
            const original = String(nowPlaying?.OriginalTitle || "").trim();
            const album = String(nowPlaying?.Album || "").trim();
            const title = [series, name, original, album].filter(Boolean)[0] || "";
            const next = {
              online: true,
              isPlaying,
              isPaused: !!(nowPlaying && isPaused),
              isAudio,
              title: String(title).trim(),
            };

            const prev = presenceByUserId.get(sid) || null;
            if (!prev || presenceScore(next) >= presenceScore(prev)) {
              presenceByUserId.set(sid, next);
            } else if (prev.online !== true) {
              prev.online = true;
              presenceByUserId.set(sid, prev);
            }
          }
        }
      } catch {}

      if (rememberTokens && currentUserId && currentUserName) {
        try {
          const store = readTokenStore();
          const rev = readTokenStoreRev();
          if (store[currentUserId] && !store[currentUserId].name) {
            store[currentUserId].name = currentUserName;
            writeTokenStore(store);
          }
        } catch {}
      }

      return currentList;
    })().finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  }

  function renderGridOnce() {
    if (!overlay) return;
    const grid = overlay.querySelector(".jf-profile-grid");
    if (!grid) return;

    const store = readTokenStore();
    const rev = readTokenStoreRev();
    const usersById = new Map();
    const html = currentList.map(u => {
      const id = u.Id;
      const name = u.Name;
      usersById.set(String(id), u);
      const isCurrent = currentUserId && id === currentUserId;
      const remembered = !!store?.[id]?.accessToken;
      const presence = presenceByUserId.get(id) || null;
      const isOnline = !!presence?.online;
      const isPlaying = !!presence?.isPlaying;
      const isPaused = !!presence?.isPaused;
      const isAudio = !!presence?.isAudio;
      const statusTitle = String(presence?.title || "").trim();
      const showPlayback = !!(statusTitle || isPlaying || isPaused);

      return `
        <button class="jf-profile-tile ${isCurrent ? "is-current" : ""}" type="button"
          data-user-id="${escapeHtml(id)}" role="listitem">
          ${isCurrent ? `
            <span
              class="jf-profile-current-settings"
              role="button"
              tabindex="0"
              data-action="userprofile"
              data-user-id="${escapeHtml(id)}"
              aria-label="${escapeHtml(L("profilSayfasi", "Profil sayfası"))}"
              title="${escapeHtml(L("profilSayfasi", "Profil sayfası"))}"
            >⚙</span>
          ` : ``}
          <div class="jf-profile-avatar">${avatarFallbackHtml(name)}</div>

          <div class="jf-profile-name">${escapeHtml(name)}</div>

          <div class="jf-profile-badges">
            ${isOnline ? `
              <span class="jf-profile-badge-active jfpc-chip">
                <span class="jf-profile-dot-online" aria-hidden="true"></span>
                ${escapeHtml(L("cevrimici", "Çevrimiçi"))}
              </span>
            ` : ``}
            ${remembered ? `
              <span class="jf-profile-badge jfpc-chip">${escapeHtml(L("hizli", "Hızlı"))}</span>
              <span
                class="jf-profile-forget jfpc-chip"
                role="button"
                tabindex="0"
                data-action="forget"
                data-user-id="${escapeHtml(id)}"
                aria-label="${escapeHtml(L("hizliyiKaldir", "Hızlı girişi kaldır"))}"
                title="${escapeHtml(L("hizliyiKaldir", "Hızlı girişi kaldır"))}"
              >✕ </span>
            ` : ``}
          </div>
          ${showPlayback ? `
            <div class="jf-profile-now-playing" title="${escapeHtml(statusTitle || "")}">
              ${escapeHtml(
                isPaused
                  ? L("duraklatildi", "Duraklatıldı")
                  : (isAudio ? L("dinliyor", "Dinliyor") : L("izliyor", "İzliyor"))
              )}
              ${statusTitle ? `: ${escapeHtml(statusTitle)}` : ""}
            </div>
          ` : ``}
        </button>
      `;
    }).join("");

    const prev = grid.getAttribute("data-render-hash") || "";
    const nextHash = String(html.length) + ":" + String(currentList.length) + ":" + String(currentUserId || "") + ":" + String(rev);
    if (prev !== nextHash) {
      grid.setAttribute("data-render-hash", nextHash);
      grid.innerHTML = html;
    }

    grid.querySelectorAll(".jf-profile-tile").forEach((tile) => {
      const id = String(tile.getAttribute("data-user-id") || "").trim();
      const user = usersById.get(id);
      const slot = tile.querySelector(".jf-profile-avatar");
      if (!user || !slot) return;

      const tag = store?.[id]?.primaryImageTag || user.PrimaryImageTag || "";
      const nextKey = `${id}|${tag}`;
      const prevKey = slot.getAttribute("data-avatar-key") || "";
      if (prevKey === nextKey) return;

      slot.setAttribute("data-avatar-key", nextKey);
      renderProfileAvatarSlot(
        slot,
        { ...user, PrimaryImageTag: tag },
        { size: 240 }
      );
    });
  }

  function showGrid() {
    if (!overlay) return;
    state.mode = "grid";
    overlay.classList.remove("mode-login");
    overlay.querySelector(".jf-profile-login")?.classList.add("hidden");
    overlay.querySelector(".jf-profile-grid")?.classList.remove("hidden");
    renderGridOnce();
  }

  function showLogin(user, { hint = "" } = {}) {
    if (!overlay) return;
    state.mode = "login";
    state.selectedUser = user;

    overlay.classList.add("mode-login");
    overlay.querySelector(".jf-profile-login")?.classList.remove("hidden");
    overlay.querySelector(".jf-profile-grid")?.classList.add("hidden");

    const cardAvatar = overlay.querySelector(".jf-profile-login-avatar");
    const cardName = overlay.querySelector(".jf-profile-login-name");
    const hintEl = overlay.querySelector(".jf-profile-login-hint");
    const input = overlay.querySelector(".jf-profile-login-input");

    const store = readTokenStore();
    const tag = store?.[user.Id]?.primaryImageTag || user.PrimaryImageTag || "";
    if (cardAvatar) {
      renderProfileAvatarSlot(
        cardAvatar,
        { ...user, PrimaryImageTag: tag },
        { size: 220, big: true }
      );
    }
    if (cardName) cardName.textContent = user.Name;
    if (hintEl) hintEl.textContent = hint || "";
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 50);
    }
  }

  async function loginAndSwitch(user, password) {
    if (!user?.Name) return;

    try { overlay?.classList.add("busy"); } catch {}
    try {
      const resp = await authenticateByName(user.Name, password);

      const accessToken = resp?.AccessToken || resp?.accessToken || resp?.Token || "";
      const u = resp?.User || resp?.user || {};
      const userId = String(u?.Id || user.Id || "").trim();
      const userName = String(u?.Name || user.Name || "").trim();
      const primaryImageTag = u?.PrimaryImageTag || "";

      if (!accessToken || !userId) throw new Error(L("loginEksikYanıt", "Login yanıtı eksik (token/userId)"));

      if (rememberTokens) {
        rememberUserToken({ userId, name: userName, accessToken, primaryImageTag });
      }

      applyAuthToJellyfinCredentials({ userId, userName, accessToken });

      try { saveCredentials?.(resp); } catch {}
      try { saveApiKey?.(accessToken); } catch {}
      try { persistAuthSnapshotFromApiClient?.(); } catch {}

      try { localStorage.setItem(LAST_PICK_KEY, userId); } catch {}

      close();
      try { location.reload(); } catch {}
    } catch (e) {
      const msg = String(e?.message || L("loginBasarisiz", "Login başarısız"));
      showLogin(user, { hint: msg });
    } finally {
      try { overlay?.classList.remove("busy"); } catch {}
    }
  }

  async function onPickUserById(userId) {
    const user = currentList.find(u => u.Id === userId) || null;
    if (!user) return;

    if (currentUserId && user.Id === currentUserId) {
      try { localStorage.setItem(LAST_PICK_KEY, user.Id); } catch {}
      close();
      return;
    }

    const remembered = getRememberedToken(user.Id);
    if (remembered?.accessToken) {
      applyAuthToJellyfinCredentials({
        userId: user.Id,
        userName: remembered.name || user.Name,
        accessToken: remembered.accessToken,
      });

      try {
        const u = await fetchUserByIdAuthed(user.Id).catch(() => null);
        const newTag = u?.PrimaryImageTag || "";
        if (newTag) {
          rememberUserToken({
            userId: user.Id,
            name: remembered.name || user.Name,
            accessToken: remembered.accessToken,
            primaryImageTag: newTag,
          });
        }
      } catch {}

      try { localStorage.setItem(LAST_PICK_KEY, user.Id); } catch {}
      close();
      try { location.reload(); } catch {}
      return;
    }

    if (!user.HasPassword) {
      await loginAndSwitch(user, "");
      return;
    }

    showLogin(user, { hint: L("profilSifreIstiyor", "Bu profil şifre istiyor.") });
  }

  async function submitLogin() {
    const user = state.selectedUser;
    if (!user) return;
    const input = overlay?.querySelector(".jf-profile-login-input");
    const pw = input ? String(input.value || "") : "";
    await loginAndSwitch(user, pw);
  }

  function onOverlayDelegatedClick(e) {
    if (!overlay) return;
    const t = e.target;

    const actionBtn = t?.closest?.("[data-action]");
    if (actionBtn) {
      const action = actionBtn.getAttribute("data-action");
      if (action === "back") { showGrid(); return; }
      if (action === "login") { submitLogin().catch(() => {}); return; }
      if (action === "forget") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}

        const uid = actionBtn.getAttribute("data-user-id") || "";
        if (uid) {
          forgetRememberedToken(uid);
          renderGridOnce();
        }
        return;
      }
      if (action === "userprofile") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        const uid = actionBtn.getAttribute("data-user-id") || "";
        if (uid) {
          goToUserProfile(uid);
          close();
        }
        return;
      }
      if (action === "signout") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        (async () => {
          await tryServerLogout().catch(() => {});
          try { clearCredentials?.(); } catch {}
          hardClearJellyfinWebAuth();
          clearAllRememberedTokensForServer();
          try { localStorage.removeItem(LAST_PICK_KEY); } catch {}
          try { sessionStorage.removeItem(AUTOOPEN_FLAG); } catch {}
          close();
          try { location.reload(); } catch {}
        })();
        return;
      }
      return;
    }

    const tile = t?.closest?.(".jf-profile-tile");
    if (tile) {
      const uid = tile.getAttribute("data-user-id");
      if (uid) onPickUserById(uid).catch(() => {});
      return;
    }
  }

  const open = async ({ source = "auto" } = {}) => {
    if (destroyed || overlay) return;

    const shouldWaitForSplash = source === "auto" || source === "auto-preauth";
    if (shouldWaitForSplash && isCustomSplashBlockingProfileHeader()) {
      await waitForCustomSplashToClear().catch(() => {});
      if (destroyed || overlay || isCustomSplashBlockingProfileHeader()) return;
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      if (destroyed || overlay || isCustomSplashBlockingProfileHeader()) return;
    }

    pauseBackground();

    overlay = buildOverlayDom(L);
    document.body.appendChild(overlay);
    try { overlay.classList.add("busy"); } catch {}
    requestAnimationFrame(() => overlay?.classList.add("open"));

    overlay.querySelector(".jf-profile-close")?.addEventListener("click", close);
    overlay.querySelector(".jf-profile-settings")?.addEventListener("click", (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch {}
      goSettings();
    });
    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("click", onOverlayDelegatedClick);
    window.addEventListener("keydown", onKeydown, { once: false });

    overlay.querySelector(".jf-profile-login-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitLogin().catch(() => {});
    });

    await refreshUsers().catch(() => {});
    await syncCurrentUserAvatarTagOnce().catch(() => {});
    showGrid();
    try { overlay?.classList.remove("busy"); } catch {}

    try { clearInterval(overlayPresenceTimer); } catch {}
    overlayPresenceTimer = setInterval(async () => {
      try {
        if (!overlay || state.mode !== "grid") return;
        await refreshUsers().catch(() => {});
        renderGridOnce();
      } catch {}
    }, 15000);

    (async () => {
      try {
        if (!overlay) return;
        if (typeof waitForAuthReadyStrict === "function") {
          await waitForAuthReadyStrict(6000).catch(() => {});
        } else {
          await new Promise(r => setTimeout(r, 1200));
        }
        if (!overlay) return;
        await refreshUsers().catch(() => {});
        if (!overlay) return;
        renderGridOnce();
        try { overlay.classList.remove("busy"); } catch {}
      } catch {}
    })();
  };

  cleanupHeader = installHeaderButton(open, L, { isOverlayOpen });

  const onHashSync = () => { syncCurrentUserAvatarTagOnce().catch(() => {}); };
  const onFocusSync = () => {
    writeLastActiveTs();
    syncCurrentUserAvatarTagOnce().catch(() => {});
  };
  const onVisSync = () => {
    try {
      if (!document.hidden) {
        writeLastActiveTs();
        syncCurrentUserAvatarTagOnce().catch(() => {});
      }
    } catch {}
  };

  const markActive = rafThrottle(() => writeLastActiveTs());

  window.addEventListener("hashchange", onHashSync);
  window.addEventListener("focus", onFocusSync);
  document.addEventListener("visibilitychange", onVisSync);
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive);
  window.addEventListener("mousemove", markActive, { passive: true });
  window.addEventListener("scroll", markActive, { passive: true });

  const avatarSyncInterval = setInterval(() => {
    syncCurrentUserAvatarTagOnce().catch(() => {});
  }, 60000);

  setTimeout(() => { syncCurrentUserAvatarTagOnce().catch(() => {}); }, 2500);

  if (autoOpen) {
    try {
      const already = sessionStorage.getItem(AUTOOPEN_FLAG) === "1";
      const lastActive = readLastActiveTs();
      const inactiveLongEnough = !lastActive || (Date.now() - lastActive) >= AUTOOPEN_INACTIVITY_MS;
      const quickLoginReady = !autoOpenRequireQuickLogin || hasRememberedQuickLogin();
      if (!already && inactiveLongEnough && quickLoginReady) {
        const source = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false)
          ? "auto"
          : "auto-preauth";
        try { sessionStorage.setItem(AUTOOPEN_FLAG, "1"); } catch {}
        setTimeout(() => { open({ source }).catch(() => {}); }, 0);
      }
    } catch {}
  }

  writeLastActiveTs();

  const onStorage = timeoutThrottle((e) => {
    if (!e) return;
    const k = String(e.key || "");
    if (!k) return;
    if (k.includes("credentials") || k === "userId" || k === "accessToken") {
      if (!document.getElementById(HEADER_BTN_ID)) {
        try { cleanupHeader?.(); } catch {}
        try { cleanupHeader = installHeaderButton(open, L, { isOverlayOpen }); } catch {}
      }
    }
  }, 500);

  window.addEventListener("storage", onStorage);

  return () => {
    destroyed = true;
    clearPendingSplashWait();
    try { window.removeEventListener("storage", onStorage); } catch {}
    try { window.removeEventListener("hashchange", onHashSync); } catch {}
    try { window.removeEventListener("focus", onFocusSync); } catch {}
    try { document.removeEventListener("visibilitychange", onVisSync); } catch {}
    try { window.removeEventListener("pointerdown", markActive); } catch {}
    try { window.removeEventListener("keydown", markActive); } catch {}
    try { window.removeEventListener("mousemove", markActive); } catch {}
    try { window.removeEventListener("scroll", markActive); } catch {}
    try { clearInterval(avatarSyncInterval); } catch {}
    try { clearInterval(overlayPresenceTimer); } catch {}
    try { cleanupHeader?.(); } catch {}
    try { window.removeEventListener("keydown", onKeydown); } catch {}
    try { cleanupLegacyHeaderUserButtonHidden(); } catch {}
    try { close(); } catch {}
  };
}
