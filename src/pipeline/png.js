// Traces a high-contrast PNG, then reuses the SVG-to-canonical artwork path.
import { parseSVGShapes } from "../loaders.js";
import { tracePNGToSVG } from "../pngTrace.js";
import {
  fromShapes,
  bounds,
  removeShortEdges,
  simplify,
} from "./canonical.js";
import { scaleToSize } from "./svg.js";

const MIN_TRACE_TOLERANCE_MM = 0.05;
const MAX_TRACE_TOLERANCE_MM = 0.5;
export const DEFAULT_PNG_SMOOTHING = 2;

export async function loadPNGArtwork(
  file,
  { size = 30, smoothing = DEFAULT_PNG_SMOOTHING } = {},
) {
  const svg = await tracePNGToSVG(file);
  const shapes = parseSVGShapes(svg);
  const artwork = fromShapes(shapes, { flipY: true });
  return postProcessPNGArtwork(artwork, size, { smoothing });
}

// Raster contours inherently carry a few pixels of edge and threshold noise.
// The default absorbs up to two source pixels after scaling; the UI strength
// adjusts that physical error bound and its cap together.
export function postProcessPNGArtwork(
  artwork,
  size,
  { smoothing = DEFAULT_PNG_SMOOTHING } = {},
) {
  const box = bounds(artwork);
  const sourceSize = Math.max(box.width, box.height);
  if (sourceSize === 0) return artwork;

  const millimetresPerPixel = size / sourceSize;
  const strength = Math.max(0, smoothing);
  const tolerance =
    strength === 0
      ? 0
      : Math.min(
          MAX_TRACE_TOLERANCE_MM * (strength / DEFAULT_PNG_SMOOTHING),
          Math.max(
            MIN_TRACE_TOLERANCE_MM * (strength / DEFAULT_PNG_SMOOTHING),
            millimetresPerPixel * strength,
          ),
        );
  const scaled = scaleToSize(artwork, size);

  return removeShortEdges(simplify(scaled, tolerance));
}
