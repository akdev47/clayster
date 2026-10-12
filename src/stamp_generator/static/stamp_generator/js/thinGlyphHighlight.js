import { createCanonicalSvgRenderer } from "./canonicalSvgRenderer.js";

// A separate, pointer-transparent view layer. The diagnostic outlines are in
// final manufacturing coordinates; cancel its mirror just as the 2D view does.
export function createThinGlyphHighlight(svg) {
  const renderer = createCanonicalSvgRenderer(svg);
  return {
    show(glyphs, dimensions, manufacturingMirror = false) {
      if (glyphs.length === 0) {
        renderer.clear();
        return;
      }
      renderer.render(glyphs.map((glyph) => ({
        id: `${glyph.elementId}:${glyph.line}:${glyph.column}`,
        kind: "thin-glyph-highlight",
        canonical: glyph.canonical,
        transform: { mirrorX: manufacturingMirror },
      })), dimensions);
    },
    clear() {
      renderer.clear();
    },
  };
}
