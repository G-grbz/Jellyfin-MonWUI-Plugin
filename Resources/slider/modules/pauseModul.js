import { getSessionInfo, fetchItemDetails, makeApiRequest, isAuthReadyStrict } from "./api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { withServer } from "./jfUrl.js";

function _numFinite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _msFromConfig(pathValue, fallbackMs) {
  const n = _numFinite(pathValue, fallbackMs);
  return Math.max(0, n);
}

const DEBUG_PO = !!(getConfig()?.pauseOverlay?.debug);
function dlog(...args) { if (DEBUG_PO) console.log(...args); }
function ddbg(...args) { if (DEBUG_PO) console.debug(...args); }

const config = getConfig();
const currentLang = config.defaultLanguage || getDefaultLanguage();
const labels = getLanguageLabels(currentLang) || {};
const imageBlobCache = new Map();
const TAG_MEM_TTL_MS = Math.max(
  0,
  Number(getConfig()?.pauseOverlay?.tagsCacheTtlMs ?? 6 * 60 * 60 * 1000)
);

const SHOW_AGE_BADGE  = getConfig()?.pauseOverlay?.showAgeBadge !== false;
const BADGE_DELAY_MS = Math.max(0, Number(getConfig()?.pauseOverlay?.badgeDelayMs ?? 4500));
const BADGE_DELAY_RESUME_MS = Math.max(
  0,
  Number(getConfig()?.pauseOverlay?.badgeDelayResumeMs ?? BADGE_DELAY_MS)
);

const AGE_BADGE_DEFAULT_MS = _msFromConfig(
  getConfig()?.pauseOverlay?.ageBadgeDurationMs,
  15000
);

const AGE_BADGE_RESUME_MS = _msFromConfig(
  getConfig()?.pauseOverlay?.ageBadgeDurationResumeMs,
  AGE_BADGE_DEFAULT_MS
);

const BADGE_LOCK_MS = Math.max(0, Number(getConfig()?.pauseOverlay?.ageBadgeLockMs ?? 4000));
const _detailsLRU = new Map();
const DETAILS_TTL = 90_000;
const DETAILS_MAX = 120;

const _maturityLRU = new Map();
const MAT_TTL = _msFromConfig(getConfig()?.pauseOverlay?.maturityCacheTtlMs, 10 * 60 * 1000);
const MAT_MAX = 200;

function _maturitySig(d){
  const id = d?.Id || "";
  const r  = String(d?.OfficialRating || "");
  const g  = Array.isArray(d?.Genres) ? d.Genres.join("|") : "";
  const t  = Array.isArray(d?.Tags) ? d.Tags.join("|")
           : Array.isArray(d?.Keywords) ? d.Keywords.join("|") : "";
  return `${id}::${r}::${g}::${t}`;
}

function _computeMaturityUi(data){
  const age = normalizeAgeChip(data?.OfficialRating);

  const locGenres = localizedGenres(data?.Genres || []).filter(Boolean);
  locGenres.sort((a,b)=>String(a).localeCompare(String(b), undefined, { sensitivity:"base" }));

  const descFromTags = deriveTagDescriptors(data);
  const descFromHeur = (!descFromTags.length && !locGenres.length) ? deriveKeywordDescriptors(data) : [];

  const line2Arr = descFromTags.length
    ? descFromTags.slice(0,2)
    : locGenres.length
      ? locGenres.slice(0,2)
      : descFromHeur.slice(0,2);

  const icons = buildIconListForItem(data);
  return { age, line2Arr, icons };
}

function getMaturityUiCached(data){
  const sig = _maturitySig(data);
  const now = Date.now();
  const rec = _maturityLRU.get(sig);
  if (rec && (now - rec.t) < MAT_TTL) return rec.v;
  const v = _computeMaturityUi(data);
  _maturityLRU.set(sig, { v, t: now });
  if (_maturityLRU.size > MAT_MAX) {
    const first = _maturityLRU.keys().next().value;
    _maturityLRU.delete(first);
  }
  return v;
}

function _badgeDelayFor(ctx){
  return (ctx === "resume") ? BADGE_DELAY_RESUME_MS : BADGE_DELAY_MS;
}

function _badgeDurationFor(ctx){
  return (ctx === "resume") ? AGE_BADGE_RESUME_MS : AGE_BADGE_DEFAULT_MS;
}

async function fetchItemDetailsCached(id, { signal } = {}) {
  if (!id) return null;
  const rec = _detailsLRU.get(id);
  const now = Date.now();
  if (rec && now - rec.t < DETAILS_TTL) return rec.v;
  const v = await fetchItemDetails(id, signal ? { signal } : undefined);
  _detailsLRU.set(id, { v, t: now });
  if (_detailsLRU.size > DETAILS_MAX) {
    const first = _detailsLRU.keys().next().value;
    _detailsLRU.delete(first);
  }
  return v;
}

let _tagsMemCache = { stamp: null, savedAt: 0, tags: null };
let ratingGenreTimeout = null;
let _badgeShownAt = 0;
let ratingGenreElement = null;
let currentMediaData = null;
let activeVideo = null;
let currentMediaId = null;
let removeHandlers = null;
let removeHandlersToken = null;
let overlayVisible = false;
let pauseTimeout = null;
let lastActivityAt = Date.now();
let blurAt = null;
let hiddenAt = null;
let lastPauseReason = null;
let lastPauseAt = 0;
let _cpiLastRawId = null;
let _cpiChangeAt = 0;
let _playStartAt = 0;
let _scanDepth = 8;
let _recoItemsCache = [];
let _recoBadgeEl = null;
let _recoPanelEl = null;
let _recoListEl = null;
let _recoToggleEl = null;
let _recoPanelOpen = false;
let _overlayIdleTimer = null;
let _mouseIdleTimer = null;
let _iconEl = null;
let _iconTimeout = null;
let _playEventAt = 0;
let _sessLast = { itemId: null, isPaused: null, t: 0 };
let _sessRawLast = null;
let _sessChangeAt = 0;
let _sessHealthyAt = 0;

async function fetchNowPlayingFromSessions(){
  try {
    const uid = getUserIdSafe();
    if (!uid) return { itemId:null,isPaused:null };

    const sessions = await makeApiRequest(withServer(`/Sessions`));
    const list = Array.isArray(sessions)?sessions:[];

    const mine = list.filter(s=>s?.UserId===uid);
    const active = mine.find(s=>s?.NowPlayingItem?.Id) || mine[0];
    if (!active) return { itemId:null,isPaused:null };

    const r = {
      itemId: active.NowPlayingItem?.Id || null,
      isPaused: active.PlayState?.IsPaused ?? null
    };

    if (r.itemId) _sessHealthyAt = Date.now();
    return r;
  } catch {
    return { itemId:null,isPaused:null };
  }
}

function getItemIdFromDom() {
  const selectors = [
    '.videoOsdBottom-hidden > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    'div.page:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    '.btnUserRating',
    '[data-id][is="paper-icon-button-light"].btnUserRating',
    '.btnUserRating[data-id]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const id = el?.getAttribute?.('data-id');
    if (id) return id;
  }
  return null;
}

function getStableItemIdDomFirst() {
  const domId = getItemIdFromDom();
  if (domId) return domId;

  if (activeVideo) {
    const srcId = parsePlayableIdFromVideo(activeVideo);
    if (srcId) return srcId;
  }

  return null;
}

async function getStableItemIdViaSessions(minStableMs=350){
  const r = await fetchNowPlayingFromSessions();
  const now = Date.now();
  const raw = r.itemId;

  if (raw !== _sessRawLast){
    _sessRawLast = raw;
    _sessChangeAt = now;
    return null;
  }
  if (!raw) return null;
  if (now - _sessChangeAt < minStableMs) return null;
  return raw;
}

function getMinVideoDurationSec() {
   const po = config?.pauseOverlay || {};
   if (po.minVideoDurationSec != null) return Math.max(0, Number(po.minVideoDurationSec));
   if (po.minVideoMinutes != null)    return Math.max(0, Number(po.minVideoMinutes)) * 60;
   const raw = localStorage.getItem('pauseOverlayMinVideoMinutes');
   const mins = Number(raw);
   return (Number.isFinite(mins) && mins > 0) ? mins * 60 : 300;
 }

function relaxScanDepth() { _scanDepth = 4; }

function parsePlayableIdFromVideo(videoEl) {
  try {
    const u = new URL(videoEl?.currentSrc || videoEl?.src || "", location.href);
    return (
      u.searchParams.get("ItemId") ||
      u.searchParams.get("itemId") ||
      u.searchParams.get("MediaSourceId") ||
      u.searchParams.get("mediaSourceId") ||
      null
    );
  } catch {
    return null;
  }
}

function hardResetBadgeOverlay() {
  hideRatingGenre('finished');
  currentMediaData = null;
  currentMediaId = null;
}

if (!window.__jmsPauseOverlay) {
  window.__jmsPauseOverlay = { destroy: null, active: false };
}

function _mkLifecycle() {
  const lc = {
    abort: new AbortController(),
    timers: new Set(),
    rafId: null,
    observers: new Set(),
    cleans: new Set(),
    cleanTokens: new Map(),
    lastToken: 0,
  };
  const { signal } = lc.abort;
  lc.addTimeout = (fn, ms) => {
    const id = setTimeout(fn, ms);
    lc.timers.add({ id, t: "t" });
    return id;
  };
  lc.addInterval = (fn, ms) => {
    const id = setInterval(fn, ms);
    lc.timers.add({ id, t: "i" });
    return id;
  };
  lc.addRaf = (fn) => {
    if (lc.rafId != null) cancelAnimationFrame(lc.rafId);
    lc.rafId = requestAnimationFrame(fn);
    return lc.rafId;
  };
  lc.trackMo = (mo) => {
    lc.observers.add(mo);
    return mo;
  };
  lc.trackClean = (fn) => {
    if (typeof fn !== "function") return null;
    const token = ++lc.lastToken;
    lc.cleans.add(fn);
    lc.cleanTokens.set(token, fn);
    return token;
  };
  lc.untrackClean = (token) => {
    const fn = lc.cleanTokens.get(token);
    if (!fn) return;
    lc.cleans.delete(fn);
    lc.cleanTokens.delete(token);
  };
  lc.cleanupAll = () => {
    try {
      lc.abort.abort();
    } catch {}
    for (const x of lc.timers) (x.t === "i" ? clearInterval : clearTimeout)(x.id);
    lc.timers.clear();
    if (lc.rafId != null) {
      cancelAnimationFrame(lc.rafId);
      lc.rafId = null;
    }
    for (const mo of lc.observers) {
      try {
        mo.disconnect();
      } catch {}
    }
    lc.observers.clear();
    for (const fn of lc.cleans) {
      try {
        fn();
      } catch {}
    }
    lc.cleans.clear();
    lc.cleanTokens.clear();
  };
  lc.signal = signal;
  return lc;
}

function wipeBadgeStateAndDom() {
  try {
    if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout);
  } catch {}
  ratingGenreTimeout = null;
  currentMediaData = null;
  if (ratingGenreElement && ratingGenreElement.parentNode) {
    ratingGenreElement.parentNode.removeChild(ratingGenreElement);
  }
  ratingGenreElement = null;
  try { wipeIconBadges(); } catch {}
}

function hideRatingGenre(reason) {
  if (DEBUG_PO) console.log("[badge] hideRatingGenre", reason, new Error().stack?.split("\n")[2]);
  if (!ratingGenreElement) return;
  ratingGenreElement.classList.remove("visible");
  if (reason === "auto" || reason === "finished") {
    try { if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout); } catch {}
    ratingGenreTimeout = setTimeout(() => {
      wipeBadgeStateAndDom();
    }, 360);
  }
  try { hideIconBadges(reason); } catch {}
}

function srcLooksLikeThemeVideo(videoEl) {
  try {
    const s = String(videoEl?.currentSrc || videoEl?.src || "");
    if (!s) return false;
    return /(?:^|[\/_\-\?&=])theme(?:[\/_\-\.=&]|$)/i.test(s);
  } catch {
    return false;
  }
}
function isThemeItemName(item) {
  if (!item) return false;
  const name = String(item.Name || item.OriginalTitle || "").toLowerCase();
  return name.includes("theme");
}
function shouldIgnoreTheme({ video = null, item = null } = {}) {
  if (video && srcLooksLikeThemeVideo(video)) return true;
  if (item && isThemeItemName(item)) return true;
  return false;
}

function getApiClientSafe() {
  return (window.ApiClient && typeof window.ApiClient.serverAddress === 'function')
    ? window.ApiClient
    : null;
}

function getApiBase() {
  const api = getApiClientSafe();
  return withServer('');
}

function getUserIdSafe() {
  const api = getApiClientSafe();
  return (api && typeof api.getCurrentUserId === 'function' && api.getCurrentUserId())
    || getConfig()?.userId
    || null;
}

async function getStableItemIdFromSessionsStable(minStableMs = 350){
  return await getStableItemIdViaSessions(minStableMs);
}

async function fetchFiltersFor(type) {
  const qs = new URLSearchParams({
    IncludeItemTypes: type,
    Recursive: "true",
  });
  try {
    if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) return {};
    const res = await makeApiRequest(withServer(`/Items/Filters?${qs.toString()}`));
    return res || {};
  } catch (e) {
    if (e?.status === 401 || e?.status === 403 || e?.status === 0 || e?.isAbort) return {};
    throw e;
  }
}
function _computeStamp() {
  return [withServer(''), getUserIdSafe() || ''].join('|');
}
async function loadCatalogTagsWithCache() {
  const stamp = _computeStamp();
  const now = Date.now();
  if (
    _tagsMemCache.tags &&
    _tagsMemCache.stamp === stamp &&
    now - _tagsMemCache.savedAt < TAG_MEM_TTL_MS
  ) {
    return _tagsMemCache.tags;
  }
  if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
    return new Set();
  }
  const [movie, series] = await Promise.all([
    fetchFiltersFor("Movie"),
    fetchFiltersFor("Series"),
  ]);
  const allTagsArr = [
    ...(movie?.Tags || []),
    ...(series?.Tags || []),
  ];
  const allTags = new Set(allTagsArr);
  if (allTags.size > 0) {
    _tagsMemCache = { stamp, savedAt: now, tags: allTags };
  }
  return allTags;
}

function normalizeAgeChip(rating) {
  if (!rating) return labels?.noRating || "Derecelendirme yok";
  const r = String(rating).toUpperCase().trim().replace(/\s+/g, "").replace(/-/g, "");
  if (/(18\+|R18|ADULT|NC17|NC\-?17|XRATED|XXX|ADULTSONLY|AO|TR18|DE18|FSK18)/.test(r)) return "18+";
  if (/(17\+|^R$|TVMA|TR17)/.test(r)) return "17+";
  if (/(16\+|R16|^M$|MATURE|TR16|DE16|FSK16)/.test(r)) return "16+";
  if (/(15\+|TV15|TR15)/.test(r)) return "15+";
  if (/(13\+|TV14|PG13|PG\-?13|TEEN|TR13|DE12A?)/.test(r)) return "13+";
  if (/(12\+|TV12|TR12|DE12|FSK12)/.test(r)) return "12+";
  if (/(11\+|TR11)/.test(r)) return "11+";
  if (/(10\+|TVY10|TR10)/.test(r)) return "10+";
  if (/(9\+|TR9)/.test(r)) return "9+";
  if (/(7\+|TVY7|E10\+?|TR7|DE6|FSK6)/.test(r)) return "7+";
  if (/(G|^PG$|TVG|TVPG|E$|EVERYONE|U$|UC|UNIVERSAL|TR6|DE0|FSK0)/.test(r)) return "7+";
  if (/(ALLYEARS|ALLAGES|ALL|TVY|KIDS|^Y$|0\+|TR0)/.test(r)) return "0+";
  const m = r.match(/^(\d{1,2})\+?$/);
  if (m) return `${m[1]}+`;
  return r;
}

function normalizeAgeRating(raw) {
  if (!raw) return labels?.noRating || "Derecelendirme yok";
  const s = String(raw).toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (/^TVMA$/.test(s)) return "18+";
  if (/^TV14$/.test(s)) return "14+";
  if (/^TVPG$/.test(s)) return "7+";
  if (/^TVG$/.test(s)) return labels?.genel;
  if (s === "NC17") return "18+";
  if (s === "R") return "18+";
  if (s === "PG13") return "13+";
  if (s === "PG") return "7+";
  if (s === "G") return labels?.genel;
  if (s === "18") return "18+";
  if (s === "15") return "15+";
  if (s === "12" || s === "12A") return "12+";
  if (s === "FSK18") return "18+";
  if (s === "FSK16") return "16+";
  if (s === "FSK12") return "12+";
  if (s === "FSK6") return "6+";
  if (s === "FSK0") return labels?.genel;
  const m = s.match(/^(\d{1,2})\+?$/);
  if (m) return `${m[1]}+`;
  return s;
}

function localizedMaturityHeader() {
  const lang = String(currentLang || "").toLowerCase();
  if (labels.maturityHeader) return labels.maturityHeader;
  if (lang.startsWith("en")  || lang.startsWith("eng")) return "MATURITY RATING:";
  if (lang.startsWith("de")  || lang.startsWith("deu")) return "ALTERSFREIGABE:";
  if (lang.startsWith("fr")  || lang.startsWith("fre")) return "CLASSIFICATION :";
  if (lang.startsWith("ru")  || lang.startsWith("rus")) return "ВОЗРАСТНОЕ ОГРАНИЧЕНИЕ:";
  return "YETİŞKİNLİK DÜZEYİ:";
}
function localizedGenres(genres = []) {
  if (!Array.isArray(genres) || !genres.length) return [];
  const dict = labels?.turler || {};
  const lc = Object.fromEntries(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v]));
  return genres.map((g) => dict[g] || lc[String(g).toLowerCase()] || g);
}
function descriptorLabel(code) {
  const dict = labels?.descriptors || {};
  const fallback = {
    violence: "violence",
    sex: "sexual content",
    nudity: "nudity",
    horror: "horror/thriller",
    drugs: "drug use",
    profanity: "strong language",
    crime: "crime",
    war: "war",
    discrimination: "discrimination",
    mature: "mature themes",
  };
  return dict[code] || fallback[code] || code;
}
function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const _WORD_RX_CACHE = new Map();
function _getWordRxCached(words) {
  if (!Array.isArray(words) || !words.length) return null;
  const key = words.join('|');
  let rx = _WORD_RX_CACHE.get(key);
  if (!rx) {
    const pat = words.map((w) => _escapeRe(String(w.trim()))).join("|");
    rx = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${pat})(?=$|[^\\p{L}\\p{N}_])`, "iu");
    if (_WORD_RX_CACHE.size > 64) _WORD_RX_CACHE.clear();
    _WORD_RX_CACHE.set(key, rx);
  }
  return rx;
}

function _buildWordRx(words) {
  return _getWordRxCached(words);
}
function tokenIncludes(text, needles) {
  if (!text) return false;
  const rx = _getWordRxCached(needles);
  return !!(rx && rx.test(String(text)));
}
function countMatches(text, words) {
  if (!text || !words?.length) return 0;
  const rx = _buildWordRx(words);
  if (!rx) return 0;
  let s = String(text),
    c = 0,
    m;
  while ((m = rx.exec(s))) {
    c++;
    s = s.slice(m.index + m[0].length);
  }
  return c;
}

const BUCKETS = [
  {
    key: "superhero",
    needles: [
      "superhero",
      "super hero",
      "superheroes",
      "comic book superhero",
      "comic book hero",
      "superhuman",
      "super powers",
      "superpower",
      "super strength",
      "cape",
      "masked vigilante",
      "vigilante",
      "secret identity",
      "alter ego",
      "supervillain",
      "super villain",
      "anti hero",
      "antihero",
      "marvel",
      "marvel comics",
      "dc",
      "dc comics",
      "marvel cinematic universe",
      "mcu",
      "dc extended universe",
      "dceu",
      "justice league",
      "avengers",
      "x men",
      "x-men",
      "spider man",
      "spider-man",
      "batman",
      "superman",
      "wonder woman",
      "iron man",
      "captain america",
      "thor",
      "hulk",
      "deadpool",
      "venom",
    ],
  },

  {
    key: "sci_fi_tech",
    needles: [
      "science fiction",
      "sci fi",
      "sci-fi",
      "science-fiction",
      "bilim kurgu",
      "naçnaya fantastika",
      "научная фантастика",
      "science-fiction",
      "ciencia ficcion",
      "space travel",
      "space mission",
      "space exploration",
      "space station",
      "spaceship",
      "spacecraft",
      "rocket",
      "astronaut",
      "interstellar",
      "outer space",
      "cosmic voyage",
      "first contact",
      "alien",
      "aliens",
      "alien invasion",
      "extraterrestrial",
      "ufo",
      "martian",
      "space opera",
      "space colony",
      "cyberpunk",
      "dystopia",
      "dystopian future",
      "post apocalyptic",
      "post-apocalyptic",
      "apocalyptic future",
      "time travel",
      "time loop",
      "time machine",
      "alternate timeline",
      "parallel universe",
      "alternate universe",
      "multiverse",
      "wormhole",
      "simulation",
      "simulated reality",
      "virtual reality",
      "vr",
      "artificial intelligence",
      "machine intelligence",
      "android",
      "robot",
      "robots",
      "cyborg",
      "mecha",
      "droid",
      "humanoid robot",
      "genetic engineering",
      "clone",
      "cloning",
      "mutation",
      "mutant",
      "mutants",
      "nanotechnology",
    ],
  },

  {
    key: "horror",
    needles: [
      "horror",
      "horreur",
      "ужасы",
      "korku",
      "slasher",
      "splatter",
      "found footage",
      "haunted house",
      "haunted",
      "haunting",
      "possession",
      "demonic possession",
      "demon",
      "demons",
      "exorcism",
      "occult",
      "satanic",
      "curse",
      "cursed",
      "nightmare",
      "gore",
      "gruesome",
      "bloodshed",
      "ghost",
      "ghosts",
      "spirit",
      "spirits",
      "poltergeist",
      "zombie",
      "zombies",
      "zombie apocalypse",
      "vampire",
      "vampires",
      "werewolf",
      "werewolves",
    ],
  },

  {
    key: "monster",
    needles: [
      "monster",
      "monsters",
      "creature feature",
      "giant monster",
      "kaiju",
      "godzilla",
      "mothra",
      "rodan",
      "giant creature",
      "giant animal",
      "giant spider",
      "giant snake",
      "dinosaur",
      "dinosaurs",
      "tyrannosaurus rex",
      "t-rex",
      "loch ness",
      "sea monster",
      "mutant creature",
    ],
  },

  {
    key: "war",
    needles: [
      "war",
      "warfare",
      "battle",
      "battlefield",
      "frontline",
      "trenches",
      "soldier",
      "army",
      "military",
      "navy",
      "air force",
      "marines",
      "combat mission",
      "world war",
      "world war i",
      "world war ii",
      "ww1",
      "ww2",
      "wwii",
      "vietnam war",
      "korean war",
      "gulf war",
      "civil war",
    ],
  },

  {
    key: "crime",
    needles: [
      "crime",
      "criminal",
      "organized crime",
      "underworld",
      "mafia",
      "mob",
      "gang",
      "gangster",
      "cartel",
      "drug cartel",
      "yakuza",
      "triad",
      "heist",
      "bank heist",
      "bank robbery",
      "robbery",
      "kidnapping",
      "abduction",
      "murder",
      "homicide",
      "serial killer",
      "hitman",
      "assassin",
      "money laundering",
      "police corruption",
    ],
  },

  {
    key: "violence",
    needles: [
      "violence",
      "violent",
      "brutal",
      "brutality",
      "blood",
      "bloody",
      "gore",
      "torture",
      "massacre",
      "gunfight",
      "shootout",
      "shooting",
      "sniper",
      "assault rifle",
      "knife fight",
      "stabbing",
      "explosion",
      "bombing",
      "grenade",
      "martial arts",
      "hand to hand combat",
    ],
  },

  {
    key: "sex",
    needles: [
      "sexual content",
      "sex",
      "sexual",
      "erotic",
      "erotica",
      "pornography",
      "pornographic",
      "sex scene",
      "orgy",
    ],
  },

  {
    key: "nudity",
    needles: [
      "nudity",
      "nude",
      "full frontal",
      "topless",
      "naked",
      "striptease",
    ],
  },

  {
    key: "profanity",
    needles: [
      "strong language",
      "explicit language",
      "profanity",
      "swearing",
      "vulgar",
      "obscene",
    ],
  },

  {
    key: "drugs",
    needles: [
      "drug use",
      "drugs",
      "drug abuse",
      "drug addiction",
      "narcotics",
      "drug dealer",
      "drug trafficking",
      "cocaine",
      "heroin",
      "meth",
      "opioid",
      "overdose",
    ],
  },

  {
    key: "discrimination",
    needles: [
      "racism",
      "sexism",
      "homophobia",
      "hate speech",
      "slur",
      "discrimination",
      "antisemitism",
      "islamophobia",
      "xenophobia",
    ],
  },

  {
    key: "mature",
    needles: [
      "adult themes",
      "mature themes",
      "psychological trauma",
      "trauma",
      "abuse",
      "domestic violence",
      "sexual assault",
      "rape",
      "incest",
      "suicide",
      "self harm",
      "self-harm",
      "child abuse",
      "child molestation",
    ],
  },

  {
    key: "supernatural",
    needles: [
      "supernatural",
      "paranormal",
      "paranormal activity",
      "spirit",
      "spirits",
      "curse",
      "cursed",
      "witch",
      "witchcraft",
      "sorcery",
      "magic ritual",
      "djinn",
      "demonic",
      "possession",
    ],
  },

  {
    key: "historical",
    needles: [
      "historical",
      "historical drama",
      "period drama",
      "based on history",
      "victorian era",
      "renaissance",
      "medieval",
      "ancient rome",
      "ancient greece",
      "ancient egypt",
      "ottoman empire",
      "byzantium",
    ],
  },

  {
    key: "fairytale",
    needles: [
      "fairy tale",
      "fairytale",
      "folk tale",
      "fable",
      "storybook",
      "princess",
      "prince",
      "kingdom",
      "enchanted forest",
    ],
  },

  {
    key: "fantasy_magic",
    needles: [
      "fantasy",
      "high fantasy",
      "dark fantasy",
      "magic",
      "wizard",
      "sorcerer",
      "witch",
      "spell",
      "dragon",
      "dragons",
      "myth",
      "mythology",
      "legend",
      "sword and sorcery",
      "enchanted",
    ],
  },

  {
    key: "thriller_suspense",
    needles: [
      "thriller",
      "suspense",
      "psychological thriller",
      "conspiracy",
      "manhunt",
      "hostage",
      "home invasion",
      "stalker",
      "kidnapping",
      "espionage",
      "spy thriller",
    ],
  },

  {
    key: "mystery_detective",
    needles: [
      "mystery",
      "detective",
      "whodunit",
      "crime investigation",
      "investigation",
      "private detective",
      "noir",
      "neo noir",
      "cold case",
      "clues",
    ],
  },

  {
    key: "romance_love",
    needles: [
      "romance",
      "romantic",
      "romantic drama",
      "love story",
      "love affair",
      "falling in love",
      "forbidden love",
      "romcom",
      "relationship",
    ],
  },

  {
    key: "comedy_humor",
    needles: [
      "comedy",
      "humor",
      "funny",
      "satire",
      "parody",
      "spoof",
      "slapstick",
      "dark comedy",
    ],
  },

  {
    key: "drama_family",
    needles: [
      "drama",
      "family drama",
      "family",
      "family conflict",
      "coming of age",
      "teenage life",
      "friendship",
      "grief",
      "loss",
      "parenting",
      "siblings",
    ],
  },

  {
    key: "action_adventure",
    needles: [
      "action",
      "action adventure",
      "adventure",
      "quest",
      "expedition",
      "treasure hunt",
      "chase",
      "car chase",
      "escape",
      "survival mission",
    ],
  },

  {
    key: "animation_kids",
    needles: [
      "animation",
      "animated",
      "cartoon",
      "family friendly",
      "kids",
      "children",
      "pixar",
      "disney",
      "stop motion",
      "stop-motion",
    ],
  },

  {
    key: "documentary_biopic",
    needles: [
      "documentary",
      "docudrama",
      "biography",
      "biographical",
      "biopic",
      "based on true story",
      "true story",
      "real events",
      "historical documentary",
      "nature documentary",
    ],
  },

  {
    key: "music_dance",
    needles: [
      "music",
      "musical",
      "concert",
      "band",
      "singer",
      "songwriter",
      "dance",
      "ballet",
      "hip hop",
      "hip-hop",
      "jazz",
    ],
  },

  {
    key: "sports",
    needles: [
      "sports",
      "boxing",
      "mma",
      "ufc",
      "football",
      "soccer",
      "basketball",
      "baseball",
      "tennis",
      "racing",
      "grand prix",
    ],
  },

  {
    key: "western",
    needles: [
      "western",
      "cowboy",
      "gunslinger",
      "outlaw",
      "wild west",
      "frontier",
      "spaghetti western",
    ],
  },

  {
    key: "political",
    needles: [
      "political",
      "politics",
      "political thriller",
      "election",
      "campaign",
      "white house",
      "government conspiracy",
      "coup",
      "authoritarianism",
      "totalitarian",
    ],
  },

  {
    key: "religion_myth",
    needles: [
      "religion",
      "religious",
      "faith",
      "religious cult",
      "cult",
      "biblical",
      "bible",
      "christianity",
      "islam",
      "judaism",
      "hinduism",
      "buddhism",
      "mythology",
      "norse mythology",
      "greek mythology",
    ],
  },

  {
    key: "survival_disaster",
    needles: [
      "disaster",
      "disaster movie",
      "earthquake",
      "tsunami",
      "flood",
      "hurricane",
      "tornado",
      "volcano",
      "pandemic",
      "outbreak",
      "apocalypse",
      "doomsday",
      "survival",
      "trapped",
    ],
  },

  {
    key: "period_era",
    needles: [
      "period piece",
      "period drama",
      "18th century",
      "19th century",
      "20th century",
      "1920s",
      "1930s",
      "1940s",
      "1950s",
      "1960s",
      "1970s",
      "1980s",
      "1990s",
    ],
  },

  {
    key: "travel_road",
    needles: [
      "road movie",
      "road trip",
      "journey",
      "travel",
      "travelling",
      "tour",
      "expedition",
      "backpacking",
    ],
  },

  {
    key: "animals_nature",
    needles: [
      "animals",
      "animal",
      "wildlife",
      "nature",
      "nature documentary",
      "animal attack",
      "shark attack",
      "bear",
      "wolf",
      "tiger",
      "lion",
      "dolphin",
      "whale",
    ],
  },
];

const _NEEDLE_INDEX = (() => {
  const idx = new Map();
  const add = (k, bucket) => {
    if (!k) return;
    let set = idx.get(k);
    if (!set) idx.set(k, (set = new Set()));
    set.add(bucket);
    };

   for (const b of BUCKETS) {
     for (const raw of b.needles) {
      const full = String(raw).toLowerCase().trim();
      if (!full) continue;
      add(full, b.key);
      const toks = full.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      for (const tk of toks) add(tk, b.key);
     }
   }
   return idx;
 })();

function _tokenizeTag(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function _bucketsForTag(tag) {
  const norm = _normTag(tag);
  const tokens = _tokenizeTag(norm);
  const hits = new Set();
  const direct = _NEEDLE_INDEX.get(norm);
  if (direct) for (const k of direct) hits.add(k);

   for (const tk of tokens) {
     const set = _NEEDLE_INDEX.get(tk);
     if (set) for (const k of set) hits.add(k);
   }
   return hits;
 }

const NEGATIVE_WORDS = {
  fairytale: ['war','battle','soldier','army','frontline','sniper','bomb','grenade','blood','gore','massacre'],
  romance_love: ['battlefield','massacre','genocide'],
  animation_kids: ['explicit','gore','slasher','torture'],
  music_dance: ['massacre','battlefield'],
  documentary_biopic: ['space battle','wizard','dragon'],
};

const BUCKET_PRIORITY = [
  'war','crime','violence','horror','thriller_suspense','mystery_detective',
  'sci_fi_tech','fantasy_magic','supernatural',
  'historical','political','survival_disaster',
  'action_adventure','drama_family','romance_love','comedy_humor',
  'documentary_biopic','sports','music_dance','western',
  'animation_kids','animals_nature','travel_road','period_era','monster',
  'superhero','fairytale'
];

function buildAutoDescriptorTagMap(catalogTags) {
   const map = {};
   for (const b of BUCKETS) map[b.key] = [];
   for (const t of catalogTags) {
     const hitKeys = _bucketsForTag(t);
     if (!hitKeys.size) continue;
     for (const k of hitKeys) map[k].push(t);
   }
   return map;
 }
function getDescriptorTagMap() {
  if (labels?.descriptorTagMap && typeof labels.descriptorTagMap === "object") {
    return labels.descriptorTagMap;
  }

  const map = {};
  for (const b of BUCKETS) {
    map[b.key] = Array.isArray(b.needles) ? b.needles.slice() : [];
  }
  return map;
}

function hasAny(tag, needles) {
  return tokenIncludes(tag || "", needles || []);
}

function _normTag(s) {
  return String(s || "").toLowerCase().trim();
}

function deriveTagDescriptors(item = {}) {
  const raw = (item.Tags || item.Keywords || []).filter(Boolean);
  if (!raw.length) return [];
  const tags = raw.map(_normTag);
  const map = getDescriptorTagMap();

  const scores = [];
  for (const code of Object.keys(map)) {
   let s = 0;
   for (const tg of tags) {
     const hit = _bucketsForTag(tg);
     if (hit.has(code)) s += 1;
     const neg = NEGATIVE_WORDS[code] || [];
     for (const n of neg) {
       if (_tokenizeTag(tg).includes(String(n).toLowerCase())) s -= 1.5;
     }
   }
   if (s > 0) scores.push({ code, s });
 }
  if (!scores.length) return [];
  scores.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    return BUCKET_PRIORITY.indexOf(a.code) - BUCKET_PRIORITY.indexOf(b.code);
  });
  return scores.slice(0, 2).map((x) => descriptorLabel(x.code));
}
function getDescriptorKeywordMap() {
  const k = labels?.descriptorKeywords;
  if (k && typeof k === "object") return k;
  return {
    violence: ["violence", "violent", "fight", "combat", "assault", "brutal", "blood", "kavga", "şiddet", "savaş", "silah", "dövüş", "gewalt", "kampf", "brutal"],
    sex: ["sexual", "sex", "erotic", "intimate", "explicit sex", "cinsel", "erotik", "sexuell"],
    nudity: ["nudity", "nude", "çıplak", "nacktheit"],
    horror: ["horror", "thriller", "slasher", "gore", "supernatural", "paranormal", "korku", "gerilim", "dehşet", "übernatürlich"],
    drugs: ["drug", "narcotic", "cocaine", "heroin", "meth", "substance abuse", "uyuşturucu", "esrar", "eroin", "kokain", "drogen", "rauschgift", "alkol abuse"],
    profanity: ["strong language", "explicit language", "profanity", "swear", "vulgar", "küfür", "argo", "schimpf", "vulgär"],
    crime: ["crime", "criminal", "mafia", "gang", "heist", "robbery", "suç", "mafya", "soygun", "krimi", "verbrechen"],
    war: ["war", "battle", "army", "military", "conflict", "front", "savaş", "ordu", "asker", "krieg", "schlacht"],
    discrimination: ["racism", "sexism", "homophobia", "discrimination", "ayrımcılık", "ırkçılık", "cinsiyetçilik", "diskriminierung"],
    mature: ["adult themes", "abuse", "suicide", "self harm", "trauma", "domestic violence", "istismar", "intihar", "travma", "missbrauch", "suizid"],
  };
}
function deriveKeywordDescriptors(item = {}) {
  const overview = item.Overview || "";
  const taglines = (item.Taglines || []).join(" ") || "";
  const keysTags = (item.Keywords || item.Tags || []).join(" ") || "";
  const studios = (item.Studios || []).map((s) => s?.Name || s).join(" ");
  const WEIGHTS = { overview: 1.0, taglines: 0.6, keystags: 1.0, studios: 0.3 };
  const dict = getDescriptorKeywordMap();

  const scores = [];
  for (const [code, words] of Object.entries(dict)) {
    let s = 0;
    s += WEIGHTS.overview * countMatches(overview, words);
    s += WEIGHTS.taglines * countMatches(taglines, words);
    s += WEIGHTS.keystags * countMatches(keysTags, words);
    s += WEIGHTS.studios * countMatches(studios, words);
    const neg = NEGATIVE_WORDS[code] || [];
    s -= 1.2 * countMatches(overview + " " + keysTags, neg);
    if (s > 0.9) scores.push({ code, s });
  }
  if (!scores.length) return [];
  scores.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    return BUCKET_PRIORITY.indexOf(a.code) - BUCKET_PRIORITY.indexOf(b.code);
  });
  return scores.slice(0, 2).map((x) => descriptorLabel(x.code));
}

export function setupPauseScreen() {
  console.log("[PO] setupPauseScreen called", { active: window.__jmsPauseOverlay?.active });
  let _sessPollTimer=null;
  let _badgeCtx = "first";

function startSessionPoll(){
  if (_sessPollTimer) return;
  _sessPollTimer = setInterval(async ()=>{
    const r = await fetchNowPlayingFromSessions();
    const cur = { itemId:r.itemId, isPaused:r.isPaused };

    if (DEBUG_PO) {
      if (_sessLast.itemId !== cur.itemId){
        if (!_sessLast.itemId && cur.itemId) dlog("🎬 START",cur.itemId);
        else if (_sessLast.itemId && !cur.itemId) dlog("⛔ STOP",_sessLast.itemId);
        else if (_sessLast.itemId && cur.itemId) dlog("🔁 SWITCH",_sessLast.itemId,"→",cur.itemId);
      } else if (_sessLast.isPaused !== cur.isPaused && cur.itemId){
        dlog(cur.isPaused?"⏸ PAUSE":"▶ RESUME",cur.itemId);
      }
    }
    _sessLast = cur;
  },1200);
}

  startSessionPoll();

  const config = getConfig();
  const overlayConfig = config.pauseOverlay || { enabled: true };

  try {
    window.__jmsPauseOverlay?.destroy?.();
  } catch {}

  if (window.__jmsPauseOverlay?.active) {
    window.__jmsPauseOverlay.active = false;
  }

  window.__jmsPauseOverlay.active = true;

  const LC = _mkLifecycle();
  const { signal } = LC;
  let lazyTagMapReady = false;

  function _shouldIgnoreEarlyMetaResets() {
  const now = Date.now();
  if ((now - (_playEventAt || 0)) < 2500) return true;
  if (_badgeShownAt && (now - _badgeShownAt) < 2000) return true;

  return false;
}

  function wipeOverlayState() {
    resetContent();
    currentMediaId = null;
    currentMediaData = null;
  }

function tryBindOnce(reason = 'kick') {
  const v = findBestPlayableVideoAnywhere(12);
  if (v) {
    try {
      if (v === activeVideo || v.__jmsPOBound === true) return true;
    } catch {}

    _playStartAt = Date.now();
    return !!bindVideo(v, reason);
  }
  return false;
}

function kickBindRetries(schedule = [50,150,350,800,1500,2500,4000,6000,8000,12000]) {
    schedule.forEach((ms) => {
      LC.addTimeout(() => {
        try {
          if (activeVideo && activeVideo.__jmsPOBound === true) return;
        } catch {}
        tryBindOnce('kick@'+ms);
      }, ms);
    });
  }
  const _onRouteHint = () => {
    kickBindRetries();
  };

  window.addEventListener('hashchange', _onRouteHint, { signal });
  window.addEventListener('popstate', _onRouteHint, { signal });

  document.addEventListener('play', (e) => {
    const v = e?.target;
    if (v instanceof HTMLVideoElement) {
      try { bindVideo(v, 'doc-capture-play'); } catch {}
    }
  }, { capture: true, passive: true, signal });

  async function initDescriptorTagsOnce() {
    try {
      if (labels && labels.descriptorTagMap && typeof labels.descriptorTagMap === "object") return;
      const catalogTags = await loadCatalogTagsWithCache();
      const autoMap = buildAutoDescriptorTagMap(catalogTags);
      labels.descriptorTagMap = autoMap;
    } catch (e) {
      if (!(e?.status === 0 || e?.status === 401 || e?.status === 403 || e?.isAbort)) {
        console.warn("descriptor tag map init hata:", e);
      }
    }
  }

  function isShortActiveVideo() {
    const v = activeVideo;
    if (!v) return false;
    const d = Number(v.duration || 0);
    return Number.isFinite(d) && d > 0 && d < getMinVideoDurationSec();
  }

  if (!document.getElementById("jms-pause-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "jms-pause-overlay";
    overlay.innerHTML = `
  <div class="pause-overlay-content">
    <div class="pause-left">
      <div id="jms-overlay-title" class="pause-title"></div>
      <div id="jms-overlay-metadata" class="pause-metadata"></div>
      <div id="jms-overlay-plot" class="pause-plot"></div>
    </div>
    <div class="pause-right">
      <div class="pause-right-backdrop"></div>
      <div id="jms-overlay-logo" class="pause-logo-container"></div>
    </div>
  </div>
  <div id="jms-overlay-progress" class="pause-progress-wrap" aria-hidden="true">
    <div class="pause-progress-top">
      <span id="jms-progress-remaining"></span>
      <span id="jms-progress-percent"></span>
    </div>
    <div class="pause-progress-bar">
      <div id="jms-progress-elapsed" class="pause-progress-elapsed"></div>
      <div id="jms-progress-remainingFill" class="pause-progress-remainingFill"></div>
      <div id="jms-progress-sep" class="pause-progress-sep">/</div>
    </div>
  </div>
  <div class="pause-status-bottom-right" id="pause-status-bottom-right" style="display:none;">
    <span><i class="fa-jelly fa-regular fa-pause"></i> ${labels.paused || "Duraklatıldı"}</span>
  </div>`;
    document.body.appendChild(overlay);

    if (!document.getElementById("jms-pause-extra-css")) {
      const style = document.createElement("style");
      style.id = "jms-pause-extra-css";
     }
    _recoBadgeEl = document.createElement("div");
    _recoBadgeEl.id = "jms-reco-badge";
    _recoBadgeEl.className = "jms-reco-badge";
    _recoBadgeEl.innerHTML = `<button id="jms-reco-toggle"><i class="fa-solid fa-thumbs-up"></i><span id="jms-reco-badge-text"></span></button>`;
    document.body.appendChild(_recoBadgeEl);

    _recoPanelEl = document.createElement("div");
    _recoPanelEl.id = "jms-reco-panel";
    _recoPanelEl.className = "jms-reco-panel";
    _recoPanelEl.innerHTML = `<div class="pause-recos-header" id="jms-reco-header"></div><div class="jms-reco-row" id="jms-reco-list"></div>`;
    document.body.appendChild(_recoPanelEl);

    _recoToggleEl = _recoBadgeEl.querySelector('#jms-reco-toggle');
    _recoListEl   = _recoPanelEl.querySelector('#jms-reco-list');
  }

  ddbg("[PO] overlay DOM created?", !!document.getElementById("jms-pause-overlay"));

  function createRatingGenreElement() {
    if (!document.getElementById("jms-rating-genre-overlay")) {
      ratingGenreElement = document.createElement("div");
      ratingGenreElement.id = "jms-rating-genre-overlay";
      ratingGenreElement.className = "rating-genre-overlay";
      document.body.appendChild(ratingGenreElement);
      if (!document.getElementById("jms-rating-genre-css")) {
        const style = document.createElement("style");
        style.id = "jms-rating-genre-css";
        style.textContent = `
        .rating-genre-overlay{
          position:fixed;
          top:60px;
          left:24px;
          z-index:9999;
          pointer-events:none;
          opacity:0;
          transform:translateY(-14px);
          transition:transform .35s cubic-bezier(.2,.8,.4,1), opacity .35s ease;
        }
        .rating-genre-overlay.visible{
          opacity:1;
          transform:translateY(0)
        }
        .rating-genre-card{
          display:flex;
          align-items:flex-start;
          gap:12px;
          color:#fff;
          text-shadow:
            0 1px 3px rgba(0,0,0,.8),
            0 2px 6px rgba(0,0,0,.6),
            0 0 10px rgba(0,0,0,.4);
        }
        .rating-genre-card .bar{
          width:3px;
          height:44px;
          background:#e10600;
          border-radius:2px;
          flex:0 0 3px;
          margin-top:2px
        }
        .rating-genre-card .texts{
          line-height:1.15
        }
        .rating-genre-card .line1{
          font-size:22px;
          font-weight:800;
          letter-spacing:.3px;
          text-transform:uppercase;
          opacity:.98;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,.4));
        }
        .rating-genre-card .line2{
          margin-top:4px;
          font-size:16px;
          font-weight:600;
          opacity:.95;
          text-transform:none;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,.4));
        }
        `;
        document.head.appendChild(style);
      }
    } else {
      ratingGenreElement = document.getElementById("jms-rating-genre-overlay");
    }
  }

  async function showRatingGenre(itemData, duration = AGE_BADGE_DEFAULT_MS) {
    const po = getConfig()?.pauseOverlay || {};
    if (po.showAgeBadge === false) return false
    if (!lazyTagMapReady) {
      try {
        await initDescriptorTagsOnce();
      } catch {}
      lazyTagMapReady = true;
    }
    if (!ratingGenreElement) createRatingGenreElement();
    if (ratingGenreTimeout) {
      clearTimeout(ratingGenreTimeout);
      ratingGenreTimeout = null;
    }
    let data = itemData;

    try {
      const isEpisode = data?.Type === "Episode";
      const noTags = !Array.isArray(data?.Tags) || data.Tags.length === 0;
      const maybeSeriesId = data?.SeriesId || data?._episodeData?.SeriesId || null;

      const genresMissing = !Array.isArray(data?.Genres) || data.Genres.length === 0;
      const ratingMissing = !data?.OfficialRating;
      if (isEpisode && maybeSeriesId && (noTags || genresMissing || ratingMissing)) {
        const series = await fetchItemDetailsCached(maybeSeriesId);
        const mergedTags = [
          ...(series?.Tags || []),
          ...(data?.Tags || []),
          ...(data?.Keywords || []),
        ].filter(Boolean);
        data = {
          ...series,
          ...data,
          Tags: Array.from(new Set(mergedTags)),
          Genres: genresMissing ? series?.Genres || [] : data.Genres,
          OfficialRating: ratingMissing ? series?.OfficialRating || data.OfficialRating : data.OfficialRating,
        };
      }
    } catch {}

    const mui = getMaturityUiCached(data);
    const age = mui.age;
    const line2Arr = mui.line2Arr;
    try { data.__jmsMaturityIcons = mui.icons; } catch {}

    if (!age && (!line2Arr || line2Arr.length === 0)) {
      hideRatingGenre();
      return;
    }
    const line1 = age ? [localizedMaturityHeader(), age].join(" ") : "";
    const line2 = line2Arr.join(", ");

    if (line1 || line2) {
      ratingGenreElement.innerHTML = `
        <div class="rating-genre-card">
          <div class="bar"></div>
          <div class="texts">
            ${line1 ? `<div class="line1">${line1}</div>` : ""}
            ${line2 ? `<div class="line2">${line2}</div>` : ""}
          </div>
        </div>`;
      ratingGenreElement.classList.add("visible");
      _badgeShownAt = Date.now();
      ratingGenreTimeout = setTimeout(() => {
        hideRatingGenre("auto");
        setTimeout(() => {
          try {
            showIconBadges(mui.icons, duration);
          } catch {}
        }, 380);
      }, duration);
    }
  }

  const overlayEl = document.getElementById("jms-pause-overlay");
  const titleEl = document.getElementById("jms-overlay-title");
  const metaEl = document.getElementById("jms-overlay-metadata");
  const plotEl = document.getElementById("jms-overlay-plot");
  const backdropEl = document.querySelector(".pause-right-backdrop");
  const logoEl = document.getElementById("jms-overlay-logo");
  const pausedLabel = document.getElementById("pause-status-bottom-right");
  const progressWrapEl   = document.getElementById("jms-overlay-progress");
  const progressElapsedEl = document.getElementById("jms-progress-elapsed");
  const progressRemainFillEl = document.getElementById("jms-progress-remainingFill");
  const progressSepEl = document.getElementById("jms-progress-sep");
  const progressRemainEl = document.getElementById("jms-progress-remaining");
  const progressPctEl    = document.getElementById("jms-progress-percent");

  let _progressTimer = null;
  const _clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  function updateProgressUI() {
    if (!progressWrapEl) return;
    if (!overlayVisible || !activeVideo) {
      try { if (progressElapsedEl) progressElapsedEl.style.width = "0%"; } catch {}
      try { if (progressRemainFillEl) progressRemainFillEl.style.width = "100%"; } catch {}
      try { if (progressSepEl) progressSepEl.style.opacity = "0"; } catch {}
      if (progressRemainEl) progressRemainEl.textContent = "";
      if (progressPctEl) progressPctEl.textContent = "";
      return;
    }

    const ct = Number(activeVideo.currentTime || 0);
    const dur = Number(activeVideo.duration || 0);
    const hasDur = Number.isFinite(dur) && dur > 0;

    const pct = hasDur ? _clamp01(ct / dur) : 0;
    const rem = hasDur ? Math.max(0, dur - ct) : NaN;

    const pctText = hasDur ? `${Math.round(pct * 100)}%` : "";
    const remLbl = (labels?.remainingTime || "Kalan");
    const remText = hasDur ? formatTime(rem) : (labels?.sonucyok || "—");

    const pct10 = Math.round(pct * 1000) / 10;
    const rem10 = Math.max(0, 100 - pct10);

    try { if (progressElapsedEl) progressElapsedEl.style.width = `${pct10}%`; } catch {}
    try { if (progressRemainFillEl) progressRemainFillEl.style.width = `${rem10}%`; } catch {}
    try {
      if (progressSepEl) {
        if (hasDur) {
          progressSepEl.style.left = `${pct10}%`;
          progressSepEl.style.opacity = "0.95";
        } else {
          progressSepEl.style.opacity = "0";
        }
      }
    } catch {}
    if (progressRemainEl) progressRemainEl.textContent = `⏳ ${remLbl}: ${remText}`;
    if (progressPctEl) progressPctEl.textContent = pctText;
  }

  function startProgressLoop() {
    stopProgressLoop();
    updateProgressUI();
    _progressTimer = LC.addInterval(updateProgressUI, 250);
  }

  function stopProgressLoop() {
    try { if (_progressTimer) clearInterval(_progressTimer); } catch {}
    _progressTimer = null;
  }

  overlayEl.addEventListener("click", (e) => {
    if (!overlayVisible || !activeVideo) return;
    if (overlayEl.__jmsSwipeConsumed) { overlayEl.__jmsSwipeConsumed = false; return; }
    const inRecos = e.target.closest("#jms-recos-row, .pause-reco-card");
    if (inRecos) return;
    try {
      const content = overlayEl.querySelector(".pause-overlay-content");
      content && (content.style.willChange = "transform, opacity");
    } catch {}
    activeVideo.play();
    hideOverlay();
  }, { signal });

  (function setupSwipeToDismiss(){
    const content = overlayEl.querySelector(".pause-overlay-content");
    if (!content) return;
    let startY = 0, startX = 0, lastY = 0, moved = false, dragging = false, startT = 0;
    const THRESHOLD_PX = 60;
    const MAX_ANGLE_TAN = Math.tan(35 * Math.PI/180);
    const CANCEL_CLICK_LOCK_MS = 300;
    const MAX_PULL_PX = 220;

    function setTransform(y){
      const dy = Math.max(0, Math.min(y, MAX_PULL_PX));
      const op = Math.max(0, 1 - dy/180);
      content.style.transform = `translateY(${dy}px)`;
      content.style.opacity = String(op);
    }
    function clearTransform(){
      content.style.transition = "";
      content.style.transform = "";
      content.style.opacity = "";
      content.style.willChange = "";
    }
    function onStart(ev){
      if (!overlayVisible) return;
      const t = ev.touches?.[0];
      if (!t) return;
      startY = lastY = t.clientY;
      startX = t.clientX;
      startT = performance.now();
      moved = false; dragging = true;
      content.style.willChange = "transform, opacity";
    }
    function onMove(ev){
      if (!dragging) return;
      const t = ev.touches?.[0]; if (!t) return;
      const dy = t.clientY - startY;
      const dx = Math.abs(t.clientX - startX);
      if (!moved) {
        if (dy < 6 && dx < 6) return;
        const tan = dx / Math.max(1, Math.abs(dy));
        if (tan > MAX_ANGLE_TAN) { dragging = false; clearTransform(); return; }
        moved = true;
      }
      if (dy > 0) {
        ev.preventDefault();
        setTransform(dy);
      }
      lastY = t.clientY;
    }
    function onEnd(){
      if (!dragging) return;
      dragging = false;
      const totalDy = Math.max(0, lastY - startY);
      const dt = Math.max(1, performance.now() - startT);
      const v = totalDy / dt;
      const shouldDismiss = totalDy > THRESHOLD_PX || v > 0.9;
      if (shouldDismiss) {
        content.style.transition = "transform 0.22s ease, opacity 0.22s ease";
        content.style.transform = `translateY(${Math.max(totalDy, 160)}px)`;
        content.style.opacity = "0";
        overlayEl.__jmsSwipeConsumed = true;
        setTimeout(() => {
          overlayEl.__jmsSwipeClosing = true;
          hideOverlay({ fromSwipe: true });
          setTimeout(() => { overlayEl.__jmsSwipeConsumed = false; }, CANCEL_CLICK_LOCK_MS);
        }, 200);
      } else {
        content.style.transition = "transform 0.25s cubic-bezier(.2,.8,.4,1), opacity 0.25s ease";
        content.style.transform = "translateY(0)";
        content.style.opacity = "1";
        setTimeout(clearTransform, 260);
      }
    }
    content.addEventListener("touchstart", onStart, { passive: true,  signal });
    content.addEventListener("touchmove",  onMove,  { passive: false, signal });
    content.addEventListener("touchend",   onEnd,   { passive: true,  signal });
    content.addEventListener("touchcancel",onEnd,   { passive: true,  signal });
  })();

  function renderIconOrEmoji(iconValue) {
    if (!iconValue) return "";
    if (iconValue.startsWith("fa-") || iconValue.includes("fa ")) {
      return `<i class="${iconValue}"></i>`;
    }
    return iconValue;
  }

  function _setRecoHeaderAndBadge(isEpisodeContext) {
  const headerEl = document.getElementById('jms-reco-header');
  const badgeTextEl = document.getElementById('jms-reco-badge-text');
  const badgeIconEl = _recoToggleEl?.querySelector('i');

  const isEp = !!isEpisodeContext;
  const iconClass = isEp ? "fa-solid fa-tv" : "fa-solid fa-thumbs-up";
  const text = isEp ? (labels.unwatchedEpisodes || "İzlemediğiniz Bölümler") : (labels.youMayAlsoLike || "Bunları da beğenebilirsiniz");

  if (headerEl) headerEl.innerHTML = `<i class="${iconClass}"></i> ${text}`;
  if (badgeTextEl) badgeTextEl.textContent = text;
  if (badgeIconEl) badgeIconEl.className = iconClass;
}

  function _hideRecoBadgeAndPanel(){
    _recoBadgeEl?.classList.remove('visible');
    _recoPanelEl?.classList.remove('open');
    _recoPanelOpen = false;
  }

  function isVideoActivelyPlaying() {
    try {
      return !!(activeVideo && !activeVideo.paused && !activeVideo.ended);
    } catch {
      return false;
    }
  }

  function _maybeShowBadge(){
    if (!_recoItemsCache.length) return;
    if (overlayVisible) return;
    if (isVideoActivelyPlaying()) return;
    _recoBadgeEl?.classList.add('visible');
  }

  function _toggleRecoPanel(){
    if (!_recoItemsCache.length) return;
    _recoPanelOpen = !_recoPanelOpen;
    if (_recoPanelOpen){
      _recoPanelEl.classList.add('open');
    } else {
      _recoPanelEl.classList.remove('open');
    }
  }
  const onToggleTap = (e) => {
    if (e && e.cancelable) e.preventDefault();
    e?.stopPropagation?.();
    _toggleRecoPanel();
  };
  _recoToggleEl?.addEventListener('click', onToggleTap, { passive:false, capture:true });
  _recoToggleEl?.addEventListener('pointerup', onToggleTap, { passive:false, capture:true });
  _recoToggleEl?.addEventListener('touchstart', onToggleTap, { passive:false, capture:true });

  let _recoJustOpenedAt = 0;

  function openRecoPanel(){
    if (!_recoItemsCache.length) return;
    if (_recoPanelOpen) return;
    _recoPanelEl.classList.add('open');
    _recoPanelOpen = true;
    _recoJustOpenedAt = performance.now();
  }
  function closeRecoPanel(){
    _recoPanelEl.classList.remove('open');
    _recoPanelOpen = false;
  }

  const IS_TOUCH = navigator.maxTouchPoints > 0;
  if (!IS_TOUCH) {
    _recoBadgeEl?.addEventListener('mouseenter', () => { openRecoPanel(); }, { passive:true });
  } else {
    _recoBadgeEl?.addEventListener('pointerup', (e) => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); openRecoPanel(); }, { passive:false, capture:true });
    _recoBadgeEl?.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); openRecoPanel(); }, { passive:false, capture:true });
  }

  if (!IS_TOUCH) _recoBadgeEl?.addEventListener('mouseleave', () => {
    setTimeout(() => {
      const overPanel = _recoPanelEl?.matches(':hover');
      const overBadge = _recoBadgeEl?.matches(':hover');
      if (!overPanel && !overBadge) closeRecoPanel();
    }, 120);
  }, { passive:true });

  if (!IS_TOUCH) _recoPanelEl?.addEventListener('mouseleave', () => {
    setTimeout(() => {
      const overPanel = _recoPanelEl?.matches(':hover');
      const overBadge = _recoBadgeEl?.matches(':hover');
      if (!overPanel && !overBadge) closeRecoPanel();
    }, 120);
  }, { passive:true });
  document.addEventListener('pointerdown', (e) => {
    if (performance.now() - _recoJustOpenedAt < 300) return;
    if (_recoPanelOpen && !e.target.closest('#jms-reco-panel, #jms-reco-badge, #jms-reco-toggle')) {
      closeRecoPanel();
    }
  }, { passive:true });

  function showOverlay() {
    ddbg("[PO] showOverlay()");
  if (!overlayConfig.enabled) return;

  overlayEl.classList.add("visible");
  overlayVisible = true;
  _hideRecoBadgeAndPanel();
  startProgressLoop();

  if (pausedLabel) {
    pausedLabel.style.display = "flex";
    pausedLabel.style.opacity = "0";
    LC.addTimeout(() => {
      pausedLabel.style.opacity = "0.92";
    }, 10);
  }

  const content = overlayEl.querySelector(".pause-overlay-content");
  if (content) {
    content.style.willChange = "transform, opacity";
    content.style.transform = "translateY(10px)";
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.transition =
        "transform 0.4s cubic-bezier(0.2, 0.8, 0.4, 1), opacity 0.4s ease";
      content.style.transform = "translateY(0)";
      content.style.opacity = "1";
    }, 10);

    content.addEventListener(
      "transitionend",
      () => {
        content.style.willChange = "";
      },
      { once: true, signal }
    );
  }
if (_mouseIdleTimer) { clearTimeout(_mouseIdleTimer); _mouseIdleTimer = null; }
  const enableMouseClose = (getConfig()?.pauseOverlay?.closeOnMouseMove !== false);
  if (enableMouseClose) {
    const onMouseMoveClose = () => {
      hideOverlay({ preserve: true });
      if (_mouseIdleTimer) { clearTimeout(_mouseIdleTimer); }
      _mouseIdleTimer = LC.addTimeout(() => {
        try {
          if (activeVideo && activeVideo.paused && isVideoVisible(activeVideo) && !overlayVisible) {
            showOverlay();
          }
        } catch {}
      }, 5000);
    };
    document.addEventListener('mousemove', onMouseMoveClose, { signal, passive: true });
  }
}

function hideOverlay(opts = {}) {
  const fromSwipe = !!opts.fromSwipe || !!overlayEl.__jmsSwipeClosing;
  const preserve = fromSwipe || !!opts.preserve;
  stopProgressLoop();

  const content = overlayEl.querySelector(".pause-overlay-content");
  if (content) {
    content.style.willChange = "transform, opacity";
    if (!fromSwipe) {
      content.style.transition =
        "transform 0.3s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.3s ease";
      content.style.transform = "translateY(10px)";
      content.style.opacity = "0";
    }
  }

  if (pausedLabel) {
    pausedLabel.style.opacity = "0";
    LC.addTimeout(() => {
      overlayEl?.classList.remove("visible");
      pausedLabel.style.display = "none";
    }, 300);
  }

  LC.addTimeout(() => {
    overlayEl.classList.remove("visible");
    overlayVisible = false;
    if (content) {
      const doReset = () => {
        content.style.transition = "";
        content.style.transform = "";
        content.style.opacity = "";
      };
      if (fromSwipe) requestAnimationFrame(doReset); else doReset();
    }
    if (!preserve) {
      wipeOverlayState();
    }
    overlayEl.__jmsSwipeClosing = false;
  }, 300);

  if (pauseTimeout && !preserve) {
    clearTimeout(pauseTimeout);
    pauseTimeout = null;
  }
  LC.addTimeout(() => { _maybeShowBadge(); }, 320);
}

  function _clearRecos() {
  _recoItemsCache = [];
  if (_recoListEl) _recoListEl.innerHTML = "";
  _hideRecoBadgeAndPanel();
}

  function resetContent() {
    if (config.pauseOverlay.showBackdrop) {
      backdropEl.style.backgroundImage = "none";
      backdropEl.style.opacity = "0";
    }
    if (config.pauseOverlay.showLogo) {
      logoEl.innerHTML = "";
    }
    titleEl.innerHTML = "";
    metaEl.innerHTML = "";
    plotEl.textContent = "";
    _clearRecos();
    try { if (progressElapsedEl) progressElapsedEl.style.width = "0%"; } catch {}
    try { if (progressRemainFillEl) progressRemainFillEl.style.width = "100%"; } catch {}
    try { if (progressSepEl) progressSepEl.style.opacity = "0"; } catch {}
    if (progressRemainEl) progressRemainEl.textContent = "";
    if (progressPctEl) progressPctEl.textContent = "";
  }

  function convertTicks(ticks) {
    if (!ticks || isNaN(ticks)) return labels.sonucyok;
    const totalSeconds = ticks / 10000000;
    return formatTime(totalSeconds);
  }
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return labels.sonucyok;
    const t = Math.floor(sec);
    const m = Math.floor(t / 60);
    const h = Math.floor(m / 60);
    const rm = m % 60;
    const rs = t % 60;
    return h > 0 ? `${h}${labels.sa} ${rm}${labels.dk} ${rs}${labels.sn}` : `${rm}${labels.dk} ${rs}${labels.sn}`;
  }
  function genRow(label, value) {
    if (!value) return "";
    return `<div class="info-row"><span>${label}</span><span>${value}</span></div>`;
  }

  async function refreshData(data) {
    currentMediaData = data;
    resetContent();

    const ep = data._episodeData || null;
    if (config.pauseOverlay.showBackdrop) {
      await setBackdrop(data);
    } else {
      backdropEl.style.backgroundImage = "none";
      backdropEl.style.opacity = "0";
    }
    if (config.pauseOverlay.showLogo) {
      await setLogo(data);
    } else {
      logoEl.innerHTML = "";
    }

    if (ep) {
      const seriesTitle = data.Name || data.OriginalTitle || "";
      const line = formatSeasonEpisodeLine(ep);
      titleEl.innerHTML = `
        <h1 class="pause-series-title">${seriesTitle}</h1>
        <h2 class="pause-episode-title">${line}</h2>`;
    } else {
      titleEl.innerHTML = `<h1 class="pause-movie-title">${data.Name || data.OriginalTitle || ""}</h1>`;
    }

    if (config.pauseOverlay.showMetadata) {
      const rows = [
        genRow("📅 " + labels.showYearInfo, data.ProductionYear),
        genRow("⭐ " + labels.showCommunityRating, data.CommunityRating ? Math.round(data.CommunityRating) + "/10" : ""),
        genRow("👨‍⚖️ " + labels.showCriticRating, data.CriticRating ? Math.round(data.CriticRating) + "%" : ""),
        genRow("👥 " + labels.voteCount, data.VoteCount),
        genRow("🔞 " + labels.showOfficialRating, data.OfficialRating || labels.derecelendirmeyok),
        genRow("🎭 " + labels.showGenresInfo, data.Genres?.slice(0, 3).join(", ") || labels.noGenresFound),
        genRow("⏱️ " + labels.showRuntimeInfo, convertTicks(ep?.RunTimeTicks || data.RunTimeTicks)),
        genRow("▶ " + labels.currentTime, formatTime(activeVideo?.currentTime || 0)),
        genRow("⏳ " + labels.remainingTime, formatTime((activeVideo?.duration || 0) - (activeVideo?.currentTime || 0))),
      ];
      metaEl.innerHTML = rows.join("");
    } else {
      metaEl.innerHTML = "";
    }

    plotEl.textContent = config.pauseOverlay.showPlot ? (ep?.Overview || data.Overview || labels.konu + labels.noData) : "";

    _setRecoHeaderAndBadge(Boolean(ep));
    try {
      let recs = [];
      if (ep) {
        recs = await fetchUnplayedEpisodesInSameSeason(ep, { limit: 5 });
      } else {
        recs = await fetchSimilarUnplayed(data, { limit: 5 });
      }
      renderRecommendations(recs);
    } catch (e) {
      console.warn("duraklatma ekranı tavsiye hatası:", e);
      _setRecoHeaderAndBadge(Boolean(ep));
      renderRecommendations([]);
    }
  }

  if (!window.__jmsPauseOverlay._boundBeforeUnload) {
    window.addEventListener(
      "beforeunload",
      () => {
        try {
          destroy();
        } catch {}
      },
      { once: true }
    );
    window.__jmsPauseOverlay._boundBeforeUnload = true;
  }

  async function setBackdrop(item) {
  const tags = item?.BackdropImageTags || [];
  const base = withServer('');
  const { accessToken } = getSessionInfo();
  const tokenQ = accessToken ? `&api_key=${encodeURIComponent(accessToken)}` : "";
  if (tags.length > 0) {
    const url = `${base}/Items/${item.Id}/Images/Backdrop/0?tag=${encodeURIComponent(tags[0])}&maxWidth=1920&quality=90${tokenQ}`;
    backdropEl.style.backgroundImage = `url('${url}')`;
    backdropEl.style.opacity = "0.7";
  } else {
    backdropEl.style.backgroundImage = "none";
    backdropEl.style.opacity = "0";
  }
}
  async function setLogo(item) {
  if (!item) return;
  const base = withServer('');
  const { accessToken } = getSessionInfo();
  const tokenQ = accessToken ? `&api_key=${encodeURIComponent(accessToken)}` : "";
  const imagePref = config.pauseOverlay?.imagePreference || "auto";
  const hasLogoTag = item?.ImageTags?.Logo || item?.SeriesLogoImageTag || null;
  const hasDiscTag = item?.ImageTags?.Disc || null;

  const logoUrl = hasLogoTag ? `${base}/Items/${item.Id}/Images/Logo?tag=${encodeURIComponent(hasLogoTag)}${tokenQ}` : null;
  const discUrl = hasDiscTag ? `${base}/Items/${item.Id}/Images/Disc?tag=${encodeURIComponent(hasDiscTag)}${tokenQ}` : null;

    const sequence = (() => {
      switch (imagePref) {
        case "logo":
          return ["logo"];
        case "disc":
          return ["disc"];
        case "title":
          return ["title"];
        case "logo-title":
          return ["logo", "title"];
        case "disc-logo-title":
          return ["disc", "logo", "title"];
        case "disc-title":
          return ["disc", "title"];
        case "auto":
        default:
          return ["logo", "disc", "title"];
      }
    })();

    logoEl.innerHTML = "";
    for (const pref of sequence) {
      if (pref === "logo" && logoUrl) {
        logoEl.innerHTML = `<div class="pause-logo-container"><img class="pause-logo" src="${logoUrl}" alt=""/></div>`;
        return;
      }
      if (pref === "disc" && discUrl) {
        logoEl.innerHTML = `<div class="pause-disk-container"><img class="pause-disk" src="${discUrl}" alt=""/></div>`;
        return;
      }
      if (pref === "title") {
        logoEl.innerHTML = `<div class="pause-text-logo">${item.Name || item.OriginalTitle || ""}</div>`;
        return;
      }
    }
    logoEl.innerHTML = `<div class="pause-text-logo">${item.Name || item.OriginalTitle || ""}</div>`;
  }

  async function showBadgeForCurrentIfFresh() {
    if (Date.now() - _badgeShownAt < BADGE_LOCK_MS) return false;
    if (ratingGenreElement?.classList?.contains("visible")) return false;
    if (_iconEl?.classList?.contains("visible")) return false;
    if (!SHOW_AGE_BADGE) return false;
    if (!activeVideo) return false;
    const BADGE_MIN_CT_SEC = 2.0;
    const MIN_DUR = getMinVideoDurationSec();

    const ct = Number(activeVideo.currentTime || 0);
    const dur = Number(activeVideo.duration || 0);
    if (!(isFinite(ct) && ct >= BADGE_MIN_CT_SEC)) return false;
    const durationOk = (isFinite(dur) && dur >= MIN_DUR) || (!isFinite(dur) && ct >= BADGE_MIN_CT_SEC);
    if (!durationOk) return false;

    let itemId = getStableItemIdDomFirst();
    if (!itemId) {
      const viaSessStable = await getStableItemIdFromSessionsStable(350).catch(() => null);
      if (viaSessStable) itemId = viaSessStable;
      if (!itemId && activeVideo) itemId = parsePlayableIdFromVideo(activeVideo);
    }
    if (!itemId) return false;

    const data = await fetchItemDetailsCached(itemId).catch(() => null);
    if (!data) { console.debug('[badge] no item data'); return false; }
    if (shouldIgnoreTheme({ video: activeVideo, item: data })) return false;
    const durMs = _badgeDurationFor(_badgeCtx);

    if (data.Type === "Episode" && data.SeriesId) {
      try {
        const series = await fetchItemDetailsCached(data.SeriesId);
        await showRatingGenre({ ...series, _episodeData: data }, durMs);
      } catch {
        await showRatingGenre(data, durMs);
      }
    } else {
      await showRatingGenre(data, durMs);
    }
    return true;
  }

  function clearOverlayUi() {
    hideOverlay();
    resetContent();
    currentMediaId = null;
    try {
      hideRatingGenre("finished");
    } catch {}
    try { hideIconBadges("finished"); } catch {}
    _hideRecoBadgeAndPanel();
  }

  function isPreviewPlaybackElement(el) {
    if (!el) return false;
    try {
      if (el.dataset?.jmsIgnorePauseOverlay === "1") return true;
      if (el.dataset?.jmsPreview === "1") return true;

      const p = el.closest?.(".intro-video-container");
      if (p) return true;

      const g = (typeof window !== "undefined") ? window.__JMS_PREVIEW_PLAYBACK : null;
      if (g?.active) return true;
    } catch {}
    return false;
  }

  function bindVideo(video, why = '') {
    if (isPreviewPlaybackElement(video)) return false;
    ddbg("[PO] bindVideo", why, "paused?", video?.paused, "src?", video?.currentSrc || video?.src);
    if (!video) return false;
    try {
      if (video.__jmsPOBound === true && typeof video.__jmsPOUnbind === "function") {
        return true;
      }
    } catch {}
    if (isPreviewInHub(video) || isStudioTrailerPopoverVideo(video) || shouldIgnoreTheme({ video })) {
      return false;
    }
    try { video.__jmsPOBound = true; } catch {}

    if (removeHandlers) removeHandlers();
    if (removeHandlersToken) {
      try {
        LC.untrackClean(removeHandlersToken);
      } catch {}
      removeHandlersToken = null;
    }
    if (video.closest(".video-preview-modal")) return;
    activeVideo = video;
    relaxScanDepth();

    let cleanupSmart = null;
    const armSmart = () => {
      if (cleanupSmart) { try { cleanupSmart(); } catch {} }
      try { cleanupSmart = createSmartAutoPause(video); } catch {}
    };
    let badgeStartAt = 0;
    let badgeChecks = 0;
    let _badgeSeq = 0;
    let _playCount = 0;
    let _badgeArmTimeoutId = null;
    let _badgeInFlight = false;
    let _badgeShownThisPlay = false;
    const BADGE_WINDOW_MS = 45000;
    const BADGE_MIN_CT_SEC = 2.0;

    function armBadgeAttempt(reason = "arm") {
      badgeStartAt = 0;
      badgeChecks = 0;

      _badgeSeq++;
      _badgeShownThisPlay = false;
      _badgeInFlight = false;

      cancelBadgeTimer();
      video.addEventListener("timeupdate", onTimeUpdateArm, { passive: true });

      const delayMs = _badgeDelayFor(_badgeCtx);
    _badgeArmTimeoutId = LC.addTimeout(
      () => onTimeUpdateArm(_badgeSeq),
      Math.max(50, delayMs)
    );

      if (DEBUG_PO) dlog("[badge] armed:", reason, { seq: _badgeSeq, delay: BADGE_DELAY_MS });
    }

    function cancelBadgeTimer() {
      try { video.removeEventListener("timeupdate", onTimeUpdateArm); } catch {}
      try { if (_badgeArmTimeoutId) clearTimeout(_badgeArmTimeoutId); } catch {}
      _badgeArmTimeoutId = null;
      _badgeInFlight = false;
    }

    async function onTimeUpdateArm(evOrSeq = _badgeSeq) {
      const seq = (typeof evOrSeq === "number") ? evOrSeq : _badgeSeq;

      if (seq !== _badgeSeq) return;
      if (_badgeShownThisPlay) return;

      const now = Date.now();
      const delayMs = _badgeDelayFor(_badgeCtx);
      if (delayMs > 0 && (now - (_playEventAt || _playStartAt)) < delayMs) return;
      if ((video.currentTime || 0) < BADGE_MIN_CT_SEC) return;
      if (_badgeInFlight) return;
      _badgeInFlight = true;

      try {
        if (!badgeStartAt) badgeStartAt = now;
        badgeChecks++;

        const shown = await showBadgeForCurrentIfFresh();
        if (seq !== _badgeSeq) return;

        if (shown) {
          _badgeShownThisPlay = true;
          cancelBadgeTimer();
          return;
        }
        if (now - badgeStartAt > BADGE_WINDOW_MS) cancelBadgeTimer();
      } finally {
        _badgeInFlight = false;
      }
    }
    const onPause = async () => {
      cancelBadgeTimer();
      ddbg("[PO] onPause fired", { ct: video.currentTime, dur: video.duration, paused: video.paused });
      hideRatingGenre();
      try { hideIconBadges(); } catch {}
      if (video.ended) {
        hideOverlay();
        if (pausedLabel) {
          pausedLabel.style.opacity = "0";
          pausedLabel.style.display = "none";
        }
        return;
      }
      if (pauseTimeout) clearTimeout(pauseTimeout);
      pauseTimeout = LC.addTimeout(async () => {
        if (!video.paused || video.ended) return;
        const dur = Number(video.duration || 0);
        const ok = (isFinite(dur) && dur >= getMinVideoDurationSec()) || (!isFinite(dur) && (video.currentTime || 0) >= 2);
        if (!ok) return;

        ddbg('[pause] paused', { domId: getItemIdFromDom(), stable: getStableItemIdDomFirst(), cpiLast: _cpiLastRawId });

        let itemId = getStableItemIdDomFirst();
        ddbg('[pause] picked itemId=', itemId);

        if (!itemId) {
          await new Promise(r => setTimeout(r, 220));
          itemId = await getStableItemIdFromSessionsStable(350).catch(() => null);
     }
        if (!itemId) {
          if (activeVideo) itemId = parsePlayableIdFromVideo(activeVideo);
        }
        if (!itemId) return;
        ddbg('[pause] resolved itemId=', itemId);

        let baseInfo = await fetchItemDetailsCached(itemId).catch(e => (console.warn('[pause] fetchItemDetails err', e), null));
        ddbg('[pause] baseInfo', baseInfo ? { Id: baseInfo.Id, Type: baseInfo.Type, SeriesId: baseInfo.SeriesId } : null);
        if (shouldIgnoreTheme({ video, item: baseInfo })) return;

        let seriesId =
          (baseInfo?.Type === "Episode" && baseInfo?.SeriesId) || baseInfo?.SeriesId || baseInfo?.Id || null;
        if (!seriesId) { console.debug('[overlay] no seriesId/baseId'); return; }

        currentMediaId = seriesId;
        const series = await fetchItemDetailsCached(seriesId);
        if (!video.paused || video.ended) return;
        if (shouldIgnoreTheme({ video, item: series })) return;
        if (baseInfo?.Type === "Episode") {
          await refreshData({ ...series, _episodeData: baseInfo });
        } else {
          await refreshData({ ...series, _episodeData: null });
        }
        showOverlay();
      }, 1200);
    };

    _playStartAt = Date.now();
    hardResetBadgeOverlay();

    const onPlay = () => {
      _badgeCtx = (_playCount === 0) ? "first" : "resume";
      _playCount++;
      _playEventAt = Date.now();
      if (overlayVisible) clearOverlayUi();
      if (pauseTimeout) clearTimeout(pauseTimeout);
      if (Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre("finished");
      }
      try { hideIconBadges("finished"); } catch {}
      armSmart();
      badgeStartAt = 0;
      badgeChecks = 0;
      _badgeSeq++;
      _badgeShownThisPlay = false;
      _badgeInFlight = false;
      cancelBadgeTimer();
      video.addEventListener("timeupdate", onTimeUpdateArm, { passive: true });
      _badgeArmTimeoutId = LC.addTimeout(
        () => onTimeUpdateArm(_badgeSeq),
        Math.max(2000, BADGE_DELAY_MS)
      );
      _hideRecoBadgeAndPanel();
      armBadgeAttempt("play");
    };

    const onLoadedMetadata = () => {
      if (_shouldIgnoreEarlyMetaResets()) return;
      if (ratingGenreTimeout) {
        if (DEBUG_PO) dlog("[badge] loadedmetadata ignored (ratingGenreTimeout active)");
        return;
      }

      if (ratingGenreElement?.classList?.contains("visible") && Date.now() - _badgeShownAt < 2000) {
        if (DEBUG_PO) dlog("[badge] loadedmetadata ignored (badge protected)");
        return;
      }

      _playCount = 0;
      _badgeCtx = "first";

      const now = Date.now();
      const killedRecent = (now - (_badgeShownAt || 0)) < 2500;

      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}

      if (killedRecent) {
        _badgeShownAt = 0;
        _badgeShownThisPlay = false;
        if (DEBUG_PO) dlog("[badge] killed by loadedmetadata → retry");
      }

      if (video.paused) return;
      if (overlayVisible) clearOverlayUi();
      armSmart();
      hardResetBadgeOverlay();
      armBadgeAttempt("loadedmetadata");
    };

    const onLoadStartSafe = () => {
      if (_shouldIgnoreEarlyMetaResets()) return;
      try {
        if ((video.currentTime || 0) > 1.0) return;
      } catch {}
      onLoadedMetadata();
    };

    const onEnded = () => {
      cancelBadgeTimer();
      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}
      hideOverlay();
      if (pausedLabel) {
        pausedLabel.style.opacity = "0";
        pausedLabel.style.display = "none";
      }
    };
    const onEmptiedLike = () => {
      cancelBadgeTimer();
      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}
      badgeStartAt = 0;
      badgeChecks = 0;
      clearOverlayUi();
    };
    const onSeekingHide = () => {
      if ((video.currentTime || 0) > 3 && Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre();
        try { hideIconBadges(); } catch {}
      }
    };

    video.addEventListener("pause", onPause, { signal });
    video.addEventListener("play", onPlay, { signal });
    video.addEventListener("loadedmetadata", onLoadedMetadata, { signal });
    video.addEventListener("loadstart", onLoadStartSafe, { signal });
    const onDurationChange = () => {
      if (_shouldIgnoreEarlyMetaResets()) return;
      if (Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre();
      }
    };
    video.addEventListener("durationchange", onDurationChange, { signal });
    const onPlaying = () => {
      try { hideIconBadges(); } catch {}
      badgeStartAt = 0;
      badgeChecks = 0;
    };
    video.addEventListener("playing", onPlaying, { signal });
    video.addEventListener("ended", onEnded, { signal });
    video.addEventListener("emptied", onEmptiedLike, { signal });
    video.addEventListener("abort", onEmptiedLike, { signal });
    video.addEventListener("stalled", onEmptiedLike, { signal });
    video.addEventListener("seeking", onSeekingHide, { signal });

    armSmart();

    if (!video.paused && !video.ended) {
      onPlay();
      LC.addTimeout(() => {
        try { onTimeUpdateArm(); } catch {}
      }, 300);
    }

    removeHandlers = () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadstart", onLoadStartSafe);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("emptied", onEmptiedLike);
      video.removeEventListener("abort", onEmptiedLike);
      video.removeEventListener("stalled", onEmptiedLike);
      video.removeEventListener("seeking", onSeekingHide);
      cancelBadgeTimer();
      if (cleanupSmart) {
        try {
          cleanupSmart();
        } catch {}
        cleanupSmart = null;
      }
      try { video.__jmsPOBound = false; } catch {}
      try { video.__jmsPOUnbind = null; } catch {}
    };
    try { video.__jmsPOUnbind = removeHandlers; } catch {}
    removeHandlersToken = LC.trackClean(removeHandlers);
    return true;
  }

  function isPreviewInHub(video) {
   const inHub = video.closest("#studio-hubs, .hub-card, .hub-row, .hub-video") !== null;
   if (!inHub) return false;
   const probablyPreview =
     video.muted === true &&
     video.controls !== true &&
    (video.autoplay === true || video.loop === true);
   return probablyPreview;
 }

  function findAnyVideoDeep(root = document, maxDepth = 8) {
    const seen = new Set();
    function walk(node, d) {
      if (!node || d > maxDepth) return null;
      if (node instanceof HTMLVideoElement) return node;
      if (node.querySelector) {
        const v = node.querySelector('video');
        if (v) return v;
      }
      const sr = node.shadowRoot;
      if (sr && !seen.has(sr)) {
        seen.add(sr);
        const v2 = sr.querySelector?.('video') || [...sr.childNodes].map(n => walk(n, d+1)).find(Boolean);
        if (v2) return v2;
      }
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i++) {
        const v3 = walk(kids[i], d+1);
        if (v3) return v3;
      }
      return null;
    }
    return walk(root, 0);
  }

  function* iterDocRoots(startDoc = document, maxIframes = 12) {
    yield startDoc;
    try {
      const iframes = startDoc.querySelectorAll?.("iframe") || [];
      for (let i = 0; i < iframes.length && i < maxIframes; i++) {
        const fr = iframes[i];
        try {
          const idoc = fr.contentDocument || fr.contentWindow?.document;
          if (idoc) yield idoc;
        } catch {}
      }
    } catch {}
  }

  function _scoreVideoCandidate(v){
    try {
      if (!(v instanceof HTMLVideoElement)) return -1e9;
      if (isStudioTrailerPopoverVideo(v)) return -1e9;
      if (shouldIgnoreTheme({ video: v })) return -1e9;
      if (isPreviewInHub(v)) return -1e6;

      let s = 0;
      const cls = String(v.className || '');
      const src = String(v.currentSrc || v.src || '');
      if (cls.includes('htmlvideoplayer')) s += 1000;
      if (v.controls) s += 120;
      if (!v.muted) s += 60;
      if (!v.loop) s += 40;
      if (src.startsWith('blob:')) s += 200;
      if (src && !src.includes('/slider/src/images/')) s += 80;
      try { if (isVideoVisible(v)) s += 50; } catch {}
      return s;
    } catch {
      return -1e9;
    }
  }

  function findBestPlayableVideoAnywhere(maxIframes = 12){
    let best = null;
    let bestS = -1e9;
    for (const doc of iterDocRoots(document, maxIframes)) {
      const vids = doc.querySelectorAll?.('video') || [];
      for (let i = 0; i < vids.length; i++) {
        const v = vids[i];
        const sc = _scoreVideoCandidate(v);
        if (sc > bestS) { bestS = sc; best = v; }
      }
    }
    return (bestS > 0) ? best : null;
  }

  function scheduleMaybeDetachActive() {
    const v = activeVideo;
    if (!v) return;
    requestAnimationFrame(() => {
      try {
        if (v.isConnected || document.contains(v)) return;
      } catch {}

      if (removeHandlers) removeHandlers();
      if (removeHandlersToken) {
        try { LC.untrackClean(removeHandlersToken); } catch {}
        removeHandlersToken = null;
      }
      try { unobserveVideo(v); } catch {}
      activeVideo = null;
      clearOverlayUi();
    });
  }

  function isStudioTrailerPopoverVideo(video) {
    return (
      video.closest(".mini-trailer-popover") !== null ||
      video.parentElement?.classList?.contains("mtp-player") ||
      video.closest(".mtp-inner") !== null ||
      video.classList.contains("studio-trailer-video") ||
      (video.tagName === "IFRAME" && video.classList.contains("studio-trailer-iframe"))
    );
  }

  function createSmartAutoPause(video) {
    const scopeDoc = (video && video.ownerDocument) || document;
    const scopeWin = (scopeDoc.defaultView) || window;
    const topDoc = document;
    const topWin = window;
    const base = getConfig();
    const def = {
      enabled: true,
      blurMinutes: 0.5,
      hiddenMinutes: 0.2,
      idleMinutes: 45,
      useIdleDetection: true,
      respectPiP: true,
      ignoreShortUnderSec: getMinVideoDurationSec(),
      beginAfterMs: 4000,
      postPlayGuardMs: 2500
    };
    const sap = Object.assign({}, def, base.smartAutoPause || {});
    if (sap.idleThresholdMs != null && sap.idleMinutes == null) sap.idleMinutes = Number(sap.idleThresholdMs) / 60000;
    if (sap.unfocusedThresholdMs != null && sap.blurMinutes == null) sap.blurMinutes = Number(sap.unfocusedThresholdMs) / 60000;
    if (sap.offscreenThresholdMs != null && sap.hiddenMinutes == null) sap.hiddenMinutes = Number(sap.offscreenThresholdMs) / 60000;

    function minToMs(x) {
      const n = Number(x || 0);
      return isFinite(n) && n > 0 ? n * 60000 : 0;
    }
    const blurMs = minToMs(sap.blurMinutes);
    const hidMs = minToMs(sap.hiddenMinutes);
    const idleMs = minToMs(sap.idleMinutes);
    const useIdle = !!sap.useIdleDetection;
    const respectP = !!sap.respectPiP;

    if (!sap.enabled) return () => {};
    if (!video) return () => {};
    const dur = Number(video.duration || 0);
    if (sap.ignoreShortUnderSec && dur > 0 && dur < Number(sap.ignoreShortUnderSec)) {
      return () => {};
    }

    function inPiP() {
      try {
        return !!(document.pictureInPictureElement && document.pictureInPictureElement === video);
      } catch {
        return false;
      }
    }

    const actEvts = ["pointermove","pointerdown","mousedown","mouseup","keydown","wheel","touchstart","touchmove"];
    const onActivity = () => {
      lastActivityAt = Date.now();
    };
    actEvts.forEach((ev) => scopeDoc.addEventListener(ev, onActivity, { passive: true }));
    actEvts.forEach((ev) => video.addEventListener(ev, onActivity, { passive: true }));
    actEvts.forEach((ev) => topDoc.addEventListener(ev, onActivity, { passive: true }));

    function onFocus() {
      blurAt = null;
      if (lastPauseReason === "blur") {
        tryAutoResume("focus");
        lastPauseReason = null;
      }
    }
    function onBlur() { blurAt = Date.now(); }
    scopeWin.addEventListener("focus", onFocus);
    scopeWin.addEventListener("blur", onBlur);
    topWin.addEventListener("focus", onFocus);
    topWin.addEventListener("blur", onBlur);

    function onVis() {
      if (scopeDoc.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else {
        hiddenAt = null;
        if (lastPauseReason === "hidden") {
          tryAutoResume("vis");
          lastPauseReason = null;
        }
      }
    }
    scopeDoc.addEventListener("visibilitychange", onVis);
    topDoc.addEventListener("visibilitychange", onVis);

    function tryAutoResume(kind) {
      try {
        if (!video) return;
        if (!video.paused || video.ended) return;
        if (!isVideoVisible(video)) return;
        if (sap.ignoreShortUnderSec && video.duration > 0 && video.duration < Number(sap.ignoreShortUnderSec)) {
          return;
        }
        if (sap.beginAfterMs > 0 && (Date.now() - startedAt) < sap.beginAfterMs) {
          return;
        }
        if (sap.postPlayGuardMs > 0 && lastPauseAt && (Date.now() - lastPauseAt) < sap.postPlayGuardMs) {
          return;
        }
        if (respectP && inPiP()) return;
        const reason = lastPauseReason;
        if (!reason) return;
        if (kind === "focus" && reason !== "blur") return;
        if (kind === "vis"   && reason !== "hidden") return;

        video.play();
      } catch (e) {
        console.warn("smartAutoPause auto-resume hata:", e);
      }
    }

    const startedAt = Date.now();
    let lastPlayAtMs = 0;
    const timer = setInterval(() => {
      try {
        if (!video || video.ended) return;
        const now = Date.now();
       if (respectP && inPiP()) return;
       if (video.paused) return;
       if (sap.beginAfterMs > 0 && (now - startedAt) < sap.beginAfterMs) return;
       if (sap.postPlayGuardMs > 0 && lastPlayAtMs && (now - lastPlayAtMs) < sap.postPlayGuardMs) return;
        if ((video.currentTime || 0) < 1.5) return;
        if (hiddenAt && hidMs > 0 && now - hiddenAt >= hidMs) {
          if (lastPauseReason !== "hidden" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "hidden";
            lastPauseAt = now;
            return;
          }
        }
        if (blurAt && blurMs > 0 && now - blurAt >= blurMs) {
          if (lastPauseReason !== "blur" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "blur";
            lastPauseAt = now;
            return;
          }
        }
        if (useIdle && idleMs > 0 && now - lastActivityAt >= idleMs) {
          if (lastPauseReason !== "idle" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "idle";
            lastPauseAt = now;
            return;
          }
        }
      } catch {}
    }, 1000);

    const onPlayReset = () => {
      lastPauseReason = null;
      lastPlayAtMs = Date.now();
    };
    video.addEventListener("play", onPlayReset);

    return () => {
      clearInterval(timer);
      video.removeEventListener("play", onPlayReset);
      actEvts.forEach((ev) => scopeDoc.removeEventListener(ev, onActivity));
      actEvts.forEach((ev) => video.removeEventListener(ev, onActivity));
      actEvts.forEach((ev) => topDoc.removeEventListener(ev, onActivity));
      scopeWin.removeEventListener("focus", onFocus);
      scopeWin.removeEventListener("blur", onBlur);
      topWin.removeEventListener("focus", onFocus);
      topWin.removeEventListener("blur", onBlur);
      scopeDoc.removeEventListener("visibilitychange", onVis);
      topDoc.removeEventListener("visibilitychange", onVis);
    };
  }

  let _visIO = null,
      _visMap = new WeakMap(),
      _visObserved = new WeakSet();
  function ensureVisIO() {
    if (_visIO) return _visIO;
    const thr = Number(config?.pauseOverlay?.visThreshold ?? 0.1);
    _visIO = LC.trackMo(new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        const ratio = e.intersectionRatio ?? 0;
        _visMap.set(e.target, ratio >= thr);
      });
    }, { root: null, threshold: [0, thr] }));
    return _visIO;
  }
  function unobserveVideo(vid) {
    if (!vid || !_visIO) return;
    try {
      _visIO.unobserve(vid);
    } catch {}
    _visObserved.delete(vid);
    _visMap.delete(vid);
  }
  function legacyDomVisible(vid) {
    if (!vid) return false;
    const rect = vid.getBoundingClientRect?.();
    const shown =
      vid.offsetParent !== null && !vid.hidden && vid.style.display !== "none" && vid.style.visibility !== "hidden" && rect && rect.width > 0 && rect.height > 0;
    return !!shown;
  }
  function isVideoVisible(vid = activeVideo || document.querySelector("video")) {
    if (!vid) return false;
    const io = ensureVisIO();
    if (!_visObserved.has(vid)) {
      io.observe(vid);
      _visObserved.add(vid);
    }
    const seen = _visMap.get(vid);
    if (seen === undefined) return legacyDomVisible(vid);
    return !!seen;
  }

  function convertDurationFromSeconds(sec) {
    const t = Math.floor(sec || 0);
    const m = Math.floor(t / 60),
      h = Math.floor(m / 60),
      rm = m % 60,
      rs = t % 60;
    return h > 0 ? `${h}${labels.sa} ${rm}${labels.dk} ${rs}${labels.sn}` : `${rm}${labels.dk} ${rs}${labels.sn}`;
  }
  function formatSeasonEpisodeLine(ep) {
    const sWord = labels.season || "Season";
    const eWord = labels.episode || "Episode";
    const sNum = ep?.ParentIndexNumber;
    const eNum = ep?.IndexNumber;
    const eTitle = ep?.Name ? ` – ${ep.Name}` : "";
    const numberFirst = new Set(["tur"]);

    let left = "",
      right = "";
    if (numberFirst.has(currentLang)) {
      if (sNum != null) left = `${sNum}. ${sWord}`;
      if (eNum != null) right = `${eNum}. ${eWord}`;
    } else {
      if (sNum != null) left = `${sWord} ${sNum}`;
      if (eNum != null) right = `${eWord} ${eNum}`;
    }
    const mid = left && right ? " • " : "";
    return `${left}${mid}${right}${eTitle}`.trim();
  }
  function formatEpisodeLineShort(ep) {
    const eNum = ep?.IndexNumber;
    const titlePart = ep?.Name ? ` - ${ep.Name}` : "";
    const lang = String(currentLang || "").toLowerCase();
    const fallbackWords = { tur: "bölüm", eng: "Episode", en: "Episode", fra: "Épisode", fr: "Épisode", deu: "Folge", de: "Folge", rus: "серия", ru: "серия" };
    const rawWord = (labels && typeof labels.episode === "string" && labels.episode.trim()) || fallbackWords[lang] || "Episode";
    const numberFirstOverride = typeof labels?.numberFirstEpisode === "boolean" ? labels.numberFirstEpisode : null;
    const numberFirst = numberFirstOverride !== null ? numberFirstOverride : lang === "tur" || lang === "ru" || lang === "rus";
    if (eNum == null) return `${rawWord}${titlePart}`.trim();
    if (lang === "tur") {
      const w = rawWord.toLocaleLowerCase("tr");
      return `${eNum}.${w}${titlePart}`;
    }
    if (lang === "ru" || lang === "rus") {
      const w = rawWord.toLocaleLowerCase("ru");
      return `${eNum} ${w}${titlePart}`;
    }
    return `${rawWord} ${eNum}${titlePart}`;
  }

  function buildImgUrl(item, kind = "Primary", w = 300, h = 169) {
    if (!item?.Id) return "";
    const tag = (item.ImageTags && (item.ImageTags[kind] || item.ImageTags["Primary"])) || item.PrimaryImageTag || item.SeriesPrimaryImageTag || "";
    const base = withServer('');
    const q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90", tag });
    return `${base}/Items/${item.Id}/Images/${kind}?${q.toString()}`;
  }
  function buildBackdropUrl(item, w = 360, h = 202) {
    const base = withServer('');
    if (!item) return "";
    const directTag =
      (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
      (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) ||
      null;
    if (directTag) {
      const q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90", tag: directTag });
      return `${base}/Items/${item.Id}/Images/Backdrop?${q.toString()}`;
    }
    if (item.ParentId) {
      const q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90" });
      if (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) q.set("tag", item.ParentBackdropImageTags[0]);
      return `${base}/Items/${item.ParentId}/Images/Backdrop?${q.toString()}`;
    }
    const seriesId = item.SeriesId || null;
    const seriesBackdropTag = item.SeriesBackdropImageTag || (Array.isArray(item.SeriesBackdropImageTags) && item.SeriesBackdropImageTags[0]) || null;
    if (seriesId) {
      const q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90" });
      if (seriesBackdropTag) q.set("tag", seriesBackdropTag);
      return `${base}/Items/${seriesId}/Images/Backdrop?${q.toString()}`;
    }
    return buildImgUrl(item, "Primary", w, h);
  }
  function goToItem(item) {
    const { serverId } = getSessionInfo();
    if (!item?.Id) return;
    const type = item.Type;
    try { _hideRecoBadgeAndPanel(); } catch {}
    if (type === "Episode" || type === "Season" || true) {
      location.href = `#!/details?id=${encodeURIComponent(item.Id)}&serverId=${encodeURIComponent(serverId)}`;
    }
  }
  async function fetchUnplayedEpisodesInSameSeason(currentEp, { limit = 5 } = {}) {
    if (!currentEp?.SeasonId) return [];
    const { userId } = getSessionInfo();
    const qs = new URLSearchParams({
      ParentId: currentEp.SeasonId,
      IncludeItemTypes: "Episode",
      Recursive: "false",
      UserId: userId || "",
      Filters: "IsUnplayed",
      Limit: String(limit + 1),
      Fields: [
        "UserData",
        "PrimaryImageAspectRatio",
        "RunTimeTicks",
        "ProductionYear",
        "SeriesId",
        "ParentId",
        "ImageTags",
        "PrimaryImageTag",
        "BackdropImageTags",
        "ParentBackdropImageTags",
        "SeriesBackdropImageTag",
        "SeriesPrimaryImageTag",
        "SeriesLogoImageTag"
      ].join(","),
      SortBy: "IndexNumber",
      SortOrder: "Ascending",
    });
    const data = await makeApiRequest(withServer(`/Items?${qs.toString()}`));
    const items = data?.Items || [];
    return items.filter((i) => i.Id !== currentEp.Id).slice(0, limit);
  }
  async function fetchSimilarUnplayed(item, { limit = 5 } = {}) {
  if (!item?.Id) return [];
  const { userId } = getSessionInfo();
  const qs = new URLSearchParams({
    UserId: userId || "",
    Limit: String(limit * 3),
    EnableUserData: "true",
    Fields: "UserData,PrimaryImageAspectRatio,RunTimeTicks,ProductionYear,Genres,SeriesId,ParentId,ImageTags,PrimaryImageTag,BackdropImageTags,ParentBackdropImageTags,SeriesBackdropImageTag,SeriesPrimaryImageTag,SeriesLogoImageTag"
  });
  const items = await makeApiRequest(withServer(`/Items/${encodeURIComponent(item.Id)}/Similar?${qs.toString()}`));
  const list = Array.isArray(items) ? items : items?.Items || [];
  const unplayed = list.filter((x) => {
    const ud = x?.UserData || {};
    if (typeof ud.Played === "boolean") return !ud.Played;
    if (typeof ud.PlayCount === "number") return ud.PlayCount === 0;
    return true;
  });
  const chosen = unplayed.slice(0, limit);
  return chosen.length ? chosen : list.slice(0, limit);
}

  function renderRecommendations(items) {
    _recoItemsCache = Array.isArray(items) ? items.slice() : [];
    if (!_recoListEl) return;
    _recoListEl.innerHTML = "";
    if (!_recoItemsCache.length) { _clearRecos(); return; }
    _recoItemsCache.forEach((it) => {
      const card = document.createElement("button");
      card.className = "jms-reco-card";
      card.type = "button";
      const imgUrl = buildBackdropUrl(it, 360, 202);
      const primaryFallback = buildImgUrl(it, "Primary", 360, 202);
      const img = document.createElement("img");
      img.className = "jms-reco-thumb";
      img.loading = "lazy";
      img.alt = "";
      img.src = imgUrl || primaryFallback;
      img.onerror = () => { img.onerror = null; img.src = primaryFallback; };
      const titleWrap = document.createElement("div");
      titleWrap.className = "jms-reco-title";

      const logoUrl = (()=>{
        if (it.Type === "Episode" && it.SeriesId) {
          const tag = it.SeriesLogoImageTag || null;
          if (tag) {
            const base = withServer('');
            const { accessToken } = getSessionInfo();
            const tokenQ = accessToken ? `&api_key=${encodeURIComponent(accessToken)}` : "";
            return `${base}/Items/${encodeURIComponent(it.SeriesId)}/Images/Logo?tag=${encodeURIComponent(tag)}${tokenQ}`;
          }
          return null;
        }
        const tag = (it.ImageTags && it.ImageTags.Logo) || it.SeriesLogoImageTag || null;
        if (tag) {
          const base = withServer('');
          const { accessToken } = getSessionInfo();
          const tokenQ = accessToken ? `&api_key=${encodeURIComponent(accessToken)}` : "";
          const id = (it.ImageTags && it.ImageTags.Logo) ? it.Id : (it.SeriesId || it.Id);
          return `${base}/Items/${encodeURIComponent(id)}/Images/Logo?tag=${encodeURIComponent(tag)}${tokenQ}`;
        }
        return null;
      })();

      if (logoUrl) {
        const logoImg = document.createElement("img");
        logoImg.className = "jms-reco-title-logo";
        logoImg.alt = "";
        logoImg.loading = "lazy";
        logoImg.src = logoUrl;
        titleWrap.innerHTML = "";
        titleWrap.appendChild(logoImg);
      } else {
        titleWrap.textContent = it.Type === "Episode"
          ? formatEpisodeLineShort(it)
          : (it.Name || it.OriginalTitle || "");
      }

      card.appendChild(img);
      card.appendChild(titleWrap);
      card.addEventListener("click", (e) => { e.stopPropagation(); goToItem(it); });
      _recoListEl.appendChild(card);
    });
    _maybeShowBadge();
  }

  if (!window.__jmsPauseOverlay._boundUnload2) {
    window.addEventListener("beforeunload", () => {
      for (const v of imageBlobCache.values()) {
        if (v) URL.revokeObjectURL(v);
      }
      imageBlobCache.clear();
    });
    window.__jmsPauseOverlay._boundUnload2 = true;
  }

  let _moQueued = false;
  function shouldSkipDeepNode(n) {
    try {
      const ch = n.childElementCount || 0;
      return ch > 500;
    } catch {
      return false;
    }
  }
  const mo = LC.trackMo(
    new MutationObserver((muts) => {
      if (_moQueued) return;
      _moQueued = true;

      const queue = new Set();
      for (const m of muts) {
        m.addedNodes?.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (shouldSkipDeepNode(n)) return;
          if (n.tagName === "VIDEO") queue.add(n);
          else if (n.tagName === "SOURCE" && n.parentElement?.tagName === "VIDEO") queue.add(n.parentElement);
          else if (n.tagName === "IFRAME") {
          const onFrameLoad = () => {
             try {
               const idoc = n.contentDocument || n.contentWindow?.document;
               if (!idoc) return;
               const vInFrame = findAnyVideoDeep(idoc);
               if (vInFrame) bindVideo(vInFrame);
             } catch {}
           };
           onFrameLoad();
           try { n.addEventListener("load", onFrameLoad, { once: true }); } catch {}
         }
          const vids = n.querySelectorAll?.("video");
          if (vids) {
            for (let i = 0; i < vids.length && i < 8; i++) queue.add(vids[i]);
          }
        });
        m.removedNodes?.forEach((n) => {
          const containsActive =
            !!activeVideo &&
            n.nodeType === 1 &&
            typeof n.contains === "function" &&
            n.contains(activeVideo);
          if (n === activeVideo || containsActive) {
            scheduleMaybeDetachActive();
          }
        });
      }
      LC.addRaf(() => {
        _moQueued = false;
        queue.forEach((v) => { try { bindVideo(v, 'mo'); } catch {} });
      });
    })
  );
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

  const initVid = findAnyVideoDeep(document);
  if (initVid) bindVideo(initVid);
  let _fallbackTries = 0;
  const _fallbackScan = setInterval(() => {
    if (!activeVideo) {
      const v = findBestPlayableVideoAnywhere(10);
      if (v) bindVideo(v);
    }
    _fallbackTries++;
    if (_fallbackTries > 10) { clearInterval(_fallbackScan); return; }
  }, 300);
 LC.trackClean(() => clearInterval(_fallbackScan));

  function startOverlayLogic() {
    const tick = () => {
      const onValidPage = isVideoVisible(activeVideo);
      if (!onValidPage && overlayVisible) hideOverlay();
    };
    const timer = LC.addInterval(tick, 400);
    const stop = () => {
      clearInterval(timer);
    };
    LC.trackClean(stop);
    return stop;
  }

  const _onPop = () => {
    hideOverlay();
    try { _clearRecos(); } catch {}
  };
  const _onHash = () => {
    hideOverlay();
    try { _clearRecos(); } catch {}
  };
  const _onVis = () => {
    if (document.visibilityState === "visible" && !isVideoVisible()) {
      hideOverlay();
    }
  };
  window.addEventListener("hashchange", () => { blurAt = null; hiddenAt = null; lastPauseReason = null; }, { signal });
  window.addEventListener("popstate",   () => { blurAt = null; hiddenAt = null; lastPauseReason = null; }, { signal });
  function isFullscreenNow() {
  return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement);
}

const _onKey = (e) => {
  if (e.key === "Escape" && overlayVisible && !isFullscreenNow()) {
    e.preventDefault();
    hideOverlay();
    return;
  }

  const altClose =
    (e.key === "Backspace")

  if (altClose && overlayVisible) {
    e.preventDefault();
    hideOverlay();
    return;
  }

  if (e.key.toLowerCase() === "f" && activeVideo) {
    if (isFullscreenNow()) {
      document.exitFullscreen?.();
    } else {
      activeVideo.requestFullscreen?.();
    }
  }
};
  document.addEventListener("keydown", _onKey, { signal });
  window.addEventListener("popstate", _onPop, { signal });
  window.addEventListener("hashchange", _onHash, { signal });
  document.addEventListener("visibilitychange", _onVis, { signal });

  const stopLoop = startOverlayLogic();
  requestIdleCallback?.(() => {
    if (!window.__jmsPauseOverlay?.active) return;
    initDescriptorTagsOnce();
  }, { timeout: 3000 });

  function destroy() {
    try {
      if (removeHandlers) removeHandlers();
    } catch {}
    try {
      mo.disconnect();
    } catch {}
    try {
      if (activeVideo) unobserveVideo(activeVideo);
    } catch {}
    try { if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout); } catch {}
    ratingGenreTimeout = null;
    try { wipeBadgeStateAndDom(); } catch {}
    try { wipeIconBadges(); } catch {}
    try { overlayEl?.classList.remove("visible"); } catch {}
    activeVideo = null;
    currentMediaId = null;
    if (pauseTimeout) clearTimeout(pauseTimeout);
    if (_sessPollTimer) clearInterval(_sessPollTimer);
    pauseTimeout = null;
    try {
      stopLoop?.();
    } catch {}
    try {
      LC.cleanupAll();
    } catch {}
    try { _visIO?.disconnect(); } catch {}
    _visIO = null;
    _visObserved = new WeakSet();
    _visMap = new WeakMap();
    try {
      for (const v of imageBlobCache.values()) { if (v) URL.revokeObjectURL(v); }
      imageBlobCache.clear();
    } catch {}
    window.__jmsPauseOverlay.active = false;
    window.__jmsPauseOverlay.destroy = null;
  }
  window.__jmsPauseOverlay.destroy = destroy;

  return () => {
    destroy();
  };
}

function createIconEl() {
  if (!document.getElementById("jms-rating-icons")) {
    const el = document.createElement("div");
    el.id = "jms-rating-icons";
    el.className = "rating-icons-overlay";
    el.innerHTML = `<div class="rating-icons-row"></div>`;
    document.body.appendChild(el);

    if (!document.getElementById("jms-rating-icons-css")) {
      const style = document.createElement("style");
      style.id = "jms-rating-icons-css";
      style.textContent = `
      .rating-icons-overlay{
        position:fixed;
        top:60px;
        left:24px;
        z-index:9998;
        pointer-events:none;
        opacity:0;
        transform:translateY(-10px);
        transition:transform .30s cubic-bezier(.2,.8,.4,1), opacity .30s ease;
      }
      .rating-icons-overlay.visible{ opacity:1; transform:translateY(0) }
      .rating-icons-row{
        display:flex; align-items:center; gap:10px;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)) drop-shadow(0 3px 8px rgba(0,0,0,.35));
      }
      .rating-icons-row img{
        width:42px; height:42px; display:block; border-radius:6px; background:transparent;
      }`;
      document.head.appendChild(style);
    }
  }
  _iconEl = document.getElementById("jms-rating-icons");
  return _iconEl;
}

function hideIconBadges(reason) {
  if (!_iconEl) return;
  _iconEl.classList.remove("visible");
  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = null;
  if (reason === "auto" || reason === "finished") {
    setTimeout(() => {
      if (_iconEl && _iconEl.parentNode) {
        const row = _iconEl.querySelector(".rating-icons-row");
        if (row) row.innerHTML = "";
      }
    }, 260);
  }
}

function wipeIconBadges() {
  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = null;
  if (_iconEl) {
    _iconEl.classList.remove("visible");
    const row = _iconEl.querySelector(".rating-icons-row");
    if (row) row.innerHTML = "";
  }
}

function _hasAnyWords(text, words){
  if (!text) return false;
  const rx = _getWordRxCached(words);
  return !!(rx && rx.test(String(text)));
}

function _descCodesFromItem(item){
  const dict = getDescriptorKeywordMap();
  const overview = item?.Overview || "";
  const tags = (item?.Tags || item?.Keywords || []).join(" ");
  const joined = `${overview} ${tags}`.trim();

  const codes = new Set();
  if (_hasAnyWords(joined, dict.sex)) codes.add("cinsellik");
  if (_hasAnyWords(joined, dict.violence) || _hasAnyWords(joined, dict.war) || _hasAnyWords(joined, dict.crime)) {
    codes.add("siddet");
  }
  if (_hasAnyWords(joined, dict.mature)) codes.add("yetiskin");

  for (const t of (item?.Tags || [])) {
    const hit = _bucketsForTag(t);
    if (hit.has("sex")) codes.add("cinsellik");
    if (hit.has("violence")) codes.add("siddet");
    if (hit.has("mature")) codes.add("yetiskin");
  }

  return Array.from(codes);
}

const BUCKET_ICON_MAP = {
  sex: "cinsellik",
  nudity: "cinsellik",
  romance_love: "cinsellik",
  violence: "siddet",
  war: "siddet",
  crime: "siddet",
  action_adventure: "siddet",
  superhero: "siddet",
  sports: "siddet",
  mature: "yetiskin",
  horror: "yetiskin",
  drugs: "yetiskin",
  profanity: "yetiskin",
  discrimination: "yetiskin",
  political: "yetiskin",
  religion_myth: "yetiskin",
  thriller_suspense: "yetiskin",
  mystery_detective: "yetiskin",
  documentary_biopic: "genel",
  music_dance: "genel",
  animation_kids: "genel",
  animals_nature: "genel",
  historical: "genel",
  fantasy_magic: "genel",
  supernatural: "genel",
  fairytale: "genel",
  travel_road: "genel",
  period_era: "genel",
  western: "genel",
  sci_fi_tech: "genel"
};

function _bucketKeysFromItem(item){
  const keys = new Set();
  for (const t of (item?.Tags || item?.Keywords || [])) {
    for (const k of _bucketsForTag(t)) keys.add(k);
  }
  const K = (s)=>String(s||"").toLowerCase();
  const hay = K([item?.Overview, (item?.Taglines||[]).join(" "), (item?.Studios||[]).join(" ")].join(" "));
  if (/horror|slasher|gore|supernatural|paranormal/.test(hay)) keys.add("horror");
  if (/\bwar|battle|army|military\b/.test(hay)) keys.add("war");
  if (/\bcrime|mafia|gang|heist|robbery\b/.test(hay)) keys.add("crime");
  if (/\bviolence|violent|fight|combat|torture\b/.test(hay)) keys.add("violence");
  if (/\bsex|sexual|erotic|intimate|nudity|nude\b/.test(hay)) { keys.add("sex"); keys.add("nudity"); }
  if (/\bdrug|narcotic|cocaine|heroin|meth\b/.test(hay)) keys.add("drugs");
  if (/\bprofanity|explicit language|vulgar|swear\b/.test(hay)) keys.add("profanity");
  if (/\bthriller|suspense|stalker|espionage|kidnapping\b/.test(hay)) keys.add("thriller_suspense");
  if (/\bmystery|detective|whodunit|noir\b/.test(hay)) keys.add("mystery_detective");
  if (/\bromance|romantic|love\b/.test(hay)) keys.add("romance_love");
  if (/\baddiction|trauma|suicide|abuse|domestic violence\b/.test(hay)) keys.add("mature");
  return keys;
}

function buildIconListForItem(item){
  const ALLOWED = new Set(["genel","cinsellik","siddet","yetiskin"]);
  const list = [];
  const bucketKeys = _bucketKeysFromItem(item);
  for (const k of bucketKeys) {
    const icon = BUCKET_ICON_MAP[k];
    if (icon) list.push(icon);
  }

  const codes = _descCodesFromItem(item);
  for (const c of codes) list.push(c);
  const raw = item?.OfficialRating || "";
  const norm = String(normalizeAgeRating(raw) || "").toLowerCase();
  const ageNum = parseInt(norm, 10);
  const isAdult =
    (Number.isFinite(ageNum) && ageNum >= 18) ||
    /(^|\b)(r|nc-?17|tvma|18\+)/i.test(raw);

  if (isAdult) list.push("yetiskin");
  if (!list.length) {
    const genelLbl = String(labels?.genel || "genel").toLowerCase();
    const isGeneral =
      norm.includes("genel") ||
      norm === "7+" ||
      norm === "0+" ||
      norm.includes(genelLbl) ||
      /^g$|^tvg$/i.test(raw);
    list.push(isAdult ? "yetiskin" : (isGeneral ? "genel" : "genel"));
  }
  let out = Array.from(new Set(list.filter(n => ALLOWED.has(n))));
  if (out.includes("yetiskin")) {
    out = out.filter(n => n !== "genel");
  }

  return out;
}

function showIconBadges(itemOrIcons, durationMs) {
  const po = getConfig()?.pauseOverlay || {};
  if (po.showAgeBadge === false) return;

  const el = createIconEl();
  const row = el.querySelector(".rating-icons-row");
  const icons = Array.isArray(itemOrIcons)
    ? itemOrIcons
    : (itemOrIcons?.__jmsMaturityIcons || buildIconListForItem(itemOrIcons));

  if (!icons.length) { hideIconBadges(); return; }

  row.innerHTML = icons.map(n => `<img src="./slider/src/images/ages/${n}.svg" alt="">`).join("");
  el.classList.add("visible");

  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = setTimeout(() => {
    hideIconBadges("auto");
  }, _msFromConfig((durationMs ?? AGE_BADGE_DEFAULT_MS), 10000));
}
