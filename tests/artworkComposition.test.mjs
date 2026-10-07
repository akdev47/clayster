import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel, createDesignElement } from "../src/designModel.js";
import {
  ArtworkComposer,
  ElementConversionError,
  elementFromLegacySource,
} from "../src/pipeline/artworkComposition.js";
import { bounds, ringArea } from "../src/pipeline/canonical.js";

const rectangle = (minX, minY, maxX, maxY) => [
  [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ],
];

const geometryByKind = {
  text: [rectangle(0, 0, 2, 2)],
  svg: [rectangle(5, 0, 7, 2)],
  png: [rectangle(10, 0, 12, 2)],
};

const cloneGeometry = (geometry) =>
  geometry.map((polygon) =>
    polygon.map((ring) => ring.map((point) => [...point])),
  );

function element(kind, id = kind, transform = {}) {
  const sources = {
    text: { text: id },
    svg: { reference: `${id}.svg` },
    png: { reference: `${id}.png` },
  };
  return createDesignElement({ id, kind, source: sources[kind], transform });
}

function composerWith(geometry = geometryByKind) {
  return new ArtworkComposer(async ({ kind }) => ({
    canonical: cloneGeometry(geometry[kind]),
    issues: [],
  }));
}

async function assertCombination(kinds) {
  const result = await composerWith().compose(
    kinds.map((kind, index) => element(kind, `${kind}-${index}`)),
  );

  assert.equal(result.artwork.length, kinds.length);
  assert.equal(
    result.issues.some(({ level }) => level === "error"),
    false,
  );
}

test("composes text and SVG elements", async () => {
  await assertCombination(["text", "svg"]);
});

test("composes text and PNG elements", async () => {
  await assertCombination(["text", "png"]);
});

test("composes SVG and PNG elements", async () => {
  await assertCombination(["svg", "png"]);
});

test("composes text, SVG and PNG elements together", async () => {
  await assertCombination(["text", "svg", "png"]);
});

test("unions overlapping elements during the one global validation pass", async () => {
  const geometry = {
    ...geometryByKind,
    text: [rectangle(0, 0, 10, 10)],
    svg: [rectangle(5, 0, 15, 10)],
  };
  const result = await composerWith(geometry).compose([
    element("text", "label"),
    element("svg", "mark"),
  ]);

  assert.equal(result.artwork.length, 1);
  assert.equal(bounds(result.artwork).width, 15);
  assert.ok(
    result.issues.some(
      ({ level, message, scope }) =>
        level === "fixed" &&
        scope === "design" &&
        /merged overlapping/i.test(message),
    ),
  );
});

test("element transforms affect only their own converted geometry", async () => {
  const sameLocalGeometry = {
    ...geometryByKind,
    svg: geometryByKind.text,
  };
  const result = await composerWith(sameLocalGeometry).compose([
    element("text", "stationary"),
    element("svg", "moved", { xMm: 10 }),
  ]);
  const boxes = result.artwork
    .map((polygon) => bounds([polygon]))
    .sort((first, second) => first.minX - second.minX);

  assert.deepEqual(
    boxes.map(({ minX, maxX }) => [minX, maxX]),
    [
      [0, 2],
      [10, 12],
    ],
  );
});

test("mirrored and rotated elements retain valid outer and hole winding", async () => {
  const donut = [
    [
      [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ],
      [
        [2, 2],
        [2, 4],
        [4, 4],
        [4, 2],
      ],
    ],
  ];
  const result = await composerWith({
    ...geometryByKind,
    svg: donut,
  }).compose([
    element("svg", "reflected", {
      mirrorY: true,
      rotationDeg: 37,
      pivotX: 3,
      pivotY: 3,
    }),
  ]);

  assert.equal(result.artwork[0].length, 2);
  assert.ok(ringArea(result.artwork[0][0]) > 0);
  assert.ok(ringArea(result.artwork[0][1]) < 0);
});

test("an invalid element blocks composition and identifies that element", async () => {
  const composer = new ArtworkComposer(async ({ id, kind }) => ({
    canonical: cloneGeometry(geometryByKind[kind]),
    issues:
      id === "bad-png"
        ? [{ level: "error", message: "Trace contains no closed contour." }]
        : [],
  }));

  await assert.rejects(
    composer.compose([
      element("text", "valid-text"),
      element("png", "bad-png"),
    ]),
    (error) =>
      error instanceof ElementConversionError &&
      error.elementId === "bad-png" &&
      error.elementKind === "png" &&
      /Trace contains no closed contour/.test(error.message),
  );
});

test("keeps element conversion issues separate from design issues", async () => {
  const composer = new ArtworkComposer(async ({ kind }) => ({
    canonical: cloneGeometry(geometryByKind[kind]),
    issues:
      kind === "text"
        ? [{ level: "warning", message: "Text was reduced to fit." }]
        : [],
  }));
  const result = await composer.compose([
    element("text", "label"),
    element("svg", "mark"),
  ]);
  const elementIssue = result.issues.find(
    ({ message }) => message === "Text was reduced to fit.",
  );
  const designIssue = result.issues.find(({ scope }) => scope === "design");

  assert.equal(elementIssue.scope, "element");
  assert.equal(elementIssue.elementId, "label");
  assert.equal(elementIssue.elementKind, "text");
  assert.equal(designIssue.level, "ok");
});

test("moving and other transform-only edits reuse source conversion", async () => {
  let conversions = 0;
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: cloneGeometry(geometryByKind.text), issues: [] };
  });
  const model = new DesignModel({
    elements: [element("text", "movable")],
  });

  const first = await composer.compose(model.elements);
  model.updateElement("movable", { transform: { xMm: 20 } });
  const second = await composer.compose(model.elements);
  model.updateElement("movable", {
    transform: { scale: 1.5, rotationDeg: 25, mirrorX: true },
  });
  await composer.compose(model.elements);

  assert.equal(conversions, 1);
  assert.equal(bounds(first.artwork).minX, 0);
  assert.equal(bounds(second.artwork).minX, 20);
});

test("changing PNG background settings invalidates source conversion", async () => {
  let conversions = 0;
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: cloneGeometry(geometryByKind.png), issues: [] };
  });
  const model = new DesignModel({ elements: [element("png", "mark")] });

  await composer.compose(model.elements);
  model.updateElement("mark", {
    source: {
      tracing: {
        ...model.getElement("mark").source.tracing,
        backgroundMode: "original",
      },
    },
  });
  await composer.compose(model.elements);

  assert.equal(conversions, 2);
});

test("trusted PNG samples and tolerance invalidate conversion independently", async () => {
  let conversions = 0;
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return { canonical: cloneGeometry(geometryByKind.png), issues: [] };
  });
  const model = new DesignModel({ elements: [element("png", "sampled")] });

  await composer.compose(model.elements);
  model.updateElement("sampled", {
    source: {
      tracing: {
        ...model.getElement("sampled").source.tracing,
        backgroundMode: "pick",
        backgroundSamples: [{ x: 0.1, y: 0.2 }],
      },
    },
  });
  await composer.compose(model.elements);
  model.updateElement("sampled", {
    source: {
      tracing: {
        ...model.getElement("sampled").source.tracing,
        backgroundSamples: [],
      },
    },
  });
  await composer.compose(model.elements);
  model.updateElement("sampled", {
    source: {
      tracing: {
        ...model.getElement("sampled").source.tracing,
        backgroundTolerance: 1.25,
      },
    },
  });
  await composer.compose(model.elements);
  model.updateElement("sampled", { transform: { xMm: 5, scale: 1.2 } });
  await composer.compose(model.elements);

  assert.equal(conversions, 4);
});

test("transform-only PNG edits reuse background removal conversion", async () => {
  let conversions = 0;
  const composer = new ArtworkComposer(async () => {
    conversions += 1;
    return {
      canonical: cloneGeometry(geometryByKind.png),
      issues: [],
      segmentation: {
        status: "needs-review",
        method: "original-fallback",
        message: "Auto background detection failed — review the traced result.",
      },
    };
  });
  const model = new DesignModel({ elements: [element("png", "mark")] });

  const first = await composer.compose(model.elements);
  model.updateElement("mark", {
    transform: { xMm: 6, rotationDeg: 30, scale: 1.5 },
  });
  const second = await composer.compose(model.elements);

  assert.equal(conversions, 1);
  assert.deepEqual(first.segmentations, [
    {
      elementId: "mark",
      elementKind: "png",
      status: "needs-review",
      method: "original-fallback",
      message: "Auto background detection failed — review the traced result.",
    },
  ]);
  assert.deepEqual(second.segmentations, first.segmentations);
});

test("invisible elements do not convert or enter the composition", async () => {
  const converted = [];
  const composer = new ArtworkComposer(async ({ id, kind }) => {
    converted.push(id);
    return { canonical: cloneGeometry(geometryByKind[kind]), issues: [] };
  });
  const hidden = createDesignElement({
    ...element("png", "hidden-png"),
    visible: false,
  });
  const result = await composer.compose([
    element("text", "visible-text"),
    hidden,
  ]);

  assert.deepEqual(converted, ["visible-text"]);
  assert.equal(result.artwork.length, 1);
});

test("the legacy single-source adapter preserves the current source fields", () => {
  const source = {
    kind: "text",
    text: "CLAY",
    fontId: "sans-bold",
    fontFile: null,
    size: 16,
    letterSpacing: 0.5,
    lineSpacing: 1.25,
    align: "center",
    svgFile: null,
    svgSize: 30,
    pngFile: null,
    pngSize: 30,
    pngSmoothing: 2,
  };
  const adapted = elementFromLegacySource(source);

  assert.equal(adapted.id, "legacy-source");
  assert.equal(adapted.kind, source.kind);
  assert.deepEqual(adapted.source, {
    text: source.text,
    font: { id: source.fontId, reference: source.fontFile },
    fontSizeMm: source.size,
    letterSpacingMm: source.letterSpacing,
    lineSpacing: source.lineSpacing,
    alignment: source.align,
  });
  assert.deepEqual(adapted.transform, {
    xMm: 0,
    yMm: 0,
    scale: 1,
    rotationDeg: 0,
    mirrorX: false,
    mirrorY: false,
    pivotX: 0,
    pivotY: 0,
  });

  const svgReference = { name: "mark.svg" };
  const adaptedSVG = elementFromLegacySource({
    ...source,
    kind: "svg",
    svgFile: svgReference,
    svgSize: 42,
  });
  assert.equal(adaptedSVG.source.reference, svgReference);
  assert.equal(adaptedSVG.source.baseSizeMm, 42);

  const pngReference = { name: "mark.png" };
  const adaptedPNG = elementFromLegacySource({
    ...source,
    kind: "png",
    pngFile: pngReference,
    pngSize: 28,
    pngSmoothing: 4,
  });
  assert.equal(adaptedPNG.source.reference, pngReference);
  assert.equal(adaptedPNG.source.baseSizeMm, 28);
  assert.deepEqual(adaptedPNG.source.tracing, {
    smoothing: 4,
    backgroundMode: "auto",
    backgroundSamples: [],
    backgroundTolerance: 1,
  });
});
