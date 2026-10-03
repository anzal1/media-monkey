// Contact sheet of the kept hero art, in index.json order, for eyeballing the set.
//   node factory/art/sheet.mjs [out.jpg] [cols]
// Each tile is padded to a 512 square on paper colour, then ffmpeg tiles them.
// Runs under nice: it is a handful of small stills, but it is still local work.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ART = path.join(ROOT, 'assets/art');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'insights/visuals/art-sheet.jpg'));
const cols = Number(process.argv[3] || 6);

const rows = JSON.parse(fs.readFileSync(path.join(ART, 'index.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-sheet-'));
const ff = (args) => execFileSync('nice', ['ffmpeg', '-loglevel', 'error', '-y', ...args]);

rows.forEach((r, i) => {
  ff(['-i', path.join(ART, r.file), '-vf',
    'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0xF3EEE4',
    path.join(tmp, `${String(i).padStart(3, '0')}.png`)]);
});
const rowsN = Math.ceil(rows.length / cols);
ff(['-i', path.join(tmp, '%03d.png'), '-frames:v', '1', '-vf',
  `tile=${cols}x${rowsN}:color=0xDDD6C8:padding=8:margin=8,scale=iw/2:-1`, '-q:v', '4', out]);
fs.rmSync(tmp, { recursive: true });
console.log(`${out} (${rows.length} tiles)`);
