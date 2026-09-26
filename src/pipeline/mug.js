import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { booleanGeometry, SUBTRACT, INTERSECT } from '../combine.js';

/**
 * The clay half of the preview: a mug with the stamp pressed into its side.
 *
 * Wraps the artwork around the wall for an approximate impression preview.
 * This does not simulate pressing a rigid, flat stamp into curved clay.
 * The mug is display-only; exports contain the stamp. Millimetres, Z up.
 */

// The mug never resizes with the stamp. One that grew to fit would hide the
// thing worth knowing: that the stamp has outgrown what you meant to press it
// into. Artwork too big for the wall is pressed as far as it reaches.
const MUG = {
    radius: 42,
    height: 96,
    wall: 4,
    floor: 6
};

const REACH = 1.3;        // Radians of wall either side of centre, short of the handle.
const EDGE = 3;           // Millimetres kept clear of the base and the rim.
const BAND_CENTRE = 0.52; // Where up the wall the impression sits.

// The viewer starts off looking in from this corner, so the impression faces
// you straight away and the handle, a quarter turn behind, lands on the
// silhouette.
const FACING = Math.atan2(90, 120);

const HANDLE_RING = 0.26; // Ring radius, as a fraction of the mug's height.
const HANDLE_TUBE = 1.15; // Tube radius, as a multiple of the wall thickness.

// Bending moves vertices onto the cylinder and leaves the triangles between
// them as chords, so a span of c millimetres sags c²/8r below the surface.
// Holding that to a fiftieth of a millimetre sets how finely the tool is split
// and how many segments the mug is turned from.
const SAG = 0.02;
const CHORD = Math.sqrt(8 * MUG.radius * SAG);
const SEGMENTS = Math.min(Math.max(Math.ceil((2 * Math.PI * MUG.radius) / CHORD), 64), 360);

const CLEARANCE = 0.01;     // Keeps the pressed plate off the clay surface.
const RIM_OVERSHOOT = 1;    // The bore pokes past the rim: no coplanar faces.
const CREASE = Math.PI / 6; // Shades the wall smooth and the impression crisp.
const MAX_TOOL_TRIANGLES = 120000;

// Real glazed stoneware is dipped, not painted to the millimetre: the foot
// ring is left bare so it doesn't fuse to the kiln shelf. FOOT_BAND is how
// far up the wall that bare ring runs; the two geometry groups it produces
// (0 = bare, 1 = glazed) line up with the two materials the viewer assigns.
const FOOT_BAND = 10;

// Whether artwork this size has to be trimmed to sit on the wall. Pressing goes
// ahead either way; the caller says so in the Check panel.
export function offTheMug({ width, height }) {
    return width > MUG.radius * REACH * 2 || height > MUG.height - EDGE * 2;
}

/**
 * Presses a tool into the side of a mug and returns the mug.
 *
 * The tool is whatever part of the stamp reaches the clay: the relief alone for
 * raised artwork, the whole face for recessed. Either way it is pushed down
 * until its lowest solid point sits `reliefDepth` under the surface, and the
 * plane z = 0 is then bent onto the wall.
 *
 * The half-turn is about Y, not X: the artwork was mirrored on X, and turning
 * about Y undoes that mirror, so the impression reads the right way round.
 */
export function pressIntoMug(shape, settings) {
    const tool = shape.clone();
    tool.rotateY(Math.PI);
    tool.computeBoundingBox();
    tool.translate(0, MUG.height * BAND_CENTRE, CLEARANCE - settings.reliefDepth - tool.boundingBox.min.z);

    const trimmed = trim(tool);
    const bent = bend(split(trimmed, CHORD));
    trimmed.dispose();

    const impressed = booleanGeometry(body(), bent, SUBTRACT);
    bent.dispose();

    // The handle is dropped in rather than unioned: only the stamp is exported,
    // so the preview needs it to look right from outside, not to be watertight.
    const parts = [flatten(impressed), flatten(handle())];
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();

    const clay = toCreasedNormals(merged, CREASE);
    merged.dispose();

    return groupByHeight(clay, FOOT_BAND);
}

// Cuts the tool back to the wall it can reach. Without it an oversized stamp
// wraps past itself round the back, and a recessed one shears off the rim and
// the floor on its way through. Only run when there is something to cut.
function trim(tool) {
    tool.computeBoundingBox();

    const box = tool.boundingBox;
    const reach = MUG.radius * REACH;
    const top = MUG.height - EDGE;

    if (box.min.x >= -reach && box.max.x <= reach && box.min.y >= EDGE && box.max.y <= top) {
        return tool;
    }

    const band = new THREE.BoxGeometry(reach * 2, top - EDGE, box.max.z - box.min.z + 2);
    band.translate(0, (EDGE + top) / 2, (box.min.z + box.max.z) / 2);

    const trimmed = booleanGeometry(tool, band, INTERSECT);

    tool.dispose();
    band.dispose();

    return trimmed;
}

// One mug, built once: nothing about it depends on the stamp.
let mug = null;

function body() {
    if (mug === null) mug = buildBody();
    return mug;
}

function buildBody() {
    const { radius, height, wall, floor } = MUG;

    const outer = new THREE.CylinderGeometry(radius, radius, height, SEGMENTS);
    outer.rotateX(Math.PI / 2); // three builds cylinders Y-up; the app is Z-up.
    outer.translate(0, 0, height / 2);

    const depth = height - floor + RIM_OVERSHOOT;
    const bore = new THREE.CylinderGeometry(radius - wall, radius - wall, depth, SEGMENTS);
    bore.rotateX(Math.PI / 2);
    bore.translate(0, 0, floor + depth / 2);

    const vessel = booleanGeometry(outer, bore, SUBTRACT);

    outer.dispose();
    bore.dispose();

    return vessel;
}

// A half ring, a quarter turn round from the impression. Both ends stop in the
// middle of the wall, where the mug's own surface hides them, and the ring
// never reaches further in than that, so it cannot show up inside the mug.
function handle() {
    const { radius, height, wall } = MUG;
    const geometry = new THREE.TorusGeometry(height * HANDLE_RING, wall * HANDLE_TUBE, 16, 48, Math.PI);

    geometry.rotateZ(-Math.PI / 2); // The half ring is built above the X axis;
    geometry.rotateX(Math.PI / 2);  // stand it up beside the wall instead.
    geometry.translate(radius - wall / 2, 0, height * BAND_CENTRE);
    geometry.rotateZ(FACING);

    return geometry;
}

/**
 * Wraps geometry round the Z axis, orientation preserved.
 *
 * x becomes arc length at the mug's radius and z the distance out from the
 * surface, so z = 0 lands on the wall and a tool built flat presses into a
 * curved one unchanged. x = 0 comes out at FACING rather than straight ahead.
 *
 * Every vertex is lifted by one sag, because the chord between two vertices on
 * a circle runs inside it. Without that the plate's flat underside, which is
 * meant to rest on the surface, scallops a ring into the mug around the
 * artwork.
 */
function bend(geometry) {
    const position = geometry.getAttribute('position');

    for (let i = 0; i < position.count; i++) {
        const angle = FACING + position.getX(i) / MUG.radius;
        const height = position.getY(i);
        const out = MUG.radius + position.getZ(i) + SAG;

        position.setXYZ(i, out * Math.sin(angle), -out * Math.cos(angle), height);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();

    return geometry;
}

// Splits triangles until none spans more than `maxSpan` in x. Bending only
// moves vertices, so a triangle wide in x would arrive as a chord across the
// mug rather than a piece of its surface. Artwork outlines are already finer
// than the tolerance and come through untouched.
function split(geometry, maxSpan) {
    const source = geometry.getIndex() === null ? geometry : geometry.toNonIndexed();
    const position = source.getAttribute('position').array;

    const stack = [];
    for (let i = 0; i < position.length; i += 9) {
        stack.push(Array.from(position.slice(i, i + 9)));
    }

    if (source !== geometry) source.dispose();

    const out = [];

    while (stack.length > 0) {
        const triangle = stack.pop();

        // Edge e runs from vertex e to the next, which leaves the opposite
        // vertex two steps along.
        let edge = 0;
        let widest = 0;

        for (let e = 0; e < 3; e++) {
            const span = Math.abs(triangle[((e + 1) * 3) % 9] - triangle[e * 3]);
            if (span > widest) {
                widest = span;
                edge = e;
            }
        }

        if (widest <= maxSpan || out.length / 9 + stack.length >= MAX_TOOL_TRIANGLES) {
            out.push(...triangle);
            continue;
        }

        const near = vertex(triangle, edge);
        const far = vertex(triangle, edge + 1);
        const rest = vertex(triangle, edge + 2);
        const middle = near.map((value, axis) => (value + far[axis]) / 2);

        // Both halves keep the parent's winding, so a split cannot flip a face.
        stack.push([...near, ...middle, ...rest], [...middle, ...far, ...rest]);
    }

    const dense = new THREE.BufferGeometry();
    dense.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));

    return dense;
}

// Sorts triangles into a bare-foot group and a glazed group by height, so the
// viewer can paint them with two materials via geometry groups. Reordering is
// needed because groups are contiguous index ranges, not a per-triangle tag.
function groupByHeight(geometry, footHeight) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const triangleCount = position.count / 3;

    const bare = [];
    const glazed = [];

    for (let t = 0; t < triangleCount; t++) {
        const base = t * 3;
        const midZ = (position.getZ(base) + position.getZ(base + 1) + position.getZ(base + 2)) / 3;
        (midZ < footHeight ? bare : glazed).push(t);
    }

    const order = [...bare, ...glazed];
    const positions = new Float32Array(position.count * 3);
    const normals = new Float32Array(normal.count * 3);

    order.forEach((triangle, slot) => {
        for (let v = 0; v < 3; v++) {
            const from = triangle * 3 + v;
            const to = slot * 3 + v;

            positions[to * 3] = position.getX(from);
            positions[to * 3 + 1] = position.getY(from);
            positions[to * 3 + 2] = position.getZ(from);

            normals[to * 3] = normal.getX(from);
            normals[to * 3 + 1] = normal.getY(from);
            normals[to * 3 + 2] = normal.getZ(from);
        }
    });

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    geometry.clearGroups();
    geometry.addGroup(0, bare.length * 3, 0);
    geometry.addGroup(bare.length * 3, glazed.length * 3, 1);

    return geometry;
}

function vertex(triangle, index) {
    const at = (index % 3) * 3;
    return [triangle[at], triangle[at + 1], triangle[at + 2]];
}

// mergeGeometries insists the parts match: the boolean returns bare position
// and normal triangles, a torus arrives indexed and carrying UVs.
function flatten(geometry) {
    const flat = geometry.getIndex() === null ? geometry : geometry.toNonIndexed();

    for (const name of Object.keys(flat.attributes)) {
        if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
    }

    if (flat !== geometry) geometry.dispose();

    return flat;
}
