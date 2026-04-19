import {
  getSessionInfo,
  makeApiRequest,
  fetchItemDetails,
  updateFavoriteStatus,
  getDetailsUrl,
  isCurrentUserAdmin
} from "/Plugins/JMSFusion/runtime/api.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import { getWatchlistButtonText, getWatchlistToast } from "./watchlist.js";
import { resolveSliderAssetHref } from "./assetLinks.js";

const config = getConfig();
const CAST_MODAL_CSS_ID = "jms-css-castmodal";
const CAST_MODAL_SYNC_MS = 4000;
const CAST_MODAL_TICK_MS = 1000;
const VOLUME_COMMIT_DELAY_MS = 180;
const SCROLL_DEBOUNCE_MS = 80;
const CAST_ACCESS_CACHE_MS = 30_000;

let castModalState = null;
let castModalCssPromise = null;
let serverInfoPromise = null;
let supportsWebpCache = null;
let gmmpBridgePromise = null;
let castAccessPromise = null;
let castAccessCache = null;
let castAccessLoadedAt = 0;

function getLiveConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function getLabels() {
  try {
    return getLiveConfig()?.languageLabels || config.languageLabels || {};
  } catch {
    return config.languageLabels || {};
  }
}

function t(key, fallback) {
  return getLabels()?.[key] || fallback;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeSelectorValue(value) {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function joinNonEmpty(values = [], separator = ", ") {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(separator);
}

function isActiveModalState(state) {
  return !!state &&
    castModalState === state &&
    !!state.root?.isConnected &&
    !state.abortController?.signal?.aborted;
}

function isActiveEmbeddedState(state) {
  return !!state &&
    state.kind === "embedded" &&
    !!state.root?.isConnected &&
    !state.abortController?.signal?.aborted;
}

function isMobileClient(session) {
  const client = session.Client?.toLowerCase() || "";
  return ["android", "ios", "iphone", "ipad"].some((term) => client.includes(term));
}

function playable(session) {
  const playableMediaTypes =
    session?.Capabilities?.PlayableMediaTypes ||
    session?.PlayableMediaTypes ||
    [];

  return playableMediaTypes?.some((type) => type === "Video" || type === "Audio") ||
    isMobileClient(session);
}

function isEffectivelyMuted(device) {
  return !!device?.isMuted || Number(device?.volumeLevel ?? 0) <= 0;
}

function formatTime(ticks) {
  if (!ticks || ticks <= 0) return "0:00";

  const totalSeconds = Math.floor(ticks / 10_000_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRemainingTime(positionTicks, runtimeTicks) {
  if (!runtimeTicks || runtimeTicks <= 0) return "";
  const remaining = Math.max(0, runtimeTicks - positionTicks);
  return `-${formatTime(remaining)}`;
}

function normalizeIdentityToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function addIdentityToken(set, value) {
  const normalized = normalizeIdentityToken(value);
  if (!normalized) return;
  set.add(normalized);
}

function getLocalCastAccessFallback() {
  const liveConfig = getLiveConfig();
  const moduleEnabled = liveConfig.enableCastModule !== false;
  const allowSharedViewerForUsers = liveConfig.allowSharedCastViewerForUsers === true;
  const isAdmin = liveConfig.currentUserIsAdmin === true;

  return {
    ok: true,
    moduleEnabled,
    allowSharedViewerForUsers,
    isAdmin,
    canViewShared: moduleEnabled && (isAdmin || allowSharedViewerForUsers),
    canControl: moduleEnabled && isAdmin,
    canAccessModule: moduleEnabled
  };
}

async function getCastRequestUserId() {
  const session = getSessionInfo() || {};
  const directUserId = String(session?.userId || "").trim();
  if (directUserId) {
    return directUserId;
  }

  try {
    const api = window.ApiClient || null;
    const apiUserId = String(
      (typeof api?.getCurrentUserId === "function" ? api.getCurrentUserId() : api?._currentUserId) || ""
    ).trim();
    if (apiUserId) {
      return apiUserId;
    }
  } catch {}

  try {
    const currentUser = await window.ApiClient?.getCurrentUser?.();
    return String(currentUser?.Id || "").trim();
  } catch {
    return "";
  }
}

function getCastRequestToken() {
  const session = getSessionInfo() || {};
  const directToken = String(session?.accessToken || "").trim();
  if (directToken) {
    return directToken;
  }

  try {
    return String(
      window.ApiClient?.accessToken?.() ||
      window.ApiClient?._accessToken ||
      window.ApiClient?._authToken ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

async function makeCastApiRequest(path, options = {}) {
  const userId = await getCastRequestUserId();
  if (!userId) {
    const error = new Error("Cast auth user id missing.");
    error.status = 0;
    throw error;
  }

  const token = getCastRequestToken();
  const headers = {
    Accept: "application/json",
    ...(options?.headers || {})
  };

  headers["X-Emby-UserId"] = userId;
  headers["X-MediaBrowser-UserId"] = userId;

  if (token) {
    headers["X-Emby-Token"] = token;
    headers["X-MediaBrowser-Token"] = token;
  }

  return makeApiRequest(path, {
    ...options,
    headers
  });
}

export async function getCastAccess({ force = false } = {}) {
  const now = Date.now();
  if (!force && castAccessCache && (now - castAccessLoadedAt) < CAST_ACCESS_CACHE_MS) {
    return castAccessCache;
  }

  if (!force && castAccessPromise) {
    return castAccessPromise;
  }

  castAccessPromise = (async () => {
    try {
      const response = await makeCastApiRequest("/Plugins/JMSFusion/cast/access", { __quiet: true });
      const normalized = {
        ...getLocalCastAccessFallback(),
        ...(response && typeof response === "object" ? response : {})
      };

      if (normalized.isAdmin !== true) {
        normalized.isAdmin = await isCurrentUserAdmin().catch(() => normalized.isAdmin === true);
      }

      normalized.moduleEnabled = normalized.moduleEnabled !== false;
      normalized.allowSharedViewerForUsers = normalized.allowSharedViewerForUsers === true;
      normalized.canAccessModule = normalized.moduleEnabled === true;
      normalized.canViewShared = normalized.moduleEnabled === true &&
        (normalized.isAdmin === true || normalized.allowSharedViewerForUsers === true);
      normalized.canControl = normalized.moduleEnabled === true && normalized.isAdmin === true;

      castAccessCache = normalized;
      castAccessLoadedAt = Date.now();
      return normalized;
    } catch {
      const fallback = getLocalCastAccessFallback();
      if (fallback.isAdmin !== true) {
        fallback.isAdmin = await isCurrentUserAdmin().catch(() => false);
        fallback.canViewShared = fallback.moduleEnabled === true &&
          (fallback.isAdmin === true || fallback.allowSharedViewerForUsers === true);
        fallback.canControl = fallback.moduleEnabled === true && fallback.isAdmin === true;
      }
      castAccessCache = fallback;
      castAccessLoadedAt = Date.now();
      return fallback;
    } finally {
      castAccessPromise = null;
    }
  })();

  return castAccessPromise;
}

function looksBase64Value(value) {
  const text = String(value ?? "").trim();
  return text.length >= 16 &&
    /^[A-Za-z0-9+/=]+$/.test(text);
}

function decodePossiblyEncodedLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let decoded = raw;
  if (looksBase64Value(raw) && typeof atob === "function") {
    try {
      decoded = atob(raw);
    } catch {}
  }

  decoded = decoded.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

  if (/[À-ÿ]/.test(decoded) && typeof TextDecoder !== "undefined") {
    try {
      const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0) & 0xff);
      const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
      if (repaired && !repaired.includes("�")) {
        decoded = repaired;
      }
    } catch {}
  }

  const userAgentChunk = decoded
    .split("|")
    .map((part) => part.trim())
    .find((part) => /Mozilla\/|AppleWebKit\/|Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(part));

  return userAgentChunk || decoded;
}

function looksLikeOpaqueIdentifier(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (text.length > 96) return true;
  if (/^[0-9a-f]{12,}$/i.test(text)) return true;
  if (/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)) return true;
  if (looksBase64Value(text)) {
    const decoded = decodePossiblyEncodedLabel(text);
    if (decoded && decoded !== text) return true;
  }
  return false;
}

function looksLikeUserAgent(value) {
  return /Mozilla\/|AppleWebKit\/|Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(String(value ?? ""));
}

function detectBrowserLabel(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/SamsungBrowser\//i.test(text)) return "Samsung Internet";
  if (/EdgA?\/|EdgiOS\//i.test(text)) return "Edge";
  if (/OPR\/|Opera/i.test(text)) return "Opera";
  if (/Firefox\/|FxiOS\//i.test(text)) return "Firefox";
  if (/CriOS\/|Chrome\//i.test(text)) return "Chrome";
  if (/Safari\//i.test(text) && !/Chrome\/|CriOS\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(text)) return "Safari";
  if (/Jellyfin/i.test(text)) return "Jellyfin Web";
  return "";
}

function detectPlatformLabel(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/iPhone/i.test(text)) return "iPhone";
  if (/iPad/i.test(text)) return "iPad";
  if (/Android/i.test(text)) return "Android";
  if (/Windows/i.test(text)) return "Windows";
  if (/Mac OS X|Macintosh|MacIntel/i.test(text)) return "macOS";
  if (/CrOS/i.test(text)) return "ChromeOS";
  if (/Linux/i.test(text)) return "Linux";
  return "";
}

function resolveFriendlySessionClient(session) {
  const self = isCurrentBrowserSession(session);
  const rawClient = String(session?.Client || "").trim();
  const decodedClient = decodePossiblyEncodedLabel(rawClient);
  const selfClientName = String(getSessionInfo()?.clientName || "").trim();
  const browserUserAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const source = [decodedClient, rawClient, self ? browserUserAgent : ""].filter(Boolean).join(" ");
  const browserLabel = detectBrowserLabel(source);
  const isGenericWebClient = /jellyfin\s*web|web client/i.test(rawClient) || /jellyfin\s*web|web client/i.test(selfClientName);

  if (self && browserLabel) {
    return browserLabel;
  }

  if (rawClient && !looksLikeOpaqueIdentifier(rawClient) && !looksLikeUserAgent(rawClient)) {
    return rawClient;
  }

  if (browserLabel) {
    return browserLabel;
  }

  if (selfClientName && (!isGenericWebClient || !browserLabel)) {
    return selfClientName;
  }

  if (decodedClient && decodedClient !== rawClient && !looksLikeUserAgent(decodedClient) && !looksLikeOpaqueIdentifier(decodedClient)) {
    return decodedClient;
  }

  return t("castistemci", "Bilinmeyen istemci");
}

function resolveFriendlySessionDeviceName(session) {
  const self = isCurrentBrowserSession(session);
  const rawDeviceName = String(session?.DeviceName || "").trim();
  const decodedDeviceName = decodePossiblyEncodedLabel(rawDeviceName);
  const clientSource = decodePossiblyEncodedLabel(session?.Client || "");
  const selfDeviceName = String(getSessionInfo()?.deviceName || "").trim();
  const browserUserAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const source = [decodedDeviceName, clientSource, self ? browserUserAgent : ""].filter(Boolean).join(" ");
  const platformLabel = detectPlatformLabel(source);
  const browserLabel = detectBrowserLabel(source);

  if (rawDeviceName && !looksLikeOpaqueIdentifier(rawDeviceName) && !looksLikeUserAgent(rawDeviceName)) {
    return rawDeviceName;
  }

  if (decodedDeviceName && decodedDeviceName !== rawDeviceName && !looksLikeUserAgent(decodedDeviceName) && !looksLikeOpaqueIdentifier(decodedDeviceName)) {
    return decodedDeviceName;
  }

  if (self) {
    if (selfDeviceName && !looksLikeOpaqueIdentifier(selfDeviceName)) {
      return selfDeviceName;
    }
    if (platformLabel && /iPhone|iPad|Android/i.test(platformLabel)) {
      return platformLabel;
    }
    if (browserLabel) {
      return browserLabel;
    }
    if (platformLabel) {
      return `${platformLabel} Tarayici`;
    }
    return "Bu tarayici";
  }

  return platformLabel || browserLabel || t("castcihaz", "Bilinmeyen cihaz");
}

function isAudioLikeItem(item) {
  const type = String(item?.Type || item?.ItemType || "").trim().toLowerCase();
  return type === "audio" ||
    type === "song" ||
    type === "musictrack" ||
    type === "audiobook" ||
    type.includes("audio") ||
    type.includes("music");
}

function buildCurrentBrowserIdentity() {
  const self = getSessionInfo() || {};
  const userIds = new Set();
  const sessionIds = new Set();
  const deviceIds = new Set();
  const clientHints = new Set();
  const deviceHints = new Set();
  const browserHints = new Set();

  addIdentityToken(userIds, self?.userId);
  addIdentityToken(sessionIds, self?.sessionId);
  addIdentityToken(deviceIds, self?.deviceId);

  try {
    addIdentityToken(sessionIds, window.ApiClient?._sessionId);
    addIdentityToken(deviceIds, window.ApiClient?._deviceId);
  } catch {}

  [self?.clientName, detectBrowserLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((value) => clientHints.add(value));

  [self?.deviceName, detectPlatformLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((value) => deviceHints.add(value));

  [detectBrowserLabel(typeof navigator !== "undefined" ? navigator.userAgent : ""), detectPlatformLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((value) => browserHints.add(value));

  return {
    userIds,
    sessionIds,
    deviceIds,
    clientHints,
    deviceHints,
    browserHints
  };
}

function scoreLikelyCurrentGmmpSession(session, gmmpState, currentUserId = "") {
  const gmmpTrackId = String(gmmpState?.trackId || "").trim();
  const sessionTrackId = getSessionNowPlayingItemId(session);
  if (!gmmpState?.hasCurrentTrack || !gmmpTrackId || !sessionTrackId || gmmpTrackId !== sessionTrackId) {
    return 0;
  }

  const normalizedCurrentUserId = normalizeIdentityToken(currentUserId);
  const normalizedSessionUserId = normalizeIdentityToken(session?.UserId);
  if (normalizedCurrentUserId && normalizedSessionUserId && normalizedCurrentUserId !== normalizedSessionUserId) {
    return 0;
  }

  let score = 260;
  if (isAudioLikeItem(session?.NowPlayingItem)) {
    score += 80;
  }

  const sessionPositionTicks = Number(session?.PlayState?.PositionTicks || 0);
  const gmmpPositionTicks = Number(gmmpState?.positionTicks || 0);
  if (sessionPositionTicks > 0 && gmmpPositionTicks > 0) {
    const deltaSeconds = Math.abs(sessionPositionTicks - gmmpPositionTicks) / 10_000_000;
    if (deltaSeconds <= 5) {
      score += 170;
    } else if (deltaSeconds <= 15) {
      score += 120;
    } else if (deltaSeconds <= 30) {
      score += 70;
    }
  }

  if (session?.SupportsRemoteControl !== false) {
    score += 10;
  }

  return score;
}

function scoreCurrentBrowserSessionCandidate(
  session,
  identity = buildCurrentBrowserIdentity(),
  gmmpState = null,
  currentUserId = ""
) {
  let score = 0;
  const sessionId = normalizeIdentityToken(session?.Id);
  const deviceId = normalizeIdentityToken(session?.DeviceId);
  const userId = normalizeIdentityToken(session?.UserId);
  const rawClient = String(session?.Client || "").trim().toLowerCase();
  const decodedClient = decodePossiblyEncodedLabel(session?.Client || "").toLowerCase();
  const rawDeviceName = String(session?.DeviceName || "").trim().toLowerCase();
  const decodedDeviceName = decodePossiblyEncodedLabel(session?.DeviceName || "").toLowerCase();
  const haystack = [rawClient, decodedClient, rawDeviceName, decodedDeviceName].filter(Boolean).join(" ");

  if (sessionId && identity.sessionIds.has(sessionId)) score += 1200;
  if (deviceId && identity.deviceIds.has(deviceId)) score += 1000;
  if (userId && identity.userIds.has(userId)) score += 220;

  if (haystack) {
    if ([...identity.clientHints].some((hint) => hint && haystack.includes(hint))) score += 80;
    if ([...identity.deviceHints].some((hint) => hint && haystack.includes(hint))) score += 120;
    if ([...identity.browserHints].some((hint) => hint && haystack.includes(hint))) score += 50;
  }

  score += scoreLikelyCurrentGmmpSession(session, gmmpState, currentUserId);

  if (session?.SupportsRemoteControl !== false) score += 6;
  return score;
}

function resolveCurrentBrowserSessionId(sessions = [], gmmpState = null) {
  const identity = buildCurrentBrowserIdentity();
  const currentUserId = String(getSessionInfo()?.userId || "").trim();
  const ranked = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.Id)
    .map((session) => ({
      session,
      score: scoreCurrentBrowserSessionCandidate(session, identity, gmmpState, currentUserId)
    }))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return "";

  const best = ranked[0];
  const bestSessionId = normalizeIdentityToken(best.session?.Id);
  const bestDeviceId = normalizeIdentityToken(best.session?.DeviceId);
  const hasHardMatch =
    (bestSessionId && identity.sessionIds.has(bestSessionId)) ||
    (bestDeviceId && identity.deviceIds.has(bestDeviceId));

  if (hasHardMatch) return String(best.session?.Id || "");
  return best.score >= 300 ? String(best.session?.Id || "") : "";
}

function isCurrentBrowserSession(session, gmmpState = null) {
  return scoreCurrentBrowserSessionCandidate(
    session,
    buildCurrentBrowserIdentity(),
    gmmpState,
    String(getSessionInfo()?.userId || "").trim()
  ) >= 300;
}

function getWindowGmmpBridge() {
  try {
    const gmmp = typeof window !== "undefined" ? window.__GMMP : null;
    if (!gmmp) return null;

    const hasState = typeof gmmp.getPlaybackState === "function";
    const hasControls =
      typeof gmmp.setPaused === "function" &&
      typeof gmmp.setMuted === "function" &&
      typeof gmmp.setVolume === "function";

    if (!hasState || !hasControls) {
      return null;
    }

    return {
      getState() {
        return gmmp.getPlaybackState();
      },
      setPaused(paused) {
        return gmmp.setPaused(paused);
      },
      setMuted(muted) {
        return gmmp.setMuted(muted);
      },
      setVolume(volumeLevel) {
        return gmmp.setVolume(volumeLevel);
      }
    };
  } catch {
    return null;
  }
}

async function getGmmpBridge() {
  const globalBridge = getWindowGmmpBridge();
  if (globalBridge) {
    return globalBridge;
  }

  if (gmmpBridgePromise) {
    return gmmpBridgePromise;
  }

  gmmpBridgePromise = Promise.all([
    import("./player/core/state.js"),
    import("./player/player/playback.js").catch(() => null),
    import("./player/ui/controls.js").catch(() => null),
    import("./player/main.js").catch(() => null)
  ])
    .then(async ([stateMod, playbackMod, controlsMod, mainMod]) => {
      const { musicPlayerState, saveUserSettings } = stateMod || {};
      if (!musicPlayerState?.audio) {
        return null;
      }

      try {
        await mainMod?.ensureGmmpInit?.({ show: false });
      } catch {}

      const settle = (ms = 60) => new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });

      return {
        getState() {
          const audio = musicPlayerState.audio;
          const track = musicPlayerState.currentTrack || musicPlayerState.playlist?.[musicPlayerState.currentIndex] || null;
          const runtimeSeconds = Number.isFinite(audio?.duration) && audio.duration > 0
            ? audio.duration
            : (Number.isFinite(musicPlayerState.currentTrackDuration) ? musicPlayerState.currentTrackDuration : 0);
          const currentVolume = clamp(
            Math.round((audio?.muted ? 0 : Number(audio?.volume ?? musicPlayerState.userSettings?.volume ?? 0)) * 100),
            0,
            100
          );

          return {
            hasCurrentTrack: !!track,
            trackId: track?.Id ? String(track.Id) : "",
            isPaused: !!audio?.paused,
            isMuted: !!audio?.muted || currentVolume <= 0,
            volumeLevel: currentVolume,
            positionTicks: Math.max(0, Math.floor(Number(audio?.currentTime || 0) * 10_000_000)),
            runtimeTicks: Math.max(0, Math.floor(Number(runtimeSeconds || 0) * 10_000_000)),
            isLiveStream: !!musicPlayerState.isLiveStream
          };
        },
        async setPaused(paused) {
          const audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          if (!!audio.paused !== !!paused) {
            if (typeof playbackMod?.togglePlayPause === "function") {
              playbackMod.togglePlayPause();
              await settle(paused ? 20 : 80);
            }

            if (!!audio.paused !== !!paused) {
              if (paused) {
                audio.pause();
              } else {
                await audio.play();
              }
            }
          }

          try {
            if ("mediaSession" in navigator) {
              navigator.mediaSession.playbackState = paused ? "paused" : "playing";
            }
          } catch {}

          return this.getState();
        },
        setMuted(muted) {
          const audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          const nextMuted = !!muted;
          if (!nextMuted && Number(audio.volume || 0) <= 0) {
            const restored = clamp(
              Math.round(Number(musicPlayerState.userSettings?.volume ?? 0.7) * 100),
              1,
              100
            ) / 100;
            audio.volume = restored;
            if (musicPlayerState.userSettings) {
              musicPlayerState.userSettings.volume = restored;
            }
          }

          if (!!audio.muted !== nextMuted && typeof controlsMod?.toggleMute === "function") {
            controlsMod.toggleMute();
          }
          if (!!audio.muted !== nextMuted) {
            audio.muted = nextMuted;
          }

          if (musicPlayerState.volumeSlider) {
            try {
              musicPlayerState.volumeSlider.value = String(nextMuted ? 0 : Number(audio.volume || 0));
            } catch {}
          }

          try {
            controlsMod?.updateVolumeIcon?.(nextMuted ? 0 : Number(audio.volume || 0));
          } catch {}

          try { saveUserSettings?.(); } catch {}
          return this.getState();
        },
        setVolume(volumeLevel) {
          const audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          const normalized = clamp(volumeLevel, 0, 100) / 100;
          audio.volume = normalized;
          audio.muted = normalized <= 0 ? true : false;

          if (musicPlayerState.userSettings) {
            musicPlayerState.userSettings.volume = normalized;
          }

          if (musicPlayerState.volumeSlider) {
            try {
              musicPlayerState.volumeSlider.value = String(normalized);
            } catch {}
          }

          try {
            controlsMod?.updateVolumeIcon?.(normalized);
          } catch {}

          try { saveUserSettings?.(); } catch {}
          return this.getState();
        }
      };
    })
    .catch((error) => {
      console.warn("GMMP bridge yüklenemedi:", error);
      gmmpBridgePromise = null;
      return null;
    });

  return gmmpBridgePromise;
}

async function getGmmpPlaybackSnapshot() {
  const bridge = await getGmmpBridge();
  return bridge?.getState?.() || null;
}

async function refreshDeviceControlMode(device, { signal } = {}) {
  if (!device) {
    return { gmmpState: null, controlMode: "session" };
  }

  const gmmpState = await getGmmpPlaybackSnapshot();
  let localSessionId = "";

  try {
    const sessions = await fetchVisiblePlaybackSessions({ signal });
    if (Array.isArray(sessions) && sessions.length) {
      localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
      const freshSession = sessions.find((session) =>
        normalizeIdentityToken(session?.Id) === normalizeIdentityToken(device.sessionId)
      );
      if (freshSession) {
        device.session = freshSession;
      }
    }
  } catch {}

  syncDeviceControlMode(device, device.session, gmmpState, localSessionId);
  return {
    gmmpState,
    controlMode: device.controlMode || "session"
  };
}

function isMatchingGmmpTrack(deviceOrSession, gmmpState) {
  const gmmpTrackId = String(gmmpState?.trackId || "").trim();
  const targetItemId = String(
    deviceOrSession?.itemId ||
    deviceOrSession?.item?.Id ||
    deviceOrSession?.NowPlayingItem?.Id ||
    ""
  ).trim();

  return !gmmpTrackId || !targetItemId || gmmpTrackId === targetItemId;
}

function applyGmmpStateToDevice(device, gmmpState) {
  if (!device || !gmmpState) return false;

  const volumeLevel = clamp(gmmpState.volumeLevel ?? device.volumeLevel, 0, 100);
  device.controlMode = "gmmp";
  device.isPaused = !!gmmpState.isPaused;
  device.confirmedIsPaused = device.isPaused;
  device.isMuted = !!gmmpState.isMuted;
  device.confirmedIsMuted = device.isMuted;
  device.volumeLevel = volumeLevel;
  device.confirmedVolumeLevel = volumeLevel;

  if (gmmpState.positionTicks >= 0) {
    device.positionTicks = gmmpState.positionTicks;
  }
  if (gmmpState.runtimeTicks > 0) {
    device.runtimeTicks = gmmpState.runtimeTicks;
  }
  if (volumeLevel > 0) {
    device.lastNonZeroVolume = volumeLevel;
  }

  return true;
}

function syncDeviceControlMode(device, session, gmmpState, localSessionId = "") {
  const effectiveSession = session || device?.session;
  const isLocalSession = localSessionId
    ? normalizeIdentityToken(effectiveSession?.Id) === normalizeIdentityToken(localSessionId)
    : isCurrentBrowserSession(effectiveSession, gmmpState);
  const gmmpConfidenceScore = scoreLikelyCurrentGmmpSession(
    effectiveSession,
    gmmpState,
    String(getSessionInfo()?.userId || "").trim()
  );
  const preserveExistingGmmpMode = device?.controlMode === "gmmp" &&
    !!gmmpState?.hasCurrentTrack &&
    !gmmpState?.isLiveStream &&
    isMatchingGmmpTrack(device || session, gmmpState);
  const shouldUseGmmp = preserveExistingGmmpMode || (
    !!gmmpState?.hasCurrentTrack &&
    !gmmpState?.isLiveStream &&
    isLocalSession &&
    isMatchingGmmpTrack(device || session, gmmpState) &&
    (
      isAudioLikeItem(effectiveSession?.NowPlayingItem || device?.item) ||
      gmmpConfidenceScore >= 260
    )
  );

  if (shouldUseGmmp) {
    return applyGmmpStateToDevice(device, gmmpState);
  }

  device.controlMode = "session";
  return false;
}

function preserveLocalGmmpDeviceState(state, gmmpState) {
  if (!gmmpState?.hasCurrentTrack) return false;

  let preserved = false;
  state.devices.forEach((device) => {
    const isMatch = device.controlMode === "gmmp" && isMatchingGmmpTrack(device, gmmpState);
    if (!isMatch) return;
    preserved = applyGmmpStateToDevice(device, gmmpState) || preserved;
  });

  return preserved;
}

async function setGmmpPausedState(paused) {
  const bridge = await getGmmpBridge();
  if (!bridge?.setPaused) {
    throw new Error("GMMP kontrolu hazir degil");
  }
  return bridge.setPaused(paused);
}

async function setGmmpMutedState(muted) {
  const bridge = await getGmmpBridge();
  if (!bridge?.setMuted) {
    throw new Error("GMMP kontrolu hazir degil");
  }
  return bridge.setMuted(muted);
}

async function setGmmpVolumeLevel(volumeLevel) {
  const bridge = await getGmmpBridge();
  if (!bridge?.setVolume) {
    throw new Error("GMMP kontrolu hazir degil");
  }
  return bridge.setVolume(volumeLevel);
}

function supportsWebP() {
  if (supportsWebpCache !== null) {
    return supportsWebpCache;
  }

  try {
    supportsWebpCache = document.createElement("canvas").toDataURL("image/webp").includes("webp");
  } catch {
    supportsWebpCache = false;
  }

  return supportsWebpCache;
}

function ensureCastModalCss() {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const existing = document.getElementById(CAST_MODAL_CSS_ID);
  if (existing) {
    return Promise.resolve();
  }

  if (castModalCssPromise) {
    return castModalCssPromise;
  }

  castModalCssPromise = new Promise((resolve) => {
    const link = document.createElement("link");
    link.id = CAST_MODAL_CSS_ID;
    link.rel = "stylesheet";
    link.href = resolveSliderAssetHref("/slider/src/castmodal.css");
    try {
      link.fetchPriority = "high";
    } catch {}
    link.setAttribute("fetchpriority", "high");
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  return castModalCssPromise;
}

async function fetchSessionsForCurrentUser({ signal } = {}) {
  const { userId } = getSessionInfo();
  const sessions = await makeApiRequest(`/Sessions?userId=${encodeURIComponent(userId)}`, { signal });
  return Array.isArray(sessions) ? sessions : [];
}

async function fetchVisiblePlaybackSessions({ signal } = {}) {
  const access = await getCastAccess();
  if (access?.canAccessModule !== true) {
    return [];
  }

  try {
    const response = await makeCastApiRequest("/Plugins/JMSFusion/cast/sessions", {
      signal,
      __quiet: true
    });
    const sessions = Array.isArray(response?.items)
      ? response.items
      : (Array.isArray(response) ? response : []);
    return sessions.filter((session) =>
      playable(session) && (getSessionNowPlayingItemId(session) || String(session?.NowPlayingItemName || "").trim())
    );
  } catch {
    const sessions = await fetchSessionsForCurrentUser({ signal }).catch(() => []);
    return sessions.filter((session) =>
      playable(session) && (getSessionNowPlayingItemId(session) || String(session?.NowPlayingItem?.Name || "").trim())
    );
  }
}

function getSessionSignature(sessions = []) {
  return sessions
    .map((session) => `${session.Id}:${getSessionNowPlayingItemId(session)}`)
    .sort()
    .join("|");
}

function renderIcon(iconClass) {
  return `<i class="fa-solid ${iconClass}"></i>`;
}

function renderButtonLabel(iconClass, label, extraClass = "") {
  return `${renderIcon(iconClass)}<span${extraClass ? ` class="${extraClass}"` : ""}>${escapeHtml(label)}</span>`;
}

function getPlaybackButtonContent(device) {
  return device.isPaused
    ? renderButtonLabel("fa-play", t("devamet", "Devam Ettir"))
    : renderButtonLabel("fa-pause", t("duraklat", "Duraklat"));
}

function getMuteButtonContent(device) {
  return isEffectivelyMuted(device)
    ? renderButtonLabel("fa-volume-high", t("sesac", "Ses Aç"))
    : renderButtonLabel("fa-volume-xmark", t("seskapat", "Sesi Kapat"));
}

function getFavoriteButtonContent(device) {
  const label = getWatchlistButtonText(device.itemDetails || device.item, !!device.isFavorite);
  return renderButtonLabel("fa-heart", label);
}

function getMediaTypeText(item) {
  return item?.Type || item?.ItemType || "";
}

function getItemId(item) {
  return String(item?.Id || item?.ItemId || item?.id || "").trim();
}

function getSessionNowPlayingItemId(session) {
  return getItemId(session?.NowPlayingItem) || String(session?.NowPlayingItemId || "").trim();
}

function normalizeNowPlayingItem(rawItem, session = null, fallbackItem = null) {
  const source = rawItem && typeof rawItem === "object" ? rawItem : {};
  const fallback = fallbackItem && typeof fallbackItem === "object" ? fallbackItem : {};
  const itemId = getItemId(source) || getItemId(fallback) || String(session?.NowPlayingItemId || "").trim();
  const itemType = String(
    source?.Type ||
    source?.ItemType ||
    fallback?.Type ||
    fallback?.ItemType ||
    session?.NowPlayingItemType ||
    ""
  ).trim();
  const itemName = String(
    source?.Name ||
    source?.Title ||
    fallback?.Name ||
    fallback?.Title ||
    session?.NowPlayingItemName ||
    ""
  ).trim();

  return {
    ...fallback,
    ...source,
    Id: itemId,
    ItemId: itemId || String(source?.ItemId || fallback?.ItemId || "").trim(),
    Name: itemName,
    Type: itemType,
    ItemType: String(source?.ItemType || fallback?.ItemType || itemType).trim(),
    ImageTags: (source?.ImageTags && typeof source.ImageTags === "object")
      ? source.ImageTags
      : ((fallback?.ImageTags && typeof fallback.ImageTags === "object") ? fallback.ImageTags : {}),
    ProviderIds: (source?.ProviderIds && typeof source.ProviderIds === "object")
      ? source.ProviderIds
      : ((fallback?.ProviderIds && typeof fallback.ProviderIds === "object") ? fallback.ProviderIds : {})
  };
}

function getHighResImageUrls(item) {
  const itemId = getItemId(item);
  if (!itemId) {
    return {
      posterUrl: "",
      backdropUrl: "",
      placeholderUrl: ""
    };
  }
  const imageTag = item?.ImageTags?.Primary || item?.PrimaryImageTag || "";
  const backdropTag =
    item?.ImageTags?.Backdrop?.[0] ||
    item?.BackdropImageTags?.[0] ||
    item?.ParentBackdropImageTags?.[0] ||
    "";
  const backdropItemId = String(item?.ParentBackdropItemId || itemId).trim() || itemId;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const posterHeight = Math.min(Math.round(420 * pixelRatio), 640);
  const backdropWidth = Math.min(Math.round((window.innerWidth || 1280) * pixelRatio), 1600);
  const formatParam = supportsWebP() ? "&format=webp" : "";

  const primaryPath = `/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&quality=85&maxHeight=${posterHeight}${formatParam}`;
  const fallbackBackdropPath = `/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&quality=75&maxHeight=900${formatParam}`;
  const backdropPath = backdropTag
    ? `/Items/${encodeURIComponent(backdropItemId)}/Images/Backdrop/0?tag=${encodeURIComponent(backdropTag)}&quality=80&maxWidth=${backdropWidth}${formatParam}`
    : fallbackBackdropPath;

  return {
    posterUrl: withServer(primaryPath),
    backdropUrl: withServer(backdropPath),
    placeholderUrl: withServer(`/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&maxHeight=80&blur=12`)
  };
}

function buildInfoCards(device) {
  const cards = [
    { label: t("kullanici", "Kullanıcı"), value: device.user },
    { label: t("cihaz", "Cihaz"), value: device.deviceName },
    { label: t("istemci", "İstemci"), value: device.client },
    { label: t("year", "Yıl"), value: device.year },
    { label: t("yonetmen", "Yönetmen"), value: device.directors },
    { label: t("sortArtist", "Sanatçı"), value: device.artists },
    { label: t("sortAlbum", "Albüm"), value: device.album },
    { label: t("sortAlbumArtist", "Albüm Sanatçısı"), value: device.albumArtist },
    { label: t("tracknumber", "Parça Numarası"), value: device.trackNumber }
  ];

  return cards.filter((card) => String(card.value || "").trim());
}

function buildTagGroups(device) {
  const groups = [
    { title: t("etiketler", "Türler"), value: device.genres },
    { title: t("ses", "Ses"), value: device.audioLanguages },
    { title: t("altyazi", "Altyazı"), value: device.subtitleLanguages }
  ];

  return groups.filter((group) => String(group.value || "").trim());
}

function buildLinkButtons(device) {
  const links = [];

  if (device.itemPageUrl) {
    links.push({
      href: device.itemPageUrl,
      label: t("yenisekme", "Yeni sekmede aç"),
      icon: "fa-up-right-from-square"
    });
  }

  if (device.tmdbId) {
    links.push({
      href: `https://www.themoviedb.org/${device.item.Type === "Episode" || device.item.Type === "Series" ? "tv" : "movie"}/${encodeURIComponent(device.tmdbId)}`,
      label: "TMDB",
      icon: "fa-film"
    });
  }

  if (device.imdbId) {
    links.push({
      href: `https://www.imdb.com/title/${encodeURIComponent(device.imdbId)}`,
      label: "IMDb",
      icon: "fa-star"
    });
  }

  return links;
}

function buildDeviceModel(session, itemDetails, access = null) {
  const item = normalizeNowPlayingItem(session.NowPlayingItem, session);
  const details = itemDetails
    ? normalizeNowPlayingItem(itemDetails, session, item)
    : item;
  const imageSource = getItemId(details) ? details : item;
  const { posterUrl, backdropUrl, placeholderUrl } = getHighResImageUrls(imageSource);
  const positionTicks = session.PlayState?.PositionTicks || 0;
  const runtimeTicks = details.RunTimeTicks || item.RunTimeTicks || 0;
  const volumeLevel = clamp(session.PlayState?.VolumeLevel ?? 50, 0, 100);
  const isMuted = !!session.PlayState?.IsMuted;
  const clientLabel = resolveFriendlySessionClient(session);
  const deviceLabel = resolveFriendlySessionDeviceName(session);
  const itemId = getItemId(details) || getItemId(item);

  const device = {
    sessionId: session.Id,
    itemId,
    session,
    item,
    itemDetails: details,
    title: details.Name || item.Name || t("castoynatiliyor", "Şu an oynatılıyor"),
    mediaIconClass: getMediaIconClass(details),
    mediaTypeText: getMediaTypeText(details),
    posterUrl,
    backdropUrl,
    placeholderUrl,
    user: session.UserName || t("belirsizkullanici", "Bilinmeyen kullanıcı"),
    client: clientLabel,
    deviceName: deviceLabel,
    year: details.ProductionYear || "",
    directors: joinNonEmpty(
      details.People?.filter((person) => person.Type?.toLowerCase() === "director").map((person) => person.Name) || []
    ),
    overview: details.Overview || "",
    genres: joinNonEmpty(details.Genres || []),
    audioLanguages: joinNonEmpty(
      details.MediaStreams?.filter((stream) => stream.Type === "Audio").map((stream) => stream.Language) || []
    ),
    subtitleLanguages: joinNonEmpty(
      details.MediaStreams?.filter((stream) => stream.Type === "Subtitle").map((stream) => stream.Language) || []
    ),
    artists: joinNonEmpty(details.Artists || []),
    album: details.Album || "",
    albumArtist: details.AlbumArtist || "",
    trackNumber: details.IndexNumber || "",
    communityRating: details.CommunityRating ? details.CommunityRating.toFixed(1) : "",
    officialRating: details.OfficialRating || "",
    tmdbId: details.ProviderIds?.Tmdb || "",
    imdbId: details.ProviderIds?.Imdb || "",
    itemPageUrl: itemId ? getDetailsUrl(itemId) : "",
    isPaused: !!session.PlayState?.IsPaused,
    confirmedIsPaused: !!session.PlayState?.IsPaused,
    isMuted,
    confirmedIsMuted: isMuted,
    volumeLevel,
    confirmedVolumeLevel: volumeLevel,
    lastNonZeroVolume: volumeLevel > 0 ? volumeLevel : 50,
    controlMode: "session",
    isFavorite: !!details.UserData?.IsFavorite,
    positionTicks,
    runtimeTicks,
    lastSyncedAt: Date.now(),
    canControl: access?.canControl === true
  };

  return device;
}

async function buildDeviceModels(sessions = [], access = null) {
  const detailPromises = new Map();
  const gmmpState = await getGmmpPlaybackSnapshot();
  const localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
  const getDetails = (itemId) => {
    if (!itemId) return Promise.resolve(null);
    if (!detailPromises.has(itemId)) {
      detailPromises.set(itemId, fetchItemDetails(itemId).catch(() => null));
    }
    return detailPromises.get(itemId);
  };

  return Promise.all(
    sessions.map(async (session) => {
      const details = await getDetails(getSessionNowPlayingItemId(session));
      const device = buildDeviceModel(session, details, access);
      syncDeviceControlMode(device, session, gmmpState, localSessionId);
      return device;
    })
  );
}

function renderMetricChips(device) {
  const chips = [];

  if (device.mediaTypeText) {
    chips.push(`
      <span class="jms-cast-chip jms-cast-chip--ghost">
        ${renderIcon(device.mediaIconClass)}
        <span>${escapeHtml(device.mediaTypeText)}</span>
      </span>
    `);
  }

  if (device.year) {
    chips.push(`<span class="jms-cast-chip">${escapeHtml(device.year)}</span>`);
  }

  if (device.communityRating) {
    chips.push(`
      <span class="jms-cast-chip jms-cast-chip--rating">
        ${renderIcon("fa-star")}
        <span>${escapeHtml(device.communityRating)}</span>
      </span>
    `);
  }

  if (device.officialRating) {
    chips.push(`
      <span class="jms-cast-chip jms-cast-chip--ghost">
        ${renderIcon("fa-certificate")}
        <span>${escapeHtml(device.officialRating)}</span>
      </span>
    `);
  }

  return chips.join("");
}

function renderInfoCardsHtml(device) {
  return buildInfoCards(device)
    .map(
      (card) => `
        <div class="jms-cast-info-card">
          <span class="jms-cast-info-card__label">${escapeHtml(card.label)}</span>
          <strong class="jms-cast-info-card__value">${escapeHtml(card.value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderTagGroupsHtml(device) {
  return buildTagGroups(device)
    .map(
      (group) => `
        <div class="jms-cast-tag-group">
          <span class="jms-cast-tag-group__title">${escapeHtml(group.title)}</span>
          <div class="jms-cast-tag-group__body">${escapeHtml(group.value)}</div>
        </div>
      `
    )
    .join("");
}

function renderLinkButtonsHtml(device) {
  return buildLinkButtons(device)
    .map(
      (link) => `
        <a class="jms-cast-link-button" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
          ${renderIcon(link.icon)}
          <span>${escapeHtml(link.label)}</span>
        </a>
      `
    )
    .join("");
}

function isReadOnlyDevice(device) {
  return device?.canControl !== true;
}

function renderDisabledAttr(disabled) {
  return disabled ? ' disabled aria-disabled="true"' : "";
}

function renderViewerBadge(userName) {
  if (!String(userName || "").trim()) return "";
  return `<span class="jms-cast-viewer-badge">${escapeHtml(userName)}</span>`;
}

function renderPosterMarkup(device) {
  if (device.posterUrl) {
    return `
      <img
        class="jms-cast-slide__poster"
        src="${escapeHtml(device.posterUrl)}"
        alt="${escapeHtml(device.title)}"
        loading="lazy"
        decoding="async"
      />
    `;
  }

  return `
    <div class="jms-cast-slide__poster jms-cast-slide__poster--placeholder" aria-hidden="true">
      ${renderIcon(device.mediaIconClass)}
    </div>
  `;
}

function renderVolumeControl(device) {
  const volume = clamp(device.volumeLevel, 0, 100);
  const disabled = isReadOnlyDevice(device);
  return `
    <div class="jms-cast-volume" data-session-id="${escapeHtml(device.sessionId)}">
      <div class="jms-cast-volume__row">
        <button
          type="button"
          class="jms-cast-action jms-cast-action--secondary"
          data-action="mute"
          data-session-id="${escapeHtml(device.sessionId)}"
          ${renderDisabledAttr(disabled)}
        >
          ${getMuteButtonContent(device)}
        </button>
        <span class="jms-cast-volume__value" data-role="volume-value">${volume}%</span>
      </div>
      <input
        class="jms-cast-volume__slider"
        type="range"
        min="0"
        max="100"
        value="${volume}"
        data-session-id="${escapeHtml(device.sessionId)}"
        aria-label="${escapeHtml(t("ses", "Ses"))}"
        ${renderDisabledAttr(disabled)}
      />
    </div>
  `;
}

function renderServerSection() {
  return `
    <section class="jms-cast-server">
      <button
        type="button"
        class="jms-cast-server__toggle"
        data-action="server-toggle"
        aria-expanded="false"
      >
        <span class="jms-cast-server__toggle-label">
          ${renderIcon("fa-server")}
          <span>${escapeHtml(t("sunucubilgi", "Sunucu Bilgisi"))}</span>
        </span>
        ${renderIcon("fa-chevron-down")}
      </button>
      <div class="jms-cast-server__panel" data-role="server-panel" hidden></div>
    </section>
  `;
}

function renderSlide(device, index, options = {}) {
  const compact = options.compact === true;
  const clickableHero = options.clickableHero === true;
  const progressPercent = device.runtimeTicks > 0
    ? clamp((device.positionTicks / device.runtimeTicks) * 100, 0, 100)
    : 0;
  const disabled = isReadOnlyDevice(device);
  const compactMeta = [device.mediaTypeText, device.client, device.deviceName].filter(Boolean).join(" • ");
  const heroAttrs = [
    `class="jms-cast-slide__hero${clickableHero ? " is-clickable" : ""}"`
  ];

  if (clickableHero) {
    heroAttrs.push(`data-action="open-modal"`);
    heroAttrs.push(`role="button"`);
    heroAttrs.push(`tabindex="0"`);
    heroAttrs.push(`aria-label="${escapeHtml(`${device.title} - ${device.user}`)}"`);
  }

  return `
    <section
      class="jms-cast-slide"
      data-session-id="${escapeHtml(device.sessionId)}"
      data-item-id="${escapeHtml(device.itemId)}"
      data-index="${index}"
      data-read-only="${disabled ? "true" : "false"}"
    >
      <div class="jms-cast-slide__body">
        <div ${heroAttrs.join(" ")}>
          <div class="jms-cast-slide__poster-wrap">
            ${renderPosterMarkup(device)}
          </div>

          <div class="jms-cast-slide__header">
            <div class="jms-cast-slide__eyebrow-row">
              <span class="jms-cast-slide__eyebrow">${escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))}</span>
              ${renderViewerBadge(device.user)}
            </div>
            <h2 class="jms-cast-slide__title">
              ${renderIcon(device.mediaIconClass)}
              <span>${escapeHtml(device.title)}</span>
            </h2>
            ${compact
              ? `
                ${compactMeta ? `<p class="jms-cast-slide__summary">${escapeHtml(compactMeta)}</p>` : ""}
                <div class="jms-cast-slide__chips">
                  ${renderMetricChips(device)}
                </div>
                ${device.overview ? `<p class="jms-cast-slide__overview">${escapeHtml(device.overview)}</p>` : ""}
              `
              : `
                <div class="jms-cast-slide__chips">
                  ${renderMetricChips(device)}
                </div>
                ${device.overview ? `<p class="jms-cast-slide__overview">${escapeHtml(device.overview)}</p>` : ""}
              `
            }
          </div>
        </div>

        <div class="jms-cast-progress">
          <div class="jms-cast-progress__rail">
            <span class="jms-cast-progress__fill" data-role="progress-fill" style="width:${progressPercent}%"></span>
          </div>
          <div class="jms-cast-progress__times">
            <span data-role="duration">${escapeHtml(`${formatTime(device.positionTicks)} / ${formatTime(device.runtimeTicks)}`)}</span>
            <span data-role="remaining">${escapeHtml(formatRemainingTime(device.positionTicks, device.runtimeTicks))}</span>
          </div>
        </div>

        ${compact ? "" : `
          <div class="jms-cast-controls">
            <button
              type="button"
              class="jms-cast-action"
              data-action="playback"
              data-session-id="${escapeHtml(device.sessionId)}"
              ${renderDisabledAttr(disabled)}
            >
              ${getPlaybackButtonContent(device)}
            </button>
            <button
              type="button"
              class="jms-cast-action ${device.isFavorite ? "is-active" : ""}"
              data-action="favorite"
              data-item-id="${escapeHtml(device.itemId)}"
              ${renderDisabledAttr(disabled)}
            >
              ${getFavoriteButtonContent(device)}
            </button>
            ${renderVolumeControl(device)}
          </div>

          <div class="jms-cast-links">
            ${renderLinkButtonsHtml(device)}
          </div>

          <div class="jms-cast-info-grid">
            ${renderInfoCardsHtml(device)}
          </div>

          <div class="jms-cast-tag-groups">
            ${renderTagGroupsHtml(device)}
          </div>

          ${renderServerSection()}
        `}
      </div>
    </section>
  `;
}

function renderDots(devices, activeIndex) {
  return devices
    .map(
      (device, index) => `
        <button
          type="button"
          class="jms-cast-dot ${index === activeIndex ? "is-active" : ""}"
          data-action="jump"
          data-index="${index}"
          aria-label="${escapeHtml(`${device.deviceName} - ${device.title}`)}"
        ></button>
      `
    )
    .join("");
}

function renderModalShell(content, { className = "", labelledBy = "" } = {}) {
  const shellClassName = ["jms-cast-modal__shell", className].filter(Boolean).join(" ");
  const shellAttributes = [
    `class="${shellClassName}"`,
    'data-role="shell"',
    'role="dialog"',
    'aria-modal="true"',
    labelledBy ? `aria-labelledby="${escapeHtml(labelledBy)}"` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `<section ${shellAttributes}>${content}</section>`;
}

function renderModalMarkup(devices, activeIndex) {
  const activeDevice = devices[activeIndex] || devices[0];
  const headerTitle = activeDevice?.deviceName || t("castcihaz", "Bilinmeyen cihaz");
  const subtitleParts = [activeDevice?.title, activeDevice?.client].filter(Boolean).join(" • ");

  return `
    <div class="jms-cast-modal__scrim" data-action="close"></div>
    ${renderModalShell(`
      <header class="jms-cast-modal__header">
        <div class="jms-cast-modal__headline">
          <div class="jms-cast-modal__eyebrow-row">
            <span class="jms-cast-modal__eyebrow">${escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))}</span>
            ${renderViewerBadge(activeDevice?.user)}
          </div>
          <h2 id="jms-cast-modal-title" data-role="active-title">${escapeHtml(headerTitle)}</h2>
          <p data-role="active-subtitle">${escapeHtml(subtitleParts)}</p>
        </div>
        <div class="jms-cast-modal__toolbar">
          <button type="button" class="jms-cast-toolbar-btn" data-action="refresh">
            ${renderButtonLabel("fa-rotate-right", t("yenile", "Yenile"), "jms-cast-toolbar-btn__label")}
          </button>
          <button type="button" class="jms-cast-toolbar-btn jms-cast-toolbar-btn--close" data-action="close" aria-label="${escapeHtml(t("kapat", "Kapat"))}">
            ${renderIcon("fa-xmark")}
          </button>
        </div>
      </header>

      <div class="jms-cast-modal__viewport" data-role="viewport">
        ${devices.map((device, index) => renderSlide(device, index)).join("")}
      </div>

      <footer class="jms-cast-modal__footer">
        <div class="jms-cast-dots" data-role="dots">
          ${renderDots(devices, activeIndex)}
        </div>
      </footer>
    `, { labelledBy: "jms-cast-modal-title" })}
  `;
}

function createLoadingMarkup() {
  return `
    <div class="jms-cast-modal__scrim" data-action="close"></div>
    ${renderModalShell(`
      <div class="jms-cast-modal__loading">
        <div class="jms-cast-modal__spinner"></div>
        <p>${escapeHtml(t("castyukleniyor", "Cihazlar aranıyor..."))}</p>
      </div>
    `, { className: "jms-cast-modal__shell--loading" })}
  `;
}

function cacheSlideRefs(state) {
  state.shell = state.root.querySelector('[data-role="shell"]');
  state.viewport = state.root.querySelector('[data-role="viewport"]');
  state.title = state.root.querySelector('[data-role="active-title"]');
  state.subtitle = state.root.querySelector('[data-role="active-subtitle"]');
  state.dotsHost = state.root.querySelector('[data-role="dots"]');
  state.slideRefs = new Map();

  state.root.querySelectorAll(".jms-cast-slide").forEach((slide) => {
    const sessionId = slide.dataset.sessionId;
    if (!sessionId) return;

    state.slideRefs.set(sessionId, {
      slide,
      duration: slide.querySelector('[data-role="duration"]'),
      remaining: slide.querySelector('[data-role="remaining"]'),
      progressFill: slide.querySelector('[data-role="progress-fill"]'),
      playButton: slide.querySelector('[data-action="playback"]'),
      favoriteButton: slide.querySelector('[data-action="favorite"]'),
      muteButton: slide.querySelector('[data-action="mute"]'),
      volumeSlider: slide.querySelector(".jms-cast-volume__slider"),
      volumeValue: slide.querySelector('[data-role="volume-value"]'),
      serverPanel: slide.querySelector('[data-role="server-panel"]'),
      serverToggle: slide.querySelector('[data-action="server-toggle"]')
    });
  });
}

function updateHeaderForActiveDevice(state) {
  const activeDevice = state.devices[state.activeIndex];
  if (!activeDevice) return;

  if (state.title) {
    state.title.textContent = activeDevice.deviceName || t("castcihaz", "Bilinmeyen cihaz");
  }

  if (state.subtitle) {
    state.subtitle.textContent = [activeDevice.title, activeDevice.client].filter(Boolean).join(" • ");
  }

  const eyebrowRow = state.root?.querySelector(".jms-cast-modal__eyebrow-row");
  if (eyebrowRow) {
    eyebrowRow.innerHTML = `
      <span class="jms-cast-modal__eyebrow">${escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))}</span>
      ${renderViewerBadge(activeDevice.user)}
    `;
  }

  state.root.querySelectorAll(".jms-cast-dot").forEach((dot, index) => {
    dot.classList.toggle("is-active", index === state.activeIndex);
  });
}

function applyDeviceProgressToDom(state, device) {
  const refs = state.slideRefs.get(device.sessionId);
  if (!refs) return;

  const durationText = `${formatTime(device.positionTicks)} / ${formatTime(device.runtimeTicks)}`;
  const remainingText = formatRemainingTime(device.positionTicks, device.runtimeTicks);
  const progressPercent = device.runtimeTicks > 0
    ? clamp((device.positionTicks / device.runtimeTicks) * 100, 0, 100)
    : 0;

  if (refs.duration) refs.duration.textContent = durationText;
  if (refs.remaining) refs.remaining.textContent = remainingText;
  if (refs.progressFill) refs.progressFill.style.width = `${progressPercent}%`;
}

function applyDeviceStateToDom(state, device) {
  const refs = state.slideRefs.get(device.sessionId);
  if (!refs) return;
  const volume = clamp(device.volumeLevel, 0, 100);

  if (refs.playButton) refs.playButton.innerHTML = getPlaybackButtonContent(device);
  if (refs.favoriteButton) {
    refs.favoriteButton.innerHTML = getFavoriteButtonContent(device);
    refs.favoriteButton.classList.toggle("is-active", !!device.isFavorite);
  }
  if (refs.muteButton) refs.muteButton.innerHTML = getMuteButtonContent(device);
  if (refs.volumeSlider) refs.volumeSlider.value = String(volume);
  if (refs.volumeValue) refs.volumeValue.textContent = `${volume}%`;

  refs.slide.dataset.paused = device.isPaused ? "true" : "false";
  refs.slide.dataset.muted = isEffectivelyMuted(device) ? "true" : "false";
  applyDeviceProgressToDom(state, device);
}

function applyAllDevicesToDom(state) {
  state.devices.forEach((device) => applyDeviceStateToDom(state, device));
  updateHeaderForActiveDevice(state);
}

function getViewportWidth(state) {
  const viewportRectWidth = state.viewport?.getBoundingClientRect?.().width;
  if (viewportRectWidth) return viewportRectWidth;

  const shellRectWidth = state.shell?.getBoundingClientRect?.().width;
  if (shellRectWidth) return shellRectWidth;

  return state.viewport?.clientWidth || state.shell?.clientWidth || 0;
}

function bindViewport(state) {
  if (state.viewportCleanup) {
    state.viewportCleanup();
    state.viewportCleanup = null;
  }

  if (!state.viewport) return;

  const onScroll = () => {
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
    }

    state.scrollTimer = window.setTimeout(() => {
      if (!isActiveModalState(state) || !state.viewport) return;
      const nextIndex = Math.round(state.viewport.scrollLeft / Math.max(1, getViewportWidth(state)));
      const boundedIndex = clamp(nextIndex, 0, Math.max(0, state.devices.length - 1));
      if (boundedIndex !== state.activeIndex) {
        state.activeIndex = boundedIndex;
        updateHeaderForActiveDevice(state);
      }
    }, SCROLL_DEBOUNCE_MS);
  };

  state.viewport.addEventListener("scroll", onScroll, { passive: true });
  state.viewportCleanup = () => {
    state.viewport?.removeEventListener("scroll", onScroll);
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
      state.scrollTimer = 0;
    }
  };
}

function scrollToSlide(state, index, behavior = "smooth") {
  if (!state.viewport) return;

  const boundedIndex = clamp(index, 0, Math.max(0, state.devices.length - 1));
  const viewportWidth = getViewportWidth(state);
  state.activeIndex = boundedIndex;
  updateHeaderForActiveDevice(state);
  state.viewport.scrollTo({
    left: boundedIndex * viewportWidth,
    behavior
  });
}

function cleanupModalState(state) {
  if (!state) return;

  if (state.syncInterval) {
    clearInterval(state.syncInterval);
    state.syncInterval = 0;
  }

  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = 0;
  }

  if (state.pendingSyncTimer) {
    clearTimeout(state.pendingSyncTimer);
    state.pendingSyncTimer = 0;
  }

  if (state.scrollTimer) {
    clearTimeout(state.scrollTimer);
    state.scrollTimer = 0;
  }

  state.volumeTimers?.forEach((timerId) => clearTimeout(timerId));
  state.volumeTimers?.clear();
  state.pendingVolumeValues?.clear();
  state.pendingSessionActions?.clear();
  state.pendingItemActions?.clear();
  state.viewportCleanup?.();
  state.rootCleanup?.();
  state.abortController?.abort();

  if (state.onKeyDown) {
    document.removeEventListener("keydown", state.onKeyDown);
  }
}

function closeCastModal() {
  const state = castModalState;
  if (!state) return;

  castModalState = null;
  cleanupModalState(state);
  state.root?.remove();
}

function queueModalSync(state, delay = 0) {
  if (!isActiveModalState(state)) return;

  if (state.pendingSyncTimer) {
    clearTimeout(state.pendingSyncTimer);
  }

  state.pendingSyncTimer = window.setTimeout(() => {
    state.pendingSyncTimer = 0;
    void syncCastModalState(state);
  }, Math.max(0, delay));
}

function updateDeviceFromSession(device, session, state, gmmpState = null, localSessionId = "") {
  const volumePending = state.pendingVolumeValues.has(device.sessionId);
  const sessionActionPending = state.pendingSessionActions.has(device.sessionId);

  device.session = session;
  device.item = session.NowPlayingItem || device.item;
  device.runtimeTicks = session.NowPlayingItem?.RunTimeTicks || device.runtimeTicks;
  device.positionTicks = session.PlayState?.PositionTicks ?? device.positionTicks;
  device.lastSyncedAt = Date.now();

  if (!sessionActionPending) {
    device.isPaused = !!session.PlayState?.IsPaused;
    device.confirmedIsPaused = !!session.PlayState?.IsPaused;
    device.isMuted = !!session.PlayState?.IsMuted;
    device.confirmedIsMuted = !!session.PlayState?.IsMuted;
  }

  if (!volumePending) {
    device.volumeLevel = clamp(session.PlayState?.VolumeLevel ?? device.volumeLevel, 0, 100);
    device.confirmedVolumeLevel = device.volumeLevel;
    if (device.volumeLevel > 0) {
      device.lastNonZeroVolume = device.volumeLevel;
    }
  }

  syncDeviceControlMode(device, session, gmmpState, localSessionId);
}

async function hydrateCastModal(state, { preferredSessionId = "" } = {}) {
  const sessions = await fetchVisiblePlaybackSessions({ signal: state.abortController.signal });
  if (!isActiveModalState(state)) return;

  if (sessions.length === 0) {
    closeCastModal();
    showNotification(t("castbulunamadi", "Aygıt bulunamadı"), "error");
    return;
  }

  const devices = await buildDeviceModels(sessions, state.access);
  if (!isActiveModalState(state)) return;

  state.signature = getSessionSignature(sessions);
  state.devices = devices;
  state.deviceMap = new Map(devices.map((device) => [device.sessionId, device]));
  state.root.innerHTML = renderModalMarkup(devices, 0);
  cacheSlideRefs(state);

  const targetIndex = Math.max(
    0,
    devices.findIndex((device) => device.sessionId === preferredSessionId)
  );

  state.activeIndex = targetIndex >= 0 ? targetIndex : 0;
  bindViewport(state);
  applyAllDevicesToDom(state);

  if (state.activeIndex > 0) {
    scrollToSlide(state, state.activeIndex, "auto");
  }

  if (!state.syncInterval) {
    state.syncInterval = window.setInterval(() => {
      void syncCastModalState(state);
    }, CAST_MODAL_SYNC_MS);
  }

  if (!state.tickInterval) {
    state.tickInterval = window.setInterval(() => {
      tickCastModalState(state);
    }, CAST_MODAL_TICK_MS);
  }
}

async function syncCastModalState(state) {
  if (!isActiveModalState(state) || state.isSyncing) return;

  state.isSyncing = true;
  try {
    const sessions = await fetchVisiblePlaybackSessions({ signal: state.abortController.signal });
    const gmmpState = await getGmmpPlaybackSnapshot();
    const localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
    if (!isActiveModalState(state)) return;

    if (sessions.length === 0) {
      if (preserveLocalGmmpDeviceState(state, gmmpState)) {
        applyAllDevicesToDom(state);
        return;
      }
      closeCastModal();
      return;
    }

    const signature = getSessionSignature(sessions);
    if (signature !== state.signature) {
      const activeSessionId = state.devices[state.activeIndex]?.sessionId || "";
      await hydrateCastModal(state, { preferredSessionId: activeSessionId });
      return;
    }

    const sessionsById = new Map(sessions.map((session) => [session.Id, session]));
    state.devices.forEach((device) => {
      const freshSession = sessionsById.get(device.sessionId);
      if (!freshSession) return;
      updateDeviceFromSession(device, freshSession, state, gmmpState, localSessionId);
    });

    applyAllDevicesToDom(state);
  } catch (error) {
    if (!error?.isAbort) {
      console.error("Cast modal senkronizasyon hatası:", error);
    }
  } finally {
    state.isSyncing = false;
  }
}

function tickCastModalState(state) {
  if (!isActiveModalState(state)) return;

  state.devices.forEach((device) => {
    if (device.isPaused || !device.runtimeTicks) return;

    const nextTicks = Math.min(device.runtimeTicks, device.positionTicks + 10_000_000);
    if (nextTicks !== device.positionTicks) {
      device.positionTicks = nextTicks;
      applyDeviceProgressToDom(state, device);
    }
  });

  state.root.querySelectorAll(".jms-cast-server__local-time").forEach((element) => {
    element.textContent = new Date().toLocaleString();
  });
}

async function sendSessionCommand(sessionId, name, args = undefined, { signal } = {}) {
  const body = {
    Name: name,
    ControllingUserId: getSessionInfo().userId
  };

  if (args) {
    body.Arguments = args;
  }

  return makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
}

function setSessionPending(state, sessionId, pending) {
  const refs = state.slideRefs.get(sessionId);
  if (!refs) return;

  [refs.playButton, refs.muteButton, refs.volumeSlider].forEach((button) => {
    if (!button) return;
    button.disabled = pending;
    button.classList.toggle("is-busy", pending);
  });
}

function setItemPending(state, itemId, pending) {
  state.root.querySelectorAll(`[data-item-id="${escapeSelectorValue(itemId)}"]`).forEach((button) => {
    button.disabled = pending;
    button.classList.toggle("is-busy", pending);
  });
}

async function handlePlaybackToggle(state, sessionId) {
  if (!isActiveModalState(state) || state.pendingSessionActions.has(sessionId)) return;

  const device = state.deviceMap.get(sessionId);
  if (!device) return;

  await refreshDeviceControlMode(device, { signal: state.abortController.signal });

  const nextPaused = !device.isPaused;
  const previousPaused = device.isPaused;
  device.isPaused = nextPaused;
  state.pendingSessionActions.add(sessionId);
  setSessionPending(state, sessionId, true);
  applyDeviceStateToDom(state, device);

  try {
    if (device.controlMode === "gmmp") {
      const gmmpState = await setGmmpPausedState(nextPaused);
      applyGmmpStateToDevice(device, gmmpState);
    } else {
      await makeApiRequest(
        `/Sessions/${encodeURIComponent(sessionId)}/Playing/${nextPaused ? "Pause" : "Unpause"}`,
        {
          method: "POST",
          signal: state.abortController.signal
        }
      );

      device.confirmedIsPaused = nextPaused;
    }

    showNotification(
      nextPaused ? t("duraklatildi", "Duraklatıldı") : t("devamettirildi", "Devam ettirildi"),
      "success"
    );
    queueModalSync(state, 350);
  } catch (error) {
    device.isPaused = previousPaused;
    showNotification(`${t("islemhatasi", "İşlem hatası")}: ${error.message}`, "error");
  } finally {
    state.pendingSessionActions.delete(sessionId);
    setSessionPending(state, sessionId, false);
    applyDeviceStateToDom(state, device);
  }
}

async function handleMuteToggle(state, sessionId) {
  if (!isActiveModalState(state) || state.pendingSessionActions.has(sessionId)) return;

  const device = state.deviceMap.get(sessionId);
  if (!device) return;

  await refreshDeviceControlMode(device, { signal: state.abortController.signal });

  const previousMuted = device.isMuted;
  const previousVolume = device.volumeLevel;
  const nextMuted = !device.isMuted;

  if (!nextMuted && device.lastNonZeroVolume > 0) {
    device.volumeLevel = device.lastNonZeroVolume;
  }
  if (nextMuted) {
    if (device.volumeLevel > 0) {
      device.lastNonZeroVolume = device.volumeLevel;
    }
    device.volumeLevel = 0;
  }
  device.isMuted = nextMuted;

  state.pendingSessionActions.add(sessionId);
  setSessionPending(state, sessionId, true);
  applyDeviceStateToDom(state, device);

  try {
    if (device.controlMode === "gmmp") {
      const gmmpState = nextMuted
        ? await setGmmpMutedState(true)
        : await setGmmpVolumeLevel(device.lastNonZeroVolume > 0 ? device.lastNonZeroVolume : Math.max(previousVolume, 1));
      applyGmmpStateToDevice(device, gmmpState);
    } else {
      await sendSessionCommand(
        sessionId,
        nextMuted ? "Mute" : "Unmute",
        undefined,
        { signal: state.abortController.signal }
      );

      device.confirmedIsMuted = nextMuted;
      if (!nextMuted && device.volumeLevel > 0) {
        device.confirmedVolumeLevel = device.volumeLevel;
      }
    }

    showNotification(
      nextMuted ? t("volOff", "Ses kapatıldı") : t("volOn", "Ses açıldı"),
      "success"
    );
    queueModalSync(state, 350);
  } catch (error) {
    device.isMuted = previousMuted;
    device.volumeLevel = previousVolume;
    showNotification(`${t("seshata", "Ses hatası")}: ${error.message}`, "error");
  } finally {
    state.pendingSessionActions.delete(sessionId);
    setSessionPending(state, sessionId, false);
    applyDeviceStateToDom(state, device);
  }
}

function scheduleVolumeCommit(state, sessionId, volume, immediate = false) {
  if (!isActiveModalState(state)) return;

  if (state.volumeTimers.has(sessionId)) {
    clearTimeout(state.volumeTimers.get(sessionId));
    state.volumeTimers.delete(sessionId);
  }

  state.pendingVolumeValues.set(sessionId, volume);

  if (immediate) {
    void commitVolume(state, sessionId);
    return;
  }

  const timerId = window.setTimeout(() => {
    state.volumeTimers.delete(sessionId);
    void commitVolume(state, sessionId);
  }, VOLUME_COMMIT_DELAY_MS);

  state.volumeTimers.set(sessionId, timerId);
}

async function commitVolume(state, sessionId) {
  if (!isActiveModalState(state)) return;

  const device = state.deviceMap.get(sessionId);
  if (!device) return;

  await refreshDeviceControlMode(device, { signal: state.abortController.signal });

  const targetVolume = clamp(state.pendingVolumeValues.get(sessionId) ?? device.volumeLevel, 0, 100);
  state.pendingVolumeValues.delete(sessionId);

  try {
    if (device.controlMode === "gmmp") {
      const gmmpState = await setGmmpVolumeLevel(targetVolume);
      applyGmmpStateToDevice(device, gmmpState);
    } else {
      if (device.confirmedIsMuted && targetVolume > 0) {
        await sendSessionCommand(sessionId, "Unmute", undefined, { signal: state.abortController.signal });
        device.isMuted = false;
        device.confirmedIsMuted = false;
      }

      await sendSessionCommand(
        sessionId,
        "SetVolume",
        { Volume: targetVolume },
        { signal: state.abortController.signal }
      );

      device.volumeLevel = targetVolume;
      device.confirmedVolumeLevel = targetVolume;
      if (targetVolume > 0) {
        device.lastNonZeroVolume = targetVolume;
        device.isMuted = false;
        device.confirmedIsMuted = false;
      }
    }

    applyDeviceStateToDom(state, device);
    queueModalSync(state, 250);
  } catch (error) {
    device.volumeLevel = device.confirmedVolumeLevel;
    device.isMuted = device.confirmedIsMuted;
    applyDeviceStateToDom(state, device);
    showNotification(`${t("seshata", "Ses hatası")}: ${error.message}`, "error");
  }
}

async function handleFavoriteToggle(state, itemId) {
  if (!isActiveModalState(state) || state.pendingItemActions.has(itemId)) return;

  const devices = state.devices.filter((device) => device.itemId === itemId);
  const sample = devices[0];
  if (!sample) return;

  const makeFavorite = !sample.isFavorite;
  const previousValue = sample.isFavorite;
  state.pendingItemActions.add(itemId);
  setItemPending(state, itemId, true);

  devices.forEach((device) => {
    device.isFavorite = makeFavorite;
    applyDeviceStateToDom(state, device);
  });

  try {
    const itemDetails = sample.itemDetails || sample.item;
    await updateFavoriteStatus(itemId, makeFavorite, {
      item: itemDetails || { Id: itemId, Type: itemDetails?.Type }
    });

    devices.forEach((device) => {
      device.isFavorite = makeFavorite;
      if (!device.itemDetails.UserData) {
        device.itemDetails.UserData = {};
      }
      device.itemDetails.UserData.IsFavorite = makeFavorite;
      applyDeviceStateToDom(state, device);
    });

    showNotification(getWatchlistToast(sample.itemDetails || sample.item, makeFavorite), "success");
  } catch (error) {
    devices.forEach((device) => {
      device.isFavorite = previousValue;
      applyDeviceStateToDom(state, device);
    });
    showNotification(`${t("favorihata", "Favori işlem hatası")}: ${error.message}`, "error");
  } finally {
    state.pendingItemActions.delete(itemId);
    setItemPending(state, itemId, false);
  }
}

function renderServerInfoMarkup(info = {}) {
  const rows = [
    { label: t("servername", "Sunucu Adı"), value: info.ServerName },
    { label: t("surumu", "Sürüm"), value: info.Version },
    { label: t("productname", "Ürün"), value: info.ProductName },
    { label: t("isletimsistemi", "İşletim Sistemi"), value: info.OperatingSystemDisplayName || info.OperatingSystem },
    { label: t("systemarch", "Mimari"), value: info.SystemArchitecture },
    { label: t("localaddress", "Yerel Adres"), value: info.LocalAddress },
    { label: t("websocketport", "WebSocket Port"), value: info.WebSocketPortNumber },
    { label: t("encoderlocation", "Encoder"), value: info.EncoderLocation },
    { label: t("pendingrestart", "Bekleyen Yeniden Başlatma"), value: info.HasPendingRestart ? t("evet", "Evet") : t("hayir", "Hayır") },
    { label: t("updateavailable", "Güncelleme"), value: info.HasUpdateAvailable ? t("evet", "Evet") : t("hayir", "Hayır") },
    { label: t("librarymonitor", "Kütüphane İzleme"), value: info.SupportsLibraryMonitor ? t("destekleniyor", "Destekleniyor") : t("desteklenmiyor", "Desteklenmiyor") },
    { label: t("castreceiverapps", "Cast Receiver Apps"), value: Array.isArray(info.CastReceiverApplications) ? String(info.CastReceiverApplications.length) : "0" },
    { label: t("localTime", "Yerel Zaman"), value: `<span class="jms-cast-server__local-time">${escapeHtml(new Date().toLocaleString())}</span>`, isHtml: true }
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== "");

  return `
    <div class="jms-cast-server__grid">
      ${rows
        .map(
          (row) => `
            <div class="jms-cast-server__item">
              <span class="jms-cast-server__label">${escapeHtml(row.label)}</span>
              <strong class="jms-cast-server__value">${row.isHtml ? row.value : escapeHtml(row.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

async function getServerInfoOnce({ signal } = {}) {
  if (!serverInfoPromise) {
    serverInfoPromise = makeApiRequest("/System/Info", { signal })
      .then((info) => info || {})
      .catch((error) => {
        if (error?.isAbort) {
          serverInfoPromise = null;
          throw error;
        }
        serverInfoPromise = null;
        return {};
      });
  }
  return serverInfoPromise;
}

async function toggleServerPanel(state, toggleButton) {
  const slide = toggleButton.closest(".jms-cast-slide");
  const sessionId = slide?.dataset.sessionId;
  if (!sessionId) return;

  const refs = state.slideRefs.get(sessionId);
  if (!refs?.serverPanel) return;

  const willExpand = refs.serverPanel.hidden;
  refs.serverPanel.hidden = !willExpand;
  toggleButton.setAttribute("aria-expanded", willExpand ? "true" : "false");
  refs.serverToggle?.classList.toggle("is-open", willExpand);

  if (!willExpand || refs.serverPanel.dataset.loaded === "true") {
    return;
  }

  refs.serverPanel.dataset.loading = "true";
  refs.serverPanel.innerHTML = `<div class="jms-cast-server__loading">${escapeHtml(t("castyukleniyor", "Yükleniyor..."))}</div>`;

  try {
    const info = await getServerInfoOnce({ signal: state.abortController.signal });
    if (!isActiveModalState(state)) return;
    refs.serverPanel.innerHTML = renderServerInfoMarkup(info || {});
    refs.serverPanel.dataset.loaded = "true";
  } catch (error) {
    refs.serverPanel.innerHTML = `<div class="jms-cast-server__error">${escapeHtml(`${t("sunucubilgihata", "Sunucu bilgisi alınamadı")}: ${error.message}`)}</div>`;
  } finally {
    delete refs.serverPanel.dataset.loading;
  }
}

function bindModalEvents(state) {
  state.onKeyDown = (event) => {
    if (!isActiveModalState(state)) return;

    if (event.key === "Escape") {
      closeCastModal();
      return;
    }

    if (event.key === "ArrowRight") {
      scrollToSlide(state, state.activeIndex + 1);
      return;
    }

    if (event.key === "ArrowLeft") {
      scrollToSlide(state, state.activeIndex - 1);
    }
  };

  document.addEventListener("keydown", state.onKeyDown);

  state.root.addEventListener("click", async (event) => {
    if (!isActiveModalState(state)) return;

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl || !state.root.contains(actionEl)) return;

    const { action } = actionEl.dataset;
    if (!action) return;

    event.preventDefault();

    if (action === "close") {
      closeCastModal();
      return;
    }

    if (action === "refresh") {
      queueModalSync(state, 0);
      return;
    }

    if (action === "jump") {
      scrollToSlide(state, Number(actionEl.dataset.index || 0));
      return;
    }

    if (state.canControl !== true && ["playback", "favorite", "mute"].includes(action)) {
      return;
    }

    if (action === "playback") {
      await handlePlaybackToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "favorite") {
      await handleFavoriteToggle(state, actionEl.dataset.itemId || "");
      return;
    }

    if (action === "mute") {
      await handleMuteToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "server-toggle") {
      await toggleServerPanel(state, actionEl);
    }
  });

  state.root.addEventListener("input", (event) => {
    if (!isActiveModalState(state)) return;
    if (state.canControl !== true) return;

    const slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    const sessionId = slider.dataset.sessionId || "";
    const device = state.deviceMap.get(sessionId);
    if (!device) return;

    const volume = clamp(slider.value, 0, 100);
    device.volumeLevel = volume;
    if (volume > 0) {
      device.lastNonZeroVolume = volume;
      device.isMuted = false;
    }

    applyDeviceStateToDom(state, device);
    scheduleVolumeCommit(state, sessionId, volume, false);
  });

  state.root.addEventListener("change", (event) => {
    if (!isActiveModalState(state)) return;
    if (state.canControl !== true) return;

    const slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    const sessionId = slider.dataset.sessionId || "";
    const volume = clamp(slider.value, 0, 100);
    scheduleVolumeCommit(state, sessionId, volume, true);
  });
}

function renderEmbeddedPanelMarkup(state) {
  const isNotificationVariant = state.variant === "notification";
  if (!state.devices.length) {
    return `
      <div class="jms-cast-embed${isNotificationVariant ? " jms-cast-embed--notification" : ""}">
        <div class="jms-cast-embed__empty">
          ${escapeHtml(t("castbulunamadi", "Aygıt bulunamadı"))}
        </div>
      </div>
    `;
  }

  const readOnlyNotice = isNotificationVariant || state.canControl === true
    ? ""
    : `
      <div class="jms-cast-embed__notice">
        ${escapeHtml(t("castreadonly", "Bu alanda sadece izleme bilgisi görüntülenebilir."))}
      </div>
    `;

  return `
    <div class="jms-cast-embed${isNotificationVariant ? " jms-cast-embed--notification" : ""}">
      ${readOnlyNotice}
      ${state.devices.map((device, index) => renderSlide(device, index, {
        compact: isNotificationVariant,
        clickableHero: isNotificationVariant
      })).join("")}
    </div>
  `;
}

async function hydrateEmbeddedCastPanel(state) {
  const sessions = await fetchVisiblePlaybackSessions({ signal: state.abortController.signal });
  if (!isActiveEmbeddedState(state)) return;

  state.signature = getSessionSignature(sessions);
  state.devices = sessions.length
    ? await buildDeviceModels(sessions, state.access)
    : [];
  if (!isActiveEmbeddedState(state)) return;

  state.deviceMap = new Map(state.devices.map((device) => [device.sessionId, device]));
  state.activeIndex = 0;
  state.root.innerHTML = renderEmbeddedPanelMarkup(state);
  cacheSlideRefs(state);
  applyAllDevicesToDom(state);
}

async function syncEmbeddedCastPanelState(state) {
  if (!isActiveEmbeddedState(state) || state.isSyncing) return;

  state.isSyncing = true;
  try {
    await hydrateEmbeddedCastPanel(state);
  } catch (error) {
    if (!error?.isAbort) {
      console.error("Cast panel senkronizasyon hatası:", error);
    }
  } finally {
    state.isSyncing = false;
  }
}

function tickEmbeddedCastPanelState(state) {
  if (!isActiveEmbeddedState(state)) return;

  state.devices.forEach((device) => {
    if (device.isPaused || !device.runtimeTicks) return;

    const nextTicks = Math.min(device.runtimeTicks, device.positionTicks + 10_000_000);
    if (nextTicks !== device.positionTicks) {
      device.positionTicks = nextTicks;
      applyDeviceProgressToDom(state, device);
    }
  });

  state.root.querySelectorAll(".jms-cast-server__local-time").forEach((element) => {
    element.textContent = new Date().toLocaleString();
  });
}

function bindEmbeddedEvents(state) {
  const onClick = async (event) => {
    if (!isActiveEmbeddedState(state)) return;

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl || !state.root.contains(actionEl)) return;

    const { action } = actionEl.dataset;
    if (!action) return;

    event.preventDefault();

    if (action === "open-modal") {
      const slide = actionEl.closest(".jms-cast-slide");
      const sessionId = slide?.dataset.sessionId || "";
      const device = state.deviceMap.get(sessionId);
      if (!device) return;
      await showNowPlayingModal(device.itemDetails || device.item, device.session || null);
      return;
    }

    if (state.canControl !== true && ["playback", "favorite", "mute"].includes(action)) {
      return;
    }

    if (action === "playback") {
      await handlePlaybackToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "favorite") {
      await handleFavoriteToggle(state, actionEl.dataset.itemId || "");
      return;
    }

    if (action === "mute") {
      await handleMuteToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "server-toggle") {
      await toggleServerPanel(state, actionEl);
    }
  };

  const onKeyDown = (event) => {
    if (!isActiveEmbeddedState(state)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    const actionEl = event.target.closest('[data-action="open-modal"]');
    if (!actionEl || !state.root.contains(actionEl)) return;

    event.preventDefault();
    actionEl.click();
  };

  const onInput = (event) => {
    if (!isActiveEmbeddedState(state) || state.canControl !== true) return;

    const slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    const sessionId = slider.dataset.sessionId || "";
    const device = state.deviceMap.get(sessionId);
    if (!device) return;

    const volume = clamp(slider.value, 0, 100);
    device.volumeLevel = volume;
    if (volume > 0) {
      device.lastNonZeroVolume = volume;
      device.isMuted = false;
    }

    applyDeviceStateToDom(state, device);
    scheduleVolumeCommit(state, sessionId, volume, false);
  };

  const onChange = (event) => {
    if (!isActiveEmbeddedState(state) || state.canControl !== true) return;

    const slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    const sessionId = slider.dataset.sessionId || "";
    const volume = clamp(slider.value, 0, 100);
    scheduleVolumeCommit(state, sessionId, volume, true);
  };

  state.root.addEventListener("click", onClick);
  state.root.addEventListener("keydown", onKeyDown);
  state.root.addEventListener("input", onInput);
  state.root.addEventListener("change", onChange);
  state.rootCleanup = () => {
    state.root?.removeEventListener("click", onClick);
    state.root?.removeEventListener("keydown", onKeyDown);
    state.root?.removeEventListener("input", onInput);
    state.root?.removeEventListener("change", onChange);
  };
}

export async function mountCastViewerPanel(container, { refreshMs = CAST_MODAL_SYNC_MS, variant = "default" } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  await ensureCastModalCss();
  const access = await getCastAccess();

  const state = {
    kind: "embedded",
    root: container,
    devices: [],
    deviceMap: new Map(),
    slideRefs: new Map(),
    activeIndex: 0,
    signature: "",
    syncInterval: 0,
    tickInterval: 0,
    pendingSyncTimer: 0,
    scrollTimer: 0,
    viewportCleanup: null,
    volumeTimers: new Map(),
    pendingVolumeValues: new Map(),
    pendingSessionActions: new Set(),
    pendingItemActions: new Set(),
    abortController: new AbortController(),
    isSyncing: false,
    access,
    canControl: access.canControl === true,
    variant
  };

  container.classList.add("jms-cast-embed-host", `jms-cast-embed-host--${variant}`);
  bindEmbeddedEvents(state);

  try {
    await hydrateEmbeddedCastPanel(state);
  } catch (error) {
    if (!error?.isAbort) {
      console.error("Cast panel yükleme hatası:", error);
      container.innerHTML = `
        <div class="jms-cast-embed">
          <div class="jms-cast-embed__empty">${escapeHtml(`${t("casthata", "Hata")}: ${error.message}`)}</div>
        </div>
      `;
    }
  }

  state.syncInterval = window.setInterval(() => {
    void syncEmbeddedCastPanelState(state);
  }, Math.max(1500, refreshMs));

  state.tickInterval = window.setInterval(() => {
    tickEmbeddedCastPanelState(state);
  }, CAST_MODAL_TICK_MS);

  return {
    destroy() {
      cleanupModalState(state);
      try {
        container.classList.remove("jms-cast-embed-host");
        container.classList.remove(`jms-cast-embed-host--${variant}`);
        container.innerHTML = "";
      } catch {}
    }
  };
}

async function showNowPlayingModal(nowPlayingItem, device) {
  closeCastModal();
  await ensureCastModalCss();
  const access = await getCastAccess();

  if (access?.canAccessModule !== true) {
    showNotification(t("castbulunamadi", "Aygıt bulunamadı"), "error");
    return;
  }

  const root = document.createElement("div");
  root.className = "jms-cast-modal";
  root.innerHTML = createLoadingMarkup();
  document.body.appendChild(root);

  const state = {
    root,
    devices: [],
    deviceMap: new Map(),
    slideRefs: new Map(),
    activeIndex: 0,
    signature: "",
    syncInterval: 0,
    tickInterval: 0,
    pendingSyncTimer: 0,
    scrollTimer: 0,
    viewportCleanup: null,
    volumeTimers: new Map(),
    pendingVolumeValues: new Map(),
    pendingSessionActions: new Set(),
    pendingItemActions: new Set(),
    abortController: new AbortController(),
    isSyncing: false,
    nowPlayingItem,
    device,
    access,
    canControl: access.canControl === true
  };

  castModalState = state;
  bindModalEvents(state);

  try {
    await hydrateCastModal(state, { preferredSessionId: device?.Id || "" });
  } catch (error) {
    if (!error?.isAbort) {
      console.error("Cast modal hatası:", error);
      closeCastModal();
      showNotification(`${t("icerikhata", "İçerik hatası")}: ${error.message}`, "error");
    }
  }
}

export async function loadAvailableDevices(itemId, dropdown) {
  dropdown.innerHTML = `<div class="monwui-loading-text">${escapeHtml(t("castyukleniyor", "Cihazlar aranıyor..."))}</div>`;

  try {
    const access = await getCastAccess();
    if (access?.canAccessModule !== true) {
      dropdown.innerHTML = `<div class="monwui-no-devices">${escapeHtml(t("castbulunamadi", "Aygıt bulunamadı"))}</div>`;
      return;
    }

    const [sessions, visibleSessions] = await Promise.all([
      fetchSessionsForCurrentUser(),
      fetchVisiblePlaybackSessions()
    ]);

    const videoDevices = sessions.filter(
      (session) => playable(session) || ["android", "ios", "iphone", "ipad"].some((term) => session.Client?.toLowerCase().includes(term))
    );

    if (videoDevices.length === 0 && visibleSessions.length === 0) {
      dropdown.innerHTML = `<div class="monwui-no-devices">${escapeHtml(t("castbulunamadi", "Aygıt bulunamadı"))}</div>`;
      return;
    }

    const uniqueDevices = new Map();
    videoDevices.forEach((device) => {
      const key = `${device.DeviceId || device.DeviceName}-${device.Client}`;
      if (!uniqueDevices.has(key)) {
        uniqueDevices.set(key, device);
      }
    });

    const sortedDevices = Array.from(uniqueDevices.values()).sort((a, b) => Number(!!b.NowPlayingItem) - Number(!!a.NowPlayingItem));
    dropdown.innerHTML = "";

    const nowPlayingDevice =
      visibleSessions.find((entry) => getSessionNowPlayingItemId(entry)) ||
      visibleSessions.find((entry) => entry.NowPlayingItem) ||
      sortedDevices.find((entry) => getSessionNowPlayingItemId(entry)) ||
      sortedDevices.find((entry) => entry.NowPlayingItem);
    if (nowPlayingDevice) {
      const nowPlayingDeviceName = resolveFriendlySessionDeviceName(nowPlayingDevice);
      const nowPlayingItem = normalizeNowPlayingItem(nowPlayingDevice.NowPlayingItem, nowPlayingDevice);
      const { posterUrl, backdropUrl, placeholderUrl } = getHighResImageUrls(nowPlayingItem);
      const bannerPosterUrl = posterUrl || placeholderUrl || "";

      const topBanner = document.createElement("div");
      topBanner.className = "monwui-now-playing-banner";
      if (backdropUrl) {
        topBanner.style.backgroundImage = `url('${backdropUrl}')`;
      } else {
        topBanner.style.removeProperty("background-image");
      }
      topBanner.innerHTML = `
        <div class="overlay"></div>
        ${bannerPosterUrl ? `<img class="monwui-now-playing-poster" src="${escapeHtml(bannerPosterUrl)}" alt="Poster">` : ""}
        <div class="monwui-now-playing-details">
          <div class="monwui-now-playing-title">${renderIcon(getMediaIconClass(nowPlayingItem))} ${escapeHtml(nowPlayingItem.Name || t("castoynatiliyor", "Şu an oynatılıyor"))}</div>
          <div class="monwui-now-playing-device">${escapeHtml(nowPlayingDeviceName)}</div>
          <div class="monwui-now-playing-device">${escapeHtml(nowPlayingDevice.UserName || "")}</div>
        </div>
      `;

      topBanner.addEventListener("click", () => {
        void showNowPlayingModal(nowPlayingItem, nowPlayingDevice);
      });

      dropdown.appendChild(topBanner);

      const divider = document.createElement("hr");
      divider.className = "monwui-cast-divider";
      dropdown.appendChild(divider);
    }

    if (sortedDevices.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "monwui-no-devices";
      emptyState.textContent = t("castcihazyok", "Kullanilabilir hedef cihaz bulunamadı");
      dropdown.appendChild(emptyState);
      return;
    }

    sortedDevices.forEach((device) => {
      const deviceClientName = resolveFriendlySessionClient(device);
      const deviceName = resolveFriendlySessionDeviceName(device);
      const deviceElement = document.createElement("div");
      deviceElement.className = "monwui-device-item";
      deviceElement.innerHTML = `
        <div class="monwui-device-icon-container">
          ${getDeviceIcon(deviceClientName)}
        </div>
        <div class="monwui-device-info">
          <div class="monwui-device-name">${escapeHtml(deviceName)}</div>
          <div class="monwui-device-client">${escapeHtml(deviceClientName)}</div>
          ${device.NowPlayingItem ? `<div class="monwui-now-playing">${renderIcon(getMediaIconClass(device.NowPlayingItem))} ${escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))}</div>` : ""}
        </div>
      `;

      deviceElement.addEventListener("click", async (event) => {
        event.stopPropagation();
        const success = await startPlayback(itemId, device.Id);
        if (success) {
          dropdown.classList.add("hide");
        }
      });

      dropdown.appendChild(deviceElement);
    });
  } catch (error) {
    console.error("Cihazlar yüklenirken hata:", error);
    dropdown.innerHTML = `<div class="monwui-error-message">${escapeHtml(`${t("casthata", "Hata")}: ${error.message}`)}</div>`;
  }
}

export function getDeviceIcon(clientType) {
  const client = clientType?.toLowerCase() || "";
  const icons = {
    android: `<i class="fa-brands fa-android" style="color:#a4c639;"></i>`,
    ios: `<i class="fa-brands fa-apple" style="color:#ffffff;"></i>`,
    iphone: `<i class="fa-brands fa-apple" style="color:#ffffff;"></i>`,
    ipad: `<i class="fa-brands fa-apple" style="color:#ffffff;"></i>`,
    chromecast: `<i class="fa-solid fa-chromecast" style="color:#ffffff;"></i>`,
    chrome: `<i class="fa-brands fa-chrome" style="color:#ffffff;"></i>`,
    firefox: `<i class="fa-brands fa-firefox-browser" style="color:#ffffff;"></i>`,
    edge: `<i class="fa-brands fa-edge" style="color:#ffffff;"></i>`,
    safari: `<i class="fa-brands fa-safari" style="color:#ffffff;"></i>`,
    opera: `<i class="fa-brands fa-opera" style="color:#ffffff;"></i>`,
    samsung: `<i class="fa-brands fa-android" style="color:#ffffff;"></i>`,
    smarttv: `<i class="fa-solid fa-tv" style="color:#ffffff;"></i>`,
    dlna: `<i class="fa-solid fa-network-wired" style="color:#ffffff;"></i>`,
    kodi: `<i class="fa-solid fa-tv" style="color:#ffffff;"></i>`,
    roku: `<i class="fa-solid fa-tv" style="color:#ffffff;"></i>`
  };

  for (const [key, icon] of Object.entries(icons)) {
    if (client.includes(key)) {
      return icon;
    }
  }

  return `<i class="fa-solid fa-display" style="color:#ffffff;"></i>`;
}

export async function startPlayback(itemId, sessionId) {
  try {
    await makeApiRequest(
      `/Sessions/${encodeURIComponent(sessionId)}/Playing?playCommand=PlayNow&itemIds=${encodeURIComponent(itemId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }
    );

    showNotification(t("castbasarili", "Oynatma başlatıldı"), "success");
    return true;
  } catch (error) {
    console.error("Oynatma hatası:", error);
    showNotification(`${t("castoynatmahata", "Oynatma hatası")}: ${error.message}`, "error");
    return false;
  }
}

export function showNotification(message, type = "info", duration = 3000) {
  const existingNotification = document.querySelector(".playback-notification");
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement("div");
  notification.className = `playback-notification ${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fa-solid ${type === "success" ? "fa-check-circle" : type === "error" ? "fa-times-circle" : "fa-info-circle"}"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  document.body.appendChild(notification);
  window.setTimeout(() => notification.classList.add("show"), 10);
  window.setTimeout(() => {
    notification.classList.remove("show");
    window.setTimeout(() => notification.remove(), 300);
  }, duration);
}

export function hideNotification() {
  const notification = document.querySelector(".playback-notification");
  if (notification) {
    notification.classList.add("fade-out");
    window.setTimeout(() => notification.remove(), 500);
  }
}

export function getMediaIconClass(media) {
  const itemType = (media.ItemType || "").toLowerCase();
  const type = (media.Type || "").toLowerCase();

  const icons = {
    audio: "fa-music",
    music: "fa-headphones",
    musicalbum: "fa-compact-disc",
    song: "fa-headphones",
    movie: "fa-film",
    series: "fa-tv",
    episode: "fa-clapperboard",
    videoclip: "fa-video",
    musicvideo: "fa-video",
    homevideo: "fa-video",
    livetv: "fa-satellite-dish",
    channel: "fa-broadcast-tower",
    audiobook: "fa-book-open",
    photo: "fa-image",
    trailer: "fa-film",
    default: "fa-photo-film"
  };

  return icons[itemType] || icons[type] || icons.default;
}
