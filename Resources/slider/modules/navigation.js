import { stopSlideTimer, startSlideTimer, SLIDE_DURATION, clearAllTimers } from "./timer.js";
import { resetProgressBar, updateProgressBarPosition, useSecondsMode } from "./progressBar.js";
import { getConfig } from './config.js';
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { getCurrentIndex, setCurrentIndex, setRemainingTime } from "./sliderState.js";
import { applyContainerStyles } from "./positionUtils.js";
import { playNow, fetchItemDetails, getCachedUserTopGenres, getGenresForDot, goToDetailsPage } from "./api.js";
import { applySlideAnimation, applyDotPosterAnimation, teardownAnimations, forceReflow, nextAnimToken, hardCleanupSlide } from "./animations.js";
import { getVideoQualityText } from "./containerUtils.js";
import { previewPreloadCache } from "./hoverTrailerModal.js";
import { attachMiniPosterHover, openMiniPopoverFor } from "./studioHubsUtils.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';
import { createVideoModal, destroyVideoModal, animatedShow, closeVideoModal, modalIsVisible, preloadVideoPreview, updateModalContent, positionModalRelativeToItem, applyVolumePreference, ensureOverlaysClosed, getBackdropFromItem, calculateMatchPercentage, openPreviewModalForItem, setModalAnimation, getPlayButtonText, PREVIEW_MAX_ENTRIES, startModalHideTimer, getClosingRemaining, bindModalEvents, hardStopPlayback, resetModalInfo, resetModalButtons, scheduleOpenForItem } from './hoverTrailerModal.js';
import { withServer } from "./jfUrl.js";

const IS_TOUCH = (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
const config = getConfig();
const currentLang = config.defaultLanguage || getDefaultLanguage();
if (!config.languageLabels) {
  config.languageLabels = getLanguageLabels(currentLang) || {};
}

if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
  closeVideoModal();
}

function ensureFlickerFixCSS() {
  if (document.getElementById('android-flicker-fix')) return;
  const st = document.createElement('style');
  st.id = 'android-flicker-fix';
  st.textContent = `
    #slides-container.peak-mode .slide {
      will-change: transform, opacity;
      backface-visibility: hidden;
    }
    .slide.is-hidden {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .slide.is-visible {
      visibility: visible !important;
      pointer-events: auto !important;
    }
    #slides-container.peak-ready .slide.off-left,
    #slides-container.peak-ready .slide.off-right {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(st);
}

function showSlide(el) {
  if (!el) return;
  el.classList.add('is-visible');
  el.classList.remove('is-hidden');
  if (el.style.display) el.style.removeProperty('display');
}

function hideSlide(el, { soft = true } = {}) {
  if (!el) return;
  el.classList.remove('is-visible');
  el.classList.add('is-hidden');
  if (!soft) {
    setTimeout(() => {
      if (!el.classList.contains('active')) el.style.display = 'none';
    }, 50);
  }
}

function scrollContainerToSlide(index, { smooth = true } = {}) {
  const container = document.querySelector("#slides-container");
  if (!container) return;
  const slides = container.querySelectorAll(".slide");
  const target = slides?.[index];
  if (!target) return;

  const left = target.offsetLeft - (container.clientWidth - target.clientWidth) / 2;
  container.scrollTo({
    left: Math.max(0, left),
    behavior: smooth ? "smooth" : "auto",
  });
}

function L(key, fallback = '') {
  try { return (getConfig()?.languageLabels?.[key]) ?? fallback; }
  catch { return fallback; }
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function hardResetProgressBarEl() {
  const pb = document.querySelector(".slide-progress-bar");
  if (!pb) return;
  pb.style.transition = "none";
  pb.style.animation  = "none";
  pb.style.width      = "0%";
  void pb.offsetWidth;
  pb.style.transition = "";
  pb.style.animation  = "";
}

function microFadeSwap(
  oldSlide,
  newSlide,
  durMs = Math.min(300, Math.max(120, (getConfig()?.slideAnimationDuration ?? 280)))
) {
  if (!newSlide) return;

  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const D = prefersReduced ? 0 : durMs;

  if (newSlide.dataset.fx === 'running') return;
  newSlide.dataset.fx = 'running';
  if (oldSlide) oldSlide.dataset.fxPrev = 'running';

  const killTransitions = (el) => {
    el.style.transition = 'none';
    el.style.willChange = 'auto';
  };
  const flush = () => { void document.body.offsetWidth; };

  showSlide(newSlide);
  newSlide.style.opacity = '0';
  newSlide.style.zIndex = '2';
  newSlide.style.willChange = 'opacity';
  killTransitions(newSlide);

  if (oldSlide && oldSlide !== newSlide) {
    showSlide(oldSlide);
    oldSlide.style.opacity = '1';
    oldSlide.style.zIndex = '1';
    oldSlide.style.pointerEvents = 'none';
    oldSlide.style.willChange = 'opacity';
    killTransitions(oldSlide);
  }

  flush(); flush();

  const cleanup = () => {
    newSlide.style.transition = '';
    newSlide.style.willChange = '';
    newSlide.style.zIndex = '';
    delete newSlide.dataset.fx;

    if (oldSlide && oldSlide !== newSlide) {
      hideSlide(oldSlide, { soft: true });
      oldSlide.style.transition = '';
      oldSlide.style.transform = '';
      oldSlide.style.willChange = '';
      oldSlide.style.pointerEvents = '';
      oldSlide.style.zIndex = '';
      oldSlide.style.opacity = '0';
      setTimeout(() => {
        if (!oldSlide.classList.contains('active')) oldSlide.style.display = 'none';
      }, 60);
      delete oldSlide.dataset.fxPrev;
    }
  };

  if (D === 0) {
    newSlide.style.opacity = '1';
    if (oldSlide && oldSlide !== newSlide) oldSlide.style.opacity = '0';
    cleanup();
    return;
  }

  newSlide.style.transition = `opacity ${D}ms ease`;
  if (oldSlide && oldSlide !== newSlide) {
    oldSlide.style.transition = `opacity ${D}ms ease`;
  }

  requestAnimationFrame(() => {
    newSlide.style.opacity = '1';
    if (oldSlide && oldSlide !== newSlide) {
      oldSlide.style.opacity = '0';
    }
  });

  let done = false;
  const onEnd = () => {
    if (done) return;
    done = true;
    newSlide.removeEventListener('transitionend', onEnd);
    cleanup();
  };

  newSlide.addEventListener('transitionend', onEnd, { once: true });
  setTimeout(onEnd, D + 100);
}


function getBackdropFromDot(dot) {
  const img = dot?.querySelector?.('.dot-poster-image');
  if (img?.src) return img.src;
  const slideEl = document.querySelector(`.slide[data-item-id="${dot?.dataset?.itemId}"]`);
  if (slideEl) {
    return slideEl.dataset.background || slideEl.dataset.backdrop || slideEl.dataset.primaryimage || null;
  }
  return null;
}

function enterPeakScrollMode() {
  const sc = document.querySelector("#slides-container");
  if (!sc) return;
  sc.classList.add("peak-scroll");
  sc.querySelectorAll(".slide").forEach(slide => {
    slide.removeAttribute("data-side");
    slide.removeAttribute("data-prime-pos");
  });
}

export function changeSlide(direction) {
  const slides = document.querySelectorAll(".slide");
  if (!slides.length) return;

  clearAllTimers();
  stopSlideTimer();
  const currentIndex = getCurrentIndex();
  const newIndex = (currentIndex + direction + slides.length) % slides.length;
  setCurrentIndex(newIndex);
  const sc = document.querySelector("#slides-container");
  if (sc && sc.classList.contains("peak-scroll")) {
    scrollContainerToSlide(newIndex, { smooth: true });
  }
  displaySlide(newIndex);
  hardResetProgressBarEl();
  resetProgressBar();
  setRemainingTime(SLIDE_DURATION);
  startSlideTimer();
}

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
      if (wasActive !== isActive) applyDotPosterAnimation(dot, isActive);
    }
  });

  if (config.dotPosterMode) centerActiveDot({ smooth: true, force: true });
}

export function createDotNavigation() {
  const config = getConfig();
  if (!config.showDotNavigation) {
    const existingDotContainer = document.querySelector(".dot-navigation-container");
    if (existingDotContainer) {
      teardownAnimations();
      existingDotContainer.remove();
    }
    return;
  }

  const dotType = config.dotBackgroundImageType;
  const indexPage = document.querySelector("#indexPage:not(.hide)");
  if (!indexPage) return;

  const slidesContainer = indexPage.querySelector("#slides-container");
  if (!slidesContainer) {
    console.warn("Slayt konteynırı bulunamadı, nokta navigasyonu oluşturulamıyor");
    return;
  }

  const slides = slidesContainer.querySelectorAll(".slide");
  if (!slides || slides.length === 0) return;

  let dotContainer = slidesContainer.querySelector(".dot-navigation-container");
  if (!dotContainer) {
    dotContainer = document.createElement("div");
    dotContainer.className = "dot-navigation-container";
    applyContainerStyles(dotContainer, 'existingDot');
    slidesContainer.appendChild(dotContainer);
  }

  const currentIndex = getCurrentIndex();

  if (config.dotPosterMode) {
    dotContainer.innerHTML = "";
    dotContainer.classList.add("dot-poster-mode");

    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "dot-scroll-wrapper";

    const slidesArray = Array.from(slides);

    const dotElements = slidesArray.map((slide, index) => {
    const itemId = slide.dataset.itemId;
    if (!itemId) {
        console.warn(`Dot oluşturulamadı: slide ${index} için itemId eksik`);
        return null;
    }

    const dot = document.createElement("div");
    dot.className = "dot poster-dot";
    dot.dataset.index = index;
    dot.dataset.itemId = itemId;

    const imageUrl = dotType === "useSlideBackground"
        ? slide.dataset.background
        : slide.dataset[dotType];

    if (imageUrl) {
        const image = document.createElement("img");
        image.src = withServer(imageUrl);
        image.className = "dot-poster-image";
        image.style.opacity = config.dotBackgroundOpacity || 0.3;
        image.style.filter = `blur(${config.dotBackgroundBlur ?? 10}px)`;
        dot.appendChild(image);
    }

    try {
        const mediaStreams = slide.dataset.mediaStreams ? JSON.parse(slide.dataset.mediaStreams) : [];
        const videoStream = mediaStreams.find(s => s.Type === "Video");
        if (videoStream) {
            const qualityText = getVideoQualityText(videoStream);
            if (qualityText) {
                const qualityBadge = document.createElement("div");
                qualityBadge.className = "dot-quality-badge";
                qualityBadge.innerHTML = `${qualityText}`;
                dot.appendChild(qualityBadge);
                const style = document.createElement("style");
            }
        }
    } catch (e) {
        console.warn("Video kalite bilgisi yüklenirken hata:", e);
    }

        const positionTicks = Number(slide.dataset.playbackpositionticks);
        const runtimeTicks = Number(slide.dataset.runtimeticks);

        if (config.showPlaybackProgress && !isNaN(positionTicks) && !isNaN(runtimeTicks) && positionTicks > 0 && positionTicks < runtimeTicks) {
            const progressContainer = document.createElement("div");
            progressContainer.className = "dot-progress-container";

            const barWrapper = document.createElement("div");
            barWrapper.className = "dot-duration-bar-wrapper";

            const bar = document.createElement("div");
            bar.className = "dot-duration-bar";
            const percentage = Math.min((positionTicks / runtimeTicks) * 100, 100);
            bar.style.width = `${percentage.toFixed(1)}%`;

            const remainingMinutes = Math.round((runtimeTicks - positionTicks) / 600000000);
            const text = document.createElement("span");
            text.className = "dot-duration-remaining";
            text.innerHTML = `<i class="fa-regular fa-hourglass-half"></i> ${remainingMinutes} ${config.languageLabels.dakika} ${config.languageLabels.kaldi}`;

            barWrapper.appendChild(bar);
            progressContainer.appendChild(barWrapper);
            progressContainer.appendChild(text);
            dot.appendChild(progressContainer);
        }

        const playButtonContainer = document.createElement("div");
        playButtonContainer.className = "dot-play-container";

        const playButton = document.createElement("button");
        playButton.className = "dot-play-button";
        playButton.textContent = config.languageLabels.izle;

        playButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const itemId = slide.dataset.itemId;
        if (!itemId) {
        alert("Oynatma başarısız: itemId bulunamadı");
        return;
      }
      closeVideoModal();
      try {
        await playNow(itemId);
      } catch (error) {
        console.error("Oynatma hatası:", error);
        alert("Oynatma başarısız: " + error.message);
      } finally {
        closeVideoModal();
      }
    });

        const matchBadge = document.createElement("div");
        matchBadge.className = "dot-match-div";
        matchBadge.textContent = `...% ${config.languageLabels.uygun}`;

        playButtonContainer.appendChild(playButton);
        playButtonContainer.appendChild(matchBadge);
        dot.appendChild(playButtonContainer);

        dot.classList.toggle("active", index === currentIndex);

        if (config.dotPosterMode && config.enableDotPosterAnimations) {
            applyDotPosterAnimation(dot, index === currentIndex);
        }
        dot.addEventListener("click", () => {
            if (index !== getCurrentIndex()) {
                changeSlide(index - getCurrentIndex());
            }
        });

      dot.addEventListener("mouseenter", () => {
      modalState.isMouseInItem = true;
      clearTimeout(modalState.modalHideTimeout);
      modalState.modalHoverState = true;
      if (dot.abortController) dot.abortController.abort();
      dot.abortController = new AbortController();
      const { signal } = dot.abortController;
      const itemId = dot.dataset.itemId;
      if (!itemId) return;
      scheduleOpenForItem(dot, itemId, signal, async () => {
      if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
      try {
      await openModalForDot(dot, itemId, signal);

      const item = await fetchItemDetails(itemId, { signal });
      const isFavorite = item.UserData?.IsFavorite || false;
      const isPlayed   = item.UserData?.Played || false;
      const positionTicks = Number(item.UserData?.PlaybackPositionTicks || 0);
      const runtimeTicks  = Number(item.RunTimeTicks || 0);
      const hasPartialPlayback = positionTicks > 0 && positionTicks < runtimeTicks;

      const playButton = dot.querySelector('.dot-play-button');
      if (playButton) {
        playButton.textContent = getPlayButtonText({
          isPlayed,
          hasPartialPlayback,
          labels: config.languageLabels
        });
      }

      const matchPercentage = await calculateMatchPercentage(item.UserData, item);
      const matchBadge = dot.querySelector('.dot-match-div');
      if (matchBadge) {
        matchBadge.textContent = `${matchPercentage}% ${config.languageLabels.uygun}`;
      }

      dot.dataset.favorite = isFavorite.toString();
      dot.dataset.played   = isPlayed.toString();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Poster dot hover hatası:', error);
        if (modalState.videoModal) modalState.videoModal.style.display = 'none';
      }
    }
  });
});
      dot.addEventListener("mouseleave", () => {
      modalState.isMouseInItem = false;

      if (dot.abortController) {
      dot.abortController.abort();
      dot.abortController = null;
    }

      if (modalState._hoverOpenTimer) {
      clearTimeout(modalState._hoverOpenTimer);
      modalState._hoverOpenTimer = null;
    }
      startModalHideTimer();
});

      return dot;
      }).filter(Boolean);

      ensureDotQualityBadgeCSS();

      setTimeout(() => {
      const createdDots = Array.from(scrollWrapper.querySelectorAll('.poster-dot'));
      createdDots.forEach(dot => {
      const itemId = dot.dataset.itemId;
      if (itemId) preloadVideoPreview(itemId);
    });

      if (previewPreloadCache.size > PREVIEW_MAX_ENTRIES) {
      clearVideoPreloadCache({ mode: 'overLimit' });
    }
  }, 0);

      dotElements.forEach(dot => scrollWrapper.appendChild(dot));
      setTimeout(async () => {
      const dotItemIds = dotElements.map(dot => dot.dataset.itemId).filter(Boolean);
      await preloadGenreData(dotItemIds);
      for (const dot of dotElements) {
        try {
            const itemId = dot.dataset.itemId;
            const item = await fetchItemDetails(itemId);
            const isFavorite = item.UserData?.IsFavorite || false;
            const isPlayed = item.UserData?.Played || false;
            const positionTicks = Number(item.UserData?.PlaybackPositionTicks || 0);
            const runtimeTicks = Number(item.RunTimeTicks || 0);
            const hasPartialPlayback = positionTicks > 0 && positionTicks < runtimeTicks;
            const playButton = dot.querySelector('.dot-play-button');
            if (playButton) {
            playButton.textContent = getPlayButtonText({
            isPlayed,
            hasPartialPlayback,
            labels: config.languageLabels
          });
        }
            const matchPercentage = await calculateMatchPercentage(item.UserData, item);
            const matchBadge = dot.querySelector('.dot-match-div');
            if (matchBadge) {
                matchBadge.textContent = `${matchPercentage}% ${config.languageLabels.uygun}`;
            }
            dot.dataset.favorite = isFavorite.toString();
            dot.dataset.played = isPlayed.toString();

        } catch (error) {
            console.error(`Dot verileri yüklenirken hata (${dot.dataset.itemId}):`, error);
        }
    }
}, 0);

    const leftArrow = document.createElement("button");
    leftArrow.className = "dot-arrow dot-arrow-left";
    leftArrow.innerHTML = "&#10094;";
    leftArrow.addEventListener("click", () => {
        scrollWrapper.scrollBy({ left: -scrollWrapper.clientWidth, behavior: "smooth" });
    });

    const rightArrow = document.createElement("button");
    rightArrow.className = "dot-arrow dot-arrow-right";
    rightArrow.innerHTML = "&#10095;";
    rightArrow.addEventListener("click", () => {
        scrollWrapper.scrollBy({ left: scrollWrapper.clientWidth, behavior: "smooth" });
    });

    dotContainer.append(leftArrow, scrollWrapper, rightArrow);
    if (scrollWrapper.__dotRO) scrollWrapper.__dotRO.disconnect();
    scrollWrapper.__dotRO = new ResizeObserver(() => { centerActiveDot(); });
    scrollWrapper.__dotRO.observe(scrollWrapper);

    setTimeout(centerActiveDot, 300);
    return;
  }

  dotContainer.innerHTML = "";
  const currentDotIndex = getCurrentIndex();

  slides.forEach((slide, index) => {
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.index = index;

    const imageUrl = dotType === "useSlideBackground"
      ? slide.dataset.background
      : slide.dataset[dotType];

    if (imageUrl) {
      const imageOverlay = document.createElement("div");
      imageOverlay.className = "dot-image-overlay";
      imageOverlay.style.backgroundImage = `url(${imageUrl})`;
      imageOverlay.style.backgroundSize = "cover";
      imageOverlay.style.backgroundPosition = "center";
      imageOverlay.style.opacity = config.dotBackgroundOpacity || 0.3;
      imageOverlay.style.filter = `blur(${config.dotBackgroundBlur ?? 10}px)`;
      dot.appendChild(imageOverlay);
    }

    dot.classList.toggle("active", index === currentDotIndex);
    dot.addEventListener("click", () => {
      if (index !== getCurrentIndex()) {
        changeSlide(index - getCurrentIndex());
      }
    });

    dotContainer.appendChild(dot);
  });
}

async function openModalForDot(dot, itemId, signal) {
  const cfg = getConfig();
  if (!cfg || cfg.previewModal === false) return
  if (modalState.videoModal) {
    hardStopPlayback();
    resetModalInfo(modalState.videoModal);
    resetModalButtons();
    if (modalState._modalContext !== 'dot') {
      destroyVideoModal();
    } else {
      modalState.videoModal.style.display = 'none';
    }
  }

  const item = await fetchItemDetails(itemId, { signal });
  if (signal?.aborted) return;
  if (!modalState.videoModal || !document.body.contains(modalState.videoModal)) {
    const modalElements = createVideoModal({ showButtons: true, context: 'dot' });
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

  const domUrl = getBackdropFromDot(dot);
  const itemUrl = getBackdropFromItem(item);
  modalState.videoModal.setBackdrop(domUrl || itemUrl || null);

  modalState.videoModal.dataset.itemId = itemId;
  positionModalRelativeToDot(modalState.videoModal, dot);
  if (modalState.videoModal.style.display !== 'block') {
    animatedShow(modalState.videoModal);
  } else {
    modalState.videoModal.style.display = 'block';
  }
  applyVolumePreference();

  const videoUrl = await preloadVideoPreview(itemId);
  if (signal?.aborted) return;
  await updateModalContent(item, videoUrl);
}

export function initSwipeEvents() {
  const indexPage = document.querySelector("#indexPage:not(.hide)");
  if (!indexPage) return;

  const slidesContainer = indexPage.querySelector("#slides-container");
  if (!slidesContainer) return;
  if (slidesContainer.__swipeBound) return;
  slidesContainer.__swipeBound = true;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let isHorizontalSwipe = false;

  const handleTouchStart = (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isHorizontalSwipe = false;
    e.stopImmediatePropagation?.();
  };

  const handleTouchMove = (e) => {
    const moveX = e.changedTouches[0].screenX - touchStartX;
    const moveY = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(moveX) > Math.abs(moveY) && Math.abs(moveX) > 10) {
      isHorizontalSwipe = true;
      e.preventDefault();
    } else {
      isHorizontalSwipe = false;
    }
    e.stopImmediatePropagation?.();
  };

  const handleTouchEnd = (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      changeSlide(deltaX > 0 ? -1 : 1);
    }

    isHorizontalSwipe = false;
    e.stopImmediatePropagation?.();
  };

  slidesContainer.addEventListener("touchstart", handleTouchStart, { passive: false });
  slidesContainer.addEventListener("touchmove", handleTouchMove, { passive: false });
  slidesContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
}

export function centerActiveDot({ smooth = true, force = false } = {}) {
  const scrollWrapper = document.querySelector(".dot-scroll-wrapper");
  const activeDot = scrollWrapper?.querySelector(".poster-dot.active");
  if (!scrollWrapper || !activeDot) return;

  const wrapperRect = scrollWrapper.getBoundingClientRect();
  const dotRect = activeDot.getBoundingClientRect();

  const isFullyVisible =
    dotRect.left >= wrapperRect.left &&
    dotRect.right <= wrapperRect.right;

  const dotCenter = dotRect.left + dotRect.width / 2;
  const isRoughlyCentered =
    dotCenter > wrapperRect.left + wrapperRect.width * 0.4 &&
    dotCenter < wrapperRect.right - wrapperRect.width * 0.4;

  if (!force && isFullyVisible && isRoughlyCentered) return;

  const scrollAmount =
    activeDot.offsetLeft - scrollWrapper.clientWidth / 2 + activeDot.offsetWidth / 2;

  scrollWrapper.scrollTo({
    left: scrollAmount,
    behavior: smooth ? "smooth" : "auto",
  });
}

async function preloadGenreData(itemIds) {
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) return;

  const genreMap = new Map();

  await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        const item = await fetchItemDetails(itemId);
        if (item && Array.isArray(item.Genres)) {
          genreMap.set(itemId, item.Genres);
        }
      } catch (err) {
      }
    })
  );
}

export function displaySlide(index) {
  ensureFlickerFixCSS();

  const indexPage = document.querySelector("#indexPage:not(.hide)");
  if (!indexPage) return;

  const slides = indexPage.querySelectorAll(".slide");
  if (!slides.length) return;

  if (!document.querySelector(".dot-navigation-container")) {
    createDotNavigation();
  }

  const currentSlide = slides[index];
  if (!currentSlide) return;

  const activeSlide = indexPage.querySelector(".slide.active");
  const slidesArr = Array.from(slides);
  const len = slidesArr.length;

  let prevIndex = activeSlide ? slidesArr.indexOf(activeSlide) : -1;
  if (prevIndex < 0) prevIndex = (index - 1 + len) % len;

  let delta = index - prevIndex;
  if (delta >  len / 2)  delta -= len;
  if (delta < -len / 2)  delta += len;

  const direction = delta === 0 ? 1 : (delta > 0 ? 1 : -1);
  const slidesContainer = indexPage.querySelector("#slides-container");

  const isPeak = !!getConfig()?.peakSlider;
  if (slidesContainer) slidesContainer.classList.toggle("peak-mode", isPeak);
  if (isPeak && slidesContainer && !slidesContainer.classList.contains('peak-ready')) {
    slidesContainer.classList.add('peak-init');
    slidesContainer.scrollLeft = 0;
  }

  slides.forEach(s => {
    if (s === currentSlide) {
      showSlide(s);
    } else if (!isPeak) {
      hideSlide(s, { soft: true });
    }
  });

  if (activeSlide) {
    if (!isPeak) {
      const enableAnims = !!getConfig()?.enableSlideAnimations;
      if (!enableAnims) {
        requestAnimationFrame(() => {
          microFadeSwap(activeSlide, currentSlide);
        });
      } else {
        cancelOngoingAnimations(slidesArr);
        showSlide(currentSlide);
        currentSlide.style.opacity = "0";
        currentSlide.style.willChange = "transform, opacity";
        forceReflow(currentSlide);
        requestAnimationFrame(() => {
          applySlideAnimation(activeSlide, currentSlide, direction);
        });
      }
    }
  } else {
    showSlide(currentSlide);
    currentSlide.style.opacity = "1";
  }

  if (isPeak) {
    ensurePeakVars(slidesContainer);
    const cfg = getConfig();
    let spanLeft  = Number(cfg?.peakSpanLeft  ?? 1);
    let spanRight = Number(cfg?.peakSpanRight ?? 5);
    const diagonal = !!cfg?.peakDiagonal;
    if (!diagonal) { spanLeft = 1; spanRight = 1; }

    primePeakFirstPaint(slides, index, slidesContainer, { spanLeft, spanRight, diagonal });
    enablePeakNeighborActivation();
  } else {
    slides.forEach(slide => {
      if (slide !== currentSlide) {
        slide.classList.remove("active");
        setTimeout(() => {
          if (!slide.classList.contains("active")) {
            hideSlide(slide, { soft: true });
          }
        }, getConfig().slideAnimationDuration || 300);
      }
    });
  }

  showSlide(currentSlide);
  requestAnimationFrame(() => {
    currentSlide.classList.add("active");
    currentSlide.dispatchEvent(new CustomEvent("slideActive"));

    if (isPeak) {
      setTimeout(() => {
        updateProgressBarPosition();
      }, 50);
    } else {
      updateProgressBarPosition();
    }

    const directorContainer = currentSlide.querySelector(".director-container");
    if (directorContainer) {
      showAndHideElementWithAnimation(directorContainer, {
        girisSure: config.girisSure,
        aktifSure: config.aktifSure,
        transitionDuration: 600,
      });
    }
  });

  updateActiveDot();
  initSliderArrows(currentSlide);
  initSwipeEvents();
}

window.addEventListener('resize', () => {
  if (modalState.progressBarEl && !useSecondsMode()) {
    updateProgressBarPosition();
  }
});

function cancelOngoingAnimations(slidesArr) {
  for (const s of slidesArr) {
    if (s.__animating || s.__animToken) {
      hardCleanupSlide(s);
      if (!s.classList.contains('active')) {
        s.style.display = "none";
        s.style.opacity = "0";
      }
    }
  }
}

function circSignedDist(i, active, len) {
  let d = ((i - active) % len + len) % len;
  if (d > len / 2) d -= len;
  return d;
}

export function updatePeakClasses(slides, activeIndex, spanOrOpts = 2) {
  if (window.__peakBooting) {
    const arr = Array.from(slides);
    arr.forEach(s => {
      s.classList.remove('active','off-left','off-right','peak-neighbor');
      [...s.classList].forEach(c => { if (/^(left|right)\d+$/.test(c)) s.classList.remove(c); });
      s.removeAttribute("data-side");
      s.style.removeProperty("--k");
      showSlide(s);
    });

    const active = arr[activeIndex] || arr[0];
    if (active) active.classList.add('active');
    const container = document.querySelector('#slides-container');
    if (container) {
      container.classList.remove('peak-ready');
      container.classList.add('peak-init');
    }
    return;
  }

  const opts = (typeof spanOrOpts === 'object')
    ? { spanLeft: 2, spanRight: 2, diagonal: false, ...spanOrOpts }
    : { spanLeft: spanOrOpts, spanRight: spanOrOpts, diagonal: false };

  const { spanLeft, spanRight, diagonal } = opts;
  const arr = Array.from(slides);

  arr.forEach(s => {
    s.classList.remove('active','off-left','off-right','peak-neighbor');
    [...s.classList].forEach(c => { if (/^(left|right)\d+$/.test(c)) s.classList.remove(c); });
    s.removeAttribute("data-side");
    s.style.removeProperty("--k");
    showSlide(s);
  });

  const active = arr[activeIndex];
  if (active) {
    active.classList.add('active');
    active.removeAttribute('data-side');
    active.style.removeProperty('--k');
    showSlide(active);
  }

  const len = arr.length;
  for (let i = -spanLeft; i <= spanRight; i++) {
    if (i === 0) continue;
    const idx = (activeIndex + i + len) % len;
    const slide = arr[idx];
    if (!slide) continue;
    if (i < 0) {
      const dist = Math.min(-i, spanLeft);
      slide.dataset.side = "left";
      slide.style.setProperty("--k", dist);
      slide.classList.add('peak-neighbor');
    } else {
      const dist = Math.min(i, spanRight);
      slide.dataset.side = "right";
      slide.style.setProperty("--k", dist);
      slide.classList.add('peak-neighbor');
    }
  }

  arr.forEach((s, i) => {
    const d = circSignedDist(i, activeIndex, len);
    if (d < -spanLeft)  s.classList.add('off-left');
    if (d >  spanRight) s.classList.add('off-right');

    if (s.classList.contains('off-left') || s.classList.contains('off-right')) {
      hideSlide(s, { soft: true });
    } else {
      showSlide(s);
    }
  });

  if (modalState.progressBarEl && !useSecondsMode()) {
    setTimeout(() => {
      updateProgressBarPosition();
    }, 50);
  }

  const container = document.querySelector('#slides-container');
  if (container) {
    container.classList.toggle('peak-diagonal', !!diagonal);
    ensurePeakVars(container);
  }
}

export function primePeakFirstPaint(slides, activeIndex, slidesContainer, spanOrOpts = 2) {
  if (window.__peakBooting) {
    const arr = Array.from(slides);
    if (slidesContainer) {
      ensurePeakVars(slidesContainer);
      slidesContainer.dataset.peakPrimed = '1';
      slidesContainer.classList.add('peak-init');
      slidesContainer.classList.remove('peak-ready');
    }
    arr.forEach((s, i) => {
      s.style.setProperty('transition','none','important');
      showSlide(s);
      s.classList.toggle('active', i === activeIndex);
      s.classList.remove('off-left','off-right','peak-neighbor');
      [...s.classList].forEach(c => { if (/^(left|right)\d+$/.test(c)) s.classList.remove(c); });
      s.removeAttribute('data-side');
      s.style.removeProperty('--k');
    });
    requestAnimationFrame(() => {
      arr.forEach(s => s.style.removeProperty('transition'));
    });
    return;
  }
  const opts = (typeof spanOrOpts === 'object')
    ? { spanLeft: 2, spanRight: 2, diagonal: false, ...spanOrOpts }
    : { spanLeft: spanOrOpts, spanRight: spanOrOpts, diagonal: false };

  if (!slidesContainer || slidesContainer.dataset.peakPrimed === '1') {
    updatePeakClasses(slides, activeIndex, opts);
    return;
  }
  ensurePeakVars(slidesContainer);
  slidesContainer.dataset.peakPrimed = '1';
  slidesContainer.classList.add('peak-init');

  const arr = Array.from(slides);
  const len = arr.length;
  const { spanLeft, spanRight, diagonal } = opts;

  arr.forEach((s, i) => {
    s.style.setProperty('transition', 'none', 'important');
    s.style.display = 'block';
    s.style.left = '50%';
    s.style.top  = '50%';
    s.removeAttribute('data-prime-pos');

    const leftDist  = (activeIndex - i + len) % len;
    const rightDist = (i - activeIndex + len) % len;

    if (i === activeIndex) {
      s.setAttribute('data-prime-pos', 'active');
    } else if (leftDist >= 1 && leftDist <= spanLeft) {
  s.dataset.side = "left";
  s.style.setProperty("--k", leftDist);
} else if (rightDist >= 1 && rightDist <= spanRight) {
  s.dataset.side = "right";
  s.style.setProperty("--k", rightDist);
}
  });

  requestAnimationFrame(() => {
    void document.body.offsetHeight;
    requestAnimationFrame(() => {
      arr.forEach(s => {
        s.style.removeProperty('transition');
        s.style.removeProperty('left');
        s.style.removeProperty('top');
      });
      slidesContainer.classList.add('peak-ready');
      slidesContainer.classList.remove('peak-init');
      updatePeakClasses(slides, activeIndex, opts);
      arr.forEach(s => s.removeAttribute('data-prime-pos'));
    });
  });
}

function ensurePeakVars(container) {
  if (!container) return;
  const cfg = getConfig();
  const gxLeft  = (cfg.peakGapLeft  ?? cfg.peakGapX ?? 110) + 'px';
  const gxRight = (cfg.peakGapRight ?? cfg.peakGapX ?? 110) + 'px';
  const gy      = (cfg.peakGapY ?? 0) + 'px';

  container.style.setProperty('--peak-gap-left', gxLeft);
  container.style.setProperty('--peak-gap-right', gxRight);
  container.style.setProperty('--peak-gap-y', gy);
}

export function showAndHideElementWithAnimation(el, config) {
  const {
    girisSure = 0,
    aktifSure = 2000,
    transitionDuration = 600,
  } = config;
  el.style.transition = "none";
  el.style.opacity = "0";
  el.style.transform = "scale(0.95)";
  el.style.display = "none";
  setTimeout(() => {
    el.style.display = "flex";
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${transitionDuration}ms ease, transform ${transitionDuration}ms ease`;
      el.style.opacity = "1";
      el.style.transform = "scale(1)";
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "scale(0.95)";
        setTimeout(() => {
          el.style.display = "none";
        }, transitionDuration);
      }, aktifSure);
    });
  }, girisSure);
}

function initSliderArrows(slide) {
  const actorContainer = slide.querySelector(".artist-container");
  const leftArrow = slide.querySelector(".slider-arrow.left");
  const rightArrow = slide.querySelector(".slider-arrow.right");

  if (!actorContainer || !leftArrow || !rightArrow) return;

  const updateArrows = () => {
    const maxScrollLeft = actorContainer.scrollWidth - actorContainer.clientWidth;
    leftArrow.classList.toggle("hidden", actorContainer.scrollLeft <= 0);
    rightArrow.classList.toggle("hidden", actorContainer.scrollLeft >= maxScrollLeft - 1);
  };

  leftArrow.onclick = () => {
    actorContainer.scrollBy({ left: -actorContainer.clientWidth, behavior: "smooth" });
    setTimeout(updateArrows, 300);
  };

  rightArrow.onclick = () => {
    actorContainer.scrollBy({ left: actorContainer.clientWidth, behavior: "smooth" });
    setTimeout(updateArrows, 300);
  };

  actorContainer.addEventListener("scroll", updateArrows);
  setTimeout(updateArrows, 100);
}

export function positionModalRelativeToDot(modal, dot) {
  const dotRect = dot.getBoundingClientRect();
  const modalWidth = 400;
  const modalHeight = 330;
  const windowPadding = 20;
  const edgeThreshold = 100;
  const verticalOffset = -10;

  let left = dotRect.left + window.scrollX + (dotRect.width - modalWidth) / 2;
  let top = dotRect.top + window.scrollY - modalHeight + verticalOffset;

  if (dotRect.right > window.innerWidth - edgeThreshold) {
    left = window.innerWidth - modalWidth - windowPadding;
  } else if (dotRect.left < edgeThreshold) {
    left = windowPadding;
  }

  if (top < windowPadding) {
    top = dotRect.bottom + window.scrollY + 15;
    if (top + modalHeight > window.innerHeight + window.scrollY - windowPadding) {
      top = dotRect.top + window.scrollY - modalHeight + verticalOffset;
    }
  }

  left = Math.max(windowPadding, Math.min(left, window.innerWidth - modalWidth - windowPadding));
  top = Math.max(windowPadding, Math.min(top, window.innerHeight + window.scrollY - modalHeight - windowPadding));

  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;
}

function clearVideoPreloadCache(opts = {}) {
  const { mode = 'all', itemId, test } = opts;
  try {
    switch (mode) {
      case 'expired':
        {
          const now = Date.now();
          for (const [id, entry] of previewPreloadCache) {
            if (!entry || entry.expiresAt <= now) previewPreloadCache.delete(id);
          }
        }
        break;
      case 'overLimit':
        {
          const limit = typeof PREVIEW_MAX_ENTRIES === 'number' ? PREVIEW_MAX_ENTRIES : 100;
          const overflow = previewPreloadCache.size - limit;
          if (overflow > 0) {
            let n = overflow;
            for (const [id] of previewPreloadCache) {
              previewPreloadCache.delete(id);
              if (--n <= 0) break;
            }
          }
        }
        break;
      case 'item':
        if (itemId) previewPreloadCache.delete(itemId);
        break;
      case 'predicate':
        if (typeof test === 'function') {
          for (const [id, entry] of previewPreloadCache) {
            if (test(id, entry)) previewPreloadCache.delete(id);
          }
        }
        break;
      case 'all':
      default:
        previewPreloadCache.clear();
        break;
    }
  } catch {}
}

function ensureDotQualityBadgeCSS() {
  if (document.getElementById('dot-quality-badge-css')) return;
  const style = document.createElement('style');
  style.id = 'dot-quality-badge-css';
  style.textContent = `
    .dot-quality-badge {
      position: absolute;
      bottom: 24px;
      left: 2px;
      color: white;
      display: flex;
      gap: 2px;
      flex-direction: column;
    }
    .dot-quality-badge img.range-icon,
    .dot-quality-badge img.codec-icon,
    .dot-quality-badge img.quality-icon {
      width: 20px;
      height: 14px;
      background: rgba(30,30,40,.7);
      border-radius: 4px;
      padding: 1px;
      object-fit: contain;
      transition: all .3s ease;
    }
  `;
  document.head.appendChild(style);
}

function enablePeakNeighborActivation() {
  const container = document.querySelector('#slides-container');
  if (!container || container.__peakClickBound) return;
  container.__peakClickBound = true;

  container.addEventListener('click', (e) => {
    if (!container.classList.contains('peak-mode')) return;

    const IG = ['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL','VIDEO'];
    if (e.defaultPrevented || IG.includes(e.target?.tagName)) return;
    if (e.target.closest?.('[data-no-peak-activate="1"], .dot-navigation-container')) return;

    const x = e.clientX, y = e.clientY;
    const topEl    = document.elementFromPoint(x, y);
    const topSlide = topEl?.closest?.('.slide');
    if (!topSlide) return;
    if (!topSlide.classList.contains('peak-neighbor')) return;
    if (topSlide.classList.contains('active')) return;

    e.preventDefault();
    e.stopPropagation();

    const slides = Array.from(container.querySelectorAll('.slide'));
    const targetIndex  = slides.indexOf(topSlide);
    const currentIndex = getCurrentIndex();
    if (targetIndex < 0 || targetIndex === currentIndex) return;

    const len = slides.length;
    let delta = targetIndex - currentIndex;
    if (delta >  len / 2) delta -= len;
    if (delta < -len / 2) delta += len;

    changeSlide(delta);
  }, { capture: true, passive: false });

  if (!document.getElementById('peak-neighbor-cursor-css')) {
    const style = document.createElement('style');
    style.id = 'peak-neighbor-cursor-css';
    style.textContent = `.peak-ready .slide.peak-neighbor{ cursor:pointer; }`;
    document.head.appendChild(style);
  }
}
