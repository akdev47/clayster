// Checks the finished stamp for surface defects and verifies the exported STL bytes.
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { MeshBVH } from "three-mesh-bvh";

// Check the finished surface, not just the original 2D drawing.
// This catches topology problems; it does not certify wall thickness or printing.
export function prepareClosedStamp(source) {
  const position = source?.getAttribute("position");
  const count = source?.index?.count ?? position?.count ?? 0;
  if (!position || count === 0 || count % 3 !== 0) {
    throw new Error("Export blocked: no valid triangles to export.");
  }
  const vertices = [];
  const vertexIds = new Map();
  const triangles = [];
  const edges = new Map();
  const faces = new Set();
  // Shells are connected through shared edges. Sharing only a vertex does not
  // make two closed surfaces one manifold shell.
  const parents = Array.from({ length: count / 3 }, (_, id) => id);
  const root = (id) => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  // Give identical corners one shared index, even if shading duplicated them.
  for (let i = 0; i < count; i++) {
    const index = source.index ? source.index.getX(i) : i;
    if (!Number.isInteger(index) || index < 0 || index >= position.count) {
      throw new Error("Export blocked: invalid triangle index.");
    }
    // Check at STL's float32 precision. Never round away or fill actual holes.
    const point = [
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    ].map(Math.fround);
    if (!point.every(Number.isFinite))
      throw new Error("Export blocked: invalid coordinates.");
    const key = point.join(",");
    if (!vertexIds.has(key)) {
      const id = vertices.length / 3;
      vertexIds.set(key, id);
      vertices.push(...point);
    }
    triangles.push(vertexIds.get(key));
  }
  const box = new THREE.Box3();
  for (let i = 0; i < vertices.length; i += 3)
    box.expandByPoint(new THREE.Vector3().fromArray(vertices, i));
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const cross = new THREE.Vector3(),
    edge = new THREE.Vector3(),
    point = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = triangles.slice(i, i + 3);
    const triangleId = i / 3;
    a.fromArray(vertices, ids[0] * 3).sub(centre);
    b.fromArray(vertices, ids[1] * 3).sub(centre);
    c.fromArray(vertices, ids[2] * 3).sub(centre);
    if (cross.subVectors(b, a).cross(edge.subVectors(c, a)).lengthSq() === 0) {
      throw new Error("Export blocked: collapsed triangle detected.");
    }
    // Signed volume also tells us whether the surface faces outward or inward.
    volume += a.dot(cross.copy(b).cross(c)) / 6;
    const face = [...ids].sort((x, y) => x - y).join(",");
    if (faces.has(face))
      throw new Error("Export blocked: duplicate triangle detected.");
    faces.add(face);
    for (const [x, y] of [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[0]],
    ]) {
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      const value = edges.get(key) ?? {
        count: 0,
        direction: 0,
        triangles: [],
      };
      value.count++;
      value.direction += x < y ? 1 : -1;
      value.triangles.push(triangleId);
      edges.set(key, value);
    }
  }
  // A closed, consistently oriented surface uses every edge twice, in opposite directions.
  const open = [...edges.values()].filter((edge) => edge.count === 1).length;
  const invalid = [...edges.values()].filter(
    (edge) => edge.count !== 2 || edge.direction !== 0,
  ).length;
  if (invalid)
    throw new Error(
      `Export blocked: ${open} open edges and ${invalid - open} inconsistent or non-manifold edges. Rebuild or repair the stamp.`,
    );

  for (const edgeInfo of edges.values()) {
    parents[root(edgeInfo.triangles[0])] = root(edgeInfo.triangles[1]);
  }

  // A hollow solid has an outer surface and inward-facing cavity surfaces.
  // Track edge-connected shells so vertex-only contact cannot join solids.
  const shells = new Map();
  const vertexShells = Array.from(
    { length: vertices.length / 3 },
    () => new Set(),
  );
  for (let i = 0; i < triangles.length; i += 3) {
    const triangleId = i / 3;
    const id = root(triangleId);
    const shell = shells.get(id) ?? {
      box: new THREE.Box3(),
      triangles: [],
      volume: 0,
    };
    shell.triangles.push(triangleId);

    for (const vertexId of triangles.slice(i, i + 3)) {
      vertexShells[vertexId].add(id);
      shell.box.expandByPoint(point.fromArray(vertices, vertexId * 3));
    }

    a.fromArray(vertices, triangles[i] * 3).sub(centre);
    b.fromArray(vertices, triangles[i + 1] * 3).sub(centre);
    c.fromArray(vertices, triangles[i + 2] * 3).sub(centre);
    shell.volume += a.dot(cross.copy(b).cross(c)) / 6;
    shells.set(id, shell);
  }

  if (vertexShells.some((memberships) => memberships.size > 1)) {
    throw new Error(
      "Export blocked: closed shells touch only at a vertex, creating a non-manifold connection.",
    );
  }

  const outward = [...shells.values()].filter((shell) => shell.volume > 0);
  if (outward.length !== 1) {
    throw new Error(
      "Export blocked: the stamp has disconnected pieces. Adjust the backing or handle.",
    );
  }

  const outer = outward[0];
  for (const cavity of [...shells.values()].filter(
    (shell) => shell.volume < 0,
  )) {
    if (!containsShell(outer, cavity, vertices, triangles)) {
      throw new Error(
        "Export blocked: an inward-facing shell is not a contained cavity.",
      );
    }
  }

  if (
    volume <= 0 ||
    !Number.isFinite(volume) ||
    [...shells.values()].some((shell) => shell.volume === 0) ||
    Math.min(size.x, size.y, size.z) <= 0
  ) {
    throw new Error(
      "Export blocked: the stamp has no positive enclosed volume.",
    );
  }
  // Return a new indexed mesh; leave the original preview geometry untouched.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(triangles);
  geometry.boundingBox = box;
  return geometry;
}

function containsShell(outer, inner, vertices, triangles) {
  if (!outer.box.containsBox(inner.box)) return false;

  const outerGeometry = shellGeometry(outer, vertices, triangles);
  const innerGeometry = shellGeometry(inner, vertices, triangles);
  try {
    const outerTree = new MeshBVH(outerGeometry);
    innerGeometry.boundsTree = new MeshBVH(innerGeometry);
    if (outerTree.intersectsGeometry(innerGeometry, new THREE.Matrix4())) {
      return false;
    }

    const vertexId = triangles[inner.triangles[0] * 3];
    const point = new THREE.Vector3().fromArray(vertices, vertexId * 3);
    return pointInsideShell(point, outer, vertices, triangles);
  } finally {
    outerGeometry.dispose();
    innerGeometry.dispose();
  }
}

function shellGeometry(shell, vertices, triangles) {
  const indices = [];
  for (const triangleId of shell.triangles) {
    indices.push(...triangles.slice(triangleId * 3, triangleId * 3 + 3));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  return geometry;
}

// A closed oriented surface subtends 4π steradians at an interior point and
// zero outside. The cavity surface has already been checked not to intersect
// the outer surface, so one representative point determines containment.
function pointInsideShell(point, shell, vertices, triangles) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let solidAngle = 0;

  for (const triangleId of shell.triangles) {
    const offset = triangleId * 3;
    a.fromArray(vertices, triangles[offset] * 3).sub(point);
    b.fromArray(vertices, triangles[offset + 1] * 3).sub(point);
    c.fromArray(vertices, triangles[offset + 2] * 3).sub(point);

    const denominator =
      a.length() * b.length() * c.length() +
      a.dot(b) * c.length() +
      b.dot(c) * a.length() +
      c.dot(a) * b.length();
    solidAngle += 2 * Math.atan2(a.dot(cross.crossVectors(b, c)), denominator);
  }

  return Number.isFinite(solidAngle) && Math.abs(solidAngle) > Math.PI * 2;
}

export function verifiedSTL(source) {
  const geometry = prepareClosedStamp(source);
  const mesh = new THREE.Mesh(geometry);
  let reloaded, checked;
  try {
    const data = new STLExporter().parse(mesh, { binary: true });
    // Inspect the actual file bytes before offering the download.
    reloaded = new STLLoader().parse(data.buffer);
    checked = prepareClosedStamp(reloaded);
    if (
      !geometry.boundingBox.min.equals(checked.boundingBox.min) ||
      !geometry.boundingBox.max.equals(checked.boundingBox.max) ||
      geometry.index.count !== checked.index.count
    ) {
      throw new Error(
        "Export blocked: STL dimensions or triangle count changed.",
      );
    }
    return new Blob([data], { type: "model/stl" });
  } finally {
    geometry.dispose();
    mesh.material.dispose();
    reloaded?.dispose();
    checked?.dispose();
  }
}
