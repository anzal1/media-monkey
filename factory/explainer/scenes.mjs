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
export const SCENE_TYPES = ['flow', 'compare', 'window', 'card', 'list', 'stat', 'chart', 'diff', 'note', 'sequence', 'cells', 'tree', 'stack', 'code', 'stack3d', 'phone'];
/** Types that only exist in the diorama theme; the flat theme drops them. */
const WORLD_TYPES = ['stack3d', 'phone'];
/** The hero artwork the renderer can draw (HERO_SVG in explainer.html). */
const HERO_KINDS = ['photo', 'card', 'file', 'packet', 'message', 'number', 'row'];
/** Hero states, in the renderer's terms: each is applied on top of the last. */
const HERO_STATES = ['whole', 'compressed', 'encrypted', 'split', 'labelled'];
const PHONE_APPS = ['chat', 'pay', 'notify', 'browser'];

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

/*
 * The diorama additions. The look is a daylight tabletop: matte slabs, a phone,
 * cards standing on a paper floor, and ONE hero object that travels the whole
 * reel and visibly changes at every step. The hero is the explanation.
 */
const MENU_DIORAMA = `DIORAMA TYPES (this reel uses the tabletop look; prefer these where they fit):

"stack3d" matte slabs stacked in space, seen from above at an angle. One slab is ACTIVE:
          it lifts, its number and name are printed large, and the hero stands on it. The
          camera glides between slabs from scene to scene. Use it for anything LAYERED: the
          network layers, the memory hierarchy, the storage stack, the layers of a model,
          the stages a request passes through in order.
          data: { "key": "osi", "active": 0,
                  "plates": [ { "label": "APPLICATION", "sub": "the chat app", "n": "7" } ],
                  "unit": "LAYER" }
          plates are listed TOP FIRST, 3 to 8 of them, label max 2 words (max 14 letters),
          sub max 5 words, "n" optional (max 4 characters) printed big next to the name; when
          omitted the slabs are numbered from the bottom. "active" is the 0-based index of the
          slab this scene is about. Give "plates" ONCE, the first time a stack appears; later
          scenes with the same "key" leave "plates" out and only move "active".
          Examples:
            { "key": "osi", "active": 3 }                       (camera moves to TRANSPORT)
            { "key": "mem", "active": 0, "unit": "LEVEL", "plates": [ {"label":"REGISTERS","sub":"under a nanosecond","n":"L0"},
              {"label":"L1 CACHE","sub":"one nanosecond","n":"L1"}, {"label":"RAM","sub":"a hundred nanoseconds","n":"RAM"},
              {"label":"SSD","sub":"a hundred microseconds","n":"SSD"} ] }
"phone"   a clean handset filling the middle of the frame: the moment a PERSON sees. Use it
          at the open (the everyday moment) and at the close (what the person sees at the end).
          Never more than three phone scenes in a reel. All names generic, no real brands.
          data, one of four apps:
            { "app": "chat", "contact": "Arjun", "device": "a", "send": true, "delivered": true,
              "messages": [ { "from": "them", "text": "max 8 words", "time": "9:38" },
                            { "from": "me", "photo": true, "time": "9:41" } ] }
               ("send" animates the last "me" message going out, "receive": true shows typing
                then the last "them" message arriving; device "b" is the OTHER person's phone)
            { "app": "pay", "merchant": "Corner Bakery", "amount": "₹450.00", "note": "Order 2041",
              "method": "Card •••• 0042", "button": "Pay", "done": "Paid", "success": true }
            { "app": "notify", "from": "Messages", "title": "Verification code",
              "body": "Use 482 913 to confirm. Never share it.", "code": "482 913" }
            { "app": "browser", "url": "shop.example.com/cart", "title": "Your cart", "progress": 1 }
"hero"    NOT a type: a field on a scene, next to "type", "headline" and "data". It puts the
          one travelling object into the scene in its CURRENT state. It is drawn on a
          "stack3d" slab, on the wire of a "flow" (it travels along it), and inside a "phone"
          chat as the photo bubble. On other types it is simply not shown, so leave it off.
          hero: { "key": "photo", "state": "whole|compressed|encrypted|split|labelled",
                  "bytes": "4.2 MB" or omit, "n": 6, "tag": "#{i} → 10.4.0.9", "glyphs": "bits" }
          whole = the object as the person knows it; compressed = visibly smaller, give the
          new "bytes"; encrypted = scrambled into glyphs; split = cut into "n" pieces (2 to 12);
          labelled = the pieces each get a label, "tag" is the label text where {i} is the
          piece number; "glyphs": "bits" shows ones and zeros instead of letters. States build
          on each other in order; "whole" reassembles it.
          Examples:
            "hero": { "key": "photo", "state": "compressed", "bytes": "640 KB" }
            "hero": { "key": "photo", "state": "split", "n": 6 }
            "hero": { "key": "payment", "state": "labelled", "tag": "#{i} seq {i}00", "glyphs": "bits" }
"flow" on this look stands its nodes on the floor and the hero travels the wire through them:
          the default for hops, routes and paths ("phone, router, backbone, server").
"compare" and "list" stand on the table as cards; "stat" stands its number on a plinth.`;

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
export function normaliseScene(raw, fallbackHeadline, ctx = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const world = ctx.theme === 'diorama';
  const type = SCENE_TYPES.includes(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase() : null;
  if (!type) return null;
  // the flat theme has no renderer for the tabletop types
  if (!world && WORLD_TYPES.includes(type)) return null;
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
  } else if (type === 'stack3d') {
    data = normaliseStack3d(d);
  } else if (type === 'phone') {
    data = normalisePhone(d);
  }

  if (!data) return null;
  const out = { type, headline: head, subhead: sub, data };
  if (world && type === 'flow') {
    const a = Number(d.active);
    if (Number.isInteger(a) && a >= 0 && a < data.nodes.length) data.active = a;
  }
  if (world) {
    const hero = normaliseHero(raw.hero);
    if (hero) out.hero = hero;
  }
  return out;
}

const slugKey = (k, dflt) => String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || dflt;
const intIn = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/**
 * stack3d: plates top first. A scene may leave "plates" out and inherit them
 * from an earlier stack with the same key; the post-pass resolves that, and a
 * scene that still has none is dropped there.
 */
function normaliseStack3d(d) {
  const plates = (Array.isArray(d.plates) ? d.plates : []).slice(0, 8)
    .map((pl) => (typeof pl === 'string' ? { label: pl } : pl || {}))
    .map((pl) => {
      const o = { label: clean(pl.label).toUpperCase().slice(0, 16), sub: clip(pl.sub, 5) };
      const n = clean(pl.n).slice(0, 4);
      if (n) o.n = n;
      return o;
    })
    .filter((pl) => pl.label);
  const out = { key: slugKey(d.key, 'stack') };
  if (plates.length >= 2) out.plates = plates;
  const unit = clip(d.unit, 2).toUpperCase().slice(0, 12);
  if (unit) out.unit = unit;
  if (d.twin && typeof d.twin === 'object') {
    const left = clip(d.twin.left, 2).toUpperCase().slice(0, 12), right = clip(d.twin.right, 2).toUpperCase().slice(0, 12);
    out.twin = { left: left || 'YOU', right: right || 'THEM' };
  } else {
    out.active = intIn(d.active, 0, 7, 0);
  }
  return out;
}

/** phone: one of four app screens, every field defaulted so a thin payload still draws. */
function normalisePhone(d) {
  const app = toneOf(d.app, PHONE_APPS, 'chat');
  const short = (v, n) => clean(v).slice(0, n);
  const out = { app };
  if (String(d.device || '').toLowerCase() === 'b') out.device = 'b';
  const clock = short(d.clock, 5);
  if (/^\d{1,2}:\d{2}$/.test(clock)) out.clock = clock;
  if (app === 'chat') {
    const msgs = (Array.isArray(d.messages) ? d.messages : []).slice(-5)
      .map((m) => (typeof m === 'string' ? { from: 'them', text: m } : m || {}))
      .map((m) => {
        const o = { from: String(m.from || '').toLowerCase() === 'me' ? 'me' : 'them' };
        if (m.photo === true) o.photo = true;
        else o.text = clip(m.text, 10).slice(0, 60);
        const t = short(m.time, 5);
        if (/^\d{1,2}:\d{2}$/.test(t)) o.time = t;
        return o;
      })
      .filter((m) => m.photo || m.text);
    if (!msgs.length) msgs.push({ from: 'me', text: 'sent' });
    out.contact = clip(d.contact, 2).slice(0, 16) || 'Arjun';
    out.status = clip(d.status, 2).slice(0, 14) || 'online';
    out.messages = msgs;
    if (d.send === true && msgs.some((m) => m.from === 'me')) out.send = true;
    if (d.receive === true && msgs.some((m) => m.from === 'them')) out.receive = true;
    if (d.delivered === true) out.delivered = true;
  } else if (app === 'pay') {
    out.merchant = clip(d.merchant, 3).slice(0, 22) || 'Corner Bakery';
    out.amount = short(d.amount, 12) || '₹450.00';
    const note = clip(d.note, 3).slice(0, 18);
    if (note) out.note = note;
    out.method = short(d.method, 18) || 'Card •••• 0042';
    out.button = clip(d.button, 2).slice(0, 12) || 'Pay';
    out.done = clip(d.done, 2).slice(0, 14) || 'Paid';
    if (d.success === false) out.success = false;
  } else if (app === 'notify') {
    out.from = clip(d.from, 2).slice(0, 16) || 'Messages';
    out.title = clip(d.title, 4).slice(0, 26);
    out.body = clip(d.body, 12).slice(0, 70);
    const code = short(d.code, 10);
    // the code is highlighted inside the body, so it only counts when it is there
    if (code && out.body.includes(code)) out.code = code;
    if (!out.title && !out.body) out.title = 'New message';
  } else {
    out.url = short(d.url, 32).replace(/^https?:\/\//, '') || 'example.com';
    out.title = clip(d.title, 4).slice(0, 26);
    const pr = Number(d.progress);
    if (Number.isFinite(pr)) out.progress = Math.max(0, Math.min(1, pr));
    if (HERO_KINDS.includes(String(d.image || ''))) out.image = d.image;
  }
  return out;
}

/** The hero as a scene carries it. Kind, label and text are made uniform in the post-pass. */
export function normaliseHero(h) {
  if (!h || typeof h !== 'object') return null;
  const out = { key: slugKey(h.key, 'hero'), state: toneOf(h.state, HERO_STATES, 'whole') };
  if (HERO_KINDS.includes(String(h.kind || '').toLowerCase())) out.kind = String(h.kind).toLowerCase();
  const label = clean(h.label).slice(0, 22);
  if (label) out.label = label;
  const text = clean(h.text).slice(0, 18);
  if (text) out.text = text;
  const bytes = clean(h.bytes);
  if (/^\d[\d.,]*\s*(B|KB|MB|GB)$/i.test(bytes)) out.bytes = bytes.toUpperCase().replace(/(\d)\s*([KMG]?B)$/, '$1 $2');
  if (h.n != null) out.n = intIn(h.n, 2, 12, 6);
  const tag = clean(h.tag).slice(0, 22);
  if (tag) out.tag = tag;
  if (String(h.glyphs || '').toLowerCase() === 'bits') out.glyphs = 'bits';
  return out;
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

/**
 * The part of a batch prompt that keeps a diorama reel one story: the hero and
 * the stack every batch must share, what the hero does in these beats, where
 * the previous batch left it, and the rules against showing anything twice.
 */
function worldBrief(bible, batch, offset, prev) {
  const b = bible || {};
  const hero = b.hero ? JSON.stringify(b.hero) : null;
  const journey = (b.journey || []).filter((j) => j.beat > offset && j.beat <= offset + batch.length);
  return `THE WORLD OF THIS REEL (planned once for the whole video; follow it exactly):\n` +
    (hero
      ? `HERO: ${hero}. Use "key": "${b.hero.key}" on every scene that shows it. It is the one ` +
        `object the viewer follows from the everyday moment through the machine and back. Show ` +
        `what happens TO IT at each step by changing its "state" (and "bytes", "n", "tag").\n`
      : '') +
    (b.stack
      ? `STACK: key "${b.stack.key}", slabs top first: ${b.stack.plates.map((pl, i) => `${i} ${pl.label}`).join(', ')}. ` +
        `Use "stack3d" with this key and move "active" to the slab the beat is about; never ` +
        `repeat "plates".\n`
      : '') +
    (journey.length
      ? `HERO JOURNEY IN THESE BEATS: ${journey.map((j) => `beat ${j.beat}: ${j.state}${j.change ? `, ${j.change}` : ''}`).join('; ')}.\n`
      : '') +
    (prev ? `THE PREVIOUS SCENE (end of the last batch): ${prev}. Your first scene must change something visible from it.\n` : '') +
    `\nNEVER REDUNDANT. Every scene must change something the viewer can SEE: a new slab, a ` +
    `new hero state, a new node, a new number, a new screen. Never show the same picture ` +
    `twice (same type, same data, same hero state). A "stat" only for a number the narration ` +
    `says. Use the classic types ("sequence", "code", "cells", "chart", "diff", "tree") only ` +
    `where the beat is genuinely about that artifact. Everything is correlated: whenever a ` +
    `beat explains the machine, tie it back to the person's moment by carrying the hero.\n\n`;
}

/** A one line description of a scene, for the next batch's prompt. */
function describeScene(sc) {
  if (!sc) return '';
  const h = sc.hero ? `, hero ${sc.hero.state}` : '';
  if (sc.type === 'stack3d') return `stack3d "${sc.data.key}" active ${sc.data.active}${h}`;
  if (sc.type === 'phone') return `phone ${sc.data.app}${h}`;
  if (sc.type === 'flow') return `flow ${sc.data.nodes.map((n) => n.label).join(' > ')}${h}`;
  return `${sc.type}${h}`;
}

async function scenesForBatch(topic, batch, offset, opts, cast = [], bible = null, prev = '') {
  const world = opts.theme === 'diorama';
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
    (world
      ? `HEADLINES: every scene has its own headline, written by you: max 5 words, sentence ` +
        `case, ending in a full stop. The narration is already captioned on screen word by ` +
        `word, so the headline must NEVER quote the narration; it states the CLAIM the ` +
        `viewer should take away ("Smaller, same picture.", "Only Arjun can read it.", ` +
        `"Six pieces, numbered."). Never a chapter title, never the hook line, and never ` +
        `the same headline twice in a row.\n\n`
      : `The first scene keeps the beat's own headline verbatim. Every later scene needs ` +
        `a NEW headline you write: max 5 words, sentence case, a spoken fragment usually ` +
        `ending in a full stop ("The lock never releases.", "Now it costs you."). ` +
        `Never a chapter title.\n\n`) +
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
    `narration does not contain.\n\n${MENU}\n\n${world ? MENU_DIORAMA + '\n\n' : ''}${KIND_LINE}\n\n` +
    (world ? worldBrief(bible, batch, offset, prev) : '') +
    (cast.length
      ? `COMPONENTS ALREADY ON SCREEN in earlier scenes of this same video. When you ` +
        `mean one of these, use EXACTLY this label, character for character, so the ` +
        `viewer sees the same box and it can carry over: ${cast.map((c) => `"${c}"`).join(', ')}.\n\n`
      : '') +
    // everyday episodes follow one object a person touches (the photo, the card,
    // the OTP) through the machine; bit-level types only where a beat is about bits
    (opts.series && opts.series.seriesKey === 'everyday'
      ? `THIS IS A "${opts.series.seriesTitle}" EPISODE. The story is one ordinary thing a person ` +
        `does, and the viewer follows that one object through the machine. Keep it on screen: ` +
        `carry the same label for it (the photo, the card, the message) across scenes so it can ` +
        `travel, and show what happens to it at each step with the real components ("flow", ` +
        `"sequence", "window"). Use "cells", "stack" or "code" only where a beat is really about ` +
        `bytes, latencies or code.\n\n`
      : opts.series
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

  const raw = await llmCall(opts)({
    prompt, json: true, temperature: 0.55, timeoutMs: 90000,
    maxOutputTokens: 8192, thinkingBudget: 0, ...llmOpts(opts),
  });
  return parseJson(raw);
}

// opts carries pipeline fields too; only the model settings reach the API call
const llmCall = (opts) => (typeof opts.llm === 'function' ? opts.llm : gemini);
const llmOpts = (opts) => {
  const { llm, theme, beatDurations, series, category, episode, handle, log, ...rest } = opts;
  return rest;
};

/*
 * ---------- diorama: one world for the whole reel ----------
 * Scenes are planned four beats at a time, which on its own let the hero be
 * called "the photo" in one batch and "IMG_001" in the next. One small call
 * first settles the hero, the stack and the cover for the whole video, and
 * every batch is handed that plan.
 */
async function planWorld(topic, script, opts) {
  const beats = (script.beats || []).map((b, i) => `BEAT ${i + 1}: ${b.text}`).join('\n');
  const prompt =
    `You are planning the visual world of a short vertical explainer video about: ${topic}\n\n` +
    `HOOK (spoken first, also the cover text): ${script.hook}\n${beats}\n\n` +
    `The look is a calm daylight tabletop diorama: matte slabs, a phone, cards standing on a ` +
    `paper floor. ONE object, the HERO, travels through the whole video and visibly changes ` +
    `at each step. The hero is the explanation: the viewer understands the mechanism by ` +
    `watching what happens to that one thing. Pick it from the everyday moment in the script ` +
    `(the photo, the card payment, the OTP, the request, the row, the integer). Even for a deep ` +
    `topic (bits, compilers, databases) pick the ordinary moment the script is really about ` +
    `(a payment, a message, a photo, a search, a login, a number on a screen), because ` +
    `everything a person touches is the machine underneath.\n\n` +
    `Hero kinds: "photo" an image; "card" a card payment; "file" a document, download or ` +
    `backup; "packet" a request or response on the network; "message" a chat message, SMS or ` +
    `OTP (put its words in "text"); "number" an integer, a float, a price, a counter (put the ` +
    `value in "text", e.g. "0.1" or "-7"); "row" a database record (cells in "text", separated ` +
    `by "|", e.g. "42 | Priya | 450").\n` +
    `Hero states, in order of what can happen to it: whole, compressed, encrypted, split, ` +
    `labelled (pieces get a label each). "whole" again means reassembled.\n\n` +
    `If the mechanism is LAYERED (network layers, memory hierarchy, storage stack, model ` +
    `layers, stages in a fixed order) define a "stack" of 3 to 8 slabs, top first; otherwise ` +
    `"stack": null.\n` +
    `The COVER is the first frame and the thumbnail, and the video loops back to it at the ` +
    `end. It is one strong image: two stacks side by side for "from one person to another" ` +
    `stories ({"type":"stack3d","left":"PRIYA","right":"ARJUN"}, needs a stack), otherwise ` +
    `the phone showing the everyday moment ({"type":"phone","data":{ phone data }}).\n` +
    `Phone data is one of: {"app":"chat","contact":"Arjun","messages":[{"from":"me","photo":true}]}, ` +
    `{"app":"pay","merchant":"Corner Bakery","amount":"₹450.00","method":"Card •••• 0042"}, ` +
    `{"app":"notify","from":"Messages","title":"Verification code","body":"Use 482 913 to confirm.","code":"482 913"}, ` +
    `{"app":"browser","url":"shop.example.com","title":"Checkout"}. Generic names only, no real brands.\n\n` +
    `Return ONLY JSON:\n` +
    `{ "eyebrow": "the field, 1 to 3 words, uppercase",\n` +
    `  "hero": { "key": "short-id", "kind": "photo|card|file|packet|message|number|row", ` +
    `"label": "its name on screen, max 3 words, e.g. IMG_2041.JPG or ₹450 to Corner Bakery", ` +
    `"bytes": "real size like 4.2 MB, or empty", "text": "for message, number, row" },\n` +
    `  "stack": null or { "key": "short-id", "unit": "LAYER", "plates": [ { "label": "max 2 words", "sub": "max 5 words" } ] },\n` +
    `  "cover": { ... },\n` +
    `  "journey": [ { "beat": 1, "state": "whole", "change": "what visibly happens to the hero, max 10 words" } ] }\n` +
    `One journey entry per beat, in order. A beat where the hero is not involved (the analogy) ` +
    `repeats the previous state with "change": "off screen".`;
  const raw = await llmCall(opts)({
    prompt, json: true, temperature: 0.5, timeoutMs: 60000,
    maxOutputTokens: 3072, thinkingBudget: 0, ...llmOpts(opts),
  });
  return normaliseBible(parseJson(raw), (script.beats || []).length);
}

export function normaliseBible(b, nBeats) {
  if (!b || typeof b !== 'object') return null;
  const out = { eyebrow: clip(clean(b.eyebrow), 3).toUpperCase() };
  const hero = normaliseHero(b.hero);
  if (hero) {
    hero.state = 'whole';
    if (!hero.kind) hero.kind = 'file';
    if (!hero.label) hero.label = hero.text || hero.key;
    if (!hero.n) hero.n = 6;
    out.hero = hero;
  }
  if (b.stack && typeof b.stack === 'object') {
    const st = normaliseStack3d(b.stack);
    if (st.plates && st.plates.length >= 3) out.stack = { key: st.key, plates: st.plates, ...(st.unit ? { unit: st.unit } : {}) };
  }
  const c = b.cover && typeof b.cover === 'object' ? b.cover : null;
  if (c && String(c.type).toLowerCase() === 'stack3d' && out.stack) {
    const left = clip(c.left || (c.twin && c.twin.left), 2).toUpperCase().slice(0, 12);
    const right = clip(c.right || (c.twin && c.twin.right), 2).toUpperCase().slice(0, 12);
    out.cover = { type: 'stack3d', data: { key: out.stack.key, plates: out.stack.plates, ...(out.stack.unit ? { unit: out.stack.unit } : {}),
      twin: { left: left || 'YOU', right: right || 'THEM' } } };
  } else if (c && String(c.type).toLowerCase() === 'phone') {
    out.cover = { type: 'phone', data: normalisePhone(c.data && typeof c.data === 'object' ? c.data : c) };
  }
  out.journey = (Array.isArray(b.journey) ? b.journey : [])
    .map((j) => ({ beat: Number(j && j.beat), state: toneOf(j && j.state, HERO_STATES, ''), change: clip(clean(j && j.change), 10) }))
    .filter((j) => Number.isInteger(j.beat) && j.beat >= 1 && j.beat <= nBeats && j.state);
  return out;
}

const wordsOfText = (t) => String(t || '').toLowerCase().match(/[a-z0-9₹$%]+/g) || [];
const sameWords = (a, b) => { const x = wordsOfText(a).join(' '); return !!x && x === wordsOfText(b).join(' '); };
/** the headline is the hook, or the hook cut short (headlines are clipped to six words) */
const isHook = (h, hook) => {
  const a = wordsOfText(h).join(' '), b = wordsOfText(hook).join(' ');
  return !!a && (a === b || (a.split(' ').length >= 3 && (b + ' ').startsWith(a + ' ')));
};
/** a headline made of three or more words that also appear, in order and together, in the narration */
function quotes(headline, narration) {
  const h = wordsOfText(headline);
  if (h.length < 3) return false;
  return (' ' + wordsOfText(narration).join(' ') + ' ').includes(' ' + h.join(' ') + ' ');
}
/** capitalised names in a headline that appear nowhere it could have come from */
function invents(headline, sources) {
  const hay = sources.join(' ').toLowerCase();
  return String(headline || '').split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9+#.-]/g, '').replace(/\.$/, ''))
    .filter((w) => w.length >= 4 && /^[A-Z]/.test(w) && !/^(The|This|That|Your|Every|When|Then|Now|One|Two|Three|Why|What|How|Its|Only|Each|Same|Still|Back|Next|First|Last|Here|There|Nothing|Never|Under|Over|Into|From|Smaller|Bigger|Faster|Slower)$/.test(w))
    .some((w) => !hay.includes(w.toLowerCase()));
}

// types that expose an anchor the hero can stand on
const heroFits = (sc) => (sc.type === 'stack3d' && !sc.data.twin) || sc.type === 'flow' ||
  (sc.type === 'phone' && sc.data.app === 'chat');

/** What the viewer would see, reduced to a string: two equal signatures are the same picture. */
function signature(sc) {
  const d = sc.data || {};
  const h = sc.hero ? `|h:${sc.hero.state}:${sc.hero.tag || ''}:${sc.hero.glyphs || ''}` : '';
  if (sc.type === 'stack3d') return `s3:${d.key}:${d.twin ? 'twin' : d.active}${h}`;
  if (sc.type === 'phone') {
    const m = (d.messages || []).map((x) => (x.photo ? '[photo]' : x.text)).join('/');
    return `ph:${d.device || 'a'}:${d.app}:${m}:${d.send ? 's' : ''}${d.receive ? 'r' : ''}:${d.amount || ''}:${d.code || d.body || ''}:${d.url || ''}${h}`;
  }
  if (sc.type === 'flow') return `fl:${d.nodes.map((n) => `${wordsOfText(n.label).join('')}.${n.state}.${n.becomes}`).join('>')}:${d.traffic}:${d.active ?? ''}${h}`;
  return `${sc.type}:${JSON.stringify(d)}`;
}

/**
 * The mechanical half of the anti-redundancy rules, plus the continuity the
 * renderer needs: one hero with one key, kind and piece count; stacks that
 * define their slabs once; no picture shown twice; headlines that state a
 * claim rather than quote the caption, never repeat back to back, and never
 * reuse the cover's line. Scenes that break a rule are dropped or merged into
 * their neighbours; nothing here throws.
 */
export function polishDiorama(scenes, { beats = [], hook = '', bible = null, durations = [], log = () => {} } = {}) {
  const notes = [];
  // ---- one hero
  const first = scenes.find((sc) => sc.hero && heroFits(sc));
  const canon = { ...(first ? first.hero : {}), ...((bible && bible.hero) || {}) };
  if (!canon.key && first) canon.key = first.hero.key;
  if (!canon.kind) canon.kind = (first && first.hero.kind) || 'file';
  const firstN = scenes.map((sc) => sc.hero && sc.hero.n).find(Boolean);
  const N = (bible && bible.hero && bible.hero.n) || firstN || 6;
  let seenHero = false;
  for (const sc of scenes) {
    if (!sc.hero) continue;
    if (!canon.key || !heroFits(sc)) { delete sc.hero; continue; }
    const h = sc.hero;
    h.key = canon.key; h.kind = canon.kind; h.n = N;
    if (canon.text) h.text = canon.text; else delete h.text;
    if (!seenHero) {
      if (!h.label && canon.label) h.label = canon.label;
      if (!h.bytes && canon.bytes) h.bytes = canon.bytes;
      seenHero = true;
    } else if (!h.label && canon.label) h.label = canon.label;
    if (sc.type === 'phone') {
      // the hero rides in the photo bubble of a chat; give it one to ride in
      const msgs = sc.data.messages;
      if (!msgs.some((m) => m.photo)) {
        msgs.push({ from: sc.data.receive && !sc.data.send ? 'them' : 'me', photo: true });
        while (msgs.length > 5) msgs.shift();
      }
    }
  }

  // ---- stacks define their slabs once
  const plates = {};
  if (bible && bible.stack) plates[bible.stack.key] = null;   // known key, slabs assigned on first use
  const kept = [];
  for (const sc of scenes) {
    if (sc.type === 'stack3d') {
      const d = sc.data;
      if (!d.plates && !(d.key in plates) && bible && bible.stack) d.key = bible.stack.key;
      if (plates[d.key]) delete d.plates;
      else if (d.plates) plates[d.key] = d.plates;
      else if (bible && bible.stack && d.key === bible.stack.key) {
        d.plates = bible.stack.plates;
        if (bible.stack.unit && !d.unit) d.unit = bible.stack.unit;
        plates[d.key] = d.plates;
      } else { notes.push(`dropped a stack3d with no slabs (${d.key})`); continue; }
      if (d.active != null) d.active = Math.min(d.active, plates[d.key].length - 1);
    }
    kept.push(sc);
  }
  scenes = kept;

  // ---- estimated spans, for deciding whether a beat can lose a scene
  const span = (sc) => (durations[sc.beat] || 9) / Math.max(1, sc.of || 1);
  const out = [];
  const seen = new Set();
  // pool: the scenes still in play; prev: the scene that would hold if this one went
  const tryDrop = (sc, why, pool, prev) => {
    const siblings = pool.filter((o) => o !== sc && o.beat === sc.beat && !o._dropped).length;
    if (siblings > 0) { sc._dropped = true; notes.push(`dropped: ${why}`); return true; }
    // the last scene of its beat: the previous scene would hold over the whole beat
    const hold = prev ? (prev._hold || span(prev)) + (durations[sc.beat] || 9) : 99;
    if (hold <= 11) { prev._hold = hold; sc._dropped = true; notes.push(`merged: ${why}`); return true; }
    notes.push(`kept (would leave a long hold): ${why}`);
    return false;
  };
  for (const sc of scenes) {
    const sig = signature(sc);
    if (seen.has(sig) && tryDrop(sc, `same picture as an earlier scene (${sc.type})`, scenes, out[out.length - 1])) continue;
    seen.add(sig);
    out.push(sc);
  }

  // ---- headlines state a claim, never the caption, never twice in a row
  const final = [];
  out.forEach((sc, i) => {
    const beat = beats[sc.beat] || {};
    const narration = beat.text || '';
    const prevHead = final.length ? final[final.length - 1].headline : '';
    const bad = (h) => !h || quotes(h, narration) || sameWords(h, prevHead) ||
      (final.length === 0 && (isHook(h, hook) || quotes(h, hook))) ||
      invents(h, [narration, beat.headline || '', JSON.stringify(sc.data), JSON.stringify(sc.hero || {})]);
    if (bad(sc.headline)) {
      const sub = wordsOfText(sc.subhead).length >= 2 && wordsOfText(sc.subhead).length <= 6 ? sc.subhead : '';
      const subHead = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) + (/[.!?]$/.test(sub) ? '' : '.') : '';
      const alt = [subHead, beat.headline].find((h) => h && !bad(h));
      if (alt) {
        if (alt === subHead) sc.subhead = '';
        notes.push(`headline "${sc.headline}" -> "${alt}"`);
        sc.headline = alt;
      } else if (sameWords(sc.headline, prevHead) && tryDrop(sc, `repeats the headline "${sc.headline}"`, out, final[final.length - 1])) {
        return;
      } else {
        // nothing passes every rule: repeating the cover or the line before is
        // worse than quoting the caption, so take the first line that avoids those
        const soft = [beat.headline, subHead].find((h) => h && !sameWords(h, prevHead) && !(final.length === 0 && isHook(h, hook)));
        if (soft && (final.length === 0 && isHook(sc.headline, hook) || sameWords(sc.headline, prevHead))) {
          notes.push(`headline "${sc.headline}" -> "${soft}" (best available)`);
          if (soft === subHead) sc.subhead = '';
          sc.headline = soft;
        } else notes.push(`headline "${sc.headline}" kept, no better line`);
      }
    }
    final.push(sc);
  });

  // ---- renumber the cuts inside each beat
  const byBeat = new Map();
  final.forEach((sc) => { if (!byBeat.has(sc.beat)) byBeat.set(sc.beat, []); byBeat.get(sc.beat).push(sc); });
  byBeat.forEach((list) => list.forEach((sc, k) => { sc.half = k; sc.of = list.length; delete sc._hold; delete sc._dropped; }));
  final.forEach((sc) => { delete sc._hold; delete sc._dropped; });
  if (notes.length) log(`  diorama polish: ${notes.length} fix(es): ${notes.slice(0, 6).join('; ')}${notes.length > 6 ? '; ...' : ''}`);
  return { scenes: final, notes };
}

/** The cover: the planned one, else the opening phone, else the stack seen twice. */
function coverFor(bible, scenes) {
  if (bible && bible.cover) return bible.cover;
  const ph = scenes.find((sc) => sc.type === 'phone');
  if (ph) return { type: 'phone', data: ph.data };
  const st = scenes.find((sc) => sc.type === 'stack3d' && sc.data.plates);
  if (st) return { type: 'stack3d', data: { key: st.data.key, plates: st.data.plates, twin: { left: 'YOU', right: 'THEM' } } };
  return null;
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

  const world = opts.theme === 'diorama';
  let bible = null;
  if (world) {
    for (let attempt = 1; attempt <= 2 && !bible; attempt++) {
      try { bible = await planWorld(topic, script, opts); } catch (e) {
        log(`  scenes: world plan attempt ${attempt} failed (${e.message.slice(0, 60)})`);
      }
    }
    if (bible) {
      log(`  world: hero ${bible.hero ? `${bible.hero.kind} "${bible.hero.label}"` : 'none'}, ` +
        `stack ${bible.stack ? `${bible.stack.key} (${bible.stack.plates.length})` : 'none'}, cover ${bible.cover ? bible.cover.type : 'none'}`);
    }
  }
  let prevScene = '';

  for (let i = 0; i < beats.length; i += BATCH) {
    const batch = beats.slice(i, i + BATCH);
    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        parsed = await scenesForBatch(topic, batch, i, opts, [...cast], bible, prevScene);
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
        .map((s) => normaliseScene(s, beats[idx].headline, { theme: opts.theme }))
        .filter(Boolean)
        .slice(0, beats[idx].want);
      if (got.length) { byBeat.set(idx, got); prevScene = describeScene(got[got.length - 1]); }
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
    // scene one keeps the validated headline; the diorama writes its own claim
    // and polishDiorama falls back to the beat's line when that claim breaks a rule
    if (!world) got[0].headline = beat.headline;
    got.forEach((s, k) => scenes.push({ ...s, beat: idx, half: k, of: got.length }));
  });

  let cover = null;
  if (world) {
    const polished = polishDiorama(scenes, {
      beats, hook: script.hook, bible, durations, log,
    });
    scenes.length = 0;
    scenes.push(...polished.scenes);
    cover = coverFor(bible, scenes);
    if (!eyebrow && bible && bible.eyebrow) eyebrow = bible.eyebrow;
  }

  // The closing line used to be spoken over whatever frame happened to be last,
  // which held one scene for nine or ten seconds. It gets its own card instead.
  // On the diorama it is the loop: the camera settles back onto the cover, so
  // the last frame equals the first.
  if (world && cover) {
    scenes.push({ loopTo: 0, beat: beats.length, half: 0, of: 1, headline: clean(script.cta || ''), subhead: '' });
  } else if (script.cta) {
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
    ...(world ? { theme: 'diorama' } : {}),
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
      ...(cover ? { backdrop: cover } : {}),
    },
    scenes,
  };
}
