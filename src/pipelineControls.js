// Binds the 3D sidebar controls to the application's shared processing pipeline.
import { enableDragResize } from "./resize.js";
import { export3MF, exportSTL } from "./exporters.js";
import { BUILT_IN_FONTS } from "./pipeline/fonts.js";
import { fontName, loadFont } from "./pipeline/text.js";

const SIZE_FIELDS = {
  size: "textSize",
  svgSize: "svgSize",
  pngSize: "pngSize",
  faceSize: "faceSize",
};

export function createPipelineControls(viewer, pipeline) {
  const dom = collectDOM();

  dom.fontSelect.replaceChildren(
    ...BUILT_IN_FONTS.map((font) => {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.label;
      return option;
    }),
  );

  syncControls(dom, pipeline);

  segmented(dom.sourceTabs, "kind", (kind) => {
    showSource(dom, kind);
    pipeline.setSource({ kind });
  });

  dom.textInput.addEventListener("input", () => {
    pipeline.setSource({ text: dom.textInput.value });
  });
  dom.fontSelect.addEventListener("change", () => {
    pipeline.setSource({ fontId: dom.fontSelect.value, fontFile: null });
    dom.fontNote.hidden = true;
  });
  bindNumber(dom.textSize, (size) => pipeline.setSource({ size }), 0.5);
  bindNumber(dom.letterSpacing, (letterSpacing) =>
    pipeline.setSource({ letterSpacing }),
  );
  bindNumber(
    dom.lineSpacing,
    (lineSpacing) => pipeline.setSource({ lineSpacing }),
    0.1,
  );
  segmented(dom.alignButtons, "align", (align) =>
    pipeline.setSource({ align }),
  );

  dom.fontUploadButton.addEventListener("click", () => dom.fontFile.click());
  dom.fontFile.addEventListener("change", async () => {
    const file = dom.fontFile.files[0];
    if (file === undefined) return;

    try {
      const font = await loadFont(file);
      dom.fontNote.hidden = false;
      dom.fontNote.textContent = `Using ${fontName(font)} from ${file.name}.`;
      pipeline.setSource({ fontFile: file });
      showStatus(dom, null);
    } catch (error) {
      showStatus(dom, `That font could not be read: ${error.message}`);
    }

    dom.fontFile.value = "";
  });

  const useSVG = (file) => {
    dom.svgNote.textContent =
      typeof file === "string"
        ? "Using the sample pear."
        : `Using ${file.name}.`;
    pipeline.setSource({ kind: "svg", svgFile: file });
    selectSegment(dom.sourceTabs, "kind", "svg");
    showSource(dom, "svg");
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
  bindNumber(dom.svgSize, (svgSize) => pipeline.setSource({ svgSize }), 0.5);
  bindDropzone(dom.svgDrop, (file) => useSVG(file));

  const usePNG = (file) => {
    dom.pngNote.textContent = `Using ${file.name}.`;
    pipeline.setSource({ kind: "png", pngFile: file });
    selectSegment(dom.sourceTabs, "kind", "png");
    showSource(dom, "png");
  };

  dom.pngDrop.addEventListener("click", () => dom.pngFile.click());
  dom.pngFile.addEventListener("change", () => {
    const file = dom.pngFile.files[0];
    if (file !== undefined) usePNG(file);
    dom.pngFile.value = "";
  });
  bindNumber(dom.pngSize, (pngSize) => pipeline.setSource({ pngSize }), 0.5);
  dom.pngSmoothing.addEventListener("input", () => {
    const pngSmoothing = Number(dom.pngSmoothing.value);
    dom.pngSmoothingReadout.textContent =
      pngSmoothing === 0 ? "Off" : `${pngSmoothing}×`;
    pipeline.setSource({ pngSmoothing });
  });
  bindDropzone(dom.pngDrop, (file) => usePNG(file));

  segmented(dom.faceShape, "shape", (faceShape) =>
    pipeline.setStamp({ faceShape }),
  );
  dom.autoFace.addEventListener("change", () => {
    dom.faceSize.disabled = dom.autoFace.checked;
    pipeline.setStamp({ autoFaceSize: dom.autoFace.checked });
  });
  bindNumber(dom.faceSize, (faceSize) => pipeline.setStamp({ faceSize }), 1);
  bindNumber(
    dom.faceThickness,
    (faceThickness) => pipeline.setStamp({ faceThickness }),
    0.2,
  );
  bindNumber(dom.margin, (margin) => pipeline.setStamp({ margin }), 0);

  segmented(dom.reliefMode, "mode", (mode) => pipeline.setStamp({ mode }));
  dom.reliefDepth.addEventListener("input", () => {
    const reliefDepth = Number(dom.reliefDepth.value);
    dom.reliefReadout.textContent = `${reliefDepth} mm`;
    pipeline.setStamp({ reliefDepth });
  });
  dom.mirror.addEventListener("change", () => {
    pipeline.setStamp({ mirror: dom.mirror.checked });
  });
  dom.handleSelect.addEventListener("change", () => {
    pipeline.setStamp({ handle: dom.handleSelect.value });
  });

  dom.exportSTL.addEventListener("click", () =>
    run(dom, () => {
      exportSTL(exportable(viewer, pipeline), "clayster-stamp.stl");
      return "Exported the stamp as STL.";
    }),
  );
  dom.export3MF.addEventListener("click", () =>
    run(dom, () => {
      export3MF(exportable(viewer, pipeline), "clayster-stamp.3mf");
      return "Exported the stamp as 3MF.";
    }),
  );

  dom.exportSTL.disabled = dom.export3MF.disabled = true;
  pipeline.addEventListener("running", () => {
    dom.exportSTL.disabled = dom.export3MF.disabled = true;
  });
  pipeline.addEventListener("result", () => {
    const disabled = !pipeline.result?.stamp;
    dom.exportSTL.disabled = dom.export3MF.disabled = disabled;
  });
  pipeline.addEventListener("failed", () => {
    dom.exportSTL.disabled = dom.export3MF.disabled = true;
  });

  enableDragResize(viewer, pipeline, {
    onSize: (millimetres) => {
      const input = dom[SIZE_FIELDS[pipeline.sizeDriver.field]];
      if (input !== undefined) input.value = String(round1(millimetres));
    },
  });
}

function syncControls(dom, pipeline) {
  const source = pipeline.source;
  const stamp = pipeline.stamp;

  dom.textInput.value = source.text;
  dom.fontSelect.value = source.fontId;
  dom.textSize.value = source.size;
  dom.letterSpacing.value = source.letterSpacing;
  dom.lineSpacing.value = source.lineSpacing;
  dom.svgSize.value = source.svgSize;
  dom.pngSize.value = source.pngSize;
  dom.pngSmoothing.value = source.pngSmoothing;
  dom.pngSmoothingReadout.textContent = `${source.pngSmoothing}×`;

  dom.autoFace.checked = stamp.autoFaceSize;
  dom.faceSize.value = stamp.faceSize;
  dom.faceSize.disabled = stamp.autoFaceSize;
  dom.faceThickness.value = stamp.faceThickness;
  dom.margin.value = stamp.margin;
  dom.reliefDepth.value = stamp.reliefDepth;
  dom.reliefReadout.textContent = `${stamp.reliefDepth} mm`;
  dom.mirror.checked = stamp.mirror;
  dom.handleSelect.value = stamp.handle;

  selectSegment(dom.sourceTabs, "kind", source.kind);
  selectSegment(dom.alignButtons, "align", source.align);
  selectSegment(dom.faceShape, "shape", stamp.faceShape);
  selectSegment(dom.reliefMode, "mode", stamp.mode);
  showSource(dom, source.kind);
}

function showSource(dom, kind) {
  dom.textSource.hidden = kind !== "text";
  dom.svgSource.hidden = kind !== "svg";
  dom.pngSource.hidden = kind !== "png";
}

function segmented(container, attribute, onChange) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button === null || !container.contains(button)) return;

    selectSegment(container, attribute, button.dataset[attribute]);
    onChange(button.dataset[attribute]);
  });
}

function selectSegment(container, attribute, value) {
  for (const button of container.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset[attribute] === value);
  }
}

function bindNumber(input, onChange, min = -Infinity) {
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (input.value !== "" && Number.isFinite(value) && value >= min) {
      onChange(value);
    }
  });
}

function bindDropzone(dropzone, useFile) {
  for (const eventName of ["dragover", "dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.toggle("over", eventName === "dragover");

      const file = event.dataTransfer?.files?.[0];
      if (eventName === "drop" && file !== undefined) useFile(file);
    });
  }
}

function exportable(viewer, pipeline) {
  if (pipeline.busy) {
    throw new Error("Wait for the updated stamp before exporting.");
  }
  if (!pipeline.result?.stamp) {
    throw new Error("There is no stamp to export yet.");
  }

  return [
    {
      name: "Clayster stamp",
      color: viewer.stampMesh.material.color,
      geometry: pipeline.result.stamp,
    },
  ];
}

function run(dom, action) {
  try {
    showStatus(dom, action(), true);
  } catch (error) {
    showStatus(dom, error.message);
  }
}

function showStatus(dom, message, ok = false) {
  dom.status.hidden = !message;
  dom.status.textContent = message ?? "";
  dom.status.classList.toggle("ok", ok);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function collectDOM() {
  const byId = (id) => document.getElementById(id);
  return {
    sourceTabs: byId("pipeline-source-tabs"),
    textSource: byId("pipeline-text-source"),
    svgSource: byId("pipeline-svg-source"),
    pngSource: byId("pipeline-png-source"),
    textInput: byId("pipeline-text-input"),
    fontSelect: byId("pipeline-font-select"),
    fontUploadButton: byId("pipeline-font-upload-button"),
    fontFile: byId("pipeline-font-file"),
    fontNote: byId("pipeline-font-note"),
    textSize: byId("pipeline-text-size"),
    letterSpacing: byId("pipeline-letter-spacing"),
    lineSpacing: byId("pipeline-line-spacing"),
    alignButtons: byId("pipeline-align-buttons"),
    svgDrop: byId("pipeline-svg-drop"),
    svgFile: byId("pipeline-svg-file"),
    svgNote: byId("pipeline-svg-note"),
    svgSample: byId("pipeline-svg-sample"),
    svgSize: byId("pipeline-svg-size"),
    pngDrop: byId("pipeline-png-drop"),
    pngFile: byId("pipeline-png-file"),
    pngNote: byId("pipeline-png-note"),
    pngSize: byId("pipeline-png-size"),
    pngSmoothing: byId("pipeline-png-smoothing"),
    pngSmoothingReadout: byId("pipeline-png-smoothing-readout"),
    faceShape: byId("pipeline-face-shape"),
    autoFace: byId("pipeline-auto-face"),
    faceSize: byId("pipeline-face-size"),
    faceThickness: byId("pipeline-face-thickness"),
    margin: byId("pipeline-margin"),
    reliefMode: byId("pipeline-relief-mode"),
    reliefDepth: byId("pipeline-relief-depth"),
    reliefReadout: byId("pipeline-relief-readout"),
    mirror: byId("pipeline-mirror"),
    handleSelect: byId("pipeline-handle-select"),
    exportSTL: byId("pipeline-export-stl"),
    export3MF: byId("pipeline-export-3mf"),
    status: byId("pipeline-control-status"),
  };
}
