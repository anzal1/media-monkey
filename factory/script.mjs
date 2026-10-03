// topic -> validated script JSON. Gemini writes it, this file refuses to let a
// malformed or rule-breaking script through. One repair retry, then it throws:
// a bad script is cheaper to regenerate than to render.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gemini } from './llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSONA = fs.readFileSync(path.join(HERE, 'persona.md'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));

const BANNED_TAGS = new Set([
  'fyp', 'fypage', 'viral', 'viralreels', 'explore', 'explorepage', 'trending',
  'foryou', 'foryoupage', 'reels', 'reelsinstagram', 'love', 'instagood',
  'follow', 'followme', 'like4like', 'l4l', 'f4f', 'instadaily',
]);

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-') || 'reel';
}

// Language directives. `mix` keeps the body English and opens with a Hindi
// hook line: the bilingual opener is a reach lever for the Indian audience
// without splitting the whole account's language.
const LANG_RULES = {
  en: '',
  hi: '\n\nLANGUAGE: write hook, beats, cta and caption in natural spoken Hindi, ' +
      'Devanagari script, the way a fast Delhi creator talks. Keep the same unhinged ' +
      'energy. English technical nouns stay in English inside the Hindi sentence. ' +
      'Accent words must still appear verbatim in their beat text.',
  mix: '\n\nLANGUAGE: hook, beats, cta and caption in English as specified. ADDITIONALLY ' +
       'return "hook_hi": the same hook line in natural spoken Hindi (Devanagari), ' +
       'same punch, max 9 words. It is spoken first, before the English body.',
};

// TTS reads text, not punctuation. Strip what would be spoken wrong or would
// break the ASS subtitle format.
/**
 * Captions are read, not spoken, so they keep their paragraph structure. Same
 * character clean-up as cleanSpoken but newlines survive (cleanSpoken collapses
 * every run of whitespace, which would flatten the numbered steps into a wall).
 */
function cleanCaption(s) {
  return String(s)
    // The model writes the scenario bullets as "->" about half the time and
    // "\u2192" the other half. The ASCII form contains ">", and YouTube rejects any
    // angle bracket in a description with a bare "invalid video description"
    // that never says which character. Normalise here so both platforms get
    // the same, nicer, arrow.
    .replace(/(^|\s)->(\s)/g, '$1\u2192$2')
    .replace(/(^|\s)<-(\s)/g, '$1\u2190$2')
    .replace(/[\u2014\u2013]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '')
    // underscores survive: INT_MIN and max_wal_size are names, not markdown
    .replace(/[*#`~]/g, '')
    .replace(/(^|\s)_+|_+(\s|$)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanSpoken(s) {
  return String(s)
    // O(n log n) would lose its parentheses below and be read "O n log n"
    .replace(/\bO\(([^)]{1,20})\)/g, 'O of $1')
    // INT_MIN must not become INTMIN on screen or in the voice: an underscore
    // inside a name becomes a space, which reads and sounds right
    .replace(/([A-Za-z0-9])_+(?=[A-Za-z0-9])/g, '$1 ')
    .replace(/[—–]/g, ' ')      // em/en dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[*_#`~]/g, '')
    .replace(/\s*\(([^)]*)\)\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A spelled-out figure before thousand/million/billion has to be a real English
 * number from 1 to 999 ("sixteen", "one hundred sixty seven"). The model once
 * tried to write 16,777,216 in words and produced "one sixty-seven million",
 * which the voice read out as a confident wrong number. Returns the offending
 * phrase or null. Digits and "sixteen point seven million" pass.
 */
const NUM_U = 'one|two|three|four|five|six|seven|eight|nine';
const NUM_T = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const NUM_Y = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const NUM_WORD = `${NUM_U}|${NUM_T}|${NUM_Y}|hundred`;
const NUM_OK = new RegExp(
  `^(?:(?:${NUM_U}) hundred)?(?: and)?(?: ?(?:${NUM_T}|(?:${NUM_Y})(?: (?:${NUM_U}))?|(?:${NUM_U})))?$`);
export function badSpelledNumber(s) {
  const flat = String(s).toLowerCase().replace(/-/g, ' ');
  const run = new RegExp(`\\b((?:(?:${NUM_WORD}|and) )+)(thousand|million|billion|trillion)\\b`, 'g');
  for (const m of flat.matchAll(run)) {
    // "a hundred million" and bare "hundred million" are fine English
    const words = m[1].trim().replace(/^(?:and )+/, '').replace(/^(?:a )?hundred\b/, 'one hundred');
    if (!NUM_OK.test(words)) return `${words} ${m[2]}`;
  }
  return null;
}

// Unicode-aware on purpose: Devanagari has to survive this for lang=hi.
function normWord(w) {
  return String(w).replace(/[^\p{L}\p{N}'%.-]/gu, '');
}
function wordsOf(s) {
  return cleanSpoken(s).split(/\s+/).map(normWord).filter(Boolean);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'is', 'are', 'was', 'were', 'be',
  'it', 'its', 'that', 'this', 'you', 'your', 'they', 'them', 'their', 'of',
  'to', 'in', 'on', 'at', 'for', 'with', 'from', 'as', 'by', 'not', 'no',
  'can', 'cant', 'will', 'just', 'than', 'then', 'when', 'what', 'does', 'do',
  'has', 'have', 'had', 'about', 'into', 'over', 'more', 'one', 'like',
]);

/**
 * The accent words are a styling choice, not a truth claim, so a model that
 * returns a phrase, a plural, or a word it paraphrased must not kill the whole
 * script. Match verbatim, then per word of a phrase, then by stem, and only
 * then fall back to the longest content word the beat actually contains.
 */
function pickAccent(text, raw) {
  const words = wordsOf(text);
  const lower = words.map((w) => w.toLowerCase());
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  const picked = [];

  // a phrase like "a tenth of a second" must not highlight "of" and "a"
  const want = (Array.isArray(raw) ? raw : [raw])
    .flatMap((w) => String(w || '').split(/\s+/))
    .map((w) => normWord(w).toLowerCase())
    .filter((w) => w && !STOPWORDS.has(w));

  for (const w of want) {
    if (picked.length >= 2) break;
    let hit = lower.indexOf(w);
    if (hit < 0) hit = lower.findIndex((t) => stem(t) === stem(w) && stem(w).length > 3);
    if (hit >= 0 && !picked.includes(lower[hit])) picked.push(lower[hit]);
  }
  if (!picked.length) {
    const best = [...lower]
      .filter((w) => w.length > 4 && !STOPWORDS.has(w))
      .sort((a, b) => b.length - a.length)[0];
    if (best) picked.push(best);
  }
  return picked.slice(0, 2);
}

function stripFence(raw) {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  let body = fenced ? fenced[1] : t;
  // tolerate leading prose before the object
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first > 0 || last < body.length - 1) body = body.slice(first, last + 1);
  return body;
}

/**
 * The per-beat headline is the line printed large while that beat is spoken.
 * A model that forgets the field, writes a chapter title, or repeats itself
 * should not kill the whole script, so fall back to the beat's own opening
 * clause, which is by construction the claim the beat is making.
 */
function headlineOf(b, text, i) {
  const raw = cleanSpoken((b && b.headline) || '');
  const words = wordsOf(raw);
  // A headline once read "Gluster bypasses the heap" over a beat about the C
  // allocator: the model invented a product name. Any capitalised name in a
  // headline must appear in the beat it sits on.
  const beatLower = String(text).toLowerCase();
  const invented = raw.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9+#.-]/g, ''))
    .filter((w) => w.length >= 4 && /^[A-Z]/.test(w) && !/^(The|This|That|Your|Every|When|Then|Now|One|Two|Why|What|How|It|Its)$/.test(w))
    .some((w) => !beatLower.includes(w.toLowerCase()));
  if (raw && !invented && words.length <= 6 && !/^(understanding|how to|what is|in this|section)\b/i.test(raw)) {
    return raw;
  }
  // first clause of the beat, trimmed to 5 words, with a full stop
  const clause = text.split(/(?<=[.!?])\s|,\s/)[0] || text;
  // never end a headline on a word that leans into a missing next word
  const DANGLING = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'in', 'at', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'your', 'its', 'their', 'is', 'are', 'that']);
  const ws = wordsOf(clause).slice(0, 5);
  while (ws.length > 2 && DANGLING.has(ws[ws.length - 1].toLowerCase())) ws.pop();
  const short = ws.join(' ');
  return short ? `${short.charAt(0).toUpperCase()}${short.slice(1)}.` : `Step ${i + 1}.`;
}

/** throws with a human-readable reason; the reason is fed back on retry. */
/*
 * Two lengths, run side by side so the insights can settle it. People watch
 * about 20 seconds of a 130 second reel today; "tight" tests whether a shorter
 * reel gets more of them to the payoff, "deep" keeps the full explanation.
 * Targets are in seconds and converted with the voice's real words per second.
 */
const LENGTHS = {
  tight: { beats: [6, 9], words: (wps) => ({ low: Math.round(70 * wps), high: Math.round(95 * wps) }) },
  deep:  { beats: [9, 14], words: (wps) => ({ low: Math.round(110 * wps), high: Math.round(150 * wps) }) },
};

export function validate(obj, topic, lang = 'en', opts = {}) {
  const err = (m) => { throw new Error(m); };
  if (!obj || typeof obj !== 'object') err('not a JSON object');

  const hook = cleanSpoken(obj.hook || '');
  if (!hook) err('hook is empty');
  const spelled = [hook, ...(Array.isArray(obj.beats) ? obj.beats : []).map((b) => (typeof b === 'string' ? b : (b && b.text) || '')),
    obj.cta || ''].map(badSpelledNumber).find(Boolean);
  if (spelled) {
    err(`"${spelled}" is not a number anyone says. Write large figures as digits ("16,777,216") ` +
        'or rounded with the scale ("about 16.7 million", "sixteen million"), never as a long run of words.');
  }
  if (wordsOf(hook).length > 12) err(`hook is ${wordsOf(hook).length} words, max 12`);
  // Every top reel opened on a moment ("A customer taps pay once.", "Your hot
  // key expires at 02:00:00.000."). When the topics turned into "why X" titles
  // the hooks followed ("Why negative seven modulo three breaks your code.")
  // and read like a chapter heading again.
  // hard on early attempts, a warning on the last, like the keyword: a
  // title-ish hook still beats a lost slot
  const soft = (m) => (opts.lenientLength ? (opts.log || (() => {}))(`  warning: ${m}`) : err(m));
  if (/^(why|how|what|when|understanding|learn|here'?s|this is|did you know|ever wonder)\b/i.test(hook)) {
    soft(`hook "${hook}" reads like a title. Open on the moment itself, present tense: what the viewer sees, ` +
        'types or gets back. Example shape: "Your modulo just returned two different numbers."');
  }

  if (!Array.isArray(obj.beats)) err('beats is not an array');
  const [bLo, bHi] = (LENGTHS[opts.length] || LENGTHS.deep).beats;
  if (obj.beats.length < bLo || obj.beats.length > bHi) {
    err(`beats has ${obj.beats.length} entries, need ${bLo} to ${bHi}`);
  }

  const beats = obj.beats.map((b, i) => {
    const text = cleanSpoken(typeof b === 'string' ? b : b.text || '');
    if (!text) err(`beat ${i + 1} has no text`);
    const n = wordsOf(text).length;
    if (n < 18) err(`beat ${i + 1} is only ${n} words, need 28 to 42`);
    if (n > 50) err(`beat ${i + 1} is ${n} words, need 28 to 42`);

    const source = cleanSpoken((b && b.source) || '');
    if (!source) err(`beat ${i + 1} has no source; every claim needs a checkable anchor`);

    // The headline is what the viewer reads while this beat plays, so it is a
    // hard requirement: a scene with no headline is a scene with no point.
    const headline = headlineOf(b, text, i);

    return { text, headline, accent: pickAccent(text, b.accent), source };
  });

  // A beat that says what an earlier beat already said is the fastest way to
  // lose a viewer. Filler phrases are the tell, and so is a beat whose content
  // words mostly repeat another's (real scripts top out near 0.42).
  const FILLER = /\b(in other words|basically|simply put|to recap|as we saw|long story short|once again)\b/i;
  beats.forEach((b, i) => {
    const m = b.text.match(FILLER);
    if (m) soft(`beat ${i + 1} says "${m[0]}", which restates instead of adding. Cut it and add the next fact.`);
  });
  const STOP = new Set('that this with from your they their them then than what when which have just into only each every more most like about there where while will would could should does been were being because after before over under also same other these those very much many some'.split(' '));
  const content = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
  const sets = beats.map((b) => content(b.text));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const small = Math.min(sets[i].size, sets[j].size);
      if (small < 5) continue;
      const shared = [...sets[i]].filter((w) => sets[j].has(w)).length;
      if (shared / small >= 0.6) soft(`beat ${j + 1} repeats beat ${i + 1}. Every beat must add one new fact; make beat ${j + 1} the next step deeper.`);
    }
  }

  // Two scenes in a row carrying the same headline reads as a stall, so the
  // later one falls back to its own beat text.
  const seenHeadlines = new Set();
  beats.forEach((b, i) => {
    const key = b.headline.toLowerCase();
    if (!seenHeadlines.has(key)) { seenHeadlines.add(key); return; }
    b.headline = headlineOf({}, b.text, i);
  });

  let cta = cleanSpoken(obj.cta || '');
  if (!cta || wordsOf(cta).length > 10) {
    cta = CONFIG.ctaFallbacks[Math.floor(Math.random() * CONFIG.ctaFallbacks.length)];
  }

  const caption = cleanCaption(obj.caption || '') || hook;

  let hashtags = (Array.isArray(obj.hashtags) ? obj.hashtags : [])
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 2 && !BANNED_TAGS.has(t));
  hashtags = [...new Set(hashtags)];
  // A reach/niche mix: the broad tags put the reel in front of the feed, the
  // specific ones land it with people who actually build the thing. Broad tags
  // are appended (not prepended) so the model's topic-specific ones come first.
  const BROAD = [
    'softwareengineering', 'systemdesign', 'backenddeveloper', 'devops',
    'programming', 'coding', 'webdevelopment', 'computerscience',
    'techtok', 'developerlife',
  ];
  for (const fill of BROAD) {
    if (hashtags.length >= 5) break;
    if (!hashtags.includes(fill)) hashtags.push(fill);
  }
  // Instagram counts only the first five since December 2025; the rest are
  // silently ignored and only make the caption look like spam
  hashtags = hashtags.slice(0, 5);

  // Length budget. The format is 30 to 45 seconds and Kokoro reads roughly 2.5
  // words a second including the gaps between segments, so the word count is
  // the only lever that actually controls runtime. Enforced here rather than
  // trusted to the prompt, because the model reliably overshoots.
  const hookHi = cleanSpoken(obj.hook_hi || obj.hookHi || '');
  if (lang === 'mix' && !hookHi) err('lang=mix needs a hook_hi field with the Hindi hook line');
  // On the last attempt the word budget stops being fatal. A 150 second reel
  // is worth having; a lost day is not. Structure (beats, sources, hook) stays
  // hard, because a malformed script cannot be rendered at all.
  const lenient = opts.lenientLength === true;

  const spokenWords = wordsOf(hook).length
    + beats.reduce((a, b) => a + wordsOf(b.text).length, 0)
    + wordsOf(cta).length
    // the Hindi opener is spoken too, so it spends from the same budget
    + (lang === 'mix' ? wordsOf(hookHi).length : 0);
  // The voice reads ~4.2 words a second at the configured speed, so words are
  // the only real lever on runtime. Enforced here because the model overshoots
  // in one direction and undershoots in the other depending on the topic.
  // Words per second comes from the voice config, so changing the voice or its
  // speed keeps runtime on target without touching this file.
  const WPS = Number(CONFIG.wordsPerSecond) || 3.1;
  const mode = LENGTHS[opts.length] ? opts.length : 'deep';
  const { low: LOW, high: HIGH } = LENGTHS[mode].words(WPS);
  const HARD_LOW = Math.round(LOW * 0.85), HARD_HIGH = Math.round(HIGH * 1.15); // still shipped
  const secs = (n) => (n / WPS).toFixed(0);
  // Telling the model "use 350 to 470 words" after it wrote 490 is weak
  // feedback: it swings to the other side and fails again. Give it the delta.
  if (lenient && spokenWords >= HARD_LOW && spokenWords <= HARD_HIGH) {
    if (spokenWords < LOW || spokenWords > HIGH) {
      (opts.log || (() => {}))(`  script length ${spokenWords} words (~${secs(spokenWords)}s) is outside ` +
        `${LOW}-${HIGH} but inside tolerance; shipping it rather than losing the reel`);
    }
  } else if (spokenWords > HIGH) {
    const cut = spokenWords - Math.round((LOW + HIGH) / 2);
    err(`script is ${spokenWords} spoken words, about ${secs(spokenWords)}s, which is ${spokenWords - HIGH} over the limit. ` +
        `Remove about ${cut} words to land near ${Math.round((LOW + HIGH) / 2)}. Shorten the wordiest beats; ` +
        'do not drop the analogy beat and do not reduce the number of beats.');
  }
  if (spokenWords < LOW) {
    const add = Math.round((LOW + HIGH) / 2) - spokenWords;
    err(`script is only ${spokenWords} spoken words, about ${secs(spokenWords)}s, which is ${LOW - spokenWords} under the minimum. ` +
        `Add about ${add} words to land near ${Math.round((LOW + HIGH) / 2)}, as ${Math.max(1, Math.round(add / 35))} more beat(s) ` +
        'of one component each rather than padding the beats you have.');
  }

  // The keyword is how the reel is found: spoken (transcribed and indexed), on
  // screen, and first in the caption. Hard on early attempts, a warning on the
  // last one, because a reel without it is still worth shipping.
  const keyword = String(obj.keyword || '').toLowerCase().replace(/[^a-z0-9' +#.-]/g, ' ').replace(/\s+/g, ' ').trim();
  const kwLen = keyword.split(' ').filter(Boolean).length;
  const spokenEarly = [hook, ...beats.slice(0, 2).map((b) => b.text)].join(' ').toLowerCase();
  // the opening fragments, the part shown before "more". The keyword goes in
  // there, inside the situation; forcing it into line one produced openers
  // like "Understanding two's complement and integer overflow explains why".
  const opening = caption.split(/\n\s*\n/)[0].toLowerCase();
  const firstLine = caption.split('\n')[0];
  const kwProblems = [];
  if (!keyword || kwLen > 5) kwProblems.push('"keyword" must be the 2 to 4 word search phrase for this reel');
  else {
    if (!spokenEarly.includes(keyword)) kwProblems.push(`say the keyword "${keyword}" word for word in the hook or the first two beats`);
    if (!opening.includes(keyword)) kwProblems.push(`use the keyword "${keyword}" word for word somewhere in the opening fragments of the caption, inside the situation`);
  }
  if (/^(why|how|what is|understanding|managing|learn|in this|today)\b/i.test(firstLine.trim())) {
    soft(`caption opens "${firstLine.slice(0, 40)}...", which is a title. Open with the situation: a symptom, a number, a log line or a flat contradiction.`);
  }
  if (kwProblems.length) {
    if (!opts.lenientLength) err(kwProblems.join('; '));
    (opts.log || (() => {}))(`  keyword warning: ${kwProblems.join('; ')}`);
  }

  return {
    topic,
    keyword: keyword || null,
    lang,
    slug: slugify(obj.slug || topic),
    hook,
    hookHi: hookHi || null,
    beats,
    cta,
    caption,
    hashtags,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * @param {string} topic
 * @param {object} [opts] { model, log }
 * @returns {Promise<object>} validated script
 */
/**
 * Grounded fact check of the spoken claims and their sources. Returns a
 * correction message for the writer, or null when the script is clean or the
 * check itself could not run.
 */
const issueText = (issues) => issues.map((x) => `beat ${x.beat}: "${x.claim}" is wrong; true: ${x.fix}`).join('; ');

/**
 * Rewrites only the flagged beats with the checker's corrections. Regenerating
 * the whole script instead brought in new claims every time: a real run went
 * five attempts, the checker found something new in each, and the reel died.
 */
export async function repairBeats(parsed, issues, { model, log = () => {} } = {}) {
  const prompt =
    'Here is the JSON script of a short explainer reel. A fact checker found these problems ' +
    '(beat 0 means the hook):\n' +
    issues.map((x) => `- beat ${x.beat}: "${x.claim}". What is true: ${x.fix}`).join('\n') +
    '\n\nRewrite ONLY those beats so every statement is true. Use the correction where it is solid; where ' +
    'a detail cannot be stated with certainty, say what happens in plain general terms instead of naming ' +
    'a number, a mode or a UI detail. Keep each rewritten beat within three words of its original length, ' +
    'keep its headline, accent and source fields consistent with the new text. Then make the hook, the ' +
    'caption and every other beat agree with the corrected facts: the same number must never appear two ' +
    'different ways. Change nothing else. Return the full JSON object.\n\n' +
    JSON.stringify(parsed);
  try {
    const raw = await gemini({ prompt, system: PERSONA, model, json: true, maxOutputTokens: 8192, thinkingBudget: 0, temperature: 0.4 });
    return JSON.parse(stripFence(raw));
  } catch (e) {
    log(`  repair failed: ${e.message}`);
    return null;
  }
}

export async function factCheck(script, { log = () => {} } = {}) {
  // the hook is item 0: it is the title card and the cover, so a wrong number
  // there is the most visible one (a cover once said sixty-seven million
  // after the beats had been corrected to 16,777,216)
  const lines = [`0. ${script.hook}  [the hook]`, ...script.beats.map((b, i) => `${i + 1}. ${b.text}  [source: ${b.source}]`)].join('\n');
  const prompt =
    'You are a careful technical fact checker. Use web search. Below are the spoken beats of a short ' +
    'explainer video, each with the source it claims. Flag only (a) claims a reliable source shows are ' +
    'FALSE (wrong algorithm or mode, wrong protocol, wrong number) and (b) specific numbers or product ' +
    'details stated as fact that no source supports. If you are not sure something is wrong, do not ' +
    'flag it; a checker that flips its verdict between runs is worse than a lenient one. Ignore ' +
    'simplifications and analogies that are fair for a general audience. Do not flag style. Flag a ' +
    'source only if no such document exists at all; a loose or descriptive title for a real document ' +
    '(for example "RFC 1700 network byte order") is fine. Mark each issue with kind "claim" or "source".\n\n' +
    `${lines}\n\n` +
    // Line format, not JSON: grounded replies come back as prose-wrapped text,
    // and a JSON parse error once let an AES-GCM claim through unchecked.
    'Reply with one line per issue and nothing else, exactly:\n' +
    'ISSUE | <beat number> | <claim or source> | <the wrong claim> | <what is actually true>\n' +
    'If everything holds, reply with the single word CLEAN.';
  let all = null;
  for (let tries = 0; tries < 2 && all === null; tries++) {
    try {
      const raw = await gemini({ prompt, tools: [{ google_search: {} }], temperature: 0.1, maxOutputTokens: 4096, timeoutMs: 90000 });
      const rows = raw.split('\n').map((l) => l.trim()).filter((l) => /^ISSUE\s*\|/i.test(l))
        .map((l) => l.split('|').map((x) => x.trim()))
        .filter((c) => c.length >= 5)
        .map(([, beat, kind, claim, ...fix]) => ({ beat, kind: /source/i.test(kind) ? 'source' : 'claim', claim, problem: 'incorrect', fix: fix.join(' | ') }));
      if (rows.length || /\bCLEAN\b/.test(raw)) all = rows;
    } catch (e) {
      log(`  fact check try ${tries + 1} failed: ${e.message}`);
    }
  }
  if (all === null) {
    log('  fact check skipped: no usable answer');
    return null;
  }
  try {
    // sources are never shown to the viewer, so a bad one is logged, not fatal;
    // rejecting on a source title once cost a whole run
    for (const x of all.filter((i) => i.kind === 'source')) log(`  fact check, source note: beat ${x.beat}: ${x.fix}`);
    const issues = all.filter((i) => i.kind !== 'source');
    if (!issues.length) {
      log('  fact check: clean');
      return null;
    }
    log(`  fact check flagged: ${issueText(issues)}`);
    return issues;
  } catch (e) {
    log(`  fact check skipped: ${e.message}`);
    return null;
  }
}

export async function writeScript(topic, opts = {}) {
  const model = opts.model || CONFIG.model;
  const lang = opts.lang || CONFIG.lang || 'en';
  const log = opts.log || (() => {});
  const wps = Number(CONFIG.wordsPerSecond) || 3.1;
  const mode = LENGTHS[opts.length] ? opts.length : 'deep';
  const lim = LENGTHS[mode].words(wps);
  const [bLo, bHi] = LENGTHS[mode].beats;
  const ser = opts.series;
  const seriesBlock = ser
    ? `SERIES: this is part ${ser.number} of "${ser.seriesTitle}". ${ser.seriesPitch}\n` +
      `Concept: ${ser.concept}. Angle to build on: ${ser.angle}.\n` +
      (ser.previous ? `The previous part covered: ${ser.previous}. You may nod to it in one clause, never rely on it.\n` : '') +
      `Structure the beats as: the everyday moment a non-engineer has lived, which is also the hook; ` +
      `the everyday analogy; then what the real machine or real system actually does, step by step, ` +
      `saying in a clause where it differs from the textbook version; the number that proves it; and ` +
      `what changes once they know, returning to the opening moment. Explain it from the ground up ` +
      `so a smart beginner follows every step, without ever talking down to an expert.\n` +
      `In the caption, right before the hashtags, add exactly this line: ` +
      `"${ser.seriesTitle}, part ${ser.number}. Follow for part ${ser.number + 1}."\n\n`
    : '';
  const base =
    seriesBlock +
    `LENGTH FOR THIS REEL (overrides the format contract): ${bLo} to ${bHi} beats, ` +
    `${lim.low} to ${lim.high} spoken words in total.\n\n` +
    `Topic for this reel: "${topic}"\n\n` +
    'Write the reel now. Obey the format contract exactly. ' +
    'Return only the JSON object.' +
    (LANG_RULES[lang] || '');

  // Two attempts was too few. The length constraint is the one the model is
  // worst at, and it tends to overshoot in the opposite direction on the
  // retry: a real run went 325 words, then 490, then died with nothing.
  // Feedback is cumulative: told only the last problem, the model fixed it and
  // broke the one before (a real run went fact check, then length, then
  // keyword, then length again, and died).
  const ATTEMPTS = 5;
  let lastErr = null;
  const rejections = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const prompt = attempt === 1
      ? base
      : `${base}\n\nYour earlier attempts were rejected for these reasons, most recent last:\n` +
        rejections.map((r, i) => `${i + 1}. ${r}`).join('\n') +
        '\nReturn one corrected JSON object that fixes ALL of them at once.';
    let raw;
    try {
      // The caption alone is 120-200 words now, so the default 4096 budget can
      // truncate the JSON mid-object; 2.5/3.x also spend that same budget on
      // thinking tokens, hence thinkingBudget 0 for this structured call.
      raw = await gemini({
        prompt, system: PERSONA, model, json: true,
        maxOutputTokens: 8192, thinkingBudget: 0,
      });
      const parsed = JSON.parse(stripFence(raw));
      // the final attempt ships whatever it gets, within tolerance
      const script = validate(parsed, topic, lang, { lenientLength: attempt === ATTEMPTS, log, length: mode });
      // A test reel said WhatsApp encrypts media with AES-GCM (it is CBC plus
      // HMAC). The format checks cannot catch that, so a grounded second read
      // does. If the check itself cannot run, the script ships.
      let final = script;
      const issues = await factCheck(script, { log });
      if (issues) {
        // repair in place, then ship it without a second check: the checker
        // has contradicted itself between runs, and the repair uses its own
        // corrections
        const fixed = await repairBeats(parsed, issues, { model, log });
        if (!fixed) throw new Error(`fact check: ${issueText(issues)}. Rewrite those beats with the true facts.`);
        try {
          final = validate(fixed, topic, lang, { lenientLength: true, log, length: mode });
        } catch (e) {
          throw new Error(`fact check: ${issueText(issues)}. Rewrite those beats with the true facts.`);
        }
        log(`  fact check: repaired beats ${issues.map((x) => x.beat).join(', ')}`);
      }
      final.lengthMode = mode;
      log(`  script ok on attempt ${attempt}: ${final.beats.length} beats, slug ${final.slug}`);
      return final;
    } catch (e) {
      lastErr = e.message;
      rejections.push(lastErr);
      log(`  script attempt ${attempt} rejected: ${lastErr}`);
    }
  }
  throw new Error(`script generation failed after ${ATTEMPTS} attempts: ${lastErr}`);
}

/**
 * Ordered list of spoken segments the TTS stage renders one wav each.
 * lang=hi marks every segment Hindi; lang=mix prepends the Hindi hook line
 * and keeps the English hook right after it, so the opener hits twice.
 */
export function segmentsOf(script) {
  const lang = script.lang || 'en';
  const segLang = lang === 'hi' ? 'hi' : 'en';
  const segs = [];
  if (lang === 'mix' && script.hookHi) {
    segs.push({ id: 'hookhi', kind: 'hook', text: script.hookHi, accent: [], lang: 'hi' });
  }
  segs.push({ id: 'hook', kind: 'hook', text: script.hook, accent: [], lang: segLang });
  script.beats.forEach((b, i) => {
    segs.push({ id: `beat${i + 1}`, kind: 'beat', text: b.text, accent: b.accent, lang: segLang });
  });
  segs.push({ id: 'cta', kind: 'cta', text: script.cta, accent: [], lang: segLang });
  return segs;
}
