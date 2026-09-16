/*
 * render.mjs — renders the explainer scene to an mp4 sized and timed to the
 * narration, then hands it back as a background for the normal assemble step.
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
 * @param {object} diagram  from writeDiagram()
 * @param {Array<{id,duration}>} segments  synthesised TTS segments, in order
 * @param {string} outFile  mp4 path to write
 */
export async function renderExplainer({ diagram, segments, outFile, episode, log = () => {} }) {
  // beat i reveals with segment i+1 (segment 0 is the spoken hook)
  const starts = [];
  let t = 0;
  for (const s of segments) {
    if (s.kind === 'beat') starts.push(t);
    t += s.duration;
  }
  // the first node lands on the hook so the frame is never empty
  // -0.6 so the first component is fully drawn on frame 0: Instagram uses an
  // early frame as the grid cover, and a blank diagram makes a dead thumbnail.
  const stepStarts = [-0.6, ...starts.slice(1)].slice(0, diagram.nodes.length);
  while (stepStarts.length < diagram.nodes.length) stepStarts.push(t);

  const total = segments.reduce((a, s) => a + s.duration, 0);
  const seconds = Math.ceil(total + 0.8);

  const spec = { ...diagram, stepStarts, episode: episode || 'THE PROD MONKEY' };
  fs.writeFileSync(SPEC_FILE, 'window.SPEC = ' + JSON.stringify(spec) + ';');
  log(`  explainer: ${diagram.nodes.length} nodes, reveals at ${stepStarts.map((x) => x.toFixed(1)).join('s, ')}s`);

  // The channel is explainer-only now, so this recording IS the reel: there is no
  // background pool to fall back on. A transient Chromium or ffmpeg failure must
  // not cost the whole post, hence the retry.
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
