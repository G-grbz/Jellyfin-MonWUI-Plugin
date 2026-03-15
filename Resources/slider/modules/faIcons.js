const FA_ICONS = Object.freeze({
  arrowLeft: "fa-solid fa-arrow-left",
  bell: "fa-solid fa-bell",
  chevronDown: "fa-solid fa-chevron-down",
  chevronRight: "fa-solid fa-chevron-right",
  compactDisc: "fa-solid fa-compact-disc",
  film: "fa-solid fa-film",
  folder: "fa-solid fa-folder",
  image: "fa-solid fa-image",
  images: "fa-solid fa-images",
  layerGroup: "fa-solid fa-layer-group",
  moon: "fa-solid fa-moon",
  music: "fa-solid fa-music",
  play: "fa-solid fa-play",
  sliders: "fa-solid fa-sliders",
  sun: "fa-solid fa-sun",
  tv: "fa-solid fa-tv",
  video: "fa-solid fa-video"
});

export function faIconClasses(icon) {
  return FA_ICONS[icon] || icon || "";
}

export function faIconHtml(icon, extraClasses = "", attrs = 'aria-hidden="true"') {
  const className = [faIconClasses(icon), extraClasses].filter(Boolean).join(" ");
  const attrText = attrs ? ` ${attrs}` : "";
  return `<i class="${className}"${attrText}></i>`;
}

export function findFaIcon(root) {
  return root?.querySelector?.(
    ".fa-solid, .fa-regular, .fa-brands, .fa-classic, .fas, .far, .fab"
  ) || null;
}
