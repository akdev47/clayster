import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";
import { DesignModel, createElementTransform, DEFAULT_ELEMENT_TRANSFORM } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignHistory } from "../src/stamp_generator/static/stamp_generator/js/designHistory.js";
import {
  DesignEditorController,
  MAX_ELEMENT_SCALE,
  MIN_ELEMENT_SCALE,
  MAX_STRETCH,
  MIN_STRETCH,
  elementOwnSize,
  stretchedTransform,
} from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { bounds, transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { canonicalSvgTransform } from "../src/stamp_generator/static/stamp_generator/js/canonicalSvgRenderer.js";

const rectangle = (x0, y0, x1, y1) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]];
// Off-centre and asymmetric on purpose, so a wrong anchor or axis shows up.
const outline = [[[[2, 3], [12, 3], [12, 9], [7, 11], [2, 9]]]];
const close = (actual, expected, message = "") =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message} ${actual} != ${expected}`);

// Extent of a drawn outline along the element's own X or Y direction in the world.
function extent(canonical, elementTransform, axis) {
  const angle = (elementTransform.rotationDeg * Math.PI) / 180;
  const direction = axis === "x"
    ? [Math.cos(angle), Math.sin(angle)]
    : [-Math.sin(angle), Math.cos(angle)];
  const along = transform(canonical, elementTransform)
    .flatMap((polygon) => polygon.flat())
    .map(([x, y]) => x * direction[0] + y * direction[1]);
  const min = Math.min(...along);
  const max = Math.max(...along);
  return { min, max, size: max - min, centre: (min + max) / 2 };
}

// Starting point and factors that stay inside the limits of settings.js,
// whatever they are set to, so changing a limit never needs a test edit.
const START_STRETCH = Math.min(1.2, MAX_STRETCH);
const WIDER = Math.min(1.5, MAX_STRETCH / START_STRETCH);
const SHORTER = Math.max(0.6, START_STRETCH / MAX_STRETCH, MIN_ELEMENT_SCALE / 1.5);
const turned = {
  xMm: 5, yMm: -4, scale: 1.5, stretchX: START_STRETCH, rotationDeg: 30,
  mirrorX: true, mirrorY: false, pivotX: 1, pivotY: -1,
};

test("stretchX widens only the element's own X axis, before it is turned", () => {
  const plain = transform(rectangle(0, 0, 10, 4), { scale: 2 });
  const wide = transform(rectangle(0, 0, 10, 4), { scale: 2, stretchX: 3 });
  assert.deepEqual(bounds(plain), { minX: 0, minY: 0, maxX: 20, maxY: 8, width: 20, height: 8 });
  assert.deepEqual(bounds(wide), { minX: 0, minY: 0, maxX: 60, maxY: 8, width: 60, height: 8 });

  // Turned a quarter turn, the stretched side now points up.
  const upright = bounds(transform(rectangle(0, 0, 10, 4), { scale: 2, stretchX: 3, rotationDeg: 90 }));
  close(upright.width, 8);
  close(upright.height, 60);

  // No stretch behaves exactly as before, and a mirror keeps the outline's winding.
  assert.deepEqual(
    transform(outline, { ...turned, stretchX: 1 }),
    transform(outline, { ...turned, stretchX: undefined }),
  );
  const mirrored = transform(rectangle(0, 0, 10, 4), { mirrorX: true, stretchX: 2 });
  close(bounds(mirrored).minX, -20);
  close(bounds(mirrored).maxX, 0);
});

test("the 2D view draws the stretch the same way the geometry has it", () => {
  assert.equal(
    canonicalSvgTransform({ xMm: 3, yMm: 2, scale: 2, stretchX: 1.5, rotationDeg: 10 }),
    "translate(3 -2) rotate(-10) scale(3 2) translate(0 0)",
  );
  assert.equal(
    canonicalSvgTransform({ scale: 2, stretchX: 1.5, mirrorX: true, mirrorY: true }),
    "translate(0 0) rotate(0) scale(-3 -2) translate(0 0)",
  );
  assert.equal(canonicalSvgTransform({ scale: 2 }), "translate(0 0) rotate(0) scale(2 2) translate(0 0)");
});

test("an element transform starts unstretched and refuses a stretch it cannot draw", () => {
  assert.equal(DEFAULT_ELEMENT_TRANSFORM.stretchX, 1);
  assert.equal(createElementTransform({}).stretchX, 1);
  assert.equal(createElementTransform({ stretchX: 2.5 }).stretchX, 2.5);
  for (const bad of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => createElementTransform({ stretchX: bad }), /stretchX/);
  }
  assert.ok(MIN_STRETCH > 0 && MIN_STRETCH < 1 && MAX_STRETCH > 1);
  assert.equal(MIN_STRETCH, SETTINGS.elements.stretch.min);
  assert.equal(MAX_STRETCH, SETTINGS.elements.stretch.max);
});

test("an element's own size ignores how far it is turned", () => {
  const straight = elementOwnSize(outline, { scale: 2, stretchX: 1.5 });
  close(straight.width, 10 * 2 * 1.5);
  close(straight.height, 8 * 2);
  for (const rotationDeg of [0, 33, 90, 200]) {
    const size = elementOwnSize(outline, { scale: 2, stretchX: 1.5, rotationDeg, xMm: 9, yMm: -7, mirrorX: true });
    close(size.width, straight.width, `at ${rotationDeg}°`);
    close(size.height, straight.height, `at ${rotationDeg}°`);
  }
  assert.equal(elementOwnSize([], {}), null);
  assert.equal(elementOwnSize(undefined, {}), null);
});

for (const rotationDeg of [0, 30, 90, 211]) {
  for (const mirrorX of [false, true]) {
    test(`changing the width leaves the height and the chosen edge in place (turned ${rotationDeg}°, mirrored ${mirrorX})`, () => {
      const start = { ...turned, rotationDeg, mirrorX };
      const before = { x: extent(outline, start, "x"), y: extent(outline, start, "y") };

      for (const [anchor, held] of [["start", "min"], ["end", "max"], ["centre", "centre"]]) {
        const next = stretchedTransform(outline, start, "width", WIDER, anchor);
        const after = { x: extent(outline, next, "x"), y: extent(outline, next, "y") };
        close(after.x.size, before.x.size * WIDER, `${anchor} width`);
        close(after.x[held], before.x[held], `${anchor} edge`);
        close(after.y.size, before.y.size, `${anchor} height`);
        close(after.y.min, before.y.min, `${anchor} bottom`);
        close(next.stretchX, start.stretchX * WIDER);
        assert.equal(next.scale, start.scale);
      }
    });

    test(`changing the height leaves the width and the chosen edge in place (turned ${rotationDeg}°, mirrored ${mirrorX})`, () => {
      const start = { ...turned, rotationDeg, mirrorX };
      const before = { x: extent(outline, start, "x"), y: extent(outline, start, "y") };

      for (const [anchor, held] of [["start", "min"], ["end", "max"], ["centre", "centre"]]) {
        const next = stretchedTransform(outline, start, "height", SHORTER, anchor);
        const after = { x: extent(outline, next, "x"), y: extent(outline, next, "y") };
        close(after.y.size, before.y.size * SHORTER, `${anchor} height`);
        close(after.y[held], before.y[held], `${anchor} edge`);
        close(after.x.size, before.x.size, `${anchor} width`);
        close(after.x.min, before.x.min, `${anchor} left`);
        // The element itself got smaller; the stretch makes up for it.
        close(next.scale, start.scale * SHORTER);
        close(next.stretchX, start.stretchX / SHORTER);
      }
    });
  }
}

test("a side can only be stretched as far as the settings allow", () => {
  const start = { ...DEFAULT_ELEMENT_TRANSFORM, scale: 1 };
  assert.equal(stretchedTransform(outline, start, "width", 1000).stretchX, MAX_STRETCH);
  assert.equal(stretchedTransform(outline, start, "width", 0.0001).stretchX, MIN_STRETCH);

  // Height scales the element and stretches it back, so both limits apply.
  const tall = stretchedTransform(outline, start, "height", 1000);
  assert.ok(tall.scale <= MAX_ELEMENT_SCALE + 1e-9);
  assert.ok(tall.stretchX >= MIN_STRETCH - 1e-9);
  close(tall.scale * tall.stretchX, start.scale * start.stretchX, "the width is kept even at the limit");
  const short = stretchedTransform(outline, start, "height", 0.0001);
  assert.ok(short.scale >= SETTINGS.elements.scale.min - 1e-9);
  assert.ok(short.stretchX <= MAX_STRETCH + 1e-9);

  // The caller can narrow the range further (text uses its font size limits).
  const limited = stretchedTransform(outline, start, "height", 5, "centre", { maxFactor: 2, scaleLimits: false });
  close(limited.scale, Math.min(2, 1 / MIN_STRETCH), "the stretch that keeps the width has its limit too");

  for (const bad of [0, -2, Number.NaN, Infinity]) {
    assert.equal(stretchedTransform(outline, start, "width", bad), null);
  }
  assert.throws(() => stretchedTransform(outline, start, "depth", 2), /Unknown element side/);
});

function setup(elementPatch = {}) {
  const model = new DesignModel({ elements: [{
    id: "item",
    kind: "svg",
    source: { reference: new File(["svg"], "mark.svg"), baseSizeMm: 30 },
    transform: { xMm: 3, yMm: -2 },
    ...elementPatch,
  }] });
  const editor = new DesignEditorController(model);
  editor.canonicalFor = () => outline;
  return { model, editor, history: new DesignHistory(model) };
}

test("the editor resizes the width of a picture on its own, as one undo step", () => {
  const { model, editor, history } = setup();
  const original = model.getElement("item");
  const sizeBefore = elementOwnSize(outline, original.transform);

  const changed = editor.resizeAxis("item", "width", WIDER);
  const sizeAfter = elementOwnSize(outline, changed.transform);
  close(sizeAfter.width, sizeBefore.width * WIDER);
  close(sizeAfter.height, sizeBefore.height);
  assert.equal(editor.selectedId, "item");
  assert.equal(model.getElement("item"), changed);
  assert.equal(history.undo(), true);
  assert.deepEqual(model.getElement("item"), original);
  assert.equal(history.canUndo, false);
});

test("the editor resizes the height of a picture without moving its width", () => {
  const { editor } = setup();
  const before = elementOwnSize(outline, createElementTransform({ xMm: 3, yMm: -2 }));
  const changed = editor.resizeAxis("item", "height", WIDER);
  const after = elementOwnSize(outline, changed.transform);
  close(after.height, before.height * WIDER);
  close(after.width, before.width);
});

test("a text's height changes its font size, and its stretch keeps the width", () => {
  const { model, editor } = setup({
    id: "words",
    kind: "text",
    source: { text: "HELLO", fontSizeMm: 8 },
    transform: { stretchX: Math.min(1.25, MAX_STRETCH) },
  });
  editor.canonicalFor = () => outline;
  editor.maxTextSizeMm = 40;
  const element = model.getElement("words");
  const widthFactor = element.source.fontSizeMm * element.transform.scale * element.transform.stretchX;

  const taller = editor.resizeAxis("words", "height", 2);
  close(taller.source.fontSizeMm, 16);
  assert.equal(taller.transform.scale, 1, "the new size is the font size, not a scale");
  close(taller.source.fontSizeMm * taller.transform.stretchX, widthFactor, "text width in the font's own units is kept");
  close(taller.transform.stretchX, element.transform.stretchX / 2);

  // Past the biggest size allowed it stops there, or sooner when keeping the
  // width would take more stretch than the settings allow, and keeps the width.
  const huge = editor.resizeAxis("words", "height", 100);
  const reach = Math.min(40 / 16, taller.transform.stretchX / MIN_STRETCH);
  close(huge.source.fontSizeMm, 16 * reach);
  close(huge.source.fontSizeMm * huge.transform.stretchX, widthFactor);

  // Typing a width only stretches; the font size stays.
  const wider = editor.resizeAxis("words", "width", Math.min(2, MAX_STRETCH / huge.transform.stretchX));
  close(wider.source.fontSizeMm, huge.source.fontSizeMm);
  close(wider.transform.stretchX, huge.transform.stretchX * Math.min(2, MAX_STRETCH / huge.transform.stretchX));
});

test("resizing one side waits for something to resize", () => {
  const { model, editor } = setup();
  const original = model.getElement("item");
  editor.canonicalFor = () => undefined;
  assert.equal(editor.resizeAxis("item", "width", 2), null);
  editor.canonicalFor = () => [];
  assert.equal(editor.resizeAxis("item", "width", 2), null);
  editor.canonicalFor = () => outline;
  assert.equal(editor.resizeAxis("missing", "width", 2), null);
  assert.equal(editor.resizeAxis("item", "width", 0), null);
  assert.equal(model.getElement("item"), original);
});

test("a text keeps its exact width when the height changes, even with letter thickness around the letters", () => {
  // A stand-in for laid-out text: its letters are 2 mm wide per mm of font size,
  // and the letter thickness is added around them once, whatever the size.
  const lettersPerMm = 2;
  const thickness = 0.4;
  const widthAt = (fontMm) => lettersPerMm * fontMm + thickness;
  const { model, editor } = setup({
    id: "words",
    kind: "text",
    source: { text: "HI", fontSizeMm: 8, thicknessMm: thickness },
    transform: { stretchX: Math.min(1.25, MAX_STRETCH) },
  });
  const laidOut = rectangle(0, 0, widthAt(8), 5);
  editor.canonicalFor = () => laidOut;
  editor.maxTextSizeMm = 60;
  const before = model.getElement("words");
  const widthBefore = before.transform.stretchX * widthAt(8);

  const grow = Math.min(2.5, before.transform.stretchX / MIN_STRETCH / 2);
  const taller = editor.resizeAxis("words", "height", grow);
  const font = taller.source.fontSizeMm;
  close(font, 8 * grow);
  close(taller.transform.stretchX * widthAt(font), widthBefore, "the text is as wide as before");
  // The plain 1 / grow would have drifted by the thickness that does not grow
  // (when the limits leave room for a real change in size).
  if (grow >= 1.5) {
    assert.ok(Math.abs((before.transform.stretchX / grow) * widthAt(font) - widthBefore) > 0.05);
  }
});
