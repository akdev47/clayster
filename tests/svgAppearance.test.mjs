import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  getFilledSVGShapes,
  getSVGViewportTransform,
} from "../src/stamp_generator/static/stamp_generator/js/svgValidation.js";
import { applySVGViewport, scaleToSize } from "../src/stamp_generator/static/stamp_generator/js/pipeline/svg.js";

const root = (attributes) => ({
  getAttribute: (name) => attributes[name] ?? null,
});

const node = (attributes = {}, parentElement = null) => ({
  getAttribute: (name) => attributes[name] ?? null,
  parentElement,
  style: {},
});

const filledPath = (points, { style = {}, element = node() } = {}) => {
  const path = new THREE.ShapePath();
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  path.currentPath.closePath();
  path.userData = {
    node: element,
    style: {
      fill: "#000000",
      fillOpacity: 1,
      opacity: 1,
      stroke: "none",
      ...style,
    },
  };
  return path;
};

const rectangle = (width, height, offsetX = 0, offsetY = 0) => [
  [
    [offsetX, offsetY],
    [offsetX + width, offsetY],
    [offsetX + width, offsetY + height],
    [offsetX, offsetY + height],
  ],
];

test("scaled viewBox artwork normalizes to equivalent canonical geometry", () => {
  const direct = scaleToSize([rectangle(100, 50)], 30);
  const viewport = getSVGViewportTransform(
    root({
      viewBox: "0 0 10 10",
      width: "100",
      height: "50",
      preserveAspectRatio: "none",
    }),
  );
  const mapped = scaleToSize(
    applySVGViewport([rectangle(10, 10)], viewport),
    30,
  );

  assert.deepEqual(mapped, direct);
});

test("display none artwork and its descendants are ignored", () => {
  const hiddenGroup = node({ display: "none" });
  const hidden = filledPath(
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    { element: node({}, hiddenGroup) },
  );
  const visible = filledPath([
    [10, 0],
    [14, 0],
    [14, 4],
    [10, 4],
  ]);

  assert.equal(getFilledSVGShapes({ paths: [hidden, visible] }).length, 1);
});

test("visibility hidden artwork is ignored", () => {
  const hidden = filledPath(
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    { style: { visibility: "hidden" } },
  );
  const visible = filledPath([
    [10, 0],
    [14, 0],
    [14, 4],
    [10, 4],
  ]);

  assert.equal(getFilledSVGShapes({ paths: [hidden, visible] }).length, 1);
});

test("visible artwork remains unchanged", () => {
  const visible = filledPath([
    [2, 3],
    [8, 3],
    [8, 7],
    [2, 7],
  ]);

  const [shape] = getFilledSVGShapes({ paths: [visible] });
  assert.deepEqual(
    shape.getPoints().map(({ x, y }) => [x, y]),
    [
      [2, 3],
      [8, 3],
      [8, 7],
      [2, 7],
      [2, 3],
    ],
  );
});

test("viewBox mapping composes after existing nested transforms", () => {
  // These coordinates represent a 2× nested group scale and a translation
  // already baked into the path by SVGLoader.
  const transformed = [rectangle(20, 10, 10, -15)];
  const viewport = getSVGViewportTransform(
    root({ viewBox: "0 0 100 50", width: "200", height: "100" }),
  );

  assert.deepEqual(applySVGViewport(transformed, viewport), [
    rectangle(40, 20, 20, -30),
  ]);
});
