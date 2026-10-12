import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";

const rectangle = (minX, maxX) => [
  [
    [minX, 0],
    [maxX, 0],
    [maxX, 10],
    [minX, 10],
  ],
];

const failingArtwork = () => [
  [
    [
      ["0", "0"],
      ["10", "0"],
      ["10", "10"],
      ["0", "10"],
    ],
  ],
];

test("overlapping polygons are still repaired successfully", () => {
  const result = validate([rectangle(0, 10), rectangle(5, 15)]);

  assert.equal(result.artwork.length, 1);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.level === "fixed" && /merged overlapping/i.test(issue.message),
    ),
  );
});

test("polygon repair failures return a clear validation error", () => {
  const result = validate(failingArtwork());

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.level === "error" &&
        /could not be repaired safely/i.test(issue.message),
    ),
  );
});

test("unrepaired polygons are not returned to the downstream pipeline", () => {
  const result = validate(failingArtwork());

  assert.deepEqual(result.artwork, []);
  assert.equal(
    result.issues.some((issue) =>
      /Meshing will use them as they are/i.test(issue.message),
    ),
    false,
  );
});

test("isolated convex corner contacts receive a bounded local chamfer", () => {
  const result = validate([
    [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    [[[4, 4], [8, 4], [8, 8], [4, 8]]],
  ], { tolerance: 0 });

  assert.equal(result.artwork.length, 2);
  assert.equal(result.artwork[0][0].length, 5);
  assert.equal(result.artwork[1][0].length, 5);
  assert.equal(
    result.artwork.flatMap((polygon) => polygon[0]).some(
      ([x, y]) => x === 4 && y === 4,
    ),
    false,
  );
  assert.ok(result.issues.some(
    ({ level, message }) =>
      level === "fixed" && /0\.005 mm local chamfer/i.test(message),
  ));
});

test("ambiguous multi-polygon point contacts fail closed", () => {
  const result = validate([
    [[[0, 0], [4, 0], [2, 2]]],
    [[[0, 0], [-2, 2], [-4, 0]]],
    [[[0, 0], [-2, -2], [2, -2]]],
  ], { tolerance: 0 });

  assert.deepEqual(result.artwork, []);
  assert.ok(result.issues.some(
    ({ level, message }) =>
      level === "error" && /ambiguous point contact/i.test(message),
  ));
});

test("a concave point contact is not modified speculatively", () => {
  const result = validate([
    [[[-4, -4], [4, -4], [4, 4], [0, 4], [0, 0], [-4, 0]]],
    [[[0, 0], [-1, 3], [-3, 1]]],
  ], { tolerance: 0 });

  assert.deepEqual(result.artwork, []);
  assert.ok(result.issues.some(
    ({ level, message }) =>
      level === "error" && /ambiguous point contact/i.test(message),
  ));
});
