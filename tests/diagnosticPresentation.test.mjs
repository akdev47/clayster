import { test } from "node:test";
import assert from "node:assert/strict";
import { createPipelineDiagnostics, presentDiagnosticRows } from "../src/stamp_generator/static/stamp_generator/js/pipelineDiagnostics.js";

class Node {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.open = false;
    this.listeners = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
}

function withDOM(action) {
  const previous = globalThis.document;
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  globalThis.document = { createElement: (tag) => new Node(tag), getElementById: byId };
  try { action(byId); } finally { globalThis.document = previous; }
}

const allText = (node) => [node.textContent ?? "", ...node.children.flatMap(allText)].join("\n");
const pipelineWith = (issues) => {
  const pipeline = new EventTarget();
  pipeline.diagnostics = null;
  pipeline.result = { issues, stamp: {}, info: null };
  return pipeline;
};

test("presentation prioritizes problems, deduplicates copies and preserves technical details", () => {
  const warning = "Potentially thin letters: a (below approximately 0.8 mm).";
  const rows = [
    { level: "ok", message: "Design processed successfully.", details: [`Element \"text\": ${warning}`, "Stage: complete", "3 canonical polygons."] },
    { level: "info", message: "Wrapped onto 2 rows to keep each one inside 60 mm." },
    { level: "warning", elementId: "text", elementKind: "text", message: warning,
      thinGlyphs: [{ character: "a", line: 1, column: 3 }], details: ["Letter a: line 1, character 3"] },
    { level: "warning", message: warning, details: ["Additional measurement"] },
    { level: "error", message: "The artwork geometry could not be repaired safely (boolean failure)." },
  ];
  const original = structuredClone(rows);
  const shown = presentDiagnosticRows(rows);
  assert.deepEqual(shown.map(({ level }) => level), ["error", "warning", "info", "ok"]);
  assert.equal(shown[1].message, "Potentially thin letters: a.");
  assert.equal(shown[1].suggestion, "Try increasing Letter Thickness or Text Size.");
  assert.equal(shown[1].thinGlyphs, rows[2].thinGlyphs);
  assert.ok(shown[1].details.includes("Additional measurement"));
  assert.ok(shown[1].details.includes('Element "text" (text)'));
  assert.ok(shown[1].details.includes(warning));
  assert.equal(shown[2].message, "Text wrapped onto 2 lines.");
  assert.ok(shown[3].details.includes("3 canonical polygons."));
  assert.equal(shown[3].details.some((detail) => detail.includes(warning)), false);
  assert.deepEqual(rows, original);
});

test("identical warnings for different elements stay distinguishable", () => {
  const rows = presentDiagnosticRows([
    { level: "warning", elementId: "first", message: "Thin artwork" },
    { level: "warning", elementId: "second", message: "Thin artwork" },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].details[0], /first/);
  assert.match(rows[1].details[0], /second/);
});

test("Details and Checks passed start collapsed while warnings and quick fixes stay visible", () => {
  withDOM((byId) => {
    const pipeline = pipelineWith([
      { level: "ok", message: "Stamp surface checks passed: closed, consistently oriented edges." },
      { level: "info", message: "Wrapped onto 2 rows to keep each one inside 60 mm." },
      { level: "warning", code: "artwork-overflow", message: "Some artwork extends beyond the 50 mm face (or into its margin)." },
    ]);
    let fitted = null;
    createPipelineDiagnostics(pipeline, {
      getOverflowElementIds: () => ["svg-1"],
      onFitToStamp: (id) => { fitted = id; },
    });
    pipeline.dispatchEvent(new Event("result"));
    const [overflow, wrapping, checks] = byId("pipeline-diagnostic-list").children;
    assert.equal(overflow.children[1].children[0].textContent, "Artwork extends beyond the usable stamp area.");
    const button = overflow.children[1].children.find((child) => child.tagName === "button");
    button.listeners.click();
    assert.equal(fitted, "svg-1");
    const details = wrapping.children[1].children.find((child) => child.tagName === "details");
    assert.equal(details.open, false);
    assert.equal(details.children[0].tagName, "summary");
    assert.equal(details.children[0].textContent, "Details");
    assert.match(allText(details), /inside 60 mm/);
    assert.equal(checks.tagName, "details");
    assert.equal(checks.open, false);
    assert.match(checks.children[0].textContent, /^Checks passed/);
    assert.match(allText(checks), /closed, consistently oriented edges/);
  });
});

test("failed builds retain their cause, stage, earlier warnings and unavailable export", () => {
  withDOM((byId) => {
    const pipeline = pipelineWith([]);
    pipeline.result = null;
    pipeline.error = new Error("0 open edges and 1 non-manifold edge");
    pipeline.diagnostics = {
      level: "error", message: "Stamp mesh validation failed: 0 open edges and 1 non-manifold edge",
      stage: "final mesh validation", details: ["14 canonical polygons", "Rejected before preview/export."],
    };
    pipeline.artworkPreview = { issues: [{ level: "warning", message: "Thin artwork" }] };
    createPipelineDiagnostics(pipeline);
    pipeline.dispatchEvent(new Event("failed"));
    const [error, warning] = byId("pipeline-diagnostic-list").children;
    assert.equal(error.children[1].children[0].textContent, "The stamp surface could not be built safely.");
    assert.equal(warning.children[1].children[0].textContent, "Thin artwork");
    assert.match(allText(error), /1 non-manifold edge/);
    assert.match(allText(error), /Stage: final mesh validation/);
    assert.match(allText(error), /14 canonical polygons/);
    assert.equal(byId("pipeline-export-status").textContent, "Unavailable");
  });
});
