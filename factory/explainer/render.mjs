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
  const stepStarts = [0, ...starts.slice(1)].slice(0, diagram.nodes.length);
  while (stepStarts.length < diagram.nodes.length) stepStarts.push(t);

  const total = segments.reduce((a, s) => a + s.duration, 0);
  const seconds = Math.ceil(total + 0.8);

  const spec = { ...diagram, stepStarts, episode: episode || 'THE PROD MONKEY' };
  fs.writeFileSync(SPEC_FILE, 'window.SPEC = ' + JSON.stringify(spec) + ';');
  log(`  explainer: ${diagram.nodes.length} nodes, reveals at ${stepStarts.map((x) => x.toFixed(1)).join('s, ')}s`);

  await recordPage('explainer', {
    out: outFile,
    outDir: path.dirname(outFile),
    seconds,
    fps: 30,
    stepsPerFrame: 1, // the scene is time-driven, so one page step per video frame
    log,
  });
  return { file: outFile, seconds, kind: 'explainer' };
}
