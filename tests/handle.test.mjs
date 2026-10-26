import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import opentype from "opentype.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import {
  buildStamp,
  DEFAULT_STAMP,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import {
  createSmallHandle,
  fitHandleToFace,
  HANDLE,
  HANDLE_MAX_FACE_SHARE,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/handle.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";

await initializeSolids();

const root = new URL("../src/stamp_generator/", import.meta.url);
const bytes = readFileSync(
  new URL("static/stamp_generator/fonts/NotoSans-Bold.ttf", root),
);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const artwork = (text = "CLAY", size = 16) =>
  validate(layoutText(font, { text, size })).artwork;
const sizeOf = (geometry) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3());
};
const dispose = (built) => {
  built.stamp.dispose();
  built.clay.dispose();
};

test("the handle is a long closed rectangular bar, big enough to hold", () => {
  const handle = createSmallHandle();
  const size = sizeOf(handle);
  assert.ok(Math.abs(size.x - HANDLE.widthMm) < 1e-6);
  assert.ok(Math.abs(size.y - HANDLE.depthMm) < 1e-6);
  assert.ok(Math.abs(size.z - HANDLE.heightMm) < 1e-6);
  assert.ok(size.x >= 40, "long enough to hold");
  assert.ok(size.y >= 12 && size.z >= 10, "thicker and taller than a fingertip");
  assert.ok(size.x > size.y * 2, "a long rectangle, not a square block");
  assert.equal(handle.getAttribute("position").count / 3, 12, "a plain rectangular bar");
  assert.ok(verifiedSTL(handle).size > 84, "closed, consistently oriented");
  handle.dispose();
});

test("the DEFAULT_STAMP and a new pipeline start with the small handle", async () => {
  assert.equal(DEFAULT_STAMP.handle, "small");
  const pipeline = new Pipeline();
  assert.equal(pipeline.stamp.handle, "small");

  const geometry = await pipeline.handleGeometry();
  assert.ok(geometry.getAttribute("position").count > 0);
  assert.equal(await pipeline.handleGeometry(), geometry, "built once, then shared");

  pipeline.stamp.handle = "none";
  assert.equal(await pipeline.handleGeometry(), null);
});

for (const faceShape of ["round", "square"]) {
  for (const mode of ["emboss", "deboss"]) {
    test(`a ${faceShape} ${mode} stamp with the handle exports as one closed solid`, () => {
      const handle = createSmallHandle();
      const without = buildStamp(artwork(), { faceShape, mode });
      const built = buildStamp(artwork(), { faceShape, mode }, handle);
      try {
        assert.ok(verifiedSTL(built.stamp).size > 84);

        const before = sizeOf(without.stamp);
        const after = sizeOf(built.stamp);
        // The handle hangs under the plate: taller, but not wider or deeper.
        assert.ok(Math.abs(after.x - before.x) < 1e-6);
        assert.ok(Math.abs(after.y - before.y) < 1e-6);
        // Full height, unless the face is so small that the handle was shrunk.
        const { widthMm, heightMm } = built.layout;
        const scale = Math.min(
          1,
          (HANDLE_MAX_FACE_SHARE * Math.min(widthMm, heightMm)) / HANDLE.widthMm,
        );
        assert.ok(Math.abs(after.z - before.z - HANDLE.heightMm * scale) < 0.05);
        assert.equal(built.stamp.boundingBox.min.z, 0, "stands on its handle");
      } finally {
        dispose(built);
        dispose(without);
        handle.dispose();
      }
    });
  }
}

test("a small face gets a proportionally smaller handle, and the full handle stays full size", () => {
  const handle = createSmallHandle();
  const settings = { faceShape: "round", autoFaceSize: false, faceSize: 10, margin: 3 };
  // Small artwork derives a small backing, so its handle must shrink with it.
  const without = buildStamp(artwork("A", 3), settings);
  const built = buildStamp(artwork("A", 3), settings, handle);
  try {
    verifiedSTL(built.stamp);
    const room = HANDLE_MAX_FACE_SHARE * Math.min(built.layout.widthMm, built.layout.heightMm);
    const scale = room / HANDLE.widthMm; // The long side decides.
    assert.ok(scale < 1);
    const grown = sizeOf(built.stamp).z - sizeOf(without.stamp).z;
    assert.ok(Math.abs(grown - HANDLE.heightMm * scale) < 0.05, `grew by ${grown}`);
    assert.ok(Math.abs(sizeOf(handle).x - HANDLE.widthMm) < 1e-6, "shared copy untouched");
  } finally {
    dispose(built);
    dispose(without);
    handle.dispose();
  }
});

test("fitHandleToFace never enlarges the handle", () => {
  const handle = fitHandleToFace(createSmallHandle(), 500, 500);
  assert.ok(Math.abs(sizeOf(handle).x - HANDLE.widthMm) < 1e-6);
  const small = fitHandleToFace(createSmallHandle(), 12, 40);
  assert.ok(sizeOf(small).x <= HANDLE_MAX_FACE_SHARE * 12 + 1e-6, "uses the shorter side");
});

test("the page offers no handle choice: every stamp gets the small handle", () => {
  const html = readFileSync(new URL("templates/stamp_generator/index.html", root), "utf8");
  assert.ok(!html.includes("pipeline-handle-select"), "no handle dropdown");
  assert.ok(!/<select[^>]*handle/i.test(html));
  assert.ok(!/No handle/i.test(html));
  assert.ok(!/sample handle/i.test(html));
  assert.equal(DEFAULT_STAMP.handle, "small");
});
