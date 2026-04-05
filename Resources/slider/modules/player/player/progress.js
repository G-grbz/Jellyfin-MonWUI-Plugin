import { musicPlayerState } from "../core/state.js";
import { handleSongEnd } from "./playback.js";
import { updateSyncedLyrics } from "../lyrics/lyrics.js";
import { getConfig } from "../../config.js";

let uiEvtCtrl = null;
let isDragging = false;
let isClick = false;
let dragStartX = 0;
let dragStartTime = 0;
let lastUpdateTime = 0;

function getLiveLabel() {
  return getConfig()?.languageLabels?.radioLiveLabel || "LIVE";
}

function resetUiEvtCtrl() {
  if (uiEvtCtrl) {
    try { uiEvtCtrl.abort(); } catch {}
  }
  uiEvtCtrl = new AbortController();
  return uiEvtCtrl.signal;
}
export function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const minutes = Math.floor(Math.min(seconds, 5999) / 60);
  const secs = Math.floor(Math.min(seconds, 5999) % 60);
  return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
}

function getEffectiveDuration() {
  if (musicPlayerState.isLiveStream) {
    return Number.NaN;
  }

  const { audio } = musicPlayerState;

  if (audio && isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  if (isFinite(musicPlayerState.currentTrackDuration)) {
    return musicPlayerState.currentTrackDuration;
  }
  return 30;
}

function updateMediaPositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;

  const audio = musicPlayerState.audio;
  if (!audio || musicPlayerState.isLiveStream) return;

  const duration = getEffectiveDuration();
  if (!isFinite(duration) || duration <= 0) return;

  const currentTime = Number(audio.currentTime);
  const position = Math.max(0, Math.min(isFinite(currentTime) ? currentTime : 0, duration));

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate || 1,
      position
    });
  } catch (e) {
    console.warn("MediaSession konum durumu güncellemesi başarısız:", e);
  }
}

export function setupAudioListeners() {
  if (musicPlayerState.__audioCtrl && !musicPlayerState.__audioCtrl.signal.aborted) {
    try { musicPlayerState.__audioCtrl.abort(); } catch {}
  }
  const ctrl = new AbortController();
  musicPlayerState.__audioCtrl = ctrl;
  const signal = ctrl.signal;

  const { audio } = musicPlayerState;
  if (!audio) return;

  const timeupdateCombined = () => {
    updateProgress();
    updateMediaPositionState();
  };
  const onLyricsTimeUpdate = () => {
    updateSyncedLyrics(audio.currentTime);
  };

  audio.addEventListener("timeupdate", timeupdateCombined, { signal });
  audio.addEventListener("timeupdate", onLyricsTimeUpdate, { signal });
  const onEnded = () => {
    try {
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    } catch {}
    handleSongEnd();
  };
  audio.addEventListener("ended", onEnded, { signal, once: true });

  audio.addEventListener("loadedmetadata", () => {
    updateDuration();
    updateMediaPositionState();
  }, { signal });
}

export function setupProgressControls() {
  const { progressBar, progressHandle } = musicPlayerState;
  if (!progressBar || !progressHandle) return;
  const signal = resetUiEvtCtrl();

  progressBar.addEventListener("mousedown", handleMouseDown, { signal });
  progressBar.addEventListener("touchstart", handleTouchStart, { signal, passive: false });
  progressBar.addEventListener("click", handleClick, { signal });
  progressHandle.addEventListener("mousedown", handleMouseDown, { signal });
  progressHandle.addEventListener("touchstart", handleTouchStart, { signal, passive: false });

  document.addEventListener("mousemove", handleMouseMove, { signal });
  document.addEventListener("mouseup", handleMouseUp, { signal });
  document.addEventListener("touchmove", handleTouchMove, { signal, passive: false });
  document.addEventListener("touchend", handleTouchEnd, { signal });

  progressBar.addEventListener("wheel", handleWheel, { signal, passive: false });
  signal.addEventListener("abort", () => {
    isDragging = false;
    isClick = false;
  });

  updateProgress();
}

function handleMouseDown(e) {
  if (!e.target.closest(".player-progress-bar, .player-progress-handle")) return;

  dragStartX = e.clientX;
  dragStartTime = Date.now();
  isClick = true;
  isDragging = true;
  e.preventDefault();
}
function handleTouchStart(e) {
  if (!e.target.closest(".player-progress-bar, .player-progress-handle")) return;

  dragStartX = e.touches[0].clientX;
  dragStartTime = Date.now();
  isClick = true;
  isDragging = true;
  e.preventDefault();
}
function handleClick(e) {
  if (!isClick || isDragging) return;
  seekToPosition(e.clientX);
}
function handleMouseMove(e) {
  if (!isDragging) return;

  const movedDistance = Math.abs(e.clientX - dragStartX);
  const elapsedTime = Date.now() - dragStartTime;

  if (isClick && (movedDistance > 5 || elapsedTime > 100)) {
    isClick = false;
  }
  seekToPosition(e.clientX);
}
function handleTouchMove(e) {
  if (!isDragging) return;

  const movedDistance = Math.abs(e.touches[0].clientX - dragStartX);
  const elapsedTime = Date.now() - dragStartTime;

  if (isClick && (movedDistance > 5 || elapsedTime > 100)) {
    isClick = false;
  }
  seekToPosition(e.touches[0].clientX);
  e.preventDefault();
}
function handleMouseUp() {
  if (isClick) seekToPosition(dragStartX);
  endDrag();
}
function handleTouchEnd() {
  if (isClick) seekToPosition(dragStartX);
  endDrag();
}
function endDrag() {
  isDragging = false;
  isClick = false;
}

function seekToPosition(clientX) {
  const { audio, progressBar, progressHandle, durationEl } = musicPlayerState;
  if (!audio || !progressBar) return;
  if (musicPlayerState.isLiveStream) return;

  const rect = progressBar.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const percent = (x / rect.width) * 100;
  const dur = getEffectiveDuration();
  const seekTime = (percent / 100) * dur;

  if (isFinite(seekTime)) {
    audio.currentTime = seekTime;
    if (progressHandle) progressHandle.style.left = `${percent}%`;
    updateProgress();
    updateMediaPositionState();

    const remaining = Math.max(0, dur - audio.currentTime);
    if (durationEl) durationEl.textContent = `-${formatTime(remaining)}`;
  }
}

export function updateProgress() {
  const now = Date.now();
  if (now - lastUpdateTime < 200 && !isDragging) return;
  lastUpdateTime = now;

  const { audio, progress, currentTimeEl, progressHandle, durationEl, showRemaining } = musicPlayerState;
  const dur = getEffectiveDuration();

  if (!progress || !currentTimeEl || !durationEl) return;

  if (musicPlayerState.isLiveStream) {
    progress.style.width = `100%`;
    if (progressHandle) {
      progressHandle.style.left = `100%`;
      progressHandle.style.display = `none`;
    }
    if (musicPlayerState.progressBar) {
      musicPlayerState.progressBar.style.cursor = "default";
    }
    currentTimeEl.textContent = formatTime(audio?.currentTime || 0);
    durationEl.textContent = getLiveLabel();
    return;
  }

  if (progressHandle) {
    progressHandle.style.display = "";
  }
  if (musicPlayerState.progressBar) {
    musicPlayerState.progressBar.style.cursor = "";
  }

  if (!isFinite(dur) || dur <= 0) {
    progress.style.width = `0%`;
    if (progressHandle) progressHandle.style.left = `0%`;
    currentTimeEl.textContent = formatTime(audio?.currentTime || 0);
    durationEl.textContent = formatTime(dur);
    return;
  }

  const current = Math.min(dur, (audio?.currentTime || 0));
  const percent = Math.min(100, (current / dur) * 100);
  progress.style.width = `${percent}%`;
  if (progressHandle) progressHandle.style.left = `${percent}%`;

  currentTimeEl.textContent = formatTime(current);
  if (showRemaining) {
    const remaining = Math.max(0, dur - current);
    durationEl.textContent = `-${formatTime(remaining)}`;
  } else {
    durationEl.textContent = formatTime(dur);
  }
}

export function updateDuration() {
  const { durationEl } = musicPlayerState;
  if (!durationEl) return;
  if (musicPlayerState.isLiveStream) {
    durationEl.textContent = getLiveLabel();
    return;
  }
  const dur = getEffectiveDuration();
  durationEl.textContent = formatTime(dur);
}

export function cleanupMediaSession() {
  return;
}

export function cleanupProgressControls() {
  if (uiEvtCtrl) {
    try { uiEvtCtrl.abort(); } catch {}
    uiEvtCtrl = null;
  }
  isDragging = false;
  isClick = false;
}

function handleWheel(e) {
  e.preventDefault();
  const { audio } = musicPlayerState;
  if (!audio) return;
  if (musicPlayerState.isLiveStream) return;

  const delta = e.deltaY > 0 ? -1 : 1;
  const seekAmount = 1;

  audio.currentTime = Math.max(0, Math.min(audio.currentTime + (delta * seekAmount), getEffectiveDuration()));

  updateProgress();
  updateMediaPositionState();

  const { progressHandle } = musicPlayerState;
  if (progressHandle) {
    setTimeout(() => {
      progressHandle.style.transform = "";
    }, 200);
  }
}
