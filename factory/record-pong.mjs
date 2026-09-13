// pong-brains: records the owner's samesmell app in Versus mode, where a male
// and a female Drosophila connectome play Pong at each other. Two real fly
// brains with a live score is brainrot nobody else can copy.
//
// WHY NOT A CENTRE CROP: at a desktop viewport samesmell puts the two brains at
// the far left and right with a small court between them, so a 9:16 centre
// slice keeps the court and throws away both brains, which are the entire
// point. At a portrait viewport the app's own responsive layout stacks male on
// top, court in the middle, female below, and a 540x960 viewport at DPR 2 is
// exactly 1080x1920 device pixels. So this records the portrait layout at
// native resolution and crops nothing.
//
// WHY A DIFFERENT CAPTURE ROUTE THAN record-bg.mjs: samesmell is a live app
// driven by requestAnimationFrame and the wall clock. It cannot be stepped
// frame by frame, so this uses the CDP screencast, which pushes a frame every
// time the compositor produces one, and then resamples the timestamped frames
// onto a constant 30fps timeline. Frames are written to a temp dir rather than
// held in memory: 60 seconds of 1080x1920 JPEG is a few hundred MB.
//
// LOCAL ONLY: needs Chromium and python3. The recorded mp4 is committed, so a
// CI runner never runs this.
//
// Usage: node factory/record-pong.mjs [--seconds 60] [--port 4173]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from './ffmpeg.mjs';
import { findChrome } from './record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BG_OUT = path.join(HERE, '..', 'assets', 'bg');
const SAMESMELL = process.env.MEDIAMONKEY_SAMESMELL
  || path.join(os.homedir(), 'personal', 'samesmell');

// Chrome for the viewer, not for the recording: the mode switcher, the CTA
// button and the source badges are app chrome, not content.
const HIDE_CSS = `
  .modebar, #versus-human, .ghostbtn, .srcbadge,
  .realtoggle, .realpanel, .puffzone { display: none !important; }
`;

async function waitForServer(url, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} never came up`);
}

function writeAsync(stream, buf) {
  return new Promise((res) => {
    if (stream.write(buf)) return res();
    stream.once('drain', res);
  });
}

export async function recordPong(opts = {}) {
  const seconds = opts.seconds ?? 60;
  const fps = opts.fps ?? 30;
  const port = opts.port ?? 4173;
  const log = opts.log || console.log;
  const dir = opts.dir || SAMESMELL;
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`samesmell not found at ${dir}; set MEDIAMONKEY_SAMESMELL`);
  }
  fs.mkdirSync(BG_OUT, { recursive: true });
  const out = opts.out || path.join(BG_OUT, 'pong-brains.mp4');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pong-'));

  const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', dir], {
    stdio: 'ignore',
  });
  let browser = null;

  try {
    await waitForServer(`http://localhost:${port}/`);
    log(`  [pong] server up on ${port}`);

    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({
      executablePath: opts.chrome || findChrome(),
      headless: true,
      args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-dev-shm-usage'],
      // 540x960 at DPR 2 = 1080x1920 device pixels, the app's portrait layout
      defaultViewport: { width: 540, height: 960, deviceScaleFactor: 2 },
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => log(`  [pong] page error: ${e.message}`));
    await page.goto(`http://localhost:${port}/?mode=versus&autopuff=9`, { waitUntil: 'networkidle2' });
    await page.addStyleTag({ content: HIDE_CSS });
    // let the connectomes finish loading and a rally get going
    await new Promise((r) => setTimeout(r, 6000));

    const client = await page.createCDPSession();
    const frames = [];
    let n = 0;
    let t0 = null;

    client.on('Page.screencastFrame', async (ev) => {
      const ts = ev.metadata.timestamp;
      if (t0 == null) t0 = ts;
      const file = path.join(tmp, `${String(n++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(ev.data, 'base64'));
      frames.push({ file, t: ts - t0 });
      try { await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* closing */ }
    });

    await client.send('Page.startScreencast', {
      format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1,
    });
    log(`  [pong] capturing ${seconds}s`);
    await new Promise((r) => setTimeout(r, seconds * 1000 + 800));
    try { await client.send('Page.stopScreencast'); } catch { /* ignore */ }

    if (frames.length < 10) throw new Error(`only ${frames.length} frames captured`);
    log(`  [pong] ${frames.length} frames over ${frames[frames.length - 1].t.toFixed(1)}s ` +
        `(${(frames.length / Math.max(1, frames[frames.length - 1].t)).toFixed(1)} fps captured)`);

    // resample the timestamped frames onto a constant timeline
    const ff = spawn(ffmpegPath(), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart',
      out,
    ]);
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; });
    const ffDone = new Promise((res, rej) => {
      ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}: ${ffErr.slice(-600)}`))));
      ff.on('error', rej);
    });
    ff.stdin.on('error', () => {});

    const total = Math.floor(seconds * fps);
    let cursor = 0;
    for (let k = 0; k < total; k++) {
      const t = k / fps;
      while (cursor + 1 < frames.length && frames[cursor + 1].t <= t) cursor++;
      await writeAsync(ff.stdin, fs.readFileSync(frames[cursor].file));
    }
    ff.stdin.end();
    await ffDone;
    log(`  [pong] done -> ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
    return out;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  await recordPong({
    seconds: Number(flag('--seconds', 60)),
    port: Number(flag('--port', 4173)),
  });
}
