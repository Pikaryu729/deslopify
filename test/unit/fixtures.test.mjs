/**
 * Regression tests for the fixture-serving helper.
 *
 * The bug this guards: a naive `<style>` regex matched a `<style>` mention inside a
 * fixture's doc comment, deleted the real stylesheet, and left the `<link>` inside
 * the comment. Nothing failed — the page just rendered unstyled, so an e2e test
 * silently stopped reproducing the condition it existed to reproduce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { withExternalCss } from "../serve-fixture.mjs";
import { readFixture } from "../mock-typesafe-server.mjs";

test("a real style block becomes a link, and its CSS is returned", () => {
  const { body, css } = withExternalCss(
    "<html><head><title>t</title><style>.a { display: contents }</style></head><body><p>x</p></body></html>",
    "slug",
  );
  assert.equal(css, ".a { display: contents }");
  assert.match(body, /<link rel="stylesheet" href="\/fixture-slug\.css" \/>/);
  assert.equal(body.includes("<style>"), false, "the inline block is gone");
  assert.match(body, /<p>x<\/p>/, "the document body is untouched");
});

test("a comment that mentions <style> cannot eat the real stylesheet", () => {
  const html =
    "<!doctype html>\n<!-- layout lives in a <style> block, not inline -->\n" +
    "<html><head><style>.sdui-item { display: contents }</style></head><body><p>x</p></body></html>";
  const { body, css } = withExternalCss(html, "sdui");
  assert.equal(css, ".sdui-item { display: contents }", "the real stylesheet is extracted");
  assert.match(body, /<link rel="stylesheet" href="\/fixture-sdui\.css" \/>/);
  assert.match(body, /<body><p>x<\/p><\/body>/, "the rest of the document survives");
  // The link must be real markup, not buried in a comment.
  const linkIndex = body.indexOf('<link rel="stylesheet"');
  assert.ok(linkIndex > -1 && !body.slice(0, linkIndex).includes("<!--"), "the link is not inside a comment");
});

test("a fixture with no stylesheet is served unchanged", () => {
  const html = "<html><head><title>t</title></head><body><p>x</p></body></html>";
  const { body, css } = withExternalCss(html, "none");
  assert.equal(css, "");
  assert.equal(body, html);
});

test("every fixture in the repo yields the CSS it actually needs", async () => {
  for (const name of ["linkedin-feed", "linkedin-feed-obfuscated", "linkedin-feed-sdui"]) {
    const raw = await readFixture(name);
    const { body, css } = withExternalCss(raw, name);
    if (raw.includes("<style>")) {
      assert.ok(css.trim().length > 0, `${name}: has a style block, so CSS must be extracted`);
      assert.ok(!body.includes("<style>"), `${name}: inline block replaced`);
    }
    assert.equal(body.includes("</html>"), true, `${name}: document still complete`);
  }
});

test("the SDUI fixture still declares display: contents in its stylesheet", async () => {
  const raw = await readFixture("linkedin-feed-sdui");
  const { css } = withExternalCss(raw, "sdui");
  assert.match(css, /\.sdui-item\s*\{\s*display:\s*contents/);
  assert.equal(raw.includes('style="display: contents"'), false, "no inline styles: they would be CSP-blocked");
  assert.equal(/<video[^>]*src=/.test(raw), false, "no media src that the test CSP would block");
});
