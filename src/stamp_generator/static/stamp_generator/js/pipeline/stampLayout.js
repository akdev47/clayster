import { bounds, transform } from "./canonical.js";

const FACE_SEGMENTS = 96;
export const MIN_STAMP_MARGIN_MM = 2;

export function stampMargin(settings) {
  const margin = settings.margin ?? MIN_STAMP_MARGIN_MM;
  if (!Number.isFinite(margin)) throw new Error("Stamp margin must be finite.");
  return Math.max(MIN_STAMP_MARGIN_MM, margin);
}

/** Computes the final physical artwork and face shown by both 2D and 3D. */
export function createStampLayout(artwork, settings, notes = []) {
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
  const faceSize =
    settings.faceShape === "outline"
      ? Math.max(faceBounds.width, faceBounds.height)
      : fitted.faceSize;

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

// The backing follows the artwork at its existing physical coordinates. Legacy
// autoFaceSize/faceSize settings never scale or constrain an existing design.
export function fitToFace(artwork, settings, notes = []) {
  const margin = stampMargin(settings);
  if (artwork.length === 0) {
    return {
      art: [],
      faceSize: 50,
      transform: { scale: 1, xMm: 0, yMm: 0 },
    };
  }

  let faceSize = sizeAroundOrigin(artwork, settings.faceShape) + margin * 2;
  if (settings.faceShape === "round") {
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
  if (settings.faceShape === "round") {
    const radius = faceSize / 2;
    return [[Array.from({ length: FACE_SEGMENTS }, (_, index) => {
      const angle = (index / FACE_SEGMENTS) * Math.PI * 2;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    })]];
  }

  if (settings.faceShape === "square") {
    const half = faceSize / 2;
    return [[[
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ]]];
  }

  const points = artwork.flatMap((polygon) => polygon[0]);
  const hull = expand(convexHull(points), stampMargin(settings));
  if (hull.length < 3) {
    return stampFace([], 10, { ...settings, faceShape: "square" });
  }
  return [[hull]];
}

// Independently check the generated backing, including circular chords and
// offset outline edges. Automatic sizing must not mask an actual overflow.
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

// Find the outer envelope, like stretching a rubber band around all points.
function convexHull(points) {
  if (points.length < 3) return points;

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input) => {
    const stack = [];
    for (const point of input) {
      while (
        stack.length >= 2 &&
        cross(stack[stack.length - 2], stack[stack.length - 1], point) <= 0
      ) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop();
    return stack;
  };

  return [...half(sorted), ...half([...sorted].reverse())];
}

function cross(origin, a, b) {
  return (
    (a[0] - origin[0]) * (b[1] - origin[1]) -
    (a[1] - origin[1]) * (b[0] - origin[0])
  );
}

function expand(hull, margin) {
  if (hull.length < 3) return hull;
  // A convex hull is CCW. Offset each supporting edge outwards by margin,
  // then intersect adjacent offset lines. Radial vertex growth would leave
  // less than margin along the edges of long, narrow or acute artwork.
  const normals = hull.map(([x, y], index) => {
    const next = hull[(index + 1) % hull.length];
    const dx = next[0] - x;
    const dy = next[1] - y;
    const length = Math.hypot(dx, dy);
    return [dy / length, -dx / length];
  });
  return hull.map(([x, y], index) => {
    const previous = normals[(index + hull.length - 1) % hull.length];
    const next = normals[index];
    const denominator = 1 + previous[0] * next[0] + previous[1] * next[1];
    if (denominator <= 1e-12) {
      throw new Error("Artwork outline is too acute to create a safe backing.");
    }
    return [
      x + margin * (previous[0] + next[0]) / denominator,
      y + margin * (previous[1] + next[1]) / denominator,
    ];
  });
}
