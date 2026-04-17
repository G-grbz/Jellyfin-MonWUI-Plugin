import { getConfig } from "../config.js";
import { createCheckbox, createSection, createImageTypeSelect, bindCheckboxKontrol } from "./shared.js";
import { applySettings } from "./applySettings.js";

export function createButtonsPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'buttons-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.buttons || 'Buton Ayarları');

    const trailerButtonDiv = document.createElement('div');
    trailerButtonDiv.appendChild(createCheckbox('showTrailerButton', labels.showTrailerButton || 'Fragman Butonunu Göster', config.showTrailerButton));
    section.appendChild(trailerButtonDiv);

    const trailerBgDiv = document.createElement('div');
    trailerBgDiv.className = 'setting-item trailer-bg-container';
    const trailerBgLabel = document.createElement('label');
    trailerBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const trailerBgSelect = createImageTypeSelect('trailerBackgroundImageType', config.trailerBackgroundImageType || 'backdropUrl', true);
    trailerBgLabel.htmlFor = 'trailerBgSelect';
    trailerBgSelect.id = 'trailerBgSelect';
    trailerBgDiv.append(trailerBgLabel, trailerBgSelect);
    section.appendChild(trailerBgDiv);

    bindCheckboxKontrol('#showTrailerButton', '.trailer-bg-container', 0.6, [trailerBgSelect]);

    const watchButtonDiv = document.createElement('div');
    watchButtonDiv.appendChild(createCheckbox('showWatchButton', labels.showWatchButton || 'İzle Butonunu Göster', config.showWatchButton));
    section.appendChild(watchButtonDiv);

    const watchBgDiv = document.createElement('div');
    watchBgDiv.className = 'setting-item watch-bg-container';
    const watchBgLabel = document.createElement('label');
    watchBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const watchBgSelect = createImageTypeSelect('watchBackgroundImageType', config.watchBackgroundImageType || 'backdropUrl', true);
    watchBgLabel.htmlFor = 'watchBgSelect';
    watchBgSelect.id = 'watchBgSelect';
    watchBgDiv.append(watchBgLabel, watchBgSelect);
    section.appendChild(watchBgDiv);

    bindCheckboxKontrol('#showWatchButton', '.watch-bg-container', 0.6, [watchBgSelect]);

    const favoriteButtonDiv = document.createElement('div');
    favoriteButtonDiv.appendChild(createCheckbox('showFavoriteButton', labels.showFavoriteButton || 'Favori Butonunu Göster', config.showFavoriteButton));
    section.appendChild(favoriteButtonDiv);

    const favoriBgDiv = document.createElement('div');
    favoriBgDiv.className = 'setting-item favorite-bg-container';
    const favoriBgLabel = document.createElement('label');
    favoriBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const favoriBgSelect = createImageTypeSelect('favoriteBackgroundImageType', config.favoriteBackgroundImageType || 'backdropUrl', true);
    favoriBgLabel.htmlFor = 'favoriBgSelect';
    favoriBgSelect.id = 'favoriBgSelect';
    favoriBgDiv.append(favoriBgLabel, favoriBgSelect);
    section.appendChild(favoriBgDiv);

    bindCheckboxKontrol('#showFavoriteButton', '.favorite-bg-container', 0.6, [favoriBgSelect]);

    const playedButtonDiv = document.createElement('div');
    playedButtonDiv.appendChild(createCheckbox('showPlayedButton', labels.showPlayedButton || 'İzlenme Durumu Kontrol Butonunu Göster', config.showPlayedButton));
    section.appendChild(playedButtonDiv);

    const playedBgDiv = document.createElement('div');
    playedBgDiv.className = 'setting-item played-bg-container';
    const playedBgLabel = document.createElement('label');
    playedBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const playedBgSelect = createImageTypeSelect('playedBackgroundImageType', config.playedBackgroundImageType || 'backdropUrl', true);
    playedBgLabel.htmlFor = 'playedBgSelect';
    playedBgSelect.id = 'playedBgSelect';
    playedBgDiv.append(playedBgLabel, playedBgSelect);
    section.appendChild(playedBgDiv);

    bindCheckboxKontrol('#showPlayedButton', '.played-bg-container', 0.6, [playedBgSelect]);

    const buttonOpacityDiv = document.createElement('div');
    buttonOpacityDiv.className = 'setting-item';
    const buttonOpacityLabel = document.createElement('label');
    buttonOpacityLabel.textContent = labels.backgroundOpacity || 'Buton Arka Plan Şeffaflığı:';
    const buttonOpacityInput = document.createElement('input');
    buttonOpacityInput.type = 'range';
    buttonOpacityInput.min = '0.3';
    buttonOpacityInput.max = '1';
    buttonOpacityInput.step = '0.1';
    buttonOpacityInput.name = 'buttonOpacity';
    buttonOpacityInput.id = 'buttonOpacity';
    buttonOpacityInput.value = config.buttonBackgroundOpacity ?? 0.5;
    buttonOpacityInput.name = 'buttonBackgroundOpacity';
    const buttonOpacityValue = document.createElement('span');
    buttonOpacityValue.className = 'range-value';
    buttonOpacityValue.textContent = buttonOpacityInput.value;
    buttonOpacityInput.addEventListener('input', () => {
        buttonOpacityValue.textContent = buttonOpacityInput.value;
    });
    buttonOpacityLabel.htmlFor = 'buttonOpacityInput';
    buttonOpacityInput.id = 'buttonOpacityInput';
    buttonOpacityDiv.append(buttonOpacityLabel, buttonOpacityInput, buttonOpacityValue);
    section.appendChild(buttonOpacityDiv);

    const buttonblurDiv = document.createElement('div');
    buttonblurDiv.className = 'setting-item';

    const buttonblurLabel = document.createElement('label');
    buttonblurLabel.textContent = labels.backgroundBlur || 'Arka plan bulanıklığı:';
    buttonblurLabel.htmlFor = 'buttonBackgroundBlur';

    const buttonblurInput = document.createElement('input');
    buttonblurInput.type = 'range';
    buttonblurInput.min = '0';
    buttonblurInput.max = '20';
    buttonblurInput.step = '1';
    buttonblurInput.value = config.buttonBackgroundBlur ?? 10;
    buttonblurInput.name = 'buttonBackgroundBlur';
    buttonblurInput.id = 'buttonBackgroundBlur';

    const buttonblurValue = document.createElement('span');
    buttonblurValue.className = 'range-value';
    buttonblurValue.textContent = buttonblurInput.value + 'px';

    buttonblurInput.addEventListener('input', () => {
    buttonblurValue.textContent = buttonblurInput.value + 'px';
    });

    buttonblurDiv.append(buttonblurLabel, buttonblurInput, buttonblurValue);
    section.appendChild(buttonblurDiv);

    panel.appendChild(section);
    return panel;
}
