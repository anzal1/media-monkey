// Self-feeding topic supply.
//
// Three sources, merged and de-duplicated against everything already rendered:
//   1. LIVE   Gemini with the google_search tool, asked for what is actually
//             moving today inside the lane. This is the recreation of the old
//             python pipeline's grounded-trends step.
//   2. HN     Hacker News via the Algolia API, front-page stories filtered to
//             brain/AI/internet keywords. Also the fallback when google_search
//             is not enabled for the key.
//   3. LOCAL  factory/topics.json backlog, the evergreen floor so the factory
//             never blocks on a network.
//
// Everything rendered gets appended to out/history.json, and nothing in there
// is ever offered again.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gemini } from './llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const TOPICS_FILE = path.join(HERE, 'topics.json');
const HISTORY_FILE = path.join(ROOT, 'out', 'history.json');

const KEYWORDS = /\b(brain|neuro|neuron|cogniti|memory|percept|vision|conscious|psycholog|sleep|dopamine|attention|ai|llm|model|neural|transformer|agent|algorithm|feed|social|internet|scroll|addict|interface|latency)\b/i;

export function normalizeTopic(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; }
}

export function appendHistory(entry) {
  const hist = readHistory();
  hist.push({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2), 'utf8');
  return hist.length;
}

function historyKeys() {
  const keys = new Set();
  for (const h of readHistory()) {
    if (h.topic) keys.add(normalizeTopic(h.topic));
    if (h.slug) keys.add(String(h.slug).toLowerCase());
  }
  return keys;
}

export function localBacklog() {
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  return (j.backlog || []).map((t) => ({ topic: t, source: 'backlog' }));
}

/** Hacker News front page, filtered to the lane. Keyless, no rate limit pain. */
export async function hnSignals(limit = 12) {
  const url = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`hn ${res.status}`);
  const data = await res.json();
  return (data.hits || [])
    .map((h) => h.title)
    .filter((t) => t && KEYWORDS.test(t))
    .slice(0, limit)
    .map((t) => ({ topic: t, source: 'hn' }));
}

/** First balanced [...] in a string, ignoring brackets inside JSON strings. */
function balancedArray(s) {
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/**
 * Grounded generation cannot use responseMimeType=application/json, so this
 * answer arrives as prose-wrapped JSON written by a model having a good day or
 * a bad one. A greedy /\[[\s\S]*\]/ turns one stray bracket or one unescaped
 * quote into zero topics, which is how a whole batch ended up on the HN
 * fallback. Degrade instead: balanced array, then greedy, then object by
 * object, then just the topic strings.
 * @returns {{list: Array, how: string}}
 */
export function parseTopicList(raw) {
  const text = String(raw).replace(/```(?:json)?/g, '');
  // "Based on sources [1] and [2]" parses as a perfectly valid array of
  // numbers, so a successful JSON.parse is not the test: carrying topics is.
  const usable = (v) => (Array.isArray(v)
    ? v.filter((o) => o && typeof o === 'object' && typeof o.topic === 'string' && o.topic.trim())
    : []);
  for (const [how, cand] of [
    ['balanced', balancedArray(text)],
    ['greedy', /\[[\s\S]*\]/.exec(text)?.[0]],
  ]) {
    if (!cand) continue;
    try {
      const list = usable(JSON.parse(cand));
      if (list.length) return { list, how };
    } catch { /* try the next strategy */ }
  }
  // one malformed entry should not cost us the other seven
  const objs = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try { objs.push(JSON.parse(m[0])); } catch { /* skip just this one */ }
  }
  const fromObjs = usable(objs);
  if (fromObjs.length) return { list: fromObjs, how: 'per-object' };
  const bare = [...text.matchAll(/"topic"\s*:\s*"([^"]{5,160})"/g)].map((m) => ({ topic: m[1] }));
  if (bare.length) return { list: bare, how: 'topic-regex' };
  return { list: [], how: 'none' };
}

/**
 * Least-recently-used category, so the account cannot collapse into one theme.
 * Live news skews hard toward whatever is trending (AI, lately), so the category
 * is chosen FIRST and the search is pointed at it, rather than letting the
 * headlines pick the subject every time.
 */
export function pickCategory(opts = {}) {
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const cats = j.categories || [];
  if (!cats.length) return null;
  let hist = [];
  try {
    hist = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {}
  const recent = hist
    .slice(-cats.length)
    .map((h) => h.category)
    .filter(Boolean);
  const unused = cats.filter((c) => !recent.includes(c.key));
  const from = unused.length ? unused : cats;
  const pick = from[Math.floor(Math.random() * from.length)];
  if (opts.log) opts.log(`  category: ${pick.key} (recent: ${recent.join(', ') || 'none'})`);
  return pick;
}

/**
 * Grounded trend pull. Returns [] and sets `.reason` on the thrown error if the
 * key cannot use the google_search tool, so the caller can fall back quietly.
 */
export async function liveTopics(count = 8, opts = {}) {
  const log = opts.log || (() => {});
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const cat = opts.category || null;
  const prompt =
    `Today is ${today}. Channel lane: ${j.lane}.\n` +
    (cat
      ? `THIS BATCH MUST BE ABOUT: ${cat.key} (${cat.hint}). Do not drift into other ` +
        `subjects, and do not make it about AI unless the category IS machines.\n` +
        `Search the web for genuinely interesting recent findings or discussions in that subject.\n\n`
      : `Search the web for what is actually being discussed right now in this lane.\n\n`) +
    `Then propose ${count} short-form video topics with real viral potential for a ` +
    `30 to 45 second reel. Rules:\n` +
    '- Each topic must rest on a real, checkable fact or a real current story. No speculation.\n' +
    '- No celebrities, no copyrighted characters, no brands as protagonists.\n' +
    '- Phrase each as a lowercase topic line, 5 to 12 words, no hashtags, no quotes.\n' +
    '- Prefer the surprising mechanism over the news headline.\n\n' +
    'Return ONLY a JSON array of objects: [{"topic":"...","why":"one line on why it lands now"}]';

  const raw = await gemini({
    prompt,
    model: opts.model || CONFIG.model,
    temperature: 0.9,
    tools: [{ google_search: {} }],
    timeoutMs: 90000,
  });
  const { list: arr, how } = parseTopicList(raw);
  if (!arr.length) {
    throw new Error(`grounded search returned no parseable topics (${raw.length} chars of prose)`);
  }
  log(`  live topics: ${arr.length} from grounded search (parsed: ${how})`);
  return arr
    .map((o) => ({ topic: String(o.topic || '').trim(), why: o.why || '', source: 'live' }))
    .filter((o) => o.topic);
}

/**
 * The one function make.mjs calls.
 * @returns {Promise<{topics: Array<{topic,source,why?}>, notes: string[]}>}
 */
export async function supplyTopics(n = 1, opts = {}) {
  const log = opts.log || (() => {});
  const notes = [];
  const seen = historyKeys();
  const category = opts.category === null ? null : opts.category || pickCategory({ log });
  const pool = [];
  const add = (list) => {
    for (const item of list) {
      const key = normalizeTopic(item.topic);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pool.push(item);
    }
  };

  if (opts.useGoogleSearch ?? CONFIG.topics.useGoogleSearch) {
    try {
      add(await liveTopics(opts.liveCount || CONFIG.topics.liveCount, { log, category }));
      notes.push('google_search grounding: ok');
    } catch (e) {
      notes.push(`google_search grounding unavailable (${e.message.slice(0, 120)}), fell back to HN`);
      log(`  live topics failed: ${e.message}`);
      try {
        add(await hnSignals());
        notes.push('hn signals: ok');
      } catch (e2) {
        notes.push(`hn signals also failed (${e2.message.slice(0, 80)})`);
      }
    }
  }

  add(localBacklog());
  if (!pool.length) throw new Error('no unused topics left; add to factory/topics.json');

  // live first, then hn, then backlog shuffled: fresh beats evergreen, but the
  // backlog order is randomized so the account does not march down a list.
  const rank = { live: 0, hn: 1, backlog: 2 };
  const backlog = pool.filter((p) => p.source === 'backlog').sort(() => Math.random() - 0.5);
  const fresh = pool.filter((p) => p.source !== 'backlog').sort((a, b) => rank[a.source] - rank[b.source]);
  const ordered = [...fresh, ...backlog];

  const tagged = ordered.slice(0, n).map((t) => ({ ...t, category: t.category || (category && category.key) || null }));
  return { topics: tagged, notes, category: category && category.key };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] || 5);
  const { topics, notes } = await supplyTopics(n, { log: console.log });
  for (const note of notes) console.log(`note: ${note}`);
  for (const t of topics) console.log(`- [${t.source}] ${t.topic}${t.why ? `  (${t.why})` : ''}`);
}
