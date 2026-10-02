/*
 * state.mjs — the channel's memory, kept on the reels branch at
 * state/history.json because out/ never survives a CI run.
 *
 * Two jobs write it (render records the topic, publish records the Instagram
 * id hours later), so nobody overwrites the file wholesale. Each writer takes
 * the copy currently on the branch and upserts only its own entry, keyed by
 * slug, which makes a retry after a lost push race safe to repeat.
 *
 *   node factory/state.mjs upsert <branchCopy> <localHistory> <slug> [k=v ...]
 *   node factory/state.mjs set    <branchCopy> <slug> k=v [k=v ...]
 */
import fs from 'node:fs';

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const kv = (pairs) => Object.fromEntries(pairs.filter((p) => p.includes('=')).map((p) => {
  const i = p.indexOf('=');
  const v = p.slice(i + 1);
  return [p.slice(0, i), v === '' ? null : v];
}));

const [cmd, target, ...rest] = process.argv.slice(2);
const state = read(target);

if (cmd === 'upsert') {
  const [local, slug, ...pairs] = rest;
  const mine = read(local).filter((h) => h.slug === slug).pop();
  if (!mine) { console.error(`no entry for ${slug} in ${local}`); process.exit(1); }
  const entry = { ...mine, ...kv(pairs) };
  const i = state.findIndex((h) => h.slug === slug);
  if (i >= 0) state[i] = { ...state[i], ...entry }; else state.push(entry);
} else if (cmd === 'set') {
  const [slug, ...pairs] = rest;
  const i = state.findIndex((h) => h.slug === slug);
  if (i < 0) { console.error(`no entry for ${slug} on the branch`); process.exit(1); }
  state[i] = { ...state[i], ...kv(pairs) };
} else {
  console.error('usage: state.mjs upsert|set ...');
  process.exit(2);
}
fs.writeFileSync(target, JSON.stringify(state, null, 2) + '\n');
console.log(`state: ${cmd} ${cmd === 'upsert' ? rest[1] : rest[0]} (${state.length} entries)`);
