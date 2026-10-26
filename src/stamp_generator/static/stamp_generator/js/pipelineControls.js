// Binds shared stamp/export controls to the application's processing pipeline.
import { exportSTL } from "./exporters.js";
import {
  DEFAULT_STAMP,
  FACE_SIZE_LIMITS,
  FACE_THICKNESS_LIMITS,
} from "./pipeline/stamp.js";
import {
  MIN_STAMP_MARGIN_MM,
  stampFaceSize,
  stampMargin,
  stampMarginMaximum,
} from "./pipeline/stampLayout.js";

export function createPipelineControls(viewer, pipeline) {
  const dom = collectDOM();
  syncControls(dom, pipeline);

  segmented(dom.faceShape, "shape", (faceShape) => {
    pipeline.setStamp({ faceShape });
    syncFaceSizeField(dom, pipeline);
    syncFaceSizeValues(dom, pipeline);
    syncRoundedCornersField(dom, pipeline);
  });
  bindNumber(
    dom.faceSize,
    (faceSize) => {
      pipeline.setStamp({ faceSize });
      syncFaceSizeValues(dom, pipeline);
      syncMarginControl(dom, pipeline);
    },
    FACE_SIZE_LIMITS.min,
    FACE_SIZE_LIMITS.max,
  );
  dom.faceSize.addEventListener("change", () => {
    commitFaceSize(dom, pipeline, "faceSize");
  });
  bindNumber(
    dom.faceHeight,
    (faceHeight) => {
      pipeline.setStamp({ faceHeight });
      syncFaceSizeValues(dom, pipeline);
      syncMarginControl(dom, pipeline);
    },
    FACE_SIZE_LIMITS.min,
    FACE_SIZE_LIMITS.max,
  );
  dom.faceHeight.addEventListener("change", () => {
    commitFaceSize(dom, pipeline, "faceHeight");
  });
  bindNumber(
    dom.faceThickness,
    (value) => {
      const faceThickness = clamp(
        value,
        FACE_THICKNESS_LIMITS.min,
        FACE_THICKNESS_LIMITS.max,
      );
      if (faceThickness !== value) {
        dom.faceThickness.value = String(faceThickness);
      }
      pipeline.setStamp({ faceThickness });
    },
    -Infinity,
  );
  dom.margin.addEventListener("input", () => {
    const margin = Number(dom.margin.value);
    if (
      dom.margin.value !== "" &&
      Number.isFinite(margin) &&
      margin >= MIN_STAMP_MARGIN_MM &&
      margin <= stampMarginMaximum(pipeline.stamp)
    ) {
      pipeline.setStamp({ margin });
    }
  });
  dom.margin.addEventListener("change", () => {
    const entered = Number(dom.margin.value);
    const margin = Number.isFinite(entered) && dom.margin.value !== ""
      ? stampMargin({ ...pipeline.stamp, margin: entered })
      : stampMargin(pipeline.stamp);
    dom.margin.value = String(margin);
    if (margin !== pipeline.stamp.margin) pipeline.setStamp({ margin });
  });

  segmented(dom.reliefMode, "mode", (mode) => pipeline.setStamp({ mode }));
  dom.reliefDepth.addEventListener("input", () => {
    const reliefDepth = Number(dom.reliefDepth.value);
    dom.reliefReadout.textContent = `${reliefDepth} mm`;
    pipeline.setStamp({ reliefDepth });
  });
  dom.mirror.addEventListener("change", () => {
    pipeline.setStamp({ mirror: dom.mirror.checked });
  });
  dom.roundedEdges.addEventListener("change", () => {
    pipeline.setStamp({ roundedEdges: dom.roundedEdges.checked });
  });
  dom.roundedCorners.addEventListener("change", () => {
    pipeline.setStamp({ roundedCorners: dom.roundedCorners.checked });
  });

  dom.exportSTL.addEventListener("click", () =>
    run(dom, async () => {
      const built = await pipeline.ensureSolids();
      if (!built) {
        throw new Error(pipeline.error?.message ?? "There is no stamp to export yet.");
      }
      exportSTL(exportable(viewer, pipeline), "clayster-stamp.stl");
      return "Exported the stamp as STL.";
    }),
  );
  dom.exportSTL.disabled = true;
  pipeline.addEventListener("running", () => {
    dom.exportSTL.disabled = true;
  });
  pipeline.addEventListener("result", () => {
    const canBuild =
      pipeline.result?.stamp || pipeline.result?.solidsDeferred;
    dom.exportSTL.disabled = !canBuild || hasBlockingIssue(pipeline);
    const layout = pipeline.result?.layout;
    dom.faceDimensions.textContent = layout
      ? `${layout.widthMm.toFixed(1)} × ${layout.heightMm.toFixed(1)} mm`
      : "—";
  });
  pipeline.addEventListener("failed", () => {
    dom.exportSTL.disabled = true;
    dom.faceDimensions.textContent = "—";
  });
}

function syncControls(dom, pipeline) {
  const stamp = pipeline.stamp;
  const face = stampFaceSize(stamp);

  dom.faceSize.value = face.width;
  dom.faceHeight.value = face.height;
  syncFaceSizeField(dom, pipeline);
  dom.faceThickness.value = stamp.faceThickness;
  syncMarginControl(dom, pipeline);
  dom.reliefDepth.value = stamp.reliefDepth;
  dom.reliefReadout.textContent = `${stamp.reliefDepth} mm`;
  dom.mirror.checked = stamp.mirror;
  dom.roundedEdges.checked = Boolean(stamp.roundedEdges ?? DEFAULT_STAMP.roundedEdges);
  dom.roundedCorners.checked = Boolean(stamp.roundedCorners);
  syncRoundedCornersField(dom, pipeline);

  selectSegment(dom.faceShape, "shape", stamp.faceShape);
  selectSegment(dom.reliefMode, "mode", stamp.mode);
}

function syncFaceSizeValues(dom, pipeline) {
  const face = stampFaceSize(pipeline.stamp);
  const active = globalThis.document?.activeElement;
  if (dom.faceSize !== active) dom.faceSize.value = String(face.width);
  if (dom.faceHeight !== active) dom.faceHeight.value = String(face.height);
}

function syncFaceSizeField(dom, pipeline) {
  const hidden = pipeline.stamp.faceShape === "minimal";
  dom.faceSizeField.hidden = hidden;
  dom.faceHeightField.hidden = hidden;
}

function commitFaceSize(dom, pipeline, field) {
  const input = field === "faceSize" ? dom.faceSize : dom.faceHeight;
  const current = stampFaceSize(pipeline.stamp);
  const fallback = field === "faceSize" ? current.width : current.height;
  const entered = Number(input.value);
  const value = Number.isFinite(entered) && input.value !== ""
    ? clamp(entered, FACE_SIZE_LIMITS.min, FACE_SIZE_LIMITS.max)
    : fallback;
  input.value = String(value);
  if (value !== fallback || !Number.isFinite(pipeline.stamp[field])) {
    pipeline.setStamp({ [field]: value });
  }
  syncFaceSizeValues(dom, pipeline);
  syncMarginControl(dom, pipeline);
}

function syncRoundedCornersField(dom, pipeline) {
  dom.roundedCornersField.hidden = pipeline.stamp.faceShape === "round";
}

function syncMarginControl(dom, pipeline) {
  dom.margin.max = String(stampMarginMaximum(pipeline.stamp));
  dom.margin.value = String(stampMargin(pipeline.stamp));
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

function bindNumber(input, onChange, min = -Infinity, max = Infinity) {
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (
      input.value !== "" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
    ) {
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
  if (hasBlockingIssue(pipeline)) {
    throw new Error("Fix the design errors before exporting.");
  }

  return [
    {
      name: "Clayster stamp",
      color: viewer.stampMesh.material.color,
      geometry: pipeline.result.stamp,
    },
  ];
}

function hasBlockingIssue(pipeline) {
  return (
    pipeline.result?.issues?.some(({ level }) => level === "error") ||
    pipeline.diagnostics?.level === "error"
  );
}

function run(dom, action) {
  Promise.resolve()
    .then(action)
    .then((message) => showStatus(dom, message, true))
    .catch((error) => showStatus(dom, error.message));
}

function showStatus(dom, message, ok = false) {
  dom.status.hidden = !message;
  dom.status.textContent = message ?? "";
  dom.status.classList.toggle("ok", ok);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function collectDOM() {
  const byId = (id) => document.getElementById(id);
  return {
    faceShape: byId("pipeline-face-shape"),
    faceSize: byId("pipeline-face-size"),
    faceSizeField: byId("pipeline-face-size-field"),
    faceHeight: byId("pipeline-face-height"),
    faceHeightField: byId("pipeline-face-height-field"),
    faceDimensions: byId("pipeline-face-dimensions"),
    faceThickness: byId("pipeline-face-thickness"),
    margin: byId("pipeline-margin"),
    reliefMode: byId("pipeline-relief-mode"),
    reliefDepth: byId("pipeline-relief-depth"),
    reliefReadout: byId("pipeline-relief-readout"),
    mirror: byId("pipeline-mirror"),
    roundedEdges: byId("pipeline-rounded-edges"),
    roundedCorners: byId("pipeline-rounded-corners"),
    roundedCornersField: byId("pipeline-rounded-corners-field"),
    exportSTL: byId("pipeline-export-stl"),
    status: byId("pipeline-control-status"),
  };
}
