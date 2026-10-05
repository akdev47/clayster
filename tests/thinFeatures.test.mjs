import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAMP, fitToFace } from "../src/pipeline/stamp.js";
import { thinFeatureIssues } from "../src/pipeline/validate.js";
import { initializeSolids } from "../src/solidGeometry.js";

await initializeSolids();

const rectangle = (minX, minY, maxX, maxY) => [
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
];

const circle = (radius, segments = 128) =>
  Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });

const hasWarning = (input) => thinFeatureIssues(input).length === 1;

test("strip just below the minimum feature width is warned", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, 0.79)]]), true);
});

test("strip just above the minimum feature width is accepted", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, 0.81)]]), false);
});

test("thin neck between thick regions is warned", () => {
  const dumbbell = [
    [
      [-5, -2],
      [-1, -2],
      [-1, -0.3],
      [1, -0.3],
      [1, -2],
      [5, -2],
      [5, 2],
      [1, 2],
      [1, 0.3],
      [-1, 0.3],
      [-1, 2],
      [-5, 2],
    ],
  ];

  assert.equal(hasWarning([dumbbell]), true);
});

test("narrow protruding arm is warned", () => {
  const armed = [
    [
      [-3, -3],
      [3, -3],
      [3, -0.3],
      [6, -0.3],
      [6, 0.3],
      [3, 0.3],
      [3, 3],
      [-3, 3],
    ],
  ];

  assert.equal(hasWarning([armed]), true);
});

test("thin wall between a hole and outer contour is warned", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 4.4);

  assert.equal(hasWarning([[outer, hole]]), true);
});

test("safe wall between a hole and outer contour is accepted", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 4);

  assert.equal(hasWarning([[outer, hole]]), false);
});

test("only the thin polygon in multiple artwork polygons is counted", () => {
  const issues = thinFeatureIssues([
    [rectangle(0, 0, 4, 4)],
    [rectangle(6, 0, 12, 0.6)],
  ]);

  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /^1 shape looks thinner/i);
});

test("sharp valid corners are accepted with mitered offsets", () => {
  const triangle = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];

  assert.equal(hasWarning([[triangle]]), false);
});

test("curved donut walls are checked near the threshold", () => {
  const outer = circle(10);

  assert.equal(hasWarning([[outer, circle(9.21)]]), true);
  assert.equal(hasWarning([[outer, circle(9.19)]]), false);
});

test("reversed winding and redundant points do not change the result", () => {
  const redundant = [
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ].reverse();

  assert.equal(hasWarning([[redundant]]), false);
});

const artwork = [
  [
    [
      [-10, -0.5],
      [10, -0.5],
      [10, 0.5],
      [-10, 0.5],
    ],
  ],
];

const fit = (faceSize) =>
  fitToFace(
    artwork,
    {
      ...DEFAULT_STAMP,
      faceShape: "square",
      autoFaceSize: false,
      faceSize,
      margin: 1,
    },
    [],
  ).art;

test("oversized artwork is never rescaled to fit a fixed face", () => {
  assert.deepEqual(fit(10), artwork);
  assert.deepEqual(thinFeatureIssues(fit(10)), []);
});

test("artwork requiring no fitting stays unchanged", () => {
  const fitted = fit(24);

  assert.deepEqual(fitted, artwork);
  assert.deepEqual(thinFeatureIssues(fitted), []);
});
