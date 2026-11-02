// Cleans 2D outlines before extrusion and reports repairs.
// Finished 3D surface checks live separately in exportValidation.js.
import { union, intersection } from "polyclip-ts";
import {
  GEOMETRY_TOLERANCE_MM,
  isEmpty,
  ringArea,
  polygonArea,
  normalizeWinding,
  simplify,
} from "./canonical.js";
import { gapClosure, groupsCloserThan, hasThinCrossSection } from "../solidGeometry.js";
import { SETTINGS } from "../settings.js";
import { formatNumber } from "../locale.js";

// Slivers below this area in mm² carry no printable detail and only upset the
// boolean stage.
const MIN_RING_AREA = 1e-4;

// How far thinning an outline may move it, in millimetres: an eighth of a
// 0.4 mm nozzle, and below what the curve flattening upstream is accurate to.
const SIMPLIFY_MM = 0.05;
const POINT_CONTACT_CHAMFER_MM = GEOMETRY_TOLERANCE_MM / 4;

/**
 * Checks the artwork and repairs what can be repaired, returning the cleaned
 * canonical geometry alongside a list of `{ level, message }` where level is
 * 'ok', 'fixed' or 'error'. Thin-feature warnings run after final face fitting.
 *
 * An 'error' means nothing downstream can run; 'fixed' is reported so the user
 * can see what was silently changed on their behalf. Stroke, gap, and overflow
 * checks are separate: they use the finished 2D artwork and do not need a mesh.
 */
export function validate(artwork, { tolerance = SIMPLIFY_MM } = {}) {
  const issues = [];

  if (isEmpty(artwork)) {
    issues.push({
      level: "error",
      message:
        "Geen gesloten omtrekken gevonden. Lijnen en open paden kunnen niet worden omgezet in een stempel.",
    });
    return { artwork: [], issues };
  }

  // Thinning first: every later stage, the union below most of all, is paid
  // for by the point.
  const { cleaned, droppedRings } = dropDegenerate(
    simplify(artwork, tolerance),
  );

  if (droppedRings > 0) {
    issues.push({
      level: "fixed",
      message: `${droppedRings} ${droppedRings === 1 ? "lege of splinterdunne omtrek" : "lege of splinterdunne omtrekken"} verwijderd.`,
    });
  }

  if (cleaned.length === 0) {
    issues.push({
      level: "error",
      message: "Alle omtrekken waren te klein om te printen. Probeer een groter formaat.",
    });
    return { artwork: [], issues };
  }

  const repaired = repair(cleaned, issues);

  if (repaired === null) {
    return { artwork: [], issues };
  }

  if (repaired.length === 0) {
    issues.push({
      level: "error",
      message: "Na het repareren van het ontwerp bleef er niets over.",
    });
    return { artwork: [], issues };
  }

  const separated = separateIsolatedPointContacts(
    normalizeWinding(repaired),
    issues,
  );
  if (separated === null) {
    return { artwork: [], issues };
  }

  if (issues.length === 0) {
    issues.push({
      level: "ok",
      message: "Het ontwerp is schoon en klaar voor de 3D-opbouw.",
    });
  }

  return { artwork: separated, issues };
}

// Separate polygons that meet only at one convex outer-ring tip. Extruding
// that point would turn it into a vertical edge shared by four faces. A tiny
// local chamfer opens a sub-tolerance gap without moving any other boundary.
function separateIsolatedPointContacts(artwork, issues) {
  const occurrences = new Map();
  for (let polygonIndex = 0; polygonIndex < artwork.length; polygonIndex++) {
    const ring = artwork[polygonIndex][0];
    for (let vertexIndex = 0; vertexIndex < ring.length; vertexIndex++) {
      const point = ring[vertexIndex];
      const key = pointKey(point);
      const matches = occurrences.get(key) ?? [];
      matches.push({ polygonIndex, vertexIndex, point });
      occurrences.set(key, matches);
    }
  }

  const contacts = [...occurrences.values()].filter(
    (matches) => new Set(matches.map(({ polygonIndex }) => polygonIndex)).size > 1,
  );
  if (contacts.length === 0) return artwork;

  const contactCounts = new Map();
  for (const matches of contacts) {
    for (const { polygonIndex } of matches) {
      contactCounts.set(
        polygonIndex,
        (contactCounts.get(polygonIndex) ?? 0) + 1,
      );
    }
  }

  const replacements = new Map();
  for (const matches of contacts) {
    if (
      matches.length !== 2 ||
      matches[0].polygonIndex === matches[1].polygonIndex ||
      matches.some(({ polygonIndex }) => contactCounts.get(polygonIndex) !== 1)
    ) {
      return ambiguousPointContact(issues);
    }

    for (const { polygonIndex, vertexIndex } of matches) {
      const ring = artwork[polygonIndex][0];
      const previous = ring[(vertexIndex + ring.length - 1) % ring.length];
      const point = ring[vertexIndex];
      const next = ring[(vertexIndex + 1) % ring.length];
      const previousLength = distance(previous, point);
      const nextLength = distance(point, next);
      const turn = cross(previous, point, next) /
        (previousLength * nextLength);

      if (
        ring.length < 3 ||
        previousLength <= POINT_CONTACT_CHAMFER_MM * 2 ||
        nextLength <= POINT_CONTACT_CHAMFER_MM * 2 ||
        !(turn > 1e-6)
      ) {
        return ambiguousPointContact(issues);
      }

      replacements.set(`${polygonIndex}:${vertexIndex}`, [
        towards(point, previous, POINT_CONTACT_CHAMFER_MM),
        towards(point, next, POINT_CONTACT_CHAMFER_MM),
      ]);
    }
  }

  const separated = artwork.map((polygon, polygonIndex) => [
    polygon[0].flatMap((point, vertexIndex) =>
      replacements.get(`${polygonIndex}:${vertexIndex}`) ?? [point],
    ),
    ...polygon.slice(1),
  ]);
  issues.push({
    level: "fixed",
    message: `Losse puntcontacten gescheiden: ${contacts.length} (lokale afschuining van ${formatNumber(POINT_CONTACT_CHAMFER_MM, 4)} mm).`,
  });
  return separated;
}

function ambiguousPointContact(issues) {
  issues.push({
    level: "error",
    message:
      "Losse omtrekken raken elkaar in een onduidelijk puntcontact dat niet veilig te repareren is. Scheid of voeg die omtrekken samen en probeer het opnieuw.",
  });
  return null;
}

function pointKey([x, y]) {
  return `${x},${y}`;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function cross(previous, point, next) {
  return (
    (point[0] - previous[0]) * (next[1] - point[1]) -
    (point[1] - previous[1]) * (next[0] - point[0])
  );
}

function towards(from, to, distanceMm) {
  const length = distance(from, to);
  return [
    from[0] + ((to[0] - from[0]) * distanceMm) / length,
    from[1] + ((to[1] - from[1]) * distanceMm) / length,
  ];
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
      level: "error",
      message: `De geometrie van het ontwerp kon niet veilig worden gerepareerd (${error.message}). Vereenvoudig de SVG-paden en probeer het opnieuw.`,
    });
    return null;
  }

  const after = totalArea(result);

  // A changed area, or a changed number of pieces, means the union actually
  // had something to resolve rather than just copying the input.
  if (
    Math.abs(after - before) > Math.max(before, after) * 1e-6 ||
    result.length !== artwork.length
  ) {
    issues.push({
      level: "fixed",
      message:
        "Overlappende en zichzelf snijdende omtrekken zijn samengevoegd tot nette vormen.",
    });
  }

  return result;
}

function dropDegenerate(artwork) {
  let droppedRings = 0;
  const cleaned = [];

  for (const polygon of artwork) {
    const rings = polygon.filter((ring) => {
      const keep =
        ring.length >= 3 && Math.abs(ringArea(ring)) >= MIN_RING_AREA;
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

export function overflowIssue(layout) {
  if (!layout?.overflows) return null;
  return {
    level: "error",
    code: "artwork-overflow",
    message: `Een deel van het ontwerp valt buiten het stempelvlak van ${formatNumber(layout.widthMm, 1)} × ${formatNumber(layout.heightMm, 1)} mm (of in de marge). Het is rood weergegeven; verplaats of verklein het, of maak het vlak groter.`,
  };
}

// Stroke width and clear gaps are properties of the 2D artwork. Face shape,
// face size, and mirroring do not change them.
export function featureIssues(artwork, { textGlyphs = [] } = {}) {
  return [
    ...thinFeatureIssues(artwork, { textGlyphs }),
    ...narrowGapIssues(artwork, { textGlyphs }),
  ];
}

// Run after fitToFace(): a morphological opening removes regions narrower than
// the requested physical width, including local necks, arms and walls.
export function thinFeatureIssues(
  artwork,
  { minFeature = SETTINGS.checks.thinFeatureMm, textGlyphs = [] } = {},
) {
  const issues = [];
  const thin = artwork.filter((polygon) =>
    hasThinCrossSection(polygon, minFeature),
  );

  if (thin.length === 0) return issues;

  const letters = new Map();
  let unattributed = 0;
  for (const polygon of thin) {
    // Match actual filled geometry, never polygon ordering or text content.
    // Shared/merged glyphs and failed intersections remain generic warnings.
    let matches;
    try {
      matches = textGlyphs.filter((glyph) =>
        totalArea(intersection([polygon], glyph.canonical)) > MIN_RING_AREA);
    } catch {
      matches = [];
    }
    if (matches.length !== 1 || matches[0].character === null) {
      unattributed++;
      continue;
    }
    const glyph = matches[0];
    const group = letters.get(glyph.elementId) ?? new Map();
    group.set(`${glyph.line}:${glyph.column}`, glyph);
    letters.set(glyph.elementId, group);
  }
  if (unattributed > 0) issues.push({
    level: "warning",
    message: `${unattributed} ${unattributed === 1 ? "vorm lijkt" : "vormen lijken"} dunner dan ongeveer ${formatNumber(minFeature)} mm en ${unattributed === 1 ? "overleeft" : "overleven"} het printen mogelijk niet of ${unattributed === 1 ? "komt" : "komen"} niet goed uit in de klei. Dit is een schatting.`,
  });
  for (const [elementId, group] of letters) {
    const glyphs = [...group.values()].sort((a, b) => a.line - b.line || a.column - b.column);
    issues.push({
      level: "warning",
      elementId,
      elementKind: "text",
      thinGlyphs: glyphs,
      message: `Mogelijk te dunne letters: ${[...new Set(glyphs.map(({ character }) => character))].join(", ")} (onder ongeveer ${formatNumber(minFeature)} mm).`,
      details: glyphs.map(({ character, line, column }) =>
        `“${character}” — regel ${line}, teken ${column} in de opgemaakte tekst.`),
    });
  }
  return issues;
}

// Provisional clear gap (settings.checks.clearGapMm): three 0.4 mm nozzle
// lines. A clay test of slots and holes can replace this number. The stroke
// check (settings.checks.thinFeatureMm) stays separate.
export const MIN_CLEAR_GAP_MM = SETTINGS.checks.clearGapMm;

// Run after fitToFace(), beside the stroke check. Warns when a morphological
// close joins separate shapes or fills an enclosed hole. It does not move
// the artwork.
export function narrowGapIssues(artwork, { minGap = MIN_CLEAR_GAP_MM, textGlyphs = [] } = {}) {
  if (artwork.length === 0) return [];

  const closure = gapClosure(artwork, minGap);
  const linePairs = closeLinePairs(textGlyphs, minGap);
  const issues = linePairs.map(({ elementId, lineA, lineB }) => ({
    level: "warning",
    code: "narrow-gap",
    ...(elementId === undefined ? {} : { elementId, elementKind: "text" }),
    message: `De ruimte tussen regel ${lineA} en regel ${lineB} is kleiner dan ongeveer ${formatNumber(minGap)} mm.`,
  }));

  if (closure.filledHoles || (closure.merged && linePairs.length === 0)) {
    issues.push({
      level: "warning",
      code: "narrow-gap",
      message: `Een opening lijkt smaller dan ongeveer ${formatNumber(minGap)} mm en kan dichtlopen bij het stempelen in klei. Dit is een schatting.`,
    });
  }
  return issues;
}

function closeLinePairs(textGlyphs, minGap) {
  const elements = new Map();
  for (const glyph of textGlyphs) {
    if (glyph.line == null || !glyph.canonical?.length) continue;
    const key = glyph.elementId;
    const lines = elements.get(key) ?? new Map();
    const group = lines.get(glyph.line) ?? [];
    group.push(glyph);
    lines.set(glyph.line, group);
    elements.set(key, lines);
  }

  const pairs = [];
  for (const [elementId, lines] of elements) {
    const numbers = [...lines.keys()].sort((a, b) => a - b);
    for (let index = 0; index < numbers.length - 1; index++) {
      const lineA = numbers[index];
      const lineB = numbers[index + 1];
      const polygonsOf = (line) => lines.get(line).flatMap((glyph) => glyph.canonical);
      if (groupsCloserThan(polygonsOf(lineA), polygonsOf(lineB), minGap)) {
        pairs.push({ elementId, lineA, lineB });
      }
    }
  }
  return pairs;
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
