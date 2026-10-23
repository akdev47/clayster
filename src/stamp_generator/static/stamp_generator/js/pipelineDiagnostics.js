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
    onHighlightThinGlyphs = () => {},
  } = {},
) {
  const renderState =
    render ??
    ((state) =>
      renderDOM(collectDOM(), state, {
        getOverflowElementIds,
        onFitToStamp,
        onHighlightThinGlyphs,
      }));
  let state = null;

  const publish = (phase) => {
    // A replaced warning cannot keep stale glyphs highlighted.
    onHighlightThinGlyphs([]);
    state = createPipelineDiagnosticState(pipeline, phase);
    // Failed stamp generation can still leave editable overflowing artwork.
    // Offer the same recovery action for Text, SVG and PNG in that case.
    if (phase === "failed" && getOverflowElementIds().length > 0) {
      state.rows.push({
        level: "error",
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
      ...(pipeline.artworkPreview?.issues ?? []).map(issueRow),
      ...diagnosticRows(pipeline.diagnostics),
    ];
    const errorRow = rows.find(({ level }) => level === "error");
    if (errorRow && pipeline.error?.message) {
      errorRow.details = [...(errorRow.details ?? []), pipeline.error.message];
    } else if (!errorRow) {
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
      message: diagnostics.message,
      details: [
        ...(diagnostics.details ?? []),
        ...(diagnostics.stage ? [`Stage: ${diagnostics.stage}`] : []),
      ],
    },
  ];
}

function unprefixedMessage(message) {
  return message.replace(/^Element "[^"]+"(?: \([^)]+\))?:\s*/, "")
    .replace(/^(?:Warning|Note):\s*/, "");
}

// Presentation only: keep authoritative severities, messages and geometry on
// the pipeline result untouched. Unknown messages remain available in full.
export function presentDiagnosticRows(rows) {
  const unique = [];
  for (const row of rows) {
    const original = unprefixedMessage(row.message);
    const existing = unique.find((candidate) =>
      candidate.level === row.level && candidate.original === original &&
      (!candidate.elementId || !row.elementId || candidate.elementId === row.elementId));
    if (existing) {
      existing.details.push(...(row.details ?? []));
      existing.thinGlyphs ??= row.thinGlyphs;
      existing.elementId ??= row.elementId;
      existing.elementKind ??= row.elementKind;
      existing.code ??= row.code;
    } else {
      unique.push({ ...row, original, details: [...(row.details ?? [])] });
    }
  }
  const reported = new Set(unique.filter(({ level }) => level !== "ok")
    .map(({ original }) => original));
  const priority = { error: 0, warning: 1, working: 2, idle: 2, fixed: 3, info: 4, ok: 5 };
  return unique.map((row) => {
    let message = row.original;
    let suggestion;
    if (row.thinGlyphs?.length) {
      message = `Potentially thin letters: ${[...new Set(row.thinGlyphs.map(({ character }) => character))].join(", ")}.`;
      suggestion = "Try increasing Letter Thickness or Text Size.";
    } else if (/^\d+ shapes? looks? thinner than about/.test(message)) {
      message = "Some artwork details may be too thin to print.";
      suggestion = "Try increasing the artwork size or thickness.";
    } else if (/^The space between line \d+ and line \d+ is under about /.test(message)) {
      suggestion = "Try increasing Line Spacing or Letter Spacing.";
    } else if (row.code === "artwork-overflow") {
      message = "Artwork extends beyond the usable stamp area.";
    } else if (/^Wrapped onto (\d+) rows/.test(message)) {
      message = `Text wrapped onto ${message.match(/^Wrapped onto (\d+)/)[1]} lines.`;
    } else if (/^Merged overlapping and self-intersecting outlines/.test(message)) {
      message = "Overlapping outlines were cleaned up.";
    } else if (/^Separated \d+ isolated point/.test(message)) {
      message = "Touching outlines were separated for printing.";
    } else if (/Stamp surface checks passed:/.test(message)) {
      message = "Stamp surface checks passed.";
    } else if (/^(?:Artwork is clean|Design processed successfully|SVG processed successfully)/.test(message)) {
      message = "Artwork checks passed.";
    } else if (row.level === "working") {
      message = "Checking your design…";
    } else if (row.level === "error") {
      message = message.replace(/^(?:Artwork conversion failed|SVG loading failed|Stamp preparation failed|Geometry generation failed|Stamp mesh validation failed|Design processing failed|SVG processing failed|Could not build the stamp):\s*/, "")
        .replace(/^Element "[^"]+" \([^)]+\) could not be converted:\s*/, "");
      if (/Recess depth must be smaller than the backing thickness/.test(message)) {
        message = "Recess depth must be smaller than the backing thickness.";
      } else if (/no (?:usable filled|closed) outlines|produced no closed outlines/i.test(message)) {
        message = "No filled artwork found. Use closed, filled shapes.";
      } else if (/non-manifold|open edges|inconsistent.*edges|mesh validation failed/i.test(message)) {
        message = "The stamp surface could not be built safely.";
      } else if (/could not be repaired safely|ambiguous point contact/i.test(message)) {
        message = "Some outlines need editing before they can be printed.";
      }
    }
    if (message.length > 160) message = `${message.slice(0, 157)}…`;
    const details = row.details.filter((detail) =>
      !reported.has(unprefixedMessage(detail)));
    if (message !== row.original) details.unshift(row.original);
    if (row.elementId) details.unshift(`Element "${row.elementId}"${row.elementKind ? ` (${row.elementKind})` : ""}`);
    return { ...row, message, suggestion, details: [...new Set(details)] };
  }).sort((a, b) => (priority[a.level] ?? 1) - (priority[b.level] ?? 1));
}

function renderRows(dom, rows, actions) {
  const shown = presentDiagnosticRows(
    rows.length > 0
      ? rows
      : [{ level: "ok", message: "No validation issues reported." }]);
  const visible = shown.filter(({ level }) => level !== "ok");
  const passed = shown.filter(({ level }) => level === "ok");
  const nodes = visible.map((row) => createRow(row, actions));
  if (passed.length > 0) {
    const checks = document.createElement("details");
    checks.className = "diagnostic-checks";
    const summary = document.createElement("summary");
    summary.textContent = `Checks passed (${passed.length})`;
    const content = document.createElement("div");
    content.append(...passed.map((row) => createRow(row, actions)));
    checks.append(summary, content);
    nodes.push(checks);
  }
  dom.list.replaceChildren(...nodes);
}

function renderDOM(dom, state, actions) {
  setOverall(dom, state.overall.message, state.overall.level);
  renderRows(dom, state.rows, actions);
  showSummary(dom, state.info);
  setExportReadiness(dom, state.export.label, state.export.level);
}

function createRow(row, { getOverflowElementIds, onFitToStamp, onHighlightThinGlyphs }) {
  const level = LEVELS[row.level] ?? LEVELS.warning;
  const item = document.createElement("div");
  item.className = `validation-row validation-row-${row.level}`;
  if (row.level === "warning" && row.elementKind === "text" && row.thinGlyphs?.length) {
    item.tabIndex = 0;
    let hovered = false;
    let focused = false;
    const highlight = () => onHighlightThinGlyphs(hovered || focused ? row.thinGlyphs : []);
    item.addEventListener("mouseenter", () => { hovered = true; highlight(); });
    item.addEventListener("mouseleave", () => { hovered = false; highlight(); });
    item.addEventListener("focusin", () => { focused = true; highlight(); });
    item.addEventListener("focusout", (event) => {
      if (event.relatedTarget && item.contains(event.relatedTarget)) return;
      focused = false;
      highlight();
    });
  }

  const icon = document.createElement("span");
  icon.className = `status-icon ${row.iconClass ?? level.iconClass}`;
  icon.textContent = level.mark;

  const content = document.createElement("div");
  content.className = "validation-content";

  const message = document.createElement("span");
  message.textContent = row.message;
  content.append(message);

  if (row.suggestion) {
    const suggestion = document.createElement("small");
    suggestion.textContent = row.suggestion;
    content.append(suggestion);
  }
  if (row.details?.length) {
    const details = document.createElement("details");
    details.className = "diagnostic-details";
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const information = document.createElement("div");
    for (const detail of row.details) {
      const text = document.createElement("small");
      text.textContent = detail;
      information.append(text);
    }
    details.append(summary, information);
    content.append(details);
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
        "Fix this issue by fitting the artwork inside the stamp",
      );
      action.title = "Automatically resize this artwork to fit inside the stamp";
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
