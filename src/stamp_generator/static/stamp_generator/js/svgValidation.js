// Check the SVG before Three.js turns its filled outlines into shapes.
// Uploaded markup stays data: we never insert it into the page.
import { ShapeUtils } from "three";

export function validateSVGDocument(text) {
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  ) {
    throw svgError("Kies een geldig SVG-bestand.", "SVG parsing");
  }

  const unsupported = getUnsupportedSVGFeatures(document);
  if (unsupported.length > 0) {
    throw svgError(unsupported[0], "SVG parsing", unsupported.slice(1));
  }
}

export function getUnsupportedSVGFeatures(document) {
  const checks = [
    [
      "text",
      "Niet-ondersteund SVG-tekstelement. Zet tekst om naar paden voordat je uploadt.",
    ],
    ["image", "Ingesloten rasterafbeeldingen worden niet ondersteund in SVG-bestanden."],
    [
      "use",
      "Niet-ondersteund SVG-use-element. Zet gekoppelde of hergebruikte vormen om in gewone paden voordat je uploadt.",
    ],
    [
      "clipPath",
      "Niet-ondersteund SVG-uitknippad. Pas het uitknippen toe op de paden voordat je uploadt.",
    ],
    [
      "mask",
      "Niet-ondersteund SVG-masker. Pas het masker toe op de paden voordat je uploadt.",
    ],
    [
      "filter",
      "Niet-ondersteund SVG-filter of -effect. Verwijder effecten voordat je uploadt.",
    ],
    [
      "foreignObject",
      "Niet-ondersteund SVG-foreignObject-element. Zet het om naar gevulde paden voordat je uploadt.",
    ],
    ["script", "SVG-scripts worden niet ondersteund."],
  ];

  return checks
    .filter(([selector]) => document.querySelector(selector) !== null)
    .map(([, message]) => message);
}

// After SVGLoader parses the file, keep only outlines supported by our extrusion step.
export function getFilledSVGShapes(data) {
  const shapes = [];
  for (const path of data.paths) {
    const style = path.userData.style;
    const visibility = String(style.visibility ?? "")
      .trim()
      .toLowerCase();
    // Invisible paths should not become raised parts of the stamp.
    if (
      Number(style.opacity) === 0 ||
      visibility === "hidden" ||
      visibility === "collapse" ||
      hasDisplayNone(path.userData.node)
    ) {
      continue;
    }

    // A stroke has width on screen, but is not a filled outline to extrude.
    if (
      style.stroke &&
      style.stroke !== "none" &&
      Number(style.strokeOpacity) !== 0 &&
      Number(style.strokeWidth) !== 0
    ) {
      throw svgError(
        style.fill === "none" || Number(style.fillOpacity) === 0
          ? "Niet-ondersteund ontwerp met alleen lijnen. Zet lijnen om naar gevulde omtrekken voordat je uploadt."
          : "Niet-ondersteunde SVG-lijn. Zet lijnen om naar gevulde omtrekken voordat je uploadt.",
        "SVG shape conversion",
      );
    }
    if (style.fill === "none" || Number(style.fillOpacity) === 0) continue;

    // ShapePath.toShapes() silently skips zero-signed-area subpaths. A common
    // cause is a self-intersecting bow-tie, which must not vanish while other
    // valid artwork continues through the pipeline.
    for (const subPath of path.subPaths) {
      const points = subPath.getPoints();
      if (points.length >= 3 && ShapeUtils.area(points) === 0) {
        throw svgError(
          "De SVG bevat een zichzelf snijdende of oppervlakteloze gevulde omtrek. Repareer of vereenvoudig die omtrek voordat je uploadt.",
          "SVG shape conversion",
        );
      }
    }

    shapes.push(...path.toShapes());
  }

  if (shapes.length === 0) {
    throw svgError(
      "De SVG bevat geen bruikbare gevulde omtrekken.",
      "SVG shape conversion",
    );
  }
  return shapes;
}

// SVGLoader applies element transforms but not the root viewBox-to-viewport
// mapping. Return that final axis-aligned mapping for the canonical 2D step.
export function getSVGViewportTransform(root) {
  const viewBox = root.getAttribute("viewBox");
  if (viewBox === null) return identityViewport();

  const values = viewBox
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[2] <= 0 ||
    values[3] <= 0
  ) {
    throw svgError("De SVG heeft een ongeldige viewBox.", "SVG normalization");
  }

  const [minX, minY, viewWidth, viewHeight] = values;
  const width = svgLength(root.getAttribute("width")) ?? viewWidth;
  const height = svgLength(root.getAttribute("height")) ?? viewHeight;
  if (!(width > 0) || !(height > 0)) {
    throw svgError(
      "De viewport van de SVG moet een positieve breedte en hoogte hebben.",
      "SVG normalization",
    );
  }

  let scaleX = width / viewWidth;
  let scaleY = height / viewHeight;
  let translateX = -minX * scaleX;
  let translateY = -minY * scaleY;

  const aspect = parseAspectRatio(root.getAttribute("preserveAspectRatio"));
  if (aspect.align !== "none") {
    const scale =
      aspect.mode === "slice"
        ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY);
    const extraX = width - viewWidth * scale;
    const extraY = height - viewHeight * scale;
    scaleX = scaleY = scale;
    translateX = -minX * scale + extraX * alignment(aspect.align.slice(1, 4));
    translateY = -minY * scale + extraY * alignment(aspect.align.slice(5, 8));
  }

  return { scaleX, scaleY, translateX, translateY };
}

function hasDisplayNone(node) {
  for (let current = node; current != null; current = current.parentElement) {
    const attribute = current.getAttribute?.("display");
    const inline = current.style?.display;
    if (
      String(attribute ?? "")
        .trim()
        .toLowerCase() === "none" ||
      String(inline ?? "")
        .trim()
        .toLowerCase() === "none"
    ) {
      return true;
    }
  }
  return false;
}

function svgLength(value) {
  if (value === null || /%\s*$/.test(value)) return null;
  const match = String(value)
    .trim()
    .match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?$/i,
    );
  if (match === null) return null;

  const units = {
    px: 1,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
    pt: 96 / 72,
    pc: 16,
  };
  return Number(match[1]) * units[(match[2] ?? "px").toLowerCase()];
}

function parseAspectRatio(value) {
  const parts = String(value ?? "xMidYMid meet")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] === "defer") parts.shift();

  const align = parts[0] || "xMidYMid";
  const mode = parts[1] === "slice" ? "slice" : "meet";
  if (align !== "none" && !/^x(?:Min|Mid|Max)Y(?:Min|Mid|Max)$/.test(align)) {
    throw svgError(
      "De SVG heeft een ongeldige preserveAspectRatio-waarde.",
      "SVG normalization",
    );
  }
  return { align, mode };
}

function alignment(value) {
  return value === "Min" ? 0 : value === "Max" ? 1 : 0.5;
}

function identityViewport() {
  return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
}

function svgError(message, stage, details = []) {
  const error = new Error(message);
  error.svgStage = stage;
  error.svgDetails = details;
  return error;
}
