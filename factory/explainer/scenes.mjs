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
export const SCENE_TYPES = ['flow', 'compare', 'window', 'card', 'list', 'stat', 'diff', 'note'];

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
          data: { "nodes": [ { "label": "2 words", "sub": "max 3 words", "kind": "<kind>" } ],
                  "edge": "max 3 words, the action on the wire",
                  "packet": true|false }
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
                  "tone": "good|bad|plain" }
"diff"    lines changing: a patch, a conflict, a log before and after.
          data: { "title": "max 5 words", "rows": [ { "text": "one line, max 36 characters", "tone": "add|del|plain" } ] }
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
  const sub = clip(clean(raw.subhead), 6);   // one line, it is set in wide-tracked mono
  let data = null;

  if (type === 'flow') {
    const nodes = (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 4)
      .map((n) => ({ label: clip(n && n.label, 3), sub: clip(n && n.sub, 4), kind: kindOf(n && n.kind) }))
      .filter((n) => n.label);
    if (nodes.length >= 2) data = { nodes, edge: clip(d.edge, 3), packet: d.packet !== false };
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
    if (value) data = { value, label: clip(d.label, 5).toUpperCase(), tone: toneOf(d.tone, ['good', 'bad', 'plain'], 'plain') };
  } else if (type === 'diff') {
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 6)
      .map((r) => (typeof r === 'string'
        ? { text: clean(r).slice(0, 38), tone: 'plain' }
        : { text: clean(r && r.text).slice(0, 38), tone: toneOf(r && r.tone, ['add', 'del', 'plain'], 'plain') }))
      .filter((r) => r.text);
    if (rows.length >= 2) data = { title: clip(d.title, 5), rows };
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

async function scenesForBatch(topic, batch, offset, opts) {
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
    `there is one, is the step between them. Consecutive scenes must be visually ` +
    `different: never the same type twice in a row, and never two "note" scenes.\n\n` +
    `The first scene keeps the beat's own headline verbatim. Every later scene needs ` +
    `a NEW headline you write: max 5 words, sentence case, a spoken fragment usually ` +
    `ending in a full stop ("The lock never releases.", "Now it costs you."). ` +
    `Never a chapter title.\n\n` +
    `Everything on screen must be technically real: real commands, real file names, ` +
    `real log lines, real numbers from the narration. Never invent a number the ` +
    `narration does not contain.\n\n${MENU}\n\n${KIND_LINE}\n\n` +
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

  for (let i = 0; i < beats.length; i += BATCH) {
    const batch = beats.slice(i, i + BATCH);
    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        parsed = await scenesForBatch(topic, batch, i, opts);
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
      type: 'note', beat: beats.length, half: 0, of: 1,
      headline: clip(clean(script.cta), 5),
      subhead: '',
      data: { lead: clean(script.cta), body: '' },
    });
  }

  log(`  scenes: ${scenes.length} across ${beats.length} beats (${beats.map((b) => b.want).join('')})` + (degraded ? `, ${degraded} beat(s) degraded to fallback` : ''));

  return {
    eyebrow: eyebrow || clip(clean(opts.category || 'ENGINEERING'), 3).toUpperCase(),
    accent: accentFor(opts.category),
    episode: opts.episode || 'THE PROD MONKEY',
    handle: opts.handle || '',
    title: { kicker: eyebrow || clip(clean(opts.category || 'ENGINEERING'), 3).toUpperCase(), title: clean(script.hook) },
    scenes,
  };
}
