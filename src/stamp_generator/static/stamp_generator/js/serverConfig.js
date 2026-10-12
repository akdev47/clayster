// What the Django page hands to the scripts: the price list, where to send an
// order, and the CSRF token that request needs. Missing values come back as
// null, so the tool still works (without ordering) when opened some other way.

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
    csrfToken: doc.querySelector('meta[name="csrf-token"]')?.content ?? null,
  };
}
