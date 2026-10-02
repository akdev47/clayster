// Renders authoritative pipeline results inside the 3D diagnostics sidebar.
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
};

export function createPipelineDiagnostics(pipeline) {
  const dom = collectDOM();

  pipeline.addEventListener("running", () => {
    setOverall(dom, "Building 3D stamp…", "working");
    renderRows(dom, [
      {
        level: "working",
        message: pipeline.diagnostics?.message ?? "Processing artwork and rebuilding geometry…",
      },
    ]);
    showSummary(dom, null);
    setExportReadiness(dom, "Building", "working");
  });

  pipeline.addEventListener("result", () => {
    const result = pipeline.result;
    const rows = [
      ...result.issues,
      ...result.notes.map((message) => ({
        level: "ok",
        badge: "Verified",
        message,
      })),
      ...diagnosticRows(pipeline.diagnostics),
    ];

    renderRows(dom, rows);
    showSummary(dom, result.info);

    const hasError =
      result.issues.some(({ level }) => level === "error") ||
      pipeline.diagnostics?.level === "error";
    const hasWarning =
      result.issues.some(({ level }) => level === "warning") ||
      pipeline.diagnostics?.level === "warning";
    const ready = Boolean(result.stamp) && !hasError;

    if (!ready) {
      setOverall(dom, "Not ready to export", "error");
      setExportReadiness(dom, "Unavailable", "error");
    } else if (hasWarning) {
      setOverall(dom, "Ready with warnings", "warning");
      setExportReadiness(dom, "Ready", "ok");
    } else {
      setOverall(dom, "Ready to export", "ok");
      setExportReadiness(dom, "Ready", "ok");
    }
  });

  pipeline.addEventListener("failed", () => {
    const rows = diagnosticRows(pipeline.diagnostics);
    if (rows.length === 0) {
      rows.push({
        level: "error",
        message: `Could not build the stamp: ${pipeline.error?.message ?? "unknown error"}`,
      });
    }

    setOverall(dom, "Build failed", "error");
    renderRows(dom, rows);
    showSummary(dom, null);
    setExportReadiness(dom, "Unavailable", "error");
  });
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

function renderRows(dom, rows) {
  const shown =
    rows.length > 0
      ? rows
      : [{ level: "ok", message: "No validation issues reported." }];
  dom.list.replaceChildren(...shown.map(createRow));
}

function createRow(row) {
  const level = LEVELS[row.level] ?? LEVELS.warning;
  const item = document.createElement("div");
  item.className = "validation-row";

  const icon = document.createElement("span");
  icon.className = `status-icon ${level.iconClass}`;
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

  const badge = document.createElement("span");
  badge.className = `status-badge ${level.badgeClass}`;
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
