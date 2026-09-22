/**
 * Builds the GitHub Pages site in `docs/` (which Pages serves from `main`).
 *
 * What it does:
 *   1. renders PRIVACY.md into docs/privacy.html — the privacy policy the stores
 *      link to, generated so the policy text has exactly one source of truth;
 *   2. copies the listing screenshots into docs/assets/ so the site is self-contained
 *      (Pages only serves the /docs folder);
 *   3. writes docs/.nojekyll so Pages serves the files as-is.
 *
 * docs/index.html and docs/style.css are hand-written source, not generated.
 *
 * Usage: node scripts/build-site.mjs
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = resolve(root, "docs");
const assetsDir = resolve(docsDir, "assets");

export const SITE_URL = "https://pikaryu729.github.io/deslopify/";

/* --------------------------------------------------- tiny markdown subset */

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline markdown: code, bold, italic, links, and <https://…> autolinks. */
export function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,)]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * Renders the subset of markdown used by the project's documents: headings,
 * paragraphs, bullet and numbered lists, horizontal rules, and inline markup.
 * Anything else is passed through as text, escaped.
 */
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let list = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const text = heading[2];
      out.push(`<h${level} id="${slug(text)}">${inline(escapeHtml(text))}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      out.push("<hr />");
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }
    // Lazy continuation: a wrapped line inside a list item belongs to that item,
    // not to a new paragraph (markdown's own rule, and source docs wrap at ~100 cols).
    if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

/* --------------------------------------------------------------- document */

export function policyDocument({ title, markdown, siteUrl }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="Privacy policy for the Deslopify browser extension." />
    <link rel="icon" href="assets/icon-128.png" />
    <link rel="stylesheet" href="style.css" />
    <link rel="canonical" href="${siteUrl}privacy.html" />
  </head>
  <body class="doc">
    <header class="site-header">
      <a class="brand" href="index.html">
        <img src="assets/wordmark-dark.png" alt="Deslopify" width="116" height="40" />
      </a>
      <nav>
        <a href="index.html">Home</a>
        <a href="privacy.html" aria-current="page">Privacy</a>
        <a href="https://github.com/Pikaryu729/deslopify">Source</a>
      </nav>
    </header>
    <main class="prose">
${renderMarkdown(markdown)
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}
    </main>
    <footer class="site-footer">
      <p>
        Deslopify is not affiliated with, endorsed by, or sponsored by LinkedIn Corporation or TypeSafe.
        LinkedIn is a trademark of LinkedIn Corporation.
      </p>
      <p><a href="index.html">Home</a> · <a href="https://github.com/Pikaryu729/deslopify">Source</a></p>
    </footer>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

const policy = await readFile(resolve(root, "PRIVACY.md"), "utf8");
await mkdir(assetsDir, { recursive: true });

await writeFile(
  resolve(docsDir, "privacy.html"),
  policyDocument({ title: "Deslopify — privacy policy", markdown: policy, siteUrl: SITE_URL }),
);
await writeFile(resolve(docsDir, ".nojekyll"), "");

const screenshots = [
  "screenshot-1-feed.png",
  "screenshot-2-explanation.png",
  "screenshot-3-popup.png",
  "screenshot-4-settings.png",
  "promo-tile-440x280.png",
  "icon-128.png",
];
for (const file of screenshots) {
  await copyFile(resolve(root, "store/assets", file), resolve(assetsDir, file));
}
await copyFile(resolve(root, "assets/wordmark-dark.png"), resolve(assetsDir, "wordmark-dark.png"));
await copyFile(resolve(root, "assets/promo.mp4"), resolve(assetsDir, "promo.mp4"));

console.log(`site built: docs/privacy.html (${policy.split("\n").length} lines of policy) + ${screenshots.length} assets`);
