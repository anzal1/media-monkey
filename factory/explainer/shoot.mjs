/*
 * shoot.mjs — screenshot the scene page at chosen times.
 *
 * Rendering a whole reel to check a layout change costs three minutes. This
 * drives the same page through the same frame harness and writes PNGs, with an
 * optional overlay of the Instagram crop zones so it is obvious when something
 * has drifted under the grid crop or behind the Reels UI.
 *
 *   node factory/explainer/shoot.mjs out/_shots 1,5,10,20 --zones
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..', 'bg', 'explainer.html');

const ZONE_CSS = `
  .mm-zone { position: fixed; z-index: 99999; pointer-events: none; }
  .mm-crop { left: 0; right: 0; background: rgba(255,0,0,.16); }
  .mm-ui   { background: rgba(0,80,255,.16); }
  .mm-tag  { position: fixed; z-index: 100000; font: 700 22px monospace; color: #b91c1c; }`;
const ZONE_HTML = `
  <div class="mm-zone mm-crop" style="top:0;height:285px"></div>
  <div class="mm-zone mm-crop" style="top:1635px;height:285px"></div>
  <div class="mm-zone mm-ui" style="left:0;right:0;bottom:0;height:450px"></div>
  <div class="mm-zone mm-ui" style="right:0;top:900px;width:180px;height:700px"></div>
  <div class="mm-tag" style="left:16px;top:292px">4:5 GRID CROP EDGE</div>
  <div class="mm-tag" style="left:16px;top:1440px">REELS UI FROM HERE</div>`;

export async function shoot(outDir, times, { zones = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto('file://' + PAGE + '?manual=1', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.MM_READY === true', { timeout: 15000 });
  if (zones) {
    await page.addStyleTag({ content: ZONE_CSS });
    await page.evaluate((h) => document.body.insertAdjacentHTML('beforeend', h), ZONE_HTML);
  }

  const files = [];
  for (const t of times) {
    // frames are drawn in order from 0, so step up to the target rather than
    // jumping: the scene builders assume monotonic time.
    const target = Math.round(t * 30);
    await page.evaluate((n) => {
      for (let i = Math.max(0, n - 3); i <= n; i++) window.MM.frame(i);
    }, target);
    const file = path.join(outDir, `t${String(t).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await browser.close();
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || 'out/_shots';
  const times = (process.argv[3] || '1,5,10,15,20,25,30,35,40,44').split(',').map(Number);
  const files = await shoot(out, times, { zones: process.argv.includes('--zones') });
  console.log(files.join('\n'));
}
