import {
  startSlideTimer,
  stopSlideTimer,
  pauseSlideTimer,
  resumeSlideTimer,
  SLIDE_DURATION,
} from "./timer.js";
import {
  ensureProgressBarExists,
  resetProgressBar,
  startProgressBarWithDuration,
  pauseProgressBar,
  resumeProgressBar,
} from "./progressBar.js";

export function setupVisibilityHandler() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pauseSlideTimer();
      pauseProgressBar();
    } else {
      resumeSlideTimer();
      resumeProgressBar();
    }
  });
}

export function attachMouseEvents() {
  const activePage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!activePage) return;

  const slidesContainer = activePage.querySelector("#monwui-slides-container");
  if (!slidesContainer) return;
  if (slidesContainer.__jmsHoverPauseBound) {
    if (slidesContainer.matches(":hover")) {
      pauseSlideTimer();
      pauseProgressBar();
    }
    return;
  }

  const onMouseEnter = () => {
    pauseSlideTimer();
    pauseProgressBar();
  };
  const onMouseLeave = () => {
    resumeSlideTimer();
    resumeProgressBar();
  };

  slidesContainer.addEventListener("mouseenter", onMouseEnter, { passive: true });
  slidesContainer.addEventListener("mouseleave", onMouseLeave, { passive: true });
  slidesContainer.__jmsHoverPauseBound = true;
  slidesContainer.__jmsHoverPauseEnter = onMouseEnter;
  slidesContainer.__jmsHoverPauseLeave = onMouseLeave;

  if (slidesContainer.matches(":hover")) {
    onMouseEnter();
  }
}
