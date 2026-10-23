import { DEFAULT_STAMP } from "./pipeline/stamp.js";

function faceShapeLabel(faceShape) {
  if (faceShape === "outline") return "Artwork outline";
  if (faceShape === "square") return "Square";
  if (faceShape === "minimal") return "Minimal";
  return "Round";
}

function sourceName(reference) {
  if (typeof reference === "string") return reference.split("/").at(-1);
  return reference?.name ?? "Unnamed image";
}

/** The review page reports actual design intent, never wireframe examples. */
export function reviewSummary(designModel, stamp, dimensions) {
  const elements = designModel.elements.filter((element) => element.visible);
  const textCount = elements.filter((element) => element.kind === "text").length;
  const images = elements
    .filter((element) => element.kind === "svg" || element.kind === "png")
    .map((element) => sourceName(element.source.reference));

  return [
    ["Text elements", String(textCount)],
    ["Images / logos", images.length ? images.join(", ") : "None"],
    ["Stamp dimensions", dimensions],
    ["Face shape", faceShapeLabel(stamp.faceShape)],
    ["Rounded edges", (stamp.roundedEdges ?? DEFAULT_STAMP.roundedEdges) ? "Enabled" : "Disabled"],
    // A round plate has no corners to round.
    ...(faceShapeLabel(stamp.faceShape) === "Round"
      ? []
      : [["Rounded corners", stamp.roundedCorners ? "Enabled" : "Disabled"]]),
    ["Base thickness", `${stamp.faceThickness} mm`],
    ["Relief", `${stamp.mode === "emboss" ? "Raised" : "Recessed"} · ${stamp.reliefDepth} mm`],
    ["Mirror design", stamp.mirror ? "Enabled" : "Disabled"],
  ];
}
