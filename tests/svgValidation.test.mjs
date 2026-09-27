import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { getFilledSVGShapes } from "../src/svgValidation.js";

const filledPath = (points) => {
  const path = new THREE.ShapePath();
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  path.currentPath.closePath();
  path.userData = {
    style: {
      fill: "#000000",
      fillOpacity: 1,
      opacity: 1,
      stroke: "none",
    },
  };
  return path;
};

test("self-intersecting zero-area SVG contours fail clearly", () => {
  const bowTie = filledPath([
    [0, 0],
    [10, 10],
    [0, 10],
    [10, 0],
  ]);

  assert.throws(
    () => getFilledSVGShapes({ paths: [bowTie] }),
    /self-intersecting or zero-area filled outline/i,
  );
});

test("valid SVG contours still become shapes", () => {
  const rectangle = filledPath([
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ]);

  const shapes = getFilledSVGShapes({ paths: [rectangle] });
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].holes.length, 0);
});
