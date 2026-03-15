const TOMATO_ICON_SRC = "./slider/src/images/tomato.svg";
const TOMATO_ICON_FILTER = "drop-shadow(0 1px 2px rgba(0,0,0,0.55))";
const REPEAT_ONE_SVG_PATHS = `
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
    <path d="m17 2l4 4l-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4l4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3m8-8h1v4" />
  </g>
`;

function joinStyles(styles) {
  return styles.filter(Boolean).join("; ");
}

function getTomatoInlineStyle(size, style = "") {
  return joinStyles([
    `width:${size}`,
    `height:${size}`,
    "display:inline-block",
    "flex:0 0 auto",
    "object-fit:contain",
    "pointer-events:none",
    "vertical-align:-0.125em",
    `filter:${TOMATO_ICON_FILTER}`,
    style
  ]);
}

export function getTomatoIconHtml({ className = "", size = "1.4em", style = "" } = {}) {
  const classes = ["jms-tomato-icon", className].filter(Boolean).join(" ");
  return `<img src="${TOMATO_ICON_SRC}" class="${classes}" alt="" aria-hidden="true" style="${getTomatoInlineStyle(size, style)}">`;
}

export function createTomatoIconElement({ className = "", size = "1.4em", style = "" } = {}) {
  const icon = document.createElement("img");
  icon.src = TOMATO_ICON_SRC;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.className = ["jms-tomato-icon", className].filter(Boolean).join(" ");
  icon.style.cssText = getTomatoInlineStyle(size, style);
  return icon;
}

export function getRepeatOneIconHtml({ className = "", size = "1.4em", style = "" } = {}) {
  const classes = ["jms-repeat-one-icon", className].filter(Boolean).join(" ");
  const inlineStyle = joinStyles([
    `width:${size}`,
    `height:${size}`,
    "display:inline-block",
    "flex:0 0 auto",
    "vertical-align:-0.125em",
    style
  ]);

  return `<svg viewBox="0 0 24 24" class="${classes}" aria-hidden="true" focusable="false" style="${inlineStyle}">${REPEAT_ONE_SVG_PATHS}</svg>`;
}
