import { getConfig } from "../config.js";
import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol, createSection } from "./shared.js";
import { applySettings, applyRawConfig } from "./applySettings.js";

const LYRICS_JOB_KEY = 'jmsf_lyrics_job_running';

let __lyricsLabels = {};

function createLyricsSummaryModal(labels) {
    if (document.getElementById('lyrics-summary-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'lyrics-summary-modal';
    modal.className = 'settings-modal';
    modal.style.display = 'none';

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    const content = document.createElement('div');
    content.className = 'settings-modal-content';
    content.style.maxWidth = '500px';

    const close = document.createElement('span');
    close.className = 'settings-close';
    close.innerHTML = '&times;';
    close.onclick = () => modal.style.display = 'none';

    const h2 = document.createElement('h2');
    h2.textContent = labels.lyricsSummaryTitle || "Şarkı Sözleri Özeti";

    const summaryContent = document.createElement('div');
    summaryContent.id = 'lyricsSummaryContent';
    summaryContent.style.lineHeight = '1.6';
    summaryContent.style.margin = '15px 0';

    const note = document.createElement('div');
    note.className = 'setting-item';
    note.style.marginTop = '20px';
    note.style.padding = '10px';
    note.style.background = 'rgba(255, 193, 7, 0.1)';
    note.style.borderLeft = '4px solid #ffc107';
    note.innerHTML = labels.lyricsSyncNote || '<strong>Not:</strong> Şarkı sözlerini senkronize etmeyi unutmayın!';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = labels.close || 'Kapat';
    closeBtn.style.marginTop = '15px';
    closeBtn.onclick = () => modal.style.display = 'none';

    content.append(close, h2, summaryContent, note, closeBtn);
    modal.appendChild(content);
    document.body.appendChild(modal);
}

function showLyricsSummaryModal(summary, labels) {
    createLyricsSummaryModal(labels);
    const modal = document.getElementById('lyrics-summary-modal');
    const content = document.getElementById('lyricsSummaryContent');

    if (!modal || !content) return;

    const L = labels || {};
    const tOk = L.lyricsSummaryOk || "Başarılı";
    const tSyn = L.lyricsSummarySynced || "Senkronize";
    const tPln = L.lyricsSummaryPlain || "Düz";
    const tFail = L.lyricsSummaryFail || "Başarısız";

    const ok = (summary.ok ?? ((summary.synced || 0) + (summary.plain || 0)));
    const synced = summary.synced || 0;
    const plain = summary.plain || 0;
    const fail = summary.fail || 0;

    content.innerHTML = `
        <div style="margin-bottom: 10px;">
            ${tOk}: <b style="color: #27ae60;">${ok}</b>
        </div>
        <div style="margin-bottom: 10px;">
            ${tSyn}: <b>${synced}</b>
        </div>
        <div style="margin-bottom: 10px;">
            ${tPln}: <b>${plain}</b>
        </div>
        <div style="margin-bottom: 10px;">
            ${tFail}: <b style="color: #e74c3c;">${fail}</b>
        </div>
    `;

    modal.style.display = 'block';
}

function getJFHeaders() {
  let token = null, userId = null;
  try { token = window.ApiClient?._serverInfo?.AccessToken || window.ApiClient?.accessToken?.(); } catch (e) {}
  try { userId = window.ApiClient?._serverInfo?.UserId || window.ApiClient?._currentUserId; } catch (e) {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Emby-Token': token } : {}),
    ...(userId ? { 'X-Emby-UserId': userId, 'X-MediaBrowser-UserId': userId } : {}),
  };
}

function readAdminValue(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function readAdminFromUser(user) {
  if (!user || typeof user !== "object") return null;

  const policy = user.Policy || user.UserPolicy || null;
  const candidates = [
    policy?.IsAdministrator,
    policy?.IsAdmin,
    policy?.IsAdminUser,
    user?.IsAdministrator,
    user?.isAdministrator,
    user?.IsAdmin,
    user?.isAdmin,
  ];

  for (const candidate of candidates) {
    const normalized = readAdminValue(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

async function detectIsAdmin() {
  try {
    if (!window.ApiClient) return true;

    const liveAdmin = readAdminFromUser(window.ApiClient?._currentUser);
    if (liveAdmin !== null) return liveAdmin;

    const user = await window.ApiClient.getCurrentUser();
    const currentAdmin = readAdminFromUser(user);
    return currentAdmin !== false;
  } catch (e) { return true; }
}

function attachLyricsModal(labels) {
  if (document.getElementById('lyrics-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'lyrics-modal';
  modal.className = 'settings-modal';
  modal.style.display = 'none';

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  const content = document.createElement('div');
  content.className = 'settings-modal-content';
  content.style.maxWidth = '680px';

  const close = document.createElement('span');
  close.className = 'settings-close';
  close.innerHTML = '&times;';
  close.onclick = () => modal.style.display = 'none';

  const h2 = document.createElement('h2');
  h2.textContent = labels.lyricsHeader || "Şarkı Sözleri";

  const progWrap = document.createElement('div');
  progWrap.className = 'setting-item';
  const progLbl = document.createElement('div');
  progLbl.textContent = (labels.lyricsProgress || "İlerleme") + ": ";
  const progBarOuter = document.createElement('div');
  progBarOuter.style.height = '10px';
  progBarOuter.style.background = 'rgba(255,255,255,0.15)';
  progBarOuter.style.borderRadius = '6px';
  const progBar = document.createElement('div');
  progBar.id = 'lyricsProgressBar';
  progBar.style.height = '10px';
  progBar.style.width = '0%';
  progBar.style.borderRadius = '6px';
  progBar.style.transition = 'width 0.3s ease';
  progBarOuter.appendChild(progBar);
  const progTxt = document.createElement('div');
  progTxt.id = 'lyricsProgressText';
  progTxt.style.marginTop = '6px';
  progWrap.append(progLbl, progBarOuter, progTxt);

  const status = document.createElement('div');
  status.id = 'lyricsStatus';
  status.className = 'setting-item';
  status.textContent = labels.lyricsIdle || "Hazır";

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-item';
  const startBtn = document.createElement('button');
  startBtn.id = 'lyricsStart';
  startBtn.textContent = labels.lyricsStart || "Başlat";
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'lyricsCancel';
  cancelBtn.textContent = labels.lyricsCancel || "İptal";
  cancelBtn.disabled = true;
  btnRow.append(startBtn, cancelBtn);

  const logWrap = document.createElement('div');
  logWrap.className = 'setting-item';
  const logLabel = document.createElement('div');
  logLabel.textContent = labels.lyricsLog || "Log";
  const logBox = document.createElement('pre');
  logBox.id = 'lyricsLog';
  logBox.style.maxHeight = '400px';
  logBox.style.overflow = 'auto';
  logBox.style.whiteSpace = 'pre-wrap';
  logWrap.append(logLabel, logBox);

  content.append(close, h2, status, progWrap, btnRow, logWrap);
  modal.appendChild(content);
  document.body.appendChild(modal);

  startBtn.addEventListener('click', () => startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox }));
  cancelBtn.addEventListener('click', () => cancelLyricsJob(labels));
}

function openLyricsModal(labels, opts = {}) {
  __lyricsLabels = labels || {};
  const { autoStart = false } = opts;

  const modal = document.getElementById('lyrics-modal');
  if (!modal) return;
  modal.style.display = 'block';

  const { startBtn, cancelBtn, status, progBar, progTxt, logBox } = grabLyricsModalRefs();
  (async () => {
    try {
      const r = await fetch('/JMSFusion/lyrics/status', { headers: getJFHeaders() });
      const j = await r.json();

      if (j?.running) {
        status.textContent = (labels.lyricsRunning || "Çalışıyor") + (j.currentStep ? ` • ${j.currentStep}` : '');
        if (cancelBtn) cancelBtn.disabled = false;
        if (startBtn)  startBtn.disabled  = true;

        if (typeof j.progress === 'number') {
          const p = Math.max(0, Math.min(100, j.progress));
          progBar.style.width = p + '%';
          progTxt.textContent = p.toFixed(1) + '%';
        }
        if (Array.isArray(j.log)) {
          logBox.textContent = j.log.join('\n');
          logBox.scrollTop = logBox.scrollHeight;
        }

        pollLyricsStatus({ startBtn, cancelBtn, status, progBar, progTxt, logBox });
      } else {
        if (autoStart) {
          await startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox });
        } else {
          if (cancelBtn) cancelBtn.disabled = true;
          if (startBtn)  startBtn.disabled  = false;
          status.textContent = labels.lyricsIdle || "Hazır";
        }
      }
    } catch {
      if (cancelBtn) cancelBtn.disabled = true;
      if (startBtn)  startBtn.disabled  = false;
      if (autoStart) {
        await startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox });
      }
    }
  })();

  const jobStamp = getLyricsJobFlag();
  if (jobStamp) {
    status.textContent = (labels.lyricsRunning || "Çalışıyor") + " • " + (labels.lyricsResumeHint || "Devam eden bir iş var, modal açıldı.");
  }
}

function grabLyricsModalRefs() {
  return {
    startBtn: document.getElementById('lyricsStart'),
    cancelBtn: document.getElementById('lyricsCancel'),
    status: document.getElementById('lyricsStatus'),
    progBar: document.getElementById('lyricsProgressBar'),
    progTxt: document.getElementById('lyricsProgressText'),
    logBox: document.getElementById('lyricsLog')
  };
}

function setLyricsJobFlag(on) {
  try { on ? localStorage.setItem(LYRICS_JOB_KEY, String(Date.now())) : localStorage.removeItem(LYRICS_JOB_KEY); } catch {}
}
function getLyricsJobFlag() {
  try { return localStorage.getItem(LYRICS_JOB_KEY); } catch { return null; }
}

async function startLyricsJob(labels, refs) {
  const { startBtn, cancelBtn, status, progBar, progTxt, logBox } = refs;
  startBtn.disabled = true;
  cancelBtn.disabled = false;
  status.textContent = labels.lyricsRunning || "Çalışıyor";

  const body = {
    mode: localStorage.getItem('lyricsMode') || 'prefer-synced',
    overwrite: localStorage.getItem('lyricsOverwrite') || 'skip'
  };

  try {
    const r = await fetch('/JMSFusion/lyrics/run', {
      method: 'POST',
      headers: getJFHeaders(),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      const j = await r.json().catch(()=>({}));
      status.textContent = j?.error || `Hata: ${r.status}`;
      return;
    }
    setLyricsJobFlag(true);
    pollLyricsStatus({ startBtn, cancelBtn, status, progBar, progTxt, logBox });
  } catch (e) {
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    status.textContent = 'Ağ hatası';
  }
}

async function cancelLyricsJob(labels) {
  const { startBtn, cancelBtn, status } = grabLyricsModalRefs();
  try {
    await fetch('/JMSFusion/lyrics/cancel', { method: 'POST', headers: getJFHeaders() });
  } catch {}
  status.textContent = labels.lyricsCancel || 'İptal';
}

let lyricsPollTimer = null;

async function pollLyricsStatus(refs) {
    const { startBtn, cancelBtn, status, progBar, progTxt, logBox } = refs;
    const L = __lyricsLabels || {};

    clearTimeout(lyricsPollTimer);

    try {
        const r = await fetch('/JMSFusion/lyrics/status', { headers: getJFHeaders() });
        const j = await r.json();
        if (!j?.ok) throw new Error('status not ok');

        if (Array.isArray(j.log)) {
            logBox.textContent = j.log.join('\n');
            logBox.scrollTop = logBox.scrollHeight;
        }

        if (typeof j.progress === 'number') {
            const p = Math.max(0, Math.min(100, j.progress));
            progBar.style.width = p + '%';
            progTxt.textContent = p.toFixed(1) + '%';
        }

        if (j.running) {
            status.textContent = (L.lyricsRunning || "Çalışıyor") + (j.currentStep ? ` • ${j.currentStep}` : '');
            if (cancelBtn) cancelBtn.disabled = false;
            if (startBtn) startBtn.disabled = true;
            lyricsPollTimer = setTimeout(() => pollLyricsStatus(refs), 1500);
        } else {
            setLyricsJobFlag(false);
            if (cancelBtn) cancelBtn.disabled = true;
            if (startBtn) startBtn.disabled = false;
            status.textContent = (L.lyricsCompleted || "Bitti");

            const S = j.summary || null;
            if (S) {
                showLyricsSummaryModal(S, L);
            }
        }
    } catch (e) {
        lyricsPollTimer = setTimeout(() => pollLyricsStatus(refs), 2000);
    }
}

export function createMusicPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'music-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.gmmpSettings || 'GMMP Ayarları');

    const notificationToggleDiv = document.createElement('div');
    notificationToggleDiv.className = 'setting-item';

    const enabledGmmpInput = document.createElement('input');
    enabledGmmpInput.type = 'checkbox';
    enabledGmmpInput.checked = config.enabledGmmp !== false;
    enabledGmmpInput.name = 'enabledGmmp';
    enabledGmmpInput.id = 'enabledGmmp';

    const enabledGmmpLabel = document.createElement('label');
    enabledGmmpLabel.textContent = labels.enabledGmmp || 'Müzik Çaları Aktif Et';
    enabledGmmpLabel.htmlFor = 'enabledGmmp';

    const notificationToggleInput = document.createElement('input');
    notificationToggleInput.type = 'checkbox';
    notificationToggleInput.checked = config.notificationsEnabled !== false;
    notificationToggleInput.name = 'notificationsEnabled';
    notificationToggleInput.id = 'notificationsEnabled';

    const notificationToggleLabel = document.createElement('label');
    notificationToggleLabel.textContent = labels.notificationsEnabled || 'Bildirimleri Göster:';
    notificationToggleLabel.htmlFor = 'notificationsEnabled';

    notificationToggleDiv.append(enabledGmmpInput, enabledGmmpLabel, notificationToggleInput, notificationToggleLabel);
    section.appendChild(notificationToggleDiv);

    const albumArtBgDiv = document.createElement('div');
    albumArtBgDiv.className = 'setting-item';

    const albumArtBgLabel = document.createElement('label');
    albumArtBgLabel.textContent = labels.useAlbumArtAsBackground || 'Albüm kapağını arka plan yap:';

    const albumArtBgInput = document.createElement('input');
    albumArtBgInput.type = 'checkbox';
    albumArtBgInput.checked = config.useAlbumArtAsBackground || false;
    albumArtBgInput.name = 'useAlbumArtAsBackground';
    albumArtBgInput.id = 'useAlbumArtAsBackground';

    albumArtBgLabel.htmlFor = 'albumArtBgInput';
    albumArtBgInput.id = 'albumArtBgInput';
    albumArtBgDiv.append(albumArtBgLabel, albumArtBgInput);
    section.appendChild(albumArtBgDiv);

    const blurDiv = document.createElement('div');
    blurDiv.className = 'setting-item';

    const blurLabel = document.createElement('label');
    blurLabel.textContent = labels.backgroundBlur || 'Arka plan bulanıklığı:';
    blurLabel.htmlFor = 'albumArtBackgroundBlur';

    const blurInput = document.createElement('input');
    blurInput.type = 'range';
    blurInput.min = '0';
    blurInput.max = '20';
    blurInput.step = '1';
    blurInput.value = config.albumArtBackgroundBlur ?? 10;
    blurInput.name = 'albumArtBackgroundBlur';
    blurInput.id = 'albumArtBackgroundBlur';

    const blurValue = document.createElement('span');
    blurValue.className = 'range-value';
    blurValue.textContent = blurInput.value + 'px';

    blurInput.addEventListener('input', () => {
        blurValue.textContent = blurInput.value + 'px';
    });

    blurDiv.append(blurLabel, blurInput, blurValue);
    section.appendChild(blurDiv);

    const opacityDiv = document.createElement('div');
    opacityDiv.className = 'setting-item';

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = labels.backgroundOpacity || 'Arka plan şeffaflığı:';
    opacityLabel.htmlFor = 'albumArtBackgroundOpacity';

    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.1';
    opacityInput.value = config.albumArtBackgroundOpacity ?? 0.5;
    opacityInput.name = 'albumArtBackgroundOpacity';
    opacityInput.id = 'albumArtBackgroundOpacity';

    const opacityValue = document.createElement('span');
    opacityValue.className = 'range-value';
    opacityValue.textContent = opacityInput.value;

    opacityInput.addEventListener('input', () => {
        opacityValue.textContent = opacityInput.value;
    });

    opacityDiv.append(opacityLabel, opacityInput, opacityValue);
    section.appendChild(opacityDiv);

    const styleDiv = document.createElement('div');
    styleDiv.className = 'setting-item';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = labels.playerStyle || 'Player Stili:';
    const styleSelect = document.createElement('select');
    styleSelect.name = 'playerStyle';

    const styles = [
        { value: 'player', label: labels.yatayStil || 'Yatay Stil' },
        { value: 'newplayer', label: labels.dikeyStil || 'Dikey Stil' }
    ];

    styles.forEach(style => {
        const option = document.createElement('option');
        option.value = style.value;
        option.textContent = style.label;
        if (style.value === (config.playerStyle || 'player')) {
            option.selected = true;
        }
        styleSelect.appendChild(option);
    });

    styleLabel.htmlFor = 'styleSelect';
    styleSelect.id = 'styleSelect';
    styleDiv.append(styleLabel, styleSelect);
    section.appendChild(styleDiv);

    const themeDiv = document.createElement('div');
    themeDiv.className = 'setting-item';
    const themeLabel = document.createElement('label');
    themeLabel.textContent = labels.playerTheme || 'Player Teması:';
    const themeSelect = document.createElement('select');
    themeSelect.name = 'playerTheme';

    const themes = [
        { value: 'dark', label: labels.darkTheme || 'Karanlık Tema' },
        { value: 'light', label: labels.lightTheme || 'Aydınlık Tema' }
    ];

    themes.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme.value;
        option.textContent = theme.label;
        if (theme.value === (config.playerTheme || 'dark')) {
            option.selected = true;
        }
        themeSelect.appendChild(option);
    });

    themeLabel.htmlFor = 'themeSelect';
    themeSelect.id = 'themeSelect';
    themeDiv.append(themeLabel, themeSelect);
    section.appendChild(themeDiv);

    const dateLocaleDiv = document.createElement('div');
    dateLocaleDiv.className = 'setting-item';
    const dateLocaleLabel = document.createElement('label');
    dateLocaleLabel.textContent = labels.dateLocale || 'Tarih Formatı:';
    const dateLocaleSelect = document.createElement('select');
    dateLocaleSelect.name = 'dateLocale';

    const locales = [
    { value: 'tr-TR', label: '🇹🇷 Türkçe' },
    { value: 'en-US', label: '🇺🇸 English (US)' },
    { value: 'en-GB', label: '🇬🇧 English (UK)' },
    { value: 'de-DE', label: '🇩🇪 Deutsch' },
    { value: 'fr-FR', label: '🇫🇷 Français' },
    { value: 'es-ES', label: '🇪🇸 Español' },
    { value: 'it-IT', label: '🇮🇹 Italiano' },
    { value: 'ru-RU', label: '🇷🇺 Русский' },
    { value: 'ja-JP', label: '🇯🇵 日本語' },
    { value: 'zh-CN', label: '🇨🇳 简体中文' },
    { value: 'pt-PT', label: '🇵🇹 Português (Portugal)' },
    { value: 'pt-BR', label: '🇧🇷 Português (Brasil)' },
    { value: 'nl-NL', label: '🇳🇱 Nederlands' },
    { value: 'sv-SE', label: '🇸🇪 Svenska' },
    { value: 'pl-PL', label: '🇵🇱 Polski' },
    { value: 'uk-UA', label: '🇺🇦 Українська' },
    { value: 'ko-KR', label: '🇰🇷 한국어' },
    { value: 'ar-SA', label: '🇸🇦 العربية' },
    { value: 'hi-IN', label: '🇮🇳 हिन्दी' },
    { value: 'fa-IR', label: '🇮🇷 فارسی' },
];

    locales.forEach(locale => {
        const option = document.createElement('option');
        option.value = locale.value;
        option.textContent = locale.label;
        if (locale.value === config.dateLocale) {
            option.selected = true;
        }
        dateLocaleSelect.appendChild(option);
    });

    dateLocaleLabel.htmlFor = 'dateLocaleSelect';
    dateLocaleSelect.id = 'dateLocaleSelect';
    dateLocaleDiv.append(dateLocaleLabel, dateLocaleSelect);
    section.appendChild(dateLocaleDiv);

    const musicLimitDiv = document.createElement('div');
    musicLimitDiv.className = 'setting-item';
    const musicLimitLabel = document.createElement('label');
    musicLimitLabel.textContent = labels.muziklimit || 'Oynatma Listesi Öğe Sayısı:';
    const musicLimitInput = document.createElement('input');
    musicLimitInput.type = 'number';
    musicLimitInput.value = config.muziklimit || 30;
    musicLimitInput.name = 'muziklimit';
    musicLimitInput.min = 1;
    musicLimitLabel.htmlFor = 'musicLimitInput';
    musicLimitInput.id = 'musicLimitInput';
    musicLimitDiv.append(musicLimitLabel, musicLimitInput);
    section.appendChild(musicLimitDiv);

    const nextTrackDiv = document.createElement('div');
    nextTrackDiv.className = 'setting-item';
    const nextTrackLabel = document.createElement('label');
    nextTrackLabel.textContent = labels.nextTrack || 'Sıradaki Şarkılar Limiti';
    const nextTrackInput = document.createElement('input');
    nextTrackInput.type = 'number';
    nextTrackInput.value = config.nextTrack || 30;
    nextTrackInput.name = 'nextTrack';
    nextTrackInput.min = 0;
    nextTrackLabel.htmlFor = 'nextTrackInput';
    nextTrackInput.id = 'nextTrackInput';
    nextTrackDiv.append(nextTrackLabel, nextTrackInput);
    section.appendChild(nextTrackDiv);

    const songLimitDiv = document.createElement('div');
    songLimitDiv.className = 'setting-item';
    const songLimitLabel = document.createElement('label');
    songLimitLabel.textContent = labels.sarkilimit || 'Sayfa başına şarkı sayısı:';
    const songLimitInput = document.createElement('input');
    songLimitInput.type = 'number';
    songLimitInput.value = config.sarkilimit || 200;
    songLimitInput.name = 'sarkilimit';
    songLimitInput.min = 1;
    songLimitLabel.htmlFor = 'songLimitInput';
    songLimitInput.id = 'songLimitInput';
    songLimitDiv.append(songLimitLabel, songLimitInput);
    section.appendChild(songLimitDiv);

    const albumLimitDiv = document.createElement('div');
    albumLimitDiv.className = 'setting-item';
    const albumLimitLabel = document.createElement('label');
    albumLimitLabel.textContent = labels.albumlimit || 'Sayfa başına albüm sayısı:';
    const albumLimitInput = document.createElement('input');
    albumLimitInput.type = 'number';
    albumLimitInput.value = config.albumlimit || 20;
    albumLimitInput.name = 'albumlimit';
    albumLimitInput.min = 1;
    albumLimitLabel.htmlFor = 'albumLimitInput';
    albumLimitInput.id = 'albumLimitInput';
    albumLimitDiv.append(albumLimitLabel, albumLimitInput);
    section.appendChild(albumLimitDiv);

    const id3LimitDiv = document.createElement('div');
    id3LimitDiv.className = 'setting-item';
    const id3LimitLabel = document.createElement('label');
    id3LimitLabel.textContent = labels.id3limit || 'Gruplama Limiti:';
    id3LimitLabel.title = labels.id3limitTitle || 'Id3 etiket sorgulamanın eş zamanlı olarak kaç tane yapılacağı belirleyen değer';
    const id3LimitInput = document.createElement('input');
    id3LimitInput.type = 'number';
    id3LimitInput.value = config.id3limit || 5;
    id3LimitInput.name = 'id3limit';
    id3LimitInput.min = 1;
    id3LimitInput.max = 200;
    id3LimitInput.title = labels.id3limitTitle || 'Id3 etiket sorgulamanın eş zamanlı olarak kaç tane yapılacağı belirleyen değer';
    id3LimitLabel.htmlFor = 'id3LimitInput';
    id3LimitInput.id = 'id3LimitInput';
    id3LimitDiv.append(id3LimitLabel, id3LimitInput);
    section.appendChild(id3LimitDiv);

    const maxExcludeIdsForUriDiv = document.createElement('div');
    maxExcludeIdsForUriDiv.className = 'setting-item';
    const maxExcludeIdsForUriLabel = document.createElement('label');
    maxExcludeIdsForUriLabel.textContent = labels.maxExcludeIdsForUri || 'Maksimum ID Sayısı';
    maxExcludeIdsForUriLabel.title = labels.maxExcludeIdsForTitle || 'Bu değer, Liste yenilemek için API isteğinde aynı anda gönderilebilecek "Hariç Tutulacak Geçmiş Liste Sayısı" listesinin maksimum uzunluğunu belirler. Büyük değerler sunucu isteklerinin boyutunu aşarak hatalara neden olabilir. İsteklerin hatasız çalışması için genellikle 50-200 arası bir değer önerilir.';
    const maxExcludeIdsForUriInput = document.createElement('input');
    maxExcludeIdsForUriInput.type = 'number';
    maxExcludeIdsForUriInput.value = config.maxExcludeIdsForUri || 100;
    maxExcludeIdsForUriInput.title = labels.maxExcludeIdsForTitle || 'Bu değer, Liste yenilemek için API isteğinde aynı anda gönderilebilecek "Hariç Tutulacak Geçmiş Liste Sayısı" listesinin maksimum uzunluğunu belirler. Büyük değerler sunucu isteklerinin boyutunu aşarak hatalara neden olabilir. İsteklerin hatasız çalışması için genellikle 50-200 arası bir değer önerilir.';
    maxExcludeIdsForUriInput.name = 'maxExcludeIdsForUri';
    maxExcludeIdsForUriInput.min = 1;
    maxExcludeIdsForUriLabel.htmlFor = 'maxExcludeIdsForUriInput';
    maxExcludeIdsForUriInput.id = 'maxExcludeIdsForUriInput';
    maxExcludeIdsForUriDiv.append(maxExcludeIdsForUriLabel, maxExcludeIdsForUriInput);
    section.appendChild(maxExcludeIdsForUriDiv);

    const historyLimitDiv = document.createElement('div');
    historyLimitDiv.className = 'setting-item';
    const historyLimitLabel = document.createElement('label');
    historyLimitLabel.textContent = labels.historylimit || 'Hariç Tutulacak Geçmiş Liste Sayısı';
    historyLimitLabel.title = labels.historylimitTitle || 'Yeni listelere, geçmiş listeler içerisindeki şarkıları dahil etmemek için limit belirleyin';
    const historyLimitInput = document.createElement('input');
    historyLimitInput.type = 'number';
    historyLimitInput.value = config.historylimit || 10;
    historyLimitInput.name = 'historylimit';
    historyLimitInput.title = labels.historylimitTitle || 'Yeni listelere, geçmiş listeler içerisindeki şarkıları dahil etmemek için limit belirleyin';
    historyLimitInput.min = 1;
    historyLimitLabel.htmlFor = 'historyLimitInput';
    historyLimitInput.id = 'historyLimitInput';
    historyLimitDiv.append(historyLimitLabel, historyLimitInput);
    section.appendChild(historyLimitDiv);

    const groupLimitDiv = document.createElement('div');
    groupLimitDiv.className = 'setting-item';
    const groupLimitLabel = document.createElement('label');
    groupLimitLabel.textContent = labels.gruplimit || 'Gruplama Limiti:';
    groupLimitLabel.title = labels.gruplimitTitle || 'Mevcut oynatma listesine ekleme yapılırken gruplama limiti';
    const groupLimitInput = document.createElement('input');
    groupLimitInput.type = 'number';
    groupLimitInput.value = config.gruplimit || 100;
    groupLimitInput.name = 'gruplimit';
    groupLimitInput.min = 1;
    groupLimitInput.max = 400;
    groupLimitInput.title = labels.gruplimitTitle || 'Mevcut oynatma listesine ekleme yapılırken gruplama limiti';
    groupLimitLabel.htmlFor = 'groupLimitInput';
    groupLimitInput.id = 'groupLimitInput';
    groupLimitDiv.append(groupLimitLabel, groupLimitInput);
    section.appendChild(groupLimitDiv);

    const nextTracksSourceDiv = document.createElement('div');
    nextTracksSourceDiv.className = 'setting-item';
    const nextTracksSourceLabel = document.createElement('label');
    nextTracksSourceLabel.textContent = labels.nextTracksSource || 'Sıradaki Şarkılar Kaynağı:';
    const nextTracksSourceSelect = document.createElement('select');
    nextTracksSourceSelect.name = 'nextTracksSource';

    const sources = [
        { value: 'playlist', label: labels.playlist || 'Oynatma Listesi' },
        { value: 'top', label: labels.topTracks || 'En Çok Dinlenenler' },
        { value: 'recent', label: labels.recentTracks || 'Son Dinlenenler' },
        { value: 'latest', label: labels.latestTracks || 'Son Eklenenler' },
        { value: 'favorites', label: labels.favorites || 'Favorilerim' }
    ];

    sources.forEach(source => {
    const option = document.createElement('option');
    option.value = source.value;
    option.textContent = source.label;
    if (source.value === (config.nextTracksSource || 'playlist')) {
        option.selected = true;
    }
    nextTracksSourceSelect.appendChild(option);
});

    nextTracksSourceLabel.htmlFor = 'nextTracksSourceSelect';
    nextTracksSourceSelect.id = 'nextTracksSourceSelect';
    nextTracksSourceDiv.append(nextTracksSourceLabel, nextTracksSourceSelect);
    section.appendChild(nextTracksSourceDiv);

    const topTrackDiv = document.createElement('div');
    topTrackDiv.className = 'setting-item';
    const topTrackLabel = document.createElement('label');
    topTrackLabel.textContent = labels.topLimit || 'Sıradaki Şarkılar Limiti';
    const topTrackInput = document.createElement('input');
    topTrackInput.type = 'number';
    topTrackInput.value = config.topTrack || 30;
    topTrackInput.name = 'topTrack';
    topTrackInput.min = 0;
    topTrackLabel.htmlFor = 'topTrackInput';
    topTrackInput.id = 'topTrackInput';
    topTrackDiv.append(topTrackLabel, topTrackInput);
    section.appendChild(topTrackDiv);

    panel.appendChild(section);

    const lyricsSection = createSection(labels.lyricsHeader || "Şarkı Sözleri");
    const adminWarn = document.createElement('div');
    adminWarn.className = 'setting-item';
    adminWarn.style.display = 'none';
    adminWarn.style.color = '#c0392b';
    adminWarn.textContent = labels.lyricsAdminOnly || "Sadece yöneticiler kullanabilir";
    lyricsSection.appendChild(adminWarn);

    const modeDiv = document.createElement('div');
    modeDiv.className = 'setting-item';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = labels.lyricsType || "İndirme Türü";
    modeLabel.htmlFor = 'lyricsMode';
    const modeSelect = document.createElement('select');
    modeSelect.name = 'lyricsMode';
    modeSelect.id = 'lyricsMode';

    [
      { v: 'synced', t: labels.lyricsSynced || 'Senkronize (.lrc)' },
      { v: 'plain', t: labels.lyricsPlain || 'Düz Metin (.txt)' },
      { v: 'prefer-synced', t: labels.lyricsPreferSynced || 'Önce Senkronize, yoksa Düz' },
      { v: 'prefer-plain', t: labels.lyricsPreferPlain || 'Önce Düz, yoksa Senkronize' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if ((localStorage.getItem('lyricsMode') || 'prefer-synced') === o.v) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener('change', e => localStorage.setItem('lyricsMode', e.target.value));
    modeDiv.append(modeLabel, modeSelect);
    lyricsSection.appendChild(modeDiv);

    const owDiv = document.createElement('div');
    owDiv.className = 'setting-item';
    const owLabel = document.createElement('label');
    owLabel.textContent = labels.lyricsOverwrite || "Eğer dosya varsa";
    owLabel.htmlFor = 'lyricsOverwrite';
    const owSelect = document.createElement('select');
    owSelect.name = 'lyricsOverwrite';
    owSelect.id = 'lyricsOverwrite';

    [
      { v: 'skip', t: labels.lyricsOverwriteSkip || 'Atla (önerilen)' },
      { v: 'replace', t: labels.lyricsOverwriteReplace || 'Üzerine yaz' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if ((localStorage.getItem('lyricsOverwrite') || 'skip') === o.v) opt.selected = true;
      owSelect.appendChild(opt);
    });
    owSelect.addEventListener('change', e => localStorage.setItem('lyricsOverwrite', e.target.value));
    owDiv.append(owLabel, owSelect);
    lyricsSection.appendChild(owDiv);

    const runDiv = document.createElement('div');
    runDiv.className = 'setting-item';
    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.id = 'lyricsRunBtn';
    runBtn.textContent = labels.lyricsFindButton || "Şarkı sözlerini indir";
    runDiv.appendChild(runBtn);
    lyricsSection.appendChild(runDiv);

    section.appendChild(lyricsSection);
    attachLyricsModal(labels);
    detectIsAdmin().then(isAdmin => {
      if (!isAdmin) {
        adminWarn.style.display = 'block';
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
      }
    });

    runBtn.addEventListener('click', () => {
      openLyricsModal(labels, { autoStart: true });
    });

    const onThemeChanged = () => {
      const cfgNow = getConfig();
      const sel = panel.querySelector('#themeSelect');
      if (sel) sel.value = cfgNow.playerTheme || 'dark';
    };
    window.addEventListener('app:theme-changed', onThemeChanged);

    const obs = new MutationObserver(() => {
      if (!document.body.contains(panel)) {
        window.removeEventListener('app:theme-changed', onThemeChanged);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return panel;
    }
