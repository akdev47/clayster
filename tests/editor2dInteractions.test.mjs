import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import { ArtworkComposer } from "../src/pipeline/artworkComposition.js";
import { bounds } from "../src/pipeline/canonical.js";
import {
  DesignEditorController,
  canonicalOverlayBox,
  screenDeltaToMillimetres,
} from "../src/editor2dInteractions.js";

const square = [
  [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
];

const textElement = (transform = {}) => ({
  id: "text-1",
  kind: "text",
  source: { text: "CLAY" },
  transform,
});

test("dragging updates the authoritative xMm and yMm", () => {
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);
  const start = model.getElement("text-1").transform;

  editor.moveFromScreenDelta(
    "text-1",
    start,
    { deltaX: 100, deltaY: 50 },
    { width: 400, height: 200 },
    { widthMm: 80, heightMm: 40 },
  );

  assert.equal(model.getElement("text-1").transform.xMm, 20);
  assert.equal(model.getElement("text-1").transform.yMm, -10);
});

test("screen movement converts downward pixels to negative canonical Y", () => {
  assert.deepEqual(
    screenDeltaToMillimetres(
      { deltaX: -25, deltaY: 30 },
      { width: 100, height: 60 },
      { widthMm: 40, heightMm: 30 },
    ),
    { xMm: -10, yMm: -15 },
  );
});

test("resizing updates one uniform scale and preserves selection centre", () => {
  const model = new DesignModel({ elements: [textElement({ xMm: 7, yMm: -2 })] });
  const editor = new DesignEditorController(model);
  const start = model.getElement("text-1").transform;
  const before = canonicalOverlayBox([square], start, {
    widthMm: 60,
    heightMm: 40,
  });

  editor.resize("text-1", [square], start, 2);
  const changed = model.getElement("text-1").transform;
  const after = canonicalOverlayBox([square], changed, {
    widthMm: 60,
    heightMm: 40,
  });

  assert.equal(changed.scale, 2);
  assert.equal(changed.xMm, 5);
  assert.equal(changed.yMm, -4);
  assert.equal(before.leftPercent + before.widthPercent / 2, after.leftPercent + after.widthPercent / 2);
  assert.equal(before.topPercent + before.heightPercent / 2, after.topPercent + after.heightPercent / 2);
});

test("deletion removes the selected shared element", () => {
  const model = new DesignModel({
    elements: [textElement(), { id: "svg-1", kind: "svg" }],
  });
  const editor = new DesignEditorController(model);

  const removed = editor.deleteSelected();

  assert.equal(removed.id, "text-1");
  assert.equal(model.getElement("text-1"), null);
  assert.equal(editor.selectedId, "svg-1");
});

test("text editing updates the selected text source", () => {
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);

  editor.updateSelectedText({
    text: "UPDATED",
    fontSizeMm: 22,
    letterSpacingMm: 1.5,
    alignment: "right",
  });

  const source = model.getElement("text-1").source;
  assert.equal(source.text, "UPDATED");
  assert.equal(source.fontSizeMm, 22);
  assert.equal(source.letterSpacingMm, 1.5);
  assert.equal(source.alignment, "right");
});

test("transform-only edits reuse the element conversion cache", async () => {
  let conversions = 0;
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: [square], issues: [] };
  });

  await composer.compose(model.elements);
  editor.moveFromScreenDelta(
    "text-1",
    model.getElement("text-1").transform,
    { deltaX: 50, deltaY: 0 },
    { width: 500, height: 300 },
    { widthMm: 100, heightMm: 60 },
  );
  editor.resize(
    "text-1",
    [square],
    model.getElement("text-1").transform,
    1.5,
  );
  const result = await composer.compose(model.elements);

  assert.equal(conversions, 1);
  assert.ok(bounds(result.artwork).width > 4);
});

test("switching views preserves the same selected element state", () => {
  const model = new DesignModel({ elements: [textElement({ xMm: 12 })] });
  const editor = new DesignEditorController(model);
  const elementBefore = model.getElement("text-1");

  editor.setView("3d");
  editor.setView("2d");

  assert.equal(editor.selectedId, "text-1");
  assert.equal(model.getElement("text-1"), elementBefore);
  assert.equal(model.getElement("text-1").transform.xMm, 12);
});
