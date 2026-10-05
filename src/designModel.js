// Authoritative editable intent for a design. Canonical polygons, diagnostics,
// selection and other UI/runtime data deliberately do not live in this model.

export const ELEMENT_KINDS = Object.freeze(["text", "svg", "png"]);
export const ELEMENT_OPERATIONS = Object.freeze(["add"]);

export const DEFAULT_ELEMENT_TRANSFORM = Object.freeze({
  xMm: 0,
  yMm: 0,
  scale: 1,
  rotationDeg: 0,
  mirrorX: false,
  mirrorY: false,
  pivotX: 0,
  pivotY: 0,
});

const SOURCE_DEFAULTS = Object.freeze({
  text: Object.freeze({
    text: "",
    font: Object.freeze({
      // A built-in font id and/or uploaded font asset reference.
      id: null,
      reference: null,
    }),
    fontSizeMm: 16,
    letterSpacingMm: 0,
    lineSpacing: 1.25,
    alignment: "center",
    // Stroke thickness change on top of the font's own weight, in mm. The
    // outline is grown (+) or shrunk (-) by half of it on every side.
    thicknessMm: 0,
  }),
  svg: Object.freeze({
    // A File, URL, or durable asset reference. Object URLs are UI-only.
    reference: null,
    baseSizeMm: 30,
  }),
  png: Object.freeze({
    reference: null,
    baseSizeMm: 30,
    tracing: Object.freeze({ smoothing: 2 }),
  }),
});

let fallbackId = 0;

/** Creates the complete physical transform used by every artwork element. */
export function createElementTransform(transform = {}) {
  if (transform === null || typeof transform !== "object") {
    throw new TypeError("Element transform must be an object.");
  }

  const result = {
    ...DEFAULT_ELEMENT_TRANSFORM,
    ...transform,
    mirrorX: Boolean(transform.mirrorX ?? DEFAULT_ELEMENT_TRANSFORM.mirrorX),
    mirrorY: Boolean(transform.mirrorY ?? DEFAULT_ELEMENT_TRANSFORM.mirrorY),
  };

  for (const field of [
    "xMm",
    "yMm",
    "scale",
    "rotationDeg",
    "pivotX",
    "pivotY",
  ]) {
    if (!Number.isFinite(result[field])) {
      throw new TypeError(`Element transform ${field} must be a finite number.`);
    }
  }
  if (!(result.scale > 0)) {
    throw new RangeError("Element transform scale must be greater than zero.");
  }

  return Object.freeze(result);
}

/**
 * Creates one element intent. Files and other asset references are retained by
 * reference; generated canonical geometry is intentionally absent.
 */
export function createDesignElement({
  id = createElementId(),
  kind,
  visible = true,
  operation = "add",
  source = {},
  transform = {},
} = {}) {
  if (!ELEMENT_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported design element kind: ${String(kind)}.`);
  }
  if (!ELEMENT_OPERATIONS.includes(operation)) {
    throw new TypeError(`Unsupported design element operation: ${operation}.`);
  }
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("Design element id must be a non-empty string.");
  }

  const normalizedSource = createElementSource(kind, source);
  return Object.freeze({
    id,
    kind,
    visible: Boolean(visible),
    operation,
    source: normalizedSource,
    transform: createElementTransform(transform),
  });
}

/**
 * Shared element collection. It emits `change` after model mutations, but owns
 * no selection, hover, pointer, view-mode, camera, or other UI-only state.
 */
export class DesignModel extends EventTarget {
  #elements;

  constructor({ elements = [] } = {}) {
    super();
    this.#elements = normalizeElements(elements);
  }

  get elements() {
    return this.#elements;
  }

  getElement(id) {
    return this.#elements.find((element) => element.id === id) ?? null;
  }

  addElement(element) {
    const normalized = createDesignElement(element);
    if (this.getElement(normalized.id) !== null) {
      throw new Error(`Design element id already exists: ${normalized.id}.`);
    }
    this.#elements = Object.freeze([...this.#elements, normalized]);
    this.#changed();
    return normalized;
  }

  updateElement(id, patch = {}) {
    const index = this.#elements.findIndex((element) => element.id === id);
    if (index === -1) throw new Error(`Unknown design element id: ${id}.`);
    if (patch === null || typeof patch !== "object") {
      throw new TypeError("Design element patch must be an object.");
    }

    const current = this.#elements[index];
    if (patch.id !== undefined && patch.id !== current.id) {
      throw new Error("A design element id cannot be changed.");
    }
    if (patch.kind !== undefined && patch.kind !== current.kind) {
      throw new Error("A design element kind cannot be changed in place.");
    }

    const next = createDesignElement({
      ...current,
      ...patch,
      id: current.id,
      kind: current.kind,
      source: { ...current.source, ...patch.source },
      transform: { ...current.transform, ...patch.transform },
    });
    const elements = [...this.#elements];
    elements[index] = next;
    this.#elements = Object.freeze(elements);
    this.#changed();
    return next;
  }

  removeElement(id) {
    const index = this.#elements.findIndex((element) => element.id === id);
    if (index === -1) return null;

    const [removed] = this.#elements.slice(index, index + 1);
    this.#elements = Object.freeze([
      ...this.#elements.slice(0, index),
      ...this.#elements.slice(index + 1),
    ]);
    this.#changed();
    return removed;
  }

  #changed() {
    this.dispatchEvent(new Event("change"));
  }
}

function createElementSource(kind, source) {
  if (source === null || typeof source !== "object") {
    throw new TypeError("Design element source must be an object.");
  }

  const result = { ...SOURCE_DEFAULTS[kind], ...source };
  if (kind === "text") {
    if (
      source.font !== undefined &&
      (source.font === null || typeof source.font !== "object")
    ) {
      throw new TypeError("Text font must be an object.");
    }
    result.font = Object.freeze({
      ...SOURCE_DEFAULTS.text.font,
      ...source.font,
    });
  }
  if (kind === "png") {
    if (
      source.tracing !== undefined &&
      source.tracing !== null &&
      typeof source.tracing !== "object"
    ) {
      throw new TypeError("PNG tracing settings must be an object.");
    }
    result.tracing = Object.freeze({
      ...SOURCE_DEFAULTS.png.tracing,
      ...source.tracing,
    });
  }

  validateSourceNumbers(kind, result);
  return Object.freeze(result);
}

function validateSourceNumbers(kind, source) {
  const positive =
    kind === "text" ? ["fontSizeMm", "lineSpacing"] : ["baseSizeMm"];
  const finite =
    kind === "text"
      ? ["fontSizeMm", "letterSpacingMm", "lineSpacing", "thicknessMm"]
      : ["baseSizeMm"];

  for (const field of finite) {
    if (!Number.isFinite(source[field])) {
      throw new TypeError(`${kind} source ${field} must be a finite number.`);
    }
  }
  for (const field of positive) {
    if (!(source[field] > 0)) {
      throw new RangeError(`${kind} source ${field} must be greater than zero.`);
    }
  }

  if (kind === "png") {
    const smoothing = source.tracing.smoothing;
    if (!Number.isFinite(smoothing) || smoothing < 0) {
      throw new RangeError(
        "png source tracing smoothing must be a non-negative finite number.",
      );
    }
  }
}

function normalizeElements(elements) {
  if (!Array.isArray(elements)) {
    throw new TypeError("Design elements must be an array.");
  }

  const normalized = elements.map((element) => createDesignElement(element));
  const ids = new Set();
  for (const element of normalized) {
    if (ids.has(element.id)) {
      throw new Error(`Design element id already exists: ${element.id}.`);
    }
    ids.add(element.id);
  }
  return Object.freeze(normalized);
}

function createElementId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `element-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}
