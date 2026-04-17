import { getConfig } from "../config.js";
import { getLanguageLabels, getDefaultLanguage } from "../../language/index.js";

export function createSection(title) {
  const section = document.createElement("div");
  section.className = "settings-section";

  if (title) {
    const sectionTitle = document.createElement("h3");
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);
  }

  return section;
}

export function createCheckbox(name, label, isChecked) {
  const container = document.createElement("div");
  container.className = "setting-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = name;
  checkbox.id = name;

  const storedValue = localStorage.getItem(name);

  if (storedValue !== null) {
    if (storedValue.trim().startsWith("{") && storedValue !== "[object Object]") {
      try {
        const obj = JSON.parse(storedValue);
        checkbox.checked = obj.enabled !== false;
      } catch {
        checkbox.checked = storedValue === "true";
      }
    } else {
      checkbox.checked = storedValue === "true";
    }
  } else {
    checkbox.checked = isChecked === true || isChecked === undefined;
  }

  const checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = name;
  checkboxLabel.textContent = label;

  container.append(checkbox, checkboxLabel);
  return container;
}

export function createImageTypeSelect(name, selectedValue, includeExtended = false, includeUseSlide = false) {
  const select = document.createElement("select");
  select.name = name;

  const config = getConfig();
  const currentLang = config.defaultLanguage || getDefaultLanguage();
  const labels = getLanguageLabels(currentLang) || {};

  const options = [
    {
      value: "none",
      label: labels.imageTypeNone || "Hiçbiri"
    },
    {
      value: "backdropUrl",
      label: labels.imageTypeBackdrop || "Backdrop Görseli"
    },
    {
      value: "landscapeUrl",
      label: labels.imageTypeLandscape || "Landscape Görseli"
    },
    {
      value: "primaryUrl",
      label: labels.imageTypePoster || "Poster Görseli"
    },
    {
      value: "logoUrl",
      label: labels.imageTypeLogo || "Logo Görseli"
    },
    {
      value: "bannerUrl",
      label: labels.imageTypeBanner || "Banner Görseli"
    },
    {
      value: "artUrl",
      label: labels.imageTypeArt || "Art Görseli"
    },
    {
      value: "discUrl",
      label: labels.imageTypeDisc || "Disk Görseli"
    }
  ];

  const storedValue = localStorage.getItem(name);
  const finalSelectedValue = storedValue !== null ? storedValue : selectedValue;

  options.forEach((option) => {
    const optionElement = document.createElement("option");
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
        ...subContainer.querySelectorAll("input"),
        ...subContainer.querySelectorAll("select"),
        ...subContainer.querySelectorAll("textarea"),
        ...subContainer.querySelectorAll("label")
      );
    }
    additionalElements.forEach((el) => el && allElements.push(el));

    const updateElementsState = () => {
      const isMainChecked = mainCheckbox.checked;

      allElements.forEach((element) => {
        if (element.tagName === "LABEL") {
          element.style.opacity = isMainChecked ? "1" : disabledOpacity;
        } else {
          element.disabled = !isMainChecked;
          element.style.opacity = isMainChecked ? "1" : disabledOpacity;
        }
      });
      if (subContainer) {
        subContainer.style.opacity = isMainChecked ? "1" : disabledOpacity;
        subContainer.classList.toggle("disabled", !isMainChecked);
      }
    };
    updateElementsState();
    mainCheckbox.addEventListener("change", updateElementsState);
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
        ...targetContainer.querySelectorAll("input"),
        ...targetContainer.querySelectorAll("select"),
        ...targetContainer.querySelectorAll("textarea")
      );
    }

    const updateElementsState = () => {
      const isMainChecked = mainCheckbox.checked;
      allElements.forEach((element) => {
        element.disabled = isMainChecked;
        element.style.opacity = isMainChecked ? disabledOpacity : "1";
      });

      if (targetContainer) {
        targetContainer.style.opacity = isMainChecked ? disabledOpacity : "1";
        targetContainer.classList.toggle("disabled", isMainChecked);
      }
    };
    updateElementsState();
    mainCheckbox.addEventListener("change", updateElementsState);
  }, 50);
}

export function createNumberInput(key, label, value, min = 0, max = 100, step = 1) {
  const container = document.createElement("div");
  container.className = "input-container";

  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  const input = document.createElement("input");
  input.type = "number";
  input.id = key;
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  input.setAttribute("inputmode", "decimal");
  input.setAttribute("pattern", "[0-9]+([\\.,][0-9]+)?");

  const normalize = (v) => String(v ?? "").replace(",", ".");
  const clamp = (num, lo, hi) => Math.min(Math.max(num, lo), hi);

  input.value = normalize(value);

  input.addEventListener("input", () => {
    if (input.value.includes(",")) {
      const pos = input.selectionStart;
      input.value = input.value.replace(",", ".");
      if (pos != null) input.setSelectionRange(pos, pos);
    }
  });

  input.addEventListener("blur", () => {
    const num = Number.parseFloat(normalize(input.value));
    if (!Number.isFinite(num)) return;

    let val = clamp(num, Number(input.min), Number(input.max));
    const stepNum = Number(input.step);
    if (Number.isFinite(stepNum) && stepNum > 0 && stepNum !== 1) {
      const decimals = (String(stepNum).split(".")[1] || "").length;
      val = Number(val.toFixed(decimals));
      input.value = val.toFixed(decimals);
    } else {
      input.value = String(val);
    }

    localStorage.setItem(key, input.value);
  });

  input.addEventListener("change", (e) => {
    const v = normalize(e.target.value);
    localStorage.setItem(key, v);
  });

  container.appendChild(input);
  return container;
}

export function createTextInput(key, label, value) {
  const container = document.createElement("div");
  container.className = "input-container";

  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  const input = document.createElement("input");
  input.type = "text";
  input.id = key;
  input.name = key;
  input.value = value;
  input.addEventListener("change", (e) => {
    localStorage.setItem(key, e.target.value);
  });
  container.appendChild(input);

  return container;
}

export function createSelect(key, label, options, selectedValue) {
  const container = document.createElement("div");
  container.className = "input-container";

  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  const select = document.createElement("select");
  select.id = key;
  select.name = key;

  options.forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.text;
    if (option.value === selectedValue) {
      optionElement.selected = true;
    }
    select.appendChild(optionElement);
  });

  select.addEventListener("change", (e) => {
    localStorage.setItem(key, e.target.value);
  });
  container.appendChild(select);

  return container;
}
