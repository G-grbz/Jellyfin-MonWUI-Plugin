import { musicPlayerState } from "../core/state.js";
import { getAuthToken } from "../core/auth.js";
import { playTrack } from "../player/playback.js";
import { showNotification } from "../ui/notification.js";
import { saveCurrentPlaylistToJellyfin } from "../core/playlist.js";
import { fetchJellyfinPlaylists } from "../core/jellyfinPlaylists.js";
import { getConfig } from "../../config.js";
import { musicDB } from "../utils/db.js";
import { updateNextTracks } from "./playerUI.js";
import { shuffleArray } from "../utils/domUtils.js";
import { showStatsModal } from "./statsModal.js";
import { updatePlaylistModal } from "./playlistModal.js";
import { withServer, withParams, getServerBaseCached } from "../../jfUrl.js";

console.log("[artistModal] loaded", { hasMusicDB: !!musicDB, hasAddOrUpdate: !!musicDB?.addOrUpdateTracks });
window.__musicDB = musicDB;
let __artistModalClickLoggerAdded = false;

const config = getConfig();

let __syncPromise = null;
const LAST_SYNC_MS_KEY = "gmmp_last_sync_ms";
const LAST_FULLSCAN_MS_KEY = "gmmp_last_fullscan_ms";
const FULLSCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let __fullscanSchedulerId = null;
let __schedulerBooted = false;
let __syncAbortCtrl = null;
let __dbReadyOnce = null;

async function ensureMusicDbReady() {
  if (__dbReadyOnce) return __dbReadyOnce;

  __dbReadyOnce = (async () => {
    if (!musicDB) throw new Error("musicDB missing");
    if (typeof musicDB.init === "function") await musicDB.init();
    if (typeof musicDB.open === "function") await musicDB.open();
    if (typeof musicDB.ready === "function") await musicDB.ready();
    if (musicDB.dbPromise && typeof musicDB.dbPromise.then === "function") {
      await musicDB.dbPromise;
    }
    return true;
  })();

  return __dbReadyOnce;
}

async function getValidJfCredsWithRetry({ tries = 8, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    const creds = getJellyfinCredentials();
    if (creds?.isValid) return creds;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return getJellyfinCredentials();
}

export function isDbSyncInProgress() {
  return !!__syncPromise;
}

function getLastSyncMs() {
  return Number(localStorage.getItem(LAST_SYNC_MS_KEY) || "0");
}
function setLastSyncMs(ms) {
  localStorage.setItem(LAST_SYNC_MS_KEY, String(ms || Date.now()));
}
function getLastFullscanMs() {
  return Number(localStorage.getItem(LAST_FULLSCAN_MS_KEY) || "0");
}
function setLastFullscanMs(ms) {
  localStorage.setItem(LAST_FULLSCAN_MS_KEY, String(ms || Date.now()));
}

const DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";
const SEARCH_DEBOUNCE_TIME = 300;
const TRACKS_PER_PAGE = config.sarkilimit;
const ALBUMS_PER_PAGE = config.albumlimit;

const SORT_OPTIONS = {
  ALPHABETICAL: "alphabetical",
  REVERSE_ALPHABETICAL: "reverse-alphabetical",
  DATE_ADDED: "date-added",
  ARTIST: "artist",
  ALBUM: "album",
  DURATION: "duration",
  YEAR: "year",
};

const sortStates = {
  [SORT_OPTIONS.ALPHABETICAL]: { asc: true },
  [SORT_OPTIONS.ARTIST]: { asc: true },
  [SORT_OPTIONS.ALBUM]: { asc: true },
  [SORT_OPTIONS.DATE_ADDED]: { asc: true },
  [SORT_OPTIONS.DURATION]: { asc: true },
  [SORT_OPTIONS.YEAR]: { asc: true },
};

let artistModal = null;
let searchDebounceTimer = null;
let allTracks = [];
let selectedTrackIds = new Set();
let currentPage = 1;
let totalPages = 1;
let totalTracks = 0;
let totalArtists = 0;
let totalAlbums = 0;
let currentPaginationMode = "tracks";
let currentSortOption = SORT_OPTIONS.ALPHABETICAL;
let currentModalArtist = { name: "", id: null };
let swMessageHandler = null;
let modalChangeDelegation = null;
let activeFetchControllers = new Set();

function abortAllFetches() {
  for (const c of activeFetchControllers) {
    try { c.abort(); } catch {}
  }
  activeFetchControllers.clear();
}

function abortSyncFetch() {
  try { __syncAbortCtrl?.abort?.(); } catch {}
  __syncAbortCtrl = null;
}

function addFetchController(ctrl) { activeFetchControllers.add(ctrl); }

function settleFetchController(ctrl) { activeFetchControllers.delete(ctrl); }

function clearSearchTimer() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

function openJfDetails(artistId) {
  if (!artistId) return;
  const qs = new URLSearchParams({ id: artistId }).toString();
  const url = withServer(`/web/#/details?${qs}`);
  window.open(url, "_blank");
}

function groupTracksByAlbum(tracks) {
  const albums = {};
  tracks.forEach((track) => {
    const albumArtist = track.AlbumArtist || track.Artists?.[0] || config.languageLabels.artistUnknown;
    const albumName = track.Album || config.languageLabels.unknownTrack;
    const albumKey = `${albumArtist} - ${albumName}`;
    if (!albums[albumKey]) albums[albumKey] = [];
    albums[albumKey].push(track);
  });
  return albums;
}

function sortTracks(tracks, sortOption) {
  const sorted = [...tracks];
  const asc = sortStates[sortOption].asc;

  switch (sortOption) {
    case SORT_OPTIONS.ALPHABETICAL:
      return sorted.sort((a, b) => {
        const cmp = (a.Name || "").localeCompare(b.Name || "", "tr", { sensitivity: "base" });
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.ARTIST:
      return sorted.sort((a, b) => {
        const aA = (a.Artists?.[0] || a.AlbumArtist || "").toLowerCase();
        const bA = (b.Artists?.[0] || b.AlbumArtist || "").toLowerCase();
        let cmp = aA.localeCompare(bA, "tr") ||
          (a.Album || "").localeCompare(b.Album || "", "tr") ||
          (a.IndexNumber || 0) - (b.IndexNumber || 0);
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.ALBUM:
      return sorted.sort((a, b) => {
        const yA = parseInt(a.ProductionYear || "0");
        const yB = parseInt(b.ProductionYear || "0");
        let cmp = yB - yA;
        if (cmp === 0) {
          cmp = (a.Album || "").localeCompare(b.Album || "", "tr") ||
            (a.IndexNumber || 0) - (b.IndexNumber || 0);
        }
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.DATE_ADDED:
      return sorted.sort((a, b) => {
        const dA = new Date(a.DateCreated || a.PremiereDate || "2000-01-01");
        const dB = new Date(b.DateCreated || b.PremiereDate || "2000-01-01");
        const cmp = dB - dA;
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.DURATION:
      return sorted.sort((a, b) => {
        const cmp = (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0);
        return asc ? cmp : -cmp;
      });
    default:
      return sorted;
  }
}

export function getJellyfinCredentials() {
  try {
    const raw =
      sessionStorage.getItem("json-credentials") ||
      localStorage.getItem("json-credentials");
    const credentials = raw ? JSON.parse(raw) : null;
    let serverUrl = (
      credentials?.Servers?.[0]?.RemoteAddress ||
      credentials?.Servers?.[0]?.LocalAddress ||
      credentials?.Servers?.[0]?.Url ||
      window.location.origin
    );

    if (serverUrl) {
      serverUrl = serverUrl.replace(/\/$/, "");
      if (!serverUrl.startsWith("http")) {
        serverUrl = window.location.protocol + "//" + serverUrl;
      }
    }

    const api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;

    const userId =
      credentials?.Servers?.[0]?.UserId ||
      (typeof api?.getCurrentUserId === "function" ? api.getCurrentUserId() : null) ||
      localStorage.getItem("userId") ||
      sessionStorage.getItem("userId") ||
      localStorage.getItem("emby-userid") ||
      sessionStorage.getItem("emby-userid") ||
      localStorage.getItem("jellyfin-userid") ||
      sessionStorage.getItem("jellyfin-userid") ||
      null;

    const apiKey =
      getAuthToken() ||
      sessionStorage.getItem("api-key") ||
      localStorage.getItem("api-key") ||
      credentials?.Servers?.[0]?.AccessToken ||
      null;

    return {
      serverUrl,
      userId,
      apiKey,
      isValid: !!userId && !!apiKey,
    };
  } catch {
    return { isValid: false };
  }
}

export function createArtistModal() {
  if (artistModal) return artistModal;

  artistModal = document.createElement("div");
  artistModal.id = "artist-modal";
  artistModal.className = "modal hidden";
  artistModal.setAttribute("aria-hidden", "true");

  if (!__artistModalClickLoggerAdded) {
    __artistModalClickLoggerAdded = true;
    document.addEventListener("click", (e) => {
      const modal = document.getElementById("artist-modal");
      if (!modal) return;
      if (!e.target || !modal.contains(e.target)) return;
      const t = e.target;
      const fa = t.closest?.(".modal-fetch-all-music-btn");
      const syn = t.closest?.(".modal-fetch-new-music-btn");
      const cls = (t.className && String(t.className)) || t.tagName;
      console.log("[artistModal click]", {
        target: cls,
        hitFetchAll: !!fa,
        hitSync: !!syn,
      });
    }, true);
  }

  const modalContent = document.createElement("div");
  modalContent.className = "modal-content modal-artist-content";

  const closeContainer = document.createElement("div");
  closeContainer.className = "modal-close-container";

  const fetchAllMusicBtn = document.createElement("div");
  fetchAllMusicBtn.className = "modal-fetch-all-music-btn";
  fetchAllMusicBtn.innerHTML = '<i class="fa-solid fa-music-magnifying-glass"></i>';
  fetchAllMusicBtn.title = config.languageLabels.fetchAllMusic || "Tüm müzikleri getir";
  fetchAllMusicBtn.onclick = (e) => {
    try {
      currentModalArtist = { name: (config.languageLabels.allMusic || "Tüm Müzikler"), id: null };
      const nameEl = document.querySelector("#artist-modal .modal-artist-name");
      if (nameEl) nameEl.textContent = currentModalArtist.name;
    } catch {}
    return loadAllMusicFromJellyfin({ forceFetch: false });
  };

  const fetchNewMusicBtn = document.createElement("div");
  fetchNewMusicBtn.className = "modal-fetch-new-music-btn";
  fetchNewMusicBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
  fetchNewMusicBtn.title = config.languageLabels.syncDB || "Veri tabanını senkronize et";
  fetchNewMusicBtn.onclick = async (e) => {
    fetchNewMusicBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    showNotification(
      `<i class="fas fa-database"></i> ${config.languageLabels.syncStarted || "Senkronizasyon başlatıldı..."}`,
      3000,
      "db"
    );
    try {
      await syncDbFullscan({ force: true });
      showNotification(
        `<i class="fas fa-check-circle"></i> ${config.languageLabels.syncCompleted || "Senkronizasyon tamamlandı"}`,
        3000,
        "db"
      );
    } catch (error) {
      if (error?.name !== "AbortError") console.error("Senkronizasyon hatası:", error);
    } finally {
      fetchNewMusicBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
    }
  };

  const saveToPlaylistBtn = document.createElement("div");
  saveToPlaylistBtn.className = "modal-save-to-playlist-btn";
  saveToPlaylistBtn.innerHTML = '<i class="fas fa-save"></i>';
  saveToPlaylistBtn.title = config.languageLabels.saveToPlaylist || "Playlist'e kaydet";
  saveToPlaylistBtn.onclick = showSaveToPlaylistModal;

  const showStatsBtn = document.createElement("div");
  showStatsBtn.className = "modal-show-stats-btn";
  showStatsBtn.innerHTML = '<i class="fa-solid fa-chart-simple"></i>';
  showStatsBtn.title = config.languageLabels.stats || "İstatistikleri göster";
  showStatsBtn.onclick = () => showStatsModal();

  const headerActions = document.createElement("div");
  headerActions.className = "modal-header-actions";

  const closeBtn = document.createElement("span");
  closeBtn.className = "modal-close-btn";
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeBtn.onclick = () => toggleArtistModal(false);

  closeContainer.appendChild(showStatsBtn);
  closeContainer.appendChild(fetchAllMusicBtn);
  closeContainer.appendChild(fetchNewMusicBtn);
  closeContainer.appendChild(saveToPlaylistBtn);
  closeContainer.appendChild(closeBtn);
  modalContent.appendChild(closeContainer);

  const modalHeader = document.createElement("div");
  modalHeader.className = "modal-artist-header";

  const artistImage = document.createElement("div");
  artistImage.className = "modal-artist-image";
  artistImage.style.backgroundImage = DEFAULT_ARTWORK;
  artistImage.addEventListener("click", (e) => {
    e.stopPropagation();
    const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
    if (!currentTrack) return;

    const artistId =
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistItems?.[0]?.Id ||
      currentTrack.ArtistId;

    openJfDetails(artistId);
  });

  const artistInfo = document.createElement("div");
  artistInfo.className = "modal-artist-info";

  const searchContainer = document.createElement("div");
  searchContainer.className = "modal-artist-search-container";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "modal-artist-search";
  searchInput.placeholder = config.languageLabels.placeholder;
  searchInput.addEventListener("input", (e) => {
    clearSearchTimer();
    const val = e.target.value;
    searchDebounceTimer = setTimeout(() => {
      filterArtistTracks(val);
    }, SEARCH_DEBOUNCE_TIME);
  });

  const clearSearchBtn = document.createElement("span");
  clearSearchBtn.className = "modal-search-clear hidden";
  clearSearchBtn.innerHTML = '<i class="fas fa-times"></i>';
  clearSearchBtn.onclick = () => {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    filterArtistTracks("");
  };

  searchInput.addEventListener("input", (e) => {
    clearSearchBtn.classList.toggle("hidden", !e.target.value);
  });

  searchContainer.append(searchInput, clearSearchBtn);

  const artistName = document.createElement("h2");
  artistName.className = "modal-artist-name";
  artistName.textContent = "";
  artistName.addEventListener("click", (e) => {
  e.stopPropagation();
    const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
    if (!currentTrack) return;

    const artistId =
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistItems?.[0]?.Id ||
      currentTrack.ArtistId;

    openJfDetails(artistId);
  });

  const artistMeta = document.createElement("div");
  artistMeta.className = "modal-artist-meta";

  const tracksCount = document.createElement("span");
  tracksCount.className = "modal-artist-tracks-count";

  const albumCount = document.createElement("span");
  albumCount.className = "modal-artist-album-count";

  const artistCount = document.createElement("span");
  artistCount.className = "modal-artist-artist-count";

  artistMeta.append(tracksCount, albumCount, artistCount);
  artistInfo.append(artistName, artistMeta);

  modalHeader.append(artistImage, artistInfo, searchContainer, headerActions);

  const tracksContainer = document.createElement("div");
  tracksContainer.className = "modal-artist-tracks-container";

  const paginationContainer = document.createElement("div");
  paginationContainer.className = "modal-pagination-container";
  paginationContainer.style.display = "none";

  modalContent.append(modalHeader, tracksContainer, paginationContainer);
  artistModal.appendChild(modalContent);
  document.body.appendChild(artistModal);

  artistModal.addEventListener("click", (e) => {
    if (e.target === artistModal) toggleArtistModal(false);
  });

  modalChangeDelegation = (e) => {
    if (e.target?.classList?.contains?.("modal-track-checkbox")) {
      const id = e.target.dataset.trackId;
      if (!id) return;
      if (e.target.checked) selectedTrackIds.add(id);
      else selectedTrackIds.delete(id);
      updateSelectAllLabel();
      updatePaginationControls();
    }
  };
  artistModal.addEventListener("change", modalChangeDelegation);

  if ("serviceWorker" in navigator && !swMessageHandler) {
    swMessageHandler = (event) => {
      if (event?.data?.type === "newMusicAdded") {
        const count = Number(event.data.count) || null;
        showNotification(
          `<i class="fas fa-database"></i> ${
            count != null ? `${count} ` : ""
          }${config.languageLabels.dbnewTracksAdded || "yeni şarkı eklendi"}`,
          4000,
          "db"
        );
      }
    };
    navigator.serviceWorker.addEventListener("message", swMessageHandler);
  }

  return artistModal;
}

export function destroyArtistModal() {
  if (!artistModal) return;
  abortAllFetches();
  clearSearchTimer();
  try { artistModal.removeEventListener("change", modalChangeDelegation); } catch {}
  modalChangeDelegation = null;
  if ("serviceWorker" in navigator && swMessageHandler) {
    try { navigator.serviceWorker.removeEventListener("message", swMessageHandler); } catch {}
    swMessageHandler = null;
  }
  try { artistModal.remove(); } catch {}
  artistModal = null;
}

export async function syncDbIncremental({ force = false } = {}) {
  if (__syncPromise) return __syncPromise;

  __syncPromise = (async () => {
    abortSyncFetch();

    await ensureMusicDbReady();

    let dbEmpty = false;
    try {
      const existing = await musicDB.getAllTracks?.();
      dbEmpty = !existing || existing.length === 0;
    } catch {
      dbEmpty = true;
    }
    const { userId, apiKey, isValid } = await getValidJfCredsWithRetry();
    if (!isValid) return { mode: "incremental", addedOrUpdated: 0, skipped: "no-credentials" };

    const lastSyncMs = (force || dbEmpty) ? 0 : getLastSyncMs();
    let newestSeenMs = lastSyncMs;

    const LIMIT = 500;
    let startIndex = 0;
    let totalAddedOrUpdated = 0;

    while (true) {
      const params = new URLSearchParams({
        Recursive: true,
        IncludeItemTypes: "Audio",
        Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists,Genres,DateCreated",
        SortBy: "DateCreated",
        SortOrder: "Descending",
        Limit: String(LIMIT),
        StartIndex: String(startIndex),
        api_key: apiKey,
      });

      const ctrl = new AbortController();
      __syncAbortCtrl = ctrl;
      const resp = await fetch(
        withParams(`/Users/${userId}/Items`, Object.fromEntries(params.entries())),
        {
          signal: ctrl.signal,
          headers: {
            "X-Emby-Token": apiKey,
            "X-MediaBrowser-Token": apiKey,
            "Accept": "application/json",
          },
        }
      ).finally(() => {
        if (__syncAbortCtrl === ctrl) __syncAbortCtrl = null;
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = data.Items || [];
      if (!items.length) break;

      const fresh = [];
      let hitOld = false;

      for (const it of items) {
        const ms = Date.parse(it.DateCreated || "") || 0;
        if (ms > newestSeenMs) newestSeenMs = ms;

        if (!force && lastSyncMs && ms <= lastSyncMs) {
          hitOld = true;
          break;
        }
        fresh.push(it);
      }

      if (fresh.length) {
        await musicDB.addOrUpdateTracks(fresh);
        totalAddedOrUpdated += fresh.length;
      }

      if (hitOld) break;
      startIndex += items.length;
      if (items.length < LIMIT) break;
    }

    setLastSyncMs(newestSeenMs || Date.now());
    const modalEl = document.getElementById("artist-modal");
    if (modalEl && !modalEl.classList.contains("hidden")) {
      const nameEl = modalEl.querySelector(".modal-artist-name");
      const name = nameEl?.textContent;
      if (name === (config.languageLabels.allMusic || "Tüm Müzikler")) {
        loadAllMusicFromJellyfin();
      }
    }

    return { mode: "incremental", addedOrUpdated: totalAddedOrUpdated };
  })();

  try {
    return await __syncPromise;
  } finally {
    __syncPromise = null;
  }
}

export async function syncDbFullscan({ force = false } = {}) {
  if (__syncPromise) return __syncPromise;

  __syncPromise = (async () => {
    abortSyncFetch();

    await ensureMusicDbReady();

    const { userId, apiKey, isValid } = await getValidJfCredsWithRetry();
    if (!isValid) return { mode: "fullscan", added: 0, deleted: 0, skipped: "no-credentials" };

    const lastFs = getLastFullscanMs();
    const now = Date.now();
    if (!force && lastFs && (now - lastFs) < FULLSCAN_INTERVAL_MS) {
      return { mode: "fullscan", skipped: true };
    }

    const params = new URLSearchParams({
      Recursive: true,
      IncludeItemTypes: "Audio",
      Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists,Genres,DateCreated",
      Limit: 20000,
      SortBy: "DateCreated",
      SortOrder: "Ascending",
      api_key: apiKey,
    });

    const ctrl = new AbortController();
    __syncAbortCtrl = ctrl;

    const resp = await fetch(
      withParams(`/Users/${userId}/Items`, Object.fromEntries(params.entries())),
      {
        signal: ctrl.signal,
        headers: {
          "X-Emby-Token": apiKey,
          "X-MediaBrowser-Token": apiKey,
          "Accept": "application/json",
        },
      }
    ).catch((e) => {
      if (e?.name === "AbortError") return null;
      throw e;
    }).finally(() => {
      if (__syncAbortCtrl === ctrl) __syncAbortCtrl = null;
    });

    if (!resp) return { mode: "fullscan", aborted: true };

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const currentTracks = data.Items || [];
    const currentIds = new Set(currentTracks.map((i) => i.Id));

    const dbTracks = await musicDB.getAllTracks();
    const dbIds = new Set(dbTracks.map((t) => t.Id));

    const deleted = [];
    dbIds.forEach((id) => { if (!currentIds.has(id)) deleted.push(id); });

    const added = [];
    currentIds.forEach((id) => { if (!dbIds.has(id)) added.push(id); });

    if (deleted.length) await musicDB.deleteTracks(deleted);
    if (currentTracks.length) await musicDB.addOrUpdateTracks(currentTracks);

    setLastFullscanMs(Date.now());
    setLastSyncMs(Date.now());

    if (added.length) {
      showNotification(
        `<i class="fas fa-database"></i> ${added.length} ${config.languageLabels.dbnewTracksAdded || "yeni şarkı eklendi"}`,
        4000,
        "db"
      );
    }
    if (deleted.length) {
      showNotification(
        `<i class="fas fa-database"></i> ${deleted.length} ${config.languageLabels.dbtracksRemoved || "şarkı silindi"}`,
        4000,
        "db"
      );
    }

    const modalEl = document.getElementById("artist-modal");
    if (modalEl && !modalEl.classList.contains("hidden")) {
      const nameEl = modalEl.querySelector(".modal-artist-name");
      const name = nameEl?.textContent;
      if (name === (config.languageLabels.allMusic || "Tüm Müzikler")) {
        loadAllMusicFromJellyfin();
      } else {
        const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
        const artistId = currentTrack?.ArtistItems?.[0]?.Id ||
          currentTrack?.AlbumArtistId || currentTrack?.ArtistId || null;
        loadArtistTracks(name, artistId);
      }
    }

    return { mode: "fullscan", added: added.length, deleted: deleted.length };
  })();

  try {
    return await __syncPromise;
  } finally {
    __syncPromise = null;
  }
}

export async function maybeRunFullscanIfDue() {
  const lastFs = getLastFullscanMs();
  const now = Date.now();
  if (lastFs && (now - lastFs) < FULLSCAN_INTERVAL_MS) return { skipped: true };
  return syncDbFullscan({ force: false });
}

export function startGlobalDbFullscanScheduler() {
  if (__schedulerBooted) return;
  __schedulerBooted = true;

  const tick = async () => {
    try {
      const { isValid } = getJellyfinCredentials();
      if (!isValid) return;
      await maybeRunFullscanIfDue();
    } catch (e) {
      if (e?.name !== "AbortError") console.warn("[DB scheduler] fullscan tick error:", e);
    }
  };

  setTimeout(() => tick(), 4000);

  __fullscanSchedulerId = setInterval(() => tick(), FULLSCAN_INTERVAL_MS);

  window.addEventListener("focus", () => tick(), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  }, { passive: true });
}

async function loadAllMusicFromJellyfin({ forceFetch = false } = {}) {
  console.log("[FetchAll] loadAllMusicFromJellyfin ENTER", { forceFetch });
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  const tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  const paginationContainer = modalEl.querySelector(".modal-pagination-container");
  if (!tracksContainer || !paginationContainer) return;

  tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';
  paginationContainer.style.display = "none";

  abortAllFetches();

  try {
    let tracks = await musicDB.getAllTracks();
    let needFetch = !!forceFetch || tracks.length === 0;

    if (needFetch) {
      console.log("[FetchAll] needFetch true -> will fetch from Jellyfin");
      const { userId, apiKey, isValid } = getJellyfinCredentials();
      if (isValid) {
        const LIMIT = 500;
        let startIndex = 0;
        let total = Infinity;
        const combined = [];

        while (startIndex < total) {
          const params = new URLSearchParams({
            Recursive: true,
            IncludeItemTypes: "Audio",
            Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists",
            SortBy: "AlbumArtist,Album,SortName",
            Limit: String(LIMIT),
            StartIndex: String(startIndex),
            api_key: apiKey,
          });

          const url = withParams(`/Users/${userId}/Items`, Object.fromEntries(params.entries()));
          console.log("[FetchAll] URL =>", url);

          const ctrl = new AbortController();
          addFetchController(ctrl);
          const timeoutId = setTimeout(() => {
            console.warn("[FetchAll] fetch timeout -> aborting");
            try { ctrl.abort(); } catch {}
          }, 90_000);

          let resp;
          try {
            resp = await fetch(url, {
              signal: ctrl.signal,
              headers: {
                "X-Emby-Token": apiKey,
                "X-MediaBrowser-Token": apiKey,
                "Accept": "application/json",
              },
            });
            console.log("[FetchAll] fetch returned", { ok: resp.ok, status: resp.status, statusText: resp.statusText });
          } catch (e) {
            console.error("[FetchAll] fetch threw", e);
            throw e;
          } finally {
            clearTimeout(timeoutId);
            settleFetchController(ctrl);
          }

          const rawText = await resp.text();
          console.log("[FetchAll] raw response (first 200) =>", rawText.slice(0, 200));
          if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${rawText.slice(0, 200)}`);

          let data;
          try { data = JSON.parse(rawText); }
          catch (e) { throw new Error("JSON parse failed: " + e?.message); }

          const items = data.Items || [];
          total = Number.isFinite(data.TotalRecordCount) ? data.TotalRecordCount : (startIndex + items.length);
          combined.push(...items);

          if (items.length) {
            if (typeof musicDB?.addOrUpdateTracks === "function") {
              try {
                await musicDB.addOrUpdateTracks(items);
              } catch (e) {
                console.error("[FetchAll] DB write failed (addOrUpdateTracks)", e);
                throw e;
              }
            } else if (typeof musicDB?.saveTracks === "function") {
              try {
                await musicDB.saveTracks(combined);
              } catch (e) {
                console.error("[FetchAll] DB write failed (saveTracks)", e);
                throw e;
              }
            }
          }
          console.log("[FetchAll] page", { startIndex, got: items.length, total });

          if (!items.length) break;
          startIndex += items.length;
          if (items.length < LIMIT) break;
        }

        tracks = combined;
        console.log("[FetchAll] fetched total items:", tracks.length);
        if (typeof musicDB?.addOrUpdateTracks !== "function") {
          await musicDB.saveTracks(tracks);
          console.log("[FetchAll] DB write OK:", tracks.length);
        } else {
          console.log("[FetchAll] DB incremental write OK");
        }
      }
    }

    const albums = new Set();
    const artists = new Set();
    tracks.forEach((t) => {
      if (t.Album) albums.add(t.Album);
      if (t.Artists) t.Artists.forEach((a) => artists.add(a));
      if (t.AlbumArtist) artists.add(t.AlbumArtist);
    });

    allTracks = sortTracks(tracks, currentSortOption);
    totalTracks = allTracks.length;
    totalAlbums = albums.size;
    totalArtists = artists.size;
    currentPage = 1;
    totalPages =
      currentPaginationMode === "albums"
        ? Math.ceil(totalAlbums / ALBUMS_PER_PAGE)
        : Math.ceil(totalTracks / TRACKS_PER_PAGE);

    displayPaginatedTracks();
    updatePaginationControls();
    updateStatsDisplay();
    updateSelectAllLabel();
    if (totalPages > 1) paginationContainer.style.display = "flex";
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("[FetchAll] ERROR:", error);
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> FetchAll error: ${String(error?.message || error)}`,
      5000,
      "error"
    );
    tracksContainer.innerHTML = `
      <div class="modal-error-message">
        ${config.languageLabels.errorLoadAllMusic || "Tüm müzikler yüklenirken hata oluştu"}
        <div class="modal-error-detail">${error.message}</div>
      </div>`;
  }
}

function createSortDropdown() {
  const sortContainer = document.createElement("div");
  sortContainer.className = "modal-sort-container";

  const inner = document.createElement("div");
  inner.className = "sort-inner-container";

  const sortLabel = document.createElement("span");
  sortLabel.className = "modal-sort-label";
  sortLabel.textContent = config.languageLabels.sortBy || "Sırala:";

  const sortSelect = document.createElement("select");
  sortSelect.className = "modal-sort-select";

  const directionBtn = document.createElement("button");
  directionBtn.className = "sort-direction-btn";
  directionBtn.innerHTML = '<i class="fas fa-sort-amount-down"></i>';
  directionBtn.title = config.languageLabels.toggleSortDirection || "Sıralama yönünü değiştir";
  directionBtn.addEventListener("click", toggleSortDirection);

  const options = [
    { value: SORT_OPTIONS.ALPHABETICAL, text: config.languageLabels.sortAlphabetical || "Şarkı Adı" },
    { value: SORT_OPTIONS.ARTIST, text: config.languageLabels.sortArtist || "Sanatçı" },
    { value: SORT_OPTIONS.ALBUM, text: config.languageLabels.sortAlbum || "Albüm" },
    { value: SORT_OPTIONS.DATE_ADDED, text: config.languageLabels.sortDateAdded || "Eklenme Tarihi" },
    { value: SORT_OPTIONS.DURATION, text: config.languageLabels.sortDuration || "Süre" },
  ];

  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.text;
    if (opt.value === currentSortOption) el.selected = true;
    sortSelect.appendChild(el);
  });

  sortSelect.addEventListener("change", (e) => {
    currentSortOption = e.target.value;
    refreshCurrentView();
    updateSortDirectionIcon();
  });

  inner.append(sortLabel, sortSelect, directionBtn);
  sortContainer.appendChild(inner);
  return sortContainer;
}

function toggleSortDirection() {
  sortStates[currentSortOption].asc = !sortStates[currentSortOption].asc;
  refreshCurrentView();
  updateSortDirectionIcon();
}

function updateSortDirectionIcon() {
  const activeHeader = document.querySelector(".modal-sort-header.active");
  if (!activeHeader) return;
  const icon = activeHeader.querySelector("i");
  if (icon) {
    icon.className = sortStates[currentSortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
  }
}

function refreshCurrentView() {
  const artistNameElement = document.querySelector("#artist-modal .modal-artist-name");
  const isAllMusicView = artistNameElement?.textContent === (config.languageLabels.allMusic || "Tüm Müzikler");
  if (isAllMusicView) loadAllMusicFromJellyfin();
  else loadArtistTracks(currentModalArtist.name, currentModalArtist.id);
}

function updateSelectAllLabel() {
  const selectAllLabel = document.querySelector(".modal-select-all-label");
  if (!selectAllLabel) return;
  const textSpan = selectAllLabel.querySelector(".select-all-text");
  const countSpan = selectAllLabel.querySelector(".selected-count");
  const selectAllCheckbox = document.getElementById("artist-modal-select-all");
  if (!textSpan || !countSpan || !selectAllCheckbox) return;

  const totalSelected = selectedTrackIds.size;
  const visibleCheckboxes = document.querySelectorAll(".modal-track-checkbox");

  if (totalSelected === 0) {
    textSpan.textContent = config.languageLabels.selectAll || "Tümünü seç";
    countSpan.textContent = "";
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else {
    const totalVisible = visibleCheckboxes.length;
    const selectedVisible = Array.from(visibleCheckboxes).filter((cb) =>
      selectedTrackIds.has(cb.dataset.trackId)
    ).length;

    textSpan.textContent = `${totalSelected} ${config.languageLabels.tracksSelected}`;
    selectAllCheckbox.checked = selectedVisible === totalVisible && totalVisible > 0;
    selectAllCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < totalVisible;
    countSpan.textContent = selectedVisible > 0 ? ` (${selectedVisible})` : "";
  }

  const playSelectedBtn = document.querySelector(".modal-play-selected-btn");
  if (playSelectedBtn) playSelectedBtn.disabled = totalSelected === 0;
}

function updateStatsDisplay() {
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;
  const artistNameElement = modalEl.querySelector(".modal-artist-name");
  const tracksCountElement = modalEl.querySelector(".modal-artist-tracks-count");
  const albumCountElement = modalEl.querySelector(".modal-artist-album-count");
  const artistCountElement = modalEl.querySelector(".modal-artist-artist-count");

  if (artistNameElement) artistNameElement.textContent = config.languageLabels.allMusic || "Tüm Müzikler";
  if (tracksCountElement) tracksCountElement.textContent = `${totalTracks} ${config.languageLabels.track || "parça"}`;
  if (albumCountElement) albumCountElement.textContent = `${totalAlbums} ${config.languageLabels.album || "albüm"}`;
  if (artistCountElement) artistCountElement.textContent = `${totalArtists} ${config.languageLabels.artist || "sanatçı"}`;
}

function updatePaginationControls() {
  const paginationContainer = document.querySelector("#artist-modal .modal-pagination-container");
  if (!paginationContainer) return;

  const searchInput = document.querySelector("#artist-modal .modal-artist-search");
  const q = searchInput?.value.trim().toLowerCase() || "";

  let filteredTracks = allTracks;
  let filteredAlbums = groupTracksByAlbum(allTracks);

  if (q) {
    filteredTracks = allTracks.filter((t) => {
      const title = t.Name?.toLowerCase() || "";
      const album = t.Album?.toLowerCase() || "";
      const artist = t.Artists?.join(" ").toLowerCase() || "";
      const albumArtist = t.AlbumArtist?.toLowerCase() || "";
      return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
    });

    const albums = groupTracksByAlbum(filteredTracks);
    const keys = Object.keys(albums).filter((key) =>
      albums[key].some((t) => {
        const title = t.Name?.toLowerCase() || "";
        const album = t.Album?.toLowerCase() || "";
        const artist = t.Artists?.join(" ").toLowerCase() || "";
        const albumArtist = t.AlbumArtist?.toLowerCase() || "";
        return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
      })
    );

    filteredAlbums = {};
    keys.forEach((k) => (filteredAlbums[k] = albums[k]));
  }

  if (currentPaginationMode === "albums") {
    totalPages = Math.ceil(Object.keys(filteredAlbums).length / ALBUMS_PER_PAGE) || 1;
  } else {
    totalPages = Math.ceil(filteredTracks.length / TRACKS_PER_PAGE) || 1;
  }
  if (currentPage > totalPages) currentPage = totalPages;

  paginationContainer.innerHTML = "";

  const modeToggle = document.createElement("button");
  modeToggle.className = "pagination-mode-toggle";
  modeToggle.textContent =
    currentPaginationMode === "albums"
      ? config.languageLabels.showTracks || "Sadece Şarkıları Listele"
      : config.languageLabels.showAlbums || "Albüm İsimleri İle Listele";
  modeToggle.onclick = () => {
    currentPaginationMode = currentPaginationMode === "albums" ? "tracks" : "albums";
    currentPage = 1;
    updatePaginationControls();
    displayPaginatedTracks();
    updateSelectAllLabel();
  };

  const prevButton = document.createElement("button");
  prevButton.className = "pagination-button";
  prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
  prevButton.disabled = currentPage === 1;
  prevButton.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      displayPaginatedTracks();
      updatePaginationControls();
      updateSelectAllLabel();
    }
  };

  const pageInfo = document.createElement("span");
  pageInfo.className = "pagination-info";
  pageInfo.textContent = `${currentPage} / ${totalPages}`;

  const nextButton = document.createElement("button");
  nextButton.className = "pagination-button";
  nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
  nextButton.disabled = currentPage >= totalPages;
  nextButton.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      displayPaginatedTracks();
      updatePaginationControls();
      updateSelectAllLabel();
    }
  };

  const totalInfo = document.createElement("span");
  totalInfo.className = "pagination-total";
  if (currentPaginationMode === "tracks") {
    totalInfo.textContent = q ? `${filteredTracks.length} ${config.languageLabels.track || "parça"}`
                              : `${allTracks.length} ${config.languageLabels.track || "parça"}`;
  } else {
    const albumCount = q ? Object.keys(filteredAlbums).length
                         : Object.keys(groupTracksByAlbum(allTracks)).length;
    totalInfo.textContent = `${albumCount} ${config.languageLabels.album || "albüm"}`;
  }

  paginationContainer.append(modeToggle, prevButton, pageInfo, nextButton, totalInfo);
}

function displayPaginatedTracks() {
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  const tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  if (!tracksContainer) return;

  tracksContainer.innerHTML = "";
  const searchInput = modalEl.querySelector(".modal-artist-search");
  const q = searchInput?.value.trim().toLowerCase() || "";

  if (currentPaginationMode === "albums") {
    const albums = groupTracksByAlbum(allTracks);
    let albumKeys = Object.keys(albums).sort();

    if (q) {
      albumKeys = albumKeys.filter((key) =>
        albums[key].some((t) => {
          const title = t.Name?.toLowerCase() || "";
          const album = t.Album?.toLowerCase() || "";
          const artist = t.Artists?.join(" ").toLowerCase() || "";
          const albumArtist = t.AlbumArtist?.toLowerCase() || "";
          return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
        })
      );
    }

    totalPages = Math.ceil(albumKeys.length / ALBUMS_PER_PAGE) || 1;
    const start = (currentPage - 1) * ALBUMS_PER_PAGE;
    const end = start + ALBUMS_PER_PAGE;
    const pageAlbumKeys = albumKeys.slice(start, end);

    const { apiKey } = getJellyfinCredentials();
    pageAlbumKeys.forEach((key) => {
      const albumTracks = albums[key];
      const header = createAlbumHeader(albumTracks[0], apiKey);
      tracksContainer.appendChild(header);
      albumTracks.forEach((track, idx) => {
        const el = createTrackElement(track, idx, true);
        tracksContainer.appendChild(el);
      });
    });

    const headerActions = modalEl.querySelector(".modal-header-actions");
    if (headerActions) setupHeaderActions(headerActions);

  } else {
    const filtered = q
      ? allTracks.filter((t) => {
          const title = t.Name?.toLowerCase() || "";
          const album = t.Album?.toLowerCase() || "";
          const artist = t.Artists?.join(" ").toLowerCase() || "";
          const albumArtist = t.AlbumArtist?.toLowerCase() || "";
          return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
        })
      : allTracks;

    totalPages = Math.ceil(filtered.length / TRACKS_PER_PAGE) || 1;
    const start = (currentPage - 1) * TRACKS_PER_PAGE;
    const end = start + TRACKS_PER_PAGE;

    const sortHeaders = createSortHeaders();
    tracksContainer.appendChild(sortHeaders);

    filtered.slice(start, end).forEach((track, idx) => {
      const el = createTrackElement(track, idx, false);
      tracksContainer.appendChild(el);
    });

    const headerActions = modalEl.querySelector(".modal-header-actions");
    if (headerActions) setupHeaderActions(headerActions);
  }

  queueMicrotask(() => {
    document.querySelectorAll(".modal-track-checkbox").forEach((cb) => {
      cb.checked = selectedTrackIds.has(cb.dataset.trackId);
    });
    updateSelectAllLabel();
    updatePaginationControls();
  });
}

function createAlbumHeader(album, apiKey) {
  const albumHeader = document.createElement("div");
  albumHeader.className = "modal-album-header";

  const albumCover = document.createElement("div");
  albumCover.className = "modal-album-cover";

  const albumId = album.AlbumId || album.Id;
  const imageTag = album.AlbumPrimaryImageTag || album.PrimaryImageTag;

  if (albumId && imageTag) {
    const imageUrl = withParams(`/Items/${albumId}/Images/Primary`, {
      fillHeight: 100,
      quality: 80,
      tag: imageTag,
      api_key: apiKey,
    });
    const img = new Image();
    img.onload = () => { albumCover.style.backgroundImage = `url('${imageUrl}')`; };
    img.onerror = () => { albumCover.style.backgroundImage = DEFAULT_ARTWORK; };
    img.src = imageUrl;
  } else {
    albumCover.style.backgroundImage = DEFAULT_ARTWORK;
  }

  const albumInfo = document.createElement("div");
  albumInfo.className = "modal-album-info";

  const albumTitle = document.createElement("h3");
  albumTitle.className = "modal-album-title";
  albumTitle.textContent = `${album.AlbumArtist || album.Artists?.[0] || config.languageLabels.artistUnknown} - ${album.Album || config.languageLabels.unknownTrack}`;

  const albumYear = document.createElement("div");
  albumYear.className = "modal-album-year";
  albumYear.textContent = album.ProductionYear || "";

  albumInfo.append(albumTitle, albumYear);
  albumHeader.append(albumCover, albumInfo);
  return albumHeader;
}

function createTrackElement(track, index, showPosition = true) {
  const trackElement = document.createElement("div");
  trackElement.className = "modal-artist-track-item";

  const trackNumberContainer = document.createElement("div");
  trackNumberContainer.className = "modal-track-number-container";

  const trackNumber = document.createElement("span");
  trackNumber.className = "modal-track-number";
  trackNumber.textContent = (index + 1).toString().padStart(2, "0");
  trackNumberContainer.appendChild(trackNumber);

  const trackCheckbox = document.createElement("input");
  trackCheckbox.type = "checkbox";
  trackCheckbox.className = "modal-track-checkbox";
  trackCheckbox.dataset.trackId = track.Id;
  trackCheckbox.checked = selectedTrackIds.has(track.Id);
  trackNumberContainer.appendChild(trackCheckbox);

  trackElement.appendChild(trackNumberContainer);

  const trackInfo = document.createElement("div");
  trackInfo.className = "modal-track-info";

  const trackTitle = document.createElement("div");
  trackTitle.className = "modal-track-title";
  trackTitle.textContent = track.Name || config.languageLabels.unknownTrack;

  const trackArtist = document.createElement("div");
  trackArtist.className = "modal-track-artist";
  trackArtist.textContent = track.Artists?.join(", ") || track.AlbumArtist || config.languageLabels.artistUnknown;

  const trackAlbum = document.createElement("div");
  trackAlbum.className = "modal-track-album";
  trackAlbum.textContent = track.Album || config.languageLabels.unknownTrack;

  const trackDateAdded = document.createElement("div");
  trackDateAdded.className = "modal-track-date-added";
  if (track.DateCreated) {
    const date = new Date(track.DateCreated);
    trackDateAdded.textContent = date.toLocaleString(config.dateLocale || "tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } else {
    trackDateAdded.textContent = "-";
  }

  trackInfo.append(trackTitle, trackArtist, trackAlbum, trackDateAdded);

  if (track.ProductionYear) {
    const trackYear = document.createElement("div");
    trackYear.className = "modal-track-year";
    trackYear.textContent = track.ProductionYear;
    trackInfo.appendChild(trackYear);
  }

  const trackDuration = document.createElement("div");
  trackDuration.className = "modal-track-duration";
  trackDuration.textContent = formatDuration(track);

  trackElement.append(trackInfo, trackDuration);
  trackElement.addEventListener("click", (e) => {
    if (e.target?.tagName === "INPUT") return;
    handleTrackClick(track);
  });

  return trackElement;
}

function handleTrackClick(track) {
  const newPlaylist = [...musicPlayerState.playlist];
  const currentIndex = musicPlayerState.currentIndex;
  const existingIndex = newPlaylist.findIndex((t) => t.Id === track.Id);

  if (existingIndex === -1) {
    newPlaylist.splice(currentIndex + 1, 0, track);
    musicPlayerState.playlist = newPlaylist;
    musicPlayerState.originalPlaylist = [...newPlaylist];

    showNotification(`<i class="fas fa-plus-circle"></i> ${config.languageLabels.addingsuccessful}`, 2000, "addlist");
    updateNextTracks().then(() => {
      playTrack(currentIndex + 1);
    });
  } else {
    showNotification(`<i class="fas fa-info-circle"></i> ${config.languageLabels.alreadyInTrack}`, 2000, "addlist");
    updateNextTracks();
    playTrack(existingIndex);
    updatePlaylistModal();
  }
}

function handlePlaySelected() {
  if (selectedTrackIds.size === 0) return;
  const selectedTracks = allTracks.filter((t) => selectedTrackIds.has(t.Id));
  if (selectedTracks.length === 0) return;

  const uniqueTracks = selectedTracks.filter((t) => !musicPlayerState.playlist.some((x) => x.Id === t.Id));
  if (uniqueTracks.length === 0) {
    showNotification(
      `<i class="fas fa-info-circle"></i> ${config.languageLabels.noTracksToSave}`,
      2000,
      "addlist"
    );
    return;
  }

  const duplicateCount = selectedTracks.length - uniqueTracks.length;
  if (duplicateCount > 0) {
    const dupNames = selectedTracks.filter((t) => musicPlayerState.playlist.some((x) => x.Id === t.Id))
      .slice(0, 3)
      .map((t) => t.Name);
    const remain = duplicateCount - dupNames.length;
    const msg = duplicateCount <= 3
      ? `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.alreadyInPlaylist} (${duplicateCount}): ${dupNames.join(", ")}`
      : `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.alreadyInPlaylist} (${duplicateCount}): ${dupNames.join(", ")} ${config.languageLabels.ayrica} ${remain} ${config.languageLabels.moreTracks}`;
    showNotification(msg, 4000, "addlist");
  }

  const currentIndex = musicPlayerState.currentIndex;
  musicPlayerState.playlist.splice(currentIndex + 1, 0, ...uniqueTracks);
  musicPlayerState.originalPlaylist.splice(currentIndex + 1, 0, ...uniqueTracks);
  musicPlayerState.userAddedTracks.push(...uniqueTracks);
  musicPlayerState.effectivePlaylist = [
    ...musicPlayerState.playlist,
    ...musicPlayerState.userAddedTracks,
  ];

  if (musicPlayerState.userSettings.shuffle) {
    musicPlayerState.effectivePlaylist = shuffleArray([...musicPlayerState.effectivePlaylist]);
    musicPlayerState.isShuffled = true;
  }

  showNotification(
    `<i class="fas fa-music"></i> ${uniqueTracks.length} ${config.languageLabels.tracks}`,
    2000,
    "addlist"
  );
  updateNextTracks().then(() => playTrack(currentIndex + 1));
  toggleArtistModal(false);
  updatePlaylistModal();
}

function updateSelectAllState(tracks = []) {
  const selectAllCheckbox = document.querySelector("#artist-modal-select-all");
  const playSelectedBtn = document.querySelector(".modal-play-selected-btn");
  if (!selectAllCheckbox || !playSelectedBtn) return;

  const visible = tracks.length
    ? tracks.map((t) => t.Id)
    : Array.from(document.querySelectorAll(".modal-track-checkbox")).map((cb) => cb.dataset.trackId);

  const allSelected = visible.length > 0 && visible.every((id) => selectedTrackIds.has(id));
  selectAllCheckbox.checked = allSelected;
  playSelectedBtn.disabled = selectedTrackIds.size === 0;
}

function showNoTracksMessage(container) {
  container.innerHTML = `<div class="modal-no-tracks">${config.languageLabels.noTrack}</div>`;
}

function formatDuration(track) {
  if (track.RunTimeTicks) {
    const seconds = Math.floor(track.RunTimeTicks / 10_000_000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return track.Duration || "0:00";
}

export async function checkForNewMusic() {
  try {
    await syncDbFullscan({ force: true });
    return;
  } catch (e) {
    throw e;
  }
}

async function loadArtistImage(artistId) {
  const el = document.querySelector("#artist-modal .modal-artist-image");
  const { apiKey, isValid } = getJellyfinCredentials();
  if (!isValid || !artistId) {
    el.style.backgroundImage = DEFAULT_ARTWORK;
    return;
  }
  try {
    const url = withParams(`/Items/${artistId}/Images/Primary`, {
      fillHeight: 300,
      quality: 96,
      api_key: apiKey,
    });

    const img = new Image();
    img.onload = () => { el.style.backgroundImage = `url('${url}')`; };
    img.onerror = () => { el.style.backgroundImage = DEFAULT_ARTWORK; };
    img.src = url;
  } catch {
    el.style.backgroundImage = DEFAULT_ARTWORK;
  }
}

async function loadArtistDetails(artistId) {
  const { userId, apiKey, isValid } = getJellyfinCredentials();
  if (!isValid || !artistId) return null;

  const ctrl = new AbortController();
  addFetchController(ctrl);
  try {
    const resp = await fetch(
      withParams(`/Users/${userId}/Items/${artistId}`, { api_key: apiKey }),
      {
        signal: ctrl.signal,
        headers: {
          "X-Emby-Token": apiKey,
          "X-MediaBrowser-Token": apiKey,
          "Accept": "application/json",
        },
      }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const name = data.Name || data.OriginalTitle || config.languageLabels.artistUnknown;
    const el = document.querySelector("#artist-modal .modal-artist-name");
    if (el) el.textContent = name;
    return data;
  } finally {
    settleFetchController(ctrl);
  }
}

async function loadArtistTracks(artistName, artistId) {
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  const tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  const paginationContainer = modalEl.querySelector(".modal-pagination-container");
  if (!tracksContainer || !paginationContainer) return;

  tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';
  paginationContainer.style.display = "none";

  abortAllFetches();

  try {
    let tracks = [];
    const albums = new Set();
    const artists = new Set();

    const dbTracks = await musicDB.getAllTracks();
    if (artistId) {
      tracks = dbTracks.filter(
        (t) =>
          t.ArtistItems?.some((a) => a.Id === artistId) ||
          t.AlbumArtistId === artistId ||
          t.ArtistId === artistId
      );
      await loadArtistDetails(artistId);
    } else {
      tracks = dbTracks.filter(
        (t) => t.Artists?.includes(artistName) || t.AlbumArtist === artistName
      );
    }

    tracks.forEach((t) => {
      if (t.Album) albums.add(t.Album);
      if (t.Artists) t.Artists.forEach((a) => artists.add(a));
      if (t.AlbumArtist) artists.add(t.AlbumArtist);
    });

    tracks = sortTracks(tracks, currentSortOption);

    allTracks = [...tracks];
    totalTracks = allTracks.length;
    totalAlbums = albums.size;
    totalArtists = artists.size;

    currentPage = 1;
    totalPages = Math.ceil(totalTracks / TRACKS_PER_PAGE) || 1;

    displayPaginatedTracks();
    updatePaginationControls();
    updateSelectAllLabel();

    const artistNameElement = modalEl.querySelector(".modal-artist-name");
    const tracksCountElement = modalEl.querySelector(".modal-artist-tracks-count");
    const albumCountElement = modalEl.querySelector(".modal-artist-album-count");
    const artistCountElement = modalEl.querySelector(".modal-artist-artist-count");

    if (artistNameElement) artistNameElement.textContent = artistName || config.languageLabels.artistUnknown;
    if (tracksCountElement) tracksCountElement.textContent = `${totalTracks} ${config.languageLabels.track || "parça"}`;
    if (albumCountElement) albumCountElement.textContent = `${totalAlbums} ${config.languageLabels.album || "albüm"}`;
    if (artistCountElement) artistCountElement.textContent = `${totalArtists} ${config.languageLabels.artist || "sanatçı"}`;
    if (totalPages > 1) paginationContainer.style.display = "flex";

    const oldBio = document.querySelector(".modal-bio-container");
    if (oldBio) oldBio.remove();

    const details = artistId ? await loadArtistDetails(artistId) : null;
    if (details?.Overview) {
      const bioContainer = document.createElement("div");
      bioContainer.className = "modal-bio-container";
      const bioToggle = document.createElement("button");
      bioToggle.className = "modal-bio-toggle collapsed";
      bioToggle.innerHTML = `<i class="fas fa-chevron-down"></i> ${config.languageLabels.visibleBio}`;
      const artistBio = document.createElement("div");
      artistBio.className = "modal-artist-bio";
      const bioText = details.Overview;
      const safeBio = bioText.replace(
        /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sn|St|vs|No|etc|Jr|Sr|Ltd|Inc|Co|Doç|Av|Yrd|Öğr\.?Gör|Arş\.?Gör|Bkz))\.(\s+)(?=\p{Lu})/gu,
        ".<br>"
      );
      artistBio.innerHTML = safeBio;
      bioToggle.addEventListener("click", () => {
        bioToggle.classList.toggle("collapsed");
        bioToggle.classList.toggle("expanded");
        artistBio.classList.toggle("expanded");
        bioToggle.innerHTML = bioToggle.classList.contains("expanded")
          ? `<i class="fas fa-chevron-up"></i> ${config.languageLabels.hiddenBio}`
          : `<i class="fas fa-chevron-down"></i> ${config.languageLabels.visibleBio}`;
      });
      bioContainer.append(bioToggle, artistBio);
      document.querySelector(".modal-artist-info")?.appendChild(bioContainer);
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    tracksContainer.innerHTML = `
      <div class="modal-error-message">
        ${config.languageLabels.errorAlbum}
        <div class="modal-error-detail">${error.message}</div>
      </div>`;
  }
}

function displayTracksWithoutAlbums(tracks) {
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  const tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  const headerActions = modalEl.querySelector(".modal-header-actions");
  if (!tracksContainer || !headerActions) return;

  tracksContainer.innerHTML = "";
  const sortHeaders = createSortHeaders();
  tracksContainer.appendChild(sortHeaders);

  setupHeaderActions(headerActions);

  if (!tracks || tracks.length === 0) {
    showNoTracksMessage(tracksContainer);
    return;
  }
  tracks.forEach((t, idx) => {
    tracksContainer.appendChild(createTrackElement(t, idx, false));
  });
  updateSelectAllState(tracks);
}

function displayAlbumWithTracks(album, tracks) {
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  const tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  const headerActions = modalEl.querySelector(".modal-header-actions");
  if (!tracksContainer || !headerActions) return;

  const { apiKey } = getJellyfinCredentials();
  const header = createAlbumHeader(album, apiKey);
  tracksContainer.appendChild(header);

  setupHeaderActions(headerActions);

  if (!tracks || tracks.length === 0) return;
  tracks.forEach((t, idx) => {
    tracksContainer.appendChild(createTrackElement(t, idx, true));
  });
  updateSelectAllState(tracks);
}

function createSortHeaders() {
  const headersContainer = document.createElement("div");
  headersContainer.className = "modal-sort-headers";

  const checkboxPlaceholder = document.createElement("div");
  checkboxPlaceholder.className = "modal-header-checkbox";
  headersContainer.appendChild(checkboxPlaceholder);

  const defs = [
    ["modal-header-title", config.languageLabels.sortName || "Şarkı", SORT_OPTIONS.ALPHABETICAL],
    ["modal-header-artist", config.languageLabels.sortArtist || "Sanatçı", SORT_OPTIONS.ARTIST],
    ["modal-header-year", config.languageLabels.sortYear || "Yıl", SORT_OPTIONS.ALBUM],
    ["modal-header-album", config.languageLabels.sortAlbum || "Albüm", SORT_OPTIONS.ALBUM],
    ["modal-header-date", config.languageLabels.sortDateAdded || "Eklenme", SORT_OPTIONS.DATE_ADDED],
    ["modal-header-duration", config.languageLabels.sortDuration || "Süre", SORT_OPTIONS.DURATION],
  ];

  defs.forEach(([cls, text, opt]) => headersContainer.appendChild(createSortHeader(cls, text, opt)));
  return headersContainer;
}

function createSortHeader(className, text, sortOption) {
  const header = document.createElement("div");
  header.className = `modal-sort-header ${className}`;
  header.textContent = text;
  header.dataset.sortOption = sortOption;

  if (currentSortOption === sortOption) {
    header.classList.add("active");
    const icon = document.createElement("i");
    icon.className = sortStates[sortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
    header.appendChild(icon);
  }

  header.addEventListener("click", () => {
    if (currentSortOption === sortOption) {
      toggleSortDirection();
    } else {
      currentSortOption = sortOption;
      refreshCurrentView();
    }
    document.querySelectorAll(".modal-sort-header").forEach((h) => {
      h.classList.remove("active");
      h.querySelector("i")?.remove();
    });
    header.classList.add("active");
    const icon = document.createElement("i");
    icon.className = sortStates[sortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
    header.appendChild(icon);
  });

  return header;
}

function setupHeaderActions(headerActions) {
  headerActions.innerHTML = "";

  const selectAllContainer = document.createElement("div");
  selectAllContainer.className = "modal-select-all-container";

  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.id = "artist-modal-select-all";
  selectAllCheckbox.className = "modal-select-all-checkbox";
  selectAllCheckbox.title = config.languageLabels.selectAll;

  const selectAllLabel = document.createElement("label");
  selectAllLabel.htmlFor = "artist-modal-select-all";
  selectAllLabel.className = "modal-select-all-label";

  const textSpan = document.createElement("span");
  textSpan.className = "select-all-text";
  textSpan.textContent = config.languageLabels.selectAll || "Tümünü seç";

  const countSpan = document.createElement("span");
  countSpan.className = "selected-count";

  selectAllLabel.append(textSpan, countSpan);
  selectAllContainer.append(selectAllCheckbox, selectAllLabel);

  const playSelectedContainer = document.createElement("div");
  playSelectedContainer.className = "modal-play-selected-container";

  const playSelectedBtn = document.createElement("button");
  playSelectedBtn.className = "modal-play-selected-btn";
  playSelectedBtn.title = config.languageLabels.addToExisting;
  playSelectedBtn.innerHTML = '<i class="fa-solid fa-plus-large"></i>';
  playSelectedBtn.disabled = selectedTrackIds.size === 0;
  playSelectedBtn.onclick = handlePlaySelected;

  playSelectedContainer.appendChild(playSelectedBtn);
  headerActions.append(selectAllContainer, playSelectedContainer);
  const update = () => {
    const visibleCBs = document.querySelectorAll(".modal-track-checkbox");
    const visIds = Array.from(visibleCBs).map((cb) => cb.dataset.trackId);
    const visSelected = visIds.filter((id) => selectedTrackIds.has(id)).length;

    const allVisSelected = visibleCBs.length > 0 && visSelected === visibleCBs.length;
    const someVisSelected = visSelected > 0 && !allVisSelected;

    if (allVisSelected) {
      textSpan.textContent = config.languageLabels.allSelected || "Tümü seçildi";
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else if (someVisSelected) {
      textSpan.textContent = config.languageLabels.selected || "Seçilen";
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    } else {
      textSpan.textContent = config.languageLabels.selectAll || "Tümünü seç";
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
    countSpan.textContent = visSelected > 0 ? ` (${visSelected})` : "";
    playSelectedBtn.disabled = selectedTrackIds.size === 0;
  };

  update();

  selectAllCheckbox.addEventListener("change", (e) => {
    const shouldSelect = e.target.checked;
    document.querySelectorAll(".modal-track-checkbox").forEach((cb) => {
      cb.checked = shouldSelect;
      const id = cb.dataset.trackId;
      if (!id) return;
      if (shouldSelect) selectedTrackIds.add(id);
      else selectedTrackIds.delete(id);
    });
    update();
  });
}

export async function toggleArtistModal(show, artistName = "", artistId = null) {
  if (!artistModal) createArtistModal();

  if (show) {
    if (!artistModal.classList.contains("hidden")) {
      artistName = currentModalArtist.name;
      artistId = currentModalArtist.id;
    } else {
      selectedTrackIds = new Set();
      currentModalArtist = { name: artistName, id: artistId };
    }

    const tracksContainer = document.querySelector("#artist-modal .modal-artist-tracks-container");
    if (tracksContainer) tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';

      const nameEl = document.querySelector("#artist-modal .modal-artist-name");
  const imgEl = document.querySelector("#artist-modal .modal-artist-image");

  if (nameEl) nameEl.textContent = artistName || config.languageLabels.artistUnknown;
  if (imgEl) imgEl.style.backgroundImage = DEFAULT_ARTWORK;

  const artistMeta = document.querySelector("#artist-modal .modal-artist-meta");
  if (artistMeta) {
    artistMeta.innerHTML = "";
    const tracksCountElement = document.createElement("span");
    tracksCountElement.className = "modal-artist-tracks-count";
    tracksCountElement.textContent = config.languageLabels.loading || "Yükleniyor...";

    const albumCountElement = document.createElement("span");
    albumCountElement.className = "modal-artist-album-count";

    const artistCountElement = document.createElement("span");
    artistCountElement.className = "modal-artist-artist-count";

    artistMeta.append(tracksCountElement, albumCountElement, artistCountElement);
  }

  const searchEl = document.querySelector("#artist-modal .modal-artist-search");
  if (searchEl) searchEl.value = "";

  const oldBio = document.querySelector("#artist-modal .modal-bio-container");
  if (oldBio) oldBio.remove();

  artistModal.style.display = "flex";
  artistModal.classList.remove("hidden");
  artistModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  try {
    await loadArtistTracks(artistName, artistId);
    if (artistId) await loadArtistImage(artistId);
    updateSelectAllLabel();
  } catch (error) {
    console.error("Modal açılırken hata:", error);
  }
} else {
  abortAllFetches();
  clearSearchTimer();
  artistModal.style.display = "none";
  artistModal.classList.add("hidden");
  artistModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  currentModalArtist = { name: "", id: null };
 }
}

export function setupArtistClickHandler() {
  const artistElement = musicPlayerState.modernArtistEl;
  if (!artistElement) return;

  artistElement.style.cursor = "pointer";
  artistElement.addEventListener("click", async () => {
    const artistName = artistElement.textContent.trim();
    if (!artistName || artistName === config.languageLabels.artistUnknown) return;

    const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
    const artistId =
      currentTrack?.ArtistItems?.[0]?.Id ||
      currentTrack?.AlbumArtistId ||
      currentTrack?.ArtistId ||
      null;

    currentModalArtist = { name: artistName, id: artistId };
    await toggleArtistModal(true, artistName, artistId);
  });
}

async function showSaveToPlaylistModal() {
  if (selectedTrackIds.size === 0) {
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.noSelection || "Hiç şarkı seçilmedi"}`,
      3000,
      "warning"
    );
    return;
  }

  const modal = document.createElement("div");
  modal.className = "playlist-save-modal";

  const modalContent = document.createElement("div");
  modalContent.className = "playlist-save-modal-content";

  const modalHeader = document.createElement("div");
  modalHeader.className = "playlist-save-modal-header";

  const modalTitle = document.createElement("h3");
  modalTitle.textContent = config.languageLabels.saveToPlaylist || "Seçilenleri Kaydet";
  modalHeader.appendChild(modalTitle);

  const closeButton = document.createElement("span");
  closeButton.className = "playlist-save-modal-close";
  closeButton.innerHTML = '<i class="fas fa-times"></i>';
  closeButton.onclick = () => closeModal();
  modalHeader.appendChild(closeButton);

  const modalBody = document.createElement("div");
  modalBody.className = "playlist-save-modal-body";

  const nameInputContainer = document.createElement("div");
  nameInputContainer.className = "name-input-container";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = config.languageLabels.enterPlaylistName;

  const titleName = document.querySelector("#artist-modal .modal-artist-name")?.textContent || "";
  nameInput.value = `${titleName} - ${new Date().toLocaleString(config.dateLocale || "tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  nameInputContainer.appendChild(nameInput);

  const publicLabel = document.createElement("label");
  publicLabel.className = "public-checkbox-label";
  const publicCheckbox = document.createElement("input");
  publicCheckbox.type = "checkbox";
  publicCheckbox.id = "playlist-public";
  publicLabel.appendChild(publicCheckbox);
  publicLabel.appendChild(document.createTextNode(config.languageLabels.makePlaylistPublic));

  const actionContainer = document.createElement("div");
  actionContainer.className = "action-container";

  const newPlaylistOption = document.createElement("div");
  newPlaylistOption.className = "radio-option";
  const newPlaylistRadio = document.createElement("input");
  newPlaylistRadio.type = "radio";
  newPlaylistRadio.name = "saveAction";
  newPlaylistRadio.id = "new-playlist";
  newPlaylistRadio.value = "new";
  newPlaylistRadio.checked = true;
  newPlaylistRadio.onchange = togglePlaylistSelection;
  const newPlaylistLabel = document.createElement("label");
  newPlaylistLabel.htmlFor = "new-playlist";
  newPlaylistLabel.textContent = config.languageLabels.newPlaylist || "Yeni liste oluştur";
  newPlaylistOption.append(newPlaylistRadio, newPlaylistLabel);

  const existingPlaylistOption = document.createElement("div");
  existingPlaylistOption.className = "radio-option";
  const existingPlaylistRadio = document.createElement("input");
  existingPlaylistRadio.type = "radio";
  existingPlaylistRadio.name = "saveAction";
  existingPlaylistRadio.id = "existing-playlist";
  existingPlaylistRadio.value = "existing";
  existingPlaylistRadio.onchange = togglePlaylistSelection;
  const existingPlaylistLabel = document.createElement("label");
  existingPlaylistLabel.htmlFor = "existing-playlist";
  existingPlaylistLabel.textContent = config.languageLabels.addToExisting || "Mevcut listeye ekle";
  existingPlaylistOption.append(existingPlaylistRadio, existingPlaylistLabel);

  actionContainer.append(newPlaylistOption, existingPlaylistOption);

  const playlistSelectContainer = document.createElement("div");
  playlistSelectContainer.className = "playlist-select-container";
  playlistSelectContainer.style.display = "none";

  const playlistSelectLabel = document.createElement("label");
  playlistSelectLabel.textContent = config.languageLabels.selectPlaylist || "Liste seçin:";

  const playlistSelect = document.createElement("select");
  playlistSelect.className = "playlist-select";
  playlistSelect.disabled = true;

  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = config.languageLabels.loadingPlaylists || "Listeler getiriliyor...";
  playlistSelect.appendChild(loadingOption);

  playlistSelectContainer.append(playlistSelectLabel, playlistSelect);

  const selectedCountContainer = document.createElement("div");
  selectedCountContainer.className = "selected-count-container";
  selectedCountContainer.textContent = `${selectedTrackIds.size} ${config.languageLabels.tracksSelected || "şarkı seçildi"}`;

  modalBody.append(nameInputContainer, publicLabel, actionContainer, playlistSelectContainer, selectedCountContainer);

  const modalFooter = document.createElement("div");
  modalFooter.className = "playlist-save-modal-footer";

  const saveButton = document.createElement("button");
  saveButton.className = "playlist-save-modal-save";
  saveButton.textContent = config.languageLabels.save || "Kaydet";
  saveButton.onclick = async () => {
    const tracksToSave = allTracks.filter((t) => selectedTrackIds.has(t.Id));
    const isNew = newPlaylistRadio.checked;
    const playlistId = isNew ? null : playlistSelect.value;
    const playlistName = isNew ? nameInput.value : playlistSelect.options[playlistSelect.selectedIndex].text;

    try {
      await saveCurrentPlaylistToJellyfin(playlistName, publicCheckbox.checked, tracksToSave, isNew, playlistId);

      const message = isNew
        ? `<i class="fas fa-check-circle"></i> ${config.languageLabels.playlistCreatedSuccessfully} (${tracksToSave.length} ${config.languageLabels.track})`
        : `<i class="fas fa-check-circle"></i> ${tracksToSave.length} ${config.languageLabels.track} ${config.languageLabels.addingsuccessful}`;

      showNotification(message, 3000, "addlist");
      closeModal();
    } catch (err) {
      console.error(err);
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels.playlistSaveError}`,
        4000,
        "error"
      );
    }
  };

  modalFooter.appendChild(saveButton);
  modalContent.append(modalHeader, modalBody, modalFooter);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  loadExistingPlaylists(playlistSelect);

  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  nameInput.focus();

  const handleKeyDown = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", handleKeyDown);

  function togglePlaylistSelection() {
    const isNew = newPlaylistRadio.checked;
    nameInputContainer.style.display = isNew ? "block" : "none";
    playlistSelectContainer.style.display = isNew ? "none" : "block";
    publicLabel.style.display = isNew ? "block" : "none";
  }

  function closeModal() {
    document.removeEventListener("keydown", handleKeyDown);
    try { document.body.removeChild(modal); } catch {}
  }
}

async function loadExistingPlaylists(selectElement) {
  try {
    const playlists = await fetchJellyfinPlaylists();
    selectElement.innerHTML = "";

    if (!playlists.length) {
      const noPlaylistOption = document.createElement("option");
      noPlaylistOption.value = "";
      noPlaylistOption.textContent = config.languageLabels.noPlaylists || "Hiç çalma listesi bulunamadı";
      selectElement.appendChild(noPlaylistOption);
      selectElement.disabled = true;
      return;
    }

    playlists.sort((a, b) => a.name.localeCompare(b.name));
    playlists.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      selectElement.appendChild(opt);
    });
    selectElement.disabled = false;
  } catch (error) {
    console.error("Listeler yüklenirken hata:", error);
    selectElement.innerHTML = "";
    const errOpt = document.createElement("option");
    errOpt.value = "";
    errOpt.textContent = config.languageLabels.loadError || "Listeler yüklenemedi";
    selectElement.appendChild(errOpt);
    selectElement.disabled = true;
  }
}

function filterArtistTracks(query) {
  const q = (query || "").trim().toLowerCase();
  const modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  if (!q) {
    const artistName = modalEl.querySelector(".modal-artist-name")?.textContent || "";
    if (artistName === (config.languageLabels.allMusic || "Tüm Müzikler")) {
      loadAllMusicFromJellyfin();
    } else {
      const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
      const artistId =
        currentTrack?.ArtistItems?.[0]?.Id ||
        currentTrack?.AlbumArtistId ||
        currentTrack?.ArtistId ||
        null;
      loadArtistTracks(artistName, artistId);
    }
    return;
  }

  currentPage = 1;
  updatePaginationControls();
  displayPaginatedTracks();
  updateSelectAllLabel();
}
