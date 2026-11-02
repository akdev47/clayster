import { DEFAULT_STAMP } from "./pipeline/stamp.js";
import { formatNumber } from "./locale.js";

export function faceShapeLabel(faceShape) {
  if (faceShape === "outline") return "Omtrek van het ontwerp";
  if (faceShape === "square") return "Vierkant";
  if (faceShape === "minimal") return "Minimaal";
  return "Rond";
}

function sourceName(reference) {
  if (typeof reference === "string") return reference.split("/").at(-1);
  return reference?.name ?? "Afbeelding zonder naam";
}

/** The review page reports actual design intent, never wireframe examples. */
export function reviewSummary(designModel, stamp, dimensions) {
  const elements = designModel.elements.filter((element) => element.visible);
  const textCount = elements.filter((element) => element.kind === "text").length;
  const images = elements
    .filter((element) => element.kind === "svg" || element.kind === "png")
    .map((element) => sourceName(element.source.reference));

  return [
    ["Tekstelementen", String(textCount)],
    ["Afbeeldingen / logo's", images.length ? images.join(", ") : "Geen"],
    ["Afmetingen stempel", dimensions],
    ["Vorm", faceShapeLabel(stamp.faceShape)],
    ["Afgeronde randen", (stamp.roundedEdges ?? DEFAULT_STAMP.roundedEdges) ? "Aan" : "Uit"],
    // A round plate has no corners to round.
    ...(stamp.faceShape === "round"
      ? []
      : [["Afgeronde hoeken", stamp.roundedCorners ? "Aan" : "Uit"]]),
    ["Basisdikte", `${formatNumber(stamp.faceThickness)} mm`],
    ["Reliëf", `${stamp.mode === "emboss" ? "Verhoogd" : "Verdiept"} · ${formatNumber(stamp.reliefDepth)} mm`],
    ["Ontwerp gespiegeld", stamp.mirror ? "Aan" : "Uit"],
  ];
}
