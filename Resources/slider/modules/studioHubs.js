import { getSessionInfo, getEmbyHeaders, makeApiRequest } from "./api.js";
import { getConfig } from './config.js';
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { waitForAnyVisible } from "../main.js";
import { withServer } from "./jfUrl.js";

const config = getConfig();
const MANUAL_IDS = {};
const ALIASES = {
  "Marvel Studios": ["marvel studios","marvel","marvel entertainment","marvel studios llc"],
  "Pixar": ["pixar","pixar animation studios","disney pixar"],
  "Walt Disney Pictures": ["walt disney","walt disney pictures"],
  "Disney+": ["disney+","disney plus","disney+ originals","disney plus originals","disney+ studio"],
  "DC": ["DC Entertainment","dc entertainment","dc"],
  "Warner Bros. Pictures": ["warner bros","warner bros.","warner bros pictures","warner bros. pictures","warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm","lucasfilm ltd","lucasfilm ltd."],
  "Columbia Pictures": ["columbia","columbia pictures","columbia pictures industries"],
  "Paramount Pictures": ["paramount","paramount pictures","paramount pictures corporation"],
  "DreamWorks Animation": ["dreamworks","dreamworks animation","dreamworks pictures"]
};
const CORE_TOKENS = {
  "Marvel Studios": ["marvel"],
  "Pixar": ["pixar"],
  "Walt Disney Pictures": ["walt","disney"],
  "Disney+": ["disney","plus"],
  "DC": ["dc","entertainment"],
  "Warner Bros. Pictures": ["warner"],
  "Lucasfilm Ltd.": ["lucasfilm"],
  "Columbia Pictures": ["columbia"],
  "Paramount Pictures": ["paramount"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks", "animation"]
};

const LOGO_H = 160;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const MAP_TTL   = 30 * 24 * 60 * 60 * 1000;
const IMG_TTL   = 7  * 24 * 60 * 60 * 1000;
const LS_KEY    = "studioHub_cache_v5";
const MAP_KEY   = "studioHub_nameIdMap_v5";
const IMG_KEY   = "studioHub_backdropMap_v1";
const STUDIO_ITEMS_LIMIT = 120;
const nbase = s => (s||"").toLowerCase().replace(/[().,™©®\-:_+]/g," ").replace(/\s+/g," ").trim();
const strip = s => {
  let out = " " + nbase(s) + " ";
  for (const w of JUNK_WORDS) out = out.replace(new RegExp(`\\s${w}\\s`, "g"), " ");
  return out.trim();
};
const toks = s => strip(s).split(" ").filter(Boolean);
const DEFAULT_ORDER = [
  "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
  "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures","Paramount Pictures",
  "Netflix","DreamWorks Animation"
];
const CANONICALS = new Map(DEFAULT_ORDER.map(n => [n.toLowerCase(), n]));
const JUNK_WORDS = ["ltd","ltd.","llc","inc","inc.","company","co.","corp","corp.","the","pictures","studios","animation","film","films","pictures.","studios."];
const ALIAS_TO_CANON = (() => {
  const m = new Map();
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    m.set(canon.toLowerCase(), canon);
    for (const a of aliases) m.set(String(a).toLowerCase(), canon);
  }
  return m;
})();

let __studioHubBusy = false;
let __fetchAbort = null;
let __studioHubsMounting = false;
let __studioHubsMountedOnce = false;
let __studioHubsRetryTo = null;

function upsertImg(card, className) {
  let img = card.querySelector('img.hub-img');
  if (!img) {
    img = document.createElement('img');
    img.className = className;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.style.opacity = '0';
    img.addEventListener('load', () => {
      card.classList.remove('skeleton');
      img.style.opacity = '1';
    }, { once: true });
    card.appendChild(img);
  } else {
    img.className = className;
  }
  return img;
}

function toCanonicalStudioName(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  return ALIAS_TO_CANON.get(key) || CANONICALS.get(key) || null;
}

function ensurePreviewButton(card, studioName, studioId, userId) {
  if (!card.querySelector('.hub-preview-btn')) {
    createPreviewButton(card, studioName, studioId, userId);
  }
}

function mergeOrder(defaults, custom) {
  const out = [];
  const seen = new Set();
  for (const n of (custom || [])) {
    const canon = toCanonicalStudioName(n) || n;
    const k = canon.toLowerCase();
    if (!seen.has(k)) { out.push(canon); seen.add(k); }
  }
  for (const n of defaults) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { out.push(n); seen.add(k); }
  }
  return out;
}

const USER_ORDER = Array.isArray(config.studioHubsOrder) ? config.studioHubsOrder : [];
const ORDER = mergeOrder(DEFAULT_ORDER, USER_ORDER);

const LOGO_BASE = "./slider/src/images/studios/";
const LOCAL_EXTS = [".webp"];
const LOGO_CACHE_KEY = "studioHub_logoUrlCache_v1";
const LOGO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const VIDEO_EXTS = [".mp4"];
const HOVER_VIDEO_TIMEOUT = 4000;
const MIN_RATING = Number.isFinite(config.studioHubsMinRating) ? config.studioHubsMinRating : 6.5;

const getRating = (it) => Number(it?.CommunityRating ?? it?.CriticRating ?? 0);
function randomSample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}
function selectTopNWithMinRating(items, min = MIN_RATING, count = 5) {
  const pool = items.filter(it => getRating(it) >= min);
  if (pool.length <= count) return pool;
  return randomSample(pool, count);
}

function replaceExt(url, newExt) {
  return url.replace(/\.[a-z0-9]+(?:\?.*)?$/i, newExt);
}
function deriveVideoCandidatesFromLogo(logoUrl) {
  return VIDEO_EXTS.map(ext => replaceExt(logoUrl, ext));
}
function probeVideo(url, timeoutMs = HOVER_VIDEO_TIMEOUT) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const v = document.createElement("video");
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true; resolve(false);
      try { v.src = ""; } catch {}
    }, timeoutMs);
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = url;
    const ok = () => { if (done) return; done = true; clearTimeout(timer); resolve(true); };
    const bad = () => { if (done) return; done = true; clearTimeout(timer); resolve(false); };
    v.oncanplay = ok;
    v.onloadeddata = ok;
    v.onerror = bad;
  });
}

let __hubPreviewPopover = null;
let __hubPreviewCloseTimer = null;
let __userInteracted = false;
window.addEventListener('pointermove', () => { __userInteracted = true; }, { once: true, passive: true });

function ensurePreviewPopover() {
  if (__hubPreviewPopover) return __hubPreviewPopover;
  const pop = document.createElement('div');
  pop.className = 'hub-preview-popover';
  pop.innerHTML = `
    <div class="hub-preview-header">
      <h3 class="hub-preview-title"></h3>
      <button class="hub-preview-close" aria-label="Close">×</button>
    </div>
    <div class="hub-preview-body"></div>
  `;
  document.body.appendChild(pop);
  pop.querySelector('.hub-preview-close').addEventListener('click', hidePreviewPopover);
  pop.addEventListener('mouseenter', () => {
    if (__hubPreviewCloseTimer) { clearTimeout(__hubPreviewCloseTimer); __hubPreviewCloseTimer = null; }
  });
  pop.addEventListener('mouseleave', () => scheduleHidePopover());
  __hubPreviewPopover = pop;
  const autoHide = () => hidePreviewPopover();
  window.addEventListener('beforeunload', autoHide);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoHide(); });
  window.addEventListener('hashchange', autoHide);
  return pop;
}

 const OPEN_INTENT_MS   = Number(config.studioHubsOpenIntentMs ?? 180);
 const CLOSE_GRACE_MS   = Number(config.studioHubsCloseGraceMs ?? 300);
 function scheduleHidePopover(delay = CLOSE_GRACE_MS) {
  if (__hubPreviewCloseTimer) clearTimeout(__hubPreviewCloseTimer);
  __hubPreviewCloseTimer = setTimeout(() => { hidePreviewPopover(); }, delay);
}

function hidePreviewPopover() {
  if (__hubPreviewCloseTimer) { clearTimeout(__hubPreviewCloseTimer); __hubPreviewCloseTimer = null; }
  if (!__hubPreviewPopover) return;
  try { __hubPreviewPopover.__cleanup?.(); __hubPreviewPopover.__cleanup = null; } catch {}
  __hubPreviewPopover.classList.remove('visible');
  setTimeout(() => {
    if (!__hubPreviewPopover.classList.contains('visible')) {
      __hubPreviewPopover.style.display = 'none';
    }
  }, 200);
}

function setPopoverContent(studioName, items) {
  const pop = ensurePreviewPopover();
  const title = pop.querySelector('.hub-preview-title');
  const body = pop.querySelector('.hub-preview-body');

  title.textContent = `${studioName} - ${(config.languageLabels.previewModalTitle || 'Top Rated Movies')}`;
  pop.querySelector('.hub-preview-close').setAttribute('aria-label', config.languageLabels.closeButton || 'Close');

  body.innerHTML = '';
  const { serverId } = getSessionInfo();

  items.slice(0, 5).forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'hub-preview-item';
    const posterUrl = buildPosterUrl(item, 300, 95);
    let ratingVal = item.CommunityRating || item.CriticRating;
    let rating = (typeof ratingVal === "number") ? ratingVal.toFixed(1) : (config.languageLabels.noRating || 'N/A');
    let isFavorite = !!(item.UserData?.IsFavorite);
    const favAddText = config.languageLabels.addToFavorites || 'Favorilere ekle';
    const favRemoveText = config.languageLabels.removeFromFavorites || 'Favorilerden çıkar';
    itemEl.innerHTML = `
      <img class="hub-preview-poster" src="${posterUrl || withServer('/css/images/placeholder.png')}" alt="${item.Name}" loading="lazy">
      <div class="hub-preview-info">
        <div class="hub-preview-item-title">${item.Name}</div>
        <div class="hub-preview-rating">
          ⭐ ${rating}
          <button class="favorite-heart ${isFavorite ? 'favorited' : ''}"
                  data-item-id="${item.Id}"
                  aria-label="${isFavorite ? favRemoveText : favAddText}">
            ${isFavorite ? '❤️' : '🤍'}
          </button>
        </div>
      </div>
    `;
    const favoriteBtn = itemEl.querySelector('.favorite-heart');
    favoriteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (favoriteBtn.__busy) return;
      favoriteBtn.__busy = true;
      const next = !isFavorite;
      const ok = await toggleFavorite(item.Id, next, favoriteBtn);
      favoriteBtn.__busy = false;
      if (ok) {
        isFavorite = next;
        item.UserData = item.UserData || {};
        item.UserData.IsFavorite = isFavorite;
        favoriteBtn.classList.toggle('favorited', isFavorite);
        favoriteBtn.innerHTML = isFavorite ? '❤️' : '🤍';
        favoriteBtn.setAttribute('aria-label', isFavorite ? favRemoveText : favAddText);
      }
    });

    itemEl.addEventListener('click', (e) => {
      if (!e.target.closest('.favorite-heart')) {
        hidePreviewPopover();
        window.location.href = `#/details?id=${item.Id}&serverId=${encodeURIComponent(serverId)}`;
      }
    });

    attachMiniPosterHover(itemEl, item);
    body.appendChild(itemEl);
  });

  return pop;
}

async function toggleFavorite(itemId, isFavorite, buttonElement) {
  const { userId } = getSessionInfo();
  const favAddText = config.languageLabels.addToFavorites || 'Favorilere ekle';
  const favRemoveText = config.languageLabels.removeFromFavorites || 'Favorilerden çıkar';
  try {
    const response = await fetch(withServer(`/Users/${userId}/FavoriteItems/${itemId}`), {
      method: isFavorite ? 'POST' : 'DELETE',
      headers: getEmbyHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
      credentials: 'same-origin'
    });
    if (response.ok) {
      if (isFavorite) {
        buttonElement.innerHTML = '❤️';
        buttonElement.classList.add('favorited');
        buttonElement.setAttribute('aria-label', favRemoveText);
      } else {
        buttonElement.innerHTML = '🤍';
        buttonElement.classList.remove('favorited');
        buttonElement.setAttribute('aria-label', favAddText);
      }
      buttonElement.style.transform = 'scale(1.2)';
      setTimeout(() => { buttonElement.style.transform = 'scale(1)'; }, 200);
      return true;
    } else {
      console.error('Favori durumu değiştirilemedi:', response.status);
      buttonElement.style.animation = 'shake 0.5s';
      setTimeout(() => { buttonElement.style.animation = ''; }, 500);
      return false;
    }
  } catch (error) {
    console.error('Favori işlemi hatası:', error);
    buttonElement.style.animation = 'shake 0.5s';
    setTimeout(() => { buttonElement.style.animation = ''; }, 500);
    return false;
  }
}

function positionPopover(anchorEl, pop) {
  const margin = 8;
  const docEl = document.documentElement;
  const vw = docEl.clientWidth;
  const vh = docEl.clientHeight;
  const r = anchorEl.getBoundingClientRect();
  const prevDisplay = pop.style.display;
  pop.style.display = 'block';
  pop.style.opacity = '0';
  pop.style.pointerEvents = 'none';

  const pw = Math.min(pop.offsetWidth || 360, vw - 2 * margin);
  const ph = Math.min(pop.offsetHeight || 300, vh - 2 * margin);

  const spaceRight  = vw - r.right  - margin;
  const spaceLeft   = r.left        - margin;
  const spaceBottom = vh - r.bottom - margin;
  const spaceTop    = r.top         - margin;

  let placement = 'right';
  if (spaceRight >= pw) placement = 'right';
  else if (spaceLeft >= pw) placement = 'left';
  else if (spaceBottom >= ph) placement = 'bottom';
  else if (spaceTop >= ph) placement = 'top';
  else {
    const candidates = [
      { side: 'right',  size: spaceRight },
      { side: 'left',   size: spaceLeft },
      { side: 'bottom', size: spaceBottom },
      { side: 'top',    size: spaceTop },
    ].sort((a,b) => b.size - a.size);
    placement = candidates[0].side;
  }

  let left, top;
  switch (placement) {
    case 'right':  left = r.right + margin;          top = r.top + (r.height - ph) / 2; break;
    case 'left':   left = r.left - margin - pw;      top = r.top + (r.height - ph) / 2; break;
    case 'bottom': left = r.left + (r.width - pw)/2; top = r.bottom + margin;           break;
    case 'top':    left = r.left + (r.width - pw)/2; top = r.top - margin - ph;         break;
  }

  left = Math.max(margin, Math.min(left, vw - margin - pw));
  top  = Math.max(margin, Math.min(top,  vh - margin - ph));
  pop.style.left = `${Math.round(left + window.scrollX)}px`;
  pop.style.top  = `${Math.round(top  + window.scrollY)}px`;
  pop.style.display = prevDisplay || 'block';
  pop.style.opacity = '';
  pop.style.pointerEvents = '';
}

function showPreviewPopover(anchorEl, studioName, items) {
  const pop = setPopoverContent(studioName, items);
  pop.style.position = 'absolute';
  pop.style.maxWidth = 'min(520px, 90vw)';
  pop.style.maxHeight = 'min(70vh, 600px)';
  pop.style.overflow = 'auto';
  pop.style.display = 'block';
  pop.classList.remove('visible');

  const reposition = () => positionPopover(anchorEl, pop);
  requestAnimationFrame(() => {
    reposition();
    requestAnimationFrame(() => { pop.classList.add('visible'); });
  });

  const onWin = () => reposition();
  window.addEventListener('resize', onWin, { passive: true });
  window.addEventListener('scroll', onWin, { passive: true });

  const row = anchorEl.closest('.hub-row');
  const onRow = () => reposition();
  if (row) row.addEventListener('scroll', onRow, { passive: true });

  const closeIfLeft = () => {
    if (!anchorEl.matches(':hover') && !pop.matches(':hover')) {
      scheduleHidePopover(CLOSE_GRACE_MS);
      const cancelOnReHover = () => {
        if (__hubPreviewCloseTimer && (anchorEl.matches(':hover') || pop.matches(':hover'))) {
          clearTimeout(__hubPreviewCloseTimer);
          __hubPreviewCloseTimer = null;
        }
      };
      pop.addEventListener('mouseenter', cancelOnReHover, { once: true });
      anchorEl.addEventListener('mouseenter', cancelOnReHover, { once: true });
    }
  };
  anchorEl.addEventListener('mouseleave', closeIfLeft, { passive: true });
  const onPopLeave = () => scheduleHidePopover(CLOSE_GRACE_MS);
  pop.addEventListener('mouseleave', onPopLeave, { passive: true });

  const cleanup = () => {
    window.removeEventListener('resize', onWin);
    window.removeEventListener('scroll', onWin);
    if (row) row.removeEventListener('scroll', onRow);
    anchorEl.removeEventListener('mouseleave', closeIfLeft);
    pop.removeEventListener('mouseleave', onPopLeave);
  };

  pop.__cleanup = cleanup;
}

function createPreviewButton(card, studioName, studioId, userId) {
  const btn = document.createElement('button');
  btn.className = 'hub-preview-btn';
  btn.setAttribute('aria-label', `${studioName} ${(config.languageLabels.previewButtonLabel || "Önizleme")}`);
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';

  let isFetching = false;
  let studioItems = null;
  let hoverOpenTimer = null;

  async function ensureItems() {
    if (studioItems || isFetching) return;
    isFetching = true;
    btn.style.opacity = '0.5';
    try {
      const signal = __fetchAbort ? __fetchAbort.signal : null;
      const fetched = await fetchStudioItemsViaUsers(studioId, studioName, userId, signal);
      studioItems = selectTopNWithMinRating(fetched, MIN_RATING, 5);
    } catch (err) {
      console.error('Ön izleme verileri alınamadı:', err);
      studioItems = [];
    } finally {
      isFetching = false;
      btn.style.opacity = '';
    }
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await ensureItems();
    if (studioItems && studioItems.length) { showPreviewPopover(btn, studioName, studioItems); }
  });

  btn.addEventListener('mouseenter', async () => {
    if (!__userInteracted) return;
    if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
    await ensureItems();
    hoverOpenTimer = setTimeout(() => {
      if (btn.matches(':hover') && studioItems && studioItems.length) {
        showPreviewPopover(btn, studioName, studioItems);
      }
    }, OPEN_INTENT_MS);
  });

  btn.addEventListener('mouseleave', () => {
    if (hoverOpenTimer) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }
    scheduleHidePopover(160);
  });

  btn.addEventListener('focus', async () => {
    await ensureItems();
    if (studioItems && studioItems.length) { showPreviewPopover(btn, studioName, studioItems); }
  });
  btn.addEventListener('blur', () => scheduleHidePopover(160));

  card.appendChild(btn);
  return btn;
}

async function setupHoverVideo(card, logoUrl, studioName, studioId, userId) {
  if (!card || !logoUrl) return;
  const candidates = deriveVideoCandidatesFromLogo(logoUrl);
  let playableUrl = null;
  for (const u of candidates) {
    const ok = await probeVideo(u);
    if (ok) { playableUrl = u; break; }
  }
  if (!playableUrl) return;

  let vidEl = null;

  const ensureVideo = () => {
    if (vidEl) return vidEl;
    vidEl = document.createElement("video");
    vidEl.className = "hub-video";
    vidEl.src = playableUrl;
    vidEl.muted = true;
    vidEl.loop = true;
    vidEl.playsInline = true;
    vidEl.preload = "auto";
    vidEl.setAttribute("aria-hidden", "true");
    card.style.position = card.style.position || "relative";
    card.appendChild(vidEl);
    if (studioName && studioId && userId) {
      ensurePreviewButton(card, studioName, studioId, userId);
    }
    return vidEl;
  };

  const play = () => {
    const v = ensureVideo();
    v.currentTime = 0;
    v.style.opacity = "1";
    v.play().catch(() => {});
  };
  const stop = (remove = false) => {
    if (!vidEl) return;
    try { vidEl.pause(); } catch {}
    vidEl.style.opacity = "0";
    if (remove) {
      const v = vidEl;
      vidEl = null;
      try { v.removeAttribute('src'); v.load?.(); } catch {}
      try { v.remove(); } catch {}
    }
  };

  card.addEventListener("mouseenter", () => { if (__userInteracted) play(); });
  card.addEventListener("mouseleave", () => stop(false));
  card.addEventListener("focus", play);
  card.addEventListener("blur", () => stop(false));
  const stopAndRemove = () => stop(true);
  card.addEventListener("click", stopAndRemove);
  card.addEventListener("pointerdown", stopAndRemove);

  const onRouteOrHide = () => stop(true);
  window.addEventListener("hashchange", onRouteOrHide);
  window.addEventListener("beforeunload", onRouteOrHide);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onRouteOrHide();
  });

  card.__hoverVideoCleanup = () => {
    stop(true);
    card.removeEventListener("click", stopAndRemove);
    card.removeEventListener("pointerdown", stopAndRemove);
    window.removeEventListener("hashchange", onRouteOrHide);
    window.removeEventListener("beforeunload", onRouteOrHide);
  };
}


function withVer(url, v = "1") { return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(v)}`; }
function loadLogoCache() {
  try { const raw = localStorage.getItem(LOGO_CACHE_KEY); if (!raw) return {}; const { ts, data } = JSON.parse(raw); if (!ts || Date.now() - ts > LOGO_CACHE_TTL) return {}; return data || {}; } catch { return {}; }
}
function saveLogoCache(map) {
  try {
    const entries = Object.entries(map);
    const MAX = 100;
    const trimmed = entries.slice(-MAX);
    const out = Object.fromEntries(trimmed);
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: out }));
  } catch {}
}
function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[().,™©®'’"&+]/g, " ")
    .replace(/\s+and\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function probeImage(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; resolve(false); try { img.src = ""; } catch {} }, timeoutMs);
    img.onload  = () => { if (done) return; done = true; clearTimeout(timer); resolve(true); };
    img.onerror = () => { if (done) return; done = true; clearTimeout(timer); resolve(false); };
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}
async function tryLocalLogo(name) {
  const base = LOGO_BASE + slugify(name);
  for (const ext of LOCAL_EXTS) {
    const url = withVer(`${base}${ext}`);
    if (await probeImage(url)) return url;
  }
  return null;
}
async function resolveLogoUrl(name) {
  const cache = loadLogoCache();
  if (cache[name]) {
    if (await probeImage(cache[name])) return cache[name];
    delete cache[name];
    saveLogoCache(cache);
  }
  const localUrl = await tryLocalLogo(name);
  if (localUrl) { cache[name] = localUrl; saveLogoCache(cache); return localUrl; }
  return null;
}

async function fetchStudios(signal) {
  const url = `/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
  const res = await fetch(withServer(url), { headers: hJSON(), signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error("Studios alınamadı");
  const data = await res.json();
  const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
  return items.map(s => ({
    Id: s.Id,
    Name: s.Name,
    ImageTags: s.ImageTags || {},
    PrimaryImageTag: s.PrimaryImageTag || (s.ImageTags?.Primary) || null
  }));
}

async function fetchStudioItemsViaUsers(studioId, studioName, userId, signal) {
  const ratingPart = Number.isFinite(MIN_RATING) ? `&MinCommunityRating=${MIN_RATING}` : "";
  const common = `StartIndex=0&Limit=${STUDIO_ITEMS_LIMIT}&Fields=PrimaryImageAspectRatio,ImageTags,BackdropImageTags,CommunityRating,CriticRating&Recursive=true&SortOrder=Descending${ratingPart}`;
  const urls = [
    `/Users/${userId}/Items?${common}&IncludeItemTypes=Movie,Series&StudioIds=${encodeURIComponent(studioId)}`,
    `/Users/${userId}/Items?${common}&IncludeItemTypes=Movie,Series&Studios=${encodeURIComponent(studioName)}`
  ];
  for (const u of urls) {
    try {
      const r = await fetch(withServer(u), { headers: hJSON(), signal, credentials: 'same-origin' });
      if (!r.ok) continue;
      const data = await r.json();
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      if (items.length) return items;
    } catch {}
  }
  return [];
}

function hJSON() {
  return getEmbyHeaders({ "Accept":"application/json" });
}

function buildBackdropUrl(item, index = 0) {
  const tags = item.BackdropImageTags || [];
  const tag = tags[index];
  if (!tag) return null;
  return withServer(`/Items/${item.Id}/Images/Backdrop/${index}?tag=${encodeURIComponent(tag)}&quality=90`);
}
function buildPosterUrl(item, height = 300, quality = 95) {
  const tag = item.ImageTags?.Primary || item.PrimaryImageTag;
  if (!tag) return null;
  return withServer(`/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}&fillHeight=${height}&quality=${quality}`);
}
function pickRandom(arr) { return arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }

async function chooseBackdropForStudio(studio, userId, signal) {
  const map = loadCache(IMG_KEY, IMG_TTL) || {};
  const cached = map[studio.Id];
  if (cached?.itemId && Number.isInteger(cached?.index)) {
    const itemId = cached.itemId;
    const idx    = cached.index;
    const tag    = cached.tag || null;
    const url = tag
      ? withServer(`/Items/${itemId}/Images/Backdrop/${idx}?tag=${encodeURIComponent(tag)}&quality=90`)
      : withServer(`/Items/${itemId}/Images/Backdrop/${idx}?quality=90`);
    return { itemId, index: idx, url };
  }

  const items = await fetchStudioItemsViaUsers(studio.Id, studio.Name, userId, signal);
  if (!items.length) return null;

  const withBd = items.filter(it => Array.isArray(it.BackdropImageTags) && it.BackdropImageTags.length);
  const candidate = pickRandom(withBd.length ? withBd : items);
  if (!candidate) return null;

  let idx = 0;
  let url = buildBackdropUrl(candidate, idx);

  if (!url) {
    const purl = buildPosterUrl(candidate);
    if (!purl) return null;
    const payload = { studioId: studio.Id, itemId: candidate.Id, index: -1, tag: candidate.ImageTags?.Primary || candidate.PrimaryImageTag || null };
    const newMap = { ...map, [studio.Id]: payload };
    saveCache(IMG_KEY, newMap);
    return { itemId: candidate.Id, index: -1, url: purl };
  }

  const tag = (candidate.BackdropImageTags||[])[idx] || null;
  const payload = { studioId: studio.Id, itemId: candidate.Id, index: idx, tag };
  const newMap = { ...map, [studio.Id]: payload };
  saveCache(IMG_KEY, newMap);

  return { itemId: candidate.Id, index: idx, url };
}

function loadCache(k, ttl) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > ttl) return null;
    return obj.data;
  } catch { return null; }
}
function saveCache(k, data) {
  try {
    let d = data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const MAX = 300;
      const ent = Object.entries(d);
      if (ent.length > MAX) d = Object.fromEntries(ent.slice(-MAX));
    }
    localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data: d }));
  } catch {}
}

function buildStudioHref(studioId, serverId) {
  return `#/list.html?studioId=${encodeURIComponent(studioId)}${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ""}`;
}

function createBackdropCardShell(title, studio, serverId) {
  const a = document.createElement("a");
  a.className = "hub-card skeleton";
  a.dataset.hub = title;
  a.href = studio?.Id ? buildStudioHref(studio.Id, serverId) : "javascript:void(0)";
  a.setAttribute("aria-label", title);

  const overlay = document.createElement("div");
  overlay.className = "hub-overlay";

  const label = document.createElement("div");
  label.className = "hub-title-text";
  label.textContent = title;

  overlay.appendChild(label);
  a.appendChild(overlay);
  return a;
}

export async function renderStudioHubs() {
  if (!config.enableStudioHubs) return;
  if (__studioHubBusy) return;
  __studioHubBusy = true;

  if (__fetchAbort) { try { __fetchAbort.abort(); } catch {} }
  __fetchAbort = new AbortController();

  try {
    const indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) {
      return;
    }
     const row = ensureContainer(indexPage);
    if (!row) {
      return;
    }
     setupScroller(row);
     row.innerHTML = "";
     let { serverId, userId } = getSessionInfo();
     serverId = serverId || localStorage.getItem("serverId") || sessionStorage.getItem("serverId") || null;
     const shells = {};

    const maxCards = Number.isFinite(config.studioHubsCardCount) ? config.studioHubsCardCount : ORDER.length;
    const wanted = ORDER.slice(0, Math.max(1, maxCards));

    for (const desired of wanted) {
      const existing = row.querySelector(`.hub-card[data-hub="${CSS.escape(desired)}"]`);
      const card = existing || createBackdropCardShell(desired, null, null);
      if (!existing) row.appendChild(card);
      shells[desired] = card;
    }
    row.parentElement.style.display = "";

    const cached = loadCache(LS_KEY, CACHE_TTL);
    const studios = cached || await fetchStudios(__fetchAbort.signal).catch(() => []);
    if (!cached && studios.length) saveCache(LS_KEY, studios);

    const nameMap = loadCache(MAP_KEY, MAP_TTL) || {};
    const resolved = [];
    for (const desired of wanted) {
      const manualId = MANUAL_IDS[desired];
      let studio = manualId
        ? { Id: manualId, Name: desired }
        : (nameMap[desired] || studios.find(s => matches(desired, s.Name)) || await searchStudiosByAliases(desired, __fetchAbort.signal));
      if (studio) { resolved.push({ name: desired, studio }); nameMap[desired] = studio; }
    }
    saveCache(MAP_KEY, nameMap);

    await Promise.allSettled(resolved.map(async ({ name, studio }) => {
      const card = shells[name];
      if (!card) return;
      let used = false;
      const logoUrl = await resolveLogoUrl(name);

      if (logoUrl) {
        const img = upsertImg(card, "hub-img hub-logo");
        img.alt = `${name} logo`;
        if (img.src !== logoUrl) {
          img.style.opacity = '0';
          img.src = logoUrl;
        }
        card.href = buildStudioHref(studio.Id, serverId);

        ensurePreviewButton(card, name, studio.Id, userId);
        if (config.studioHubsHoverVideo) {
          setupHoverVideo(card, logoUrl, name, studio.Id, userId);
        }
        used = true;
      }

      if (!used) {
        const chosen = await chooseBackdropForStudio(studio, userId, __fetchAbort.signal);
        if (!chosen?.url) return;

        const img = upsertImg(card, "hub-img");
        img.alt = name;
        if (img.src !== chosen.url) {
          img.style.opacity = '0';
          img.src = chosen.url;
        }
        ensurePreviewButton(card, name, studio.Id, userId);
      }
    }));

    if (!resolved.length) {
    }
  } catch (e) {
    console.warn("Studio hubs render hatası:", e);
  } finally {
    __studioHubBusy = false;
    __fetchAbort = null;
  }
}

function ensureContainer(indexPage) {
  const all = indexPage.querySelectorAll("#studio-hubs");
  if (all.length > 1) {
    for (let i = 1; i < all.length; i++) {
     all[i].querySelectorAll('video.hub-video').forEach(v => {
       try { v.pause(); } catch {}
       try { v.removeAttribute('src'); v.load?.(); } catch {}
     });
     all[i].remove();
   }
  }
  const homeSections = indexPage.querySelector(".homeSectionsContainer");
  if (!homeSections) return null;

  let section = indexPage.querySelector("#studio-hubs");
  if (!section) {
    section = document.createElement("div");
    section.id = "studio-hubs";
    section.classList.add("homeSection");
    section.innerHTML = `
      <div class="sectionTitleContainer sectionTitleContainer-cards">
        <h2 class="sectionTitle sectionTitle-cards">${config.languageLabels.studioHubs || 'Studio Collections'}</h2>
      </div>
      <div class="hub-scroll-wrap">
        <button class="hub-scroll-btn hub-scroll-left" aria-label="${config.languageLabels.scrollLeft || 'Scroll left'}" aria-disabled="true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <div class="itemsContainer hub-row backdrop-mode" role="list"></div>
        <button class="hub-scroll-btn hub-scroll-right" aria-label="${config.languageLabels.scrollRight || 'Scroll right'}" aria-disabled="true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
        </button>
      </div>
    `;
    const firstChild = homeSections.firstElementChild;
    if (firstChild) homeSections.insertBefore(section, firstChild);
    else homeSections.appendChild(section);
  }
  return section.querySelector(".hub-row");
}

function setupScroller(row) {
  if (row.dataset.scrollerMounted === "1") {
    requestAnimationFrame(() => {
      row.dispatchEvent(new Event('scroll'));
    });
    return;
  }
  row.dataset.scrollerMounted = "1";
  const section = row.closest("#studio-hubs");
  if (!section) return;
  const btnL = section.querySelector(".hub-scroll-left");
  const btnR = section.querySelector(".hub-scroll-right");
  const step = () => Math.max(240, Math.floor(row.clientWidth * 0.9));
  const updateButtons = () => {
    const max = row.scrollWidth - row.clientWidth - 1;
    const atStart = row.scrollLeft <= 1;
    const atEnd   = row.scrollLeft >= max;
    if (btnL) btnL.setAttribute("aria-disabled", atStart ? "true" : "false");
    if (btnR) btnR.setAttribute("aria-disabled", atEnd   ? "true" : "false");
  };
  if (btnL) btnL.onclick = () => row.scrollBy({ left: -step(), behavior: "smooth" });
  if (btnR) btnR.onclick = () => row.scrollBy({ left:  step(), behavior: "smooth" });

  row.addEventListener("scroll", updateButtons, { passive: true });
  const ro = new ResizeObserver(() => updateButtons());
  ro.observe(row);
  row.__ro = ro;

  row.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
  row.addEventListener('touchmove',  (e) => { e.stopPropagation(); }, { passive: true });

  requestAnimationFrame(updateButtons);
}

function scoreMatch(desired, candidate) {
  const a = new Set(toks(desired));
  const b = new Set(toks(candidate));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const core = (CORE_TOKENS[desired]||[]).some(c => b.has(nbase(c)));
  if (!core) return 0;
  return 1.0 + inter / Math.min(a.size, b.size);
}
const matches = (desired, cand) => scoreMatch(desired, cand) >= 1.3;

async function searchStudiosByAliases(desired, signal) {
  const list = [desired, ...(ALIASES[desired] || [])];
  let best = null, bestScore = 0;
  for (const term of list) {
    const url = `/Studios?SearchTerm=${encodeURIComponent(term)}&Limit=20`;
    try {
      const r = await fetch(withServer(url), { headers: hJSON(), signal });
      if (!r.ok) continue;
      const data = await r.json();
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      for (const s of items) {
        const sc = scoreMatch(desired, s.Name);
        if (sc > bestScore) { best = s; bestScore = sc; }
      }
    } catch {}
  }
  if (!best || bestScore < 1.3) return null;
  return { Id: best.Id, Name: best.Name, ImageTags: best.ImageTags || {}, PrimaryImageTag: best.PrimaryImageTag || (best.ImageTags?.Primary) || null };
}

export function ensureStudioHubsMounted({ eager=false } = {}) {
  if (!config.enableStudioHubs) return;

  const kick = async () => {
    if (__studioHubsMounting) return;
    __studioHubsMounting = true;
    try {
      const ok = await waitForAnyVisible(
        ["#indexPage:not(.hide)", "#homePage:not(.hide)", ".homeSectionsContainer"],
        { timeout: eager ? 4000 : 12000 }
      );
      if (!ok) {
        scheduleRetry(1200);
        return;
      }
      const section = ensureContainer(document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)"));
      if (!section) { scheduleRetry(800); return; }
      await renderStudioHubs();
      __studioHubsMountedOnce = true;
    } finally {
      __studioHubsMounting = false;
    }
  };

  const scheduleRetry = (ms=1000) => {
    clearTimeout(__studioHubsRetryTo);
    __studioHubsRetryTo = setTimeout(() => ensureStudioHubsMounted(), ms);
  };

  kick();
}
