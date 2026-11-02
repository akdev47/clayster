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
  const warning = "Mogelijk te dunne letters: a (onder ongeveer 0,8 mm).";
  const rows = [
    { level: "ok", message: "Ontwerp succesvol verwerkt.", details: [`Element \"text\": ${warning}`, "Fase: klaar", "3 veelhoeken."] },
    { level: "info", message: "De tekst is aangepast." },
    { level: "warning", elementId: "text", elementKind: "text", message: warning,
      thinGlyphs: [{ character: "a", line: 1, column: 3 }], details: ["Letter a: regel 1, teken 3"] },
    { level: "warning", message: warning, details: ["Extra meting"] },
    { level: "error", message: "De geometrie van het ontwerp kon niet veilig worden gerepareerd (boolean failure)." },
  ];
  const original = structuredClone(rows);
  const shown = presentDiagnosticRows(rows);
  assert.deepEqual(shown.map(({ level }) => level), ["error", "warning", "info", "ok"]);
  assert.equal(shown[0].message, "Sommige omtrekken moeten worden aangepast voordat ze geprint kunnen worden.");
  assert.equal(shown[1].message, "Mogelijk te dunne letters: a.");
  assert.equal(shown[1].suggestion, "Maak de letterdikte of de tekstgrootte groter.");
  assert.equal(shown[1].thinGlyphs, rows[2].thinGlyphs);
  assert.ok(shown[1].details.includes("Extra meting"));
  assert.ok(shown[1].details.includes('Element "text" (tekst)'));
  assert.ok(shown[1].details.includes(warning));
  assert.equal(shown[2].message, "De tekst is aangepast.");
  assert.equal(shown[3].message, "Controles van het ontwerp geslaagd.");
  assert.ok(shown[3].details.includes("3 veelhoeken."));
  assert.equal(shown[3].details.some((detail) => detail.includes(warning)), false);
  assert.deepEqual(rows, original);
});

test("identical warnings for different elements stay distinguishable", () => {
  const rows = presentDiagnosticRows([
    { level: "warning", elementId: "first", message: "Dun ontwerp" },
    { level: "warning", elementId: "second", message: "Dun ontwerp" },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].details[0], /first/);
  assert.match(rows[1].details[0], /second/);
});

test("Details and Geslaagde controles start collapsed while issues and quick fixes stay visible", () => {
  withDOM((byId) => {
    const pipeline = pipelineWith([
      { level: "ok", message: "Stempeloppervlak gecontroleerd: gesloten, consistent georiënteerde randen." },
      { level: "fixed", message: "Overlappende en zichzelf snijdende omtrekken zijn samengevoegd tot nette vormen." },
      { level: "error", code: "artwork-overflow", message: "Een deel van het ontwerp valt buiten het stempelvlak van 50 mm (of in de marge)." },
    ]);
    let fitted = null;
    createPipelineDiagnostics(pipeline, {
      getOverflowElementIds: () => ["svg-1"],
      onFitToStamp: (id) => { fitted = id; },
    });
    pipeline.dispatchEvent(new Event("result"));
    const [overflow, merged, checks] = byId("pipeline-diagnostic-list").children;
    assert.equal(overflow.children[1].children[0].textContent, "Het ontwerp valt buiten het bruikbare stempelvlak.");
    const button = overflow.children[1].children.find((child) => child.tagName === "button");
    assert.equal(button.textContent, "Op stempel laten passen");
    button.listeners.click();
    assert.equal(fitted, "svg-1");
    const details = merged.children[1].children.find((child) => child.tagName === "details");
    assert.equal(details.open, false);
    assert.equal(details.children[0].tagName, "summary");
    assert.equal(details.children[0].textContent, "Details");
    assert.match(allText(details), /zichzelf snijdende omtrekken/);
    assert.equal(checks.tagName, "details");
    assert.equal(checks.open, false);
    assert.match(checks.children[0].textContent, /^Geslaagde controles/);
    assert.match(allText(checks), /gesloten, consistent georiënteerde randen/);
  });
});

test("a narrow gap between text lines suggests more spacing", () => {
  const [row] = presentDiagnosticRows([{
    level: "warning",
    code: "narrow-gap",
    elementKind: "text",
    message: "De ruimte tussen regel 1 en regel 2 is kleiner dan ongeveer 1,2 mm.",
  }]);
  assert.equal(row.message, "De ruimte tussen regel 1 en regel 2 is kleiner dan ongeveer 1,2 mm.");
  assert.equal(row.suggestion, "Vergroot de regelafstand of de letterafstand.");
});

test("a thin-letter warning keeps its thickness suggestion", () => {
  const [row] = presentDiagnosticRows([{
    level: "warning",
    elementKind: "text",
    thinGlyphs: [{ character: "w" }],
    message: "Mogelijk te dunne letters: w (onder ongeveer 0,8 mm).",
  }]);
  assert.equal(row.suggestion, "Maak de letterdikte of de tekstgrootte groter.");
});

test("failed builds retain their cause, stage, earlier warnings and unavailable export", () => {
  withDOM((byId) => {
    const pipeline = pipelineWith([]);
    pipeline.result = null;
    pipeline.error = new Error("0 open randen en 1 niet-manifold rand");
    pipeline.diagnostics = {
      level: "error", message: "Controle van het stempeloppervlak mislukt: 0 open randen en 1 niet-manifold rand",
      stage: "final mesh validation", details: ["14 veelhoeken", "Afgewezen voordat er een voorbeeld of export is gemaakt."],
    };
    pipeline.artworkPreview = { issues: [{ level: "warning", message: "Dun ontwerp" }] };
    createPipelineDiagnostics(pipeline);
    pipeline.dispatchEvent(new Event("failed"));
    const [error, warning] = byId("pipeline-diagnostic-list").children;
    assert.equal(error.children[1].children[0].textContent, "Het stempeloppervlak kon niet veilig worden opgebouwd.");
    assert.equal(warning.children[1].children[0].textContent, "Dun ontwerp");
    assert.match(allText(error), /1 niet-manifold rand/);
    assert.match(allText(error), /Fase: eindcontrole van het oppervlak/);
    assert.match(allText(error), /14 veelhoeken/);
    assert.equal(byId("pipeline-export-status").textContent, "Niet beschikbaar");
  });
});
