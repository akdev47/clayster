import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPolygonPath,
  canonicalSvgScene,
  canonicalViewBox,
} from "../src/canonicalSvgRenderer.js";

const square = [
  [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ],
];

const element = (id, canonical, transform = {}) => ({
  id,
  kind: "svg",
  canonical,
  transform,
});

const sceneFor = (elements, dimensions = { widthMm: 60, heightMm: 45 }) =>
  canonicalSvgScene(elements, dimensions);

test("renders a simple canonical polygon as a closed SVG path", () => {
  assert.equal(
    canonicalPolygonPath(square),
    "M 0 0 L 2 0 L 2 -2 L 0 -2 Z",
  );
});

test("renders polygon holes in one even-odd path", () => {
  const polygonWithHole = [
    square[0],
    [
      [0.5, 0.5],
      [0.5, 1.5],
      [1.5, 1.5],
      [1.5, 0.5],
    ],
  ];
  const path = sceneFor([
    element("with-hole", [polygonWithHole]),
  ]).groups[0].paths[0];

  assert.equal(path.fillRule, "evenodd");
  assert.equal((path.d.match(/M /g) ?? []).length, 2);
  assert.match(path.d, /M 0\.5 -0\.5 L 0\.5 -1\.5/);
});

test("keeps multiple canonical elements in separate identified groups", () => {
  const scene = sceneFor([
    element("text-1", [square]),
    { ...element("png-1", [square]), kind: "png" },
  ]);

  assert.deepEqual(
    scene.groups.map(({ id, kind }) => [id, kind]),
    [
      ["text-1", "svg"],
      ["png-1", "png"],
    ],
  );
});

test("renders translated element geometry", () => {
  const path = sceneFor([
    element("moved", [square], { xMm: 5, yMm: 3 }),
  ]).groups[0].paths[0].d;

  assert.equal(path, "M 5 -3 L 7 -3 L 7 -5 L 5 -5 Z");
});

test("renders rotated element geometry", () => {
  const path = sceneFor([
    element("rotated", [square], { rotationDeg: 90 }),
  ]).groups[0].paths[0].d;

  assert.equal(path, "M 0 0 L 0 -2 L -2 -2 L -2 0 Z");
});

test("renders mirrored element geometry", () => {
  const path = sceneFor([
    element("mirrored", [square], { mirrorX: true }),
  ]).groups[0].paths[0].d;

  assert.equal(path, "M 0 -2 L -2 -2 L -2 0 L 0 0 Z");
});

test("maps canonical Y-up coordinates to SVG Y-down coordinates", () => {
  const path = canonicalPolygonPath([
    [
      [-1, -4],
      [1, -4],
      [1, 4],
    ],
  ]);

  assert.equal(path, "M -1 4 L 1 4 L 1 -4 Z");
});

test("uses physical stamp dimensions as the centred SVG viewBox", () => {
  assert.equal(canonicalViewBox(60, 45), "-30 -22.5 60 45");
  assert.equal(canonicalViewBox(80, 30), "-40 -15 80 30");
});

test("renders uniform element scale in physical coordinates", () => {
  const path = sceneFor([
    element("scaled", [square], { scale: 2 }),
  ]).groups[0].paths[0].d;

  assert.equal(path, "M 0 0 L 4 0 L 4 -4 L 0 -4 Z");
});
