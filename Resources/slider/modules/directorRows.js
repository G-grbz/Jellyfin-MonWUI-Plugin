import { getSessionInfo, makeApiRequest, getCachedUserTopGenres, playNow } from "./api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openDirectorExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, OPEN_HOVER_DELAY_MS } from "./hoverTrailerModal.js";
import { createTrailerIframe, ensureJmsDetailsOverlay } from "./utils.js";
import { openDetailsModal } from "./detailsModal.js";
import { withServer } from "./jfUrl.js";
import { setupScroller } from "./personalRecommendations.js";
import {
  openDirRowsDB,
  makeScope,
  upsertDirector,
  upsertItem,
  linkDirectorItem,
  listDirectors,
  getItemsForDirector,
  getMeta,
  setMeta
} from "./dirRowsDb.js";

const config = getConfig();
const labels = getLanguageLabels?.() || {};
const IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);

const PLACEHOLDER_URL = (config.placeholderImage) || './slider/src/images/placeholder.png';
const ROW_CARD_COUNT = Number.isFinite(config.directorRowCardCount) ? Math.max(1, config.directorRowCardCount|0) : 10;
const EFFECTIVE_ROW_CARD_COUNT = ROW_CARD_COUNT;
const MIN_RATING = 0;
const HOVER_MODE = (config.directorRowsHoverPreviewMode === 'studioMini' || config.directorRowsHoverPreviewMode === 'modal')
  ? config.directorRowsHoverPreviewMode
  : 'inherit';

const DIR_ROWS_COUNT_NUM = Number(config.directorRowsCount);
const ROWS_COUNT = Number.isFinite(DIR_ROWS_COUNT_NUM) ? Math.max(1, DIR_ROWS_COUNT_NUM | 0) : 5;
const MAX_RENDER_COUNT = ROWS_COUNT;

const MIN_CONTENTS = Number.isFinite(config.directorRowsMinItemsPerDirector)
  ? Math.max(1, config.directorRowsMinItemsPerDirector|0)
  : 10;

const STATE = {
  directors: [],
  nextIndex: 0,
  batchSize: 1,
  started: false,
  loading: false,
  batchObserver: null,
  wrapEl: null,
  serverId: null,
  userId: null,
  renderedCount: 0,
  maxRenderCount: MAX_RENDER_COUNT,
  sectionIOs: new Set(),
  autoPumpScheduled: false,
  _db: null,
  _scope: null,
  _backfillRunning: false,
};

let __dirScrollIdleTimer = null;
let __dirScrollIdleAttached = false;
let __dirArrowObserver = null;
let __dirSyncInterval = null;
let __dirBackfillInterval = null;
let __dirBackfillIdleHandle = null;

function setDirectorArrowLoading(isLoading) {
  const arrow = STATE._loadMoreArrow;
  if (!arrow) return;

  if (isLoading) {
    arrow.classList.add('is-loading');
    arrow.disabled = true;
    arrow.innerHTML = `<span class="gh-spinner" aria-hidden="true"></span>`;
    arrow.setAttribute('aria-busy', 'true');
  } else {
    arrow.classList.remove('is-loading');
    arrow.disabled = false;
    arrow.innerHTML = `<span class="material-icons">expand_more</span>`;
    arrow.removeAttribute('aria-busy');
  }
}

function attachDirectorScrollIdleLoader() {
  if (__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = true;

  if (!STATE.wrapEl) return;
  if (!STATE._loadMoreArrow) {
    const arrow = document.createElement('button');
    arrow.className = 'dir-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = `<span class="material-icons">expand_more</span>`;
    arrow.setAttribute(
      'aria-label',
      (labels.loadMoreDirectors ||
        config.languageLabels?.loadMoreDirectors ||
        'Daha fazla yönetmen göster')
    );

    STATE.wrapEl.appendChild(arrow);
    STATE._loadMoreArrow = arrow;

    arrow.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        !STATE.loading &&
        STATE.nextIndex < STATE.directors.length &&
        STATE.renderedCount < STATE.maxRenderCount
      ) {
        renderNextDirectorBatch(false);
      }
    }, { passive: false });
  }

  if (__dirArrowObserver) {
    try { __dirArrowObserver.disconnect(); } catch {}
  }

  __dirArrowObserver = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    if (!ent.isIntersecting) continue;
    if (STATE.loading) continue;
    if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
      detachDirectorScrollIdleLoader();
      return;
    }
    renderNextDirectorBatch(false);
    break;
  }
}, {
  root: null,
  rootMargin: '0px 0px 0px 0px',
  threshold: 0.6,
});

  if (STATE._loadMoreArrow) {
    __dirArrowObserver.observe(STATE._loadMoreArrow);
  }
}

function detachDirectorScrollIdleLoader() {
  if (!__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = false;

  if (__dirArrowObserver) {
    try {
      if (STATE._loadMoreArrow) {
        __dirArrowObserver.unobserve(STATE._loadMoreArrow);
      }
      __dirArrowObserver.disconnect();
    } catch {}
    __dirArrowObserver = null;
  }

  if (STATE._loadMoreArrow && STATE._loadMoreArrow.parentElement) {
    try { STATE._loadMoreArrow.parentElement.removeChild(STATE._loadMoreArrow); } catch {}
  }
  STATE._loadMoreArrow = null;

  if (__dirScrollIdleTimer) {
    clearTimeout(__dirScrollIdleTimer);
    __dirScrollIdleTimer = null;
  }
}

(function ensurePerfCssOnce(){
  if (document.getElementById('dir-rows-perf-css')) return;
  const st = document.createElement('style');
  st.id = 'dir-rows-perf-css';
  st.textContent = `
    #director-rows .dir-row-section {
      contain-intrinsic-size: 260px 600px;
      margin-bottom: 8px;
    }
    #director-rows .personal-recs-row {
      contain-intrinsic-size: 260px 400px;
      contain: layout style paint;
    }
    #director-rows .personal-recs-card {
      contain: layout style paint;
      will-change: transform;
    }
    #director-rows img.is-lqip {
      filter: blur(8px);
      transform: translateZ(0);
      transition: filter 0.3s ease;
    }
    #director-rows img.__hydrated {
      filter: none;
    }
  `;
  document.head.appendChild(st);
})();

const COMMON_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "BackdropImageTags",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "People",
  "Overview",
  "RemoteTrailers"
].join(",");

function pickBestItemByRating(items) {
  if (!items || !items.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const it of items) {
    if (!it) continue;
    const score = Number(it.CommunityRating);
    const s = Number.isFinite(score) ? score : 0;
    if (!best || s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best || items[0] || null;
}

function buildPosterUrl(item, height = 540, quality = 72) {
  const tag = item?.ImageTags?.Primary || item?.PrimaryImageTag;
  if (!tag) return null;
  return withServer(`/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxHeight=${height}&quality=${quality}&EnableImageEnhancers=false`);
}
function buildPosterUrlHQ(item){ return buildPosterUrl(item, 540, 72); }

function buildPosterUrlLQ(item){ return buildPosterUrl(item, 80, 20); }

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  const tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!tag) return null;

  return withServer(`/Items/${item.Id}/Images/Logo` +
         `?tag=${encodeURIComponent(tag)}` +
         `&maxWidth=${width}` +
         `&quality=${quality}` +
         `&EnableImageEnhancers=false`);
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;

  const tag =
    (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item.BackdropImageTag ||
    (item.ImageTags && item.ImageTags.Backdrop);

  if (!tag) return null;

  return withServer(`/Items/${item.Id}/Images/Backdrop` +
         `?tag=${encodeURIComponent(tag)}` +
         `&maxWidth=${width}` +
         `&quality=${quality}` +
         `&EnableImageEnhancers=false`);
}

function buildBackdropUrlLQ(item) {
  return buildBackdropUrl(item, 480, 25);
}

function buildBackdropUrlHQ(item) {
  return buildBackdropUrl(item, 1920, 80);
}

function buildPosterSrcSet(item) {
  const hs = [240, 360, 540];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  return hs.map(h => `${withCacheBust(buildPosterUrl(item, h, q))} ${Math.round(h * ar)}w`).join(", ");
}

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function scheduleImgRetry(img, phase, delayMs) {
  if (!img) return;
  const st = (img.__retryState ||= { lq: { tries: 0 }, hi: { tries: 0 } });
  const slot = st[phase] || (st[phase] = { tries: 0 });

  const maxTries = (phase === "hi") ? 8 : 6;
  if (slot.tries >= maxTries) return;

  slot.tries++;
  clearTimeout(slot.tid);

  slot.tid = setTimeout(() => {
    const data = img.__data || {};
    const fb = data.fallback || PLACEHOLDER_URL;

    try { img.removeAttribute("srcset"); } catch {}

    if (phase === "hi" && data.hqSrc) {
      img.__phase = "hi";
      img.__hiRequested = true;
      img.src = withCacheBust(data.hqSrc);

      const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
      _rIC(() => {
        if (img.__hiRequested && data.hqSrcset) img.srcset = data.hqSrcset;
      });
      return;
    }

    img.__phase = "lq";
    img.__hiRequested = false;
    img.src = withCacheBust(data.lqSrc || fb);
  }, Math.max(250, delayMs|0));
}

let __imgIO = window.__JMS_DIR_IMGIO;

if (!__imgIO) {
  const _rIC = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  __imgIO = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const img = ent.target;
      const data = img.__data || {};
      if (!img.__hiRequested) {
        img.__hiRequested = true;
        img.__phase = 'hi';
        if (data.hqSrc) {
          img.src = data.hqSrc;
          _rIC(() => {
            if (img.__hiRequested && data.hqSrcset) {
              img.srcset = data.hqSrcset;
            }
          });
        }
      }
    }
  }, {
    rootMargin: IS_MOBILE ? '400px 0px' : '600px 0px',
    threshold: 0.1
  });
  window.__JMS_DIR_IMGIO = __imgIO;
}

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;

  try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
  try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}

  img.__data = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;

  try {
    img.removeAttribute('srcset');
    if (img.getAttribute('loading') !== 'eager') img.loading = 'lazy';
  } catch {}

  img.src = lqSrc || fb;
  img.classList.add('is-lqip');
  try { img.classList.remove('__hydrated'); } catch {}
  img.__hydrated = false;

  const onError = () => {
  const data = img.__data || {};
  const fb = data.fallback || PLACEHOLDER_URL;

  try { img.removeAttribute("srcset"); } catch {}

  img.__hiRequested = false;

  if (img.__phase === "hi") {
    const delay = 800 * Math.min(6, (img.__retryState?.hi?.tries || 0) + 1);
    scheduleImgRetry(img, "hi", delay);
  } else {
    if (!img.currentSrc && !img.src) {
      try { img.src = fb; } catch {}
    }
    const delay = 600 * Math.min(5, (img.__retryState?.lq?.tries || 0) + 1);
    scheduleImgRetry(img, "lq", delay);
  }
};

  const onLoad = () => {
  if (img.__retryState) {
    try { clearTimeout(img.__retryState.lq?.tid); } catch {}
    try { clearTimeout(img.__retryState.hi?.tid); } catch {}
    img.__retryState.lq && (img.__retryState.lq.tries = 0);
    img.__retryState.hi && (img.__retryState.hi.tries = 0);
  }

  if (img.__phase === "hi") {
    img.classList.add("__hydrated");
    img.classList.remove("is-lqip");
    img.__hydrated = true;
  }
};

  img.__onErr = onError;
  img.__onLoad = onLoad;
  img.addEventListener('error', onError, { passive:true });
  img.addEventListener('load',  onLoad,  { passive:true });
  __imgIO.observe(img);
}

function unobserveImage(img) {
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr; delete img.__onLoad;
  try { img.removeAttribute('srcset'); } catch {}
  try { delete img.__data; } catch {}
  try {
    if (img.__retryState) {
      clearTimeout(img.__retryState.lq?.tid);
      clearTimeout(img.__retryState.hi?.tid);
    }
  } catch {}
  delete img.__retryState;
}

if (!window.__dirRowsPageShowBound) {
  window.__dirRowsPageShowBound = true;
  window.addEventListener('pageshow', (e) => {
    if (!e || !e.persisted) return;
    try { mountDirectorRowsLazy(); } catch {}
  });
}

function formatRuntime(ticks) {
  if (!ticks) return null;
  const minutes = Math.floor(ticks / 600000000);
  if (minutes < 60) return `${minutes}d`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}s ${remainingMinutes}d` : `${hours}s`;
}

function getRuntimeWithIcons(runtime) {
  if (!runtime) return '';
  return runtime.replace(/(\d+)s/g, `$1${config.languageLabels?.sa || 'sa'}`)
               .replace(/(\d+)d/g, `$1${config.languageLabels?.dk || 'dk'}`);
}

function normalizeAgeChip(rating) {
  if (!rating) return null;
  const r = String(rating).toUpperCase().trim();
  if (/(18\+|R18|NC-17|XXX|AO)/.test(r)) return "18+";
  if (/(17\+|R|TV-MA)/.test(r)) return "17+";
  if (/(16\+|R16|M)/.test(r)) return "16+";
  if (/(15\+|TV-15)/.test(r)) return "15+";
  if (/(13\+|TV-14|PG-13)/.test(r)) return "13+";
  if (/(12\+|TV-12)/.test(r)) return "12+";
  if (/(10\+|TV-Y10)/.test(r)) return "10+";
  if (/(7\+|TV-Y7|E10\+)/.test(r)) return "7+";
  if (/(G|PG|TV-G|TV-PG|E|U|UC)/.test(r)) return "7+";
  if (/(ALL AGES|ALL|TV-Y|KIDS|Y)/.test(r)) return "0+";
  return r;
}

function getDetailsUrl(itemId, serverId) {
  return `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}`;
}

function createRecommendationCard(item, serverId, aboveFold = false) {
  const card = document.createElement("div");
  card.className = "card personal-recs-card";
  card.dataset.itemId = item.Id;

  const posterUrlHQ = buildPosterUrlHQ(item);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  const posterUrlLQ = buildPosterUrlLQ(item);
  const year = item.ProductionYear || "";
  const ageChip = normalizeAgeChip(item.OfficialRating || "");
  const runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  const runtime = formatRuntime(runtimeTicks);
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(", ") : "";
  const isSeries = item.Type === "Series";
  const typeLabel = isSeries
    ? ((config.languageLabels && config.languageLabels.dizi) || "Dizi")
    : ((config.languageLabels && config.languageLabels.film) || "Film");
  const typeIcon = isSeries ? '🎬' : '🎞️';
  const community = Number.isFinite(item.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${item.CommunityRating.toFixed(1)}</div>`
    : "";

  card.innerHTML = `
    <div class="cardBox">
      <a class="cardLink" href="${getDetailsUrl(item.Id, serverId)}">
        <div class="cardImageContainer">
          <img class="cardImage"
            alt="${item.Name}"
            loading="${aboveFold ? 'eager' : 'lazy'}"
            decoding="async"
            ${aboveFold ? 'fetchpriority="high"' : ''}>
          <div class="prc-top-badges">
            ${community}
            <div class="prc-type-badge">
              <span class="prc-type-icon">${typeIcon}</span>
              ${typeLabel}
            </div>
          </div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-meta">
              ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
              ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
              ${runtime ? `<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>` : ""}
            </div>
            ${genres ? `<div class="prc-genres">${genres}</div>` : ""}
          </div>
        </div>
      </a>
    </div>
  `;

  const img = card.querySelector('.cardImage');
  try {
    const sizesMobile = '(max-width: 640px) 45vw, (max-width: 820px) 38vw, 200px';
    const sizesDesk   = '(max-width: 1200px) 20vw, 200px';
    img.setAttribute('sizes', IS_MOBILE ? sizesMobile : sizesDesk);
  } catch {}

  if (posterUrlHQ) {
    hydrateBlurUp(img, {
      lqSrc: posterUrlLQ,
      hqSrc: posterUrlHQ,
      hqSrcset: posterSetHQ,
      fallback: PLACEHOLDER_URL
    });
  } else {
    try { img.style.display = 'none'; } catch {}
    const noImg = document.createElement('div');
    noImg.className = 'prc-noimg-label';
    noImg.textContent =
      (config.languageLabels && (config.languageLabels.noImage || config.languageLabels.loadingText))
      || (labels.noImage || 'Görsel yok');
    noImg.style.minHeight = '200px';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    card.querySelector('.cardImageContainer')?.prepend(noImg);
  }

  try {
    const hostEl = card.querySelector(".cardImageContainer");
    if (hostEl) {
      ensureJmsDetailsOverlay({
        hostEl,
        itemId: item.Id,
        serverId,
        onDetails: async () => {
          const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
          await openDetailsModal({
            itemId: item.Id,
            serverId,
            preferBackdropIndex: backdropIndex,
            originEl: hostEl?.querySelector?.('img.cardImage') || hostEl,
          });
        },
        onPlay: async () => {
          await playNow(item.Id);
        },
        showPlay: false,
      });
    }
  } catch (e) {
    console.warn("ensureJmsDetailsOverlay failed (directorRows):", e);
  }

  const mode = (HOVER_MODE === 'inherit')
    ? (getConfig()?.globalPreviewMode === 'studioMini' ? 'studioMini' : 'modal')
    : HOVER_MODE;

  const defer = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  defer(() => {
    if (card.isConnected) attachPreviewByMode(card, { Id: item.Id, Name: item.Name }, mode);
  });

  card.addEventListener('jms:cleanup', () => {
    unobserveImage(img);
    detachPreviewHandlers(card);
  }, { once:true });
  return card;
}

function isHomeRoute() {
  const h = String(window.location.hash || '').toLowerCase();
  return h.startsWith('#/home') || h.startsWith('#/index') || h === '' || h === '#';
}

function createDirectorHeroCard(item, serverId, directorName) {
  const hero = document.createElement('div');
  hero.className = 'dir-row-hero';
  hero.dataset.itemId = item.Id;

  const bg   = buildBackdropUrlHQ(item) || buildPosterUrlHQ(item) || PLACEHOLDER_URL;
  const logo = buildLogoUrl(item);
  const year = item.ProductionYear || '';
  const plot = clampText(item.Overview, 240);
  const ageChip = normalizeAgeChip(item.OfficialRating || '');
  const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  const metaParts = [];
  if (ageChip) metaParts.push(ageChip);
  if (year) metaParts.push(year);
  if (genres) metaParts.push(genres);
  const meta = metaParts.join(" • ");

  hero.innerHTML = `
    <div class="dir-row-hero-bg-wrap">
      <img class="dir-row-hero-bg" alt="${escapeHtml(item.Name)}" loading="lazy" decoding="async">
    </div>

    <div class="dir-row-hero-inner">
      <div class="dir-row-hero-meta-container">

      <div class="dir-row-hero-label">
          ${(config.languageLabels?.yonetmen || "yönetmen")} ${escapeHtml(directorName || "")}
        </div>

        ${logo ? `
          <div class="dir-row-hero-logo">
            <img src="${logo}" alt="${escapeHtml(item.Name)} logo">
          </div>
        ` : ``}

        <div class="dir-row-hero-title">${escapeHtml(item.Name)}</div>

        ${meta ? `<div class="dir-row-hero-meta">${escapeHtml(meta)}</div>` : ""}

        ${plot ? `<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>` : ""}

        <div class="dir-row-hero-actions">
        <button type="button" class="dir-row-hero-details">
          ${(config.languageLabels?.details || "Ayrıntılar")}
        </button>
      </div>
    </div>
  `;

  const goDetails = () => {
    try {
      window.location.hash = getDetailsUrl(item.Id, serverId);
    } catch {
      window.location.href = getDetailsUrl(item.Id, serverId);
    }
  };

  hero.addEventListener('click', () => {
    goDetails();
  });

  const detailsBtn = hero.querySelector('.dir-row-hero-details');

  if (detailsBtn) {
    detailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goDetails();
    });
  }

  hero.classList.add('active');

  try {
  const bgImg = hero.querySelector('.dir-row-hero-bg');
  if (bgImg) {
    const bgHQ = bg || PLACEHOLDER_URL;

    hydrateBlurUp(bgImg, {
      lqSrc: buildBackdropUrlLQ(item) || PLACEHOLDER_URL,
      hqSrc: bgHQ,
      hqSrcset: "",
      fallback: PLACEHOLDER_URL
    });
  }
} catch (e) {
  console.warn("dir-row-hero-bg hydrate failed:", e);
}

  try {
    const backdropImg = hero.querySelector('.dir-row-hero-bg');
    const heroInner = hero.querySelector('.dir-row-hero-inner');
    const RemoteTrailers =
      item.RemoteTrailers ||
      item.RemoteTrailerItems ||
      item.RemoteTrailerUrls ||
      [];

    createTrailerIframe({
      config,
      RemoteTrailers,
      slide: hero,
      backdropImg,
      extraHoverTargets: [heroInner],
      itemId: item.Id,
      serverId,
      detailsUrl: getDetailsUrl(item.Id, serverId),
      detailsText: (config.languageLabels?.details || labels.details || "Ayrıntılar"),
    });
  } catch (err) {
    console.error("Director hero için createTrailerIframe hata:", err);
  }

  hero.addEventListener('jms:cleanup', () => {
    detachPreviewHandlers(hero);
  }, { once: true });

  return hero;
}

const __hoverIntent = new WeakMap();
const __enterTimers = new WeakMap();
const __enterSeq     = new WeakMap();
const __cooldownUntil= new WeakMap();
const __openTokenMap = new WeakMap();
const __boundPreview = new WeakMap();

let __lastMoveTS = 0;
let __pmLast = 0;
window.addEventListener('pointermove', () => {
  const now = Date.now();
  if (now - __pmLast > 100) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});

let __touchStickyOpen = false;
let __touchLastOpenTS = 0;
const TOUCH_STICKY_GRACE_MS = 1200;

function hardWipeHoverModalDom() {
  const modal = document.querySelector('.video-preview-modal');
  if (!modal) return;
  try { modal.dataset.itemId = ""; } catch {}
  modal.querySelectorAll('img').forEach(img => {
    try { img.removeAttribute('src'); img.removeAttribute('srcset'); } catch {}
  });
  modal.querySelectorAll('[data-field="title"],[data-field="subtitle"],[data-field="meta"],[data-field="genres"]').forEach(el => {
    el.textContent = '';
  });
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound_dir) return;
  window.__jmsTouchCloserBound_dir = true;
  document.addEventListener('pointerdown', (e) => {
    if (!__touchStickyOpen) return;
    const inModal = e.target?.closest?.('.video-preview-modal');
    if (!inModal) {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!__touchStickyOpen) return;
    if (e.key === 'Escape') {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  });
})();

function isHoveringCardOrModal(cardEl) {
  try {
    const overCard  = cardEl?.isConnected && cardEl.matches(':hover');
    const overModal = !!document.querySelector('.video-preview-modal:hover');
    return !!(overCard || overModal);
  } catch { return false; }
}

function schedulePostOpenGuard(cardEl, token, delay=300) {
  setTimeout(() => {
    if (__openTokenMap.get(cardEl) !== token) return;
    if (!isHoveringCardOrModal(cardEl)) {
      try { safeCloseHoverModal(); } catch {}
    }
  }, delay);
}

function scheduleClosePollingGuard(cardEl, tries=4, interval=120) {
  let count = 0;
  const iid = setInterval(() => {
    count++;
    if (isHoveringCardOrModal(cardEl)) { clearInterval(iid); return; }
    if (Date.now() - __lastMoveTS > 120 || count >= tries) {
      try { safeCloseHoverModal(); } catch {}
      clearInterval(iid);
    }
  }, interval);
}

function clearEnterTimer(cardEl) {
  const t = __enterTimers.get(cardEl);
  if (t) { clearTimeout(t); __enterTimers.delete(cardEl); }
}

function safeOpenHoverModal(itemId, anchorEl) {
  if (typeof window.tryOpenHoverModal === 'function') {
    try { window.tryOpenHoverModal(itemId, anchorEl, { bypass: true }); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.open === 'function') {
    try { window.__hoverTrailer.open({ itemId, anchor: anchorEl, bypass: true }); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:open', { detail: { itemId, anchor: anchorEl, bypass: true }}));
}

function safeCloseHoverModal() {
  if (typeof window.closeHoverPreview === 'function') {
    try { window.closeHoverPreview(); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.close === 'function') {
    try { window.__hoverTrailer.close(); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:close'));
  try { hardWipeHoverModalDom(); } catch {}
}

function attachHoverTrailer(cardEl, itemLike) {
  if (!cardEl || !itemLike?.Id) return;
  if (!__enterSeq.has(cardEl)) __enterSeq.set(cardEl, 0);

  const onEnter = (e) => {
    const isTouch = e?.pointerType === 'touch';
    const until = __cooldownUntil.get(cardEl) || 0;
    if (Date.now() < until) return;

    __hoverIntent.set(cardEl, true);
    clearEnterTimer(cardEl);

    const seq = (__enterSeq.get(cardEl) || 0) + 1;
    __enterSeq.set(cardEl, seq);

    const timer = setTimeout(() => {
      if ((__enterSeq.get(cardEl) || 0) !== seq) return;
      if (!__hoverIntent.get(cardEl)) return;
      if (!isTouch) {
        if (!cardEl.isConnected || !cardEl.matches(':hover')) return;
      }
      try { window.dispatchEvent(new Event('closeAllMiniPopovers')); } catch {}

      const token = (Date.now() ^ Math.random()*1e9) | 0;
      __openTokenMap.set(cardEl, token);

      try { hardWipeHoverModalDom(); } catch {}
      safeOpenHoverModal(itemLike.Id, cardEl);

      if (isTouch) {
        __touchStickyOpen = true;
        __touchLastOpenTS = Date.now();
      }
      if (!isTouch) schedulePostOpenGuard(cardEl, token, 300);
    }, OPEN_HOVER_DELAY_MS);

    __enterTimers.set(cardEl, timer);
  };

  const onLeave = (e) => {
    const isTouch = e?.pointerType === 'touch';
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);
    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) return;
      __touchStickyOpen = false;
    }

    const rt = e?.relatedTarget || null;
    const goingToModal = !!(rt && (rt.closest ? rt.closest('.video-preview-modal') : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 4, 120);
  };

  cardEl.addEventListener('pointerenter', onEnter, { passive: true });
  const onDown = (e) => { if (e?.pointerType === 'touch') onEnter(e); };
  cardEl.addEventListener('pointerdown', onDown, { passive: true });
  cardEl.addEventListener('pointerleave', onLeave,  { passive: true });
  __boundPreview.set(cardEl, { mode: 'modal', onEnter, onLeave, onDown });
}

function detachPreviewHandlers(cardEl) {
  const rec = __boundPreview.get(cardEl);
  if (!rec) return;
  try { cardEl.removeEventListener('pointerenter', rec.onEnter); } catch {}
  try { cardEl.removeEventListener('pointerleave', rec.onLeave); } catch {}
  try { if (rec.onDown) cardEl.removeEventListener('pointerdown', rec.onDown); } catch {}
  clearEnterTimer(cardEl);
  __hoverIntent.delete(cardEl);
  __openTokenMap.delete(cardEl);
  __boundPreview.delete(cardEl);
}

function attachPreviewByMode(cardEl, itemLike, mode) {
  detachPreviewHandlers(cardEl);
  if (mode === 'studioMini') {
    attachMiniPosterHover(cardEl, itemLike);
    __boundPreview.set(cardEl, { mode: 'studioMini', onEnter: ()=>{}, onLeave: ()=>{} });
  } else {
    attachHoverTrailer(cardEl, itemLike);
  }
}

function renderSkeletonRow(row, count=EFFECTIVE_ROW_CARD_COUNT) {
  row.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (let i=0; i<count; i++) {
    const el = document.createElement("div");
    el.className = "card personal-recs-card skeleton";
    el.innerHTML = `
      <div class="cardBox">
        <div class="cardImageContainer">
          <div class="cardImage"></div>
          <div class="prc-gradient"></div>
          <div class="prc-overlay">
            <div class="prc-meta">
              <span class="skeleton-line" style="width:42px;height:18px;border-radius:999px;"></span>
              <span class="prc-dot">•</span>
              <span class="skeleton-line" style="width:38px;height:12px;"></span>
              <span class="prc-dot">•</span>
              <span class="skeleton-line" style="width:38px;height:12px;"></span>
            </div>
            <div class="prc-genres">
              <span class="skeleton-line" style="width:90px;height:12px;"></span>
            </div>
          </div>
        </div>
      </div>
    `;
    fragment.appendChild(el);
  }
  row.appendChild(fragment);
}

function filterAndTrimByRating(items, minRating, maxCount) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it || !it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
    if (out.length >= maxCount) break;
  }
  return out;
}

async function hasAtLeastNByDirector(userId, directorId, n=MIN_CONTENTS) {
  const url =
    `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&` +
    `PersonIds=${encodeURIComponent(directorId)}&` +
    `Limit=1&SortBy=DateCreated&SortOrder=Descending`;
  try {
    const data = await makeApiRequest(url);
    const total = Number(data?.TotalRecordCount) || 0;
    return total >= n;
  } catch (e) {
    console.warn('directorRows: count check failed for', directorId, e);
    return false;
  }
}

async function pMapLimited(list, limit, mapper) {
  const ret = new Array(list.length);
  let i = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const cur = i++;
      ret[cur] = await mapper(list[cur], cur);
    }
  });
  await Promise.all(workers);
  return ret;
}

async function pickRandomDirectorsFromTopGenres(userId, targetCount = ROWS_COUNT) {
  const requestedPrimary = 300;
  const requestedFallback = 600;
  const fields = COMMON_FIELDS;
  const topGenres = (config.directorRowsUseTopGenres !== false)
    ? (await getCachedUserTopGenres(2).catch(()=>[]))
    : [];
  const peopleMap = new Map();

  async function scanItems(url, takeUntil) {
    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      for (const it of items) {
        const ppl = Array.isArray(it?.People) ? it.People : [];
        for (const p of ppl) {
          if (!p?.Id || !p?.Name) continue;
          if (String(p?.Type || '').toLowerCase() !== 'director') continue;
          const entry = peopleMap.get(p.Id) || { Id: p.Id, Name: p.Name, Count: 0 };
          entry.Count++;
          peopleMap.set(p.Id, entry);
          if (peopleMap.size >= takeUntil) break;
        }
        if (peopleMap.size >= takeUntil) break;
      }
    } catch (e) {
      console.warn("directorRows: people scan error:", e);
    }
  }

  if (topGenres?.length) {
    const g = encodeURIComponent(topGenres.join("|"));
    const url = `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=${requestedPrimary}&Genres=${g}`;
    await scanItems(url, targetCount * 8);
  }
  if (peopleMap.size < targetCount * 2) {
    const url = `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=${requestedFallback}`;
    await scanItems(url, targetCount * 12);
  }

  let directors = [...peopleMap.values()];
  if (!directors.length) return [];
  directors.sort((a,b)=>b.Count-a.Count);
  const head = directors.slice(0, Math.min(60, directors.length));
  const checks = await pMapLimited(head, 3, async (d) => ({ d, ok: await hasAtLeastNByDirector(userId, d.Id, MIN_CONTENTS) }));
  const eligible = checks.filter(x=>x.ok).map(x=>x.d);

  if (!eligible.length) return [];

  shuffle(eligible);
  return eligible.slice(0, targetCount);
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=(Math.random()*(i+1))|0;
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

async function fetchItemsByDirector(userId, directorId, limit = EFFECTIVE_ROW_CARD_COUNT * 2) {
  const fields = COMMON_FIELDS;

  const url =
    `/Users/${userId}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&Fields=${fields}&` +
    `PersonIds=${encodeURIComponent(directorId)}&` +
    `SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&` +
    `Limit=${Math.max(ROWS_COUNT, limit)}`;

  try {
    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const NEED = EFFECTIVE_ROW_CARD_COUNT + 1;
    return filterAndTrimByRating(items, MIN_RATING, NEED);
  } catch (e) {
    console.warn("directorRows: yönetmen içerik çekilemedi:", e);
    return [];
  }
}

async function loadDirectorsFromDbOrApi(userId) {
  const WANT = Math.max(ROWS_COUNT * 3, (STATE.maxRenderCount || MAX_RENDER_COUNT || 1000));
  const db = STATE._db;
  const scope = STATE._scope;

  if (db && scope) {
    try {
      const cached = await listDirectors(db, scope, { limit: Math.max(WANT * 4, ROWS_COUNT * 20) });

      if (cached?.length) {
        const pool = cached
          .filter(d => d && d.eligible !== false)
          .map(d => ({ Id: d.directorId, Name: d.name, Count: d.countHint || 0 }));

        shuffle(pool);

        const head = pool.slice(0, Math.min(pool.length, WANT * 2));
        const checks = await pMapLimited(head, 3, async (d) => ({
          d,
          ok: await hasAtLeastNByDirector(userId, d.Id, MIN_CONTENTS)
        }));

        const eligible = checks.filter(x => x.ok).map(x => x.d);
        try {
          for (const x of checks) {
            await upsertDirector(db, scope, {
              Id: x.d.Id,
              Name: x.d.Name,
              Count: x.d.Count || 0,
              eligible: x.ok
            });
          }
        } catch {}

        if (eligible.length) {
          return { directors: eligible.slice(0, WANT), fromCache: true };
        }
      }
    } catch (e) {
      console.warn("directorRows: DB director load failed:", e);
    }
  }

  const seen = new Set();
  const directors = [];

  for (let attempt = 0; attempt < 6 && directors.length < WANT; attempt++) {
    const need = WANT - directors.length;
    const batch = await pickRandomDirectorsFromTopGenres(userId, need);
    for (const d of batch) {
      if (!d?.Id) continue;
      if (seen.has(d.Id)) continue;
      seen.add(d.Id);
      directors.push(d);
      if (directors.length >= WANT) break;
    }
  }

  if (db && scope) {
    try {
      for (const d of directors) {
        await upsertDirector(db, scope, { Id: d.Id, Name: d.Name, Count: d.Count || 0, eligible: true });
      }
    } catch {}
  }

  return { directors: directors.slice(0, WANT), fromCache: false };
}

function getDateCreatedTicks(it) {
  const t = Number(it?.DateCreatedTicks ?? it?.dateCreatedTicks ?? 0);
  if (t) return t;

  const iso = it?.DateCreated || it?.dateCreated;
  if (!iso) return 0;

  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? (ms * 10000) : 0;
}

async function fetchItemsByIds(userId, ids, fields = COMMON_FIELDS) {
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) return [];

  const out = [];
  const chunkSize = 80;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const url =
      `/Users/${userId}/Items?` +
      `Ids=${encodeURIComponent(chunk.join(","))}` +
      `&Fields=${encodeURIComponent(fields)}`;

    try {
      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      out.push(...items);
    } catch (e) {
      console.warn("directorRows: fetchItemsByIds failed:", e);
    }
  }
  return out;
}

function extractDirectorPeople(it) {
  const ppl = Array.isArray(it?.People) ? it.People : [];
  const out = [];
  for (const p of ppl) {
    if (!p?.Id || !p?.Name) continue;
    if (String(p?.Type || "").toLowerCase() !== "director") continue;
    out.push({ Id: p.Id, Name: p.Name });
  }
  return out;
}

async function startDirectorIncrementalSync() {
  const db = STATE._db;
  const scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;

  try {
    const metaKey = `dirRows:lastSync:${scope}`;
    const last = (await getMeta(db, metaKey)) || 0;
    const fieldsMini = "People,DateCreated,DateCreatedTicks";
    const url =
      `/Users/${STATE.userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
      `&Fields=${fieldsMini}` +
      `&SortBy=DateCreated&SortOrder=Descending&Limit=200`;

    const data = await makeApiRequest(url);
    const items = Array.isArray(data?.Items) ? data.Items : [];

    let newestSeen = last;
    const newIds = [];
    const relPairs = [];

    for (const it of items) {
      const dct = getDateCreatedTicks(it);
      if (dct && dct > newestSeen) newestSeen = dct;
      if (last && dct && dct <= last) continue;

      if (it?.Id) newIds.push(it.Id);
      const dirs = extractDirectorPeople(it);
      for (const d of dirs) {
        relPairs.push({ directorId: d.Id, directorName: d.Name, itemId: it.Id });
      }
     }

    if (!newIds.length) {
      if (newestSeen && newestSeen !== last) {
        await setMeta(db, metaKey, newestSeen);
      }
      return;
    }

    const fullItems = await fetchItemsByIds(STATE.userId, newIds, COMMON_FIELDS);
    for (const it of fullItems) {
      await upsertItem(db, scope, it);
    }

    for (const r of relPairs) {
      if (!r.directorId || !r.itemId) continue;
      await upsertDirector(db, scope, { Id: r.directorId, Name: r.directorName, Count: 0, eligible: true });
      await linkDirectorItem(db, scope, r.directorId, r.itemId);
    }

    if (newestSeen && newestSeen !== last) {
      await setMeta(db, metaKey, newestSeen);
    }
  } catch (e) {
    console.warn("directorRows: incremental sync failed:", e);
  }
}

async function fetchLibraryHeadTick(userId) {
  const fields = "DateCreated,DateCreatedTicks";
  const url =
    `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
    `&Fields=${fields}` +
    `&SortBy=DateCreated&SortOrder=Descending&Limit=1`;

  try {
    const data = await makeApiRequest(url);
    const it = (Array.isArray(data?.Items) && data.Items[0]) ? data.Items[0] : null;
    return it ? getDateCreatedTicks(it) : 0;
  } catch (e) {
    console.warn("directorRows: head tick check failed:", e);
    return 0;
  }
}

async function checkAndSyncNewItems({ force = false } = {}) {
  const db = STATE._db;
  const scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;
  if (!STATE.started) return;
  if (document.hidden) return;
  if (STATE._backfillRunning) return;

  const headKey = `dirRows:lastHeadTick:${scope}`;
  const prev = Number(await getMeta(db, headKey)) || 0;
  const now = await fetchLibraryHeadTick(STATE.userId);
  if (!now) return;
  if (!force && prev && now <= prev) return;
  try { await setMeta(db, headKey, now); } catch {}
  await startDirectorIncrementalSync();
}

function __idle(cb, timeout = 1200) {
  if (typeof requestIdleCallback === "function") {
    const h = requestIdleCallback(() => cb(), { timeout });
    return { type: "ric", h };
  }
  const h = setTimeout(() => cb(), Math.min(timeout, 1200));
  return { type: "to", h };
}

function __cancelIdle(handle) {
  if (!handle) return;
  try {
    if (handle.type === "ric" && typeof cancelIdleCallback === "function") cancelIdleCallback(handle.h);
    if (handle.type === "to") clearTimeout(handle.h);
  } catch {}
}

async function runDirectorBackfillOnce({ pagesPerRun = 1, limit = 200 } = {}) {
  const db = STATE._db;
  const scope = STATE._scope;
  const userId = STATE.userId;
  if (!db || !scope || !userId) return;
  if (STATE._backfillRunning) return;

  STATE._backfillRunning = true;
  try {
    const cursorKey = `dirRows:backfillCursor:${scope}`;
    const doneKey   = `dirRows:backfillDoneAt:${scope}`;
    let startIndex  = Number(await getMeta(db, cursorKey)) || 0;

    const fields = COMMON_FIELDS;
    const perPage = Math.max(50, Math.min(400, limit | 0));
    const pages   = Math.max(1, Math.min(6, pagesPerRun | 0));

    for (let p = 0; p < pages; p++) {
      if (!STATE.started || !STATE._db || !STATE._scope) break;

      const url =
        `/Users/${userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true` +
        `&Fields=${fields}` +
        `&SortBy=DateCreated&SortOrder=Descending` +
        `&StartIndex=${startIndex}` +
        `&Limit=${perPage}`;

      const data = await makeApiRequest(url);
      const items = Array.isArray(data?.Items) ? data.Items : [];
      if (!items.length) {
        startIndex = 0;
        await setMeta(db, cursorKey, startIndex);
        await setMeta(db, doneKey, Date.now());
        break;
      }

      for (const it of items) {
        if (!it?.Id) continue;
        await upsertItem(db, scope, it);

        const ppl = Array.isArray(it?.People) ? it.People : [];
        for (const person of ppl) {
          if (!person?.Id || !person?.Name) continue;
          if (String(person?.Type || "").toLowerCase() !== "director") continue;
          await upsertDirector(db, scope, { Id: person.Id, Name: person.Name, eligible: true });
          await linkDirectorItem(db, scope, person.Id, it.Id);
        }
      }

      startIndex += items.length;
      await setMeta(db, cursorKey, startIndex);

      if (items.length < perPage) {
        startIndex = 0;
        await setMeta(db, cursorKey, startIndex);
        await setMeta(db, doneKey, Date.now());
        break;
      }
    }
  } catch (e) {
    console.warn("directorRows: backfill failed:", e);
  } finally {
    STATE._backfillRunning = false;
  }
}

function startDirectorBackfillLoop() {
  const cfg = getConfig?.() || config || {};
  const enabled = (cfg.directorRowsBackfillEnabled !== false);
  if (!enabled) return;

  if (__dirBackfillInterval) return;

  const intervalMs = Number.isFinite(cfg.directorRowsBackfillIntervalMs)
    ? Math.max(15_000, cfg.directorRowsBackfillIntervalMs | 0)
    : 45_000;

  const pagesPerRun = Number.isFinite(cfg.directorRowsBackfillPagesPerRun)
    ? Math.max(1, Math.min(6, cfg.directorRowsBackfillPagesPerRun | 0))
    : 1;

  const perPage = Number.isFinite(cfg.directorRowsBackfillLimit)
    ? Math.max(50, Math.min(400, cfg.directorRowsBackfillLimit | 0))
    : 200;

  const schedule = async () => {
    if (!STATE.started) return;
    if (!STATE._db || !STATE._scope || !STATE.userId) return;
    if (document.hidden) return;
    try {
      const doneKey = `dirRows:backfillDoneAt:${STATE._scope}`;
      const doneAt = await getMeta(STATE._db, doneKey);
      if (doneAt) {
        try { clearInterval(__dirBackfillInterval); } catch {}
        __dirBackfillInterval = null;
       return;
      }
    } catch {}
    if (__dirBackfillIdleHandle) return;

    __dirBackfillIdleHandle = __idle(async () => {
      __dirBackfillIdleHandle = null;
      await runDirectorBackfillOnce({ pagesPerRun, limit: perPage });
    }, 1500);
  };

  schedule();
  __dirBackfillInterval = setInterval(schedule, intervalMs);
}

function waitForGenreHubsDone(timeoutMs = 0) {
  try {
    const cfg = getConfig?.() || config || {};
    if (!cfg.enableGenreHubs) return Promise.resolve();
  } catch {}

  if (window.__jmsGenreHubsDone) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { document.removeEventListener("jms:genre-hubs-done", onReady); } catch {}
      try { if (t) clearTimeout(t); } catch {}
      resolve();
    };
    const onReady = () => finish();
    document.addEventListener("jms:genre-hubs-done", onReady, { once: true });
    const t = (timeoutMs && timeoutMs > 0)
      ? setTimeout(finish, Math.max(0, timeoutMs | 0))
      : null;
  });
}

export function mountDirectorRowsLazy() {
  const cfg = getConfig();
  if (!cfg.enableDirectorRows) return;
  if (!isHomeRoute()) {
    try { cleanupDirectorRows(); } catch {}
    const existing = document.getElementById('director-rows');
    if (existing) { try { existing.remove(); } catch {} }
    return;
  }

  if (cfg.enableGenreHubs && !window.__jmsGenreHubsDone) {
    if (!window.__dirRowsWaitGenreDoneBound) {
      window.__dirRowsWaitGenreDoneBound = true;
      document.addEventListener("jms:genre-hubs-done", () => {
        window.__dirRowsWaitGenreDoneBound = false;
        try { mountDirectorRowsLazy(); } catch {}
      }, { once: true });
    }
    return;
  }

  let wrap = document.getElementById('director-rows');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'director-rows';
    wrap.className = 'homeSection director-rows-wrapper';
  }

  if (!window.__dirRowsRouteGuard) {
    window.__dirRowsRouteGuard = true;
    window.addEventListener('hashchange', () => {
      if (!isHomeRoute()) {
        try { cleanupDirectorRows(); } catch {}
        const el = document.getElementById('director-rows');
        if (el) { try { el.remove(); } catch {} }
      } else {
        try { mountDirectorRowsLazy(); } catch {}
      }
    }, { passive: true });
  }

  const parent = getHomeSectionsContainer() || document.body;
  (parent || document.body).appendChild(wrap);
  try { ensureIntoHomeSections(wrap, null, { placeAfterId: cfg.enableGenreHubs ? "genre-hubs" : null }); } catch {}
  if (!cfg.enableGenreHubs) { try { pinDirectorRowsToBottom(wrap); } catch {} }

  const start = async () => {
    try {
      if (!isHomeRoute()) return;
      initAndRenderFirstBatch(wrap);
    } catch (e) {
      console.error(e);
      try { initAndRenderFirstBatch(wrap); } catch {}
    }
  };

  if (document.readyState === 'complete') {
    setTimeout(() => { start(); }, 0);
  } else {
    window.addEventListener('load', () => setTimeout(() => { start(); }, 0), { once: true });
  }
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  const apply = () => {
    const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
    if (!page) return;
    const container =
      page.querySelector(".homeSectionsContainer") ||
      document.querySelector(".homeSectionsContainer");
    if (!container) return false;

    const ref = placeAfterId ? document.getElementById(placeAfterId) : null;
    if (ref && ref.parentElement === container) {
      ref.insertAdjacentElement('afterend', el);
    } else if (el.parentElement !== container) {
      container.appendChild(el);
      try { pinDirectorRowsToBottom(el); } catch {}
    }
    return true;
  };

  if (apply()) return;

  let tries = 0;
  const maxTries = 100;
  const mo = new MutationObserver(() => {
    tries++;
    if (apply() || tries >= maxTries) { try { mo.disconnect(); } catch {} }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setTimeout(apply, 3000);
}

function getHomeSectionsContainer(indexPage) {
  const page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!page) return;
  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
  page;
}

function pinDirectorRowsToBottom(wrap) {
  if (!wrap) return;

  const moveToBottom = () => {
    const container = getHomeSectionsContainer();
    if (!container) return;
    if (wrap.parentElement !== container) {
      container.appendChild(wrap);
      return;
    }
    if (container.lastElementChild !== wrap) {
      container.appendChild(wrap);
    }
  };

  moveToBottom();

  if (wrap.__pinMO) return;
  const mo = new MutationObserver(() => moveToBottom());
  wrap.__pinMO = mo;

  mo.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('hashchange', moveToBottom, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) moveToBottom();
  }, { passive: true });
}

async function initAndRenderFirstBatch(wrap) {
  if (STATE.started) return;
  const { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE.wrapEl = wrap;
  STATE.userId = userId;
  STATE.serverId = serverId;

  try {
    STATE._db = await openDirRowsDB();
    STATE._scope = makeScope({ serverId, userId });
  } catch (e) {
    console.warn("directorRows: IndexedDB init failed:", e);
    STATE._db = null;
    STATE._scope = null;
  }

  const { directors, fromCache } = await loadDirectorsFromDbOrApi(userId);
  STATE.directors = directors || [];

  if (STATE.directors.length < ROWS_COUNT) {
    console.warn(`DirectorRows: sadece ${STATE.directors.length}/${ROWS_COUNT} yönetmen bulunabildi (kütüphane kısıtlı olabilir).`);
  }

  STATE.nextIndex = 0;
  STATE.renderedCount = 0;

  console.log(`DirectorRows: ${STATE.directors.length} yönetmen (${fromCache ? "DB cache" : "API"}) , ilk row hemen render ediliyor...`);

  const originalBatchSize = STATE.batchSize;
  STATE.batchSize = 1;
  await renderNextDirectorBatch(true);
  STATE.batchSize = originalBatchSize;

  attachDirectorScrollIdleLoader();
  if (!__dirSyncInterval) {
    await checkAndSyncNewItems({ force: true });
    __dirSyncInterval = setInterval(() => {
     if (!STATE.started) return;
      checkAndSyncNewItems().catch(()=>{});
    }, Number.isFinite(config.directorRowsNewCheckIntervalMs)
        ? Math.max(30_000, config.directorRowsNewCheckIntervalMs|0)
        : 15 * 60 * 1000);
  }
  startDirectorBackfillLoop();
}

async function renderNextDirectorBatch(immediateLoadForThisBatch = false) {
  if (STATE.loading || STATE.renderedCount >= STATE.maxRenderCount) {
    return;
  }

  if (STATE.nextIndex >= STATE.directors.length) {
    console.log('Tüm yönetmenler render edildi.');
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
    }
    return;
  }

  STATE.loading = true;
  setDirectorArrowLoading(true);
  const end = Math.min(STATE.nextIndex + STATE.batchSize, STATE.directors.length);
  const slice = STATE.directors.slice(STATE.nextIndex, end);

  console.log(`Render batch: ${STATE.nextIndex}-${end} (${slice.length} yönetmen)`);

  const prevCount = STATE.renderedCount;

  for (let idx = 0; idx < slice.length; idx++) {
    if (STATE.renderedCount >= STATE.maxRenderCount) break;

    const dir = slice[idx];
    await renderDirectorSection(dir, immediateLoadForThisBatch);
    STATE.renderedCount++;
  }

  if (!window.__directorFirstRowReady && prevCount === 0 && STATE.renderedCount > 0) {
    window.__directorFirstRowReady = true;
    try {
      document.dispatchEvent(new Event("jms:director-first-ready"));
    } catch {}
  }

  STATE.nextIndex = end;
  STATE.loading = false;
  setDirectorArrowLoading(false);

  if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
    console.log('Tüm yönetmen rowları yüklendi.');
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
      STATE.batchObserver = null;
    }
    detachDirectorScrollIdleLoader();
  }

  console.log(`Render tamamlandı. Toplam: ${STATE.renderedCount}/${STATE.directors.length} yönetmen`);
}

function getDirectorUrl(directorId, directorName, serverId) {
  return `#/details?id=${directorId}&serverId=${encodeURIComponent(serverId)}`;
}

function buildDirectorTitle(name) {
  const lbl = (getConfig()?.languageLabels || {}).showDirector || "Director {name}";
  const safeName = escapeHtml(name || "");
  if (lbl.includes("{name}")) {
    return lbl.replace("{name}", safeName);
  }
  return `${escapeHtml(lbl)} ${safeName}`;
}

function renderDirectorSection(dir, immediateLoad = false) {
  const section = document.createElement('section');
  section.className = 'dir-row-section';

  const title = document.createElement('div');
  title.className = 'sectionTitleContainer sectionTitleContainer-cards';
  const dirTitleText = buildDirectorTitle(dir.Name);
  title.innerHTML = `
    <h2 class="sectionTitle sectionTitle-cards dir-row-title">
      <span class="dir-row-title-text" role="button" tabindex="0"
        aria-label="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}: ${dirTitleText}">
        ${dirTitleText}
      </span>
      <div class="dir-row-see-all"
           aria-label="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}"
           title="${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}">
        <span class="material-icons">keyboard_arrow_right</span>
      </div>
      <span class="dir-row-see-all-tip">${(labels.seeAll || config.languageLabels?.seeAll || 'Tümünü gör')}</span>
    </h2>
  `;

  const titleBtn = title.querySelector('.dir-row-title-text');
  const seeAllBtn = title.querySelector('.dir-row-see-all');

  if (titleBtn) {
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    };
    titleBtn.addEventListener('click', open, { passive: false });
    titleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }

  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    }, { passive: false });
  }

  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'personal-recs-scroll-wrap';

  const heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';

  const btnL = document.createElement('button');
  btnL.className = 'hub-scroll-btn hub-scroll-left';
  btnL.setAttribute('aria-label', (config.languageLabels?.scrollLeft) || "Sola kaydır");
  btnL.setAttribute('aria-disabled', 'true');
  btnL.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;

  const row = document.createElement('div');
  row.className = 'itemsContainer personal-recs-row';
  row.setAttribute('role', 'list');

  const btnR = document.createElement('button');
  btnR.className = 'hub-scroll-btn hub-scroll-right';
  btnR.setAttribute('aria-label', (config.languageLabels?.scrollRight) || "Sağa kaydır");
  btnR.setAttribute('aria-disabled', 'true');
  btnR.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`;

  scrollWrap.appendChild(btnL);
  scrollWrap.appendChild(row);
  scrollWrap.appendChild(btnR);

  section.appendChild(title);
  section.appendChild(heroHost);
  section.appendChild(scrollWrap);

  if (STATE._loadMoreArrow && STATE._loadMoreArrow.parentElement === STATE.wrapEl) {
    STATE.wrapEl.insertBefore(section, STATE._loadMoreArrow);
  } else {
    STATE.wrapEl.appendChild(section);
  }
  row.innerHTML = `<div class="dir-row-loading">${(config.languageLabels?.loadingText) || 'Yükleniyor…'}</div>`;
  fillRowWhenReady(row, dir, heroHost);
}

function uniqById(list) {
  const seen = new Set();
  const out = [];
  for (const it of list || []) {
    if (!it?.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
  }
  return out;
}

function fillRowWhenReady(row, dir, heroHost){
  (async () => {
    try {
      const NEED = EFFECTIVE_ROW_CARD_COUNT + 1;

      let items = [];

      if (STATE._db && STATE._scope) {
        try {
          items = await getItemsForDirector(
            STATE._db,
            STATE._scope,
            dir.Id,
            NEED
          );
        } catch (e) {
          console.warn("directorRows: getItemsForDirector failed:", e);
        }
      }

      if ((items?.length || 0) < NEED) {
        const apiItems = await fetchItemsByDirector(
          STATE.userId,
          dir.Id,
          Math.max(NEED * 3, EFFECTIVE_ROW_CARD_COUNT * 2)
        );

        items = uniqById([...(items || []), ...(apiItems || [])]);

        if (items?.length && STATE._db && STATE._scope) {
          try {
            for (const it of items) {
              await upsertItem(STATE._db, STATE._scope, it);
              await linkDirectorItem(STATE._db, STATE._scope, dir.Id, it.Id);
            }
            await upsertDirector(STATE._db, STATE._scope, {
              Id: dir.Id,
              Name: dir.Name,
              Count: dir.Count || 0,
              eligible: true
            });
          } catch (e) {
            console.warn("directorRows: DB write-through failed:", e);
          }
        }
      }

      if (!items?.length) {
        row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || (labels.noRecommendations || "Uygun içerik yok")}</div>`;
        if (heroHost) heroHost.innerHTML = "";
        setupScroller(row);
        return;
      }

      const pool = items.slice();
      const best = pickBestItemByRating(pool) || pool[0] || null;
      const remaining = best ? pool.filter(x => x?.Id !== best.Id) : pool;

      if (heroHost && best) {
        heroHost.innerHTML = "";
        heroHost.appendChild(createDirectorHeroCard(best, STATE.serverId, dir.Name));
      }

      row.innerHTML = "";

      if (!remaining?.length) {
        row.innerHTML = `<div class="no-recommendations">${(config.languageLabels?.noRecommendations) || (labels.noRecommendations || "Uygun içerik yok")}</div>`;
        setupScroller(row);
        return;
      }

      const initialCount = IS_MOBILE ? 3 : 4;
      const fragment = document.createDocumentFragment();

      for (let i = 0; i < Math.min(initialCount, remaining.length); i++) {
        fragment.appendChild(createRecommendationCard(remaining[i], STATE.serverId, i < 2));
      }
      row.appendChild(fragment);

      let currentIndex = initialCount;

      const pumpMore = () => {
        if (currentIndex >= remaining.length || row.childElementCount >= EFFECTIVE_ROW_CARD_COUNT) {
          setupScroller(row);
          return;
        }

        const chunkSize = IS_MOBILE ? 1 : 2;
        const frag = document.createDocumentFragment();

        for (let i = 0; i < chunkSize && currentIndex < remaining.length; i++) {
          if (row.childElementCount >= EFFECTIVE_ROW_CARD_COUNT) break;
          frag.appendChild(createRecommendationCard(remaining[currentIndex], STATE.serverId, false));
          currentIndex++;
        }

        row.appendChild(frag);
        try { row.dispatchEvent(new Event('scroll')); } catch {}
        setTimeout(pumpMore, 100);
      };

      setTimeout(pumpMore, 200);

    } catch (error) {
      console.error('Yönetmen içerik yükleme hatası:', error);
      row.innerHTML = `<div class="no-recommendations">Yüklenemedi</div>`;
      setupScroller(row);
    }
  })();
}

export function cleanupDirectorRows() {
  try {
    detachDirectorScrollIdleLoader();
    STATE.batchObserver?.disconnect();
    STATE.sectionIOs.forEach(io => io.disconnect());
    STATE.sectionIOs.clear();

    if (__dirSyncInterval) {
      try { clearInterval(__dirSyncInterval); } catch {}
      __dirSyncInterval = null;
    }

    if (__dirBackfillInterval) {
      try { clearInterval(__dirBackfillInterval); } catch {}
      __dirBackfillInterval = null;
    }
    if (__dirBackfillIdleHandle) {
      try { __cancelIdle(__dirBackfillIdleHandle); } catch {}
      __dirBackfillIdleHandle = null;
    }

    if (STATE.wrapEl) {
      STATE.wrapEl.querySelectorAll('.personal-recs-card').forEach(card => {
        card.dispatchEvent(new CustomEvent('jms:cleanup'));
      });
    }
    Object.keys(STATE).forEach(key => {
      if (key !== 'maxRenderCount') {
        STATE[key] = Array.isArray(STATE[key]) ? [] :
                    typeof STATE[key] === 'number' ? 0 :
                    typeof STATE[key] === 'boolean' ? false : null;
      }
    });
    STATE.sectionIOs = new Set();
    STATE.autoPumpScheduled = false;
    STATE._db = null;
    STATE._scope = null;

  } catch (e) {
    console.warn('Director rows cleanup error:', e);
  }
}

function clampText(s, max = 220) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 1) + "…") : t;
}

function escapeHtml(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
