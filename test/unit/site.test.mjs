/**
 * The Pages site renders PRIVACY.md with a deliberately small markdown subset.
 * These tests pin the behaviour that the published policy depends on — and that
 * the stores will read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inline, renderMarkdown } from "../../scripts/build-site.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("headings get ids and the right level", () => {
  const html = renderMarkdown("# Title\n\n## What Deslopify reads\n");
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h2 id="what-deslopify-reads">What Deslopify reads<\/h2>/);
});

test("bullet and numbered lists become real lists", () => {
  const html = renderMarkdown("- one\n- two\n\n1. first\n2. second\n");
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test("inline markup: bold, italic, code, links, autolinks", () => {
  assert.equal(inline("a **bold** word"), "a <strong>bold</strong> word");
  assert.equal(inline("_Last updated_"), "<em>Last updated</em>");
  assert.equal(inline("`npm run build`"), "<code>npm run build</code>");
  assert.equal(inline("[text](https://x.test)"), '<a href="https://x.test">text</a>');
  assert.equal(
    inline("see &lt;https://example.test/issues&gt; now"),
    'see <a href="https://example.test/issues">https://example.test/issues</a> now',
  );
});

test("raw HTML in the source cannot inject markup into the page", () => {
  const html = renderMarkdown('Text with <script>alert("x")</script> and <img onerror="x">\n');
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;script&gt;/);
});

test("the real privacy policy renders completely", async () => {
  const markdown = await readFile(resolve(root, "PRIVACY.md"), "utf8");
  const html = renderMarkdown(markdown);
  // Every heading in the source must survive the render.
  const headings = markdown.split("\n").filter((line) => /^#{1,4}\s/.test(line)).length;
  const rendered = html.match(/<h[1-4] /g)?.length ?? 0;
  assert.equal(rendered, headings, "no heading is dropped");
  assert.match(html, /What Deslopify does not do/);
  assert.match(html, /pikaryu729\.github\.io\/deslopify\/privacy\.html/, "the canonical URL is in the policy");
  assert.equal(html.includes("your-contact-email"), false, "the placeholder contact is gone");
  assert.equal(/<p>\s*<\/p>/.test(html), false, "no empty paragraphs");
});

test("the site has the pages the stores will be pointed at", async () => {
  for (const file of ["docs/index.html", "docs/privacy.html", "docs/style.css", "docs/.nojekyll"]) {
    await readFile(resolve(root, file)).catch(() => assert.fail(`missing ${file}`));
  }
  const index = await readFile(resolve(root, "docs/index.html"), "utf8");
  assert.match(index, /href="privacy\.html"/, "the landing page links to the policy");
  assert.match(index, /not affiliated with, endorsed by, or sponsored by LinkedIn/i, "non-affiliation disclaimer");
});
