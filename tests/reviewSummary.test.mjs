import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAMP } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { reviewSummary } from "../src/stamp_generator/static/stamp_generator/js/reviewSummary.js";

test("review summary uses live visible elements and stamp settings", () => {
  const model = {
    elements: [
      { kind: "text", visible: true, source: { text: "CLAYSTER" } },
      { kind: "text", visible: false, source: { text: "HIDDEN" } },
      { kind: "svg", visible: true, source: { reference: { name: "logo.svg" } } },
    ],
  };
  const stamp = {
    faceShape: "square",
    faceThickness: 3,
    reliefDepth: 1.5,
    mode: "deboss",
    mirror: false,
  };

  assert.deepEqual(Object.fromEntries(reviewSummary(model, stamp, "60 × 40 mm")), {
    "Text elements": "1",
    "Images / logos": "logo.svg",
    "Stamp dimensions": "60 × 40 mm",
    "Face shape": "Square",
    "Rounded edges": DEFAULT_STAMP.roundedEdges ? "Enabled" : "Disabled",
    "Rounded corners": "Disabled",
    "Base thickness": "3 mm",
    Relief: "Recessed · 1.5 mm",
    "Mirror design": "Disabled",
  });
  assert.equal(
    reviewSummary(model, { ...stamp, faceShape: "minimal" }, "60 × 40 mm")
      .find(([label]) => label === "Face shape")[1],
    "Minimal",
  );
  const label = (shape, roundedCorners) =>
    Object.fromEntries(reviewSummary(model, { ...stamp, faceShape: shape, roundedCorners }, "60 × 40 mm"))["Rounded corners"];
  assert.equal(label("square", true), "Enabled");
  assert.equal(label("minimal", true), "Enabled");
  assert.equal(label("minimal", false), "Disabled");
  assert.equal(label("round", true), undefined, "a round plate has no corners to round");

  const edges = (roundedEdges) =>
    Object.fromEntries(reviewSummary(model, { ...stamp, faceShape: "round", roundedEdges }, "60 × 40 mm"))["Rounded edges"];
  assert.equal(edges(true), "Enabled");
  assert.equal(edges(false), "Disabled");
  assert.equal(
    edges(undefined),
    DEFAULT_STAMP.roundedEdges ? "Enabled" : "Disabled",
    "a design saved before the option gets the same as a new one",
  );
});
