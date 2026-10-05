import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import * as THREE from "three";
import { bounds, transform } from "../src/pipeline/canonical.js";
import { layoutText } from "../src/pipeline/text.js";
import { DEFAULT_STAMP, buildStamp } from "../src/pipeline/stamp.js";
import {
  createStampLayout,
  layoutRenderElements,
} from "../src/pipeline/stampLayout.js";
import { canonicalSvgScene } from "../src/canonicalSvgRenderer.js";
import { initializeSolids } from "../src/solidGeometry.js";

await initializeSolids();

const bytes = readFileSync(
  new URL("../fonts/NotoSans-Bold.ttf", import.meta.url),
);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const rectangle = (minX, minY, maxX, maxY) => [[[
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
]]];
const settings = (patch = {}) => ({
  ...DEFAULT_STAMP,
  mirror: false,
  handle: "none",
  ...patch,
});

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}.`,
  );
}

function matchingTextLayout(text, alignment) {
  const canonical = layoutText(font, {
    text,
    size: 16,
    lineSpacing: 1.25,
    align: alignment,
  });
  const element = {
    id: "text-1",
    kind: "text",
    canonical,
    transform: {},
  };
  const layout = createStampLayout(
    canonical,
    settings({ faceShape: "square" }),
  );
  const displayed = layoutRenderElements(
    [element],
    layout.artworkTransform,
  );

  assert.deepEqual(displayed[0].canonical, layout.artwork);
  return { canonical, layout, displayed };
}

test("rectangular face outline and 3D square face match", () => {
  const built = buildStamp(
    rectangle(-8, -4, 8, 4),
    settings({ faceShape: "square", autoFaceSize: false, faceSize: 40 }),
  );

  try {
    const scene = canonicalSvgScene(
      [{ id: "design", kind: "design", canonical: built.layout.artwork }],
      built.layout,
      { face: built.layout.face },
    );
    built.stamp.computeBoundingBox();
    const meshSize = built.stamp.boundingBox.getSize(new THREE.Vector3());

    assert.equal(scene.viewBox, "-20 -20 40 40");
    assert.equal(scene.facePaths[0].d, "M -20 20 L 20 20 L 20 -20 L -20 -20 Z");
    assertClose(meshSize.x, 40);
    assertClose(meshSize.y, 40);
  } finally {
    built.stamp.dispose();
    built.clay.dispose();
  }
});

test("automatic 2D and 3D face dimensions share millimetre authority", () => {
  const layout = createStampLayout(
    rectangle(5, -3, 15, 3),
    settings({ faceShape: "square", autoFaceSize: true, margin: 3 }),
  );

  assert.equal(layout.faceSize, 36);
  assert.equal(layout.widthMm, 36);
  assert.equal(layout.heightMm, 36);
  assert.equal(canonicalSvgScene([], layout, { face: layout.face }).viewBox, "-18 -18 36 36");
});

test("centered text uses the same final layout in 2D and 3D", () => {
  matchingTextLayout("CLAY", "center");
});

test("left-aligned text uses the same anchor in 2D and 3D", () => {
  const { canonical } = matchingTextLayout("CLAY", "left");
  assert.ok(bounds(canonical).minX >= 0);
});

test("right-aligned text uses the same anchor in 2D and 3D", () => {
  const { canonical } = matchingTextLayout("CLAY", "right");
  const box = bounds(canonical);
  assert.ok((box.minX + box.maxX) / 2 < 0);
});

test("translated element retains the same physical position in both views", () => {
  const local = rectangle(-2, -1, 2, 1);
  const element = {
    id: "svg-1",
    kind: "svg",
    canonical: local,
    transform: { xMm: 8, yMm: -5 },
  };
  const composed = transform(local, element.transform);
  const layout = createStampLayout(
    composed,
    settings({ faceShape: "square", autoFaceSize: false, faceSize: 40 }),
  );
  const displayed = layoutRenderElements([element], layout.artworkTransform);
  const box = bounds(displayed[0].canonical);

  assert.deepEqual(displayed[0].canonical, layout.artwork);
  assert.equal((box.minX + box.maxX) / 2, 8);
  assert.equal((box.minY + box.maxY) / 2, -5);
});

test("multiline text preserves the same relative layout in both views", () => {
  const { canonical, layout } = matchingTextLayout("CLAY\nSTUDIO", "right");

  assert.ok(bounds(canonical).height > 16);
  assert.equal(layout.artwork.length, canonical.length);
});

test("overflowing artwork neither rescales nor grows the fixed face", () => {
  const local = rectangle(-10, -2, 10, 2);
  const element = {
    id: "png-1",
    kind: "png",
    canonical: local,
    transform: { xMm: 5, yMm: 0 },
  };
  const composed = transform(local, element.transform);
  const layout = createStampLayout(
    composed,
    settings({
      faceShape: "square",
      autoFaceSize: false,
      faceSize: 20,
      margin: 2,
    }),
  );
  const displayed = layoutRenderElements([element], layout.artworkTransform);

  assert.equal(layout.artworkTransform.scale, 1);
  assert.deepEqual(displayed[0].canonical, layout.artwork);
  assert.deepEqual(bounds(displayed[0].canonical), bounds(composed));
  assert.equal(layout.faceSize, 20);
});

test("dragging and resizing keep an element inside the face", async () => {
  const { constrainToFace } = await import(
    "../src/editor2dInteractions.js"
  );
  const box = rectangle(-2, -1, 2, 1);
  const base = { xMm: 0, yMm: 0, scale: 1, rotationDeg: 0 };

  const square = { shape: "square", halfExtent: 10 };
  const movedSquare = constrainToFace(box, { ...base, xMm: 50, yMm: -50 }, square);
  assert.equal(bounds(transform(box, movedSquare)).maxX, 10);
  assert.equal(bounds(transform(box, movedSquare)).minY, -10);

  const round = { shape: "round", halfExtent: 10 };
  const movedRound = constrainToFace(box, { ...base, xMm: 50 }, round);
  const corner = bounds(transform(box, movedRound));
  assert.ok(Math.hypot(corner.maxX, corner.maxY) <= 10 + 1e-4);

  assert.equal(constrainToFace(box, { ...base, xMm: 50 }, null).xMm, 50);
});

test("elements too large for the face stay free and are reported", async () => {
  const { constrainToFace, fitsFace } = await import(
    "../src/editor2dInteractions.js"
  );
  const big = rectangle(-30, -5, 30, 5);
  const t = { xMm: 3, yMm: 0, scale: 1, rotationDeg: 0 };
  const limit = { shape: "round", halfExtent: 15 };

  assert.equal(constrainToFace(big, t, limit), null);
  assert.equal(fitsFace(big, t, limit), false);
  assert.equal(fitsFace(big, t, null), true);

  const layout = createStampLayout(
    big,
    settings({ faceShape: "round", autoFaceSize: false, faceSize: 30, margin: 0 }),
  );
  assert.equal(layout.overflows, true);
});

test("offsetOutline thickens and thins strokes while keeping holes", async () => {
  const { offsetOutline } = await import("../src/solidGeometry.js");
  // A 10 x 10 square with a 4 x 4 hole: a ring 3 mm wide.
  const ring = [[
    [[-5, -5], [5, -5], [5, 5], [-5, 5]],
    [[-2, -2], [-2, 2], [2, 2], [2, -2]],
  ]];
  const width = (shape) => bounds(shape).width;

  const thicker = offsetOutline(ring, 0.5);
  assert.ok(Math.abs(width(thicker) - 11) < 1e-3);
  assert.equal(thicker.length, 1);
  assert.equal(thicker[0].length, 2);

  const thinner = offsetOutline(ring, -0.5);
  assert.ok(Math.abs(width(thinner) - 9) < 1e-3);
  assert.equal(thinner[0].length, 2);

  assert.equal(offsetOutline(ring, 0), ring);
});
