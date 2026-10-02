/*
 * voice-eval.mjs — choose the voice by measurement, not by ear alone.
 *
 * Voice selection by measurement. Each candidate reads the same three passages
// from real scripts; Whisper (a different model family from the TTS) transcribes
// them clean and with street noise mixed in at +5 dB SNR; we score word error
// rate and the real speaking rate.
 *
 *   node factory/voice-eval.mjs <dtype> <outdir> [voices] [speeds]
 * Heavy (Whisper small on CPU): run it from the voice-eval workflow, not on a laptop.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = path.join(ROOT, 'node_modules') + '/';
const { env, pipeline } = await import('@huggingface/transformers');
env.cacheDir = path.join(os.homedir(), '.cache', 'voila', 'models');
const { KokoroTTS } = await import('kokoro-js');
const { blendStyle } = await import('./tts.mjs');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const DTYPE = process.argv[2] || 'q8';
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const PASSAGES = [
  'Kubernetes gives you two main probes. Liveness restarts a wedged container, while readiness decides if the container gets customer traffic from the service. You usually point readiness at an HTTP route that checks downstream databases.',
  'Under heavy traffic, your application event loop gets saturated with real user work. The HTTP probe request from the local kubelet arrives, sits in the socket queue, and waits for a free worker thread that never comes.',
  'Every time you jump half an array away, you waste the sixty four byte cache line your memory controller pulled. You also blind the branch predictor, and every miss forces the CPU to flush its pipeline.',
];
const VOICES = (process.argv[4] || 'af_heart,af_bella,af_nicole,bf_emma,am_michael,am_fenrir,am_puck,bm_george,bm_fable,bm_lewis,blend').split(',');
const SPEEDS = (process.argv[5] || '1.0,1.1,1.2,1.32').split(',').map(Number);

// the current house voice is a blend, installed into a spare slot exactly as tts.mjs does
const VOICES_DIR = M + 'kokoro-js/voices';
const blend = blendStyle([{ voice: 'bm_lewis', weight: 0.5 }, { voice: 'bm_george', weight: 0.5 }]);
fs.writeFileSync(path.join(VOICES_DIR, 'am_santa.bin'), Buffer.from(blend.buffer, blend.byteOffset, blend.byteLength));

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: DTYPE });
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small.en', { dtype: 'fp32' });

// one fixed noise bed, so every voice is judged against the same noise
const NOISE = path.join(OUT, 'noise.wav');
if (!fs.existsSync(NOISE)) execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'anoisesrc=color=pink:seed=7:duration=30:amplitude=1,highpass=f=120,lowpass=f=5000', '-ar', '16000', '-ac', '1', NOISE]);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\b(\d+)\b/g, (m) => m).split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}
function read16k(file, noisy) {
  const args = noisy
    ? ['-i', file, '-i', NOISE, '-filter_complex', '[0]aresample=16000,aformat=channel_layouts=mono,loudnorm=I=-20[s];[1]volume=1[n];[n]loudnorm=I=-25[nn];[s][nn]amix=inputs=2:duration=first:normalize=0']
    : ['-i', file, '-af', 'aresample=16000,aformat=channel_layouts=mono'];
  const raw = execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', ...args, '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], { maxBuffer: 64 << 20 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const rows = [];
for (const v of VOICES) for (const sp of SPEEDS) {
  const voice = v === 'blend' ? 'am_santa' : v;
  let words = 0, secs = 0, wClean = 0, wNoisy = 0;
  for (let k = 0; k < PASSAGES.length; k++) {
    const audio = await tts.generate(PASSAGES[k], { voice, speed: sp });
    const f = path.join(OUT, `${v}_${sp}_${DTYPE}_${k}.wav`);
    await audio.save(f);
    secs += audio.audio.length / audio.sampling_rate;
    words += PASSAGES[k].split(/\s+/).length;
    wClean += wer(PASSAGES[k], (await asr(read16k(f, false))).text);
    wNoisy += wer(PASSAGES[k], (await asr(read16k(f, true))).text);
  }
  const row = { voice: v, speed: sp, dtype: DTYPE, wpm: Math.round(words / secs * 60),
    werClean: +(100 * wClean / PASSAGES.length).toFixed(1), werNoisy: +(100 * wNoisy / PASSAGES.length).toFixed(1) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(OUT, `results_${DTYPE}.json`), JSON.stringify(rows, null, 1));
