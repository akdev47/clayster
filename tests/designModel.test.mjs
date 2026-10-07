import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ELEMENT_TRANSFORM,
  DesignModel,
  createDesignElement,
} from "../src/designModel.js";

test("creates type-specific editable element intent without derived geometry", () => {
  const svgReference = { assetId: "logo" };
  const elements = [
    createDesignElement({
      id: "text-1",
      kind: "text",
      source: {
        text: "Clayster",
        font: { id: "sans-bold" },
        fontSizeMm: 20,
        letterSpacingMm: 0.5,
        lineSpacing: 1.2,
        alignment: "left",
      },
    }),
    createDesignElement({
      id: "svg-1",
      kind: "svg",
      source: { reference: svgReference, baseSizeMm: 35 },
    }),
    createDesignElement({
      id: "png-1",
      kind: "png",
      source: {
        reference: "asset:mark.png",
        baseSizeMm: 24,
        tracing: { smoothing: 3, threshold: 140 },
      },
    }),
  ];

  assert.deepEqual(elements[0].transform, DEFAULT_ELEMENT_TRANSFORM);
  assert.deepEqual(elements[0].source.font, {
    id: "sans-bold",
    reference: null,
  });
  assert.equal(elements[1].source.reference, svgReference);
  assert.deepEqual(elements[2].source.tracing, {
    smoothing: 3,
    backgroundMode: "auto",
    backgroundSamples: [],
    backgroundTolerance: 1,
    threshold: 140,
  });
  assert.equal("canonical" in elements[0], false);
  assert.equal("selected" in elements[0], false);
});

test("normalizes and freezes trusted PNG background sampling settings", () => {
  const element = createDesignElement({
    id: "sampled-png",
    kind: "png",
    source: {
      tracing: {
        backgroundMode: "pick",
        backgroundSamples: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.8 },
        ],
        backgroundTolerance: 1.25,
      },
    },
  });

  assert.deepEqual(element.source.tracing.backgroundSamples, [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.8 },
  ]);
  assert.equal(Object.isFrozen(element.source.tracing.backgroundSamples), true);
  assert.equal(Object.isFrozen(element.source.tracing.backgroundSamples[0]), true);
  assert.throws(
    () =>
      createDesignElement({
        kind: "png",
        source: { tracing: { backgroundSamples: [{ x: -0.1, y: 0.5 }] } },
      }),
    /normalized between zero and one/i,
  );
  assert.throws(
    () =>
      createDesignElement({
        kind: "png",
        source: { tracing: { backgroundTolerance: 2 } },
      }),
    /tolerance must be between/i,
  );
});

test("keeps ids stable while updating source and physical transform", () => {
  const model = new DesignModel({
    elements: [{ id: "text-1", kind: "text" }],
  });
  let changes = 0;
  model.addEventListener("change", () => changes++);

  const updated = model.updateElement("text-1", {
    source: { text: "Updated" },
    transform: { xMm: 12, mirrorY: true },
  });

  assert.equal(updated.id, "text-1");
  assert.equal(updated.source.text, "Updated");
  assert.equal(updated.source.fontSizeMm, 16);
  assert.equal(updated.transform.xMm, 12);
  assert.equal(updated.transform.scale, 1);
  assert.equal(updated.transform.mirrorY, true);
  assert.equal(changes, 1);
});

test("rejects duplicate or mutable element identities", () => {
  const model = new DesignModel({
    elements: [{ id: "one", kind: "svg" }],
  });

  assert.throws(
    () => model.addElement({ id: "one", kind: "png" }),
    /already exists/,
  );
  assert.throws(
    () => model.updateElement("one", { id: "two" }),
    /cannot be changed/,
  );
  assert.throws(
    () => model.updateElement("one", { kind: "png" }),
    /cannot be changed/,
  );
});
