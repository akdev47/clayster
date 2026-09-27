// Traces a high-contrast PNG, then reuses the SVG-to-canonical artwork path.
import { parseSVGShapes } from "../loaders.js";
import { tracePNGToSVG } from "../pngTrace.js";
import { fromShapes } from "./canonical.js";
import { scaleToSize } from "./svg.js";

export async function loadPNGArtwork(file, { size = 30 } = {}) {
  const svg = await tracePNGToSVG(file);
  const shapes = parseSVGShapes(svg);
  const artwork = fromShapes(shapes, { flipY: true });
  return scaleToSize(artwork, size);
}
