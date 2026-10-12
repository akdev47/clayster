// Coordinates input → 2D artwork → validation → 3D stamp and mug preview.
// The UI listens for running/result/failed events rather than building geometry itself.
import { loadFont, layoutText, wrapText } from "./text.js";
import {
  loadSVGArtworkDetails,
  SVG_SIMPLIFY_TOLERANCE_MM,
} from "./svg.js";
import { loadPNGArtworkDetails, DEFAULT_PNG_SMOOTHING } from "./png.js";
import {
  DEFAULT_PNG_BACKGROUND_MODE,
  DEFAULT_PNG_BACKGROUND_TOLERANCE,
} from "../pngTrace.js";
import { validate } from "./validate.js";
import { buildStamp, DEFAULT_STAMP } from "./stamp.js";
import { BUILT_IN_FONTS, DEFAULT_FONT_ID } from "./fonts.js";
import { loadSTLGeometry } from "../loaders.js";
import { initializeSolids, offsetOutline } from "../solidGeometry.js";
import { prepareClosedStamp } from "../exportValidation.js";
import { DesignModel } from "../designModel.js";
import {
  ArtworkComposer,
  elementFromLegacySource,
  textLetterSpacingMm,
} from "./artworkComposition.js";
import wasmUrl from "manifold-3d/manifold.wasm?url";

const SAMPLE_HANDLE = "./models/StampHandle.stl";
const DEBOUNCE_MS = 300;

export const DEFAULT_SOURCE = {
  kind: "text", // 'text' | 'svg' | 'png'
  text: "CLAY",
  fontId: DEFAULT_FONT_ID,
  fontFile: null,
  size: 16,
  letterSpacing: 0,
  lineSpacing: 1.25,
  align: "center",
  svgFile: null,
  svgSize: 30,
  pngFile: null,
  pngSize: 30,
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
    this.designModel = null;
    this.artworkComposer = new ArtworkComposer((element) =>
      this.buildElementArtwork(element),
    );
    this.onDesignChange = () => this.schedule();
    this.diagnostics = null;
    this.handles = new Map();

    this.timer = null;
    this.token = 0;

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
    Object.assign(this.stamp, patch);
    this.schedule();
  }

  /**
   * The one number a resize gesture should drive — whatever currently decides
   * how big the stamp comes out.
   *
   * With the face sized to the artwork, that is the artwork's own size and
   * the face follows it. With a fixed face, it is the face itself.
   */
  get sizeDriver() {
    if (!this.stamp.autoFaceSize) {
      return { field: "faceSize", value: this.stamp.faceSize };
    }

    if (this.source.kind === "svg") {
      return { field: "svgSize", value: this.source.svgSize };
    }
    if (this.source.kind === "png") {
      return { field: "pngSize", value: this.source.pngSize };
    }
    return { field: "size", value: this.source.size };
  }

  applySize(millimetres) {
    const { field } = this.sizeDriver;
    const value = Math.min(Math.max(millimetres, 1), 400);

    if (field === "faceSize") this.setStamp({ faceSize: value });
    else this.setSource({ [field]: value });

    return value;
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

      this.setSVGStage("stamp preparation");
      const handle = await this.handleGeometry();
      if (token !== this.token) return;

      await initializeSolids(wasmUrl);
      if (token !== this.token) return;
      this.setSVGStage("stamp generation");
      const { thinIssues, ...built } = buildStamp(artwork, this.stamp, handle);
      if (thinIssues.length > 0) {
        const scopedThinIssues =
          this.designModel === null
            ? thinIssues
            : thinIssues.map((issue) => ({ ...issue, scope: "design" }));
        issues = [
          ...issues.filter(({ level }) => level !== "ok"),
          ...scopedThinIssues,
        ];
      }
      this.recordValidation(sourceStats, elementStats, issues);
      if (this.diagnostics !== null) {
        this.diagnostics.geometryProduced = Boolean(
          built.stamp?.getAttribute("position")?.count,
        );
      }
      try {
        // Check the stamp before publishing it; STL export checks the file again.
        this.setSVGStage("final mesh validation");
        prepareClosedStamp(built.stamp).dispose();
        built.notes.push(
          "Stamp surface checks passed: closed, consistently oriented edges. Review in your slicer before printing.",
        );
      } catch (error) {
        built.stamp.dispose();
        built.clay.dispose();
        throw error;
      }
      this.completeSVGDiagnostics();
      this.publish(
        { artwork, issues, renderElements, segmentations, ...built },
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

  publish(result, token) {
    if (token !== this.token) return;

    this.result = result;
    this.busy = false;
    this.error = null;
    this.dispatchEvent(new Event("result"));
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

    // Rows are settled before anything is drawn: the wrap decides the
    // breaks and the size, and the layout uses the same relative spacing.
    const wrapped = wrapText(font, {
      text: source.text,
      size: source.fontSizeMm,
      letterSpacing: letterSpacingMm,
    });

    let canonical = layoutText(font, {
      text: wrapped.text,
      size: wrapped.size,
      letterSpacing: letterSpacingMm,
      lineSpacing: source.lineSpacing,
      align: source.alignment,
    });

    if (source.thicknessMm) {
      await initializeSolids(wasmUrl);
      canonical = offsetOutline(canonical, source.thicknessMm / 2);
    }

    return { canonical, issues: wrapped.issues };
  }

  async handleGeometry() {
    const choice = this.stamp.handle;
    if (choice === "none") return null;

    const source = choice === "sample" ? SAMPLE_HANDLE : choice;
    const key =
      source instanceof File ? `${source.name}:${source.size}` : source;

    if (!this.handles.has(key)) {
      this.handles.set(key, loadSTLGeometry(source));
    }

    return this.handles.get(key);
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
