import { bounds, transform } from "./canonical.js";

const FACE_SEGMENTS = 96;

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
  const faceBounds = bounds(face);
  const faceSize =
    settings.faceShape === "outline"
      ? Math.max(faceBounds.width, faceBounds.height)
      : fitted.faceSize;

  return {
    artwork: fitted.art,
    artworkTransform,
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

// Auto sizing grows a face centred on the shared origin, preserving element
// coordinates. Fixed sizing scales about that same origin only when required.
export function fitToFace(artwork, settings, notes = []) {
  if (artwork.length === 0) {
    return {
      art: [],
      faceSize: settings.faceSize,
      transform: { scale: 1, xMm: 0, yMm: 0 },
    };
  }

  const artSize = sizeAroundOrigin(artwork, settings.faceShape);

  if (settings.autoFaceSize) {
    const applied = { scale: 1, xMm: 0, yMm: 0 };
    return {
      art: transform(artwork, applied),
      faceSize: artSize + settings.margin * 2,
      transform: applied,
    };
  }

  const faceSize = settings.faceSize;
  const available = faceSize - settings.margin * 2;
  const scale = artSize > available && artSize !== 0 ? available / artSize : 1;

  if (scale < 1) {
    notes.push(
      `Artwork was scaled to ${Math.round(scale * 100)}% to fit the ${faceSize} mm face.`,
    );
  }

  const applied = { scale, xMm: 0, yMm: 0 };
  return {
    art: transform(artwork, applied),
    faceSize,
    transform: applied,
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
  const hull = expand(convexHull(points), settings.margin);
  if (hull.length < 3) {
    return stampFace([], 10, { ...settings, faceShape: "square" });
  }
  return [[hull]];
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

  return (
    Math.max(
      Math.hypot(box.minX, box.minY),
      Math.hypot(box.minX, box.maxY),
      Math.hypot(box.maxX, box.minY),
      Math.hypot(box.maxX, box.maxY),
    ) * 2
  );
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
  if (hull.length === 0) return [];
  const centreX = hull.reduce((total, [x]) => total + x, 0) / hull.length;
  const centreY = hull.reduce((total, [, y]) => total + y, 0) / hull.length;

  return hull.map(([x, y]) => {
    const dx = x - centreX;
    const dy = y - centreY;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * margin, y + (dy / length) * margin];
  });
}
