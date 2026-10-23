import { bounds, transform } from "./canonical.js";
import { SETTINGS } from "../settings.js";

const FACE_SEGMENTS = 96;
export const MIN_STAMP_MARGIN_MM = SETTINGS.stamp.edgeDistanceMm.min;
export const MAX_STAMP_MARGIN_MM = SETTINGS.stamp.edgeDistanceMm.max;

export function stampFaceShape(shape = "round") {
  // Designs made before Artwork was removed retain their artwork unchanged.
  if (shape === "outline") return "square";
  if (shape === "round" || shape === "square" || shape === "minimal") return shape;
  throw new Error("Unsupported stamp shape. Choose Round, Square, or Minimal.");
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
    return [[[
      [box.minX - margin, box.minY - margin],
      [box.maxX + margin, box.minY - margin],
      [box.maxX + margin, box.maxY + margin],
      [box.minX - margin, box.maxY + margin],
    ]]];
  }

  const half = faceSize / 2;
  return [[[
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]]];
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
        if ((dx * (py - y) - dy * (px - x)) / length < margin - 1e-6) return true;
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
