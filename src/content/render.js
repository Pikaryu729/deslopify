import { VERDICT_META } from "../shared/settings.js";
import { summarise } from "../shared/verdict.js";
import { findBadgeAnchor } from "./posts.js";

const VERDICT_TITLES = {
  golden_nugget: "Golden nugget",
  useful: "Useful",
  slop: "Slop",
};

/** Demo verdicts must never read as if a model produced them. */
const verdictLabel = (result) => `${VERDICT_TITLES[result.verdict]}${result.demo ? " (demo)" : ""}`;

/* --------------------------------------------------------------- helpers */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;

const SHADOW_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 9px 3px 7px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--tint); background: var(--soft); color: var(--ink);
    font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: .01em;
    white-space: nowrap; transition: transform .12s ease, box-shadow .12s ease;
  }
  .pill:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
  .pill:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--tint); flex: none; }
  .conf { font-weight: 500; color: var(--ink); opacity: .68; }
  .flag { font-weight: 500; opacity: .68; }
  .uncertain .dot { box-shadow: 0 0 0 2px var(--soft); }
  :host([data-uncertain="true"]) .pill { border-style: dashed; }
`;

const PANEL_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .panel {
    position: fixed; width: 320px; max-height: 70vh; overflow: auto;
    background: #ffffff; color: #16181d; border: 1px solid rgba(0,0,0,.14);
    border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.28);
    font-size: 12px; line-height: 1.45; padding: 12px; z-index: 2147483000;
  }
  @media (prefers-color-scheme: dark) {
    .panel { background: #1d2025; color: #e8eaed; border-color: rgba(255,255,255,.14); }
    .bar { background: rgba(255,255,255,.12); }
    .row + .row { border-color: rgba(255,255,255,.08); }
    .muted { color: rgba(232,234,237,.6); }
    button { background: rgba(255,255,255,.08); color: #e8eaed; border-color: rgba(255,255,255,.16); }
    button:hover { background: rgba(255,255,255,.14); }
  }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--tint); flex: none; }
  h2 { font-size: 13px; margin: 0; font-weight: 700; }
  .score { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
  .bars { display: grid; gap: 4px; margin: 8px 0 10px; }
  .bar-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 6px; }
  .bar { height: 6px; border-radius: 999px; background: rgba(0,0,0,.1); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; }
  .val { text-align: right; font-variant-numeric: tabular-nums; opacity: .75; }
  .row { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; }
  .row + .row { border-top: 1px solid rgba(0,0,0,.06); }
  .row .name { flex: 1; }
  .up { color: #1f8a5f; } .down { color: #c0392b; }
  @media (prefers-color-scheme: dark) { .up { color: #5ed3a4; } .down { color: #ff8b80; } }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 12px 0 4px; }
  .muted { color: rgba(0,0,0,.55); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .chip { padding: 2px 7px; border-radius: 999px; background: rgba(127,127,127,.16); font-size: 10px; font-weight: 600; }
  footer { display: flex; gap: 6px; margin-top: 12px; }
  button {
    flex: 1; padding: 5px 8px; font-size: 11px; font-weight: 600; cursor: pointer;
    border-radius: 7px; border: 1px solid rgba(0,0,0,.18); background: rgba(0,0,0,.04); color: inherit;
  }
  button:hover { background: rgba(0,0,0,.09); }
  .note { margin-top: 8px; font-size: 11px; }
`;

const tint = (verdict) => VERDICT_META[verdict]?.color ?? "#8a8f98";

/* ---------------------------------------------------------------- badges */

function badgeContent(result, settings) {
  const meta = VERDICT_META[result.verdict] ?? { short: result.verdict };
  const color = tint(result.verdict);
  const soft = `${color}22`;
  const flag = result.uncertain ? "?" : null;
  const label = settings.badgeStyle === "dot" ? null : el("span", { class: "label", text: meta.short });
  return el("button", {
    class: `pill${result.uncertain ? " uncertain" : ""}`,
    type: "button",
    "aria-label": `Deslopify: ${verdictLabel(result)} (${pct(result.confidence)} confidence). Open details.`,
    style: { "--tint": color, "--soft": soft, "--ink": "#16181d" },
  }, [
    el("span", { class: "dot" }),
    label,
    settings.badgeStyle === "dot" ? null : el("span", { class: "conf", text: pct(result.confidence) }),
    flag ? el("span", { class: "flag", text: flag }) : null,
  ]);
}

/** Mount (or replace) the verdict badge for a post. */
export function applyVerdict(container, result, settings, handlers = {}) {
  container.dataset.deslopify = result.verdict;
  container.classList.remove("deslopify-pending", "deslopify-error", "deslopify-skipped");
  container.classList.toggle("deslopify-uncertain", Boolean(result.uncertain));
  container.classList.toggle("deslopify-dim", Boolean(settings.dimSlop && result.verdict === "slop"));
  container.title = `Deslopify: ${verdictLabel(result)} — ${summarise(result)}`;

  removeBadge(container);
  if (!settings.showBadges) return;

  const { parent, before, floating } = findBadgeAnchor(container);
  const host = el("div", { class: `deslopify-badge-host${floating ? " deslopify-badge-host--floating" : ""}` });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", { text: SHADOW_STYLES }));
  const button = badgeContent(result, settings);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handlers.onOpen?.(host, result);
  });
  shadow.append(button);
  parent.insertBefore(host, before);
}

export function removeBadge(container) {
  for (const host of container.querySelectorAll(".deslopify-badge-host")) host.remove();
}

export function markPending(container, settings) {
  if (!settings.showPending) return;
  container.classList.add("deslopify-post", "deslopify-pending");
}

export function markSkipped(container, reason = "No text to analyse") {
  container.classList.add("deslopify-post", "deslopify-skipped");
  container.title = `Deslopify: skipped — ${reason}`;
}

export function markError(container, message, onRetry) {
  container.classList.remove("deslopify-pending");
  container.classList.add("deslopify-post", "deslopify-error");
  removeBadge(container);
  const { parent, before, floating } = findBadgeAnchor(container);
  const host = el("div", { class: `deslopify-badge-host${floating ? " deslopify-badge-host--floating" : ""}` });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", { text: SHADOW_STYLES }));
  const button = el("button", {
    class: "pill",
    type: "button",
    title: message,
    style: { "--tint": "#8a8f98", "--soft": "#8a8f9822", "--ink": "#16181d" },
  }, [
    el("span", { class: "dot" }),
    el("span", { class: "label", text: "Retry" }),
  ]);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRetry?.();
  });
  shadow.append(button);
  parent.insertBefore(host, before);
}

/** Turn a post into a collapsed stub ("hide slop" mode). */
export function collapsePost(container, result, onShow) {
  container.dataset.deslopify = result.verdict;
  container.classList.add("deslopify-hidden");
  if (container.nextElementSibling?.classList?.contains("deslopify-hidden-stub")) return;
  const stub = el("div", { class: "deslopify-hidden-stub" }, [
    el("span", { text: `Hidden by Deslopify — ${summarise(result)}` }),
    el("button", {
      class: "deslopify-hidden-show",
      type: "button",
      text: "Show post",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        container.classList.remove("deslopify-hidden");
        stub.remove();
        onShow?.();
      },
    }),
  ]);
  container.after(stub);
}

export function uncollapsePost(container) {
  container.classList.remove("deslopify-hidden");
  const stub = container.nextElementSibling;
  if (stub?.classList?.contains("deslopify-hidden-stub")) stub.remove();
}

/* ----------------------------------------------------------------- panel */

let panelHost = null;
let panelCleanup = null;

export function closePanel() {
  panelCleanup?.();
  panelHost?.remove();
  panelHost = null;
  panelCleanup = null;
}

function signalRow(signal) {
  const arrow = signal.polarity === 0 ? "" : signal.polarity > 0 ? "↑" : "↓";
  // For negative signals a high value is bad news, so invert the bar's meaning.
  const value = signal.polarity < 0 ? 1 - signal.value : signal.value;
  return el("div", { class: "row" }, [
    el("span", { class: "name", text: signal.label }),
    el("span", { class: "val", text: pct(signal.value) }),
    el("span", { class: signal.contribution >= 0 ? "up" : "down", text: arrow }),
    el("span", { class: "bar", style: { width: "48px" } }, [
      el("span", {
        class: "fill",
        style: { width: `${Math.round(value * 100)}%`, background: tint(signal.contribution >= 0 ? "useful" : "slop") },
      }),
    ]),
  ]);
}

/**
 * Open the details panel for a result.
 * Anchored to the badge, flipped when it would leave the viewport.
 */
export function openPanel(anchor, result, meta = {}) {
  closePanel();
  const color = tint(result.verdict);

  const bars = ["golden_nugget", "useful", "slop"].map((key) =>
    el("div", { class: "bar-row" }, [
      el("span", { text: VERDICT_META[key].label }),
      el("span", { class: "bar" }, [
        el("span", {
          class: "fill",
          style: { width: `${Math.round(result.probabilities[key] * 100)}%`, background: tint(key) },
        }),
      ]),
      el("span", { class: "val", text: pct(result.probabilities[key]) }),
    ]),
  );

  const chips = el("div", { class: "chips" }, [
    result.demo ? el("span", { class: "chip", text: "demo mode — local heuristic" }) : null,
    result.uncertain ? el("span", { class: "chip", text: "low confidence" }) : null,
    result.offTopic ? el("span", { class: "chip", text: "off-topic for you" }) : null,
    result.overridden ? el("span", { class: "chip", text: `rule: ${result.overridden}` }) : null,
    meta.post?.isPromoted ? el("span", { class: "chip", text: "promoted" }) : null,
    meta.post?.isRepost ? el("span", { class: "chip", text: "repost" }) : null,
    meta.cached ? el("span", { class: "chip", text: "cached" }) : null,
  ]);

  const panel = el("div", { class: "panel", role: "dialog", "aria-label": "Deslopify verdict details", style: { "--tint": color } }, [
    el("header", {}, [
      el("span", { class: "dot" }),
      el("h2", { text: verdictLabel(result) }),
      el("span", { class: "score", text: `${result.score > 0 ? "+" : ""}${result.score.toFixed(2)}` }),
    ]),
    el("div", { class: "muted", text: `${summarise(result)} · confidence ${pct(result.confidence)}` }),
    el("div", { class: "bars" }, bars),
    chips.childElementCount ? chips : null,
    result.drivers?.length ? el("h3", { text: "What moved it" }) : null,
    ...(result.drivers ?? []).map((driver) =>
      el("div", { class: "row" }, [
        el("span", { class: driver.direction === "up" ? "up" : "down", text: driver.direction === "up" ? "↑" : "↓" }),
        el("span", { class: "name", text: driver.label }),
        el("span", { class: "val", text: pct(driver.value) }),
      ]),
    ),
    el("h3", { text: "All signals" }),
    ...(result.signals ?? []).map(signalRow),
    el("h3", { text: "Run" }),
    el("div", { class: "muted", text: `${result.model ?? "unknown model"} · ${result.usage?.input_tokens ?? "?"} in / ${result.usage?.output_tokens ?? "?"} out tokens · rubric v${result.rubricVersion}` }),
    el("footer", {}, [
      el("button", {
        type: "button",
        text: "Re-check",
        title: "Ignore the cache and ask jev again",
        onclick: () => {
          meta.onRecheck?.();
          closePanel();
        },
      }),
      el("button", {
        type: "button",
        text: "Copy JSON",
        onclick: async (event) => {
          try {
            await navigator.clipboard.writeText(JSON.stringify({ post: meta.post, result }, null, 2));
            event.currentTarget.textContent = "Copied";
          } catch {
            event.currentTarget.textContent = "Copy failed";
          }
        },
      }),
      el("button", { type: "button", text: "Close", onclick: closePanel }),
    ]),
  ]);

  panelHost = el("div", { class: "deslopify-panel-host" });
  const shadow = panelHost.attachShadow({ mode: "open" });
  shadow.append(el("style", { text: PANEL_STYLES }), panel);
  document.body.append(panelHost);

  // Position under the badge, flipping up/left to stay on screen.
  const rect = anchor.getBoundingClientRect();
  const width = 320;
  const height = Math.min(panel.getBoundingClientRect().height || 320, window.innerHeight * 0.7);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 8;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 8) : below;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  const onKey = (event) => {
    if (event.key === "Escape") closePanel();
  };
  const onOutside = (event) => {
    if (!event.composedPath?.().includes(panelHost)) closePanel();
  };
  const onScroll = (event) => {
    // Scrolling inside the panel is not a reason to dismiss it.
    if (panelHost && event.composedPath?.().includes(panelHost)) return;
    closePanel();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  panelCleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("scroll", onScroll, { capture: true });
  };
}

/* -------------------------------------------------------------- teardown */

export function clearHighlights(root = document) {
  closePanel();
  for (const node of root.querySelectorAll(".deslopify-badge-host, .deslopify-hidden-stub, .deslopify-panel-host")) {
    node.remove();
  }
  for (const node of root.querySelectorAll(".deslopify-post")) {
    node.classList.remove(
      "deslopify-post",
      "deslopify-pending",
      "deslopify-error",
      "deslopify-skipped",
      "deslopify-uncertain",
      "deslopify-dim",
      "deslopify-hidden",
    );
    delete node.dataset.deslopify;
    node.removeAttribute("title");
  }
}
