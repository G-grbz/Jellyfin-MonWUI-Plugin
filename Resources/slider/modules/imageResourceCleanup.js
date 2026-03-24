const URL_PATTERN = /url\((['"]?)(.*?)\1\)/gi;
const EMPTY_IMAGE_DATA_URI = "data:,";
const DATA_ATTRS = [
  "data-src",
  "data-lazy",
  "data-original",
  "data-image",
  "data-bg",
  "data-backdrop",
  "data-bg-src",
  "data-poster",
  "data-img"
];
const SWEEP_SELECTOR = [
  "img",
  "source",
  "video",
  "[style]",
  "[data-src]",
  "[data-lazy]",
  "[data-original]",
  "[data-image]",
  "[data-bg]",
  "[data-backdrop]",
  "[data-bg-src]",
  "[data-poster]",
  "[data-img]"
].join(",");

function normalizeUrlCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^['"]|['"]$/g, "").trim();
}

function collectStyleUrls(value, urls) {
  const css = String(value || "");
  if (!css) return;
  URL_PATTERN.lastIndex = 0;
  let match = null;
  while ((match = URL_PATTERN.exec(css))) {
    const normalized = normalizeUrlCandidate(match[2]);
    if (normalized) urls.add(normalized);
  }
}

function collectSrcsetUrls(value, urls) {
  const srcset = String(value || "").trim();
  if (!srcset) return;
  srcset
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [candidate] = part.split(/\s+/, 1);
      const normalized = normalizeUrlCandidate(candidate);
      if (normalized) urls.add(normalized);
    });
}

function collectElementUrls(el, urls) {
  if (!el || el.nodeType !== 1) return;

  const style = el.style;
  if (style) {
    collectStyleUrls(style.backgroundImage, urls);
    collectStyleUrls(style.background, urls);
    collectStyleUrls(style.getPropertyValue("--bg-url"), urls);
  }

  const src = normalizeUrlCandidate(el.getAttribute?.("src"));
  const currentSrc = normalizeUrlCandidate(el.currentSrc);
  const poster = normalizeUrlCandidate(el.getAttribute?.("poster"));
  if (src) urls.add(src);
  if (currentSrc) urls.add(currentSrc);
  if (poster) urls.add(poster);

  collectSrcsetUrls(el.getAttribute?.("srcset"), urls);
  collectSrcsetUrls(el.srcset, urls);

  DATA_ATTRS.forEach((attr) => {
    const value = normalizeUrlCandidate(el.getAttribute?.(attr));
    if (value) urls.add(value);
  });
}

function gatherSweepNodes(root) {
  const nodes = new Set();

  if (!root) return nodes;
  if (root.nodeType === 1 || root.nodeType === 11) nodes.add(root);

  if (typeof root.querySelectorAll === "function") {
    root.querySelectorAll(SWEEP_SELECTOR).forEach((node) => nodes.add(node));
  }

  return nodes;
}

function clearElementRefs(el) {
  if (!el || el.nodeType !== 1) return;

  const tagName = String(el.tagName || "").toLowerCase();
  const style = el.style;

  if (style) {
    style.backgroundImage = "none";
    style.removeProperty("--bg-url");
  }

  if (tagName === "img") {
    try { el.onload = null; } catch {}
    try { el.onerror = null; } catch {}
    try { el.removeAttribute("srcset"); } catch {}
    try { el.srcset = ""; } catch {}
    try { el.src = EMPTY_IMAGE_DATA_URI; } catch {}
  } else if (tagName === "source") {
    try { el.removeAttribute("srcset"); } catch {}
    try { el.srcset = ""; } catch {}
    try { el.removeAttribute("src"); } catch {}
  } else if (tagName === "video") {
    try { el.poster = ""; } catch {}
    try { el.removeAttribute("poster"); } catch {}
  }

  DATA_ATTRS.forEach((attr) => {
    try { el.removeAttribute(attr); } catch {}
  });
}

function collectRootUrls(root) {
  const urls = new Set();
  gatherSweepNodes(root).forEach((node) => collectElementUrls(node, urls));
  return urls;
}

function isBlobUrl(value) {
  return typeof value === "string" && value.startsWith("blob:");
}

function elementReferencesUrl(el, url) {
  if (!el || el.nodeType !== 1 || !url) return false;

  const attrValues = [
    el.currentSrc,
    el.getAttribute?.("src"),
    el.getAttribute?.("poster"),
    el.style?.backgroundImage,
    el.style?.background,
    el.style?.getPropertyValue?.("--bg-url"),
    ...DATA_ATTRS.map((attr) => el.getAttribute?.(attr))
  ];

  if (attrValues.some((value) => typeof value === "string" && value.includes(url))) {
    return true;
  }

  const srcsetValues = [el.srcset, el.getAttribute?.("srcset")];
  return srcsetValues.some((value) => typeof value === "string" && value.includes(url));
}

function hasDocumentReference(url) {
  if (!url || typeof document === "undefined") return false;
  const nodes = document.querySelectorAll(SWEEP_SELECTOR);
  for (const node of nodes) {
    if (elementReferencesUrl(node, url)) return true;
  }
  return false;
}

export function revokeBlobUrlIfUnreferenced(url) {
  if (!isBlobUrl(url)) return false;
  if (hasDocumentReference(url)) return false;
  try {
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function cleanupImageResourceRefs(root, { revokeDetachedBlobs = false } = {}) {
  if (!root) return [];

  const urls = Array.from(collectRootUrls(root));
  gatherSweepNodes(root).forEach((node) => clearElementRefs(node));

  if (revokeDetachedBlobs) {
    urls.forEach((url) => revokeBlobUrlIfUnreferenced(url));
  }

  return urls;
}
