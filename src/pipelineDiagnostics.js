// Renders authoritative pipeline results inside the shared diagnostics sidebar.
import { format } from "./dimensions.js";

const LEVELS = {
  ok: {
    mark: "✓",
    badge: "Pass",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  fixed: {
    mark: "✓",
    badge: "Repaired",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  info: {
    mark: "i",
    badge: "Note",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  warning: {
    mark: "!",
    badge: "Warning",
    iconClass: "warning-icon",
    badgeClass: "warning-badge",
  },
  error: {
    mark: "×",
    badge: "Error",
    iconClass: "error-icon",
    badgeClass: "error-badge",
  },
  working: {
    mark: "…",
    badge: "Building",
    iconClass: "warning-icon",
    badgeClass: "warning-badge",
  },
  idle: {
    mark: "+",
    badge: "Start",
    iconClass: "idle-icon",
    badgeClass: "idle-badge",
  },
};

export function createPipelineDiagnostics(
  pipeline,
  {
    render = null,
    getOverflowElementIds = () => [],
    onFitToStamp = null,
  } = {},
) {
  const renderState =
    render ??
    ((state) =>
      renderDOM(collectDOM(), state, {
        getOverflowElementIds,
        onFitToStamp,
      }));
  let state = null;

  const publish = (phase) => {
    state = createPipelineDiagnosticState(pipeline, phase);
    // Failed stamp generation can still leave editable overflowing artwork.
    // Offer the same recovery action for Text, SVG and PNG in that case.
    if (phase === "failed" && getOverflowElementIds().length > 0) {
      state.rows.push({
        level: "warning",
        code: "artwork-overflow",
        message: "Some artwork extends beyond the usable stamp area.",
      });
    }
    renderState(state);
  };

  pipeline.addEventListener("running", () => publish("running"));
  pipeline.addEventListener("result", () => publish("result"));
  pipeline.addEventListener("failed", () => publish("failed"));

  return {
    get state() {
      return state;
    },
  };
}

/** Builds the one diagnostics presentation used by both the 2D and 3D views. */
export function createPipelineDiagnosticState(pipeline, phase) {
  if (phase === "running") {
    return {
      overall: { message: "Building stamp…", level: "working" },
      rows: [
        {
          level: "working",
          message:
            pipeline.diagnostics?.message ??
            "Processing artwork and rebuilding geometry…",
        },
      ],
      info: null,
      export: { label: "Building", level: "working", ready: false },
    };
  }

  if (phase === "failed") {
    const rows = [
      ...segmentationRows(pipeline.result?.segmentations),
      ...diagnosticRows(pipeline.diagnostics),
    ];
    if (rows.length === 0) {
      rows.push({
        level: "error",
        message: `Could not build the stamp: ${pipeline.error?.message ?? "unknown error"}`,
      });
    }
    return {
      overall: { message: "Build failed", level: "error" },
      rows,
      info: null,
      export: { label: "Unavailable", level: "error", ready: false },
    };
  }

  const result = pipeline.result;
  if (result === null || result === undefined) {
    throw new Error("A pipeline result event requires a current result.");
  }

  if (result.artwork?.length === 0 && result.issues?.length === 0) {
    return {
      overall: { message: "Add artwork to begin", level: "idle" },
      rows: [{ level: "idle", message: "Add text, SVG, or PNG to start your design." }],
      info: null,
      export: { label: "No design yet", level: "idle", ready: false },
    };
  }

  const issues = result.issues ?? [];
  const reviewRows = segmentationRows(result.segmentations);
  const rows = [
    ...reviewRows,
    ...issues
      .filter(
        (issue) =>
          !reviewRows.some(
            ({ sourceMessage, elementId }) =>
              issue.message === sourceMessage &&
              (issue.elementId === undefined || issue.elementId === elementId),
          ),
      )
      .map(issueRow),
    ...(result.notes ?? []).map((message) => ({
      level: "ok",
      badge: "Verified",
      message,
    })),
    ...diagnosticRows(pipeline.diagnostics),
  ];
  const hasError =
    issues.some(({ level }) => level === "error") ||
    pipeline.diagnostics?.level === "error";
  const hasWarning =
    issues.some(({ level }) => level === "warning") ||
    pipeline.diagnostics?.level === "warning";
  const ready = Boolean(result.stamp) && !hasError;

  if (!ready) {
    return {
      overall: { message: "Not ready to export", level: "error" },
      rows,
      info: result.info,
      export: { label: "Unavailable", level: "error", ready: false },
    };
  }
  if (hasWarning) {
    return {
      overall: { message: "Ready with warnings", level: "warning" },
      rows,
      info: result.info,
      export: { label: "Ready", level: "ok", ready: true },
    };
  }
  return {
    overall: { message: "Ready to export", level: "ok" },
    rows,
    info: result.info,
    export: { label: "Ready", level: "ok", ready: true },
  };
}

function issueRow(issue) {
  if (issue.elementId === undefined) return issue;
  const kind = issue.elementKind === undefined ? "" : ` (${issue.elementKind})`;
  return {
    ...issue,
    message: `Element "${issue.elementId}"${kind}: ${issue.message}`,
  };
}

function segmentationRows(segmentations = []) {
  return segmentations
    .filter(({ status }) => status === "needs-review")
    .map(({ elementId, elementKind, message }) => ({
      level: "info",
      badge: "Review",
      iconClass: "warning-icon",
      badgeClass: "warning-badge",
      elementId,
      sourceMessage: message,
      message:
        elementId === undefined
          ? message
          : `Element "${elementId}"${
              elementKind === undefined ? "" : ` (${elementKind})`
            }: ${message}`,
    }));
}

function diagnosticRows(diagnostics) {
  if (diagnostics === null) return [];
  return [
    {
      level: diagnostics.level,
      badge: diagnostics.level === "ok" ? "SVG" : undefined,
      message: diagnostics.message,
      details: diagnostics.details,
    },
  ];
}

function renderRows(dom, rows, actions) {
  const shown =
    rows.length > 0
      ? rows
      : [{ level: "ok", message: "No validation issues reported." }];
  dom.list.replaceChildren(...shown.map((row) => createRow(row, actions)));
}

function renderDOM(dom, state, actions) {
  setOverall(dom, state.overall.message, state.overall.level);
  renderRows(dom, state.rows, actions);
  showSummary(dom, state.info);
  setExportReadiness(dom, state.export.label, state.export.level);
}

function createRow(row, { getOverflowElementIds, onFitToStamp }) {
  const level = LEVELS[row.level] ?? LEVELS.warning;
  const item = document.createElement("div");
  item.className = "validation-row";

  const icon = document.createElement("span");
  icon.className = `status-icon ${row.iconClass ?? level.iconClass}`;
  icon.textContent = level.mark;

  const content = document.createElement("div");
  content.className = "validation-content";

  const message = document.createElement("span");
  message.textContent = row.message;
  content.append(message);

  for (const detail of row.details ?? []) {
    const text = document.createElement("small");
    text.textContent = detail;
    content.append(text);
  }

  if (row.code === "artwork-overflow" && onFitToStamp !== null) {
    for (const elementId of getOverflowElementIds()) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "suggestion-button";
      action.dataset.elementId = elementId;
      action.textContent = "Fit to stamp";
      action.setAttribute(
        "aria-label",
        `Fit element ${elementId} to stamp`,
      );
      action.addEventListener("click", () => onFitToStamp(elementId));
      content.append(action);
    }
  }

  const badge = document.createElement("span");
  badge.className = `status-badge ${row.badgeClass ?? level.badgeClass}`;
  badge.textContent = row.badge ?? level.badge;

  item.append(icon, content, badge);
  return item;
}

function setOverall(dom, message, levelName) {
  const level = LEVELS[levelName];
  dom.overall.textContent = message;
  dom.overall.className = `overall-status pipeline-overall-${levelName}`;
  dom.overallIcon.textContent = level.mark;
  dom.overallIcon.className = `print-heading-icon ${level.iconClass}`;
}

function setExportReadiness(dom, label, levelName) {
  const level = LEVELS[levelName];
  dom.exportIcon.textContent = level.mark;
  dom.exportIcon.className = `status-icon ${level.iconClass}`;
  dom.exportStatus.textContent = label;
  dom.exportStatus.className = `status-badge ${level.badgeClass}`;
}

function showSummary(dom, info) {
  if (info === null || info === undefined) {
    dom.totalX.textContent = "—";
    dom.totalY.textContent = "—";
    dom.totalZ.textContent = "—";
    dom.faceSize.textContent = "—";
    dom.triangleCount.textContent = "—";
    return;
  }

  dom.totalX.textContent = `${format(info.width)} mm`;
  dom.totalY.textContent = `${format(info.depth)} mm`;
  dom.totalZ.textContent = `${format(info.height)} mm`;
  dom.faceSize.textContent = `${format(info.faceSize)} mm`;
  dom.triangleCount.textContent = info.triangles.toLocaleString();
}

function collectDOM() {
  const byId = (id) => document.getElementById(id);
  return {
    overall: byId("pipeline-overall-status"),
    overallIcon: byId("pipeline-overall-icon"),
    list: byId("pipeline-diagnostic-list"),
    totalX: byId("pipeline-total-x"),
    totalY: byId("pipeline-total-y"),
    totalZ: byId("pipeline-total-z"),
    faceSize: byId("pipeline-summary-face-size"),
    triangleCount: byId("pipeline-triangle-count"),
    exportIcon: byId("pipeline-export-icon"),
    exportStatus: byId("pipeline-export-status"),
  };
}
