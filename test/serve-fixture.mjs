/**
 * Test helper: serve a fixture page's stylesheet as an external file.
 *
 * The e2e suite serves the LinkedIn fixtures under a strict `style-src 'self'`
 * policy (as LinkedIn does), so inline `<style>` blocks have to become `<link>`s.
 * Doing that with a naive `/<style>…<\/style>/` replace is a trap: a fixture whose
 * *comment* mentions `<style>` (or any stray `<style>` text before the real block)
 * makes the regex swallow everything up to the real `</style>` — silently deleting
 * the stylesheet and leaving the `<link>` inside a comment. The page then renders
 * unstyled, which quietly changes what the test is testing.
 *
 * So: only look inside `<head>`, ignore comments, and only replace the real block.
 */

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/i;

/**
 * @param {string} html fixture document
 * @param {string} slug name for the generated stylesheet URL
 * @returns {{body: string, css: string}}
 */
export function withExternalCss(html, slug) {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? "" : html.slice(0, headEnd);
  const rest = headEnd === -1 ? html : html.slice(headEnd);

  // Comments in <head> are documentation, not stylesheets.
  const headWithoutComments = head.replace(/<!--[\s\S]*?-->/g, "");
  const css = headWithoutComments.match(STYLE_BLOCK)?.[1] ?? "";
  const rewrittenHead = css
    ? headWithoutComments.replace(STYLE_BLOCK, `<link rel="stylesheet" href="/fixture-${slug}.css" />`)
    : headWithoutComments;

  return { body: rewrittenHead + rest, css };
}
