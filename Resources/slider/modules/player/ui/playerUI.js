import { createPlaylistModal, togglePlaylistModal } from "./playlistModal.js";
import { musicPlayerState, loadUserSettings, saveUserSettings } from "../core/state.js";
import { getConfig } from "../../config.js";
import { togglePlayPause, playPrevious, playNext, playTrack } from "../player/playback.js";
import { setupProgressControls } from "../player/progress.js";
import { toggleLyrics } from "../lyrics/lyrics.js";
import { toggleRepeatMode, toggleShuffle, toggleMute, toggleRemoveOnPlayMode } from "./controls.js";
import { refreshPlaylist } from "../core/playlist.js";
import { initSettings, updateConfig } from '../../settings.js';
import { showJellyfinPlaylistsModal } from "../core/jellyfinPlaylists.js";
import { togglePlayerVisibility } from "../utils/mainIndex.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { toggleArtistModal, setupArtistClickHandler } from "./artistModal.js";
import { showGenreFilterModal } from "./genreFilterModal.js";
import { showTopTracksModal } from "./topModal.js";
import { getAuthToken } from "../core/auth.js";
import { showNotification } from "./notification.js";
import { loadCSS, isMobileDevice } from "../main.js";
import { makeCleanupBag, addEvent, trackTimeout, trackObserver } from "../utils/cleanup.js";
import { withServer, withParams } from "../../jfUrl.js";

const config = getConfig();
const DEFAULT_ARTWORK = "./slider/src/images/defaultArt.png";
const DEFAULT_ARTWORK_CSS = `url('${DEFAULT_ARTWORK}')`;

let __topTracksAborter = null;

function trackGlobalTimeout(id) {
  if (!musicPlayerState.__timeouts) musicPlayerState.__timeouts = new Set();
  musicPlayerState.__timeouts.add(id);
}
function clearGlobalTimeouts() {
  const set = musicPlayerState.__timeouts;
  if (!set) return;
  for (const id of set) { try { clearTimeout(id); } catch {} }
  set.clear();
}

function createButton({ className, iconClass, title, onClick, id = "" }) {
  const btn = document.createElement("div");
  btn.className = `player-btn ${className || ""}`.trim();
  if (id) btn.id = id;
  btn.innerHTML = `<i class="${iconClass}"></i>`;
  btn.title = title;
  btn.onclick = onClick;
  return btn;
}

export function createModernPlayerUI() {
  if (musicPlayerState.__teardownModern) {
    try { musicPlayerState.__teardownModern(); } catch {}
    musicPlayerState.__teardownModern = null;
  }
  const player = Object.assign(document.createElement("div"), {
    id: "modern-music-player",
    role: "region",
    ariaLabel: "Music Player",
    ariaHidden: "true"
  });
  const __bag = makeCleanupBag(player);

  if (isMobileDevice()) {
    player.classList.add('mobile-device');
  }

  const bgLayer = document.createElement("div");
  bgLayer.className = "player-bg-layer";
  player.appendChild(bgLayer);

  const { container: nextTracksContainer, name: nextTracksName, list: nextTracksList } = createNextTracksUI();

  if (config.nextTracksSource === 'playlist') {
    nextTracksName.textContent = musicPlayerState.userSettings.shuffle
      ? config.languageLabels.rastgele || "Rastgele"
      : config.languageLabels.sirada || "Sıradakiler";
  } else {
    nextTracksName.textContent = getSourceLabel(config.nextTracksSource);
    nextTracksName.title = config.languageLabels.changeSource || "Kaynağı değiştirmek için tıklayın";
    nextTracksName.onclick = async (e) => {
      e.stopPropagation();
      const cfg = getConfig();
      const nextSource = getNextTrackSource(cfg.nextTracksSource);
      const updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
      updateConfig(updatedConfig);

      showNotification(
        `<i class="fas fa-music"></i> ${nextSource.label}`,
        2000,
        'info'
      );

      if (nextSource.value === 'playlist') {
        await updateNextTracks();
      } else {
        await showTopTracksInMainView(nextSource.value);
      }
    };
  }

  setTimeout(() => {
    nextTracksName.classList.remove('hidden');
  }, 4000);

  const topControlsContainer = document.createElement("div");
  topControlsContainer.className = "top-controls-container";

  const buttonsTop = [
    {
      className: "theme-toggle-btn",
      iconClass: config.playerTheme === 'light' ? "fas fa-moon" : "fas fa-sun",
      title: config.playerTheme === 'light' ? config.languageLabels.darkTheme || 'Karanlık Tema' : config.languageLabels.lightTheme || 'Aydınlık Tema',
      onClick: toggleTheme
    },
    { className: "playlist-btn", iconClass: "fas fa-list", title: config.languageLabels.playlist, onClick: togglePlaylistModal },
    { className: "jplaylist-btn", iconClass: "fas fa-list-music", title: config.languageLabels.jellyfinPlaylists || "Jellyfin Oynatma Listesi", onClick: showJellyfinPlaylistsModal },
    {
      className: "settingsLink",
      iconClass: "fas fa-cog",
      title: config.languageLabels.ayarlar || "Ayarlar",
      onClick: (e) => {
        e.preventDefault();
        const settings = initSettings();
        settings.open('music');
      }
    },
    { className: "kapat-btn", iconClass: "fas fa-times", title: config.languageLabels.close || "Close", onClick: togglePlayerVisibility },
  ];

  buttonsTop.forEach(btnInfo => {
    const div = document.createElement("div");
    div.className = btnInfo.className;
    div.innerHTML = `<i class="${btnInfo.iconClass}"></i>`;
    div.title = btnInfo.title;
    div.onclick = btnInfo.onClick;
    topControlsContainer.appendChild(div);
  });

  const onThemeChanged = (ev) => {
    const theme = ev?.detail?.theme || getConfig().playerTheme || 'dark';
    const themeBtn = player.querySelector('.theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = `<i class="fas fa-${theme === 'light' ? 'moon' : 'sun'}"></i>`;
      const cfgNow = getConfig();
      themeBtn.title = theme === 'light'
        ? (cfgNow.languageLabels.darkTheme || 'Karanlık Tema')
        : (cfgNow.languageLabels.lightTheme || 'Aydınlık Tema');
    }
    updatePlayerBackground();
    initializePlayerStyle();
  };
  addEvent(__bag, window, 'app:theme-changed', onThemeChanged);

  const albumArt = document.createElement("div");
  albumArt.id = "player-album-art";

  const favoriteBtn = document.createElement("div");
  favoriteBtn.className = "musicfavorite-btn hidden";
  favoriteBtn.innerHTML = '<i class="fas fa-heart"></i>';
  favoriteBtn.title = config.languageLabels.addToFavorites || "Favorilere ekle";
  favoriteBtn.onclick = (e) => {
    e.stopPropagation();
    toggleFavorite();
  };

  const albumArtContainer = document.createElement("div");
  albumArtContainer.className = "album-art-container";
  albumArtContainer.append(albumArt, favoriteBtn);
  const favEnter = () => {
    const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
    if (currentTrack) {
      favoriteBtn.classList.remove("hidden");
    }
  };
  const favLeave = () => { favoriteBtn.classList.add("hidden"); };
  addEvent(__bag, albumArtContainer, "mouseenter", favEnter, { passive:true });
  addEvent(__bag, albumArtContainer, "mouseleave", favLeave, { passive:true });

  albumArtContainer.addEventListener("click", () => {
    const currentTrack = musicPlayerState.playlist?.[musicPlayerState.currentIndex];
    if (!currentTrack) return;

    const artistName = currentTrack.Artists?.join(", ") ||
      currentTrack.AlbumArtist ||
      config.languageLabels.unknownArtist;

    const artistId = currentTrack.ArtistItems?.[0]?.Id ||
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistId ||
      null;

    toggleArtistModal(true, artistName, artistId);
  });

  const trackInfo = document.createElement("div");
  trackInfo.className = "player-track-info";

  const titleContainer = document.createElement("div");
  titleContainer.id = "player-track-title";
  titleContainer.className = "marquee-container";

  const titleText = document.createElement("div");
  titleText.className = "marquee-text";
  titleText.textContent = config.languageLabels.noSongSelected;
  titleContainer.appendChild(titleText);

  const observer = new MutationObserver(() => { checkMarqueeNeeded(titleText); });
  observer.observe(titleText, { childList: true, characterData: true, subtree: true });
  trackObserver(__bag, observer);

  const onResize = () => { checkMarqueeNeeded(titleText); };
  addEvent(__bag, window, 'resize', onResize, { passive:true });

  trackTimeout(__bag, setTimeout(() => { checkMarqueeNeeded(titleText); }, 100));

  const artist = document.createElement("div");
  artist.id = "player-track-artist";
  artist.textContent = config.languageLabels.artistUnknown;
  artist.onclick = () => toggleArtistModal(true, config.languageLabels.artistUnknown, null);

  const topTracksBtn = createButton({
    className: "top-tracks-btn",
    iconClass: "fas fa-chart-line",
    title: config.languageLabels.myMusic || "En Çok Dinlenenler",
    onClick: () => { showTopTracksModal(); },
  });

  trackInfo.append(titleContainer, artist);

  const repeatBtn = createButton({ iconClass: "fas fa-repeat", title: config.languageLabels.repeatModOff, onClick: toggleRepeatMode });
  const shuffleBtn = createButton({ iconClass: "fas fa-random", title: `${config.languageLabels.shuffle}: ${config.languageLabels.shuffleOff}`, onClick: toggleShuffle });
  const removeOnPlayBtn = createButton({
    className: "remove-on-play-btn",
    iconClass: "fas fa-trash-list",
    title: musicPlayerState.userSettings.removeOnPlay
      ? config.languageLabels.removeOnPlayOn || "Çaldıktan sonra sil: Açık"
      : config.languageLabels.removeOnPlayOff || "Çaldıktan sonra sil: Kapalı",
    onClick: toggleRemoveOnPlayMode
  });

  if (musicPlayerState.userSettings.removeOnPlay) {
    removeOnPlayBtn.innerHTML = '<i class="fas fa-trash-list"></i>';
  }
  const refreshBtn = createButton({ iconClass: "fas fa-sync-alt", title: config.languageLabels.refreshPlaylist, onClick: refreshPlaylist });

  const genreFilterBtn = createButton({
    className: "genre-filter-btn",
    iconClass: "fas fa-filter",
    title: config.languageLabels.filterByGenre || "Türe göre filtrele",
    onClick: showGenreFilterModal
  });
  const prevBtn = createButton({ iconClass: "fas fa-step-backward", title: config.languageLabels.previousTrack, onClick: playPrevious });
  const playPauseBtn = createButton({ className: "main", iconClass: "fas fa-play", title: config.languageLabels.playPause, onClick: togglePlayPause, id: "play-pause-btn" });
  const nextBtn = createButton({ iconClass: "fas fa-step-forward", title: config.languageLabels.nextTrack, onClick: playNext });
  const lyricsBtn = createButton({
    className: "lyrics-btn",
    iconClass: "fas fa-align-left",
    title: config.languageLabels.lyrics,
    onClick: () => {
      toggleLyrics();
      musicPlayerState.lyricsDelay = parseFloat(localStorage.getItem("lyricsDelay")) || 0;
    }
  });
  const volumeBtn = createButton({ iconClass: "fas fa-volume-up", title: config.languageLabels.volume, onClick: toggleMute });

  const volumeSlider = Object.assign(document.createElement("input"), {
    type: "range",
    className: "player-volume-slider",
    min: "0",
    max: "1",
    step: "0.01",
    value: "1",
    title: config.languageLabels.volumeLevel,
  });

  volumeSlider.addEventListener('input', e => {
    const volume = parseFloat(e.target.value);
    const audio = musicPlayerState.audio;
    audio.volume = volume;
    audio.muted = false;
    musicPlayerState.userSettings.volume = volume;
    updateVolumeIcon(volume);
    saveUserSettings();
  });

  function updateVolumeIcon(volume) {
    let icon;
    if (volume === 0) icon = "fas fa-volume-mute";
    else if (volume < 0.5) icon = "fas fa-volume-down";
    else icon = "fas fa-volume-up";
    volumeBtn.innerHTML = `<i class="${icon}"></i>`;
  }

  const controls = document.createElement("div");
  controls.className = "player-controls";

  const controlElements = [
    prevBtn, playPauseBtn, nextBtn, repeatBtn, shuffleBtn,
    removeOnPlayBtn, lyricsBtn, refreshBtn, genreFilterBtn,
    topTracksBtn, volumeBtn, createButton({
      className: "fullscreen-btn",
      iconClass: "fa-solid fa-maximize",
      title: config.languageLabels.fullscreen || "Tam Ekran",
      onClick: toggleFullscreenMode
    }),
    createButton({
      className: "style-toggle-btn",
      iconClass: "fa-solid fa-up-down",
      title: config.playerStyle === 'player' ? config.languageLabels.dikeyStil || 'Dikey Stil' : config.languageLabels.yatayStil || 'Yatay Stil',
      onClick: togglePlayerStyle
    }),
  ];

  addEvent(__bag, window, 'load', initializeFullscreen, { once:true });
  addEvent(__bag, document, 'DOMContentLoaded', initializeFullscreen, { once:true });

  controlElements.forEach(btn => controls.appendChild(btn));
  controls.appendChild(volumeSlider);

  const progressContainer = document.createElement("div");
  progressContainer.className = "player-progress-container";

  const progressBar = document.createElement("div");
  progressBar.className = "player-progress-bar";

  const progress = document.createElement("div");
  progress.className = "player-progress";

  const progressHandle = document.createElement("div");
  progressHandle.className = "player-progress-handle";

  const timeContainer = document.createElement("div");
  timeContainer.className = "player-time-container";

  const currentTimeEl = document.createElement("span");
  currentTimeEl.className = "player-current-time";
  currentTimeEl.textContent = "0:00";

  const durationEl = document.createElement("span");
  durationEl.className = "player-duration";
  durationEl.textContent = "0:00";

  progressBar.append(progress, progressHandle);
  timeContainer.append(currentTimeEl, durationEl);
  progressContainer.append(progressBar, timeContainer);

  timeContainer.addEventListener("click", () => {
    musicPlayerState.showRemaining = !musicPlayerState.showRemaining;
    setupProgressControls();
  });

  const lyricsContainer = document.createElement("div");
  lyricsContainer.id = "player-lyrics-container";
  lyricsContainer.className = "lyrics-hidden";

  player.append(lyricsContainer, topControlsContainer, albumArtContainer, nextTracksContainer, trackInfo, progressContainer, controls);
  document.body.appendChild(player);
  createPlaylistModal();

  Object.assign(musicPlayerState, {
    modernPlayer: player,
    albumArtEl: albumArt,
    modernTitleEl: titleText,
    modernArtistEl: artist,
    progressBar,
    favoriteBtn,
    progress,
    progressHandle,
    playPauseBtn,
    progressContainer,
    currentTimeEl,
    durationEl,
    lyricsContainer,
    lyricsBtn,
    volumeBtn,
    volumeSlider,
    nextTracksContainer,
    nextTracksName,
    nextTracksList,
  });

  musicPlayerState.audio.volume = musicPlayerState.userSettings.volume || 0.7;
  setupProgressControls();
  loadUserSettings();
  setupArtistClickHandler();
  updatePlayerBackground();
  initializeFullscreen();
  initializePlayerStyle();

  const teardown = () => {
    if (musicPlayerState.nextTracksObserver) {
      try {
        const list = musicPlayerState.nextTracksList;
        if (list) for (const el of Array.from(list.children)) {
          try { musicPlayerState.nextTracksObserver.unobserve(el); } catch {}
        }
      } catch {}
      try { musicPlayerState.nextTracksObserver.disconnect(); } catch {}
      musicPlayerState.nextTracksObserver = null;
    }
    try { __topTracksAborter?.abort?.(); } catch {}
    __topTracksAborter = null;
    clearGlobalTimeouts();

    __bag.run();
    try { player.remove(); } catch {}
    musicPlayerState.albumArtEl =
    musicPlayerState.modernTitleEl =
    musicPlayerState.modernArtistEl =
    musicPlayerState.progressBar =
    musicPlayerState.progress =
    musicPlayerState.progressHandle =
    musicPlayerState.playPauseBtn =
    musicPlayerState.progressContainer =
    musicPlayerState.currentTimeEl =
    musicPlayerState.durationEl =
    musicPlayerState.lyricsContainer =
    musicPlayerState.lyricsBtn =
    musicPlayerState.volumeBtn =
    musicPlayerState.volumeSlider =
    musicPlayerState.nextTracksContainer =
    musicPlayerState.nextTracksName =
    musicPlayerState.nextTracksList = null;
  };
  musicPlayerState.__teardownModern = teardown;

  return { player, albumArt, title: titleContainer, artist, progressBar, progress, playPauseBtn, progressContainer, currentTimeEl, durationEl, volumeSlider, lyricsContainer, lyricsBtn };
}

export async function updateNextTracks() {
  const config = getConfig();
  const {
    playlist,
    currentIndex,
    userSettings,
    nextTracksContainer,
  } = musicPlayerState;

  if (!nextTracksContainer || !playlist) return;

  if (musicPlayerState.nextTracksObserver) {
    try {
      const prevList = musicPlayerState.nextTracksList;
      if (prevList) for (const el of Array.from(prevList.children)) {
        try { musicPlayerState.nextTracksObserver.unobserve(el); } catch {}
      }
    } catch {}
    try { musicPlayerState.nextTracksObserver.disconnect(); } catch {}
    musicPlayerState.nextTracksObserver = null;
  }

  const uiElements = createNextTracksUI();
  nextTracksContainer.innerHTML = '';

  uiElements.name.onclick = async (e) => {
    e.stopPropagation();
    const cfg = getConfig();
    const nextSource = getNextTrackSource(cfg.nextTracksSource);
    const updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
    updateConfig(updatedConfig);

    showNotification(
      `<i class="fas fa-music"></i> ${nextSource.label}`,
      2000,
      'info'
    );

    if (nextSource.value === 'playlist') {
      await updateNextTracks();
    } else {
      await showTopTracksInMainView(nextSource.value);
    }
  };

  if (config.nextTracksSource === 'playlist') {
    uiElements.name.style.cursor = 'pointer';
    uiElements.name.textContent = userSettings.shuffle
      ? config.languageLabels.rastgele || "Rastgele"
      : config.languageLabels.sirada || "Sıradakiler";
  } else {
    return showTopTracksInMainView(config.nextTracksSource);
  }

  const playlistLength = playlist.length;
  if (playlistLength <= 1) return;

  if (!musicPlayerState.playedHistory ||
      musicPlayerState.lastShuffleState !== userSettings.shuffle ||
      musicPlayerState.lastCurrentIndex !== currentIndex) {
    musicPlayerState.playedHistory = [currentIndex];
    musicPlayerState.lastShuffleState = userSettings.shuffle;
    musicPlayerState.lastCurrentIndex = currentIndex;
  }

  const nextIndices = userSettings.shuffle
    ? getShuffledIndices(playlist, currentIndex, config.nextTrack)
    : getSequentialIndices(playlist, currentIndex, config.nextTrack);

  const trackElements = nextIndices.map(nextIndex => {
    const track = playlist[nextIndex];
    if (!track) return null;

    const { trackElement, coverElement } = createTrackElement(
      track,
      nextIndex,
      () => playTrack(nextIndex)
    );

    uiElements.list.appendChild(trackElement);
    return { track, trackElement, coverElement, index: nextIndex };
  }).filter(Boolean);

  const observer = new IntersectionObserver(handleIntersection, {
    root: uiElements.wrapper,
    rootMargin: '100px',
    threshold: 0.1
  });

  musicPlayerState.nextTracksObserver = observer;
  setupImageLoading(trackElements, observer);
  setupScrollControls(
    trackElements,
    uiElements.list,
    uiElements.scrollLeft,
    uiElements.scrollRight
  );

  const scrollControlsContainer = document.createElement('div');
  scrollControlsContainer.className = 'next-tracks-scroll-controls';
  scrollControlsContainer.append(uiElements.scrollLeft, uiElements.scrollRight);

  if (trackElements.length > 4) {
    nextTracksContainer.append(
      uiElements.name,
      scrollControlsContainer,
      uiElements.wrapper
    );
  } else {
    nextTracksContainer.append(uiElements.wrapper, uiElements.name);
  }

  trackGlobalTimeout(setTimeout(() => {
    uiElements.name.classList.remove('hidden');
    uiElements.name.classList.add('visible');
  }, 100));

  musicPlayerState.nextTracksList = uiElements.list;
  musicPlayerState.nextTracksName = uiElements.name;
}

async function getTrackImage(track) {
  const imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
  const imageId = track.AlbumId || track.Id;
  if (imageTag) {
    return withParams(`/Items/${imageId}/Images/Primary`, {
      fillHeight: 100,
      fillWidth: 100,
      quality: 70,
      tag: imageTag,
      api_key: getAuthToken(),
    });
  }

  try {
    const tags = await readID3Tags(track.Id);
    if (tags?.pictureUri) return tags.pictureUri;
  } catch (e) {
    console.warn(`ID3 etiketi okunamadı (ID: ${track.Id})`, e);
  }

  return null;
}

async function toggleFavorite() {
  const { playlist, currentIndex, favoriteBtn } = musicPlayerState;
  const track = playlist?.[currentIndex];
  if (!track?.Id) return;

  try {
    const authToken = getAuthToken();
    if (!authToken) {
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels.authRequired || "Kimlik doğrulama hatası"}`,
        3000,
        'error'
      );
      return;
    }

    const isFavorite = track.UserData?.IsFavorite || false;
    const userId = await window.ApiClient.getCurrentUserId();
    const url = withServer(`/Users/${userId}/FavoriteItems/${track.Id}`);

    const response = await fetch(url, {
      method,
      headers: {
        "X-Emby-Token": authToken,
        "Content-Type": "application/json"
      }
    });

    if (response.ok) {
      track.UserData = track.UserData || {};
      track.UserData.IsFavorite = !isFavorite;

      if (favoriteBtn) {
        favoriteBtn.innerHTML = track.UserData.IsFavorite
          ? '<i class="fas fa-heart" style="color:#e91e63"></i>'
          : '<i class="fas fa-heart"></i>';
        favoriteBtn.title = track.UserData.IsFavorite
          ? config.languageLabels.removeFromFavorites || "Favorilerden kaldır"
          : config.languageLabels.addToFavorites || "Favorilere ekle";
      }

      showNotification(
        `<i class="fas fa-heart"></i> ${track.UserData.IsFavorite
          ? config.languageLabels.addedToFavorites || "Favorilere eklendi"
          : config.languageLabels.removedFromFavorites || "Favorilerden kaldırıldı"}`,
        2000,
        'kontrol'
      );
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("Favori işlemi hatası:", error);
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${
        config.languageLabels.favoriteError || "Favori işlemi sırasında hata"
      }`,
      3000,
      'error'
    );
  }
}

export function checkMarqueeNeeded(element) {
  if (!element || !element.parentElement) return;

  const container = element.parentElement;
  const textWidth = element.scrollWidth;
  const containerWidth = container.offsetWidth;

  container.style.setProperty('--container-width', `${containerWidth}px`);

  element.style.removeProperty('animation');
  element.classList.remove('marquee-active');

  requestAnimationFrame(() => {
    if (textWidth > containerWidth) {
      element.classList.add('marquee-active');
    } else {
      element.classList.remove('marquee-active');
      element.style.transform = 'none';
    }
  });
}

function toggleTheme() {
  const config = getConfig();
  const newTheme = config.playerTheme === 'light' ? 'dark' : 'light';
  const updatedConfig = { ...config, playerTheme: newTheme };
  updateConfig(updatedConfig);
  const themeBtn = document.querySelector('.theme-toggle-btn');
  if (themeBtn) {
    themeBtn.innerHTML = `<i class="fas fa-${newTheme === 'light' ? 'moon' : 'sun'}"></i>`;
    themeBtn.title = newTheme === 'light' ? config.languageLabels.darkTheme || 'Karanlık Tema' : config.languageLabels.lightTheme || 'Aydınlık Tema';
  }
  loadCSS();

  showNotification(
    `<i class="fas fa-${newTheme === 'light' ? 'sun' : 'moon'}"></i> ${newTheme === 'light' ? config.languageLabels.lightThemeEnabled || 'Aydınlık tema etkin' : config.languageLabels.darkThemeEnabled || 'Karanlık tema etkin'}`,
    2000,
    'info'
  );
  try {
    window.dispatchEvent(new CustomEvent('app:theme-changed', { detail: { theme: newTheme, source: 'playerUI' } }));
  } catch {}
}

function togglePlayerStyle() {
  const config = getConfig();
  const newStyle = config.playerStyle === 'player' ? 'newplayer' : 'player';
  const iconName = newStyle === 'player' ? 'up-down' : 'left-right';
  const notifName = newStyle === 'player' ? 'left-right' : 'up-down';
  const updatedConfig = { ...config, playerStyle: newStyle };

  updateConfig(updatedConfig);

  const styleBtn = document.querySelector('.style-toggle-btn');
  if (styleBtn) {
    styleBtn.innerHTML = `<i class="fas fa-${iconName}"></i>`;
    styleBtn.title = newStyle === 'player'
      ? config.languageLabels.dikeyStil || 'Dikey Stil'
      : config.languageLabels.yatayStil || 'Yatay Stil';
  }

  loadCSS();
  showNotification(
    `<i class="fas fa-${notifName}"></i> ${
      newStyle === 'player'
        ? config.languageLabels.yatayStilEnabled || 'Yatay stil etkin'
        : config.languageLabels.dikeyStilEnabled || 'Dikey stil etkin'
    }`,
    2000,
    'info'
  );
}

export function updatePlayerBackground() {
  const config = getConfig();
  const bgLayer = document.querySelector('#modern-music-player .player-bg-layer');
  const track = musicPlayerState.playlist?.[musicPlayerState.currentIndex];

  let bgUrl = DEFAULT_ARTWORK;

  if (track) {
    const tag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
    const id = track.AlbumId || track.Id;
    if (tag && id) {
      bgUrl = withParams(`/Items/${id}/Images/Primary`, {
        fillHeight: 1000,
        fillWidth: 1000,
        quality: 96,
        tag,
        api_key: getAuthToken(),
      });
    }
  }

  if (config.useAlbumArtAsBackground) {
    const img = new Image();
    img.onload = () => {
      bgLayer.style.backgroundImage = `url('${bgUrl}')`;
      bgLayer.style.opacity = config.albumArtBackgroundOpacity;
      bgLayer.style.filter = `blur(${config.albumArtBackgroundBlur}px)`;
      bgLayer.style.display = 'block';
    };
    img.onerror = () => {
      bgLayer.style.backgroundImage = DEFAULT_ARTWORK_CSS;
      bgLayer.style.opacity = config.albumArtBackgroundOpacity;
      bgLayer.style.filter = `blur(${config.albumArtBackgroundBlur}px)`;
      bgLayer.style.display = 'block';
    };
    img.src = bgUrl;
  } else {
    bgLayer.style.backgroundImage = 'none';
    bgLayer.style.opacity = '';
    bgLayer.style.filter = '';
  }
}

export async function updateAlbumArt(artUrl) {
  return new Promise((resolve) => {
    const albumArtEl = musicPlayerState.albumArtEl;
    if (!albumArtEl) return resolve();

    const url = artUrl ? `url('${artUrl}')` : DEFAULT_ARTWORK_CSS;
    const img = new Image();
    img.onload = () => {
      albumArtEl.style.backgroundImage = url;
      resolve();
    };
    img.onerror = () => {
      albumArtEl.style.backgroundImage = DEFAULT_ARTWORK_CSS;
      resolve();
    };
    img.src = artUrl || DEFAULT_ARTWORK;
  });
}

function toggleFullscreenMode() {
  const config = getConfig();
  const newMode = !config.fullscreenMode;
  localStorage.setItem('fullscreenMode', newMode);

  const updatedConfig = { ...config, fullscreenMode: newMode };

  updateConfig(updatedConfig);
  loadCSS();

  const player = document.getElementById('modern-music-player');
  if (player) {
    if (newMode) {
      player.classList.add('fullscreen-mode');
      document.body.style.overflow = 'hidden';
    } else {
      player.classList.remove('fullscreen-mode');
      document.body.style.overflow = '';
    }
  }

  const fullscreenBtn = document.querySelector('.fullscreen-btn i');
  if (fullscreenBtn) {
    fullscreenBtn.className = newMode
      ? 'fa-solid fa-minimize'
      : 'fa-solid fa-maximize';
  }

  showNotification(
    `<i class="fa-solid fa-${newMode ? 'maximize' : 'minimize'}"></i> ${
      newMode
        ? config.languageLabels.fullscreenEnabled || 'Tam ekran modu etkin'
        : config.languageLabels.fullscreenDisabled || 'Tam ekran modu devre dışı'
    }`,
    2000,
    'info'
  );
}

function initializePlayerStyle() {
  const config = getConfig();
  const player = document.getElementById('modern-music-player');
  const styleToggleBtn = document.querySelector('.style-toggle-btn i');

  if (!player || !styleToggleBtn) return;

  if (config.playerStyle === 'newplayer') {
    player.classList.add('style-toggle');
    styleToggleBtn.className = 'fas fa-left-right';
    styleToggleBtn.title = config.languageLabels.dikeyStil || 'Dikey Stil';
  } else {
    player.classList.remove('style-toggle');
    styleToggleBtn.className = 'fas fa-up-down';
    styleToggleBtn.title = config.languageLabels.yatayStil || 'Yatay Stil';
  }
}

function initializeFullscreen() {
  const config = getConfig();
  const player = document.getElementById('modern-music-player');
  const fullscreenBtn = document.querySelector('.fullscreen-btn i');

  if (config.fullscreenMode) {
    player?.classList.add('fullscreen-mode');
    document.body.style.overflow = 'hidden';
    if (fullscreenBtn) {
      fullscreenBtn.className = 'fa-solid fa-minimize';
    }
  } else {
    player?.classList.remove('fullscreen-mode');
    document.body.style.overflow = '';
    if (fullscreenBtn) {
      fullscreenBtn.className = 'fa-solid fa-maximize';
    }
  }
}

async function showTopTracksInMainView(tab) {
  if (tab === 'playlist') {
    await updateNextTracks();
    return;
  }

  const { nextTracksContainer } = musicPlayerState;

  const uiElements = createNextTracksUI();
  nextTracksContainer.innerHTML = '';

  uiElements.name.textContent = getSourceLabel(tab);
  uiElements.name.style.cursor = 'pointer';
  uiElements.name.onclick = async (e) => {
    e.stopPropagation();
    const cfg = getConfig();
    const nextSource = getNextTrackSource(cfg.nextTracksSource);
    const updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
    updateConfig(updatedConfig);

    showNotification(
      `<i class="fas fa-music"></i> ${nextSource.label}`,
      2000,
      'info'
    );

    if (nextSource.value === 'playlist') {
      await updateNextTracks();
    } else {
      await showTopTracksInMainView(nextSource.value);
    }
  };

  if (__topTracksAborter) { try { __topTracksAborter.abort(); } catch {} }
  __topTracksAborter = new AbortController();

  try {
    const token = getAuthToken();
    const userId = await window.ApiClient.getCurrentUserId();
    const { apiPath, params } = getApiUrlForTab(tab, userId);

    const response = await fetch(withParams(apiPath, params), {
      headers: { "X-Emby-Token": token },
      signal: __topTracksAborter.signal
    });

    if (!response.ok) throw new Error('Şarkılar yüklenemedi');

    const data = await response.json();
    let tracks = data.Items || [];
    tracks = tracks.filter((track, idx, arr) =>
      arr.findIndex(t => isSameTrack(t, track)) === idx
    );

    if (tracks.length === 0) {
      const noTracksElement = document.createElement('div');
      noTracksElement.className = 'no-tracks';
      noTracksElement.textContent = config.languageLabels.noTracks || 'Şarkı bulunamadı';
      uiElements.list.appendChild(noTracksElement);

      showNotification(
        `<i class="fas fa-info-circle"></i> ${getSourceLabel(tab)}: ${config.languageLabels.noTracks || 'Şarkı bulunamadı'}`,
        2000,
        'info'
      );
    } else {
      const trackElements = tracks.map((track, index) => {
        const { trackElement, coverElement } = createTrackElement(
          track,
          index,
          () => addAndPlayTrack(track)
        );
        loadInitialBatch([{ track, trackElement, coverElement, index }])
          .catch(err => console.error('Görsel yükleme hatası:', err));

        uiElements.list.appendChild(trackElement);
        return { track, trackElement, coverElement, index };
      });

      setupScrollControls(
        trackElements,
        uiElements.list,
        uiElements.scrollLeft,
        uiElements.scrollRight
      );
    }

    const scrollControlsContainer = document.createElement('div');
    scrollControlsContainer.className = 'next-tracks-scroll-controls';
    scrollControlsContainer.append(uiElements.scrollLeft, uiElements.scrollRight);

    if (tracks.length > 4) {
      nextTracksContainer.append(
        uiElements.name,
        scrollControlsContainer,
        uiElements.wrapper
      );
    } else {
      nextTracksContainer.append(uiElements.wrapper, uiElements.name);
    }

    trackGlobalTimeout(setTimeout(() => {
      uiElements.name.classList.remove('hidden');
      uiElements.name.classList.add('visible');
    }, 100));

  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Sıradaki şarkılar yüklenirken hata:', error);
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = config.languageLabels.loadError || 'Yüklenirken hata oluştu';
    uiElements.list.appendChild(errorElement);

    nextTracksContainer.append(uiElements.wrapper, uiElements.name);

    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${getSourceLabel(tab)}: ${config.languageLabels.loadError || 'Yüklenirken hata oluştu'}`,
      2000,
      'error'
    );
  }
}

function isSameTrack(a, b) {
  if (a.Id === b.Id) return true;
  if (a.Name !== b.Name) return false;
  const artistsA = (a.Artists || []).map(x => x.Name).sort().join(',');
  const artistsB = (b.Artists || []).map(x => x.Name).sort().join(',');
  return artistsA === artistsB;
}

function addAndPlayTrack(track) {
  const playlist = musicPlayerState.playlist;
  const existingIndex = playlist.findIndex(t => isSameTrack(t, track));

  if (existingIndex >= 0) {
    musicPlayerState.currentIndex = existingIndex;
  } else {
    playlist.push(track);
    musicPlayerState.originalPlaylist.push(track);
    musicPlayerState.currentIndex = playlist.length - 1;
  }
  playTrack(musicPlayerState.currentIndex);
}

function createNextTracksUI() {
  const nextTracksContainer = document.createElement('div');
  nextTracksContainer.className = 'next-tracks-container';

  const nextTracksName = document.createElement('div');
  nextTracksName.className = 'next-tracks-name hidden';
  nextTracksName.style.cursor = 'pointer';

  const nextTracksList = document.createElement('div');
  nextTracksList.className = 'next-tracks-list';

  const scrollLeftBtn = document.createElement('div');
  scrollLeftBtn.className = 'track-scroll-btn track-scroll-left';
  scrollLeftBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';

  const scrollRightBtn = document.createElement('div');
  scrollRightBtn.className = 'track-scroll-btn track-scroll-right';
  scrollRightBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';

  const wrapper = document.createElement('div');
  wrapper.className = 'next-tracks-wrapper';
  wrapper.appendChild(nextTracksList);

  return {
    container: nextTracksContainer,
    name: nextTracksName,
    list: nextTracksList,
    scrollLeft: scrollLeftBtn,
    scrollRight: scrollRightBtn,
    wrapper
  };
}

function setupScrollControls(trackElements, nextTracksList, scrollLeftBtn, scrollRightBtn) {
  let scrollIndex = 0;
  const visibleCount = 4;
  const itemWidth = 75;

  const updateScroll = () => {
    nextTracksList.style.transform = `translateX(-${scrollIndex * itemWidth}px)`;
  };

  scrollLeftBtn.onclick = () => {
    scrollIndex = Math.max(0, scrollIndex - visibleCount);
    updateScroll();
  };

  scrollRightBtn.onclick = () => {
    scrollIndex = Math.min(trackElements.length - visibleCount, scrollIndex + visibleCount);
    updateScroll();
  };
}

export function destroyModernPlayerUI() {
  if (musicPlayerState.__teardownModern) {
    musicPlayerState.__teardownModern();
    musicPlayerState.__teardownModern = null;
  }
}

function createTrackElement(track, index, onClickHandler) {
  const config = getConfig();
  const trackElement = document.createElement('div');
  trackElement.className = 'next-track-item hidden';
  trackElement.dataset.trackId = track.Id;
  trackElement.dataset.trackIndex = index;
  trackElement.dataset.loaded = "false";
  trackElement.title = track.Name || config.languageLabels.unknownTrack;

  const coverElement = document.createElement('div');
  coverElement.className = 'next-track-cover';
  coverElement.style.backgroundImage = DEFAULT_ARTWORK_CSS;
  coverElement.onclick = () => onClickHandler(track, index);

  const titleElement = document.createElement('div');
  titleElement.className = 'next-track-title';
  titleElement.textContent = track.Name || config.languageLabels.unknownTrack;
  titleElement.onclick = () => onClickHandler(track, index);

  trackElement.append(coverElement, titleElement);
  return { trackElement, coverElement };
}

function getShuffledIndices(playlist, currentIndex, maxNextTracks) {
  const playedSet = new Set(musicPlayerState.playedHistory);
  if (!playedSet.has(currentIndex)) playedSet.add(currentIndex);

  if (playedSet.size >= playlist.length) {
    playedSet.clear();
    playedSet.add(currentIndex);
  }

  const selectedSet = new Set();
  while (selectedSet.size < maxNextTracks && selectedSet.size < playlist.length - 1) {
    const randIdx = Math.floor(Math.random() * playlist.length);
    if (randIdx !== currentIndex && !playedSet.has(randIdx)) {
      selectedSet.add(randIdx);
    }
  }

  const nextIndices = Array.from(selectedSet);
  if (nextIndices.length < maxNextTracks) {
    for (let i = 0; i < playlist.length && nextIndices.length < maxNextTracks; i++) {
      if (i !== currentIndex && !nextIndices.includes(i)) {
        nextIndices.push(i);
      }
    }
  }

  musicPlayerState.playedHistory.push(...nextIndices);
  musicPlayerState.playedHistory = Array.from(new Set(musicPlayerState.playedHistory));
  if (musicPlayerState.playedHistory.length > playlist.length) {
    musicPlayerState.playedHistory = musicPlayerState.playedHistory.slice(-playlist.length);
  }

  return nextIndices;
}

function getSequentialIndices(playlist, currentIndex, maxNextTracks) {
  let idx = currentIndex;
  let attempts = 0;
  const maxAttempts = playlist.length * 2;
  const nextIndices = [];

  while (nextIndices.length < maxNextTracks && attempts < maxAttempts) {
    idx = (idx + 1) % playlist.length;
    if (!musicPlayerState.playedHistory.includes(idx)) {
      nextIndices.push(idx);
      musicPlayerState.playedHistory.push(idx);
    }
    attempts++;
    if (attempts >= playlist.length && nextIndices.length === 0) {
      musicPlayerState.playedHistory = [currentIndex];
      idx = currentIndex;
      attempts = 0;
    }
  }

  return nextIndices;
}

function getApiUrlForTab(tab, userId) {
  const config = getConfig();

  const base = `/Users/${userId}/Items`;
  const common = {
    IncludeItemTypes: "Audio",
    Recursive: "true",
  };

  switch (tab) {
    case "top":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "PlayCount",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.topTracks || "En Çok Dinlenenler",
      };

    case "recent":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "DatePlayed",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.recentTracks || "Son Dinlenenler",
      };

    case "latest":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "DateCreated",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.latestTracks || "Son Eklenenler",
      };

    case "favorites":
      return {
        apiPath: base,
        params: {
          Filters: "IsFavorite",
          IncludeItemTypes: "Audio",
          Recursive: "true",
          SortBy: "SortName",
          SortOrder: "Ascending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.favorites || "Favorilerim",
      };

    default:
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "PlayCount",
          SortOrder: "Descending",
          Limit: config.nextTrack,
        },
        trackListName: config.languageLabels.topTracks || "En Çok Dinlenenler",
      };
  }
}

function handleIntersection(entries, observer) {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;

    const el = entry.target;
    if (el.dataset.loaded === "true") return;

    const trackId = el.dataset.trackId;
    const trackElements = Array.from(el.parentElement.children);
    const trackIndex = trackElements.indexOf(el);

    loadTrackImageForElement(el, trackIndex);
  });
}

function getNextTrackSource(currentSource) {
  const config = getConfig();
  const sources = [
    { value: 'top', label: config.languageLabels.topTracks || 'En Çok Dinlenenler' },
    { value: 'recent', label: config.languageLabels.recentTracks || 'Son Dinlenenler' },
    { value: 'latest', label: config.languageLabels.latestTracks || 'Son Eklenenler' },
    { value: 'favorites', label: config.languageLabels.favorites || 'Favorilerim' },
    { value: 'playlist', label: musicPlayerState.userSettings.shuffle
        ? config.languageLabels.rastgele || "Rastgele"
        : config.languageLabels.sirada || "Sıradakiler" }
  ];

  const currentIndex = sources.findIndex(s => s.value === currentSource);
  const nextIndex = (currentIndex + 1) % sources.length;
  return sources[nextIndex];
}

async function setupImageLoading(trackElements, observer) {
  const initialBatch = trackElements.slice(0, config.id3limit || 4);
  await loadInitialBatch(initialBatch);

  trackElements.slice(config.id3limit || 4).forEach(({ trackElement }) => {
    trackElement.classList.remove('hidden');
    observer.observe(trackElement);
  });
}

async function loadInitialBatch(trackElements) {
  if (!Array.isArray(trackElements)) {
    console.error('loadInitialBatch: trackElements bir dizi olmalı', trackElements);
    return;
  }

  const chunkSize = config.id3limit || 4;
  for (let i = 0; i < trackElements.length; i += chunkSize) {
    const chunk = trackElements.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async ({ track, trackElement, coverElement }) => {
      if (!trackElement || !coverElement) return;

      trackElement.classList.remove('hidden');
      trackElement.classList.add('visible');

      try {
        const imageUri = await getTrackImage(track);
        if (imageUri) {
          coverElement.style.backgroundImage = `url('${imageUri}')`;
        }
        trackElement.dataset.loaded = "true";
      } catch (err) {
        console.error('İlk batch görsel yükleme hatası:', err);
      }
    }));
  }
}

async function loadTrackImageForElement(trackElement, trackIndex) {
  const { playlist } = musicPlayerState;
  const track = playlist[trackIndex];
  if (!track) return;

  try {
    const imageUri = await getTrackImage(track);
    if (imageUri) {
      const coverElement = trackElement.querySelector('.next-track-cover');
      if (coverElement) {
        coverElement.style.backgroundImage = `url('${imageUri}')`;
      }
    }
    trackElement.dataset.loaded = "true";
  } catch (err) {
    console.error(`Track #${trackIndex} resmi yüklenirken hata:`, err);
  }
}

function getSourceLabel(source) {
  const config = getConfig();
  const labels = {
    'top': config.languageLabels.topTracks || "En Çok Dinlenenler",
    'recent': config.languageLabels.recentTracks || "Son Dinlenenler",
    'latest': config.languageLabels.latestTracks || "Son Eklenenler",
    'favorites': config.languageLabels.favorites || "Favorilerim",
    'playlist': musicPlayerState.userSettings.shuffle
      ? config.languageLabels.rastgele || "Rastgele"
      : config.languageLabels.sirada || "Sıradakiler"
  };
  return labels[source] || source;
}
