import { getConfig } from "../../config.js";
import { getEmbyHeaders, getSessionInfo } from "/Plugins/JMSFusion/runtime/api.js";
import { musicPlayerState } from "./state.js";

const RADIO_BROWSER_MIRRORS = [
  "https://all.api.radio-browser.info",
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info"
];

const RADIO_STATIONS_KEYS = [
  "RadioStations",
  "radioStations",
  "SharedRadioStations",
  "sharedRadioStations"
];

const RADIO_SOURCE_PATH = "./slider/modules/hlsjs/hls.min.js";
const STATIC_SHARED_RADIO_PATH = "./slider/radio-stations.json";
const LOCAL_SHARED_RADIO_KEY = "gmmp:radioStations:v1";
const BACKEND_MODE_KEY = "gmmp:radioBackendMode";
const RADIO_ART_PROBE_CACHE_MAX = 600;
const RADIO_ART_RESOLVE_CACHE_MAX = 400;
const RADIO_BROWSER_SEARCH_PAGE_LIMIT = 100;

let hlsReadyPromise = null;
let sharedBackendMode = (() => {
  try {
    return sessionStorage.getItem(BACKEND_MODE_KEY) || "unknown";
  } catch {
    return "unknown";
  }
})();

function setSharedBackendMode(mode) {
  sharedBackendMode = mode || "unknown";
  try { sessionStorage.setItem(BACKEND_MODE_KEY, sharedBackendMode); } catch {}
}

function getCurrentRadioUser() {
  const session = getSessionInfo?.() || {};
  const apiUser = window.ApiClient?._currentUser || {};

  return {
    userId: text(
      session.userId ||
      session.UserId ||
      apiUser.Id ||
      window.ApiClient?.getCurrentUserId?.()
    ),
    userName: text(
      session.UserName ||
      session.userName ||
      session.User?.Name ||
      apiUser.Name ||
      apiUser.userName ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName")
    )
  };
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function normalizeSearchToken(value) {
  return text(value)
    .toLocaleLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function pruneMap(map, maxSize) {
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(url) {
  const value = text(url);
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function normalizeAssetUrl(url) {
  const value = text(url);
  if (!value) return "";
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return "";
  }
}

function getRadioStationLogoCandidate(station) {
  if (!station || typeof station !== "object") return "";

  return text(
    station.logo ||
    station.Logo ||
    station.logo_url ||
    station.LogoUrl ||
    station.logoUrl ||
    station.logo_uri ||
    station.logoUri ||
    station.LogoUri ||
    station.image ||
    station.Image ||
    station.imageUrl ||
    station.ImageUrl ||
    station.art ||
    station.Art ||
    station.artUrl ||
    station.ArtUrl ||
    station.artwork ||
    station.Artwork ||
    station.favicon ||
    station.Favicon ||
    station.favicon_url ||
    station.faviconUrl ||
    station.FaviconUrl ||
    station.favicon_uri ||
    station.faviconUri ||
    station.FaviconUri ||
    station.icon ||
    station.Icon ||
    station.iconUrl ||
    station.IconUrl ||
    station.icon_uri ||
    station.iconUri ||
    station.IconUri ||
    station.thumb ||
    station.Thumb ||
    station.thumbnail ||
    station.Thumbnail
  );
}

export function getRadioStationLogoUrl(station) {
  const logoUrl = normalizeAssetUrl(getRadioStationLogoCandidate(station));
  return logoUrl || null;
}

export function getRadioStationArtUrl(station) {
  return getRadioStationArtCandidates(station)[0] || null;
}

export function getRadioStationArtCandidates(station) {
  if (!station || typeof station !== "object") return [];

  const rawCandidates = [
    getRadioStationLogoCandidate(station),
    station.logo,
    station.Logo,
    station.logo_url,
    station.LogoUrl,
    station.logoUrl,
    station.logo_uri,
    station.logoUri,
    station.LogoUri,
    station.image,
    station.Image,
    station.imageUrl,
    station.ImageUrl,
    station.art,
    station.Art,
    station.artUrl,
    station.ArtUrl,
    station.artwork,
    station.Artwork,
    station.favicon,
    station.Favicon,
    station.favicon_url,
    station.faviconUrl,
    station.FaviconUrl,
    station.favicon_uri,
    station.faviconUri,
    station.FaviconUri,
    station.icon,
    station.Icon,
    station.iconUrl,
    station.IconUrl,
    station.icon_uri,
    station.iconUri,
    station.IconUri,
    station.thumb,
    station.Thumb,
    station.thumbnail,
    station.Thumbnail
  ];

  const seen = new Set();
  const out = [];

  for (const rawCandidate of rawCandidates) {
    const normalized = normalizeAssetUrl(rawCandidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

const radioArtProbeCache = new Map();
const radioArtResolveCache = new Map();
const radioArtResolveInflight = new Map();

function getRadioArtResolveKey(station, candidates = []) {
  const stationIdentity = stationKey(station);
  return stationIdentity || candidates.join("|");
}

function probeRadioArtUrl(url) {
  if (!url) return Promise.resolve(false);
  if (radioArtProbeCache.has(url)) return Promise.resolve(radioArtProbeCache.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => {
      try { img.onload = null; } catch {}
      try { img.onerror = null; } catch {}
      try { img.src = ""; } catch {}
      radioArtProbeCache.set(url, ok);
      pruneMap(radioArtProbeCache, RADIO_ART_PROBE_CACHE_MAX);
      resolve(ok);
    };

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

export async function resolveRadioStationArtUrl(station) {
  const candidates = getRadioStationArtCandidates(station);
  if (!candidates.length) return null;

  const cacheKey = getRadioArtResolveKey(station, candidates);
  if (cacheKey && radioArtResolveCache.has(cacheKey)) {
    return radioArtResolveCache.get(cacheKey) || null;
  }
  if (cacheKey && radioArtResolveInflight.has(cacheKey)) {
    return radioArtResolveInflight.get(cacheKey);
  }

  const pending = (async () => {
    for (const candidate of candidates) {
      if (await probeRadioArtUrl(candidate)) {
        if (cacheKey) {
          radioArtResolveCache.set(cacheKey, candidate);
          pruneMap(radioArtResolveCache, RADIO_ART_RESOLVE_CACHE_MAX);
        }
        return candidate;
      }
    }

    if (cacheKey) {
      radioArtResolveCache.set(cacheKey, "");
      pruneMap(radioArtResolveCache, RADIO_ART_RESOLVE_CACHE_MAX);
    }
    return null;
  })().finally(() => {
    if (cacheKey) radioArtResolveInflight.delete(cacheKey);
  });

  if (cacheKey) radioArtResolveInflight.set(cacheKey, pending);
  return pending;
}

function normalizeCountryCode(value) {
  return text(value).toUpperCase().slice(0, 2);
}

let countrySearchAliasMap = null;

function addCountrySearchAlias(map, alias, code) {
  const normalizedAlias = normalizeSearchToken(alias);
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedAlias || !normalizedCode || map.has(normalizedAlias)) return;
  map.set(normalizedAlias, normalizedCode);
}

function getCountrySearchAliasMap() {
  if (countrySearchAliasMap) return countrySearchAliasMap;

  const map = new Map();
  const locales = Array.from(new Set([
    "en",
    "tr",
    getConfig()?.timeLocale,
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language
  ].filter(Boolean).map((value) => String(value).trim())));

  const codes = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      codes.push(`${String.fromCharCode(first)}${String.fromCharCode(second)}`);
    }
  }

  for (const code of codes) {
    addCountrySearchAlias(map, code, code);
  }

  for (const locale of locales) {
    let displayNames = null;
    try {
      displayNames = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      continue;
    }

    for (const code of codes) {
      const name = text(displayNames.of(code));
      if (!name || name === code) continue;
      addCountrySearchAlias(map, name, code);
    }
  }

  addCountrySearchAlias(map, "uk", "GB");
  addCountrySearchAlias(map, "usa", "US");
  addCountrySearchAlias(map, "u s a", "US");

  countrySearchAliasMap = map;
  return map;
}

function inferCountryCodeFromQuery(query) {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) return "";
  return getCountrySearchAliasMap().get(normalizedQuery) || "";
}

function getSearchRequestLimit(value, fallback = 24) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function getSearchBaseOptions(options = {}) {
  return {
    order: options.order || "clickcount",
    reverse: options.reverse !== false,
    offset: Math.max(0, Number(options.offset) || 0)
  };
}

function getSearchTaskOptions(options = {}) {
  const cleanQuery = text(options.query);
  const cleanCountryCode = normalizeCountryCode(options.countryCode);
  const cleanCountry = text(options.country);
  const cleanTag = text(options.tag);
  const hasExplicitFilters = !!(cleanCountryCode || cleanCountry || cleanTag);
  const baseOptions = getSearchBaseOptions(options);

  if (!cleanQuery || hasExplicitFilters) {
    return [{
      ...baseOptions,
      query: cleanQuery,
      countryCode: cleanCountryCode,
      country: cleanCountry,
      tag: cleanTag
    }];
  }

  const inferredCountryCode = inferCountryCodeFromQuery(cleanQuery);
  const tasks = [
    { ...baseOptions, query: cleanQuery }
  ];

  if (cleanQuery.length >= 2) {
    tasks.push(
      inferredCountryCode
        ? { ...baseOptions, countryCode: inferredCountryCode }
        : { ...baseOptions, country: cleanQuery }
    );
  }

  if (cleanQuery.length >= 3) {
    tasks.push({ ...baseOptions, tag: cleanQuery });
  }

  return tasks;
}

function mergeSearchStationLists(lists = [], limit = Infinity) {
  const seen = new Set();
  const out = [];
  const maxItems = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Infinity;

  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      const station = normalizeRadioStation(entry);
      if (!station) continue;

      const key = stationKey(station);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      out.push(station);

      if (out.length >= maxItems) return out;
    }
  }

  return out;
}

async function fetchSearchTaskChunk(taskOptions = {}, limit) {
  const data = await fetchRadioBrowser(buildSearchPath({
    ...taskOptions,
    limit: Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, getSearchRequestLimit(limit)),
    offset: Math.max(0, Number(taskOptions.offset) || 0)
  }));

  return normalizeRadioStations(data);
}

async function fetchSearchTaskResults(taskOptions = {}, limit) {
  const targetLimit = getSearchRequestLimit(limit);
  const out = [];
  const seen = new Set();
  let offset = Math.max(0, Number(taskOptions.offset) || 0);

  while (out.length < targetLimit) {
    const remaining = targetLimit - out.length;
    const batchSize = Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, remaining);
    const batch = await fetchSearchTaskChunk({ ...taskOptions, offset }, batchSize);
    const beforeLength = out.length;

    for (const station of batch) {
      const key = stationKey(station);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(station);
    }

    if (batch.length < batchSize || out.length === beforeLength) {
      return { results: out, exhausted: true };
    }

    offset += batchSize;
  }

  return { results: out, exhausted: false };
}

async function fetchAllSearchTaskResults(taskOptions = {}) {
  const out = [];
  const seen = new Set();
  let offset = Math.max(0, Number(taskOptions.offset) || 0);

  while (true) {
    const batch = await fetchSearchTaskChunk({ ...taskOptions, offset }, RADIO_BROWSER_SEARCH_PAGE_LIMIT);
    const beforeLength = out.length;

    for (const station of batch) {
      const key = stationKey(station);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(station);
    }

    if (batch.length < RADIO_BROWSER_SEARCH_PAGE_LIMIT || out.length === beforeLength) {
      return out;
    }

    offset += RADIO_BROWSER_SEARCH_PAGE_LIMIT;
  }
}

function hashString(value) {
  let hash = 0;
  const input = text(value);
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function readLocalSharedStations() {
  try {
    const raw = localStorage.getItem(LOCAL_SHARED_RADIO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeRadioStations(Array.isArray(parsed) ? parsed : parsed?.stations || [], { source: "manual-local" });
  } catch {
    return [];
  }
}

function writeLocalSharedStations(stations = []) {
  try {
    localStorage.setItem(LOCAL_SHARED_RADIO_KEY, JSON.stringify(stations));
  } catch {
  }
}

export function stationKey(station) {
  if (!station) return "";
  return (
    text(station.stationuuid || station.stationUuid || station.StationUuid) ||
    normalizeUrl(station.url || station.Url || station.StreamUrl) ||
    text(station.id || station.Id) ||
    ""
  );
}

function inferNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function getUrlPathname(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function isRadioPlaylistUrl(url) {
  const pathname = getUrlPathname(url);
  return [".pls", ".m3u", ".asx", ".xspf"].some((ext) => pathname.endsWith(ext));
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value.join(",") : text(value);
  if (!raw) return "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

function firstText(...values) {
  for (const value of values) {
    const out = text(value);
    if (out) return out;
  }
  return "";
}

const CP1252_EXTENDED_BYTES = new Map([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f]
]);

function getMojibakeScore(value) {
  return (text(value).match(/(?:Ã.|Ä.|Å.|Æ.|Ç.|Ð.|Ñ.|Ö.|Ü.|Ý.|Þ.|ß.|â.|€|™|œ|Ÿ)/g) || []).length;
}

function repairUtf8Mojibake(value) {
  const input = text(value);
  if (!input || getMojibakeScore(input) === 0) return input;

  const bytes = [];
  for (const char of input) {
    if (CP1252_EXTENDED_BYTES.has(char)) {
      bytes.push(CP1252_EXTENDED_BYTES.get(char));
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint == null || codePoint > 0xff) {
      return input;
    }
    bytes.push(codePoint);
  }

  try {
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)).trim();
    return repaired && getMojibakeScore(repaired) < getMojibakeScore(input)
      ? repaired
      : input;
  } catch {
    return input;
  }
}

function cleanRadioNowPlayingText(value) {
  return text(value)
    .replace(/^(now playing|simdi calan|su an calan(?: sarki)?|şu an çalan(?: şarkı)?)\s*[:\-]\s*/i, "")
    .trim();
}

function parseRadioNowPlaying(rawStation) {
  if (!rawStation || typeof rawStation !== "object") {
    return { artist: "", title: "", displayText: "", rawText: "" };
  }

  const artist = firstText(
    rawStation.currentArtist,
    rawStation.CurrentArtist,
    rawStation.artist,
    rawStation.Artist,
    rawStation.songArtist,
    rawStation.SongArtist,
    rawStation.trackArtist,
    rawStation.TrackArtist
  );
  const cleanArtist = repairUtf8Mojibake(artist);

  const title = firstText(
    rawStation.currentTitle,
    rawStation.CurrentTitle,
    rawStation.songTitle,
    rawStation.SongTitle,
    rawStation.trackTitle,
    rawStation.TrackTitle,
    rawStation.currentTrack,
    rawStation.CurrentTrack,
    rawStation.song,
    rawStation.Song,
    rawStation.track,
    rawStation.Track,
    rawStation.title,
    rawStation.Title
  );
  const cleanTitle = repairUtf8Mojibake(title);

  const rawText = repairUtf8Mojibake(cleanRadioNowPlayingText(firstText(
    rawStation.nowPlayingText,
    rawStation.NowPlayingText,
    rawStation.nowPlaying,
    rawStation.NowPlaying,
    rawStation.now_playing,
    rawStation.nowplaying,
    rawStation.streamTitle,
    rawStation.StreamTitle,
    rawStation.songtitle
  )));

  if (cleanArtist && cleanTitle) {
    return {
      artist: cleanArtist,
      title: cleanTitle,
      displayText: `${cleanArtist} - ${cleanTitle}`,
      rawText: rawText || `${cleanArtist} - ${cleanTitle}`
    };
  }

  if (rawText) {
    for (const separator of [" - ", " – ", " — ", " | ", " / ", ": "]) {
      const parts = rawText.split(separator).map((part) => part.trim()).filter(Boolean);
      if (parts.length !== 2) continue;

      return {
        artist: parts[0],
        title: parts[1],
        displayText: `${parts[0]} - ${parts[1]}`,
        rawText
      };
    }

    return { artist: "", title: "", displayText: rawText, rawText };
  }

  return { artist: "", title: "", displayText: "", rawText };
}

export function getRadioTrackArtistLine(station) {
  const labels = getConfig()?.languageLabels || {};
  const nowPlaying = parseRadioNowPlaying(station);
  return nowPlaying.displayText
    || text(station?.country || station?.Country)
    || text(station?.language || station?.Language)
    || labels.radioDefaultArtist
    || "Internet Radio";
}

export function getRadioTrackDisplayInfo(station) {
  const labels = getConfig()?.languageLabels || {};
  const stationName = text(
    station?.name || station?.Name,
    labels.unknownTrack || "Unknown Track"
  );
  const fallbackArtist = text(station?.country || station?.Country)
    || text(station?.language || station?.Language)
    || labels.radioDefaultArtist
    || "Internet Radio";
  const nowPlaying = parseRadioNowPlaying(station);
  const buildPlayerTitle = (titleText) => {
    const cleanTitle = text(titleText);
    if (!cleanTitle) return stationName;
    if (!stationName) return cleanTitle;
    if (cleanTitle.toLocaleLowerCase() === stationName.toLocaleLowerCase()) {
      return cleanTitle;
    }
    return `${cleanTitle} • ${stationName}`;
  };

  if (nowPlaying.artist && nowPlaying.title) {
    return {
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      stationName,
      playerTitle: buildPlayerTitle(nowPlaying.title),
      displayText: nowPlaying.displayText,
      hasNowPlaying: true
    };
  }

  if (nowPlaying.displayText) {
    return {
      title: nowPlaying.displayText,
      artist: stationName || fallbackArtist,
      stationName,
      playerTitle: buildPlayerTitle(nowPlaying.displayText),
      displayText: nowPlaying.displayText,
      hasNowPlaying: true
    };
  }

  return {
    title: stationName,
    artist: fallbackArtist,
    stationName,
    playerTitle: stationName,
    displayText: "",
    hasNowPlaying: false
  };
}

export function applyRadioNowPlaying(target, rawMetadata = {}) {
  if (!target || typeof target !== "object") return false;

  const normalizedMetadata = rawMetadata && typeof rawMetadata === "object"
    ? {
        ...rawMetadata,
        nowPlayingText: firstText(
          rawMetadata.nowPlayingText,
          rawMetadata.NowPlayingText,
          rawMetadata.rawText,
          rawMetadata.displayText
        )
      }
    : rawMetadata;

  const nowPlayingFromMetadata = parseRadioNowPlaying(normalizedMetadata);
  const nowPlaying = nowPlayingFromMetadata.displayText
    ? nowPlayingFromMetadata
    : parseRadioNowPlaying({
        ...target,
        ...normalizedMetadata
      });

  if (!nowPlaying.displayText) return false;

  const nextArtist = text(nowPlaying.artist);
  const nextTitle = text(nowPlaying.title);
  const nextNowPlayingText = text(nowPlaying.rawText || nowPlaying.displayText);

  if (
    text(target.currentArtist || target.CurrentArtist) === nextArtist
    && text(target.currentTitle || target.CurrentTitle) === nextTitle
    && text(target.nowPlayingText || target.NowPlayingText) === nextNowPlayingText
  ) {
    return false;
  }

  target.currentArtist = nowPlaying.artist;
  target.CurrentArtist = nowPlaying.artist;
  target.currentTitle = nowPlaying.title;
  target.CurrentTitle = nowPlaying.title;
  target.nowPlayingText = nowPlaying.rawText || nowPlaying.displayText;
  target.NowPlayingText = nowPlaying.rawText || nowPlaying.displayText;
  target.Artists = [nowPlaying.displayText];
  target.AlbumArtist = nowPlaying.displayText;
  return true;
}

function asciiFromBytes(bytes = []) {
  return Array.from(bytes, (value) => String.fromCharCode(value)).join("");
}

function concatUint8Arrays(chunks = []) {
  const totalLength = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    if (!chunk?.length) continue;
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function readSynchsafeInteger(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  );
}

function decodeTextBytes(bytes, encodingByte = 3) {
  if (!bytes?.length) return "";

  try {
    switch (encodingByte) {
      case 0:
        return new TextDecoder("iso-8859-1").decode(bytes).replace(/\0+$/g, "").trim();
      case 1:
        if (bytes.length >= 2) {
          if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            return new TextDecoder("utf-16le").decode(bytes.slice(2)).replace(/\0+$/g, "").trim();
          }
          if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            const swapped = new Uint8Array(bytes.length - 2);
            for (let index = 2; index < bytes.length; index += 2) {
              swapped[index - 2] = bytes[index + 1] ?? 0;
              swapped[index - 1] = bytes[index];
            }
            return new TextDecoder("utf-16le").decode(swapped).replace(/\0+$/g, "").trim();
          }
        }
        return new TextDecoder("utf-16le").decode(bytes).replace(/\0+$/g, "").trim();
      case 2: {
        const swapped = new Uint8Array(bytes.length);
        for (let index = 0; index < bytes.length; index += 2) {
          swapped[index] = bytes[index + 1] ?? 0;
          swapped[index + 1] = bytes[index];
        }
        return new TextDecoder("utf-16le").decode(swapped).replace(/\0+$/g, "").trim();
      }
      case 3:
      default:
        return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "").trim();
    }
  } catch {
    return asciiFromBytes(bytes).replace(/\0+$/g, "").trim();
  }
}

function extractNowPlayingTextCandidate(value) {
  const rawText = cleanRadioNowPlayingText(text(value));
  if (!rawText) return "";

  const streamTitleMatch =
    rawText.match(/StreamTitle=['"]([^'"]*)['"]/i)
    || rawText.match(/title=['"]([^'"]*)['"]/i);

  return cleanRadioNowPlayingText(streamTitleMatch?.[1] || rawText);
}

function parseId3Metadata(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (bytes.length < 10 || asciiFromBytes(bytes.slice(0, 3)) !== "ID3") return null;

  const version = bytes[3];
  const tagSize = readSynchsafeInteger(bytes, 6);
  let offset = 10;
  const endOffset = Math.min(bytes.length, 10 + tagSize);
  const frames = new Map();

  while (offset + 10 <= endOffset) {
    const frameId = asciiFromBytes(bytes.slice(offset, offset + 4));
    if (!frameId.trim() || /^\x00+$/.test(frameId)) break;

    const frameSize = version === 4
      ? readSynchsafeInteger(bytes, offset + 4)
      : readUint32(bytes, offset + 4);

    if (!frameSize || offset + 10 + frameSize > bytes.length) break;

    const payload = bytes.slice(offset + 10, offset + 10 + frameSize);
    let frameValue = "";

    if (frameId === "TXXX") {
      const encoding = payload[0] ?? 3;
      const decoded = decodeTextBytes(payload.slice(1), encoding);
      const parts = decoded.split("\u0000").map((part) => part.trim()).filter(Boolean);
      frameValue = parts[parts.length - 1] || "";
    } else if (frameId.startsWith("T")) {
      frameValue = decodeTextBytes(payload.slice(1), payload[0] ?? 3);
    } else {
      frameValue = decodeTextBytes(payload, 3);
    }

    if (frameValue) frames.set(frameId, frameValue);
    offset += 10 + frameSize;
  }

  const artist = firstText(
    frames.get("TPE1"),
    frames.get("TOPE"),
    frames.get("TPE2")
  );
  const title = firstText(
    frames.get("TIT2"),
    frames.get("TIT1"),
    frames.get("TIT3")
  );
  const nowPlayingText = extractNowPlayingTextCandidate(firstText(
    frames.get("TXXX"),
    frames.get("WXXX"),
    frames.get("TIT2"),
    Array.from(frames.values()).find((entry) => /[-–—|/:]/.test(entry))
  ));

  const parsed = parseRadioNowPlaying({
    currentArtist: artist,
    currentTitle: title,
    nowPlayingText
  });

  return parsed.displayText ? parsed : null;
}

function parseHlsMetadataSample(sample) {
  const parsed = parseId3Metadata(
    sample?.data
    || sample?.payload
    || sample?.unit
    || sample
  );
  if (parsed?.displayText) return parsed;

  const frames = Array.isArray(sample?.frames) ? sample.frames : [];
  for (const frame of frames) {
    const nextParsed = parseRadioNowPlaying({
      currentArtist: frame?.info || frame?.artist,
      currentTitle: frame?.value || frame?.title,
      nowPlayingText: frame?.text || frame?.data || frame?.value
    });
    if (nextParsed.displayText) return nextParsed;
  }

  return null;
}

function parseIcyMetadata(metadataText) {
  const parsed = parseRadioNowPlaying({
    nowPlayingText: extractNowPlayingTextCandidate(metadataText)
  });
  return parsed.displayText ? parsed : null;
}

function parseRadioPlaylistContent(content, sourceUrl) {
  const raw = text(content);
  if (!raw) return "";

  const plsMatch = raw.match(/^File\d+\s*=\s*(.+)$/im);
  if (plsMatch?.[1]) return normalizeUrl(plsMatch[1]);

  const m3uLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (m3uLine) {
    try {
      return new URL(m3uLine, sourceUrl).toString();
    } catch {
    }
  }

  const asxMatch = raw.match(/<ref[^>]+href=["']([^"']+)["']/i);
  if (asxMatch?.[1]) {
    try {
      return new URL(asxMatch[1], sourceUrl).toString();
    } catch {
    }
  }

  const xspfMatch = raw.match(/<location>([^<]+)<\/location>/i);
  if (xspfMatch?.[1]) {
    try {
      return new URL(xspfMatch[1].trim(), sourceUrl).toString();
    } catch {
    }
  }

  return "";
}

function inferRadioStreamFromPlaylistUrl(url) {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const sid = text(parsed.searchParams.get("sid"), "1");
    const pathname = parsed.pathname.toLowerCase();

    if (/\/listen\.(pls|m3u|asx|xspf)$/.test(pathname)) {
      return [
        `${origin}/stream/${encodeURIComponent(sid)}/`,
        `${origin}/;stream/${encodeURIComponent(sid)}`,
        sid === "1" ? `${origin}/stream` : "",
        sid === "1" ? `${origin}/;` : "",
        sid === "1" ? `${origin}/` : ""
      ].filter(Boolean);
    }
  } catch {
  }

  return [];
}

async function unwrapRadioPlaylistUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized || !isRadioPlaylistUrl(normalized)) {
    return {
      url: normalized,
      metadataReaderDisabled: false
    };
  }

  try {
    const response = await fetch(normalized, {
      method: "GET",
      cache: "no-store"
    });
    if (response.ok) {
      const parsed = parseRadioPlaylistContent(await response.text(), normalized);
      if (parsed) {
        return {
          url: parsed,
          metadataReaderDisabled: true
        };
      }
    }
  } catch {
  }

  const inferred = inferRadioStreamFromPlaylistUrl(normalized)[0] || normalized;
  return {
    url: inferred,
    metadataReaderDisabled: true
  };
}

function stopRadioMetadataReader(audio) {
  if (!audio) return;
  try { audio._radioMetaAbort?.abort(); } catch {}
  try {
    const cancelPromise = audio._radioMetaReader?.cancel?.();
    if (cancelPromise && typeof cancelPromise.catch === "function") {
      cancelPromise.catch(() => {});
    }
  } catch {}
  delete audio._radioMetaAbort;
  delete audio._radioMetaReader;
}

async function startIcyMetadataReader(audio, streamUrl, onMetadata) {
  if (!audio || typeof onMetadata !== "function") return;

  stopRadioMetadataReader(audio);

  const abortController = new AbortController();
  audio._radioMetaAbort = abortController;

  try {
    const response = await fetch(streamUrl, {
      cache: "no-store",
      headers: {
        "Icy-MetaData": "1"
      },
      signal: abortController.signal
    });

    const metaInt = Number(response.headers.get("icy-metaint"));
    if (!response.ok || !response.body || !Number.isFinite(metaInt) || metaInt <= 0) {
      stopRadioMetadataReader(audio);
      return;
    }

    const reader = response.body.getReader();
    audio._radioMetaReader = reader;

    let bytesUntilMetadata = metaInt;
    let metadataBytesRemaining = -1;
    let metadataChunks = [];

    while (!abortController.signal.aborted) {
      const { value, done } = await reader.read();
      if (done || !value?.length) break;

      let offset = 0;
      while (offset < value.length && !abortController.signal.aborted) {
        if (bytesUntilMetadata > 0) {
          const chunkSize = Math.min(bytesUntilMetadata, value.length - offset);
          bytesUntilMetadata -= chunkSize;
          offset += chunkSize;
          if (bytesUntilMetadata > 0) continue;
        }

        if (metadataBytesRemaining === -1) {
          if (offset >= value.length) break;

          metadataBytesRemaining = value[offset] * 16;
          offset += 1;
          metadataChunks = [];

          if (metadataBytesRemaining === 0) {
            bytesUntilMetadata = metaInt;
            metadataBytesRemaining = -1;
          }
          continue;
        }

        const chunkSize = Math.min(metadataBytesRemaining, value.length - offset);
        metadataChunks.push(value.slice(offset, offset + chunkSize));
        metadataBytesRemaining -= chunkSize;
        offset += chunkSize;

        if (metadataBytesRemaining === 0) {
          const metadataBlock = decodeTextBytes(concatUint8Arrays(metadataChunks), 0);
          const parsed = parseIcyMetadata(metadataBlock);
          if (parsed?.displayText) onMetadata(parsed);
          bytesUntilMetadata = metaInt;
          metadataBytesRemaining = -1;
          metadataChunks = [];
        }
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      console.debug("[radio] ICY metadata okunamadi:", error);
    }
  } finally {
    if (audio._radioMetaAbort === abortController) {
      stopRadioMetadataReader(audio);
    }
  }
}

export function normalizeRadioStation(rawStation, { source = "radio-browser" } = {}) {
  if (!rawStation || typeof rawStation !== "object") return null;

  const url = normalizeUrl(
    rawStation.url ||
    rawStation.Url ||
    rawStation.StreamUrl ||
    rawStation.streamUrl ||
    rawStation.ResolvedUrl ||
    rawStation.url_resolved
  );

  const urlResolved = normalizeUrl(
    rawStation.url_resolved ||
    rawStation.UrlResolved ||
    rawStation.ResolvedUrl ||
    url
  );
  const stationuuid = text(rawStation.stationuuid || rawStation.stationUuid || rawStation.StationUuid);
  const name = text(rawStation.name || rawStation.Name, inferNameFromUrl(url || urlResolved));
  const nowPlaying = parseRadioNowPlaying(rawStation);

  if (!name || (!url && !urlResolved && !stationuuid)) return null;

  const station = {
    id: text(rawStation.id || rawStation.Id, stationuuid || `radio:${hashString(url || urlResolved || name)}`),
    stationuuid,
    name,
    url,
    url_resolved: urlResolved,
    homepage: normalizeUrl(rawStation.homepage || rawStation.Homepage || rawStation.HomePageUrl),
    logo: getRadioStationLogoUrl(rawStation) || "",
    favicon: normalizeUrl(
      rawStation.favicon ||
      rawStation.Favicon ||
      rawStation.favicon_url ||
      rawStation.faviconUrl ||
      rawStation.FaviconUrl ||
      rawStation.favicon_uri ||
      rawStation.faviconUri ||
      rawStation.FaviconUri ||
      rawStation.icon ||
      rawStation.Icon ||
      rawStation.iconUrl ||
      rawStation.IconUrl ||
      rawStation.icon_uri ||
      rawStation.iconUri ||
      rawStation.IconUri
    ),
    country: text(rawStation.country || rawStation.Country),
    countrycode: normalizeCountryCode(rawStation.countrycode || rawStation.CountryCode),
    state: text(rawStation.state || rawStation.State),
    language: text(rawStation.language || rawStation.Language),
    tags: normalizeTags(rawStation.tags || rawStation.Tags || rawStation.TagsText),
    currentArtist: nowPlaying.artist,
    currentTitle: nowPlaying.title,
    nowPlayingText: nowPlaying.rawText,
    codec: text(rawStation.codec || rawStation.Codec),
    bitrate: toNumber(rawStation.bitrate || rawStation.Bitrate, 0),
    votes: toNumber(rawStation.votes || rawStation.Votes, 0),
    clickcount: toNumber(rawStation.clickcount || rawStation.ClickCount, 0),
    hls: toNumber(rawStation.hls || rawStation.Hls, 0) === 1,
    source: text(rawStation.source || rawStation.Source, source),
    createdAt: text(rawStation.createdAt || rawStation.CreatedAt, new Date().toISOString()),
    addedBy: text(rawStation.addedBy || rawStation.AddedBy),
    addedByUserId: text(rawStation.addedByUserId || rawStation.AddedByUserId)
  };

  return station;
}

export function normalizeRadioStations(list = [], options = {}) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];

  for (const entry of list) {
    const station = normalizeRadioStation(entry, options);
    if (!station) continue;

    const key = stationKey(station);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(station);
  }

  return out;
}

export function getRadioStationSubtitle(station) {
  const labels = getConfig()?.languageLabels || {};
  if (!station) return "";

  const country = text(station.country || station.Country);
  const state = text(station.state || station.State);
  const language = text(station.language || station.Language);
  const codec = text(station.codec || station.Codec);
  const bitrate = toNumber(station.bitrate || station.Bitrate, 0);
  const tagsText = text(station.tags || station.Tags || station.TagsText);

  const parts = [];
  const place = [country, state].filter(Boolean).join(" / ");
  if (place) parts.push(place);
  else if (language) parts.push(language);

  const technical = [
    codec,
    bitrate > 0 ? `${bitrate} kbps` : ""
  ].filter(Boolean).join(" • ");
  if (technical) parts.push(technical);

  const firstTag = tagsText
    ? tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)[0]
    : "";
  if (firstTag) parts.push(firstTag);

  return parts.join(" • ") || labels.radioStationLive || "Canli yayin";
}

export function toRadioTrack(station) {
  const normalized = normalizeRadioStation(station);
  if (!normalized) return null;

  const labels = getConfig()?.languageLabels || {};
  const artistLine = getRadioTrackArtistLine(normalized);
  const albumLine = normalized.tags || normalized.codec || labels.radioLiveLabel || "LIVE";

  return {
    Id: `radio:${normalized.stationuuid || hashString(normalized.url || normalized.name)}`,
    Name: normalized.name,
    Artists: [artistLine],
    AlbumArtist: artistLine,
    Album: albumLine,
    IsRadioStation: true,
    StationUuid: normalized.stationuuid,
    StreamUrl: normalized.url,
    ResolvedUrl: normalized.url_resolved,
    Logo: normalized.logo,
    LogoUrl: normalized.logo,
    ImageUrl: normalized.logo,
    Favicon: normalized.favicon,
    HomePageUrl: normalized.homepage,
    Country: normalized.country,
    CountryCode: normalized.countrycode,
    Language: normalized.language,
    CurrentArtist: normalized.currentArtist,
    CurrentTitle: normalized.currentTitle,
    NowPlayingText: normalized.nowPlayingText,
    TagsText: normalized.tags,
    Codec: normalized.codec,
    Bitrate: normalized.bitrate,
    ClickCount: normalized.clickcount,
    Votes: normalized.votes,
    Hls: normalized.hls,
    Source: normalized.source,
    IsFavoriteCapable: false,
    createdAt: normalized.createdAt,
    addedBy: normalized.addedBy,
    addedByUserId: normalized.addedByUserId
  };
}

export function isRadioTrack(track) {
  return !!(track?.IsRadioStation || String(track?.Id || "").startsWith("radio:"));
}

function getLocaleCandidates() {
  const cfg = getConfig() || {};
  const localeCandidates = [];
  if (cfg.timeLocale) localeCandidates.push(cfg.timeLocale);
  if (Array.isArray(navigator.languages)) localeCandidates.push(...navigator.languages);
  if (navigator.language) localeCandidates.push(navigator.language);
  return localeCandidates.filter(Boolean);
}

export function guessCountryCode() {
  const byLang = {
    tr: "TR",
    en: "US",
    de: "DE",
    fr: "FR",
    ru: "RU"
  };

  for (const locale of getLocaleCandidates()) {
    const value = String(locale).trim();
    const match = value.match(/[-_]([A-Za-z]{2})$/);
    if (match) return match[1].toUpperCase();

    const lang = value.split(/[-_]/)[0]?.toLowerCase();
    if (lang && byLang[lang]) return byLang[lang];
  }

  return "TR";
}

async function fetchRadioBrowser(path, options = {}) {
  let lastError = null;

  for (const base of RADIO_BROWSER_MIRRORS) {
    try {
      const response = await fetch(`${base}${path}`, {
        cache: "no-store",
        ...options
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Radio Browser istegi basarisiz");
}

function buildSearchPath({
  query = "",
  countryCode = "",
  country = "",
  tag = "",
  limit = 24,
  offset = 0,
  order = "clickcount",
  reverse = true
} = {}) {
  const qs = new URLSearchParams();
  const cleanQuery = text(query);
  const cleanCountry = normalizeCountryCode(countryCode);
  const cleanCountryName = text(country);
  const cleanTag = text(tag);

  if (cleanQuery) qs.set("name", cleanQuery);
  if (cleanCountry) {
    qs.set("countrycode", cleanCountry);
    qs.set("countrycodeexact", "true");
  }
  if (cleanCountryName) qs.set("country", cleanCountryName);
  if (cleanTag) qs.set("tag", cleanTag);

  qs.set("hidebroken", "true");
  qs.set("limit", String(Math.max(1, Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, Number(limit) || 24))));
  qs.set("offset", String(Math.max(0, Number(offset) || 0)));
  qs.set("order", order || "clickcount");
  qs.set("reverse", reverse ? "true" : "false");

  return `/json/stations/search?${qs.toString()}`;
}

export async function searchRadioStationsDetailed(options = {}) {
  const targetLimit = getSearchRequestLimit(options.limit);
  const searchTasks = getSearchTaskOptions(options);
  const taskResults = await Promise.all(searchTasks.map((task) => fetchSearchTaskResults(task, targetLimit)));

  return {
    results: mergeSearchStationLists(taskResults.map((entry) => entry.results), targetLimit),
    hasMore: taskResults.some((entry) => entry.exhausted === false)
  };
}

export async function searchRadioStations(options = {}) {
  const { results } = await searchRadioStationsDetailed(options);
  return results;
}

export async function searchAllRadioStations(options = {}) {
  const searchTasks = getSearchTaskOptions(options);
  const taskResults = await Promise.all(searchTasks.map((task) => fetchAllSearchTaskResults(task)));
  return mergeSearchStationLists(taskResults);
}

export async function findStationByUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  const qs = new URLSearchParams({ url: normalizedUrl });
  const data = await fetchRadioBrowser(`/json/stations/byurl?${qs.toString()}`);
  return normalizeRadioStations(data)[0] || null;
}

export async function getAutoDiscoveredStations({ limit = 18 } = {}) {
  const countryCode = guessCountryCode();
  const safeLimit = Math.max(6, Math.min(40, Number(limit) || 18));

  const [shared, nearby, popular] = await Promise.all([
    fetchSharedRadioStations().catch(() => []),
    searchRadioStations({ countryCode, limit: safeLimit, order: "clickcount", reverse: true }).catch(() => []),
    searchRadioStations({ limit: safeLimit, order: "votes", reverse: true }).catch(() => [])
  ]);

  return {
    countryCode,
    shared,
    nearby,
    popular
  };
}

export async function resolveRadioStream(track) {
  const station = normalizeRadioStation(track, { source: track?.Source || "radio" });
  if (!station) {
    throw new Error(getConfig()?.languageLabels?.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  if (station.stationuuid) {
    try {
      const data = await fetchRadioBrowser(`/json/url/${encodeURIComponent(station.stationuuid)}`);
      const resolved = await unwrapRadioPlaylistUrl(data?.url_resolved || data?.url);
      if (resolved?.url) {
        return {
          url: resolved.url,
          station: {
            ...station,
            url_resolved: resolved.url,
            metadataReaderDisabled: resolved.metadataReaderDisabled === true
          }
        };
      }
    } catch {
    }
  }

  const fallback = await unwrapRadioPlaylistUrl(station.url_resolved || station.url);
  if (!fallback?.url) {
    throw new Error(getConfig()?.languageLabels?.radioStreamNotFound || "Yayin adresi bulunamadi");
  }

  const matchedStation =
    await findStationByUrl(fallback.url).catch(() => null)
    || await findStationByUrl(station.url).catch(() => null);

  const mergedStation = matchedStation
    ? {
        ...station,
        ...matchedStation,
        name: station.name || matchedStation.name,
        url: station.url || matchedStation.url,
        url_resolved: fallback.url
      }
    : {
        ...station,
        url_resolved: fallback.url
      };

  return {
    url: fallback.url,
    station: {
      ...mergedStation,
      metadataReaderDisabled: fallback.metadataReaderDisabled === true
    }
  };
}

function toSharedRecord(station) {
  return {
    Id: station.id,
    StationUuid: station.stationuuid,
    Name: station.name,
    Url: station.url,
    UrlResolved: station.url_resolved,
    Homepage: station.homepage,
    Logo: station.logo,
    LogoUrl: station.logo,
    ImageUrl: station.logo,
    Favicon: station.favicon,
    Country: station.country,
    CountryCode: station.countrycode,
    State: station.state,
    Language: station.language,
    Tags: station.tags,
    Codec: station.codec,
    Bitrate: station.bitrate,
    ClickCount: station.clickcount,
    Votes: station.votes,
    Hls: station.hls,
    Source: "shared",
    CreatedAt: station.createdAt,
    AddedBy: station.addedBy,
    AddedByUserId: station.addedByUserId
  };
}

function readSharedStationsFromConfig(configData) {
  for (const key of RADIO_STATIONS_KEYS) {
    const list = configData?.[key];
    if (Array.isArray(list)) return normalizeRadioStations(list, { source: "shared" });
  }
  return [];
}

async function fetchJmsConfig() {
  const response = await fetch("/JMSFusion/config", {
    method: "GET",
    cache: "no-store",
    headers: getEmbyHeaders({
      "Content-Type": "application/json"
    })
  });

  if (!response.ok) {
    if (response.status === 404) {
      setSharedBackendMode("manual");
    }
    throw new Error(`HTTP ${response.status}`);
  }

  setSharedBackendMode("jmsfusion");
  return response.json().then((data) => {
    const unwrapped = data?.cfg;
    return unwrapped && typeof unwrapped === "object" ? unwrapped : (data || {});
  }).catch(() => ({}));
}

async function fetchStaticSharedRadioStations() {
  try {
    const response = await fetch(STATIC_SHARED_RADIO_PATH, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    const parsed = await response.json().catch(() => []);
    const list = Array.isArray(parsed) ? parsed : parsed?.stations || [];
    return normalizeRadioStations(list, { source: "manual-static" });
  } catch {
    return [];
  }
}

async function loadManualSharedStations() {
  const mergedManual = normalizeRadioStations([
    ...await fetchStaticSharedRadioStations(),
    ...readLocalSharedStations()
  ]);
  musicPlayerState.radioSharedStations = mergedManual;
  return mergedManual;
}

export function getRadioPersistenceInfo() {
  return {
    mode: sharedBackendMode === "unknown" ? "auto" : sharedBackendMode,
    staticPath: STATIC_SHARED_RADIO_PATH,
    localKey: LOCAL_SHARED_RADIO_KEY,
    supportsServerWrite: sharedBackendMode === "jmsfusion"
  };
}

export function canRemoveSharedRadioStation(station) {
  if (!station || typeof station !== "object") return false;
  return text(station.source || station.Source) !== "manual-static";
}

function withContributorMetadata(station) {
  if (!station) return station;
  const { userId, userName } = getCurrentRadioUser();

  return {
    ...station,
    addedBy: station.addedBy || userName,
    addedByUserId: station.addedByUserId || userId
  };
}

async function persistSharedRadioStations(stations) {
  const sharedRecords = stations.map(toSharedRecord);

  const response = await fetch("/JMSFusion/config", {
    method: "POST",
    cache: "no-store",
    headers: getEmbyHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      RadioStations: sharedRecords,
      radioStations: sharedRecords
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || `HTTP ${response.status}`);
  }
}

export async function fetchSharedRadioStations() {
  try {
    const configData = await fetchJmsConfig();
    const stations = readSharedStationsFromConfig(configData);
    musicPlayerState.radioSharedStations = stations;
    return stations;
  } catch (error) {
    if (sharedBackendMode !== "jmsfusion") {
      return loadManualSharedStations();
    }

    console.warn("[radio] Paylasilan istasyonlar alinamadi:", error);
    return Array.isArray(musicPlayerState.radioSharedStations)
      ? musicPlayerState.radioSharedStations
      : [];
  }
}

export async function saveSharedRadioStation(rawStation) {
  const station = withContributorMetadata(normalizeRadioStation(rawStation, { source: "shared" }));
  if (!station) {
    throw new Error(getConfig()?.languageLabels?.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  const configData = await fetchJmsConfig().catch(() => ({}));
  if (sharedBackendMode === "manual") {
    const localOnly = readLocalSharedStations();
    const nextLocal = normalizeRadioStations([station, ...localOnly], { source: "manual-local" }).slice(0, 300);
    writeLocalSharedStations(nextLocal.map(toSharedRecord));
    return loadManualSharedStations();
  }
  const currentStations = readSharedStationsFromConfig(configData);
  const merged = normalizeRadioStations([station, ...currentStations], { source: "shared" }).slice(0, 300);
  await persistSharedRadioStations(merged);

  musicPlayerState.radioSharedStations = merged;
  return merged;
}

export async function removeSharedRadioStation(rawStation) {
  const station = normalizeRadioStation(rawStation, {
    source: text(rawStation?.source || rawStation?.Source, "shared")
  });
  if (!station) {
    throw new Error(getConfig()?.languageLabels?.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  const targetKey = stationKey(station);
  if (!targetKey) {
    throw new Error(getConfig()?.languageLabels?.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  const configData = await fetchJmsConfig().catch(() => ({}));
  if (sharedBackendMode === "manual") {
    const nextLocal = readLocalSharedStations().filter((item) => stationKey(item) !== targetKey);
    writeLocalSharedStations(nextLocal.map(toSharedRecord));
    return loadManualSharedStations();
  }

  const currentStations = readSharedStationsFromConfig(configData);
  const nextStations = currentStations.filter((item) => stationKey(item) !== targetKey);
  await persistSharedRadioStations(nextStations);

  musicPlayerState.radioSharedStations = nextStations;
  return nextStations;
}

export async function submitStationToDirectory(rawStation) {
  const station = normalizeRadioStation(rawStation);
  if (!station) {
    throw new Error(getConfig()?.languageLabels?.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  const payload = {
    name: station.name,
    url: station.url_resolved || station.url,
    homepage: station.homepage,
    favicon: station.logo || station.favicon,
    countrycode: station.countrycode,
    state: station.state,
    language: station.language,
    tags: station.tags
  };

  return fetchRadioBrowser("/json/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function activateRadioPlaylist(stations, startIndex = 0) {
  const tracks = normalizeRadioStations(stations)
    .map(toRadioTrack)
    .filter(Boolean);

  if (!tracks.length) return -1;

  const nextIndex = Math.max(0, Math.min(tracks.length - 1, Number(startIndex) || 0));

  musicPlayerState.playlist = tracks;
  musicPlayerState.originalPlaylist = [...tracks];
  musicPlayerState.effectivePlaylist = [...tracks];
  musicPlayerState.currentIndex = nextIndex;
  musicPlayerState.currentPlaylistId = null;
  musicPlayerState.playlistSource = "radio";
  musicPlayerState.isUserModified = false;
  musicPlayerState.combinedPlaylist = [];

  return nextIndex;
}

function shouldUseHls(url) {
  const value = text(url).toLowerCase();
  return value.includes(".m3u8");
}

async function ensureHlsLibrary() {
  if (window.Hls) return window.Hls;
  if (hlsReadyPromise) return hlsReadyPromise;

  hlsReadyPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hls-library="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls || null), { once: true });
      existing.addEventListener("error", () => reject(new Error("hls.js yuklenemedi")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = RADIO_SOURCE_PATH;
    script.async = true;
    script.defer = true;
    script.dataset.hlsLibrary = "1";
    script.onload = () => resolve(window.Hls || null);
    script.onerror = () => reject(new Error("hls.js yuklenemedi"));
    document.head.appendChild(script);
  });

  return hlsReadyPromise;
}

export function cleanupAttachedRadioStream(audio) {
  if (!audio) return;
  stopRadioMetadataReader(audio);
  if (!audio._radioHls) return;
  try { audio._radioHls.destroy(); } catch {}
  delete audio._radioHls;
}

export async function attachRadioStream(audio, url, options = {}) {
  if (!audio) throw new Error("Audio elementi bulunamadi");

  const onMetadata = typeof options.onMetadata === "function"
    ? options.onMetadata
    : null;
  const disableMetadataReader = options.disableMetadataReader === true;

  const streamUrl = normalizeUrl(url);
  if (!streamUrl) {
    throw new Error(getConfig()?.languageLabels?.radioStreamNotFound || "Yayin adresi bulunamadi");
  }

  cleanupAttachedRadioStream(audio);

  if (shouldUseHls(streamUrl)) {
    const HlsRef = await ensureHlsLibrary().catch(() => null);
    if (HlsRef?.isSupported?.()) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const hls = new HlsRef({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 60 * 1000 * 1000
        });

        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanupAttachedRadioStream(audio);
          reject(error);
        };

        hls.on(HlsRef.Events.MANIFEST_PARSED, () => {
          if (settled) return;
          settled = true;
          resolve({ url: streamUrl, hls: true });
        });

        if (onMetadata && HlsRef.Events?.FRAG_PARSING_METADATA) {
          hls.on(HlsRef.Events.FRAG_PARSING_METADATA, (_event, data) => {
            const samples = Array.isArray(data?.samples) ? data.samples : [];
            for (const sample of samples) {
              const parsed = parseHlsMetadataSample(sample);
              if (parsed?.displayText) {
                onMetadata(parsed);
              }
            }
          });
        }

        hls.on(HlsRef.Events.ERROR, (event, data) => {
          if (!data?.fatal) return;

          switch (data.type) {
            case HlsRef.ErrorTypes.NETWORK_ERROR:
              try { hls.startLoad(); } catch {}
              break;
            case HlsRef.ErrorTypes.MEDIA_ERROR:
              try { hls.recoverMediaError(); } catch {}
              break;
            default:
              fail(new Error(data?.details || "HLS oynatma hatasi"));
              break;
          }
        });

        audio._radioHls = hls;
        try {
          hls.loadSource(streamUrl);
          hls.attachMedia(audio);
        } catch (error) {
          fail(error);
        }
      });
    }
  }

  audio.src = streamUrl;
  audio.load();
  if (onMetadata && !disableMetadataReader && !isRadioPlaylistUrl(streamUrl)) {
    startIcyMetadataReader(audio, streamUrl, onMetadata).catch(() => {});
  }
  return { url: streamUrl, hls: false };
}
