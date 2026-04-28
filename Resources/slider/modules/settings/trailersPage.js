import { createSection, createCheckbox, createTextInput } from './shared.js';
import { showNotification } from "../player/ui/notification.js";
import { getServerBase } from "/Plugins/JMSFusion/runtime/api.js";

const LS_JOB_KEY = 'jmsf_trailer_job_running';
const TRAILER_RESOLUTION_OPTIONS = [640, 720, 1080, 1440, 2160];
const DEFAULT_TRAILER_MIN_RESOLUTION = 720;
const DEFAULT_TRAILER_MAX_RESOLUTION = 1080;
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 1;
const MIN_CONCURRENT_DOWNLOADS = 1;
const MAX_CONCURRENT_DOWNLOADS = 8;

function setJobFlag(on) {
  try { on ? localStorage.setItem(LS_JOB_KEY, String(Date.now())) : localStorage.removeItem(LS_JOB_KEY); } catch {}
}
function getJobFlag() {
  try { return !!localStorage.getItem(LS_JOB_KEY); } catch { return false; }
}

async function getAuthHeaders() {
  let token = null, userId = null;
  if (window.ApiClient) {
    try { token = window.ApiClient._serverInfo?.AccessToken || window.ApiClient.accessToken?.(); } catch {}
    try { const u = await window.ApiClient.getCurrentUser(); userId = u?.Id || null; } catch {}
  }
  const h = { 'Content-Type': 'application/json' };
  if (token)  h['X-Emby-Token']  = token;
  if (userId) h['X-Emby-UserId'] = userId;
  return h;
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

async function checkUserIsAdmin() {
  try {
    if (!window.ApiClient) return false;

    const liveAdmin = readAdminFromUser(window.ApiClient?._currentUser);
    if (liveAdmin !== null) return liveAdmin;

    const user = await window.ApiClient.getCurrentUser();
    const currentAdmin = readAdminFromUser(user);
    return currentAdmin === true;
  } catch (error) {
    console.error('Kullanıcı yetki kontrolü hatası:', error);
    return false;
  }
}

function mapEnumToWire(val) {
  if (!val) return 'skip';
  const s = String(val).toLowerCase();
  if (s.includes('replace')) return 'replace';
  if (s.includes('better'))  return 'if-better';
  return 'skip';
}
function parseIntSafe(x){ const n=Number(x); return Number.isFinite(n)?n:0; }

function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, window.location.href).toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function resolveAutoJfBase(config = {}) {
  const candidates = [];

  try { candidates.push(getServerBase()); } catch {}

  try {
    const api = window.ApiClient || null;
    candidates.push(typeof api?.serverAddress === 'function' ? api.serverAddress() : api?.serverAddress);
    candidates.push(api?._serverInfo?.ManualAddress);
    candidates.push(api?._serverInfo?.LocalAddress);
  } catch {}

  candidates.push(config?.JFBase);
  candidates.push(config?.jfBase);

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function normalizeTrailerConfigEnvelope(payload) {
  const base = payload?.cfg && typeof payload.cfg === 'object' ? payload.cfg : payload;
  return base && typeof base === 'object' ? base : {};
}

function pickConfigValue(source, ...keys) {
  const cfg = normalizeTrailerConfigEnvelope(source);
  for (const key of keys) {
    if (cfg[key] != null) return cfg[key];
  }
  return undefined;
}

function coerceBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeResolutionOption(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;

  return TRAILER_RESOLUTION_OPTIONS.reduce((closest, option) => (
    Math.abs(option - num) < Math.abs(closest - num) ? option : closest
  ), fallback);
}

function normalizeConcurrentDownloads(value, fallback = DEFAULT_MAX_CONCURRENT_DOWNLOADS) {
  const num = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(MAX_CONCURRENT_DOWNLOADS, Math.max(MIN_CONCURRENT_DOWNLOADS, num));
}

function getResolutionBounds(source) {
  const minRaw = pickConfigValue(source, 'trailerMinResolution', 'TrailerMinResolution');
  const maxRaw = pickConfigValue(source, 'trailerMaxResolution', 'TrailerMaxResolution');
  const min = normalizeResolutionOption(minRaw, DEFAULT_TRAILER_MIN_RESOLUTION);
  const max = normalizeResolutionOption(maxRaw, DEFAULT_TRAILER_MAX_RESOLUTION);
  return min <= max ? { min, max } : { min: max, max: min };
}

function fmtStr(str, params) {
  if (!params) return String(str ?? '');
  return String(str ?? '').replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
}

function escapeRegExp(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    if (!pattern) continue;
    const m = text.match(pattern);
    if (m) return m;
  }
  return null;
}

function normalizeMessageArgs(args) {
  return args && typeof args === 'object' ? args : {};
}

function translateTrailerStepName(step, L) {
  const raw = String(step ?? '').trim();
  if (!raw) return '';
  if (/^trailers\.sh$/i.test(raw)) return L.summaryDownloaderTitle;
  if (/^trailersurl\.sh$/i.test(raw)) return L.summaryUrlNfoTitle;
  return raw;
}

function translateTrailersMessage(code, args, fallback, L) {
  const p = normalizeMessageArgs(args);
  const localizedStep = translateTrailerStepName(p.step, L) || p.step || '';

  switch (String(code || '')) {
    case 'trailers.api.user_header_required':
      return L.ctrlApiUserHeaderRequired;
    case 'trailers.api.token_header_required':
      return L.ctrlApiTokenHeaderRequired;
    case 'trailers.api.user_not_found':
      return L.shUserNotFound;
    case 'trailers.api.admin_required':
      return L.adminRequired;
    case 'trailers.api.script_execution_disabled':
      return L.ctrlApiExecutionDisabled;
    case 'trailers.api.no_task_enabled':
      return L.ctrlApiNoTaskEnabled;
    case 'trailers.api.already_running':
      return L.alreadyRunning;
    case 'trailers.api.plugin_config_unavailable':
      return L.ctrlApiPluginConfigUnavailable;
    case 'trailers.api.plugin_config_hint':
      return L.ctrlApiPluginConfigHint;
    case 'trailers.api.cancel_in_progress':
      return L.ctrlApiCancelInProgress;
    case 'trailers.api.no_running_job':
      return L.ctrlApiNoRunningJob;
    case 'trailers.api.unexpected_error':
      return L.ctrlApiUnexpectedError;
    case 'trailers.last.cancel_requested':
      return L.ctrlLastCancelRequested;
    case 'trailers.last.step_starting':
      return fmtStr(L.ctrlLastStepStarting, { step: localizedStep });
    case 'trailers.last.step_finished':
      return fmtStr(L.ctrlLastStepFinished, { step: localizedStep });
    case 'trailers.last.cancelled':
      return L.cancelled;
    case 'trailers.last.finished':
      return fmtStr(L.ctrlLastFinishedDuration, { seconds: p.seconds ?? '' });
    default:
      break;
  }

  if (fallback != null && fallback !== '') {
    return translateLogLine(String(fallback), L);
  }

  return '';
}

function translateTrailersLastMessage(status, L) {
  const raw = String(status?.lastMessage ?? '').trim();
  if (!status?.lastMessageCode && /^JMSF::(?:TOTAL|DONE)=/i.test(raw)) {
    return '';
  }
  return translateTrailersMessage(status?.lastMessageCode, status?.lastMessageArgs, raw, L);
}

function translateTrailersApiErrorText(data, L, status, rawText = '') {
  const errorText = translateTrailersMessage(data?.errorCode, data?.errorArgs, data?.error || data?.Message, L);
  const hintText = translateTrailersMessage(data?.hintCode, data?.hintArgs, data?.hint, L);
  const detailText = typeof data?.detail === 'string' ? data.detail.trim() : '';
  const parts = [errorText, hintText];
  if (detailText && !parts.includes(detailText)) parts.push(detailText);
  if (!parts.some(Boolean) && rawText) parts.push(`HTTP ${status}: ${rawText}`);
  return parts.filter(Boolean).join(' ');
}

function formatShortTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return d.toLocaleTimeString();
  }
}

function buildProgressBody(status, L) {
  const lines = [];
  const startedAt = formatShortTime(status?.startedAt);
  if (startedAt) {
    lines.push(`${L.progressStartedAtLabel}: ${startedAt}`);
  }

  const steps = Array.isArray(status?.steps) ? status.steps : [];
  const stepCount = steps.length;
  const currentStep = String(status?.currentStep || '');
  const currentStepLabel = translateTrailerStepName(currentStep, L);
  let stepIndex = currentStep ? steps.findIndex((step) => String(step) === currentStep) + 1 : 0;
  if (!status?.running && stepCount > 0) stepIndex = stepCount;
  if (stepIndex <= 0 && status?.running && stepCount > 0) stepIndex = 1;

  if (stepCount > 0) {
    const stepText = currentStepLabel
      ? `${stepIndex}/${stepCount} (${currentStepLabel})`
      : `${stepIndex}/${stepCount}`;
    lines.push(`${L.progressStepLabel}: ${stepText}`);
  }

  const done = Number(status?.currentStepDone);
  const total = Number(status?.currentStepTotal);
  if (Number.isFinite(total) && total > 0) {
    const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
    lines.push(`${L.progressItemsLabel}: ${safeDone}/${total}`);
  } else if (status?.running) {
    lines.push(`${L.progressItemsLabel}: ${L.progressItemsPending}`);
  }

  return lines.join('\n');
}

function translateLogLine(line, L) {
  if (!line) return line;
  const rawLine = String(line);

  line = line
    .replace(/\[INFO\]/g,  L.logInfo)
    .replace(/\[WARN\]/g,  L.logWarn)
    .replace(/\[HATA\]/g,  L.logError)
    .replace(/\[OK\]/g,    L.logOk)
    .replace(/\[ATLA\]/g,  L.logSkip)
    .replace(/\[INDIR\]/g, L.logDownload)
    .replace(/\[DEBUG\]/g, L.logDebug);

  const rules = [
    { re: /İş iptal edildi\./i, out: L.cancelled },
    { re: /Bu script bash gerektirir/i, out: L.shRequiresBash },
    { re: /WORK_DIR oluşturulamadı/i,   out: L.shWorkdirCreateFailed },
    { re: /Hata:\s*([A-Za-z0-9_\-.]+)\s+kurulu değil\./i, out: (m) => fmtStr(L.shDependencyMissing, { bin: m[1] }) },
    { re: /Hata:\s*yt-dlp hazırlanamadı\./i, out: L.shYtDlpPrepareFailed },
    { re: /Hata:\s*deno hazırlanamadı\./i, out: L.shDenoPrepareFailed },
    { re: /Uyarı:\s*ffprobe yok/i,      out: L.shFfprobeMissing },
    { re: /Hata:\s*Jellyfin oturum tokeni alınamadı/i, out: L.shSessionTokenMissing },
    { re: /Hata:\s*TMDB_API_KEY ayarla/i, out: L.shSetTmdbApiKey },
    { re: /Hata:\s*JF_API_KEY ve TMDB_API_KEY ayarla/i, out: L.shSetApiKeys },
    { re: /OVERWRITE_POLICY geçersiz/i, out: L.shInvalidOverwrite },
    { re: /Kullanıcı bulunamadı/i,      out: L.shUserNotFound },
    { re: /Eşzamanlı indirme limiti:\s*(\d+)/i,
      out: (m) => fmtStr(L.shConcurrentDownloadLimit, { n: m[1] }) },
    { re: /\[DEBUG\]\s*İşleniyor:\s*(.+?)\s*\(IMDb:\s*(.*?),\s*TMDb:\s*(.*?),\s*Tür:\s*(.+?)\)/i,
      out: (m) => fmtStr(L.shProcessing, { name: m[1], imdb: m[2] || '-', tmdb: m[3] || '-', type: m[4] }) },
    { re: /Zaten var: .*theme\.mp4 kuruldu\/korundu/i, out: L.shAlreadyExistsThemeDone },
    { re: /Zaten var:/i,               out: L.shAlreadyExists },
    { re: /Üzerine yazılacak:/i,       out: L.shOverwriteReplace },
    { re: /if-better modu/i,           out: L.shIfBetterMode },
    { re: /TMDb ID yok/i,              out: L.shTmdbMissing },
    { re: /Series TMDb yok|Series TMDb/i, out: L.shSeriesTmdbMissing },
    { re: /Tür desteklenmiyor/i,       out: L.shUnsupportedType },
    { re: /Yol yok/i,                  out: L.shNoPath },
    { re: /Aynı klasör bu çalıştırmada zaten işlendi:\s*(.+?)\s*->\s*(.+?)\s*\(([^()]*)\)\s*$/i,
      out: (m) => fmtStr(L.shDirAlreadyHandled, { dir: m[1], name: m[2], year: m[3] }) },
    { re: /Yazılamayan klasör,\s*atlanıyor:\s*(.+?)\s*->\s*(.+?)\s*\(([^()]*)\)\s*$/i,
      out: (m) => fmtStr(L.shDirNotWritable, { dir: m[1], name: m[2], year: m[3] }) },
    { re: /Hedefte yetersiz boş alan/i, out: L.shInsufficientSpaceDest },
    { re: /Çalışma klasöründe yetersiz boş alan/i, out: L.shInsufficientSpaceWork },
    { re: /Denenen #(\d+):\s*([a-z]+):([A-Za-z0-9_\-]+)/i,
      out: (m) => fmtStr(L.shTryingCandidate, { n: m[1], site: m[2], key: m[3] }) },
    { re: /\[INDIR\]\s*(.+?)\s*\((.*?)\)\s*->\s*(.+?)\s*\[([a-z]+):([A-Za-z0-9_\-]+)\]\s*\((?:best mp4|source quality)\)/i,
      out: (m) => fmtStr(L.shDownloading, { name: m[1], year: m[2], out: m[3], site: m[4], key: m[5] }) },
    { re: /yt-dlp deneme #(\d+) başarısız/i,
      out: (m) => fmtStr(L.shYtDlpRetryFail, { n: m[1] }) },
    { re: /yt-dlp stderr:\s*(.+)$/i,
      out: (m) => fmtStr(L.shYtDlpStderr, { line: m[1] }) },
    { re: /yt-dlp çıktı:\s*(.+)$/i,
      out: (m) => fmtStr(L.shYtDlpStdout, { line: m[1] }) },
    { re: /Diskte yer kalmamış/i, out: L.shNoSpaceLeft },
    { re: /Dosya çok küçük/i,          out: L.shFileTooSmall },
    { re: /Süre kısa/i,                out: L.shDurationShort },
    { re: /Yeni trailer daha iyi bulundu.*değiştiriliyor/i, out: L.shIfBetterNewIsBetter },
    { re: /Mevcut trailer daha iyi\/eşdeğer.*yenisi silindi/i, out: L.shIfBetterOldIsBetter },
    { re: /mv başarısız,\s*yazılamıyor:\s*(.+)$/i,
      out: (m) => fmtStr(L.shMoveFailed, { path: m[1] }) },
    { re: /Eklendi ve yenilendi/i,     out: L.shMovedAddedRefreshed },
    { re: /Uygun indirilebilir trailer bulunamadı/i, out: L.shNoDownloadableFound },
    { re: /NFO yolu çözülemedi:\s*(.+)$/i,
      out: (m) => fmtStr(L.shNfoPathResolveFailed, { name: m[1] }) },
    { re: /Refresh çağrısı başarısız:\s*(.+)$/i,
      out: (m) => `${L.shRefreshFailed}: ${m[1]}` },
    { re: /Trailer bulunamadı:\s*(.+)$/i,
      out: (m) => `${L.urlNfoNotFound}: ${m[1]}` },
    { re: /backdrops klasörü oluşturulamadı:\s*(.+)$/i,
      out: (m) => fmtStr(L.shBackdropsDirCreateFailed, { dir: m[1] }) },
    { re: /theme\.mp4 için symlink oluşturuldu \(mode=symlink\):\s*(.+?)\s*->\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeSymlinkCreated, { path: m[1], target: m[2] }) },
    { re: /symlink mümkün değil,\s*hardlink fallback kullanıldı \(mode=symlink\):\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeHardlinkFallback, { path: m[1] }) },
    { re: /Symlink\/hardlink oluşturulamadı,\s*theme\.mp4 atlanıyor \(mode=symlink\)\./i,
      out: L.shThemeSymlinkFailed },
    { re: /theme\.mp4 için hardlink oluşturuldu \(mode=hardlink\):\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeHardlinkCreated, { path: m[1] }) },
    { re: /hardlink mümkün değil,\s*symlink fallback kullanıldı \(mode=hardlink\):\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeSymlinkFallback, { path: m[1] }) },
    { re: /Hardlink\/symlink oluşturulamadı,\s*theme\.mp4 atlanıyor \(mode=hardlink\)\./i,
      out: L.shThemeHardlinkFailed },
    { re: /theme\.mp4 kopyalandı \(mode=copy\):\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeCopied, { path: m[1] }) },
    { re: /copy mode:\s*theme\.mp4 kopyalanamadı:\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeCopyFailed, { path: m[1] }) },
    { re: /backdrops\/theme\.mp4 hazırlandı\s*(?:→|->)\s*(.+)$/i,
      out: (m) => fmtStr(L.shThemeReady, { path: m[1] }) },
    { re: /Geçici dosyalar temizleniyor/i, out: L.shCleaningTemps },
    { re: /BİTTİ:\s*işlenen\s*=\s*(\d+)/i, out: (m) => fmtStr(L.shFinishedCount, { n: m[1] }) },
    { re: /ÖZET\s*->\s*indirilen\s*=\s*(\d+)\s*,\s*başarısız\s*=\s*(\d+)(?:\s*,\s*atlanan(?:\(zaten vardı\))?\s*=\s*(\d+))?/i,
      out: (m) => fmtStr(L.shSummaryLine, { ok: m[1], fail: m[2], skip: m[3] ?? '?' }) },
  ];

  for (const rule of rules) {
    const m = rawLine.match(rule.re) || line.match(rule.re);
    if (m) return typeof rule.out === 'function' ? rule.out(m) : rule.out;
  }
  return line;
}

function translateLogBlock(allText, L) {
  if (!allText) return '';
  return allText
    .split(/\r?\n/)
    .map((ln) => translateLogLine(ln, L))
    .join('\n');
}

export function createTrailersPanel(config, labels) {
  const L = {
    trailersHeader: labels?.trailersHeader || 'Fragman İndirme / NFO Ayarları',
    enableTrailerDownloader: labels?.enableTrailerDownloader || 'Fragman indir (trailers.sh)',
    enableTrailerUrlNfo: labels?.enableTrailerUrlNfo || 'Sadece URLyi NFO ya yaz (trailersurl.sh)',
    jfBase: labels?.jfBase || 'Jellyfin URL (JF_BASE)',
    jfBaseAutoNote: labels?.jfBaseAutoNote || 'Jellyfin URL aktif oturumdan otomatik algılanır.',
    tmdbApiKey: labels?.tmdbApiKey || 'TMDb API Key (TMDB_API_KEY)',
    preferredLang: labels?.preferredLang || 'Tercih edilen dil (PREFERRED_LANG)',
    fallbackLang: labels?.fallbackLang || 'Yedek dil (FALLBACK_LANG)',
    trailerMinResolution: labels?.trailerMinResolution || 'Minimum trailer çözünürlüğü',
    trailerMaxResolution: labels?.trailerMaxResolution || 'Maksimum trailer çözünürlüğü',
    trailerResolutionHint: labels?.trailerResolutionHint || 'İndirilebilir formatlar seçtiğin çözünürlük aralığına göre filtrelenir.',
    maxConcurrentDownloads: labels?.maxConcurrentDownloads || 'Eşzamanlı indirme sayısı',
    maxConcurrentDownloadsHint: labels?.maxConcurrentDownloadsHint || '1 = tek tek. 2, 3, 4 gibi değerler aynı anda o kadar indirme başlatır.',
    overwritePolicy: labels?.overwritePolicy || 'Overwrite Policy (trailers.sh)',
    enableThemeLink: labels?.enableThemeLink || 'backdrops/theme.mp4 symlink/kopya oluştur (ENABLE_THEME_LINK)',
    themeLinkMode: labels?.themeLinkMode || 'THEME_LINK_MODE',
    saveSettings: labels?.saveSettings || 'Kaydet',
    runNow: labels?.runNow || 'Şimdi Çalıştır',
    saving: labels?.saving || 'Kaydediliyor...',
    running: labels?.running || 'Çalışıyor...',
    preparing: labels?.preparing || 'Hazırlanıyor...',
    settingsSaved: labels?.settingsSaved || 'Ayarlar kaydedildi.',
    atLeastOneOption: labels?.atLeastOneOption || 'En az bir seçenek işaretlenmeli.',
    done: labels?.done || 'İşlem tamamlandı.',
    runError: labels?.runError || 'Çalıştırma hatası.',
    saveError: labels?.saveError || 'Ayarlar kaydedilemedi: ',
    summaryDownloaderTitle: labels?.summaryDownloaderTitle || 'İndirici (trailers.sh)',
    summaryUrlNfoTitle: labels?.summaryUrlNfoTitle || 'NFO (trailersurl.sh)',
    summarySuccess: labels?.summarySuccess || 'Başarılı',
    summaryFailed: labels?.summaryFailed || 'Başarısız',
    summaryTotal: labels?.summaryTotal || 'Toplam',
    overwriteSkip: labels?.overwriteSkip || 'Atla (skip)',
    overwriteReplace: labels?.overwriteReplace || 'Üzerine yaz (replace)',
    overwriteIfBetter: labels?.overwriteIfBetter || 'Daha iyiyse değiştir (if-better)',
    modeSymlink: labels?.modeSymlink || 'Sembolik bağ (symlink)',
    modeHardlink: labels?.modeHardlink || 'Sıkı bağ (hardlink)',
    modeCopy: labels?.modeCopy || 'Kopyala (copy)',
    settingsReadOnly: labels?.settingsReadOnly || 'Yönetici olmayan kullanıcılar ayarları değiştiremez',
    confirmTitle: labels?.confirmTitle || 'Uzun Süreli İşlem',
    confirmBody: labels?.confirmBody || 'Bu işlem uzun sürebilir. Devam etmek istiyor musunuz?',
    confirmOk: labels?.confirmOk || 'Evet, Başlat',
    confirmCancel: labels?.confirmCancel || 'Vazgeç',
    confirm: labels?.confirm || 'Başlat',
    cancel: labels?.cancel || 'İptal Et',
    copy: labels?.copy || 'Kopyala',
    log: labels?.log || 'Canlı Log',
    clean: labels?.clean || 'Temizle',
    close: labels?.close || 'Kapat',
    adim: labels?.adim || 'Yürütülen',
    copied: labels?.copied || 'Panoya Kopyalandı',
    copyFailed: labels?.copyFailed || 'Kopyalanamadı',
    showLog: labels?.showLog || "Log'u Göster",
    hideLog: labels?.hideLog || "Log'u Gizle",
    noLogToCopy: labels?.noLogToCopy || 'Kopyalanacak log yok',
    progressTitle: labels?.progressTitle || 'Fragman Görevi Çalışıyor',
    progressStartedAtLabel: labels?.progressStartedAtLabel || 'Başlangıç',
    progressStepLabel: labels?.progressStepLabel || 'Adım',
    progressItemsLabel: labels?.progressItemsLabel || 'Öğe',
    progressItemsPending: labels?.progressItemsPending || 'Hazırlanıyor...',
    stopButton: labels?.stopButton || 'Bitir',
    stopping: labels?.stopping || 'Durduruluyor...',
    cancelled: labels?.cancelled || 'İş iptal edildi.',
    alreadyRunning: labels?.alreadyRunning || 'Zaten çalışan bir iş var; ilerlemeye bağlanılıyor.',
    ctrlApiUserHeaderRequired: labels?.ctrlApiUserHeaderRequired || 'X-Emby-UserId header gerekli.',
    ctrlApiTokenHeaderRequired: labels?.ctrlApiTokenHeaderRequired || 'X-Emby-Token header gerekli.',
    ctrlApiExecutionDisabled: labels?.ctrlApiExecutionDisabled || 'Script çalıştırma kapalı.',
    ctrlApiNoTaskEnabled: labels?.ctrlApiNoTaskEnabled || 'Hiçbir görev etkin değil.',
    ctrlApiPluginConfigUnavailable: labels?.ctrlApiPluginConfigUnavailable || 'Plugin konfigürasyonu kullanılamıyor.',
    ctrlApiPluginConfigHint: labels?.ctrlApiPluginConfigHint || 'Docker içinde /config/plugins ve /config/plugins/configurations yazılabilir olmalı; plugin gerçekten yüklü mü kontrol et.',
    ctrlApiCancelInProgress: labels?.ctrlApiCancelInProgress || 'İş iptal ediliyor...',
    ctrlApiNoRunningJob: labels?.ctrlApiNoRunningJob || 'Koşan iş yok.',
    ctrlApiUnexpectedError: labels?.ctrlApiUnexpectedError || 'Beklenmeyen hata oluştu.',
    ctrlLastCancelRequested: labels?.ctrlLastCancelRequested || 'İş iptal istendi.',
    ctrlLastStepStarting: labels?.ctrlLastStepStarting || '{step} başlıyor...',
    ctrlLastStepFinished: labels?.ctrlLastStepFinished || '{step} bitti.',
    ctrlLastFinishedDuration: labels?.ctrlLastFinishedDuration || 'Bitti ✓ ({seconds} sn)',
    logInfo: labels?.logInfo || '[INFO]',
    logWarn: labels?.logWarn || '[WARN]',
    logError: labels?.logError || '[HATA]',
    logOk: labels?.logOk || '[OK]',
    logSkip: labels?.logSkip || '[ATLA]',
    logDownload: labels?.logDownload || '[INDIR]',
    logDebug: labels?.logDebug || '[DEBUG]',
    shRequiresBash: labels?.shRequiresBash || "Bu betik bash gerektirir. 'bash trailers.sh' ile çalıştırın.",
    shWorkdirCreateFailed: labels?.shWorkdirCreateFailed || 'Çalışma klasörü oluşturulamadı',
    shDependencyMissing: labels?.shDependencyMissing || 'Eksik bağımlılık: {bin}',
    shFfprobeMissing: labels?.shFfprobeMissing || 'ffprobe yok; süre/boyut kontrolü sınırlı',
    shSessionTokenMissing: labels?.shSessionTokenMissing || 'Jellyfin oturum tokeni alınamadı',
    shSetTmdbApiKey: labels?.shSetTmdbApiKey || 'TMDB_API_KEY ayarlanmalı',
    shSetApiKeys: labels?.shSetApiKeys || 'JF_API_KEY ve TMDB_API_KEY ayarlanmalı',
    shInvalidOverwrite: labels?.shInvalidOverwrite || 'OVERWRITE_POLICY geçersiz (skip|replace|if-better)',
    shUserNotFound: labels?.shUserNotFound || 'Kullanıcı bulunamadı',
    shYtDlpPrepareFailed: labels?.shYtDlpPrepareFailed || 'yt-dlp hazırlanamadı',
    shDenoPrepareFailed: labels?.shDenoPrepareFailed || 'deno hazırlanamadı',
    shConcurrentDownloadLimit: labels?.shConcurrentDownloadLimit || 'Eşzamanlı indirme limiti: {n}',
    shProcessing: labels?.shProcessing || 'İşleniyor: {name} (IMDb: {imdb}, TMDb: {tmdb}, Tür: {type})',
    shAlreadyExistsThemeDone: labels?.shAlreadyExistsThemeDone || 'Zaten var, theme.mp4 kuruldu/korundu',
    shAlreadyExists: labels?.shAlreadyExists || 'Zaten var',
    shOverwriteReplace: labels?.shOverwriteReplace || 'Üzerine yazılacak',
    shIfBetterMode: labels?.shIfBetterMode || 'if-better modu: karşılaştırma için indirilecek',
    shTmdbMissing: labels?.shTmdbMissing || 'TMDb ID yok',
    shSeriesTmdbMissing: labels?.shSeriesTmdbMissing || 'Dizi TMDb ID yok',
    shUnsupportedType: labels?.shUnsupportedType || 'Tür desteklenmiyor',
    shNoPath: labels?.shNoPath || 'Yol yok',
    shDirAlreadyHandled: labels?.shDirAlreadyHandled || 'Aynı klasör bu çalıştırmada zaten işlendi: {dir} -> {name} ({year})',
    shDirNotWritable: labels?.shDirNotWritable || 'Yazılamayan klasör, atlanıyor: {dir} -> {name} ({year})',
    shInsufficientSpaceDest: labels?.shInsufficientSpaceDest || 'Hedefte yetersiz boş alan',
    shInsufficientSpaceWork: labels?.shInsufficientSpaceWork || 'Çalışma klasöründe yetersiz boş alan',
    shTryingCandidate: labels?.shTryingCandidate || 'Denenen aday #{n}: {site}:{key}',
    shDownloading: labels?.shDownloading || '{name} ({year}) indiriliyor → {out} [{site}:{key}]',
    shYtDlpRetryFail: labels?.shYtDlpRetryFail || 'yt-dlp denemesi başarısız (#{n})',
    shYtDlpStderr: labels?.shYtDlpStderr || 'yt-dlp stderr: {line}',
    shYtDlpStdout: labels?.shYtDlpStdout || 'yt-dlp çıktı: {line}',
    shNoSpaceLeft: labels?.shNoSpaceLeft || 'Diskte yer kalmadı',
    shFileTooSmall: labels?.shFileTooSmall || 'Dosya çok küçük',
    shDurationShort: labels?.shDurationShort || 'Süre kısa',
    shIfBetterNewIsBetter: labels?.shIfBetterNewIsBetter || 'Yeni trailer daha iyi (if-better): değiştiriliyor',
    shIfBetterOldIsBetter: labels?.shIfBetterOldIsBetter || 'Mevcut trailer daha iyi/eşdeğer: yenisi silindi',
    shMoveFailed: labels?.shMoveFailed || 'Taşıma başarısız, hedefe yazılamıyor: {path}',
    shMovedAddedRefreshed: labels?.shMovedAddedRefreshed || 'Eklendi ve yenilendi',
    shNoDownloadableFound: labels?.shNoDownloadableFound || 'Uygun indirilebilir trailer bulunamadı',
    shNfoPathResolveFailed: labels?.shNfoPathResolveFailed || 'NFO yolu çözülemedi: {name}',
    shBackdropsDirCreateFailed: labels?.shBackdropsDirCreateFailed || 'backdrops klasörü oluşturulamadı: {dir}',
    shThemeSymlinkCreated: labels?.shThemeSymlinkCreated || 'theme.mp4 için symlink oluşturuldu (mode=symlink): {path} -> {target}',
    shThemeHardlinkFallback: labels?.shThemeHardlinkFallback || 'symlink mümkün değil, hardlink fallback kullanıldı (mode=symlink): {path}',
    shThemeSymlinkFailed: labels?.shThemeSymlinkFailed || 'Symlink/hardlink oluşturulamadı, theme.mp4 atlanıyor (mode=symlink)',
    shThemeHardlinkCreated: labels?.shThemeHardlinkCreated || 'theme.mp4 için hardlink oluşturuldu (mode=hardlink): {path}',
    shThemeSymlinkFallback: labels?.shThemeSymlinkFallback || 'hardlink mümkün değil, symlink fallback kullanıldı (mode=hardlink): {path}',
    shThemeHardlinkFailed: labels?.shThemeHardlinkFailed || 'Hardlink/symlink oluşturulamadı, theme.mp4 atlanıyor (mode=hardlink)',
    shThemeCopied: labels?.shThemeCopied || 'theme.mp4 kopyalandı (mode=copy): {path}',
    shThemeCopyFailed: labels?.shThemeCopyFailed || 'copy mode: theme.mp4 kopyalanamadı: {path}',
    shThemeReady: labels?.shThemeReady || 'backdrops/theme.mp4 hazırlandı -> {path}',
    shCleaningTemps: labels?.shCleaningTemps || 'Geçici dosyalar temizleniyor',
    shFinishedCount: labels?.shFinishedCount || 'Bitti: işlenen={n}',
    shSummaryLine: labels?.shSummaryLine || 'ÖZET -> indirilen={ok}, başarısız={fail}, atlanan={skip}',
    rxFinishedProcessed: labels?.rxFinishedProcessed || 'BİTTİ:\\s*işlenen\\s*=\\s*(\\d+)',
    rxSummaryOkFail: labels?.rxSummaryOkFail || 'ÖZET\\s*->\\s*indirilen\\s*=\\s*(\\d+)\\s*,\\s*başarısız\\s*=\\s*(\\d+)',
    urlNfoTotal: labels?.urlNfoTotal || 'Toplam işlenen öğe',
    urlNfoOk: labels?.urlNfoOk || 'Başarılı (NFO eklendi)',
    urlNfoNotFound: labels?.urlNfoNotFound || 'Trailer bulunamadı',
    urlNfoFailWrite: labels?.urlNfoFailWrite || 'NFO yazma hatası',
    urlNfoFailRefresh: labels?.urlNfoFailRefresh || 'Refresh hatası',
    urlNfoNoTmdb: labels?.urlNfoNoTmdb || 'TMDb ID yok',
    urlNfoNoPath: labels?.urlNfoNoPath || 'Yol (Path) yok',
    urlNfoUnsupported: labels?.urlNfoUnsupported || 'Desteklenmeyen tür',
    urlNfoMisc: labels?.urlNfoMisc || 'Diğer/çeşitli',
  };
  function baseBtnCss() {
    return `appearance:none; border:1px solid rgba(255,255,255,.15); background: transparent; color:inherit; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;`;
  }
  function primaryBtnCss() {
    return `appearance:none; border:1px solid rgba(34,197,94,.6); background: rgba(34,197,94,.1); color:#bbf7d0; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;`;
  }
  function dangerBtnCss() {
    return `appearance:none; border:1px solid rgba(239,68,68,.6); background: rgba(239,68,68,.12); color:#fecaca; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;`;
  }

  function createModal() {
    const overlay = document.createElement('div');
    overlay.className = 'jf-modal-overlay';
    overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; z-index: 99999;`;

    const modal = document.createElement('div');
    modal.className = 'jf-modal';
    modal.style.cssText = `width: min(820px, 94vw); background: var(--theme-body-bg, #111827); color: var(--theme-body-text, #e5e7eb); border-radius: 16px; padding: 18px 18px 16px; box-shadow: 0 10px 40px rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; max-height:90vh;`;

    const title = document.createElement('div');
    title.className = 'jf-modal-title';
    title.style.cssText = `font-weight:700; font-size:1.05rem; margin-bottom:6px;`;

    const body = document.createElement('div');
    body.className = 'jf-modal-body';
    body.style.cssText = `font-size:.95rem; opacity:.9; margin-bottom:12px; white-space:pre-wrap;`;

    const progressWrap = document.createElement('div');
    progressWrap.style.cssText = `margin:6px 0 8px 0; display:none;`;

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `height: 10px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden;`;
    const progressInner = document.createElement('div');
    progressInner.style.cssText = `height:100%; width:0%; background: linear-gradient(90deg, #22c55e, #84cc16); transition: width .35s ease;`;
    progressBar.appendChild(progressInner);
    progressWrap.appendChild(progressBar);

    const sub = document.createElement('div');
    sub.className = 'jf-modal-sub';
    sub.style.cssText = `font-size:.82rem; opacity:.85; margin:6px 0;`;

    const logWrap = document.createElement('div');
    logWrap.style.cssText = `display:none; margin-top:6px; flex:1; min-height:140px; overflow-y: scroll; overflow-x: hidden; scrollbar-color: #e91e63 #20202000 !important; scrollbar-width: thin; padding: 5px;`;

    const logHeader = document.createElement('div');
    logHeader.style.cssText = `display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;`;
    const logTitle = document.createElement('span');
    logTitle.textContent = L.log;
    logTitle.style.cssText = 'opacity:.9;';
    const logBtns = document.createElement('div');
    logBtns.style.cssText = 'display:flex; gap:6px;';

    const btnCopyLog = document.createElement('button');
    btnCopyLog.textContent = L.copy;
    btnCopyLog.style.cssText = baseBtnCss();
    const btnClearLog = document.createElement('button');
    btnClearLog.textContent = L.clean;
    btnClearLog.style.cssText = baseBtnCss();

    logBtns.append(btnCopyLog, btnClearLog);
    logHeader.append(logTitle, logBtns);

    const log = document.createElement('pre');
    log.className = 'jf-modal-log';
    log.style.cssText = `background: rgba(255,255,255,.06); padding:10px; border-radius:12px; height:100%; overflow:auto; white-space:pre-wrap; font-size:.83rem; line-height:1.25;`;

    logWrap.append(logHeader, log);

    const row = document.createElement('div');
    row.style.cssText = `display:flex; gap:8px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;`;

    const btnToggleLog = document.createElement('button');
    btnToggleLog.textContent = L.showLog;
    btnToggleLog.className = 'btn-toggle-log';
    btnToggleLog.style.cssText = baseBtnCss();
    btnToggleLog.style.display = 'none';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = L.cancel;
    btnCancel.className = 'btn-cancel';
    btnCancel.style.cssText = baseBtnCss();

    const btnOk = document.createElement('button');
    btnOk.textContent = L.confirm;
    btnOk.className = 'btn-ok';
    btnOk.style.cssText = primaryBtnCss();

    const btnStop = document.createElement('button');
    btnStop.textContent = L.stopButton;
    btnStop.className = 'btn-stop';
    btnStop.style.cssText = dangerBtnCss();
    btnStop.style.display = 'none';

    row.append(btnToggleLog, btnCancel, btnStop, btnOk);
    modal.append(title, body, progressWrap, sub, logWrap, row);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    btnCopyLog.onclick = async () => {
      const txt = log.textContent || '';
      if (!txt.trim()) {
        showNotification(L.noLogToCopy, 2200, 'warning');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(txt);
        } else {
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          ta.style.pointerEvents = 'none';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showNotification(L.copied, 2500, 'success');
      } catch (e) {
        showNotification(L.copyFailed, 2500, 'error');
      }
    };
    btnClearLog.onclick = () => { log.textContent = ''; };

    logWrap.dataset.forceHidden = '0';

    btnToggleLog.onclick = () => {
      const hidden = logWrap.style.display === 'none';
      if (hidden) {
        logWrap.style.display = '';
        btnToggleLog.textContent = L.hideLog;
        logWrap.dataset.forceHidden = '0';
      } else {
        logWrap.style.display = 'none';
        btnToggleLog.textContent = L.showLog;
        logWrap.dataset.forceHidden = '1';
      }
    };

    return { overlay, modal, title, body, progressWrap, progressBar, progressInner, sub, logWrap, log, btnCancel, btnOk, btnStop, btnToggleLog };
  }
  const panel = document.createElement('div');
  panel.id = 'trailers-panel';
  panel.className = 'settings-panel';

  const section = createSection(L.trailersHeader);
  panel.appendChild(section);

  let isAdminUser = false;
  const trailerDownloaderCheckbox = createCheckbox('EnableTrailerDownloader', L.enableTrailerDownloader, config?.EnableTrailerDownloader === true);
  const trailerUrlNfoCheckbox     = createCheckbox('EnableTrailerUrlNfo',     L.enableTrailerUrlNfo,     config?.EnableTrailerUrlNfo === true);

  function getChk(elOrId) {
    if (elOrId instanceof HTMLElement) return elOrId.querySelector('input[type="checkbox"]');
    const byId = document.getElementById(elOrId);
    if (byId && byId.tagName === 'INPUT') return byId;
    const wrap = byId || document.querySelector(`#${CSS.escape(elOrId)}`);
    return wrap?.querySelector?.('input[type="checkbox"]') || null;
  }
  function exclusifyRefs(aInput, bInput) {
    if (!aInput || !bInput) return;
    const tie = (src, dst) => src.addEventListener('change', () => { if (src.checked) dst.checked = false; });
    tie(aInput, bInput); tie(bInput, aInput);
  }

  section.appendChild(trailerDownloaderCheckbox);
  section.appendChild(trailerUrlNfoCheckbox);
  exclusifyRefs(getChk(trailerDownloaderCheckbox), getChk(trailerUrlNfoCheckbox));

  const nonAdminInfo = document.createElement('div');
  nonAdminInfo.className = 'admin-info-message';
  nonAdminInfo.style.display = 'none';
  nonAdminInfo.style.color = '#ff6b6b';
  nonAdminInfo.style.margin = '10px 0';
  nonAdminInfo.style.fontStyle = 'italic';
  nonAdminInfo.textContent = L.settingsReadOnly;
  section.appendChild(nonAdminInfo);

  const adminOnlyWrap = document.createElement('div');
  adminOnlyWrap.id = 'trailers-admin-fields';
  adminOnlyWrap.style.display = 'none';
  section.appendChild(adminOnlyWrap);

  const modal = createModal();
  let pollTimer = null;
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() { stopPolling(); pollTimer = setInterval(() => pollStatus(), 2000); }

  async function connectIfRunning({ forceOpen = false } = {}) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/JMSFusion/trailers/status', { method: 'GET', headers });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok === true && data.running) {
        if (forceOpen || modal.overlay.style.display === 'none') openProgressUi();
        updateProgressUi(data);
        startPolling();
        return true;
      }
    } catch {}
    return false;
  }

  async function pollStatus() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/JMSFusion/trailers/status', { method: 'GET', headers });
      const data = await res.json().catch(() => ({}));
      if (!data || data.ok !== true) return;

      if (data.running) {
        setJobFlag(true);
        updateProgressUi(data);
      } else {
        updateProgressUi(data);
        setJobFlag(false);
        stopPolling();
      }
    } catch {}
  }

  function openConfirmUi() {
    modal.title.textContent = L.confirmTitle;
    modal.body.textContent = L.confirmBody;
    modal.sub.textContent = '';
    modal.progressWrap.style.display = 'none';
    modal.logWrap.style.display = 'none';
    modal.btnToggleLog.style.display = 'none';
    modal.btnOk.textContent = L.confirmOk;
    modal.btnOk.style.display = '';
    modal.btnStop.style.display = 'none';
    modal.btnCancel.textContent = L.confirmCancel;
    modal.overlay.style.display = 'flex';
  }
  function openProgressUi() {
    modal.title.textContent = L.progressTitle;
    modal.body.textContent = '';
    modal.progressWrap.style.display = '';
    if (modal.logWrap.dataset.forceHidden !== '1') {
      modal.logWrap.style.display = '';
    }
    modal.btnOk.style.display = 'none';
    modal.btnStop.style.display = '';
    modal.btnCancel.textContent = L.close;
    modal.btnToggleLog.style.display = '';
    modal.btnToggleLog.textContent = (modal.logWrap.style.display === 'none') ? L.showLog : L.hideLog;
    modal.overlay.style.display = 'flex';
  }

  function toPct(x, fallbackRatio = null) {
    let n = null;
    if (typeof x === 'number') n = x;
    else if (typeof x === 'string') {
      const f = parseFloat(x.replace('%','').trim());
      if (Number.isFinite(f)) n = f;
    }
    if (n == null && typeof fallbackRatio === 'number' && Number.isFinite(fallbackRatio)) {
      n = fallbackRatio * 100;
    }
    if (n == null) return null;
    return Math.max(0, Math.min(100, n));
  }

  function parseDownloaderSummary(stdout) {
    let total=0, success=0, fail=0;
    try {
      const mTotal = matchFirst(stdout, [
        /BİTTİ:\s*işlenen\s*=\s*(\d+)/i,
        new RegExp(L.rxFinishedProcessed, 'i'),
      ]);
      if (mTotal) total = parseIntSafe(mTotal[1]);
      const mLine  = matchFirst(stdout, [
        /ÖZET\s*->\s*indirilen\s*=\s*(\d+)\s*,\s*başarısız\s*=\s*(\d+)/i,
        new RegExp(L.rxSummaryOkFail, 'i'),
      ]);
      if (mLine) { success = parseIntSafe(mLine[1]); fail = parseIntSafe(mLine[2]); }
    } catch {}
    return { success, failed: fail, total };
  }

  function parseUrlNfoSummary(stdout) {
    const pick = (...labels) => {
      const patterns = labels
        .filter(Boolean)
        .map((label) => new RegExp(`${escapeRegExp(label)}\\s*:\\s*(\\d+)`, 'i'));
      const m = matchFirst(stdout, patterns);
      return m ? parseIntSafe(m[1]) : 0;
    };
    const total = pick(L.urlNfoTotal, 'Toplam işlenen öğe');
    const ok = pick(L.urlNfoOk, 'Başarılı (NFO eklendi)');
    const notFound = pick(L.urlNfoNotFound, 'Trailer bulunamadı');
    const failWrite = pick(L.urlNfoFailWrite, 'NFO yazma hatası');
    const failRefresh = pick(L.urlNfoFailRefresh, 'Refresh hatası');
    const noTmdb = pick(L.urlNfoNoTmdb, 'TMDb ID yok');
    const noPath = pick(L.urlNfoNoPath, 'Yol (Path) yok');
    const unsupported = pick(L.urlNfoUnsupported, 'Desteklenmeyen tür');
    const misc = pick(L.urlNfoMisc, 'Diğer/çeşitli');
    const failed = notFound + failWrite + failRefresh + noTmdb + noPath + unsupported + misc;
    return { success: ok, failed, total };
  }

  function updateProgressUi(status) {
    const pct = toPct(status?.progressPercent ?? status?.progress, status?.progress01);
    modal.progressInner.style.width = (pct == null ? (status?.running ? 5 : 100) : pct) + '%';
    modal.body.textContent = buildProgressBody(status, L);

    const stepTxt = status?.currentStep ?? '';
    const stepLabel = translateTrailerStepName(stepTxt, L);
    const lastMessage = translateTrailersLastMessage(status, L);
    if (lastMessage) {
      modal.sub.textContent = pct != null ? `${lastMessage} (${pct.toFixed(1)}%)` : lastMessage;
    } else {
      modal.sub.textContent = stepLabel
        ? `${L.adim}: ${stepLabel}${pct != null ? ` (${pct.toFixed(1)}%)` : ''}`
        : (status?.running ? L.running : L.done);
    }

    if (Array.isArray(status?.log)) {
      if (modal.logWrap.dataset.forceHidden !== '1') {
        modal.logWrap.style.display = '';
        modal.btnToggleLog.textContent = L.hideLog;
      }
      const raw = status.log.join('\n');
      modal.log.textContent = translateLogBlock(raw, L);
      modal.log.scrollTop = modal.log.scrollHeight;
    }

    if (!status?.running) {
      modal.btnStop.style.display = 'none';
      modal.btnCancel.textContent = L.close;

      if (Array.isArray(status?.results) && status.results.length > 0) {
        const lines = [];
        for (const r of status.results) {
          const name = (r?.script || '').toString();
          const stdout = (r?.stdout || '').toString();
          if (/trailers\.sh/i.test(name) || new RegExp(L.rxFinishedProcessed, 'i').test(stdout)) {
            const s = parseDownloaderSummary(stdout);
            lines.push(`${L.summaryDownloaderTitle}: ${L.summarySuccess}: ${s.success}, ${L.summaryFailed}: ${s.failed}${s.total?`, ${L.summaryTotal}: ${s.total}`:''}`);
          } else if (/trailersurl\.sh/i.test(name) || /===== ÖZET =====/i.test(stdout)) {
            const s = parseUrlNfoSummary(stdout);
            lines.push(`${L.summaryUrlNfoTitle}: ${L.summarySuccess}: ${s.success}, ${L.summaryFailed}: ${s.failed}${s.total?`, ${L.summaryTotal}: ${s.total}`:''}`);
          }
        }
        if (lines.length) {
          if (modal.logWrap.dataset.forceHidden !== '1') {
            modal.logWrap.style.display = '';
            modal.btnToggleLog.textContent = L.hideLog;
          }
          const extra = translateLogBlock(lines.join('\n'), L);
          modal.log.textContent += (modal.log.textContent ? '\n' : '') + extra;
          modal.log.scrollTop = modal.log.scrollHeight;
        }
      }
      stopPolling();
      setJobFlag(false);
    }
  }

  modal.btnCancel.onclick = () => { modal.overlay.style.display = 'none'; };

  modal.btnOk.onclick = async () => {
    modal.btnOk.disabled = true;
    try {
      const already = await connectIfRunning({ forceOpen: true });
      if (already) { showNotification(L.alreadyRunning, 2200, 'warning'); return; }

      const body = collectRunBody();
      if (!body.runDownloader && !body.runUrlNfo) {
        showNotification(L.atLeastOneOption, 2500, 'warning');
        modal.overlay.style.display = 'none';
        return;
      }
      openProgressUi();
      updateProgressUi({ running: true, progress: 5, currentStep: L.preparing });

      const headers = await getAuthHeaders();
      const res = await fetch('/JMSFusion/trailers/run', { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      let data = {}; try { data = JSON.parse(txt); } catch {}

      startPolling();
      setJobFlag(true);

      if (res.status === 409) {
        showNotification(L.alreadyRunning, 2500, 'warning');
        await pollStatus();
        return;
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(translateTrailersApiErrorText(data, L, res.status, txt));
      }
    } catch (err) {
      showNotification(L.runError + ' ' + (err?.message || err), 3200, 'error');
      modal.overlay.style.display = 'none';
    } finally {
      modal.btnOk.disabled = false;
    }
  };

  modal.btnStop.onclick = async () => {
    modal.btnStop.disabled = true;
    modal.btnStop.textContent = L.stopping;
    try {
      const headers = await getAuthHeaders();
      await fetch('/JMSFusion/trailers/cancel', { method: 'POST', headers });
      startPolling();
      setTimeout(() => pollStatus(), 300);
    } catch {}
    finally {
      setTimeout(() => {
        modal.btnStop.disabled = false;
        modal.btnStop.textContent = L.stopButton;
      }, 800);
    }
  };

  let out = null;
  let trailerConfig = normalizeTrailerConfigEnvelope(config);

  function setTrailerConfig(nextConfig) {
    trailerConfig = normalizeTrailerConfigEnvelope(nextConfig);
    return trailerConfig;
  }

  function setCheckboxValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.checked = !!value;
  }

  function setTextValue(id, value) {
    const input = document.getElementById(id);
    if (input && value != null) input.value = value;
  }

  function setTopLevelReadOnly(readOnly) {
    const a = document.getElementById('EnableTrailerDownloader');
    const b = document.getElementById('EnableTrailerUrlNfo');
    [a, b].forEach((input) => {
      if (!input) return;
      input.disabled = !!readOnly;
      input.title = readOnly ? L.settingsReadOnly : '';
    });
  }

  function applyTopLevelConfig(source) {
    setCheckboxValue('EnableTrailerDownloader', coerceBoolean(pickConfigValue(source, 'enableTrailerDownloader', 'EnableTrailerDownloader')));
    setCheckboxValue('EnableTrailerUrlNfo', coerceBoolean(pickConfigValue(source, 'enableTrailerUrlNfo', 'EnableTrailerUrlNfo')));
  }

  function applyResolutionInputs(bounds) {
    const minSel = document.getElementById('TrailerMinResolution');
    const maxSel = document.getElementById('TrailerMaxResolution');
    if (minSel) minSel.value = String(bounds.min);
    if (maxSel) maxSel.value = String(bounds.max);
  }

  function getSelectedResolutionBounds() {
    const minSel = document.getElementById('TrailerMinResolution');
    const maxSel = document.getElementById('TrailerMaxResolution');

    if (!minSel || !maxSel) {
      return getResolutionBounds(trailerConfig);
    }

    return getResolutionBounds({
      trailerMinResolution: minSel.value,
      trailerMaxResolution: maxSel.value
    });
  }

  function createSelectWrap(id, label, options, selectedValue) {
    const wrap = document.createElement('div');
    wrap.className = 'input-container';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = id;

    const select = document.createElement('select');
    select.id = id;
    select.name = id;

    options.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      if (String(option.value) === String(selectedValue)) opt.selected = true;
      select.appendChild(opt);
    });

    wrap.append(labelEl, select);
    return wrap;
  }

  function createNumberInputWrap(id, label, value, { min = MIN_CONCURRENT_DOWNLOADS, max = MAX_CONCURRENT_DOWNLOADS } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'input-container';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.name = id;
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(normalizeConcurrentDownloads(value));
    input.addEventListener('change', () => {
      input.value = String(normalizeConcurrentDownloads(input.value));
    });

    wrap.append(labelEl, input);
    return wrap;
  }

  function wireResolutionBounds() {
    const minSel = document.getElementById('TrailerMinResolution');
    const maxSel = document.getElementById('TrailerMaxResolution');
    if (!minSel || !maxSel) return;

    minSel.addEventListener('change', () => {
      if (Number(minSel.value) > Number(maxSel.value)) {
        maxSel.value = minSel.value;
      }
    });

    maxSel.addEventListener('change', () => {
      if (Number(maxSel.value) < Number(minSel.value)) {
        minSel.value = maxSel.value;
      }
    });
  }

  async function loadLatestTrailerConfig() {
    const headers = await getAuthHeaders();
    const res = await fetch('/JMSFusion/config', { method: 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const latestPayload = await res.json();
    const latestConfig = setTrailerConfig(latestPayload);
    applyTopLevelConfig(latestConfig);
    return latestConfig;
  }

  function attachAdminFields() {
    out = document.createElement('pre');
    out.className = 'script-output';
    out.style.cssText = 'white-space:pre-wrap; max-height:280px; overflow:auto; margin-top:8px;';

    const getAutoJfBase = () => resolveAutoJfBase(trailerConfig);
    const syncJfBaseInput = (fallbackValue = '') => {
      const input = document.getElementById('JFBase');
      if (!input) return '';

      const resolved = getAutoJfBase() || normalizeBaseUrl(fallbackValue);
      if (!resolved) return '';

      if (input.value !== resolved) input.value = resolved;
      input.readOnly = true;
      input.title = L.jfBaseAutoNote;
      return resolved;
    };

    function renderAdminFields() {
      const currentConfig = trailerConfig;
      const resolutionBounds = getResolutionBounds(currentConfig);
      const themeLinkEnabled = Number(pickConfigValue(currentConfig, 'enableThemeLink', 'EnableThemeLink') ?? 0) === 1;
      const themeLinkMode = pickConfigValue(currentConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink';

      adminOnlyWrap.appendChild(createTextInput('JFBase', L.jfBase, getAutoJfBase() || normalizeBaseUrl(pickConfigValue(currentConfig, 'jfBase', 'JFBase')) || ''));
      syncJfBaseInput(pickConfigValue(currentConfig, 'jfBase', 'JFBase'));

      const jfBaseAutoNote = document.createElement('div');
      jfBaseAutoNote.className = 'description-text';
      jfBaseAutoNote.textContent = L.jfBaseAutoNote;
      adminOnlyWrap.appendChild(jfBaseAutoNote);

      adminOnlyWrap.appendChild(createTextInput('PreferredLang', L.preferredLang, pickConfigValue(currentConfig, 'preferredLang', 'PreferredLang') || 'tr-TR'));
      adminOnlyWrap.appendChild(createTextInput('FallbackLang', L.fallbackLang, pickConfigValue(currentConfig, 'fallbackLang', 'FallbackLang') || 'en-US'));
      adminOnlyWrap.appendChild(createNumberInputWrap(
        'MaxConcurrentDownloads',
        L.maxConcurrentDownloads,
        pickConfigValue(currentConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads') ?? DEFAULT_MAX_CONCURRENT_DOWNLOADS
      ));

      const maxConcurrentDownloadsHint = document.createElement('div');
      maxConcurrentDownloadsHint.className = 'description-text';
      maxConcurrentDownloadsHint.textContent = L.maxConcurrentDownloadsHint;
      adminOnlyWrap.appendChild(maxConcurrentDownloadsHint);

      adminOnlyWrap.appendChild(createSelectWrap(
        'TrailerMinResolution',
        L.trailerMinResolution,
        TRAILER_RESOLUTION_OPTIONS.map((value) => ({ value, label: `${value}p` })),
        resolutionBounds.min
      ));
      adminOnlyWrap.appendChild(createSelectWrap(
        'TrailerMaxResolution',
        L.trailerMaxResolution,
        TRAILER_RESOLUTION_OPTIONS.map((value) => ({ value, label: `${value}p` })),
        resolutionBounds.max
      ));
      wireResolutionBounds();

      const resolutionHint = document.createElement('div');
      resolutionHint.className = 'description-text';
      resolutionHint.textContent = L.trailerResolutionHint;
      adminOnlyWrap.appendChild(resolutionHint);

      const tmdbNote = document.createElement('div');
      tmdbNote.className = 'description-text';
      tmdbNote.textContent = `${L.tmdbApiKey}: ${(labels?.tmdbManagedInSlider || 'Slider sekmesindeki tek alandan yönetilir ve burada global config kullanılır.')}`;
      adminOnlyWrap.appendChild(tmdbNote);

      const overwriteWrap = document.createElement('div');
      overwriteWrap.className = 'input-container';
      {
        const l = document.createElement('label');
        l.textContent = L.overwritePolicy;
        l.htmlFor = 'OverwritePolicy';
        const sel = document.createElement('select');
        sel.id = 'OverwritePolicy';
        [
          { value: 'skip', label: L.overwriteSkip },
          { value: 'replace', label: L.overwriteReplace },
          { value: 'if-better', label: L.overwriteIfBetter }
        ].forEach((opt) => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          sel.appendChild(o);
        });
        sel.value = mapEnumToWire(pickConfigValue(currentConfig, 'overwritePolicy', 'OverwritePolicy') || 'Skip');
        overwriteWrap.append(l, sel);
      }
      adminOnlyWrap.appendChild(overwriteWrap);

      adminOnlyWrap.appendChild(createCheckbox('EnableThemeLink', L.enableThemeLink, themeLinkEnabled));
      setCheckboxValue('EnableThemeLink', themeLinkEnabled);

      const modeWrap = document.createElement('div');
      modeWrap.className = 'input-container';
      {
        const l = document.createElement('label');
        l.textContent = L.themeLinkMode;
        l.htmlFor = 'ThemeLinkMode';
        const sel = document.createElement('select');
        sel.id = 'ThemeLinkMode';
        [
          { value: 'symlink', label: L.modeSymlink },
          { value: 'hardlink', label: L.modeHardlink },
          { value: 'copy', label: L.modeCopy }
        ].forEach((opt) => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          sel.appendChild(o);
        });
        sel.value = themeLinkMode;
        modeWrap.append(l, sel);
      }
      adminOnlyWrap.appendChild(modeWrap);

      applyTopLevelConfig(currentConfig);
      applyResolutionInputs(resolutionBounds);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = L.saveSettings;
      saveBtn.style.cssText = primaryBtnCss();

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.textContent = L.runNow;
      runBtn.style.cssText = baseBtnCss();

      btnRow.append(saveBtn, runBtn);
      adminOnlyWrap.append(btnRow, out);

      saveBtn.onclick = async () => {
        const oldText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = L.saving;
        try {
          const a = getChk(trailerDownloaderCheckbox);
          const b = getChk(trailerUrlNfoCheckbox);
          if (a && b && a.checked && b.checked) b.checked = false;

          const payload = {};
          const pushIf = (k, v) => { if (v !== undefined && v !== null && v !== '') payload[k] = v; };
          const selectedBounds = getSelectedResolutionBounds();
          const fallbackJfBase = pickConfigValue(trailerConfig, 'jfBase', 'JFBase');

          pushIf('AllowScriptExecution', true);
          if (a) pushIf('EnableTrailerDownloader', !!a.checked);
          if (b) pushIf('EnableTrailerUrlNfo', !!b.checked);

          pushIf('JFBase', syncJfBaseInput(fallbackJfBase) || getAutoJfBase());
          pushIf('PreferredLang', document.getElementById('PreferredLang')?.value?.trim());
          pushIf('FallbackLang', document.getElementById('FallbackLang')?.value?.trim());
          pushIf('MaxConcurrentDownloads', normalizeConcurrentDownloads(document.getElementById('MaxConcurrentDownloads')?.value));
          pushIf('TrailerMinResolution', selectedBounds.min);
          pushIf('TrailerMaxResolution', selectedBounds.max);

          const opWire = document.getElementById('OverwritePolicy')?.value || 'skip';
          pushIf('OverwritePolicy', opWire);
          pushIf('EnableThemeLink', document.getElementById('EnableThemeLink')?.checked ? 1 : 0);
          pushIf('ThemeLinkMode', document.getElementById('ThemeLinkMode')?.value || 'symlink');

          const headers = await getAuthHeaders();
          const res = await fetch('/JMSFusion/config', { method: 'POST', headers, body: JSON.stringify(payload) });
          const txt = await res.text();
          let data = {};
          try { data = JSON.parse(txt); } catch {}
          if (!res.ok) throw new Error(data?.error || data?.Message || `HTTP ${res.status}: ${txt}`);

          const savedConfig = setTrailerConfig(data);
          applyTopLevelConfig(savedConfig);
          applyResolutionInputs(getResolutionBounds(savedConfig));
          setCheckboxValue('EnableThemeLink', Number(pickConfigValue(savedConfig, 'enableThemeLink', 'EnableThemeLink') ?? 0) === 1);
          setTextValue('PreferredLang', pickConfigValue(savedConfig, 'preferredLang', 'PreferredLang'));
          setTextValue('FallbackLang', pickConfigValue(savedConfig, 'fallbackLang', 'FallbackLang'));
          setTextValue('MaxConcurrentDownloads', normalizeConcurrentDownloads(pickConfigValue(savedConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads')));
          syncJfBaseInput(pickConfigValue(savedConfig, 'jfBase', 'JFBase'));

          const overwriteSel = document.getElementById('OverwritePolicy');
          if (overwriteSel) {
            overwriteSel.value = mapEnumToWire(pickConfigValue(savedConfig, 'overwritePolicy', 'OverwritePolicy') || opWire);
          }

          const themeModeSel = document.getElementById('ThemeLinkMode');
          if (themeModeSel) {
            themeModeSel.value = pickConfigValue(savedConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink';
          }

          showNotification(L.settingsSaved, 2500, 'success');
        } catch (e) {
          showNotification(L.saveError + (e?.message || e), 3000, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = oldText;
        }
      };

      runBtn.onclick = async () => {
        const attached = await connectIfRunning({ forceOpen: true });
        if (attached) {
          showNotification(L.alreadyRunning, 2500, 'warning');
          return;
        }

        const body = collectRunBody();
        if (!body.runDownloader && !body.runUrlNfo) {
          showNotification(L.atLeastOneOption, 2500, 'warning');
          return;
        }
        openConfirmUi();
      };

      return out;
    }

    return renderAdminFields();
  }

  function collectRunBody() {
    const currentConfig = trailerConfig;
    const selectedBounds = getSelectedResolutionBounds();
    const autoJfBase = resolveAutoJfBase(currentConfig)
      || document.getElementById('JFBase')?.value
      || pickConfigValue(currentConfig, 'jfBase', 'JFBase');

    const body = {
      runDownloader: getChk(trailerDownloaderCheckbox)?.checked || false,
      runUrlNfo: getChk(trailerUrlNfoCheckbox)?.checked || false,
      jfBase: autoJfBase,
      preferredLang: document.getElementById('PreferredLang')?.value || pickConfigValue(currentConfig, 'preferredLang', 'PreferredLang') || 'tr-TR',
      fallbackLang: document.getElementById('FallbackLang')?.value || pickConfigValue(currentConfig, 'fallbackLang', 'FallbackLang') || 'en-US',
      maxConcurrentDownloads: normalizeConcurrentDownloads(
        document.getElementById('MaxConcurrentDownloads')?.value
          ?? pickConfigValue(currentConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads')
      ),
      trailerMinResolution: selectedBounds.min,
      trailerMaxResolution: selectedBounds.max,
      overwritePolicy: document.getElementById('OverwritePolicy')?.value || mapEnumToWire(pickConfigValue(currentConfig, 'overwritePolicy', 'OverwritePolicy') || 'Skip'),
      enableThemeLink: document.getElementById('EnableThemeLink')?.checked
        ? 1
        : (Number(pickConfigValue(currentConfig, 'enableThemeLink', 'EnableThemeLink') ?? 0) === 1 ? 1 : 0),
      themeLinkMode: document.getElementById('ThemeLinkMode')?.value || pickConfigValue(currentConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink'
    };
    if (body.runDownloader && body.runUrlNfo) body.runUrlNfo = false;
    return body;
  }

  (async () => {
    try {
      try {
        await loadLatestTrailerConfig();
      } catch {}

      isAdminUser = await checkUserIsAdmin();
      if (isAdminUser) {
        setTopLevelReadOnly(false);
        adminOnlyWrap.style.display = '';
        attachAdminFields();
        await connectIfRunning({ forceOpen: false });
        if (getJobFlag()) {
          openProgressUi();
          startPolling();
        }
      } else {
        nonAdminInfo.style.display = '';
        setTopLevelReadOnly(true);
      }
    } catch {
      nonAdminInfo.style.display = '';
      setTopLevelReadOnly(true);
    }
  })();

  return panel;
}
