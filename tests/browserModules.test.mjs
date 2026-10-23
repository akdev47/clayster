import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mapTarget, readImportMap } from "../scripts/vendor.mjs";

// Link the stamp generator's modules the way the browser does: bare imports
// are resolved through importmap.json instead of Node's package rules. This
// catches what a Node-only test cannot, such as importing a default export
// that the browser's ES build of a package does not have.
const { imports } = readImportMap();
const nodeModules = new URL("../node_modules/", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const isBare = !/^(?:\.{0,2}\/|file:|node:|data:)/.test(specifier);
    const target = isBare ? mapTarget(imports, specifier) : undefined;
    return target === undefined
      ? nextResolve(specifier, context)
      : { url: new URL(target, nodeModules).href, shortCircuit: true };
  },
});

const jsDirectory = fileURLToPath(
  new URL("../src/stamp_generator/static/stamp_generator/js/", import.meta.url),
);
const modules = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? modules(full) : [full];
  });

// main.js starts the page when imported, so it is not loaded by this test.
const NOT_IMPORTABLE = new Set(["main.js"]);
const LINK_ERRORS = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_UNSUPPORTED_DIR_IMPORT",
]);

test("every stamp generator module links through the browser import map", async () => {
  const files = modules(jsDirectory).filter(
    (file) => file.endsWith(".js") && !NOT_IMPORTABLE.has(path.basename(file)),
  );
  assert.ok(files.length > 30);

  const failures = [];
  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      if (error instanceof SyntaxError || LINK_ERRORS.has(error.code)) {
        failures.push(`${path.relative(jsDirectory, file)}: ${error.message}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("the WebAssembly file resolves through the import map", () => {
  assert.match(import.meta.resolve("manifold-3d/manifold.wasm"), /manifold\.wasm$/);
});
