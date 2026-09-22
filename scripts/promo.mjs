/**
 * Renders the promo video from its HyperFrames source and derives the files the
 * README and the site embed:
 *
 *   videos/deslopify-promo  → assets/promo.mp4 (the render)
 *                           → assets/promo.gif (README preview; GitHub cannot inline an mp4)
 *
 * Usage: node scripts/promo.mjs [--skip-render]   (needs ffmpeg on PATH for the gif)
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(root, "videos/deslopify-promo");

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${result.status})`);
}

if (!process.argv.includes("--skip-render")) {
  run("npx", ["hyperframes", "render", "--quality", "high", "--output", "renders/video.mp4"], project);
}
// The 1080p master stays in renders/; the embed is a 720p web encode (~⅓ the bytes) so the
// landing hero autoplays without a 10 MB download.
run(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-i", resolve(project, "renders/video.mp4"),
    "-vf", "scale=1280:-2", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an",
    resolve(root, "assets/promo.mp4"),
  ],
  root,
);

// ponytail: 720px / 12fps / 128 colours keeps the gif a few MB; bump only if it looks rough on GitHub
run(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-i", resolve(root, "assets/promo.mp4"),
    "-vf", "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
    resolve(root, "assets/promo.gif"),
  ],
  root,
);
console.log("wrote assets/promo.mp4 and assets/promo.gif");
