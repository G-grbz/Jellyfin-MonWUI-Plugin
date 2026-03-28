import { startSlideTimer, stopSlideTimer, pauseSlideTimer, resumeSlideTimer, SLIDE_DURATION } from "./timer.js";
import { getCurrentIndex, setCurrentIndex, getSlideDuration, setAutoSlideTimeout, getAutoSlideTimeout, setSlideStartTime, getSlideStartTime, setRemainingTime, getRemainingTime } from "./sliderState.js";
import { attachMouseEvents, setupVisibilityHandler } from "./events.js";
import { getConfig } from './config.js';
import { applyContainerStyles } from "./positionUtils.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';

let secondsEl = null;
let pausedProgressPct = 0;
let secondsTimer = null;
let secondsPausedMs = 0;
let secondsEndAt = 0;
let frameLockRaf = null;
let __pbInited = false;
let __paused = false;
let secondsRunId = 0;
let __pbStartRafA = 0;
let __pbStartRafB = 0;

function now() { return performance.now(); }

function getSlidesContainer() {
  return document.querySelector(
    "#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container"
  );
}

function getCurrentSlideHost() {
  const sc = getSlidesContainer();
  if (!sc) return null;
  const active = sc.querySelector(".monwui-slide.active");
  if (active) return active;
  return null;
}

function mountSecondsToActiveSlide(el) {
  if (!el) return;
  const host = getCurrentSlideHost();
  if (host && el.parentElement !== host) {
    host.appendChild(el);
    return;
  }
  if (host) return;
  if (el.parentElement) return;

  const sc = getSlidesContainer();
  if (sc && el.parentElement !== sc) {
    sc.appendChild(el);
  }
}

export function useSecondsMode() {
  const cfg = getConfig();
  return !!(cfg.showProgressBar && cfg.showProgressAsSeconds);
}

function clearRaf() {
  if (frameLockRaf) {
    cancelAnimationFrame(frameLockRaf);
    frameLockRaf = null;
  }
}

function cancelProgressStartRafs() {
  if (__pbStartRafA) cancelAnimationFrame(__pbStartRafA);
  if (__pbStartRafB) cancelAnimationFrame(__pbStartRafB);
  __pbStartRafA = 0;
  __pbStartRafB = 0;
}

function isPeakProgressMode(slidesContainer = getSlidesContainer()) {
  return !!slidesContainer?.classList?.contains('peak-mode');
}

function queueProgressAnimation(bar, {
  duration,
  startScale = 0,
  endScale = 1,
  syncLayout = true
} = {}) {
  if (!bar) return;
  cancelProgressStartRafs();
  clearRaf();

  if (syncLayout) updateProgressBarPosition();

  bar.classList.remove('is-paused');
  bar.classList.add('is-animating');
  bar.style.animationPlayState = 'paused';
  bar.style.transition = 'none';
  bar.style.transform = `scaleX(${startScale})`;

  __pbStartRafA = requestAnimationFrame(() => {
    __pbStartRafA = 0;
    __pbStartRafB = requestAnimationFrame(() => {
      __pbStartRafB = 0;
      if (!bar.isConnected) return;
      bar.style.transition = `transform ${Math.max(0, duration | 0)}ms linear`;
      bar.style.transform = `scaleX(${endScale})`;
    });
  });
}

function getComputedScaleX(el) {
  if (!el) return 0;
  const st = getComputedStyle(el);
  const tr = st.transform || st.webkitTransform || "";
  if (!tr || tr === "none") return 0;
  if (tr.startsWith("matrix3d(")) {
    const vals = tr.slice(9, -1).split(",").map(s => parseFloat(s.trim()));
    const m11 = vals[0];
    return Number.isFinite(m11) ? m11 : 0;
  }
  if (tr.startsWith("matrix(")) {
    const vals = tr.slice(7, -1).split(",").map(s => parseFloat(s.trim()));
    const a = vals[0];
    return Number.isFinite(a) ? a : 0;
  }
  const m = tr.match(/scaleX\(([-+]?[\d.]+)\)/i);
  if (m) {
    const v = parseFloat(m[1]);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

function targetScaleFromCfg() {
  return Math.max(0, Math.min(1, (getConfig().progressBarWidth || 100) / 100));
}

export function ensureProgressBarExists() {
  if (!getConfig().showProgressBar || useSecondsMode()) {
    cancelProgressStartRafs();
    clearRaf();
    if (modalState.progressBarEl && document.body.contains(modalState.progressBarEl)) {
      modalState.progressBarEl.remove();
      modalState.progressBarEl = null;
    }
    return null;
  }

  if (modalState.progressBarEl && !document.body.contains(modalState.progressBarEl)) {
    modalState.progressBarEl = null;
  }

  if (!modalState.progressBarEl) {
    modalState.progressBarEl = document.querySelector(".monwui-slide-progress-bar");
    if (!modalState.progressBarEl) {
      const sc = getSlidesContainer();
      modalState.progressBarEl = document.createElement("div");
      modalState.progressBarEl.className = "monwui-slide-progress-bar";

      Object.assign(modalState.progressBarEl.style, {
        position: 'absolute',
        transformOrigin: '0 50%',
        willChange: isPeakProgressMode(sc) ? 'auto' : 'transform',
        animationPlayState: 'paused',
        width: '100%',
        transition: 'left 0.3s ease, width 0.3s ease'
      });

      if (sc) sc.appendChild(modalState.progressBarEl);
    }
    __pbInited = true;
  } else {
    const sc = getSlidesContainer();
    if (sc && modalState.progressBarEl.parentElement !== sc) {
      sc.appendChild(modalState.progressBarEl);
    }
  }

  modalState.progressBarEl.style.willChange = isPeakProgressMode() ? 'auto' : 'transform';

  updateProgressBarPosition();
  return modalState.progressBarEl;
}

function getUntransformedSlidePosition(slide, slidesContainer) {
  if (!slide || !slidesContainer) return { left: 0, width: 0 };

  const isPeak = isPeakProgressMode(slidesContainer);

  if (!isPeak) {
    const slideRect = slide.getBoundingClientRect();
    const containerRect = slidesContainer.getBoundingClientRect();
    return {
      left: slideRect.left - containerRect.left,
      width: slideRect.width
    };
  }

  const containerWidth = slidesContainer.clientWidth || slidesContainer.getBoundingClientRect().width || 0;
  const activeWidth = slide.offsetWidth || slide.getBoundingClientRect().width || 0;
  const activeLeft = Math.max(0, (containerWidth - activeWidth) / 2);

  return {
    left: activeLeft,
    width: activeWidth
  };
}

export function updateProgressBarPosition() {
  if (!modalState.progressBarEl || useSecondsMode()) return;

  const slidesContainer = getSlidesContainer();
  if (!slidesContainer) return;
  const activeSlide = slidesContainer.querySelector('.monwui-slide.active');
  if (!activeSlide) return;

  const position = getUntransformedSlidePosition(activeSlide, slidesContainer);
  const leftPx = `${Math.round(position.left)}px`;
  const widthPx = `${Math.round(position.width)}px`;
  if (modalState.progressBarEl.__lastLeft === leftPx && modalState.progressBarEl.__lastWidth === widthPx) {
    return;
  }
  modalState.progressBarEl.__lastLeft = leftPx;
  modalState.progressBarEl.__lastWidth = widthPx;

  Object.assign(modalState.progressBarEl.style, {
    left: leftPx,
    width: widthPx
  });
}

function ensureSecondsExists() {
  if (!useSecondsMode()) {
    if (secondsEl && document.body.contains(secondsEl)) {
      secondsEl.remove();
      secondsEl = null;
    }
    clearSecondsTimer();
    return null;
  }
  if (secondsEl && !document.body.contains(secondsEl)) secondsEl = null;
  if (!secondsEl) {
    secondsEl = document.querySelector(".monwui-slide-progress-seconds");
    if (!secondsEl) {
      secondsEl = document.createElement("div");
      secondsEl.className = "monwui-slide-progress-seconds";
      applyContainerStyles(secondsEl, 'progressSeconds');
      mountSecondsToActiveSlide(secondsEl);
    }
  } else {
    mountSecondsToActiveSlide(secondsEl);
  }
  return secondsEl;
}

function clearSecondsTimer() {
  if (secondsTimer) {
    clearInterval(secondsTimer);
    secondsTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!getConfig().showProgressBar) return;
  if (document.hidden) {
    pauseProgressBar();
  } else {
    resumeProgressBar();
  }
}, { passive: true });

export function resetProgressBar() {
  const dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);

  if (useSecondsMode()) {
    const el = ensureSecondsExists();
    if (!el) return;
    clearSecondsTimer();
    secondsPausedMs = 0;
    const t0tmp = now();
    secondsEndAt = t0tmp + dur;
    el.removeAttribute('data-done');
    el.textContent = Math.ceil(dur / 1000).toString();
    setSlideStartTime(t0tmp);
    setRemainingTime(dur);
    requestAnimationFrame(() => startProgressBarWithDuration(dur));
    return;
  }

  const bar = ensureProgressBarExists();
  if (!bar) return;

  __paused = false;
  cancelProgressStartRafs();
  clearRaf();
  bar.classList.remove('is-paused', 'is-animating');
  bar.style.animationPlayState = 'paused';
  bar.style.transition = "none";
  bar.style.transform = "scaleX(0)";

  updateProgressBarPosition();

  setSlideStartTime(now());
  setRemainingTime(dur);
}

export function startProgressBarWithDuration(duration) {
  const dur = Math.max(0, duration ?? (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION));

  if (useSecondsMode()) {
    const el = ensureSecondsExists();
    if (!el) return;
    clearSecondsTimer();
    const t0 = now();
    secondsRunId = (secondsRunId + 1) || 1;
    const runId = secondsRunId;
    secondsEndAt = t0 + dur + 30;
    secondsPausedMs = 0;
    el.removeAttribute('data-done');
    el.textContent = Math.max(0, Math.ceil(dur / 1000)).toString();
    secondsTimer = setInterval(() => {
      if (runId !== secondsRunId) { clearSecondsTimer(); return; }

      const t = secondsEndAt - now();
      const left = Math.ceil(Math.max(0, t) / 1000);
      if (t <= 0) {
        clearSecondsTimer();
        el.setAttribute('data-done', '1');
        el.textContent = "0";
      } else {
        el.textContent = left.toString();
      }
    }, 100);
    setSlideStartTime(t0);
    setRemainingTime(dur);
    return;
  }

  const bar = ensureProgressBarExists();
  if (!bar) return;

  __paused = false;
  cancelProgressStartRafs();
  clearRaf();
  bar.classList.remove('is-paused');
  bar.classList.add('is-animating');

  const targetScale = 1;
  const t0 = now();
  setSlideStartTime(t0);
  setRemainingTime(dur);
  pausedProgressPct = 0;
  queueProgressAnimation(bar, {
    duration: dur,
    startScale: 0,
    endScale: targetScale,
    syncLayout: true
  });
}

export function pauseProgressBar() {
  const dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);
  if (__paused) return;

  if (useSecondsMode()) {
    const el = ensureSecondsExists();
    if (!el) return;
    const t0 = getSlideStartTime?.() || now();
    const elapsed = Math.max(0, Math.min(dur, now() - t0));
    const remaining = Math.max(0, dur - elapsed);
    secondsPausedMs = secondsEndAt
      ? Math.max(0, secondsEndAt - now())
      : remaining;
    clearSecondsTimer();
    setRemainingTime(remaining);
    __paused = true;
    return;
  }

  const bar = ensureProgressBarExists();
  if (!bar) return;

  cancelProgressStartRafs();
  const t0 = getSlideStartTime?.() || now();
  const elapsed = Math.max(0, Math.min(dur, now() - t0));
  const doneFrac = dur > 0 ? (elapsed / dur) : 0;
  pausedProgressPct = Math.max(0, Math.min(100, doneFrac * 100));
  const targetScale = targetScaleFromCfg();
  const computedScale = getComputedScaleX(bar);
  const currentScale = Number.isFinite(computedScale) && computedScale > 0
    ? computedScale
    : (targetScale * (pausedProgressPct / 100));
  bar.style.animationPlayState = 'paused';
  bar.style.transition = 'none';
  bar.style.transform = `scaleX(${currentScale})`;
  bar.classList.remove('is-animating');
  bar.classList.add('is-paused');

  setRemainingTime(dur - elapsed);
  __paused = true;
}

export function resumeProgressBar() {
  const dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);
  if (!__paused) return;

  if (useSecondsMode()) {
    const el = ensureSecondsExists();
    if (!el) return;
    let remaining = secondsPausedMs > 0
      ? secondsPausedMs
      : (typeof getRemainingTime === 'function' ? (getRemainingTime() || 0) : 0);
    if (!Number.isFinite(remaining) || remaining <= 0) remaining = dur;
    const t0 = now();
    secondsEndAt = t0 + remaining + 30;
    clearSecondsTimer();
    el.removeAttribute('data-done');
    secondsTimer = setInterval(() => {
      const t = secondsEndAt - now();
      const left = Math.ceil(Math.max(0, t) / 1000);
      if (t <= 0) {
        clearSecondsTimer();
        el.setAttribute('data-done', '1');
        el.textContent = "0";
      } else {
        el.textContent = left.toString();
      }
    }, 100);
    setSlideStartTime(t0 - (dur - remaining));
    setRemainingTime(remaining);
    __paused = false;
    return;
  }

  const bar = ensureProgressBarExists();
  if (!bar) return;

  cancelProgressStartRafs();
  clearRaf();

  const prevRemaining = getRemainingTime?.();
  const total = dur;

  let remainingTime = typeof prevRemaining === 'number' && isFinite(prevRemaining)
    ? Math.max(0, Math.min(total, prevRemaining))
    : Math.max(0, (1 - (pausedProgressPct / 100)) * total);

  const targetScale = targetScaleFromCfg();
  const computedScale = getComputedScaleX(bar);
  const startScale =
    Number.isFinite(computedScale) && computedScale >= 0
      ? Math.max(0, Math.min(targetScale, computedScale))
      : Math.max(0, Math.min(1, (1 - (remainingTime / total)) * targetScale));

  const t0 = now();
  setSlideStartTime(t0 - (total - remainingTime));
  queueProgressAnimation(bar, {
    duration: remainingTime,
    startScale,
    endScale: targetScale,
    syncLayout: isPeakProgressMode()
  });

  __paused = false;
}
