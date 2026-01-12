const DB_NAME = "jms-slider-cache";
const DB_VER = 1;

const DEFAULTS = {
  itemTtlMs: 24 * 60 * 60 * 1000,
  queryTtlMs: 2 * 60 * 1000,
  resumeTtlMs: 30 * 1000,
  listFileTtlMs: 60 * 1000,
  allowStaleOnError: true,
  maxConcurrent: 6,
};

let _dbPromise = null;
let _dbDisabled = false;

const mem = {
  item: new Map(),
  query: new Map(),
  meta: new Map(),
};

function now() { return Date.now(); }

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function makeKey(parts) {
  const s = parts.map(p => {
    if (p == null) return "";
    if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") return String(p);
    try { return JSON.stringify(p); } catch { return String(p); }
  }).join("|");
  return fnv1a(s);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request error"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB tx error"));
  });
}

async function openDb() {
  if (_dbDisabled) return null;
  if (_dbPromise) return _dbPromise;

  if (typeof indexedDB === "undefined") {
    _dbDisabled = true;
    return null;
  }

  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains("itemDetails")) {
          const st = db.createObjectStore("itemDetails", { keyPath: "id" });
          st.createIndex("expiresAt", "expiresAt", { unique: false });
          st.createIndex("fetchedAt", "fetchedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("queryCache")) {
          const st = db.createObjectStore("queryCache", { keyPath: "key" });
          st.createIndex("expiresAt", "expiresAt", { unique: false });
          st.createIndex("fetchedAt", "fetchedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "k" });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("[JMS][cache] IndexedDB open failed, fallback to memory:", req.error);
        _dbDisabled = true;
        resolve(null);
      };
    } catch (e) {
      console.warn("[JMS][cache] IndexedDB init failed, fallback to memory:", e);
      _dbDisabled = true;
      resolve(null);
    }
  });

  return _dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null, null, true);

  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const out = await fn(store, tx, false);
  await txDone(tx);
  return out;
}

function isFresh(entry) {
  return entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now();
}

export async function cacheGetItem(id, { allowStale = false } = {}) {
  if (!id) return null;

  return withStore("itemDetails", "readonly", async (store, _tx, memFallback) => {
    if (memFallback) {
      const e = mem.item.get(id) || null;
      if (!e) return null;
      if (isFresh(e) || allowStale) return e.data;
      return null;
    }

    const row = await reqToPromise(store.get(id)).catch(() => null);
    if (!row) return null;
    if (row.expiresAt > now() || allowStale) return row.data;
    return null;
  });
}

export async function cachePutItem(id, data, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  if (!id) return false;
  const entry = {
    id,
    data,
    fetchedAt: now(),
    expiresAt: now() + Math.max(5_000, ttlMs | 0),
  };

  return withStore("itemDetails", "readwrite", async (store, _tx, memFallback) => {
    try {
      if (memFallback) {
        mem.item.set(id, entry);
        return true;
      }
      await reqToPromise(store.put(entry));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItem failed:", e);
      return false;
    }
  });
}

export async function cacheGetQuery(key, { allowStale = false } = {}) {
  if (!key) return null;

  return withStore("queryCache", "readonly", async (store, _tx, memFallback) => {
    if (memFallback) {
      const e = mem.query.get(key) || null;
      if (!e) return null;
      if (isFresh(e) || allowStale) return e.data;
      return null;
    }

    const row = await reqToPromise(store.get(key)).catch(() => null);
    if (!row) return null;
    if (row.expiresAt > now() || allowStale) return row.data;
    return null;
  });
}

export async function cachePutQuery(key, data, { ttlMs = DEFAULTS.queryTtlMs } = {}) {
  if (!key) return false;
  const entry = {
    key,
    data,
    fetchedAt: now(),
    expiresAt: now() + Math.max(3_000, ttlMs | 0),
  };

  return withStore("queryCache", "readwrite", async (store, _tx, memFallback) => {
    try {
      if (memFallback) {
        mem.query.set(key, entry);
        return true;
      }
      await reqToPromise(store.put(entry));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutQuery failed:", e);
      return false;
    }
  });
}

export async function metaGet(k) {
  if (!k) return null;
  return withStore("meta", "readonly", async (store, _tx, memFallback) => {
    if (memFallback) return mem.meta.get(k) ?? null;
    const row = await reqToPromise(store.get(k)).catch(() => null);
    return row ? row.v : null;
  });
}

export async function metaPut(k, v) {
  if (!k) return false;
  return withStore("meta", "readwrite", async (store, _tx, memFallback) => {
    try {
      if (memFallback) { mem.meta.set(k, v); return true; }
      await reqToPromise(store.put({ k, v }));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] metaPut failed:", e);
      return false;
    }
  });
}

async function mapLimit(arr, limit, mapper) {
  const out = new Array(arr.length);
  let idx = 0;

  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (idx < arr.length) {
      const cur = idx++;
      try { out[cur] = await mapper(arr[cur], cur); }
      catch (e) { out[cur] = null; }
    }
  });

  await Promise.all(workers);
  return out;
}

export async function cachedFetchText({
  keyParts,
  fetchText,
  url,
  ttlMs = DEFAULTS.listFileTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  const key = makeKey(["text", ...keyParts]);
  const cached = await cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "text") {
    if (cached.expiresAt > now()) return cached.text;
  }

  try {
    const text = await fetchText(url);
    await cachePutQuery(key, { __type: "text", text, expiresAt: now() + ttlMs }, { ttlMs });
    return text;
  } catch (e) {
    if (allowStaleOnError && cached && cached.__type === "text") return cached.text;
    throw e;
  }
}

export async function cachedFetchJson({
  keyParts,
  fetchJson,
  url,
  opts,
  ttlMs = DEFAULTS.queryTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  const key = makeKey(["json", ...keyParts]);
  const cached = await cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "json") {
    if (cached.expiresAt > now()) return cached.data;
  }

  try {
    const data = await fetchJson(url, opts);
    await cachePutQuery(key, { __type: "json", data, expiresAt: now() + ttlMs }, { ttlMs });
    return data;
  } catch (e) {
    if (allowStaleOnError && cached && cached.__type === "json") return cached.data;
    throw e;
  }
}

export function createCachedItemDetailsFetcher({
  fetchOne,
  fetchMany = null,
  batchSize = 60,
  ttlMs = DEFAULTS.itemTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
  maxConcurrent = DEFAULTS.maxConcurrent,
}) {
  if (typeof fetchOne !== "function") throw new Error("fetchOne required");

  const inflight = new Map();

  async function getOne(id) {
    if (!id) return null;

    const fresh = await cacheGetItem(id, { allowStale: false });
    if (fresh) return fresh;
    if (inflight.has(id)) return inflight.get(id);

    const p = (async () => {
      const stale = allowStaleOnError ? await cacheGetItem(id, { allowStale: true }) : null;

      try {
        const data = await fetchOne(id);
        if (data) await cachePutItem(id, data, { ttlMs });
        return data || stale;
      } catch (e) {
        if (allowStaleOnError && stale) return stale;
        throw e;
      } finally {
        inflight.delete(id);
      }
    })();

    inflight.set(id, p);
    return p;
  }

  getOne.many = async function(ids) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return [];

    const out = new Array(list.length).fill(null);
    const missing = [];

    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const hit = await cacheGetItem(id, { allowStale: false });
      if (hit) out[i] = hit;
      else if (id) missing.push(id);
    }

    if (missing.length && typeof fetchMany === "function") {
      const uniq = Array.from(new Set(missing));
      const bs = Math.max(10, Math.min(200, (batchSize | 0) || 60));

      let bulkOk = true;
      for (let start = 0; start < uniq.length; start += bs) {
        const chunk = uniq.slice(start, start + bs);
        try {
          const items = await fetchMany(chunk);
          if (Array.isArray(items)) {
            for (const it of items) {
              const id = it && (it.Id || it.id);
              if (id) await cachePutItem(id, it, { ttlMs });
            }
          }
        } catch (e) {
          bulkOk = false;
          break;
        }
      }

      if (bulkOk) {
        for (let i = 0; i < list.length; i++) {
          if (out[i]) continue;
          const id = list[i];
          const hit = await cacheGetItem(id, { allowStale: false });
          if (hit) out[i] = hit;
        }
      }
    }

    const remainingIdx = [];
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) remainingIdx.push(i);
    }
    if (remainingIdx.length) {
      const results = await mapLimit(remainingIdx, maxConcurrent, async (i) => getOne(list[i]));
      for (let k = 0; k < remainingIdx.length; k++) {
        out[remainingIdx[k]] = results[k];
      }
    }
    return out;
  };
  return getOne;
}

export function startLibraryDeltaWatcher({
  userId,
  fetchJson,
  getAuthHeaders,
  fetchItemDetailsCached,
  intervalMs = 60_000,
  limit = 50,
  includeItemTypes = null,
}) {
  if (!userId) return () => {};
  if (typeof fetchJson !== "function") throw new Error("fetchJson required");
  if (typeof getAuthHeaders !== "function") throw new Error("getAuthHeaders required");
  if (typeof fetchItemDetailsCached !== "function") throw new Error("fetchItemDetailsCached required");

  let stopped = false;
  let timer = null;

  const metaKey = `latestCursor:${userId}`;

  async function tick() {
    if (stopped) return;

    const headers = getAuthHeaders() || {};
    const opts = { headers };

    let latest = null;
    try {
      const qs = new URLSearchParams();
      qs.set("Limit", String(limit));
      if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
      qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
      latest = await fetchJson(`/Users/${userId}/Items/Latest?${qs.toString()}`, opts);
    } catch {
      latest = null;
    }

    if (!latest) {
      try {
        const qs = new URLSearchParams();
        qs.set("Recursive", "true");
        qs.set("SortBy", "DateCreated");
        qs.set("SortOrder", "Descending");
        qs.set("Limit", String(limit));
        if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
        qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
        const data = await fetchJson(`/Users/${userId}/Items?${qs.toString()}`, opts);
        latest = data?.Items || [];
      } catch {
        latest = [];
      }
    }

    const arr = Array.isArray(latest) ? latest : (latest?.Items || []);
    if (!arr.length) return;

    const cursor = await metaGet(metaKey);
    const lastSeen = cursor?.lastSeenDateCreated ? Date.parse(cursor.lastSeenDateCreated) : 0;
    const newOnes = [];
    let maxSeen = lastSeen;

    for (const it of arr) {
      const id = it?.Id || it?.id;
      const dc = it?.DateCreated || it?.dateCreated;
      const t = dc ? Date.parse(dc) : 0;
      if (t && t > maxSeen) maxSeen = t;
      if (id && t && t > lastSeen) newOnes.push(id);
    }

    if (newOnes.length) {
      try {
        await fetchItemDetailsCached.many(newOnes.slice(0, 20));
      } catch {}
    }

    if (maxSeen > lastSeen) {
      await metaPut(metaKey, { lastSeenDateCreated: new Date(maxSeen).toISOString() });
    }
  }

  async function loop() {
    if (stopped) return;
    try { await tick(); } catch {}
    if (stopped) return;
    timer = setTimeout(loop, Math.max(10_000, intervalMs | 0));
  }

  loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
