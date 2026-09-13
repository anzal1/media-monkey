// Records factory/bg/*.html to assets/bg/<name>.mp4 (60s, 1080x1920, 60fps).
//
// RECORDING ROUTE (decision + why):
//   puppeteer-core driving the "Google Chrome for Testing" build that Playwright
//   already downloaded for voila (~/Library/Caches/ms-playwright/chromium-*),
//   headless, stepping the page frame by frame via window.MM.frame(i) and
//   piping each CDP JPEG screenshot into ffmpeg's image2pipe.
//
//   Rejected alternatives:
//   - MediaRecorder + canvas.captureStream inside the page: real time only, and
//     any frame the renderer misses becomes visible judder in a hypnotic loop.
//     It also needs a blob-to-base64 hop out of the page and gives VFR webm.
//   - Playwright's own video recording: VP8 webm, viewport-sized, real time,
//     same dropped-frame problem.
//   Frame stepping is slower than real time but it is exact: frame i of the mp4
//   is exactly what frame i of the page drew, at a locked 60fps. These are
//   built once and reused by every reel, so the wall clock does not matter.
//
//   ffmpeg: this stage uses whatever ffmpeg is first on the machine (the
//   homebrew build here), since encoding frames needs no libass. The assemble
//   stage is the one that requires the ffmpeg-static build. See ffmpeg.mjs.
//
// Usage:
//   node factory/record-bg.mjs                 # all three, 60s each
//   node factory/record-bg.mjs flow --seconds 6
//   node factory/record-bg.mjs rings --seed 1,2,3      # a whole variant pool
//   node factory/record-bg.mjs plinko --seed 9 --fps 30 --seconds 45
//   node factory/record-bg.mjs --force         # re-record existing

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ffmpegPath } from './ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BG_SRC = path.join(HERE, 'bg');
const BG_OUT = path.join(HERE, '..', 'assets', 'bg');

export function findChrome() {
  if (process.env.MEDIAMONKEY_CHROME && fs.existsSync(process.env.MEDIAMONKEY_CHROME)) {
    return process.env.MEDIAMONKEY_CHROME;
  }
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'puppeteer'),
    path.join(os.homedir(), '.cache', 'puppeteer'),
  ];
  const leaves = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const leaf of leaves) {
        const p = path.join(root, dir, leaf);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]) if (fs.existsSync(p)) return p;
  throw new Error('no Chromium found; set MEDIAMONKEY_CHROME to a Chrome binary');
}

// `once('error', rej)` per write would pile up listeners on a long capture, so
// only the drain handler is transient; errors surface through the close promise.
function writeAsync(stream, buf) {
  return new Promise((res) => {
    if (stream.write(buf)) return res();
    stream.once('drain', res);
  });
}

/** assets/bg/rings-s7.mp4 for seed 7; assets/bg/rings.mp4 when unseeded. */
export function variantPath(name, seed, dir = BG_OUT) {
  return path.join(dir, seed == null ? `${name}.mp4` : `${name}-s${seed}.mp4`);
}

// The bg pages advance exactly one fixed step per MM.frame() call and were
// authored against a 60fps wall clock, so frame index IS sim time. Capturing at
// a lower fps therefore has to take SIM_FPS/fps steps per captured frame or the
// motion plays back in slow motion. Doing that is free speed: the reel is
// encoded at 30fps anyway, so a 30fps capture with 2 steps per frame is the
// same footage as a 60fps capture decimated by ffmpeg, for half the screenshots
// (the screenshot round trip, not the drawing, is what a capture costs).
const SIM_FPS = 60;

export async function recordPage(name, opts = {}) {
  const puppeteer = (await import('puppeteer-core')).default;
  const seconds = opts.seconds ?? 60;
  const fps = opts.fps ?? 60;
  const stepsPerFrame = opts.stepsPerFrame ?? Math.max(1, Math.round(SIM_FPS / fps));
  const seed = opts.seed ?? null;
  const log = opts.log || console.log;
  const src = path.join(BG_SRC, `${name}.html`);
  if (!fs.existsSync(src)) throw new Error(`no bg page ${src}`);
  const outDir = opts.outDir || BG_OUT;
  fs.mkdirSync(outDir, { recursive: true });
  const out = opts.out || variantPath(name, seed, outDir);

  const browser = await puppeteer.launch({
    executablePath: opts.chrome || findChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-device-scale-factor=1',
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: { width: 1080, height: 1920, deviceScaleFactor: 1 },
  });

  const ff = spawn(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-movflags', '+faststart',
    out,
  ]);
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; });
  const ffDone = new Promise((res, rej) => {
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}: ${ffErr.slice(-800)}`))));
    ff.on('error', rej);
  });
  ff.stdin.on('error', () => {});

  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => log(`  [${name}] page error: ${e.message}`));
    const q = `?manual=1${seed == null ? '' : `&seed=${seed}`}`;
    await page.goto(`${pathToFileURL(src).href}${q}`, { waitUntil: 'load' });
    await page.waitForFunction('window.MM_READY === true', { timeout: 15000 });

    const total = Math.round(seconds * fps);
    let step = 0;
    for (let i = 0; i < total; i++) {
      for (let k = 0; k < stepsPerFrame; k++) {
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((n) => window.MM.frame(n), step++);
      }
      const buf = await page.screenshot({
        type: 'jpeg', quality: 92, optimizeForSpeed: true, captureBeyondViewport: false,
      });
      await writeAsync(ff.stdin, buf);
      if (i % (fps * 15) === 0) {
        const pct = ((i / total) * 100).toFixed(0);
        log(`  [${path.basename(out, '.mp4')}] ${pct}%  ${i}/${total} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }
  } finally {
    ff.stdin.end();
    await browser.close();
  }
  await ffDone;
  const size = fs.statSync(out).size;
  log(`  [${path.basename(out, '.mp4')}] done -> ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out;
}

export function bgNames() {
  return fs.readdirSync(BG_SRC)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.replace(/\.html$/, ''))
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const force = argv.includes('--force');
  const seconds = Number(flag('--seconds', 60));
  const fps = Number(flag('--fps', 60));
  const outDir = flag('--out-dir', BG_OUT);
  // --seed 3 or --seed 1,2,3 for a whole variant pool in one run
  const seedArg = flag('--seed', null);
  const seeds = seedArg == null ? [null] : String(seedArg).split(',').map((s) => Number(s.trim()));

  const valueFlags = new Set(['--seconds', '--fps', '--seed', '--out-dir']);
  const names = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
  const list = names.length ? names : bgNames();
  const chrome = findChrome();
  console.log(`chrome: ${chrome}`);
  console.log(`ffmpeg: ${ffmpegPath()}`);
  for (const n of list) {
    for (const seed of seeds) {
      const out = variantPath(n, seed, outDir);
      if (fs.existsSync(out) && !force) {
        console.log(`  [${n}${seed == null ? '' : ` s${seed}`}] exists, skipping (--force to redo)`);
        continue;
      }
      await recordPage(n, { seconds, fps, chrome, seed, outDir });
    }
  }
}
