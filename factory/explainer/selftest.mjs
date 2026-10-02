/*
 * selftest.mjs — run every scene fixture through every frame before a render.
 *
 * A meter-chart crash shipped once because no fixture used that scene type
 * at the time and nothing ran the page end to end. This loads each fixture in
 * factory/explainer/spec*.json, steps every frame in order and fails on the
 * first page error. Seconds, not minutes, so CI runs it before every render.
 *
 *   node factory/explainer/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..', 'bg', 'explainer.html');
const SPEC = path.join(HERE, '..', 'bg', 'explainer-spec.js');
const fixtures = fs.readdirSync(HERE).filter((f) => /^spec.*\.json$/.test(f));
const original = fs.existsSync(SPEC) ? fs.readFileSync(SPEC) : null;

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox'] });
let failed = 0;
try {
  for (const f of fixtures) {
    const spec = JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
    for (const s of spec.scenes) s.of = s.of || 1;
    fs.writeFileSync(SPEC, 'window.SPEC = ' + JSON.stringify(spec) + ';');
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('file://' + PAGE + '?manual=1');
    await page.waitForFunction('window.MM_READY === true', { timeout: 20000 });
    const end = Math.ceil(((spec.starts?.at(-1) ?? 60) + 8) * 30);
    const r = await page.evaluate((n) => {
      let i = 0;
      try { for (; i < n; i++) window.MM.frame(i); return null; } catch (e) { return `frame ${i}: ${e.message}`; }
    }, end);
    const problem = r || errs[0];
    console.log(`${problem ? 'FAIL' : 'ok  '}  ${f} (${spec.scenes.length} scenes, ${end} frames)${problem ? '  ' + problem : ''}`);
    if (problem) failed++;
    await page.close();
  }
} finally {
  await browser.close();
  if (original) fs.writeFileSync(SPEC, original);
}
if (failed) { console.error(`${failed} fixture(s) crashed the scene renderer`); process.exit(1); }
