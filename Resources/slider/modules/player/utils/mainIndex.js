import { musicPlayerState, loadUserSettings } from "../core/state.js";
import { updateMediaMetadata, initMediaSession, updatePositionState } from "../core/mediaSession.js";
import { refreshPlaylist } from "../core/playlist.js";
import { createModernPlayerUI } from "../ui/playerUI.js";
import { setupMobileTouchControls } from "./domUtils.js";
import { loadJSMediaTags } from "../lyrics/id3Reader.js";
import { setupAudioListeners } from "../player/progress.js";
import { enableKeyboardControls } from "../ui/controls.js";

let __artistModalModulePromise = null;

function startGmmpSchedulerWhenVisible() {
    __artistModalModulePromise = __artistModalModulePromise || import("../ui/artistModal.js");
    __artistModalModulePromise
        .then(({ startGlobalDbFullscanScheduler }) => {
            if (!musicPlayerState.isPlayerVisible) return;
            try { startGlobalDbFullscanScheduler?.(); } catch (e) {
                console.warn("startGlobalDbFullscanScheduler failed:", e);
            }
        })
        .catch((e) => {
            __artistModalModulePromise = null;
            console.warn("startGlobalDbFullscanScheduler failed:", e);
        });
}

export async function initPlayer() {
  try {
    await loadJSMediaTags();
    loadUserSettings();

    const playerElements = createModernPlayerUI();
    setupAudioListeners();


    if (/Android/i.test(navigator.userAgent)) {
      window.addEventListener('beforeunload', () => {
        try { navigator.mediaSession.metadata = null; } catch {}
      });
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autoplay') === 'true') {
      await refreshPlaylist();
    }

    return playerElements;
  } catch (err) {
    console.error("Oynatıcı başlatılırken hata:", err);
    throw err;
  }
}

export function togglePlayerVisibility() {
    musicPlayerState.isPlayerVisible = !musicPlayerState.isPlayerVisible;
    musicPlayerState.modernPlayer.classList.toggle("visible", musicPlayerState.isPlayerVisible);

    if (musicPlayerState.modernPlayer) {
        if (musicPlayerState.isPlayerVisible) {
            musicPlayerState.modernPlayer.removeAttribute('aria-hidden');
            musicPlayerState.modernPlayer.inert = false;
            startGmmpSchedulerWhenVisible();
            setTimeout(() => musicPlayerState.playPauseBtn.focus(), 100);
            enableKeyboardControls();
        } else {
            document.activeElement.blur();
            musicPlayerState.modernPlayer.setAttribute('aria-hidden', 'true');
            musicPlayerState.modernPlayer.inert = true;
        }
    }
}

export function isPlayerInitialized() {
    return musicPlayerState.modernPlayer !== null;
}
