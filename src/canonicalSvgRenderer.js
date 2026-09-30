import { transform } from "./pipeline/canonical.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Builds the display description for canonical millimetre geometry. Canonical
 * Y-up coordinates become SVG Y-down coordinates only at this display edge.
 */
export function canonicalSvgScene(elements, { widthMm, heightMm }) {
  return {
    viewBox: canonicalViewBox(widthMm, heightMm),
    groups: elements.map((element) => {
      const artwork = transform(element.canonical, element.transform);
      return {
        id: element.id,
        kind: element.kind,
        paths: artwork.map((polygon) => ({
          d: canonicalPolygonPath(polygon),
          fillRule: "evenodd",
        })),
      };
    }),
  };
}

export function canonicalViewBox(widthMm, heightMm) {
  if (!(widthMm > 0) || !(heightMm > 0)) {
    throw new RangeError("Canonical SVG dimensions must be greater than zero.");
  }
  return [
    formatNumber(-widthMm / 2),
    formatNumber(-heightMm / 2),
    formatNumber(widthMm),
    formatNumber(heightMm),
  ].join(" ");
}

export function canonicalPolygonPath(polygon) {
  return polygon.map(canonicalRingPath).join(" ");
}

/** Mounts the pure scene description into the supplied SVG display layer. */
export function createCanonicalSvgRenderer(svg) {
  if (!(svg instanceof SVGElement)) {
    throw new TypeError("Canonical SVG renderer requires an SVG element.");
  }

  return {
    render(elements, dimensions) {
      const scene = canonicalSvgScene(elements, dimensions);
      svg.setAttribute("viewBox", scene.viewBox);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.replaceChildren(
        ...scene.groups.map((description) => groupNode(description)),
      );
    },

    setDimensions(dimensions) {
      svg.setAttribute(
        "viewBox",
        canonicalViewBox(dimensions.widthMm, dimensions.heightMm),
      );
    },

    clear() {
      svg.replaceChildren();
    },
  };
}

function groupNode({ id, kind, paths }) {
  const group = document.createElementNS(SVG_NAMESPACE, "g");
  group.dataset.elementId = id;
  group.dataset.elementKind = kind;

  group.replaceChildren(
    ...paths.map(({ d, fillRule }) => {
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill-rule", fillRule);
      path.setAttribute("clip-rule", fillRule);
      return path;
    }),
  );
  return group;
}

function canonicalRingPath(ring) {
  if (ring.length === 0) return "";
  const [first, ...rest] = ring;
  const commands = [`M ${pointText(first)}`];
  for (const point of rest) commands.push(`L ${pointText(point)}`);
  commands.push("Z");
  return commands.join(" ");
}

function pointText([x, y]) {
  return `${formatNumber(x)} ${formatNumber(-y)}`;
}

function formatNumber(value) {
  const settled = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
  return String(settled);
}
