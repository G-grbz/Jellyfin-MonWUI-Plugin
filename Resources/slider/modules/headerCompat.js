const LEGACY_HEADER_CONTAINER_SELECTORS = [
  ".skinHeader .headerRight",
  ".skinHeader .headerButtons",
  ".headerRight",
  ".headerButtons"
];

const MUI_HEADER_ACTION_TRIGGER_SELECTORS = [
  '[aria-controls="app-sync-play-menu"]',
  '[aria-controls="app-remote-play-menu"]',
  'a[href="#/search"]'
];

const MUI_HEADER_USER_TRIGGER_SELECTORS = [
  '[aria-controls="app-user-menu"]'
];

function firstMatch(selectors, root = document) {
  if (!root?.querySelector) return null;
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function getActionMountFromTrigger(trigger) {
  return trigger?.parentElement || null;
}

function getUserMountFromTrigger(trigger) {
  return trigger?.parentElement || trigger || null;
}

export function findHeaderMountTarget({ variant = "actions", root = document } = {}) {
  if (variant === "profile") {
    const userTrigger = firstMatch(MUI_HEADER_USER_TRIGGER_SELECTORS, root);
    const userMount = getUserMountFromTrigger(userTrigger);
    if (userMount) return { element: userMount, mode: "mui-user" };
  } else {
    const actionTrigger = firstMatch(MUI_HEADER_ACTION_TRIGGER_SELECTORS, root);
    const actionMount = getActionMountFromTrigger(actionTrigger);
    if (actionMount) return { element: actionMount, mode: "mui-actions" };
  }

  const legacyMount = firstMatch(LEGACY_HEADER_CONTAINER_SELECTORS, root);
  if (legacyMount) return { element: legacyMount, mode: "legacy" };

  if (variant === "profile") {
    const actionTrigger = firstMatch(MUI_HEADER_ACTION_TRIGGER_SELECTORS, root);
    const actionMount = getActionMountFromTrigger(actionTrigger);
    if (actionMount) return { element: actionMount, mode: "mui-actions" };
  }

  return { element: null, mode: "unknown" };
}

export function getHeaderMountWaitSelector(variant = "actions") {
  const selectors = variant === "profile"
    ? [...MUI_HEADER_USER_TRIGGER_SELECTORS, ...LEGACY_HEADER_CONTAINER_SELECTORS]
    : [...MUI_HEADER_ACTION_TRIGGER_SELECTORS, ...LEGACY_HEADER_CONTAINER_SELECTORS];
  return selectors.join(", ");
}

export function isMuiHeaderMode(mode = "") {
  return mode === "mui-actions" || mode === "mui-user";
}

export function applyHeaderIconButtonMode(button, mode, { legacyClassName = "" } = {}) {
  if (!button) return button;

  button.setAttribute("data-jms-header-mode", mode || "legacy");

  if (isMuiHeaderMode(mode)) {
    button.className = [
      "jms-mui-header-icon-button",
      "MuiButtonBase-root",
      "MuiIconButton-root",
      "MuiIconButton-colorInherit",
      "MuiIconButton-sizeLarge"
    ].join(" ");
    button.removeAttribute("is");
    return button;
  }

  if (legacyClassName) {
    button.className = legacyClassName;
  }
  button.setAttribute("is", "paper-icon-button-light");
  return button;
}
