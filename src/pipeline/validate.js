// Cleans 2D outlines before extrusion and reports repairs or estimated thin features.
// Finished 3D surface checks live separately in exportValidation.js.
import { union } from 'polyclip-ts';
import { isEmpty, ringArea, ringPerimeter, polygonArea, normalizeWinding, simplify } from './canonical.js';

// Slivers below this area in mm² carry no printable detail and only upset the
// boolean stage.
const MIN_RING_AREA = 1e-4;

// How far thinning an outline may move it, in millimetres: an eighth of a
// 0.4 mm nozzle, and below what the curve flattening upstream is accurate to.
const SIMPLIFY_MM = 0.05;

/**
 * Checks the artwork and repairs what can be repaired, returning the cleaned
 * canonical geometry alongside a list of `{ level, message }` where level is
 * 'fixed', 'warning' or 'error'.
 *
 * An 'error' means nothing downstream can run; 'fixed' is reported so the user
 * can see what was silently changed on their behalf.
 */
export function validate(artwork, { minFeature = 0.8, tolerance = SIMPLIFY_MM } = {}) {
    const issues = [];

    if (isEmpty(artwork)) {
        issues.push({
            level: 'error',
            message: 'No closed outlines found. Strokes and open paths cannot be extruded.'
        });
        return { artwork: [], issues };
    }

    // Thinning first: every later stage, the union below most of all, is paid
    // for by the point.
    const { cleaned, droppedRings } = dropDegenerate(simplify(artwork, tolerance));

    if (droppedRings > 0) {
        issues.push({
            level: 'fixed',
            message: `Removed ${droppedRings} empty or sliver outline${droppedRings === 1 ? '' : 's'}.`
        });
    }

    if (cleaned.length === 0) {
        issues.push({
            level: 'error',
            message: 'Every outline was too small to print. Try a larger size.'
        });
        return { artwork: [], issues };
    }

    const repaired = repair(cleaned, issues);

    if (repaired.length === 0) {
        issues.push({ level: 'error', message: 'Repairing the artwork left nothing behind.' });
        return { artwork: [], issues };
    }

    checkThinFeatures(repaired, minFeature, issues);

    if (issues.length === 0) {
        issues.push({ level: 'ok', message: 'Artwork is clean and ready to mesh.' });
    }

    return { artwork: normalizeWinding(repaired), issues };
}

// Unioning the artwork with itself is what resolves self-intersecting outlines,
// overlapping glyphs and contours wound the wrong way. It is one call, and it is
// the reason polyclip-ts is a dependency.
function repair(artwork, issues) {
    const before = totalArea(artwork);

    let result;
    try {
        result = union(artwork).map(stripClosingPoints);
    } catch (error) {
        issues.push({
            level: 'warning',
            message: `Could not fully repair the outlines (${error.message}). Meshing will use them as they are.`
        });
        return artwork;
    }

    const after = totalArea(result);

    // A changed area, or a changed number of pieces, means the union actually
    // had something to resolve rather than just copying the input.
    if (Math.abs(after - before) > Math.max(before, after) * 1e-6
        || result.length !== artwork.length) {
        issues.push({
            level: 'fixed',
            message: 'Merged overlapping and self-intersecting outlines into clean shapes.'
        });
    }

    return result;
}

function dropDegenerate(artwork) {
    let droppedRings = 0;
    const cleaned = [];

    for (const polygon of artwork) {
        const rings = polygon.filter((ring) => {
            const keep = ring.length >= 3 && Math.abs(ringArea(ring)) >= MIN_RING_AREA;
            if (!keep) droppedRings++;
            return keep;
        });

        // Losing the outer ring takes its holes with it; they bound nothing now.
        if (rings.length > 0 && rings[0] === polygon[0]) {
            cleaned.push(rings);
        } else if (rings.length > 0) {
            droppedRings += rings.length;
        }
    }

    return { cleaned, droppedRings };
}

// `2 × area / perimeter` is the average half-width of a shape, which for a long
// thin one is very close to its actual width. It is an estimate, not a
// measurement, and the message says so.
function checkThinFeatures(artwork, minFeature, issues) {
    const thin = artwork.filter((polygon) => {
        const perimeter = polygon.reduce((total, ring) => total + ringPerimeter(ring), 0);
        if (perimeter === 0) return false;
        return (2 * polygonArea(polygon)) / perimeter < minFeature / 2;
    });

    if (thin.length === 0) return;

    issues.push({
        level: 'warning',
        message: `${thin.length} shape${thin.length === 1 ? ' looks' : 's look'} thinner than about ${minFeature} mm and may not survive printing or show up in clay. This is an estimate.`
    });
}

// polyclip closes every ring by repeating its first point; the canonical form
// leaves that implied.
function stripClosingPoints(polygon) {
    return polygon.map((ring) => {
        const last = ring[ring.length - 1];
        const first = ring[0];

        return last !== undefined && first[0] === last[0] && first[1] === last[1]
            ? ring.slice(0, -1)
            : ring;
    });
}

function totalArea(artwork) {
    return artwork.reduce((total, polygon) => total + polygonArea(polygon), 0);
}
