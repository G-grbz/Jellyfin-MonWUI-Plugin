import { resolveSliderAssetHref } from "./assetLinks.js";
import { getSettingsHotkey, normalizeSettingsHotkey } from "./config.js";

let settingsHotkeyAttached = false;

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

function isEditableTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function shouldHandleSettingsHotkey(event) {
  if (!event || event.defaultPrevented) return false;
  const configuredHotkey = getSettingsHotkey();
  if (!configuredHotkey) return false;
  if (normalizeSettingsHotkey(event.key, "") !== configuredHotkey || event.repeat) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (isEditableTarget(event.target)) return false;
  if (document.getElementById("JMSFusionConfigPage")) return false;
  return true;
}

function attachSettingsHotkey() {
  if (settingsHotkeyAttached || typeof window === "undefined") return;

  window.addEventListener("keydown", (event) => {
    if (!shouldHandleSettingsHotkey(event)) return;
    event.preventDefault();
    void openLocalSettingsShell("monwui");
  });

  settingsHotkeyAttached = true;
}

export async function initSettings(defaultTab = "monwui") {
  const normalizedTab = normalizeSettingsTab(defaultTab);
  return openLocalSettingsShell(normalizedTab);
}

export async function openSettings(defaultTab = "monwui") {
  return initSettings(defaultTab);
}

attachSettingsHotkey();
