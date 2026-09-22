/**
 * Paste-into-DevTools page inspector.
 *
 * Use when Deslopify looks dead on a LinkedIn page. Open DevTools on the LinkedIn
 * tab → Console → paste this whole file → Enter. It prints a report and copies it
 * to your clipboard. Nothing is uploaded anywhere; it only reads the DOM.
 *
 * It answers, in order: is the content script alive, did it score anything, does
 * the banner say why, which of Deslopify's discovery hooks match, and what does
 * the feed actually look like.
 */
(() => {
  const SELECTORS = {
    "post: data-urn=activity": "div[data-urn^='urn:li:activity']",
    "post: data-urn=ugcPost": "div[data-urn^='urn:li:ugcPost']",
    "post: data-id=activity": "div[data-id^='urn:li:activity']",
    "post: .feed-shared-update-v2": "div.feed-shared-update-v2",
    "post: any [data-urn]": "[data-urn]",
    "post: action bar (text-anchored)": "button[aria-label='Like' i], button[aria-label='Comment' i]",
    "card: fie-impression-container": "[class*='fie-impression-container']",
    "text: update-components-text": "[class*='update-components-text']",
    "text: expandable-text-box (SDUI feed)": "[data-testid='expandable-text-box']",
    "actor: update-components-actor": "[class*='update-components-actor']",
    "author link": "a[href*='/in/'], a[href*='/company/']",
    "feed root": "[data-testid='mainFeed'], .scaffold-finite-scroll__content",
  };

  const counts = {};
  for (const [label, selector] of Object.entries(SELECTORS)) {
    try {
      counts[label] = document.querySelectorAll(selector).length;
    } catch (error) {
      counts[label] = `INVALID: ${error.message}`;
    }
  }

  const feed = document.querySelector("main") ?? document.body;
  const structure = [];
  let budget = 70;
  const walk = (element, depth) => {
    if (budget-- <= 0 || depth > 4) return;
    const classes = [...element.classList].slice(0, 3).join(".");
    const data = [...element.attributes]
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => `${attribute.name}=${String(attribute.value).slice(0, 28)}`)
      .slice(0, 3)
      .join(" ");
    structure.push(
      "  ".repeat(depth) +
        element.tagName.toLowerCase() +
        (element.id ? `#${element.id}` : "") +
        (classes ? `.${classes}` : "") +
        (data ? ` [${data}]` : "") +
        ` ~${(element.textContent ?? "").trim().length}ch`,
    );
    for (const child of element.children) walk(child, depth + 1);
  };
  for (const child of feed?.children ?? []) walk(child, 0);

  const firstScored = document.querySelector("[data-deslopify]");

  const report = {
    url: location.href,
    // "active" means the content script is running on this page.
    contentScript: document.documentElement.dataset.deslopifyStatus ?? "NOT RUNNING",
    verdictsOnPage: document.querySelectorAll("[data-deslopify]").length,
    badgesOnPage: document.querySelectorAll(".deslopify-badge-host").length,
    banner: document.querySelector(".deslopify-banner")?.textContent?.trim() ?? null,
    hookCounts: counts,
    totalElements: document.querySelectorAll("*").length,
    feedStructure: structure.join("\n"),
    sampleScoredPostHtml: firstScored?.outerHTML?.replace(/\s+/g, " ").slice(0, 1500) ?? null,
  };

  const json = JSON.stringify(report, null, 1);
  console.log(json);
  try {
    if (typeof copy === "function") copy(json);
    else navigator.clipboard.writeText(json);
    console.log("%cDeslopify: report copied to your clipboard", "color:#2f9e6f;font-weight:bold");
  } catch {
    console.log("Deslopify: select the JSON above and copy it manually");
  }
  return report;
})();
