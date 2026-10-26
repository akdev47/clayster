import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignHistory } from "../src/stamp_generator/static/stamp_generator/js/designHistory.js";
import { DesignEditorController, centerTarget } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
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
      // The positions above assume a 50 mm face, so it is fixed here instead of following settings.js.
      pipeline.stamp = { ...pipeline.stamp, faceShape, faceSize: 50, handle: "none", margin: 2, mirror: true };
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

test("the centre buttons sit in the visible element panel, not in the collapsed transform panel", () => {
  const root = new URL("../src/stamp_generator/", import.meta.url);
  const html = readFileSync(new URL("templates/stamp_generator/index.html", root), "utf8");
  const main = readFileSync(new URL("static/stamp_generator/js/main.js", root), "utf8");

  const group = html.match(/<div id="center-controls"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] ?? "";
  for (const [id, label] of [
    ["center-element-x", "Left–right"],
    ["center-element-y", "Up–down"],
    ["center-element", "Both"],
  ]) {
    assert.match(group, new RegExp(`<button id="${id}" type="button" class="btn subtle-button" disabled>${label}</button>`));
  }
  assert.match(group, /aria-label="Center the selected element on the stamp"/);
  assert.match(group, /data-help="help-center"/);
  assert.match(html, /<div id="help-center" class="help-text" hidden>/);
  const collapsed = html.match(/id="transform-controls-content" hidden>[\s\S]*?<button id="duplicate-element"/)?.[0] ?? "";
  assert.ok(collapsed.length > 0 && !collapsed.includes("center-element"), "nothing to centre inside the collapsed panel");

  assert.match(main, /centerSelectedOnStamp\(target, axis\)/);
  assert.match(main, /\["#center-element-x", "x"\]/);
  assert.match(main, /\["#center-element-y", "y"\]/);
});

const target = rectangle(-10, -10, 10, 10); // centre (0, 0)
const wide = [[[[0, 0], [20, 0], [20, 4], [0, 4]]]]; // 20 x 4, centre (10, 2) before it is moved

for (const axis of ["x", "y", "both"]) {
  test(`centering ${axis === "both" ? "both ways" : `only ${axis === "x" ? "left-right" : "up-down"}`} moves just that direction`, () => {
    const model = new DesignModel({ elements: [
      { id: "line", kind: "svg", transform: { xMm: 7, yMm: 13 } },
    ] });
    const editor = new DesignEditorController(model);
    editor.canonicalFor = () => wide;
    const start = model.getElement("line").transform;
    const moved = editor.centerSelectedOnStamp(target, axis);
    const box = bounds(transform(wide, moved.transform));
    const at = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };

    if (axis === "y") {
      assert.equal(moved.transform.xMm, start.xMm, "left-right is left alone");
    } else {
      close(at.x, 0);
    }
    if (axis === "x") {
      assert.equal(moved.transform.yMm, start.yMm, "up-down is left alone");
    } else {
      close(at.y, 0);
    }
    // Nothing but the position changed.
    assert.deepEqual({ ...moved.transform, xMm: 0, yMm: 0 }, { ...start, xMm: 0, yMm: 0 });
  });
}

test("several texts can be lined up on one axis without stacking them", () => {
  const model = new DesignModel({ elements: [
    { id: "top", kind: "svg", transform: { xMm: 6, yMm: 8 } },
    { id: "bottom", kind: "svg", transform: { xMm: -9, yMm: -8 } },
  ] });
  const editor = new DesignEditorController(model);
  editor.canonicalFor = () => wide;
  for (const id of ["top", "bottom"]) {
    editor.select(id);
    editor.centerSelectedOnStamp(target, "x");
  }
  const centreOf = (id) => {
    const box = bounds(transform(wide, model.getElement(id).transform));
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  };
  close(centreOf("top").x, 0);
  close(centreOf("bottom").x, 0);
  close(centreOf("top").y - centreOf("bottom").y, 16, "they keep their distance");
});

test("a Round or Square stamp is centred on its plate, a Minimal one on the other elements", () => {
  const plate = rectangle(-30, -20, 30, 20);
  const others = [rectangle(10, 10, 20, 14)[0], rectangle(14, -6, 30, -2)[0]];

  for (const faceShape of ["round", "square"]) {
    assert.equal(centerTarget({ faceShape, face: plate, others }), plate);
    assert.equal(centerTarget({ faceShape, face: [] }), null);
  }
  const alone = centerTarget({ faceShape: "minimal", face: plate, others: [] });
  assert.equal(alone, null, "nothing to line up with");

  const rest = centerTarget({ faceShape: "minimal", face: plate, others });
  assert.deepEqual(bounds(rest), bounds(others), "a box around everything else");
  assert.equal(rest.length, 1);
  // The plate is not used at all: it is made from the very elements being moved.
  assert.notDeepEqual(bounds(rest), bounds(plate));
});

function lines() {
  const model = new DesignModel({ elements: [
    { id: "top", kind: "svg", transform: { xMm: 9, yMm: 8 } },
    { id: "middle", kind: "svg", transform: { xMm: -14, yMm: 0 } },
    { id: "bottom", kind: "svg", transform: { xMm: 17, yMm: -8 } },
    { id: "hidden", kind: "svg", visible: false, transform: { xMm: 30, yMm: 0 } },
  ] });
  const editor = new DesignEditorController(model);
  editor.canonicalFor = () => wide;
  return { model, editor, history: new DesignHistory(model) };
}
const centreX = (model, id) => {
  const box = bounds(transform(wide, model.getElement(id).transform));
  return (box.minX + box.maxX) / 2;
};

test("Center all puts every visible element on one center line in a single undo step", () => {
  const { model, editor, history } = lines();
  const before = Object.fromEntries(model.elements.map((element) => [element.id, element]));
  let changes = 0;
  model.addEventListener("change", () => changes++);

  assert.equal(editor.centerAllOnStamp(target), 3);
  assert.equal(changes, 1, "one change for all of them");
  for (const id of ["top", "middle", "bottom"]) {
    close(centreX(model, id), 0);
    assert.equal(model.getElement(id).transform.yMm, before[id].transform.yMm, `${id} keeps its height`);
  }
  assert.deepEqual(model.getElement("hidden"), before.hidden, "hidden elements stay as they were");

  assert.equal(editor.centerAllOnStamp(target), 0, "already in line");
  assert.equal(changes, 1, "nothing changed, so nothing is recorded");

  assert.equal(history.undo(), true);
  for (const id of Object.keys(before)) assert.deepEqual(model.getElement(id), before[id]);
  assert.equal(history.canUndo, false, "one undo brings back all three");
});

test("Center all gives the same result whatever order the elements are in", () => {
  const spots = (ids) => {
    const { model, editor } = lines();
    model.replaceElements(ids.map((id) => model.getElement(id)));
    editor.centerAllOnStamp(target);
    return Object.fromEntries(model.elements.map((element) => [element.id, element.transform.xMm]));
  };
  const one = spots(["top", "middle", "bottom", "hidden"]);
  const other = spots(["bottom", "hidden", "top", "middle"]);
  assert.deepEqual(one, other);
});

test("Center all on a Minimal stamp uses the middle of everything together", () => {
  const { model, editor } = lines();
  editor.canonicalFor = () => wide;
  const everything = model.elements
    .filter(({ visible }) => visible)
    .flatMap(({ transform: place }) => transform(wide, place));
  const middle = bounds(everything);
  const goal = (middle.minX + middle.maxX) / 2;

  const face = centerTarget({ faceShape: "minimal", face: rectangle(-1, -1, 1, 1), others: everything });
  editor.centerAllOnStamp(face);
  for (const id of ["top", "middle", "bottom"]) close(centreX(model, id), goal);
});

test("Center all waits for geometry and a stamp face", () => {
  const { model, editor } = lines();
  const original = model.elements;
  assert.equal(editor.centerAllOnStamp([]), null);
  assert.equal(editor.centerAllOnStamp(undefined), null);
  editor.canonicalFor = () => undefined;
  assert.equal(editor.centerAllOnStamp(target), null);
  assert.equal(model.elements, original, "the list itself was not replaced");
});
