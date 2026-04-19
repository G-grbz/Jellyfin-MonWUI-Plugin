import { makeApiRequest, fetchItemDetailsFull, getDetailsUrl, playNow, fetchLocalTrailers, pickBestLocalTrailer, getVideoStreamUrl, updateFavoriteStatus, getEmbyHeaders, getSessionInfo } from "/Plugins/JMSFusion/runtime/api.js";
import { withServer } from "./jfUrl.js";
import { getConfig, getDetailsModalRuntimeConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";
import { formatOfficialRatingLabel, getYoutubeEmbedUrl } from "./utils.js";
import { getGlobalTmdbApiKey, sanitizeTmdbApiKey } from "./jmsPluginConfig.js";
import { ensureStudioHubLogoFromTmdb, ensureStudioHubManualEntry, JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT } from "./studioHubsShared.js";
import { showNotification } from "./player/ui/notification.js";
import { WATCHLIST_MODAL_ID, getWatchlistButtonText, getWatchlistTabKey, getWatchlistToast, openWatchlistModal } from "./watchlist.js";

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
const _autoAddStudioHubPendingIds = new Set();
const _autoAddedStudioHubIds = new Set();
const _autoStudioHubLogoPendingIds = new Set();
const _autoStudioHubLogoResolvedIds = new Set();
const TTL_MOVIE_BOXSET = 7 * 24 * 60 * 60 * 1000;
const NESTED_MODAL_SCROLL_ALLOW_SELECTOR = [
  `#${MODAL_ID} .jmsdm-card`,
  `#${WATCHLIST_MODAL_ID}.visible .monwuiwl-card`,
  `#${WATCHLIST_MODAL_ID}.visible .monwuiwl-share-card`
].join(", ");

function notifyDetailsModalPlay(itemId) {
  try {
    window.dispatchEvent(new CustomEvent("jms:details-modal-play", {
      detail: { itemId: String(itemId || "") },
    }));
  } catch {}
}

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

function __ensureModalVisible(root) {
  try {
    if (!root) return;
    const backdropEl = root?.querySelector?.(".jmsdm-backdrop");
    const cardEl = root?.querySelector?.(".jmsdm-card");
    root.style.visibility = "visible";
    root.style.opacity = "1";
    if (backdropEl) backdropEl.style.opacity = "1";
    if (cardEl) {
      cardEl.style.transform = "";
      cardEl.style.opacity = "1";
    }
  } catch {}
}

async function __animateInFromOrigin(root) {
  try {
    if (__prefersReducedMotion()) {
      __ensureModalVisible(root);
      return;
    }
    const originRect = _openOrigin?.rect || null;
    if (!originRect) {
      __ensureModalVisible(root);
      return;
    }

    const backdropEl = root?.querySelector?.(".jmsdm-backdrop");
    const cardEl = root?.querySelector?.(".jmsdm-card");
    if (!cardEl || !cardEl.getBoundingClientRect) {
      __ensureModalVisible(root);
      return;
    }
    const toRect = cardEl.getBoundingClientRect();
    if (!toRect || toRect.width < 10 || toRect.height < 10) {
      __ensureModalVisible(root);
      return;
    }

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

    __ensureModalVisible(root);
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

function ensureLocalCommentStyles() {
  if (document.getElementById(LOCAL_COMMENT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = LOCAL_COMMENT_STYLE_ID;
  style.textContent = `
    #${MODAL_ID} .jmsdm-local-comments {
      border-top: 1px solid var(--monwui-border-light);
      margin-top: var(--monwui-gap-xl);
      padding-top: var(--monwui-gap-lg);
    }

    #${MODAL_ID} .jmsdm-local-comments-head {
      margin-bottom: var(--monwui-gap-md);
    }

    #${MODAL_ID} .jmsdm-comments-compose {
      background: linear-gradient(180deg, hsla(0,0%,100%,.05), hsla(0,0%,100%,.03));
      border: 1px solid var(--monwui-border-light);
      border-radius: var(--monwui-radius-card);
      display: flex;
      flex-direction: column;
      gap: var(--monwui-gap-md);
      margin-bottom: var(--monwui-gap-lg);
      padding: var(--monwui-gap-lg);
    }

    #${MODAL_ID} .jmsdm-comments-textarea {
      background: rgba(7,9,15,.52);
      border: 1px solid hsla(0,0%,100%,.08);
      border-radius: var(--monwui-radius-input);
      color: var(--monwui-text-primary);
      font: inherit;
      line-height: 1.6;
      min-height: 110px;
      outline: none;
      padding: 12px 14px;
      resize: vertical;
      transition: border-color var(--monwui-transition-fast), box-shadow var(--monwui-transition-fast);
    }

    #${MODAL_ID} .jmsdm-comments-textarea:focus {
      border-color: rgba(255,183,3,.38);
      box-shadow: 0 0 0 3px rgba(255,183,3,.12);
    }

    #${MODAL_ID} .jmsdm-comments-textarea::placeholder {
      color: var(--monwui-text-muted);
    }

    #${MODAL_ID} .jmsdm-comments-textarea:disabled {
      cursor: not-allowed;
      opacity: .72;
    }

    #${MODAL_ID} .jmsdm-comments-compose-meta {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: var(--monwui-gap-sm);
      justify-content: space-between;
    }

    #${MODAL_ID} .jmsdm-comments-hint {
      color: var(--monwui-text-tertiary);
      font-size: 12px;
      line-height: 1.5;
    }

    #${MODAL_ID} .jmsdm-comments-charcount {
      color: var(--monwui-text-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    #${MODAL_ID} .jmsdm-comments-compose-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--monwui-gap-sm);
    }

    #${MODAL_ID} .jmsdm-comments-loading {
      color: var(--monwui-text-tertiary);
      font-size: 13px;
      line-height: 1.6;
    }

    #${MODAL_ID} .jmsdm-review.is-local-own {
      background: linear-gradient(180deg, rgba(255,183,3,.08), rgba(255,183,3,.02));
      border-left-color: rgba(255,207,110,.92);
    }

    #${MODAL_ID} .jmsdm-review-author {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    #${MODAL_ID} .jmsdm-review-meta-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    #${MODAL_ID} .jmsdm-local-comment-badge,
    #${MODAL_ID} .jmsdm-local-comment-edited {
      background: rgba(255,183,3,.14);
      border: 1px solid rgba(255,183,3,.22);
      border-radius: var(--monwui-radius-chip);
      color: #ffe1a1;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .04em;
      padding: 3px 8px;
      text-transform: uppercase;
    }

    #${MODAL_ID} .jmsdm-local-comment-edited {
      background: hsla(0,0%,100%,.06);
      border-color: hsla(0,0%,100%,.08);
      color: var(--monwui-text-tertiary);
    }

    #${MODAL_ID} .jmsdm-local-comment-toolbar {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: var(--monwui-gap-sm);
      justify-content: space-between;
      margin-top: var(--monwui-gap-sm);
    }

    #${MODAL_ID} .jmsdm-local-comment-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    #${MODAL_ID} .jmsdm-comment-action {
      background: none;
      border: 1px solid hsla(0,0%,100%,.1);
      border-radius: var(--monwui-radius-chip);
      color: var(--monwui-text-secondary);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .03em;
      padding: 6px 10px;
      transition: all var(--monwui-transition-fast);
    }

    #${MODAL_ID} .jmsdm-comment-action:hover:not(:disabled) {
      background: hsla(0,0%,100%,.08);
      border-color: hsla(0,0%,100%,.18);
      color: var(--monwui-text-primary);
    }

    #${MODAL_ID} .jmsdm-comment-action.danger:hover:not(:disabled) {
      background: rgba(255,82,82,.12);
      border-color: rgba(255,82,82,.22);
      color: #ffb3b3;
    }

    #${MODAL_ID} .jmsdm-comment-action:disabled {
      cursor: not-allowed;
      opacity: .55;
    }

    @media (max-width: 768px) {
      #${MODAL_ID} .jmsdm-comments-compose {
        padding: var(--monwui-gap-md);
      }

      #${MODAL_ID} .jmsdm-local-comment-toolbar {
        align-items: flex-start;
        flex-direction: column;
      }

      #${MODAL_ID} .jmsdm-local-comment-actions {
        justify-content: flex-start;
      }
    }

    @media (max-width: 480px) {
      #${MODAL_ID} .jmsdm-comments-compose-meta {
        align-items: flex-start;
        flex-direction: column;
      }

      #${MODAL_ID} .jmsdm-comments-compose-actions .jmsdm-btn {
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

const LS_TMDB_LANG = 'jms_tmdb_reviews_lang';
const LOCAL_COMMENTS_ENDPOINT = "/Plugins/JMSFusion/comments";
const LOCAL_COMMENT_MAX_LENGTH = 2000;
const LOCAL_COMMENT_STYLE_ID = "jms-details-modal-comments-style";


async function getTmdbApiKey() {
  const direct = sanitizeTmdbApiKey(config?.TmdbApiKey || config?.tmdbApiKey || '');
  if (direct) return direct;
  try {
    return await getGlobalTmdbApiKey();
  } catch {}
  return '';
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function getCommentsUserContext() {
  let userId = "";
  let userName = "";

  try {
    const api = window.ApiClient || window.apiClient || null;
    userId = safeText(
      api?.getCurrentUserId?.() ||
      api?._currentUserId ||
      getSessionInfo?.()?.userId,
      ""
    );
    userName = safeText(
      api?._currentUser?.Name ||
      api?._currentUser?.Username ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName"),
      ""
    );
  } catch {}

  return { userId, userName };
}

function buildLocalCommentHeaders(extra = {}) {
  const { userId, userName } = getCommentsUserContext();
  const headers = getEmbyHeaders({
    Accept: "application/json",
    ...extra,
  });

  if (userId) headers["X-Emby-UserId"] = userId;
  if (userName) headers["X-JMSFusion-UserName"] = userName;

  return headers;
}

async function requestLocalComments(path = "", options = {}) {
  const response = await fetch(withServer(`${LOCAL_COMMENTS_ENDPOINT}${path}`), {
    method: options.method || "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: buildLocalCommentHeaders(options.headers || {}),
    body: options.body,
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = await response.json().catch(() => null);
      message = safeText(json?.error || json?.message, message);
    } catch {
      const text = await response.text().catch(() => "");
      message = safeText(text, message);
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json().catch(() => ({}));
}

async function fetchLocalComments(itemId, { signal } = {}) {
  if (!itemId) return { comments: [] };
  return requestLocalComments(`/items/${encodeURIComponent(itemId)}`, { signal });
}

async function upsertLocalComment(itemId, content, { signal } = {}) {
  return requestLocalComments(`/items/${encodeURIComponent(itemId)}`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: String(content || ""),
    }),
  });
}

async function deleteLocalComment(commentId, { signal } = {}) {
  if (!commentId) return null;
  return requestLocalComments(`/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
    signal,
  });
}

function formatLocalCommentDate(ts) {
  const n = Number(ts || 0);
  if (!(n > 0)) return "";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(n));
  } catch {
    return new Date(n).toISOString().slice(0, 16).replace("T", " ");
  }
}

function renderLocalCommentsHtml(comments = [], { currentUserId = "", deleteBusyId = "" } = {}) {
  if (!comments.length) {
    return `<div style="color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;">${config.languageLabels.localCommentsEmpty || "Henüz yerel yorum yok. İlk yorumu sen yaz."}</div>`;
  }

  return `
    <div class="jmsdm-reviews">
      ${comments.map((comment) => {
        const commentId = safeText(comment?.Id);
        const reviewKey = `local:${commentId || Math.random().toString(36).slice(2)}`;
        const author = escapeHtml(safeText(comment?.OwnerUserName, config.languageLabels.localCommentsUserFallback || "Kullanıcı"));
        const own = normalizeIdentity(comment?.OwnerUserId) === normalizeIdentity(currentUserId);
        const createdAt = Number(comment?.CreatedAtUtc || 0);
        const updatedAt = Number(comment?.UpdatedAtUtc || 0);
        const isEdited = updatedAt > 0 && createdAt > 0 && updatedAt - createdAt > 1000;
        const date = escapeHtml(formatLocalCommentDate(updatedAt || createdAt));
        const fullHtml = escapeHtml(safeText(comment?.Content, "")).replace(/\n/g, "<br>");
        const plain = safeText(comment?.Content, "");
        const isLong = plain.length > 220;
        const deleting = commentId && commentId === deleteBusyId;

        _reviewHtmlStore.set(reviewKey, { fullHtml, shortHtml: fullHtml, plain });

        return `
          <div class="jmsdm-review${own ? " is-local-own" : ""}" data-reviewid="${escapeHtml(reviewKey)}" data-comment-id="${escapeHtml(commentId)}">
            <div class="jmsdm-review-head">
              <div class="jmsdm-review-author">
                ${author}
                ${own ? `<span class="jmsdm-local-comment-badge">${config.languageLabels.localCommentsOwnBadge || "Sen"}</span>` : ""}
              </div>
              <div class="jmsdm-review-meta-row">
                ${isEdited ? `<span class="jmsdm-local-comment-edited">${config.languageLabels.localCommentsEdited || "Düzenlendi"}</span>` : ""}
                <div class="jmsdm-review-date">${date}</div>
              </div>
            </div>
            <div class="jmsdm-review-body is-collapsed" data-expanded="0">${fullHtml}</div>
            ${(isLong || own) ? `
              <div class="jmsdm-local-comment-toolbar">
                ${isLong ? `<button class="jmsdm-review-more">${config.languageLabels.more || "Devamı"}</button>` : `<span></span>`}
                ${own ? `
                  <div class="jmsdm-local-comment-actions">
                    <button class="jmsdm-comment-action jmsdm-local-comment-edit" data-comment-id="${escapeHtml(commentId)}">${config.languageLabels.localCommentsEdit || "Düzenle"}</button>
                    <button class="jmsdm-comment-action danger jmsdm-local-comment-delete" data-comment-id="${escapeHtml(commentId)}" ${deleting ? "disabled" : ""}>${deleting ? (config.languageLabels.localCommentsDeleting || "Siliniyor...") : (config.languageLabels.localCommentsDelete || "Sil")}</button>
                  </div>
                ` : ``}
              </div>
            ` : ``}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

async function loadLocalCommentsInto(root, displayItem, { signal } = {}) {
  const host = root?.querySelector?.(".jmsdm-local-comments");
  if (!host) return;

  const itemId = safeText(displayItem?.Id);
  if (!itemId) {
    host.innerHTML = `<div style="color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;">${config.languageLabels.localCommentsUnavailable || "Bu içerik için yorum alanı açılamadı."}</div>`;
    return;
  }

  const user = getCommentsUserContext();
  if (!user.userId) {
    host.innerHTML = `<div style="color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;">${config.languageLabels.localCommentsAuthMissing || "Yorum yazmak için aktif kullanıcı bilgisi bulunamadı."}</div>`;
    return;
  }

  const state = {
    comments: [],
    currentUserId: user.userId,
    draft: "",
    editingCommentId: "",
    saving: false,
    deletingCommentId: "",
  };

  function getEditingComment() {
    if (!state.editingCommentId) return null;
    return state.comments.find((comment) => safeText(comment?.Id) === state.editingCommentId) || null;
  }

  function captureDraft() {
    const textarea = host.querySelector(".jmsdm-comments-textarea");
    if (textarea) state.draft = textarea.value;
  }

  function wireReviewExpand(scopeEl) {
    scopeEl?.querySelectorAll?.(".jmsdm-review-more")?.forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListener("click", (e) => {
        e.preventDefault();

        const card = btn.closest(".jmsdm-review");
        const body = card?.querySelector(".jmsdm-review-body");
        if (!card || !body) return;

        const id = String(card.getAttribute("data-reviewid") || "");
        const st = _reviewHtmlStore.get(id);
        if (!st) return;

        const expanded = body.getAttribute("data-expanded") === "1";
        if (!expanded) {
          body.innerHTML = st.fullHtml || "";
          body.setAttribute("data-expanded", "1");
          body.classList.remove("is-collapsed");
          btn.textContent = config.languageLabels.less || "Kısalt";
        } else {
          body.innerHTML = st.shortHtml || "";
          body.setAttribute("data-expanded", "0");
          body.classList.add("is-collapsed");
          btn.textContent = config.languageLabels.more || "Devamı";
        }
      });
    });
  }

  function render() {
    const editingComment = getEditingComment();
    const submitLabel = state.saving
      ? (config.languageLabels.localCommentsSaving || "Kaydediliyor...")
      : (editingComment
          ? (config.languageLabels.localCommentsUpdate || "Yorumu Güncelle")
          : (config.languageLabels.localCommentsSubmit || "Yorum Yap"));
    const deleteBusyId = state.deletingCommentId;
    const hint = editingComment
      ? (config.languageLabels.localCommentsEditHint || "Yorumunu düzenliyorsun. Kaydettiğinde mevcut yorumun güncellenir.")
      : "";
    const canSubmit = !!state.draft.trim() && !state.saving && state.draft.length <= LOCAL_COMMENT_MAX_LENGTH;

    host.innerHTML = `
      <div class="jmsdm-local-comments-head">
        <div class="jmsdm-section-title">${escapeHtml(`${config.languageLabels.localCommentsTitle || "Topluluk Yorumları"} (${state.comments.length})`)}</div>
      </div>

      <div class="jmsdm-comments-compose">
        <textarea
          class="jmsdm-comments-textarea"
          rows="4"
          maxlength="${LOCAL_COMMENT_MAX_LENGTH}"
          placeholder="${escapeHtml(config.languageLabels.localCommentsPlaceholder || "Bu içerik hakkında ne düşünüyorsun?")}"
          ${state.saving ? "disabled" : ""}
        >${escapeHtml(state.draft)}</textarea>

        <div class="jmsdm-comments-compose-meta">
          ${hint ? `<div class="jmsdm-comments-hint">${escapeHtml(hint)}</div>` : ""}
          <div class="jmsdm-comments-charcount">${state.draft.length}/${LOCAL_COMMENT_MAX_LENGTH}</div>
        </div>

        <div class="jmsdm-comments-compose-actions">
          <button class="jmsdm-btn primary jmsdm-local-comment-submit" ${canSubmit ? "" : "disabled"}>
            ${escapeHtml(submitLabel)}
          </button>
          ${editingComment ? `
            <button class="jmsdm-btn jmsdm-local-comment-cancel" ${state.saving ? "disabled" : ""}>
              ${escapeHtml(config.languageLabels.localCommentsCancelEdit || "Vazgeç")}
            </button>
          ` : ``}
        </div>
      </div>

      <div class="jmsdm-comments-list">
        ${renderLocalCommentsHtml(state.comments, { currentUserId: state.currentUserId, deleteBusyId })}
      </div>
    `;

    const textarea = host.querySelector(".jmsdm-comments-textarea");
    const submitBtn = host.querySelector(".jmsdm-local-comment-submit");
    const cancelBtn = host.querySelector(".jmsdm-local-comment-cancel");
    const countEl = host.querySelector(".jmsdm-comments-charcount");

    if (textarea && submitBtn) {
      textarea.addEventListener("input", () => {
        state.draft = textarea.value;
        submitBtn.disabled = !state.draft.trim() || state.saving;
        if (countEl) countEl.textContent = `${state.draft.length}/${LOCAL_COMMENT_MAX_LENGTH}`;
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        captureDraft();
        const content = state.draft.trim();
        if (!content || signal?.aborted) return;

        try {
          state.saving = true;
          render();
          await upsertLocalComment(itemId, content, { signal });
          if (signal?.aborted || !_open) return;

          const latest = await fetchLocalComments(itemId, { signal });
          state.comments = Array.isArray(latest?.comments) ? latest.comments : state.comments;
          state.draft = "";
          state.editingCommentId = "";
          state.saving = false;
          render();
          window.showMessage?.(config.languageLabels.localCommentsSaved || "Yorum kaydedildi.", "success");
        } catch (err) {
          state.saving = false;
          render();
          console.warn("local comments save error:", err);
          window.showMessage?.(err?.message || config.languageLabels.localCommentsSaveFailed || "Yorum kaydedilemedi.", "error");
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        state.editingCommentId = "";
        state.draft = "";
        render();
      });
    }

    host.querySelectorAll(".jmsdm-local-comment-edit").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        captureDraft();

        const commentId = safeText(btn.getAttribute("data-comment-id"));
        const comment = state.comments.find((entry) => safeText(entry?.Id) === commentId);
        if (!comment) return;

        state.editingCommentId = commentId;
        state.draft = safeText(comment?.Content, "");
        render();

        const nextTextarea = host.querySelector(".jmsdm-comments-textarea");
        try {
          nextTextarea?.focus?.({ preventScroll: true });
          const end = nextTextarea?.value?.length || 0;
          nextTextarea?.setSelectionRange?.(end, end);
        } catch {}
      });
    });

    host.querySelectorAll(".jmsdm-local-comment-delete").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (signal?.aborted) return;

        const commentId = safeText(btn.getAttribute("data-comment-id"));
        if (!commentId) return;

        const confirmed = window.confirm?.(
          config.languageLabels.localCommentsDeleteConfirm || "Yorumunu silmek istediğine emin misin?"
        );
        if (confirmed === false) return;

        try {
          state.deletingCommentId = commentId;
          render();
          await deleteLocalComment(commentId, { signal });
          if (signal?.aborted || !_open) return;

          const latest = await fetchLocalComments(itemId, { signal });
          state.comments = Array.isArray(latest?.comments) ? latest.comments : [];
          if (state.editingCommentId === commentId) {
            state.editingCommentId = "";
            state.draft = "";
          }
          state.deletingCommentId = "";
          render();
          window.showMessage?.(config.languageLabels.localCommentsDeleted || "Yorum silindi.", "success");
        } catch (err) {
          state.deletingCommentId = "";
          render();
          console.warn("local comments delete error:", err);
          window.showMessage?.(err?.message || config.languageLabels.localCommentsDeleteFailed || "Yorum silinemedi.", "error");
        }
      });
    });

    wireReviewExpand(host);
  }

  host.innerHTML = `<div class="jmsdm-comments-loading">${config.languageLabels.loading || "Yükleniyor..."}</div>`;

  try {
    const data = await fetchLocalComments(itemId, { signal });
    if (signal?.aborted || !_open) return;
    state.comments = Array.isArray(data?.comments) ? data.comments : [];
    render();
  } catch (err) {
    if (signal?.aborted) return;
    console.warn("local comments load error:", err);
    host.innerHTML = `<div style="color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;">${escapeHtml(err?.message || config.languageLabels.localCommentsLoadFailed || "Yorumlar yüklenemedi.")}</div>`;
  }
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
  const apiKey = await getTmdbApiKey();
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
            const key = await getTmdbApiKey();
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
        const key = await getTmdbApiKey();
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
    const hero = root?.querySelector?.(".jmsdm-hero");
    const media = hero?.querySelector?.(".jmsdm-hero-media");
    const heroImg = hero?.querySelector?.("img");
    const replayBtn = hero?.querySelector?.(".jmsdm-hero-replay");
    const v = hero?.querySelector?.("video[data-jms-hero-preview='1']");
    if (v) {
      try { v.pause(); } catch {}
      try { v.removeAttribute("src"); v.load(); } catch {}
      try { v.remove(); } catch {}
    }
    const f = hero?.querySelector?.("iframe[data-jms-hero-preview='1']");
    if (f) {
      try { f.__ytPlayer?.destroy?.(); } catch {}
      try { f.__ytPlayer = null; } catch {}
      try { f.src = "about:blank"; } catch {}
      try { f.remove(); } catch {}
    }
    try { if (media) media.innerHTML = ""; } catch {}
    try { media?.remove?.(); } catch {}
    try { if (heroImg) heroImg.style.opacity = "1"; } catch {}
    try { if (replayBtn) replayBtn.disabled = false; } catch {}
    setHeroReplayVisible(replayBtn, true);
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
      }

      const blocker = (e) => {
        const target = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
        if (target?.closest?.(NESTED_MODAL_SCROLL_ALLOW_SELECTOR)) return;
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

    const backdropImg = slide.querySelector(".monwui-backdrop, .monwui-backdrop img, .backdrop img, .banner img, img") || null;

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

    const backdropImg = slide.querySelector(".monwui-backdrop, .monwui-backdrop img, .backdrop img, .banner img, img") || null;
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
    qp.set("Filters", "IsResumable");
    qp.set("Recursive", "true");
    qp.set("EnableUserData", "true");

    const r = await makeApiRequest(
      `/Users/${encodeURIComponent(userId)}/Items?${qp.toString()}`,
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
    if (!itemId) throw new Error("ItemId missing");
    await updateFavoriteStatus(itemId, makeFav);
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
    BoxSet: ll.boxset || ll.collectionTitle || ll.collection,
    MusicAlbum: ll.album,
    Audio: ll.track,
    MusicArtist: ll.artist,
  };

  const byKey = ll[`type_${t}`] || ll[`type${t}`];

  return safeText(map[t] || byKey || "", t);
}

function safeText(s, fallback = "") {
  const t = (s ?? "").toString().trim();
  return t || fallback;
}

function label(key, fallback = "") {
  return safeText(labels?.[key] || config?.languageLabels?.[key], fallback);
}

async function copyTextToClipboard(value) {
  const raw = safeText(value);
  if (!raw) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
  } catch {}

  try {
    const input = document.createElement("textarea");
    input.value = raw;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = document.execCommand("copy");
    input.remove();
    return !!copied;
  } catch {}

  return false;
}

function uniqTextList(values = []) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = safeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function ticksToMs(value) {
  const ticks = Number(value || 0);
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.round(ticks / 10000);
}

function formatDateTime(ts) {
  const date = new Date(Number(ts || 0));
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();

  try {
    return new Intl.DateTimeFormat(
      config?.timeLocale || config?.dateLocale || "tr-TR",
      sameDay
        ? { hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    ).format(date);
  } catch {
    return sameDay ? date.toLocaleTimeString() : date.toLocaleString();
  }
}

function formatFinishTime(runtimeTicks, playbackTicks = 0) {
  const totalTicks = Math.max(Number(runtimeTicks || 0), 0);
  const watchedTicks = Math.max(Number(playbackTicks || 0), 0);
  const remainingTicks = Math.max(totalTicks - watchedTicks, 0);
  if (!remainingTicks) return "";
  return formatDateTime(Date.now() + ticksToMs(remainingTicks));
}

function formatCommunityRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? `★ ${rating.toFixed(1)}` : "";
}

function formatBitrate(value) {
  const bitrate = Number(value || 0);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return "";
  if (bitrate >= 1000000) {
    const mbps = bitrate / 1000000;
    return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
  }
  return `${Math.round(bitrate / 1000)} kbps`;
}

function formatChannels(value) {
  const channels = Number(value || 0);
  if (!Number.isFinite(channels) || channels <= 0) return "";
  if (channels === 1) return "1.0";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels} ch`;
}

function parseNumberLike(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = safeText(value);
  if (!raw) return 0;

  if (raw.includes("/")) {
    const [num, den] = raw.split("/").map((part) => Number(part));
    if (Number.isFinite(num) && Number.isFinite(den) && den) {
      return num / den;
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPeopleNames(item, type, limit = 8) {
  return uniqTextList(
    (Array.isArray(item?.People) ? item.People : [])
      .filter((person) => safeText(person?.Type).toLowerCase() === safeText(type).toLowerCase())
      .map((person) => person?.Name)
  ).slice(0, limit);
}

function getActorNames(item, limit = 8) {
  const roles = new Set(["actor", "gueststar", "voice"]);
  return uniqTextList(
    (Array.isArray(item?.People) ? item.People : [])
      .filter((person) => roles.has(safeText(person?.Type).toLowerCase()))
      .map((person) => person?.Name)
  ).slice(0, limit);
}

function getStudioEntries(item, limit = 6) {
  const out = [];
  const seen = new Set();

  for (const studio of (Array.isArray(item?.Studios) ? item.Studios : [])) {
    const name = safeText(studio?.Name || studio);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      id: safeText(studio?.Id || studio?.StudioId || studio?.studioId)
    });

    if (out.length >= limit) break;
  }

  return out;
}

function getMediaStreamsByType(item, type) {
  return (Array.isArray(item?.MediaStreams) ? item.MediaStreams : [])
    .filter((stream) => safeText(stream?.Type).toLowerCase() === safeText(type).toLowerCase());
}

function getPrimaryVideoStream(item) {
  return getMediaStreamsByType(item, "Video")[0] || null;
}

function getVideoQualityLabel(videoStream) {
  if (!videoStream || safeText(videoStream?.Type).toLowerCase() !== "video") return "";

  const height = Math.max(
    Number(videoStream?.Height || 0),
    Number(videoStream?.RealHeight || 0)
  );
  const width = Math.max(
    Number(videoStream?.Width || 0),
    Number(videoStream?.RealWidth || 0)
  );
  const range = safeText(videoStream?.VideoRangeType).toUpperCase();
  const codec = safeText(videoStream?.Codec).toUpperCase();
  const fps = parseNumberLike(videoStream?.RealFrameRate || videoStream?.AverageFrameRate || videoStream?.FrameRate);
  const bitrate = formatBitrate(videoStream?.BitRate);

  let quality = "";
  if (height >= 2160 || width >= 3800) quality = "4K";
  else if (height >= 1440) quality = "1440p";
  else if (height >= 1080 || width >= 1900) quality = "1080p";
  else if (height >= 720) quality = "720p";
  else if (height >= 480) quality = "480p";
  else if (height > 0) quality = `${Math.round(height)}p`;

  const dynamicRange = range.includes("DOVI")
    ? "Dolby Vision"
    : (range.includes("HDR") ? "HDR" : "");
  const fpsText = fps > 0 ? `${fps >= 10 ? fps.toFixed(0) : fps.toFixed(2)} fps`.replace(/\.00(?= fps)/, "") : "";

  return [quality, dynamicRange, codec, fpsText, bitrate].filter(Boolean).join(" • ");
}

function formatAudioStream(stream) {
  const language = safeText(stream?.DisplayLanguage || stream?.Language || stream?.LanguageCode);
  const codec = safeText(stream?.Codec).toUpperCase();
  const channels = formatChannels(stream?.Channels);
  const bitrate = formatBitrate(stream?.BitRate);
  const tags = [language, codec, channels, bitrate].filter(Boolean);
  const flags = [];
  if (stream?.IsDefault) flags.push(label("default", "Varsayılan"));
  if (stream?.IsExternal) flags.push(label("external", "Harici"));
  if (stream?.Title) flags.push(safeText(stream?.Title));
  return [tags.join(" • "), flags.join(" • ")].filter(Boolean).join(" - ");
}

function formatSubtitleStream(stream) {
  const language = safeText(stream?.DisplayLanguage || stream?.Language || stream?.LanguageCode);
  const codec = safeText(stream?.Codec).toUpperCase();
  const title = safeText(stream?.DisplayTitle || stream?.Title);
  const flags = [];
  if (stream?.IsDefault) flags.push(label("default", "Varsayılan"));
  if (stream?.IsForced) flags.push(label("forced", "Zorunlu"));
  if (stream?.IsExternal) flags.push(label("external", "Harici"));
  return [language, codec, title, flags.join(" • ")].filter(Boolean).join(" • ");
}

function renderPreviewStats(stats = []) {
  if (!stats.length) return "";
  return `
    <div class="jmsdm-preview-stats">
      ${stats.map((stat) => `
        <div class="jmsdm-preview-stat">
          <div class="jmsdm-preview-stat-label">${escapeHtml(stat.label)}</div>
          <div class="jmsdm-preview-stat-value">${escapeHtml(stat.value)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPreviewFieldSection(title, fields = []) {
  const visible = (Array.isArray(fields) ? fields : []).filter((field) => safeText(field?.value));
  if (!visible.length) return "";

  return `
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-field-list">
        ${visible.map((field) => `
          <div class="jmsdm-preview-field">
            <div class="jmsdm-preview-field-label">${escapeHtml(field.label)}</div>
            <div class="jmsdm-preview-field-value">${escapeHtml(field.value)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderPreviewListSection(title, items = []) {
  const visible = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!visible.length) return "";

  return `
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <ul class="jmsdm-preview-list">
        ${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderPreviewTagSection(title, items = []) {
  const visible = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!visible.length) return "";

  return `
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-tags">
        ${visible.map((item) => `<span class="jmsdm-preview-tag">${escapeHtml(item)}</span>`).join("")}
      </div>
    </section>
  `;
}

function renderPreviewChips(chips = []) {
  const visible = (Array.isArray(chips) ? chips : []).filter((chip) => safeText(chip?.text));
  if (!visible.length) return "";

  const openTitle = label("watchlistPreviewStudioAdd", "Stüdyo koleksiyonuna ekle");

  return `
    <div class="jmsdm-preview-chips">
      ${visible.map((chip) => {
        const chipText = safeText(chip?.text);
        const studioId = safeText(chip?.studioId);
        const studioName = safeText(chip?.studioName, chipText);
        const className = [
          "jmsdm-preview-chip",
          chip?.accent ? "accent" : "",
          studioId ? "jmsdm-preview-tag-button" : ""
        ].filter(Boolean).join(" ");

        if (!studioId) {
          return `<span class="${className}">${escapeHtml(chipText)}</span>`;
        }

        return `
          <span
            class="${className}"
            role="button"
            tabindex="0"
            data-jmsdm-studio-id="${escapeHtml(studioId)}"
            data-jmsdm-studio-name="${escapeHtml(studioName)}"
            title="${escapeHtml(openTitle)}"
            aria-label="${escapeHtml(`${studioName} - ${openTitle}`)}"
          >${escapeHtml(chipText)}</span>
        `;
      }).join("")}
    </div>
  `;
}

function renderPreviewStudioSection(title, studios = []) {
  const visible = (Array.isArray(studios) ? studios : []).filter((studio) => safeText(studio?.name));
  if (!visible.length) return "";

  const openTitle = label("watchlistPreviewStudioAdd", "Stüdyo koleksiyonuna ekle");

  return `
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-tags">
        ${visible.map((studio) => {
          const name = safeText(studio?.name);
          const studioId = safeText(studio?.id);
          if (!studioId) {
            return `<span class="jmsdm-preview-tag">${escapeHtml(name)}</span>`;
          }

          return `
            <button
              type="button"
              class="jmsdm-preview-tag jmsdm-preview-tag-button"
              data-jmsdm-studio-id="${escapeHtml(studioId)}"
              data-jmsdm-studio-name="${escapeHtml(name)}"
              title="${escapeHtml(openTitle)}"
              aria-label="${escapeHtml(`${name} - ${openTitle}`)}"
            >${escapeHtml(name)}</button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function notifyStudioHubResult(message, type = "success", icon = "building", duration = 2600) {
  const cleanMessage = safeText(message);
  if (!cleanMessage) return;

  try {
    showNotification(
      `<i class="fas fa-${icon}" style="margin-right:8px;"></i> ${cleanMessage}`,
      duration,
      type
    );
  } catch {}

  window.showMessage?.(cleanMessage, type === "error" ? "error" : "success");
}

function setStudioHubLoadingState(targetEl, isLoading) {
  const el = targetEl?.closest?.("[data-jmsdm-studio-id]") || targetEl;
  if (!el) return false;

  if (isLoading) {
    if (el.__studioHubBusy) return false;
    el.__studioHubBusy = true;
    el.__studioHubOriginalHtml = el.innerHTML;
    el.classList.add("is-loading");
    el.setAttribute("aria-busy", "true");
    el.style.pointerEvents = "none";
    el.style.opacity = "0.82";
    el.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>${el.__studioHubOriginalHtml || ""}`;
    try {
      if ("disabled" in el) el.disabled = true;
    } catch {}
    return true;
  }

  if (el.__studioHubOriginalHtml != null) {
    el.innerHTML = el.__studioHubOriginalHtml;
  }
  el.__studioHubOriginalHtml = null;
  el.__studioHubBusy = false;
  el.classList.remove("is-loading");
  el.removeAttribute("aria-busy");
  el.style.pointerEvents = "";
  el.style.opacity = "";
  try {
    if ("disabled" in el) el.disabled = false;
  } catch {}
  return true;
}

async function maybeAutoEnsureStudioHub(studioId, studioName) {
  const cleanStudioId = safeText(studioId);
  const cleanStudioName = safeText(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return { attempted: false, added: false };
  }

  if (config?.currentUserIsAdmin !== true || config?.studioHubsAutoAddFromWatchlistCopy !== true) {
    return { attempted: false, added: false };
  }

  if (_autoAddStudioHubPendingIds.has(cleanStudioId)) {
    return { attempted: false, added: false, skipped: true, pending: true };
  }

  if (_autoAddedStudioHubIds.has(cleanStudioId)) {
    return { attempted: false, added: false, skipped: true, existing: true };
  }

  _autoAddStudioHubPendingIds.add(cleanStudioId);
  try {
    const result = await ensureStudioHubManualEntry({
      studioId: cleanStudioId,
      name: cleanStudioName
    });
    _autoAddedStudioHubIds.add(cleanStudioId);

    if (result?.created) {
      try {
        window.dispatchEvent(new CustomEvent(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, {
          detail: {
            source: "details-modal-auto-add",
            studioId: cleanStudioId,
            studioName: cleanStudioName,
            entry: result?.entry || null,
            entries: Array.isArray(result?.entries) ? result.entries : []
          }
        }));
      } catch {}
    }

    return {
      attempted: true,
      added: result?.created === true,
      existing: result?.existing === true,
      entry: result?.entry || null,
      entries: Array.isArray(result?.entries) ? result.entries : []
    };
  } catch (error) {
    return {
      attempted: true,
      added: false,
      error
    };
  } finally {
    _autoAddStudioHubPendingIds.delete(cleanStudioId);
  }
}

async function maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, { entries = null } = {}) {
  const cleanStudioId = safeText(studioId);
  const cleanStudioName = safeText(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return { attempted: false, uploaded: false };
  }

  if (config?.currentUserIsAdmin !== true || config?.studioHubsAutoAddFromWatchlistCopy !== true) {
    return { attempted: false, uploaded: false };
  }

  if (_autoStudioHubLogoPendingIds.has(cleanStudioId)) {
    return { attempted: false, uploaded: false, skipped: true, pending: true };
  }

  if (_autoStudioHubLogoResolvedIds.has(cleanStudioId)) {
    return { attempted: false, uploaded: false, skipped: true };
  }

  _autoStudioHubLogoPendingIds.add(cleanStudioId);
  try {
    const result = await ensureStudioHubLogoFromTmdb({
      studioId: cleanStudioId,
      name: cleanStudioName,
      manualEntries: Array.isArray(entries) ? entries : null
    });
    _autoStudioHubLogoResolvedIds.add(cleanStudioId);

    return {
      attempted: result?.attempted !== false,
      uploaded: result?.uploaded === true,
      skipped: result?.skipped === true,
      reason: safeText(result?.reason),
      entry: result?.entry || null,
      entries: Array.isArray(result?.entries) ? result.entries : []
    };
  } catch (error) {
    return {
      attempted: true,
      uploaded: false,
      error
    };
  } finally {
    _autoStudioHubLogoPendingIds.delete(cleanStudioId);
  }
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

function getHeroPrimaryImageUrl(it, { maxWidth = 1280 } = {}) {
  try {
    if (!it?.Id) return "";

    const primaryTag = it?.ImageTags?.Primary || it?.PrimaryImageTag;
    if (primaryTag) {
      return withServer(
        `/Items/${encodeURIComponent(it.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=90&maxWidth=${encodeURIComponent(maxWidth)}`
      );
    }

    const albumPrimaryTag = it?.AlbumPrimaryImageTag;
    const albumId = it?.AlbumId || it?.ParentId;
    if (albumPrimaryTag && albumId) {
      return withServer(
        `/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumPrimaryTag)}&quality=90&maxWidth=${encodeURIComponent(maxWidth)}`
      );
    }
  } catch {}

  return "";
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

function getAudioImageUrlMini(track, { maxWidth = 260, fallbackAlbumId = "" } = {}) {
  try {
    if (!track?.Id) return "";

    const primaryTag = track?.ImageTags?.Primary || track?.PrimaryImageTag;
    if (primaryTag) {
      return withServer(
        `/Items/${encodeURIComponent(track.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}`
      );
    }

    const albumPrimaryTag = track?.AlbumPrimaryImageTag;
    const albumId = track?.AlbumId || fallbackAlbumId || track?.ParentId;
    if (albumPrimaryTag && albumId) {
      return withServer(
        `/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumPrimaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}`
      );
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

async function fetchOtherCollections(currentId, { signal, limit = 12 } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId) return [];

    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("IncludeItemTypes", "BoxSet");
    qp.set("Recursive", "true");
    qp.set("Limit", String(Math.max(limit * 3, 40)));
    qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating");
    qp.set("SortBy", "SortName");
    qp.set("SortOrder", "Ascending");

    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items
      .filter(x => x?.Id && String(x.Id) !== String(currentId))
      .slice(0, limit);
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchOtherCollections error:", e);
    return [];
  }
}

async function fetchAlbumTracks(albumId, { signal, limit = 300 } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId || !albumId) return [];

    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(albumId));
    qp.set("IncludeItemTypes", "Audio");
    qp.set("Recursive", "true");
    qp.set("Limit", String(limit));
    qp.set("Fields", "Id,Name,RunTimeTicks,IndexNumber,ImageTags,UserData,AlbumId,AlbumPrimaryImageTag,PrimaryImageTag");
    qp.set("SortBy", "IndexNumber,SortName");
    qp.set("SortOrder", "Ascending");

    const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
    const items = Array.isArray(r?.Items) ? r.Items : [];
    return items;
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchAlbumTracks error:", e);
    return [];
  }
}

async function fetchOtherAlbums(seedItem, { signal, limit = 12 } = {}) {
  try {
    const userId = (window.ApiClient?.getCurrentUserId?.() || window.ApiClient?._currentUserId) || "";
    if (!userId) return [];

    const isTrackSeed = String(seedItem?.Type || "") === "Audio";
    const currentAlbumId =
      seedItem?.Type === "MusicAlbum"
        ? String(seedItem.Id || "")
        : String(seedItem?.AlbumId || seedItem?.ParentId || "");

    const byArtist =
      safeText(seedItem?.AlbumArtist, "") ||
      (Array.isArray(seedItem?.Artists) ? safeText(seedItem.Artists[0], "") : "");

    const artistIdCandidates = [
      seedItem?.AlbumArtistId,
      seedItem?.ArtistId,
      ...(Array.isArray(seedItem?.ArtistIds) ? seedItem.ArtistIds : []),
      ...(Array.isArray(seedItem?.ArtistItems) ? seedItem.ArtistItems.map(x => x?.Id) : []),
    ]
      .map(x => String(x || "").trim())
      .filter(Boolean);

    const runQuery = async ({ searchTerm = "", artistId = "", albumArtistId = "" } = {}) => {
      const qp = new URLSearchParams();
      qp.set("UserId", userId);
      qp.set("IncludeItemTypes", "MusicAlbum");
      qp.set("Recursive", "true");
      qp.set("Limit", String(Math.max(limit * 3, 40)));
      qp.set("Fields", "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating,AlbumArtist,Artists");
      qp.set("SortBy", "DateCreated,SortName");
      qp.set("SortOrder", "Descending");
      if (artistId) qp.set("ArtistIds", artistId);
      if (albumArtistId) qp.set("AlbumArtistIds", albumArtistId);
      if (searchTerm) qp.set("SearchTerm", searchTerm);
      const r = await makeApiRequest(`/Items?${qp.toString()}`, { signal });
      return Array.isArray(r?.Items) ? r.Items : [];
    };

    let items = [];

    if (isTrackSeed && artistIdCandidates.length) {
      for (const aid of artistIdCandidates) {
        items = await runQuery({ albumArtistId: aid });
        if (items.length) break;
      }

      if (!items.length) {
        for (const aid of artistIdCandidates) {
          items = await runQuery({ artistId: aid });
          if (items.length) break;
        }
      }
    }

    if (!items.length && byArtist) items = await runQuery({ searchTerm: byArtist });
    if (!items.length && byArtist) items = await runQuery({});

    const artistNameSet = new Set(
      [
        safeText(seedItem?.AlbumArtist, ""),
        ...(Array.isArray(seedItem?.Artists) ? seedItem.Artists : []),
      ]
        .map(x => String(x || "").trim().toLocaleLowerCase())
        .filter(Boolean)
    );

    if (isTrackSeed && artistNameSet.size) {
      items = items.filter((it) => {
        const names = [
          safeText(it?.AlbumArtist, ""),
          ...(Array.isArray(it?.Artists) ? it.Artists : []),
        ]
          .map(x => String(x || "").trim().toLocaleLowerCase())
          .filter(Boolean);
        if (!names.length) return false;
        return names.some(n => artistNameSet.has(n));
      });
    }

    const seen = new Set();
    const out = [];
    for (const it of items) {
      const id = it?.Id ? String(it.Id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (currentAlbumId && id === currentAlbumId) continue;
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    if (!signal?.aborted) console.warn("fetchOtherAlbums error:", e);
    return [];
  }
}

function renderAudioTracksHtml(items = [], { activeTrackId = "", fallbackAlbumId = "" } = {}) {
  if (!items.length) {
    return `<div style="color:rgba(255,255,255,.75);font-size:13px;line-height:1.5;">${config.languageLabels.noTracks || "Şarkı bulunamadı."}</div>`;
  }

  return `
    <div class="jmsdm-episodes">
      ${items.map((track, i) => {
        const num = (track?.IndexNumber ?? (i + 1));
        const trackName = safeText(track?.Name, config.languageLabels.track || "Şarkı");
        const trackRuntime = fmtRuntime(track?.RunTimeTicks);
        const img = getAudioImageUrlMini(track, { maxWidth: 260, fallbackAlbumId });
        const activeClass = (activeTrackId && String(track?.Id) === String(activeTrackId)) ? " active" : "";

        return `
          <div class="jmsdm-ep${activeClass}" data-epid="${track?.Id || ""}">
            <div class="jmsdm-ep-thumb">
              ${
                img
                  ? `<img src="${img}" alt="${escapeHtml(trackName)}" loading="lazy" decoding="async">`
                  : `<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>`
              }
            </div>

            <div class="jmsdm-ep-num">${escapeHtml(String(num))}</div>

            <div class="jmsdm-ep-main">
              <div class="jmsdm-ep-name">${escapeHtml(trackName)}</div>
              <div class="jmsdm-ep-over">${escapeHtml(trackRuntime || "")}</div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function startBoxSetLoad(root, boxsetItem, { signal } = {}) {
  (async () => {
    try {
      if (!root || !boxsetItem?.Id) return;
      const itemsHost = root.querySelector(".jmsdm-boxset-items-host");
      const otherHost = root.querySelector(".jmsdm-boxset-other-host");
      if (!itemsHost || !otherHost) return;

      const [items, others] = await Promise.all([
        fetchCollectionItemsAll(boxsetItem.Id, { signal }),
        fetchOtherCollections(boxsetItem.Id, { signal, limit: 12 }),
      ]);
      if (!_open || signal?.aborted) return;

      itemsHost.innerHTML = renderMiniCards((items || []).slice(0, 12));
      otherHost.innerHTML = renderMiniCards(others || []);
    } catch (e) {
      if (!signal?.aborted) console.warn("boxset load error:", e);
      try {
        const itemsHost = root?.querySelector?.(".jmsdm-boxset-items-host");
        const otherHost = root?.querySelector?.(".jmsdm-boxset-other-host");
        if (itemsHost) itemsHost.innerHTML = renderMiniCards([]);
        if (otherHost) otherHost.innerHTML = renderMiniCards([]);
      } catch {}
    }
  })();
}

function startMusicLoad(root, musicItem, { signal } = {}) {
  (async () => {
    try {
      if (!root || !musicItem?.Id) return;
      const tracksHost = root.querySelector(".jmsdm-music-tracks-host");
      const albumsHost = root.querySelector(".jmsdm-music-albums-host");
      if (!tracksHost || !albumsHost) return;

      const albumId =
        musicItem?.Type === "MusicAlbum"
          ? musicItem.Id
          : (musicItem?.AlbumId || musicItem?.ParentId || null);

      const [tracks, albums] = await Promise.all([
        albumId ? fetchAlbumTracks(albumId, { signal }) : Promise.resolve([]),
        fetchOtherAlbums(musicItem, { signal, limit: 12 }),
      ]);
      if (!_open || signal?.aborted) return;

      tracksHost.innerHTML = renderAudioTracksHtml(tracks || [], {
        activeTrackId: musicItem?.Type === "Audio" ? musicItem.Id : "",
        fallbackAlbumId: albumId || "",
      });
      albumsHost.innerHTML = renderMiniCards(albums || []);
    } catch (e) {
      if (!signal?.aborted) console.warn("music load error:", e);
      try {
        const tracksHost = root?.querySelector?.(".jmsdm-music-tracks-host");
        const albumsHost = root?.querySelector?.(".jmsdm-music-albums-host");
        if (tracksHost) tracksHost.innerHTML = renderAudioTracksHtml([]);
        if (albumsHost) albumsHost.innerHTML = renderMiniCards([]);
      } catch {}
    }
  })();
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
  const detailsRuntime = getDetailsModalRuntimeConfig();
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
  ensureLocalCommentStyles();
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
  const rating = formatOfficialRatingLabel(displayItem.OfficialRating) || "";
  const community = displayItem.CommunityRating ? String(displayItem.CommunityRating.toFixed?.(1) ?? displayItem.CommunityRating) : "";
  const runtime = fmtRuntime(
    baseItem?.RunTimeTicks ||
    displayItem?.RunTimeTicks ||
    baseItem?.CumulativeRunTimeTicks ||
    displayItem?.CumulativeRunTimeTicks
  );
  const genres = Array.isArray(displayItem.Genres) ? displayItem.Genres.slice(0, 6) : [];
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
  const heroPrimaryUrl =
    getHeroPrimaryImageUrl(displayItem, { maxWidth: 1400 }) ||
    getHeroPrimaryImageUrl(baseItem, { maxWidth: 1400 }) ||
    "";
  const heroImageUrl = backdropUrl || heroPrimaryUrl;

  const detailsHref = getDetailsUrl(baseItem.Id);
  const isSeries = baseItem.Type === "Series";
  const seriesId = isSeries
    ? baseItem.Id
    : (baseItem.Type === "Season"
        ? baseItem.SeriesId
        : (isEpisode ? baseItem.SeriesId : null));

  const episodeSeasonId = isEpisode ? (baseItem.SeasonId || baseItem.ParentId || null) : null;
  const isMovie = baseItem.Type === "Movie";
  const isBoxSet = baseItem.Type === "BoxSet";
  const isMusicAlbum = baseItem.Type === "MusicAlbum";
  const isAudio = baseItem.Type === "Audio";
  const isMusicType = isMusicAlbum || isAudio;
  const supportsLocalComments =
    detailsRuntime.showLocalComments &&
    !!safeText(baseItem?.Id || displayItem?.Id, "");
  const supportsTmdbReviews =
    detailsRuntime.showTmdbReviews &&
    (
      baseItem.Type === "Movie" ||
      baseItem.Type === "Series" ||
      baseItem.Type === "Season" ||
      baseItem.Type === "Episode"
    );
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

  const mediaSource =
    (Array.isArray(baseItem?.MediaStreams) && baseItem.MediaStreams.length)
      ? baseItem
      : displayItem;
  const creditSource =
    (Array.isArray(displayItem?.People) && displayItem.People.length)
      ? displayItem
      : baseItem;
  const studioSource =
    (Array.isArray(displayItem?.Studios) && displayItem.Studios.length)
      ? displayItem
      : baseItem;
  const runtimeTicks = Number(
    baseItem?.RunTimeTicks ||
    displayItem?.RunTimeTicks ||
    baseItem?.CumulativeRunTimeTicks ||
    displayItem?.CumulativeRunTimeTicks ||
    0
  );
  const playbackTicks = Number(
    baseItem?.UserData?.PlaybackPositionTicks ||
    displayItem?.UserData?.PlaybackPositionTicks ||
    0
  );
  const remaining = runtimeTicks > playbackTicks ? fmtRuntime(runtimeTicks - playbackTicks) : "";
  const finishTime = playbackTicks > 0 ? formatFinishTime(runtimeTicks, playbackTicks) : "";
  const communityRatingText = formatCommunityRating(displayItem?.CommunityRating || baseItem?.CommunityRating);
  const studioEntries = getStudioEntries(studioSource);
  const studioNames = studioEntries.map((studio) => studio.name);
  const primaryStudioEntry = studioEntries[0] || null;
  const directors = isBoxSet ? [] : getPeopleNames(creditSource, "Director", 4);
  const writers = isBoxSet ? [] : getPeopleNames(creditSource, "Writer", 4);
  const actors = isBoxSet ? [] : getActorNames(creditSource, 8);
  const artists = uniqTextList(baseItem?.Artists || displayItem?.Artists || []).slice(0, 8);
  const albumArtist = safeText(baseItem?.AlbumArtist || displayItem?.AlbumArtist);
  const albumName = safeText(baseItem?.Album || displayItem?.Album);
  const videoStream = isBoxSet ? null : getPrimaryVideoStream(mediaSource);
  const videoQuality = getVideoQualityLabel(videoStream);
  const audioTracks = isBoxSet
    ? []
    : getMediaStreamsByType(mediaSource, "Audio").map(formatAudioStream).filter(Boolean).slice(0, 4);
  const subtitleTracks = isBoxSet
    ? []
    : getMediaStreamsByType(mediaSource, "Subtitle").map(formatSubtitleStream).filter(Boolean).slice(0, 4);
  const seasonEpisodeText = (() => {
    if (!isEpisode) return "";
    const seasonNumber = Number(baseItem?.ParentIndexNumber || 0);
    const episodeNumber = Number(baseItem?.IndexNumber || 0);
    const parts = [];
    if (Number.isFinite(seasonNumber) && seasonNumber > 0) {
      parts.push(`S${String(seasonNumber).padStart(2, "0")}`);
    }
    if (Number.isFinite(episodeNumber) && episodeNumber > 0) {
      parts.push(`E${String(episodeNumber).padStart(2, "0")}`);
    }
    return parts.join(" • ");
  })();
  const subtitleLine = [year, runtime].filter(Boolean).join(" • ");
  const infoLine = [
    seasonEpisodeText,
    isMusicType ? albumArtist : "",
    isMusicType ? albumName : ""
  ].filter(Boolean).join(" • ");
  const previewChips = [
    communityRatingText ? { text: communityRatingText } : null,
    rating ? { text: rating, accent: true } : null,
    videoQuality ? { text: videoQuality.split(" • ").slice(0, 2).join(" • ") } : null,
    primaryStudioEntry ? {
      text: primaryStudioEntry.name,
      studioId: primaryStudioEntry.id,
      studioName: primaryStudioEntry.name
    } : null
  ].filter((chip) => safeText(chip?.text)).slice(0, 4);
  const stats = [
    { label: label("sure", "Süre"), value: runtime },
    { label: label("watchlistPreviewRemaining", "Kalan"), value: remaining },
    { label: label("watchlistPreviewFinishAt", "Bitiş"), value: finishTime },
    { label: label("watchlistPreviewVideoQuality", "Video"), value: videoQuality || safeText(baseItem?.MediaType || displayItem?.MediaType) },
    { label: label("yonetmen", "Yönetmen"), value: directors.join(", ") },
    { label: label("watchlistPreviewStudio", "Stüdyo"), value: studioNames.join(", ") || albumArtist || albumName }
  ].filter((entry) => safeText(entry?.value));
  const mediaFields = isBoxSet
    ? []
    : [
        { label: label("watchlistPreviewVideoTrack", "Video"), value: videoQuality },
        { label: label("watchlistPreviewAudioCount", "Ses"), value: audioTracks.length ? `${audioTracks.length} ${label("watchlistPreviewTrackSuffix", "parça")}` : "" },
        { label: label("watchlistPreviewSubtitleCount", "Altyazı"), value: subtitleTracks.length ? `${subtitleTracks.length} ${label("watchlistPreviewTrackSuffix", "parça")}` : "" }
      ];
  const creditFields = isBoxSet
    ? []
    : [
        { label: label("yonetmen", "Yönetmen"), value: directors.join(", ") },
        { label: label("watchlistPreviewWriter", "Yazar"), value: writers.join(", ") },
        { label: label("watchlistPreviewActors", "Oyuncular"), value: actors.join(", ") },
        { label: label("watchlistPreviewArtists", "Sanatçılar"), value: artists.join(", ") },
        { label: label("watchlistPreviewAlbum", "Albüm"), value: albumName },
        { label: label("watchlistPreviewAlbumArtist", "Albüm Sanatçısı"), value: albumArtist }
      ];

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

    if (isBoxSet) {
      const collectionItemsTitle =
        config.languageLabels.collectionItemsTitle ||
        config.languageLabels.collectionTitle ||
        "Koleksiyon İçeriği";
      const otherCollectionsTitle =
        config.languageLabels.otherCollectionsTitle ||
        "Diğer Koleksiyonlar";

      return `
        <div class="jmsdm-section-title">${collectionItemsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-boxset-items-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">${otherCollectionsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-boxset-other-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>
      `;
    }

    if (isMusicType) {
      const tracksTitle = isAudio
        ? (config.languageLabels.albumTracksTitle || "Albümdeki Şarkılar")
        : (config.languageLabels.tracksTitle || "Şarkılar");
      const otherAlbumsTitle =
        isAudio
          ? (config.languageLabels.artistAlbumsTitle || "Sanatçının Albümleri")
          : (config.languageLabels.otherAlbumsTitle || "Diğer Albümler");

      return `
        <div class="jmsdm-section-title">${tracksTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-music-tracks-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:68px;margin-top:10px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:68px;margin-top:8px;"></div>
          </div>
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">${otherAlbumsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-music-albums-host">
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
            ${heroImageUrl ? `<img src="${heroImageUrl}" alt="">` : ""}
            <div class="jmsdm-topbar">
              <button class="jmsdm-close" aria-label="${config.languageLabels.closeButton || "Kapat"}">✕</button>
            </div>

            <div class="jmsdm-heroTitleWrap" aria-hidden="true">
              <div class="jmsdm-heroTitle">${escapeHtml(name)}</div>
            </div>
          </div>

          <div class="jmsdm-body">
            <div class="jmsdm-left">
              <div class="jmsdm-preview-shell">
                <div class="jmsdm-preview-hero">
                  <div class="jmsdm-preview-hero-inner">
                    <div class="jmsdm-preview-head">
                      <div class="jmsdm-preview-kicker">${escapeHtml(type || safeText(baseItem?.Type, ""))}</div>
                      <h2 class="jmsdm-preview-title">${escapeHtml(name)}</h2>
                      ${subtitleLine ? `<div class="jmsdm-preview-subtitle">${escapeHtml(subtitleLine)}</div>` : ""}
                      ${infoLine ? `<div class="jmsdm-preview-subtitle">${escapeHtml(infoLine)}</div>` : ""}
                      ${renderPreviewChips(previewChips)}
                    </div>
                  </div>
                </div>

                <div class="jmsdm-preview-body">
                  <div class="jmsdm-actions">
                    <button class="jmsdm-btn primary jmsdm-play">
                      ${icon("M8 5v14l11-7z")} ${config.languageLabels.playNowLabel || "Şimdi Oynat"}
                    </button>
                    <button class="jmsdm-btn jmsdm-openpage">
                      ${icon("M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z")} ${config.languageLabels.goToPageLabel || "Sayfaya Git"}
                    </button>
                    <button class="jmsdm-btn jmsdm-fav" aria-pressed="${isFavorite ? "true" : "false"}">
                      ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
                      ${getWatchlistButtonText(baseItem, isFavorite)}
                    </button>
                    <button class="jmsdm-btn jmsdm-watchlist-open">
                      ${icon("M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z")} ${config.languageLabels.watchlistOpen || "İzleme Listesi"}
                    </button>
                  </div>

                  <div class="jmsdm-overview">${overview}</div>
                  ${renderPreviewStats(stats)}
                  ${renderPreviewFieldSection(label("watchlistPreviewMediaSection", "Medya Özeti"), mediaFields)}
                  ${renderPreviewListSection(label("watchlistPreviewAudioTracks", "Ses Parçaları"), audioTracks)}
                  ${renderPreviewListSection(label("watchlistPreviewSubtitleTracks", "Altyazılar"), subtitleTracks)}
                  ${renderPreviewFieldSection(label("watchlistPreviewCredits", "Künye"), creditFields)}
                  ${renderPreviewTagSection(label("genre", "Tür"), genres)}
                  ${renderPreviewStudioSection(label("watchlistPreviewStudios", "Stüdyolar"), studioEntries)}
                </div>
              </div>

              ${supportsLocalComments ? `<div class="jmsdm-local-comments" style="margin-top:18px;"></div>` : ""}
              ${supportsTmdbReviews ? `<div class="jmsdm-tmdb-reviews" style="margin-top:18px;"></div>` : ""}
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
  } else if (isBoxSet) {
    startBoxSetLoad(root, baseItem, { signal: _abort.signal });
  } else if (isMusicType) {
    startMusicLoad(root, baseItem, { signal: _abort.signal });
  }

  wireOverviewToggle(root);
  startHeroTrailer(root, displayItem, { signal: _abort.signal }).catch(() => {});
  if (supportsLocalComments) {
    loadLocalCommentsInto(root, baseItem, { signal: _abort.signal });
  }
  if (supportsTmdbReviews) {
    loadTmdbReviewsInto(root, displayItem, { signal: _abort.signal });
  }

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
  const watchlistBtn = root.querySelector(".jmsdm-watchlist-open");

  const updateFavUi = () => {
    if (!favBtn) return;
    favBtn.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    favBtn.innerHTML = `
      ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
      ${getWatchlistButtonText(baseItem, isFavorite)}
    `;
    favBtn.classList.toggle("active", !!isFavorite);
  };

  updateFavUi();

  const playHandler = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      playBtn.disabled = true;
      const started = await playNow(baseItem.Id);
      if (!started) return;
      await closeDetailsModal();
      notifyDetailsModalPlay(baseItem.Id);
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
  if (watchlistBtn) {
    addEventListener(watchlistBtn, "click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopHeroMedia(root);
      await openWatchlistModal({
        initialTab: getWatchlistTabKey(baseItem),
        itemId: baseItem?.Id,
        item: baseItem
      });
    });
  }

  addEventListener(root, "click", async (e) => {
    const studioBtn = e.target?.closest?.(".jmsdm-preview-tag-button[data-jmsdm-studio-id]");
    if (!studioBtn || !root.contains(studioBtn)) return;

    e.preventDefault();
    e.stopPropagation();

    if (!setStudioHubLoadingState(studioBtn, true)) return;

    const studioId = safeText(studioBtn.getAttribute("data-jmsdm-studio-id"));
    const studioName = safeText(studioBtn.getAttribute("data-jmsdm-studio-name"));
    if (!studioId) {
      setStudioHubLoadingState(studioBtn, false);
      return;
    }

    const copied = await copyTextToClipboard(studioId);
    if (copied) {
      studioBtn.classList.add("is-copied");
      clearTimeout(studioBtn.__copiedTimer);
      studioBtn.__copiedTimer = setTimeout(() => {
        studioBtn.classList.remove("is-copied");
        studioBtn.__copiedTimer = 0;
      }, 1400);
    } else {
      const message = studioName
        ? `${studioName}: ${label("watchlistPreviewStudioCopyFailed", "Studio ID kopyalanamadı.")}`
        : label("watchlistPreviewStudioCopyFailed", "Studio ID kopyalanamadı.");
      notifyStudioHubResult(message, "error", "clipboard", 2400);
    }

    void (async () => {
      try {
        const autoAddResult = await maybeAutoEnsureStudioHub(studioId, studioName);
        if (autoAddResult?.pending) return;

        if (autoAddResult?.attempted && autoAddResult?.added === false && autoAddResult?.existing !== true) {
          const message = studioName
            ? `${studioName}: ${safeText(autoAddResult?.error?.message, label("watchlistPreviewStudioAutoAddFailed", "Koleksiyon otomatik eklenemedi."))}`
            : safeText(autoAddResult?.error?.message, label("watchlistPreviewStudioAutoAddFailed", "Koleksiyon otomatik eklenemedi."));
          notifyStudioHubResult(message, "error", "triangle-exclamation", 3200);
          return;
        }

        const logoResult = await maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, {
          entries: autoAddResult?.entries
        });

        if (autoAddResult?.added && logoResult?.uploaded) {
          const message = studioName
            ? `${studioName}: ${label("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")} ${label("watchlistPreviewStudioTmdbLogoSaved", "TMDb logosu da otomatik kaydedildi.")}`
            : `${label("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")} ${label("watchlistPreviewStudioTmdbLogoSaved", "TMDb logosu da otomatik kaydedildi.")}`;
          notifyStudioHubResult(message, "success", "building", 3000);
          return;
        }

        if (autoAddResult?.existing && logoResult?.uploaded) {
          const message = studioName
            ? `${studioName}: ${label("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")} ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`
            : `${label("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")} ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`;
          notifyStudioHubResult(message, "success", "building", 3000);
          return;
        }

        if (autoAddResult?.added) {
          const message = studioName
            ? `${studioName}: ${label("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.")}`
            : label("watchlistPreviewStudioAutoAdded", "Koleksiyon listesine otomatik kaydedildi.");
          notifyStudioHubResult(message, "success", "building", 2600);
          return;
        }

        if (autoAddResult?.existing) {
          const message = studioName
            ? `${studioName}: ${label("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.")}`
            : label("manualCollectionDuplicate", "Bu koleksiyon zaten ekli.");
          notifyStudioHubResult(message, "success", "building", 2600);
          return;
        }

        if (logoResult?.uploaded) {
          const message = studioName
            ? `${studioName}: ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.")}`
            : label("watchlistPreviewStudioTmdbLogoSavedSingle", "TMDb logosu otomatik kaydedildi.");
          notifyStudioHubResult(message, "success", "image", 2600);
        }
      } finally {
        setStudioHubLoadingState(studioBtn, false);
      }
    })();

  });

  addEventListener(root, "keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;

    const studioChip = e.target?.closest?.(".jmsdm-preview-chip.jmsdm-preview-tag-button[data-jmsdm-studio-id]");
    if (!studioChip || !root.contains(studioChip)) return;

    e.preventDefault();
    e.stopPropagation();
    studioChip.click();
  });

  if (favBtn) {
    addEventListener(favBtn, "click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        favBtn.disabled = true;
        const next = !isFavorite;
        const ok = await updateFavoriteStatus(baseItem.Id, next, { item: baseItem });
        if (ok) {
          isFavorite = next;
          try {
            if (baseItem?.UserData) baseItem.UserData.IsFavorite = isFavorite;
            if (displayItem?.UserData) displayItem.UserData.IsFavorite = isFavorite;
          } catch {}
          updateFavUi();
          window.showMessage?.(getWatchlistToast(baseItem, isFavorite), "success");
        } else {
          window.showMessage?.(config.languageLabels.favoriteError || "Liste işlemi başarısız", "error");
        }
      } catch (err) {
        console.warn("fav click error:", err);
        window.showMessage?.(config.languageLabels.favoriteError || "Liste işlemi başarısız", "error");
      } finally {
        try { favBtn.disabled = false; } catch {}
      }
    });
  }

  function wireEpisodeClicks() {
    if (root.__episodeDelegated) return;
    root.__episodeDelegated = true;

    addEventListener(root, "click", async (e) => {
      const el = e.target?.closest?.(".jmsdm-ep");
      if (!el || !root.contains(el)) return;

      e.preventDefault();
      e.stopPropagation();

      const epId = el.getAttribute("data-epid");
      if (!epId) return;
      try {
        const started = await playNow(epId);
        if (!started) return;
        await closeDetailsModal();
        notifyDetailsModalPlay(epId);
      } catch (err) {
        console.error("Episode play error:", err);
        window.showMessage?.(config.languageLabels.episodePlayFailed || "Bölüm oynatılamadı", "error");
      }
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
    if (isMovie || isBoxSet || isMusicType) {
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
