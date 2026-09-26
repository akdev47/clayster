import * as THREE from "three";

/**
 * The canonical 2D form every input converges on before anything 3D happens.
 *
 * A MultiPolygon in millimetres, Y up:
 *
 *     [ polygon, ... ]      polygon = [ outerRing, hole, hole, ... ]
 *     ring = [ [x, y], ... ]     the closing point is implied, not stored
 *
 * This is exactly the shape polyclip-ts consumes and returns, so repairing the
 * artwork costs no conversion. Curves are flattened to polylines here, at the
 * boundary, which is what makes validation tractable and meshing trivial.
 */

// Divisions per curve when flattening. A resolution rather than a budget:
// `simplify` below drops whatever this produces that the artwork does not need
// at the size it ends up, so 8 is fine for a large letter and thinned back down
// for a small one.
const CURVE_SEGMENTS = 8;

// Both SVG and opentype hand us Y-down coordinates, and both arrive as
// THREE.Shape because ShapePath.toShapes() already works out which contours are
// holes. Flipping happens once, here, rather than in each source.
export function fromShapes(
  shapes,
  { flipY = true, curveSegments = CURVE_SEGMENTS } = {},
) {
  const polygons = [];

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(curveSegments);

    const polygon = [ringFrom(outline, flipY)];
    for (const hole of holes) {
      polygon.push(ringFrom(hole, flipY));
    }

    // A polygon whose outer ring collapsed carries no area at all.
    if (polygon[0].length >= 3) {
      polygons.push(polygon.filter((ring) => ring.length >= 3));
    }
  }

  return polygons;
}

function ringFrom(points, flipY) {
  const ring = [];

  for (const point of points) {
    const x = point.x;
    const y = flipY ? -point.y : point.y;

    // extractPoints often repeats the first point at the end, and curve
    // tessellation can emit the same point twice at a join.
    const last = ring[ring.length - 1];
    if (last !== undefined && near(last[0], x) && near(last[1], y)) continue;

    ring.push([x, y]);
  }

  while (
    ring.length >= 2 &&
    near(ring[0][0], ring[ring.length - 1][0]) &&
    near(ring[0][1], ring[ring.length - 1][1])
  ) {
    ring.pop();
  }

  return ring;
}

/**
 * Drops the points that carry no shape, to within `tolerance` millimetres.
 *
 * Flattening has no idea how big a glyph will end up, so a 6 mm letter comes
 * back with as many points as a 60 mm one and nearly all of them sit within a
 * hundredth of a millimetre of a straight line. Everything downstream is priced
 * by the point, the booleans most of all.
 *
 * The tolerance is in millimetres, so this only works once the artwork is at
 * size — an SVG reaches `fromShapes` in user units, which is why neither source
 * thins its own outlines.
 */
export function simplify(multiPolygon, tolerance) {
  if (!(tolerance > 0)) return multiPolygon;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) => simplifyRing(ring, tolerance)),
  );
}

// Douglas-Peucker, for a ring rather than a line. A closed ring has no ends to
// anchor the recursion to, so it is cut at its first point and at whichever
// point lies furthest from it — both certainly on the finished outline — and
// each half is thinned as an open chain. Anything this leaves self-intersecting
// is caught by the union in validate.js.
function simplifyRing(ring, tolerance) {
  if (ring.length <= 4) return ring;

  let far = 0;
  let furthest = -1;

  for (let i = 1; i < ring.length; i++) {
    const distance = squaredDistance(ring[0], ring[i]);
    if (distance > furthest) {
      furthest = distance;
      far = i;
    }
  }

  const head = thin(ring.slice(0, far + 1), tolerance);
  const tail = thin([...ring.slice(far), ring[0]], tolerance);

  // Each half ends where the other begins, so both closing points go.
  const simplified = [...head.slice(0, -1), ...tail.slice(0, -1)];

  return simplified.length >= 3 ? simplified : ring;
}

function thin(points, tolerance) {
  if (points.length < 3) return points;

  const start = points[0];
  const end = points[points.length - 1];

  let index = 0;
  let worst = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const distance = fromLine(points[i], start, end);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }

  if (worst <= tolerance) return [start, end];

  return [
    ...thin(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...thin(points.slice(index), tolerance),
  ];
}

// Perpendicular distance from a point to the line through a and b, falling
// back to plain distance when the two are the same point.
function fromLine([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);

  if (length < 1e-12) return Math.hypot(x - ax, y - ay);

  return Math.abs(dy * (x - ax) - dx * (y - ay)) / length;
}

function squaredDistance([ax, ay], [bx, by]) {
  return (bx - ax) ** 2 + (by - ay) ** 2;
}

// Convert our shared polygon arrays back to Three.js shapes for extrusion.
export function toShapes(multiPolygon) {
  return multiPolygon.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(
      outer.map(([x, y]) => new THREE.Vector2(x, y)),
    );

    for (const hole of holes) {
      shape.holes.push(
        new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))),
      );
    }

    return shape;
  });
}

export function isEmpty(multiPolygon) {
  return multiPolygon.length === 0;
}

export function bounds(multiPolygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const polygon of multiPolygon) {
    for (const [x, y] of polygon[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// Mirroring flips the ring direction, so every ring is reversed to keep outers
// and holes wound the way they were.
export function transform(
  multiPolygon,
  { scale = 1, offsetX = 0, offsetY = 0, mirrorX = false } = {},
) {
  const sx = mirrorX ? -scale : scale;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) => {
      const moved = ring.map(([x, y]) => [
        x * sx + offsetX,
        y * scale + offsetY,
      ]);
      return mirrorX ? moved.reverse() : moved;
    }),
  );
}

// Scales the artwork to sit inside a box of the given size and centres it on
// the origin, which is where the stamp face expects to find it.
export function fitInto(multiPolygon, width, height) {
  const box = bounds(multiPolygon);
  if (box.width === 0 || box.height === 0) return multiPolygon;

  const scale = Math.min(width / box.width, height / box.height);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [(x - centreX) * scale, (y - centreY) * scale]),
    ),
  );
}

// Triangulation expects outer rings and their holes wound in opposite
// directions. Sources and boolean libraries each have their own habits, so the
// winding is settled once, here, rather than trusted.
export function normalizeWinding(multiPolygon) {
  return multiPolygon.map((polygon) =>
    polygon.map((ring, index) => {
      const wantPositive = index === 0; // outer counter-clockwise, holes clockwise
      return ringArea(ring) > 0 === wantPositive ? ring : [...ring].reverse();
    }),
  );
}

// The sign gives the point order: positive is counter-clockwise, negative clockwise.
export function ringArea(ring) {
  let total = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }

  return total / 2;
}

export function ringPerimeter(ring) {
  let total = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  }

  return total;
}

// Net area of a polygon: its outer ring less whatever its holes take out.
export function polygonArea(polygon) {
  return polygon.reduce(
    (total, ring, index) =>
      index === 0 ? Math.abs(ringArea(ring)) : total - Math.abs(ringArea(ring)),
    0,
  );
}

function near(a, b) {
  return Math.abs(a - b) < 1e-9;
}
