/*
 * render.mjs — renders the scene track to an mp4 timed to the narration, then
 * hands it back as the "background" for the normal assemble step.
 *
 * The scene is the same frame-stepped HTML route as the procedural backgrounds
 * (factory/record-bg.mjs), so there is no second rendering stack to maintain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPage } from '../record-bg.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC_FILE = path.join(ROOT, 'factory', 'bg', 'explainer-spec.js');

/**
 * A beat owns two to four scenes that hard-cut inside it. The narration for a
 * beat is one TTS segment, so the cuts are placed inside that segment's
 * duration, very slightly front-loaded: the setup scene gets a little less than
 * its even share so the payoff frame is already up when the payoff is spoken.
 */
export function sceneStarts(scenes, segments) {
  const beatAt = new Map();      // beat index -> { start, duration }
  let t = 0;
  let beat = 0;
  let hookEnd = 0;
  for (const s of segments) {
    if (s.kind === 'hook') hookEnd = t + s.duration;
    if (s.kind === 'beat') beatAt.set(beat++, { start: t, duration: s.duration });
    // the closing line gets its own card, keyed one past the last beat
    if (s.kind === 'cta') beatAt.set(beat, { start: t, duration: s.duration });
    t += s.duration;
  }

  const starts = new Array(scenes.length).fill(0);
  scenes.forEach((sc, i) => {
    const b = beatAt.get(sc.beat);
    if (!b) { starts[i] = i ? starts[i - 1] + 4 : hookEnd; return; }
    const of = Math.max(1, sc.of || 2);
    const k = Math.min(sc.half || 0, of - 1);
    // even split, pulled 10% earlier so each frame leads its line slightly
    const frac = of === 1 ? 0 : (k / of) * 0.9;
    starts[i] = b.start + b.duration * frac;
  });
  // monotonic: a model that returned an odd half ordering must not rewind time
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) starts[i] = starts[i - 1] + 0.5;
  }
  return { starts, titleUntil: hookEnd, total: t };
}

/**
 * @param {object} board    from writeScenes()
 * @param {Array<{id,kind,duration}>} segments  synthesised TTS segments, in order
 * @param {string} outFile  mp4 path to write
 */
export async function renderExplainer({ board, segments, outFile, log = () => {} }) {
  const { starts, titleUntil, total } = sceneStarts(board.scenes, segments);
  const seconds = Math.ceil(total + 0.8);

  const spec = { ...board, starts, titleUntil };
  fs.writeFileSync(SPEC_FILE, 'window.SPEC = ' + JSON.stringify(spec) + ';');

  const cuts = starts.map((s, i) => (starts[i + 1] ?? total) - s);
  const avg = cuts.reduce((a, b) => a + b, 0) / Math.max(1, cuts.length);
  log(`  scene track: ${board.scenes.length} scenes over ${seconds}s, ` +
      `title card ${titleUntil.toFixed(1)}s, average cut ${avg.toFixed(1)}s, ` +
      `longest ${Math.max(...cuts).toFixed(1)}s`);

  // The channel is explainer-only, so this recording IS the reel: there is no
  // background pool to fall back on. A transient Chromium or ffmpeg failure
  // must not cost the whole post, hence the retry.
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await recordPage('explainer', {
        out: outFile,
        outDir: path.dirname(outFile),
        seconds,
        fps: 30,
        stepsPerFrame: 1, // scene is time-driven: one page step per video frame
        log,
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      log(`  scene record failed (attempt ${attempt}/2): ${e.message.slice(0, 90)}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (lastErr) throw lastErr;
  return { file: outFile, seconds, kind: 'explainer' };
}
