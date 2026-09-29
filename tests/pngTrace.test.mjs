import { test } from "node:test";
import assert from "node:assert/strict";
import { traceMaskToSVG } from "../src/pngTrace.js";

test("PNG tracing creates a closed contour", () => {
  const svg = traceMaskToSVG(
    new Uint8Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]),
    4,
    4,
  );

  assert.match(svg, /<svg/);
  assert.match(svg, /M1 1L3 1L3 3L1 3Z/);
});

test("PNG tracing preserves holes as a second contour", () => {
  const svg = traceMaskToSVG(new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]), 3, 3);

  assert.equal((svg.match(/M/g) ?? []).length, 2);
  assert.match(svg, /fill-rule="evenodd"/);
});

test("diagonally touching pixels remain separate shapes", () => {
  const svg = traceMaskToSVG(new Uint8Array([1, 0, 0, 1]), 2, 2);
  assert.equal((svg.match(/M/g) ?? []).length, 2);
});

test("PNG tracing rejects an empty image", () => {
  assert.throws(
    () => traceMaskToSVG(new Uint8Array(4), 2, 2),
    /no high-contrast artwork/i,
  );
});
