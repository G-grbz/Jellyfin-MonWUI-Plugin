import { getConfig } from "./config.js";

export function isLocalStorageAvailable() {
  try {
    const testKey = "test";
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function updateConfig(updatedConfig) {
  const cfg = getConfig();

  if (cfg?.forceGlobalUserSettings && !cfg?.currentUserIsAdmin) {
    const allowedKeys = new Set([
      "playerTheme"
    ]);

    const onlyAllowed =
      Object.keys(updatedConfig || {}).every((key) => allowedKeys.has(key));

    if (!onlyAllowed) {
      console.warn("[JMSFusion] Global settings forced - update blocked (non-admin).");
      return;
    }
  }

  const existingDicebearParams = localStorage.getItem("dicebearParams");
  const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  Object.entries(updatedConfig || {}).forEach(([key, value]) => {
    if (key === "dicebearParams") return;

    try {
      if (typeof value === "boolean") {
        localStorage.setItem(key, value ? "true" : "false");
      } else if (typeof value === "number") {
        localStorage.setItem(key, String(value));
      } else if (Array.isArray(value)) {
        localStorage.setItem(key, JSON.stringify(value));
      } else if (isPlainObject(value)) {
        localStorage.setItem(key, JSON.stringify(value));
      } else if (value !== undefined && value !== null) {
        localStorage.setItem(key, String(value));
      } else {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn("Config yazılamadı:", key, err);
    }
  });

  if (existingDicebearParams) {
    localStorage.setItem("dicebearParams", existingDicebearParams);
  }

  if (updatedConfig?.defaultLanguage !== undefined) {
    localStorage.setItem("defaultLanguage", updatedConfig.defaultLanguage);
  }

  if (updatedConfig?.dateLocale !== undefined) {
    localStorage.setItem("dateLocale", updatedConfig.dateLocale);
  }

  if (!isLocalStorageAvailable()) return;

  const keysToSave = [
    "playerTheme",
    "playerStyle",
    "useAlbumArtAsBackground",
    "albumArtBackgroundBlur",
    "albumArtBackgroundOpacity",
    "buttonBackgroundBlur",
    "buttonBackgroundOpacity",
    "dotVisibleCount",
    "dotBackgroundBlur",
    "dotBackgroundOpacity",
    "nextTracksSource"
  ];

  keysToSave.forEach((key) => {
    const value = updatedConfig?.[key];
    if (value !== undefined && value !== null) {
      localStorage.setItem(key, String(value));
    }
  });
}
