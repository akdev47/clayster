// Coordinates input → 2D artwork → validation → 3D stamp and mug preview.
// The UI listens for running/result/failed events rather than building geometry itself.
import { fitText, loadFont, layoutText } from "./text.js";
import {
  loadSVGArtworkDetails,
  SVG_SIMPLIFY_TOLERANCE_MM,
} from "./svg.js";
import { loadPNGArtworkDetails, DEFAULT_PNG_SMOOTHING } from "./png.js";
import {
  DEFAULT_PNG_BACKGROUND_MODE,
  DEFAULT_PNG_BACKGROUND_TOLERANCE,
} from "../pngTrace.js";
import { validate, featureIssues, overflowIssue } from "./validate.js";
import {
  assertFaceSize,
  assertFaceThickness,
  buildStamp,
  DEFAULT_STAMP,
} from "./stamp.js";
import { createStampLayout, stampFaceShape, stampMargin, stampSizeIssue } from "./stampLayout.js";
import { createSmallHandle } from "./handle.js";
import { SETTINGS } from "../settings.js";
import { BUILT_IN_FONTS, DEFAULT_FONT_ID } from "./fonts.js";
import { initializeSolids, offsetOutline } from "../solidGeometry.js";
import { prepareClosedStamp } from "../exportValidation.js";
import { DesignModel } from "../designModel.js";
import {
  ArtworkComposer,
  elementFromLegacySource,
  textLetterSpacingMm,
} from "./artworkComposition.js";

// Resolved through the import map in the browser and by Node itself in tests.
const wasmUrl = import.meta.resolve("manifold-3d/manifold.wasm");

const DEBOUNCE_MS = 300;

export const DEFAULT_SOURCE = {
  kind: "text", // 'text' | 'svg' | 'png'
  text: "CLAY",
  fontId: DEFAULT_FONT_ID,
  fontFile: null,
  size: SETTINGS.text.defaultSizeMm,
  letterSpacing: 0,
  lineSpacing: SETTINGS.text.lineSpacing.default,
  align: "center",
  svgFile: null,
  svgSize: SETTINGS.elements.pictureSizeMm.default,
  pngFile: null,
  pngSize: SETTINGS.elements.pictureSizeMm.default,
  pngSmoothing: DEFAULT_PNG_SMOOTHING,
  pngBackgroundMode: DEFAULT_PNG_BACKGROUND_MODE,
  pngBackgroundSamples: Object.freeze([]),
  pngBackgroundTolerance: DEFAULT_PNG_BACKGROUND_TOLERANCE,
};

/**
 * Runs the workflow:
 *
 *     text + font + layout ─┐
 *                           ├─→ canonical 2D → validate/repair → stamp → mesh
 *     SVG upload ───────────┤
 *     PNG upload → trace ───┘
 *
 * Edits are debounced, and the canonical artwork is reused when only stamp
 * parameters changed, so dragging a slider does not re-parse a font.
 */
export class Pipeline extends EventTarget {
  constructor({ designModel = null } = {}) {
    super();

    this.source = { ...DEFAULT_SOURCE };
    this.stamp = { ...DEFAULT_STAMP };

    this.result = null;
    // The latest successfully converted artwork remains useful to the 2D
    // editor even when a later stamp-generation or mesh-validation step fails.
    this.artworkPreview = null;
    this.cache = {
      key: null,
      artwork: null,
      issues: [],
      sourceStats: null,
      segmentations: [],
    };
    // Stroke and gap results depend on the artwork, not on the face. One entry
    // per artwork identity so a later face change or 3D build can reuse them.
    this.printabilityCache = new Map();
    this.printabilityComputations = 0;
    this.designModel = null;
    this.artworkComposer = new ArtworkComposer((element) =>
      this.buildElementArtwork(element),
    );
    this.onDesignChange = () => this.schedule();
    this.diagnostics = null;
    this.handle = null;

    this.timer = null;
    this.token = 0;
    // The editor turns this off while the 2D view is open. Tests and a direct
    // run() still build the stamp. Review and export force one build.
    this.buildSolids = true;
    this.forceSolids = false;

    if (designModel !== null) this.attachDesignModel(designModel);
  }

  setSource(patch) {
    Object.assign(this.source, patch);
    this.schedule();
  }

  setDesignModel(designModel) {
    this.attachDesignModel(designModel);
    this.schedule();
  }

  setStamp(patch) {
    if (patch.faceSize !== undefined) {
      assertFaceSize(patch.faceSize);
    }
    if (patch.faceHeight !== undefined && patch.faceHeight !== null) {
      assertFaceSize(patch.faceHeight);
    }
    if (patch.faceThickness !== undefined) {
      assertFaceThickness(patch.faceThickness);
    }
    if (Object.hasOwn(patch, "faceShape")) {
      patch = { ...patch, faceShape: stampFaceShape(patch.faceShape) };
    }
    if (
      Object.hasOwn(patch, "faceSize") ||
      Object.hasOwn(patch, "faceHeight") ||
      Object.hasOwn(patch, "margin")
    ) {
      patch = {
        ...patch,
        margin: stampMargin({ ...this.stamp, ...patch }),
      };
    }
    Object.assign(this.stamp, patch);
    this.schedule();
  }

  schedule() {
    // Wait for a pause in typing, and invalidate any older work immediately.
    clearTimeout(this.timer);
    ++this.token;
    this.busy = true;
    this.resetDiagnostics();
    this.dispatchEvent(new Event("running"));
    this.timer = setTimeout(() => this.run(), DEBOUNCE_MS);
  }

  async run() {
    clearTimeout(this.timer);

    // Only the newest run is allowed to publish; an earlier one that was
    // still awaiting a font would otherwise overwrite it.
    const token = ++this.token;
    this.busy = true;
    this.artworkPreview = null;
    this.resetDiagnostics();
    this.dispatchEvent(new Event("running"));
    try {
      const {
        artwork,
        issues: initialIssues,
        sourceStats,
        elementStats = null,
        renderElements = null,
        segmentations = [],
        textGlyphs = [],
        key: artworkKey,
      } = await this.artwork();
      if (token !== this.token) return;

      this.artworkPreview = {
        artwork,
        issues: initialIssues,
        sourceStats,
        elementStats,
        renderElements,
      };

      let issues = initialIssues;
      this.recordValidation(sourceStats, elementStats, issues);

      if (artwork.length === 0) {
        const validationFailed = issues.some(
          ({ level }) => level === "error",
        );
        if (this.designModel?.elements.length === 0) this.diagnostics = null;
        this.publish(
          {
            artwork,
            issues,
            renderElements: validationFailed ? null : renderElements,
            segmentations,
            stamp: null,
            clay: null,
            info: null,
            notes: [],
          },
          token,
        );
        return;
      }

      // 2D editing publishes the face immediately. Overflow is known from that
      // layout. Stroke and gap checks follow, and a 3D build reuses them.
      if (!this.forceSolids && !this.buildSolids) {
        const layout = createStampLayout(artwork, this.stamp, []);
        const deferred = {
          artwork,
          renderElements,
          segmentations,
          stamp: null,
          clay: null,
          info: null,
          layout,
          notes: [],
          solidsDeferred: true,
        };
        const known = this.readyPrintability(artworkKey);
        issues = this.applyPrintability(initialIssues, known ?? [], layout);
        this.recordValidation(sourceStats, elementStats, issues);
        this.noteDeferredPreview(issues);
        this.publish({ ...deferred, issues }, token);
        if (known !== null) return;

        const measured = await this.printabilityFor(artworkKey, artwork, textGlyphs);
        if (token !== this.token) return;
        issues = this.applyPrintability(initialIssues, measured, layout);
        this.recordValidation(sourceStats, elementStats, issues);
        this.noteDeferredPreview(issues);
        this.publish({ ...deferred, issues }, token);
        return;
      }

      this.setSVGStage("stamp preparation");
      const printability = this.printabilityFor(artworkKey, artwork, textGlyphs);
      const handle = await this.handleGeometry();
      if (token !== this.token) return;

      await initializeSolids(wasmUrl);
      if (token !== this.token) return;
      const measured = await printability;
      if (token !== this.token) return;
      this.setSVGStage("stamp generation");
      const {
        stamp,
        clay,
        info,
        layout,
        notes,
      } = buildStamp(artwork, this.stamp, handle, {
        textGlyphs,
        checkPrintability: false,
      });
      issues = this.applyPrintability(initialIssues, measured, layout);
      this.recordValidation(sourceStats, elementStats, issues);
      if (this.diagnostics !== null) {
        this.diagnostics.geometryProduced = Boolean(
          stamp?.getAttribute("position")?.count,
        );
      }
      try {
        // Check the stamp before publishing it; STL export checks the file again.
        this.setSVGStage("final mesh validation");
        prepareClosedStamp(stamp).dispose();
        notes.push(
          "Stamp surface checks passed: closed, consistently oriented edges. Review in your slicer before printing.",
        );
      } catch (error) {
        stamp.dispose();
        clay.dispose();
        throw error;
      }
      this.completeSVGDiagnostics();
      this.publish(
        { artwork, issues, renderElements, segmentations, stamp, clay, info, layout, notes },
        token,
      );
    } catch (error) {
      if (token !== this.token) return;

      console.error(error);
      this.failSVGDiagnostics(error);
      this.result = null;
      this.busy = false;
      this.error = error;
      this.dispatchEvent(new Event("failed"));
    }
  }

  // Builds the stamp when the last result is only a 2D layout. Leaves
  // buildSolids as the view set it, so a later 2D edit stays cheap.
  async ensureSolids() {
    if (this.result?.stamp && !this.busy) return true;
    this.forceSolids = true;
    try {
      if (this.busy) {
        await this.waitForIdle();
        if (this.result?.stamp && this.error === null) return true;
      }
      await this.run();
      return Boolean(this.result?.stamp) && this.error === null;
    } finally {
      this.forceSolids = false;
    }
  }

  waitForIdle() {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.removeEventListener("result", done);
        this.removeEventListener("failed", done);
        resolve();
      };
      this.addEventListener("result", done);
      this.addEventListener("failed", done);
      if (!this.busy) done();
    });
  }

  publish(result, token) {
    if (token !== this.token) return;

    this.result = result;
    this.busy = false;
    this.error = null;
    this.dispatchEvent(new Event("result"));
  }

  // Stored stroke and gap warnings for this artwork, or null when they have
  // not been measured yet. An empty list is a finished measurement.
  readyPrintability(key) {
    return this.printabilityCache.get(key)?.issues ?? null;
  }

  // Measures stroke width and clear gaps once per artwork identity. Face
  // changes and a later mesh build await the same result instead of repeating it.
  async printabilityFor(key, artwork, textGlyphs) {
    const cached = this.printabilityCache.get(key);
    if (cached?.issues != null) return cached.issues;
    if (cached?.pending) return cached.pending;

    const pending = (async () => {
      await initializeSolids(wasmUrl);
      this.printabilityComputations += 1;
      return featureIssues(artwork, { textGlyphs });
    })();
    this.printabilityCache.set(key, { issues: null, pending });

    try {
      const issues = await pending;
      this.printabilityCache.set(key, { issues, pending: null });
      return issues;
    } catch (error) {
      if (this.printabilityCache.get(key)?.pending === pending) {
        this.printabilityCache.delete(key);
      }
      throw error;
    }
  }

  applyPrintability(issues, featureWarnings, layout) {
    const overflow = overflowIssue(layout);
    const tooLarge = stampSizeIssue(layout.widthMm, layout.heightMm);
    const extra = this.scopePrintability([
      ...featureWarnings,
      ...(overflow ? [overflow] : []),
      ...(tooLarge ? [tooLarge] : []),
    ]);
    if (extra.length === 0) return issues;
    return [
      ...issues.filter(({ level }) => level !== "ok"),
      ...extra,
    ];
  }

  scopePrintability(issues) {
    if (this.designModel === null) return issues;
    return issues.map((issue) => ({
      ...issue,
      scope: issue.elementId ? "element" : "design",
    }));
  }

  noteDeferredPreview(issues) {
    if (this.diagnostics === null) return;
    if (issues.some(({ level }) => level === "error")) return;

    this.diagnostics.level = "ok";
    this.diagnostics.message =
      this.designModel === null
        ? "SVG processed successfully."
        : "Design processed successfully.";
    this.diagnostics.stage = "artwork";
    this.diagnostics.details.push(
      "The 3D stamp is built when you open 3D, review, or export.",
    );
  }

  // Source → canonical → validated, skipping the work when the inputs that
  // feed it have not changed.
  async artwork() {
    if (this.designModel !== null) {
      return this.artworkComposer.compose(this.designModel.elements);
    }

    const key = this.sourceKey();

    if (this.cache.key === key) {
      return {
        key: this.cache.key,
        artwork: this.cache.artwork,
        issues: this.cache.issues,
        sourceStats: this.cache.sourceStats,
        segmentations: this.cache.segmentations,
      };
    }

    const {
      canonical,
      issues,
      sourceStats = null,
      segmentation = null,
      validationTolerance,
    } = await this.buildArtwork();
    const checked = validate(canonical, { tolerance: validationTolerance });

    // What the wrap did to the text comes first: it explains the artwork
    // the check is reporting on.
    const combined = [...issues, ...checked.issues];

    this.cache = {
      key,
      artwork: checked.artwork,
      issues: combined,
      sourceStats,
      segmentations:
        segmentation === null
          ? []
          : [
              {
                elementId: "legacy-source",
                elementKind: this.source.kind,
                ...segmentation,
              },
            ],
    };

    return {
      key: this.cache.key,
      artwork: checked.artwork,
      issues: combined,
      sourceStats,
      segmentations: this.cache.segmentations,
    };
  }

  async buildArtwork() {
    return this.buildElementArtwork(elementFromLegacySource(this.source));
  }

  async buildElementArtwork(element) {
    const source = element.source;

    if (element.kind === "svg") {
      if (source.reference === null) return { canonical: [], issues: [] };

      const loaded = await loadSVGArtworkDetails(source.reference, {
        size: source.baseSizeMm,
      });
      return {
        canonical: loaded.artwork,
        issues: [],
        sourceStats: {
          shapeCount: loaded.shapeCount,
          polygonCount: loaded.polygonCount,
        },
        validationTolerance: SVG_SIMPLIFY_TOLERANCE_MM,
      };
    }

    if (element.kind === "png") {
      if (source.reference === null) return { canonical: [], issues: [] };

      const loaded = await loadPNGArtworkDetails(source.reference, {
        size: source.baseSizeMm,
        smoothing: source.tracing.smoothing,
        backgroundMode: source.tracing.backgroundMode,
        backgroundSamples: source.tracing.backgroundSamples,
        backgroundTolerance: source.tracing.backgroundTolerance,
      });
      return {
        canonical: loaded.artwork,
        issues: loaded.issues,
        segmentation: loaded.segmentation,
      };
    }

    if (source.text.trim() === "") return { canonical: [], issues: [] };

    const letterSpacingMm = textLetterSpacingMm(source);

    const font = await loadFont(
      source.font.reference ?? fontURL(source.font.id ?? DEFAULT_FONT_ID),
    );

    // Preserve both the requested size and the user's explicit line breaks.
    // Stamp overflow is reported later instead of silently resizing text.
    const fitted = fitText(font, {
      text: source.text,
      size: source.fontSizeMm,
      letterSpacing: letterSpacingMm,
    });

    const glyphOutlines = [];
    let canonical = layoutText(font, {
      text: fitted.text,
      size: fitted.size,
      letterSpacing: letterSpacingMm,
      lineSpacing: source.lineSpacing,
      align: source.alignment,
      glyphOutlines,
    });

    if (source.thicknessMm) {
      await initializeSolids(wasmUrl);
      canonical = offsetOutline(canonical, source.thicknessMm / 2);
      for (const glyph of glyphOutlines) {
        glyph.canonical = offsetOutline(glyph.canonical, source.thicknessMm / 2);
      }
    }

    return {
      canonical,
      issues: fitted.issues,
      textGlyphs: glyphOutlines,
      renderedFontSizeMm: fitted.size,
    };
  }

  async handleGeometry() {
    if (this.stamp.handle === "none") return null;

    // One shared copy at full size; buildStamp shrinks its own copy to fit.
    this.handle ??= createSmallHandle();
    return this.handle;
  }

  sourceKey() {
    // Only artwork inputs belong here; backing/handle edits can reuse the same outlines.
    const source = this.source;

    if (source.kind === "svg") {
      const file = source.svgFile;
      if (file === null) return "svg:none";

      // The sample is a URL string; an upload is a File.
      const id =
        typeof file === "string"
          ? file
          : `${file.name}:${file.size}:${file.lastModified}`;

      return `svg:${id}:${source.svgSize}`;
    }

    if (source.kind === "png") {
      const file = source.pngFile;
      if (file === null) return "png:none";
      return `png:${file.name}:${file.size}:${file.lastModified}:${source.pngSize}:${source.pngSmoothing}:${source.pngBackgroundMode}:${JSON.stringify(source.pngBackgroundSamples)}:${source.pngBackgroundTolerance}`;
    }

    return [
      "text",
      source.text,
      source.fontId,
      source.fontFile === null
        ? ""
        : `${source.fontFile.name}:${source.fontFile.size}`,
      source.size,
      source.letterSpacing,
      source.lineSpacing,
      source.align,
    ].join("|");
  }

  resetDiagnostics() {
    if (this.designModel !== null) {
      this.diagnostics = {
        level: "working",
        message: "Processing design elements…",
        details: [],
        stage: "element conversion",
        geometryProduced: false,
        rejected: false,
      };
      return;
    }

    this.diagnostics =
      this.source.kind === "svg" && this.source.svgFile !== null
        ? {
            level: "working",
            message: "Processing SVG…",
            details: [],
            stage: "SVG loading",
            geometryProduced: false,
            rejected: false,
          }
        : null;
  }

  setSVGStage(stage) {
    if (this.diagnostics !== null) this.diagnostics.stage = stage;
  }

  recordValidation(sourceStats, elementStats, issues) {
    if (this.designModel === null) {
      this.recordSVGValidation(sourceStats, issues);
      return;
    }
    this.recordDesignValidation(elementStats ?? [], issues);
  }

  recordDesignValidation(elementStats, issues) {
    if (this.diagnostics === null) return;

    const errors = issues.filter(({ level }) => level === "error");
    const warnings = issues.filter(({ level }) => level === "warning");
    const information = issues.filter(({ level }) => level === "info");
    this.diagnostics.stage = "geometry validation";
    this.diagnostics.details = [
      ...elementStats.map(
        ({ elementId, elementKind, shapeCount, polygonCount }) =>
          `Element "${elementId}" (${elementKind}): ${shapeCount} ${plural(
            shapeCount,
            "shape",
          )} produced · ${polygonCount} canonical ${plural(
            polygonCount,
            "polygon",
          )}.`,
      ),
      ...warnings.map(({ message, elementId }) =>
        elementId === undefined
          ? `Warning: ${message}`
          : `Element "${elementId}": ${message}`,
      ),
      ...information.map(({ message, elementId }) =>
        elementId === undefined
          ? `Note: ${message}`
          : `Element "${elementId}": ${message}`,
      ),
    ];

    if (errors.length > 0) {
      this.diagnostics.level = "error";
      this.diagnostics.message = errors[0].message;
      this.diagnostics.details.push(
        ...errors.slice(1).map(({ message }) => message),
        "Rejected before preview/export.",
      );
      this.diagnostics.rejected = true;
    }
  }

  recordSVGValidation(sourceStats, issues) {
    if (this.diagnostics === null || sourceStats === null) return;

    this.diagnostics.shapeCount = sourceStats.shapeCount;
    this.diagnostics.polygonCount = sourceStats.polygonCount;
    this.diagnostics.stage = "geometry validation";

    const errors = issues.filter(({ level }) => level === "error");
    const warnings = issues.filter(({ level }) => level === "warning");
    this.diagnostics.details = [
      `${sourceStats.shapeCount} ${plural(sourceStats.shapeCount, "shape")} produced · ${sourceStats.polygonCount} canonical ${plural(sourceStats.polygonCount, "polygon")}.`,
      ...warnings.map(({ message }) => `Warning: ${message}`),
    ];

    if (sourceStats.shapeCount === 0) {
      this.diagnostics.level = "error";
      this.diagnostics.message = "SVG contains no usable filled outlines.";
      this.diagnostics.details.push("Stage: SVG shape conversion");
      this.diagnostics.details.push("Rejected before preview/export.");
      this.diagnostics.rejected = true;
    } else if (errors.length > 0) {
      this.diagnostics.level = "error";
      this.diagnostics.message = errors[0].message;
      this.diagnostics.details.push(
        ...errors.slice(1).map(({ message }) => message),
        "Stage: geometry validation",
      );
      this.diagnostics.details.push("Rejected before preview/export.");
      this.diagnostics.rejected = true;
    }
  }

  completeSVGDiagnostics() {
    if (this.diagnostics === null) return;

    this.diagnostics.level = "ok";
    this.diagnostics.message =
      this.designModel === null
        ? "SVG processed successfully."
        : "Design processed successfully.";
    this.diagnostics.details.push(
      "Stamp geometry produced and accepted for preview/export.",
    );
    this.diagnostics.stage = "complete";
  }

  failSVGDiagnostics(error) {
    if (this.diagnostics === null) return;

    const stage = this.diagnostics.stage;
    const labels = {
      "element conversion": "Artwork conversion failed",
      "SVG loading": "SVG loading failed",
      "stamp preparation": "Stamp preparation failed",
      "stamp generation": "Geometry generation failed",
      "final mesh validation": "Stamp mesh validation failed",
    };

    const diagnosedStage = error?.svgStage ?? stage;
    const additional = Array.isArray(error?.svgDetails) ? error.svgDetails : [];
    this.diagnostics.level = "error";
    this.diagnostics.message = error?.svgStage
      ? conciseError(error)
      : `${
          labels[stage] ??
          (this.designModel === null
            ? "SVG processing failed"
            : "Design processing failed")
        }: ${conciseError(error)}`;
    this.diagnostics.details.push(
      ...additional,
      `Stage: ${diagnosedStage}`,
      "Rejected before preview/export.",
    );
    this.diagnostics.rejected = true;
  }

  attachDesignModel(designModel) {
    if (designModel !== null && !(designModel instanceof DesignModel)) {
      throw new TypeError("Pipeline designModel must be a DesignModel or null.");
    }
    if (this.designModel === designModel) return;

    this.designModel?.removeEventListener("change", this.onDesignChange);
    this.designModel = designModel;
    this.designModel?.addEventListener("change", this.onDesignChange);
  }
}

function fontURL(id) {
  const font =
    BUILT_IN_FONTS.find((candidate) => candidate.id === id) ??
    BUILT_IN_FONTS[0];
  return font.url;
}

function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}

function conciseError(error) {
  const message = String(error?.message ?? "Unknown error").split("\n", 1)[0];
  return message.length > 180 ? `${message.slice(0, 177)}…` : message;
}
