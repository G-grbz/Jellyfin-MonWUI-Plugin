import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { updateMediaMetadata, initMediaSession, updatePositionState } from "../core/mediaSession.js";
import { getFromOfflineCache, cacheForOffline } from "../core/offlineCache.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { fetchLyrics, updateSyncedLyrics, startLyricsSync, stopLyricsSync } from "../lyrics/lyrics.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { showNotification } from "../ui/notification.js";
import { updateProgress, updateDuration, setupAudioListeners } from "./progress.js";
import {
  updateNextTracks,
  checkMarqueeNeeded,
  updateFavoriteButtonState,
  updatePlayerBackground,
  updateAlbumArt
} from "../ui/playerUI.js";
import { refreshPlaylist } from "../core/playlist.js";
import {
  applyRadioNowPlaying,
  attachRadioStream,
  cleanupAttachedRadioStream,
  getRadioTrackDisplayInfo,
  getRadioTrackArtistLine,
  getRadioStationSubtitle,
  isRadioTrack,
  resolveRadioStationArtUrl,
  resolveRadioStream
} from "../core/radio.js";
import { getVideoStreamUrl, getAuthHeader, getEmbyHeaders, getSessionInfo } from "/Plugins/JMSFusion/runtime/api.js";

const config = getConfig();
const SEEK_RETRY_DELAY = 0;
const DEFAULT_ARTWORK = "./slider/src/images/defaultArt.png";
const DEFAULT_ARTWORK_CSS = `url('${DEFAULT_ARTWORK}')`;

let currentCanPlayHandler = null;
let currentPlayErrorHandler = null;
let _metaReqId = 0;
let _artReqId = 0;
let _streamReqId = 0;
const resolvedAudioUrlCache = new Map();

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
  if (isRadioTrack(t) && musicPlayerState.playlist.length <= 1) {
    updatePlaybackUI(false);
    return;
  }
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

function isRadioPlaylist(playlist = musicPlayerState.playlist) {
  return Array.isArray(playlist) && playlist.length > 0 && playlist.every((track) => isRadioTrack(track));
}

function getTrackArtists(track) {
  if (isRadioTrack(track)) {
    return [getRadioTrackArtistLine(track)];
  }
  if (Array.isArray(track?.Artists) && track.Artists.length) {
    return track.Artists.map((artist) => typeof artist === "string" ? artist : artist?.Name).filter(Boolean);
  }
  if (Array.isArray(track?.ArtistItems) && track.ArtistItems.length) {
    return track.ArtistItems.map((artist) => artist?.Name).filter(Boolean);
  }
  if (track?.artist) return [track.artist];
  if (track?.Country) return [track.Country];
  return [config.languageLabels.unknownArtist];
}

function setModernPlayerTitle(title) {
  if (!musicPlayerState.modernTitleEl) return false;

  const nextTitle = String(title ?? "");
  if (musicPlayerState.modernTitleEl.textContent === nextTitle) return false;

  musicPlayerState.modernTitleEl.textContent = nextTitle;
  checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  clearMarqueeTimers();
  _marqueeT1 = disposables.addTimeout(setTimeout(() => {
    if (musicPlayerState.modernTitleEl?.textContent !== nextTitle) return;
    checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  }, 500));

  return true;
}

function setModernPlayerArtist(artist) {
  if (!musicPlayerState.modernArtistEl) return false;

  const nextArtist = String(artist ?? "");
  if (musicPlayerState.modernArtistEl.textContent === nextArtist) return false;

  musicPlayerState.modernArtistEl.textContent = nextArtist;
  return true;
}

function refreshLiveRadioTrackInfo(track) {
  if (!track) return;
  if (musicPlayerState.currentTrack?.Id !== track.Id) return;

  const liveInfo = getRadioTrackDisplayInfo(track);
  setModernPlayerTitle(liveInfo.playerTitle || liveInfo.title);
  setModernPlayerArtist(liveInfo.artist);

  musicPlayerState.currentTrackName = liveInfo.title;
  musicPlayerState.radioNowPlayingSource = track.NowPlayingText || track.nowPlayingText || getRadioStationSubtitle(track);
  updateMediaMetadata(track);
}

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
  if (isRadioTrack(t) && musicPlayerState.playlist.length <= 1) {
    updatePlaybackUI(false);
    return;
  }
  setTimeout(playNext, SEEK_RETRY_DELAY);
}

function cleanupAudioListeners() {
  const audio = musicPlayerState.audio;
  _streamReqId += 1;
  disposables.clearAll();
  try { stopLyricsSync(); } catch {}
  _lyricsRunning = false;
  try { musicPlayerState.__audioCtrl?.abort?.(); } catch {}
  musicPlayerState.__audioCtrl = null;

  if (!audio) return;

  cleanupAttachedRadioStream(audio);
  try { audio.pause(); } catch {}
  try { audio.removeEventListener('canplay', handleCanPlay); } catch {}
  try { audio.removeEventListener('error', handlePlayError); } catch {}
  try { audio.removeEventListener('loadedmetadata', handleLoadedMetadata); } catch {}
  audio.onended = null;
  audio.src = '';
  audio.removeAttribute('src');
  try { audio.load(); } catch {}
}

export async function stopPlayback({ resetSource = true } = {}) {
  const audio = musicPlayerState.audio;
  const currentTrack =
    musicPlayerState.currentTrack ||
    musicPlayerState.playlist?.[musicPlayerState.currentIndex] ||
    null;

  if (currentTrack && musicPlayerState.isPlayingReported) {
    await reportPlaybackStopped(
      currentTrack,
      convertSecondsToTicks(audio?.currentTime || 0)
    ).catch(() => {});
  }

  musicPlayerState.isPlayingReported = false;
  musicPlayerState.lastReportedItemId = null;

  cleanupAudioListeners();
  updatePlaybackUI(false);

  if (resetSource) {
    musicPlayerState.isLiveStream = false;
    musicPlayerState.currentTrackDuration = 0;
    musicPlayerState.radioNowPlayingSource = null;
  }
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
    if (musicPlayerState.playlistSource === "radio") {
      showNotification(
        config.languageLabels.radioPlaybackStopped || "Radyo yayini sonlandi",
        2000,
        'info'
      );
      return;
    }
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
  const liveRadio = isRadioPlaylist(playlist);
  const prevTrack = playlist[musicPlayerState.currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  const currentIndex = musicPlayerState.currentIndex;

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
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

  if (userSettings.removeOnPlay && !liveRadio) {
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
  const liveRadio = isRadioPlaylist(playlist);
  const prevTrack = playlist[currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio?.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
    showNotification(
      config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  const playableLength = effectivePlaylist.length || playlist.length;
  if (playableLength === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
    showNotification(
      config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  if (userSettings.removeOnPlay && !liveRadio && currentIndex >= 0 && currentIndex < playlist.length) {
    const removed = playlist.splice(currentIndex, 1);
    const removedTrackId = removed[0]?.Id;
    const effIdx = effectivePlaylist.findIndex(t => t.Id === removedTrackId);
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
      rnd = Math.floor(Math.random() * playableLength);
    } while (rnd === currentIndex && playableLength > 1);
    nextIndex = rnd;
  } else {
    if (userSettings.repeatMode === 'all') {
      nextIndex = (currentIndex + 1) % playableLength;
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= playableLength) {
        if (isRadioPlaylist(playlist)) {
          return playTrack(0);
        }
        updatePlaybackUI(false);
        showNotification(
          config.languageLabels.playlistEnded || "Oynatma listesi bitti, yenileniyor...",
          2000,
          'info'
        );
        return refreshPlaylist();
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

  const radioDisplay = isRadioTrack(track)
    ? getRadioTrackDisplayInfo(track)
    : null;
  const title = radioDisplay?.playerTitle || radioDisplay?.title || track.Name || config.languageLabels.unknownTrack;
  const artistLine = radioDisplay?.artist || getTrackArtists(track).join(", ");

  setModernPlayerTitle(title);
  setModernPlayerArtist(artistLine);
  updateMediaMetadata(track);

  await Promise.all([ loadAlbumArt(track), updateTrackMeta(track) ]);
  updatePlayerBackground();

  if (musicPlayerState.favoriteBtn) {
    updateFavoriteButtonState(track);
  }
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

  const appendMetaItem = (item) => {
    if (!item?.text) return;
    const span = document.createElement('span');
    span.className = `${item.key}-meta`;
    const label = config.languageLabels[item.key] || item.label || item.key;
    span.title = `${label}: ${item.text}`;
    span.innerHTML = `<i class="${item.icon}" style="margin-right:4px"></i>${item.text}`;

    if (item.compact) {
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
  };

  if (isRadioTrack(track)) {
    const radioMeta = [
      { key: 'radioLiveLabel', label: config.languageLabels.radioLiveLabel || "LIVE", icon: 'fas fa-broadcast-tower', text: config.languageLabels.radioLiveLabel || "LIVE", compact: true },
      { key: 'country', label: config.languageLabels.country || "Ülke", icon: 'fas fa-globe', text: track.Country || track.Language },
      { key: 'codec', label: config.languageLabels.codec || "Codec", icon: 'fas fa-wave-square', text: track.Codec || "" },
      { key: 'bitrate', label: config.languageLabels.bitrate || "Bitrate", icon: 'fas fa-tachometer-alt', text: track.Bitrate > 0 ? `${track.Bitrate} kbps` : "", compact: true },
      { key: 'tag', label: config.languageLabels.tags || "Etiket", icon: 'fas fa-tags', text: track.TagsText || "" }
    ];

    radioMeta.forEach(appendMetaItem);
    return;
  }

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
    appendMetaItem({
      ...item,
      compact: item.key === 'tracknumber' || item.key === 'year'
    });
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
  const artReqId = ++_artReqId;
  try {
    const artwork = await getArtworkFromSources(track);
    if (artReqId !== _artReqId) return;
    setAlbumArt(artwork);

    if (artwork && artwork !== DEFAULT_ARTWORK) {
      cacheForOffline(track.Id, 'artwork', artwork);
    }
  } catch (err) {
    console.error("Albüm kapağı yükleme hatası:", err);
    if (artReqId !== _artReqId) return;
    setAlbumArt(DEFAULT_ARTWORK);
  }
}

async function getArtworkFromSources(track) {
  try {
    if (isRadioTrack(track)) {
      return await resolveRadioStationArtUrl(track) || DEFAULT_ARTWORK;
    }

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

function getTrackId(track) {
  return track?.Id || track?.id || null;
}

function isDirectJellyfinAudioUrl(url) {
  const value = String(url || "");
  return /\/Audio\/[^/]+\/stream(?:\.\w+)?(?:\?|$)/i.test(value);
}

function syncResolvedTrackSource(trackId, url) {
  if (!trackId || !url) return;
  resolvedAudioUrlCache.set(trackId, url);

  const lists = [
    musicPlayerState.playlist,
    musicPlayerState.originalPlaylist,
    musicPlayerState.effectivePlaylist,
    musicPlayerState.combinedPlaylist,
  ];

  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((item) => {
      if (getTrackId(item) === trackId) {
        item.mediaSource = url;
      }
    });
  });

  if (getTrackId(musicPlayerState.currentTrack) === trackId && musicPlayerState.currentTrack) {
    musicPlayerState.currentTrack.mediaSource = url;
  }
}

function buildDirectAudioUrl(track) {
  const trackId = getTrackId(track);
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

async function resolveTrackAudioUrl(track) {
  if (!track) return null;
  if (track?.filePath) return track.filePath;

  const trackId = getTrackId(track);
  if (!trackId) return null;

  const cached = resolvedAudioUrlCache.get(trackId);
  if (cached) return cached;

  const existingSource = String(track?.mediaSource || "").trim();
  const shouldResolveViaPlaybackInfo =
    !existingSource ||
    isDirectJellyfinAudioUrl(existingSource) ||
    musicPlayerState.playlistSource === "jellyfin";

  if (shouldResolveViaPlaybackInfo) {
    try {
      const resolvedUrl = await getVideoStreamUrl(trackId, 360, 0);
      if (resolvedUrl) {
        syncResolvedTrackSource(trackId, resolvedUrl);
        return resolvedUrl;
      }
    } catch {}
  }

  if (existingSource) return existingSource;
  return buildDirectAudioUrl(track);
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
  musicPlayerState.currentTrack = track;
  musicPlayerState.isLiveStream = isRadioTrack(track);
  musicPlayerState.currentTrackDuration = isRadioTrack(track) ? Number.NaN : 0;
  musicPlayerState.currentTrackName = isRadioTrack(track)
    ? getRadioTrackDisplayInfo(track).title
    : (track.Name || config.languageLabels.unknownTrack);
  musicPlayerState.currentAlbumName = track.Album || config.languageLabels.unknownAlbum;
  musicPlayerState.radioNowPlayingSource = isRadioTrack(track)
    ? getRadioStationSubtitle(track)
    : null;

  showNotification(
    `${isRadioTrack(track) ? '<i class="fas fa-broadcast-tower" style="margin-right: 8px;"></i>' : '<i class="fas fa-music" style="margin-right: 8px;"></i>'}${config.languageLabels.simdioynat}: ${musicPlayerState.currentTrackName}`,
    2000,
    'kontrol'
  );

  updateModernTrackInfo(track);
  updatePlaylistModal();

  try { stopLyricsSync(); } catch {}
  _lyricsRunning = false;

  if (musicPlayerState.lyricsActive) {
    fetchLyrics();
    if (!_lyricsRunning && !isRadioTrack(track)) {
      startLyricsSync();
      _lyricsRunning = true;
    }
  }

  const audio = musicPlayerState.audio;
  disposables.addListener(audio, 'canplay', handleCanPlay, { once: true });
  disposables.addListener(audio, 'error', handlePlayError, { once: true });
  disposables.addListener(audio, 'loadedmetadata', handleLoadedMetadata, { once: true });
  setupAudioListeners();

  if (isRadioTrack(track)) {
    try {
      audio.removeAttribute("crossorigin");
      audio.crossOrigin = null;
    } catch {}
    (async () => {
      try {
        const { url, station } = await resolveRadioStream(track);
        Object.assign(track, {
          StreamUrl: station.url || track.StreamUrl,
          ResolvedUrl: url,
          StationUuid: station.stationuuid || track.StationUuid,
          Logo: station.logo || track.Logo || track.LogoUrl || track.ImageUrl,
          LogoUrl: station.logo || track.LogoUrl || track.Logo || track.ImageUrl,
          ImageUrl: station.logo || track.ImageUrl || track.LogoUrl || track.Logo,
          Favicon: station.favicon || track.Favicon,
          Country: station.country || track.Country,
          Language: station.language || track.Language,
          CurrentArtist: station.currentArtist || track.CurrentArtist,
          CurrentTitle: station.currentTitle || track.CurrentTitle,
          NowPlayingText: station.nowPlayingText || track.NowPlayingText,
          TagsText: station.tags || track.TagsText,
          Codec: station.codec || track.Codec,
          Bitrate: station.bitrate || track.Bitrate,
          Hls: station.hls || track.Hls
        });
        applyRadioNowPlaying(track, station);
        refreshLiveRadioTrackInfo(track);
        await attachRadioStream(audio, url, {
          disableMetadataReader: station.metadataReaderDisabled === true,
          onMetadata: (metadata) => {
            if (!applyRadioNowPlaying(track, metadata)) return;
            refreshLiveRadioTrackInfo(track);
          }
        });
      } catch (error) {
        handlePlaybackError(error, 'radio');
      }
    })();
  } else {
    try {
      audio.crossOrigin = "anonymous";
    } catch {}
    const streamReqId = ++_streamReqId;
    (async () => {
      const audioUrl = await resolveTrackAudioUrl(track);
      if (streamReqId !== _streamReqId) return;
      if (!audioUrl) {
        handlePlaybackError(new Error("Audio source unavailable"), "resolve-url");
        return;
      }
      audio.src = audioUrl;
      audio.load();
    })();
  }

  updateNextTracks();
}

function getAudioUrl(track) {
  if (track?.filePath) return track.filePath;
  if (track?.mediaSource) return track.mediaSource;
  const trackId = getTrackId(track);
  if (trackId) {
    const cached = resolvedAudioUrlCache.get(trackId);
    if (cached) return cached;
  }
  return buildDirectAudioUrl(track);
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
  if (!track?.Id || isRadioTrack(track)) return;

  try {
    const authToken = getAuthToken();
    if (!authToken) return;
    const session = getSessionInfo?.() || {};
    const authHeader = getAuthHeader?.() || `MediaBrowser Token="${authToken}"`;
    const headers = getEmbyHeaders?.({
      "Content-Type": "application/json",
      "Authorization": authHeader
    }) || {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    };
    if (session?.userId) {
      headers["X-Emby-UserId"] = session.userId;
      headers["X-MediaBrowser-UserId"] = session.userId;
    }

    const response = await fetch(apiUrl(`/Sessions/Playing`), {
      method: "POST",
      headers,
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
  if (!track?.Id || isRadioTrack(track)) return;

  try {
    const authToken = getAuthToken();
    if (!authToken) return;
    const session = getSessionInfo?.() || {};
    const authHeader = getAuthHeader?.() || `MediaBrowser Token="${authToken}"`;
    const headers = getEmbyHeaders?.({
      "Content-Type": "application/json",
      "Authorization": authHeader
    }) || {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    };
    if (session?.userId) {
      headers["X-Emby-UserId"] = session.userId;
      headers["X-MediaBrowser-UserId"] = session.userId;
    }

    const response = await fetch(apiUrl(`/Sessions/Playing/Stopped`), {
      method: "POST",
      headers,
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
