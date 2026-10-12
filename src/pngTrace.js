// Converts simple high-contrast raster artwork into closed SVG path contours.
// SVG is an internal interchange only; the user still receives the finished STL.

const ALPHA_THRESHOLD = 128;
const LUMINANCE_THRESHOLD = 128;
const MAX_PIXELS = 4_000_000;
const MAX_EDGES = 500_000;
const BORDER_SAMPLE_LIMIT = 64;
const DETECTION_DISTANCE = 42;
const FLOOD_DISTANCE = 48;
const AUTO_CONFIDENCE = 0.7;
const GRADIENT_MODEL_DISTANCE = 0.06;
const GRADIENT_SEED_DISTANCE = 0.045;
const GRADIENT_FLOOD_DISTANCE = 0.08;
const GRADIENT_MIN_CONFIDENCE = 0.68;
const MAX_QUADRATIC_CURVATURE = 512;
const MAX_MODEL_CONDITION = 1e8;
const PREDICTION_MARGIN = 8;
const SEGMENTATION_REVIEW_MESSAGE =
  "Auto background detection failed — review the traced result.";
const PICK_SAMPLE_MESSAGE =
  "Pick background needs at least one trusted background sample.";
const PICK_DISTRIBUTION_MESSAGE =
  "Add more background samples across bright and dark regions of the image.";

export const MIN_PNG_BACKGROUND_TOLERANCE = 0.5;
export const MAX_PNG_BACKGROUND_TOLERANCE = 1.5;
export const DEFAULT_PNG_BACKGROUND_TOLERANCE = 1;

export const PNG_BACKGROUND_MODES = Object.freeze([
  "auto",
  "light",
  "dark",
  "pick",
  "original",
]);
export const DEFAULT_PNG_BACKGROUND_MODE = "auto";

export async function tracePNGToSVG(file, options = {}) {
  return (await tracePNGToSVGDetails(file, options)).svg;
}

export async function tracePNGToSVGDetails(
  file,
  {
    backgroundMode = DEFAULT_PNG_BACKGROUND_MODE,
    backgroundSamples = [],
    backgroundTolerance = DEFAULT_PNG_BACKGROUND_TOLERANCE,
  } = {},
) {
  if (!(file instanceof File) || !isPNG(file)) {
    throw new Error("Please choose a PNG image.");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That PNG image could not be read.");
  }

  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) throw new Error("The PNG image is empty.");
    if (width * height > MAX_PIXELS) {
      throw new Error(
        "The PNG is too large to trace. Use an image under 4 megapixels.",
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("PNG tracing is not available in this browser.");
    }

    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const traced = createPNGTraceMask(pixels, width, height, {
      backgroundMode,
      backgroundSamples,
      backgroundTolerance,
    });
    return {
      svg: traceMaskToSVG(traced.mask, width, height),
      issues: traced.issues,
      segmentation: traced.segmentation,
    };
  } finally {
    bitmap.close();
  }
}

function isPNG(file) {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

/**
 * Creates the binary trace mask without changing the uploaded image. Automatic
 * background removal is represented by a separate border-connected exclusion
 * mask so it cannot change alpha-mode detection or fill enclosed holes.
 */
export function createPNGTraceMask(
  pixels,
  width,
  height,
  {
    backgroundMode = DEFAULT_PNG_BACKGROUND_MODE,
    backgroundSamples = [],
    backgroundTolerance = DEFAULT_PNG_BACKGROUND_TOLERANCE,
  } = {},
) {
  validateRaster(pixels, width, height);
  if (!PNG_BACKGROUND_MODES.includes(backgroundMode)) {
    throw new RangeError(`Unsupported PNG background mode: ${backgroundMode}.`);
  }
  if (
    !Number.isFinite(backgroundTolerance) ||
    backgroundTolerance < MIN_PNG_BACKGROUND_TOLERANCE ||
    backgroundTolerance > MAX_PNG_BACKGROUND_TOLERANCE
  ) {
    throw new RangeError(
      `PNG background tolerance must be between ${MIN_PNG_BACKGROUND_TOLERANCE} and ${MAX_PNG_BACKGROUND_TOLERANCE}.`,
    );
  }

  const border = borderAnalysis(pixels, width, height);
  // Preserve the old processing for every image containing transparency. In
  // particular, a transparent-border PNG must continue to use alpha alone.
  if (hasTransparency(pixels)) {
    return {
      mask: binaryMask(pixels, width, height, { border }),
      exclusionMask: new Uint8Array(width * height),
      issues: [],
      segmentation: segmentationState(
        backgroundMode === "original" ? "original" : "confident",
        "alpha",
      ),
    };
  }
  if (backgroundMode === "original") {
    return {
      mask: binaryMask(pixels, width, height, { border }),
      exclusionMask: new Uint8Array(width * height),
      issues: [],
      segmentation: segmentationState("original", "original"),
    };
  }

  if (backgroundMode === "pick") {
    return pickedBackgroundMask(
      pixels,
      width,
      height,
      backgroundSamples,
      backgroundTolerance,
      border,
    );
  }

  const samples = borderSamples(pixels, width, height);
  const wantedPolarity =
    backgroundMode === "light"
      ? true
      : backgroundMode === "dark"
        ? false
        : null;
  const detected = dominantBorderColor(samples, wantedPolarity);

  if (backgroundMode === "auto" && detected.confidence < AUTO_CONFIDENCE) {
    const model = smoothBackgroundModel(samples);
    if (model !== null) {
      const segmented = gradientForegroundMask(pixels, width, height, model);
      if (modelMatchesInterior(pixels, width, height, model)) {
        return {
          mask: segmented.mask,
          exclusionMask: segmented.exclusionMask,
          issues: [],
          segmentation: segmentationState("confident", model.type),
        };
      }
    }
    return originalFallback(pixels, width, height, border);
  }

  const exclusionMask = detected.color === null
    ? new Uint8Array(width * height)
    : floodBackground(pixels, width, height, detected.color);
  const lightBackground =
    wantedPolarity ?? luminanceColor(detected.color) >= LUMINANCE_THRESHOLD;
  const mask = binaryMask(pixels, width, height, {
    border,
    exclusionMask,
    lightBackground,
  });
  if (
    backgroundMode === "auto" &&
    !constantModelMatchesInterior(
      pixels,
      width,
      height,
      detected.color,
    )
  ) {
    const model = smoothBackgroundModel(samples);
    if (model !== null && modelMatchesInterior(pixels, width, height, model)) {
      const segmented = gradientForegroundMask(pixels, width, height, model);
      return {
        mask: segmented.mask,
        exclusionMask: segmented.exclusionMask,
        issues: [],
        segmentation: segmentationState("confident", model.type),
      };
    }
    return originalFallback(pixels, width, height, border);
  }
  return {
    mask,
    exclusionMask,
    issues: [],
    segmentation: segmentationState(
      "confident",
      backgroundMode === "auto" ? "uniform" : backgroundMode,
    ),
  };
}

function originalFallback(pixels, width, height, border) {
  return reviewFallback(
    pixels,
    width,
    height,
    border,
    SEGMENTATION_REVIEW_MESSAGE,
    "original-fallback",
  );
}

function reviewFallback(pixels, width, height, border, message, method) {
  return {
    mask: binaryMask(pixels, width, height, { border }),
    exclusionMask: new Uint8Array(width * height),
    issues: [{ level: "info", message }],
    segmentation: segmentationState("needs-review", method, message),
  };
}

function segmentationState(status, method, message = null) {
  return { status, method, message };
}

function pickedBackgroundMask(
  pixels,
  width,
  height,
  positions,
  tolerance,
  border,
) {
  const samples = trustedPixelSamples(pixels, width, height, positions);
  if (samples.length === 0) {
    return reviewFallback(
      pixels,
      width,
      height,
      border,
      PICK_SAMPLE_MESSAGE,
      "pick-fallback",
    );
  }

  const model = trustedBackgroundModel(samples);
  if (model === null) {
    return reviewFallback(
      pixels,
      width,
      height,
      border,
      PICK_DISTRIBUTION_MESSAGE,
      "pick-fallback",
    );
  }

  const segmented = gradientForegroundMask(
    pixels,
    width,
    height,
    model,
    tolerance,
  );
  return {
    mask: segmented.mask,
    exclusionMask: segmented.exclusionMask,
    issues: [],
    segmentation: segmentationState("confident", `picked-${model.type}`),
  };
}

function trustedPixelSamples(pixels, width, height, positions) {
  if (!Array.isArray(positions)) {
    throw new TypeError("PNG background samples must be an array.");
  }

  const unique = new Map();
  for (const position of positions) {
    const x = position?.x;
    const y = position?.y;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
    ) {
      throw new RangeError(
        "PNG background sample positions must be normalized between zero and one.",
      );
    }
    const pixelX = Math.round(x * (width - 1));
    const pixelY = Math.round(y * (height - 1));
    const key = `${pixelX}:${pixelY}`;
    const offset = (pixelY * width + pixelX) * 4;
    unique.set(key, {
      x,
      y,
      color: [pixels[offset], pixels[offset + 1], pixels[offset + 2]],
    });
  }
  return [...unique.values()];
}

function trustedBackgroundModel(samples) {
  const average = [0, 1, 2].map(
    (channel) =>
      samples.reduce((sum, sample) => sum + sample.color[channel], 0) /
      samples.length,
  );
  const uniform = {
    type: "uniform",
    coefficients: average.map((value) => [value]),
  };
  const uniformDistances = samples.map(({ color }) =>
    oklabDistance(color, average),
  );
  if (
    median(uniformDistances) <= GRADIENT_MODEL_DISTANCE * 0.45 &&
    Math.max(...uniformDistances) <= GRADIENT_MODEL_DISTANCE
  ) {
    return uniform;
  }

  if (!hasDistributedSupport(samples)) return null;

  const rejected = [];
  for (const [type, minimumSamples] of [
    ["plane", 4],
    ["bilinear", 6],
    ["quadratic", 9],
  ]) {
    if (samples.length < minimumSamples) continue;
    const fit = leastSquaresColorField(samples, type);
    if (fit === null || fit.condition > MAX_MODEL_CONDITION) continue;
    const model = { type, coefficients: fit.coefficients };
    if (!modelPredictionsAreBounded(model)) continue;
    if (type === "quadratic" && !quadraticIsBounded(model)) continue;

    const distances = samples.map((sample) =>
      sampleDistance(sample, model.coefficients, type),
    );
    const candidate = {
      ...model,
      validationMedian: median(distances),
      validationMaximum: Math.max(...distances),
    };
    const adequate =
      candidate.validationMedian <= GRADIENT_MODEL_DISTANCE * 0.45 &&
      candidate.validationMaximum <= GRADIENT_MODEL_DISTANCE;
    if (
      adequate &&
      (type !== "quadratic" ||
        manualMeaningfulImprovement(candidate, rejected))
    ) {
      return model;
    }
    rejected.push(candidate);
  }
  return null;
}

function hasDistributedSupport(samples) {
  const xs = samples.map(({ x }) => x);
  const ys = samples.map(({ y }) => y);
  if (Math.max(...xs) - Math.min(...xs) < 0.35) return false;
  if (Math.max(...ys) - Math.min(...ys) < 0.35) return false;
  const regions = new Set(
    samples.map(({ x, y }) => `${Number(x >= 0.5)}:${Number(y >= 0.5)}`),
  );
  return regions.size >= 3;
}

function modelPredictionsAreBounded(model) {
  for (let row = 0; row <= 4; row++) {
    for (let column = 0; column <= 4; column++) {
      const color = predictColor(
        model.coefficients,
        column / 4,
        row / 4,
        model.type,
        false,
      );
      if (
        color.some(
          (value) =>
            value < -PREDICTION_MARGIN || value > 255 + PREDICTION_MARGIN,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function manualMeaningfulImprovement(candidate, rejected) {
  if (rejected.length === 0) return true;
  const bestMedian = Math.min(
    ...rejected.map(({ validationMedian }) => validationMedian),
  );
  return candidate.validationMedian <= bestMedian * 0.75;
}

function binaryMask(
  pixels,
  width,
  height,
  { border = borderAnalysis(pixels, width, height), exclusionMask = null, lightBackground } = {},
) {
  const transparentBackground =
    border.transparent > border.opaque && border.transparent > 0;
  const inferredLightBackground =
    border.opaque === 0 || border.light / border.opaque >= LUMINANCE_THRESHOLD;
  const useLightBackground = lightBackground ?? inferredLightBackground;

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    if (exclusionMask?.[i]) continue;
    mask[i] = transparentBackground
      ? Number(pixels[offset + 3] >= ALPHA_THRESHOLD)
      : Number(
          pixels[offset + 3] >= ALPHA_THRESHOLD &&
            (useLightBackground
              ? luminance(pixels, offset) < LUMINANCE_THRESHOLD
              : luminance(pixels, offset) >= LUMINANCE_THRESHOLD),
        );
  }
  return mask;
}

function borderAnalysis(pixels, width, height) {
  let borderLight = 0;
  let borderSamples = 0;
  let transparentBorder = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < ALPHA_THRESHOLD) {
        transparentBorder++;
      } else {
        borderLight += luminance(pixels, (y * width + x) * 4);
        borderSamples++;
      }
    }
  }
  return {
    light: borderLight,
    opaque: borderSamples,
    transparent: transparentBorder,
  };
}

function hasTransparency(pixels) {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < ALPHA_THRESHOLD) return true;
  }
  return false;
}

function borderSamples(pixels, width, height) {
  const perimeter = Math.max(1, 2 * width + 2 * height - 4);
  const count = Math.min(BORDER_SAMPLE_LIMIT, perimeter);
  const samples = [];
  const used = new Set();

  for (let sample = 0; sample < count; sample++) {
    const position = Math.floor((sample * perimeter) / count);
    const [x, y, side] = borderPosition(position, width, height);
    const index = y * width + x;
    if (used.has(index)) continue;
    used.add(index);
    const offset = index * 4;
    samples.push({
      x: width === 1 ? 0 : x / (width - 1),
      y: height === 1 ? 0 : y / (height - 1),
      side,
      order: sample,
      color: [pixels[offset], pixels[offset + 1], pixels[offset + 2]],
    });
  }
  return samples;
}

function borderPosition(position, width, height) {
  if (position < width) return [position, 0, "top"];
  position -= width;
  if (position < height - 1) return [width - 1, position + 1, "right"];
  position -= height - 1;
  if (position < width - 1) {
    return [width - 2 - position, height - 1, "bottom"];
  }
  position -= width - 1;
  return [0, Math.max(0, height - 2 - position), "left"];
}

function dominantBorderColor(samples, lightPolarity) {
  const eligible = lightPolarity === null
    ? samples
    : samples.filter(({ color }) =>
        lightPolarity
          ? luminanceColor(color) >= LUMINANCE_THRESHOLD
          : luminanceColor(color) < LUMINANCE_THRESHOLD,
      );
  if (eligible.length === 0) return { color: null, confidence: 0 };

  let matches = [];
  for (const candidate of eligible) {
    const cluster = eligible.filter(
      (sample) =>
        colorDistanceSquared(sample.color, candidate.color) <=
        DETECTION_DISTANCE ** 2,
    );
    if (cluster.length > matches.length) matches = cluster;
  }
  const color = matches
    .reduce(
      (sum, sample) =>
        sum.map((value, index) => value + sample.color[index]),
      [0, 0, 0],
    )
    .map((value) => value / matches.length);
  return { color, confidence: matches.length / samples.length };
}

/** Fits a small spatial RGB field, while judging residuals perceptually. */
function smoothBackgroundModel(samples) {
  if (samples.length < 12) return null;

  const plane = fitBackgroundCandidate(samples, "plane");
  if (plane?.accepted) return plane;

  const bilinear = fitBackgroundCandidate(samples, "bilinear");
  if (bilinear?.accepted && meaningfulImprovement(bilinear, [plane])) {
    return bilinear;
  }

  const quadratic = fitBackgroundCandidate(samples, "quadratic");
  if (
    !quadratic?.accepted ||
    !quadraticIsBounded(quadratic) ||
    !meaningfulImprovement(quadratic, [plane, bilinear])
  ) {
    return null;
  }
  return quadratic;
}

function fitBackgroundCandidate(samples, type) {
  const training = samples.filter(({ order }) => order % 4 !== 0);
  const validation = samples.filter(({ order }) => order % 4 === 0);
  const parameterCount = fieldTerms(0, 0, type).length;
  if (training.length < parameterCount * 3 || validation.length < 4) {
    return null;
  }

  let active = training;
  let fit = null;
  for (let iteration = 0; iteration < 4; iteration++) {
    fit = leastSquaresColorField(active, type);
    if (fit === null) return null;
    const residuals = training.map((sample) => ({
      sample,
      distance: sampleDistance(sample, fit.coefficients, type),
    }));
    const values = residuals.map(({ distance }) => distance);
    const centre = median(values);
    const deviation = median(values.map((value) => Math.abs(value - centre)));
    const cutoff = Math.min(
      0.1,
      Math.max(0.035, centre + Math.max(0.012, deviation * 3.5)),
    );
    const next = residuals
      .filter(({ distance }) => distance <= cutoff)
      .map(({ sample }) => sample);
    if (next.length < parameterCount * 3) return null;
    if (next.length === active.length) break;
    active = next;
  }

  fit = leastSquaresColorField(active, type);
  if (fit === null || fit.condition > MAX_MODEL_CONDITION) return null;
  const validationDistances = validation.map((sample) =>
    sampleDistance(sample, fit.coefficients, type),
  );
  const validationInliers = validationDistances.filter(
    (distance) => distance <= GRADIENT_MODEL_DISTANCE,
  ).length;
  const validationConfidence = validationInliers / validation.length;
  const allDistances = samples.map((sample) => ({
    sample,
    distance: sampleDistance(sample, fit.coefficients, type),
  }));
  const confidence =
    allDistances.filter(
      ({ distance }) => distance <= GRADIENT_MODEL_DISTANCE,
    ).length / samples.length;
  const hasCoverage = ["top", "right", "bottom", "left"].every((side) => {
    const sideSamples = allDistances.filter(({ sample }) => sample.side === side);
    return (
      sideSamples.length >= 2 &&
      sideSamples.filter(
        ({ distance }) => distance <= GRADIENT_MODEL_DISTANCE,
      ).length /
        sideSamples.length >=
        0.5
    );
  });

  return {
    coefficients: fit.coefficients,
    condition: fit.condition,
    type,
    accepted:
      confidence >= GRADIENT_MIN_CONFIDENCE &&
      validationConfidence >= GRADIENT_MIN_CONFIDENCE &&
      median(validationDistances) <= GRADIENT_MODEL_DISTANCE * 0.65 &&
      hasCoverage,
    validationConfidence,
    validationMedian: median(validationDistances),
  };
}

function meaningfulImprovement(candidate, simpler) {
  const available = simpler.filter((model) => model !== null);
  if (available.length === 0) return true;
  const bestMedian = Math.min(
    ...available.map(({ validationMedian }) => validationMedian),
  );
  const bestConfidence = Math.max(
    ...available.map(({ validationConfidence }) => validationConfidence),
  );
  return (
    candidate.validationMedian <= bestMedian * 0.75 ||
    candidate.validationConfidence >= bestConfidence + 0.15
  );
}

function quadraticIsBounded(model) {
  for (const coefficients of model.coefficients) {
    if (
      Math.abs(coefficients[4]) > MAX_QUADRATIC_CURVATURE ||
      Math.abs(coefficients[5]) > MAX_QUADRATIC_CURVATURE
    ) {
      return false;
    }
  }
  for (let row = 0; row <= 4; row++) {
    for (let column = 0; column <= 4; column++) {
      const color = predictColor(
        model.coefficients,
        column / 4,
        row / 4,
        model.type,
        false,
      );
      if (
        color.some(
          (value) =>
            value < -PREDICTION_MARGIN || value > 255 + PREDICTION_MARGIN,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function leastSquaresColorField(samples, type) {
  const size = fieldTerms(0, 0, type).length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const channels = Array.from({ length: 3 }, () => Array(size).fill(0));
  for (const sample of samples) {
    const terms = fieldTerms(sample.x, sample.y, type);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        matrix[row][column] += terms[row] * terms[column];
      }
      for (let channel = 0; channel < 3; channel++) {
        channels[channel][row] += terms[row] * sample.color[channel];
      }
    }
  }
  const solved = channels.map((values) => solveLinear(matrix, values));
  if (solved.some((channel) => channel === null)) return null;
  return {
    coefficients: solved.map(({ solution }) => solution),
    condition: Math.max(...solved.map(({ condition }) => condition)),
  };
}

function solveLinear(matrix, values) {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  let largestPivot = 0;
  let smallestPivot = Infinity;
  for (let column = 0; column < rows.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    const pivotSize = Math.abs(rows[pivot][column]);
    if (pivotSize < 1e-9) return null;
    largestPivot = Math.max(largestPivot, pivotSize);
    smallestPivot = Math.min(smallestPivot, pivotSize);
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let entry = column; entry <= rows.length; entry++) {
      rows[column][entry] /= divisor;
    }
    for (let row = 0; row < rows.length; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry <= rows.length; entry++) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }
  return {
    solution: rows.map((row) => row[rows.length]),
    condition: largestPivot / smallestPivot,
  };
}

function sampleDistance(sample, coefficients, type) {
  return oklabDistance(
    sample.color,
    predictColor(coefficients, sample.x, sample.y, type),
  );
}

function predictColor(coefficients, x, y, type, shouldClamp = true) {
  const terms = fieldTerms(x, y, type);
  return coefficients.map((channel) => {
    const value = channel.reduce(
      (sum, coefficient, index) => sum + coefficient * terms[index],
      0,
    );
    return shouldClamp ? clamp(value, 0, 255) : value;
  });
}

function fieldTerms(x, y, type) {
  if (type === "uniform") return [1];
  if (type === "quadratic") return [1, x, y, x * y, x * x, y * y];
  if (type === "bilinear") return [1, x, y, x * y];
  return [1, x, y];
}

function gradientForegroundMask(
  pixels,
  width,
  height,
  model,
  tolerance = DEFAULT_PNG_BACKGROUND_TOLERANCE,
) {
  const seedDistance = GRADIENT_SEED_DISTANCE * tolerance;
  const floodDistance = GRADIENT_FLOOD_DISTANCE * tolerance;
  const classes = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const normalizedY = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const offset = index * 4;
      if (pixels[offset + 3] < ALPHA_THRESHOLD) continue;
      const normalizedX = width === 1 ? 0 : x / (width - 1);
      const predictedRed = predictChannel(
        model.coefficients[0],
        normalizedX,
        normalizedY,
        model.type,
      );
      const predictedGreen = predictChannel(
        model.coefficients[1],
        normalizedX,
        normalizedY,
        model.type,
      );
      const predictedBlue = predictChannel(
        model.coefficients[2],
        normalizedX,
        normalizedY,
        model.type,
      );
      const distance = oklabDistanceChannels(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        predictedRed,
        predictedGreen,
        predictedBlue,
      );
      classes[index] =
        distance <= seedDistance
          ? 2
          : distance <= floodDistance
            ? 1
            : 0;
    }
  }

  const exclusionMask = floodClassifiedBackground(classes, width, height);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index++) {
    mask[index] = Number(
      pixels[index * 4 + 3] >= ALPHA_THRESHOLD && !exclusionMask[index],
    );
  }
  return { mask, exclusionMask };
}

function modelMatchesInterior(pixels, width, height, model) {
  return sampledInteriorMatches(pixels, width, height, (x, y) =>
    predictColor(model.coefficients, x, y, model.type),
  );
}

function constantModelMatchesInterior(
  pixels,
  width,
  height,
  backgroundColor,
) {
  if (backgroundColor === null) return false;
  return sampledInteriorMatches(
    pixels,
    width,
    height,
    () => backgroundColor,
  );
}

// A bounded interior sanity check catches vignettes whose borders look
// uniform while most of the image follows a different neutral brightness.
// Chromatic foreground does not count against the background model.
function sampledInteriorMatches(pixels, width, height, predict) {
  let neutralMismatch = 0;
  let opaqueSamples = 0;
  const divisions = 8;
  for (let row = 1; row < divisions; row++) {
    const y = Math.round((row * (height - 1)) / divisions);
    for (let column = 1; column < divisions; column++) {
      const x = Math.round((column * (width - 1)) / divisions);
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < ALPHA_THRESHOLD) continue;
      opaqueSamples++;
      const actual = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      const predicted = predict(
        width === 1 ? 0 : x / (width - 1),
        height === 1 ? 0 : y / (height - 1),
      );
      if (
        oklabDistance(actual, predicted) > GRADIENT_FLOOD_DISTANCE &&
        oklabChromaDistance(actual, predicted) < 0.025
      ) {
        neutralMismatch++;
      }
    }
  }
  return opaqueSamples === 0 || neutralMismatch / opaqueSamples < 0.5;
}

function floodClassifiedBackground(classes, width, height) {
  const excluded = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;
  const seed = (index) => {
    if (classes[index] !== 2 || excluded[index]) return;
    excluded[index] = 1;
    queue[tail++] = index;
  };
  const visit = (index) => {
    if (classes[index] === 0 || excluded[index]) return;
    excluded[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y + 1 < height) visit(index + width);
  }
  return excluded;
}

function oklabDistance(first, second) {
  return oklabDistanceChannels(...first, ...second);
}

function oklabChromaDistance(first, second) {
  const firstLab = rgbToOklab(first[0], first[1], first[2]);
  const secondLab = rgbToOklab(second[0], second[1], second[2]);
  return Math.hypot(firstLab.a - secondLab.a, firstLab.b - secondLab.b);
}

function oklabDistanceChannels(redA, greenA, blueA, redB, greenB, blueB) {
  const linearRedA = linearRGB(redA);
  const linearGreenA = linearRGB(greenA);
  const linearBlueA = linearRGB(blueA);
  const lA = Math.cbrt(
    0.4122214708 * linearRedA +
      0.5363325363 * linearGreenA +
      0.0514459929 * linearBlueA,
  );
  const mA = Math.cbrt(
    0.2119034982 * linearRedA +
      0.6806995451 * linearGreenA +
      0.1073969566 * linearBlueA,
  );
  const sA = Math.cbrt(
    0.0883024619 * linearRedA +
      0.2817188376 * linearGreenA +
      0.6299787005 * linearBlueA,
  );
  const linearRedB = linearRGB(redB);
  const linearGreenB = linearRGB(greenB);
  const linearBlueB = linearRGB(blueB);
  const lB = Math.cbrt(
    0.4122214708 * linearRedB +
      0.5363325363 * linearGreenB +
      0.0514459929 * linearBlueB,
  );
  const mB = Math.cbrt(
    0.2119034982 * linearRedB +
      0.6806995451 * linearGreenB +
      0.1073969566 * linearBlueB,
  );
  const sB = Math.cbrt(
    0.0883024619 * linearRedB +
      0.2817188376 * linearGreenB +
      0.6299787005 * linearBlueB,
  );
  return Math.hypot(
    0.2104542553 * (lA - lB) +
      0.793617785 * (mA - mB) -
      0.0040720468 * (sA - sB),
    1.9779984951 * (lA - lB) -
      2.428592205 * (mA - mB) +
      0.4505937099 * (sA - sB),
    0.0259040371 * (lA - lB) +
      0.7827717662 * (mA - mB) -
      0.808675766 * (sA - sB),
  );
}

function rgbToOklab(red, green, blue) {
  const linearRed = linearRGB(red);
  const linearGreen = linearRGB(green);
  const linearBlue = linearRGB(blue);
  const l = Math.cbrt(
    0.4122214708 * linearRed +
      0.5363325363 * linearGreen +
      0.0514459929 * linearBlue,
  );
  const m = Math.cbrt(
    0.2119034982 * linearRed +
      0.6806995451 * linearGreen +
      0.1073969566 * linearBlue,
  );
  const s = Math.cbrt(
    0.0883024619 * linearRed +
      0.2817188376 * linearGreen +
      0.6299787005 * linearBlue,
  );
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function linearRGB(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function predictChannel(coefficients, x, y, type) {
  if (type === "uniform") return clamp(coefficients[0], 0, 255);
  return clamp(
    coefficients[0] +
      coefficients[1] * x +
      coefficients[2] * y +
      (type === "plane" ? 0 : (coefficients[3] ?? 0) * x * y) +
      (type === "quadratic"
        ? (coefficients[4] ?? 0) * x * x +
          (coefficients[5] ?? 0) * y * y
        : 0),
    0,
    255,
  );
}

function median(values) {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function floodBackground(pixels, width, height, backgroundColor) {
  const excluded = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;
  const matches = (index) =>
    pixels[index * 4 + 3] >= ALPHA_THRESHOLD &&
    colorDistanceFromPixels(pixels, index * 4, backgroundColor) <=
      FLOOD_DISTANCE ** 2;
  const enqueue = (index) => {
    if (excluded[index] || !matches(index)) return;
    excluded[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  return excluded;
}

function colorDistanceSquared(first, second) {
  return (
    (first[0] - second[0]) ** 2 +
    (first[1] - second[1]) ** 2 +
    (first[2] - second[2]) ** 2
  );
}

function colorDistanceFromPixels(pixels, offset, color) {
  return (
    (pixels[offset] - color[0]) ** 2 +
    (pixels[offset + 1] - color[1]) ** 2 +
    (pixels[offset + 2] - color[2]) ** 2
  );
}

function luminanceColor(color) {
  if (color === null) return LUMINANCE_THRESHOLD;
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function validateRaster(pixels, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length !== width * height * 4
  ) {
    throw new Error("Invalid PNG pixel data.");
  }
}

function luminance(pixels, offset) {
  return (
    pixels[offset] * 0.2126 +
    pixels[offset + 1] * 0.7152 +
    pixels[offset + 2] * 0.0722
  );
}

export function traceMaskToSVG(mask, width, height) {
  if (mask.length !== width * height)
    throw new Error("Invalid PNG trace mask.");

  const edges = [];
  const starts = new Map();
  const filled = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;

  const add = (sx, sy, ex, ey, direction) => {
    if (edges.length >= MAX_EDGES) {
      throw new Error(
        "The PNG is too detailed to trace. Simplify or reduce the image first.",
      );
    }
    const edge = { sx, sy, ex, ey, direction, used: false };
    edges.push(edge);
    const key = `${sx},${sy}`;
    const list = starts.get(key);
    if (list === undefined) starts.set(key, [edge]);
    else list.push(edge);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      // Edges run with the filled pixel on their right. Outer and hole
      // contours therefore receive opposite winding automatically.
      if (!filled(x, y - 1)) add(x, y, x + 1, y, 0);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
      if (!filled(x - 1, y)) add(x, y + 1, x, y, 3);
    }
  }

  if (edges.length === 0) {
    throw new Error(
      "The PNG has no high-contrast artwork to turn into a stamp.",
    );
  }

  const paths = [];
  for (const first of edges) {
    if (first.used) continue;
    const points = [[first.sx, first.sy]];
    let edge = first;

    while (true) {
      edge.used = true;
      points.push([edge.ex, edge.ey]);
      if (edge.ex === first.sx && edge.ey === first.sy) break;

      const candidates = (starts.get(`${edge.ex},${edge.ey}`) ?? []).filter(
        (candidate) => !candidate.used,
      );
      if (candidates.length === 0) {
        throw new Error("Could not trace a closed PNG outline.");
      }
      edge = chooseTurn(edge.direction, candidates);
    }

    const ring = removeCollinear(points.slice(0, -1));
    if (ring.length >= 3) {
      paths.push(`M${ring.map(([x, y]) => `${x} ${y}`).join("L")}Z`);
    }
  }

  if (paths.length === 0) {
    throw new Error("The PNG has no usable closed outlines.");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="#000" fill-rule="evenodd" d="${paths.join("")}"/></svg>`;
}

function chooseTurn(direction, candidates) {
  const priority = new Map([
    [1, 0], // right
    [0, 1], // straight
    [3, 2], // left
    [2, 3], // back
  ]);
  return candidates.reduce((best, candidate) =>
    priority.get((candidate.direction - direction + 4) % 4) <
    priority.get((best.direction - direction + 4) % 4)
      ? candidate
      : best,
  );
}

function removeCollinear(ring) {
  if (ring.length < 3) return ring;
  return ring.filter((point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const next = ring[(index + 1) % ring.length];
    return (
      (point[0] - previous[0]) * (next[1] - point[1]) !==
      (point[1] - previous[1]) * (next[0] - point[0])
    );
  });
}
