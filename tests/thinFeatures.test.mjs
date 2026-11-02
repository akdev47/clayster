import { test } from "node:test";
import { formatNumber } from "../src/stamp_generator/static/stamp_generator/js/locale.js";
import assert from "node:assert/strict";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { DEFAULT_STAMP, fitToFace } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { thinFeatureIssues } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { initializeSolids, offsetOutline } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();

const fontBytes = readFileSync(
  new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const notoSansBold = opentype.parse(fontBytes.buffer.slice(
  fontBytes.byteOffset,
  fontBytes.byteOffset + fontBytes.byteLength,
));

const rectangle = (minX, minY, maxX, maxY) => [
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
];

const circle = (radius, segments = 128) =>
  Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });

const hasWarning = (input) => thinFeatureIssues(input).length === 1;

// Widths in these tests are relative to the thin-details limit in settings.js,
// so the tests keep working when that limit is tweaked.
const MIN = SETTINGS.checks.thinFeatureMm;
const THIN = MIN * 0.75; // clearly too thin (0.6 mm at the shipped 0.8 mm)
const SAFE = MIN * 1.25; // clearly thick enough (1 mm at the shipped 0.8 mm)

const defaultTextGlyph = (character) => offsetOutline(
  layoutText(notoSansBold, { text: character, size: 7.5 }),
  0.3 / 2,
);

test("strip just below the minimum feature width is warned", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, MIN - 0.01)]]), true);
});

test("strip just above the minimum feature width is accepted", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, MIN + 0.01)]]), false);
});

test("thin neck between thick regions is warned", () => {
  const dumbbell = [
    [
      [-5, -2],
      [-1, -2],
      [-1, -THIN / 2],
      [1, -THIN / 2],
      [1, -2],
      [5, -2],
      [5, 2],
      [1, 2],
      [1, THIN / 2],
      [-1, THIN / 2],
      [-1, 2],
      [-5, 2],
    ],
  ];

  assert.equal(hasWarning([dumbbell]), true);
});

test("narrow protruding arm is warned", () => {
  const armed = [
    [
      [-3, -3],
      [3, -3],
      [3, -THIN / 2],
      [6, -THIN / 2],
      [6, THIN / 2],
      [3, THIN / 2],
      [3, 3],
      [-3, 3],
    ],
  ];

  assert.equal(hasWarning([armed]), true);
});

test("thin wall between a hole and outer contour is warned", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 5 - THIN);

  assert.equal(hasWarning([[outer, hole]]), true);
});

test("safe wall between a hole and outer contour is accepted", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 5 - SAFE);

  assert.equal(hasWarning([[outer, hole]]), false);
});

test("only the thin polygon in multiple artwork polygons is counted", () => {
  const issues = thinFeatureIssues([
    [rectangle(0, 0, 4, 4)],
    [rectangle(6, 0, 12, THIN)],
  ]);

  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /^1 vorm lijkt dunner/i);
});

test("sharp valid corners are accepted", () => {
  const triangle = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];

  assert.equal(hasWarning([[triangle]]), false);
});

test("curved donut walls are checked near the threshold", () => {
  const outer = circle(10);

  assert.equal(hasWarning([[outer, circle(10 - (MIN - 0.01))]]), true);
  assert.equal(hasWarning([[outer, circle(10 - (MIN + 0.01))]]), false);
});

test("reversed winding and redundant points do not change the result", () => {
  const redundant = [
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ].reverse();

  assert.equal(hasWarning([[redundant]]), false);
});

test("acute Noto Sans Bold glyph joins are not mistaken for thin features", () => {
  for (const character of ["A", "M", "W", "w"]) {
    assert.deepEqual(
      thinFeatureIssues(defaultTextGlyph(character)),
      [],
      `${character} should be printable at the default text settings.`,
    );
  }
});

test("Noto Sans Bold glyph result is stable under rigid transforms and detects real scaling", () => {
  for (const character of ["A", "M", "W", "w"]) {
    const glyph = defaultTextGlyph(character);
    for (const transformed of [
      transform(glyph, { x: 3, y: -2 }),
      transform(glyph, { rotation: 37 }),
      transform(glyph, { mirrorX: true }),
      transform(glyph, { mirrorY: true }),
    ]) {
      assert.deepEqual(thinFeatureIssues(transformed), []);
    }
    assert.equal(hasWarning(transform(glyph, { scale: MIN / 2 })), true);
  }
});

const artwork = [
  [
    [
      [-10, -SAFE / 2],
      [10, -SAFE / 2],
      [10, SAFE / 2],
      [-10, SAFE / 2],
    ],
  ],
];

const fit = (faceSize) =>
  fitToFace(
    artwork,
    {
      ...DEFAULT_STAMP,
      faceShape: "square",
      autoFaceSize: false,
      faceSize,
      margin: 1,
    },
    [],
  ).art;

test("artwork that becomes too thin after element scaling is warned in final layout", () => {
  assert.deepEqual(thinFeatureIssues(artwork), []);

  const scaled = transform(artwork, { scale: 0.5 });
  const final = fitToFace(scaled, {
    ...DEFAULT_STAMP, faceShape: "square", faceSize: 20, autoFaceSize: false,
  }).art;
  const issues = thinFeatureIssues(final);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].message.includes(`dunner dan ongeveer ${formatNumber(MIN)} mm`));
});

test("automatic backing preserves safe widths, including legacy fixed-face settings", () => {
  assert.deepEqual(fit(10), artwork);
  assert.deepEqual(thinFeatureIssues(fit(10)), []);
  assert.deepEqual(thinFeatureIssues(fit(20)), []);
});

test("artwork requiring no fitting stays unchanged", () => {
  const fitted = fit(24);

  assert.deepEqual(fitted, artwork);
  assert.deepEqual(thinFeatureIssues(fitted), []);
});

test("thin glyph attribution uses geometry and retains generic warnings for ambiguous ownership", () => {
  const polygon = [rectangle(0, 0, 5, THIN)];
  const glyph = { elementId: "text", character: "a", line: 2, column: 3, canonical: [polygon] };
  const named = thinFeatureIssues([polygon], { textGlyphs: [glyph] });
  assert.equal(named[0].message, `Mogelijk te dunne letters: a (onder ongeveer ${formatNumber(MIN)} mm).`);
  assert.match(named[0].details[0], /regel 2, teken 3/);
  assert.equal(named[0].thinGlyphs[0], glyph);

  for (const other of [
    { ...glyph, character: "b", column: 4 },
    { character: null, canonical: [polygon] },
  ]) {
    const issues = thinFeatureIssues([polygon], { textGlyphs: [glyph, other] });
    assert.match(issues[0].message, /^1 vorm lijkt dunner/);
    assert.equal(issues.length, 1);
  }
  const elsewhere = { ...glyph, canonical: [[rectangle(10, 10, 15, 10 + THIN)]] };
  assert.match(thinFeatureIssues([polygon], { textGlyphs: [elsewhere] })[0].message,
    /^1 vorm lijkt dunner/);
});
