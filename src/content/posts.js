/**
 * LinkedIn DOM discovery + post extraction.
 *
 * LinkedIn ships obfuscated, frequently-changing class names, so discovery is
 * layered, cheapest and most stable first:
 *
 *   1. `data-urn` / `data-id` hooks (activity, ugcPost, share, comment)
 *   2. class-substring matches (`feed-shared-update-v2`, actor blocks)
 *   3. **text anchors**: the post action bar. LinkedIn has relabelled its CSS and
 *      restructured its components many times, but the words "Like / Comment /
 *      Repost / Send" next to an author link have not changed in a decade. This
 *      path needs no class names at all, so layout churn cannot silently disable
 *      the extension.
 *
 * Everything here is pure DOM reading — it never mutates the page, which keeps it
 * testable against fixture markup.
 */

/** Containers that hold one feed post. Ordered most-stable first. */
export const POST_SELECTORS = [
  "div[data-urn^='urn:li:activity']",
  "div[data-urn^='urn:li:ugcPost']",
  "div[data-urn^='urn:li:share']",
  "div[data-id^='urn:li:activity']",
  "div[data-id^='urn:li:ugcPost']",
  "div[data-id^='urn:li:share']",
  "div.feed-shared-update-v2",
  "[class*='fie-impression-container']",
  "[data-testid='mainFeed'] .feed-shared-update-v2",
];

/**
 * Every direct child of the feed list. Too loose for discovery (it matches the
 * share box, sort bar and "Recommended for you" modules), but it is the one hook
 * that tells a human what the feed is made of when nothing else matches.
 */
const FEED_ITEM_SELECTOR = "[data-testid='mainFeed'] > div";

/** Content that looks like a post but must never be scored. */
const EXCLUDE_SELECTORS = [
  ".comments-comment-item",
  ".comments-comment-entity",
  "[data-urn^='urn:li:comment']",
  ".comment-item",
  ".feed-shared-update-v2__comments-container",
  "[class*='comments-comment']",
];

const TEXT_SELECTORS = [
  "[data-testid='expandable-text-box']",
  "[class*='update-components-text']",
  ".feed-shared-text",
  "[class*='attributed-text-segment-list']",
  "[class*='feed-shared-update-v2__description']",
  "[class*='update-components-update-v2__commentary']",
];

const AUTHOR_SELECTORS = [
  "[class*='update-components-actor__title']",
  "[class*='update-components-actor__name']",
  ".feed-shared-actor__name",
  "[class*='actor__title']",
];

const HEADLINE_SELECTORS = [
  "[class*='update-components-actor__description']",
  ".feed-shared-actor__description",
  "[class*='actor__sub-description']",
];

const HEADER_SELECTORS = [
  "[class*='update-components-actor']",
  ".feed-shared-actor",
  "[class*='update-components-header']",
  "[class*='header__text-view']",
  "[class*='feed-shared-header']",
];

const ACTOR_SELECTORS = "[class*='update-components-actor'], .feed-shared-actor";

/**
 * The words in a post's action bar. Kept in one place: discovery depends on them.
 * `reply` is deliberately excluded — that is a comment's give-away.
 */
const ACTION_LABELS = ["like", "comment", "repost", "share", "send"];
const NON_POST_LABELS = ["reply", "load more comments", "add a comment"];

/** An author identity link: a post always has one, an ad placeholder does not. */
const AUTHOR_LINK_SELECTOR =
  "a[href*='/in/'], a[href*='/company/'], a[href*='/school/'], a[href*='/showcase/'], a[href*='/newsletters/']";

const AGGREGATE_TAGS = new Set(["BODY", "HTML", "MAIN"]);

/** Collapse whitespace and drop zero-width noise, without touching wording. */
export function normalizeText(input) {
  return (input ?? "")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstText(root, selectors, { maxLength = 120 } = {}) {
  for (const selector of selectors) {
    const nodes = root.querySelectorAll(selector);
    for (const node of nodes) {
      const text = normalizeText(node.textContent);
      if (text) return text.split("\n")[0].slice(0, maxLength);
    }
  }
  return "";
}

/** Visible text of a node with any embedded controls ("… more") left out. */
function bodyText(node) {
  if (!node.querySelector("button")) return normalizeText(node.textContent);
  const clone = node.cloneNode(true);
  for (const button of clone.querySelectorAll("button")) button.remove();
  return normalizeText(clone.textContent);
}

/** The post's first social action button, or null. Comments always follow it. */
function actionBarOf(container) {
  for (const button of container.querySelectorAll("button, [role='button']")) {
    const label = actionLabelOf(button);
    if (label && !label.startsWith("-")) return button;
  }
  return null;
}

/** Whether `node` sits after the post's action bar (i.e. inside the comment thread). */
function afterActionBar(bar, node) {
  return Boolean(bar) && !bar.contains(node) && Boolean(bar.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** `display: contents` wrappers have no box: no rect, no intersection, no outline. */
function unwrapBoxless(element) {
  const view = element.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return element;
  let node = element;
  while (node.childElementCount === 1 && view.getComputedStyle(node).display === "contents") node = node.firstElementChild;
  return node;
}

function isExcluded(element) {
  return Boolean(element.closest(EXCLUDE_SELECTORS.join(",")));
}

/** The action-bar word this element represents, if any. */
function actionLabelOf(element) {
  const aria = (element.getAttribute("aria-label") ?? "").trim().toLowerCase();
  const text = normalizeText(element.textContent).toLowerCase();
  for (const label of ACTION_LABELS) {
    if (aria === label || aria.startsWith(`${label} `) || text === label) return label;
  }
  for (const label of NON_POST_LABELS) {
    if (aria === label || aria.startsWith(`${label} `) || text === label) return `-${label}`;
  }
  return null;
}

/**
 * Find post containers **without** relying on any class name: locate social action
 * bars, then walk up to the lowest ancestor that also holds the author's identity
 * link and enough text to be a post body.
 *
 * A comment's "Like" button walks up into the enclosing post, which is the right
 * answer anyway — the post is what we wanted to score.
 */
export function findActionBarPosts(root = document) {
  const labelCache = new Map();
  const misses = new Set();
  const found = new Set();

  const labelsUnder = (element) => {
    if (labelCache.has(element)) return labelCache.get(element);
    const labels = new Set();
    for (const button of element.querySelectorAll("button, [role='button']")) {
      const label = actionLabelOf(button);
      if (label && !label.startsWith("-")) labels.add(label);
    }
    labelCache.set(element, labels);
    return labels;
  };

  const looksLikePost = (element) => {
    if (AGGREGATE_TAGS.has(element.tagName)) return false;
    if (isExcluded(element)) return false;
    if (!element.querySelector(AUTHOR_LINK_SELECTOR)) return false;
    const labels = labelsUnder(element);
    if (labels.size < 2) return false; // needs a real post action bar
    // Comments/videos have their own single-purpose bars; a post bar has repost/share/send.
    if (!["repost", "share", "send"].some((label) => labels.has(label))) return false;
    if (normalizeText(element.textContent).length < 120) return false;
    if (element.querySelector("[class*='comments-comment'], [data-urn^='urn:li:comment']")) return false;
    return true;
  };

  for (const button of root.querySelectorAll("button, [role='button']")) {
    if (!actionLabelOf(button)) continue;
    let node = button.parentElement;
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      if (AGGREGATE_TAGS.has(node.tagName)) break;
      if (misses.has(node)) continue;
      if (looksLikePost(node)) {
        found.add(node);
        break;
      }
      misses.add(node); // bars from the same post share ancestors
    }
  }
  return [...found];
}

/**
 * Drop containers that wrap several other candidate posts (a feed or a cluster),
 * while keeping a repost wrapper (which contains exactly one nested post) so the
 * reposter's framing stays part of what we judge.
 */
function dropAggregates(list) {
  return list.filter((element) => {
    const descendants = list.filter((other) => other !== element && element.contains(other));
    const topMost = descendants.filter((inner) => !descendants.some((other) => other !== inner && other.contains(inner)));
    return topMost.length <= 1;
  });
}

/**
 * Find top-level feed posts under `root`.
 * @returns {HTMLElement[]}
 */
export function findPosts(root = document) {
  const candidates = new Set();
  for (const selector of POST_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (isExcluded(element)) continue;
      candidates.add(element);
    }
  }
  for (const element of findActionBarPosts(root)) candidates.add(element);

  const aggregated = dropAggregates([...candidates]);
  return aggregated
    .filter((element) => !aggregated.some((other) => other !== element && other.contains(element)))
    .map(unwrapBoxless);
}

const NESTED_POST_SELECTOR = ".feed-shared-update-v2, [data-urn]";

/** Whether `node` belongs to a reposted/quoted post nested inside `container`. */
function inNestedPost(container, node) {
  const post = node.closest(NESTED_POST_SELECTOR);
  return Boolean(post) && post !== container && container.contains(post);
}

/**
 * Text blocks of a post, split into the container's own commentary and the text
 * of a nested (reposted/quoted) post.
 */
function collectTextBlocks(container) {
  const bar = actionBarOf(container);
  const own = [];
  const nested = [];
  for (const selector of TEXT_SELECTORS) {
    for (const node of container.querySelectorAll(selector)) {
      if (isExcluded(node) || afterActionBar(bar, node)) continue;
      const text = bodyText(node);
      if (!text) continue;
      (inNestedPost(container, node) ? nested : own).push({ text, node });
    }
  }
  if (!own.length && !nested.length) {
    // Structural fallback: paragraph-ish leaves that are not header or action bar.
    const seen = new Set();
    for (const node of container.querySelectorAll("p, span[dir='ltr']")) {
      if (node.closest(ACTOR_SELECTORS) || node.closest("[class*='social-action-bar']")) continue;
      if (afterActionBar(bar, node)) continue;
      if (node.querySelector("p, span[dir='ltr']")) continue; // prefer leaf nodes
      const text = bodyText(node);
      if (text.length > 30 && !seen.has(text)) {
        seen.add(text);
        own.push({ text, node });
      }
    }
  }
  const longest = (list) => list.sort((a, b) => b.text.length - a.text.length)[0] ?? { text: "", node: null };
  const best = longest(own);
  return { own: best.text, ownNode: best.node, nested: longest(nested).text };
}

/** Longest text block inside the post, with the actor chrome excluded. */
export function extractText(container) {
  const { own, nested } = collectTextBlocks(container);
  return (own || nested).slice(0, 12_000);
}

function hasMedia(container) {
  const media = container.querySelector(
    "[class*='update-components-image'], [class*='update-components-video'], [class*='update-components-document'], video, [class*='update-components-poll']",
  );
  if (media) return true;
  // Bare <img> that is not an author avatar or icon.
  return [...container.querySelectorAll("img")].some((img) => {
    if (img.closest(ACTOR_SELECTORS)) return false;
    const width = Number(img.getAttribute("width") ?? img.naturalWidth ?? 0);
    return width >= 200 || img.closest("[class*='update-components']");
  });
}

function hasExternalLink(container) {
  return [...container.querySelectorAll("a[href]")].some((a) => {
    if (a.closest(ACTOR_SELECTORS)) return false;
    const href = a.getAttribute("href") ?? "";
    return /^https?:\/\//.test(href) && !/linkedin\.com\/(feed|in|company|school)\b/.test(href);
  });
}

function headerText(container, bodyNode = null) {
  const chunks = [];
  for (const selector of HEADER_SELECTORS) {
    for (const node of container.querySelectorAll(selector)) {
      // Skip nested posts: a repost's inner actor describes the original author.
      if (inNestedPost(container, node)) continue;
      chunks.push(normalizeText(node.textContent));
    }
  }
  if (!chunks.length && bodyNode) {
    // No named header: everything written before the body (name, headline,
    // "Promoted", "X reposted this") is the header.
    for (const node of container.querySelectorAll("p")) {
      if (node.contains(bodyNode) || !(node.compareDocumentPosition(bodyNode) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      chunks.push(normalizeText(node.textContent));
    }
  }
  return chunks.join(" \u00b7 ").slice(0, 600).toLowerCase();
}

const cleanAuthor = (value) =>
  value
    .replace(/\s*[•·]\s*(1st|2nd|3rd\+?|Following).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/**
 * Author name via the named class hooks, falling back to the identity link itself —
 * the link survives class renames, the class names do not.
 */
function extractAuthor(container) {
  const named = cleanAuthor(firstText(container, AUTHOR_SELECTORS));
  if (named) return named;
  for (const link of container.querySelectorAll(AUTHOR_LINK_SELECTOR)) {
    const name = cleanAuthor(firstText(link, ["span", "div"]) || normalizeText(link.textContent));
    if (name) return name; // the avatar link has no text; the name link does
  }
  return "";
}

/**
 * Extract a post's content and metadata.
 *
 * @param {HTMLElement} container
 * @param {{maxTextChars?: number}} [options]
 * @returns {null | {urn, author, headline, text, quotedText, context, isPromoted, isSuggested,
 *   isRepost, hasMedia, hasLink, truncated, digestText}}
 */
export function extractPost(container, options = {}) {
  const maxTextChars = options.maxTextChars ?? 3500;
  const { own, ownNode, nested } = collectTextBlocks(container);
  const header = headerText(container, ownNode);
  const full = own || nested;
  const text = full.slice(0, maxTextChars);
  // Only meaningful when the reposter added their own commentary around a quoted post.
  const quotedText = own && nested && nested !== own ? nested.slice(0, maxTextChars) : "";
  const hasSeeMore = Boolean(
    container.querySelector(
      "button[aria-label*='see more' i], [class*='see-more-less-toggle'], [class*='show-more-less'] button, [data-testid='expandable-text-button']",
    ),
  );

  const isPromoted = /\bpromoted\b/.test(header) || Boolean(container.querySelector("[aria-label*='Promoted' i]"));
  const isSuggested = /\bsuggested\b/.test(header);
  const isRepost = /\breposted\b/.test(header);

  const author = extractAuthor(container);
  const headline = firstText(container, HEADLINE_SELECTORS);

  if (!text && !hasMedia(container)) return null;

  const context = [isPromoted ? "promoted/ad" : null, isSuggested ? "suggested" : null, isRepost ? "repost" : null]
    .filter(Boolean)
    .join(" · ");

  return {
    urn: container.getAttribute("data-urn") || container.getAttribute("data-id") || null,
    author: author || "unknown author",
    headline: headline || "",
    text,
    quotedText,
    context: context || "feed post",
    isPromoted,
    isSuggested,
    isRepost,
    hasMedia: hasMedia(container),
    hasLink: hasExternalLink(container),
    truncated: hasSeeMore || full.length > maxTextChars,
    digestText: `${author}\u0000${text}\u0000${quotedText}`,
  };
}

/**
 * Where to mount the verdict badge inside a post.
 *
 * `floating` means no actor header was recognised (i.e. we found this post by its
 * action bar), so the badge is positioned over the top-right corner of the post
 * instead of being placed in a header row that we cannot identify.
 */
export function findBadgeAnchor(container) {
  for (const selector of HEADER_SELECTORS) {
    for (const header of container.querySelectorAll(selector)) {
      if (inNestedPost(container, header)) continue; // skip the quoted post's header
      const controls = header.querySelector("[class*='control-menu'], [class*='overflow-menu'], button[aria-label*='menu' i]");
      const parent = controls?.parentElement ?? header;
      return { parent, before: controls ?? null, floating: false };
    }
  }
  // No recognisable header: the row holding both the author's name and the post's
  // control menu is the header row. Failing that, the author row; failing that, float.
  const authorLink = [...container.querySelectorAll(AUTHOR_LINK_SELECTOR)].find((link) => normalizeText(link.textContent));
  if (authorLink) {
    const menu = [...container.querySelectorAll("button[aria-label*='menu' i]")].find((button) =>
      button.parentElement !== container && button.parentElement.contains(authorLink),
    );
    if (menu) return { parent: menu.parentElement, before: menu, floating: false };
    const row = authorLink.closest("div, li, header");
    if (row && row !== container) return { parent: row, before: null, floating: false };
  }
  return { parent: container, before: container.firstElementChild, floating: true };
}

/* ------------------------------------------------------------ diagnostics */

const DIAGNOSTIC_SELECTORS = [
  ...POST_SELECTORS,
  FEED_ITEM_SELECTOR,
  "[data-urn]",
  "[class*='update-components-text']",
  "[data-testid='expandable-text-box']",
  AUTHOR_LINK_SELECTOR,
];

/** How many nodes each discovery hook matches on the current page. */
export function selectorReport(root = document) {
  const report = {};
  for (const selector of DIAGNOSTIC_SELECTORS) {
    try {
      report[selector] = root.querySelectorAll(selector).length;
    } catch (error) {
      report[selector] = `invalid: ${error.message}`;
    }
  }
  return report;
}

function describeElement(element) {
  const classes = [...element.classList].slice(0, 3).join(".");
  const data = [...element.attributes]
    .filter((attribute) => attribute.name.startsWith("data-"))
    .map((attribute) => `${attribute.name}=${String(attribute.value).slice(0, 30)}`)
    .slice(0, 3)
    .join(" ");
  return (
    element.tagName.toLowerCase() +
    (element.id ? `#${element.id}` : "") +
    (classes ? `.${classes}` : "") +
    (data ? ` [${data}]` : "")
  );
}

/**
 * A paste-ready picture of the page's post markup: how many nodes each hook
 * matches, the shape of the feed container, and one real post if we found any.
 * This is what the "Copy diagnostics" buttons hand to a human when labels drift.
 */
export function diagnose(root = document) {
  let posts = [];
  let error = null;
  try {
    posts = findPosts(root);
  } catch (thrown) {
    error = String(thrown?.message ?? thrown);
  }

  const feed = root.querySelector("main") ?? root.body ?? root;
  const lines = [];
  let budget = 60;
  const walk = (element, depth) => {
    if (budget-- <= 0 || depth > 4) return;
    lines.push("  ".repeat(depth) + describeElement(element) + ` ~${normalizeText(element.textContent).length}ch`);
    for (const child of element.children) walk(child, depth + 1);
  };
  for (const child of feed?.children ?? []) walk(child, 0);

  const sample = posts[0]?.outerHTML?.replace(/\s+/g, " ").slice(0, 1200) ?? null;

  return {
    url: typeof location === "undefined" ? null : location.href,
    postsFound: posts.length,
    actionBarPosts: (() => {
      try {
        return findActionBarPosts(root).length;
      } catch {
        return null;
      }
    })(),
    error,
    selectorCounts: selectorReport(root),
    totalElements: root.querySelectorAll("*").length,
    feedStructure: lines.join("\n"),
    samplePostHtml: sample,
  };
}
