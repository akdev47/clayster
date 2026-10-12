import { test } from "node:test";
import assert from "node:assert/strict";
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

const defaultTextGlyph = (character) => offsetOutline(
  layoutText(notoSansBold, { text: character, size: 7.5 }),
  0.3 / 2,
);

test("strip just below the minimum feature width is warned", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, 0.79)]]), true);
});

test("strip just above the minimum feature width is accepted", () => {
  assert.equal(hasWarning([[rectangle(0, 0, 10, 0.81)]]), false);
});

test("thin neck between thick regions is warned", () => {
  const dumbbell = [
    [
      [-5, -2],
      [-1, -2],
      [-1, -0.3],
      [1, -0.3],
      [1, -2],
      [5, -2],
      [5, 2],
      [1, 2],
      [1, 0.3],
      [-1, 0.3],
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
      [3, -0.3],
      [6, -0.3],
      [6, 0.3],
      [3, 0.3],
      [3, 3],
      [-3, 3],
    ],
  ];

  assert.equal(hasWarning([armed]), true);
});

test("thin wall between a hole and outer contour is warned", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 4.4);

  assert.equal(hasWarning([[outer, hole]]), true);
});

test("safe wall between a hole and outer contour is accepted", () => {
  const outer = rectangle(-5, -5, 5, 5);
  const hole = rectangle(-3, -3, 3, 4);

  assert.equal(hasWarning([[outer, hole]]), false);
});

test("only the thin polygon in multiple artwork polygons is counted", () => {
  const issues = thinFeatureIssues([
    [rectangle(0, 0, 4, 4)],
    [rectangle(6, 0, 12, 0.6)],
  ]);

  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /^1 shape looks thinner/i);
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

  assert.equal(hasWarning([[outer, circle(9.21)]]), true);
  assert.equal(hasWarning([[outer, circle(9.19)]]), false);
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
    assert.equal(hasWarning(transform(glyph, { scale: 0.5 })), true);
  }
});

const artwork = [
  [
    [
      [-10, -0.5],
      [10, -0.5],
      [10, 0.5],
      [-10, 0.5],
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
  assert.match(issues[0].message, /thinner than about 0\.8 mm/i);
});

test("fixed face sizing preserves safe feature widths without rescaling artwork", () => {
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
  const polygon = [rectangle(0, 0, 5, 0.6)];
  const glyph = { elementId: "text", character: "a", line: 2, column: 3, canonical: [polygon] };
  const named = thinFeatureIssues([polygon], { textGlyphs: [glyph] });
  assert.equal(named[0].message, "Potentially thin letters: a (below approximately 0.8 mm).");
  assert.match(named[0].details[0], /line 2, character 3/);
  assert.equal(named[0].thinGlyphs[0], glyph);

  for (const other of [
    { ...glyph, character: "b", column: 4 },
    { character: null, canonical: [polygon] },
  ]) {
    const issues = thinFeatureIssues([polygon], { textGlyphs: [glyph, other] });
    assert.match(issues[0].message, /^1 shape looks thinner/);
    assert.equal(issues.length, 1);
  }
  const elsewhere = { ...glyph, canonical: [[rectangle(10, 10, 15, 10.6)]] };
  assert.match(thinFeatureIssues([polygon], { textGlyphs: [elsewhere] })[0].message,
    /^1 shape looks thinner/);
});
