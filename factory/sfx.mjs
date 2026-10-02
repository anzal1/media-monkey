/*
 * sfx.mjs — sound design for the scene track.
 *
 * Every effect is synthesised by ffmpeg from a formula, so there is nothing to
 * license and the bank is identical on every machine. Cues come from the same
 * timings the renderer uses (a cut, a stat landing, a node changing state), and
 * the track is mixed sample by sample in JS rather than through a 60-input
 * ffmpeg graph.
 *
 * Levels are deliberately low and the whoosh is band-limited away from the
 * 1-4 kHz speech band: the one piece of viewer feedback on the audio was that
 * the voice was hard to understand, and nothing here may make that worse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from './ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.join(HERE, '..', 'assets', 'sfx');
const RATE = 44100;

const RECIPES = {
  // air moving past: pink noise, kept under 900 Hz and above 90 Hz, fast attack
  whoosh: ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:seed=11:duration=0.42:amplitude=0.9',
    '-af', 'highpass=f=90,lowpass=f=900,afade=t=in:d=0.16:curve=qsin,afade=t=out:st=0.16:d=0.26:curve=exp'],
  // a stat landing: a falling sub tone with a soft attack, felt more than heard
  thud: ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(48+70*exp(-t*18))*t)*exp(-t*8)':s=44100:d=0.5",
    '-af', 'lowpass=f=400'],
  // a node changing state: a short rounded blip
  pop: ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*(420+520*exp(-t*45))*t)*exp(-t*28)':s=44100:d=0.18",
    '-af', 'lowpass=f=1400'],
  // something breaking: two low detuned tones, brief
  buzz: ['-f', 'lavfi', '-i', "aevalsrc='0.35*(sin(2*PI*98*t)+sin(2*PI*104*t))*exp(-t*7)':s=44100:d=0.32",
    '-af', 'lowpass=f=600,afade=t=in:d=0.02'],
};
const GAIN = { whoosh: 0.22, thud: 0.55, pop: 0.14, buzz: 0.2 };

export function ensureBank() {
  fs.mkdirSync(BANK, { recursive: true });
  for (const [name, args] of Object.entries(RECIPES)) {
    const f = path.join(BANK, `${name}.wav`);
    if (fs.existsSync(f)) continue;
    execFileSync(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-y', ...args, '-ar', String(RATE), '-ac', '1', f]);
  }
  return BANK;
}

function pcm(file) {
  const raw = execFileSync(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-'], { maxBuffer: 1 << 26 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** Write a mono 44.1 kHz WAV containing every cue at its time. */
export function buildTrack(cues, seconds, outFile) {
  ensureBank();
  const samples = {};
  const buf = new Float32Array(Math.ceil(seconds * RATE));
  for (const c of cues) {
    const s = samples[c.kind] || (samples[c.kind] = pcm(path.join(BANK, `${c.kind}.wav`)));
    const at = Math.round(Math.max(0, c.t) * RATE);
    const g = (GAIN[c.kind] || 0.2) * (c.gain || 1);
    for (let i = 0; i < s.length && at + i < buf.length; i++) buf[at + i] += s[i] * g;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(-0.98, Math.min(0.98, buf[i]));
  // 16-bit PCM WAV, written by hand: header + samples
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(buf[i] * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(outFile, Buffer.concat([h, data]));
  return outFile;
}

/*
 * Cues from the scene track, mirroring the renderer's own timings:
 * a whoosh on every cut that is a real cut (not a component carried over),
 * a quiet pop when a node changes state or a message arrives; nothing on
 * stats, which land silently (a thud there read as cheap).
 */
export function cuesFor(board, starts, titleUntil, total) {
  const key = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const keys = (s) => {
    const d = s.data || {};
    if (s.type === 'flow') return d.nodes.map((n) => key(n.label));
    if (s.type === 'card') return [key(d.title)];
    if (s.type === 'compare') return [key(d.left.label), key(d.right.label)];
    return [];
  };
  const cues = [];
  if (titleUntil > 0.4) cues.push({ kind: 'whoosh', t: titleUntil - 0.2 });
  board.scenes.forEach((sc, i) => {
    const start = starts[i];
    const span = Math.max(0.6, (starts[i + 1] ?? total) - start);
    const mine = keys(sc);
    const recent = [board.scenes[i - 1], board.scenes[i - 2], board.scenes[i - 3]].filter(Boolean).flatMap(keys);
    const carried = mine.length && mine.some((k) => recent.includes(k));
    if (i > 0 && !carried) cues.push({ kind: 'whoosh', t: start - 0.12, gain: 0.8 });
    // no thud on stats: with the visual blast gone it was the audio version of the same thing

    // the new scene types, on the same timings as the renderer's animateNew()
    if (sc.type === 'sequence') {
      const every = (span * 0.72) / Math.max(1, sc.data.steps.length);
      sc.data.steps.forEach((st, k) => cues.push({ kind: 'pop', t: start + 0.8 + k * every, gain: 0.45 }));
    }
    if (sc.type === 'cells' && sc.data.after) cues.push({ kind: 'pop', t: start + span * 0.5 });
    if (sc.type === 'tree' && sc.data.path && sc.data.path.length) {
      const every = (span * 0.6) / sc.data.path.length;
      sc.data.path.forEach((_, k) => cues.push({ kind: 'pop', t: start + 0.9 + k * every, gain: 0.5 }));
    }
    if (sc.type === 'flow') {
      for (const n of sc.data.nodes) {
        if (!n.becomes) continue;
        cues.push({ kind: 'pop', t: start + span * 0.5 });
        break; // one cue per flip moment, however many nodes flip together
      }
    }
  });
  return cues.filter((c) => c.t >= 0 && c.t < total);
}
