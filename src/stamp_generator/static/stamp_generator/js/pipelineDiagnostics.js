// Renders authoritative pipeline results inside the shared diagnostics sidebar.
import { format } from "./dimensions.js";
import { ELEMENT_KIND_LABELS, LOCALE } from "./locale.js";
import { stageLabel } from "./pipeline/stages.js";

const LEVELS = {
  ok: {
    mark: "✓",
    badge: "In orde",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  fixed: {
    mark: "✓",
    badge: "Hersteld",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  info: {
    mark: "i",
    badge: "Opmerking",
    iconClass: "pass-icon",
    badgeClass: "pass-badge",
  },
  warning: {
    mark: "!",
    badge: "Waarschuwing",
    iconClass: "warning-icon",
    badgeClass: "warning-badge",
  },
  error: {
    mark: "×",
    badge: "Fout",
    iconClass: "error-icon",
    badgeClass: "error-badge",
  },
  working: {
    mark: "…",
    badge: "Bezig",
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
        message: "Een deel van het ontwerp valt buiten het bruikbare stempelvlak.",
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
      overall: { message: "Stempel wordt berekend…", level: "working" },
      rows: [
        {
          level: "working",
          message:
            pipeline.diagnostics?.message ??
            "Ontwerp verwerken en geometrie opnieuw opbouwen…",
        },
      ],
      info: null,
      export: { label: "Bezig", level: "working", ready: false },
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
        message: `De stempel kon niet worden opgebouwd: ${pipeline.error?.message ?? "onbekende fout"}`,
      });
    }
    return {
      overall: { message: "Opbouwen mislukt", level: "error" },
      rows,
      info: null,
      export: { label: "Niet beschikbaar", level: "error", ready: false },
    };
  }

  const result = pipeline.result;
  if (result === null || result === undefined) {
    throw new Error("A pipeline result event requires a current result.");
  }

  if (result.artwork?.length === 0 && result.issues?.length === 0) {
    return {
      overall: { message: "Voeg een ontwerp toe om te beginnen", level: "idle" },
      rows: [{ level: "idle", message: "Voeg tekst, een SVG of een PNG toe om met je ontwerp te beginnen." }],
      info: null,
      export: { label: "Nog geen ontwerp", level: "idle", ready: false },
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
      badge: "Gecontroleerd",
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

  // A 2D edit publishes the face without a mesh. That is a finished design,
  // and the stamp is built when 3D, review, or export needs it.
  if (!result.stamp && result.solidsDeferred && !hasError) {
    return {
      overall: {
        message: hasWarning ? "Ontwerp klaar, met waarschuwingen" : "Ontwerp klaar",
        level: hasWarning ? "warning" : "ok",
      },
      rows,
      info: result.info,
      export: { label: "Op aanvraag", level: "info", ready: false },
    };
  }

  if (!ready) {
    return {
      overall: { message: "Nog niet klaar om te bestellen", level: "error" },
      rows,
      info: result.info,
      export: { label: "Niet beschikbaar", level: "error", ready: false },
    };
  }
  if (hasWarning) {
    return {
      overall: { message: "Klaar, met waarschuwingen", level: "warning" },
      rows,
      info: result.info,
      export: { label: "Klaar", level: "ok", ready: true },
    };
  }
  return {
    overall: { message: "Klaar om te bestellen", level: "ok" },
    rows,
    info: result.info,
    export: { label: "Klaar", level: "ok", ready: true },
  };
}

function issueRow(issue) {
  if (issue.elementId === undefined) return issue;
  const kind = issue.elementKind === undefined ? "" : ` (${kindLabel(issue.elementKind)})`;
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
      badge: "Controleren",
      iconClass: "warning-icon",
      badgeClass: "warning-badge",
      elementId,
      sourceMessage: message,
      message:
        elementId === undefined
          ? message
          : `Element "${elementId}"${
              elementKind === undefined ? "" : ` (${kindLabel(elementKind)})`
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
        ...(diagnostics.stage ? [`Fase: ${stageLabel(diagnostics.stage)}`] : []),
      ],
    },
  ];
}

const kindLabel = (kind) => ELEMENT_KIND_LABELS[kind] ?? kind;

function unprefixedMessage(message) {
  return message.replace(/^Element "[^"]+"(?: \([^)]+\))?:\s*/, "")
    .replace(/^(?:Waarschuwing|Opmerking):\s*/, "");
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
      message = `Mogelijk te dunne letters: ${[...new Set(row.thinGlyphs.map(({ character }) => character))].join(", ")}.`;
      suggestion = "Maak de letterdikte of de tekstgrootte groter.";
    } else if (/^\d+ vorm(?:en)? lijk(?:t|en) dunner dan ongeveer/.test(message)) {
      message = "Sommige details van het ontwerp zijn mogelijk te dun om te printen.";
      suggestion = "Maak het ontwerp groter of dikker.";
    } else if (/^De ruimte tussen regel \d+ en regel \d+ is kleiner dan ongeveer /.test(message)) {
      suggestion = "Vergroot de regelafstand of de letterafstand.";
    } else if (row.code === "artwork-overflow") {
      message = "Het ontwerp valt buiten het bruikbare stempelvlak.";
    } else if (/^Overlappende en zichzelf snijdende omtrekken/.test(message)) {
      message = "Overlappende omtrekken zijn opgeschoond.";
    } else if (/^Losse puntcontacten gescheiden/.test(message)) {
      message = "Rakende omtrekken zijn gescheiden voor het printen.";
    } else if (/^Stempeloppervlak gecontroleerd:/.test(message)) {
      message = "Stempeloppervlak gecontroleerd.";
    } else if (/^(?:Het ontwerp is schoon|Ontwerp succesvol verwerkt|SVG succesvol verwerkt)/.test(message)) {
      message = "Controles van het ontwerp geslaagd.";
    } else if (row.level === "working") {
      message = "Je ontwerp wordt gecontroleerd…";
    } else if (row.level === "error") {
      message = message.replace(/^(?:Omzetten van het ontwerp mislukt|Laden van de SVG mislukt|Voorbereiden van de stempel mislukt|Opbouwen van de geometrie mislukt|Controle van het stempeloppervlak mislukt|Verwerken van het ontwerp mislukt|Verwerken van de SVG mislukt|De stempel kon niet worden opgebouwd):\s*/, "")
        .replace(/^Element "[^"]+" \([^)]+\) kon niet worden omgezet:\s*/, "");
      if (/De reliëfdiepte moet kleiner zijn dan de basisdikte/.test(message)) {
        message = "De reliëfdiepte moet kleiner zijn dan de basisdikte.";
      } else if (/geen (?:bruikbare )?(?:gevulde|gesloten) omtrekken|leverde geen gesloten omtrekken op/i.test(message)) {
        message = "Geen gevuld ontwerp gevonden. Gebruik gesloten, gevulde vormen.";
      } else if (/manifold|open randen|inconsistent.*randen/i.test(message)) {
        message = "Het stempeloppervlak kon niet veilig worden opgebouwd.";
      } else if (/niet veilig (?:te repareren|worden gerepareerd)|onduidelijk puntcontact/i.test(message)) {
        message = "Sommige omtrekken moeten worden aangepast voordat ze geprint kunnen worden.";
      }
    }
    if (message.length > 160) message = `${message.slice(0, 157)}…`;
    const details = row.details.filter((detail) =>
      !reported.has(unprefixedMessage(detail)));
    if (message !== row.original) details.unshift(row.original);
    if (row.elementId) details.unshift(`Element "${row.elementId}"${row.elementKind ? ` (${kindLabel(row.elementKind)})` : ""}`);
    return { ...row, message, suggestion, details: [...new Set(details)] };
  }).sort((a, b) => (priority[a.level] ?? 1) - (priority[b.level] ?? 1));
}

function renderRows(dom, rows, actions) {
  const shown = presentDiagnosticRows(
    rows.length > 0
      ? rows
      : [{ level: "ok", message: "Geen meldingen." }]);
  const visible = shown.filter(({ level }) => level !== "ok");
  const passed = shown.filter(({ level }) => level === "ok");
  const nodes = visible.map((row) => createRow(row, actions));
  if (passed.length > 0) {
    const checks = document.createElement("details");
    checks.className = "diagnostic-checks";
    const summary = document.createElement("summary");
    summary.textContent = `Geslaagde controles (${passed.length})`;
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
      action.textContent = "Op stempel laten passen";
      action.setAttribute(
        "aria-label",
        "Los dit op door het ontwerp binnen de stempel te laten passen",
      );
      action.title = "Verklein dit ontwerp automatisch zodat het binnen de stempel past";
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
  const faceHeight = info.faceHeight ?? info.faceSize;
  dom.faceSize.textContent = `${format(info.faceSize)} × ${format(faceHeight)} mm`;
  dom.triangleCount.textContent = info.triangles.toLocaleString(LOCALE);
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
