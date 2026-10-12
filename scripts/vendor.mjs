// Copies the npm packages the browser needs into src/static/vendor/, so Django
// serves all JavaScript as plain static files and no bundler runs at deploy
// time. The folder is generated and not committed: run `npm run vendor` (it
// also runs after `npm install`).
//
// src/stamp_generator/importmap.json decides what is copied. Its "imports" are
// the import map the stamp generator page uses: bare names such as "three"
// mapped to a path inside node_modules, which is also the path below
// src/static/vendor/. Starting from those files and from every bare import in
// the app's own modules, this script follows the import statements and copies
// each file it reaches. A bare import the map does not cover is an error.
// "files" lists plain scripts that are loaded with <script> instead.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const IMPORT_MAP_FILE = path.join(ROOT, "src/stamp_generator/importmap.json");
const APP_JS = path.join(ROOT, "src/stamp_generator/static/stamp_generator/js");
const VENDOR_DIR = path.join(ROOT, "src/static/vendor");

const SCRIPT_FILE = /\.(?:m?js)$/;
const SPECIFIER_PATTERNS = [
  // import x from "y", import {a,\n b} from "y", export * from "y"
  /\b(?:import|export)\b[^'"`;()]*?\bfrom\s*["']([^"']+)["']/g,
  // import "y"
  /\bimport\s*["']([^"']+)["']/g,
  // import("y") and import.meta.resolve("y")
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\.meta\.resolve\(\s*["']([^"']+)["']\s*\)/g,
];

export const readImportMap = () =>
  JSON.parse(readFileSync(IMPORT_MAP_FILE, "utf8"));

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

export const specifiersIn = (source) => {
  const code = stripComments(source);
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
};

const isBuiltin = (specifier) =>
  specifier.startsWith("node:") || builtinModules.includes(specifier);

// Same lookup the browser does: exact name first, then the longest prefix
// entry (a key ending in "/").
export const mapTarget = (imports, specifier) => {
  if (Object.hasOwn(imports, specifier)) return imports[specifier];
  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return prefix === undefined
    ? undefined
    : imports[prefix] + specifier.slice(prefix.length);
};

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

// Returns the files to copy (paths relative to node_modules) and a list of
// problems. Never touches the disk beyond reading.
export const collect = () => {
  const { imports, files = [] } = readImportMap();
  const copy = new Set();
  const problems = [];
  const queue = [];

  const enqueue = (file, from) => {
    if (copy.has(file)) return;
    if (!existsSync(path.join(NODE_MODULES, file))) {
      problems.push(`${file} does not exist (needed by ${from})`);
      return;
    }
    copy.add(file);
    queue.push(file);
  };

  const follow = (specifier, from, resolveRelative) => {
    if (isBuiltin(specifier)) return;
    if (/[?#]/.test(specifier)) {
      problems.push(`${from}: "${specifier}" uses a bundler query string`);
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      resolveRelative?.(specifier);
    } else {
      const target = mapTarget(imports, specifier);
      if (target === undefined) {
        problems.push(`${from}: bare import "${specifier}" is not in importmap.json`);
      } else {
        enqueue(target, from);
      }
    }
  };

  for (const target of Object.values(imports)) {
    if (!target.endsWith("/")) enqueue(target, "importmap.json");
  }
  for (const file of files) enqueue(file, "importmap.json");

  // The app's own modules: only their bare imports matter here.
  for (const file of walk(APP_JS).filter((name) => SCRIPT_FILE.test(name))) {
    const from = path.relative(ROOT, file);
    for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
      follow(specifier, from);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift();
    if (!SCRIPT_FILE.test(file) || files.includes(file)) continue;
    const source = readFileSync(path.join(NODE_MODULES, file), "utf8");
    for (const specifier of specifiersIn(source)) {
      follow(specifier, file, (relative) =>
        enqueue(path.posix.join(path.posix.dirname(file), relative), file),
      );
    }
  }

  return { files: [...copy].sort(), problems };
};

const main = () => {
  const checkOnly = process.argv.includes("--check");
  if (!existsSync(NODE_MODULES)) {
    console.error("node_modules is missing; run `npm install` first.");
    process.exit(1);
  }

  const { files, problems } = collect();
  if (problems.length > 0) {
    console.error(problems.map((problem) => `  - ${problem}`).join("\n"));
    console.error(`vendor: ${problems.length} problem(s), nothing copied.`);
    process.exit(1);
  }
  if (checkOnly) {
    console.log(`vendor: ${files.length} files resolve.`);
    return;
  }

  // Only ever clear the one generated folder.
  if (path.relative(ROOT, VENDOR_DIR) !== path.join("src", "static", "vendor")) {
    throw new Error(`Refusing to clear ${VENDOR_DIR}`);
  }
  rmSync(VENDOR_DIR, { recursive: true, force: true });

  let bytes = 0;
  for (const file of files) {
    const destination = path.join(VENDOR_DIR, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(NODE_MODULES, file), destination);
    bytes += statSync(destination).size;
  }
  console.log(
    `vendor: copied ${files.length} files (${(bytes / 1e6).toFixed(1)} MB) to ${path.relative(ROOT, VENDOR_DIR)}`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
