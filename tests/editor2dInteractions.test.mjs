import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import { DesignHistory } from "../src/designHistory.js";
import { ArtworkComposer } from "../src/pipeline/artworkComposition.js";
import { bounds } from "../src/pipeline/canonical.js";
import {
  DesignEditorController,
  KEYBOARD_MOVE_STEP_MM,
  arrowKeyDelta,
  canonicalOverlayBox,
  shouldHandleElementArrowKey,
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

test("arrow keys move the selected element in authoritative millimetres", () => {
  const model = new DesignModel({
    elements: [
      textElement({ xMm: 3, yMm: -2 }),
      { id: "svg-1", kind: "svg" },
    ],
  });
  const editor = new DesignEditorController(model, { selectedId: "svg-1" });

  editor.moveFromArrowKey("text-1", "ArrowRight");
  editor.moveFromArrowKey("text-1", "ArrowLeft");

  assert.equal(KEYBOARD_MOVE_STEP_MM, 0.5);
  assert.equal(model.getElement("text-1").transform.xMm, 3);
  assert.equal(model.getElement("text-1").transform.yMm, -2);
  assert.equal(editor.selectedId, "text-1");
});

test("arrow-up is positive canonical Y and arrow-down is negative", () => {
  assert.deepEqual(arrowKeyDelta("ArrowUp"), { xMm: 0, yMm: 0.5 });
  assert.deepEqual(arrowKeyDelta("ArrowDown"), { xMm: 0, yMm: -0.5 });

  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);
  editor.moveFromArrowKey("text-1", "ArrowUp");
  assert.equal(model.getElement("text-1").transform.yMm, 0.5);
});

test("element arrow handling ignores form fields and modifier shortcuts", () => {
  const element = { tagName: "DIV", isContentEditable: false };
  const input = { tagName: "INPUT", isContentEditable: false };
  const event = (target, overrides = {}) => ({
    key: "ArrowRight",
    target,
    currentTarget: target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });

  assert.equal(shouldHandleElementArrowKey(event(element)), true);
  assert.equal(shouldHandleElementArrowKey(event(input)), false);
  assert.equal(
    shouldHandleElementArrowKey(event(element, { ctrlKey: true })),
    false,
  );
  assert.equal(
    shouldHandleElementArrowKey({ ...event(element), target: input }),
    false,
  );
});

test("dragging follows the pointer through fitted and mirrored display space", () => {
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);

  editor.moveFromScreenDelta(
    "text-1",
    model.getElement("text-1").transform,
    { deltaX: 40, deltaY: 20 },
    { width: 200, height: 100 },
    { widthMm: 40, heightMm: 20 },
    { scale: 2, mirrorX: true },
  );

  assert.equal(model.getElement("text-1").transform.xMm, -4);
  assert.equal(model.getElement("text-1").transform.yMm, -2);
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
  editor.moveFromArrowKey("text-1", "ArrowRight");
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

test("keyboard movement remains undoable, redoable and deletable", () => {
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);
  const history = new DesignHistory(model);

  editor.moveFromArrowKey("text-1", "ArrowRight");
  history.undo();
  editor.ensureSelection();
  assert.equal(model.getElement("text-1").transform.xMm, 0);
  assert.equal(editor.selectedId, "text-1");

  history.redo();
  editor.ensureSelection();
  assert.equal(model.getElement("text-1").transform.xMm, 0.5);
  assert.equal(editor.deleteSelected().id, "text-1");
  assert.equal(model.getElement("text-1"), null);
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
