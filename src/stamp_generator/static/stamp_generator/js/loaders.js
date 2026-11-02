// Reads SVG outlines and turns them into filled shapes.
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import {
  validateSVGDocument,
  getFilledSVGShapes,
  getSVGViewportTransform,
} from "./svgValidation.js";

const svgLoader = new SVGLoader();

// The loader takes either a URL (for the bundled samples) or a File picked by
// the user, which we have to read ourselves before handing it to parse().

export async function loadSVGShapes(source) {
  return (await loadSVGData(source)).shapes;
}

export async function loadSVGData(source) {
  let text;
  try {
    if (source instanceof File) {
      text = await source.text();
    } else {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Het SVG-bestand kon niet worden geladen.");
      text = await response.text();
    }
  } catch (error) {
    throw withSVGStage(error, "SVG loading");
  }

  try {
    return parseSVGData(text);
  } catch (error) {
    throw withSVGStage(error, "SVG parsing");
  }
}

// Traced raster artwork stays internal: it enters at the same validated SVG
// boundary as uploaded vector artwork, without creating a user-facing file.
export function parseSVGShapes(text) {
  return parseSVGData(text).shapes;
}

function parseSVGData(text) {
  validateSVGDocument(text);
  const data = svgLoader.parse(text);
  return {
    shapes: getFilledSVGShapes(data),
    viewport: getSVGViewportTransform(data.xml),
  };
}

function withSVGStage(error, stage) {
  if (error?.svgStage) return error;

  const message =
    stage === "SVG loading"
      ? "Het SVG-bestand kon niet worden geladen."
      : "Het SVG-bestand kon niet worden gelezen.";
  const diagnosed = new Error(message, { cause: error });
  diagnosed.svgStage = stage;
  return diagnosed;
}
