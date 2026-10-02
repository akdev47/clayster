import { test } from "node:test";
import assert from "node:assert/strict";
import { traceMaskToSVG } from "../src/pngTrace.js";
import { postProcessPNGArtwork } from "../src/pipeline/png.js";
import { ringArea } from "../src/pipeline/canonical.js";

const maskFrom = (width, height, filled) =>
  Uint8Array.from({ length: width * height }, (_, index) =>
    filled(index % width, Math.floor(index / width)) ? 1 : 0,
  );

const ringsFrom = (svg) =>
  [...svg.matchAll(/M([^Z]+)Z/g)].map((path) =>
    [...path[1].matchAll(/(?:^|L)(-?[\d.]+) (-?[\d.]+)/g)].map(
      (point) => [Number(point[1]), Number(point[2])],
    ),
  );

const processMask = (mask, width, height, size = 30) => {
  const raw = ringsFrom(traceMaskToSVG(mask, width, height));
  return { raw, processed: postProcessPNGArtwork([[...raw]], size)[0] };
};

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

test("rounded PNG silhouettes are simplified without changing their overall shape", () => {
  const width = 64;
  const height = 64;
  const mask = maskFrom(
    width,
    height,
    (x, y) => (x - 31.5) ** 2 + (y - 31.5) ** 2 <= 25 ** 2,
  );
  const { raw, processed } = processMask(mask, width, height);
  const ring = processed[0];

  assert.ok(ring.length < raw[0].length * 0.6);
  assert.ok(
    ring.every(([x, y]) => Math.abs(Math.hypot(x, y) - 15) <= 0.75),
  );
});

test("photographic edge noise is smoothed while a pronounced tip remains", () => {
  const width = 256;
  const height = 256;
  const mask = maskFrom(width, height, (x, y) => {
    const dx = x - 112;
    const dy = y - 128;
    const angle = Math.atan2(dy, dx);
    const noisyRadius = 88 + Math.sin(angle * 48) * 1.5;
    const body = Math.hypot(dx, dy) <= noisyRadius;
    const tip = x >= 198 && x <= 238 && Math.abs(y - 128) <= (238 - x) / 3;
    return body || tip;
  });
  const { raw, processed } = processMask(mask, width, height);
  const ring = processed[0];

  assert.ok(ring.length < raw[0].length * 0.35);
  assert.ok(ring.some(([x]) => x === 15));
});

test("PNG smoothing strength controls contour point reduction", () => {
  const width = 256;
  const height = 256;
  const mask = maskFrom(
    width,
    height,
    (x, y) =>
      Math.hypot(x - 127.5, y - 127.5) <=
      90 + Math.sin(Math.atan2(y - 127.5, x - 127.5) * 48) * 1.5,
  );
  const raw = ringsFrom(traceMaskToSVG(mask, width, height));
  const off = postProcessPNGArtwork([[...raw]], 30, { smoothing: 0 })[0][0];
  const normal = postProcessPNGArtwork([[...raw]], 30)[0][0];
  const strong = postProcessPNGArtwork([[...raw]], 30, { smoothing: 4 })[0][0];

  assert.ok(normal.length < off.length);
  assert.ok(strong.length < normal.length);
  assert.notEqual(ringArea(strong), 0);
});

test("diagonal PNG edges lose their staircase without losing the silhouette", () => {
  const width = 64;
  const height = 64;
  const mask = maskFrom(
    width,
    height,
    (x, y) => x >= 6 && y >= x / 2 + 8 && y <= 55,
  );
  const { raw, processed } = processMask(mask, width, height);

  assert.ok(processed[0].length < raw[0].length / 2);
  assert.ok(Math.abs(ringArea(processed[0])) > 100);
});

test("sharp PNG corners remain anchored", () => {
  const artwork = [[[
    [0, 0],
    [10, 0],
    [10, 4],
    [16, 5],
    [10, 6],
    [10, 10],
    [0, 10],
  ]]];
  const processed = postProcessPNGArtwork(artwork, 16, {
    smoothing: 4,
  })[0][0];

  assert.ok(processed.some(([x, y]) => x === 8 && y === 0));
});

test("PNG contour cleanup preserves holes and their winding", () => {
  const width = 48;
  const height = 48;
  const mask = maskFrom(width, height, (x, y) => {
    const outer = (x - 23.5) ** 2 + (y - 23.5) ** 2 <= 20 ** 2;
    const hole = (x - 23.5) ** 2 + (y - 23.5) ** 2 < 8 ** 2;
    return outer && !hole;
  });
  const { processed } = processMask(mask, width, height);

  assert.equal(processed.length, 2);
  assert.ok(ringArea(processed[0]) * ringArea(processed[1]) < 0);
});

test("cleaned PNG contours remain valid closed rings", () => {
  const artwork = [[[
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
    [2, 2],
    [0, 2],
  ]]];
  const ring = postProcessPNGArtwork(artwork, 20)[0][0];

  assert.ok(ring.length >= 3);
  assert.notDeepEqual(ring[0], ring[ring.length - 1]);
  assert.ok(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert.notEqual(ringArea(ring), 0);
});
