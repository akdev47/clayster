import { createViewer } from "./viewer.js";
import { Pipeline } from "./pipeline/index.js";
import { createPipelineControls, exportable } from "./pipelineControls.js";
import { createPipelineDiagnostics } from "./pipelineDiagnostics.js";
import { createReviewPage } from "./reviewPage.js";
import { createCanonicalSvgRenderer } from "./canonicalSvgRenderer.js";
import { createThinGlyphHighlight } from "./thinGlyphHighlight.js";
import { createOrderPage } from "./orderPage.js";
import { createSTL } from "./exporters.js";
import { readServerConfig } from "./serverConfig.js";
import { DesignHistory } from "./designHistory.js";
import { createDesignElement, DesignModel } from "./designModel.js";
import {
  DesignEditorController,
  canonicalOverlayBox,
  cornerDragScale,
  fitsFace,
  isEditingField,
  MAX_ELEMENT_SCALE,
  MAX_TEXT_SIZE_MM,
  MIN_ELEMENT_SCALE,
  MIN_TEXT_SIZE_MM,
  shouldHandleElementArrowKey,
  shouldHandleElementDeleteKey,
  textResizePreview,
} from "./editor2dInteractions.js";
import { SharedDesignControls } from "./sharedDesignControls.js";
import { BUILT_IN_FONTS, DEFAULT_FONT_ID } from "./pipeline/fonts.js";
import {
  createStampLayout,
  layoutRenderElements,
  stampFaceSize,
  stampMargin,
} from "./pipeline/stampLayout.js";
import { bounds, transform } from "./pipeline/canonical.js";
import { readableStampDisplay } from "./stamp2dDisplay.js";
import { ArtworkComposer } from "./pipeline/artworkComposition.js";
import { createTextSizeControls, elementDimensionsCm } from "./sizing.js";
import { SETTINGS, applyInputLimits } from "./settings.js";
import { loadFont } from "./pipeline/text.js";
import { printableTextAdjustment } from "./pipeline/fixThinText.js";

const state = {
  width: 60,
  height: 45,
  minX: -30,
  minY: -22.5,
};

const designModel = new DesignModel();
const editor = new DesignEditorController(designModel);
const designControls = new SharedDesignControls(designModel, editor);
const designHistory = new DesignHistory(designModel);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// min/max/step of the input fields come from settings.js (data-limits).
applyInputLimits(document);

const artboard = $("#stamp-artboard");
const canonicalArtwork = $("#canonical-artwork");
const previewContainer = $("#three-preview");
const previewStatus = $("#three-preview-status");
const viewer = createViewer(previewContainer);
const pipeline = new Pipeline({ designModel });
// The page opens on the 2D artboard. The stamp mesh waits for 3D, review, or export.
pipeline.buildSolids = false;
const canonicalRenderer = createCanonicalSvgRenderer(canonicalArtwork);
const thinGlyphHighlight = createThinGlyphHighlight($("#thin-glyph-highlight"));
let hasFramedPreview = false;
let interactionActive = false;
let interactionViewport = null;
let renderGeometry = new Map();
let renderedTextSizes = new Map();
let displayGeometry = new Map();
let publishedLayout = null;
let overflowingIds = new Set();
const resizePreviewTransforms = new Map();
const committedResizePreviews = new Set();
let lastScene = null;
let artworkLayoutTransform = {};
const uploadedFonts = new Map();
let pendingImageUpload = null;
let samplePreviewReference = null;
let samplePreviewObjectUrl = null;
let transformControlsExpanded = false;
let imageUploadToastTimer = null;
let imageUploadToastHideTimer = null;
let imageUploadToastFrame = null;

artboard.classList.add("canonical-rendering-enabled");

// Keep element movement inside a fixed usable face. Moving artwork must never
// change the physical dimensions of the stamp.
editor.canonicalFor = (id) => renderGeometry.get(id);
editor.renderedTextSizeFor = (id) => renderedTextSizes.get(id);
const maximumTextSizeMm = () => {
  if (pipeline.stamp.faceShape === "minimal") return MAX_TEXT_SIZE_MM;
  const { width, height } = stampFaceSize(pipeline.stamp);
  return Math.max(
    MIN_TEXT_SIZE_MM,
    Math.min(width, height) - stampMargin(pipeline.stamp) * 2,
  );
};
Object.defineProperty(editor, "faceLimit", {
  get() {
    const stamp = pipeline.stamp;
    if (stamp.autoFaceSize || stamp.faceShape === "minimal") return null;
    const margin = stampMargin(stamp);
    const { width, height } = stampFaceSize(stamp);
    const halfWidth = (width - margin * 2) / 2;
    const halfHeight = (height - margin * 2) / 2;
    return halfWidth > 0 && halfHeight > 0
      ? { shape: stamp.faceShape, halfWidth, halfHeight }
      : null;
  },
  set() {},
});
Object.defineProperty(editor, "maxTextSizeMm", {
  get: maximumTextSizeMm,
  set() {},
});

const textSizeControls = createTextSizeControls({
  range: $("#font-size"),
  input: $("#font-size-input"),
  output: $("#font-size-value"),
  minMm: MIN_TEXT_SIZE_MM,
  maxMm: maximumTextSizeMm,
  onChange: (sizeMm) => {
    if (designControls.updateSelectedTextSize(sizeMm) !== null) render();
  },
});

createPipelineControls(viewer, pipeline, { designControls });
artboard.addEventListener("wheel", resizeSelectedFromTrackpad, {
  passive: false,
});

pipeline.addEventListener("running", () => {
  textSizeControls.refreshLimits();
  publishedLayout = null;
  if (!interactionActive) {
    renderCanonicalArtwork();
    renderArtboard();
  }
  if (pipeline.buildSolids || pipeline.forceSolids) {
    previewStatus.hidden = false;
    previewStatus.textContent = "Building 3D preview…";
  }
});

pipeline.addEventListener("result", () => {
  const result = pipeline.result;
  setRenderGeometry(result.renderElements);
  publishedLayout = result.layout ?? null;
  clearCommittedResizePreviews();
  renderCanonicalArtwork();
  if (!interactionActive) renderArtboard();
  viewer.show({ stamp: result.stamp, clay: result.clay });
  if (result.solidsDeferred) {
    previewStatus.hidden = true;
    previewStatus.textContent = "";
  } else {
    previewStatus.hidden = Boolean(result.stamp);
    previewStatus.textContent = result.stamp
      ? ""
      : "Add artwork to build the 3D preview.";
  }

  if (!hasFramedPreview && result.stamp) {
    viewer.frame(activePreviewMode());
    hasFramedPreview = true;
  }
});

pipeline.addEventListener("failed", () => {
  // Stamp generation can fail after the artwork itself was converted (for
  // example when enlarged text sits outside the backing). Keep that artwork
  // editable so the user can shrink or move it and trigger a successful run.
  setRenderGeometry(pipeline.artworkPreview?.renderElements);
  publishedLayout = null;
  clearCommittedResizePreviews();
  renderCanonicalArtwork();
  if (!interactionActive) renderArtboard();
  viewer.show({ stamp: null, clay: null });
  previewStatus.hidden = false;
  previewStatus.textContent = `Could not build 3D preview: ${pipeline.error?.message ?? "unknown error"}`;
});

const pipelineDiagnostics = createPipelineDiagnostics(pipeline, {
  getOverflowElementIds: overflowRepairElementIds,
  onFitToStamp: (elementId) => {
    void fitElementToStamp(elementId);
  },
  onHighlightThinGlyphs: (glyphs) => {
    if (editor.view !== "2d" || pipeline.busy || !lastScene || !pipeline.result?.layout) {
      thinGlyphHighlight.clear();
      return;
    }
    thinGlyphHighlight.show(
      glyphs,
      lastScene.dimensions,
      pipeline.result.layout.artworkTransform.mirrorX,
    );
  },
});

function hasArtworkOverflow() {
  return Boolean(
    pipeline.result?.issues?.some(({ code }) => code === "artwork-overflow"),
  );
}

function overflowRepairElementIds() {
  if (overflowingIds.size > 0) return [...overflowingIds];
  if (!hasArtworkOverflow()) return [];

  const selected = editor.selectedElement();
  if (selected?.visible) return [selected.id];
  return designModel.elements
    .filter(({ visible }) => visible)
    .map(({ id }) => id);
}

function waitForPipelineOutcome() {
  return new Promise((resolve) => {
    const finish = () => {
      pipeline.removeEventListener("result", finish);
      pipeline.removeEventListener("failed", finish);
      resolve();
    };
    pipeline.addEventListener("result", finish);
    pipeline.addEventListener("failed", finish);
  });
}

function fitSignature(element) {
  return JSON.stringify({
    fontSizeMm: element?.source.fontSizeMm,
    transform: element?.transform,
  });
}

async function fitElementToStamp(elementId) {
  // Final combined/thickened geometry can overflow even when the lightweight
  // per-element outline is barely inside the face. Recheck the authoritative
  // pipeline result after each pass and shrink gently until it clears.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const before = designModel.getElement(elementId);
    const localOverflow = overflowingIds.has(elementId);
    if (before === null || (!localOverflow && !hasArtworkOverflow())) return;

    const signature = fitSignature(before);
    const fitted = localOverflow
      ? editor.fitToStamp(elementId)
      : editor.resizeByFactor(elementId, 0.94);
    if (fitted === null) return;
    render();
    await waitForPipelineOutcome();

    const after = designModel.getElement(elementId);
    if (
      after === null ||
      (!overflowingIds.has(elementId) && !hasArtworkOverflow())
    ) return;
    if (fitSignature(after) === signature) return;
  }
}

function setRenderGeometry(renderElements) {
  renderGeometry = new Map(
    (renderElements ?? []).map(({ id, canonical }) => [id, canonical]),
  );
  renderedTextSizes = new Map(
    (renderElements ?? []).flatMap(({ id, renderedFontSizeMm }) =>
      renderedFontSizeMm === undefined ? [] : [[id, renderedFontSizeMm]],
    ),
  );
  if (renderGeometry.size === 0) displayGeometry = new Map();
}

function selectedElement() {
  return editor.selectedElement();
}

function setTransformControlsExpanded(expanded) {
  transformControlsExpanded = expanded;
  const toggle = $("#transform-controls-toggle");
  const label = expanded
    ? "Collapse position and transform controls"
    : "Expand position and transform controls";

  $("#transform-controls-content").hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  toggle.querySelector("[aria-hidden='true']").textContent = expanded
    ? "⌃"
    : "⌄";
}

function clearCommittedResizePreviews() {
  committedResizePreviews.forEach((id) => resizePreviewTransforms.delete(id));
  committedResizePreviews.clear();
}

function imageKind(file) {
  const name = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  if (file.type === "image/png" || name.endsWith(".png")) return "png";
  return null;
}

function imageSource(kind, file) {
  return kind === "png"
    ? {
        reference: file,
        baseSizeMm: 30,
        tracing: {
          smoothing: 2,
          backgroundMode: "auto",
          backgroundSamples: [],
          backgroundTolerance: 1,
        },
      }
    : { reference: file, baseSizeMm: 30 };
}

async function validateImageElement(element) {
  const validator = new ArtworkComposer((candidate) =>
    pipeline.buildElementArtwork(candidate),
  );
  const result = await validator.compose([element]);
  const blockingIssue = result.issues.find(({ level }) => level === "error");
  if (blockingIssue !== undefined) throw new Error(blockingIssue.message);
}

function showImageUploadToast(message = "") {
  const toast = $("#image-upload-toast");
  clearTimeout(imageUploadToastTimer);
  clearTimeout(imageUploadToastHideTimer);
  cancelAnimationFrame(imageUploadToastFrame);

  toast.classList.remove("show");
  if (message === "") {
    toast.hidden = true;
    return;
  }

  $("#image-upload-toast-message").textContent = message;
  toast.hidden = false;
  imageUploadToastFrame = requestAnimationFrame(() => {
    imageUploadToastFrame = requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  });
  imageUploadToastTimer = setTimeout(() => {
    toast.classList.remove("show");
    imageUploadToastHideTimer = setTimeout(() => {
      toast.hidden = true;
    }, 450);
  }, 3600);
}

function readableImageUploadError(kind) {
  return `${kind.toUpperCase()} upload failed. Try a different image.`;
}

function logoPlaceholder(kind) {
  return `
    <span class="design-logo-placeholder" aria-label="${kind.toUpperCase()} artwork">${kind.toUpperCase()}</span>
  `;
}

function formatElementSizeMm(dimensions) {
  if (dimensions === null) return null;
  return `${(dimensions.width * 10).toFixed(1)} × ${(dimensions.height * 10).toFixed(1)} mm`;
}

function addResizeHandles(element) {
  if (element.id !== editor.selectedId) return "";

  const sizeLabel = formatElementSizeMm(
    elementDimensionsCm(displayGeometry.get(element.id)),
  );
  return `
    <span class="resize-handle handle-top-left"></span>
    <span class="resize-handle handle-top-right"></span>
    <span class="resize-handle handle-bottom-left"></span>
    <span class="resize-handle handle-bottom-right"></span>
    <span class="selection-size"${sizeLabel === null ? " hidden" : ""}>${sizeLabel ?? ""}</span>
  `;
}

function renderArtboard() {
  const focusedElementId = document.activeElement?.classList?.contains(
    "design-element",
  )
    ? document.activeElement.dataset.elementId
    : null;
  artboard.querySelectorAll(".design-element").forEach((item) => item.remove());

  designModel.elements.forEach((element) => {
    const item = document.createElement("div");

    item.dataset.elementId = element.id;
    item.tabIndex = 0;
    item.className = `design-element ${
      element.kind === "text" ? "" : "image-element"
    } ${element.id === editor.selectedId ? "selected" : ""} ${
      overflowingIds.has(element.id) ? "out-of-bounds" : ""
    }`;

    if (element.kind === "text") {
      item.style.textAlign = element.source.alignment;

      item.innerHTML = `
        <span>${escapeHtml(element.source.text)}</span>
        ${addResizeHandles(element)}
      `;
    } else {
      item.innerHTML = `
        ${logoPlaceholder(element.kind)}
        ${addResizeHandles(element)}
      `;
    }

    item.addEventListener("pointerdown", startDrag);
    item.addEventListener("focus", () => selectElement(element.id));
    item.addEventListener("keydown", moveElementFromKeyboard);
    item.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        startResize(event, element, item);
      });
    });
    artboard.append(item);
    applyOverlayBounds(item, element);
  });

  if (focusedElementId !== null && focusedElementId === editor.selectedId) {
    const focusedItem = [...artboard.querySelectorAll(".design-element")].find(
      (item) => item.dataset.elementId === focusedElementId,
    );
    focusedItem?.focus({ preventScroll: true });
  }
}

function renderCanonicalArtwork() {
  thinGlyphHighlight.clear();
  const sourceElements = designModel.elements.flatMap((element) => {
    const canonical = renderGeometry.get(element.id);
    return element.visible && canonical !== undefined
      ? [
          {
            id: element.id,
            kind: element.kind,
            canonical,
            transform:
              resizePreviewTransforms.get(element.id) ?? element.transform,
          },
        ]
      : [];
  });

  const combined = sourceElements.flatMap((element) =>
    transform(element.canonical, element.transform),
  );
  const layout = publishedLayout !== null && resizePreviewTransforms.size === 0
    ? publishedLayout
    : createStampLayout(combined, pipeline.stamp, []);
  const physicalElements = layoutRenderElements(
    sourceElements,
    layout.artworkTransform,
  );
  const display = readableStampDisplay(layout, physicalElements);
  artworkLayoutTransform = display.interactionTransform;
  displayGeometry = new Map(
    display.elements.map(({ id, canonical }) => [id, canonical]),
  );
  // Keep the pointer's physical coordinate system steady until release even
  // as the backing grows. The face itself still uses the shared live layout.
  state.width = interactionViewport?.width ?? display.widthMm;
  state.height = interactionViewport?.height ?? display.heightMm;
  state.minX = interactionViewport?.minX ?? display.minX;
  state.minY = interactionViewport?.minY ?? display.minY;
  artboard.dataset.faceShape = layout.faceShape;

  // Elements that stick out past the face are redrawn on top in a warning
  // colour, so they stay visible and editable but are clearly not printable.
  const overflowing = display.elements.filter(
    ({ canonical }) => !fitsFace(canonical, {}, editor.faceLimit),
  );
  overflowingIds = new Set(overflowing.map(({ id }) => id));
  document
    .querySelectorAll(".design-element")
    .forEach((item) =>
      item.classList.toggle(
        "out-of-bounds",
        overflowingIds.has(item.dataset.elementId),
      ),
    );

  lastScene = {
    artwork: display.artwork,
    overflowing,
    face: display.face,
    dimensions: {
      widthMm: state.width,
      heightMm: state.height,
      minX: state.minX,
      minY: state.minY,
    },
  };

  canonicalRenderer.renderTransformed(
    sourceElements.map((element) => ({
      ...element,
      kind: overflowingIds.has(element.id) ? "overflow" : element.kind,
      transforms: [element.transform, { ...layout.artworkTransform, mirrorX: false }],
    })),
    {
      widthMm: state.width,
      heightMm: state.height,
      minX: state.minX,
      minY: state.minY,
    },
    { face: display.face },
  );
  updateDimensions(display);
  updateElementDimensions();
}

function applyOverlayBounds(item, element) {
  const canonical = displayGeometry.get(element.id);
  if (canonical === undefined) {
    item.style.left = "45%";
    item.style.top = "45%";
    item.style.width = "10%";
    item.style.height = "10%";
    item.style.transform = "none";
    return;
  }

  const box = canonicalOverlayBox(canonical, {}, {
    widthMm: state.width,
    heightMm: state.height,
    minX: state.minX,
    minY: state.minY,
  });
  item.style.left = `${box.leftPercent}%`;
  item.style.top = `${box.topPercent}%`;
  item.style.width = `${box.widthPercent}%`;
  item.style.height = `${box.heightPercent}%`;
  item.style.transform = "none";
}

function render() {
  renderCanonicalArtwork();
  renderArtboard();
  updateControls();
}

function escapeHtml(text) {
  const characterMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return text.replace(/[&<>"']/g, (character) => characterMap[character]);
}

function fontPreviewText(text) {
  const preview = text.replace(/\s+/g, " ").trim();
  return preview.slice(0, 24) || "Your text";
}

function fontLabel(font) {
  return (
    font.label ??
    BUILT_IN_FONTS.find(({ id }) => id === font.id)?.label ??
    font.id ??
    "Choose a font"
  );
}

function updateFontPicker(element) {
  const preview = fontPreviewText(element.source.text);
  const selectedFont = element.source.font;
  const selectedLabel = fontLabel(selectedFont);

  $("#font-current-name").textContent = selectedLabel;
  $("#font-current-preview").textContent = preview;
  $("#font-current-preview").style.fontFamily = selectedLabel;

  $$(".font-option").forEach((option) => {
    const isActive = option.dataset.fontId === selectedFont.id;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-pressed", String(isActive));

    const optionPreview = option.querySelector(".font-option-preview");
    optionPreview.textContent = preview;
    optionPreview.style.fontFamily = option.dataset.fontLabel;
  });
}

function addFontOption(fontName, fontId = fontName) {
  const option = document.createElement("button");
  const name = document.createElement("span");
  const preview = document.createElement("span");
  const check = document.createElement("span");

  option.type = "button";
  option.className = "dropdown-item font-option";
  option.dataset.fontId = fontId;
  option.dataset.fontLabel = fontName;

  name.className = "font-option-name";
  name.textContent = `${fontName} · Custom`;

  preview.className = "font-option-preview";
  preview.textContent = fontPreviewText(
    selectedElement()?.source.text ?? "Your text",
  );
  preview.style.fontFamily = fontName;

  check.className = "font-option-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";

  option.append(name, preview, check);
  $("#font-options").append(option);
}

function updateControls() {
  const element = selectedElement();
  const isText = element?.kind === "text";
  const isImage = element?.kind === "svg" || element?.kind === "png";

  $("#selected-element-section").hidden = !element;
  $("#text-controls").classList.toggle("d-none", !isText);
  $("#image-controls").classList.toggle("d-none", !isImage);
  $("#png-options").classList.toggle("d-none", element?.kind !== "png");
  $("#transform-controls").classList.toggle("d-none", !element);
  $("#element-scale-control").classList.toggle("d-none", !element || isText);
  $("#duplicate-element").disabled = !element;
  $("#delete-element").disabled = !element;
  updateElementDimensions();

  if (element) {
    $("#element-x").value = round2(element.transform.xMm);
    $("#element-y").value = round2(element.transform.yMm);
    $("#element-scale").value = round2(element.transform.scale);
    $("#element-rotation").value = round2(element.transform.rotationDeg);
    $("#element-mirror-x").checked = element.transform.mirrorX;
    $("#element-mirror-y").checked = element.transform.mirrorY;
  }

  if (isImage) {
    $("#artwork-base-size").value = element.source.baseSizeMm;
    $("#image-message").textContent = `${element.kind.toUpperCase()} source: ${sourceName(element.source.reference)}`;
    if (element.kind === "png") {
      const smoothing = element.source.tracing.smoothing;
      $("#png-background").value = element.source.tracing.backgroundMode;
      $("#png-smoothing").value = smoothing;
      $("#png-smoothing-value").textContent =
        smoothing === 0 ? "Off" : `${smoothing}×`;
    }
  }

  updatePNGSampleControls(element);

  if (!isText) return;

  $("#text-input").value = element.source.text;
  updateFontPicker(element);
  const textSizeMm = element.source.fontSizeMm * element.transform.scale;
  updateTextSizeControl(textSizeMm);
  const letterSpacingPercent = round2(
    element.source.letterSpacingRatio * 100,
  );
  $("#letter-spacing").value = letterSpacingPercent;
  $("#line-spacing").value = element.source.lineSpacing;
  $("#font-weight").value = element.source.thicknessMm;

  $("#letter-spacing-value").textContent = `${letterSpacingPercent}%`;
  $("#line-spacing-value").textContent = `${element.source.lineSpacing}×`;
  $("#font-weight-value").textContent = thicknessLabel(
    element.source.thicknessMm,
  );

  $$(".alignment-button").forEach((button) => {
    const active = button.dataset.align === element.source.alignment;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateTextSizeControl(fontSizeMm) {
  textSizeControls.update(fontSizeMm);
}

function selectedElementSizeMm(element) {
  const dimensions = elementDimensionsCm(displayGeometry.get(element.id));
  if (dimensions === null) return null;
  return { width: dimensions.width * 10, height: dimensions.height * 10 };
}

function updateElementDimensions() {
  const element = selectedElement();
  // Reuse the geometry already transformed for the 2D view, including cheap
  // drag previews, rather than converting or transforming the source again.
  const dimensions = element === null ? null : selectedElementSizeMm(element);
  const sizeLabel = formatElementSizeMm(
    dimensions === null
      ? null
      : { width: dimensions.width / 10, height: dimensions.height / 10 },
  );
  $("#center-element").disabled = pipeline.busy || dimensions === null;
  for (const [input, value] of [
    [$("#element-width"), dimensions?.width],
    [$("#element-height"), dimensions?.height],
  ]) {
    input.disabled = dimensions === null;
    if (input === document.activeElement) continue;
    input.value = value == null ? "" : value.toFixed(1);
  }
  const badge = document.querySelector(".design-element.selected .selection-size");
  if (badge !== null) {
    badge.hidden = sizeLabel === null;
    badge.textContent = sizeLabel ?? "";
  }
}

function applyElementSize(axis, requested) {
  const element = selectedElement();
  const dimensions = element === null ? null : selectedElementSizeMm(element);
  const change = dimensions === null
    ? null
    : uniformSizeChange(dimensions, axis, requested);
  if (change === null) {
    updateElementDimensions();
    return;
  }
  editor.resizeByFactor(element.id, change.factor);
  render();
  const next = selectedElementSizeMm(element);
  if (next === null) return;
  $("#element-width").value = next.width.toFixed(1);
  $("#element-height").value = next.height.toFixed(1);
}

function updatePNGSampleControls(element) {
  const controls = $("#png-sample-controls");
  const picking =
    element?.kind === "png" &&
    element.source.tracing.backgroundMode === "pick";
  controls.hidden = !picking;
  if (!picking) return;

  setPNGSamplePreview(element.source.reference);
  const { backgroundSamples, backgroundTolerance } = element.source.tracing;
  $("#png-background-tolerance").value = backgroundTolerance;
  $("#png-background-tolerance-value").textContent = `${backgroundTolerance}×`;
  $("#png-sample-count").textContent = `${backgroundSamples.length} ${
    backgroundSamples.length === 1 ? "sample" : "samples"
  }`;
  $("#png-clear-samples").disabled = backgroundSamples.length === 0;

  const markers = $("#png-sample-markers");
  markers.replaceChildren(
    ...backgroundSamples.map(({ x, y }, index) => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "png-sample-marker";
      marker.style.left = `${x * 100}%`;
      marker.style.top = `${y * 100}%`;
      marker.textContent = "×";
      marker.setAttribute(
        "aria-label",
        `Remove background sample ${index + 1}`,
      );
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        updatePNGTracing({
          backgroundSamples: backgroundSamples.filter(
            (_sample, sampleIndex) => sampleIndex !== index,
          ),
        });
      });
      return marker;
    }),
  );
}

function setPNGSamplePreview(reference) {
  if (reference === samplePreviewReference) return;
  if (samplePreviewObjectUrl !== null) {
    URL.revokeObjectURL(samplePreviewObjectUrl);
    samplePreviewObjectUrl = null;
  }
  samplePreviewReference = reference;

  const image = $("#png-sample-image");
  if (reference instanceof Blob) {
    samplePreviewObjectUrl = URL.createObjectURL(reference);
    image.src = samplePreviewObjectUrl;
  } else if (typeof reference === "string") {
    image.src = reference;
  } else {
    image.removeAttribute("src");
  }
}

function updatePNGTracing(tracingPatch) {
  const selected = selectedElement();
  if (selected?.kind !== "png") return null;
  const changed = designControls.updateSelectedSource("png", {
    tracing: { ...selected.source.tracing, ...tracingPatch },
  });
  if (changed !== null) render();
  return changed;
}

function sourceName(reference) {
  if (typeof reference === "string") return reference.split("/").at(-1);
  return reference?.name ?? "No source selected";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function thicknessLabel(thicknessMm) {
  if (thicknessMm === 0) return "Normal";
  return `${thicknessMm > 0 ? "+" : "−"}${Math.abs(round2(thicknessMm))} mm`;
}

function updateDimensions(dimensions) {
  artboard.style.aspectRatio = `${state.width} / ${state.height}`;
  $("#dimension-text").textContent = `${round2(dimensions.widthMm)} × ${round2(dimensions.heightMm)} mm`;
  $("#pipeline-face-dimensions").textContent = lastScene.artwork.length
    ? `${dimensions.widthMm.toFixed(1)} × ${dimensions.heightMm.toFixed(1)} mm`
    : "—";
}

function updateSelectedText(sourcePatch) {
  if (designControls.updateSelectedSource("text", sourcePatch) === null) return;
  render();
}

function selectElement(id) {
  editor.select(id);

  $$(".design-element").forEach((item) => {
    item.classList.toggle(
      "selected",
      item.dataset.elementId === editor.selectedId,
    );
  });

  updateControls();
}

$("#stamp-canvas").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || editor.selectedId === null) return;
  if (event.target.closest(".design-element")) return;

  if (document.activeElement?.classList.contains("design-element")) {
    document.activeElement.blur();
  }
  editor.select(null);
  renderArtboard();
  updateControls();
});

function startDrag(event) {
  event.preventDefault();

  const item = event.currentTarget;
  const id = item.dataset.elementId;
  const element = designModel.getElement(id);

  if (!element) return;

  interactionActive = true;
  interactionViewport = { ...state };
  item.focus({ preventScroll: true });
  selectElement(id);
  item.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  const startTransform = element.transform;
  const startLayoutTransform = artworkLayoutTransform;

  const move = (moveEvent) => {
    const changed = editor.moveFromScreenDelta(
      id,
      startTransform,
      {
        deltaX: moveEvent.clientX - startX,
        deltaY: moveEvent.clientY - startY,
      },
      artboard.getBoundingClientRect(),
      { widthMm: state.width, heightMm: state.height },
      startLayoutTransform,
    );
    renderCanonicalArtwork();
    applyOverlayBounds(item, changed);
  };

  const stop = () => {
    interactionActive = false;
    interactionViewport = null;
    item.removeEventListener("pointermove", move);
    item.removeEventListener("pointerup", stop);
    item.removeEventListener("pointercancel", stop);
    render();
  };

  item.addEventListener("pointermove", move);
  item.addEventListener("pointerup", stop);
  item.addEventListener("pointercancel", stop);
}

function moveElementFromKeyboard(event) {
  if (!shouldHandleElementArrowKey(event)) return;

  event.preventDefault();
  interactionActive = true;
  try {
    const item = event.currentTarget;
    const changed = editor.moveFromArrowKey(item.dataset.elementId, event.key);
    if (changed === null) return;
    renderCanonicalArtwork();
    applyOverlayBounds(item, changed);
    updateControls();
  } finally {
    interactionActive = false;
  }
}

// Chromium-based browsers expose a Mac trackpad pinch as a wheel event with
// Ctrl held. Regular two-finger scrolling is deliberately left untouched.
function resizeSelectedFromTrackpad(event) {
  if (!event.ctrlKey || editor.view !== "2d" || editor.selectedId === null) {
    return;
  }

  const delta = Math.min(20, Math.max(-20, event.deltaY));
  const factor = Math.exp(-delta * 0.01);
  const changed = editor.resizeByFactor(editor.selectedId, factor);
  if (changed === null) return;

  event.preventDefault();
  render();
}

function startResize(event, element, item) {
  event.preventDefault();
  event.stopPropagation();

  const canonical = renderGeometry.get(element.id);
  if (canonical === undefined) return;

  interactionActive = true;
  interactionViewport = { ...state };
  selectElement(element.id);
  item.focus({ preventScroll: true });
  event.currentTarget.setPointerCapture(event.pointerId);

  const itemBounds = item.getBoundingClientRect();
  const centre = {
    x: itemBounds.left + itemBounds.width / 2,
    y: itemBounds.top + itemBounds.height / 2,
  };
  const startPointer = { x: event.clientX, y: event.clientY };
  const startTransform = element.transform;
  const startScale = startTransform.scale;
  const startTextSizeMm =
    element.kind === "text" ? element.source.fontSizeMm : null;
  let textPreview =
    element.kind === "text"
      ? textResizePreview(
          startTextSizeMm,
          startTransform,
          startScale,
          editor.maxTextSizeMm,
        )
      : null;
  let hasTextPreview = false;
  const handle = event.currentTarget;

  const resize = (moveEvent) => {
    const nextScale = cornerDragScale(
      startPointer,
      centre,
      { x: moveEvent.clientX, y: moveEvent.clientY },
      startTransform.scale,
    );

    if (element.kind === "text") {
      textPreview = textResizePreview(
        startTextSizeMm,
        startTransform,
        nextScale,
        editor.maxTextSizeMm,
      );
      resizePreviewTransforms.set(element.id, textPreview.transform);
      hasTextPreview = true;
      renderCanonicalArtwork();
      applyOverlayBounds(item, element);
      updateTextSizeControl(textPreview.fontSizeMm);
      return;
    }

    const changed = editor.resize(
      element.id,
      canonical,
      startTransform,
      nextScale,
    );
    renderCanonicalArtwork();
    applyOverlayBounds(item, changed);
    updateControls();
  };

  const stop = () => {
    handle.removeEventListener("pointermove", resize);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);

    if (element.kind === "text" && hasTextPreview) {
      const currentSizeMm =
        element.source.fontSizeMm * element.transform.scale;
      const needsCommit =
        textPreview.fontSizeMm !== currentSizeMm ||
        element.transform.scale !== 1;
      if (needsCommit) {
        committedResizePreviews.add(element.id);
        editor.setTextSize(element.id, textPreview.fontSizeMm);
      } else {
        resizePreviewTransforms.delete(element.id);
      }
    }

    interactionActive = false;
    interactionViewport = null;
    render();
  };

  handle.addEventListener("pointermove", resize);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

const NEW_TEXT_SIZE_MM = SETTINGS.text.newTextSizeMm;
const NEW_TEXT_GAP_MM = SETTINGS.elements.newTextGapMm;

// New text goes into free space under (or else above) the existing artwork
// rather than on top of it, where it would merge into one unreadable shape.
function freeSpotForNewText(heightMm) {
  const occupied = designModel.elements.flatMap((element) => {
    const canonical = renderGeometry.get(element.id);
    return element.visible && canonical !== undefined
      ? transform(canonical, element.transform)
      : [];
  });
  if (occupied.length === 0) return 0;

  const box = bounds(occupied);
  const limit = editor.faceLimit;
  const reach = limit === null ? Infinity : limit.halfExtent;
  const below = box.minY - NEW_TEXT_GAP_MM - heightMm / 2;
  if (Math.abs(below) + heightMm / 2 <= reach) return below;
  const above = box.maxY + NEW_TEXT_GAP_MM + heightMm / 2;
  if (Math.abs(above) + heightMm / 2 <= reach) return above;
  return 0;
}

$("#add-text").addEventListener("click", () => {
  designControls.addElement(
    "text",
    {
      text: "TEXT",
      font: { id: "sans-bold", reference: null },
      fontSizeMm: NEW_TEXT_SIZE_MM,
      letterSpacingRatio: 1 / NEW_TEXT_SIZE_MM,
      lineSpacing: 1.25,
      alignment: "center",
      thicknessMm: 0.3,
    },
    { yMm: freeSpotForNewText(NEW_TEXT_SIZE_MM) },
  );
  render();
  const input = $("#text-input");
  input.focus();
  input.select();
});

function chooseImage(action, kind) {
  pendingImageUpload = { action, kind };
  showImageUploadToast();
  const input = $("#image-upload");
  input.accept =
    kind === "svg" ? ".svg,image/svg+xml" : ".png,image/png";
  input.click();
}

$("#add-svg").addEventListener("click", () => chooseImage("add", "svg"));
$("#add-png").addEventListener("click", () => chooseImage("add", "png"));

$("#replace-image").addEventListener("click", () => {
  const selected = selectedElement();
  if (selected?.kind === "svg" || selected?.kind === "png") {
    chooseImage("replace", selected.kind);
  }
});

$("#image-upload").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const kind = imageKind(file);
  const request = pendingImageUpload;
  pendingImageUpload = null;
  if (kind === null || request === null || kind !== request.kind) {
    showImageUploadToast(
      `Please choose a ${request?.kind?.toUpperCase() ?? "SVG or PNG"} file.`,
    );
    event.target.value = "";
    return;
  }

  const selected = request.action === "replace" ? selectedElement() : null;
  if (request.action === "replace" && selected?.kind !== kind) {
    showImageUploadToast("Could not replace the image. Please try again.");
    event.target.value = "";
    return;
  }

  let source;
  if (selected !== null) {
    source = kind === "png"
      ? {
          ...selected.source,
          reference: file,
          tracing: {
            ...selected.source.tracing,
            backgroundSamples: [],
          },
        }
      : { ...selected.source, reference: file };
  } else {
    source = imageSource(kind, file);
  }

  const candidate = createDesignElement(
    selected === null
      ? { kind, source }
      : { ...selected, source },
  );

  try {
    await validateImageElement(candidate);
  } catch {
    showImageUploadToast(readableImageUploadError(kind));
    event.target.value = "";
    return;
  }

  if (selected !== null) {
    // The user may have interacted with the design while the image decoded.
    // Update the original target, never whichever element happens to be
    // selected when validation finishes.
    const target = designModel.getElement(selected.id);
    if (target?.kind === kind) {
      designModel.updateElement(selected.id, { source });
      editor.select(selected.id);
    } else {
      showImageUploadToast("Could not replace the image. Please try again.");
      event.target.value = "";
      return;
    }
  } else {
    designControls.addElement(kind, imageSource(kind, file));
  }

  showImageUploadToast();
  event.target.value = "";
  render();
});

$("#upload-font").addEventListener("click", () => {
  $("#font-upload").click();
});

$("#font-upload").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const fontName = file.name.replace(/\.[^/.]+$/, "");
  const fontUrl = URL.createObjectURL(file);

  try {
    const uploadedFont = new FontFace(fontName, `url(${fontUrl})`);
    await uploadedFont.load();
    document.fonts.add(uploadedFont);

    const fontReference = /\.(ttf|otf)$/i.test(file.name) ? file : null;
    if (fontReference === null) {
      throw new Error("The 3D text pipeline requires a TTF or OTF font.");
    }
    uploadedFonts.set(fontName, fontReference);
    addFontOption(fontName);
    updateSelectedText({
      font: { id: fontName, label: fontName, reference: fontReference },
    });
  } catch {
    alert("That font could not be loaded. Try a TTF or OTF file.");
  }

  event.target.value = "";
});

function deleteSelectedElement() {
  if (editor.deleteSelected() === null) return;
  render();
}

function duplicateSelectedElement() {
  if (editor.duplicateSelected() === null) return;
  render();
}

$("#duplicate-element").addEventListener("click", () => {
  duplicateSelectedElement();
});

$("#delete-element").addEventListener("click", () => {
  deleteSelectedElement();
});

document.addEventListener("keydown", (event) => {
  if (shouldHandleElementDeleteKey(event)) {
    if (!selectedElement()) return;
    event.preventDefault();
    deleteSelectedElement();
    return;
  }

  // Inside text fields the browser's own undo handles typing.
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier || isEditingField(event.target) || interactionActive) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoDesign();
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault();
    redoDesign();
  }
});

// Undo / redo of design elements.
function afterHistoryJump() {
  editor.ensureSelection();
  render();
}

function undoDesign() {
  if (designHistory.undo()) afterHistoryJump();
}

function redoDesign() {
  if (designHistory.redo()) afterHistoryJump();
}

function updateHistoryButtons() {
  $("#undo-button").disabled = !designHistory.canUndo;
  $("#redo-button").disabled = !designHistory.canRedo;
}

$("#undo-button").addEventListener("click", undoDesign);
$("#redo-button").addEventListener("click", redoDesign);
designHistory.addEventListener("change", updateHistoryButtons);
updateHistoryButtons();

// "?" buttons show or hide the explanation they point to.
document.addEventListener("click", (event) => {
  const button = event.target.closest(".help-button");
  if (button === null) return;
  const text = document.getElementById(button.dataset.help);
  const show = text.hidden;
  text.hidden = !show;
  button.setAttribute("aria-expanded", String(show));
});

$("#text-input").addEventListener("input", (event) => {
  updateSelectedText({ text: event.target.value });
});

$("#font-options").addEventListener("click", (event) => {
  const option = event.target.closest(".font-option");

  if (!option) return;
  updateSelectedText({
    font: {
      id: option.dataset.fontId,
      label: option.dataset.fontLabel,
      reference: uploadedFonts.get(option.dataset.fontId) ?? null,
    },
  });
});

$("#letter-spacing").addEventListener("input", (event) => {
  updateSelectedText({
    letterSpacingRatio: Number(event.target.value) / 100,
  });
});

$("#line-spacing").addEventListener("input", (event) => {
  updateSelectedText({ lineSpacing: Number(event.target.value) });
});

$("#font-weight").addEventListener("input", (event) => {
  updateSelectedText({ thicknessMm: round2(Number(event.target.value)) });
});

$("#fix-thin-letters").addEventListener("click", async () => {
  const element = selectedElement();
  if (element?.kind !== "text") return;

  const button = $("#fix-thin-letters");
  const id = element.id;
  button.disabled = true;
  try {
    const font = await loadFont(
      element.source.font.reference ??
        (BUILT_IN_FONTS.find((candidate) => candidate.id === (element.source.font.id ?? DEFAULT_FONT_ID)) ?? BUILT_IN_FONTS[0]).url,
    );
    const adjustment = await printableTextAdjustment(
      font,
      element.source,
      element.transform,
    );
    if (adjustment === null || editor.selectedId !== id) return;
    updateSelectedText({
      fontSizeMm: adjustment.fontSizeMm,
      thicknessMm: adjustment.thicknessMm,
    });
  } finally {
    button.disabled = false;
  }
});

$$("#editor-controls-shared [data-align]").forEach((button) => {
  button.addEventListener("click", () => {
    updateSelectedText({ alignment: button.dataset.align });
  });
});

$("#artwork-base-size").addEventListener("input", (event) => {
  const selected = selectedElement();
  const value = Number(event.target.value);
  if (
    (selected?.kind === "svg" || selected?.kind === "png") &&
    Number.isFinite(value) &&
    value > 0
  ) {
    designControls.updateSelectedSource(selected.kind, { baseSizeMm: value });
  }
});

$("#png-smoothing").addEventListener("input", (event) => {
  const smoothing = Number(event.target.value);
  const selected = selectedElement();
  if (selected?.kind !== "png") return;
  if (designControls.updateSelectedSource("png", {
    tracing: { ...selected.source.tracing, smoothing },
  }) !== null) {
    $("#png-smoothing-value").textContent =
      smoothing === 0 ? "Off" : `${smoothing}×`;
  }
});

$("#png-background").addEventListener("change", (event) => {
  updatePNGTracing({ backgroundMode: event.target.value });
});

$("#png-background-tolerance").addEventListener("input", (event) => {
  updatePNGTracing({ backgroundTolerance: Number(event.target.value) });
});

$("#png-sample-editor").addEventListener("click", (event) => {
  if (event.target.closest(".png-sample-marker") !== null) return;
  const selected = selectedElement();
  if (
    selected?.kind !== "png" ||
    selected.source.tracing.backgroundMode !== "pick"
  ) {
    return;
  }

  const image = $("#png-sample-image");
  if (!image.complete || image.naturalWidth === 0) return;
  const rect = image.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  if (selected.source.tracing.backgroundSamples.length >= 32) return;

  updatePNGTracing({
    backgroundSamples: [
      ...selected.source.tracing.backgroundSamples,
      { x: round2(x), y: round2(y) },
    ],
  });
});

$("#png-clear-samples").addEventListener("click", () => {
  updatePNGTracing({ backgroundSamples: [] });
});

window.addEventListener("beforeunload", () => {
  if (samplePreviewObjectUrl !== null) {
    URL.revokeObjectURL(samplePreviewObjectUrl);
  }
});

function bindTransformNumber(
  selector,
  field,
  minimum = -Infinity,
  maximum = Infinity,
) {
  $(selector).addEventListener("input", (event) => {
    let value = Number(event.target.value);
    if (
      event.target.value !== "" &&
      Number.isFinite(value) &&
      value >= minimum
    ) {
      if (value > maximum) {
        value = maximum;
        event.target.value = String(maximum);
      }
      designControls.updateSelectedTransform({ [field]: value });
      if (editor.selectedId !== null) editor.constrainElement(editor.selectedId);
      renderCanonicalArtwork();
      renderArtboard();
    }
  });
}

function bindElementSize(selector, axis) {
  $(selector).addEventListener("change", (event) => {
    const requested = Number(event.target.value);
    if (event.target.value === "" || !Number.isFinite(requested)) {
      updateElementDimensions();
      return;
    }
    applyElementSize(axis, requested);
  });
}

bindElementSize("#element-width", "width");
bindElementSize("#element-height", "height");
bindTransformNumber("#element-x", "xMm");
bindTransformNumber("#element-y", "yMm");
bindTransformNumber(
  "#element-scale",
  "scale",
  MIN_ELEMENT_SCALE,
  MAX_ELEMENT_SCALE,
);
bindTransformNumber("#element-rotation", "rotationDeg");

$("#transform-controls-toggle").addEventListener("click", () => {
  setTransformControlsExpanded(!transformControlsExpanded);
});

$("#center-element").addEventListener("click", () => {
  if (pipeline.busy || lastScene === null) return;
  if (editor.centerSelectedOnStamp(lastScene.face) !== null) render();
});

$("#element-mirror-x").addEventListener("change", (event) => {
  designControls.updateSelectedTransform({ mirrorX: event.target.checked });
  renderCanonicalArtwork();
  renderArtboard();
});

$("#element-mirror-y").addEventListener("change", (event) => {
  designControls.updateSelectedTransform({ mirrorY: event.target.checked });
  renderCanonicalArtwork();
  renderArtboard();
});

function activePreviewMode() {
  return $("#preview-surface-toggle [data-mode].active")?.dataset.mode ?? "stamp";
}

$$("#preview-surface-toggle [data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    $$("#preview-surface-toggle [data-mode]").forEach((modeButton) =>
      modeButton.classList.remove("active"),
    );
    button.classList.add("active");

    if ($("[data-view='3d']").classList.contains("active")) {
      viewer.frame(button.dataset.mode);
    }
  });
});

$$("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    $$("[data-view]").forEach((viewButton) => {
      viewButton.classList.remove("active");
    });

    button.classList.add("active");

    const show2D = button.dataset.view === "2d";
    editor.setView(show2D ? "2d" : "3d");
    thinGlyphHighlight.clear();
    $("#stamp-canvas").classList.toggle("preview-hidden", !show2D);
    previewContainer.classList.toggle("d-none", show2D);
    $("#preview-surface-toggle").hidden = show2D;
    $(".drag-instruction").hidden = !show2D;

    if (show2D) {
      pipeline.buildSolids = false;
    } else {
      pipeline.buildSolids = true;
      if (pipeline.result?.stamp && !pipeline.busy) {
        viewer.frame(activePreviewMode());
      } else {
        previewStatus.hidden = false;
        previewStatus.textContent = "Building 3D preview…";
        void pipeline.ensureSolids().then((built) => {
          if (built && editor.view === "3d") viewer.frame(activePreviewMode());
        });
      }
    }
  });
});

$("#print-panel-toggle").addEventListener("click", () => {
  const workspace = $(".workspace-shell");
  const toggle = $("#print-panel-toggle");
  const collapsed = workspace.classList.toggle("print-panel-collapsed");
  const label = collapsed
    ? "Show printability check"
    : "Hide printability check";

  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.title = label;
  toggle.querySelector(".visually-hidden").textContent = label;
});

// Read-only copy of the 2D stamp for the order page. Returns the drawn
// stamp's width in mm, or null when there is nothing to draw yet.
function renderOrderPreview(svg, dimensionLabel) {
  const scene = lastScene;
  dimensionLabel.textContent = $("#dimension-text").textContent;
  if (scene === null || scene.artwork.length === 0) {
    createCanonicalSvgRenderer(svg).clear();
    return null;
  }
  createCanonicalSvgRenderer(svg).render(
    [
      { id: "combined-artwork", kind: "design", canonical: scene.artwork },
      ...scene.overflowing.map(({ id, canonical }) => ({
        id: `overflow-${id}`,
        kind: "overflow",
        canonical,
      })),
    ],
    scene.dimensions,
    { face: scene.face },
  );
  return { widthMm: scene.dimensions.widthMm };
}

// Editor -> review -> order details. The review remains read-only; returning
// to the editor keeps the same authoritative model and pipeline settings.
const designPage = $("#design-page");
const reviewPageElement = $("#review-page");
const orderPageElement = $("#order-page");
const reviewPage = createReviewPage({
  designModel,
  pipeline,
  diagnostics: pipelineDiagnostics,
  onBack: () => showPage("design"),
  onContinue: () => showPage("order"),
  renderPreview: renderOrderPreview,
});
const orderPage = createOrderPage({
  designModel,
  pipeline,
  onBack: () => showPage("review"),
  renderPreview: renderOrderPreview,
  createStl: () => createSTL(exportable(viewer, pipeline)),
  config: readServerConfig(),
});

function showPage(name) {
  const review = name === "review";
  const order = name === "order";
  reviewPage.hide();
  orderPage.hide();
  designPage.hidden = review || order;
  reviewPageElement.hidden = !review;
  orderPageElement.hidden = !order;
  const steps = ["design", "review", "order", "confirmation"];
  const currentIndex = steps.indexOf(name);
  $$('[data-workflow-step]').forEach((step) => {
    const index = steps.indexOf(step.dataset.workflowStep);
    step.classList.toggle("current", index === currentIndex);
    step.classList.toggle("complete", index < currentIndex);
    if (index === currentIndex) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  if (review) reviewPage.show();
  if (order) orderPage.show();
  window.scrollTo({ top: 0 });
}

$("#continue-button").addEventListener("click", async () => {
  $("#continue-button").disabled = true;
  const built = await pipeline.ensureSolids();
  updateFinalizeButton();
  const blocked = pipeline.result?.issues?.some(({ level }) => level === "error");
  if (built && !blocked) showPage("review");
});

// Review builds the stamp on the way in. Warnings are allowed, errors are not.
function updateFinalizeButton() {
  const blocked =
    pipeline.result?.issues?.some(({ level }) => level === "error") ||
    pipeline.diagnostics?.level === "error";
  const hasDesign = designModel.elements.length > 0 && pipeline.result != null;
  const ready = hasDesign && !pipeline.busy && !blocked;
  $("#continue-button").disabled = !ready;
  $("#finalize-hint").textContent = designModel.elements.length === 0
    ? "Add text or artwork to continue."
    : pipeline.busy
      ? "Wait for the stamp to finish building."
      : pipeline.error
        ? "The stamp could not be built. Adjust the design and try again."
        : blocked
          ? "Fix the errors above before reviewing."
          : "Next: review your design.";
}
for (const type of ["running", "result", "failed"]) {
  pipeline.addEventListener(type, updateFinalizeButton);
}
updateFinalizeButton();

render();
await pipeline.run();
