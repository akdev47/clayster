// Converts loaded SVG outlines to the same millimetre-based polygons as the text input.
import { loadSVGData } from "../loaders.js";
import {
  fromShapes,
  bounds,
  removeShortEdges,
  GEOMETRY_TOLERANCE_MM,
} from "./canonical.js";

export const SVG_SIMPLIFY_TOLERANCE_MM = GEOMETRY_TOLERANCE_MM / 2;

// SVG user units mean nothing in millimetres — a drawing is commonly hundreds
// of units across — so an uploaded file is scaled to a stated artwork size the
// same way the text source is driven by its point size. Both sources then hand
// the rest of the pipeline artwork that is already the right size.
export async function loadSVGArtwork(source, { size = 30 } = {}) {
  return (await loadSVGArtworkDetails(source, { size })).artwork;
}

export async function loadSVGArtworkDetails(source, { size = 30 } = {}) {
  const { shapes, viewport } = await loadSVGData(source);
  const artwork = canonicalizeSVGShapes(shapes, viewport, size);

  return {
    artwork,
    shapeCount: shapes.length,
    polygonCount: artwork.length,
  };
}

export function canonicalizeSVGShapes(shapes, viewport, size) {
  // A cheap first pass estimates the conversion from SVG units to final mm.
  // The second pass then samples each curve to a physical error tolerance, so
  // larger stamps receive more points instead of exposing a fixed polygon.
  const probe = applySVGViewport(
    fromShapes(shapes, { flipY: true, curveSegments: 12 }),
    viewport,
  );
  const probeBounds = bounds(probe);
  const largest = Math.max(probeBounds.width, probeBounds.height);
  if (largest === 0) return probe;

  const millimetresPerViewportUnit = size / largest;
  const viewportScale = Math.max(
    Math.abs(viewport.scaleX ?? 1),
    Math.abs(viewport.scaleY ?? 1),
  );
  const sourceTolerance =
    SVG_SIMPLIFY_TOLERANCE_MM /
    (millimetresPerViewportUnit * viewportScale);
  const sampled = applySVGViewport(
    fromShapes(shapes, { flipY: true, curveTolerance: sourceTolerance }),
    viewport,
  );

  return removeShortEdges(scaleToSize(sampled, size));
}

export function applySVGViewport(
  multiPolygon,
  { scaleX = 1, scaleY = 1, translateX = 0, translateY = 0 } = {},
) {
  return multiPolygon.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [
        x * scaleX + translateX,
        y * scaleY - translateY,
      ]),
    ),
  );
}

// Set the longest side to the requested size without stretching the design.
export function scaleToSize(multiPolygon, size) {
  const box = bounds(multiPolygon);
  const largest = Math.max(box.width, box.height);

  if (largest === 0) return multiPolygon;

  const scale = size / largest;
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [(x - centreX) * scale, (y - centreY) * scale]),
    ),
  );
}
