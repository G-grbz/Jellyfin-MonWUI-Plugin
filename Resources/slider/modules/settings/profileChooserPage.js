import { createCheckbox, createSection, bindCheckboxKontrol } from "../settings.js";

export function createProfileChooserPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "profile-chooser-panel";
  panel.className = "settings-panel";

  const section = createSection(labels?.profileChooserHeader || "Kim izliyor?");
  const enableRow = document.createElement("div");
  enableRow.className = "fsetting-item";
  const enableLabel = document.createElement("label");

  const enableCb = createCheckbox(
    "enableProfileChooser",
    labels?.enableProfileChooser || "Profil seçiciyi (Kim izliyor?) etkinleştir",
    config.enableProfileChooser
  );

  enableLabel.prepend(enableCb);
  enableRow.appendChild(enableLabel);

  const subWrap = document.createElement("div");
  subWrap.className = "profile-chooser-sub";

  const autoRow = document.createElement("div");
  autoRow.className = "fsetting-item profile-chooser-container";
  const autoLabel = document.createElement("label");

  const autoCb = createCheckbox(
    "profileChooserAutoOpen",
    labels?.profileChooserAutoOpen || "Sayfa açılınca otomatik göster",
    config.profileChooserAutoOpen
  );

  autoLabel.prepend(autoCb);
  autoRow.appendChild(autoLabel);

  const rememberRow = document.createElement("div");
  rememberRow.className = "fsetting-item profile-chooser-container";
  const rememberLabel = document.createElement("label");

  const rememberCb = createCheckbox(
    "profileChooserRememberTokens",
    labels?.profileChooserRememberTokens || "Tokenları hatırla (Yerel depolama)",
    config.profileChooserRememberTokens
  );

  rememberLabel.prepend(rememberCb);
  rememberRow.appendChild(rememberLabel);

  const desc = document.createElement("div");
  desc.className = "description-text";
  desc.textContent =
    labels?.profileChooserDesc ||
    "Bu ayar, Jellyfin arayüzünde Netflix benzeri kullanıcı seçme ekranını açar. Otomatik açma ve token hatırlama opsiyonları burada yönetilir.";

  subWrap.append(autoRow, rememberRow, desc);

  section.append(enableRow, subWrap);
  panel.appendChild(section);

  bindCheckboxKontrol(
    "#enableProfileChooser",
    ".profile-chooser-sub",
    0.6,
    [autoCb, rememberCb]
  );

  return panel;
}
