import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETTINGS,
  applyInputLimits,
  limitsAt,
  validateSettings,
} from "../src/stamp_generator/static/stamp_generator/js/settings.js";
import {
  DEFAULT_STAMP,
  FACE_SIZE_LIMITS,
  FACE_THICKNESS_LIMITS,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import {
  HANDLE,
  HANDLE_MAX_FACE_SHARE,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/handle.js";
import { TEXT_LIMITS } from "../src/stamp_generator/static/stamp_generator/js/pipeline/limits.js";
import { DEFAULT_SOURCE } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import { createDesignElement } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import {
  MIN_STAMP_MARGIN_MM,
  MAX_STAMP_MARGIN_MM,
  stampMarginMaximum,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import {
  DUPLICATE_OFFSET_MM,
  KEYBOARD_MOVE_STEP_MM,
  MAX_ELEMENT_SCALE,
  MAX_TEXT_SIZE_MM,
  MIN_ELEMENT_SCALE,
  MIN_TEXT_SIZE_MM,
  TEXT_SIZE_STEP_MM,
} from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { MAX_QUANTITY } from "../src/stamp_generator/static/stamp_generator/js/orderDraft.js";
import {
  DEFAULT_PNG_BACKGROUND_TOLERANCE,
  MAX_PNG_BACKGROUND_TOLERANCE,
  MIN_PNG_BACKGROUND_TOLERANCE,
} from "../src/stamp_generator/static/stamp_generator/js/pngTrace.js";
import { DEFAULT_PNG_SMOOTHING } from "../src/stamp_generator/static/stamp_generator/js/pipeline/png.js";
import { MIN_CLEAR_GAP_MM } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import {
  LETTER_THICKNESS_STEP_MM,
  MAX_LETTER_THICKNESS_MM,
  MAX_TEXT_SIZE_SEARCH_MM,
  MIN_PRINTABLE_FEATURE_MM,
  TEXT_SIZE_SEARCH_STEP_MM,
} from "../src/stamp_generator/static/stamp_generator/js/pipeline/fixThinText.js";

const html = readFileSync(
  new URL("../src/stamp_generator/templates/stamp_generator/index.html", import.meta.url),
  "utf8",
);
const pricingPy = readFileSync(new URL("../src/orders/pricing.py", import.meta.url), "utf8");
const clone = () => structuredClone(SETTINGS);
const problemsOf = (mutate) => {
  const settings = clone();
  mutate(settings);
  try {
    validateSettings(settings);
  } catch (error) {
    return error.message;
  }
  return "";
};

test("the shipped settings are valid and cannot be changed while the page runs", () => {
  assert.doesNotThrow(() => validateSettings(clone()));
  assert.ok(Object.isFrozen(SETTINGS));
  assert.ok(Object.isFrozen(SETTINGS.stamp.faceSizeMm));
  assert.throws(() => {
    SETTINGS.stamp.faceSizeMm.max = 999;
  });
});

test("a wrong value stops the page with a message that names the setting", () => {
  // Expectations are built from the shipped settings, so tweaking a value in
  // settings.js never breaks these tests.
  const { stamp, text } = SETTINGS;
  const face = stamp.faceSizeMm;
  assert.match(
    problemsOf((s) => { s.stamp.faceSizeMm.min = face.max + 1; }),
    new RegExp(`stamp\\.faceSizeMm: min \\(${face.max + 1}\\) is above max \\(${face.max}\\)`),
  );
  assert.match(
    problemsOf((s) => { s.stamp.faceSizeMm.max = stamp.maxWidthMm + 1; }),
    /stamp\.faceSizeMm\.max must not be above stamp\.maxWidthMm/,
  );
  for (const name of ["edgeRoundingClaySideMm", "edgeRoundingHandleSideMm"]) {
    assert.match(
      problemsOf((s) => { s.stamp[name] = stamp.edgeDistanceMm.min + 0.5; }),
      new RegExp(`stamp\\.${name} must be at least 0 and at most stamp\\.edgeDistanceMm\\.min`),
      name,
    );
    assert.match(
      problemsOf((s) => { s.stamp[name] = -1; }),
      new RegExp(`stamp\\.${name} must be at least 0`),
      name,
    );
  }
  assert.match(
    problemsOf((s) => { s.stamp.cornerRadiusMm = stamp.edgeDistanceMm.min + 0.5; }),
    /stamp\.cornerRadiusMm must be above 0 and at most stamp\.edgeDistanceMm\.min/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.cornerRadiusMm = 0; }),
    /stamp\.cornerRadiusMm must be above 0/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.maxLengthMm = 0; }),
    /stamp\.maxWidthMm and stamp\.maxLengthMm must be above 0/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.faceSizeMm.default = face.min - 1; }),
    new RegExp(`stamp\\.faceSizeMm: default \\(${face.min - 1}\\) is below min \\(${face.min}\\)`),
  );
  assert.match(
    problemsOf((s) => { s.checks.clearGapMm = 0; }),
    /checks\.clearGapMm must be above 0/,
  );
  assert.match(
    problemsOf((s) => { s.text.lineSpacing.step = 0; }),
    /text\.lineSpacing: step \(0\) must be above 0/,
  );
  assert.match(
    problemsOf((s) => { s.checks.thinFeatureMm = Number.NaN; }),
    /checks\.thinFeatureMm must be a number/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.reliefDepthMm.default = stamp.faceThicknessMm.default + 0.5; }),
    /reliefDepthMm\.default must be smaller than stamp\.faceThicknessMm\.default/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.edgeDistanceMm.min = face.min; }),
    /faceSizeMm\.min must be more than twice/,
  );
  assert.match(
    problemsOf((s) => { s.handle.heightMm = 0; }),
    /handle\.widthMm, depthMm and heightMm must be above 0/,
  );
  assert.match(
    problemsOf((s) => { s.text.maxRows = text.maxRows + 0.5; }),
    /text\.maxRows must be a whole number/,
  );
  assert.match(
    problemsOf((s) => { s.text.newTextSizeMm = text.sizeMm.max + 1; }),
    /text\.newTextSizeMm must be within text\.sizeMm/,
  );
  assert.match(
    problemsOf((s) => { s.stamp.oops = "50"; }),
    /stamp\.oops must be a number or a/,
  );
  // All problems are listed at once, not one per attempt.
  const both = problemsOf((s) => {
    s.stamp.faceSizeMm.min = face.max + 1;
    s.handle.heightMm = 0;
  });
  assert.match(both, /faceSizeMm/);
  assert.match(both, /handle\./);
});

test("the old constant names still carry the settings values", () => {
  const { stamp, handle, text, elements, images, order } = SETTINGS;
  assert.equal(DEFAULT_STAMP.faceSize, stamp.faceSizeMm.default);
  assert.equal(DEFAULT_STAMP.faceThickness, stamp.faceThicknessMm.default);
  assert.equal(DEFAULT_STAMP.reliefDepth, stamp.reliefDepthMm.default);
  assert.equal(DEFAULT_STAMP.margin, stamp.edgeDistanceMm.default);
  assert.deepEqual({ ...FACE_SIZE_LIMITS }, { min: stamp.faceSizeMm.min, max: stamp.faceSizeMm.max });
  assert.deepEqual(
    { ...FACE_THICKNESS_LIMITS },
    { min: stamp.faceThicknessMm.min, max: stamp.faceThicknessMm.max },
  );
  assert.equal(MIN_STAMP_MARGIN_MM, stamp.edgeDistanceMm.min);
  assert.equal(MAX_STAMP_MARGIN_MM, stamp.edgeDistanceMm.max);
  assert.equal(
    stampMarginMaximum({ faceSize: 40 }),
    Math.max(stamp.edgeDistanceMm.min, Math.min(stamp.edgeDistanceMm.max, 40 * stamp.edgeDistanceMaxShareOfFace)),
  );
  assert.equal(stampMarginMaximum({}), stampMarginMaximum({ faceSize: stamp.faceSizeMm.default }));

  assert.deepEqual({ ...HANDLE }, {
    widthMm: handle.widthMm,
    depthMm: handle.depthMm,
    heightMm: handle.heightMm,
  });
  assert.equal(HANDLE_MAX_FACE_SHARE, handle.maxShareOfFace);

  assert.equal(TEXT_LIMITS.rows, text.maxRows);
  assert.equal(DEFAULT_SOURCE.size, text.defaultSizeMm);
  assert.equal(DEFAULT_SOURCE.lineSpacing, text.lineSpacing.default);
  assert.equal(DEFAULT_SOURCE.svgSize, elements.pictureSizeMm.default);
  assert.equal(DEFAULT_SOURCE.pngSize, elements.pictureSizeMm.default);
  const element = createDesignElement({ kind: "text" });
  assert.equal(element.source.fontSizeMm, text.defaultSizeMm);
  assert.equal(element.source.lineSpacing, text.lineSpacing.default);

  assert.equal(MIN_ELEMENT_SCALE, elements.scale.min);
  assert.equal(MAX_ELEMENT_SCALE, elements.scale.max);
  assert.equal(MIN_TEXT_SIZE_MM, text.sizeMm.min);
  assert.equal(MAX_TEXT_SIZE_MM, text.sizeMm.max);
  assert.equal(TEXT_SIZE_STEP_MM, text.sizeMm.step);
  assert.equal(KEYBOARD_MOVE_STEP_MM, elements.keyboardMoveStepMm);
  assert.equal(DUPLICATE_OFFSET_MM, elements.duplicateOffsetMm);

  assert.equal(DEFAULT_PNG_SMOOTHING, images.png.smoothing.default);
  assert.equal(MIN_PNG_BACKGROUND_TOLERANCE, images.png.backgroundTolerance.min);
  assert.equal(MAX_PNG_BACKGROUND_TOLERANCE, images.png.backgroundTolerance.max);
  assert.equal(DEFAULT_PNG_BACKGROUND_TOLERANCE, images.png.backgroundTolerance.default);
  assert.equal(MAX_QUANTITY, order.maxQuantity);

  // The "fix thin text" search aims at exactly what the warning checks and
  // stays inside what the text controls allow.
  assert.equal(MIN_PRINTABLE_FEATURE_MM, SETTINGS.checks.thinFeatureMm);
  assert.equal(MIN_CLEAR_GAP_MM, SETTINGS.checks.clearGapMm);
  assert.equal(LETTER_THICKNESS_STEP_MM, text.letterThicknessMm.step);
  assert.equal(MAX_LETTER_THICKNESS_MM, text.letterThicknessMm.max);
  assert.equal(TEXT_SIZE_SEARCH_STEP_MM, text.sizeMm.step);
  assert.equal(MAX_TEXT_SIZE_SEARCH_MM, text.sizeMm.max);
});

test("the page's input fields take their limits from the settings, nowhere else", () => {
  const tags = [...html.matchAll(/<input\b[^>]*>/gs)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes("data-limits="));
  assert.ok(tags.length >= 10, "the stamp, text and element fields are linked");

  for (const tag of tags) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const path = tag.match(/data-limits="([^"]+)"/)[1];
    const range = limitsAt(path);
    assert.ok(range && typeof range === "object", `${id}: ${path} is not a settings range`);
    assert.ok(range.min !== undefined && range.max !== undefined, `${id}: ${path} has no min and max`);
    assert.doesNotMatch(tag, /\s(?:min|max|step)="/, `${id} repeats limits that are in settings.js`);
  }
});

test("applyInputLimits sets min, max and step, and rejects a link to nothing", () => {
  const makeInput = (path) => {
    const attributes = new Map([["data-limits", path]]);
    return {
      attributes,
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
    };
  };
  const face = makeInput("stamp.faceSizeMm");
  const spacing = makeInput("text.lineSpacing");
  applyInputLimits({ querySelectorAll: () => [face, spacing] });
  const { faceSizeMm } = SETTINGS.stamp;
  assert.equal(face.attributes.get("min"), String(faceSizeMm.min));
  assert.equal(face.attributes.get("max"), String(faceSizeMm.max));
  assert.equal(face.attributes.get("step"), String(faceSizeMm.step));
  assert.equal(spacing.attributes.get("step"), String(SETTINGS.text.lineSpacing.step));

  assert.throws(
    () => applyInputLimits({ querySelectorAll: () => [makeInput("stamp.nope")] }),
    /does not point to a settings range/,
  );
  assert.throws(
    () => applyInputLimits({ querySelectorAll: () => [makeInput("stamp.handle")] }),
    /does not point to a settings range/,
  );
});

test("limits the server also checks cannot drift from the page", () => {
  const serverNumber = (name) => Number(pricingPy.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m"))?.[1]);
  const maxQuantity = serverNumber("MAX_QUANTITY");
  const maxWidth = serverNumber("MAX_STAMP_WIDTH_MM");
  const maxLength = serverNumber("MAX_STAMP_LENGTH_MM");
  assert.ok(
    maxQuantity > 0 && maxWidth > 0 && maxLength > 0,
    "found the values in src/orders/pricing.py",
  );

  assert.equal(
    SETTINGS.order.maxQuantity,
    maxQuantity,
    "order.maxQuantity must equal MAX_QUANTITY in src/orders/pricing.py",
  );
  assert.equal(
    SETTINGS.stamp.maxWidthMm,
    maxWidth,
    "stamp.maxWidthMm must equal MAX_STAMP_WIDTH_MM in src/orders/pricing.py",
  );
  assert.equal(
    SETTINGS.stamp.maxLengthMm,
    maxLength,
    "stamp.maxLengthMm must equal MAX_STAMP_LENGTH_MM in src/orders/pricing.py",
  );
});
