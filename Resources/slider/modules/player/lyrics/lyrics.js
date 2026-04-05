import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { musicDB } from "../utils/db.js";
import { showNotification } from "../ui/notification.js";
import { parseID3Tags } from "./id3Reader.js";
import { isRadioTrack } from "../core/radio.js";
import { hasLyricsPayload, normalizeLyricsPayload } from "./normalizer.js";

const config = getConfig();

let fetchAbort = null;
let currentRequestKey = null;
let audioEndedHandlerAttached = false;
let lastActiveIdx = -1;
let lastNextIdx = -1;
let settingsInitialized = false;
let settingsRefs = null;
let contentContainer = null;
let requestSequence = 0;

function safeClear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function buildRequestKey(trackId, source) {
  requestSequence += 1;
  return `${trackId}::${source}::${requestSequence}`;
}

function cancelOngoingFetch() {
  if (fetchAbort) {
    try { fetchAbort.abort(); } catch {}
  }
  fetchAbort = null;
}

function getCurrentLyricsTrack(trackOverride = null) {
  return trackOverride || musicPlayerState.currentTrack || musicPlayerState.playlist[musicPlayerState.currentIndex] || null;
}

function ensureSettingsUI() {
  if (settingsInitialized) return;

  const root = musicPlayerState.lyricsContainer;
  safeClear(root);

  const headerContainer = document.createElement("div");
  headerContainer.className = "lyrics-header-container";

  const settingsContainer = document.createElement("div");
  settingsContainer.className = "lyrics-settings-container";

  const delayContainer = document.createElement("div");
  delayContainer.className = "lyrics-setting-group";

  const delayLabel = document.createElement("span");
  delayLabel.textContent = config.languageLabels.lyricsDelay || "Gecikme: ";

  const delaySlider = document.createElement("input");
  delaySlider.type = "range";
  delaySlider.id = "lyrics-delay-slider";
  delaySlider.name = "lyrics-delay-slider";
  delaySlider.min = "-5";
  delaySlider.max = "5";
  delaySlider.step = "0.1";
  delaySlider.value = localStorage.getItem("lyricsDelay") || "0";
  delaySlider.className = "lyrics-delay-slider";
  delaySlider.setAttribute("aria-label", config.languageLabels.lyricsDelay || "Şarkı sözü gecikmesi");

  const delayValue = document.createElement("span");
  delayValue.className = "lyrics-setting-value";
  delayValue.textContent = `${delaySlider.value}s`;

  delaySlider.addEventListener("input", (e) => {
    const value = e.target.value;
    delayValue.textContent = `${value}s`;
    localStorage.setItem("lyricsDelay", value);
    musicPlayerState.lyricsDelay = parseFloat(value);
  });

  delayValue.addEventListener("click", () => {
    const manualInput = document.createElement("input");
    manualInput.type = "number";
    manualInput.name = "lyrics-delay-manual-input";
    manualInput.step = "0.1";
    manualInput.value = delaySlider.value;
    manualInput.className = "lyrics-setting-manual-input";
    manualInput.style.width = "4em";
    manualInput.setAttribute("aria-label", config.languageLabels.lyricsDelay || "Şarkı sözü gecikmesi");

    delayValue.style.display = "none";
    delayValue.parentNode.insertBefore(manualInput, delayValue.nextSibling);

    const apply = () => {
      let v = parseFloat(manualInput.value);
      if (Number.isNaN(v)) v = 0;
      v = Math.max(parseFloat(delaySlider.min), Math.min(parseFloat(delaySlider.max), v));
      delaySlider.value = v;
      delayValue.textContent = `${v}s`;
      localStorage.setItem("lyricsDelay", v);
      musicPlayerState.lyricsDelay = v;
      cleanup();
    };
    const cleanup = () => {
      manualInput.removeEventListener("blur", onBlur);
      manualInput.removeEventListener("keydown", onKey);
      manualInput.remove();
      delayValue.style.display = "";
    };
    const onBlur = () => apply();
    const onKey = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); apply(); }
      else if (ev.key === "Escape") { cleanup(); }
    };
    manualInput.addEventListener("blur", onBlur);
    manualInput.addEventListener("keydown", onKey);
    manualInput.focus();
  });

  delayContainer.append(delayLabel, delaySlider, delayValue);

  const durationContainer = document.createElement("div");
  durationContainer.className = "lyrics-setting-group";

  const durationLabel = document.createElement("span");
  durationLabel.textContent = config.languageLabels.lyricsDuration || "Aktiflik Süresi: ";

  const durationSlider = document.createElement("input");
  durationSlider.type = "range";
  durationSlider.id = "lyrics-duration-slider";
  durationSlider.name = "lyrics-duration-slider";
  durationSlider.min = "1";
  durationSlider.max = "15";
  durationSlider.step = "0.5";
  durationSlider.value = localStorage.getItem("lyricsDuration") || "5";
  durationSlider.className = "lyrics-duration-slider";
  durationSlider.setAttribute("aria-label", config.languageLabels.lyricsDuration || "Şarkı sözü aktiflik süresi");

  const durationValue = document.createElement("span");
  durationValue.className = "lyrics-setting-value";
  durationValue.textContent = `${durationSlider.value}s`;

  durationSlider.addEventListener("input", (e) => {
    const value = e.target.value;
    durationValue.textContent = `${value}s`;
    localStorage.setItem("lyricsDuration", value);
    musicPlayerState.lyricsDuration = parseFloat(value);
  });

  durationValue.addEventListener("click", () => {
    const manualInput = document.createElement("input");
    manualInput.type = "number";
    manualInput.name = "lyrics-duration-manual-input";
    manualInput.step = "0.5";
    manualInput.min = "1";
    manualInput.max = "15";
    manualInput.value = durationSlider.value;
    manualInput.className = "lyrics-setting-manual-input";
    manualInput.style.width = "4em";
    manualInput.setAttribute("aria-label", config.languageLabels.lyricsDuration || "Şarkı sözü aktiflik süresi");

    durationValue.style.display = "none";
    durationValue.parentNode.insertBefore(manualInput, durationValue.nextSibling);

    const apply = () => {
      let v = parseFloat(manualInput.value);
      if (Number.isNaN(v)) v = 5;
      v = Math.max(parseFloat(durationSlider.min), Math.min(parseFloat(durationSlider.max), v));
      durationSlider.value = v;
      durationValue.textContent = `${v}s`;
      localStorage.setItem("lyricsDuration", v);
      musicPlayerState.lyricsDuration = v;
      cleanup();
    };
    const cleanup = () => {
      manualInput.removeEventListener("blur", onBlur);
      manualInput.removeEventListener("keydown", onKey);
      manualInput.remove();
      durationValue.style.display = "";
    };
    const onBlur = () => apply();
    const onKey = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); apply(); }
      else if (ev.key === "Escape") { cleanup(); }
    };
    manualInput.addEventListener("blur", onBlur);
    manualInput.addEventListener("keydown", onKey);
    manualInput.focus();
  });

  durationContainer.append(durationLabel, durationSlider, durationValue);
  settingsContainer.append(delayContainer, durationContainer);

  const updateBtn = document.createElement("span");
  updateBtn.className = "update-lyrics-btn";
  updateBtn.title = config.languageLabels.updateLyrics || "Şarkı sözünü güncelle";
  updateBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
  updateBtn.addEventListener("click", () => {
    const track = getCurrentLyricsTrack();
    if (track) updateSingleTrackLyrics(track.Id);
  });

  headerContainer.append(settingsContainer, updateBtn);
  musicPlayerState.lyricsContainer.appendChild(headerContainer);

  contentContainer = document.createElement("div");
  contentContainer.className = "lyrics-content-container";
  musicPlayerState.lyricsContainer.appendChild(contentContainer);

  settingsRefs = { delaySlider, delayValue, durationSlider, durationValue };
  settingsInitialized = true;
}

function updateSettingsUIFromStorage() {
  if (!settingsRefs) return;
  const delay = localStorage.getItem("lyricsDelay") ?? "0";
  const duration = localStorage.getItem("lyricsDuration") ?? "5";
  settingsRefs.delaySlider.value = delay;
  settingsRefs.delayValue.textContent = `${delay}s`;
  musicPlayerState.lyricsDelay = parseFloat(delay);
  settingsRefs.durationSlider.value = duration;
  settingsRefs.durationValue.textContent = `${duration}s`;
  musicPlayerState.lyricsDuration = parseFloat(duration);
}

function setLoading() {
  ensureSettingsUI();
  safeClear(contentContainer);
  const loading = document.createElement("div");
  loading.className = "lyrics-loading";
  loading.textContent = config.languageLabels.loadingLyrics || "Yükleniyor...";
  contentContainer.appendChild(loading);
}

function setNoLyrics(message = "") {
  ensureSettingsUI();
  safeClear(contentContainer);
  const n = document.createElement("div");
  n.className = "lyrics-not-found";
  n.textContent = message || config.languageLabels.noLyricsFound || "Şarkı sözü yok";
  contentContainer.appendChild(n);
}

function setError(msg) {
  ensureSettingsUI();
  safeClear(contentContainer);
  const e = document.createElement("div");
  e.className = "lyrics-error";
  e.textContent = `${config.languageLabels.lyricsError || "Hata"}: ${msg}`;
  contentContainer.appendChild(e);
}

async function fetchLyricsFromServer(trackId, signal) {
  const token = getAuthToken();
  const endpoints = [
    { url: apiUrl(`/Audio/${trackId}/Lyrics`), type: "text" },
    { url: apiUrl(`/Items/${trackId}/Lyrics`), type: "json" },
  ];

  for (const { url, type } of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "X-Emby-Token": token },
        signal,
      });

      if (res.status === 404) {
        continue;
      }
      if (!res.ok) {
        continue;
      }

      const data = (type === "json") ? await res.json() : await res.text();
      const lyrics = normalizeLyricsPayload(data);

      if (lyrics) {
        return lyrics;
      }
    } catch (err) {
      if (err?.name === "AbortError") return null;
      continue;
    }
  }
  return null;
}

export async function fetchLyrics(trackOverride = null) {
  const currentTrack = getCurrentLyricsTrack(trackOverride);
  if (!currentTrack) return null;

  if (isRadioTrack(currentTrack)) {
    setNoLyrics(config.languageLabels.radioNoLyrics || "Canli radyo yayini icin sarki sozu yok");
    return null;
  }

  updateSettingsUIFromStorage();
  stopLyricsSync();
  setLoading();
  const reqKey = buildRequestKey(currentTrack.Id, "fetchLyrics");
  currentRequestKey = reqKey;

  const cached = normalizeLyricsPayload(musicPlayerState.lyricsCache[currentTrack.Id]);
  if (reqKey !== currentRequestKey) return null;
  if (cached) {
    musicPlayerState.lyricsCache[currentTrack.Id] = cached;
    displayLyrics(cached);
    startLyricsSync();
    return cached;
  }

  const dbLyrics = normalizeLyricsPayload(await musicDB.getLyrics(currentTrack.Id));
  if (reqKey !== currentRequestKey) return null;
  if (dbLyrics) {
    musicPlayerState.lyricsCache[currentTrack.Id] = dbLyrics;
    displayLyrics(dbLyrics);
    startLyricsSync();
    return dbLyrics;
  }

  cancelOngoingFetch();
  fetchAbort = new AbortController();
  currentRequestKey = reqKey;

  try {
    const serverLyrics = normalizeLyricsPayload(await fetchLyricsFromServer(currentTrack.Id, fetchAbort.signal));
    if (reqKey !== currentRequestKey) return null;
    if (serverLyrics) {
      musicPlayerState.lyricsCache[currentTrack.Id] = serverLyrics;
      try { await musicDB.saveLyrics(currentTrack.Id, serverLyrics); } catch {}
      displayLyrics(serverLyrics);
      startLyricsSync();
      return serverLyrics;
    }
  } catch (e) {
  }
  try {
    const embedded = normalizeLyricsPayload(await getEmbeddedLyrics(currentTrack.Id));
    if (reqKey !== currentRequestKey) return null;
    if (embedded) {
      musicPlayerState.lyricsCache[currentTrack.Id] = embedded;
      try { await musicDB.saveLyrics(currentTrack.Id, embedded); } catch {}
      displayLyrics(embedded);
      startLyricsSync();
      return embedded;
    }
  } catch {
  }
  if (reqKey !== currentRequestKey) return null;
  setNoLyrics();
  return null;
}

export async function getEmbeddedLyrics(trackId) {
  try {
    const inMem = normalizeLyricsPayload(musicPlayerState.lyricsCache[trackId]);
    if (inMem) return inMem;

    cancelOngoingFetch();
    fetchAbort = new AbortController();

    const token = getAuthToken();
    const response = await fetch(apiUrl(`/Audio/${trackId}/stream.mp3?Static=true`), {
      headers: { "X-Emby-Token": token },
      signal: fetchAbort.signal
    });
    if (!response.ok) throw new Error("Stream alınamadı");

    const buffer = await response.arrayBuffer();
    const lyrics = normalizeLyricsPayload(await parseID3Tags(buffer));
    if (lyrics) musicPlayerState.lyricsCache[trackId] = lyrics;
    return lyrics || null;
  } catch (err) {
    return null;
  }
}

export function displayLyrics(data) {
  const normalized = normalizeLyricsPayload(data);
  if (!normalized) {
    setNoLyrics();
    return;
  }

  ensureSettingsUI();
  safeClear(contentContainer);

  musicPlayerState.lyricsContainer.scrollTop = 0;
  musicPlayerState.currentLyrics = [];
  musicPlayerState.syncedLyrics.lines = [];
  musicPlayerState.syncedLyrics.currentLine = -1;
  lastActiveIdx = -1;
  lastNextIdx = -1;

  if (typeof normalized === "object" && Array.isArray(normalized.Lyrics)) {
    renderStructuredLyrics(normalized.Lyrics, contentContainer);
  } else if (typeof normalized === "string") {
    if (normalized.includes("[")) {
      renderTimedTextLyrics(normalized, contentContainer);
    } else {
      renderPlainText(normalized, contentContainer);
    }
  }
}

function renderStructuredLyrics(lyricsArray, container) {
  const lines = [];
  const frag = document.createDocumentFragment();

  for (let i = 0; i < lyricsArray.length; i++) {
    const line = lyricsArray[i];
    const text = line.Text?.trim();
    if (!text) continue;

    const time = line.Start ? line.Start / 10000000 : null;

    const lineContainer = document.createElement("div");
    lineContainer.className = "lyrics-line-container";

    if (time != null) {
      const timeEl = document.createElement("span");
      timeEl.className = "lyrics-time";
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60).toString().padStart(2, "0");
      timeEl.textContent = `${m}:${s}`;
      lineContainer.appendChild(timeEl);
    }

    const textEl = document.createElement("div");
    textEl.className = "lyrics-text";
    textEl.textContent = text;
    lineContainer.appendChild(textEl);

    frag.appendChild(lineContainer);
    if (time != null) lines.push({ time, element: lineContainer });
  }

  container.appendChild(frag);
  musicPlayerState.currentLyrics = lines;
  musicPlayerState.syncedLyrics.lines = lines;
  musicPlayerState.syncedLyrics.currentLine = -1;
}

function renderTimedTextLyrics(text, container) {
  const lines = [];
  const frag = document.createDocumentFragment();
  const regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2}))?\](.*)$/;

  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const match = raw.match(regex);
    if (match) {
      const [, m, s, /*ms*/, content] = match;
      const time = parseInt(m, 10) * 60 + parseInt(s, 10);

      const lineContainer = document.createElement("div");
      lineContainer.className = "lyrics-line-container";

      const timeEl = document.createElement("span");
      timeEl.className = "lyrics-time";
      timeEl.textContent = `${m}:${s}`;
      lineContainer.appendChild(timeEl);

      const textEl = document.createElement("div");
      textEl.className = "lyrics-text";
      textEl.textContent = content.trim();
      lineContainer.appendChild(textEl);

      frag.appendChild(lineContainer);
      lines.push({ time, element: lineContainer });
    } else if (raw.trim()) {
      const lineContainer = document.createElement("div");
      lineContainer.className = "lyrics-line-container";
      const textEl = document.createElement("div");
      textEl.className = "lyrics-text";
      textEl.textContent = raw.trim();
      lineContainer.appendChild(textEl);
      frag.appendChild(lineContainer);
    }
  }

  container.appendChild(frag);
  musicPlayerState.currentLyrics = lines;
  musicPlayerState.syncedLyrics.lines = lines;
  musicPlayerState.syncedLyrics.currentLine = -1;
}

function renderPlainText(text, container) {
  const frag = document.createDocumentFragment();
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const lineContainer = document.createElement("div");
    lineContainer.className = "lyrics-line-container";
    const textEl = document.createElement("div");
    textEl.className = "lyrics-text";
    textEl.textContent = line;
    lineContainer.appendChild(textEl);
    frag.appendChild(lineContainer);
  }
  container.appendChild(frag);
}

export function toggleLyrics() {
  musicPlayerState.lyricsActive = !musicPlayerState.lyricsActive;
  const el = musicPlayerState.lyricsContainer;
  if (musicPlayerState.lyricsActive) {
    el.classList.add("lyrics-visible");
    el.classList.remove("lyrics-hidden");
    musicPlayerState.lyricsBtn.innerHTML = '<i class="fa-regular fa-closed-captioning"></i>';
    fetchLyrics();
  } else {
    el.classList.remove("lyrics-visible");
    el.classList.add("lyrics-hidden");
    musicPlayerState.lyricsBtn.innerHTML = '<i class="fa-regular fa-closed-captioning"></i>';
    stopLyricsSync();
    currentRequestKey = null;
    cancelOngoingFetch();
  }
}

export function showNoLyricsMessage() { setNoLyrics(); }
export function showLyricsError(msg) { setError(msg); }

export function updateSyncedLyrics(currentTime) {
  const playbackTime = typeof currentTime === "number"
    ? currentTime
    : (musicPlayerState.audio?.currentTime || 0);
  const lines = musicPlayerState.currentLyrics;
  if (!lines || lines.length === 0) return;

  const delay = parseFloat(localStorage.getItem("lyricsDelay")) || 0;
  const duration = parseFloat(localStorage.getItem("lyricsDuration")) || 5;
  const t = playbackTime + delay;

  if (t < lines[0].time) {
    setActiveLine(-1, 0);
    return;
  }

  let lo = 0, hi = lines.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }

  const lineStart = lines[idx].time;
  const lineEnd = lineStart + duration;

  if (t < lineEnd) {
    setActiveLine(idx, idx + 1 < lines.length ? idx + 1 : -1);
  } else if (idx + 1 < lines.length && t >= lines[idx + 1].time) {
    setActiveLine(idx + 1, idx + 2 < lines.length ? idx + 2 : -1);
  } else {
    setActiveLine(-1, idx + 1 < lines.length ? idx + 1 : -1);
  }
}

function setActiveLine(activeIdx, nextIdx) {
  if (activeIdx === lastActiveIdx && nextIdx === lastNextIdx) {
    return;
  }

  if (lastActiveIdx >= 0) {
    const prevEl = musicPlayerState.currentLyrics[lastActiveIdx]?.element;
    if (prevEl) {
      prevEl.classList.remove("lyrics-active");
      prevEl.querySelectorAll(".active").forEach(w => w.classList.remove("active"));
    }
  }
  if (lastNextIdx >= 0) {
    const prevNextEl = musicPlayerState.currentLyrics[lastNextIdx]?.element;
    if (prevNextEl) {
      prevNextEl.classList.remove("lyrics-next");
      const existingCheck = prevNextEl.querySelector(".next-check");
      if (existingCheck) existingCheck.remove();
    }
  }

  if (activeIdx >= 0) {
    const el = musicPlayerState.currentLyrics[activeIdx]?.element;
    if (el) {
      el.classList.add("lyrics-active");
      smoothScrollIntoView(el);
    }
  }

  if (nextIdx >= 0) {
    const nextEl = musicPlayerState.currentLyrics[nextIdx]?.element;
    if (nextEl) {
      nextEl.classList.add("lyrics-next");
      let nextup = nextEl.querySelector(".next-check");
      if (!nextup) {
        nextup = document.createElement("span");
        nextup.className = "next-check";
        nextup.innerHTML = '<i class="fas fa-arrow-right"></i>';
        nextEl.querySelector(".lyrics-text")?.prepend(nextup);
      }
    }
  }

  lastActiveIdx = activeIdx;
  lastNextIdx = nextIdx;
  musicPlayerState.syncedLyrics.currentLine = activeIdx;
}

function smoothScrollIntoView(element) {
  try {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    const parent = musicPlayerState.lyricsContainer;
    const containerHeight = parent.clientHeight;
    const elementRect = element.getBoundingClientRect();
    const containerRect = parent.getBoundingClientRect();
    const target = parent.scrollTop + elementRect.top - containerRect.top - (containerHeight / 2) + (elementRect.height / 2);
    parent.scrollTop = target;
  }
}

export function startLyricsSync() {
  if (musicPlayerState.audio && !audioEndedHandlerAttached) {
    const onEnded = () => {
      const container = musicPlayerState.lyricsContainer;
      if (container) container.scrollTop = 0;
      if (musicPlayerState.currentLyrics) {
        for (const line of musicPlayerState.currentLyrics) {
          const el = line.element;
          el.classList.remove("lyrics-active", "lyrics-next");
          el.querySelectorAll(".active").forEach(w => w.classList.remove("active"));
          const existingCheck = el.querySelector(".next-check");
          if (existingCheck) existingCheck.remove();
        }
      }
      lastActiveIdx = -1;
      lastNextIdx = -1;
    };
    musicPlayerState._lyricsOnEnded = onEnded;
    musicPlayerState.audio.addEventListener("ended", onEnded);
    audioEndedHandlerAttached = true;
  }
  updateSyncedLyrics(musicPlayerState.audio?.currentTime || 0);
}

export function stopLyricsSync() {
  if (audioEndedHandlerAttached && musicPlayerState.audio && musicPlayerState._lyricsOnEnded) {
    try {
      musicPlayerState.audio.removeEventListener("ended", musicPlayerState._lyricsOnEnded);
    } catch {}
    audioEndedHandlerAttached = false;
    musicPlayerState._lyricsOnEnded = null;
  }
}

async function updateSingleTrackLyrics(trackId) {
  if (String(trackId || "").startsWith("radio:")) {
    setNoLyrics(config.languageLabels.radioNoLyrics || "Canli radyo yayini icin sarki sozu yok");
    return false;
  }

  try {
    delete musicPlayerState.lyricsCache[trackId];
    await musicDB.deleteLyrics(trackId);
    const track = musicPlayerState.playlist.find(t => t.Id === trackId)
      || (musicPlayerState.currentTrack?.Id === trackId ? musicPlayerState.currentTrack : { Id: trackId });
    const lyrics = await fetchLyrics(track);

    if (hasLyricsPayload(lyrics)) {
      showNotification(
        `<i class="fas fa-closed-captioning"></i> ${config.languageLabels.syncSingle}`,
        2000,
        "db"
      );
      return true;
    }
  } catch (err) {
    console.error("Şarkı sözü güncelleme hatası:", err);
    showNotification(
      `<i class="fas fa-closed-captioning-slash"></i> ${config.languageLabels.syncSingleError}`,
      2000,
      "error"
    );
  }
  return false;
}
