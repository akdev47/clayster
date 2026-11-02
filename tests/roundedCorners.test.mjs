import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import * as THREE from "three";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { transform, ringArea } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { DEFAULT_STAMP, buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { createStampLayout, plateOutline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { constrainToFace } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { readableStampDisplay } from "../src/stamp_generator/static/stamp_generator/js/stamp2dDisplay.js";
import { pageWith } from "./fakePage.mjs";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";

await initializeSolids();

const RADIUS = SETTINGS.stamp.cornerRadiusMm;
const outlineOf = (face) => face[0][0];
const isConvexCounterClockwise = (ring) =>
  ring.every(([x, y], i) => {
    const [bx, by] = ring[(i + 1) % ring.length];
    const [cx, cy] = ring[(i + 2) % ring.length];
    return (bx - x) * (cy - by) - (by - y) * (cx - bx) >= -1e-9;
  });

// ---- the outline ----------------------------------------------------------

test("without the option the plate outline is the plain rectangle", () => {
  assert.deepEqual(plateOutline(-25, -20, 25, 20), [[[[-25, -20], [25, -20], [25, 20], [-25, 20]]]]);
  assert.deepEqual(plateOutline(-25, -20, 25, 20, false), plateOutline(-25, -20, 25, 20));
});

test("with the option the corners are quarter circles of the configured radius", () => {
  const ring = outlineOf(plateOutline(-25, -20, 25, 20, true));
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);

  assert.equal(Math.min(...xs), -25);
  assert.equal(Math.max(...xs), 25);
  assert.equal(Math.min(...ys), -20);
  assert.equal(Math.max(...ys), 20);
  assert.ok(ring.every(([x, y]) => !(Math.abs(x) === 25 && Math.abs(y) === 20)), "no point left in a corner");
  assert.ok(ringArea(ring) > 0, "counter-clockwise, like the plain outline");
  assert.ok(isConvexCounterClockwise(ring), "still convex");

  // The right-hand side runs straight between the two corners.
  const right = ring.filter(([x]) => x === 25).map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...right) - (-20 + RADIUS)) < 1e-9);
  assert.ok(Math.abs(Math.max(...right) - (20 - RADIUS)) < 1e-9);

  // The four corners together remove (4 - pi) r^2 of area. Each arc is 8 straight
  // facets, which cut away a little more: about 0.005 r^2 per corner.
  const expected = 50 * 40 - (4 - Math.PI) * RADIUS ** 2;
  const facets = 4 * 0.00504 * RADIUS ** 2;
  assert.ok(Math.abs(ringArea(ring) - (expected - facets)) < 0.005, `area ${ringArea(ring)} vs ${expected - facets}`);
});

test("a very small plate keeps straight sides instead of a radius that does not fit", () => {
  const ring = outlineOf(plateOutline(0, 0, 4, 30, true));
  const right = ring.filter(([x]) => x === 4).map(([, y]) => y);
  const radius = Math.min(...right);
  assert.ok(radius <= 0.45 * 4 + 1e-9, `radius ${radius} is at most 45% of the short side`);
  assert.ok(isConvexCounterClockwise(ring));
  assert.ok(ring.every((point, i) => {
    const next = ring[(i + 1) % ring.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-9;
  }), "no zero-length sides");
});

// ---- the layout --------------------------------------------------------------

const block = [[[[-6, -2], [6, -2], [6, 2], [-6, 2]]]];
const MARGIN = SETTINGS.stamp.edgeDistanceMm.min; // the smallest distance the stamp allows
const stampSettings = (patch) => ({ ...DEFAULT_STAMP, mirror: false, faceSize: 50, margin: MARGIN, ...patch });

test("the option rounds Square and Minimal plates and leaves the size alone", () => {
  for (const faceShape of ["square", "minimal"]) {
    const sharp = createStampLayout(block, stampSettings({ faceShape, roundedCorners: false }));
    const rounded = createStampLayout(block, stampSettings({ faceShape, roundedCorners: true }));

    assert.equal(outlineOf(sharp.face).length, 4, faceShape);
    assert.ok(outlineOf(rounded.face).length > 4, faceShape);
    for (const key of ["widthMm", "heightMm", "minX", "minY", "faceSize"]) {
      assert.equal(rounded[key], sharp[key], `${faceShape} ${key}`);
    }
    assert.ok(
      readableStampDisplay(rounded).face[0][0].length > 4,
      `${faceShape}: the 2D view draws the rounded plate`,
    );
  }
});

test("a Round plate has no corners, and designs saved before the option stay sharp", () => {
  const round = createStampLayout(block, stampSettings({ faceShape: "round", roundedCorners: true }));
  assert.deepEqual(round.face, createStampLayout(block, stampSettings({ faceShape: "round", roundedCorners: false })).face);

  // A design saved before the option has no such field at all.
  const { roundedCorners, ...saved } = stampSettings({ faceShape: "square" });
  assert.equal(typeof roundedCorners, "boolean", "the defaults carry the option");
  assert.equal("roundedCorners" in saved, false);
  assert.equal(outlineOf(createStampLayout(block, saved).face).length, 4);
});

// ---- the distance to the edge --------------------------------------------

// The editor lets an element's lines come up to the edge distance from the ideal
// plate; the final check must agree. It used to measure to the straight sides of
// a round plate, which lie up to 0.03 mm inside the circle, so an element dragged
// to the rim got an overflow error that blocked export.
const FACE = 50;
const identity = { scale: 1, rotationDeg: 0, mirrorX: false, mirrorY: false, pivotX: 0, pivotY: 0 };
const logo = [[[[-3, -3], [3, -3], [3, 3], [-3, 3]]]];
const wide = [[[[-9, -1.5], [9, -1.5], [9, 1.5], [-9, 1.5]]]];

for (const [name, faceShape, roundedCorners] of [
  ["round", "round", false],
  ["square", "square", false],
  ["square with rounded corners", "square", true],
]) {
  test(`${name}: an element at the editor's limit passes the final check, one just beyond it does not`, () => {
    const limit = { shape: faceShape, halfExtent: (FACE - 2 * MARGIN) / 2 };
    const settings = stampSettings({ faceShape, roundedCorners });
    let tried = 0;
    for (const shape of [logo, wide]) {
      for (let degrees = 0; degrees < 360; degrees += 3.75) {
        const angle = (degrees * Math.PI) / 180;
        const want = { ...identity, xMm: 80 * Math.cos(angle), yMm: 80 * Math.sin(angle) };
        const placed = constrainToFace(shape, want, limit);
        assert.notEqual(placed, null);
        assert.equal(createStampLayout(transform(shape, placed), settings).overflows, false, `${degrees} degrees`);

        const outward = { ...placed, xMm: placed.xMm + 0.2 * Math.cos(angle), yMm: placed.yMm + 0.2 * Math.sin(angle) };
        assert.equal(createStampLayout(transform(shape, outward), settings).overflows, true, `${degrees} degrees, 0.2 mm further out`);
        tried++;
      }
    }
    assert.equal(tried, 192);
  });
}

// ---- the 3D plate --------------------------------------------------------------

const font = opentype.parse((() => {
  const bytes = readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
})());
const artwork = validate(layoutText(font, { text: "CLAY", size: 16 })).artwork;

const cornerReach = (geometry, centre) => {
  const position = geometry.getAttribute("position");
  let reach = 0;
  for (let i = 0; i < position.count; i++) {
    reach = Math.max(reach, Math.abs(position.getX(i) - centre[0]) + Math.abs(position.getY(i) - centre[1]));
  }
  return reach;
};

for (const faceShape of ["square", "minimal"]) {
  for (const mode of ["emboss", "deboss"]) {
    test(`a ${faceShape} ${mode} stamp with rounded corners is a valid solid with the same outside size`, () => {
      const sharp = buildStamp(artwork, { faceShape, mode, faceSize: 50, roundedCorners: false });
      const rounded = buildStamp(artwork, { faceShape, mode, faceSize: 50, roundedCorners: true });
      try {
        assert.ok(verifiedSTL(rounded.stamp).size > 84);
        for (const key of ["width", "depth", "height"]) {
          assert.ok(Math.abs(rounded.info[key] - sharp.info[key]) < 1e-6, key);
        }
        const centre = [rounded.layout.minX + rounded.layout.widthMm / 2, rounded.layout.minY + rounded.layout.heightMm / 2];
        const halfDiagonalSum = rounded.layout.widthMm / 2 + rounded.layout.heightMm / 2;
        assert.ok(Math.abs(cornerReach(sharp.stamp, centre) - halfDiagonalSum) < 1e-4, "sharp plate reaches the corner");
        // The corner of the rounded plate is pulled in by about r * (sqrt(2) - 1) * sqrt(2) on x + y.
        assert.ok(cornerReach(rounded.stamp, centre) < halfDiagonalSum - 0.5 * RADIUS, "rounded plate does not");
      } finally {
        for (const built of [sharp, rounded]) {
          built.stamp.dispose();
          built.clay.dispose();
        }
      }
    });
  }
}

// ---- the switch in the page ---------------------------------------------------

test("the Rounded corners switch only shows for Square and Minimal, and changes the stamp", () => {
  const { document, pipeline, calls, clickShape } = pageWith({ faceShape: "round" });
  const row = document.getElementById("pipeline-rounded-corners-field");
  const switchInput = document.getElementById("pipeline-rounded-corners");

  assert.equal(row.hidden, true, "hidden for a round plate");
  assert.equal(switchInput.checked, DEFAULT_STAMP.roundedCorners, "starts as the default says");

  clickShape("square");
  assert.equal(row.hidden, false);
  clickShape("minimal");
  assert.equal(row.hidden, false);

  switchInput.checked = true;
  switchInput.dispatch("change");
  assert.deepEqual(calls.at(-1), { roundedCorners: true });
  assert.equal(pipeline.stamp.roundedCorners, true);
  switchInput.checked = false;
  switchInput.dispatch("change");
  assert.deepEqual(calls.at(-1), { roundedCorners: false });

  clickShape("round");
  assert.equal(row.hidden, true, "hidden again for a round plate");
});

test("the switch starts in the state of the stamp settings", () => {
  const on = pageWith({ faceShape: "square", roundedCorners: true });
  assert.equal(on.document.getElementById("pipeline-rounded-corners").checked, true);
  assert.equal(on.document.getElementById("pipeline-rounded-corners-field").hidden, false);

  const saved = pageWith({ faceShape: "minimal", roundedCorners: undefined });
  assert.equal(saved.document.getElementById("pipeline-rounded-corners").checked, false, "a design saved before the option");
});

test("the page has the switch, hidden until a shape with corners is chosen", () => {
  const html = readFileSync(
    new URL("../src/stamp_generator/templates/stamp_generator/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<div id="pipeline-rounded-corners-field"[^>]*\bhidden\b/);
  assert.match(html, /<input[^>]*id="pipeline-rounded-corners"[^>]*type="checkbox"[^>]*role="switch"/s);
  assert.match(html, /Afgeronde hoeken/);
});
