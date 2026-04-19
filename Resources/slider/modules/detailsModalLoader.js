import { isDetailsModalModuleEnabled } from "./config.js";

let detailsModalModulePromise = null;

function resolveServerId(serverId = "") {
  const direct = String(serverId || "").trim();
  if (direct) return direct;

  return String(
    localStorage.getItem("persist_server_id") ||
    sessionStorage.getItem("persist_server_id") ||
    localStorage.getItem("serverId") ||
    sessionStorage.getItem("serverId") ||
    ""
  ).trim();
}

function buildDetailsUrl({ itemId, serverId = "", detailsHref = "" } = {}) {
  const explicitHref = String(detailsHref || "").trim();
  if (explicitHref) return explicitHref;

  const safeItemId = encodeURIComponent(String(itemId || "").trim());
  const safeServerId = encodeURIComponent(resolveServerId(serverId));
  return `#/details?id=${safeItemId}${safeServerId ? `&serverId=${safeServerId}` : ""}`;
}

export function navigateToDetailsPage(options = {}) {
  const href = buildDetailsUrl(options);
  if (!href) return false;

  try {
    if (href.startsWith("#")) {
      window.location.hash = href.slice(1);
    } else {
      window.location.href = href;
    }
    return true;
  } catch {
    return false;
  }
}

function loadDetailsModalModule() {
  return detailsModalModulePromise || (detailsModalModulePromise = import("./detailsModal.js"));
}

export async function openDetailsModal(options = {}) {
  if (!options?.itemId) return null;

  if (!isDetailsModalModuleEnabled()) {
    navigateToDetailsPage(options);
    return { navigated: true, disabled: true };
  }

  try {
    const { openDetailsModal: openDetailsModalInner } = await loadDetailsModalModule();
    return await openDetailsModalInner(options);
  } catch (error) {
    console.warn("detailsModalLoader fallback navigation:", error);
    navigateToDetailsPage(options);
    return { navigated: true, error };
  }
}

export async function closeDetailsModalIfLoaded() {
  if (!detailsModalModulePromise) return null;

  try {
    const mod = await detailsModalModulePromise;
    return mod?.closeDetailsModal?.();
  } catch {
    return null;
  }
}
