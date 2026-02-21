const DB_NAME = "jms_collection_cache";
const DB_VER = 1;

const STORE_MOVIE_BOXSET = "movieBoxset";
const STORE_BOXSET_ITEMS = "boxsetItems";
const STORE_META = "meta";

function promisifyReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = () => {
    const db = req.result;

    if (!db.objectStoreNames.contains(STORE_MOVIE_BOXSET)) {
      const s = db.createObjectStore(STORE_MOVIE_BOXSET, { keyPath: "movieId" });
      s.createIndex("updatedAt", "updatedAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_BOXSET_ITEMS)) {
      const s = db.createObjectStore(STORE_BOXSET_ITEMS, { keyPath: "boxsetId" });
      s.createIndex("updatedAt", "updatedAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: "key" });
    }
  };
  return promisifyReq(req);
}

async function tx(db, storeName, mode, fn) {
  const t = db.transaction(storeName, mode);
  const s = t.objectStore(storeName);
  const out = await fn(s);
  await new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return out;
}

async function txRaw(db, storeName, mode, fn) {
  const t = db.transaction(storeName, mode);
  const s = t.objectStore(storeName);
  const out = await fn(s, t);
  await new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return out;
}

function now() {
  return Date.now();
}

function idle(cb, { timeout = 1200 } = {}) {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(cb, { timeout });
  }
  return setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 250);
}

function cancelIdle(handle) {
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}

let _dbP = null;
function getDb() {
  if (!_dbP) _dbP = openDb();
  return _dbP;
}

export const CollectionCacheDB = {
  idle,
  cancelIdle,

  async getMovieBoxset(movieId) {
    const db = await getDb();
    return tx(db, STORE_MOVIE_BOXSET, "readonly", (s) =>
      promisifyReq(s.get(String(movieId)))
    );
  },

  async setMovieBoxset(movieId, boxsetId, boxsetName) {
    const db = await getDb();
    const row = {
      movieId: String(movieId),
      boxsetId: boxsetId ? String(boxsetId) : "",
      boxsetName: boxsetName ? String(boxsetName) : "",
      updatedAt: now(),
    };
    return tx(db, STORE_MOVIE_BOXSET, "readwrite", (s) => promisifyReq(s.put(row)));
  },

  async setMovieBoxsetMany(movieIds, boxsetId, boxsetName) {
    const db = await getDb();
    const updatedAt = now();
    const bid = boxsetId ? String(boxsetId) : "";
    const bnm = boxsetName ? String(boxsetName) : "";

    const ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return;

    return txRaw(db, STORE_MOVIE_BOXSET, "readwrite", (s) => {
      for (const mid of ids) {
        s.put({
          movieId: mid,
          boxsetId: bid,
          boxsetName: bnm,
          updatedAt,
        });
      }
    });
  },

  async getMovieBoxsetMany(movieIds) {
    const db = await getDb();
    const ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return new Map();

    return txRaw(db, STORE_MOVIE_BOXSET, "readonly", async (s) => {
      const ps = ids.map(
        (mid) =>
          new Promise((res) => {
            try {
              const req = s.get(mid);
              req.onsuccess = () => res([mid, req.result || null]);
              req.onerror = () => res([mid, null]);
            } catch {
              res([mid, null]);
            }
          })
      );
      const entries = await Promise.all(ps);
      return new Map(entries);
    });
  },

  async getBoxsetItems(boxsetId) {
    const db = await getDb();
    return tx(db, STORE_BOXSET_ITEMS, "readonly", (s) =>
      promisifyReq(s.get(String(boxsetId)))
    );
  },

  async setBoxsetItems(boxsetId, items) {
    const db = await getDb();
    const row = {
      boxsetId: String(boxsetId),
      items: Array.isArray(items) ? items : [],
      updatedAt: now(),
    };
    return tx(db, STORE_BOXSET_ITEMS, "readwrite", (s) => promisifyReq(s.put(row)));
  },

  async getMeta(key) {
    const db = await getDb();
    return tx(db, STORE_META, "readonly", (s) => promisifyReq(s.get(String(key))));
  },

  async setMeta(key, value) {
    const db = await getDb();
    return tx(db, STORE_META, "readwrite", (s) =>
      promisifyReq(s.put({ key: String(key), value, updatedAt: now() }))
    );
  },
};
