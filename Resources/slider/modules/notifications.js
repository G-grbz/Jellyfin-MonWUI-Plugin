import { makeApiRequest, getSessionInfo, fetchItemDetails, getVideoStreamUrl, playNow, goToDetailsPage, isCurrentUserAdmin, fetchItemsBulk } from "./api.js";
import { getConfig, getServerAddress } from "./config.js";
import { getVideoQualityText } from "./containerUtils.js";
import { getCurrentVersionFromEnv, compareSemver } from "./update.js";
import { withServer } from "./jfUrl.js";

const config = getConfig();

function jfUrl(pathOrUrl) {
  return pathOrUrl ? withServer(pathOrUrl) : "";
}

const POLL_INTERVAL_MS = 15_000;
const TOAST_DURATION_MS = config.toastDuration;
const MAX_NOTIFS = config.maxNotifications;
const TOAST_DEDUP_MS = 5 * 60 * 1000;
const TOAST_GAP_MS = 250;
const MAX_STORE = 200;
const UPDATE_BANNER_KEY      = () => storageKey("updateBanner");
const UPDATE_TOAST_SHOWN_KEY = () => storageKey("updateToastShown");
const UPDATE_TOAST_INFO_KEY = () => storageKey("updateToastInfo");
const UPDATE_LIST_ID = (latest) => `update:${latest}`;
const HOVER_OPEN_DELAY  = 150;
const HOVER_CLOSE_DELAY = 200;
const CSS_READY_TIMEOUT_MS = 2000;
const MAX_RECENT_TOAST_KEYS = 500;
const CREATED_TS_CACHE_MAX = 2000;
const TOAST_QUEUE_MAX = 60;
let __uiReady = false;
let __forcePEObs = null;
const createdTsCache = new Map();
const pollCtl = {
  latestTimer: null,
  actTimer: null,
  latestRunning: false,
  actRunning: false,
  paused: false
};

let notifRenderGen = 0;
let __hoverOpenTimer  = null;
let __hoverCloseTimer = null;
let recentToastMap = new Map();
let notifState = {
  list: [],
  lastSeenCreatedAt: 0,
  toastQueue: [],
  toastShowing: false,
  seenIds: new Set(),
  activitySeenIds: new Set(),
  activityLastSeen: 0,
  activities: [],
  isModalOpen: false,
  _systemAllowed: false,
};

function isHoverCapable() {
  try {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch { return false; }
}

 const sleep = (ms) => new Promise(r => setTimeout(r, ms));

 function isAuthReady() {
   try {
     const s = getSessionInfo();
     return !!(s?.accessToken && s?.userId);
   } catch { return false; }
 }

async function waitForAuthReady(timeoutMs = 15000) {
   const start = Date.now();
   while (Date.now() - start < timeoutMs) {
     if (isAuthReady()) return true;
     await sleep(250);
   }
   return false;
 }

function clearHoverTimers() {
  if (__hoverOpenTimer)  { clearTimeout(__hoverOpenTimer);  __hoverOpenTimer = null; }
  if (__hoverCloseTimer) { clearTimeout(__hoverCloseTimer); __hoverCloseTimer = null; }
}

function insideNotifArea(node) {
  if (!node || !(node instanceof Node)) return false;
  const panel = document.querySelector('#jfNotifModal .jf-notif-panel');
  const btn   = document.getElementById('jfNotifBtn');
  return !!(node.closest?.('#jfNotifBtn') || node.closest?.('#jfNotifModal .jf-notif-panel'));
}

function setupNotifHover() {
  if (!isHoverCapable()) return;
  const btn   = document.getElementById('jfNotifBtn');
  const modal = document.getElementById('jfNotifModal');
  const panel = modal?.querySelector('.jf-notif-panel');
  if (!btn || !modal || !panel) return;
  if (btn.__notifHoverBound) return;
  btn.__notifHoverBound = true;

  const openLater = () => {
    clearHoverTimers();
    __hoverOpenTimer = setTimeout(() => { openModal(); }, HOVER_OPEN_DELAY);
  };
  const closeLater = () => {
    clearHoverTimers();
    __hoverCloseTimer = setTimeout(() => { closeModal(); }, HOVER_CLOSE_DELAY);
  };
  const cancelClose = () => {
    if (__hoverCloseTimer) { clearTimeout(__hoverCloseTimer); __hoverCloseTimer = null; }
  };

  btn.addEventListener('mouseenter', () => {
    openLater();
  });
  const leaveHandler = (ev) => {
    const to = ev.relatedTarget;
    if (insideNotifArea(to)) {
      cancelClose();
    } else {
      closeLater();
    }
  };

  btn.addEventListener('mouseleave', leaveHandler);
  panel.addEventListener('mouseleave', leaveHandler);
  panel.addEventListener('mouseenter', cancelClose);
}

function findHeaderContainer() {
  const roots = Array.from(document.querySelectorAll(".skinHeader"));
  const pick = (root) =>
    root.querySelector(".headerRight") ||
    root.querySelector(".headerButtons") ||
    root.querySelector(".paper-icon-buttons") ||
    root;
  for (const r of roots) {
    const el = pick(r);
    if (el) return el;
  }
  return (
    document.querySelector(".skinHeader .headerRight") ||
    document.querySelector(".skinHeader .headerButtons") ||
    document.querySelector(".headerRight") ||
    document.querySelector(".headerButtons") ||
    document.querySelector(".skinHeader") ||
    null
  );
}

let __notifBtn = null;
let __headerObs = null;

function ensureNotifButtonIn(el) {
  if (!el) return false;
  if (!__notifBtn) {
    const btn = document.createElement("button");
    btn.id = "jfNotifBtn";
    btn.type = "button";
    btn.className = "headerSyncButton syncButton headerButton headerButtonRight paper-icon-button-light";
    btn.setAttribute("is", "paper-icon-button-light");
    btn.setAttribute("aria-label", config.languageLabels.recentNotifications);
    btn.title = config.languageLabels.recentNotifications;
    btn.innerHTML = `
      <i class="material-icons" aria-hidden="true">notifications</i>
      <span class="jf-notif-badge" hidden></span>
    `;
    btn.addEventListener("click", openModal);
    __notifBtn = btn;
  }
  if (__notifBtn.parentElement === el) return true;
  try { el.insertBefore(__notifBtn, el.firstChild); } catch { el.appendChild(__notifBtn); }
  return true;
}

function startHeaderIconSentinel() {
  if (__headerObs) return;
  const mount = () => {
    const target = document.querySelector(".skinHeader") || document.body;
    if (!target) return;
    ensureNotifButtonIn(findHeaderContainer());
    if (__headerObs) __headerObs.disconnect();
    __headerObs = new MutationObserver(() => {
      const host = findHeaderContainer();
      if (!host) return;
      if (!__notifBtn || !host.contains(__notifBtn)) {
        ensureNotifButtonIn(host);
        updateBadge();
        setTimeout(setupNotifHover, 0);
      }
    });
    __headerObs.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureNotifButtonIn(findHeaderContainer());
      updateBadge();
    }
  });
}

function hasPrimaryImage(it) {
  const hasItemPrimary   = !!it?.ImageTags?.Primary || !!it?.HasPrimaryImage;
  const hasSeriesPrimary = !!it?.Series?.ImageTags?.Primary;
  if (it?.Type === "Episode") return hasItemPrimary || hasSeriesPrimary;
  return hasItemPrimary;
}

function safePosterImageSrc(it, maxWidth = 80, quality = 80) {
  const isEp   = it?.Type === "Episode";
  const idBase = isEp ? (it.SeriesId || it.Series?.Id) : (it?.Id || it?.ItemId || it?.id);
  const itemPrimaryTag   = it?.ImageTags?.Primary;
  const seriesPrimaryTag = it?.Series?.ImageTags?.Primary;
  const primaryTag       = itemPrimaryTag || seriesPrimaryTag;

  if (idBase && primaryTag) {
    return `/Items/${idBase}/Images/Primary?maxWidth=${maxWidth}&quality=${quality}&tag=${encodeURIComponent(primaryTag)}`;
  }

  const backdropId  = it?.ParentBackdropItemId || idBase;
  const backdropTag = (Array.isArray(it?.ParentBackdropImageTags) && it.ParentBackdropImageTags[0])
                   || (Array.isArray(it?.BackdropImageTags) && it.BackdropImageTags[0])
                   || (Array.isArray(it?.Series?.BackdropImageTags) && it.Series.BackdropImageTags[0]);

  if (backdropId && backdropTag) {
    return `/Items/${backdropId}/Images/Backdrop/0?maxWidth=${maxWidth}&quality=${quality}&tag=${encodeURIComponent(backdropTag)}`;
  }

  const thumbTag = it?.ImageTags?.Thumb || it?.Series?.ImageTags?.Thumb;
  if (idBase && thumbTag) {
    return `/Items/${idBase}/Images/Thumb?maxWidth=${maxWidth}&quality=${quality}&tag=${encodeURIComponent(thumbTag)}`;
  }

  return "";
}

function upsertUpdateNotification({ latest, url }) {
  const id = UPDATE_LIST_ID(latest);
  notifState.list = notifState.list.filter(n => n.id !== id);
  notifState.list.unshift({
    id,
    itemId: null,
    title: `${config.languageLabels?.updateAvailable || "Yeni sürüm mevcut"}: ${latest}`,
    timestamp: Date.now(),
    status: "update",
    url,
    read: false
  });
  notifState.list = notifState.list.filter(n => n.status !== "update" || n.id === id);
  saveState();
  updateBadge();
  if (document.querySelector("#jfNotifModal.open")) renderNotifications();
}

function posterImageSrc(it, maxWidth = 80, quality = 80) {
  const id =
    (it?.Type === "Episode" && (it?.SeriesId || it?.Series?.Id))
      ? (it.SeriesId || it.Series.Id)
      : (it?.Id || it?.ItemId || it?.id);

  return id ? `/Items/${id}/Images/Primary?maxWidth=${maxWidth}&quality=${quality}` : "";
}

function moreItemsLabel(n) {
  const tail = (config.languageLabels.moreItems || "içerik daha");
  return `${n} ${tail}`;
}

function toastShouldEnqueue(key) {
  const now = Date.now();
  for (const [k, t] of recentToastMap) {
    if (now - t > TOAST_DEDUP_MS) recentToastMap.delete(k);
  }
  if (recentToastMap.has(key)) return false;
  recentToastMap.set(key, now);
  if (recentToastMap.size > MAX_RECENT_TOAST_KEYS) {
    const first = recentToastMap.keys().next().value;
    recentToastMap.delete(first);
  }
  return true;
}

function ensureNotifStylesheet() {
  document.querySelectorAll('link[rel="stylesheet"][href*="slider/src/notifications"]')
    .forEach(l => { if (l.id !== 'jfNotifCss') l.parentElement?.removeChild(l); });
  let link = document.getElementById('jfNotifCss');
  if (!link) {
    link = document.createElement('link');
    link.id = 'jfNotifCss';
    link.rel = 'stylesheet';
    (document.head || document.documentElement).appendChild(link);
  }
  return link;
}

function getThemePreferenceKey() {
  const userId = getSafeUserId();
  return `jf:notifTheme:${userId || "nouser"}`;
}

function loadThemePreference() {
  ensureNotifStylesheet();
  const theme = localStorage.getItem(getThemePreferenceKey()) || '1';
  setTheme(theme);
}

function setTheme(themeNumber) {
  const link = ensureNotifStylesheet();
  const href =
    themeNumber === '1' ? './slider/src/notifications.css'  :
    themeNumber === '2' ? './slider/src/notifications2.css' :
    themeNumber === '3' ? './slider/src/notifications3.css' :
                          './slider/src/notifications4.css';
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    link.disabled = false;
    link.removeEventListener('load', finish);
    link.removeEventListener('error', finish);
  };
  link.addEventListener('load', finish);
  link.addEventListener('error', finish);
  requestAnimationFrame(() => { if (!settled) link.disabled = false; });
  setTimeout(() => { if (!settled) link.disabled = false; }, 50);
  link.disabled = true;
  const absHref = new URL(href, location.href).href;
  if (link.href !== absHref) {
    link.href = href;
  } else {
    finish();
  }
  try { localStorage.setItem(getThemePreferenceKey(), themeNumber); } catch {}
}

function toggleTheme() {
  const current = localStorage.getItem(getThemePreferenceKey()) || '1';
  const next = current === '1' ? '2'
              : current === '2' ? '3'
              : current === '3' ? '4'
              : '1';
  setTheme(next);
}

async function fetchLatestAll() {
  if (!isAuthReady()) return [];
  const { userId } = getSessionInfo();

  let latestVideo = [];
  try {
    latestVideo = await makeApiRequest(
      `/Users/${userId}/Items?SortBy=DateCreated&SortOrder=Descending` +
      `&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=50` +
      `&Fields=DateCreated,DateAdded,PremiereDate,DateLastMediaAdded,SeriesName,ParentIndexNumber,IndexNumber,SeriesId`
    );
    latestVideo = Array.isArray(latestVideo?.Items) ? latestVideo.Items : (Array.isArray(latestVideo) ? latestVideo : []);
  } catch (e) {
    return [];
  }

  const seriesIds = Array.from(new Set(
    latestVideo.filter(x => x?.Type === 'Episode' && x?.SeriesId).map(x => x.SeriesId)
  ));
  let seriesMap = new Map();
  if (seriesIds.length && isAuthReady()) {
    try {
      const { found } = await fetchItemsBulk(seriesIds);
      seriesMap = found || new Map();
    } catch {}
  }
  const processedVideo = latestVideo.map(item => {
    if (item.Type === 'Episode' && item.SeriesId) {
      const seriesInfo = seriesMap.get(item.SeriesId);
      if (seriesInfo) {
        return {
          ...item,
          _seriesDateAdded: seriesInfo?.DateAdded || null,
          ImageTags: seriesInfo.ImageTags,
          BackdropImageTags: seriesInfo?.BackdropImageTags,
          ParentBackdropItemId: seriesInfo.Id,
          ParentBackdropImageTags: seriesInfo.BackdropImageTags
        };
      }
    }
    return item;
  });

  let latestAudioResp;
  try {
    latestAudioResp = await makeApiRequest(
      `/Users/${userId}/Items?SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Audio&Recursive=true&Limit=50`
    );
  } catch (e) {
    console.error("[notif] Latest(Audio) isteği hata:", e);
    latestAudioResp = {};
  }

  const audioItems = Array.isArray(latestAudioResp?.Items) ? latestAudioResp.Items : [];
  const combined = [...processedVideo, ...audioItems];

  const uniqMap = new Map();
  combined.forEach(it => { if (it?.Id) uniqMap.set(it.Id, it); });

  const out = Array.from(uniqMap.values());
  return out;
}

async function backfillFromLastSeen() {
  if (!isAuthReady()) return;
  if (!notifState.seenIds) notifState.seenIds = new Set();

  const items = await fetchLatestAll();
  if (!items.length) return;

   const newestTsRaw = items.reduce((acc, it) => Math.max(acc, getCreatedTs(it)), 0);
 const newestTs = clampToNow(newestTsRaw);

  if (!notifState.lastSeenCreatedAt) {
    items.forEach(it => notifState.seenIds.add(it.Id));
    notifState.lastSeenCreatedAt = newestTs || Date.now();
    saveState();
    updateBadge();
    return;
  }
  const fresh = items
   .filter(it =>
    !notifState.seenIds.has(it.Id) ||
     getCreatedTs(it) > notifState.lastSeenCreatedAt
   )
    .sort((a, b) => getCreatedTs(a) - getCreatedTs(b));

  if (fresh.length) {
  enqueueToastBurst(fresh, { type: "content" });
}

  if (newestTs) {
   notifState.lastSeenCreatedAt = Math.max(
     clampToNow(notifState.lastSeenCreatedAt),
     newestTs
   );
 }
  if (fresh.length) {
    saveState();
    updateBadge();
    if (document.querySelector("#jfNotifModal.open")) {
      renderNotifications();
    }
  }
}

function storageKey(base) {
  const userId = getSafeUserId();
  return `jf:${base}:${userId || "nouser"}`;
}

function getSafeUserId() {
  try { return getSessionInfo().userId; } catch { return null; }
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey("notifications"));
    if (raw) {
  notifState.list = JSON.parse(raw).map(x => ({
    ...x,
    status: x.status || "added",
    read: typeof x.read === "boolean" ? x.read : false
  }));
}
  } catch {}

  const tsRaw = localStorage.getItem(storageKey("lastSeenCreatedAt"));
  notifState.lastSeenCreatedAt = tsRaw ? Number(tsRaw) : 0;

  try {
    const seenRaw = localStorage.getItem(storageKey("seenIds"));
    notifState.seenIds = seenRaw ? new Set(JSON.parse(seenRaw)) : new Set();
  } catch { notifState.seenIds = new Set(); }

  const actTsRaw = localStorage.getItem(storageKey("activityLastSeen"));
  notifState.activityLastSeen = actTsRaw ? Number(actTsRaw) : 0;
  try {
    const actSeenRaw = localStorage.getItem(storageKey("activitySeenIds"));
    notifState.activitySeenIds = actSeenRaw ? new Set(JSON.parse(actSeenRaw)) : new Set();
  } catch { notifState.activitySeenIds = new Set(); }
}

function saveState() {
  try {
    localStorage.setItem(
      storageKey("notifications"),
      JSON.stringify(notifState.list.slice(0, MAX_STORE))
    );
    localStorage.setItem(storageKey("lastSeenCreatedAt"), String(notifState.lastSeenCreatedAt || 0));
    localStorage.setItem(storageKey("seenIds"), JSON.stringify(Array.from(notifState.seenIds || [])));
    localStorage.setItem(storageKey("activityLastSeen"), String(notifState.activityLastSeen || 0));
    localStorage.setItem(storageKey("activitySeenIds"), JSON.stringify(Array.from(notifState.activitySeenIds || [])));
  } catch {}
}

function getCreatedTs(item) {
  const id = item?.Id || item?.ItemId || item?.id;
  if (id && createdTsCache.has(id)) return createdTsCache.get(id);
  const seriesTs = Date.parse(item?._seriesDateAdded || "") || 0;
  const val = (
    seriesTs ||
    Date.parse(item?.DateCreated || "") ||
    Date.parse(item?.DateAdded || "") ||
    Date.parse(item?.AddedAt || "") ||
    Date.parse(item?.PremiereDate || "") ||
    Date.parse(item?.DateLastMediaAdded || "") ||
    0
  );
  if (id) {
    createdTsCache.set(id, val);
    if (createdTsCache.size > CREATED_TS_CACHE_MAX) {
      createdTsCache.delete(createdTsCache.keys().next().value);
    }
  }
  return val;
}

function ensureUI() {
  if (!config.enableNotifications) return;
  injectCriticalNotifCSS();
  const header = findHeaderContainer();
  if (header) ensureNotifButtonIn(header);
  startHeaderIconSentinel();

  if (!document.querySelector("#jfNotifModal")) {
    const showSystem = !!notifState._systemAllowed;
    const modal = document.createElement("div");
    modal.id = "jfNotifModal";
    modal.className = "jf-notif-modal";
     modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.pointerEvents = "none";
    modal.innerHTML = `
      <div class="jf-notif-backdrop" data-close></div>
      <div class="jf-notif-panel">
        <div class="jf-notif-head">
          <div class="jf-notif-title">${config.languageLabels.recentNotifications}</div>
          <div class="jf-notif-actions">
            <button id="jfNotifModeToggle" class="jf-notif-theme-toggle" title="${(config.languageLabels?.switchToDark)||'Koyu temaya geç'}">
              <i class="material-icons" aria-hidden="true">dark_mode</i>
            </button>
            <button id="jfNotifMarkAllRead" class="jf-notif-markallread" title="${config.languageLabels.markAllRead || 'Tümünü okundu say'}">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button id="jfNotifThemeToggle" class="jf-notif-theme-toggle" title="${config.languageLabels.themeToggleTooltip}">
              <i class="fa-solid fa-paintbrush"></i>
            </button>
            <button id="jfNotifClearAll" class="jf-notif-clearall">${config.languageLabels.clearAll}</button>
            <button class="jf-notif-close" data-close>×</button>
          </div>
        </div>
        <div class="jf-notif-tabs">
          <button class="jf-notif-tab active" data-tab="new">${config.languageLabels.newAddedTab || "Yeni Eklenenler"}</button>
          ${notifState._systemAllowed ? `<button class="jf-notif-tab" data-tab="system">${config.languageLabels.systemNotifications || "Sistem Bildirimleri"}</button>` : ""}
        </div>
        <div class="jf-notif-content">
          <div class="jf-notif-tab-content" data-tab="new">
            <div class="jf-notif-section">
              <div class="jf-notif-subtitle">${config.languageLabels.latestNotifications}</div>
              <ul class="jf-notif-list" id="jfNotifList"></ul>
            </div>
            ${config.enableRenderResume ? `
              <div class="jf-notif-section watching">
                <div class="jf-notif-subtitle">${config.languageLabels.unfinishedWatching}</div>
                <div class="jf-resume-list" id="jfResumeList"></div>
              </div>
            ` : ''}
          </div>
          ${notifState._systemAllowed ? `
          <div class="jf-notif-tab-content" data-tab="system" style="display:none;">
            <ul class="jf-activity-list" id="jfActivityList"></ul>
          </div>` : ``}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target.matches("[data-close]")) closeModal();
    });
      modal.addEventListener("transitionend", (ev) => {
      if (ev.target === modal && !modal.classList.contains("open")) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (!document.querySelector("#jfToastContainer")) {
    const c = document.createElement("div");
    c.id = "jfToastContainer";
    c.className = "jf-toast-container";
    document.body.appendChild(c);
  }

  document.getElementById("jfNotifModeToggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleThemeMode();
  });
  document.getElementById("jfNotifThemeToggle")?.addEventListener("click", toggleTheme);
  document.getElementById("jfNotifClearAll")?.addEventListener("click", (e) => { e.stopPropagation(); clearAllNotifications(); closeModal(); });
  document.getElementById("jfNotifMarkAllRead")?.addEventListener("click", (e) => { e.stopPropagation(); markAllNotificationsRead(); });

  ensureNotifStylesheet();
  loadThemePreference();
  loadThemeModePreference();
  updateBadge();
  renderUpdateBanner();
  setTimeout(setupNotifHover, 0);
  waitForNotifCss().then(() => {
    const crt = document.getElementById("jfNotifCriticalHide");
    if (crt) crt.remove();
  }).catch(()=>{});

  document.querySelectorAll(".jf-notif-tab").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      const tabName = tabBtn.getAttribute("data-tab");
      document.querySelectorAll(".jf-notif-tab").forEach(b => b.classList.toggle("active", b === tabBtn));
      document.querySelectorAll(".jf-notif-tab-content").forEach(c => {
        c.style.display = (c.getAttribute("data-tab") === tabName) ? "" : "none";
      });
    });
  });
  __uiReady = true;
ensureSystemTabPresence();
 }

function ensureSystemTabPresence() {
  const tabs = document.querySelector(".jf-notif-tabs");
  const contentHost = document.querySelector(".jf-notif-content");
  if (!tabs || !contentHost) return;
  const hasTab = !!tabs.querySelector('[data-tab="system"]');
  const allowed = !!notifState._systemAllowed;
  if (allowed && !hasTab) {
    const btn = document.createElement("button");
    btn.className = "jf-notif-tab";
    btn.setAttribute("data-tab", "system");
    btn.textContent = config.languageLabels.systemNotifications || "Sistem Bildirimleri";
    tabs.appendChild(btn);
    const pane = document.createElement("div");
    pane.className = "jf-notif-tab-content";
    pane.setAttribute("data-tab", "system");
    pane.style.display = "none";
    pane.innerHTML = `<ul class="jf-activity-list" id="jfActivityList"></ul>`;
    contentHost.appendChild(pane);
    btn.addEventListener("click", () => {
      document.querySelectorAll(".jf-notif-tab").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".jf-notif-tab-content").forEach(c => {
        c.style.display = (c.getAttribute("data-tab") === "system") ? "" : "none";
      });
    });
  }
}

function injectCriticalNotifCSS() {
  if (document.getElementById("jfNotifCriticalHide")) return;
  const style = document.createElement("style");
  style.id = "jfNotifCriticalHide";
  style.textContent = `
    #jfNotifModal { display: none !important; }
    #jfNotifModal.open { display: block !important; }
  `;
  document.head.appendChild(style);
}

function waitForNotifCss() {
  return new Promise((resolve, reject) => {
    const link = ensureNotifStylesheet();
    if (!link) return resolve();
    if (link.sheet) return resolve();
    const t = setTimeout(() => reject(new Error("css-timeout")), CSS_READY_TIMEOUT_MS);
    link.addEventListener("load", () => { clearTimeout(t); resolve(); }, { once: true });
    link.addEventListener("error", () => { clearTimeout(t); reject(new Error("css-error")); }, { once: true });
  });
}

document.addEventListener(
  "click",
  (ev) => {
    const btn = ev.target && (ev.target.id === "jfNotifModeToggle"
                 ? ev.target
                 : ev.target.closest?.("#jfNotifModeToggle"));
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { toggleThemeMode(); } catch {}
  },
  true
);

export function forcejfNotifBtnPointerEvents() {
   const apply = () => {
     document.querySelectorAll('html .skinHeader').forEach(el => {
       el.style.setProperty('pointer-events', 'all', 'important');
     });

     const jfNotifBtnToggle = document.querySelector('#jfNotifBtn');
     if (jfNotifBtnToggle) {
      jfNotifBtnToggle.style.setProperty('display', 'inline-flex', 'important');
      jfNotifBtnToggle.style.setProperty('pointer-events', 'all', 'important');
      jfNotifBtnToggle.style.removeProperty('text-shadow');
      jfNotifBtnToggle.style.removeProperty('color');
     }
   };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  if (!__forcePEObs) {
    __forcePEObs = new MutationObserver(apply);
    __forcePEObs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true
    });
    window.addEventListener('pagehide', () => { try { __forcePEObs.disconnect(); } catch {} __forcePEObs = null; }, { once: true });
  }
}

function openModal() {
  clearHoverTimers();
  const m = document.querySelector("#jfNotifModal");
  if (!m) return;
  m.hidden = false;
  m.removeAttribute("aria-hidden");
  m.style.pointerEvents = "";
  requestAnimationFrame(() => m.classList.add("open"));
  notifState.isModalOpen = true;
  renderNotifications();
  if (config.enableRenderResume) renderResume();
  if (notifState._systemAllowed) {
    pollActivities();
  }
}

 function closeModal() {
   clearHoverTimers();
  const m = document.querySelector("#jfNotifModal");
  if (m) {
    m.classList.remove("open");
  }
  notifState.isModalOpen = false;

  if (notifState._systemAllowed && config.enableCounterSystem && Array.isArray(notifState.activities)) {
    const newest = notifState.activities.reduce((acc, a) => {
      const ts = Date.parse(a?.Date || "") || 0;
      return Math.max(acc, ts);
    }, 0);
    if (newest && newest > (notifState.activityLastSeen || 0)) {
      notifState.activityLastSeen = newest;
      saveState();
      updateBadge();
    }
  }
}

function isSystemCounterEnabled() {
  try {
    const v = localStorage.getItem('enableCounterSystem');
    return v !== 'false';
  } catch {
    return !!config.enableCounterSystem;
  }
}

function updateBadge() {
  const badges = document.querySelectorAll(".jf-notif-badge");
  const btns = document.querySelectorAll("#jfNotifBtn");
  if (!badges.length && !btns.length) return;

  const contentUnread = notifState.list.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
  const lastSeenAct = Number(notifState.activityLastSeen || 0);
  const sysEnabled = isSystemCounterEnabled();
  const systemUnread = (notifState._systemAllowed && sysEnabled && Array.isArray(notifState.activities))
    ? notifState.activities.reduce((acc, a) => {
        const ts = Date.parse(a?.Date || "") || 0;
        return acc + (ts > lastSeenAct ? 1 : 0);
      }, 0)
    : 0;

  const total = contentUnread + systemUnread;
  const label = total > 99 ? "99+" : String(total);
  const show = total > 0;

  btns.forEach(btn => {
    btn.setAttribute("data-count", label);
    if (show) {
      btn.setAttribute("data-has-notifs", "true");
    } else {
      btn.removeAttribute("data-has-notifs");
    }
  });

    badges.forEach(badge => {
    badge.textContent = show ? label : "";
    badge.setAttribute("data-count", show ? label : "");
    badge.setAttribute("aria-hidden", show ? "false" : "true");
    badge.hidden = !show;
    badge.style.display = show ? "" : "none";
  });
}

async function renderNotifications() {
  const ul = document.querySelector("#jfNotifList");
  if (!ul) return;
  const gen = ++notifRenderGen;
  const map = new Map();
  for (const n of notifState.list) {
    const key = `${n.itemId || "none"}:${n.status || "added"}`;
    const prev = map.get(key);
    if (!prev || (n.timestamp || 0) > (prev.timestamp || 0)) map.set(key, n);
  }
  const compact = Array.from(map.values());
  let items = compact.sort((a,b)=> (b.timestamp||0)-(a.timestamp||0)).slice(0, MAX_NOTIFS);

const updates = items.filter(n => n.status === "update");
const normals = items.filter(n => n.status !== "update");
items = [...updates, ...normals];

  if (items.length === 0) {
    ul.innerHTML = `
      <li class="jf-notif-empty">
        <i class="fa-solid fa-box-open" aria-hidden="true"></i>
        <span>${config.languageLabels.noNewContent || "Yeni içerik yok."}</span>
      </li>`;
    return;
  }

  const idList = items.map(n => n.itemId).filter(Boolean);
  const { found } = idList.length ? await fetchItemsBulk(idList) : { found: new Map() };

function getDetailFor(n) {
  const d = n.itemId ? (found.get(n.itemId) || null) : null;
  return { ok: !!d, data: d };
}

  function pickVideoStream(ms) {
  return Array.isArray(ms) ? ms.find(s => s.Type === "Video") : null;
}

  if (gen !== notifRenderGen) return;

  ul.innerHTML = "";
  const frag = document.createDocumentFragment();

  items.forEach((n, i) => {
  const li = document.createElement("li");
  const isUpdate = (n.status === "update");
  if (isUpdate) {
  li.className = "jf-notif-item jf-notif-update";
  li.innerHTML = `
    <div class="meta">
      <div class="title">
        <span class="jf-badge jf-badge-update" title="${config.languageLabels?.updateAvailable || 'Yeni sürüm mevcut'}">
          <i class="fa-solid fa-arrows-rotate"></i>
        </span>
        ${escapeHtml(n.title || `${config.languageLabels?.updateAvailable || "Yeni sürüm mevcut"}`)}
        ${!n.read ? `<span class="jf-pill-unread">${escapeHtml(config.languageLabels?.unread || "Yeni")}</span>` : ""}
      </div>
      <div class="time">${formatTime(n.timestamp)}</div>
    </div>
    <div class="actions">
      <a class="lnk" target="_blank" rel="noopener" href="${escapeHtml(n.url || "https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases")}">
        ${escapeHtml(config.languageLabels?.viewOnGithub || "GitHub’da Gör / İndir")}
      </a>
      ${!n.read ? `
        <button class="mark-read" title="${config.languageLabels?.markRead || 'Okundu say'}">
          <i class="fa-solid fa-envelope-open"></i>
        </button>` : ""}
      <button class="del" title="${escapeHtml(config.languageLabels?.removeTooltip || 'Kaldır')}">
        <i class="fa-solid fa-circle-xmark"></i>
      </button>
    </div>
  `;

  li.querySelector(".mark-read")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    markNotificationRead(n.id);
  });
  li.querySelector(".del")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    removeNotification(n.id);
  });

  frag.appendChild(li);
  return;
}

    li.className = "jf-notif-item";

  const d = getDetailFor(n);
  const status = n.status === "removed" ? "removed" : "added";
  const statusLabel = status === "removed"
    ? (config.languageLabels.removedLabel || "Kaldırıldı")
    : (config.languageLabels.addedLabel || "Eklendi");

  let title = n.title || config.languageLabels.newContentDefault;

  if (d.ok && d.data?.Type === "Episode") {
    const seriesName  = d.data.SeriesName || "";
    const seasonNum   = d.data.ParentIndexNumber || 0;
    const episodeNum  = d.data.IndexNumber || 0;
    const episodeName = d.data.Name || "";
    title = formatEpisodeHeading({
      seriesName,
      seasonNum,
      episodeNum,
      episodeTitle: episodeName,
      locale: (config.defaultLanguage || "tur"),
      labels: config.languageLabels || {}
    });
  } else if (d.ok && d.data?.Type === "Episode" && d.data?.SeriesName) {
    title = `${d.data.SeriesName} - ${title}`;
  }

  const imgSrc = safePosterImageSrc(d.ok ? d.data : null, 80, 80);
  const vStream = d.ok ? (Array.isArray(d.data?.MediaStreams) ? d.data.MediaStreams.find(s => s.Type === "Video") : null) : null;
  const qualityHtml = vStream ? getVideoQualityText(vStream) : "";

  const isUnread = !n.read;
  if (isUnread) li.classList.add("unread");

  li.innerHTML = `
  ${imgSrc ? `<img class="thumb" src="${escapeHtml(jfUrl(imgSrc))}" alt="" onerror="this.style.display='none'">` : ""}
    <div class="meta">
      <div class="title">
        <span class="jf-badge ${status === "removed" ? "jf-badge-removed" : "jf-badge-added"}">${escapeHtml(statusLabel)}</span>
        ${escapeHtml(title)}
        ${isUnread ? `<span class="jf-pill-unread">${escapeHtml(config.languageLabels?.unread || "Yeni")}</span>` : ""}
      </div>
      <div class="time">${formatTime(n.timestamp)}</div>
      ${qualityHtml ? `<div class="quality">${qualityHtml}</div>` : ""}
    </div>
    <div class="actions">
      ${isUnread ? `
        <button class="mark-read" title="${config.languageLabels?.markRead || 'Okundu say'}">
          <i class="fa-solid fa-envelope-open"></i>
        </button>` : ""}
      <button class="del" title="${escapeHtml(config.languageLabels?.removeTooltip || 'Kaldır')}">
        <i class="fa-solid fa-circle-xmark"></i>
      </button>
    </div>
  `;

  li.querySelector(".mark-read")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    markNotificationRead(n.id);
  });

  if (status !== "removed" && n.itemId) {
    li.addEventListener("click", () => {
      markNotificationRead(n.id, { silent: true });
      closeModal();
      goToDetailsPage(n.itemId);
    });
  }

  li.querySelector(".del").addEventListener("click", (ev) => {
    ev.stopPropagation();
    removeNotification(n.id);
  });

  frag.appendChild(li);
});

  if (gen !== notifRenderGen) return;
  ul.appendChild(frag);
}

function scrollToLastItem() {
    const list = document.querySelector('.jf-notif-list');
    if (list && list.lastElementChild) {
        list.lastElementChild.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
        });
    }
}

function formatTimeLeft(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}${config.languageLabels.sa}`);
  if (m > 0) parts.push(`${m}${config.languageLabels.dk}`);
  if (s > 0) parts.push(`${s}${config.languageLabels.sn}`);
  return parts.join(" ");
}

async function renderResume() {
  if (!config.enableRenderResume) return;

  const container = document.querySelector("#jfResumeList");
  if (!container) return;
  container.innerHTML = `<div class="jf-loading">${config.languageLabels.loadingText}</div>`;
  try {
    const { userId } = getSessionInfo();
    const data = await makeApiRequest(`/Users/${userId}/Items/Resume?Limit=${config.renderResume || 10}&MediaTypes=Video`);
    const items = Array.isArray(data?.Items) ? data.Items : [];
if (!items.length) {
  container.innerHTML = `<div class="jf-empty">${config.languageLabels.noUnfinishedContent}</div>`;
  return;
}

const details = await Promise.all(
  items.map(it => fetchItemDetails(it.Id).catch(() => null))
);

container.innerHTML = "";
items.forEach((it, idx) => {
  const card = document.createElement("div");
  card.className = "jf-resume-card";

  const pct = Math.round(((it?.UserData?.PlaybackPositionTicks || 0) / (it?.RunTimeTicks || 1)) * 100);
  const totalSec = (it.RunTimeTicks || 0) / 10_000_000;
  const playedSec = (it?.UserData?.PlaybackPositionTicks || 0) / 10_000_000;
  const remainingSec = Math.max(totalSec - playedSec, 0);
  const d = details[idx];
  const vStream = d && Array.isArray(d.MediaStreams) ? d.MediaStreams.find(s => s.Type === "Video") : null;
  const qualityHtml = vStream ? getVideoQualityText(vStream) : "";

  card.innerHTML = `
    ${hasPrimaryImage(it) ? `<img class="poster" src="${escapeHtml(jfUrl(safePosterImageSrc(it, 160, 80)))}" alt="">` : ""}
    <div class="resume-meta">
      <div class="name">${escapeHtml(it.Name || config.languageLabels.newContentDefault)}</div>
      ${qualityHtml ? `<div class="quality">${qualityHtml}</div>` : ""}
      <div class="progress"><div class="bar" style="width:${Math.min(pct,100)}%"></div></div>
      <div class="time-left">${formatTimeLeft(remainingSec)} ${config.languageLabels.kaldi}</div>
      <button class="resume-btn">${config.languageLabels.devamet}</button>
    </div>
  `;
  card.querySelector(".resume-btn").addEventListener("click", () => {
  playNow(it.Id);
  closeModal();
});
  container.appendChild(card);
});
  } catch (e) {
    console.error("Resume listesi alınamadı:", e);
    container.innerHTML = `<div class="jf-error">${config.languageLabels.listError}</div>`;
  }
}

async function pollLatest({ seedIfFirstRun = false } = {}) {
  if (!isAuthReady()) return;
  if (!notifState.seenIds) notifState.seenIds = new Set();
  try {
    const items = await fetchLatestAll();
    if (!items.length) return;

    const newestTs = clampToNow(items.reduce((acc, it) => Math.max(acc, getCreatedTs(it)), 0));

    if (seedIfFirstRun && (!notifState.lastSeenCreatedAt || notifState.seenIds.size === 0)) {
      items.forEach(it => notifState.seenIds.add(it.Id));
      notifState.lastSeenCreatedAt = newestTs || Date.now();
      saveState();
      updateBadge();
      return;
    }

    const fresh = items
     .filter(it =>
       !notifState.seenIds.has(it.Id) ||
       getCreatedTs(it) > (notifState.lastSeenCreatedAt || 0)
     )
      .sort((a, b) => getCreatedTs(a) - getCreatedTs(b));

    const nowTs = Date.now();
    for (const it of fresh) {
      pushNotification({
        itemId: it.Id,
        title: it.Name || config.languageLabels.newContentDefault,
        timestamp: nowTs,
        status: "added",
      });
      notifState.seenIds.add(it.Id);
    }

    const TOAST_GROUP_THRESHOLD = config.toastGroupThreshold || 5;
    if (fresh.length >= TOAST_GROUP_THRESHOLD) {
      enqueueToastGroup(fresh);
    } else {
      for (const it of fresh) queueToast(it);
    }

    if (newestTs) {
     notifState.lastSeenCreatedAt = Math.max(
       clampToNow(notifState.lastSeenCreatedAt),
       newestTs
     );
   }

    if (fresh.length) {
      saveState();
      updateBadge();
      if (document.querySelector("#jfNotifModal.open")) {
        renderNotifications();
      }
    }
  } catch (e) {
    console.error("Latest poll hatası:", e);
  }
}

function pushNotification(n) {
  const ts = n.timestamp || Date.now();
  const key = `${n.itemId || "none"}:${n.status || "added"}`;

  notifState.list = notifState.list.filter(item =>
    !(item.itemId === n.itemId && item.status === n.status)
  );

  const id = `${n.itemId || n.id || Math.random().toString(36).slice(2)}:${ts}`;
  notifState.list.unshift({
    id,
    itemId: n.itemId,
    title: n.title,
    timestamp: ts,
    status: n.status || "added",
    read: false,
  });

  if (notifState.list.length > MAX_STORE) {
    notifState.list = notifState.list.slice(0, MAX_STORE);
  }

  saveState();
}

function removeNotification(id) {
  const before = notifState.list.length;
  notifState.list = notifState.list.filter(n => n.id !== id);
  if (notifState.list.length !== before) {
    saveState();
    renderNotifications();
    updateBadge();
    requestAnimationFrame(updateBadge);
  }
}

function clearAllNotifications() {
  if (!notifState.list.length) return;
  notifState.list = [];
  saveState();
  renderNotifications();
  updateBadge();
  requestAnimationFrame(updateBadge);
}

function queueToast(it, { type = "content", status = "added" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (type === "activity" && !config.enableToastSystem) return;

  const key = `${type}:${status}:${it.Id || it.ItemId || it.id || it.Name}`;
  if (!toastShouldEnqueue(key)) return;

  const useId = it.Id || it.ItemId;
  const safeStatus = status === "removed" ? "removed" : "added";
  const push = (resolved) => {
   const merged = resolved ? { ...it, ...resolved } : { ...it };
   if (!merged.Name && resolved?.Name) merged.Name = resolved.Name;
   notifState.toastQueue.push({ type, it: merged, status: safeStatus });
    runToastQueue();
  };

  if (useId) {
    fetchItemDetails(useId).then(push).catch(() => {
      notifState.toastQueue.push({ type, it, status: safeStatus });
      runToastQueue();
    });
  } else {
    notifState.toastQueue.push({ type, it, status: safeStatus });
    runToastQueue();
  }
}

function enqueueToastBurst(items, { type = "content" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (type === "activity" && !config.enableToastSystem) return;

  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    const k = `${type}:${it.Id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!toastShouldEnqueue(k)) continue;
    uniq.push(it);
  }

  if (uniq.length === 0) return;
  if (uniq.length === 1) {
    notifState.toastQueue.push({ type, it: uniq[0] });
  } else if (uniq.length === 2) {
    notifState.toastQueue.push({ type, it: uniq[0] }, { type, it: uniq[1] });
  } else {
    notifState.toastQueue.push({ type, it: uniq[0] }, { type, it: uniq[uniq.length - 1] });
  }

  runToastQueue();
}

function enqueueToastGroup(items, { type = "content" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (!Array.isArray(items) || items.length === 0) return;

  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    const id = it?.Id || it?.ItemId || it?.id || it?.Name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(it);
  }
  if (!uniq.length) return;

  const head = uniq.slice(0, 4);
  notifState.toastQueue.push({
    type: "content-group",
    items: head,
    total: uniq.length
  });
  runToastQueue();
}

function runToastQueue() {
  if (notifState.toastShowing) return;

    while (notifState.toastQueue.length &&
         notifState.toastQueue[0].type === "activity" &&
         !config.enableToastSystem) {
     notifState.toastQueue.shift();
   }

  if (notifState.toastQueue.length > TOAST_QUEUE_MAX) {
    notifState.toastQueue = notifState.toastQueue.slice(-TOAST_QUEUE_MAX);
  }
  const next = notifState.toastQueue.shift();
  if (!next) return;

  const { type, it, status = "added", items, total } = next;
  const c = document.querySelector("#jfToastContainer");
  if (!c) {
    notifState.toastQueue.unshift(next);
    setTimeout(runToastQueue, 500);
    return;
  }

  notifState.toastShowing = true;

  const toast = document.createElement("div");
  toast.className = "jf-toast" + (type === "activity" ? " jf-toast-activity" : "");

  if (type === "content-group") {
    const arr = Array.isArray(items) ? items : [];
    const first = arr[0] || {};
    const firstPoster = hasPrimaryImage(first) ? safePosterImageSrc(first, 80, 80) : "";
    const next3 = arr.slice(1, 4);
    const restCount = Math.max((total || arr.length) - arr.length, 0);

    const statusLabel = (config.languageLabels.addedLabel || "Eklendi");
    const firstName = escapeHtml(first?.Name || config.languageLabels.newContentDefault);
    const namesList = next3.map(x => `<li>${escapeHtml(x?.Name || "")}</li>`).join("");
    const moreHtml = restCount > 0 ? `<div class="more">${escapeHtml(moreItemsLabel(restCount))}</div>` : "";

    toast.innerHTML = `
     ${firstPoster ? `<img class="thumb" src="${escapeHtml(jfUrl(firstPoster))}" alt="" onerror="this.style.display='none'">` : ""}
      <div class="text">
        <b>
          <span class="jf-badge jf-badge-added">${escapeHtml(statusLabel)}</span>
          ${escapeHtml(config.languageLabels.newContentAdded)}
        </b><br>
        ${firstName}
        ${namesList ? `<ul class="names">${namesList}</ul>` : ""}
        ${moreHtml}
      </div>
    `;
    toast.addEventListener("click", () => {
      if (typeof openModal === "function") openModal();
    });

  } else if (type === "update") {
    const title = it?.Name || (config.languageLabels.updateAvailable || "Yeni sürüm mevcut");
    const desc  = it?.Overview ? ` – ${escapeHtml(it.Overview)}` : "";
    toast.innerHTML = `
      <div class="text">
        <b>${escapeHtml(title)}</b><br>
        ${desc}
      </div>
    `;
    if (it?.Url) {
      toast.style.cursor = "pointer";
      toast.addEventListener("click", () => window.open(it.Url, "_blank", "noopener"));
    }

    } else if (type === "content") {
    let displayName = it.Name || "";
    if (it.Type === "Episode") {
      displayName = formatEpisodeHeading({
        seriesName: it.SeriesName || "",
        seasonNum: it.ParentIndexNumber || 0,
        episodeNum: it.IndexNumber || 0,
        episodeTitle: it.Name || "",
        locale: (config.defaultLanguage || "tur"),
        labels: config.languageLabels || {}
      });
    }
    const statusLabel = status === "removed"
      ? (config.languageLabels.removedLabel || "Kaldırıldı")
      : (config.languageLabels.addedLabel || "Eklendi");
   toast.innerHTML = `
    ${status !== "removed" ? `<img class="thumb" src="${escapeHtml(jfUrl(safePosterImageSrc(it, 80, 80)))}" alt="" onerror="this.style.display='none'">` : ""}
     <div class="text">
       <b>
         <span class="jf-badge ${status === "removed" ? "jf-badge-removed" : "jf-badge-added"}">${escapeHtml(statusLabel)}</span>
         ${status === "removed" ? (config.languageLabels.contentChanged || "İçerik değişti") : config.languageLabels.newContentAdded}
       </b><br>
       ${escapeHtml(displayName)}
     </div>
   `;
  if (status !== "removed") {
    toast.addEventListener("click", () => it.Id && playNow(it.Id));
  }
} else {
  const title = it?.Name || it?.Type || (config.languageLabels.systemNotifications || "Sistem Bildirimi");
  const desc = it?.Overview ? ` – ${escapeHtml(it.Overview)}` : "";
  toast.innerHTML = `
    <div class="text">
      <b>${config.languageLabels.systemNotificationAdded || "Sistem bildirimi"}</b><br>
      ${escapeHtml(title)}${desc}
    </div>
  `;
  if (it?.Url) {
    toast.style.cursor = "pointer";
    toast.addEventListener("click", () => window.open(it.Url, "_blank", "noopener"));
  }
}

  c.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      c.removeChild(toast);
      setTimeout(() => {
        notifState.toastShowing = false;
        runToastQueue();
      }, TOAST_GAP_MS);
    }, 250);
  }, TOAST_DURATION_MS);
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch { return ""; }
}

function markActivityRead(a, { silent = false } = {}) {
  const ts = Date.parse(a?.Date || "") || 0;
  if (ts > (notifState.activityLastSeen || 0)) {
    notifState.activityLastSeen = ts;
    saveState();
    updateBadge();
    if (!silent) renderNotifications();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

export async function initNotifications() {
  await waitForAuthReady(15000);
  migrateNouserToUser();
  notifState._systemAllowed = await canReadActivityLog();

  loadState();
  ensureUI();
  ensureSystemTabPresence();

  setTimeout(() => ensureNotifButtonIn(findHeaderContainer()), 250);
  setTimeout(() => ensureNotifButtonIn(findHeaderContainer()), 750);

  await backfillFromLastSeen();
  await pollLatest({ seedIfFirstRun: true });
  if (notifState._systemAllowed) {
    await pollActivities({ seedIfFirstRun: true });
    schedulePollActivities(POLL_INTERVAL_MS);
  }

  schedulePollLatest(POLL_INTERVAL_MS);

  setInterval(async () => {
    const before = !!notifState._systemAllowed;
    const nowAllowed = await canReadActivityLog();
    notifState._systemAllowed = !!nowAllowed;
    if (!before && nowAllowed) {
      ensureSystemTabPresence();
      renderNotifications();
      pollActivities({ seedIfFirstRun: true });
    }
  }, 20_000);

  window.forceCheckNotifications = () => {
     pollLatest();
     if (notifState._systemAllowed) pollActivities();
   };

   window.addEventListener("focus", () => {
     if (document.querySelector("#jfNotifModal.open")) {
       renderResume();
       if (notifState._systemAllowed) pollActivities();
     }
   });

  const onVis = () => {
    const hidden = document.hidden;
    pollCtl.paused = hidden;
    if (hidden) {
      clearTimeout(pollCtl.latestTimer); pollCtl.latestTimer = null;
      clearTimeout(pollCtl.actTimer);    pollCtl.actTimer = null;
    } else {
      schedulePollLatest(500);
      if (notifState._systemAllowed) schedulePollActivities(800);
    }
  };
  document.addEventListener('visibilitychange', onVis);
 }

function schedulePollLatest(delay = POLL_INTERVAL_MS) {
  if (pollCtl.paused) return;
  clearTimeout(pollCtl.latestTimer);
  pollCtl.latestTimer = setTimeout(async () => {
    if (pollCtl.latestRunning) return schedulePollLatest(1000);
    pollCtl.latestRunning = true;
    try { await pollLatest(); }
    catch (e) {  }
    finally {
      pollCtl.latestRunning = false;
      schedulePollLatest(isAuthReady() ? POLL_INTERVAL_MS : 1000);
    }
  }, Math.max(300, delay));
}

function schedulePollActivities(delay = POLL_INTERVAL_MS) {
  if (pollCtl.paused) return;
  clearTimeout(pollCtl.actTimer);
  pollCtl.actTimer = setTimeout(async () => {
    if (pollCtl.actRunning) return schedulePollActivities(1000);
    pollCtl.actRunning = true;
    try { await pollActivities(); }
    catch (e) {}
    finally {
      pollCtl.actRunning = false;
      schedulePollActivities(POLL_INTERVAL_MS);
    }
  }, Math.max(500, delay));
}

async function waitForSessionReady(timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const s = getSessionInfo();
      if (s && s.userId) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function migrateNouserToUser() {
  const uid = getSafeUserId();
  if (!uid) return;

  const parts = ["notifications", "lastSeenCreatedAt", "seenIds"];
  for (const p of parts) {
    const src = `jf:${p}:nouser`;
    const dst = `jf:${p}:${uid}`;
    const v = localStorage.getItem(src);
    if (v && !localStorage.getItem(dst)) {
      localStorage.setItem(dst, v);
      console.log(`[notif] migrated ${p} from nouser -> ${uid}`);
    }
  }
}

function clampToNow(ts) {
  const now = Date.now();
  return Math.min(Number(ts) || 0, now);
}

const ADMIN_CAP_TTL_MS = 5 * 60 * 1000;
const ADMIN_NEG_TTL_MS = 15 * 1000;

async function canReadActivityLog() {
  if (!isAuthReady()) return false;

  const now = Date.now();
  if (!notifState._adminCapCache) {
    notifState._adminCapCache = { value: null, ts: 0, neg: false };
  }

  const cached = notifState._adminCapCache;
  if (cached.value !== null) {
    const ttl = cached.neg ? ADMIN_NEG_TTL_MS : ADMIN_CAP_TTL_MS;
    if ((now - cached.ts) < ttl) {
      return cached.value;
    }
  }

  let isAdmin = false;
    try {
      const s = getSessionInfo();
      isAdmin = !!(
        s?.User?.Policy?.IsAdministrator ||
        s?.IsAdministrator ||
        s?.user?.Policy?.IsAdministrator
      );
    } catch {}
    if (!isAdmin) {
      try {
        isAdmin = await isCurrentUserAdmin();
      } catch {
    }
  }

  const value = isAdmin === true;

  notifState._adminCapCache = {
    value,
    ts: now,
    neg: !value
  };

  return value;
}

async function fetchActivityLog(limit = 30) {
  const allowed = await canReadActivityLog();
  if (!allowed) return [];
  try {
    const resp = await makeApiRequest(`/System/ActivityLog/Entries?StartIndex=0&Limit=${limit}`);
    const items = Array.isArray(resp?.Items) ? resp.Items : (Array.isArray(resp) ? resp : []);
    return items;
  } catch (e) {
    const msg = String(e?.message || "");
    const code = e?.status;
    if (code !== 401 && code !== 403 && !msg.includes("401") && !msg.includes("403")) {
      console.error("[notif] ActivityLog isteği hata:", e);
    }
    return [];
  }
}

function renderActivities(activities = []) {
  const ul = document.querySelector("#jfActivityList");
  if (!ul) return;
  ul.innerHTML = "";

  if (!activities.length) {
    ul.innerHTML = `<li class="jf-activity-empty">${config.languageLabels.noSystemActivities || "Henüz sistem bildirimi yok."}</li>`;
    return;
  }

  const lastSeenAct = Number(notifState.activityLastSeen || 0);

  activities.forEach(a => {
    const ts = Date.parse(a?.Date || "") || 0;
    const title = a?.Name || a?.Type || "Etkinlik";
    const desc = a?.Overview || "";
    const id = a?.Id || `act:${ts}:${title}`;

    const li = document.createElement("li");
    li.className = "jf-activity-item";
    if (ts > lastSeenAct) li.classList.add("unread");
    li.innerHTML = `
      <div class="icon"><i class="fa-solid fa-circle-info"></i></div>
      <div class="meta">
        <div class="title">
          ${escapeHtml(title)}
          ${ts > lastSeenAct ? `<span class="jf-pill-unread">${escapeHtml(config.languageLabels?.unread || "Yeni")}</span>` : ""}
        </div>
        ${desc ? `<div class="desc">${escapeHtml(desc)}</div>` : ""}
        <div class="time">${formatTime(ts)}</div>
      </div>
    `;

    if (a?.ItemId) li.addEventListener("click", () => playNow(a.ItemId));

    ul.appendChild(li);
  });
}

function isRemovalActivity(a) {
  const t = (a?.Type || "").toLowerCase();
  const n = (a?.Name || "").toLowerCase();
  const o = (a?.Overview || "").toLowerCase();

  return (
    t.includes("remove") || t.includes("deleted") || t.includes("delete") ||
    n.includes("remove") || n.includes("deleted") || n.includes("delete") ||
    o.includes("remove") || o.includes("deleted") || o.includes("delete") ||
    n.includes("kaldır") || o.includes("kaldır") || o.includes("silindi") || n.includes("silindi")
  );
}

 notifState._activityBackoffMs ??= 0;
const BACKOFF_STEP_MS = 5_000;
const BACKOFF_MAX_MS  = 60_000;

async function pollActivities({ seedIfFirstRun = false } = {}) {
  if (!isAuthReady()) return;
  if (!notifState.activitySeenIds) notifState.activitySeenIds = new Set();
   if (notifState._activityBackoffMs > 0) {
     await new Promise(r => setTimeout(r, notifState._activityBackoffMs));
   }

   const acts = await fetchActivityLog(30).catch(() => []);
    if (!acts.length) {
      notifState.activities = [];
      updateBadge();
      renderActivities([]);
     notifState._activityBackoffMs = Math.min(
       (notifState._activityBackoffMs || 0) + BACKOFF_STEP_MS,
       BACKOFF_MAX_MS
     );
      return;
    }
   notifState._activityBackoffMs = 0;

    const newestTs = clampToNow(
      acts.reduce((acc, a) => Math.max(acc, Date.parse(a?.Date || "") || 0), 0)
    );

    if (seedIfFirstRun && (!notifState.activityLastSeen || notifState.activitySeenIds.size === 0)) {
       acts.forEach(a => notifState.activitySeenIds.add(a.Id || `${a.Type}:${a.Date}`));
       notifState.activityLastSeen = newestTs || Date.now();
       notifState.activities = acts;
       saveState();
       updateBadge();
       renderActivities(acts);
       return;
     }

   function safeParseTs(s) {
   const t = Date.parse(s || "");
   return Number.isFinite(t) ? t : 0;
 }

 const fresh =
   acts
     .map((a, idx) => {
       const id = a.Id || `${a.Type}:${a.Date}`;
       return { a, id, idx, ts: clampToNow(safeParseTs(a?.Date)) };
     })
     .filter(({ id }) => !notifState.activitySeenIds.has(id))
     .sort((x, y) => (x.ts - y.ts) || (x.idx - y.idx))
     .map(x => x.a);

    const nonRemoval = [];
   let newestFreshTs = 0;

    for (const a of fresh) {
      const id = a.Id || `${a.Type}:${a.Date}`;
      notifState.activitySeenIds.add(id);

     const ts = Date.parse(a?.Date || "") || 0;
     if (ts > newestFreshTs) newestFreshTs = ts;

      if (isRemovalActivity(a)) {
        const itemId = a.ItemId || a.Item?.Id;
        const title = a.Item?.Name || a.Name || a.Type || "İçerik";
        pushNotification({
          itemId,
          title,
          timestamp: Date.parse(a?.Date || "") || Date.now(),
          status: "removed",
        });
        queueToast({ Id: itemId, Name: title }, { type: "content", status: "removed" });
      } else {
        nonRemoval.push(a);
      }
    }

    enqueueActivityToastBurst(nonRemoval);

    notifState.activities = acts;
    saveState();
    updateBadge();
    renderActivities(acts);

    if (document.querySelector("#jfNotifModal.open")) {
      renderNotifications();
      updateBadge();
    }
  }

function activityKey(a) {
  if (a?.Id) return `activity:${a.Id}`;
  return `activity:${a.Type || "act"}|${a.Date || ""}|${a.Overview || ""}|${a.Name || ""}`;
}

function enqueueActivityToastBurst(activities = []) {
  if (!config.enableToastSystem) return;

  const seen = new Set();
  const uniq = [];
  for (const a of activities) {
    const k = activityKey(a);
    if (seen.has(k)) continue;
    if (!toastShouldEnqueue(k)) continue;
    seen.add(k);
    uniq.push(a);
  }

  if (!uniq.length) return;

  const LIMIT = 6;
  const picks = uniq.length <= LIMIT ? uniq : [uniq[0], uniq[uniq.length - 1]];
  for (const a of picks) {
    notifState.toastQueue.push({ type: "activity", it: a });
  }
  runToastQueue();
}


function getThemeModeKey() {
  const userId = getSafeUserId();
  return `jf:notifThemeMode:${userId || "nouser"}`;
}

function setThemeMode(mode) {
  const m = (mode === "dark") ? "dark" : "light";
  document.documentElement.setAttribute("data-notif-theme", m);
  document.body?.setAttribute?.("data-notif-theme", m);
  try { localStorage.setItem(getThemeModeKey(), m); } catch {}
  const btn = document.getElementById("jfNotifModeToggle");
  if (btn) {
    const icon = btn.querySelector(".material-icons");
    if (icon) icon.textContent = (m === "dark") ? "light_mode" : "dark_mode";
    btn.title = (m === "dark")
      ? (config.languageLabels?.switchToLight || "Açık temaya geç")
      : (config.languageLabels?.switchToDark  || "Koyu temaya geç");
  }
}

function loadThemeModePreference() {
  let m = null;
  try { m = localStorage.getItem(getThemeModeKey()); } catch {}
  if (!m) {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    m = prefersDark ? "dark" : "light";
  }
  setThemeMode(m);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", (ev) => {
    setThemeMode(ev.matches ? "dark" : "light");
  });
}

function toggleThemeMode() {
  const current = document.documentElement.getAttribute("data-notif-theme") || "light";
  setThemeMode(current === "dark" ? "light" : "dark");
}

function markNotificationRead(id, { silent = false } = {}) {
  let changed = false;
  notifState.list = notifState.list.map(n => {
    if (n.id === id && !n.read) {
      changed = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (changed) {
    saveState();
    updateBadge();
    if (!silent) renderNotifications();
  }
}

function markAllNotificationsRead() {
  let changed = false;
  notifState.list = notifState.list.map(n => {
    if (!n.read) { changed = true; return { ...n, read: true }; }
    return n;
  });
  if (changed) {
    saveState();
    updateBadge();
    renderNotifications();
    requestAnimationFrame(updateBadge);
  }
}

function getStoredUpdateBanner() {
  try { return JSON.parse(localStorage.getItem(UPDATE_BANNER_KEY()) || "null"); } catch { return null; }
}
function setStoredUpdateBanner(data) {
  if (!data) localStorage.removeItem(UPDATE_BANNER_KEY());
  else localStorage.setItem(UPDATE_BANNER_KEY(), JSON.stringify(data));
}
function getUpdateToastShown() {
  return localStorage.getItem(UPDATE_TOAST_SHOWN_KEY()) || "";
}
function setUpdateToastShown(v) {
  localStorage.setItem(UPDATE_TOAST_SHOWN_KEY(), v || "");
}

export function renderUpdateBanner() {
  const el = document.getElementById("jfUpdateBanner");
  if (!el) return;

  const data = getStoredUpdateBanner();
  if (!data || !data.latest) {
    el.style.display = "none";
    return;
  }

  const current = getCurrentVersionFromEnv();
  if (compareSemver(current, data.latest) >= 0) {
    setStoredUpdateBanner(null);
    el.style.display = "none";
    return;
  }

  el.style.display = "flex";

  const txt = el.querySelector(".txt");
  const lnk = el.querySelector(".lnk");
  const dis = el.querySelector(".dismiss");

  txt.textContent = `${config.languageLabels?.updateAvailable || "Yeni sürüm mevcut"}: ${data.latest}`;
  lnk.textContent = config.languageLabels?.viewOnGithub || "GitHub'da Gör / İndir";
  lnk.href = data.url || "https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases";

  dis.onclick = () => {
    el.style.display = "none";
    setStoredUpdateBanner(null);
  };
}

window.jfNotifyUpdateAvailable = ({ latest, url, remindMs }) => {
  try {
    setStoredUpdateBanner({ latest, url });
    renderUpdateBanner();
    upsertUpdateNotification({ latest, url });

    const DEFAULT_REMIND = 12 * 60 * 60 * 1000;
    const remindEvery = (typeof remindMs === "number" && remindMs >= 0) ? remindMs : DEFAULT_REMIND;

    const info = getUpdateToastInfo();
    const now = Date.now();
    let shouldShow = !info || info.latest !== latest || (now - Number(info.shownAt || 0)) >= remindEvery;

    if (shouldShow) {
      notifState.toastQueue.push({
        type: "update",
        it: {
          Name: config.languageLabels?.updateAvailable || "Yeni sürüm mevcut",
          Overview: `${latest}`,
          Url: url
        }
      });
      runToastQueue();
      setUpdateToastInfo({ latest, shownAt: now });
    }
  } catch (e) {
    console.warn("jfNotifyUpdateAvailable error:", e);
  }
};

 function getUpdateToastInfo() {
  const old = localStorage.getItem(UPDATE_TOAST_SHOWN_KEY());
  if (old) {
    try {
      localStorage.removeItem(UPDATE_TOAST_SHOWN_KEY());
      const info = { latest: old, shownAt: 0 };
      localStorage.setItem(UPDATE_TOAST_INFO_KEY(), JSON.stringify(info));
      return info;
    } catch {}
  }
  try {
    return JSON.parse(localStorage.getItem(UPDATE_TOAST_INFO_KEY()) || "null");
  } catch { return null; }
}
function setUpdateToastInfo(info) {
  if (!info) localStorage.removeItem(UPDATE_TOAST_INFO_KEY());
  else localStorage.setItem(UPDATE_TOAST_INFO_KEY(), JSON.stringify(info));
}

function formatEpisodeHeading({
  seriesName,
  seasonNum,
  episodeNum,
  episodeTitle,
  locale = (getConfig()?.defaultLanguage || "tur"),
  labels = (getConfig()?.languageLabels || {})
}) {
  const lx = {
    season: labels.season || { tur:"Sezon", eng:"Season", fre:"Saison", deu:"Staffel", rus:"Сезон" }[locale] || "Season",
    episode: labels.episode || { tur:"Bölüm", eng:"Episode", fre:"Épisode", deu:"Folge",  rus:"Серия" }[locale] || "Episode",
  };

  const patterns = {
    tur: "{series} - {seasonNum}. {season} {episodeNum}. {episode}{titlePart}",
    eng: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
    fre: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
    deu: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
    rus: "{series} — {seasonNum} {season}, {episodeNum} {episode}{titlePart}",
    default: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
  };
  const pat = patterns[locale] || patterns.default;

  const genericTitleTemplates = {
    tur: "{episodeNum}. {episode}",
    eng: "{episode} {episodeNum}",
    fre: "{episode} {episodeNum}",
    deu: "{episode} {episodeNum}",
    rus: "{episode} {episodeNum}",
    default: "{episode} {episodeNum}",
  };
  const genTitlePat = genericTitleTemplates[locale] || genericTitleTemplates.default;

  const normalizedTitle = String(episodeTitle || "").trim().toLowerCase();
  const localizedGenericTitle = genTitlePat
    .replace("{episode}", lx.episode)
    .replace("{episodeNum}", String(episodeNum))
    .trim()
    .toLowerCase();

  const titlePart = normalizedTitle && normalizedTitle !== localizedGenericTitle
    ? `: ${episodeTitle.trim()}`
    : "";

  return pat
    .replace("{series}", seriesName)
    .replace("{season}", lx.season)
    .replace("{episode}", lx.episode)
    .replace("{seasonNum}", String(seasonNum))
    .replace("{episodeNum}", String(episodeNum))
    .replace("{titlePart}", titlePart);
}

(() => {
  const TEST_ID  = 'jfNotifTestPanel';
  const TEST_IMG = './slider/src/images/primary.webp';
  const S = {
    enabled: false,
    lockToasts: true,
    lockModal:  true,
    forceImages: true,
    bypassDedup: true,
    autoOpenModal: false
  };

  (function patchImageSrcSetterOnce(){
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!desc || !desc.set || HTMLImageElement.prototype.__jfNotifSrcPatched) return;
    const origSet = desc.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(v) {
        try {
          const inNotif = this.classList?.contains('thumb') || this.classList?.contains('poster') ||
                          this.closest?.('#jfNotifModal') || this.closest?.('#jfToastContainer');
          if (S.enabled && S.forceImages && inNotif) {
            if (typeof v === 'string' && (v.includes('/Items/') || v.includes('fake-') || v === '' )) {
              return origSet.call(this, TEST_IMG);
            }
          }
        } catch {}
        return origSet.call(this, v);
      }
    });
    HTMLImageElement.prototype.__jfNotifSrcPatched = true;
  })();

  let imgObserver, toastObserver, modalObserver, closeClickBound = false;

  function bindImgObserver() {
    if (imgObserver) return;
    imgObserver = new MutationObserver((muts) => {
      if (!S.enabled || !S.forceImages) return;
      for (const m of muts) {
        m.addedNodes?.forEach(node => {
          if (!(node instanceof Element)) return;
          const imgs = node.matches?.('img') ? [node] : Array.from(node.querySelectorAll?.('img') || []);
          imgs.forEach(img => {
            const inNotif = img.classList?.contains('thumb') || img.classList?.contains('poster') ||
                            img.closest?.('#jfNotifModal') || img.closest?.('#jfToastContainer');
            if (!inNotif) return;
            const cur = img.getAttribute('src') || '';
            if (cur.includes('/Items/') || cur.includes('fake-') || !cur) {
              img.setAttribute('src', TEST_IMG);
            }
          });
        });
      }
    });
    imgObserver.observe(document.documentElement, { childList:true, subtree:true });
  }

  function bindToastObserver() {
    if (toastObserver) return;
    const host = () => document.querySelector('#jfToastContainer');
    const resurrect = (toast) => {
      if (!S.enabled || !S.lockToasts) return;
      const h = host(); if (!h || h.contains(toast)) return;
      try {
        h.appendChild(toast);
        toast.classList.add('show','jf-test-sticky');
        const img = toast.querySelector('img.thumb, img.poster');
        if (img && S.forceImages) img.src = TEST_IMG;
      } catch {}
    };
    toastObserver = new MutationObserver((muts) => {
      if (!S.enabled || !S.lockToasts) return;
      for (const m of muts) {
        m.removedNodes?.forEach(n => {
          if (n instanceof Element && n.classList?.contains('jf-toast')) {
            requestAnimationFrame(() => resurrect(n));
          }
        });
        m.addedNodes?.forEach(n => {
          if (n instanceof Element && n.classList?.contains('jf-toast')) {
            n.classList.add('show','jf-test-sticky');
            const img = n.querySelector('img.thumb, img.poster');
            if (img && S.forceImages) img.src = TEST_IMG;
          }
        });
      }
    });
    const tryBind = () => {
      const h = host();
      if (h) toastObserver.observe(h, { childList:true });
      else setTimeout(tryBind, 300);
    };
    tryBind();
  }

  function bindModalGuards() {
    if (!closeClickBound) {
      document.addEventListener('click', (e) => {
        if (!S.enabled || !S.lockModal) return;
        const t = e.target;
        if (t?.matches?.('[data-close]') || t?.closest?.('[data-close]')) {
          e.stopImmediatePropagation();
          e.preventDefault();
          openModalHard();
        }
      }, true);
      closeClickBound = true;
    }
    if (modalObserver) return;
    modalObserver = new MutationObserver(() => { if (S.enabled && S.lockModal) keepModalOpen(); });
    const tryBind = () => {
      const m = document.querySelector('#jfNotifModal');
      if (m) {
        modalObserver.observe(m, { attributes:true, attributeFilter:['class','hidden','aria-hidden','style'] });
        keepModalOpen();
      } else {
        setTimeout(tryBind, 300);
      }
    };
    tryBind();
  }

  function keepModalOpen() {
    if (!S.enabled || !S.lockModal) return;
    const m = document.querySelector('#jfNotifModal');
    if (!m) return;
    if (!m.classList.contains('open') || m.hidden || m.getAttribute('aria-hidden') === 'true') {
      m.hidden = false;
      m.classList.add('open');
      m.style.pointerEvents = '';
      m.setAttribute('aria-hidden','false');
      try { notifState.isModalOpen = true; } catch {}
    }
  }
  function openModalHard() {
    const m = document.querySelector('#jfNotifModal');
    if (!m) return;
    m.hidden = false;
    m.classList.add('open');
    m.style.pointerEvents = '';
    m.setAttribute('aria-hidden','false');
    try { notifState.isModalOpen = true; } catch {}
  }

  let dedupTimer = null;
  function startDedupRelax() {
    if (dedupTimer) return;
    dedupTimer = setInterval(() => {
      if (!S.enabled || !S.bypassDedup) return;
      try { recentToastMap?.clear?.(); } catch {}
    }, 2000);
  }
  function stopDedupRelax() {
    if (dedupTimer) { clearInterval(dedupTimer); dedupTimer = null; }
  }

  const nowTs = () => Date.now();
  const rand = a => a[Math.floor(Math.random()*a.length)];
  function fakeMovie(i=1){ return {
    Id:`fake-movie-${i}-${Math.random().toString(36).slice(2)}`,
    Name: rand(["Dune","Arrival","Interstellar","Inception","BR 2049"])+" (Test)",
    Type:"Movie", HasPrimaryImage:true, ImageTags:{Primary:"x"},
    DateCreated:new Date(nowTs()-i*1000).toISOString()
  }; }
  function fakeEpisode(i=1){ return {
    Id:`fake-ep-${i}-${Math.random().toString(36).slice(2)}`,
    Name:`Bölüm ${i}`, Type:"Episode",
    SeriesName: rand(["Dark","Foundation","Severance","The Expanse"])+" (Test)",
    ParentIndexNumber:1, IndexNumber:i, SeriesId:`fake-series-${i}`,
    HasPrimaryImage:true, Series:{ Id:`fake-series-${i}`, ImageTags:{Primary:"x"} },
    DateCreated:new Date(nowTs()-i*1200).toISOString()
  }; }
  function fakeActivity(i=1){ return {
    Id:`fake-act-${i}-${Math.random().toString(36).slice(2)}`,
    Type: rand(["PlaybackStart","LibraryScan","Transcode","UserLogin"]),
    Name: rand(["Sistem Olayı","Aktivite","Bildirim"]),
    Overview: rand(["Pijamalı Hasta Yağız Şoföre Çabucak Güvendi.","Tamamlandı","Uyarı: yüksek CPU","Planlı tarama"]),
    Date:new Date(nowTs()-i*2300).toISOString()
  }; }

  function addToast(it, status="added") {
    if (!S.enabled) return;
    try { notifState.toastQueue.push({ type:"content", it, status }); } catch {}
    try { pushNotification({ itemId: it.Id, title: it.Name, timestamp: nowTs(), status }); } catch {}
    try { runToastQueue(); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addGroup() {
    if (!S.enabled) return;
    const arr = [fakeMovie(1), fakeMovie(2), fakeEpisode(3), fakeEpisode(4), fakeMovie(5)];
    try { enqueueToastGroup(arr, { type:"content" }); } catch {}
    arr.slice(0,3).forEach(it => { try { pushNotification({ itemId: it.Id, title: it.Name, timestamp: nowTs(), status:"added" }); } catch {} });
    try { runToastQueue(); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addSystem() {
    if (!S.enabled) return;
    const a = fakeActivity();
    try { notifState._systemAllowed = true; } catch {}
    try {
      notifState.activities = [a, ...(notifState.activities||[])].slice(0,30);
      renderActivities(notifState.activities); updateBadge();
      notifState.toastQueue.push({ type:"activity", it:a });
      runToastQueue();
    } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addUpdate() {
    if (!S.enabled) return;
    const v = `v${(Math.random()*3+1).toFixed(1)}.${Math.floor(Math.random()*10)}`;
    try { window.jfNotifyUpdateAvailable({ latest:v, url:"https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases", remindMs:0 }); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function clearToasts() {
    document.querySelectorAll('#jfToastContainer .jf-toast').forEach(n => n.remove());
    try { notifState.toastShowing = false; notifState.toastQueue = []; } catch {}
  }

  function ensurePanel() {
    if (document.getElementById(TEST_ID)) return;
    const box = document.createElement('div');
    box.id = TEST_ID;
    box.innerHTML = `
      <div class="head">Notifications Test</div>
      <div class="row toggles">
        <label><input type="checkbox" id="tLockToasts"> Sticky toasts</label>
        <label><input type="checkbox" id="tLockModal"> Modal lock</label>
        <label><input type="checkbox" id="tForceImg"> Force images</label>
        <label><input type="checkbox" id="tAutoOpen"> Auto-open modal</label>
      </div>
      <div class="row">
        <button data-act="added">+ Added</button>
        <button data-act="removed">– Removed</button>
        <button data-act="group">Group</button>
        <button data-act="system">System</button>
        <button data-act="update">Update</button>
      </div>
      <div class="row">
        <button data-act="open">Open Modal</button>
        <button data-act="clear">Clear Toasts</button>
        <button data-act="close">Close Panel</button>
      </div>`;
    Object.assign(box.style, {
      position:'fixed', top:'80px', right:'16px', zIndex: 999999,
      width:'288px', font:'12px/1.4 system-ui, Segoe UI, Roboto, Ubuntu',
      background:'rgba(20,20,24,0.96)', color:'#eee',
      border:'1px solid rgba(255,255,255,0.12)', borderRadius:'12px',
      boxShadow:'0 8px 28px rgba(0,0,0,0.35)', padding:'10px', backdropFilter:'blur(6px)'
    });
    const cssRow = 'display:flex; gap:6px; flex-wrap:wrap; margin:6px 0;';
    [...box.querySelectorAll('.row')].forEach(r => r.style = cssRow);
    Object.assign(box.querySelector('.head').style, {fontWeight:'700', margin:'2px 0 6px'});

    box.querySelector('#tLockToasts').checked = S.lockToasts;
    box.querySelector('#tLockModal').checked  = S.lockModal;
    box.querySelector('#tForceImg').checked   = S.forceImages;
    box.querySelector('#tAutoOpen').checked   = S.autoOpenModal;

    box.addEventListener('change', (e) => {
      if (e.target.id === 'tLockToasts') S.lockToasts = e.target.checked;
      if (e.target.id === 'tLockModal')  S.lockModal  = e.target.checked;
      if (e.target.id === 'tForceImg')   S.forceImages = e.target.checked;
      if (e.target.id === 'tAutoOpen')   S.autoOpenModal = e.target.checked;
    });

    box.addEventListener('click', (e) => {
      const act = e.target?.getAttribute?.('data-act'); if (!act) return;
      if (act==='added')   addToast(Math.random()<0.5?fakeMovie():fakeEpisode(), 'added');
      if (act==='removed') addToast(Math.random()<0.5?fakeMovie():fakeEpisode(), 'removed');
      if (act==='group')   addGroup();
      if (act==='system')  addSystem();
      if (act==='update')  addUpdate();
      if (act==='open')    openModalHard();
      if (act==='clear')   clearToasts();
      if (act==='close')   box.remove();
    });

    document.body.appendChild(box);
  }

  window.jfNotifTest = {
    enable(opts={}) {
      S.enabled = true;
      if (typeof opts.sticky === 'boolean') S.lockToasts = opts.sticky;
      if (typeof opts.autoOpenModal === 'boolean') S.autoOpenModal = opts.autoOpenModal;
      if (typeof opts.lockModal === 'boolean') S.lockModal = opts.lockModal;
      if (typeof opts.forceImages === 'boolean') S.forceImages = opts.forceImages;
      if (typeof opts.bypassDedup === 'boolean') S.bypassDedup = opts.bypassDedup;
      if (opts.panel) ensurePanel();
      bindImgObserver(); bindToastObserver(); bindModalGuards(); startDedupRelax();
      console.log('[notif:test] enabled', { ...S });
      return this;
    },
    disable() {
      S.enabled = false;
      stopDedupRelax();
      console.log('[notif:test] disabled');
      return this;
    },
    openPanel(){ ensurePanel(); return this; },
    added(){ addToast(Math.random()<0.5?fakeMovie():fakeEpisode(),'added'); return this; },
    removed(){ addToast(Math.random()<0.5?fakeMovie():fakeEpisode(),'removed'); return this; },
    group(){ addGroup(); return this; },
    system(){ addSystem(); return this; },
    update(){ addUpdate(); return this; },
    openModal(){ openModalHard(); return this; },
    clear(){ clearToasts(); return this; },
    setAutoOpen(v=true){ S.autoOpenModal = !!v; return this; },
    setLockToasts(v=true){ S.lockToasts = !!v; return this; },
    setLockModal(v=true){ S.lockModal = !!v; return this; },
    setForceImages(v=true){ S.forceImages = !!v; return this; }
  };

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key?.toLowerCase?.() === 'n')) {
      const p = document.getElementById(TEST_ID);
      p ? p.remove() : ensurePanel();
    }
  });

  console.log('%c[notif:test] hazir — jfNotifTest.enable({panel:true}) ile aç',
    'color:#6cf;font-weight:bold;');
})();
