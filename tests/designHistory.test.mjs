import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignHistory } from "../src/stamp_generator/static/stamp_generator/js/designHistory.js";

const setup = () => {
  const clock = { time: 0 };
  const model = new DesignModel({
    elements: [{ id: "a", kind: "text", source: { text: "A" } }],
  });
  const history = new DesignHistory(model, { now: () => clock.time, mergeMs: 500 });
  return { model, history, clock };
};

test("undo and redo restore added and removed elements", () => {
  const { model, history } = setup();
  assert.equal(history.canUndo, false);

  model.addElement({ id: "b", kind: "text", source: { text: "B" } });
  model.removeElement("a");
  assert.deepEqual(model.elements.map((e) => e.id), ["b"]);

  history.undo();
  assert.deepEqual(model.elements.map((e) => e.id), ["a", "b"]);
  history.undo();
  assert.deepEqual(model.elements.map((e) => e.id), ["a"]);
  assert.equal(history.canUndo, false);

  history.redo();
  history.redo();
  assert.deepEqual(model.elements.map((e) => e.id), ["b"]);
  assert.equal(history.canRedo, false);
});

test("a burst of edits to one element is one undo step", () => {
  const { model, history, clock } = setup();
  for (let x = 1; x <= 20; x += 1) {
    clock.time += 30;
    model.updateElement("a", { transform: { xMm: x } });
  }
  assert.equal(model.getElement("a").transform.xMm, 20);

  history.undo();
  assert.equal(model.getElement("a").transform.xMm, 0);
  assert.equal(history.canUndo, false);

  history.redo();
  assert.equal(model.getElement("a").transform.xMm, 20);
});

test("a pause, a different element or another kind of edit starts a new step", () => {
  const { model, history, clock } = setup();
  model.addElement({ id: "b", kind: "text", source: { text: "B" } });

  model.updateElement("a", { transform: { xMm: 1 } });
  clock.time += 2000; // pause
  model.updateElement("a", { transform: { xMm: 2 } });
  model.updateElement("b", { transform: { xMm: 9 } }); // other element
  model.removeElement("b"); // different kind of change

  history.undo(); // remove
  assert.ok(model.getElement("b"));
  history.undo(); // b moved
  assert.equal(model.getElement("b").transform.xMm, 0);
  history.undo(); // a -> 2
  assert.equal(model.getElement("a").transform.xMm, 1);
  history.undo(); // a -> 1
  assert.equal(model.getElement("a").transform.xMm, 0);
});

test("a new edit clears redo, history is capped, and events fire", () => {
  const model = new DesignModel({ elements: [{ id: "a", kind: "text" }] });
  const history = new DesignHistory(model, { limit: 3 });
  let announced = 0;
  history.addEventListener("change", () => announced++);

  for (const id of ["b", "c", "d", "e", "f"]) {
    model.addElement({ id, kind: "text" });
  }
  let undone = 0;
  while (history.undo()) undone++;
  assert.equal(undone, 3);

  model.addElement({ id: "z", kind: "text" });
  assert.equal(history.canRedo, false);
  assert.ok(announced > 0);

  history.clear();
  assert.equal(history.canUndo, false);
});
