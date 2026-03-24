const CONFIG_URL = "/JMSFusion/config";
const CONFIG_CACHE_MS = 30_000;

let __pluginConfigCache = null;
let __pluginConfigLoadedAt = 0;
let __pluginConfigPromise = null;

function getTokenSafe() {
  try {
    return window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken || "";
  } catch {
    return "";
  }
}

async function getUserIdSafe() {
  try {
    const user = await window.ApiClient?.getCurrentUser?.();
    return user?.Id || "";
  } catch {
    return "";
  }
}

async function getAuthHeaders() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const token = getTokenSafe();
  const userId = await getUserIdSafe();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

function normalizePluginConfigResponse(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.cfg && typeof payload.cfg === "object") return payload.cfg;
  return payload;
}

export function sanitizeTmdbApiKey(value) {
  const key = String(value || "").trim();
  if (!key || /^CHANGE_ME$/i.test(key)) return "";
  return key;
}

export async function fetchJmsPluginConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && __pluginConfigCache && (now - __pluginConfigLoadedAt) < CONFIG_CACHE_MS) {
    return __pluginConfigCache;
  }
  if (!force && __pluginConfigPromise) return __pluginConfigPromise;

  __pluginConfigPromise = (async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(CONFIG_URL, {
      method: "GET",
      cache: "no-store",
      headers,
    });
    if (!res.ok) {
      throw new Error(`JMS config HTTP ${res.status}`);
    }
    const data = await res.json();
    __pluginConfigCache = normalizePluginConfigResponse(data);
    __pluginConfigLoadedAt = Date.now();
    return __pluginConfigCache;
  })();

  try {
    return await __pluginConfigPromise;
  } finally {
    __pluginConfigPromise = null;
  }
}

export async function updateJmsPluginConfig(patch = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(CONFIG_URL, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(patch || {}),
  });
  if (!res.ok) {
    let msg = `JMS config HTTP ${res.status}`;
    try {
      const raw = await res.text();
      if (raw) msg = raw;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json().catch(() => ({}));
  __pluginConfigCache = normalizePluginConfigResponse(data);
  __pluginConfigLoadedAt = Date.now();
  return __pluginConfigCache;
}

export async function getGlobalTmdbApiKey({ force = false } = {}) {
  const cfg = await fetchJmsPluginConfig({ force });
  return sanitizeTmdbApiKey(cfg?.TmdbApiKey ?? cfg?.tmdbApiKey);
}
