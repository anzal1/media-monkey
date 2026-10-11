/*
 * run-all.mjs: the kill test. Six concepts, each on the factory's fast model
 * and on the strongest Gemini on the key, a few at a time (the Gemini calls
 * run remotely; locally it is only headless stills).
 *
 *   node factory/machines-gen/run-all.mjs [--models a,b] [--concepts "x|y"] [--fresh] [--jobs 4]
 *
 * A finished pair (out/<model>/<concept>/result.json) is reused unless --fresh.
 * Writes insights/visuals/gen/results.json with one row per pair.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const CONCEPTS = (arg('--concepts', '') || [
  'token bucket rate limiter',
  'LRU cache eviction',
  'consistent hashing ring',
  'bloom filter',
  'mutex lock contention',
  'binary search over a sorted array',
].join('|')).split('|');
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const MODELS = arg('--models', `${cfg.model},gemini-3.1-pro-preview`).split(',');
const JOBS = Number(arg('--jobs', 4));
const fresh = process.argv.includes('--fresh');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const queue = MODELS.flatMap((model) => CONCEPTS.map((concept) => ({ model, concept })));
const results = [];
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    const file = path.join(HERE, 'out', job.model, slug(job.concept), 'result.json');
    if (!fresh && fs.existsSync(file)) { results.push(JSON.parse(fs.readFileSync(file, 'utf8'))); console.log(`reuse ${job.model} / ${job.concept}`); continue; }
    console.log(`start ${job.model} / ${job.concept}`);
    try {
      const r = await generate({ ...job });
      results.push(r);
      console.log(`done  ${job.model} / ${job.concept}: ${r.validated ? 'valid' : 'FAILED'} after ${r.repairs} repairs, ${r.genSeconds}s`);
    } catch (e) {
      results.push({ ...job, validated: false, errors: [e.message] });
      console.log(`crash ${job.model} / ${job.concept}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));

const order = (r) => MODELS.indexOf(r.model) * 100 + CONCEPTS.indexOf(r.concept);
results.sort((a, b) => order(a) - order(b));
const out = path.join(REPO, 'insights', 'visuals', 'gen', 'results.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results.map(({ rounds, ...r }) => ({
  ...r, rounds: (rounds || []).map(({ round, genMs, usage, validateMs, errors }) => ({ round, genMs, usage, validateMs, errors })),
})), null, 2) + '\n');
console.log(`wrote ${path.relative(REPO, out)}`);
