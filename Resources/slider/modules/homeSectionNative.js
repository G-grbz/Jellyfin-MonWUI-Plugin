import { waitForAnyVisible } from "./domVisibility.js";

const MANAGED_HOME_SECTION_IDS = new Set([
  "studio-hubs",
  "personal-recommendations",
  "genre-hubs",
  "director-rows",
  "recent-rows",
  "because-you-watched"
]);

export function getActiveHomePageEl() {
  return (
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)")
  );
}

export function isManagedHomeSection(el) {
  if (!el || el.nodeType !== 1) return false;
  const id = String(el.id || "");
  return MANAGED_HOME_SECTION_IDS.has(id) || id.startsWith("because-you-watched--");
}

function getManagedHomeSectionOrder(el) {
  const id = String(el?.id || "");
  if (id === "studio-hubs") return 10;
  if (id === "personal-recommendations") return 20;
  if (id === "recent-rows") return 30;
  if (id === "because-you-watched") return 40;
  if (id.startsWith("because-you-watched--")) {
    const idx = Number(id.split("--")[1]);
    return 41 + (Number.isFinite(idx) ? idx : 0);
  }
  if (id === "genre-hubs") return 70;
  if (id === "director-rows") return 80;
  return 100;
}

function isManagedHomeSectionAboveNative(el) {
  const id = String(el?.id || "");
  return id === "studio-hubs" || id === "personal-recommendations";
}

function getFirstNativeHomeSection(container) {
  if (!container?.children?.length) return null;
  for (const child of Array.from(container.children)) {
    if (!isManagedHomeSection(child)) {
      return child;
    }
  }
  return null;
}

export function getLastNativeHomeSection(container) {
  if (!container?.children?.length) return null;
  let last = null;
  for (const child of Array.from(container.children)) {
    if (!isManagedHomeSection(child)) {
      last = child;
    }
  }
  return last;
}

export function keepManagedSectionsBelowNative(container) {
  if (!container?.children?.length) return;
  const managed = Array.from(container.children).filter(isManagedHomeSection);
  if (!managed.length) return;

  const ordered = managed.sort((a, b) => getManagedHomeSectionOrder(a) - getManagedHomeSectionOrder(b));
  const aboveNative = ordered.filter(isManagedHomeSectionAboveNative);
  const belowNative = ordered.filter((el) => !isManagedHomeSectionAboveNative(el));
  const firstNative = getFirstNativeHomeSection(container);
  const lastNative = getLastNativeHomeSection(container);

  if (!firstNative && !lastNative) {
    let anchor = null;
    for (const section of ordered) {
      if (anchor) {
        if (section.previousElementSibling !== anchor) {
          anchor.insertAdjacentElement("afterend", section);
        }
      } else if (container.firstElementChild !== section) {
        container.insertBefore(section, container.firstElementChild);
      }
      anchor = section;
    }
    return;
  }

  if (firstNative) {
    let refNode = firstNative;
    for (let i = aboveNative.length - 1; i >= 0; i--) {
      const section = aboveNative[i];
      if (section.nextElementSibling !== refNode) {
        container.insertBefore(section, refNode);
      }
      refNode = section;
    }
  }

  let anchor = lastNative || (aboveNative.length ? aboveNative[aboveNative.length - 1] : null);
  for (const section of belowNative) {
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

export async function waitForVisibleHomeSections({ timeout = 12000 } = {}) {
  const visible = await waitForAnyVisible(
    [
      "#indexPage:not(.hide) .homeSectionsContainer",
      "#homePage:not(.hide) .homeSectionsContainer",
      "#indexPage:not(.hide)",
      "#homePage:not(.hide)"
    ],
    { timeout }
  );

  if (!visible) return null;

  const page = getActiveHomePageEl();
  if (!page) return null;

  const container = page.querySelector(".homeSectionsContainer") || page;
  if (!container?.isConnected) return null;

  return { page, container };
}
