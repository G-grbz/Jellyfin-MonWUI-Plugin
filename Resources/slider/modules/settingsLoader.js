import { resolveSliderAssetHref } from "./assetLinks.js";

function normalizeSettingsTab(value) {
  const normalized = String(value || "").trim();
  return normalized || "monwui";
}

function ensureSettingsStylesheet() {
  const href = resolveSliderAssetHref("/slider/src/settings.css");
  let link = document.querySelector('link[data-jmsfusion-settings-shell-css="1"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("data-jmsfusion-settings-shell-css", "1");
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}

async function openLocalSettingsShell(defaultTab = "monwui") {
  const normalizedTab = normalizeSettingsTab(defaultTab);
  ensureSettingsStylesheet();

  const settingsModule = await import("./settingsPage.js");
  const settingsApi = typeof settingsModule?.initSettings === "function"
    ? settingsModule.initSettings(normalizedTab)
    : null;

  settingsApi?.open?.(normalizedTab);
  return settingsApi || {
    open: () => {},
    close: () => {}
  };
}

export async function initSettings(defaultTab = "monwui") {
  const normalizedTab = normalizeSettingsTab(defaultTab);
  return openLocalSettingsShell(normalizedTab);
}

export async function openSettings(defaultTab = "monwui") {
  return initSettings(defaultTab);
}
