import { makeApiRequest, getSessionInfo, getCachedUserTopGenres } from "./api.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

const COMMON_FIELDS = [
  "PrimaryImageAspectRatio",
  "ImageTags",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
].join(",");

function makeItemKey(it) {
  const id  = it?.Id ? String(it.Id) : "";
  const nm  = (it?.Name || "").trim().toLowerCase();
  const yr  = it?.ProductionYear || "";
  const pt  = (it?.ImageTags?.Primary || it?.PrimaryImageTag || "");
  return `${id}::${nm}|${yr}::${pt}`;
}

function buildPosterUrl(item, height = 540, quality = 72) {
  const tag = item.ImageTags?.Primary || item.PrimaryImageTag;
  if (!tag) return null;
  return withServer(
    `/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxHeight=${height}&quality=${quality}&EnableImageEnhancers=false`
  );
}
function buildPosterUrlLQ(item) { return buildPosterUrl(item, 120, 25); }
function buildPosterUrlHQ(item) { return buildPosterUrl(item, 540, 72); }

function buildPosterSrcSet(item) {
  const hs = [240, 360, 540, 720];
  const q  = 50;
  const ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  return hs.map(h => `${buildPosterUrl(item, h, q)} ${Math.round(h * ar)}w`).join(", ");
}

function getDetailsUrl(itemId, serverId) {
  return `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}`;
}

function buildLogoUrl(item, width = 220, quality = 72) {
  const tag = item.ImageTags?.Logo || item.LogoImageTag;
  if (!tag) return null;
  return withServer(
    `/Items/${item.Id}/Images/Logo?tag=${encodeURIComponent(tag)}&width=${width}&quality=${quality}`
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function formatRuntime(ticks) {
  if (!ticks) return null;
  const minutes = Math.floor(ticks / 600000000);
  if (minutes < 60) return `${minutes}d`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}s ${remainingMinutes}d` : `${hours}s`;
}
function normalizeAgeChip(rating) {
  if (!rating) return null;
  const r = String(rating).toUpperCase().trim();
  if (/(18\+|R18|ADULT|NC-17|X-RATED|XXX|ADULTS ONLY|AO)/.test(r)) return "18+";
  if (/(17\+|R|TV-MA)/.test(r)) return "17+";
  if (/(16\+|R16|M|MATURE)/.test(r)) return "16+";
  if (/(15\+|TV-15)/.test(r)) return "15+";
  if (/(13\+|TV-14|PG-13|TEEN)/.test(r)) return "13+";
  if (/(12\+|TV-12)/.test(r)) return "12+";
  if (/(10\+|TV-Y10)/.test(r)) return "10+";
  if (/(7\+|TV-Y7|E10\+|E10)/.test(r)) return "7+";
  if (/(G|PG|TV-G|TV-PG|E|EVERYONE|U|UC|UNIVERSAL)/.test(r)) return "7+";
  if (/(ALL AGES|ALL|TV-Y|KIDS|Y)/.test(r)) return "0+";
  return r;
}
function getRuntimeWithIcons(runtime) {
  const cfg = getConfig() || {};
  if (!runtime) return '';
  return runtime
    .replace(/(\d+)s/g, `$1${cfg.languageLabels?.sa || 'sa'}`)
    .replace(/(\d+)d/g, `$1${cfg.languageLabels?.dk || 'dk'}`);
}

const PLACEHOLDER_URL = (getConfig()?.placeholderImage) || './slider/src/images/placeholder.png';

let __scrollActive = false;
let __scrollIdleTimer = 0;

const HYDRATION_PER_FRAME = 12;
let __hydrationQueue = [];
let __hydrationRAF = 0;

function queueHydration(fn) {
  __hydrationQueue.push(fn);
  if (!__hydrationRAF) {
    __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
  }
}

function flushHydrationFrame() {
  __hydrationRAF = 0;
  if (__scrollActive) {
    return;
  }
  let budget = HYDRATION_PER_FRAME;
  while (budget-- > 0 && __hydrationQueue.length) {
    const fn = __hydrationQueue.shift();
    try { fn && fn(); } catch {}
  }
  if (__hydrationQueue.length) {
    __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
  }
}

const __imgIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    const img = ent.target;
    const data = img.__data || {};
    if (ent.isIntersecting) {
      if (!img.__hiRequested) {
        img.__hiRequested = true;
        img.__phase = 'hi';
        queueHydration(() => {
          if (!img.isConnected) return;
          if (data.hqSrcset) img.srcset = data.hqSrcset;
          if (data.hqSrc)    img.src    = data.hqSrc;
        });
      }
    } else {
      try { img.removeAttribute('srcset'); } catch {}
      if (data.lqSrc && img.src !== data.lqSrc) img.src = data.lqSrc;
      img.__phase = 'lq';
      img.__hiRequested = false;
      img.classList.add('is-lqip');
      img.__hydrated = false;
    }
  }
}, { rootMargin: '600px 0px' });

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  const fb = fallback || PLACEHOLDER_URL;
  img.__data = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;

  try { img.removeAttribute('srcset'); } catch {}
  if (lqSrc) {
    if (img.src !== lqSrc) img.src = lqSrc;
  } else {
    img.src = fb;
  }
  img.classList.add('is-lqip');
  img.__hydrated = false;

  const onError = () => {
    if (img.__phase === 'hi') {
      try { img.removeAttribute('srcset'); } catch {}
      if (lqSrc) {
        if (img.src !== lqSrc) img.src = lqSrc;
      } else {
        img.src = fb;
      }
      img.classList.add('is-lqip');
      img.__phase = 'lq';
      img.__hiRequested = false;
    }
  };
  const onLoad = () => {
    if (img.__phase === 'hi') {
      img.classList.remove('is-lqip');
      img.__hydrated = true;
    }
  };
  img.__onErr = onError;
  img.__onLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  __imgIO.observe(img);
}
function unobserveImage(img) {
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr;
  delete img.__onLoad;
  if (img) { img.removeAttribute('srcset'); }
}

function injectGEPerfStyles() {
  if (document.getElementById('ge-perf-css')) return;
  const st = document.createElement('style');
  st.id = 'ge-perf-css';
  st.textContent = `
    .genre-explorer-overlay { will-change: opacity; }
    .genre-explorer { contain: layout paint size; }
    .ge-card {
      content-visibility: auto;
      contain-intrinsic-size: 320px 214px;
    }
    .ge-card .cardImage {
      content-visibility: auto;
      contain-intrinsic-size: 240px 160px;
    }
    .ge-card .cardBox { will-change: transform; }
    .ge-card .cardBox:hover { transform: translateZ(0) scale(1.01); }
  `;
  document.head.appendChild(st);
}

let __overlay = null;
let __abort = null;
let __busy = false;
let __startIndex = 0;
let __genre = "";
let __serverId = "";
let __io = null;
let __originPoint = null;
let __isClosing = false;

const MAX_CARDS = 600;
function pruneGridIfNeeded() {
  const grid = __overlay?.querySelector('.ge-grid');
  if (!grid) return;
  const extra = grid.children.length - MAX_CARDS;
  if (extra > 0) {
    for (let i = 0; i < extra; i++) {
      const el = grid.firstElementChild;
      if (!el) break;
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
      el.remove();
    }
  }
}

(function bindGlobalPointerOrigin(){
  if (window.__jmsPointerOriginBound) return;
  window.__jmsPointerOriginBound = true;
  document.addEventListener('pointerdown', (e) => {
    try { __originPoint = { x: e.clientX, y: e.clientY }; } catch {}
  }, { capture: true, passive: true });
})();


export function openGenreExplorer(genre) {
  if (__overlay) { try { closeGenreExplorer(true); } catch {} }

  __genre = String(genre || "").trim();
  const { serverId } = getSessionInfo();
  __serverId = serverId;
  __startIndex = 0;

  __overlay = document.createElement('div');
  __overlay.className = 'genre-explorer-overlay';
  __overlay.innerHTML = `
    <div class="genre-explorer" role="dialog" aria-modal="true" aria-label="Genre Explorer">
      <div class="ge-header">
        <div class="ge-title">
          ${escapeHtml(__genre)} • ${(getConfig()?.languageLabels?.all) || "Tümü"}
        </div>
        <div class="ge-actions">
          <button class="ge-close" aria-label="${(getConfig()?.languageLabels?.close) || "Kapat"}">✕</button>
        </div>
      </div>
      <div class="ge-content">
        <div class="ge-grid" role="list"></div>
        <div class="ge-empty" style="display:none">
          ${(getConfig()?.languageLabels?.noResults) || "İçerik bulunamadı"}
        </div>
        <div class="ge-sentinel"></div>
      </div>
    </div>
  `;
  document.body.appendChild(__overlay);
  injectGEPerfStyles();
  try { playOpenAnimation(__overlay); } catch {}
  const grid = __overlay.querySelector('.ge-grid');
  grid.addEventListener('click', (e) => {
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('hashchange', hashCloser, { passive: true });

  __overlay.querySelector('.ge-close').addEventListener('click', () => animatedCloseThen(), { passive:true });
  __overlay.addEventListener('click', (e) => {
    if (e.target === __overlay) animatedCloseThen();
  }, { passive:true });
  document.addEventListener('keydown', escCloser, { passive:true });
  const scroller = __overlay.querySelector('.ge-content');
  const onScrollPerf = () => {
    __scrollActive = true;
    if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
    __scrollIdleTimer = setTimeout(() => {
      __scrollActive = false;
      if (!__hydrationRAF && __hydrationQueue.length) {
        __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
      }
    }, 120);
  };
  scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  __overlay.__onScrollPerf = onScrollPerf;
  loadMore();

  const sentinel = __overlay.querySelector('.ge-sentinel');
  __io = new IntersectionObserver((ents)=>{
    for (const ent of ents) {
      if (ent.isIntersecting) loadMore();
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  __io.observe(sentinel);
}

let __d_overlay = null;
let __d_abort = null;
let __d_busy = false;
let __d_startIndex = 0;
let __d_serverId = "";
let __d_io = null;
let __d_originPoint = null;
let __d_isClosing = false;
let __d_person = { Id: "", Name: "" };

function d_playOpenAnimation(overlayEl) {
  const sheet = overlayEl;
  const dialog = overlayEl.querySelector('.genre-explorer');
  const origin = __d_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = `${origin.x}px ${origin.y}px`;
  sheet.animate([{opacity:0},{opacity:1}], {duration:220, easing:'ease-out', fill:'both'});
  dialog.animate([{transform:'scale(0.84)',opacity:0},{transform:'scale(1)',opacity:1}], {duration:280, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
}

function d_animatedCloseThen(cb) {
  if (!__d_overlay || __d_isClosing) { if (cb) cb(); return; }
  __d_isClosing = true;
  const sheet = __d_overlay;
  const dialog = __d_overlay.querySelector('.genre-explorer');
  const origin = __d_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = `${origin.x}px ${origin.y}px`;

  const a = sheet.animate([{opacity:1},{opacity:0}], {duration:180, easing:'ease-in', fill:'forwards'});
  const b = dialog.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0.84)',opacity:0}], {duration:220, easing:'cubic-bezier(.4,0,.6,1)', fill:'forwards'});

  const done = () => { if (cb) try{cb();}catch{}; if (__d_overlay) try{closeDirectorExplorer(true);}catch{} };
  let fin = 0; const mark=()=>{ if(++fin>=2) done(); };
  a.addEventListener('finish', mark, {once:true});
  b.addEventListener('finish', mark, {once:true});
  setTimeout(mark, 260);
}

function d_escCloser(e){ if (e.key === 'Escape') d_animatedCloseThen(); }
function d_hashCloser(){ d_animatedCloseThen(); }

function d_renderIntoGrid(items){
  const grid = __d_overlay.querySelector('.ge-grid');
  const empty = __d_overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(createCardFor(it));
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

async function d_loadMore() {
  if (!__d_overlay || __d_busy) return;
  __d_busy = true;

  if (__d_abort) { try { __d_abort.abort(); } catch {} }
  __d_abort = new AbortController();

  const LIMIT = 40;
  const { userId } = getSessionInfo();
  const params = new URLSearchParams();
  params.set("IncludeItemTypes", "Movie,Series");
  params.set("Recursive", "true");
  params.set("Fields", COMMON_FIELDS);
  params.set("SortBy", "CommunityRating,DateCreated");
  params.set("SortOrder", "Descending");
  params.set("Limit", String(LIMIT));
  params.set("StartIndex", String(__d_startIndex));
  params.set("PersonIds", __d_person.Id);

  const url = `/Users/${encodeURIComponent(userId)}/Items?` + params.toString();

  try {
    const data = await makeApiRequest(url, { signal: __d_abort.signal });
    const items = Array.isArray(data?.Items) ? data.Items : [];
    d_renderIntoGrid(items);
    __d_startIndex += items.length;
    if (items.length < LIMIT) { try { __d_io?.disconnect(); } catch {} }
  } catch (e) {
    if (e?.name !== 'AbortError') console.error("Director explorer fetch error:", e);
  } finally {
    __d_busy = false;
  }
}

export function openDirectorExplorer(person) {
  if (__d_overlay) { try { closeDirectorExplorer(true); } catch {} }

  __d_person = { Id: String(person?.Id || ""), Name: String(person?.Name || "") };
  const { serverId } = getSessionInfo();
  __d_serverId = serverId;
  __d_startIndex = 0;

  __d_overlay = document.createElement('div');
  __d_overlay.className = 'genre-explorer-overlay';
  __d_overlay.innerHTML = `
    <div class="genre-explorer" role="dialog" aria-modal="true" aria-label="Director Explorer">
      <div class="ge-header">
        <div class="ge-title">
          ${escapeHtml(__d_person.Name)} • ${(getConfig()?.languageLabels?.all) || "Tümü"}
        </div>
        <div class="ge-actions">
          <button class="ge-close" aria-label="${(getConfig()?.languageLabels?.close) || "Kapat"}">✕</button>
        </div>
      </div>
      <div class="ge-content">
        <div class="ge-grid" role="list"></div>
        <div class="ge-empty" style="display:none">
          ${(getConfig()?.languageLabels?.noResults) || "İçerik bulunamadı"}
        </div>
        <div class="ge-sentinel"></div>
      </div>
    </div>
  `;
  document.body.appendChild(__d_overlay);
  injectGEPerfStyles();
  try { d_playOpenAnimation(__d_overlay); } catch {}

  const grid = __d_overlay.querySelector('.ge-grid');
  grid.addEventListener('click', (e) => {
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => d_animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => d_animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('hashchange', d_hashCloser, { passive: true });
  __d_overlay.querySelector('.ge-close').addEventListener('click', () => d_animatedCloseThen(), { passive:true });
  __d_overlay.addEventListener('click', (e) => { if (e.target === __d_overlay) d_animatedCloseThen(); }, { passive:true });
  document.addEventListener('keydown', d_escCloser, { passive:true });
  const scroller = __d_overlay.querySelector('.ge-content');
  const onScrollPerf = () => {
    __scrollActive = true;
    if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
    __scrollIdleTimer = setTimeout(() => {
      __scrollActive = false;
      if (!__hydrationRAF && __hydrationQueue.length) {
        __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
      }
    }, 120);
  };
  scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  __d_overlay.__onScrollPerf = onScrollPerf;

  d_loadMore();
  const sentinel = __d_overlay.querySelector('.ge-sentinel');
  __d_io = new IntersectionObserver((ents)=>{
    for (const ent of ents) {
      if (ent.isIntersecting) d_loadMore();
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  __d_io.observe(sentinel);
}

export function closeDirectorExplorer(skipAnimation = false) {
  if (!__d_overlay) return;
  try { document.removeEventListener('keydown', d_escCloser); } catch {}
  try { window.removeEventListener('hashchange', d_hashCloser); } catch {}
  try { __d_io?.disconnect(); } catch {}
  __d_io = null;
  if (__d_abort) { try { __d_abort.abort(); } catch {} __d_abort = null; }

  const cleanup = () => {
    try {
      const scroller = __d_overlay.querySelector('.ge-content');
      scroller?.removeEventListener('scroll', __d_overlay.__onScrollPerf);
      __d_overlay.__onScrollPerf = null;
    } catch {}
    __d_overlay?.remove();
    __d_overlay = null;
    __d_busy = false;
    __d_startIndex = 0;
    __d_isClosing = false;
    __d_person = { Id: "", Name: "" };
  };

  if (skipAnimation) { cleanup(); return; }
  d_animatedCloseThen(cleanup);
}

export function closeGenreExplorer(skipAnimation = false) {
  if (!__overlay) return;
  try { document.removeEventListener('keydown', escCloser); } catch {}
  try { window.removeEventListener('hashchange', hashCloser); } catch {}

  try {
    const scroller = __overlay.querySelector('.ge-content');
    scroller?.removeEventListener('scroll', __overlay.__onScrollPerf);
    __overlay.__onScrollPerf = null;
  } catch {}

  try { __io?.disconnect(); } catch {}
  __io = null;
  if (__abort) { try { __abort.abort(); } catch {} __abort = null; }

  const cleanup = () => {
    __overlay?.remove();
    __overlay = null;
    __busy = false;
    __startIndex = 0;
    __genre = "";
    __isClosing = false;
  };

  if (skipAnimation) {
    cleanup();
    return;
  }
  animatedCloseThen(cleanup);
}

function playOpenAnimation(overlayEl) {
  const sheet = overlayEl;
  const dialog = overlayEl.querySelector('.genre-explorer');
  const origin = __originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };

  const setOrigin = (el) => { el.style.transformOrigin = `${origin.x}px ${origin.y}px`; };
  setOrigin(dialog);

  sheet.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 220, easing: 'ease-out', fill: 'both' }
  );

  dialog.animate(
    [{ transform: 'scale(0.84)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
  );
}

function animatedCloseThen(cb) {
  if (!__overlay || __isClosing) { if (cb) cb(); return; }
  __isClosing = true;
  const sheet = __overlay;
  const dialog = __overlay.querySelector('.genre-explorer');
  const origin = __originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };

  const setOrigin = (el) => { el.style.transformOrigin = `${origin.x}px ${origin.y}px`; };
  setOrigin(dialog);

  const sheetAnim = sheet.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' }
  );
  const dlgAnim = dialog.animate(
    [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.84)', opacity: 0 }],
    { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }
  );

  const done = () => {
    if (cb) { try { cb(); } catch {} }
    if (__overlay) { try { closeGenreExplorer(true); } catch {} }
  };

  let finished = 0;
  const mark = () => { finished++; if (finished >= 2) done(); };
  sheetAnim.addEventListener('finish', mark, { once: true });
  dlgAnim.addEventListener('finish', mark, { once: true });
  setTimeout(mark, 260);
}

function escCloser(e){ if (e.key === 'Escape') animatedCloseThen(); }
function hashCloser(){ animatedCloseThen(); }

async function loadMore() {
  if (!__overlay || __busy) return;
  __busy = true;

  if (__abort) { try { __abort.abort(); } catch {} }
  __abort = new AbortController();

  const LIMIT = 40;
  const { userId } = getSessionInfo();
  const url =
    `/Users/${encodeURIComponent(userId)}/Items?` +
    `IncludeItemTypes=Movie,Series&Recursive=true&` +
    `Genres=${encodeURIComponent(__genre)}&Fields=${COMMON_FIELDS}&` +
    `SortBy=CommunityRating,DateCreated&SortOrder=Descending&Limit=${LIMIT}&StartIndex=${__startIndex}`;

  try {
    const data = await makeApiRequest(url, { signal: __abort.signal });
    const items = Array.isArray(data?.Items) ? data.Items : [];
    renderIntoGrid(items);
    __startIndex += items.length;
    if (items.length < LIMIT) { try { __io?.disconnect(); } catch {} }
  } catch (e) {
    if (e?.name !== 'AbortError') console.error("Genre explorer fetch error:", e);
  } finally {
    __busy = false;
  }
}

function renderIntoGrid(items){
  const grid = __overlay.querySelector('.ge-grid');
  const empty = __overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const card = createCardFor(it);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

function createCardFor(item) {
  const serverId = __serverId || __p_serverId || "";
  const posterUrlHQ = buildPosterUrlHQ(item);
  const posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  const posterUrlLQ = buildPosterUrlLQ(item);
  const isSeries = item.Type === "Series";
  const cfg = getConfig() || {};
  const typeLabel = isSeries
    ? ((cfg.languageLabels && cfg.languageLabels.dizi) || "Dizi")
    : ((cfg.languageLabels && cfg.languageLabels.film) || "Film");
  const typeIcon = isSeries ? 'live_tv' : 'movie';

  const ageChip = normalizeAgeChip(item.OfficialRating || "");
  const year = item.ProductionYear || "";
  const runtimeTicks = isSeries ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  const runtime = formatRuntime(runtimeTicks);
  const runtimeText = runtime ? getRuntimeWithIcons(runtime) : "";
  const genresText = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  const community = Number.isFinite(item.CommunityRating)
    ? `<div class="community-rating" title="Community Rating">⭐ ${Number(item.CommunityRating).toFixed(1)}</div>`
    : "";

  const a = document.createElement('a');
  a.className = 'card ge-card personal-recs-card';
  a.href = getDetailsUrl(item.Id, serverId);
  a.setAttribute('role','listitem');
  a.dataset.itemId = item.Id;
  a.setAttribute('data-key', makeItemKey(item));

  a.innerHTML = `
    <div class="cardBox">
      <div class="cardImageContainer">
        <img class="cardImage" alt="${escapeHtml(item.Name)}" loading="lazy" decoding="async">
        <div class="prc-top-badges">
          ${community}
          <div class="prc-type-badge">
            <span class="prc-type-icon material-icons">${typeIcon}</span>
          </div>
        </div>
        <div class="prc-gradient"></div>
        <div class="prc-overlay">
          <div class="prc-meta">
            ${ageChip ? `<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>` : ""}
            ${year ? `<span class="prc-year">${year}</span><span class="prc-dot">•</span>` : ""}
            ${runtimeText ? `<span class="prc-runtime">${runtimeText}</span>` : ""}
          </div>
          ${genresText ? `<div class="prc-genres">${escapeHtml(genresText)}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  const img = a.querySelector('.cardImage');
  try { img.setAttribute('sizes', '(max-width: 640px) 45vw, (max-width: 1200px) 22vw, 220px'); } catch {}
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
      (cfg.languageLabels && (cfg.languageLabels.noImage || cfg.languageLabels.loadingText))
      || 'Görsel yok';
    noImg.style.minHeight = '220px';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    a.querySelector('.cardImageContainer')?.prepend(noImg);
  }

  a.addEventListener('jms:cleanup', () => {
    unobserveImage(img);
  }, { once: true });

  return a;
}


let __p_overlay = null;
let __p_abort = null;
let __p_busy = false;
let __p_startIndex = 0;
let __p_serverId = "";
let __p_io = null;
let __p_originPoint = null;
let __p_isClosing = false;
let __p_seenIds = new Set();
let __p_seenKeys = new Set();

async function p_fetchTopGenreSample(userId, limit = 30) {
  let genres = [];
  try { genres = await getCachedUserTopGenres(3); } catch {}
  const params = new URLSearchParams();
  params.set("IncludeItemTypes", "Movie,Series");
  params.set("Recursive", "true");
  params.set("Filters", "IsUnplayed");
  params.set("Fields", COMMON_FIELDS);
  params.set("SortBy", "Random,CommunityRating,DateCreated");
  params.set("SortOrder", "Descending");
  params.set("Limit", "180");

  if (genres && genres.length) {
    params.set("Genres", genres.join("|"));
  }

  const url = `/Users/${encodeURIComponent(userId)}/Items?` + params.toString();
  const data = await makeApiRequest(url);
  const items = Array.isArray(data?.Items) ? data.Items : [];

  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = makeItemKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

function p_playOpenAnimation(overlayEl) {
  const sheet = overlayEl;
  const dialog = overlayEl.querySelector('.genre-explorer');
  const origin = __p_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = `${origin.x}px ${origin.y}px`;
  sheet.animate([{opacity:0},{opacity:1}], {duration:220, easing:'ease-out', fill:'both'});
  dialog.animate([{transform:'scale(0.84)',opacity:0},{transform:'scale(1)',opacity:1}], {duration:280, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
}

function p_animatedCloseThen(cb) {
  if (!__p_overlay || __p_isClosing) { if (cb) cb(); return; }
  __p_isClosing = true;
  const sheet = __p_overlay;
  const dialog = __p_overlay.querySelector('.genre-explorer');
  const origin = __p_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = `${origin.x}px ${origin.y}px`;

  const a = sheet.animate([{opacity:1},{opacity:0}], {duration:180, easing:'ease-in', fill:'forwards'});
  const b = dialog.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0.84)',opacity:0}], {duration:220, easing:'cubic-bezier(.4,0,.6,1)', fill:'forwards'});
  const done = () => { if (cb) try{cb();}catch{}; if (__p_overlay) try{closePersonalExplorer(true);}catch{} };
  let fin = 0; const mark=()=>{ if(++fin>=2) done(); };
  a.addEventListener('finish', mark, {once:true}); b.addEventListener('finish', mark, {once:true}); setTimeout(mark,260);
}

function p_escCloser(e){ if (e.key === 'Escape') p_animatedCloseThen(); }
function p_hashCloser(){ p_animatedCloseThen(); }

async function p_loadMore() {
  if (!__p_overlay || __p_busy) return;
  __p_busy = true;

  if (__p_abort) { try { __p_abort.abort(); } catch {} }
  __p_abort = new AbortController();

  const LIMIT = 40;
  const { userId } = getSessionInfo();
  let genres = [];
  try {
    genres = await getCachedUserTopGenres(3);
  } catch {}

  const params = new URLSearchParams();
params.set("IncludeItemTypes", "Movie,Series");
params.set("Recursive", "true");
params.set("Filters", "IsUnplayed");
params.set("Fields", COMMON_FIELDS);
params.set("SortBy", "CommunityRating,DateCreated");
params.set("SortOrder", "Descending");
params.set("Limit", String(LIMIT));
params.set("StartIndex", String(__p_startIndex));

if (genres && genres.length) {
  params.set("Genres", genres.join("|"));
}

const url = `/Users/${encodeURIComponent(userId)}/Items?` + params.toString();

  try {
    const data = await makeApiRequest(url, { signal: __p_abort.signal });
    let items = Array.isArray(data?.Items) ? data.Items : [];
    const unique = [];
    for (const it of items) {
      if (!it?.Id) continue;
      const k = makeItemKey(it);
      if (__p_seenKeys.has(k)) continue;
      __p_seenKeys.add(k);
      __p_seenIds.add(it.Id);
      unique.push(it);
    }
    p_renderIntoGrid(unique);
    __p_startIndex += items.length;
    if (items.length < LIMIT) { try { __p_io?.disconnect(); } catch {} }
  } catch (e) {
    if (e?.name !== 'AbortError') console.error("Personal explorer fetch error:", e);
  } finally {
    __p_busy = false;
  }
}

function p_renderIntoGrid(items){
  const grid = __p_overlay.querySelector('.ge-grid');
  const empty = __p_overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(createCardFor(it));
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

export function openPersonalExplorer() {
  if (__p_overlay) { try { closePersonalExplorer(true); } catch {} }

  const { serverId, userId } = getSessionInfo();
  __p_serverId = serverId;
  __p_overlay = document.createElement('div');
  __p_overlay.className = 'genre-explorer-overlay';
  __p_overlay.innerHTML = `
    <div class="genre-explorer" role="dialog" aria-modal="true" aria-label="Personal Explorer">
      <div class="ge-header">
        <div class="ge-title">
          ${(getConfig()?.languageLabels?.personalRecommendations) || "Sana Özel Öneriler"} • ${(getConfig()?.languageLabels?.all) || "Tümü"}
        </div>
        <div class="ge-actions">
          <button class="ge-close" aria-label="${(getConfig()?.languageLabels?.close) || "Kapat"}">✕</button>
        </div>
      </div>
      <div class="ge-content">
        <div class="ge-grid" role="list"></div>
        <div class="ge-empty" style="display:none">
          ${(getConfig()?.languageLabels?.noResults) || "İçerik bulunamadı"}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(__p_overlay);
  injectGEPerfStyles();
  try { p_playOpenAnimation(__p_overlay); } catch {}

  const grid = __p_overlay.querySelector('.ge-grid');
  grid.addEventListener('click', (e) => {
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => p_animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = e.target.closest('a.ge-card');
    if (!a) return;
    requestAnimationFrame(() => p_animatedCloseThen(() => {
      try { window.location.hash = a.getAttribute('href').slice(1); } catch {}
    }));
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('hashchange', p_hashCloser, { passive: true });
  __p_overlay.querySelector('.ge-close').addEventListener('click', () => p_animatedCloseThen(), { passive:true });
  __p_overlay.addEventListener('click', (e) => { if (e.target === __p_overlay) p_animatedCloseThen(); }, { passive:true });
  document.addEventListener('keydown', p_escCloser, { passive:true });

  (async () => {
    try {
      const items = await p_fetchTopGenreSample(userId, 30);
      if (!items.length) {
        __p_overlay.querySelector('.ge-empty').style.display = '';
        return;
      }
      const frag = document.createDocumentFragment();
      for (const it of items) frag.appendChild(createCardFor(it));
      grid.appendChild(frag);
      pruneGridIfNeeded();
    } catch (e) {
      console.error("Personal explorer sample yüklenemedi:", e);
      __p_overlay.querySelector('.ge-empty').style.display = '';
    }
  })();
}

export function closePersonalExplorer(skipAnimation = false) {
  if (!__p_overlay) return;
  try { document.removeEventListener('keydown', p_escCloser); } catch {}
  try { window.removeEventListener('hashchange', p_hashCloser); } catch {}
  try { __p_io?.disconnect(); } catch {}
  __p_io = null;
  if (__p_abort) { try { __p_abort.abort(); } catch {} __p_abort = null; }
  const cleanup = () => {
    __p_overlay?.remove();
    __p_overlay = null;
    __p_busy = false;
    __p_startIndex = 0;
    __p_isClosing = false;
    __p_seenIds.clear?.();
  };
  if (skipAnimation) { cleanup(); return; }
  p_animatedCloseThen(cleanup);
}
