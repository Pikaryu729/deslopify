/**
 * Derives every raster brand asset from the two source logos in `assets/`:
 *
 *   assets/icon.png      → src/icons/icon-{16,32,48,128}.png (extension + store icon)
 *   assets/wordmark.png  → assets/wordmark-dark.png (navy text turned white, for dark backgrounds)
 *
 * Resizing is done in a headless Chromium canvas so there is no image dependency
 * beyond the Playwright the tests already need. Outputs are committed; rerun
 * `npm run icons` only when a source logo changes.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = resolve(root, "src/icons");
const SIZES = [16, 32, 48, 128];
// x (in source pixels) where the wordmark's lettering starts; the mark to the left keeps its colours.
const WORDMARK_TEXT_START = 630;

const dataUrl = async (file) => `data:image/png;base64,${(await readFile(resolve(root, file))).toString("base64")}`;

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();

const { icons, wordmarkDark } = await page.evaluate(
  async ([iconSrc, wordmarkSrc, sizes, textStart]) => {
    const load = (src) =>
      new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = fail;
        img.src = src;
      });
    const canvasOf = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctxOf = (canvas) => {
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return ctx;
    };
    const png = (canvas) => canvas.toDataURL("image/png").split(",")[1];

    /* icons: crop the transparent margin, then downscale in halving steps */
    const icon = await load(iconSrc);
    const full = canvasOf(icon.width, icon.height);
    ctxOf(full).drawImage(icon, 0, 0);
    const { data, width, height } = ctxOf(full).getImageData(0, 0, icon.width, icon.height);
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
    const side = Math.max(right - left, bottom - top) + 1;
    let stage = canvasOf(side, side);
    ctxOf(stage).drawImage(full, left, top, side, side, 0, 0, side, side);
    const icons = {};
    for (const size of sizes) {
      let cur = stage;
      while (cur.width / 2 >= size) {
        const half = canvasOf(cur.width / 2, cur.height / 2);
        ctxOf(half).drawImage(cur, 0, 0, half.width, half.height);
        cur = half;
      }
      const out = canvasOf(size, size);
      ctxOf(out).drawImage(cur, 0, 0, size, size);
      icons[size] = png(out);
    }

    /* wordmark for dark backgrounds: navy lettering → white, mark untouched */
    const wordmark = await load(wordmarkSrc);
    const wm = canvasOf(wordmark.width, wordmark.height);
    const wctx = ctxOf(wm);
    wctx.drawImage(wordmark, 0, 0);
    const img = wctx.getImageData(0, 0, wm.width, wm.height);
    for (let y = 0; y < wm.height; y++)
      for (let x = textStart; x < wm.width; x++) {
        const i = (y * wm.width + x) * 4;
        if (img.data[i + 3] && img.data[i] + img.data[i + 1] + img.data[i + 2] < 384)
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      }
    wctx.putImageData(img, 0, 0);
    return { icons, wordmarkDark: png(wm) };
  },
  [await dataUrl("assets/icon.png"), await dataUrl("assets/wordmark.png"), SIZES, WORDMARK_TEXT_START],
);
await browser.close();

await mkdir(iconsDir, { recursive: true });
for (const size of SIZES) {
  const file = resolve(iconsDir, `icon-${size}.png`);
  await writeFile(file, Buffer.from(icons[size], "base64"));
  console.log(`wrote ${file}`);
}
const dark = resolve(root, "assets/wordmark-dark.png");
await writeFile(dark, Buffer.from(wordmarkDark, "base64"));
console.log(`wrote ${dark}`);
