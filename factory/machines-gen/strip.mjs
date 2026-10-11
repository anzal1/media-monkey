/*
 * strip.mjs: a motion strip of one generated machine, for judging motion.
 *
 * Six stills cannot show whether a motion is right. This steps the private
 * page that validate.mjs wrote (out/<model>/<concept>/page/page.html) through
 * every frame and grabs the plate alone at five moments of every scene, one
 * row per scene, into insights/visuals/gen/<model>/<kind>.motion.jpg.
 *
 *   node factory/machines-gen/strip.mjs factory/machines-gen/out/<model>/<concept>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const AT = [0.5, 1.3, 2.1, 2.9, 4.3];

export async function strip(dir) {
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const base = fs.existsSync(path.join(dir, 'page', 'page.html')) ? path.join(dir, 'page') : dir;
  const page = path.join(base, 'page.html');
  const shots = path.join(base, 'strip');
  fs.rmSync(shots, { recursive: true, force: true });
  fs.mkdirSync(shots, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
  const files = [];
  let rows = 0;
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href + '?manual=1', { waitUntil: 'networkidle0' });
    await tab.waitForFunction('window.MM_READY === true', { timeout: 20000 });
    const starts = await tab.evaluate(() => window.SPEC.starts);
    rows = starts.length;
    let next = 0;
    for (const s of starts) {
      for (const a of AT) {
        const target = Math.round((s + a) * 30);
        await tab.evaluate((x, z) => { for (let i = x; i <= z; i++) window.MM.frame(i); }, next, target);
        next = target + 1;
        const r = await tab.evaluate(() => {
          const el = [...document.querySelectorAll('.mach')].filter((m) => m.offsetParent !== null).pop();
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        });
        const file = path.join(shots, `s${starts.indexOf(s)}-${a}.png`);
        // a fixed box around the plate keeps every cell the same size
        const clip = r ? { x: Math.max(0, r.x + r.w / 2 - 380), y: Math.max(0, r.y + r.h / 2 - 330), width: 760, height: 660 } : { x: 160, y: 560, width: 760, height: 660 };
        await tab.screenshot({ path: file, clip });
        files.push(file);
      }
    }
  } finally { await browser.close(); }
  const out = path.join(REPO, 'insights', 'visuals', 'gen', res.model, `${res.kind}${res.tag || ''}.motion.jpg`);
  const inputs = files.flatMap((f) => ['-i', f]);
  const scale = files.map((_, i) => `[${i}]scale=380:330[s${i}]`).join(';');
  const layout = files.map((_, i) => `${(i % AT.length) * 380}_${Math.floor(i / AT.length) * 330}`).join('|');
  execFileSync('nice', ['-n', '15', 'ffmpeg', '-y', '-loglevel', 'error', '-threads', '2', ...inputs,
    '-filter_complex', `${scale};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}[o]`,
    '-map', '[o]', '-frames:v', '1', '-q:v', '3', out]);
  void rows;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const d of process.argv.slice(2)) console.log(path.relative(REPO, await strip(path.resolve(d))));
}
