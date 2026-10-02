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
// out/ is gitignored, so on CI this file used to start empty on every run and
// every repetition guard below silently did nothing (20 of 20 runs logged
// "recent: none"). CI now restores it from the reels branch before rendering
// and writes it back after publishing; MEDIAMONKEY_HISTORY points at it.
const HISTORY_FILE = process.env.MEDIAMONKEY_HISTORY || path.join(ROOT, 'out', 'history.json');

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
        `subjects, and do not make it about AI unless the category IS ai.\n` +
        `Search the web for genuinely interesting recent findings or discussions in that subject.\n\n`
      : `Search the web for what is actually being discussed right now in this lane.\n\n`) +
    (opts.recent && opts.recent.length
      ? `ALREADY PUBLISHED on this channel. Do not propose the same mechanism again, and do ` +
        `not reuse the same opening scenario (a 3am pager, a CPU dashboard that looks wrong, ` +
        `healthy-looking microservices) even for a different mechanism:\n` +
        opts.recent.map((r) => `- ${r}`).join('\n') + '\n\n'
      : '') +
    `Then propose ${count} short-form video topics with real viral potential for a ` +
    `two minute explainer reel. Rules:\n` +
    '- Each topic must rest on a real, checkable mechanism. No speculation, no vibes.\n' +
    '- DEPTH TEST: a working engineer must finish the reel knowing something they can USE ' +
    'or explain in a design review: a failure mode, a tradeoff, a number that changes a decision. ' +
    'Never a definition, never a listicle, never "what is X".\n' +
    '- HOOK TEST: it must still stop a scroll. The best hooks here are a counterintuitive ' +
    'second-order effect ("adding a replica made writes slower"), a hidden cost, or a thing ' +
    'everyone does that is quietly wrong.\n' +
    '- Assume the viewer is a mid-level engineer. Skip anything on the first page of the docs. ' +
    'No product launch recaps, no news roundups, no beginner explainers.\n' +
    '- Prefer mechanisms that decompose into 4 components, because the reel draws one per beat.\n' +
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
      add(await liveTopics(opts.liveCount || CONFIG.topics.liveCount, { log, category, recent: opts.recent }));
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

  const tagged = ordered.slice(0, n).map((t) => ({ ...t, track: 'production', category: t.category || (category && category.key) || null }));
  return { topics: tagged, notes, category: category && category.key };
}

/* ------------------------------------------------------------------------ *
 * Tracks. Every run belongs to one of three:
 *   root        "From the root": CS fundamentals in order, textbook vs machine
 *   ai          AI system design, built up from tokens to full designs
 *   production  the original failure-mode reels, by category
 * The track furthest below its target share (topics.json "tracks") goes next,
 * so the mix holds exactly instead of drifting the way random draws do.
 * ------------------------------------------------------------------------ */

export function pickTrack(opts = {}) {
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const want = j.tracks || { production: 1 };
  // backfilled entries predate tracks; counting them would make the next
  // twenty runs all series to "catch up" on a mix that did not exist yet
  const hist = readHistory().filter((h) => !h.backfill).slice(-40);
  const n = hist.length || 1;
  const counts = Object.fromEntries(Object.keys(want).map((k) => [k, 0]));
  for (const h of hist) counts[h.track || 'production'] = (counts[h.track || 'production'] || 0) + 1;
  let best = null, bestDeficit = -Infinity;
  for (const [k, share] of Object.entries(want)) {
    if (k !== 'production' && !nextEpisode(k)) continue;   // series finished
    const deficit = share - counts[k] / n;
    if (deficit > bestDeficit) { best = k; bestDeficit = deficit; }
  }
  if (opts.log) opts.log(`  track: ${best} (last ${hist.length}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  return best || 'production';
}

/** The next unpublished episode of a series, in curriculum order. */
export function nextEpisode(seriesKey) {
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const series = j.series && j.series[seriesKey];
  if (!series) return null;
  const done = new Set(readHistory().map((h) => h.episodeId).filter(Boolean));
  // concepts the account covered before the series existed: skipped, but they
  // do not count toward the episode number shown on screen
  const pre = new Set(readHistory().map((h) => h.coversEpisode).filter(Boolean));
  // a concept already covered as a production reel counts as done, so the
  // series never re-runs what the account has already posted
  const covered = readHistory().map((h) => normalizeTopic(`${h.topic || ''} ${h.hook || ''}`));
  const idx = series.curriculum.findIndex((ep) => {
    if (done.has(ep.id) || pre.has(ep.id)) return false;
    const c = normalizeTopic(ep.concept);
    return !covered.some((t) => t.includes(c) && c.length > 6);
  });
  if (idx < 0) return null;
  const ep = series.curriculum[idx];
  const prev = series.curriculum.slice(0, idx).reverse().find((e) => done.has(e.id));
  return {
    ...ep,
    // episodes are numbered by what has actually been published, so a skipped
    // or already-covered concept never leaves a gap in the count
    number: [...done].filter((id) => id.startsWith(`${seriesKey}-`)).length + 1,
    seriesKey, seriesTitle: series.title, seriesPitch: series.pitch,
    previous: prev ? prev.concept : null,
  };
}

/**
 * Production categories ranked by how their reels actually performed. Scores
 * are median views of the category's published reels, read live from the
 * Instagram API when a token is present. 70% of picks follow the scores,
 * softened so one hit cannot monopolise the account; 30% explore, preferring
 * categories with no data yet. Categories used in the last eight production
 * runs are skipped either way.
 */
export async function pickProductionCategory(opts = {}) {
  const log = opts.log || (() => {});
  const j = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const cats = j.categories || [];
  const hist = readHistory();
  const recentCats = hist.filter((h) => (h.track || 'production') === 'production').slice(-8).map((h) => h.category);
  const eligible = cats.filter((c) => !recentCats.includes(c.key));
  const pool = eligible.length ? eligible : cats;

  const views = await mediaViews(hist.filter((h) => h.igMediaId).slice(-60).map((h) => h.igMediaId), opts);
  const byCat = {};
  for (const h of hist) {
    const v = h.igMediaId && views[h.igMediaId];
    if (v == null || !h.category) continue;
    (byCat[h.category] = byCat[h.category] || []).push(v);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const scored = pool.map((c) => ({ c, score: byCat[c.key] ? med(byCat[c.key]) : null, n: (byCat[c.key] || []).length }));
  const known = scored.filter((x) => x.score != null);
  const explore = Math.random() < 0.3 || !known.length;
  let pick;
  if (explore) {
    const fresh = scored.filter((x) => x.score == null);
    const from = fresh.length ? fresh : scored;
    pick = from[Math.floor(Math.random() * from.length)];
  } else {
    // square root softens the curve: a 4x better category is picked 2x as often
    const w = known.map((x) => Math.sqrt(Math.max(1, x.score)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    pick = known.find((x, i) => (r -= w[i]) <= 0) || known[0];
  }
  log(`  category: ${pick.c.key} (${explore ? 'explore' : `exploit, median ${pick.score} views over ${pick.n}`}; ` +
      `skipping recent: ${recentCats.filter(Boolean).join(', ') || 'none'})`);
  return pick.c;
}

/** Views per media id from the Instagram API, best effort. */
async function mediaViews(ids, opts = {}) {
  const token = process.env.IG_ACCESS_TOKEN;
  const out = {};
  if (!token || !ids.length) return out;
  await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(`https://graph.instagram.com/v21.0/${id}/insights?metric=views&access_token=${token}`,
        { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const v = j.data && j.data[0] && j.data[0].values && j.data[0].values[0] && j.data[0].values[0].value;
      if (typeof v === 'number') out[id] = v;
    } catch { /* missing data just means this reel does not vote */ }
  }));
  return out;
}

/** The hooks the account has actually published, newest first. */
export function recentHooks(n = 40) {
  return readHistory().slice(-n).reverse().map((h) => h.hook || h.topic).filter(Boolean);
}

/**
 * What make.mjs calls in --auto mode. Returns one topic entry carrying its
 * track, and for series episodes the series context the script needs.
 */
/** tight vs deep, alternated by whichever has run less lately: a clean A/B. */
export function pickLength() {
  const recent = readHistory().filter((h) => !h.backfill && h.length).slice(-20);
  const tight = recent.filter((h) => h.length === 'tight').length;
  return tight * 2 < recent.length ? 'tight' : 'deep';
}

export async function nextTopic(opts = {}) {
  const log = opts.log || (() => {});
  const track = opts.track || pickTrack({ log });
  const length = opts.length || pickLength();
  log(`  length: ${length}`);
  const withLen = (e) => ({ ...e, length });
  return withLen(await nextTopicFor(track, opts, log));
}

async function nextTopicFor(track, opts, log) {
  if (track === 'root' || track === 'ai') {
    const ep = nextEpisode(track);
    log(`  episode: ${ep.seriesTitle} #${ep.number}, ${ep.module}: ${ep.concept}`);
    return {
      topic: ep.concept, source: 'series', track, category: track === 'ai' ? 'ai-systems' : 'fundamentals',
      episodeId: ep.id, series: ep,
    };
  }
  const category = await pickProductionCategory({ log });
  const { topics, notes } = await supplyTopics(1, { log, category, recent: recentHooks(40) });
  notes.forEach((nt) => log(`topics: ${nt}`));
  return { ...topics[0], track: 'production', category: category.key };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] || 5);
  const { topics, notes } = await supplyTopics(n, { log: console.log });
  for (const note of notes) console.log(`note: ${note}`);
  for (const t of topics) console.log(`- [${t.source}] ${t.topic}${t.why ? `  (${t.why})` : ''}`);
}
