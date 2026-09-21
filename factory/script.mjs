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
    .replace(/[*_#`~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanSpoken(s) {
  return String(s)
    .replace(/[—–]/g, ' ')      // em/en dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[*_#`~]/g, '')
    .replace(/\s*\(([^)]*)\)\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (raw && words.length <= 6 && !/^(understanding|how to|what is|in this|section)\b/i.test(raw)) {
    return raw;
  }
  // first clause of the beat, trimmed to 5 words, with a full stop
  const clause = text.split(/(?<=[.!?])\s|,\s/)[0] || text;
  const short = wordsOf(clause).slice(0, 5).join(' ');
  return short ? `${short.charAt(0).toUpperCase()}${short.slice(1)}.` : `Step ${i + 1}.`;
}

/** throws with a human-readable reason; the reason is fed back on retry. */
export function validate(obj, topic, lang = 'en', opts = {}) {
  const err = (m) => { throw new Error(m); };
  if (!obj || typeof obj !== 'object') err('not a JSON object');

  const hook = cleanSpoken(obj.hook || '');
  if (!hook) err('hook is empty');
  if (wordsOf(hook).length > 12) err(`hook is ${wordsOf(hook).length} words, max 12`);

  if (!Array.isArray(obj.beats)) err('beats is not an array');
  if (obj.beats.length < 9 || obj.beats.length > 15) {
    err(`beats has ${obj.beats.length} entries, need 10 to 14`);
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
    if (hashtags.length >= 12) break;
    if (!hashtags.includes(fill)) hashtags.push(fill);
  }
  hashtags = hashtags.slice(0, 12);

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
  const WPS = 3.1;
  const LOW = 330, HIGH = 470;          // what we ask for
  const HARD_LOW = 280, HARD_HIGH = 540; // what we will still ship
  const secs = (n) => (n / WPS).toFixed(0);
  // Telling the model "use 350 to 470 words" after it wrote 490 is weak
  // feedback: it swings to the other side and fails again. Give it the delta.
  if (lenient && spokenWords >= HARD_LOW && spokenWords <= HARD_HIGH) {
    if (spokenWords < LOW || spokenWords > HIGH) {
      (opts.log || (() => {}))(`  script length ${spokenWords} words (~${secs(spokenWords)}s) is outside ` +
        `${LOW}-${HIGH} but inside tolerance; shipping it rather than losing the reel`);
    }
  } else if (spokenWords > HIGH) {
    const cut = spokenWords - 430;
    err(`script is ${spokenWords} spoken words, about ${secs(spokenWords)}s, which is ${spokenWords - HIGH} over the limit. ` +
        `Remove about ${cut} words to land near 430. Shorten the wordiest beats; ` +
        'do not drop the analogy beat and do not reduce the number of beats.');
  }
  if (spokenWords < LOW) {
    const add = 430 - spokenWords;
    err(`script is only ${spokenWords} spoken words, about ${secs(spokenWords)}s, which is ${LOW - spokenWords} under the minimum. ` +
        `Add about ${add} words to land near 430, as ${Math.max(1, Math.round(add / 35))} more beat(s) ` +
        'of one component each rather than padding the beats you have.');
  }

  return {
    topic,
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
export async function writeScript(topic, opts = {}) {
  const model = opts.model || CONFIG.model;
  const lang = opts.lang || CONFIG.lang || 'en';
  const log = opts.log || (() => {});
  const base =
    `Topic for this reel: "${topic}"\n\n` +
    'Write the reel now. Obey the format contract exactly. ' +
    'Return only the JSON object.' +
    (LANG_RULES[lang] || '');

  // Two attempts was too few. The length constraint is the one the model is
  // worst at, and it tends to overshoot in the opposite direction on the
  // retry: a real run went 325 words, then 490, then died with nothing.
  const ATTEMPTS = 4;
  let lastErr = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const prompt = attempt === 1
      ? base
      : `${base}\n\nYour previous attempt was rejected: ${lastErr}\nFix exactly that and return the corrected JSON object.`;
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
      const script = validate(parsed, topic, lang, { lenientLength: attempt === ATTEMPTS, log });
      log(`  script ok on attempt ${attempt}: ${script.beats.length} beats, slug ${script.slug}`);
      return script;
    } catch (e) {
      lastErr = e.message;
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
