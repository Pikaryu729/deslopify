/**
 * Packages `dist/chrome` into a Chrome Web Store-ready zip.
 *
 * The store requires `manifest.json` at the root of the archive (no wrapping
 * folder), so this walks the directory itself rather than shelling out to `zip`
 * with whatever flags the local platform happens to have.
 *
 * Usage: node scripts/package-chrome.mjs
 */
import { deflateRawSync } from "node:zlib";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------ zip writer */

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

/** Directory entries and files, recursively, relative to `dir`. */
async function walk(dir, base = dir) {
  const entries = [];
  for (const name of (await readdir(dir)).sort()) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      entries.push({ name: `${relative(base, full)}/`, data: Buffer.alloc(0), directory: true });
      entries.push(...(await walk(full, base)));
    } else {
      entries.push({ name: relative(base, full), data: await readFile(full), directory: false });
    }
  }
  return entries;
}

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = entry.directory ? Buffer.alloc(0) : deflateRawSync(entry.data, { level: 9 });
    // Stored (0) when deflating does not help — already-compressed PNGs.
    const useDeflate = deflated.length < entry.data.length;
    const payload = entry.directory ? Buffer.alloc(0) : useDeflate ? deflated : entry.data;
    const method = entry.directory ? 0 : useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(entry.directory ? 0x10 : 0, 38); // external attributes
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

/* ------------------------------------------------------------------- main */

const sourceDir = resolve(root, "dist/chrome");
const manifest = JSON.parse(await readFile(join(sourceDir, "manifest.json"), "utf8"));
const entries = await walk(sourceDir);
const outFile = resolve(root, `dist/artifacts/deslopify-chrome-${manifest.version}.zip`);

await mkdir(dirname(outFile), { recursive: true });
const archive = zip(entries);
await writeFile(outFile, archive);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`packaged ${entries.filter((entry) => !entry.directory).length} files → ${relative(root, outFile)} (${kb(archive.length)})`);
if (!entries.some((entry) => entry.name === "manifest.json")) {
  throw new Error("manifest.json must be at the root of the archive");
}
