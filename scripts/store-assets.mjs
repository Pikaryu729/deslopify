/**
 * Generates the store listing graphics from the real, running extension.
 *
 * Produces captioned 1280x800 screenshots (Chrome and AMO both require that exact
 * size) rather than raw captures: a store screenshot has one job, which is to say
 * what the extension does before anyone reads a word of the description. Each frame
 * is the actual shipped UI inside a browser window, with a headline above it.
 *
 * Also writes the required 440x280 promo tile, the optional 1400x560 marquee, and
 * copies the 128x128 store icon. The uncaptioned captures go to store/assets/raw/
 * for the website, which sets its own headings.
 *
 * Usage: node scripts/store-assets.mjs
 */
import { chromium } from "playwright";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockServer, readFixture } from "../test/mock-typesafe-server.mjs";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/shared/settings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(root, "dist/chrome");
const outDir = resolve(root, "store/assets");

const FRAME = { width: 1280, height: 800 };
const WINDOW = { width: 1184, height: 656 };

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

/** Read width/height straight out of the PNG IHDR so we can assert the exact size. */
function pngSize(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function save(page, file, expected) {
  const buffer = await page.screenshot({ path: resolve(outDir, file) });
  const size = pngSize(buffer);
  if (size.width !== expected.width || size.height !== expected.height) {
    throw new Error(`${file}: got ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`);
  }
  console.log(`${file.padEnd(34)} ${size.width}x${size.height}  ${(buffer.length / 1024).toFixed(0)} KB`);
  return buffer;
}

/* ------------------------------------------------------------------- setup */

await mkdir(outDir, { recursive: true });
const server = await startMockServer();
const raw = await readFixture();
const pageCss = raw.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const fixture = raw.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/fixture.css" />');
const icon = await readFile(resolve(root, "src/icons/icon-128.png"));

const context = await chromium.launchPersistentContext(await mkdtemp(resolve(tmpdir(), "deslopify-store-")), {
  channel: "chromium",
  headless: true,
  viewport: WINDOW,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate(
  async ([key, settings]) => chrome.storage.local.set({ [key]: settings }),
  [STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS, apiKey: "store-assets", baseUrl: server.endpoint }],
);

await context.route("https://www.linkedin.com/**", (route) => {
  const url = route.request().url();
  if (url.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
  if (url.endsWith("/fixture.css")) return route.fulfill({ status: 200, contentType: "text/css", body: pageCss });
  return route.fulfill({ status: 200, contentType: "text/html", body: fixture });
});

/* ------------------------------------------------------------ raw captures */

const feed = await context.newPage();
await feed.setViewportSize(WINDOW);
await feed.goto("https://www.linkedin.com/feed/");
for (let y = 0; y <= (await feed.evaluate(() => document.body.scrollHeight)); y += 400) {
  await feed.evaluate((top) => window.scrollTo(0, top), y);
  await feed.waitForTimeout(140);
}
await feed.evaluate(() => window.scrollTo(0, 0));
await feed.waitForFunction(() => document.querySelectorAll("[data-deslopify]").length >= 5, undefined, { timeout: 30_000 });
// Presentation only, for the product shot: the fixture centres a 560px column, which
// leaves two thirds of a store screenshot empty. Widen it, and zoom so one frame
// shows all three verdicts instead of one and a half posts.
await feed.addStyleTag({
  content: ".scaffold-layout__main { max-width: 1000px !important; margin: 0 auto !important; padding: 12px !important; }",
});
await feed.evaluate(() => {
  document.body.style.zoom = "0.86";
  window.scrollTo(0, 0);
});
await feed.waitForTimeout(500);
const feedShot = await feed.screenshot();

await feed.locator(".deslopify-badge-host .pill").nth(2).click(); // the slop post
// The panel caps itself at 70vh so it never covers the viewport in real use; for the
// shot, let it show its whole explanation instead of a scrollable excerpt.
await feed.evaluate(() => {
  const host = document.querySelector(".deslopify-panel-host");
  const style = document.createElement("style");
  style.textContent = ".panel { max-height: none !important; }";
  host?.shadowRoot?.append(style);
});
await feed.waitForTimeout(350);
const panelShot = await feed.screenshot();
// The website shows the panel at column width, so it gets a tighter crop: the
// panel plus enough of the graded posts to show what it is explaining.
const panelClose = await feed.screenshot({ clip: { x: 150, y: 0, width: 880, height: WINDOW.height } });

const extensionId = new URL(worker.url()).host;
const popup = await context.newPage();
await popup.setViewportSize({ width: 360, height: 660 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(500);
const popupShot = await popup.screenshot();

const options = await context.newPage();
await options.setViewportSize({ width: 820, height: 700 });
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.evaluate(() => {
  document.body.style.zoom = "0.92";
  window.scrollTo(0, 0);
});
await options.waitForTimeout(400);
const optionsShot = await options.screenshot();

/* ------------------------------------------------------------ raw copies */

await mkdir(resolve(outDir, "raw"), { recursive: true });
for (const [name, buffer] of Object.entries({ feed: feedShot, panel: panelClose, popup: popupShot, options: optionsShot })) {
  await writeFile(resolve(outDir, "raw", `${name}.png`), buffer);
}

/* ------------------------------------------------------- captioned frames */

const STAGE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden; }
  body {
    background: radial-gradient(1100px 560px at 14% -14%, #1b2430 0%, #10131a 55%, #0b0e13 100%);
    color: #f2f4f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 34px 48px 0;
    display: flex; flex-direction: column;
  }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
  header img { width: 34px; height: 34px; border-radius: 8px; }
  header .brand { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
  header .chips { margin-left: auto; display: flex; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px; border-radius: 999px;
          font-size: 13px; font-weight: 600; }
  .chip::before { content: ""; width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
  .chip.gold { color: #f0b429; background: rgba(240,180,41,.13); border: 1px solid rgba(240,180,41,.5); }
  .chip.green { color: #2f9e6f; background: rgba(47,158,111,.13); border: 1px solid rgba(47,158,111,.5); }
  .chip.red { color: #d9534f; background: rgba(217,83,79,.13); border: 1px solid rgba(217,83,79,.5); }
  h1 { font-size: 27px; font-weight: 700; letter-spacing: -0.02em; }
  .sub { margin-top: 7px; font-size: 15px; color: #9aa1ab; max-width: 900px; }
  .window {
    flex: 1; border-radius: 13px; overflow: hidden; border: 1px solid rgba(255,255,255,.13);
    box-shadow: 0 26px 60px rgba(0,0,0,.55); background: #fff; display: flex; flex-direction: column;
  }
  .chrome { height: 30px; flex: none; background: #23272f; display: flex; align-items: center; gap: 7px; padding: 0 12px; }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: #4a505a; }
  .url { margin-left: 8px; font-size: 11px; color: #9aa1ab; background: rgba(255,255,255,.07);
         border-radius: 999px; padding: 3px 12px; }
  .window img { width: 100%; flex: 1; object-fit: cover; object-position: top center; display: block; }
  .float { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  /* A percentage max-height does nothing inside an auto-height flex item, so the
     frame's remaining space is expressed as a number instead: 800 - header - title -
     subtitle - bottom padding, minus slack. */
  .float img, .split img { max-height: 564px; max-width: 100%; width: auto; height: auto;
    border-radius: 14px; border: 1px solid rgba(255,255,255,.13); box-shadow: 0 26px 60px rgba(0,0,0,.55); }
  .split { flex: 1; display: flex; align-items: center; gap: 46px; min-height: 0; overflow: hidden; }
  .split .copy { flex: 1; }
  .split ul { list-style: none; display: flex; flex-direction: column; gap: 16px; }
  .split li { position: relative; padding-left: 26px; font-size: 15px; line-height: 1.5; color: #d7dbe2; }
  .split li::before { content: ""; position: absolute; left: 0; top: 7px; width: 10px; height: 10px;
    border-radius: 999px; background: var(--dot, #8fb6ff); }
  .split .shot { flex: none; display: flex; align-items: center; justify-content: center; min-height: 0; }
`;

async function frame(file, { title, sub, image, layout = "window", bullets = [] }) {
  const stage = await context.newPage();
  await stage.setViewportSize(FRAME);
  const shot = `<img src="${dataUrl(image)}" alt="" />`;
  const window_ =
    layout === "window"
      ? `<div class="window">
           <div class="chrome"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
             <span class="url">linkedin.com/feed</span></div>
           ${shot}
         </div>`
      : layout === "split"
        ? `<div class="split">
             <div class="copy"><ul>${bullets
               .map(({ text, color }) => `<li${color ? ` style="--dot:${color}"` : ""}>${text}</li>`)
               .join("")}</ul></div>
             <div class="shot" style="width:${layout === "split" && image.width ? "" : ""}">${shot}</div>
           </div>`
        : `<div class="float">${shot}</div>`;

  await stage.setContent(
    `<!doctype html><html><head><style>${STAGE_CSS}</style></head><body>
       <header>
         <img src="${dataUrl(icon)}" alt="" />
         <span class="brand">Deslopify</span>
         <span class="chips">
           <span class="chip gold">golden nugget</span>
           <span class="chip green">useful</span>
           <span class="chip red">slop</span>
         </span>
       </header>
       <h1>${title}</h1>
       <p class="sub">${sub}</p>
       ${window_}
     </body></html>`,
    { waitUntil: "load" },
  );
  await stage.waitForTimeout(300);
  const buffer = await save(stage, file, FRAME);
  await stage.close();
  return buffer;
}

await frame("screenshot-1-feed.png", {
  title: "Every post graded as you scroll",
  sub: "Gold for a golden nugget, green for useful, red for slop. The badge shows how sure it is; the edge shows the call.",
  image: feedShot,
});

await frame("screenshot-2-explanation.png", {
  title: "It shows its work",
  sub: "Click any badge for the probability of each verdict and the signals that moved the score — the same numbers it used to decide.",
  image: panelShot,
});

await frame("screenshot-3-popup.png", {
  title: "See what it found, and what it costs",
  sub: "The toolbar popup reports the live state of the tab you are on.",
  image: popupShot,
  layout: "split",
  bullets: [
    { text: "How many posts it found on this tab, how many it scored, and how many had no text to read.", color: "#8fb6ff" },
    { text: "Verdict counts and token usage, so the cost of your scrolling is never a surprise.", color: "#2f9e6f" },
    { text: "Pause it, clear the cached verdicts, or copy a diagnostics report when something looks wrong.", color: "#9aa1ab" },
    { text: "Demo mode: grade posts with a local heuristic — no API key and no network requests.", color: "#f0b429" },
  ],
});

await frame("screenshot-4-settings.png", {
  title: "Tuned to you, not to an average",
  sub: "The verdict is computed in code from the model's answers, and every number in that calculation is yours to change.",
  image: optionsShot,
  layout: "split",
  bullets: [
    { text: "Describe your interests once. Every verdict is judged against them, not against a generic idea of quality.", color: "#8fb6ff" },
    { text: "Set the bar for a golden nugget, and how harshly promotion, engagement bait, or AI boilerplate counts.", color: "#d9534f" },
    { text: "Point it at TypeSafe or Cloudflare Workers AI with your own key — or run demo mode with neither.", color: "#2f9e6f" },
    { text: "Nothing to trust blindly: no account, no analytics, and no server of ours in the path.", color: "#9aa1ab" },
  ],
});

/* ------------------------------------------------------------ promo tiles */

const CHIPS = [
  ["golden nugget", "#f0b429"],
  ["useful", "#2f9e6f"],
  ["slop", "#d9534f"],
];

async function promo(file, width, height, { scale }) {
  const tile = await context.newPage();
  await tile.setViewportSize({ width, height });
  const chips = CHIPS.map(
    ([label, color]) =>
      `<span style="display:inline-flex;align-items:center;gap:8px;padding:${scale(5)}px ${scale(14)}px;border-radius:999px;background:${color}22;border:1px solid ${color};color:#f2f4f7;font-size:${scale(15)}px;font-weight:600">
        <span style="width:${scale(9)}px;height:${scale(9)}px;border-radius:999px;background:${color}"></span>${label}
      </span>`,
  ).join("");
  await tile.setContent(
    `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${scale(16)}px;background:radial-gradient(${scale(700)}px ${scale(380)}px at 15% -20%, #1b2430 0%, #10131a 55%, #0b0e13 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <img src="${dataUrl(icon)}" width="${scale(56)}" height="${scale(56)}" style="border-radius:${scale(14)}px" alt="" />
      <div style="font-size:${scale(34)}px;font-weight:700;color:#f2f4f7;letter-spacing:-0.02em">Deslopify</div>
      <div style="font-size:${scale(16)}px;color:#9aa1ab;max-width:${scale(560)}px;text-align:center;line-height:1.4">
        Grades every post in your feed as you scroll
      </div>
      <div style="display:flex;gap:${scale(10)}px">${chips}</div>
    </body></html>`,
  );
  await tile.waitForTimeout(250);
  await save(tile, file, { width, height });
  await tile.close();
}

await promo("promo-tile-440x280.png", 440, 280, { scale: (n) => Math.round(n * 0.72) });
await promo("marquee-1400x560.png", 1400, 560, { scale: (n) => Math.round(n * 1.45) });

/* ------------------------------------------------------------------- icon */

await copyFile(resolve(root, "src/icons/icon-128.png"), resolve(outDir, "icon-128.png"));
console.log("icon-128.png".padEnd(34) + "128x128   (copied from src/icons)");

await context.close();
await server.close();
console.log(`\nstore assets written to ${outDir}`);
