import {
  resetProgressBar,
  startProgressBarWithDuration,
  pauseProgressBar,
  resumeProgressBar,
} from "./progressBar.js";
import { changeSlide } from "./navigation.js";
import { getCurrentIndex } from "./sliderState.js";
import { getConfig } from "./config.js";

export const SLIDE_DURATION = getConfig().sliderDuration;

let autoSlideTimeout = null;
let slideStartTime = 0;
let remainingTime = 0;
let progressStartRafA = 0;
let progressStartRafB = 0;

function getActiveSlidesContainer() {
  return document.querySelector(
    "#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container"
  );
}

function shouldPauseForActiveHover() {
  try {
    return !!getActiveSlidesContainer()?.matches?.(":hover");
  } catch {
    return false;
  }
}

function isCustomSplashBlocking() {
  try {
    const root = document.documentElement;
    return !!root?.hasAttribute("data-jms-custom-splash")
      && !root?.hasAttribute("data-jms-custom-splash-hidden");
  } catch {
    return false;
  }
}

function cancelPendingProgressStart() {
  if (progressStartRafA) {
    cancelAnimationFrame(progressStartRafA);
    progressStartRafA = 0;
  }
  if (progressStartRafB) {
    cancelAnimationFrame(progressStartRafB);
    progressStartRafB = 0;
  }
}

function scheduleProgressStart(duration) {
  cancelPendingProgressStart();
  progressStartRafA = requestAnimationFrame(() => {
    progressStartRafA = 0;
    progressStartRafB = requestAnimationFrame(() => {
      progressStartRafB = 0;
      startProgressBarWithDuration(duration);
    });
  });
}

export function clearAllTimers() {
  cancelPendingProgressStart();
  try {
    if (autoSlideTimeout) {
      clearTimeout(autoSlideTimeout);
      autoSlideTimeout = null;
    }
    if (window.intervalChangeSlide) {
      clearInterval(window.intervalChangeSlide);
      window.intervalChangeSlide = null;
    }
    if (window.sliderTimeout) {
      clearTimeout(window.sliderTimeout);
      window.sliderTimeout = null;
    }
    if (window.autoSlideTimeout) {
      clearTimeout(window.autoSlideTimeout);
      window.autoSlideTimeout = null;
    }
  } catch {}
}


if (!window.__sliderVisibilityBound) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pauseSlideTimer(); pauseProgressBar();
    } else {
      resumeSlideTimer(); resumeProgressBar();
    }
  });
  window.__sliderVisibilityBound = true;
}

export function startSlideTimer() {
  clearAllTimers();
  remainingTime = SLIDE_DURATION;
  resetProgressBar();

  if (isCustomSplashBlocking()) {
    window.mySlider = window.mySlider || {};
    window.mySlider.autoSlideTimeout = null;
    return;
  }

  slideStartTime = Date.now();
  scheduleProgressStart(remainingTime);
  autoSlideTimeout = setTimeout(handleAutoAdvance, remainingTime);
  window.mySlider = window.mySlider || {};
  window.mySlider.autoSlideTimeout = autoSlideTimeout;

  if (shouldPauseForActiveHover()) {
    pauseSlideTimer();
    pauseProgressBar();
  }
}

function handleAutoAdvance() {
  const ev = new CustomEvent("jms:per-slide-complete", { cancelable: true });
  document.dispatchEvent(ev);
  if (ev.defaultPrevented) {
    return;
  }
  changeSlide(1);
}

export function stopSlideTimer() {
  cancelPendingProgressStart();
  clearAllTimers();
}

export function pauseSlideTimer() {
  cancelPendingProgressStart();
  if (autoSlideTimeout) {
    clearTimeout(autoSlideTimeout);
    autoSlideTimeout = null;

    const elapsed = Date.now() - slideStartTime;
    remainingTime = Math.max(remainingTime - elapsed, 0);

    window.mySlider = window.mySlider || {};
    window.mySlider.autoSlideTimeout = null;
  }
}

export function resumeSlideTimer() {
  if (isCustomSplashBlocking()) return;
  if (shouldPauseForActiveHover()) return;
  if (!autoSlideTimeout && remainingTime > 0) {
    slideStartTime = Date.now();
    resumeProgressBar();

    autoSlideTimeout = setTimeout(() => {
      handleAutoAdvance();
    }, remainingTime);

    window.mySlider = window.mySlider || {};
    window.mySlider.autoSlideTimeout = autoSlideTimeout;
  }
}
