import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import {
  DEFAULT_DELIVERY,
  DEFAULT_ORDER_DETAILS,
  ORDER_DRAFT_KEY,
  buildOrderPayload,
  loadOrderForm,
  saveOrderDraft,
  validateDelivery,
  validateOrderDetails,
} from "../src/orderDraft.js";

const goodDelivery = {
  ...DEFAULT_DELIVERY,
  firstName: "Anna",
  lastName: "Jansen",
  email: "anna@example.com",
  street: "Kerkstraat",
  houseNumber: "12",
  houseNumberAddition: "a",
  postalCode: "1234 AB",
  city: "Utrecht",
};
const valid = { ...DEFAULT_ORDER_DETAILS, title: "Bakery stamp", quantity: 3 };

test("validates name and quantity", () => {
  assert.deepEqual(validateOrderDetails(valid), {});
  assert.ok(validateOrderDetails({ ...valid, title: "  " }).title);
  for (const quantity of [0, -1, 1.5, "abc", 1000, ""]) {
    assert.ok(validateOrderDetails({ ...valid, quantity }).quantity, String(quantity));
  }
  assert.equal("description" in validateOrderDetails(valid), false, "description is optional");
});

test("payload is JSON-safe and keeps only file names for uploaded artwork", () => {
  const file = new File(["x"], "logo.svg");
  const model = new DesignModel({
    elements: [
      { id: "t", kind: "text", source: { text: "HI", fontSizeMm: 7.5 } },
      { id: "s", kind: "svg", source: { reference: file } },
      { id: "b", kind: "svg", source: { reference: "blob:http://x/1234" } },
    ],
  });
  const payload = buildOrderPayload({
    details: { ...valid, title: "  Bakery  ", quantity: "3" },
    delivery: { ...goodDelivery, postalCode: "1234 ab" },
    elements: model.elements,
    stamp: { faceShape: "round", faceSize: 50 },
    info: { width: 50, depth: 50 },
    now: new Date("2026-01-02T03:04:05Z"),
  });

  assert.equal(payload.order.title, "Bakery");
  assert.equal(payload.order.quantity, 3);
  assert.equal(payload.delivery.postalCode, "1234 AB");
  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.delivery.firstName, "Anna");
  assert.equal(payload.delivery.lastName, "Jansen");
  assert.equal(payload.delivery.houseNumber, "12");
  assert.equal(payload.delivery.houseNumberAddition, "a");
  assert.equal("fullName" in payload.delivery, false);
  assert.equal(payload.savedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(payload.design[1].source.reference, "logo.svg");
  assert.equal(payload.design[2].source.reference, null);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});

test("saves and reloads order details, tolerating broken storage", () => {
  const data = new Map();
  const storage = {
    setItem: (k, v) => data.set(k, v),
    getItem: (k) => data.get(k) ?? null,
  };
  const payload = buildOrderPayload({
    details: { ...valid, notes: "Rush" },
    delivery: goodDelivery,
    elements: [],
    stamp: {},
  });

  assert.equal(saveOrderDraft(storage, payload), true);
  assert.ok(data.has(ORDER_DRAFT_KEY));
  assert.equal(loadOrderForm(storage).details.notes, "Rush");
  assert.equal(loadOrderForm(storage).details.quantity, 3);
  assert.equal(loadOrderForm(storage).delivery.city, "Utrecht");

  data.set(ORDER_DRAFT_KEY, "{not json");
  assert.deepEqual(loadOrderForm(storage).details, DEFAULT_ORDER_DETAILS);
  const broken = { setItem() { throw new Error("full"); }, getItem() { throw new Error("no"); } };
  assert.equal(saveOrderDraft(broken, payload), false);
  assert.deepEqual(loadOrderForm(broken).delivery, DEFAULT_DELIVERY);
});

test("validates delivery fields and country-specific postal codes", () => {
  assert.deepEqual(validateDelivery(goodDelivery), {});

  const empty = validateDelivery(DEFAULT_DELIVERY);
  for (const field of ["firstName", "lastName", "email", "street", "houseNumber", "postalCode", "city"]) {
    assert.ok(empty[field], field);
  }
  assert.equal("phone" in empty, false, "phone is optional");
  assert.equal("houseNumberAddition" in empty, false, "addition is optional");

  for (const houseNumber of ["12a", "0", "-3", "1 2", "123456"]) {
    assert.ok(validateDelivery({ ...goodDelivery, houseNumber }).houseNumber, houseNumber);
  }
  assert.deepEqual(validateDelivery({ ...goodDelivery, houseNumberAddition: "" }), {});

  assert.ok(validateDelivery({ ...goodDelivery, email: "nope" }).email);
  assert.ok(validateDelivery({ ...goodDelivery, phone: "abc" }).phone);
  assert.deepEqual(validateDelivery({ ...goodDelivery, phone: "+31 6 1234 5678" }), {});
  assert.ok(validateDelivery({ ...goodDelivery, postalCode: "12345" }).postalCode);
  assert.deepEqual(
    validateDelivery({ ...goodDelivery, country: "DE", postalCode: "10115" }),
    {},
  );
  assert.deepEqual(
    validateDelivery({ ...goodDelivery, country: "OTHER", postalCode: "SW1A 1AA" }),
    {},
  );
  assert.ok(validateDelivery({ ...goodDelivery, country: "XX" }).country);
});
