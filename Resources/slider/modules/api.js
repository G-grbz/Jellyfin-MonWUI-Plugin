import { getConfig, getServerAddress } from "./config.js";
import { clearCredentials, getWebClientHints, getStoredServerBase } from "../auth.js";
import { withServer, withServerSrcset, invalidateServerBaseCache, resolveServerBase } from "./jfUrl.js";

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
    const cm = await import('./cacheManager.js').catch(() => null);
    const cu = await import('./containerUtils.js').catch(() => null);
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

export function getSessionInfo() {
  try {
    const raw = localStorage.getItem("jellyfin_credentials") || localStorage.getItem("emby_credentials") || "";
    const creds = raw ? JSON.parse(raw) : {};
    const active = pickActiveServerEntry(creds);
    const accessToken = String(active?.AccessToken || creds?.AccessToken || "");
    const userId = String(active?.UserId || creds?.User?.Id || creds?.userId || "");

    return {
      ...creds,
      accessToken,
      userId,
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
      const errorData = await response.json().catch(() => ({}));
      const errorMsg =
        errorData.message ||
        (errorData.Title && errorData.Description
          ? `${errorData.Title}: ${errorData.Description}`
          : `API isteği başarısız oldu (durum: ${response.status})`);

      const err = new Error(errorMsg);
      err.status = response.status;
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
    if (!is403 && !is404 && !is401) {
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
  "ImageTags","BackdropImageTags",
  "UserData","MediaStreams","Series"
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
export async function updateFavoriteStatus(itemId, isFavorite) {
  const { userId } = getSessionInfo();
  return makeApiRequest(`/Users/${userId}/Items/${itemId}/UserData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ IsFavorite: isFavorite })
  });
}

export async function updatePlayedStatus(itemId, played) {
  const { userId } = getSessionInfo();
  return makeApiRequest(`/Users/${userId}/Items/${itemId}/UserData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ Played: played })
  });
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

function scoreSessionCandidate(s, self) {
  let score = 0;
  const storedUserId = getStoredUserId();
  const apiDev = getStoredDeviceId();
  if (apiDev && s?.DeviceId === apiDev) score += 200;


  if (s?.Id && self.sessionId && s.Id === self.sessionId) score += 120;
  if (s?.DeviceId && self.deviceId && s.DeviceId === self.deviceId) score += 100;
  if (s?.AccessToken && self.accessToken && s.AccessToken === self.accessToken) score += 60;
  if (s?.UserId && s.UserId === self.userId) score += 30;
  if (storedUserId && s?.UserId === storedUserId) score += 40;

  const sClient = (s?.Client || "").toLowerCase();
  const myClient = (self.clientName || "").toLowerCase();
  if (sClient && myClient && (sClient.includes("web") || sClient.includes(myClient))) score += 15;

  const last = s?.LastActivityDate ? new Date(s.LastActivityDate).getTime() : 0;
  if (last && Date.now() - last < 2 * 60 * 1000) score += 10;
  if (s?.SupportsRemoteControl) score += 6;

  return score;
}

function resolveSelfSession(videoClients, self, { allowLastActiveFallback = false } = {}) {
  const ranked = videoClients
    .map((s) => ({ s, score: scoreSessionCandidate(s, self) }))
    .sort((a, b) => b.score - a.score);

  const MIN_SCORE = 100;
  if (ranked.length && ranked[0].score >= MIN_SCORE) {
    return ranked[0].s;
  }

  if (allowLastActiveFallback && ranked.length) {
    return ranked[0].s;
  }

  return null;
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
    const storedUserId = getStoredUserId() || self.userId;

    let item = await fetchItemDetails(itemId);
    if (!item) throw new Error("Öğe bulunamadı");
    if (item.Type === "Series") {
      const best = await getBestEpisodeIdForSeries(item.Id, self.userId);
      if (!best) throw new Error("Bölüm bulunamadı");
      itemId = best;
      item = await fetchItemDetails(itemId);
    }
    if (item.Type === "Season") {
      const best = await getBestEpisodeIdForSeason(item.Id, item.SeriesId, self.userId);
      if (!best) throw new Error("Bu sezonda hiç bölüm yok!");
      itemId = best;
      item = await fetchItemDetails(itemId);
    }
    const sessions = await makeApiRequest(`/Sessions`);
    const allClients = Array.isArray(sessions) ? sessions : [];
    const videoClients = allClients.filter(s =>
      s?.Capabilities?.PlayableMediaTypes?.includes("Video")
    );

    if (!videoClients.length) {
      throw new Error("Video oynatıcı bulunamadı. Lütfen bir TV/telefon uygulaması açın.");
    }
    const storedApiDevId = getStoredDeviceId();
    let target = null;
    if (storedApiDevId && storedUserId) {
      target = videoClients.find(s =>
        s?.DeviceId === storedApiDevId && s?.UserId === storedUserId
      ) || null;
    }
    if (!target && storedApiDevId) {
      target = videoClients.find(s => s?.DeviceId === storedApiDevId) || null;
    }
    if (!target) {
      target = videoClients.find(s =>
        s?.UserId === storedUserId && self?.deviceId && s?.DeviceId === self.deviceId
      ) || null;
    }
    if (!target) {
      target = videoClients.find(s => s?.UserId === storedUserId) || null;
    }
    if (!target && self?.sessionId) {
      target = videoClients.find(s => s?.Id === self.sessionId) || null;
    }
    if (!target) {
      target = videoClients
        .filter(s => s?.LastActivityDate)
        .sort((a, b) => new Date(b.LastActivityDate) - new Date(a.LastActivityDate))[0] || null;
    }

    if (!target) {
      throw new Error("Uygun oynatıcı cihaz bulunamadı");
    }

    if (target.UserId && target.UserId !== storedUserId) {
      console.warn("Hedef cihaz farklı kullanıcıya ait, yine de denenecek");
    }
    const userItemData = await makeApiRequest(`/Users/${self.userId}/Items/${itemId}`);
    const resumeTicks = userItemData?.UserData?.PlaybackPositionTicks || 0;
    const playCommand = resumeTicks > 0 ? "PlayNow" : "PlayNow";
    let playUrl = `/Sessions/${target.Id}/Playing?playCommand=${playCommand}&itemIds=${itemId}`;

    if (resumeTicks > 0) {
      playUrl += `&StartPositionTicks=${resumeTicks}`;
    }
    const res = await fetch(withServer(playUrl), {
  method: "POST",
  headers: buildEmbyHeaders({ 'Content-Type': 'application/json' }),
  credentials: 'same-origin'
});

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Oynatma komutu başarısız: ${res.status} ${errorText}`);
    }

    window.currentPlayingItemId = itemId;
    if (target.DeviceName) {
      console.log(`Oynatma komutu gönderildi: ${target.DeviceName}`);
    }
    return true;
  } catch (err) {
    console.error("Oynatma hatası:", err);
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
  enableHls = config.enableHls
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
        body: JSON.stringify({
          UserId: userId,
          EnableDirectPlay: true,
          EnableDirectStream: true,
          EnableTranscoding: true
        })
      });

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

    const playbackInfo = await makeApiRequest(`/Items/${itemId}/PlaybackInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        UserId: userId,
        MaxStreamingBitrate: 100000000,
        StartTimeTicks: startTimeTicks,
        EnableDirectPlay: forceDirectPlay,
        EnableDirectStream: true,
        EnableTranscoding: true
      })
    });

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
    console.error("Stream URL oluşturma hatası:", error);
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
