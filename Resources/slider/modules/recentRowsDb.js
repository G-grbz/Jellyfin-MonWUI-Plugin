const DB_NAME = 'monwui_recent_db';
const DB_VER  = 1;

function idle(cb, { timeout = 1500 } = {}) {
  try {
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") return ric(cb, { timeout });
  } catch {}
  return setTimeout(() => {
    try { cb({ timeRemaining: () => 0, didTimeout: true }); } catch {}
  }, 1);
}

function normalizeCachedItem(rec) {
  if (!rec) return null;

  const Id   = rec.Id   || rec.itemId || null;
  if (!Id) return null;

  return {
    Id,
    Name: rec.Name || rec.name || "",
    Type: rec.Type || rec.type || "",
    SeriesId: rec.SeriesId ?? rec.seriesId ?? null,
    SeriesName: rec.SeriesName ?? rec.seriesName ?? "",
    ParentId: rec.ParentId ?? rec.parentId ?? null,
    IndexNumber: rec.IndexNumber ?? rec.indexNumber ?? null,
    ParentIndexNumber: rec.ParentIndexNumber ?? rec.parentIndexNumber ?? null,
    ProductionYear: rec.ProductionYear ?? rec.productionYear ?? null,
    OfficialRating: rec.OfficialRating || rec.officialRating || "",
    CommunityRating: (rec.CommunityRating ?? rec.communityRating ?? null),
    ImageTags: rec.ImageTags || rec.imageTags || null,
    BackdropImageTags: rec.BackdropImageTags || rec.backdropImageTags || null,
    PrimaryImageAspectRatio: rec.PrimaryImageAspectRatio ?? rec.primaryImageAspectRatio ?? null,
    Overview: rec.Overview || rec.overview || "",
    Genres: rec.Genres || rec.genres || [],
    RunTimeTicks: rec.RunTimeTicks ?? rec.runTimeTicks ?? null,
    CumulativeRunTimeTicks: rec.CumulativeRunTimeTicks ?? rec.cumulativeRunTimeTicks ?? null,
    RemoteTrailers: rec.RemoteTrailers || rec.remoteTrailers || [],
    DateCreatedTicks: rec.DateCreatedTicks ?? rec.dateCreatedTicks ?? 0,
    People: rec.People || rec.people || [],
  };
}

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

export function openDirRowsDB() {
  const req = indexedDB.open(DB_NAME, DB_VER);

  req.onupgradeneeded = () => {
    const db = req.result;

    if (!db.objectStoreNames.contains('directors')) {
      const s = db.createObjectStore('directors', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byName', 'name_lc', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('items')) {
      const s = db.createObjectStore('items', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      s.createIndex('byDateCreated', 'dateCreatedTicks', { unique: false });
    }

    if (!db.objectStoreNames.contains('directorItems')) {
      const s = db.createObjectStore('directorItems', { keyPath: 'key' });
      s.createIndex('byDirector', ['scope', 'directorId'], { unique: false });
      s.createIndex('byItem', ['scope', 'itemId'], { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
  };

  return promisify(req);
}

export function makeScope({ serverId, userId }) {
  return `${serverId || ''}|${userId || ''}`;
}

export async function upsertDirector(db, scope, director) {
  if (!director?.Id) return;
  const tx = db.transaction(['directors'], 'readwrite');
  const store = tx.objectStore('directors');
  const rec = {
    key: `${scope}|${director.Id}`,
    scope,
    directorId: director.Id,
    name: director.Name || '',
    name_lc: String(director.Name || '').toLowerCase(),
    countHint: Number(director.Count) || 0,
    eligible: director.eligible !== false,
    updatedAt: Date.now(),
  };

  store.put(rec);
  await txDone(tx);
}

export async function getDirectorsForScope(db, scope, limit = 50) {
  const tx = db.transaction(['directors'], 'readonly');
  const idx = tx.objectStore('directors').index('byScope');

  const out = [];
  let cursor = await promisify(idx.openCursor(IDBKeyRange.only(scope)));

  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await new Promise((resolve) => {
      cursor.continue();
      idx.openCursor().onsuccess = (e) => resolve(e.target.result);
    }).catch(() => null);
  }
  await txDone(tx);
  return out;
}

async function cursorCollect(req, limit, mapFn) {
  return new Promise((resolve, reject) => {
    const out = [];
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return resolve(out);
      out.push(mapFn ? mapFn(cur.value) : cur.value);
      if (limit && out.length >= limit) return resolve(out);
      cur.continue();
    };
  });
}

export async function listDirectors(db, scope, { limit = 50 } = {}) {
  const tx = db.transaction(['directors'], 'readonly');
  const idx = tx.objectStore('directors').index('byScope');
  const req = idx.openCursor(IDBKeyRange.only(scope));
  const rows = await cursorCollect(req, limit);
  await txDone(tx);
  return rows;
}

export async function upsertItem(db, scope, item) {
  if (!item?.Id) return;
  const tx = db.transaction(['items'], 'readwrite');
  const store = tx.objectStore('items');

  const rec = {
    key: `${scope}|${item.Id}`,
    scope,
    Id: item.Id,
    Name: item.Name || '',
    Type: item.Type || '',
    SeriesId: item.SeriesId || null,
    SeriesName: item.SeriesName || '',
    ParentId: item.ParentId || null,
    IndexNumber: (Number.isFinite(item.IndexNumber) ? item.IndexNumber : item.IndexNumber) ?? null,
    ParentIndexNumber: (Number.isFinite(item.ParentIndexNumber) ? item.ParentIndexNumber : item.ParentIndexNumber) ?? null,
    ProductionYear: item.ProductionYear || null,
    OfficialRating: item.OfficialRating || '',
    CommunityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    ImageTags: item.ImageTags || null,
    BackdropImageTags: item.BackdropImageTags || null,
    PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    Overview: item.Overview || '',
    Genres: Array.isArray(item.Genres) ? item.Genres : [],
    RunTimeTicks: item.RunTimeTicks || null,
    CumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    RemoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    DateCreatedTicks: item.DateCreatedTicks || 0,

    itemId: item.Id,
    type: item.Type || '',
    name: item.Name || '',
    seriesId: item.SeriesId || null,
    seriesName: item.SeriesName || '',
    parentId: item.ParentId || null,
    indexNumber: item.IndexNumber ?? null,
    parentIndexNumber: item.ParentIndexNumber ?? null,
    productionYear: item.ProductionYear || null,
    officialRating: item.OfficialRating || '',
    communityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    imageTags: item.ImageTags || null,
    backdropImageTags: item.BackdropImageTags || null,
    primaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    overview: item.Overview || '',
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    runTimeTicks: item.RunTimeTicks || null,
    cumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    remoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    dateCreatedTicks: item.DateCreatedTicks || 0,
    updatedAt: Date.now(),
  };

  store.put(rec);
  await txDone(tx);
}

export async function upsertItemsBatch(db, scope, items) {
  const list = Array.isArray(items) ? items.filter(x => x?.Id) : [];
  if (!db || !scope || !list.length) return;

  const tx = db.transaction(['items'], 'readwrite');
  const store = tx.objectStore('items');

  for (const item of list) {
    const rec = {
      key: `${scope}|${item.Id}`,
      scope,
      Id: item.Id,
      Name: item.Name || '',
      Type: item.Type || '',
      SeriesId: item.SeriesId || null,
      SeriesName: item.SeriesName || '',
      ParentId: item.ParentId || null,
      IndexNumber: item.IndexNumber ?? null,
      ParentIndexNumber: item.ParentIndexNumber ?? null,
      ProductionYear: item.ProductionYear || null,
      OfficialRating: item.OfficialRating || '',
      CommunityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
      ImageTags: item.ImageTags || null,
      BackdropImageTags: item.BackdropImageTags || null,
      PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
      Overview: item.Overview || '',
      Genres: Array.isArray(item.Genres) ? item.Genres : [],
      RunTimeTicks: item.RunTimeTicks || null,
      CumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
      RemoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
      DateCreatedTicks: item.DateCreatedTicks || 0,

      itemId: item.Id,
      type: item.Type || '',
      name: item.Name || '',
      seriesId: item.SeriesId || null,
      seriesName: item.SeriesName || '',
      parentId: item.ParentId || null,
      indexNumber: item.IndexNumber ?? null,
      parentIndexNumber: item.ParentIndexNumber ?? null,
      productionYear: item.ProductionYear || null,
      officialRating: item.OfficialRating || '',
      communityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
      imageTags: item.ImageTags || null,
      backdropImageTags: item.BackdropImageTags || null,
      primaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
      overview: item.Overview || '',
      genres: Array.isArray(item.Genres) ? item.Genres : [],
      runTimeTicks: item.RunTimeTicks || null,
      cumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
      remoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
      dateCreatedTicks: item.DateCreatedTicks || 0,
      updatedAt: Date.now(),
    };
    store.put(rec);
  }

  await txDone(tx);
}

export async function getItemsByIds(db, scope, ids) {
  const list = Array.isArray(ids) ? ids.map(x => String(x||"").trim()).filter(Boolean) : [];
  if (!db || !scope || !list.length) return [];

  const tx = db.transaction(['items'], 'readonly');
  const store = tx.objectStore('items');

  const out = [];
  for (const id of list) {
    try {
      const rec = await promisify(store.get(`${scope}|${id}`));
      const norm = normalizeCachedItem(rec);
      if (norm?.Id) out.push(norm);
    } catch {}
  }

  await txDone(tx);
  return out;
}

export function upsertItemsBatchIdle(db, scope, items, opts) {
  return idle(() => { try { upsertItemsBatch(db, scope, items); } catch {} }, opts);
}

export async function linkDirectorItem(db, scope, directorId, itemId) {
  if (!directorId || !itemId) return;
  const tx = db.transaction(['directorItems'], 'readwrite');
  const store = tx.objectStore('directorItems');

  store.put({
    key: `${scope}|${directorId}|${itemId}`,
    scope,
    directorId,
    itemId,
    updatedAt: Date.now(),
  });

  await txDone(tx);
}

export async function getItemsForDirector(db, scope, directorId, limit = 20) {
  const tx = db.transaction(['directorItems', 'items'], 'readonly');
  const relIdx = tx.objectStore('directorItems').index('byDirector');
  const scanLimit = Math.max(limit * 4, limit);
  const relReq = relIdx.openCursor(IDBKeyRange.only([scope, directorId]));
  const rels = await cursorCollect(relReq, scanLimit, (v) => v.itemId);
  const itemStore = tx.objectStore('items');
  const items = [];

  for (const itemId of rels) {
    if (items.length >= limit) break;
    const rec = await promisify(itemStore.get(`${scope}|${itemId}`));
    const norm = normalizeCachedItem(rec);
    if (norm) items.push(norm);
  }
  await txDone(tx);
  return items;
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
