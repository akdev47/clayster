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
  if (!engine) throw new Error("The solid geometry engine is not ready.");
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
    const rings = multiPolygon.flatMap((polygon) => polygon);
    const original = keep(new engine.CrossSection(rings, "EvenOdd"));
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
  if (!engine) throw new Error("The solid geometry engine is not ready.");

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
    const insetOffset = keep(original.offset(-minFeature / 2, "Miter", 10));
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

// Use solid booleans for the printable stamp. The clay preview is separate.
export function solidBoolean(first, second, operation) {
  if (!engine) throw new Error("The solid geometry engine is not ready.");
  const temporary = [];
  const keep = (object) => {
    temporary.push(object);
    return object;
  };
  // Convert positions and triangle indices into the format Manifold expects.
  function solid(geometry) {
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
    const result = keep(new engine.Manifold(mesh));
    if (result.status() !== "NoError") {
      throw new Error(
        "A stamp part is not a closed solid. Check the artwork or handle.",
      );
    }
    return result;
  }
  try {
    const a = solid(first);
    const b = solid(second);
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
      throw new Error("The stamp operation did not produce a valid solid.");
    }
    // Return ordinary Three.js geometry for the viewer and exporters.
    const mesh = result.getMesh();
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
  } finally {
    // WASM solids need explicit cleanup, including when a check fails.
    temporary.reverse().forEach((object) => object.delete());
  }
}
