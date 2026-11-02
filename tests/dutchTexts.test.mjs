import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COUNTRY_OPTIONS,
  MAX_QUANTITY,
  validateDelivery,
  validateOrderDetails,
} from "../src/stamp_generator/static/stamp_generator/js/orderDraft.js";

// The pages a customer sees are in Dutch. These tests keep it that way (no
// English slipping back into a template) and keep the browser and the server
// saying the same thing, since either one can be the one that finds a mistake.

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// Words that are English and not Dutch. Not a dictionary: just enough that an
// English sentence cannot get through unnoticed.
const ENGLISH = /\b(the|and|your|you|with|please|click|choose|enter|continue|review|settings|stamp|width|height|delete|duplicate|upload|quantity|shipping|payment|delivery|address|optional|preview|ready|warning|thank|total|subtotal|description|confirm|confirmed|waiting|back)\b/i;

/** What a visitor can read in a template: its text and the texts in its attributes. */
function visibleText(source) {
  const text = source
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{#[\s\S]*?#\}/g, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "");
  const pieces = text
    .split(/<[^>]*>/)
    .map((piece) => piece.replace(/&nbsp;|&amp;/g, " ").trim())
    .filter(Boolean);
  for (const [, , value] of text.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)) {
    pieces.push(value);
  }
  return pieces;
}

test("the customer's pages, error pages and email contain no English", () => {
  const files = [
    "stamp_generator/templates/stamp_generator/index.html",
    "orders/templates/orders/public/base.html",
    "orders/templates/orders/public/order.html",
    "orders/templates/orders/public/pay.html",
    "orders/templates/orders/email/order_confirmation.txt",
    "templates/404.html",
    "templates/500.html",
  ];
  for (const file of files) {
    const pieces = visibleText(read(file));
    assert.ok(pieces.length > 0, `${file} has text`);
    const english = pieces.filter((piece) => ENGLISH.test(piece));
    assert.deepEqual(english, [], `${file} still has English`);
  }
  // The two pages that start the document say which language it is in.
  for (const file of files.filter((name) => /index\.html|base\.html/.test(name))) {
    assert.match(read(file), /<html lang="nl">/, `${file} says it is Dutch`);
  }
});

test("the detector finds English, so the check above means something", () => {
  assert.deepEqual(
    visibleText('<p>Please enter your name</p><button title="Continue to payment">Go</button>{# the comment #}'),
    ["Please enter your name", "Go", "Continue to payment"],
  );
  assert.ok(ENGLISH.test("Continue to payment"));
  assert.ok(!ENGLISH.test("Verder naar betalen"));
});

test("the countries are the same in the browser and on the server", () => {
  const server = read("orders/pricing.py");
  const block = server.match(/COUNTRIES = \{([\s\S]*?)\}/)[1];
  const onServer = Object.fromEntries(
    [...block.matchAll(/"([A-Z]+)":\s*"([^"]+)"/g)].map(([, code, label]) => [code, label]),
  );
  const inBrowser = Object.fromEntries(COUNTRY_OPTIONS.map(({ code, label }) => [code, label]));
  assert.deepEqual(inBrowser, onServer);
});

test("a mistake in the order form is worded the same by the browser and the server", () => {
  const server = read("orders/forms.py").replace("{MAX_QUANTITY}", String(MAX_QUANTITY));
  const messages = new Set();
  const add = (errors) => Object.values(errors).forEach((message) => messages.add(message));

  add(validateOrderDetails({ title: "", quantity: 0 }));
  add(validateDelivery({}));
  add(validateDelivery({ country: "NL", postalCode: "x", houseNumber: "A", phone: "abc", email: "x" }));
  for (const country of ["BE", "DE", "FR"]) {
    add(validateDelivery({ country, postalCode: "x" }));
  }
  assert.ok(messages.size >= 12, "the form has many messages to compare");

  for (const message of messages) {
    assert.ok(server.includes(message), `the server does not say: ${message}`);
  }
});
