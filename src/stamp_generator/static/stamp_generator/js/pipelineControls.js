// Binds shared stamp/export controls to the application's processing pipeline.
import { enableDragResize } from "./resize.js";
import { exportSTL } from "./exporters.js";

const SIZE_FIELDS = {
  elementScale: "elementScale",
  faceSize: "faceSize",
};

export function createPipelineControls(
  viewer,
  pipeline,
  { designControls = null } = {},
) {
  const dom = collectDOM();
  syncControls(dom, pipeline);

  segmented(dom.faceShape, "shape", (faceShape) =>
    pipeline.setStamp({ faceShape }),
  );
  dom.autoFace.addEventListener("change", () => {
    dom.faceSize.disabled = dom.faceSizeRange.disabled = dom.autoFace.checked;
    pipeline.setStamp({ autoFaceSize: dom.autoFace.checked });
  });
  bindNumber(
    dom.faceSize,
    (value) => {
      const faceSize = Math.min(120, value);
      if (faceSize !== value) dom.faceSize.value = String(faceSize);
      dom.faceSizeRange.value = String(faceSize);
      pipeline.setStamp({ faceSize });
    },
    10,
  );
  dom.faceSizeRange.addEventListener("input", () => {
    const faceSize = Number(dom.faceSizeRange.value);
    dom.faceSize.value = String(faceSize);
    pipeline.setStamp({ faceSize });
  });
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
  dom.exportSTL.disabled = true;
  pipeline.addEventListener("running", () => {
    dom.exportSTL.disabled = true;
  });
  pipeline.addEventListener("result", () => {
    dom.exportSTL.disabled = !pipeline.result?.stamp;
  });
  pipeline.addEventListener("failed", () => {
    dom.exportSTL.disabled = true;
  });

  const resizeTarget = createResizeTarget(pipeline, designControls);
  enableDragResize(viewer, resizeTarget, {
    onSize: (value) => {
      const input = dom[SIZE_FIELDS[resizeTarget.sizeDriver.field]];
      if (input !== undefined) input.value = String(round1(value));
      if (input === dom.faceSize) dom.faceSizeRange.value = String(round1(value));
    },
  });
}

function syncControls(dom, pipeline) {
  const stamp = pipeline.stamp;

  dom.autoFace.checked = stamp.autoFaceSize;
  dom.faceSize.value = dom.faceSizeRange.value = stamp.faceSize;
  dom.faceSize.disabled = dom.faceSizeRange.disabled = stamp.autoFaceSize;
  dom.faceThickness.value = stamp.faceThickness;
  dom.margin.value = stamp.margin;
  dom.reliefDepth.value = stamp.reliefDepth;
  dom.reliefReadout.textContent = `${stamp.reliefDepth} mm`;
  dom.mirror.checked = stamp.mirror;
  dom.handleSelect.value = stamp.handle;

  selectSegment(dom.faceShape, "shape", stamp.faceShape);
  selectSegment(dom.reliefMode, "mode", stamp.mode);
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

export function exportable(viewer, pipeline) {
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

function createResizeTarget(pipeline, designControls) {
  return {
    get sizeDriver() {
      const selected = designControls?.selectedElement();
      if (!pipeline.stamp.autoFaceSize || selected === null) {
        return { field: "faceSize", value: pipeline.stamp.faceSize };
      }
      return { field: "elementScale", value: selected.transform.scale };
    },

    applySize(value) {
      const { field } = this.sizeDriver;
      if (field === "faceSize") {
        const faceSize = clamp(value, 1, 400);
        pipeline.setStamp({ faceSize });
        return faceSize;
      }

      const scale = clamp(value, 0.05, 20);
      designControls.updateSelectedTransform({ scale });
      return scale;
    },
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function collectDOM() {
  const byId = (id) => document.getElementById(id);
  return {
    elementScale: byId("element-scale"),
    faceShape: byId("pipeline-face-shape"),
    autoFace: byId("pipeline-auto-face"),
    faceSize: byId("pipeline-face-size"),
    faceSizeRange: byId("pipeline-face-size-range"),
    faceThickness: byId("pipeline-face-thickness"),
    margin: byId("pipeline-margin"),
    reliefMode: byId("pipeline-relief-mode"),
    reliefDepth: byId("pipeline-relief-depth"),
    reliefReadout: byId("pipeline-relief-readout"),
    mirror: byId("pipeline-mirror"),
    handleSelect: byId("pipeline-handle-select"),
    exportSTL: byId("pipeline-export-stl"),
    status: byId("pipeline-control-status"),
  };
}
