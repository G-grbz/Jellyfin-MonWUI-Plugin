import { bindCheckboxKontrol, createCheckbox, createSection } from "../settings.js";

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

    const autoRemoveFavoriteCheckbox = createCheckbox(
        "watchlistAutoRemovePlayedFromFavorites",
        labels.watchlistAutoRemovePlayedFromFavorites || "Otomatik kaldırırken Jellyfin favorilerinden de çıkar",
        config.watchlistAutoRemovePlayedFromFavorites
    );
    autoRemoveFavoriteCheckbox.classList.add("watchlist-auto-remove-favorite-container");
    section.appendChild(autoRemoveFavoriteCheckbox);

    bindCheckboxKontrol("#watchlistAutoRemovePlayed", ".watchlist-auto-remove-favorite-container", 0.6);

    panel.appendChild(section);
    return panel;
}
