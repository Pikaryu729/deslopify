/**
 * Builds the extension for Chrome and Firefox.
 *
 * Chrome MV3 needs `background.service_worker`; Firefox MV3 does not support
 * service workers and still uses `background.scripts` (an event page). Everything
 * else is shared, so we bundle once per target with the matching manifest.
 */
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const src = resolve(root, "src");
const dist = resolve(root, "dist");

const ENTRIES = [
  { in: "background/index.js", out: "background" },
  { in: "content/index.js", out: "content" },
  { in: "popup/popup.js", out: "popup" },
  { in: "options/options.js", out: "options" },
];

const STATIC_FILES = [
  "content/content.css",
  "ui.css",
  "popup/popup.html",
  "options/options.html",
];

async function bundle(outdir) {
  await build({
    entryPoints: ENTRIES.map((entry) => ({ in: resolve(src, entry.in), out: entry.out })),
    outdir,
    bundle: true,
    format: "iife",
    target: ["chrome116", "firefox115"],
    platform: "browser",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });
}

async function buildTarget(target) {
  const outdir = resolve(dist, target);
  await mkdir(outdir, { recursive: true });
  await bundle(outdir);

  // Flatten HTML entry points to the extension root, keep CSS where it is referenced.
  await cp(resolve(src, "ui.css"), resolve(outdir, "ui.css"));
  await cp(resolve(src, "content/content.css"), resolve(outdir, "content.css"));
  await cp(resolve(src, "popup/popup.html"), resolve(outdir, "popup.html"));
  await cp(resolve(src, "options/options.html"), resolve(outdir, "options.html"));
  await cp(resolve(src, "icons"), resolve(outdir, "icons"), { recursive: true });

  const base = JSON.parse(await readFile(resolve(src, "manifest.base.json"), "utf8"));
  const overlay = JSON.parse(await readFile(resolve(src, `manifest.${target}.json`), "utf8"));
  // package.json is the single source of truth for the version: both stores key
  // updates off it, and a manifest that drifts from it is a release-day bug.
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const manifest = { ...base, ...overlay, version: pkg.version };
  await writeFile(resolve(outdir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return outdir;
}

// Only clear the two target directories: dist/artifacts holds packaged zips
// that a rebuild should not silently delete.
for (const target of ["chrome", "firefox"]) await rm(resolve(dist, target), { recursive: true, force: true });
const built = [];
for (const target of ["chrome", "firefox"]) built.push(await buildTarget(target));
console.log("built:", built.join(", "));
