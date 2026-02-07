import { languageLabels as turLabels } from './tur.js';
import { languageLabels as engLabels } from './eng.js';
import { languageLabels as deuLabels } from './deu.js';
import { languageLabels as fraLabels } from './fre.js';
import { languageLabels as rusLabels } from './rus.js';

export function getLanguageLabels(lang) {
  const effective =
    lang || getEffectiveLanguage?.() || detectBrowserLanguage?.() || 'tur';

  switch (effective) {
    case 'eng': return engLabels;
    case 'deu': return deuLabels;
    case 'fre': return fraLabels;
    case 'rus': return rusLabels;
    case 'tur':
    default:    return turLabels;
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
  }
  return 'tur';
}

export function getStoredLanguagePreference() {
  return localStorage.getItem('defaultLanguage');
}

export function getEffectiveLanguage() {
  const pref = getStoredLanguagePreference();
  if (!pref || pref === 'auto') return detectBrowserLanguage();
  return pref;
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
