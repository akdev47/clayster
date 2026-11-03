// Builds the printable plate and its artwork, plus a separate mug preview.
import * as THREE from "three";
import { bounds, transform } from "./canonical.js";
import {
  solidBoolean as booleanGeometry,
  extrudeOutline,
  extrudeRoundedPlate,
} from "../solidGeometry.js";
import { UNION, SUBTRACT } from "../combine.js";
import { pressIntoMug, offTheMug } from "./mug.js";
import { featureIssues, overflowIssue } from "./validate.js";
import { createStampLayout, stampFaceShape, stampFaceSize, stampSizeIssue } from "./stampLayout.js";
import { SETTINGS } from "../settings.js";

export { fitToFace } from "./stampLayout.js";

export const DEFAULT_STAMP = {
  faceShape: "minimal", // 'minimal' | 'round' | 'square'
  autoFaceSize: false,
  faceSize: SETTINGS.stamp.faceSizeMm.default,
  faceHeight: null, // null matches faceSize, so the plate stays circular or square.
  faceThickness: SETTINGS.stamp.faceThicknessMm.default,
  reliefDepth: SETTINGS.stamp.reliefDepthMm.default,
  mode: "emboss", // 'emboss' | 'deboss'
  mirror: true,
  margin: SETTINGS.stamp.edgeDistanceMm.default,
  roundedEdges: true, // Softens the top and bottom edge of the plate; the customer can switch it off
  roundedCorners: false, // Square and Minimal only; the customer switches it on
};

export const FACE_THICKNESS_LIMITS = Object.freeze({
  min: SETTINGS.stamp.faceThicknessMm.min,
  max: SETTINGS.stamp.faceThicknessMm.max,
});
export const FACE_SIZE_LIMITS = Object.freeze({
  min: SETTINGS.stamp.faceSizeMm.min,
  max: SETTINGS.stamp.faceSizeMm.max,
});

export function assertFaceSize(value) {
  if (
    !Number.isFinite(value) ||
    value < FACE_SIZE_LIMITS.min ||
    value > FACE_SIZE_LIMITS.max
  ) {
    throw new RangeError(
      `De breedte en hoogte van het stempelvlak moeten tussen ${FACE_SIZE_LIMITS.min} en ${FACE_SIZE_LIMITS.max} mm liggen.`,
    );
  }
  return value;
}

export function assertFaceThickness(value) {
  if (
    !Number.isFinite(value) ||
    value < FACE_THICKNESS_LIMITS.min ||
    value > FACE_THICKNESS_LIMITS.max
  ) {
    throw new RangeError(
      `De basisdikte moet tussen ${FACE_THICKNESS_LIMITS.min} en ${FACE_THICKNESS_LIMITS.max} mm liggen.`,
    );
  }
  return value;
}

const GAP = 10; // Space between the stamp and the mug in the preview.
const OVERLAP = 0.02; // Stops solids meeting on exactly shared planes.

/**
 * Turns validated canonical artwork into the two things the preview shows: the
 * stamp itself, and a mug with the stamp pressed into its side.
 *
 * Everything is millimetres with Z up, so the geometry that comes out is
 * already in the orientation a slicer expects.
 */
export function buildStamp(artwork, params, {
  textGlyphs = [],
  checkPrintability = true,
} = {}) {
  const settings = { ...DEFAULT_STAMP, ...params };
  const requestedFace = stampFaceSize(settings);
  assertFaceSize(requestedFace.width);
  assertFaceSize(requestedFace.height);
  assertFaceThickness(settings.faceThickness);
  settings.faceShape = stampFaceShape(settings.faceShape);
  if (
    settings.mode === "deboss" &&
    settings.reliefDepth >= settings.faceThickness
  ) {
    throw new Error("De reliëfdiepte moet kleiner zijn dan de basisdikte.");
  }
  const notes = [];

  // The shared layout is also rendered in 2D, so fitting and mirroring cannot
  // become a private transform applied only while generating this mesh.
  const layout = createStampLayout(artwork, settings, notes);
  const { artwork: art } = layout;
  const fittedGlyphs = textGlyphs.map((glyph) => ({
    ...glyph,
    canonical: transform(glyph.canonical, layout.artworkTransform),
  }));
  // The pipeline caches these against the artwork and passes false here so a
  // 3D build does not measure the same strokes and gaps again.
  const thinIssues = [];
  if (checkPrintability) {
    thinIssues.push(...featureIssues(art, { textGlyphs: fittedGlyphs }));
    const overflow = overflowIssue(layout);
    if (overflow) thinIssues.push(overflow);
  }

  const tooLarge = stampSizeIssue(layout.widthMm, layout.heightMm);
  if (tooLarge !== null) thinIssues.push(tooLarge);

  if (offTheMug(bounds(art))) {
    notes.push(
      "Het ontwerp is groter dan de wand van een mok, dus in het voorbeeld wordt zoveel mogelijk ervan ingedrukt.",
    );
  }

  const base = buildBase(layout, settings);
  const relief = buildRelief(art, settings);

  // The face is everything that touches clay: the plate plus its artwork.
  const face =
    settings.mode === "emboss"
      ? booleanGeometry(base, relief, UNION, {
          firstLabel: "stempelplaat",
          secondLabel: "reliëf",
        })
      : booleanGeometry(base, relief, SUBTRACT, {
          firstLabel: "stempelplaat",
          secondLabel: "reliëf",
        });

  base.dispose();

  // Only the part that reaches the clay is worth pressing with. Raised
  // artwork is the relief alone — the plate rests on the surface without
  // cutting, and it is far more triangles than the letters are. Recessed
  // artwork presses the plate in too, so there the whole face goes.
  const clay = pressIntoMug(
    settings.mode === "emboss" ? relief : face,
    settings,
  );
  // The stamp is the plate and its artwork; nothing is attached to it.
  const stamp = face;

  relief.dispose();

  // The stamp stands on the plate; the mug stands beside it. It goes on the
  // far side, where something three times the height cannot stand in front of
  // it, and the gap is measured off the finished stamp so an offset plate
  // counts.
  restOnPlate(stamp);
  restOnPlate(clay);
  clay.translate(stamp.boundingBox.min.x - GAP - clay.boundingBox.max.x, 0, 0);

  return {
    stamp,
    clay,
    info: describe(stamp, layout, settings),
    layout,
    notes,
    thinIssues,
  };
}

// The plate is built from the same outline the 2D view and the overflow check
// use (layout.face), so all three always agree. Its edges are rounded by the
// radii in settings.js (stamp.edgeRoundingClaySideMm for the side with the
// letters, stamp.edgeRoundingBackSideMm for the back) unless the customer has
// switched "Rounded edges" off.
function buildBase(layout, settings) {
  const { edgeRoundingClaySideMm, edgeRoundingBackSideMm } = SETTINGS.stamp;
  const rounded = settings.roundedEdges ?? DEFAULT_STAMP.roundedEdges;
  return extrudeRoundedPlate(
    layout.face,
    settings.faceThickness,
    rounded ? edgeRoundingClaySideMm : 0,
    rounded ? edgeRoundingBackSideMm : 0,
  );
}

// Raised artwork stands on top of the plate; recessed artwork is the volume
// that gets cut out of its top face. Either way it is the same extrusion, just
// positioned differently.
//
// The extra OVERLAP matters far more than it looks. Sitting the relief exactly
// on the plate's top face leaves the two coplanar, and coplanar faces are the
// pathological case for CSG: it splits that shared plane against every glyph
// edge, and the boolean goes from milliseconds to minutes. Extruding a hair
// further makes the two solids genuinely overlap instead. The extra is buried
// inside the plate when raised and pokes harmlessly above it when recessed, so
// the finished stamp is identical either way.
function buildRelief(artwork, settings) {
  // Canonical SVG curves have already been adaptively flattened at their final
  // physical size, so the outlines are raised exactly as they are.
  const geometry = extrudeOutline(artwork, settings.reliefDepth + OVERLAP);

  geometry.translate(
    0,
    0,
    settings.mode === "emboss"
      ? settings.faceThickness - OVERLAP
      : settings.faceThickness - settings.reliefDepth,
  );

  return geometry;
}

function restOnPlate(geometry) {
  geometry.computeBoundingBox();
  geometry.translate(0, 0, -geometry.boundingBox.min.z);
  geometry.computeBoundingBox();
}

// Measurements shown in the UI come from the finished mesh.
function describe(stamp, layout, settings) {
  stamp.computeBoundingBox();

  const size = stamp.boundingBox.getSize(new THREE.Vector3());
  const index = stamp.getIndex();
  const vertices =
    index === null ? stamp.getAttribute("position").count : index.count;

  return {
    width: size.x,
    depth: size.y,
    height: size.z,
    faceSize: layout.widthMm,
    faceHeight: layout.heightMm,
    triangles: vertices / 3,
    mode: settings.mode,
  };
}
