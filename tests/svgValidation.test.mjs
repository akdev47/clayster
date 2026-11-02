import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  getFilledSVGShapes,
  getUnsupportedSVGFeatures,
} from "../src/stamp_generator/static/stamp_generator/js/svgValidation.js";

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
  assert.deepEqual(getUnsupportedSVGFeatures(documentWith("text", "mask")), [
    "Niet-ondersteund SVG-tekstelement. Zet tekst om naar paden voordat je uploadt.",
    "Niet-ondersteund SVG-masker. Pas het masker toe op de paden voordat je uploadt.",
  ]);
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
    /Niet-ondersteund ontwerp met alleen lijnen\. Zet lijnen om naar gevulde omtrekken/i,
  );
});

test("embedded SVG images report raster artwork as unsupported", () => {
  assert.deepEqual(getUnsupportedSVGFeatures(documentWith("image")), [
    "Ingesloten rasterafbeeldingen worden niet ondersteund in SVG-bestanden.",
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
      assert.match(error.message, /De SVG bevat geen bruikbare gevulde omtrekken/i);
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
    /zichzelf snijdende of oppervlakteloze gevulde omtrek/i,
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
