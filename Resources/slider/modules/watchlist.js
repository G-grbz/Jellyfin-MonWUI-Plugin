import { fetchItemDetailsFull, fetchItemsBulk, getEmbyHeaders, getLastPlayNowBlockReason, getSessionInfo, makeApiRequest, playNow, updateFavoriteStatus } from "/Plugins/JMSFusion/runtime/api.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import { ensureStudioHubLogoFromTmdb, ensureStudioHubManualEntry, JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT } from "./studioHubsShared.js";
import { showNotification } from "./player/ui/notification.js";

const WATCHLIST_ENDPOINT = "/Plugins/jmsFusion/watchlist";
export const WATCHLIST_MODAL_ID = "monwui-watchlist-modal-root";
const WATCHLIST_STYLE_ID = "monwui-watchlist-modal-style";
const WATCHLIST_NAV_BUTTON_CLASS = "monwui-watchlist-nav-button";
const DASHBOARD_TTL_MS = 30_000;

let dashboardCache = null;
let dashboardPromise = null;
let usersCache = null;
let usersPromise = null;
let tabsSliderObserver = null;
let tabsSliderObserverStopTimer = 0;
let tabsSliderRefreshQueued = false;
let tabsSliderBindingsInstalled = false;
let autoRemoveQueue = Promise.resolve();
const pendingAutoRemovalKeys = new Set();
const tabsSliderRefreshTimers = new Set();
const TABS_SLIDER_ROUTE_REFRESH_DELAYS_MS = [0, 120, 360, 900, 1800];
const TABS_SLIDER_OBSERVER_WINDOW_MS = 4_000;
const collectionAutoRemovePending = new Set();
const favoriteMirrorPending = new Set();
const favoriteMirrorSuppressed = new Set();
const autoAddStudioHubPendingIds = new Set();
const autoAddedStudioHubIds = new Set();
const autoStudioHubLogoPendingIds = new Set();
const autoStudioHubLogoResolvedIds = new Set();
let favoriteMirrorInstalled = false;
const scheduleFavoriteMirrorTask = typeof queueMicrotask === "function"
  ? (cb) => queueMicrotask(cb)
  : (cb) => Promise.resolve().then(cb);

const WATCHLIST_TABS = [
  { key: "movies", labelKey: "watchlistMovieTab", fallback: "Filmler" },
  { key: "series", labelKey: "watchlistSeriesTab", fallback: "Diziler" },
  { key: "music", labelKey: "watchlistMusicTab", fallback: "Müzik" },
  { key: "collections", labelKey: "watchlistCollectionTab", fallback: "Koleksiyonlar" },
  { key: "albums", labelKey: "watchlistAlbumTab", fallback: "Müzik Albümleri" }
];
const WATCHLIST_TAB_KEYS = new Set(WATCHLIST_TABS.map((tab) => tab.key));
const WATCHLIST_TAB_ALIASES = {
  watchlist: "movies",
  movie: "movies",
  movies: "movies",
  film: "movies",
  films: "movies",
  series: "series",
  show: "series",
  shows: "series",
  tv: "series",
  music: "music",
  collection: "collections",
  collections: "collections",
  boxset: "collections",
  album: "albums",
  albums: "albums"
};
const DEFAULT_WATCHLIST_TAB = "movies";
const WATCHLIST_PREVIEW_HOVER_DELAY_MS = 90;
const WATCHLIST_PREVIEW_SWITCH_DELAY_MS = 320;
const WATCHLIST_COLLECTION_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const WATCHLIST_COLLECTION_REFRESH_MS = 30_000;
const WATCHLIST_COLLECTION_PREVIEW_LIMIT = 8;
const WATCHLIST_COLLECTION_PAGE_SIZE = 200;
const watchlistPreviewCache = new Map();

function cfg() {
  return getConfig?.() || {};
}

function shouldShowWatchlistTabsSliderButton() {
  return cfg()?.watchlistTabsSliderEnabled !== false;
}

function shouldAutoRemovePlayedFromWatchlist() {
  return cfg()?.watchlistAutoRemovePlayed === true;
}

function shouldAutoRemovePlayedFromFavorites() {
  return shouldAutoRemovePlayedFromWatchlist() && cfg()?.watchlistAutoRemovePlayedFromFavorites === true;
}

function labels() {
  return cfg()?.languageLabels || {};
}

function L(key, fallback) {
  const map = labels();
  const value = map?.[key];
  return (typeof value === "string" && value.trim()) ? value : fallback;
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function notifyStudioHubResult(message, type = "success", icon = "building", duration = 2600) {
  const cleanMessage = text(message);
  if (!cleanMessage) return;

  showNotification(`<i class="fas fa-${icon}" style="margin-right:8px;"></i> ${cleanMessage}`, duration, type);
  window.showMessage?.(cleanMessage, type === "error" ? "error" : "success");
}

function setStudioHubLoadingState(targetEl, isLoading) {
  const el = targetEl?.closest?.("[data-monwuiwl-studio-id]") || targetEl;
  if (!el) return false;

  if (isLoading) {
    if (el.__studioHubBusy) return false;
    el.__studioHubBusy = true;
    el.__studioHubOriginalHtml = el.innerHTML;
    el.classList.add("is-loading");
    el.setAttribute("aria-busy", "true");
    el.style.pointerEvents = "none";
    el.style.opacity = "0.82";
    el.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>${el.__studioHubOriginalHtml || ""}`;
    try {
      if ("disabled" in el) el.disabled = true;
    } catch {}
    return true;
  }

  if (el.__studioHubOriginalHtml != null) {
    el.innerHTML = el.__studioHubOriginalHtml;
  }
  el.__studioHubOriginalHtml = null;
  el.__studioHubBusy = false;
  el.classList.remove("is-loading");
  el.removeAttribute("aria-busy");
  el.style.pointerEvents = "";
  el.style.opacity = "";
  try {
    if ("disabled" in el) el.disabled = false;
  } catch {}
  return true;
}

function getItemTypeName(itemLike) {
  return text(
    itemLike?.Type ||
    itemLike?.ItemType ||
    itemLike?.type ||
    itemLike?.itemType
  ).toLowerCase();
}

function getItemMediaTypeName(itemLike) {
  return text(
    itemLike?.MediaType ||
    itemLike?.mediaType
  ).toLowerCase();
}

function normalizeWatchlistTabKey(value) {
  const key = text(value).toLowerCase();
  const normalized = WATCHLIST_TAB_ALIASES[key] || key;
  return WATCHLIST_TAB_KEYS.has(normalized) ? normalized : DEFAULT_WATCHLIST_TAB;
}

function createEmptyWatchlistModel() {
  return Object.fromEntries(
    WATCHLIST_TABS.map((tab) => [tab.key, { own: [], shared: [] }])
  );
}

function getWatchlistTabLabel(tabKey) {
  const tab = WATCHLIST_TABS.find((entry) => entry.key === normalizeWatchlistTabKey(tabKey));
  return L(tab?.labelKey || "watchlistMovieTab", tab?.fallback || "Filmler");
}

function isSeriesItem(itemLike) {
  const type = getItemTypeName(itemLike);
  return type === "series" || type === "season" || type === "episode";
}

function isCollectionItem(itemLike) {
  const type = getItemTypeName(itemLike);
  return type === "boxset" || type === "collectionfolder";
}

function getPreviewContainerMode(itemLike) {
  const type = getItemTypeName(itemLike);
  if (type === "boxset" || type === "collectionfolder") return "collection";
  if (type === "series") return "season";
  if (type === "season") return "episode";
  return "";
}

function isMusicItem(itemLike) {
  const type = getItemTypeName(itemLike);
  const mediaType = getItemMediaTypeName(itemLike);
  if (type === "musicalbum") return false;
  if (mediaType === "audio") return true;
  return [
    "audio",
    "musicartist",
    "musicvideo",
    "playlist",
    "folder",
    "audiobook"
  ].includes(type);
}

function isMarkedPlayed(itemLike) {
  return itemLike?.UserData?.Played === true;
}

function hasPartialPlayback(itemLike) {
  const playbackTicks = Number(itemLike?.UserData?.PlaybackPositionTicks || 0);
  if (!(playbackTicks > 0)) return false;

  const runtimeTicks = Number(
    itemLike?.RunTimeTicks ||
    itemLike?.CumulativeRunTimeTicks ||
    itemLike?.runtimeTicks ||
    0
  );

  if (runtimeTicks > 0) return playbackTicks < runtimeTicks;
  return !isMarkedPlayed(itemLike);
}

function getPlayActionLabel(itemLike) {
  return hasPartialPlayback(itemLike)
    ? L("devamet", "Devam et")
    : L("playNowLabel", "Şimdi Oynat");
}

function toTimestampMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLastPlayedTimestamp(itemLike) {
  const userData = itemLike?.UserData || {};
  return Math.max(
    toTimestampMs(userData?.LastPlayedDate),
    toTimestampMs(userData?.LastPlayedDateUtc),
    toTimestampMs(itemLike?.DatePlayed)
  );
}

function wasPlayedAfterWatchlistTimestamp(itemLike, watchlistTs) {
  if (!isMarkedPlayed(itemLike)) return false;
  const threshold = toTimestampMs(watchlistTs);
  if (threshold <= 0) return false;
  return getLastPlayedTimestamp(itemLike) > threshold;
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttrSelector(value) {
  const raw = text(value);
  try {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(raw);
    }
  } catch {}
  return raw.replace(/["\\]/g, "\\$&");
}

async function copyTextToClipboard(value) {
  const raw = text(value);
  if (!raw) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
  } catch {}

  try {
    const input = document.createElement("textarea");
    input.value = raw;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = document.execCommand("copy");
    input.remove();
    return !!copied;
  } catch {}

  return false;
}

function getCurrentServerIdSafe() {
  try {
    return text(
      getSessionInfo?.()?.serverId ||
      getSessionInfo?.()?.ServerId ||
      window.ApiClient?._serverInfo?.Id ||
      window.ApiClient?._serverId
    );
  } catch {
    return text(
      getSessionInfo?.()?.serverId ||
      getSessionInfo?.()?.ServerId
    );
  }
}

async function maybeAutoEnsureStudioHub(studioId, studioName) {
  const cleanStudioId = text(studioId);
  const cleanStudioName = text(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return { attempted: false, added: false };
  }

  const config = cfg();
  if (config?.currentUserIsAdmin !== true || config?.studioHubsAutoAddFromWatchlistCopy !== true) {
    return { attempted: false, added: false };
  }

  if (autoAddStudioHubPendingIds.has(cleanStudioId)) {
    return { attempted: false, added: false, skipped: true, pending: true };
  }

  if (autoAddedStudioHubIds.has(cleanStudioId)) {
    return { attempted: false, added: false, skipped: true, existing: true };
  }

  autoAddStudioHubPendingIds.add(cleanStudioId);
  try {
    const result = await ensureStudioHubManualEntry({
      studioId: cleanStudioId,
      name: cleanStudioName
    });
    autoAddedStudioHubIds.add(cleanStudioId);

    try {
      window.dispatchEvent(new CustomEvent(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, {
        detail: {
          source: "watchlist-auto-add",
          studioId: cleanStudioId,
          studioName: cleanStudioName,
          entry: result?.entry || null,
          entries: Array.isArray(result?.entries) ? result.entries : []
        }
      }));
    } catch {}

    return {
      attempted: true,
      added: result?.created === true,
      existing: result?.existing === true,
      entry: result?.entry || null,
      entries: Array.isArray(result?.entries) ? result.entries : []
    };
  } catch (error) {
    return {
      attempted: true,
      added: false,
      error
    };
  } finally {
      autoAddStudioHubPendingIds.delete(cleanStudioId);
  }
}

async function maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, { entries = null } = {}) {
  const cleanStudioId = text(studioId);
  const cleanStudioName = text(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return { attempted: false, uploaded: false };
  }

  const config = cfg();
  if (config?.currentUserIsAdmin !== true || config?.studioHubsAutoAddFromWatchlistCopy !== true) {
    return { attempted: false, uploaded: false };
  }

  if (autoStudioHubLogoResolvedIds.has(cleanStudioId) || autoStudioHubLogoPendingIds.has(cleanStudioId)) {
    return { attempted: false, uploaded: false, skipped: true };
  }

  autoStudioHubLogoPendingIds.add(cleanStudioId);
  try {
    const result = await ensureStudioHubLogoFromTmdb({
      studioId: cleanStudioId,
      name: cleanStudioName,
      manualEntries: Array.isArray(entries) ? entries : null
    });
    autoStudioHubLogoResolvedIds.add(cleanStudioId);
    return {
      attempted: result?.attempted !== false,
      uploaded: result?.uploaded === true,
      skipped: result?.skipped === true,
      reason: text(result?.reason),
      entry: result?.entry || null,
      entries: Array.isArray(result?.entries) ? result.entries : []
    };
  } catch (error) {
    return {
      attempted: true,
      uploaded: false,
      error
    };
  } finally {
    autoStudioHubLogoPendingIds.delete(cleanStudioId);
  }
}

function getWatchlistTabsButtonMarkup(label) {
  const safeLabel = escapeHtml(label);
  return `
    <span class="monwui-watchlist-nav-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 20 20" focusable="false">
        <path fill="currentColor" d="M1 3h16v2H1Zm0 6h6v2H1Zm0 6h8v2H1Zm8-4.24h3.85L14.5 7l1.65 3.76H20l-3 3.17l.9 4.05l-3.4-2.14L11.1 18l.9-4.05Z" />
      </svg>
    </span>
    <span class="monwui-watchlist-nav-label">${safeLabel}</span>
  `;
}

function getCurrentUserContext() {
  let userId = "";
  let userName = "";

  try {
    const api = window.ApiClient || window.apiClient || null;
    userId = text(
      api?.getCurrentUserId?.() ||
      api?._currentUserId ||
      getSessionInfo?.()?.userId
    );
    userName = text(
      api?._currentUser?.Name ||
      api?._currentUser?.Username ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName")
    );
  } catch {}

  return { userId, userName };
}

function normalizeIdentity(value) {
  return text(value).toLowerCase();
}

function buildFavoriteMirrorKey(itemId, isFavorite) {
  return `${isFavorite ? "add" : "remove"}:${text(itemId)}`;
}

export function suppressFavoriteMirrorOnce(itemId, isFavorite) {
  const key = buildFavoriteMirrorKey(itemId, isFavorite);
  if (!key.endsWith(":")) {
    favoriteMirrorSuppressed.add(key);
    setTimeout(() => {
      favoriteMirrorSuppressed.delete(key);
    }, 15_000);
  }
}

function consumeFavoriteMirrorSuppression(itemId, isFavorite) {
  const key = buildFavoriteMirrorKey(itemId, isFavorite);
  if (!favoriteMirrorSuppressed.has(key)) return false;
  favoriteMirrorSuppressed.delete(key);
  return true;
}

function getFavoriteMirrorUserId() {
  return text(getCurrentUserContext().userId || getSessionInfo?.()?.userId);
}

function extractRequestUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (typeof input?.url === "string") return input.url;
  return String(input || "");
}

function parseFavoriteMutationRequest(method, requestUrl) {
  const normalizedMethod = text(method).toUpperCase();
  if (normalizedMethod !== "POST" && normalizedMethod !== "DELETE") return null;

  let parsed;
  try {
    parsed = new URL(extractRequestUrl(requestUrl), window.location.href);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(/\/Users\/([^/]+)\/FavoriteItems(?:\/([^/?#]+))?\/?$/i);
  if (!match) return null;

  const requestUserId = text(match[1]);
  const activeUserId = getFavoriteMirrorUserId();
  if (activeUserId && requestUserId && normalizeIdentity(activeUserId) !== normalizeIdentity(requestUserId)) {
    return null;
  }

  const itemIds = new Set();
  const directItemId = text(match[2]);
  if (directItemId) {
    itemIds.add(directItemId);
  }

  const idsFromQuery = [
    ...text(parsed.searchParams.get("Id")).split(","),
    ...text(parsed.searchParams.get("Ids")).split(",")
  ]
    .map((value) => text(value))
    .filter(Boolean);

  idsFromQuery.forEach((value) => itemIds.add(value));
  if (!itemIds.size) return null;

  return {
    itemIds: [...itemIds],
    isFavorite: normalizedMethod !== "DELETE"
  };
}

function queueFavoriteMirror(mutation) {
  const isFavorite = mutation?.isFavorite === true;
  const ids = Array.isArray(mutation?.itemIds) ? mutation.itemIds.map((value) => text(value)).filter(Boolean) : [];
  if (!ids.length) return;

  scheduleFavoriteMirrorTask(async () => {
    for (const itemId of ids) {
      if (consumeFavoriteMirrorSuppression(itemId, isFavorite)) continue;

      const pendingKey = buildFavoriteMirrorKey(itemId, isFavorite);
      if (favoriteMirrorPending.has(pendingKey)) continue;
      favoriteMirrorPending.add(pendingKey);

      try {
        if (isFavorite) {
          await addToWatchlist(itemId, { __favoriteMirror: true });
        } else {
          await removeFromWatchlist(itemId, { __favoriteMirror: true });
        }
      } catch (error) {
        console.debug("watchlist favorite mirror failed:", itemId, isFavorite, error);
      } finally {
        favoriteMirrorPending.delete(pendingKey);
      }
    }
  });
}

function installJellyfinFavoriteMirror() {
  if (favoriteMirrorInstalled) return;
  favoriteMirrorInstalled = true;

  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function patchedWatchlistFavoriteMirror(input, init) {
      const method = text(init?.method || input?.method || "GET");
      const requestUrl = extractRequestUrl(input);

      return nativeFetch(input, init).then((response) => {
        if (response?.ok) {
          const mutation = parseFavoriteMutationRequest(method, requestUrl);
          if (mutation?.itemIds?.length) queueFavoriteMirror(mutation);
        }
        return response;
      });
    };
  }

  if (typeof XMLHttpRequest !== "undefined") {
    const proto = XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;

    proto.open = function patchedWatchlistFavoriteMirrorOpen(method, url, ...rest) {
      this.__monwuiFavoriteMirror = {
        method: text(method),
        url: extractRequestUrl(url)
      };
      this.__monwuiFavoriteMirrorListenerAttached = false;
      return nativeOpen.call(this, method, url, ...rest);
    };

    proto.send = function patchedWatchlistFavoriteMirrorSend(body) {
      if (!this.__monwuiFavoriteMirrorListenerAttached) {
        this.__monwuiFavoriteMirrorListenerAttached = true;
        this.addEventListener("loadend", () => {
          if (this.status < 200 || this.status >= 300) return;
          const details = this.__monwuiFavoriteMirror || {};
          const mutation = parseFavoriteMutationRequest(details.method, details.url);
          if (mutation?.itemIds?.length) queueFavoriteMirror(mutation);
        }, { once: true });
      }

      return nativeSend.call(this, body);
    };
  }
}

function buildWatchlistHeaders(extra = {}) {
  const { userId, userName } = getCurrentUserContext();
  const headers = getEmbyHeaders({
    Accept: "application/json",
    ...extra
  });

  if (userId) headers["X-Emby-UserId"] = userId;
  if (userName) headers["X-jmsFusion-UserName"] = userName;

  return headers;
}

async function requestWatchlist(path = "", options = {}) {
  const response = await fetch(`${WATCHLIST_ENDPOINT}${path}`, {
    method: options.method || "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: buildWatchlistHeaders(options.headers || {}),
    body: options.body
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || `HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json().catch(() => ({}));
}

function normalizeDashboard(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    revision: Number(data.revision || 0),
    myItems: Array.isArray(data.myItems) ? data.myItems : [],
    sharedWithMe: Array.isArray(data.sharedWithMe) ? data.sharedWithMe : [],
    outgoingShares: Array.isArray(data.outgoingShares) ? data.outgoingShares : [],
  };

  normalized._membership = buildMembershipSet(normalized);
  normalized._loadedAt = Date.now();
  normalized._userId = getCurrentUserContext().userId;
  return normalized;
}

function buildMembershipSet(dashboard) {
  const set = new Set();

  for (const entry of dashboard?.myItems || []) {
    const itemId = text(entry?.ItemId || entry?.itemId);
    if (itemId) set.add(itemId);
  }

  for (const shared of dashboard?.sharedWithMe || []) {
    const itemId = text(shared?.ItemId || shared?.itemId || shared?.Entry?.ItemId || shared?.entry?.itemId);
    if (itemId) set.add(itemId);
  }

  return set;
}

function refreshMembership(dashboard = dashboardCache) {
  if (!dashboard) return null;
  dashboard._membership = buildMembershipSet(dashboard);
  dashboard._loadedAt = Date.now();
  dashboard._userId = getCurrentUserContext().userId;
  dashboardCache = dashboard;
  return dashboardCache;
}

function dashboardStale() {
  const currentUserId = getCurrentUserContext().userId;
  if (!dashboardCache) return true;
  if (dashboardCache._userId !== currentUserId) return true;
  return (Date.now() - Number(dashboardCache._loadedAt || 0)) > DASHBOARD_TTL_MS;
}

export async function ensureWatchlistLoaded({ force = false } = {}) {
  if (!force && dashboardCache && !dashboardStale()) {
    return dashboardCache;
  }

  if (!force && dashboardPromise) {
    return dashboardPromise;
  }

  dashboardPromise = (async () => {
    const raw = await requestWatchlist(`?ts=${Date.now()}`);
    dashboardCache = normalizeDashboard(raw);
    return dashboardCache;
  })().finally(() => {
    dashboardPromise = null;
  });

  return dashboardPromise;
}

export function getCachedWatchlistMembership(itemId, fallback = false) {
  const id = text(itemId);
  if (!id) return !!fallback;
  const membership = dashboardCache?._membership;
  if (membership instanceof Set) {
    return membership.has(id);
  }
  return !!fallback;
}

function patchItemMembership(item) {
  if (!item || typeof item !== "object") return item;
  const itemId = text(item?.Id || item?.ItemId);
  if (!itemId) return item;

  const inWatchlist = getCachedWatchlistMembership(itemId, item?.UserData?.IsFavorite === true);
  if (!item.UserData || typeof item.UserData !== "object") {
    item.UserData = {};
  }
  item.UserData.IsFavorite = inWatchlist;
  item.__monwuiInWatchlist = inWatchlist;
  return item;
}

export function applyWatchlistState(payload) {
  if (Array.isArray(payload)) {
    payload.forEach((item) => patchItemMembership(item));
    return payload;
  }

  if (payload && Array.isArray(payload.Items)) {
    payload.Items.forEach((item) => patchItemMembership(item));
    return payload;
  }

  return patchItemMembership(payload);
}

export async function hydrateWatchlistState(payload, { force = false } = {}) {
  await ensureWatchlistLoaded({ force });
  return applyWatchlistState(payload);
}

function snapshotFromItem(item, itemId) {
  return {
    ItemId: text(item?.Id || itemId),
    ItemType: text(item?.Type),
    Name: text(item?.Name || item?.Album),
    Overview: text(item?.Overview),
    ProductionYear: Number.isFinite(Number(item?.ProductionYear)) ? Number(item.ProductionYear) : null,
    RunTimeTicks: Number.isFinite(Number(item?.RunTimeTicks)) ? Number(item.RunTimeTicks) : null,
    CommunityRating: Number.isFinite(Number(item?.CommunityRating)) ? Number(item.CommunityRating) : null,
    OfficialRating: text(item?.OfficialRating),
    Genres: Array.isArray(item?.Genres) ? item.Genres.filter(Boolean) : [],
    AlbumArtist: text(item?.AlbumArtist),
    Artists: Array.isArray(item?.Artists) ? item.Artists.filter(Boolean) : [],
    ParentName: text(item?.SeriesName || item?.Album || item?.ParentName),
  };
}

function mutateCacheAfterAdd(entry) {
  const normalizedEntry = entry && typeof entry === "object" ? entry : null;
  if (!normalizedEntry) return;
  if (!dashboardCache) {
    dashboardCache = normalizeDashboard({
      myItems: [],
      sharedWithMe: [],
      outgoingShares: []
    });
  }

  const itemId = text(normalizedEntry.ItemId || normalizedEntry.itemId);
  if (!itemId) return;

  const nextItems = (dashboardCache.myItems || []).filter((item) => text(item?.ItemId || item?.itemId) !== itemId);
  nextItems.unshift(normalizedEntry);
  dashboardCache.myItems = nextItems;
  refreshMembership(dashboardCache);
}

function mutateCacheAfterRemove(itemId) {
  if (!dashboardCache) {
    dashboardCache = normalizeDashboard({
      myItems: [],
      sharedWithMe: [],
      outgoingShares: []
    });
  }
  if (!dashboardCache) return;
  const id = text(itemId);
  dashboardCache.myItems = (dashboardCache.myItems || []).filter((item) => text(item?.ItemId || item?.itemId) !== id);
  dashboardCache.sharedWithMe = (dashboardCache.sharedWithMe || []).filter((item) => text(item?.ItemId || item?.itemId || item?.Entry?.ItemId) !== id);
  dashboardCache.outgoingShares = (dashboardCache.outgoingShares || []).filter((share) => text(share?.ItemId || share?.itemId) !== id);
  refreshMembership(dashboardCache);
}

function mutateCacheAfterShareRemoval(shareId) {
  if (!dashboardCache) {
    dashboardCache = normalizeDashboard({
      myItems: [],
      sharedWithMe: [],
      outgoingShares: []
    });
  }
  if (!dashboardCache) return;
  const id = text(shareId);
  dashboardCache.sharedWithMe = (dashboardCache.sharedWithMe || []).filter((item) => text(item?.Id || item?.id) !== id);
  dashboardCache.outgoingShares = (dashboardCache.outgoingShares || []).filter((item) => text(item?.Id || item?.id) !== id);
  refreshMembership(dashboardCache);
}

function notifyWatchlistChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("monwui:watchlist-changed", {
      detail: {
        ...detail,
        revision: dashboardCache?.revision || 0
      }
    }));
  } catch {}
}

export function isMusicAlbumItem(itemLike) {
  const type = text(
    itemLike?.Type ||
    itemLike?.ItemType ||
    itemLike?.type ||
    itemLike?.itemType
  );
  return type.toLowerCase() === "musicalbum";
}

export function getWatchlistButtonText(itemLike, inWatchlist) {
  if (inWatchlist) {
    return isMusicAlbumItem(itemLike)
      ? L("watchlistAlbumRemove", "Albüm listesinden çıkar")
      : L("watchlistRemove", "Listeden çıkar");
  }

  return isMusicAlbumItem(itemLike)
    ? L("watchlistAlbumAdd", "Albüm listeme ekle")
    : L("watchlistAdd", "Listeme ekle");
}

export function getWatchlistButtonTitle(itemLike, inWatchlist) {
  return getWatchlistButtonText(itemLike, inWatchlist);
}

export function getWatchlistToast(itemLike, added) {
  if (added) {
    return isMusicAlbumItem(itemLike)
      ? L("watchlistAlbumAdded", "Albüm listene eklendi")
      : L("watchlistAdded", "Öğe listene eklendi");
  }

  return isMusicAlbumItem(itemLike)
    ? L("watchlistAlbumRemoved", "Albüm listenden çıkarıldı")
    : L("watchlistRemoved", "Öğe listenden çıkarıldı");
}

export function getWatchlistTabKey(itemLike) {
  if (isMusicAlbumItem(itemLike)) return "albums";
  if (isCollectionItem(itemLike)) return "collections";
  if (isSeriesItem(itemLike)) return "series";
  if (isMusicItem(itemLike)) return "music";
  return "movies";
}

export async function addToWatchlist(itemId, options = {}) {
  const id = text(itemId);
  if (!id) throw new Error("itemId gerekli");

  let item = options?.item || null;
  if (!item || text(item?.Id) !== id) {
    item = await fetchItemDetailsFull(id).catch(() => null);
  }

  const payload = snapshotFromItem(item, id);
  const result = await requestWatchlist("/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  mutateCacheAfterAdd(result?.item || payload);
  if (item) patchItemMembership(item);
  notifyWatchlistChanged({ itemId: id, inWatchlist: true });
  return result;
}

export async function removeFromWatchlist(itemId, options = {}) {
  const id = text(itemId);
  if (!id) throw new Error("itemId gerekli");

  const result = await requestWatchlist(`/items/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  mutateCacheAfterRemove(id);
  if (options?.item) patchItemMembership(options.item);
  notifyWatchlistChanged({ itemId: id, inWatchlist: false });
  return result;
}

export async function shareWatchlistItem(itemId, targets = [], note = "") {
  const id = text(itemId);
  const normalizedTargets = (targets || [])
    .map((target) => ({
      UserId: text(target?.UserId || target?.userId || target?.Id || target?.id),
      UserName: text(target?.UserName || target?.userName || target?.Name || target?.name)
    }))
    .filter((target) => target.UserId);

  if (!id) throw new Error("itemId gerekli");
  if (!normalizedTargets.length) throw new Error(L("watchlistSelectUsers", "En az bir kullanıcı seç"));

  const result = await requestWatchlist("/shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ItemId: id,
      Targets: normalizedTargets,
      Note: text(note)
    })
  });

  await ensureWatchlistLoaded({ force: true });
  notifyWatchlistChanged({ itemId: id, shared: true });
  return result;
}

export async function removeWatchlistShare(shareId) {
  const id = text(shareId);
  if (!id) throw new Error("shareId gerekli");

  const result = await requestWatchlist(`/shares/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  mutateCacheAfterShareRemoval(id);
  notifyWatchlistChanged({ shareId: id, shared: false });
  return result;
}

function collectAutoRemovalTasksByItemId(itemId, dashboard = dashboardCache) {
  const id = text(itemId);
  if (!id || !dashboard) return [];

  const tasks = [];
  const hasOwn = (dashboard.myItems || []).some((entry) => text(entry?.ItemId || entry?.itemId) === id);
  if (hasOwn) {
    tasks.push({ kind: "own", itemId: id });
  }

  for (const shared of dashboard.sharedWithMe || []) {
    const shareId = text(shared?.Id || shared?.id);
    const sharedItemId = text(shared?.ItemId || shared?.itemId || shared?.Entry?.ItemId || shared?.entry?.itemId);
    if (!shareId || sharedItemId !== id) continue;
    tasks.push({ kind: "shared", itemId: id, shareId });
  }

  return tasks;
}

function dedupeAutoRemovalTasks(tasks = []) {
  const out = [];
  const seen = new Set();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const dedupeKey = task?.kind === "shared"
      ? `shared:${text(task?.shareId)}`
      : `own:${text(task?.itemId)}`;

    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(task);
  }

  return out;
}

async function mapWithConcurrency(items = [], limit = 3, iteratee) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length || typeof iteratee !== "function") return [];

  const out = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      out[index] = await iteratee(list[index], index);
    }
  });

  await Promise.all(workers);
  return out;
}

function getSeriesSeasonAutoRemoveMode(itemLike) {
  const type = getItemTypeName(itemLike);
  if (type === "series") return "series";
  if (type === "season") return "season";
  return "";
}

async function fetchSeriesSeasonAutoRemoveItems(containerItem, { signal } = {}) {
  const mode = getSeriesSeasonAutoRemoveMode(containerItem);
  const itemId = text(containerItem?.Id || containerItem?.itemId);
  const userId = getCurrentUserIdSafe();
  if (!userId || !itemId || !mode) return [];

  const out = [];
  const seen = new Set();
  let startIndex = 0;

  while (true) {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", itemId);
    qp.set("IncludeItemTypes", "Episode");
    qp.set("Recursive", mode === "series" ? "true" : "false");
    qp.set("Fields", "Id,UserData");
    qp.set("SortBy", "ParentIndexNumber,IndexNumber,SortName");
    qp.set("SortOrder", "Ascending");
    qp.set("Limit", String(WATCHLIST_COLLECTION_PAGE_SIZE));
    qp.set("StartIndex", String(startIndex));

    const response = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const pageItems = Array.isArray(response?.Items) ? response.Items : [];

    for (const item of pageItems) {
      const id = text(item?.Id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }

    if (pageItems.length < WATCHLIST_COLLECTION_PAGE_SIZE) break;
    startIndex += WATCHLIST_COLLECTION_PAGE_SIZE;
  }

  return out;
}

async function isSeriesSeasonWatchlistItemComplete(containerItem, { signal } = {}) {
  const items = await fetchSeriesSeasonAutoRemoveItems(containerItem, { signal }).catch(() => []);
  return items.length > 0 && items.every((item) => isMarkedPlayed(item));
}

async function getCompletedSeriesSeasonWatchlistItemIds(dashboard, found) {
  const candidates = new Map();

  const registerCandidate = (entryLike, liveItem = null) => {
    const itemId = text(
      liveItem?.Id ||
      entryLike?.ItemId ||
      entryLike?.itemId ||
      entryLike?.Entry?.ItemId ||
      entryLike?.entry?.itemId
    );
    if (!itemId || candidates.has(itemId)) return;

    const mode = getSeriesSeasonAutoRemoveMode(liveItem || entryLike);
    if (!mode) return;

    candidates.set(itemId, {
      Id: itemId,
      Type: mode === "series" ? "Series" : "Season"
    });
  };

  for (const entry of dashboard?.myItems || []) {
    const itemId = text(entry?.ItemId || entry?.itemId);
    registerCandidate(entry, found?.get?.(itemId) || null);
  }

  for (const shared of dashboard?.sharedWithMe || []) {
    const entry = shared?.Entry || shared?.entry || shared;
    const itemId = text(shared?.ItemId || shared?.itemId || entry?.ItemId || entry?.itemId);
    registerCandidate(entry, found?.get?.(itemId) || null);
  }

  if (!candidates.size) return new Set();

  const checks = await mapWithConcurrency(
    [...candidates.values()],
    3,
    async (candidate) => {
      const complete = await isSeriesSeasonWatchlistItemComplete(candidate).catch(() => false);
      return complete ? candidate.Id : "";
    }
  );

  return new Set(checks.filter(Boolean));
}

async function collectParentContainerAutoRemovalTasks(itemId, dashboard = dashboardCache) {
  const id = text(itemId);
  if (!id || !dashboard) return [];

  const details = await fetchItemDetailsFull(id).catch(() => null);
  const type = getItemTypeName(details);
  if (!type) return [];

  const candidates = [];
  if (type === "episode") {
    const seasonId = text(details?.SeasonId);
    const seriesId = text(details?.SeriesId || details?.Series?.Id);
    if (seasonId) candidates.push({ Id: seasonId, Type: "Season" });
    if (seriesId) candidates.push({ Id: seriesId, Type: "Series" });
  } else if (type === "season") {
    const seriesId = text(details?.SeriesId || details?.Series?.Id);
    if (seriesId) candidates.push({ Id: seriesId, Type: "Series" });
  }

  if (!candidates.length) return [];

  const taskGroups = await Promise.all(
    candidates.map(async (candidate) => {
      const tasks = collectAutoRemovalTasksByItemId(candidate.Id, dashboard);
      if (!tasks.length) return [];

      const complete = await isSeriesSeasonWatchlistItemComplete(candidate).catch(() => false);
      return complete ? tasks : [];
    })
  );

  return dedupeAutoRemovalTasks(taskGroups.flat());
}

async function processAutoRemovalTasks(tasks = []) {
  const queue = dedupeAutoRemovalTasks(tasks).filter(Boolean);
  if (!queue.length) return;

  autoRemoveQueue = autoRemoveQueue
    .catch(() => {})
    .then(async () => {
      for (const task of queue) {
        const dedupeKey = task.kind === "shared"
          ? `shared:${text(task.shareId)}`
          : `own:${text(task.itemId)}`;

        if (!dedupeKey || pendingAutoRemovalKeys.has(dedupeKey)) continue;
        pendingAutoRemovalKeys.add(dedupeKey);

        try {
          if (task.kind === "shared" && task.shareId) {
            await removeWatchlistShare(task.shareId);
          } else if (task.itemId) {
            if (shouldAutoRemovePlayedFromFavorites()) {
              await updateFavoriteStatus(task.itemId, false);
            } else {
              await removeFromWatchlist(task.itemId);
            }
          }
        } catch {} finally {
          pendingAutoRemovalKeys.delete(dedupeKey);
        }
      }
    });

  return autoRemoveQueue;
}

function queueAutoRemoveWatchedEntries(tasks = []) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return;
  void processAutoRemovalTasks(tasks);
}

export async function removePlayedItemFromWatchlist(itemId) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return false;

  const id = text(itemId);
  if (!id) return false;

  const dashboard = dashboardCache || await ensureWatchlistLoaded().catch(() => null);
  const directTasks = collectAutoRemovalTasksByItemId(id, dashboard);
  const parentTasks = await collectParentContainerAutoRemovalTasks(id, dashboard).catch(() => []);
  const tasks = dedupeAutoRemovalTasks([...directTasks, ...parentTasks]);
  if (!tasks.length) return false;

  await processAutoRemovalTasks(tasks);
  return true;
}

async function fetchShareableUsers() {
  if (Array.isArray(usersCache)) return usersCache;
  if (usersPromise) return usersPromise;

  usersPromise = (async () => {
    const currentUserId = getCurrentUserContext().userId;
    let users = [];

    try {
      const api = window.ApiClient || window.apiClient || null;
      if (api && typeof api.getUsers === "function") {
        const direct = await api.getUsers().catch(() => null);
        if (Array.isArray(direct)) users = direct;
      }
    } catch {}

    if (!users.length) {
      try {
        const response = await fetch(withServer("/Users/Public"), {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json"
          }
        });
        if (response.ok) {
          const parsed = await response.json().catch(() => []);
          users = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.Items) ? parsed.Items : []);
        }
      } catch {}
    }

    usersCache = (Array.isArray(users) ? users : [])
      .map((user) => ({
        id: text(user?.Id || user?.id),
        name: text(user?.Name || user?.Username || user?.name || user?.username)
      }))
      .filter((user) => user.id && user.name && user.id !== currentUserId)
      .sort((left, right) => left.name.localeCompare(right.name, cfg()?.dateLocale || "tr-TR"));

    return usersCache;
  })().finally(() => {
    usersPromise = null;
  });

  return usersPromise;
}

function ensureStyles() {
  if (document.getElementById(WATCHLIST_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = WATCHLIST_STYLE_ID;
  style.textContent = `
    #${WATCHLIST_MODAL_ID} {
      inset: 0;
      position: fixed;
      z-index: 9998;
      display: none;
    }
    #${WATCHLIST_MODAL_ID}.visible {
      display: block;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at top left, rgba(255, 193, 7, 0.18), transparent 28%),
        linear-gradient(180deg, rgba(8, 10, 16, 0.72), rgba(7, 9, 15, 0.92));
      backdrop-filter: blur(14px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-card {
      width: min(1280px, calc(110vw - 24px));
      height: min(92vh, 900px);
      background:
        linear-gradient(180deg, rgba(21, 25, 36, 0.96), rgba(10, 12, 18, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      color: #f8f8fb;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 24px 24px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-title {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 0 6px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-subtitle {
      color: rgba(255,255,255,0.72);
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
      max-width: 680px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-close,
    #${WATCHLIST_MODAL_ID} .monwuiwl-tab,
    #${WATCHLIST_MODAL_ID} .monwuiwl-btn,
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-submit,
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-cancel {
      border: 0;
      cursor: pointer;
      transition: transform .18s ease, background-color .18s ease, opacity .18s ease;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-close {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 18px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-close:hover,
    #${WATCHLIST_MODAL_ID} .monwuiwl-btn:hover,
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-submit:hover,
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-cancel:hover {
      transform: translateY(-1px);
    }
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS} {
      align-items: center;
      display: inline-flex !important;
      gap: 8px;
      position: relative;
      border:none;
      color: inherit;
    }
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS}:hover {
      opacity: 1;
    }
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS} .monwui-watchlist-nav-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      flex-shrink: 0;
      pointer-events: none;
    }
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS} .monwui-watchlist-nav-label {
      display: inline-block;
      pointer-events: none;
    }
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS} .monwui-watchlist-nav-icon svg,
    .emby-tabs-slider .${WATCHLIST_NAV_BUTTON_CLASS} .monwui-watchlist-nav-icon path {
      pointer-events: none;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-tabs {
      display: inline-flex;
      gap: 10px;
      padding: 14px 24px 0;
      flex-wrap: wrap;
      flex-direction: row;
      align-content: center;
      justify-content: center;
      align-items: center;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-tab {
      padding: 11px 16px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.78);
      font-size: 12px;
      font-weight: 700;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-tab.active {
      background: linear-gradient(135deg, #ffb703, #fb8500);
      color: #141822;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-body {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      padding: 18px 24px 24px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(330px, 400px);
      grid-template-areas: "main preview";
      gap: 18px;
      height: 100%;
      min-height: 0;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-main {
      grid-area: main;
      min-height: 0;
      overflow: auto;
      padding-right: 6px;
      scrollbar-color: #ffb703 transparent;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview {
      grid-area: preview;
      min-height: 0;
      overflow: auto;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.08);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03)),
        linear-gradient(180deg, rgba(18, 22, 32, 0.98), rgba(10, 12, 18, 0.98));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
      scrollbar-color: #ffb703 transparent;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-empty {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 26px;
      text-align: center;
      color: rgba(255,255,255,0.78);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-empty-copy {
      max-width: 280px;
      line-height: 1.7;
      font-size: 13px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-shell {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-hero {
      position: relative;
      min-height: 252px;
      overflow: hidden;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(135deg, rgba(255,183,3,0.12), rgba(251,133,0,0.06));
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-backdrop {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.28;
      filter: saturate(1.05);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-hero::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(7, 9, 15, 0.18), rgba(7, 9, 15, 0.94)),
        linear-gradient(90deg, rgba(7, 9, 15, 0.12), rgba(7, 9, 15, 0.66));
      pointer-events: none;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-hero-inner {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: 104px minmax(0, 1fr);
      gap: 14px;
      padding: 18px;
      align-items: end;
      min-height: 252px;
      box-sizing: border-box;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-poster {
      width: 104px;
      height: 152px;
      border-radius: 16px;
      overflow: hidden;
      background:
        linear-gradient(160deg, rgba(255,183,3,0.28), rgba(251,133,0,0.08)),
        rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 20px 40px rgba(0,0,0,0.28);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-poster img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-poster-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      padding: 12px;
      box-sizing: border-box;
      color: rgba(255,255,255,0.9);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #ffb703;
      background: linear-gradient(180deg, transparent, rgba(0,0,0,0.54));
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-head {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-kicker {
      color: rgba(255,255,255,0.68);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #ffb703;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-title {
      margin: 0;
      font-size: 24px;
      line-height: 1.08;
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-subtitle {
      color: rgba(255,255,255,0.74);
      font-size: 13px;
      line-height: 1.5;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 6px;
      padding: 6px 10px;
      background: rgba(255,255,255,0.10);
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.9);
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      backdrop-filter: blur(10px);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-chip.accent {
      background: linear-gradient(135deg, rgba(255,183,3,0.22), rgba(251,133,0,0.18));
      color: #fff3d2;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-progress {
      margin-top: 2px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-progress-track {
      width: 100%;
      height: 8px;
      border-radius: 6px;
      overflow: hidden;
      background: rgba(255,255,255,0.12);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-progress-bar {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ffb703, #fb8500);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-progress-copy {
      margin-top: 8px;
      color: rgba(255,255,255,0.72);
      font-size: 12px;
      line-height: 1.5;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-body {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-loading {
      color: rgba(255,255,255,0.66);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #ffb703;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-note {
      margin: 0;
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.84);
      font-size: 13px;
      line-height: 1.6;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-overview {
      margin: 0;
      color: rgba(255,255,255,0.82);
      font-size: 13px;
      line-height: 1.72;
      display: -webkit-box;
      -webkit-line-clamp: 7;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-stat {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      min-width: 0;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-stat-label {
      color: rgba(255,255,255,0.58);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #ffb703;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-stat-value {
      color: #fff;
      font-size: 13px;
      line-height: 1.5;
      font-weight: 700;
      word-break: break-word;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-section-title {
      margin: 0;
      color: rgba(255,255,255,0.66);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: #ffb703;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-field-list {
      display: grid;
      gap: 8px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-field {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-field-label {
      color: rgba(255,255,255,0.52);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.45;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-field-value {
      color: rgba(255,255,255,0.88);
      font-size: 12px;
      line-height: 1.6;
      word-break: break-word;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-list li {
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.88);
      font-size: 12px;
      line-height: 1.55;
      word-break: break-word;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tag {
      appearance: none;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.88);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.3;
      padding: 7px 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tag-button {
      cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tag-button:hover {
      background: rgba(255,183,3,0.16);
      border-color: rgba(255,183,3,0.28);
      color: #fff3d2;
      transform: translateY(-1px);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tag-button:focus-visible {
      outline: 2px solid rgba(255,183,3,0.55);
      outline-offset: 2px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-tag-button.is-copied {
      background: linear-gradient(135deg, rgba(255,183,3,0.24), rgba(251,133,0,0.18));
      border-color: rgba(255,183,3,0.36);
      color: #fff6dd;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-count {
      color: rgba(255,255,255,0.62);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.4;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card {
      appearance: none;
      display: block;
      width: 100%;
      min-width: 0;
      padding: 10px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.06);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.02);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      text-align: left;
      cursor: pointer;
      color: inherit;
      font: inherit;
      transition: transform .18s ease, border-color .18s ease, background-color .18s ease;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card:hover,
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(255,183,3,0.34);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)),
        rgba(255,255,255,0.03);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card:focus-visible {
      outline: 2px solid rgba(255,183,3,0.72);
      outline-offset: 2px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-poster {
      position: relative;
      overflow: hidden;
      border-radius: 12px;
      aspect-ratio: 2 / 3;
      background:
        linear-gradient(160deg, rgba(255,183,3,0.20), rgba(251,133,0,0.08)),
        rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-poster img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      padding: 10px;
      box-sizing: border-box;
      color: #ffcf6e;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.08em;
      background: linear-gradient(180deg, transparent, rgba(0,0,0,0.58));
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-title {
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-meta {
      color: rgba(255,255,255,0.66);
      font-size: 11px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-progress {
      height: 5px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255,255,255,0.10);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-progress-bar {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ffb703, #fb8500);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-note {
      color: rgba(255,255,255,0.62);
      font-size: 12px;
      line-height: 1.5;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-played-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      pointer-events: none;
      background:
        radial-gradient(circle at center, rgba(129,201,149,0.16), rgba(12,18,26,0.26) 42%, rgba(7,9,15,0.72) 100%);
      backdrop-filter: blur(1px);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-played-mark {
      width: 60px;
      height: 60px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(163,230,53,0.98), rgba(16,185,129,0.88));
      box-shadow:
        0 18px 34px rgba(0,0,0,0.34),
        0 0 0 3px rgba(255,255,255,0.12);
      color: #04210f;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-played-mark svg {
      width: 34px;
      height: 34px;
      display: block;
      fill: currentColor;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-played-text {
      color: #f4fff7;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.16em;
      line-height: 1;
      text-transform: uppercase;
      text-shadow: 0 6px 16px rgba(0,0,0,0.45);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item.is-played,
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card.is-played {
      border-color: rgba(129,201,149,0.34);
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(163,230,53,0.08);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item.is-played .monwuiwl-item-poster img,
    #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-card.is-played .monwuiwl-preview-collection-poster img {
      filter: saturate(0.85) brightness(0.76);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster .monwuiwl-played-mark {
      width: 54px;
      height: 54px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster .monwuiwl-played-mark svg {
      width: 30px;
      height: 30px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster .monwuiwl-played-text {
      font-size: 9px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-section + .monwuiwl-section {
      margin-top: 22px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-section-title {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
   #${WATCHLIST_MODAL_ID} .monwuiwl-item-sharemeta {
      background: linear-gradient(135deg, #ffb703, #fb8500) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      color: transparent !important;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item {
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      overflow: hidden;
      display: grid;
      grid-template-columns: 110px minmax(0, 1fr);
      min-height: 206px;
      cursor: pointer;
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item:hover,
    #${WATCHLIST_MODAL_ID} .monwuiwl-item.is-preview-active,
    #${WATCHLIST_MODAL_ID} .monwuiwl-item:focus-within {
      transform: translateY(-2px);
      border-color: rgba(255, 183, 3, 0.42);
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster {
      background:
        linear-gradient(160deg, rgba(255,183,3,0.38), rgba(251,133,0,0.08)),
        rgba(255,255,255,0.04);
      position: relative;
      min-height: 100%;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-poster-fallback {
      inset: 0;
      position: absolute;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      padding: 12px;
      font-size: 12px;
      font-weight: 700;
      color: rgba(255,255,255,0.92);
      background: linear-gradient(180deg, transparent, rgba(0,0,0,0.55));
      color: #ffb703;
      letter-spacing: .08em;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-main {
      padding: 14px 14px 12px;
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 10px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-title {
      margin: 0;
      font-size: 17px;
      font-weight: 800;
      line-height: 1.22;
      letter-spacing: -0.02em;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-meta,
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-extra,
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-sharemeta {
      color: rgba(255,255,255,0.72);
      font-size: 12px;
      line-height: 1.5;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-overview {
      color: rgba(255,255,255,0.78);
      font-size: 13px;
      line-height: 1.56;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 82px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-tags {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      align-content: center;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-tag {
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.84);
      font-size: 11px;
      font-weight: 700;
      padding: 5px 9px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: auto;
      align-items: center;
      justify-content: center;
      align-content: center;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-btn {
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 800;
      color: #fff;
      background: rgba(255,255,255,0.08);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-btn.primary {
      background: linear-gradient(135deg, #ffb703, #fb8500);
      color: #1b1f28;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-btn.danger {
      background: rgba(244, 63, 94, 0.18);
      color: #ffd7df;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-item:focus {
      outline: none;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-empty,
    #${WATCHLIST_MODAL_ID} .monwuiwl-loading,
    #${WATCHLIST_MODAL_ID} .monwuiwl-error {
      border: 1px dashed rgba(255,255,255,0.14);
      border-radius: 18px;
      padding: 24px;
      text-align: center;
      color: rgba(255,255,255,0.74);
      background: rgba(255,255,255,0.03);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-overlay {
      position: absolute;
      inset: 0;
      background: rgba(7, 9, 15, 0.74);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-card {
      width: min(560px, calc(100vw - 40px));
      max-height: min(82vh, 760px);
      overflow: auto;
      background: linear-gradient(180deg, rgba(25,29,40,0.98), rgba(12,14,20,0.98));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      padding: 22px;
      color: #fff;
      box-shadow: 0 24px 60px rgba(0,0,0,0.42);
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-title {
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-help {
      color: rgba(255,255,255,0.7);
      font-size: 13px;
      line-height: 1.56;
      margin: 0 0 16px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-list {
      display: grid;
      gap: 8px;
      margin-bottom: 16px;
      max-height: 240px;
      overflow: auto;
      padding-right: 4px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-user {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(255,255,255,0.04);
      border-radius: 12px;
      padding: 10px 12px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-user input {
      accent-color: #ffb703;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-note-label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-note {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.04);
      color: #fff;
      padding: 12px 14px;
      font: inherit;
      box-sizing: border-box;
      outline: none;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-submit,
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-cancel {
      border-radius: 12px;
      padding: 11px 14px;
      font-size: 13px;
      font-weight: 800;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-submit {
      background: linear-gradient(135deg, #ffb703, #fb8500);
      color: #1b1f28;
    }
    #${WATCHLIST_MODAL_ID} .monwuiwl-share-cancel {
      background: rgba(255,255,255,0.08);
      color: #fff;
    }
    @media (max-width: 920px) {
      #${WATCHLIST_MODAL_ID} .monwuiwl-card {
        height: min(92vh, 980px);
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-layout {
        grid-template-columns: 1fr;
        grid-template-areas:
          "preview"
          "main";
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview {
        max-height: 56vh;
      }
    }
    @media (max-width: 760px) {
      #${WATCHLIST_MODAL_ID} .monwuiwl-card {
        width: 100%;
        height: 100%;
        border-radius: 0;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-backdrop {
        padding: 0;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-header {
        padding: 18px 16px 12px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-tabs {
        padding: 12px 16px 0;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-body {
        padding: 16px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-layout {
        gap: 14px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-main {
        padding-right: 0;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview {
        max-height: none;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-hero-inner {
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 12px;
        min-height: 220px;
        padding: 16px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-poster {
        width: 88px;
        height: 132px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-title {
        font-size: 20px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-body {
        padding: 16px;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-stats {
        grid-template-columns: 1fr;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-preview-collection-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-grid {
        grid-template-columns: 1fr;
      }
      #${WATCHLIST_MODAL_ID} .monwuiwl-item {
        grid-template-columns: 96px minmax(0, 1fr);
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureModalRoot() {
  let root = document.getElementById(WATCHLIST_MODAL_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = WATCHLIST_MODAL_ID;
  document.body.appendChild(root);
  root.addEventListener("click", async (event) => {
    const closeButton = event.target?.closest?.("[data-monwuiwl-close='1']");
    if (closeButton) {
      await closeWatchlistModal();
      return;
    }

    const backdrop = event.target?.closest?.(".monwuiwl-backdrop");
    const card = event.target?.closest?.(".monwuiwl-card");
    if (backdrop && !card) {
      await closeWatchlistModal();
    }
  });

  window.addEventListener("monwui:watchlist-changed", () => {
    if (!root.classList.contains("visible")) return;
    const state = root.__state || {};
    renderWatchlistModal(root, state).catch(() => {});
  });

  return root;
}

function setVisible(root, visible) {
  if (!root) return;
  root.classList.toggle("visible", !!visible);
  root.setAttribute("aria-hidden", visible ? "false" : "true");
}

function formatDate(ts) {
  const date = new Date(Number(ts || 0));
  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat(cfg()?.dateLocale || "tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function formatRuntime(ticks) {
  const totalMinutes = Math.round(Number(ticks || 0) / 600000000);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} ${L("dk", "dk")}`;
  return `${hours} ${L("sa", "sa")} ${minutes} ${L("dk", "dk")}`;
}

function ticksToMs(value) {
  const ticks = Number(value || 0);
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.round(ticks / 10000);
}

function formatDateTime(ts) {
  const date = new Date(Number(ts || 0));
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();

  try {
    return new Intl.DateTimeFormat(cfg()?.timeLocale || cfg()?.dateLocale || "tr-TR", sameDay ? {
      hour: "2-digit",
      minute: "2-digit"
    } : {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch {
    return sameDay ? date.toLocaleTimeString() : date.toLocaleString();
  }
}

function formatFinishTime(runtimeTicks, playbackTicks = 0) {
  const totalTicks = Math.max(Number(runtimeTicks || 0), 0);
  const watchedTicks = Math.max(Number(playbackTicks || 0), 0);
  const remainingTicks = Math.max(totalTicks - watchedTicks, 0);
  if (!remainingTicks) return "";
  return formatDateTime(Date.now() + ticksToMs(remainingTicks));
}

function formatBitrate(value) {
  const bitrate = Number(value || 0);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return "";
  if (bitrate >= 1000000) {
    const mbps = bitrate / 1000000;
    return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
  }
  return `${Math.round(bitrate / 1000)} kbps`;
}

function formatChannels(value) {
  const channels = Number(value || 0);
  if (!Number.isFinite(channels) || channels <= 0) return "";
  if (channels === 1) return "1.0";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels} ch`;
}

function parseNumberLike(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = text(value);
  if (!raw) return 0;

  if (raw.includes("/")) {
    const [num, den] = raw.split("/").map((part) => Number(part));
    if (Number.isFinite(num) && Number.isFinite(den) && den) {
      return num / den;
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqTextList(values = []) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function buildPosterUrl(item, { width = 220, height = 320, quality = 90 } = {}) {
  const itemId = text(item?.Id);
  const primaryTag = text(item?.ImageTags?.Primary || item?.PrimaryImageTag || item?.AlbumPrimaryImageTag);
  if (itemId && primaryTag) {
    return withServer(`/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&fillWidth=${encodeURIComponent(width)}&fillHeight=${encodeURIComponent(height)}&quality=${encodeURIComponent(quality)}`);
  }

  const albumId = text(item?.AlbumId);
  const albumTag = text(item?.AlbumPrimaryImageTag);
  if (albumId && albumTag) {
    return withServer(`/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumTag)}&fillWidth=${encodeURIComponent(width)}&fillHeight=${encodeURIComponent(height)}&quality=${encodeURIComponent(quality)}`);
  }

  return "";
}

function buildBackdropUrl(item, { width = 960, quality = 85 } = {}) {
  const itemId = text(item?.Id);
  const itemTag = text(
    (Array.isArray(item?.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item?.BackdropImageTag ||
    item?.ImageTags?.Backdrop
  );
  if (itemId && itemTag) {
    return withServer(`/Items/${encodeURIComponent(itemId)}/Images/Backdrop?tag=${encodeURIComponent(itemTag)}&maxWidth=${encodeURIComponent(width)}&quality=${encodeURIComponent(quality)}&EnableImageEnhancers=false`);
  }

  const itemType = getItemTypeName(item);
  if (itemType === "season" || itemType === "episode") {
    const seriesId = text(item?.SeriesId || item?.Series?.Id);
    const seriesBackdropTag = text(
      item?.SeriesBackdropImageTag ||
      (Array.isArray(item?.SeriesBackdropImageTags) && item.SeriesBackdropImageTags[0]) ||
      (Array.isArray(item?.Series?.BackdropImageTags) && item.Series.BackdropImageTags[0]) ||
      item?.Series?.BackdropImageTag
    );
    if (seriesId && seriesBackdropTag) {
      return withServer(`/Items/${encodeURIComponent(seriesId)}/Images/Backdrop?tag=${encodeURIComponent(seriesBackdropTag)}&maxWidth=${encodeURIComponent(width)}&quality=${encodeURIComponent(quality)}&EnableImageEnhancers=false`);
    }
  }

  const parentBackdropItemId = text(item?.ParentBackdropItemId || item?.ParentId);
  const parentBackdropTag = text(Array.isArray(item?.ParentBackdropImageTags) ? item.ParentBackdropImageTags[0] : "");
  if (parentBackdropItemId && parentBackdropTag) {
    return withServer(`/Items/${encodeURIComponent(parentBackdropItemId)}/Images/Backdrop?tag=${encodeURIComponent(parentBackdropTag)}&maxWidth=${encodeURIComponent(width)}&quality=${encodeURIComponent(quality)}&EnableImageEnhancers=false`);
  }

  return "";
}

function getVideoQualityLabel(videoStream) {
  if (!videoStream || text(videoStream?.Type).toLowerCase() !== "video") return "";

  const height = Math.max(
    Number(videoStream?.Height || 0),
    Number(videoStream?.RealHeight || 0)
  );
  const width = Math.max(
    Number(videoStream?.Width || 0),
    Number(videoStream?.RealWidth || 0)
  );
  const range = text(videoStream?.VideoRangeType).toUpperCase();
  const codec = text(videoStream?.Codec).toUpperCase();
  const fps = parseNumberLike(videoStream?.RealFrameRate || videoStream?.AverageFrameRate || videoStream?.FrameRate);
  const bitrate = formatBitrate(videoStream?.BitRate);

  let quality = "";
  if (height >= 2160 || width >= 3800) quality = "4K";
  else if (height >= 1440) quality = "1440p";
  else if (height >= 1080 || width >= 1900) quality = "1080p";
  else if (height >= 720) quality = "720p";
  else if (height >= 480) quality = "480p";
  else if (height > 0) quality = `${Math.round(height)}p`;

  const dynamicRange = range.includes("DOVI")
    ? "Dolby Vision"
    : (range.includes("HDR") ? "HDR" : "");
  const fpsText = fps > 0 ? `${fps >= 10 ? fps.toFixed(0) : fps.toFixed(2)} fps`.replace(/\.00(?= fps)/, "") : "";

  return [quality, dynamicRange, codec, fpsText, bitrate].filter(Boolean).join(" • ");
}

function getMediaStreamsByType(item, type) {
  return (Array.isArray(item?.MediaStreams) ? item.MediaStreams : [])
    .filter((stream) => text(stream?.Type).toLowerCase() === text(type).toLowerCase());
}

function getPrimaryVideoStream(item) {
  return getMediaStreamsByType(item, "Video")[0] || null;
}

function formatAudioStream(stream) {
  const language = text(stream?.DisplayLanguage || stream?.Language || stream?.LanguageCode);
  const codec = text(stream?.Codec).toUpperCase();
  const channels = formatChannels(stream?.Channels);
  const bitrate = formatBitrate(stream?.BitRate);
  const labels = [language, codec, channels, bitrate].filter(Boolean);
  const flags = [];
  if (stream?.IsDefault) flags.push(L("default", "Varsayılan"));
  if (stream?.IsExternal) flags.push(L("external", "Harici"));
  if (stream?.Title) flags.push(text(stream.Title));
  return [labels.join(" • "), flags.join(" • ")].filter(Boolean).join(" - ");
}

function formatSubtitleStream(stream) {
  const language = text(stream?.DisplayLanguage || stream?.Language || stream?.LanguageCode);
  const codec = text(stream?.Codec).toUpperCase();
  const title = text(stream?.DisplayTitle || stream?.Title);
  const flags = [];
  if (stream?.IsDefault) flags.push(L("default", "Varsayılan"));
  if (stream?.IsForced) flags.push(L("forced", "Zorunlu"));
  if (stream?.IsExternal) flags.push(L("external", "Harici"));

  return [language, codec, title, flags.join(" • ")].filter(Boolean).join(" • ");
}

function isStale(ts, maxAgeMs) {
  const value = Number(ts || 0);
  if (!value) return true;
  return (Date.now() - value) > maxAgeMs;
}

function getCurrentUserIdSafe() {
  try {
    return text(
      window.ApiClient?.getCurrentUserId?.() ||
      window.ApiClient?._currentUserId ||
      getSessionInfo?.()?.userId
    );
  } catch {
    return text(getSessionInfo?.()?.userId);
  }
}

function createPreviewPayload(overrides = {}) {
  return {
    details: null,
    collectionItems: [],
    collectionItemsTotal: 0,
    collectionItemsLoaded: false,
    collectionItemsStale: false,
    collectionItemsUpdatedAt: 0,
    collectionItemsSource: "",
    ...overrides,
  };
}

function getPreviewPayload(value) {
  if (!value || typeof value !== "object") {
    return createPreviewPayload();
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "details") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItems") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsLoaded") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsTotal") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsStale")
  ) {
    return createPreviewPayload({
      details: value.details && typeof value.details === "object" ? value.details : null,
      collectionItems: Array.isArray(value.collectionItems) ? value.collectionItems : [],
      collectionItemsTotal: Number(value.collectionItemsTotal || 0),
      collectionItemsLoaded: value.collectionItemsLoaded === true,
      collectionItemsStale: value.collectionItemsStale === true,
      collectionItemsUpdatedAt: Number(value.collectionItemsUpdatedAt || 0),
      collectionItemsSource: text(value.collectionItemsSource),
    });
  }

  return createPreviewPayload({ details: value });
}

function hasPreviewDetails(value) {
  return !!getPreviewPayload(value).details?.Id;
}

function normalizeCollectionPreviewItems(items = []) {
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const id = text(item?.Id || item?.id);
    const hasRenderableData = !!(
      id ||
      text(item?.Name || item?.name) ||
      text(item?.ProductionYear) ||
      item?.ImageTags?.Primary ||
      item?.PrimaryImageTag
    );
    if (!hasRenderableData) continue;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(item);
  }

  return out;
}

function minimizeCollectionPreviewItems(items = []) {
  return normalizeCollectionPreviewItems(items).map((item) => ({
    Id: item?.Id,
    Name: item?.Name,
    Type: item?.Type,
    Overview: item?.Overview,
    ProductionYear: item?.ProductionYear,
    CommunityRating: item?.CommunityRating,
    ImageTags: item?.ImageTags,
    PrimaryImageTag: item?.PrimaryImageTag,
    PrimaryImageAspectRatio: item?.PrimaryImageAspectRatio,
    UserData: item?.UserData,
    RunTimeTicks: item?.RunTimeTicks,
    CumulativeRunTimeTicks: item?.CumulativeRunTimeTicks,
    ChildCount: item?.ChildCount,
    SeriesId: item?.SeriesId,
    SeriesName: item?.SeriesName,
    SeasonId: item?.SeasonId,
    IndexNumber: item?.IndexNumber,
    ParentIndexNumber: item?.ParentIndexNumber,
    BackdropImageTags: item?.BackdropImageTags,
    ParentBackdropImageTags: item?.ParentBackdropImageTags,
    ParentBackdropItemId: item?.ParentBackdropItemId,
    SeriesBackdropImageTag: item?.SeriesBackdropImageTag,
    OfficialRating: item?.OfficialRating,
    Genres: item?.Genres,
  }));
}

async function getCachedCollectionPreview(itemId) {
  const row = await CollectionCacheDB.getBoxsetItems(itemId).catch(() => null);
  const items = normalizeCollectionPreviewItems(row?.items || []);
  return {
    items,
    total: items.length,
    hasCache: !!row,
    updatedAt: Number(row?.updatedAt || 0),
    stale: !row || isStale(row?.updatedAt, WATCHLIST_COLLECTION_CACHE_TTL_MS),
  };
}

function getContainerPreviewFields() {
  return [
    "Id","Name","Type","Overview","ProductionYear","CommunityRating",
    "ImageTags","PrimaryImageTag","PrimaryImageAspectRatio","UserData",
    "RunTimeTicks","CumulativeRunTimeTicks","ChildCount","SeriesId",
    "SeriesName","SeasonId","IndexNumber","ParentIndexNumber",
    "BackdropImageTags","ParentBackdropImageTags","ParentBackdropItemId",
    "SeriesBackdropImageTag","OfficialRating","Genres"
  ].join(",");
}

function compareText(left, right) {
  return text(left).localeCompare(text(right), cfg()?.dateLocale || "tr-TR", {
    numeric: true,
    sensitivity: "base"
  });
}

function compareMaybeNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  const hasA = Number.isFinite(a);
  const hasB = Number.isFinite(b);
  if (hasA && hasB) return a - b;
  if (hasA) return -1;
  if (hasB) return 1;
  return 0;
}

function sortContainerPreviewItems(items = [], mode = "") {
  const list = [...normalizeCollectionPreviewItems(items)];
  if (mode === "season") {
    return list.sort((left, right) => {
      const byIndex = compareMaybeNumber(left?.IndexNumber, right?.IndexNumber);
      return byIndex || compareText(left?.Name, right?.Name);
    });
  }

  if (mode === "episode") {
    return list.sort((left, right) => {
      const bySeason = compareMaybeNumber(left?.ParentIndexNumber, right?.ParentIndexNumber);
      if (bySeason) return bySeason;
      const byIndex = compareMaybeNumber(left?.IndexNumber, right?.IndexNumber);
      return byIndex || compareText(left?.Name, right?.Name);
    });
  }

  return list.sort((left, right) => {
    const byYear = compareMaybeNumber(left?.ProductionYear, right?.ProductionYear);
    return byYear || compareText(left?.Name, right?.Name);
  });
}

async function fetchContainerPreviewItems(containerItem, { signal } = {}) {
  const mode = getPreviewContainerMode(containerItem);
  const itemId = text(containerItem?.Id || containerItem?.itemId);
  const userId = getCurrentUserIdSafe();
  if (!userId || !itemId || !mode) return [];

  const includeItemTypes = mode === "collection"
    ? "Movie"
    : (mode === "season" ? "Season" : "Episode");
  const sortBy = mode === "collection"
    ? "ProductionYear,SortName"
    : (mode === "season" ? "IndexNumber,SortName" : "ParentIndexNumber,IndexNumber,SortName");
  const sortOrder = "Ascending";

  const out = [];
  const seen = new Set();
  let startIndex = 0;

  while (true) {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", itemId);
    qp.set("IncludeItemTypes", includeItemTypes);
    qp.set("Recursive", "false");
    qp.set("Fields", getContainerPreviewFields());
    qp.set("SortBy", sortBy);
    qp.set("SortOrder", sortOrder);
    qp.set("Limit", String(WATCHLIST_COLLECTION_PAGE_SIZE));
    qp.set("StartIndex", String(startIndex));

    const response = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const pageItems = Array.isArray(response?.Items) ? response.Items : [];

    for (const item of pageItems) {
      const id = text(item?.Id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }

    if (pageItems.length < WATCHLIST_COLLECTION_PAGE_SIZE) break;
    startIndex += WATCHLIST_COLLECTION_PAGE_SIZE;
  }

  return sortContainerPreviewItems(out, mode);
}

async function seedContainerPreviewPayload(itemId, existingPayload) {
  const payload = getPreviewPayload(existingPayload);
  if (!itemId || payload.collectionItemsLoaded) return payload;

  const cached = await getCachedCollectionPreview(itemId);
  if (!cached.hasCache) return payload;

  return createPreviewPayload({
    ...payload,
    collectionItems: cached.items,
    collectionItemsTotal: cached.total,
    collectionItemsLoaded: true,
    collectionItemsStale: cached.stale,
    collectionItemsUpdatedAt: cached.updatedAt,
    collectionItemsSource: "db",
  });
}

function isContainerPreviewView(view, previewData) {
  const payload = getPreviewPayload(previewData);
  return !!getPreviewContainerMode(payload.details || view?.item || {});
}

function getExpectedContainerPreviewTotal(view, previewData) {
  const payload = getPreviewPayload(previewData);
  const details = payload.details || {};
  const baseItem = view?.item || {};
  const mode = getPreviewContainerMode(details?.Id ? details : baseItem);
  if (mode === "collection") {
    return Math.max(
      Number(payload.collectionItemsTotal || 0),
      Number(details?.ChildCount || 0),
      Number(baseItem?.childCount || baseItem?.ChildCount || 0),
      normalizeCollectionPreviewItems(payload.collectionItems || []).length
    );
  }

  return Math.max(
    Number(payload.collectionItemsTotal || 0),
    normalizeCollectionPreviewItems(payload.collectionItems || []).length
  );
}

function isContainerPreviewIncomplete(view, previewData) {
  const payload = getPreviewPayload(previewData);
  if (!payload.collectionItemsLoaded) return false;
  const expectedTotal = getExpectedContainerPreviewTotal(view, previewData);
  const loadedCount = normalizeCollectionPreviewItems(payload.collectionItems || []).length;
  return expectedTotal > loadedCount;
}

function hasContainerPreviewItems(previewData) {
  return normalizeCollectionPreviewItems(getPreviewPayload(previewData).collectionItems || []).length > 0;
}

function shouldFetchContainerPreview(view, previewData) {
  const payload = getPreviewPayload(previewData);
  return isContainerPreviewView(view, previewData) && (
    !payload.collectionItemsLoaded ||
    payload.collectionItemsStale ||
    isContainerPreviewIncomplete(view, previewData) ||
    payload.collectionItemsSource !== "live" ||
    !payload.collectionItemsUpdatedAt ||
    isStale(payload.collectionItemsUpdatedAt, WATCHLIST_COLLECTION_REFRESH_MS)
  );
}

function formatCommunityRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? `★ ${rating.toFixed(1)}` : "";
}

function getCollectionYearRange(items = []) {
  const years = normalizeCollectionPreviewItems(items)
    .map((item) => Number(item?.ProductionYear || 0))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((left, right) => left - right);

  if (!years.length) return "";
  return years[0] === years[years.length - 1]
    ? String(years[0])
    : `${years[0]}-${years[years.length - 1]}`;
}

function getCollectionWatchedSummary(items = [], total = 0) {
  const count = normalizeCollectionPreviewItems(items).filter((item) => isMarkedPlayed(item)).length;
  if (!total) return "";
  return `${count}/${total}`;
}

function getCollectionWatchedCount(items = []) {
  return normalizeCollectionPreviewItems(items).filter((item) => isMarkedPlayed(item)).length;
}

function getCollectionAverageRating(items = []) {
  const ratings = normalizeCollectionPreviewItems(items)
    .map((item) => Number(item?.CommunityRating))
    .filter((rating) => Number.isFinite(rating) && rating > 0);

  if (!ratings.length) return "";
  const avg = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return `★ ${avg.toFixed(1)}`;
}

function getContainerPreviewSectionTitle(mode = "") {
  if (mode === "season") return L("watchlistPreviewSeasonSection", "Sezonlar");
  if (mode === "episode") return L("watchlistPreviewEpisodeSection", "Bölümler");
  return L("watchlistPreviewCollectionSection", "Koleksiyon Öğeleri");
}

function getContainerPreviewLoadingText(mode = "") {
  if (mode === "season") return L("watchlistPreviewSeasonLoading", "Sezonlar yükleniyor");
  if (mode === "episode") return L("watchlistPreviewEpisodeLoading", "Bölümler yükleniyor");
  return L("watchlistPreviewCollectionLoading", "Koleksiyon öğeleri yükleniyor");
}

function getContainerPreviewCountText(mode = "", count = 0) {
  if (!count) return "";
  if (mode === "season") return `${count} ${L("season", "Sezon")}`;
  if (mode === "episode") return `${count} ${L("episode", "Bölüm")}`;
  return `${count} ${L("watchlistPreviewCollectionItemSuffix", "öğe")}`;
}

function getContainerPreviewMoreText(hiddenCount = 0) {
  if (!hiddenCount) return "";
  return `+${hiddenCount} ${L("watchlistPreviewCollectionMore", "daha")}`;
}

function formatSeasonPreviewTitle(item) {
  const raw = text(item?.Name);
  const index = Number(item?.IndexNumber || 0);
  if (raw) return raw;
  if (index > 0) return `${L("season", "Sezon")} ${index}`;
  return L("season", "Sezon");
}

function formatEpisodePreviewTitle(item) {
  const seasonNumber = Number(item?.ParentIndexNumber || 0);
  const episodeNumber = Number(item?.IndexNumber || 0);
  const hasSeason = Number.isFinite(seasonNumber) && seasonNumber > 0;
  const hasEpisode = Number.isFinite(episodeNumber) && episodeNumber > 0;
  const prefix = hasSeason && hasEpisode
    ? `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`
    : (hasEpisode ? `E${String(episodeNumber).padStart(2, "0")}` : "");
  const raw = text(item?.Name, L("episode", "Bölüm"));
  return prefix ? `${prefix} • ${raw}` : raw;
}

function getContainerPreviewCardTitle(item, mode = "") {
  if (mode === "season") return formatSeasonPreviewTitle(item);
  if (mode === "episode") return formatEpisodePreviewTitle(item);
  return text(item?.Name, L("untitled", "İsimsiz"));
}

function getContainerPreviewCardMeta(item, mode = "") {
  const playedText = isMarkedPlayed(item) ? L("played", "İzlendi") : "";
  if (mode === "season") {
    const episodeCount = Number(item?.ChildCount || 0);
    return [
      episodeCount > 0 ? `${episodeCount} ${L("episode", "Bölüm")}` : "",
      playedText
    ].filter(Boolean).join(" • ");
  }

  if (mode === "episode") {
    return [
      formatRuntime(item?.RunTimeTicks),
      playedText
    ].filter(Boolean).join(" • ");
  }

  const year = text(item?.ProductionYear);
  const rating = formatCommunityRating(item?.CommunityRating);
  return [year, rating, playedText].filter(Boolean).join(" • ");
}

function getPreferredVisibleContainerItems(items = [], limit = WATCHLIST_COLLECTION_PREVIEW_LIMIT) {
  const normalized = normalizeCollectionPreviewItems(items);
  if (!normalized.length || limit <= 0) return [];
  if (normalized.length <= limit) return normalized.slice(0, limit);

  const unplayed = [];
  const played = [];

  for (const item of normalized) {
    if (isMarkedPlayed(item)) {
      played.push(item);
    } else {
      unplayed.push(item);
    }
  }

  return [...unplayed, ...played].slice(0, limit);
}

function renderPlayedOverlayMarkup() {
  return `
    <div class="monwuiwl-played-overlay" aria-hidden="true">
      <span class="monwuiwl-played-mark">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M9.2 16.6 4.8 12.2 3.4 13.6 9.2 19.4 20.6 8 19.2 6.6z"></path>
        </svg>
      </span>
      <span class="monwuiwl-played-text">${escapeHtml(L("played", "İzlendi"))}</span>
    </div>
  `;
}

function renderCollectionPreviewCards(items = [], { mode = "collection" } = {}) {
  const visible = getPreferredVisibleContainerItems(items, WATCHLIST_COLLECTION_PREVIEW_LIMIT);
  if (!visible.length) return "";

  return `
    <div class="monwuiwl-preview-collection-grid">
      ${visible.map((item) => {
        const title = getContainerPreviewCardTitle(item, mode);
        const posterUrl = buildPosterUrl(item, { width: 220, height: 330, quality: 88 });
        const meta = getContainerPreviewCardMeta(item, mode);
        const runtimeTicks = Number(item?.RunTimeTicks || item?.CumulativeRunTimeTicks || 0);
        const playbackTicks = Number(item?.UserData?.PlaybackPositionTicks || 0);
        const progressPercent = runtimeTicks > 0 && playbackTicks > 0
          ? Math.max(0, Math.min(100, Math.round((playbackTicks / runtimeTicks) * 100)))
          : 0;
        const fallback = mode === "season"
          ? L("season", "Sezon")
          : (mode === "episode" ? L("episode", "Bölüm") : text(item?.Type, title.slice(0, 2).toUpperCase() || L("content", "İçerik")));
        const isPlayed = isMarkedPlayed(item);
        const playLabel = getPlayActionLabel(item);

        return `
          <button
            type="button"
            class="monwuiwl-preview-collection-card ${isPlayed ? "is-played" : ""}"
            data-monwuiwl-preview-play="${escapeHtml(item?.Id)}"
            aria-label="${escapeHtml(`${playLabel}: ${title}`)}"
          >
            <div class="monwuiwl-preview-collection-poster">
              ${posterUrl
                ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">`
                : `<div class="monwuiwl-preview-collection-fallback">${escapeHtml(fallback)}</div>`}
              ${isPlayed ? renderPlayedOverlayMarkup() : ""}
            </div>
            <div class="monwuiwl-preview-collection-main">
              <div class="monwuiwl-preview-collection-title">${escapeHtml(title)}</div>
              ${meta ? `<div class="monwuiwl-preview-collection-meta">${escapeHtml(meta)}</div>` : ""}
              ${progressPercent > 0 ? `
                <div class="monwuiwl-preview-collection-progress">
                  <div class="monwuiwl-preview-collection-progress-bar" style="width:${progressPercent}%"></div>
                </div>
              ` : ""}
            </div>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderCollectionPreviewSection(items = [], total = 0, { loading = false, mode = "collection" } = {}) {
  const normalized = normalizeCollectionPreviewItems(items);
  const visible = getPreferredVisibleContainerItems(normalized, WATCHLIST_COLLECTION_PREVIEW_LIMIT);
  const itemCount = Math.max(Number(total || 0), normalized.length);
  const hiddenCount = Math.max(0, itemCount - visible.length);

  if (!visible.length && !loading) return "";

  const meta = [
    getContainerPreviewCountText(mode, itemCount),
    getContainerPreviewMoreText(hiddenCount),
  ].filter(Boolean).join(" • ");

  return `
    <section class="monwuiwl-preview-section">
      <div class="monwuiwl-preview-collection-head">
        <h4 class="monwuiwl-preview-section-title">${escapeHtml(getContainerPreviewSectionTitle(mode))}</h4>
        ${meta ? `<div class="monwuiwl-preview-collection-count">${escapeHtml(meta)}</div>` : ""}
      </div>
      ${renderCollectionPreviewCards(visible, { mode })}
      ${loading ? `<div class="monwuiwl-preview-collection-note">${escapeHtml(getContainerPreviewLoadingText(mode))}</div>` : ""}
    </section>
  `;
}

function getPeopleNames(item, type, limit = 8) {
  return uniqTextList(
    (Array.isArray(item?.People) ? item.People : [])
      .filter((person) => text(person?.Type).toLowerCase() === text(type).toLowerCase())
      .map((person) => person?.Name)
  ).slice(0, limit);
}

function getActorNames(item, limit = 8) {
  const roles = new Set(["actor", "gueststar", "voice"]);
  return uniqTextList(
    (Array.isArray(item?.People) ? item.People : [])
      .filter((person) => roles.has(text(person?.Type).toLowerCase()))
      .map((person) => person?.Name)
  ).slice(0, limit);
}

function getStudioNames(item, limit = 6) {
  return uniqTextList(
    (Array.isArray(item?.Studios) ? item.Studios : []).map((studio) => studio?.Name || studio)
  ).slice(0, limit);
}

function getStudioEntries(item, limit = 6) {
  const out = [];
  const seen = new Set();

  for (const studio of (Array.isArray(item?.Studios) ? item.Studios : [])) {
    const name = text(studio?.Name || studio);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      id: text(studio?.Id || studio?.StudioId || studio?.studioId)
    });

    if (out.length >= limit) break;
  }

  return out;
}

function getWatchlistTabViews(model, tabKey) {
  const currentTab = normalizeWatchlistTabKey(tabKey);
  return [
    ...(model?.[currentTab]?.own || []),
    ...(model?.[currentTab]?.shared || [])
  ];
}

function findViewByItemId(model, itemId, tabKey = "") {
  const id = text(itemId);
  if (!id) return null;

  const searchTabs = [];
  if (tabKey) searchTabs.push(normalizeWatchlistTabKey(tabKey));
  for (const tab of WATCHLIST_TABS) {
    if (!searchTabs.includes(tab.key)) searchTabs.push(tab.key);
  }

  for (const key of searchTabs) {
    const match = getWatchlistTabViews(model, key).find((view) => text(view?.itemId) === id);
    if (match) return match;
  }

  return null;
}

function getPreviewInfoLine(view) {
  if (view?.kind === "shared") {
    const by = text(view?.ownerUserName);
    const at = formatDate(view?.sharedAtUtc);
    return [by ? `${L("watchlistSharedBy", "Paylaşan")}: ${by}` : "", at].filter(Boolean).join(" • ");
  }

  const names = uniqTextList(
    (view?.outgoingShares || []).map((share) => share?.TargetUserName || share?.targetUserName)
  );
  if (!names.length) return "";
  return `${L("watchlistSharedWith", "Paylaşıldı")}: ${names.join(", ")}`;
}

function renderPreviewEmptyState() {
  return `
    <div class="monwuiwl-preview-empty">
      <div class="monwuiwl-preview-empty-copy">
        ${escapeHtml(L("watchlistEmptySection", "Burada henüz öğe yok."))}
      </div>
    </div>
  `;
}

function renderPreviewStats(stats = []) {
  if (!stats.length) return "";
  return `
    <div class="monwuiwl-preview-stats">
      ${stats.map((stat) => `
        <div class="monwuiwl-preview-stat">
          <div class="monwuiwl-preview-stat-label">${escapeHtml(stat.label)}</div>
          <div class="monwuiwl-preview-stat-value">${escapeHtml(stat.value)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPreviewFieldSection(title, fields = []) {
  const visible = fields.filter((field) => text(field?.value));
  if (!visible.length) return "";

  return `
    <section class="monwuiwl-preview-section">
      <h4 class="monwuiwl-preview-section-title">${escapeHtml(title)}</h4>
      <div class="monwuiwl-preview-field-list">
        ${visible.map((field) => `
          <div class="monwuiwl-preview-field">
            <div class="monwuiwl-preview-field-label">${escapeHtml(field.label)}</div>
            <div class="monwuiwl-preview-field-value">${escapeHtml(field.value)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderPreviewListSection(title, items = []) {
  const visible = items.filter(Boolean);
  if (!visible.length) return "";

  return `
    <section class="monwuiwl-preview-section">
      <h4 class="monwuiwl-preview-section-title">${escapeHtml(title)}</h4>
      <ul class="monwuiwl-preview-list">
        ${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderPreviewTagSection(title, items = []) {
  const visible = items.filter(Boolean);
  if (!visible.length) return "";

  return `
    <section class="monwuiwl-preview-section">
      <h4 class="monwuiwl-preview-section-title">${escapeHtml(title)}</h4>
      <div class="monwuiwl-preview-tags">
        ${visible.map((item) => `<span class="monwuiwl-preview-tag">${escapeHtml(item)}</span>`).join("")}
      </div>
    </section>
  `;
}

function renderPreviewStudioSection(title, studios = []) {
  const visible = (Array.isArray(studios) ? studios : []).filter((studio) => text(studio?.name));
  if (!visible.length) return "";

  const openTitle = L("watchlistPreviewStudioAdd", "Stüdyo koleksiyonuna ekle");

  return `
    <section class="monwuiwl-preview-section">
      <h4 class="monwuiwl-preview-section-title">${escapeHtml(title)}</h4>
      <div class="monwuiwl-preview-tags">
        ${visible.map((studio) => {
          const name = text(studio?.name);
          const studioId = text(studio?.id);

          if (!studioId) {
            return `<span class="monwuiwl-preview-tag">${escapeHtml(name)}</span>`;
          }

          return `
            <button
              type="button"
              class="monwuiwl-preview-tag monwuiwl-preview-tag-button"
              data-monwuiwl-studio-id="${escapeHtml(studioId)}"
              data-monwuiwl-studio-name="${escapeHtml(name)}"
              title="${escapeHtml(openTitle)}"
              aria-label="${escapeHtml(`${name} - ${openTitle}`)}"
            >${escapeHtml(name)}</button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function clearPreviewHoverTimer(root) {
  if (!root) return;
  clearTimeout(root.__previewHoverTimer);
  root.__previewHoverTimer = 0;
  root.__pendingPreviewItemId = "";
}

function renderPreviewPanel(view, details, { loading = false, collectionLoading = false } = {}) {
  if (!view) return renderPreviewEmptyState();

  const baseItem = view?.item || {};
  const previewPayload = getPreviewPayload(details);
  const item = previewPayload.details && typeof previewPayload.details === "object" ? previewPayload.details : {};
  const containerMode = getPreviewContainerMode(item?.Id ? item : baseItem);
  const hasContainerPreview = !!containerMode;
  const isCollection = containerMode === "collection";
  const collectionItems = normalizeCollectionPreviewItems(previewPayload.collectionItems || []);
  const collectionTotal = Math.max(
    Number(previewPayload.collectionItemsTotal || 0),
    collectionItems.length,
    isCollection ? Number(item?.ChildCount || baseItem.childCount || baseItem.ChildCount || 0) : 0
  );
  const containerCountText = hasContainerPreview ? getContainerPreviewCountText(containerMode, collectionTotal) : "";
  const collectionYears = isCollection ? getCollectionYearRange(collectionItems) : "";
  const collectionWatched = hasContainerPreview ? getCollectionWatchedSummary(collectionItems, collectionTotal) : "";
  const collectionRating = hasContainerPreview ? getCollectionAverageRating(collectionItems) : "";
  const posterUrl = buildPosterUrl(item, { width: 360, height: 540 }) || baseItem.posterUrl || "";
  const backdropUrl = buildBackdropUrl(item, { width: 1280, quality: 88 }) || baseItem.backdropUrl || "";
  const itemType = text(item?.Type || baseItem.itemType, L("content", "İçerik"));
  const title = text(item?.Name || baseItem.name, L("untitled", "İsimsiz"));
  const parentLine = text(item?.SeriesName || item?.Album || baseItem.parentName || baseItem.albumArtist);
  const subtitleLine = hasContainerPreview
    ? [
        parentLine,
        containerCountText,
        isCollection ? collectionYears : ""
      ].filter(Boolean).join(" • ")
    : parentLine;
  const infoLine = getPreviewInfoLine(view);
  const overview = text(
    item?.Overview || baseItem.overview,
    hasContainerPreview
      ? (
        isCollection
          ? L("watchlistPreviewCollectionOverview", "Bu koleksiyondaki başlıkları aşağıda görebilirsin.")
          : (containerMode === "season"
            ? L("watchlistPreviewSeriesOverview", "Bu dizinin sezonlarını aşağıda görebilirsin.")
            : L("watchlistPreviewSeasonOverview", "Bu sezonun bölümlerini aşağıda görebilirsin."))
      )
      : L("noDescription", "Açıklama yok.")
  );
  const runtimeTicks = Number(item?.RunTimeTicks || baseItem.runtimeTicks || 0);
  const playbackTicks = Number(item?.UserData?.PlaybackPositionTicks || 0);
  const runtime = formatRuntime(runtimeTicks);
  const remaining = playbackTicks > 0 && runtimeTicks > playbackTicks
    ? formatRuntime(runtimeTicks - playbackTicks)
    : "";
  const finishTime = formatFinishTime(runtimeTicks, playbackTicks);
  const communityRating = formatCommunityRating(item?.CommunityRating ?? baseItem.communityRating);
  const officialRating = text(item?.OfficialRating || baseItem.officialRating);
  const productionYear = text(item?.ProductionYear || baseItem.productionYear);
  const genres = uniqTextList(item?.Genres || baseItem.genres || []).slice(0, 6);
  const studioEntries = getStudioEntries(item);
  const studios = studioEntries.map((studio) => studio.name);
  const directors = isCollection ? [] : getPeopleNames(item, "Director", 4);
  const writers = isCollection ? [] : getPeopleNames(item, "Writer", 4);
  const actors = isCollection ? [] : getActorNames(item, 8);
  const artists = uniqTextList(item?.Artists || baseItem.artists || []).slice(0, 8);
  const albumArtist = text(item?.AlbumArtist || baseItem.albumArtist);
  const albumName = text(item?.Album);
  const videoStream = isCollection ? null : getPrimaryVideoStream(item);
  const videoQuality = getVideoQualityLabel(videoStream);
  const audioTracks = isCollection ? [] : getMediaStreamsByType(item, "Audio").map(formatAudioStream).filter(Boolean).slice(0, 4);
  const subtitleTracks = isCollection ? [] : getMediaStreamsByType(item, "Subtitle").map(formatSubtitleStream).filter(Boolean).slice(0, 4);
  const note = view?.kind === "shared" ? text(view?.note) : "";
  const progressPercent = runtimeTicks > 0 && playbackTicks > 0
    ? Math.max(0, Math.min(100, Math.round((playbackTicks / runtimeTicks) * 100)))
    : 0;

  const stats = isCollection
    ? [
        { label: L("watchlistPreviewCollectionCount", "Öğe"), value: collectionTotal ? `${collectionTotal} ${L("watchlistPreviewCollectionItemSuffix", "öğe")}` : "" },
        { label: L("watchlistPreviewCollectionYears", "Yıl Aralığı"), value: collectionYears },
        { label: L("watchlistPreviewCollectionWatched", "İzlendi"), value: collectionWatched },
        { label: L("watchlistPreviewCollectionRating", "Ortalama Puan"), value: collectionRating }
      ].filter((entry) => text(entry?.value))
    : [
        hasContainerPreview ? {
          label: containerMode === "season"
            ? L("watchlistPreviewSeasonCount", "Toplam Sezon")
            : L("watchlistPreviewEpisodeCount", "Toplam Bölüm"),
          value: containerCountText
        } : null,
        hasContainerPreview ? {
          label: L("watchlistPreviewCollectionWatched", "İzlendi"),
          value: collectionWatched
        } : null,
        { label: L("sure", "Süre"), value: runtime },
        { label: L("watchlistPreviewRemaining", "Kalan"), value: remaining },
        { label: L("watchlistPreviewFinishAt", "Bitiş"), value: finishTime },
        { label: L("watchlistPreviewVideoQuality", "Video"), value: videoQuality || text(item?.MediaType || baseItem.mediaType) },
        { label: L("yonetmen", "Yönetmen"), value: directors.join(", ") },
        { label: L("watchlistPreviewStudio", "Stüdyo"), value: studios.join(", ") || albumArtist || albumName }
      ].filter((entry) => text(entry?.value));

  const mediaFields = isCollection
    ? []
    : [
        { label: L("watchlistPreviewVideoTrack", "Video"), value: videoQuality },
        { label: L("watchlistPreviewAudioCount", "Ses"), value: audioTracks.length ? `${audioTracks.length} ${L("watchlistPreviewTrackSuffix", "parça")}` : "" },
        { label: L("watchlistPreviewSubtitleCount", "Altyazı"), value: subtitleTracks.length ? `${subtitleTracks.length} ${L("watchlistPreviewTrackSuffix", "parça")}` : "" }
      ];

  const creditFields = isCollection
    ? []
    : [
        { label: L("yonetmen", "Yönetmen"), value: directors.join(", ") },
        { label: L("watchlistPreviewWriter", "Yazar"), value: writers.join(", ") },
        { label: L("watchlistPreviewActors", "Oyuncular"), value: actors.join(", ") },
        { label: L("watchlistPreviewArtists", "Sanatçılar"), value: artists.join(", ") },
        { label: L("watchlistPreviewAlbum", "Albüm"), value: albumName },
        { label: L("watchlistPreviewAlbumArtist", "Albüm Sanatçısı"), value: albumArtist }
      ];

  const chips = isCollection
    ? [
        collectionTotal ? `${collectionTotal} ${L("watchlistPreviewCollectionItemSuffix", "öğe")}` : "",
        collectionYears,
        collectionRating,
        officialRating
      ].filter(Boolean).slice(0, 4)
    : [
        hasContainerPreview ? containerCountText : "",
        productionYear,
        hasContainerPreview ? collectionRating : "",
        communityRating,
        officialRating,
        videoQuality ? videoQuality.split(" • ").slice(0, 2).join(" • ") : ""
      ].filter(Boolean).slice(0, 4);

  return `
    <div class="monwuiwl-preview-shell">
      <div class="monwuiwl-preview-hero">
        ${backdropUrl ? `<img class="monwuiwl-preview-backdrop" src="${escapeHtml(backdropUrl)}" alt="" loading="eager" fetchpriority="high" decoding="async">` : ""}
        <div class="monwuiwl-preview-hero-inner">
          <div class="monwuiwl-preview-poster">
            ${posterUrl
              ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(title)}" loading="eager" fetchpriority="high" decoding="async">`
              : `<div class="monwuiwl-preview-poster-fallback">${escapeHtml(itemType)}</div>`}
          </div>
          <div class="monwuiwl-preview-head">
            <div class="monwuiwl-preview-kicker">${escapeHtml(itemType)}</div>
            <h3 class="monwuiwl-preview-title">${escapeHtml(title)}</h3>
            ${subtitleLine ? `<div class="monwuiwl-preview-subtitle">${escapeHtml(subtitleLine)}</div>` : ""}
            ${infoLine ? `<div class="monwuiwl-preview-subtitle">${escapeHtml(infoLine)}</div>` : ""}
            ${chips.length ? `<div class="monwuiwl-preview-chips">${chips.map((chip, index) => `<span class="monwuiwl-preview-chip ${index === 1 ? "accent" : ""}">${escapeHtml(chip)}</span>`).join("")}</div>` : ""}
            ${progressPercent > 0 ? `
              <div class="monwuiwl-preview-progress">
                <div class="monwuiwl-preview-progress-track">
                  <div class="monwuiwl-preview-progress-bar" style="width:${Math.max(0, Math.min(100, progressPercent))}%"></div>
                </div>
                <div class="monwuiwl-preview-progress-copy">
                  ${escapeHtml(`${progressPercent}% ${L("watchlistPreviewWatched", "izlendi")}${remaining ? ` • ${remaining} ${L("watchlistPreviewLeft", "kaldı")}` : ""}`)}
                </div>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
      <div class="monwuiwl-preview-body">
        ${loading ? `<div class="monwuiwl-preview-loading">${escapeHtml(L("watchlistPreviewLoading", "Detaylar yükleniyor"))}</div>` : ""}
        ${note ? `<p class="monwuiwl-preview-note"><strong>${escapeHtml(L("watchlistShareNote", "Not"))}:</strong> ${escapeHtml(note)}</p>` : ""}
        <p class="monwuiwl-preview-overview">${escapeHtml(overview)}</p>
        ${hasContainerPreview ? renderCollectionPreviewSection(collectionItems, collectionTotal, { loading: collectionLoading, mode: containerMode }) : ""}
        ${renderPreviewStats(stats)}
        ${renderPreviewFieldSection(L("watchlistPreviewMediaSection", "Medya Özeti"), mediaFields)}
        ${renderPreviewListSection(L("watchlistPreviewAudioTracks", "Ses Parçaları"), audioTracks)}
        ${renderPreviewListSection(L("watchlistPreviewSubtitleTracks", "Altyazılar"), subtitleTracks)}
        ${renderPreviewFieldSection(L("watchlistPreviewCredits", "Künye"), creditFields)}
        ${renderPreviewTagSection(L("genre", "Tür"), genres)}
        ${renderPreviewStudioSection(L("watchlistPreviewStudios", "Stüdyolar"), studioEntries)}
      </div>
    </div>
  `;
}

function getInitialPreviewItemId(root) {
  const state = root?.__state || {};
  const model = root?.__model || {};
  const currentTab = normalizeWatchlistTabKey(state?.activeTab);
  const tabViews = getWatchlistTabViews(model, currentTab);
  const preferredId = text(state?.previewItemId || state?.focusItemId);

  if (preferredId && tabViews.some((view) => text(view?.itemId) === preferredId)) {
    return preferredId;
  }

  return text(tabViews[0]?.itemId);
}

function setPreviewActiveCard(root, itemId) {
  root.querySelectorAll(".monwuiwl-item.is-preview-active").forEach((card) => {
    card.classList.remove("is-preview-active");
  });

  const id = text(itemId);
  if (!id) return;

  root.querySelector(`[data-monwuiwl-item="${escapeAttrSelector(id)}"]`)?.classList?.add("is-preview-active");
}

function samePreviewAssetUrl(a, b) {
  const left = text(a);
  const right = text(b);
  return !!left && left === right;
}

function applyPreviewPanelMarkup(panel, markup, { preserveMedia = false } = {}) {
  if (!panel) return;
  if (panel.__previewMarkup === markup) return;

  if (!preserveMedia) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  const currentShell = panel.querySelector(".monwuiwl-preview-shell");
  if (!currentShell) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const nextShell = template.content.querySelector(".monwuiwl-preview-shell");
  if (!nextShell) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  const currentBackdrop = currentShell.querySelector(".monwuiwl-preview-backdrop");
  const nextBackdrop = nextShell.querySelector(".monwuiwl-preview-backdrop");
  if (currentBackdrop && nextBackdrop && samePreviewAssetUrl(currentBackdrop.getAttribute("src"), nextBackdrop.getAttribute("src"))) {
    nextBackdrop.replaceWith(currentBackdrop);
  }

  const currentPoster = currentShell.querySelector(".monwuiwl-preview-poster img");
  const nextPoster = nextShell.querySelector(".monwuiwl-preview-poster img");
  if (currentPoster && nextPoster && samePreviewAssetUrl(currentPoster.getAttribute("src"), nextPoster.getAttribute("src"))) {
    currentPoster.alt = nextPoster.getAttribute("alt") || currentPoster.alt || "";
    nextPoster.replaceWith(currentPoster);
  }

  panel.replaceChildren(nextShell);
  panel.__previewMarkup = markup;
}

async function startWatchlistPlayback(triggerEl, itemId) {
  const id = text(itemId);
  if (!id) return false;

  try {
    if (triggerEl) triggerEl.disabled = true;
    try {
      const detailsModule = await import("./detailsModal.js");
      await detailsModule?.closeDetailsModal?.();
    } catch {}
    await closeWatchlistModal();
    const started = await playNow(id);
    if (!started) {
      if (getLastPlayNowBlockReason() === "parental-pin") {
        return false;
      }
      throw new Error(L("playStartFailed", "Oynatma başlatılamadı"));
    }
    return true;
  } catch (error) {
    window.showMessage?.(error?.message || L("playStartFailed", "Oynatma başlatılamadı"), "error");
    return false;
  } finally {
    if (triggerEl) triggerEl.disabled = false;
  }
}

function buildCollectionAutoRemoveTaskKey(view) {
  if (!view) return "";
  if (view.kind === "shared" && view.shareId) return `shared:${text(view.shareId)}`;
  return `own:${text(view.itemId)}`;
}

function getAutoRemoveTasksForView(view) {
  if (!view) return [];
  if (view.kind === "shared" && view.shareId) {
    return [{ kind: "shared", itemId: text(view.itemId), shareId: text(view.shareId) }];
  }
  if (view.itemId) {
    return [{ kind: "own", itemId: text(view.itemId) }];
  }
  return [];
}

async function autoRemoveContainerViewIfNeeded(root, view, previewData) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return false;
  if (!isContainerPreviewView(view, previewData)) return false;

  const payload = getPreviewPayload(previewData);
  const mode = getPreviewContainerMode(payload.details || view?.item || {});
  if (mode && mode !== "collection" && text(payload.collectionItemsSource) !== "live") return false;
  const total = getExpectedContainerPreviewTotal(view, payload);
  const items = normalizeCollectionPreviewItems(payload.collectionItems || []);
  if (!total || items.length < total) return false;

  const watchedCount = getCollectionWatchedCount(items);
  if (watchedCount < total) return false;

  const autoRemoveKey = buildCollectionAutoRemoveTaskKey(view);
  if (!autoRemoveKey || collectionAutoRemovePending.has(autoRemoveKey)) return false;

  const tasks = getAutoRemoveTasksForView(view);
  if (!tasks.length) return false;

  collectionAutoRemovePending.add(autoRemoveKey);
  try {
    await processAutoRemovalTasks(tasks);

    const currentPreviewItemId = text(root?.__state?.previewItemId);
    if (root?.isConnected && currentPreviewItemId === text(view?.itemId)) {
      root.__state = {
        ...(root.__state || {}),
        previewItemId: "",
        focusItemId: "",
      };
      await renderWatchlistModal(root, root.__state || {});
    }
    return true;
  } catch {
    return false;
  } finally {
    collectionAutoRemovePending.delete(autoRemoveKey);
  }
}

async function updatePreviewPanel(root, itemId) {
  const panel = root?.querySelector?.(".monwuiwl-preview");
  const currentTab = normalizeWatchlistTabKey(root?.__state?.activeTab);
  const view = findViewByItemId(root?.__model || {}, itemId, currentTab);
  const normalizedId = text(itemId);
  const previousPreviewItemId = text(root?.__state?.previewItemId);
  const switchedItem = previousPreviewItemId !== normalizedId;

  if (!panel || !view || !normalizedId) {
    if (panel) {
      panel.scrollTop = 0;
      applyPreviewPanelMarkup(panel, renderPreviewEmptyState());
    }
    if (root && text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
    setPreviewActiveCard(root, "");
    return;
  }

  root.__state = {
    ...(root.__state || {}),
    previewItemId: normalizedId
  };
  setPreviewActiveCard(root, normalizedId);

  if (switchedItem) {
    panel.scrollTop = 0;
  }
  let cached = watchlistPreviewCache.get(normalizedId) || null;
  if (isContainerPreviewView(view, cached)) {
    cached = await seedContainerPreviewPayload(normalizedId, cached);
    if (cached.collectionItemsLoaded || cached.collectionItems.length) {
      watchlistPreviewCache.set(normalizedId, cached);
    }
  }

  const needsDetails = !hasPreviewDetails(cached);
  const needsCollection = shouldFetchContainerPreview(view, cached);
  const hideIncompleteCollectionCache = isContainerPreviewIncomplete(view, cached);
  const renderPayload = hideIncompleteCollectionCache
    ? createPreviewPayload({
        ...getPreviewPayload(cached),
        collectionItems: [],
        collectionItemsLoaded: false,
      })
    : cached;
  const loadingMarkup = renderPreviewPanel(view, renderPayload, {
    loading: needsDetails,
    collectionLoading: needsCollection && !hasContainerPreviewItems(renderPayload)
  });
  applyPreviewPanelMarkup(panel, loadingMarkup, {
    preserveMedia: !switchedItem && !isContainerPreviewView(view, renderPayload)
  });

  if (!needsDetails && !needsCollection) {
    if (text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
    return;
  }

  const requestInFlightForSameItem =
    text(root.__previewLoadingItemId) === normalizedId &&
    !!root.__previewAbortController &&
    root.__previewAbortController.signal?.aborted !== true;
  if (requestInFlightForSameItem) return;

  try {
    root.__previewAbortController?.abort?.();
  } catch {}

  const controller = new AbortController();
  const requestId = Number(root.__previewRequestId || 0) + 1;
  root.__previewAbortController = controller;
  root.__previewRequestId = requestId;
  root.__previewLoadingItemId = normalizedId;

  const cachedPayload = getPreviewPayload(cached);
  const [details, collectionResult] = await Promise.all([
    needsDetails
      ? fetchItemDetailsFull(normalizedId, { signal: controller.signal }).catch(() => null)
      : Promise.resolve(cachedPayload.details),
    needsCollection
      ? (async () => {
          const liveItems = await fetchContainerPreviewItems(
            {
              Id: normalizedId,
              Type: text(cachedPayload.details?.Type || view?.item?.itemType),
            },
            { signal: controller.signal }
          ).catch(() => null);
          if (!Array.isArray(liveItems)) {
            const fallback = await getCachedCollectionPreview(normalizedId);
            return {
              items: fallback.items,
              total: fallback.total,
              loaded: true,
              stale: fallback.stale,
              updatedAt: fallback.updatedAt,
              source: fallback.hasCache ? "db" : "",
            };
          }

          const minimized = minimizeCollectionPreviewItems(liveItems);
          await CollectionCacheDB.setBoxsetItems(normalizedId, minimized).catch(() => {});

          const normalizedItems = normalizeCollectionPreviewItems(liveItems);
          return {
            items: normalizedItems,
            total: normalizedItems.length,
            loaded: true,
            stale: false,
            updatedAt: Date.now(),
            source: "live",
          };
        })()
      : Promise.resolve({
          items: cachedPayload.collectionItems,
          total: cachedPayload.collectionItemsTotal,
          loaded: cachedPayload.collectionItemsLoaded,
          stale: cachedPayload.collectionItemsStale,
          updatedAt: cachedPayload.collectionItemsUpdatedAt,
          source: cachedPayload.collectionItemsSource,
        })
  ]);
  if (controller.signal.aborted || root.__previewRequestId !== requestId) {
    if (root.__previewRequestId === requestId && text(root.__previewLoadingItemId) === normalizedId) {
      root.__previewLoadingItemId = "";
    }
    return;
  }

  const nextPayload = createPreviewPayload({
    ...cachedPayload,
    details: details?.Id ? details : cachedPayload.details,
    collectionItems: Array.isArray(collectionResult?.items) ? collectionResult.items : cachedPayload.collectionItems,
    collectionItemsTotal: Number(collectionResult?.total || cachedPayload.collectionItemsTotal || 0),
    collectionItemsLoaded: collectionResult?.loaded === true || cachedPayload.collectionItemsLoaded,
    collectionItemsStale: collectionResult?.stale === true,
    collectionItemsUpdatedAt: Number(collectionResult?.updatedAt || cachedPayload.collectionItemsUpdatedAt || 0),
    collectionItemsSource: text(collectionResult?.source || cachedPayload.collectionItemsSource),
  });

  if (nextPayload.details?.Id || nextPayload.collectionItemsLoaded || nextPayload.collectionItems.length) {
    watchlistPreviewCache.set(normalizedId, nextPayload);
  }

  const freshPanel = root?.querySelector?.(".monwuiwl-preview");
  const freshView = findViewByItemId(root?.__model || {}, normalizedId, normalizeWatchlistTabKey(root?.__state?.activeTab));
  if (!freshPanel || !freshView) return;

  if (switchedItem) {
    freshPanel.scrollTop = 0;
  }
  const loadedMarkup = renderPreviewPanel(freshView, nextPayload, {
    loading: !nextPayload.details?.Id,
    collectionLoading: false
  });
  applyPreviewPanelMarkup(freshPanel, loadedMarkup, {
    preserveMedia: !isContainerPreviewView(freshView, nextPayload)
  });
  if (text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
  await autoRemoveContainerViewIfNeeded(root, freshView, nextPayload).catch(() => false);
}

function queuePreviewPanelUpdate(root, itemId, { immediate = false } = {}) {
  if (!root) return;
  clearPreviewHoverTimer(root);

  const id = text(itemId);
  if (!id) {
    const panel = root.querySelector(".monwuiwl-preview");
    if (panel) panel.innerHTML = renderPreviewEmptyState();
    setPreviewActiveCard(root, "");
    return;
  }

  root.__pendingPreviewItemId = id;
  const currentPreviewItemId = text(root.__state?.previewItemId);
  const delay = immediate
    ? 0
    : (currentPreviewItemId && currentPreviewItemId !== id
      ? WATCHLIST_PREVIEW_SWITCH_DELAY_MS
      : WATCHLIST_PREVIEW_HOVER_DELAY_MS);

  const run = () => {
    if (text(root.__pendingPreviewItemId) !== id) return;
    root.__pendingPreviewItemId = "";
    updatePreviewPanel(root, id).catch(() => {});
  };

  if (delay <= 0) {
    run();
    return;
  }

  root.__previewHoverTimer = setTimeout(run, delay);
}

function mergeLiveItem(entry, live) {
  const base = entry && typeof entry === "object" ? entry : {};
  const item = live && typeof live === "object" ? live : {};
  const type = text(item?.Type || base?.ItemType);

  return {
    itemId: text(item?.Id || base?.ItemId),
    itemType: type,
    mediaType: text(item?.MediaType || base?.MediaType),
    name: text(item?.Name || base?.Name, L("untitled", "İsimsiz")),
    overview: text(item?.Overview || base?.Overview, L("noDescription", "Açıklama yok.")),
    productionYear: item?.ProductionYear ?? base?.ProductionYear ?? "",
    runtimeTicks: item?.RunTimeTicks ?? item?.CumulativeRunTimeTicks ?? base?.RunTimeTicks ?? base?.CumulativeRunTimeTicks ?? 0,
    communityRating: item?.CommunityRating ?? base?.CommunityRating ?? null,
    officialRating: text(item?.OfficialRating || base?.OfficialRating),
    genres: Array.isArray(item?.Genres) && item.Genres.length ? item.Genres : (Array.isArray(base?.Genres) ? base.Genres : []),
    albumArtist: text(item?.AlbumArtist || base?.AlbumArtist),
    artists: Array.isArray(item?.Artists) && item.Artists.length ? item.Artists : (Array.isArray(base?.Artists) ? base.Artists : []),
    parentName: text(item?.SeriesName || item?.Album || base?.ParentName),
    childCount: item?.ChildCount ?? base?.ChildCount ?? 0,
    ChildCount: item?.ChildCount ?? base?.ChildCount ?? 0,
    SeriesId: text(item?.SeriesId || base?.SeriesId),
    SeasonId: text(item?.SeasonId || base?.SeasonId),
    IndexNumber: item?.IndexNumber ?? base?.IndexNumber ?? null,
    ParentIndexNumber: item?.ParentIndexNumber ?? base?.ParentIndexNumber ?? null,
    UserData: (item?.UserData && typeof item.UserData === "object")
      ? item.UserData
      : ((base?.UserData && typeof base.UserData === "object") ? base.UserData : null),
    posterUrl: buildPosterUrl(item, { width: 360, height: 540, quality: 90 }),
    backdropUrl: buildBackdropUrl(item, { width: 1280, quality: 88 }),
    liveItem: item && item.Id ? item : null,
  };
}

async function buildViewModel(dashboard) {
  const uniqueIds = [
    ...(dashboard?.myItems || []).map((entry) => text(entry?.ItemId || entry?.itemId)),
    ...(dashboard?.sharedWithMe || []).map((entry) => text(entry?.ItemId || entry?.itemId || entry?.Entry?.ItemId || entry?.entry?.itemId))
  ].filter(Boolean);

  const { found } = await fetchItemsBulk(uniqueIds, [
    "Type","Name","SeriesId","SeriesName","Album","AlbumId","AlbumArtist","Artists","Overview","Genres","RunTimeTicks",
    "CumulativeRunTimeTicks",
    "OfficialRating","ProductionYear","CommunityRating","CriticRating","ImageTags","PrimaryImageTag",
    "AlbumPrimaryImageTag","BackdropImageTags","ParentBackdropImageTags","ParentBackdropItemId",
    "SeriesBackdropImageTag","SeasonId","Series","UserData","MediaType","ChildCount"
  ]).catch(() => ({ found: new Map() }));

  const outgoingByItemId = new Map();
  for (const share of dashboard?.outgoingShares || []) {
    const itemId = text(share?.ItemId || share?.itemId || share?.Entry?.ItemId || share?.entry?.itemId);
    if (!itemId) continue;
    if (!outgoingByItemId.has(itemId)) outgoingByItemId.set(itemId, []);
    outgoingByItemId.get(itemId).push(share);
  }

  const model = createEmptyWatchlistModel();
  const autoRemovalTasks = [];
  const completedSeriesSeasonIds = shouldAutoRemovePlayedFromWatchlist()
    ? await getCompletedSeriesSeasonWatchlistItemIds(dashboard, found).catch(() => new Set())
    : new Set();

  for (const entry of dashboard?.myItems || []) {
    const itemId = text(entry?.ItemId || entry?.itemId);
    if (!itemId) continue;
    const live = found?.get?.(itemId) || null;
    const merged = mergeLiveItem(entry, live);
    const addedAtUtc = Number(entry?.AddedAtUtc || entry?.addedAtUtc || 0);
    if (shouldAutoRemovePlayedFromWatchlist() && wasPlayedAfterWatchlistTimestamp(merged.liveItem || live, addedAtUtc)) {
      autoRemovalTasks.push({ kind: "own", itemId });
      continue;
    }
    if (completedSeriesSeasonIds.has(itemId)) {
      autoRemovalTasks.push({ kind: "own", itemId });
      continue;
    }
    const tab = getWatchlistTabKey({ Type: merged.itemType, MediaType: merged.mediaType });
    model[tab].own.push({
      kind: "own",
      key: `own:${itemId}`,
      itemId,
      entryId: text(entry?.Id || entry?.id),
      addedAtUtc,
      outgoingShares: outgoingByItemId.get(itemId) || [],
      item: merged
    });
  }

  for (const shared of dashboard?.sharedWithMe || []) {
    const shareId = text(shared?.Id || shared?.id);
    const entry = shared?.Entry || shared?.entry || {};
    const itemId = text(shared?.ItemId || shared?.itemId || entry?.ItemId || entry?.itemId);
    if (!itemId || !shareId) continue;
    const live = found?.get?.(itemId) || null;
    const merged = mergeLiveItem(entry, live);
    const sharedAtUtc = Number(shared?.SharedAtUtc || shared?.sharedAtUtc || 0);
    if (shouldAutoRemovePlayedFromWatchlist() && wasPlayedAfterWatchlistTimestamp(merged.liveItem || live, sharedAtUtc)) {
      autoRemovalTasks.push({ kind: "shared", itemId, shareId });
      continue;
    }
    if (completedSeriesSeasonIds.has(itemId)) {
      autoRemovalTasks.push({ kind: "shared", itemId, shareId });
      continue;
    }
    const tab = getWatchlistTabKey({ Type: merged.itemType, MediaType: merged.mediaType });
    model[tab].shared.push({
      kind: "shared",
      key: `shared:${shareId}`,
      shareId,
      itemId,
      ownerUserName: text(shared?.OwnerUserName || shared?.ownerUserName, L("unknownUser", "Bilinmeyen kullanıcı")),
      note: text(shared?.Note || shared?.note),
      sharedAtUtc,
      item: merged
    });
  }

  queueAutoRemoveWatchedEntries(autoRemovalTasks);
  return model;
}

function renderShareSummary(outgoingShares = []) {
  if (!Array.isArray(outgoingShares) || !outgoingShares.length) return "";
  const names = outgoingShares
    .map((share) => text(share?.TargetUserName || share?.targetUserName))
    .filter(Boolean);

  if (!names.length) return "";

  return `<div class="monwuiwl-item-sharemeta">${escapeHtml(L("watchlistSharedWith", "Paylaşıldı"))}: ${escapeHtml(names.join(", "))}</div>`;
}

function getShareOverlayTitle(view) {
  const itemName = text(view?.item?.name || view?.item?.parentName);
  if (!itemName) {
    return L("watchlistShareTitle", "İzleme listesi öğesini paylaş");
  }
  return `${L("watchlistShareAction", "Paylaş")}: ${itemName}`;
}

function renderItemCard(view) {
  const item = view?.item || {};
  const playableItem = item?.liveItem || item;
  const isPlayed = isMarkedPlayed(playableItem);
  const playActionLabel = getPlayActionLabel(playableItem);
  const year = item.productionYear ? String(item.productionYear) : "";
  const runtime = formatRuntime(item.runtimeTicks);
  const rating = Number.isFinite(Number(item.communityRating))
    ? `★ ${Number(item.communityRating).toFixed(1)}`
    : "";
  const official = text(item.officialRating);
  const typeLabel = item.itemType || L("content", "İçerik");
  const playedText = isPlayed ? L("played", "İzlendi") : "";
  const meta = [typeLabel, year, runtime, rating, official, playedText].filter(Boolean).join(" • ");
  const tags = (item.genres || []).slice(0, 3);
  const poster = item.posterUrl
    ? `<img src="${item.posterUrl}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">`
    : `<div class="monwuiwl-item-poster-fallback">${escapeHtml(typeLabel)}</div>`;

  const extraLine = item.albumArtist
    ? escapeHtml(item.albumArtist)
    : (Array.isArray(item.artists) && item.artists.length)
      ? escapeHtml(item.artists.join(", "))
      : (item.parentName ? escapeHtml(item.parentName) : "");

  const noteHtml = view.kind === "shared" && view.note
    ? `<div class="monwuiwl-item-sharemeta"><strong>${escapeHtml(L("watchlistShareNote", "Not"))}:</strong> ${escapeHtml(view.note)}</div>`
    : "";

  const shareMeta = view.kind === "shared"
    ? `<div class="monwuiwl-item-sharemeta">${escapeHtml(L("watchlistSharedBy", "Paylaşan"))}: ${escapeHtml(view.ownerUserName)}${view.sharedAtUtc ? ` • ${escapeHtml(formatDate(view.sharedAtUtc))}` : ""}</div>`
    : renderShareSummary(view.outgoingShares);

  const secondaryAction = view.kind === "own"
    ? `<button class="monwuiwl-btn" data-monwuiwl-share="${escapeHtml(view.itemId)}">${escapeHtml(L("watchlistShareAction", "Paylaş"))}</button>`
    : "";

  return `
    <article class="monwuiwl-item ${isPlayed ? "is-played" : ""}" tabindex="0" data-monwuiwl-item="${escapeHtml(view.itemId)}" data-monwuiwl-kind="${escapeHtml(view.kind)}">
      <div class="monwuiwl-item-poster">
        ${poster}
        ${isPlayed ? renderPlayedOverlayMarkup() : ""}
      </div>
      <div class="monwuiwl-item-main">
        <h3 class="monwuiwl-item-title">${escapeHtml(item.name)}</h3>
        ${meta ? `<div class="monwuiwl-item-meta">${escapeHtml(meta)}</div>` : ""}
        ${extraLine ? `<div class="monwuiwl-item-extra">${extraLine}</div>` : ""}
        <div class="monwuiwl-item-overview">${escapeHtml(item.overview)}</div>
        ${tags.length ? `<div class="monwuiwl-item-tags">${tags.map((tag) => `<span class="monwuiwl-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${shareMeta}
        ${noteHtml}
        <div class="monwuiwl-item-actions">
          <button class="monwuiwl-btn primary" data-monwuiwl-play-now="${escapeHtml(view.itemId)}">${escapeHtml(playActionLabel)}</button>
          ${secondaryAction}
          <button class="monwuiwl-btn danger" data-monwuiwl-remove="${escapeHtml(view.kind === "shared" ? view.shareId : view.itemId)}" data-monwuiwl-remove-kind="${escapeHtml(view.kind)}">${escapeHtml(L("watchlistRemoveAction", "Kaldır"))}</button>
        </div>
      </div>
    </article>
  `;
}

function renderSection(title, items) {
  const sectionTitle = items.length ? `${title} (${items.length})` : title;

  if (!items.length) {
    return `
      <section class="monwuiwl-section">
        <div class="monwuiwl-section-head">
          <h3 class="monwuiwl-section-title">${escapeHtml(sectionTitle)}</h3>
        </div>
        <div class="monwuiwl-empty">${escapeHtml(L("watchlistEmptySection", "Burada henüz öğe yok."))}</div>
      </section>
    `;
  }

  return `
    <section class="monwuiwl-section">
      <div class="monwuiwl-section-head">
        <h3 class="monwuiwl-section-title">${escapeHtml(sectionTitle)}</h3>
      </div>
      <div class="monwuiwl-grid">
        ${items.map(renderItemCard).join("")}
      </div>
    </section>
  `;
}

function renderModalShell(model, activeTab) {
  const currentTab = normalizeWatchlistTabKey(activeTab);
  const ownItems = model?.[currentTab]?.own || [];
  const sharedItems = model?.[currentTab]?.shared || [];
  const tabTitle = getWatchlistTabLabel(currentTab);
  const ownTitle = currentTab === "albums"
    ? L("watchlistOwnAlbums", "Albüm listen")
    : L("watchlistOwnItems", "Senin listen");
  const sharedTitle = currentTab === "albums"
    ? L("watchlistSharedAlbums", "Seninle paylaşılan albümler")
    : L("watchlistSharedItems", "Seninle paylaşılanlar");

  return `
    <div class="monwuiwl-backdrop">
      <div class="monwuiwl-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(tabTitle)}">
        <div class="monwuiwl-header">
          <div>
            <h2 class="monwuiwl-title">${escapeHtml(L("watchlistOpen", "İzleme Listesi"))}</h2>
            <p class="monwuiwl-subtitle">${escapeHtml(L("watchlistModalSubtitle", "Öğeler cihazdan bağımsız sunucu tarafında tutulur. İstersen diğer kullanıcılarla not ekleyerek paylaşabilirsin."))}</p>
          </div>
          <div class="monwuiwl-header-actions">
            <button class="monwuiwl-close" data-monwuiwl-close="1" aria-label="${escapeHtml(L("closeButton", "Kapat"))}">✕</button>
          </div>
        </div>

        <div class="monwuiwl-tabs">
          ${WATCHLIST_TABS.map((tab) => {
            const count = (model?.[tab.key]?.own || []).length + (model?.[tab.key]?.shared || []).length;
            return `<button class="monwuiwl-tab ${currentTab === tab.key ? "active" : ""}" data-monwuiwl-tab="${escapeHtml(tab.key)}">${escapeHtml(L(tab.labelKey, tab.fallback))} (${count})</button>`;
          }).join("")}
        </div>

        <div class="monwuiwl-body">
          <div class="monwuiwl-layout">
            <div class="monwuiwl-main">
              ${renderSection(ownTitle, ownItems)}
              ${renderSection(sharedTitle, sharedItems)}
            </div>
            <aside class="monwuiwl-preview" aria-live="polite">
              ${renderPreviewEmptyState()}
            </aside>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderWatchlistModal(root, state = {}) {
  const renderToken = Date.now();
  root.__renderToken = renderToken;
  clearPreviewHoverTimer(root);
  try {
    root.__previewAbortController?.abort?.();
  } catch {}
  root.__state = {
    activeTab: normalizeWatchlistTabKey(state?.activeTab),
    focusItemId: text(state?.focusItemId),
    previewItemId: text(state?.previewItemId)
  };

  root.innerHTML = `
    <div class="monwuiwl-backdrop">
      <div class="monwuiwl-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(L("watchlistOpen", "İzleme Listesi"))}">
        <div class="monwuiwl-header">
          <div>
            <h2 class="monwuiwl-title">${escapeHtml(L("watchlistOpen", "İzleme Listesi"))}</h2>
            <p class="monwuiwl-subtitle">${escapeHtml(L("loading", "Yükleniyor..."))}</p>
          </div>
          <div class="monwuiwl-header-actions">
            <button class="monwuiwl-close" data-monwuiwl-close="1" aria-label="${escapeHtml(L("closeButton", "Kapat"))}">✕</button>
          </div>
        </div>
        <div class="monwuiwl-body">
          <div class="monwuiwl-loading">${escapeHtml(L("loading", "Yükleniyor..."))}</div>
        </div>
      </div>
    </div>
  `;

  try {
    const dashboard = await ensureWatchlistLoaded();
    const model = await buildViewModel(dashboard);
    if (root.__renderToken !== renderToken) return;

    root.__model = model;
    root.innerHTML = renderModalShell(model, root.__state.activeTab);
    bindModalInteractions(root);
    const previewItemId = getInitialPreviewItemId(root);
    if (previewItemId) {
      queuePreviewPanelUpdate(root, previewItemId, { immediate: true });
    } else {
      root.__state = {
        ...(root.__state || {}),
        previewItemId: ""
      };
      setPreviewActiveCard(root, "");
      const panel = root.querySelector(".monwuiwl-preview");
      if (panel) panel.innerHTML = renderPreviewEmptyState();
    }

    const focusItemId = root.__state.focusItemId;
    if (focusItemId) {
      requestAnimationFrame(() => {
        root.querySelector(`[data-monwuiwl-item="${escapeAttrSelector(focusItemId)}"]`)?.scrollIntoView?.({
          behavior: "smooth",
          block: "nearest"
        });
      });
    }
  } catch (error) {
    if (root.__renderToken !== renderToken) return;
    root.innerHTML = `
      <div class="monwuiwl-backdrop">
        <div class="monwuiwl-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(L("watchlistOpen", "İzleme Listesi"))}">
          <div class="monwuiwl-header">
            <div>
              <h2 class="monwuiwl-title">${escapeHtml(L("watchlistOpen", "İzleme Listesi"))}</h2>
              <p class="monwuiwl-subtitle">${escapeHtml(L("watchlistLoadError", "İzleme listesi yüklenemedi."))}</p>
            </div>
            <div class="monwuiwl-header-actions">
              <button class="monwuiwl-close" data-monwuiwl-close="1" aria-label="${escapeHtml(L("closeButton", "Kapat"))}">✕</button>
            </div>
          </div>
          <div class="monwuiwl-body">
            <div class="monwuiwl-error">${escapeHtml(error?.message || L("watchlistLoadError", "İzleme listesi yüklenemedi."))}</div>
          </div>
        </div>
      </div>
    `;
  }
}

function bindModalInteractions(root) {
  root.querySelectorAll("[data-monwuiwl-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      root.__state = {
        ...(root.__state || {}),
        activeTab: normalizeWatchlistTabKey(button.getAttribute("data-monwuiwl-tab"))
      };
      renderWatchlistModal(root, root.__state).catch(() => {});
    });
  });

  root.querySelectorAll(".monwuiwl-item").forEach((card) => {
    const itemId = text(card.getAttribute("data-monwuiwl-item"));
    if (!itemId) return;

    card.addEventListener("mouseenter", () => {
      queuePreviewPanelUpdate(root, itemId);
    });
    card.addEventListener("mouseleave", () => {
      if (text(root.__pendingPreviewItemId) === itemId) {
        clearPreviewHoverTimer(root);
      }
    });
    card.addEventListener("focusin", () => {
      queuePreviewPanelUpdate(root, itemId, { immediate: true });
    });
    card.addEventListener("click", (event) => {
      if (event.target?.closest?.(".monwuiwl-btn")) return;
      queuePreviewPanelUpdate(root, itemId, { immediate: true });
    });
  });

  root.querySelector(".monwuiwl-preview")?.addEventListener("mouseenter", () => {
    clearPreviewHoverTimer(root);
  });

  root.querySelector(".monwuiwl-preview")?.addEventListener("click", async (event) => {
    const studioButton = event.target?.closest?.("[data-monwuiwl-studio-id]");
    if (studioButton) {
      event.preventDefault();
      event.stopPropagation();

      if (!setStudioHubLoadingState(studioButton, true)) return;

      const studioId = text(studioButton.getAttribute("data-monwuiwl-studio-id"));
      const studioName = text(studioButton.getAttribute("data-monwuiwl-studio-name"));
      if (!studioId) {
        setStudioHubLoadingState(studioButton, false);
        return;
      }

      const copied = await copyTextToClipboard(studioId);
      if (copied) {
        studioButton.classList.add("is-copied");
        clearTimeout(studioButton.__copiedTimer);
        studioButton.__copiedTimer = setTimeout(() => {
          studioButton.classList.remove("is-copied");
          studioButton.__copiedTimer = 0;
        }, 1400);
      } else {
        const message = studioName
          ? `${studioName}: ${L("watchlistPreviewStudioCopyFailed", "Studio ID kopyalanamadı.")}`
          : L("watchlistPreviewStudioCopyFailed", "Studio ID kopyalanamadı.");
        notifyStudioHubResult(message, "error", "clipboard", 2400);
      }

      void (async () => {
        try {
          const autoAddResult = await maybeAutoEnsureStudioHub(studioId, studioName);
          if (autoAddResult?.pending) return;

          if (autoAddResult?.attempted && autoAddResult?.added === false && autoAddResult?.existing !== true) {
            const message = studioName
              ? `${studioName}: ${text(autoAddResult?.error?.message, L("watchlistPreviewStudioAutoAddFailed", "Koleksiyon otomatik eklenemedi."))}`
              : text(autoAddResult?.error?.message, L("watchlistPreviewStudioAutoAddFailed", "Koleksiyon otomatik eklenemedi."));
            notifyStudioHubResult(message, "error", "triangle-exclamation", 3200);
            return;
          }

          const logoResult = await maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, {
            entries: autoAddResult?.entries
          });

          if (autoAddResult?.added && logoResult?.uploaded) {
            const message = studioName
              ? `${studioName}: ${L("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")} ${L("watchlistPreviewStudioTmdbLogoSaved", "TMDb logosu da otomatik kaydedildi.")}`
              : `${L("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")} ${L("watchlistPreviewStudioTmdbLogoSaved", "TMDb logosu da otomatik kaydedildi.")}`;
            notifyStudioHubResult(message, "success", "building", 3000);
            return;
          }

          if (autoAddResult?.existing && logoResult?.uploaded) {
            const message = studioName
              ? `${studioName}: ${L("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")} ${L("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`
              : `${L("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")} ${L("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`;
            notifyStudioHubResult(message, "success", "building", 3000);
            return;
          }

          if (autoAddResult?.added) {
            const message = studioName
              ? `${studioName}: ${L("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")}`
              : L("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.");
            notifyStudioHubResult(message, "success", "building", 2600);
            return;
          }

          if (autoAddResult?.existing) {
            const message = studioName
              ? `${studioName}: ${L("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")}`
              : L("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.");
            notifyStudioHubResult(message, "success", "building", 2600);
            return;
          }

          if (logoResult?.uploaded) {
            const message = studioName
              ? `${studioName}: ${L("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`
              : L("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.");
            notifyStudioHubResult(message, "success", "image", 2600);
          }
        } finally {
          setStudioHubLoadingState(studioButton, false);
        }
      })();

      return;
    }

    const button = event.target?.closest?.("[data-monwuiwl-preview-play]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const itemId = text(button.getAttribute("data-monwuiwl-preview-play"));
    if (!itemId) return;
    await startWatchlistPlayback(button, itemId);
  });

  root.querySelectorAll("[data-monwuiwl-play-now]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = text(button.getAttribute("data-monwuiwl-play-now"));
      if (!itemId) return;

      await startWatchlistPlayback(button, itemId);
    });
  });

  root.querySelectorAll("[data-monwuiwl-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const removeKind = text(button.getAttribute("data-monwuiwl-remove-kind"));
      const targetId = text(button.getAttribute("data-monwuiwl-remove"));
      if (!targetId) return;

      try {
        button.disabled = true;
        if (removeKind === "shared") {
          await removeWatchlistShare(targetId);
        } else {
          await updateFavoriteStatus(targetId, false);
        }
        window.showMessage?.(L("watchlistRemoved", "Öğe listeden çıkarıldı"), "success");
        await renderWatchlistModal(root, root.__state || {});
      } catch (error) {
        window.showMessage?.(error?.message || L("watchlistActionError", "İşlem başarısız"), "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-monwuiwl-share]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = text(button.getAttribute("data-monwuiwl-share"));
      if (!itemId) return;
      await openShareOverlay(root, itemId);
    });
  });
}

async function openShareOverlay(root, itemId) {
  const users = await fetchShareableUsers();
  const model = root.__model || {};
  const activeTab = normalizeWatchlistTabKey(root.__state?.activeTab);
  const allItems = [
    ...(model?.[activeTab]?.own || []),
    ...(model?.[activeTab]?.shared || [])
  ];
  const allOwnItems = WATCHLIST_TABS.flatMap((tab) => model?.[tab.key]?.own || []);
  const view = allItems.find((item) => text(item?.itemId) === itemId) ||
    allOwnItems.find((item) => text(item?.itemId) === itemId);

  if (!view) {
    window.showMessage?.(L("watchlistItemMissing", "Paylaşılacak öğe bulunamadı"), "error");
    return;
  }

  const shareTitle = getShareOverlayTitle(view);

  const overlay = document.createElement("div");
  overlay.className = "monwuiwl-share-overlay";
  overlay.innerHTML = `
    <div class="monwuiwl-share-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(shareTitle)}">
      <h3 class="monwuiwl-share-title">${escapeHtml(shareTitle)}</h3>
      <p class="monwuiwl-share-help">${escapeHtml(L("watchlistShareSubtitle", "Birden fazla kullanıcı seçebilir ve paylaşım sırasında kısa bir not ekleyebilirsin."))}</p>
      <div class="monwuiwl-share-list">
        ${users.length
          ? users.map((user) => `
            <label class="monwuiwl-share-user">
              <input type="checkbox" value="${escapeHtml(user.id)}">
              <span>${escapeHtml(user.name)}</span>
            </label>
          `).join("")
          : `<div class="monwuiwl-empty">${escapeHtml(L("watchlistNoUsers", "Paylaşılacak kullanıcı bulunamadı."))}</div>`
        }
      </div>
      <label class="monwuiwl-share-note-label" for="monwuiwl-share-note">${escapeHtml(L("watchlistShareNoteLabel", "Paylaşım notu"))}</label>
      <textarea id="monwuiwl-share-note" class="monwuiwl-share-note" placeholder="${escapeHtml(L("watchlistShareNotePlaceholder", "İstersen kısa bir not bırakabilirsin."))}"></textarea>
      <div class="monwuiwl-share-footer">
        <button class="monwuiwl-share-cancel" type="button">${escapeHtml(L("cancel", "İptal"))}</button>
        <button class="monwuiwl-share-submit" type="button">${escapeHtml(L("watchlistShareAction", "Paylaş"))}</button>
      </div>
    </div>
  `;

  const closeOverlay = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOverlay();
  });

  overlay.querySelector(".monwuiwl-share-cancel")?.addEventListener("click", closeOverlay);

  overlay.querySelector(".monwuiwl-share-submit")?.addEventListener("click", async (event) => {
    const submitButton = event.currentTarget;
    const selectedIds = [...overlay.querySelectorAll(".monwuiwl-share-user input:checked")]
      .map((input) => text(input.value))
      .filter(Boolean);
    const note = text(overlay.querySelector(".monwuiwl-share-note")?.value);

    if (!selectedIds.length) {
      window.showMessage?.(L("watchlistSelectUsers", "En az bir kullanıcı seç"), "error");
      return;
    }

    try {
      submitButton.disabled = true;
      const selectedUsers = users.filter((user) => selectedIds.includes(user.id));
      await shareWatchlistItem(itemId, selectedUsers, note);
      window.showMessage?.(L("watchlistSharedSuccess", "Öğe kullanıcılarla paylaşıldı"), "success");
      closeOverlay();
      await renderWatchlistModal(root, root.__state || {});
    } catch (error) {
      window.showMessage?.(error?.message || L("watchlistShareError", "Paylaşım başarısız"), "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  root.appendChild(overlay);
}

export async function openWatchlistModal(options = {}) {
  ensureStyles();
  const root = ensureModalRoot();
  try {
    if (document.body && root.parentElement === document.body) {
      document.body.appendChild(root);
    }
  } catch {}
  setVisible(root, true);

  const initialTab = options?.initialTab
    ? normalizeWatchlistTabKey(options.initialTab)
    : getWatchlistTabKey(options?.item || options);
  const state = {
    activeTab: initialTab,
    focusItemId: text(options?.focusItemId || options?.itemId || options?.item?.Id)
  };

  root.__state = state;
  await renderWatchlistModal(root, state);
  return root;
}

export async function closeWatchlistModal() {
  const root = document.getElementById(WATCHLIST_MODAL_ID);
  if (!root) return;
  clearPreviewHoverTimer(root);
  try {
    root.__previewAbortController?.abort?.();
  } catch {}
  setVisible(root, false);
  root.innerHTML = "";
}

try {
  window.__monwuiOpenWatchlistModal = openWatchlistModal;
} catch {}

export function refreshWatchlistUi() {
  scheduleTabsSliderRefreshSequence();

  const root = document.getElementById(WATCHLIST_MODAL_ID);
  if (root?.classList.contains("visible")) {
    renderWatchlistModal(root, root.__state || {}).catch(() => {});
  }
}

function createTabsSliderButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `emby-tab-button ${WATCHLIST_NAV_BUTTON_CLASS}`;
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try { button.blur(); } catch {}
    await openWatchlistModal({ initialTab: DEFAULT_WATCHLIST_TAB });
  });
  return button;
}

function refreshTabsSliderButton() {
  tabsSliderRefreshQueued = false;
  ensureStyles();
  const sliders = document.querySelectorAll(".emby-tabs-slider");
  if (!sliders.length) return false;

  if (!shouldShowWatchlistTabsSliderButton()) {
    sliders.forEach((slider) => {
      if (!(slider instanceof HTMLElement)) return;
      slider.querySelector(`.${WATCHLIST_NAV_BUTTON_CLASS}`)?.remove();
    });
    return true;
  }

  sliders.forEach((slider) => {
    if (!(slider instanceof HTMLElement)) return;

    let button = slider.querySelector(`.${WATCHLIST_NAV_BUTTON_CLASS}`);
    if (!button) {
      button = createTabsSliderButton();
      slider.appendChild(button);
    }

    const label = L("watchlistOpen", "İzleme Listesi");
    const nextMarkup = getWatchlistTabsButtonMarkup(label);
    if (button.innerHTML !== nextMarkup) {
      button.innerHTML = nextMarkup;
    }
    if (button.getAttribute("title") !== label) {
      button.setAttribute("title", label);
    }
    if (button.getAttribute("aria-label") !== label) {
      button.setAttribute("aria-label", label);
    }
  });

  return true;
}

function queueTabsSliderRefresh() {
  if (tabsSliderRefreshQueued) return;
  tabsSliderRefreshQueued = true;
  const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
  raf(() => {
    const hasTabsSlider = refreshTabsSliderButton();
    if (hasTabsSlider || !shouldShowWatchlistTabsSliderButton()) {
      stopTabsSliderObserver();
    }
  });
}

function clearTabsSliderRefreshTimers() {
  tabsSliderRefreshTimers.forEach((timerId) => {
    clearTimeout(timerId);
  });
  tabsSliderRefreshTimers.clear();
}

function stopTabsSliderObserver() {
  if (tabsSliderObserverStopTimer) {
    clearTimeout(tabsSliderObserverStopTimer);
    tabsSliderObserverStopTimer = 0;
  }
  if (!tabsSliderObserver) return;
  try {
    tabsSliderObserver.disconnect();
  } catch {}
  tabsSliderObserver = null;
}

function isTabsSliderMutationRelevant(mutations) {
  for (const mutation of mutations) {
    if (mutation.type !== "childList") continue;

    const target = mutation.target;
    if (target instanceof Element) {
      if (target.closest?.(`.${WATCHLIST_NAV_BUTTON_CLASS}`)) {
        continue;
      }
      if (target.matches?.(".emby-tabs-slider") || target.closest?.(".emby-tabs-slider")) {
        return true;
      }
    }

    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (
        node.matches?.(".emby-tabs-slider") ||
        node.querySelector?.(".emby-tabs-slider")
      ) {
        return true;
      }
    }
  }
  return false;
}

function startTabsSliderObserver() {
  if (tabsSliderObserver || !shouldShowWatchlistTabsSliderButton()) return;
  if (document.hidden) return;

  const root = document.body || document.documentElement;
  if (!root) return;

  tabsSliderObserver = new MutationObserver((mutations) => {
    if (!isTabsSliderMutationRelevant(mutations)) return;
    queueTabsSliderRefresh();
  });

  try {
    tabsSliderObserver.observe(root, {
      childList: true,
      subtree: true
    });
  } catch {
    stopTabsSliderObserver();
    return;
  }

  tabsSliderObserverStopTimer = setTimeout(() => {
    stopTabsSliderObserver();
  }, TABS_SLIDER_OBSERVER_WINDOW_MS);
}

function scheduleTabsSliderRefreshSequence() {
  clearTabsSliderRefreshTimers();

  TABS_SLIDER_ROUTE_REFRESH_DELAYS_MS.forEach((delay) => {
    if (delay === 0) {
      queueTabsSliderRefresh();
      return;
    }
    const timerId = setTimeout(() => {
      tabsSliderRefreshTimers.delete(timerId);
      queueTabsSliderRefresh();
    }, delay);
    tabsSliderRefreshTimers.add(timerId);
  });

  startTabsSliderObserver();
}

export function installWatchlistTabsButton() {
  if (tabsSliderBindingsInstalled) {
    scheduleTabsSliderRefreshSequence();
    return;
  }
  tabsSliderBindingsInstalled = true;

  const refresh = () => scheduleTabsSliderRefreshSequence();
  refresh();

  window.addEventListener("pageshow", refresh, { passive: true });
  window.addEventListener("popstate", refresh, { passive: true });
  window.addEventListener("hashchange", refresh, { passive: true });
  window.addEventListener("focus", refresh, { passive: true });
  document.addEventListener("viewshow", refresh, { passive: true });
  document.addEventListener("viewshown", refresh, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTabsSliderRefreshTimers();
      stopTabsSliderObserver();
      return;
    }
    refresh();
  }, { passive: true });
}

function bootstrapWatchlistUi() {
  try {
    installJellyfinFavoriteMirror();
  } catch {}
  try {
    installWatchlistTabsButton();
  } catch {}
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapWatchlistUi, { once: true });
  } else {
    bootstrapWatchlistUi();
  }
}
