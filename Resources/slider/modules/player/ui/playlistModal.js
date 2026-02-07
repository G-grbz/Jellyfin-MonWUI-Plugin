import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { showNotification } from "../ui/notification.js";
import { playTrack } from "../player/playback.js";
import { saveCurrentPlaylistToJellyfin, removeItemsFromPlaylist } from "../core/playlist.js";
import { fetchJellyfinPlaylists } from "../core/jellyfinPlaylists.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { showGenreFilterModal } from "./genreFilterModal.js";
import { withServer, withParams } from "../../jfUrl.js";
import { getAuthToken } from "../core/auth.js";

const config = getConfig();

let playlistItemsObserver = null;
let outsideClickListener = null;

export function createPlaylistModal() {
  const modal = document.createElement("div");
  modal.id = "playlist-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  const container = document.createElement("div");
  container.className = "playlist-container";

  const header = document.createElement("div");
  header.className = "playlist-header";

  const title = document.createElement("h3");
  title.className = "playlist-title";
  title.textContent = config.languageLabels.playlist;
  title.id = "playlist-modal-title";

  const closeBtn = document.createElement("button");
  closeBtn.className = "playlist-close";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.title = config.languageLabels.close || "Kapat";
  closeBtn.setAttribute("aria-label", "Close playlist");
  closeBtn.onclick = togglePlaylistModal;

  const selectAllBtn = document.createElement("button");
  selectAllBtn.className = "playlist-select-all";
  selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
  selectAllBtn.title = config.languageLabels.selectAll || "Tümünü Seç/Bırak";
  selectAllBtn.setAttribute("aria-label", "Select all tracks");
  selectAllBtn.onclick = (e) => {
    e.stopPropagation();
    toggleSelectAll();
  };

  const saveBtn = document.createElement("button");
  saveBtn.className = "playlist-save";
  saveBtn.innerHTML = '<i class="fas fa-save"></i>';
  saveBtn.title = config.languageLabels.savePlaylist;
  saveBtn.setAttribute("aria-label", "Save playlist");
  saveBtn.onclick = showSaveModal;

  const searchContainer = document.createElement("div");
  searchContainer.className = "playlist-search-container";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = config.languageLabels.searchTracks;
  searchInput.className = "playlist-search-input";
  searchInput.id = "playlist-search-input";
  searchInput.name = "playlist-search";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("aria-labelledby", "playlist-modal-title");
  searchInput.setAttribute("aria-label", "Search in playlist");

  searchInput.addEventListener("input", (e) => {
    filterPlaylistItems(e.target.value.toLowerCase());
  });

  searchContainer.appendChild(searchInput);

  const removeSelectedBtn = document.createElement("button");
  removeSelectedBtn.className = "playlist-remove-selected";
  removeSelectedBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  removeSelectedBtn.title = config.languageLabels.removeSelected || "Seçilenleri Kaldır";
  removeSelectedBtn.setAttribute("aria-label", "Remove selected tracks");
  removeSelectedBtn.onclick = (e) => {
    e.stopPropagation();
    showRemoveSelectedConfirmModal();
  };

  const headerButtons = document.createElement("div");
  headerButtons.className = "playlist-header-buttons";
  headerButtons.appendChild(selectAllBtn);
  headerButtons.appendChild(removeSelectedBtn);
  headerButtons.appendChild(saveBtn);
  headerButtons.appendChild(closeBtn);

  const itemsContainer = document.createElement("div");
  itemsContainer.className = "playlist-items";
  itemsContainer.setAttribute("role", "list");
  itemsContainer.setAttribute("aria-label", "Playlist items");

  header.appendChild(title);
  header.appendChild(headerButtons);

  container.appendChild(searchContainer);
  container.appendChild(header);
  container.appendChild(itemsContainer);
  modal.appendChild(container);
  document.body.appendChild(modal);

  musicPlayerState.playlistModal = modal;
  musicPlayerState.playlistItemsContainer = itemsContainer;
  musicPlayerState.playlistSearchInput = searchInput;
  musicPlayerState.selectedTracks = new Set();
}

function updateSelectAllBtnState() {
  const itemsCount = musicPlayerState.playlistItemsContainer
    .querySelectorAll(".playlist-item").length;
  const selectedCount = musicPlayerState.selectedTracks.size;
  const selectAllBtn = document.querySelector(".playlist-select-all");
  if (!selectAllBtn) return;

  const allSelected = selectedCount === itemsCount && itemsCount > 0;
  if (allSelected) {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-minus"></i>';
    selectAllBtn.title = config.languageLabels.deselectAll || "Seçimi Kaldır";
  } else {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Tümünü Seç";
  }
}

async function showSaveModal() {
  const selectedCount = musicPlayerState.selectedTracks.size;
  const saveSelected = selectedCount > 0;

  const modal = document.createElement("div");
  modal.className = "playlist-save-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  const modalContent = document.createElement("div");
  modalContent.className = "playlist-save-modal-content";

  const modalHeader = document.createElement("div");
  modalHeader.className = "playlist-save-modal-header";

  const modalTitle = document.createElement("h3");
  modalTitle.textContent = config.languageLabels.savePlaylist;
  modalTitle.id = "save-modal-title";
  modalHeader.appendChild(modalTitle);

  const closeButton = document.createElement("div");
  closeButton.className = "playlist-save-modal-close";
  closeButton.innerHTML = '<i class="fas fa-times"></i>';
  closeButton.setAttribute("aria-label", "Close save dialog");
  closeButton.onclick = () => closeModal();
  modalHeader.appendChild(closeButton);

  const modalBody = document.createElement("div");
  modalBody.className = "playlist-save-modal-body";

  const nameInputContainer = document.createElement("div");
  nameInputContainer.className = "name-input-container";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = config.languageLabels.enterPlaylistName;
  nameInput.id = "playlist-name-input";
  nameInput.value = `GMMP Oynatma Listesi ${new Date().toLocaleString(config.dateLocale || 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })}`;
  nameInput.setAttribute("aria-labelledby", "save-modal-title");
  nameInputContainer.appendChild(nameInput);

  const publicLabel = document.createElement("label");
  publicLabel.className = "public-checkbox-label";
  publicLabel.htmlFor = "playlist-public";
  const publicCheckbox = document.createElement("input");
  publicCheckbox.type = "checkbox";
  publicCheckbox.id = "playlist-public";
  publicCheckbox.name = "playlist-public";
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
  newPlaylistOption.appendChild(newPlaylistRadio);
  newPlaylistOption.appendChild(newPlaylistLabel);

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
  existingPlaylistOption.appendChild(existingPlaylistRadio);
  existingPlaylistOption.appendChild(existingPlaylistLabel);

  actionContainer.appendChild(newPlaylistOption);
  actionContainer.appendChild(existingPlaylistOption);

  const playlistSelectContainer = document.createElement("div");
  playlistSelectContainer.className = "playlist-select-container";
  playlistSelectContainer.style.display = "none";

  const playlistSelectLabel = document.createElement("label");
  playlistSelectLabel.textContent = config.languageLabels.selectPlaylist || "Liste seçin:";
  playlistSelectLabel.htmlFor = "existing-playlist-select";

  const playlistSelect = document.createElement("select");
  playlistSelect.className = "playlist-select";
  playlistSelect.id = "existing-playlist-select";
  playlistSelect.name = "existing-playlist-select";
  playlistSelect.disabled = true;

  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = config.languageLabels.loadingPlaylists || "Listeler yükleniyor...";
  playlistSelect.appendChild(loadingOption);

  playlistSelectContainer.appendChild(playlistSelectLabel);
  playlistSelectContainer.appendChild(playlistSelect);

  const selectedOnlyContainer = document.createElement("div");
  selectedOnlyContainer.className = "selected-only-container";
  const selectedOnlyCheckbox = document.createElement("input");
  selectedOnlyCheckbox.type = "checkbox";
  selectedOnlyCheckbox.id = "selected-only";
  selectedOnlyCheckbox.name = "selected-only";
  selectedOnlyCheckbox.checked = saveSelected;
  selectedOnlyCheckbox.disabled = (selectedCount === 0);
  const selectedOnlyLabel = document.createElement("label");
  selectedOnlyLabel.htmlFor = "selected-only";
  selectedOnlyLabel.textContent = saveSelected
    ? `${config.languageLabels.saveSelected || "Seçilenleri kaydet"} (${selectedCount})`
    : config.languageLabels.noSelection || "Hiç parça seçilmediii";
  selectedOnlyContainer.appendChild(selectedOnlyCheckbox);
  selectedOnlyContainer.appendChild(selectedOnlyLabel);

  modalBody.appendChild(nameInputContainer);
  modalBody.appendChild(publicLabel);
  modalBody.appendChild(actionContainer);
  modalBody.appendChild(playlistSelectContainer);
  modalBody.appendChild(selectedOnlyContainer);

  const modalFooter = document.createElement("div");
  modalFooter.className = "playlist-save-modal-footer";

  const saveButton = document.createElement("button");
  saveButton.className = "playlist-save-modal-save";
  saveButton.textContent = config.languageLabels.kaydet;
  saveButton.onclick = async () => {
    const selectedIdx = Array.from(musicPlayerState.selectedTracks);
    const tracksToSave = selectedOnlyCheckbox.checked
      ? selectedIdx.map(i => musicPlayerState.playlist[i])
      : musicPlayerState.playlist;

    const isNew = newPlaylistRadio.checked;
    const playlistId = isNew ? null : playlistSelect.value;
    const playlistName = isNew
      ? nameInput.value
      : playlistSelect.options[playlistSelect.selectedIndex].text;

    try {
      await saveCurrentPlaylistToJellyfin(
        playlistName,
        publicCheckbox.checked,
        tracksToSave,
        isNew,
        playlistId
      );
      showNotification(
        `<i class="fas fa-check-circle"></i> ${config.languageLabels.playlistCreatedSuccessfully || "Liste kaydedildi"}`,
        2500,
        'addlist'
      );
      closeModal();
    } catch (err) {
      console.error(err);
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels.playlistSaveError || "Liste kaydedilemedi"}`,
        3000,
        'error'
      );
    }
  };

  modalFooter.appendChild(saveButton);
  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalContent.appendChild(modalFooter);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  loadExistingPlaylists(playlistSelect);

  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  nameInput.focus();

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
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
    selectElement.innerHTML = '';

    if (playlists.length === 0) {
      const noPlaylistOption = document.createElement("option");
      noPlaylistOption.value = "";
      noPlaylistOption.textContent = config.languageLabels.noPlaylists || "Hiç çalma listesi bulunamadı";
      selectElement.appendChild(noPlaylistOption);
      selectElement.disabled = true;
      return;
    }

    playlists.sort((a, b) => a.name.localeCompare(b.name));

    playlists.forEach(playlist => {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = playlist.name;
      selectElement.appendChild(option);
    });

    selectElement.disabled = false;
  } catch (error) {
    console.error("Listeler yüklenirken hata:", error);
    selectElement.innerHTML = '';

    const errorOption = document.createElement("option");
    errorOption.value = "";
    errorOption.textContent = config.languageLabels.loadError || "Listeler yüklenemedi";
    selectElement.appendChild(errorOption);
    selectElement.disabled = true;
  }
}

function toggleSelectAll() {
  const itemsContainer = musicPlayerState.playlistItemsContainer;
  const items = itemsContainer.querySelectorAll(".playlist-item");
  const checkboxes = itemsContainer.querySelectorAll(".playlist-item-checkbox");
  const selectAllBtn = document.querySelector(".playlist-select-all");

  const allSelected = items.length === musicPlayerState.selectedTracks.size;

  if (allSelected) {
    musicPlayerState.selectedTracks.clear();
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      checkbox.parentElement.classList.remove("selected");
    });
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Tümünü Seç";
  } else {
    musicPlayerState.selectedTracks = new Set([...Array(items.length).keys()]);
    checkboxes.forEach((checkbox) => {
      checkbox.checked = true;
      checkbox.parentElement.classList.add("selected");
    });
    selectAllBtn.innerHTML = '<i class="fa-solid fa-minus"></i>';
    selectAllBtn.title = config.languageLabels.deselectAll || "Seçimi Kaldır";
  }
  updateSelectAllBtnState();
}

export function togglePlaylistModal(e) {
  const modal = musicPlayerState.playlistModal;
  if (!modal) return;

  if (modal.style.display === "flex") {
    modal.style.display = "none";
    removeOutsideClickListener();
    disconnectItemsObserver();
    resetSelectionState();
  } else {
    updatePlaylistModal();
    modal.style.display = "flex";

    if (e) {
      const x = e.clientX;
      const y = e.clientY;
      const modalWidth = 300;
      const modalHeight = 400;
      const left = Math.min(x, window.innerWidth - modalWidth - 20);
      const top = Math.min(y, window.innerHeight - modalHeight - 20);
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
    } else {
      modal.style.left = "";
      modal.style.top = "";
    }

    setTimeout(() => {
      const activeItem = musicPlayerState.playlistItemsContainer.querySelector(".playlist-item.active");
      if (activeItem) {
        activeItem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 0);

    addOutsideClickListener();
  }
}

function resetSelectionState() {
  musicPlayerState.selectedTracks.clear();
  const checkboxes = document.querySelectorAll(".playlist-item-checkbox");
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
    checkbox.parentElement.classList.remove("selected");
  });
  const selectAllBtn = document.querySelector(".playlist-select-all");
  if (selectAllBtn) {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Tümünü Seç";
  }
}

function addOutsideClickListener() {
  if (outsideClickListener) return;

  outsideClickListener = (event) => {
    const playlistModal = musicPlayerState.playlistModal;
    const saveModal = document.querySelector('.playlist-save-modal');
    if (
      (playlistModal && playlistModal.contains(event.target)) ||
      (saveModal && saveModal.contains(event.target))
    ) {
      return;
    }

    playlistModal.style.display = 'none';
    removeOutsideClickListener();
    disconnectItemsObserver();
    resetSelectionState();
  };

  setTimeout(() => {
    document.addEventListener('click', outsideClickListener);
  }, 0);
}

function removeOutsideClickListener() {
  if (!outsideClickListener) return;
  document.removeEventListener('click', outsideClickListener);
  outsideClickListener = null;
}

function disconnectItemsObserver() {
  try { playlistItemsObserver?.disconnect?.(); } catch {}
  playlistItemsObserver = null;
}

export async function updatePlaylistModal() {
  const itemsContainer = musicPlayerState.playlistItemsContainer;
  itemsContainer.innerHTML = "";

  const DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";

  for (const [index, track] of musicPlayerState.playlist.entries()) {
    const item = document.createElement("div");
    item.className = `playlist-item ${index === musicPlayerState.currentIndex ? "active" : ""} ${
      musicPlayerState.selectedTracks.has(index) ? "selected" : ""
    }`;
    item.dataset.index = index;
    item.setAttribute("role", "listitem");

    const removeBtn = document.createElement('div');
    removeBtn.className = 'playlist-item-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = config.languageLabels.removeTrack || 'Parçayı kaldır';
    removeBtn.setAttribute("aria-label", `Remove ${track.Name || 'unknown track'}`);
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      showRemoveConfirmModal(index, track.Name || config.languageLabels.unknownTrack);
    };
    item.appendChild(removeBtn);

    const checkboxId = `playlist-item-checkbox-${index}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "playlist-item-checkbox";
    checkbox.id = checkboxId;
    checkbox.name = `playlist-item-${index}`;
    checkbox.checked = musicPlayerState.selectedTracks.has(index);
    checkbox.setAttribute("aria-label", `Select ${track.Name || 'unknown track'}`);
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        musicPlayerState.selectedTracks.add(index);
        item.classList.add("selected");
      } else {
        musicPlayerState.selectedTracks.delete(index);
        item.classList.remove("selected");
      }
      updateSelectAllBtnState();
    };

    const itemContent = document.createElement("div");
    itemContent.className = "playlist-item-content";
    itemContent.onclick = () => playTrack(index);

    const img = document.createElement("div");
    img.className = "playlist-item-img";
    img.style.backgroundImage = DEFAULT_ARTWORK;
    img.setAttribute("aria-hidden", "true");

    const info = document.createElement("div");
    info.className = "playlist-item-info";

    const title = document.createElement("div");
    title.className = "playlist-item-title";
    title.textContent = `${index + 1}. ${track.Name || config.languageLabels.unknownTrack}`;

    const artist = document.createElement("div");
    artist.className = "playlist-item-artist";
    artist.textContent = track.Artists?.join(", ") || config.languageLabels.unknownArtist;

    info.appendChild(title);
    info.appendChild(artist);
    itemContent.appendChild(img);
    itemContent.appendChild(info);
    item.appendChild(checkbox);
    item.appendChild(itemContent);
    itemsContainer.appendChild(item);
  }

  disconnectItemsObserver();

  playlistItemsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const item = entry.target;
        const index = parseInt(item.dataset.index, 10);
        loadImageForItem(item, index);
        playlistItemsObserver.unobserve(item);
      }
    });
  }, { threshold: 0.1, root: itemsContainer });

  document.querySelectorAll('.playlist-item').forEach(item => {
    playlistItemsObserver.observe(item);
  });

  updateSelectAllBtnState();

  const activeItem = itemsContainer.querySelector(".playlist-item.active");
  if (activeItem) {
    activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    activeItem.setAttribute("aria-current", "true");
  }
}

async function loadImageForItem(item, index) {
  const track = musicPlayerState.playlist[index];
  if (!track) return;

  const img = item.querySelector(".playlist-item-img");
  const DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";
  img.style.backgroundImage = DEFAULT_ARTWORK;

  try {
    const imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
    if (imageTag) {
      const imageId = track.AlbumId || track.Id;
      const serverImageUrl = withParams(`/Items/${imageId}/Images/Primary`, {
        fillHeight: 100,
        fillWidth: 100,
        quality: 70,
        tag: imageTag,
        api_key: getAuthToken(),
      });
      img.style.backgroundImage = `url('${serverImageUrl}')`;
      return;
    }

    const tags = await readID3Tags(track.Id);
    if (tags?.pictureUri) {
      img.style.backgroundImage = `url('${tags.pictureUri}')`;
      return;
    }
  } catch (error) {
    console.warn(`Kapak yüklenirken hata (ID: ${track?.Id}):`, error);
  }
}

function filterPlaylistItems(searchTerm) {
  const items = musicPlayerState.playlistItemsContainer.querySelectorAll(".playlist-item");

  items.forEach((item) => {
    const title = item.querySelector(".playlist-item-title")?.textContent.toLowerCase() || "";
    const artist = item.querySelector(".playlist-item-artist")?.textContent.toLowerCase() || "";

    if (title.includes(searchTerm) || artist.includes(searchTerm)) {
      item.style.display = "";
    } else {
      item.style.display = "none";
    }
  });
}

export function showRemoveConfirmModal(trackIndex, trackName) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <p><strong>${trackName}</strong> ${config.languageLabels.confirmRemove || "şarkı listesinden kaldırılsın mı?"}</p>
    <button class="confirm-yes">${config.languageLabels.yes || "Evet"}</button>
    <button class="confirm-no">${config.languageLabels.no || "Hayır"}</button>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", e => {
    e.stopPropagation();
    if (e.target === overlay) overlay.remove();
  });

  dialog.querySelector(".confirm-yes").addEventListener("click", async e => {
    e.stopPropagation();
    try {
      const playlistId = musicPlayerState.currentPlaylistId;
      const trackId = musicPlayerState.playlist[trackIndex].Id;
      const isCurrentTrack = trackIndex === musicPlayerState.currentIndex;

      if (playlistId) {
        await removeItemsFromPlaylist(playlistId, [trackId]);
        showNotification(
          `<i class="fas fa-check-circle"></i> ${config.languageLabels.trackRemoved || "Parça kaldırıldı"}`,
          3000,
          'success'
        );
      } else {
        showNotification(
          `<i class="fas fa-check-circle"></i> ${config.languageLabels.trackRemovedLocal || "Parça listeden kaldırıldı"}`,
          3000,
          'success'
        );
      }
      musicPlayerState.playlist.splice(trackIndex, 1);

      if (isCurrentTrack) {
        if (musicPlayerState.playlist.length > 0) {
          const newIndex = Math.min(trackIndex, musicPlayerState.playlist.length - 1);
          playTrack(newIndex);
        } else {
          if (musicPlayerState.audioElement) {
            musicPlayerState.audioElement.pause();
            musicPlayerState.audioElement.currentTime = 0;
          }
          musicPlayerState.currentIndex = -1;
          musicPlayerState.isPlaying = false;
        }
      } else if (trackIndex < musicPlayerState.currentIndex) {
        musicPlayerState.currentIndex--;
      }

      updatePlaylistModal();
    } catch (err) {
      console.error(err);
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${musicPlayerState.currentPlaylistId ? (config.languageLabels.removeError || "Kaldırma hatası") : (config.languageLabels.removeLocalError || "Yerel silme hatası")}`,
        3000,
        'error'
      );
    } finally {
      overlay.remove();
    }
  });

  dialog.querySelector(".confirm-no").addEventListener("click", e => {
    e.stopPropagation();
    overlay.remove();
  });
}

export function showRemoveSelectedConfirmModal() {
  const selected = Array.from(musicPlayerState.selectedTracks);
  const count = selected.length;
  if (!count) {
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels.noSelection || "Hiç parça seçilmedi"}`,
      3000,
      'warning'
    );
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <p>${count} ${config.languageLabels.confirmRemoveSelected || "parça kaldırılsın mı?"}</p>
    <button class="confirm-yes">${config.languageLabels.yes || "Evet"}</button>
    <button class="confirm-no">${config.languageLabels.no || "Hayır"}</button>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", e => {
    e.stopPropagation();
    if (e.target === overlay) overlay.remove();
  });

  dialog.querySelector(".confirm-yes").addEventListener("click", async e => {
    e.stopPropagation();
    try {
      const playlistId = musicPlayerState.currentPlaylistId;
      const trackIds = selected.map(i => musicPlayerState.playlist[i].Id);
      const currentTrackWasRemoved = selected.includes(musicPlayerState.currentIndex);

      if (playlistId) {
        await removeItemsFromPlaylist(playlistId, trackIds);
        showNotification(
          `<i class="fas fa-check-circle"></i> ${count} ${config.languageLabels.tracksRemoved || "parça kaldırıldı"}`,
          2000,
          'success'
        );
      } else {
        showNotification(
          `<i class="fas fa-info-circle"></i> ${count} ${config.languageLabels.tracksRemovedLocal || "parça listeden kaldırıldı"}`,
          2000,
          'info'
        );
      }
      selected.sort((a, b) => b - a).forEach(i => {
        musicPlayerState.playlist.splice(i, 1);
        if (i < musicPlayerState.currentIndex) {
          musicPlayerState.currentIndex--;
        }
      });

      if (currentTrackWasRemoved) {
        if (musicPlayerState.playlist.length > 0) {
          const newIndex = Math.min(musicPlayerState.currentIndex, musicPlayerState.playlist.length - 1);
          playTrack(newIndex);
        } else {
          if (musicPlayerState.audioElement) {
            musicPlayerState.audioElement.pause();
            musicPlayerState.audioElement.currentTime = 0;
          }
          musicPlayerState.currentIndex = -1;
          musicPlayerState.isPlaying = false;
        }
      }

      musicPlayerState.selectedTracks.clear();
      updatePlaylistModal();
    } catch (err) {
      console.error(err);
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${musicPlayerState.currentPlaylistId ? (config.languageLabels.removeError || "Kaldırma hatası") : (config.languageLabels.removeLocalError || "Yerel silme hatası")}`,
        3000,
        'error'
      );
    } finally {
      overlay.remove();
    }
  });

  dialog.querySelector(".confirm-no").addEventListener("click", e => {
    e.stopPropagation();
    overlay.remove();
  });
}
