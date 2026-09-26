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
