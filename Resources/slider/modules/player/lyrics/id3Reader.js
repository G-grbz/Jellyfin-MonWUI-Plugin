import { musicPlayerState } from "../core/state.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { getConfig } from "../../config.js";

const config = getConfig();
const MAX_QUEUE_LENGTH = 100;
const MAX_CONCURRENT_READS = Math.max(1, Number(config.id3limit) || 2);
const FETCH_TIMEOUT_MS = 10_000;
const TAG_READ_TIMEOUT_MS = 5_000;
const RANGE_BYTES = 256 * 1024;
const MAX_TAGS_CACHE = Math.max(50, Number(config.id3TagsCacheLimit) || 200);
const MAX_IMAGES_CACHE = Math.max(20, Number(config.id3ImagesCacheLimit) || 80);
const enableBase64Images = Boolean(config.id3UseBase64Images === true);

const id3ReadQueue = [];
let activeReaders = 0;
let localTagsCache = new Map();
let localImagesCache = new Map();
let cachesHydratedIntoState = false;
let jsMediaTagsReady = null;

function ensureCaches() {
  try {
    const stateObj = musicPlayerState;
    if (!stateObj || typeof stateObj !== "object") return;

    if (!(stateObj.id3TagsCache instanceof Map)) {
      stateObj.id3TagsCache = new Map();
    }
    if (!(stateObj.id3ImageCache instanceof Map)) {
      stateObj.id3ImageCache = new Map();
    }
    if (!cachesHydratedIntoState) {
      if (localTagsCache.size) {
        for (const [k, v] of localTagsCache) stateObj.id3TagsCache.set(k, v);
        localTagsCache.clear();
      }
      if (localImagesCache.size) {
        for (const [k, v] of localImagesCache) stateObj.id3ImageCache.set(k, v);
        localImagesCache.clear();
      }
      cachesHydratedIntoState = true;
    }
    trimTagsLRU(stateObj.id3TagsCache);
    trimImagesLRU(stateObj.id3ImageCache);
  } catch {
  }
}

function getTagsCache() {
  try {
    if (musicPlayerState?.id3TagsCache instanceof Map) return musicPlayerState.id3TagsCache;
  } catch {}
  return localTagsCache;
}
function getImagesCache() {
  try {
    if (musicPlayerState?.id3ImageCache instanceof Map) return musicPlayerState.id3ImageCache;
  } catch {}
  return localImagesCache;
}

function trimTagsLRU(cache) {
  while (cache.size > MAX_TAGS_CACHE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}
function trimImagesLRU(cache) {
  while (cache.size > MAX_IMAGES_CACHE) {
    const oldestKey = cache.keys().next().value;
    const val = cache.get(oldestKey);
    safeRevoke(val);
    cache.delete(oldestKey);
  }
}

export async function readID3Tags(trackId) {
  ensureCaches();

  return new Promise((resolve) => {
    const tagsCache = getTagsCache();
    if (tagsCache.has(trackId)) {
      const cached = tagsCache.get(trackId);
      tagsCache.delete(trackId);
      tagsCache.set(trackId, cached);
      resolve(cached);
      return;
    }

    if (id3ReadQueue.length >= MAX_QUEUE_LENGTH) {
      console.warn(`ID3 kuyruğu dolu (>=${MAX_QUEUE_LENGTH}), atlanıyor: ${trackId}`);
      resolve(null);
      return;
    }

    id3ReadQueue.push({ trackId, resolve });
    processQueue();
  });
}

export async function parseID3Tags(buffer) {
  try {
    await loadJSMediaTagsOnce();
    return new Promise((resolve) => {
      const onSuccess = ({ tags }) => {
        const uslt = tags?.USLT?.data?.lyrics || tags?.USLT?.lyrics;
        const alt = tags?.lyrics?.lyrics;
        resolve(uslt || alt || null);
      };
      const onError = () => resolve(null);

      const blob = new Blob([buffer]);
      window.jsmediatags.read(blob, { onSuccess, onError });
    });
  } catch {
    return null;
  }
}

export function loadJSMediaTags() {
  return loadJSMediaTagsOnce();
}

function loadJSMediaTagsOnce() {
  if (window.jsmediatags) return Promise.resolve();
  if (jsMediaTagsReady) return jsMediaTagsReady;

  jsMediaTagsReady = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jsmediatags]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error("jsmediatags yüklenemedi")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `./slider/modules/player/lyrics/jsmediatags/jsmediatags.min.js`;
    script.async = true;
    script.defer = true;
    script.dataset.jsmediatags = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("jsmediatags yüklenemedi"));
    document.head.appendChild(script);
  });

  return jsMediaTagsReady;
}

function processQueue() {
  while (activeReaders < MAX_CONCURRENT_READS && id3ReadQueue.length) {
    const job = id3ReadQueue.shift();
    if (!job) break;
    activeReaders++;
    processSingle(job.trackId)
      .then(result => job.resolve(result))
      .catch(() => job.resolve(null))
      .finally(() => {
        activeReaders--;
        queueMicrotask(processQueue);
      });
  }
}

async function processSingle(trackId) {
  ensureCaches();
  await loadJSMediaTagsOnce();
  const token = getAuthToken();
  let controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp, arrayBuffer = null;
  try {
    resp = await fetch(apiUrl(`/Audio/${trackId}/stream?Static=true`), {
      method: "GET",
      headers: {
        Range: `bytes=0-${RANGE_BYTES - 1}`,
        "X-Emby-Token": token
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp?.ok && resp?.status !== 206) {
    throw new Error("Kısmi müzik verisi alınamadı");
  }

  try {
    arrayBuffer = await resp.arrayBuffer();
    const blob = new Blob([arrayBuffer]);

    let tags = await readTagsWithFallback(blob, trackId, false);
    arrayBuffer = null;

    if (!tags) return null;
    if (tags.picture) {
      const { data, format } = tags.picture;
      let pictureUri = null;

      try {
        if (enableBase64Images) {
          const base64 = arrayToBase64(new Uint8Array(data));
          pictureUri = `data:${format || "image/jpeg"};base64,${base64}`;
        } else {
          const pictureBlob = new Blob([new Uint8Array(data)], { type: format || "image/jpeg" });
          pictureUri = URL.createObjectURL(pictureBlob);
        }
      } catch (e) {
        console.error("Resim dönüştürme hatası:", e);
      }

      tags.pictureUri = pictureUri || null;
      delete tags.picture;

      if (tags.pictureUri) {
        imagesCacheSet(trackId, tags.pictureUri);
      }
    }

    tagsCacheSet(trackId, tags);
    return tags;
  } finally {
    resp = null;
    arrayBuffer = null;
  }
}

function readTagsWithFallback(blob, trackId, fullFetch) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    const timeout = setTimeout(() => {
      console.error("ID3 okuma zaman aşımı");
      finish(null);
    }, TAG_READ_TIMEOUT_MS);

    const onSuccess = (tag) => {
      clearTimeout(timeout);
      if (settled) return;

      const genreRaw = tag?.tags?.genre;
      let genre = null;
      if (typeof genreRaw === "string") {
        const parts = genreRaw
          .split(/[,;/]/)
          .map(g => g.trim().toLowerCase())
          .filter((g, i, arr) => g && arr.indexOf(g) === i);
        genre = parts.map(g => g[0].toUpperCase() + g.slice(1)).join(", ");
      }

      finish({
        lyrics: tag?.tags?.USLT?.lyrics || tag?.tags?.lyrics?.lyrics || null,
        picture: tag?.tags?.picture || null,
        genre,
        year: tag?.tags?.year || null
      });
    };

    const onError = async (error) => {
      if (settled) return;
      const isOffsetErr = error?.type === "parseData" && /Offset \d+ hasn\'t been loaded yet/.test(error?.info || "");

      if (isOffsetErr && !fullFetch) {
        try {
          const token = getAuthToken();
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          const fullResp = await fetch(apiUrl(`/Audio/${trackId}/stream?Static=true`), {
            headers: { "X-Emby-Token": token },
            signal: controller.signal
          });
          clearTimeout(t);

          if (fullResp.ok) {
            const fullBuf = await fullResp.arrayBuffer();
            const fullBlob = new Blob([fullBuf]);
            const retry = await readTagsWithFallback(fullBlob, trackId, true);
            finish(retry);
            return;
          }
        } catch (e) {
          console.error("Fallback tam indirme başarısız:", e);
        }
      }

      console.error("ID3 okuma hatası:", error);
      clearTimeout(timeout);
      finish(null);
    };

    try {
      window.jsmediatags.read(blob, { onSuccess, onError });
    } catch (e) {
      clearTimeout(timeout);
      console.error("jsmediatags çağrısı hatası:", e);
      finish(null);
    }
  });
}

function tagsCacheSet(key, value) {
  ensureCaches();
  const cache = getTagsCache();
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  trimTagsLRU(cache);
}

function imagesCacheSet(key, blobUrlOrDataUri) {
  ensureCaches();
  const cache = getImagesCache();
  if (cache.has(key)) {
    const prev = cache.get(key);
    safeRevoke(prev);
    cache.delete(key);
  }
  cache.set(key, blobUrlOrDataUri);
  trimImagesLRU(cache);
}

function safeRevoke(uri) {
  if (typeof uri === "string" && uri.startsWith("blob:")) {
    try { URL.revokeObjectURL(uri); } catch {}
  }
}

function arrayToBase64(uint8) {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < uint8.length; i += CHUNK) {
    const sub = uint8.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}
