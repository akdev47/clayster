// Connects page inputs to the pipeline, then sends results to the viewer and status panel.
import { exportSTL, export3MF } from "./exporters.js";
import { format } from "./dimensions.js";
import { BUILT_IN_FONTS, DEFAULT_FONT_ID } from "./pipeline/fonts.js";
import { fontName, loadFont } from "./pipeline/text.js";
import { enableDragResize } from "./resize.js";

const $ = (id) => document.getElementById(id);

const MARKS = { ok: "✓", fixed: "✓", warning: "!", error: "✕" };

const DRAG_HINT = "Drag the stamp to resize it";

// Which panel field a resize drag is really editing, so it can follow along.
const SIZE_FIELDS = {
  size: "textSize",
  svgSize: "svgSize",
  pngSize: "pngSize",
  faceSize: "faceSize",
};

export function createUI(viewer, pipeline) {
  const dom = collectDOM();
  let view = "both";

  // --- step 1: artwork ---------------------------------------------------

  dom.fontSelect.replaceChildren(
    ...BUILT_IN_FONTS.map((font) => {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.label;
      return option;
    }),
  );
  dom.fontSelect.value = DEFAULT_FONT_ID;

  segmented(dom.sourceTabs, "kind", (kind) => {
    dom.textSource.hidden = kind !== "text";
    dom.svgSource.hidden = kind !== "svg";
    dom.pngSource.hidden = kind !== "png";
    pipeline.setSource({ kind });
  });

  bind(dom.textInput, "input", () =>
    pipeline.setSource({ text: dom.textInput.value }),
  );
  bind(dom.fontSelect, "change", () =>
    pipeline.setSource({
      fontId: dom.fontSelect.value,
      fontFile: null, // A built-in choice replaces an uploaded face.
    }),
  );

  number(dom.textSize, (size) => pipeline.setSource({ size }), { min: 0.5 });
  number(dom.letterSpacing, (letterSpacing) =>
    pipeline.setSource({ letterSpacing }),
  );
  number(
    dom.lineSpacing,
    (lineSpacing) => pipeline.setSource({ lineSpacing }),
    { min: 0.1 },
  );

  segmented(dom.alignButtons, "align", (align) =>
    pipeline.setSource({ align }),
  );

  dom.fontUploadButton.addEventListener("click", () => dom.fontFile.click());
  dom.fontFile.addEventListener("change", async () => {
    const file = dom.fontFile.files[0];
    if (file === undefined) return;

    // Parse it here so a bad file is reported against the picker rather
    // than surfacing later as a failed build.
    try {
      const font = await loadFont(file);
      dom.fontNote.hidden = false;
      dom.fontNote.textContent = `Using ${fontName(font)} from ${file.name}.`;
      pipeline.setSource({ fontFile: file });
    } catch (error) {
      status(`That font could not be read: ${error.message}`, false);
    }

    dom.fontFile.value = "";
  });

  const useSVG = (file) => {
    dom.svgNote.textContent =
      typeof file === "string"
        ? "Using the sample pear."
        : `Using ${file.name}.`;
    pipeline.setSource({ kind: "svg", svgFile: file });
  };

  dom.svgDrop.addEventListener("click", () => dom.svgFile.click());
  dom.svgFile.addEventListener("change", () => {
    const file = dom.svgFile.files[0];
    if (file !== undefined) useSVG(file);
    dom.svgFile.value = "";
  });

  dom.svgSample.addEventListener("click", () =>
    useSVG("./svg-images/pear.svg"),
  );
  number(dom.svgSize, (svgSize) => pipeline.setSource({ svgSize }), {
    min: 0.5,
  });

  for (const [event, over] of [
    ["dragover", true],
    ["dragleave", false],
    ["drop", false],
  ]) {
    dom.svgDrop.addEventListener(event, (dropEvent) => {
      dropEvent.preventDefault();
      dom.svgDrop.classList.toggle("over", over);

      const file = dropEvent.dataTransfer?.files?.[0];
      if (event === "drop" && file !== undefined) useSVG(file);
    });
  }

  const usePNG = (file) => {
    dom.pngNote.textContent = `Using ${file.name}.`;
    pipeline.setSource({ kind: "png", pngFile: file });
  };

  dom.pngDrop.addEventListener("click", () => dom.pngFile.click());
  dom.pngFile.addEventListener("change", () => {
    const file = dom.pngFile.files[0];
    if (file !== undefined) usePNG(file);
    dom.pngFile.value = "";
  });
  number(dom.pngSize, (pngSize) => pipeline.setSource({ pngSize }), {
    min: 0.5,
  });

  for (const [event, over] of [
    ["dragover", true],
    ["dragleave", false],
    ["drop", false],
  ]) {
    dom.pngDrop.addEventListener(event, (dropEvent) => {
      dropEvent.preventDefault();
      dom.pngDrop.classList.toggle("over", over);

      const file = dropEvent.dataTransfer?.files?.[0];
      if (event === "drop" && file !== undefined) usePNG(file);
    });
  }

  // --- step 3: stamp -----------------------------------------------------

  segmented(dom.faceShape, "shape", (faceShape) =>
    pipeline.setStamp({ faceShape }),
  );
  segmented(dom.reliefMode, "mode", (mode) => pipeline.setStamp({ mode }));

  dom.autoFace.addEventListener("change", () => {
    dom.faceSize.disabled = dom.autoFace.checked;
    pipeline.setStamp({ autoFaceSize: dom.autoFace.checked });
  });

  number(dom.faceSize, (faceSize) => pipeline.setStamp({ faceSize }), {
    min: 1,
  });
  number(
    dom.faceThickness,
    (faceThickness) => pipeline.setStamp({ faceThickness }),
    { min: 0.2 },
  );
  number(dom.margin, (margin) => pipeline.setStamp({ margin }), { min: 0 });

  dom.reliefDepth.addEventListener("input", () => {
    const reliefDepth = Number(dom.reliefDepth.value);
    dom.reliefReadout.textContent = `${reliefDepth} mm`;
    pipeline.setStamp({ reliefDepth });
  });

  dom.mirror.addEventListener("change", () =>
    pipeline.setStamp({ mirror: dom.mirror.checked }),
  );
  dom.handleSelect.addEventListener("change", () =>
    pipeline.setStamp({ handle: dom.handleSelect.value }),
  );

  // --- preview and export ------------------------------------------------

  enableDragResize(viewer, pipeline, {
    onSize: (millimetres, done) => {
      const input = dom[SIZE_FIELDS[pipeline.sizeDriver.field]];

      // Set the value directly rather than dispatching an input event:
      // the drag already drives the pipeline, and echoing it back would
      // schedule a second rebuild.
      if (input !== undefined) input.value = String(round1(millimetres));

      dom.dragHint.textContent = done ? DRAG_HINT : `${round1(millimetres)} mm`;
      dom.dragHint.classList.toggle("active", !done);
    },
  });

  segmented(dom.viewToggle, "view", (chosen) => {
    view = chosen;
    viewer.frame(view);
  });

  dom.exportSTL.addEventListener("click", () =>
    run(() => {
      exportSTL(exportable(), "clayster-stamp.stl");
      return "Exported the stamp as a binary STL.";
    }),
  );

  dom.export3MF.addEventListener("click", () =>
    run(() => {
      export3MF(exportable(), "clayster-stamp.3mf");
      return "Exported the stamp as 3MF, in millimetres.";
    }),
  );

  function exportable() {
    // Export the completed stamp only; the mug and temporary drag scale are previews.
    if (pipeline.busy)
      throw new Error("Wait for the updated stamp before exporting.");
    const stamp = pipeline.result?.stamp;
    if (!stamp) throw new Error("There is no stamp to export yet.");

    return [
      {
        name: "Clayster stamp",
        color: viewer.stampMesh.material.color,
        geometry: stamp,
      },
    ];
  }

  // --- pipeline events ---------------------------------------------------

  // Block downloads during a rebuild so edits cannot export the previous result.
  dom.exportSTL.disabled = dom.export3MF.disabled = true;
  pipeline.addEventListener("running", () => {
    dom.working.hidden = false;
    dom.exportSTL.disabled = dom.export3MF.disabled = true;
    showIssues([]); // Do not show the previous stamp's passing checks.
    showDiagnostics();
    if (pipeline.diagnostics !== null) status(null);
  });

  pipeline.addEventListener("result", () => {
    dom.working.hidden = true;

    const result = pipeline.result;
    dom.exportSTL.disabled = dom.export3MF.disabled = !result.stamp;
    viewer.show({ stamp: result.stamp, clay: result.clay });

    showIssues(result.issues, result.notes);
    showDiagnostics();
    showSummary(result.info);

    if (result.stamp !== null) status(null);
  });

  pipeline.addEventListener("failed", () => {
    dom.exportSTL.disabled = dom.export3MF.disabled = true;
    dom.working.hidden = true;
    viewer.show({ stamp: null, clay: null });
    showSummary(null);
    showDiagnostics();
    if (pipeline.diagnostics === null) {
      status(
        `Could not build the stamp: ${pipeline.error?.message ?? "unknown error"}`,
        false,
      );
    } else {
      status(null);
    }
  });

  function showIssues(issues, notes = []) {
    const rows = [
      ...issues,
      ...notes.map((message) => ({ level: "fixed", message })),
    ];

    dom.issueList.replaceChildren(
      ...rows.map((issue) => {
        const row = document.createElement("li");
        row.className = issue.level;

        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = MARKS[issue.level] ?? "•";

        const text = document.createElement("span");
        text.textContent = issue.message;

        row.append(mark, text);
        return row;
      }),
    );
  }

  function showDiagnostics() {
    const diagnostics = pipeline.diagnostics;
    dom.diagnostics.hidden = diagnostics === null;
    if (diagnostics === null) return;

    dom.diagnosticMessage.className = `diagnostic-message ${diagnostics.level}`;
    dom.diagnosticMessage.textContent = diagnostics.message;
    dom.diagnosticDetails.replaceChildren(
      ...diagnostics.details.map((message) => {
        const row = document.createElement("li");
        row.textContent = message;
        return row;
      }),
    );
  }

  function showSummary(info) {
    if (info === null || info === undefined) {
      dom.totalX.textContent =
        dom.totalY.textContent =
        dom.totalZ.textContent =
          "—";
      dom.triangleCount.textContent = "—";
      return;
    }

    dom.totalX.textContent = `${format(info.width)} mm`;
    dom.totalY.textContent = `${format(info.depth)} mm`;
    dom.totalZ.textContent = `${format(info.height)} mm`;
    dom.triangleCount.textContent = `${info.triangles.toLocaleString()} triangles · ${format(info.faceSize)} mm face`;
  }

  function run(action) {
    try {
      status(action(), true);
    } catch (error) {
      status(error.message, false);
    }
  }

  function status(message, ok) {
    dom.status.hidden = !message;
    dom.status.textContent = message ?? "";
    dom.status.classList.toggle("ok", Boolean(ok));
  }

  return { status, view: () => view };
}

// Wires a group of segmented buttons: highlights the clicked one and reports
// its data attribute.
function segmented(container, attribute, onChange) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button === null) return;

    for (const other of container.children) {
      other.classList.toggle("on", other === button);
    }

    onChange(button.dataset[attribute]);
  });
}

// Number inputs report every keystroke, including the empty string and a lone
// minus sign, so anything unusable is ignored rather than pushed down the
// pipeline.
function number(input, onChange, { min = -Infinity } = {}) {
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(value) || value < min)
      return;
    onChange(value);
  });
}

function bind(element, event, handler) {
  element.addEventListener(event, handler);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Keep HTML element IDs in one place so the event handlers stay readable.
function collectDOM() {
  return {
    sourceTabs: $("source-tabs"),
    textSource: $("text-source"),
    svgSource: $("svg-source"),
    pngSource: $("png-source"),
    textInput: $("text-input"),
    fontSelect: $("font-select"),
    fontUploadButton: $("font-upload-button"),
    fontFile: $("font-file"),
    fontNote: $("font-note"),
    textSize: $("text-size"),
    letterSpacing: $("letter-spacing"),
    lineSpacing: $("line-spacing"),
    alignButtons: $("align-buttons"),
    svgDrop: $("svg-drop"),
    svgFile: $("svg-file"),
    svgNote: $("svg-note"),
    svgSample: $("svg-sample"),
    svgSize: $("svg-size"),
    pngDrop: $("png-drop"),
    pngFile: $("png-file"),
    pngNote: $("png-note"),
    pngSize: $("png-size"),
    issueList: $("issue-list"),
    diagnostics: $("diagnostics"),
    diagnosticMessage: $("diagnostic-message"),
    diagnosticDetails: $("diagnostic-details"),
    faceShape: $("face-shape"),
    autoFace: $("auto-face"),
    faceSize: $("face-size"),
    faceThickness: $("face-thickness"),
    margin: $("margin"),
    reliefMode: $("relief-mode"),
    reliefDepth: $("relief-depth"),
    reliefReadout: $("relief-readout"),
    mirror: $("mirror"),
    handleSelect: $("handle-select"),
    viewToggle: $("view-toggle"),
    working: $("working"),
    dragHint: $("drag-hint"),
    totalX: $("total-x"),
    totalY: $("total-y"),
    totalZ: $("total-z"),
    triangleCount: $("triangle-count"),
    exportSTL: $("export-stl"),
    export3MF: $("export-3mf"),
    status: $("status"),
  };
}
