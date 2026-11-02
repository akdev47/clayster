// Bridges Three.js meshes and Manifold, which joins or cuts the printable solids.
import * as THREE from "three";
import ManifoldModule from "manifold-3d";

let engine;
let loading;

// The browser supplies Vite's WASM URL; Node tests use the package's own file.
export async function initializeSolids(wasmUrl) {
  loading ??= ManifoldModule(wasmUrl ? { locateFile: () => wasmUrl } : {})
    .then((module) => {
      module.setup();
      engine = module;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    });
  await loading;
}

// Grows (positive) or shrinks (negative) a canonical multipolygon by `delta`
// millimetres on every side, so strokes get 2 * delta thicker or thinner.
// Needs initializeSolids() to have finished.
export function offsetOutline(multiPolygon, delta) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");
  if (delta === 0 || multiPolygon.length === 0) return multiPolygon;

  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  const area = (ring) =>
    ring.reduce((sum, [x, y], i) => {
      const [nextX, nextY] = ring[(i + 1) % ring.length];
      return sum + (x * nextY - nextX * y);
    }, 0) / 2;

  try {
    // Each glyph owns its holes; different glyphs add together. Flattening all
    // rings into one even-odd section would erase overlapping letter strokes.
    const glyphs = multiPolygon.map((polygon) =>
      keep(new engine.CrossSection(polygon, "EvenOdd")),
    );
    const original = keep(engine.CrossSection.union(glyphs));
    const grown = keep(original.offset(delta, "Round", 2, 16));
    return keep(grown.simplify(1e-6))
      .decompose()
      .map((component) => {
        temporary.push(component);
        const rings = component.toPolygons();
        const outer = rings.reduce((best, ring) =>
          area(ring) > area(best) ? ring : best,
        );
        return [outer, ...rings.filter((ring) => ring !== outer)];
      });
  } finally {
    temporary.reverse().forEach((object) => object.delete());
  }
}

// Estimates local printable width by opening a filled 2D polygon: inset by
// half the minimum feature, then expand by the same amount. Thin regions are
// removed or disconnected by that operation even when the polygon is large
// overall. The input and thresholds are already in final physical millimetres.
export function hasThinCrossSection(
  polygon,
  minFeature,
  { simplifyTolerance = 1e-6, meaningfulArea = 0.01 } = {},
) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");

  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  const componentCount = (crossSection) => {
    const components = crossSection.decompose();
    temporary.push(...components);
    return components.length;
  };

  try {
    // Even-odd filling preserves canonical holes without depending on winding.
    const original = keep(new engine.CrossSection(polygon, "EvenOdd"));
    const originalComponents = componentCount(original);
    // A circular measurement radius must not grow acute corner miters far
    // beyond the requested physical inset. Reconstruction remains mitered.
    const insetOffset = keep(original.offset(-minFeature / 2, "Round", 10, 64));
    const inset = keep(insetOffset.simplify(simplifyTolerance));

    if (inset.isEmpty()) return true;
    if (
      componentCount(inset) !== originalComponents ||
      inset.numContour() !== original.numContour()
    ) {
      return true;
    }

    const expandedOffset = keep(inset.offset(minFeature / 2, "Miter", 10));
    const expanded = keep(expandedOffset.simplify(simplifyTolerance));
    const lost = keep(original.subtract(expanded));

    return lost.area() > meaningfulArea;
  } finally {
    temporary.reverse().forEach((object) => object.delete());
  }
}

// Closes a multipolygon by `minGap / 2` on every side. A drop in component
// count means separate shapes were closer than `minGap`. A drop in hole count
// means an enclosed opening was narrower than `minGap`. A fillet in a concave
// corner changes neither count.
export function gapClosure(multiPolygon, minGap) {
  return withCrossSections((keep) => {
    const original = asSection(multiPolygon, keep);
    if (original === null || original.isEmpty()) {
      return { merged: false, filledHoles: false };
    }
    const before = topology(original, keep);
    const after = topology(closeSection(original, minGap, keep), keep);
    return {
      merged: after.components < before.components,
      filledHoles: after.holes < before.holes,
    };
  });
}

// True when the clear space between the two groups is under `minGap`,
// including when they already overlap. Gaps inside one group do not count.
export function groupsCloserThan(first, second, minGap) {
  return withCrossSections((keep) => {
    const groupA = asSection(first, keep);
    const groupB = asSection(second, keep);
    if (groupA === null || groupB === null || groupA.isEmpty() || groupB.isEmpty()) {
      return false;
    }
    const closedA = topology(closeSection(groupA, minGap, keep), keep).components;
    const closedB = topology(closeSection(groupB, minGap, keep), keep).components;
    const both = keep(engine.CrossSection.union([groupA, groupB]));
    const closedBoth = topology(closeSection(both, minGap, keep), keep).components;
    return closedBoth < closedA + closedB;
  });
}

function withCrossSections(action) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");
  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  try {
    return action(keep);
  } finally {
    temporary.reverse().forEach((object) => object.delete());
  }
}

function asSection(multiPolygon, keep) {
  const sections = multiPolygon
    .filter((polygon) => polygon.length > 0 && polygon[0].length >= 3)
    .map((polygon) => keep(new engine.CrossSection(polygon, "EvenOdd")));
  if (sections.length === 0) return null;
  return keep(engine.CrossSection.union(sections));
}

function closeSection(section, minGap, keep) {
  const expanded = keep(keep(section.offset(minGap / 2, "Round", 10, 64)).simplify(1e-6));
  return keep(keep(expanded.offset(-(minGap / 2), "Round", 10, 64)).simplify(1e-6));
}

function topology(section, keep) {
  const parts = section.decompose();
  for (const part of parts) keep(part);
  const components = parts.length;
  return { components, holes: section.numContour() - components };
}

// Use solid booleans for the printable stamp. The clay preview is separate.
export function solidBoolean(
  first,
  second,
  operation,
  { firstLabel = "eerste stempeldeel", secondLabel = "tweede stempeldeel" } = {},
) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");
  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  // Convert positions and triangle indices into the format Manifold expects.
  function solid(geometry, label) {
    const position = geometry.getAttribute("position");
    const coordinates = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      coordinates.set(
        [position.getX(i), position.getY(i), position.getZ(i)],
        i * 3,
      );
    }
    const triangles = geometry.index
      ? new Uint32Array(geometry.index.array)
      : Uint32Array.from({ length: position.count }, (_, i) => i);
    const mesh = new engine.Mesh({
      numProp: 3,
      vertProperties: coordinates,
      triVerts: triangles,
    });
    // Primitive geometries repeat corners for shading. Join coincident corners.
    mesh.merge();
    let result;
    try {
      result = keep(new engine.Manifold(mesh));
    } catch (error) {
      throw new Error(
        `${capitalize(label)} is geen gesloten (manifold) volume: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    if (result.status() !== "NoError") {
      throw new Error(
        `${capitalize(label)} is geen gesloten (manifold) volume: ${result.status()}`,
      );
    }
    return result;
  }
  try {
    const a = solid(first, firstLabel);
    const b = solid(second, secondLabel);
    const result = keep(
      operation === "union"
        ? a.add(b)
        : operation === "subtract"
          ? a.subtract(b)
          : (() => {
              throw new Error("Unknown solid operation.");
            })(),
    );
    if (
      result.status() !== "NoError" ||
      result.isEmpty() ||
      result.volume() <= 0
    ) {
      throw new Error("De stempelbewerking leverde geen geldig volume op.");
    }
    return toGeometry(result);
  } finally {
    // WASM solids need explicit cleanup, including when a check fails.
    temporary.reverse().forEach((object) => object.delete());
  }
}

// Ordinary Three.js geometry for the viewer and exporters.
function toGeometry(solid) {
  const mesh = solid.getMesh();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(mesh.vertProperties, 3),
  );
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1),
  );
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Raises a canonical multipolygon (outer ring first, then its holes) straight
 * up by `depth` millimetres into a closed solid that stands on z = 0.
 *
 * Manifold triangulates the top and bottom itself. Three.js's ExtrudeGeometry
 * does not: it joins every hole to the outline with a straight bridge, and when
 * other points of the shape lie exactly on that bridge (for example along the
 * straight edge of a rectangle that text overlaps) the mesh gets overlapping
 * edges and is no longer a closed solid. That only happened at certain sizes
 * and positions, which made it hard to spot. Needs initializeSolids() to have
 * finished.
 */
export function extrudeOutline(multiPolygon, depth) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");
  if (!(depth > 0)) throw new RangeError("The extrusion depth must be above 0.");
  if (multiPolygon.length === 0) return new THREE.BufferGeometry();

  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  try {
    // Each polygon owns its holes; separate polygons add together. Even-odd
    // filling keeps the holes without depending on how the rings wind.
    const outlines = multiPolygon.map((polygon) =>
      keep(new engine.CrossSection(polygon, "EvenOdd")),
    );
    const section = keep(engine.CrossSection.union(outlines));
    if (section.isEmpty()) return new THREE.BufferGeometry();

    const solid = keep(engine.Manifold.extrude(section, depth));
    if (solid.status() !== "NoError" || solid.isEmpty()) {
      throw new Error("Het ontwerp kon niet tot een gesloten volume worden opgetrokken.");
    }
    return toGeometry(solid);
  } finally {
    temporary.reverse().forEach((object) => object.delete());
  }
}

// How many slices a quarter-circle edge is built from. Six slices of 15 degrees
// keep the facets within 0.02 mm of a true curve for a rounding up to 2 mm,
// well below what a 0.4 mm nozzle can print.
const ROUNDING_STEPS = 6;

/**
 * A flat plate standing on z = 0, `thickness` millimetres tall, whose top edge
 * is rounded with a quarter circle of radius `topRounding` and whose bottom edge
 * is rounded with `bottomRounding` (the same as the top when left out; 0 leaves
 * that edge sharp). The larger a rounding is, the further from the edge its
 * curve begins.
 *
 * `multiPolygon` is the plate's outline (one polygon, no holes) and it must be
 * convex, like a circle or a rectangle: the plate is the convex hull of the
 * outline at a few heights, shrunk in as the rounding curves away. That makes
 * it a closed solid by construction. A concave outline would be filled in
 * silently, so it is refused instead.
 *
 * The two curves share the plate's height: together they are never taller than
 * the thickness (if they would be, both shrink in proportion), and neither is
 * more than 40% of the narrowest width. Needs initializeSolids() to have
 * finished.
 */
export function extrudeRoundedPlate(
  multiPolygon,
  thickness,
  topRounding,
  bottomRounding = topRounding,
) {
  if (!engine) throw new Error("De 3D-rekenmodule is nog niet klaar.");
  if (!(thickness > 0)) throw new RangeError("The plate thickness must be above 0.");
  if (!(topRounding >= 0) || !(bottomRounding >= 0)) {
    throw new RangeError("The edge rounding cannot be negative.");
  }

  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  const ringsAt = (section, height) =>
    section
      .toPolygons()
      .flatMap((polygon) => polygon.map(([x, y]) => [x, y, height]));

  try {
    const outlines = multiPolygon.map((polygon) =>
      keep(new engine.CrossSection(polygon, "EvenOdd")),
    );
    const section = keep(engine.CrossSection.union(outlines));
    if (section.isEmpty()) throw new Error("De plaat heeft geen omtrek.");

    // The plain plate, and proof that the outline is convex: the hull of its
    // top and bottom rings only has the same volume when nothing is hollow.
    const plain = keep(engine.Manifold.extrude(section, thickness));
    const hull = keep(
      engine.Manifold.hull([...ringsAt(section, 0), ...ringsAt(section, thickness)]),
    );
    if (hull.volume() > plain.volume() * (1 + 1e-6)) {
      throw new Error("Een plaat met afgeronde randen heeft een convexe omtrek nodig.");
    }

    const { min, max } = section.bounds();
    const narrowest = Math.min(max[0] - min[0], max[1] - min[1]);
    const together = topRounding + bottomRounding;
    const fit = together > thickness ? thickness / together : 1;
    const top = Math.min(topRounding * fit, narrowest * 0.4);
    const bottom = Math.min(bottomRounding * fit, narrowest * 0.4);
    if (top < 0.01 && bottom < 0.01) return toGeometry(plain);

    // A quarter circle with its centre `radius` in from the edge and `radius`
    // away from the flat face: at angle 0 it meets the side wall, at 90 degrees
    // the flat face. `direction` is +1 for the top edge and -1 for the bottom.
    const points = [];
    const addEdge = (radius, faceHeight, direction) => {
      if (radius < 0.01) {
        points.push(...ringsAt(section, faceHeight));
        return;
      }
      for (let step = 0; step <= ROUNDING_STEPS; step++) {
        const angle = (Math.PI / 2) * (step / ROUNDING_STEPS);
        const inset = radius * (1 - Math.cos(angle));
        const height = faceHeight - direction * radius * (1 - Math.sin(angle));
        const ring =
          inset === 0 ? section : keep(section.offset(-inset, "Round", 2, 16));
        points.push(...ringsAt(ring, height));
      }
    };
    addEdge(top, thickness, 1);
    addEdge(bottom, 0, -1);

    const plate = keep(engine.Manifold.hull(points));
    if (plate.status() !== "NoError" || plate.isEmpty()) {
      throw new Error("De plaat kon niet als gesloten volume worden opgebouwd.");
    }
    return toGeometry(plate);
  } finally {
    temporary.reverse().forEach((object) => object.delete());
  }
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function errorMessage(error) {
  return String(error?.message ?? "ongeldig oppervlak").split("\n", 1)[0];
}
