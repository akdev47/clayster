import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import opentype from "opentype.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { buildStamp, DEFAULT_STAMP } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";

// A stamp is its plate and the letters on it. Nothing is attached to the back:
// not in the 3D preview, not on the review page, not in the STL that is ordered.

await initializeSolids();

const root = new URL("../src/stamp_generator/", import.meta.url);
const bytes = readFileSync(new URL("static/stamp_generator/fonts/NotoSans-Bold.ttf", root));
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const artwork = () => validate(layoutText(font, { text: "CLAY", size: 16 })).artwork;

for (const faceShape of ["round", "square", "minimal"]) {
  for (const mode of ["emboss", "deboss"]) {
    test(`a ${faceShape} ${mode} stamp is just the plate and its letters, and one closed solid`, () => {
      const built = buildStamp(artwork(), { faceShape, mode });
      try {
        assert.ok(verifiedSTL(built.stamp).size > 84, "closed and consistently oriented");

        const box = built.stamp.boundingBox;
        const height = box.max.z - box.min.z;
        const plate = DEFAULT_STAMP.faceThickness + (mode === "emboss" ? DEFAULT_STAMP.reliefDepth : 0);
        assert.equal(box.min.z, 0, "the back of the plate is the lowest point");
        assert.ok(Math.abs(height - plate) < 0.01, `${height} mm tall, plate and relief make ${plate} mm`);
        assert.ok(Math.abs(built.info.height - height) < 1e-6, "the summary reports that same height");
      } finally {
        built.stamp.dispose();
        built.clay.dispose();
      }
    });
  }
}

test("nothing in the settings, the pipeline or the pages still speaks of a handle", () => {
  assert.ok(!("handle" in DEFAULT_STAMP));
  assert.ok(!("handle" in new Pipeline().stamp));
  assert.ok(!("handle" in SETTINGS));
  assert.equal(typeof new Pipeline().handleGeometry, "undefined");

  const index = readFileSync(new URL("templates/stamp_generator/index.html", root), "utf8");
  assert.ok(!/handvat|review-handle|handle-select/i.test(index));
  const review = readFileSync(new URL("static/stamp_generator/js/reviewPage.js", root), "utf8");
  assert.ok(!/handle|handvat/i.test(review));
});
