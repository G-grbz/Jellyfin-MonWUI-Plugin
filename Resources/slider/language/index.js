import { languageLabels as turLabels } from './tur.js';
import { languageLabels as engLabels } from './eng.js';
import { languageLabels as deuLabels } from './deu.js';
import { languageLabels as fraLabels } from './fre.js';
import { languageLabels as rusLabels } from './rus.js';
import { languageLabels as spaLabels } from './spa.js';

export const AUTO_LANGUAGE_CHANGE_EVENT = 'jms:auto-language-changed';

let __autoLanguageSyncStarted = false;
let __autoLanguageReloadOnChange = false;
let __autoLanguageLastDetected = null;
let __autoLanguagePendingReload = false;
let __autoLanguageReloadScheduled = false;

export function normalizeLanguageCode(lang) {
  const raw = String(lang || '').trim().toLowerCase();
  if (!raw) return 'eng';
  if (raw === 'auto') return detectBrowserLanguage();

  const base = raw.split(/[-_]/)[0];

  if (raw === 'tur' || base === 'tr') return 'tur';
  if (raw === 'eng' || base === 'en') return 'eng';
  if (raw === 'deu' || base === 'de') return 'deu';
  if (raw === 'fre' || raw === 'fra' || base === 'fr') return 'fre';
  if (raw === 'rus' || base === 'ru') return 'rus';
  if (raw === 'spa' || base === 'es') return 'spa';

  return 'eng';
}

export function getLanguageLabels(lang) {
  const effective = normalizeLanguageCode(
    lang || getEffectiveLanguage?.() || detectBrowserLanguage?.() || 'eng'
  );

  switch (effective) {
    case 'eng': return engLabels;
    case 'deu': return deuLabels;
    case 'fre': return fraLabels;
    case 'rus': return rusLabels;
    case 'spa': return spaLabels;
    case 'tur': return turLabels;
    default:    return engLabels;
  }
}

export function detectBrowserLanguage() {
  const candidates = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || navigator.userLanguage || ''];
  for (const raw of candidates) {
    const code = (raw || '').toLowerCase();
    const base = code.split('-')[0];
    if (code.startsWith('tr') || base === 'tr') return 'tur';
    if (code.startsWith('en') || base === 'en') return 'eng';
    if (code.startsWith('de') || base === 'de') return 'deu';
    if (code.startsWith('fr') || base === 'fr') return 'fre';
    if (code.startsWith('ru') || base === 'ru') return 'rus';
    if (code.startsWith('es') || base === 'es') return 'spa';
  }
  return 'eng';
}

export function getStoredLanguagePreference() {
  return localStorage.getItem('defaultLanguage');
}

export function getEffectiveLanguage() {
  const pref = getStoredLanguagePreference();
  if (!pref || pref === 'auto') return detectBrowserLanguage();
  return normalizeLanguageCode(pref);
}

export function getDefaultLanguage() {
  return getEffectiveLanguage();
}

export function setLanguagePreference(value) {
  if (!value || value === 'auto') {
    localStorage.setItem('defaultLanguage', 'auto');
  } else {
    localStorage.setItem('defaultLanguage', value);
  }
}

function isAutomaticLanguagePreference(pref = getStoredLanguagePreference()) {
  return !pref || pref === 'auto';
}

function scheduleAutoLanguageReload() {
  if (
    !__autoLanguageReloadOnChange ||
    __autoLanguageReloadScheduled ||
    typeof window === 'undefined'
  ) {
    return;
  }

  __autoLanguageReloadScheduled = true;
  setTimeout(() => {
    window.location.reload();
  }, 0);
}

function queueAutoLanguageReloadIfNeeded() {
  if (!__autoLanguageReloadOnChange || typeof document === 'undefined') return;

  if (document.visibilityState === 'visible') {
    __autoLanguagePendingReload = false;
    scheduleAutoLanguageReload();
    return;
  }

  __autoLanguagePendingReload = true;
}

function dispatchAutoLanguageChanged(previousLanguage, nextLanguage) {
  if (typeof window === 'undefined') return;

  try {
    window.dispatchEvent(new CustomEvent(AUTO_LANGUAGE_CHANGE_EVENT, {
      detail: {
        preference: 'auto',
        previousLanguage,
        nextLanguage
      }
    }));
  } catch {}
}

function syncAutomaticLanguageState() {
  if (!isAutomaticLanguagePreference()) {
    __autoLanguageLastDetected = null;
    __autoLanguagePendingReload = false;
    return;
  }

  const detectedLanguage = detectBrowserLanguage();
  if (!__autoLanguageLastDetected) {
    __autoLanguageLastDetected = detectedLanguage;
    return;
  }

  if (detectedLanguage === __autoLanguageLastDetected) return;

  const previousLanguage = __autoLanguageLastDetected;
  __autoLanguageLastDetected = detectedLanguage;

  dispatchAutoLanguageChanged(previousLanguage, detectedLanguage);
  queueAutoLanguageReloadIfNeeded();
}

function handleAutoLanguageVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;

  if (__autoLanguagePendingReload) {
    __autoLanguagePendingReload = false;
    scheduleAutoLanguageReload();
    return;
  }

  syncAutomaticLanguageState();
}

export function ensureAutoLanguageSync({ reloadOnChange = false } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  __autoLanguageReloadOnChange = __autoLanguageReloadOnChange || reloadOnChange === true;
  __autoLanguageLastDetected = isAutomaticLanguagePreference()
    ? detectBrowserLanguage()
    : null;

  if (__autoLanguageSyncStarted) return;
  __autoLanguageSyncStarted = true;

  window.addEventListener('languagechange', syncAutomaticLanguageState, { passive: true });
  window.addEventListener('focus', syncAutomaticLanguageState, { passive: true });
  document.addEventListener('visibilitychange', handleAutoLanguageVisibilityChange, { passive: true });
}
