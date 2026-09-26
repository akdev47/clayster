import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import opentype from 'opentype.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { initializeSolids, solidBoolean } from '../src/solidGeometry.js';
import { prepareClosedStamp, verifiedSTL } from '../src/exportValidation.js';
import { create3MF } from '../src/exporters.js';
import { layoutText } from '../src/pipeline/text.js';
import { validate } from '../src/pipeline/validate.js';
import { buildStamp } from '../src/pipeline/stamp.js';

await initializeSolids();
const buffer = path => {
    const bytes = readFileSync(new URL(path, import.meta.url));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const font = opentype.parse(buffer('../fonts/NotoSans-Bold.ttf'));
const handle = new STLLoader().parse(buffer('../models/StampHandle.stl'));
const artwork = text => validate(layoutText(font, { text, size: 16 })).artwork;

for (const text of ['CLAY', 'BOA8', 'i j !']) {
    for (const faceShape of ['round', 'square', 'outline']) {
        for (const mode of ['emboss', 'deboss']) {
            test(`${text}: ${faceShape}, ${mode}, verified STL`, async () => {
                const built = buildStamp(artwork(text), { faceShape, mode });
                try {
                    const blob = verifiedSTL(built.stamp);
                    const reloaded = new STLLoader().parse(await blob.arrayBuffer());
                    const checked = prepareClosedStamp(reloaded);
                    assert.equal(checked.boundingBox.min.z, 0);
                    assert.equal(checked.boundingBox.max.z, mode === 'emboss' ? 6 : 4);
                    assert.ok(blob.size > 84);
                    checked.dispose(); reloaded.dispose();
                } finally { built.stamp.dispose(); built.clay.dispose(); }
            });
        }
    }
}

test('handle attachment supports a closed internal cavity', () => {
    const built = buildStamp(artwork('CLAY'), {}, handle);
    assert.ok(verifiedSTL(built.stamp).size > 84);
    built.stamp.dispose(); built.clay.dispose();
});

test('unsafe recess and negative available face size are rejected', () => {
    assert.throws(() => buildStamp(artwork('A'), { mode: 'deboss', reliefDepth: 4 }), /Recess depth/);
    assert.throws(() => buildStamp(artwork('A'), { autoFaceSize: false, faceSize: 5, margin: 3 }), /twice the margin/);
});

test('open, duplicate, collapsed, reversed, disconnected, and invalid surfaces block export', () => {
    const box = new THREE.BoxGeometry(10, 20, 30).toNonIndexed();
    assert.ok(verifiedSTL(box).size > 84);
    const open = box.clone();
    open.setAttribute('position', new THREE.Float32BufferAttribute(box.attributes.position.array.slice(9), 3));
    assert.throws(() => verifiedSTL(open), /open edges/);
    const duplicate = mergeGeometries([box, box]);
    assert.throws(() => verifiedSTL(duplicate), /duplicate/);
    const collapsed = box.clone();
    collapsed.attributes.position.array.copyWithin(3, 0, 3);
    assert.throws(() => verifiedSTL(collapsed), /collapsed/);
    const reversed = box.clone();
    const p = reversed.attributes.position.array;
    for (let j = 0; j < 3; j++) [p[3 + j], p[6 + j]] = [p[6 + j], p[3 + j]];
    assert.throws(() => verifiedSTL(reversed), /inconsistent/);
    const separate = mergeGeometries([box, box.clone().translate(50, 0, 0)]);
    assert.throws(() => verifiedSTL(separate), /disconnected/);
    const invalid = box.clone(); invalid.attributes.position.array[0] = NaN;
    assert.throws(() => verifiedSTL(invalid), /invalid coordinates/);
    assert.throws(() => verifiedSTL(new THREE.BufferGeometry()), /no valid triangles/);
    [box, open, duplicate, collapsed, reversed, separate, invalid].forEach(g => g.dispose());
});

test('solid union joins overlapping volumes without unmatched edges', () => {
    const a = new THREE.BoxGeometry(10, 10, 4);
    const b = new THREE.BoxGeometry(4, 4, 3).translate(0, 0, 3);
    const joined = solidBoolean(a, b, 'union');
    const checked = prepareClosedStamp(joined);
    assert.deepEqual(checked.boundingBox.getSize(new THREE.Vector3()).toArray(), [10, 10, 6.5]);
    [a, b, joined, checked].forEach(g => g.dispose());
});

test('3MF archive preserves units, dimensions, closed triangles, and escaped names', async () => {
    const built = buildStamp(artwork('BOA8'), { faceShape: 'square' });
    const blob = create3MF([{ name: 'A&B', geometry: built.stamp, color: new THREE.Color('#bd8263') }]);
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    assert.ok(archive['[Content_Types].xml']); assert.ok(archive['_rels/.rels']);
    const xml = strFromU8(archive['3D/3dmodel.model']);
    assert.match(xml, /unit="millimeter"/); assert.match(xml, /A&amp;B/);
    const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)]
        .flatMap(match => match.slice(1).map(Number));
    const triangles = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)]
        .flatMap(match => match.slice(1).map(Number));
    const decoded = new THREE.BufferGeometry();
    decoded.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); decoded.setIndex(triangles);
    const checked = prepareClosedStamp(decoded);
    built.stamp.computeBoundingBox();
    assert.ok(checked.boundingBox.equals(built.stamp.boundingBox));
    [decoded, checked, built.stamp, built.clay].forEach(g => g.dispose());
});
