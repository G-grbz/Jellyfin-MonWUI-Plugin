import { createCheckbox, createSection } from "../settings.js";

export function createWatchlistPanel(config, labels) {
    const panel = document.createElement("div");
    panel.id = "watchlist-settings-panel";
    panel.className = "settings-panel";

    const section = createSection(labels.watchlistSettingsTab || "İzleme Listesi Ayarları");

    section.appendChild(
        createCheckbox(
            "watchlistTabsSliderEnabled",
            labels.watchlistTabsSliderEnabled || "İzleme listesi butonunu .emby-tabs-slider içine ekle",
            config.watchlistTabsSliderEnabled
        )
    );

    section.appendChild(
        createCheckbox(
            "watchlistAutoRemovePlayed",
            labels.watchlistAutoRemovePlayed || "İzlenenleri otomatik olarak izleme listesinden kaldır",
            config.watchlistAutoRemovePlayed
        )
    );

    panel.appendChild(section);
    return panel;
}
