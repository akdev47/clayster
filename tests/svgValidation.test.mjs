import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  getFilledSVGShapes,
  getUnsupportedSVGFeatures,
} from "../src/svgValidation.js";

const filledPath = (points, style = {}) => {
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
      strokeOpacity: 1,
      strokeWidth: 1,
      ...style,
    },
  };
  return path;
};

const documentWith = (...selectors) => ({
  querySelector: (selector) =>
    selectors.some((candidate) =>
      selector.split(",").some((part) => part.trim() === candidate),
    )
      ? {}
      : null,
});

test("SVG text reports path-conversion guidance", () => {
  assert.deepEqual(
    getUnsupportedSVGFeatures(documentWith("text", "mask")),
    [
      "Unsupported SVG text element. Convert text to paths before uploading.",
      "Unsupported SVG mask. Apply the mask to the paths before uploading.",
    ],
  );
});

test("stroke-only artwork reports filled-outline guidance", () => {
  const stroke = filledPath(
    [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    { fill: "none", stroke: "#000000" },
  );

  assert.throws(
    () => getFilledSVGShapes({ paths: [stroke] }),
    /Unsupported stroke-only artwork\. Convert strokes to filled outlines/i,
  );
});

test("embedded SVG images report raster artwork as unsupported", () => {
  assert.deepEqual(getUnsupportedSVGFeatures(documentWith("image")), [
    "Embedded raster images are not supported inside SVG files.",
  ]);
});

test("SVGs without filled shapes fail with the specific reason", () => {
  const unfilled = filledPath(
    [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    { fill: "none" },
  );

  assert.throws(
    () => getFilledSVGShapes({ paths: [unfilled] }),
    (error) => {
      assert.match(error.message, /SVG contains no usable filled outlines/i);
      assert.equal(error.svgStage, "SVG shape conversion");
      return true;
    },
  );
});

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

test("successful filled SVG contours still become shapes", () => {
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
