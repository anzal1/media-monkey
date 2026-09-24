// The render stage: segment wavs + a background loop + an ASS subtitle file,
// burned into out/<date>/<slug>/reel.mp4. No network here at all.
//
// Sync approach: Kokoro gives no word timestamps, so each segment's wav is
// scanned for where speech actually starts and stops (RMS gate), and the words
// are laid out inside that voiced window weighted by syllable-ish length plus
// a pause bonus after punctuation. Error stays inside one segment, so nothing
// drifts across the reel.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ffmpegPath, probeDuration } from './ffmpeg.mjs';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));

// --- wav analysis --------------------------------------------------------

/** Minimal 16-bit PCM wav reader (what kokoro-js writes). */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a wav: ${file}`);
  let pos = 12;
  let rate = 24000, channels = 1, bits = 16, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2);
  }
  if (!data) throw new Error(`no data chunk in ${file}`);
  const n = Math.floor(data.length / (bits / 8) / channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = bits === 16
      ? data.readInt16LE(i * 2 * channels) / 32768
      : data.readFloatLE(i * 4 * channels);
  }
  return { samples: out, rate, duration: n / rate };
}

/**
 * Where speech actually lives in a segment wav, in seconds.
 * Kokoro pads leading and trailing near-silence; laying words out across the
 * whole file instead of the voiced window is the single biggest source of
 * "captions run ahead of the voice".
 */
export function voicedWindow(file) {
  const { samples, rate, duration } = readWav(file);
  const win = Math.max(1, Math.round(rate * 0.01));       // 10ms frames
  const frames = Math.floor(samples.length / win);
  const energy = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) s += samples[i] * samples[i];
    energy[f] = Math.sqrt(s / win);
    if (energy[f] > peak) peak = energy[f];
  }
  const gate = peak * 0.06;
  let a = 0; while (a < frames && energy[a] < gate) a++;
  let b = frames - 1; while (b > a && energy[b] < gate) b--;
  const start = Math.max(0, (a * win) / rate - 0.02);
  const end = Math.min(duration, ((b + 1) * win) / rate + 0.04);
  return { start, end, duration, voiced: Math.max(0.1, end - start) };
}

// --- word timing ---------------------------------------------------------

const PAUSE = { ',': 0.9, ';': 1.1, ':': 1.1, '.': 1.5, '!': 1.5, '?': 1.5 };

/** Weight a word by how long it takes to say, not by how many letters it has. */
function weightOf(word) {
  const bare = word.replace(/[^\p{L}\p{N}']/gu, '');
  const vowels = (bare.match(/[aeiouyAEIOUY\u0900-\u097F]/g) || []).length;
  const syl = Math.max(1, vowels);
  let w = 0.55 + syl * 0.75 + bare.length * 0.06;
  const last = word.slice(-1);
  if (PAUSE[last]) w += PAUSE[last];
  return w;
}

/**
 * @returns {Array<{word,start,end,accent,group,indexInGroup}>} absolute seconds
 */
// Words a caption card should never end on: a card reading "When you change a"
// makes the eye wait for the next card to find out what the sentence was about.
const WEAK_TAIL = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'into', 'onto', 'and', 'or', 'but', 'nor', 'so', 'that', 'which', 'who',
  'your', 'my', 'our', 'their', 'its', 'his', 'her', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will',
  'can', 'could', 'would', 'should', 'it', 'as', 'than', 'if', 'when', 'every',
  'you', 'we', 'they', 'i', 'he', 'she', 'one', 'two', 'three', 'very', 'just',
  'under', 'over', 'past', 'across', 'through', 'behind', 'between', 'without', 'against', 'about', 'around', 'like', 'per', 'via', 'during', 'inside', 'within', 'after', 'before',
]);

// Words that open a new phrase. Breaking just BEFORE one of these reads
// naturally; breaking between two content words usually splits a compound
// noun ("disk | miss") or a verb from its object.
const PHRASE_START = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'and', 'or', 'but', 'so', 'that', 'which', 'who', 'when', 'while', 'because',
  'if', 'then', 'until', 'before', 'after', 'it', 'this', 'every', 'your',
  'is', 'are', 'was', 'were', 'will', 'can', 'into', 'than', 'instead',
  'under', 'over', 'past', 'across', 'through', 'behind', 'between', 'without', 'against', 'about', 'around', 'like', 'per', 'via', 'during', 'inside', 'within', 'after', 'before',
]);

/**
 * Split a spoken segment into caption cards at phrase boundaries.
 *
 * Cutting every N words put breaks mid-phrase ("hundred points, it forces").
 * This scores every way of splitting the segment and keeps the cheapest: cards
 * of three or four words are ideal, a card never spans a sentence end, it is
 * rewarded for ending on a comma and penalised for crossing one, and it is
 * penalised for ending on a word like "the" or "your" that leans forward into
 * the next card. Segments are ~40 words, so the O(n * maxGroup) table is tiny.
 *
 * @returns {number[][]} groups of word indices
 */
export function phraseGroups(words, maxGroup = 4) {
  const n = words.length;
  if (!n) return [];
  const MAX = maxGroup + 1;                  // one over, when it avoids a bad break
  const bare = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const endsSentence = (w) => /[.!?]["')\]]*$/.test(w);
  const endsClause = (w) => /[,;:]["')\]]*$/.test(w);

  function cost(i, j) {                      // words i..j-1 as one card
    const size = j - i;
    let c = size === 1 ? 7 : size === 2 ? 2 : size <= maxGroup ? 0 : 4;
    for (let k = i; k < j - 1; k++) {
      if (endsSentence(words[k])) return Infinity;   // never across a full stop
      if (endsClause(words[k])) c += 3;
    }
    const last = words[j - 1];
    if (endsClause(last)) c -= 1;
    if (j < n && !endsClause(last)) {
      if (WEAK_TAIL.has(bare(last))) c += 6;
      else if (PHRASE_START.has(bare(words[j]))) c -= 1.5;
      else c += 2.5;                         // content | content: a compound
    }
    return c;
  }

  const best = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = Math.max(0, j - MAX); i < j; i++) {
      const c = best[i] + cost(i, j);
      if (c < best[j]) { best[j] = c; from[j] = i; }
    }
  }
  if (!Number.isFinite(best[n])) {            // pathological input: fall back
    const g = [];
    for (let i = 0; i < n; i += maxGroup) g.push([...Array(Math.min(maxGroup, n - i)).keys()].map((k) => i + k));
    return g;
  }
  const out = [];
  for (let j = n; j > 0; j = from[j]) {
    out.unshift([...Array(j - from[j]).keys()].map((k) => from[j] + k));
  }
  return out;
}

export function timeWords(segments, opts = {}) {
  const maxGroup = opts.maxWordsOnScreen || CONFIG.subtitle.maxWordsOnScreen;
  const out = [];
  let t = 0;
  for (const seg of segments) {
    const vw = voicedWindow(seg.file);
    const words = seg.text.split(/\s+/).filter(Boolean);
    const weights = words.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const accentSet = new Set((seg.accent || []).map((a) => a.toLowerCase()));

    const groups = phraseGroups(words, maxGroup);

    let acc = 0;
    const times = words.map((w, i) => {
      const start = vw.start + (acc / total) * vw.voiced;
      acc += weights[i];
      const end = vw.start + (acc / total) * vw.voiced;
      return { start, end };
    });

    groups.forEach((g, gi) => {
      g.forEach((wi, j) => {
        const bare = words[wi].replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
        out.push({
          segId: seg.id,
          kind: seg.kind,
          word: words[wi],
          start: t + times[wi].start,
          end: t + times[wi].end,
          accent: accentSet.has(bare),
          group: `${seg.id}-${gi}`,
          groupWords: g.map((k) => words[k]),
          groupAccents: g.map((k) => accentSet.has(words[k].replace(/[^\p{L}\p{N}']/gu, '').toLowerCase())),
          indexInGroup: j,
        });
      });
    });

    t += seg.duration;
  }
  return out;
}

// --- ASS -----------------------------------------------------------------

/** #rrggbb -> ASS &HBBGGRR& */
function assColor(hex) {
  const h = hex.replace('#', '');
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase() + '&';
}

function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

function assEscape(s) {
  return String(s).replace(/\\/g, '/').replace(/[{}]/g, '').replace(/\n/g, '\\N');
}

/** Wrap the hook into 2-3 balanced lines so the thumbnail frame reads. */
function wrapHook(text, perLine = 16) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > perLine) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\\N');
}

export function buildAss(script, segments, words, opts = {}) {
  const sub = { ...CONFIG.subtitle, ...(opts.subtitle || {}) };
  const { width, height } = CONFIG.video;
  const white = assColor(sub.primaryColor);
  const accent = assColor(sub.accentColor);
  const black = '&H00000000&';
  const bold = sub.bold === false ? 0 : -1;
  // BorderStyle 1 = outlined text (brainrot); 3 = opaque box behind the words,
  // which is what the light explainer theme uses as its caption bar.
  const borderStyle = sub.borderStyle ?? 1;
  const align = sub.alignment ?? 5;
  const marginV = sub.marginV ?? 60;
  const shadow = sub.shadow ?? 3;
  const boxCol = sub.boxColor ? assColor(sub.boxColor) : black;

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Anton is already a heavy display face, so synthetic bold only smears it.
    // Arial Black and friends still want Bold=-1; config.subtitle.bold decides.
    `Style: Kara,${sub.fontName},${sub.fontSize},${white},${accent},${boxCol},${black},${bold},0,0,0,100,100,0,0,${borderStyle},${sub.outline},${shadow},${align},60,60,${marginV},1`,
    `Style: Hook,${sub.fontName},${sub.hookFontSize},${white},${accent},${boxCol},${black},${bold},0,0,0,100,100,0,0,${borderStyle},${sub.outline + 2},${shadow},${align},70,70,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const ev = [];

  // 1. hook title card. Static, huge, centered: this is the thumbnail frame.
  // It holds for the whole spoken hook (at least hookTitleSeconds) so there is
  // never a gap between the title and the first karaoke word.
  // The hook segments are always first. lang=mix has two of them (Hindi line,
  // then English line) and each gets its own card, so the title on screen is
  // always the line being spoken.
  // The explainer scene draws its own title card in HTML, so burning one in
  // here too put the same sentence on screen twice, overlapping itself.
  const hookSegs = sub.hookCard === false ? [] : segments.filter((s) => s.kind === 'hook');
  const hookSpoken = hookSegs.reduce((a, s) => a + s.duration, 0);
  const hookEnd = Math.max(sub.hookTitleSeconds, hookSpoken);
  const titleY = Math.round(height * 0.46);
  let cursor = 0;
  hookSegs.forEach((hs, i) => {
    const from = cursor;
    cursor += hs.duration;
    const to = i === hookSegs.length - 1 ? hookEnd : cursor;
    // Devanagari has no uppercase and toUpperCase leaves it alone, but the
    // Latin hook wants the shout.
    const perLine = sub.hookCharsPerLine || 16;
    const text = wrapHook(assEscape(hs.text.toUpperCase()), hs.lang === 'hi' ? perLine + 4 : perLine);
    ev.push(
      `Dialogue: 0,${assTime(from)},${assTime(to)},Hook,,0,0,0,,` +
      `{\\an5\\pos(${width / 2},${titleY})\\fad(120,180)}${text}`,
    );
    ev.push(
      `Dialogue: 0,${assTime(from)},${assTime(to)},Hook,,0,0,0,,` +
      `{\\an5\\pos(${width / 2},${titleY + 190})\\fad(120,180)\\p1\\c${accent}\\bord0\\shad0}` +
      'm 0 0 l 260 0 l 260 12 l 0 12{\\p0}',
    );
  });

  // 2. the caption line. Its height is a knob because the explainer scene puts
  // its own footer and progress bar where the brainrot theme wanted captions.
  const y = Math.round(height * (sub.lineY || 0.66));

  // A heavily blurred black slab under the caption line. On the fluid
  // background the white lobes are near-white, and a 6px outline alone is not
  // enough there. Blurred, it reads as a shadow pool rather than a box.
  // ...but a light scene with dark captions needs no shadow pool; there it just
  // reads as a smudge, so the explainer theme switches it off.
  const karaWords = words.filter((w) => w.kind !== 'hook');
  if (karaWords.length && sub.scrim !== false) {
    const from = Math.min(...karaWords.map((w) => w.start)) - 0.2;
    const to = Math.max(...karaWords.map((w) => w.end)) + 0.3;
    ev.push(
      `Dialogue: 0,${assTime(from)},${assTime(to)},Kara,,0,0,0,,` +
      `{\\an5\\pos(${width / 2},${y})\\p1\\c&H000000&\\alpha&H78&\\bord0\\shad0\\blur34\\fad(200,260)}` +
      'm -540 -140 l 540 -140 l 540 140 l -540 140{\\p0}',
    );
  }
  // Two caption behaviours, and the box theme is NOT karaoke.
  //
  // With BorderStyle 3 the box is drawn per span, so any per-word change to the
  // border or the scale breaks the bar into a stepped shape. More importantly a
  // highlight that hops word to word pulls the eye away from the diagram, which
  // is the thing the viewer is supposed to be reading. So a boxed caption is a
  // STATIC card: the group appears once, holds for as long as it is spoken, and
  // carries exactly one coloured word, the accent word for that beat. One event
  // per group instead of one per word, which also removes the per-word flicker.
  const boxed = borderStyle === 3;
  if (boxed) {
    // every word carries the id of the group it belongs to, so collapsing to
    // one card per group is a straight fold over that key
    const cards = [];
    for (const w of words) {
      if (w.kind === 'hook') continue;
      const last = cards[cards.length - 1];
      if (last && last.id === w.group) {
        last.end = Math.max(last.end, w.end);
        continue;
      }
      cards.push({ id: w.group, words: w.groupWords, accents: w.groupAccents, start: w.start, end: w.end });
    }
    for (const c of cards) {
      const parts = c.words.map((gw, j) =>
        `{\\c${c.accents[j] ? accent : white}\\alpha&H00&\\bord${sub.outline}}${assEscape(gw)}`);
      ev.push(
        `Dialogue: 1,${assTime(c.start)},${assTime(Math.max(c.start + 0.2, c.end))},Kara,,0,0,0,,` +
        `{\\an5\\pos(${width / 2},${y})}${parts.join(' ')}`,
      );
    }
  } else {
    for (const w of words) {
      if (w.kind === 'hook') continue;       // covered by the title card
      const parts = w.groupWords.map((gw, j) => {
        const isActive = j === w.indexInGroup;
        const col = w.groupAccents[j] ? accent : white;
        if (isActive) {
          return `{\\c${col}\\alpha&H00&\\fscx112\\fscy112\\bord${sub.outline}}${assEscape(gw)}`;
        }
        return `{\\c${col}\\alpha&H70&\\fscx100\\fscy100\\bord${sub.outline}}${assEscape(gw)}`;
      });
      ev.push(
        `Dialogue: 1,${assTime(w.start)},${assTime(Math.max(w.start + 0.05, w.end))},Kara,,0,0,0,,` +
        `{\\an5\\pos(${width / 2},${y})}${parts.join(' ')}`,
      );
    }
  }

  return `${head.join('\n')}\n${ev.join('\n')}\n`;
}

// --- render --------------------------------------------------------------

/**
 * Three tiers, weighted by config.background.tiers:
 *   physics       the seeded brainrot sims in assets/bg (rings, plinko, pong)
 *   harvested     "oddly satisfying" stock from Pexels/Pixabay/YouTube-CC
 *   publicDomain  NASA and Internet Archive
 * assets/bg/calm holds the demoted ambient loops and is never in the default
 * draw: it is a subdirectory, and only top-level mp4s are pooled.
 * An empty tier hands its weight to the tiers that do have footage.
 */
export function backgroundPools(bgDir, clipsDir) {
  const physics = [];
  if (bgDir && fs.existsSync(bgDir)) {
    for (const f of fs.readdirSync(bgDir)) {
      if (f.endsWith('.mp4')) {
        physics.push({
          file: path.join(bgDir, f), kind: 'physics',
          attribution: null, origin: 'self-generated',
        });
      }
    }
  }

  const harvested = [];
  const publicDomain = [];
  if (clipsDir && fs.existsSync(clipsDir)) {
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(clipsDir, 'sources.json'), 'utf8')); } catch { rows = []; }
    const byFile = new Map(rows.map((r) => [r.file, r]));
    for (const f of fs.readdirSync(clipsDir)) {
      if (!f.endsWith('.mp4')) continue;
      const row = byFile.get(f) || {};
      const entry = {
        file: path.join(clipsDir, f),
        kind: row.tier === 'harvested' ? 'harvested' : 'publicDomain',
        attribution: row.attribution || null,
        origin: row.origin || 'unknown',
      };
      (entry.kind === 'harvested' ? harvested : publicDomain).push(entry);
    }
  }
  return { physics, harvested, publicDomain };
}

/** Weighted draw over the tiers that actually have footage. null if none do. */
export function rollTier(pools, weights = CONFIG.background.tiers) {
  const live = Object.keys(pools).filter((k) => pools[k].length);
  if (!live.length) return null;
  const total = live.reduce((a, k) => a + (weights[k] || 0), 0);
  let roll = Math.random() * (total || live.length);
  for (const k of live) {
    roll -= total ? (weights[k] || 0) : 1;
    if (roll <= 0) return k;
  }
  return live[live.length - 1];
}

export function pickBackground(bgDir, opts = {}) {
  const pools = opts.pools || backgroundPools(bgDir, opts.clipsDir);
  const weights = { ...CONFIG.background.tiers, ...(opts.tiers || {}) };
  // an explicitly requested tier only wins if it has footage; otherwise roll
  const chosen = (opts.tier && pools[opts.tier]?.length)
    ? opts.tier
    : rollTier(pools, weights);
  if (!chosen) {
    throw new Error(`no backgrounds: run "node factory/record-bg.mjs" first (looked in ${bgDir})`);
  }
  const list = pools[chosen];
  return list[Math.floor(Math.random() * list.length)];
}

async function concatWavs(segments, outFile) {
  const listFile = `${outFile}.txt`;
  fs.writeFileSync(
    listFile,
    segments.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
  );
  await execFileP(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:a', 'pcm_s16le', outFile,
  ]);
  fs.unlinkSync(listFile);
  return outFile;
}

/**
 * @returns {Promise<{video,caption,bg,duration,ass}>}
 */
export async function assemble(opts) {
  const { script, segments, outDir, bgDir, clipsDir, log = () => {} } = opts;
  fs.mkdirSync(outDir, { recursive: true });
  const { width, height, fps, tailSeconds } = CONFIG.video;

  const narration = await concatWavs(segments, path.join(outDir, 'narration.wav'));
  const narrationDur = probeDuration(narration);
  const total = +(narrationDur + tailSeconds).toFixed(3);

  // make.mjs owns tier selection, so it normally hands us a resolved entry
  // (opts.bg) or the path of a variant it just recorded (opts.bgFile). Picking
  // here is the standalone path, e.g. calling assemble() directly from a test.
  const bg = opts.bg
    || (opts.bgFile
      ? { file: opts.bgFile, kind: 'physics-fresh', attribution: null }
      : pickBackground(bgDir, { clipsDir, tier: opts.bgTier }));
  const bgDur = probeDuration(bg.file);
  // start somewhere random in the loop so two reels on the same background do
  // not open on the same frame
  const offset = bgDur > total + 2 ? +(Math.random() * (bgDur - total - 1)).toFixed(2) : 0;
  log(`  bg: ${path.basename(bg.file)} (${bg.kind}, ${bgDur.toFixed(0)}s) from ${offset}s`);

  const words = timeWords(segments, { maxWordsOnScreen: opts.subtitle?.maxWordsOnScreen });
  const ass = buildAss(script, segments, words, { subtitle: opts.subtitle });
  const assFile = path.join(outDir, 'subs.ass');
  fs.writeFileSync(assFile, ass, 'utf8');

  const reel = path.join(outDir, 'reel.mp4');
  // On macOS libass uses the coretext provider and finds Arial Black by itself.
  // On a Linux CI runner there is no Arial Black, so drop a .ttf into
  // assets/fonts/ (Anton and Archivo Black are OFL and read like Arial Black)
  // and set subtitle.fontName to match: that directory wins when it exists.
  const ownFonts = path.join(HERE, '..', 'assets', 'fonts');
  const fontsDir = [
    fs.existsSync(ownFonts) && fs.readdirSync(ownFonts).some((f) => /\.(ttf|otf|ttc)$/i.test(f))
      ? ownFonts : null,
    '/System/Library/Fonts/Supplemental',
    '/Library/Fonts',
    '/usr/share/fonts',
  ].find((d) => d && fs.existsSync(d));
  const subOpt = ['filename=subs.ass', fontsDir && `fontsdir=${fontsDir}`]
    .filter(Boolean).join(':');

  const vf = [
    `fps=${fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    // Darken and vignette before burn-in so white captions survive the bright
    // lobes of a fluid background. The explainer scene is a light, deliberately
    // composed frame with dark captions, so it passes grade:false and keeps its
    // own values: this grade would grey it out and vignette the corners.
    ...(opts.grade === false
      ? []
      : ['eq=brightness=-0.10:contrast=1.10:saturation=1.05', 'vignette=angle=PI/4.2']),
    // ffmpeg 9 wants the option named; cwd is outDir so the path needs no escaping
    `subtitles=${subOpt}`,
    'format=yuv420p',
  ].join(',');

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-stream_loop', '-1', '-ss', String(offset), '-i', bg.file,
    '-i', narration,
    // loudnorm to -14 LUFS: raw Kokoro output sits around -25 dB mean, which
    // reads as low-energy next to everything else in the feed.
    '-filter_complex',
    `[0:v]${vf}[v];[1:a]apad=pad_dur=${tailSeconds},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(total),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    reel,
  ];
  const t0 = Date.now();
  await execFileP(ffmpegPath({ needs: 'subtitles' }), args, { cwd: outDir, maxBuffer: 1 << 24 });
  log(`  encoded ${total.toFixed(2)}s reel in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Attribution is a licence obligation, not a nicety: a clip whose source row
  // carries an attribution string gets credited on the post automatically.
  const caption = path.join(outDir, 'caption.txt');
  const lines = [
    script.caption,
    '',
    script.hashtags.map((h) => `#${h}`).join(' '),
  ];
  if (bg.attribution) lines.push('', `bg: ${bg.attribution}`);
  fs.writeFileSync(caption, `${lines.join('\n')}\n`, 'utf8');

  // Everything the YouTube uploader needs, decided here rather than parsed out
  // of the caption in a shell step. The hook is already a <=9 word spoken line,
  // which is exactly the shape a Shorts title wants.
  fs.writeFileSync(
    path.join(outDir, 'youtube.json'),
    JSON.stringify({
      title: script.hook.replace(/\s+/g, ' ').trim().slice(0, 100),
      tags: script.hashtags,
      descriptionFile: 'caption.txt',
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'script.json'),
    JSON.stringify({
      ...script,
      background: { file: path.basename(bg.file), kind: bg.kind, offset },
      segments: segments.map((s) => ({ id: s.id, lang: s.lang, voice: s.voice, duration: +s.duration.toFixed(3), text: s.text })),
      narrationSeconds: +narrationDur.toFixed(2),
      totalSeconds: total,
    }, null, 2),
    'utf8',
  );

  return { video: reel, caption, bg, duration: total, ass: assFile, narrationDur };
}
