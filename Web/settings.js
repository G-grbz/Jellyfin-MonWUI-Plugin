function getJfRootFromLocation() {
  try {
    const baseHref = document.querySelector("base[href]")?.getAttribute("href");
    if (baseHref) {
      const url = new URL(baseHref, window.location.href);
      return String(url.pathname || "")
        .replace(/\/web\/?$/i, "")
        .replace(/\/+$/, "");
    }
  } catch {}

  const path = String(window.location.pathname || "/");
  const match = path.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
  return match?.[1] ? match[1].replace(/\/+$/, "") : "";
}

const jfRoot = getJfRootFromLocation();
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
