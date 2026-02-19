import { getConfig, publishAdminSnapshotIfForced } from "../config.js";
import { loadCSS } from "../player/main.js";
import { updateSlidePosition } from '../positionUtils.js';
import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol, updateConfig } from "../settings.js";
import { updateHeaderUserAvatar, updateAvatarStyles, clearAvatarCache } from "../userAvatar.js";
import { showNotification } from "../player/ui/notification.js";

const _intOr = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const _floatOr = (v, def) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};
const _clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const _DEFAULT_IDLE_MS      = 45000;
const _DEFAULT_UNFOCUS_MS   = 15000;
const _DEFAULT_OFFSCREEN_MS = 10000;
const _MIN_MIN = 0.1;
const _MAX_MIN = 1000;

let __isAdminCached_apply = null;

function getJfRootFromLocation_apply() {
  const path = window.location.pathname || "/";
  const split = path.split("/web/");
  return split.length > 1 ? split[0] : "";
}

function getEmbyTokenSafe_apply() {
  try {
    return window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken || "";
  } catch {
    return "";
  }
}

async function isAdminUser_apply() {
  if (__isAdminCached_apply !== null) return __isAdminCached_apply;

  try {
    const token = getEmbyTokenSafe_apply();
    if (!token) return (__isAdminCached_apply = false);

    const jfRoot = getJfRootFromLocation_apply();
    const r = await fetch(`${jfRoot}/Users/Me`, {
      cache: "no-store",
      headers: { "Accept": "application/json", "X-Emby-Token": token }
    });
    if (!r.ok) return (__isAdminCached_apply = false);

    const me = await r.json();
    const pol = me?.Policy || {};
    return (__isAdminCached_apply = !!(pol.IsAdministrator || pol.IsAdmin || pol.IsAdminUser));
  } catch {
    return (__isAdminCached_apply = false);
  }
}

function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
  return out;
}

const USER_ONLY_KEYS = [
  "createAvatar",
  "avatarWidth",
  "avatarHeight",
  "avatarFontSize",
  "avatarTextShadow",
  "avatarColorMethod",
  "avatarSolidColor",
  "avatarGradient",
  "avatarFontFamily",
  "avatarStyle",
  "dicebearStyle",
  "dicebearBackgroundColor",
  "dicebearRadius",
  "avatarScale",
  "dicebearBackgroundEnabled",
  "dicebearPosition",
  "autoRefreshAvatar",
  "avatarRefreshTime",
  "randomDicebearAvatar",
  "dicebearParams",
  "playerTheme"
];

  export async function applySettings(reload = false) {
    const cfgGuard = getConfig();
        let isAdmin = true;
    if (cfgGuard?.forceGlobalUserSettings) {
      isAdmin = await isAdminUser_apply();
    }
        const form = document.querySelector('#settings-modal form');
        if (!form) return;
        const formData = new FormData(form);
        const config = getConfig();
        const oldTheme = getConfig().playerTheme;
        const oldPlayerStyle = getConfig().playerStyle;
        const sapEnabled = formData.get('sapEnabled') === 'on';
        const sapBlurMin = _clamp(
          _floatOr(formData.get('sapBlurMs'), _DEFAULT_UNFOCUS_MS) / 60000,
          0,
          _MAX_MIN
        );

        const sapHiddenMin = _clamp(
          _floatOr(formData.get('sapHiddenMs'), _DEFAULT_OFFSCREEN_MS) / 60000,
          0,
          _MAX_MIN
        );
        const sapIdleMin = _clamp(_floatOr(formData.get('sapIdleMinutes'), _DEFAULT_IDLE_MS/60000), _MIN_MIN, _MAX_MIN);
        const sapUseIdle = formData.get('sapUseIdleDetection') === 'on';
        const sapRespect = formData.get('sapRespectPiP') === 'on';
        const sapIgnoreShort = _intOr(formData.get('sapIgnoreShortUnderSec'), 300);
        const pauseOverlayMinDurMin =
            _clamp(_floatOr(formData.get('pauseOverlayMinVideoMinutes'), 5), 1, _MAX_MIN);
        const boolFromFd = (name, fallback) =>
          (formData.has(name) ? (formData.get(name) === 'on') : (fallback ?? false));
        const updatedConfig = {
            ...config,
            smartAutoPause: {
              enabled: sapEnabled,
              blurMinutes: sapBlurMin,
              hiddenMinutes: sapHiddenMin,
              idleMinutes: sapIdleMin,
              useIdleDetection: sapUseIdle,
              respectPiP: sapRespect,
              ignoreShortUnderSec: sapIgnoreShort
            },
            playerTheme: formData.get('playerTheme'),
            playerStyle: formData.get('playerStyle'),
            defaultLanguage: formData.get('defaultLanguage'),
            dateLocale: formData.get('dateLocale') || 'tr-TR',
            sliderDuration: parseInt(formData.get('sliderDuration'), 10),
            limit: parseInt(formData.get('limit'), 10),
            onlyUnwatchedRandom: formData.get('onlyUnwatchedRandom') === 'on',
            maxShufflingLimit: parseInt(formData.get('maxShufflingLimit'), 10),
            excludeEpisodesFromPlaying: formData.get('excludeEpisodesFromPlaying') === 'on',
            showPlaybackProgress: formData.get('showPlaybackProgress') === 'on',
            playingLimit: parseFloat(formData.get('playingLimit')),
            gecikmeSure: parseInt(formData.get('gecikmeSure'), 10),
            cssVariant: formData.get('cssVariant'),
            useAlbumArtAsBackground: formData.get('useAlbumArtAsBackground') === 'on',
            albumArtBackgroundBlur: parseInt(formData.get('albumArtBackgroundBlur')),
            albumArtBackgroundOpacity: parseFloat(formData.get('albumArtBackgroundOpacity')),
            shuffleSeedLimit: parseInt(formData.get('shuffleSeedLimit'), 10),
            balanceItemTypes: formData.get('balanceItemTypes') === 'on',
            showCast: formData.get('showCast') === 'on',
            showProgressBar: formData.get('showProgressBar') === 'on',
            showProgressAsSeconds: formData.get('showProgressAsSeconds') === 'on',
            enableTrailerPlayback: formData.get('enableTrailerPlayback') === 'on',
            enableVideoPlayback: formData.get('enableVideoPlayback') === 'on',
            gradientOverlayImageType: formData.get('gradientOverlayImageType'),
            manualBackdropSelection: formData.get('manualBackdropSelection') === 'on',
            indexZeroSelection: formData.get('indexZeroSelection') === 'on',
            backdropImageType: formData.get('backdropImageType'),
            minHighQualityWidth: parseInt(formData.get('minHighQualityWidth'), 10),
            backdropMaxWidth: parseInt(formData.get('backdropMaxWidth'), 10),
            minPixelCount: parseInt(formData.get('minPixelCount'), 10),
            enableImageSizeFilter: formData.get('enableImageSizeFilter') === 'on',
            minImageSizeKB: parseInt(formData.get('minImageSizeKB'), 10),
            maxImageSizeKB: parseInt(formData.get('maxImageSizeKB'), 10),
            showDotNavigation: formData.get('showDotNavigation') === 'on',
            dotBackgroundImageType: formData.get('dotBackgroundImageType'),
            dotBackgroundBlur: parseInt(formData.get('dotBackgroundBlur')),
            dotBackgroundOpacity: parseFloat(formData.get('dotBackgroundOpacity')),
            dotPosterMode: formData.get('dotPosterMode') === 'on',
            createAvatar: formData.get('createAvatar') === 'on',
            avatarWidth: parseInt(formData.get('avatarWidth'), 10),
            avatarHeight: parseInt(formData.get('avatarHeight'), 10),
            avatarFontSize: parseInt(formData.get('avatarFontSize'), 10),
            avatarTextShadow: formData.get('avatarTextShadow'),
            avatarColorMethod: formData.get('avatarColorMethod'),
            avatarSolidColor: formData.get('avatarSolidColor'),
            avatarGradient: formData.get('avatarGradient'),
            avatarFontFamily: formData.get('avatarFontFamily') || 'Righteous',
            avatarStyle: formData.get('avatarStyle') || 'dicebear',
            dicebearStyle: formData.get('dicebearStyle') || 'Adventurer',
            dicebearBackgroundColor: formData.get('dicebearBackgroundColor') || 'transparent',
            dicebearRadius: parseInt(formData.get('dicebearRadius'), 10) || 50,
            avatarScale: parseFloat(formData.get('avatarScale')) || 1,
            dicebearBackgroundEnabled: formData.get('dicebearBackgroundEnabled') === 'on',
            dicebearPosition: formData.get('dicebearPosition') === 'on',
            autoRefreshAvatar: formData.get('autoRefreshAvatar') === 'on',
            avatarRefreshTime: parseInt(formData.get('avatarRefreshTime'), 10),
            randomDicebearAvatar: formData.get('randomDicebearAvatar') === 'on',
            dicebearParams: config.dicebearParams || {},
            enableHls: formData.get('enableHls') === 'on',
            previewModal: formData.get('previewModal') === 'on',
            allPreviewModal: formData.get('allPreviewModal') === 'on',
            preferTrailersInPreviewModal: formData.get('preferTrailersInPreviewModal') === 'on',
            onlyTrailerInPreviewModal: formData.get('onlyTrailerInPreviewModal') === 'on',
            dotPreviewPlaybackMode: (() => {
              const v = formData.get('dotPreviewPlaybackMode');
              if (v === 'trailer' || v === 'video' || v === 'onlyTrailer') return v;
              return null;
            })(),
            globalPreviewMode: formData.get('globalPreviewMode') || 'modal',
            enabledGmmp: formData.get('enabledGmmp') === 'on',
            enableQualityBadges: formData.get('enableQualityBadges') === 'on',
            enableTrailerThenVideo: formData.get('enableTrailerThenVideo') === 'on',
            disableAllPlayback: formData.get('disableAllPlayback') === 'on',
            enableSlider: formData.get('enableSlider') === 'on',
            onlyShowSliderOnHomeTab: formData.get('onlyShowSliderOnHomeTab') === 'on',
            enableNotifications: formData.get('enableNotifications') === 'on',
            enableToastNew: formData.get('enableToastNew') === 'on',
            enableToastSystem: formData.get('enableToastSystem') === 'on',
            maxNotifications: parseInt(formData.get('maxNotifications'), 10),
            toastDuration: parseInt(formData.get('toastDuration'), 10),
            renderResume: parseInt(formData.get('renderResume'), 10),
            enableRenderResume: formData.get('enableRenderResume') === 'on',
            toastGroupThreshold: parseInt(formData.get('toastGroupThreshold'), 10),
            enableCounterSystem: formData.get('enableCounterSystem') === 'on',

            enableDirectorRows: formData.get('enableDirectorRows') === 'on',
            directorRowsCount: parseInt(localStorage.getItem("directorRowsCount"), 10) || 4,
            directorRowsMinItemsPerDirector: parseInt(localStorage.getItem("directorRowsMinItemsPerDirector"), 10) || 8,
            directorRowCardCount: parseInt(formData.get('directorRowCardCount'), 10),
            placeDirectorRowsAtBottom: formData.get('placeDirectorRowsAtBottom') === 'on',
            directorRowsUseTopGenres: formData.get('directorRowsUseTopGenres') === 'on',

            becauseYouWatchedRowCount: parseInt(formData.get('becauseYouWatchedRowCount'), 10),
            becauseYouWatchedCardCount: parseInt(formData.get('becauseYouWatchedCardCount'), 10),
            enableBecauseYouWatched: formData.get('enableBecauseYouWatched') === 'on',

            enableLoadingScreen: formData.get('enableLoadingScreen') === 'on',
            loadingScreenSimulateProgress: formData.get('loadingScreenSimulateProgress') === 'on',
            loadingScreenShowTips: formData.get('loadingScreenShowTips') === 'on',
            loadingScreenTipIntervalMs: parseInt(formData.get('loadingScreenTipIntervalMs'), 10) || 6000,

            enableRecentRows: formData.get('enableRecentRows') === 'on',
            enableRecentMoviesRow: (() => {
              const master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentMoviesRow') === 'on';
            })(),
            enableRecentSeriesRow: (() => {
              const master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentSeriesRow') === 'on';
            })(),
            enableRecentEpisodesRow: (() => {
              const master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentEpisodesRow') === 'on';
            })(),

            recentMoviesCardCount: (() => {
              const v = parseInt(formData.get('recentMoviesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentMoviesCardCount) && config.recentMoviesCardCount > 0) return config.recentMoviesCardCount;
            })(),
            recentSeriesCardCount: (() => {
              const v = parseInt(formData.get('recentSeriesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentSeriesCardCount) && config.recentSeriesCardCount > 0) return config.recentSeriesCardCount;
            })(),
            recentEpisodesCardCount: (() => {
              const v = parseInt(formData.get('recentEpisodesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentEpisodesCardCount) && config.recentEpisodesCardCount > 0) return config.recentEpisodesCardCount;
              return 10;
            })(),

            enableContinueMovies: formData.get('enableContinueMovies') === 'on',
            continueMoviesCardCount: parseInt(formData.get('continueMoviesCardCount'), 10) || config.continueMoviesCardCount || 10,
            enableContinueSeries: formData.get('enableContinueSeries') === 'on',
            continueSeriesCardCount: parseInt(formData.get('continueSeriesCardCount'), 10) || config.continueSeriesCardCount || 10,
            enableStudioHubs: formData.get('enableStudioHubs') === 'on',
            enablePersonalRecommendations: formData.get('enablePersonalRecommendations') === 'on',
            personalRecsCacheTtlMs: parseInt(formData.get('personalRecsCacheTtlMs'), 10) || 360,
            studioHubsHoverVideo: formData.get('studioHubsHoverVideo') === 'on',
            placePersonalRecsUnderStudioHubs: formData.get('placePersonalRecsUnderStudioHubs') === 'on',
            placeGenreHubsAbovePersonalRecs: formData.get('placeGenreHubsAbovePersonalRecs') === 'on',
            studioMiniTrailerPopover: formData.get('studioMiniTrailerPopover') === 'on',
            studioHubsMinRating: parseFloat(formData.get('studioHubsMinRating')) || 6.5,
            studioHubsCardCount: parseInt(formData.get('studioHubsCardCount'), 10) || 10,
            personalRecsCardCount: parseInt(formData.get('personalRecsCardCount'), 10) || 9,
            studioHubsOrder: (() => {
              const raw = formData.get('studioHubsOrder');
              if (!raw) return getConfig().studioHubsOrder;
              try {
                const arr = JSON.parse(raw);
                return Array.isArray(arr) && arr.length ? arr : getConfig().studioHubsOrder;
              } catch {
                return getConfig().studioHubsOrder;
              }
            })(),

            enableGenreHubs: formData.get('enableGenreHubs') === 'on',
            studioHubsGenreCardCount: parseInt(formData.get('studioHubsGenreCardCount'), 10) || 10,
            studioHubsGenreRowsCount: parseInt(formData.get('studioHubsGenreRowsCount'), 10) || 3,
            genreHubsOrder: (() => {
              const raw = formData.get('genreHubsOrder');
              if (!raw) return getConfig().genreHubsOrder;
              try {
                const arr = JSON.parse(raw);
                return Array.isArray(arr) && arr.length ? arr : getConfig().genreHubsOrder;
              } catch {
                return getConfig().genreHubsOrder;
              }
            })(),

            showStatusInfo: formData.get('showStatusInfo') === 'on',
            showTypeInfo: formData.get('showTypeInfo') === 'on',
            showWatchedInfo: formData.get('showWatchedInfo') === 'on',
            showRuntimeInfo: formData.get('showRuntimeInfo') === 'on',
            showQualityInfo: formData.get('showQualityInfo') === 'on',
            showQualityDetail: formData.get('showQualityDetail') === 'on',
            showRatingInfo: formData.get('showRatingInfo') === 'on',
            showMatchPercentage: formData.get('showMatchPercentage') === 'on',
            showCommunityRating: formData.get('showCommunityRating') === 'on',
            showCriticRating: formData.get('showCriticRating') === 'on',
            showOfficialRating: formData.get('showOfficialRating') === 'on',

            showActorAll: formData.get('showActorAll') === 'on',
            showActorInfo: formData.get('showActorInfo') === 'on',
            showActorImg: formData.get('showActorImg') === 'on',
            showActorRole: formData.get('showActorRole') === 'on',
            artistLimit: parseInt(formData.get('artistLimit'), 10),

            showDirectorWriter: formData.get('showDirectorWriter') === 'on',
            showDirector: formData.get('showDirector') === 'on',
            showWriter: formData.get('showWriter') === 'on',
            aktifSure: parseInt(formData.get('aktifSure'), 10),
            girisSure: parseInt(formData.get('girisSure'), 10),
            allowedWriters: formData.get('allowedWriters') ?
                formData.get('allowedWriters').split(',').map(w => w.trim()) : [],

            muziklimit: parseInt(formData.get('muziklimit'), 10),
            nextTrack: parseInt(formData.get('nextTrack'), 10) || 30,
            topTrack: parseInt(formData.get('topTrack'), 10) || 100,
            sarkilimit: parseInt(formData.get('sarkilimit'), 10),
            id3limit: parseInt(formData.get('id3limit'), 10),
            albumlimit: parseInt(formData.get('albumlimit'), 10),
            gruplimit: parseInt(formData.get('gruplimit'), 10),
            historylimit: parseInt(formData.get('historylimit'), 10),
            maxExcludeIdsForUri: parseInt(formData.get('maxExcludeIdsForUri'), 10),
            notificationsEnabled: formData.get('notificationsEnabled') === 'on',
            nextTracksSource: formData.get('nextTracksSource'),

            useListFile: formData.get('useListFile') === 'on',
            useManualList: formData.get('useManualList') === 'on',
            manualListIds: formData.get('manualListIds'),
            customQueryString: (() => {
              const raw = formData.get('customQueryString')?.trim();
              if (!raw) {
                return getConfig().customQueryString;
              }
              return raw;
            })(),
            sortingKeywords: (() => {
              const raw = formData.get('sortingKeywords')?.trim();
              if (!raw) {
                return getConfig().sortingKeywords;
              }
              return raw.split(',').map(k => k.trim());
            })(),

            showLanguageInfo: formData.get('showLanguageInfo') === 'on',

            showLogoOrTitle: formData.get('showLogoOrTitle') === 'on',
            displayOrder: formData.get('displayOrder') || 'logo,disk,originalTitle',
            showTitleOnly: formData.get('showTitleOnly') === 'on',
            showDiscOnly: formData.get('showDiscOnly') === 'on',

            showDescriptions: formData.get('showDescriptions') === 'on',
            showSloganInfo: formData.get('showSloganInfo') === 'on',
            showTitleInfo: formData.get('showTitleInfo') === 'on',
            showOriginalTitleInfo: formData.get('showOriginalTitleInfo') === 'on',
            hideOriginalTitleIfSame: formData.get('hideOriginalTitleIfSame') === 'on',
            showPlotInfo: formData.get('showPlotInfo') === 'on',
            showbPlotInfo: formData.get('showbPlotInfo') === 'on',

            showProviderInfo: formData.get('showProviderInfo') === 'on',
            showSettingsLink: formData.get('showSettingsLink') === 'on',
            showTrailerIcon: formData.get('showTrailerIcon') === 'on',

            showTrailerButton: formData.get('showTrailerButton') === 'on',
            trailerBackgroundImageType: formData.get('trailerBackgroundImageType'),
            showWatchButton: formData.get('showWatchButton') === 'on',
            watchBackgroundImageType: formData.get('watchBackgroundImageType'),
            showFavoriteButton: formData.get('showFavoriteButton') === 'on',
            favoriteBackgroundImageType: formData.get('favoriteBackgroundImageType'),
            showPlayedButton: formData.get('showPlayedButton') === 'on',
            playedBackgroundImageType: formData.get('playedBackgroundImageType'),
            buttonBackgroundBlur: parseInt(formData.get('buttonBackgroundBlur')),
            buttonBackgroundOpacity: parseFloat(formData.get('buttonBackgroundOpacity')),

            showInfo: formData.get('showInfo') === 'on',
            showGenresInfo: formData.get('showGenresInfo') === 'on',
            showYearInfo: formData.get('showYearInfo') === 'on',
            showCountryInfo: formData.get('showCountryInfo') === 'on',

            homeSectionsTop: parseInt(formData.get('homeSectionsTop'), 10) || 0,
            slideTop: parseInt(formData.get('slideTop'), 10) || 0,
            slideLeft: parseInt(formData.get('slideLeft'), 10) || 0,
            slideWidth: parseInt(formData.get('slideWidth'), 10) || 0,
            slideHeight: parseInt(formData.get('slideHeight'), 10) || 0,

            logoContainerTop: parseInt(formData.get('logoContainerTop'), 10) || 0,
            logoContainerLeft: parseInt(formData.get('logoContainerLeft'), 10) || 0,
            logoContainerWidth: parseInt(formData.get('logoContainerWidth'), 10) || 0,
            logoContainerHeight: parseInt(formData.get('logoContainerHeight'), 10) || 0,
            logoContainerDisplay: formData.get('logoContainerDisplay'),
            logoContainerFlexDirection: formData.get('logoContainerFlexDirection'),
            logoContainerJustifyContent: formData.get('logoContainerJustifyContent'),
            logoContainerAlignItems: formData.get('logoContainerAlignItems'),
            logoContainerFlexWrap: formData.get('logoContainerFlexWrap'),

            buttonContainerTop: parseInt(formData.get('buttonContainerTop'), 10) || 0,
            buttonContainerLeft: parseInt(formData.get('buttonContainerLeft'), 10) || 0,
            buttonContainerWidth: parseInt(formData.get('buttonContainerWidth'), 10) || 0,
            buttonContainerHeight: parseInt(formData.get('buttonContainerHeight'), 10) || 0,
            buttonContainerDisplay: formData.get('buttonContainerDisplay'),
            buttonContainerFlexDirection: formData.get('buttonContainerFlexDirection'),
            buttonContainerJustifyContent: formData.get('buttonContainerJustifyContent'),
            buttonContainerAlignItems: formData.get('buttonContainerAlignItems'),
            buttonContainerFlexWrap: formData.get('buttonContainerFlexWrap'),

            metaContainerTop: parseInt(formData.get('metaContainerTop'), 10) || 0,
            metaContainerLeft: parseInt(formData.get('metaContainerLeft'), 10) || 0,
            metaContainerWidth: parseInt(formData.get('metaContainerWidth'), 10) || 0,
            metaContainerHeight: parseInt(formData.get('metaContainerHeight'), 10) || 0,
            metaContainerDisplay: formData.get('metaContainerDisplay'),
            metaContainerFlexDirection: formData.get('metaContainerFlexDirection'),
            metaContainerJustifyContent: formData.get('metaContainerJustifyContent'),
            metaContainerAlignItems: formData.get('metaContainerAlignItems'),
            metaContainerFlexWrap: formData.get('metaContainerFlexWrap'),

            plotContainerTop: parseInt(formData.get('plotContainerTop'), 10) || 0,
            plotContainerLeft: parseInt(formData.get('plotContainerLeft'), 10) || 0,
            plotContainerWidth: parseInt(formData.get('plotContainerWidth'), 10) || 0,
            plotContainerHeight: parseInt(formData.get('plotContainerHeight'), 10) || 0,
            plotContainerDisplay: formData.get('plotContainerDisplay'),
            plotContainerFlexDirection: formData.get('plotContainerFlexDirection'),
            plotContainerJustifyContent: formData.get('plotContainerJustifyContent'),
            plotContainerAlignItems: formData.get('plotContainerAlignItems'),
            plotContainerFlexWrap: formData.get('plotContainerFlexWrap'),
            plotContainerFontSize: parseInt(formData.get('plotContainerFontSize'), 10) || 0,
            plotContainerColor: parseInt(formData.get('plotContainerColor'), 10) || 0,

            titleContainerTop: parseInt(formData.get('titleContainerTop'), 10) || 0,
            titleContainerLeft: parseInt(formData.get('titleContainerLeft'), 10) || 0,
            titleContainerWidth: parseInt(formData.get('titleContainerWidth'), 10) || 0,
            titleContainerHeight: parseInt(formData.get('titleContainerHeight'), 10) || 0,
            titleContainerDisplay: formData.get('titleContainerDisplay'),
            titleContainerFlexDirection: formData.get('titleContainerFlexDirection'),
            titleContainerJustifyContent: formData.get('titleContainerJustifyContent'),
            titleContainerAlignItems: formData.get('titleContainerAlignItems'),
            titleContainerFlexWrap: formData.get('titleContainerFlexWrap'),

            directorContainerTop: parseInt(formData.get('directorContainerTop'), 10) || 0,
            directorContainerLeft: parseInt(formData.get('directorContainerLeft'), 10) || 0,
            directorContainerWidth: parseInt(formData.get('directorContainerWidth'), 10) || 0,
            directorContainerHeight: parseInt(formData.get('directorContainerHeight'), 10) || 0,
            directorContainerDisplay: formData.get('directorContainerDisplay'),
            directorContainerFlexDirection: formData.get('directorContainerFlexDirection'),
            directorContainerJustifyContent: formData.get('directorContainerJustifyContent'),
            directorContainerAlignItems: formData.get('directorContainerAlignItems'),
            directorContainerFlexWrap: formData.get('directorContainerFlexWrap'),

            infoContainerTop: parseInt(formData.get('infoContainerTop'), 10) || 0,
            infoContainerLeft: parseInt(formData.get('infoContainerLeft'), 10) || 0,
            infoContainerWidth: parseInt(formData.get('infoContainerWidth'), 10) || 0,
            infoContainerHeight: parseInt(formData.get('infoContainerHeight'), 10) || 0,
            infoContainerDisplay: formData.get('infoContainerDisplay'),
            infoContainerFlexDirection: formData.get('infoContainerFlexDirection'),
            infoContainerJustifyContent: formData.get('infoContainerJustifyContent'),
            infoContainerAlignItems: formData.get('infoContainerAlignItems'),
            infoContainerFlexWrap: formData.get('infoContainerFlexWrap'),

            mainContainerTop: parseInt(formData.get('mainContainerTop'), 10) || 0,
            mainContainerLeft: parseInt(formData.get('mainContainerLeft'), 10) || 0,
            mainContainerWidth: parseInt(formData.get('mainContainerWidth'), 10) || 0,
            mainContainerHeight: parseInt(formData.get('mainContainerHeight'), 10) || 0,
            mainContainerDisplay: formData.get('mainContainerDisplay'),
            mainContainerFlexDirection: formData.get('mainContainerFlexDirection'),
            mainContainerJustifyContent: formData.get('mainContainerJustifyContent'),
            mainContainerAlignItems: formData.get('mainContainerAlignItems'),
            mainContainerFlexWrap: formData.get('mainContainerFlexWrap'),

            sliderContainerTop: parseInt(formData.get('sliderContainerTop'), 10) || 0,
            sliderContainerLeft: parseInt(formData.get('sliderContainerLeft'), 10) || 0,
            sliderContainerWidth: parseInt(formData.get('sliderContainerWidth'), 10) || 0,
            sliderContainerHeight: parseInt(formData.get('sliderContainerHeight'), 10) || 0,
            sliderContainerDisplay: formData.get('sliderContainerDisplay'),
            sliderContainerFlexDirection: formData.get('sliderContainerFlexDirection'),
            sliderContainerJustifyContent: formData.get('sliderContainerJustifyContent'),
            sliderContainerAlignItems: formData.get('sliderContainerAlignItems'),
            sliderContainerFlexWrap: formData.get('sliderContainerFlexWrap'),

            providerContainerTop: parseInt(formData.get('providerContainerTop'), 10) || 0,
            providerContainerLeft: parseInt(formData.get('providerContainerLeft'), 10) || 0,
            providerContainerWidth: parseInt(formData.get('providerContainerWidth'), 10) || 0,
            providerContainerHeight: parseInt(formData.get('providerContainerHeight'), 10) || 0,
            providerContainerDisplay: formData.get('providerContainerDisplay'),
            providerContainerFlexDirection: formData.get('providerContainerFlexDirection'),
            providerContainerJustifyContent: formData.get('providerContainerJustifyContent'),
            providerContainerAlignItems: formData.get('providerContainerAlignItems'),
            providerContainerFlexWrap: formData.get('providerContainerFlexWrap'),

            providericonsContainerTop: parseInt(formData.get('providericonsContainerTop'), 10) || 0,
            providericonsContainerLeft: parseInt(formData.get('providericonsContainerLeft'), 10) || 0,
            providericonsContainerWidth: parseInt(formData.get('providericonsContainerWidth'), 10) || 0,
            providericonsContainerHeight: parseInt(formData.get('providericonsContainerHeight'), 10) || 0,
            providericonsContainerDisplay: formData.get('providericonsContainerDisplay'),
            providericonsContainerFlexDirection: formData.get('providericonsContainerFlexDirection'),
            providericonsContainerJustifyContent: formData.get('providericonsContainerJustifyContent'),
            providericonsContainerAlignItems: formData.get('providericonsContainerAlignItems'),
            providericonsContainerFlexWrap: formData.get('providericonsContainerFlexWrap'),

            statusContainerTop: parseInt(formData.get('statusContainerTop'), 10) || 0,
            statusContainerLeft: parseInt(formData.get('statusContainerLeft'), 10) || 0,
            statusContainerWidth: parseInt(formData.get('statusContainerWidth'), 10) || 0,
            statusContainerHeight: parseInt(formData.get('statusContainerHeight'), 10) || 0,
            statusContainerDisplay: formData.get('statusContainerDisplay'),
            statusContainerFlexDirection: formData.get('statusContainerFlexDirection'),
            statusContainerJustifyContent: formData.get('statusContainerJustifyContent'),
            statusContainerAlignItems: formData.get('statusContainerAlignItems'),
            statusContainerFlexWrap: formData.get('statusContainerFlexWrap'),

            ratingContainerTop: parseInt(formData.get('ratingContainerTop'), 10) || 0,
            ratingContainerLeft: parseInt(formData.get('ratingContainerLeft'), 10) || 0,
            ratingContainerWidth: parseInt(formData.get('ratingContainerWidth'), 10) || 0,
            ratingContainerHeight: parseInt(formData.get('ratingContainerHeight'), 10) || 0,
            ratingContainerDisplay: formData.get('ratingContainerDisplay'),
            ratingContainerFlexDirection: formData.get('ratingContainerFlexDirection'),
            ratingContainerJustifyContent: formData.get('ratingContainerJustifyContent'),
            ratingContainerAlignItems: formData.get('ratingContainerAlignItems'),
            ratingContainerFlexWrap: formData.get('ratingContainerFlexWrap'),

            existingDotContainerTop: parseInt(formData.get('existingDotContainerTop'), 10) || 0,
            existingDotContainerLeft: parseInt(formData.get('existingDotContainerLeft'), 10) || 0,
            existingDotContainerWidth: parseInt(formData.get('existingDotContainerWidth'), 10) || 0,
            existingDotContainerHeight: parseInt(formData.get('existingDotContainerHeight'), 10) || 0,
            existingDotContainerDisplay: formData.get('existingDotContainerDisplay'),
            existingDotContainerFlexDirection: formData.get('existingDotContainerFlexDirection'),
            existingDotContainerJustifyContent: formData.get('existingDotContainerJustifyContent'),
            existingDotContainerAlignItems: formData.get('existingDotContainerAlignItems'),
            existingDotContainerFlexWrap: formData.get('existingDotContainerFlexWrap'),

            progressBarTop: parseInt(formData.get('progressBarTop'), 10) || 0,
            progressBarLeft: parseInt(formData.get('progressBarLeft'), 10) || 0,
            progressBarWidth: parseInt(formData.get('progressBarWidth'), 10) || 100,
            progressBarHeight: parseInt(formData.get('progressBarHeight'), 10) || 0,

            progressSecondsTop: parseInt(formData.get('progressSecondsTop'), 10) || 0,
            progressSecondsLeft: parseInt(formData.get('progressSecondsLeft'), 10) || 0,
            peakDiagonal: formData.get('peakDiagonal') === 'on',
            peakSpanRight: parseInt(formData.get('peakSpanRight'), 10) || 3,
            peakSpanLeft: parseInt(formData.get('peakSpanLeft'), 10) || 3,
            peakGapLeft: parseInt(formData.get('peakGapLeft'), 10) || 80,
            peakGapRight: parseInt(formData.get('peakGapRight'), 10) || 80,
            peakGapY: parseInt(formData.get('peakGapY'), 10) || 0,

            pauseOverlay: {
              enabled: formData.get('pauseOverlay') === 'on',
              imagePreference: formData.get('pauseOverlayImagePreference') || 'auto',
              showPlot: formData.get('pauseOverlayShowPlot') === 'on',
              debug: formData.get('pauseOverlayDebug') === 'on',
              requireWebSocket: formData.get('pauseOverlayRequireWebSocket') === 'on',
              showMetadata: formData.get('pauseOverlayShowMetadata') === 'on',
              showLogo: formData.get('pauseOverlayShowLogo') === 'on',
              closeOnMouseMove: formData.get('pauseOverlayCloseOnMouseMove') === 'on',
              showBackdrop: formData.get('pauseOverlayShowBackdrop') === 'on',
              minVideoMinutes: pauseOverlayMinDurMin,
              showAgeBadge: formData.get('pauseOverlayShowAgeBadge') === 'on',
              ageBadgeDurationMs: Math.max(1000, (parseInt(formData.get('ageBadgeDurationSec'), 10) || 6) * 1000),
              ageBadgeLockMs: Math.max(0, (parseInt(formData.get('ageBadgeLockSec'), 10) || 6) * 1000),
              badgeDelayMs: Math.max(1000, (parseInt(formData.get('badgeDelayMs'), 10) || 5) * 1000),
              badgeDelayResumeMs: Math.max(1000, (parseInt(formData.get('badgeDelayResumeMs'), 10) || 2) * 1000),
              ageBadgeDurationResumeMs: Math.max(1000, (parseInt(formData.get('ageBadgeDurationResumeMs'), 10) || 10) * 1000),
            },
            slideTransitionType: formData.get('slideTransitionType'),
            dotPosterTransitionType: formData.get('dotPosterTransitionType'),
            enableSlideAnimations: formData.get('enableSlideAnimations') === 'on',
            enableDotPosterAnimations: formData.get('enableDotPosterAnimations') === 'on',
            slideAnimationDuration: parseInt(formData.get('slideAnimationDuration'), 10) || 800,
            dotPosterAnimationDuration: parseInt(formData.get('dotPosterAnimationDuration'), 10) || 500,
        };

        try {
          localStorage.setItem('smartAutoPause', JSON.stringify(updatedConfig.smartAutoPause));
          localStorage.setItem('pauseOverlay', JSON.stringify(updatedConfig.pauseOverlay));
        } catch {}

        const toSave =
          (cfgGuard?.forceGlobalUserSettings && !isAdmin)
            ? pick(updatedConfig, USER_ONLY_KEYS)
            : updatedConfig;

        updateConfig(toSave);

        if (!(cfgGuard?.forceGlobalUserSettings && !isAdmin)) {
          publishAdminSnapshotIfForced();
        }
        updateSlidePosition();
        updateHeaderUserAvatar();

        const rawInput = formData.get('sortingKeywords')?.trim();
        if (!rawInput) {
          localStorage.removeItem('sortingKeywords');
        } else {
          localStorage.setItem('sortingKeywords', JSON.stringify(updatedConfig.sortingKeywords));
        }
        if (oldTheme !== updatedConfig.playerTheme || oldPlayerStyle !== updatedConfig.playerStyle) {
        loadCSS();
    }

    if (cfgGuard?.forceGlobalUserSettings && !isAdmin) {
      showNotification(
        `<i class="fas fa-user" style="margin-right:8px;"></i> ${cfgGuard?.languageLabels?.settingsSavedModal || "Avatar/tema ayarların kullanıcıya özel kaydedildi."}`,
        2500,
        "info"
      );
    }

    if (reload) location.reload();

    const avatarSettingsChanged =
        config.createAvatar !== updatedConfig.createAvatar ||
        config.avatarStyle !== updatedConfig.avatarStyle ||
        config.dicebearStyle !== updatedConfig.dicebearStyle ||
        config.dicebearBackgroundColor !== updatedConfig.dicebearBackgroundColor ||
        config.dicebearRadius !== updatedConfig.dicebearRadius ||
        config.avatarScale !== updatedConfig.avatarScale ||
        config.avatarColorMethod !== updatedConfig.avatarColorMethod ||
        config.avatarSolidColor !== updatedConfig.avatarSolidColor ||
        config.avatarFontFamily !== updatedConfig.avatarFontFamily ||
        config.avatarGradient !== updatedConfig.avatarGradient;

    if (avatarSettingsChanged) {
        console.log("Avatar ayarları değişti, hemen güncelleniyor...");
        clearAvatarCache();
        updateHeaderUserAvatar();
    } else {
        updateAvatarStyles();
    }

        if (reload) location.reload();
    }

export function applyRawConfig(config) {
  if (!config || typeof config !== 'object') return;

  Object.entries(config).forEach(([key, value]) => {
    try {
      if (key === 'settings.allowedTabs.v1') return;
      if (typeof value === 'object') {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, String(value));
      }
    } catch (e) {
      console.warn(`'${key}' değeri ayarlanamadı:`, e);
    }
  });

  updateSlidePosition();

  if (config.playerTheme || config.playerStyle) {
    loadCSS?.();
  }

  location.reload();
}
