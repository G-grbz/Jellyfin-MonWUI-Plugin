import { getConfig } from './config.js';
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { playNow, getVideoStreamUrl, fetchItemDetails, fetchPlayableItemDetails, updateFavoriteStatus, goToDetailsPage, fetchLocalTrailers, pickBestLocalTrailer, getCachedUserTopGenres } from './api.js';
import { getYoutubeEmbedUrl, isValidUrl } from './utils.js';
import { getVideoQualityText } from './containerUtils.js';
import { attachMiniPosterHover, openMiniPopoverFor } from "./studioHubsUtils.js";
import { positionModalRelativeToDot, centerActiveDot } from "./navigation.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';
import { applyDotPosterAnimation } from "./animations.js";
import { getCurrentIndex } from "./sliderState.js";
import { openDetailsModal } from "./detailsModal.js";
import { withServer } from "./jfUrl.js";

const REOPEN_BLOCK_MS = 600;
const IS_TOUCH = (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
const HARD_CLOSE_BUFFER_MS = 20;
export const REOPEN_COOLDOWN_MS    = 400;
const CROSS_ITEM_SETTLE_MS  = 80;
export const OPEN_HOVER_DELAY_MS   = 500;
const config = getConfig();
const currentLang = config.defaultLanguage || getDefaultLanguage();
if (!config.languageLabels) {
  config.languageLabels = getLanguageLabels(currentLang) || {};
}
const DEVICE_MEM_GB = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 4;
export const PREVIEW_MAX_ENTRIES = Math.max(50, Math.min(200, Math.floor(DEVICE_MEM_GB * 60)));
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const PREVIEW_EVICT_BATCH = Math.max(10, Math.floor(PREVIEW_MAX_ENTRIES * 0.15));
export const previewPreloadCache = new Map();
const _ytPlayers = new Map();
const _ytReadyMap = new Map();
const _seriesTrailerCache = new Map();
const MAX_META_CACHE = 1000;
const MODAL_ANIM = {
  openMs: 250,
  closeMs: 180,
  ease: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  scaleFrom: 0.92,
  scaleTo: 1,
  opacityFrom: 0,
  opacityTo: 1,
  translateFromY: 8,
  translateToY: 0
};

function canUseYTOriginAndJSAPI() {
  try {
    const isHttps = window.location.protocol === 'https:';
    const host = new URL(window.location.href).hostname;
    const isPrivateHost =
      /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
    return isHttps && !isPrivateHost;
  } catch {
    return false;
  }
}

const CAN_USE_YT_API = canUseYTOriginAndJSAPI();

function absServerUrl(url) {
  try {
    if (!url) return url;
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return withServer(url);
    return url;
  } catch { return url; }
}

function capMap(m) {
  try {
    if (m.size <= MAX_META_CACHE) return;
    let n = m.size - MAX_META_CACHE;
    for (const k of m.keys()) {
      m.delete(k);
      if (--n <= 0) break;
    }
  } catch {}
}

const hasTrailerCache = new Map();
const pendingHasTrailer = new Map();
const _seriesIdCache = new Map();
const CONCURRENCY = Math.max(2, Math.min(6, (navigator.deviceMemory || 4) | 0));
const rIC = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 50));

function isTouchDevice() {
  return (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
}

try {
  if (isTouchDevice()) document.documentElement.classList.add('touch-device');
} catch {}

function isMobileAppEnv() {
  try {
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)')?.matches;
    const ua = navigator.userAgent || '';
    const isWV = /\bwv\b|Crosswalk/i.test(ua);
    const hasBridge = !!(window.cordova || window.Capacitor || window.ReactNativeWebView);
    return !!(standalone || isWV || hasBridge);
  } catch { return false; }
}
function suppressHoverOpens(ms = 1000) {
  modalState.__suppressOpenUntil = Date.now() + ms;
  try { if (modalState._hoverOpenTimer) { clearTimeout(modalState._hoverOpenTimer); modalState._hoverOpenTimer = null; } } catch {}
  try { modalState.itemHoverAbortController?.abort?.(); } catch {}
}

let inFlight = 0;
let __renderToken = 0;

function newRenderToken() { return (++__renderToken); }

function isTokenAlive(token) { return token === __renderToken; }

function hardWipeModalDom(modal = modalState.videoModal) {
  if (!modal) return;
  try { modal.dataset.itemId = ''; } catch {}
  const backdrop = modal.querySelector?.('.preview-backdrop');
  if (backdrop) { try { backdrop.style.opacity = '0'; backdrop.removeAttribute('src'); backdrop.removeAttribute('srcset'); } catch {} }
  const iframe = modal.querySelector?.('.preview-trailer-iframe');
  if (iframe) { try { iframe.src = ''; iframe.style.display = 'none'; iframe.__wrapper && (iframe.__wrapper.style.display = 'none'); } catch {} }
  const v = modalState.modalVideo;
  if (v) {
    try {
      if (v._hls) { v._hls.destroy(); delete v._hls; }
      v.pause(); v.removeAttribute('src'); v.load(); v.style.opacity = '0'; v.style.display = 'none';
    } catch {}
  }
  try { resetModalInfo(modal); } catch {}
  try { resetModalButtons(); } catch {}
  try { clearTransientOverlays(modal); } catch {}
  try {
    const matchBtn = modal.querySelector('.preview-match-button');
    if (matchBtn) {
      matchBtn.textContent = '';
      matchBtn.style.display = 'none';
    }
  } catch {}
}

export async function updateModalContent(item, videoUrl) {
  const modal = modalState.videoModal;
  if (!modal || !document.body.contains(modal)) return;
  if (modal?.dataset?.itemId && item?.Id && String(item.Id) !== String(modal.dataset.itemId)) return;
  const cfg = getConfig();

  clearTransientOverlays(modal);
  if (modalState.modalVideo && modalState.modalVideo._hls) {
    modalState.modalVideo._hls.destroy();
    delete modalState.modalVideo._hls;
  }

  const contextIsDot = modalState._modalContext === 'dot';
  const dotMode = cfg.dotPreviewPlaybackMode || null;
  const onlyTrailerGlobal   = !!cfg.onlyTrailerInPreviewModal;
  const preferTrailerGlobal = !!cfg.preferTrailersInPreviewModal;
  let onlyTrailer = false, preferTrailer = false;

  if (contextIsDot) {
    if (dotMode === 'onlyTrailer')      { onlyTrailer = true;  preferTrailer = false; }
    else if (dotMode === 'trailer')     { onlyTrailer = false; preferTrailer = true;  }
    else if (dotMode === 'video')       { onlyTrailer = false; preferTrailer = false; }
    else                                { onlyTrailer = onlyTrailerGlobal; preferTrailer = preferTrailerGlobal; }
  } else {
    onlyTrailer = onlyTrailerGlobal;
    preferTrailer = preferTrailerGlobal;
  }

  const trailerInfo = await resolveTrailerUrlFor(item);
  const trailerUrl = trailerInfo.url;
  const isLocal = trailerInfo.level === 'local';
  const isYTValid = !!trailerUrl && (trailerInfo.level === 'item' || trailerInfo.level === 'series');

  const showYT = (labelText) => {
    const iframe = getOrCreateTrailerIframe(modal);
    const wantSoundStart = ((isMobileAppEnv() || !IS_TOUCH) && !!modalState._soundOn);
    iframe.src = ensureYTParams(trailerUrl, {
      autoplay: true,
      muteInitial: !wantSoundStart,
      enableJsApi: CAN_USE_YT_API
    });
    iframe.__wrapper && (iframe.__wrapper.style.display = 'block');
    iframe.style.display = 'block';
    showYTFirstTouchShield(iframe, 380);
    sizeYTToCover(iframe);
    if (CAN_USE_YT_API) ensureYTAPI().then(() => installYTPlayer(iframe));
    if (labelText) addTrailerTip(modal, labelText);
    const btn = modal?.querySelector?.('.preview-volume-button');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  };

  if (modalState.modalButtonsContainer) {
    modalState.modalButtonsContainer.style.opacity = '1';
    modalState.modalButtonsContainer.style.pointerEvents = 'auto';
    modalState.modalButtonsContainer.classList.remove('preview-buttons--hidden');
  }

  if (onlyTrailer) {
    if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (await gatePlaybackStart(item?.Id)) modal.initHlsPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels?.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showYT(trailerInfo.level === 'series'
        ? (cfg.languageLabels?.diziFragmani || 'Dizi fragmanı')
        : (cfg.languageLabels?.fragman || 'Fragman'));
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showNoTrailerMessage(modal, cfg.languageLabels?.trailerNotAvailable || 'Fragman bulunamadı');
    }
  }
  else if (preferTrailer) {
    if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (await gatePlaybackStart(item?.Id)) modal.initHlsPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels?.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.style.opacity = '0';
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showYT(trailerInfo.level === 'series'
        ? (cfg.languageLabels?.diziFragmani || 'Dizi fragmanı')
        : (cfg.languageLabels?.fragman || 'Fragman'));
    } else if (videoUrl) {
      if (await gatePlaybackStart(item?.Id)) modal.initHlsPlayer(videoUrl);
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.src = '';
        modalState.modalVideo.style.display = 'none';
      }
    }
  }
  else {
    if (videoUrl) {
      if (await gatePlaybackStart(item?.Id)) modal.initHlsPlayer(videoUrl);
    } else if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (await gatePlaybackStart(item?.Id)) modal.initHlsPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels?.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      if (await gatePlaybackStart(item?.Id)) {
        showYT(trailerInfo.level === 'series'
          ? (cfg.languageLabels?.diziFragmani || 'Dizi fragmanı')
          : (cfg.languageLabels?.fragman || 'Fragman'));
      }
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.src = '';
        modalState.modalVideo.style.display = 'none';
      }
    }
  }

  if (item?.Type === 'Episode') {
    const seriesTitle = item.SeriesName || item.Series?.Name || '';
    if (modalState.modalTitle) modalState.modalTitle.textContent = seriesTitle || (item.Name || item.Title || '');
    if (modalState.modalEpisodeLine) {
      modalState.modalEpisodeLine.style.display = 'block';
      modalState.modalEpisodeLine.textContent = formatSeasonEpisodeLine(item);
    }
  } else {
    if (modalState.modalTitle) modalState.modalTitle.textContent = item.Name || item.Title || '';
    if (modalState.modalEpisodeLine) {
      modalState.modalEpisodeLine.textContent = '';
      modalState.modalEpisodeLine.style.display = 'none';
    }
  }

  const positionTicks = Number(item.UserData?.PlaybackPositionTicks || 0);
  const runtimeTicks = Number(item.RunTimeTicks || 0);
  const hasPartialPlayback = positionTicks > 0 && positionTicks < runtimeTicks;
  const isPlayed = item.UserData?.Played || false;
  const isFavorite = item.UserData?.IsFavorite || false;
  const videoStream = item.MediaStreams ? item.MediaStreams.find(s => s.Type === "Video") : null;
  const qualityText = videoStream ? getVideoQualityText(videoStream) : '';

  modalState.modalMeta.innerHTML = [
    qualityText,
    item.ProductionYear,
    item.CommunityRating ? parseFloat(item.CommunityRating).toFixed(1) : null,
    runtimeTicks ? `${Math.floor(runtimeTicks / 600000000)} ${config.languageLabels.dk}` : null
  ].filter(Boolean).join(' • ');

  const matchPercentage = await calculateMatchPercentage(item.UserData, item);
  if (modalState.modalMatchButton) {
    modalState.modalMatchButton.textContent = `${matchPercentage}%`;
    modalState.modalMatchButton.style.display = 'flex';
  }

  modalState.modalGenres.innerHTML = '';
  if (item.Genres && item.Genres.length > 0) {
    const limitedGenres = item.Genres.slice(0, 3);
    limitedGenres.forEach((genre, index) => {
      const genreBadge = document.createElement('span');
      genreBadge.className = 'genre-badge';
      genreBadge.textContent = genre.trim();
      modalState.modalGenres.appendChild(genreBadge);
      if (index < limitedGenres.length - 1) {
        const separator = document.createElement('span');
        separator.className = 'genre-separator';
        separator.textContent = ' • ';
        separator.style.margin = '0 4px';
        separator.style.color = '#a8aac7';
        modalState.modalGenres.appendChild(separator);
      }
    });
  }

  modalState.modalPlayButton.innerHTML = `<i class="fa-solid fa-play"></i> ${getPlayButtonText({ isPlayed, hasPartialPlayback })}`;
  modalState.modalFavoriteButton.classList.toggle('favorited', isFavorite);
  modalState.modalFavoriteButton.innerHTML = isFavorite ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-plus"></i>';

  if (modalState.modalButtonsContainer) {
    modalState.modalButtonsContainer.style.opacity = '1';
    modalState.modalButtonsContainer.style.pointerEvents = 'auto';
  }

  applyVolumePreference(modal);
}

export function closeVideoModal() {
  if (!modalState.videoModal || modalState.videoModal.style.display === "none") return;

  modalState._isModalClosing = true;
  modalState._modalClosingUntil = Date.now() + MODAL_ANIM.closeMs + HARD_CLOSE_BUFFER_MS;

  clearTimeout(modalState.modalHideTimeout);
  const modal = modalState.videoModal;

  try {
   modal.style.transition = '';
   modal.style.opacity = '';
   modal.style.transform = '';
 } catch {}

  modal.classList.remove('video-preview-modal--visible');
  modal.classList.add('video-preview-modal--hidden');

  softStopPlayback();

  setTimeout(() => {
    if (modalState.videoModal) {
      clearTransientOverlays(modalState.videoModal);
      modalState.videoModal.style.display = 'none';
      modalState.videoModal.classList.remove('video-preview-modal--hidden');
      try { hardWipeModalDom(modalState.videoModal); } catch {}
      try { clearWillChange(modalState.videoModal); } catch {}
    }
    modalState._lastModalHideAt = Date.now();
    modalState._isModalClosing = false;
  }, MODAL_ANIM.closeMs);
}

export function animatedShow(modal) {
  if (!modal) return;

  modal.style.display = 'block';
  modal.style.transition = 'none';
  modal.classList.add('video-preview-modal--hidden');
  modal.classList.remove('video-preview-modal--visible');
  void modal.offsetWidth;

  requestAnimationFrame(() => {
    modal.style.transition = `opacity ${MODAL_ANIM.openMs}ms ${MODAL_ANIM.ease}, transform ${MODAL_ANIM.openMs}ms ${MODAL_ANIM.ease}`;
    modal.classList.add('video-preview-modal--visible');
    modal.classList.remove('video-preview-modal--hidden');
    modal.style.opacity = '';
    modal.style.transform = '';

    const buttonsContainer = modal.querySelector('.preview-buttons');
    if (buttonsContainer) {
      buttonsContainer.style.opacity = '1';
      buttonsContainer.style.pointerEvents = 'auto';
    }
  });
}

function animateModalContent(modal, isOpening) {
  if (!modal) return;

  const elements = [
    modal.querySelector('.video-container'),
    modal.querySelector('.preview-info'),
    modal.querySelector('.preview-buttons')
  ].filter(Boolean);

  elements.forEach((el, index) => {
    if (isOpening) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 50 + (index * 80));
    } else {
      el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(5px)';
    }
  });
}

export function createVideoModal({ showButtons = true, context = 'dot' } = {}) {
  if (!config) return null;
  const allow = (context === 'dot')
   ? (config.previewModal !== false)
   : (config.allPreviewModal !== false);
  if (!allow) return null;

  injectOrUpdateModalStyle();
  destroyVideoModal();

  const modal = document.createElement('div');
  modal.className = 'video-preview-modal';
  modal.style.display = 'none';

  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';

  const backdropImg = document.createElement('img');
  backdropImg.className = 'preview-backdrop';
  backdropImg.alt = '';
  backdropImg.decoding = 'async';
  backdropImg.loading = 'lazy';
  videoContainer.appendChild(backdropImg);

  const video = document.createElement('video');
  video.className = 'preview-video';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('x-webkit-airplay', 'allow');
  video.autoplay = true;
  video.muted = !modalState._soundOn;
  video.loop = true;
  video.playsInline = true;
  video.addEventListener('stalled', () => video.load());
  video.addEventListener('playing', () => {
    video.style.opacity = '1';
    try { modal?.hideBackdrop?.(); } catch {}
  });

  const infoContainer = document.createElement('div');
  infoContainer.className = 'preview-info';
  const title = document.createElement('div');
  title.className = 'preview-title';
  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  const genres = document.createElement('div');
  genres.className = 'preview-genres';
  const episodeLine = document.createElement('div');
  episodeLine.className = 'preview-episode';

  infoContainer.append(title, episodeLine, meta, genres);

  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'preview-buttons';
  buttonsContainer.style.opacity = '1';
  buttonsContainer.style.pointerEvents = 'auto';
  modalState.modalButtonsContainer = buttonsContainer;

  const matchButton = document.createElement('button');
  matchButton.className = 'preview-match-button';
  matchButton.textContent = '';

  const playButton = document.createElement('button');
  playButton.className = 'preview-play-button';
  playButton.innerHTML = `<i class="fa-solid fa-play"></i>${L('izle') ? ' ' + L('izle') : ''}`;

  const favoriteButton = document.createElement('button');
  favoriteButton.className = 'preview-favorite-button';
  favoriteButton.innerHTML = '<i class="fa-solid fa-plus"></i>';

  const infoButton = document.createElement('button');
  infoButton.className = 'preview-info-button';
  infoButton.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

  const volumeButton = document.createElement('button');
  volumeButton.className = 'preview-volume-button';

  buttonsContainer.append(matchButton, playButton, favoriteButton, infoButton, volumeButton);

  const closeMobileBtn = document.createElement('button');
  closeMobileBtn.className = 'preview-close-mobile';
  closeMobileBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeMobileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeVideoModal();
  });

  playButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const itemId = modal.dataset.itemId;
    if (!itemId) { alert("Oynatma başarısız: itemId bulunamadı"); return; }
    closeVideoModal();
    try { await playNow(itemId); }
    catch (error) { console.error("Oynatma hatası:", error); alert("Oynatma başarısız: " + error.message); }
    finally { closeVideoModal(); }
  });

  favoriteButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const itemId = modal.dataset.itemId;
    if (!itemId) return;
    try {
      const isFavorite = favoriteButton.classList.contains('favorited');
      await updateFavoriteStatus(itemId, !isFavorite);

      favoriteButton.classList.toggle('favorited', !isFavorite);
      favoriteButton.innerHTML = isFavorite ? '<i class="fa-solid fa-plus"></i>' : '<i class="fa-solid fa-check"></i>';
      const slide = document.querySelector(`.slide[data-item-id="${itemId}"]`);
      if (slide) {
        const item = await fetchItemDetails(itemId);
        const isFav = item.UserData?.IsFavorite || false;
        const isPlayed = item.UserData?.Played || false;
        slide.dataset.favorite = isFav.toString();
        slide.dataset.played = isPlayed.toString();
      }
    } catch (error) {
      console.error("Favori durumu güncelleme hatası:", error);
    }
  });

  infoButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const itemId = modal.dataset.itemId;
    if (!itemId) return;

    await ensureOverlaysClosed();

    if (typeof openDetailsModal === 'function') {
      openDetailsModal({ itemId });
    } else {
      if (window.showItemDetailsPage) return window.showItemDetailsPage(itemId);
      const dialog = document.querySelector('.dialogContainer');
      if (dialog) {
        const event = new CustomEvent('showItemDetails', { detail: { Id: itemId } });
        document.dispatchEvent(event);
        return;
      }
      return goToDetailsPageSafe(itemId);
    }
  });

  const onVolumeTap = async (e) => {
    const now = Date.now();
    if (now - modalState.__volTapGuardAt < 250) return;
    modalState.__volTapGuardAt = now;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const trailerIframe = modalState.videoModal?.querySelector?.('.preview-trailer-iframe');
    const trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';

    if (trailerVisible) {
      try {
        const player = _ytPlayers.get(trailerIframe);
        if (!player || typeof player.getVolume !== 'function') {
          toggleYouTubeVolumeManual(trailerIframe, volumeButton);
          return;
        }
        const isMuted = typeof player.isMuted === 'function' ? player.isMuted() : (player.getVolume?.() === 0);
        if (isMuted) {
          player.unMute?.();
          player.setVolume?.(100);
          player.playVideo?.();
          volumeButton.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        } else {
          player.mute?.();
          volumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        }
      } catch (err) {
        console.error('Player ses kontrol hatası:', err);
        toggleYouTubeVolumeManual(trailerIframe, volumeButton);
      }
      return;
    }

    if (modalState.modalVideo) {
      modalState.modalVideo.muted = !modalState.modalVideo.muted;
      modalState.modalVideo.volume = modalState.modalVideo.muted ? 0 : 1.0;
      volumeButton.innerHTML = modalState.modalVideo.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  };

  volumeButton.addEventListener('touchstart', onVolumeTap, { passive: false });
  volumeButton.addEventListener('click', onVolumeTap, { passive: false });
  [playButton, favoriteButton, infoButton, volumeButton, matchButton].forEach(button => {
    button.addEventListener('mouseenter', () => button.style.transform = 'scale(1.11)');
    button.addEventListener('mouseleave', () => button.style.transform = '');
  });

  modal.addEventListener('mouseenter', () => {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });

  const onModalLeave = () => {
  modalState.isMouseInModal = false;
  closeVideoModal();
  };
  modal.addEventListener('mouseleave', onModalLeave);
  modal.addEventListener('pointerleave', onModalLeave);

  modal.addEventListener('click', (e) => {
    const isBgTap = (e.target === modal) || e.target.classList.contains('video-container');
    if (!isBgTap) return;

    setGlobalSound(!modalState._soundOn);

    const trailerIframe = modal.querySelector('.preview-trailer-iframe');
    const trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';
    const volumeButton = modal.querySelector('.preview-volume-button');

    if (trailerVisible) {
      volumeButton?.click();
    } else if (modalState.modalVideo) {
      modalState.modalVideo.muted = !modalState.modalVideo.muted;
      modalState.modalVideo.volume = modalState.modalVideo.muted ? 0 : 1.0;
      volumeButton.innerHTML = modalState.modalVideo.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  });

  videoContainer.appendChild(video);
  modal.appendChild(videoContainer);
  modal.appendChild(closeMobileBtn);

  modal.setBackdrop = function(url) {
    try {
      if (!url) return;
      let finalUrl = url;
      if (url.startsWith('/') && !url.startsWith('//')) {
        finalUrl = withServer(url);
      }
      const img = modal.querySelector('.preview-backdrop');
      img.src = finalUrl;
      img.style.opacity = '1';
    } catch {}
  };

  modal.hideBackdrop = function() {
    try {
      modal.querySelector('.preview-backdrop').style.opacity = '0';
    } catch {}
  };

  if (showButtons) modal.appendChild(buttonsContainer);
  modal.appendChild(infoContainer);
  modal.initHlsPlayer = async function(url) {
    url = absServerUrl(url);
    if (video._hls) { video._hls.destroy(); delete video._hls; }
    video.pause();
    video.src = '';
    video.load();
    video.style.opacity = '0';
    video.style.transition = 'opacity 0.3s ease-in-out';
    hideTrailerIframe(modal);
    video.style.display = 'block';
    if (showButtons) modal.appendChild(buttonsContainer);
    await sleep(150);

    if (window.Hls && Hls.isSupported && Hls.isSupported() && url.includes('.m3u8')) {
      const hls = new Hls({
        enableWorker: true, lowLatencyMode: true,
        maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5, startLevel: -1, abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95, abrBandWidthUpFactor: 0.7, abrEwmaSlowVoD: 5000
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      const startAt = 10 * 60;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hls.startLoad(startAt);
        Promise.resolve(video.play()).catch(e => { if (e.name !== 'AbortError') console.warn('Video oynatma hatası:', e); });
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
            case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
            default:
              hls.destroy();
              setTimeout(() => startVideoPlayback(url), 150);
              break;
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR) {
          hls.recoverMediaError();
        }
      });
      video._hls = hls;
    } else {
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = 10 * 60;
        Promise.resolve(video.play()).catch(e => { if (e.name !== 'AbortError') console.warn('Video oynatma hatası:', e); });
      }, { once: true });
    }
  };

  modal.cleanupHls = function() {
    if (video && video._hls) { video._hls.destroy(); delete video._hls; }
    hideTrailerIframe(modal);
  };

  document.body.appendChild(modal);

  modalState.videoModal = modal;
  modalState.modalVideo = video;
  modalState.modalTitle = title;
  modalState.modalMeta = meta;
  modalState.modalGenres = genres;
  modalState.modalEpisodeLine = episodeLine;
  modalState.modalPlayButton = playButton;
  modalState.modalFavoriteButton = favoriteButton;
  modalState.modalMatchButton = matchButton;
  modalState.modalButtonsContainer = buttonsContainer;
  modalState._modalContext = context;

  bindModalHover(modal);

  return { modal, video, title, meta, genres, matchButton, playButton, favoriteButton, infoButton, volumeButton, episodeLine, buttonsContainer };
}


function installHoverOpenSuppressors() {
  if (window.__hoverOpenSuppressInstalled) return;
  window.__hoverOpenSuppressInstalled = true;

  const kill = () => suppressHoverOpens(1200);
  const cardDown = (e) => {
    if (e.target?.closest?.('.jms-trailer-badge, .yt-first-touch-shield')) return;
    if (e.target?.closest?.('.cardImageContainer,[data-id]')) kill();
  };
  ['pointerdown','mousedown','touchstart','click'].forEach(t => {
    document.addEventListener(t, cardDown, { capture: true, passive: false });
  });
  const linkDown = (e) => {
    if (e.target?.closest?.('.jms-trailer-badge, .yt-first-touch-shield')) return;
    if (e.target?.closest?.('a[href],button,[role="link"]')) kill();
  };
  ['pointerdown','mousedown','touchstart','click'].forEach(t => {
    document.addEventListener(t, linkDown, { capture: true, passive: false });
  });
  const onNav = () => suppressHoverOpens(1200);
  window.addEventListener('popstate',  onNav, true);
  window.addEventListener('hashchange',onNav, true);
  window.addEventListener('beforeunload', () => suppressHoverOpens(5000));
  window.addEventListener('pagehide',     () => suppressHoverOpens(5000));
}

installHoverOpenSuppressors();

function onFirstInteraction(cb, timeoutMs = 1500) {
  let fired = false;
  const fire = () => { if (fired) return; fired = true; cleanup(); cb(); };
  const cleanup = () => {
    ['mousedown','mousemove','touchstart','keydown','scroll']
      .forEach(t => window.removeEventListener(t, fire, { capture:true }));
  };
  ['mousedown','mousemove','touchstart','keydown','scroll']
    .forEach(t => window.addEventListener(t, fire, { capture:true, once:true }));
  setTimeout(fire, timeoutMs);
}

function chunkIter(nodes, fn, { size = 50, delayMs = 16, useIdle = true } = {}) {
  let i = 0, dead = false;
  const tick = () => {
    if (dead) return;
    const end = Math.min(i + size, nodes.length);
    for (; i < end; i++) fn(nodes[i], i);
    if (i < nodes.length) {
      if (useIdle) rIC(() => setTimeout(tick, delayMs));
      else setTimeout(tick, delayMs);
    }
  };
  tick();
  return () => { dead = true; };
}

function ensureGlobalModal() {
  if (modalState.videoModal &&
      document.body.contains(modalState.videoModal) &&
      modalState._modalContext === 'global') {
    return modalState.videoModal;
  }
  try { destroyVideoModal(); } catch {}
  const res = createVideoModal({ showButtons: true, context: 'global' });
  return res?.modal || null;
}

function _debounce(fn, wait = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

 function mountStudioMiniForAll() {
   const cfg = getConfig();
   if (!cfg || cfg.globalPreviewMode !== 'studioMini') return;

  const items = document.querySelectorAll('.cardImageContainer');
  if (!items.length) return;
  chunkIter(items, (item) => {
    if (item.__miniBound) return;
    const itemId =
      item.dataset.itemId ||
      item.dataset.id ||
      item.closest?.('[data-id]')?.dataset?.id;
    if (!itemId) return;
    item.__miniBound = true;
    attachMiniPosterHover(item, { Id: itemId });
  }, { size: 60, delayMs: 12, useIdle: true });
 }

function installStudioMiniAutobind() {
  if (window.__studioMiniObsInstalled) return;
  window.__studioMiniObsInstalled = true;

  const rebind = _debounce(() => {
    try { mountStudioMiniForAll(); } catch {}
  }, 120);
  window.addEventListener('hashchange', () => rebind(), true);
  window.addEventListener('popstate',   () => rebind(), true);
  const obs = new MutationObserver((mutList) => {
    for (const m of mutList) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList?.contains('cardImageContainer') || n.querySelector?.('.cardImageContainer')) {
          rebind();
          return;
        }
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
  window.__studioMiniObs = obs;
  window.addEventListener('jms:globalPreviewModeChanged', (ev) => {
    try { ensureOverlaysClosed(); } catch {}
    rebind();
  });
  onFirstInteraction(() => rebind(), 1200);
}

installStudioMiniAutobind();

async function hasTrailerForItemId(itemId, { signal } = {}) {
  if (!itemId) return false;
  if (hasTrailerCache.has(itemId)) return hasTrailerCache.get(itemId);
  if (pendingHasTrailer.has(itemId)) return pendingHasTrailer.get(itemId);

  const task = (async () => {
    while (inFlight >= CONCURRENCY) {
      await new Promise(r => setTimeout(r, 35));
      if (signal?.aborted) return false;
    }
    inFlight++;
    try {
      const item = await fetchPlayableItemDetails(itemId, { signal });
      if (!item) {
        hasTrailerCache.set(itemId, false);
        capMap(hasTrailerCache);
        return false;
      }

      try {
        const locals = await fetchLocalTrailers(item.Id, { signal });
        if (Array.isArray(locals) && locals.length > 0) {
          hasTrailerCache.set(itemId, true);
          capMap(hasTrailerCache);
          return true;
        }
      } catch {}

      if (pickYouTubeTrailerUrl(item?.RemoteTrailers)) {
        hasTrailerCache.set(itemId, true);
        capMap(hasTrailerCache);
        return true;
      }

      let seriesId = item.Type === 'Series' ? item.Id : (item.SeriesId || null);
      if (!seriesId) {
        if (_seriesIdCache.has(item.Id)) seriesId = _seriesIdCache.get(item.Id);
        else {
          seriesId = await findSeriesIdByClimbing(item);
          _seriesIdCache.set(item.Id, seriesId);
          capMap(_seriesIdCache);
        }
      }
      if (seriesId) {
        const sUrl = await getSeriesTrailerUrl(seriesId);
        if (sUrl) {
          hasTrailerCache.set(itemId, true);
          capMap(hasTrailerCache);
          return true;
        }
      }
      hasTrailerCache.set(itemId, false);
      capMap(hasTrailerCache);
      return false;
    } finally {
      inFlight--;
      pendingHasTrailer.delete(itemId);
    }
  })();
  pendingHasTrailer.set(itemId, task);
  return task;
}

function getOrCreateYTShield(modal = modalState.videoModal) {
  if (!modal) return null;
  const wrap = modal.querySelector?.('.preview-iframe-wrapper');
  if (!wrap) return null;

  let shield = wrap.querySelector?.('.yt-first-touch-shield');
  if (!shield) {
    shield = document.createElement('div');
    shield.className = 'yt-first-touch-shield';
    Object.assign(shield.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '3',
      background: 'transparent',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
    });
    const swallow = (e) => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','touchmove','contextmenu'].forEach(t =>
      shield.addEventListener(t, swallow, { passive: false, capture: true })
    );
    wrap.appendChild(shield);
  }
  return shield;
}

function showYTFirstTouchShield(iframe, durationMs = 380) {
  if (!iframe) return;
  const modal = iframe?.closest?.('.video-preview-modal') || modalState.videoModal;
  const shield = getOrCreateYTShield(modal);
  if (!shield) return;
  shield.style.display = 'block';
  setTimeout(() => { try { shield.style.display = 'none'; } catch {} }, durationMs);
}

function ensureTrailerBadgeCSS() {
  if (document.getElementById('jms-trailer-badge-css')) return;
  const s = document.createElement('style');
  s.id = 'jms-trailer-badge-css';
  s.textContent = `
  .jms-trailer-badge {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 2;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 22, 35, 0.65);
    color: #fff;
    border: 1px solid rgba(194, 194, 255, 0.17);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    font-size: 12px;
    font-weight: 600;
    backdrop-filter: saturate(140%) blur(6px);
    display: none;
    pointer-events: auto;
    user-select: none;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .jms-trailer-badge:active {
    transform: scale(0.96);
  }
  .jms-trailer-badge svg {
    width: 18px;
    height: 18px;
  }
  .touch-device .jms-trailer-badge { display: flex; }
  @media (max-width: 750px) { .jms-trailer-badge { display: flex; } }
  `;
  document.head.appendChild(s);
}

function getCardRoot(el) {
  if (!el) return null;
  if (el.classList?.contains('cardImageContainer')) return el;
  return el.closest?.('.cardImageContainer') || null;
}
function getItemIdFromCard(card) {
  return card?.dataset?.itemId
      || card?.dataset?.id
      || card?.closest?.('[data-id]')?.dataset?.id
      || null;
}

let __badgeIO;
function ensureBadgeIO() {
  if (!shouldShowTrailerBadge()) {
    return {
      observe(){}, unobserve(){}, disconnect(){},
    };
  }
  if (__badgeIO) return __badgeIO;
  __badgeIO = new IntersectionObserver(async (entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const card = ent.target;
      if (card.dataset.hastrailer === 'true' || card.dataset.hastrailer === 'false') continue;

      const itemId = getItemIdFromCard(card);
      if (!itemId) { card.dataset.hastrailer = 'false'; continue; }

      try {
        const has = await hasTrailerForItemId(itemId);
        card.dataset.hastrailer = has ? 'true' : 'false';
        if (has) {
          const labels = (getConfig()?.languageLabels) || {};
          mountTrailerBadge(card, labels.fragman || 'Fragman');
        }
      } catch {
        card.dataset.hastrailer = 'false';
      }
    }
  }, { rootMargin: '300px 0px', threshold: 0.01 });
  return __badgeIO;
}

function disconnectObservers() {
  try { window.__studioMiniObs?.disconnect?.(); } catch {}
  try { window.__jmsTrailerBadgeMO?.disconnect?.(); } catch {}
  try { __badgeIO?.disconnect?.(); } catch {}
}

function observeCardForTrailer(card) {
  if (!shouldShowTrailerBadge()) return;
  if (!card || card.__jmsTrailerObserved) return;
  card.__jmsTrailerObserved = true;
  ensureTrailerBadgeCSS();
  ensureBadgeIO().observe(card);
}

function rescanAllCardsForBadge(root = document) {
  if (!shouldShowTrailerBadge()) return;
  try {
    const list = root.querySelectorAll?.('.cardImageContainer');
    if (!list || !list.length) return;
    list.forEach(observeCardForTrailer);
  } catch {}
}

function installTrailerBadgeAutobind() {
  if (window.__jmsTrailerBadgeObsInstalled) return;
  if (!shouldShowTrailerBadge()) return;
  window.__jmsTrailerBadgeObsInstalled = true;
  onFirstInteraction(() => rescanAllCardsForBadge(), 1200);
  const deb = (fn, ms=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  const rebind = deb(() => rescanAllCardsForBadge(document), 120);

  window.addEventListener('hashchange', rebind, true);
  window.addEventListener('popstate',   rebind, true);

  const mo = new MutationObserver((mutList) => {
    let need = false;
    for (const m of mutList) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList?.contains('cardImageContainer')) {
          observeCardForTrailer(n);
          need = false;
        } else if (n.querySelector?.('.cardImageContainer')) {
          need = true;
        }
      }
    }
    if (need) rescanAllCardsForBadge();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  window.__jmsTrailerBadgeMO = mo;
  window.addEventListener('jms:globalPreviewModeChanged', () => rebind(), { passive: true });
  document.addEventListener('dialogopen', () => rescanAllCardsForBadge(document), { passive: true });
  document.addEventListener('dialogopened', () => rescanAllCardsForBadge(document), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) rebind();
  });
}

function shouldShowTrailerBadge() {
  try {
    const cfg = getConfig();
    return !!(cfg && cfg.allPreviewModal !== false);
  } catch { return false; }
}

function hideAllTrailerBadges() {
  try {
    document.querySelectorAll('.jms-trailer-badge').forEach(n => {
      n.style.display = 'none';
    });
  } catch {}
}

function ensureTrailerBadgeGlobalCSSLock() {
  const id = 'jms-trailer-badge-visibility-lock';
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = shouldShowTrailerBadge()
    ? ''
    : '.jms-trailer-badge{display:none!important}';
}

if (shouldShowTrailerBadge()) {
  installTrailerBadgeAutobind();
} else {
  ensureTrailerBadgeGlobalCSSLock();
  hideAllTrailerBadges();
}

window.addEventListener('jms:globalPreviewModeChanged', () => {
  ensureTrailerBadgeGlobalCSSLock();
  if (shouldShowTrailerBadge()) {
    installTrailerBadgeAutobind();
    try { rescanAllCardsForBadge(document); } catch {}
  } else {
    try { disconnectObservers(); } catch {}
    hideAllTrailerBadges();
  }
}, { passive:true });

function mountTrailerBadge(card, text = 'Fragman') {
  if (!card || card.querySelector('.jms-trailer-badge')) return;
  try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch {}
  const el = document.createElement('div');
  el.className = 'jms-trailer-badge';
  el.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
  card.appendChild(el);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', text);

  const getId = (host) =>
    host?.dataset?.itemId || host?.dataset?.id || host?.closest?.('[data-id]')?.dataset?.id || null;

  const openFromBadge = (evt) => {
    if (evt.cancelable) evt.preventDefault();
    evt.stopImmediatePropagation();
    evt.stopPropagation();
    try { navigator.vibrate?.(8); } catch {}
    const itemId = getId(card);
    if (!itemId) return;
    modalState.__suppressOpenUntil = 0;
   openPreviewModalForItem(itemId, card, { bypass: true });
  };

  el.addEventListener('click', openFromBadge, { passive: false });
  el.addEventListener('touchstart', openFromBadge, { passive: false });
 el.addEventListener('touchend',   openFromBadge, { passive: false });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openFromBadge(e);
  });
}

function scanAndMarkCardsForTrailers() {
  ensureTrailerBadgeCSS();
  const items = document.querySelectorAll('.cardImageContainer');
  if (!items.length) return;
  const labels = (getConfig()?.languageLabels) || {};
  const LTRAILER = labels.fragman || 'Fragman';

  const io = new IntersectionObserver(async (entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const card = ent.target;
      if (card.dataset.hastrailer === 'true' || card.dataset.hastrailer === 'false') continue;
      const itemId = card.dataset.itemId || card.dataset.id || card.closest?.('[data-id]')?.dataset?.id;
      if (!itemId) { card.dataset.hastrailer = 'false'; continue; }
      const has = await hasTrailerForItemId(itemId);
      card.dataset.hastrailer = has ? 'true' : 'false';
      if (has) mountTrailerBadge(card, LTRAILER);
    }
  }, { rootMargin: '200px 0px', threshold: 0.01 });
  items.forEach(el => io.observe(el));
}

function canOpenItem(itemId) {
  const now = Date.now();
  if (now < modalState.__openLatchUntil && modalState.__lastOpenedItem === String(itemId)) return false;
  modalState.__openLatchUntil = now + REOPEN_BLOCK_MS;
  modalState.__lastOpenedItem = String(itemId);
  return true;
}

export function setModalAnimation(opts = {}) {
  Object.assign(MODAL_ANIM, opts);
  injectOrUpdateModalStyle();
}

function L(key, fallback = '') {
  try { return (getConfig()?.languageLabels?.[key]) ?? fallback; }
  catch { return fallback; }
}

function getYTPlayerForIframe(iframe) {
   if (!iframe) return null;

   let p = _ytPlayers.get(iframe);
   if (p) return p;

   if (typeof YT === 'undefined' || typeof YT.Player !== 'function') {
     return null;
   }
   try {
    p = new YT.Player(iframe, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        origin: window.location.origin
      },
      events: {
         onReady: (ev) => {
  try {
    const root = iframe?.closest?.('.video-preview-modal') || document.querySelector('.video-preview-modal');
    const btn = root?.querySelector?.('.preview-volume-button');
     if (IS_TOUCH) {
       if (typeof ev.target.mute === 'function') ev.target.mute();
     } else {
       if (modalState._soundOn) {
         if (typeof ev.target.unMute === 'function') ev.target.unMute();
         if (typeof ev.target.setVolume === 'function') ev.target.setVolume(100);
       } else {
         if (typeof ev.target.mute === 'function') ev.target.mute();
       }
     }
     if (btn) {
       btn.innerHTML = modalState._soundOn
         ? '<i class="fa-solid fa-volume-high"></i>'
         : '<i class="fa-solid fa-volume-xmark"></i>';
     }
   } catch (error) {}
 },
         onStateChange: (event) => {
   if (event.data === YT.PlayerState.PLAYING) {
     try { modalState.videoModal?.hideBackdrop?.(); } catch {}
            const root = iframe?.closest?.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            const btn = root?.querySelector?.('.preview-volume-button');
             if (btn && typeof event.target.getVolume === 'function') {
               try {
                 const volume = event.target.getVolume();
                 btn.innerHTML = volume === 0
                   ? '<i class="fa-solid fa-volume-xmark"></i>'
                   : '<i class="fa-solid fa-volume-high"></i>';
               } catch (error) {
               }
             }
           }
         }
       }
     });

     _ytPlayers.set(iframe, p);
     return p;

   } catch (error) {
     return null;
   }
 }

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
export function modalIsVisible() {
  return !!(modalState.videoModal && modalState.videoModal.style.display !== 'none' && document.body.contains(modalState.videoModal));
}

export function hardStopPlayback() {
  try {
    hideTrailerIframe();

    if (modalState.modalVideo) {
      if (modalState.modalVideo._hls) {
        modalState.modalVideo._hls.destroy();
        delete modalState.modalVideo._hls;
      }
      modalState.modalVideo.pause();
      modalState.modalVideo.removeAttribute('src');
      modalState.modalVideo.load();
      modalState.modalVideo.style.opacity = '0';
      modalState.modalVideo.style.display = 'none';
    }
  } catch (e) {}
}

export function getClosingRemaining() {
  return Math.max(0, modalState._modalClosingUntil - Date.now());
}

async function gatePlaybackStart(expectedItemId) {
  await sleep(MODAL_ANIM.openMs);
  if (!modalIsVisible()) return false;
  if (expectedItemId && modalState.videoModal?.dataset?.itemId && modalState.videoModal.dataset.itemId !== String(expectedItemId)) {
    return false;
  }
  if (getClosingRemaining() > 0) {
    await sleep(getClosingRemaining());
    if (!modalIsVisible()) return false;
  }
  return true;
}

export function scheduleOpenForItem(itemEl, itemId, signal, openFn) {
  if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
  if (modalState._hoverOpenTimer) {
    clearTimeout(modalState._hoverOpenTimer);
    modalState._hoverOpenTimer = null;
  }
  modalState._currentHoverItemId = itemId;
  modalState._lastItemEnterAt = Date.now();

  const sinceHide = Date.now() - modalState._lastModalHideAt;
  const needCooldown = Math.max(0, REOPEN_COOLDOWN_MS - sinceHide);
  const settleLeft = Math.max(0, CROSS_ITEM_SETTLE_MS);
  const closingLeft = getClosingRemaining();

  let delay = Math.max(OPEN_HOVER_DELAY_MS, needCooldown, settleLeft, closingLeft);

  const run = async () => {
    if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
    const stillClosing = getClosingRemaining();
    if (stillClosing > 0) {
      modalState._hoverOpenTimer = setTimeout(run, stillClosing);
      return;
    }
    if (modalState._currentHoverItemId !== itemId || signal?.aborted) return;
    await openFn();
  };

  modalState._hoverOpenTimer = setTimeout(run, delay);
}

async function resolveLocalTrailerUrlFor(item, { signal } = {}) {
  try {
    if (!item?.Id) return { url: null, level: null };
    const locals = await fetchLocalTrailers(item.Id, { signal });
    if (!locals || locals.length === 0) return { url: null, level: null };
    const best = pickBestLocalTrailer(locals);
    if (!best?.Id) return { url: null, level: null };
    const url = await getVideoStreamUrl(best.Id);
    return url ? { url, level: 'local', trailerItem: best } : { url: null, level: null };
  } catch {
    return { url: null, level: null };
  }
}

async function getSeriesTrailerUrl(seriesId) {
  if (!seriesId) return null;
  if (_seriesTrailerCache.has(seriesId)) return _seriesTrailerCache.get(seriesId);

  try {
    const series = await fetchItemDetails(seriesId);
    const url = pickYouTubeTrailerUrl(series?.RemoteTrailers);
    _seriesTrailerCache.set(seriesId, url || null);
    capMap(_seriesTrailerCache);
    return url || null;
  } catch {
    _seriesTrailerCache.set(seriesId, null);
    capMap(_seriesTrailerCache);
    return null;
  }
}

async function findSeriesIdByClimbing(item) {
  if (!item) return null;
  if (item.Type === 'Series') return item.Id || null;
  let probeId = item.SeriesId || item.ParentId || null;
  while (probeId) {
    const p = await fetchItemDetails(probeId);
    if (!p) break;
    if (p.Type === 'Series') return p.Id || probeId;
    probeId = p.ParentId || null;
  }
  return null;
}

function pickYouTubeTrailerUrl(remoteTrailers = []) {
  if (!Array.isArray(remoteTrailers)) return null;
  for (const t of remoteTrailers) {
    const raw = t?.Url;
    if (!raw) continue;
    const embed = getYoutubeEmbedUrl(raw);
    if (embed && isValidUrl(embed)) return embed;
  }
  return null;
}

async function resolveTrailerUrlFor(item) {
  const local = await resolveLocalTrailerUrlFor(item);
  if (local.url) return local;
  const itemUrl = pickYouTubeTrailerUrl(item?.RemoteTrailers);
  if (itemUrl) return { url: itemUrl, level: 'item' };
  const seriesId = await findSeriesIdByClimbing(item);
  if (seriesId) {
    const seriesUrl = await getSeriesTrailerUrl(seriesId);
    if (seriesUrl) return { url: seriesUrl, level: 'series' };
  }
  return { url: null, level: null };
}

function ensureYTParams(url, { autoplay = true, muteInitial = true, enableJsApi = true } = {}) {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set('autoplay', autoplay ? '1' : '0');
    u.searchParams.set('playsinline', '1');
    u.searchParams.set('rel', '0');
    u.searchParams.set('modestbranding', '1');
    u.searchParams.set('mute', muteInitial ? '1' : '0');

    if (enableJsApi) {
      u.searchParams.set('enablejsapi', '1');
      const origin = window.location.origin;
      if (origin && origin !== 'null' && /^https:\/\//i.test(origin)) {
        u.searchParams.set('origin', origin);
        u.searchParams.set('widget_referrer', origin);
      } else {
        u.searchParams.delete('origin');
        u.searchParams.delete('widget_referrer');
      }
    } else {
      u.searchParams.set('enablejsapi', '0');
      u.searchParams.delete('origin');
      u.searchParams.delete('widget_referrer');
    }

    return u.toString();
  } catch {
    return url;
  }
}

function now() { return Date.now(); }

function cacheGet(id) {
  const entry = previewPreloadCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { previewPreloadCache.delete(id); return null; }
  previewPreloadCache.delete(id);
  previewPreloadCache.set(id, { ...entry, lastAccess: Date.now() });
  return entry.url;
}

function cacheSet(id, url) {
  const entry = { url, createdAt: Date.now(), lastAccess: Date.now(), expiresAt: Date.now() + PREVIEW_TTL_MS };
  if (previewPreloadCache.has(id)) previewPreloadCache.delete(id);
  previewPreloadCache.set(id, entry);
  pruneOverLimit();
  return url;
}

function pruneExpired() {
  const t = Date.now();
  for (const [id, entry] of previewPreloadCache) if (entry.expiresAt < t) previewPreloadCache.delete(id);
}

function pruneOverLimit() {
  const overflow = previewPreloadCache.size - PREVIEW_MAX_ENTRIES;
  if (overflow <= 0) return;
  let toEvict = Math.max(overflow, PREVIEW_EVICT_BATCH);
  for (const [id] of previewPreloadCache) {
    previewPreloadCache.delete(id);
    if (--toEvict <= 0) break;
  }
}

export async function preloadVideoPreview(itemId) {
  const hit = cacheGet(itemId);
  if (hit) return hit;
  try {
    const url = absServerUrl(await getVideoStreamUrl(itemId));
    return cacheSet(itemId, url);
  } catch { return null; }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    closeVideoModal();
  }
}

function handleWindowBlur() {
  if (IS_TOUCH) return;
  try {
    const iframe = modalState.videoModal?.querySelector?.('.preview-trailer-iframe');
    const ytShown = !!(iframe && iframe.style.display !== 'none');
    if (ytShown) return;
  } catch {}
  closeVideoModal();
}

if (!window.__hoverTrailer_globalBound) {
   window.addEventListener("blur", handleWindowBlur);
   document.addEventListener("visibilitychange", handleVisibilityChange);
   window.__hoverTrailer_globalBound = true;
 }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { destroyVideoModal(); disconnectObservers(); });
  window.addEventListener('pagehide', () => { destroyVideoModal(); disconnectObservers(); });
}


function hideOnVisibility() {
  if (document.hidden || document.visibilityState === 'hidden') {
    closeVideoModal();
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener("visibilitychange", hideOnVisibility);
}

export function destroyVideoModal() {
  if (modalState.videoModal) {
    hideTrailerIframe(modalState.videoModal);
    clearTransientOverlays(modalState.videoModal);
    if (modalState.modalVideo) {
      modalState.modalVideo.pause();
      modalState.modalVideo.src = '';
      if (modalState.modalVideo._hls) {
        modalState.modalVideo._hls.destroy();
        delete modalState.modalVideo._hls;
      }
    }
    try { modalState.videoModal.remove(); } catch {}
    modalState.videoModal = null;
    modalState.modalVideo = null;
  }
  try {
    if (modalState._cacheMaintenanceTimer) {
      clearInterval(modalState._cacheMaintenanceTimer);
      modalState._cacheMaintenanceTimer = null;
    }
    if (modalState._visibilityHandler) {
      document.removeEventListener('visibilitychange', modalState._visibilityHandler);
      modalState._visibilityHandler = null;
    }
  } catch {}
}

function sizeYTToCover(iframe) {
  try {
    const wrap = iframe?.__wrapper;
    if (!wrap) return;
    const W = wrap.clientWidth || 0;
    const H = wrap.clientHeight || 0;
    if (!W || !H) return;

    const TARGET = 16 / 9;
    const r = W / H;

    if (r >= TARGET) {
      iframe.style.width = '100%';
      iframe.style.height = Math.ceil(W * 9 / 16) + 'px';
    } else {
      iframe.style.height = '100%';
      iframe.style.width = Math.ceil(H * 16 / 9) + 'px';
    }
    iframe.style.left = '50%';
    iframe.style.top  = '50%';
    iframe.style.transform = 'translate(-50%, -50%)';
  } catch {}
}

window.addEventListener('resize', () => {
  try {
    for (const [iframe] of _ytPlayers) sizeYTToCover(iframe);
  } catch {}
});

function getOrCreateTrailerIframe(modal = modalState.videoModal) {
  if (!modal) return null;
  const container = modal.querySelector?.('.video-container');
  if (!container) return null;

  let wrap = modal.querySelector?.('.preview-iframe-wrapper');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'preview-iframe-wrapper';
    wrap.style.display = 'none';
    wrap.style.position = 'absolute';
    wrap.style.inset = '10px';
    wrap.style.borderRadius = '0px';
    wrap.style.overflow = 'hidden';
    wrap.style.zIndex = '2';
    container.appendChild(wrap);
  }

  let iframe = wrap.querySelector?.('.preview-trailer-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.className = 'preview-trailer-iframe';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.referrerPolicy = 'origin-when-cross-origin';
    iframe.allowFullscreen = true;
    Object.assign(iframe.style, {
      position: 'absolute',
      border: 'none',
      display: 'none',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'auto'
    });
    wrap.appendChild(iframe);
  }

  iframe.__wrapper = wrap;
  return iframe;
}

function hideTrailerIframe(modal = modalState.videoModal) {
  if (!modal) return;
  const iframe = modal.querySelector?.('.preview-trailer-iframe');
  if (!iframe) return;

  const p = _ytPlayers.get(iframe);
  if (p) {
    try { if (p.stopVideo) p.stopVideo(); if (p.mute) p.mute(); if (p.destroy) p.destroy(); } catch {}
    _ytPlayers.delete(iframe);
    _ytReadyMap.delete(iframe);
  }

  try {
    iframe.src = 'about:blank';
    iframe.removeAttribute('src');
  } catch {}
  iframe.style.display = 'none';
  try { iframe.__wrapper && (iframe.__wrapper.style.display = 'none'); } catch {}
  try {
    const shield = iframe.__wrapper?.querySelector?.('.yt-first-touch-shield');
    if (shield) shield.style.display = 'none';
  } catch {}
  const volumeButton = modal.querySelector?.('.preview-volume-button');
  if (volumeButton) {
    volumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    delete volumeButton.dataset.ytMuted;
  }
  clearTransientOverlays(modal);
}

function installYTPlayer(iframe) {
  if (!iframe) return null;
  let p = _ytPlayers.get(iframe);
  if (p) return p;
  if (typeof YT === 'undefined' || typeof YT.Player !== 'function') return null;

  function bindFirstInteractionUnmute() {
    const btn = (iframe.closest('.video-preview-modal') || document).querySelector?.('.preview-volume-button');
    const handler = () => {
      try {
        const player = _ytPlayers.get(iframe);
        player?.unMute?.();
        player?.setVolume?.(100);
        player?.playVideo?.();
        if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      } catch {}
      cleanup();
    };
    const cleanup = () => {
      ['pointerdown','keydown'].forEach(t => window.removeEventListener(t, handler, true));
    };
    ['pointerdown','keydown'].forEach(t => window.addEventListener(t, handler, { once:true, capture:true }));
    setTimeout(cleanup, 6000);
  }

  try {
    p = new YT.Player(iframe, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        origin: window.location.origin
      },
      events: {
        onReady: (ev) => {
          try {
            const root = iframe?.closest?.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            const btn  = root?.querySelector?.('.preview-volume-button');
            if (btn) {
              btn.innerHTML = modalState._soundOn
                ? '<i class="fa-solid fa-volume-high"></i>'
                : '<i class="fa-solid fa-volume-xmark"></i>';
            }

            if ((isMobileAppEnv() || !IS_TOUCH) && modalState._soundOn) {
              ev.target.unMute?.();
              ev.target.setVolume?.(100);
              try { ev.target.playVideo?.(); } catch {}
              setTimeout(() => {
                try {
                  const muted = typeof ev.target.isMuted === 'function' ? ev.target.isMuted() : true;
                  if (muted) bindFirstInteractionUnmute();
                } catch {
                  bindFirstInteractionUnmute();
                }
              }, 250);
            } else {
              if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            }
          } catch {}
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING) {
            try { modalState.videoModal?.hideBackdrop?.(); } catch {}
            const root = iframe?.closest?.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            const btn  = root?.querySelector?.('.preview-volume-button');
            if (btn) {
              try {
                const muted = typeof event.target.isMuted === 'function' ? event.target.isMuted() : true;
                btn.innerHTML = muted
                  ? '<i class="fa-solid fa-volume-xmark"></i>'
                  : '<i class="fa-solid fa-volume-high"></i>';
              } catch {}
            }
            try {
     if (isMobileAppEnv() && modalState._soundOn) {
       event.target.unMute?.();
       event.target.setVolume?.(100);
     }
   } catch {}
          }
        }
      }
    });
    _ytPlayers.set(iframe, p);
    return p;
  } catch {
    return null;
  }
}

function ensureYTAPI() {
  if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
    modalState._ytApiReady = true;
    return Promise.resolve();
  }
  if (modalState._ytApiLoading) {
    return new Promise(resolve => {
      const iv = setInterval(() => {
        if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
          clearInterval(iv);
          modalState._ytApiReady = true;
          resolve();
        }
      }, 100);
    });
  }
  modalState._ytApiLoading = true;
  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    setTimeout(() => {
      if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
        modalState._ytApiReady = true;
        modalState._ytApiLoading = false;
        resolve();
      } else {
        console.warn('YouTube API zaman aşımına uğradı, API olmadan devam ediyor');
        modalState._ytApiReady = false;
        modalState._ytApiLoading = false;
        resolve();
      }
    }, 3000);
  });
}

export function setGlobalSound(on) {
  modalState._soundOn = !!on;
  applyVolumePreference();
}

export function applyVolumePreference(modal = modalState.videoModal) {
  const volumeButton = modal?.querySelector?.('.preview-volume-button');
  const trailerIframe = modal?.querySelector?.('.preview-trailer-iframe');
  const trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';
  if (trailerVisible) {
    const player = _ytPlayers.get(trailerIframe);
    if (volumeButton) {
      let muted = true;
      try { muted = player?.isMuted?.() ?? true; } catch {}
      volumeButton.innerHTML = muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
    return;
  }
  if (modalState.modalVideo) {
    modalState.modalVideo.muted = !modalState._soundOn;
    modalState.modalVideo.volume = modalState._soundOn ? 1.0 : 0.0;
  }
  if (volumeButton) {
    volumeButton.innerHTML = modalState._soundOn
      ? '<i class="fa-solid fa-volume-high"></i>'
      : '<i class="fa-solid fa-volume-xmark"></i>';
  }
}

function injectOrUpdateModalStyle() {
  const id = 'video-modal-modern-style';
  const style = document.getElementById(id) || document.createElement('style');
  style.id = id;
  style.textContent = `
    .video-preview-modal {
      position: absolute;
      width: 400px;
      height: 330px;
      background: rgba(28, 28, 46, 0.97);
      border-radius: 20px;
      box-shadow:
        0 8px 32px 0 rgba(31, 38, 135, 0.38),
        0 1.5px 4px rgba(0, 0, 0, 0.09);
      z-index: 1000;
      display: none;
      overflow: hidden;
      transform: translateY(8px) scale(0.92);
      opacity: 0;
      transition:
        opacity 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
        transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
      will-change: transform, opacity;
      font-family: "Inter", "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      pointer-events: auto;
      border: 1.5px solid rgba(255, 255, 255, 0.10);
      backdrop-filter: blur(12px) saturate(160%);
      user-select: none;
      box-sizing: border-box;
      max-width: calc(100vw - 32px);
      transform: translateZ(0);
      backface-visibility: hidden;
      perspective: 1000px;
    }

    .video-preview-modal.video-preview-modal--visible {
      display: block;
      transform: translateY(0) scale(1);
      opacity: 1;
    }

    .video-preview-modal.video-preview-modal--hidden {
      transform: translateY(8px) scale(0.92);
      opacity: 0;
    }

    .video-preview-modal .preview-iframe-wrapper {
      position: absolute;
      inset: 10px;
      border-radius: 12px;
      overflow: hidden;
      z-index: 2;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.21);
      transform: translateZ(0);
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .video-preview-modal .preview-iframe-wrapper--hidden {
      opacity: 0;
    }

    .video-preview-modal .preview-trailer-iframe {
      position: absolute;
      border: none;
      display: none;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-close-mobile {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(56, 60, 90, 0.76);
      color: #fff;
      border: 1px solid rgba(194, 194, 255, 0.17);
      z-index: 5;
      cursor: pointer;
      transform: translateZ(0);
      transition:
        transform 0.15s ease,
        background-color 0.2s ease;
    }

    .video-preview-modal .preview-close-mobile:active {
      transform: scale(0.95);
    }

    .video-preview-modal .preview-backdrop {
      position: absolute;
      inset: 10px 10px 130px 10px;
      border-radius: 12px;
      padding: 10px;
      box-sizing: border-box;
      object-fit: cover;
      width: 100%;
      height: 190px;
      background-position: center;
      opacity: 0;
      transition: opacity 0.25s ease;
      pointer-events: none;
      z-index: 0;
      left: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-backdrop--visible {
      opacity: 1;
    }

    .video-preview-modal .video-container {
      position: relative;
      width: 100%;
      height: 200px;
      padding: 10px;
      box-sizing: border-box;
      background: linear-gradient(160deg, rgba(33, 36, 54, 0.97) 65%, rgba(52, 56, 80, 0.19));
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-shadow: 0 4px 18px 0 rgba(20, 20, 50, 0.06);
      transform: translateZ(0);
      opacity: 1;
    }

    .video-preview-modal .preview-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #111;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.21);
      transition:
        opacity 0.4s ease,
        transform 0.3s ease;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-video--hidden {
      opacity: 0;
      transform: scale(0.95);
    }

    .video-preview-modal .preview-info {
      padding: 16px 18px 12px 18px;
      position: absolute;
      bottom: -5px;
      left: 0;
      right: 0;
      z-index: 2;
      background: linear-gradient(0deg, rgba(24, 27, 38, 0.94) 60%, transparent 100%);
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: repeat(3, auto);
      gap: 6px 16px;
      align-items: end;
      transform: translateZ(0);
      opacity: 1;
    }

    .video-preview-modal .preview-title {
      grid-column: 1 / 2;
      color: #fff;
      font-weight: 700;
      font-size: 1.24rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      margin: 0 0 2px 0;
      padding: 0;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
      line-height: 1.13;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-episode {
      grid-column: 1 / 3;
      color: #e5e6fb;
      font-size: 13.5px;
      opacity: 0.95;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-meta {
      grid-column: 1 / 3;
      color: #b9badb;
      font-size: 13px;
      display: flex;
      flex-wrap: wrap;
      gap: 14px 10px;
      width: 100%;
      opacity: 0.95;
      align-items: center;
      margin: 0 0 -6px 0;
      transform: translateZ(0);
    }

    .video-preview-modal img.range-icon,
    .video-preview-modal img.codec-icon,
    .video-preview-modal img.quality-icon {
      width: 24px;
      height: 18px;
      background: rgba(30, 30, 40, 0.7);
      border-radius: 4px;
      padding: 1px;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-genres {
      grid-column: 1 / 3;
      display: flex;
      gap: 8px;
      margin-top: 2px;
      font-size: 12.7px;
      color: #a8aac7;
      width: 99%;
      overflow: hidden;
      transform: translateZ(0);
      opacity: 1;
    }

    .video-preview-modal .genre-badge {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: inline-block;
      transform: translateZ(0);
    }

    .video-preview-modal .genre-separator {
      color: #a8aac7;
      margin: 0 4px;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-buttons {
      display: flex;
      gap: 12px;
      position: absolute;
      top: 60%;
      left: 50%;
      opacity: 1;
      z-index: 6;
      pointer-events: auto;
      padding: 5px 0;
      transform: translateX(-50%);
      transition:
        opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
        transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .video-preview-modal .preview-buttons--hidden {
      opacity: 0;
      transform: translateX(-50%) scale(0.95);
    }

    .video-preview-modal button {
      outline: none;
      border: none;
      padding: 0;
      background: none;
      font: inherit;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-play-button {
      background: linear-gradient(94deg, #fff 78%, #eee 100%);
      color: #000;
      border-radius: 4px;
      padding: 8px 18px 8px 16px;
      font-size: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      cursor: pointer;
      min-width: 82px;
      box-shadow: 0 2px 8px 0 rgba(23, 22, 31, 0.05);
      transition:
        box-shadow 0.18s ease,
        transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      text-wrap-mode: nowrap;
      font-weight: 700;
      text-overflow: ellipsis;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
      line-height: 1.13;
      transform: translateZ(0);
    }

    .video-preview-modal .preview-play-button:hover {
      background: linear-gradient(92deg, #f5f4f9 64%, #fff 100%);
      box-shadow: 0 4px 16px 0 rgba(21, 12, 50, 0.11);
      transform: scale(1.05);
    }

    .video-preview-modal .preview-play-button:active {
      transform: scale(0.98);
    }

    .video-preview-modal .preview-favorite-button,
    .video-preview-modal .preview-info-button,
    .video-preview-modal .preview-volume-button,
    .video-preview-modal .preview-match-button {
      background: rgba(56, 60, 90, 0.76);
      color: #fff;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 15px;
      border: 1px solid rgba(194, 194, 255, 0.17);
      transition:
        background 0.18s ease,
        transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      box-shadow: 0 1px 4px 0 rgba(23, 22, 31, 0.07);
      transform: translateZ(0);
    }

    .video-preview-modal .preview-favorite-button.favorited {
      background: linear-gradient(80deg, #3fc37d 65%, #158654 100%);
      color: #fff;
      border: 1px solid #25e098;
    }

    .video-preview-modal .preview-match-button {
      background: rgba(70, 211, 105, 0.15);
      color: #46d369;
      border: 1px solid rgba(70, 211, 105, 0.3);
      font-weight: 600;
      font-size: 12px;
      border-radius: 6px;
      width: auto;
      padding: 0 8px;
      min-width: 50px;
    }

    .video-preview-modal .preview-favorite-button:hover,
    .video-preview-modal .preview-info-button:hover,
    .video-preview-modal .preview-volume-button:hover,
    .video-preview-modal .preview-match-button:hover {
      background: rgba(81, 85, 140, 0.98);
      transform: scale(1.09);
    }

    .video-preview-modal .preview-favorite-button:active,
    .video-preview-modal .preview-info-button:active,
    .video-preview-modal .preview-volume-button:active,
    .video-preview-modal .preview-match-button:active {
      transform: scale(1.05);
    }

    /* Trailer tip overlay */
    .video-preview-modal .trailer-tip {
      position: absolute;
      top: 11px;
      left: 11px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.45);
      color: #eee;
      z-index: 1;
      pointer-events: none;
      transform: translateZ(0);
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .video-preview-modal .trailer-tip--hidden {
      opacity: 0;
    }

    /* No trailer message */
    .video-preview-modal .no-trailer-message {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #ccc;
      font-size: 18px;
      font-weight: 500;
      text-align: center;
      pointer-events: none;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translateZ(0);
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .video-preview-modal .no-trailer-message--hidden {
      opacity: 0;
    }

    /* YouTube touch shield */
    .video-preview-modal .yt-first-touch-shield {
      position: absolute;
      inset: 0;
      z-index: 3;
      background: transparent;
      pointer-events: auto;
      touch-action: manipulation;
      transform: translateZ(0);
    }

    /* Mobile responsive */
    @media (max-width: 750px) {
      .video-preview-modal .preview-close-mobile {
        display: flex;
      }

      .video-preview-modal {
        width: 95vw;
        max-width: 380px;
        height: 300px;
      }

      .video-preview-modal .preview-buttons {
        gap: 8px;
      }

      .video-preview-modal .preview-play-button {
        padding: 6px 14px 6px 12px;
        font-size: 14px;
        min-width: 70px;
      }
    }

    /* High DPI screens optimization */
    @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
      .video-preview-modal {
        backdrop-filter: blur(16px) saturate(180%);
      }
    }

    /* Reduced motion support */
    @media (prefers-reduced-motion: reduce) {
      .video-preview-modal,
      .video-preview-modal * {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
      }
    }

    /* Performance optimizations */
    .video-preview-modal * {
      transform: translateZ(0);
      backface-visibility: hidden;
    }

    /* Content fade animations */
    .video-preview-modal .content-element {
      opacity: 1;
      transform: translateY(0);
      transition:
        opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
        transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .video-preview-modal .content-element--hidden {
      opacity: 0;
      transform: translateY(8px);
    }
  `;
  if (!style.isConnected) document.head.appendChild(style);
}


function bindModalHover(modal) {
  modal.addEventListener('mouseenter', () => {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });
  const leave = () => {
    modalState.isMouseInModal = false;
    closeVideoModal();
  };
  modal.addEventListener('mouseleave', leave);
  modal.addEventListener('pointerleave', leave);
}

function shouldHideModal() { return !modalState.isMouseInModal; }

export function startModalHideTimer() {
  clearTimeout(modalState.modalHideTimeout);
  if (IS_TOUCH) return;
  modalState.modalHideTimeout = setTimeout(() => {
    if (shouldHideModal() && modalState.videoModal) {
      modalState._isModalClosing = true;
      modalState._modalClosingUntil = Date.now() + MODAL_ANIM.closeMs + HARD_CLOSE_BUFFER_MS;
      modalState.videoModal.style.transition =
        `opacity ${MODAL_ANIM.closeMs}ms ${MODAL_ANIM.ease}, ` +
        `transform ${MODAL_ANIM.closeMs}ms ${MODAL_ANIM.ease}`;
      modalState.videoModal.style.opacity = String(MODAL_ANIM.opacityFrom);
      modalState.videoModal.style.transform = `scale(${MODAL_ANIM.scaleFrom})`;
      softStopPlayback();
      setTimeout(() => {
        if (shouldHideModal() && modalState.videoModal) {
          hardStopPlayback();
          resetModalInfo(modalState.videoModal);
          resetModalButtons();
          modalState._lastModalHideAt = Date.now();
          modalState._isModalClosing = false;
          clearTransientOverlays(modalState.videoModal);
          modalState.videoModal.style.display = 'none';
        }
      }, MODAL_ANIM.closeMs);
    }
  }, 150);
}

function getCardItemType(el){
  try{
    const cand = (
      el.dataset.type ||
      el.dataset.mediaType ||
      el.dataset.mediatype ||
      el.dataset.collectionType ||
      el.dataset.collectiontype ||
      el.closest('[data-type]')?.dataset?.type ||
      el.closest('[data-mediatype]')?.dataset?.mediatype ||
      el.closest('[data-media-type]')?.dataset?.mediaType ||
      el.closest('[data-collectiontype]')?.dataset?.collectiontype
    );
    if (!cand) return null;
    const norm = String(cand).trim().toLowerCase();
    const cap  = norm.charAt(0).toUpperCase() + norm.slice(1);
    return cap;
  } catch { return null; }
}

const __typeCache = new Map();
async function getItemTypeCached(itemId){
  if (__typeCache.has(itemId)) return __typeCache.get(itemId);
  try{
    const it = await fetchPlayableItemDetails(itemId);
    const t  = it?.Type || null;
    if (t) {
      __typeCache.set(itemId, t);
      capMap(__typeCache);
    }
    return t || null;
  } catch {
    return null;
  }
}

export function setupHoverForAllItems() {
  if (!config || config.allPreviewModal === false) return;
  installHoverOpenSuppressors();
  scanAndMarkCardsForTrailers();
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const mode = config.globalPreviewMode || 'modal';

  const items = document.querySelectorAll('.cardImageContainer');
  if (!items.length) return;
  if (isTouch) {
  const ALLOWED_TYPES = new Set(['Movie','Episode','Series','Season']);
  const LONG_PRESS_MS = 380;
  const MOVE_TOL = 12;

  let lpTimer = null, startX = 0, startY = 0;
  let activeItem = null, activeId = null;
  let longPressFiredAt = 0;
  const SUPPRESS_MS = 450;

  const getId = (el) =>
    el?.dataset?.itemId || el?.dataset?.id || el?.closest?.('[data-id]')?.dataset?.id || null;

  function isSuppressionActive() {
    return (Date.now() - longPressFiredAt) < SUPPRESS_MS;
  }
  function fireLongPress() {
    longPressFiredAt = Date.now();
    try { navigator.vibrate?.(10); } catch {}
    if (activeItem && activeId) {
    modalState.__suppressOpenUntil = 0;
    openPreviewModalForItem(activeId, activeItem, { bypass: true });
  }
}
  function cancelLP() {
    clearTimeout(lpTimer);
    lpTimer = null;
    if (activeItem) activeItem.style.touchAction = '';
    activeItem = null; activeId = null;
  }
  const suppressIfNeeded = (e) => {
   if (e.target?.closest?.('.jms-trailer-badge')) return;
    if (!isSuppressionActive()) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  };
  ['click','mousedown','mouseup','pointerup','pointerdown','touchend','touchstart','contextmenu']
  .forEach(type => {
    document.addEventListener(type, (e) => {
     if (e.target?.closest?.('.jms-trailer-badge')) return;
     suppressIfNeeded(e);
   }, { capture:true, passive:false });
    if (!window.__hoverOpenSuppressInstalled) {
  window.__hoverOpenSuppressInstalled = true;

  const killHover = () => suppressHoverOpens(1200);
  const cardDown = (e) => {
    const card = e.target?.closest?.('.cardImageContainer,[data-id]');
    if (!card) return;
    killHover();
  };
  document.addEventListener('pointerdown', cardDown, { capture: true, passive: false });
  document.addEventListener('mousedown',   cardDown, { capture: true, passive: false });
  document.addEventListener('touchstart',  cardDown, { capture: true, passive: false });
  const linkDown = (e) => {
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    killHover();
  };
  document.addEventListener('pointerdown', linkDown, { capture: true, passive: false });
  document.addEventListener('mousedown',   linkDown, { capture: true, passive: false });
  document.addEventListener('touchstart',  linkDown, { capture: true, passive: false });
  const onNav = () => suppressHoverOpens(1200);
  window.addEventListener('popstate',  onNav, true);
  window.addEventListener('hashchange',onNav, true);
  window.addEventListener('beforeunload', () => suppressHoverOpens(5000));
  window.addEventListener('pagehide',     () => suppressHoverOpens(5000));
}
  });

  const onTouchStart = async (e) => {
    if (e.target?.closest?.('.jms-trailer-badge')) return;
   const card = e.target?.closest?.('.cardImageContainer');
    if (!card) return;
    const itemId = getId(card);
    if (!itemId) return;
    let type = getCardItemType(card);
    if (!type) type = await getItemTypeCached(itemId);
    if (!type || !ALLOWED_TYPES.has(type)) return;
    activeItem = card; activeId = itemId;
    activeItem.style.touchAction = 'none';
    const t = e.touches?.[0];
    startX = t?.clientX ?? 0;
    startY = t?.clientY ?? 0;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      fireLongPress();
    }, LONG_PRESS_MS);
  };
  const onTouchMove = (e) => {
    if (!lpTimer) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Math.abs((t.clientX ?? 0) - startX);
    const dy = Math.abs((t.clientY ?? 0) - startY);
    if (dx > MOVE_TOL || dy > MOVE_TOL) {
      cancelLP();
    } else {
      if (e.cancelable) e.preventDefault();
    }
  };
  const onTouchEnd = (e) => {
    if (isSuppressionActive()) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
    cancelLP();
  };
  const onTouchCancel = () => cancelLP();
  document.addEventListener('touchstart',  onTouchStart,  { passive: false, capture: true });
  document.addEventListener('touchmove',   onTouchMove,   { passive: false, capture: true });
  document.addEventListener('touchend',    onTouchEnd,    { passive: false, capture: true });
  document.addEventListener('touchcancel', onTouchCancel, { passive: true,  capture: true });

  return;
}

  if (mode === 'studioMini') {
    installStudioMiniAutobind();
    destroyVideoModal();
    items.forEach(item => {
      if (item.__miniBound) return;
      item.__miniBound = true;
      const itemId =
        item.dataset.itemId ||
        item.dataset.id ||
        (item.closest('[data-id]') && item.closest('[data-id]').dataset.id);
      if (!itemId) return;
      attachMiniPosterHover(item, { Id: itemId });
    });
    return;
  }

  if (typeof config !== 'undefined' && config.allPreviewModal !== false) {
    let __hoverInfraReady = false;
    function ensureHoverInfra() {
      if (__hoverInfraReady) return;
      __hoverInfraReady = true;
      try { injectOrUpdateModalStyle(); } catch {}
    }

    const isInsideDotArea = (node) =>
      !!(node?.closest?.('.dot-navigation-container') || node?.closest?.('.poster-dot'));
     const onEnter = async (e) => {
      if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
      if (!__hoverInfraReady) ensureHoverInfra();
      const item = e.target?.closest?.('.cardImageContainer');
      if (!item || isInsideDotArea(item)) return;
      const itemId =
        item.dataset.itemId || item.dataset.id || (item.closest('[data-id]')?.dataset?.id);
      if (!itemId) return;
      modalState.isMouseInItem = true;
      clearTimeout(modalState.modalHideTimeout);
      if (modalState.itemHoverAbortController) modalState.itemHoverAbortController.abort();
      modalState.itemHoverAbortController = new AbortController();
      const { signal } = modalState.itemHoverAbortController;

      scheduleOpenForItem(item, itemId, signal, async () => {
        if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
        try {
          if (modalState.videoModal) {
            hardStopPlayback();
            hardWipeModalDom(modalState.videoModal);
            modalState.videoModal.style.display = 'none';
          }
          const itemDetails = await fetchPlayableItemDetails(itemId, { signal });
          if (signal.aborted || !itemDetails) { closeVideoModal(); return; }
          if (itemDetails.Genres && itemDetails.Genres.length > 3) itemDetails.Genres = itemDetails.Genres.slice(0,3);
          const videoTypes = ['Movie','Episode','Series','Season'];
          if (!videoTypes.includes(itemDetails.Type)) { closeVideoModal(); return; }
          if (!modalState.videoModal || !document.body.contains(modalState.videoModal) || modalState._modalContext !== 'global') {
            try { destroyVideoModal(); } catch {}
            const modalElements = createVideoModal({ showButtons: true, context: 'global' });
            if (!modalElements) return;
            modalState.videoModal = modalElements.modal;
            modalState.modalVideo = modalElements.video;
            modalState.modalTitle = modalElements.title;
            modalState.modalMeta = modalElements.meta;
            modalState.modalMatchInfo = modalElements.matchInfo;
            modalState.modalGenres = modalElements.genres;
            modalState.modalPlayButton = modalElements.playButton;
            modalState.modalFavoriteButton = modalElements.favoriteButton;
            modalState.modalEpisodeLine = modalElements.episodeLine;
            modalState.modalMatchButton = modalElements.matchButton;
            bindModalEvents(modalState.videoModal);
          }
          const domBackdrop = item.dataset?.background || item.dataset?.backdrop || null;
          const itemBackdrop = getBackdropFromItem(itemDetails);
          modalState.videoModal.setBackdrop(domBackdrop || itemBackdrop || null);
          if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
          const myToken = newRenderToken();
          modalState.videoModal.dataset.itemId = itemId;
          positionModalRelativeToItem(modalState.videoModal, item);
          animatedShow(modalState.videoModal);
          applyVolumePreference(modalState.videoModal);
          let videoUrl = null;
          try { videoUrl = await preloadVideoPreview(itemId); } catch {}
          if (signal.aborted || !isTokenAlive(myToken) || modalState.videoModal?.dataset?.itemId !== String(itemId)) return;
          await updateModalContent(itemDetails, videoUrl);
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error('Öğe hover hatası:', error);
            if (modalState.videoModal) modalState.videoModal.style.display = 'none';
          }
        }
      });
    };

    const onLeave = (e) => {
      const fromItem = e.target?.closest?.('.cardImageContainer');
      if (!fromItem) return;
      const toModal = !!(e.relatedTarget && modalState.videoModal && modalState.videoModal.contains(e.relatedTarget));
      if (toModal) return;
      modalState.isMouseInItem = false;
      if (modalState._hoverOpenTimer) { clearTimeout(modalState._hoverOpenTimer); modalState._hoverOpenTimer = null; }
      if (modalState.itemHoverAbortController) modalState.itemHoverAbortController.abort();
      startModalHideTimer();
    };
    document.addEventListener('pointerenter', onEnter, { passive: true, capture: true });
    document.addEventListener('pointerleave', onLeave,  { passive: true, capture: true });
  }
}

function softStopPlayback() {
  try {
    const iframe = modalState.videoModal?.querySelector?.('.preview-trailer-iframe');
    if (iframe) {
      const p = _ytPlayers.get(iframe);
      try { if (p?.pauseVideo) p.pauseVideo(); if (p?.mute) p.mute(); } catch {}
    }
    if (modalState.modalVideo) {
      try { modalState.modalVideo.pause(); } catch {}
      modalState.modalVideo.muted = true;
      modalState.modalVideo.volume = 0;
    }
  } catch {}
}




export function positionModalRelativeToItem(modal, item, options = {}) {
  const defaults = {
    modalWidth: 400,
    modalHeight: 330,
    windowPadding: 16,
    preferredPosition: 'center',
    autoReposition: true
  };
  const settings = {...defaults, ...options};
  const modalStyle = modal.style;
  const positionModal = () => {
    const itemRect = item.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = itemRect.left + scrollX + (itemRect.width - settings.modalWidth) / 2;
    let top = itemRect.top + scrollY + (itemRect.height - settings.modalHeight) / 2;
    switch(settings.preferredPosition) {
      case 'top': top = itemRect.top + scrollY - settings.modalHeight - 10; break;
      case 'bottom': top = itemRect.bottom + scrollY + 10; break;
      case 'left': left = itemRect.left + scrollX - settings.modalWidth - 10; break;
      case 'right': left = itemRect.right + scrollX + 10; break;
    }
    const maxLeft = viewportWidth + scrollX - settings.modalWidth - settings.windowPadding;
    const maxTop = viewportHeight + scrollY - settings.modalHeight - settings.windowPadding;
    left = Math.max(settings.windowPadding, Math.min(left, maxLeft));
    top  = Math.max(settings.windowPadding, Math.min(top,  maxTop));
    modalStyle.position = 'absolute';
    modalStyle.width = `${settings.modalWidth}px`;
    modalStyle.height = `${settings.modalHeight}px`;
    modalStyle.left = `${left}px`;
    modalStyle.top  = `${top}px`;
    modalStyle.transformOrigin = 'center center';
  };

  positionModal();
  if (settings.autoReposition) {
    const handler = () => positionModal();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }
}

export function addTrailerTip(modal, text) {
  if (!modal) return;
  let tip = modal.querySelector?.('.trailer-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'trailer-tip';
    Object.assign(tip.style, {
      position: 'absolute', top: '11px', left: '11px', fontSize: '11px',
      padding: '3px 8px', borderRadius: '6px', background: 'rgba(0,0,0,.45)', color: '#eee', zIndex: '1', pointerEvents: 'none'
    });
    modal.querySelector?.('.video-container')?.appendChild(tip);
  }
  tip.textContent = text;
}

function showNoTrailerMessage(modal, text) {
  if (!modal) return;
  clearTransientOverlays(modal);
  let noTrailerDiv = modal.querySelector?.('.no-trailer-message');
  if (!noTrailerDiv) {
    noTrailerDiv = document.createElement('div');
    noTrailerDiv.className = 'no-trailer-message';
    noTrailerDiv.innerHTML = `
       <i class="fa-solid fa-circle-exclamation" style="margin-right:8px;color:#f66;"></i>
       ${text}
     `;
    Object.assign(noTrailerDiv.style, {
      position: 'absolute',
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      color: '#ccc', fontSize: '18px', fontWeight: '500', textAlign: 'center',
      pointerEvents: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    modal.querySelector?.('.video-container')?.appendChild(noTrailerDiv);
  }
}

export function getBackdropFromItem(item) {
  if (item?.BackdropImageTags?.length) {
    const tag = item.BackdropImageTags[0];
    return withServer(`/Items/${item.Id}/Images/Backdrop?tag=${tag}`);
  }
  if (item?.ImageTags?.Primary) {
    const tag = item.ImageTags.Primary;
    return withServer(`/Items/${item.Id}/Images/Primary?tag=${tag}`);
  }
  return null;
}

function clearTransientOverlays(modal = modalState.videoModal) {
  try {
    const vc = modal?.querySelector?.('.video-container');
    if (!vc) return;
    vc.querySelectorAll?.('.trailer-tip, .no-trailer-message')?.forEach(n => n.remove());
  } catch {}
}

export function resetModalButtons() {
  try {
    if (modalState.modalButtonsContainer) {
      modalState.modalButtonsContainer.style.opacity = '0';
      modalState.modalButtonsContainer.style.pointerEvents = 'none';
    }
    if (modalState.modalPlayButton) modalState.modalPlayButton.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (modalState.modalFavoriteButton) {
      modalState.modalFavoriteButton.classList.remove('favorited');
      modalState.modalFavoriteButton.innerHTML = '<i class="fa-solid fa-plus"></i>';
    }
    const vb = modalState.videoModal?.querySelector?.('.preview-volume-button');
    if (vb) vb.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    applyVolumePreference();
  } catch {}
}

export function resetModalInfo(modal = modalState.videoModal) {
  try {
    if (!modal) return;
    if (modalState.modalTitle) modalState.modalTitle.textContent = '';
    if (modalState.modalEpisodeLine) { modalState.modalEpisodeLine.textContent = ''; modalState.modalEpisodeLine.style.display = 'none'; }
    if (modalState.modalMeta) modalState.modalMeta.textContent = '';
    if (modalState.modalMatchInfo) modalState.modalMatchInfo.textContent = '';
    if (modalState.modalGenres) modalState.modalGenres.innerHTML = '';
    if (modal?.dataset) modal.dataset.itemId = '';
  } catch {}
}

function toggleYouTubeVolumeManual(iframe, volumeBtn) {
  try {
    const src = iframe?.src || '';
    if (!src) return;
    const url = new URL(src, window.location.href);
    const currentMute = url.searchParams.get('mute');
    const nextMute = currentMute === '1' ? '0' : '1';
    url.searchParams.set('mute', nextMute);
    iframe.src = url.toString();
    if (volumeBtn) {
      volumeBtn.innerHTML = nextMute === '1'
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  } catch {}
}

function startVideoPlayback(url) {
  try {
    if (!modalState.videoModal) return;
    const v = modalState.modalVideo;
    if (!v) return;
    url = absServerUrl(url);
    if (v._hls) { v._hls.destroy(); delete v._hls; }
    v.pause();
    v.src = url;
    v.load();
    v.onloadedmetadata = () => { v.currentTime = 600; v.play().catch(()=>{}); };
  } catch {}
}

function startCacheMaintenance() {
  if (modalState._cacheMaintenanceStarted) return;
  modalState._cacheMaintenanceStarted = true;

  modalState._cacheMaintenanceTimer = setInterval(() => {
    pruneExpired();
    capMap(hasTrailerCache);
    capMap(_seriesTrailerCache);
    capMap(_seriesIdCache);
    capMap(__typeCache);
  }, 60_000);

  const onVis = () => {
    if (!document.hidden) {
      pruneExpired();
      capMap(hasTrailerCache);
      capMap(_seriesTrailerCache);
      capMap(_seriesIdCache);
      capMap(__typeCache);
    }
  };
  modalState._visibilityHandler = onVis;
  document.addEventListener('visibilitychange', onVis);
}
startCacheMaintenance();

export async function calculateMatchPercentage(userData = {}, item = {}) {
  let score = 50;
  if (typeof userData.PlayedPercentage === 'number') {
    if (userData.PlayedPercentage > 90) score += 15;
    else if (userData.PlayedPercentage > 50) score += 5;
    else if (userData.PlayedPercentage > 20) score += 2;
  }
  if (typeof item.CommunityRating === 'number') {
    if (item.CommunityRating >= 8.5) score += 30;
    else if (item.CommunityRating >= 7.5) score += 24;
    else if (item.CommunityRating >= 6.5) score += 8;
  }
  const userTopGenres = await getCachedUserTopGenres(5);
  const itemGenres = item.Genres || [];
  const genreMatches = itemGenres.filter(g => userTopGenres.includes(g));
  if (genreMatches.length > 0) {
    if (genreMatches.length === 1) score += 5;
    else if (genreMatches.length === 2) score += 10;
    else if (genreMatches.length >= 3) score += 15;
  }
  const currentYear = new Date().getFullYear();
  if (item.ProductionYear && currentYear - item.ProductionYear <= 5) score += 4;
  const familyFriendlyRatings = ["G", "PG", "TV-G", "TV-PG"];
  if (familyFriendlyRatings.includes(item.OfficialRating)) score += 3;
  if (userData.Played) score -= 5;
  return Math.max(0, Math.min(Math.round(score), 100));
}

function formatSeasonEpisodeLine(ep) {
    const sWord = L('season', 'Season');
    const eWord = L('episode', 'Episode');
    const sNum  = ep?.ParentIndexNumber;
    const eNum  = ep?.IndexNumber;
    const eTitle = ep?.Name ? ` – ${ep.Name}` : '';
    const numberFirst = new Set(['tur']);

    let left = '', right = '';
    if (numberFirst.has(currentLang)) {
        if (sNum != null) left = `${sNum}. ${sWord}`;
        if (eNum != null) right = `${eNum}. ${eWord}`;
    } else {
        if (sNum != null) left = `${sWord} ${sNum}`;
        if (eNum != null) right = `${eWord} ${eNum}`;
    }
    const mid = left && right ? ' • ' : '';
    return `${left}${mid}${right}${eTitle}`.trim();
}

export function getPlayButtonText({ isPlayed, hasPartialPlayback, labels }) {
  if (isPlayed && !hasPartialPlayback) return L('izlendi', 'İzlendi');
  if (hasPartialPlayback) return L('devamet', 'Devam et');
  return L('izle', 'İzle');
}

export async function ensureOverlaysClosed() {
  if (isMiniPopoverOpen()) {
    await closeMiniPopoverSafely();
    await sleep(40);
  }
  await closeVideoModalAndWait();
}

function isMiniPopoverOpen() {
  if (window.__miniPop && document.body.contains(window.__miniPop)) return true;
  if (document.querySelector('.mini-trailer-popover')) return true;
  return false;
}

export function bindModalEvents(modal) {
  modal.addEventListener('mouseenter', () => {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });
  modal.addEventListener('mouseleave', () => {
    modalState.isMouseInModal = false;
    closeVideoModal();
  });
  modal.addEventListener('pointerleave', () => {
    modalState.isMouseInModal = false;
    closeVideoModal();
  });
}

async function closeMiniPopoverSafely() {
  try {
    document.dispatchEvent(new CustomEvent('closeAllMiniPopovers'));
    if (typeof window.__closeMiniPopover === 'function') window.__closeMiniPopover();
  } catch {}
}

async function closeVideoModalAndWait() {
  if (!modalIsVisible()) return;
  closeVideoModal();
  const wait = (MODAL_ANIM?.closeMs ?? 180) + (HARD_CLOSE_BUFFER_MS ?? 30) + 30;
  await sleep(wait);
}

export async function goToDetailsPageSafe(itemId) {
  await ensureOverlaysClosed();
  return goToDetailsPage(itemId);
}

export function animatedOpen(modal, anchorEl, pos = 'item') {
  if (!modal) return;
  if (pos === 'item') positionModalRelativeToItem(modal, anchorEl);
  else if (pos === 'dot') positionModalRelativeToDot(modal, anchorEl);
  animatedShow(modal);
}

export async function openPreviewModalForItem(itemId, anchorEl, opts = {}) {
   const bypass = !!opts.bypass;
   if (!bypass && Date.now() < (modalState.__suppressOpenUntil || 0)) return;
  try {
    const cfg = getConfig();
    const mode = (cfg?.globalPreviewMode || 'modal');
    if (mode !== 'modal' || cfg?.allPreviewModal === false || !itemId) return;
    if (!canOpenItem(itemId)) return;
    if (modalIsVisible() && modalState.videoModal?.dataset?.itemId === String(itemId)) {
      if (anchorEl) positionModalRelativeToItem(modalState.videoModal, anchorEl);
      applyVolumePreference(modalState.videoModal);
      return;
    }
    if (isMiniPopoverOpen()) {
      await closeMiniPopoverSafely();
      await sleep(40);
    }

    await ensureOverlaysClosed();
    let modal = ensureGlobalModal();
    if (!modal) return;

    const ac = new AbortController();
    const { signal } = ac;
    const item = await fetchItemDetails(itemId, { signal });
    if (!item) return;

    let domBackdrop = null;
    try {
      domBackdrop =
        anchorEl?.dataset?.background ||
        anchorEl?.dataset?.backdrop ||
        anchorEl?.closest?.('[data-background]')?.dataset?.background ||
        null;
    } catch {}

    const itemBackdrop = getBackdropFromItem(item);
    modal = ensureGlobalModal();
    if (!modal) return;
    modal = ensureGlobalModal();
    if (!modal) return;
    hardWipeModalDom(modal);
    if (typeof modal.setBackdrop === 'function') {
    const backdropUrl = domBackdrop || itemBackdrop;
    if (backdropUrl && !backdropUrl.startsWith('http')) {
      modal.setBackdrop(withServer(backdropUrl));
    } else {
      modal.setBackdrop(backdropUrl);
    }
  }
    const myToken = newRenderToken();
    modal.dataset.itemId = String(itemId);
    if (anchorEl) positionModalRelativeToItem(modalState.videoModal, anchorEl);
    animatedShow(modal);

    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
    if (modalState.modalButtonsContainer) {
      modalState.modalButtonsContainer.style.pointerEvents = 'auto';
      modalState.modalButtonsContainer.style.opacity = '1';
    }
    applyVolumePreference(modalState.videoModal);

    let videoUrl = null;
    try { videoUrl = await preloadVideoPreview(itemId); } catch {}
    if (!isTokenAlive(myToken) || modal.dataset.itemId !== String(itemId)) return;
    await updateModalContent(item, videoUrl);

    const iframe = modal.querySelector('.preview-trailer-iframe');
    const hasIframe = !!(iframe && iframe.style.display !== 'none' && iframe.src);
    const hasVideo  = !!(modalState.modalVideo && modalState.modalVideo.style.display !== 'none');
    const hasPlayable = hasIframe || hasVideo;
    if (!hasPlayable) closeVideoModal();
  } catch (e) {
    console.error('openPreviewModalForItem hatası:', e);
  }
}

(function installNavigationGuards() {
  if (window.__navGuardsInstalled) return;
  window.__navGuardsInstalled = true;

  const tryPatchShowItem = () => {
    if (typeof window.showItemDetailsPage === 'function' && !window.__showItemPatched) {
      const __origShowItemDetailsPage = window.showItemDetailsPage;
      window.showItemDetailsPage = async (...args) => {
        await ensureOverlaysClosed();
        return __origShowItemDetailsPage(...args);
      };
      window.__showItemPatched = true;
    }
  };

  tryPatchShowItem();
  const patchTimer = setInterval(() => {
    tryPatchShowItem();
    if (window.__showItemPatched) clearInterval(patchTimer);
  }, 250);

  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    if (e.defaultPrevented) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (modalIsVisible()) {
      e.preventDefault();
      const href = a.href;
      ensureOverlaysClosed().then(() => { window.location.href = href; });
    }
  }, true);

  const onRouteChange = () => { ensureOverlaysClosed(); };
  window.addEventListener('popstate', onRouteChange, true);
  window.addEventListener('hashchange', onRouteChange, true);
})();

(function patchHistoryNav() {
  if (window.__historyPatched) return;
  window.__historyPatched = true;

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  const wrap = (fn) => async function(...args) {
    try { await ensureOverlaysClosed(); } catch {}
    return fn.apply(this, args);
  };

  history.pushState    = wrap(origPush);
  history.replaceState = wrap(origReplace);
})();

window.addEventListener("beforeunload", () => {
  destroyVideoModal();
  previewPreloadCache.clear();
});

export function updateActiveDot() {
  const currentIndex = getCurrentIndex();
  const dots = document.querySelectorAll(".dot");
  const config = getConfig();
  dots.forEach(dot => {
    const wasActive = dot.classList.contains("active");
    const dotIndex = Number(dot.dataset.index);
    const isActive = dotIndex === currentIndex;
    dot.classList.toggle("active", isActive);
    if (config.dotPosterMode && config.enableDotPosterAnimations) {
      if (wasActive !== isActive) {
        applyDotPosterAnimation(dot, isActive);
      }
    }
  });

  if (config.dotPosterMode) {
    centerActiveDot({ smooth: true, force: true });
  }
}

if (typeof window !== 'undefined') {
   window.tryOpenHoverModal = function(itemId, anchorEl, opts = {}) {
     openPreviewModalForItem(itemId, anchorEl, { bypass: true, ...opts });
   };
 }

function clearWillChange(modal) {
  if (!modal) return;
  try {
    modal.style.removeProperty('will-change');
    modal.querySelectorAll('[style*="will-change"]').forEach(el => {
      el.style.removeProperty('will-change');
    });
  } catch {}
  try {
    const pop = document.querySelector('.mini-trailer-popover');
    if (pop) {
      pop.style.removeProperty('will-change');
      pop.querySelectorAll('[style*="will-change"]').forEach(el => {
        el.style.removeProperty('will-change');
      });
    }
  } catch {}
  const SELECTORS = [
    '.video-preview-modal',
    '.preview-iframe-wrapper',
    '.preview-trailer-iframe',
    '.preview-video',
    '.mini-trailer-popover',
    '.studio-trailer-video',
    '.studio-trailer-iframe'
  ];

  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (!rule || !rule.selectorText || !rule.style) continue;
          const hits = SELECTORS.some(sel => rule.selectorText.includes(sel));
          if (hits && rule.style.willChange) {
            rule.style.removeProperty('will-change');
          }
        }
      } catch {
      }
    }
  } catch {}
  try { modal.offsetHeight; } catch {}
}

function nextFrame(cb) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

window.addEventListener('jms:hoverTrailer:open', (ev) => {
  try {
    const { itemId, anchor, bypass } = ev?.detail || {};
    if (!itemId) return;
    openPreviewModalForItem(itemId, anchor || null, { bypass: bypass !== false });
  } catch {}
}, { passive: true });

window.addEventListener('jms:hoverTrailer:close', () => {
  try { closeVideoModal(); } catch {}
}, { passive: true });

window.addEventListener('jms:globalPreviewModeChanged', (ev) => {
  const mode = ev?.detail?.mode;
  if (mode === 'modal') {
    try { document.dispatchEvent(new CustomEvent('closeAllMiniPopovers')); } catch {}
    try { setupHoverForAllItems(); } catch {}
  }
});
