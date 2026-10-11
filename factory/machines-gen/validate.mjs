/*
 * validate.mjs: prove a generated machine in the real renderer page.
 *
 * The module is never copied into factory/explainer. This writes a private
 * copy of the scene page into the machine's own out/ folder, with a <base>
 * pointing at factory/bg so every asset resolves, the generated module added
 * after odometer.js and its own spec file. The live page and the tracked
 * explainer-spec.js are never touched, so a broken module cannot reach a reel.
 *
 * Checks, per fixture scene:
 *   - the module loads and registers its kind, with no page errors
 *   - normalize and mount succeed (the page would otherwise fall back to stat)
 *   - every frame of the scene: no exception, readout of the right types, no
 *     NaN / undefined / Infinity in the markup, geometry inside the viewBox
 *   - determinism: render(t) is the same string twice, in any order
 *   - the scene actually moves
 *   - script time per frame of the machine itself (mount excluded), min of two
 *     runs per frame so a GC pause is not blamed on the module; budget 5 ms
 * Then the whole page is stepped frame by frame through every scene, as the
 * selftest does, and screenshots are taken on the way.
 *
 *   node factory/machines-gen/validate.mjs <module.js|-> <fixture.json> <outDir> [--kind odometer]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../record-bg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BG = path.join(HERE, '..', 'bg');
const PAGE = path.join(BG, 'explainer.html');
const FPS = 30;
const TITLE = 3;
const SPAN = 5;
export const BUDGET_MS = 5;

// things a machine module has no business doing
const BANNED = [
  [/\bMath\.random\b/, 'uses Math.random (must be deterministic: hash the index instead)'],
  [/\bDate\b\s*[.(]|\bnew Date\b/, 'uses Date (must be a pure function of t)'],
  [/\bperformance\.now\b/, 'uses performance.now (must be a pure function of t)'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\b/, 'schedules its own timers (the page steps time)'],
  [/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\b/, 'touches the network'],
  [/\beval\s*\(|\bnew Function\b|\bimport\s*\(/, 'evaluates code at runtime'],
  [/\b(document|localStorage|sessionStorage)\s*\./, 'touches the DOM or storage (return strings only)'],
  [/^\s*(import|export)\s/m, 'uses import/export (must be a classic script)'],
];

export function lint(src) {
  return BANNED.filter(([re]) => re.test(src)).map(([, msg]) => `module ${msg}`);
}

/** Wrap fixture scenes into a full scene-page spec. */
export function specOf(kind, fixture) {
  const scenes = fixture.scenes.map((sc, i) => ({
    type: 'machine',
    headline: sc.headline || '',
    subhead: sc.subhead || '',
    data: { kind, params: sc.params || {}, state: sc.state || {} },
    beat: i, half: 0, of: 1,
  }));
  return {
    eyebrow: 'MACHINE LAB', accent: '#c2410c', episode: 'THE PROD MONKEY', handle: '',
    title: { kicker: 'GENERATED MACHINE', title: fixture.title || kind, keyword: kind },
    titleUntil: TITLE,
    starts: scenes.map((_, i) => TITLE + i * SPAN),
    scenes,
  };
}

/** Six shot times spread over the scenes, mid motion and settled. */
export function shotTimes(n) {
  const plan = n <= 1 ? [[0, 0.3], [0, 0.45], [0, 0.6], [0, 0.75], [0, 0.85], [0, 0.95]]
    : n === 2 ? [[0, 0.3], [0, 0.6], [0, 0.9], [1, 0.3], [1, 0.6], [1, 0.9]]
      : n === 3 ? [[0, 0.4], [0, 0.88], [1, 0.4], [1, 0.88], [2, 0.4], [2, 0.88]]
        : [[0, 0.4], [0, 0.88], [1, 0.6], [2, 0.6], [n - 1, 0.4], [n - 1, 0.88]];
  return plan.map(([s, f]) => +(TITLE + s * SPAN + f * SPAN).toFixed(2));
}

function writePage(outDir, modulePath, spec) {
  fs.mkdirSync(outDir, { recursive: true });
  const specFile = path.join(outDir, 'spec.js');
  fs.writeFileSync(specFile, 'window.SPEC = ' + JSON.stringify(spec) + ';');
  let html = fs.readFileSync(PAGE, 'utf8');
  // the page has no <head> tag: the base goes right after the charset meta
  html = html.replace(/(<meta charset="utf-8" \/>)/i, `$1\n<base href="${pathToFileURL(BG).href}/">`);
  if (!html.includes('<base href=')) throw new Error('could not place <base> in the scene page');
  const odo = '<script src="../explainer/machines/odometer.js"></script>';
  if (!html.includes(odo)) throw new Error('scene page no longer loads odometer.js where expected');
  const extra = modulePath ? `\n<script src="${pathToFileURL(path.resolve(modulePath)).href}"></script>` : '';
  html = html.replace(odo, odo + extra);
  html = html.replace('<script src="explainer-spec.js"></script>', `<script src="${pathToFileURL(specFile).href}"></script>`);
  const page = path.join(outDir, 'page.html');
  fs.writeFileSync(page, html);
  return page;
}

// runs in the page: every per-scene check, returns plain data
function probe(kind, scenes, span, budget) {
  const M = window.MM_MACHINES;
  const out = { errors: [], scenes: [] };
  const err = (m) => { if (out.errors.length < 40) out.errors.push(m); };
  const where = (e) => {
    const st = String((e && e.stack) || '').split('\n').find((l) => /module\.js|\.js:\d+/.test(l) && !/machines\.js|explainer\.html/.test(l)) || '';
    const m = /(\w[\w.-]*\.js):(\d+):(\d+)/.exec(st);
    return `${(e && e.name) || 'Error'}: ${(e && e.message) || e}${m ? ` (at ${m[1]} line ${m[2]})` : ''}`;
  };
  if (!M || !M.has(kind)) { err(`kind "${kind}" is not registered after loading the module (registered: ${M ? M.kinds().join(', ') : 'none'})`); return out; }
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:1000px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const bad = /NaN|undefined|Infinity/;
  scenes.forEach((sc, i) => {
    const info = { i, frames: 0, ms: [], mountMs: 0, solids: 0, paths: 0, moves: 0, vb: null, out: 0 };
    out.scenes.push(info);
    const tag = `scene ${i + 1}`;
    try { M.normalize(kind, sc.params, sc.state); } catch (e) { err(`${tag}: normalize threw ${where(e)}`); return; }
    let m;
    const el = document.createElement('div');
    host.appendChild(el);
    try {
      const t0 = performance.now();
      m = M.mount(el, kind, sc.params, sc.state);
      info.mountMs = performance.now() - t0;
    } catch (e) { err(`${tag}: build/mount threw ${where(e)}`); el.remove(); return; }
    const svg = el.querySelector('svg');
    const vbA = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const [, , W, H] = vbA;
    info.vb = [W, H];
    if (!(W > 100 && W <= 2000 && H > 100 && H <= 2000)) err(`${tag}: viewBox ${svg.getAttribute('viewBox')} is not a sane size (expected about 1000 x 420..700)`);
    const meta = m.meta || {};
    if (typeof meta.label !== 'string' || typeof meta.corner !== 'string') err(`${tag}: meta.label and meta.corner must be strings`);
    const n = Math.ceil(span * 30) + 1;
    const times = [[], []];
    let last = null; let nanAt = null; let outAt = null; let worst = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let f = 0; f < n; f++) {
        const t = f / 30;
        let r;
        const a = performance.now();
        try { r = m.frame(t, span); } catch (e) { err(`${tag} t=${t.toFixed(2)}s: frame threw ${where(e)}`); return; }
        times[pass].push(performance.now() - a);
        if (pass) continue;
        info.frames++;
        if (!r || typeof r.label !== 'string' || typeof r.value !== 'string' || typeof r.tag !== 'string') {
          if (info.badReadout == null) { info.badReadout = 1; err(`${tag} t=${t.toFixed(2)}s: readout must be { label: string, value: string, tag: string, tagIn: number }, got ${JSON.stringify(r).slice(0, 160)}`); }
        } else if (r.tag && !(typeof r.tagIn === 'number' && r.tagIn >= 0 && r.tagIn <= 1)) {
          if (info.badTag == null) { info.badTag = 1; err(`${tag} t=${t.toFixed(2)}s: readout.tagIn must be a number 0..1 when tag is set, got ${r.tagIn}`); }
        } else if (r.value.length > 14 && info.longValue == null) { info.longValue = 1; err(`${tag}: readout.value "${r.value}" is longer than 12 characters`); }
        const html = svg.innerHTML;
        if (last !== null && html !== last) info.moves++;
        last = html;
        if (nanAt === null && bad.test(html)) {
          nanAt = t;
          const hit = /[^<>]{0,80}(NaN|undefined|Infinity)[^<>]{0,40}/.exec(html);
          err(`${tag} t=${t.toFixed(2)}s: markup contains ${hit[1]} near "${hit[0].trim().slice(0, 120)}"`);
        }
        if (f % 3 === 0 || f === n - 1) {
          el.style.visibility = 'visible';
          let b;
          try { b = svg.getBBox(); } catch (e) { b = null; }
          if (b) {
            const tol = 0.01 * W;
            const over = Math.max(0 - b.x, 0 - b.y, b.x + b.width - W, b.y + b.height - H);
            if (over > tol) {
              info.out++;
              if (!worst || over > worst.over) worst = { over, t, b: [b.x, b.y, b.width, b.height].map((v) => Math.round(v)) };
            }
          }
        }
      }
    }
    if (worst) err(`${tag}: geometry leaves the plate (viewBox 0 0 ${W} ${H}) in ${info.out} sampled frames, worst at t=${worst.t.toFixed(2)}s with bbox x=${worst.b[0]} y=${worst.b[1]} w=${worst.b[2]} h=${worst.b[3]}`);
    void outAt;
    info.ms = times[0].map((v, k) => Math.min(v, times[1][k]));
    info.solids = svg.querySelectorAll('g.iso-solid').length;
    info.paths = svg.querySelectorAll('path').length;
    const emptyFill = [...svg.querySelectorAll('path.iso-fill')].filter((p) => !(p.getAttribute('d') || '').trim()).length;
    if (emptyFill) err(`${tag}: ${emptyFill} solids have an empty fill path (degenerate geometry)`);
    if (!svg.querySelectorAll('path').length) err(`${tag}: the figure draws no paths at all`);
    if (info.moves < 3) err(`${tag}: the machine does not visibly move during the scene (markup changed ${info.moves} times)`);
    const slow = info.ms.filter((v) => v > budget);
    const sorted = [...info.ms].sort((x, y) => x - y);
    info.median = sorted[Math.floor(sorted.length / 2)] || 0;
    info.max = sorted[sorted.length - 1] || 0;
    if (slow.length) err(`${tag}: ${slow.length} of ${info.ms.length} frames take more than ${budget} ms of script (worst ${info.max.toFixed(1)} ms, median ${info.median.toFixed(1)} ms); build more in build() and less per frame`);
    // determinism: same t, same picture, whatever was drawn in between
    try {
      const ts = [0.9, 2.1, 3.3, span - 0.2];
      const a = ts.map((t) => M.render(kind, sc.params, sc.state, t, span));
      const b = [...ts].reverse().map((t) => M.render(kind, sc.params, sc.state, t, span)).reverse();
      const k = a.findIndex((x, j) => x !== b[j]);
      if (k >= 0) err(`${tag}: not deterministic, render(t=${ts[k]}) differs between two calls`);
    } catch (e) { err(`${tag}: render threw ${where(e)}`); }
    el.remove();
  });
  host.remove();
  return out;
}

/**
 * Validate one module + fixture. Returns
 * { ok, errors[], scenes[], msPerFrame: { median, max }, pageMs, shots[], tile }.
 */
export async function validate({ modulePath, fixture, kind, outDir, shots = true, tilePath = null }) {
  const errors = [];
  if (modulePath) errors.push(...lint(fs.readFileSync(modulePath, 'utf8')));
  if (!fixture || !Array.isArray(fixture.scenes) || fixture.scenes.length < 1) {
    return { ok: false, errors: [...errors, 'fixture has no scenes'], scenes: [] };
  }
  if (fixture.scenes.length < 3 || fixture.scenes.length > 4) errors.push(`fixture has ${fixture.scenes.length} scenes, expected 3 or 4`);
  const spec = specOf(kind, fixture);
  const page = writePage(outDir, modulePath, spec);
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
  });
  const res = { ok: false, errors, scenes: [], shots: [] };
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    const pageErrors = [];
    tab.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
    try {
      await tab.goto(pathToFileURL(page).href + '?manual=1', { waitUntil: 'networkidle0', timeout: 30000 });
      await tab.waitForFunction('window.MM_READY === true', { timeout: 20000 });
    } catch (e) {
      errors.push(`page did not get ready: ${pageErrors[0] || e.message}`);
      return res;
    }
    for (const m of pageErrors) errors.push(`page error while loading: ${m}`);
    const fell = await tab.evaluate(() => window.SPEC.scenes.map((s, i) => (s.machineError ? `scene ${i + 1}: the page fell back to a stat card because ${s.machineError}` : null)).filter(Boolean));
    errors.push(...fell);
    const p = await tab.evaluate(probe, kind, fixture.scenes, SPAN - 0.0001, BUDGET_MS);
    errors.push(...p.errors);
    res.scenes = p.scenes;
    const all = p.scenes.flatMap((s) => s.ms || []).sort((a, b) => a - b);
    res.msPerFrame = all.length ? { median: +all[Math.floor(all.length / 2)].toFixed(3), p95: +all[Math.floor(all.length * 0.95)].toFixed(3), max: +all[all.length - 1].toFixed(3) } : null;
    res.mountMs = p.scenes.map((s) => +(s.mountMs || 0).toFixed(1));
    res.solids = p.scenes.map((s) => s.solids);
    res.paths = p.scenes.map((s) => s.paths);

    // whole page, every frame in order, as the selftest and shoot do
    const end = Math.ceil((spec.starts.at(-1) + SPAN) * FPS);
    const targets = shots ? shotTimes(fixture.scenes.length).map((t) => Math.round(t * FPS)) : [];
    const dir = path.join(outDir, 'shots');
    if (shots) fs.mkdirSync(dir, { recursive: true });
    let next = 0;
    const pageMs = [];
    for (const target of [...targets, end - 1]) {
      const r = await tab.evaluate((a, z, title) => {
        const ms = [];
        for (let i = a; i <= z; i++) {
          const t0 = performance.now();
          try { window.MM.frame(i); } catch (e) { return { err: `page frame ${i} (t=${(i / 30).toFixed(2)}s) threw ${e.name}: ${e.message}` }; }
          if (i >= title * 30) ms.push(performance.now() - t0);
        }
        return { ms };
      }, next, target, TITLE);
      if (r.err) { errors.push(r.err); break; }
      pageMs.push(...r.ms);
      next = target + 1;
      if (shots && target !== end - 1) {
        const file = path.join(dir, `f${String(target).padStart(4, '0')}.png`);
        await tab.screenshot({ path: file });
        res.shots.push(file);
      }
    }
    for (const m of pageErrors.slice(fell.length)) if (!errors.includes(`page error while loading: ${m}`)) errors.push(`page error: ${m}`);
    pageMs.sort((a, b) => a - b);
    res.pageMs = pageMs.length ? { median: +pageMs[Math.floor(pageMs.length / 2)].toFixed(2), max: +pageMs.at(-1).toFixed(2) } : null;
  } finally {
    await browser.close();
  }
  res.errors = [...new Set(errors)];
  res.ok = res.errors.length === 0;
  if (tilePath && res.shots.length === 6) res.tile = tile(res.shots, tilePath);
  return res;
}

/** Six 1080x1920 frames into one 3 x 2 contact sheet at half size, cropped to the hero. */
export function tile(files, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const inputs = files.flatMap((f) => ['-i', f]);
  // the headline and the plate live between y 250 and 1350; the rest is the
  // empty lower third the captions use, which tells nothing about the machine
  const scale = files.map((_, i) => `[${i}]crop=1080:1100:0:250,scale=540:550[s${i}]`).join(';');
  const stack = files.map((_, i) => `[s${i}]`).join('') + 'xstack=inputs=6:layout=0_0|540_0|1080_0|0_550|540_550|1080_550[o]';
  execFileSync('nice', ['-n', '15', 'ffmpeg', '-y', '-loglevel', 'error', '-threads', '2', ...inputs,
    '-filter_complex', `${scale};${stack}`, '-map', '[o]', '-frames:v', '1', '-q:v', '3', outFile]);
  return outFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modArg, fixArg, outDir] = process.argv.slice(2);
  const ki = process.argv.indexOf('--kind');
  const ti = process.argv.indexOf('--tile');
  const fx = JSON.parse(fs.readFileSync(fixArg, 'utf8'));
  // a full scene-page spec works too: take its machine scenes
  const fixture = fx.scenes && fx.scenes[0] && fx.scenes[0].data
    ? { scenes: fx.scenes.filter((s) => s.type === 'machine').map((s) => ({ headline: s.headline, subhead: s.subhead, params: s.data.params, state: s.data.state })) }
    : fx;
  const kind = ki > 0 ? process.argv[ki + 1] : null;
  const r = await validate({ modulePath: modArg === '-' ? null : modArg, fixture, kind, outDir, tilePath: ti > 0 ? process.argv[ti + 1] : null });
  console.log(JSON.stringify({ ...r, scenes: r.scenes.map(({ ms, ...s }) => s) }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
