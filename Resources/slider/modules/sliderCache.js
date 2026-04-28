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

const BACKGROUND_WARM_META_PREFIX = "itemWarmQueue:";
const backgroundWarmJobs = new Map();

export async function prepareSliderCacheDbForDeletion() {
  stopAllBackgroundWarmJobs();

  try {
    window.dispatchEvent(new CustomEvent("jms:indexeddb:release", {
      detail: { dbName: DB_NAME }
    }));
  } catch {}

  const db = await Promise.resolve(_dbPromise).catch(() => null);
  try { db?.close?.(); } catch {}

  _dbPromise = null;
  _dbDisabled = false;
  mem.item.clear();
  mem.query.clear();
  mem.meta.clear();
}

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

function normalizeTtlMs(ttlMs, fallbackMs) {
  const value = Number(ttlMs);
  return Math.max(fallbackMs, Number.isFinite(value) ? value : fallbackMs);
}

function createItemCacheEntry(id, data, ttlMs = DEFAULTS.itemTtlMs) {
  const fetchedAt = now();
  return {
    id,
    data,
    fetchedAt,
    expiresAt: fetchedAt + normalizeTtlMs(ttlMs, 5_000),
  };
}

function dedupeIds(ids) {
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = raw == null ? "" : String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
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
  const entry = createItemCacheEntry(id, data, ttlMs);

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

export async function cacheGetItemsMap(ids, { allowStale = false } = {}) {
  const uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStore("itemDetails", "readonly", async (store, _tx, memFallback) => {
    const out = new Map();

    if (memFallback) {
      for (const id of uniq) {
        const entry = mem.item.get(id) || null;
        if (!entry) continue;
        if (isFresh(entry) || allowStale) out.set(id, entry.data);
      }
      return out;
    }

    const requests = uniq.map((id) => [id, store.get(id)]);
    const rows = await Promise.all(
      requests.map(async ([id, req]) => [id, await reqToPromise(req).catch(() => null)])
    );

    for (const [id, row] of rows) {
      if (!row) continue;
      if (row.expiresAt > now() || allowStale) out.set(id, row.data);
    }

    return out;
  });
}

export async function cachePutItems(items, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  const fetchedAt = now();
  const expiresAt = fetchedAt + normalizeTtlMs(ttlMs, 5_000);
  const entries = [];

  for (const raw of Array.isArray(items) ? items : []) {
    const hasWrappedData = !!(
      raw &&
      typeof raw === "object" &&
      Object.prototype.hasOwnProperty.call(raw, "data") &&
      (Object.prototype.hasOwnProperty.call(raw, "id") || Object.prototype.hasOwnProperty.call(raw, "Id"))
    );
    const data = hasWrappedData ? raw.data : raw;
    const id = hasWrappedData
      ? (raw.id || raw.Id)
      : (data?.Id || data?.id);
    if (!id || !data) continue;
    entries.push({
      id: String(id),
      data,
      fetchedAt,
      expiresAt,
    });
  }

  if (!entries.length) return 0;

  return withStore("itemDetails", "readwrite", async (store, _tx, memFallback) => {
    try {
      if (memFallback) {
        for (const entry of entries) mem.item.set(entry.id, entry);
        return entries.length;
      }

      const puts = entries.map((entry) => reqToPromise(store.put(entry)));
      await Promise.all(puts);
      return entries.length;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItems failed:", e);
      return 0;
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
    expiresAt: now() + normalizeTtlMs(ttlMs, 3_000),
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

function createScheduledTask(run, delayMs = 0) {
  const delay = Math.max(0, Number(delayMs) || 0);

  if (delay > 0) {
    return { kind: "timeout", id: setTimeout(run, delay) };
  }

  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return {
      kind: "idle",
      id: window.requestIdleCallback(run, { timeout: 700 })
    };
  }

  return { kind: "timeout", id: setTimeout(run, 0) };
}

function cancelScheduledTask(task) {
  if (!task) return;

  try {
    if (task.kind === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(task.id);
      return;
    }
    clearTimeout(task.id);
  } catch {}
}

async function persistBackgroundWarmJob(job) {
  if (!job?.metaKey) return false;

  return metaPut(job.metaKey, {
    version: 1,
    scopeKey: job.scopeKey,
    ids: Array.isArray(job.ids) ? job.ids.slice() : [],
    cursor: Math.max(0, Number(job.cursor) || 0),
    updatedAt: now(),
    done: !!job.done,
    lastError: job.lastError || "",
  });
}

async function restoreBackgroundWarmIds(scopeKey) {
  const state = await metaGet(`${BACKGROUND_WARM_META_PREFIX}${scopeKey}`);
  if (!state || state.done !== false) return [];

  const ids = Array.isArray(state.ids) ? state.ids : [];
  const cursor = Math.max(0, Math.min(ids.length, Number(state.cursor) || 0));
  return dedupeIds(ids.slice(cursor));
}

function stopBackgroundWarmJob(job) {
  if (!job) return;
  job.stopped = true;
  cancelScheduledTask(job.scheduled);
  job.scheduled = null;
  backgroundWarmJobs.delete(job.scopeKey);
}

function stopAllBackgroundWarmJobs() {
  for (const job of backgroundWarmJobs.values()) {
    stopBackgroundWarmJob(job);
  }
  backgroundWarmJobs.clear();
}

function applyBackgroundWarmQueueUpdate(job) {
  if (!job?.nextIds?.length) return false;

  const pending = Array.isArray(job.ids)
    ? job.ids.slice(Math.max(0, Number(job.cursor) || 0))
    : [];

  job.ids = dedupeIds([...pending, ...job.nextIds]);
  job.cursor = 0;
  job.done = job.ids.length === 0;
  job.nextIds = [];
  return true;
}

function scheduleBackgroundWarmJob(job, delayMs = job?.delayMs || 0) {
  if (!job || job.stopped) return;
  cancelScheduledTask(job.scheduled);
  job.scheduled = createScheduledTask(() => {
    job.scheduled = null;
    void runBackgroundWarmJob(job);
  }, delayMs);
}

async function runBackgroundWarmJob(job) {
  if (!job || job.stopped || job.running) return;

  job.running = true;

  try {
    if (applyBackgroundWarmQueueUpdate(job)) {
      await persistBackgroundWarmJob(job);
    }

    const cursor = Math.max(0, Math.min(job.ids.length, Number(job.cursor) || 0));
    if (cursor >= job.ids.length) {
      job.done = true;
      await persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    const chunk = job.ids.slice(cursor, cursor + job.batchSize);
    if (!chunk.length) {
      job.done = true;
      await persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    await job.warmChunk(chunk);

    job.cursor = cursor + chunk.length;
    job.done = job.cursor >= job.ids.length;
    job.lastError = "";
    await persistBackgroundWarmJob(job);

    if (applyBackgroundWarmQueueUpdate(job)) {
      await persistBackgroundWarmJob(job);
    }

    if (job.done) {
      stopBackgroundWarmJob(job);
      return;
    }

    scheduleBackgroundWarmJob(job, job.delayMs);
  } catch (e) {
    job.lastError = e?.message ? String(e.message) : String(e || "warmup failed");
    await persistBackgroundWarmJob(job);
    scheduleBackgroundWarmJob(job, Math.min(5_000, Math.max(job.delayMs, job.delayMs * 2)));
  } finally {
    job.running = false;
  }
}

async function startBackgroundWarmJob({
  scopeKey,
  ids,
  batchSize = 60,
  delayMs = 180,
  warmChunk,
}) {
  const cleanScopeKey = String(scopeKey || "").trim();
  if (!cleanScopeKey || typeof warmChunk !== "function") return null;

  const incomingIds = dedupeIds(ids);
  if (!incomingIds.length) return null;

  const existing = backgroundWarmJobs.get(cleanScopeKey);
  if (existing) {
    existing.batchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));
    existing.delayMs = Math.max(80, Number(delayMs) || 180);
    existing.warmChunk = warmChunk;
    existing.nextIds = dedupeIds([...(existing.nextIds || []), ...incomingIds]);

    if (!existing.running) {
      applyBackgroundWarmQueueUpdate(existing);
      await persistBackgroundWarmJob(existing);
      scheduleBackgroundWarmJob(existing, 0);
    }

    return existing;
  }

  const resumedIds = await restoreBackgroundWarmIds(cleanScopeKey);
  const queue = dedupeIds([...resumedIds, ...incomingIds]);
  if (!queue.length) return null;

  const job = {
    scopeKey: cleanScopeKey,
    metaKey: `${BACKGROUND_WARM_META_PREFIX}${cleanScopeKey}`,
    ids: queue,
    cursor: 0,
    nextIds: [],
    batchSize: Math.max(10, Math.min(200, Number(batchSize) || 60)),
    delayMs: Math.max(80, Number(delayMs) || 180),
    scheduled: null,
    running: false,
    stopped: false,
    done: false,
    lastError: "",
    warmChunk,
  };

  backgroundWarmJobs.set(cleanScopeKey, job);
  await persistBackgroundWarmJob(job);
  scheduleBackgroundWarmJob(job, 0);
  return job;
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
  const resolvedBatchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));

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

  async function hydrateMissingWithBulk(ids) {
    const uniq = dedupeIds(ids);
    if (!uniq.length || typeof fetchMany !== "function") return false;

    for (let start = 0; start < uniq.length; start += resolvedBatchSize) {
      const chunk = uniq.slice(start, start + resolvedBatchSize);
      const items = await fetchMany(chunk);
      if (Array.isArray(items) && items.length) {
        await cachePutItems(items, { ttlMs });
      }
    }

    return true;
  }

  getOne.many = async function(ids, { prefetchOnly = false } = {}) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return prefetchOnly ? { total: 0, missing: 0 } : [];

    const freshMap = await cacheGetItemsMap(list, { allowStale: false });
    const out = prefetchOnly ? null : new Array(list.length).fill(null);
    const missing = [];

    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (!id) continue;
      const hit = freshMap.get(id) || null;
      if (out && hit) out[i] = hit;
      else if (!hit) missing.push(id);
    }

    if (missing.length && typeof fetchMany === "function") {
      try {
        await hydrateMissingWithBulk(missing);
      } catch {}
    }

    const hydratedMap = missing.length
      ? await cacheGetItemsMap(missing, { allowStale: false })
      : freshMap;

    if (out) {
      for (let i = 0; i < list.length; i++) {
        if (out[i]) continue;
        const id = list[i];
        const hit = hydratedMap.get(id) || null;
        if (hit) out[i] = hit;
      }
    }

    const remainingIds = prefetchOnly
      ? dedupeIds(missing.filter((id) => !hydratedMap.has(id)))
      : list
          .map((id, idx) => (!out[idx] ? id : null))
          .filter(Boolean);

    if (remainingIds.length) {
      const uniqueRemainingIds = prefetchOnly ? remainingIds : dedupeIds(remainingIds);
      const fetchedRemaining = await mapLimit(uniqueRemainingIds, maxConcurrent, async (id) => getOne(id));

      if (out) {
        const remainingById = new Map();
        for (let i = 0; i < uniqueRemainingIds.length; i++) {
          const item = fetchedRemaining[i];
          if (!item) continue;
          const id = item?.Id || item?.id || uniqueRemainingIds[i];
          if (id) remainingById.set(id, item);
        }

        for (let i = 0; i < list.length; i++) {
          if (out[i]) continue;
          const id = list[i];
          const hit = remainingById.get(id) || null;
          if (hit) out[i] = hit;
        }
      }
    }

    if (prefetchOnly) {
      return {
        total: list.length,
        missing: dedupeIds(missing).length,
      };
    }

    return out;
  };

  getOne.startWarmup = async function({
    scopeKey = "default",
    ids = [],
    batchSize: warmBatchSize = resolvedBatchSize,
    delayMs = 180,
  } = {}) {
    return startBackgroundWarmJob({
      scopeKey,
      ids,
      batchSize: warmBatchSize,
      delayMs,
      warmChunk: async (chunkIds) => {
        await getOne.many(chunkIds, { prefetchOnly: true });
      },
    });
  };

  getOne.stopWarmup = function(scopeKey = null) {
    if (scopeKey) {
      stopBackgroundWarmJob(backgroundWarmJobs.get(String(scopeKey)));
      return;
    }
    stopAllBackgroundWarmJobs();
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
