import { createCanonicalSvgRenderer } from "./canonicalSvgRenderer.js";

// A separate, pointer-transparent view layer. The glyph outlines come from the
// printability check, which measures the design as it is drawn: the same
// readable coordinates the 2D view shows. "Mirror design" only flips the stamp
// that is built from them, so the outlines are drawn exactly where they are and
// never mirrored again.
export function createThinGlyphHighlight(svg) {
  const renderer = createCanonicalSvgRenderer(svg);
  return {
    show(glyphs, dimensions) {
      if (glyphs.length === 0) {
        renderer.clear();
        return;
      }
      renderer.render(glyphs.map((glyph) => ({
        id: `${glyph.elementId}:${glyph.line}:${glyph.column}`,
        kind: "thin-glyph-highlight",
        canonical: glyph.canonical,
      })), dimensions);
    },
    clear() {
      renderer.clear();
    },
  };
}
