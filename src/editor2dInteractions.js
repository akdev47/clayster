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

// Realistic range for an element's scale, shared by the corner handles and the
// scale field so both allow the same sizes.
export const MIN_ELEMENT_SCALE = 0.2;
export const MAX_ELEMENT_SCALE = 4;
export const MIN_TEXT_SIZE_MM = 0.5;
export const MAX_TEXT_SIZE_MM = 60;
export const TEXT_SIZE_STEP_MM = 0.5;
export const KEYBOARD_MOVE_STEP_MM = 0.5;

export function textSizeFromScale(startSizeMm, scale) {
  if (!(startSizeMm > 0) || !Number.isFinite(startSizeMm)) {
    throw new RangeError("Starting text size must be positive.");
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError("Text resize scale must be positive.");
  }
  const stepped = Math.round(
    (startSizeMm * scale) / TEXT_SIZE_STEP_MM,
  ) * TEXT_SIZE_STEP_MM;
  return Math.min(MAX_TEXT_SIZE_MM, Math.max(MIN_TEXT_SIZE_MM, stepped));
}

/** Cheap view-only text resize used until the final font size is committed. */
export function textResizePreview(startSizeMm, startTransform, scale) {
  const fontSizeMm = textSizeFromScale(startSizeMm, scale);
  return {
    fontSizeMm,
    transform: {
      ...startTransform,
      scale: fontSizeMm / startSizeMm,
    },
  };
}

function centeredTransform(canonical, elementTransform) {
  const unpositioned = transform(canonical, {
    ...elementTransform,
    xMm: 0,
    yMm: 0,
  });
  const box = bounds(unpositioned);
  return {
    ...elementTransform,
    xMm: -(box.minX + box.maxX) / 2,
    yMm: -(box.minY + box.maxY) / 2,
  };
}

/** Uniformly shrinks and recentres one element inside the usable face. */
export function fitElementTransform(canonical, startTransform, limit) {
  if (limit === null || limit === undefined || canonical.length === 0) {
    return null;
  }

  const unitTransform = centeredTransform(canonical, {
    ...startTransform,
    scale: 1,
  });
  const unitGeometry = transform(canonical, unitTransform);
  const unitBounds = bounds(unitGeometry);
  const maximumScale =
    limit.shape === "round"
      ? limit.halfExtent /
        Math.max(
          ...unitGeometry.flatMap((polygon) =>
            polygon.flatMap((ring) =>
              ring.map(([x, y]) => Math.hypot(x, y)),
            ),
          ),
        )
      : Math.min(
          (limit.halfExtent * 2) / unitBounds.width,
          (limit.halfExtent * 2) / unitBounds.height,
        );
  const scale = Math.min(startTransform.scale, maximumScale);
  return centeredTransform(canonical, { ...startTransform, scale });
}

const ARROW_MOVEMENT = Object.freeze({
  ArrowLeft: Object.freeze({ xMm: -1, yMm: 0 }),
  ArrowRight: Object.freeze({ xMm: 1, yMm: 0 }),
  ArrowUp: Object.freeze({ xMm: 0, yMm: 1 }),
  ArrowDown: Object.freeze({ xMm: 0, yMm: -1 }),
});

export function arrowKeyDelta(key, stepMm = KEYBOARD_MOVE_STEP_MM) {
  const direction = ARROW_MOVEMENT[key];
  if (direction === undefined) return null;
  if (!(stepMm > 0) || !Number.isFinite(stepMm)) {
    throw new RangeError("Keyboard movement step must be positive.");
  }
  return {
    xMm: direction.xMm * stepMm,
    yMm: direction.yMm * stepMm,
  };
}

export function isEditingField(target) {
  return Boolean(
    target?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName),
  );
}

export function shouldHandleElementArrowKey(event) {
  return (
    event.target === event.currentTarget &&
    !isEditingField(event.target) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    arrowKeyDelta(event.key) !== null
  );
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

  moveFromArrowKey(id, key, stepMm = KEYBOARD_MOVE_STEP_MM) {
    const movement = arrowKeyDelta(key, stepMm);
    const element = this.model.getElement(id);
    if (movement === null || element === null) return null;

    this.select(id);
    const desired = {
      ...element.transform,
      xMm: element.transform.xMm + movement.xMm,
      yMm: element.transform.yMm + movement.yMm,
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
    const limited = Math.min(MAX_ELEMENT_SCALE, Math.max(MIN_ELEMENT_SCALE, scale));
    return this.model.updateElement(id, {
      transform: centeredScaleTransform(canonical, startTransform, limited),
    });
  }

  setTextSize(id, fontSizeMm, transformPatch = {}) {
    const element = this.model.getElement(id);
    if (element === null || element.kind !== "text") return null;
    const size = textSizeFromScale(fontSizeMm, 1);
    return this.model.updateElement(id, {
      source: { fontSizeMm: size },
      transform: { ...transformPatch, scale: 1 },
    });
  }

  fitToStamp(id) {
    const element = this.model.getElement(id);
    const canonical = this.canonicalFor(id);
    if (element === null || canonical === undefined) return null;

    const fitted = fitElementTransform(
      canonical,
      element.transform,
      this.faceLimit,
    );
    if (fitted === null) return null;
    this.select(id);

    if (element.kind !== "text") {
      return this.model.updateElement(id, { transform: fitted });
    }

    let fontSizeMm = textSizeFromScale(
      element.source.fontSizeMm,
      fitted.scale,
    );
    if (fontSizeMm / element.source.fontSizeMm > fitted.scale + EPSILON) {
      fontSizeMm = Math.max(MIN_TEXT_SIZE_MM, fontSizeMm - TEXT_SIZE_STEP_MM);
    }
    const previewTransform = centeredTransform(canonical, {
      ...element.transform,
      scale: fontSizeMm / element.source.fontSizeMm,
    });
    return this.setTextSize(id, fontSizeMm, {
      xMm: previewTransform.xMm,
      yMm: previewTransform.yMm,
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

  /** Keeps the selection valid after elements were swapped (undo / redo). */
  ensureSelection() {
    if (
      this.selectedId !== null &&
      this.model.getElement(this.selectedId) === null
    ) {
      this.selectedId = this.model.elements[0]?.id ?? null;
    }
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
