import { getConfig, publishAdminSnapshotIfForced, getAdminTargetProfile, getDeviceProfileAuto, getSettingsHotkey, normalizeSettingsHotkey, SETTINGS_HOTKEY_DEFAULT } from "./config.js";
import { isLocalStorageAvailable, updateConfig } from "./configPersistence.js";
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { loadCSS } from "./playerStyles.js";
import { showNotification } from "./player/ui/notification.js";
import { createPositionEditor } from './settings/positionPage.js';
import { updateSlidePosition } from './positionUtils.js';
import { createBackupRestoreButtons } from './configExporter.js';
import { applyRawConfig, applySettings } from './settings/applySettings.js';
import { createSliderPanel } from './settings/sliderPage.js';
import { createAnimationPanel } from './settings/animationsPage.js';
import { createMusicPanel } from './settings/musicPage.js';
import { createStatusRatingPanel, createActorPanel, createDirectorPanel, createInfoPanel, createLogoTitlePanel, createAboutPanel, createProviderPanel, createDescriptionPanel } from './settings/otherPage.js';
import { createQueryPanel } from './settings/apiPage.js';
import { createPausePanel } from './settings/pausePage.js';
import { createButtonsPanel } from './settings/buttonsPage.js';
import { createAvatarPanel } from './settings/avatarPage.js';
import { createNotificationsPanel } from './settings/notificationsPage.js';
import { createStudioHubsPanel } from './settings/studioHubsPage.js';
import { createHoverTrailerPanel } from './settings/hoverTrailerPage.js';
import { createTrailersPanel } from './settings/trailersPage.js';
import { createProfileChooserPanel } from './settings/profileChooserPage.js';
import { createWatchlistPanel } from './settings/watchlistPage.js';
import { createParentalPinPanel } from './settings/parentalPinPage.js';
import { createDbManagementPanel } from './settings/dbManagementPage.js';
import { createDetailsModalPanel } from './settings/detailsModalPage.js';
import { enhanceFormAccessibility } from './accessibility.js';

export { isLocalStorageAvailable, updateConfig };

let settingsModal = null;
const SETTINGS_OVERLAY_CLASS = 'jms-settings-overlay-shell';
const SETTINGS_EMBEDDED_CLASS = 'jms-settings-page-shell';

export function createSettingsModal() {
    if (settingsModal?.isConnected) {
        return settingsModal;
    }

    const existing = document.getElementById('settings-modal');
    if (existing) {
        settingsModal = existing;
        return existing;
    }

    if (settingsModal) {
        return settingsModal;
    }

    const config = getConfig();
    const currentLang = config.defaultLanguage || getDefaultLanguage();
    const labels = getLanguageLabels(currentLang) || {};
    const monwuiTabLabel = labels.sliderSettings || 'MonWUI Ayarları';
    const sliderTabLabel = labels.sliderPageLabel || 'Slider Ayarları';

    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = `settings-modal ${SETTINGS_EMBEDDED_CLASS}`;
    modal.setAttribute('data-jms-settings-page', 'true');

    const modalContent = document.createElement('div');
    modalContent.className = 'settings-modal-content';

    const title = document.createElement('h2');
    title.textContent = monwuiTabLabel;

    function createProfileSelector(labels) {
      const wrap = document.createElement("div");
      wrap.className = "setting-item";
      wrap.style.marginBottom = "10px";

      const lab = document.createElement("label");
      lab.textContent = labels?.profileTarget || "Ayar Profili";
      lab.style.marginRight = "10px";
      lab.htmlFor = "jmsProfileTarget";

      const select = document.createElement("select");
      select.id = "jmsProfileTarget";
      select.name = "jmsProfileTarget";

      const autoProfile = getDeviceProfileAuto();
      const profileNameMap = {
        desktop: labels?.profileDesktop || "Masaüstü Profil",
        mobile: labels?.profileMobile || "Mobil Profil"
      };

      const autoProfileLabel =
        profileNameMap[autoProfile] || (labels?.profileAutoUnknown || autoProfile);

      const opts = [
        {
          v: "auto",
          t: `${labels?.profileAuto || "Otomatik Seç"} (${autoProfileLabel})`
        },
        { v: "desktop", t: labels?.profileDesktop || "Masaüstü Profil" },
        { v: "mobile", t: labels?.profileMobile || "Mobil Profil" }
      ];

      opts.forEach(o => {
        const opt = document.createElement("option");
        opt.value = o.v;
        opt.textContent = o.t;
        select.appendChild(opt);
      });

      select.value = localStorage.getItem("jms:settingsTargetProfile") || "auto";

      select.addEventListener("change", () => {
        localStorage.setItem("jms:settingsTargetProfile", select.value);
        showNotification(
          `<i class="fas fa-layer-group" style="margin-right:8px;"></i> ${
            labels?.profileChanged || "Profil seçildi. Kaydettiğinde bu profile publish edilecek."
          }`,
          2500,
          "info"
        );
      });

      wrap.append(lab, select);
      return wrap;
    }

    if (config?.currentUserIsAdmin) {
      try {
        const profSel = createProfileSelector(labels);
        modalContent.appendChild(profSel);
      } catch {}
    }

    if (config?.currentUserIsAdmin && config?.forceGlobalUserSettings) {
      const forcedHint = document.createElement('div');
      forcedHint.className = 'description-text2';
      forcedHint.style.margin = '0 0 12px';
      forcedHint.textContent =
        labels?.forceGlobalAdminHint ||
        'Genel Kullanıcı Ayarlarını Zorla aktif. Kaydet/Uygula seçili ayar profilini tum kullanicilar icin global publish eder.';
      modalContent.appendChild(forcedHint);
    }

    const tabContainer = document.createElement('div');
    tabContainer.className = 'settings-tabs';

    const tabContent = document.createElement('div');
    tabContent.className = 'settings-tab-content';

    const mainTab = createTab('monwui', 'fa-sliders', monwuiTabLabel, true);
    const sliderTab = createTab('slider', 'fa-gear', sliderTabLabel, false);
    const queryTab = createTab('query', 'fa-code', labels.queryStringInput || 'Api Sorgu Ayarları');
    const musicTab = createTab('music', 'fa-music', labels.gmmpSettings || 'GMMP Ayarları');
    const studioTab = createTab('studio', 'fa-building', labels.studioHubsSettings || 'Stüdyo Koleksiyonları Ayarları');
    const profileChooserTab = createTab('profile-chooser', 'fa-user-group', labels.profileChooserHeader || 'Kim İzliyor Ayarları');
    const pauseTab = createTab('pause', 'fa-pause', labels.pauseSettings || 'Duraklatma Ekranı Ayarları');
    const watchlistSettingsTab = createTab('watchlist-settings', 'fa-bookmark', labels.watchlistSettingsTab || 'İzleme Listesi Ayarları');
    const hoverTab = createTab('hover', 'fa-play-circle', labels.hoverTrailer || 'HoverTrailer Ayarları');
    const trailersTab = createTab('trailers', 'fa-video', labels.trailersHeader || 'Fragman İndirme / NFO Ayarları');
    const notificationsTab = createTab('notifications', 'fa-bell', labels.notificationsSettings || 'Bildirim Ayarları');
    const detailsModalTab = createTab('details-modal', 'fa-circle-info', labels.detailsModalSettingsTab || 'Detaylar Modülü Ayarları');
    const avatarTab = createTab('avatar', 'fa-user', labels.avatarCreateInput || 'Avatar Ayarları');
    const parentalPinTab = config?.currentUserIsAdmin
      ? createTab('parental-pin', 'fa-key', labels.parentalPinTab || 'PIN Kontrolü Ayarları')
      : null;
    const positionTab = createTab('position', 'fa-arrows-up-down-left-right', labels.positionSettings || 'Konumlandırma Ayarları');
    const dbManagementTab = createTab('db-management', 'fa-database', labels.dbManagementTab || 'DB Yönetimi');
    const exporterTab = createTab('exporter', 'fa-download', labels.backupRestore || 'Yedekle ve Geri Yükle');
    const aboutTab = createTab('about', 'fa-circle-info', labels.aboutHeader || 'Hakkında');

    const tabs = [
        mainTab, sliderTab, queryTab, musicTab, studioTab, profileChooserTab,
        pauseTab, watchlistSettingsTab, hoverTab, trailersTab, notificationsTab, detailsModalTab,
        avatarTab, parentalPinTab, positionTab, dbManagementTab, exporterTab, aboutTab
    ].filter(Boolean);
    tabContainer.append(...tabs);

    const sliderPanel = createSliderPanel(config, labels);
    const animationPanel = createAnimationPanel(config, labels);
    const profileChooserPanel = createProfileChooserPanel(config, labels);
    const musicPanel = createMusicPanel(config, labels);
    const pausePanel = createPausePanel(config, labels);
    const positionPanel = createPositionPanel(config, labels);
    const queryPanel = createQueryPanel(config, labels);
    const hoverPanel = createHoverTrailerPanel(config, labels);
    const trailersPanel = createTrailersPanel(config, labels);
    const studioPanel = createStudioHubsPanel(config, labels);
    const avatarPanel = createAvatarPanel(config, labels);
    const statusRatingPanel = createStatusRatingPanel(config, labels);
    const actorPanel = createActorPanel(config, labels);
    const directorPanel = createDirectorPanel(config, labels);
    const languagePanel = createLanguagePanel(config, labels);
    const logoTitlePanel = createLogoTitlePanel(config, labels);
    const descriptionPanel = createDescriptionPanel(config, labels);
    const providerPanel = createProviderPanel(config, labels);
    const buttonsPanel = createButtonsPanel(config, labels);
    const infoPanel = createInfoPanel(config, labels);
    const exporterPanel = createExporterPanel(config, labels);
    const aboutPanel = createAboutPanel(labels);
    const notificationsPanel = createNotificationsPanel(config, labels);
    const detailsModalPanel = createDetailsModalPanel(config, labels);
    const watchlistSettingsPanel = createWatchlistPanel(config, labels);
    const dbManagementPanel = createDbManagementPanel(config, labels);
    const parentalPinPanel = config?.currentUserIsAdmin
      ? createParentalPinPanel(config, labels)
      : null;
    const mainPanel = createMainSettingsPanel(labels, {
        sliderPanel,
        profileChooserPanel,
        musicPanel,
        pausePanel,
        studioPanel,
        hoverPanel,
        avatarPanel,
        notificationsPanel,
        providerPanel
    });

    [
        { panel: infoPanel, title: labels.infoHeader || 'Tür, Yıl ve Ülke Bilgileri' },
        { panel: buttonsPanel, title: labels.buttons || 'Buton Ayarları' },
        { panel: logoTitlePanel, title: labels.logoOrTitleHeader || 'Logo / Başlık Ayarları' },
        { panel: descriptionPanel, title: labels.descriptionsHeader || 'Açıklama Ayarları' },
        { panel: providerPanel, title: labels.providerHeader || 'Dış Bağlantılar / Sağlayıcı Ayarları' },
        { panel: languagePanel, title: labels.languageInfoHeader || 'Ses ve Altyazı Bilgileri' },
        { panel: statusRatingPanel, title: labels.statusRatingInfo || 'Durum, Puanlama ve Kalite Rozeti Ayarları' },
        { panel: actorPanel, title: labels.actorInfo || 'Aktör Gösterim Ayarları' },
        { panel: directorPanel, title: labels.directorWriter || 'Yönetmen ve Yazar Ayarları' },
        { panel: animationPanel, title: labels.animationSettings || 'Animasyon Ayarları' }
    ].forEach(({ panel, title }) => {
        appendMergedPanelToSlider(sliderPanel, panel, title);
    });

    [
        mainPanel, sliderPanel, queryPanel, musicPanel, studioPanel, profileChooserPanel,
        pausePanel, watchlistSettingsPanel, hoverPanel, trailersPanel, notificationsPanel, detailsModalPanel,
        avatarPanel, parentalPinPanel, positionPanel, dbManagementPanel, exporterPanel, aboutPanel
    ].filter(Boolean).forEach(panel => {
        panel.style.display = 'none';
    });
    mainPanel.style.display = 'block';

    const panels = [
        mainPanel, sliderPanel, queryPanel, musicPanel, studioPanel, profileChooserPanel,
        pausePanel, watchlistSettingsPanel, hoverPanel, trailersPanel, notificationsPanel, detailsModalPanel,
        avatarPanel, parentalPinPanel, positionPanel, dbManagementPanel, exporterPanel, aboutPanel
    ].filter(Boolean);
    tabContent.append(...panels);

    const interactiveTabs = [
        mainTab, sliderTab, queryTab, musicTab, studioTab, profileChooserTab,
        pauseTab, watchlistSettingsTab, hoverTab, trailersTab, notificationsTab, detailsModalTab,
        avatarTab, parentalPinTab, positionTab, dbManagementTab, exporterTab, aboutTab
    ].filter(Boolean);
    interactiveTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = tab.getAttribute('data-tab');
            activateSettingsPanel(modal, panelId);

            setTimeout(() => {
                tab.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }, 10);
        });
    });

    const form = document.createElement('form');
    form.append(tabContainer, tabContent);

    const btnDiv = document.createElement('div');
    btnDiv.className = 'btn-item';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = labels.saveSettings || 'Kaydet';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = labels.uygula || 'Uygula';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = labels.resetToDefaults || 'Sıfırla';
    resetBtn.className = 'reset-btn';
    resetBtn.onclick = () => {
        createConfirmationModal(
            labels.resetConfirm || 'Tüm ayarları varsayılan değerlere sıfırlamak istediğinize emin misiniz?',
            resetAllSettings,
            labels
        );
    };

    const saveLabel = saveBtn.textContent;
    const applyLabel = applyBtn.textContent;
    const resetLabel = resetBtn.textContent;
    let settingsActionBusy = false;

    function setBusyState(isBusy) {
      const controls = [saveBtn, applyBtn, resetBtn, themeToggleBtn].filter(Boolean);
      controls.forEach((btn) => {
        if (!btn) return;
        if (isBusy) {
          if (btn.__busyPrevDisabled === undefined) {
            btn.__busyPrevDisabled = btn.disabled;
            btn.__busyPrevPointerEvents = btn.style.pointerEvents;
            btn.__busyPrevOpacity = btn.style.opacity;
          }
          btn.disabled = true;
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.6';
          return;
        }

        if (btn.__busyPrevDisabled !== undefined) {
          btn.disabled = btn.__busyPrevDisabled;
          btn.style.pointerEvents = btn.__busyPrevPointerEvents || '';
          btn.style.opacity = btn.__busyPrevOpacity || '';
          delete btn.__busyPrevDisabled;
          delete btn.__busyPrevPointerEvents;
          delete btn.__busyPrevOpacity;
        }
      });

      saveBtn.textContent = isBusy ? (labels?.saving || 'Kaydediliyor...') : saveLabel;
      applyBtn.textContent = isBusy ? (labels?.applying || 'Uygulaniyor...') : applyLabel;
      resetBtn.textContent = resetLabel;
    }

    async function runSaveAction(reload = false) {
      if (settingsActionBusy) return;
      settingsActionBusy = true;
      setBusyState(true);

      try {
        const panelSaveHooks = [parentalPinPanel?.__jmsSave].filter(fn => typeof fn === 'function');
        for (const saveHook of panelSaveHooks) {
          await saveHook({ reload });
        }

        const result = await applySettings(reload);
        if (reload || result?.ok === false) return result;

        if (result?.forcedAdminPublish && result?.publishResult?.attempted && result?.publishResult?.ok) {
          const profileLabel =
            result?.publishResult?.profile === 'mobile'
              ? (labels?.profileMobile || 'Mobil Profil')
              : (labels?.profileDesktop || 'Masaustu Profil');
          showNotification(
            `<i class="fas fa-globe" style="margin-right: 8px;"></i> ${labels?.forceGlobalPublishOk || `Global ayarlar ${profileLabel} icin yayinlandi.`}`,
            3200,
            'info'
          );
          return result;
        }

        showNotification(
          `<i class="fas fa-floppy-disk" style="margin-right: 8px;"></i> ${config.languageLabels.settingsSavedModal || "Ayarlar kaydedildi. Değişikliklerin aktif olması için slider sayfasını yenileyin."}`,
          3000,
          'info'
        );
        return result;
      } catch (err) {
        console.error('Settings save failed:', err);
        const errText =
          String(err?.message || '').trim() ||
          labels?.settingsSaveFailed ||
          'Ayarlar kaydedilemedi.';
        showNotification(
          `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errText}`,
          4200,
          'error'
        );
        return { ok: false, error: err };
      } finally {
        settingsActionBusy = false;
        setBusyState(false);
      }
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        await runSaveAction(true);
    };

    applyBtn.onclick = async () => {
        await runSaveAction(false);
    };

    btnDiv.append(saveBtn, applyBtn, resetBtn, );
    form.appendChild(btnDiv);

    const themeToggleBtn = document.createElement('button');
    themeToggleBtn.type = 'button';
    themeToggleBtn.className = 'theme-toggle-btn';

function setSettingsThemeToggleVisuals() {
  const cfg = getConfig();
  const currentLang = cfg.defaultLanguage || getDefaultLanguage?.();
  const labels = (typeof getLanguageLabels === 'function' ? getLanguageLabels(currentLang) : {}) || cfg.languageLabels || {};

  themeToggleBtn.innerHTML = `<i class="fas fa-${cfg.playerTheme === 'light' ? 'moon' : 'sun'}"></i>`;
  themeToggleBtn.title = cfg.playerTheme === 'light'
    ? (labels.darkTheme || 'Karanlık Tema')
    : (labels.lightTheme || 'Aydınlık Tema');
}

themeToggleBtn.onclick = async () => {
  if (themeToggleBtn.dataset.busy === '1') return;
  themeToggleBtn.dataset.busy = '1';
  themeToggleBtn.disabled = true;
  const cfg = getConfig();
  const newTheme = cfg.playerTheme === 'light' ? 'dark' : 'light';

  try {
    updateConfig({ ...cfg, playerTheme: newTheme });
    loadCSS();

    const playerThemeBtn = document.querySelector('#modern-music-player .theme-toggle-btn');
    if (playerThemeBtn) {
      playerThemeBtn.innerHTML = `<i class="fas fa-${newTheme === 'light' ? 'moon' : 'sun'}"></i>`;
      const labels = cfg.languageLabels || {};
      playerThemeBtn.title = newTheme === 'light'
        ? (labels.darkTheme || 'Karanlık Tema')
        : (labels.lightTheme || 'Aydınlık Tema');
    }

    setSettingsThemeToggleVisuals();

    const labels = cfg.languageLabels || {};
      showNotification(
        `<i class="fas fa-${newTheme === 'light' ? 'sun' : 'moon'}"></i> ${
          newTheme === 'light'
            ? (labels.lightThemeEnabled || 'Aydınlık tema etkin')
            : (labels.darkThemeEnabled || 'Karanlık tema etkin')
        }`,
        2000,
        'info'
      );
      try {
        window.dispatchEvent(new CustomEvent('app:theme-changed', { detail: { theme: newTheme } }));
        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) themeSelect.value = newTheme;
      } catch {}

    const publishResult = await publishAdminSnapshotIfForced();
    if (cfg?.forceGlobalUserSettings && cfg?.currentUserIsAdmin && publishResult?.attempted && !publishResult?.ok) {
      showNotification(
        `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${labels?.forceGlobalPublishFailed || 'Global kullanıcı ayarları publish edilemedi.'}`,
        4200,
        'error'
      );
    }
  } finally {
    delete themeToggleBtn.dataset.busy;
    themeToggleBtn.disabled = false;
  }
};

    setSettingsThemeToggleVisuals();
    btnDiv.append(themeToggleBtn);

    applyGlobalSettingsLockUI({
      labels,
      saveBtn,
      applyBtn,
      resetBtn,
      themeToggleBtn
    });

    modalContent.append(title, form);
    enhanceFormAccessibility(form, { prefix: 'settings' });
    modal.appendChild(modalContent);


    function resetAllSettings() {
        Object.keys(config).forEach(key => {
            localStorage.removeItem(key);
        });
        location.reload();
    }

     setTimeout(() => {
      setupMobileTextareaBehavior();
    }, 100);

    settingsModal = modal;
    return modal;
}

function setDocumentScrollLocked(lock) {
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;

  if (lock) {
    if (body.dataset.jmsPrevOverflow === undefined) {
      body.dataset.jmsPrevOverflow = body.style.overflow || '';
    }
    if (html.dataset.jmsPrevOverflow === undefined) {
      html.dataset.jmsPrevOverflow = html.style.overflow || '';
    }
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return;
  }

  if (body.dataset.jmsPrevOverflow !== undefined) {
    body.style.overflow = body.dataset.jmsPrevOverflow || '';
    delete body.dataset.jmsPrevOverflow;
  }
  if (html.dataset.jmsPrevOverflow !== undefined) {
    html.style.overflow = html.dataset.jmsPrevOverflow || '';
    delete html.dataset.jmsPrevOverflow;
  }
}

function closeLocalSettingsShell(modal) {
  if (!modal) return;

  if (modal.__overlayEscapeHandler) {
    window.removeEventListener('keydown', modal.__overlayEscapeHandler);
    delete modal.__overlayEscapeHandler;
  }
  if (modal.__overlayClickHandler) {
    modal.removeEventListener('click', modal.__overlayClickHandler);
    delete modal.__overlayClickHandler;
  }

  const modalContent = modal.querySelector('.settings-modal-content');
  if (modalContent?.__overlayStopPropagationHandler) {
    modalContent.removeEventListener('click', modalContent.__overlayStopPropagationHandler);
    delete modalContent.__overlayStopPropagationHandler;
  }

  setDocumentScrollLocked(false);
  modal.remove();

  if (settingsModal === modal) {
    settingsModal = null;
  }
}

function prepareModalForLocalShell(modal) {
  if (!modal) return modal;

  const modalContent = modal.querySelector('.settings-modal-content');
  const title = modalContent?.querySelector('h2');

  modal.classList.add(SETTINGS_OVERLAY_CLASS);
  modal.classList.remove(SETTINGS_EMBEDDED_CLASS);
  modal.removeAttribute('data-jms-settings-page');

  let closeBtn = modalContent?.querySelector('.settings-close');
  if (!closeBtn && modalContent) {
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.innerHTML = '&times;';
    modalContent.insertBefore(closeBtn, modalContent.firstChild);
  }

  if (closeBtn) {
    closeBtn.onclick = () => closeLocalSettingsShell(modal);
  }

  if (!modal.__overlayClickHandler) {
    modal.__overlayClickHandler = (event) => {
      if (event.target === modal) {
        closeLocalSettingsShell(modal);
      }
    };
    modal.addEventListener('click', modal.__overlayClickHandler);
  }

  if (modalContent && !modalContent.__overlayStopPropagationHandler) {
    modalContent.__overlayStopPropagationHandler = (event) => {
      event.stopPropagation();
    };
    modalContent.addEventListener('click', modalContent.__overlayStopPropagationHandler);
  }

  if (!modal.__overlayEscapeHandler) {
    modal.__overlayEscapeHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLocalSettingsShell(modal);
      }
    };
    window.addEventListener('keydown', modal.__overlayEscapeHandler);
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  modal.style.display = 'block';
  setDocumentScrollLocked(true);
  return modal;
}

function prepareModalForEmbeddedPage(modal) {
  if (!modal) return modal;

  const modalContent = modal.querySelector('.settings-modal-content');
  const title = modalContent?.querySelector('h2');

  if (modal.__overlayEscapeHandler) {
    window.removeEventListener('keydown', modal.__overlayEscapeHandler);
    delete modal.__overlayEscapeHandler;
  }
  if (modal.__overlayClickHandler) {
    modal.removeEventListener('click', modal.__overlayClickHandler);
    delete modal.__overlayClickHandler;
  }
  if (modalContent?.__overlayStopPropagationHandler) {
    modalContent.removeEventListener('click', modalContent.__overlayStopPropagationHandler);
    delete modalContent.__overlayStopPropagationHandler;
  }

  setDocumentScrollLocked(false);

  modal.classList.add(SETTINGS_EMBEDDED_CLASS);
  modal.classList.remove(SETTINGS_OVERLAY_CLASS);
  modal.setAttribute('data-jms-settings-page', 'true');
  modal.querySelector('.settings-close')?.remove();

  if (title) {
    title.style.display = 'none';
  }

  modal.style.display = 'block';
  return modal;
}

function activateSettingsPanel(modal, tab = 'monwui') {
    if (!modal) return null;

    const tabs = modal.querySelectorAll('.settings-tab');
    const tabContent = modal.querySelector('.settings-tab-content');
    const panels = tabContent ? Array.from(tabContent.children) : [];
    tabs.forEach(tabElement => tabElement.classList.remove('active'));
    panels.forEach(panel => {
        panel.style.display = 'none';
    });

    const targetTab = modal.querySelector(`.settings-tab[data-tab="${tab}"]`);
    const targetPanel = modal.querySelector(`#${tab}-panel`);

    if (targetTab && targetPanel) {
        targetTab.classList.add('active');
        targetPanel.style.display = 'block';
        if (tabContent) {
            tabContent.scrollTop = 0;
            tabContent.scrollLeft = 0;
        }
        return targetPanel;
    }

    const fallbackTab = modal.querySelector('.settings-tab[data-tab="monwui"]')
        || modal.querySelector('.settings-tab[data-tab="slider"]');
    const fallbackPanel = modal.querySelector('#monwui-panel')
        || modal.querySelector('#slider-panel');

    if (fallbackTab) fallbackTab.classList.add('active');
    if (fallbackPanel) fallbackPanel.style.display = 'block';
    if (tabContent) {
        tabContent.scrollTop = 0;
        tabContent.scrollLeft = 0;
    }
    return fallbackPanel;
}

function createConfirmationModal(message, callback, labels) {
        const modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.style.display = 'block';

        const modalContent = document.createElement('div');
        modalContent.className = 'confirmation-modal-content';

        const messageEl = document.createElement('p');
        messageEl.textContent = message;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'confirmation-btn-container';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn';
        confirmBtn.textContent = labels.yes || 'Evet';
        confirmBtn.onclick = () => {
            callback();
            modal.remove();
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = labels.no || 'Hayır';
        cancelBtn.onclick = () => modal.remove();

        btnContainer.append(confirmBtn, cancelBtn);
        modalContent.append(messageEl, btnContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        return modal;
    }

function createSliderPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'slider-panel';
  panel.className = 'slider-panel';

  const section = createSection();
  const sliderPanel = createSliderPanel(config, labels);
  sliderPanel.render();

  panel.appendChild(section);
  return panel;
}

function createPositionPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'animation-panel';
  panel.className = 'animation-panel';

  const section = createSection();
  const positionPage = createAnimationPanel(config, labels);
  positionPage.render();

  panel.appendChild(section);
  return panel;
}

function createStatusRatingPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'status-panel';
  panel.className = 'status-panel';

  const section = createSection();
  const statusPage = createStatusRatingPanel(config, labels);
  statusPage.render();

  panel.appendChild(section);
  return panel;
}

function createActorPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'actor-panel';
  panel.className = 'actor-panel';

  const section = createSection();
  const actorPage = createActorPanel(config, labels);
  actorPage.render();

  panel.appendChild(section);
  return panel;
}

function createDirectorPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'director-panel';
  panel.className = 'director-panel';

  const section = createSection();
  const directorPage = createDirectorPanel(config, labels);
  directorPage.render();

  panel.appendChild(section);
  return panel;
}

function createMusicPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'music-panel';
  panel.className = 'music-panel';

  const section = createSection();
  const musicPage = createMusicPanel(config, labels);
  musicPage.render();

  panel.appendChild(section);
  return panel;
}

function createNotificationsPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'notifications-panel';
  panel.className = 'notifications-panel';

  const section = createSection();
  const notificationsPage = createNotificationsPanel(config, labels);
  notificationsPage.render();

  panel.appendChild(section);
  return panel;
}

function createQueryPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'query-panel';
  panel.className = 'query-panel';

  const section = createSection();
  const queryPage = createQueryPanel(config, labels);
  queryPage.render();

  panel.appendChild(section);
  return panel;
}

function createHoverTrailerPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'hovertrailer-panel';
  panel.className = 'hovertrailer-panel';

  const section = createSection();
  const hoverPage = createHoverTrailerPanel(config, labels);
  hoverPage.render();

  panel.appendChild(section);
  return panel;
}

function createStudioHubsPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'studiohubs-panel';
  panel.className = 'studiohubs-panel';

  const section = createSection();
  const studioPage = createStudioHubsPanel(config, labels);
  studioPage.render();

  panel.appendChild(section);
  return panel;
}

function createTrailersPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'trailers-panel';
  panel.className = 'trailers-panel';

  const section = createSection();
  const trailersPage = createTrailersPanel(config, labels);
  trailersPage.render();

  panel.appendChild(section);
  return panel;
}

function createLanguagePanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'language-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.languageInfoHeader || 'Ses ve Altyazı Bilgileri');
    section.appendChild(createCheckbox('showLanguageInfo', labels.languageInfo || 'Ses ve Altyazı Bilgilerini Göster', config.showLanguageInfo));

    const description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.languageInfoDescription || 'Bu ayar aktifleştirildiğinde seçilen dile ait ses bilgileri içerikte mevcut ise yazdırılır. Dilinize ait ses bulunamazsa altyazı bilgileri aranır. Dilinize ait altyazı mevcut ise bilgi yazdırır.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}

function createAvatarPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'avatar-panel';
  panel.className = 'avatar-panel';

  const section = createSection();
  const avatarPage = createAvatarPanel(config, labels);
  avatarPage.render();

  panel.appendChild(section);
  return panel;
}

function createLogoTitlePage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'logoTitle-panel';
  panel.className = 'logoTitle-panel';

  const section = createSection();
  const logoTitlePage = createLogoTitlePanel(config, labels);
  logoTitlePage.render();

  panel.appendChild(section);
  return panel;
}

function createDescriptionPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'description-panel';
  panel.className = 'description-panel';

  const section = createSection();
  const descriptionPage = createDescriptionPanel(config, labels);
  descriptionPage.render();

  panel.appendChild(section);
  return panel;
}

function createProviderPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'provider-panel';
  panel.className = 'provider-panel';

  const section = createSection();
  const providerPage = createProviderPanel(config, labels);
  providerPage.render();

  panel.appendChild(section);
  return panel;
}

function createAboutPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'about-panel';

  const section = createSection();
  const aboutPage = createAboutPanel(labels);
  aboutPage.render();

  panel.appendChild(section);
  return panel;
}

function createButtonsPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'buttons-panel';
  panel.className = 'buttons-panel';

  const section = createSection();
  const buttonsPage = createButtonsPanel(config, labels);
  buttonsPage.render();

  panel.appendChild(section);
  return panel;
}

function createInfoPage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'info-panel';
  panel.className = 'info-panel';

  const section = createSection();
  const infoPage = createInfoPanel(config, labels);
  infoPage.render();

  panel.appendChild(section);
  return panel;
}

function createPositionPanel(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'position-panel';
  panel.className = 'position-panel';

  const section = createSection();
  const positionEditor = createPositionEditor(config, labels, section);
  positionEditor.render();

  panel.appendChild(section);
  return panel;
}

function createPausePage(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'pause-panel';
  panel.className = 'pause-panel';

  const section = createSection();
  const pausePage = createPausePanel(config, labels);
  pausePage.render();

  panel.appendChild(section);
  return panel;
}

function createExporterPanel(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'exporter-panel';
  panel.className = 'exporter-panel';

  panel.appendChild(createBackupRestoreButtons());

  document.documentElement.style.setProperty(
    '--file-select-text',
    `"${config.languageLabels.yedekSec || 'Dosya Seç'}"`
  );

  return panel;
}

function createTab(id, icon, label, isActive = false, isDisabled = false) {
    const tab = document.createElement('div');
    tab.className = `settings-tab ${isActive ? 'active' : ''} ${isDisabled ? 'disabled-tab' : ''}`;
    tab.setAttribute('data-tab', id);
    tab.innerHTML = `<i class="fas ${icon}"></i> <span class="jmstab-label">${label}</span>`;

    if (isDisabled) {
        tab.style.opacity = '0.5';
        tab.style.pointerEvents = 'none';
        tab.style.cursor = 'not-allowed';
    }

    return tab;
}

function extractContainerByInput(root, inputName, closestSelector = '.setting-item') {
    const input = root?.querySelector(`input[name="${inputName}"]`);
    return input?.closest(closestSelector) || null;
}

function extractContainerBySelect(root, selectName, closestSelector = '.setting-item') {
    const select = root?.querySelector(`select[name="${selectName}"]`);
    return select?.closest(closestSelector) || null;
}

function extractTmdbGroup(root) {
    const keyInput = root?.querySelector('#tmdbKeyForReviews');
    return keyInput?.closest('.fsetting-item')?.parentElement || null;
}

function extractCheckboxPair(root, inputName) {
    const input = root?.querySelector(`input[name="${inputName}"]`);
    if (!input) return null;

    const label = root.querySelector(`label[for="${input.id}"]`);
    const wrap = document.createElement('div');
    wrap.className = 'setting-item';
    wrap.appendChild(input);
    if (label) {
        wrap.appendChild(label);
    }
    return wrap;
}

function createSettingsHotkeyField(labels, currentValue) {
    const container = document.createElement('div');
    container.className = 'hotkey-input-container';

    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.alignItems = 'center';
    container.style.gap = '5px';

    const label = document.createElement('label');
    label.htmlFor = 'settingsHotkey';
    label.textContent = labels.settingsHotkeyLabel || 'Ayarlar kısayol tuşu';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '10px';
    controls.style.alignItems = 'center';
    controls.style.width = '100%';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'settingsHotkey';
    input.name = 'settingsHotkey';
    input.readOnly = true;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = normalizeSettingsHotkey(currentValue || getSettingsHotkey(), SETTINGS_HOTKEY_DEFAULT);
    input.style.flex = '1 1 180px';

    input.addEventListener('click', () => {
        input.focus();
        input.select();
    });

    input.addEventListener('focus', () => {
        input.select();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') return;

        event.preventDefault();
        event.stopPropagation();

        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

        const normalizedKey = normalizeSettingsHotkey(event.key, '');
        if (!normalizedKey) return;

        input.value = normalizedKey;
        localStorage.setItem('settingsHotkey', normalizedKey);
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.id = 'settingsHotkeyReset';
    resetButton.className = 'reset-button';
    resetButton.textContent = labels.settingsHotkeyReset || "F2'ye sıfırla";
    resetButton.addEventListener('click', () => {
        input.value = SETTINGS_HOTKEY_DEFAULT;
        localStorage.setItem('settingsHotkey', SETTINGS_HOTKEY_DEFAULT);
    });

    const help = document.createElement('div');
    help.className = 'description-text';
    help.textContent =
        labels.settingsHotkeyHelp ||
        'Alana odaklanıp kullanmak istediğiniz tuşa basın. Varsayılan: F2.';
    help.style.margin = '2px 0 0';

    controls.append(input, resetButton);
    container.append(label, controls, help);
    return container;
}

function createMainSettingsPanel(labels, panels) {
    const panel = document.createElement('div');
    panel.id = 'monwui-panel';
    panel.className = 'settings-panel';

    const config = getConfig();
    const basicsSection = createSection(labels.mainCoreSettings || 'Temel Ayarlar');
    const enablesSection = createSection(labels.mainEnableSettings || 'Ana Etkinleştirmeler');
    const hotkeySection = createSection(labels.settingsHotkeySection || 'Ayarlar Kısayolu');

    [
        extractContainerBySelect(panels.sliderPanel, 'defaultLanguage', '.setting-item'),
        extractTmdbGroup(panels.sliderPanel),
        extractContainerByInput(panels.sliderPanel, 'enableSlider', '.setting-item'),
        extractContainerByInput(panels.sliderPanel, 'onlyShowSliderOnHomeTab', '.setting-item')
    ].filter(Boolean).forEach((node) => {
        basicsSection.appendChild(node);
    });

    const homeSectionsMaster = createCheckbox(
        'enableHomeSectionsMaster',
        labels.enableHomeSectionsMaster || 'MonWui ui kartlarını etkinleştir',
        config.enableHomeSectionsMaster !== false
    );
    enablesSection.appendChild(homeSectionsMaster);

    const pauseFeaturesMaster = createCheckbox(
        'enablePauseFeaturesMaster',
        labels.enablePauseFeaturesMaster || 'Duraklatma ekranı özelliklerini etkinleştir',
        config.enablePauseFeaturesMaster !== false
    );
    enablesSection.appendChild(pauseFeaturesMaster);

    enablesSection.appendChild(createCheckbox(
        'enableSubtitleCustomizerModule',
        labels.enableSubtitleCustomizerModule || 'Altyazı Özelleştiriciyi etkinleştir',
        config.enableSubtitleCustomizerModule !== false
    ));

    enablesSection.appendChild(createCheckbox(
        'enableParentalPinModule',
        labels.enableParentalPinModule || 'Parental PIN modülünü etkinleştir',
        config.enableParentalPinModule !== false
    ));

    enablesSection.appendChild(createCheckbox(
        'enableDetailsModalModule',
        labels.enableDetailsModalModule || 'Detaylar modülünü etkinleştir',
        config.enableDetailsModalModule !== false
    ));

    const castModuleSetting = extractContainerByInput(
        panels.providerPanel,
        'enableCastModule',
        '.setting-item'
    );
    if (castModuleSetting) {
        enablesSection.appendChild(castModuleSetting);
    }

    const sharedCastViewerSetting = extractContainerByInput(
        panels.providerPanel,
        'allowSharedCastViewerForUsers',
        '.setting-item'
    );
    if (sharedCastViewerSetting) {
        const castModuleSubOptions = document.createElement('div');
        castModuleSubOptions.className = 'sub-options cast-module-main-sub-options';
        castModuleSubOptions.appendChild(sharedCastViewerSetting);
        enablesSection.appendChild(castModuleSubOptions);
        bindCheckboxKontrol('#enableCastModule', '.cast-module-main-sub-options');
    }

    if (config?.currentUserIsAdmin !== true && (castModuleSetting || sharedCastViewerSetting)) {
        const castAdminHint = document.createElement('div');
        castAdminHint.className = 'description-text';
        castAdminHint.textContent =
            labels.castModuleAdminOnlySettings ||
            'Cast modülü ve kullanıcı görünürlüğü ayarları sadece yöneticiler tarafından değiştirilebilir.';
        enablesSection.appendChild(castAdminHint);
    }

    enablesSection.appendChild(createCheckbox(
        'enableCustomSplashScreen',
        labels.enableCustomSplashScreen || 'Özel splash ekranını etkinleştir',
        config.enableCustomSplashScreen !== false
    ));
    enablesSection.appendChild(createTextInput(
        'customSplashTitle',
        labels.customSplashTitleLabel || 'Splash başlığı',
        config.customSplashTitle || labels.customSplashTitle || 'MonWui'
    ));

    [
        extractContainerByInput(panels.profileChooserPanel, 'enableProfileChooser', '.fsetting-item'),
        extractCheckboxPair(panels.musicPanel, 'enabledGmmp'),
        extractContainerByInput(panels.hoverPanel, 'allPreviewModal', '.setting-item'),
        extractContainerByInput(panels.avatarPanel, 'createAvatar', '.setting-item'),
        extractContainerByInput(panels.notificationsPanel, 'enableNotifications', '.setting-item')
    ].filter(Boolean).forEach((node) => {
        enablesSection.appendChild(node);
    });

    hotkeySection.appendChild(createSettingsHotkeyField(labels, config.settingsHotkey));

    panel.append(basicsSection, enablesSection, hotkeySection);
    return panel;
}

function normalizeSectionTitle(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendMergedPanelToSlider(targetPanel, sourcePanel, title) {
    if (!targetPanel || !sourcePanel) return;

    sourcePanel.classList.remove('settings-panel');
    sourcePanel.classList.add('merged-settings-panel');
    sourcePanel.style.display = '';

    const hasSingleSection =
        sourcePanel.childElementCount === 1 &&
        sourcePanel.firstElementChild?.classList?.contains('settings-section');

    const existingTitle = hasSingleSection && sourcePanel.firstElementChild?.firstElementChild?.tagName === 'H3'
        ? normalizeSectionTitle(sourcePanel.firstElementChild.firstElementChild.textContent)
        : '';

    if (hasSingleSection && existingTitle === normalizeSectionTitle(title)) {
        targetPanel.appendChild(sourcePanel);
        return;
    }

    const wrapperSection = createSection(title);
    wrapperSection.appendChild(sourcePanel);
    targetPanel.appendChild(wrapperSection);
}

export function createSection(title) {
    const section = document.createElement('div');
    section.className = 'settings-section';

    if (title) {
        const sectionTitle = document.createElement('h3');
        sectionTitle.textContent = title;
        section.appendChild(sectionTitle);
    }

    return section;
}

export function createCheckbox(name, label, isChecked) {
  const container = document.createElement('div');
  container.className = 'setting-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = name;
  checkbox.id = name;

  const storedValue = localStorage.getItem(name);

  if (storedValue !== null) {
    if (storedValue.trim().startsWith('{') && storedValue !== '[object Object]') {
      try {
        const obj = JSON.parse(storedValue);
        checkbox.checked = obj.enabled !== false;
      } catch {
        checkbox.checked = storedValue === 'true';
      }
    } else {
      checkbox.checked = storedValue === 'true';
    }
  } else {
    checkbox.checked = isChecked === true || isChecked === undefined;
  }

  const checkboxLabel = document.createElement('label');
  checkboxLabel.htmlFor = name;
  checkboxLabel.textContent = label;

  container.append(checkbox, checkboxLabel);
  return container;
}


export function createImageTypeSelect(name, selectedValue, includeExtended = false, includeUseSlide = false) {
    const select = document.createElement('select');
    select.name = name;

    const config = getConfig();
    const currentLang = config.defaultLanguage || getDefaultLanguage();
    const labels = getLanguageLabels(currentLang) || {};

    const options = [
        {
            value: 'none',
            label: labels.imageTypeNone || 'Hiçbiri'
        },
        {
            value: 'backdropUrl',
            label: labels.imageTypeBackdrop || 'Backdrop Görseli'
        },
        {
            value: 'landscapeUrl',
            label: labels.imageTypeLandscape || 'Landscape Görseli'
        },
        {
            value: 'primaryUrl',
            label: labels.imageTypePoster || 'Poster Görseli'
        },
        {
            value: 'logoUrl',
            label: labels.imageTypeLogo || 'Logo Görseli'
        },
        {
            value: 'bannerUrl',
            label: labels.imageTypeBanner || 'Banner Görseli'
        },
        {
            value: 'artUrl',
            label: labels.imageTypeArt || 'Art Görseli'
        },
        {
            value: 'discUrl',
            label: labels.imageTypeDisc || 'Disk Görseli'
        }
    ];

    const storedValue = localStorage.getItem(name);
    const finalSelectedValue = storedValue !== null ? storedValue : selectedValue;

    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        if (option.value === finalSelectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    return select;
}

export function bindCheckboxKontrol(
    mainCheckboxSelector,
    subContainerSelector,
    disabledOpacity = 0.5,
    additionalElements = []
) {
    setTimeout(() => {
        const mainCheckbox = document.querySelector(mainCheckboxSelector);
        const subContainer = document.querySelector(subContainerSelector);

        if (!mainCheckbox) return;
        const allElements = [];
        if (subContainer) {
            allElements.push(
                ...subContainer.querySelectorAll('input'),
                ...subContainer.querySelectorAll('select'),
                ...subContainer.querySelectorAll('textarea'),
                ...subContainer.querySelectorAll('label')
            );
        }
        additionalElements.forEach(el => el && allElements.push(el));

        const updateElementsState = () => {
            const isMainChecked = mainCheckbox.checked;

            allElements.forEach(element => {
                if (element.tagName === 'LABEL') {
                    element.style.opacity = isMainChecked ? '1' : disabledOpacity;
                } else {
                    element.disabled = !isMainChecked;
                    element.style.opacity = isMainChecked ? '1' : disabledOpacity;
                }
            });
            if (subContainer) {
                subContainer.style.opacity = isMainChecked ? '1' : disabledOpacity;
                subContainer.classList.toggle('disabled', !isMainChecked);
            }
        };
        updateElementsState();
        mainCheckbox.addEventListener('change', updateElementsState);
    }, 50);
}

export function bindTersCheckboxKontrol(
    mainCheckboxSelector,
    targetContainerSelector,
    disabledOpacity = 0.6,
    targetElements = []
) {
    setTimeout(() => {
        const mainCheckbox = document.querySelector(mainCheckboxSelector);
        const targetContainer = document.querySelector(targetContainerSelector);

        if (!mainCheckbox) return;
        const allElements = targetElements.slice();
        if (targetContainer) {
            allElements.push(
                ...targetContainer.querySelectorAll('input'),
                ...targetContainer.querySelectorAll('select'),
                ...targetContainer.querySelectorAll('textarea')
            );
        }

        const updateElementsState = () => {
            const isMainChecked = mainCheckbox.checked;
            allElements.forEach(element => {
                element.disabled = isMainChecked;
                element.style.opacity = isMainChecked ? disabledOpacity : '1';
            });

            if (targetContainer) {
                targetContainer.style.opacity = isMainChecked ? disabledOpacity : '1';
                targetContainer.classList.toggle('disabled', isMainChecked);
            }
        };
        updateElementsState();
        mainCheckbox.addEventListener('change', updateElementsState);
    }, 50);
}

export function initSettings(defaultTab = 'monwui') {
    const modal = createSettingsModal();

    return {
        element: modal,
        open: (tab = defaultTab) => {
            prepareModalForLocalShell(modal);
            return activateSettingsPanel(modal, tab);
        },
        close: () => closeLocalSettingsShell(modal)
    };
}

export function mountMonwuiSettingsPage(host, { defaultTab = 'monwui', force = false } = {}) {
    if (!host) return null;

    if (force) {
        const existing = host.querySelector('#settings-modal');
        if (existing) existing.remove();
        if (settingsModal?.isConnected) settingsModal.remove();
        settingsModal = null;
    }

    const existingModal = !force ? host.querySelector('#settings-modal') : null;
    const modal = existingModal || createSettingsModal();
    prepareModalForEmbeddedPage(modal);

    if (modal.parentElement !== host) {
        host.replaceChildren(modal);
    }

    const api = {
        element: modal,
        open: (tab = defaultTab) => {
            prepareModalForEmbeddedPage(modal);
            return activateSettingsPanel(modal, tab);
        },
        close: () => {}
    };

    host.__jmsMonwuiSettingsApi = api;
    host.__jmsMonwuiApi = api;
    api.open(defaultTab);
    return api;
}

function setupMobileTextareaBehavior() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  const textareas = modal.querySelectorAll('textarea');

  textareas.forEach(textarea => {
    textarea.addEventListener('focus', function() {
      if (!isMobileDevice()) return;
      this.style.position = 'fixed';
      this.style.bottom = '50%';
      this.style.left = '0';
      this.style.right = '0';
      this.style.zIndex = '10000';
      this.style.height = '30vh';

      setTimeout(() => {
        this.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 300);
    });

    textarea.addEventListener('blur', function() {
      if (!isMobileDevice()) return;
      this.style.position = '';
      this.style.bottom = '';
      this.style.left = '';
      this.style.right = '';
      this.style.zIndex = '';
      this.style.height = '';
    });
  });
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function createNumberInput(key, label, value, min = 0, max = 100, step = 1) {
  const container = document.createElement('div');
  container.className = 'input-container';

  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  const input = document.createElement('input');
  input.type = 'number';
  input.id = key;
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('pattern', '[0-9]+([\\.,][0-9]+)?');

  const normalize = (v) => String(v ?? '').replace(',', '.');
  const clamp = (num, lo, hi) => Math.min(Math.max(num, lo), hi);

  input.value = normalize(value);

  input.addEventListener('input', () => {
    if (input.value.includes(',')) {
      const pos = input.selectionStart;
      input.value = input.value.replace(',', '.');
      if (pos != null) input.setSelectionRange(pos, pos);
    }
  });

  input.addEventListener('blur', () => {
    const num = Number.parseFloat(normalize(input.value));
    if (!Number.isFinite(num)) return;

    let val = clamp(num, Number(input.min), Number(input.max));
    const stepNum = Number(input.step);
    if (Number.isFinite(stepNum) && stepNum > 0 && stepNum !== 1) {
      const decimals = (String(stepNum).split('.')[1] || '').length;
      val = Number(val.toFixed(decimals));
      input.value = val.toFixed(decimals);
    } else {
      input.value = String(val);
    }

    localStorage.setItem(key, input.value);
  });

  input.addEventListener('change', (e) => {
    const v = normalize(e.target.value);
    localStorage.setItem(key, v);
  });

  container.appendChild(input);
  return container;
}

export function createTextInput(key, label, value) {
    const container = document.createElement('div');
    container.className = 'input-container';

    const labelElement = document.createElement('label');
    labelElement.textContent = label;
    labelElement.htmlFor = key;
    container.appendChild(labelElement);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = key;
    input.name = key;
    input.value = value;
    input.addEventListener('change', (e) => {
        localStorage.setItem(key, e.target.value);
    });
    container.appendChild(input);

    return container;
}

export function createSelect(key, label, options, selectedValue) {
    const container = document.createElement('div');
    container.className = 'input-container';

    const labelElement = document.createElement('label');
    labelElement.textContent = label;
    labelElement.htmlFor = key;
    container.appendChild(labelElement);

    const select = document.createElement('select');
    select.id = key;
    select.name = key;

    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.text;
        if (option.value === selectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    select.addEventListener('change', (e) => {
        localStorage.setItem(key, e.target.value);
    });
    container.appendChild(select);

    return container;
}

let __isAdminCached = null;

function getJfRootFromLocation() {
  const path = window.location.pathname || "/";
  const split = path.split("/web/");
  return split.length > 1 ? split[0] : "";
}

function getEmbyTokenSafe() {
  try {
    return window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken || "";
  } catch {
    return "";
  }
}

async function isAdminUser() {
  if (__isAdminCached !== null) return __isAdminCached;

  try {
    const token = getEmbyTokenSafe();
    if (!token) {
      __isAdminCached = false;
      return false;
    }

    const jfRoot = getJfRootFromLocation();
    const r = await fetch(`${jfRoot}/Users/Me`, {
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "X-Emby-Token": token
      }
    });

    if (!r.ok) {
      __isAdminCached = false;
      return false;
    }

    const me = await r.json();
    const pol = me?.Policy || {};
    __isAdminCached = !!(pol.IsAdministrator || pol.IsAdmin || pol.IsAdminUser);
    return __isAdminCached;
  } catch {
    __isAdminCached = false;
    return false;
  }
}

export function isGlobalSettingsLockedForUser() {
  const cfg = getConfig();
  const forced = !!cfg?.forceGlobalUserSettings;

  if (!forced) return false;
  return true;
}

async function applyGlobalSettingsLockUI({
  labels,
  saveBtn,
  applyBtn,
  resetBtn,
  themeToggleBtn
}) {
  const cfg = getConfig();
  if (!cfg?.forceGlobalUserSettings) return;

  const admin = await isAdminUser();
  if (admin) return;

  const lockMsg =
    labels?.forceGlobalLockedTitle ||
    "Bu sunucuda ayarlar yönetici tarafından global olarak zorlandı.";

  [saveBtn, applyBtn, resetBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = true;
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.5";
  });
  if (themeToggleBtn) {
    themeToggleBtn.disabled = false;
    themeToggleBtn.style.pointerEvents = "";
    themeToggleBtn.style.opacity = "";
  }

  const modal = document.getElementById('settings-modal');
  if (modal) {
    const avatarPanel = modal.querySelector('#avatar-panel');
    const avatarAllowed = new Set();
    if (avatarPanel) {
      avatarPanel.querySelectorAll('input, select, textarea, button').forEach(el => avatarAllowed.add(el));
    }

    if (themeToggleBtn) avatarAllowed.add(themeToggleBtn);
    const settingsHotkeyInput = modal.querySelector('#settingsHotkey');
    const settingsHotkeyReset = modal.querySelector('#settingsHotkeyReset');
    if (settingsHotkeyInput) avatarAllowed.add(settingsHotkeyInput);
    if (settingsHotkeyReset) avatarAllowed.add(settingsHotkeyReset);

    modal.querySelectorAll('input, select, textarea, button').forEach(el => {
      if (el.classList.contains('settings-close')) return;
      if (avatarAllowed.has(el)) return;
      el.disabled = true;
      el.style.pointerEvents = "none";
      el.style.opacity = "0.6";
    });
  }

  showNotification(
    `<i class="fas fa-lock" style="margin-right:8px;"></i> ${lockMsg}`,
    5000,
    "warning"
  );
}
