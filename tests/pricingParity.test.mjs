import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRICING, estimatePrice } from "../src/stamp_generator/static/stamp_generator/js/pricing.js";

// The same cases are checked against the server's calculation in
// src/orders/tests.py, so the preview price and the real price cannot drift apart.
const shared = JSON.parse(
  readFileSync(new URL("../src/orders/test_data/pricing_cases.json", import.meta.url), "utf8"),
);

test("the built-in price list is the one the server sends to the page", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PRICING)), shared.pricing);
});

for (const { name, stamp, info, quantity, country, expected } of shared.cases) {
  test(`shared price case: ${name}`, () => {
    const price = estimatePrice({ stamp, info, quantity, country });
    assert.deepEqual(
      {
        unitCents: price.unitCents,
        itemsCents: price.itemsCents,
        discountCents: price.discountCents,
        shippingCents: price.shippingCents,
        totalCents: price.totalCents,
      },
      expected,
    );
  });
}
