/**
 * End-to-end test: the real built extension, loaded into Chrome, pointed at the
 * mock TypeSafe endpoint, running against the LinkedIn-shaped fixture page.
 *
 * This is the "does it actually work while scrolling" test: DOM discovery →
 * message to the background worker → HTTP call → verdict math → highlight and
 * badge in the page → cache on re-scroll → failure UI.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { startMockServer, readFixture } from "../mock-typesafe-server.mjs";
import { withExternalCss } from "../serve-fixture.mjs";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../../src/shared/settings.js";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "../../dist/chrome");
const FEED_URL = "https://www.linkedin.com/feed/";

/** 1x1 transparent PNG, so the fixture's images decode without network access. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const URN = {
  nugget: "urn:li:activity:7300000000000000001",
  useful: "urn:li:activity:7300000000000000002",
  slop: "urn:li:activity:7300000000000000003",
  mediaOnly: "urn:li:activity:7300000000000000004",
  promoted: "urn:li:activity:7300000000000000005",
  repost: "urn:li:activity:7300000000000000006",
};

let server;
let context;
let page;
let serviceWorker;
let userDataDir;
const consoleErrors = [];

/**
 * The extension only runs on linkedin.com, so the fixture is served by intercepting
 * that origin. That way the shipped match patterns and host permissions are what
 * gets exercised, and nothing touches the real network.
 *
 * The fixture's own inline stylesheet is served as an external file so the page can
 * ship a strict Content-Security-Policy (`style-src 'self'`, no 'unsafe-inline') —
 * i.e. the same kind of policy LinkedIn serves. Anything Deslopify injects must
 * therefore survive strict CSP, which is exactly what we want to prove.
 */
async function serveFixtureOnLinkedIn(target) {
  const raw = await readFixture();
  const obfuscatedRaw = await readFixture("linkedin-feed-obfuscated");
  const sduiRaw = await readFixture("linkedin-feed-sdui");
  const empty = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feed | LinkedIn</title></head>
<body><div id="root"><main><div class="scaffold-finite-scroll__content" data-testid="mainFeed"></div></main></div></body></html>`;

  const standard = withExternalCss(raw, "standard");
  const obfuscated = withExternalCss(obfuscatedRaw, "obfuscated");
  const sdui = withExternalCss(sduiRaw, "sdui");
  const csp = "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'";

  await target.route("https://www.linkedin.com/**", (route) => {
    const url = route.request().url();
    if (url.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
    const cssMatch = url.match(/\/fixture-(standard|obfuscated|sdui)\.css$/);
    if (cssMatch) {
      const sheet = { standard, obfuscated, sdui }[cssMatch[1]];
      return route.fulfill({ status: 200, contentType: "text/css", body: sheet.css });
    }
    const html = url.includes("obfuscated")
      ? obfuscated.body
      : url.includes("sdui")
        ? sdui.body
        : url.includes("empty")
          ? empty
          : standard.body;
    return route.fulfill({ status: 200, contentType: "text/html", headers: { "content-security-policy": csp }, body: html });
  });
}

/** Clear the verdict cache through the background worker's own storage. */
async function clearCache() {
  await serviceWorker.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith("deslopify:cache:"));
    if (keys.length) await chrome.storage.local.remove(keys);
  });
}

async function writeSettings(patch) {
  await serviceWorker.evaluate(
    async ([key, settings]) => {
      await chrome.storage.local.set({ [key]: settings });
    },
    [STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS, apiKey: "ts_e2e_key", baseUrl: server.endpoint, ...patch }],
  );
}

async function scrollWholeFeed(target = page) {
  const height = await target.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await target.evaluate((top) => window.scrollTo(0, top), y);
    await target.waitForTimeout(120);
  }
  await target.evaluate(() => window.scrollTo(0, 0));
}

async function waitForVerdict(urn, verdict, timeout = 30_000) {
  await page.waitForFunction(
    ([target, expected]) => document.querySelector(`[data-urn="${target}"]`)?.dataset.deslopify === expected,
    [urn, verdict],
    { timeout },
  );
}

/** Wait until every text post in the fixture has a verdict. */
async function waitForAllVerdicts(timeout = 40_000) {
  await page.waitForFunction(
    () => document.querySelectorAll("[data-deslopify]").length >= 5,
    undefined,
    { timeout },
  );
}

/** Wait for request logging to stop growing. */
async function waitForRequestSettle(quietMs = 400, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    if (server.requests.length !== last) {
      last = server.requests.length;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > quietMs) return;
    await new Promise((resolve_) => setTimeout(resolve_, 50));
  }
}

/** Poll the extension's stored settings (saves are debounced in the UI). */
async function waitForSetting(key, predicate, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const settings = await serviceWorker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], STORAGE_KEYS.settings);
    if (predicate(settings)) return settings;
    await new Promise((resolve_) => setTimeout(resolve_, 100));
  }
  throw new Error(`setting ${key} never matched`);
}

before(async () => {
  await access(resolve(DIST, "manifest.json")).catch(() => {
    throw new Error("dist/chrome is missing — run `npm run build` first");
  });

  server = await startMockServer();
  userDataDir = await mkdtemp(resolve(tmpdir(), "deslopify-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });

  serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // Point the extension at the mock endpoint and give it a key.
  await writeSettings({ concurrency: 2, requestsPerMinute: 600, model: "jev-latest" });

  await serveFixtureOnLinkedIn(context);
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  await page.goto(FEED_URL);
});

after(async () => {
  await context?.close();
  await server?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("posts get verdicts as the feed is scrolled", async () => {
  await scrollWholeFeed();
  await waitForVerdict(URN.nugget, "golden_nugget");
  await waitForVerdict(URN.useful, "useful");
  await waitForVerdict(URN.slop, "slop");
  await waitForVerdict(URN.promoted, "useful");
  await waitForVerdict(URN.repost, "useful");

  const verdicts = await page.evaluate(() =>
    [...document.querySelectorAll("[data-deslopify]")].map((node) => [node.dataset.urn, node.dataset.deslopify]),
  );
  assert.equal(verdicts.length, 5, "five text posts are scored; the media-only post is skipped");
  assert.equal(verdicts.some(([urn]) => urn === URN.mediaOnly), false);
});

test("every request carried the API key and a valid question payload", async () => {
  assert.equal(server.requests.length, 5, "one call per text post");
  for (const request of server.requests) {
    assert.equal(request.headers.authorization, "Bearer ts_e2e_key");
    assert.equal(request.body.model, "jev-latest");
    assert.equal(request.body.state.post.text.length > 40, true, "post text reaches the prompt");
    assert.equal(typeof request.body.state.reader.interests, "string");
    assert.equal(Object.keys(request.body.questions).length, 11, "the full rubric ships in one call");
  }
});

test("badges render in the actor row with the verdict label and confidence", async () => {
  const badge = page.locator(`[data-urn="${URN.nugget}"] .deslopify-badge-host .pill`);
  await badge.waitFor({ timeout: 10_000 });
  assert.match(await badge.innerText(), /Nugget/i);
  assert.match(await badge.innerText(), /\d+%/);

  const slopBadge = page.locator(`[data-urn="${URN.slop}"] .deslopify-badge-host .pill`);
  assert.match(await slopBadge.innerText(), /Slop/i);

  const insideActor = await page.evaluate(
    ([urn]) => Boolean(document.querySelector(`[data-urn="${urn}"] .update-components-actor .deslopify-badge-host`)),
    [URN.nugget],
  );
  assert.equal(insideActor, true);
});

test("highlighting uses the verdict colour on the post container", async () => {
  const shadow = await page.evaluate(
    ([urn]) => {
      const post = document.querySelector(`[data-urn="${urn}"]`);
      return getComputedStyle(post).boxShadow;
    },
    [URN.nugget],
  );
  assert.match(shadow, /240, 180, 41/, "golden nugget highlight");

  const slopShadow = await page.evaluate(
    ([urn]) => getComputedStyle(document.querySelector(`[data-urn="${urn}"]`)).boxShadow,
    [URN.slop],
  );
  assert.match(slopShadow, /217, 83, 79/, "slop highlight");
});

test("clicking a badge opens the explanation panel", async () => {
  await page.locator(`[data-urn="${URN.slop}"] .deslopify-badge-host .pill`).click();
  const panel = page.locator(".deslopify-panel-host .panel");
  await panel.waitFor({ timeout: 5_000 });
  const text = await panel.innerText();
  assert.match(text, /Slop/);
  assert.match(text, /What moved it/i);
  assert.match(text, /All signals/i);
  assert.match(text, /Engagement bait/i);
  assert.match(text, /jev-1\.13\.0/, "the live model name is shown");
  await page.keyboard.press("Escape");
  await assert.doesNotReject(() => panel.waitFor({ state: "detached", timeout: 5_000 }));
});

test("highlighting survives a strict Content-Security-Policy", async () => {
  const csp = await page.evaluate(() =>
    fetch(location.href)
      .then((response) => response.headers.get("content-security-policy"))
      .catch(() => null),
  );
  assert.match(String(csp), /style-src 'self'/, "the fixture really is serving a strict style policy");

  // The badge lives in a shadow root with its own stylesheet: prove the styles landed.
  const pillStyles = await page.evaluate(([urn]) => {
    const host = document.querySelector(`[data-urn="${urn}"] .deslopify-badge-host`);
    const pill = host?.shadowRoot?.querySelector(".pill");
    if (!pill) return null;
    const styles = getComputedStyle(pill);
    return {
      display: styles.display, // blockified to "flex" when the host is a flex container
      radius: styles.borderRadius,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      cursor: styles.cursor,
    };
  }, [URN.nugget]);
  assert.ok(pillStyles, "the badge rendered");
  assert.match(pillStyles.display, /^(inline-)?flex$/, "shadow-root badge styles are applied under strict CSP");
  assert.equal(pillStyles.radius, "999px");
  assert.equal(pillStyles.fontSize, "11px");
  assert.equal(pillStyles.fontWeight, "600");
  assert.equal(pillStyles.cursor, "pointer");

  // The highlight on LinkedIn's own node comes from the manifest stylesheet.
  const postShadow = await page.evaluate(
    ([urn]) => getComputedStyle(document.querySelector(`[data-urn="${urn}"]`)).boxShadow,
    [URN.slop],
  );
  assert.match(postShadow, /217, 83, 79/);
});

test("re-scrolling the feed is served from cache, not the API", async () => {
  const before = server.requests.length;
  await page.reload();
  await scrollWholeFeed();
  await waitForVerdict(URN.nugget, "golden_nugget");
  await waitForVerdict(URN.slop, "slop");
  assert.equal(server.requests.length, before, "cached verdicts must not trigger new API calls");
});

test("a quoted repost sends the original text as quoted_text", async () => {
  const request = server.requests.find((r) => r.body.state.post.context.includes("repost"));
  assert.ok(request, "the repost was classified");
  assert.match(request.body.state.post.text, /We measured how long reviewers take/);
  assert.equal(request.body.state.post.flags.is_repost, true);
});

test("collapsing slop hides the post behind a stub", async () => {
  await writeSettings({ hideSlop: true });

  const stub = page.locator(".deslopify-hidden-stub");
  await stub.first().waitFor({ timeout: 10_000 });
  const hidden = await page.evaluate(
    ([urn]) => getComputedStyle(document.querySelector(`[data-urn="${urn}"]`)).display,
    [URN.slop],
  );
  assert.equal(hidden, "none");

  await stub.first().getByRole("button", { name: "Show post" }).click();
  const shown = await page.evaluate(
    ([urn]) => getComputedStyle(document.querySelector(`[data-urn="${urn}"]`)).display,
    [URN.slop],
  );
  assert.notEqual(shown, "none");
});

test("a 429 from the provider is retried and still produces verdicts", async () => {
  await clearCache();
  server.setScenario("ratelimit");
  const before = server.requests.length;
  await page.reload();
  await scrollWholeFeed();
  await waitForAllVerdicts();
  await waitForRequestSettle();

  // Five posts, two of which were rate limited once each and retried.
  assert.equal(server.requests.length - before, 7, "the rate-limited calls were retried, not dropped");
  server.setScenario("ok");
});

test("a rejected API key surfaces a retry badge instead of a wrong verdict", async () => {
  await clearCache();
  server.setScenario("auth");
  await page.reload();
  await scrollWholeFeed();

  const retry = page.locator(`[data-urn="${URN.nugget}"] .deslopify-badge-host .pill`, { hasText: "Retry" });
  await retry.waitFor({ timeout: 20_000 });
  const verdict = await page.evaluate(
    ([urn]) => document.querySelector(`[data-urn="${urn}"]`).dataset.deslopify ?? null,
    [URN.nugget],
  );
  assert.equal(verdict, null, "no verdict is shown when the call failed");
  server.setScenario("ok");
});

test("low-confidence calls keep their colour but get a dashed outline", async () => {
  await writeSettings({});
  await clearCache();
  server.setScenario("uncertain");
  await page.reload();
  await scrollWholeFeed();
  await waitForVerdict(URN.nugget, "golden_nugget");

  const styles = await page.evaluate(([urn]) => {
    const post = document.querySelector(`[data-urn="${urn}"]`);
    return {
      uncertain: post.classList.contains("deslopify-uncertain"),
      boxShadow: getComputedStyle(post).boxShadow,
      outlineStyle: getComputedStyle(post).outlineStyle,
      panelOpen: Boolean(document.querySelector(".deslopify-panel-host")),
    };
  }, [URN.nugget]);
  assert.equal(styles.uncertain, true, "a near-tie is marked uncertain");
  assert.match(styles.boxShadow, /240, 180, 41/, "the verdict colour is not lost to the uncertainty marker");
  assert.equal(styles.outlineStyle, "dashed");
  server.setScenario("ok");
});

test("fading slop leaves the badge crisp", async () => {
  await writeSettings({ dimSlop: true });
  await page.reload();
  await waitForVerdict(URN.slop, "slop");

  const styles = await page.evaluate(([urn]) => {
    const post = document.querySelector(`[data-urn="${urn}"]`);
    const host = post.querySelector(".deslopify-badge-host");
    return {
      faded: Boolean(getComputedStyle(post, "::after").backgroundColor.match(/^rgba?\((?!0, 0, 0, 0)/)),
      badgeZ: Number(getComputedStyle(host).zIndex),
      badgeOpacity: getComputedStyle(host).opacity,
    };
  }, [URN.slop]);
  assert.equal(styles.faded, true, "a tint overlay dims the post");
  assert.ok(styles.badgeZ > 5, `badge sits above the tint (z-index ${styles.badgeZ})`);
  assert.equal(styles.badgeOpacity, "1", "the badge itself is not faded");
  await writeSettings({ dimSlop: false });
});

test("the settings page saves changes to storage", async () => {
  const extensionId = new URL(serviceWorker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const threshold = options.locator('input[data-setting="nuggetThreshold"]');
  await threshold.waitFor({ timeout: 10_000 });
  await threshold.fill("0.62");
  await threshold.dispatchEvent("input");

  const stored = await waitForSetting("nuggetThreshold", (settings) => Number(settings.nuggetThreshold) === 0.62);
  assert.equal(Number(stored.nuggetThreshold), 0.62);
  await options.close();
});

test("the popup reports counts and lets the user pause", async () => {
  // Restore a healthy, default-configured feed so the numbers below are exact.
  await writeSettings({});
  await clearCache();
  server.setScenario("ok");
  await page.reload();
  await scrollWholeFeed();
  await waitForAllVerdicts();
  await waitForRequestSettle();

  const extensionId = new URL(serviceWorker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#count-useful").waitFor({ timeout: 10_000 });

  const counts = await popup.evaluate(() => ({
    nugget: document.getElementById("count-nugget").textContent,
    useful: document.getElementById("count-useful").textContent,
    slop: document.getElementById("count-slop").textContent,
    usage: document.getElementById("usage").textContent,
  }));
  assert.ok(Number(counts.nugget) >= 1, "at least one nugget was counted");
  assert.ok(Number(counts.slop) >= 1, "at least one slop post was counted");
  assert.match(counts.usage, /API calls/);

  await popup.locator("#page-status").filter({ hasText: /posts found/ }).waitFor({ timeout: 10_000 });
  const pageStatus = await popup.locator("#page-status").innerText();
  assert.match(pageStatus, /6 posts found/, "the popup can see what the content script is doing");
  assert.match(pageStatus, /1 nugget, 3 useful, 1 slop/, "live per-tab verdict breakdown");
  assert.match(pageStatus, /1 without text/, "the media-only post is reported as skipped");

  // The Diagnostics button is the user's lifeline when something looks wrong: it
  // must actually produce a pasteable report.
  await popup.locator("#copy-diagnostics").click();
  await popup.locator("#status").filter({ hasText: /Diagnostics copied/ }).waitFor({ timeout: 10_000 });
  const copied = await popup.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /"version"/);
  assert.match(copied, /"stats"/);
  assert.match(copied, /"feedStructure"/);
  assert.equal(copied.includes("ts_e2e_key"), false, "diagnostics must never contain the API key");

  await popup.locator("#enabled").uncheck();
  await popup.locator("#status").filter({ hasText: /off/i }).waitFor({ timeout: 5_000 });
  await waitForSetting("enabled", (settings) => settings.enabled === false);

  // Wait for the content script to strip its markup from the page.
  await page.waitForFunction(() => document.querySelectorAll(".deslopify-badge-host").length === 0, undefined, { timeout: 10_000 });
  await popup.close();
  await writeSettings({ enabled: true, hideSlop: false });
});

test("the extension still works when LinkedIn's class names change", async () => {
  await writeSettings({});
  await clearCache();
  const before = server.requests.length;
  await page.goto("https://www.linkedin.com/feed/obfuscated/");
  await page.waitForFunction(() => document.querySelectorAll("[data-deslopify]").length >= 3, undefined, { timeout: 30_000 });

  const verdicts = await page.evaluate(() =>
    [...document.querySelectorAll("[data-deslopify]")].map((node) => {
      const name = (node.textContent.match(/Dana Reyes|Sam Patel|Brittany Cole/) ?? ["?"])[0];
      return `${name}:${node.dataset.deslopify}`;
    }),
  );
  assert.deepEqual(verdicts, ["Dana Reyes:golden_nugget", "Sam Patel:useful", "Brittany Cole:slop"]);
  assert.equal(server.requests.length - before, 3, "posts found with no familiar class names were still scored");
  assert.equal(await page.locator(".deslopify-badge-host").count(), 3, "every post got a badge");
});

test("the server-driven feed actually gets scored, not just discovered", async () => {
  // Field report: LinkedIn's 2026 server-driven feed wraps items in
  // `display: contents` elements. They have no box, so IntersectionObserver never
  // fired: posts were found and then never scored, with nothing on screen to say
  // why. Discovery is covered by test/dom/sdui.test.mjs; this proves the whole
  // pipeline runs, which is the part that was silently broken.
  await writeSettings({});
  await clearCache();
  const before = server.requests.length;
  await page.goto("https://www.linkedin.com/feed/sdui/");
  await page.waitForFunction(() => document.querySelectorAll("[data-deslopify]").length >= 2, undefined, { timeout: 30_000 });
  await waitForRequestSettle();

  // Self-check: the page must really be in the `display: contents` shape, otherwise
  // this test would pass while testing nothing. (It did exactly that until the
  // fixture's inline styles stopped being blocked by this suite's CSP.)
  const wrappers = await page.evaluate(() =>
    [...document.querySelectorAll("[data-lazy-mount-id]")].map((node) => getComputedStyle(node).display),
  );
  assert.equal(wrappers.length >= 3, true);
  assert.deepEqual([...new Set(wrappers)], ["contents"], "feed items are boxless display:contents wrappers");

  const extensionId = new URL(serviceWorker.url()).host;
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extensionId}/popup.html`);
  const status = (await probe.evaluate(async () => chrome.runtime.sendMessage({ type: "tabs:pageStatus" }))).page.status;
  await probe.close();

  assert.equal(status.postsFound, 2, "two posts, not the share box or the recommendation module");
  const scored = status.byVerdict.golden_nugget + status.byVerdict.useful + status.byVerdict.slop;
  assert.equal(scored, status.postsFound, "every discovered post must end up scored (0-scored was the bug)");
  assert.equal(status.errors, 0);
  assert.equal(status.pending, 0);
  assert.equal(server.requests.length - before, 2, "one call per post");
  assert.equal(await page.locator(".deslopify-badge-host").count(), 2);

  const adRequest = server.requests.find((request) => request.body.state.post.author === "Delta Air Lines");
  assert.ok(adRequest, "the promoted post was sent for grading");
  assert.equal(adRequest.body.state.post.flags.is_promoted_or_ad, true);
  assert.match(adRequest.body.state.post.text, /Delta Sync Wi-Fi/);
});

test("a page with no recognisable posts says so instead of failing silently", async () => {
  const seen = [];
  page.on("console", (message) => seen.push(message.text()));

  await page.goto("https://www.linkedin.com/feed/empty/");
  const banner = page.locator(".deslopify-banner");
  await banner.waitFor({ timeout: 20_000 });
  assert.match(await banner.innerText(), /found no posts/i);
  assert.match(await banner.innerText(), /layout may have changed/i);

  // The banner's own button must produce a pasteable report on the page's console.
  await banner.getByRole("button", { name: /copy diagnostics/i }).click();
  await page.waitForTimeout(500);
  const reportLine = seen.find((line) => line.includes("[Deslopify] diagnostics"));
  assert.ok(reportLine, "the banner copies a diagnostics report");
  assert.match(reportLine, /"postsFound": 0/);
  assert.match(reportLine, /"feedStructure"/);

  // The same report is available to the popup, with config and counters attached.
  const extensionId = new URL(serviceWorker.url()).host;
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extensionId}/popup.html`);
  const collected = await probe.evaluate(async () => chrome.runtime.sendMessage({ type: "diagnostics:collect" }));
  assert.equal(collected.ok, true);
  assert.equal(collected.config.credentialSet, true);
  assert.equal(collected.pages[0].report.postsFound, 0);
  assert.ok(collected.pages[0].report.feedStructure.length > 0, "the report includes the page's real structure");
  await probe.close();
});

test("the content script logs no errors while running", () => {
  assert.deepEqual(consoleErrors, []);
});
