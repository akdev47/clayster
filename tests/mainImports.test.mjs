import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// main.js starts the whole page when it is imported, so no test loads it, and a
// name used there without an import only fails in the browser, when that line
// runs ("uniformSizeChange is not defined" once left the Width and Height fields
// doing nothing). This checks the one thing that is easy to get wrong when
// functions move between files: that everything main.js takes from the app's
// own modules is imported.

const jsDirectory = fileURLToPath(
  new URL("../src/stamp_generator/static/stamp_generator/js/", import.meta.url),
);

function moduleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? moduleFiles(full) : [full];
  });
}

// Every name an app module exports, however it is declared.
function exportedNames() {
  const names = new Set();
  for (const file of moduleFiles(jsDirectory).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(file, "utf8");
    for (const [, name] of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(name);
    }
    for (const [, list] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of list.split(",")) {
        const name = part.trim().split(/\s+as\s+/).at(-1);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Exported app names that `source` calls or constructs without importing or declaring them. */
export function unimportedAppNames(source, names) {
  const imported = new Set();
  for (const [, list] of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of list.split(",")) {
      const name = part.trim().split(/\s+as\s+/).at(-1);
      if (name) imported.add(name);
    }
  }
  for (const [, name] of source.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from/g)) {
    imported.add(name);
  }

  const missing = [];
  for (const name of names) {
    if (imported.has(name)) continue;
    const declared = new RegExp(`(?:function\\*?|const|let|var|class)\\s+${name}\\b|[({,]\\s*${name}\\s*[,)}=]`);
    if (declared.test(source)) continue;
    const used = new RegExp(`(?<![\\w$.])(?:new\\s+)?${name}\\s*\\(`);
    if (used.test(source)) missing.push(name);
  }
  return missing.sort();
}

const main = readFileSync(new URL("main.js", `file://${jsDirectory}`), "utf8");

test("main.js imports every app function it calls", () => {
  const names = exportedNames();
  assert.ok(names.size > 100, "the app's exports were found");
  assert.ok(names.has("uniformSizeChange") && names.has("elementOwnSize"));
  assert.deepEqual(unimportedAppNames(main, names), []);
});

test("the check notices a name that was left out of an import", () => {
  const names = exportedNames();
  const broken = main.replace(
    'import { createTextSizeControls, uniformSizeChange } from "./sizing.js";',
    'import { createTextSizeControls } from "./sizing.js";',
  );
  assert.notEqual(broken, main, "the import line is still as the test expects");
  assert.deepEqual(unimportedAppNames(broken, names), ["uniformSizeChange"]);

  const withoutNew = main.replace("  stretchedTransform,\n", "");
  assert.notEqual(withoutNew, main);
  assert.deepEqual(unimportedAppNames(withoutNew, names), ["stretchedTransform"]);
});
