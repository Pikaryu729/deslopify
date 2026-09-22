/**
 * The failure mode that matters most in the field: LinkedIn renames its classes
 * (or drops `data-urn`), and a selector-only extractor goes silently dead.
 *
 * This fixture has opaque hashed class names, no `data-urn`/`data-id`, and no
 * `feed-shared-*` classes anywhere — only author profile links and action-bar
 * wording. It also embeds a comment thread that must not be scored as a post.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { startMockServer } from "../mock-typesafe-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let server;
let browser;
let page;
let posts;
let extracted;

before(async () => {
  server = await startMockServer();
  browser = await chromium.launch({ channel: "chromium", headless: true });
  page = await browser.newPage();
  const bundled = await build({
    entryPoints: [resolve(here, "extract-entry.js")],
    bundle: true,
    format: "iife",
    write: false,
    target: "chrome116",
  });
  await page.goto(`${server.url}/obfuscated`);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  extracted = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    return posts.findPosts(document).map((container) => posts.extractPost(container));
  });
  posts = await page.evaluate(() => globalThis.__deslopify.findPosts(document).length);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("posts are found with no class names or data-urn to lean on", () => {
  assert.equal(posts, 3);
  assert.equal(extracted.length, 3);
});

test("the comment thread is not mistaken for a post", () => {
  const authors = extracted.map((post) => post.author);
  assert.deepEqual(authors, ["Dana Reyes", "Sam Patel", "Brittany Cole"]);
  assert.equal(authors.includes("Randal Quinn"), false, "commenters are not authors of posts");
});

test("body text and author survive hashed markup", () => {
  const [nugget] = extracted;
  assert.match(nugget.text, /p99 latency on \/charge dropped from 840ms to/);
  assert.equal(nugget.text.includes("Like"), false, "action bar wording must not leak into the body");
  assert.equal(nugget.text.includes("Staff Engineer"), false, "headline is not body text");
  assert.equal(extracted[2].text.includes('Comment "YES"'), true);
});

test("the badge goes into the author row, and floats only when there is none", async () => {
  const { row, floating } = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    const anchor = posts.findBadgeAnchor(posts.findPosts(document)[0]);
    return {
      row: anchor.parent.textContent.slice(0, 40),
      floating: anchor.floating,
      intoAuthorRow: Boolean(anchor.parent.querySelector("a[href*='/in/']")),
    };
  });
  assert.equal(floating, false, "the author row is a usable anchor even without class names");
  assert.equal(row.includes("Dana Reyes"), true);

  // A container whose author link is a direct child has no row to hang off: float.
  const floats = await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "deslopify-synthetic-post";
    host.innerHTML =
      '<a href="/in/x"><span>X</span></a><span dir="ltr">' +
      "x".repeat(150) +
      '</span><button aria-label="Like">Like</button><button aria-label="Repost">Repost</button>';
    document.body.append(host);
    const result = globalThis.__deslopify.findBadgeAnchor(host).floating;
    host.remove(); // leave the fixture exactly as it was
    return result;
  });
  assert.equal(floats, true);
});

test("diagnostics explain a page we cannot parse", async () => {
  const report = await page.evaluate(() => globalThis.__deslopify.diagnose(document));
  assert.equal(report.postsFound, 3);
  assert.equal(report.actionBarPosts, 3);
  assert.equal(report.selectorCounts["div[data-urn^='urn:li:activity']"], 0, "no data-urn hooks on this page");
  assert.equal(report.selectorCounts["div.feed-shared-update-v2"], 0, "no familiar classes on this page");
  assert.ok(report.feedStructure.includes("div.x-77aa"), "the report shows the real structure");
  assert.match(report.samplePostHtml, /t-1a2b/);
});
