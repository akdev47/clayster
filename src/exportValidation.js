// Checks the finished stamp for surface defects and verifies the exported STL bytes.
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Check the finished surface, not just the original 2D drawing.
// This catches topology problems; it does not certify wall thickness or printing.
export function prepareClosedStamp(source) {
    const position = source?.getAttribute('position');
    const count = source?.index?.count ?? position?.count ?? 0;
    if (!position || count === 0 || count % 3 !== 0) {
        throw new Error('Export blocked: no valid triangles to export.');
    }
    const vertices = [];
    const vertexIds = new Map();
    const triangles = [];
    const edges = new Map();
    const faces = new Set();
    // Track connected groups of vertices so separate pieces can be detected later.
    const parents = [];
    const root = id => {
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
            throw new Error('Export blocked: invalid triangle index.');
        }
        // Check at STL's float32 precision. Never round away or fill actual holes.
        const point = [position.getX(index), position.getY(index), position.getZ(index)].map(Math.fround);
        if (!point.every(Number.isFinite)) throw new Error('Export blocked: invalid coordinates.');
        const key = point.join(',');
        if (!vertexIds.has(key)) {
            const id = vertices.length / 3;
            vertexIds.set(key, id);
            parents.push(id);
            vertices.push(...point);
        }
        triangles.push(vertexIds.get(key));
    }
    const box = new THREE.Box3();
    for (let i = 0; i < vertices.length; i += 3) box.expandByPoint(new THREE.Vector3().fromArray(vertices, i));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const cross = new THREE.Vector3(), edge = new THREE.Vector3();
    let volume = 0;
    for (let i = 0; i < triangles.length; i += 3) {
        const ids = triangles.slice(i, i + 3);
        a.fromArray(vertices, ids[0] * 3).sub(centre);
        b.fromArray(vertices, ids[1] * 3).sub(centre);
        c.fromArray(vertices, ids[2] * 3).sub(centre);
        if (cross.subVectors(b, a).cross(edge.subVectors(c, a)).lengthSq() === 0) {
            throw new Error('Export blocked: collapsed triangle detected.');
        }
        // Signed volume also tells us whether the surface faces outward or inward.
        volume += a.dot(cross.copy(b).cross(c)) / 6;
        const face = [...ids].sort((x, y) => x - y).join(',');
        if (faces.has(face)) throw new Error('Export blocked: duplicate triangle detected.');
        faces.add(face);
        for (const [x, y] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
            parents[root(x)] = root(y);
            const key = x < y ? `${x},${y}` : `${y},${x}`;
            const value = edges.get(key) ?? { count: 0, direction: 0 };
            value.count++;
            value.direction += x < y ? 1 : -1;
            edges.set(key, value);
        }
    }
    // A closed, consistently oriented surface uses every edge twice, in opposite directions.
    const open = [...edges.values()].filter(edge => edge.count === 1).length;
    const invalid = [...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0).length;
    if (invalid) throw new Error(`Export blocked: ${open} open edges and ${invalid - open} inconsistent or non-manifold edges. Rebuild or repair the stamp.`);
    // A hollow solid has an outer surface and inward-facing cavity surfaces.
    // Count outward shells, so an enclosed handle cavity is not a loose piece.
    const shellVolumes = new Map();
    for (let i = 0; i < triangles.length; i += 3) {
        a.fromArray(vertices, triangles[i] * 3).sub(centre);
        b.fromArray(vertices, triangles[i + 1] * 3).sub(centre);
        c.fromArray(vertices, triangles[i + 2] * 3).sub(centre);
        const id = root(triangles[i]);
        shellVolumes.set(id, (shellVolumes.get(id) ?? 0) + a.dot(cross.copy(b).cross(c)) / 6);
    }
    if ([...shellVolumes.values()].filter(value => value > 0).length !== 1) {
        throw new Error('Export blocked: the stamp has disconnected pieces. Adjust the backing or handle.');
    }
    if (volume <= 0 || !Number.isFinite(volume) || Math.min(size.x, size.y, size.z) <= 0) {
        throw new Error('Export blocked: the stamp has no positive enclosed volume.');
    }
    // Return a new indexed mesh; leave the original preview geometry untouched.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(triangles);
    geometry.boundingBox = box;
    return geometry;
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
        if (!geometry.boundingBox.min.equals(checked.boundingBox.min) ||
            !geometry.boundingBox.max.equals(checked.boundingBox.max) ||
            geometry.index.count !== checked.index.count) {
            throw new Error('Export blocked: STL dimensions or triangle count changed.');
        }
        return new Blob([data], { type: 'model/stl' });
    } finally {
        geometry.dispose();
        mesh.material.dispose();
        reloaded?.dispose();
        checked?.dispose();
    }
}
