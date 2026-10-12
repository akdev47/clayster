import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import opentype from "opentype.js";
import {
  canonicalizeSVGShapes,
  scaleToSize,
  SVG_SIMPLIFY_TOLERANCE_MM,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/svg.js";
import { removeShortEdges } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";

const IDENTITY = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
};

test("Bézier-heavy filled paths receive adaptive curve sampling", () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(5, -25, 25, -25, 30, 0);
  shape.bezierCurveTo(35, 25, 55, 25, 60, 0);
  shape.bezierCurveTo(50, 50, 10, 50, 0, 0);

  const fixedCount = shape.extractPoints(8).shape.length - 1;
  const ring = canonicalizeSVGShapes([shape], IDENTITY, 80)[0][0];

  assert.ok(ring.length > fixedCount * 2);
  assert.ok(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});

test("circle and ellipse chords stay within the physical curve tolerance", () => {
  const ellipse = new THREE.Shape();
  ellipse.absellipse(0, 0, 20, 10, 0, Math.PI * 2, false, 0);

  const canonical = canonicalizeSVGShapes([ellipse], IDENTITY, 60);
  const ring = validate(canonical, {
    tolerance: SVG_SIMPLIFY_TOLERANCE_MM,
  }).artwork[0][0];
  let worst = 0;
  for (let index = 0; index < ring.length; index++) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const x = (start[0] + end[0]) / 2;
    const y = (start[1] + end[1]) / 2;
    const radialRatio = Math.hypot(x / 30, y / 15);
    const radialDistance = Math.hypot(x, y) * (1 / radialRatio - 1);
    worst = Math.max(worst, radialDistance);
  }

  assert.ok(worst <= 0.02, `ellipse chord error was ${worst} mm`);
});

test("larger curved artwork receives more samples than smaller artwork", () => {
  const circle = new THREE.Shape();
  circle.absellipse(0, 0, 10, 10, 0, Math.PI * 2, false, 0);

  const small = canonicalizeSVGShapes([circle], IDENTITY, 10)[0][0];
  const large = canonicalizeSVGShapes([circle], IDENTITY, 100)[0][0];

  assert.ok(large.length > small.length);
  assert.equal(Math.max(...small.map(([x]) => x)), 5);
  assert.equal(Math.max(...large.map(([x]) => x)), 50);
});

test("near-duplicate consecutive points are removed after mm scaling", () => {
  const artwork = [
    [
      [
        [0, 0],
        [0.0000001, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ],
  ];

  assert.equal(removeShortEdges(scaleToSize(artwork, 10))[0][0].length, 4);
});

test("extremely short edges are removed safely", () => {
  const artwork = [
    [
      [
        [0, 0],
        [10, 0],
        [10, 0.0005],
        [10, 10],
        [0, 10],
      ],
    ],
  ];

  const cleaned = removeShortEdges(scaleToSize(artwork, 10));
  assert.deepEqual(cleaned[0][0], [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]);
});

test("straight polygon coordinates and intended holes remain unchanged", () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(10, 0);
  shape.lineTo(10, 10);
  shape.lineTo(0, 10);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(3, 3);
  hole.lineTo(3, 7);
  hole.lineTo(7, 7);
  hole.lineTo(7, 3);
  hole.closePath();
  shape.holes.push(hole);

  assert.deepEqual(canonicalizeSVGShapes([shape], IDENTITY, 20), [
    [
      [
        [-10, 10],
        [10, 10],
        [10, -10],
        [-10, -10],
      ],
      [
        [-4, 4],
        [-4, -4],
        [4, -4],
        [4, 4],
      ],
    ],
  ]);
});

test("the irregular curve SVG fixture remains valid at higher fidelity", async () => {
  const svg = await readFile(
    new URL("./fixtures/irregular-curves.svg", import.meta.url),
    "utf8",
  );
  const shapes = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].flatMap(
    (match) => shapesFromPathData(match[1]),
  );
  const artwork = canonicalizeSVGShapes(shapes, IDENTITY, 60);
  const checked = validate(artwork, {
    tolerance: SVG_SIMPLIFY_TOLERANCE_MM,
  });

  assert.ok(shapes.length > 0);
  assert.ok(artwork.flat(2).length > 200);
  assert.equal(
    checked.issues.some(({ level }) => level === "error"),
    false,
  );
});

function shapesFromPathData(data) {
  const shapes = [];
  let shape = null;

  for (const command of opentype.Path.fromSVG(data).commands) {
    if (command.type === "M") {
      if (shape !== null && shape.curves.length > 0) shapes.push(shape);
      shape = new THREE.Shape();
      shape.moveTo(command.x, command.y);
    } else if (command.type === "L") {
      shape.lineTo(command.x, command.y);
    } else if (command.type === "C") {
      shape.bezierCurveTo(
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x,
        command.y,
      );
    } else if (command.type === "Q") {
      shape.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
    } else if (command.type === "Z") {
      shape.closePath();
    }
  }

  if (shape !== null && shape.curves.length > 0) shapes.push(shape);
  return shapes;
}
