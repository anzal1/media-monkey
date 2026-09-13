// Kokoro TTS, on device, one wav per segment.
//
// Why per segment and not one long wav: the karaoke timing is built from exact
// segment boundaries. Kokoro gives no word timestamps, so segment-accurate
// boundaries plus proportional word timing inside each segment is the best
// sync available without a forced aligner. A missed boundary would drift the
// whole reel; a missed word inside a 3-second beat drifts by ~100ms.
//
// Voice: ONE fixed voice per persona, set in config.json. See sampleVoices()
// below for the comparison harness. Default af_bella.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));

// Reuse the model already on this machine (voila downloaded it) instead of
// pulling another ~90MB copy into node_modules.
const MODEL_DIR = process.env.MEDIAMONKEY_MODEL_DIR
  || path.join(os.homedir(), '.cache', 'voila', 'models');

let ttsPromise = null;
async function getTTS() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      try {
        const { env } = await import('@huggingface/transformers');
        fs.mkdirSync(MODEL_DIR, { recursive: true });
        env.cacheDir = MODEL_DIR;
      } catch { /* fall back to the package default cache */ }
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(CONFIG.kokoro.modelId, {
        dtype: CONFIG.kokoro.dtype,
      });
    })();
  }
  return ttsPromise;
}

/** RMS energy of a Float32 PCM buffer, 0..1. Used by the voice comparison. */
function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

// Kokoro's own tokenizer only phonemizes English. Hindi voices (hf_/hm_) need
// IPA from espeak-ng, which ships as wasm so it also works on a CI runner.
let espeak = null;
async function phonemizeHindi(text) {
  if (!espeak) {
    const mod = await (await import('@echogarden/espeak-ng-emscripten')).default();
    espeak = await new mod.eSpeakNGWorker();
  }
  espeak.set_voice('hi');
  return espeak.synthesize_ipa(text).ipa
    .replace(/_/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** af_/am_/bf_/bm_ are English; hf_/hm_ are Hindi. */
export function isHindiVoice(v) {
  return /^h[fm]_/.test(String(v || ''));
}

async function generate(text, voice, speed) {
  const tts = await getTTS();
  let audio;
  if (isHindiVoice(voice)) {
    const ipa = await phonemizeHindi(text);
    const enc = tts.tokenizer(ipa, { truncation: true });
    audio = await tts.generate_from_ids(enc.input_ids, { voice, speed });
  } else {
    audio = await tts.generate(text, { voice, speed });
  }
  const samples = audio.audio;                   // Float32Array
  const rate = audio.sampling_rate || CONFIG.kokoro.sampleRate;
  return { audio, samples, rate, duration: samples.length / rate };
}

/**
 * Render one wav per spoken segment.
 * @param {Array<{id:string,text:string}>} segments
 * @param {string} outDir
 * @param {object} [opts] { voice, speed, log }
 * @returns {Promise<Array<{id,text,file,duration,words}>>}
 */
export async function synthSegments(segments, outDir, opts = {}) {
  const voice = opts.voice || CONFIG.voice;
  const speed = opts.speed ?? CONFIG.speed;
  const log = opts.log || (() => {});
  fs.mkdirSync(outDir, { recursive: true });

  const out = [];
  for (const seg of segments) {
    const file = path.join(outDir, `${seg.id}.wav`);
    // a segment may override the voice (bilingual hooks use the Hindi voice)
    const segVoice = seg.lang === 'hi' ? (opts.hindiVoice || CONFIG.hindiVoice) : voice;
    let res;
    try {
      res = await generate(seg.text, segVoice, speed);
    } catch (e) {
      if (segVoice === voice) throw e;
      log(`  tts ${seg.id}: ${segVoice} failed (${e.message}), falling back to ${voice}`);
      res = await generate(seg.text, voice, speed);
    }
    await res.audio.save(file);
    const words = seg.text.split(/\s+/).filter(Boolean);
    log(`  tts ${seg.id.padEnd(6)} ${res.duration.toFixed(2)}s  ${words.length}w  [${segVoice}]  "${seg.text.slice(0, 48)}${seg.text.length > 48 ? '…' : ''}"`);
    out.push({ ...seg, file, duration: res.duration, words, voice: segVoice });
  }
  const total = out.reduce((a, s) => a + s.duration, 0);
  log(`  tts total narration ${total.toFixed(2)}s across ${out.length} segments (voice ${voice}, speed ${speed})`);
  return out;
}

/**
 * Voice comparison harness. A model cannot judge "energetic" by ear, so this
 * measures the two things that correlate with it and prints them: words per
 * second (pace) and RMS energy (drive). Run it, listen to the wavs, then set
 * `voice` in config.json. `node factory/tts.mjs --sample` does exactly this.
 */
export async function sampleVoices(outDir, opts = {}) {
  const line = opts.text
    || 'your brain does this too and you can watch it happen right now';
  const speed = opts.speed ?? CONFIG.speed;
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const voice of CONFIG.voiceCandidates) {
    const { audio, samples, duration } = await generate(line, voice, speed);
    const file = path.join(outDir, `sample-${voice}.wav`);
    await audio.save(file);
    const wps = line.split(/\s+/).length / duration;
    rows.push({ voice, duration: +duration.toFixed(2), wordsPerSec: +wps.toFixed(2), rms: +rms(samples).toFixed(4), file });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.join(HERE, '..', 'out', '_voice-samples');
  const rows = await sampleVoices(outDir);
  console.table(rows.map(({ file, ...r }) => r));
  console.log(`wavs in ${outDir}`);
  console.log(`config voice is currently: ${CONFIG.voice}`);
}
