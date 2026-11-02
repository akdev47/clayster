// Order details and delivery address collected on the order page, kept locally
// until the order has been placed (see orderApi.js). Nothing here talks to a
// server: buildOrderPayload() returns the body that gets sent.
import { SETTINGS } from "./settings.js";

export const ORDER_DRAFT_KEY = "clayster.orderDraft.v1";
export const MAX_QUANTITY = SETTINGS.order.maxQuantity;

// Placeholder list; the backend will own the countries it can deliver to.
// `OTHER` is the catch-all shipping zone for any other country.
export const COUNTRY_OPTIONS = Object.freeze([
  { code: "NL", label: "Nederland" },
  { code: "BE", label: "België" },
  { code: "DE", label: "Duitsland" },
  { code: "FR", label: "Frankrijk" },
  { code: "OTHER", label: "Ander land" },
]);

const POSTAL_CODE_PATTERNS = {
  NL: [/^\d{4}\s?[A-Za-z]{2}$/, "Gebruik het formaat 1234 AB."],
  BE: [/^\d{4}$/, "Gebruik een postcode van 4 cijfers."],
  DE: [/^\d{5}$/, "Gebruik een postcode van 5 cijfers."],
  FR: [/^\d{5}$/, "Gebruik een postcode van 5 cijfers."],
};

export const DEFAULT_DELIVERY = Object.freeze({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  street: "",
  houseNumber: "",
  houseNumberAddition: "",
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
    errors.title = "Geef de stempel een naam.";
  }

  const quantity = Number(details.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.quantity = `Het aantal moet een geheel getal van 1 tot ${MAX_QUANTITY} zijn.`;
  }

  return errors;
}

/** Returns `{ field: message }` for every invalid delivery field. */
export function validateDelivery(delivery) {
  const errors = {};
  const text = (field) => String(delivery[field] ?? "").trim();
  const required = {
    firstName: "Vul de voornaam in.",
    lastName: "Vul de achternaam in.",
    street: "Vul de straat in.",
    houseNumber: "Vul het huisnummer in.",
    city: "Vul de plaats in.",
  };
  for (const [field, message] of Object.entries(required)) {
    if (text(field) === "") errors[field] = message;
  }

  // The backend stores the number as an integer; letters go in the addition.
  if (!errors.houseNumber && !/^[1-9]\d{0,4}$/.test(text("houseNumber"))) {
    errors.houseNumber = "Gebruik alleen cijfers; zet letters zoals A bij de toevoeging.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("email"))) {
    errors.email = "Vul een geldig e-mailadres in.";
  }
  if (text("phone") !== "" && !/^[+()\d\s-]{6,20}$/.test(text("phone"))) {
    errors.phone = "Gebruik alleen cijfers, spaties, + ( ) of -.";
  }

  if (!COUNTRY_OPTIONS.some(({ code }) => code === delivery.country)) {
    errors.country = "Kies een land.";
  }
  const postal = text("postalCode");
  const [pattern, hint] = POSTAL_CODE_PATTERNS[delivery.country] ?? [];
  if (postal === "") errors.postalCode = "Vul de postcode in.";
  else if (pattern && !pattern.test(postal)) errors.postalCode = hint;

  return errors;
}

export function normalizeDelivery(delivery) {
  const text = (field) => String(delivery[field] ?? "").trim();
  return {
    firstName: text("firstName"),
    lastName: text("lastName"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    houseNumber: text("houseNumber"),
    houseNumberAddition: text("houseNumberAddition"),
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
    schemaVersion: 3,
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
