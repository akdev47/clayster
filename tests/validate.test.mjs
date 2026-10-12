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
