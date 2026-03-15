import { getConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { faIconHtml } from "./faIcons.js";

const STORAGE_KEY = "jms:subtitleCustomizer:v1";
const JF_APPEARANCE_KEY = "localplayersubtitleappearance3";
const JF_SUBTITLE_BURN_IN_KEY = "subtitleburnin";
const JF_SUBTITLE_RENDER_PGS_KEY = "subtitlerenderpgs";
const JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY = "alwaysBurnInSubtitleWhenTranscoding";
const STYLE_ID = "jms-subtitle-cue-style";
const BTN_CLASS = "btnJmsSubtitleCustomizer";
const DIALOG_ATTR = "data-jms-subtitle-dialog";
const DIALOG_ID = "jms-subtitle-dialog";
const FORCED_BURN_IN_VALUES = new Set(["all", "allcomplexformats", "onlyimageformats"]);

let playbackManagersCache = {
  at: 0,
  list: []
};
const patchedSubtitleAppearancePlayers = new Set();
const patchedSubtitleAppearanceMeta = new WeakMap();

const config = getConfig();
const labels =
  (typeof getLanguageLabels === "function"
    ? getLanguageLabels(config?.defaultLanguage || config?.language)
    : null) ||
  (config?.languageLabels?.[config?.language] ?? null) ||
  (config?.languageLabels?.tur ?? null) ||
  config?.languageLabels ||
  {};

function L(key, fallback) {
  const value = labels?.[key];
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

const DEFAULT_SETTINGS = Object.freeze({
  sizePercent: 110,
  color: "#ffffff",
  colorOpacity: 100,
  fontFamily: "default",
  dropShadow: "",
  shadowColor: "#000000",
  shadowOpacity: 100,
  shadowSize: 7,
  shadowDirection: 135,
  backgroundEnabled: false,
  backgroundColor: "#000000",
  backgroundOpacity: 100,
  backgroundRadiusPx: 6,
  delaySec: 0,
  position: "bottom"
});

const DEFAULT_FONT_STACK = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

const BASE_FONT_OPTIONS = Object.freeze([
  { value: "default", label: L("subtitleCustomizerFontDefault", "Varsayılan"), jellyfinFont: "" },
  { value: "Courier New,monospace", label: "Typewriter", jellyfinFont: "typewriter" },
  { value: "Georgia,Times New Roman,Arial,Helvetica,serif", label: "Print", jellyfinFont: "print" },
  { value: "Consolas,Lucida Console,Menlo,Monaco,monospace", label: "Console", jellyfinFont: "console" },
  { value: "Lucida Handwriting,Brush Script MT,Segoe Script,cursive", label: "Cursive", jellyfinFont: "cursive" },
  { value: "Gabriola,Segoe Print,Comic Sans MS,Chalkboard,sans-serif", label: "Casual", jellyfinFont: "casual" },
  { value: "Copperplate Gothic,Copperplate,sans-serif", label: "SmallCaps", jellyfinFont: "smallcaps" },
  { value: "Arial,sans-serif", label: "Arial", jellyfinFont: "" },
  { value: "Helvetica,Arial,sans-serif", label: "Helvetica", jellyfinFont: "" },
  { value: "Verdana,Geneva,sans-serif", label: "Verdana", jellyfinFont: "" },
  { value: "Tahoma,Geneva,sans-serif", label: "Tahoma", jellyfinFont: "" },
  { value: "Trebuchet MS,sans-serif", label: "Trebuchet MS", jellyfinFont: "" },
  { value: "Segoe UI,Arial,sans-serif", label: "Segoe UI", jellyfinFont: "" },
  { value: "Roboto,Helvetica,Arial,sans-serif", label: "Roboto", jellyfinFont: "" },
  { value: "Open Sans,Arial,sans-serif", label: "Open Sans", jellyfinFont: "" },
  { value: "Lato,Arial,sans-serif", label: "Lato", jellyfinFont: "" },
  { value: "Montserrat,Arial,sans-serif", label: "Montserrat", jellyfinFont: "" },
  { value: "Poppins,Arial,sans-serif", label: "Poppins", jellyfinFont: "" },
  { value: "Noto Sans,Arial,sans-serif", label: "Noto Sans", jellyfinFont: "" },
  { value: "Ubuntu,Arial,sans-serif", label: "Ubuntu", jellyfinFont: "" },
  { value: "Georgia,serif", label: "Georgia", jellyfinFont: "" },
  { value: "Times New Roman,Times,serif", label: "Times New Roman", jellyfinFont: "" },
  { value: "Palatino Linotype,Book Antiqua,Palatino,serif", label: "Palatino", jellyfinFont: "" },
  { value: "Garamond,serif", label: "Garamond", jellyfinFont: "" },
  { value: "Comic Sans MS,cursive,sans-serif", label: "Comic Sans", jellyfinFont: "" }
]);

const EXTRA_FONT_OPTIONS = Object.freeze([
  { value: "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif", label: "System UI", jellyfinFont: "" },
  { value: "SF Pro Display,SF Pro Text,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif", label: "SF Pro", jellyfinFont: "" },
  { value: "Avenir Next,Avenir,Segoe UI,Arial,sans-serif", label: "Avenir Next", jellyfinFont: "" },
  { value: "Avenir,Segoe UI,Arial,sans-serif", label: "Avenir", jellyfinFont: "" },
  { value: "Helvetica Neue,Helvetica,Arial,sans-serif", label: "Helvetica Neue", jellyfinFont: "" },
  { value: "Arial Narrow,Arial,sans-serif", label: "Arial Narrow", jellyfinFont: "" },
  { value: "Franklin Gothic Medium,Arial Narrow,Arial,sans-serif", label: "Franklin Gothic", jellyfinFont: "" },
  { value: "Gill Sans,Gill Sans MT,Calibri,Trebuchet MS,sans-serif", label: "Gill Sans", jellyfinFont: "" },
  { value: "Futura,Trebuchet MS,Arial,sans-serif", label: "Futura", jellyfinFont: "" },
  { value: "Optima,Segoe UI,Arial,sans-serif", label: "Optima", jellyfinFont: "" },
  { value: "Didot,Times New Roman,serif", label: "Didot", jellyfinFont: "" },
  { value: "Bodoni MT,Didot,Times New Roman,serif", label: "Bodoni MT", jellyfinFont: "" },
  { value: "Baskerville,Times New Roman,serif", label: "Baskerville", jellyfinFont: "" },
  { value: "Hoefler Text,Baskerville,Times New Roman,serif", label: "Hoefler Text", jellyfinFont: "" },
  { value: "Cambria,Georgia,serif", label: "Cambria", jellyfinFont: "" },
  { value: "Constantia,Georgia,serif", label: "Constantia", jellyfinFont: "" },
  { value: "Corbel,Arial,sans-serif", label: "Corbel", jellyfinFont: "" },
  { value: "Calibri,Arial,sans-serif", label: "Calibri", jellyfinFont: "" },
  { value: "Candara,Arial,sans-serif", label: "Candara", jellyfinFont: "" },
  { value: "Century Gothic,Futura,Arial,sans-serif", label: "Century Gothic", jellyfinFont: "" },
  { value: "Geneva,Verdana,sans-serif", label: "Geneva", jellyfinFont: "" },
  { value: "Lucida Sans,Lucida Grande,Segoe UI,Arial,sans-serif", label: "Lucida Sans", jellyfinFont: "" },
  { value: "Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif", label: "Inter", jellyfinFont: "" },
  { value: "Manrope,Segoe UI,Arial,sans-serif", label: "Manrope", jellyfinFont: "" },
  { value: "DM Sans,Segoe UI,Arial,sans-serif", label: "DM Sans", jellyfinFont: "" },
  { value: "Work Sans,Segoe UI,Arial,sans-serif", label: "Work Sans", jellyfinFont: "" },
  { value: "Nunito,Segoe UI,Arial,sans-serif", label: "Nunito", jellyfinFont: "" },
  { value: "PT Sans,Arial,sans-serif", label: "PT Sans", jellyfinFont: "" },
  { value: "Source Sans 3,Source Sans Pro,Segoe UI,Arial,sans-serif", label: "Source Sans", jellyfinFont: "" },
  { value: "IBM Plex Sans,Segoe UI,Arial,sans-serif", label: "IBM Plex Sans", jellyfinFont: "" },
  { value: "Merriweather,Georgia,serif", label: "Merriweather", jellyfinFont: "" },
  { value: "Playfair Display,Georgia,serif", label: "Playfair Display", jellyfinFont: "" },
  { value: "Bitter,Georgia,serif", label: "Bitter", jellyfinFont: "" },
  { value: "Arvo,Rockwell,Georgia,serif", label: "Arvo", jellyfinFont: "" },
  { value: "Alegreya,Georgia,serif", label: "Alegreya", jellyfinFont: "" },
  { value: "Cormorant Garamond,Garamond,Times New Roman,serif", label: "Cormorant Garamond", jellyfinFont: "" },
  { value: "Source Serif 4,Source Serif Pro,Georgia,serif", label: "Source Serif", jellyfinFont: "" },
  { value: "Noto Serif,Georgia,serif", label: "Noto Serif", jellyfinFont: "" },
  { value: "PT Serif,Georgia,serif", label: "PT Serif", jellyfinFont: "" },
  { value: "Rockwell,Georgia,serif", label: "Rockwell", jellyfinFont: "" },
  { value: "Clarendon,Georgia,serif", label: "Clarendon", jellyfinFont: "" },
  { value: "Inconsolata,Consolas,Menlo,Monaco,monospace", label: "Inconsolata", jellyfinFont: "" },
  { value: "Fira Sans,Segoe UI,Arial,sans-serif", label: "Fira Sans", jellyfinFont: "" },
  { value: "Fira Code,Consolas,Menlo,Monaco,monospace", label: "Fira Code", jellyfinFont: "" },
  { value: "JetBrains Mono,Consolas,Menlo,Monaco,monospace", label: "JetBrains Mono", jellyfinFont: "" },
  { value: "Cascadia Code,Consolas,Menlo,Monaco,monospace", label: "Cascadia Code", jellyfinFont: "" },
  { value: "Source Code Pro,Consolas,Menlo,Monaco,monospace", label: "Source Code Pro", jellyfinFont: "" },
  { value: "Menlo,Consolas,Monaco,monospace", label: "Menlo", jellyfinFont: "" },
  { value: "Monaco,Menlo,Consolas,monospace", label: "Monaco", jellyfinFont: "" },
  { value: "Andale Mono,Consolas,Menlo,Monaco,monospace", label: "Andale Mono", jellyfinFont: "" },
  { value: "Courier Prime,Courier New,monospace", label: "Courier Prime", jellyfinFont: "" },
  { value: "Ubuntu Mono,Consolas,Menlo,Monaco,monospace", label: "Ubuntu Mono", jellyfinFont: "" },
  { value: "IBM Plex Mono,Consolas,Menlo,Monaco,monospace", label: "IBM Plex Mono", jellyfinFont: "" },
  { value: "Cabin,Segoe UI,Arial,sans-serif", label: "Cabin", jellyfinFont: "" },
  { value: "Raleway,Segoe UI,Arial,sans-serif", label: "Raleway", jellyfinFont: "" },
  { value: "Oswald,Arial Narrow,Arial,sans-serif", label: "Oswald", jellyfinFont: "" },
  { value: "Bebas Neue,Impact,Arial Narrow,sans-serif", label: "Bebas Neue", jellyfinFont: "" },
  { value: "Quicksand,Segoe UI,Arial,sans-serif", label: "Quicksand", jellyfinFont: "" },
  { value: "Josefin Sans,Segoe UI,Arial,sans-serif", label: "Josefin Sans", jellyfinFont: "" },
  { value: "Exo 2,Segoe UI,Arial,sans-serif", label: "Exo 2", jellyfinFont: "" },
  { value: "Rubik,Segoe UI,Arial,sans-serif", label: "Rubik", jellyfinFont: "" },
  { value: "Segoe Print,Segoe Script,Comic Sans MS,cursive,sans-serif", label: "Segoe Print", jellyfinFont: "" },
  { value: "Bradley Hand,Segoe Print,Comic Sans MS,cursive", label: "Bradley Hand", jellyfinFont: "" },
  { value: "Chalkboard SE,Chalkboard,Comic Sans MS,cursive", label: "Chalkboard", jellyfinFont: "" },
  { value: "Marker Felt,Comic Sans MS,cursive", label: "Marker Felt", jellyfinFont: "" },
  { value: "Papyrus,Marker Felt,Comic Sans MS,fantasy", label: "Papyrus", jellyfinFont: "" }
]);

const SUBTITLE_BACKGROUND_PADDING = "0.04em 0.24em";
const PREVIEW_BACKGROUND_PADDING = "0.05em 0.3em";
const MIN_BACKGROUND_RADIUS_PX = 0;
const MAX_BACKGROUND_RADIUS_PX = 32;
const FONT_SIGNATURE_SAMPLES = Object.freeze([
  "Sphinx of black quartz, judge my vow 0123456789",
  "Il1 O0 mwMW @#%& [] {} ()",
  "The quick brown fox jumps over the lazy dog"
]);

let fontOptionsCache = null;
let fontAliasesCache = null;
let fontMeasureContextCache = null;

function getFontOptions() {
  if (fontOptionsCache) return fontOptionsCache;

  const out = [];
  const seen = new Set();
  const aliases = new Map();
  const signatureOwners = new Map();
  const measureContext = getFontMeasureContext();
  const add = (option) => {
    if (!option || typeof option !== "object") return;
    const value = String(option.value || "").trim();
    if (!value || seen.has(value)) return;
    if (value !== DEFAULT_SETTINGS.fontFamily && measureContext) {
      const signature = getFontRenderSignature(value, measureContext);
      const existingValue = signatureOwners.get(signature);
      if (existingValue) {
        aliases.set(value, existingValue);
        return;
      }
      signatureOwners.set(signature, value);
    }
    seen.add(value);
    out.push(option);
  };

  BASE_FONT_OPTIONS.forEach(add);
  EXTRA_FONT_OPTIONS.forEach(add);

  fontAliasesCache = aliases;
  fontOptionsCache = Object.freeze(out.length ? out : BASE_FONT_OPTIONS.slice());
  return fontOptionsCache;
}

function getFontMeasureContext() {
  if (fontMeasureContextCache) return fontMeasureContextCache;
  if (typeof document === "undefined") return null;

  try {
    const canvas = document.createElement("canvas");
    fontMeasureContextCache = canvas.getContext("2d");
  } catch {
    fontMeasureContextCache = null;
  }

  return fontMeasureContextCache;
}

function getFontRenderSignature(fontStack, context) {
  if (!context) return String(fontStack || "").trim();

  const safeFontStack = formatFontStack(fontStack);
  if (!safeFontStack) return "";

  const parts = [];
  FONT_SIGNATURE_SAMPLES.forEach((sample) => {
    try {
      context.font = `72px ${safeFontStack}`;
      const metrics = context.measureText(sample);
      parts.push((Math.round(metrics.width * 100) / 100).toFixed(2));
      if (Number.isFinite(metrics.actualBoundingBoxAscent)) {
        parts.push((Math.round(metrics.actualBoundingBoxAscent * 100) / 100).toFixed(2));
      }
      if (Number.isFinite(metrics.actualBoundingBoxDescent)) {
        parts.push((Math.round(metrics.actualBoundingBoxDescent * 100) / 100).toFixed(2));
      }
    } catch {
      parts.push(sample.length.toString());
    }
  });

  return parts.join("|");
}

function normalizeFontFamilySelection(value, fallback = DEFAULT_SETTINGS.fontFamily) {
  const fontOptions = getFontOptions();
  const aliases = fontAliasesCache || new Map();
  const selected = String(value || "").trim();
  const canonical = aliases.get(selected) || selected;
  const fallbackValue = String(fallback || DEFAULT_SETTINGS.fontFamily).trim();
  const canonicalFallback = aliases.get(fallbackValue) || fallbackValue || DEFAULT_SETTINGS.fontFamily;
  return fontOptions.some((opt) => opt.value === canonical)
    ? canonical
    : (fontOptions.some((opt) => opt.value === canonicalFallback)
        ? canonicalFallback
        : DEFAULT_SETTINGS.fontFamily);
}

function formatFontFamilyToken(token) {
  const family = String(token || "").trim();
  if (!family) return "";
  if (/^["'].*["']$/.test(family)) return family;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i.test(family)) {
    return family;
  }
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatFontStack(fontStack) {
  return String(fontStack || "")
    .split(",")
    .map((part) => formatFontFamilyToken(part))
    .filter(Boolean)
    .join(",");
}

const SHADOW_OPTIONS = Object.freeze([
  { value: "", label: L("subtitleCustomizerShadowDefault", "Varsayılan") },
  { value: "none", label: L("subtitleCustomizerShadowNone", "Yok") },
  { value: "uniform", label: L("subtitleCustomizerShadowUniform", "Uniform") },
  { value: "raised", label: L("subtitleCustomizerShadowRaised", "Kabartmalı") },
  { value: "depressed", label: L("subtitleCustomizerShadowDepressed", "Çökük") }
]);

const POSITION_VALUES = Object.freeze(["bottom", "center", "top"]);

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function normalizeHexColor(raw, fallback) {
  const val = String(raw || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(val)) return val;
  if (/^#[0-9a-f]{3}$/.test(val)) {
    return `#${val[1]}${val[1]}${val[2]}${val[2]}${val[3]}${val[3]}`;
  }
  return fallback;
}

function normalizeColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.color);
}

function normalizeOpacity(raw, fallback = 100) {
  return Math.round(clampNumber(raw, 0, 100, fallback));
}

function normalizeColorOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.colorOpacity);
}

function normalizeShadowColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.shadowColor);
}

function normalizeShadowOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.shadowOpacity);
}

function normalizeBackgroundColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.backgroundColor);
}

function normalizeBackgroundOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.backgroundOpacity);
}

function normalizeBackgroundEnabled(raw) {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

function normalizeBackgroundRadius(raw) {
  return Math.round(
    clampNumber(raw, MIN_BACKGROUND_RADIUS_PX, MAX_BACKGROUND_RADIUS_PX, DEFAULT_SETTINGS.backgroundRadiusPx)
  );
}

function getBackgroundRadiusCssValue(settings) {
  return `${normalizeBackgroundRadius(settings?.backgroundRadiusPx)}px`;
}

function formatDelayValue(delaySec) {
  const normalized =
    Math.round(clampNumber(delaySec, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
  return `${normalized.toFixed(1)}s`;
}

function normalizeDropShadow(raw) {
  const val = String(raw || "").trim().toLowerCase();
  return SHADOW_OPTIONS.some((item) => item.value === val) ? val : DEFAULT_SETTINGS.dropShadow;
}

function normalizeShadowSize(raw) {
  return Math.round(clampNumber(raw, 0, 24, DEFAULT_SETTINGS.shadowSize));
}

function normalizeShadowDirection(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.shadowDirection;
  const normalized = ((Math.round(n) % 360) + 360) % 360;
  return normalized;
}

function parseCssColorValue(raw, fallbackHex, fallbackOpacity = 100) {
  const safeFallbackHex = normalizeHexColor(fallbackHex, DEFAULT_SETTINGS.color);
  const safeFallbackOpacity = normalizeOpacity(fallbackOpacity, 100);
  const val = String(raw || "").trim().toLowerCase();

  if (!val) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  if (val === "transparent" || val === "none") return null;

  if (/^#[0-9a-f]{8}$/.test(val)) {
    return {
      hex: `#${val.slice(1, 7)}`,
      opacity: normalizeOpacity((parseInt(val.slice(7, 9), 16) / 255) * 100, 100)
    };
  }

  if (/^#[0-9a-f]{4}$/.test(val)) {
    return {
      hex: `#${val[1]}${val[1]}${val[2]}${val[2]}${val[3]}${val[3]}`,
      opacity: normalizeOpacity((parseInt(`${val[4]}${val[4]}`, 16) / 255) * 100, 100)
    };
  }

  const normalizedHex = normalizeHexColor(val, "");
  if (normalizedHex) {
    return {
      hex: normalizedHex,
      opacity: 100
    };
  }

  const match = val.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  const body = match[1].trim();
  let parts = [];
  let alphaPart = "";
  if (body.includes(",")) {
    const pieces = body.split(",").map((v) => v.trim()).filter(Boolean);
    parts = pieces.slice(0, 3);
    alphaPart = pieces[3] || "";
  } else {
    const [rgbPart, alphaRaw = ""] = body.split("/").map((v) => v.trim());
    parts = String(rgbPart || "").split(/\s+/).filter(Boolean).slice(0, 3);
    alphaPart = alphaRaw;
  }

  if (parts.length < 3) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  const rgb = [];
  for (let i = 0; i < 3; i++) {
    const n = Number(parts[i].replace("%", ""));
    if (!Number.isFinite(n)) {
      return {
        hex: safeFallbackHex,
        opacity: safeFallbackOpacity
      };
    }
    const normalized = parts[i].includes("%")
      ? Math.round((n / 100) * 255)
      : Math.round(n);
    rgb.push(Math.max(0, Math.min(255, normalized)));
  }

  let opacity = 100;
  if (alphaPart) {
    const alphaValue = alphaPart.includes("%")
      ? Number(alphaPart.replace("%", "")) / 100
      : Number(alphaPart);
    if (Number.isFinite(alphaValue)) {
      opacity = normalizeOpacity(alphaValue * 100, 100);
    }
  }

  return {
    hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    opacity
  };
}

function parseBackgroundFromJellyfin(raw) {
  const parsed = parseCssColorValue(
    raw,
    DEFAULT_SETTINGS.backgroundColor,
    DEFAULT_SETTINGS.backgroundOpacity
  );
  if (!parsed) {
    return {
      backgroundEnabled: false,
      backgroundColor: DEFAULT_SETTINGS.backgroundColor,
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity
    };
  }
  return {
    backgroundEnabled: true,
    backgroundColor: normalizeBackgroundColor(parsed.hex),
    backgroundOpacity: normalizeBackgroundOpacity(parsed.opacity)
  };
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getFontOptionByValue(value) {
  const selected = normalizeFontFamilySelection(value);
  const fontOptions = getFontOptions();
  return fontOptions.find((opt) => opt.value === selected) || fontOptions[0];
}

function getCurrentUserIdCandidates() {
  const ids = [];
  const add = (value) => {
    const val = String(value || "").trim();
    if (!val || ids.includes(val)) return;
    ids.push(val);
  };

  try {
    add(window.ApiClient?.getCurrentUserId?.());
  } catch {}

  try {
    add(window.MediaBrowser?.ApiClient?.getCurrentUserId?.());
  } catch {}

  try {
    add(window.MediaBrowser?.ApiClient?._currentUser?.Id);
  } catch {}

  return ids;
}

function getPreferredAppearanceKeys() {
  const keys = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  const userIds = getCurrentUserIdCandidates();
  userIds.forEach((userId) => add(`${userId}-${JF_APPEARANCE_KEY}`));

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (typeof key === "string" && key.endsWith(`-${JF_APPEARANCE_KEY}`)) {
        add(key);
      }
    }
  } catch {}

  add(JF_APPEARANCE_KEY);
  return keys;
}

function getDefaultSettingsFromJellyfin() {
  const { data: jf } = loadJellyfinAppearance();
  const text = parseCssColorValue(jf.textColor, DEFAULT_SETTINGS.color, DEFAULT_SETTINGS.colorOpacity);
  const bg = parseBackgroundFromJellyfin(jf.textBackground);
  return {
    sizePercent: jellyfinTextSizeToPercent(jf.textSize),
    color: normalizeColor(text?.hex || DEFAULT_SETTINGS.color),
    colorOpacity: normalizeColorOpacity(text?.opacity ?? DEFAULT_SETTINGS.colorOpacity),
    fontFamily: jellyfinFontToFamily(jf.font),
    dropShadow: normalizeDropShadow(jf.dropShadow),
    shadowColor: DEFAULT_SETTINGS.shadowColor,
    shadowOpacity: DEFAULT_SETTINGS.shadowOpacity,
    shadowSize: DEFAULT_SETTINGS.shadowSize,
    shadowDirection: DEFAULT_SETTINGS.shadowDirection,
    backgroundEnabled: bg.backgroundEnabled,
    backgroundColor: bg.backgroundColor,
    backgroundOpacity: bg.backgroundOpacity,
    backgroundRadiusPx: DEFAULT_SETTINGS.backgroundRadiusPx,
    position: jellyfinVerticalToPosition(jf.verticalPosition)
  };
}

function loadSettings() {
  const fallback = getDefaultSettingsFromJellyfin();

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const selectedFont = normalizeFontFamilySelection(parsed.fontFamily, fallback.fontFamily);
    const dropShadow = normalizeDropShadow(parsed.dropShadow || fallback.dropShadow);
    const colorOpacity = normalizeColorOpacity(parsed.colorOpacity ?? fallback.colorOpacity);
    const shadowColor = normalizeShadowColor(parsed.shadowColor || fallback.shadowColor);
    const shadowOpacity = normalizeShadowOpacity(parsed.shadowOpacity ?? fallback.shadowOpacity);
    const shadowSize = normalizeShadowSize(parsed.shadowSize ?? fallback.shadowSize);
    const shadowDirection = normalizeShadowDirection(parsed.shadowDirection ?? fallback.shadowDirection);
    const backgroundEnabled = normalizeBackgroundEnabled(
      parsed.backgroundEnabled ?? fallback.backgroundEnabled
    );
    const backgroundColor = normalizeBackgroundColor(parsed.backgroundColor || fallback.backgroundColor);
    const backgroundOpacity = normalizeBackgroundOpacity(
      parsed.backgroundOpacity ?? fallback.backgroundOpacity
    );
    const backgroundRadiusPx = normalizeBackgroundRadius(
      parsed.backgroundRadiusPx ?? fallback.backgroundRadiusPx
    );

    return {
      sizePercent: Math.round(clampNumber(parsed.sizePercent, 60, 220, fallback.sizePercent || DEFAULT_SETTINGS.sizePercent)),
      color: normalizeColor(parsed.color || fallback.color),
      colorOpacity,
      fontFamily: selectedFont,
      dropShadow,
      shadowColor,
      shadowOpacity,
      shadowSize,
      shadowDirection,
      backgroundEnabled,
      backgroundColor,
      backgroundOpacity,
      backgroundRadiusPx,
      delaySec: DEFAULT_SETTINGS.delaySec,
      position: fallback.position
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      ...fallback
    };
  }
}

function getPersistentSettingsPayload(settings) {
  return {
    sizePercent: Math.round(clampNumber(settings?.sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent)),
    color: normalizeColor(settings?.color || DEFAULT_SETTINGS.color),
    colorOpacity: normalizeColorOpacity(settings?.colorOpacity),
    fontFamily: normalizeFontFamilySelection(settings?.fontFamily, DEFAULT_SETTINGS.fontFamily),
    dropShadow: normalizeDropShadow(settings?.dropShadow),
    shadowColor: normalizeShadowColor(settings?.shadowColor),
    shadowOpacity: normalizeShadowOpacity(settings?.shadowOpacity),
    shadowSize: normalizeShadowSize(settings?.shadowSize),
    shadowDirection: normalizeShadowDirection(settings?.shadowDirection),
    backgroundEnabled: normalizeBackgroundEnabled(settings?.backgroundEnabled),
    backgroundColor: normalizeBackgroundColor(settings?.backgroundColor),
    backgroundOpacity: normalizeBackgroundOpacity(settings?.backgroundOpacity),
    backgroundRadiusPx: normalizeBackgroundRadius(settings?.backgroundRadiusPx)
  };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistentSettingsPayload(settings)));
  } catch {}
}

function setLocalStorageIfChanged(key, value) {
  try {
    const next = String(value);
    if (localStorage.getItem(key) !== next) {
      localStorage.setItem(key, next);
      return true;
    }
  } catch {}
  return false;
}

function ensureClientSubtitleRenderingPreferences() {
  let changed = false;

  changed = setLocalStorageIfChanged(JF_SUBTITLE_RENDER_PGS_KEY, "true") || changed;

  try {
    const burnIn = String(localStorage.getItem(JF_SUBTITLE_BURN_IN_KEY) || "")
      .trim()
      .toLowerCase();
    if (FORCED_BURN_IN_VALUES.has(burnIn)) {
      changed = setLocalStorageIfChanged(JF_SUBTITLE_BURN_IN_KEY, "") || changed;
    }
  } catch {}

  try {
    const alwaysBurn = String(localStorage.getItem(JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY) || "")
      .trim()
      .toLowerCase();
    if (alwaysBurn === "true" || alwaysBurn === "1") {
      changed = setLocalStorageIfChanged(JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY, "false") || changed;
    }
  } catch {}

  return changed;
}

function loadJellyfinAppearance() {
  const keys = getPreferredAppearanceKeys();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { data: parsed, key };
      }
    } catch {}
  }
  return { data: {}, key: keys[0] || JF_APPEARANCE_KEY };
}

function jellyfinTextSizeToPercent(textSize) {
  switch (String(textSize || "")) {
    case "smaller":
      return 80;
    case "small":
      return 95;
    case "large":
      return 145;
    case "larger":
      return 175;
    case "extralarge":
      return 205;
    default:
      return DEFAULT_SETTINGS.sizePercent;
  }
}

function percentToJellyfinTextSize(sizePercent) {
  const n = clampNumber(sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent);
  if (n <= 82) return "smaller";
  if (n <= 102) return "small";
  if (n <= 130) return "";
  if (n <= 160) return "large";
  if (n <= 190) return "larger";
  return "extralarge";
}

function jellyfinVerticalToPosition(verticalPosition) {
  const n = parseInt(verticalPosition, 10);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.position;
  if (n <= -2) return "bottom";
  if (n >= 2) return "top";
  return "center";
}

function positionToJellyfinVertical(position) {
  if (position === "top") return 3;
  if (position === "center") return 0;
  return -3;
}

function jellyfinFontToFamily(fontToken) {
  const token = String(fontToken || "").toLowerCase();
  if (!token) return DEFAULT_SETTINGS.fontFamily;
  const hit = getFontOptions().find((opt) => opt.jellyfinFont === token);
  return hit ? hit.value : DEFAULT_SETTINGS.fontFamily;
}

function resolveFontStack(settings) {
  if (!settings || settings.fontFamily === "default") {
    return DEFAULT_FONT_STACK;
  }
  return formatFontStack(settings.fontFamily);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, DEFAULT_SETTINGS.shadowColor);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

function mixHex(colorA, colorB, ratio) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = Math.max(0, Math.min(1, Number(ratio)));
  const c = {
    r: Math.round(a.r * (1 - r) + b.r * r),
    g: Math.round(a.g * (1 - r) + b.g * r),
    b: Math.round(a.b * (1 - r) + b.b * r)
  };
  return `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`;
}

function opacityPercentToAlpha(raw, fallback = 100) {
  return Math.round((normalizeOpacity(raw, fallback) / 100) * 1000) / 1000;
}

function getCssColorValue(raw, opacity, fallbackHex) {
  const normalizedFallback = normalizeHexColor(fallbackHex, DEFAULT_SETTINGS.color);
  const normalizedHex = normalizeHexColor(raw, normalizedFallback);
  const alpha = opacityPercentToAlpha(opacity, 100);
  if (alpha >= 1) return normalizedHex;
  const { r, g, b } = hexToRgb(normalizedHex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTextColorValue(settings) {
  return getCssColorValue(settings?.color, settings?.colorOpacity, DEFAULT_SETTINGS.color);
}

function getBackgroundColorValue(settings) {
  return settings?.backgroundEnabled
    ? getCssColorValue(
      settings?.backgroundColor,
      settings?.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundColor
    )
    : "transparent";
}

function formatPx(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0px";
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}px`;
}

function getShadowVector(sizePx, directionDeg) {
  const size = normalizeShadowSize(sizePx);
  const dir = normalizeShadowDirection(directionDeg);
  const rad = (dir * Math.PI) / 180;
  const distance = size * 0.42;
  const blur = size;
  return {
    size,
    x: Math.cos(rad) * distance,
    y: Math.sin(rad) * distance,
    blur
  };
}

function getTextShadowValue(dropShadow, shadowColor, shadowSize, shadowDirection, shadowOpacity) {
  const base = normalizeShadowColor(shadowColor);
  const light = mixHex(base, "#ffffff", 0.58);
  const dark = mixHex(base, "#000000", 0.42);
  const vector = getShadowVector(shadowSize, shadowDirection);
  const shadowAlpha = opacityPercentToAlpha(shadowOpacity, DEFAULT_SETTINGS.shadowOpacity);
  const baseColor = getCssColorValue(base, shadowOpacity, DEFAULT_SETTINGS.shadowColor);
  const lightColor = getCssColorValue(light, shadowOpacity, light);
  const darkColor = getCssColorValue(dark, shadowOpacity, dark);
  const mainX = formatPx(vector.x);
  const mainY = formatPx(vector.y);
  const invX = formatPx(-vector.x);
  const invY = formatPx(-vector.y);
  const mainBlur = formatPx(vector.blur);
  const subtleBlur = formatPx(Math.max(0, vector.blur * 0.16));

  if (vector.size <= 0 || shadowAlpha <= 0) {
    return "none";
  }

  switch (normalizeDropShadow(dropShadow)) {
    case "raised":
      return `${invX} ${invY} ${subtleBlur} ${lightColor}, ${mainX} ${mainY} ${subtleBlur} ${darkColor}`;
    case "depressed":
      return `${mainX} ${mainY} ${subtleBlur} ${lightColor}, ${invX} ${invY} ${subtleBlur} ${darkColor}`;
    case "uniform": {
      const r = Math.max(0.8, vector.size * 0.34);
      const ring = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]
      ].map(([dx, dy]) => `${formatPx(dx * r)} ${formatPx(dy * r)} ${formatPx(Math.max(0, vector.blur * 0.12))} ${baseColor}`);
      ring.push(`${mainX} ${mainY} ${formatPx(Math.max(0, vector.blur * 0.55))} ${baseColor}`);
      return ring.join(", ");
    }
    case "none":
      return "none";
    default:
      return `${mainX} ${mainY} ${mainBlur} ${baseColor}`;
  }
}

function saveJellyfinAppearance(settings, options = null) {
  const appearanceEntry = loadJellyfinAppearance();
  const current = appearanceEntry.data || {};
  const selectedFont = getFontOptionByValue(settings.fontFamily);
  const currentStyling = String(current.subtitleStyling || "").toLowerCase();
  const suppressComplexTextSize = options?.suppressComplexTextSize === true;
  const textColor = getTextColorValue(settings);
  const textBackground = getBackgroundColorValue(settings);
  const next = {
    ...current,
    subtitleStyling: currentStyling === "native" ? "Custom" : (current.subtitleStyling || "Custom"),
    textSize: suppressComplexTextSize ? "" : percentToJellyfinTextSize(settings.sizePercent),
    textWeight: current.textWeight || "normal",
    dropShadow: normalizeDropShadow(settings.dropShadow),
    font: selectedFont.jellyfinFont || "",
    textBackground,
    textColor
  };

  const keys = getPreferredAppearanceKeys();
  const primaryKey = appearanceEntry.key || keys[0] || JF_APPEARANCE_KEY;
  if (!keys.includes(primaryKey)) {
    keys.unshift(primaryKey);
  }

  const nextSerialized = JSON.stringify(next);
  keys.forEach((key) => {
    try {
      const currentSerialized = localStorage.getItem(key) || "";
      if (nextSerialized !== currentSerialized) {
        localStorage.setItem(key, nextSerialized);
      }
    } catch {}
  });
}

function ensureCueStyleElement() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  return style;
}

function applyCueCss(settings) {
  const fontStack = resolveFontStack(settings);
  const textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  const textColor = getTextColorValue(settings);
  const textBackground = getBackgroundColorValue(settings);
  const style = ensureCueStyleElement();
  const lines = [];

  lines.push("html body .videoPlayerContainer video.htmlvideoplayer::cue, html body .videoPlayerContainer .htmlvideoplayer::cue, html body video::cue {");
  lines.push(`  color: ${textColor} !important;`);
  lines.push(`  font-size: ${settings.sizePercent}% !important;`);
  lines.push(`  font-family: ${fontStack} !important;`);
  lines.push(`  text-shadow: ${textShadow} !important;`);
  lines.push(`  background-color: ${textBackground} !important;`);
  lines.push("}");

  lines.push(".videoSubtitlesInner, .videoSecondarySubtitlesInner {");
  lines.push(`  color: ${textColor} !important;`);
  lines.push(`  font-size: ${settings.sizePercent}% !important;`);
  lines.push(`  font-family: ${fontStack} !important;`);
  lines.push(`  text-shadow: ${textShadow} !important;`);
  lines.push(`  background-color: ${textBackground} !important;`);
  lines.push("  line-height: 1.3 !important;");
  lines.push("  text-align: center;");
  lines.push("}");

  lines.push(".videoSubtitles {");
  lines.push("  width: 100% !important;");
  lines.push("  left: 0 !important;");
  lines.push("  right: 0 !important;");
  lines.push("  pointer-events: none !important;");
  lines.push("}");

  style.textContent = lines.join("\n");
  try {
    (document.head || document.documentElement).appendChild(style);
  } catch {}
}

function patchExistingCueStyles(settings) {
  const fontStack = resolveFontStack(settings);
  const textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  const textColor = getTextColorValue(settings);
  const textBackground = getBackgroundColorValue(settings);
  const css = [
    ".htmlvideoplayer::cue, video::cue {",
    `  color: ${textColor} !important;`,
    `  font-size: ${settings.sizePercent}% !important;`,
    `  font-family: ${fontStack} !important;`,
    `  text-shadow: ${textShadow} !important;`,
    `  background-color: ${textBackground} !important;`,
    "}"
  ].join("\n");

  document.querySelectorAll("style[id$='-cuestyle']").forEach((styleNode) => {
    if (!(styleNode instanceof HTMLStyleElement)) return;
    styleNode.textContent = css;
  });
}

function getLiveSubtitleCustomizerSettings(fallback = null) {
  try {
    const live = window.__jmsSubtitleCustomizerState?.settings;
    if (live && typeof live === "object") {
      return {
        ...DEFAULT_SETTINGS,
        ...live
      };
    }
  } catch {}

  if (fallback && typeof fallback === "object") {
    return {
      ...DEFAULT_SETTINGS,
      ...fallback
    };
  }

  return loadSettings();
}

function applySubtitleContainerStyles(container, settings) {
  if (!(container instanceof HTMLElement)) return;

  container.style.width = "100%";
  container.style.left = "0";
  container.style.right = "0";
  container.style.pointerEvents = "none";

  if (settings.position === "top") {
    container.style.top = "0";
    container.style.bottom = "";
    container.style.transform = "";
  } else if (settings.position === "center") {
    container.style.top = "50%";
    container.style.bottom = "";
    container.style.transform = "translateY(-50%)";
  } else {
    container.style.top = "";
    container.style.bottom = "0";
    container.style.transform = "";
  }
}

function applySubtitleTextStyles(subtitleText, settings) {
  if (!(subtitleText instanceof HTMLElement)) return;

  const fontStack = resolveFontStack(settings);
  const textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  const textColor = getTextColorValue(settings);
  const textBackground = getBackgroundColorValue(settings);
  const backgroundRadius = getBackgroundRadiusCssValue(settings);

  subtitleText.style.color = textColor;
  subtitleText.style.fontSize = `${settings.sizePercent}%`;
  subtitleText.style.fontFamily = fontStack;
  subtitleText.style.textShadow = textShadow;
  subtitleText.style.backgroundColor = textBackground;
  subtitleText.style.padding = settings.backgroundEnabled ? SUBTITLE_BACKGROUND_PADDING : "0";
  subtitleText.style.borderRadius = settings.backgroundEnabled ? backgroundRadius : "0";
  subtitleText.style.display = settings.backgroundEnabled ? "inline-block" : "";
  subtitleText.style.lineHeight = "1.3";
  subtitleText.style.textAlign = "center";

  if (settings.position === "top") {
    subtitleText.style.marginTop = "1.2em";
    subtitleText.style.marginBottom = "0";
  } else if (settings.position === "center") {
    subtitleText.style.marginTop = "0";
    subtitleText.style.marginBottom = "0";
  } else {
    subtitleText.style.marginTop = "0";
    subtitleText.style.marginBottom = "1.2em";
  }
}

function applySubtitleAppearancePair(windowEl, textEl, settings) {
  const resolved = getLiveSubtitleCustomizerSettings(settings);
  applySubtitleContainerStyles(windowEl, resolved);
  applySubtitleTextStyles(textEl, resolved);
}

function applyOverlayStyles(settings) {
  const containers = document.querySelectorAll(".videoSubtitles");
  containers.forEach((container) => {
    applySubtitleContainerStyles(container, settings);
  });

  const subtitles = document.querySelectorAll(".videoSubtitlesInner, .videoSecondarySubtitlesInner");
  subtitles.forEach((subtitleText) => {
    applySubtitleTextStyles(subtitleText, settings);
  });
}

function patchPlayerSubtitleAppearance(player, settings = null) {
  if (!player || typeof player !== "object") return false;
  if (patchedSubtitleAppearancePlayers.has(player)) return true;
  if (typeof player.setSubtitleAppearance !== "function") return false;

  const original = player.setSubtitleAppearance;
  if (typeof original !== "function") return false;

  const wrapped = function patchedSetSubtitleAppearance(windowEl, textEl, ...args) {
    let result;
    try {
      result = original.call(this, windowEl, textEl, ...args);
    } finally {
      try {
        applySubtitleAppearancePair(windowEl, textEl, settings);
      } catch {}
    }
    return result;
  };

  try {
    player.setSubtitleAppearance = wrapped;
    patchedSubtitleAppearancePlayers.add(player);
    patchedSubtitleAppearanceMeta.set(player, { original, wrapped });
    return true;
  } catch {
    return false;
  }
}

function unpatchAllPlayerSubtitleAppearance() {
  patchedSubtitleAppearancePlayers.forEach((player) => {
    const meta = patchedSubtitleAppearanceMeta.get(player);
    if (!meta) return;
    try {
      if (player.setSubtitleAppearance === meta.wrapped) {
        player.setSubtitleAppearance = meta.original;
      }
    } catch {}
    patchedSubtitleAppearanceMeta.delete(player);
  });
  patchedSubtitleAppearancePlayers.clear();
}

function getComplexSubtitleScale(sizePercent) {
  const normalized = clampNumber(sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent);
  const scale = normalized / DEFAULT_SETTINGS.sizePercent;
  return Math.max(0.55, Math.min(2.2, Math.round(scale * 1000) / 1000));
}

function getComplexSubtitleShiftPercent(position) {
  if (position === "top") return -36;
  if (position === "center") return -18;
  return 0;
}

function getComplexSubtitleTransformOrigin(position) {
  if (position === "top") return "center top";
  if (position === "center") return "center center";
  return "center bottom";
}

function normalizeTransformString(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized === "none") return "";
  return normalized;
}

function isLegacyComplexSubtitleTransform(value) {
  const normalized = normalizeTransformString(value);
  if (!normalized) return false;
  return /^(?:translateY\([^)]+\)\s*)?(?:scale\([^)]+\))?$/.test(normalized);
}

function supportsIndependentTransformProperties() {
  try {
    return (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("scale", "1") &&
      CSS.supports("translate", "0 0")
    );
  } catch {
    return false;
  }
}

function applyComplexSubtitleTransformFallback(node, extraTransform) {
  const currentTransform = normalizeTransformString(node.style.getPropertyValue("transform"));
  const lastComposite = normalizeTransformString(node.dataset.jmsSubtitleComplexComposite);
  const lastBase = normalizeTransformString(node.dataset.jmsSubtitleComplexBase);

  let baseTransform = lastBase;
  if (currentTransform && currentTransform !== lastComposite && !isLegacyComplexSubtitleTransform(currentTransform)) {
    baseTransform = currentTransform;
  }

  const nextTransform = [baseTransform, normalizeTransformString(extraTransform)]
    .filter(Boolean)
    .join(" ");

  if (baseTransform) node.dataset.jmsSubtitleComplexBase = baseTransform;
  else delete node.dataset.jmsSubtitleComplexBase;

  if (nextTransform) {
    node.style.setProperty("transform", nextTransform, "important");
    node.dataset.jmsSubtitleComplexComposite = nextTransform;
  } else {
    node.style.removeProperty("transform");
    delete node.dataset.jmsSubtitleComplexComposite;
  }
}

function collectComplexSubtitleNodes() {
  const assParents = Array.from(
    document.querySelectorAll(".videoPlayerContainer .libassjs-canvas-parent")
  );
  const assFallbackCanvases = Array.from(
    document.querySelectorAll(".videoPlayerContainer canvas.libassjs-canvas")
  ).filter((canvas) => !canvas.closest(".libassjs-canvas-parent"));
  const imageSubtitleCanvases = Array.from(
    document.querySelectorAll(".videoPlayerContainer canvas")
  ).filter(
    (canvas) => !canvas.classList.contains("libassjs-canvas") && isLikelyImageSubtitleCanvas(canvas)
  );

  return {
    assParents,
    assFallbackCanvases,
    assNodes: [...assParents, ...assFallbackCanvases],
    imageSubtitleCanvases,
    all: [...assParents, ...assFallbackCanvases, ...imageSubtitleCanvases]
  };
}

function isPlaybackManagerLike(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  return (
    typeof value.setSubtitleOffset === "function" ||
    typeof value.getActivePlayer === "function" ||
    typeof value.supportSubtitleOffset === "function" ||
    typeof value.getPlayerSubtitleOffset === "function"
  );
}

function collectPlaybackManagers() {
  const now = Date.now();
  if (now - playbackManagersCache.at < 2500) {
    return playbackManagersCache.list;
  }

  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!isPlaybackManagerLike(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  [
    window.playbackManager,
    window.MediaBrowser?.playbackManager,
    window.MediaBrowser?.PlaybackManager,
    window.Emby?.playbackManager,
    window.Emby?.PlaybackManager,
    window.appRouter?.playbackManager,
    window.dashboardPage?.playbackManager,
    window.__playbackManager,
    window.__jellyfinPlaybackManager,
    window.__jmsPlaybackManager
  ].forEach(add);

  try {
    const windowKeys = Object.getOwnPropertyNames(window);
    for (let i = 0; i < windowKeys.length; i++) {
      const key = windowKeys[i];
      if (!/playback/i.test(key)) continue;
      let value;
      try {
        value = window[key];
      } catch {
        continue;
      }
      add(value);
    }
  } catch {}

  playbackManagersCache = {
    at: now,
    list: out
  };
  return out;
}

function collectPlayerCandidates(playbackManagers) {
  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  add(window.MediaPlayer?.getActivePlayer?.());
  add(window.MediaBrowser?.MediaPlayer?.getActivePlayer?.());
  add(window.player);
  add(window.currentPlayer);
  add(window.__jmsPlayer);

  (playbackManagers || []).forEach((manager) => {
    try {
      add(manager.getActivePlayer?.());
    } catch {}
    try {
      add(manager._currentPlayer);
    } catch {}
  });

  try {
    const windowKeys = Object.getOwnPropertyNames(window);
    for (let i = 0; i < windowKeys.length; i++) {
      const key = windowKeys[i];
      if (!/player/i.test(key)) continue;
      let value;
      try {
        value = window[key];
      } catch {
        continue;
      }
      if (value && typeof value === "object" && typeof value.setSubtitleOffset === "function") {
        add(value);
      }
      if (value && typeof value.getActivePlayer === "function") {
        try {
          add(value.getActivePlayer());
        } catch {}
      }
    }
  } catch {}

  return out;
}

function isLikelyImageSubtitleCanvas(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  if (canvas.classList.contains("libassjs-canvas")) return false;

  const parent = canvas.parentElement;
  if (!parent || !parent.querySelector("video.htmlvideoplayer, video")) return false;

  let style;
  try {
    style = getComputedStyle(canvas);
  } catch {
    return false;
  }
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (!/absolute|fixed/.test(style.position || "")) return false;
  if ((style.pointerEvents || "").toLowerCase() !== "none") return false;

  const rect = canvas.getBoundingClientRect?.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;

  const classHints = `${canvas.className || ""} ${parent.className || ""}`.toLowerCase();
  const nameLooksLikeSubtitle = /pgs|sub|subtitle|caption|overlay|dvd|vob/.test(classHints);
  const styleLooksLikeSubtitle =
    (canvas.style.width === "100%" && canvas.style.height === "100%") ||
    !!canvas.style.objectFit ||
    style.objectFit !== "fill" ||
    style.inset !== "auto";

  return nameLooksLikeSubtitle || styleLooksLikeSubtitle;
}

function applyComplexSubtitleStyles(settings) {
  const scale = getComplexSubtitleScale(settings?.sizePercent);
  const shiftPercent = getComplexSubtitleShiftPercent(settings?.position);
  const shiftValue = shiftPercent ? `0 ${shiftPercent}%` : "";
  const shiftTransform = shiftPercent ? `translateY(${shiftPercent}%)` : "";
  const scaledTransform = `${shiftTransform}${shiftTransform ? " " : ""}scale(${scale})`;
  const transformOrigin = getComplexSubtitleTransformOrigin(settings?.position);
  const useIndependentTransforms = supportsIndependentTransformProperties();
  const complexNodes = collectComplexSubtitleNodes();

  [
    { nodes: complexNodes.assNodes, allowScale: false },
    { nodes: complexNodes.imageSubtitleCanvases, allowScale: true }
  ].forEach(({ nodes, allowScale }) => {
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.setProperty("transform-origin", transformOrigin, "important");
      if (useIndependentTransforms) {
        const currentTransform = normalizeTransformString(node.style.getPropertyValue("transform"));
        if (isLegacyComplexSubtitleTransform(currentTransform)) {
          node.style.removeProperty("transform");
        }

        if (shiftValue) node.style.setProperty("translate", shiftValue, "important");
        else node.style.removeProperty("translate");

        if (allowScale && Math.abs(scale - 1) > 0.001) {
          node.style.setProperty("scale", String(scale), "important");
        } else {
          node.style.removeProperty("scale");
        }
      } else {
        applyComplexSubtitleTransformFallback(
          node,
          allowScale ? scaledTransform : shiftTransform
        );
      }
      node.style.setProperty(
        "will-change",
        useIndependentTransforms
          ? (allowScale ? "transform, translate, scale" : "transform, translate")
          : "transform"
      );
    });
  });
}

function applyNativeSubtitleOffsetViaUi(delaySec) {
  const normalized =
    Math.round(clampNumber(delaySec, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
  const slider = document.querySelector(".subtitleSyncSlider");
  if (!(slider instanceof HTMLInputElement)) return false;

  const next = String(normalized);
  let applied = false;

  try {
    if (typeof slider.updateOffset === "function") {
      slider.updateOffset(normalized);
      applied = true;
    }
  } catch {}

  if (!applied) {
    try {
      if (slider.value !== next) slider.value = next;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      applied = true;
    } catch {}
  }

  return applied;
}

function syncNativeSubtitleSyncUi(delaySec, opts = null) {
  const normalized =
    Math.round(clampNumber(delaySec, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;

  const slider = document.querySelector(".subtitleSyncSlider");
  if (slider instanceof HTMLInputElement) {
    const next = String(normalized);
    if (slider.value !== next) slider.value = next;
  }

  const textField = document.querySelector(".subtitleSyncTextField");
  if (textField instanceof HTMLElement) {
    textField.textContent = `${normalized}s`;
  }

  if (opts?.applyToPlayer) {
    return applyNativeSubtitleOffsetViaUi(normalized);
  }
  return false;
}

function tryRefreshPlayerAppearance(settings) {
  const subtitleDelayRaw = Number(settings?.delaySec);
  const playbackManagers = collectPlaybackManagers();
  const players = collectPlayerCandidates(playbackManagers);
  let didApplySubtitleDelay = false;
  let managerApplyAttempts = 0;
  let managerApplySuccess = 0;
  let playerApplyAttempts = 0;
  let playerApplySuccess = 0;
  let nativeUiApplied = false;

  players.forEach((player) => {
    try {
      patchPlayerSubtitleAppearance(player, settings);
    } catch {}
  });

  const readSubtitleOffset = (target, playerArg = null) => {
    if (!target || typeof target !== "object") return null;

    try {
      if (typeof target.getSubtitleOffset === "function") {
        const value = Number(target.getSubtitleOffset());
        if (Number.isFinite(value)) return value;
      }
    } catch {}

    try {
      if (typeof target.getPlayerSubtitleOffset === "function") {
        const value = Number(target.getPlayerSubtitleOffset(playerArg || undefined));
        if (Number.isFinite(value)) return value;
      }
    } catch {}

    return null;
  };

  const applyOffsetToTarget = (target, sec, playerArg = null) => {
    if (!target || typeof target.setSubtitleOffset !== "function") return false;

    const isVerified = (didInvoke) => {
      if (!didInvoke) return false;
      const appliedOffset = readSubtitleOffset(target, playerArg);
      if (!Number.isFinite(appliedOffset)) return false;
      if (Math.abs(appliedOffset - sec) > 0.051) {
        return false;
      }
      didApplySubtitleDelay = true;
      return true;
    };

    let invoked = false;
    try {
      if (playerArg && playerArg !== target) target.setSubtitleOffset(sec, playerArg);
      else target.setSubtitleOffset(sec);
      invoked = true;
      return isVerified(invoked);
    } catch {
      if (!playerArg) return false;
      try {
        target.setSubtitleOffset(sec);
        invoked = true;
        return isVerified(invoked);
      } catch {
        return false;
      }
    }
  };

  if (Number.isFinite(subtitleDelayRaw)) {
    const subtitleDelay =
      Math.round(clampNumber(subtitleDelayRaw, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;

    const tryManagerApply = (manager, player = null) => {
      if (!manager || typeof manager !== "object") return false;
      const targetPlayer = player || manager.getActivePlayer?.() || null;

      try {
        if (typeof manager.enableShowingSubtitleOffset === "function") {
          manager.enableShowingSubtitleOffset(targetPlayer || undefined);
        }
      } catch {}

      return applyOffsetToTarget(manager, subtitleDelay, targetPlayer);
    };

    playbackManagers.forEach((manager) => {
      if (!manager || typeof manager !== "object") return;
      if (typeof manager.setSubtitleOffset !== "function") return;

      managerApplyAttempts += 1;
      if (tryManagerApply(manager, null)) managerApplySuccess += 1;
      players.forEach((player) => {
        managerApplyAttempts += 1;
        if (tryManagerApply(manager, player)) managerApplySuccess += 1;
      });
    });

    players.forEach((player) => {
      if (!player || typeof player !== "object") return;
      playerApplyAttempts += 1;
      if (applyOffsetToTarget(player, subtitleDelay)) playerApplySuccess += 1;
    });

    nativeUiApplied = syncNativeSubtitleSyncUi(subtitleDelay, { applyToPlayer: true });
    if (nativeUiApplied) didApplySubtitleDelay = true;
  }

  players.forEach((player) => {
    if (!player || typeof player !== "object") return;
    try {
      if (typeof player.setCueAppearance === "function") {
        player.setCueAppearance();
      }
    } catch {}

    try {
      const windowEl = document.querySelector(".videoSubtitles");
      const primaryTextEl = document.querySelector(".videoSubtitlesInner");
      const secondaryTextEl = document.querySelector(".videoSecondarySubtitlesInner");
      if (typeof player.setSubtitleAppearance === "function" && windowEl) {
        if (primaryTextEl) player.setSubtitleAppearance(windowEl, primaryTextEl);
        if (secondaryTextEl) player.setSubtitleAppearance(windowEl, secondaryTextEl);
      }
    } catch {}
  });

  return {
    didApplySubtitleDelay,
    managerCount: playbackManagers.length,
    playerCount: players.length,
    managerApplyAttempts,
    managerApplySuccess,
    playerApplyAttempts,
    playerApplySuccess,
    nativeUiApplied
  };
}

function getShowingSubtitleTracks(video) {
  return getSubtitleTracks(video, true);
}

function getSubtitleTracks(video, showingOnly = false) {
  if (!video || !video.textTracks) return [];
  const out = [];
  const tracks = video.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const kind = String(track?.kind || "").toLowerCase();
    const isSubtitleLike = kind === "subtitles" || kind === "captions" || !kind;
    if (!isSubtitleLike) continue;
    if (showingOnly && track?.mode !== "showing") continue;
    if (!showingOnly && !["showing", "hidden", "disabled"].includes(track?.mode)) continue;
    if (track) {
      out.push(track);
    }
  }
  return out;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;
  const st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
}

function scoreVideoCandidate(video) {
  try {
    if (!(video instanceof HTMLVideoElement)) return -1e9;
    let score = 0;
    if (video.classList.contains("htmlvideoplayer")) score += 1000;
    if (video.closest(".htmlvideoplayer")) score += 900;
    if (!video.paused && !video.ended) score += 140;
    if (video.controls) score += 60;
    if ((video.currentSrc || "").startsWith("blob:")) score += 120;
    if (isVisible(video)) score += 90;
    if (video.videoWidth > 0 && video.videoHeight > 0) score += 40;
    return score;
  } catch {
    return -1e9;
  }
}

function pickActiveVideo() {
  const pinned = window.__jmsActiveVideo;
  if (pinned instanceof HTMLVideoElement && pinned.isConnected) {
    return pinned;
  }
  let best = null;
  let bestScore = -1e9;
  document.querySelectorAll("video").forEach((video) => {
    const s = scoreVideoCandidate(video);
    if (s > bestScore) {
      bestScore = s;
      best = video;
    }
  });
  return bestScore > -1e6 ? best : null;
}

function applyPositionToCue(cue, position) {
  try {
    if (position === "bottom") {
      cue.snapToLines = true;
      cue.line = -1;
      return;
    }
    if (position === "top") {
      cue.snapToLines = true;
      cue.line = 0;
      return;
    }
    cue.snapToLines = false;
    cue.line = 50;
    try {
      cue.position = 50;
    } catch {}
  } catch {}
}

function shiftTrackCues(track, settings) {
  const cues = track?.cues;
  if (!cues || !cues.length) return;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    applyPositionToCue(cue, settings.position);
  }
}

function shiftTrackCueTimings(track, delayDeltaSec) {
  const cues = track?.cues;
  if (!cues || !cues.length) return;

  const shift = Number(delayDeltaSec);
  if (!Number.isFinite(shift) || shift === 0) return;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue) continue;
    try {
      cue.startTime -= shift;
      cue.endTime -= shift;
    } catch {}
  }
}

function setSubtitleDialogOpenState(isOpen) {
  try {
    document.documentElement.classList.toggle("jms-subtitle-dialog-open", !!isOpen);
  } catch {}
  try {
    document.body?.classList.toggle("jms-subtitle-dialog-open", !!isOpen);
  } catch {}
}

function isPlaybackScreenActive() {
  const hasControls = !!document.querySelector(".videoOsdBottom.videoOsdBottom-maincontrols .buttons");
  const hasPlayerContainer = !!document.querySelector(".videoPlayerContainer");
  const hasPlayerVideo = !!document.querySelector(".videoPlayerContainer video.htmlvideoplayer, .videoPlayerContainer video");
  return hasControls || (hasPlayerContainer && hasPlayerVideo);
}

function createDialog(settings, onUpdate, onReset, onClosed) {
  document.querySelectorAll(`[${DIALOG_ATTR}]`).forEach((node) => node.remove());

  const backdrop = document.createElement("div");
  backdrop.className = "dialogBackdrop";
  backdrop.setAttribute(DIALOG_ATTR, "1");

  const container = document.createElement("div");
  container.className = "dialogContainer";
  container.setAttribute(DIALOG_ATTR, "1");

  const fontOptionsHtml = getFontOptions().map((opt) => {
    const selected = opt.value === settings.fontFamily ? "selected" : "";
    return `<option value="${escapeAttr(opt.value)}" ${selected}>${escapeAttr(opt.label)}</option>`;
  }).join("");
  const shadowOptionsHtml = SHADOW_OPTIONS.map((opt) => {
    const selected = opt.value === settings.dropShadow ? "selected" : "";
    return `<option value="${escapeAttr(opt.value)}" ${selected}>${escapeAttr(opt.label)}</option>`;
  }).join("");
  const colorOpacityInitialValue = normalizeColorOpacity(settings.colorOpacity);
  const shadowColorValue = normalizeShadowColor(settings.shadowColor);
  const shadowOpacityInitialValue = normalizeShadowOpacity(settings.shadowOpacity);
  const shadowSizeInitialValue = normalizeShadowSize(settings.shadowSize);
  const shadowDirectionInitialValue = normalizeShadowDirection(settings.shadowDirection);
  const backgroundColorValue = normalizeBackgroundColor(settings.backgroundColor);
  const backgroundOpacityInitialValue = normalizeBackgroundOpacity(settings.backgroundOpacity);
  const backgroundRadiusValue = normalizeBackgroundRadius(settings.backgroundRadiusPx);
  const delaySummaryValue = formatDelayValue(settings.delaySec);
  const backLabel = L("subtitleCustomizerBack", "Geri");

  container.innerHTML = `
    <div id="${DIALOG_ID}" class="focuscontainer dialog opened jms-subtitle-dialog" role="dialog" aria-modal="true">
      <div class="formDialog">
        <div class="formDialogHeader">
          <button type="button" is="paper-icon-button-light" class="btnCancel autoSize" title="${escapeAttr(backLabel)}">
            ${faIconHtml("arrowLeft", "jms-subtitle-icon")}
          </button>
          <h3 class="formDialogHeaderTitle">${escapeAttr(L("subtitleCustomizerDialogTitle", "Altyazı Ayarları"))}</h3>
        </div>
        <div class="formDialogContent scrollY jms-subtitle-formContent">
          <div class="dialogContentInner dialog-content-centered jms-subtitle-content">
            <div class="jms-subtitle-previewWrap">
              <div class="jms-subtitle-previewTitle">${escapeAttr(L("subtitleCustomizerPreviewTitle", "Canlı Önizleme"))}</div>
              <div class="jms-subtitle-previewStage" data-position="${escapeAttr(settings.position)}">
                <div class="jms-subtitle-previewCaption">
                  <div class="jms-subtitle-previewText">${escapeAttr(L("subtitleCustomizerPreviewLine1", "Bu bir canlı önizleme satırıdır."))}
${escapeAttr(L("subtitleCustomizerPreviewLine2", "İkinci satır burada görünür."))}</div>
                </div>
              </div>
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-size">${escapeAttr(L("subtitleCustomizerSizeLabel", "Yazı boyutu (%)"))}</label>
              <input id="jms-subtitle-size" type="range" min="60" max="220" step="1" value="${settings.sizePercent}" />
              <div class="fieldDescription"><span id="jms-subtitle-size-value">${settings.sizePercent}%</span></div>
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-color">${escapeAttr(L("subtitleCustomizerColorLabel", "Yazı rengi"))}</label>
              <input id="jms-subtitle-color" class="jms-subtitle-colorInput" type="color" value="${settings.color}" />
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-color-opacity">${escapeAttr(L("subtitleCustomizerColorOpacityLabel", "Yazı opaklığı"))}</label>
              <input id="jms-subtitle-color-opacity" type="range" min="0" max="100" step="1" value="${colorOpacityInitialValue}" />
              <div class="fieldDescription"><span id="jms-subtitle-color-opacity-value">${colorOpacityInitialValue}%</span></div>
            </div>

            <div class="selectContainer">
              <label class="selectLabel" for="jms-subtitle-font">${escapeAttr(L("subtitleCustomizerFontLabel", "Yazı fontu"))}</label>
              <select id="jms-subtitle-font" is="emby-select" class="emby-select">
                ${fontOptionsHtml}
              </select>
            </div>

            <div class="selectContainer">
              <label class="selectLabel" for="jms-subtitle-shadow">${escapeAttr(L("subtitleCustomizerShadowLabel", "Gölgelendirme"))}</label>
              <select id="jms-subtitle-shadow" is="emby-select" class="emby-select">
                ${shadowOptionsHtml}
              </select>
            </div>

            <div class="inputContainer jms-subtitle-colorRow">
              <label for="jms-subtitle-shadow-color">${escapeAttr(L("subtitleCustomizerShadowColorLabel", "Gölge rengi"))}</label>
              <input id="jms-subtitle-shadow-color" class="jms-subtitle-colorInput" type="color" value="${shadowColorValue}" />
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-shadow-opacity">${escapeAttr(L("subtitleCustomizerShadowOpacityLabel", "Gölge opaklığı"))}</label>
              <input id="jms-subtitle-shadow-opacity" type="range" min="0" max="100" step="1" value="${shadowOpacityInitialValue}" />
              <div class="fieldDescription"><span id="jms-subtitle-shadow-opacity-value">${shadowOpacityInitialValue}%</span></div>
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-shadow-size">${escapeAttr(L("subtitleCustomizerShadowSizeLabel", "Gölge boyutu"))}</label>
              <input id="jms-subtitle-shadow-size" type="range" min="0" max="24" step="1" value="${shadowSizeInitialValue}" />
              <div class="fieldDescription"><span id="jms-subtitle-shadow-size-value">${shadowSizeInitialValue}px</span></div>
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-shadow-direction">${escapeAttr(L("subtitleCustomizerShadowDirectionLabel", "Gölge yönü"))}</label>
              <input id="jms-subtitle-shadow-direction" type="range" min="0" max="360" step="1" value="${shadowDirectionInitialValue}" />
              <div class="fieldDescription"><span id="jms-subtitle-shadow-direction-value">${shadowDirectionInitialValue}°</span></div>
            </div>

            <div class="inputContainer jms-subtitle-bgRow">
              <label class="jms-subtitle-inlineLabel" for="jms-subtitle-bg-enabled">
                <input id="jms-subtitle-bg-enabled" type="checkbox" ${settings.backgroundEnabled ? "checked" : ""} />
                <span>${escapeAttr(L("subtitleCustomizerBackgroundLabel", "Arkaplan rengi"))}</span>
              </label>
              <input id="jms-subtitle-bg-color" class="jms-subtitle-colorInput" type="color" value="${backgroundColorValue}" ${settings.backgroundEnabled ? "" : "disabled"} />
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-bg-opacity">${escapeAttr(L("subtitleCustomizerBackgroundOpacityLabel", "Arkaplan opaklığı"))}</label>
              <input id="jms-subtitle-bg-opacity" type="range" min="0" max="100" step="1" value="${backgroundOpacityInitialValue}" ${settings.backgroundEnabled ? "" : "disabled"} />
              <div class="fieldDescription"><span id="jms-subtitle-bg-opacity-value">${backgroundOpacityInitialValue}%</span></div>
            </div>

            <div class="inputContainer">
              <label for="jms-subtitle-bg-radius">${escapeAttr(L("subtitleCustomizerBackgroundRadiusLabel", "Arkaplan köşe yuvarlama"))}</label>
              <input id="jms-subtitle-bg-radius" type="range" min="${MIN_BACKGROUND_RADIUS_PX}" max="${MAX_BACKGROUND_RADIUS_PX}" step="1" value="${backgroundRadiusValue}" ${settings.backgroundEnabled ? "" : "disabled"} />
              <div class="fieldDescription"><span id="jms-subtitle-bg-radius-value">${backgroundRadiusValue}px</span></div>
            </div>

            <div class="selectContainer">
              <label class="selectLabel" for="jms-subtitle-position">${escapeAttr(L("subtitleCustomizerPositionLabel", "Konum"))}</label>
              <select id="jms-subtitle-position" is="emby-select" class="emby-select">
                <option value="bottom" ${settings.position === "bottom" ? "selected" : ""}>${escapeAttr(L("subtitleCustomizerPositionBottom", "Alt"))}</option>
                <option value="center" ${settings.position === "center" ? "selected" : ""}>${escapeAttr(L("subtitleCustomizerPositionCenter", "Orta"))}</option>
                <option value="top" ${settings.position === "top" ? "selected" : ""}>${escapeAttr(L("subtitleCustomizerPositionTop", "Üst"))}</option>
              </select>
            </div>

            <div class="inputContainer jms-subtitle-delayLaunch" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="jms-subtitle-delay-focus-panel">
              <div class="jms-subtitle-delayLaunchHead">
                <label>${escapeAttr(L("subtitleCustomizerDelayLabel", "Gecikme (saniye)"))}</label>
                <span id="jms-subtitle-delay-summary" class="jms-subtitle-delaySummaryValue">${delaySummaryValue}</span>
              </div>
              <div class="jms-subtitle-delayLaunchHint">${escapeAttr(L("subtitleCustomizerDelayFocusCta", "Canlı delay çubuğunu aç"))}</div>
            </div>
          </div>
        </div>
        <div class="formDialogFooter">
          <button is="emby-button" type="button" class="raised button-cancel formDialogFooterItem jms-subtitle-reset">
            <span>${escapeAttr(L("subtitleCustomizerResetButton", "Sıfırla"))}</span>
          </button>
          <button is="emby-button" type="button" class="raised button-submit formDialogFooterItem jms-subtitle-close">
            <span>${escapeAttr(L("subtitleCustomizerCloseButton", "Kapat"))}</span>
          </button>
        </div>
      </div>
      <div id="jms-subtitle-delay-focus-panel" class="jms-subtitle-delayFocusPanel" hidden>
        <div class="jms-subtitle-delayFocusCard">
          <div class="jms-subtitle-delayFocusHeader">
            <div>
              <div class="jms-subtitle-delayFocusEyebrow">${escapeAttr(L("subtitleCustomizerDelayLiveTitle", "Canlı Gecikme Ayarı"))}</div>
              <div id="jms-subtitle-delay-focus-value" class="jms-subtitle-delayFocusValue">${delaySummaryValue}</div>
            </div>
            <div class="jms-subtitle-delayFocusHeaderActions">
              <button is="emby-button" type="button" class="raised button-submit jms-subtitle-delayFocusDone">
                <span>${escapeAttr(L("subtitleCustomizerDelayFocusDone", "Panele Dön"))}</span>
              </button>
              <button is="emby-button" type="button" class="raised button-cancel jms-subtitle-delayFocusClose">
                <span>${escapeAttr(L("subtitleCustomizerCloseButton", "Kapat"))}</span>
              </button>
            </div>
          </div>
          <input id="jms-subtitle-delay-live" class="jms-subtitle-delayRange" type="range" step="0.1" min="-30" max="30" value="${settings.delaySec.toFixed(1)}" />
          <div class="jms-subtitle-delayFocusScale" aria-hidden="true">
            <span>${escapeAttr(L("subtitleCustomizerDelayScaleMin", "-30s"))}</span>
            <span>${escapeAttr(L("subtitleCustomizerDelayScaleZero", "0.0s"))}</span>
            <span>${escapeAttr(L("subtitleCustomizerDelayScaleMax", "+30s"))}</span>
          </div>
          <div class="jms-subtitle-delayFocusActions">
            <button is="emby-button" type="button" class="raised button-cancel jms-subtitle-delayFocusReset">
              <span>${escapeAttr(L("subtitleCustomizerDelayReset", "Delay Sıfırla"))}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.append(backdrop, container);
  setSubtitleDialogOpenState(true);

  const dialogEl = container.querySelector(`#${DIALOG_ID}`);
  const keyTrap = (ev) => {
    const t = ev?.target;
    if (!(t instanceof Node)) return;

    if (!container.contains(t)) return;
    if (ev.key === "Escape") return;

    try { ev.stopImmediatePropagation?.(); } catch {}
    try { ev.stopPropagation?.(); } catch {}
  };

  document.addEventListener("keydown", keyTrap, true);
  document.addEventListener("keypress", keyTrap, true);
  document.addEventListener("keyup", keyTrap, true);

  let isClosed = false;

  let close = () => {
    if (isClosed) return;
    isClosed = true;
    backdrop.remove();
    container.remove();
    document.removeEventListener("keydown", onEsc, true);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", keyTrap, true);
    document.removeEventListener("keypress", keyTrap, true);
    document.removeEventListener("keyup", keyTrap, true);
    setSubtitleDialogOpenState(false);
    try {
      onClosed?.();
    } catch {}
  };

  let isDelayFocusMode = false;

  const setDelayFocusMode = (active) => {
    isDelayFocusMode = !!active;
    container.classList.toggle("jms-delay-focus-mode", isDelayFocusMode);
    if (delayFocusPanel instanceof HTMLElement) {
      delayFocusPanel.hidden = !isDelayFocusMode;
    }
    backdrop.style.display = isDelayFocusMode ? "none" : "";
    if (delayLaunch instanceof HTMLElement) {
      delayLaunch.setAttribute("aria-expanded", isDelayFocusMode ? "true" : "false");
    }
    if (isDelayFocusMode) {
      window.requestAnimationFrame(() => {
        try {
          delayFocusRange?.focus?.({ preventScroll: true });
        } catch {
          delayFocusRange?.focus?.();
        }
      });
    }
  };

  const onEsc = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (isDelayFocusMode) {
        setDelayFocusMode(false);
        return;
      }
      close();
    }
  };
  document.addEventListener("keydown", onEsc, true);

  const onDocPointerDown = (ev) => {
    const target = ev?.target;
    if (!(target instanceof Node)) {
      close();
      return;
    }
    if (delayFocusPanel && delayFocusPanel.contains(target)) return;
    if (isDelayFocusMode) {
      close();
      return;
    }
    if (dialogEl && dialogEl.contains(target)) return;
    close();
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);

  backdrop.addEventListener("click", () => {
    close();
  });
  container.querySelector(".btnCancel")?.addEventListener("click", close);
  container.querySelector(".jms-subtitle-close")?.addEventListener("click", close);

  const size = container.querySelector("#jms-subtitle-size");
  const sizeValue = container.querySelector("#jms-subtitle-size-value");
  const color = container.querySelector("#jms-subtitle-color");
  const colorOpacity = container.querySelector("#jms-subtitle-color-opacity");
  const colorOpacityValue = container.querySelector("#jms-subtitle-color-opacity-value");
  const font = container.querySelector("#jms-subtitle-font");
  const shadow = container.querySelector("#jms-subtitle-shadow");
  const shadowColor = container.querySelector("#jms-subtitle-shadow-color");
  const shadowOpacity = container.querySelector("#jms-subtitle-shadow-opacity");
  const shadowOpacityValue = container.querySelector("#jms-subtitle-shadow-opacity-value");
  const shadowSize = container.querySelector("#jms-subtitle-shadow-size");
  const shadowSizeValue = container.querySelector("#jms-subtitle-shadow-size-value");
  const shadowDirection = container.querySelector("#jms-subtitle-shadow-direction");
  const shadowDirectionValue = container.querySelector("#jms-subtitle-shadow-direction-value");
  const backgroundEnabled = container.querySelector("#jms-subtitle-bg-enabled");
  const backgroundColor = container.querySelector("#jms-subtitle-bg-color");
  const backgroundOpacityInput = container.querySelector("#jms-subtitle-bg-opacity");
  const backgroundOpacityValueText = container.querySelector("#jms-subtitle-bg-opacity-value");
  const backgroundRadiusInput = container.querySelector("#jms-subtitle-bg-radius");
  const backgroundRadiusValueText = container.querySelector("#jms-subtitle-bg-radius-value");
  const position = container.querySelector("#jms-subtitle-position");
  const delayLaunch = container.querySelector(".jms-subtitle-delayLaunch");
  const delaySummary = container.querySelector("#jms-subtitle-delay-summary");
  const delayFocusPanel = container.querySelector("#jms-subtitle-delay-focus-panel");
  const delayFocusRange = container.querySelector("#jms-subtitle-delay-live");
  const delayFocusValue = container.querySelector("#jms-subtitle-delay-focus-value");
  const delayFocusDone = container.querySelector(".jms-subtitle-delayFocusDone");
  const delayFocusClose = container.querySelector(".jms-subtitle-delayFocusClose");
  const delayFocusReset = container.querySelector(".jms-subtitle-delayFocusReset");
  const resetBtn = container.querySelector(".jms-subtitle-reset");
  const previewStage = container.querySelector(".jms-subtitle-previewStage");
  const previewText = container.querySelector(".jms-subtitle-previewText");

  const renderDelayUi = () => {
    const valueText = formatDelayValue(settings.delaySec);
    if (delaySummary) delaySummary.textContent = valueText;
    if (delayFocusValue) delayFocusValue.textContent = valueText;
    if (delayFocusRange) delayFocusRange.value = settings.delaySec.toFixed(1);
  };

  const renderPreview = () => {
    if (!(previewStage instanceof HTMLElement) || !(previewText instanceof HTMLElement)) return;
    const fontStack = resolveFontStack(settings);
    const textShadow = getTextShadowValue(
      settings.dropShadow,
      settings.shadowColor,
      settings.shadowSize,
      settings.shadowDirection,
      settings.shadowOpacity
    );
    const textColor = getTextColorValue(settings);
    const textBackground = getBackgroundColorValue(settings);
    const backgroundRadius = getBackgroundRadiusCssValue(settings);
    const pxSize = Math.round(clampNumber(settings.sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent) * 0.22);

    previewStage.setAttribute("data-position", settings.position);
    previewText.style.color = textColor;
    previewText.style.fontFamily = fontStack;
    previewText.style.textShadow = textShadow;
    previewText.style.backgroundColor = textBackground;
    previewText.style.padding = settings.backgroundEnabled ? PREVIEW_BACKGROUND_PADDING : "0";
    previewText.style.borderRadius = settings.backgroundEnabled ? backgroundRadius : "0";
    previewText.style.display = settings.backgroundEnabled ? "inline-block" : "";
    previewText.style.boxDecorationBreak = settings.backgroundEnabled ? "clone" : "";
    previewText.style.webkitBoxDecorationBreak = settings.backgroundEnabled ? "clone" : "";
    previewText.style.fontSize = `${Math.max(14, Math.min(46, pxSize))}px`;

    if (backgroundColor) backgroundColor.disabled = !settings.backgroundEnabled;
    if (backgroundOpacityInput) backgroundOpacityInput.disabled = !settings.backgroundEnabled;
    if (backgroundRadiusInput) backgroundRadiusInput.disabled = !settings.backgroundEnabled;
  };

  const emitUpdate = () => {
    settings.sizePercent = Math.round(clampNumber(size?.value, 60, 220, DEFAULT_SETTINGS.sizePercent));
    settings.color = normalizeColor(color?.value);
    settings.colorOpacity = normalizeColorOpacity(colorOpacity?.value ?? DEFAULT_SETTINGS.colorOpacity);

    const selectedFont = String(font?.value || DEFAULT_SETTINGS.fontFamily);
    settings.fontFamily = normalizeFontFamilySelection(selectedFont, DEFAULT_SETTINGS.fontFamily);
    settings.dropShadow = normalizeDropShadow(shadow?.value || DEFAULT_SETTINGS.dropShadow);
    settings.shadowColor = normalizeShadowColor(shadowColor?.value || DEFAULT_SETTINGS.shadowColor);
    settings.shadowOpacity = normalizeShadowOpacity(shadowOpacity?.value ?? DEFAULT_SETTINGS.shadowOpacity);
    settings.shadowSize = normalizeShadowSize(shadowSize?.value ?? DEFAULT_SETTINGS.shadowSize);
    settings.shadowDirection = normalizeShadowDirection(shadowDirection?.value ?? DEFAULT_SETTINGS.shadowDirection);
    settings.backgroundEnabled = !!backgroundEnabled?.checked;
    settings.backgroundColor = normalizeBackgroundColor(backgroundColor?.value || DEFAULT_SETTINGS.backgroundColor);
    settings.backgroundOpacity = normalizeBackgroundOpacity(
      backgroundOpacityInput?.value ?? DEFAULT_SETTINGS.backgroundOpacity
    );
    settings.backgroundRadiusPx = normalizeBackgroundRadius(
      backgroundRadiusInput?.value ?? DEFAULT_SETTINGS.backgroundRadiusPx
    );

    settings.position = POSITION_VALUES.includes(position?.value) ? position.value : DEFAULT_SETTINGS.position;

    if (sizeValue) sizeValue.textContent = `${settings.sizePercent}%`;
    if (colorOpacityValue) colorOpacityValue.textContent = `${settings.colorOpacity}%`;
    if (shadowOpacityValue) shadowOpacityValue.textContent = `${settings.shadowOpacity}%`;
    if (shadowSizeValue) shadowSizeValue.textContent = `${settings.shadowSize}px`;
    if (shadowDirectionValue) shadowDirectionValue.textContent = `${settings.shadowDirection}°`;
    if (backgroundOpacityValueText) backgroundOpacityValueText.textContent = `${settings.backgroundOpacity}%`;
    if (backgroundRadiusValueText) backgroundRadiusValueText.textContent = `${settings.backgroundRadiusPx}px`;
    renderPreview();
    renderDelayUi();
    onUpdate();
  };

  const emitDelayUpdate = () => {
    const parsed = Number(delayFocusRange?.value);
    if (!Number.isFinite(parsed)) return;
    settings.delaySec =
      Math.round(clampNumber(parsed, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
    renderDelayUi();
    onUpdate();
  };

  const openDelayFocusMode = (ev) => {
    if (!(delayFocusPanel instanceof HTMLElement)) return;
    if (ev) {
      ev.preventDefault();
    }
    setDelayFocusMode(true);
  };

  size?.addEventListener("input", emitUpdate);
  color?.addEventListener("input", emitUpdate);
  colorOpacity?.addEventListener("input", emitUpdate);
  colorOpacity?.addEventListener("change", emitUpdate);
  font?.addEventListener("change", emitUpdate);
  shadow?.addEventListener("change", emitUpdate);
  shadowColor?.addEventListener("input", emitUpdate);
  shadowColor?.addEventListener("change", emitUpdate);
  shadowOpacity?.addEventListener("input", emitUpdate);
  shadowOpacity?.addEventListener("change", emitUpdate);
  shadowSize?.addEventListener("input", emitUpdate);
  shadowSize?.addEventListener("change", emitUpdate);
  shadowDirection?.addEventListener("input", emitUpdate);
  shadowDirection?.addEventListener("change", emitUpdate);
  backgroundEnabled?.addEventListener("change", emitUpdate);
  backgroundColor?.addEventListener("input", emitUpdate);
  backgroundColor?.addEventListener("change", emitUpdate);
  backgroundOpacityInput?.addEventListener("input", emitUpdate);
  backgroundOpacityInput?.addEventListener("change", emitUpdate);
  backgroundRadiusInput?.addEventListener("input", emitUpdate);
  backgroundRadiusInput?.addEventListener("change", emitUpdate);
  position?.addEventListener("change", emitUpdate);
  delayLaunch?.addEventListener("click", openDelayFocusMode);
  delayLaunch?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    openDelayFocusMode(ev);
  });
  delayFocusRange?.addEventListener("input", emitDelayUpdate);
  delayFocusRange?.addEventListener("change", emitDelayUpdate);
  delayFocusDone?.addEventListener("click", () => {
    setDelayFocusMode(false);
    delayLaunch?.focus?.();
  });
  delayFocusClose?.addEventListener("click", () => {
    close();
  });
  delayFocusReset?.addEventListener("click", () => {
    settings.delaySec = DEFAULT_SETTINGS.delaySec;
    renderDelayUi();
    onUpdate();
  });

  resetBtn?.addEventListener("click", () => {
    onReset();
    if (size) size.value = settings.sizePercent;
    if (sizeValue) sizeValue.textContent = `${settings.sizePercent}%`;
    if (color) color.value = settings.color;
    if (colorOpacity) colorOpacity.value = String(settings.colorOpacity);
    if (colorOpacityValue) colorOpacityValue.textContent = `${settings.colorOpacity}%`;
    if (font) font.value = settings.fontFamily;
    if (shadow) shadow.value = settings.dropShadow;
    if (shadowColor) shadowColor.value = settings.shadowColor;
    if (shadowOpacity) shadowOpacity.value = String(settings.shadowOpacity);
    if (shadowOpacityValue) shadowOpacityValue.textContent = `${settings.shadowOpacity}%`;
    if (shadowSize) shadowSize.value = String(settings.shadowSize);
    if (shadowSizeValue) shadowSizeValue.textContent = `${settings.shadowSize}px`;
    if (shadowDirection) shadowDirection.value = String(settings.shadowDirection);
    if (shadowDirectionValue) shadowDirectionValue.textContent = `${settings.shadowDirection}°`;
    if (backgroundEnabled) backgroundEnabled.checked = settings.backgroundEnabled;
    if (backgroundColor) backgroundColor.value = settings.backgroundColor;
    if (backgroundOpacityInput) backgroundOpacityInput.value = String(settings.backgroundOpacity);
    if (backgroundOpacityValueText) backgroundOpacityValueText.textContent = `${settings.backgroundOpacity}%`;
    if (backgroundRadiusInput) backgroundRadiusInput.value = String(settings.backgroundRadiusPx);
    if (backgroundRadiusValueText) backgroundRadiusValueText.textContent = `${settings.backgroundRadiusPx}px`;
    if (position) position.value = settings.position;
    renderDelayUi();
    setDelayFocusMode(false);
    renderPreview();
  });

  const originalClose = close;
  close = () => {
    setDelayFocusMode(false);
    originalClose();
  };

  setDelayFocusMode(false);
  renderDelayUi();
  renderPreview();
  return close;
}

function refreshTrack(track) {
    try {
      const prev = track.mode;
      track.mode = "disabled";
      track.mode = prev;
    } catch {}
  }

export function initSubtitleCustomizer() {
  if (window.__jmsSubtitleCustomizer?.active) {
    return window.__jmsSubtitleCustomizer.destroy;
  }

  const settings = loadSettings();
  let observer = null;
  let intervalId = null;
  let closeDialog = null;
  let lastSaved = "";
  let lastComplexSubtitleRendererState = null;
  let lastAppliedDelay = settings.delaySec;
  let lastAppliedPosition = settings.position;
  let missingPlaybackTicks = 0;

  const maybeAutoCloseDialog = () => {
    if (!closeDialog) {
      missingPlaybackTicks = 0;
      return;
    }
    if (isPlaybackScreenActive()) {
      missingPlaybackTicks = 0;
      return;
    }
    missingPlaybackTicks += 1;
    if (missingPlaybackTicks < 2) return;
    try {
      closeDialog();
    } catch {}
    closeDialog = null;
    missingPlaybackTicks = 0;
  };

  const applyNow = () => {
    try {
      window.__jmsSubtitleCustomizerState = {
        settings: { ...settings }
      };
    } catch {}

    const hasAssSubtitleRenderer = collectComplexSubtitleNodes().assNodes.length > 0;
    const serialized = JSON.stringify(settings);
    if (serialized !== lastSaved || hasAssSubtitleRenderer !== lastComplexSubtitleRendererState) {
      saveSettings(settings);
      saveJellyfinAppearance(settings, {
        suppressComplexTextSize: hasAssSubtitleRenderer
      });
      lastSaved = serialized;
      lastComplexSubtitleRendererState = hasAssSubtitleRenderer;
    }

    ensureClientSubtitleRenderingPreferences();
    const playerRefreshState = tryRefreshPlayerAppearance(settings);
    applyCueCss(settings);
    patchExistingCueStyles(settings);
    applyOverlayStyles(settings);
    applyComplexSubtitleStyles(settings);

    const video = pickActiveVideo();
    if (!video) return;

    const showingTracks = getShowingSubtitleTracks(video);
    const subtitleTracks = getSubtitleTracks(video, false);

    const delayChanged = settings.delaySec !== lastAppliedDelay;
    const posChanged = settings.position !== lastAppliedPosition;
    const delayDeltaSec = settings.delaySec - lastAppliedDelay;
    const needCueDelayFallback =
      delayChanged &&
      !playerRefreshState?.didApplySubtitleDelay &&
      Number.isFinite(delayDeltaSec) &&
      delayDeltaSec !== 0;

    if (needCueDelayFallback) {
      subtitleTracks.forEach((track) => {
        shiftTrackCueTimings(track, delayDeltaSec);
      });
    }

    showingTracks.forEach((track) => {
      if (needCueDelayFallback) {
        refreshTrack(track);
      }
      shiftTrackCues(track, settings);
      if (posChanged) refreshTrack(track);
    });

    if (delayChanged) lastAppliedDelay = settings.delaySec;
    if (posChanged) lastAppliedPosition = settings.position;

    try {
      window.__jmsSubtitleDelayDebug = {
        at: Date.now(),
        delaySec: settings.delaySec,
        delayChanged,
        delayDeltaSec,
        needCueDelayFallback,
        showingTracks: showingTracks.length,
        subtitleTracks: subtitleTracks.length,
        playerRefreshState
      };
    } catch {}
  };

  const resetSettings = () => {
    const fallback = getDefaultSettingsFromJellyfin();

    settings.sizePercent = fallback.sizePercent || DEFAULT_SETTINGS.sizePercent;
    settings.color = fallback.color || DEFAULT_SETTINGS.color;
    settings.colorOpacity = normalizeColorOpacity(
      fallback.colorOpacity ?? DEFAULT_SETTINGS.colorOpacity
    );
    settings.fontFamily = normalizeFontFamilySelection(
      fallback.fontFamily,
      DEFAULT_SETTINGS.fontFamily
    );
    settings.dropShadow = fallback.dropShadow || DEFAULT_SETTINGS.dropShadow;
    settings.shadowColor = fallback.shadowColor || DEFAULT_SETTINGS.shadowColor;
    settings.shadowOpacity = normalizeShadowOpacity(
      fallback.shadowOpacity ?? DEFAULT_SETTINGS.shadowOpacity
    );
    settings.shadowSize = normalizeShadowSize(
      fallback.shadowSize ?? DEFAULT_SETTINGS.shadowSize
    );
    settings.shadowDirection = normalizeShadowDirection(
      fallback.shadowDirection ?? DEFAULT_SETTINGS.shadowDirection
    );
    settings.backgroundEnabled = normalizeBackgroundEnabled(
      fallback.backgroundEnabled ?? DEFAULT_SETTINGS.backgroundEnabled
    );
    settings.backgroundColor = fallback.backgroundColor || DEFAULT_SETTINGS.backgroundColor;
    settings.backgroundOpacity = normalizeBackgroundOpacity(
      fallback.backgroundOpacity ?? DEFAULT_SETTINGS.backgroundOpacity
    );
    settings.backgroundRadiusPx = normalizeBackgroundRadius(
      fallback.backgroundRadiusPx ?? DEFAULT_SETTINGS.backgroundRadiusPx
    );
    settings.delaySec = DEFAULT_SETTINGS.delaySec;
    settings.position = fallback.position || DEFAULT_SETTINGS.position;

    applyNow();
  };

  const openDialog = () => {
    if (closeDialog) {
      closeDialog();
      closeDialog = null;
    }
    closeDialog = createDialog(settings, applyNow, resetSettings, () => {
      closeDialog = null;
      missingPlaybackTicks = 0;
    });
  };

  const ensureButtons = () => {
    const controlBars = document.querySelectorAll(".videoOsdBottom.videoOsdBottom-maincontrols .buttons");
    controlBars.forEach((bar) => {
      const subtitleBtn = bar.querySelector(".btnSubtitles");
      let btn = bar.querySelector(`.${BTN_CLASS}`);
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = subtitleBtn?.className || "autoSize paper-icon-button-light";
        btn.classList.remove("btnSubtitles", "hide");
        btn.classList.add(BTN_CLASS, "autoSize");
        btn.setAttribute("is", subtitleBtn?.getAttribute("is") || "paper-icon-button-light");
        btn.setAttribute("aria-label", L("subtitleCustomizerOpenButton", "Altyazı ayarları"));
        btn.title = L("subtitleCustomizerOpenButton", "Altyazı ayarları");
        btn.innerHTML = faIconHtml("sliders", "xlargePaperIconButton jms-subtitle-icon");
        btn.addEventListener("click", openDialog);

        if (subtitleBtn?.parentElement === bar) {
          subtitleBtn.insertAdjacentElement("afterend", btn);
        } else {
          const audioBtn = bar.querySelector(".btnAudio");
          if (audioBtn?.parentElement === bar) {
            audioBtn.insertAdjacentElement("beforebegin", btn);
          } else {
            bar.appendChild(btn);
          }
        }
      }
      const hidden = !!subtitleBtn?.classList?.contains("hide");
      btn.classList.toggle("hide", hidden);
    });
  };

  applyNow();
  ensureButtons();

  observer = new MutationObserver(() => {
    ensureButtons();
    applyOverlayStyles(settings);
    applyComplexSubtitleStyles(settings);
    maybeAutoCloseDialog();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  intervalId = window.setInterval(() => {
    ensureButtons();
    applyNow();
    maybeAutoCloseDialog();
  }, 700);

  const passiveApply = () => applyNow();
  document.addEventListener("play", passiveApply, true);
  document.addEventListener("loadedmetadata", passiveApply, true);
  document.addEventListener("cuechange", passiveApply, true);
  const routeApply = () => maybeAutoCloseDialog();
  window.addEventListener("hashchange", routeApply, true);
  window.addEventListener("popstate", routeApply, true);

  const destroy = () => {
    try {
      observer?.disconnect();
    } catch {}
    observer = null;

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    try {
      closeDialog?.();
    } catch {}
    closeDialog = null;
    setSubtitleDialogOpenState(false);
    try { delete window.__jmsSubtitleCustomizerState; } catch {}
    unpatchAllPlayerSubtitleAppearance();

    document.removeEventListener("play", passiveApply, true);
    document.removeEventListener("loadedmetadata", passiveApply, true);
    document.removeEventListener("cuechange", passiveApply, true);
    window.removeEventListener("hashchange", routeApply, true);
    window.removeEventListener("popstate", routeApply, true);

    document.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => btn.remove());
    window.__jmsSubtitleCustomizer = { active: false, destroy: null };
  };

  window.__jmsSubtitleCustomizer = { active: true, destroy };
  return destroy;
}
