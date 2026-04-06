import { getConfig } from "./config.js";
import { getDefaultLanguage, getLanguageLabels } from "../language/index.js";
import {
  fetchCurrentUserParentalPinPolicy,
  getParentalPinErrorMessage,
  verifyParentalPin
} from "./parentalPinApi.js";
import {
  doesRatingRequirePin,
  formatResolvedRating,
  formatThresholdLabel
} from "./parentalPinShared.js";
import { showNotification } from "./player/ui/notification.js";

const STYLE_ID = "jms-parental-pin-style";
let nativePlayInterceptorInstalled = false;
let activePromptPromise = null;
let lastKnownPolicy = null;

function getLabels() {
  const cfg = getConfig?.() || {};
  const lang = cfg.defaultLanguage || getDefaultLanguage?.();
  return getLanguageLabels(lang) || cfg.languageLabels || {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatLabelTemplate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function getRemainingLockMinutes(lockedUntilUtc) {
  const remainingMs = Math.max(0, Number(lockedUntilUtc || 0) - Date.now());
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

function getLockMessage(labels, lockedUntilUtc) {
  return formatLabelTemplate(
    labels.parentalPinLockedWithMinutes || "Too many failed attempts. Try again in {minutes} minutes.",
    { minutes: getRemainingLockMinutes(lockedUntilUtc) }
  );
}

function getInvalidAttemptMessage(labels, response) {
  if (response?.isLocked) {
    return getLockMessage(labels, response?.lockedUntilUtc);
  }

  const remainingAttempts = Number(response?.remainingAttempts || 0);
  if (remainingAttempts > 0) {
    return formatLabelTemplate(
      labels.parentalPinAttemptsLeft || "Incorrect PIN. {count} attempts remaining.",
      { count: remainingAttempts }
    );
  }

  return labels.parentalPinInvalid || "Incorrect PIN.";
}

function buildMetaCard(label, value, iconClass) {
  return `
    <div class="jms-parental-pin-meta-card">
      <span class="jms-parental-pin-meta-icon" aria-hidden="true"><i class="fas ${iconClass}"></i></span>
      <div class="jms-parental-pin-meta-copy">
        <span class="jms-parental-pin-meta-label">${escapeHtml(label)}</span>
        <strong class="jms-parental-pin-meta-value">${escapeHtml(value)}</strong>
      </div>
    </div>
  `;
}

function buildPinSlots(slotCount = 8) {
  return Array.from({ length: slotCount }, (_, index) =>
    `<span class="jms-parental-pin-slot" data-slot-index="${index}"></span>`
  ).join("");
}

function ensurePromptStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .jms-parental-pin-backdrop {
    --jms-pin-accent: #ffd260;
    --jms-pin-accent-strong: #ffdf87;
    --jms-pin-accent-soft: rgba(255, 210, 96, 0.16);
    --jms-pin-accent-cool: rgba(114, 170, 255, 0.14);
    --jms-pin-surface: rgba(15, 18, 27, 0.98);
    --jms-pin-surface-alt: rgba(255, 255, 255, 0.06);
    --jms-pin-surface-strong: rgba(255, 255, 255, 0.1);
    --jms-pin-border: rgba(255, 255, 255, 0.1);
    --jms-pin-text-muted: rgba(255, 255, 255, 0.72);
    --jms-pin-text-soft: rgba(255, 255, 255, 0.55);
    --jms-pin-danger: #ff9b9b;
    --jms-pin-danger-soft: rgba(255, 120, 120, 0.12);
    position: fixed;
    inset: 0;
    background: rgba(7, 9, 14, 0.72);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    z-index: 100000;
  }

  .jms-parental-pin-dialog {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    width: min(480px, calc(100vw - 36px));
    max-width: 100%;
    background:
      radial-gradient(circle at top right, rgba(255, 210, 96, 0.22), transparent 32%),
      radial-gradient(circle at bottom left, rgba(114, 170, 255, 0.12), transparent 30%),
      linear-gradient(180deg, rgba(29, 33, 43, 0.98), rgba(12, 15, 22, 0.99));
    border: 1px solid var(--jms-pin-border);
    border-radius: 24px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    color: #fff;
    padding: 24px;
    animation: jms-parental-pin-enter 180ms cubic-bezier(0.22, 0.86, 0.34, 1);
  }

  .jms-parental-pin-dialog::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.06), transparent 26%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 40%);
    pointer-events: none;
    z-index: -1;
  }

  .jms-parental-pin-close {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease;
    flex: 0 0 auto;
  }

  .jms-parental-pin-close:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  .jms-parental-pin-close:disabled {
    cursor: wait;
    opacity: 0.7;
    transform: none;
  }

  .jms-parental-pin-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    margin-right: 44px;
  }

  .jms-parental-pin-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 210, 96, 0.22);
    background: rgba(255, 210, 96, 0.1);
    color: var(--jms-pin-accent-strong);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
  }

  .jms-parental-pin-hero-copy {
    min-width: 0;
  }

  .jms-parental-pin-dialog h3 {
    margin: 12px 0 8px;
    font-size: 1.34rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .jms-parental-pin-dialog p {
    margin: 0;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.84);
    max-width: 38ch;
    overflow-wrap: anywhere;
  }

  .jms-parental-pin-hero-icon {
    width: 72px;
    height: 72px;
    border-radius: 22px;
    background:
      radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.22), transparent 30%),
      linear-gradient(145deg, rgba(255, 210, 96, 0.24), rgba(114, 170, 255, 0.12));
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 20px 30px rgba(0, 0, 0, 0.18);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    color: var(--jms-pin-accent-strong);
    flex: 0 0 auto;
  }

  .jms-parental-pin-featured {
    margin-top: 18px;
    padding: 14px 16px;
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    min-width: 0;
  }

  .jms-parental-pin-featured-label {
    display: inline-block;
    margin-bottom: 6px;
    color: var(--jms-pin-text-soft);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .jms-parental-pin-featured-title {
    display: block;
    font-size: 1.08rem;
    font-weight: 700;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .jms-parental-pin-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
  }

  .jms-parental-pin-meta-card {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    padding: 13px 14px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .jms-parental-pin-meta-icon {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(255, 210, 96, 0.18), rgba(114, 170, 255, 0.08));
    color: var(--jms-pin-accent-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .jms-parental-pin-meta-copy {
    min-width: 0;
  }

  .jms-parental-pin-meta-label {
    display: block;
    color: var(--jms-pin-text-soft);
    font-size: 0.78rem;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .jms-parental-pin-meta-value {
    display: block;
    font-size: 0.96rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .jms-parental-pin-status-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 14px;
  }

  .jms-parental-pin-status-pill {
    min-width: 0;
    flex: 1 1 150px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-sizing: border-box;
  }

  .jms-parental-pin-status-pill span {
    display: block;
    color: var(--jms-pin-text-soft);
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .jms-parental-pin-status-pill strong {
    display: block;
    margin-top: 4px;
    font-size: 0.98rem;
    color: rgba(255, 255, 255, 0.94);
    overflow-wrap: anywhere;
  }

  .jms-parental-pin-input {
    margin-top: 18px;
  }

  .jms-parental-pin-input-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .jms-parental-pin-input label {
    display: block;
    font-size: 0.92rem;
    font-weight: 600;
  }

  .jms-parental-pin-input-help {
    color: var(--jms-pin-text-soft);
    font-size: 0.84rem;
    text-align: right;
  }

  .jms-parental-pin-input-frame {
    padding: 14px;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    box-sizing: border-box;
  }

  .jms-parental-pin-input input {
    width: 100%;
    max-width: 100%;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.24);
    color: #fff;
    outline: none;
    box-sizing: border-box;
    font-size: 1.08rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.34em;
    text-align: center;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  }

  .jms-parental-pin-input input:focus {
    border-color: rgba(255, 210, 96, 0.8);
    box-shadow: 0 0 0 3px rgba(255, 210, 96, 0.16);
  }

  .jms-parental-pin-slots {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .jms-parental-pin-slot {
    height: 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }

  .jms-parental-pin-slot.is-active {
    background: linear-gradient(90deg, var(--jms-pin-accent), var(--jms-pin-accent-strong));
    box-shadow: 0 0 0 1px rgba(255, 210, 96, 0.18), 0 6px 18px rgba(255, 210, 96, 0.2);
    transform: translateY(-1px);
  }

  .jms-parental-pin-error {
    min-height: 22px;
    margin-top: 12px;
    color: var(--jms-pin-danger);
    font-size: 0.9rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .jms-parental-pin-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 18px;
  }

  .jms-parental-pin-actions button {
    border: 0;
    border-radius: 999px;
    min-height: 46px;
    padding: 11px 18px;
    cursor: pointer;
    font-weight: 600;
    transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, opacity 0.18s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
    box-sizing: border-box;
  }

  .jms-parental-pin-cancel {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .jms-parental-pin-cancel:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.16);
  }

  .jms-parental-pin-confirm {
    background: linear-gradient(135deg, var(--jms-pin-accent), var(--jms-pin-accent-strong));
    color: #171717;
    box-shadow: 0 14px 30px rgba(255, 210, 96, 0.22);
  }

  .jms-parental-pin-confirm:hover {
    transform: translateY(-1px);
    box-shadow: 0 18px 36px rgba(255, 210, 96, 0.28);
  }

  .jms-parental-pin-confirm.is-loading {
    box-shadow: none;
  }

  .jms-parental-pin-actions button:disabled {
    cursor: wait;
    opacity: 0.74;
    transform: none;
    box-shadow: none;
  }

  .jms-parental-pin-spinner {
    width: 15px;
    height: 15px;
    border-radius: 999px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    display: none;
    animation: jms-parental-pin-spin 0.6s linear infinite;
  }

  .jms-parental-pin-confirm.is-loading .jms-parental-pin-spinner {
    display: inline-block;
  }

  .jms-parental-pin-dialog.has-error .jms-parental-pin-input-frame {
    border-color: rgba(255, 120, 120, 0.26);
    background:
      linear-gradient(180deg, rgba(255, 120, 120, 0.08), rgba(255, 255, 255, 0.03));
    box-shadow: 0 0 0 1px rgba(255, 120, 120, 0.1);
  }

  .jms-parental-pin-dialog.has-error .jms-parental-pin-input input {
    border-color: rgba(255, 120, 120, 0.36);
    box-shadow: 0 0 0 3px rgba(255, 120, 120, 0.1);
  }

  @keyframes jms-parental-pin-enter {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes jms-parental-pin-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 560px) {
    .jms-parental-pin-backdrop {
      align-items: flex-start;
      padding: 12px;
    }

    .jms-parental-pin-dialog {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 18px;
      border-radius: 20px;
      max-height: 92vh
    }

    .jms-parental-pin-hero {
      gap: 14px;
      margin-right: 0;
      display: flex;
      align-items: center;
      padding: 10px;
    }

    .jms-parental-pin-hero-icon {
      width: 60px;
      height: 60px;
      border-radius: 18px;
    }

    .jms-parental-pin-meta {
      grid-template-columns: 1fr;
    }

    .jms-parental-pin-status-row {
      flex-direction: column;
    }

    .jms-parental-pin-status-pill {
      flex: 1 1 auto;
      width: 100%;
    }

    .jms-parental-pin-input-head,
    .jms-parental-pin-actions {
      align-items: stretch;
    }

    .jms-parental-pin-input-help {
      text-align: left;
    }

    .jms-parental-pin-actions button {
      width: 100%;
    }

    .jms-parental-pin-dialog h3 {
      font-size: 1.18rem;
    }

    .jms-parental-pin-dialog p {
      max-width: 100%;
    }
  }

  @media (max-width: 400px) {
    .jms-parental-pin-backdrop {
      padding: 8px;
    }

    .jms-parental-pin-dialog {
      width: 100%;
      padding: 16px;
      border-radius: 18px;
    }

    .jms-parental-pin-close {
      top: 12px;
      right: 12px;
      width: 34px;
      height: 34px;
    }

    .jms-parental-pin-badge {
      font-size: 0.72rem;
      padding: 6px 10px;
    }

    .jms-parental-pin-dialog h3 {
      margin-top: 10px;
      font-size: 1.06rem;
      padding-right: 36px;
    }

    .jms-parental-pin-meta-card,
    .jms-parental-pin-status-pill,
    .jms-parental-pin-input-frame {
      padding-left: 12px;
      padding-right: 12px;
    }

    .jms-parental-pin-featured {
      padding: 7px 8px;
      margin: 4px;
    }

    .jms-parental-pin-input input {
      padding: 12px;
      font-size: 1rem;
      letter-spacing: 0.22em;
    }

    .jms-parental-pin-slots {
      gap: 6px;
    }

    .jms-parental-pin-slot {
      height: 8px;
    }

    .jms-parental-pin-actions {
      gap: 10px;
    }

    .jms-parental-pin-actions button {
      min-height: 44px;
      padding: 10px 14px;
    }
  }
  `;

  document.head.appendChild(style);
}

function parseIdFromHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const match = raw.match(/[?#&]id=([^&#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function getCurrentRouteItemId() {
  return parseIdFromHref(window.location.hash || window.location.href);
}

function isNativePlayActionElement(element) {
  if (!element) return false;
  const action = String(element.getAttribute?.("data-action") || element.dataset?.action || "").toLowerCase();
  const className = String(element.className || "");
  return (
    action === "play" ||
    action === "resume" ||
    /\bbtnPlay\b/.test(className) ||
    /\bbtnResume\b/.test(className)
  );
}

function shouldIgnoreNativePlayInterception(element) {
  if (!element?.closest) return false;
  return !!element.closest([
    "#settings-modal",
    "#jms-details-modal-root",
    "#monwui-watchlist-modal-root",
    ".video-preview-modal",
    ".monwui-trailer-modal-overlay",
    ".monwui-castmodal",
    ".monwui-main-button-container",
    ".monwui-dot-play-container",
    ".preview-play-button",
    ".jms-parental-pin-backdrop"
  ].join(", "));
}

function resolveNativePlayButton(target) {
  const element = target?.closest?.([
    ".itemAction",
    "[data-action=\"play\"]",
    "[data-action=\"resume\"]",
    ".btnPlay",
    ".btnResume"
  ].join(", "));

  if (!element || !isNativePlayActionElement(element) || shouldIgnoreNativePlayInterception(element)) {
    return null;
  }

  return element;
}

function extractItemIdFromNativePlayButton(element) {
  if (!element) return "";

  const candidates = [
    element.getAttribute?.("data-id"),
    element.getAttribute?.("data-itemid"),
    element.getAttribute?.("data-item-id"),
    element.dataset?.id,
    element.dataset?.itemid,
    element.dataset?.itemId,
    element.closest?.("[data-id]")?.getAttribute?.("data-id"),
    element.closest?.("[data-itemid]")?.getAttribute?.("data-itemid"),
    element.closest?.("[data-item-id]")?.getAttribute?.("data-item-id"),
    parseIdFromHref(element.getAttribute?.("href")),
    parseIdFromHref(element.closest?.("a[href]")?.getAttribute?.("href")),
    getCurrentRouteItemId()
  ];

  for (const candidate of candidates) {
    const itemId = String(candidate || "").trim();
    if (itemId) return itemId;
  }

  return "";
}

function installNativePlayInterceptor() {
  if (nativePlayInterceptorInstalled || typeof document === "undefined") {
    return;
  }

  nativePlayInterceptorInstalled = true;

  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;

    const button = resolveNativePlayButton(event.target);
    if (!button) return;

    const itemId = extractItemIdFromNativePlayButton(button);
    if (!itemId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    queueMicrotask(async () => {
      try {
        const apiModule = await import("/Plugins/JMSFusion/runtime/api.js");
        await apiModule?.playNow?.(itemId);
      } catch (error) {
        console.error("Native Jellyfin play interception failed:", error);
      }
    });
  }, true);
}

async function showPinPrompt({ itemName, officialRating, threshold, ruleLabel }) {
  ensurePromptStyles();

  return new Promise((resolve) => {
    const labels = getLabels();
    const closeLabel = labels.kapat || "Close";
    const continueLabel = labels.devam || "Continue";
    const checkingLabel = labels.parentalPinChecking || "Checking...";
    const inputHint = labels.parentalPinDialogHint || labels.parentalPinNewPlaceholder || "Enter 4 to 8 digits";
    const protectedBadge = labels.parentalPinProtectedBadge || "Protected content";
    const attemptsBadge = labels.parentalPinAttemptsBadge || "Attempts left";
    const trustBadge = labels.parentalPinTrustBadge || "Remember";
    const minutesShort = labels.parentalPinMinutesShort || "min";
    const featuredTitle = itemName || labels.untitled || "Untitled";
    const resolvedRating = formatResolvedRating(officialRating) || officialRating || "-";
    const maxAttempts = Math.max(0, Number(lastKnownPolicy?.maxAttempts || 0));
    const trustMinutes = Math.max(0, Number(lastKnownPolicy?.trustMinutes || 0));
    const backdrop = document.createElement("div");
    backdrop.className = "jms-parental-pin-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "jms-parental-pin-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "jms-parental-pin-title");
    dialog.setAttribute("aria-describedby", "jms-parental-pin-description");

    dialog.innerHTML = `
      <button type="button" class="jms-parental-pin-close" aria-label="${escapeHtml(closeLabel)}">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
      <div class="jms-parental-pin-hero">
        <div class="jms-parental-pin-hero-copy">
          <span class="jms-parental-pin-badge">
            <i class="fas fa-shield-alt" aria-hidden="true"></i>
            ${escapeHtml(protectedBadge)}
          </span>
          <h3 id="jms-parental-pin-title">${escapeHtml(labels.parentalPinDialogTitle || "PIN required")}</h3>
          <p id="jms-parental-pin-description">${escapeHtml(labels.parentalPinDialogText || "Administrator PIN is required for this content.")}</p>
        </div>
        <div class="jms-parental-pin-hero-icon" aria-hidden="true">
          <i class="fas fa-lock"></i>
        </div>
      </div>
      <div class="jms-parental-pin-featured">
        <span class="jms-parental-pin-featured-label">${escapeHtml(labels.content || "Content")}</span>
        <strong class="jms-parental-pin-featured-title">${escapeHtml(featuredTitle)}</strong>
      </div>
      <div class="jms-parental-pin-meta">
        ${buildMetaCard(labels.showOfficialRating || "Certification", resolvedRating, "fa-certificate")}
        ${buildMetaCard(labels.parentalPinThresholdLabel || "Active rule", ruleLabel || formatThresholdLabel(threshold, labels), "fa-sliders-h")}
      </div>
      <div class="jms-parental-pin-status-row">
        <div class="jms-parental-pin-status-pill">
          <span>${escapeHtml(attemptsBadge)}</span>
          <strong data-pin-attempts-value></strong>
        </div>
        ${trustMinutes > 0 ? `
          <div class="jms-parental-pin-status-pill">
            <span>${escapeHtml(trustBadge)}</span>
            <strong>${escapeHtml(`${trustMinutes} ${minutesShort}`)}</strong>
          </div>
        ` : ""}
      </div>
      <div class="jms-parental-pin-input">
        <div class="jms-parental-pin-input-head">
          <label for="jms-parental-pin-input">${escapeHtml(labels.parentalPinInputLabel || "PIN")}</label>
          <span class="jms-parental-pin-input-help">${escapeHtml(inputHint)}</span>
        </div>
        <div class="jms-parental-pin-input-frame">
          <input
            id="jms-parental-pin-input"
            type="password"
            inputmode="numeric"
            autocomplete="off"
            maxlength="8"
            placeholder="${escapeHtml(labels.parentalPinNewPlaceholder || "4-8 digits")}"
          />
          <div class="jms-parental-pin-slots" aria-hidden="true">
            ${buildPinSlots()}
          </div>
        </div>
      </div>
      <div class="jms-parental-pin-error" aria-live="polite"></div>
      <div class="jms-parental-pin-actions">
        <button type="button" class="jms-parental-pin-cancel">${escapeHtml(closeLabel)}</button>
        <button type="button" class="jms-parental-pin-confirm">
          <span class="jms-parental-pin-spinner" aria-hidden="true"></span>
          <span class="jms-parental-pin-confirm-label">${escapeHtml(continueLabel)}</span>
        </button>
      </div>
    `;

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const input = dialog.querySelector("input");
    const errorEl = dialog.querySelector(".jms-parental-pin-error");
    const closeBtn = dialog.querySelector(".jms-parental-pin-close");
    const cancelBtn = dialog.querySelector(".jms-parental-pin-cancel");
    const confirmBtn = dialog.querySelector(".jms-parental-pin-confirm");
    const confirmLabelEl = dialog.querySelector(".jms-parental-pin-confirm-label");
    const attemptValueEl = dialog.querySelector("[data-pin-attempts-value]");
    const slotEls = Array.from(dialog.querySelectorAll(".jms-parental-pin-slot"));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let closed = false;

    const refreshAttemptValue = () => {
      if (!attemptValueEl) return;
      const effectiveMax = maxAttempts > 0 ? maxAttempts : Math.max(0, Number(lastKnownPolicy?.maxAttempts || 0));
      const effectiveRemaining = effectiveMax > 0
        ? Math.max(0, Math.min(effectiveMax, Number(lastKnownPolicy?.remainingAttempts ?? effectiveMax)))
        : 0;
      attemptValueEl.textContent = effectiveMax > 0
        ? `${effectiveRemaining}/${effectiveMax}`
        : "-";
    };

    const updatePinSlots = () => {
      const filledCount = String(input.value || "").length;
      slotEls.forEach((slotEl, index) => {
        slotEl.classList.toggle("is-active", index < filledCount);
      });
    };

    const setError = (message = "") => {
      const hasError = !!String(message || "").trim();
      errorEl.textContent = hasError ? String(message) : "";
      dialog.classList.toggle("has-error", hasError);
    };

    const requestClose = () => {
      if (dialog.classList.contains("is-busy")) return;
      cleanup(false);
    };

    const cleanup = (result) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", handleKeydown, true);
      document.body.style.overflow = prevOverflow;
      backdrop.remove();
      resolve(result);
    };

    const setBusy = (busy) => {
      dialog.classList.toggle("is-busy", busy);
      confirmBtn.classList.toggle("is-loading", busy);
      confirmBtn.disabled = busy;
      cancelBtn.disabled = busy;
      closeBtn.disabled = busy;
      input.disabled = busy;
      confirmLabelEl.textContent = busy ? checkingLabel : continueLabel;
    };

    const submit = async () => {
      const pin = String(input.value || "").trim();
      if (!/^\d{4,8}$/.test(pin)) {
        setError(labels.parentalPinInvalidFormat || "PIN must be 4 to 8 digits.");
        input.focus();
        input.select?.();
        return;
      }

      setBusy(true);
      setError("");

      try {
        const response = await verifyParentalPin(pin);
        if (lastKnownPolicy) {
          lastKnownPolicy = {
            ...lastKnownPolicy,
            ...response,
            remainingAttempts: Number(response?.remainingAttempts || 0),
            lockedUntilUtc: Number(response?.lockedUntilUtc || 0),
            trustedUntilUtc: Number(response?.trustedUntilUtc || 0),
            isLocked: response?.isLocked === true,
            isTrusted: response?.isTrusted === true
          };
        }
        refreshAttemptValue();

        if (response?.valid === true) {
          cleanup(true);
          return;
        }

        if (response?.isLocked) {
          setError(getLockMessage(labels, response?.lockedUntilUtc));
          input.value = "";
          updatePinSlots();
          setTimeout(() => cleanup(false), 900);
          return;
        }

        setError(getInvalidAttemptMessage(labels, response));
        input.value = "";
        updatePinSlots();
        input.focus();
        input.select?.();
      } catch (error) {
        setError(
          getParentalPinErrorMessage(error, labels, labels.parentalPinVerifyFailed || "PIN verification failed.")
        );
      } finally {
        if (!closed) {
          setBusy(false);
        }
      }
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };

    document.addEventListener("keydown", handleKeydown, true);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) requestClose();
    });
    closeBtn.addEventListener("click", requestClose);
    cancelBtn.addEventListener("click", requestClose);
    confirmBtn.addEventListener("click", submit);
    input.addEventListener("input", () => {
      const numericValue = String(input.value || "").replace(/\D+/g, "").slice(0, 8);
      if (numericValue !== input.value) {
        input.value = numericValue;
      }
      updatePinSlots();
      if (dialog.classList.contains("has-error")) {
        setError("");
      }
    });

    refreshAttemptValue();
    updatePinSlots();
    setTimeout(() => input.focus(), 20);
  });
}

export async function ensureParentalPinBeforePlayback(item, { bypassItemId = null } = {}) {
  void bypassItemId;

  const evaluate = async () => {
    const labels = getLabels();
    let policy = null;

    try {
      policy = await fetchCurrentUserParentalPinPolicy();
      if (policy) {
        lastKnownPolicy = policy;
      }
    } catch (error) {
      if (!lastKnownPolicy) {
        showNotification(
          `<i class="fas fa-triangle-exclamation jms-notification-icon"></i> ${getParentalPinErrorMessage(error, labels, labels.parentalPinPolicyFetchFailed || "PIN policy could not be checked.")}`,
          4200,
          "error"
        );
        return false;
      }

      policy = lastKnownPolicy;
    }

    const officialRating = String(item?.OfficialRating || "").trim();
    const threshold = Number(policy?.rule?.ratingThreshold || 0);
    const requireUnratedPin = policy?.rule?.requireUnratedPin === true;
    const shouldPrompt =
      officialRating
        ? doesRatingRequirePin(officialRating, threshold)
        : requireUnratedPin;

    if (!(policy?.hasPin === true) || (!requireUnratedPin && !(threshold > 0))) return true;
    if (!shouldPrompt) return true;
    if (policy?.isTrusted === true && Number(policy?.trustedUntilUtc || 0) > Date.now()) return true;
    if (policy?.isLocked === true && Number(policy?.lockedUntilUtc || 0) > Date.now()) {
      showNotification(
        `<i class="fas fa-triangle-exclamation jms-notification-icon"></i> ${getLockMessage(labels, policy.lockedUntilUtc)}`,
        4200,
        "error"
      );
      return false;
    }

    const confirmed = await showPinPrompt({
      itemName: item?.Name || labels.untitled || "Untitled",
      officialRating: officialRating || labels.derecelendirmeyok || "No rating",
      threshold,
      ruleLabel: officialRating
        ? formatThresholdLabel(threshold, labels)
        : (labels.parentalPinUnratedLabel || "Require PIN when certification is missing")
    });

    return confirmed === true;
  };

  if (!activePromptPromise) {
    activePromptPromise = evaluate().finally(() => {
      activePromptPromise = null;
    });
  }

  return activePromptPromise;
}

installNativePlayInterceptor();
