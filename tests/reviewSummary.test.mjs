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
    "Tekstelementen": "1",
    "Afbeeldingen / logo's": "logo.svg",
    "Afmetingen stempel": "60 × 40 mm",
    "Vorm": "Vierkant",
    "Afgeronde randen": DEFAULT_STAMP.roundedEdges ? "Aan" : "Uit",
    "Afgeronde hoeken": "Uit",
    "Basisdikte": "3 mm",
    "Reliëf": "Verdiept · 1,5 mm",
    "Ontwerp gespiegeld": "Uit",
  });
  assert.equal(
    reviewSummary(model, { ...stamp, faceShape: "minimal" }, "60 × 40 mm")
      .find(([label]) => label === "Vorm")[1],
    "Minimaal",
  );
  const label = (shape, roundedCorners) =>
    Object.fromEntries(reviewSummary(model, { ...stamp, faceShape: shape, roundedCorners }, "60 × 40 mm"))["Afgeronde hoeken"];
  assert.equal(label("square", true), "Aan");
  assert.equal(label("minimal", true), "Aan");
  assert.equal(label("minimal", false), "Uit");
  assert.equal(label("round", true), undefined, "a round plate has no corners to round");

  const edges = (roundedEdges) =>
    Object.fromEntries(reviewSummary(model, { ...stamp, faceShape: "round", roundedEdges }, "60 × 40 mm"))["Afgeronde randen"];
  assert.equal(edges(true), "Aan");
  assert.equal(edges(false), "Uit");
  assert.equal(
    edges(undefined),
    DEFAULT_STAMP.roundedEdges ? "Aan" : "Uit",
    "a design saved before the option gets the same as a new one",
  );
});
