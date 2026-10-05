import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICING, estimatePrice, faceAreaCm2 } from "../src/pricing.js";

const stamp = { faceShape: "square", faceSize: 50, handle: "none" };
const info = { width: 50, depth: 40 };

test("prices a single stamp from base cost and face area", () => {
  assert.equal(faceAreaCm2(stamp, info), 20);
  const price = estimatePrice({ stamp, info, quantity: 1 });
  assert.equal(price.unitCents, PRICING.baseCents + 20 * PRICING.perCm2Cents);
  assert.equal(price.discountCents, 0);
  assert.equal(price.shippingCents, PRICING.shipping.byCountryCents.NL);
  assert.equal(price.totalCents, price.unitCents + price.shippingCents);
});

test("round faces use the circle area, and extras are added per stamp", () => {
  const round = { ...stamp, faceShape: "round", handle: "sample" };
  assert.ok(Math.abs(faceAreaCm2(round, { width: 40, depth: 40 }) - 12.566) < 0.01);

  const price = estimatePrice({ stamp: round, info, quantity: 2 });
  assert.ok(price.unitLines.some(({ id }) => id === "handle"));
  assert.equal(price.itemsCents, price.unitCents * 2);
});

test("quantity discounts, free shipping and shipping zones", () => {
  const ten = estimatePrice({ stamp, info, quantity: 10 });
  assert.equal(ten.discountRate, 0.1);
  assert.equal(ten.discountCents, Math.round(ten.itemsCents * 0.1));
  assert.equal(ten.shippingCents, 0, "large orders ship free");

  assert.equal(estimatePrice({ stamp, info, quantity: 1, country: "BE" }).shippingCents, 695);
  assert.equal(estimatePrice({ stamp, info, quantity: 1, country: "ZZ" }).shippingCents, 1295);
  assert.equal(estimatePrice({ stamp, info, quantity: 50 }).discountRate, 0.2);
});

test("an invalid quantity gives no price, and VAT is the included part", () => {
  for (const quantity of [0, -2, 1.5, "x", ""]) {
    assert.equal(estimatePrice({ stamp, info, quantity }), null, String(quantity));
  }
  const price = estimatePrice({ stamp, info, quantity: 1 });
  assert.equal(price.vatCents, Math.round((price.totalCents * 0.21) / 1.21));
});

test("a custom price list can replace the placeholder one", () => {
  const free = { ...PRICING, baseCents: 0, perCm2Cents: 0, shipping: { freeOverCents: 0, byCountryCents: { NL: 0 } } };
  assert.equal(estimatePrice({ stamp, info, quantity: 3 }, free).totalCents, 0);
});
