// Builds the printable backing, artwork, and optional handle, plus a separate mug preview.
import * as THREE from "three";
import { toShapes, bounds } from "./canonical.js";
import { solidBoolean as booleanGeometry } from "../solidGeometry.js";
import { UNION, SUBTRACT } from "../combine.js";
import { pressIntoMug, offTheMug } from "./mug.js";
import { thinFeatureIssues } from "./validate.js";
import { createStampLayout } from "./stampLayout.js";

export { fitToFace } from "./stampLayout.js";

export const DEFAULT_STAMP = {
  faceShape: "round", // 'round' | 'square' | 'outline'
  autoFaceSize: true,
  faceSize: 40,
  faceThickness: 4,
  reliefDepth: 2,
  mode: "emboss", // 'emboss' | 'deboss'
  mirror: true,
  margin: 3,
  handle: "none", // 'none' | 'sample'
};

const GAP = 10; // Space between the stamp and the mug in the preview.
const OVERLAP = 0.02; // Stops solids meeting on exactly shared planes.

/**
 * Turns validated canonical artwork into the two things the preview shows: the
 * stamp itself, and a mug with the stamp pressed into its side.
 *
 * Everything is millimetres with Z up, so the geometry that comes out is
 * already in the orientation a slicer expects.
 */
export function buildStamp(artwork, params, handleGeometry = null) {
  const settings = { ...DEFAULT_STAMP, ...params };
  if (
    settings.mode === "deboss" &&
    settings.reliefDepth >= settings.faceThickness
  ) {
    throw new Error("Recess depth must be smaller than the backing thickness.");
  }
  if (!settings.autoFaceSize && settings.faceSize <= settings.margin * 2) {
    throw new Error("The face must be wider than twice the margin.");
  }
  const notes = [];

  // The shared layout is also rendered in 2D, so fitting and mirroring cannot
  // become a private transform applied only while generating this mesh.
  const layout = createStampLayout(artwork, settings, notes);
  const { artwork: art, faceSize } = layout;
  const thinIssues = thinFeatureIssues(art);

  if (offTheMug(bounds(art))) {
    notes.push(
      "The artwork is bigger than the wall of a mug, so the preview presses in as much of it as fits.",
    );
  }

  const base = buildBase(layout.face, faceSize, settings);
  const relief = buildRelief(art, settings);

  // The face is everything that touches clay: the plate plus its artwork.
  const face =
    settings.mode === "emboss"
      ? booleanGeometry(base, relief, UNION)
      : booleanGeometry(base, relief, SUBTRACT);

  base.dispose();

  // Only the part that reaches the clay is worth pressing with. Raised
  // artwork is the relief alone — the plate rests on the surface without
  // cutting, and it is far more triangles than the letters are. Recessed
  // artwork presses the plate in too, so there the whole face goes.
  const clay = pressIntoMug(
    settings.mode === "emboss" ? relief : face,
    settings,
  );
  const stamp = attachHandle(face, handleGeometry, {
    x: layout.minX + layout.widthMm / 2,
    y: layout.minY + layout.heightMm / 2,
  });

  relief.dispose();

  // The stamp stands on the plate; the mug stands beside it. It goes on the
  // far side, where something three times the height cannot stand in front of
  // it, and the gap is measured off its own bounds so the handle counts too.
  restOnPlate(stamp);
  restOnPlate(clay);
  clay.translate(-(faceSize / 2 + GAP) - clay.boundingBox.max.x, 0, 0);

  return {
    stamp,
    clay,
    info: describe(stamp, faceSize, settings),
    layout,
    notes,
    thinIssues,
  };
}

function buildBase(faceArtwork, faceSize, settings) {
  const thickness = settings.faceThickness;
  let geometry;

  if (settings.faceShape === "round") {
    geometry = new THREE.CylinderGeometry(
      faceSize / 2,
      faceSize / 2,
      thickness,
      96,
    );
    geometry.rotateX(Math.PI / 2); // three builds cylinders Y-up; the app is Z-up.
  } else if (settings.faceShape === "square") {
    geometry = new THREE.BoxGeometry(faceSize, faceSize, thickness);
  } else {
    geometry = extrudeOutline(faceArtwork, thickness);
  }

  geometry.translate(0, 0, thickness / 2); // Sit the plate on z = 0.

  return geometry;
}

function extrudeOutline(faceArtwork, thickness) {
  const hull = faceArtwork[0]?.[0] ?? [];

  if (hull.length < 3) {
    return new THREE.BoxGeometry(10, 10, thickness);
  }

  const shape = new THREE.Shape(hull.map(([x, y]) => new THREE.Vector2(x, y)));

  // Match the centred box/cylinder: buildBase then moves the bottom to Z = 0.
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  }).translate(0, 0, -thickness / 2);
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
  // No curveSegments here on purpose: canonical SVG curves have already been
  // adaptively flattened at their final physical size.
  const geometry = new THREE.ExtrudeGeometry(toShapes(artwork), {
    depth: settings.reliefDepth + OVERLAP,
    bevelEnabled: false,
  });

  geometry.translate(
    0,
    0,
    settings.mode === "emboss"
      ? settings.faceThickness - OVERLAP
      : settings.faceThickness - settings.reliefDepth,
  );

  return geometry;
}

// The handle hangs below the plate, so the finished stamp stands on it the way
// it would on a table, with the artwork facing up where you can see it.
function attachHandle(face, handleGeometry, faceCentre) {
  if (handleGeometry === null) return face.clone();

  const handle = handleGeometry.clone();
  handle.computeBoundingBox();

  const box = handle.boundingBox;
  const centre = box.getCenter(new THREE.Vector3());
  handle.translate(
    faceCentre.x - centre.x,
    faceCentre.y - centre.y,
    -box.max.z + OVERLAP,
  ); // Overlap, not butt.

  const stamp = booleanGeometry(face, handle, UNION);
  handle.dispose();

  return stamp;
}

function restOnPlate(geometry) {
  geometry.computeBoundingBox();
  geometry.translate(0, 0, -geometry.boundingBox.min.z);
  geometry.computeBoundingBox();
}

// Measurements shown in the UI come from the finished mesh, including its handle.
function describe(stamp, faceSize, settings) {
  stamp.computeBoundingBox();

  const size = stamp.boundingBox.getSize(new THREE.Vector3());
  const index = stamp.getIndex();
  const vertices =
    index === null ? stamp.getAttribute("position").count : index.count;

  return {
    width: size.x,
    depth: size.y,
    height: size.z,
    faceSize,
    triangles: vertices / 3,
    mode: settings.mode,
  };
}
