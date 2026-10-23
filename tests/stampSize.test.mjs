import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { stampSizeIssue } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { exportable } from "../src/stamp_generator/static/stamp_generator/js/pipelineControls.js";
import { presentDiagnosticRows } from "../src/stamp_generator/static/stamp_generator/js/pipelineDiagnostics.js";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";

await initializeSolids();

const { maxWidthMm, maxLengthMm } = SETTINGS.stamp;
const bytes = readFileSync(
  new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const artwork = (text, size) => validate(layoutText(font, { text, size })).artwork;
const dispose = (built) => {
  built.stamp.dispose();
  built.clay.dispose();
};

test("a stamp up to the maximum is fine, one over it is an error that names both sizes", () => {
  assert.equal(stampSizeIssue(maxWidthMm, maxLengthMm), null);
  assert.equal(stampSizeIssue(maxWidthMm + 0.004, maxLengthMm - 0.004), null, "compared to 0.01 mm");
  assert.equal(stampSizeIssue(10, 10), null);

  for (const [width, length] of [
    [maxWidthMm + 0.02, 50],
    [50, maxLengthMm + 0.02],
    [maxWidthMm + 30.5, maxLengthMm + 30.5],
  ]) {
    const issue = stampSizeIssue(width, length);
    assert.equal(issue.level, "error", `${width} x ${length}`);
    assert.equal(issue.code, "stamp-too-large");
    assert.ok(
      issue.message.includes(`${maxWidthMm} × ${maxLengthMm} mm`),
      "names the largest stamp",
    );
    assert.match(issue.message, /would be \d/, "names the size it would have");
  }
  assert.match(
    stampSizeIssue(230.46, 60.04).message,
    /would be 230\.5 × 60 mm/,
    "sizes are shown with one decimal",
  );
});

test("a normal stamp has no size error", () => {
  const built = buildStamp(artwork("CLAY", 16), { faceShape: "round" });
  try {
    assert.ok(!built.thinIssues.some(({ code }) => code === "stamp-too-large"));
  } finally {
    dispose(built);
  }
});

test("a Minimal stamp that grows past the maximum reports the error and cannot be exported", () => {
  // 100 mm letters make a plate far wider than the maximum.
  const built = buildStamp(artwork("CLAYSTER", 100), { faceShape: "minimal" });
  try {
    const issue = built.thinIssues.find(({ code }) => code === "stamp-too-large");
    assert.ok(issue, "the oversized plate is reported");
    assert.equal(issue.level, "error");
    assert.ok(built.layout.widthMm > maxWidthMm);
    // The size in the message is the size of the plate, which is what is exported.
    assert.ok(Math.abs(built.info.width - built.layout.widthMm) < 1e-3);

    // Errors block export and ordering, the same as for overflowing artwork.
    const pipeline = { busy: false, result: { stamp: built.stamp, issues: built.thinIssues } };
    assert.throws(() => exportable({}, pipeline), /Fix the design errors/);
  } finally {
    dispose(built);
  }
});

test("making the design smaller clears the error", () => {
  const big = buildStamp(artwork("CLAYSTER", 100), { faceShape: "minimal" });
  const small = buildStamp(artwork("CLAYSTER", 20), { faceShape: "minimal" });
  try {
    assert.ok(big.thinIssues.some(({ code }) => code === "stamp-too-large"));
    assert.ok(!small.thinIssues.some(({ code }) => code === "stamp-too-large"));
    assert.ok(small.layout.widthMm <= maxWidthMm);
  } finally {
    dispose(big);
    dispose(small);
  }
});

test("the diagnostics panel shows the size error as it is written, first in the list", () => {
  const issue = stampSizeIssue(230.5, 60);
  const rows = presentDiagnosticRows([
    { level: "warning", message: "Some artwork details may be too thin to print." },
    issue,
  ]);
  assert.equal(rows[0].level, "error", "errors come first");
  assert.equal(rows[0].message, issue.message, "not shortened or reworded");
});
