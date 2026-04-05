import { getConfig } from "../../config.js";
import { showNotification } from "./notification.js";
import { playTrack } from "../player/playback.js";
import { musicPlayerState } from "../core/state.js";
import {
  activateRadioPlaylist,
  canRemoveSharedRadioStation,
  findStationByUrl,
  getAutoDiscoveredStations,
  getRadioPersistenceInfo,
  getRadioStationSubtitle,
  normalizeRadioStation,
  removeSharedRadioStation,
  resolveRadioStationArtUrl,
  saveSharedRadioStation,
  searchAllRadioStations,
  searchRadioStationsDetailed,
  stationKey,
  submitStationToDirectory
} from "../core/radio.js";

const DEFAULT_RADIO_ART_CSS = "url('./slider/src/images/defaultArt.png')";
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_CACHE_LIMIT = 24;
const SEARCH_PAGE_SIZE = 50;
const SEARCH_SCROLL_THRESHOLD = 280;

const modalState = {
  root: null,
  results: null,
  status: null,
  searchInput: null,
  searchBtn: null,
  discoverBtn: null,
  addBtn: null,
  addForm: null,
  hint: null,
  requestId: 0,
  view: "discover",
  sharedStations: [],
  nearbyStations: [],
  popularStations: [],
  searchResults: [],
  countryCode: "TR",
  searchDebounceId: 0,
  lastSearchKey: "",
  isSearchComposing: false,
  searchLimit: SEARCH_PAGE_SIZE,
  searchHasMore: false,
  searchLoadingMore: false,
  searchPlaybackLoading: false,
  searchCache: new Map()
};

function labels() {
  return getConfig()?.languageLabels || {};
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function normalizeSearchKey(value) {
  return text(value).toLocaleLowerCase();
}

function clearSearchDebounce() {
  if (!modalState.searchDebounceId) return;
  window.clearTimeout(modalState.searchDebounceId);
  modalState.searchDebounceId = 0;
}

function readCachedSearchResults(searchKey) {
  if (!searchKey || !modalState.searchCache.has(searchKey)) return null;
  const cached = modalState.searchCache.get(searchKey);
  modalState.searchCache.delete(searchKey);
  modalState.searchCache.set(searchKey, cached);
  if (Array.isArray(cached)) {
    return {
      limit: cached.length,
      results: cached
    };
  }
  if (!cached || !Array.isArray(cached.results)) return null;
  return {
    limit: Math.max(Number(cached.limit) || 0, cached.results.length),
    results: cached.results,
    hasMore: cached.hasMore !== false
  };
}

function storeCachedSearchResults(searchKey, limit, results, hasMore = false) {
  if (!searchKey) return;
  const cachedResults = Array.isArray(results) ? results : [];
  if (modalState.searchCache.has(searchKey)) {
    modalState.searchCache.delete(searchKey);
  }
  modalState.searchCache.set(searchKey, {
    limit: Math.max(Number(limit) || 0, cachedResults.length),
    results: cachedResults,
    hasMore: hasMore === true
  });

  while (modalState.searchCache.size > SEARCH_CACHE_LIMIT) {
    const oldestKey = modalState.searchCache.keys().next().value;
    modalState.searchCache.delete(oldestKey);
  }
}

function normalizeSearchLimit(value) {
  return Math.max(SEARCH_PAGE_SIZE, Math.floor(Number(value) || SEARCH_PAGE_SIZE));
}

function scheduleSearch() {
  clearSearchDebounce();
  if (modalState.isSearchComposing) return;

  modalState.searchDebounceId = window.setTimeout(() => {
    modalState.searchDebounceId = 0;
    runSearch();
  }, SEARCH_DEBOUNCE_MS);
}

function ensureStyles() {
  if (document.getElementById("gmmp-radio-modal-styles")) return;

  const style = document.createElement("style");
  style.id = "gmmp-radio-modal-styles";
  style.textContent = `
    #gmmp-radio-modal-styles {
      display: none;
    }

    .gmmp-radio-modal {
      --gmmp-radio-radius-sm: 8px;
      --gmmp-radio-radius-md: 12px;
      --gmmp-radio-radius-lg: 20px;
      --gmmp-radio-radius-xl: 24px;
      --gmmp-radio-surface-0: var(--gmmp-bg-primary, var(--background-color, linear-gradient(180deg, #151924, #0a0c12)));
      --gmmp-radio-surface-1: var(--gmmp-bg-secondary, var(--modal-bg, rgba(20, 28, 40, 0.85)));
      --gmmp-radio-surface-2: var(--gmmp-bg-surface, rgba(30, 38, 50, 0.6));
      --gmmp-radio-surface-3: var(--gmmp-bg-surface-hover, rgba(40, 48, 62, 0.8));
      --gmmp-radio-surface-elevated: var(--gmmp-bg-elevated, rgba(35, 45, 60, 0.9));
      --gmmp-radio-border: var(--gmmp-border-light, rgba(255, 255, 255, 0.08));
      --gmmp-radio-border-medium: var(--gmmp-border-medium, rgba(255, 255, 255, 0.12));
      --gmmp-radio-border-strong: var(--gmmp-accent-primary-soft, var(--gmmp-border-strong, rgba(255, 255, 255, 0.2)));
      --gmmp-radio-text-primary: var(--gmmp-text-primary, var(--ptext-color, #ffffff));
      --gmmp-radio-text-secondary: var(--gmmp-text-secondary, var(--lighter-text, rgba(255, 255, 255, 0.85)));
      --gmmp-radio-text-muted: var(--gmmp-text-tertiary, var(--light-text, rgba(255, 255, 255, 0.6)));
      --gmmp-radio-text-subtle: var(--gmmp-text-muted, rgba(255, 255, 255, 0.45));
      --gmmp-radio-accent: var(--gmmp-accent-primary, var(--primary-color, #10b981));
      --gmmp-radio-accent-strong: var(--gmmp-accent-primary-dark, var(--secondary-color, #059669));
      --gmmp-radio-accent-soft: var(--gmmp-accent-primary-soft, rgba(16, 185, 129, 0.15));
      --gmmp-radio-danger-bg: var(--gmmp-accent-danger-soft, rgba(239, 68, 68, 0.15));
      --gmmp-radio-danger-text: var(--gmmp-accent-danger, #ef4444);
      --gmmp-radio-shadow-sm: var(--gmmp-shadow-sm, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
      --gmmp-radio-shadow-md: var(--gmmp-shadow-md, 0 10px 25px -5px rgba(0, 0, 0, 0.15));
      --gmmp-radio-shadow-lg: var(--gmmp-shadow-lg, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
      --gmmp-radio-shadow-glow: var(--gmmp-shadow-glow, 0 0 0 2px var(--gmmp-radio-accent-soft));
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      place-items: center;
      padding: 18px;
      color: var(--gmmp-radio-text-primary);
      font-family: inherit;
    }

    .gmmp-radio-modal.visible {
      display: grid;
    }

    .gmmp-radio-modal,
    .gmmp-radio-modal * {
      box-sizing: border-box;
    }

    .gmmp-radio-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at top left, var(--gmmp-radio-accent-soft), transparent 28%),
        linear-gradient(180deg, rgba(15, 23, 42, 0.28), rgba(15, 23, 42, 0.44));
      backdrop-filter: var(--gmmp-blur, blur(14px));
    }

    .gmmp-radio-dialog {
      position: relative;
      z-index: 1;
      width: min(1180px, calc(100vw - 36px));
      max-height: min(92vh, 900px);
      display: flex;
      flex-direction: column;
      gap: 18px;
      overflow: hidden;
      border-radius: var(--gmmp-radio-radius-xl);
      border: 1px solid var(--gmmp-radio-border);
      background: var(--gmmp-radio-surface-0);
      color: var(--gmmp-radio-text-primary);
      box-shadow: var(--gmmp-radio-shadow-lg);
    }

    .gmmp-radio-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 24px 24px 14px;
      border-bottom: 1px solid var(--gmmp-radio-border);
      background: linear-gradient(180deg, var(--gmmp-radio-surface-2), transparent);
    }

    .gmmp-radio-title {
      margin: 0 0 6px;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--gmmp-radio-text-primary);
    }

    .gmmp-radio-status {
      margin: 0;
      max-width: 720px;
      color: var(--gmmp-radio-text-muted);
      font-size: 13px;
      line-height: 1.56;
    }

    .gmmp-radio-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .gmmp-radio-btn,
    .gmmp-radio-iconbtn,
    .gmmp-radio-cardbtn,
    .gmmp-radio-linkbtn {
      appearance: none;
      border: 1px solid transparent;
      cursor: pointer;
      color: var(--gmmp-radio-text-secondary);
      font: inherit;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      transition: transform .18s ease, background-color .18s ease, box-shadow .18s ease, opacity .18s ease;
    }

    .gmmp-radio-btn:disabled,
    .gmmp-radio-iconbtn:disabled,
    .gmmp-radio-cardbtn:disabled,
    .gmmp-radio-linkbtn:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .gmmp-radio-btn,
    .gmmp-radio-cardbtn,
    .gmmp-radio-linkbtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 10px 12px;
      border-radius: var(--gmmp-radio-radius-sm);
      background: var(--gmmp-radio-surface-2);
      border-color: var(--gmmp-radio-border);
    }

    .gmmp-radio-btn.primary,
    .gmmp-radio-cardbtn.primary {
      background: linear-gradient(135deg, var(--gmmp-radio-accent), var(--gmmp-radio-accent-strong));
      border-color: transparent;
      color: #fff;
    }

    .gmmp-radio-btn.secondary,
    .gmmp-radio-cardbtn.secondary,
    .gmmp-radio-linkbtn {
      background: var(--gmmp-radio-surface-2);
      color: var(--gmmp-radio-text-secondary);
    }

    .gmmp-radio-cardbtn.danger {
      background: var(--gmmp-radio-danger-bg);
      color: var(--gmmp-radio-danger-text);
      border-color: transparent;
    }

    .gmmp-radio-linkbtn:disabled {
      opacity: 1;
      cursor: default;
      background: var(--gmmp-radio-accent-soft);
      border-color: transparent;
      color: var(--gmmp-radio-accent);
    }

    .gmmp-radio-btn:hover:not(:disabled),
    .gmmp-radio-iconbtn:hover:not(:disabled),
    .gmmp-radio-cardbtn:hover:not(:disabled),
    .gmmp-radio-linkbtn:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    .gmmp-radio-btn:focus-visible,
    .gmmp-radio-iconbtn:focus-visible,
    .gmmp-radio-cardbtn:focus-visible,
    .gmmp-radio-linkbtn:focus-visible,
    .gmmp-radio-input:focus-visible {
      outline: 2px solid var(--gmmp-radio-accent);
      outline-offset: 2px;
    }

    .gmmp-radio-iconbtn {
      width: 44px;
      height: 44px;
      border-radius: var(--gmmp-radio-radius-sm);
      background: var(--gmmp-radio-surface-2);
      border-color: var(--gmmp-radio-border);
      color: var(--gmmp-radio-text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .gmmp-radio-iconbtn i {
      padding: 0 !important;
      font-size: 18px;
    }

    .gmmp-radio-searchrow {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin: 0 24px;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid var(--gmmp-radio-border);
      background: var(--gmmp-radio-surface-2);
      box-shadow: inset 0 1px 0 var(--gmmp-radio-border);
    }

    .gmmp-radio-searchrow .gmmp-radio-input {
      flex: 1 1 260px;
      min-width: 220px;
    }

    .gmmp-radio-searchrow button {
      flex-shrink: 0;
    }

    .gmmp-radio-addform {
      display: grid;
      gap: 12px;
      align-items: end;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr) 160px;
      max-width: 100%;
      margin: 0 24px;
      padding: 6px;
    }

    .gmmp-radio-input {
      width: 100%;
      border: 1px solid var(--gmmp-radio-border-medium);
      border-radius: var(--gmmp-radio-radius-md);
      background: var(--gmmp-radio-surface-elevated);
      color: var(--gmmp-radio-text-primary);
      outline: none;
      font: inherit;
      font-size: 13px;
      transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease;
      align-items: center;
      min-height: 38px;
      padding: 10px 12px;
    }

    .gmmp-radio-input::placeholder {
      color: var(--gmmp-radio-text-subtle);
    }

    .gmmp-radio-input:focus {
      border-color: var(--gmmp-radio-accent);
      box-shadow: var(--gmmp-radio-shadow-glow);
      background: var(--gmmp-radio-surface-3);
    }

    .gmmp-radio-hint {
      margin: -6px 24px 0;
      color: var(--gmmp-radio-text-muted);
      font-size: 13px;
      line-height: 1.56;
    }

    .gmmp-radio-results {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 0 24px 24px;
      scrollbar-color: var(--gmmp-radio-accent) transparent;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }

    .gmmp-radio-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .gmmp-radio-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 0 4px;
    }

    .gmmp-radio-section-title {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--gmmp-radio-text-primary);
      min-width: 0;
    }

    .gmmp-radio-section-note {
      color: var(--gmmp-radio-text-subtle);
      font-size: 12px;
      line-height: 1.5;
      text-align: right;
    }

    .gmmp-radio-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }

    .gmmp-radio-card {
      display: grid;
      grid-template-columns: 110px minmax(0, 1fr);
      min-height: 206px;
      border-radius: var(--gmmp-radio-radius-lg);
      overflow: hidden;
      border: 1px solid var(--gmmp-radio-border);
      background: var(--gmmp-radio-surface-2);
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    }

    .gmmp-radio-card:hover,
    .gmmp-radio-card:focus-within {
      transform: translateY(-2px);
      border-color: var(--gmmp-radio-border-strong);
      box-shadow: var(--gmmp-radio-shadow-md);
    }

    .gmmp-radio-art {
      position: relative;
      min-height: 100%;
      background-color: var(--gmmp-radio-surface-1);
      background-size: cover;
      background-position: center;
      overflow: hidden;
    }

    .gmmp-radio-art::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.32)),
        linear-gradient(160deg, var(--gmmp-radio-accent-soft), transparent 72%);
      pointer-events: none;
    }

    .gmmp-radio-card-body {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 14px 12px;
    }

    .gmmp-radio-name {
      margin: 0;
      font-size: 17px;
      font-weight: 800;
      line-height: 1.22;
      letter-spacing: -0.02em;
      color: var(--gmmp-radio-text-primary);
      word-break: break-word;
    }

    .gmmp-radio-meta,
    .gmmp-radio-tags,
    .gmmp-radio-contributor {
      color: var(--gmmp-radio-text-muted);
      font-size: 12px;
      line-height: 1.5;
      word-break: break-word;
    }

    .gmmp-radio-contributor {
      color: var(--gmmp-radio-accent);
      font-weight: 700;
    }

    .gmmp-radio-card-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: auto;
    }

    .gmmp-radio-card-actions button {
      min-height: 36px;
      padding: 9px 12px;
      font-size: 12px;
    }

    .gmmp-radio-section-actions {
      display: flex;
      justify-content: center;
      padding-top: 4px;
    }

    .gmmp-radio-section-actions button {
      min-width: 180px;
    }

    .gmmp-radio-empty,
    .gmmp-radio-loading {
      padding: 24px;
      border: 1px dashed var(--gmmp-radio-border-medium);
      border-radius: 18px;
      background: var(--gmmp-radio-surface-2);
      text-align: center;
      color: var(--gmmp-radio-text-muted);
      font-size: 14px;
      line-height: 1.6;
    }

    @media (max-width: 920px) {
      .gmmp-radio-dialog {
        width: min(100vw, calc(100vw - 20px));
        max-height: 94vh;
      }

      .gmmp-radio-header {
        align-items: flex-start;
      }

      .gmmp-radio-actions {
        justify-content: space-between;
      }

      .gmmp-radio-addform {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .gmmp-radio-addform .gmmp-radio-input, .gmmp-radio-addform button {
        grid-column: span 2;
      }
    }

    @media (max-width: 760px) {
      .gmmp-radio-modal {
        padding: 0;
      }

      .gmmp-radio-dialog {
        width: 100%;
        max-height: 100vh;
        height: 100vh;
        border-radius: 0;
      }

      .gmmp-radio-header {
        padding: 18px 16px 12px;
      }

      .gmmp-radio-searchrow,
      .gmmp-radio-addform {
        margin: 0 16px;
      }

      .gmmp-radio-hint,
      .gmmp-radio-results {
        margin-left: 16px;
        margin-right: 16px;
      }

      .gmmp-radio-results {
        padding-left: 0;
        padding-right: 0;
        padding-bottom: 20px;
      }

      .gmmp-radio-card {
        grid-template-columns: 92px minmax(0, 1fr);
        min-height: 184px;
      }
    }

    @media (max-width: 520px) {
      .gmmp-radio-title {
        font-size: 22px;
      }

      .gmmp-radio-actions .gmmp-radio-btn {
        flex: 1 1 180px;
      }

      .gmmp-radio-searchrow .gmmp-radio-input {
        min-width: 100%;
      }

      .gmmp-radio-card {
        grid-template-columns: 1fr;
      }

      .gmmp-radio-art {
        min-height: 140px;
      }

      .gmmp-radio-section-head {
        flex-direction: column;
        align-items: flex-start;
      }

      .gmmp-radio-section-note {
        text-align: left;
      }
    }
  `;

  document.head.appendChild(style);
}

function setStatus(message = "") {
  if (!modalState.status) return;
  modalState.status.textContent = message;
}

function updateHintText() {
  if (!modalState.hint) return;
  const labelsMap = labels();
  const info = getRadioPersistenceInfo();

  if (info.mode === "jmsfusion") {
    modalState.hint.textContent = labelsMap.radioSharedHint || "Kaydedilen istasyonlar herkes tarafindan kullanilabilir";
    return;
  }

  modalState.hint.textContent =
    labelsMap.radioManualModeHint ||
    "Manuel kurulum modu: eklenen istasyonlar bu tarayicida saklanir. Ortak liste icin radio-stations.json dosyasi kullanilir.";
}

function sameStation(a, b) {
  if (!a || !b) return false;
  return stationKey(a) !== "" && stationKey(a) === stationKey(b);
}

function isSharedStation(station) {
  return modalState.sharedStations.some((item) => sameStation(item, station));
}

function openStationHomepage(station) {
  if (!station?.homepage) return;
  window.open(station.homepage, "_blank", "noopener,noreferrer");
}

function playStationGroup(stations, index) {
  const playableIndex = activateRadioPlaylist(stations, index);
  if (playableIndex < 0) return;
  playTrack(playableIndex);
}

function maybeLoadMoreSearchResults() {
  if (!modalState.results || modalState.view !== "search" || !modalState.searchHasMore || modalState.searchLoadingMore) {
    return;
  }

  const remaining = modalState.results.scrollHeight - modalState.results.scrollTop - modalState.results.clientHeight;
  if (remaining <= SEARCH_SCROLL_THRESHOLD) {
    loadMoreSearchResults();
  }
}

async function shareStation(station) {
  const labelsMap = labels();
  setStatus(labelsMap.radioAdding || "Istasyon kaydediliyor...");

  try {
    const merged = await saveSharedRadioStation(station);
    const info = getRadioPersistenceInfo();
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    updateHintText();
    setStatus(labelsMap.radioReady || "Hazir");
    showNotification(
      `<i class="fas fa-check-circle"></i> ${info.supportsServerWrite ? (labelsMap.radioSharedSaved || "Istasyon paylasilan listeye eklendi") : (labelsMap.radioLocalSaved || "Istasyon bu tarayiciya kaydedildi")}`,
      2200,
      "success"
    );
    renderResults();
    submitStationToDirectory(station).catch(() => {});
  } catch (error) {
    console.error("[radio] Paylasilan kayit hatasi:", error);
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${labelsMap.radioSharedSaveError || "Istasyon paylasilan listeye eklenemedi"}`,
      3000,
      "error"
    );
    setStatus(labelsMap.radioSharedSaveError || "Istasyon paylasilan listeye eklenemedi");
  }
}

async function unshareStation(station) {
  const labelsMap = labels();
  setStatus(labelsMap.radioRemoving || "Istasyon kaldiriliyor...");

  try {
    const merged = await removeSharedRadioStation(station);
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    updateHintText();
    setStatus(labelsMap.radioReady || "Hazir");
    showNotification(
      `<i class="fas fa-check-circle"></i> ${labelsMap.radioRemoved || "Istasyon paylasilan listeden kaldirildi"}`,
      2200,
      "success"
    );
    renderResults();
  } catch (error) {
    console.error("[radio] silme hatasi:", error);
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${labelsMap.radioRemoveError || "Istasyon kaldirilamadi"}`,
      3000,
      "error"
    );
    setStatus(labelsMap.radioRemoveError || "Istasyon kaldirilamadi");
  }
}

function createCardButton(className, labelText, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `gmmp-radio-cardbtn ${className}`.trim();
  btn.textContent = labelText;
  btn.addEventListener("click", (event) => onClick?.(event, btn));
  return btn;
}

function setDefaultStationArt(art) {
  if (!art) return;
  art.style.backgroundImage = DEFAULT_RADIO_ART_CSS;
}

function applyStationArt(art, imageUrl) {
  if (!art || !imageUrl) return;
  art.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
}

async function loadStationArt(art, station) {
  if (!art) return;
  setDefaultStationArt(art);

  const requestId = String((Number(art.dataset.artRequestId) || 0) + 1);
  art.dataset.artRequestId = requestId;

  try {
    const imageUrl = await resolveRadioStationArtUrl(station);
    if (art.dataset.artRequestId !== requestId || !imageUrl) return;
    applyStationArt(art, imageUrl);
  } catch {
  }
}

function getStationContributorText(station) {
  const addedBy = text(station?.addedBy || station?.AddedBy);
  if (!addedBy) return "";
  return `${labels().radioAddedBy || "Ekleyen"}: ${addedBy}`;
}

function renderStationCard(station, stations, index, { shared = false, onPlay = null } = {}) {
  const labelsMap = labels();
  const card = document.createElement("article");
  card.className = "gmmp-radio-card";

  const art = document.createElement("div");
  art.className = "gmmp-radio-art";
  setDefaultStationArt(art);
  loadStationArt(art, station);

  const body = document.createElement("div");
  body.className = "gmmp-radio-card-body";

  const name = document.createElement("div");
  name.className = "gmmp-radio-name";
  name.textContent = station.name;

  const meta = document.createElement("div");
  meta.className = "gmmp-radio-meta";
  meta.textContent = getRadioStationSubtitle(station);

  const contributorText = getStationContributorText(station);
  const contributor = document.createElement("div");
  contributor.className = "gmmp-radio-contributor";
  contributor.textContent = contributorText;
  if (!contributorText) contributor.hidden = true;

  const tags = document.createElement("div");
  tags.className = "gmmp-radio-tags";
  tags.textContent = [
    station.tags,
    station.clickcount > 0 ? `${labelsMap.radioClicks || "Tik"}: ${station.clickcount}` : "",
    station.votes > 0 ? `${labelsMap.radioVotes || "Oy"}: ${station.votes}` : ""
  ].filter(Boolean).join(" • ");

  const actions = document.createElement("div");
  actions.className = "gmmp-radio-card-actions";
  actions.appendChild(createCardButton("primary", labelsMap.radioListen || "Dinle", async (_event, btn) => {
    btn.disabled = true;
    try {
      if (typeof onPlay === "function") {
        await onPlay(station, stations, index);
      } else {
        playStationGroup(stations, index);
      }
    } finally {
      btn.disabled = false;
    }
  }));

  if (shared) {
    const sharedBtn = document.createElement("button");
    sharedBtn.type = "button";
    sharedBtn.className = "gmmp-radio-linkbtn";
    sharedBtn.textContent = labelsMap.radioSharedLabel || "Paylasilan";
    sharedBtn.disabled = true;
    actions.appendChild(sharedBtn);

    if (canRemoveSharedRadioStation(station)) {
      actions.appendChild(createCardButton("danger", labelsMap.radioRemove || "Kaldir", async (_event, btn) => {
        btn.disabled = true;
        try {
          await unshareStation(station);
        } finally {
          btn.disabled = false;
        }
      }));
    }
  } else {
    const actionLabel = isSharedStation(station)
      ? labelsMap.radioSharedLabel || "Paylasilan"
      : labelsMap.radioShare || "Paylas";
    const shareBtn = createCardButton("secondary", actionLabel, async (_event, btn) => {
      if (isSharedStation(station)) return;
      btn.disabled = true;
      try {
        await shareStation(station);
      } finally {
        btn.disabled = isSharedStation(station);
      }
    });
    if (isSharedStation(station)) shareBtn.disabled = true;
    actions.appendChild(shareBtn);
  }

  if (station.homepage) {
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "gmmp-radio-linkbtn";
    linkBtn.textContent = labelsMap.radioHomepage || "Site";
    linkBtn.addEventListener("click", () => openStationHomepage(station));
    actions.appendChild(linkBtn);
  }

  body.append(name, meta, contributor, tags, actions);
  card.append(art, body);
  return card;
}

function renderSection(title, stations, options = {}) {
  const section = document.createElement("section");
  section.className = "gmmp-radio-section";

  const head = document.createElement("div");
  head.className = "gmmp-radio-section-head";

  const heading = document.createElement("h4");
  heading.className = "gmmp-radio-section-title";
  heading.textContent = title;

  const note = document.createElement("div");
  note.className = "gmmp-radio-section-note";
  note.textContent = options.note || "";

  head.append(heading, note);
  section.appendChild(head);

  if (!stations.length) {
    const empty = document.createElement("div");
    empty.className = "gmmp-radio-empty";
    empty.textContent = options.emptyText || (labels().radioNoStations || "Istasyon bulunamadi");
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "gmmp-radio-grid";
  stations.forEach((station, index) => {
    grid.appendChild(renderStationCard(station, stations, index, {
      shared: options.shared === true,
      onPlay: options.onPlay
    }));
  });
  section.appendChild(grid);

  if (options.footerText) {
    const footer = document.createElement("div");
    footer.className = "gmmp-radio-loading";
    footer.textContent = options.footerText;
    section.appendChild(footer);
  }

  return section;
}

function getSearchStatusText(count) {
  const labelsMap = labels();
  return count
    ? `${count} ${labelsMap.radioStationPlural || "istasyon"}`
    : labelsMap.radioSearchEmpty || "Aramana uygun istasyon bulunamadi";
}

async function resolveSearchPlaybackStations(targetStation) {
  const query = text(modalState.searchInput?.value);
  const searchKey = normalizeSearchKey(query);
  if (!query || !searchKey) return modalState.searchResults;

  const cached = readCachedSearchResults(searchKey);
  if (cached?.hasMore === false && cached.results.length) {
    return cached.results;
  }

  if (!modalState.searchHasMore) {
    return modalState.searchResults;
  }

  const labelsMap = labels();
  modalState.searchPlaybackLoading = true;
  setStatus(labelsMap.radioPreparingPlaylist || "Tum arama sonuclari oynatma listesine hazirlaniyor...");

  try {
    const allResults = await searchAllRadioStations({ query, order: "clickcount", reverse: true });
    const isSameQuery = modalState.view === "search" && normalizeSearchKey(text(modalState.searchInput?.value)) === searchKey;

    storeCachedSearchResults(searchKey, allResults.length || SEARCH_PAGE_SIZE, allResults, false);

    if (isSameQuery) {
      modalState.searchResults = allResults;
      modalState.searchLimit = Math.max(SEARCH_PAGE_SIZE, allResults.length);
      modalState.searchHasMore = false;
      musicPlayerState.radioSearchResults = allResults;
      setStatus(getSearchStatusText(allResults.length));
      renderResults();
    }

    const targetIndex = allResults.findIndex((entry) => sameStation(entry, targetStation));
    return targetIndex >= 0 ? allResults : modalState.searchResults;
  } catch (error) {
    console.error("[radio] tum arama sonuclari yuklenemedi:", error);
    return modalState.searchResults;
  } finally {
    modalState.searchPlaybackLoading = false;
  }
}

async function playSearchResultStation(station) {
  const playlistStations = await resolveSearchPlaybackStations(station);
  const targetIndex = Math.max(0, playlistStations.findIndex((entry) => sameStation(entry, station)));
  playStationGroup(playlistStations, targetIndex);
}

function renderResults() {
  if (!modalState.results) return;
  modalState.results.innerHTML = "";

  const labelsMap = labels();

  if (modalState.view === "search") {
    modalState.results.appendChild(renderSection(
      labelsMap.radioSearchResults || "Arama Sonuclari",
      modalState.searchResults,
      {
        note: modalState.searchResults.length
          ? `${modalState.searchResults.length} ${labelsMap.radioStationPlural || "istasyon"}`
          : "",
        emptyText: labelsMap.radioSearchEmpty || "Aramana uygun istasyon bulunamadi",
        footerText: modalState.searchLoadingMore
          ? (labelsMap.radioLoadingMore || "Daha fazla istasyon yukleniyor...")
          : "",
        onPlay: playSearchResultStation
      }
    ));
    if (modalState.sharedStations.length) {
      modalState.results.appendChild(renderSection(
        labelsMap.radioSharedStations || "Paylasilan Istasyonlar",
        modalState.sharedStations,
        {
          shared: true,
          note: labelsMap.radioSharedHint || "Kaydedilen istasyonlar herkes tarafindan kullanilabilir"
        }
      ));
    }
    queueMicrotask(maybeLoadMoreSearchResults);
    return;
  }

  if (modalState.sharedStations.length) {
    modalState.results.appendChild(renderSection(
      labelsMap.radioSharedStations || "Paylasilan Istasyonlar",
      modalState.sharedStations,
      {
        shared: true,
        note: getRadioPersistenceInfo().supportsServerWrite
          ? (labelsMap.radioSharedHint || "Kaydedilen istasyonlar herkes tarafindan kullanilabilir")
          : (labelsMap.radioManualSharedHint || "Statik dosya ve bu tarayicidaki kayitlar birlikte gosterilir")
      }
    ));
  }

  modalState.results.appendChild(renderSection(
    `${modalState.countryCode} ${labelsMap.radioNearbyStations || "icin on plana cikanlar"}`,
    modalState.nearbyStations,
    {
      note: labelsMap.radioAutoDiscoveryHint || "Otomatik istasyon kesfi"
    }
  ));

  modalState.results.appendChild(renderSection(
    labelsMap.radioPopularStations || "Dunyada populer",
    modalState.popularStations,
    {
      note: labelsMap.radioPopularHint || "Yuksek tik ve oy sayisina gore"
    }
  ));
}

function setLoading(message = "") {
  if (!modalState.results) return;
  modalState.results.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "gmmp-radio-loading";
  loading.textContent = message || (labels().loading || "Yukleniyor...");
  modalState.results.appendChild(loading);
}

async function loadDiscoverView() {
  const labelsMap = labels();
  const requestId = ++modalState.requestId;
  modalState.view = "discover";
  modalState.lastSearchKey = "";
  modalState.searchLimit = SEARCH_PAGE_SIZE;
  modalState.searchHasMore = false;
  modalState.searchLoadingMore = false;
  modalState.searchPlaybackLoading = false;
  musicPlayerState.radioSearchResults = [];
  updateHintText();
  setStatus(labelsMap.radioAutoDiscovering || "Istasyonlar otomatik bulunuyor...");
  setLoading(labelsMap.radioAutoDiscovering || "Istasyonlar otomatik bulunuyor...");

  try {
    const data = await getAutoDiscoveredStations({ limit: 18 });
    if (requestId !== modalState.requestId) return;

    modalState.countryCode = data.countryCode || modalState.countryCode;
    modalState.sharedStations = data.shared || [];
    modalState.nearbyStations = data.nearby || [];
    modalState.popularStations = data.popular || [];
    updateHintText();
    setStatus(labelsMap.radioReady || "Hazir");
    renderResults();
  } catch (error) {
    console.error("[radio] kesif hatasi:", error);
    if (requestId !== modalState.requestId) return;
    setStatus(labelsMap.radioLoadError || "Istasyonlar yuklenemedi");
    setLoading(labelsMap.radioLoadError || "Istasyonlar yuklenemedi");
  }
}

async function loadMoreSearchResults() {
  if (modalState.searchLoadingMore || modalState.searchPlaybackLoading || !modalState.searchHasMore) return;
  modalState.searchLoadingMore = true;
  setStatus(labels().radioLoadingMore || "Daha fazla istasyon yukleniyor...");
  renderResults();

  try {
    await runSearch({
      force: true,
      requestedLimit: modalState.searchLimit + SEARCH_PAGE_SIZE,
      preserveResults: true
    });
  } finally {
    modalState.searchLoadingMore = false;
    renderResults();
  }
}

async function runSearch({ force = false, requestedLimit, preserveResults = false } = {}) {
  const query = text(modalState.searchInput?.value);
  const searchKey = normalizeSearchKey(query);
  const isSameQuery = searchKey === modalState.lastSearchKey;
  const searchLimit = normalizeSearchLimit(isSameQuery ? requestedLimit : SEARCH_PAGE_SIZE);
  if (!query) {
    modalState.lastSearchKey = "";
    modalState.searchLimit = SEARCH_PAGE_SIZE;
    modalState.searchHasMore = false;
    modalState.searchLoadingMore = false;
    modalState.searchPlaybackLoading = false;
    musicPlayerState.radioSearchResults = [];
    if (!force && modalState.view === "discover") return;
    await loadDiscoverView();
    return;
  }

  if (!force && isSameQuery && modalState.view === "search" && searchLimit === modalState.searchLimit) {
    return;
  }

  const labelsMap = labels();
  const requestId = ++modalState.requestId;
  const cachedResults = readCachedSearchResults(searchKey);
  modalState.lastSearchKey = searchKey;
  modalState.searchLimit = searchLimit;
  modalState.view = "search";
  updateHintText();

  if (cachedResults && cachedResults.limit >= searchLimit) {
    modalState.searchResults = cachedResults.results.slice(0, searchLimit);
    modalState.searchHasMore = cachedResults.hasMore !== false;
    musicPlayerState.radioSearchResults = modalState.searchResults;
    setStatus(getSearchStatusText(modalState.searchResults.length));
    renderResults();
    return;
  }

  if (preserveResults) {
    setStatus(labelsMap.radioLoadingMore || "Daha fazla istasyon yukleniyor...");
  } else {
    setStatus(labelsMap.radioSearching || "Istasyon aranıyor...");
    setLoading(labelsMap.radioSearching || "Istasyon aranıyor...");
  }

  try {
    const { results, hasMore } = await searchRadioStationsDetailed({
      query,
      limit: searchLimit,
      order: "clickcount",
      reverse: true
    });
    if (requestId !== modalState.requestId) return;
    modalState.searchResults = results;
    modalState.searchHasMore = hasMore;
    musicPlayerState.radioSearchResults = results;
    storeCachedSearchResults(searchKey, searchLimit, results, hasMore);
    updateHintText();
    setStatus(getSearchStatusText(results.length));
    renderResults();
  } catch (error) {
    console.error("[radio] arama hatasi:", error);
    if (requestId !== modalState.requestId) return;
    setStatus(labelsMap.radioLoadError || "Istasyonlar yuklenemedi");
    if (!preserveResults) {
      setLoading(labelsMap.radioLoadError || "Istasyonlar yuklenemedi");
    }
  }
}

async function handleAddStation(event) {
  event.preventDefault();

  const labelsMap = labels();
  const form = modalState.addForm;
  if (!form) return;

  const formData = new FormData(form);
  const name = text(formData.get("name"));
  const url = text(formData.get("url"));
  const homepage = text(formData.get("homepage"));

  if (!url) {
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${labelsMap.radioUrlRequired || "Yayin adresi gerekli"}`,
      2200,
      "warning"
    );
    return;
  }

  if (modalState.addBtn) modalState.addBtn.disabled = true;
  setStatus(labelsMap.radioAdding || "Istasyon kaydediliyor...");

  try {
    const existing = await findStationByUrl(url).catch(() => null);
    const station = normalizeRadioStation({
      ...(existing || {}),
      name: name || existing?.name || undefined,
      url,
      homepage: homepage || existing?.homepage || undefined
    }, { source: "shared" });

    if (!station) {
      throw new Error(labelsMap.radioInvalidStation || "Gecersiz istasyon");
    }

    const merged = await saveSharedRadioStation(station);
    const info = getRadioPersistenceInfo();
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    form.reset();

    showNotification(
      `<i class="fas fa-check-circle"></i> ${info.supportsServerWrite ? (labelsMap.radioSharedSaved || "Istasyon paylasilan listeye eklendi") : (labelsMap.radioLocalSaved || "Istasyon bu tarayiciya kaydedildi")}`,
      2500,
      "success"
    );

    submitStationToDirectory(station).catch(() => {});
    if (modalState.view !== "discover") {
      modalState.view = "discover";
    }
    updateHintText();
    setStatus(labelsMap.radioReady || "Hazir");
    renderResults();
  } catch (error) {
    console.error("[radio] ekleme hatasi:", error);
    showNotification(
      `<i class="fas fa-exclamation-circle"></i> ${labelsMap.radioSharedSaveError || "Istasyon paylasilan listeye eklenemedi"}`,
      3200,
      "error"
    );
    setStatus(labelsMap.radioSharedSaveError || "Istasyon paylasilan listeye eklenemedi");
  } finally {
    if (modalState.addBtn) modalState.addBtn.disabled = false;
  }
}

function closeRadioModal() {
  if (!modalState.root) return;
  clearSearchDebounce();
  modalState.isSearchComposing = false;
  modalState.searchPlaybackLoading = false;
  modalState.root.classList.remove("visible");
}

function ensureModal() {
  if (modalState.root) return;

  ensureStyles();

  const root = document.createElement("div");
  root.id = "gmmp-radio-modal";
  root.className = "gmmp-radio-modal";
  root.innerHTML = `
    <div class="gmmp-radio-backdrop"></div>
    <div class="gmmp-radio-dialog" role="dialog" aria-modal="true" aria-labelledby="gmmp-radio-title">
      <div class="gmmp-radio-header">
        <div>
          <h3 id="gmmp-radio-title" class="gmmp-radio-title">${labels().radioStations || "Radyolar"}</h3>
          <p class="gmmp-radio-status"></p>
        </div>
        <div class="gmmp-radio-actions">
          <button type="button" class="gmmp-radio-btn secondary" data-action="discover">${labels().radioAutoDiscover || "Otomatik Bul"}</button>
          <button type="button" class="gmmp-radio-iconbtn" data-action="close" aria-label="${labels().close || "Kapat"}">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
      <form class="gmmp-radio-searchrow">
        <input class="gmmp-radio-input" name="query" placeholder="${labels().radioSearchPlaceholder || "Istasyon, ulke veya tarz ara"}" autocomplete="off" />
        <button type="submit" class="gmmp-radio-btn primary">${labels().ara || "Ara"}</button>
        <button type="button" class="gmmp-radio-btn secondary" data-action="reset">${labels().radioResetSearch || "Kesfe Don"}</button>
      </form>
      <div class="gmmp-radio-hint">${labels().radioSharedHint || "Kaydedilen istasyonlar herkes tarafindan kullanilabilir"}</div>
      <form class="gmmp-radio-addform">
        <input class="gmmp-radio-input" name="name" placeholder="${labels().radioNameOptional || "Istasyon adi (opsiyonel)"}" autocomplete="off" />
        <input class="gmmp-radio-input" name="url" placeholder="${labels().radioUrlPlaceholder || "https://ornek.com/stream.mp3"}" autocomplete="off" />
        <input class="gmmp-radio-input" name="homepage" placeholder="${labels().radioHomepageOptional || "Anasayfa (opsiyonel)"}" autocomplete="off" />
        <button type="submit" class="gmmp-radio-btn primary">${labels().radioAddUrl || "URL Ekle"}</button>
      </form>
      <div class="gmmp-radio-results"></div>
    </div>
  `;

  document.body.appendChild(root);

  modalState.root = root;
  modalState.results = root.querySelector(".gmmp-radio-results");
  modalState.status = root.querySelector(".gmmp-radio-status");
  modalState.searchInput = root.querySelector('.gmmp-radio-searchrow input[name="query"]');
  modalState.searchBtn = root.querySelector('.gmmp-radio-searchrow button[type="submit"]');
  modalState.discoverBtn = root.querySelector('[data-action="discover"]');
  modalState.addForm = root.querySelector(".gmmp-radio-addform");
  modalState.addBtn = root.querySelector('.gmmp-radio-addform button[type="submit"]');
  modalState.hint = root.querySelector(".gmmp-radio-hint");
  musicPlayerState.radioModal = root;
  updateHintText();

  root.querySelector(".gmmp-radio-backdrop").addEventListener("click", closeRadioModal);
  root.querySelector('[data-action="close"]').addEventListener("click", closeRadioModal);
  root.querySelector('[data-action="reset"]').addEventListener("click", () => {
    clearSearchDebounce();
    modalState.lastSearchKey = "";
    if (modalState.searchInput) modalState.searchInput.value = "";
    loadDiscoverView();
  });
  modalState.discoverBtn.addEventListener("click", () => {
    clearSearchDebounce();
    loadDiscoverView();
  });
  modalState.searchInput?.addEventListener("input", () => {
    scheduleSearch();
  });
  modalState.searchInput?.addEventListener("compositionstart", () => {
    modalState.isSearchComposing = true;
    clearSearchDebounce();
  });
  modalState.searchInput?.addEventListener("compositionend", () => {
    modalState.isSearchComposing = false;
    scheduleSearch();
  });
  modalState.results?.addEventListener("scroll", maybeLoadMoreSearchResults, { passive: true });
  root.querySelector(".gmmp-radio-searchrow").addEventListener("submit", (event) => {
    event.preventDefault();
    clearSearchDebounce();
    runSearch({ force: true });
  });
  modalState.addForm.addEventListener("submit", handleAddStation);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalState.root?.classList.contains("visible")) {
      closeRadioModal();
    }
  });
}

export async function showRadioModal() {
  ensureModal();
  modalState.root.classList.add("visible");
  modalState.searchInput?.focus();
  await loadDiscoverView();
}
