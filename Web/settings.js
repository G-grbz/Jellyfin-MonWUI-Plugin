const path = window.location.pathname || "/";
const split = path.split("/web/");
const jfRoot = split.length > 1 ? split[0] : "";
const settingsPageModuleUrl = `${window.location.origin}${jfRoot}/slider/modules/settingsPage.js`;

async function loadSettingsPageModule() {
  return import(settingsPageModuleUrl);
}

export async function mountMonwuiSettingsPage(host, options = {}) {
  const mod = await loadSettingsPageModule();
  if (typeof mod?.mountMonwuiSettingsPage !== "function") {
    throw new Error("MonWUI settings page module is not available.");
  }
  return mod.mountMonwuiSettingsPage(host, options);
}
