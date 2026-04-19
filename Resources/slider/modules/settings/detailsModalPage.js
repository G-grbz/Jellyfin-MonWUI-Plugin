import { bindCheckboxKontrol, createCheckbox, createSection } from "./shared.js";

export function createDetailsModalPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "details-modal-panel";
  panel.className = "settings-panel";

  const section = createSection(labels.detailsModalSettingsTab || "Detaylar Modülü Ayarları");

  const description = document.createElement("div");
  description.className = "description-text";
  description.textContent =
    labels.detailsModalSettingsDescription ||
    "Detaylar modülü aktifken hangi alanların gösterileceğini buradan kontrol edebilirsin.";
  section.appendChild(description);

  const fieldsWrap = document.createElement("div");
  fieldsWrap.className = "sub-options details-modal-sub-options";

  fieldsWrap.appendChild(createCheckbox(
    "detailsModalTmdbReviewsEnabled",
    labels.detailsModalTmdbReviewsEnabled || "TMDb yorum alanını göster",
    config.detailsModalTmdbReviewsEnabled !== false
  ));

  fieldsWrap.appendChild(createCheckbox(
    "detailsModalLocalCommentsEnabled",
    labels.detailsModalLocalCommentsEnabled || "Topluluk Yorumları alanını göster",
    config.detailsModalLocalCommentsEnabled === true
  ));

  section.appendChild(fieldsWrap);

  const localCommentsHint = document.createElement("div");
  localCommentsHint.className = "description-text";
  localCommentsHint.textContent =
    labels.detailsModalLocalCommentsHint ||
    "Topluluk Yorumları alanı varsayılan olarak kapalı gelir.";
  section.appendChild(localCommentsHint);

  panel.appendChild(section);

  setTimeout(() => {
    bindCheckboxKontrol("#enableDetailsModalModule", ".details-modal-sub-options", 0.5);
  }, 0);

  return panel;
}
