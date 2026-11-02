import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import opentype from "opentype.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { unzipSync, strFromU8 } from "three/addons/libs/fflate.module.js";
import { initializeSolids, solidBoolean } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { prepareClosedStamp, verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { create3MF, createSTL } from "../src/stamp_generator/static/stamp_generator/js/exporters.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { DEFAULT_STAMP, buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { createSmallHandle } from "../src/stamp_generator/static/stamp_generator/js/pipeline/handle.js";

await initializeSolids();
const buffer = (path) => {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
};
const font = opentype.parse(buffer("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf"));
const handle = createSmallHandle();
const artwork = (text) =>
  validate(layoutText(font, { text, size: 16 })).artwork;
const reverseTriangles = (geometry) => {
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const first = position.array[i * 3 + j];
      position.array[i * 3 + j] = position.array[(i + 2) * 3 + j];
      position.array[(i + 2) * 3 + j] = first;
    }
  }
  return geometry;
};

for (const text of ["CLAY", "BOA8", "i j !"]) {
  for (const faceShape of ["round", "square"]) {
    for (const mode of ["emboss", "deboss"]) {
      test(`${text}: ${faceShape}, ${mode}, verified STL`, async () => {
        const built = buildStamp(artwork(text), { faceShape, mode });
        try {
          const blob = verifiedSTL(built.stamp);
          const reloaded = new STLLoader().parse(await blob.arrayBuffer());
          const checked = prepareClosedStamp(reloaded);
          assert.equal(checked.boundingBox.min.z, 0);
          const expectedHeight = mode === "emboss"
            ? DEFAULT_STAMP.faceThickness + DEFAULT_STAMP.reliefDepth
            : DEFAULT_STAMP.faceThickness;
          // The reloaded STL holds 32-bit numbers, so compare to a tiny tolerance.
          assert.ok(Math.abs(checked.boundingBox.max.z - expectedHeight) < 1e-4);
          assert.ok(blob.size > 84);
          checked.dispose();
          reloaded.dispose();
        } finally {
          built.stamp.dispose();
          built.clay.dispose();
        }
      });
    }
  }
}

test("handle attachment gives a closed stamp", () => {
  const built = buildStamp(artwork("CLAY"), {}, handle);
  assert.ok(verifiedSTL(built.stamp).size > 84);
  built.stamp.dispose();
  built.clay.dispose();
});

test("unsafe recess and non-finite automatic margin are rejected", () => {
  assert.throws(
    () => buildStamp(artwork("A"), { mode: "deboss", reliefDepth: DEFAULT_STAMP.faceThickness }),
    /reliëfdiepte/,
  );
  assert.throws(
    () =>
      buildStamp(artwork("A"), { margin: NaN }),
    /margin must be finite/,
  );
});

test("open, duplicate, collapsed, reversed, disconnected, and invalid surfaces block export", () => {
  const box = new THREE.BoxGeometry(10, 20, 30).toNonIndexed();
  assert.ok(verifiedSTL(box).size > 84);
  const open = box.clone();
  open.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(box.attributes.position.array.slice(9), 3),
  );
  assert.throws(() => verifiedSTL(open), /open randen/);
  const duplicate = mergeGeometries([box, box]);
  assert.throws(() => verifiedSTL(duplicate), /dubbele driehoek/);
  const collapsed = box.clone();
  collapsed.attributes.position.array.copyWithin(3, 0, 3);
  assert.throws(() => verifiedSTL(collapsed), /gedegenereerde/);
  const reversed = box.clone();
  const p = reversed.attributes.position.array;
  for (let j = 0; j < 3; j++) [p[3 + j], p[6 + j]] = [p[6 + j], p[3 + j]];
  assert.throws(() => verifiedSTL(reversed), /inconsistent/);
  const separate = mergeGeometries([box, box.clone().translate(50, 0, 0)]);
  assert.throws(() => verifiedSTL(separate), /losse delen/);
  const invalid = box.clone();
  invalid.attributes.position.array[0] = NaN;
  assert.throws(() => verifiedSTL(invalid), /ongeldige coördinaten/);
  assert.throws(
    () => verifiedSTL(new THREE.BufferGeometry()),
    /geen geldige driehoeken/,
  );
  [box, open, duplicate, collapsed, reversed, separate, invalid].forEach((g) =>
    g.dispose(),
  );
});

test("closed solids touching only at one vertex are non-manifold", () => {
  const first = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const second = first.clone().translate(2, 2, 2);
  const touching = mergeGeometries([first, second]);

  assert.throws(() => prepareClosedStamp(touching), /maar in één punt/i);
  [first, second, touching].forEach((geometry) => geometry.dispose());
});

test("separate outward-facing solids remain unsupported", () => {
  const first = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const second = first.clone().translate(10, 0, 0);
  const separate = mergeGeometries([first, second]);

  assert.throws(() => prepareClosedStamp(separate), /losse delen/i);
  [first, second, separate].forEach((geometry) => geometry.dispose());
});

test("an enclosed inward-facing shell is accepted as a cavity", () => {
  const outer = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
  const cavity = reverseTriangles(
    new THREE.BoxGeometry(4, 4, 4).toNonIndexed(),
  );
  const hollow = mergeGeometries([outer, cavity]);
  const checked = prepareClosedStamp(hollow);

  assert.ok(checked.index.count > 0);
  [outer, cavity, hollow, checked].forEach((geometry) => geometry.dispose());
});

test("an external inward-facing shell is not treated as a cavity", () => {
  const outer = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
  const outside = reverseTriangles(
    new THREE.BoxGeometry(2, 2, 2).toNonIndexed().translate(20, 0, 0),
  );
  const invalid = mergeGeometries([outer, outside]);

  assert.throws(() => prepareClosedStamp(invalid), /geen omsloten holte/i);
  [outer, outside, invalid].forEach((geometry) => geometry.dispose());
});

test("solid union joins overlapping volumes without unmatched edges", () => {
  const a = new THREE.BoxGeometry(10, 10, 4);
  const b = new THREE.BoxGeometry(4, 4, 3).translate(0, 0, 3);
  const joined = solidBoolean(a, b, "union");
  const checked = prepareClosedStamp(joined);
  assert.deepEqual(
    checked.boundingBox.getSize(new THREE.Vector3()).toArray(),
    [10, 10, 6.5],
  );
  [a, b, joined, checked].forEach((g) => g.dispose());
});

test("solid conversion identifies the non-manifold operand", () => {
  const base = new THREE.BoxGeometry(10, 10, 4);
  const openRelief = new THREE.BufferGeometry();
  openRelief.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3),
  );

  assert.throws(
    () =>
      solidBoolean(base, openRelief, "union", {
        firstLabel: "stempelplaat",
        secondLabel: "reliëf",
      }),
    /Reliëf is geen gesloten \(manifold\) volume: Not manifold/i,
  );
  [base, openRelief].forEach((geometry) => geometry.dispose());
});

test("3MF archive preserves units, dimensions, closed triangles, and escaped names", async () => {
  const built = buildStamp(artwork("BOA8"), { faceShape: "square" });
  const blob = create3MF([
    { name: "A&B", geometry: built.stamp, color: new THREE.Color("#bd8263") },
  ]);
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(archive["[Content_Types].xml"]);
  assert.ok(archive["_rels/.rels"]);
  const xml = strFromU8(archive["3D/3dmodel.model"]);
  assert.match(xml, /unit="millimeter"/);
  assert.match(xml, /A&amp;B/);
  const vertices = [
    ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
  ].flatMap((match) => match.slice(1).map(Number));
  const triangles = [
    ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
  ].flatMap((match) => match.slice(1).map(Number));
  const decoded = new THREE.BufferGeometry();
  decoded.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  decoded.setIndex(triangles);
  const checked = prepareClosedStamp(decoded);
  built.stamp.computeBoundingBox();
  assert.ok(checked.boundingBox.equals(built.stamp.boundingBox));
  [decoded, checked, built.stamp, built.clay].forEach((g) => g.dispose());
});

test("createSTL gives the same checked binary STL the export button downloads", async () => {
  const built = buildStamp(artwork("CLAY"), {});
  try {
    const blob = createSTL([{ name: "Clayster stamp", color: null, geometry: built.stamp }]);
    assert.equal(blob.type, "model/stl");
    const view = new DataView(await blob.arrayBuffer());
    assert.equal(blob.size, 84 + 50 * view.getUint32(80, true), "size matches the triangle count");
    assert.throws(() => createSTL([]), /Er is niets om te exporteren/);
  } finally {
    built.stamp.dispose();
    built.clay.dispose();
  }
});
