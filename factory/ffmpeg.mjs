// ffmpeg/ffprobe resolution.
//
// The burn-in stage needs the `subtitles` filter, which means the binary must
// have been built with libass. The homebrew ffmpeg 9 on this machine was NOT
// (its configure line has no --enable-libass), so candidates are probed for the
// filter and the first capable one wins. ffmpeg-static 6.0 ships libass plus
// fontconfig, so it is the working fallback. ffprobe still comes from the
// system, since ffmpeg-static does not ship one.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function which(bin) {
  try {
    return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

function candidates() {
  const list = [];
  if (process.env.MEDIAMONKEY_FFMPEG) list.push(process.env.MEDIAMONKEY_FFMPEG);
  list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  const w = which('ffmpeg');
  if (w) list.push(w);
  for (const mod of [
    'ffmpeg-static',
    path.join(os.homedir(), 'personal', 'voila', 'node_modules', 'ffmpeg-static'),
  ]) {
    try {
      const p = require(mod);
      if (p) list.push(p);
    } catch { /* not installed */ }
  }
  return [...new Set(list)].filter((p) => p && fs.existsSync(p));
}

const filterCache = new Map();
function hasFilter(bin, filter) {
  const key = `${bin}::${filter}`;
  if (filterCache.has(key)) return filterCache.get(key);
  let ok = false;
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 22,
    });
    ok = new RegExp(`^\\s*\\S+\\s+${filter}\\s`, 'm').test(out);
  } catch { ok = false; }
  filterCache.set(key, ok);
  return ok;
}

const cachedFf = new Map();
/**
 * @param {object} [o] { needs: 'subtitles' } to require a libass build
 * @returns {string} path to an ffmpeg binary
 */
export function ffmpegPath(o = {}) {
  const needs = o.needs || null;
  if (cachedFf.has(needs)) return cachedFf.get(needs);
  const list = candidates();
  if (!list.length) throw new Error('no ffmpeg found; install one or set MEDIAMONKEY_FFMPEG');
  const pick = needs ? list.find((p) => hasFilter(p, needs)) : list[0];
  if (!pick) {
    throw new Error(
      `no ffmpeg with the "${needs}" filter (libass). Tried: ${list.join(', ')}. ` +
      'Run `npm i ffmpeg-static` or `brew install ffmpeg --with-libass`.',
    );
  }
  cachedFf.set(needs, pick);
  return pick;
}

let cachedProbe = null;
export function ffprobePath() {
  if (cachedProbe) return cachedProbe;
  if (process.env.MEDIAMONKEY_FFPROBE && fs.existsSync(process.env.MEDIAMONKEY_FFPROBE)) {
    return (cachedProbe = process.env.MEDIAMONKEY_FFPROBE);
  }
  const sibling = path.join(path.dirname(ffmpegPath()), 'ffprobe');
  if (fs.existsSync(sibling)) return (cachedProbe = sibling);
  const w = which('ffprobe');
  if (w) return (cachedProbe = w);
  throw new Error('no ffprobe found; set MEDIAMONKEY_FFPROBE');
}

/** Duration in seconds of any media file. */
export function probeDuration(file) {
  const out = execFileSync(ffprobePath(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim();
  const d = Number(out);
  if (!Number.isFinite(d)) throw new Error(`could not probe duration of ${file}`);
  return d;
}

/** Compact stream summary, for the acceptance check. */
export function probeSummary(file) {
  const out = execFileSync(ffprobePath(), [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels',
    '-show_entries', 'format=duration,size,format_name',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}

/**
 * How much ink the first frame carries, 0..1.
 *
 * Instagram takes the grid cover from the opening frame, so a reel whose first
 * frame is still fading up gets a blank thumbnail in the profile grid. That is
 * invisible in the video itself and only shows up on the account, which is
 * exactly the kind of bug worth asserting on. Returns the fraction of pixels
 * darker than mid grey on a downscaled greyscale copy of the frame.
 */
export function firstFrameInk(file, atSeconds = 0) {
  const out = execFileSync(ffmpegPath(), [
    '-nostdin', '-loglevel', 'error',
    '-ss', String(atSeconds), '-i', file, '-frames:v', '1',
    '-vf', 'format=gray,scale=64:114', '-f', 'rawvideo', '-',
  ], { maxBuffer: 1 << 20 });
  let dark = 0;
  for (const b of out) if (b < 140) dark++;
  return out.length ? dark / out.length : 0;
}

