let detailsModalModulePromise = null;

function loadDetailsModalModule() {
  return detailsModalModulePromise || (detailsModalModulePromise = import("./detailsModal.js"));
}

export async function openDetailsModal(options = {}) {
  const { openDetailsModal: openDetailsModalInner } = await loadDetailsModalModule();
  return openDetailsModalInner(options);
}
