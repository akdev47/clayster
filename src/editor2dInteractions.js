import { bounds, transform } from "./pipeline/canonical.js";

/** Converts a screen-space drag into canonical millimetres (Y up). */
export function screenDeltaToMillimetres(
  { deltaX, deltaY },
  artboardRect,
  { widthMm, heightMm },
) {
  if (!(artboardRect.width > 0) || !(artboardRect.height > 0)) {
    throw new RangeError("The artboard must have a measurable size.");
  }
  return {
    xMm: (deltaX / artboardRect.width) * widthMm,
    yMm: -(deltaY / artboardRect.height) * heightMm,
  };
}

/** Maps transformed canonical bounds to the absolute overlay percentage box. */
export function canonicalOverlayBox(
  canonical,
  elementTransform,
  { widthMm, heightMm, minX = -widthMm / 2, minY = -heightMm / 2 },
) {
  const box = bounds(transform(canonical, elementTransform));
  return {
    leftPercent: ((box.minX - minX) / widthMm) * 100,
    topPercent: ((minY + heightMm - box.maxY) / heightMm) * 100,
    widthPercent: (box.width / widthMm) * 100,
    heightPercent: (box.height / heightMm) * 100,
  };
}

/** Uniformly scales while keeping the current canonical selection-box centre. */
export function centeredScaleTransform(canonical, startTransform, scale) {
  if (!(scale > 0)) throw new RangeError("Element scale must be positive.");

  const before = bounds(transform(canonical, startTransform));
  const candidate = { ...startTransform, scale };
  const after = bounds(transform(canonical, candidate));
  const beforeCentreX = (before.minX + before.maxX) / 2;
  const beforeCentreY = (before.minY + before.maxY) / 2;
  const afterCentreX = (after.minX + after.maxX) / 2;
  const afterCentreY = (after.minY + after.maxY) / 2;

  return {
    ...candidate,
    xMm: candidate.xMm + beforeCentreX - afterCentreX,
    yMm: candidate.yMm + beforeCentreY - afterCentreY,
  };
}

/** UI-only selection/view state plus mutations of authoritative design intent. */
export class DesignEditorController {
  constructor(model, { selectedId = model.elements[0]?.id ?? null } = {}) {
    this.model = model;
    this.selectedId = selectedId;
    this.view = "2d";
  }

  selectedElement() {
    return this.selectedId === null
      ? null
      : this.model.getElement(this.selectedId);
  }

  select(id) {
    if (id !== null && this.model.getElement(id) === null) {
      throw new Error(`Unknown design element id: ${id}.`);
    }
    this.selectedId = id;
  }

  setView(view) {
    if (view !== "2d" && view !== "3d") {
      throw new TypeError(`Unsupported editor view: ${view}.`);
    }
    this.view = view;
  }

  moveFromScreenDelta(
    id,
    startTransform,
    delta,
    artboardRect,
    dimensions,
    displayTransform = {},
  ) {
    const displayedMovement = screenDeltaToMillimetres(
      delta,
      artboardRect,
      dimensions,
    );
    const displayScale = displayTransform.scale ?? 1;
    const movement = {
      xMm:
        displayedMovement.xMm /
        (displayScale * (displayTransform.mirrorX ? -1 : 1)),
      yMm:
        displayedMovement.yMm /
        (displayScale * (displayTransform.mirrorY ? -1 : 1)),
    };
    return this.model.updateElement(id, {
      transform: {
        xMm: startTransform.xMm + movement.xMm,
        yMm: startTransform.yMm + movement.yMm,
      },
    });
  }

  resize(id, canonical, startTransform, scale) {
    return this.model.updateElement(id, {
      transform: centeredScaleTransform(canonical, startTransform, scale),
    });
  }

  deleteSelected() {
    const index = this.model.elements.findIndex(
      (element) => element.id === this.selectedId,
    );
    if (index === -1) return null;

    const removed = this.model.removeElement(this.selectedId);
    const nextIndex = Math.min(index, this.model.elements.length - 1);
    this.selectedId = this.model.elements[nextIndex]?.id ?? null;
    return removed;
  }

  updateSelectedText(sourcePatch) {
    const selected = this.selectedElement();
    if (selected === null || selected.kind !== "text") return null;
    return this.model.updateElement(selected.id, { source: sourcePatch });
  }
}
