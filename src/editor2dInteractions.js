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

const EPSILON = 1e-6;

export function fitsFace(canonical, elementTransform, limit) {
  return (
    limit === null ||
    limit === undefined ||
    insideLimit(canonical, elementTransform, limit)
  );
}

function insideLimit(canonical, elementTransform, { shape, halfExtent }) {
  for (const polygon of transform(canonical, elementTransform)) {
    for (const [x, y] of polygon[0]) {
      const outside =
        shape === "round"
          ? Math.hypot(x, y) > halfExtent + EPSILON
          : Math.abs(x) > halfExtent + EPSILON ||
            Math.abs(y) > halfExtent + EPSILON;
      if (outside) return false;
    }
  }
  return true;
}

// Shift needed on one axis to bring [min, max] inside [-half, half].
function axisShift(min, max, half) {
  if (max - min > half * 2) return -(min + max) / 2;
  if (min < -half) return -half - min;
  if (max > half) return half - max;
  return 0;
}

/**
 * Keeps an element's transformed outline inside the stamp's usable area
 * (a circle or square of half-size `halfExtent`, centred on the origin).
 * Returns the nearest allowed transform, or null when the element is simply
 * too large to fit; callers then leave it free (it is shown as overflowing).
 */
export function constrainToFace(canonical, elementTransform, limit) {
  if (limit === null || limit === undefined) return elementTransform;
  if (canonical.length === 0) return elementTransform;
  if (insideLimit(canonical, elementTransform, limit)) return elementTransform;

  const box = bounds(transform(canonical, elementTransform));

  if (limit.shape !== "round") {
    const moved = {
      ...elementTransform,
      xMm: elementTransform.xMm + axisShift(box.minX, box.maxX, limit.halfExtent),
      yMm: elementTransform.yMm + axisShift(box.minY, box.maxY, limit.halfExtent),
    };
    return insideLimit(canonical, moved, limit) ? moved : null;
  }

  const centred = {
    ...elementTransform,
    xMm: elementTransform.xMm - (box.minX + box.maxX) / 2,
    yMm: elementTransform.yMm - (box.minY + box.maxY) / 2,
  };
  if (!insideLimit(canonical, centred, limit)) return null;

  // Slide back toward the centre until the outline just touches the rim.
  const at = (amount) => ({
    ...elementTransform,
    xMm: elementTransform.xMm + (centred.xMm - elementTransform.xMm) * amount,
    yMm: elementTransform.yMm + (centred.yMm - elementTransform.yMm) * amount,
  });
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (insideLimit(canonical, at(middle), limit)) high = middle;
    else low = middle;
  }
  return at(high);
}

/** UI-only selection/view state plus mutations of authoritative design intent. */
export class DesignEditorController {
  constructor(model, { selectedId = model.elements[0]?.id ?? null } = {}) {
    this.model = model;
    this.selectedId = selectedId;
    this.view = "2d";
    // Set by the app: { shape, halfExtent } of the usable face, or null.
    this.faceLimit = null;
    // Set by the app: id => canonical geometry of that element, or undefined.
    this.canonicalFor = () => undefined;
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
    const desired = {
      ...startTransform,
      xMm: startTransform.xMm + movement.xMm,
      yMm: startTransform.yMm + movement.yMm,
    };
    const canonical = this.canonicalFor(id);
    const allowed =
      canonical === undefined
        ? desired
        : (constrainToFace(canonical, desired, this.faceLimit) ?? desired);
    return this.model.updateElement(id, {
      transform: { xMm: allowed.xMm, yMm: allowed.yMm },
    });
  }

  resize(id, canonical, startTransform, scale) {
    return this.model.updateElement(id, {
      transform: centeredScaleTransform(canonical, startTransform, scale),
    });
  }

  /** Pulls an element back inside the face after a typed-in transform. */
  constrainElement(id) {
    const canonical = this.canonicalFor(id);
    const element = this.model.getElement(id);
    if (canonical === undefined || element === null) return null;
    const allowed = constrainToFace(canonical, element.transform, this.faceLimit);
    if (allowed === null || allowed === element.transform) return element;
    return this.model.updateElement(id, {
      transform: { xMm: allowed.xMm, yMm: allowed.yMm },
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
