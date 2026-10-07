import { transform } from "./canonical.js";
import { validate } from "./validate.js";

export const LEGACY_ELEMENT_ID = "legacy-source";

/** A source conversion failed before the design could be composed. */
export class ElementConversionError extends Error {
  constructor(element, cause) {
    const reason = conciseError(cause);
    super(
      `Element "${element.id}" (${element.kind}) could not be converted: ${reason}`,
    );
    this.name = "ElementConversionError";
    this.elementId = element.id;
    this.elementKind = element.kind;
    this.cause = cause;
    this.svgStage = cause?.svgStage;
    this.svgDetails = cause?.svgDetails;
  }
}

/**
 * Converts and caches local element geometry, then performs one authoritative
 * validation pass over the complete transformed design.
 */
export class ArtworkComposer {
  constructor(convertElement) {
    this.convertElement = convertElement;
    this.elementCache = new Map();
    this.referenceIds = new WeakMap();
    this.nextReferenceId = 0;
    this.compositionCache = { key: null, result: null };
  }

  async compose(elements) {
    const visible = elements.filter((element) => element.visible);
    const activeIds = new Set(elements.map((element) => element.id));
    for (const id of this.elementCache.keys()) {
      if (!activeIds.has(id)) this.elementCache.delete(id);
    }

    const keyed = visible.map((element) => ({
      element,
      sourceKey: this.#sourceKey(element),
    }));
    const compositionKey = stableValue(
      keyed.map(({ element, sourceKey }) => [
        element.id,
        element.operation,
        sourceKey,
        transformKey(element.transform),
      ]),
    );

    if (this.compositionCache.key === compositionKey) {
      return this.compositionCache.result;
    }

    const converted = await Promise.all(
      keyed.map(({ element, sourceKey }) =>
        this.#convertedElement(element, sourceKey),
      ),
    );
    const canonical = [];
    const renderElements = [];
    const elementIssues = [];
    const elementStats = [];
    const segmentations = [];
    let validationTolerance;

    for (let index = 0; index < keyed.length; index++) {
      const element = keyed[index].element;
      const conversion = converted[index];

      canonical.push(...transform(conversion.canonical, element.transform));
      renderElements.push({
        id: element.id,
        kind: element.kind,
        canonical: conversion.canonical,
        transform: element.transform,
      });
      elementIssues.push(
        ...conversion.issues.map((issue) => ({
          ...issue,
          scope: "element",
          elementId: element.id,
          elementKind: element.kind,
        })),
      );
      if (conversion.sourceStats !== null) {
        elementStats.push({
          ...conversion.sourceStats,
          elementId: element.id,
          elementKind: element.kind,
        });
      }
      if (conversion.segmentation !== null) {
        segmentations.push({
          elementId: element.id,
          elementKind: element.kind,
          ...conversion.segmentation,
        });
      }
      if (conversion.validationTolerance !== undefined) {
        validationTolerance =
          validationTolerance === undefined
            ? conversion.validationTolerance
            : Math.min(
                validationTolerance,
                conversion.validationTolerance,
              );
      }
    }

    const checked = validate(canonical, { tolerance: validationTolerance });
    const designIssues = checked.issues.map((issue) => ({
      ...issue,
      scope: "design",
    }));
    const result = {
      artwork: checked.artwork,
      issues: [...elementIssues, ...designIssues],
      sourceStats: null,
      elementStats,
      segmentations,
      renderElements,
    };

    this.compositionCache = { key: compositionKey, result };
    return result;
  }

  async #convertedElement(element, sourceKey) {
    const cached = this.elementCache.get(element.id);
    if (cached?.key === sourceKey) return cached.value;

    const reusable = [...this.elementCache.values()].find(
      (entry) => entry.key === sourceKey && entry.resolved,
    );
    if (reusable !== undefined) {
      const entry = { ...reusable };
      this.elementCache.set(element.id, entry);
      return entry.value;
    }

    const pending = Promise.resolve().then(() => this.convertElement(element));
    const entry = { key: sourceKey, value: pending, resolved: false };
    this.elementCache.set(element.id, entry);

    try {
      const converted = normalizeConversion(await pending);
      const sourceError = converted.issues.find(
        (issue) => issue.level === "error",
      );
      if (sourceError !== undefined) throw new Error(sourceError.message);
      if (converted.canonical.length === 0) {
        throw new Error("the element produced no closed outlines");
      }

      entry.value = converted;
      entry.resolved = true;
      return converted;
    } catch (error) {
      if (this.elementCache.get(element.id) === entry) {
        this.elementCache.delete(element.id);
      }
      throw error instanceof ElementConversionError
        ? error
        : new ElementConversionError(element, error);
    }
  }

  #sourceKey(element) {
    const source = element.source;

    if (element.kind === "text") {
      return stableValue([
        "text",
        source.text,
        source.font.id ?? "",
        this.#referenceKey(source.font.reference),
        source.fontSizeMm,
        source.letterSpacingMm,
        source.lineSpacing,
        source.alignment,
        source.thicknessMm,
      ]);
    }
    if (element.kind === "svg") {
      return stableValue([
        "svg",
        this.#referenceKey(source.reference),
        source.baseSizeMm,
      ]);
    }
    return stableValue([
      "png",
      this.#referenceKey(source.reference),
      source.baseSizeMm,
      stableValue(source.tracing),
    ]);
  }

  #referenceKey(reference) {
    if (reference === null || reference === undefined) return "none";
    if (typeof reference !== "object") return `${typeof reference}:${reference}`;

    if (!this.referenceIds.has(reference)) {
      this.nextReferenceId += 1;
      this.referenceIds.set(reference, this.nextReferenceId);
    }
    return `object:${this.referenceIds.get(reference)}`;
  }
}

/** Maps the current flat source contract to one temporary design element. */
export function elementFromLegacySource(source) {
  const common = {
    id: LEGACY_ELEMENT_ID,
    kind: source.kind,
    visible: true,
    operation: "add",
    transform: {
      xMm: 0,
      yMm: 0,
      scale: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
      pivotX: 0,
      pivotY: 0,
    },
  };

  if (source.kind === "svg") {
    return {
      ...common,
      source: {
        reference: source.svgFile,
        baseSizeMm: source.svgSize,
      },
    };
  }
  if (source.kind === "png") {
    return {
      ...common,
      source: {
        reference: source.pngFile,
        baseSizeMm: source.pngSize,
        tracing: {
          smoothing: source.pngSmoothing,
          backgroundMode: source.pngBackgroundMode ?? "auto",
          backgroundSamples: source.pngBackgroundSamples ?? [],
          backgroundTolerance: source.pngBackgroundTolerance ?? 1,
        },
      },
    };
  }
  return {
    ...common,
    source: {
      text: source.text,
      font: { id: source.fontId, reference: source.fontFile },
      fontSizeMm: source.size,
      letterSpacingMm: source.letterSpacing,
      lineSpacing: source.lineSpacing,
      alignment: source.align,
    },
  };
}

function normalizeConversion(conversion) {
  return {
    canonical: conversion.canonical ?? [],
    issues: conversion.issues ?? [],
    sourceStats: conversion.sourceStats ?? null,
    segmentation: conversion.segmentation ?? null,
    validationTolerance: conversion.validationTolerance,
  };
}

function transformKey(transform) {
  return [
    transform.xMm,
    transform.yMm,
    transform.scale,
    transform.rotationDeg,
    Number(transform.mirrorX),
    Number(transform.mirrorY),
    transform.pivotX,
    transform.pivotY,
  ].join(":");
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
    .join(",")}}`;
}

function conciseError(error) {
  return String(error?.message ?? error ?? "unknown error").split("\n", 1)[0];
}
