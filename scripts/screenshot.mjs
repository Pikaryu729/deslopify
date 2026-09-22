/**
 * Visual check: loads the built extension against the fixture feed, scrolls it,
 * and writes screenshots to /tmp/deslopify-shots for eyeballing.
 *
 * Usage: node scripts/screenshot.mjs [theme]
 */
import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockServer, readFixture } from "../test/mock-typesafe-server.mjs";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/shared/settings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(root, "dist/chrome");
const outDir = resolve(tmpdir(), "deslopify-shots");
const theme = process.argv[2] ?? "light";
const feedPath = process.argv[3] ?? "/feed/";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const server = await startMockServer();
const raw = await readFixture(feedPath.includes("obfuscated") ? "linkedin-feed-obfuscated" : "linkedin-feed");
const pageCss = raw.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const fixture = raw.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/fixture.css" />');

await mkdir(outDir, { recursive: true });
const userDataDir = await mkdtemp(resolve(tmpdir(), "deslopify-shot-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  viewport: { width: 900, height: 1200 },
  colorScheme: theme,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate(
  async ([key, settings]) => chrome.storage.local.set({ [key]: settings }),
  [STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS, apiKey: "shot", baseUrl: server.endpoint }],
);

await context.route("https://www.linkedin.com/**", (route) => {
  const url = route.request().url();
  if (url.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
  if (url.endsWith("/fixture.css")) return route.fulfill({ status: 200, contentType: "text/css", body: pageCss });
  return route.fulfill({
    status: 200,
    contentType: "text/html",
    headers: { "content-security-policy": "default-src 'self'; style-src 'self'; img-src 'self' data:" },
    body: fixture,
  });
});

const page = await context.newPage();
await page.goto(`https://www.linkedin.com${feedPath}`);
// Posts are scored as they scroll into view, so walk the feed first.
for (let y = 0; y <= (await page.evaluate(() => document.body.scrollHeight)); y += 400) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(150);
}
await page.evaluate(() => window.scrollTo(0, 0));
const minVerdicts = feedPath.includes("obfuscated") ? 3 : 5;
await page.waitForFunction((min) => document.querySelectorAll("[data-deslopify]").length >= min, minVerdicts, {
  timeout: 30_000,
});
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, `feed-${theme}${feedPath.includes("obfuscated") ? "-obfuscated" : ""}.png`), fullPage: true });

await page.locator(".deslopify-badge-host .pill").nth(2).click(); // the slop post
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(outDir, `panel-${theme}${feedPath.includes("obfuscated") ? "-obfuscated" : ""}.png`) });

const extensionId = new URL(worker.url()).host;
const popup = await context.newPage();
await popup.setViewportSize({ width: 340, height: 620 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(500);
await popup.screenshot({ path: resolve(outDir, `popup-${theme}.png`) });

const options = await context.newPage();
await options.setViewportSize({ width: 820, height: 1100 });
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.waitForTimeout(400);
await options.screenshot({ path: resolve(outDir, `options-${theme}.png`) });

await context.close();
await server.close();
await readFile(resolve(outDir, `feed-${theme}${feedPath.includes("obfuscated") ? "-obfuscated" : ""}.png`)); // fail loudly if nothing was written
console.log(`screenshots in ${outDir}`);
