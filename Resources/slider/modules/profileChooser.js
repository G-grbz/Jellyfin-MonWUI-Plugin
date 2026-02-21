import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import {
  getSessionInfo,
  isAuthReadyStrict,
  waitForAuthReadyStrict,
  persistAuthSnapshotFromApiClient,
  getAuthHeader,
} from "./api.js";
import { saveCredentials, saveApiKey, clearCredentials } from "../auth.js";

const OVERLAY_ID = "jfProfileChooserOverlay";
const HEADER_BTN_ID = "jfProfileChooserBtn";
const TOKEN_STORE_PREFIX = "jf_profile_tokens_v1::";
const TOKEN_STORE_REV_KEY = "jf_profile_tokens_rev::";
const AUTOOPEN_FLAG = "jf_profileChooser_autoopened";
const LAST_PICK_KEY = "jf_profileChooser_lastUser";

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

function ensureLegacyHeaderUserButtonHidden() {
  if (document.getElementById(LEGACY_HIDE_STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = LEGACY_HIDE_STYLE_ID;
  st.textContent = `
    .headerUserButtonRound { display: none !important; }
  `;
  (document.head || document.documentElement).appendChild(st);
}

function cleanupLegacyHeaderUserButtonHidden() {
  const st = document.getElementById(LEGACY_HIDE_STYLE_ID);
  if (st) st.remove();
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

function pickCredsStorageKey() {
  try {
    if (localStorage.getItem("jellyfin_credentials")) return "jellyfin_credentials";
    if (localStorage.getItem("emby_credentials")) return "emby_credentials";
  } catch {}
  return "jellyfin_credentials";
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
    if (ah) headers["X-Emby-Authorization"] = ah;
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
    if (ah) headers["X-Emby-Authorization"] = ah;
  } catch {}
  const res = await fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

function goToMyPreferencesMenu() {
  try { location.hash = "#/mypreferencesmenu"; } catch {}
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

  return withServer(`/Users/${encodeURIComponent(String(id))}/Images/Primary?${qs.toString()}`);
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
  return overlay;
}

function installHeaderButton(open, L, { isOverlayOpen } = {}) {
  let installed = false;
  let headerObserver = null;
  let bodyObserver = null;
  let cancelled = false;

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
    return (
      document.querySelector(".skinHeader .headerRight") ||
      document.querySelector(".skinHeader .headerButtons") ||
      document.querySelector(".headerRight") ||
      null
    );
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
    if (installed && document.getElementById(HEADER_BTN_ID)) return true;

    const headerRight = headerRightEl || findHeaderRight();
    if (!headerRight) return false;

    let btn = document.getElementById(HEADER_BTN_ID);
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
      btn.setAttribute("aria-label", L("profilDegistir", "Profil değiştir"));
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        open?.({ source: "header" });
      });
      headerRight.appendChild(btn);
    } else if (btn.parentElement !== headerRight) {
      try { headerRight.appendChild(btn); } catch {}
    }

    installed = true;
    return true;
  };

  const refreshHeaderButton = () => {
    if (typeof isOverlayOpen === "function" && isOverlayOpen()) return;

    const btn = document.getElementById(HEADER_BTN_ID);
    if (!btn) return;

    const avatarSlot = btn.querySelector(".jf-profile-header-avatar");
    const nameSlot = btn.querySelector(".jf-profile-header-name");

    const si = getSessionInfoCached(1500);
    const userId = String(si.userId || "").trim();
    const userName = String(si?.UserName || si?.User?.Name || si?.userName || "").trim();

    if (nameSlot) {
      const next = userName || L("profil", "Profil");
      if (nameSlot.textContent !== next) nameSlot.textContent = next;
    }

    const store = readTokenStoreCached(5000);
    const rec = userId ? store?.[userId] : null;
    const tag = rec?.primaryImageTag || "";

    const url = userId ? userAvatarUrl({ Id: userId, PrimaryImageTag: tag }, 64) : "";

    if (avatarSlot) {
      const prev = avatarSlot.getAttribute("data-url") || "";
      if (prev !== url) {
        avatarSlot.setAttribute("data-url", url);
        avatarSlot.innerHTML = url
          ? `<img alt="" src="${escapeHtml(url)}" loading="eager" decoding="async" />`
          : `<div class="jf-profile-fallback">${escapeHtml((userName || "P").slice(0,1).toUpperCase())}</div>`;
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
        await waitForElement(".skinHeader .headerRight, .skinHeader .headerButtons, .headerRight", 10000);
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
    } catch {
      tick();
    }
  })();

  return () => {
    cancelled = true;
    try { window.removeEventListener("hashchange", onHash); } catch {}
    try { headerObserver?.disconnect?.(); } catch {}
    try { bodyObserver?.disconnect?.(); } catch {}
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
      try { const ah = getAuthHeader?.(); if (ah) h["X-Emby-Authorization"] = ah; } catch {}
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

  ensureLegacyHeaderUserButtonHidden();

  const autoOpen = options.autoOpen ?? (cfg.profileChooserAutoOpen !== false);
  const rememberTokens = cfg.profileChooserRememberTokens !== false;

  let overlay = null;
  let cleanupHeader = null;

  let currentList = [];
  let currentUserId = "";
  let currentUserName = "";
  let refreshInFlight = null;

  const state = {
    mode: "grid",
    selectedUser: null,
  };

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

  function goSettings() {
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
    const html = currentList.map(u => {
      const id = u.Id;
      const name = u.Name;
      const isCurrent = currentUserId && id === currentUserId;
      const remembered = !!store?.[id]?.accessToken;

      const tag = store?.[id]?.primaryImageTag || u.PrimaryImageTag || "";
      const avatar = userAvatarUrl({ Id: id, PrimaryImageTag: tag }, 240);

      return `
        <button class="jf-profile-tile ${isCurrent ? "is-current" : ""}" type="button"
          data-user-id="${escapeHtml(id)}" role="listitem">
          <div class="jf-profile-avatar">
            ${avatar
              ? `<img alt="" src="${escapeHtml(avatar)}" loading="lazy" decoding="async" />`
              : `<div class="jf-profile-fallback">${escapeHtml(name.slice(0,1).toUpperCase())}</div>`
            }
          </div>

          <div class="jf-profile-name">${escapeHtml(name)}</div>

          <div class="jf-profile-badges">
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
        </button>
      `;
    }).join("");

    const prev = grid.getAttribute("data-render-hash") || "";
    const nextHash = String(html.length) + ":" + String(currentList.length) + ":" + String(currentUserId || "") + ":" + String(rev);
    if (prev !== nextHash) {
      grid.setAttribute("data-render-hash", nextHash);
      grid.innerHTML = html;
    }
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
    const avatar = userAvatarUrl({ Id: user.Id, PrimaryImageTag: tag }, 220);

    if (cardAvatar) {
      cardAvatar.innerHTML = avatar
        ? `<img alt="" src="${escapeHtml(avatar)}" decoding="async" />`
        : `<div class="jf-profile-fallback big">${escapeHtml(user.Name.slice(0,1).toUpperCase())}</div>`;
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
      if (action === "signout") {
        try { clearCredentials?.(); } catch {}
        try { localStorage.removeItem(LAST_PICK_KEY); sessionStorage.removeItem(AUTOOPEN_FLAG); } catch {}
        close();
        try { location.reload(); } catch {}
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
    if (overlay) return;

    pauseBackground();

    overlay = buildOverlayDom(L);
    document.body.appendChild(overlay);

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
      } catch {}
    })();

    requestAnimationFrame(() => overlay?.classList.add("open"));
  };

  cleanupHeader = installHeaderButton(open, L, { isOverlayOpen });

  const onHashSync = () => { syncCurrentUserAvatarTagOnce().catch(() => {}); };
  const onFocusSync = () => { syncCurrentUserAvatarTagOnce().catch(() => {}); };
  const onVisSync = () => {
    try { if (!document.hidden) syncCurrentUserAvatarTagOnce().catch(() => {}); } catch {}
  };

  window.addEventListener("hashchange", onHashSync);
  window.addEventListener("focus", onFocusSync);
  document.addEventListener("visibilitychange", onVisSync);

  const avatarSyncInterval = setInterval(() => {
    syncCurrentUserAvatarTagOnce().catch(() => {});
  }, 60000);

  setTimeout(() => { syncCurrentUserAvatarTagOnce().catch(() => {}); }, 2500);

  if (autoOpen) {
    try {
      const already = sessionStorage.getItem(AUTOOPEN_FLAG) === "1";
      if (!already) {
        const authReadyNow = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false);
        if (authReadyNow) {
          try { sessionStorage.setItem(AUTOOPEN_FLAG, "1"); } catch {}
          setTimeout(() => { open({ source: "auto" }).catch(() => {}); }, 150);
        } else {
          setTimeout(async () => {
            try {
              await waitForAuthReadyStrict?.(6000).catch(() => {});
              if (sessionStorage.getItem(AUTOOPEN_FLAG) === "1") return;
              try { sessionStorage.setItem(AUTOOPEN_FLAG, "1"); } catch {}
              open({ source: "auto-auth" }).catch(() => {});
            } catch {}
          }, 250);
        }
      }
    } catch {}
  }

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
    try { window.removeEventListener("storage", onStorage); } catch {}
    try { window.removeEventListener("hashchange", onHashSync); } catch {}
    try { window.removeEventListener("focus", onFocusSync); } catch {}
    try { document.removeEventListener("visibilitychange", onVisSync); } catch {}
    try { clearInterval(avatarSyncInterval); } catch {}
    try { cleanupHeader?.(); } catch {}
    try { window.removeEventListener("keydown", onKeydown); } catch {}
    try { cleanupLegacyHeaderUserButtonHidden(); } catch {}
    try { close(); } catch {}
  };
}
