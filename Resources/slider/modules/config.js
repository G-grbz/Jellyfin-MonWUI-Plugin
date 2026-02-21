import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';

let __globalOverride = null;
let __globalApplied = false;

export function getDeviceProfileAuto() {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    const small = window.matchMedia?.("(max-width: 900px)")?.matches === true;
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return (coarse || (small && uaMobile)) ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

export function getAdminTargetProfile() {
  const v = (localStorage.getItem("jms:settingsTargetProfile") || "auto").toLowerCase();
  if (v === "mobile" || v === "desktop") return v;
  return getDeviceProfileAuto();
}

async function __fetchGlobalOverride(force = false) {
  if (!force && __globalOverride !== null) return __globalOverride;
  try {
    const profile = getDeviceProfileAuto();
    const r = await fetch(`/Plugins/JMSFusion/UserSettings?ts=${Date.now()}&profile=${profile}`, {
    });
    if (!r.ok) throw new Error();
    __globalOverride = await r.json();
  } catch {
    __globalOverride = { forceGlobal: false };
  }
  return __globalOverride;
}

function _takeBackupOnce(keys) {
  try {
    const key = "jf:globalBackup:v2";
    if (localStorage.getItem(key)) return;
    const snap = {};
    (keys || []).forEach(k => {
      snap[k] = localStorage.getItem(k);
    });
    localStorage.setItem(key, JSON.stringify(snap));
  } catch {}
}

function _restoreBackupIfAny() {
  try {
    const key = "jf:globalBackup:v2";
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const snap = JSON.parse(raw || "{}");

    for (const [k, v] of Object.entries(snap)) {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, String(v));
    }

    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function _setLsSmart(k, v) {
  if (String(k).startsWith("jf:")) return;

  if (v === undefined) return;
  if (v === null) {
    localStorage.removeItem(k);
    return;
  }
  if (typeof v === "object") {
    localStorage.setItem(k, JSON.stringify(v));
  } else {
    localStorage.setItem(k, String(v));
  }
}

function _num(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function _bool(v, d=false){ return v === 'true' ? true : (v === 'false' ? false : d); }
function _trimSlashesEnd(s){ return String(s || '').replace(/\/+$/, ''); }

function readSmartAutoPause() {
  const raw = localStorage.getItem('smartAutoPause');
  if (raw && raw.trim().startsWith('{') && raw !== '[object Object]') {
    try {
      const j = JSON.parse(raw);
      return {
        enabled: j.enabled !== false,
        blurMinutes: _num(j.blurMinutes, 0.5),
        hiddenMinutes: _num(j.hiddenMinutes, 0.2),
        idleMinutes: _num(j.idleMinutes, 45),
        useIdleDetection: j.useIdleDetection !== false,
        respectPiP: j.respectPiP !== false,
        ignoreShortUnderSec: _num(j.ignoreShortUnderSec, 300)
      };
    } catch {}
  }
  const idleMs = _num(localStorage.getItem('idleThresholdMs'), 0);
  const unfocusMs = _num(localStorage.getItem('unfocusedThresholdMs'), 0);
  const offscreenMs = _num(localStorage.getItem('offscreenThresholdMs'), 0);
  const useIdle = _bool(localStorage.getItem('useIdleDetection'), true);
  const respectPiP = _bool(localStorage.getItem('respectPiP'), true);
  const ignoreShort = _num(localStorage.getItem('ignoreShortUnderSec'), 300);

  const sapLegacy = {
    enabled: true,
    blurMinutes: unfocusMs > 0 ? (unfocusMs / 60000) : (500 / 60000),
    hiddenMinutes: offscreenMs > 0 ? (offscreenMs / 60000) : (500 / 60000),
    idleMinutes: idleMs > 0 ? (idleMs / 60000) : 45,
    useIdleDetection: useIdle,
    respectPiP: respectPiP,
    ignoreShortUnderSec: ignoreShort
  };
  try { localStorage.setItem('smartAutoPause', JSON.stringify(sapLegacy)); } catch {}
  return sapLegacy;
}

export function getConfig() {
  const forceGlobal = __globalOverride?.forceGlobal === true;
  if (window.__JMS_GLOBAL_CONFIG__) {
    return window.__JMS_GLOBAL_CONFIG__;
  }

  function readPeakSlider() {
  const variant = (localStorage.getItem('cssVariant') || 'normalslider').toLowerCase();
  const isPeakLike = ['peak', 'peakslider', 'peak-skin'].includes(variant);
  if (variant) return isPeakLike;
  const explicit = localStorage.getItem('peakSlider');
  return explicit === 'true';
}
  function readDotPreviewMode() {
    try {
      const v = localStorage.getItem('dotPreviewPlaybackMode');
      if (!v || v === '[object Object]') return null;
      if (v === 'trailer' || v === 'video' || v === 'onlyTrailer') return v;
      localStorage.removeItem('dotPreviewPlaybackMode');
      return null;
    } catch {
      return null;
    }
  }
  function readPauseOverlay() {
  const raw = localStorage.getItem('pauseOverlay');
  if (raw && raw.trim().startsWith('{') && raw !== '[object Object]') {
    try {
      const j = JSON.parse(raw);
      const mv = _num(j.minVideoMinutes, 5);
      const safeMin = Math.max(1, mv);
      const cfg = {
        enabled: j.enabled !== false,
        imagePreference: j.imagePreference || 'auto',
        showPlot: j.showPlot !== false,
        debug: j.debug !== false,
        requireWebSocket: j.requireWebSocket !== false,
        showMetadata: j.showMetadata !== false,
        showLogo: j.showLogo !== false,
        closeOnMouseMove: j.closeOnMouseMove !== false,
        showBackdrop: j.showBackdrop !== false,
        minVideoMinutes: safeMin,
        ageBadgeDurationMs: _num(j.ageBadgeDurationMs, 12000),
        ageBadgeLockMs: _num(j.ageBadgeLockMs, 6000),
        showAgeBadge: j.showAgeBadge !== false,
        badgeDelayMs: _num(j.badgeDelayMs, 5000),
        badgeDelayResumeMs: _num(j.badgeDelayResumeMs, 2000),
        ageBadgeDurationResumeMs: _num(j.ageBadgeDurationResumeMs, 10000),
      };
      if (safeMin !== mv) { try { localStorage.setItem('pauseOverlay', JSON.stringify(cfg)); } catch {} }
      return cfg;
    } catch {}
  }

  const rawImagePref = localStorage.getItem('pauseOverlayImagePreference');
  const rawShowPlot = localStorage.getItem('pauseOverlayShowPlot');
  const rawShowMeta = localStorage.getItem('pauseOverlayShowMetadata');
  const rawShowLogo = localStorage.getItem('pauseOverlayShowLogo');
  const rawDebug = localStorage.getItem('pauseOverlayDebug');
  const rawShowBackdrop = localStorage.getItem('pauseOverlayShowBackdrop');
  const rawRequireWebSocket = localStorage.getItem('pauseOverlayRequireWebSocket');
  const rawMinVideoMin = localStorage.getItem('pauseOverlayMinVideoMinutes');
  const rawCloseOnMouse = localStorage.getItem('closeOnMouseMove');

  const mvLegacy = _num(rawMinVideoMin, 5);
  const safeMinLegacy = Math.max(1, mvLegacy);

  const legacy = {
    enabled: raw !== 'false',
    imagePreference: rawImagePref || 'auto',
    showPlot: rawShowPlot !== 'false',
    debug: rawDebug !== 'false',
    showMetadata: rawShowMeta !== 'false',
    showLogo: rawShowLogo !== 'false',
    showBackdrop: rawShowBackdrop !== 'false',
    requireWebSocket: rawRequireWebSocket !== 'false',
    closeOnMouseMove: rawCloseOnMouse !== 'false',
    minVideoMinutes: safeMinLegacy,
    ageBadgeDurationMs: 12000,
    ageBadgeLockMs: 6000,
    badgeDelayMs: 6000,
    badgeDelayResumeMs: 800,
    ageBadgeDurationResumeMs: 5000,
    showAgeBadge: true,
  };

  try { localStorage.setItem('pauseOverlay', JSON.stringify(legacy)); } catch {}
  return legacy;
}

  const defaultLanguage = getDefaultLanguage();
  return {
    customQueryString: localStorage.getItem('customQueryString') || 'IncludeItemTypes=Movie,Series&Recursive=true&hasOverview=true&imageTypes=Logo,Backdrop&sortBy=DateCreated&sortOrder=Descending',
    sortingKeywords: (() => {
      const raw = localStorage.getItem('sortingKeywords');
      try {
        return raw ? JSON.parse(raw) : ["DateCreated","PremiereDate","ProductionYear","Random"];
      } catch {
        return raw ? raw.split(',').map(k => k.trim()) : ["DateCreated","PremiereDate","ProductionYear","Random"];
      }
    })(),
    enableSlider: localStorage.getItem('enableSlider') !== 'false',
    onlyShowSliderOnHomeTab: localStorage.getItem('onlyShowSliderOnHomeTab') !== 'false',
    showLanguageInfo: localStorage.getItem('showLanguageInfo') !== 'false',
    balanceItemTypes: localStorage.getItem('balanceItemTypes') !== 'false',
    showRatingInfo: localStorage.getItem('showRatingInfo') !== 'false',
    showMatchPercentage: localStorage.getItem('showMatchPercentage') !== 'false',
    showProviderInfo: localStorage.getItem('showProviderInfo') !== 'false',
    showDotNavigation: localStorage.getItem('showDotNavigation') !== 'false',
    showSettingsLink: localStorage.getItem("showSettingsLink") !== "false",
    showMusicIcon: localStorage.getItem("showMusicIcon") !== "false",
    showLogoOrTitle: localStorage.getItem('showLogoOrTitle') !== 'false',
    showTitleOnly: localStorage.getItem('showTitleOnly') === 'true' ? true : false,
    showDiscOnly: localStorage.getItem('showDiscOnly') === 'true' ? true : false,
    displayOrder: localStorage.getItem('displayOrder') || 'logo,disk,originalTitle',
    showCommunityRating: localStorage.getItem('showCommunityRating') !== 'false',
    showCriticRating: localStorage.getItem('showCriticRating') !== 'false',
    showOfficialRating: localStorage.getItem('showOfficialRating') !== 'false',
    showStatusInfo: localStorage.getItem('showStatusInfo') !== 'false',
    showTypeInfo: localStorage.getItem('showTypeInfo') !== 'false',
    showWatchedInfo: localStorage.getItem('showWatchedInfo') !== 'false',
    showRuntimeInfo: localStorage.getItem('showRuntimeInfo') !== 'false',
    showQualityInfo: localStorage.getItem('showQualityInfo') !== 'false',
    showProgressBar: localStorage.getItem('showProgressBar') !== 'false',
    showProgressAsSeconds: localStorage.getItem('showProgressAsSeconds') === 'true',
    showQualityDetail: localStorage.getItem('showQualityDetail') !== 'false',
    showActorInfo: localStorage.getItem('showActorInfo') !== 'false',
    showActorAll: localStorage.getItem('showActorAll') === 'true',
    showActorImg: localStorage.getItem('showActorImg') !== 'false',
    showActorRole: localStorage.getItem('showActorRole') !== 'false',
    showDescriptions: localStorage.getItem('showDescriptions') !== 'false',
    showPlotInfo: localStorage.getItem('showPlotInfo') !== 'false',
    showbPlotInfo: localStorage.getItem('showbPlotInfo') !== 'false',
    showSloganInfo: localStorage.getItem('showSloganInfo') !== 'false',
    showTitleInfo: localStorage.getItem('showTitleInfo') !== 'false',
    showOriginalTitleInfo: localStorage.getItem('showOriginalTitleInfo') !== 'false',
    showDirectorWriter: localStorage.getItem("showDirectorWriter") !== "false",
    showDirector: localStorage.getItem("showDirector") !== "false",
    showWriter: localStorage.getItem("showWriter") !== "false",
    showInfo: localStorage.getItem("showInfo") !== "false",
    showGenresInfo: localStorage.getItem("showGenresInfo") !== "false",
    showYearInfo: localStorage.getItem("showYearInfo") !== "false",
    showCountryInfo: localStorage.getItem("showCountryInfo") !== "false",
    showTrailerButton: localStorage.getItem('showTrailerButton') !== 'false',
    showTrailerIcon: localStorage.getItem('showTrailerIcon') !== 'false',
    showWatchButton: localStorage.getItem('showWatchButton') !== 'false',
    manualBackdropSelection: localStorage.getItem('manualBackdropSelection') === 'true',
    indexZeroSelection: localStorage.getItem('indexZeroSelection') !== 'false',
    showFavoriteButton: localStorage.getItem('showFavoriteButton') !== 'false',
    showPlayedButton: localStorage.getItem('showPlayedButton') !== 'false',
    showCast: localStorage.getItem('showCast') !== 'false',
    detailUrl: localStorage.getItem('detailUrl') !== 'false',
    hideOriginalTitleIfSame: localStorage.getItem('hideOriginalTitleIfSame') === 'true',
    gradientOverlayImageType: localStorage.getItem('gradientOverlayImageType') || 'backdropUrl',
    backdropImageType: localStorage.getItem('backdropImageType') || 'backdropUrl',
    enableTrailerPlayback: localStorage.getItem('enableTrailerPlayback') !== 'false',
    enableVideoPlayback: localStorage.getItem('enableVideoPlayback') === 'true',
    dotBackgroundImageType: localStorage.getItem('dotBackgroundImageType') || 'none',
    trailerBackgroundImageType: localStorage.getItem('trailerBackgroundImageType') || 'trailerBgImage',
    watchBackgroundImageType: localStorage.getItem('watchBackgroundImageType') || 'watchBgImage',
    favoriteBackgroundImageType: localStorage.getItem('favoriteBackgroundImageType') || 'favoriBgImage',
    playedBackgroundImageType: localStorage.getItem('playedBackgroundImageType') || 'playedBgImage',
    manualListIds: localStorage.getItem('manualListIds') || '',
    useManualList: localStorage.getItem('useManualList') === 'true',
    enableSlider: localStorage.getItem('enableSlider') !== 'false',
    useListFile: localStorage.getItem('useListFile') === 'true',
    useRandomContent: localStorage.getItem('useRandomContent') !== 'false',
    fullscreenMode: localStorage.getItem('fullscreenMode') === 'true' ? true : false,
    listLimit: 20,
    version: "v1.9.0",
    historySize: 20,
    updateInterval: 300000,
    nextTracksSource: localStorage.getItem('nextTracksSource') || 'playlist',
    defaultLanguage,
    languageLabels: getLanguageLabels(defaultLanguage),
    sliderDuration: parseInt(localStorage.getItem('sliderDuration'), 10) || 15000,
    artistLimit: parseInt(localStorage.getItem('artistLimit'), 10) || 10,
    gecikmeSure: parseInt(localStorage.getItem('gecikmeSure'), 10) || 500,
    limit: parseInt(localStorage.getItem('limit'), 10) || 20,
    onlyUnwatchedRandom: localStorage.getItem('onlyUnwatchedRandom') === 'true',
    maxShufflingLimit: parseInt(localStorage.getItem('maxShufflingLimit'), 10) || 10000,
    excludeEpisodesFromPlaying: localStorage.getItem('excludeEpisodesFromPlaying') !== 'false',
    showPlaybackProgress: localStorage.getItem('showPlaybackProgress') !== 'false',
    muziklimit: parseInt(localStorage.getItem('muziklimit'), 10) || 30,
    albumlimit: parseInt(localStorage.getItem('albumlimit'), 10) || 20,
    sarkilimit: parseInt(localStorage.getItem('sarkilimit'), 10) || 200,
    gruplimit: parseInt(localStorage.getItem('gruplimit'), 10) || 100,
    id3limit: parseInt(localStorage.getItem('id3limit'), 10) || 5,
    historylimit: parseInt(localStorage.getItem('historylimit'), 10) || 10,
    playerTheme: localStorage.getItem('playerTheme') || 'dark',
    playerStyle: localStorage.getItem('playerStyle') || 'player',
    dateLocale: localStorage.getItem('dateLocale') || 'tr-TR',
    maxExcludeIdsForUri: parseInt(localStorage.getItem('maxExcludeIdsForUri'), 10) || 100,
    nextTrack: parseInt(localStorage.getItem('nextTrack'), 10) || 100,
    topTrack: parseInt(localStorage.getItem('topTrack'), 10) || 30,
    aktifSure: parseInt(localStorage.getItem('aktifSure'), 10) || 5000,
    girisSure: parseInt(localStorage.getItem('girisSure'), 10) || 1000,
    homeSectionsTop: parseInt(localStorage.getItem('homeSectionsTop'), 10) || 0,
    dotPosterMode: localStorage.getItem('dotPosterMode') === 'true',
    shuffleSeedLimit: parseInt(localStorage.getItem('shuffleSeedLimit'), 10) || 1000,
    createAvatar: localStorage.getItem('createAvatar') !== 'false',
    avatarWidth: parseInt(localStorage.getItem('avatarWidth'), 10) || 18,
    avatarHeight: parseInt(localStorage.getItem('avatarHeight'), 10) || 18,
    avatarFontSize: parseInt(localStorage.getItem('avatarFontSize'), 10) || 15,
    avatarTextShadow: localStorage.getItem('avatarTextShadow') || '1px 1px 2px rgba(0,0,0,0.3)',
    avatarColorMethod: localStorage.getItem('avatarColorMethod') || 'dynamic',
    avatarSolidColor: localStorage.getItem('avatarSolidColor') || '#FF4081',
    avatarGradient: localStorage.getItem('avatarGradient') || 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)',
    avatarFontFamily: localStorage.getItem('avatarFontFamily') || 'Righteous',
    avatarStyle: localStorage.getItem('avatarStyle') || 'dicebear',
    dicebearStyle: localStorage.getItem('dicebearStyle') || 'adventurer',
    dicebearBackgroundColor: localStorage.getItem('dicebearBackgroundColor') || 'transparent',
    dicebearRadius: parseInt(localStorage.getItem('dicebearRadius'), 10) || 50,
    avatarCacheDuration: parseInt(localStorage.getItem('avatarCacheDuration'), 10) || 10000,
    avatarScale: parseFloat(localStorage.getItem('avatarScale')) || 4,
    dicebearBackgroundEnabled: localStorage.getItem('dicebearBackgroundEnabled') === 'true' ? true : false,
    dicebearPosition: localStorage.getItem('dicebearPosition') !== 'false',
    autoRefreshAvatar: localStorage.getItem('autoRefreshAvatar') !== 'false',
    avatarRefreshTime: parseInt(localStorage.getItem('avatarRefreshTime'), 10) || 10,
    randomDicebearAvatar: localStorage.getItem('randomDicebearAvatar') !== 'false',
    enableHls: localStorage.getItem('enableHls') === 'true' ? true : false,
    previewModal: localStorage.getItem('previewModal') !== 'false',
    allPreviewModal: localStorage.getItem('allPreviewModal') !== 'false',
    globalPreviewMode: localStorage.getItem('globalPreviewMode') || 'modal',
    dotPreviewPlaybackMode: readDotPreviewMode(),
    preferTrailersInPreviewModal: localStorage.getItem('preferTrailersInPreviewModal') !== 'false',
    onlyTrailerInPreviewModal: localStorage.getItem('onlyTrailerInPreviewModal') === 'true' ? true : false,
    enabledGmmp: localStorage.getItem('enabledGmmp') !== 'false',
    enableQualityBadges: localStorage.getItem('enableQualityBadges') !== 'false',
    enableTrailerThenVideo: localStorage.getItem('enableTrailerThenVideo') !== 'false',
    disableAllPlayback: localStorage.getItem('disableAllPlayback') === 'true' ? true : false,
    dicebearParams: (() => {
  try {
    const raw = localStorage.getItem('dicebearParams');
    if (raw === '[object Object]') {
      localStorage.removeItem('dicebearParams');
      return {};
    }
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Dicebear params parse error:', e);
    return {};
  }
})(),

    enableNotifications: localStorage.getItem('enableNotifications') !== 'false',
    enableToastNew: localStorage.getItem('enableToastNew') !== 'false',
    enableToastSystem: localStorage.getItem('enableToastSystem') !== 'false',
    maxNotifications: parseInt(localStorage.getItem("maxNotifications"), 10) || 15,
    toastDuration: parseInt(localStorage.getItem("toastDuration"), 10) || 4000,
    renderResume: parseInt(localStorage.getItem("renderResume"), 10) || 10,
    enableRenderResume: localStorage.getItem('enableRenderResume') !== 'false',
    toastGroupThreshold: parseInt(localStorage.getItem("toastGroupThreshold"), 10) || 5,
    enableCounterSystem: localStorage.getItem('enableCounterSystem') !== 'false',

    enableDirectorRows: localStorage.getItem('enableDirectorRows') !== 'false',
    directorRowsCount: parseInt(localStorage.getItem("directorRowsCount"), 10) || 4,
    directorRowsMinItemsPerDirector: parseInt(localStorage.getItem("directorRowsMinItemsPerDirector"), 10) || 8,
    directorRowCardCount: parseInt(localStorage.getItem("directorRowCardCount"), 10) || 10,
    placeDirectorRowsAtBottom: localStorage.getItem('placeDirectorRowsAtBottom') !== 'false',
    directorRowsUseTopGenres: localStorage.getItem('directorRowsUseTopGenres') !== 'false',

    enableRecentRows: (localStorage.getItem('enableRecentRows') || 'true') !== 'false',

    enableContinueMovies: (localStorage.getItem('enableContinueMovies') || 'true') !== 'false',
    continueMoviesCardCount: parseInt(localStorage.getItem('continueMoviesCardCount'), 10) || 10,

    enableContinueSeries: (localStorage.getItem('enableContinueSeries') || 'true') !== 'false',
    continueSeriesCardCount: parseInt(localStorage.getItem('continueSeriesCardCount'), 10) || 10,

    enableRecentMoviesRow: (localStorage.getItem('enableRecentMoviesRow') || 'true') !== 'false',
    recentMoviesCardCount: parseInt(localStorage.getItem('recentMoviesCardCount'), 10) || 10,

    enableRecentSeriesRow: (localStorage.getItem('enableRecentSeriesRow') || 'true') !== 'false',
    recentSeriesCardCount: parseInt(localStorage.getItem('recentSeriesCardCount'), 10) || 10,

    enableRecentEpisodesRow: (localStorage.getItem('enableRecentEpisodesRow') || 'true') !== 'false',
    recentEpisodesCardCount: parseInt(localStorage.getItem('recentEpisodesCardCount'), 10) || 10,

    recentRowsSplitTvLibs: (localStorage.getItem('recentRowsSplitTvLibs') || 'true') !== 'false',

    recentSeriesTvLibIds: (() => {
      try {
        const raw = localStorage.getItem('recentSeriesTvLibIds');
        if (!raw || raw === '[object Object]') return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(x=>String(x||'').trim()).filter(Boolean) : [];
      } catch { return []; }
    })(),
    recentEpisodesTvLibIds: (() => {
      try {
        const raw = localStorage.getItem('recentEpisodesTvLibIds');
        if (!raw || raw === '[object Object]') return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(x=>String(x||'').trim()).filter(Boolean) : [];
      } catch { return []; }
    })(),
    continueSeriesTvLibIds: (() => {
      try {
        const raw = localStorage.getItem('continueSeriesTvLibIds');
        if (!raw || raw === '[object Object]') return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(x=>String(x||'').trim()).filter(Boolean) : [];
      } catch { return []; }
    })(),

    enableBecauseYouWatched: (localStorage.getItem('enableBecauseYouWatched') || 'true') !== 'false',
    becauseYouWatchedRowCount: parseInt(localStorage.getItem('becauseYouWatchedRowCount'), 10) || 10,
    becauseYouWatchedCardCount: parseInt(localStorage.getItem('becauseYouWatchedCardCount'), 10) || 10,

    enableProfileChooser: localStorage.getItem('enableProfileChooser') !== 'false',
    profileChooserAutoOpen: localStorage.getItem('profileChooserAutoOpen') !== 'false',
    profileChooserRememberTokens: localStorage.getItem('profileChooserRememberTokens') !== 'false',

    enablePersonalRecommendations: localStorage.getItem('enablePersonalRecommendations') !== 'false',
    personalRecsCacheTtlMs: parseInt(localStorage.getItem('personalRecsCacheTtlMs'), 10) || 3600000,
    enableStudioHubs: localStorage.getItem('enableStudioHubs') !== 'false',
    placePersonalRecsUnderStudioHubs: localStorage.getItem('placePersonalRecsUnderStudioHubs') !== 'false',
    placeGenreHubsAbovePersonalRecs: localStorage.getItem('placeGenreHubsAbovePersonalRecs') === 'true' ? true : false,
    studioHubsHoverVideo: localStorage.getItem('studioHubsHoverVideo') !== 'false',
    studioMiniTrailerPopover: (localStorage.getItem("studioMiniTrailerPopover") || "false") === "true",
    studioHubsMinRating: parseFloat(localStorage.getItem('studioHubsMinRating')) || 6.5,
    studioHubsCardCount: parseInt(localStorage.getItem('studioHubsCardCount'), 10) || 10,
    personalRecsCardCount: parseInt(localStorage.getItem('personalRecsCardCount'), 10) || 9,
    studioHubsOrder: (() => {
      try {
       const raw = localStorage.getItem('studioHubsOrder');
        if (raw && raw !== '[object Object]') {
          const arr = JSON.parse(raw);
         if (Array.isArray(arr) && arr.length) return arr;
        }
     } catch {}
     return [
        "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
        "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures","Paramount Pictures","Netflix"
      ];
    })(),

    slideTop: parseInt(localStorage.getItem('slideTop'), 10) || 0,
    slideLeft: parseInt(localStorage.getItem('slideLeft'), 10) || 0,
    slideWidth: parseInt(localStorage.getItem('slideWidth'), 10) || 0,
    slideHeight: parseInt(localStorage.getItem('slideHeight'), 10) || 0,

    logoContainerTop: parseInt(localStorage.getItem('logoContainerTop'), 10) || 0,
    logoContainerLeft: parseInt(localStorage.getItem('logoContainerLeft'), 10) || 0,
    logoContainerWidth: parseInt(localStorage.getItem('logoContainerWidth'), 10) || 0,
    logoContainerHeight: parseInt(localStorage.getItem('logoContainerHeight'), 10) || 0,
    logoContainerDisplay: localStorage.getItem('logoContainerDisplay') || '',
    logoContainerFlexDirection: localStorage.getItem('logoContainerFlexDirection') || '',
    logoContainerJustifyContent: localStorage.getItem('logoContainerJustifyContent') || '',
    logoContainerAlignItems: localStorage.getItem('logoContainerAlignItems') || '',
    logoContainerFlexWrap: localStorage.getItem('logoContainerFlexWrap') || '',

    buttonContainerTop: parseInt(localStorage.getItem('buttonContainerTop'), 10) || 0,
    buttonContainerLeft: parseInt(localStorage.getItem('buttonContainerLeft'), 10) || 0,
    buttonContainerWidth: parseInt(localStorage.getItem('buttonContainerWidth'), 10) || 0,
    buttonContainerHeight: parseInt(localStorage.getItem('buttonContainerHeight'), 10) || 0,
    buttonContainerDisplay: localStorage.getItem('buttonContainerDisplay') || '',
    buttonContainerFlexDirection: localStorage.getItem('buttonContainerFlexDirection') || '',
    buttonContainerJustifyContent: localStorage.getItem('buttonContainerJustifyContent') || '',
    buttonContainerAlignItems: localStorage.getItem('buttonContainerAlignItems') || '',
    buttonContainerFlexWrap: localStorage.getItem('buttonContainerFlexWrap') || '',

    metaContainerTop: parseInt(localStorage.getItem('metaContainerTop'), 10) || 0,
    metaContainerLeft: parseInt(localStorage.getItem('metaContainerLeft'), 10) || 0,
    metaContainerWidth: parseInt(localStorage.getItem('metaContainerWidth'), 10) || 0,
    metaContainerHeight: parseInt(localStorage.getItem('metaContainerHeight'), 10) || 0,
    metaContainerDisplay: localStorage.getItem('metaContainerDisplay') || '',
    metaContainerFlexDirection: localStorage.getItem('metaContainerFlexDirection') || '',
    metaContainerJustifyContent: localStorage.getItem('metaContainerJustifyContent') || '',
    metaContainerAlignItems: localStorage.getItem('metaContainerAlignItems') || '',
    metaContainerFlexWrap: localStorage.getItem('metaContainerFlexWrap') || '',

    plotContainerTop: parseInt(localStorage.getItem('plotContainerTop'), 10) || 0,
    plotContainerLeft: parseInt(localStorage.getItem('plotContainerLeft'), 10) || 0,
    plotContainerWidth: parseInt(localStorage.getItem('plotContainerWidth'), 10) || 0,
    plotContainerHeight: parseInt(localStorage.getItem('plotContainerHeight'), 10) || 0,
    plotContainerDisplay: localStorage.getItem('plotContainerDisplay') || '',
    plotContainerFlexDirection: localStorage.getItem('plotContainerFlexDirection') || '',
    plotContainerJustifyContent: localStorage.getItem('plotContainerJustifyContent') || '',
    plotContainerAlignItems: localStorage.getItem('plotContainerAlignItems') || '',
    plotContainerFlexWrap: localStorage.getItem('plotContainerFlexWrap') || '',

    titleContainerTop: parseInt(localStorage.getItem('titleContainerTop'), 10) || 0,
    titleContainerLeft: parseInt(localStorage.getItem('titleContainerLeft'), 10) || 0,
    titleContainerWidth: parseInt(localStorage.getItem('titleContainerWidth'), 10) || 0,
    titleContainerHeight: parseInt(localStorage.getItem('titleContainerHeight'), 10) || 0,
    titleContainerDisplay: localStorage.getItem('titleContainerDisplay') || '',
    titleContainerFlexDirection: localStorage.getItem('titleContainerFlexDirection') || '',
    titleContainerJustifyContent: localStorage.getItem('titleContainerJustifyContent') || '',
    titleContainerAlignItems: localStorage.getItem('titleContainerAlignItems') || '',
    titleContainerFlexWrap: localStorage.getItem('titleContainerFlexWrap') || '',

    directorContainerTop: parseInt(localStorage.getItem('directorContainerTop'), 10) || 0,
    directorContainerLeft: parseInt(localStorage.getItem('directorContainerLeft'), 10) || 0,
    directorContainerWidth: parseInt(localStorage.getItem('directorContainerWidth'), 10) || 0,
    directorContainerHeight: parseInt(localStorage.getItem('directorContainerHeight'), 10) || 0,
    directorContainerDisplay: localStorage.getItem('directorContainerDisplay') || '',
    directorContainerFlexDirection: localStorage.getItem('directorContainerFlexDirection') || '',
    directorContainerJustifyContent: localStorage.getItem('directorContainerJustifyContent') || '',
    directorContainerAlignItems: localStorage.getItem('directorContainerAlignItems') || '',
    directorContainerFlexWrap: localStorage.getItem('directorContainerFlexWrap') || '',

    infoContainerTop: parseInt(localStorage.getItem('infoContainerTop'), 10) || 0,
    infoContainerLeft: parseInt(localStorage.getItem('infoContainerLeft'), 10) || 0,
    infoContainerWidth: parseInt(localStorage.getItem('infoContainerWidth'), 10) || 0,
    infoContainerHeight: parseInt(localStorage.getItem('infoContainerHeight'), 10) || 0,
    infoContainerDisplay: localStorage.getItem('infoContainerDisplay') || '',
    infoContainerFlexDirection: localStorage.getItem('infoContainerFlexDirection') || '',
    infoContainerJustifyContent: localStorage.getItem('infoContainerJustifyContent') || '',
    infoContainerAlignItems: localStorage.getItem('infoContainerAlignItems') || '',
    infoContainerFlexWrap: localStorage.getItem('infoContainerFlexWrap') || '',

    mainContainerTop: parseInt(localStorage.getItem('mainContainerTop'), 10) || 0,
    mainContainerLeft: parseInt(localStorage.getItem('mainContainerLeft'), 10) || 0,
    mainContainerWidth: parseInt(localStorage.getItem('mainContainerWidth'), 10) || 0,
    mainContainerHeight: parseInt(localStorage.getItem('mainContainerHeight'), 10) || 0,
    mainContainerDisplay: localStorage.getItem('mainContainerDisplay') || '',
    mainContainerFlexDirection: localStorage.getItem('mainContainerFlexDirection') || '',
    mainContainerJustifyContent: localStorage.getItem('mainContainerJustifyContent') || '',
    mainContainerAlignItems: localStorage.getItem('mainContainerAlignItems') || '',
    mainContainerFlexWrap: localStorage.getItem('mainContainerFlexWrap') || '',

    sliderContainerTop: parseInt(localStorage.getItem('sliderContainerTop'), 10) || 0,
    sliderContainerLeft: parseInt(localStorage.getItem('sliderContainerLeft'), 10) || 0,
    sliderContainerWidth: parseInt(localStorage.getItem('sliderContainerWidth'), 10) || 0,
    sliderContainerHeight: parseInt(localStorage.getItem('sliderContainerHeight'), 10) || 0,
    sliderContainerDisplay: localStorage.getItem('sliderContainerDisplay') || '',
    sliderContainerFlexDirection: localStorage.getItem('sliderContainerFlexDirection') || '',
    sliderContainerJustifyContent: localStorage.getItem('sliderContainerJustifyContent') || '',
    sliderContainerAlignItems: localStorage.getItem('sliderContainerAlignItems') || '',
    sliderContainerFlexWrap: localStorage.getItem('sliderContainerFlexWrap') || '',

    existingDotContainerTop: parseInt(localStorage.getItem('existingDotContainerTop'), 10) || 0,
    existingDotContainerLeft: parseInt(localStorage.getItem('existingDotContainerLeft'), 10) || 0,
    existingDotContainerWidth: parseInt(localStorage.getItem('existingDotContainerWidth'), 10) || 0,
    existingDotContainerHeight: parseInt(localStorage.getItem('existingDotContainerHeight'), 10) || 0,
    existingDotContainerDisplay: localStorage.getItem('existingDotContainerDisplay') || '',
    existingDotContainerFlexDirection: localStorage.getItem('existingDotContainerFlexDirection') || '',
    existingDotContainerJustifyContent: localStorage.getItem('existingDotContainerJustifyContent') || '',
    existingDotContainerAlignItems: localStorage.getItem('existingDotContainerAlignItems') || '',
    dotContainerFlexWrap: localStorage.getItem('existingDotContainerFlexWrap') || '',

    progressBarTop: parseInt(localStorage.getItem('progressBarTop'), 10) || 0,
    progressBarLeft: parseInt(localStorage.getItem('progressBarLeft'), 10) || 0,
    progressBarWidth: parseInt(localStorage.getItem('progressBarWidth'), 10) || 100,
    progressBarHeight: parseInt(localStorage.getItem('progressBarHeight'), 10) || 0,

    progressSecondsTop:  parseFloat(localStorage.getItem('progressSecondsTop'))  || '',
    progressSecondsLeft: parseFloat(localStorage.getItem('progressSecondsLeft')) || '',

    providerContainerTop: parseInt(localStorage.getItem('providerContainerTop'), 10) || 0,
    providerContainerLeft: parseInt(localStorage.getItem('providerContainerLeft'), 10) || 0,
    providerContainerWidth: parseInt(localStorage.getItem('providerContainerWidth'), 10) || 0,
    providerContainerHeight: parseInt(localStorage.getItem('providerContainerHeight'), 10) || 0,
    providerContainerDisplay: localStorage.getItem('providerContainerDisplay') || '',
    providerContainerFlexDirection: localStorage.getItem('providerContainerFlexDirection') || '',
    providerContainerJustifyContent: localStorage.getItem('providerContainerJustifyContent') || '',
    providerContainerAlignItems: localStorage.getItem('providerContainerAlignItems') || '',
    providerContainerFlexWrap: localStorage.getItem('providerContainerFlexWrap') || '',

    providericonsContainerTop: parseInt(localStorage.getItem('providericonsContainerTop'), 10) || 0,
    providericonsContainerLeft: parseInt(localStorage.getItem('providericonsContainerLeft'), 10) || 0,
    providericonsContainerWidth: parseInt(localStorage.getItem('providericonsContainerWidth'), 10) || 0,
    providericonsContainerHeight: parseInt(localStorage.getItem('providericonsContainerHeight'), 10) || 0,
    providericonsContainerDisplay: localStorage.getItem('providericonsContainerDisplay') || '',
    providericonsContainerFlexDirection: localStorage.getItem('providericonsContainerFlexDirection') || '',
    providericonsContainerJustifyContent: localStorage.getItem('providericonsContainerJustifyContent') || '',
    providericonsContainerAlignItems: localStorage.getItem('providericonsContainerAlignItems') || '',
    providericonsContainerFlexWrap: localStorage.getItem('providericonsContainerFlexWrap') || '',

    statusContainerTop: parseInt(localStorage.getItem('statusContainerTop'), 10) || 0,
    statusContainerLeft: parseInt(localStorage.getItem('statusContainerLeft'), 10) || 0,
    statusContainerWidth: parseInt(localStorage.getItem('statusContainerWidth'), 10) || 0,
    statusContainerHeight: parseInt(localStorage.getItem('statusContainerHeight'), 10) || 0,
    statusContainerDisplay: localStorage.getItem('statusContainerDisplay') || '',
    statusContainerFlexDirection: localStorage.getItem('statusContainerFlexDirection') || '',
    statusContainerJustifyContent: localStorage.getItem('statusContainerJustifyContent') || '',
    statusContainerAlignItems: localStorage.getItem('statusContainerAlignItems') || '',
    statusContainerFlexWrap: localStorage.getItem('statusContainerFlexWrap') || '',

    ratingContainerTop: parseInt(localStorage.getItem('ratingContainerTop'), 10) || 0,
    ratingContainerLeft: parseInt(localStorage.getItem('ratingContainerLeft'), 10) || 0,
    ratingContainerWidth: parseInt(localStorage.getItem('ratingContainerWidth'), 10) || 0,
    ratingContainerHeight: parseInt(localStorage.getItem('ratingContainerHeight'), 10) || 0,
    ratingContainerDisplay: localStorage.getItem('ratingContainerDisplay') || '',
    ratingContainerFlexDirection: localStorage.getItem('ratingContainerFlexDirection') || '',
    ratingContainerJustifyContent: localStorage.getItem('ratingContainerJustifyContent') || '',
    ratingContainerAlignItems: localStorage.getItem('ratingContainerAlignItems') || '',
    ratingContainerFlexWrap: localStorage.getItem('ratingContainerFlexWrap') || '',

    pauseOverlay: readPauseOverlay(),
    smartAutoPause: readSmartAutoPause(),

    slideTransitionType: localStorage.getItem('slideTransitionType') || 'flip',
    dotPosterTransitionType: localStorage.getItem('dotPosterTransitionType') || 'scale',
    enableSlideAnimations: localStorage.getItem('enableSlideAnimations') === 'true' ? true : false,
    enableDotPosterAnimations: localStorage.getItem('enableDotPosterAnimations') === 'true' ? true : false,
    slideAnimationDuration: parseInt(localStorage.getItem('slideAnimationDuration'), 10) || 800,
    dotPosterAnimationDuration: parseInt(localStorage.getItem('dotPosterAnimationDuration'), 10) || 500,

    notificationsEnabled: localStorage.getItem('notificationsEnabled') !== 'false',
    useAlbumArtAsBackground: localStorage.getItem('useAlbumArtAsBackground') === 'true',
    buttonBackgroundBlur: (() => {
      const v = localStorage.getItem('buttonBackgroundBlur');
      return v !== null ? parseInt(v, 10) : 5;
    })(),
    buttonBackgroundOpacity: (() => {
    const v = localStorage.getItem('buttonBackgroundOpacity');
    return v !== null ? parseFloat(v) : 0.5;
})(),
    albumArtBackgroundBlur: (() => {
      const v = localStorage.getItem('albumArtBackgroundBlur');
      return v !== null ? parseInt(v, 10) : 5;
    })(),
    albumArtBackgroundOpacity: (() => {
      const v = localStorage.getItem('albumArtBackgroundOpacity');
      return v !== null ? parseFloat(v) : 0.5;
    })(),
    dotBackgroundBlur: (() => {
      const v = localStorage.getItem('dotBackgroundBlur');
      return v !== null ? parseInt(v, 10) : 5;
    })(),
    dotBackgroundOpacity: (() => {
    const v = localStorage.getItem('dotBackgroundOpacity');
    return v !== null ? parseFloat(v) : 0.5;
})(),
      playingLimit: (() => {
      const v = localStorage.getItem('playingLimit');
      return v !== null ? parseInt(v, 10) : 0;
    })(),
    allowedWriters: (() => {
      const defaultWriters = [
        "quentin tarantino",
        "nuri bilge ceylan",
        "zeki demirkubuz",
        "yavuz turgul",
        "stephen king",
        "martin scorsese",
        "j.r.r. tolkien",
        "andrew kevin walker",
        "christopher nolan",
        "cem yılmaz",
        "thomas harris"
      ];
      let storedWriters = [];
      try {
        const stored = localStorage.getItem('allowedWriters');
        storedWriters = stored ? JSON.parse(stored) : [];
      } catch (e) {
        storedWriters = [];
      }
      return [...new Set([...defaultWriters, ...storedWriters])];
    })(),
    minHighQualityWidth: parseInt(localStorage.getItem("minHighQualityWidth"), 10) || 1920,
    backdropMaxWidth: parseInt(localStorage.getItem("backdropMaxWidth"), 10) || 1920,
    minPixelCount: parseInt(localStorage.getItem("minPixelCount"), 10) || (1920 * 1080),
    cssVariant: localStorage.getItem('cssVariant') || 'normalslider',
    peakSlider: readPeakSlider(),
    peakDiagonal: (() => {
      const v = localStorage.getItem('peakDiagonal');
      if (v === 'true' || v === 'false') return v === 'true';
      return readPeakSlider();
    })(),
    peakSpanLeft:  parseInt(localStorage.getItem('peakSpanLeft'), 10)  || 3,
    peakSpanRight: parseInt(localStorage.getItem('peakSpanRight'), 10) || 3,
    peakGapLeft: parseInt(localStorage.getItem('peakGapLeft'), 10) || 80,
    peakGapRight: parseInt(localStorage.getItem('peakGapRight'), 10) || 80,
    peakGapY: parseInt(localStorage.getItem('peakGapY'), 10) || 0,
    enableImageSizeFilter: localStorage.getItem("enableImageSizeFilter") === "true",
    minImageSizeKB: parseInt(localStorage.getItem("minImageSizeKB"), 10) || 800,
    maxImageSizeKB: parseInt(localStorage.getItem("maxImageSizeKB"), 10) || 1500,

    enableGenreHubs: localStorage.getItem('enableGenreHubs') !== 'false',
    studioHubsGenreCardCount: parseInt(localStorage.getItem("studioHubsGenreCardCount"), 10) || 10,
    studioHubsGenreRowsCount: parseInt(localStorage.getItem("studioHubsGenreRowsCount"), 10) || 4,
    genreHubsOrder: (() => {
      try {
        const raw = localStorage.getItem('genreHubsOrder');
        if (raw && raw !== '[object Object]') {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) {
            const blacklist = ['audio','podcast','audiobook','soundtrack','radio','talk','interview','music'];
            return arr.filter(g => g && !blacklist.includes(String(g).toLowerCase()));
          }
        }
      } catch {}
      return null;
    })(),

    currentUserIsAdmin: (() => {
      try {
        const ls = localStorage.getItem('currentUserIsAdmin');
        if (ls === 'true' || ls === 'false') return ls === 'true';
        const pol =
          window.ApiClient?._currentUser?.Policy ||
          window.ApiClient?._currentUser?.UserPolicy ||
          null;
        if (pol && (pol.IsAdministrator === true || pol.IsAdministrator === 'true')) return true;
      } catch {}
      return false;
    })(),
    forceGlobalUserSettings: forceGlobal
  };
}

function pruneGlobalConfig(cfg) {
  const deny = new Set([
    "languageLabels",
    "currentUserIsAdmin",
    "version",
    "historySize",
    "updateInterval",
    "listLimit"
  ]);

  const out = {};
  for (const [k, v] of Object.entries(cfg || {})) {
    if (deny.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function publishAdminSnapshotIfForced() {
  try {
    const cfg = getConfig();
    if (!cfg?.currentUserIsAdmin) return;

    const targetProfile = getAdminTargetProfile();
    const r = await fetch(`/Plugins/JMSFusion/UserSettings?ts=${Date.now()}&profile=${targetProfile}`, {
      cache: "no-store"
    });
    const j = r.ok ? await r.json() : null;
    if (!j?.forceGlobal) return;

    const globalConfig = pruneGlobalConfig(cfg);
    const token =
      window.ApiClient?.accessToken?.() ||
      window.ApiClient?._accessToken ||
      "";

    if (!token) {
      console.warn("[JMSFusion] Auto publish skipped (no token).");
      return;
    }

    const pr = await fetch(`/Plugins/JMSFusion/UserSettings/Publish?ts=${Date.now()}&profile=${targetProfile}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Token": token
      },
      body: JSON.stringify({ global: globalConfig, profile: targetProfile })
    });

    if (!pr.ok) console.warn("[JMSFusion] Auto publish failed:", pr.status);
    else console.log("[JMSFusion] Auto publish success.");
  } catch (e) {
    console.warn("[JMSFusion] Auto publish error:", e);
  }
}

export function getServerAddress() {
  let raw =
    (window.serverConfig?.address) ||
    (sessionStorage.getItem('serverAddress')) ||
    (localStorage.getItem('serverAddress')) ||
    '';

  try {
    if (!raw && window.ApiClient) {
      if (typeof window.ApiClient.serverAddress === 'function') {
        raw = window.ApiClient.serverAddress();
      } else if (typeof window.ApiClient._serverAddress === 'string') {
        raw = window.ApiClient._serverAddress;
      } else if (typeof window.ApiClient.serverAddress === 'string') {
        raw = window.ApiClient.serverAddress;
      }
    }
  } catch {}

  if (!raw) return _trimSlashesEnd(window.location.origin);

  const s = String(raw).trim();
  if (!s) return _trimSlashesEnd(window.location.origin);
  if (/^https?:\/\//i.test(s)) return _trimSlashesEnd(s);
  if (s.startsWith('//')) return _trimSlashesEnd(`${window.location.protocol}${s}`);
  if (s.startsWith('/')) {
    return _trimSlashesEnd(`${window.location.origin}${s}`);
  }
  return _trimSlashesEnd(`${window.location.protocol}//${s}`);
 }

export function buildJfUrl(pathOrUrl) {
  const base = getServerAddress();
  const p = String(pathOrUrl || '').trim();
  if (!p) return base;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('//')) return `${window.location.protocol}${p}`;
  if (p.startsWith('/')) return `${base}${p}`;
  return `${base}/${p}`;
}

(async () => {
  try {
    const data = await __fetchGlobalOverride(true);
    window.__JMS_GLOBAL_OVERRIDE__ = data;

    if (!data?.forceGlobal) {
      if (_restoreBackupIfAny()) console.log("[JMSFusion] Restored user settings (global off).");
      return;
    }

    const isAdmin =
      window.ApiClient?._currentUser?.Policy?.IsAdministrator === true;

    if (isAdmin) {
      console.log("[JMSFusion] Admin user – skipping forced global apply.");
      return;
    }

    if (!data?.global || __globalApplied) return;

    const g = data.global;
    const keys = Object.keys(g || {});
    _takeBackupOnce(keys);

    for (const k of keys) {
      _setLsSmart(k, g[k]);
    }

    __globalApplied = true;
    console.log("[JMSFusion] Global user settings applied (forced).");
  } catch {}
})();
