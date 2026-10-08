import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPolygonPath,
  canonicalSvgScene,
  canonicalViewBox,
  canonicalSvgTransform,
  createCanonicalSvgRenderer,
} from "../src/canonicalSvgRenderer.js";
import { transform } from "../src/pipeline/canonical.js";

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

test("uses physical face bounds for an off-centre outline viewBox", () => {
  assert.equal(
    canonicalViewBox(20, 10, { minX: 5, minY: -3 }),
    "5 -7 20 10",
  );
});

test("renders uniform element scale in physical coordinates", () => {
  const path = sceneFor([
    element("scaled", [square], { scale: 2 }),
  ]).groups[0].paths[0].d;

  assert.equal(path, "M 0 0 L 4 0 L 4 -4 L 0 -4 Z");
});

test("SVG gesture transforms match physical transforms with rotation, mirrors and pivots", () => {
  const options = { xMm: 4, yMm: -3, scale: 2, rotationDeg: 37, mirrorX: true, mirrorY: false, pivotX: 3, pivotY: 1 };
  const operations = [...canonicalSvgTransform(options).matchAll(/(translate|rotate|scale)\(([^)]+)\)/g)];
  const input = [5, 2];
  let point = [input[0], -input[1]];
  for (const [, type, values] of operations.reverse()) {
    const [a, b] = values.split(" ").map(Number);
    if (type === "translate") point = [point[0] + a, point[1] + b];
    if (type === "scale") point = [point[0] * a, point[1] * b];
    if (type === "rotate") {
      const angle = a * Math.PI / 180;
      point = [point[0] * Math.cos(angle) - point[1] * Math.sin(angle), point[0] * Math.sin(angle) + point[1] * Math.cos(angle)];
    }
  }
  const expected = transform([[[input]]], options)[0][0][0];
  assert.ok(Math.abs(point[0] - expected[0]) < 1e-9);
  assert.ok(Math.abs(point[1] + expected[1]) < 1e-9);
});

test("gesture redraws retain SVG paths and replace them only when source geometry changes", () => {
  class Node {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.replacements = 0; }
    setAttribute(key, value) { this.attributes[key] = value; }
    replaceChildren(...children) { this.children = children; this.replacements++; }
  }
  const previousDocument = globalThis.document;
  const previousSVG = globalThis.SVGElement;
  globalThis.document = { createElementNS: () => new Node() };
  globalThis.SVGElement = Node;
  try {
    const svg = new Node();
    const renderer = createCanonicalSvgRenderer(svg);
    const canonical = [square];
    const dimensions = { widthMm: 60, heightMm: 45 };
    const draw = (geometry, scale, kind = "text") => renderer.renderTransformed([
      { id: "text-1", kind, canonical: geometry, transforms: [{ scale, xMm: 5, yMm: 3 }, { scale: 1 }] },
    ], dimensions);
    draw(canonical, 1);
    const group = svg.children[1];
    const path = group.children[0];
    const originalPath = path.attributes.d;
    for (let i = 1; i <= 100; i++) draw(canonical, 1 + i / 100);
    assert.equal(svg.children[1], group);
    assert.equal(group.children[0], path);
    assert.equal(path.attributes.d, originalPath);
    assert.equal(svg.replacements, 1);
    assert.match(group.attributes.transform, /scale\(2 2\)/);
    draw(canonical, 2, "overflow");
    assert.equal(svg.children[1], group);
    assert.equal(group.dataset.elementKind, "overflow");
    draw(transform(canonical, { scale: 2 }), 1);
    assert.notEqual(svg.children[1], group);
    renderer.renderTransformed([], dimensions);
    assert.equal(svg.children.length, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousSVG === undefined) delete globalThis.SVGElement;
    else globalThis.SVGElement = previousSVG;
  }
});
