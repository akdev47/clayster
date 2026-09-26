// Combines or cuts meshes for the clay preview; printable stamps use solidGeometry.js.
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

export const UNION = 'union';
export const SUBTRACT = 'subtract';
export const INTERSECT = 'intersect';

const OPERATIONS = {
    [UNION]: ADDITION,
    [SUBTRACT]: SUBTRACTION,
    [INTERSECT]: INTERSECTION
};

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false; // One material in, one material out.

/**
 * A real boolean between two geometries, not two shells sharing a file.
 *
 * Both are expected to already sit where they belong in the same space; the
 * evaluator works in world coordinates and the brushes are left untransformed.
 */
export function booleanGeometry(first, second, operation) {
    const type = OPERATIONS[operation];
    if (type === undefined) throw new Error(`Unknown operation "${operation}".`);

    const a = new Brush(prepare(first));
    const b = new Brush(prepare(second));

    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);

    const result = evaluator.evaluate(a, b, type);
    const geometry = result.geometry.clone();

    a.geometry.dispose();
    b.geometry.dispose();

    if (geometry.getAttribute('position').count === 0) {
        throw new Error('That operation leaves nothing behind — the shapes do not overlap.');
    }

    geometry.computeVertexNormals();

    return geometry;
}

// The evaluator needs both sides carrying the same attributes and no groups.
function prepare(geometry) {
    const prepared = geometry.clone();

    for (const name of Object.keys(prepared.attributes)) {
        if (name !== 'position' && name !== 'normal') prepared.deleteAttribute(name);
    }

    if (prepared.getAttribute('normal') === undefined) prepared.computeVertexNormals();
    prepared.clearGroups();

    return prepared;
}
