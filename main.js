import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./style.css";
import { createViewer } from "./src/viewer.js";
import { Pipeline } from "./src/pipeline/index.js";
import { createPipelineControls } from "./src/pipelineControls.js";

const state = {
  width: 60,
  height: 45,
  thickness: 4,
  mirror: false,
  handle: "Standard Handle",
  selectedId: 1,
  elements: [
    {
      id: 1,
      type: "text",
      name: "Text 1",
      text: "CLAYSTER\nSTUDIO",
      x: 50,
      y: 32,
      font: "DM Sans",
      size: 22,
      spacing: 1,
      weight: 400,
      align: "center",
      scale: 1,
    },
    {
      id: 2,
      type: "image",
      name: "Image",
      label: "logo.svg",
      x: 50,
      y: 67,
      scale: 1,
    },
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const artboard = $("#stamp-artboard");
const previewContainer = $("#three-preview");
const previewStatus = $("#three-preview-status");
const editorControls2D = $("#editor-controls-2d");
const editorControls3D = $("#editor-controls-3d");
const viewer = createViewer(previewContainer);
const pipeline = new Pipeline();
let hasFramedPreview = false;

createPipelineControls(viewer, pipeline);

pipeline.addEventListener("running", () => {
  previewStatus.hidden = false;
  previewStatus.textContent = "Building 3D preview…";
});

pipeline.addEventListener("result", () => {
  const result = pipeline.result;
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
  viewer.show({ stamp: null, clay: null });
  previewStatus.hidden = false;
  previewStatus.textContent = `Could not build 3D preview: ${pipeline.error?.message ?? "unknown error"}`;
});

function selectedElement() {
  return state.elements.find((element) => element.id === state.selectedId);
}

function hasElementType(type) {
  return state.elements.some((element) => element.type === type);
}

function logoPlaceholder() {
  return `
    <span class="design-logo-placeholder" aria-label="Logo placeholder">Logo</span>
  `;
}

function addResizeHandles(element) {
  if (element.id !== state.selectedId) return "";

  return `
    <span class="resize-handle handle-top-left"></span>
    <span class="resize-handle handle-top-right"></span>
    <span class="resize-handle handle-bottom-left"></span>
    <span class="resize-handle handle-bottom-right"></span>
  `;
}

function renderArtboard() {
  artboard.querySelectorAll(".design-element").forEach((item) => item.remove());

  state.elements.forEach((element) => {
    const item = document.createElement("div");

    item.dataset.elementId = element.id;
    item.tabIndex = 0;
    item.className = `design-element ${
      element.type === "image" ? "image-element" : ""
    } ${element.id === state.selectedId ? "selected" : ""}`;

    item.style.left = `${element.x}%`;
    item.style.top = `${element.y}%`;
    item.style.transform = `translate(-50%, -50%) scale(${element.scale ?? 1})`;

    if (element.type === "text") {
      item.style.fontFamily = element.font;
      item.style.fontSize = `${element.size}px`;
      item.style.letterSpacing = `${element.spacing}px`;
      item.style.fontWeight = element.weight;
      item.style.textAlign = element.align;

      item.innerHTML = `
        <span>${escapeHtml(element.text)}</span>
        ${addResizeHandles(element)}
      `;
    } else {
      item.innerHTML = element.src
        ? `
          <img src="${element.src}" alt="${element.label}" />
          ${addResizeHandles(element)}
        `
        : `
          ${logoPlaceholder()}
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
  });
}

function render() {
  renderArtboard();
  updateControls();
  updateDimensions();
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

function updateFontPicker(element) {
  const preview = fontPreviewText(element.text);

  $("#font-current-name").textContent = element.font;
  $("#font-current-preview").textContent = preview;
  $("#font-current-preview").style.fontFamily = element.font;

  $$(".font-option").forEach((option) => {
    const isActive = option.dataset.font === element.font;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-pressed", String(isActive));

    const optionPreview = option.querySelector(".font-option-preview");
    optionPreview.textContent = preview;
    optionPreview.style.fontFamily = option.dataset.font;
  });
}

function addFontOption(fontName) {
  const option = document.createElement("button");
  const name = document.createElement("span");
  const preview = document.createElement("span");
  const check = document.createElement("span");

  option.type = "button";
  option.className = "dropdown-item font-option";
  option.dataset.font = fontName;

  name.className = "font-option-name";
  name.textContent = `${fontName} · Custom`;

  preview.className = "font-option-preview";
  preview.textContent = fontPreviewText(selectedElement()?.text ?? "Your text");
  preview.style.fontFamily = fontName;

  check.className = "font-option-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";

  option.append(name, preview, check);
  $("#font-options").append(option);
}

function updateControls() {
  const element = selectedElement();
  const isText = element?.type === "text";
  const isImage = element?.type === "image";
  const hasText = hasElementType("text");
  const hasImage = hasElementType("image");

  $("#add-text").disabled = hasText;
  $("#add-image").disabled = hasImage;
  $("#add-text").title = hasText ? "Only one text element can be added" : "Add text";
  $("#add-image").title = hasImage ? "Only one image can be added" : "Add image";

  $("#text-controls").classList.toggle("d-none", !isText);
  $("#image-message").classList.toggle("d-none", !isImage);
  $("#replace-image").classList.toggle("d-none", !isImage);
  $("#delete-element").disabled = !element;

  if (!isText) return;

  $("#text-input").value = element.text;
  updateFontPicker(element);
  $("#font-size").value = element.size;
  $("#letter-spacing").value = element.spacing;
  $("#font-weight").value = element.weight;

  $("#font-size-value").textContent = `${element.size} px`;
  $("#letter-spacing-value").textContent = `${element.spacing} px`;
  $("#font-weight-value").textContent = weightLabel(element.weight);

  $$(".alignment-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.align === element.align);
  });
}

function weightLabel(weight) {
  if (weight <= 400) return "Regular";
  if (weight <= 600) return "Medium";
  if (weight <= 700) return "Bold";
  return "Heavy";
}

function updateDimensions() {
  state.height = Math.round(state.width * 0.75);

  $("#width-value").textContent = `${state.width} mm`;
  $("#thickness-value").textContent = `${state.thickness} mm`;
  $("#dimension-text").textContent = `${state.width} × ${state.height} mm`;
}

function updateSelectedText(property, value, fontFile = null) {
  const element = selectedElement();

  if (!element || element.type !== "text") return;

  element[property] = value;
  if (property === "font") element.fontFile = fontFile;
  render();
}

function selectElement(id) {
  state.selectedId = id;

  $$(".design-element").forEach((item) => {
    item.classList.toggle(
      "selected",
      Number(item.dataset.elementId) === state.selectedId,
    );
  });

  updateControls();
}

function startDrag(event) {
  event.preventDefault();

  const item = event.currentTarget;
  const id = Number(item.dataset.elementId);
  const element = state.elements.find((entry) => entry.id === id);

  if (!element) return;

  item.focus({ preventScroll: true });
  selectElement(id);
  item.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const bounds = artboard.getBoundingClientRect();

    element.x = Math.max(
      5,
      Math.min(95, ((moveEvent.clientX - bounds.left) / bounds.width) * 100),
    );

    element.y = Math.max(
      5,
      Math.min(95, ((moveEvent.clientY - bounds.top) / bounds.height) * 100),
    );

    item.style.left = `${element.x}%`;
    item.style.top = `${element.y}%`;
  };

  const stop = () => {
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
  const startScale = element.scale ?? 1;
  const handle = event.currentTarget;

  const resize = (moveEvent) => {
    const distance = Math.hypot(
      moveEvent.clientX - centerX,
      moveEvent.clientY - centerY,
    );
    const nextScale = startScale * (distance / Math.max(startDistance, 1));

    element.scale = Math.min(2.5, Math.max(0.45, nextScale));
    item.style.transform = `translate(-50%, -50%) scale(${element.scale})`;
  };

  const stop = () => {
    handle.removeEventListener("pointermove", resize);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    render();
  };

  handle.addEventListener("pointermove", resize);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

$("#add-text").addEventListener("click", () => {
  if (hasElementType("text")) return;

  const id = Date.now();

  state.elements.push({
    id,
    type: "text",
    name: "Text 1",
    text: "NEW TEXT",
    x: 50,
    y: 50,
    font: "DM Sans",
    size: 20,
    spacing: 1,
    weight: 600,
    align: "center",
    scale: 1,
  });

  state.selectedId = id;
  render();
});

$("#add-image").addEventListener("click", () => {
  if (hasElementType("image")) return;
  $("#image-upload").click();
});

$("#replace-image").addEventListener("click", () => {
  $("#image-upload").click();
});

$("#image-upload").addEventListener("change", (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const currentElement = selectedElement();

  if (currentElement?.type === "image") {
    currentElement.label = file.name;
    currentElement.src = URL.createObjectURL(file);
  } else {
    const id = Date.now();

    state.elements.push({
      id,
      type: "image",
      name: "Image",
      label: file.name,
      src: URL.createObjectURL(file),
      x: 50,
      y: 50,
      scale: 1,
    });

    state.selectedId = id;
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

    addFontOption(fontName);
    updateSelectedText("font", fontName, /\.(ttf|otf)$/i.test(file.name) ? file : null);
  } catch {
    alert("That font could not be loaded. Try a TTF, OTF, WOFF, or WOFF2 file.");
  }

  event.target.value = "";
});

function deleteSelectedElement() {
  const element = selectedElement();

  if (!element) return;

  state.elements = state.elements.filter(
    (element) => element.id !== state.selectedId,
  );

  state.selectedId = state.elements[0]?.id ?? null;
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
  updateSelectedText("text", event.target.value);
});

$("#font-options").addEventListener("click", (event) => {
  const option = event.target.closest(".font-option");

  if (!option) return;
  updateSelectedText("font", option.dataset.font);
});

$("#font-size").addEventListener("input", (event) => {
  updateSelectedText("size", Number(event.target.value));
});

$("#letter-spacing").addEventListener("input", (event) => {
  updateSelectedText("spacing", Number(event.target.value));
});

$("#font-weight").addEventListener("input", (event) => {
  updateSelectedText("weight", Number(event.target.value));
});

$$("#editor-controls-2d [data-align]").forEach((button) => {
  button.addEventListener("click", () => {
    updateSelectedText("align", button.dataset.align);
  });
});

$("#stamp-width").addEventListener("input", (event) => {
  state.width = Number(event.target.value);
  updateDimensions();
});

$("#base-thickness").addEventListener("input", (event) => {
  state.thickness = Number(event.target.value);
  updateDimensions();
});

$("#mirror-design").addEventListener("change", (event) => {
  state.mirror = event.target.checked;
  artboard.style.transform = state.mirror ? "scaleX(-1)" : "scaleX(1)";
});

$("#handle-select").addEventListener("change", (event) => {
  state.handle = event.target.value;
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
    $("#stamp-canvas").classList.toggle("preview-hidden", !show2D);
    previewContainer.classList.toggle("d-none", show2D);
    editorControls2D.hidden = !show2D;
    editorControls3D.hidden = show2D;

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
