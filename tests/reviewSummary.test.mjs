import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewSummary } from "../src/reviewSummary.js";

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
    "Base thickness": "3 mm",
    Relief: "Recessed · 1.5 mm",
    "Mirror design": "Disabled",
  });
});
