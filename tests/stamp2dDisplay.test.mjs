import { test } from "node:test";
import assert from "node:assert/strict";
import { createStampLayout, layoutRenderElements } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { readableStampDisplay } from "../src/stamp_generator/static/stamp_generator/js/stamp2dDisplay.js";

const artwork = [[[
  [2, -1],
  [8, -1],
  [8, 3],
  [2, 3],
]]];
const baseSettings = {
  faceShape: "square",
  autoFaceSize: false,
  faceSize: 30,
  margin: 2,
};

test("2D automatically cancels the manufacturing mirror for readability", () => {
  const mirroredLayout = createStampLayout(artwork, {
    ...baseSettings,
    mirror: true,
  });
  const readableLayout = createStampLayout(artwork, {
    ...baseSettings,
    mirror: false,
  });
  const physicalElements = layoutRenderElements(
    [{ id: "text-1", kind: "text", canonical: artwork, transform: {} }],
    mirroredLayout.artworkTransform,
  );
  const display = readableStampDisplay(mirroredLayout, physicalElements);

  assert.deepEqual(display.artwork, readableLayout.artwork);
  assert.deepEqual(display.elements[0].canonical, readableLayout.artwork);
  assert.equal(display.interactionTransform.mirrorX, false);
  assert.notDeepEqual(mirroredLayout.artwork, display.artwork);
});

test("2D leaves an already readable non-mirrored stamp unchanged", () => {
  const layout = createStampLayout(artwork, {
    ...baseSettings,
    mirror: false,
  });
  const display = readableStampDisplay(layout);

  assert.deepEqual(display.artwork, layout.artwork);
  assert.deepEqual(display.face, layout.face);
});
