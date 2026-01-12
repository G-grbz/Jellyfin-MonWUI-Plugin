const DB_NAME = 'jms_prc_db';
const DB_VER  = 1;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function makeScope({ serverId, userId }) {
  return `${serverId || ''}|${userId || ''}`;
}

export function openPrcDB() {
  const req = indexedDB.open(DB_NAME, DB_VER);

  req.onupgradeneeded = () => {
    const db = req.result;

    if (!db.objectStoreNames.contains('items')) {
      const s = db.createObjectStore('items', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('meta')) {
      const s = db.createObjectStore('meta', { keyPath: 'key' });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }
  };

  return promisify(req);
}

function toPrcItemRecord(scope, it, now = Date.now()) {
  const Id = it?.Id || it?.itemId || null;
  if (!Id) return null;

  const communityRaw = (it?.CommunityRating ?? it?.communityRating ?? null);
  const CommunityRating = Number.isFinite(communityRaw)
    ? communityRaw
    : (communityRaw == null ? null : (Number(communityRaw) || null));

  const ImageTags = it?.ImageTags || it?.imageTags || null;

  const PrimaryImageTag =
    it?.PrimaryImageTag ||
    it?.primaryImageTag ||
    (ImageTags && (ImageTags.Primary || ImageTags.primary)) ||
    null;

  const RemoteTrailers =
    it?.RemoteTrailers ||
    it?.remoteTrailers ||
    it?.RemoteTrailerItems ||
    it?.RemoteTrailerUrls ||
    [];

  const Genres = Array.isArray(it?.Genres)
    ? it.Genres
    : (Array.isArray(it?.genres) ? it.genres : []);

  return {
    key: `${scope}|${Id}`,
    scope,
    itemId: Id,
    updatedAt: now,

    Id,
    Name: it?.Name || it?.name || '',
    Type: it?.Type || it?.type || '',
    ProductionYear: (it?.ProductionYear ?? it?.productionYear ?? null),
    OfficialRating: it?.OfficialRating || it?.officialRating || '',
    CommunityRating,

    ImageTags,
    PrimaryImageTag,

    BackdropImageTags: it?.BackdropImageTags || it?.backdropImageTags || null,
    PrimaryImageAspectRatio: (it?.PrimaryImageAspectRatio ?? it?.primaryImageAspectRatio ?? null),
    Overview: it?.Overview || it?.overview || '',

    RunTimeTicks: (it?.RunTimeTicks ?? it?.runTimeTicks ?? null),
    CumulativeRunTimeTicks: (it?.CumulativeRunTimeTicks ?? it?.cumulativeRunTimeTicks ?? null),

    Genres,
    RemoteTrailers,
  };
}

export async function putItems(db, scope, items) {
  if (!db || !scope || !items?.length) return;

  const tx = db.transaction(['items'], 'readwrite');
  const store = tx.objectStore('items');
  const now = Date.now();

  for (const it of items) {
    const rec = toPrcItemRecord(scope, it, now);
    if (rec) store.put(rec);
  }

  await txDone(tx);
}

export async function getMeta(db, key) {
  const tx = db.transaction(['meta'], 'readonly');
  const val = await promisify(tx.objectStore('meta').get(key));
  await txDone(tx);
  return val?.value ?? null;
}

export async function setMeta(db, key, value) {
  const tx = db.transaction(['meta'], 'readwrite');
  tx.objectStore('meta').put({ key, value, updatedAt: Date.now() });
  await txDone(tx);
}

function cursorIter(req, onValue) {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = async (e) => {
      const cur = e.target.result;
      if (!cur) return resolve(true);
      try { await onValue(cur); }
      catch {}
      cur.continue();
    };
  });
}

export async function purgeScopeItems(db, scope, {
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  maxItems = 1200,
  maxScan = 6000,
} = {}) {
  if (!db || !scope) return { removed: 0, scanned: 0, capped: 0 };

  const now = Date.now();
  const cutoff = now - Math.max(60_000, ttlMs | 0);

  const tx = db.transaction(['items'], 'readwrite');
  const store = tx.objectStore('items');
  const idxScope = store.index('byScope');

  let removed = 0;
  let scanned = 0;

  const req = idxScope.openCursor(IDBKeyRange.only(scope));
  const touched = [];

  await cursorIter(req, (cur) => {
    const v = cur.value || {};
    scanned++;
    if (maxScan && scanned >= maxScan) {
    }

    const key = v.key;
    const updatedAt = Number(v.updatedAt || 0);

    if (updatedAt && updatedAt < cutoff) {
      try { cur.delete(); removed++; } catch {}
      return;
    }

    if (key) touched.push({ key, updatedAt });
  });

  let capped = 0;
  if (maxItems && touched.length > maxItems) {
    touched.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    const over = touched.length - maxItems;
    for (let i = 0; i < over; i++) {
      const k = touched[i]?.key;
      if (!k) continue;
      try { store.delete(k); capped++; } catch {}
    }
  }

  await txDone(tx);
  return { removed, scanned, capped };
}

export async function purgePrcMeta(db, {
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  prefix = 'prc:',
  maxScan = 3000,
} = {}) {
  if (!db) return { removed: 0, scanned: 0 };

  const now = Date.now();
  const cutoff = now - Math.max(60_000, ttlMs | 0);

  const tx = db.transaction(['meta'], 'readwrite');
  const store = tx.objectStore('meta');

  let removed = 0;
  let scanned = 0;

  const req = store.openCursor();
  await cursorIter(req, (cur) => {
    const v = cur.value || {};
    scanned++;
    if (maxScan && scanned > maxScan) return;

    const k = String(v.key || '');
    if (!k.startsWith(prefix)) return;

    const updatedAt = Number(v.updatedAt || 0);
    if (updatedAt && updatedAt < cutoff) {
      try { cur.delete(); removed++; } catch {}
    }
  });

  await txDone(tx);
  return { removed, scanned };
}

export async function purgePrcDb(db, scope, opts = {}) {
  const itemsRes = await purgeScopeItems(db, scope, opts.items || {});
  const metaRes  = await purgePrcMeta(db, opts.meta || {});
  return { items: itemsRes, meta: metaRes };
}
