import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import { DesignHistory } from "../src/designHistory.js";
import { ArtworkComposer } from "../src/pipeline/artworkComposition.js";
import { bounds, transform } from "../src/pipeline/canonical.js";
import {
  DesignEditorController,
  DUPLICATE_OFFSET_MM,
  KEYBOARD_MOVE_STEP_MM,
  MAX_TEXT_SIZE_MM,
  arrowKeyDelta,
  canonicalOverlayBox,
  fitElementTransform,
  fitsFace,
  shouldHandleElementArrowKey,
  screenDeltaToMillimetres,
  textResizePreview,
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

const svgElement = (transform = {}) => ({
  id: "svg-1",
  kind: "svg",
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
  const model = new DesignModel({ elements: [svgElement({ xMm: 7, yMm: -2 })] });
  const editor = new DesignEditorController(model);
  const start = model.getElement("svg-1").transform;
  const before = canonicalOverlayBox([square], start, {
    widthMm: 60,
    heightMm: 40,
  });

  editor.resize("svg-1", [square], start, 2);
  const changed = model.getElement("svg-1").transform;
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

test("text resize previews are transient and commit one authoritative size change", async () => {
  let conversions = 0;
  const model = new DesignModel({
    elements: [
      {
        ...textElement({ xMm: 7, yMm: -2 }),
        source: {
          text: "CLAY",
          fontSizeMm: 10,
          letterSpacingRatio: 0.1,
          lineSpacing: 1.5,
        },
      },
    ],
  });
  const editor = new DesignEditorController(model);
  const history = new DesignHistory(model);
  const start = model.getElement("text-1");
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: [square], issues: [] };
  });
  let modelChanges = 0;
  model.addEventListener("change", () => {
    modelChanges += 1;
  });

  await composer.compose(model.elements);
  const firstPreview = textResizePreview(
    start.source.fontSizeMm,
    start.transform,
    1.2,
  );
  const finalPreview = textResizePreview(
    start.source.fontSizeMm,
    start.transform,
    1.5,
  );

  assert.equal(firstPreview.fontSizeMm, 12);
  assert.equal(finalPreview.fontSizeMm, 15);
  assert.equal(finalPreview.transform.scale, 1.5);
  assert.equal(finalPreview.transform.xMm, 7);
  assert.equal(finalPreview.transform.yMm, -2);
  assert.equal(model.getElement("text-1"), start);
  assert.equal(modelChanges, 0);
  assert.equal(history.canUndo, false);
  assert.equal(conversions, 1);

  editor.setTextSize("text-1", finalPreview.fontSizeMm);

  const resized = model.getElement("text-1");
  assert.equal(modelChanges, 1);
  assert.equal(resized.source.fontSizeMm, 15);
  assert.equal(resized.source.letterSpacingRatio, 0.1);
  assert.equal(resized.source.lineSpacing, 1.5);
  assert.equal(resized.transform.scale, 1);
  assert.equal(resized.transform.xMm, 7);
  assert.equal(resized.transform.yMm, -2);
  await composer.compose(model.elements);
  assert.equal(conversions, 2);

  history.undo();
  assert.equal(model.getElement("text-1").source.fontSizeMm, 10);
  history.redo();
  assert.equal(model.getElement("text-1").source.fontSizeMm, 15);

  const limitedPreview = textResizePreview(
    resized.source.fontSizeMm,
    resized.transform,
    10,
  );
  assert.equal(limitedPreview.fontSizeMm, MAX_TEXT_SIZE_MM);
});

test("Fit to stamp preserves image aspect ratio and resolves square and round overflow", () => {
  const canonical = [square];
  for (const shape of ["square", "round"]) {
    const limit = { shape, halfExtent: 5 };
    const start = {
      xMm: 20,
      yMm: -15,
      scale: 4,
      rotationDeg: 25,
    };
    const before = bounds(transform(canonical, start));
    const fitted = fitElementTransform(canonical, start, limit);
    const after = bounds(transform(canonical, fitted));

    assert.equal(fitsFace(canonical, fitted, limit), true);
    assert.ok(fitted.scale <= start.scale);
    assert.ok(Math.abs(before.width / before.height - after.width / after.height) < 1e-9);
  }
});

test("Fit to stamp uses Text size for text and transform scale for SVG and PNG", () => {
  const oversized = [[
    [-10, -2],
    [10, -2],
    [10, 2],
    [-10, 2],
  ]];
  const model = new DesignModel({
    elements: [
      {
        id: "text-1",
        kind: "text",
        source: { text: "WIDE", fontSizeMm: 20 },
        transform: { xMm: 30, scale: 1 },
      },
      {
        ...svgElement({ xMm: 30, scale: 2 }),
        source: { reference: "mark.svg" },
      },
      {
        id: "png-1",
        kind: "png",
        source: { reference: "mark.png" },
        transform: { xMm: 30, scale: 2 },
      },
    ],
  });
  const editor = new DesignEditorController(model);
  const history = new DesignHistory(model);
  editor.faceLimit = { shape: "square", halfExtent: 5 };
  editor.canonicalFor = () => [oversized];

  editor.fitToStamp("text-1");
  const text = model.getElement("text-1");
  assert.ok(text.source.fontSizeMm < 20);
  assert.equal(text.transform.scale, 1);
  assert.equal(fitsFace([oversized], {
    ...text.transform,
    scale: text.source.fontSizeMm / 20,
  }, editor.faceLimit), true);
  history.undo();
  assert.equal(model.getElement("text-1").source.fontSizeMm, 20);

  for (const id of ["svg-1", "png-1"]) {
    const source = model.getElement(id).source;
    editor.fitToStamp(id);
    const fitted = model.getElement(id);
    assert.deepEqual(fitted.source, source);
    assert.ok(fitted.transform.scale < 2);
    assert.equal(fitsFace([oversized], fitted.transform, editor.faceLimit), true);
  }
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

test("duplicating copies editable properties, offsets, selects, and supports undo/redo", () => {
  const reference = { name: "art.png" };
  const originalInput = {
    id: "png-original",
    kind: "png",
    visible: false,
    operation: "add",
    source: {
      reference,
      baseSizeMm: 37,
      tracing: {
        smoothing: 3,
        backgroundMode: "pick",
        backgroundSamples: [{ x: 0.1, y: 0.2 }],
        backgroundTolerance: 1.5,
      },
    },
    transform: {
      xMm: 8,
      yMm: -4,
      scale: 1.7,
      rotationDeg: 23,
      mirrorX: true,
      mirrorY: true,
      pivotX: 2,
      pivotY: -1,
    },
  };
  const model = new DesignModel({ elements: [originalInput] });
  const editor = new DesignEditorController(model);
  const history = new DesignHistory(model);
  const original = model.getElement("png-original");

  const duplicate = editor.duplicateSelected();

  assert.equal(DUPLICATE_OFFSET_MM, 2);
  assert.notEqual(duplicate.id, original.id);
  assert.equal(model.elements.length, 2);
  assert.equal(editor.selectedId, duplicate.id);
  assert.equal(duplicate.kind, original.kind);
  assert.equal(duplicate.visible, original.visible);
  assert.equal(duplicate.operation, original.operation);
  assert.deepEqual(duplicate.source, original.source);
  assert.equal(duplicate.source.reference, reference);
  assert.deepEqual(duplicate.transform, {
    ...original.transform,
    xMm: original.transform.xMm + DUPLICATE_OFFSET_MM,
    yMm: original.transform.yMm - DUPLICATE_OFFSET_MM,
  });

  history.undo();
  editor.ensureSelection();
  assert.equal(model.elements.length, 1);
  assert.equal(editor.selectedId, original.id);
  history.redo();
  assert.equal(model.elements.length, 2);
  assert.equal(model.getElement(duplicate.id).id, duplicate.id);
});

test("duplicating Text, SVG, and PNG reuses resolved source conversion", async () => {
  for (const element of [
    {
      id: "text-original",
      kind: "text",
      source: { text: "CLAY", fontSizeMm: 12 },
    },
    {
      id: "svg-original",
      kind: "svg",
      source: { reference: { name: "art.svg" }, baseSizeMm: 25 },
    },
    {
      id: "png-original",
      kind: "png",
      source: { reference: { name: "art.png" }, baseSizeMm: 25 },
    },
  ]) {
    let conversions = 0;
    const model = new DesignModel({ elements: [element] });
    const editor = new DesignEditorController(model);
    const composer = new ArtworkComposer(async () => {
      conversions += 1;
      return { canonical: [square], issues: [] };
    });

    await composer.compose(model.elements);
    editor.duplicateSelected();
    const result = await composer.compose(model.elements);

    assert.equal(conversions, 1, `${element.kind} source converted again`);
    assert.equal(result.renderElements.length, 2);
  }
});

test("text editing updates the selected text source", () => {
  const model = new DesignModel({ elements: [textElement()] });
  const editor = new DesignEditorController(model);

  editor.updateSelectedText({
    text: "UPDATED",
    fontSizeMm: 22,
    letterSpacingRatio: 0.1,
    alignment: "right",
  });

  const source = model.getElement("text-1").source;
  assert.equal(source.text, "UPDATED");
  assert.equal(source.fontSizeMm, 22);
  assert.equal(source.letterSpacingRatio, 0.1);
  assert.equal(source.alignment, "right");
});

test("transform-only edits reuse the element conversion cache", async () => {
  let conversions = 0;
  const model = new DesignModel({ elements: [svgElement()] });
  const editor = new DesignEditorController(model);
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: [square], issues: [] };
  });

  await composer.compose(model.elements);
  editor.moveFromArrowKey("svg-1", "ArrowRight");
  editor.resize(
    "svg-1",
    [square],
    model.getElement("svg-1").transform,
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
