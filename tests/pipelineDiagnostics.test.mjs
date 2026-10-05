import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import { DesignEditorController } from "../src/editor2dInteractions.js";
import { createPipelineDiagnostics } from "../src/pipelineDiagnostics.js";

class DiagnosticPipeline extends EventTarget {
  constructor() {
    super();
    this.result = null;
    this.diagnostics = null;
    this.error = null;
  }

  start(message = "Processing design elements…") {
    this.result = null;
    this.diagnostics = {
      level: "working",
      message,
      details: [],
      stage: "element conversion",
    };
    this.dispatchEvent(new Event("running"));
  }

  complete({ issues = [], notes = [], stamp = {}, info = null } = {}) {
    this.result = { issues, notes, stamp, info };
    this.diagnostics = {
      level: "ok",
      message: "Design processed successfully.",
      details: ["Stamp geometry produced and accepted for preview/export."],
      stage: "complete",
    };
    this.dispatchEvent(new Event("result"));
  }
}

function setup() {
  const pipeline = new DiagnosticPipeline();
  const rendered = [];
  const controller = createPipelineDiagnostics(pipeline, {
    render: (state) => rendered.push(state),
  });
  return { pipeline, controller, rendered };
}

test("the same diagnostic state remains visible across the 2D/3D toggle", () => {
  const model = new DesignModel({ elements: [{ id: "text-1", kind: "text" }] });
  const editor = new DesignEditorController(model);
  const { pipeline, controller, rendered } = setup();
  pipeline.complete({
    notes: ["Mesh checks passed."],
    info: { width: 30, depth: 20, height: 12, faceSize: 30, triangles: 1200 },
  });
  const state = controller.state;

  editor.setView("3d");
  editor.setView("2d");

  assert.equal(controller.state, state);
  assert.equal(rendered.length, 1);
  assert.equal(state.overall.message, "Ready to export");
});

test("a 2D design edit triggers updated authoritative diagnostics", () => {
  const model = new DesignModel({ elements: [{ id: "text-1", kind: "text" }] });
  const editor = new DesignEditorController(model);
  const { pipeline, controller } = setup();
  model.addEventListener("change", () => pipeline.start());

  editor.updateSelectedText({ text: "Updated in 2D" });

  assert.equal(controller.state.overall.level, "working");
  assert.equal(controller.state.rows.length, 1);
  assert.match(controller.state.rows[0].message, /processing design elements/i);

  pipeline.complete({
    issues: [{ level: "warning", message: "A feature is thin." }],
  });
  assert.equal(controller.state.overall.message, "Ready with warnings");
  assert.equal(controller.state.rows[0].message, "A feature is thin.");
});

test("an invalid element blocks the design and reports its element ID", () => {
  const { pipeline, controller } = setup();
  pipeline.complete({
    stamp: null,
    issues: [
      {
        level: "error",
        message: "the element produced no closed outlines",
        scope: "element",
        elementId: "logo-7",
        elementKind: "svg",
      },
    ],
  });

  assert.equal(controller.state.export.ready, false);
  assert.equal(controller.state.export.label, "Unavailable");
  assert.match(controller.state.rows[0].message, /Element "logo-7" \(svg\)/);
});

test("a valid design shows export readiness in both views", () => {
  const model = new DesignModel({ elements: [{ id: "text-1", kind: "text" }] });
  const editor = new DesignEditorController(model);
  const { pipeline, controller } = setup();
  pipeline.complete();

  assert.equal(controller.state.export.ready, true);
  editor.setView("3d");
  assert.equal(controller.state.export.ready, true);
  editor.setView("2d");
  assert.equal(controller.state.export.ready, true);
});

test("stale diagnostics and dimensions clear when a rebuild starts", () => {
  const { pipeline, controller } = setup();
  pipeline.complete({
    issues: [{ level: "warning", message: "Old warning" }],
    info: { width: 30, depth: 20, height: 12, faceSize: 30, triangles: 1200 },
  });

  pipeline.start("Converting updated text…");

  assert.equal(controller.state.info, null);
  assert.equal(controller.state.export.ready, false);
  assert.deepEqual(
    controller.state.rows.map(({ message }) => message),
    ["Converting updated text…"],
  );
});
