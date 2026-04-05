import { createCheckbox, createSection } from "../settings.js";

const DEFAULT_CONTENT_TYPES = ["Movie", "Series"];
const DEFAULT_IMAGE_TYPES = ["Logo", "Backdrop"];
const IMAGE_TYPE_QUERY_ORDER = ["Backdrop", "Logo"];

function normalizeKeywordList(raw) {
    const source = Array.isArray(raw)
        ? raw
        : String(raw || "").split(",");

    const seen = new Set();
    return source
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .filter((item) => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function parseQueryParams(query) {
    const params = new Map();
    String(query || "")
        .replace(/^[?&]+/, "")
        .split("&")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
            const [rawKey, ...rest] = part.split("=");
            const key = String(rawKey || "").trim().toLowerCase();
            if (!key) return;
            const value = rest.join("=").trim();
            params.set(key, decodeURIComponent(value));
        });
    return params;
}

function readCsvParam(params, key, fallback = []) {
    const value = params.get(String(key || "").toLowerCase());
    if (!value) return [...fallback];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function readSortKey(params) {
    const sortBy = params.get("sortby");
    if (!sortBy) return "";
    return sortBy
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)[0] || "";
}

function orderImageTypes(types = []) {
    const selected = new Set(types);
    const ordered = IMAGE_TYPE_QUERY_ORDER.filter((type) => selected.has(type));
    types.forEach((type) => {
        if (!ordered.includes(type)) ordered.push(type);
    });
    return ordered;
}

function buildQueryString({ contentTypes = [], imageTypes = [], sortBy = "" } = {}) {
    const parts = [];

    if (contentTypes.length) {
        parts.push(`IncludeItemTypes=${contentTypes.join(",")}`);
    }

    parts.push("Recursive=true");
    parts.push("hasOverview=true");

    const orderedImageTypes = orderImageTypes(imageTypes);
    if (orderedImageTypes.length) {
        parts.push(`imageTypes=${orderedImageTypes.join(",")}`);
    }

    const safeSortBy = String(sortBy || "").trim();
    if (safeSortBy) {
        if (safeSortBy.toLowerCase() === "random") {
            parts.push("sortBy=Random");
        } else {
            parts.push(`sortBy=${safeSortBy}`);
            parts.push("sortOrder=Descending");
        }
    }

    return parts.join("&");
}

function appendQueryParam(query, key, value) {
    const safeQuery = String(query || "").trim();
    const safeKey = String(key || "").trim();
    const safeValue = String(value || "").trim();
    if (!safeKey || !safeValue) return safeQuery;
    if (new RegExp(`(?:^|[?&])${safeKey}=`, "i").test(safeQuery)) {
        return safeQuery;
    }
    return safeQuery ? `${safeQuery}&${safeKey}=${safeValue}` : `${safeKey}=${safeValue}`;
}

function createOptionCheckbox({ name, value, label, checked }) {
    const wrapper = document.createElement("label");
    wrapper.className = "setting-item";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    wrapper.style.cursor = "pointer";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = value;
    input.checked = checked;

    const text = document.createElement("span");
    text.textContent = label;

    wrapper.append(input, text);
    return { wrapper, input };
}

function createSubsectionTitle(text) {
    const title = document.createElement("div");
    title.textContent = text;
    title.style.display = "block";
    title.style.marginBottom = "6px";
    title.style.fontWeight = "600";
    return title;
}

function createSubsectionDescription(text) {
    const description = document.createElement("div");
    description.className = "description-text";
    description.textContent = text;
    return description;
}

function buildSortLabel(keyword, labels) {
    const normalized = String(keyword || "").trim();
    if (!normalized) return "";

    switch (normalized.toLowerCase()) {
        case "datecreated":
            return labels.sortOptionDateCreated || "Son Eklenenler";
        case "premieredate":
            return labels.sortOptionPremiereDate || "PremiereDate";
        case "productionyear":
            return labels.sortOptionProductionYear || "ProductionYear";
        case "random":
            return labels.sortOptionRandom || "Random";
        default:
            return normalized;
    }
}

export function createQueryPanel(config, labels) {
    const panel = document.createElement("div");
    panel.id = "query-panel";
    panel.className = "settings-panel query-settings-panel";

    const section = createSection(labels.queryStringInput || "Api Sorgu Ayarları");
    section.classList.add("query-settings-section");
    const parsedQuery = parseQueryParams(config.customQueryString);
    const initialContentTypes = readCsvParam(parsedQuery, "IncludeItemTypes", DEFAULT_CONTENT_TYPES);
    const initialImageTypes = readCsvParam(parsedQuery, "imageTypes", DEFAULT_IMAGE_TYPES);
    const initialSortBy = readSortKey(parsedQuery);

    const randomContentDiv = document.createElement("div");
    randomContentDiv.className = "form-group query-toggle-card";
    const randomContentCheckbox = createCheckbox(
        "useRandomContent",
        labels.useRandomContent || "Rastgele İçerik",
        false
    );
    randomContentDiv.appendChild(randomContentCheckbox);
    section.appendChild(randomContentDiv);

    const manualListDiv = document.createElement("div");
    manualListDiv.className = "form-group query-toggle-card";
    const useManualListCheckbox = createCheckbox(
        "useManualList",
        labels.useManualList || "Özel Liste Hazırla",
        config.useManualList
    );
    manualListDiv.appendChild(useManualListCheckbox);

    const manualListIdsDiv = document.createElement("div");
    manualListIdsDiv.className = "form-group manual-list-container query-manual-list";
    manualListIdsDiv.id = "manualListIdsContainer";
    manualListIdsDiv.style.display = config.useManualList ? "" : "none";

    const manualListIdsLabel = document.createElement("label");
    manualListIdsLabel.textContent = labels.manualListIdsInput || "İçerik ID'leri (virgülle ayırın):";

    const manualListIdsInput = document.createElement("textarea");
    manualListIdsInput.className = "form-control";
    manualListIdsInput.rows = 4;
    manualListIdsInput.name = "manualListIds";
    manualListIdsInput.value = config.manualListIds || "";
    manualListIdsInput.id = "manualListIdsInput";

    manualListIdsLabel.htmlFor = "manualListIdsInput";
    manualListIdsDiv.append(manualListIdsLabel, manualListIdsInput);

    section.appendChild(manualListDiv);
    section.appendChild(manualListIdsDiv);

    const randomSettingsContainer = document.createElement("div");
    randomSettingsContainer.className = "query-random-settings";
    section.appendChild(randomSettingsContainer);

    const limitDiv = document.createElement("div");
    limitDiv.className = "setting-item limit-container";

    const limitLabel = document.createElement("label");
    limitLabel.textContent = labels.limit || "Slider Limiti:";

    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.value = typeof config.limit !== "undefined" ? config.limit : 20;
    limitInput.name = "limit";
    limitInput.min = 1;
    limitInput.max = 100;
    limitInput.id = "limitInput";

    limitLabel.htmlFor = "limitInput";
    limitDiv.append(limitLabel, limitInput);

    const limitDesc = document.createElement("div");
    limitDesc.className = "description-text";
    limitDesc.textContent = labels.limitDesc || "Görünecek slider limiti";

    const queryBuilderContainer = document.createElement("div");
    queryBuilderContainer.className = "form-group query-builder-card";
    queryBuilderContainer.style.flexDirection = "column";
    queryBuilderContainer.style.alignItems = "stretch";

    const contentTypesTitle = createSubsectionTitle(
        labels.queryContentTypesTitle || "Slider'da Gösterilecek İçerikler"
    );
    const contentTypesDesc = createSubsectionDescription(
        labels.queryContentTypesDesc || "Seçtiklerin IncludeItemTypes alanına otomatik eklenir."
    );
    const contentTypesGrid = document.createElement("div");
    contentTypesGrid.className = "form-group query-option-grid";
    contentTypesGrid.style.display = "grid";
    contentTypesGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
    contentTypesGrid.style.alignItems = "stretch";

    const contentTypeInputs = [
        { value: "Movie", label: labels.queryContentTypeMovie || "Movie" },
        { value: "Series", label: labels.queryContentTypeSeries || "Series" },
        { value: "BoxSet", label: labels.queryContentTypeBoxSet || "BoxSet" }
    ].map((option) => {
        const checkbox = createOptionCheckbox({
            name: "queryContentTypes",
            value: option.value,
            label: option.label,
            checked: initialContentTypes.includes(option.value)
        });
        contentTypesGrid.appendChild(checkbox.wrapper);
        return checkbox.input;
    });

    queryBuilderContainer.append(contentTypesTitle, contentTypesDesc, contentTypesGrid);

    const imageTypesTitle = createSubsectionTitle(
        labels.queryImageTypesTitle || "Listelenecek İçeriklerin Mevcut Görsel Durumu"
    );
    const imageTypesDesc = createSubsectionDescription(
        labels.queryImageTypesDesc || "Seçtiklerin imageTypes alanına otomatik eklenir."
    );
    const imageTypesGrid = document.createElement("div");
    imageTypesGrid.className = "form-group query-option-grid";
    imageTypesGrid.style.display = "grid";
    imageTypesGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
    imageTypesGrid.style.alignItems = "stretch";

    const imageTypeInputs = [
        { value: "Logo", label: labels.queryImageTypeLogo || "Logo" },
        { value: "Backdrop", label: labels.queryImageTypeBackdrop || "Backdrop" }
    ].map((option) => {
        const checkbox = createOptionCheckbox({
            name: "queryImageTypes",
            value: option.value,
            label: option.label,
            checked: initialImageTypes.includes(option.value)
        });
        imageTypesGrid.appendChild(checkbox.wrapper);
        return checkbox.input;
    });

    queryBuilderContainer.append(imageTypesTitle, imageTypesDesc, imageTypesGrid);

    const sortingSection = document.createElement("div");
    sortingSection.className = "form-group query-sort-card";
    sortingSection.style.flexDirection = "column";
    sortingSection.style.alignItems = "stretch";

    const sortingHeading = createSubsectionTitle(labels.querySortingTitle || "Sıralama");
    const sortingDesc = createSubsectionDescription(
        labels.querySortingDesc || "Boş bırakırsan Monwui kendi karıştırma mantığını kullanır. Anahtar kelimelere eklediğin manuel değerler de bu listede görünür."
    );
    const sortSelect = document.createElement("select");
    sortSelect.id = "querySortBySelect";
    sortSelect.name = "querySortBy";
    sortSelect.className = "form-control";
    sortingSection.append(sortingHeading, sortingDesc, sortSelect);

    const sortingLabel = document.createElement("label");
    sortingLabel.textContent = labels.sortingKeywords || "Anahtar Kelimeler (virgül ile ayırınız)";
    sortingLabel.htmlFor = "sortingKeywordsInput";

    const sortingKeywordsDesc = document.createElement("div");
    sortingKeywordsDesc.className = "description-text";
    sortingKeywordsDesc.textContent = labels.sortingKeywordsDesc ||
        "Buraya eklediğin manuel değerler sıralama listesindeki seçeneklere otomatik eklenir.";

    const sortingTextarea = document.createElement("textarea");
    sortingTextarea.id = "sortingKeywordsInput";
    sortingTextarea.name = "sortingKeywords";
    sortingTextarea.placeholder = "DateCreated,PremiereDate,ProductionYear";
    sortingTextarea.value = normalizeKeywordList(config.sortingKeywords).join(",");

    const queryStringLabel = document.createElement("label");
    queryStringLabel.className = "customQueryStringInput query-string-label";
    queryStringLabel.textContent = labels.customQueryString || "Api Sorgu Önizlemesi:";
    queryStringLabel.htmlFor = "customQueryPreviewInput";

    const queryStringDesc = document.createElement("div");
    queryStringDesc.className = "description-text";
    queryStringDesc.textContent = labels.customQueryStringNote ||
        "Bu alan seçimlerine göre otomatik oluşturulur. Recursive=true ve hasOverview=true her zaman eklenir.";

    const queryStringHiddenInput = document.createElement("input");
    queryStringHiddenInput.type = "hidden";
    queryStringHiddenInput.id = "customQueryStringInput";
    queryStringHiddenInput.name = "customQueryString";

    const queryStringTextarea = document.createElement("textarea");
    queryStringTextarea.id = "customQueryPreviewInput";
    queryStringTextarea.className = "query-string-input";
    queryStringTextarea.rows = 5;
    queryStringTextarea.readOnly = true;
    queryStringTextarea.placeholder =
        labels.customQueryStringPlaceholder ||
        "IncludeItemTypes=Movie&Recursive=true&hasOverview=true&imageTypes=Backdrop,Logo";

    const balanceTypesDiv = document.createElement("div");
    balanceTypesDiv.className = "setting-item balance-types-container";
    const balanceTypesCheckbox = createCheckbox(
        "balanceItemTypes",
        labels.balanceItemTypes || "Tür Dengeleme Aktif",
        config.balanceItemTypes || false
    );
    balanceTypesDiv.appendChild(balanceTypesCheckbox);

    const balanceTypesDesc = document.createElement("div");
    balanceTypesDesc.className = "description-text";
    balanceTypesDesc.textContent =
        labels.balanceItemTypesDesc ||
        "İşaretlenirse seçilen içerikler türlere (Movie, Series, BoxSet) göre eşit dağılmaya çalışır.";

    const onlyUnwatchedDiv = document.createElement("div");
    onlyUnwatchedDiv.className = "setting-item only-unwatched-container";
    const onlyUnwatchedCheckbox = createCheckbox(
        "onlyUnwatchedRandom",
        labels.onlyUnwatchedRandom || "Sadece İzlenmeyen İçerikleri Göster",
        !!config.onlyUnwatchedRandom
    );
    onlyUnwatchedDiv.appendChild(onlyUnwatchedCheckbox);

    const onlyUnwatchedDesc = document.createElement("div");
    onlyUnwatchedDesc.className = "description-text";
    onlyUnwatchedDesc.textContent =
        labels.onlyUnwatchedRandomDesc ||
        "Etkinse, Rastgele İçerik modunda yalnızca hiç oynatılmamış (IsPlayed=false) öğeler listelenir. Özel Liste etkilenmez.";

    const finalDesc = document.createElement("div");
    finalDesc.className = "description-text";
    finalDesc.innerHTML =
        labels.customQueryStringDescription ||
        'Bu alanlar slider sorgusunu seçerek oluşturur. IncludeItemTypes, imageTypes ve sortBy değerleri seçtiklerine göre yazılır. Detaylar için <a href="https://api.jellyfin.org" target="_blank">burayı ziyaret edin.</a>.';

    const sectionDivider = document.createElement("hr");
    sectionDivider.className = "query-section-divider";
    sectionDivider.style.border = "0";
    sectionDivider.style.borderTop = "1px solid rgba(68, 68, 68, 0.25)";
    sectionDivider.style.margin = "14px 0";

    const maxShufflingLimitDiv = document.createElement("div");
    maxShufflingLimitDiv.className = "setting-item limit-container";

    const maxShufflingLimitLabel = document.createElement("label");
    maxShufflingLimitLabel.textContent =
        labels.maxShufflingLimit || "Maksimum Karıştırılacak İçerik Limiti:";

    const maxShufflingLimitInput = document.createElement("input");
    maxShufflingLimitInput.type = "number";
    maxShufflingLimitInput.value = typeof config.maxShufflingLimit !== "undefined" ? config.maxShufflingLimit : 10000;
    maxShufflingLimitInput.name = "maxShufflingLimit";
    maxShufflingLimitInput.min = 1;
    maxShufflingLimitInput.max = 1000000;
    maxShufflingLimitInput.id = "maxShufflingLimitInput";

    maxShufflingLimitLabel.htmlFor = "maxShufflingLimitInput";
    maxShufflingLimitDiv.append(maxShufflingLimitLabel, maxShufflingLimitInput);

    const maxShufflingLimitDesc = document.createElement("div");
    maxShufflingLimitDesc.className = "description-text";
    maxShufflingLimitDesc.textContent =
        labels.maxShufflingLimitDesc ||
        "Slider oluşturmak için seçilecek içerik limitidir örneğin 1000 belirlerseniz 1000 içerik içinden seçim yaparak slider oluşturulur.";

    const shuffleSeedLimitDiv = document.createElement("div");
    shuffleSeedLimitDiv.className = "setting-item shuffleSeedLimit-container";

    const shuffleSeedLimitLabel = document.createElement("label");
    shuffleSeedLimitLabel.textContent =
        labels.shuffleSeedLimit || "shuffleSeedLimit (Tekrar Engelleme Limiti):";

    const shuffleSeedLimitInput = document.createElement("input");
    shuffleSeedLimitInput.type = "number";
    shuffleSeedLimitInput.value = typeof config.shuffleSeedLimit !== "undefined" ? config.shuffleSeedLimit : 200;
    shuffleSeedLimitInput.name = "shuffleSeedLimit";
    shuffleSeedLimitInput.min = 1;
    shuffleSeedLimitInput.max = 100000;
    shuffleSeedLimitInput.id = "shuffleSeedLimitInput";

    shuffleSeedLimitLabel.htmlFor = "shuffleSeedLimitInput";
    shuffleSeedLimitDiv.append(shuffleSeedLimitLabel, shuffleSeedLimitInput);

    const shuffleSeedLimitDesc = document.createElement("div");
    shuffleSeedLimitDesc.className = "description-text";
    shuffleSeedLimitDesc.textContent =
        labels.shuffleSeedLimitDesc ||
        'shuffleSeedLimit, aynı içeriklerin yeniden gösterilmesini önlemek amacıyla, karıştırma seçimleri sırasında kullanılan geçmiş belleğin maksimum uzunluğunu belirler. Bu limit aşıldığında karıştırma geçmişi otomatik olarak temizlenir.';

    const playingLimitDiv = document.createElement("div");
    playingLimitDiv.className = "setting-item playing-limit-container";

    const playingLimitLabel = document.createElement("label");
    playingLimitLabel.textContent = labels.playingLimit || "İzlenenlerden Getirilecek Miktar:";

    const playingLimitInput = document.createElement("input");
    playingLimitInput.type = "number";
    playingLimitInput.value = config.playingLimit ?? 5;
    playingLimitInput.name = "playingLimit";
    playingLimitInput.min = 0;
    playingLimitInput.max = 100;
    playingLimitInput.id = "playingLimitInput";

    playingLimitLabel.htmlFor = "playingLimitInput";
    playingLimitDiv.append(playingLimitLabel, playingLimitInput);

    const playingLimitDesc = document.createElement("div");
    playingLimitDesc.className = "description-text";
    playingLimitDesc.textContent =
        labels.playingLimitDesc ||
        'İzlenmesi yarıda kesilen son içerikleri listeler. "0" değeri pasif hale getirir.';

    const excludeEpisodesDiv = document.createElement("div");
    excludeEpisodesDiv.className = "setting-item exclude-episodes-container";

    const excludeEpisodesCheckbox = createCheckbox(
        "excludeEpisodesFromPlaying",
        labels.excludeEpisodesFromPlaying || "Dizi Bölümlerini Hariç Tut",
        config.excludeEpisodesFromPlaying || false
    );
    excludeEpisodesDiv.appendChild(excludeEpisodesCheckbox);

    const excludeEpisodesDesc = document.createElement("div");
    excludeEpisodesDesc.className = "description-text";
    excludeEpisodesDesc.textContent =
        labels.excludeEpisodesFromPlayingDesc ||
        'İşaretlenirse "İzlenenler" listesinden bölümleri hariç tutar';

    function getSelectedValues(inputs = []) {
        return inputs.filter((input) => input.checked).map((input) => input.value);
    }

    function getSortOptions() {
        const keywords = normalizeKeywordList(sortingTextarea.value);
        const safeSelectedSort = String(sortSelect.value || initialSortBy || "").trim();
        if (safeSelectedSort && !keywords.some((keyword) => keyword.toLowerCase() === safeSelectedSort.toLowerCase())) {
            keywords.push(safeSelectedSort);
        }
        return keywords;
    }

    function refreshSortOptions() {
        const previousValue = String(sortSelect.value || initialSortBy || "").trim();
        const sortOptions = getSortOptions();
        sortSelect.innerHTML = "";

        const noneOption = document.createElement("option");
        noneOption.value = "";
        noneOption.textContent = labels.querySortNone || "Monwui Karıştırması";
        sortSelect.appendChild(noneOption);

        sortOptions.forEach((keyword) => {
            const option = document.createElement("option");
            option.value = keyword;
            option.textContent = buildSortLabel(keyword, labels);
            sortSelect.appendChild(option);
        });

        if (previousValue && sortOptions.some((keyword) => keyword.toLowerCase() === previousValue.toLowerCase())) {
            sortSelect.value = sortOptions.find((keyword) => keyword.toLowerCase() === previousValue.toLowerCase()) || "";
        } else {
            sortSelect.value = "";
        }
    }

    function buildEffectiveQuery() {
        let query = buildQueryString({
            contentTypes: getSelectedValues(contentTypeInputs),
            imageTypes: getSelectedValues(imageTypeInputs),
            sortBy: sortSelect.value
        });

        if (onlyUnwatchedCheckbox.querySelector("input").checked) {
            query = appendQueryParam(query, "IsPlayed", "false");
        }

        return query;
    }

    function buildPreviewText() {
        const lines = [buildEffectiveQuery()];

        if (balanceTypesCheckbox.querySelector("input").checked) {
            lines.push("# balanceItemTypes=true");
        }

        if (onlyUnwatchedCheckbox.querySelector("input").checked) {
            lines.push("# onlyUnwatchedRandom=true");
        }

        return lines.filter(Boolean).join("\n");
    }

    function refreshQueryPreview() {
        queryStringHiddenInput.value = buildEffectiveQuery();
        queryStringTextarea.value = buildPreviewText();
    }

    randomSettingsContainer.append(
        limitDesc,
        limitDiv,
        queryBuilderContainer,
        sortingSection,
        sortingLabel,
        sortingKeywordsDesc,
        sortingTextarea,
        queryStringLabel,
        queryStringDesc,
        queryStringHiddenInput,
        queryStringTextarea,
        balanceTypesDesc,
        balanceTypesDiv,
        onlyUnwatchedDesc,
        onlyUnwatchedDiv,
        finalDesc,
        sectionDivider,
        maxShufflingLimitDesc,
        maxShufflingLimitDiv,
        shuffleSeedLimitDesc,
        shuffleSeedLimitDiv,
        playingLimitDesc,
        playingLimitDiv,
        excludeEpisodesDesc,
        excludeEpisodesDiv
    );

    refreshSortOptions();
    if (initialSortBy) {
        sortSelect.value = initialSortBy;
    }
    refreshQueryPreview();

    [...contentTypeInputs, ...imageTypeInputs].forEach((input) => {
        input.addEventListener("change", refreshQueryPreview);
    });
    sortSelect.addEventListener("change", refreshQueryPreview);
    sortingTextarea.addEventListener("input", () => {
        refreshSortOptions();
        refreshQueryPreview();
    });
    balanceTypesCheckbox.querySelector("input").addEventListener("change", refreshQueryPreview);
    onlyUnwatchedCheckbox.querySelector("input").addEventListener("change", refreshQueryPreview);

    function handleSelection(selectedCheckbox) {
        const checkboxes = [
            randomContentCheckbox.querySelector("input"),
            useManualListCheckbox.querySelector("input")
        ];

        checkboxes.forEach((cb) => {
            if (cb !== selectedCheckbox) cb.checked = false;
        });

        const isRandom = selectedCheckbox === checkboxes[0];

        randomSettingsContainer.style.display = isRandom ? "" : "none";
        manualListIdsDiv.style.display = selectedCheckbox === checkboxes[1] ? "" : "none";
        manualListIdsInput.disabled = selectedCheckbox !== checkboxes[1];
        onlyUnwatchedCheckbox.querySelector("input").disabled = !isRandom;
        limitInput.disabled = !isRandom;
        maxShufflingLimitInput.disabled = !isRandom;
        shuffleSeedLimitInput.disabled = !isRandom;
        playingLimitInput.disabled = !isRandom;
        sortSelect.disabled = !isRandom;
        sortingTextarea.disabled = !isRandom;
    }

    [randomContentCheckbox, useManualListCheckbox].forEach((chkDiv) => {
        chkDiv.querySelector("input").addEventListener("change", function () {
            if (!this.checked) {
                this.checked = true;
                return;
            }
            handleSelection(this);
        });
    });

    if (config.useManualList) {
        useManualListCheckbox.querySelector("input").checked = true;
        handleSelection(useManualListCheckbox.querySelector("input"));
    } else {
        randomContentCheckbox.querySelector("input").checked = true;
        handleSelection(randomContentCheckbox.querySelector("input"));
    }

    panel.appendChild(section);
    return panel;
}
