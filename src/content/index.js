import ext from "../shared/webext.js";
import { MSG } from "../shared/messages.js";
import { getSettingsCached, configProblem } from "../shared/settings.js";
import { digest } from "../shared/hash.js";
import { extractPost, findPosts, diagnose } from "./posts.js";
import {
  applyVerdict,
  clearHighlights,
  collapsePost,
  markError,
  markPending,
  markSkipped,
  openPanel,
  removeBadge,
  uncollapsePost,
} from "./render.js";

const DWELL_MS = 250; // how long a post must stay on screen before we spend a request
const VISIBLE_RATIO = 0.35;
const MAX_AUTO_RETRIES = 2;

const records = new Map(); // container -> record (kept strong: we clear on teardown)
let settings = null;
let visibilityObserver = null;
let mutationObserver = null;
let scanTimer = null;
let bannerEl = null;
let started = false;

/* ------------------------------------------------------------------ setup */

function makeObserver() {
  visibilityObserver?.disconnect();
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < VISIBLE_RATIO) continue;
        const record = records.get(entry.target);
        if (!record || record.status !== "idle") continue;
        record.timer = setTimeout(() => enqueue(record), DWELL_MS);
      }
    },
    { threshold: [VISIBLE_RATIO] },
  );
  for (const container of records.keys()) visibilityObserver.observe(container);
}

function scheduleScan(delay = 250, reextract = true) {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    try {
      scan(reextract);
    } catch (error) {
      // A single bad pass must never be able to silence the extension.
      console.warn("[Deslopify] scan failed", error);
    }
  }, delay);
}

/** Only rescan for mutations that could contain a post. LinkedIn mutates constantly. */
const RELEVANT_MUTATION_SELECTOR = [
  "[data-urn]",
  "[data-id^='urn:li:']",
  "[class*='feed-shared-update-v2']",
  "[class*='fie-impression-container']",
  "button[aria-label='Like' i]",
  "button[aria-label='Comment' i]",
  "button[aria-label='Repost' i]",
  "[data-lazy-mount-id]",
  "[data-testid='expandable-text-box']",
].join(",");

function mutationMatters(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      try {
        if (node.matches?.(RELEVANT_MUTATION_SELECTOR) || node.querySelector?.(RELEVANT_MUTATION_SELECTOR)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------- scan */

/**
 * Find posts and (re)queue them for classification.
 *
 * @param {boolean} reextract when false, only look for posts we have not seen
 *   before. The periodic safety scan uses that: re-reading every post's text on a
 *   long feed every few seconds is wasted work, and real content changes always
 *   arrive as post-shaped mutations.
 */
function scan(reextract = true) {
  if (!settings?.enabled) return;
  const containers = findPosts(document);
  const live = new Set(containers);

  for (const container of records.keys()) {
    if (!live.has(container) || !container.isConnected) teardownRecord(container);
  }

  for (const container of containers) {
    const existing = records.get(container);
    if (existing && !reextract) continue;
    let post;
    try {
      post = extractPost(container, { maxTextChars: settings.maxTextChars });
    } catch {
      post = null;
    }

    if (!post || !post.text) {
      if (!records.has(container)) {
        records.set(container, { status: "skipped", container, post });
        markSkipped(container, post ? "Media-only post" : "No text to analyse");
      }
      continue;
    }

    const contentDigest = digest(post.digestText);
    const previous = records.get(container);
    if (previous?.digest === contentDigest && !isDueForRetry(previous)) {
      previous.post = post;
      continue;
    }
    if (previous?.timer) clearTimeout(previous.timer);
    records.set(container, { status: "idle", container, post, digest: contentDigest, attempts: previous?.attempts ?? 0 });
    visibilityObserver.observe(container);

    // Prefetch posts that are already on screen when the extension loads.
    const rect = container.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    if (onScreen) records.get(container).timer = setTimeout(() => enqueue(records.get(container)), DWELL_MS);
  }
}

/* -------------------------------------------------------------- classify */

async function enqueue(record) {
  if (!record || record.status !== "idle") return;
  record.status = "pending";
  record.attempted = true;
  markPending(record.container, settings);

  try {
    const response = await ext.runtime.sendMessage({ type: MSG.CLASSIFY, post: record.post });
    if (!response?.ok) throw Object.assign(new Error(response?.error ?? "Unknown error"), { code: response?.code });

    record.status = "done";
    record.result = response.result;
    record.cached = response.cached;
    paint(record);
  } catch (error) {
    record.status = "error";
    record.error = error;
    record.attempts = (record.attempts ?? 0) + 1;

    if (error?.code === "config") {
      record.status = "idle";
      record.container.classList.remove("deslopify-pending");
      // The user may have fixed the configuration while this request was in flight
      // (the classic "click Try demo mode, or paste a key" moment). Check before
      // saying anything: telling them about a problem they just solved — and
      // overwriting the banner that says demo mode is on — is both wrong and rude.
      const current = await getSettingsCached();
      if (configProblem(current)) {
        showBanner(error.message);
      } else {
        record.timer = setTimeout(() => enqueue(record), 150);
      }
      return;
    }

    markError(record.container, error?.message ?? "Request failed", () => {
      record.status = "idle";
      record.attempts = 0;
      enqueue(record);
    });

    const retryable = !["auth", "bad_request", "bad_response", "unknown_message"].includes(error?.code);
    if (retryable && record.attempts <= MAX_AUTO_RETRIES) {
      record.status = "idle";
      const delay = 3_000 * 2 ** (record.attempts - 1);
      record.timer = setTimeout(() => enqueue(record), delay);
      markPending(record.container, settings);
      record.container.classList.add("deslopify-error");
    }
  }
}

/**
 * Should a scanned post be graded again?
 *
 * Yes when it was attempted and never got a verdict (a missing key, a rejected
 * key, a network failure) — including after the user fixes the problem, which is
 * what makes "switch on demo mode" or "paste a key" take effect immediately.
 * No for posts we have not tried yet (they are graded when they scroll into view,
 * which keeps a settings change from spending money on off-screen posts), no once
 * a post is settled, and no after too many failures per post. `retryUnscored()`
 * resets the counter.
 */
function isDueForRetry(record) {
  if (!record.attempted) return false;
  if (record.status === "done" || record.status === "pending" || record.status === "skipped") return false;
  return (record.attempts ?? 0) < MAX_AUTO_RETRIES;
}

/**
 * Re-attempt every post that has been attempted and still has no verdict, when
 * settings change — a pasted key, a new endpoint, or demo mode being switched on.
 *
 * This deliberately ignores the give-up counter: that counter exists to stop
 * mutation-driven rescans hammering a broken config, and an explicit user change
 * is exactly the signal that says "try again". Posts that were never attempted are
 * left alone so they are graded when they scroll into view, not paid for in bulk.
 */
function retryUnscored() {
  for (const record of records.values()) {
    if (!record.attempted) continue;
    if (record.result || record.status === "pending" || record.status === "skipped") continue;
    if (record.timer) clearTimeout(record.timer);
    record.attempts = 0;
    record.status = "idle";
    record.timer = setTimeout(() => enqueue(record), 150);
  }
}

function paint(record) {
  const { container, result } = record;
  applyVerdict(container, result, settings, {
    onOpen: (anchorHost) =>
      openPanel(anchorHost, result, {
        post: record.post,
        cached: record.cached,
        onRecheck: () => recheck(record),
      }),
  });
  if (settings.hideSlop && result.verdict === "slop") {
    collapsePost(container, result, () => uncollapsePost(container));
  } else {
    uncollapsePost(container);
  }
}

async function recheck(record) {
  record.result = null;
  removeBadge(record.container);
  markPending(record.container, settings);
  record.status = "pending";
  try {
    const response = await ext.runtime.sendMessage({ type: MSG.CLASSIFY, post: record.post, force: true });
    if (!response?.ok) throw Object.assign(new Error(response?.error ?? "Unknown error"), { code: response?.code });
    record.status = "done";
    record.result = response.result;
    record.cached = false;
    paint(record);
  } catch (error) {
    record.status = "error";
    markError(record.container, error?.message ?? "Request failed", () => {
      record.status = "idle";
      recheck(record);
    });
  }
}

/* ------------------------------------------------------------ repaint/UI */

function repaintAll() {
  for (const record of records.values()) {
    if (record.status === "done" && record.result) {
      if (!settings.enabled) continue;
      paint(record);
    } else if (record.status === "pending" && !settings.showPending) {
      record.container.classList.remove("deslopify-pending");
    }
  }
}

function teardownRecord(container) {
  const record = records.get(container);
  if (record?.timer) clearTimeout(record.timer);
  visibilityObserver?.unobserve(container);
  removeBadge(container);
  uncollapsePost(container);
  container.classList.remove("deslopify-post", "deslopify-pending", "deslopify-error", "deslopify-skipped", "deslopify-uncertain", "deslopify-dim");
  delete container.dataset.deslopify;
  records.delete(container);
}

function enable() {
  if (!settings.enabled) return;
  for (const container of document.querySelectorAll(".deslopify-badge-host")) container.remove();
  scan();
}

function disable() {
  for (const container of [...records.keys()]) teardownRecord(container);
  records.clear();
  clearHighlights();
  hideBanner();
}

/* ---------------------------------------------------------------- banner */

const COPY_LABEL = { idle: "Copy diagnostics", busy: "Copying…", done: "Copied", failed: "Press Ctrl+C" };

/**
 * Page-level banner. Used for anything that stops Deslopify working and that the
 * user could not otherwise see: missing credentials, or a page whose markup we no
 * longer recognise. Silence is never an acceptable failure mode here.
 *
 * @param {string} message
 * @param {{actions?: {label: string, onClick: Function}[], tone?: "warn" | "info"}} [options]
 */
function showBanner(message, options = {}) {
  if (bannerEl) {
    bannerEl.querySelector(".deslopify-banner-text").textContent = message;
    return bannerEl;
  }
  bannerEl = document.createElement("div");
  bannerEl.className = "deslopify-banner";
  if (options.tone === "info") bannerEl.dataset.tone = "info";

  const text = document.createElement("span");
  text.className = "deslopify-banner-text";
  text.textContent = message;

  const actions = document.createElement("div");
  actions.className = "deslopify-banner-actions";
  const buttons = (options.actions ?? [{ label: "Open Deslopify settings", onClick: openOptions }]);
  for (const action of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deslopify-banner-button";
    button.textContent = action.label;
    button.addEventListener("click", () => action.onClick(button));
    actions.append(button);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "deslopify-banner-dismiss";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.addEventListener("click", hideBanner);

  bannerEl.append(text, actions, dismiss);
  (document.querySelector("main") ?? document.body).prepend(bannerEl);
  return bannerEl;
}

function hideBanner() {
  bannerEl?.remove();
  bannerEl = null;
}

function openOptions() {
  ext.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }).catch(() => {});
}

/** Switch demo mode on/off from the page banner. */
async function setDemoMode(demoMode) {
  const button = bannerEl?.querySelector(".deslopify-banner-button");
  if (button) button.textContent = "Turning on…";
  // Clear the banner *before* the write: the settings listener renders the new
  // state when it arrives, and a late hide() here would wipe what it drew.
  hideBanner();
  try {
    await ext.runtime.sendMessage({ type: MSG.PATCH_SETTINGS, patch: { demoMode }, clearCache: true });
  } catch {
    showBanner("Could not switch demo mode — open settings and toggle it there.", {
      actions: [{ label: "Open settings", onClick: openOptions }],
    });
  }
}

/**
 * Render whatever banner the current settings call for. Single source of truth for
 * page-level messaging, so no two paths can fight over the banner.
 */
function refreshBanner() {
  hideBanner();
  if (!settings?.enabled) return;
  if (settings.demoMode) {
    showDemoBanner();
    return;
  }
  const problem = configProblem(settings);
  if (problem) {
    showBanner(problem, {
      actions: [
        { label: "Try demo mode (no key)", onClick: () => setDemoMode(true) },
        { label: "Open settings", onClick: openOptions },
        { label: COPY_LABEL.idle, onClick: (button) => copyDiagnostics(button) },
      ],
    });
  }
}

/** Demo mode is on: say so, so a heuristic verdict is never mistaken for a model's. */
function showDemoBanner() {
  showBanner(
    "Demo mode is on: verdicts come from a local heuristic, not an AI model. Add an API key in settings for real grading.",
    {
      tone: "info",
      actions: [
        { label: "Open settings", onClick: openOptions },
        { label: "Keep demo", onClick: hideBanner },
      ],
    },
  );
}

/** Copy the DOM diagnostics to the clipboard, falling back to the console. */
async function copyDiagnostics(button) {
  const report = diagnose();
  const payload = JSON.stringify({ ...report, page: pageStatus() }, null, 1);
  console.info("[Deslopify] diagnostics\n" + payload);
  const setLabel = (key) => {
    if (button) button.textContent = COPY_LABEL[key];
  };
  try {
    await navigator.clipboard.writeText(payload);
    setLabel("done");
  } catch {
    setLabel("failed");
  }
  setTimeout(() => setLabel("idle"), 2_500);
  return payload;
}

/* ------------------------------------------------------------- lifecycle */

/**
 * Live view of what the content script is doing on this page. The popup calls
 * this so a user can tell "nothing is broken, this feed is just short" apart from
 * "LinkedIn changed its markup and nothing matches any more".
 */
function pageStatus() {
  const byVerdict = { golden_nugget: 0, useful: 0, slop: 0 };
  let pending = 0;
  let waiting = 0;
  let errors = 0;
  let skipped = 0;
  for (const record of records.values()) {
    if (record.status === "done" && record.result) byVerdict[record.result.verdict] += 1;
    else if (record.status === "pending") pending += 1;
    else if (record.status === "idle") waiting += 1;
    else if (record.status === "error") errors += 1;
    else if (record.status === "skipped") skipped += 1;
  }
  return {
    enabled: Boolean(settings?.enabled),
    postsFound: records.size,
    pending,
    waiting,
    errors,
    skipped,
    byVerdict,
    url: location.href,
  };
}

/**
 * If a LinkedIn page yields no posts for a while, say so on the page itself
 * (not just in a console nobody opens), with a one-click diagnostics copy.
 */
function warnIfNoPostsMatched() {
  setTimeout(async () => {
    if (!settings?.enabled) return;
    if (records.size > 0) return;
    console.warn(
      `[Deslopify] No posts matched on ${location.pathname}. LinkedIn's markup may have changed — ` +
        "use Copy diagnostics in the banner and see POST_SELECTORS in src/content/posts.js.",
    );
    showBanner("Deslopify is running, but found no posts on this page — LinkedIn's layout may have changed.", {
      actions: [
        { label: COPY_LABEL.idle, onClick: (button) => copyDiagnostics(button) },
        { label: "Open settings", onClick: openOptions },
      ],
    });
  }, 6_000);
}

function watchNavigation() {
  let lastHref = location.href;
  const check = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    registerTab();
    scheduleScan(600);
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function patched(...args) {
      const result = original.apply(this, args);
      setTimeout(check, 0);
      return result;
    };
  }
  window.addEventListener("popstate", check);
  setInterval(check, 2_000); // safety net for SPA navigations we did not intercept
}

async function start() {
  if (started) return;
  started = true;
  // Liveness marker: with this on <html>, "is the script even running?" is a
  // one-line answer in DevTools instead of a guess. Deliberately *not*
  // `data-deslopify`, which is reserved for per-post verdicts.
  document.documentElement.dataset.deslopifyStatus = "active";
  settings = await getSettingsCached();
  console.info(`[Deslopify] active on ${location.pathname} (enabled: ${settings.enabled})`);
  makeObserver();

  mutationObserver = new MutationObserver((mutations) => {
    if (mutationMatters(mutations)) scheduleScan();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  // Safety net for anything the mutation filter does not consider post-like.
  setInterval(() => scheduleScan(0, false), 3_000);

  watchNavigation();
  if (settings.enabled) enable();
  warnIfNoPostsMatched();
  registerTab();
  refreshBanner();
}

/** Tell the background worker this tab exists, so the popup can inspect it. */
async function registerTab() {
  try {
    await ext.runtime.sendMessage({ type: MSG.REGISTER_TAB, payload: { url: location.href } });
  } catch {
    // The worker may be restarting; the next navigation or scan retries.
  }
}

ext.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.PAGE_STATUS) {
    sendResponse(pageStatus());
    return undefined;
  }
  if (message?.type === MSG.DIAGNOSE) {
    sendResponse({ status: pageStatus(), report: diagnose(), settings: { enabled: settings?.enabled } });
    return undefined;
  }
  return undefined;
});

ext.storage.onChanged?.addListener(async (changes, area) => {
  if (area !== "local" || !changes["deslopify:settings"]) return;
  const wasEnabled = settings?.enabled;
  settings = await getSettingsCached();
  if (!settings.enabled) {
    disable();
    return;
  }
  if (!wasEnabled) enable();
  else {
    repaintAll();
    scheduleScan();
    retryUnscored(); // a fixed key, or demo mode, must take effect without scrolling
    refreshBanner();
  }
});

start().catch((error) => console.warn("[Deslopify] failed to start", error));
