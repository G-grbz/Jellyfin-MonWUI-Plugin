import { getConfig } from "../../config.js";
import { getLanguageLabels, getDefaultLanguage, getStoredLanguagePreference } from '../../.././language/index.js';
import { enhanceFormAccessibility } from "../../accessibility.js";

export function createSettingsModal() {
    const config = getConfig();
    const currentLang = config.defaultLanguage || getDefaultLanguage();
    const labels = getLanguageLabels(currentLang) || {};
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-modal';
    const modalContent = document.createElement('div');
    modalContent.className = 'settings-modal-content';
    const closeBtn = document.createElement('span');
    closeBtn.className = 'settings-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => modal.style.display = 'none';
    const title = document.createElement('h2');
    title.textContent = labels.ayarlarBaslik || 'GP Oynatıcı Ayarları';
    const form = document.createElement('form');
    const languageDiv = document.createElement('div');
    languageDiv.className = 'setting-item';
    const languageLabel = document.createElement('label');
    languageLabel.textContent = labels.defaultLanguage || 'Dil:';
    const languageSelect = document.createElement('select');
    languageSelect.name = 'defaultLanguage';
    const uiPref = getStoredLanguagePreference() || 'auto';
    const effective = getDefaultLanguage();
    const languages = [
        { value: 'auto', label: labels.optionAuto || '🌐 Otomatik (Tarayıcı dili)' },
        { value: 'tur', label: '🇹🇷 Türkçe' },
        { value: 'eng', label: '🇬🇧 English' },
        { value: 'spa', label: labels.optionEspanol || '🇪🇸 Español' },
        { value: 'deu', label: '🇩🇪 Deutsch' },
        { value: 'fre', label: '🇫🇷 Français' },
        { value: 'rus', label: '🇷🇺 Русский' },
    ];

    languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.value;
        option.textContent = lang.label;
        languageSelect.appendChild(option);
    });

    const selectedLanguage = languages.some(lang => lang.value === uiPref)
        ? uiPref
        : (languages.some(lang => lang.value === effective) ? effective : 'auto');
    languageSelect.value = selectedLanguage;

    languageDiv.append(languageLabel, languageSelect);

    const limitDiv = document.createElement('div');
    limitDiv.className = 'setting-item';

    const limitLabel = document.createElement('label');
    limitLabel.textContent = labels.muziklimit || 'Müzik Limiti:';

    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.value = config.muziklimit || 100;
    limitInput.name = 'muziklimit';

    limitDiv.append(limitLabel, limitInput);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = labels.kaydet || 'Kaydet';
    form.append(languageDiv, limitDiv, saveBtn);
    form.onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const updatedConfig = {
            ...config,
            defaultLanguage: formData.get('defaultLanguage'),
            muziklimit: parseInt(formData.get('muziklimit'))
        };
        updateConfig(updatedConfig);
        modal.style.display = 'none';
        location.reload();
    };
    enhanceFormAccessibility(form, { prefix: "gmmp-settings" });
    modalContent.append(closeBtn, title, form);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    return modal;
}

export function initSettings() {
    const modal = createSettingsModal();

    return {
        open: () => { modal.style.display = 'block'; },
        close: () => { modal.style.display = 'none'; }
    };
}
