import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { DesignEditorController } from "../src/stamp_generator/static/stamp_generator/js/editor2dInteractions.js";
import { createPipelineDiagnostics } from "../src/stamp_generator/static/stamp_generator/js/pipelineDiagnostics.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";
import { prepareClosedStamp, verifiedSTL } from "../src/stamp_generator/static/stamp_generator/js/exportValidation.js";
import { validate } from "../src/stamp_generator/static/stamp_generator/js/pipeline/validate.js";
import { buildStamp } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stamp.js";
import { layoutRenderElements } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { bounds, ringArea } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { canonicalizeSVGShapes } from "../src/stamp_generator/static/stamp_generator/js/pipeline/svg.js";
import { postProcessPNGArtwork } from "../src/stamp_generator/static/stamp_generator/js/pipeline/png.js";
import { traceMaskToSVG } from "../src/stamp_generator/static/stamp_generator/js/pngTrace.js";
import { getFilledSVGShapes } from "../src/stamp_generator/static/stamp_generator/js/svgValidation.js";

// Resolve Vite's asset imports for Node without replacing application modules.
const assets = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("?url")) {
      const resolved = nextResolve(specifier.slice(0, -4), context);
      return { ...resolved, url: `${resolved.url}?url` };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("?url")) {
      return {
        format: "module",
        source: `export default ${JSON.stringify(fileURLToPath(url))};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { Pipeline } = await import("../src/stamp_generator/static/stamp_generator/js/pipeline/index.js");
assets.deregister();
await initializeSolids();

const font = new File(
  [readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url))],
  "NotoSans-Bold.ttf",
);
const rectangle = (x0, y0, x1, y1) => [
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
];
const text = (id = "label", source = {}) => ({
  id,
  kind: "text",
  source: { text: "BOA8", font: { reference: font }, ...source },
});

function setup(elements, convert = null) {
  const model = new DesignModel({ elements });
  const editor = new DesignEditorController(model);
  const pipeline = new Pipeline({ designModel: model });
  pipeline.stamp.handle = "none";
  if (convert !== null) {
    const original = pipeline.buildElementArtwork.bind(pipeline);
    pipeline.buildElementArtwork = (element) => convert(element, original);
  }
  const rendered = [];
  const sidebar = createPipelineDiagnostics(pipeline, {
    render: (state) => rendered.push(state),
  });
  return { model, editor, pipeline, sidebar, rendered };
}

function dispose(pipeline) {
  clearTimeout(pipeline.timer);
  pipeline.result?.stamp?.dispose();
  pipeline.result?.clay?.dispose();
}

async function rejectedRun(pipeline) {
  // Expected failures are user-facing; keep their console stack out of TAP.
  const log = console.error;
  console.error = () => {};
  try {
    await pipeline.run();
  } finally {
    console.error = log;
  }
}

function bowTie() {
  const path = new THREE.ShapePath();
  path.moveTo(0, 0);
  path.lineTo(10, 10);
  path.lineTo(0, 10);
  path.lineTo(10, 0);
  path.currentPath.closePath();
  path.userData = {
    style: { fill: "#000", opacity: 1, fillOpacity: 1, stroke: "none" },
  };
  return path;
}

function filledShape(outer, holes = []) {
  const path = (points, Target) => {
    const result = new Target();
    result.moveTo(...points[0]);
    for (const point of points.slice(1)) result.lineTo(...point);
    result.closePath();
    return result;
  };
  const shape = path(outer, THREE.Shape);
  shape.holes.push(...holes.map((hole) => path(hole, THREE.Path)));
  return shape;
}

// Equivalent to the supplied bird SVG's topology: two bird bodies touch at
// one convex beak tip, each has two holes, and three separate hearts survive.
function birdPointContactArtwork() {
  const hole = (x, y) =>
    Array.from({ length: 8 }, (_, index) => {
      const angle = (-index / 8) * Math.PI * 2;
      return [x + Math.cos(angle) * 0.5, y + Math.sin(angle) * 0.5];
    });
  const shapes = [
    filledShape(
      [[-12, -6], [-2, -6], [0, 0], [-2, 6], [-12, 6]],
      [hole(-9, 0), hole(-5, 0)],
    ),
    filledShape(
      [[0, 0], [2, -6], [12, -6], [12, 6], [2, 6]],
      [hole(5, 0), hole(9, 0)],
    ),
    filledShape([[-10, 8], [-8, 7], [-6, 8], [-8, 11]]),
    filledShape([[-2, 8], [0, 7], [2, 8], [0, 12]]),
    filledShape([[6, 8], [8, 7], [10, 8], [8, 11]]),
  ];
  return canonicalizeSVGShapes(shapes, {}, 30);
}

for (const kind of ["text", "svg", "png"]) {
  test(`invalid ${kind} blocks the full pipeline and identifies the element in shared diagnostics`, async () => {
    const bad = kind === "text"
      ? text("bad-text", { font: { reference: new File(["invalid"], "bad.ttf") } })
      : { id: `bad-${kind}`, kind, source: { reference: `${kind}-fixture` } };
    const { pipeline, sidebar, editor, rendered } = setup(
      [text("valid-text"), bad],
      (element, original) => {
        if (element.kind === "svg") {
          // Browser decoding boundary: exercise the real SVG shape guard.
          getFilledSVGShapes({ paths: [bowTie()] });
        }
        if (element.kind === "png") {
          // Browser decoding boundary: exercise the real empty-raster guard.
          traceMaskToSVG(new Uint8Array(16), 4, 4);
        }
        return original(element);
      },
    );
    let stampPreparations = 0;
    pipeline.handleGeometry = async () => { stampPreparations += 1; return null; };
    try {
      await rejectedRun(pipeline);
      assert.equal(pipeline.result, null);
      assert.equal(stampPreparations, 0);
      assert.equal(pipeline.error.elementId, `bad-${kind}`);
      assert.equal(sidebar.state.export.ready, false);
      const message = sidebar.state.rows.map((row) => row.message).join("\n");
      assert.match(message, new RegExp(`bad-${kind}`));
      if (kind === "svg") {
        assert.match(message, /self-intersecting or zero-area filled outline/i);
        assert.ok(sidebar.state.rows.some((row) => row.details?.some((detail) => /Stage: SVG shape conversion/.test(detail))));
      }
      const before = sidebar.state;
      const count = rendered.length;
      editor.setView("3d");
      editor.setView("2d");
      assert.equal(sidebar.state, before);
      assert.equal(rendered.length, count);
    } finally {
      dispose(pipeline);
    }
  });
}

test("mixed Text/SVG/PNG reaches global repair, final mesh checks and verified STL", async () => {
  // SVG/PNG use decoded source fixtures; text uses the actual font converter.
  const svg = new THREE.Shape();
  svg.absellipse(0, 0, 5, 3, 0, Math.PI * 2, false, 0);
  const { pipeline, sidebar, editor, rendered } = setup([
    text(),
    { id: "vector", kind: "svg", source: { reference: "decoded.svg" }, transform: { xMm: 22, rotationDeg: 20, mirrorX: true } },
    { id: "raster", kind: "png", source: { reference: "decoded.png" }, transform: { xMm: 22 } },
  ], (element, original) => {
    if (element.kind === "text") return original(element);
    return {
      canonical: element.kind === "svg"
        ? canonicalizeSVGShapes([svg], {}, 10)
        : postProcessPNGArtwork([rectangle(0, 0, 4, 4)], 10, { smoothing: 0 }),
      issues: [],
    };
  });
  pipeline.stamp.autoFaceSize = true;
  try {
    await pipeline.run();
    assert.equal(pipeline.error, null);
    assert.equal(pipeline.result.renderElements.length, 3);
    assert.ok(pipeline.result.issues.some(({ scope, level, message }) => scope === "design" && level === "fixed" && /merged overlapping/i.test(message)));
    for (const polygon of pipeline.result.artwork) {
      assert.ok(ringArea(polygon[0]) > 0);
      for (const hole of polygon.slice(1)) assert.ok(ringArea(hole) < 0);
    }
    assert.ok(pipeline.result.artwork.some((polygon) => polygon.length > 1));
    assert.ok(pipeline.result.notes.some((note) => /closed, consistently oriented edges/i.test(note)));
    assert.equal(sidebar.state.export.ready, true);
    assert.ok(sidebar.state.info.triangles > 0);
    const state = sidebar.state;
    const renderCount = rendered.length;
    editor.setView("3d");
    editor.setView("2d");
    assert.equal(sidebar.state, state);
    assert.equal(rendered.length, renderCount);
    const blob = verifiedSTL(pipeline.result.stamp);
    const reloaded = new STLLoader().parse(await blob.arrayBuffer());
    const checked = prepareClosedStamp(reloaded);
    pipeline.result.stamp.computeBoundingBox();
    assert.ok(checked.boundingBox.equals(pipeline.result.stamp.boundingBox));
    assert.equal(checked.index.count, pipeline.result.stamp.getAttribute("position").count);
    checked.dispose();
    reloaded.dispose();
  } finally {
    dispose(pipeline);
  }
});

for (const mode of ["emboss", "deboss"]) {
  test(`isolated SVG point contact is repaired through ${mode} and STL round-trip`, async () => {
    const sourceArtwork = birdPointContactArtwork();
    let unrepaired = null;
    let constructionError = null;
    try {
      unrepaired = buildStamp(sourceArtwork, {
        faceShape: "square",
        faceSize: 45,
        mode,
        handle: "none",
      });
    } catch (error) {
      constructionError = error;
    }
    if (constructionError === null) {
      assert.throws(() => prepareClosedStamp(unrepaired.stamp), /non-manifold/i);
    } else {
      assert.match(
        constructionError.message,
        /not a closed manifold|non-manifold/i,
      );
    }
    unrepaired?.stamp.dispose();
    unrepaired?.clay.dispose();

    const { pipeline, sidebar } = setup(
      [{ id: "bird-svg", kind: "svg", source: { reference: "bird.svg" } }],
      () => ({ canonical: sourceArtwork, issues: [] }),
    );
    pipeline.stamp.faceShape = "square";
    pipeline.stamp.faceSize = 45;
    pipeline.stamp.mode = mode;
    try {
      await pipeline.run();
      assert.equal(pipeline.error, null);
      assert.equal(pipeline.result.artwork.length, 5);
      assert.equal(
        pipeline.result.artwork.reduce(
          (total, polygon) => total + polygon.length - 1,
          0,
        ),
        4,
      );
      assert.ok(pipeline.result.issues.some(
        ({ level, message }) =>
          level === "fixed" && /isolated point contact/i.test(message),
      ));
      assert.equal(sidebar.state.export.ready, true);

      const blob = verifiedSTL(pipeline.result.stamp);
      const reloaded = new STLLoader().parse(await blob.arrayBuffer());
      const checked = prepareClosedStamp(reloaded);
      assert.ok(blob.size > 84);
      checked.dispose();
      reloaded.dispose();
    } finally {
      dispose(pipeline);
    }
  });
}

test("transform-only 2D edits reuse conversion but rerun global validation and clear stale diagnostics", async () => {
  let conversions = 0;
  const { model, editor, pipeline, sidebar } = setup([
    { id: "first", kind: "svg", source: { reference: "first.svg" } },
    { id: "second", kind: "png", source: { reference: "second.png" }, transform: { xMm: 15 } },
  ], () => {
    conversions += 1;
    return { canonical: [rectangle(0, 0, 10, 10)], issues: [] };
  });
  try {
    await pipeline.run();
    assert.equal(pipeline.result.artwork.length, 2);
    dispose(pipeline);
    editor.select("second");
    editor.moveFromScreenDelta("second", model.getElement("second").transform,
      { deltaX: -100, deltaY: 0 }, { width: 400, height: 400 }, { widthMm: 40, heightMm: 40 });
    assert.equal(sidebar.state.export.ready, false);
    assert.equal(sidebar.state.info, null);
    assert.equal(sidebar.state.rows.length, 1);
    assert.equal(sidebar.state.rows[0].level, "working");
    await pipeline.run();
    assert.equal(conversions, 2);
    assert.equal(pipeline.result.artwork.length, 1);
    assert.equal(bounds(pipeline.result.artwork).width, 15);
    assert.ok(pipeline.result.issues.some(({ level }) => level === "fixed"));
    dispose(pipeline);
    model.updateElement("first", { transform: { scale: 0.00001 } });
    await pipeline.run();
    assert.equal(conversions, 2);
    assert.ok(pipeline.result.issues.some(({ message }) => /sliver outline/i.test(message)));
  } finally {
    dispose(pipeline);
  }
});

test("global polygon repair fails closed before stamp generation and reaches the sidebar", async () => {
  const { pipeline, sidebar } = setup([text()]);
  const checked = validate([[[["0", "0"], ["10", "0"], ["10", "10"], ["0", "10"]]]]);
  pipeline.artwork = async () => checked;
  let preparations = 0;
  pipeline.handleGeometry = async () => { preparations += 1; return null; };
  try {
    await pipeline.run();
    assert.equal(preparations, 0);
    assert.deepEqual(pipeline.result.artwork, []);
    assert.equal(pipeline.result.stamp, null);
    assert.equal(sidebar.state.export.ready, false);
    assert.ok(sidebar.state.rows.some(({ level, message }) => level === "error" && /could not be repaired safely/i.test(message)));
  } finally {
    dispose(pipeline);
  }
});

test("artwork validation failure exposes no canonical preview geometry", async () => {
  const { pipeline, sidebar } = setup([text()]);
  pipeline.artwork = async () => ({
    artwork: [],
    issues: [{ level: "error", message: "Artwork validation failed." }],
    renderElements: [
      { id: "invalid", kind: "text", canonical: [rectangle(0, 0, 10, 10)] },
    ],
  });
  try {
    await pipeline.run();
    assert.deepEqual(pipeline.result.artwork, []);
    assert.equal(pipeline.result.renderElements, null);
    assert.equal(pipeline.result.stamp, null);
    assert.equal(sidebar.state.export.ready, false);
  } finally {
    dispose(pipeline);
  }
});

test("shared pipeline checks thin features at final element scale without face rescaling", async () => {
  const { pipeline, sidebar, model } = setup([
    { id: "strip", kind: "svg", source: { reference: "strip.svg" },
      transform: { scale: 0.3, xMm: -3, yMm: -0.3 } },
  ], () => ({ canonical: [rectangle(0, 0, 20, 2)], issues: [] }));
  pipeline.stamp.autoFaceSize = false;
  pipeline.stamp.faceShape = "square";
  pipeline.stamp.faceSize = 10;
  pipeline.stamp.margin = 2;
  try {
    await pipeline.run();
    assert.ok(pipeline.result.issues.some(({ level, message }) => level === "warning" && /thinner than/i.test(message)));
    assert.equal(pipeline.result.layout.artworkTransform.scale, 1);
    assert.ok(sidebar.state.rows.some(({ level }) => level === "warning"));
    dispose(pipeline);
    model.updateElement("strip", { transform: { scale: 1, xMm: -10, yMm: -1 } });
    pipeline.setStamp({ faceSize: 30 });
    await pipeline.run();
    assert.equal(pipeline.result.issues.some(({ level }) => level === "warning"), false);
    assert.equal(sidebar.state.export.ready, true);
  } finally {
    dispose(pipeline);
  }
});

test("new Clayster Studio text is print-safe by default while genuinely thin text still warns", async () => {
  const source = {
    text: "Clayster Studio",
    font: { id: "sans-bold", reference: font },
    fontSizeMm: 7.5,
    letterSpacingRatio: 1 / 7.5,
    lineSpacing: 1.25,
    alignment: "center",
    thicknessMm: 0.3,
  };
  const { pipeline, model, sidebar } = setup([
    { id: "text-1", kind: "text", source },
  ]);

  try {
    await pipeline.run();

    assert.ok(pipeline.result.issues.some(({ level, message }) =>
      level === "info" && /Wrapped onto 2 rows/i.test(message)));
    assert.ok(sidebar.state.rows.some(({ level, message }) =>
      level === "info" && /Wrapped onto 2 rows/i.test(message)));
    assert.equal(pipeline.result.issues.some(({ message }) =>
      /thinner than about 0\.8 mm/i.test(message)), false);
    assert.equal(pipeline.result.layout.overflows, false);
    assert.ok(pipeline.result.stamp);

    const displayed = layoutRenderElements(
      pipeline.result.renderElements,
      pipeline.result.layout.artworkTransform,
    );
    const displayBounds = bounds(displayed[0].canonical);
    const stampBounds = bounds(pipeline.result.layout.artwork);
    for (const field of ["minX", "minY", "maxX", "maxY"]) {
      assert.ok(Math.abs(displayBounds[field] - stampBounds[field]) <= 0.05);
    }
    assert.ok(verifiedSTL(pipeline.result.stamp).size > 84);

    pipeline.result.stamp.dispose();
    pipeline.result.clay.dispose();
    model.updateElement("text-1", { source: { text: "w", thicknessMm: 0 } });
    await pipeline.run();

    assert.ok(pipeline.result.issues.some(({ level, message }) =>
      level === "warning" && /Potentially thin letters: w/i.test(message)));
    const thinLetters = pipeline.result.issues.find(({ message }) => /Potentially thin letters/.test(message));
    assert.equal(thinLetters.elementId, "text-1");
    assert.equal(thinLetters.thinGlyphs.length, 1);
    assert.deepEqual(thinLetters.thinGlyphs.map(({ character, line, column }) =>
      [character, line, column]), [
      ["w", 1, 1],
    ]);
    assert.deepEqual(thinLetters.details, [
      "“w” — line 1, character 1 in the laid-out text.",
    ]);
    assert.ok(verifiedSTL(pipeline.result.stamp).size > 84);
  } finally {
    dispose(pipeline);
  }
});

for (const mode of ["emboss", "deboss"]) {
  test(`default acute glyphs remain warning-free through ${mode} and STL validation`, async () => {
    const { pipeline } = setup([text("acute-glyphs", {
      text: "AMWw",
      fontSizeMm: 7.5,
      letterSpacingRatio: 1 / 7.5,
      lineSpacing: 1.25,
      alignment: "center",
      thicknessMm: 0.3,
    })]);
    pipeline.stamp.mode = mode;

    try {
      await pipeline.run();

      assert.equal(pipeline.error, null);
      assert.equal(pipeline.result.issues.some(({ message }) =>
        /thinner than about 0\.8 mm|Potentially thin letters/i.test(message)), false);
      assert.ok(verifiedSTL(pipeline.result.stamp).size > 84);
    } finally {
      dispose(pipeline);
    }
  });
}

test("thin letter positions survive transforms and cached text conversion", async () => {
  const { pipeline, model } = setup([text("repeated", {
    text: "aa\na", fontSizeMm: 7.5, letterSpacingRatio: 1 / 7.5,
    thicknessMm: 0,
  })]);
  let conversions = 0;
  const convert = pipeline.buildElementArtwork.bind(pipeline);
  pipeline.buildElementArtwork = (element) => {
    conversions++;
    return convert(element);
  };
  try {
    await pipeline.run();
    const first = pipeline.result.issues.find(({ message }) => /Potentially thin letters/.test(message));
    assert.equal(first.details.length, 3);
    assert.match(first.details[0], /line 1, character 1/);
    assert.match(first.details[1], /line 1, character 2/);
    assert.match(first.details[2], /line 2, character 1/);
    pipeline.result.stamp.dispose();
    pipeline.result.clay.dispose();

    model.updateElement("repeated", { transform: {
      xMm: 2, yMm: 2, rotationDeg: 15, mirrorX: true,
    } });
    await pipeline.run();
    const moved = pipeline.result.issues.find(({ message }) => /Potentially thin letters/.test(message));
    assert.deepEqual(moved.details, first.details);
    assert.equal(conversions, 1);
    assert.ok(verifiedSTL(pipeline.result.stamp).size > 84);
  } finally {
    dispose(pipeline);
  }
});

test("manual face overflow keeps artwork editable but blocks review and export", async () => {
  const { pipeline, sidebar } = setup([
    { id: "wide", kind: "svg", source: { reference: "wide.svg" } },
  ], () => ({ canonical: [rectangle(-10, -2, 10, 2)], issues: [] }));
  pipeline.stamp.autoFaceSize = false;
  pipeline.stamp.faceShape = "square";
  pipeline.stamp.faceSize = 12;
  pipeline.stamp.margin = 1;
  try {
    await pipeline.run();
    assert.equal(pipeline.error, null);
    assert.equal(pipeline.result.layout.faceSize, 12);
    assert.equal(pipeline.result.layout.widthMm, 12);
    assert.equal(pipeline.result.layout.artworkTransform.scale, 1);
    assert.equal(bounds(pipeline.result.layout.artwork).width, 20);
    assert.equal(pipeline.result.layout.overflows, true);
    assert.ok(sidebar.state.rows.some(({ level, message }) =>
      level === "error" && /extends beyond/i.test(message)));
    assert.equal(sidebar.state.overall.message, "Not ready to export");
    assert.equal(sidebar.state.export.ready, false);
    assert.ok(verifiedSTL(pipeline.result.stamp).size > 84);
  } finally {
    dispose(pipeline);
  }
});

test("failed oversized artwork stays editable and recovers after moving onto the face", async () => {
  const { model, pipeline, sidebar } = setup(
    [
      {
        id: "oversized-text",
        kind: "text",
        source: { text: "TOO BIG" },
        transform: { xMm: 40 },
      },
    ],
    () => ({ canonical: [rectangle(-4, -2, 4, 2)], issues: [] }),
  );
  pipeline.stamp.autoFaceSize = false;
  pipeline.stamp.faceShape = "round";
  pipeline.stamp.faceSize = 50;
  pipeline.stamp.margin = 3;

  try {
    await rejectedRun(pipeline);
    assert.equal(pipeline.result, null);
    assert.equal(sidebar.state.overall.message, "Build failed");
    assert.equal(pipeline.artworkPreview.renderElements[0].id, "oversized-text");
    assert.deepEqual(
      pipeline.artworkPreview.renderElements[0].canonical,
      [rectangle(-4, -2, 4, 2)],
    );

    model.updateElement("oversized-text", { transform: { xMm: 0 } });
    await pipeline.run();

    assert.equal(pipeline.error, null);
    assert.ok(pipeline.result.stamp);
    assert.equal(sidebar.state.export.ready, true);
  } finally {
    dispose(pipeline);
  }
});

test("a closed zero-volume shell blocks otherwise valid STL geometry", () => {
  const outer = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
  outer.deleteAttribute("uv");
  // A tetrahedron with four distinct coplanar vertices: its triangles are
  // non-degenerate and edge-closed, but the shell encloses zero volume.
  const flat = new THREE.BufferGeometry();
  flat.setAttribute("position", new THREE.Float32BufferAttribute([
    20, 0, 0, 22, 0, 0, 20, 2, 0, 22, 2, 0,
  ], 3));
  flat.setIndex([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
  const flatTriangles = flat.toNonIndexed();
  flatTriangles.computeVertexNormals();
  const combined = mergeGeometries([outer, flatTriangles]);
  try {
    assert.throws(() => prepareClosedStamp(combined), /no positive enclosed volume/i);
    assert.throws(() => verifiedSTL(combined), /no positive enclosed volume/i);
  } finally {
    [outer, flat, flatTriangles, combined].forEach((geometry) => geometry.dispose());
  }
});

test("real pipeline stamp failure and recovery render into the unified sidebar", async () => {
  // Minimal DOM adapter: exercise the production row/badge/summary renderer.
  const node = () => ({
    textContent: "",
    className: "",
    children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this[type] = listener; },
  });
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: node, getElementById: byId };
  const { pipeline } = setup([text()]);
  pipeline.stamp.autoFaceSize = true;
  createPipelineDiagnostics(pipeline);
  const textOf = (node) => [node.textContent, ...node.children.flatMap(textOf)];
  const messages = () => textOf(byId("pipeline-diagnostic-list"));
  try {
    pipeline.stamp.mode = "deboss";
    pipeline.stamp.reliefDepth = pipeline.stamp.faceThickness;
    await rejectedRun(pipeline);
    assert.equal(pipeline.result, null);
    assert.ok(pipeline.artworkPreview.artwork.length > 0);
    assert.ok(pipeline.artworkPreview.renderElements.length > 0);
    assert.equal(byId("pipeline-overall-status").textContent, "Build failed");
    assert.equal(byId("pipeline-export-status").textContent, "Unavailable");
    assert.ok(messages().some((message) => /Recess depth must be smaller/i.test(message)));
    assert.ok(messages().some((message) => /Stage: stamp generation/.test(message)));

    pipeline.setStamp({ mode: "emboss", reliefDepth: 2 });
    assert.equal(byId("pipeline-export-status").textContent, "Building");
    assert.equal(byId("pipeline-triangle-count").textContent, "—");
    assert.equal(messages().some((message) => /Recess depth/i.test(message)), false);
    await pipeline.run();
    assert.equal(byId("pipeline-overall-status").textContent,
      pipeline.result.issues.some(({ level }) => level === "warning")
        ? "Ready with warnings"
        : "Ready to export");
    assert.equal(byId("pipeline-export-status").textContent, "Ready");
    assert.equal(byId("pipeline-triangle-count").textContent, pipeline.result.info.triangles.toLocaleString());
    assert.match(byId("pipeline-total-x").textContent, /mm$/);
    assert.ok(messages().some((message) => /closed, consistently oriented edges/i.test(message)));
  } finally {
    dispose(pipeline);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
