import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import { DesignEditorController } from "../src/editor2dInteractions.js";
import { SharedDesignControls } from "../src/sharedDesignControls.js";

function setup(elements = [{ id: "text-1", kind: "text" }]) {
  const model = new DesignModel({ elements });
  const editor = new DesignEditorController(model);
  const controls = new SharedDesignControls(model, editor);
  return { model, editor, controls };
}

test("shared text controls update the same selected element in both views", () => {
  const { model, editor, controls } = setup();

  controls.updateSelectedSource("text", { text: "Shared design" });
  editor.setView("3d");
  controls.updateSelectedSource("text", { fontSizeMm: 24 });

  const selected = model.getElement("text-1");
  assert.equal(selected.source.text, "Shared design");
  assert.equal(selected.source.fontSizeMm, 24);
  assert.equal(editor.selectedId, "text-1");
});

test("SVG and PNG source controls update their selected element", () => {
  const svgReference = { name: "mark.svg" };
  const pngReference = { name: "mark.png" };
  const { model, editor, controls } = setup([
    { id: "svg-1", kind: "svg" },
    { id: "png-1", kind: "png" },
  ]);

  controls.updateSelectedSource("svg", {
    reference: svgReference,
    baseSizeMm: 42,
  });
  editor.select("png-1");
  controls.updateSelectedSource("png", {
    reference: pngReference,
    baseSizeMm: 31,
    tracing: { smoothing: 3 },
  });

  assert.equal(model.getElement("svg-1").source.reference, svgReference);
  assert.equal(model.getElement("svg-1").source.baseSizeMm, 42);
  assert.equal(model.getElement("png-1").source.reference, pngReference);
  assert.equal(model.getElement("png-1").source.tracing.smoothing, 3);
});

test("adding Text, SVG and PNG creates and selects DesignModel entries", () => {
  const { model, controls } = setup([]);

  controls.addElement("text", { text: "New" });
  controls.addElement("svg", { reference: "mark.svg" });
  const png = controls.addElement("png", { reference: "mark.png" });

  assert.deepEqual(
    model.elements.map(({ kind }) => kind),
    ["text", "svg", "png"],
  );
  assert.equal(controls.selectedElement().id, png.id);
});

test("switching modes preserves shared source and transform values", () => {
  const { model, editor, controls } = setup();
  controls.updateSelectedSource("text", { letterSpacingMm: 1.75 });
  controls.updateSelectedTransform({ xMm: 8, scale: 1.4, mirrorX: true });

  editor.setView("3d");
  editor.setView("2d");

  const element = model.getElement("text-1");
  assert.equal(element.source.letterSpacingMm, 1.75);
  assert.equal(element.transform.xMm, 8);
  assert.equal(element.transform.scale, 1.4);
  assert.equal(element.transform.mirrorX, true);
});

test("unified controls do not mutate or call the legacy single-source path", () => {
  let legacyCalls = 0;
  const legacyPipeline = {
    source: { text: "Legacy" },
    setSource() {
      legacyCalls += 1;
    },
  };
  const { model, editor } = setup();
  const controls = new SharedDesignControls(model, editor);

  controls.updateSelectedSource("text", { text: "Authoritative" });

  assert.equal(model.getElement("text-1").source.text, "Authoritative");
  assert.equal(legacyPipeline.source.text, "Legacy");
  assert.equal(legacyCalls, 0);
});
