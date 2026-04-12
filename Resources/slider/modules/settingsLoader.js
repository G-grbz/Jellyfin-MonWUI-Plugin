let settingsModulePromise = null;

function loadSettingsModule() {
  return settingsModulePromise || (settingsModulePromise = import("./settings.js"));
}

export async function initSettings(defaultTab = "monwui") {
  const { initSettings: initSettingsInner } = await loadSettingsModule();
  return initSettingsInner(defaultTab);
}

export async function openSettings(defaultTab = "monwui") {
  const settings = await initSettings(defaultTab);
  settings?.open?.(defaultTab);
  return settings;
}
