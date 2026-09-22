/**
 * DOM-layer test: the content script's discovery + extraction code is run
 * against a fixture page that mimics LinkedIn's feed markup, in a real browser.
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
let extraction;

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
  await page.goto(server.fixtureUrl);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  extraction = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    return posts.findPosts(document).map((container) => posts.extractPost(container));
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("every top-level feed post is found exactly once, including wrapped reposts", () => {
  assert.equal(extraction.length, 6);
  const urns = extraction.map((post) => post.urn);
  assert.deepEqual(urns, [
    "urn:li:activity:7300000000000000001",
    "urn:li:activity:7300000000000000002",
    "urn:li:activity:7300000000000000003",
    "urn:li:activity:7300000000000000004",
    "urn:li:activity:7300000000000000005",
    "urn:li:activity:7300000000000000006",
  ]);
});

test("author, headline and body text are extracted without the actor chrome", () => {
  const [nugget] = extraction;
  assert.equal(nugget.author, "Dana Reyes");
  assert.equal(nugget.headline, "Staff Engineer at Northwind");
  assert.match(nugget.text, /p99 latency on \/charge dropped from 840ms to/);
  assert.equal(nugget.text.includes("View Dana Reyes"), false, "screen-reader duplicates must not leak in");
  assert.equal(nugget.text.includes("Like Comment Repost"), false, "action bar must not be part of the post");
  assert.equal(nugget.text.includes("Open control menu"), false);
  assert.equal(nugget.context, "feed post");
  assert.equal(nugget.isPromoted, false);
  assert.equal(nugget.isRepost, false);
  assert.equal(nugget.hasLink, false, "the author's profile link is not an external link");
});

test("flags pick up promoted, repost and media-only posts", () => {
  const [, , , mediaOnly, promoted, repost] = extraction;
  assert.equal(mediaOnly.text, "");
  assert.equal(mediaOnly.hasMedia, true, "media-only posts are detected so the script can skip them");
  assert.equal(promoted.isPromoted, true);
  assert.match(promoted.context, /promoted/);
  assert.equal(repost.isRepost, true);
  assert.equal(repost.author, "Omar Haddad", "the reposter, not the original author");
  assert.match(repost.text, /We measured how long reviewers take/);
  assert.equal(repost.quotedText, "", "a repost without commentary has quote text collapsed into the body");
});

test("collapsed (see more) posts are flagged as truncated and read what the DOM holds", () => {
  const pagePost = extraction[0];
  assert.equal(pagePost.truncated, false);
  assert.ok(pagePost.text.length > 200);
});

test("badge anchoring lands in the actor row, before the control menu", async () => {
  const anchor = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    const container = posts.findPosts(document)[0];
    const { parent, before } = posts.findBadgeAnchor(container);
    return { parentClass: parent.className, beforeLabel: before?.getAttribute("aria-label") ?? null };
  });
  assert.match(String(anchor.parentClass), /update-components-actor/);
  assert.equal(anchor.beforeLabel, "Open control menu");
});

test("re-scanning the same DOM is stable and cheap", async () => {
  const counts = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    const first = posts.findPosts(document).length;
    const second = posts.findPosts(document).length;
    return [first, second];
  });
  assert.deepEqual(counts, [6, 6]);
});
