import { bounds, transform } from "./pipeline/canonical.js";
import { SETTINGS } from "./settings.js";

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

/**
 * The element's own width and height in millimetres: its outline with scale,
 * stretch and mirroring applied but not turned, so "width" always runs along the
 * element's own X axis however it is rotated. Null when there is no outline.
 */
export function elementOwnSize(canonical, elementTransform) {
  if (!canonical?.length) return null;
  const { width, height } = bounds(transform(canonical, ownAxes(elementTransform)));
  return { width, height };
}

// Scale, stretch and mirroring only: the outline in the element's own frame.
function ownAxes({ scale = 1, stretchX = 1, mirrorX = false, mirrorY = false }) {
  return { scale, stretchX, mirrorX, mirrorY };
}

const clamp = (value, minimum, maximum) =>
  Math.min(Math.max(value, minimum), maximum);

/**
 * Makes one side of an element bigger or smaller and leaves the other as it is.
 *
 * `axis` is "width" or "height" (along the element's own axes) and `factor`
 * multiplies it. `anchor` says what stays where it was: "centre", or "start" /
 * "end" for the left / bottom edge or the right / top edge. The width is changed
 * by stretching only the X axis; the height by scaling the element and stretching
 * it back, so the width does not move along. The result stays inside the
 * stretch and scale limits of settings.js, so it can change by less than asked.
 *
 * `minFactor` / `maxFactor` narrow the factor further, and `scaleLimits: false`
 * lets the height ignore the element scale limits (text is limited by its
 * font size instead).
 */
export function stretchedTransform(
  canonical,
  startTransform,
  axis,
  factor,
  anchor = "centre",
  { minFactor = 0, maxFactor = Infinity, scaleLimits = true } = {},
) {
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  const start = { ...startTransform, stretchX: startTransform.stretchX ?? 1 };

  let next;
  if (axis === "width") {
    const stretchX = clamp(
      start.stretchX * clamp(factor, minFactor, maxFactor),
      MIN_STRETCH,
      MAX_STRETCH,
    );
    next = { ...start, stretchX };
  } else if (axis === "height") {
    const lowest = Math.max(
      minFactor,
      scaleLimits ? MIN_ELEMENT_SCALE / start.scale : 0,
      start.stretchX / MAX_STRETCH,
    );
    const highest = Math.min(
      maxFactor,
      scaleLimits ? MAX_ELEMENT_SCALE / start.scale : Infinity,
      start.stretchX / MIN_STRETCH,
    );
    const grow = Math.min(Math.max(factor, lowest), highest);
    next = {
      ...start,
      scale: start.scale * grow,
      stretchX: start.stretchX / grow,
    };
  } else {
    throw new TypeError(`Unknown element side: ${axis}.`);
  }
  return holdAnchor(canonical, start, next, axis, anchor);
}

// Moves `after` so that the chosen centre or edge of the element's own frame
// stays at the same place on the stamp as it was in `before`. The place is
// found with the shared transform itself, so rotation, mirroring and a pivot
// are all accounted for.
function holdAnchor(canonical, before, after, axis, anchor) {
  const own = bounds(transform(canonical, ownAxes(before)));
  const centreX = (own.minX + own.maxX) / 2;
  const centreY = (own.minY + own.maxY) / 2;
  const edge = (low, high, centre) =>
    anchor === "start" ? low : anchor === "end" ? high : centre;
  const local =
    axis === "width"
      ? { x: edge(own.minX, own.maxX, centreX), y: centreY }
      : { x: centreX, y: edge(own.minY, own.maxY, centreY) };

  // The outline point that sits there: undo the scale and mirroring.
  const source = [[[[
    local.x / ((before.mirrorX ? -1 : 1) * before.scale * before.stretchX),
    local.y / ((before.mirrorY ? -1 : 1) * before.scale),
  ]]]];
  const [wasX, wasY] = transform(source, before)[0][0][0];
  const [nowX, nowY] = transform(source, after)[0][0][0];
  return {
    ...after,
    xMm: after.xMm + wasX - nowX,
    yMm: after.yMm + wasY - nowY,
  };
}

// Realistic range for an element's scale, shared by the corner handles and the
// scale field so both allow the same sizes.
export const MIN_ELEMENT_SCALE = SETTINGS.elements.scale.min;
export const MAX_ELEMENT_SCALE = SETTINGS.elements.scale.max;
export const MIN_STRETCH = SETTINGS.elements.stretch.min;
export const MAX_STRETCH = SETTINGS.elements.stretch.max;
export const MIN_TEXT_SIZE_MM = SETTINGS.text.sizeMm.min;
export const MAX_TEXT_SIZE_MM = SETTINGS.text.sizeMm.max;
export const TEXT_SIZE_STEP_MM = SETTINGS.text.sizeMm.step;
export const KEYBOARD_MOVE_STEP_MM = SETTINGS.elements.keyboardMoveStepMm;
export const DUPLICATE_OFFSET_MM = SETTINGS.elements.duplicateOffsetMm;

export function textSizeFromScale(
  startSizeMm,
  scale,
  maximumMm = MAX_TEXT_SIZE_MM,
) {
  if (!(startSizeMm > 0) || !Number.isFinite(startSizeMm)) {
    throw new RangeError("Starting text size must be positive.");
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError("Text resize scale must be positive.");
  }
  const stepped = Math.round(
    (startSizeMm * scale) / TEXT_SIZE_STEP_MM,
  ) * TEXT_SIZE_STEP_MM;
  return Math.min(maximumMm, Math.max(MIN_TEXT_SIZE_MM, stepped));
}

/** Cheap view-only text resize used until the final font size is committed. */
export function textResizePreview(
  startSizeMm,
  startTransform,
  scale,
  maximumMm = MAX_TEXT_SIZE_MM,
) {
  const fontSizeMm = textSizeFromScale(startSizeMm, scale, maximumMm);
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
  const { halfWidth, halfHeight } = limitAxes(limit);
  const maximumScale =
    limit.shape === "round"
      ? Math.min(
          ...unitGeometry.flatMap((polygon) =>
            polygon.flatMap((ring) =>
              ring.map(([x, y]) => {
                const reach = Math.hypot(x / halfWidth, y / halfHeight);
                return reach === 0 ? Infinity : 1 / reach;
              }),
            ),
          ),
        )
      : Math.min(
          (halfWidth * 2) / unitBounds.width,
          (halfHeight * 2) / unitBounds.height,
        );
  const scale = Math.min(startTransform.scale, maximumScale);
  return centeredTransform(canonical, { ...startTransform, scale });
}

/**
 * The height (Y, in mm) at which to add a new text: in free space under the
 * artwork that is already there (`occupied`, its outlines), or else above it,
 * with `gapMm` between them, so the new text does not land on top of it.
 * `extent` is how far the new text reaches above (`top`) and below (`bottom`)
 * the point it is placed at, which for text is its baseline. `limit` is the
 * usable face (or null when the plate follows the artwork). With no room above
 * or below, it is the middle of the stamp.
 */
export function freeSpotForNewText({ occupied, limit, extent, gapMm }) {
  if (occupied.length === 0) return 0;

  const box = bounds(occupied);
  const reach = limit === null || limit === undefined ? Infinity : limitAxes(limit).halfHeight;
  const fits = (spot) => spot - extent.bottom >= -reach && spot + extent.top <= reach;
  const below = box.minY - gapMm - extent.top;
  if (fits(below)) return below;
  const above = box.maxY + gapMm + extent.bottom;
  if (fits(above)) return above;
  return 0;
}

/**
 * What the selected element is centred on, as an outline, or null when there is
 * nothing to centre on. A Round or Square plate has a fixed middle: the plate
 * itself. A Minimal plate only wraps the artwork, so it has no middle of its
 * own; the element is lined up with the rest of the design instead (`others` is
 * the outlines of every other visible element).
 */
export function centerTarget({ faceShape, face, others = [] }) {
  if (faceShape !== "minimal") return face?.length ? face : null;
  if (!others.some((polygon) => polygon.length > 0)) return null;
  const box = bounds(others);
  return [[[
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]]];
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

export function shouldHandleElementDeleteKey(event) {
  return (
    (event.key === "Backspace" || event.key === "Delete") &&
    !isEditingField(event.target) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

/** Scale a corner drag along its original direction from the selection centre. */
export function cornerDragScale(
  startPointer,
  centre,
  pointer,
  startScale,
  { minimum = 0.05, maximum = 20 } = {},
) {
  const startX = startPointer.x - centre.x;
  const startY = startPointer.y - centre.y;
  const lengthSquared = startX * startX + startY * startY;
  if (lengthSquared < 1) return startScale;

  const currentX = pointer.x - centre.x;
  const currentY = pointer.y - centre.y;
  const factor = (currentX * startX + currentY * startY) / lengthSquared;
  return Math.min(maximum, Math.max(minimum, startScale * factor));
}

const EPSILON = 1e-6;

export function fitsFace(canonical, elementTransform, limit) {
  return (
    limit === null ||
    limit === undefined ||
    insideLimit(canonical, elementTransform, limit)
  );
}

function limitAxes(limit) {
  const halfWidth = limit.halfWidth ?? limit.halfExtent;
  const halfHeight = limit.halfHeight ?? limit.halfExtent;
  return { halfWidth, halfHeight };
}

function insideLimit(canonical, elementTransform, limit) {
  const { halfWidth, halfHeight } = limitAxes(limit);
  for (const polygon of transform(canonical, elementTransform)) {
    for (const [x, y] of polygon[0]) {
      const outside =
        limit.shape === "round"
          ? (x / halfWidth) ** 2 + (y / halfHeight) ** 2 > 1 + EPSILON
          : Math.abs(x) > halfWidth + EPSILON ||
            Math.abs(y) > halfHeight + EPSILON;
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
 * (a circle, ellipse, square, or rectangle centred on the origin).
 * Returns the nearest allowed transform, or null when the element is simply
 * too large to fit; callers then leave it free (it is shown as overflowing).
 */
export function constrainToFace(canonical, elementTransform, limit) {
  if (limit === null || limit === undefined) return elementTransform;
  if (canonical.length === 0) return elementTransform;
  if (insideLimit(canonical, elementTransform, limit)) return elementTransform;

  const box = bounds(transform(canonical, elementTransform));
  const { halfWidth, halfHeight } = limitAxes(limit);

  if (limit.shape !== "round") {
    const moved = {
      ...elementTransform,
      xMm: elementTransform.xMm + axisShift(box.minX, box.maxX, halfWidth),
      yMm: elementTransform.yMm + axisShift(box.minY, box.maxY, halfHeight),
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

// The stretch that keeps a text exactly as wide when its font size changes by
// `grow`. The letter thickness is added around the letters and does not grow
// with the font, so it is taken off before working out how the width changes.
// `fallback` (the plain 1 / grow) is used when that cannot be worked out.
function keptWidthStretch(element, canonical, grow, fallback) {
  const { scale, stretchX } = element.transform;
  const own = elementOwnSize(canonical, element.transform);
  const thickness = element.source.thicknessMm;
  if (scale !== 1 || own === null || !(own.width / stretchX - thickness > 0)) {
    return fallback;
  }

  const unstretched = own.width / stretchX; // letters plus thickness
  const after = (unstretched - thickness) * grow + thickness;
  return clamp(stretchX * (unstretched / after), MIN_STRETCH, MAX_STRETCH);
}

/** UI-only selection/view state plus mutations of authoritative design intent. */
export class DesignEditorController {
  constructor(model, { selectedId = model.elements[0]?.id ?? null } = {}) {
    this.model = model;
    this.selectedId = selectedId;
    this.view = "2d";
    // Set by the app: { shape, halfWidth, halfHeight } of the usable face, or null.
    this.faceLimit = null;
    // Set by the app: id => canonical geometry of that element, or undefined.
    this.canonicalFor = () => undefined;
    // Geometry reports the size that was actually rendered. This remains a
    // separate hook so fitting uses the authoritative physical outline.
    this.renderedTextSizeFor = () => undefined;
    this.maxTextSizeMm = MAX_TEXT_SIZE_MM;
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

  /** Resizes one selected element around its visual centre. */
  resizeByFactor(id, factor) {
    const element = this.model.getElement(id);
    const canonical = this.canonicalFor(id);
    if (
      element === null ||
      canonical === undefined ||
      !Number.isFinite(factor) ||
      !(factor > 0)
    ) return null;

    this.select(id);
    if (element.kind !== "text") {
      return this.resize(
        id,
        canonical,
        element.transform,
        element.transform.scale * factor,
      );
    }

    const currentSizeMm = element.source.fontSizeMm * element.transform.scale;
    const fontSizeMm = Math.min(
      this.maxTextSizeMm,
      Math.max(MIN_TEXT_SIZE_MM, currentSizeMm * factor),
    );
    const previewTransform = centeredScaleTransform(
      canonical,
      element.transform,
      fontSizeMm / element.source.fontSizeMm,
    );
    return this.setTextSize(id, fontSizeMm, {
      xMm: previewTransform.xMm,
      yMm: previewTransform.yMm,
    });
  }

  /**
   * Changes one side of an element and leaves the other (see stretchedTransform).
   * The width is a stretch for every kind of element. The height scales a
   * picture, and changes a text's font size, with the stretch adjusted so the
   * width stays the same.
   */
  resizeAxis(id, axis, factor, anchor = "centre") {
    const element = this.model.getElement(id);
    const canonical = this.canonicalFor(id);
    if (element === null || !canonical?.length) return null;
    this.select(id);

    if (element.kind === "text" && axis === "height") {
      const currentSizeMm = element.source.fontSizeMm * element.transform.scale;
      const next = stretchedTransform(
        canonical,
        element.transform,
        axis,
        factor,
        anchor,
        {
          minFactor: MIN_TEXT_SIZE_MM / currentSizeMm,
          maxFactor: this.maxTextSizeMm / currentSizeMm,
          scaleLimits: false,
        },
      );
      if (next === null) return null;
      const grow = next.scale / element.transform.scale;
      return this.setTextSize(id, currentSizeMm * grow, {
        xMm: next.xMm,
        yMm: next.yMm,
        stretchX: keptWidthStretch(element, canonical, grow, next.stretchX),
      });
    }

    const next = stretchedTransform(
      canonical,
      element.transform,
      axis,
      factor,
      anchor,
    );
    return next === null ? null : this.model.updateElement(id, { transform: next });
  }

  setTextSize(id, fontSizeMm, transformPatch = {}) {
    const element = this.model.getElement(id);
    if (element === null || element.kind !== "text") return null;
    if (!Number.isFinite(fontSizeMm) || !(fontSizeMm > 0)) {
      throw new RangeError("Text size must be a finite positive number.");
    }
    // Typed point sizes must retain their exact physical conversion. Corner
    // gestures already quantize their transient preview before committing.
    const size = Math.min(
      this.maxTextSizeMm,
      Math.max(MIN_TEXT_SIZE_MM, fontSizeMm),
    );
    return this.model.updateElement(id, {
      source: { fontSizeMm: size },
      transform: { ...transformPatch, scale: 1 },
    });
  }

  /**
   * Moves the element to the middle of `stampFace`, in readable canonical
   * coordinates (mm). `axis` is "x" for left-right only, "y" for up-down only,
   * or "both"; the other direction keeps its place.
   */
  centerSelectedOnStamp(stampFace, axis = "both") {
    const element = this.selectedElement();
    const canonical = element === null ? undefined : this.canonicalFor(element.id);
    if (!element || !canonical?.length || !stampFace?.length) return null;

    const face = bounds(stampFace);
    const centered = centeredTransform(canonical, element.transform);
    const xMm =
      axis === "y"
        ? element.transform.xMm
        : centered.xMm + (face.minX + face.maxX) / 2;
    const yMm =
      axis === "x"
        ? element.transform.yMm
        : centered.yMm + (face.minY + face.maxY) / 2;
    if (
      Math.abs(xMm - element.transform.xMm) <= EPSILON &&
      Math.abs(yMm - element.transform.yMm) <= EPSILON
    ) return element;

    return this.model.updateElement(element.id, { transform: { xMm, yMm } });
  }

  /**
   * Puts every visible element on one vertical centre line, the middle of
   * `stampFace`, and leaves each one's height alone, so lines of text sit neatly
   * under each other. All elements are moved together, in one undo step, so the
   * result does not depend on the order they are in. Returns how many moved
   * (zero when they were already in line), or null when there was nothing to do.
   */
  centerAllOnStamp(stampFace) {
    if (!stampFace?.length) return null;
    const middle = bounds(stampFace);
    const centreX = (middle.minX + middle.maxX) / 2;

    let moved = 0;
    let usable = 0;
    const elements = this.model.elements.map((element) => {
      const canonical = this.canonicalFor(element.id);
      if (!element.visible || !canonical?.length) return element;
      usable += 1;

      const xMm = centeredTransform(canonical, element.transform).xMm + centreX;
      if (Math.abs(xMm - element.transform.xMm) <= EPSILON) return element;
      moved += 1;
      return { ...element, transform: { ...element.transform, xMm } };
    });
    if (usable === 0) return null;
    if (moved > 0) this.model.replaceElements(elements);
    return moved;
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

    const renderedFontSizeMm =
      this.renderedTextSizeFor(id) ?? element.source.fontSizeMm;
    let fontSizeMm = textSizeFromScale(
      renderedFontSizeMm,
      fitted.scale,
      this.maxTextSizeMm,
    );
    if (fontSizeMm / renderedFontSizeMm > fitted.scale + EPSILON) {
      fontSizeMm = Math.max(MIN_TEXT_SIZE_MM, fontSizeMm - TEXT_SIZE_STEP_MM);
    }
    const previewTransform = centeredTransform(canonical, {
      ...element.transform,
      scale: fontSizeMm / renderedFontSizeMm,
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

  duplicateSelected(offsetMm = DUPLICATE_OFFSET_MM) {
    const selected = this.selectedElement();
    if (selected === null) return null;
    if (!(offsetMm > 0) || !Number.isFinite(offsetMm)) {
      throw new RangeError("Duplicate offset must be positive.");
    }

    const { id: _originalId, ...editable } = selected;
    const duplicate = this.model.addElement({
      ...editable,
      transform: {
        ...selected.transform,
        xMm: selected.transform.xMm + offsetMm,
        yMm: selected.transform.yMm - offsetMm,
      },
    });
    this.select(duplicate.id);
    return duplicate;
  }

  updateSelectedText(sourcePatch) {
    const selected = this.selectedElement();
    if (selected === null || selected.kind !== "text") return null;
    return this.model.updateElement(selected.id, { source: sourcePatch });
  }
}
