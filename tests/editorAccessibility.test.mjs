import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const APP = "src/stamp_generator";
const PROJECT_FILES = {
  "main.js": `${APP}/static/stamp_generator/js/main.js`,
  "pipelineControls.js": `${APP}/static/stamp_generator/js/pipelineControls.js`,
  "style.css": `${APP}/static/stamp_generator/css/style.css`,
  "index.html": `${APP}/templates/stamp_generator/index.html`,
};
const projectFile = (name) =>
  readFile(new URL(`../${PROJECT_FILES[name]}`, import.meta.url), "utf8");

test("design elements are focusable and retain focus across artboard renders", async () => {
  const main = await projectFile("main.js");

  assert.match(main, /item\.tabIndex = 0/);
  assert.match(main, /item\.addEventListener\("focus",/);
  assert.match(main, /focusedItem\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(main, /item\.addEventListener\("keydown", moveElementFromKeyboard\)/);
});

test("design elements have a visible focus-visible outline", async () => {
  const css = await projectFile("style.css");
  const rule = css.match(/\.design-element:focus-visible\s*\{([^}]*)\}/);

  assert.ok(rule);
  assert.match(rule[1], /outline:\s*3px solid/);
  assert.doesNotMatch(rule[1], /outline:\s*none/);
});

test("alignment icon buttons expose action names and pressed state", async () => {
  const html = await projectFile("index.html");

  for (const alignment of ["left", "center", "right"]) {
    const button = html.match(
      new RegExp(`<button[^>]*data-align="${alignment}"[^>]*>`, "s"),
    );
    assert.ok(button, `missing ${alignment} alignment button`);
    assert.match(button[0], new RegExp(`aria-label="Align text ${alignment}"`));
    assert.match(button[0], /aria-pressed="(?:true|false)"/);
  }
});

test("Text exposes one synchronized size control while images keep Scale", async () => {
  const [html, main] = await Promise.all([
    projectFile("index.html"),
    projectFile("main.js"),
  ]);

  assert.match(html, /<label for="font-size">Text size \(mm\)<\/label>/);
  assert.match(html, /id="element-scale-control"/);
  assert.match(
    main,
    /#element-scale-control"\)\.classList\.toggle\("d-none", !element \|\| isText\)/,
  );
  const resizeHandler = main.match(
    /function startResize[\s\S]*?function freeSpotForNewText/,
  )?.[0];
  assert.match(resizeHandler, /startTextSizeMm/);
  assert.match(resizeHandler, /resizePreviewTransforms\.set/);
  assert.match(resizeHandler, /updateTextSizeControl\(textPreview\.fontSizeMm\)/);
  assert.match(resizeHandler, /editor\.setTextSize\(element\.id, textPreview\.fontSizeMm\)/);
  assert.match(
    main,
    /element\.source\.fontSizeMm \* element\.transform\.scale/,
  );
});

test("the selected element controls expose a Duplicate action", async () => {
  const [html, main] = await Promise.all([
    projectFile("index.html"),
    projectFile("main.js"),
  ]);

  assert.match(html, /<button id="duplicate-element"[^>]*>\s*Duplicate Element/);
  assert.match(main, /#duplicate-element"\)\.disabled = !element/);
  assert.match(main, /editor\.duplicateSelected\(\)/);
});

test("position and transform controls can collapse without resetting selection", async () => {
  const [html, main, css] = await Promise.all([
    projectFile("index.html"),
    projectFile("main.js"),
    projectFile("style.css"),
  ]);

  const toggle = html.match(/<button\s+id="transform-controls-toggle"[\s\S]*?>/);
  assert.ok(toggle, "missing position and transform collapse control");
  assert.match(toggle[0], /aria-expanded="false"/);
  assert.match(toggle[0], /aria-controls="transform-controls-content"/);
  assert.match(toggle[0], /aria-label="Expand position and transform controls"/);
  assert.match(html, /<div id="transform-controls-content" hidden>/);

  assert.match(main, /let transformControlsExpanded = false/);
  assert.match(main, /#transform-controls-content"\)\.hidden = !expanded/);
  assert.match(
    main,
    /setTransformControlsExpanded\(!transformControlsExpanded\)/,
  );
  assert.doesNotMatch(
    main.match(/function updateControls\(\)[\s\S]*?\n}/)?.[0] ?? "",
    /transformControlsExpanded\s*=/,
  );
  assert.match(css, /#transform-controls-content\[hidden\]\s*\{\s*display:\s*none/);
});

test("letter spacing is presented and edited as a percentage", async () => {
  const [html, main] = await Promise.all([
    projectFile("index.html"),
    projectFile("main.js"),
  ]);

  assert.match(html, /id="letter-spacing-value">13\.33%<\/output>/);
  assert.match(main, /element\.source\.letterSpacingRatio \* 100/);
  assert.match(main, /letterSpacingRatio: Number\(event\.target\.value\) \/ 100/);
});

test("only the left alignment icon uses varied lines with one left edge", async () => {
  const html = await projectFile("index.html");
  const buttonContents = (alignment) =>
    html.match(
      new RegExp(
        `<button[^>]*data-align="${alignment}"[^>]*>([\\s\\S]*?)<\\/button>`,
      ),
    )?.[1].trim();
  const leftIcon = buttonContents("left");

  assert.match(leftIcon, /^<svg[\s\S]*<\/svg>$/);
  assert.match(leftIcon, /width="16"/);
  assert.match(leftIcon, /height="12"/);
  assert.match(leftIcon, /stroke-width="1\.5"/);
  const lines = [...leftIcon.matchAll(/<line x1="(\d+)"[^>]*x2="(\d+)"/g)];
  assert.equal(lines.length, 3);
  assert.equal(new Set(lines.map((match) => match[1])).size, 1);
  assert.ok(new Set(lines.map((match) => match[2])).size >= 3);
  assert.equal(buttonContents("center"), "≡");
  assert.equal(buttonContents("right"), "≡");
});

test("the editor exposes STL as its only export action", async () => {
  const [html, controls] = await Promise.all([
    projectFile("index.html"),
    projectFile("pipelineControls.js"),
  ]);

  assert.match(html, /id="pipeline-export-stl"/);
  assert.doesNotMatch(html, /pipeline-export-3mf|Export 3MF|STL \/ 3MF/);
  assert.doesNotMatch(controls, /export3MF|pipeline-export-3mf/);
});

test("the editor starts empty while preserving manual Text creation", async () => {
  const [html, main] = await Promise.all([
    projectFile("index.html"),
    projectFile("main.js"),
  ]);

  assert.match(main, /const designModel = new DesignModel\(\);/);
  assert.doesNotMatch(main, /CLAYSTER\\nSTUDIO/);
  assert.match(html, /id="add-text"/);
  assert.match(
    main,
    /#add-text"\)\.addEventListener\("click",[\s\S]*?designControls\.addElement\(\s*"text"/,
  );
});

test("new Text uses the safer thickness and shows it in the control", async () => {
  const main = await projectFile("main.js");
  const addTextHandler = main.match(
    /#add-text"\)\.addEventListener\("click",[\s\S]*?\n}\);/,
  )?.[0];

  assert.ok(addTextHandler, "missing Add Text handler");
  assert.match(addTextHandler, /thicknessMm:\s*0\.3/);
  assert.match(
    main,
    /#font-weight"\)\.value = element\.source\.thicknessMm/,
  );
});
