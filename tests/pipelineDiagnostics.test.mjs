import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignModel } from "../src/designModel.js";
import {
  DesignEditorController,
  fitsFace,
} from "../src/editor2dInteractions.js";
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

  complete({
    issues = [],
    notes = [],
    stamp = {},
    info = null,
    segmentations = [],
  } = {}) {
    this.result = { issues, notes, stamp, info, segmentations };
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

test("an untouched design prompts for artwork instead of showing an error", () => {
  const { pipeline, controller } = setup();
  pipeline.result = { artwork: [], issues: [], stamp: null };
  pipeline.dispatchEvent(new Event("result"));

  assert.equal(controller.state.overall.level, "idle");
  assert.match(controller.state.rows[0].message, /add text/i);
  assert.equal(controller.state.export.ready, false);
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

test("informational processing notes do not create warning status", () => {
  const { pipeline, controller } = setup();
  pipeline.complete({
    issues: [
      {
        level: "info",
        message:
          "Auto background detection was inconclusive; traced using Original processing.",
      },
    ],
  });

  assert.equal(controller.state.overall.message, "Ready to export");
  assert.equal(controller.state.export.ready, true);
  assert.equal(controller.state.rows[0].level, "info");
  assert.equal(controller.state.rows[0].message,
    "Auto background detection was inconclusive; traced using Original processing.");
});

test("PNG segmentation review metadata reaches diagnostics without blocking export", () => {
  const { pipeline, controller } = setup();
  pipeline.complete({
    issues: [
      {
        level: "info",
        elementId: "logo-png",
        elementKind: "png",
        message: "Auto background detection failed — review the traced result.",
      },
    ],
    segmentations: [
      {
        elementId: "logo-png",
        elementKind: "png",
        status: "needs-review",
        method: "original-fallback",
        message: "Auto background detection failed — review the traced result.",
      },
    ],
  });

  assert.equal(controller.state.overall.message, "Ready to export");
  assert.equal(controller.state.export.ready, true);
  assert.equal(
    controller.state.rows.filter(({ badge }) => badge === "Review").length,
    1,
  );
  assert.equal(controller.state.rows[0].level, "info");
  assert.equal(controller.state.rows[0].badge, "Review");
  assert.equal(controller.state.rows[0].badgeClass, "warning-badge");
  assert.match(controller.state.rows[0].message, /logo-png.*review the traced result/i);
});

test("Fit to stamp buttons appear only on overflow warnings", () => {
  const node = () => ({
    textContent: "",
    className: "",
    children: [],
    dataset: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, listener) { this[type] = listener; },
  });
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: node, getElementById: byId };
  const pipeline = new DiagnosticPipeline();
  const model = new DesignModel({
    elements: [{
      id: "wide-svg",
      kind: "svg",
      transform: { xMm: 20, scale: 3 },
    }],
  });
  const editor = new DesignEditorController(model);
  const canonical = [[
    [[-5, -2], [5, -2], [5, 2], [-5, 2]],
  ]];
  editor.faceLimit = { shape: "square", halfExtent: 5 };
  editor.canonicalFor = () => canonical;
  let overflowingIds = ["wide-svg"];
  let fittedId = null;
  createPipelineDiagnostics(pipeline, {
    getOverflowElementIds: () => overflowingIds,
    onFitToStamp: (id) => {
      fittedId = id;
      editor.fitToStamp(id);
    },
  });
  const buttons = () => byId("pipeline-diagnostic-list").children
    .flatMap((row) => row.children[1].children)
    .filter(({ className }) => className === "suggestion-button");

  try {
    pipeline.complete({
      issues: [{ level: "warning", message: "A feature is thin." }],
    });
    assert.equal(buttons().length, 0);

    pipeline.complete({
      issues: [{
        level: "warning",
        code: "artwork-overflow",
        message: "Some artwork extends beyond the face.",
      }],
    });
    assert.equal(buttons().length, 1);
    assert.equal(buttons()[0].textContent, "Fit to stamp");
    buttons()[0].click();
    assert.equal(fittedId, "wide-svg");
    assert.equal(
      fitsFace(
        canonical,
        model.getElement("wide-svg").transform,
        editor.faceLimit,
      ),
      true,
    );

    overflowingIds = [];
    pipeline.complete({
      issues: [{
        level: "warning",
        code: "artwork-overflow",
        message: "Some artwork extends beyond the face.",
      }],
    });
    assert.equal(buttons().length, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
