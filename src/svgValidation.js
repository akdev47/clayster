// Check the SVG before Three.js turns its filled outlines into shapes.
// Uploaded markup stays data: we never insert it into the page.
export function validateSVGDocument(text) {
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  ) {
    throw new Error("Please choose a valid SVG file.");
  }

  if (
    document.querySelector(
      "text, image, use, clipPath, mask, filter, script, foreignObject",
    )
  ) {
    throw new Error(
      "Use an SVG with filled outlines. Convert text to paths and remove images, linked shapes, masks, or effects.",
    );
  }
}

// After SVGLoader parses the file, keep only outlines supported by our extrusion step.
export function getFilledSVGShapes(data) {
  const shapes = [];
  for (const path of data.paths) {
    const style = path.userData.style;
    // Invisible paths should not become raised parts of the stamp.
    if (Number(style.opacity) === 0) continue;

    // A stroke has width on screen, but is not a filled outline to extrude.
    if (
      style.stroke &&
      style.stroke !== "none" &&
      Number(style.strokeOpacity) !== 0 &&
      Number(style.strokeWidth) !== 0
    ) {
      throw new Error(
        "Convert SVG strokes to filled outlines before uploading.",
      );
    }
    if (style.fill === "none" || Number(style.fillOpacity) === 0) continue;
    shapes.push(...path.toShapes());
  }

  if (shapes.length === 0) {
    throw new Error(
      "The SVG has no visible filled outlines to turn into a stamp.",
    );
  }
  return shapes;
}
