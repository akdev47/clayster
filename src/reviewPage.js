// Step 2: a read-only review of the design currently held by the editor.
import { createStampSpinner } from "./stampSpinner.js";
import { reviewSummary } from "./reviewSummary.js";

export function createReviewPage({ designModel, pipeline, diagnostics, renderPreview, onBack, onContinue }) {
  const byId = (id) => document.getElementById(id);
  const page = byId("review-page");
  const preview = byId("review-stamp-preview");
  const frame3d = byId("review-stamp-3d");
  const confirm = byId("review-confirm");
  let view = "2d";
  let surface = "stamp";
  let spinner = null;
  let stampDrawn = false;

  const update3D = () => {
    if (spinner === null) return;
    const geometry = surface === "clay"
      ? pipeline.result?.clay
      : pipeline.result?.stamp;
    spinner.setGeometry(geometry ?? null);
  };

  const setView = (next) => {
    view = next;
    for (const button of page.querySelectorAll("[data-review-view]")) {
      button.classList.toggle("active", button.dataset.reviewView === next);
    }
    const flat = next === "2d";
    // SVG elements do not reliably reflect the HTML `hidden` property.
    preview.toggleAttribute("hidden", !flat || !stampDrawn);
    frame3d.hidden = flat;
    byId("review-surface-toggle").hidden = flat;
    byId("review-preview-frame").dataset.view = next;

    if (!flat && spinner === null) spinner = createStampSpinner(frame3d);
    if (!flat) {
      update3D();
      if (!page.hidden) spinner.start();
    } else {
      spinner?.stop();
    }
  };

  const renderChecklist = () => {
    const state = diagnostics.state;
    const status = byId("review-check-status");
    const badge = byId("review-check-badge");
    status.textContent = state?.overall.message ?? "Waiting for build…";
    status.className = `overall-status pipeline-overall-${state?.overall.level ?? "working"}`;
    badge.textContent = state?.overall.level === "warning"
      ? "Warnings"
      : state?.export.ready
        ? "Ready"
        : state?.overall.level === "error"
          ? "Blocked"
          : "Checking…";
    badge.dataset.level = state?.overall.level ?? "working";
    byId("review-check-list").replaceChildren(
      ...[...byId("pipeline-diagnostic-list").children].map((row) => row.cloneNode(true)),
    );

    const ready = Boolean(state?.export.ready) && !pipeline.busy;
    confirm.disabled = !ready;
    byId("review-continue-hint").textContent = ready
      ? "Your design is ready for order details."
      : pipeline.busy
        ? "Wait for the stamp to finish building."
        : "Return to the editor and resolve the printability errors before continuing.";
  };

  const renderSummary = () => {
    const dimensions = byId("review-dimension-text").textContent;
    const rows = reviewSummary(designModel, pipeline.stamp, dimensions);
    byId("review-summary").replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        row.append(dt, dd);
        return row;
      }),
    );
    byId("review-handle").textContent = pipeline.stamp.handle === "none"
      ? "No handle — face only"
      : "Sample handle · included with the stamp";
  };

  const refresh = () => {
    if (page.hidden) return;
    stampDrawn = renderPreview(preview, byId("review-dimension-text")) !== null;
    byId("review-stamp-empty").hidden = stampDrawn;
    renderChecklist();
    renderSummary();
    setView(view);
  };

  for (const type of ["running", "result", "failed"]) {
    pipeline.addEventListener(type, refresh);
  }

  byId("review-view-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-view]");
    if (button !== null) setView(button.dataset.reviewView);
  });

  byId("review-surface-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-surface]");
    if (button === null) return;
    surface = button.dataset.reviewSurface;
    for (const option of page.querySelectorAll("[data-review-surface]")) {
      option.classList.toggle("active", option.dataset.reviewSurface === surface);
    }
    update3D();
  });

  byId("review-edit").addEventListener("click", onBack);
  byId("review-summary-toggle").addEventListener("click", () => {
    const details = byId("review-summary-extra");
    const toggle = byId("review-summary-toggle");
    details.hidden = !details.hidden;
    toggle.setAttribute("aria-expanded", String(!details.hidden));
    byId("review-summary-toggle-label").textContent = details.hidden
      ? "Show details"
      : "Hide details";
    byId("review-summary-toggle-icon").textContent = details.hidden ? "⌄" : "⌃";
  });
  byId("review-back").addEventListener("click", onBack);
  confirm.addEventListener("click", () => {
    if (!confirm.disabled) onContinue();
  });

  return {
    show: refresh,
    hide() {
      spinner?.stop();
    },
  };
}
