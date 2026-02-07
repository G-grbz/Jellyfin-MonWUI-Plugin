import { getAuthToken } from "./auth.js";
import { showNotification } from "../ui/notification.js";
import { musicPlayerState, resetShuffle } from "./state.js";
import { getConfig } from "../../config.js";
import { playTrack } from "../player/playback.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { toggleArtistModal } from "../ui/artistModal.js";
import { makeCleanupBag, addEvent, trackTimeout } from "../utils/cleanup.js";
import { withServer, withParams } from "../../jfUrl.js";

const config = getConfig();

let isPlaylistModalOpen = false;
let modalElement = null;
let backdropElement = null;
let modalBag = null;

export async function fetchJellyfinPlaylists() {
  const authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      `<i class="fas fa-lock"></i> ${config.languageLabels.authRequired}`,
      2000,
      "warning"
    );
    return [];
  }

  try {
    const userId = window.ApiClient.getCurrentUserId();
    const response = await fetch(
      withParams(`/Users/${userId}/Items`, {
        Recursive: "true",
        IncludeItemTypes: "Playlist",
        Fields: "PrimaryImageAspectRatio",
        StartIndex: 0,
      }),
      { headers: { "X-Emby-Token": authToken } }
    );

    if (!response.ok) {
      throw new Error(`HTTP hata durumu: ${response.status}`);
    }

    const data = await response.json();
    return (data.Items || []).map((item) => ({
      id: item.Id,
      name: item.Name,
      childCount: item.ChildCount || 0,
      imageTag: item.ImageTags?.Primary || null
    }));
  } catch (error) {
    console.error("Çalma listesi getirme hatası:", error);
    showNotification(
      `<i class="fas fa-regular fa-hexagon-exclamation"></i> ${config.languageLabels.playlistFetchError}`,
      2000,
      "error"
    );
    return [];
  }
}

function getStreamUrl(itemId) {
  const authToken = getAuthToken();
  return withParams(`/Audio/${itemId}/stream.mp3`, {
    Static: "true",
    api_key: authToken,
  });
}

export async function playJellyfinPlaylist(playlistId) {
  const authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      `<i class="fas fa-lock"></i> ${config.languageLabels.authRequired}`,
      2000,
      "warning"
    );
    return;
  }

  try {
    const userId = window.ApiClient.getCurrentUserId();
    const playlistResponse = await fetch(
      withParams(`/Playlists/${playlistId}/Items`, {
        UserId: userId,
        Fields: "PrimaryImageAspectRatio,MediaSources,Chapters,ArtistItems,AlbumArtist,Album,Genres",
      }),
      { headers: { "X-Emby-Token": authToken } }
    );

    if (!playlistResponse.ok) throw new Error(`HTTP error! status: ${playlistResponse.status}`);

    const data = await playlistResponse.json();
    const items = data.Items || [];

    if (!items.length) {
      showNotification(
        `<i class="fas fa-info-circle"></i> ${config.languageLabels.emptyPlaylist}`,
        2000,
        "info"
      );
      return;
    }

    const playlist = items.map((item) => ({
      Id: item.Id,
      Name: item.Name,
      Artists: item.ArtistItems?.map((a) => a.Name) || (item.AlbumArtist ? [item.AlbumArtist] : []),
      AlbumArtist: item.AlbumArtist,
      Album: item.Album,
      AlbumId: item.AlbumId,
      IndexNumber: item.IndexNumber,
      ProductionYear: item.ProductionYear,
      RunTimeTicks: item.RunTimeTicks,
      AlbumPrimaryImageTag: item.AlbumPrimaryImageTag || item.ImageTags?.Primary,
      PrimaryImageTag: item.ImageTags?.Primary,
      mediaSource: getStreamUrl(item.Id),
      jellyfinItem: item,
      ArtistId: item.ArtistItems?.[0]?.Id || null
    }));

    musicPlayerState.playlist = playlist;
    musicPlayerState.currentIndex = 0;
    musicPlayerState.playlistSource = "jellyfin";
    musicPlayerState.currentPlaylistId = playlistId;
    musicPlayerState.originalPlaylist = [...playlist];
    musicPlayerState.currentAlbumName = playlist[0]?.Album || config.languageLabels.unknownAlbum;
    musicPlayerState.currentTrackName = playlist[0]?.Name || config.languageLabels.unknownTrack;
    const artistElement = musicPlayerState.modernArtistEl;
    if (artistElement) {
      artistElement.style.cursor = "pointer";
      const bag = makeCleanupBag(artistElement);
      const onClick = async () => {
        const artistName = artistElement.textContent.trim();
        if (artistName && artistName !== config.languageLabels.artistUnknown) {
          const currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
          const artistId =
            currentTrack.ArtistId ||
            currentTrack?.ArtistItems?.[0]?.Id ||
            currentTrack?.AlbumArtistId ||
            currentTrack?.ArtistId ||
            null;
        }
      };
      addEvent(bag, artistElement, "click", onClick);
    }

    updatePlaylistModal();
    resetShuffle();
    showNotification(
      `<i class="fas fa-solid fa-guitars"></i> ${items.length} ${config.languageLabels.tracks}`,
      2000,
      "kontrol"
    );

    playTrack(0);
  } catch (error) {
    console.error("Çalma listesi oynatma hatası:", error);
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.playlistPlayError}`,
      2000,
      "error"
    );
  }
}

export async function showJellyfinPlaylistsModal() {
  if (isPlaylistModalOpen) {
    closeModal();
    return;
  }

  const playlists = await fetchJellyfinPlaylists();
  if (!playlists.length) {
    showNotification(
      `<i class="fas fa-info-circle"></i> ${config.languageLabels.noPlaylistsFound}`,
      2000,
      "info"
    );
    return;
  }

  isPlaylistModalOpen = true;

  modalElement = document.createElement("div");
  modalElement.className = "jellyfin-playlist-modal";

  backdropElement = document.createElement("div");
  backdropElement.className = "jellyfin-playlist-modal__backdrop";

  modalBag = makeCleanupBag(modalElement);

  const title = document.createElement("h3");
  title.className = "jellyfin-playlist-modal__title";
  title.textContent = config.languageLabels.selectPlaylist;
  modalElement.appendChild(title);

  const list = document.createElement("div");
  list.className = "jellyfin-playlist-modal__list";

  playlists.forEach((pl) => {
    const item = document.createElement("div");
    item.className = "jellyfin-playlist-item";

    if (pl.imageTag) {
      const img = document.createElement("img");
      img.className = "jellyfin-playlist-item__image";
      img.src = withParams(`/Items/${pl.id}/Images/Primary`, {
        maxHeight: 50,
        quality: 85,
        api_key: getAuthToken(),
      });
      item.appendChild(img);
    }

    const info = document.createElement("div");
    info.className = "jellyfin-playlist-item__info";

    const name = document.createElement("div");
    name.className = "jellyfin-playlist-item__name";
    name.textContent = pl.name;

    const count = document.createElement("div");
    count.className = "jellyfin-playlist-item__count";
    count.textContent = `${pl.childCount} ${config.languageLabels.tracks}`;

    info.append(name, count);
    item.appendChild(info);

    const deleteBtn = document.createElement("div");
    deleteBtn.className = "jellyfin-playlist-item__delete";
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.title = config.languageLabels.deletePlaylist;

    addEvent(modalBag, deleteBtn, "click", (e) => {
      e.stopPropagation();
      showDeleteConfirmModal(pl.id, async () => {
        const success = await deleteJellyfinPlaylist(pl.id);
        if (success) {
          item.remove();
          showNotification(
            `<i class="fas fa-check-circle"></i> ${config.languageLabels.playlistDeleted}`,
            2000,
            "success"
          );
        }
      });
    });

    item.appendChild(deleteBtn);
    addEvent(modalBag, item, "click", (e) => {
   if (!e.target.closest(".jellyfin-playlist-item__delete")) {
     closeModal(() => playJellyfinPlaylist(pl.id));
   }
 });

    list.appendChild(item);
  });

  modalElement.appendChild(list);

  const closeBtn = document.createElement("div");
  closeBtn.className = "jellyfin-playlist-modal__close-btn";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.title = config.languageLabels.close;
  addEvent(modalBag, closeBtn, "click", closeModal);
  modalElement.appendChild(closeBtn);
  addEvent(modalBag, backdropElement, "click", (e) => {
    if (e.target === backdropElement) closeModal();
  });
  addEvent(modalBag, modalElement, "click", (e) => e.stopPropagation());

  const onEsc = (e) => { if (e.key === "Escape") closeModal(); };
  const onDocClick = (e) => { if (modalElement && !modalElement.contains(e.target)) closeModal(); };
  addEvent(modalBag, document, "keydown", onEsc);
  addEvent(modalBag, document, "click", onDocClick);

  document.body.appendChild(backdropElement);
  document.body.appendChild(modalElement);
  modalElement.tabIndex = -1;
  modalElement.focus();
}

function closeModal(onClosed) {
  if (!isPlaylistModalOpen) return;
  modalElement?.classList.add("jellyfin-playlist-modal");
  backdropElement?.classList.add("jellyfin-playlist-modal__backdrop--closing");
  const id = setTimeout(() => {
    try {
      if (modalBag) modalBag.run();
    } catch {}
    try { modalElement?.parentNode?.removeChild(modalElement); } catch {}
    try { backdropElement?.parentNode?.removeChild(backdropElement); } catch {}

    isPlaylistModalOpen = false;
    modalElement = null;
    backdropElement = null;
    modalBag = null;
    if (typeof onClosed === "function") {
      try { onClosed(); } catch {}
    }
  }, 300);

  if (modalBag) trackTimeout(modalBag, id);
}

async function deleteJellyfinPlaylist(playlistId) {
  const authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      `<i class="fas fa-lock"></i> ${config.languageLabels.authRequired}`,
      2000,
      "warning"
    );
    return false;
  }

  try {
    const response = await fetch(
      withServer(`/Items/${playlistId}`),
      { method: "DELETE", headers: { "X-Emby-Token": authToken } }
    );

    if (!response.ok) {
      const _text = await response.text();
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.playlistDeleteError}`,
      2000,
      "error"
    );
    return false;
  }
}

function showDeleteConfirmModal(playlistId, onConfirm) {
  const confirmBackdrop = document.createElement("div");
  confirmBackdrop.className = "jellyfin-confirm-modal__backdrop";

  const confirmModal = document.createElement("div");
  confirmModal.className = "jellyfin-confirm-modal";

  const confirmBag = makeCleanupBag(confirmModal);

  const message = document.createElement("p");
  message.className = "jellyfin-confirm-modal__message";
  message.textContent = config.languageLabels.confirmDeletePlaylist;

  const buttons = document.createElement("div");
  buttons.className = "jellyfin-confirm-modal__buttons";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = config.languageLabels.no;
  cancelBtn.className = "jellyfin-btn jellyfin-btn--cancel";
  addEvent(confirmBag, cancelBtn, "click", (e) => {
    e.stopPropagation();
    try { confirmBag.run(); } catch {}
    try { document.body.removeChild(confirmBackdrop); } catch {}
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = config.languageLabels.yes;
  deleteBtn.className = "jellyfin-btn jellyfin-btn--delete";
  addEvent(confirmBag, deleteBtn, "click", async (e) => {
    e.stopPropagation();
    try { confirmBag.run(); } catch {}
    try { document.body.removeChild(confirmBackdrop); } catch {}
    await onConfirm();
  });

  buttons.append(deleteBtn, cancelBtn);
  confirmModal.append(message, buttons);
  confirmBackdrop.appendChild(confirmModal);

  addEvent(confirmBag, confirmBackdrop, "click", (e) => {
    e.stopPropagation();
    if (e.target === confirmBackdrop) {
      try { confirmBag.run(); } catch {}
      try { document.body.removeChild(confirmBackdrop); } catch {}
    }
  });

  addEvent(confirmBag, confirmModal, "click", (e) => e.stopPropagation());

  document.body.appendChild(confirmBackdrop);
}
