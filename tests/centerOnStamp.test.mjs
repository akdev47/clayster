import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignHistory } from "../src/stamp_generator/static/stamp_generator/js/designHistory.js";
import { DesignEditorController } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { bounds, transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import { createStampLayout, layoutRenderElements } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { readableStampDisplay } from "../src/stamp_generator/static/stamp_generator/js/stamp2dDisplay.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { prepareClosedStamp, verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";

await initializeSolids();
const rectangle = (x0, y0, x1, y1) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]];
// Off-origin, asymmetric artwork: rotating just its source bounding box would
// produce a different centre from rotating the actual filled vertices.
const artwork = [[[[1, 2], [11, 2], [4, 8]]]];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const centre = (canonical) => {
  const box = bounds(canonical);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
};
const sources = {
  text: { text: "AM", fontSizeMm: 7.5, letterSpacingRatio: 0.2, lineSpacing: 1.5, thicknessMm: 0.3, alignment: "right" },
  svg: { reference: new File(["svg source"], "mark.svg"), baseSizeMm: 30 },
  png: { reference: new File(["png source"], "mark.png"), baseSizeMm: 25, tracing: { smoothing: 1 } },
};

for (const kind of ["text", "svg", "png"]) {
  test(`${kind} centering uses actual rotated/scaled/mirrored artwork and changes only position`, () => {
    for (const rotationDeg of [0, 37, 90, 211]) {
      const model = new DesignModel({ elements: [
        { id: "selected", kind, source: sources[kind], transform: {
          xMm: 27, yMm: -16, scale: 1.7, rotationDeg,
          mirrorX: true, mirrorY: true, pivotX: 3, pivotY: -2,
        } },
        { id: "other", kind: "svg", transform: { xMm: 40 } },
      ] });
      const editor = new DesignEditorController(model);
      editor.canonicalFor = () => artwork;
      const history = new DesignHistory(model);
      const original = model.getElement("selected");
      const other = model.getElement("other");
      const originalBounds = bounds(transform(artwork, original.transform));
      const face = rectangle(-3, -12, 17, 4); // centre (7, -4), not origin
      let changes = 0;
      model.addEventListener("change", () => changes++);

      const centered = editor.centerSelectedOnStamp(face);
      const moved = transform(artwork, centered.transform);
      const movedBounds = bounds(moved);
      close(centre(moved).x, 7);
      close(centre(moved).y, -4);
      close(movedBounds.width, originalBounds.width);
      close(movedBounds.height, originalBounds.height);
      assert.deepEqual({ ...centered, transform: original.transform }, original);
      assert.deepEqual({ ...centered.transform, xMm: original.transform.xMm, yMm: original.transform.yMm }, original.transform);
      assert.equal(model.getElement("other"), other);
      assert.equal(editor.selectedId, "selected");
      assert.equal(changes, 1);
      assert.equal(editor.centerSelectedOnStamp(face), centered);
      assert.equal(changes, 1, "centering an already centred element is a no-op");
      assert.equal(history.undo(), true);
      assert.deepEqual(model.getElement("selected"), original);
      assert.equal(history.canUndo, false);
      assert.equal(history.redo(), true);
      assert.deepEqual(model.getElement("selected"), centered);
      assert.equal(editor.selectedId, "selected");
    }
  });
}

test("centering waits for a selection, canonical geometry and a stamp face", () => {
  const model = new DesignModel({ elements: [{ id: "text", kind: "text" }] });
  const editor = new DesignEditorController(model);
  const original = model.getElement("text");
  assert.equal(editor.centerSelectedOnStamp(rectangle(-10, -10, 10, 10)), null);
  editor.canonicalFor = () => [];
  assert.equal(editor.centerSelectedOnStamp(rectangle(-10, -10, 10, 10)), null);
  editor.canonicalFor = () => artwork;
  assert.equal(editor.centerSelectedOnStamp([]), null);
  editor.select(null);
  assert.equal(editor.centerSelectedOnStamp(rectangle(-10, -10, 10, 10)), null);
  assert.equal(model.getElement("text"), original);
});

for (const faceShape of ["round", "square"]) {
  test(`centering on the current ${faceShape} backing reuses conversion and synchronizes shared layout/STL`, async () => {
    for (const kind of ["text", "svg", "png"]) {
      const model = new DesignModel({ elements: [
        { id: "selected", kind, source: sources[kind], transform: { xMm: 17, yMm: -12, scale: 1.2, rotationDeg: 37 } },
        { id: "other", kind: "svg", transform: { xMm: -16, yMm: 9 } },
      ] });
      const editor = new DesignEditorController(model);
      const pipeline = new Pipeline({ designModel: model });
      pipeline.stamp = { ...pipeline.stamp, faceShape, handle: "none", margin: 2, mirror: true };
      const calls = { selected: 0, other: 0 };
      pipeline.buildElementArtwork = async (element) => {
        calls[element.id]++;
        return { canonical: element.id === "selected" ? artwork : rectangle(-3, -2, 3, 2), issues: [] };
      };
      const dispose = () => { pipeline.result?.stamp?.dispose(); pipeline.result?.clay?.dispose(); };
      try {
        await pipeline.run();
        assert.equal(pipeline.error, null);
        const before = pipeline.result;
        const canonical = before.renderElements.find(({ id }) => id === "selected").canonical;
        editor.canonicalFor = () => canonical;
        const readable = readableStampDisplay(before.layout);
        const target = centre(readable.face);
        const stationary = model.getElement("other");
        const changed = editor.centerSelectedOnStamp(readable.face);
        const changedGeometry = transform(canonical, changed.transform);
        close(centre(changedGeometry).x, target.x);
        close(centre(changedGeometry).y, target.y);
        assert.equal(model.getElement("other"), stationary);
        dispose();
        await pipeline.run();
        assert.equal(pipeline.error, null);
        assert.deepEqual(calls, { selected: 1, other: 1 });
        const after = pipeline.result;
        assert.equal(after.renderElements.find(({ id }) => id === "selected").canonical, canonical);
        const displayed = layoutRenderElements(after.renderElements, after.layout.artworkTransform);
        const expected = createStampLayout(after.artwork, pipeline.stamp);
        assert.deepEqual(after.layout, expected);
        assert.equal(after.layout.artworkTransform.scale, 1);
        assert.equal(after.layout.overflows, false);
        const shown = readableStampDisplay(after.layout, displayed).elements.find(({ id }) => id === "selected");
        close(centre(shown.canonical).x, target.x);
        close(centre(shown.canonical).y, target.y);
        const reloaded = new STLLoader().parse(await verifiedSTL(after.stamp).arrayBuffer());
        const checked = prepareClosedStamp(reloaded);
        checked.dispose();
        reloaded.dispose();
      } finally {
        clearTimeout(pipeline.timer);
        dispose();
      }
    }
  });
}

test("Center on Stamp is a shared, labelled button inside the collapsible transform panel", () => {
  const root = new URL("../src/stamp_generator/", import.meta.url);
  const html = readFileSync(new URL("templates/stamp_generator/index.html", root), "utf8");
  const main = readFileSync(new URL("static/stamp_generator/js/main.js", root), "utf8");
  assert.match(html, /id="transform-controls-content" hidden>[\s\S]*?<button id="center-element" type="button" class="btn subtle-button w-100 mt-3" disabled>\s*Center on Stamp\s*<\/button>/);
  assert.match(main, /#center-element"\)\.disabled = pipeline\.busy \|\| dimensions === null/);
  assert.match(main, /editor\.centerSelectedOnStamp\(lastScene\.face\)/);
});
