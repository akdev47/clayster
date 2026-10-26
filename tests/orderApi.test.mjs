import { test } from "node:test";
import assert from "node:assert/strict";
import { submitOrder } from "../src/stamp_generator/static/stamp_generator/js/orderApi.js";
import { readServerConfig } from "../src/stamp_generator/static/stamp_generator/js/serverConfig.js";
import { ORDER_DRAFT_KEY, clearOrderDraft, saveOrderDraft } from "../src/stamp_generator/static/stamp_generator/js/orderDraft.js";

const stl = new Blob([new Uint8Array(100)], { type: "model/stl" });
const payload = { order: { title: "Logo" }, delivery: {} };

const respond = (status, body) => async () =>
  new Response(body === undefined ? "<html>oops</html>" : JSON.stringify(body), { status });

test("posts the payload and the stl as multipart with the CSRF token", async () => {
  let request;
  const result = await submitOrder({
    endpoint: "/api/orders/",
    csrfToken: "token-123",
    payload,
    stl,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ payUrl: "/order/abc/pay/" }), { status: 201 });
    },
  });

  assert.deepEqual(result, { ok: true, payUrl: "/order/abc/pay/" });
  assert.equal(request.url, "/api/orders/");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.headers["X-CSRFToken"], "token-123");
  assert.ok(request.options.body instanceof FormData);
  assert.deepEqual(JSON.parse(request.options.body.get("payload")), payload);
  const file = request.options.body.get("stl");
  assert.equal(file.size, 100);
  assert.equal(file.name, "stamp.stl");
  assert.equal(request.options.headers["Content-Type"], undefined, "the browser sets the multipart boundary");
});

test("passes the server's field errors on as they are", async () => {
  const errors = { order: { title: "Give this order item a name." }, delivery: { email: "Enter a valid email address." } };
  const result = await submitOrder({ endpoint: "/x", csrfToken: "t", payload, stl, fetchImpl: respond(400, { errors }) });
  assert.deepEqual(result, { ok: false, errors });
});

test("a reply that is not the expected JSON becomes a general error", async () => {
  for (const [status, body] of [[500, undefined], [403, undefined], [201, { nothing: true }]]) {
    const result = await submitOrder({ endpoint: "/x", csrfToken: "t", payload, stl, fetchImpl: respond(status, body) });
    assert.equal(result.ok, false, `status ${status}`);
    assert.match(result.errors.general, /try again/i);
  }
});

test("an unreachable server becomes a general error instead of throwing", async () => {
  const result = await submitOrder({
    endpoint: "/x",
    csrfToken: null,
    payload,
    stl,
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.general, /Could not reach the server/);
});

const fakeDocument = ({ config, token }) => ({
  getElementById: (id) =>
    id === "clayster-config" && config !== undefined ? { textContent: config } : null,
  querySelector: (selector) =>
    selector === 'meta[name="csrf-token"]' && token !== undefined ? { content: token } : null,
});

test("reads the price list, endpoint and CSRF token the page provides", () => {
  const config = readServerConfig(
    fakeDocument({
      config: JSON.stringify({ pricing: { baseCents: 1 }, orderEndpoint: "/api/orders/" }),
      token: "abc",
    }),
  );
  assert.deepEqual(config, { pricing: { baseCents: 1 }, orderEndpoint: "/api/orders/", canExportStl: false, csrfToken: "abc" });
});

test("the STL download is only on when the server says this visitor may use it", () => {
  const read = (config) => readServerConfig(fakeDocument({ config: JSON.stringify(config) })).canExportStl;
  assert.equal(read({ canExportStl: true }), true);
  assert.equal(read({ canExportStl: false }), false);
  assert.equal(read({}), false);
  // Only a real true counts, not something that merely looks true.
  assert.equal(read({ canExportStl: "true" }), false);
  assert.equal(read({ canExportStl: 1 }), false);
});

test("a page without config, or with broken config, gives nulls", () => {
  const empty = { pricing: null, orderEndpoint: null, canExportStl: false, csrfToken: null };
  assert.deepEqual(readServerConfig(fakeDocument({})), empty);
  assert.deepEqual(readServerConfig(fakeDocument({ config: "{not json" })), empty);
});

test("the saved order form is removed once the order is placed", () => {
  const store = new Map();
  const storage = {
    setItem: (key, value) => store.set(key, value),
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => store.delete(key),
  };
  assert.ok(saveOrderDraft(storage, { delivery: { email: "a@b.nl" } }));
  assert.ok(storage.getItem(ORDER_DRAFT_KEY));
  clearOrderDraft(storage);
  assert.equal(storage.getItem(ORDER_DRAFT_KEY), null);

  // Unavailable storage must not break placing the order.
  clearOrderDraft({
    removeItem() {
      throw new Error("blocked");
    },
  });
});
