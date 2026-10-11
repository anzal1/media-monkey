/*
 * clip.mjs: a short preview video of each generated machine, so its motion
 * can be judged by eye. Steps every frame in order (as the selftest does),
 * screenshots every second frame at half size, and pipes them to ffmpeg.
 * Light on purpose: 540x960, 15 fps, the title card skipped.
 *
 *   node factory/machines-gen/clip.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const dest = process.argv[2] || path.join(HERE, '..', '..', 'insights', 'visuals', 'gen', 'clips');
fs.mkdirSync(dest, { recursive: true });

const pages = [];
for (const model of fs.readdirSync(OUT)) {
  const dir = path.join(OUT, model);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const concept of fs.readdirSync(dir)) {
    const page = path.join(dir, concept, 'page', 'page.html');
    if (fs.existsSync(page)) pages.push({ model, concept, page });
  }
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio'],
});
for (const { model, concept, page: file } of pages) {
  const spec = fs.readFileSync(path.join(path.dirname(file), 'spec.js'), 'utf8');
  const s = JSON.parse(spec.replace(/^window\.SPEC = /, '').replace(/;\s*$/, ''));
  const from = Math.round((s.titleUntil || 3) * 30);
  const to = Math.round(((s.starts || [0]).at(-1) + 5) * 30);
  const out = path.join(dest, `${model}--${concept}.mp4`);
  const ff = spawn('nice', ['-n', '19', 'ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '15', '-i', '-',
    '-threads', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 0.5 });
  await page.goto('file://' + file + '?manual=1', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.MM_READY === true', { timeout: 15000 });
  await page.evaluate((z) => { for (let i = 0; i < z; i++) window.MM.frame(i); }, from);
  for (let i = from; i < to; i += 2) {
    await page.evaluate((a) => { window.MM.frame(a); window.MM.frame(a + 1); }, i);
    ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 85 }));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await page.close();
  console.log('clip', path.relative(process.cwd(), out));
}
await browser.close();
