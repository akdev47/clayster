// A tiny stand-in for the stamp page, enough to run createPipelineControls() and
// see what the controls do, without a browser.
import { createPipelineControls } from "../src/stamp_generator/static/stamp_generator/js/pipelineControls.js";
import { DEFAULT_STAMP } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.buttons = [];
    this.listeners = {};
    this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  removeEventListener() {}
  dispatch(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener({ target: this, ...event }); }
  querySelectorAll() { return this.buttons; }
  contains() { return true; }
  closest() { return this; }
}

export function pageWith(stamp) {
  const elements = {};
  const document = { getElementById: (id) => (elements[id] ??= new FakeElement(id)) };
  const shapes = document.getElementById("pipeline-face-shape");
  shapes.buttons = ["round", "square", "minimal"].map((shape) => Object.assign(new FakeElement(shape), { dataset: { shape } }));
  const calls = [];
  const pipeline = Object.assign(new EventTarget(), {
    stamp: { ...DEFAULT_STAMP, ...stamp },
    setStamp(patch) { calls.push(patch); Object.assign(this.stamp, patch); },
  });
  globalThis.document = document;
  try {
    createPipelineControls({ renderer: { domElement: new FakeElement("canvas") } }, pipeline);
  } finally {
    delete globalThis.document;
  }
  const clickShape = (shape) => {
    const button = shapes.buttons.find((candidate) => candidate.dataset.shape === shape);
    shapes.dispatch("click", { target: { closest: () => button } });
  };
  return { document, pipeline, calls, clickShape };
}
