import { getConfig, getServerAddress } from "/slider/modules/config.js";
import { clearCredentials, getWebClientHints, getStoredServerBase } from "/Plugins/JMSFusion/runtime/auth.js";
import { withServer, withServerSrcset, invalidateServerBaseCache, resolveServerBase } from "/slider/modules/jfUrl.js";

const config = getConfig();
const SERVER_ADDR_KEY = "jf_serverAddress";
const itemCache = new Map();
const dotGenreCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const USER_ID_KEY = "jf_userId";
const DEVICE_ID_KEY = "jf_api_deviceId";
const notFoundTombstone = new Map();
const NOTFOUND_TTL = 30 * 60 * 1000;
const MAX_ITEM_CACHE = 600;
const MAX_DOT_GENRE_CACHE = 1200;
const MAX_PREVIEW_CACHE = 200;
const MAX_TOMBSTONES = 2000;

function getPlayNowSuccessMessage() {
  try {
    const liveConfig = (typeof getConfig === "function" ? getConfig() : null) || config || {};
    return liveConfig?.languageLabels?.castbasarili || "Oynatma baslatildi";
  } catch {
    return "Oynatma baslatildi";
  }
}

function showPlayNowSuccessNotification(duration = 3000) {
  try {
    const message = getPlayNowSuccessMessage();
    const existingNotification = document.querySelector(".playback-notification");
    if (existingNotification) {
      existingNotification.remove();
    }

    const notification = document.createElement("div");
    notification.className = "playback-notification success";
    notification.innerHTML = `
      <div class="notification-content">
        <i class="fa-solid fa-check-circle"></i>
        <span>${message}</span>
      </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.classList.add("show");
    }, 10);
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, duration);
  } catch {}
}

async function __getGmmp() {
  try {
    if (typeof window !== "undefined" && window.__GMMP?.playTrackById) return window.__GMMP;
  } catch {}
  try {
    await import("/slider/modules/player/main.js");
  } catch (e) {
  }
  try {
    return (typeof window !== "undefined") ? (window.__GMMP || null) : null;
  } catch {
    return null;
  }
}

async function __destroyGmmpBeforeVideoPlayNow() {
  let destroyFn = null;

  try {
    destroyFn = window.__GMMP?.destroy || null;
  } catch {}

  if (typeof destroyFn !== "function") {
    try {
      const gmmpModule = await import("/slider/modules/player/main.js");
      destroyFn = gmmpModule?.destroyGmmp || null;
    } catch {}
  }

  if (typeof destroyFn !== "function") return false;

  try {
    return !!(await destroyFn({ reason: "playNow-video" }));
  } catch (err) {
    console.warn("playNow(video): GMMP kapatilamadi", err);
    return false;
  }
}

let __lastAuthSnapshot = null;
let __authWarmupStart = Date.now();
const AUTH_WARMUP_MS = 15000;
const QB_PRIME_MAX = 2000;
const __qbPrimed = new Map();
let __qbPrimerPromise = null;

function __qbMarkPrimed(id) {
  if (!id) return;
  __qbPrimed.set(id, Date.now());
  if (__qbPrimed.size > QB_PRIME_MAX) {
    const firstKey = __qbPrimed.keys().next().value;
    __qbPrimed.delete(firstKey);
  }
}

function __qbIsPrimed(id) {
  return __qbPrimed.has(id);
}

async function __qbEnsurePrimer() {
  if (__qbPrimerPromise) return __qbPrimerPromise;
  __qbPrimerPromise = (async () => {
    const cm = await import('/slider/modules/cacheManager.js').catch(() => null);
    const cu = await import('/slider/modules/containerUtils.js').catch(() => null);
    return {
      setCachedQuality: cm?.setCachedQuality || null,
      getVideoQualityText: cu?.getVideoQualityText || null,
    };
  })().finally(() => {
  });
  return __qbPrimerPromise;
}

function __qbPickVideoStream(item) {
  const streams = item?.MediaStreams;
  if (!Array.isArray(streams)) return null;
  return streams.find(s => s?.Type === 'Video') || null;
}

function __qbTryPrimeQualityFromItem(item) {
  try {
    if (!config?.enableQualityBadges) return;
    if (!item?.Id) return;
    const type = String(item.Type || '');
    if (type !== 'Movie' && type !== 'Episode') return;
    if (__qbIsPrimed(item.Id)) return;

    const vs = __qbPickVideoStream(item);
    if (!vs) return;

    __qbMarkPrimed(item.Id);
    queueMicrotask(async () => {
      try {
        const primer = await __qbEnsurePrimer();
        const getVideoQualityText = primer?.getVideoQualityText;
        const setCachedQuality = primer?.setCachedQuality;
        if (!getVideoQualityText || !setCachedQuality) return;

        const q = getVideoQualityText(vs);
        if (!q) return;
        await setCachedQuality(item.Id, q, type);
      } catch (e) {
      }
    });
  } catch {}
}

function __qbTryPrimeQualityFromPayload(payload) {
  try {
    if (!config?.enableQualityBadges) return;
    if (!payload) return;
    if (payload && typeof payload === "object" && payload.Id) {
      __qbTryPrimeQualityFromItem(payload);
    }

    const items = payload?.Items;
    if (Array.isArray(items)) {
      for (const it of items) __qbTryPrimeQualityFromItem(it);
      return;
    }

    if (Array.isArray(payload)) {
      for (const it of payload) __qbTryPrimeQualityFromItem(it);
      return;
    }

    const altLists = ["Results", "List", "Data"];
    for (const k of altLists) {
      const arr = payload?.[k];
      if (Array.isArray(arr)) {
        for (const it of arr) __qbTryPrimeQualityFromItem(it);
        return;
      }
    }
  } catch {}
}

function readStoredServerBase() {
  try {
    return normalizeServerBase(
      localStorage.getItem(SERVER_ADDR_KEY) || sessionStorage.getItem(SERVER_ADDR_KEY) || ""
    );
  } catch {
    return "";
  }
}

async function ensureAuthReadyFor(url, ms = 2500) {
  if (!requiresAuth(url)) return true;
  if (isAuthReadyStrict()) return true;
  try { await waitForAuthReadyStrict(ms); } catch {}
  return isAuthReadyStrict();
}

export function getServerBase() {
  return resolveServerBase({ getServerAddress });
}

export function getEmbyHeaders(extra = {}) {
  return buildEmbyHeaders(extra);
}

export const jms = {
  get serverAddress() { return getServerBase(); }
};

 export function isAuthReadyStrict() {
   try {
     const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
     if (!api) return false;
     const token  = (typeof api.accessToken === "function" ? api.accessToken() : api._accessToken) || "";
     const userId = (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId) || "";
     return !!(token && userId);
   } catch { return false; }
 }

 const DBG_AUTH = false;

function dbgAuth(tag, url="") {
  if (!DBG_AUTH) return;
  try {
    if (localStorage.getItem("jf_debug_api") !== "1") return;
    const api = window.ApiClient || null;
    const t = (api && (typeof api.accessToken==="function" ? api.accessToken() : api._accessToken)) || "";
    const u = (api && (typeof api.getCurrentUserId==="function" ? api.getCurrentUserId() : api._currentUserId)) || "";
    console.log(`🔎 ${tag}`, { url, isAuthReady: isAuthReadyStrict(), token: !!t, userId: !!u });
  } catch {}
}

 export function persistAuthSnapshotFromApiClient() {
  try {
    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    if (!api) return;
    __authWarmupStart = Date.now();

    const token =
      (typeof api.accessToken === "function" ? api.accessToken() : api._accessToken) || null;
    const userId =
      (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId) || null;
    const deviceId = readApiClientDeviceId() || "web-client";
    const serverId = api._serverInfo?.SystemId || api._serverInfo?.Id || null;
    try {
      const baseFromLoc = normalizeServerBase(getBaseFromLocation());
      const baseFromApi = normalizeServerBase((typeof api.serverAddress === "function") ? api.serverAddress() : "");
      const pick = baseFromLoc || (baseFromApi && !isOriginOnly(baseFromApi) ? baseFromApi : "");
      if (pick) persistServerBase(pick);
    } catch {}
    if (!userId) return;
    try { localStorage.setItem("persist_user_id", userId); } catch {}
    try { localStorage.setItem("persist_device_id", deviceId); } catch {}
    if (serverId) {
      try { localStorage.setItem("persist_server_id", serverId); } catch {}
    }
    try { localStorage.setItem(DEVICE_ID_KEY, deviceId); sessionStorage.setItem(DEVICE_ID_KEY, deviceId); } catch {}
    try { persistUserId(userId); } catch {}

    const result = { userId, accessToken: token || "", sessionId: api._sessionId || null, serverId, deviceId,
                     clientName: "Jellyfin Web Client", clientVersion: "1.0.0" };
                     dbgAuth("persistAuthSnapshot:done");
    onAuthProfileChanged(__lastAuthSnapshot, result);
    __lastAuthSnapshot = { userId, accessToken: token || "", serverId };
  } catch {
  }
}

 export async function waitForAuthReadyStrict(timeoutMs = 15000) {
   const t0 = Date.now();
   while (Date.now() - t0 < timeoutMs) {
     if (isAuthReadyStrict()) return true;
     await new Promise(r => setTimeout(r, 250));
   }
   return false;
 }

function hasCredentials() {
  try {
    if (sessionStorage.getItem("json-credentials") || localStorage.getItem("json-credentials")) return true;
    if (localStorage.getItem("jellyfin_credentials")) return true;
    for (const k in localStorage) {
      if (/jellyfin.*credentials/i.test(k)) return true;
    }
    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    if (api && (typeof api.accessToken === "function" ? api.accessToken() : api._accessToken)) return true;
    return false;
  } catch { return false; }
 }

function clearPersistedIdentity() {
  try {
    localStorage.removeItem(USER_ID_KEY);
    sessionStorage.removeItem(USER_ID_KEY);
  } catch {}
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    sessionStorage.removeItem(DEVICE_ID_KEY);
  } catch {}
}

function requiresAuth(url = "") {
  try {
    const u = url.startsWith("http") ? new URL(url) : null;
    const path = u ? u.pathname : url;
    return /\/Users\/|\/Sessions\b|\/Items\/[^/]+\/PlaybackInfo\b|\/Videos\//i.test(path);
  } catch {
    return true;
  }
}

function buildEmbyHeaders(extra = {}) {
  try {
    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    const { accessToken } = getSessionInfo();
    const headers = { ...extra };
    if (api?.getAuthorizationHeader) {
      headers['X-Emby-Authorization'] = api.getAuthorizationHeader();
    } else {
      headers['X-Emby-Authorization'] = getAuthHeader();
    }
    if (accessToken) headers['X-Emby-Token'] = accessToken;
    return headers;
  } catch {
    return { ...extra };
  }
}

function nukeAllCachesAndLocalUserCaches() {
  clearAllInMemoryCaches();
  try {
    localStorage.removeItem("userTopGenresCache");
    localStorage.removeItem("userTopGenres_v2");
  } catch {}
}

function onAuthProfileChanged(prev, next) {
  if (!prev) return;
  const changed =
    prev.userId !== next.userId ||
    prev.serverId !== next.serverId ||
    prev.accessToken !== next.accessToken;
  if (changed) {
    console.log("🔐 Auth profili değişti → tüm cache’ler temizleniyor");
    nukeAllCachesAndLocalUserCaches();
    invalidateServerBaseCache();
  }
}

function isLikelyGuid(id) {
  if (typeof id !== 'string') return false;
  const s = id.trim();
  const guid = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const hex32 = /^[0-9a-f]{32}$/i;
  return guid.test(s) || hex32.test(s);
}
function looksBase64(s) { return typeof s === 'string' && /^[A-Za-z0-9+/=]+$/.test(s); }
function isSuspiciousId(id) {
  if (typeof id !== 'string') return true;
  const s = id.trim();
  if (!s) return true;
  if (s.length > 128) return true;
  if (s.includes('/') || s.includes(' ') || s.includes(':')) return true;
  if (looksBase64(s)) {
    try {
      const decoded = atob(s);
      if (/Mozilla\/|Chrome\/|Safari\/|AppleWebKit\/|Windows NT|Linux|Mac OS/i.test(decoded)) return true;
      if (decoded.length > 128) return true;
    } catch {}
  }
  return !isLikelyGuid(s);
}

function pruneMapBySize(map, max) {
  while (map.size > max) {
    const k = map.keys().next().value;
    map.delete(k);
  }
}

function isTombstoned(id) {
  const rec = notFoundTombstone.get(id);
  return !!(rec && (Date.now() - rec) < NOTFOUND_TTL);
}
function markTombstone(id) {
  notFoundTombstone.set(id, Date.now());
  if (notFoundTombstone.size > MAX_TOMBSTONES) pruneMapBySize(notFoundTombstone, MAX_TOMBSTONES);
}

function isAbortError(err, signal) {
  return (
    err?.name === 'AbortError' ||
    (typeof err?.message === 'string' && /aborted|user aborted/i.test(err.message)) ||
    signal?.aborted === true ||
    err?.isAbort === true ||
    err?.status === 0
  );
}

function safeGet(k) {
  try { return localStorage.getItem(k) || sessionStorage.getItem(k) || null; } catch { return null; }
}
function safeSet(k, v) {
  try { if (v) { localStorage.setItem(k, v); sessionStorage.setItem(k, v); } } catch {}
}

function readApiClientDeviceId() {
  const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
  if (!api) return null;

  try {
    if (typeof api.deviceId === "function") return api.deviceId();
    if (typeof api.getDeviceId === "function") return api.getDeviceId();
    if (api.deviceId && typeof api.deviceId === "string") return api.deviceId;
    if (api._deviceId && typeof api._deviceId === "string") return api._deviceId;
  } catch {}
  return null;
}

 (function bootstrapPersistApiClientDeviceId() {
  if (!hasCredentials()) return;
  const existing = safeGet(DEVICE_ID_KEY);
  const detected = readApiClientDeviceId();
  if (detected && detected !== existing) safeSet(DEVICE_ID_KEY, detected);
 })();

function getStoredDeviceId() {
  return safeGet(DEVICE_ID_KEY);
}

 function getStoredUserId() {
   try {
     return (
       localStorage.getItem(USER_ID_KEY) ||
       sessionStorage.getItem(USER_ID_KEY) ||
       null
     );
   } catch {
     return null;
   }
 }

function persistUserId(id) {
   try {
     if (id) {
       localStorage.setItem(USER_ID_KEY, id);
       sessionStorage.setItem(USER_ID_KEY, id);
     }
   } catch {}
 }

export async function fetchLocalTrailers(itemId, { signal } = {}) {
  if (!itemId) return [];

  const api = window.ApiClient || null;
  const userId =
    (api && typeof api.getCurrentUserId === 'function' && api.getCurrentUserId()) ||
    (typeof getConfig === 'function' && getConfig()?.userId) ||
    null;
  const token =
    (api && typeof api.accessToken === 'function' && api.accessToken()) ||
    (api && api._accessToken) ||
    localStorage.getItem('embyToken') ||
    sessionStorage.getItem('embyToken') ||
    null;

  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  const url = `/Items/${encodeURIComponent(itemId)}/LocalTrailers${params.toString() ? `?${params}` : ''}`;
  const headers = { 'Accept': 'application/json' };

  if (token) {
    headers['X-Emby-Token'] = token;
  } else if (api && typeof api.getAuthorizationHeader === 'function') {
    headers['X-Emby-Authorization'] = api.getAuthorizationHeader();
  } else if (typeof getConfig === 'function' && getConfig()?.authHeader) {
    headers['X-Emby-Authorization'] = getConfig().authHeader;
  }

  try {
    const fullUrl = withServer(url);
    const res = await fetch(fullUrl, { headers, signal, credentials: 'same-origin' });
    if (res.status === 401) {
      console.warn('fetchLocalTrailers: 401 Unauthorized (token eksik/yanlış?)');
      return [];
    }
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted || signal?.reason === 'hover-cancel') {
      return [];
    }
    console.warn('fetchLocalTrailers error:', e);
    return [];
  }
}

export function pickBestLocalTrailer(trailers = []) {
  if (!Array.isArray(trailers) || trailers.length === 0) return null;
  const withName = trailers.find(t => (t.Name || t.Path || '').toLowerCase().includes('trailer'));
  if (withName) return withName;
  const byShort = [...trailers].sort((a,b) => (a.RunTimeTicks||0) - (b.RunTimeTicks||0));
  return byShort[0] || trailers[0];
}

async function hydrateWatchlistPayload(payload) {
  if (!payload) return payload;
  try {
    const watchlistModule = await import("/slider/modules/watchlist.js");
    if (typeof watchlistModule?.hydrateWatchlistState === "function") {
      await watchlistModule.hydrateWatchlistState(payload);
    }
  } catch {}
  return payload;
}

export async function fetchItemsBulk(ids = [], fields = [
  "Type","Name","SeriesId","SeriesName","ParentId","ParentIndexNumber",
  "IndexNumber","Overview","Genres","RunTimeTicks","OfficialRating","ProductionYear",
  "CommunityRating","CriticRating","ImageTags","BackdropImageTags","UserData","MediaStreams"
], { signal } = {}) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return { found: new Map(), missing: new Set() };
  const filtered = clean.filter(id => !isTombstoned(id));
  if (!filtered.length) return { found: new Map(), missing: new Set(clean) };

  const { userId } = getSessionInfo();
  const url = `/Users/${userId}/Items?Ids=${encodeURIComponent(filtered.join(','))}&Fields=${fields.join(',')}`;

  const res = await makeApiRequest(url, { signal }).catch(err => {
    if (err?.isAbort) return null;
    throw err;
  });
  const items = res?.Items || [];
  await hydrateWatchlistPayload(items);

  try {
    if (Array.isArray(items) && config?.enableQualityBadges) {
      for (const it of items) __qbTryPrimeQualityFromItem(it);
    }
  } catch {}

  const found = new Map(items.map(it => [it.Id, it]));
  const missing = new Set(filtered.filter(id => !found.has(id)));
  missing.forEach(id => markTombstone(id));

  return { found, missing };
}

async function safeFetch(url, opts = {}) {
  dbgAuth("safeFetch:begin", url);
  if (!(await ensureAuthReadyFor(url, 2500))) {
    const e = new Error("Auth not ready (waited), skipping request");
    e.status = 0; e.isAbort = true;
    throw e;
  }
  let token = "";
  try { token = getSessionInfo()?.accessToken || ""; } catch {}
  if (!token && requiresAuth(url)) {
    const e = new Error("Giriş yapılmadı: access token yok.");
    e.status = 401;
    throw e;
  }
  const headers = buildEmbyHeaders(opts.headers || {});

  let res;
  try {
    const fullUrl = withServer(url);
    res = await fetch(fullUrl, { ...opts, headers });
  } catch (err) {
    if (isAbortError(err, opts?.signal)) {
      return null;
    }
    throw err;
  }

  if (res.status === 401) {
    const now = Date.now();
    const inWarmup = (now - __authWarmupStart) < AUTH_WARMUP_MS;
    if (inWarmup) {
      const err = new Error("Yetkisiz (401) – auth warmup sırasında olabilir.");
      err.status = 401;
      throw err;
    }
    try {
      clearCredentials();
    } catch {}
    try {
      clearPersistedIdentity();
    } catch {}
    const err = new Error("Oturum geçersiz (401) – kimlik temizlendi, tekrar giriş gerekli.");
    err.status = 401;
    throw err;
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const err = new Error(errJson.message || `API hatası: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const ct = res.headers.get("content-type") || "";
  if (res.status === 204 || !ct.includes("application/json")) return {};
  const data = await res.json().catch(() => ({}));

  try { __qbTryPrimeQualityFromPayload(data); } catch {}

  return data;
}

export function getAuthHeader() {
  const { accessToken, clientName, deviceId, clientVersion } = getSessionInfo();
  const base = `MediaBrowser Client="${clientName}", Device="${deviceId || 'web-client'}", DeviceId="${deviceId}", Version="${clientVersion}"`;
  return accessToken ? `${base}, Token="${accessToken}"` : base;
}

function readJellyfinWebCredentialsFromStorage() {
  try {
    let raw = localStorage.getItem("jellyfin_credentials");
    if (!raw) {
      for (const k in localStorage) {
        if (/jellyfin.*credentials/i.test(k)) { raw = localStorage.getItem(k); break; }
      }
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const token =
      parsed.AccessToken || parsed.accessToken || parsed.Token || null;
    const userId =
      parsed.User?.Id || parsed.userId || parsed.UserId || null;
    const sessionId =
      parsed.SessionId || parsed.sessionId || null;
    const serverId =
      parsed.ServerId || parsed.SystemId ||
      (parsed.Servers && (parsed.Servers[0]?.SystemId || parsed.Servers[0]?.Id)) || null;
    const deviceId =
      parsed.DeviceId || parsed.ClientDeviceId || null;
    const clientName = parsed.Client || "Jellyfin Web Client";
    const clientVersion = parsed.Version || "1.0.0";

    if (!token || !userId) return null;
    return { token, userId, sessionId, serverId, deviceId, clientName, clientVersion };
  } catch {
    return null;
  }
}

function readFromApiClient() {
  try {
    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    if (!api) return null;

    const token = (typeof api.accessToken === "function" ? api.accessToken() : api._accessToken) || null;
    const userId = (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId) || null;
    const deviceId =
      (typeof api.deviceId === "function" ? api.deviceId() :
       (typeof api.getDeviceId === "function" ? api.getDeviceId() : (api.deviceId || api._deviceId))) || null;

    const serverId =
      api._serverInfo?.SystemId ||
      api._serverInfo?.Id ||
      null;

    if (!token || !userId) return null;
    return {
      token, userId, sessionId: api._sessionId || null, serverId,
      deviceId, clientName: "Jellyfin Web Client", clientVersion: "1.0.0"
    };
  } catch {
    return null;
  }
}

function pickActiveServerEntry(creds) {
  try {
    const list = Array.isArray(creds?.Servers) ? creds.Servers : [];
    if (!list.length) return null;

    const sid = creds?.ServerId || null;
    if (sid) {
      const hit = list.find(s => String(s?.Id || "") === String(sid));
      if (hit) return hit;
    }

    const addr = (getServerAddress?.() || "").toLowerCase();
    if (addr) {
      const hit = list.find(s => String(s?.ManualAddress || s?.LocalAddress || "").toLowerCase() === addr);
      if (hit) return hit;
    }
    return list[0] || null;
  } catch {
    return null;
  }
}

function pickFirstString(...values) {
  for (const value of values) {
    const out = String(value || "").trim();
    if (out) return out;
  }
  return "";
}

export function getSessionInfo() {
  try {
    const raw = localStorage.getItem("jellyfin_credentials") || localStorage.getItem("emby_credentials") || "";
    const creds = raw ? JSON.parse(raw) : {};
    const active = pickActiveServerEntry(creds);
    const hints = (typeof getWebClientHints === "function" ? getWebClientHints() : null) || {};

    const accessToken = pickFirstString(
      active?.AccessToken,
      creds?.AccessToken,
      hints?.accessToken
    );

    const userId = pickFirstString(
      active?.UserId,
      creds?.User?.Id,
      creds?.userId,
      hints?.userId,
      getStoredUserId(),
      safeGet("persist_user_id")
    );

    const sessionId = pickFirstString(
      hints?.sessionId,
      creds?.SessionId,
      creds?.sessionId
    );

    const deviceId = pickFirstString(
      hints?.deviceId,
      creds?.DeviceId,
      creds?.ClientDeviceId,
      getStoredDeviceId(),
      safeGet("persist_device_id")
    );

    const clientName = pickFirstString(
      hints?.clientName,
      creds?.Client,
      "Jellyfin Web Client"
    );

    const clientVersion = pickFirstString(
      hints?.clientVersion,
      creds?.Version,
      "1.0.0"
    );

    return {
      ...creds,
      accessToken,
      userId,
      sessionId,
      deviceId,
      clientName,
      clientVersion,
      serverId: String(active?.Id || creds?.ServerId || ""),
      serverAddress: String(active?.ManualAddress || active?.LocalAddress || getServerAddress?.() || "")
    };
  } catch {
    return {};
  }
}

let __meResolvePromise = null;

function isUsersUrl(url = "") {
  return /\/Users\/[^/]+/i.test(String(url));
}

function replaceUserIdInUrl(url, newUserId) {
  return String(url).replace(/\/Users\/[^/]+/i, `/Users/${encodeURIComponent(newUserId)}`);
}

async function fetchMeUserId({ signal } = {}) {
  const data = await makeApiRequest("/Users/Me", { signal, __skipUserFix: true });
  const id = data?.Id ? String(data.Id) : "";
  return id || null;
}

async function resolveAndPersistUserId({ signal } = {}) {
  if (!__meResolvePromise) {
    __meResolvePromise = (async () => {
      const meId = await fetchMeUserId({ signal }).catch(() => null);
      if (meId) {
        try { persistUserId(meId); } catch {}
        return meId;
      }
      return null;
    })().finally(() => {
      __meResolvePromise = null;
    });
  }
  return __meResolvePromise;
}

async function makeApiRequest(url, options = {}) {
  dbgAuth("makeApiRequest:begin", url);
  try {
    if (!(await ensureAuthReadyFor(url, 2500))) {
      const e = new Error("Auth not ready (waited), skipping request");
      e.status = 0; e.isAbort = true;
      throw e;
    }
    let token = "";
    try { token = getSessionInfo()?.accessToken || ""; } catch {}
    if (!token && requiresAuth(url)) {
      const e = new Error("Giriş yapılmadı: access token yok.");
      e.status = 401;
      throw e;
    }
    options.headers = buildEmbyHeaders(options.headers || {});

    try {
    const dbg = localStorage.getItem('jf_debug_api') === '1';

    if (dbg) {
    const full = withServer(url);

    const shouldLog =
      /\/Users\/[^/]+\/Items\b/i.test(url) ||
      /\/Items\/[^/]+\/PlaybackInfo\b/i.test(url) ||
      /\/Sessions\b/i.test(url);

    if (shouldLog) {
      console.log(
        "🌐 API REQ →",
        (options?.method || "GET"),
        full,
        { url, serverBase: getServerBaseCached() }
      );
    }
  }
} catch {}

    const fullUrl = withServer(url);
    const response = await fetch(fullUrl, {
      ...options,
      headers: options.headers,
      signal: options.signal,
    });

    async function readErrorPayload(res) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json().catch(() => null);
        if (j) return { json: j, text: "" };
      }
      const t = await res.text().catch(() => "");
      return { json: null, text: t };
    }

    if (response.status === 404) {
      const canFix =
        !options.__skipUserFix &&
        !options.__retriedUserFix &&
        isUsersUrl(url) &&
        requiresAuth(url);

      if (canFix) {
        const fixedId = await resolveAndPersistUserId({ signal: options.signal }).catch(() => null);
        if (fixedId) {
          const retryUrl = replaceUserIdInUrl(url, fixedId);
          return await makeApiRequest(retryUrl, {
            ...options,
            __retriedUserFix: true
          });
        }
      }
      return null;
    }
    if (response.status === 401) {
      if (!options.__retried401) {
        const retryOpts = {
          ...options,
          __retried401: true,
          headers: buildEmbyHeaders({ ...(options.headers || {}) }),
        };
        return await makeApiRequest(url, retryOpts);
      }
      const err = new Error("Oturum geçersiz veya yetkisiz (401).");
      err.status = 401;
      throw err;
    }
    if (response.status === 403) {
      const err = new Error(`Yetki yok (403): ${fullUrl}`);
      err.status = 403;
      throw err;
    }
    if (!response.ok) {
      const { json, text } = await readErrorPayload(response);
      const errorData = json || {};
      const fallbackText = (text || "").trim();
      const errorMsg =
        errorData.message ||
        (errorData.Title && errorData.Description
          ? `${errorData.Title}: ${errorData.Description}`
          : (fallbackText ? fallbackText.slice(0, 500) : `API isteği başarısız oldu (durum: ${response.status})`));

      const err = new Error(errorMsg);
      err.status = response.status;
      err._url = fullUrl;
      throw err;
    }

    const contentType = response.headers.get("content-type") || "";
    if (response.status === 204 || !contentType.includes("application/json")) {
      return {};
    }
    const data = await response.json().catch(() => ({}));
    try { __qbTryPrimeQualityFromPayload(data); } catch {}

    return data;
      } catch (error) {
        if (isAbortError(error, options?.signal)) {
          error.isAbort = true;
          throw error;
        }

    const msg = String(error?.message || "");
    const is403 = error?.status === 403 || msg.includes("403");
    const is404 = error?.status === 404 || msg.includes("404");
    const is401 = error?.status === 401 || msg.includes("401");
    const is500 = error?.status === 500 || msg.includes("500");
    const quiet = options?.__quiet === true;
    const preview = options?.__preview === true;
    if (!quiet && !preview && !is403 && !is404 && !is401 && !is500) {
      console.error(`${options?.method || "GET"} ${url} için API isteği hatası:`, error);
    }
    throw error;
  }
}

export async function isCurrentUserAdmin() {
  try {
    if (!hasCredentials()) return false;
    const { userId } = getSessionInfo();
    const u = await makeApiRequest(`/Users/${userId}`);
    return !!(u?.Policy?.IsAdministrator);
  } catch {
    return false;
  }
}

export function getDetailsUrl(itemId) {
  const serverId =
    (getSessionInfo()?.serverId) ||
    localStorage.getItem("persist_server_id") ||
    sessionStorage.getItem("persist_server_id") ||
    localStorage.getItem("serverId") ||
    sessionStorage.getItem("serverId") ||
    "";

  const id = encodeURIComponent(String(itemId ?? "").trim());
  const sid = encodeURIComponent(serverId);
  return `#/details?id=${id}${sid ? `&serverId=${sid}` : ""}`;
}

export function goToDetailsPage(itemId) {
  const url = getDetailsUrl(itemId);
  window.location.href = url;
}

 export async function fetchItemDetails(itemId, { signal } = {}) {
   if (!itemId) return null;
   if (isTombstoned(itemId)) return null;
   try {
     if (!hasCredentials()) return null;
     const { userId } = getSessionInfo();
     const data = await safeFetch(
       `/Users/${userId}/Items/${encodeURIComponent(String(itemId).trim())}`,
       { signal }
     );
     if (data === null) markTombstone(String(itemId));

     __qbTryPrimeQualityFromItem(data);
     await hydrateWatchlistPayload(data);

     return data || null;
   } catch (e) {
     if (e?.status === 400) return null;
     if (e?.status === 404) { markTombstone(String(itemId)); return null; }
     if (!isAbortError(e)) console.warn('fetchItemDetails error:', e);
     return null;
   }
 }

const ITEM_FULL_FIELDS = [
  "Type","Name","SeriesId","SeriesName","ParentId","ParentIndexNumber","IndexNumber",
  "Overview","Genres","RunTimeTicks","OfficialRating","ProductionYear",
  "CommunityRating","CriticRating",
  "ImageTags","BackdropImageTags","ParentBackdropImageTags","ParentBackdropItemId","SeriesBackdropImageTag","SeasonId",
  "UserData","MediaStreams","Series", "CollectionIds",
  "ProviderIds", "People", "RemoteTrailers", "Studios", "Taglines",
  "AlbumId", "Album", "AlbumArtist", "AlbumArtistId", "Artists", "ArtistId", "ArtistIds", "ArtistItems",
  "AlbumPrimaryImageTag", "PrimaryImageTag",
];

export async function fetchItemDetailsFull(itemId, { signal } = {}) {
  if (!itemId) return null;
  if (isTombstoned(itemId)) return null;
  try {
    const { userId } = getSessionInfo();
    const url =
      `/Users/${userId}/Items/${encodeURIComponent(String(itemId).trim())}` +
      `?Fields=${ITEM_FULL_FIELDS.join(',')}`;
    const data = await makeApiRequest(url, { signal });
    if (data === null) markTombstone(String(itemId));

    __qbTryPrimeQualityFromItem(data);
    await hydrateWatchlistPayload(data);

    return data || null;
  } catch (e) {
    if (e?.status === 400) return null;
    if (e?.status === 404) { markTombstone(String(itemId)); return null; }
    if (!isAbortError(e, signal)) console.warn('fetchItemDetailsFull error:', e);
    return null;
  }
}

const PLAYABLE_TYPES = new Set(['Series','Movie','Episode','Season']);

export async function fetchPlayableItemDetails(
  itemId,
  { signal, resolvePlayable = false } = {}
) {
  let it = await fetchItemDetailsFull(itemId, { signal });
  if (!it) return null;
  if (!PLAYABLE_TYPES.has(it.Type)) return null;
  if (!resolvePlayable) {
    return it;
  }

  if (it.Type === 'Series') {
    const best = await getBestEpisodeIdForSeries(it.Id, getSessionInfo().userId).catch(() => null);
    return best ? fetchItemDetailsFull(best, { signal }) : null;
  }
  if (it.Type === 'Season') {
    const best = await getBestEpisodeIdForSeason(it.Id, it.SeriesId, getSessionInfo().userId).catch(() => null);
    return best ? fetchItemDetailsFull(best, { signal }) : null;
  }
  return it;
}

async function getCachedItemDetailsInternal(itemId) {
  if (!itemId || isTombstoned(itemId)) return null;

  const now = Date.now();
  if (itemCache.has(itemId)) {
    const { data, timestamp } = itemCache.get(itemId);
    if (now - timestamp < CACHE_TTL) return data;
  }

  const data = await fetchItemDetails(itemId);
  if (data === null) {
    itemCache.set(itemId, { data: null, timestamp: now });
    pruneMapBySize(itemCache, MAX_ITEM_CACHE);
    return null;
  }
  itemCache.set(itemId, { data, timestamp: now });
  pruneMapBySize(itemCache, MAX_ITEM_CACHE);
  return data;
}

async function setJellyfinFavoriteStatus(itemId, isFavorite, { signal } = {}) {
  const { userId } = getSessionInfo();
  if (!userId) {
    const err = new Error("Kullanıcı oturumu bulunamadı.");
    err.status = 401;
    throw err;
  }

  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) {
    throw new Error("itemId gerekli");
  }

  return makeApiRequest(`/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(cleanItemId)}`, {
    method: isFavorite ? "POST" : "DELETE",
    signal,
    __quiet: true
  });
}

export async function updateFavoriteStatus(itemId, isFavorite, options = {}) {
  const watchlistModule = await import("/slider/modules/watchlist.js");
  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) throw new Error("itemId gerekli");

  const syncLocal = async () => {
    if (isFavorite) {
      return watchlistModule.addToWatchlist(cleanItemId, options);
    }
    return watchlistModule.removeFromWatchlist(cleanItemId, options);
  };

  watchlistModule?.suppressFavoriteMirrorOnce?.(cleanItemId, isFavorite);
  await setJellyfinFavoriteStatus(cleanItemId, isFavorite, { signal: options?.signal });

  try {
    return await syncLocal();
  } catch (error) {
    try {
      watchlistModule?.suppressFavoriteMirrorOnce?.(cleanItemId, !isFavorite);
      await setJellyfinFavoriteStatus(cleanItemId, !isFavorite, { signal: options?.signal });
    } catch {}
    throw error;
  }
}

export async function updatePlayedStatus(itemId, played) {
  const { userId } = getSessionInfo();
  const result = await makeApiRequest(`/Users/${userId}/Items/${itemId}/UserData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ Played: played })
  });

  if (played) {
    try {
      const watchlistModule = await import("/slider/modules/watchlist.js");
      await watchlistModule?.removePlayedItemFromWatchlist?.(itemId);
    } catch {}
  }

  return result;
}

export async function getImageDimensions(url) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const finalUrl = isAbsoluteUrl(url) ? url : withServer(url);
    xhr.open("GET", finalUrl, true);
    xhr.responseType = "blob";
    try {
      const headers = buildEmbyHeaders({});
      Object.entries(headers).forEach(([k,v]) => { try { xhr.setRequestHeader(k, v); } catch {} });
    } catch {}

    xhr.onload = function () {
      if (this.status === 200) {
        const blobUrl = URL.createObjectURL(this.response);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
            area: img.naturalWidth * img.naturalHeight,
          });
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
        };
        img.src = blobUrl;
      } else if (this.status === 404) {
        resolve(null);
      } else {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.send();
  });
}

function normalizeIdentityToken(value) {
  return String(value || "").trim().toLowerCase();
}

function addIdentityToken(set, value) {
  const normalized = normalizeIdentityToken(value);
  if (!normalized) return;
  set.add(normalized);
}

function buildRequesterIdentity(self = {}) {
  const hints = (typeof getWebClientHints === "function" ? getWebClientHints() : null) || {};
  const userIds = new Set();
  const sessionIds = new Set();
  const deviceIds = new Set();

  addIdentityToken(userIds, self?.userId);
  addIdentityToken(userIds, getStoredUserId());
  addIdentityToken(userIds, safeGet("persist_user_id"));

  addIdentityToken(sessionIds, self?.sessionId);
  addIdentityToken(sessionIds, hints?.sessionId);
  try {
    addIdentityToken(sessionIds, window.ApiClient?._sessionId);
  } catch {}

  addIdentityToken(deviceIds, self?.deviceId);
  addIdentityToken(deviceIds, hints?.deviceId);
  addIdentityToken(deviceIds, getStoredDeviceId());
  addIdentityToken(deviceIds, safeGet("persist_device_id"));
  addIdentityToken(deviceIds, readApiClientDeviceId());

  const clientHints = [
    self?.clientName,
    hints?.clientName,
    self?.Client
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);

  return {
    userIds,
    sessionIds,
    deviceIds,
    clientHints
  };
}

function scoreSessionCandidate(session, identity) {
  let score = 0;
  const sessionId = normalizeIdentityToken(session?.Id);
  const deviceId = normalizeIdentityToken(session?.DeviceId);
  const userId = normalizeIdentityToken(session?.UserId);

  if (sessionId && identity.sessionIds.has(sessionId)) score += 1200;
  if (deviceId && identity.deviceIds.has(deviceId)) score += 1000;
  if (userId && identity.userIds.has(userId)) score += 220;

  const sessionClient = String(session?.Client || "").toLowerCase();
  if (sessionClient && identity.clientHints.some((hint) => sessionClient.includes(hint))) score += 20;

  const last = session?.LastActivityDate ? new Date(session.LastActivityDate).getTime() : 0;
  if (last && Date.now() - last < 2 * 60 * 1000) score += 10;
  if (session?.SupportsRemoteControl !== false) score += 6;

  return score;
}

function resolveSelfSession(sessions, identity, { allowWeakFallback = false } = {}) {
  const ranked = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.Id)
    .map((session) => ({ session, score: scoreSessionCandidate(session, identity) }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;

  const best = ranked[0].session;
  const bestSessionId = normalizeIdentityToken(best?.Id);
  const bestDeviceId = normalizeIdentityToken(best?.DeviceId);
  const hasHardMatch =
    (bestSessionId && identity.sessionIds.has(bestSessionId)) ||
    (bestDeviceId && identity.deviceIds.has(bestDeviceId));

  if (hasHardMatch) return best;

  if (!allowWeakFallback) return null;

  const bestUserId = normalizeIdentityToken(best?.UserId);
  if (bestUserId && identity.userIds.has(bestUserId) && ranked[0].score >= 180) {
    return best;
  }
  return null;
}

function collectPlaybackManagersForPlayNow() {
  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  [
    window.playbackManager,
    window.MediaBrowser?.playbackManager,
    window.MediaBrowser?.PlaybackManager,
    window.Emby?.playbackManager,
    window.Emby?.PlaybackManager,
    window.appRouter?.playbackManager,
    window.__playbackManager,
    window.__jellyfinPlaybackManager,
    window.__jmsPlaybackManager
  ].forEach(add);

  try {
    const keys = Object.getOwnPropertyNames(window);
    for (const key of keys) {
      if (!/playback/i.test(key)) continue;
      try {
        add(window[key]);
      } catch {}
    }
  } catch {}

  return out;
}

function collectLocalPlayerTargetsForPlayNow(managers = []) {
  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || typeof candidate !== "object") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  add(window.MediaPlayer?.getActivePlayer?.());
  add(window.MediaBrowser?.MediaPlayer?.getActivePlayer?.());
  add(window.player);
  add(window.currentPlayer);
  add(window.__jmsPlayer);

  for (const manager of managers) {
    try { add(manager?.getActivePlayer?.()); } catch {}
    try { add(manager?._currentPlayer); } catch {}
  }

  return out;
}

async function waitForLocalMainVideoStart(timeoutMs = 2400) {
  const deadline = Date.now() + Math.max(250, Number(timeoutMs) || 2400);
  while (Date.now() < deadline) {
    const video = document.querySelector(
      ".videoPlayerContainer video.htmlvideoplayer, .videoPlayerContainer video"
    );
    if (video && video.readyState >= 2 && !video.paused) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

function getWebpackRequireForPlayNow() {
  try {
    if (window.__jmsWebpackRequire) return window.__jmsWebpackRequire;
  } catch {}

  try {
    const chunkGlobal = window.webpackChunk = window.webpackChunk || [];
    let captured = null;
    const chunkId = `jms-playnow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chunkGlobal.push([[chunkId], {}, (req) => {
      captured = req;
    }]);
    if (typeof captured === "function") {
      try { window.__jmsWebpackRequire = captured; } catch {}
      return captured;
    }
  } catch {}

  return null;
}

function readServerIdForPlayNow(item = null) {
  const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
  return pickFirstString(
    item?.ServerId,
    item?.serverId,
    getSessionInfo()?.serverId,
    api?._serverInfo?.Id,
    api?._serverInfo?.SystemId,
    typeof api?.serverId === "function" ? api.serverId() : null
  );
}

function buildLocalPlaybackItemStub(item = null, itemId = "", startPositionTicks = 0) {
  const stub = item && typeof item === "object" ? { ...item } : {};
  stub.Id = String(item?.Id || itemId || "").trim();
  stub.ServerId = readServerIdForPlayNow(item);
  stub.Type = String(item?.Type || stub.Type || "");
  stub.MediaType = String(item?.MediaType || stub.MediaType || "");
  stub.ChannelId = item?.ChannelId || stub.ChannelId || null;
  stub.CollectionType = item?.CollectionType || stub.CollectionType || null;
  stub.IsFolder = Boolean(item?.IsFolder || stub.IsFolder);
  stub.UserData = {
    ...(item?.UserData && typeof item.UserData === "object" ? item.UserData : {}),
    PlaybackPositionTicks: Math.max(0, Math.floor(Number(startPositionTicks) || 0))
  };
  return stub;
}

async function tryWebpackShortcutPlaybackStart(itemId, { startPositionTicks = 0, item = null } = {}) {
  const attempts = [];
  const req = getWebpackRequireForPlayNow();
  if (!req) {
    attempts.push({ target: "webpack", method: "require", ok: false, err: "webpack require yok" });
    return { tried: true, started: false, attempts };
  }

  try {
    const shortcutsMod = req(22832);
    const shortcuts = shortcutsMod?.Ay;
    if (!shortcuts?.onClick) {
      attempts.push({ target: "webpack", method: "shortcut-module", ok: false, err: "itemShortcuts yok" });
      return { tried: true, started: false, attempts };
    }

    const stub = buildLocalPlaybackItemStub(item, itemId, startPositionTicks);
    if (!stub.Id || !stub.ServerId) {
      attempts.push({
        target: "webpack",
        method: "shortcut-prepare",
        ok: false,
        err: `eksik item/serverId (${stub.Id ? "id-ok" : "id-yok"}, ${stub.ServerId ? "server-ok" : "server-yok"})`
      });
      return { tried: true, started: false, attempts };
    }

    const host = document.createElement("button");
    host.type = "button";
    host.className = "itemAction";
    host.setAttribute("data-action", stub.UserData?.PlaybackPositionTicks > 0 ? "resume" : "play");
    host.setAttribute("data-id", stub.Id);
    host.setAttribute("data-serverid", String(stub.ServerId));
    if (stub.Type) host.setAttribute("data-type", stub.Type);
    if (stub.MediaType) host.setAttribute("data-mediatype", stub.MediaType);
    if (stub.ChannelId) host.setAttribute("data-channelid", String(stub.ChannelId));
    host.setAttribute("data-isfolder", stub.IsFolder ? "true" : "false");
    if (stub.CollectionType) host.setAttribute("data-collectiontype", String(stub.CollectionType));
    if (stub.UserData?.PlaybackPositionTicks > 0) {
      host.setAttribute("data-positionticks", String(stub.UserData.PlaybackPositionTicks));
    }

    const child = document.createElement("span");
    host.appendChild(child);
    document.body.appendChild(host);

    try {
      shortcuts.onClick({
        target: child,
        preventDefault() {},
        stopPropagation() {}
      });
      const confirmed = await waitForLocalMainVideoStart(450);
      attempts.push({
        target: "webpack",
        method: "itemShortcuts.onClick",
        ok: true,
        started: true,
        confirmed
      });
      return { tried: true, started: true, attempts };
    } finally {
      host.remove();
    }
  } catch (err) {
    attempts.push({
      target: "webpack",
      method: "itemShortcuts.onClick",
      ok: false,
      err: String(err?.message || err || "")
    });
    return { tried: true, started: false, attempts };
  }
}

async function tryWebpackPlaybackManagerStart(itemId, { startPositionTicks = 0, item = null } = {}) {
  const attempts = [];
  const req = getWebpackRequireForPlayNow();
  if (!req) {
    attempts.push({ target: "webpack", method: "require", ok: false, err: "webpack require yok" });
    return { tried: true, started: false, attempts };
  }

  try {
    let playbackManager = null;

    try {
      const direct = req(39738);
      if (direct?.f?.play) playbackManager = direct.f;
    } catch {}

    if (!playbackManager && req.c) {
      for (const mod of Object.values(req.c)) {
        const candidate = mod?.exports?.f;
        if (candidate?.play && candidate?.canPlay && candidate?.getCurrentPlayer) {
          playbackManager = candidate;
          break;
        }
      }
    }

    if (!playbackManager?.play) {
      attempts.push({ target: "webpack", method: "playbackManager", ok: false, err: "playback manager yok" });
      return { tried: true, started: false, attempts };
    }

    const stub = buildLocalPlaybackItemStub(item, itemId, startPositionTicks);
    if (!stub.Id || !stub.ServerId) {
      attempts.push({
        target: "webpack",
        method: "playbackManager.play",
        ok: false,
        err: `eksik item/serverId (${stub.Id ? "id-ok" : "id-yok"}, ${stub.ServerId ? "server-ok" : "server-yok"})`
      });
      return { tried: true, started: false, attempts };
    }

    if (typeof playbackManager.canPlay === "function" && !playbackManager.canPlay(stub)) {
      attempts.push({ target: "webpack", method: "playbackManager.canPlay", ok: false, err: "canPlay=false" });
      return { tried: true, started: false, attempts };
    }

    const payload = {
      ids: [stub.Id],
      serverId: stub.ServerId
    };
    if (stub.UserData?.PlaybackPositionTicks > 0) {
      payload.startPositionTicks = stub.UserData.PlaybackPositionTicks;
    }

    const maybePromise = playbackManager.play(payload);
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const confirmed = await waitForLocalMainVideoStart(450);
    attempts.push({
      target: "webpack",
      method: "playbackManager.play",
      ok: true,
      started: true,
      confirmed
    });
    return { tried: true, started: true, attempts };
  } catch (err) {
    attempts.push({
      target: "webpack",
      method: "playbackManager.play",
      ok: false,
      err: String(err?.message || err || "")
    });
    return { tried: true, started: false, attempts };
  }
}

async function tryLocalPlaybackStart(itemId, { startPositionTicks = 0, item = null } = {}) {
  const normalizedId = String(itemId || "").trim();
  if (!normalizedId) {
    return { tried: false, started: false, attempts: [] };
  }

  const managers = collectPlaybackManagersForPlayNow();
  const players = collectLocalPlayerTargetsForPlayNow(managers);
  const targets = [...managers, ...players];

  const attempts = [];
  const cappedStartTicks = Math.max(0, Math.floor(Number(startPositionTicks) || 0));
  const basePlayPayload = { ids: [normalizedId] };
  if (cappedStartTicks > 0) basePlayPayload.startPositionTicks = cappedStartTicks;
  const playItemsPayload = item ? { items: [item] } : null;
  if (playItemsPayload && cappedStartTicks > 0) {
    playItemsPayload.startPositionTicks = cappedStartTicks;
  }

  const webpackPlaybackKick = await tryWebpackPlaybackManagerStart(normalizedId, {
    startPositionTicks: cappedStartTicks,
    item
  }).catch(() => ({ tried: false, started: false, attempts: [] }));
  if (Array.isArray(webpackPlaybackKick?.attempts)) {
    attempts.push(...webpackPlaybackKick.attempts);
  }
  if (webpackPlaybackKick?.started) {
    return {
      tried: true,
      started: true,
      attempts
    };
  }

  const webpackShortcutKick = await tryWebpackShortcutPlaybackStart(normalizedId, {
    startPositionTicks: cappedStartTicks,
    item
  }).catch(() => ({ tried: false, started: false, attempts: [] }));
  if (Array.isArray(webpackShortcutKick?.attempts)) {
    attempts.push(...webpackShortcutKick.attempts);
  }
  if (webpackShortcutKick?.started) {
    return {
      tried: true,
      started: true,
      attempts
    };
  }

  const deadline = Date.now() + 4200;
  const maxMethodCalls = 10;
  let methodCalls = 0;

  const methodSpecs = [
    { name: "play", args: () => [basePlayPayload] },
    { name: "play", args: () => (playItemsPayload ? [playItemsPayload] : null) },
    { name: "playById", args: () => [normalizedId] },
    { name: "playItem", args: () => [normalizedId] },
    { name: "openItem", args: () => [normalizedId] },
    { name: "displayContent", args: () => [{ ItemId: normalizedId }] }
  ];

  for (const target of targets) {
    if (Date.now() >= deadline || methodCalls >= maxMethodCalls) break;
    const targetLabel = String(target?.id || target?.name || target?.constructor?.name || "unknown");

    for (const spec of methodSpecs) {
      if (Date.now() >= deadline || methodCalls >= maxMethodCalls) break;
      if (typeof target?.[spec.name] !== "function") continue;
      const args = spec.args();
      if (!args) continue;

      methodCalls += 1;
      try {
        const maybePromise = target[spec.name](...args);
        if (maybePromise && typeof maybePromise.then === "function") {
          await Promise.race([
            maybePromise.catch(() => null),
            new Promise((resolve) => setTimeout(resolve, 900))
          ]);
        }
        const started = await waitForLocalMainVideoStart(1200);
        attempts.push({ target: targetLabel, method: spec.name, ok: true, started });
        if (started) {
          return { tried: true, started: true, attempts };
        }
      } catch (err) {
        attempts.push({
          target: targetLabel,
          method: spec.name,
          ok: false,
          err: String(err?.message || err || "")
        });
      }
    }
  }

  return {
    tried:
      attempts.length > 0 ||
      !!webpackShortcutKick?.tried ||
      !!webpackPlaybackKick?.tried,
    started: false,
    attempts
  };
}

function sortEpisodes(episodes = []) {
  return [...episodes].sort((a, b) => {
    const sa = a.ParentIndexNumber ?? a.SeasonIndex ?? 0;
    const sb = b.ParentIndexNumber ?? b.SeasonIndex ?? 0;
    if (sa !== sb) return sa - sb;
    const ea = a.IndexNumber ?? 0;
    const eb = b.IndexNumber ?? 0;
    return ea - eb;
  });
}

async function getBestEpisodeIdForSeries(seriesId, userId) {
  try {
    const nextUp = await makeApiRequest(
      `/Shows/NextUp?UserId=${encodeURIComponent(userId)}&SeriesId=${encodeURIComponent(seriesId)}&Limit=1&Fields=UserData,IndexNumber,ParentIndexNumber`
    );
    const cand = Array.isArray(nextUp?.Items) && nextUp.Items[0];
    if (cand?.Id) return cand.Id;
  } catch {}
  const epsResp = await makeApiRequest(
    `/Shows/${seriesId}/Episodes?Fields=UserData,IndexNumber,ParentIndexNumber&UserId=${userId}&Limit=10000`
  );
  const all = sortEpisodes(epsResp?.Items || []);
  const partial = all.find(e => e?.UserData?.PlaybackPositionTicks > 0 && !e?.UserData?.Played);
  if (partial?.Id) return partial.Id;
  const firstUnplayed = all.find(e => !e?.UserData?.Played);
  if (firstUnplayed?.Id) return firstUnplayed.Id;
  return all[0]?.Id || null;
}

async function getBestEpisodeIdForSeason(seasonId, seriesId, userId) {
  const epsResp = await makeApiRequest(
    `/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&Fields=UserData,IndexNumber,ParentIndexNumber&UserId=${userId}`
  );
  const all = sortEpisodes(epsResp?.Items || []);

  const partial = all.find(e => e?.UserData?.PlaybackPositionTicks > 0 && !e?.UserData?.Played);
  if (partial?.Id) return partial.Id;

  const firstUnplayed = all.find(e => !e?.UserData?.Played);
  if (firstUnplayed?.Id) return firstUnplayed.Id;

  return all[0]?.Id || null;
}

export async function playNow(itemId) {
  try {
    const self = getSessionInfo();
    const userAgent = String((typeof navigator !== "undefined" && navigator.userAgent) || "");
    const isAndroid = /android/i.test(userAgent);
    const isLikelyWebView =
      /; wv\)/i.test(userAgent) ||
      /\bVersion\/\d+(\.\d+)?\b/i.test(userAgent) ||
      !!window.ReactNativeWebView;
    const isAndroidWebView = isAndroid && isLikelyWebView;
    const persistDebug = (payload) => {
      try {
        window.__jmsLastPlayNowTargetDebug = payload;
      } catch {}
      try {
        localStorage.setItem("jms:lastPlayNowDebug", JSON.stringify(payload));
      } catch {}
      try {
        const serialized = JSON.stringify(payload);
        console.warn("[JMS_PLAYNOW_DEBUG]", serialized);
      } catch {
        try { console.warn("[JMS_PLAYNOW_DEBUG]", payload); } catch {}
      }
    };

    persistDebug({
      at: Date.now(),
      stage: "start",
      itemId: String(itemId || ""),
      isAndroidWebView
    });

    const requesterUserId = pickFirstString(
      self?.userId,
      getStoredUserId(),
      safeGet("persist_user_id")
    );
    if (!requesterUserId) {
      throw new Error("Aktif kullanıcı kimliği bulunamadı. Sayfayı yenileyip tekrar deneyin.");
    }

    let item = await fetchItemDetails(itemId);
    if (!item) throw new Error("Öğe bulunamadı");

    const type = String(item?.Type || "");
    const mediaType = String(item?.MediaType || "");
    const isMusicLeaf =
      type === "Audio" ||
      type === "MusicVideo" ||
      mediaType === "Audio";

    const isMusicContainer =
      type === "MusicAlbum" ||
      type === "MusicArtist" ||
      type === "Playlist" ||
      type === "Folder";

  if (isMusicLeaf || isMusicContainer) {
    const gmmp = await __getGmmp();
      if (gmmp?.ensureInit) {
        await gmmp.ensureInit({ show: true }).catch(() => false);
      }
      if (isMusicLeaf && gmmp?.playTrackById) {
        const ok = await gmmp.playTrackById(itemId, { revealPlayer: true }).catch(() => false);
        if (ok) {
          showPlayNowSuccessNotification();
          return true;
        }
      }
      if (isMusicContainer) {
        if (type === "MusicAlbum" && gmmp?.playAlbumById) {
          const ok = await gmmp.playAlbumById(itemId, { revealPlayer: true }).catch(() => false);
          if (ok) {
            showPlayNowSuccessNotification();
            return true;
          }
        }
        if (type === "MusicArtist" && gmmp?.playArtistById) {
          const ok = await gmmp.playArtistById(itemId, { revealPlayer: true }).catch(() => false);
          if (ok) {
            showPlayNowSuccessNotification();
            return true;
          }
        }
        if (type === "Playlist" && gmmp?.playPlaylistById) {
          const ok = await gmmp.playPlaylistById(itemId, { revealPlayer: true }).catch(() => false);
          if (ok) {
            showPlayNowSuccessNotification();
            return true;
          }
        }
        if (type === "Folder" && gmmp?.playFolderById) {
          const ok = await gmmp.playFolderById(itemId, { revealPlayer: true }).catch(() => false);
          if (ok) {
            showPlayNowSuccessNotification();
            return true;
          }
        }
      }
      console.warn("playNow(music): GMMP handler yok", { type });
      return false;
    }
    if (item.Type === "Series") {
      const best = await getBestEpisodeIdForSeries(item.Id, requesterUserId);
      if (!best) throw new Error("Bölüm bulunamadı");
      itemId = best;
      item = await fetchItemDetails(itemId);
    }
    if (item.Type === "Season") {
      const best = await getBestEpisodeIdForSeason(item.Id, item.SeriesId, requesterUserId);
      if (!best) throw new Error("Bu sezonda hiç bölüm yok!");
      itemId = best;
      item = await fetchItemDetails(itemId);
    }
    const normalizedItemId = String(itemId);
    const resumeTicks = Math.max(0, Math.floor(Number(item?.UserData?.PlaybackPositionTicks) || 0));

    await __destroyGmmpBeforeVideoPlayNow().catch(() => false);

    const localKick = await tryLocalPlaybackStart(normalizedItemId, {
      startPositionTicks: resumeTicks,
      item
    }).catch(() => ({ tried: false, started: false, attempts: [] }));

    if (localKick?.started) {
      window.currentPlayingItemId = itemId;
      persistDebug({
        at: Date.now(),
        stage: "success",
        itemId,
        requesterUserId,
        method: "local-direct"
      });
      showPlayNowSuccessNotification();
      return true;
    }

    persistDebug({
      at: Date.now(),
      stage: "local-failed",
      itemId,
      requesterUserId,
      localTried: !!localKick?.tried,
      localAttempts: Array.isArray(localKick?.attempts)
        ? localKick.attempts.slice(0, 8)
        : []
    });

    if (localKick?.tried) {
      throw new Error("Yerel oynatıcı başlatılamadı. Sayfayı yenileyip tekrar deneyin.");
    }
    throw new Error("Yerel oynatıcı bulunamadı. Sayfayı yenileyip tekrar deneyin.");
  } catch (err) {
    console.error("Oynatma hatası:", err);
    let next = null;
    try {
      const prev = window.__jmsLastPlayNowTargetDebug || {};
      next = {
        ...prev,
        at: Date.now(),
        stage: "error",
        error: String(err?.message || err || "")
      };
      window.__jmsLastPlayNowTargetDebug = next;
      localStorage.setItem("jms:lastPlayNowDebug", JSON.stringify(next));
    } catch {}

    const userAgent = String((typeof navigator !== "undefined" && navigator.userAgent) || "");
    const isAndroid = /android/i.test(userAgent);
    const isLikelyWebView =
      /; wv\)/i.test(userAgent) ||
      /\bVersion\/\d+(\.\d+)?\b/i.test(userAgent) ||
      !!window.ReactNativeWebView;
    const isAndroidWebView = isAndroid && isLikelyWebView;
    const hasSentAttempt =
      Array.isArray(next?.attempts) &&
      next.attempts.some((attempt) => attempt?.sent === true);
    const isSoftSuccess = isAndroidWebView && next?.stage === "error" && hasSentAttempt;

    if (isSoftSuccess) {
      try {
        const soft = {
          ...next,
          at: Date.now(),
          stage: "soft-success",
          suppressedErrorBadge: true
        };
        window.__jmsLastPlayNowTargetDebug = soft;
        localStorage.setItem("jms:lastPlayNowDebug", JSON.stringify(soft));
      } catch {}
      showPlayNowSuccessNotification();
      return true;
    }

    const errorMsg = err.message || "Oynatma sırasında bir hata oluştu";
    if (typeof window.showMessage === 'function') {
      window.showMessage(errorMsg, 'error');
    }

    return false;
  }
}

async function getRandomEpisodeId(seriesId) {
  const { userId } = getSessionInfo();
  const response = await makeApiRequest(
    `/Users/${userId}/Items?ParentId=${seriesId}` +
    `&Recursive=true&IncludeItemTypes=Episode&Fields=Id`
  );
  const allEpisodes = Array.isArray(response.Items)
    ? response.Items
    : [];

  if (!allEpisodes.length) {
    throw new Error("Bölüm bulunamadı");
  }
  const randomIndex = Math.floor(Math.random() * allEpisodes.length);
  return allEpisodes[randomIndex].Id;
}

export async function getVideoStreamUrl(
  itemId,
  maxHeight = 360,
  startTimeTicks = 0,
  audioLanguage = null,
  preferredVideoCodecs = ["hevc", "h264", "av1"],
  preferredAudioCodecs = ["eac3", "ac3", "opus", "aac"],
  enableHdr = true,
  forceDirectPlay = false,
  enableHls = config.enableHls,
  { signal } = {}
) {
  if (!isAuthReadyStrict()) {
    await waitForAuthReadyStrict(3000);
  }
  const { userId, deviceId, accessToken } = getSessionInfo();

  const buildQueryParams = (params) =>
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");

  const selectPreferredCodec = (streams, type, preferred, allowCopy) => {
    if (enableHls && allowCopy) return "copy";
    const available = streams
      .filter((s) => s.Type === type && s.Codec)
      .map((s) => s.Codec.toLowerCase());

    for (const codec of preferred) {
      if (available.includes(codec.toLowerCase())) {
        return codec;
      }
    }
    return type === "Video" ? "h264" : "aac";
  };

  try {
    let item = await fetchItemDetails(itemId);
    if (!item) {
      return null;
    }
    if (item.Type === "Series") {
      itemId = await getRandomEpisodeId(itemId).catch(() => null);
      if (!itemId) return null;
      item = await fetchItemDetails(itemId);
      if (!item) return null;
    }

    if (item.Type === "Season") {
      const episodes = await makeApiRequest(`/Shows/${item.SeriesId}/Episodes?SeasonId=${itemId}&Fields=Id`);
      if (!episodes?.Items?.length) throw new Error("Bu sezonda hiç bölüm yok!");
      const episode = episodes.Items[Math.floor(Math.random() * episodes.Items.length)];
      itemId = episode.Id;
      item = await fetchItemDetails(itemId);
    }

    if (
      item.Type === "Audio" ||
      item.Type === "MusicVideo" ||
      item.MediaType === "Audio"
    ) {
    const playbackInfo = await makeApiRequest(`/Items/${itemId}/PlaybackInfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          UserId: userId,
          EnableDirectPlay: true,
          EnableDirectStream: true,
          EnableTranscoding: true
       }),
      __quiet: true,
      __preview: true
     });

    if (!playbackInfo) {
    }

      const source = playbackInfo?.MediaSources?.[0];
      if (!source) {
        console.error("Medya kaynağı bulunamadı (müzik)");
        return null;
      }

      const audioStreams = (source.MediaStreams || []).filter(s => s.Type === "Audio");
      let audioCodec = "aac";
      if (audioStreams.length) {
        const foundCodec = audioStreams[0].Codec || null;
        if (foundCodec) audioCodec = foundCodec;
      }

      let audioStreamIndex = 1;
      if (audioLanguage) {
        const audioStream = audioStreams.find(s => s.Language === audioLanguage);
        if (audioStream) audioStreamIndex = audioStream.Index;
      }

      let container = source.Container || "mp3";
      if (enableHls && source.SupportsDirectStream && (source.Container === "ts" || source.SupportsHls)) {
        const hlsParams = {
          MediaSourceId: source.Id,
          DeviceId: deviceId,
          api_key: accessToken,
          AudioCodec: audioCodec,
          AudioStreamIndex: audioStreamIndex,
          StartTimeTicks: startTimeTicks
        };
        return withServer(`/Videos/${itemId}/master.m3u8?${buildQueryParams(hlsParams)}`);
      }

      const streamParams = {
        Static: true,
        MediaSourceId: source.Id,
        DeviceId: deviceId,
        api_key: accessToken,
        AudioCodec: audioCodec,
        AudioStreamIndex: audioStreamIndex,
        StartTimeTicks: startTimeTicks
      };
      return withServer(`/Videos/${itemId}/stream.${container}?${buildQueryParams(streamParams)}`);
    }

    let playbackInfo = null;
    try {
      playbackInfo = await makeApiRequest(`/Items/${itemId}/PlaybackInfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          UserId: userId,
          MaxStreamingBitrate: 100000000,
          StartTimeTicks: startTimeTicks,
          EnableDirectPlay: forceDirectPlay,
          EnableDirectStream: true,
          EnableTranscoding: true
        }),
        __quiet: true,
        __preview: true
      });
    } catch (e) {
      const st = e?.status;
      if (st === 500 || st === 400 || st === 415) {
        try {
          playbackInfo = await makeApiRequest(`/Items/${itemId}/PlaybackInfo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              MaxStreamingBitrate: 100000000,
              StartTimeTicks: startTimeTicks,
              EnableDirectPlay: forceDirectPlay,
              EnableDirectStream: true,
              EnableTranscoding: true
            }),
            __quiet: true,
            __preview: true
          }).catch(() => null);
        } catch {}
      } else {
        throw e;
      }
    }

    if (!playbackInfo) return null;

    const videoSource = playbackInfo?.MediaSources?.[0];
    if (!videoSource) {
      console.error("Medya kaynağı bulunamadı");
      return null;
    }

    const streams = videoSource.MediaStreams || [];
    const allowCopy = videoSource.SupportsDirectStream;

    let videoCodec, audioCodec, container;
    if (enableHls) {
      videoCodec = selectPreferredCodec(streams, "Video", preferredVideoCodecs, allowCopy);
      audioCodec = selectPreferredCodec(streams, "Audio", preferredAudioCodecs, allowCopy);
      container = videoSource.Container || "mp4";
    } else {
      videoCodec = "h264";
      audioCodec = "aac";
      container = "mp4";
    }

    let audioStreamIndex = 1;
    if (audioLanguage) {
      const audioStream = streams.find(
        (s) => s.Type === "Audio" && s.Language === audioLanguage
      );
      if (audioStream) {
        audioStreamIndex = audioStream.Index;
      }
    }

    const hasHdr = streams.some((s) => s.Type === "Video" && s.VideoRangeType === "HDR");
    const hasDovi = streams.some((s) => s.Type === "Video" && s.VideoRangeType === "DOVI");

    if (enableHls) {
      const wantCopy = allowCopy === true;
      const hlsParams = {
      MediaSourceId: videoSource.Id,
      DeviceId: deviceId,
      api_key: accessToken,
      VideoCodec: wantCopy ? "copy" : "h264",
      AudioCodec: wantCopy ? "copy" : "aac",
        VideoBitrate: 1000000,
        AudioBitrate: 128000,
        MaxHeight: maxHeight,
        StartTimeTicks: startTimeTicks
      };

      if (audioLanguage) {
        const langStream = streams.find(
          (s) => s.Type === "Audio" && s.Language === audioLanguage
        );
        if (langStream) {
          hlsParams.AudioStreamIndex = langStream.Index;
        }
      }
      return withServer(`/Videos/${itemId}/master.m3u8?${buildQueryParams(hlsParams)}`);
    }

    const streamParams = {
      Static: true,
      MediaSourceId: videoSource.Id,
      DeviceId: deviceId,
      api_key: accessToken,
      VideoCodec: videoCodec,
      AudioCodec: audioCodec,
      VideoBitrate: 1000000,
      AudioBitrate: 128000,
      MaxHeight: maxHeight,
      StartTimeTicks: startTimeTicks,
      AudioStreamIndex: audioStreamIndex
    };

    if (enableHdr && hasHdr) {
      streamParams.EnableHdr = true;
      streamParams.Hdr10 = true;
      if (hasDovi) streamParams.DolbyVision = true;
    }

    return withServer(`/Videos/${itemId}/stream.${container}?${buildQueryParams(streamParams)}`);

  } catch (error) {
    const st = error?.status;
    if (st === 404 || st === 400 || st === 415 || st === 500) return null;
    if (error?.name === "AbortError" || error?.isAbort) return null;
    console.warn("Stream URL oluşturma hatası:", error);
    return null;
  }
}

function getAudioStreamIndex(videoSource, audioLanguage) {
  const audioStream = videoSource.MediaStreams.find(
    s => s.Type === "Audio" && s.Language === audioLanguage
  );
  return audioStream ? audioStream.Index : 1;
}

export async function getIntroVideoUrl(itemId) {
  try {
    const { userId } = getSessionInfo();
    const response = await makeApiRequest(`/Items/${itemId}/Intros`);
    const intros = response.Items || [];
    if (intros.length > 0) {
      const intro = intros[0];
      const startTimeTicks = 600 * 10_000_000;
      const url = await getVideoStreamUrl(intro.Id, 360, startTimeTicks);
      return url;
    }
    return null;
  } catch (error) {
    console.error("Intro video alınırken hata:", error);
    return null;
  }
}

const videoPreviewCache = new Map();

export async function getCachedVideoPreview(itemId) {
  if (videoPreviewCache.has(itemId)) {
    return videoPreviewCache.get(itemId);
  }

  const url = await getVideoStreamUrl(itemId, 360, 0);
  if (url) {
    videoPreviewCache.set(itemId, url);
    setTimeout(() => videoPreviewCache.delete(itemId), 300000);
    if (videoPreviewCache.size > MAX_PREVIEW_CACHE) pruneMapBySize(videoPreviewCache, MAX_PREVIEW_CACHE);
  }

  return url;
}

export {
  makeApiRequest,
};

export async function getUserTopGenres(limit = 5, itemType = null) {
  const cacheKey = "userTopGenres_v2";
  const cacheTTL = 24 * 60 * 60 * 1000;
  const currentUserId = getCachedUserId();

  const cachedRaw = localStorage.getItem(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached.userId === currentUserId &&
          Date.now() - cached.timestamp < cacheTTL) {
        return cached.genres.slice(0, limit);
      }
    } catch (e) {
      localStorage.removeItem(cacheKey);
    }
  }

  try {
    const { userId } = getSessionInfo();
    const recentlyPlayed = await makeApiRequest(
      `/Users/${userId}/Items/Resume?Limit=50&MediaTypes=Video`
    );

    const items = recentlyPlayed.Items || [];
    if (items.length === 0) {
      return ['Action', 'Drama', 'Comedy', 'Sci-Fi', 'Adventure'].slice(0, limit);
    }

    const dotItems = Array.from(document.querySelectorAll('.poster-dot'))
      .map(dot => dot.dataset.itemId)
      .filter(Boolean);

    const prioritizedItems = items.sort((a, b) => {
      const aInDots = dotItems.includes(a.Id) ? 1 : 0;
      const bInDots = dotItems.includes(b.Id) ? 1 : 0;
      return bInDots - aInDots;
    }).slice(0, 30);

    const genreCounts = {};
    for (const item of prioritizedItems) {
      const genres = await getGenresForDot(item.Id);
      genres.forEach(genre => {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      });
    }

    const sortedGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre);

    const result = sortedGenres.length > 0
      ? sortedGenres.slice(0, limit)
      : ['Action', 'Drama', 'Comedy', 'Sci-Fi', 'Adventure'].slice(0, limit);

    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      genres: result,
      userId: currentUserId
    }));

    return result;
  } catch (error) {
    console.error("❌ getUserTopGenres hatası:", error);
    return ['Action', 'Drama', 'Comedy', 'Sci-Fi', 'Adventure'].slice(0, limit);
  }
}

function extractGenresFromItems(items) {
  const genreCounts = {};

  items.forEach(item => {
    let genres = [];
    if (item.GenreItems && Array.isArray(item.GenreItems)) {
      genres = item.GenreItems.map(g => g.Name);
    }
    else if (Array.isArray(item.Genres) && item.Genres.every(g => typeof g === 'string')) {
      genres = item.Genres;
    }
    else if (Array.isArray(item.Genres) && item.Genres[0]?.Name) {
      genres = item.Genres.map(g => g.Name);
    }
    else if (item.Tags && Array.isArray(item.Tags)) {
      genres = item.Tags.filter(tag =>
        ['action','drama','comedy','sci-fi','adventure']
          .includes(tag.toLowerCase())
      );
    }

    if (genres.length > 0) {
      genres.forEach(genre => {
        if (genre) {
          genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        }
      });
    } else {
      console.warn(`ℹ️ Tür bilgisi okunamadı → ID: ${item.Id} | Ad: ${item.Name || 'İsimsiz'}`);
    }
  });

  return Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);
}

function getCachedUserId() {
  try {
    return getSessionInfo().userId;
  } catch {
    return null;
  }
}

function checkAndClearCacheOnUserChange(cacheKey, currentUserId) {
  const cachedRaw = localStorage.getItem(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached.userId && cached.userId !== currentUserId) {
        console.log("👤 Kullanıcı değişti, cache temizleniyor:", cacheKey);
        localStorage.removeItem(cacheKey);
      }
    } catch {
      localStorage.removeItem(cacheKey);
    }
  }
}

let __lastUserForCaches = null;
function clearAllInMemoryCaches() {
  itemCache.clear();
  dotGenreCache.clear();
  notFoundTombstone.clear();
  videoPreviewCache.clear();
}
function ensureUserCacheIsolation() {
  const uid = getCachedUserId();
  if (!uid) return;
  if (__lastUserForCaches && __lastUserForCaches !== uid) {
    clearAllInMemoryCaches();
  }
  __lastUserForCaches = uid;
}

export async function getCachedItemDetails(itemId) {
  ensureUserCacheIsolation();
  return getCachedItemDetailsInternal(itemId);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', clearAllInMemoryCaches, { once: true });
  window.addEventListener('storage', (e) => {
    if (["json-credentials", "embyToken", "serverId"].includes(e.key)) {
      console.log("🗝️ Storage değişti → cache temizleniyor");
      nukeAllCachesAndLocalUserCaches();
      __lastAuthSnapshot = null;
      invalidateServerBaseCache();
      if (e.key === "json-credentials" && (e.newValue === null || e.newValue === undefined)) {
        clearPersistedIdentity();
      }
    }
    if (e.key === SERVER_ADDR_KEY) {
      invalidateServerBaseCache();
    }
  });
}

export async function getCachedUserTopGenres(limit = 50, itemType = null) {
  const cacheKey = "userTopGenresCache";
  const cacheTTL = 1000 * 60 * 60 * 24;
  const currentUserId = getCachedUserId();

  checkAndClearCacheOnUserChange(cacheKey, currentUserId);

  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      const now = Date.now();

      if (cached.timestamp && now - cached.timestamp < cacheTTL) {
        return cached.genres.slice(0, limit);
      }
    }

    const genres = await getUserTopGenres(limit, itemType);
    const cacheData = {
      timestamp: Date.now(),
      genres,
      userId: currentUserId
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    return genres;

  } catch (error) {
    console.error("Tür bilgisi cache alınırken hata:", error);
    return getUserTopGenres(limit, itemType);
  }
}

export async function getGenresForDot(itemId) {
  const cached = dotGenreCache.get(itemId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.genres;

  try {
    const details = await fetchItemDetails(itemId);
    const genres = details ? extractGenresFromItem(details) : [];
    dotGenreCache.set(itemId, { timestamp: Date.now(), genres });
    pruneMapBySize(dotGenreCache, MAX_DOT_GENRE_CACHE);
    return genres;
  } catch {
    return [];
  }
}

function extractGenresFromItem(item) {
  if (!item) return [];

  if (item.GenreItems && Array.isArray(item.GenreItems)) {
    return item.GenreItems.map(g => g.Name);
  }
  else if (Array.isArray(item.Genres) && item.Genres.every(g => typeof g === 'string')) {
    return item.Genres;
  }
  else if (Array.isArray(item.Genres) && item.Genres[0]?.Name) {
    return item.Genres.map(g => g.Name);
  }
  else if (item.Tags && Array.isArray(item.Tags)) {
    return item.Tags.filter(tag =>
      ['action','drama','comedy','sci-fi','adventure']
        .includes(tag.toLowerCase())
    );
  }
  return [];
}

export function hardSignOutCleanup() {
  try {
    localStorage.removeItem("json-credentials");
    sessionStorage.removeItem("json-credentials");
    localStorage.removeItem("embyToken");
    sessionStorage.removeItem("embyToken");
    localStorage.removeItem("jf_serverAddress");
    sessionStorage.removeItem("jf_serverAddress");
    localStorage.removeItem(USER_ID_KEY);
    sessionStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(DEVICE_ID_KEY);
    sessionStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(USER_ID_KEY);
    sessionStorage.removeItem(USER_ID_KEY);
  } catch {}
  nukeAllCachesAndLocalUserCaches();
  __lastAuthSnapshot = null;
}

export function clearLocalIdentityForDebug() {
  clearPersistedIdentity();
}

if (typeof window !== "undefined") {
  window.__JMS_API = window.__JMS_API || {};
  Object.assign(window.__JMS_API, { getSessionInfo, makeApiRequest });
}
