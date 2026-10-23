import { bounds, transform } from "./canonical.js";
import { SETTINGS } from "../settings.js";

const FACE_SEGMENTS = 96;
const CORNER_SEGMENTS = 8; // Per quarter circle of a rounded corner.

// How far inside the ideal outline the straight sides of a round plate and of a
// rounded corner may lie: a 120 mm round plate has 96 sides that sit up to
// 0.03 mm inside its circle. The editor measures to the ideal shape, so the
// final check allows this much to agree with it, far below what can be printed.
const CLEARANCE_TOLERANCE_MM = 0.05;
export const MIN_STAMP_MARGIN_MM = SETTINGS.stamp.edgeDistanceMm.min;
export const MAX_STAMP_MARGIN_MM = SETTINGS.stamp.edgeDistanceMm.max;

export function stampFaceShape(shape = "round") {
  // Designs made before Artwork was removed retain their artwork unchanged.
  if (shape === "outline") return "square";
  if (shape === "round" || shape === "square" || shape === "minimal") return shape;
  throw new Error("Unsupported stamp shape. Choose Round, Square, or Minimal.");
}

const roundToHundredth = (value) => Math.round(value * 100) / 100;
const oneDecimal = (value) => (Math.round(value * 10) / 10).toString();

/**
 * The error to show when the finished plate is larger than the largest stamp
 * that can be made (settings.js: stamp.maxWidthMm and stamp.maxLengthMm), or
 * null when it fits. Like the overflow error it blocks export and ordering
 * until the design is smaller. Sizes are compared to 0.01 mm, the same as the
 * server does, so both sides always agree.
 */
export function stampSizeIssue(widthMm, lengthMm) {
  const { maxWidthMm, maxLengthMm } = SETTINGS.stamp;
  if (
    roundToHundredth(widthMm) <= maxWidthMm &&
    roundToHundredth(lengthMm) <= maxLengthMm
  ) {
    return null;
  }
  return {
    level: "error",
    code: "stamp-too-large",
    message:
      `The stamp would be ${oneDecimal(widthMm)} × ${oneDecimal(lengthMm)} mm, ` +
      `but the largest stamp is ${maxWidthMm} × ${maxLengthMm} mm. ` +
      "Make the design smaller.",
  };
}

export function stampMarginMaximum(settings = {}) {
  // Minimal has no set face size, so the margin can use its own full range.
  if (stampFaceShape(settings.faceShape ?? "round") === "minimal") {
    return MAX_STAMP_MARGIN_MM;
  }
  const faceSize = Number.isFinite(settings.faceSize)
    ? settings.faceSize
    : SETTINGS.stamp.faceSizeMm.default;
  return Math.max(
    MIN_STAMP_MARGIN_MM,
    Math.min(
      MAX_STAMP_MARGIN_MM,
      faceSize * SETTINGS.stamp.edgeDistanceMaxShareOfFace,
    ),
  );
}

export function stampMargin(settings = {}) {
  const margin = settings.margin ?? MIN_STAMP_MARGIN_MM;
  if (!Number.isFinite(margin)) throw new Error("Stamp margin must be finite.");
  return Math.min(
    stampMarginMaximum(settings),
    Math.max(MIN_STAMP_MARGIN_MM, margin),
  );
}

/** Computes the final physical artwork and face shown by both 2D and 3D. */
export function createStampLayout(artwork, settings, notes = []) {
  settings = { ...settings, faceShape: stampFaceShape(settings.faceShape) };
  const mirrored = settings.mirror
    ? transform(artwork, { mirrorX: true })
    : artwork;
  const fitted = fitToFace(mirrored, settings, notes);
  const artworkTransform = {
    mirrorX: Boolean(settings.mirror),
    scale: fitted.transform.scale,
    xMm: fitted.transform.xMm,
    yMm: fitted.transform.yMm,
  };
  const face = stampFace(fitted.art, fitted.faceSize, settings);
  const overflows = extendsBeyond(fitted.art, face, stampMargin(settings));
  const faceBounds = bounds(face);
  const faceSize = fitted.faceSize;

  return {
    artwork: fitted.art,
    artworkTransform,
    overflows,
    face,
    faceShape: settings.faceShape,
    faceSize,
    minX: faceBounds.minX,
    minY: faceBounds.minY,
    widthMm: faceBounds.width,
    heightMm: faceBounds.height,
  };
}

/** Applies the shared stamp-layout transform after each element transform. */
export function layoutRenderElements(elements, artworkTransform) {
  return elements.map((element) => ({
    id: element.id,
    kind: element.kind,
    canonical: transform(
      transform(element.canonical, element.transform),
      artworkTransform,
    ),
  }));
}

// Round and Square keep the face size you set, so moving artwork does not
// resize the plate. Automatic sizing stays available for older designs.
// Minimal always hugs the artwork and ignores that face size.
export function fitToFace(artwork, settings, notes = []) {
  settings = { ...settings, faceShape: stampFaceShape(settings.faceShape) };
  const margin = stampMargin(settings);
  if (artwork.length === 0) {
    return {
      art: [],
      faceSize: settings.faceSize ?? 50,
      transform: { scale: 1, xMm: 0, yMm: 0 },
    };
  }

  if (settings.faceShape === "minimal") {
    const box = bounds(artwork);
    return {
      art: transform(artwork, { scale: 1, xMm: 0, yMm: 0 }),
      faceSize: Math.max(box.width, box.height) + margin * 2,
      transform: { scale: 1, xMm: 0, yMm: 0 },
      overflows: false,
    };
  }

  let faceSize = settings.faceSize ?? 50;
  if (settings.autoFaceSize) {
    faceSize = sizeAroundOrigin(artwork, settings.faceShape) + margin * 2;
  }
  if (settings.autoFaceSize && settings.faceShape === "round") {
    // The rendered/exported circle has straight chords. Compensate for their
    // inset so even the actual 96-sided backing retains the full clearance.
    faceSize /= Math.cos(Math.PI / FACE_SEGMENTS);
  }

  return {
    art: transform(artwork, { scale: 1, xMm: 0, yMm: 0 }),
    faceSize,
    transform: { scale: 1, xMm: 0, yMm: 0 },
    overflows: false,
  };
}

export function stampFace(artwork, faceSize, settings) {
  const shape = stampFaceShape(settings.faceShape);
  if (shape === "round") {
    const radius = faceSize / 2;
    return [[Array.from({ length: FACE_SEGMENTS }, (_, index) => {
      const angle = (index / FACE_SEGMENTS) * Math.PI * 2;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    })]];
  }

  if (shape === "minimal" && artwork.length > 0) {
    const margin = stampMargin(settings);
    const box = bounds(artwork);
    return plateOutline(
      box.minX - margin,
      box.minY - margin,
      box.maxX + margin,
      box.maxY + margin,
      settings.roundedCorners,
    );
  }

  const half = faceSize / 2;
  return plateOutline(-half, -half, half, half, settings.roundedCorners);
}

/**
 * A rectangular plate outline, counter-clockwise, with its corners rounded by
 * settings.js (stamp.cornerRadiusMm) when `rounded` is true. The radius never
 * exceeds 45% of the shortest side, so a very small plate keeps straight sides.
 */
export function plateOutline(minX, minY, maxX, maxY, rounded = false) {
  const radius = rounded
    ? Math.min(
        SETTINGS.stamp.cornerRadiusMm,
        0.45 * (maxX - minX),
        0.45 * (maxY - minY),
      )
    : 0;
  if (!(radius > 0)) {
    return [[[
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ]]];
  }

  // Each corner is a quarter circle around a point `radius` in from the corner.
  const corners = [
    [maxX - radius, minY + radius, -90],
    [maxX - radius, maxY - radius, 0],
    [minX + radius, maxY - radius, 90],
    [minX + radius, minY + radius, 180],
  ];
  const ring = [];
  for (const [centreX, centreY, start] of corners) {
    for (let step = 0; step <= CORNER_SEGMENTS; step++) {
      const angle = ((start + (90 * step) / CORNER_SEGMENTS) * Math.PI) / 180;
      ring.push([
        centreX + radius * Math.cos(angle),
        centreY + radius * Math.sin(angle),
      ]);
    }
  }
  return [[ring]];
}

// Independently check the generated backing, including circular chords and
// square edges. Automatic sizing must not mask an actual overflow.
function extendsBeyond(artwork, face, margin) {
  const boundary = face[0][0];
  for (let index = 0; index < boundary.length; index++) {
    const [x, y] = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    const dx = next[0] - x;
    const dy = next[1] - y;
    const length = Math.hypot(dx, dy);
    for (const polygon of artwork) {
      for (const [px, py] of polygon[0]) {
        const clearance = (dx * (py - y) - dy * (px - x)) / length;
        if (clearance < margin - CLEARANCE_TOLERANCE_MM) return true;
      }
    }
  }
  return false;
}

function sizeAroundOrigin(artwork, faceShape) {
  const box = bounds(artwork);
  if (faceShape !== "round") {
    return (
      Math.max(
        Math.abs(box.minX),
        Math.abs(box.maxX),
        Math.abs(box.minY),
        Math.abs(box.maxY),
      ) * 2
    );
  }

  let radius = 0;
  for (const polygon of artwork) {
    for (const [x, y] of polygon[0]) radius = Math.max(radius, Math.hypot(x, y));
  }
  return radius * 2;
}
