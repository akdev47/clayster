// Finds the smallest change that makes selected text pass the thin-letter check.
// Thickness is tried first so the stamp stays close to its current size.
import { transform } from "./canonical.js";
import { TEXT_LIMITS } from "./limits.js";
import { textLetterSpacingMm } from "./artworkComposition.js";
import { layoutText, wrapText } from "./text.js";
import { thinFeatureIssues } from "./validate.js";
import { initializeSolids, offsetOutline } from "../solidGeometry.js";

export const MIN_PRINTABLE_FEATURE_MM = 0.8;
export const LETTER_THICKNESS_STEP_MM = 0.1;
export const MAX_LETTER_THICKNESS_MM = 1.5;
export const TEXT_SIZE_SEARCH_STEP_MM = 0.5;
export const MAX_TEXT_SIZE_SEARCH_MM = 60;

const wasmUrl = import.meta.resolve("manifold-3d/manifold.wasm");

/**
 * Returns the smallest thickness, then size, that clears the 0.8 mm check.
 * Null means the text is already clear, or neither change can clear it.
 */
export async function printableTextAdjustment(font, source, elementTransform = {}) {
  if (source.text.trim() === "") return null;
  await initializeSolids(wasmUrl);

  const startSize = source.fontSizeMm;
  const startThickness = source.thicknessMm;
  const initial = layOut(font, source, startSize, startThickness, elementTransform);
  if (!isThin(initial)) return null;

  for (const thicknessMm of stepsAbove(
    startThickness,
    LETTER_THICKNESS_STEP_MM,
    MAX_LETTER_THICKNESS_MM,
  )) {
    if (!isThin(layOut(font, source, startSize, thicknessMm, elementTransform))) {
      return { fontSizeMm: startSize, thicknessMm };
    }
  }

  const thicknessMm = Math.max(startThickness, MAX_LETTER_THICKNESS_MM);
  let drawnEm = initial.drawnEm;
  for (const fontSizeMm of stepsAbove(
    startSize,
    TEXT_SIZE_SEARCH_STEP_MM,
    MAX_TEXT_SIZE_SEARCH_MM,
  )) {
    const laid = layOut(font, source, fontSizeMm, thicknessMm, elementTransform);
    if (laid.drawnEm <= drawnEm + 1e-6) break;
    drawnEm = laid.drawnEm;
    if (!isThin(laid)) return { fontSizeMm, thicknessMm };
  }

  return null;
}

function layOut(font, source, fontSizeMm, thicknessMm, elementTransform) {
  const letterSpacingMm = textLetterSpacingMm({ ...source, fontSizeMm });
  const wrapped = wrapText(font, {
    text: source.text,
    size: fontSizeMm,
    letterSpacing: letterSpacingMm,
  }, TEXT_LIMITS);
  const glyphOutlines = [];
  let canonical = layoutText(font, {
    text: wrapped.text,
    size: wrapped.size,
    letterSpacing: letterSpacingMm,
    lineSpacing: source.lineSpacing,
    align: source.alignment,
    glyphOutlines,
  });
  if (thicknessMm) {
    canonical = offsetOutline(canonical, thicknessMm / 2);
    for (const glyph of glyphOutlines) {
      glyph.canonical = offsetOutline(glyph.canonical, thicknessMm / 2);
    }
  }
  const scale = Math.abs(elementTransform.scale ?? 1);
  return {
    canonical: transform(canonical, elementTransform),
    glyphOutlines: glyphOutlines.map((glyph) => ({
      ...glyph,
      elementId: "text",
      canonical: transform(glyph.canonical, elementTransform),
    })),
    drawnEm: wrapped.size * scale,
  };
}

function isThin(laid) {
  return thinFeatureIssues(laid.canonical, {
    minFeature: MIN_PRINTABLE_FEATURE_MM,
    textGlyphs: laid.glyphOutlines,
  }).length > 0;
}

function stepsAbove(start, step, max) {
  const steps = [];
  let value = roundTo(Math.floor((start + step) / step) * step, step);
  if (value <= start + 1e-9) value = roundTo(start + step, step);
  for (; value <= max + 1e-9; value = roundTo(value + step, step)) {
    steps.push(value);
  }
  return steps;
}

function roundTo(value, step) {
  const places = (step.toString().split(".")[1] ?? "").length;
  return Number((Math.round(value / step) * step).toFixed(places));
}
