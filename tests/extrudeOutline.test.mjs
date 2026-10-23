import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  extrudeOutline,
  initializeSolids,
  solidBoolean,
} from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { ringArea } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";

await initializeSolids();

// One letter-sized shape from a real design: "8" next to a rectangle and an
// ellipse (mirrored, as on the stamp). Its outline has a small hole, and the
// vertices of its rectangle edge, of the hole and of the outline all lie on
// the straight line y = 5. Three.js's ExtrudeGeometry bridged the hole to the
// outline along that line, which gave a mesh with overlapping edges: Manifold
// refused it ("Relief mesh is not a closed manifold solid"), but only when the
// text happened to be about 16.5 to 20.5 mm.
const OUTLINE_WITH_HOLES_ON_ONE_LINE = [
  [
    [-14.814, 4.4595], [-15.1852, 5.18934], [-15.937, 5.96447], [-17.1, 6.714],
    [-15.9508, 7.65056], [-15.4917, 8.2163], [-15.2655, 8.64717], [-15.0677, 9.38419],
    [-15.03, 9.936], [-15.066, 10.4276], [-15.255, 11.0849], [-15.7558, 11.8117],
    [-16.6776, 12.4796], [-17.8547, 12.8804], [-19.152, 13.014], [-20.4732, 12.8804],
    [-21.636, 12.4796], [-22.5416, 11.8117], [-23.0345, 11.0824], [-23.2206, 10.4175],
    [-23.256, 9.918], [-23.2149, 9.36731], [-22.9994, 8.6362], [-22.753, 8.21208],
    [-22.2497, 7.66181], [-21.6477, 7.1872], [-20.952, 6.786], [-22.257, 5.949],
    [-23.0569, 5.14237], [-23.1339, 5], [-27, 5], [-27, -5],
    [-17, -5], [-17, 0.1375], [-16.4638, 0.33638], [-15.813, 0.738],
    [-15.2972, 1.23975], [-14.9288, 1.827], [-14.7077, 2.49975], [-14.634, 3.258],
  ],
  [
    [-17.6518, 9.25594], [-17.9443, 8.74744], [-18.4278, 8.34469], [-19.152, 7.92],
    [-19.8607, 8.3257], [-20.3417, 8.71889], [-20.6342, 9.23527], [-20.7, 9.72],
    [-20.5897, 10.278], [-20.259, 10.692], [-19.7572, 10.9485], [-19.134, 11.034],
    [-18.5242, 10.9485], [-18.027, 10.692], [-17.6962, 10.278], [-17.586, 9.72],
  ],
  [
    [-20.0211, 5], [-19.026, 5.598], [-18.1105, 5.05378], [-18.0515, 5],
  ],
];

const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// Signed volume of a closed triangle mesh.
function volumeOf(geometry) {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

const areaOf = (polygon) =>
  Math.abs(ringArea(polygon[0])) -
  polygon.slice(1).reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0);

// A solid that Manifold accepts: it throws for anything that is not closed.
const isClosedSolid = (geometry) => {
  try {
    solidBoolean(geometry, geometry, "union", { firstLabel: "a", secondLabel: "b" });
    return true;
  } catch {
    return false;
  }
};

test("the outline that used to break the relief is raised into a closed solid", () => {
  const depth = 2.02;
  const geometry = extrudeOutline([OUTLINE_WITH_HOLES_ON_ONE_LINE], depth);

  assert.ok(isClosedSolid(geometry));
  assert.ok(verifiedSTL(geometry).size > 84, "passes the export checks too");
  assert.ok(
    Math.abs(volumeOf(geometry) - areaOf(OUTLINE_WITH_HOLES_ON_ONE_LINE) * depth) < 1e-3,
    "holes stay holes, and nothing is lost or doubled",
  );
});

test("the solid stands on z = 0 and is exactly as tall as the depth", () => {
  const geometry = extrudeOutline([[rectangle(-3, -2, 3, 2)]], 1.5);
  geometry.computeBoundingBox();

  assert.equal(geometry.boundingBox.min.z, 0);
  assert.equal(geometry.boundingBox.max.z, 1.5);
  assert.equal(geometry.boundingBox.min.x, -3);
  assert.equal(geometry.boundingBox.max.y, 2);
});

test("holes are cut out, whichever way the rings wind", () => {
  const outer = rectangle(0, 0, 10, 10);
  const hole = rectangle(3, 3, 7, 7);
  for (const [name, polygon] of [
    ["hole wound the opposite way", [outer, [...hole].reverse()]],
    ["hole wound the same way", [outer, hole]],
  ]) {
    const geometry = extrudeOutline([polygon], 2);
    assert.ok(Math.abs(volumeOf(geometry) - (100 - 16) * 2) < 1e-6, name);
  }
});

test("separate polygons are all raised, and overlapping ones are joined, not doubled", () => {
  const apart = extrudeOutline([[rectangle(0, 0, 4, 4)], [rectangle(10, 0, 14, 4)]], 2);
  assert.ok(Math.abs(volumeOf(apart) - 2 * 16 * 2) < 1e-6);

  const overlapping = extrudeOutline([[rectangle(0, 0, 4, 4)], [rectangle(2, 0, 6, 4)]], 2);
  assert.ok(Math.abs(volumeOf(overlapping) - 6 * 4 * 2) < 1e-6, "union of the two, 24 mm2");
});

test("an empty design gives an empty geometry, and a bad depth is refused", () => {
  assert.equal(extrudeOutline([], 2).getAttribute("position"), undefined);
  for (const depth of [0, -1, Number.NaN]) {
    assert.throws(() => extrudeOutline([[rectangle(0, 0, 1, 1)]], depth), RangeError, String(depth));
  }
});
