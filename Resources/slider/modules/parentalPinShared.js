export const PARENTAL_PIN_THRESHOLDS = [7, 10, 13, 16, 18];

export function normalizeOfficialRatingAge(rawRating) {
  if (!rawRating) return null;

  const rating = String(rawRating)
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (!rating) return null;
  if (/(18\+|R18|ADULT|NC17|XRATED|XXX|ADULTSONLY|AO|TR18|DE18|FSK18)/.test(rating)) return 18;
  if (/(17\+|^R$|TVMA|TR17)/.test(rating)) return 17;
  if (/(16\+|R16|^M$|MATURE|TR16|DE16|FSK16)/.test(rating)) return 16;
  if (/(15\+|TV15|TR15)/.test(rating)) return 15;
  if (/(14\+|TV14)/.test(rating)) return 14;
  if (/(13\+|PG13|TEEN|TR13|DE12A?)/.test(rating)) return 13;
  if (/(12\+|TV12|TR12|DE12|FSK12)/.test(rating)) return 12;
  if (/(11\+|TR11)/.test(rating)) return 11;
  if (/(10\+|TVY10|TR10|E10\+?)/.test(rating)) return 10;
  if (/(9\+|TR9)/.test(rating)) return 9;
  if (/(7\+|TVY7|TR7|DE6|FSK6)/.test(rating)) return 7;
  if (/(TVPG|^PG$|TVG|^G$|EVERYONE|U$|UC|UNIVERSAL|TR6|DE0|FSK0)/.test(rating)) return 7;
  if (/(ALLYEARS|ALLAGES|ALL|TVY|KIDS|^Y$|0\+|TR0|GENEL)/.test(rating)) return 0;

  const match = rating.match(/^(\d{1,2})\+?$/);
  if (!match) return null;

  const age = Number.parseInt(match[1], 10);
  return Number.isFinite(age) ? age : null;
}

export function doesRatingRequirePin(rawRating, threshold) {
  const minAge = Number(threshold || 0);
  if (!(minAge > 0)) return false;

  const ratingAge = normalizeOfficialRatingAge(rawRating);
  return Number.isFinite(ratingAge) && ratingAge > minAge;
}

export function formatThresholdLabel(threshold, labels = {}) {
  const age = Number(threshold || 0);
  return age > 0
    ? `${age}+ ${labels.parentalPinThresholdSuffix || "and above"}`
    : (labels.parentalPinThresholdOff || "Off");
}

export function formatResolvedRating(rawRating) {
  const raw = String(rawRating || "").trim();
  if (!raw) return "";

  const age = normalizeOfficialRatingAge(raw);
  return Number.isFinite(age) ? `${raw} (${age}+)` : raw;
}
