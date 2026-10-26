import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createThinGlyphHighlight } from "../src/stamp_generator/static/stamp_generator/js/thinGlyphHighlight.js";
import { createPipelineDiagnostics } from "../src/stamp_generator/static/stamp_generator/js/pipelineDiagnostics.js";
import { canonicalPolygonPath, createCanonicalSvgRenderer } from "../src/stamp_generator/static/stamp_generator/js/canonicalSvgRenderer.js";
import { bounds, transform } from "../src/stamp_generator/static/stamp_generator/js/pipeline/canonical.js";
import { DesignModel } from "../src/stamp_generator/static/stamp_generator/js/designModel.js";
import { Pipeline } from "../src/stamp_generator/static/stamp_generator/js/pipeline/index.js";
import { layoutRenderElements } from "../src/stamp_generator/static/stamp_generator/js/pipeline/stampLayout.js";
import { readableStampDisplay } from "../src/stamp_generator/static/stamp_generator/js/stamp2dDisplay.js";
import { initializeSolids } from "../src/stamp_generator/static/stamp_generator/js/solidGeometry.js";

await initializeSolids();
const font = new File(
  [readFileSync(new URL("../src/stamp_generator/static/stamp_generator/fonts/NotoSans-Bold.ttf", import.meta.url))],
  "NotoSans-Bold.ttf",
);

class Node {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
}

function withDOM(action) {
  const previousDocument = globalThis.document;
  const previousSVG = globalThis.SVGElement;
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  globalThis.document = {
    createElement: () => new Node(),
    createElementNS: () => new Node(),
    getElementById: byId,
  };
  globalThis.SVGElement = Node;
  try { action(byId); } finally {
    globalThis.document = previousDocument;
    globalThis.SVGElement = previousSVG;
  }
}

const canonical = [[[[0, 0], [2, 0], [2, 3], [0, 3]]]];
const dimensions = { widthMm: 50, heightMm: 50, minX: -25, minY: -25 };

test("glyph highlight draws only warning glyphs where they are, without mirroring them, and clears independently", () => {
  withDOM(() => {
    const artworkSVG = new Node();
    const overlaySVG = new Node();
    createCanonicalSvgRenderer(artworkSVG).render([
      { id: "whole-text", kind: "text", canonical },
    ], dimensions);
    const originalArtwork = artworkSVG.children.slice();
    const originalGeometry = structuredClone(canonical);
    const highlighter = createThinGlyphHighlight(overlaySVG);

    const placed = transform(canonical, {
      xMm: 6, yMm: 4, scale: 1.5, rotationDeg: 20, mirrorX: true,
    });
    const glyphs = [
      { elementId: "text", line: 1, column: 2, canonical: placed },
      { elementId: "text", line: 2, column: 3, canonical: placed },
    ];
    const snapshot = structuredClone(glyphs);
    highlighter.show(glyphs, dimensions);
    assert.equal(overlaySVG.children.length, 3); // Empty face + two glyph groups.
    assert.equal(overlaySVG.children[1].dataset.elementId, "text:1:2");
    assert.equal(overlaySVG.children[2].dataset.elementId, "text:2:3");
    assert.equal(overlaySVG.children[1].children[0].attributes.d,
      canonicalPolygonPath(placed[0]));
    assert.equal(overlaySVG.attributes.viewBox, "-25 -25 50 50");
    assert.deepEqual(glyphs, snapshot);
    assert.deepEqual(artworkSVG.children, originalArtwork);
    highlighter.show([], dimensions);
    assert.equal(overlaySVG.children.length, 0);
    assert.deepEqual(canonical, originalGeometry);
  });
});

for (const mirror of [true, false]) {
  test(`thin letters are highlighted on the letters the 2D view shows, with Mirror design ${mirror ? "on" : "off"}`, async () => {
    const model = new DesignModel({ elements: [{
      id: "label",
      kind: "text",
      source: { text: "AB", font: { reference: font }, fontSizeMm: 4, thicknessMm: -0.3 },
      // Far from the stamp's centre line, so a mirrored highlight lands nowhere near its letter.
      transform: { xMm: 12, yMm: 1 },
    }] });
    const pipeline = new Pipeline({ designModel: model });
    pipeline.stamp.handle = "none";
    pipeline.stamp.mirror = mirror;
    pipeline.buildSolids = false; // Like the 2D editor: the stamp mesh is not built yet.
    try {
      await pipeline.run();
      const thin = pipeline.result.issues.find(({ thinGlyphs }) => thinGlyphs?.length > 0);
      assert.ok(thin, "the thin test text has attributed glyphs");

      const { layout, renderElements } = pipeline.result;
      const shown = readableStampDisplay(
        layout,
        layoutRenderElements(renderElements, layout.artworkTransform),
      ).elements[0];
      const text = bounds(shown.canonical);
      for (const glyph of thin.thinGlyphs) {
        // This is what main.js draws: the glyph outline itself, never mirrored.
        const drawn = bounds(glyph.canonical);
        const inside = drawn.minX >= text.minX - 1e-6 && drawn.maxX <= text.maxX + 1e-6 &&
          drawn.minY >= text.minY - 1e-6 && drawn.maxY <= text.maxY + 1e-6;
        assert.ok(inside, `highlight of "${glyph.character}" x ${drawn.minX}..${drawn.maxX} is outside the text ${text.minX}..${text.maxX}`);
      }
      const b = thin.thinGlyphs.find(({ character }) => character === "B");
      const a = thin.thinGlyphs.find(({ character }) => character === "A");
      assert.ok(a && b, "both letters are thin at this size");
      assert.ok(bounds(a.canonical).maxX < bounds(b.canonical).minX, "A is drawn left of B, as it reads");
    } finally {
      clearTimeout(pipeline.timer);
    }
  });
}

test("warning hover highlights attributed glyphs, leaves clear them, and rebuilds clear stale highlights", () => {
  withDOM((byId) => {
    const pipeline = new EventTarget();
    pipeline.diagnostics = null;
    const glyphs = [{ elementId: "text", character: "a", line: 1, column: 1, canonical }];
    pipeline.result = {
      stamp: {}, info: null, issues: [
        { level: "warning", elementId: "text", elementKind: "text", thinGlyphs: glyphs, message: "Thin a" },
        { level: "warning", elementKind: "svg", message: "Thin shape" },
      ],
    };
    const originalResult = pipeline.result;
    const highlighted = [];
    let runs = 0;
    pipeline.run = () => { runs++; };
    createPipelineDiagnostics(pipeline, {
      onHighlightThinGlyphs: (value) => highlighted.push(value),
    });
    pipeline.dispatchEvent(new Event("result"));
    const [textRow, svgRow] = byId("pipeline-diagnostic-list").children;
    textRow.listeners.mouseenter();
    assert.equal(highlighted.at(-1), glyphs);
    textRow.listeners.mouseleave();
    assert.deepEqual(highlighted.at(-1), []);
    assert.equal(textRow.tabIndex, 0);
    textRow.listeners.focusin();
    assert.equal(highlighted.at(-1), glyphs);
    textRow.listeners.mouseenter();
    textRow.listeners.mouseleave();
    assert.equal(highlighted.at(-1), glyphs);
    textRow.listeners.focusout({ relatedTarget: textRow.children[1] });
    assert.equal(highlighted.at(-1), glyphs);
    textRow.listeners.focusout({ relatedTarget: null });
    assert.deepEqual(highlighted.at(-1), []);
    assert.equal(svgRow.listeners.mouseenter, undefined);
    textRow.listeners.mouseenter();
    pipeline.dispatchEvent(new Event("running"));
    assert.deepEqual(highlighted.at(-1), []);
    assert.equal(pipeline.result, originalResult);
    assert.equal(runs, 0);
  });
});

test("highlight layer is pointer-transparent and has a visible scale-independent outline", () => {
  const css = readFileSync(new URL(
    "../src/stamp_generator/static/stamp_generator/css/style.css",
    import.meta.url,
  ), "utf8");
  assert.match(css, /\.thin-glyph-highlight\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.thin-glyph-highlight path\s*\{[^}]*stroke-width:\s*2px;[^}]*vector-effect:\s*non-scaling-stroke/);
});
