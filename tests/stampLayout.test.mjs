import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import * as THREE from "three";
import { bounds, transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { DEFAULT_STAMP, buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import {
  createStampLayout,
  layoutRenderElements,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { canonicalSvgScene } from "../src/stamp_generator/static/stamp_generator/js/canonicalSvgRenderer.js";
import { createDesignElement } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { textLetterSpacingMm } from "../src/stamp_generator/static/stamp_generator/js/pipeline/artworkComposition.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();

const bytes = readFileSync(
  new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const rectangle = (minX, minY, maxX, maxY) => [[[
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
]]];
const settings = (patch = {}) => ({
  ...DEFAULT_STAMP,
  mirror: false,
  handle: "none",
  ...patch,
});

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}.`,
  );
}

function matchingTextLayout(text, alignment) {
  const canonical = layoutText(font, {
    text,
    size: 16,
    lineSpacing: 1.25,
    align: alignment,
  });
  const element = {
    id: "text-1",
    kind: "text",
    canonical,
    transform: {},
  };
  const layout = createStampLayout(
    canonical,
    settings({ faceShape: "square" }),
  );
  const displayed = layoutRenderElements(
    [element],
    layout.artworkTransform,
  );

  assert.deepEqual(displayed[0].canonical, layout.artwork);
  return { canonical, layout, displayed };
}

test("rectangular face outline and 3D square face match", () => {
  const built = buildStamp(
    rectangle(-8, -4, 8, 4),
    settings({ faceShape: "square", autoFaceSize: false, faceSize: 40 }),
  );

  try {
    const scene = canonicalSvgScene(
      [{ id: "design", kind: "design", canonical: built.layout.artwork }],
      built.layout,
      { face: built.layout.face },
    );
    built.stamp.computeBoundingBox();
    const meshSize = built.stamp.boundingBox.getSize(new THREE.Vector3());

    assert.equal(scene.viewBox, "-20 -20 40 40");
    assert.equal(scene.facePaths[0].d, "M -20 20 L 20 20 L 20 -20 L -20 -20 Z");
    assertClose(meshSize.x, 40);
    assertClose(meshSize.y, 40);
  } finally {
    built.stamp.dispose();
    built.clay.dispose();
  }
});

test("automatic 2D and 3D face dimensions share millimetre authority", () => {
  const layout = createStampLayout(
    rectangle(5, -3, 15, 3),
    settings({ faceShape: "square", autoFaceSize: true, margin: 3 }),
  );

  assert.equal(layout.faceSize, 36);
  assert.equal(layout.widthMm, 36);
  assert.equal(layout.heightMm, 36);
  assert.equal(canonicalSvgScene([], layout, { face: layout.face }).viewBox, "-18 -18 36 36");
});

test("centered text uses the same final layout in 2D and 3D", () => {
  matchingTextLayout("CLAY", "center");
});

test("single-line alignment does not reposition the text element", () => {
  const left = matchingTextLayout("CLAY", "left").canonical;
  const center = matchingTextLayout("CLAY", "center").canonical;
  const right = matchingTextLayout("CLAY", "right").canonical;

  assert.deepEqual(left, center);
  assert.deepEqual(right, center);
});

test("translated element retains the same physical position in both views", () => {
  const local = rectangle(-2, -1, 2, 1);
  const element = {
    id: "svg-1",
    kind: "svg",
    canonical: local,
    transform: { xMm: 8, yMm: -5 },
  };
  const composed = transform(local, element.transform);
  const layout = createStampLayout(
    composed,
    settings({ faceShape: "square", autoFaceSize: false, faceSize: 40 }),
  );
  const displayed = layoutRenderElements([element], layout.artworkTransform);
  const box = bounds(displayed[0].canonical);

  assert.deepEqual(displayed[0].canonical, layout.artwork);
  assert.equal((box.minX + box.maxX) / 2, 8);
  assert.equal((box.minY + box.maxY) / 2, -5);
});

test("multiline alignment moves shorter lines inside a fixed text element", () => {
  const left = matchingTextLayout("CLAY\nI", "left").canonical;
  const center = matchingTextLayout("CLAY\nI", "center").canonical;
  const right = matchingTextLayout("CLAY\nI", "right").canonical;
  const wideLine = (canonical) =>
    canonical.filter((polygon) => bounds([polygon]).maxY >= -4);
  const shortLineBounds = (canonical) =>
    bounds(
      canonical.filter(
        (polygon) => bounds([polygon]).maxY < -4,
      ),
    );

  assert.deepEqual(wideLine(left), wideLine(center));
  assert.deepEqual(wideLine(right), wideLine(center));
  assert.ok(shortLineBounds(left).minX < shortLineBounds(center).minX);
  assert.ok(shortLineBounds(center).minX < shortLineBounds(right).minX);
});

test("doubling Text size doubles relative letter spacing", () => {
  const sourceAt = (fontSizeMm) => createDesignElement({
    kind: "text",
    source: {
      text: "II",
      fontSizeMm,
      letterSpacingRatio: 0.2,
    },
  }).source;
  const small = sourceAt(10);
  const large = sourceAt(20);
  const smallGeometry = layoutText(font, {
    text: small.text,
    size: small.fontSizeMm,
    letterSpacing: textLetterSpacingMm(small),
  });
  const largeGeometry = layoutText(font, {
    text: large.text,
    size: large.fontSizeMm,
    letterSpacing: textLetterSpacingMm(large),
  });

  assert.equal(textLetterSpacingMm(small), 2);
  assert.equal(textLetterSpacingMm(large), 4);
  assertClose(bounds(largeGeometry).width, bounds(smallGeometry).width * 2);
});

test("doubling Text size doubles relative multiline spacing", () => {
  const small = layoutText(font, {
    text: "I\nI",
    size: 10,
    lineSpacing: 1.5,
  });
  const large = layoutText(font, {
    text: "I\nI",
    size: 20,
    lineSpacing: 1.5,
  });

  assertClose(bounds(large).height, bounds(small).height * 2);
});

test("glyph diagnostic metadata leaves text geometry unchanged and includes detached dots", () => {
  const glyphOutlines = [];
  const options = { text: "ai\na", size: 7.5, letterSpacing: 1, align: "right" };
  const canonical = layoutText(font, options);
  assert.deepEqual(layoutText(font, { ...options, glyphOutlines }), canonical);
  assert.deepEqual(glyphOutlines.map(({ character, line, column }) =>
    ({ character, line, column })), [
    { character: "a", line: 1, column: 1 },
    { character: "i", line: 1, column: 2 },
    { character: "a", line: 2, column: 1 },
  ]);
  assert.equal(glyphOutlines[1].canonical.length, 2);
});

test("glyph substitutions without a reliable character mapping remain unattributed", () => {
  const shapedFont = Object.create(font);
  shapedFont.stringToGlyphs = (text) => text === "fi"
    ? font.stringToGlyphs("i")
    : font.stringToGlyphs(text);
  const glyphOutlines = [];
  const options = { text: "fi", size: 7.5 };
  assert.deepEqual(
    layoutText(shapedFont, { ...options, glyphOutlines }),
    layoutText(shapedFont, options),
  );
  assert.equal(glyphOutlines[0].character, null);
});

test("minimal face hugs artwork and ignores a pure translation", () => {
  const layout = createStampLayout(
    rectangle(5, -3, 15, 3),
    settings({ faceShape: "minimal", margin: 3 }),
  );

  assert.equal(layout.widthMm, 16);
  assert.equal(layout.heightMm, 12);
  assert.equal(layout.minX, 2);
  assert.equal(layout.minY, -6);
  assert.equal(layout.faceSize, 16);
  assert.equal(layout.overflows, false);

  const moved = createStampLayout(
    rectangle(25, -3, 35, 3),
    settings({ faceShape: "minimal", margin: 3 }),
  );
  assert.equal(moved.widthMm, layout.widthMm);
  assert.equal(moved.heightMm, layout.heightMm);
  assert.equal(moved.minX, 22);
  assert.equal(moved.minY, layout.minY);
});

test("minimal face grows only on the sides the artwork grows", () => {
  const short = createStampLayout(
    rectangle(5, -3, 15, 3),
    settings({ faceShape: "minimal", margin: 3 }),
  );
  const tall = createStampLayout(
    rectangle(5, -8, 15, 8),
    settings({ faceShape: "minimal", margin: 3 }),
  );

  assert.equal(tall.widthMm, short.widthMm);
  assert.equal(tall.heightMm, 22);
});

test("minimal face includes every element and shrinks when an outer one is removed", () => {
  const left = rectangle(-22, -5, -12, 5);
  const right = rectangle(15, -3, 25, 4);
  const inside = rectangle(-10, -2, -8, 2);
  const options = settings({ faceShape: "minimal", margin: 2 });
  const both = createStampLayout([...left, ...right], options);
  const withInside = createStampLayout([...left, ...right, ...inside], options);
  const onlyLeft = createStampLayout(left, options);

  assert.equal(both.minX, -24);
  assert.equal(both.widthMm, 51);
  assert.equal(both.minY, -7);
  assert.equal(both.heightMm, 14);
  assert.equal(withInside.widthMm, both.widthMm);
  assert.equal(withInside.heightMm, both.heightMm);
  assert.equal(onlyLeft.widthMm, 14);
  assert.ok(onlyLeft.widthMm < both.widthMm);
});

test("minimal 3D plate matches the tight rectangle, including an off-center design", () => {
  const built = buildStamp(
    rectangle(5, -3, 15, 3),
    settings({ faceShape: "minimal", margin: 3 }),
  );

  try {
    built.stamp.computeBoundingBox();
    const box = built.stamp.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    assertClose(size.x, 16);
    assertClose(size.y, 12);
    assertClose((box.min.x + box.max.x) / 2, 10);
    assertClose((box.min.y + box.max.y) / 2, 0);
  } finally {
    built.stamp.dispose();
    built.clay.dispose();
  }
});

test("a fixed face keeps its size and reports artwork that sticks out", () => {
  const local = rectangle(-10, -2, 10, 2);
  const element = {
    id: "png-1",
    kind: "png",
    canonical: local,
    transform: { xMm: 5, yMm: 0 },
  };
  const composed = transform(local, element.transform);
  const layout = createStampLayout(
    composed,
    settings({
      faceShape: "square",
      autoFaceSize: false,
      faceSize: 20,
      margin: 2,
    }),
  );
  const displayed = layoutRenderElements([element], layout.artworkTransform);

  assert.equal(layout.artworkTransform.scale, 1);
  assert.deepEqual(displayed[0].canonical, layout.artwork);
  assert.deepEqual(bounds(displayed[0].canonical), bounds(composed));
  assert.equal(layout.faceSize, 20);
  assert.equal(layout.overflows, true);
});
