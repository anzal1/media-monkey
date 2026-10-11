/*
 * gen.mjs: ask Gemini to invent one new machine, then prove it.
 *
 *   node factory/machines-gen/gen.mjs --concept "token bucket rate limiter" --model gemini-3.8-flash
 *
 * One call writes a complete machine module (the odometer.js contract) and a
 * 3 to 4 scene fixture. validate.mjs loads it in a private copy of the scene
 * page and runs every frame. On failure the exact errors go back to the same
 * conversation, up to 3 repair rounds. The last version is screenshotted (6
 * frames) and tiled into insights/visuals/gen/<model>/<kind>.jpg.
 *
 * Everything generated stays in factory/machines-gen/out/<model>/<concept>/.
 * Nothing here is ever loaded by the live renderer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKey } from '../llm.mjs';
import { system, userPrompt, repairPrompt } from './prompt.mjs';
import { validate } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MAX_REPAIRS = 3;

// The worktree has no .env of its own: fall back to the main checkout's,
// read only, the same KEY=value format llm.mjs parses.
function loadKey() {
  if (!process.env.GEMINI_API_KEY) {
    const file = process.env.MM_ENV_FILE || path.resolve(REPO, '..', 'mediamonkey', '.env');
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  return apiKey();
}

/** One generateContent call on a whole conversation; keeps the usage numbers. */
async function call(model, contents, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const body = {
    systemInstruction: { parts: [{ text: system() }] },
    contents,
    generationConfig: { maxOutputTokens: 65536 },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': loadKey() },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  const u = data.usageMetadata || {};
  return {
    text, ms, finish: cand?.finishReason, modelVersion: data.modelVersion,
    usage: { prompt: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thoughts: u.thoughtsTokenCount || 0, total: u.totalTokenCount || 0 },
  };
}

/** Pull MAPPING, PARTS, KIND, the js block and the json block out of an answer. */
export function parse(text) {
  const line = (key) => (new RegExp(`^\\s*\\**${key}\\**\\s*:\\s*(.+)$`, 'mi').exec(text) || [])[1]?.trim() || '';
  const js = /```(?:javascript|js)[^\n]*\n([\s\S]*?)\n```/i.exec(text);
  const jsons = [...text.matchAll(/```json[^\n]*\n([\s\S]*?)\n```/gi)];
  if (!js) throw new Error('answer has no ```javascript block');
  if (!jsons.length) throw new Error('answer has no ```json fixture block');
  const code = js[1];
  let fixture;
  const raw = jsons.at(-1)[1];
  try { fixture = JSON.parse(raw); } catch {
    try { fixture = JSON.parse(raw.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1')); } catch (e) { throw new Error(`fixture json does not parse: ${e.message}`); }
  }
  const reg = /register\(\s*['"`]([a-z0-9-]+)['"`]/i.exec(code);
  const kind = (reg ? reg[1] : line('KIND')).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!kind) throw new Error('could not find the kind: the module must call MM_MACHINES.register(\'<kind>\', ...)');
  if (kind === 'odometer') throw new Error('kind "odometer" is taken: name the new machine after its own object');
  return { mapping: line('MAPPING'), parts: line('PARTS'), kind, code, fixture };
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/**
 * contents: start from this conversation instead of the fresh prompt (refine.mjs
 * uses it to hand back screenshots). tag: suffix for the out folder and tile.
 */
export async function generate({ concept, model, contents: seed = null, tag = '', log = console.log }) {
  const outDir = path.join(HERE, 'out', model, slug(concept) + tag);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const contents = seed || [{ role: 'user', parts: [{ text: userPrompt(concept) }] }];
  const rounds = [];
  const usage = { prompt: 0, output: 0, thoughts: 0, total: 0 };
  let last = null; let modelVersion = null;
  const t0 = Date.now();
  for (let r = 0; r <= MAX_REPAIRS; r++) {
    let answer;
    try { answer = await call(model, contents); } catch (e) {
      rounds.push({ round: r, error: e.message });
      log(`  [${model}] ${concept}: round ${r} call failed: ${e.message}`);
      break;
    }
    modelVersion = answer.modelVersion || modelVersion;
    for (const k of Object.keys(usage)) usage[k] += answer.usage[k];
    fs.writeFileSync(path.join(outDir, `answer.${r}.md`), answer.text);
    const round = { round: r, genMs: answer.ms, finish: answer.finish, usage: answer.usage };
    rounds.push(round);
    let errors;
    let parsed = null;
    try { parsed = parse(answer.text); } catch (e) { errors = [e.message + (answer.finish && answer.finish !== 'STOP' ? ` (finishReason ${answer.finish})` : '')]; }
    if (parsed) {
      const modPath = path.join(outDir, 'module.js');
      fs.writeFileSync(modPath, parsed.code);
      fs.writeFileSync(path.join(outDir, 'fixture.json'), JSON.stringify(parsed.fixture, null, 2) + '\n');
      const v0 = Date.now();
      const v = await validate({ modulePath: modPath, fixture: parsed.fixture, kind: parsed.kind, outDir: path.join(outDir, 'page'), shots: false });
      round.validateMs = Date.now() - v0;
      errors = v.errors;
      last = { ...parsed, v };
      round.kind = parsed.kind;
    }
    round.errors = errors;
    log(`  [${model}] ${concept}: round ${r} ${(answer.ms / 1000).toFixed(0)}s, ${errors.length ? errors.length + ' problems: ' + errors[0].slice(0, 140) : 'valid'}`);
    if (!errors.length) break;
    if (r === MAX_REPAIRS) break;
    contents.push({ role: 'model', parts: [{ text: answer.text }] });
    contents.push({ role: 'user', parts: [{ text: repairPrompt(errors.slice(0, 15)) }] });
  }
  const genMs = rounds.reduce((s, x) => s + (x.genMs || 0), 0);
  const result = {
    concept, model, tag, modelVersion, kind: last?.kind || null,
    mapping: last?.mapping || '', parts: last?.parts || '',
    validated: !!(last && last.v.ok),
    repairs: Math.max(0, rounds.filter((x) => x.genMs).length - 1),
    firstCallSeconds: rounds[0]?.genMs ? +(rounds[0].genMs / 1000).toFixed(1) : null,
    genSeconds: +(genMs / 1000).toFixed(1),
    wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
    usage, rounds,
    errors: last ? last.v.errors : rounds.at(-1)?.errors || [],
  };
  // final pass with shots, on whatever the last version is, so a failure can be seen too
  if (last) {
    const tilePath = path.join(REPO, 'insights', 'visuals', 'gen', model, `${last.kind}${tag}.jpg`);
    try {
      const v = await validate({ modulePath: path.join(outDir, 'module.js'), fixture: last.fixture, kind: last.kind, outDir: path.join(outDir, 'page'), shots: true, tilePath });
      result.msPerFrame = v.msPerFrame || null;
      result.pageMs = v.pageMs || null;
      result.mountMs = v.mountMs || null;
      result.solids = v.solids || null;
      result.paths = v.paths || null;
      result.tile = v.tile ? path.relative(REPO, v.tile) : null;
    } catch (e) { result.tileError = e.message; }
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const concept = arg('--concept');
  if (!concept) { console.error('usage: gen.mjs --concept "<concept>" [--model gemini-3.8-flash]'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
  const r = await generate({ concept, model: arg('--model', cfg.model) });
  const { rounds, ...brief } = r;
  console.log(JSON.stringify(brief, null, 2));
  process.exit(r.validated ? 0 : 1);
}
