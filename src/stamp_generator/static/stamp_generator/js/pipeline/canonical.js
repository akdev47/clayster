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

const CURVE_SEGMENTS = 8;
const MAX_CURVE_DEPTH = 14;

// Maximum intended deviation in finished millimetres. SVG sampling converts
// this to source units and the SVG pipeline uses it when thinning points.
export const GEOMETRY_TOLERANCE_MM = 0.02;

// Both SVG and opentype hand us Y-down coordinates, and both arrive as
// THREE.Shape because ShapePath.toShapes() already works out which contours are
// holes. Flipping happens once, here, rather than in each source.
export function fromShapes(
  shapes,
  { flipY = true, curveSegments = CURVE_SEGMENTS, curveTolerance = null } = {},
) {
  const polygons = [];

  for (const shape of shapes) {
    const sampled =
      curveTolerance > 0
        ? {
            shape: flattenPath(shape, curveTolerance),
            holes: shape.holes.map((hole) => flattenPath(hole, curveTolerance)),
          }
        : shape.extractPoints(curveSegments);

    const polygon = [ringFrom(sampled.shape, flipY)];
    for (const hole of sampled.holes) {
      polygon.push(ringFrom(hole, flipY));
    }

    // A polygon whose outer ring collapsed carries no area at all.
    if (polygon[0].length >= 3) {
      polygons.push(polygon.filter((ring) => ring.length >= 3));
    }
  }

  return polygons;
}

function flattenPath(path, tolerance) {
  const points = [];

  for (const curve of path.curves) {
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    if (points.length === 0) points.push(start);

    // Lines already describe their geometry exactly and must not gain points.
    if (curve.isLineCurve) {
      points.push(end);
    } else {
      flattenCurve(curve, 0, start, 1, end, tolerance, 0, points);
    }
  }

  return points;
}

function flattenCurve(
  curve,
  startT,
  start,
  endT,
  end,
  tolerance,
  depth,
  points,
) {
  const span = endT - startT;
  const quarter = curve.getPoint(startT + span * 0.25);
  const middleT = startT + span * 0.5;
  const middle = curve.getPoint(middleT);
  const threeQuarter = curve.getPoint(startT + span * 0.75);
  const error = Math.max(
    pointSegmentDistance(quarter, start, end),
    pointSegmentDistance(middle, start, end),
    pointSegmentDistance(threeQuarter, start, end),
  );

  if (error <= tolerance || depth >= MAX_CURVE_DEPTH) {
    points.push(end);
    return;
  }

  flattenCurve(
    curve,
    startT,
    start,
    middleT,
    middle,
    tolerance,
    depth + 1,
    points,
  );
  flattenCurve(curve, middleT, middle, endT, end, tolerance, depth + 1, points);
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return point.distanceTo(start);

  const projected = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + projected * dx),
    point.y - (start.y + projected * dy),
  );
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

// Remove numerical duplicates and edges far below printable resolution after
// coordinates have reached their final millimetre scale. Ring order and hole
// membership are left untouched for validation and repair.
export function removeShortEdges(multiPolygon, minLength = 0.001) {
  if (!(minLength > 0)) return multiPolygon;
  const minimumSquared = minLength * minLength;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) => {
      const cleaned = [];
      for (const point of ring) {
        const previous = cleaned[cleaned.length - 1];
        if (
          previous === undefined ||
          squaredDistance(previous, point) > minimumSquared
        ) {
          cleaned.push(point);
        }
      }

      while (
        cleaned.length > 1 &&
        squaredDistance(cleaned[0], cleaned[cleaned.length - 1]) <=
          minimumSquared
      ) {
        cleaned.pop();
      }
      return cleaned;
    }),
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

/**
 * Applies an element transform in physical space.
 *
 * Points are moved to the pivot, mirrored on their local axes, uniformly
 * scaled, widened or narrowed along the local X axis only by `stretchX` (1 = not
 * at all), rotated counter-clockwise, moved back from the pivot, and finally
 * translated. `offsetX`/`offsetY` remain as aliases for the existing stamp
 * callers; shared design elements use `xMm`/`yMm`.
 *
 * A reflection changes the transform determinant's sign. Reversing every ring
 * in that case preserves the established outer/hole winding convention.
 */
export function transform(multiPolygon, options = {}) {
  const {
    scale = 1,
    stretchX = 1,
    rotationDeg = 0,
    mirrorX = false,
    mirrorY = false,
    pivotX = 0,
    pivotY = 0,
    offsetX = 0,
    offsetY = 0,
  } = options;
  const translationX = options.xMm ?? offsetX;
  const translationY = options.yMm ?? offsetY;
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scaleX = (mirrorX ? -scale : scale) * stretchX;
  const scaleY = mirrorY ? -scale : scale;
  const reversesWinding = scaleX * scaleY < 0;

  return multiPolygon.map((polygon) =>
    polygon.map((ring) => {
      const moved = ring.map(([x, y]) => {
        const localX = (x - pivotX) * scaleX;
        const localY = (y - pivotY) * scaleY;

        return [
          localX * cosine - localY * sine + pivotX + translationX,
          localX * sine + localY * cosine + pivotY + translationY,
        ];
      });
      return reversesWinding ? moved.reverse() : moved;
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
