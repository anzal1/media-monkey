/*
 * scenes.mjs — turns a script into an ordered list of SCENES.
 *
 * This replaces the old single-board diagram. A reel is now ~24 hard-cut
 * scenes of about five seconds each rather than one diagram with a camera
 * gliding over it. That is the structure the reference account uses and it is
 * the reason their reels hold a viewer for two minutes: something on screen
 * changes completely every few seconds, and every change carries a new claim.
 *
 * Two rules keep the output clean no matter how the model phrases things:
 *   1. The model NEVER returns pixel coordinates. It picks a scene TYPE from a
 *      closed menu and fills that type's data. The renderer owns all geometry.
 *   2. Nothing here throws on a bad scene. A beat whose scenes fail validation
 *      degrades to a plain statement scene built from its own text, because a
 *      slightly duller scene is always better than a lost reel.
 */
import { gemini } from '../llm.mjs';

/** The closed menu. Adding a type here means adding a renderer in explainer.html. */
export const SCENE_TYPES = ['flow', 'compare', 'window', 'card', 'list', 'stat', 'chart', 'diff', 'note', 'sequence', 'cells', 'tree', 'stack', 'code'];

/*
 * Icon keys the renderer can draw, baked into assets/icons/icons.json by
 * factory/explainer/build-icons.mjs. Brand marks come from simple-icons (CC0)
 * and draw in their official colour; concepts come from lucide (ISC) and draw
 * as stroked outlines in the reel's accent. Anything else falls back to a box.
 *
 * Prefer the brand key when the component really is that product: "postgres"
 * beats "database" every time, because a real mark is what makes a diagram
 * read as a system rather than as a shapes-and-arrows slide.
 */
const BRAND_KINDS = ["chrome", "clickhouse", "cloudflare", "datadog", "docker", "elasticsearch", "firefox", "gcp", "git", "github", "gitlab", "go", "grafana", "graphql", "java", "javascript", "kafka", "kubernetes", "linux", "mongodb", "mysql", "nextjs", "nginx", "nodejs", "postgres", "prometheus", "python", "rabbitmq", "react", "redis", "rust", "sqlite", "terraform", "typescript", "vercel"];
const CONCEPT_KINDS = ["alert", "api", "box", "browser", "cache", "chip", "clock", "cloud", "container", "database", "disk", "file", "flame", "gauge", "globe", "key", "layers", "link", "lock", "log", "memory", "merge", "mobile", "money", "network", "package", "queue", "refresh", "request", "scale", "search", "server", "shield", "split", "terminal", "thread", "timer", "trash", "user"];
const KINDS = [...BRAND_KINDS, ...CONCEPT_KINDS];

/**
 * One accent hue per reel, keyed off the topic category, so a viewer scrolling
 * the grid sees a coherent palette instead of seven different oranges.
 */
const ACCENTS = {
  databases: '#2563eb', networking: '#0d9488', security: '#b91c1c',
  performance: '#c2410c', infra: '#4f46e5', concurrency: '#7c3aed',
  compilers: '#b45309', cost: '#15803d', storage: '#2563eb',
  'git-tooling': '#c2410c', os: '#4338ca', ai: '#7c3aed',
};
const DEFAULT_ACCENT = '#c2410c';

export function accentFor(category) {
  return ACCENTS[String(category || '').toLowerCase()] || DEFAULT_ACCENT;
}

const MENU = `SCENE TYPES. Pick the one that actually fits what the beat says.
Never pick "note" twice in a row, and never use it when a real artifact exists.

"flow"    two to four components wired in order. The default for "A calls B".
          data: { "nodes": [ { "label": "2 words", "sub": "max 3 words", "kind": "<kind>",
                               "state": "ok|busy|blocked|dead",
                               "becomes": "ok|busy|blocked|dead or omit" } ],
                  "edge": "max 3 words, the action on the wire",
                  "traffic": "flowing|slow|blocked|none" }
          "state" is how a node looks when the scene opens. "becomes" makes it change
          halfway through the scene, while the narration says it: use it whenever the
          beat is ABOUT something breaking, filling up, or recovering. "traffic" is what
          the requests on the wire are doing: "blocked" stops them mid-wire.
"compare" two things side by side. Use for "X versus Y" and for before/after.
          data: { "left": { "label": "", "sub": "", "kind": "<kind>" },
                  "right": { "label": "", "sub": "", "kind": "<kind>" },
                  "rows": [ { "left": "max 4 words", "right": "max 4 words" } ] }
"window"  a real application window: an editor, a terminal, a console.
          data: { "app": "Visual Studio Code" | "Terminal" | "psql" | ...,
                  "file": "the title bar text, e.g. auth.ts or ~/app",
                  "lines": [ { "text": "ONE line, max 36 characters, it is clipped past that", "tone": "plain|good|bad|dim" } ],
                  "status": { "left": "max 3 words", "right": "max 3 words" } }
"card"    one artifact on its own: a file, a bucket, a table, a config.
          data: { "kind": "<kind>", "title": "the name, mono, e.g. wal/000012",
                  "pill": "max 2 words", "sub": "max 6 words" }
"list"    what something gives you, or what it costs. Three to five rows.
          data: { "title": "max 4 words", "items": [ { "label": "max 5 words", "tone": "good|bad|plain" } ] }
"stat"    ONE number or one phrase, printed huge. Use for the moment that lands.
          data: { "value": "40ms" | "$0" | "ONE LOCK", "label": "MAX 5 WORDS, UPPERCASE",
                  "tone": "good|bad|plain",
                  "from": "optional starting number, e.g. 40ms; the value counts up or down from it" }
"chart"   a measurement moving, drawn while it is spoken. Use when the beat says a
          number climbs, spikes, drops or saturates, or compares two to four values.
          data: { "kind": "line", "shape": "rise|spike|fall|cliff|sawtooth|plateau",
                  "from": "40ms", "to": "3,000ms", "label": "P99 LATENCY, UPPERCASE" }
             or { "kind": "bar", "bars": [ { "label": "max 3 words", "value": 10 } ], "unit": "ms" }
             or { "kind": "meter", "value": 10, "max": 10, "label": "POOL SLOTS IN USE", "tone": "good|bad|plain" }
          HONESTY: a line chart shows the SHAPE the narration describes. It never plots
          invented data points. Only "from" and "to" are printed, both must be numbers the
          narration actually says, and either may be left empty. Bars and meters use real
          numbers from the narration only.
"diff"    lines changing: a patch, a conflict, a log before and after.
          data: { "title": "max 5 words", "rows": [ { "text": "one line, max 36 characters", "tone": "add|del|plain" } ] }
"sequence" messages between two or three actors over time, drawn one at a time. Use for
          handshakes, request/response, two threads racing, retries, a message that is lost.
          data: { "actors": ["Client", "Server"],
                  "steps": [ { "from": 0, "to": 1, "label": "max 4 words", "tone": "plain|good|bad" } ] }
          2 to 6 steps. "bad" draws a failed or lost message.
"cells"   a row of boxes: bits, bytes, array slots, memory addresses, a queue. Use whenever the
          beat is about what is physically stored where: two's complement bits, an array being
          searched, a cache line, a ring buffer.
          data: { "label": "max 5 words", "cells": ["0","1","1","0"],
                  "after": ["1","0","0","1"] or omit (cells change to these values mid-scene),
                  "pointer": [3, 1, 2] or omit (indices the pointer visits, in order),
                  "group": { "from": 0, "to": 7, "label": "one 64-byte cache line" } or omit,
                  "index": true|false (show indices under the cells) }
          2 to 16 cells, each at most 4 characters.
"tree"    a tree being searched or built: BST, B-tree, heap, trie, a call tree.
          data: { "nodes": ["8","4","12","2","6","10","14"], "path": [0, 2, 5] or omit,
                  "label": "max 5 words" }
          nodes in level order (root, then its children left to right, and so on), up to 15,
          "" for a missing node. "path" lights up those node indices in order.
"stack"   layers with a measured size, on a log scale so huge differences are felt: the memory
          hierarchy, network layers with latencies, storage tiers with prices.
          data: { "title": "max 5 words", "layers": [ { "label": "L1 cache", "value": "1 ns", "n": 1 } ] }
          2 to 6 layers, "n" is the plain number behind "value" in a common unit.
"code"    real source code with syntax colour, a spotlight on the lines that matter and the
          buggy line flagged. Prefer this over "window" whenever the content is code.
          data: { "lang": "c|python|js|go|rust|java|sql|bash", "file": "main.c",
                  "lines": ["one line of code, max 38 characters"], "focus": [2, 3], "bad": 3 or omit }
          3 to 9 lines; focus and bad are 1-based line numbers.
"note"    a plain statement pair when there is genuinely nothing to draw.
          data: { "lead": "max 6 words", "body": "max 14 words" }`;

const KIND_LINE =
  `Valid "kind" values. Use a BRAND whenever the component really is that ` +
  `product, because the real logo is what makes the frame land:\n` +
  `${BRAND_KINDS.join(', ')}\n` +
  `Otherwise use a concept:\n${CONCEPT_KINDS.join(', ')}`;

function clip(s, words) {
  const w = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return w.slice(0, words).join(' ');
}
const clean = (s) => String(s == null ? '' : s).replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
const kindOf = (k) => (KINDS.includes(String(k || '').toLowerCase()) ? String(k).toLowerCase() : 'box');
const toneOf = (t, allowed, dflt) => (allowed.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : dflt);

/** Models add fences, comments and trailing commas; none of that is worth a retry. */
function parseJson(raw) {
  let t = String(raw).replace(/```(?:json)?/gi, '').trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in output');
  const open = t[start], close = open === '[' ? ']' : '}';
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { end = i + 1; break; }
  }
  t = t.slice(start, end > 0 ? end : undefined);
  const tries = [t, t.replace(/\/\/[^\n]*/g, ''), t.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1')];
  for (const c of tries) { try { return JSON.parse(c); } catch { /* next repair */ } }
  throw new Error('unparseable after repairs');
}

/**
 * Coerce one model scene into something the renderer can definitely draw.
 * Returns null when the payload is too empty to be worth a scene.
 */
export function normaliseScene(raw, fallbackHeadline) {
  if (!raw || typeof raw !== 'object') return null;
  const type = SCENE_TYPES.includes(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase() : null;
  if (!type) return null;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const head = clip(clean(raw.headline) || fallbackHeadline, 6);
  // Hard-clipping to 6 words lopped the last word off real phrases
  // ("...scanning uncollected row" from "row versions"). Let it run a
  // little longer and let the CSS ellipsis do the trimming, which at least
  // signals that something was cut.
  const sub = clip(clean(raw.subhead), 9);
  let data = null;

  if (type === 'flow') {
    const STATES = ['ok', 'busy', 'blocked', 'dead'];
    const nodes = (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 4)
      .map((n) => ({
        label: clip(n && n.label, 3), sub: clip(n && n.sub, 4), kind: kindOf(n && n.kind),
        state: toneOf(n && n.state, STATES, 'ok'),
        becomes: toneOf(n && n.becomes, STATES, ''),
      }))
      .filter((n) => n.label);
    // a "becomes" that changes nothing is noise
    nodes.forEach((n) => { if (n.becomes === n.state) n.becomes = ''; });
    const traffic = toneOf(d.traffic, ['flowing', 'slow', 'blocked', 'none'], d.packet === false ? 'none' : 'flowing');
    if (nodes.length >= 2) data = { nodes, edge: clip(d.edge, 3), traffic };
  } else if (type === 'compare') {
    const side = (s) => ({ label: clip(s && s.label, 3), sub: clip(s && s.sub, 4), kind: kindOf(s && s.kind) });
    const left = side(d.left), right = side(d.right);
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 3)
      .map((r) => ({ left: clip(r && r.left, 5), right: clip(r && r.right, 5) }))
      .filter((r) => r.left || r.right);
    if (left.label && right.label) data = { left, right, rows };
  } else if (type === 'window') {
    const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 6)
      .map((l) => (typeof l === 'string'
        ? { text: clean(l).slice(0, 38), tone: 'plain' }
        : { text: clean(l && l.text).slice(0, 38), tone: toneOf(l && l.tone, ['plain', 'good', 'bad', 'dim'], 'plain') }))
      .filter((l) => l.text);
    if (lines.length) {
      data = {
        app: clip(d.app, 4) || 'Terminal',
        file: clean(d.file).slice(0, 40),
        lines,
        status: { left: clip(d.status && d.status.left, 3), right: clip(d.status && d.status.right, 3) },
      };
    }
  } else if (type === 'card') {
    const title = clean(d.title).slice(0, 34);
    if (title) data = { kind: kindOf(d.kind), title, pill: clip(d.pill, 2), sub: clip(d.sub, 7) };
  } else if (type === 'list') {
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 5)
      .map((it) => (typeof it === 'string'
        ? { label: clip(it, 6), tone: 'plain' }
        : { label: clip(it && it.label, 6), tone: toneOf(it && it.tone, ['good', 'bad', 'plain'], 'plain') }))
      .filter((it) => it.label);
    if (items.length >= 2) data = { title: clip(d.title, 5), items };
  } else if (type === 'stat') {
    const value = clean(d.value).slice(0, 14);
    if (value) {
      data = {
        value, label: clip(d.label, 5).toUpperCase(),
        tone: toneOf(d.tone, ['good', 'bad', 'plain'], 'plain'),
        from: clean(d.from).slice(0, 14),
      };
    }
  } else if (type === 'chart') {
    const kind = toneOf(d.kind, ['line', 'bar', 'meter'], '');
    if (kind === 'line') {
      data = {
        kind,
        shape: toneOf(d.shape, ['rise', 'spike', 'fall', 'cliff', 'sawtooth', 'plateau'], 'rise'),
        from: clean(d.from).slice(0, 12), to: clean(d.to).slice(0, 12),
        label: clip(d.label, 5).toUpperCase(),
      };
    } else if (kind === 'bar') {
      const bars = (Array.isArray(d.bars) ? d.bars : []).slice(0, 4)
        .map((b) => ({ label: clip(b && b.label, 3), value: Number(b && b.value) }))
        .filter((b) => b.label && Number.isFinite(b.value) && b.value >= 0);
      if (bars.length >= 2 && bars.some((b) => b.value > 0)) data = { kind, bars, unit: clean(d.unit).slice(0, 8) };
    } else if (kind === 'meter') {
      const value = Number(d.value), max = Number(d.max);
      if (Number.isFinite(value) && Number.isFinite(max) && max > 0 && value >= 0) {
        data = {
          kind, value: Math.min(value, max), max,
          label: clip(d.label, 5).toUpperCase(),
          tone: toneOf(d.tone, ['good', 'bad', 'plain'], 'plain'),
        };
      }
    }
  } else if (type === 'diff') {
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 6)
      .map((r) => (typeof r === 'string'
        ? { text: clean(r).slice(0, 38), tone: 'plain' }
        : { text: clean(r && r.text).slice(0, 38), tone: toneOf(r && r.tone, ['add', 'del', 'plain'], 'plain') }))
      .filter((r) => r.text);
    if (rows.length >= 2) data = { title: clip(d.title, 5), rows };
  } else if (type === 'sequence') {
    const actors = (Array.isArray(d.actors) ? d.actors : []).slice(0, 3).map((a) => clip(a, 2)).filter(Boolean);
    const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 6)
      .map((x) => ({ from: Number(x && x.from), to: Number(x && x.to), label: clip(x && x.label, 4), tone: toneOf(x && x.tone, ['plain', 'good', 'bad'], 'plain') }))
      .filter((x) => Number.isInteger(x.from) && Number.isInteger(x.to) && x.from !== x.to && x.from >= 0 && x.to >= 0 && x.from < actors.length && x.to < actors.length);
    if (actors.length >= 2 && steps.length >= 2) data = { actors, steps };
  } else if (type === 'cells') {
    const cell = (c) => clean(c).slice(0, 4);
    const cells = (Array.isArray(d.cells) ? d.cells : []).slice(0, 16).map(cell);
    if (cells.length >= 2) {
      const after = Array.isArray(d.after) && d.after.length === cells.length ? d.after.map(cell) : null;
      const pointer = (Array.isArray(d.pointer) ? d.pointer : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < cells.length).slice(0, 8);
      const g = d.group && Number.isInteger(+d.group.from) && Number.isInteger(+d.group.to)
        && +d.group.from >= 0 && +d.group.to < cells.length && +d.group.from <= +d.group.to
        ? { from: +d.group.from, to: +d.group.to, label: clip(d.group.label, 6) } : null;
      data = { label: clip(d.label, 6), cells, after, pointer, group: g, index: d.index !== false };
    }
  } else if (type === 'tree') {
    const nodes = (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 15).map((n) => clean(n).slice(0, 5));
    // a node needs its parent: blank out orphans so the drawing never floats
    for (let i = 1; i < nodes.length; i++) if (nodes[i] && !nodes[Math.floor((i - 1) / 2)]) nodes[i] = '';
    const path = (Array.isArray(d.path) ? d.path : []).map(Number).filter((i) => Number.isInteger(i) && nodes[i]).slice(0, 6);
    if (nodes[0] && nodes.filter(Boolean).length >= 3) data = { nodes, path, label: clip(d.label, 6) };
  } else if (type === 'stack') {
    const layers = (Array.isArray(d.layers) ? d.layers : []).slice(0, 6)
      .map((l) => ({ label: clip(l && l.label, 3), value: clean(l && l.value).slice(0, 12), n: Number(l && l.n) }))
      .filter((l) => l.label && Number.isFinite(l.n) && l.n > 0);
    if (layers.length >= 2) data = { title: clip(d.title, 5), layers };
  } else if (type === 'code') {
    const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 9).map((l) => String(l == null ? '' : l).replace(/\t/g, '  ').slice(0, 40));
    if (lines.filter((l) => l.trim()).length >= 2) {
      const ok = (n) => Number.isInteger(n) && n >= 1 && n <= lines.length;
      data = {
        lang: toneOf(d.lang, ['c', 'python', 'js', 'go', 'rust', 'java', 'sql', 'bash'], 'c'),
        file: clean(d.file).slice(0, 30), lines,
        focus: (Array.isArray(d.focus) ? d.focus : []).map(Number).filter(ok).slice(0, 4),
        bad: ok(Number(d.bad)) ? Number(d.bad) : null,
      };
    }
  } else if (type === 'note') {
    const lead = clip(d.lead, 7);
    if (lead) data = { lead, body: clip(d.body, 16) };
  }

  if (!data) return null;
  return { type, headline: head, subhead: sub, data };
}

/** Last-resort scene so a failed beat still gets a frame worth looking at. */
function fallbackScenes(beat) {
  const text = clean(beat.text);
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lead = clip(sentences[0] || text, 7);
  const body = clip(sentences.slice(1).join(' ') || text, 16);
  return [
    { type: 'note', headline: beat.headline, subhead: '', data: { lead, body } },
    { type: 'stat', headline: beat.headline, subhead: '', data: { value: (beat.accent || [])[0] || lead.split(' ')[0] || '', label: clip(lead, 5).toUpperCase(), tone: 'plain' } },
  ].filter((s) => (s.type !== 'stat' || s.data.value));
}

async function scenesForBatch(topic, batch, offset, opts, cast = []) {
  const lines = batch.map((b, i) =>
    `BEAT ${offset + i + 1} (${b.want} scenes)\nheadline: ${b.headline}\nnarration: ${b.text}`).join('\n\n');
  const prompt =
    `You are storyboarding a technical explainer video about: ${topic}\n\n` +
    `Each beat below is spoken over the number of scenes marked next to it, and ` +
    `they hard-cut between one another. A scene is on screen for about five ` +
    `seconds, which is why a long beat needs three: the frame has to keep ` +
    `changing or the viewer leaves.\n\n` +
    `The first scene sets up what the beat is about. The last is the payoff: the ` +
    `thing that actually happens, or the number that lands. A middle scene, when ` +
    `there is one, is the step between them. Consecutive scenes should usually look ` +
    `different, with ONE important exception: when the payoff is the same system ` +
    `changing, repeat the same flow with the same labels and show the change through ` +
    `"state", "becomes" and "traffic". A diagram the viewer already understands, now ` +
    `breaking, is the strongest pair of scenes there is. Aim for about a third of the ` +
    `beats to use it. Never two "note" scenes in a ` +
    `row and never two "stat" scenes in a row.\n\n` +
    `The first scene keeps the beat's own headline verbatim. Every later scene needs ` +
    `a NEW headline you write: max 5 words, sentence case, a spoken fragment usually ` +
    `ending in a full stop ("The lock never releases.", "Now it costs you."). ` +
    `Never a chapter title.\n\n` +
    `METAPHORS STAY IN THEIR BEAT: the analogy beat may label things in everyday ` +
    `words (a bank teller, a queue at a counter), but every other scene is about the ` +
    `real system and uses real component names only (Kubelet, Postgres, the pod). ` +
    `Never put a metaphor label into a technical diagram.\n\n` +
    `CONTINUITY: when the same component appears in consecutive scenes, give it the ` +
    `EXACT same label both times. It then glides to its new place on screen instead of ` +
    `being redrawn, and the viewer keeps track of the system. Prefer building on the ` +
    `previous scene, the same node in a new state, over starting a fresh picture.\n\n` +
    `Everything on screen must be technically real: real commands, real file names, ` +
    `real log lines, real numbers from the narration. Never invent a number the ` +
    `narration does not contain.\n\n${MENU}\n\n${KIND_LINE}\n\n` +
    (cast.length
      ? `COMPONENTS ALREADY ON SCREEN in earlier scenes of this same video. When you ` +
        `mean one of these, use EXACTLY this label, character for character, so the ` +
        `viewer sees the same box and it can carry over: ${cast.map((c) => `"${c}"`).join(', ')}.\n\n`
      : '') +
    (opts.series
      ? `THIS IS A "${opts.series.seriesTitle}" EPISODE. Show the actual machinery, not boxes ` +
        `with labels on them: real bits and bytes and array slots ("cells"), the real tree ` +
        `("tree"), the real latencies side by side ("stack"), the real message order ` +
        `("sequence"), the real code ("code"). Use at least three of those five types across ` +
        `the episode wherever they fit the beat.\n\n`
      : `Use "sequence" for any race, handshake or retry, "code" for any code, and "stack" ` +
        `for any comparison of latencies or sizes across orders of magnitude.\n\n`) +
    `THE BEATS:\n${lines}\n\n` +
    `Return ONLY JSON, with exactly the requested number of scenes per beat:\n` +
    `{ "eyebrow": "the field this reel is about, 1 to 3 words, uppercase, e.g. ` +
    `POSTGRES, TLS, KUBERNETES, CLOUD STORAGE",\n` +
    `  "beats": [ { "beat": <number>, "scenes": [ {"type":"","headline":"","subhead":"","data":{}}, {...} ] } ] }`;

  const raw = await gemini({
    prompt, json: true, temperature: 0.55, timeoutMs: 90000,
    maxOutputTokens: 8192, thinkingBudget: 0, ...opts,
  });
  return parseJson(raw);
}

/**
 * @param {string} topic
 * @param {object} script  validated script; beats carry text + headline
 * @param {object} [opts]  { category, log, model }
 * @returns {Promise<{eyebrow, accent, episode, scenes: Array}>}
 */
export async function writeScenes(topic, script, opts = {}) {
  const log = opts.log || (() => {});
  // A scene should hold for about five seconds. The narration duration of each
  // beat is already known by the time this runs, so the split is decided from
  // the real audio rather than from a guess about how long the words take.
  const TARGET_CUT = 5.5;
  const durations = opts.beatDurations || [];
  const beats = (script.beats || []).map((b, i) => ({
    ...b,
    want: Math.max(2, Math.min(4, Math.round((durations[i] || 9) / TARGET_CUT))),
  }));
  const BATCH = 4;
  const byBeat = new Map();
  let eyebrow = '';
  // Each batch is generated separately, so without this the same service was
  // called "App Server", then "App Worker", then "App Pods" at exactly the batch
  // boundaries, and nothing could carry across. Later batches get the names the
  // earlier ones settled on.
  const cast = [];
  const remember = (label) => {
    const l = clean(label);
    if (l && !cast.some((c) => c.toLowerCase() === l.toLowerCase())) cast.push(l);
  };

  for (let i = 0; i < beats.length; i += BATCH) {
    const batch = beats.slice(i, i + BATCH);
    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        parsed = await scenesForBatch(topic, batch, i, opts, [...cast]);
      } catch (e) {
        log(`  scenes: batch ${i / BATCH + 1} attempt ${attempt} failed (${e.message.slice(0, 60)})`);
      }
    }
    // the model names the field better than any slug heuristic can; first
    // batch to answer wins, so the label is stable across the whole reel
    if (!eyebrow && parsed && parsed.eyebrow) eyebrow = clip(clean(parsed.eyebrow), 3).toUpperCase();
    const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.beats) ? parsed.beats : []);
    for (const entry of rows) {
      const idx = Number(entry && entry.beat) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= beats.length) continue;
      const got = (Array.isArray(entry.scenes) ? entry.scenes : [])
        .map((s) => normaliseScene(s, beats[idx].headline))
        .filter(Boolean)
        .slice(0, beats[idx].want);
      if (got.length) byBeat.set(idx, got);
      // The persona puts the everyday analogy in beat 2. Its labels ("Bank
      // Teller", "The Manager") must never join the cast, or later batches are
      // told they are real components and put them into the technical diagram.
      if (idx === 1) continue;
      for (const sc of got) {
        if (sc.type === 'flow') sc.data.nodes.forEach((n) => remember(n.label));
        if (sc.type === 'compare') { remember(sc.data.left.label); remember(sc.data.right.label); }
      }
    }
  }

  // Assemble the final ordered list, filling any gap with the fallback pair.
  const scenes = [];
  let degraded = 0;
  beats.forEach((beat, idx) => {
    let got = byBeat.get(idx);
    if (!got || !got.length) { got = fallbackScenes(beat); degraded++; }
    // a beat that came back short is padded rather than left with one long
    // scene, because a nine second hold on one frame is where viewers leave
    while (got.length < beat.want) got.push(fallbackScenes(beat)[got.length % 2]);
    got = got.slice(0, beat.want);
    got[0].headline = beat.headline;   // scene one keeps the validated headline
    got.forEach((s, k) => scenes.push({ ...s, beat: idx, half: k, of: got.length }));
  });

  // The closing line used to be spoken over whatever frame happened to be last,
  // which held one scene for nine or ten seconds. It gets its own card instead.
  if (script.cta) {
    scenes.push({
      // The whole line is the headline. Clipping it to five words produced
      // "Save this before your next" and then repeated it in full underneath.
      type: 'note', beat: beats.length, half: 0, of: 1,
      headline: clean(script.cta),
      subhead: '',
      data: { lead: '', body: '' },
    });
  }

  log(`  scenes: ${scenes.length} across ${beats.length} beats (${beats.map((b) => b.want).join('')})` + (degraded ? `, ${degraded} beat(s) degraded to fallback` : ''));

  return {
    // a series episode wears its series and number, which is what makes people
    // follow for the next one
    eyebrow: opts.series
      ? `${opts.series.seriesTitle} · ${String(opts.series.number).padStart(2, '0')}`.toUpperCase()
      : eyebrow || clip(clean(opts.category || 'ENGINEERING'), 3).toUpperCase(),
    accent: accentFor(opts.category),
    episode: opts.episode || 'THE PROD MONKEY',
    handle: opts.handle || '',
    title: {
      kicker: opts.series
        ? `${opts.series.seriesTitle} · part ${opts.series.number}`.toUpperCase()
        : eyebrow || clip(clean(opts.category || 'ENGINEERING'), 3).toUpperCase(),
      title: clean(script.hook),
      // on-screen text is indexed by Instagram search, so the search phrase is
      // printed on the title card, the frame that is also the grid cover
      keyword: script.keyword || null,
    },
    scenes,
  };
}
