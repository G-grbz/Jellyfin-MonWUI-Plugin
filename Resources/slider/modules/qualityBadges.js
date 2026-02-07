import {
  getCachedQuality,
  setCachedQuality,
  clearQualityCache,
  getQualitySnapshot
} from './cacheManager.js';

import { fetchItemDetails } from './api.js';
import { getVideoQualityText } from "./containerUtils.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

const config = getConfig();
const QB_VER = '4';
const STICKY_MODE = true;
const BATCH_SIZE = 24;
const MAX_CONCURRENCY = 3;
const MUTATION_DEBOUNCE_MS = 80;
const MEMORY_HINTS_MAX = 1000;
const HAS_RIC = typeof requestIdleCallback === 'function';
function idle(fn) {
  if (HAS_RIC) return requestIdleCallback(fn, { timeout: 250 });
  return setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 0);
}

function isAbs(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function normalizeIconSrc(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (isAbs(s)) return s;
  if (s.startsWith('./slider/src/images/quality/')) {
    return withServer(s.replace(/^\.\//, '/web/'));
  }
  if (s.startsWith('/slider/src/images/quality/')) {
    return withServer('/web' + s);
  }
  if (s.startsWith('/web/slider/src/images/quality/')) {
    return withServer(s);
  }
  return s;
}

let snapshotMap = null;
let processingQueue = [];
let isDraining = false;
let active = 0;
let mo = null;

const observedCards = new WeakSet();
const memoryQualityHints = new Map();
const inflightById = new Map();
const VIDEO_RE = /(movie|episode|film|bölüm)/i;
const NONVIDEO_RE = /(series|season|person|collection|boxset|folder|genre|studio|music|artist|album|audio|photo|image)/i;

function getItemIdFromCard(card) {
  try {
    const cached = card?.dataset?.qbItemId;
    if (cached) return cached;

    const id =
      card?.getAttribute?.('data-id') ||
      card?.closest?.('[data-id]')?.getAttribute('data-id') ||
      card?.dataset?.id ||
      null;

    if (id && card?.dataset) card.dataset.qbItemId = id;
    return id;
  } catch {
    return null;
  }
}

function getCardKind(card) {
  const attrType =
    card?.getAttribute?.('data-type') ||
    card?.closest?.('[data-type]')?.getAttribute('data-type') ||
    card?.dataset?.type ||
    '';

  const rawIndicator = card?.querySelector?.('.itemTypeIndicator')?.textContent || '';

  const kindKey =
    `${String(attrType || '').toLowerCase().trim()}|${String(rawIndicator || '').toLowerCase().trim()}`;

  try {
    if (card?.dataset?.qbKindKey === kindKey && card?.dataset?.qbKind) {
      return card.dataset.qbKind;
    }
  } catch {}

  const t = String(attrType || rawIndicator).toLowerCase().trim();
  if (t) {
    let kind = 'unknown';
    if (NONVIDEO_RE.test(t)) kind = 'nonvideo';
    else if (VIDEO_RE.test(t)) kind = 'video';

    try {
      if (card?.dataset) {
        card.dataset.qbKindKey = kindKey;
        card.dataset.qbKind = kind;
      }
    } catch {}

    return kind;
  }

  return 'unknown';
}

export function primeQualityFromItems(items = []) {
  for (const it of items) {
    try {
      if (!it?.Id) continue;
      if (!['Movie', 'Episode'].includes(it.Type)) continue;

      const vs = it.MediaStreams?.find(s => s.Type === 'Video');
      if (!vs) continue;

      const q = getVideoQualityText(vs);
      if (!q) continue;

      memoryQualityHints.set(it.Id, q);
      setCachedQuality(it.Id, q, it.Type);

      try { snapshotMap?.set(it.Id, q); } catch {}

      if (memoryQualityHints.size > MEMORY_HINTS_MAX) {
        const firstKey = memoryQualityHints.keys().next().value;
        memoryQualityHints.delete(firstKey);
      }
    } catch {}
  }
}

export function annotateDomWithQualityHints(root = document) {
  try {
    const applyOne = (card) => {
      const id = getItemIdFromCard(card);
      if (!id) return;

      const q =
        card.dataset.quality ||
        memoryQualityHints.get(id) ||
        snapshotMap?.get(id);

      if (q && !card.dataset.quality) card.dataset.quality = q;
    };

    if (
      root?.nodeType === Node.ELEMENT_NODE &&
      root.matches?.('.cardImageContainer, .cardOverlayContainer')
    ) {
      applyOne(root);
    }

    const nodes = root.querySelectorAll?.('.cardImageContainer, .cardOverlayContainer') || [];
    nodes.forEach(applyOne);
  } catch {}
}

export function addQualityBadge(card, itemId = null) {
  if (!card || !card.isConnected) return;

  const kind = getCardKind(card);
  if (kind === 'nonvideo') return;

  itemId = itemId || getItemIdFromCard(card);
  if (!itemId) return;

  if (card.querySelector('.quality-badge')) return;
  if (card.dataset.qbMounted === '1') return;
  card.dataset.qbMounted = '1';

  handleCard(card);
}

export function initializeQualityBadges() {
  if (!config?.enableQualityBadges) return () => {};
  if (window.qualityBadgesInitialized) return cleanupQualityBadges;

  ensureBadgeStyle();

  try { snapshotMap = getQualitySnapshot() || new Map(); }
  catch { snapshotMap = new Map(); }

  try { annotateDomWithQualityHints(document); } catch {}

  initObservers();

  window.qualityBadgesInitialized = true;
  return cleanupQualityBadges;
}

export function cleanupQualityBadges() {
  try { if (mo) mo.disconnect(); } catch {}

  mo = null;

  processingQueue = [];
  active = 0;
  isDraining = false;
  try {
    for (const v of inflightById.values()) {
      try { v?.ctrl?.abort('qb-cleanup'); } catch {}
    }
  } catch {}
  inflightById.clear();

  window.qualityBadgesInitialized = false;
  snapshotMap = null;
}

export function removeAllQualityBadgesFromDOM() {
  if (STICKY_MODE) return;
  document.querySelectorAll('.quality-badge').forEach(el => el.remove());
}

export function rebuildQualityBadges() {
  cleanupQualityBadges();
  if (!STICKY_MODE) removeAllQualityBadgesFromDOM();
  initializeQualityBadges();
}

export function clearQualityBadgesCacheAndRefresh() {
  try {
    clearQualityCache();
  } finally {
    document.querySelectorAll('.quality-badge').forEach(el => el.remove());
    rebuildQualityBadges();
  }
}

function ensureBadgeStyle() {
  if (document.getElementById('quality-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'quality-badge-style';
  style.textContent = `
    .quality-badge {
      position: absolute;
      top: 0;
      left: 0;
      color: white;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      z-index: 10;
      pointer-events: none;
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0,0,0,.6);
    }
    .quality-badge .quality-text {
      border-radius: 6px;
      padding: 3px 6px;
      line-height: 1;
      font-size: 12px;
      letter-spacing: .2px;
      gap: 2px;
      display: flex;
      flex-direction: row;
    }
    .quality-badge img.quality-icon,
    .quality-badge img.range-icon,
    .quality-badge img.codec-icon {
      width: 24px !important;
      height: 18px !important;
      background: rgba(28,28,46,.9);
      border-radius: 4px;
      padding: 1px;
      display: inline-block;
      margin-top: 2px;
    }
  `;
  document.head.appendChild(style);
}

function decodeEntities(str = '') {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function injectQualityMarkupSafely(container, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const imgs = tmp.querySelectorAll('img');
  imgs.forEach(img => {
    const src = String(img.getAttribute('src') || '');
    const cls = String(img.getAttribute('class') || '');
    const classOk = /(quality-icon|range-icon|codec-icon)/.test(cls);
    const srcOk =
      src.startsWith('./slider/src/images/quality/') ||
      src.startsWith('/slider/src/images/quality/') ||
      src.startsWith('/web/slider/src/images/quality/');

    if (classOk && srcOk) {
      const safeImg = document.createElement('img');
      safeImg.className = cls;
      safeImg.alt = img.getAttribute('alt') || '';
      safeImg.src = normalizeIconSrc(src);
      container.appendChild(safeImg);
    }
  });

  if (!container.childNodes.length) {
    container.textContent = html.replace(/<[^>]+>/g, '');
  }
}

function createBadge(card, qualityText) {
  if (!card?.isConnected) return;

  const kind = getCardKind(card);
  if (kind === 'nonvideo') return;

  if (card.querySelector('.quality-badge')) return;
  if (!card.dataset.quality && qualityText) card.dataset.quality = qualityText;

  const badge = document.createElement('div');
  badge.className = 'quality-badge';

  const span = document.createElement('span');
  span.className = 'quality-text';

  const hasImgMarkup = /<\s*img/i.test(qualityText) || /&lt;\s*img/i.test(qualityText);
  if (hasImgMarkup) {
    const decoded = decodeEntities(qualityText);
    injectQualityMarkupSafely(span, decoded);
  } else {
    span.textContent = String(qualityText || '');
  }

  badge.appendChild(span);

  card.dataset.qbVer = QB_VER;
  if (STICKY_MODE) card.dataset.qbSticky = '1';

  card.appendChild(badge);
}

async function fetchAndCacheQuality(itemId) {
  const existing = inflightById.get(itemId);
  if (existing?.p) return existing.p;

  const ctrl = new AbortController();

  const p = (async () => {
    try {
      const itemDetails = await fetchItemDetails(itemId, { signal: ctrl.signal });
      if (!itemDetails) return null;

      if (itemDetails.Type !== 'Movie' && itemDetails.Type !== 'Episode') return null;

      const videoStream = itemDetails.MediaStreams?.find(s => s.Type === "Video");
      if (!videoStream) return null;

      const quality = getVideoQualityText(videoStream);
      if (!quality) return null;

      await setCachedQuality(itemId, quality, itemDetails.Type);
      memoryQualityHints.set(itemId, quality);
      try { snapshotMap?.set(itemId, quality); } catch {}

      if (memoryQualityHints.size > MEMORY_HINTS_MAX) {
        const firstKey = memoryQualityHints.keys().next().value;
        memoryQualityHints.delete(firstKey);
      }

      return quality;
    } catch (error) {
      if (error?.name !== 'QuotaExceededError' && error?.name !== 'AbortError') {
        console.error('Kalite bilgisi alınırken hata oluştu:', error);
      }
      return null;
    }
  })().finally(() => {
    inflightById.delete(itemId);
  });

  inflightById.set(itemId, { p, ctrl });
  return p;
}

function enqueueCard(card, itemId) {
  if (!card?.isConnected) return;
  if (card.dataset.qbQueued === '1') return;
  card.dataset.qbQueued = '1';

  processingQueue.push({ card, itemId });
  if (!isDraining) drainQueueSoon();
}

function drainQueueSoon() {
  isDraining = true;
  setTimeout(drainQueue, 0);
}

function drainQueue() {
  let allot = Math.min(BATCH_SIZE, processingQueue.length);

  while (allot-- > 0 && active < MAX_CONCURRENCY) {
    const job = processingQueue.shift();
    if (!job) break;

    active++;
    processCard(job.card, job.itemId)
      .catch(() => {})
      .finally(() => {
        active--;
        if (job.card?.dataset) job.card.dataset.qbQueued = '0';

        if (processingQueue.length) {
          setTimeout(drainQueue, 10);
        } else {
          isDraining = false;
        }
      });
  }

  if (processingQueue.length && active < MAX_CONCURRENCY) {
    setTimeout(drainQueue, 10);
  } else {
    isDraining = false;
  }
}

async function processCard(card, itemId) {
  if (!card?.isConnected) return;
  if (card.querySelector('.quality-badge')) return;

  const kind = getCardKind(card);
  if (kind === 'nonvideo') return;

  const hinted = card.dataset?.quality || memoryQualityHints.get(itemId) || snapshotMap?.get(itemId);
  if (hinted) { createBadge(card, hinted); return; }

  const cachedQuality = await getCachedQuality(itemId);
  if (cachedQuality) { createBadge(card, cachedQuality); return; }
  if (kind === 'unknown') return;

  const quality = await fetchAndCacheQuality(itemId);
  if (quality && card.isConnected) createBadge(card, quality);
}

function initObservers() {
  try { mo?.disconnect(); } catch {}

  const pending = new Set();

  const flushPending = () => {
    if (!pending.size) return;

    const toProcess = Array.from(pending);
    pending.clear();

    for (const node of toProcess) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;

      if (node.classList?.contains('cardImageContainer') || node.classList?.contains('cardOverlayContainer')) {
        handleCard(node);
      } else if (node.querySelectorAll) {
        node.querySelectorAll('.cardImageContainer, .cardOverlayContainer').forEach(handleCard);
      }
    }
  };

  const debouncedFlush = debounce(flushPending, MUTATION_DEBOUNCE_MS);

  mo = new MutationObserver((mutations) => {
    let hasAdd = false;
    for (const m of mutations) {
      if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
      hasAdd = true;
      for (const n of m.addedNodes) pending.add(n);
    }
    if (hasAdd) debouncedFlush();
  });

  const initial = Array.from(document.querySelectorAll('.cardImageContainer, .cardOverlayContainer'));
  let idx = 0;

  const scanStep = (deadline) => {
    const start = performance.now();
    while (idx < initial.length) {
      handleCard(initial[idx++]);

      if (HAS_RIC) {
        if (deadline?.didTimeout) break;
        if ((deadline?.timeRemaining?.() ?? 0) < 6) break;
      } else {
        if (performance.now() - start > 12) break;
      }
    }
    if (idx < initial.length) idle(scanStep);
  };

  idle(scanStep);
  mo.observe(document.body, { childList: true, subtree: true });
}

function handleCard(card) {
  const kind = getCardKind(card);
  if (kind === 'nonvideo') return;
  annotateDomWithQualityHints(card);

  if (!card.querySelector('.quality-badge')) {
    const itemId = getItemIdFromCard(card);
    if (itemId) enqueueCard(card, itemId);
  }
}

function debounce(fn, wait = 50) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}
