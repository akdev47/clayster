// Converts loaded SVG outlines to the same millimetre-based polygons as the text input.
import { loadSVGShapes } from '../loaders.js';
import { fromShapes, bounds } from './canonical.js';

// SVG user units mean nothing in millimetres — a drawing is commonly hundreds
// of units across — so an uploaded file is scaled to a stated artwork size the
// same way the text source is driven by its point size. Both sources then hand
// the rest of the pipeline artwork that is already the right size.
export async function loadSVGArtwork(source, { size = 30 } = {}) {
    const shapes = await loadSVGShapes(source);
    const artwork = fromShapes(shapes, { flipY: true });

    return scaleToSize(artwork, size);
}

// Set the longest side to the requested size without stretching the design.
export function scaleToSize(multiPolygon, size) {
    const box = bounds(multiPolygon);
    const largest = Math.max(box.width, box.height);

    if (largest === 0) return multiPolygon;

    const scale = size / largest;
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;

    return multiPolygon.map((polygon) => polygon.map((ring) =>
        ring.map(([x, y]) => [(x - centreX) * scale, (y - centreY) * scale])));
}
