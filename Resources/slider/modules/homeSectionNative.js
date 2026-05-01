import {
  getConfig,
  isNativeHomeSectionOrderKey,
  normalizeManagedHomeSectionOrder
} from "./config.js";

const MANAGED_HOME_SECTION_IDS = new Set([
  "studio-hubs",
  "personal-recommendations",
  "top10-series-rows",
  "top10-movie-rows",
  "tmdb-top-movie-rows",
  "genre-hubs",
  "director-rows",
  "recent-rows",
  "continue-rows",
  "nextup-rows",
  "because-you-watched"
]);
const MANAGED_HOME_SECTION_PREFIXES = Object.freeze([
  ["because-you-watched--", "becauseYouWatched"],
  ["genre-hubs--", "genreHubs"],
  ["director-rows--", "directorRows"],
  ["recent-rows--", "recentRows"],
  ["continue-rows--", "continueRows"],
  ["nextup-rows--", "nextUpRows"],
  ["top10-series-rows--", "top10SeriesRows"],
  ["top10-movie-rows--", "top10MovieRows"],
  ["tmdb-top-movie-rows--", "tmdbTopMoviesRows"],
]);
const NATIVE_HOME_SECTION_SNAPSHOT_KEY = "jms:managedHomeSectionNativeSnapshot:v1";
const NATIVE_TITLE_SELECTORS = [
  ".sectionTitle",
  ".sectionTitleText",
  ".sectionTitle-cards",
  '[data-role="sectionTitle"]',
  "h1",
  "h2",
  "h3",
  "h4"
];
const GENERIC_NATIVE_LABEL_RE = /^jellyfin row \d+$/i;

export function getActiveHomePageEl() {
  return (
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)")
  );
}

export function isManagedHomeSection(el) {
  if (!el || el.nodeType !== 1) return false;
  const id = String(el.id || "");
  if (MANAGED_HOME_SECTION_IDS.has(id)) return true;
  return MANAGED_HOME_SECTION_PREFIXES.some(([prefix]) => id.startsWith(prefix));
}

function parseManagedHomeSectionPattern(id) {
  const raw = String(id || "");
  for (const [prefix, key] of MANAGED_HOME_SECTION_PREFIXES) {
    if (!raw.startsWith(prefix)) continue;
    const suffix = raw.slice(prefix.length);
    const subOrder = Number(suffix);
    return {
      key,
      subOrder: Number.isFinite(subOrder) ? subOrder : 0
    };
  }
  return null;
}

function getManagedHomeSectionKey(el) {
  const id = String(el?.id || "");
  const pattern = parseManagedHomeSectionPattern(id);
  if (pattern?.key) return pattern.key;
  if (id === "studio-hubs") return "studioHubs";
  if (id === "personal-recommendations") return "personalRecommendations";
  if (id === "top10-series-rows") return "top10SeriesRows";
  if (id === "top10-movie-rows") return "top10MovieRows";
  if (id === "tmdb-top-movie-rows") return "tmdbTopMoviesRows";
  if (id === "recent-rows") return "recentRows";
  if (id === "continue-rows") return "continueRows";
  if (id === "nextup-rows") return "nextUpRows";
  if (id === "genre-hubs") return "genreHubs";
  if (id === "director-rows") return "directorRows";
  if (id === "because-you-watched" || id.startsWith("because-you-watched--")) {
    return "becauseYouWatched";
  }
  return "";
}

function getManagedHomeSectionSortMeta(el) {
  const key = getManagedHomeSectionKey(el);
  const id = String(el?.id || "");

  let subOrder = 0;
  const pattern = parseManagedHomeSectionPattern(id);
  if (pattern) subOrder = pattern.subOrder;

  return {
    key,
    subOrder
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCompareText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugifyNativeHomeSection(value) {
  const slug = normalizeCompareText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function formatNativeHomeSectionOrderLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";

  const clean = raw.replace(/^native:/i, "");
  const withoutCount = clean.replace(/:\d+$/, "");
  const tail = withoutCount.split(":").pop() || withoutCount;
  return tail
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getElementTextCandidate(el) {
  return normalizeText(el?.textContent || "");
}

function getNativeHomeSectionLabel(el) {
  for (const selector of NATIVE_TITLE_SELECTORS) {
    const titleEl = el?.querySelector?.(selector);
    const text = getElementTextCandidate(titleEl);
    if (text) return text;
  }

  const ariaLabel = normalizeText(el?.getAttribute?.("aria-label") || "");
  if (ariaLabel) return ariaLabel;

  const dataTitle = normalizeText(
    el?.dataset?.title ||
    el?.dataset?.sectionTitle ||
    el?.dataset?.titleText ||
    ""
  );
  if (dataTitle) return dataTitle;

  return "";
}

function isGenericNativeHomeSectionLabel(label) {
  return GENERIC_NATIVE_LABEL_RE.test(normalizeText(label));
}

function isHiddenNativeHomeSection(el) {
  if (!el?.isConnected) return true;
  if (el.hidden) return true;
  if (el.getAttribute?.("aria-hidden") === "true") return true;
  if (el.classList?.contains("hide") || el.classList?.contains("hidden")) return true;
  try {
    const style = window.getComputedStyle?.(el);
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function isUsefulNativeHomeSectionEntry(entry) {
  const name = String(entry?.name || "").trim();
  const label = normalizeText(entry?.label || "");
  return !!name && !!label && !isGenericNativeHomeSectionLabel(label) && isNativeHomeSectionOrderKey(name);
}

function inferNativeHomeSectionKind(el, label) {
  const blob = [
    el?.id || "",
    el?.className || "",
    el?.dataset?.type || "",
    el?.dataset?.viewType || "",
    el?.dataset?.section || "",
    label || ""
  ].join(" ");
  const text = normalizeCompareText(blob);

  if (/live[\s-]*tv|canli[\s-]*tv/.test(text)) return "livetv";
  if (/smalllibrary|librarytile|my media|benim medyam|kutuphane|kutuphaneler|libraries/.test(text)) {
    return "smalllibrarytiles";
  }
  if (/next[\s-]*up|siradaki|sonraki/.test(text)) return "nextup";
  if (/resume|continue[\s-]*watching|watching|izlemeye devam|devam ettir/.test(text)) {
    return "resume";
  }
  if (/latest|recent|recently added|newly added|son eklenen|yeni eklenen/.test(text)) {
    return "latestmedia";
  }
  return "";
}

function buildNativeHomeSectionBaseKey(el, label) {
  const kind = inferNativeHomeSectionKind(el, label);
  const slug = slugifyNativeHomeSection(label);
  if (kind && kind === slug) {
    return `native:${kind}`;
  }
  if (kind) {
    return `native:${kind}:${slug}`;
  }
  return `native:${slug}`;
}

function getNativeHomeSectionKindFromKey(name) {
  const raw = String(name || "").trim().replace(/^native:/i, "");
  if (!raw) return "";
  return raw.split(":")[0] || "";
}

function readNativeHomeSectionSnapshot() {
  try {
    const raw = localStorage.getItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        name: String(entry?.name || "").trim(),
        label: normalizeText(entry?.label || "")
      }))
      .filter(isUsefulNativeHomeSectionEntry);
  } catch {
    return [];
  }
}

function persistNativeHomeSectionSnapshot(items = []) {
  const payload = Array.isArray(items)
    ? items
        .map((entry) => ({
          name: String(entry?.name || "").trim(),
          label: normalizeText(entry?.label || "")
        }))
        .filter(isUsefulNativeHomeSectionEntry)
    : [];

  try {
    if (payload.length) {
      localStorage.setItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY, JSON.stringify(payload));
    } else {
      localStorage.removeItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY);
    }
  } catch {}
}

function collectNativeHomeSectionEntries(container) {
  if (!container?.children?.length) return [];

  const snapshotQueues = new Map();
  for (const entry of readNativeHomeSectionSnapshot()) {
    const kind = getNativeHomeSectionKindFromKey(entry.name);
    if (!kind) continue;
    if (!snapshotQueues.has(kind)) {
      snapshotQueues.set(kind, []);
    }
    snapshotQueues.get(kind).push(entry);
  }

  const rawEntries = [];
  for (const child of Array.from(container.children)) {
    if (isManagedHomeSection(child)) continue;
    if (isHiddenNativeHomeSection(child)) continue;
    const label = getNativeHomeSectionLabel(child);
    const inferredKind = inferNativeHomeSectionKind(child, label);
    if (!label || isGenericNativeHomeSectionLabel(label)) {
      if (!inferredKind) continue;
      rawEntries.push({
        element: child,
        generic: true,
        inferredKind
      });
      continue;
    }
    rawEntries.push({
      element: child,
      label,
      generic: false,
      baseName: buildNativeHomeSectionBaseKey(child, label)
    });
  }

  const counts = new Map();
  const reservedNames = new Set();
  return rawEntries.map((entry) => {
    if (entry.generic) {
      const queue = snapshotQueues.get(entry.inferredKind) || [];
      while (queue.length && reservedNames.has(String(queue[0]?.name || "").trim())) {
        queue.shift();
      }
      const snapshotEntry = queue.shift();
      if (snapshotEntry?.name) {
        const snapshotName = String(snapshotEntry.name || "").trim();
        reservedNames.add(snapshotName);
        return {
          element: entry.element,
          name: snapshotName,
          label: normalizeText(snapshotEntry.label || formatNativeHomeSectionOrderLabel(snapshotName))
        };
      }

      const genericBaseName = `native:${entry.inferredKind}`;
      let nextCount = (counts.get(genericBaseName) || 0) + 1;
      let generatedName = nextCount > 1 ? `${genericBaseName}:${nextCount}` : genericBaseName;
      while (reservedNames.has(generatedName)) {
        nextCount++;
        generatedName = `${genericBaseName}:${nextCount}`;
      }
      counts.set(genericBaseName, nextCount);
      reservedNames.add(generatedName);
      return {
        element: entry.element,
        name: generatedName,
        label: formatNativeHomeSectionOrderLabel(generatedName)
      };
    }

    const nextCount = (counts.get(entry.baseName) || 0) + 1;
    let nextName = nextCount > 1 ? `${entry.baseName}:${nextCount}` : entry.baseName;
    let resolvedCount = nextCount;
    while (reservedNames.has(nextName)) {
      resolvedCount++;
      nextName = `${entry.baseName}:${resolvedCount}`;
    }
    counts.set(entry.baseName, resolvedCount);
    reservedNames.add(nextName);
    return {
      element: entry.element,
      name: nextName,
      label: resolvedCount > 1 ? `${entry.label} (${resolvedCount})` : entry.label
    };
  });
}

export function getCachedNativeHomeSectionOrderItems() {
  return readNativeHomeSectionSnapshot();
}

export function getCurrentNativeHomeSectionOrderItems() {
  const page = getActiveHomePageEl();
  const container = page?.querySelector?.(".homeSectionsContainer");
  if (container) {
    const liveItems = collectNativeHomeSectionEntries(container)
      .map(({ name, label }) => ({ name, label }));
    persistNativeHomeSectionSnapshot(liveItems);
    return liveItems;
  }
  return readNativeHomeSectionSnapshot();
}

export function getNativeHomeSectionOrderLabel(name) {
  const key = String(name || "").trim();
  if (!isNativeHomeSectionOrderKey(key)) return "";

  const cached = getCurrentNativeHomeSectionOrderItems()
    .find((entry) => String(entry?.name || "").trim() === key);
  return cached?.label || formatNativeHomeSectionOrderLabel(key);
}

export function getLastNativeHomeSection(container) {
  const entries = collectNativeHomeSectionEntries(container);
  return entries[entries.length - 1]?.element || null;
}

function buildContainerOrderMap(container) {
  const nativeEntries = collectNativeHomeSectionEntries(container);
  persistNativeHomeSectionSnapshot(nativeEntries);
  const cachedEntries = readNativeHomeSectionSnapshot();
  const orderNativeEntries = [];
  const seenNativeKeys = new Set();

  for (const entry of [...nativeEntries, ...cachedEntries]) {
    const key = String(entry?.name || "").trim();
    const label = normalizeText(entry?.label || "");
    if (!key || !label || seenNativeKeys.has(key)) continue;
    seenNativeKeys.add(key);
    orderNativeEntries.push({ name: key, label });
  }

  const order = normalizeManagedHomeSectionOrder(
    getConfig?.()?.managedHomeSectionOrder,
    { nativeEntries: orderNativeEntries }
  );
  const orderMap = new Map(order.map((key, index) => [key, index]));
  const nativeByElement = new Map(nativeEntries.map((entry) => [entry.element, entry]));

  return { order, orderMap, nativeByElement };
}

export function keepManagedSectionsBelowNative(container) {
  if (!container?.children?.length) return;

  const { order, orderMap, nativeByElement } = buildContainerOrderMap(container);
  if (!order.length) return;

  const entries = Array.from(container.children).map((child, originalIndex) => {
    if (isManagedHomeSection(child)) {
      const meta = getManagedHomeSectionSortMeta(child);
      const baseOrder = orderMap.has(meta.key)
        ? orderMap.get(meta.key)
        : (order.length + originalIndex);
      return {
        element: child,
        baseOrder,
        subOrder: meta.subOrder,
        originalIndex
      };
    }

    const nativeMeta = nativeByElement.get(child);
    const nativeKey = nativeMeta?.name || "";
    const baseOrder = orderMap.has(nativeKey)
      ? orderMap.get(nativeKey)
      : (order.length + originalIndex);
    return {
      element: child,
      baseOrder,
      subOrder: 0,
      originalIndex
    };
  });

  if (!entries.length) return;

  entries.sort((a, b) => (
    (a.baseOrder - b.baseOrder) ||
    (a.subOrder - b.subOrder) ||
    (a.originalIndex - b.originalIndex)
  ));

  let anchor = null;
  for (const entry of entries) {
    const section = entry.element;
    if (anchor) {
      if (section.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement("afterend", section);
      }
    } else if (container.firstElementChild !== section) {
      container.insertBefore(section, container.firstElementChild);
    }
    anchor = section;
  }
}

export function bindManagedSectionsBelowNative(container) {
  if (!container || container.__jmsManagedBelowNativeBound) {
    container?.__jmsManagedBelowNativeSchedule?.();
    return;
  }

  let rafId = 0;
  const schedule = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      try { keepManagedSectionsBelowNative(container); } catch {}
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length)) {
        schedule();
        break;
      }
    }
  });

  observer.observe(container, { childList: true });
  container.__jmsManagedBelowNativeBound = true;
  container.__jmsManagedBelowNativeObserver = observer;
  container.__jmsManagedBelowNativeSchedule = schedule;
  schedule();
}

export function waitForNativeHomeSectionStability(container, {
  timeoutMs = 1800,
  stableMs = 220,
  minVisibleCount = 1,
} = {}) {
  if (!container?.isConnected) {
    return Promise.resolve();
  }

  const readVisibleNativeCount = () => {
    try {
      return collectNativeHomeSectionEntries(container).length;
    } catch {
      return 0;
    }
  };

  if (typeof MutationObserver !== "function") {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(60, Math.min(timeoutMs | 0, stableMs | 0)));
    });
  }

  return new Promise((resolve) => {
    let done = false;
    let stableTimer = 0;
    let timeoutId = 0;
    let observer = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      resolve();
    };

    const armStableTimer = () => {
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      const nativeCount = readVisibleNativeCount();
      const delayMs = nativeCount >= Math.max(0, minVisibleCount | 0)
        ? Math.max(80, stableMs | 0)
        : Math.max(240, Math.min(520, Math.max(stableMs | 0, 420)));
      stableTimer = window.setTimeout(finish, delayMs);
    };

    observer = new MutationObserver(() => {
      armStableTimer();
    });

    try {
      observer.observe(container, {
        childList: true,
      });
    } catch {
      observer = null;
      finish();
      return;
    }

    timeoutId = window.setTimeout(finish, Math.max(120, timeoutMs | 0));
    armStableTimer();
  });
}

export async function waitForVisibleHomeSections({ timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(0, timeout | 0);

    const check = () => {
      const page = getActiveHomePageEl();
      if (!page?.isConnected) return false;

      const container = page.querySelector(".homeSectionsContainer");
      if (!container?.isConnected) return false;

      cleanup();
      resolve({ page, container });
      return true;
    };

    const observer = new MutationObserver(() => {
      check();
    });

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeoutId);
      try { observer.disconnect(); } catch {}
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    check();
  });
}
