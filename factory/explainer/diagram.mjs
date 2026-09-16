/*
 * diagram.mjs — turns a topic + the script's beats into a laid-out architecture
 * diagram spec for the explainer format.
 *
 * Design note: the model is NEVER asked for pixel coordinates. LLMs are bad at
 * layout and good at structure, so it returns ordered nodes + edges and this
 * file does the geometry (serpentine two-column flow). That keeps every diagram
 * clean no matter how the model phrases things.
 */
import { gemini } from '../llm.mjs';

const COLS = 2;
const NODE_W = 345;
const NODE_H = 170;
const GAP_X = 160;  // wide enough that an edge label never sits on a node
const GAP_Y = 90;

/** Serpentine two-column flow: 0 1 / 3 2 / 4 5 ... so edges never cross. */
export function layout(nodes) {
  return nodes.map((n, i) => {
    const row = Math.floor(i / COLS);
    const inRow = i % COLS;
    const col = row % 2 === 0 ? inRow : COLS - 1 - inRow;
    return {
      ...n,
      step: i,
      x: col * (NODE_W + GAP_X),
      y: row * (NODE_H + GAP_Y),
      w: NODE_W,
      h: NODE_H,
    };
  });
}

const SCHEMA_HINT = `Return ONLY JSON:
{
  "eyebrow": "SECTION / SUBSECTION, max 4 words, uppercase",
  "headline": "3 to 7 words, the claim, sentence case, may be two short sentences",
  "subhead": "max 6 words, the mechanism named",
  "nodes": [ { "id": "short_snake", "chip": "where it runs, e.g. browser / redis / aws s3", "title": "2-3 words", "sub": "max 5 words of detail", "accent": false } ],
  "edges": [ { "from": "id", "to": "id", "label": "max 3 words, the action" } ]
}`;

/** Models add fences, comments and trailing commas; none of that is worth a retry. */
function parseSpec(raw) {
  let t = String(raw).replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object in output');
  // walk to the matching close brace so trailing prose cannot break the parse
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  t = t.slice(start, end > 0 ? end : undefined);
  const tries = [
    t,
    t.replace(/\/\/[^\n]*/g, ''),                    // line comments
    t.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1'), // + trailing commas
  ];
  for (const candidate of tries) {
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error('unparseable after repairs');
}

export async function writeDiagram(topic, script, opts = {}) {
  const beats = (script.beats || []).map((b, i) => `${i + 1}. ${b.text}`).join('\n');
  const n = Math.max(3, Math.min(6, (script.beats || []).length));
  const prompt =
    `You are drawing the architecture diagram that goes behind a short technical video.\n\n` +
    `TOPIC: ${topic}\n\nThe narration, one line per beat:\n${beats}\n\n` +
    `Produce EXACTLY ${n} nodes, one per beat, in the same order as the beats, so each node ` +
    `appears as its beat is spoken. Nodes are real components (a service, a store, a client, ` +
    `a queue), never abstract ideas. Set "accent": true on the single node that is the crux ` +
    `of the explanation.\n` +
    `Edges connect consecutive nodes by id; add at most one extra edge if the real system ` +
    `loops back. Labels are the action on the wire (e.g. "INCR + EXPIRE", "signed URL", "cache miss").\n` +
    `Be technically correct: real protocol names, real service names, real verbs.\n\n` +
    SCHEMA_HINT;

  let spec = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3 && !spec; attempt++) {
    const ask = attempt === 1 ? prompt : prompt + '\n\nYour last reply was not valid JSON. Return raw JSON only: no code fences, no comments, no trailing commas.';
    // json:true sets responseMimeType so the model cannot emit prose or fences;
    // the tolerant parser below stays as a belt-and-braces fallback.
    const raw = await gemini({ prompt: ask, json: true, temperature: attempt === 1 ? 0.6 : 0.2, timeoutMs: 60000, maxOutputTokens: 8192, thinkingBudget: 0, ...opts });
    try {
      spec = parseSpec(raw);
    } catch (e) {
      lastErr = e;
      (opts.log || (() => {}))(`  diagram: bad JSON on attempt ${attempt} (${e.message.slice(0, 60)})`);
    }
  }
  if (!spec) throw new Error('diagram: ' + (lastErr?.message || 'no parseable spec'));
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 2) throw new Error('diagram: too few nodes');

  const nodes = layout(spec.nodes.slice(0, 6));
  const ids = new Set(nodes.map((x) => x.id));
  const edges = (spec.edges || [])
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({
      ...e,
      // an edge belongs to the step of the node it reveals
      step: nodes.find((x) => x.id === e.to)?.step ?? 1,
    }));

  return {
    eyebrow: String(spec.eyebrow || '').toUpperCase().slice(0, 42),
    headline: spec.headline || script.hook,
    subhead: spec.subhead || '',
    nodes,
    edges,
  };
}
