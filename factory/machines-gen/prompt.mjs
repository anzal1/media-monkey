/*
 * prompt.mjs: the one prompt that asks Gemini to invent a new machine.
 *
 * Everything the model needs is in here, read from disk at call time so it
 * never drifts from the code: the craft rules (condensed from Anatomy's
 * SKILL.md and references/craft.md), the owner's rules for the reel, the kit
 * API (kit-api.txt, condensed from Anatomy's references/kit.md), the runtime
 * contract (machines.js itself) and odometer.js as the worked example.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MACH = path.join(HERE, '..', 'explainer', 'machines');
const read = (f) => fs.readFileSync(f, 'utf8');

export const CRAFT = `
CRAFT RULES (condensed from the Anatomy skill, whose figures set the bar)

1. The object is the explanation. Do not draw boxes, arrows and labels. Invent a
   real, recognisable physical machine (an instrument, a tool, a mechanism you
   could build on a bench) whose working IS the concept. Earlier mappings:
   one GPU context serving many canvases = a gantry plotter visiting 16 wells;
   a cache key that skips work = a pin-tumbler lock whose plug only turns when
   every pin matches; seven render targets = a chest of seven drawers, each as
   deep as its bytes; integer overflow = an odometer whose last carry has no
   drum to land on. Say in one sentence what moves and what that motion means.
2. Two ways it fails: too abstract (stacked plates, floating slabs, labelled
   tiles read as nothing) and too flat (one big slab with a few lines). The fix
   for both: a recognisable machine built from many small, precise, purposeful
   parts. Layers become drawers, trays in a rack, cards in a holder.
3. Many small precise parts. Aim for 30 to 60 solids: a base plate on feet with
   corner screws (dots with a ring), a groove inset 3 to 5 units from the edge,
   structure (posts, cheeks, rails, frame bars, end stops), the mechanism
   (carriage, bushings, axle, drums, pawls, springs, gears, levers) and the
   subject itself. Every part sits on another part and has a job. Density comes
   from structure, never from texture or noise.
4. Solids, not wireframes. Everything is a filled solid painted back to front,
   so near parts hide far parts. No see-through edges, no dashed hidden lines.
5. Let the kit shade: four side tones by facing plus a lighter top. Tone
   hierarchy: base and feet "lo", structure "mid", the subject "hi". Exactly one
   accent: the part the reader should watch now (the class "mm-accent" outline
   or the "lit" line tone). Grooves "faint", minor ticks "lo", major ticks
   "mid". Monochrome otherwise; colour only when colour is the subject.
6. Painter's order: base first, then what rests on it; within a level sort far
   to near with k.depthOf. Split anything that wraps another part into a back
   half and a front half (a spring around a rod: back coil, rod, front coil).
   A moving part is drawn in the slot where it physically sits; if it could
   pass in front of and behind the same neighbour, bound the motion or split.
7. Lines resolve: every line ends on a face, an edge or a dot. No leader lines,
   balloons, dimension arrows or floating labels. A texture ends on a real edge
   or fades (fadedSvg, ribsOf with fade).
8. Volume: real thickness, parts standing on parts, a soft halo under the base.
9. Text: at most a few engraved glyphs on the machine itself (like the digits on
   the odometer drums), drawn as <text class="mm-glyph"> laid on a face with a
   matrix transform. Every other word goes in meta.label, meta.corner and the
   readout, which the page draws outside the figure.
10. Calm motion: eased (glide for moves, hump for a transient accent, smooth
   for fades), zero velocity at both ends, slow enough to follow, deterministic.
11. Truth: the readout and the motion come from one small model of the
   concept. If 3 of 4 tokens are left, three tokens are visibly in the bucket.
`;

export const OWNER = `
OWNER RULES FOR THIS REEL (hard)

- Premium restraint. No glow, no blur (the base halo is the only blurred thing),
  no shake, no bounce, no overshoot, no flashing. Motion is the glide easing
  from MM_MACHINES.util. Nothing pops in or out: fade with smooth().
- Legible on a phone. The plate is only about 700 px wide on the 1080 x 1920
  frame, so one viewBox unit is about 0.7 px. Any part the story depends on
  must be at least about 40 viewBox units across on screen; glyphs at least 30
  units tall; no hairline detail is load bearing. Prefer 4 to 10 big repeated units (slots, drums, pins) over 50
  tiny ones. The machine fills 55 to 65 percent of its plate, centred.
- One story per scene: each fixture scene shows one clear change (a token
  taken, a slot evicted, a pin set). The headline names it in at most 6 words.
- Deterministic: a pure function of (params, state, t, span). No Math.random,
  Date, performance, setTimeout, requestAnimationFrame, fetch or DOM access.
  If you need scatter, hash the index with a fixed integer formula.
- Fast: build() does all the heavy geometry once. Static layers are strings
  computed in build(). A dynamic layer returns a string from a small amount of
  per-frame work. Budget: under 5 ms of script per frame for the whole figure.
  Rebuilding a few small solids per frame is fine; rebuilding 40 is not. Prefer
  moving pre-built groups with k.translateAlong (a "translate(x y)" string in a
  <g transform>) over rebuilding them.
- Geometry stays inside the viewBox [0, 0, 1000, VH] in every frame, with the
  top 44 units kept clear at the left and right corners for the plate labels.
  Fit with k.fitProjection(extremes, 1000, VH, { pad: 8, headroom: 44, azimuth,
  elevation }) and include every extreme point, including where moving parts
  travel to.
`;

export const CONTRACT = `
THE RUNTIME CONTRACT (factory/explainer/machines/machines.js, shown in full below)

Your module is a classic script (no import/export) loaded after anatomy.js,
machines.js and odometer.js. It must look like:

(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, prismX, turnYZ, clamp01 } = M_.util;
  function normalize(params, state) { ... return { p, s }; }
  function build(p, s) {
    const { k, G } = root.ANATOMY;
    ...
    return {
      viewBox: [1000, VH],                 // VH between 420 and 700
      layers: [ { s: staticSvgString }, { d: (st) => dynamicSvgString }, ... ],   // painter's order
      meta: { corner: 'SHORT RIGHT LABEL', label: 'SHORT LEFT LABEL', accent: null },
      at(t, span = 5) { return frameState; },     // pure in t; t runs 0..span (span is about 5 s)
      readout(st) { return { label: 'WORDS', value: 'SHORT', tag: '', tagIn: 0 }; },
    };
  }
  M_.register('<kind>', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);

- normalize(params, state) receives JSON written by another model, so coerce
  numbers and strings sensibly, clamp counts to what you can draw, default
  anything optional, and throw an Error only when you truly cannot draw.
- The scene cuts in during its first 0.6 s: start motion at about t = 0.7,
  finish it by span - 0.8, then hold still.
- readout: label up to 24 characters, value a string up to 12 characters (the
  live number or state), tag '' or one short alarm word (EVICTED, DENIED,
  OVERFLOW, FOUND...) and tagIn 0..1 easing it in. Strings only, never numbers.
- meta.label is printed top left of the plate, meta.corner top right (short,
  uppercase reads best). meta.accent null.
- Available CSS classes inside the figure: everything the kit's solidSvg,
  lineSvg, dotsSvg and fadedSvg emit, "mm-glyph" for text (data-g="off" greys a
  glyph, data-g="sign" paints it in the accent) and "mm-accent" for the one
  accent outline path (fill none, accent stroke). The accent colour is
  var(--accent), a burnt orange.
`;

export function system() {
  return [
    'You are a senior technical illustrator and JavaScript engineer. You design',
    'parametric isometric machines that explain one engineering concept each, for',
    'a vertical Instagram reel, in the style of the Anatomy kit: a real object on a',
    'bench, many small precise solid parts, four-tone shading, calm motion.',
    'You write one complete, working classic-script module per request.',
  ].join('\n');
}

export function userPrompt(concept) {
  const kitApi = read(path.join(HERE, 'kit-api.txt'));
  const runtime = read(path.join(MACH, 'machines.js'));
  const odometer = read(path.join(MACH, 'odometer.js'));
  const fixture = read(path.join(HERE, '..', 'explainer', 'spec.machine.json'));
  const odoScenes = JSON.parse(fixture).scenes.slice(0, 3).map((s) => ({
    headline: s.headline, subhead: s.subhead, params: s.data.params, state: s.data.state,
  }));
  return `Design and code a NEW machine that explains this concept:

CONCEPT: ${concept}

${CRAFT}
${OWNER}
${CONTRACT}

KIT API (window.ANATOMY.k is the iso kit, window.ANATOMY.G is lathe; MM_MACHINES.util adds glide, hump, smooth, clamp01, prismX(ring, x0, x1, P) for a prism of any, also concave, y-z outline along world x, and turnYZ(points, cy, cz, angle))
-----
${kitApi}
-----

machines.js (the runtime your module plugs into)
-----
${runtime}
-----

odometer.js (machine #1, the worked example and the quality bar: study how it
builds static layers once, merges them, draws only drums, glyphs, pawls and the
gear per frame, plans a timeline of eased events, and keeps the readout true)
-----
${odometer}
-----

The odometer's fixture scenes, for the shape of a fixture:
${JSON.stringify(odoScenes, null, 2)}

WHAT TO RETURN, in exactly this order and format:

MAPPING: <one sentence: the real object, what moves, and what that motion means for the concept>
PARTS: <one paragraph listing at least 30 parts grouped as base, structure, mechanism, subject>
KIND: <the machine's kind, lowercase letters and hyphens, named after the object, for example "token-hopper">

\`\`\`javascript
<the complete module, registering exactly that kind>
\`\`\`

\`\`\`json
{
  "scenes": [
    { "headline": "<at most 6 words>", "subhead": "<at most 6 words>", "params": { ... }, "state": { ... } }
  ]
}
\`\`\`

The fixture has 3 or 4 scenes that tell the concept's story in order on the
same machine (same params, the state moving the story on). Each scene must
make the machine visibly move. No other text after the json block.`;
}

export function repairPrompt(errors) {
  return `The validator loaded your module in the real renderer page, ran every
fixture scene through every frame, and found these problems:

${errors.map((e) => '- ' + e).join('\n')}

Fix every one of them. Keep the same machine and the same story unless a
problem forces a change. Return the full answer again in exactly the same
format: MAPPING, PARTS, KIND, the complete javascript block and the complete
json block.`;
}
