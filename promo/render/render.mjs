/**
 * Frame renderer: serves promo/ over HTTP, opens the compositor in headless
 * Chromium at 1080×1920, steps window.renderAt(t) frame by frame and pipes
 * JPEG frames into ffmpeg. Several workers render interleaved segments in
 * parallel; segments are concatenated losslessly.
 *
 *   node render/render.mjs                 # full film → build/video.mp4
 *   node render/render.mjs --stills 3,12.5 # single frames → build/stills/
 *   node render/render.mjs --fps 30 --workers 4 --from 10 --to 20
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "build");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const FPS = Number(opt("fps", 30));
const WORKERS = Number(opt("workers", 4));
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".wav": "audio/wav", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/compositor/index.html`;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--font-render-hinting=none", "--disable-lcd-text"] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 60_000 });
  return page;
}

try {
  await mkdir(build, { recursive: true });
  const probe = await openPage();
  const duration = await probe.evaluate(() => window.DURATION);
  const cues = await probe.evaluate(() => window.CUES);
  await writeFile(join(build, "cues.json"), JSON.stringify({ duration, cues }, null, 1));
  console.log(`duration ${duration.toFixed(2)}s, ${cues.length} cues`);

  const stills = opt("stills", null);
  if (stills) {
    await mkdir(join(build, "stills"), { recursive: true });
    for (const s of stills.split(",").map(Number)) {
      await probe.evaluate((t) => window.renderAt(t), s);
      await probe.screenshot({ path: join(build, "stills", `t${s.toFixed(2).padStart(6, "0")}.jpg`), type: "jpeg", quality: 90 });
    }
    console.log("stills done");
  } else {
    await probe.close();
    const from = Number(opt("from", 0));
    const to = Math.min(Number(opt("to", duration)), duration);
    const total = Math.ceil((to - from) * FPS);
    const per = Math.ceil(total / WORKERS);
    const out = opt("out", join(build, "video.mp4"));
    const t0 = Date.now();
    let done = 0;
    const segs = [];
    await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
      const a = w * per, b = Math.min(total, a + per);
      if (a >= b) return;
      const seg = join(build, `seg${w}.mp4`);
      segs[w] = seg;
      const page = await openPage();
      const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS), seg], { stdio: ["pipe", "inherit", "inherit"] });
      for (let f = a; f < b; f += 1) {
        const t = from + f / FPS;
        await page.evaluate((tt) => window.renderAt(tt), t);
        const buf = await page.screenshot({ type: "jpeg", quality: 94 });
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
        done += 1;
        if (done % 150 === 0) console.log(`  ${done}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      ff.stdin.end();
      await new Promise((r) => ff.on("close", r));
      await page.close();
    }));
    const list = join(build, "segs.txt");
    await writeFile(list, segs.filter(Boolean).map((s) => `file '${s}'`).join("\n"));
    await new Promise((r, j) => spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" }).on("close", (c) => (c ? j(new Error("concat")) : r())));
    console.log(`video → ${out} (${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
} finally {
  await browser.close();
  server.close();
}
