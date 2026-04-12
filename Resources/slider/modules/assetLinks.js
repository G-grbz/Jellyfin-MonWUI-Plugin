import { withServer } from "./jfUrl.js";

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value) || value.startsWith("//");
}

export function getJmsAssetVersion() {
  try {
    return String(
      window.__JMS_ASSET_VERSION__ ||
      document.documentElement?.getAttribute?.("data-jms-asset-version") ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

export function appendAssetVersion(pathOrUrl) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return raw;

  const version = getJmsAssetVersion();
  if (!version) return raw;

  try {
    const url = new URL(raw, window.location.href);
    url.searchParams.set("v", version);
    if (isAbsoluteUrl(raw) || raw.startsWith("/")) {
      return url.toString();
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const separator = raw.includes("?") ? "&" : "?";
    return `${raw}${separator}v=${encodeURIComponent(version)}`;
  }
}

export function normalizeSliderAssetPath(pathOrUrl) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw || isAbsoluteUrl(raw)) return raw;
  if (raw.startsWith("/web/slider/")) return raw;
  if (raw.startsWith("/slider/")) return `/web${raw}`;
  if (raw.startsWith("./slider/")) return `/web/${raw.slice(2)}`;
  if (raw.startsWith("slider/")) return `/web/${raw}`;
  return raw;
}

export function resolveSliderAssetHref(pathOrUrl) {
  const normalized = normalizeSliderAssetPath(pathOrUrl);
  if (!normalized) return normalized;
  const resolved = isAbsoluteUrl(normalized) ? normalized : withServer(normalized);
  return appendAssetVersion(resolved);
}
