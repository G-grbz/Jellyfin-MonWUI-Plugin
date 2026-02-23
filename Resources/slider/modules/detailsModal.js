import { makeApiRequest, fetchItemDetailsFull, getDetailsUrl, playNow, fetchLocalTrailers, pickBestLocalTrailer, getVideoStreamUrl } from "./api.js";
import { withServer } from "./jfUrl.js";
import { getConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";
import { getYoutubeEmbedUrl } from "./utils.js";

const config = getConfig();
const labels =
  (typeof getLanguageLabels === "function" ? getLanguageLabels() : null) ||
  (config?.languageLabels?.[config?.language] ?? null) ||
  (config?.languageLabels?.tr ?? null) ||
  {};

const _reviewHtmlStore = new Map();
const MODAL_ID = "jms-details-modal-root";
let _closeListeners = [];
let _open = false;
let _lastFocus = null;
let _abort = null;
let _bgAbort = null;
let _restore = null;
let _scrollSnap = null;
let _unbindKeyHandler = null;
let _currentListeners = [];
let _closing = false;
let _openOrigin = null;
let _ytApiPromise = null;
const _boxSetCache = new Map();
const TTL_MOVIE_BOXSET = 7 * 24 * 60 * 60 * 1000;

function isStale(ts, maxAgeMs) {
  const t = Number(ts || 0);
  if (!t) return true;
  return (Date.now() - t) > maxAgeMs;
}

function __prefersReducedMotion() {
  try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

function __resolveOriginEl(el) {
  if (!el || !el.closest) return null;
  return (
    el.querySelector?.("img.cardImage, img, .cardImage, .cardImageContainer") ||
    el.closest?.(".cardImageContainer, .card, .dir-row-hero, button, a") ||
    el
  );
}

function __getRectSafe(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
  if (r.width < 16 || r.height < 16) return null;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function __calcTransform(fromRect, toRect) {
  const fromCx = fromRect.left + fromRect.width / 2;
  const fromCy = fromRect.top + fromRect.height / 2;
  const toCx = toRect.left + toRect.width / 2;
  const toCy = toRect.top + toRect.height / 2;

  const sx = fromRect.width / Math.max(1, toRect.width);
  const sy = fromRect.height / Math.max(1, toRect.height);
  const tx = fromCx - toCx;
  const ty = fromCy - toCy;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return {
    sx: clamp(sx, 0.05, 1.0),
    sy: clamp(sy, 0.05, 1.0),
    tx: clamp(tx, -2000, 2000),
    ty: clamp(ty, -2000, 2000),
  };
}

function __transformStr(t) {
  return `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.sx}, ${t.sy})`;
}

async function __animateInFromOrigin(root) {
  try {
    if (__prefersReducedMotion()) return;
    const originRect = _openOrigin?.rect || null;
    if (!originRect) return;

    const backdropEl = root?.querySelector?.(".jmsdm-backdrop");
    const cardEl = root?.querySelector?.(".jmsdm-card");
    if (!cardEl || !cardEl.getBoundingClientRect) return;
    const toRect = cardEl.getBoundingClientRect();
    if (!toRect || toRect.width < 10 || toRect.height < 10) return;

    const t = __calcTransform(originRect, toRect);

    try { cardEl.style.animation = "none"; } catch {}
    cardEl.style.transformOrigin = "center center";
    cardEl.style.transform = __transformStr(t);
    cardEl.style.opacity = "0.001";

    if (backdropEl) {
      backdropEl.style.opacity = "0";
    }

    await new Promise(requestAnimationFrame);

    if (cardEl.animate) {
      const a1 = cardEl.animate(
        [
          { transform: __transformStr(t), opacity: 0.001 },
          { transform: "translate3d(0,0,0) scale(1,1)", opacity: 1 }
        ],
        { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
      );
      const a2 = backdropEl?.animate
        ? backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "linear", fill: "forwards" })
        : null;
      try { await Promise.all([a1.finished, a2?.finished].filter(Boolean)); } catch {}
    } else {
      cardEl.style.transform = "";
      cardEl.style.opacity = "1";
      if (backdropEl) backdropEl.style.opacity = "1";
    }

    cardEl.style.transform = "";
    cardEl.style.opacity = "1";
    if (backdropEl) backdropEl.style.opacity = "1";
  } catch {}
}

async function __animateOutToOrigin(root) {
  try {
    if (__prefersReducedMotion()) return;

    const cardEl = root?.querySelector?.(".jmsdm-card");
    const backdropEl = root?.querySelector?.(".jmsdm-backdrop");
    if (!cardEl) return;

    const originEl = __resolveOriginEl(_openOrigin?.el);
    const originRect = __getRectSafe(originEl) || _openOrigin?.rect || null;
    if (!originRect) return;

    const cardRect = cardEl.getBoundingClientRect();
    if (!cardRect || cardRect.width < 10 || cardRect.height < 10) return;

    const t = __calcTransform(originRect, cardRect);

    try { cardEl.style.animation = "none"; } catch {}
    try { cardEl.style.transition = "none"; } catch {}
    try { cardEl.style.willChange = "transform, opacity"; } catch {}
    if (backdropEl) {
      try { backdropEl.style.transition = "none"; } catch {}
      try { backdropEl.style.willChange = "opacity"; } catch {}
    }

    const DURATION = 380;
    const BDUR = 260;
    const EASE = "cubic-bezier(.22,.95,.25,1)";

    if (cardEl.animate) {
      const a1 = cardEl.animate(
        [
          { transform: "translate3d(0,0,0) scale(1,1)", opacity: 1 },
          { transform: __transformStr(t), opacity: 0 }
        ],
        { duration: DURATION, easing: EASE, fill: "forwards" }
      );
      const a2 = backdropEl?.animate
        ? backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "linear", fill: "forwards" })
        : null;
      try { await Promise.all([a1.finished, a2?.finished].filter(Boolean)); } catch {}
      } else {
      try {
        cardEl.style.transition = `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`;
        cardEl.style.transformOrigin = "center center";
        if (backdropEl) backdropEl.style.transition = `opacity ${BDUR}ms linear`;
        await new Promise(requestAnimationFrame);
        cardEl.style.transform = __transformStr(t);
        cardEl.style.opacity = "0";
        if (backdropEl) backdropEl.style.opacity = "0";
        await new Promise(r => setTimeout(r, DURATION + 30));
      } catch {}
    }
  } catch {}
}

function softStopHeroMedia(root) {
  try {
    const v = root?.querySelector?.(".jmsdm-hero video[data-jms-hero-preview='1']");
    if (v) {
      try { v.muted = true; v.volume = 0; } catch {}
      try { v.pause(); } catch {}
    }
    const f = root?.querySelector?.(".jmsdm-hero iframe[data-jms-hero-preview='1']");
    if (f) {
      try { f.__ytPlayer?.mute?.(); } catch {}
      try { f.__ytPlayer?.pauseVideo?.(); } catch {}
    }
  } catch {}
}

function ensureYouTubeIframeApi() {
  if (_ytApiPromise) return _ytApiPromise;

  _ytApiPromise = new Promise((resolve, reject) => {
    try {
      if (window.YT?.Player) return resolve(window.YT);

      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { if (typeof prev === "function") prev(); } catch {}
        resolve(window.YT);
      };

      const already = document.querySelector('script[data-jms-yt-api="1"]');
      if (already) return;

      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.defer = true;
      s.dataset.jmsYtApi = "1";
      s.onerror = () => reject(new Error("YT iframe_api load failed"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });

  return _ytApiPromise;
}

async function wireYoutubeEndedToBackdrop(iframeEl, onEnd, { signal } = {}) {
  try {
    await ensureYouTubeIframeApi();
    if (signal?.aborted) return null;
    if (!iframeEl) return null;

    if (!iframeEl.id) iframeEl.id = `jmsyt_${Math.random().toString(36).slice(2)}`;

    const player = new window.YT.Player(iframeEl.id, {
      events: {
        onStateChange: (ev) => {
          if (signal?.aborted) return;
          if (ev?.data === window.YT.PlayerState.ENDED) onEnd?.();
        },
        onError: () => {
          if (signal?.aborted) return;
          onEnd?.();
        }
      }
    });

    iframeEl.__ytPlayer = player;
    return player;
  } catch (e) {
    return null;
  }
}

function ensureRoot() {
  let root = document.getElementById(MODAL_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = MODAL_ID;
    document.body.appendChild(root);
  }
  return root;
}

const LS_TMDB_KEY  = 'jms_tmdb_api_key';
const LS_TMDB_LANG = 'jms_tmdb_reviews_lang';


function getTmdbApiKey() {
  const k1 = (config?.TmdbApiKey || config?.tmdbApiKey || '').toString().trim();
  if (k1) return k1;
  try {
    const k2 = (localStorage.getItem(LS_TMDB_KEY) || '').trim();
    if (k2) return k2;
  } catch {}
  return '';
}

function wireOverviewToggle(root) {
  const over = root?.querySelector?.(".jmsdm-overview");
  if (!over) return;
  if (root.querySelector(".jmsdm-overview-toggle")) return;
  requestAnimationFrame(() => {
    const needs = over.scrollHeight > 150;
    if (!needs) return;

    over.classList.add("is-collapsed");

    const btn = document.createElement("button");
    btn.className = "jmsdm-overview-toggle";
    btn.type = "button";
    btn.textContent = (config.languageLabels.more || "Devamı");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const collapsed = over.classList.toggle("is-collapsed");
      btn.textContent = collapsed
        ? (config.languageLabels.more || "Devamı")
        : (config.languageLabels.less || "Kısalt");
    });
    over.insertAdjacentElement("afterend", btn);
  });
}

function getTmdbLangPref() {
  try { return (localStorage.getItem(LS_TMDB_LANG) || '').trim(); } catch {}
  return '';
}

function getProviderId(item, key) {
  const p = item?.ProviderIds || item?.Providerids || item?.providerIds || null;
  if (!p) return '';
  const candidates = [
    p[key],
    p[key?.toLowerCase?.()],
    p[key?.toUpperCase?.()],
    p[key === 'Tmdb' ? 'TMDb' : key],
    p[key === 'Imdb' ? 'IMDb' : key],
  ].filter(Boolean);
  return (candidates[0] || '').toString().trim();
}

async function tmdbFetchJson(path, { signal } = {}) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) throw new Error('TMDb API key missing');

  const base = 'https://api.themoviedb.org/3';
  const url = new URL(base + path);
  url.searchParams.set('api_key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET', signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`TMDb HTTP ${res.status}: ${txt}`);
  }
  return await res.json();
}

async function resolveTmdbIdFromImdb(imdbId, { signal } = {}) {
  if (!imdbId) return { movie: null, tv: null };
  const data = await tmdbFetchJson(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, { signal });
  const movieId = Array.isArray(data?.movie_results) && data.movie_results[0]?.id ? data.movie_results[0].id : null;
  const tvId    = Array.isArray(data?.tv_results)    && data.tv_results[0]?.id    ? data.tv_results[0].id    : null;
  return { movie: movieId, tv: tvId };
}

async function getTmdbIdForItem(item, { signal } = {}) {
  const tmdb = getProviderId(item, 'Tmdb') || getProviderId(item, 'TMDb');
  if (tmdb && /^\d+$/.test(tmdb)) return { tmdbId: Number(tmdb), kind: (item?.Type === 'Series' ? 'tv' : 'movie') };
  const imdb = getProviderId(item, 'Imdb') || getProviderId(item, 'IMDb');
  if (imdb) {
    const found = await resolveTmdbIdFromImdb(imdb, { signal });
    if (item?.Type === 'Series' || item?.Type === 'Season' || item?.Type === 'Episode') {
      if (found.tv) return { tmdbId: found.tv, kind: 'tv' };
      if (found.movie) return { tmdbId: found.movie, kind: 'movie' };
    } else {
      if (found.movie) return { tmdbId: found.movie, kind: 'movie' };
      if (found.tv) return { tmdbId: found.tv, kind: 'tv' };
    }
  }
  return { tmdbId: null, kind: null };
}

async function fetchTmdbReviews(kind, tmdbId, { signal, language = null, page = 1 } = {}) {
  if (!kind || !tmdbId) return { results: [], page: 1, total_pages: 1 };
  const lang = (language != null ? language : getTmdbLangPref());

  const qp = new URLSearchParams();
  if (lang) qp.set("language", lang);
  qp.set("page", String(page || 1));

  const path = `/${kind}/${encodeURIComponent(tmdbId)}/reviews?${qp.toString()}`;
  const data = await tmdbFetchJson(path, { signal });
  return {
    results: Array.isArray(data?.results) ? data.results : [],
    page: Number(data?.page || page || 1),
    total_pages: Number(data?.total_pages || 1),
    total_results: Number(data?.total_results || 0),
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownToHtmlLite(inputMd) {
  const src = String(inputMd ?? "");
  if (!src) return "";

  let s = escapeHtml(src).replace(/\r\n/g, "\n");

  const codeBlocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `@@JMS_CODEBLOCK_${codeBlocks.length - 1}@@`;
  });

  const inlineCodes = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `@@JMS_CODE_${inlineCodes.length - 1}@@`;
  });

  s = s.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  s = s.replace(/@@JMS_CODE_(\d+)@@/g, (m, i) => {
    const idx = Number(i);
    return `<code>${inlineCodes[idx] ?? ""}</code>`;
  });

  s = s.replace(/@@JMS_CODEBLOCK_(\d+)@@/g, (m, i) => {
    const idx = Number(i);
    return `<pre><code>${codeBlocks[idx] ?? ""}</code></pre>`;
  });

  const lines = s.split("\n");
  const out = [];
  let buf = [];
  let mode = null;

  const flush = () => {
    if (!buf.length) return;
    const raw = buf.join("\n").trimEnd();
    const html = raw.replace(/\n/g, "<br>");
    if (mode === "q") out.push(`<blockquote><p>${html}</p></blockquote>`);
    else out.push(`<p>${html}</p>`);
    buf = [];
    mode = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    if (!ln.trim()) {
      flush();
      continue;
    }

    const isQuote = ln.startsWith("&gt;") || ln.startsWith("&gt; ");
    if (isQuote) {
      const content = ln.replace(/^&gt;\s?/, "");
      if (mode && mode !== "q") flush();
      mode = "q";
      buf.push(content);
    } else {
      if (mode && mode !== "p") flush();
      mode = "p";
      buf.push(ln);
    }
  }
  flush();

  return out.join("");
}

function looksLikeHtmlish(input) {
  const s = String(input ?? "");
  return /<\/?(?:em|i|strong|b|u|s|p|br|div|span|ul|ol|li|blockquote|code|pre|a|spoiler)\b/i.test(s);
}

function sanitizeLimitedHtml(inputHtml) {
  const html = String(inputHtml ?? "");
  if (!html) return "";

  const ALLOWED_TAGS = new Set([
    "B","I","EM","STRONG","U","S",
    "P","BR","DIV","SPAN",
    "UL","OL","LI",
    "BLOCKQUOTE",
    "CODE","PRE",
    "A",
    "SPOILER",
  ]);

  const ALLOWED_ATTRS = {
    A: new Set(["href", "title", "target", "rel"]),
  };

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;

  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      return;
    }
    const tag = node.tagName.toUpperCase();

    if (tag === "SPOILER") {
      const span = doc.createElement("span");
      span.className = "jmsdm-spoiler";
      span.setAttribute("data-spoiler", "1");

      const spoilerLabel =
        (config?.languageLabels?.spoilerClick || config?.languageLabels?.spoiler || "").toString().trim()
        || "Spoiler (tap to reveal)";
      span.setAttribute("data-spoiler-label", spoilerLabel);
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");
      span.setAttribute("aria-label", spoilerLabel);

      while (node.firstChild) span.appendChild(node.firstChild);
      node.replaceWith(span);
      Array.from(span.childNodes).forEach(walk);
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }

    const allowed = ALLOWED_ATTRS[tag] || new Set();
    for (const attr of node.getAttributeNames()) {
      const a = attr.toLowerCase();

      if (a.startsWith("on") || a === "style") {
        node.removeAttribute(attr);
        continue;
      }

      if (!allowed.has(attr)) {
        node.removeAttribute(attr);
      }
    }

    if (tag === "A") {
      const href = (node.getAttribute("href") || "").trim();
      const ok = /^(https?:\/\/|mailto:|#|\/)/i.test(href);
      if (!ok) {
        node.removeAttribute("href");
      } else {
        const isExternal = /^https?:\/\//i.test(href);
        if (isExternal) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        } else {
          node.removeAttribute("target");
          node.removeAttribute("rel");
        }
      }
    }

  Array.from(node.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);

  return root.innerHTML;
}

function toPlainTextFromHtml(html) {
  try {
    const d = document.createElement("div");
    d.innerHTML = String(html ?? "");
    return (d.textContent || "").trim();
  } catch {
    return String(html ?? "").trim();
  }
}

function renderTmdbReviewsHtml(reviews = [], { showMore = false } = {}) {
  if (!reviews.length) {
    return `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.noReviews || 'Yorum bulunamadı.'}</div>`;
  }
  return `
    <div class="jmsdm-reviews">
      ${reviews.map(r => {
        const author = escapeHtml(r?.author || r?.author_details?.username || '—');
        const date = escapeHtml((r?.created_at || r?.updated_at || '').toString().slice(0, 10));
        const raw = String(r?.content || "");
        const baseHtml = looksLikeHtmlish(raw) ? raw : markdownToHtmlLite(raw);
        const fullHtml = sanitizeLimitedHtml(baseHtml);
        const plain = toPlainTextFromHtml(fullHtml);
        const isLong = plain.length > 220;
        const shortHtml = fullHtml;
        const id = escapeHtml(r?.id || Math.random().toString(36).slice(2));

        const ratingRaw = r?.author_details?.rating;
        const ratingNum =
          (typeof ratingRaw === "number" && Number.isFinite(ratingRaw)) ? ratingRaw : null;
        const ratingPct =
          (ratingNum != null) ? Math.round(Math.max(0, Math.min(10, ratingNum)) * 10) : null;
        const ratingHtml =
          (ratingPct != null)
            ? `<span class="jmsdm-review-rating" title="${ratingNum.toFixed(1)}/10"
                 style="font-size:12px;color:rgba(255,255,255,.85);font-weight:600;">
                 ${ratingPct}%</span>`
            : ``;

        _reviewHtmlStore.set(String(id), { fullHtml, shortHtml, plain });

        return `
          <div class="jmsdm-review" data-reviewid="${id}">
            <div class="jmsdm-review-head">
              <div class="jmsdm-review-author">${author}</div>
              <div style="display:flex;gap:10px;align-items:center;">
                ${ratingHtml}
                <div class="jmsdm-review-date">${date}</div>
              </div>
            </div>
            <div class="jmsdm-review-body is-collapsed" data-expanded="0">${shortHtml}</div>

            ${isLong ? `<button class="jmsdm-review-more">${config.languageLabels.more || 'Devamı'}</button>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    ${showMore ? `
      <div style="margin-top:10px;display:flex;justify-content:center;">
        <button class="jmsdm-btn jmsdm-reviews-more">${config.languageLabels.loadMore || "Daha fazla yorum"}</button>
      </div>
    ` : ``}
  `;
}

async function loadTmdbReviewsInto(root, displayItem, { signal } = {}) {
    const host = root?.querySelector?.('.jmsdm-tmdb-reviews');
    if (!host) return;

    host.innerHTML = `
        <button class="jmsdm-reviews-toggle" data-reviews-expanded="false">
            <span>
                ${config.languageLabels.reviewsTitle || 'Yorumlar'}
                <span class="jmsdm-tmdb-logo">(TMDb)</span>
                <span class="jmsdm-reviews-count">...</span>
            </span>
            <span class="toggle-icon">▼</span>
        </button>
        <div class="jmsdm-reviews-container">
            <div class="jmsdm-reviews-loading">${config.languageLabels.loading || 'Yükleniyor...'}</div>
        </div>
    `;

    const toggleBtn = host.querySelector('.jmsdm-reviews-toggle');
    const container = host.querySelector('.jmsdm-reviews-container');
    const countSpan = host.querySelector('.jmsdm-reviews-count');

    function wireSpoilers(scopeEl) {
        if (!scopeEl || scopeEl.__spoilerWired) return;
        scopeEl.__spoilerWired = true;
        scopeEl.addEventListener("click", (e) => {
            const el = e.target?.closest?.(".jmsdm-spoiler");
            if (!el || !scopeEl.contains(el)) return;
            e.preventDefault();
            e.stopPropagation();
            el.classList.toggle("revealed");
        });
    }

    const toggleReviews = () => {
        const expanded = toggleBtn.getAttribute('data-reviews-expanded') === 'true';
        const newState = !expanded;

        toggleBtn.setAttribute('data-reviews-expanded', newState);
        toggleBtn.classList.toggle('expanded', newState);
        container.classList.toggle('expanded', newState);

        if (newState && !container.hasAttribute('data-loaded')) {
            loadReviewsContent();
        }
    };

    toggleBtn.addEventListener('click', toggleReviews);

    const loadReviewsContent = async () => {
        try {
            const key = getTmdbApiKey();
            if (!key) {
                container.innerHTML = `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.tmdbKeyMissing || 'TMDb API key girilmemiş. Ayarlardan ekleyebilirsin.'}</div>`;
                return;
            }

            const { tmdbId, kind } = await getTmdbIdForItem(displayItem, { signal });
            if (!_open || signal?.aborted) return;

            if (!tmdbId || !kind) {
                container.innerHTML = `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.tmdbIdMissing || 'TMDb ID bulunamadı.'}</div>`;
                container.setAttribute('data-loaded', 'true');
                countSpan.textContent = '0';
                return;
            }

            const oldLang = getTmdbLangPref();
            let page = 1;
            let pack = await fetchTmdbReviews(kind, tmdbId, { signal, page });
            let all = pack.results || [];
            const INITIAL_TAKE = 3;
            const STEP_TAKE = 3;
            let shown = Math.min(INITIAL_TAKE, all.length);

            if ((!all || !all.length) && oldLang && oldLang !== 'en-US') {
                try {
                    localStorage.setItem(LS_TMDB_LANG, 'en-US');
                    page = 1;
                    pack = await fetchTmdbReviews(kind, tmdbId, { signal, page, language: "en-US" });
                    all = pack.results || [];
                } finally {
                    try { localStorage.setItem(LS_TMDB_LANG, oldLang); } catch {}
                }
            }

            const totalCount = (pack?.total_results && pack.total_results > 0) ? pack.total_results : all.length;
            countSpan.textContent = totalCount.toString();

            if (!all.length) {
                container.innerHTML = `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.noReviews || 'Henüz yorum yok.'}</div>`;
                container.setAttribute('data-loaded', 'true');
                return;
            }

            const canMore = () => {
                const hasMoreInLoaded = shown < (all?.length || 0);
                const hasMorePages = (pack.total_pages || 1) > (pack.page || 1);
                return hasMoreInLoaded || hasMorePages;
            };

            const render = () => {
                const slice = (all || []).slice(0, shown);
                container.innerHTML = renderTmdbReviewsHtml(slice, { showMore: canMore() });
                wireExpand();
                wireMore();
                container.setAttribute('data-loaded', 'true');
            };

            const wireExpand = () => {
              container.querySelectorAll('.jmsdm-review-more').forEach(btn => {
                if (btn.__wired) return;
                btn.__wired = true;

                btn.addEventListener('click', (e) => {
                  e.preventDefault();

                  const card = btn.closest('.jmsdm-review');
                  const body = card?.querySelector('.jmsdm-review-body');
                  if (!card || !body) return;

                  const id = String(card.getAttribute("data-reviewid") || "");
                  const st = _reviewHtmlStore.get(id);
                  if (!st) return;

                  const expanded = body.getAttribute('data-expanded') === '1';

                  if (!expanded) {
                    body.innerHTML = st.fullHtml || "";
                    wireSpoilers(body);
                    body.setAttribute('data-expanded', '1');
                    body.classList.remove("is-collapsed");
                    btn.textContent = config.languageLabels.less || 'Kısalt';
                  } else {
                    body.innerHTML = st.shortHtml || "";
                    body.setAttribute('data-expanded', '0');
                    body.classList.add("is-collapsed");
                    btn.textContent = config.languageLabels.more || 'Devamı';
                  }
                });
              });
            };

            const wireMore = () => {
                const moreBtn = container.querySelector('.jmsdm-reviews-more');
                if (!moreBtn || moreBtn.__wired) return;
                moreBtn.__wired = true;

                moreBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (signal?.aborted) return;
                    try {
                        moreBtn.disabled = true;
                        moreBtn.textContent = config.languageLabels.loading || "Yükleniyor…";
                        const want = shown + STEP_TAKE;
                        if (want <= (all?.length || 0)) {
                            shown = want;
                            render();
                            return;
                        }

                        shown = (all?.length || 0);

                        const hasNextPage = (pack.total_pages || 1) > (pack.page || 1);
                        if (hasNextPage) {
                            page = (pack.page || page) + 1;
                            const nextPack = await fetchTmdbReviews(kind, tmdbId, { signal, page });
                            pack = nextPack;
                            const next = nextPack.results || [];
                            all = all.concat(next);
                            shown = Math.min(shown + STEP_TAKE, all.length);
                        }

                        render();
                    } catch (err) {
                        if (!signal?.aborted) {
                            console.warn("load more reviews error:", err);
                            window.showMessage?.(config.languageLabels.reviewsFetchFailed || "Yorumlar alınamadı.", "error");
                        }
                    } finally {
                        const b = container.querySelector('.jmsdm-reviews-more');
                        if (b) {
                            b.disabled = false;
                            b.textContent = config.languageLabels.loadMore || "Daha fazla yorum";
                        }
                    }
                });
            };

            render();
        } catch (e) {
            if (!signal?.aborted) {
                console.warn('TMDb reviews error:', e);
                container.innerHTML = `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.reviewsFetchFailed || 'Yorumlar alınamadı.'}</div>`;
                container.setAttribute('data-loaded', 'true');
                countSpan.textContent = '0';
            }
        }
    };

    try {
        const key = getTmdbApiKey();
        if (key) {
            const { tmdbId, kind } = await getTmdbIdForItem(displayItem, { signal: null });
            if (tmdbId && kind) {
                const pack = await fetchTmdbReviews(kind, tmdbId, { signal: null, page: 1 });
                const count =
                (pack?.total_results && pack.total_results > 0)
                  ? pack.total_results
                  : (pack.results?.length || 0);
                countSpan.textContent = count.toString();
            }
        }
    } catch (e) {
        console.debug('Review count fetch error:', e);
    }
}

function stopHeroMedia(root) {
  try {
    const v = root?.querySelector?.(".jmsdm-hero video[data-jms-hero-preview='1']");
    if (v) {
      try { v.pause(); } catch {}
      try { v.removeAttribute("src"); v.load(); } catch {}
    }
    const f = root?.querySelector?.(".jmsdm-hero iframe[data-jms-hero-preview='1']");
    if (f) {
      try { f.src = "about:blank"; } catch {}
    }
  } catch {}
}

const HERO_REPLAY_ICON_D =
  "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z";

function setHeroReplayVisible(btn, visible) {
  if (!btn) return;
  btn.classList.toggle("is-visible", !!visible);
  btn.setAttribute("aria-hidden", visible ? "false" : "true");
}

function ensureHeroReplayButton(root, item, { signal } = {}) {
  const hero = root?.querySelector?.(".jmsdm-hero");
  if (!hero) return null;

  hero.style.position = hero.style.position || "relative";

  let btn = hero.querySelector(".jmsdm-hero-replay");
  if (!btn) {
    const label =
      (config?.languageLabels?.replayTrailer || config?.languageLabels?.playTrailer || "").toString().trim()
      || "Fragmanı tekrar oynat";

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jmsdm-btn jmsdm-hero-replay";
    btn.innerHTML = `${icon(HERO_REPLAY_ICON_D)}`;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    hero.appendChild(btn);
  }

  if (!btn.__wired) {
    btn.__wired = true;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!_open || signal?.aborted) return;

      try {
        btn.disabled = true;
        setHeroReplayVisible(btn, false);
        await startHeroTrailer(root, item, { signal });
      } finally {
        try { btn.disabled = false; } catch {}
      }
    });
  }

  return btn;
}

async function startHeroTrailer(root, item, { signal } = {}) {
  if (!root || !item) return;
  const hero = root.querySelector(".jmsdm-hero");
  if (!hero) return;

  const replayBtn = ensureHeroReplayButton(root, item, { signal });
  setHeroReplayVisible(replayBtn, false);
  try { if (replayBtn) replayBtn.disabled = true; } catch {}

  let media = hero.querySelector(".jmsdm-hero-media");
  if (!media) {
    media = document.createElement("div");
    media.className = "jmsdm-hero-media";
    Object.assign(media.style, {
      position: "absolute",
      inset: "0",
      zIndex: "1",
      overflow: "hidden",
      borderTopLeftRadius: "18px",
      borderTopRightRadius: "18px",
      pointerEvents: "auto",
    });
    hero.style.position = hero.style.position || "relative";
    hero.prepend(media);
  } else {
    media.innerHTML = "";
  }

  const heroImg = hero.querySelector("img");
  const showImg = (on) => { try { if (heroImg) heroImg.style.opacity = on ? "1" : "0"; } catch {} };

  try {
    const locals = await fetchLocalTrailers(item.Id, { signal });
    if (signal?.aborted) return;
    const best = pickBestLocalTrailer(locals);
    if (best?.Id) {
      const url = await getVideoStreamUrl(
        best.Id,
        1280,
        0,
        null,
        ["h264"],
        ["aac"],
        false,
        false,
        false,
        { signal }
      );
      if (signal?.aborted) return;
      if (url) {
        const v = document.createElement("video");
        v.dataset.jmsHeroPreview = "1";
        v.autoplay = true;
        v.muted = false;
        v.playsInline = true;
        v.loop = false;

        v.controls = true;
        v.preload = "metadata";
        v.src = url;

        Object.assign(v.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        });

        showImg(true);
        try { if (replayBtn) replayBtn.disabled = false; } catch {}

        const backToBackdrop = () => {
          if (signal?.aborted) return;
          try { v.pause(); } catch {}
          try { v.removeAttribute("src"); v.load(); } catch {}
          try { v.remove(); } catch {}
          try { media.innerHTML = ""; } catch {}
          showImg(true);
          try { if (replayBtn) replayBtn.disabled = false; } catch {}
          setHeroReplayVisible(replayBtn, true);
        };

        v.addEventListener("playing", () => {
          if (signal?.aborted) return;
          showImg(false);
        }, { once: true });

        v.addEventListener("ended", backToBackdrop, { once: true });
        v.addEventListener("error", backToBackdrop, { once: true });

        media.appendChild(v);

        try { await v.play(); } catch {}
        return;
      }
    }
  } catch (e) {
    if (!signal?.aborted) console.warn("startHeroTrailer local error:", e);
  }

  try {
    const r = Array.isArray(item.RemoteTrailers) ? item.RemoteTrailers[0] : null;
    const embed = r?.Url ? getYoutubeEmbedUrl(r.Url) : "";
    if (!embed || signal?.aborted) return;

    const f = document.createElement("iframe");
    f.dataset.jmsHeroPreview = "1";
    f.allow = "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
    f.referrerPolicy = "origin-when-cross-origin";
    f.allowFullscreen = true;
    f.src = embed;
    Object.assign(f.style, {
      width: "100%",
      height: "100%",
      border: "none",
      display: "block",
    });

    const backToBackdrop = () => {
      if (signal?.aborted) return;
      try { f.__ytPlayer?.destroy?.(); } catch {}
      try { f.__ytPlayer = null; } catch {}
      try { f.src = "about:blank"; } catch {}
      try { f.remove(); } catch {}
      try { media.innerHTML = ""; } catch {}
      showImg(true);
      try { if (replayBtn) replayBtn.disabled = false; } catch {}
      setHeroReplayVisible(replayBtn, true);
    };

    media.appendChild(f);
    showImg(false);
    try { if (replayBtn) replayBtn.disabled = false; } catch {}
    wireYoutubeEndedToBackdrop(f, backToBackdrop, { signal });
  } catch (e) {
    if (!signal?.aborted) console.warn("startHeroTrailer remote error:", e);
  }
}

function isIOSLike() {
  try {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

function lockScroll(lock) {
  try {
    const docEl = document.documentElement;
    if (!docEl) return;

    if (lock) {
      if (_scrollSnap) return;

      const y = window.scrollY || docEl.scrollTop || 0;
      const x = window.scrollX || docEl.scrollLeft || 0;
      const scrollbarW = (window.innerWidth || 0) - (docEl.clientWidth || 0);

      _scrollSnap = { y, x, scrollbarW, usedBodyFixed: false, blocker: null };

      docEl.style.scrollbarGutter = "stable";
      if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;

      docEl.style.overflow = "hidden";
      document.body.style.overflow = "hidden";

      const ios = isIOSLike();
      if (ios) {
        _scrollSnap.usedBodyFixed = true;
        document.body.style.position = "fixed";
        document.body.style.top = `-${y}px`;
        document.body.style.left = `-${x}px`;
        document.body.style.right = "0";
        document.body.style.width = "100%";
        document.body.style.touchAction = "none";
      }

      const blocker = (e) => {
        const root = document.getElementById(MODAL_ID);
        const card = root?.querySelector?.(".jmsdm-card");
        if (!card) { e.preventDefault(); return; }
        if (e.target && card.contains(e.target)) return;
        e.preventDefault();
      };

      window.addEventListener("wheel", blocker, { passive: false });
      window.addEventListener("touchmove", blocker, { passive: false });
      _scrollSnap.blocker = blocker;

    } else {
      if (!_scrollSnap) return;

      const { y, x, blocker, usedBodyFixed } = _scrollSnap;

      if (blocker) {
        window.removeEventListener("wheel", blocker);
        window.removeEventListener("touchmove", blocker);
      }

      if (usedBodyFixed) {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.width = "";
        document.body.style.touchAction = "";
      }

      document.body.style.paddingRight = "";
      document.body.style.overflow = "";
      docEl.style.overflow = "";
      docEl.style.scrollbarGutter = "";

      _scrollSnap = null;

      window.scrollTo(x || 0, y || 0);
    }
  } catch {}
}


function capturePreviewState() {
  try {
    const slide = document.querySelector(".swiper .swiper-slide.active, .splide__slide.is-active, .embla__slide.is-selected, .flickity-slider .is-selected, .active");
    if (!slide) return null;

    const backdropImg = slide.querySelector("img, .backdrop img, .banner img") || null;

    const yt =
      slide.querySelector('iframe[data-jms-preview="1"], iframe[data-jmspreview="1"], iframe[data-jmsPreview="1"]') ||
      slide.querySelector('iframe[data-jms-preview], iframe[data-jmsPreview]') ||
      slide.querySelector('iframe[data-jms-preview="1"]') ||
      slide.querySelector('iframe[data-jms-preview="true"]') ||
      slide.querySelector('iframe[data-jms-preview]') ||
      null;

    const vid =
      slide.querySelector('video[data-jms-preview="1"], video[data-jmsPreview="1"], video[data-jms-preview], video[data-jmsPreview]') ||
      slide.querySelector("video") ||
      null;

    const classes = Array.from(slide.classList);
    const flag = (() => {
      try { return window.__JMS_PREVIEW_PLAYBACK || null; } catch { return null; }
    })();

    return {
      slide,
      classes,
      backdropOpacity: backdropImg ? backdropImg.style.opacity : null,
      ytSrc: yt ? yt.src : null,
      ytDisplayed: yt ? yt.style.display : null,
      videoSrc: vid ? (vid.currentSrc || vid.src || "") : null,
      videoTime: vid ? (Number.isFinite(vid.currentTime) ? vid.currentTime : 0) : 0,
      videoPaused: vid ? !!vid.paused : true,
      flag
    };
  } catch {
    return null;
  }
}

function pausePreviewNow(snap) {
  try {
    if (!snap?.slide) return;

    const yt = snap.slide.querySelector('iframe[data-jms-preview="1"], iframe[data-jms-preview], iframe[data-jmsPreview]');
    if (yt) {
      try { yt.src = "about:blank"; } catch {}
      try { yt.style.display = "none"; } catch {}
    }

    const vid =
      snap.slide.querySelector('video[data-jms-preview="1"], video[data-jms-preview], video[data-jmsPreview]') ||
      snap.slide.querySelector("video");
    if (vid) {
      try { vid.pause(); } catch {}
    }
  } catch {}
}

async function restorePreviewState(snap) {
  if (!snap?.slide) return;

  try {
    const slide = snap.slide;
    const hadVideo = snap.classes.includes("video-active") || snap.classes.includes("intro-active");
    const hadTrailer = snap.classes.includes("trailer-active");

    slide.classList.remove("video-active", "intro-active", "trailer-active");
    if (hadVideo) slide.classList.add("video-active", "intro-active");
    if (hadTrailer) slide.classList.add("trailer-active");

    const backdropImg = slide.querySelector("img, .backdrop img, .banner img") || null;
    if (backdropImg && snap.backdropOpacity != null) backdropImg.style.opacity = snap.backdropOpacity;

    const yt = slide.querySelector('iframe[data-jms-preview="1"], iframe[data-jms-preview], iframe[data-jmsPreview]');
    if (yt && snap.ytSrc) {
      yt.style.display = snap.ytDisplayed ?? "block";
      yt.src = snap.ytSrc;
    }

    const vid =
      slide.querySelector('video[data-jms-preview="1"], video[data-jms-preview], video[data-jmsPreview]') ||
      slide.querySelector("video");
    if (vid && snap.videoSrc) {
      if ((vid.currentSrc || vid.src || "") !== snap.videoSrc) {
        try { vid.src = snap.videoSrc; } catch {}
        try { vid.load(); } catch {}
      }
      const t = snap.videoTime || 0;
      const shouldResume = snap.videoPaused === false;

      const applyTime = () => {
        try { vid.currentTime = t; } catch {}
        if (shouldResume) vid.play().catch(() => {});
      };

      if (vid.readyState >= 1) applyTime();
      else vid.addEventListener("loadedmetadata", applyTime, { once: true });
    }

    try {
      if (snap.flag) window.__JMS_PREVIEW_PLAYBACK = snap.flag;
    } catch {}
  } catch (e) {
    console.warn("restorePreviewState error:", e);
  }
}

function icon(svgPathD) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${svgPathD}"></path></svg>`;
}

function getResumeTicksFromItem(it) {
  try {
    const t =
      it?.UserData?.PlaybackPositionTicks ??
      it?.UserData?.PlaybackPosition ??
      0;
    return Number.isFinite(t) ? t : Number(t || 0);
  } catch {
    return 0;
  }
}

function setPlayButtonLabel(playBtn, isResume) {
  if (!playBtn) return;
  const txt = isResume
    ? (config?.languageLabels?.devamet || "Devam et")
    : (config?.languageLabels?.playNowLabel || "Şimdi Oynat");

  playBtn.innerHTML = `${icon("M8 5v14l11-7z")} ${txt}`;
}

function getCurrentUserIdSafe() {
  try {
    return (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId || "").toString();
  } catch {
    return "";
  }
}

async function getResumeTicksForContainer(containerId, { signal } = {}) {
  try {
    const userId = getCurrentUserIdSafe();
    if (!userId || !containerId) return 0;

    const qp = new URLSearchParams();
    qp.set("ParentId", String(containerId));
    qp.set("Limit", "1");
    qp.set("Fields", "UserData");

    const r = await makeApiRequest(
      `/Users/${encodeURIComponent(userId)}/Items/Resume?${qp.toString()}`,
      { signal }
    );

    const first =
      (Array.isArray(r?.Items) && r.Items[0]) ||
      (Array.isArray(r) && r[0]) ||
      null;

    return getResumeTicksFromItem(first);
  } catch {
    return 0;
  }
}

async function toggleFavorite(itemId, makeFav, { signal } = {}) {
  try {
    const userId =
      (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId || !itemId) throw new Error("UserId/ItemId missing");

    const path = makeFav
      ? `/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(itemId)}`
      : `/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(itemId)}`;

    await makeApiRequest(path, { method: makeFav ? "POST" : "DELETE", signal });
    return true;
  } catch (e) {
    if (!signal?.aborted) console.warn("toggleFavorite error:", e);
    return false;
  }
}

function fmtRuntime(ticks) {
  if (!ticks) return "";
  const totalMin = Math.round((ticks / 10_000_000) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} ${config.languageLabels.dk || "dk"}`;
  return `${h} ${config.languageLabels.sa || "sa"} ${m} ${config.languageLabels.dk || "dk"}`;
}

function localizeItemType(rawType) {
  const t = String(rawType ?? "").trim();
  if (!t) return "";

  const ll = config?.languageLabels || {};
  const map = {
    Movie: ll.film,
    Series: ll.dizi,
    Episode: ll.episode,
    Season: ll.season,
  };

  const byKey = ll[`type_${t}`] || ll[`type${t}`];

  return safeText(map[t] || byKey || "", t);
}

function safeText(s, fallback = "") {
  const t = (s ?? "").toString().trim();
  return t || fallback;
}

async function fetchSimilarItems(itemId, { signal, limit = 12 } = {}) {
  try {
    const userId =
      (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId) return [];
    const r = await makeApiRequest(
      `/Items/${encodeURIComponent(itemId)}/Similar?UserId=${encodeURIComponent(userId)}&Limit=${encodeURIComponent(limit)}&Fields=Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData`,
      { signal }
    );
    return Array.isArray(r?.Items) ? r.Items : [];
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchSimilarItems error:", e);
    return [];
  }
}

async function fetchMoviesByGenres(genres = [], { signal, limit = 12 } = {}) {
  try {
    const userId =
      (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId || !genres.length) return [];
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("IncludeItemTypes", "Movie");
    qp.set("Limit", String(limit));
    qp.set("Recursive", "true");
    qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData");
    qp.set("Genres", genres.slice(0, 3).join("|"));
    qp.set("SortBy", "CommunityRating,ProductionYear,SortName");
    qp.set("SortOrder", "Descending");
    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    return Array.isArray(r?.Items) ? r.Items : [];
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchMoviesByGenres error:", e);
    return [];
  }
}

async function fetchMoviesByPeople(people = [], { signal, limit = 12 } = {}) {
  try {
    const userId =
      (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    const personIds = (people || []).map(p => p?.Id).filter(Boolean).slice(0, 3);
    if (!userId || !personIds.length) return [];

    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("IncludeItemTypes", "Movie");
    qp.set("Limit", String(limit));
    qp.set("Recursive", "true");
    qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData");
    qp.set("PersonIds", personIds.join(","));
    qp.set("SortBy", "CommunityRating,ProductionYear,SortName");
    qp.set("SortOrder", "Descending");
    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    return Array.isArray(r?.Items) ? r.Items : [];
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchMoviesByPeople error:", e);
    return [];
  }
}

function getPrimaryImageUrlMini(it) {
  const tag = it?.ImageTags?.Primary;
  if (!tag) return "";
  return withServer(
    `/Items/${encodeURIComponent(it.Id)}/Images/Primary?tag=${encodeURIComponent(tag)}&quality=85&maxWidth=320`
  );
}

function getEpisodeImageUrlMini(ep, { maxWidth = 280 } = {}) {
  try {
    if (!ep?.Id) return "";

    const primaryTag = ep?.ImageTags?.Primary;
    if (primaryTag) {
      return withServer(
        `/Items/${encodeURIComponent(ep.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}`
      );
    }

    const seriesPrimary = ep?.SeriesPrimaryImageTag;
    if (seriesPrimary && ep?.SeriesId) {
      return withServer(
        `/Items/${encodeURIComponent(ep.SeriesId)}/Images/Primary?tag=${encodeURIComponent(seriesPrimary)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}`
      );
    }

    const pbt = Array.isArray(ep?.ParentBackdropImageTags) ? ep.ParentBackdropImageTags[0] : null;
    if (pbt) {
      const parent = ep?.SeasonId || ep?.ParentId || ep?.SeriesId;
      if (parent) {
        return withServer(
          `/Items/${encodeURIComponent(parent)}/Images/Backdrop/0?tag=${encodeURIComponent(pbt)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}`
        );
      }
    }
  } catch {}

  return "";
}

function renderMiniCards(items = []) {
  if (!items.length) {
    return `<div class="jmsdm-empty-state" style="color:rgba(255,255,255,.6);font-size:14px;padding:20px;text-align:center;">${config.languageLabels.contentNotFound || "Henüz benzer içerik bulunamadı."}</div>`;
  }

  return `
    <div class="jmsdm-minicards">
      ${items.map((it) => {
        const img = getPrimaryImageUrlMini(it);
        const title = safeText(it.Name, "");
        const year = it.ProductionYear ? `(${it.ProductionYear})` : "";
        const rating = it.CommunityRating
          ? true
          : false;

        return `
          <div class="jmsdm-minicard" data-itemid="${it.Id}" title="${escapeHtml(title)}">
            <div class="jmsdm-minicard-img">
              ${
                img
                  ? `<img src="${img}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">`
                  : `<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>`
              }

              <div class="jmsdm-minicard-overlay" aria-hidden="true">
                <div class="jmsdm-minicard-play">
                  ${icon("M8 5v14l11-7z")}
                </div>
              </div>
            </div>

            <div class="jmsdm-minicard-title">
              <div class="jmsdm-minicard-name">${escapeHtml(title)}</div>

              <div class="jmsdm-minicard-meta">
                ${year ? `<span class="jmsdm-minicard-year">${escapeHtml(year)}</span>` : ""}
                ${rating ? `<span class="jmsdm-minicard-rating">★ ${it.CommunityRating.toFixed(1)}</span>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

async function fetchSeasonsForSeries(seriesId, { signal } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    const r = await makeApiRequest(
      `/Shows/${encodeURIComponent(seriesId)}/Seasons?UserId=${encodeURIComponent(userId)}&Fields=Id,Name,IndexNumber,UserData`,
      { signal }
    );
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items.sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0));
  } catch (e) {
    if (signal?.aborted) return [];
    console.warn("fetchSeasonsForSeries error:", e);
    return [];
  }
}

async function fetchEpisodesFor(seriesId, seasonId, { signal } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    const qp = new URLSearchParams();
    qp.set(
      "Fields",
      "Overview,IndexNumber,ParentIndexNumber,UserData,Id,Name,ImageTags,PrimaryImageAspectRatio,SeriesPrimaryImageTag,ParentBackdropImageTags"
    );
    qp.set("UserId", userId);
    qp.set("Limit", "1000");
    if (seasonId) qp.set("SeasonId", seasonId);

    const r = await makeApiRequest(
      `/Shows/${encodeURIComponent(seriesId)}/Episodes?${qp.toString()}`,
      { signal }
    );
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items.sort((a, b) => {
      const sa = a.ParentIndexNumber ?? 0;
      const sb = b.ParentIndexNumber ?? 0;
      if (sa !== sb) return sa - sb;
      const ea = a.IndexNumber ?? 0;
      const eb = b.IndexNumber ?? 0;
      return ea - eb;
    });
  } catch (e) {
    if (signal?.aborted) return [];
    console.warn("fetchEpisodesFor error:", e);
    return [];
  }
}

function renderSkeleton(root) {
  root.innerHTML = `
    <div class="jmsdm-backdrop" role="dialog" aria-modal="true">
      <div class="jmsdm-card" tabindex="-1">
        <div class="jmsdm-content">
          <div class="jmsdm-hero">
            <div class="jmsdm-topbar">
              <button class="jmsdm-close" aria-label="${config.languageLabels.close || "Kapat"}">✕</button>
            </div>
          </div>
          <div class="jmsdm-body">
            <div class="jmsdm-left">
              <div class="jmsdm-skeleton" style="width:65%;height:18px;margin-top:6px;"></div>
              <div class="jmsdm-skeleton" style="width:45%;height:12px;margin-top:10px;"></div>
              <div class="jmsdm-skeleton" style="width:96%;height:10px;margin-top:18px;"></div>
              <div class="jmsdm-skeleton" style="width:92%;height:10px;margin-top:8px;"></div>
              <div class="jmsdm-skeleton" style="width:78%;height:10px;margin-top:8px;"></div>
              <div style="margin-top:16px;display:flex;gap:10px;">
                <div class="jmsdm-skeleton" style="width:120px;height:36px;"></div>
                <div class="jmsdm-skeleton" style="width:150px;height:36px;"></div>
              </div>
            </div>
            <div class="jmsdm-right">
              <div class="jmsdm-skeleton" style="width:40%;height:12px;margin-top:6px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:12px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:10px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:10px;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function cleanupEventListeners() {
  _currentListeners.forEach(({ element, event, handler }) => {
    if (element && element.removeEventListener) element.removeEventListener(event, handler);
  });
  _currentListeners = [];
}

function cleanupCloseListeners() {
  try {
    _closeListeners.forEach(({ element, event, handler }) => {
      if (element && element.removeEventListener) element.removeEventListener(event, handler);
    });
  } catch {}
  _closeListeners = [];
}

function addCloseListener(element, event, handler) {
  if (!element || !handler) return () => {};
  element.addEventListener(event, handler);
  _closeListeners.push({ element, event, handler });
  return () => {
    try { element.removeEventListener(event, handler); } catch {}
    _closeListeners = _closeListeners.filter(
      l => !(l.element === element && l.event === event && l.handler === handler)
    );
  };
}

function addEventListener(element, event, handler) {
  if (!element || !handler) return () => {};
  element.addEventListener(event, handler);
  _currentListeners.push({ element, event, handler });
  return () => {
    element.removeEventListener(event, handler);
    _currentListeners = _currentListeners.filter(
      l => !(l.element === element && l.event === event && l.handler === handler)
    );
  };
}

function wireCloseHandlers(root, closeFn) {
  const backdrop = root.querySelector(".jmsdm-backdrop");
  const closeBtn = root.querySelector(".jmsdm-close");

  cleanupCloseListeners();
  const handleCloseClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeFn();
  };

  const handleBackdropClick = (e) => {
    const card = root.querySelector(".jmsdm-card");
    if (card && !card.contains(e.target)) closeFn();
  };

  const handleEscape = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeFn();
    }
  };

  addCloseListener(closeBtn, "click", handleCloseClick);
  addCloseListener(backdrop, "mousedown", handleBackdropClick);
  addCloseListener(window, "keydown", handleEscape);

  return cleanupCloseListeners;
}

function focusFirst(root) {
  const close = root.querySelector(".jmsdm-close");
  const card = root.querySelector(".jmsdm-card");
  try {
    if (close && typeof close.focus === "function") close.focus();
    else if (card && typeof card.focus === "function") card.focus();
  } catch {}
}

function forceHideHoverOverlays() {
  try {
    const sel =
      ".swiper .swiper-slide.active, .splide__slide.is-active, .embla__slide.is-selected, " +
      ".flickity-slider .is-selected, .active";
    const slide = document.querySelector(sel);
    if (!slide) return;

    const overlays = slide.querySelectorAll(".jms-details-overlay");
    overlays.forEach((wrap) => {
      try { wrap.classList.remove("is-hover"); } catch {}
      try { wrap.style.display = "none"; } catch {}
    });
  } catch {}
}

export async function closeDetailsModal() {
  if (!_open || _closing) return;
  _closing = true;

  cleanupCloseListeners();
  cleanupEventListeners();

  if (_unbindKeyHandler) {
    _unbindKeyHandler();
    _unbindKeyHandler = null;
  }

  try {
    if (_abort && !_abort.signal.aborted) {
      _abort.abort();
      _abort = null;
    }
  } catch {}

  const root = document.getElementById(MODAL_ID);
  if (root) {
    softStopHeroMedia(root);
    await __animateOutToOrigin(root);
    stopHeroMedia(root);
    try { root.innerHTML = ""; } catch {}
    try { root.remove(); } catch {}
  }

  lockScroll(false);
  forceHideHoverOverlays();

  const snap = _restore;
  _restore = null;
  if (snap) {
    setTimeout(() => { try { restorePreviewState(snap); } catch {} }, 100);
  }

  const lastFocusEl = _lastFocus;
  try {
    if (lastFocusEl && typeof lastFocusEl.focus === "function" && document.body.contains(lastFocusEl)) {
      setTimeout(() => { try { lastFocusEl.focus({ preventScroll: true }); } catch {} }, 50);
    }
  } catch {}

  _open = false;
  _lastFocus = null;
  _openOrigin = null;
  _closing = false;
}

function uniqById(items = [], seen = new Set()) {
  const out = [];
  for (const it of items || []) {
    const id = it?.Id ? String(it.Id) : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

async function getBoxSetForMovieCached(movieId, { signal } = {}) {
  const cached = await CollectionCacheDB.getMovieBoxset(movieId).catch(() => null);

  if (cached && !isStale(cached.updatedAt, TTL_MOVIE_BOXSET)) {
    CollectionCacheDB.idle(async () => {
      try {
        const live = await getBoxSetForMovie(movieId, { signal: _bgAbort?.signal || null });
        await CollectionCacheDB.setMovieBoxset(movieId, live?.id || "", live?.name || "");
      } catch {}
    });
    return cached.boxsetId ? { id: cached.boxsetId, name: cached.boxsetName } : null;
  }

  const live = await getBoxSetForMovie(movieId, { signal });
  await CollectionCacheDB.setMovieBoxset(movieId, live?.id || "", live?.name || "");
  return live;
}

async function getBoxSetForMovie(movieId, { signal } = {}) {
  try {
    const cacheKey = String(movieId || "");
    if (cacheKey && _boxSetCache.has(cacheKey)) return _boxSetCache.get(cacheKey);

    const userId = ApiClient.getCurrentUserId();
    if (!userId || !movieId) return null;

    try {
      const anc = await makeApiRequest(
        `/Items/${encodeURIComponent(movieId)}/Ancestors?UserId=${encodeURIComponent(userId)}`,
        { signal }
      );
      const list = Array.isArray(anc) ? anc : (anc?.Items || []);
      const box = (list || []).find(x => String(x?.Type || "").toLowerCase() === "boxset");
      if (box?.Id) {
        const hit = { id: box.Id, name: box.Name };
        if (cacheKey) _boxSetCache.set(cacheKey, hit);
        return hit;
      }
    } catch (e) {
      if (!signal?.aborted) console.debug("getBoxSetForMovie: ancestors fallback:", e);
    }

    const movieName = (() => {
      try { return (window.__jms_lastDisplayItemName || "").toString().trim(); }
      catch { return ""; }
    })();

    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("IncludeItemTypes", "BoxSet");
    qp.set("Recursive", "true");
    qp.set("Limit", "60");
    qp.set("Fields", "ChildCount");
    if (movieName) qp.set("SearchTerm", movieName);

    let res = await ApiClient.getJSON(`/Items?${qp.toString()}`);
    let candidates = res?.Items || [];

    if (!candidates.length) {
      qp.delete("SearchTerm");
      qp.set("Limit", "1000");
      res = await ApiClient.getJSON(`/Items?${qp.toString()}`);
      candidates = res?.Items || [];
    }

    for (const s of (candidates || []).filter(x => (x?.ChildCount ?? 1) > 0)) {
      const children = await ApiClient.getJSON(`/Items?UserId=${userId}&ParentId=${s.Id}`);
      if ((children?.Items || []).some(x => String(x.Id) === String(movieId))) {
        const hit = { id: s.Id, name: s.Name };
        if (cacheKey) _boxSetCache.set(cacheKey, hit);
        return hit;
      }
    }

    if (cacheKey) _boxSetCache.set(cacheKey, null);
    return null;
  } catch (e) {
    console.warn("getBoxSetForMovie error:", e);
    return null;
  }
}

async function fetchCollectionItems(boxsetId, { signal, limit = 12 } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId || !boxsetId) return [];

    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(boxsetId));
    qp.set("IncludeItemTypes", "Movie");
    qp.set("Limit", String(limit));
    qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData");
    qp.set("SortBy", "ProductionYear,SortName");
    qp.set("SortOrder", "Ascending");

    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    return Array.isArray(r?.Items) ? r.Items : [];
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchCollectionItems error:", e);
    return [];
  }
}

function renderCollectionHtml({ title = "", items = [] } = {}) {
  if (!items.length) {
    return `<div class="jmsdm-empty-state" style="color:rgba(255,255,255,.6);font-size:14px;padding:16px;text-align:center;">
      ${config.languageLabels.collectionNotFound || "Koleksiyon bulunamadı."}
    </div>`;
  }

  const head = title
    ? `<div style="color:rgba(255,255,255,.75);font-size:12px;margin-bottom:8px;">${escapeHtml(title)}</div>`
    : "";

  return `
    ${head}
    ${renderMiniCards(items)}
  `;
}

const TTL_BOXSET_ITEMS = 2 * 24 * 60 * 60 * 1000;

function minimizeItems(items = []) {
  return (items || []).map(x => ({
    Id: x.Id,
    Name: x.Name,
    ProductionYear: x.ProductionYear,
    CommunityRating: x.CommunityRating,
    ImageTags: x.ImageTags,
    PrimaryImageAspectRatio: x.PrimaryImageAspectRatio,
    UserData: x.UserData,
  }));
}

async function fetchCollectionItemsAll(boxsetId, { signal } = {}) {
  const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
  if (!userId || !boxsetId) return [];

  const out = [];
  const seen = new Set();
  let start = 0;
  const PAGE = 200;

  while (true) {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(boxsetId));
    qp.set("IncludeItemTypes", "Movie");
    qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating");
    qp.set("SortBy", "ProductionYear,SortName");
    qp.set("SortOrder", "Ascending");
    qp.set("Limit", String(PAGE));
    qp.set("StartIndex", String(start));

    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const items = Array.isArray(r?.Items) ? r.Items : [];

    for (const it of items) {
      const id = it?.Id ? String(it.Id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }

    if (items.length < PAGE) break;
    start += PAGE;
  }

  return out;
}

function startCollectionLoad(root, movieItem, { signal } = {}) {
  (async () => {
    try {
      if (!root || !movieItem?.Id) return;
      const host = root.querySelector(".jmsdm-collection-host");
      if (!host) return;

      const collectionLabel = config.languageLabels.collectionTitle || "Koleksiyon";
      const box = await getBoxSetForMovieCached(movieItem.Id, { signal });
      if (!_open || signal?.aborted) return;

      if (!box?.id) {
        host.innerHTML = renderCollectionHtml({ title: "", items: [] });
        return;
      }

      const cachedItemsRow = await CollectionCacheDB.getBoxsetItems(box.id).catch(() => null);
      const cachedOk = cachedItemsRow && cachedItemsRow.items?.length && !isStale(cachedItemsRow.updatedAt, TTL_BOXSET_ITEMS);

      if (cachedOk) {
        const filtered = (cachedItemsRow.items || [])
          .filter(x => x?.Id && String(x.Id) !== String(movieItem.Id))
          .slice(0, 12);

        host.innerHTML = renderCollectionHtml({
          title: box.name ? `${collectionLabel}: ${box.name}` : collectionLabel,
          items: filtered
        });

        CollectionCacheDB.idle(async () => {
          try {
            const liveItems = await fetchCollectionItemsAll(box.id, { signal: _bgAbort?.signal || null });
            const minimized = minimizeItems(liveItems);
            await CollectionCacheDB.setBoxsetItems(box.id, minimized);

            const filtered2 = minimized
              .filter(x => x?.Id && String(x.Id) !== String(movieItem.Id))
              .slice(0, 12);

            if (_open && !signal?.aborted && root?.isConnected) {
              host.innerHTML = renderCollectionHtml({
                title: box.name ? `${collectionLabel}: ${box.name}` : collectionLabel,
                items: filtered2
              });
            }
          } catch {}
        });

        return;
      }

      const liveItems = await fetchCollectionItemsAll(box.id, { signal });
      if (!_open || signal?.aborted) return;

      const minimized = minimizeItems(liveItems);
      await CollectionCacheDB.setBoxsetItems(box.id, minimized);

      const filtered = minimized
        .filter(x => x?.Id && String(x.Id) !== String(movieItem.Id))
        .slice(0, 12);

      host.innerHTML = renderCollectionHtml({
        title: box.name ? `${collectionLabel}: ${box.name}` : collectionLabel,
        items: filtered
      });
    } catch (e) {
      if (!signal?.aborted) console.warn("collection load error:", e);
      try {
        const host = root?.querySelector?.(".jmsdm-collection-host");
        if (host) host.innerHTML = renderCollectionHtml({ title: "", items: [] });
      } catch {}
    }
  })();
}

function startRecoLoad(root, movieItem, { signal } = {}) {
  (async () => {
    try {
      if (!root || !movieItem?.Id) return;
      const wrap = root.querySelector(".jmsdm-recos-wrap");
      if (!wrap) return;

      const LIMIT = 12;
      const seen = new Set([String(movieItem.Id)]);
      const picked = [];

      try {
        const sim = await fetchSimilarItems(movieItem.Id, { signal, limit: LIMIT * 2 });
        if (!_open || signal?.aborted) return;
        picked.push(...uniqById(sim, seen));
      } catch {}

      if (picked.length < LIMIT) {
        try {
          const byG = await fetchMoviesByGenres(movieItem.Genres || [], { signal, limit: LIMIT * 2 });
          if (!_open || signal?.aborted) return;
          picked.push(...uniqById(byG, seen));
        } catch {}
      }

      if (picked.length < LIMIT) {
        try {
          const byP = await fetchMoviesByPeople(movieItem.People || [], { signal, limit: LIMIT * 2 });
          if (!_open || signal?.aborted) return;
          picked.push(...uniqById(byP, seen));
        } catch {}
      }

      const final = picked.slice(0, LIMIT);
      wrap.innerHTML = renderMiniCards(final);
    } catch (e) {
      if (!signal?.aborted) console.warn("reco load error:", e);
    }
  })();
}

export async function openDetailsModal({ itemId, serverId = "", preferBackdropIndex = "0", perPage = 6, originEl } = {}) {
  if (!itemId) return;
  const _originResolved = __resolveOriginEl(originEl || document.activeElement);
  const _nextOrigin = { el: _originResolved, rect: __getRectSafe(_originResolved) };

  if (_open) {
    await closeDetailsModal();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  _openOrigin = _nextOrigin;
  _open = true;
  _lastFocus = document.activeElement;
  _abort = new AbortController();
  _bgAbort = new AbortController();
  _restore = capturePreviewState();
  if (_restore) pausePreviewNow(_restore);

  const root = ensureRoot();
  lockScroll(true);
  renderSkeleton(root);
  wireMiniCardDelegation();
  try { root.style.visibility = "hidden"; root.style.opacity = "0"; } catch {}
  _unbindKeyHandler = wireCloseHandlers(root, closeDetailsModal);

  setTimeout(() => { if (_open) focusFirst(root); }, 50);

  let item = null;
  try {
    item = await fetchItemDetailsFull(itemId, { signal: _abort.signal });
  } catch (e) {
    if (_abort.signal.aborted) return;
    console.warn("openDetailsModal: fetchItemDetailsFull error:", e);
  }
  if (!_open || _abort.signal.aborted) return;

  if (!item) {
    root.innerHTML = `
      <div class="jmsdm-backdrop" role="dialog" aria-modal="true">
        <div class="jmsdm-card" tabindex="-1">
          <div class="jmsdm-topbar"><button class="jmsdm-close" aria-label="${config.languageLabels.close || "Kapat"}">✕</button></div>
          <div style="padding:20px;color:rgba(255,255,255,.9);">${config.languageLabels.detailsFetchFailed || "Detaylar alınamadı."}</div>
        </div>
      </div>
    `;
    wireCloseHandlers(root, closeDetailsModal);
    try { root.style.visibility = "visible"; root.style.opacity = "1"; } catch {}
    await __animateInFromOrigin(root);
    return;
  }

  const baseItem = item;
  let seriesItem = null;
  const isEpisode = baseItem?.Type === "Episode";
  if (isEpisode && baseItem?.SeriesId) {
    try {
      seriesItem = await fetchItemDetailsFull(baseItem.SeriesId, { signal: _abort.signal });
    } catch (e) {
      if (!_abort.signal.aborted) console.warn("openDetailsModal: fetch parent series error:", e);
    }
    if (!_open || _abort.signal.aborted) return;
  }

  const displayItem = seriesItem || baseItem;
  const nameBase = safeText(displayItem.Name, config.languageLabels.untitled || "İsimsiz");

  try {
    window.__jms_lastDisplayItemName = safeText(displayItem.Name, "");
  } catch {}

  const epName = isEpisode ? safeText(baseItem.Name, "") : "";
  const name = (isEpisode && epName && epName !== nameBase) ? `${nameBase} — ${epName}` : nameBase;

  const overview = safeText(displayItem.Overview, config.languageLabels.noDescription || "Açıklama yok.");
  const year = displayItem.ProductionYear ? String(displayItem.ProductionYear) : "";
  const rating = safeText(displayItem.OfficialRating, "");
  const community = displayItem.CommunityRating ? String(displayItem.CommunityRating.toFixed?.(1) ?? displayItem.CommunityRating) : "";
  const runtime = fmtRuntime(displayItem.RunTimeTicks);
  const genres = Array.isArray(displayItem.Genres) ? displayItem.Genres.slice(0, 4) : [];
  const typeRaw = safeText(baseItem?.Type || displayItem?.Type, "");
  const type = localizeItemType(typeRaw);

  const btIndex = String(preferBackdropIndex ?? "0");
  const btTag =
    (displayItem.ImageTags?.Backdrop?.[btIndex]) ||
    (Array.isArray(displayItem.BackdropImageTags) ? displayItem.BackdropImageTags[Number(btIndex)] : "") ||
    "";
  const backdropUrl = btTag
    ? withServer(`/Items/${encodeURIComponent(displayItem.Id)}/Images/Backdrop/${encodeURIComponent(btIndex)}?tag=${encodeURIComponent(btTag)}&quality=90&maxWidth=1920`)
    : "";

  const detailsHref = getDetailsUrl(baseItem.Id);
  const isSeries = baseItem.Type === "Series";
  const seriesId = isSeries
    ? baseItem.Id
    : (baseItem.Type === "Season"
        ? baseItem.SeriesId
        : (isEpisode ? baseItem.SeriesId : null));

  const episodeSeasonId = isEpisode ? (baseItem.SeasonId || baseItem.ParentId || null) : null;
  const isMovie = baseItem.Type === "Movie";
  const isFavInitial = !!(baseItem?.UserData?.IsFavorite || displayItem?.UserData?.IsFavorite);

  let isFavorite = isFavInitial;
  let recos = { title: "", items: [] };
  let seasons = [];
  let selectedSeasonId =
    baseItem.Type === "Season"
      ? baseItem.Id
      : (isEpisode ? episodeSeasonId : null);

  if (isSeries && seriesId) {
    seasons = await fetchSeasonsForSeries(seriesId, { signal: _abort.signal });
    if (!_open || _abort.signal.aborted) return;
    selectedSeasonId = seasons[0]?.Id || null;
  } else if (item.Type === "Season" && seriesId) {
    seasons = await fetchSeasonsForSeries(seriesId, { signal: _abort.signal });
    if (!_open || _abort.signal.aborted) return;
  }

  let episodes = [];
  if (seriesId) {
    episodes = await fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });
  }
  if (!_open || _abort.signal.aborted) return;

  let page = 1;
  const totalPages = () => Math.max(1, Math.ceil((episodes.length || 0) / perPage));
  const pageSlice = () => episodes.slice((page - 1) * perPage, (page - 1) * perPage + perPage);

  function wireMiniCardDelegation() {
  if (root.__minicardDelegated) return;
  root.__minicardDelegated = true;

  addEventListener(root, "click", async (e) => {
    const card = e.target?.closest?.(".jmsdm-minicard");
    if (!card || !root.contains(card)) return;

    e.preventDefault();
    e.stopPropagation();

    const id = card.getAttribute("data-itemid");
    if (!id) return;

    try {
      await openDetailsModal({
        itemId: id,
        serverId,
        preferBackdropIndex,
        perPage,
        originEl: card,
      });
    } catch (err) {
      console.warn("openDetailsModal from minicard error:", err);
    }
  });
}

wireMiniCardDelegation();

  function renderEpisodesHtml() {
    const items = pageSlice();
    if (!items.length) {
      return `<div style="color:rgba(255,255,255,.75);font-size:13px;line-height:1.5;">${config.languageLabels.episodeNotFound || "Bölüm bulunamadı."}</div>`;
    }
    return `
      <div class="jmsdm-episodes">
        ${items.map((ep, i) => {
          const s = ep.ParentIndexNumber ?? "";
          const e = ep.IndexNumber ?? "";
          const num = (s !== "" && e !== "") ? `S${s} · E${e}` : String((page - 1) * perPage + i + 1);
          const epName = safeText(ep.Name, config.languageLabels.episode || "Bölüm");
          const img = getEpisodeImageUrlMini(ep, { maxWidth: 260 });
          const epOver = safeText(ep.Overview, "");
          return `
          <div class="jmsdm-ep" data-epid="${ep.Id}">
            <div class="jmsdm-ep-thumb">
              ${
                img
                  ? `<img src="${img}" alt="${escapeHtml(epName)}" loading="lazy" decoding="async">`
                  : `<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>`
              }
            </div>

            <div class="jmsdm-ep-num">${num}</div>

            <div class="jmsdm-ep-main">
              <div class="jmsdm-ep-name">${epName}</div>
              <div class="jmsdm-ep-over">${epOver}</div>
            </div>
          </div>
        `;
        }).join("")}
      </div>
    `;
  }

  function renderRightPanelHtml() {
    if (isMovie) {
      const similarTitle = safeText(recos.title, config.languageLabels.similarItems || "Benzer İçerikler");

      const collectionLabel =
        config.languageLabels.collectionTitle ||
        config.languageLabels.collection ||
        "Koleksiyon";

      return `
        <div class="jmsdm-section-title">${similarTitle}</div>
        <div class="jmsdm-epwrap jmsdm-recos-wrap">
          ${
            (recos?.items && recos.items.length)
              ? renderMiniCards(recos.items)
              : `
                <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
                <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
              `
          }
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">
          ${collectionLabel}
        </div>
        <div class="jmsdm-epwrap jmsdm-collection-wrap">
          <div class="jmsdm-collection-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>
      `;
    }

    const showSeasonUi = seasons.length > 0;
    return `
      <div class="jmsdm-section-title">${seriesId ? (config.languageLabels.episodesTitle || "Bölümler") : (config.languageLabels.infoTitle || "Bilgi")}</div>

      ${showSeasonUi ? `
        <div class="jmsdm-toolbar">
          <div class="jmsdm-select-wrap">
            <select class="jmsdm-select" aria-label="${config.languageLabels.seasonSelect || "Sezon Seç"}">
              ${seasons.map(s => {
                const n = safeText(s.Name, `${config.languageLabels.season || "Sezon"} ${s.IndexNumber ?? ""}`.trim());
                const sel = String(s.Id) === String(selectedSeasonId) ? "selected" : "";
                return `<option value="${s.Id}" ${sel}>${n}</option>`;
              }).join("")}
            </select>
          </div>

          <div class="jmsdm-pager">
            <button class="jmsdm-pagebtn jmsdm-prev" ${page <= 1 ? "disabled" : ""}>${config.languageLabels.prevPage || "Önceki"}</button>
            <span class="jmsdm-pagelabel">${page} / ${totalPages()}</span>
            <button class="jmsdm-pagebtn jmsdm-next" ${page >= totalPages() ? "disabled" : ""}>${config.languageLabels.nextPage || "Sonraki"}</button>
          </div>
        </div>
      ` : (seriesId ? `
        <div class="jmsdm-toolbar">
          <div></div>
          <div class="jmsdm-pager">
            <button class="jmsdm-pagebtn jmsdm-prev" ${page <= 1 ? "disabled" : ""}>${config.languageLabels.prevPage || "Önceki"}</button>
            <span class="jmsdm-pagelabel">${page} / ${totalPages()}</span>
            <button class="jmsdm-pagebtn jmsdm-next" ${page >= totalPages() ? "disabled" : ""}>${config.languageLabels.nextPage || "Sonraki"}</button>
          </div>
        </div>
      ` : "")}

      <div class="jmsdm-epwrap">
        ${renderEpisodesHtml()}
      </div>
    `;
  }

  root.innerHTML = `
    <div class="jmsdm-backdrop" role="dialog" aria-modal="true" aria-label="${name}">
      <div class="jmsdm-card" tabindex="-1">
        <div class="jmsdm-content">
          <div class="jmsdm-hero">
            ${backdropUrl ? `<img src="${backdropUrl}" alt="">` : ""}
            <div class="jmsdm-topbar">
              <button class="jmsdm-close" aria-label="${config.languageLabels.closeButton || "Kapat"}">✕</button>
            </div>

            <div class="jmsdm-heroTitleWrap" aria-hidden="true">
              <div class="jmsdm-heroTitle">${escapeHtml(name)}</div>
            </div>
          </div>

          <div class="jmsdm-body">
            <div class="jmsdm-left">
              <div class="jmsdm-meta">
                ${year ? `<span class="jmsdm-pill">${year}</span>` : ""}
                ${rating ? `<span class="jmsdm-pill">${rating}</span>` : ""}
                ${runtime ? `<span class="jmsdm-pill">${runtime}</span>` : ""}
                ${community ? `<span class="jmsdm-pill">★ ${community}</span>` : ""}
                ${type ? `<span class="jmsdm-pill">${type}</span>` : ""}
              </div>

              ${genres.length ? `<div class="jmsdm-meta">${genres.map(g => `<span class="jmsdm-pill">${g}</span>`).join("")}</div>` : ""}

              <h2 class="jmsdm-title">${name}</h2>

              <div class="jmsdm-actions">
                <button class="jmsdm-btn primary jmsdm-play">
                  ${icon("M8 5v14l11-7z")} ${config.languageLabels.playNowLabel || "Şimdi Oynat"}
                </button>
                <button class="jmsdm-btn jmsdm-openpage">
                  ${icon("M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z")} ${config.languageLabels.goToPageLabel || "Sayfaya Git"}
                </button>
                <button class="jmsdm-btn jmsdm-fav" aria-pressed="${isFavorite ? "true" : "false"}">
                  ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
                  ${isFavorite ? (config.languageLabels.removeFromFavorites || "Favoriden Çıkar") : (config.languageLabels.addToFavorites || "Favoriye Al")}
                </button>
              </div>
              <div class="jmsdm-overview">${overview}</div>
              <div class="jmsdm-tmdb-reviews" style="margin-top:14px;"></div>
            </div>

            <div class="jmsdm-right">
              ${renderRightPanelHtml()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  _unbindKeyHandler = wireCloseHandlers(root, closeDetailsModal);
  try { root.style.visibility = "visible"; root.style.opacity = "1"; } catch {}

  await __animateInFromOrigin(root);

  if (isMovie) {
    startRecoLoad(root, baseItem, { signal: _abort.signal });
    startCollectionLoad(root, baseItem, { signal: _abort.signal });
  }

  wireOverviewToggle(root);
  startHeroTrailer(root, displayItem, { signal: _abort.signal }).catch(() => {});
  loadTmdbReviewsInto(root, displayItem, { signal: _abort.signal });

  const playBtn = root.querySelector(".jmsdm-play");
  const initialResumeTicks = getResumeTicksFromItem(baseItem);
  setPlayButtonLabel(playBtn, initialResumeTicks > 0);

  if (
    initialResumeTicks <= 0 &&
    (baseItem?.Type === "Series" || baseItem?.Type === "Season")
  ) {
    getResumeTicksForContainer(baseItem.Id, { signal: _abort.signal })
      .then((t) => {
        if (!_open || _abort.signal.aborted) return;
        setPlayButtonLabel(playBtn, t > 0);
      })
      .catch(() => {});
  }

  const openBtn = root.querySelector(".jmsdm-openpage");
  const favBtn  = root.querySelector(".jmsdm-fav");

  const updateFavUi = () => {
    if (!favBtn) return;
    favBtn.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    favBtn.innerHTML = `
      ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
      ${isFavorite ? (config.languageLabels.removeFromFavorites || "Favoriden Çıkar") : (config.languageLabels.addToFavorites || "Favoriye Al")}
    `;
    favBtn.classList.toggle("active", !!isFavorite);
  };

  updateFavUi();

  const playHandler = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      playBtn.disabled = true;
      await playNow(baseItem.Id);
      closeDetailsModal();
    } catch (err) {
      console.error("Modal play error:", err);
      window.showMessage?.(config.languageLabels.playStartFailed || "Oynatma başlatılamadı", "error");
    } finally {
      playBtn.disabled = false;
    }
  };

  const openHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      window.location.hash = String(detailsHref || "").replace(/^#/, "");
      closeDetailsModal();
    } catch {
      window.location.href = detailsHref;
    }
  };

  addEventListener(playBtn, "click", playHandler);
  addEventListener(openBtn, "click", openHandler);

  if (favBtn) {
    addEventListener(favBtn, "click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        favBtn.disabled = true;
        const next = !isFavorite;
        const ok = await toggleFavorite(baseItem.Id, next, { signal: _abort?.signal });
        if (ok) {
          isFavorite = next;
          try {
            if (baseItem?.UserData) baseItem.UserData.IsFavorite = isFavorite;
            if (displayItem?.UserData) displayItem.UserData.IsFavorite = isFavorite;
          } catch {}
          updateFavUi();
          window.showMessage?.(
            isFavorite
              ? (config.languageLabels.addedToFavorites || "Favorilere eklendi")
              : (config.languageLabels.removedFromFavorites || "Favorilerden çıkarıldı"),
            "success"
          );
        } else {
          window.showMessage?.(config.languageLabels.favoriteError || "Favori işlemi başarısız", "error");
        }
      } catch (err) {
        console.warn("fav click error:", err);
        window.showMessage?.(config.languageLabels.favoriteError || "Favori işlemi başarısız", "error");
      } finally {
        try { favBtn.disabled = false; } catch {}
      }
    });
  }

  function wireEpisodeClicks() {
    root.querySelectorAll(".jmsdm-ep").forEach((el) => {
      const clickHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const epId = el.getAttribute("data-epid");
        if (!epId) return;
        try {
          await playNow(epId);
          closeDetailsModal();
        } catch (err) {
          console.error("Episode play error:", err);
          window.showMessage?.(config.languageLabels.episodePlayFailed || "Bölüm oynatılamadı", "error");
        }
      };
      addEventListener(el, "click", clickHandler);
    });
  }

  wireEpisodeClicks();

  function wireMiniCardClicks() {
    root.querySelectorAll(".jmsdm-minicard").forEach((el) => {
      const clickHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.getAttribute("data-itemid");
        if (!id) return;
        try {
          await openDetailsModal({ itemId: id, serverId, preferBackdropIndex, perPage });
        } catch (err) {
          console.warn("openDetailsModal from minicard error:", err);
        }
      };
      addEventListener(el, "click", clickHandler);
    });
  }

  async function rerenderRight() {
    const right = root.querySelector(".jmsdm-right");
    if (!right) return;
    const currentScroll = right.scrollTop;

    right.innerHTML = renderRightPanelHtml();
    if (isMovie) {
      wireMiniCardClicks();
      right.scrollTop = currentScroll;
      return;
    }

    const prevBtn = right.querySelector(".jmsdm-prev");
    const nextBtn = right.querySelector(".jmsdm-next");

    if (prevBtn) {
      addEventListener(prevBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (page > 1) { page--; rerenderRight(); }
      });
    }

    if (nextBtn) {
      addEventListener(nextBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (page < totalPages()) { page++; rerenderRight(); }
      });
    }

    const sel = right.querySelector(".jmsdm-select");
    if (sel) {
      addEventListener(sel, "change", async (e) => {
        const v = e.target?.value || "";
        if (!v || !seriesId) return;
        selectedSeasonId = v;
        page = 1;

        try {
          right.innerHTML = `<div class="jmsdm-skeleton" style="width:40%;height:12px;margin-top:6px;"></div>`;
          episodes = await fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });
          if (!_open || _abort.signal.aborted) return;
          rerenderRight();
        } catch (err) {
          if (_abort.signal.aborted) return;
          console.warn("season change episodes error:", err);
          episodes = [];
          rerenderRight();
        }
      });
    }

    wireEpisodeClicks();
    right.scrollTop = currentScroll;
  }

  if (isMovie) wireMiniCardClicks();

  const initialPrev = root.querySelector(".jmsdm-prev");
  const initialNext = root.querySelector(".jmsdm-next");
  const initialSelect = root.querySelector(".jmsdm-select");

  if (initialPrev) {
    addEventListener(initialPrev, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (page > 1) { page--; rerenderRight(); }
    });
  }

  if (initialNext) {
    addEventListener(initialNext, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (page < totalPages()) { page++; rerenderRight(); }
    });
  }

  if (initialSelect) {
    addEventListener(initialSelect, "change", async (e) => {
      const v = e.target?.value || "";
      if (!v || !seriesId) return;
      selectedSeasonId = v;
      page = 1;
      try {
        episodes = await fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });
        if (!_open || _abort.signal.aborted) return;
        rerenderRight();
      } catch (err) {
        if (_abort.signal.aborted) return;
        episodes = [];
        rerenderRight();
      }
    });
  }

  focusFirst(root);
  window.__lastModalItemId = itemId;
}
