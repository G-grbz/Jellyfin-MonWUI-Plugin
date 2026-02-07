const SERVER_ADDR_KEY = "jf_serverAddress";
const SERVER_BASE_MICRO_CACHE_MS = 1500;

let __serverBaseCache = "";
let __serverBaseCacheAt = 0;

function normalizeServerBase(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().replace(/\/+$/, "");
}

function isAbsoluteUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function isOriginOnly(base) {
  try {
    if (!base) return true;
    return /^https?:\/\/[^/]+\/?$/i.test(String(base).trim());
  } catch {
    return false;
  }
}

function getBaseFromBaseTag() {
  try {
    if (typeof document === "undefined") return "";
    const baseEl = document.querySelector("base[href]");
    const href = baseEl?.getAttribute("href");
    if (!href) return "";

    const u = new URL(href, window.location.href);
    const basePath = String(u.pathname || "").replace(/\/web\/?$/i, "");
    return normalizeServerBase(u.origin + basePath);
  } catch {
    return "";
  }
}

function getBaseFromLocation() {
  try {
    if (typeof window === "undefined" || !window.location) return "";
    const { origin, pathname } = window.location;
    if (!origin) return "";

    const fromBase = getBaseFromBaseTag();
    if (fromBase) return fromBase;

    const p = String(pathname || "");
    const m = p.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
    const basePath = (m && m[1]) ? m[1] : "";
    return normalizeServerBase(origin + basePath);
  } catch {
    return "";
  }
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

function persistServerBase(base) {
  const b = normalizeServerBase(base);
  if (!b) return;
  try { localStorage.setItem(SERVER_ADDR_KEY, b); } catch {}
  try { sessionStorage.setItem(SERVER_ADDR_KEY, b); } catch {}
}


export function resolveServerBase({ getServerAddress } = {}) {
  try {
    const loc = getBaseFromLocation();
    if (loc) { persistServerBase(loc); return loc; }
  } catch {}

  try {
    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    const apiBase =
      (api && typeof api.serverAddress === "function" ? api.serverAddress()
      : (api && typeof api.serverAddress === "string" ? api.serverAddress : "")) || "";
    const fromApi = normalizeServerBase(apiBase);
    if (fromApi && !isOriginOnly(fromApi)) { persistServerBase(fromApi); return fromApi; }
  } catch {}

  try {
    const cfg = normalizeServerBase(getServerAddress?.() || "");
    if (cfg) { persistServerBase(cfg); return cfg; }
  } catch {}

  return readStoredServerBase();
}

export function getServerBaseCached(opts) {
  const now = Date.now();
  if (__serverBaseCache && (now - __serverBaseCacheAt) < SERVER_BASE_MICRO_CACHE_MS) {
    return __serverBaseCache;
  }
  __serverBaseCache = resolveServerBase(opts);
  __serverBaseCacheAt = now;
  return __serverBaseCache;
}

export function invalidateServerBaseCache() {
  __serverBaseCache = "";
  __serverBaseCacheAt = 0;
}

export function joinServerUrl(base, pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;

  const baseNorm = normalizeServerBase(base);
  if (!baseNorm) return pathOrUrl;

  const p = String(pathOrUrl).trim();
  if (!p) return baseNorm;

  if (p.startsWith("//")) {
    const proto = (typeof window !== "undefined" && window.location && window.location.protocol)
      ? window.location.protocol : "https:";
    return `${proto}${p}`;
  }

  if (p.startsWith("/")) return `${baseNorm}${p}`;

  return `${baseNorm}/${p}`;
}

export function withServer(pathOrUrl, opts) {
  return joinServerUrl(getServerBaseCached(opts), pathOrUrl);
}

export function withServerSrcset(srcset = "", opts) {
  if (!srcset || typeof srcset !== "string") return "";
  return srcset
    .split(",")
    .map(part => {
      const p = part.trim();
      if (!p) return "";
      const m = p.match(/^(\S+)(\s+.+)?$/);
      if (!m) return p;
      const url = m[1];
      const desc = m[2] || "";
      return `${withServer(url, opts)}${desc}`;
    })
    .filter(Boolean)
    .join(", ");
}

export function buildJfUrl(pathOrUrl, opts) {
  return withServer(pathOrUrl, opts);
}

export function withParams(pathOrUrl, params = {}, opts) {
  const baseUrl = withServer(pathOrUrl, opts);

  try {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    const qs = Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (!qs) return baseUrl;
    return baseUrl.includes("?") ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`;
  }
}
