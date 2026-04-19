import { initPlayer, togglePlayerVisibility, isPlayerInitialized } from "./utils/mainIndex.js";
import { musicPlayerState, saveUserSettings } from "./core/state.js";
import { refreshPlaylist, playTrackById, playAlbumById } from "./core/playlist.js";
import { updateProgress, updateDuration } from "./player/progress.js";
import { syncDbIncremental, syncDbFullscan } from "./ui/artistModal.js";
import { loadJSMediaTags } from "./lyrics/id3Reader.js";
import { getConfig } from "../config.js";
import { initializeControlStates, toggleMute, updateVolumeIcon } from "./ui/controls.js";
import { togglePlayPause } from "./player/playback.js";
import { faIconHtml } from "../faIcons.js";
import { loadCSS } from "../playerStyles.js";

export { isMobileDevice } from "../playerStyles.js";

const config = getConfig();

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function settle(ms = 60) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getGmmpPlaybackState() {
  const audio = musicPlayerState?.audio;
  const track = musicPlayerState?.currentTrack || musicPlayerState?.playlist?.[musicPlayerState?.currentIndex] || null;
  const runtimeSeconds = Number.isFinite(audio?.duration) && audio.duration > 0
    ? audio.duration
    : (Number.isFinite(musicPlayerState?.currentTrackDuration) ? musicPlayerState.currentTrackDuration : 0);
  const currentVolume = clamp(
    Math.round((audio?.muted ? 0 : Number(audio?.volume ?? musicPlayerState?.userSettings?.volume ?? 0)) * 100),
    0,
    100
  );

  return {
    hasCurrentTrack: !!track,
    trackId: track?.Id ? String(track.Id) : "",
    isPaused: !!audio?.paused,
    isMuted: !!audio?.muted || currentVolume <= 0,
    volumeLevel: currentVolume,
    positionTicks: Math.max(0, Math.floor(Number(audio?.currentTime || 0) * 10_000_000)),
    runtimeTicks: Math.max(0, Math.floor(Number(runtimeSeconds || 0) * 10_000_000)),
    isLiveStream: !!musicPlayerState?.isLiveStream
  };
}

async function setGmmpPaused(paused) {
  await ensureGmmpInit({ show: false });
  const audio = musicPlayerState?.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  if (!!audio.paused !== !!paused) {
    if (typeof togglePlayPause === "function") {
      togglePlayPause();
      await settle(paused ? 20 : 80);
    }

    if (!!audio.paused !== !!paused) {
      if (paused) {
        audio.pause();
      } else {
        await audio.play();
      }
    }
  }

  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = paused ? "paused" : "playing";
    }
  } catch {}

  return getGmmpPlaybackState();
}

async function setGmmpMuted(muted) {
  await ensureGmmpInit({ show: false });
  const audio = musicPlayerState?.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  const nextMuted = !!muted;
  if (!nextMuted && Number(audio.volume || 0) <= 0) {
    const restored = clamp(
      Math.round(Number(musicPlayerState?.userSettings?.volume ?? 0.7) * 100),
      1,
      100
    ) / 100;
    audio.volume = restored;
    if (musicPlayerState?.userSettings) {
      musicPlayerState.userSettings.volume = restored;
    }
  }

  if (!!audio.muted !== nextMuted && typeof toggleMute === "function") {
    toggleMute();
  }
  if (!!audio.muted !== nextMuted) {
    audio.muted = nextMuted;
  }

  if (musicPlayerState?.volumeSlider) {
    try {
      musicPlayerState.volumeSlider.value = String(nextMuted ? 0 : Number(audio.volume || 0));
    } catch {}
  }

  try {
    updateVolumeIcon(nextMuted ? 0 : Number(audio.volume || 0));
  } catch {}

  try {
    saveUserSettings?.();
  } catch {}

  return getGmmpPlaybackState();
}

async function setGmmpVolume(volumeLevel) {
  await ensureGmmpInit({ show: false });
  const audio = musicPlayerState?.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  const normalized = clamp(volumeLevel, 0, 100) / 100;
  audio.volume = normalized;
  audio.muted = normalized <= 0;

  if (musicPlayerState?.userSettings) {
    musicPlayerState.userSettings.volume = normalized;
  }

  if (musicPlayerState?.volumeSlider) {
    try {
      musicPlayerState.volumeSlider.value = String(normalized);
    } catch {}
  }

  try {
    updateVolumeIcon(normalized);
  } catch {}

  try {
    saveUserSettings?.();
  } catch {}

  return getGmmpPlaybackState();
}

export async function ensureGmmpInit({ show = true } = {}) {
  try {
    initializeControlStates?.();
    if (!isPlayerInitialized()) {
      await loadJSMediaTags?.();
      await initPlayer();
      await new Promise(r => setTimeout(r, 50));
    }
    if (show) {
      const visible = !!document.querySelector(".gmmp-player.visible, .modernPlayer.visible");
      if (!visible) {
        try { togglePlayerVisibility(); } catch {}
      }
    }
    return true;
  } catch (e) {
    console.warn("ensureGmmpInit failed:", e);
    return false;
  }
}

export async function destroyGmmp({ reason = "manual" } = {}) {
  try {
    const [
      stateMod,
      playbackMod,
      progressMod,
      mediaSessionMod,
      controlsMod,
      playlistModalMod,
      playerUiMod,
      artistModalMod,
      genreFilterMod,
      notificationMod
    ] = await Promise.all([
      import("./core/state.js").catch(() => null),
      import("./player/playback.js").catch(() => null),
      import("./player/progress.js").catch(() => null),
      import("./core/mediaSession.js").catch(() => null),
      import("./ui/controls.js").catch(() => null),
      import("./ui/playlistModal.js").catch(() => null),
      import("./ui/playerUI.js").catch(() => null),
      import("./ui/artistModal.js").catch(() => null),
      import("./ui/genreFilterModal.js").catch(() => null),
      import("./ui/notification.js").catch(() => null)
    ]);

    const musicPlayerState = stateMod?.musicPlayerState;
    if (!musicPlayerState) return false;

    await playbackMod?.stopPlayback?.({ resetSource: true }).catch(() => false);

    try { progressMod?.cleanupProgressControls?.(); } catch {}
    try { progressMod?.cleanupMediaSession?.(); } catch {}
    try { mediaSessionMod?.cleanupMediaSession?.(); } catch {}
    try { controlsMod?.destroyControls?.(); } catch {}
    try { playlistModalMod?.destroyPlaylistModal?.(); } catch {}
    try { genreFilterMod?.closeModalSafe?.(); } catch {}
    try { artistModalMod?.destroyArtistModal?.(); } catch {}
    try { playerUiMod?.destroyModernPlayerUI?.(); } catch {}

    [
      "#gmmp-radio-modal",
      "#music-stats-modal"
    ].forEach((selector) => {
      try { document.querySelector(selector)?.remove?.(); } catch {}
    });

    try { notificationMod?.destroyNotificationSystem?.(); } catch {}

    musicPlayerState.isPlayerVisible = false;
    musicPlayerState.modernPlayer = null;
    musicPlayerState.favoriteBtn = null;
    musicPlayerState.playlistModal = null;
    musicPlayerState.playlistItemsContainer = null;
    musicPlayerState.playlistSearchInput = null;
    musicPlayerState.radioModal = null;
    musicPlayerState.mediaSessionInitialized = false;
    try { musicPlayerState.selectedTracks?.clear?.(); } catch {}
    musicPlayerState.selectedTracks = new Set();

    return true;
  } catch (err) {
    console.warn("GMMP destroy failed:", { reason, err });
    return false;
  }
}

let stylesInjected = false;
function ensurePointerStylesInjected() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.id = "gmmp-pointer-style";
  style.textContent = `
    html .skinHeader { pointer-events: all !important; }
    button#jellyfinPlayerToggle {
      display: block !important;
      opacity: 1 !important;
      pointer-events: all !important;
      background: none !important;
      text-shadow: rgb(255 255 255) 0 0 2px !important;
      cursor: pointer !important;
      border: none !important;
    }
  `;
  document.head.appendChild(style);
}

function forceSkinHeaderPointerEvents() {
  ensurePointerStylesInjected();
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const to = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Zaman aşımı bekleniyor ${selector}`));
    }, timeout);
    const cleanupResolve = (el) => {
      clearTimeout(to);
      return el;
    };
    resolve = ((orig) => (v) => orig(cleanupResolve(v)))(resolve);
  });
}

function createPlayerButton() {
  const cfg = getConfig();
  if (typeof cfg !== "undefined" && cfg.enabledGmmp !== false) {
    const btn = document.createElement("button");
    btn.id = "jellyfinPlayerToggle";
    btn.type = "button";
    btn.className = "headerSyncButton syncButton headerButton headerButtonRight paper-icon-button-light";
    btn.setAttribute("is", "paper-icon-button-light");
    btn.setAttribute("aria-label", "GMMP Aç/Kapa");
    btn.title = "GMMP";
    btn.innerHTML = faIconHtml("play", "gmmp");
    return btn;
  }
  return null;
}

let initInProgress = false;

async function onToggleClick() {
  if (initInProgress) return;

  try {
    forceSkinHeaderPointerEvents();
    initializeControlStates();

    if (!isPlayerInitialized()) {
      initInProgress = true;

      await loadJSMediaTags();
      await initPlayer();
      await new Promise(r => setTimeout(r, 250));
      queueMicrotask(() => {
      const run = async () => {
        try {
          const dbIsEmpty = async () => {
            try {
              const t = await window.__musicDB?.getAllTracks?.();
              return !t || t.length === 0;
            } catch {
              return true;
            }
          };
          const r = await syncDbIncremental().catch(() => null);

          if (!r || r.skipped === "no-credentials" || await dbIsEmpty()) {
            await syncDbFullscan({ force: true }).catch(() => {});
          }
        } catch {}
      };

  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 800);
});

      togglePlayerVisibility();
      await refreshPlaylist();
      setTimeout(() => {
        try {
          updateDuration();
          updateProgress();
        } catch (e) {
          console.debug("Progress/duration update skipped:", e);
        }
      }, 500);

    } else {
      togglePlayerVisibility();
    }
  } catch (err) {
    console.error("GMMP geçiş hatası:", err);
  } finally {
    initInProgress = false;
  }
}

export async function addPlayerButton() {
  try {
    forceSkinHeaderPointerEvents();
    loadCSS();

    const header = await waitForElement(".headerRight");
    if (document.getElementById("jellyfinPlayerToggle")) return;

    const btn = createPlayerButton();
    if (!btn) return;
    header.insertBefore(btn, header.firstChild);

    btn.addEventListener("click", onToggleClick, { passive: true });
  } catch (err) {
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    forceSkinHeaderPointerEvents();
    addPlayerButton();
  }, { once: true });
} else {
  forceSkinHeaderPointerEvents();
  addPlayerButton();
}


if (typeof window !== "undefined") {
  window.__GMMP = window.__GMMP || {};
  Object.assign(window.__GMMP, {
    playTrackById,
    playAlbumById,
    ensureInit: ensureGmmpInit,
    destroy: destroyGmmp,
    getPlaybackState: getGmmpPlaybackState,
    setPaused: setGmmpPaused,
    setMuted: setGmmpMuted,
    setVolume: setGmmpVolume
  });
}
