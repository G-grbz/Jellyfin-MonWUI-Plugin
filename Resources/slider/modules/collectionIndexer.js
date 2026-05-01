import { makeApiRequest, fetchItemDetailsFull, fetchItemsBulk, getSessionInfo } from "../../Plugins/JMSFusion/runtime/api.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";

const META_CURSOR = "bg_index_cursor_movie_start";
const META_CURSOR_BOXSET = "bg_index_cursor_boxset_start";
const META_DONE_AT = "bg_index_done_at";
const META_SEEN_BOXSETS = "bg_index_seen_boxsets_v1";
const META_PHASE = "bg_index_phase_v1";
const META_RUN_STATE = "bg_index_run_state_v1";
const PAGE = 200;
const IDLE_TIMEOUT = 1200;
const TTL_MOVIE_BOXSET = 7 * 24 * 60 * 60 * 1000;
const TTL_BOXSET_ITEMS = 2 * 24 * 60 * 60 * 1000;
const RUN_HEARTBEAT_STALE_MS = 90 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idleTick(cb) {
  return CollectionCacheDB.idle(cb, { timeout: IDLE_TIMEOUT });
}

function scheduleNext(cb, { aggressive = false } = {}) {
  if (aggressive) {
    return setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: true }), 0);
  }
  return idleTick(cb);
}

function isHidden() {
  try {
    return document.hidden;
  } catch {
    return false;
  }
}

function now() {
  return Date.now();
}

function isStale(ts, maxAgeMs) {
  const t = Number(ts || 0);
  if (!t) return true;
  return Date.now() - t > maxAgeMs;
}

function parseJsonValue(row) {
  try {
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function getUserIdSafe() {
  try {
    const fromApiClient = (
      (window.ApiClient?.getCurrentUserId?.() ||
        window.ApiClient?._currentUserId ||
        "") + ""
    ).toString();
    if (fromApiClient) return fromApiClient;
  } catch {
  }

  try {
    return ((getSessionInfo?.()?.userId || "") + "").toString();
  } catch {
    return "";
  }
}

function normalizeCursorValue(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizePhaseValue(value, fallback = "boxset") {
  const phase = String(value || fallback);
  if (phase === "boxset" || phase === "negative" || phase === "movie") return phase;
  return fallback;
}

export async function getBackgroundCollectionIndexerStatus() {
  try {
    const [cursorRow, boxCursorRow, phaseRow, doneRow, runRow] = await Promise.all([
      CollectionCacheDB.getMeta(META_CURSOR).catch(() => null),
      CollectionCacheDB.getMeta(META_CURSOR_BOXSET).catch(() => null),
      CollectionCacheDB.getMeta(META_PHASE).catch(() => null),
      CollectionCacheDB.getMeta(META_DONE_AT).catch(() => null),
      CollectionCacheDB.getMeta(META_RUN_STATE).catch(() => null),
    ]);

    const movieCursor = normalizeCursorValue(parseJsonValue(cursorRow));
    const boxsetCursor = normalizeCursorValue(parseJsonValue(boxCursorRow));
    const phase = normalizePhaseValue(parseJsonValue(phaseRow), "boxset");
    const doneAt = normalizeCursorValue(parseJsonValue(doneRow));
    const runState = parseJsonValue(runRow) || null;
    const status = String(runState?.status || "");
    const startedAt = normalizeCursorValue(runState?.startedAt);
    const heartbeatAt = normalizeCursorValue(runState?.heartbeatAt || runState?.updatedAt);
    const interrupted =
      status === "running" ||
      status === "interrupted" ||
      status === "stopping";
    const completedAfterStart = !!(doneAt && startedAt && doneAt >= startedAt);
    const cursorPending =
      movieCursor > 0 ||
      boxsetCursor > 0 ||
      phase === "negative";
    const staleRunning =
      status === "running" &&
      heartbeatAt > 0 &&
      (now() - heartbeatAt) > RUN_HEARTBEAT_STALE_MS;
    const resumePending =
      cursorPending ||
      (interrupted && !completedAfterStart) ||
      staleRunning;
    const dbLikelyEmpty =
      !doneAt &&
      !movieCursor &&
      !boxsetCursor &&
      !runState;

    return {
      movieCursor,
      boxsetCursor,
      phase,
      doneAt,
      runState,
      staleRunning,
      resumePending,
      dbLikelyEmpty,
    };
  } catch (e) {
    console.warn("[INDEXER] status read failed:", e);
    return {
      movieCursor: 0,
      boxsetCursor: 0,
      phase: "boxset",
      doneAt: 0,
      runState: null,
      staleRunning: false,
      resumePending: false,
      dbLikelyEmpty: true,
    };
  }
}

async function fetchMovieIdsPage({ userId, startIndex, signal }) {
  const qp = new URLSearchParams();
  qp.set("UserId", userId);
  qp.set("IncludeItemTypes", "Movie");
  qp.set("Recursive", "true");
  qp.set("Fields", "Id");
  qp.set("Limit", String(PAGE));
  qp.set("StartIndex", String(startIndex));

  const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
  const items = Array.isArray(r?.Items) ? r.Items : [];
  return {
    ids: items.map((x) => x?.Id).filter(Boolean),
    total: Number(r?.TotalRecordCount || 0),
    got: items.length,
  };
}

async function fetchBoxsetPage({ userId, startIndex, signal }) {
  const qp = new URLSearchParams();
  qp.set("UserId", userId);
  qp.set("IncludeItemTypes", "BoxSet");
  qp.set("Recursive", "true");
  qp.set("Fields", "Id,Name,ChildCount");
  qp.set("Limit", String(PAGE));
  qp.set("StartIndex", String(startIndex));

  const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
  const items = Array.isArray(r?.Items) ? r.Items : [];
  return {
    boxsets: items
      .filter((x) => (x?.ChildCount ?? 1) > 0)
      .map((x) => ({ id: String(x?.Id || ""), name: String(x?.Name || "") }))
      .filter((x) => x.id),
    total: Number(r?.TotalRecordCount || 0),
    got: items.length,
  };
}

async function getBoxSetForMovie(movieId, { userId, signal } = {}) {
  try {
    if (!userId || !movieId) return null;

    try {
      const anc = await makeApiRequest(
        `/Items/${encodeURIComponent(movieId)}/Ancestors?UserId=${encodeURIComponent(userId)}`,
        { signal }
      );
      const list = Array.isArray(anc) ? anc : anc?.Items || [];
      const box = (list || []).find(
        (x) => String(x?.Type || "").toLowerCase() === "boxset"
      );
      if (box?.Id) {
        return { id: box.Id, name: box.Name };
      }
    } catch (e) {}

    let movieName = "";
    try {
      const movieDetails = await makeApiRequest(`/Users/${userId}/Items/${movieId}`, {
        signal,
      });
      movieName = movieDetails?.Name || "";
    } catch {}

    if (movieName) {
      const qp = new URLSearchParams();
      qp.set("UserId", userId);
      qp.set("IncludeItemTypes", "BoxSet");
      qp.set("Recursive", "true");
      qp.set("Limit", "60");
      qp.set("Fields", "ChildCount");
      qp.set("SearchTerm", movieName);

      let res = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
      let candidates = res?.Items || [];

      if (!candidates.length) {
        qp.delete("SearchTerm");
        qp.set("Limit", "200");
        res = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
        candidates = res?.Items || [];
      }

      for (const box of (candidates || []).filter((x) => (x?.ChildCount ?? 1) > 0)) {
        const childrenQp = new URLSearchParams();
        childrenQp.set("UserId", userId);
        childrenQp.set("ParentId", box.Id);
        childrenQp.set("Limit", "100");

        const children = await makeApiRequest(`/Items?${childrenQp.toString()}`, {
          signal,
        });
        if ((children?.Items || []).some((x) => String(x.Id) === String(movieId))) {
          return { id: box.Id, name: box.Name };
        }
      }
    }

    return null;
  } catch (e) {
    console.warn("getBoxSetForMovie error:", e);
    return null;
  }
}

async function fetchCollectionItemsAll(boxsetId, { userId, signal } = {}) {
  if (!userId || !boxsetId) return [];

  const out = [];
  const seen = new Set();
  let start = 0;
  const PAGE_SIZE = 200;

  while (true) {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(boxsetId));
    qp.set("IncludeItemTypes", "Movie");
    qp.set(
      "Fields",
      "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating"
    );
    qp.set("SortBy", "ProductionYear,SortName");
    qp.set("SortOrder", "Ascending");
    qp.set("Limit", String(PAGE_SIZE));
    qp.set("StartIndex", String(start));

    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const items = Array.isArray(r?.Items) ? r.Items : [];

    for (const it of items) {
      const id = it?.Id ? String(it.Id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }

    if (items.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  return out;
}

function minimizeItems(items = []) {
  return (items || []).map((x) => ({
    Id: x.Id,
    Name: x.Name,
    ProductionYear: x.ProductionYear,
    CommunityRating: x.CommunityRating,
    ImageTags: x.ImageTags,
    PrimaryImageAspectRatio: x.PrimaryImageAspectRatio,
    UserData: x.UserData,
  }));
}

async function safePutMovieBoxset(movieId, box, { silent = true } = {}) {
  try {
    await CollectionCacheDB.setMovieBoxset(movieId, box?.id || "", box?.name || "");
  } catch (e) {
    if (!silent) console.error("setMovieBoxset FAILED:", movieId, e);
  }
}

async function safePutBoxsetItems(boxsetId, minimized, { silent = false } = {}) {
  try {
    await CollectionCacheDB.setBoxsetItems(boxsetId, minimized);

    const row = await CollectionCacheDB.getBoxsetItems(boxsetId).catch(() => null);
    const wrote = Array.isArray(minimized) ? minimized.length : 0;
    const got = row?.items?.length || 0;

    if (wrote > 0) {
      if (got === 0) {
        console.warn(`[INDEXER] ⚠️ Boxset ${boxsetId} write ok but readback empty!`, {
          wrote,
          row,
        });
      }
    }
  } catch (e) {
    if (!silent) console.error("setBoxsetItems FAILED:", boxsetId, e);
    throw e;
  }
}

let _running = false;
let _ctrl = null;
let _idleHandle = null;

export function stopBackgroundCollectionIndexer() {
  try {
    _ctrl?.abort();
  } catch {}
  _ctrl = null;

  try {
    if (_idleHandle != null) CollectionCacheDB.cancelIdle?.(_idleHandle);
  } catch {}
  _idleHandle = null;

  _running = false;
  try {
    void CollectionCacheDB.setMeta(META_RUN_STATE, {
      status: "stopping",
      stoppedAt: now(),
    });
  } catch {}
}

export async function startBackgroundCollectionIndexer({
  throttleMs = 250,
  boxsetThrottleMs = 500,
  maxMoviesPerSession = 400,
  aggressive = false,
  mode = "boxsetFirst",
} = {}) {
  if (_running) {
    return { started: false, reason: "already-running" };
  }

  _running = true;
  _ctrl = new AbortController();
  const signal = _ctrl.signal;

  const userId = await getUserIdSafe();
  if (!userId) {
    console.warn("[INDEXER] No userId, aborting");
    _running = false;
    return { started: false, reason: "no-userId" };
  }

  const cursorRow = await CollectionCacheDB.getMeta(META_CURSOR).catch(() => null);
  let startIndex = Number(parseJsonValue(cursorRow) || 0);
  if (!Number.isFinite(startIndex) || startIndex < 0) startIndex = 0;

  const bcurRow = await CollectionCacheDB.getMeta(META_CURSOR_BOXSET).catch(() => null);
  let boxsetStartIndex = Number(parseJsonValue(bcurRow) || 0);
  if (!Number.isFinite(boxsetStartIndex) || boxsetStartIndex < 0) boxsetStartIndex = 0;

  const phaseRow = await CollectionCacheDB.getMeta(META_PHASE).catch(() => null);
  let phase = String(
    parseJsonValue(phaseRow) ||
      (mode === "movieFirst" ? "movie" : "boxset")
  );

  if (mode === "movieFirst") phase = "movie";
  if (phase !== "boxset" && phase !== "negative" && phase !== "movie") phase = "boxset";

  const seenRow = await CollectionCacheDB.getMeta(META_SEEN_BOXSETS).catch(() => null);
  const seenArr = parseJsonValue(seenRow);
  const seenBoxsets = new Set(Array.isArray(seenArr) ? seenArr.map(String) : []);
  const fastSkip = new Set();
  const negativeBatch = [];

  let processedInSession = 0;
  let boxsetsFound = 0;
  let boxsetsProcessed = 0;
  const startedAt = now();

  async function persistRunState(status = "running", extra = {}) {
    try {
      await CollectionCacheDB.setMeta(META_RUN_STATE, {
        status,
        userId,
        mode,
        startedAt,
        heartbeatAt: now(),
        phase,
        movieCursor: startIndex,
        boxsetCursor: boxsetStartIndex,
        processedInSession,
        boxsetsFound,
        boxsetsProcessed,
        ...extra,
      });
    } catch {}
  }

  async function markInterrupted(reason = "aborted") {
    _running = false;
    await persistRunState("interrupted", {
      reason,
      interruptedAt: now(),
    });
  }

  await persistRunState("running");

  const step = async () => {
    if (signal.aborted) {
      await markInterrupted("signal-aborted");
      return;
    }

    await persistRunState("running");

    if (!aggressive && isHidden()) {
      await sleep(1000);
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (phase === "boxset") {
      let page;
      try {
        page = await fetchBoxsetPage({ userId, startIndex: boxsetStartIndex, signal });
      } catch (e) {
        if (!signal.aborted) console.warn("[INDEXER] fetchBoxsetPage failed:", e);
        await persistRunState("running", { lastError: String(e?.message || e || "") });
        await sleep(1500);
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      if (!page || signal.aborted) return;

      if (!page.boxsets.length) {
        phase = "negative";
        await CollectionCacheDB.setMeta(META_PHASE, "negative").catch(() => {});
        startIndex = 0;
        await CollectionCacheDB.setMeta(META_CURSOR, 0).catch(() => {});
        await persistRunState("running");
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      let localBoxsetIndex = boxsetStartIndex;

      for (const bs of page.boxsets) {
        if (signal.aborted) return;
        localBoxsetIndex++;

        const bid = String(bs?.id || "");
        const bnm = String(bs?.name || "");
        if (!bid) continue;
        if (seenBoxsets.has(bid)) continue;

        const cachedItems = await CollectionCacheDB.getBoxsetItems(bid).catch(() => null);
        if (cachedItems?.items?.length && !isStale(cachedItems.updatedAt, TTL_BOXSET_ITEMS)) {
          try {
            const childIds = (cachedItems.items || [])
              .map((x) => String(x?.Id || ""))
              .filter(Boolean);
            if (childIds.length) {
              await CollectionCacheDB.setMovieBoxsetMany(childIds, bid, bnm);
              for (const cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(bid);
          if (seenBoxsets.size % 5 === 0) {
            await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
          }
          continue;
        }

        let items = [];
        try {
          items = await fetchCollectionItemsAll(bid, { userId, signal });
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] fetchCollectionItemsAll FAILED:", bid, e);
          items = [];
        }
        if (signal.aborted) return;

        const minimized = minimizeItems(items);

        try {
          await safePutBoxsetItems(bid, minimized, { silent: true });
        } catch {}

        try {
          const childIds = minimized.map((x) => String(x?.Id || "")).filter(Boolean);
          if (childIds.length) {
            await CollectionCacheDB.setMovieBoxsetMany(childIds, bid, bnm);
            for (const cid of childIds) fastSkip.add(cid);
          }
        } catch {}

        seenBoxsets.add(bid);
        boxsetsProcessed++;

        if (seenBoxsets.size % 5 === 0) {
          await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
        }

        if (boxsetThrottleMs) await sleep(boxsetThrottleMs);
      }

      boxsetStartIndex = localBoxsetIndex;

      await CollectionCacheDB.setMeta(META_CURSOR_BOXSET, boxsetStartIndex).catch(() => {});
      await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
      await persistRunState("running");

      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (phase === "negative") {
      let page;
      try {
        page = await fetchMovieIdsPage({ userId, startIndex, signal });
      } catch (e) {
        if (!signal.aborted) console.warn("[INDEXER] fetchMovieIdsPage failed:", e);
        await persistRunState("running", { lastError: String(e?.message || e || "") });
        await sleep(1500);
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      if (!page || signal.aborted) return;

      if (!page.ids.length) {
        await CollectionCacheDB.setMeta(META_DONE_AT, now()).catch(() => {});
        await CollectionCacheDB.setMeta(META_CURSOR, 0).catch(() => {});
        await CollectionCacheDB.setMeta(META_CURSOR_BOXSET, 0).catch(() => {});
        await CollectionCacheDB.setMeta(META_PHASE, "boxset").catch(() => {});
        await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
        _running = false;
        await persistRunState("completed", {
          completedAt: now(),
          phase: "boxset",
          movieCursor: 0,
          boxsetCursor: 0,
        });
        return;
      }

      const map = await CollectionCacheDB.getMovieBoxsetMany(page.ids).catch(() => new Map());
      const missing = [];

      for (const id of page.ids) {
        const mid = String(id || "");
        if (!mid) continue;
        const row = map.get(mid);
        if (!row) missing.push(mid);
      }

      if (missing.length) {
        try {
          await CollectionCacheDB.setMovieBoxsetMany(missing, "", "");
        } catch {}
      }

      startIndex += page.ids.length;
      await CollectionCacheDB.setMeta(META_CURSOR, startIndex).catch(() => {});
      await persistRunState("running");
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    let page;
    try {
      page = await fetchMovieIdsPage({ userId, startIndex, signal });
    } catch (e) {
      if (!signal.aborted) console.warn("[INDEXER] fetchMovieIdsPage failed:", e);
      await persistRunState("running", { lastError: String(e?.message || e || "") });
      await sleep(2000);
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (!page || signal.aborted) return;

    if (!page.ids.length) {
      await CollectionCacheDB.setMeta(META_DONE_AT, now()).catch(() => {});
      await CollectionCacheDB.setMeta(META_CURSOR, 0).catch(() => {});
      await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
      _running = false;
      await persistRunState("completed", {
        completedAt: now(),
        movieCursor: 0,
        boxsetCursor: boxsetStartIndex,
      });
      return;
    }

    let pageIndex = startIndex;

    for (const movieId of page.ids) {
      if (signal.aborted) return;

      const mid = String(movieId || "");
      if (!mid) {
        pageIndex++;
        processedInSession++;
        continue;
      }

      if (fastSkip.has(mid)) {
        pageIndex++;
        processedInSession++;
        continue;
      }

      const cached = await CollectionCacheDB.getMovieBoxset(mid).catch(() => null);

      if (cached && !isStale(cached.updatedAt, TTL_MOVIE_BOXSET)) {
        fastSkip.add(mid);
        pageIndex++;
        processedInSession++;
        continue;
      }

      let box = null;
      let didLive = false;

      try {
        didLive = true;
        box = await getBoxSetForMovie(mid, { userId, signal });
        if (box) boxsetsFound++;
      } catch (e) {}

      if (!box?.id) {
        negativeBatch.push(mid);
      } else {
        await safePutMovieBoxset(mid, box, { silent: true });
      }
      fastSkip.add(mid);

      if (box?.id && !seenBoxsets.has(String(box.id))) {
        const cachedItems = await CollectionCacheDB.getBoxsetItems(box.id).catch(() => null);
        if (cachedItems && cachedItems.items?.length && !isStale(cachedItems.updatedAt, TTL_BOXSET_ITEMS)) {
          try {
            const childIds = (cachedItems.items || []).map((x) => String(x?.Id || "")).filter(Boolean);
            if (childIds.length) {
              await CollectionCacheDB.setMovieBoxsetMany(childIds, box.id, box.name);
              for (const cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(String(box.id));
          boxsetsProcessed++;
          pageIndex++;
          processedInSession++;
          await sleep(boxsetThrottleMs);
          continue;
        }

        let items = [];
        try {
          didLive = true;
          items = await fetchCollectionItemsAll(box.id, { userId, signal });
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] fetchCollectionItemsAll FAILED:", box.id, e);
          items = [];
        }

        if (signal.aborted) return;

        const minimized = minimizeItems(items);

        try {
          await safePutBoxsetItems(box.id, minimized, { silent: false });

          try {
            const childIds = minimized.map((x) => String(x?.Id || "")).filter(Boolean);
            if (childIds.length) {
              await CollectionCacheDB.setMovieBoxsetMany(childIds, box.id, box.name);
              for (const cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(String(box.id));
          boxsetsProcessed++;

          if (seenBoxsets.size % 5 === 0) {
            await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
          }
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] Boxset cache write failed:", box.id, e);
        }

        await sleep(boxsetThrottleMs);
      }

      processedInSession++;
      pageIndex++;

      if (negativeBatch.length >= 50) {
        try {
          await CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
        } catch {}
        negativeBatch.length = 0;
      }

      if (processedInSession >= maxMoviesPerSession) {
        if (negativeBatch.length) {
          try {
            await CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
          } catch {}
          negativeBatch.length = 0;
        }

        await CollectionCacheDB.setMeta(META_CURSOR, pageIndex).catch(() => {});
        await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
        startIndex = pageIndex;
        await persistRunState("running");

        processedInSession = 0;
        boxsetsFound = 0;
        boxsetsProcessed = 0;

        await sleep(2000);
      }

      if (didLive) await sleep(throttleMs);
    }

    startIndex = pageIndex;

    if (negativeBatch.length) {
      try {
        await CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
      } catch {}
      negativeBatch.length = 0;
    }

    await CollectionCacheDB.setMeta(META_CURSOR, startIndex).catch(() => {});
    await CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catch(() => {});
    await persistRunState("running");

    _idleHandle = scheduleNext(step, { aggressive });
  };

  _idleHandle = scheduleNext(step, { aggressive });
  return {
    started: true,
    reason: "started",
    phase,
    movieCursor: startIndex,
    boxsetCursor: boxsetStartIndex,
  };
}
