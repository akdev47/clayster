// Price estimate for the order page.
//
// The numbers below are HARDCODED PLACEHOLDERS. When the Django backend has a
// price list, load it into an object of the same shape and pass it as the
// `pricing` argument of estimatePrice(); nothing else needs to change. The
// backend must recompute the real price on order: this is only a preview.

export const PRICING = Object.freeze({
  currency: "EUR",
  vatRate: 0.21, // prices below already include VAT
  baseCents: 850, // one stamp, before size/extras
  perCm2Cents: 6, // per cm² of stamp face
  // Highest matching threshold wins; applied to the item total only.
  quantityDiscounts: Object.freeze([
    { minQuantity: 10, rate: 0.1 },
    { minQuantity: 25, rate: 0.15 },
    { minQuantity: 50, rate: 0.2 },
  ]),
  shipping: Object.freeze({
    freeOverCents: 5000,
    byCountryCents: Object.freeze({ NL: 495, BE: 695, DE: 695, FR: 895, OTHER: 1295 }),
  }),
});

/** Face area in cm², from the built stamp when known, else the face setting. */
export function faceAreaCm2(stamp, info) {
  const width = info?.width ?? stamp.faceSize;
  const depth = info?.depth ?? stamp.faceSize;
  const box = (width * depth) / 100;
  return stamp.faceShape === "round" ? (box * Math.PI) / 4 : box;
}

/**
 * Returns null while the quantity is not a valid whole number, otherwise
 * `{ currency, unitLines, unitCents, quantity, itemsCents, discountRate,
 *    discountCents, shippingCents, totalCents, vatCents }` (all money in cents).
 */
export function estimatePrice(
  { stamp, info = null, quantity, country = "NL" },
  pricing = PRICING,
) {
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1) return null;

  const area = faceAreaCm2(stamp, info);
  const unitLines = [
    { id: "base", label: "Clay stamp", cents: pricing.baseCents },
    {
      id: "size",
      label: `Size (${area.toFixed(1)} cm²)`,
      cents: Math.round(area * pricing.perCm2Cents),
    },
  ];

  const unitCents = unitLines.reduce((sum, { cents }) => sum + cents, 0);
  const itemsCents = unitCents * count;
  const discountRate = pricing.quantityDiscounts
    .filter(({ minQuantity }) => count >= minQuantity)
    .reduce((best, { rate }) => Math.max(best, rate), 0);
  const discountCents = Math.round(itemsCents * discountRate);

  const afterDiscount = itemsCents - discountCents;
  const zone = country in pricing.shipping.byCountryCents ? country : "OTHER";
  const shippingCents =
    afterDiscount >= pricing.shipping.freeOverCents
      ? 0
      : pricing.shipping.byCountryCents[zone];

  const totalCents = afterDiscount + shippingCents;
  return {
    currency: pricing.currency,
    unitLines,
    unitCents,
    quantity: count,
    itemsCents,
    discountRate,
    discountCents,
    shippingCents,
    totalCents,
    vatCents: Math.round((totalCents * pricing.vatRate) / (1 + pricing.vatRate)),
  };
}

export function formatMoney(cents, currency = PRICING.currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );
}
