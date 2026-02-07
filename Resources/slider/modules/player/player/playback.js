import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { updateMediaMetadata, initMediaSession, updatePositionState } from "../core/mediaSession.js";
import { getFromOfflineCache, cacheForOffline } from "../core/offlineCache.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { fetchLyrics, updateSyncedLyrics, startLyricsSync } from "../lyrics/lyrics.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { showNotification } from "../ui/notification.js";
import { updateProgress, updateDuration, setupAudioListeners } from "./progress.js";
import { updateNextTracks, checkMarqueeNeeded, updatePlayerBackground, updateAlbumArt } from "../ui/playerUI.js";
import { refreshPlaylist } from "../core/playlist.js";

const config = getConfig();
const SEEK_RETRY_DELAY = 0;
const DEFAULT_ARTWORK = "./slider/src/images/defaultArt.png";
const DEFAULT_ARTWORK_CSS = `url('${DEFAULT_ARTWORK}')`;

let currentCanPlayHandler = null;
let currentPlayErrorHandler = null;
let _metaReqId = 0;

const updatePlaybackUI = (isPlaying) => {
  if (musicPlayerState.playPauseBtn) {
    musicPlayerState.playPauseBtn.innerHTML = isPlaying
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
};

const handlePlaybackError = (error, action = 'play') => {
  console.error(`Oynatma sırasında hata oluştu ${action}:`, error);
  const t = musicPlayerState.playlist[musicPlayerState.currentIndex];
  if (t && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(t, convertSecondsToTicks(musicPlayerState.audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  showNotification(
  `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels.playbackError || "Oynatma Hatası"}`,
  3000,
  'error'
);
  setTimeout(playNext, SEEK_RETRY_DELAY);
};

const disposables = {
  timeouts: new Set(),
  images: new Set(),
  aborters: new Set(),
  listeners: new Set(),
  clearAll() {
    for (const id of this.timeouts) { clearTimeout(id); }
    this.timeouts.clear();

    for (const { target, type, fn, opts } of this.listeners) {
      try { target.removeEventListener(type, fn, opts); } catch {}
    }
    this.listeners.clear();

    for (const img of this.images) {
      try { img.onload = img.onerror = null; img.src = ""; } catch {}
    }
    this.images.clear();

    for (const a of this.aborters) { try { a.abort(); } catch {} }
    this.aborters.clear();
  },
  addTimeout(id){ this.timeouts.add(id); return id; },
  addImage(img){ this.images.add(img); return img; },
  addAborter(a){ this.aborters.add(a); return a; },
  addListener(target, type, fn, opts){
    target.addEventListener(type, fn, opts);
    this.listeners.add({ target, type, fn, opts });
  }
};

let _lyricsRunning = false;
let _marqueeT1 = null;
let _loadedMetaRetryT = null;


 function handleCanPlay() {
  musicPlayerState.audio.play()
    .then(() => {
      updatePlaybackUI(true);
      const track = musicPlayerState.isUserModified
        ? musicPlayerState.combinedPlaylist[musicPlayerState.currentIndex]
        : musicPlayerState.playlist[musicPlayerState.currentIndex];
      if (track && !musicPlayerState.isPlayingReported) {
        reportPlaybackStart(track);
        musicPlayerState.isPlayingReported = true;
        musicPlayerState.lastReportedItemId = track.Id ?? null;
      }
    })
     .catch(err => handlePlaybackError(err, 'canplay'));
 }


function handlePlayError() {
  console.error("Şarkı yükleme hatası:", musicPlayerState.audio.src);
  const t = musicPlayerState.playlist[musicPlayerState.currentIndex];
  if (t && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(t, convertSecondsToTicks(musicPlayerState.audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  setTimeout(playNext, SEEK_RETRY_DELAY);
}

function cleanupAudioListeners() {
  const audio = musicPlayerState.audio;
  disposables.clearAll();
  if (musicPlayerState.stopLyricsSync) {
    try { musicPlayerState.stopLyricsSync(); } catch {}
  }
  _lyricsRunning = false;

  if (!audio) return;

  try { audio.pause(); } catch {}
  try { audio.removeEventListener('canplay', handleCanPlay); } catch {}
  try { audio.removeEventListener('error', handlePlayError); } catch {}
  try { audio.removeEventListener('loadedmetadata', handleLoadedMetadata); } catch {}
  audio.onended = null;
  audio.src = '';
  audio.removeAttribute('src');
  try { audio.load(); } catch {}
}

export function handleSongEnd() {
   const { userSettings, playlist, audio } = musicPlayerState;
   const currentTrack = playlist[musicPlayerState.currentIndex];
  if (currentTrack && musicPlayerState.isPlayingReported) {
     reportPlaybackStopped(
       currentTrack,
       convertSecondsToTicks(audio.currentTime)
     );
    musicPlayerState.isPlayingReported = false;
   }

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    showNotification(
      config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
      2000,
      'info'
    );
    return setTimeout(() => refreshPlaylist(), 500);
  }

  switch (userSettings.repeatMode) {
    case 'one':
      musicPlayerState.audio.currentTime = 0;
      musicPlayerState.audio.play()
        .then(() => updatePlaybackUI(true))
        .catch(err => handlePlaybackError(err, 'repeat'));
      break;

    case 'all':
      if (userSettings.removeOnPlay) {
        playNext();
      } else {
        const nextIndex = (musicPlayerState.currentIndex + 1) % playlist.length;
        playTrack(nextIndex);
      }
      break;

    default:
      playNext();
  }
}

export function togglePlayPause() {
  const { audio } = musicPlayerState;

  if (!audio) {
    console.warn('Ses okunamadı');
    return;
  }

  if (audio.paused) {
    audio.play()
      .then(() => {
        updatePlaybackUI(true);
        const currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
        if (currentTrack && !musicPlayerState.isPlayingReported) {
          reportPlaybackStart(currentTrack);
          musicPlayerState.isPlayingReported = true;
          musicPlayerState.lastReportedItemId = currentTrack.Id ?? null;
        }
      })
      .catch(error => handlePlaybackError(error));
  } else {
    audio.pause();
    updatePlaybackUI(false);
    const currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
    if (currentTrack && musicPlayerState.isPlayingReported) {
      reportPlaybackStopped(
        currentTrack,
        convertSecondsToTicks(audio.currentTime)
      );
      musicPlayerState.isPlayingReported = false;
    }
  }
}

export function playPrevious() {
  const { playlist, effectivePlaylist, userSettings, audio } = musicPlayerState;
  const prevTrack = playlist[musicPlayerState.currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  const currentIndex = musicPlayerState.currentIndex;

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    showNotification(
      config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    showNotification(
  `<i class="fas fa-music" style="margin-right: 8px;"></i>${config.languageLabels.simdioynat}: ${musicPlayerState.currentTrackName}`,
  2000,
  'kontrol'
);
    return;
  }

  if (userSettings.removeOnPlay) {
    const removed = playlist.splice(currentIndex, 1);
    const effIdx = effectivePlaylist.findIndex(t => t.Id === removed[0]?.Id);
    if (effIdx > -1) effectivePlaylist.splice(effIdx, 1);
    updatePlaylistModal();

    if (playlist.length === 0) {
      updatePlaybackUI(false);
      showNotification(
        config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
        2000,
        'info'
      );
      return refreshPlaylist();
    }

    musicPlayerState.currentIndex = Math.min(currentIndex, playlist.length - 1);
  }

  let prevIndex = musicPlayerState.currentIndex - 1;
  if (prevIndex < 0) prevIndex = playlist.length - 1;

  playTrack(prevIndex);
}

export function playNext() {
  const { playlist, effectivePlaylist, userSettings, currentIndex, audio } = musicPlayerState;
  const prevTrack = playlist[currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    showNotification(
      config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  if (userSettings.removeOnPlay && currentIndex >= 0 && currentIndex < playlist.length) {
    const currentTrackId = musicPlayerState.currentTrackId;
    playlist.splice(currentIndex, 1);
    const effIdx = effectivePlaylist.findIndex(t => t.Id === currentTrackId);
    if (effIdx > -1) effectivePlaylist.splice(effIdx, 1);
    updatePlaylistModal();

    if (playlist.length === 0) {
      updatePlaybackUI(false);
      showNotification(
        config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
        2000,
        'info'
      );
      return refreshPlaylist();
    }

    if (userSettings.shuffle) {
      const nextIndex = Math.floor(Math.random() * playlist.length);
      return playTrack(nextIndex);
    } else {
      const newIndex = currentIndex >= playlist.length ? 0 : currentIndex;
      return playTrack(newIndex);
    }
  }

  let nextIndex;
  if (userSettings.shuffle) {
    let rnd;
    do {
      rnd = Math.floor(Math.random() * effectivePlaylist.length);
    } while (rnd === currentIndex && effectivePlaylist.length > 1);
    nextIndex = rnd;
  } else {
    if (userSettings.repeatMode === 'all') {
      nextIndex = (currentIndex + 1) % effectivePlaylist.length;
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= effectivePlaylist.length) {
        updatePlaybackUI(false);
        return;
      }
    }
  }

  playTrack(nextIndex);
}

export async function updateModernTrackInfo(track) {
  if (!track) {
    resetTrackInfo();
    return;
  }

  const title = track.Name || config.languageLabels.unknownTrack;
  const artists = track.Artists || (track.ArtistItems?.map(a => a.Name) || []) || (track.artist ? [track.artist] : []) || [config.languageLabels.unknownArtist];

  musicPlayerState.modernTitleEl.textContent = title;
  musicPlayerState.modernArtistEl.textContent = artists.join(", ");

   checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  clearMarqueeTimers();
  _marqueeT1 = disposables.addTimeout(setTimeout(() => {
    checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  }, 500));

  await Promise.all([ loadAlbumArt(track), updateTrackMeta(track) ]);
  updatePlayerBackground();

  if (musicPlayerState.favoriteBtn) {
    const isFavorite = track?.UserData?.IsFavorite || false;
    musicPlayerState.favoriteBtn.innerHTML = isFavorite
      ? '<i class="fas fa-heart" style="color:#e91e63"></i>'
      : '<i class="fas fa-heart"></i>';
    musicPlayerState.favoriteBtn.title = isFavorite
      ? config.languageLabels.removeFromFavorites || "Favorilerden kaldır"
      : config.languageLabels.addToFavorites || "Favorilere ekle";
  }

  updateMediaMetadata(track);
}

function resetTrackInfo() {
  musicPlayerState.modernTitleEl.textContent = config.languageLabels.unknownTrack;
  musicPlayerState.modernArtistEl.textContent = config.languageLabels.unknownArtist;
  setAlbumArt(DEFAULT_ARTWORK);
}

async function updateTrackMeta(track) {
  const reqId = ++_metaReqId;

  if (!musicPlayerState.metaWrapper) createMetaWrapper();
  if (musicPlayerState.modernPlayer) {
    musicPlayerState.modernPlayer
      .querySelectorAll(".player-meta-container")
      .forEach(el => { if (el !== musicPlayerState.metaContainer) el.remove(); });
  }
  if (!musicPlayerState.metaContainer) {
    musicPlayerState.metaContainer = document.createElement("div");
    musicPlayerState.metaContainer.className = "player-meta-container";
    Object.assign(musicPlayerState.metaContainer.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      overflow: 'hidden',
      textAlign: 'center'
    });
    musicPlayerState.metaWrapper.appendChild(musicPlayerState.metaContainer);
  }

  musicPlayerState.metaContainer.innerHTML = '';

  const tags = await readID3Tags(track.Id);
  if (reqId !== _metaReqId) return;
  const metaItems = [
    { key: 'tracknumber', show: track?.IndexNumber != null, icon: 'fas fa-list-ol', text: track.IndexNumber },
    { key: 'year', show: track?.ProductionYear != null, icon: 'fas fa-calendar-alt', text: track.ProductionYear },
    { key: 'album', show: !!track?.Album, icon: 'fas fa-compact-disc', text: track.Album },
    { key: 'genre', show: !!tags?.genre, icon: 'fas fa-music', text: tags.genre }
  ];

  for (const item of metaItems) {
    if (!item.show || item.text == null) continue;
    const span = document.createElement('span');
    span.className = `${item.key}-meta`;
    const label = config.languageLabels[item.key] || item.key;
    span.title = `${label}: ${item.text}`;
    span.innerHTML = `<i class="${item.icon}" style="margin-right:4px"></i>${item.text}`;
    if (item.key === 'tracknumber' || item.key === 'year') {
      Object.assign(span.style, {
        flex: '0 0 auto',
        whiteSpace: 'nowrap'
      });
    } else {
      Object.assign(span.style, {
        minWidth: '0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      });
    }

    musicPlayerState.metaContainer.appendChild(span);
  }
}


function setAlbumArt(imageUrl) {
  if (!musicPlayerState.albumArtEl) return;

  if (!imageUrl || imageUrl === 'undefined') {
    musicPlayerState.albumArtEl.style.backgroundImage = DEFAULT_ARTWORK_CSS;
    musicPlayerState.currentArtwork = [{
      src: DEFAULT_ARTWORK,
      sizes: '300x300',
      type: 'image/png'
    }];
    return;
  }

  if (imageUrl.startsWith('url(')) {
    musicPlayerState.albumArtEl.style.backgroundImage = imageUrl;
    musicPlayerState.currentArtwork = [{
      src: imageUrl.replace("url('", "").replace("')", ""),
      sizes: '300x300',
      type: 'image/jpeg'
    }];
    return;
  }

  musicPlayerState.albumArtEl.style.backgroundImage = `url('${imageUrl}')`;
  musicPlayerState.currentArtwork = [{
    src: imageUrl,
    sizes: '300x300',
    type: imageUrl.startsWith('data:') ? imageUrl.split(';')[0].split(':')[1] : 'image/jpeg'
  }];
}

function createMetaWrapper() {
  const metaWrapper = document.createElement("div");
  metaWrapper.className = "player-meta-wrapper";

  if (musicPlayerState.modernPlayer) {
    musicPlayerState.modernPlayer.insertBefore(
      metaWrapper,
      musicPlayerState.progressContainer
    );
  }
  musicPlayerState.metaWrapper = metaWrapper;
}

function addMetaItem(className, icon, text) {
  if (!musicPlayerState.metaContainer || !text) return;

  const span = document.createElement("span");
  span.className = `${className}-meta`;

  const label = config.languageLabels[className] || className;
  span.title = `${label}: ${text}`;

  span.innerHTML = `<i class="${icon}"></i> ${text}`;
  musicPlayerState.metaContainer.appendChild(span);
}

async function loadAlbumArt(track) {
  try {
    const artwork = await getArtworkFromSources(track);
    setAlbumArt(artwork);

    if (artwork && artwork !== DEFAULT_ARTWORK) {
      cacheForOffline(track.Id, 'artwork', artwork);
    }
  } catch (err) {
    console.error("Albüm kapağı yükleme hatası:", err);
    setAlbumArt(DEFAULT_ARTWORK);
  }
}

async function getArtworkFromSources(track) {
  try {
    const fromCache = await getFromOfflineCache(track.Id, 'artwork');
    if (fromCache) return fromCache;

    const embedded = await getEmbeddedImage(track.Id);
    if (embedded) return embedded;

    const imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
    if (imageTag) {
      const imageId = track.AlbumId || track.Id;
      const url = apiUrl(`/Items/${imageId}/Images/Primary?fillHeight=300&fillWidth=300&quality=90&tag=${imageTag}`);
      const valid = await checkImageExists(url);
      return valid ? url : DEFAULT_ARTWORK;
    }

    return DEFAULT_ARTWORK;
  } catch (error) {
    console.error("Artwork alınırken hata:", error);
    return DEFAULT_ARTWORK;
  }
}

function checkImageExists(url) {
  return new Promise((resolve) => {
    const img = disposables.addImage(new Image());
    img.onload = () => { resolve(true); img.onload = img.onerror = null; img.src = ""; disposables.images.delete(img); };
    img.onerror = () => { resolve(false); img.onload = img.onerror = null; img.src = ""; disposables.images.delete(img); };
    img.src = url;
  });
}

function clearMarqueeTimers() {
  if (_marqueeT1) { clearTimeout(_marqueeT1); _marqueeT1 = null; }
}

async function getEmbeddedImage(trackId) {
  const tags = await readID3Tags(trackId);
  return tags?.pictureUri || null;
}

export function playTrack(index) {
  if (index === musicPlayerState.currentIndex &&
      musicPlayerState.playlist[index]?.Id ===
      musicPlayerState.playlist[musicPlayerState.currentIndex]?.Id) {
  }
  cleanupAudioListeners();
  const prevIndex = musicPlayerState.currentIndex;
  const hadTime = Number.isFinite(musicPlayerState?.audio?.currentTime) && musicPlayerState.audio.currentTime > 0.25;
  const prevTrack = (prevIndex != null && prevIndex > -1) ? musicPlayerState.playlist[prevIndex] : null;

  if (index < 0 || index >= musicPlayerState.playlist.length) return;

  if (!musicPlayerState.mediaSessionInitialized && 'mediaSession' in navigator) {
    initMediaSession();
    musicPlayerState.mediaSessionInitialized = true;
  }

  const track = musicPlayerState.isUserModified
    ? musicPlayerState.combinedPlaylist[index]
    : musicPlayerState.playlist[index];

  if (prevTrack && musicPlayerState.isPlayingReported) {
    const switchingToDifferent = prevTrack.Id !== track?.Id;
    if (switchingToDifferent || hadTime) {
      reportPlaybackStopped(
        prevTrack,
        convertSecondsToTicks(musicPlayerState.audio.currentTime)
      );
    }
    musicPlayerState.isPlayingReported = false;
  }

  musicPlayerState.currentIndex = index;
  musicPlayerState.currentTrackName = track.Name || config.languageLabels.unknownTrack;
  musicPlayerState.currentAlbumName = track.Album || config.languageLabels.unknownAlbum;

  showNotification(
    `<i class="fas fa-music" style="margin-right: 8px;"></i>${config.languageLabels.simdioynat}: ${musicPlayerState.currentTrackName}`,
    2000,
    'kontrol'
  );

  updateModernTrackInfo(track);
  updatePlaylistModal();

  if (musicPlayerState.stopLyricsSync) {
    try { musicPlayerState.stopLyricsSync(); } catch {}
  }
  _lyricsRunning = false;

  if (musicPlayerState.lyricsActive && !_lyricsRunning) {
    fetchLyrics();
    startLyricsSync();
    _lyricsRunning = true;
  }

  checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  clearMarqueeTimers();
  _marqueeT1 = disposables.addTimeout(setTimeout(() => {
    checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  }, 500));

  const audio = musicPlayerState.audio;
  disposables.addListener(audio, 'canplay', handleCanPlay, { once: true });
  disposables.addListener(audio, 'error', handlePlayError, { once: true });
  disposables.addListener(audio, 'loadedmetadata', handleLoadedMetadata, { once: true });
  setupAudioListeners();

  const audioUrl = apiUrl(`/Audio/${track.Id}/stream.mp3?Static=true`);
  audio.src = audioUrl;
  audio.load();

  updateNextTracks();
}

function getAudioUrl(track) {
  if (musicPlayerState.playlistSource === "jellyfin") {
    const trackId = track.Id || track.id;
    if (!trackId) {
      console.error("Parça Id Bulunamadı:", track);
      return null;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels.authRequired || "Kimlik doğrulama hatası"}`,
      3000,
      'error'
    );
      return null;
    }

    return apiUrl(`/Audio/${encodeURIComponent(trackId)}/stream.mp3?Static=true&api_key=${authToken}`);
  }

  return track.filePath || track.mediaSource ||
        (track.Id && apiUrl(`/Audio/${track.Id}/stream.mp3`));
}

function getEffectiveDuration() {
  const audio = musicPlayerState.audio;
  if (audio && isFinite(audio.duration)) return audio.duration;
  if (isFinite(musicPlayerState.currentTrackDuration)) return musicPlayerState.currentTrackDuration;
  return 0;
}

function handleLoadedMetadata() {
  const effectiveDuration = getEffectiveDuration();
  musicPlayerState.currentTrackDuration = effectiveDuration;

  updateDuration();
  updateProgress();

  if (!isFinite(effectiveDuration)) {
    if (_loadedMetaRetryT) { clearTimeout(_loadedMetaRetryT); _loadedMetaRetryT = null; }
    _loadedMetaRetryT = disposables.addTimeout(setTimeout(() => {
      updateDuration();
      updateProgress();
    }, 1000));
  }
}

async function reportPlaybackStart(track) {
  if (!track?.Id) return;

  try {
    const authToken = getAuthToken();
    if (!authToken) return;

    const response = await fetch(apiUrl(`/Sessions/Playing`), {
      method: "POST",
      headers: {
        "Authorization": `MediaBrowser Token="${authToken}"`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ItemId: track.Id,
        PlayMethod: "DirectStream",
        CanSeek: true,
        IsPaused: false,
        IsMuted: false,
        PositionTicks: 0
      })
    });

    if (!response.ok) {
      console.error("Oynatma başlatma raporu gönderilemedi:", response.status);
    }
  } catch (error) {
    console.error("Oynatma raporlama hatası:", error);
  }
}

async function reportPlaybackStopped(track, positionTicks) {
  if (!track?.Id) return;

  try {
    const authToken = getAuthToken();
    if (!authToken) return;

    const response = await fetch(apiUrl(`/Sessions/Playing/Stopped`), {
      method: "POST",
      headers: {
        "Authorization": `MediaBrowser Token="${authToken}"`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ItemId: track.Id,
        PlayMethod: "DirectStream",
        PositionTicks: positionTicks || 0
      })
    });

    if (!response.ok) {
      console.error("Oynatma durdurma raporu gönderilemedi:", response.status);
    }
  } catch (error) {
    console.error("Oynatma durdurma raporlama hatası:", error);
  }
}

function convertSecondsToTicks(seconds) {
  return seconds ? Math.floor(seconds * 10000000) : 0;
}
