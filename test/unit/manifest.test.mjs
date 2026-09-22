/**
 * Guards the Chrome/Firefox split: the two builds differ only by manifest, and
 * Firefox must never receive a `background.service_worker` (unsupported there),
 * while Chrome MV3 must never receive `background.scripts` (MV2-only).
 *
 * Run after `npm run build`; `npm test` does that via `npm run verify`.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../../dist");

const manifests = {};
const pkg = JSON.parse(await readFile(resolve(here, "../../package.json"), "utf8"));

before(async () => {
  for (const target of ["chrome", "firefox"]) {
    const path = resolve(dist, target, "manifest.json");
    await access(path).catch(() => {
      throw new Error(`${path} is missing — run \`npm run build\` first`);
    });
    manifests[target] = JSON.parse(await readFile(path, "utf8"));
  }
});

test("both builds share the same permissions and content script contract", () => {  for (const target of ["chrome", "firefox"]) {
    const manifest = manifests[target];
    assert.equal(manifest.manifest_version, 3, `${target} is MV3`);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.equal(manifest.host_permissions.includes("https://api.typesafe.ai/*"), true);
    assert.equal(manifest.host_permissions.includes("https://api.cloudflare.com/*"), true);
    assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.linkedin.com/*"]);
    assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
    assert.equal(manifest.content_scripts[0].css.includes("content.css"), true);
    assert.equal(manifest.options_ui.page, "options.html");
    assert.equal(manifest.action.default_popup, "popup.html");
  }
});

test("the Chrome build uses a service worker and never MV2 background scripts", () => {
  const background = manifests.chrome.background;
  assert.equal(background.service_worker, "background.js");
  assert.equal(background.scripts, undefined);
  assert.equal(background.type, undefined, "the bundle is a classic script");
});

test("the Firefox build uses an event page and never a service worker", () => {
  const background = manifests.firefox.background;
  assert.deepEqual(background.scripts, ["background.js"]);
  assert.equal(background.service_worker, undefined, "Firefox does not support background.service_worker");
  assert.equal(background.type, undefined);
});

test("the Firefox build declares its gecko id and data collection", () => {
  const gecko = manifests.firefox.browser_specific_settings.gecko;
  assert.match(gecko.id, /@/);
  assert.ok(gecko.strict_min_version);
  assert.deepEqual(gecko.data_collection_permissions.required, ["websiteContent"]);
  assert.equal(manifests.chrome.browser_specific_settings, undefined, "Chrome rejects unknown browser_specific_settings");
});

test("the store-visible metadata stays within the stores' limits", () => {
  for (const target of ["chrome", "firefox"]) {
    const manifest = manifests[target];
    assert.equal(manifest.version, pkg.version, `${target}: version must come from package.json`);
    assert.ok(manifest.name.length <= 45, `${target}: name is ${manifest.name.length} chars (Firefox caps at 45)`);
    assert.ok(manifest.description.length <= 132, `${target}: description is ${manifest.description.length} chars (Chrome caps at 132)`);
    assert.match(manifest.version, /^\d+(\.\d+){1,3}$/, `${target}: version format`);
    // Store policy: a third-party trademark in the extension name implies
    // affiliation. The trademark belongs in the description, not the name.
    assert.equal(/linkedin/i.test(manifest.name), false, `${target}: name must not carry a third-party trademark`);
    assert.match(manifest.description, /LinkedIn/i, `${target}: the description still says what it works on`);
  }
});

test("every referenced file exists in both builds", async () => {
  for (const target of ["chrome", "firefox"]) {
    const manifest = manifests[target];
    const files = [
      manifest.background.service_worker ?? manifest.background.scripts[0],
      "content.js",
      "content.css",
      "popup.html",
      "popup.js",
      "options.html",
      "options.js",
      "ui.css",
      ...Object.values(manifest.icons),
    ];
    for (const file of files) {
      await access(resolve(dist, target, file)).catch(() => assert.fail(`${target}: missing ${file}`));
    }
  }
});
