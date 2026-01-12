import { getConfig } from "./config.js";
import {
  getSessionInfo, makeApiRequest, getAuthHeader, playNow, fetchItemDetails,
  withServer, getEmbyHeaders, jms
} from "./api.js";
import { initSettings } from './settings.js';
import { loadAvailableDevices, getDeviceIcon, startPlayback, showNotification, hideNotification } from './castModule.js';
import { getProviderUrl } from './utils.js';
import { applyContainerStyles } from './positionUtils.js';

let _menuCloserAttached = false;
function attachGlobalMenuCloser() {
  if (_menuCloserAttached) return;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.main-button-container.open')
      .forEach(cont => {
        if (!cont.contains(e.target)) {
          const bc = cont.querySelector('.button-container');
          if (bc) { bc.classList.remove('visible'); bc.classList.add('hidden'); }
          cont.classList.remove('open');
        }
      });
  }, { passive: true });
  _menuCloserAttached = true;
}
attachGlobalMenuCloser();

export function createButtons(slide, config, UserData, itemId, RemoteTrailers, updatePlayedStatus, updateFavoriteStatus, openTrailerModal, item) {
    const trailers =
      (Array.isArray(RemoteTrailers) && RemoteTrailers.length) ? RemoteTrailers :
      (Array.isArray(item?.RemoteTrailers) && item.RemoteTrailers.length) ? item.RemoteTrailers :
      (Array.isArray(item?.TrailerUrls) && item.TrailerUrls.length) ? item.TrailerUrls :
      [];
    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-button-container';
    applyContainerStyles(mainContainer, 'button');

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container hidden';

    const buttonGradientOverlay = document.createElement('div');
    buttonGradientOverlay.className = 'button-gradient-overlay';

    const mainButton = document.createElement('button');
    mainButton.className = 'main-btn';
    mainButton.innerHTML = `
        <span class="icon-wrapper">
            <i class="fa-solid fa-ellipsis fa-xl"></i>
        </span>
    `;

    const mainButtonContainer = document.createElement('div');
    mainButtonContainer.className = 'btn-container main-btn-container';
    mainButtonContainer.style.position = "relative";
    mainButtonContainer.style.display = "inline-block";

    mainContainer.addEventListener('mouseenter', () => {
        if (!isTouchDevice()) {
            buttonContainer.classList.remove('hidden');
            buttonContainer.classList.add('visible');
        }
    });

    mainContainer.addEventListener('mouseleave', () => {
        if (!isTouchDevice()) {
            buttonContainer.classList.remove('visible');
            buttonContainer.classList.add('hidden');
        }
    });

    mainButton.addEventListener('click', (e) => {
        if (!isTouchDevice()) return;

        e.preventDefault();
        e.stopPropagation();

        const nowOpen = !mainContainer.classList.contains('open');
        if (nowOpen) {
          buttonContainer.classList.remove('hidden');
          buttonContainer.classList.add('visible');
          mainContainer.classList.add('open');
        } else {
          buttonContainer.classList.remove('visible');
          buttonContainer.classList.add('hidden');
          mainContainer.classList.remove('open');
      }
    });

    function isTouchDevice() {
        return (('ontouchstart' in window) ||
               (navigator.maxTouchPoints > 0) ||
               (navigator.msMaxTouchPoints > 0));
    }

    const createButtonWithBackground = (buttonType, iconHtml, text, clickHandler, initialClass = '') => {
    const bgType = config[`${buttonType}BackgroundImageType`] || "backdropUrl";
    let bgImage = "";
    if (bgType !== "none") {
        bgImage = slide.dataset[bgType];
    }

    const btnContainer = document.createElement("div");
    btnContainer.className = "btn-container";
    if (!bgImage) btnContainer.classList.add("no-bg-image");

    if (bgImage) {
        const bgLayer = document.createElement("div");
        bgLayer.className = "button-bg-layer";
        bgLayer.style.backgroundImage = `url(${bgImage})`;
        bgLayer.style.opacity = config.buttonBackgroundOpacity || 0.3;
        bgLayer.style.filter = `blur(${config.buttonBackgroundBlur}px)`;
        btnContainer.appendChild(bgLayer);
    }

    const contentDiv = document.createElement("div");
    contentDiv.className = "btn-content";

    const btn = document.createElement("button");
    btn.className = `${buttonType}-btn ${initialClass}`;
    btn.innerHTML = `
        <span class="icon-wrapper">
            ${iconHtml}
        </span>
    `;

    const textSpan = document.createElement("span");
    textSpan.className = "btn-text";
    textSpan.textContent = text;

    contentDiv.appendChild(btn);
    contentDiv.appendChild(textSpan);
    btnContainer.appendChild(contentDiv);
    if (bgImage) {
        btnContainer.appendChild(buttonGradientOverlay.cloneNode(true));
    }

    if (clickHandler) {
    btnContainer.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clickHandler(event, btn);
    });
}

    return btnContainer;
};

    if (config.showWatchButton) {
    const isResumable = UserData?.PlaybackPositionTicks > 0;

    const watchBtnContainer = createButtonWithBackground(
        "watch",
        '<i class="fa-regular fa-circle-play fa-xl icon"></i>',
        isResumable
            ? config.languageLabels.devamet
            : config.languageLabels.izle,
        async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                await castToCurrentDevice(itemId);
            } catch (error) {
                console.error("Cast işlemi başarısız:", error);
                window.location.href = slide.dataset.detailUrl;
            }
        }
    );
    buttonContainer.appendChild(watchBtnContainer);
}

  if (config.showTrailerButton && trailers.length > 0) {
  const trailer = trailers[0];

  const trailerBtnContainer = createButtonWithBackground(
    "trailer",
    '<i class="fa-solid fa-film fa-xl icon"></i>',
    config.languageLabels.fragman,
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      let isFav = false;
      try {
        const details = await fetchItemDetails(item.Id);
        isFav = Boolean(details.UserData?.IsFavorite);
      } catch (err) {
        console.warn("Favori durumu alınamadı, varsayılan false ile açılıyor", err);
      }
      openTrailerModal(
        (trailer?.Url || trailer?.url),
        (trailer?.Name || trailer?.name || ""),
        item.Name || item.OriginalTitle,
        item.Type,
        isFav,
        item.Id,
        updateFavoriteStatus,
        item.CommunityRating,
        item.CriticRating,
        item.OfficialRating
      );
    }
  );

  buttonContainer.appendChild(trailerBtnContainer);
}

    if (config.showPlayedButton) {
    const isPlayed = UserData && UserData.Played;
    const playedBtnContainer = createButtonWithBackground(
        "played",
        isPlayed ? '<i class="fa-solid fa-check fa-xl" style="color: #FFC107;"></i>' : '<i class="fa-light fa-check fa-xl"></i>',
        isPlayed ? config.languageLabels.izlendi : config.languageLabels.izlenmedi,
        (event, buttonElement) => {
            const iconWrapper = buttonElement.querySelector('.icon-wrapper');
            const textSpan = buttonElement.nextElementSibling;

            if (buttonElement.classList.contains("played")) {
                buttonElement.classList.remove("played");
                iconWrapper.innerHTML = '<i class="fa-light fa-check fa-xl"></i>';
                textSpan.textContent = config.languageLabels.izlenmedi;
                updatePlayedStatus(itemId, false);
            } else {
                buttonElement.classList.add("played");
                iconWrapper.innerHTML = '<i class="fa-solid fa-check fa-xl" style="color: #FFC107;"></i>';
                textSpan.textContent = config.languageLabels.izlendi;
                updatePlayedStatus(itemId, true);
            }
        },
        isPlayed ? "played" : ""
    );
    buttonContainer.appendChild(playedBtnContainer);
}

if (config.showFavoriteButton) {
    const isFavorited = UserData && UserData.IsFavorite;
    const favoriteBtnContainer = createButtonWithBackground(
        "favorite",
        isFavorited ? '<i class="fa-solid fa-heart fa-xl" style="color: #FFC107;"></i>' : '<i class="fa-light fa-heart fa-xl"></i>',
        isFavorited ? config.languageLabels.favorilendi : config.languageLabels.favori,
        (event, buttonElement) => {
            const iconWrapper = buttonElement.querySelector('.icon-wrapper');
            const textSpan = buttonElement.nextElementSibling;

            if (buttonElement.classList.contains("favorited")) {
                buttonElement.classList.remove("favorited");
                iconWrapper.innerHTML = '<i class="fa-light fa-heart fa-xl"></i>';
                textSpan.textContent = config.languageLabels.favori;
                updateFavoriteStatus(itemId, false);
            } else {
                buttonElement.classList.add("favorited");
                iconWrapper.innerHTML = '<i class="fa-solid fa-heart fa-xl" style="color: #FFC107;"></i>';
                textSpan.textContent = config.languageLabels.favorilendi;
                updateFavoriteStatus(itemId, true);
            }
        },
        isFavorited ? "favorited" : ""
    );
    buttonContainer.appendChild(favoriteBtnContainer);
}

    mainButtonContainer.appendChild(mainButton);
    const mainOverlay = buttonGradientOverlay.cloneNode(true);
    mainOverlay.classList.add("exclude-overlay");
    mainButtonContainer.appendChild(mainOverlay);
    mainContainer.appendChild(mainButtonContainer);
    mainContainer.appendChild(buttonContainer);

    return mainContainer;
}

async function castToCurrentDevice(itemId) {
  try {
    const config = getConfig();
    const success = await playNow(itemId);
    if (success) {
      showNotification(config.languageLabels.castbasarili, 'success');
    } else {
      showNotification(config.languageLabels.casthata, 'error');
    }
  } catch (error) {
    console.error('Cast işlemi sırasında hata:', error);
    const config = getConfig();
    showNotification(`${config.languageLabels.casthata}: ${error.message}`, 'error');
  }
}

async function startNowPlayback(itemId, sessionId) {
  try {
    const config = getConfig();
    const playUrl = `/Sessions/${encodeURIComponent(sessionId)}/Playing?playCommand=PlayNow&itemIds=${encodeURIComponent(itemId)}`;

    const response = await fetch(withServer(playUrl), {
      method: "POST",
      headers: getEmbyHeaders({ "Content-Type": "application/json" })
    });

    if (!response.ok) {
      throw new Error(`${config.languageLabels.castoynatmahata}: ${response.statusText}`);
    }

    showNotification(config.languageLabels.castbasarili, 'success');
    return true;
  } catch (error) {
    console.error("Oynatma hatası:", error);
    const config = getConfig();
    showNotification(`${config.languageLabels.castoynatmahata}: ${error.message}`, 'error');
    return false;
  }
}

export function createProviderContainer({ config, ProviderIds, RemoteTrailers, itemId, slide, item } = {}) {
  const trailers =
    (Array.isArray(RemoteTrailers) && RemoteTrailers.length) ? RemoteTrailers :
    (Array.isArray(item?.RemoteTrailers) && item.RemoteTrailers.length) ? item.RemoteTrailers :
    (Array.isArray(item?.TrailerUrls) && item.TrailerUrls.length) ? item.TrailerUrls :
    [];

  const pids = ProviderIds || item?.ProviderIds;
  const container = document.createElement("div");
  container.className = "provider-container";
  applyContainerStyles(container, 'provider');

  const canEnrichLater = Boolean(itemId) && (config.showTrailerIcon || config.showProviderInfo);
  if (!pids && !config.showSettingsLink && !(config.showTrailerIcon && trailers.length) && !config.showCast && !canEnrichLater) {
    return container;
  }

  const allowedProviders = ["Imdb", "Tmdb", "Tvdb"];
  const providerDiv = document.createElement("div");
  providerDiv.className = "providericons-container";
  applyContainerStyles(providerDiv, 'providericons');

  const ensureProviderDivMounted = () => {
    if (!container.contains(providerDiv)) container.appendChild(providerDiv);
  };

  const addTrailerIcon = (url) => {
    if (!url) return;
    if (providerDiv.querySelector(".provider-link.youtube")) return;
    const trailerLink = document.createElement("span");
    trailerLink.innerHTML = `<i class="fa-brands fa-youtube"></i>`;
    trailerLink.className = "provider-link youtube";
    trailerLink.title = `${config.languageLabels.youtubetrailer}`;
    trailerLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(url, "_blank");
    });
    providerDiv.appendChild(trailerLink);
    ensureProviderDivMounted();
  };

  const addProviderIcons = (providerIds) => {
    if (!providerIds) return;
    allowedProviders.forEach(provider => {
      if (!config.showProviderInfo || !providerIds[provider]) return;
      const cls = `.provider-link.${provider.toLowerCase()}`;
      if (providerDiv.querySelector(cls)) return;

      const link = document.createElement("span");
      if (provider === "Imdb") {
        link.innerHTML = `<img src="./slider/src/images/imdb.svg" alt="IMDb">`;
        link.className = "provider-link imdb";
      } else if (provider === "Tmdb") {
        link.innerHTML = `<img src="./slider/src/images/tmdb.svg" alt="TMDb">`;
        link.className = "provider-link tmdb";
      } else {
        link.innerHTML = `<img src="./slider/src/images/tvdb.svg" alt="TVDb">`;
        link.className = "provider-link tvdb";
      }
      link.title = `${provider} Profiline Git`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const url = getProviderUrl(provider, providerIds[provider], providerIds["TvdbSlug"]);
        window.open(url, "_blank");
      });
      providerDiv.appendChild(link);
      ensureProviderDivMounted();
    });
  };

  if (config.showSettingsLink) {
    const settingsLink = document.createElement("span");
    settingsLink.innerHTML = `<i class="fa-solid fa-sliders"></i>`;
    settingsLink.className = "provider-link settings";
    settingsLink.title = `${config.languageLabels.settingsLink}`;
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      const settings = initSettings();
      settings.open('slider');
    });
    providerDiv.appendChild(settingsLink);
    ensureProviderDivMounted();
  }

 if (config.showCast) {
    const castContainer = document.createElement("div");
    castContainer.className = "cast-container provider-link";

    const deviceSelectorContainer = document.createElement("div");
    deviceSelectorContainer.className = "device-selector-top-container";

    const deviceIcon = document.createElement("div");
    deviceIcon.className = "device-selector-top-icon";
    deviceIcon.innerHTML = `<i class="fa-regular fa-screencast"></i>`;
    deviceIcon.title = config.languageLabels.castoynat;

    const deviceDropdown = document.createElement("div");
    deviceDropdown.className = "device-selector-top-dropdown hide";

    deviceIcon.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (deviceDropdown.classList.contains('hide')) {
        await loadAvailableDevices(itemId, deviceDropdown);

        deviceDropdown.classList.remove('hide');
        deviceDropdown.classList.add('show');

        setTimeout(() => {
          const closeHandler = (e) => {
            if (!castContainer.contains(e.target)) {
              deviceDropdown.classList.remove('show');
              deviceDropdown.classList.add('hide');
              document.removeEventListener('click', closeHandler);
            }
          };
          document.addEventListener('click', closeHandler);
        }, 0);
      } else {
        deviceDropdown.classList.add('hide');
      }
    });

    deviceSelectorContainer.appendChild(deviceIcon);
    deviceSelectorContainer.appendChild(deviceDropdown);
    castContainer.appendChild(deviceSelectorContainer);
    providerDiv.appendChild(castContainer);
    ensureProviderDivMounted();
  }

  if (config.showTrailerIcon && trailers.length > 0) {
    addTrailerIcon(trailers[0]?.Url || trailers[0]?.url);
  }

  if (pids) addProviderIcons(pids);

  if (itemId && (config.showTrailerIcon || config.showProviderInfo) && (!trailers.length || !pids)) {
    (async () => {
      try {
        const details = await fetchItemDetails(itemId);
        const dTrailers = (details?.RemoteTrailers?.length ? details.RemoteTrailers :
                          details?.TrailerUrls?.length ? details.TrailerUrls : []);
        const dPids = details?.ProviderIds;

        if (config.showTrailerIcon && !trailers.length && dTrailers.length) {
          addTrailerIcon(dTrailers[0]?.Url || dTrailers[0]?.url);
        }
        if (config.showProviderInfo && !pids && dPids) {
          addProviderIcons(dPids);
        }
      } catch (e) {
        console.warn("Provider/Trailer enrich başarısız:", e);
      }
    })();
  }

  return container;
}
