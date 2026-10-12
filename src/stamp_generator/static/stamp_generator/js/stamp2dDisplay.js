import { bounds, transform } from "./pipeline/canonical.js";

/**
 * Presents a mirrored manufacturing layout readably without changing the
 * authoritative geometry used by the 3D preview and exports.
 */
export function readableStampDisplay(layout, physicalElements = []) {
  const readabilityTransform = layout.artworkTransform.mirrorX
    ? { mirrorX: true }
    : {};
  const face = transform(layout.face, readabilityTransform);
  const faceBounds = bounds(face);

  return {
    artwork: transform(layout.artwork, readabilityTransform),
    face,
    elements: physicalElements.map((element) => ({
      ...element,
      canonical: transform(element.canonical, readabilityTransform),
    })),
    interactionTransform: {
      scale: layout.artworkTransform.scale,
      mirrorX: false,
      mirrorY: Boolean(layout.artworkTransform.mirrorY),
    },
    minX: faceBounds.minX,
    minY: faceBounds.minY,
    widthMm: faceBounds.width,
    heightMm: faceBounds.height,
  };
}
