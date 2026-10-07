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
