import { getYoutubeEmbedUrl, getProviderUrl, isValidUrl, createTrailerIframe, debounce, getHighResImageUrls, prefetchImages, getHighestQualityBackdropIndex, createImageWarmQueue } from "./utils.js";
import { updateFavoriteStatus, updatePlayedStatus, fetchItemDetails, goToDetailsPage } from "./api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { createSlidesContainer, createGradientOverlay, createHorizontalGradientOverlay, createLogoContainer, createStatusContainer, createActorSlider, createInfoContainer, createDirectorContainer, createRatingContainer, createLanguageContainer, createMetaContainer, createMainContentContainer, createPlotContainer, createTitleContainer } from "./containerUtils.js";
import { createButtons, createProviderContainer } from './buttons.js';
import { withServer, withServerSrcset } from "./jfUrl.js";

const S = (u) => withServer(u);
const config = getConfig();
const settingsBackgroundSlides = [];
const backdropWarmQueue = createImageWarmQueue({ concurrency: 3 });
window.__backdropWarmQueue = backdropWarmQueue;

const BG_HYDRATION_PER_FRAME = 12;
const NEIGHBOR_WARM_COUNT = 2;
let __bgHydrationQueue = [];
let __bgHydrationRAF = 0;
let __bgScrollActive = false;
let __bgScrollIdleTimer = 0;

function bgQueueHydration(fn) {
  __bgHydrationQueue.push(fn);
  if (!__bgHydrationRAF) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

function bgFlushHydrationFrame() {
  __bgHydrationRAF = 0;
  if (__bgScrollActive) return;
  let budget = BG_HYDRATION_PER_FRAME;
  while (budget-- > 0 && __bgHydrationQueue.length) {
    const fn = __bgHydrationQueue.shift();
    try { fn && fn(); } catch {}
  }
  if (__bgHydrationQueue.length) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

(function injectBackdropPerfStyles(){
  if (document.getElementById('backdrop-perf-css')) return;
  const st = document.createElement('style');
  st.id = 'backdrop-perf-css';
  st.textContent = `
    .backdrop { opacity: 1; transition: opacity .5s ease; will-change: opacity, filter, transform; transform: translateZ(0); }
    .backdrop.is-lqip { filter: blur(16px); transform: scale(1.03); }
    #slides-container.is-scrolling *,
    #slides-container.is-scrolling .backdrop,
    #slides-container.is-scrolling .gradient-overlay,
    #slides-container.is-scrolling .horizontal-gradient-overlay {
      transition: none !important;
      animation: none !important;
    }
    #slides-container {
      will-change: scroll-position;
      overscroll-behavior: contain;
      backface-visibility: hidden;
    }

    #slides-container .slide {
      content-visibility: auto;
      contain: content;
      contain-intrinsic-size: 720px 405px;
    }
  `;
  document.head.appendChild(st);
})();

const __bgIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    const img = ent.target;
    const data = img.__bgData || {};
    if (ent.isIntersecting) {
      if (!img.__hiRequested) {
        img.__hiRequested = true;
        img.__phase = 'hi';
        bgQueueHydration(() => {
          if (!img.isConnected) return;
          if (data.hqSrcset) img.srcset = data.hqSrcset;
          if (data.hqSrc)    img.src    = data.hqSrc;
        });
      }
    }
  }
}, { rootMargin: '800px 0px' });

function hydrateBackdrop(img, { lqSrc, hqSrc, hqSrcset = '', fallback = '', eager = false, onHiLoaded }) {
  const fb = fallback || lqSrc || '';
  img.__bgData = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;

  try { img.removeAttribute('srcset'); } catch {}
  img.classList.add('is-lqip');
  img.decoding = 'async';
  img.loading = eager ? 'eager' : 'auto';
  img.src = lqSrc || fb || img.src;
  if (!eager) {
    img.style.opacity = '0';
  } else {
    img.style.opacity = '1';
  }

  const onError = () => {
    if (img.__phase === 'hi') {
      try { img.removeAttribute('srcset'); } catch {}
      if (lqSrc) img.src = lqSrc; else if (fb) img.src = fb;
      img.classList.add('is-lqip');
      img.__phase = 'lq';
      img.__hiRequested = false;
    }
  };
  const onLoad = () => {
    if (img.__phase === 'hi') {
      img.classList.remove('is-lqip');
      img.style.opacity = '1';
      img.__hydrated = true;
      try { img.loading = 'eager'; } catch {}
      try { img.decoding = 'auto'; } catch {}
      try { img.setAttribute('fetchpriority','high'); } catch {}
      if (typeof onHiLoaded === 'function') { try { onHiLoaded(); } catch {} }
    } else {
      img.style.opacity = '1';
    }
  };

  img.__bgOnErr = onError;
  img.__bgOnLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  __bgIO.observe(img);
  if (eager && hqSrc) {
    img.__phase = 'hi';
    img.__hiRequested = true;
    if (hqSrcset) img.srcset = hqSrcset;
    img.src = hqSrc;
  }
}

function unobserveBackdrop(img) {
  try { __bgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__bgOnErr); } catch {}
  try { img.removeEventListener('load',  img.__bgOnLoad); } catch {}
  delete img.__bgOnErr;
  delete img.__bgOnLoad;
  try { img.removeAttribute('srcset'); } catch {}
}

function warmImageOnce(url, { timeout = 2500 } = {}) {
  if (!url) return Promise.resolve();
  const LRU_MAX = 500;
  warmImageOnce._set  ??= new Set();
  warmImageOnce._list ??= [];
  if (warmImageOnce._set.has(url)) return Promise.resolve();
  warmImageOnce._set.add(url);
  warmImageOnce._list.push(url);
  if (warmImageOnce._list.length > LRU_MAX) {
    const drop = warmImageOnce._list.splice(0, warmImageOnce._list.length - LRU_MAX);
    for (const u of drop) warmImageOnce._set.delete(u);
  }

  return new Promise((res) => {
    const img = new Image();
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    const t = setTimeout(finish, timeout);
    img.onload = () => { clearTimeout(t); finish(); };
    img.onerror = () => { clearTimeout(t); finish(); };
    img.src = url;
  });
}

function shortPreload(url, ms = 1200) {
  if (!url) return;
  const sel = `link[rel="preload"][as="image"][href="${url}"]`;
  if (document.querySelector(sel)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  document.head.appendChild(link);
  const id = setTimeout(() => {
    try { link.remove(); } catch {}
  }, ms);
  return () => { clearTimeout(id); try { link.remove(); } catch {} };
}

async function createSlide(item) {
  const indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  let parentId = item.Id;
  const itemIdRaw = item.Id;

  if ((item.Type === "Episode" || item.Type === "Season") && item.SeriesId) {
    try {
      const parentItem = await fetchItemDetails(item.SeriesId);
      parentId = parentItem.Id;

      const mergeTrailers = (a = [], b = []) => {
      const all = [...a, ...b];
      const seen = new Set();
      return all.filter(t => {
        const key = (t?.Url || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    let effectiveRemoteTrailers = [];
    if (Array.isArray(item.RemoteTrailers) && item.RemoteTrailers.length) {
      effectiveRemoteTrailers = mergeTrailers(item.RemoteTrailers, parentItem.RemoteTrailers);
    } else {
      effectiveRemoteTrailers = parentItem.RemoteTrailers || [];
    }

    item = {
      ...parentItem,
      Id: item.Id,
      Type: item.Type,
      SeriesId: item.SeriesId,
      MediaStreams: item.MediaStreams,
      People: item.People || parentItem.People,
      UserData: item.UserData,
      RunTimeTicks: item.RunTimeTicks,
      RemoteTrailers: effectiveRemoteTrailers,
      ProviderIds: item.ProviderIds || parentItem.ProviderIds,
      ParentIndexNumber: item.ParentIndexNumber,
      IndexNumber: item.IndexNumber,
      Name: item.Name
    };
        } catch (err) {
      console.error("Dizi bilgileri alınamadı:", err);
    }
  }

  const ac = new AbortController();
  const { signal } = ac;
  const perSlideObservers = [];
  const perSlideCleanups = [];
  const slidesContainer = createSlidesContainer(indexPage);
  const existing = slidesContainer.querySelector(`.slide[data-item-id="${itemIdRaw}"]`);
  (function bindSlidesScrollPerf(){
    if (window.__jmsSlidesScrollBound) return;
    window.__jmsSlidesScrollBound = true;
    const scroller = document.querySelector('#slides-container');
    if (!scroller) return;
    const onScrollPerf = () => {
      __bgScrollActive = true;
      if (__bgScrollIdleTimer) clearTimeout(__bgScrollIdleTimer);
      __bgScrollIdleTimer = setTimeout(() => {
        __bgScrollActive = false;
        if (!__bgHydrationRAF && __bgHydrationQueue.length) {
          __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
        }
      }, 120);
    };
    scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  })();
  if (existing) {
   try { existing.__cleanupSlide?.(); } catch {}
   try { existing.remove(); } catch {}
 }
  if (!slidesContainer.__cleanupMO) {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.removedNodes?.forEach?.(node => {
          if (node && node.__cleanupSlide) {
            try { node.__cleanupSlide(); } catch {}
          }
          node?.querySelectorAll?.('.slide')?.forEach(el => {
            if (el.__cleanupSlide) { try { el.__cleanupSlide(); } catch {} }
          });
        });
      }
    });
    mo.observe(slidesContainer, { childList:true, subtree:true });
    slidesContainer.__cleanupMO = mo;
  }
  const isFirstSlide = slidesContainer.children.length === 0;
  const itemId = item.Id;

  const {
    Overview,
    Type: itemType,
    People,
    UserData,
    MediaStreams,
    Name: title,
    RunTimeTicks,
    OriginalTitle,
    Taglines,
    Genres,
    ChildCount,
    ProductionYear,
    ProductionLocations,
    CommunityRating,
    CriticRating,
    OfficialRating,
    RemoteTrailers,
    ProviderIds
  } = item;

  let highestQualityBackdropIndex;
  if (config.manualBackdropSelection || config.indexZeroSelection) {
    highestQualityBackdropIndex = "0";
  } else {
    highestQualityBackdropIndex = await getHighestQualityBackdropIndex(parentId);
  }

  function storeBackdropUrl(id, url) {
    try {
      const stored = JSON.parse(localStorage.getItem("backdropUrls")) || [];
      if (!stored.includes(url)) {
        stored.push(url);
        const MAX = 500;
        const trimmed = stored.slice(-MAX);
        localStorage.setItem("backdropUrls", JSON.stringify(trimmed));
      }
    } catch {}
  }

  const autoBackdropUrl = S(`/Items/${parentId}/Images/Backdrop/${highestQualityBackdropIndex}`);
  const landscapeUrl = S(`/Items/${parentId}/Images/Thumb/0`);
  const primaryUrl  = S(`/Items/${parentId}/Images/Primary`);
  let logoUrl = S(`/Items/${parentId}/Images/Logo`);
  const bannerUrl = `/Items/${parentId}/Images/Banner`;
  const artUrl = `/Items/${parentId}/Images/Art`;
  const discUrl = `/Items/${parentId}/Images/Disc`;
  const logoExists = true;

  storeBackdropUrl(parentId, autoBackdropUrl);

  const manualBackdropUrl = {
    backdropUrl: S(`/Items/${parentId}/Images/Backdrop/0`),
    landscapeUrl,
    primaryUrl,
    logoUrl: logoExists ? logoUrl : `/Items/${parentId}/Images/Backdrop/0`,
    bannerUrl: S(`/Items/${parentId}/Images/Banner`),
    artUrl: S(`/Items/${parentId}/Images/Art`),
    discUrl: S(`/Items/${parentId}/Images/Disc`),
    none: ""
  }[config.backdropImageType];

  addSlideToSettingsBackground(parentId, autoBackdropUrl);

  const slide = document.createElement("div");
  slide.className = "slide";
  slide.style.position = "absolute";
  slide.style.display = "none";
  slide.dataset.detailUrl = `/web/#/details?id=${itemId}`;
  slide.dataset.itemId = itemId;
  slide.setAttribute('data-media-streams', JSON.stringify(MediaStreams || []));
  slide.dataset.played =
  (typeof UserData?.PlaybackPositionTicks === "number" && UserData.PlaybackPositionTicks > 0)
    ? "true"
    : "false";

  if (typeof UserData?.PlaybackPositionTicks === "number") {
    slide.dataset.playbackpositionticks = UserData.PlaybackPositionTicks;
  }
  if (typeof RunTimeTicks === "number") {
    slide.dataset.runtimeticks = RunTimeTicks;
  }

  const selectedOverlayUrl = {
    backdropUrl: autoBackdropUrl,
    landscapeUrl,
    primaryUrl,
    logoUrl,
    bannerUrl,
    artUrl,
    discUrl,
    none: ""
  }[config.gradientOverlayImageType];

  slide.dataset.background = S(selectedOverlayUrl);
  slide.dataset.backdropUrl = autoBackdropUrl;
  slide.dataset.landscapeUrl = landscapeUrl;
  slide.dataset.primaryUrl = primaryUrl;
  slide.dataset.logoUrl = logoUrl;
  slide.dataset.bannerUrl = S(`/Items/${parentId}/Images/Banner`);
  slide.dataset.artUrl  = S(`/Items/${parentId}/Images/Art`);
  slide.dataset.discUrl = S(`/Items/${parentId}/Images/Disc`);

  const { backdropUrl, placeholderUrl, srcset } = await getHighResImageUrls(
    { ...item, Id: parentId },
    highestQualityBackdropIndex
  );
  const absBackdrop = config.manualBackdropSelection ? manualBackdropUrl : S(backdropUrl);
  const absPlaceholder = S(placeholderUrl);
  const absSrcset = withServerSrcset(srcset || "");
  const finalBackdropForWarm = absBackdrop;

  const backdropImg = document.createElement('img');
  backdropImg.className = 'backdrop';
  backdropImg.alt = 'Backdrop';
  backdropImg.sizes = '100vw';
  if (isFirstSlide) backdropImg.setAttribute('fetchpriority', 'high');

  hydrateBackdrop(backdropImg, {
    lqSrc: absPlaceholder,
    hqSrc: absBackdrop,
    hqSrcset: absSrcset,
    eager: isFirstSlide,
    onHiLoaded: () => {  }
  });

  backdropWarmQueue.enqueue(finalBackdropForWarm, { shortPreload: true });
  const warmObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        shortPreload(finalBackdropForWarm, 1500);
        warmImageOnce(finalBackdropForWarm).catch(() => {});
        obs.unobserve(entry.target);
      }
    });
  }, { root: null, rootMargin: '600px 0px' });
  warmObserver.observe(backdropImg);
  perSlideObservers.push(warmObserver);

  const pinActiveIfNeeded = () => {
    const slideEl = backdropImg.closest('.slide');
    const active = slideEl?.classList.contains('active');
    if (!active) return;
    try { backdropImg.setAttribute('fetchpriority','high'); } catch {}
    try { backdropImg.loading = 'eager'; } catch {}
  };
  backdropImg.addEventListener('load', pinActiveIfNeeded, { once:true, passive:true, signal });

  const warmOnHover = () => { warmImageOnce(finalBackdropForWarm).catch(() => {}); };
  backdropImg.addEventListener('mouseenter',  warmOnHover, { passive: true, signal });
  backdropImg.addEventListener('pointerover', warmOnHover, { passive: true, signal });
  const ioPreload = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const finalBackdrop = config.manualBackdropSelection ? manualBackdropUrl : backdropUrl;
      let preload = document.querySelector(`link[rel="preload"][as="image"][href="${finalBackdrop}"]`);
      if (!preload) {
        preload = document.createElement('link');
        preload.rel = 'preload';
        preload.as = 'image';
        preload.href = finalBackdrop;
        document.head.appendChild(preload);
      }
      const tid = setTimeout(() => { try { if (preload && !preload.__pinned) preload.remove(); } catch {} }, 1500);
      perSlideCleanups.push(() => clearTimeout(tid));
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '800px 0px' });
  ioPreload.observe(backdropImg);
  perSlideObservers.push(ioPreload);

  backdropImg.addEventListener('click', (ev) => {
  const slideEl = ev.currentTarget.closest('.slide');
  const sc = document.querySelector('#slides-container');
  const isPeak = sc?.classList.contains('peak-mode');
  const isActive = slideEl?.classList.contains('active');
  if (isPeak && !isActive) {
    return;
  }
  goToDetailsPage(itemId);
}, { signal });

  const prevTeardown = slide.__cleanupSlide;
  const teardown = () => {
    try { perSlideObservers.forEach(o => o.disconnect()); } catch {}
    try { ac.abort(); } catch {}
    try { backdropImg.removeEventListener('mouseenter', warmOnHover); } catch {}
    try { backdropImg.removeEventListener('pointerover', warmOnHover); } catch {}
    try { unobserveBackdrop(backdropImg); } catch {}
    try { perSlideCleanups.forEach(fn => { try { fn(); } catch {} }); } catch {}
    if (typeof prevTeardown === 'function') { try { prevTeardown(); } catch {} }
  };

  slide.__cleanupSlide = teardown;

  const gradientOverlay = createGradientOverlay(selectedOverlayUrl);
  const horizontalGradientOverlay = createHorizontalGradientOverlay();
  slide.append(backdropImg, gradientOverlay, horizontalGradientOverlay);

  if (!slide.__trailerInit) {
   slide.__trailerInit = true;
   createTrailerIframe({ config, RemoteTrailers, slide, backdropImg, itemId });
 }

  const logoContainer = createLogoContainer();
  const order = config.showDiscOnly
    ? ["disk"]
    : config.showTitleOnly
      ? ["originalTitle"]
      : config.showLogoOrTitle
        ? config.displayOrder.split(",").map(item => item.trim())
        : [];

  function createLogoElement(fallback) {
    const logoImg = document.createElement("img");
    logoImg.className = "logo";
    logoImg.src = logoUrl;
    logoImg.alt = "";
    logoImg.loading = "lazy";
    logoImg.decoding = "async";
   logoImg.addEventListener('error', () => {
     logoImg.remove();
     fallback?.();
   }, { once:true });
    Object.assign(logoImg.style, {
      width: "100%", maxWidth: "90%", height: "100%", maxHeight: "40%", objectFit: "contain", aspectRatio: "1", display: "block"
    });
    return logoImg;
  }

  function createDiskElement(fallback) {
    const discImg = document.createElement("img");
    discImg.className = "disk";
    discImg.src = discUrl;
    discImg.alt = "";
    discImg.loading = "lazy";
    Object.assign(discImg.style, {
      maxWidth: "75%", maxHeight: "75%", width: "auto", objectFit: "contain", borderRadius: "50%", display: "block"
    });
    discImg.onerror = fallback;
    return discImg;
  }

  function createTitleElement() {
    const titleDiv = document.createElement("div");
    titleDiv.className = "no-logo-container";
    titleDiv.textContent = OriginalTitle;
    Object.assign(titleDiv.style, {
      display: "flex", alignItems: "center", justifyContent: "center"
    });
    return titleDiv;
  }

  function tryDisplayElement(index) {
    if (index >= order.length) return;
    const type = order[index];
    if (type === "logo") {
      const element = createLogoElement(() => {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "disk") {
      const element = createDiskElement(() => {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "originalTitle") {
      const element = createTitleElement();
      logoContainer.appendChild(element);
    } else {
      tryDisplayElement(index + 1);
    }
  }

  tryDisplayElement(0);

  const buttonContainer = createButtons(slide, config, UserData, itemId, RemoteTrailers, updatePlayedStatus, updateFavoriteStatus, openTrailerModal, item);
  const plotContainer = createPlotContainer(config, Overview, UserData, RunTimeTicks);
  const titleContainer = createTitleContainer({
  config,
  Taglines,
  title,
  OriginalTitle,
  Type: itemType,
  ParentIndexNumber: item.ParentIndexNumber,
  IndexNumber: item.IndexNumber
});

  const statusContainer = createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams);
  const actorSlider = await createActorSlider(People, config, item);
  const infoContainer = createInfoContainer({ config, Genres, ProductionYear, ProductionLocations });
  const directorContainer = await createDirectorContainer({ config, People, item });
  const { container: ratingContainer, ratingExists } = await createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
});
  const providerContainer = createProviderContainer({ config, ProviderIds, RemoteTrailers, itemId, slide });
  const languageContainer = createLanguageContainer({ config, MediaStreams, itemType });

  const metaContainer = createMetaContainer();
  if (statusContainer) metaContainer.appendChild(statusContainer);
  if (ratingExists) metaContainer.appendChild(ratingContainer);
  if (languageContainer) metaContainer.appendChild(languageContainer);
  const mainContentContainer = createMainContentContainer();
  mainContentContainer.append(logoContainer, titleContainer, plotContainer, providerContainer);
  slide.append(metaContainer, mainContentContainer, buttonContainer, actorSlider, infoContainer, directorContainer);
  const frag = document.createDocumentFragment();
  frag.appendChild(slide);
  slidesContainer.appendChild(frag);
  if (slidesContainer.children.length === 1) {
    import("./navigation.js").then(mod => mod.displaySlide(0));
  }
}

function addSlideToSettingsBackground(itemId, backdropUrl) {
  const settingsSlider = document.getElementById("settingsBackgroundSlider");
  if (!settingsSlider) return;
  const existingSlide = settingsSlider.querySelector(`[data-item-id="${itemId}"]`);
  if (existingSlide) return;
  const slide = document.createElement("div");
  slide.className = "slide";
  slide.dataset.itemId = itemId;
  slide.style.backgroundImage = `url('${backdropUrl}')`;
  const img = new Image();
  img.src = backdropUrl;
  img.onerror = () => {
    if (slide.parentNode) {
      slide.parentNode.removeChild(slide);
    }
  };
  img.onload = () => { img.onload = img.onerror = null; };
  settingsSlider.appendChild(slide);
  if (settingsSlider.children.length === 1) {
    slide.classList.add("active");
  }
}

function buildStarLayer(useSolid) {
  const layer = document.createElement("span");
  layer.className = useSolid ? "trailer-star-fill" : "trailer-star-track";

  for (let i = 0; i < 5; i++) {
    const star = document.createElement("i");
    star.className = useSolid ? "fa-solid fa-star" : "fa-regular fa-star";
    layer.appendChild(star);
  }
  return layer;
}

function openTrailerModal(trailerUrl, trailerName, itemName = '', itemType = '', isFavorite = false, itemId = null, updateFavoriteCallback = null, CommunityRating = null, CriticRating = null, OfficialRating = null) {
  const embedUrl = getYoutubeEmbedUrl(trailerUrl);
  const sep = embedUrl.includes('?') ? '&' : '?';
  const logoUrl = withServer(`/Items/${itemId}/Images/Logo`);
  const overlay = document.createElement("div");
  overlay.className = "trailer-modal-overlay";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.3s ease-in-out";

  const modal = document.createElement("div");
  modal.className = "trailer-modal";
  modal.style.maxWidth = "90vw";
  modal.style.maxHeight = "90vh";
  modal.style.width = "800px";

  const modalHeader = document.createElement("div");
  modalHeader.className = "trailer-modal-header";

  const logoContainer = document.createElement("div");
  logoContainer.className = "trailer-modal-logo";
  logoContainer.style.display = "flex";
  logoContainer.style.alignItems = "center";
  logoContainer.style.height = "40px";
  logoContainer.style.maxWidth = "200px";
  logoContainer.style.marginRight = "auto";

  const logoImg = document.createElement("img");
  logoImg.src = logoUrl;
  logoImg.alt = itemName;
  logoImg.style.maxHeight = "100%";
  logoImg.style.maxWidth = "100%";
  logoImg.style.objectFit = "contain";
  logoImg.style.display = "block";

  logoImg.onerror = () => {
    logoContainer.style.display = "none";
  };

  logoContainer.appendChild(logoImg);

  const titleElement = document.createElement("h3");
  const itemDisplayName = itemName ? itemName : 'Bilinmeyen İçerik';
  titleElement.textContent = `${itemDisplayName} - ${config.languageLabels.fragman}`;
  titleElement.style.margin = "0";
  titleElement.style.marginLeft = "15px";
  titleElement.style.flex = "1";
  titleElement.style.textAlign = "center";

  const closeBtn = document.createElement("button");
  closeBtn.className = "trailer-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.marginLeft = "auto";

  modalHeader.append(logoContainer, titleElement, closeBtn);

  const videoContainer = document.createElement("div");
  videoContainer.className = "trailer-video-container";
  videoContainer.style.paddingBottom = "56.25%";

  const loadingSpinner = document.createElement("div");
  loadingSpinner.className = "trailer-loading";
  videoContainer.appendChild(loadingSpinner);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  let finalEmbedUrl = embedUrl;
  if (isMobile) {
    finalEmbedUrl = embedUrl;

    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      finalEmbedUrl += '&playsinline=1&autoplay=1';
    }
  }

  const iframe = document.createElement("iframe");
  try {
    const u = new URL(finalEmbedUrl, window.location.origin);
    u.searchParams.set('autoplay', '1');
    u.searchParams.set('mute', '0');
    u.searchParams.set('playsinline', '1');
    if (hasJsApi) {
      u.searchParams.set('enablejsapi', '1');
      u.searchParams.set('origin', window.location.origin);
    }
    finalEmbedUrl = u.toString();
  } catch {}
  iframe.src = finalEmbedUrl;
  iframe.title = trailerName;
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  iframe.referrerPolicy = 'origin-when-cross-origin';
  iframe.setAttribute('playsinline', 'true');
  iframe.style.position = "absolute";
  iframe.style.top = "0";
  iframe.style.left = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";

  let audioUnlocked = false;
  const hasJsApi = (() => {
   try { return new URL(finalEmbedUrl).searchParams.get("enablejsapi") === "1"; }
   catch { return false; }
 })();

 const playViaAPI = () => {
    if (!hasJsApi) return;
    try {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    } catch {}
  };

  const unlockAudio = () => {
    if (audioUnlocked) return;

    if (!hasJsApi) return;
    try {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
      iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[50]}', '*');
      audioUnlocked = true;
    } catch (e) {
      console.log("Ses açma hatası:", e);
    }
  };

  iframe.onload = () => {
    loadingSpinner.style.display = "none";
    playViaAPI();
    if (isMobile) {
      const userInteractionHandler = () => {
        unlockAudio();
        document.removeEventListener('click', userInteractionHandler);
        document.removeEventListener('touchstart', userInteractionHandler);
      };

      document.addEventListener('click', userInteractionHandler, { once: true });
      document.addEventListener('touchstart', userInteractionHandler, { once: true });
      setTimeout(playViaAPI, 400);
    }
  };

  videoContainer.appendChild(iframe);
  const modalFooter = document.createElement("div");
  modalFooter.className = "trailer-modal-footer";
  modalFooter.style.display = "flex";
  modalFooter.style.justifyContent = "space-between";
  modalFooter.style.alignItems = "center";
  modalFooter.style.width = "100%";
  modalFooter.style.padding = "10px 20px";
  modalFooter.style.boxSizing = "border-box";

  const infoContainer = document.createElement("div");
  infoContainer.style.display = "flex";
  infoContainer.style.gap = "8px";

  const itemTitleElement = document.createElement("div");
  const contentType = itemType === 'Movie' ? config.languageLabels.film :
                    itemType === 'Series' ? config.languageLabels.dizi :
                    itemType === 'Episode' ? config.languageLabels.dizi :
                    "İçerik: ";
  itemTitleElement.textContent = `${contentType}: ${itemDisplayName}`;
  itemTitleElement.style.fontWeight = "bold";
  infoContainer.appendChild(itemTitleElement);
  const ratingContainer = document.createElement("div");
  ratingContainer.style.display = "flex";
  ratingContainer.style.gap = "15px";
  ratingContainer.style.alignItems = "center";

  if (CommunityRating != null) {
    let rating10 = Array.isArray(CommunityRating)
      ? (CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length)
      : CommunityRating;
    rating10 = Math.max(0, Math.min(10, Number(rating10) || 0));

    const rating5 = rating10 / 2;
    const fillPercent = (rating5 / 5) * 100;

    const communityRatingElement = document.createElement("div");
    communityRatingElement.style.display = "flex";
    communityRatingElement.style.alignItems = "center";
    communityRatingElement.style.gap = "8px";

    const starWrap = document.createElement("span");
    starWrap.className = "trailer-star-rating";
    starWrap.setAttribute("aria-label", `${rating5.toFixed(1)} / 5`);

    const track = buildStarLayer(false);
    const fill = buildStarLayer(true);
    starWrap.style.display = 'inline-flex';
    starWrap.style.position = 'relative';
    starWrap.style.width = 'fit-content';
    fill.style.width = `${fillPercent}%`;
    fill.style.overflow = 'hidden';
    fill.style.position = 'absolute';
    fill.style.top = '0';
    fill.style.left = '0';
    fill.style.pointerEvents = 'none';
    track.style.position = 'relative';
    track.style.zIndex = '1';

    starWrap.appendChild(track);
    starWrap.appendChild(fill);

    const ratingText = document.createElement("span");
    ratingText.textContent = `${rating5.toFixed(1)} / 5`;

    communityRatingElement.appendChild(starWrap);
    communityRatingElement.appendChild(ratingText);
    ratingContainer.appendChild(communityRatingElement);
  }

  if (CriticRating) {
    const criticRatingElement = document.createElement("div");
    criticRatingElement.style.display = "flex";
    criticRatingElement.style.alignItems = "center";
    criticRatingElement.style.gap = "5px";

    const tomatoIcon = document.createElement("i");
    tomatoIcon.className = "fa-duotone fa-tomato";
    tomatoIcon.style.setProperty("--fa-primary-color", "#01902e");
    tomatoIcon.style.setProperty("--fa-secondary-color", "#f93208");
    tomatoIcon.style.setProperty("--fa-secondary-opacity", "1");

    const ratingValue = document.createElement("span");
    ratingValue.textContent = `${CriticRating}%`;

    criticRatingElement.appendChild(tomatoIcon);
    criticRatingElement.appendChild(ratingValue);
    ratingContainer.appendChild(criticRatingElement);
}

  if (OfficialRating) {
    const officialRatingElement = document.createElement("div");
    officialRatingElement.className = "official-rating";
    officialRatingElement.textContent = OfficialRating;
    officialRatingElement.style.padding = "2px 5px";
    officialRatingElement.style.borderRadius = "3px";
    officialRatingElement.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
    officialRatingElement.style.fontSize = "0.9em";
    ratingContainer.appendChild(officialRatingElement);
  }

  if (itemId && updateFavoriteCallback) {
    const favoriteContainer = document.createElement("div");
    favoriteContainer.style.cursor = "pointer";

    const initiallyFav = Boolean(isFavorite);
    const favoriteIcon = document.createElement("i");
    favoriteIcon.className = initiallyFav
      ? "fa-solid fa-heart"
      : "fa-regular fa-heart";
    favoriteIcon.style.color = initiallyFav ? "#FFC107" : "#fff";

    const favoriteText = document.createElement("span");
    favoriteText.textContent = initiallyFav
      ? config.languageLabels.favorilendi
      : config.languageLabels.favori;

    favoriteContainer.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!itemId || !updateFavoriteCallback) return;

      const newFavoriteStatus = !favoriteIcon.classList.contains("fa-solid");
      try {
        await updateFavoriteCallback(itemId, newFavoriteStatus);
        favoriteIcon.className = newFavoriteStatus
          ? "fa-solid fa-heart"
          : "fa-regular fa-heart";
        favoriteIcon.style.color = newFavoriteStatus ? "#FFC107" : "#fff";
        favoriteText.textContent = newFavoriteStatus
          ? config.languageLabels.favorilendi
          : config.languageLabels.favori;
        favoriteIcon.style.transform = "scale(1.2)";
        setTimeout(() => (favoriteIcon.style.transform = ""), 200);
      } catch (err) {
        console.error("Favori durumu güncellenirken hata:", err);
      }
    });

    favoriteContainer.appendChild(favoriteIcon);
    favoriteContainer.appendChild(favoriteText);
    infoContainer.appendChild(favoriteContainer);
  }

  modalFooter.appendChild(infoContainer);
  modalFooter.appendChild(ratingContainer);

  modal.append(modalHeader, videoContainer, modalFooter);
  overlay.appendChild(modal);

  if (!document.getElementById('trailer-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'trailer-modal-styles';
    style.textContent = `
      .trailer-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 15px 20px;
        background: rgba(0, 0, 0, 0.8);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        position: relative;
      }

      .trailer-modal-logo {
        flex-shrink: 0;
      }

      .trailer-loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 50px;
        height: 50px;
        border: 5px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        border-top-color: #fff;
        animation: spin 1s ease-in-out infinite;
        z-index: 10;
      }

      @keyframes spin {
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }

      @media (max-width: 768px) {
        .trailer-modal {
          width: 95vw !important;
          height: auto !important;
        }

        .trailer-modal-header h3 {
          font-size: 14px;
          margin-left: 10px !important;
        }

        .trailer-modal-logo {
          max-width: 120px !important;
          height: 30px !important;
        }

        .trailer-audio-notice {
          background: rgba(255, 193, 7, 0.2);
          border: 1px solid #FFC107;
          border-radius: 5px;
          padding: 8px 12px;
          margin: 10px 20px;
          font-size: 12px;
          text-align: center;
          color: #FFC107;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const closeModal = () => {
    overlay.style.opacity = "0";
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        try { iframe.src = "about:blank"; } catch {}
        document.body.removeChild(overlay);
      }
      document.removeEventListener("keydown", escListener);
    }, 300);
  };

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  const escListener = (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
      closeModal();
    }
  };

  document.addEventListener("keydown", escListener);
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = "1";
  }, 10);

  return {
    close: closeModal,
    getIframe: () => iframe
  };
}

export { createSlide, openTrailerModal };
