import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { bounds } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { printableTextAdjustment } from "../src/stamp_generator/static/stamp_generator/js/pipeline/fixThinText.js";
import { initializeSolids, offsetOutline } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();

const fontBytes = readFileSync(
  new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const font = opentype.parse(fontBytes.buffer.slice(
  fontBytes.byteOffset,
  fontBytes.byteOffset + fontBytes.byteLength,
));

const source = {
  text: "w",
  fontSizeMm: 7.5,
  letterSpacingRatio: 0,
  lineSpacing: 1.25,
  alignment: "center",
  thicknessMm: 0,
};

function widthAt(fontSizeMm, thicknessMm) {
  const canonical = thicknessMm
    ? offsetOutline(layoutText(font, { text: "w", size: fontSizeMm }), thicknessMm / 2)
    : layoutText(font, { text: "w", size: fontSizeMm });
  return bounds(canonical).width;
}

test("a thin w is thickened before the text size grows", async () => {
  const before = widthAt(source.fontSizeMm, source.thicknessMm);
  const adjustment = await printableTextAdjustment(font, source);

  assert.equal(adjustment.fontSizeMm, source.fontSizeMm);
  assert.ok(adjustment.thicknessMm > source.thicknessMm);
  assert.ok(adjustment.thicknessMm <= 1.5);
  assert.ok(widthAt(adjustment.fontSizeMm, adjustment.thicknessMm) < before + 4);

  const previous = Number((adjustment.thicknessMm - 0.1).toFixed(1));
  const retry = await printableTextAdjustment(font, {
    ...source,
    thicknessMm: previous,
  });
  assert.deepEqual(retry, adjustment);
  assert.equal(await printableTextAdjustment(font, { ...source, ...adjustment }), null);
});

test("text that is already printable is left unchanged", async () => {
  assert.equal(await printableTextAdjustment(font, {
    ...source,
    text: "AMWw",
    thicknessMm: 0.3,
    letterSpacingRatio: 1 / 7.5,
  }), null);
});
