import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignHistory } from "../src/stamp_generator/static/stamp_generator/js/designHistory.js";
import { DesignEditorController, textResizePreview } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { SharedDesignControls } from "../src/stamp_generator/static/stamp_generator/js/sharedDesignControls.js";
import { createResizeTarget } from "../src/stamp_generator/static/stamp_generator/js/pipelineControls.js";
import { createTextSizeControls, elementDimensionsCm, pointsToMillimetres, millimetresToPoints } from "../src/stamp_generator/static/stamp_generator/js/sizing.js";
import { bounds, transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { ArtworkComposer } from "../src/stamp_generator/static/stamp_generator/js/pipeline/artworkComposition.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { DEFAULT_STAMP, buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { createStampLayout, layoutRenderElements } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { prepareClosedStamp, verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";

await initializeSolids();
const bytes = readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url));
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rectangle = (x0, y0, x1, y1) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]];
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Minimum signed distance to any supporting edge of a convex backing.
// This also tests the chords of round stamps, not only an ideal circle.
function assertClearance(layout, margin) {
  const ring = layout.face[0][0];
  for (let index = 0; index < ring.length; index++) {
    const [x, y] = ring[index];
    const next = ring[(index + 1) % ring.length];
    const dx = next[0] - x;
    const dy = next[1] - y;
    const length = Math.hypot(dx, dy);
    for (const polygon of layout.artwork) {
      for (const [px, py] of polygon[0]) {
        const distance = (dx * (py - y) - dy * (px - x)) / length;
        assert.ok(distance >= margin - 1e-6, `${layout.faceShape} clearance ${distance} < ${margin}`);
      }
    }
  }
}

test("typography points convert exactly at the UI boundary", () => {
  close(pointsToMillimetres(72), 25.4);
  close(pointsToMillimetres(12), 25.4 / 6);
  close(millimetresToPoints(25.4), 72);
  for (const millimetres of [0.5, 7.5, 16.123456, 60]) {
    close(pointsToMillimetres(millimetresToPoints(millimetres)), millimetres);
  }
});

test("Text, SVG and PNG measurements use actual scaled, rotated canonical bounds in cm", () => {
  const shape = rectangle(-10, -5, 10, 5);
  for (const kind of ["text", "svg", "png"]) {
    const element = { kind, canonical: shape };
    const snapshot = structuredClone(element);
    const actual = elementDimensionsCm(shape, {
      xMm: 100, yMm: -30, scale: 2, rotationDeg: 90, mirrorX: true,
    });
    close(actual.width, 2);
    close(actual.height, 4);
    const rotated = elementDimensionsCm(shape, { rotationDeg: 45 });
    close(rotated.width, 3 / Math.sqrt(2));
    close(rotated.height, 3 / Math.sqrt(2));
    assert.deepEqual(element, snapshot);
  }
  assert.equal(elementDimensionsCm([]), null);
  assert.equal(elementDimensionsCm(undefined), null);
  close(elementDimensionsCm(rectangle(0, 0, 30, 20)).width, 3);
});

class Input extends EventTarget {
  value = "";
  ownerDocument = { activeElement: null };
}

test("point field, slider and transient handle preview share one undoable physical Text size", async () => {
  const model = new DesignModel({ elements: [{
    id: "text", kind: "text", source: { text: "A", fontSizeMm: 7.5, thicknessMm: 0.3 },
    transform: { xMm: 7, yMm: -2 },
  }] });
  const editor = new DesignEditorController(model);
  editor.select("text");
  const history = new DesignHistory(model);
  const shared = new SharedDesignControls(model, editor);
  let conversions = 0;
  const composer = new ArtworkComposer(async (element) => {
    conversions++;
    return { canonical: layoutText(font, { text: element.source.text, size: element.source.fontSizeMm }), issues: [] };
  });
  const range = new Input();
  const input = new Input();
  const output = {};
  const controls = createTextSizeControls({
    range, input, output, minMm: 0.5, maxMm: 60,
    onChange: (mm) => {
      shared.updateSelectedTextSize(mm);
      controls.update(mm);
    },
  });
  const initial = model.getElement("text");
  await composer.compose(model.elements);
  controls.update(initial.source.fontSizeMm);
  assert.equal(input.value, "21.26");
  assert.equal(output.textContent, "21.26 pt");
  assert.equal(model.getElement("text"), initial, "displaying an existing design must not migrate its size");
  assert.equal(history.canUndo, false);
  input.value = "24";
  input.dispatchEvent(new Event("input"));
  close(model.getElement("text").source.fontSizeMm, 24 * 25.4 / 72);
  assert.equal(model.getElement("text").transform.scale, 1);
  assert.equal(model.getElement("text").transform.xMm, 7);
  assert.equal(model.getElement("text").transform.yMm, -2);
  close(Number(range.value), 24);
  history.undo();
  assert.equal(model.getElement("text").source.fontSizeMm, 7.5);
  history.redo();
  close(model.getElement("text").source.fontSizeMm, pointsToMillimetres(24));

  await composer.compose(model.elements);
  const beforePreview = model.getElement("text");
  const beforeConversions = conversions;
  const beforeGeometry = await composer.compose(model.elements);
  for (const scale of [1.2, 1.5, 2]) {
    const preview = textResizePreview(beforePreview.source.fontSizeMm, beforePreview.transform, scale);
    controls.update(preview.fontSizeMm);
    close(Number(range.value), millimetresToPoints(preview.fontSizeMm));
    assert.equal(model.getElement("text"), beforePreview);
    const previewDimensions = elementDimensionsCm(beforeGeometry.renderElements[0].canonical, preview.transform);
    assert.ok(previewDimensions.width > 0);
    await composer.compose(model.elements);
    assert.equal(conversions, beforeConversions, "preview must reuse converted glyphs");
  }
  const preview = textResizePreview(beforePreview.source.fontSizeMm, beforePreview.transform, 2);
  editor.setTextSize("text", preview.fontSizeMm);
  await composer.compose(model.elements);
  assert.equal(conversions, beforeConversions + 1);
  assert.equal(editor.selectedId, "text");
  assert.equal(model.getElement("text").source.thicknessMm, 0.3);
  range.value = "36";
  range.dispatchEvent(new Event("input"));
  close(model.getElement("text").source.fontSizeMm, pointsToMillimetres(36));
  assert.equal(input.value, "36");
  assert.equal(output.textContent, "36 pt");
  const stable = model.getElement("text");
  for (const value of ["", "0", "NaN", "200"]) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    assert.equal(model.getElement("text"), stable);
  }
});

test("3D resize drives Text size or image scale without a manual face-size path", () => {
  for (const kind of ["text", "svg", "png"]) {
    const model = new DesignModel({ elements: [{ id: kind, kind, source: kind === "text" ? { fontSizeMm: 7.5 } : {} }] });
    const editor = new DesignEditorController(model);
    const shared = new SharedDesignControls(model, editor);
    const target = createResizeTarget({}, shared);
    editor.select(null);
    assert.equal(target.sizeDriver, null);
    editor.select(kind);
    const value = kind === "text" ? pointsToMillimetres(36) : 1.5;
    close(target.applySize(value), value);
    if (kind === "text") {
      close(model.getElement(kind).source.fontSizeMm, value);
      assert.equal(model.getElement(kind).transform.scale, 1);
    } else {
      assert.equal(model.getElement(kind).transform.scale, value);
    }
  }
});

test("legacy Artwork settings become Square without resizing or moving artwork", async () => {
  const artwork = rectangle(-12, -3, 8, 5);
  const settings = { ...DEFAULT_STAMP, faceShape: "outline", mirror: false, handle: "none" };
  const layout = createStampLayout(artwork, settings);
  assert.deepEqual(layout, createStampLayout(artwork, { ...settings, faceShape: "square" }));
  assert.deepEqual(layout.artwork, artwork);
  assertClearance(layout, 2);
  assert.equal(settings.faceShape, "outline");

  const pipeline = { stamp: {}, schedule() { this.scheduled = true; } };
  Pipeline.prototype.setStamp.call(pipeline, { faceShape: "outline" });
  assert.equal(pipeline.stamp.faceShape, "square");
  assert.equal(pipeline.scheduled, true);
  assert.throws(() => Pipeline.prototype.setStamp.call(pipeline, { faceShape: "triangle" }), /Unsupported stamp shape/);
  assert.equal(pipeline.stamp.faceShape, "square");

  for (const mode of ["emboss", "deboss"]) {
    const built = buildStamp(artwork, { ...settings, mode });
    try {
      assert.deepEqual(built.layout, layout);
      const reloaded = new STLLoader().parse(await verifiedSTL(built.stamp).arrayBuffer());
      try {
        const checked = prepareClosedStamp(reloaded);
        checked.dispose();
      } finally {
        reloaded.dispose();
      }
    } finally {
      built.stamp.dispose();
      built.clay.dispose();
    }
  }
});

test("round automatic sizing measures artwork radius rather than unused bounding-box corners", () => {
  const diamond = [[[[0, 10], [-10, 0], [0, -10], [10, 0]]]];
  const layout = createStampLayout(diamond, { ...DEFAULT_STAMP, mirror: false });
  close(layout.faceSize, 24 / Math.cos(Math.PI / 96));
  assert.ok(layout.faceSize < 25);
  assertClearance(layout, 2);
});

test("both face shapes keep at least 2 mm clearance, including acute and off-centre artwork", () => {
  const shapes = [
    rectangle(-20, -1, 20, 1),
    [[[[0, 0], [40, 0], [0, 2]]]],
    [...rectangle(-22, -5, -12, 5), ...rectangle(15, -3, 25, 4)],
  ];
  for (const faceShape of ["round", "square"]) {
    for (const artwork of shapes) {
      const snapshot = structuredClone(artwork);
      for (const margin of [0, 2, 5]) {
        const layout = createStampLayout(artwork, { ...DEFAULT_STAMP, mirror: false, faceShape, margin, autoFaceSize: false, faceSize: 1 });
        assertClearance(layout, Math.max(2, margin));
        assert.deepEqual(layout.artwork, artwork);
        assert.deepEqual(layout.artworkTransform, { mirrorX: false, scale: 1, xMm: 0, yMm: 0 });
        assert.equal(layout.overflows, false);
        assert.deepEqual(artwork, snapshot);
      }
    }
  }
});

for (const faceShape of ["round", "square"]) {
  for (const mode of ["emboss", "deboss"]) {
    test(`mixed Text/SVG/PNG automatic ${faceShape} ${mode} preserves holes, layout and verified STL`, async () => {
      const ring = rectangle(-4, -3, 4, 3);
      ring[0].push(rectangle(-2, -1, 2, 1)[0][0].reverse());
      const elements = [
        { id: "text", kind: "text", canonical: layoutText(font, { text: "A", size: 16 }), transform: { xMm: -15, yMm: -8, rotationDeg: 20 } },
        { id: "svg", kind: "svg", canonical: ring, transform: { xMm: 10, yMm: 8, scale: 1.2, rotationDeg: 37 } },
        { id: "png", kind: "png", canonical: rectangle(-3, -2, 3, 2), transform: { xMm: 17, yMm: -8, mirrorX: true, rotationDeg: 50 } },
      ];
      const canonical = elements.flatMap((element) => transform(element.canonical, element.transform));
      const snapshot = structuredClone(canonical);
      const built = buildStamp(canonical, { faceShape, mode, margin: 2, handle: "none" });
      try {
        assert.deepEqual(layoutRenderElements(elements, built.layout.artworkTransform).flatMap(({ canonical }) => canonical), built.layout.artwork);
        assert.equal(built.layout.artwork.filter((polygon) => polygon.length === 2).length, 2);
        assertClearance(built.layout, 2);
        assert.deepEqual(canonical, snapshot);
        const reloaded = new STLLoader().parse(await verifiedSTL(built.stamp).arrayBuffer());
        const checked = prepareClosedStamp(reloaded);
        try {
          close(checked.boundingBox.max.x - checked.boundingBox.min.x, built.layout.widthMm, 1e-4);
          close(checked.boundingBox.max.y - checked.boundingBox.min.y, built.layout.heightMm, 1e-4);
          assert.equal(checked.boundingBox.min.z, 0);
        } finally {
          checked.dispose();
          reloaded.dispose();
        }
      } finally {
        built.stamp.dispose();
        built.clay.dispose();
      }
    });
  }
}
