const FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea';

let autoFieldCounter = 0;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nextFieldId(prefix, field) {
  autoFieldCounter += 1;
  const tag = cleanText(field?.tagName).toLowerCase() || "field";
  const type = cleanText(field?.getAttribute?.("type")).toLowerCase();
  return `${prefix}-${type || tag}-${autoFieldCounter}`;
}

export function enhanceFormAccessibility(root, { prefix = "jms-field" } = {}) {
  if (!root?.querySelectorAll) return;

  const fields = Array.from(root.querySelectorAll(FIELD_SELECTOR));

  const ensureIdentity = (field) => {
    if (!field?.id) {
      field.id = nextFieldId(prefix, field);
    }

    const fieldType = cleanText(field.getAttribute("type")).toLowerCase();
    if (
      !field.name &&
      fieldType !== "button" &&
      fieldType !== "submit" &&
      fieldType !== "reset"
    ) {
      field.name = field.id;
    }

    return field.id;
  };

  fields.forEach(ensureIdentity);

  const labels = Array.from(root.querySelectorAll("label"));

  labels.forEach((label) => {
    let target = null;

    if (label.htmlFor) {
      target = fields.find((field) => field.id === label.htmlFor) || document.getElementById(label.htmlFor);
    }

    if (!target) {
      target = label.querySelector(FIELD_SELECTOR);
    }

    if (!target) {
      const nextField = label.nextElementSibling;
      if (nextField?.matches?.(FIELD_SELECTOR)) {
        target = nextField;
      }
    }

    if (!target && label.parentElement) {
      const candidates = Array.from(label.parentElement.querySelectorAll(FIELD_SELECTOR)).filter(
        (field) => !label.contains(field)
      );
      if (candidates.length === 1) {
        target = candidates[0];
      }
    }

    if (!target) return;

    const targetId = ensureIdentity(target);
    if (!label.htmlFor) {
      label.htmlFor = targetId;
    }
  });

  fields.forEach((field) => {
    if (field.getAttribute("aria-label") || field.getAttribute("aria-labelledby")) return;

    const linkedLabel = labels.find((label) => label.htmlFor === field.id || label.contains(field));
    const fallbackLabel =
      cleanText(linkedLabel?.textContent) ||
      cleanText(field.getAttribute("placeholder")) ||
      cleanText(field.getAttribute("title")) ||
      cleanText(field.name);

    if (fallbackLabel) {
      field.setAttribute("aria-label", fallbackLabel);
    }
  });
}
