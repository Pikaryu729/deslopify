/**
 * Generates the extension icons as PNGs with no image dependencies.
 * Simple 4x supersampled rasteriser + minimal PNG encoder (zlib via node:zlib).
 *
 * Usage: node scripts/make-icons.mjs [outDir]
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(here, "../src/icons"));

/* ------------------------------------------------------------ rasteriser */

const COLORS = {
  background: [29, 32, 37, 255],
  golden_nugget: [240, 180, 41, 255],
  useful: [47, 158, 111, 255],
  slop: [217, 83, 79, 255],
};

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Draw at `size` using normalised coordinates in [0, 1]. */
function draw(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const ss = 4; // supersampling factor
  const bars = [
    { y: 0.26, w: 0.62, color: COLORS.golden_nugget },
    { y: 0.46, w: 0.44, color: COLORS.useful },
    { y: 0.66, w: 0.3, color: COLORS.slop },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          let color = null;
          if (inRoundedRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) color = COLORS.background;
          if (color) {
            for (const bar of bars) {
              const half = 0.055;
              if (v >= bar.y - half && v <= bar.y + half && u >= 0.2 && u <= 0.2 + bar.w) color = bar.color;
            }
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += color[3];
          }
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      px[i] = r / n;
      px[i + 1] = g / n;
      px[i + 2] = b / n;
      px[i + 3] = a / n;
    }
  }
  return px;
}

/* ---------------------------------------------------------- PNG encoding */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- main */

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(draw(size), size));
  console.log(`wrote ${file}`);
}
