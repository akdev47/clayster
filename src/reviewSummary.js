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
    ["Face shape", stamp.faceShape === "outline"
      ? "Artwork outline"
      : stamp.faceShape === "square" ? "Square" : "Round"],
    ["Base thickness", `${stamp.faceThickness} mm`],
    ["Relief", `${stamp.mode === "emboss" ? "Raised" : "Recessed"} · ${stamp.reliefDepth} mm`],
    ["Mirror design", stamp.mirror ? "Enabled" : "Disabled"],
  ];
}
