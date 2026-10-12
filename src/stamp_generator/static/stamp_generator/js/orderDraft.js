// Order details and delivery address collected on the order page, kept locally
// until the order has been placed (see orderApi.js). Nothing here talks to a
// server: buildOrderPayload() returns the body that gets sent.

export const ORDER_DRAFT_KEY = "clayster.orderDraft.v1";
export const MAX_QUANTITY = 999;

// Placeholder list; the backend will own the countries it can deliver to.
// `OTHER` is the catch-all shipping zone for any other country.
export const COUNTRY_OPTIONS = Object.freeze([
  { code: "NL", label: "Netherlands" },
  { code: "BE", label: "Belgium" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "OTHER", label: "Other country" },
]);

const POSTAL_CODE_PATTERNS = {
  NL: [/^\d{4}\s?[A-Za-z]{2}$/, "Use the format 1234 AB."],
  BE: [/^\d{4}$/, "Use a 4-digit postal code."],
  DE: [/^\d{5}$/, "Use a 5-digit postal code."],
  FR: [/^\d{5}$/, "Use a 5-digit postal code."],
};

export const DEFAULT_DELIVERY = Object.freeze({
  fullName: "",
  email: "",
  phone: "",
  street: "",
  houseNumber: "",
  postalCode: "",
  city: "",
  country: "NL",
});

export const DEFAULT_ORDER_DETAILS = Object.freeze({
  title: "",
  description: "",
  quantity: 1,
  notes: "",
});

/** Returns `{ field: message }` for every invalid field; empty means valid. */
export function validateOrderDetails(details) {
  const errors = {};

  if (String(details.title ?? "").trim() === "") {
    errors.title = "Give this order item a name.";
  }

  const quantity = Number(details.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.quantity = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`;
  }

  return errors;
}

/** Returns `{ field: message }` for every invalid delivery field. */
export function validateDelivery(delivery) {
  const errors = {};
  const text = (field) => String(delivery[field] ?? "").trim();
  const required = {
    fullName: "Enter the recipient's name.",
    street: "Enter the street.",
    houseNumber: "Enter the house number.",
    city: "Enter the city.",
  };
  for (const [field, message] of Object.entries(required)) {
    if (text(field) === "") errors[field] = message;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("email"))) {
    errors.email = "Enter a valid email address.";
  }
  if (text("phone") !== "" && !/^[+()\d\s-]{6,20}$/.test(text("phone"))) {
    errors.phone = "Use digits, spaces, + ( ) or - only.";
  }

  if (!COUNTRY_OPTIONS.some(({ code }) => code === delivery.country)) {
    errors.country = "Choose a country.";
  }
  const postal = text("postalCode");
  const [pattern, hint] = POSTAL_CODE_PATTERNS[delivery.country] ?? [];
  if (postal === "") errors.postalCode = "Enter the postal code.";
  else if (pattern && !pattern.test(postal)) errors.postalCode = hint;

  return errors;
}

export function normalizeDelivery(delivery) {
  const text = (field) => String(delivery[field] ?? "").trim();
  return {
    fullName: text("fullName"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    houseNumber: text("houseNumber"),
    postalCode: text("postalCode").toUpperCase(),
    city: text("city"),
    country: delivery.country ?? DEFAULT_DELIVERY.country,
  };
}

/** Trims text and coerces numbers so the stored values are what gets sent. */
export function normalizeOrderDetails(details) {
  return {
    title: String(details.title ?? "").trim(),
    description: String(details.description ?? "").trim(),
    quantity: Number(details.quantity),
    notes: String(details.notes ?? "").trim(),
  };
}

/**
 * The API-ready record: the order form, the stamp settings and a JSON-safe
 * copy of the design. Uploaded files cannot be serialised here, so artwork
 * elements carry the file name only (`reference`) and the backend hookup will
 * need to upload the asset itself.
 */
export function buildOrderPayload({
  details,
  delivery,
  pricing = null,
  elements,
  stamp,
  info = null,
  now = new Date(),
}) {
  return {
    schemaVersion: 2,
    savedAt: now.toISOString(),
    order: normalizeOrderDetails(details),
    delivery: normalizeDelivery(delivery),
    // A preview only: the backend must price the order itself.
    priceEstimate: pricing === null ? null : { ...pricing },
    stamp: { ...stamp },
    measurements: info === null ? null : { ...info },
    design: elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      visible: element.visible,
      operation: element.operation,
      transform: { ...element.transform },
      source: serialisableSource(element.source),
    })),
  };
}

function serialisableSource(source) {
  const copy = { ...source };
  if ("reference" in copy) copy.reference = referenceName(copy.reference);
  if (copy.font && typeof copy.font === "object") {
    copy.font = { ...copy.font, reference: referenceName(copy.font.reference) };
  }
  return copy;
}

function referenceName(reference) {
  if (reference === null || reference === undefined) return null;
  if (typeof reference === "string") {
    return reference.startsWith("blob:") ? null : reference.split("/").at(-1);
  }
  return reference.name ?? null;
}

/** Saves to the given Storage; returns false when storage is unavailable. */
export function saveOrderDraft(storage, payload) {
  try {
    storage.setItem(ORDER_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Removes the saved form, e.g. once the order has been placed. */
export function clearOrderDraft(storage) {
  try {
    storage.removeItem(ORDER_DRAFT_KEY);
  } catch {
    // Storage is unavailable: there is nothing saved to remove.
  }
}

/** The saved form values merged over the defaults, or the defaults. */
export function loadOrderForm(storage) {
  try {
    const saved = JSON.parse(storage.getItem(ORDER_DRAFT_KEY) ?? "null");
    return {
      details: pickKnown(DEFAULT_ORDER_DETAILS, saved?.order),
      delivery: pickKnown(DEFAULT_DELIVERY, saved?.delivery),
    };
  } catch {
    return {
      details: { ...DEFAULT_ORDER_DETAILS },
      delivery: { ...DEFAULT_DELIVERY },
    };
  }
}

// Defaults overlaid with the saved values for known fields only, so fields
// removed in a newer version (like the old product link) do not linger.
function pickKnown(defaults, saved) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, saved?.[key] ?? value]),
  );
}
