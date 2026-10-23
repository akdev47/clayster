// Traces a high-contrast PNG, then reuses the SVG-to-canonical artwork path.
import { parseSVGShapes } from "../loaders.js";
import {
  DEFAULT_PNG_BACKGROUND_MODE,
  tracePNGToSVGDetails,
} from "../pngTrace.js";
import {
  fromShapes,
  bounds,
  removeShortEdges,
  simplify,
} from "./canonical.js";
import { scaleToSize } from "./svg.js";
import { SETTINGS } from "../settings.js";

const MIN_TRACE_TOLERANCE_MM = SETTINGS.images.png.traceToleranceMm.min;
const MAX_TRACE_TOLERANCE_MM = SETTINGS.images.png.traceToleranceMm.max;
export const DEFAULT_PNG_SMOOTHING = SETTINGS.images.png.smoothing.default;

export async function loadPNGArtwork(
  file,
  options = {},
) {
  return (await loadPNGArtworkDetails(file, options)).artwork;
}

export async function loadPNGArtworkDetails(
  file,
  {
    size = 30,
    smoothing = DEFAULT_PNG_SMOOTHING,
    backgroundMode = DEFAULT_PNG_BACKGROUND_MODE,
    backgroundSamples = [],
    backgroundTolerance,
  } = {},
) {
  const traced = await tracePNGToSVGDetails(file, {
    backgroundMode,
    backgroundSamples,
    backgroundTolerance,
  });
  const shapes = parseSVGShapes(traced.svg);
  const artwork = fromShapes(shapes, { flipY: true });
  return {
    artwork: postProcessPNGArtwork(artwork, size, { smoothing }),
    issues: traced.issues,
    segmentation: traced.segmentation,
  };
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
