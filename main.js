import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./style.css";
import { createViewer } from "./src/viewer.js";
import { Pipeline } from "./src/pipeline/index.js";
import { createPipelineControls } from "./src/pipelineControls.js";
import { createPipelineDiagnostics } from "./src/pipelineDiagnostics.js";
import { createCanonicalSvgRenderer } from "./src/canonicalSvgRenderer.js";
import { DesignModel } from "./src/designModel.js";
import {
  DesignEditorController,
  canonicalOverlayBox,
  fitsFace,
} from "./src/editor2dInteractions.js";
import { SharedDesignControls } from "./src/sharedDesignControls.js";
import { BUILT_IN_FONTS } from "./src/pipeline/fonts.js";
import {
  createStampLayout,
  layoutRenderElements,
} from "./src/pipeline/stampLayout.js";
import { bounds, transform } from "./src/pipeline/canonical.js";
import { readableStampDisplay } from "./src/stamp2dDisplay.js";

const state = {
  width: 60,
  height: 45,
  minX: -30,
  minY: -22.5,
};

const designModel = new DesignModel({
  elements: [
    {
      id: "text-1",
      kind: "text",
      source: {
        text: "CLAYSTER\nSTUDIO",
        font: { id: "sans-bold", reference: null },
        fontSizeMm: 7.5,
        letterSpacingMm: 1,
        lineSpacing: 1.25,
        alignment: "center",
      },
    },
  ],
});
const editor = new DesignEditorController(designModel);
const designControls = new SharedDesignControls(designModel, editor);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const artboard = $("#stamp-artboard");
const canonicalArtwork = $("#canonical-artwork");
const previewContainer = $("#three-preview");
const previewStatus = $("#three-preview-status");
const viewer = createViewer(previewContainer);
const pipeline = new Pipeline({ designModel });
const canonicalRenderer = createCanonicalSvgRenderer(canonicalArtwork);
let hasFramedPreview = false;
let interactionActive = false;
let renderGeometry = new Map();
let displayGeometry = new Map();
let publishedLayout = null;
let overflowingIds = new Set();
let artworkLayoutTransform = {};
const uploadedFonts = new Map();
let pendingImageUpload = null;

artboard.classList.add("canonical-rendering-enabled");

// Elements may not leave the stamp's usable area (face minus margin). Outline
// and automatic faces are derived from the artwork, so they have no limit.
editor.canonicalFor = (id) => renderGeometry.get(id);
Object.defineProperty(editor, "faceLimit", {
  get() {
    const stamp = pipeline.stamp;
    if (stamp.autoFaceSize || stamp.faceShape === "outline") return null;
    const halfExtent = (stamp.faceSize - stamp.margin * 2) / 2;
    return halfExtent > 0 ? { shape: stamp.faceShape, halfExtent } : null;
  },
  set() {},
});

createPipelineControls(viewer, pipeline, { designControls });
createPipelineDiagnostics(pipeline);

pipeline.addEventListener("running", () => {
  publishedLayout = null;
  renderCanonicalArtwork();
  if (!interactionActive) renderArtboard();
  previewStatus.hidden = false;
  previewStatus.textContent = "Building 3D preview…";
});

pipeline.addEventListener("result", () => {
  const result = pipeline.result;
  renderGeometry = new Map(
    (result.renderElements ?? []).map(({ id, canonical }) => [id, canonical]),
  );
  publishedLayout = result.layout ?? null;
  renderCanonicalArtwork();
  if (!interactionActive) renderArtboard();
  viewer.show({ stamp: result.stamp, clay: result.clay });
  previewStatus.hidden = Boolean(result.stamp);
  previewStatus.textContent = result.stamp
    ? ""
    : "Add artwork to build the 3D preview.";

  if (!hasFramedPreview && result.stamp) {
    viewer.frame("both");
    hasFramedPreview = true;
  }
});

pipeline.addEventListener("failed", () => {
  renderGeometry = new Map();
  displayGeometry = new Map();
  publishedLayout = null;
  renderCanonicalArtwork();
  if (!interactionActive) renderArtboard();
  viewer.show({ stamp: null, clay: null });
  previewStatus.hidden = false;
  previewStatus.textContent = `Could not build 3D preview: ${pipeline.error?.message ?? "unknown error"}`;
});

function selectedElement() {
  return editor.selectedElement();
}

function imageKind(file) {
  const name = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  if (file.type === "image/png" || name.endsWith(".png")) return "png";
  return null;
}

function imageSource(kind, file) {
  return kind === "png"
    ? { reference: file, baseSizeMm: 30, tracing: { smoothing: 2 } }
    : { reference: file, baseSizeMm: 30 };
}

function logoPlaceholder(kind) {
  return `
    <span class="design-logo-placeholder" aria-label="${kind.toUpperCase()} artwork">${kind.toUpperCase()}</span>
  `;
}

function addResizeHandles(element) {
  if (element.id !== editor.selectedId) return "";

  return `
    <span class="resize-handle handle-top-left"></span>
    <span class="resize-handle handle-top-right"></span>
    <span class="resize-handle handle-bottom-left"></span>
    <span class="resize-handle handle-bottom-right"></span>
  `;
}

function renderArtboard() {
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
    item.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        startResize(event, element, item);
      });
    });
    artboard.append(item);
    applyOverlayBounds(item, element);
  });
}

function renderCanonicalArtwork() {
  const sourceElements = designModel.elements.flatMap((element) => {
    const canonical = renderGeometry.get(element.id);
    return element.visible && canonical !== undefined
      ? [
          {
            id: element.id,
            kind: element.kind,
            canonical,
            transform: element.transform,
          },
        ]
      : [];
  });

  const combined = sourceElements.flatMap((element) =>
    transform(element.canonical, element.transform),
  );
  const layout =
    publishedLayout ?? createStampLayout(combined, pipeline.stamp, []);
  const physicalElements = layoutRenderElements(
    sourceElements,
    layout.artworkTransform,
  );
  const display = readableStampDisplay(layout, physicalElements);
  artworkLayoutTransform = display.interactionTransform;
  displayGeometry = new Map(
    display.elements.map(({ id, canonical }) => [id, canonical]),
  );
  state.width = display.widthMm;
  state.height = display.heightMm;
  state.minX = display.minX;
  state.minY = display.minY;
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

  canonicalRenderer.render(
    display.artwork.length === 0
      ? []
      : [
          { id: "combined-artwork", kind: "design", canonical: display.artwork },
          ...overflowing.map(({ id, canonical }) => ({
            id: `overflow-${id}`,
            kind: "overflow",
            canonical,
          })),
        ],
    {
      widthMm: state.width,
      heightMm: state.height,
      minX: state.minX,
      minY: state.minY,
    },
    { face: display.face },
  );
  updateDimensions();
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

  $("#text-controls").classList.toggle("d-none", !isText);
  $("#image-controls").classList.toggle("d-none", !isImage);
  $("#png-options").classList.toggle("d-none", element?.kind !== "png");
  $("#transform-controls").classList.toggle("d-none", !element);
  $("#delete-element").disabled = !element;

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
      $("#png-smoothing").value = smoothing;
      $("#png-smoothing-value").textContent =
        smoothing === 0 ? "Off" : `${smoothing}×`;
    }
  }

  if (!isText) return;

  $("#text-input").value = element.source.text;
  updateFontPicker(element);
  $("#font-size").value = element.source.fontSizeMm;
  $("#letter-spacing").value = element.source.letterSpacingMm;
  $("#line-spacing").value = element.source.lineSpacing;
  $("#font-weight").value = element.source.thicknessMm;

  $("#font-size-value").textContent = `${element.source.fontSizeMm} mm`;
  $("#letter-spacing-value").textContent = `${element.source.letterSpacingMm} mm`;
  $("#line-spacing-value").textContent = `${element.source.lineSpacing}×`;
  $("#font-weight-value").textContent = thicknessLabel(
    element.source.thicknessMm,
  );

  $$(".alignment-button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.align === element.source.alignment,
    );
  });
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

function updateDimensions() {
  artboard.style.aspectRatio = `${state.width} / ${state.height}`;
  $("#dimension-text").textContent = `${round2(state.width)} × ${round2(state.height)} mm`;
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

function startDrag(event) {
  event.preventDefault();

  const item = event.currentTarget;
  const id = item.dataset.elementId;
  const element = designModel.getElement(id);

  if (!element) return;

  interactionActive = true;
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
    item.removeEventListener("pointermove", move);
    item.removeEventListener("pointerup", stop);
    item.removeEventListener("pointercancel", stop);
    render();
  };

  item.addEventListener("pointermove", move);
  item.addEventListener("pointerup", stop);
  item.addEventListener("pointercancel", stop);
}

function startResize(event, element, item) {
  event.preventDefault();
  event.stopPropagation();

  const canonical = renderGeometry.get(element.id);
  if (canonical === undefined) return;

  interactionActive = true;
  selectElement(element.id);
  item.focus({ preventScroll: true });
  event.currentTarget.setPointerCapture(event.pointerId);

  const itemBounds = item.getBoundingClientRect();
  const centerX = itemBounds.left + itemBounds.width / 2;
  const centerY = itemBounds.top + itemBounds.height / 2;
  const startDistance = Math.hypot(
    event.clientX - centerX,
    event.clientY - centerY,
  );
  const startTransform = element.transform;
  const startScale = startTransform.scale;
  const handle = event.currentTarget;

  const resize = (moveEvent) => {
    const distance = Math.hypot(
      moveEvent.clientX - centerX,
      moveEvent.clientY - centerY,
    );
    const nextScale = startScale * (distance / Math.max(startDistance, 1));

    const changed = editor.resize(
      element.id,
      canonical,
      startTransform,
      Math.min(2.5, Math.max(0.45, nextScale)),
    );
    renderCanonicalArtwork();
    applyOverlayBounds(item, changed);
  };

  const stop = () => {
    interactionActive = false;
    handle.removeEventListener("pointermove", resize);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    render();
  };

  handle.addEventListener("pointermove", resize);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

const NEW_TEXT_SIZE_MM = 7.5;
const NEW_TEXT_GAP_MM = 2;

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
      letterSpacingMm: 1,
      lineSpacing: 1.25,
      alignment: "center",
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

$("#image-upload").addEventListener("change", (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const kind = imageKind(file);
  const request = pendingImageUpload;
  pendingImageUpload = null;
  if (kind === null || request === null || kind !== request.kind) {
    alert(`Choose a ${request?.kind?.toUpperCase() ?? "SVG or PNG"} file.`);
    event.target.value = "";
    return;
  }

  if (request.action === "replace") {
    designControls.replaceSelectedReference(kind, file);
  } else {
    designControls.addElement(kind, imageSource(kind, file));
  }

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

$("#delete-element").addEventListener("click", () => {
  deleteSelectedElement();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Backspace") return;

  const target = event.target;
  const isEditing =
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

  if (isEditing || !selectedElement()) return;

  event.preventDefault();
  deleteSelectedElement();
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

$("#font-size").addEventListener("input", (event) => {
  updateSelectedText({ fontSizeMm: Number(event.target.value) });
});

$("#letter-spacing").addEventListener("input", (event) => {
  updateSelectedText({ letterSpacingMm: Number(event.target.value) });
});

$("#line-spacing").addEventListener("input", (event) => {
  updateSelectedText({ lineSpacing: Number(event.target.value) });
});

$("#font-weight").addEventListener("input", (event) => {
  updateSelectedText({ thicknessMm: round2(Number(event.target.value)) });
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

function bindTransformNumber(selector, field, minimum = -Infinity) {
  $(selector).addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (
      event.target.value !== "" &&
      Number.isFinite(value) &&
      value >= minimum
    ) {
      designControls.updateSelectedTransform({ [field]: value });
      if (editor.selectedId !== null) editor.constrainElement(editor.selectedId);
      renderCanonicalArtwork();
      renderArtboard();
    }
  });
}

bindTransformNumber("#element-x", "xMm");
bindTransformNumber("#element-y", "yMm");
bindTransformNumber("#element-scale", "scale", 0.05);
bindTransformNumber("#element-rotation", "rotationDeg");

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
    $("#stamp-canvas").classList.toggle("preview-hidden", !show2D);
    previewContainer.classList.toggle("d-none", show2D);
    $("#preview-surface-toggle").hidden = show2D;
    $(".drag-instruction").hidden = !show2D;

    if (!show2D) {
      viewer.frame("both");
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

render();
await pipeline.run();
