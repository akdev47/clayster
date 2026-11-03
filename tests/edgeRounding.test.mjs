import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import * as THREE from "three";
import {
  extrudeRoundedPlate,
  initializeSolids,
  solidBoolean,
} from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { layoutText } from "../src/stamp_generator/static/stamp_generator/js/pipeline/text.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { SETTINGS } from "../src/stamp_generator/static/stamp_generator/js/settings.js";
import { DEFAULT_STAMP } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { pageWith } from "./fakePage.mjs";

await initializeSolids();

const THICKNESS = 4;
const circle = [[Array.from({ length: 96 }, (_, i) => {
  const angle = (i / 96) * Math.PI * 2;
  return [25 * Math.cos(angle), 25 * Math.sin(angle)];
})]];
const square = [[[[-25, -25], [25, -25], [25, 25], [-25, 25]]]];
// Like a Minimal plate: not centred on the origin.
const offCentreRectangle = [[[[-10, -3], [34, -3], [34, 9], [-10, 9]]]];
const outlines = { round: circle, square, "off-centre rectangle": offCentreRectangle };

const perimeter = (multiPolygon) => {
  const ring = multiPolygon[0][0];
  return ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + Math.hypot(nx - x, ny - y);
  }, 0);
};

function volumeOf(geometry) {
  const position = geometry.getAttribute("position");
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

// The widest reach (along x or y, from the plate's centre) of the vertices at one
// height, or of all vertices when no height is given (that is the side wall).
function reachAt(geometry, height, centre) {
  const position = geometry.getAttribute("position");
  let reach = 0;
  for (let i = 0; i < position.count; i++) {
    if (height !== null && Math.abs(position.getZ(i) - height) > 1e-6) continue;
    reach = Math.max(
      reach,
      Math.abs(position.getX(i) - centre[0]),
      Math.abs(position.getY(i) - centre[1]),
    );
  }
  return reach;
}

const centreOf = (geometry) => {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [(min.x + max.x) / 2, (min.y + max.y) / 2];
};

for (const [name, outline] of Object.entries(outlines)) {
  for (const rounding of [0.8, 1, 2]) {
    test(`${name} plate with ${rounding} mm rounding is a closed solid of the same size`, () => {
      const sharp = extrudeRoundedPlate(outline, THICKNESS, 0);
      const plate = extrudeRoundedPlate(outline, THICKNESS, rounding);

      assert.ok(verifiedSTL(plate).size > 84, "closed and consistently oriented");
      sharp.computeBoundingBox();
      plate.computeBoundingBox();
      for (const axis of ["x", "y", "z"]) {
        assert.ok(Math.abs(plate.boundingBox.min[axis] - sharp.boundingBox.min[axis]) < 1e-6, axis);
        assert.ok(Math.abs(plate.boundingBox.max[axis] - sharp.boundingBox.max[axis]) < 1e-6, axis);
      }
      assert.equal(plate.boundingBox.min.z, 0);
      assert.equal(plate.boundingBox.max.z, THICKNESS);
    });

    test(`${name} plate with ${rounding} mm rounding has flat faces pulled in by the rounding`, () => {
      const plate = extrudeRoundedPlate(outline, THICKNESS, rounding);
      const centre = centreOf(plate);
      const wall = reachAt(plate, null, centre);
      // A round plate is a 96-sided shape, so the pull-in is measured to within its own tiny sag.
      const slack = name === "round" ? 0.03 : 1e-6;
      assert.ok(Math.abs(reachAt(plate, THICKNESS, centre) - (wall - rounding)) < slack + 1e-6, "top face");
      assert.ok(Math.abs(reachAt(plate, 0, centre) - (wall - rounding)) < slack + 1e-6, "bottom face");
    });

    test(`${name} plate with ${rounding} mm rounding loses about the right amount of material`, () => {
      const sharp = volumeOf(extrudeRoundedPlate(outline, THICKNESS, 0));
      const plate = volumeOf(extrudeRoundedPlate(outline, THICKNESS, rounding));
      // A quarter-circle edge removes (1 - pi/4) r^2 per mm of edge, on the top and the bottom.
      const expected = 2 * perimeter(outline) * (1 - Math.PI / 4) * rounding ** 2;
      const removed = sharp - plate;
      assert.ok(removed > 0.85 * expected && removed < 1.15 * expected, `removed ${removed.toFixed(1)}, expected about ${expected.toFixed(1)}`);
    });
  }
}

test("zero rounding gives the plain plate", () => {
  const plate = extrudeRoundedPlate(square, THICKNESS, 0);
  assert.equal(plate.getAttribute("position").count / 3, 12, "a plain block");
  assert.ok(Math.abs(volumeOf(plate) - 50 * 50 * THICKNESS) < 1e-6);
});

for (const [name, outline] of Object.entries(outlines)) {
  test(`${name} plate with 2 mm on top and 1 mm underneath rounds each edge by its own amount`, () => {
    const plate = extrudeRoundedPlate(outline, THICKNESS, 2, 1);
    const centre = centreOf(plate);
    const wall = reachAt(plate, null, centre);
    const slack = name === "round" ? 0.03 : 1e-6;

    assert.ok(verifiedSTL(plate).size > 84, "closed and consistently oriented");
    assert.ok(Math.abs(reachAt(plate, THICKNESS, centre) - (wall - 2)) < slack + 1e-6, "top starts 2 mm in");
    assert.ok(Math.abs(reachAt(plate, 0, centre) - (wall - 1)) < slack + 1e-6, "bottom starts 1 mm in");

    // In between the two even roundings, and it is the same plate size.
    const both1 = volumeOf(extrudeRoundedPlate(outline, THICKNESS, 1, 1));
    const both2 = volumeOf(extrudeRoundedPlate(outline, THICKNESS, 2, 2));
    const mixed = volumeOf(plate);
    assert.ok(mixed < both1 && mixed > both2, `${both2.toFixed(1)} < ${mixed.toFixed(1)} < ${both1.toFixed(1)}`);
    plate.computeBoundingBox();
    assert.equal(plate.boundingBox.max.z - plate.boundingBox.min.z, THICKNESS);
  });
}

test("one edge can be left sharp while the other is rounded", () => {
  const sharpBottom = extrudeRoundedPlate(square, THICKNESS, 2, 0);
  assert.ok(verifiedSTL(sharpBottom).size > 84);
  assert.ok(Math.abs(reachAt(sharpBottom, THICKNESS, [0, 0]) - 23) < 1e-6, "top rounded");
  assert.ok(Math.abs(reachAt(sharpBottom, 0, [0, 0]) - 25) < 1e-6, "bottom sharp");

  const sharpTop = extrudeRoundedPlate(square, THICKNESS, 0, 1);
  assert.ok(verifiedSTL(sharpTop).size > 84);
  assert.ok(Math.abs(reachAt(sharpTop, THICKNESS, [0, 0]) - 25) < 1e-6, "top sharp");
  assert.ok(Math.abs(reachAt(sharpTop, 0, [0, 0]) - 24) < 1e-6, "bottom rounded");
});

test("two roundings that together are taller than the plate shrink in proportion", () => {
  const thin = extrudeRoundedPlate(square, 2, 3, 1);
  assert.ok(verifiedSTL(thin).size > 84);
  // 3 + 1 = 4 mm of curve on a 2 mm plate: halved to 1.5 and 0.5.
  assert.ok(Math.abs(reachAt(thin, 2, [0, 0]) - (25 - 1.5)) < 1e-6);
  assert.ok(Math.abs(reachAt(thin, 0, [0, 0]) - (25 - 0.5)) < 1e-6);
});

test("the rounding is held to half the thickness and to the width of the plate", () => {
  const thin = extrudeRoundedPlate(square, 1, 2);
  assert.ok(verifiedSTL(thin).size > 84, "a 1 mm plate asked for 2 mm");
  thin.computeBoundingBox();
  assert.equal(thin.boundingBox.max.z, 1);
  assert.ok(Math.abs(reachAt(thin, 1, [0, 0]) - (25 - 0.5)) < 1e-6, "clamped to half the thickness");
  assert.ok(Math.abs(reachAt(thin, null, [0, 0]) - 25) < 1e-6, "but the wall keeps its full size");

  const narrow = [[[[0, 0], [3, 0], [3, 30], [0, 30]]]];
  assert.ok(verifiedSTL(extrudeRoundedPlate(narrow, 6, 2)).size > 84, "a 3 mm wide plate");
});

test("rounded plates also join to the relief into one valid solid", () => {
  const plate = extrudeRoundedPlate(square, THICKNESS, 1);
  const letter = new THREE.BoxGeometry(10, 4, 2).toNonIndexed();
  letter.translate(0, 0, THICKNESS + 0.98);
  const joined = solidBoolean(plate, letter, "union", { firstLabel: "plate", secondLabel: "relief" });
  assert.ok(verifiedSTL(joined).size > 84);
});

test("an outline that is not convex is refused, and bad numbers are too", () => {
  const lShape = [[[[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]]]];
  assert.throws(() => extrudeRoundedPlate(lShape, THICKNESS, 1), /convex/);
  const twoPieces = [square[0], [[[40, 0], [50, 0], [50, 10], [40, 10]]][0]];
  assert.throws(() => extrudeRoundedPlate(twoPieces, THICKNESS, 1), /convex/);
  for (const thickness of [0, -1, Number.NaN]) {
    assert.throws(() => extrudeRoundedPlate(square, thickness, 1), RangeError, String(thickness));
  }
  assert.throws(() => extrudeRoundedPlate(square, THICKNESS, -0.5), RangeError);
  assert.throws(() => extrudeRoundedPlate([], THICKNESS, 1), /geen omtrek/);
});

// ---- the whole stamp ----------------------------------------------------

const font = opentype.parse((() => {
  const bytes = readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
})());
const artwork = validate(layoutText(font, { text: "CLAY", size: 16 })).artwork;
// The two roundings share the plate's height, so together they are held to the thickness.
const radii = (() => {
  const { edgeRoundingClaySideMm: clay, edgeRoundingBackSideMm: back } = SETTINGS.stamp;
  const fit = clay + back > THICKNESS ? THICKNESS / (clay + back) : 1;
  return { clay: clay * fit, back: back * fit };
})();

for (const faceShape of ["round", "square", "minimal"]) {
  for (const mode of ["emboss", "deboss"]) {
    test(`a ${faceShape} ${mode} stamp has its plate edges rounded by the setting`, () => {
      const built = buildStamp(artwork, { faceShape, mode, faceThickness: THICKNESS, faceSize: 50, roundedEdges: true });
      try {
        assert.ok(verifiedSTL(built.stamp).size > 84);
        const stamp = built.stamp;
        const centre = [built.layout.minX + built.layout.widthMm / 2, built.layout.minY + built.layout.heightMm / 2];
        const half = faceShape === "minimal" ? built.layout.widthMm / 2 : 25;
        const slack = faceShape === "round" ? 0.03 : 1e-4;
        // The widest part is the side wall; the plate top, away from the letters, is pulled in.
        assert.ok(Math.abs(reachAt(stamp, null, centre) - half) < slack + 1e-4, "side wall at full size");
        // Edge vertices at plate-top height can only come from the plate, as the letters are inside.
        const top = reachAt(stamp, THICKNESS, centre);
        assert.ok(Math.abs(top - (half - radii.clay)) < slack + 1e-4, `clay side ${top} vs ${half - radii.clay}`);
        const bottom = reachAt(stamp, 0, centre);
        assert.ok(Math.abs(bottom - (half - radii.back)) < slack + 1e-4, `back side ${bottom} vs ${half - radii.back}`);
      } finally {
        built.stamp.dispose();
        built.clay.dispose();
      }
    });
  }
}

// ---- the option ---------------------------------------------------------------

const widestAt = (built, height) => {
  const centre = [built.layout.minX + built.layout.widthMm / 2, built.layout.minY + built.layout.heightMm / 2];
  return reachAt(built.stamp, height, centre);
};

for (const faceShape of ["round", "square", "minimal"]) {
  test(`${faceShape}: with "Rounded edges" off the plate has sharp edges, and on it is rounded`, () => {
    const options = { faceShape, faceThickness: THICKNESS, faceSize: 50, roundedCorners: false };
    const off = buildStamp(artwork, { ...options, roundedEdges: false });
    const on = buildStamp(artwork, { ...options, roundedEdges: true });
    const missing = buildStamp(artwork, options);
    try {
      assert.ok(verifiedSTL(off.stamp).size > 84);
      const slack = faceShape === "round" ? 0.03 : 1e-4;
      const full = widestAt(off, null);
      assert.ok(Math.abs(widestAt(off, THICKNESS) - full) < slack, "sharp: the top reaches the side wall");
      assert.ok(Math.abs(widestAt(off, 0) - full) < slack, "sharp: the bottom reaches the side wall");
      assert.ok(Math.abs(widestAt(on, THICKNESS) - (full - radii.clay)) < slack, "rounded: the clay side is pulled in");
      assert.ok(Math.abs(widestAt(on, 0) - (full - radii.back)) < slack, "rounded: the back side is pulled in");
      const asDefault = DEFAULT_STAMP.roundedEdges ? on : off;
      assert.ok(Math.abs(widestAt(missing, THICKNESS) - widestAt(asDefault, THICKNESS)) < 1e-9, "no choice made: same as the default says");

      off.stamp.computeBoundingBox();
      on.stamp.computeBoundingBox();
      assert.ok(Math.abs(off.info.width - on.info.width) < 1e-6 && Math.abs(off.info.height - on.info.height) < 1e-6, "same outside size");
      if (radii.clay + radii.back > 0.01) {
        assert.ok(volumeOf(on.stamp) < volumeOf(off.stamp), "rounding takes a little material away");
      }
    } finally {
      for (const built of [off, on, missing]) {
        built.stamp.dispose();
        built.clay.dispose();
      }
    }
  });
}

test("the Rounded edges switch is shown for every shape and changes the stamp", () => {
  const { document, pipeline, calls, clickShape } = pageWith({ faceShape: "round" });
  const switchInput = document.getElementById("pipeline-rounded-edges");

  assert.equal(switchInput.checked, DEFAULT_STAMP.roundedEdges, "starts as the default says");
  assert.equal(switchInput.hidden, false);
  for (const shape of ["square", "minimal", "round"]) clickShape(shape);

  switchInput.checked = false;
  switchInput.dispatch("change");
  assert.deepEqual(calls.at(-1), { roundedEdges: false });
  assert.equal(pipeline.stamp.roundedEdges, false);
  switchInput.checked = true;
  switchInput.dispatch("change");
  assert.deepEqual(calls.at(-1), { roundedEdges: true });
});

test("the switch starts in the state of the stamp settings, and as the default for a design saved before the option", () => {
  assert.equal(pageWith({ roundedEdges: false }).document.getElementById("pipeline-rounded-edges").checked, false);
  assert.equal(pageWith({ roundedEdges: true }).document.getElementById("pipeline-rounded-edges").checked, true);
  assert.equal(
    pageWith({ roundedEdges: undefined }).document.getElementById("pipeline-rounded-edges").checked,
    DEFAULT_STAMP.roundedEdges,
  );
});

test("the page has the Rounded edges switch, not hidden", () => {
  const html = readFileSync(
    new URL("../src/stamp_generator/templates/stamp_generator/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<input[^>]*id="pipeline-rounded-edges"[^>]*type="checkbox"[^>]*role="switch"/s);
  assert.match(html, /Afgeronde randen/);
  assert.doesNotMatch(html, /<div id="pipeline-rounded-edges[^>]*\bhidden\b/);
});

test("the letters stay on the flat top of the plate with the shipped settings", () => {
  // Rounding never exceeds the edge distance, so artwork at the distance limit is still on the flat.
  assert.ok(SETTINGS.stamp.edgeRoundingClaySideMm <= SETTINGS.stamp.edgeDistanceMm.min);
  assert.ok(SETTINGS.stamp.edgeRoundingBackSideMm <= SETTINGS.stamp.edgeDistanceMm.min);
});
