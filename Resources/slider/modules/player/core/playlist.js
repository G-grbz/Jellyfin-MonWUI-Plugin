import { musicPlayerState, resetShuffle } from "./state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "./auth.js";
import { shuffleArray } from "../utils/domUtils.js";
import { showNotification } from "../ui/notification.js";
import { updateModernTrackInfo, playTrack } from "../player/playback.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";

const config = getConfig();
const BATCH_SIZE = config.gruplimit;
const EXCLUDED_LISTS_HISTORY = config.historylimit;

let excludedTrackHistory = new Set();
let currentRefreshCtrl = null;

export async function refreshPlaylist() {
  if (currentRefreshCtrl) {
    try { currentRefreshCtrl.abort(); } catch {}
  }
  currentRefreshCtrl = new AbortController();
  const { signal } = currentRefreshCtrl;

  try {
    resetShuffle();
    if (musicPlayerState.modernTitleEl) musicPlayerState.modernTitleEl.textContent = config.languageLabels.loading;
    if (musicPlayerState.modernArtistEl) musicPlayerState.modernArtistEl.textContent = "";

    const token = getAuthToken();
    if (!token) throw new Error(config.languageLabels.noApiToken);

    const genres = musicPlayerState.selectedGenres || [];
    let items = [];

    const headers = { "X-Emby-Token": token };
    const baseQuery = "IncludeItemTypes=Audio&Recursive=true&SortBy=Random";

    let totalItems = 0;
    try {
      const countResponse = await fetch(
        apiUrl(`/Items?${baseQuery}${genres.length > 0 ? `&Genres=${genres.map(encodeURIComponent).join(",")}` : ""}&Limit=1`),
        { headers, signal }
      );
      if (countResponse.ok) {
        const countData = await countResponse.json();
        totalItems = countData.TotalRecordCount || 0;
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      console.error("Toplam parça sayısı alınırken hata:", e);
    }

    const effectiveLimit = totalItems > 0
      ? Math.min(config.muziklimit, Math.max(0, totalItems - excludedTrackHistory.size))
      : config.muziklimit;

    if (effectiveLimit <= 0) {
      showNotification(
        `<i class="fas fa-info-circle"></i> ${config.languageLabels.noTracksAvailable}`,
        2000,
        "info"
      );
      return;
    }

    const chunkArray = (array, chunkSize) => {
      const chunks = [];
      for (let i = 0; i < array.length; i += chunkSize) chunks.push(array.slice(i, i + chunkSize));
      return chunks;
    };

    const excludedIds = Array.from(excludedTrackHistory);
    const excludedIdChunks = chunkArray(excludedIds, config.maxExcludeIdsForUri || 100);

    if (genres.length > 0) {
      const perGenreLimit = Math.floor(effectiveLimit / genres.length) || 1;
      const initialFetches = genres.flatMap((genre) => {
        if (excludedIdChunks.length === 0) {
          return fetch(
            apiUrl(`/Items?${baseQuery}&Limit=${perGenreLimit}&Genres=${encodeURIComponent(genre)}`),
            { headers, signal }
          )
            .then((r) => {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .then((d) => d.Items || [])
            .catch((e) => {
              if (e.name === "AbortError") return [];
              return [];
            });
        }
        return excludedIdChunks.map((chunk) => {
          const excludeIdsParam = `&ExcludeItemIds=${chunk.join(",")}`;
          return fetch(
            apiUrl(`/Items?${baseQuery}&Limit=${Math.ceil(perGenreLimit / excludedIdChunks.length)}&Genres=${encodeURIComponent(genre)}${excludeIdsParam}`),
            { headers, signal }
          )
            .then((r) => {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .then((d) => d.Items || [])
            .catch((e) => {
              if (e.name === "AbortError") return [];
              return [];
            });
        });
      });

      const initialResults = await Promise.all(initialFetches);
      items = initialResults.flat();
      const seenIds = new Set();
      items = items.filter((it) => {
        if (seenIds.has(it.Id) || excludedTrackHistory.has(it.Id)) return false;
        seenIds.add(it.Id);
        return true;
      });
      let remainder = effectiveLimit - items.length;
      while (remainder > 0) {
        let added = false;
        for (const genre of genres) {
          if (remainder <= 0) break;

          const currentExcludeIds = Array.from(new Set([...seenIds, ...excludedTrackHistory]));
          const currentExcludeChunks = chunkArray(currentExcludeIds, config.maxExcludeIdsForUri || 100);

          for (const chunk of currentExcludeChunks) {
            if (remainder <= 0) break;

            const excludeParam = chunk.length > 0 ? `&ExcludeItemIds=${chunk.join(",")}` : "";
            const url = `/Items?${baseQuery}&Limit=1&Genres=${encodeURIComponent(genre)}${excludeParam}`;

            try {
              const resp = await fetch(apiUrl(url), { headers, signal });
              if (!resp.ok) continue;
              const { Items = [] } = await resp.json();
              const [track] = Items;
              if (track && !seenIds.has(track.Id) && !excludedTrackHistory.has(track.Id)) {
                items.push(track);
                seenIds.add(track.Id);
                remainder--;
                added = true;
              }
            } catch (e) {
              if (e.name === "AbortError") return;
            }
          }
        }
        if (!added) break;
      }

      items = items.slice(0, effectiveLimit);

      showNotification(
        `<i class="fas fa-masks-theater"></i> ${genres.length} ${config.languageLabels.genresApplied} ${items.length}/${effectiveLimit} ${config.languageLabels.tracks}`,
        2000,
        "tur"
      );
    } else {
      if (excludedIdChunks.length === 0) {
        const resp = await fetch(apiUrl(`/Items?${baseQuery}&Limit=${effectiveLimit}`), { headers, signal });
        if (!resp.ok) throw new Error(config.languageLabels.unauthorizedRequest);
        const data = await resp.json();
        items = data.Items || [];
      } else {
        const limitPerChunk = Math.ceil(effectiveLimit / excludedIdChunks.length);
        const chunkRequests = excludedIdChunks.map((chunk) => {
          const excludeIdsParam = `&ExcludeItemIds=${chunk.join(",")}`;
          return fetch(apiUrl(`/Items?${baseQuery}&Limit=${limitPerChunk}${excludeIdsParam}`), { headers, signal })
            .then((r) => {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .then((d) => d.Items || [])
            .catch((e) => {
              if (e.name === "AbortError") return [];
              return [];
            });
        });

        const chunkResults = await Promise.all(chunkRequests);
        items = chunkResults.flat().slice(0, effectiveLimit);
      }
    }

    const newTrackIds = items.map((track) => track.Id);
    updateExcludedTrackHistory(newTrackIds);
    musicPlayerState.playlist = items;
    musicPlayerState.originalPlaylist = [...items];
    musicPlayerState.effectivePlaylist = [...items];

    if (items.length > 0) {
      if (signal.aborted) return;
      playTrack(0);
    } else {
      showNotification(
        `<i class="fas fa-info-circle"></i> ${
          genres.length ? config.languageLabels.noTracksForSelectedGenres : config.languageLabels.noTracks
        }`,
        2000,
        "info"
      );
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return;
    }
    console.error("Liste yenilenirken hata:", err);
    if (musicPlayerState.modernTitleEl) musicPlayerState.modernTitleEl.textContent = config.languageLabels.errorOccurred;
    if (musicPlayerState.modernArtistEl) {
      musicPlayerState.modernArtistEl.textContent = err.message?.includes("abort")
        ? config.languageLabels.requestTimeout
        : config.languageLabels.tryRefreshing;
    }
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${
        config.languageLabels.refreshError || "Liste yenilenirken hata oluştu"
      }`,
      3000,
      "error"
    );
  } finally {
    if (currentRefreshCtrl && currentRefreshCtrl.signal === signal) {
      currentRefreshCtrl = null;
    }
  }
}

function updateExcludedTrackHistory(newTrackIds) {
  newTrackIds.forEach((id) => excludedTrackHistory.add(id));

  const maxExcludedTracks = EXCLUDED_LISTS_HISTORY * config.muziklimit;

  if (excludedTrackHistory.size > maxExcludedTracks) {
    const allIds = Array.from(excludedTrackHistory);
    const idsToKeep = allIds.slice(allIds.length - maxExcludedTracks);
    excludedTrackHistory = new Set(idsToKeep);
  }
}

async function addItemsToPlaylist(playlistId, itemIds, userId) {
  const token = getAuthToken();
  const idsQueryParam = itemIds.join(",");

  try {
    const response = await fetch(
      apiUrl(`/Playlists/${playlistId}/Items?ids=${idsQueryParam}&userId=${userId}`),
      {
        method: "POST",
        headers: {
          "X-Emby-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 204) {
      return { success: true, message: "Parçalar başarıyla eklendi" };
    }

    if (response.status === 401) {
      throw new Error(config.languageLabels.unauthorizedAccess);
    } else if (response.status === 403) {
      throw new Error(config.languageLabels.accessForbidden);
    } else if (response.status === 404) {
      throw new Error(config.languageLabels.playlistNotFound);
    } else if (!response.ok) {
      throw new Error(config.languageLabels.serverError.replace("{0}", response.status));
    }
  } catch (error) {
    console.error("Çalma listesine parça eklenirken hata:", error);
    throw error;
  }
}

export async function removeItemsFromPlaylist(playlistId, itemIds) {
  const token = getAuthToken();
  const idsParam = itemIds.join(",");
  const url = `/Playlists/${playlistId}/Items?entryIds=${idsParam}`;

  const res = await fetch(apiUrl(url), {
    method: "DELETE",
    headers: {
      "X-Emby-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    console.error("removeItemsFromPlaylist hata detayı:", details);
    throw new Error(`Silme işlemi başarısız: HTTP ${res.status}${details ? ` – ${details}` : ""}`);
  }

  return { success: true };
}

async function getPlaylistItems(playlistId) {
  const token = getAuthToken();
  const response = await fetch(apiUrl(`/Playlists/${playlistId}/Items`), {
    headers: {
      "X-Emby-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Çalma listesi öğeleri alınamadı");
  }

  const data = await response.json();
  return data.Items || [];
}

export async function saveCurrentPlaylistToJellyfin(
  playlistName,
  makePublic = false,
  tracksToSave = [],
  isNew = true,
  existingPlaylistId = null
) {
  const token = getAuthToken();
  if (!token) {
    showNotification(
      `<i class="fas fa-lock"></i> ${config.languageLabels.noApiToken}`,
      3000,
      "error"
    );
    throw new Error("API anahtarı bulunamadı");
  }

  if (!Array.isArray(tracksToSave) || tracksToSave.length === 0) {
    showNotification(
      `<i class="fas fa-info-circle"></i> ${config.languageLabels.noTracksToSave}`,
      2000,
      "addlist"
    );
    return;
  }

  const itemIds = tracksToSave.map((track) => track.Id);
  const userId = window.ApiClient.getCurrentUserId();

  try {
    if (!isNew && existingPlaylistId) {
      const existingItems = await getPlaylistItems(existingPlaylistId);
      const existingItemIds = new Set(existingItems.map((item) => item.Id));

      const alreadyInPlaylist = tracksToSave.filter((track) => existingItemIds.has(track.Id));
      const tracksToActuallyAdd = tracksToSave.filter((track) => !existingItemIds.has(track.Id));

      if (alreadyInPlaylist.length > 0) {
        const names = alreadyInPlaylist.map((track) => track.Name);
        let displayNames = "";

        if (names.length > 5) {
          const firstThree = names.slice(0, 3).join(", ");
          const remainingCount = names.length - 3;
          displayNames = `${firstThree} ${config.languageLabels.ayrica} ${remainingCount} ${config.languageLabels.moreTracks}`;
        } else {
          displayNames = names.join(", ");
        }

        showNotification(
          `<i class="fas fa-info-circle"></i> ${
            config.languageLabels.alreadyInPlaylist
          } (${alreadyInPlaylist.length}): ${displayNames}`,
          4000,
          "addlist"
        );
      }

      if (tracksToActuallyAdd.length > 0) {
        const idsToAdd = tracksToActuallyAdd.map((track) => track.Id);

        for (let i = 0; i < idsToAdd.length; i += BATCH_SIZE) {
          const batch = idsToAdd.slice(i, i + BATCH_SIZE);
          await addItemsToPlaylist(existingPlaylistId, batch, userId);
        }

        showNotification(
          `<i class="fas fa-check-circle"></i> ${config.languageLabels.addingsuccessful}`,
          2000,
          "addlist"
        );
      } else {
        showNotification(
          `<i class="fas fa-info-circle"></i> ${config.languageLabels.noTracksToSave}`,
          2000,
          "addlist"
        );
      }
      return { success: true };
    } else {
      const createResponse = await fetch(apiUrl("/Playlists"), {
        method: "POST",
        headers: {
          "X-Emby-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Name: playlistName || `Yeni Çalma Listesi ${new Date().toLocaleString()}`,
          Ids: itemIds,
          UserId: userId,
          IsPublic: makePublic,
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.json().catch(() => ({}));
        throw new Error(error.Message || config.languageLabels.playlistCreateFailed);
      }
      const result = await createResponse.json();
      showNotification(
        `<i class="fas fa-check-circle"></i> ${config.languageLabels.playlistCreatedSuccessfully}`,
        2000,
        "addlist"
      );
      return result;
    }
  } catch (err) {
    console.error("Çalma listesi işlemi başarısız:", err);
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${err.message} ${config.languageLabels.playlistSaveError}`,
      3000,
      "error"
    );
    throw err;
  }
}
