import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { narrowGapIssues } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();

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

const generic = (issues) => issues.find(({ message }) => /may fill in when stamped in clay/.test(message));
const named = (issues) => issues.find(({ message }) => /space between line/.test(message));

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

test("bars 2 mm apart do not warn", () => {
  assert.deepEqual(narrowGapIssues(bars(2)), []);
});

test("bars 0.5 mm apart warn", () => {
  const issues = narrowGapIssues(bars(0.5));
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /narrower than about 1\.2 mm/);
});

test("a 0.4 mm hole warns and a 2 mm hole does not", () => {
  const tight = narrowGapIssues(ring(2, 0.2));
  assert.equal(tight.length, 1);
  assert.match(tight[0].message, /narrower than about 1\.2 mm/);

  assert.deepEqual(narrowGapIssues(ring(3, 1)), []);
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
  assert.match(named(issues).message, /space between line 1 and line 2 is under about 1\.2 mm/);
  assert.equal(named(issues).elementId, "text");
  assert.equal(named(issues).elementKind, "text");
  assert.equal(generic(issues), undefined);
});
