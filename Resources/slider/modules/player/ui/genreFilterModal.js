import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken } from "../core/auth.js";
import { showNotification } from "../ui/notification.js";
import { refreshPlaylist } from "../core/playlist.js";
import { withServer, withParams } from "../../jfUrl.js";


const config = getConfig();
const PLACEHOLDER_IMAGE = "./slider/src/images/defaultArt.png";

let activeModal = null;
let fetchCtrl = null;
let keydownHandler = null;
let prevFocus = null;
let bodyOverflowPrev = null;

export async function showGenreFilterModal() {
  if (activeModal) {
    closeModalSafe();
  }

  try {
    const token = getAuthToken();
    fetchCtrl = new AbortController();

    const response = await fetch(
      withParams(`/MusicGenres`, {
        Recursive: "true",
        IncludeItemTypes: "MusicAlbum,Audio",
        Fields: "PrimaryImageAspectRatio,ImageTags",
        EnableTotalRecordCount: "false",
      }),
      { headers: { "X-Emby-Token": token }, signal: fetchCtrl.signal }
    );

    if (!response.ok) throw new Error("Türler alınamadı");

    const data = await response.json();
    const genres = data.Items || [];

    if (genres.length === 0) {
      showNotification(
        `<i class="fas fa-exclamation-circle"></i> ${config.languageLabels?.noGenresFound || "Tür bulunamadı"}`,
        2000,
        "error"
      );
      return;
    }

    buildModal(genres, token);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("Tür filtresi açılırken hata:", err);
    showNotification(
      `<i class="fas fa-exclamation-triangle"></i> ${config.languageLabels?.genreFilterError || "Tür filtresi yüklenemedi"}`,
      2000,
      "error"
    );
  } finally {
    fetchCtrl = null;
  }
}

function buildModal(genres, token) {
  prevFocus = document.activeElement;
  bodyOverflowPrev = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const modal = document.createElement("div");
  modal.className = "genre-filter-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  const modalContent = document.createElement("div");
  modalContent.className = "genre-filter-modal-content";

  const header = document.createElement("div");
  header.className = "genre-filter-header";

  const title = document.createElement("h3");
  title.innerHTML = `<i class="fas fa-filter"></i> ${config.languageLabels?.filterByGenre || "Türe göre filtrele"}`;
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "genre-filter-close";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.setAttribute("aria-label", "Close modal");
  closeBtn.addEventListener("click", closeModalSafe);
  header.appendChild(closeBtn);

  const searchContainer = document.createElement("div");
  searchContainer.className = "genre-search-container";

  const searchIcon = document.createElement("i");
  searchIcon.className = "fas fa-search genre-search-icon";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = config.languageLabels?.searchGenres || "Türlerde ara…";
  searchInput.className = "genre-filter-search";

  searchContainer.append(searchIcon, searchInput);

  const genresContainer = document.createElement("div");
  genresContainer.className = "genre-filter-container";

  const selectedCount = document.createElement("div");
  selectedCount.className = "genre-selected-count";

  const actionButtons = document.createElement("div");
  actionButtons.className = "genre-filter-actions";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.className = "genre-filter-select-all";
  selectAllBtn.innerHTML = `<i class="fas fa-check-double"></i> ${config.languageLabels?.selectAll || "Tümünü seç"}`;

  const selectNoneBtn = document.createElement("button");
  selectNoneBtn.className = "genre-filter-select-none";
  selectNoneBtn.innerHTML = `<i class="far fa-square"></i> ${config.languageLabels?.selectNone || "Hiçbiri"}`;

  const clearFilterBtn = document.createElement("button");
  clearFilterBtn.className = "genre-filter-clear";
  clearFilterBtn.innerHTML = `<i class="fas fa-eraser"></i> ${config.languageLabels?.clearFilter || "Filtreyi temizle"}`;

  const applyBtn = document.createElement("button");
  applyBtn.className = "genre-filter-apply primary";
  applyBtn.innerHTML = `<i class="fas fa-check-circle"></i> ${config.languageLabels?.applyFilter || "Uygula"}`;

  actionButtons.append(selectAllBtn, selectNoneBtn, clearFilterBtn, applyBtn);
  const sorted = [...genres].sort((a, b) => (a.Name || "").localeCompare(b.Name || "", "tr", { sensitivity: "base" }));
  let currentLetter = "";
  const apiKeyParam = token ? `&api_key=${encodeURIComponent(token)}` : "";

  sorted.forEach((genre) => {
    const name = genre.Name || "";
    const firstLetter = name.charAt(0).toUpperCase();

    if (firstLetter !== currentLetter) {
      currentLetter = firstLetter;
      const letterHeader = document.createElement("div");
      letterHeader.className = "genre-letter-header";
      letterHeader.dataset.letter = currentLetter;
      letterHeader.textContent = currentLetter;
      genresContainer.appendChild(letterHeader);
    }

    const item = document.createElement("div");
    item.className = "genre-filter-item";
    item.dataset.name = name.toLowerCase();

    const img = document.createElement("img");
    img.className = "genre-image";
    if (genre.ImageTags && genre.ImageTags.Primary) {
      img.src = withParams(`/Items/${genre.Id}/Images/Primary`, {
        tag: genre.ImageTags.Primary,
        quality: 90,
        maxHeight: 80,
        api_key: token,
      });
      img.onerror = () => {
        img.src = PLACEHOLDER_IMAGE;
      };
    } else {
      img.src = PLACEHOLDER_IMAGE;
    }
    img.alt = name;
    img.style.cursor = "pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "genre-checkbox";
    checkbox.id = `genre-${genre.Id}`;
    checkbox.value = name;
    checkbox.checked =
      Array.isArray(musicPlayerState.selectedGenres) &&
      musicPlayerState.selectedGenres.includes(name);

    const label = document.createElement("label");
    label.htmlFor = `genre-${genre.Id}`;
    label.innerHTML = `<i class="fas fa-headphones-alt genre-icon"></i> ${name}`;

    item.append(checkbox, img, label);
    genresContainer.appendChild(item);
  });

  const updateSelectedCount = () => {
    const { selectedText, total, selected } = getSelectedMeta(modal);
    let text;
    if (selected === 0 && Array.isArray(musicPlayerState.selectedGenres)) {
      text = `${musicPlayerState.selectedGenres.length} ${config.languageLabels?.genresSelected || "tür seçildi"}`;
    } else if (selected === 0) {
      text = config.languageLabels?.noGenresSelected || "Seçim yok";
    } else if (selected === total) {
      text = config.languageLabels?.allGenresSelected || "Tüm türler seçildi";
    } else {
      text = `${selected} ${config.languageLabels?.genresSelected || "tür seçildi"}`;
    }
    selectedCount.innerHTML = `<i class="fas fa-music"></i> ${text}`;
  };

  updateSelectedCount();
  modalContent.append(header, searchContainer, genresContainer, selectedCount, actionButtons);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);
  const handleBackdrop = (e) => {
    if (e.target === modal) closeModalSafe();
  };
  modal.addEventListener("click", handleBackdrop);
  keydownHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModalSafe();
    }
  };
  document.addEventListener("keydown", keydownHandler);
  const delegatedClick = (e) => {
    const item = e.target.closest(".genre-filter-item");
    if (!item) return;

    const checkbox = item.querySelector(".genre-checkbox");
    if (!checkbox) return;
    if (e.target.matches(".genre-image") || e.target === item) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  genresContainer.addEventListener("click", delegatedClick);
  const delegatedChange = (e) => {
    if (!e.target.classList.contains("genre-checkbox")) return;
    updateSelectedCount();
  };
  genresContainer.addEventListener("change", delegatedChange);

  const filterGenres = (term) => {
    term = (term || "").toLowerCase();
    const items = genresContainer.querySelectorAll(".genre-filter-item");
    const headers = genresContainer.querySelectorAll(".genre-letter-header");
    items.forEach((el) => {
      const match = el.dataset.name.includes(term);
      el.style.display = match ? "flex" : "none";
    });

    headers.forEach((h) => {
      let next = h.nextElementSibling;
      let visible = false;
      while (next && !next.classList.contains("genre-letter-header")) {
        if (next.style.display !== "none") {
          visible = true;
          break;
        }
        next = next.nextElementSibling;
      }
      h.style.display = visible ? "block" : "none";
    });
  };

  let searchTimer = null;
  const clearSearchTimer = () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  };
  searchInput.addEventListener("input", (e) => {
    clearSearchTimer();
    const val = e.target.value;
    searchTimer = setTimeout(() => filterGenres(val), 150);
  });

  selectAllBtn.addEventListener("click", () => {
    const cbs = modal.querySelectorAll(".genre-checkbox");
    cbs.forEach((cb) => {
      cb.checked = true;
    });
    updateSelectedCount();
    showNotification(
      `<i class="fas fa-check-circle"></i> ${cbs.length} ${config.languageLabels?.genresSelected || "tür seçildi"}`,
      2000,
      "success"
    );
  });

  selectNoneBtn.addEventListener("click", () => {
    modal.querySelectorAll(".genre-checkbox").forEach((cb) => (cb.checked = false));
    updateSelectedCount();
    showNotification(
      `<i class="far fa-square"></i> ${config.languageLabels?.noGenresSelected || "Seçim yok"}`,
      2000,
      "info"
    );
  });

  clearFilterBtn.addEventListener("click", () => {
    modal.querySelectorAll(".genre-checkbox").forEach((cb) => (cb.checked = false));
    musicPlayerState.selectedGenres = [];
    refreshPlaylist();
    updateSelectedCount();
    showNotification(
      `<i class="fas fa-broom"></i> ${config.languageLabels?.filterCleared || "Filtre temizlendi"}`,
      2000,
      "success"
    );
  });

  applyBtn.addEventListener("click", () => {
    const selectedGenres = Array.from(modal.querySelectorAll(".genre-checkbox:checked")).map(
      (cb) => cb.value
    );
    musicPlayerState.selectedGenres = selectedGenres;
    refreshPlaylist();
    closeModalSafe();
  });

  activeModal = modal;
  setTimeout(() => searchInput.focus(), 0);
  function closeModalSafe() {
    if (!activeModal) return;
    try {
      fetchCtrl?.abort();
    } catch {}
    fetchCtrl = null;
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
    try {
      activeModal.removeEventListener("click", handleBackdrop);
      genresContainer.removeEventListener("click", delegatedClick);
      genresContainer.removeEventListener("change", delegatedChange);
    } catch {}
    clearSearchTimer();
    try {
      document.body.removeChild(activeModal);
    } catch {}
    document.body.style.overflow = bodyOverflowPrev || "";
    try {
      prevFocus?.focus();
    } catch {}
    activeModal = null;
    prevFocus = null;
    bodyOverflowPrev = null;
  }
  function getSelectedMeta(scope) {
    const checkboxes = scope.querySelectorAll(".genre-checkbox");
    const selected = Array.from(checkboxes).filter((cb) => cb.checked).length;
    const total = checkboxes.length;
    return {
      selected,
      total,
      selectedText: `${selected}/${total}`,
    };
  }
}

export function closeModalSafe() {
  if (activeModal) {
    try {
      if (keydownHandler) {
        document.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
      }
      try { fetchCtrl?.abort(); } catch {}
      fetchCtrl = null;

      document.body.style.overflow = bodyOverflowPrev || "";

      try { document.body.removeChild(activeModal); } catch {}
      try { prevFocus?.focus(); } catch {}

    } finally {
      activeModal = null;
      prevFocus = null;
      bodyOverflowPrev = null;
    }
  }
}
