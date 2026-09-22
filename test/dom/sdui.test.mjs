/**
 * LinkedIn's server-driven feed (2026): `display: contents` item wrappers, the
 * body in `[data-testid=expandable-text-box]` with "… more" inside it, a textless
 * avatar link, "Promoted" as a bare <p>, and non-post modules in the same list.
 * Regression for a field report where 11 "posts" were found and 0 ever scored.
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
  await page.goto(`${server.url}/sdui`);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  extracted = await page.evaluate(() => {
    const posts = globalThis.__deslopify;
    return posts.findPosts(document).map((container) => ({
      display: getComputedStyle(container).display,
      height: container.getBoundingClientRect().height,
      anchor: (() => {
        const { parent, before, floating } = posts.findBadgeAnchor(container);
        return { floating, parentDisplay: getComputedStyle(parent).display, before: before?.getAttribute("aria-label") ?? null };
      })(),
      post: posts.extractPost(container),
    }));
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("only real posts are found, and each container has a box the observer can see", () => {
  assert.equal(extracted.length, 2, "share box and recommendation module are not posts");
  for (const { display, height } of extracted) {
    assert.notEqual(display, "contents");
    assert.ok(height > 0, "a display:contents wrapper would never intersect the viewport");
  }
});

test("body, author and flags survive the SDUI markup", () => {
  const [post, ad] = extracted.map((entry) => entry.post);
  assert.equal(post.author, "Louie Carvalho", "the textless avatar link is skipped in favour of the name link");
  assert.match(post.text, /^In my team, I’m known as an ideas man/);
  assert.equal(post.text.includes("more"), false, "the '… more' button is not part of the body");
  assert.equal(post.text.includes("very long comment"), false, "comments after the action bar are not the body");
  assert.equal(post.truncated, true);
  assert.equal(post.isPromoted, false);

  assert.equal(ad.author, "Delta Air Lines");
  assert.equal(ad.isPromoted, true, "'Promoted' in the header paragraphs marks an ad");
  assert.match(ad.context, /promoted/);
  assert.equal(ad.hasMedia, true);
});

test("the badge lands in the header row, before the control menu", () => {
  for (const { anchor } of extracted) {
    assert.equal(anchor.floating, false);
    assert.equal(anchor.parentDisplay, "flex");
    assert.match(anchor.before, /^Open control menu/);
  }
});
