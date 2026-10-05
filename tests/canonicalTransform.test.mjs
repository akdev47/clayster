import { test } from "node:test";
import assert from "node:assert/strict";
import { ringArea, transform } from "../src/pipeline/canonical.js";

const pointArtwork = (x, y) => [[[[x, y]]]];
const transformedPoint = (point, options) =>
  transform(pointArtwork(...point), options)[0][0][0];

function assertPoint(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-10,
      `expected ${expected[index]}, received ${value}`,
    );
  });
}

test("translates canonical geometry in millimetres", () => {
  assertPoint(transformedPoint([2, 3], { xMm: 5, yMm: -4 }), [7, -1]);
});

test("uniformly scales canonical geometry", () => {
  assertPoint(transformedPoint([2, -3], { scale: 2.5 }), [5, -7.5]);
});

test("rotates canonical geometry counter-clockwise", () => {
  assertPoint(transformedPoint([2, 1], { rotationDeg: 90 }), [-1, 2]);
});

test("mirrors canonical geometry on X", () => {
  assertPoint(transformedPoint([2, 3], { mirrorX: true }), [-2, 3]);
});

test("mirrors canonical geometry on Y", () => {
  assertPoint(transformedPoint([2, 3], { mirrorY: true }), [2, -3]);
});

test("applies transforms around the supplied pivot", () => {
  assertPoint(
    transformedPoint([2, 1], { pivotX: 1, pivotY: 1, rotationDeg: 90 }),
    [1, 2],
  );
});

test("preserves outer and hole winding under reflection", () => {
  const artwork = [
    [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      [
        [1, 1],
        [1, 3],
        [3, 3],
        [3, 1],
      ],
    ],
  ];

  for (const reflection of [{ mirrorX: true }, { mirrorY: true }]) {
    const reflected = transform(artwork, reflection);
    assert.ok(ringArea(reflected[0][0]) > 0);
    assert.ok(ringArea(reflected[0][1]) < 0);
    assert.equal(Math.abs(ringArea(reflected[0][0])), 16);
    assert.equal(Math.abs(ringArea(reflected[0][1])), 4);
  }
});

test("uses pivot mirror-scale, rotation, then translation order", () => {
  assertPoint(
    transformedPoint([2, 1], {
      xMm: 3,
      yMm: 4,
      scale: 2,
      rotationDeg: 90,
      mirrorX: true,
      pivotX: 1,
      pivotY: 1,
    }),
    [4, 3],
  );
});
