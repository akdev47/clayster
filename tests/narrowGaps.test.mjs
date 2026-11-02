import { test } from "node:test";
import { formatNumber } from "../src/stamp_generator/static/stamp_generator/js/locale.js";
import assert from "node:assert/strict";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { narrowGapIssues } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();

// Gaps in these tests are relative to the clear-gap limit in settings.js, so the
// tests keep working when that limit is tweaked.
const GAP = SETTINGS.checks.clearGapMm;

const fontBytes = readFileSync(
  new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const notoSansBold = opentype.parse(fontBytes.buffer.slice(
  fontBytes.byteOffset,
  fontBytes.byteOffset + fontBytes.byteLength,
));

const rectangle = (minX, minY, maxX, maxY) => [[
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
]];

const bars = (gap) => [
  rectangle(0, 0, 10, 4),
  rectangle(0, 4 + gap, 10, 8 + gap),
];

const circle = (radius, segments = 128) =>
  Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });

const ring = (outerRadius, holeRadius) => [[circle(outerRadius), circle(holeRadius)]];

const generic = (issues) => issues.find(({ message }) => /dichtlopen bij het stempelen in klei/.test(message));
const named = (issues) => issues.find(({ message }) => /ruimte tussen regel/.test(message));

const laidOut = (lineSpacing) => {
  const glyphOutlines = [];
  const canonical = layoutText(notoSansBold, {
    text: "I\nI",
    size: 7.5,
    lineSpacing,
    glyphOutlines,
  });
  for (const glyph of glyphOutlines) glyph.elementId = "text";
  return { canonical, glyphOutlines };
};

test("bars clearly wider apart than the clear gap do not warn", () => {
  assert.deepEqual(narrowGapIssues(bars(GAP + 0.8)), []);
});

test("bars well inside the clear gap warn", () => {
  const issues = narrowGapIssues(bars(GAP / 2));
  assert.equal(issues.length, 1);
  assert.ok(issues[0].message.includes(`smaller dan ongeveer ${formatNumber(GAP)} mm`));
});

test("a hole well inside the clear gap warns and a wide hole does not", () => {
  const tight = narrowGapIssues(ring(2, GAP / 6));
  assert.equal(tight.length, 1);
  assert.ok(tight[0].message.includes(`smaller dan ongeveer ${formatNumber(GAP)} mm`));

  assert.deepEqual(narrowGapIssues(ring(GAP + 2, (GAP + 0.8) / 2)), []);
});

test("a sharp V does not warn", () => {
  const vee = [[
    [0, 0],
    [1, 0],
    [3, 8],
    [5, 0],
    [6, 0],
    [3, 10],
  ]];
  assert.deepEqual(narrowGapIssues(vee), []);
});

test("close text lines name the lines, and ordinary line spacing does not", () => {
  const comfortable = laidOut(1.25);
  assert.deepEqual(narrowGapIssues(comfortable.canonical, {
    textGlyphs: comfortable.glyphOutlines,
  }), []);

  const tight = laidOut(0.72);
  const issues = narrowGapIssues(tight.canonical, { textGlyphs: tight.glyphOutlines });
  assert.ok(named(issues).message.includes(`ruimte tussen regel 1 en regel 2 is kleiner dan ongeveer ${formatNumber(GAP)} mm`));
  assert.equal(named(issues).elementId, "text");
  assert.equal(named(issues).elementKind, "text");
  assert.equal(generic(issues), undefined);
});
