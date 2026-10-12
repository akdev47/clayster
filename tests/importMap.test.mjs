import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect, specifiersIn } from "../scripts/vendor.mjs";

const jsDirectory = fileURLToPath(
  new URL("../src/stamp_generator/static/stamp_generator/js/", import.meta.url),
);
const appFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? appFiles(full) : [full];
  });

test("every bare import resolves through importmap.json to an existing file", () => {
  const { files, problems } = collect();

  assert.deepEqual(problems, []);
  assert.ok(files.includes("three/build/three.module.js"));
  assert.ok(files.includes("manifold-3d/manifold.wasm"));
  assert.ok(files.includes("bootstrap/dist/js/bootstrap.bundle.min.js"));
});

test("the stamp generator modules need no bundler", () => {
  for (const file of appFiles(jsDirectory).filter((name) => name.endsWith(".js"))) {
    const relative = path.relative(jsDirectory, file);
    for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
      assert.doesNotMatch(specifier, /[?#]/, `${relative} imports ${specifier}`);
      assert.doesNotMatch(specifier, /\.(?:css|ttf|stl|svg)$/, `${relative} imports ${specifier}`);
    }
  }
});
