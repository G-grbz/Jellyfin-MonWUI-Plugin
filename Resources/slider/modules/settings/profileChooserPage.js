import { createCheckbox, createSection, bindCheckboxKontrol } from "../settings.js";

export function createProfileChooserPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "profile-chooser-panel";
  panel.className = "settings-panel";

  const section = createSection(labels?.profileChooserHeader || "Kim İzliyor Ayarları");
  const enableRow = document.createElement("div");
  enableRow.className = "fsetting-item";

  const enableCb = createCheckbox(
    "enableProfileChooser",
    labels?.enableProfileChooser || "Profil seçiciyi (Kim izliyor?) etkinleştir",
    config.enableProfileChooser
  );

  enableRow.appendChild(enableCb);

  const subWrap = document.createElement("div");
  subWrap.className = "profile-chooser-sub";

  const autoRow = document.createElement("div");
  autoRow.className = "fsetting-item profile-chooser-container";

  const autoCb = createCheckbox(
    "profileChooserAutoOpen",
    labels?.profileChooserAutoOpen || "Sayfa açılınca otomatik göster",
    config.profileChooserAutoOpen
  );

  autoRow.appendChild(autoCb);

  const autoRuleWrap = document.createElement("div");
  autoRuleWrap.className = "profile-chooser-auto-sub";

  const autoRuleRow = document.createElement("div");
  autoRuleRow.className = "fsetting-item profile-chooser-container";

  const autoRuleCb = createCheckbox(
    "profileChooserAutoOpenRequireQuickLogin",
    labels?.profileChooserAutoOpenRequireQuickLogin || "En az 1 hızlı giriş varsa otomatik göster",
    config.profileChooserAutoOpenRequireQuickLogin
  );

  autoRuleRow.appendChild(autoRuleCb);
  autoRuleWrap.appendChild(autoRuleRow);

  const rememberRow = document.createElement("div");
  rememberRow.className = "fsetting-item profile-chooser-container";

  const rememberCb = createCheckbox(
    "profileChooserRememberTokens",
    labels?.profileChooserRememberTokens || "Tokenları hatırla (Yerel depolama)",
    config.profileChooserRememberTokens
  );

  rememberRow.appendChild(rememberCb);

  const desc = document.createElement("div");
  desc.className = "description-text";
  desc.textContent =
    labels?.profileChooserDesc ||
    "Bu ayar, Jellyfin arayüzünde Netflix benzeri kullanıcı seçme ekranını açar. Otomatik gösterim, hızlı giriş kuralı ve token hatırlama seçenekleri burada yönetilir.";

  subWrap.append(autoRow, autoRuleWrap, rememberRow, desc);

  section.append(enableRow, subWrap);
  panel.appendChild(section);

  bindCheckboxKontrol(
    "#enableProfileChooser",
    ".profile-chooser-sub",
    0.6,
    [autoCb, autoRuleCb, rememberCb]
  );

  bindCheckboxKontrol(
    "#profileChooserAutoOpen",
    ".profile-chooser-auto-sub",
    0.6,
    [autoRuleCb]
  );

  const enableInput = enableCb.querySelector("input");
  const autoInput = autoCb.querySelector("input");

  const syncAutoRuleVisibility = () => {
    const visible = !!(enableInput?.checked && autoInput?.checked);
    autoRuleWrap.style.display = visible ? "" : "none";
  };

  enableInput?.addEventListener("change", syncAutoRuleVisibility);
  autoInput?.addEventListener("change", syncAutoRuleVisibility);
  syncAutoRuleVisibility();

  return panel;
}
