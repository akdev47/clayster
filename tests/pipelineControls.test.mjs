import { test } from "node:test";
import assert from "node:assert/strict";
import { exportable } from "../src/stamp_generator/static/stamp_generator/js/pipelineControls.js";

test("blocking pipeline issues prevent STL export even when geometry exists", () => {
  const stamp = {};
  const viewer = { stampMesh: { material: { color: "clay" } } };
  const pipeline = {
    busy: false,
    diagnostics: { level: "ok" },
    result: {
      stamp,
      issues: [{ level: "error", code: "artwork-overflow" }],
    },
  };

  assert.throws(
    () => exportable(viewer, pipeline),
    /Fix the design errors before exporting/,
  );

  pipeline.result.issues = [];
  assert.equal(exportable(viewer, pipeline)[0].geometry, stamp);
});
