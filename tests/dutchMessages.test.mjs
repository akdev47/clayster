import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import {
  narrowGapIssues,
  overflowIssue,
  thinFeatureIssues,
  validate,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { presentDiagnosticRows } from "../src/stamp_generator/static/stamp_generator/js/pipelineDiagnostics.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";

// The page shows what the pipeline reports in its own words, and
// presentDiagnosticRows() recognises those messages by their text. These tests
// run the real checks and push what they say through the presenter, so a message
// that is reworded in one place and not the other shows up here instead of as a
// raw, unexplained line in the Printability panel.

await initializeSolids();

const rectangle = (minX, minY, maxX, maxY) => [[
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
]];
const shown = (issue) => presentDiagnosticRows([issue])[0];

test("the checks on the artwork are recognised and explained", () => {
  // Nothing to print.
  const empty = validate([]).issues[0];
  assert.equal(empty.level, "error");
  assert.equal(shown(empty).message, "Geen gevuld ontwerp gevonden. Gebruik gesloten, gevulde vormen.");

  // Overlapping shapes are merged.
  const merged = validate([rectangle(0, 0, 10, 10), rectangle(5, 0, 15, 10)]).issues
    .find(({ level }) => level === "fixed");
  assert.equal(shown(merged).message, "Overlappende omtrekken zijn opgeschoond.");
  assert.equal(shown(merged).details.includes(merged.message), true, "the full text stays available");

  // Two squares that only touch at a corner.
  const separated = validate(
    [rectangle(0, 0, 4, 4), rectangle(4, 4, 8, 8)],
    { tolerance: 0 },
  ).issues.find(({ level }) => level === "fixed");
  assert.equal(shown(separated).message, "Rakende omtrekken zijn gescheiden voor het printen.");

  // Outlines that cannot be repaired, either way it can fail.
  const ambiguous = validate([
    [[[0, 0], [4, 0], [2, 2]]],
    [[[0, 0], [-2, 2], [-4, 0]]],
    [[[0, 0], [-2, -2], [2, -2]]],
  ], { tolerance: 0 }).issues.find(({ level }) => level === "error");
  const unrepairable = validate([[[[ "0", "0"], ["10", "0"], ["10", "10"]]]]).issues
    .find(({ level }) => level === "error");
  for (const issue of [ambiguous, unrepairable]) {
    assert.equal(
      shown(issue).message,
      "Sommige omtrekken moeten worden aangepast voordat ze geprint kunnen worden.",
    );
  }
});

test("thin shapes, narrow gaps and overflow are recognised and come with advice", () => {
  const thin = thinFeatureIssues([rectangle(0, 0, 10, SETTINGS.checks.thinFeatureMm / 2)])[0];
  assert.equal(shown(thin).message, "Sommige details van het ontwerp zijn mogelijk te dun om te printen.");
  assert.equal(shown(thin).suggestion, "Maak het ontwerp groter of dikker.");

  const glyph = (line, canonical) => ({ elementId: "text", line, column: 1, character: "I", canonical });
  const upper = rectangle(0, 5.5, 10, 10);
  const lower = rectangle(0, 0, 10, 5);
  const gap = narrowGapIssues(
    [lower, upper],
    { textGlyphs: [glyph(1, [lower]), glyph(2, [upper])] },
  ).find(({ message }) => /regel 1 en regel 2/.test(message));
  assert.ok(gap, "the lines are reported");
  assert.equal(shown(gap).suggestion, "Vergroot de regelafstand of de letterafstand.");

  const strip = rectangle(0, 0, 10, SETTINGS.checks.thinFeatureMm / 2);
  const letters = thinFeatureIssues([strip], { textGlyphs: [glyph(1, [strip])] }).find(({ thinGlyphs }) => thinGlyphs?.length);
  assert.ok(letters, "the thin letter is named");
  assert.match(shown(letters).message, /^Mogelijk te dunne letters: I\.$/);
  assert.equal(shown(letters).suggestion, "Maak de letterdikte of de tekstgrootte groter.");

  const overflow = overflowIssue({ overflows: true, widthMm: 20, heightMm: 20 });
  assert.equal(shown(overflow).message, "Het ontwerp valt buiten het bruikbare stempelvlak.");
});

test("every step that can fail names itself in words the page strips again", () => {
  const stages = [
    "element conversion",
    "SVG loading",
    "stamp preparation",
    "stamp generation",
    "final mesh validation",
    "something else",
  ];
  for (const designModel of [null, new DesignModel()]) {
    for (const stage of stages) {
      const pipeline = new Pipeline({ designModel });
      pipeline.diagnostics = { level: "working", message: "", details: [], stage };
      pipeline.failSVGDiagnostics(new Error("het ging mis"));
      const failure = pipeline.diagnostics;
      assert.equal(failure.level, "error");
      assert.match(failure.message, /^[^:]+: het ging mis$/, `${stage} gets a heading`);
      assert.equal(
        shown({ level: "error", message: failure.message }).message,
        "het ging mis",
        `the heading for "${stage}" is removed again`,
      );
      assert.ok(failure.details.some((detail) => detail.startsWith("Fase: ")));
      assert.ok(!failure.details.some((detail) => /Stage|Rejected/.test(detail)));
    }
  }
});

test("the note that the finished stamp was checked is shortened by the page", async () => {
  const font = new File(
    [readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url))],
    "NotoSans-Bold.ttf",
  );
  const model = new DesignModel({ elements: [{
    id: "label",
    kind: "text",
    source: { text: "CLAY", font: { reference: font }, fontSizeMm: 12 },
  }] });
  const pipeline = new Pipeline({ designModel: model });
  try {
    await pipeline.run();
    assert.equal(pipeline.error, null);
    const [note] = pipeline.result.notes;
    assert.match(note, /^Stempeloppervlak gecontroleerd:/);
    assert.equal(
      shown({ level: "ok", badge: "Gecontroleerd", message: note }).message,
      "Stempeloppervlak gecontroleerd.",
    );
    assert.equal(
      shown({ level: "ok", message: pipeline.diagnostics.message }).message,
      "Controles van het ontwerp geslaagd.",
    );
  } finally {
    clearTimeout(pipeline.timer);
    pipeline.result?.stamp?.dispose();
    pipeline.result?.clay?.dispose();
  }
});
