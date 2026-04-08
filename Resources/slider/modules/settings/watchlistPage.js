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

    const importFavoritesCheckbox = createCheckbox(
        "watchlistImportFavoritesOnStartup",
        labels.watchlistImportFavoritesOnStartup || "Açılışta mevcut Jellyfin favorilerini izleme listesine aktar",
        config.watchlistImportFavoritesOnStartup
    );

    importFavoritesCheckbox.classList.add("watchlist-import-favorites-container");

    const importFavoritesDescription = document.createElement("div");
    importFavoritesDescription.className = "description-text";
    importFavoritesDescription.textContent = labels.watchlistImportFavoritesOnStartupDescription
        || "İlk kurulumda veya favorilerinizi içe aktarmak istediğinizde etkinleştirin. İçe aktarma tamamlandıktan sonra açık kalmasına gerek yoktur.";

    const importFavoritesWrapper = document.createElement("div");
    importFavoritesWrapper.className = "watchlist-import-wrapper";

    importFavoritesWrapper.appendChild(importFavoritesCheckbox);
    importFavoritesWrapper.appendChild(importFavoritesDescription);

    section.appendChild(importFavoritesWrapper);

    bindCheckboxKontrol("#watchlistAutoRemovePlayed", ".watchlist-auto-remove-favorite-container", 0.6);

    bindCheckboxKontrol(
        "#watchlistImportFavoritesOnStartup",
        ".watchlist-import-wrapper .description-text",
        0.5
    );

    panel.appendChild(section);
    return panel;
}
