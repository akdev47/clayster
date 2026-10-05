// Reads STL meshes and SVG outlines, with helpers for SVG extrusion and sizing.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import {
  validateSVGDocument,
  getFilledSVGShapes,
  getSVGViewportTransform,
} from "./svgValidation.js";

const stlLoader = new STLLoader();
const svgLoader = new SVGLoader();

// Both loaders take either a URL (for the bundled samples) or a File picked by
// the user, which we have to read ourselves before handing it to parse().

export async function loadSTLGeometry(source) {
  const geometry =
    source instanceof File
      ? stlLoader.parse(await source.arrayBuffer())
      : await stlLoader.loadAsync(source);

  // Recalculate surface directions for lighting; this does not repair holes in an STL.
  geometry.computeVertexNormals();

  return geometry;
}

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
      if (!response.ok) throw new Error("Could not load the SVG file.");
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
      ? "Could not load the SVG file."
      : "The SVG could not be parsed.";
  const diagnosed = new Error(message, { cause: error });
  diagnosed.svgStage = stage;
  return diagnosed;
}

// Give flat outlines thickness by adding front, back, and side faces.
export function extrudeShapes(shapes, depth) {
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  });

  flipY(geometry);

  return geometry;
}

// SVG counts Y downwards, so an extruded shape comes out upside down and
// mirrored. Scaling by -1 puts it the right way up but turns every triangle
// inside out, which is why the winding is reversed straight after.
function flipY(geometry) {
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1));
  reverseWinding(geometry);
  geometry.computeVertexNormals();
}

function reverseWinding(geometry) {
  const index = geometry.getIndex();

  if (index !== null) {
    const array = index.array;
    for (let i = 0; i < array.length; i += 3) {
      const first = array[i];
      array[i] = array[i + 2];
      array[i + 2] = first;
    }
    index.needsUpdate = true;
    return;
  }

  for (const attribute of Object.values(geometry.attributes)) {
    const { array, itemSize } = attribute;
    for (let i = 0; i < array.length; i += itemSize * 3) {
      for (let k = 0; k < itemSize; k++) {
        const a = i + k;
        const c = i + itemSize * 2 + k;
        const first = array[a];
        array[a] = array[c];
        array[c] = first;
      }
    }
    attribute.needsUpdate = true;
  }
}

// SVG user units are unrelated to millimetres — a drawing is commonly hundreds
// of units across — so the XY plane is scaled to a printable size while the
// extrusion depth stays in real millimetres. Scaling the whole thing uniformly
// instead would shrink a 4 mm stamp face to a fraction of a millimetre.
export function buildSVGGeometry(shapes, depthMillimetres, xyFactor) {
  const geometry = extrudeShapes(shapes, depthMillimetres);
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(xyFactor, xyFactor, 1));
  return geometry;
}

// How many millimetres one SVG unit becomes, so the drawing imports at a size
// that fits on a build plate.
export function svgFitFactor(shapes, targetMillimetres) {
  const probe = extrudeShapes(shapes, 1);
  probe.computeBoundingBox();

  const size = probe.boundingBox.getSize(new THREE.Vector3());
  probe.dispose();

  return targetMillimetres / Math.max(size.x, size.y);
}
