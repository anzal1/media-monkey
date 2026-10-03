// Hero art library generator.
//
// Every reel has a hero object that travels through the explanation (the photo
// that gets compressed, the coin that moves between accounts). This script draws
// a varied set of them with the Gemini image API in ONE house style, so the
// planner can pick art that matches the story instead of reusing one sunset.
//
// Usage:
//   node factory/art/generate.mjs                 draw every subject missing a raw file
//   node factory/art/generate.mjs --only cat,dog  (re)draw just these
//   node factory/art/generate.mjs --force         redraw everything
//   node factory/art/generate.mjs --index         rebuild assets/art/index.json only
//   node factory/art/generate.mjs --reoptimise    re-encode assets/art from the raw files, no API calls
//
// Raw PNGs land in out/art-raw/ (gitignored). Kept art is optimised to WebP
// (max 512px) in assets/art/ by optimise(), which runs after each draw.
// Rejected slugs are listed in REJECTED and skipped by --index.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiKey } from '../llm.mjs';
import { SUBJECTS } from './subjects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(ROOT, 'out/art-raw');
const OUT = path.join(ROOT, 'assets/art');
const MODEL = process.env.ART_MODEL || 'gemini-3.1-flash-image';

// One shared style block, appended to every subject so the set reads as one hand.
export const STYLE = [
  'Flat editorial illustration in a single consistent house style.',
  'Background: warm off-white paper (#F3EEE4) with a very subtle paper grain.',
  'Clean confident dark charcoal ink outlines (#2A2723) of even weight, slightly hand-drawn.',
  'Strictly limited palette: warm paper, charcoal ink, muted terracotta (#C46A4A), dusty sage green (#8FA38C), pale ochre (#E2C37E). No other hues.',
  'Flat colour fills with at most one soft shadow tone, simple shapes, generous negative space, calm and tidy composition.',
  'Absolutely no text, letters, numbers, words, logos, brand marks, watermarks or signatures anywhere. Where text would normally appear, use plain wavy ink lines or blank bars instead.',
  'Not photorealistic, not a 3D render, no glossy gradients, no stock-vector look, no drop-shadow frame, no border.',
].join(' ');

const KIND_FRAME = {
  photo:
    'Compose it as a full-bleed illustrated photograph: the scene fills the whole frame edge to edge, no paper margin, no frame or border.',
  object:
    'Show a single centred object isolated on the plain paper background with comfortable margin on all sides, seen from a slight three-quarter front angle.',
  document:
    'Show a single paper item flat, centred and slightly rotated on the plain paper background, with comfortable margin on all sides.',
  screen:
    'Show only the flat app-screen content itself as a centred rounded card on the plain paper background, no phone body, no device frame.',
};

// Drawn, looked at, and thrown out: kept here so --index never re-adds them.
export const REJECTED = new Set([]);

function args() {
  const a = process.argv.slice(2);
  const only = a.includes('--only') ? a[a.indexOf('--only') + 1].split(',') : null;
  return {
    only,
    force: a.includes('--force'),
    indexOnly: a.includes('--index'),
    reoptimise: a.includes('--reoptimise'),
  };
}

async function draw(s) {
  const prompt = `${s.prompt}\n\n${KIND_FRAME[s.kind]}\n\n${STYLE}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: s.aspect, imageSize: '1K' },
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      }
      throw new Error(`${s.slug}: gemini ${res.status} ${detail}`);
    }
    const data = await res.json();
    const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
    if (!part) {
      if (attempt < 3) continue;
      throw new Error(`${s.slug}: no image (finish=${data?.candidates?.[0]?.finishReason})`);
    }
    const buf = Buffer.from(part.inlineData.data, 'base64');
    const ext = part.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    for (const e of ['png', 'jpg']) fs.rmSync(path.join(RAW, `${s.slug}.${e}`), { force: true });
    const file = path.join(RAW, `${s.slug}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  }
}

// Isolated subjects come back with wide paper margins. Crop to the inked
// content plus a small even margin, kept square, so the hero fills its card.
// Photos are full scenes and are never cropped.
const TRIM_PY = `
import sys
from PIL import Image
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(int)
h, w, _ = a.shape
corners = np.concatenate([a[:8,:8].reshape(-1,3), a[:8,-8:].reshape(-1,3), a[-8:,:8].reshape(-1,3), a[-8:,-8:].reshape(-1,3)])
bg = np.median(corners, axis=0)
mask = (np.abs(a - bg).max(axis=2) > 30)
ys, xs = np.where(mask)
if len(xs) < 50:
    im.save(dst); sys.exit()
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
side = int(max(x1 - x0, y1 - y0) * 1.14)
side = min(side, w, h)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
left = min(max(cx - side // 2, 0), w - side)
top = min(max(cy - side // 2, 0), h - side)
im.crop((left, top, left + side, top + side)).save(dst)
`;

// Trim (non-photos), downscale to max 512px and encode WebP.
// python3/PIL, sips and cwebp are all light, one still at a time.
export function optimise(s) {
  const raw = ['png', 'jpg'].map((e) => path.join(RAW, `${s.slug}.${e}`)).find(fs.existsSync);
  if (!raw) return null;
  const tmp = path.join(RAW, `${s.slug}.tmp.png`);
  if (s.kind === 'photo') {
    execFileSync('sips', ['-s', 'format', 'png', raw, '--out', tmp], { stdio: 'ignore' });
  } else {
    execFileSync('python3', ['-c', TRIM_PY, raw, tmp]);
  }
  execFileSync('sips', ['-Z', '512', tmp], { stdio: 'ignore' });
  const dest = path.join(OUT, `${s.slug}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', '78', '-m', '6', tmp, '-o', dest]);
  fs.rmSync(tmp);
  return dest;
}

function writeIndex() {
  const rows = SUBJECTS.filter((s) => !REJECTED.has(s.slug))
    .filter((s) => fs.existsSync(path.join(OUT, `${s.slug}.webp`)))
    .map((s) => {
      const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(OUT, `${s.slug}.webp`)]).toString();
      const w = Number(/pixelWidth: (\d+)/.exec(info)[1]);
      const h = Number(/pixelHeight: (\d+)/.exec(info)[1]);
      return { slug: s.slug, file: `${s.slug}.webp`, tags: s.tags, kind: s.kind, aspect: s.aspect, w, h };
    });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(`index.json: ${rows.length} entries`);
}

async function main() {
  const { only, force, indexOnly, reoptimise } = args();
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  if (indexOnly) return writeIndex();
  if (reoptimise) {
    for (const s of SUBJECTS) if (!REJECTED.has(s.slug)) optimise(s);
    return writeIndex();
  }

  const todo = SUBJECTS.filter((s) => {
    if (only) return only.includes(s.slug);
    if (REJECTED.has(s.slug)) return false;
    return force || !['png', 'jpg'].some((e) => fs.existsSync(path.join(RAW, `${s.slug}.${e}`)));
  });
  // Small pool: the work is remote, this just keeps the rate limiter happy.
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      try {
        await draw(s);
        optimise(s);
        console.log(`ok   ${s.slug}`);
      } catch (e) {
        console.log(`FAIL ${e.message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeIndex();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
