const USER_SETTINGS_URL = "/Plugins/JMSFusion/UserSettings";
const SAVE_URL = "/Plugins/JMSFusion/UserSettings/Publish";
const SAVE_DEBOUNCE_MS = 500;

const EXPLICIT_KEYS = new Set([
  "jms:settingsTargetProfile",
  "settings.allowedTabs.v1",
  "lyricsMode",
  "lyricsOverwrite"
]);

const DENY_KEYS = new Set([
  "json-credentials",
  "api-key",
  "accessToken",
  "serverId",
  "userId",
  "deviceId",
  "sessionId",
  "jf_serverAddress",
  "jf_userId",
  "jf_api_deviceId",
  "persist_user_id",
  "persist_device_id",
  "persist_server_id",
  "serverAddress",
  "currentUserIsAdmin",
  "emby.device.id",
  "emby.session.id",
  "jellyfin_credentials",
  "emby_credentials"
]);

const DENY_PREFIXES = [
  "persist_",
  "jf:",
  "emby."
];

const managedKeys = new Set(EXPLICIT_KEYS);
const profile = detectProfile();

let forceGlobal = false;
let rev = 0;
let state = {};
let serverSnapshotEmpty = true;
let saveTimer = null;
let savePromise = null;
let suspendSync = false;
let bootstrappedLocal = false;
let snapshotLoaded = false;

const storage = window.localStorage;
const originalGetItem = storage.getItem.bind(storage);
const originalSetItem = storage.setItem.bind(storage);
const originalRemoveItem = storage.removeItem.bind(storage);
const originalClear = storage.clear.bind(storage);

function detectProfile() {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    const small = window.matchMedia?.("(max-width: 900px)")?.matches === true;
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return (coarse || (small && uaMobile)) ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

function isDeniedKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized) return true;
  if (DENY_KEYS.has(normalized)) return true;
  if (DENY_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  if (/token|credential|session/i.test(normalized)) return true;
  return false;
}

function registerKeys(keys = []) {
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || isDeniedKey(normalized)) continue;
    managedKeys.add(normalized);
    if (snapshotLoaded && !serverSnapshotEmpty && !Object.prototype.hasOwnProperty.call(state, normalized)) {
      suspendSync = true;
      try {
        originalRemoveItem(normalized);
      } finally {
        suspendSync = false;
      }
    }
  }
}

function shouldPersistKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized || isDeniedKey(normalized)) return false;
  return managedKeys.has(normalized);
}

function normalizeValueForStorage(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return String(value);
}

function normalizeSnapshot(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (isDeniedKey(key)) continue;
    const normalizedValue = normalizeValueForStorage(value);
    if (normalizedValue === null) continue;
    out[key] = normalizedValue;
  }
  return out;
}

function applySnapshotToStorage(snapshot) {
  registerKeys(Object.keys(snapshot || {}));
  suspendSync = true;
  try {
    for (const [key, value] of Object.entries(snapshot || {})) {
      if (!shouldPersistKey(key)) continue;
      originalSetItem(key, value);
    }
  } finally {
    suspendSync = false;
  }
}

function buildSnapshotFromStorage() {
  const out = {};
  for (const key of managedKeys) {
    if (!shouldPersistKey(key)) continue;
    const raw = originalGetItem(key);
    if (raw !== null) {
      out[key] = raw;
    }
  }
  return out;
}

async function persistSnapshot(snapshot) {
  const payload = normalizeSnapshot(snapshot);
  state = payload;
  serverSnapshotEmpty = Object.keys(payload).length === 0;

  savePromise = fetch(`${SAVE_URL}?profile=${encodeURIComponent(profile)}&ts=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      global: payload,
      profile
    })
  }).then(async response => {
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `UserSettings publish HTTP ${response.status}`);
    }
    return response.json().catch(() => ({}));
  }).then(result => {
    rev = Number(result?.rev || rev || 0);
    bridge.bootstrapOverride = { forceGlobal, global: payload, rev, profile };
    return result;
  }).catch(error => {
    console.warn("[JMSFusion] Managed storage persist failed:", error);
    throw error;
  }).finally(() => {
    savePromise = null;
  });

  return savePromise;
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistSnapshot(buildSnapshotFromStorage());
  }, SAVE_DEBOUNCE_MS);
}

function patchLocalStorage() {
  storage.setItem = function patchedSetItem(key, value) {
    const normalizedKey = String(key || "");
    const normalizedValue = String(value);
    originalSetItem(normalizedKey, normalizedValue);
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    state[normalizedKey] = normalizedValue;
    schedulePersist();
  };

  storage.removeItem = function patchedRemoveItem(key) {
    const normalizedKey = String(key || "");
    originalRemoveItem(normalizedKey);
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    delete state[normalizedKey];
    schedulePersist();
  };

  storage.clear = function patchedClear() {
    originalClear();
    if (suspendSync) return;
    let changed = false;
    for (const key of [...managedKeys]) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        delete state[key];
        changed = true;
      }
    }
    if (changed) schedulePersist();
  };
}

async function loadServerSnapshot() {
  try {
    const response = await fetch(`${USER_SETTINGS_URL}?profile=${encodeURIComponent(profile)}&ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`UserSettings HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    forceGlobal = payload?.forceGlobal === true;
    rev = Number(payload?.rev || 0);

    const snapshot = normalizeSnapshot(payload?.global || {});
    state = snapshot;
    serverSnapshotEmpty = Object.keys(snapshot).length === 0;
    applySnapshotToStorage(snapshot);
    bridge.bootstrapOverride = { forceGlobal, global: snapshot, rev, profile };
  } catch (error) {
    console.warn("[JMSFusion] Managed storage preload failed:", error);
    bridge.bootstrapOverride = { forceGlobal: false, global: {}, rev: 0, profile };
  } finally {
    snapshotLoaded = true;
  }
}

const bridge = {
  bootstrapOverride: { forceGlobal: false, global: {}, rev: 0, profile },
  registerKeys,
  maybeBootstrapFromLocal(snapshot) {
    if (!serverSnapshotEmpty || bootstrappedLocal) return;
    const normalized = normalizeSnapshot(snapshot);
    if (!Object.keys(normalized).length) return;
    bootstrappedLocal = true;
    registerKeys(Object.keys(normalized));
    state = normalized;
    schedulePersist();
  },
  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await persistSnapshot(buildSnapshotFromStorage());
  },
  get profile() {
    return profile;
  },
  get forceGlobal() {
    return forceGlobal;
  },
  get serverSnapshotEmpty() {
    return serverSnapshotEmpty;
  },
  get state() {
    return { ...state };
  }
};

window.__JMS_MANAGED_STORAGE__ = bridge;
patchLocalStorage();
await loadServerSnapshot();
