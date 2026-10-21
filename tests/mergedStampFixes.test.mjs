import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignEditorController, constrainToFace, fitsFace } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { ArtworkComposer } from "../src/stamp_generator/static/stamp_generator/js/pipeline/artworkComposition.js";
import { bounds, transform, ringArea } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { initializeSolids, offsetOutline } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { DEFAULT_STAMP } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { createStampLayout } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";

await initializeSolids();

const rectangle = (x0, y0, x1, y1) => [
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
];
const base = { xMm: 0, yMm: 0, scale: 1, rotationDeg: 0 };

test("main drag bounds preserve size and keep square and round elements inside the face", () => {
  const canonical = [rectangle(-2, -1, 2, 1)];
  for (const shape of ["square", "round"]) {
    const limit = { shape, halfExtent: 10 };
    const allowed = constrainToFace(canonical, { ...base, xMm: 50, yMm: -50 }, limit);
    assert.equal(allowed.scale, 1);
    assert.equal(fitsFace(canonical, allowed, limit), true);
    assert.equal(bounds(transform(canonical, allowed)).width, 4);
  }
  assert.equal(constrainToFace(canonical, { ...base, xMm: 50 }, null).xMm, 50);
});

test("shared dragging and typed transform edits use main bounds without changing other elements", () => {
  const model = new DesignModel({ elements: [
    { id: "move", kind: "text", source: { text: "Move" } },
    { id: "still", kind: "svg" },
  ] });
  const editor = new DesignEditorController(model);
  const stationary = model.getElement("still");
  editor.canonicalFor = () => [rectangle(-2, -1, 2, 1)];
  editor.faceLimit = { shape: "square", halfExtent: 10 };
  editor.moveFromScreenDelta("move", model.getElement("move").transform,
    { deltaX: 1000, deltaY: 1000 }, { width: 100, height: 100 },
    { widthMm: 20, heightMm: 20 });
  assert.equal(model.getElement("move").transform.xMm, 8);
  assert.equal(model.getElement("move").transform.yMm, -9);
  model.updateElement("move", { transform: { xMm: -50 } });
  editor.constrainElement("move");
  assert.equal(model.getElement("move").transform.xMm, -8);
  assert.equal(model.getElement("still"), stationary);
});

test("oversized elements are detected by drag bounds without discarding their geometry", () => {
  const canonical = [rectangle(-30, -5, 30, 5)];
  const limit = { shape: "round", halfExtent: 15 };
  assert.equal(constrainToFace(canonical, base, limit), null);
  assert.equal(fitsFace(canonical, base, limit), false);
  assert.equal(fitsFace(canonical, base, null), true);
  const layout = createStampLayout(canonical, {
    ...DEFAULT_STAMP, faceShape: "round", autoFaceSize: false, faceSize: 30, margin: 0,
  });
  assert.equal(layout.overflows, false);
  assert.ok(layout.faceSize > 60);
  assert.equal(layout.artworkTransform.scale, 1);
});

test("moving artwork grows an automatic stamp without changing artwork scale or position", () => {
  const canonical = [rectangle(-5, -2, 5, 2)];
  const settings = {
    ...DEFAULT_STAMP, faceShape: "round", autoFaceSize: false, faceSize: 30, mirror: false,
  };
  for (const yMm of [0, 8, 20]) {
    const moved = transform(canonical, { yMm });
    const layout = createStampLayout(moved, settings);
    assert.deepEqual(layout.artwork, moved);
    assert.equal(layout.artworkTransform.scale, 1);
    const radius = Math.max(...moved[0][0].map(([x, y]) => Math.hypot(x, y)));
    assert.ok(layout.faceSize / 2 - radius >= 2);
    assert.equal(layout.overflows, false);
  }
});

test("main outline thickness grows and shrinks strokes while preserving holes and winding", () => {
  const ring = [[
    [[-5, -5], [5, -5], [5, 5], [-5, 5]],
    [[-2, -2], [-2, 2], [2, 2], [2, -2]],
  ]];
  for (const [delta, width] of [[0.5, 11], [-0.5, 9]]) {
    const offset = offsetOutline(ring, delta);
    assert.ok(Math.abs(bounds(offset).width - width) < 1e-3);
    assert.equal(offset.length, 1);
    assert.equal(offset[0].length, 2);
    assert.ok(ringArea(offset[0][0]) > 0);
    assert.ok(ringArea(offset[0][1]) < 0);
  }
  assert.equal(offsetOutline(ring, 0), ring);
});

test("thickness preserves additive fill when glyph outlines overlap", () => {
  const overlapping = [rectangle(0, 0, 10, 10), rectangle(5, 0, 15, 10)];
  const grown = offsetOutline(overlapping, 0.1);
  assert.equal(grown.length, 1);
  const area = grown.reduce((sum, polygon) =>
    sum + polygon.reduce((subtotal, ring) => subtotal + ringArea(ring), 0), 0);
  assert.ok(area > 150, "overlapping letters must grow as a filled union");
});

test("text thickness is finite saved intent and invalidates only its conversion cache", async () => {
  const model = new DesignModel({ elements: [
    { id: "text", kind: "text", source: { text: "CLAY" } },
    { id: "svg", kind: "svg", source: { reference: "mark.svg" }, transform: { xMm: 20 } },
  ] });
  const calls = { text: 0, svg: 0 };
  const originalFont = model.getElement("text").source.font;
  const composer = new ArtworkComposer(async (element) => {
    calls[element.kind] += 1;
    return { canonical: [rectangle(0, 0, 10, 10)], issues: [] };
  });
  assert.equal(model.getElement("text").source.thicknessMm, 0);
  await composer.compose(model.elements);
  model.updateElement("text", { source: { thicknessMm: 0.4 } });
  await composer.compose(model.elements);
  model.updateElement("text", { transform: { xMm: 3 } });
  await composer.compose(model.elements);
  assert.deepEqual(calls, { text: 2, svg: 1 });
  assert.equal(model.getElement("text").source.font.id, originalFont.id);
  assert.throws(() => model.updateElement("text", { source: { thicknessMm: NaN } }), /finite number/);
});
