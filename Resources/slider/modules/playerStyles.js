import { getConfig } from "./config.js";
import { resolveSliderAssetHref } from "./assetLinks.js";

export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export const isPlayerCssMobileDevice = isMobileDevice;

export function loadCSS() {
  const { playerTheme: theme = "dark", playerStyle = "player" } = getConfig();
  const expected = new Map([
    ["base", resolveSliderAssetHref(`/slider/src/${playerStyle}-${theme}.css`)],
    ["settings", resolveSliderAssetHref("/slider/src/settings.css")],
  ]);

  document.documentElement?.setAttribute?.("data-jellyfin-player-theme", theme);
  document.documentElement?.setAttribute?.("data-jellyfin-player-style", playerStyle);
  document.body?.setAttribute?.("data-jellyfin-player-theme", theme);
  document.body?.setAttribute?.("data-jellyfin-player-style", playerStyle);

  if (isPlayerCssMobileDevice()) {
    expected.set("fullscreen", resolveSliderAssetHref("/slider/src/fullscreen.css"));
  }

  expected.forEach((href, key) => {
    let link = document.querySelector(`link[data-jellyfin-player-css="${key}"]`);

    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-jellyfin-player-css", key);
      document.head.appendChild(link);
    }

    if (link.href !== href) {
      link.href = href;
    }
  });

  document.querySelectorAll("link[data-jellyfin-player-css]").forEach((link) => {
    if (!expected.has(link.getAttribute("data-jellyfin-player-css"))) {
      link.remove();
    }
  });
}
