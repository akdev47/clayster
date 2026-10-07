import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
