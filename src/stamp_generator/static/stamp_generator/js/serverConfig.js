// What the Django page hands to the scripts: the price list, where to send an
// order, whether this visitor may download the STL file, and the CSRF token the
// order request needs. Missing values come back as null (or false for the STL
// download), so the tool still works, without ordering or export, when opened
// some other way.

export function readServerConfig(doc = document) {
  let config = {};
  try {
    config = JSON.parse(doc.getElementById("clayster-config")?.textContent ?? "{}");
  } catch {
    // Unreadable config: behave as if there was none.
  }
  return {
    pricing: config.pricing ?? null,
    orderEndpoint: config.orderEndpoint ?? null,
    canExportStl: config.canExportStl === true,
    csrfToken: doc.querySelector('meta[name="csrf-token"]')?.content ?? null,
  };
}
