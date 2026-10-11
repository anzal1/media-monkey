/*
 * refine.mjs: one visual critique round. The validator only proves a machine
 * runs; it cannot see that a part reads as nothing. Gemini can see. This hands
 * the model its own motion strip next to the odometer's, asks it to name the
 * worst visual faults and fix them, then runs the same validate and repair
 * loop. Output goes to out/<model>/<concept>.v2 and <kind>.v2.jpg.
 *
 *   node factory/machines-gen/refine.mjs --concept "LRU cache eviction" --model gemini-3.8-flash
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userPrompt } from './prompt.mjs';
import { generate, slug } from './gen.mjs';
import { strip } from './strip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export async function refine({ concept, model }) {
  const dir = path.join(HERE, 'out', model, slug(concept));
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const answers = fs.readdirSync(dir).filter((f) => /^answer\.\d+\.md$/.test(f)).sort();
  const answer = fs.readFileSync(path.join(dir, answers.at(-1)), 'utf8');
  const mine = await strip(dir);
  const odo = path.join(REPO, 'insights', 'visuals', 'gen', 'baseline', 'odometer.motion.jpg');
  const img = (f) => ({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  const contents = [
    { role: 'user', parts: [{ text: userPrompt(concept) }] },
    { role: 'model', parts: [{ text: answer }] },
    { role: 'user', parts: [
      { text: 'Image 1 is YOUR machine rendered in the real reel page: one row per fixture scene, five moments per row (t = 0.5, 1.3, 2.1, 2.9 and 4.3 s). Image 2 is the odometer, the quality bar, rendered the same way.' },
      img(mine), img(odo),
      { text: `Look at image 1 the way the owner will, on a phone, next to image 2. First list the five worst visual problems you can actually see: parts that read as nothing or as floating slabs, a plate that is mostly empty, the subject too small to read, see-through solids or wrong painter's order, lines that stop in mid-air, scenes that look the same, motion that does not show the concept, a readout that disagrees with the picture. Then fix every one of them in the code and the fixture. Keep the object if it is a good mapping, change it if it is not. Return the full answer again in exactly the same format: MAPPING, PARTS, KIND, the complete javascript block and the complete json block.` },
    ] },
  ];
  return generate({ concept, model, contents, tag: '.v2' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await refine({ concept: arg('--concept'), model: arg('--model', 'gemini-3.8-flash') });
  const { rounds, ...brief } = r;
  console.log(JSON.stringify(brief, null, 2));
}
