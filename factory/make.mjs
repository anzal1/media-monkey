#!/usr/bin/env node
// The orchestrator. topic -> script -> tts -> assemble -> out/<date>/<slug>/.
//
//   node factory/make.mjs "why your brain cant ignore a loading spinner"
//   node factory/make.mjs --auto                 # topics.mjs picks
//   node factory/make.mjs --auto --batch 3       # three different topics
//   node factory/make.mjs "topic" --lang mix     # Hindi hook, English body
//
// Flags: --auto --batch N --lang en|hi|mix --voice <kokoro id> --no-live
//        --dry (script only, no render)
//        --fresh / --no-fresh (record a brand new seeded physics background for
//        this reel, instead of drawing from the pool; default "auto" = fresh
//        whenever the capture still fits the per-reel time budget)
//        --bg <name-or-tier> force the background:
//          --bg physics | harvested | publicDomain   a whole tier
//          --bg rings | plinko                       a generator page (fresh
//                                                    seed, or that page's
//                                                    pool files if it cannot)
//          --bg rings-s2 | nasa-GSFC...              one specific file

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeScript, segmentsOf, slugify } from './script.mjs';
import { synthSegments } from './tts.mjs';
import { assemble } from './assemble.mjs';
import { supplyTopics, appendHistory } from './topics.mjs';
import { writeDiagram } from './explainer/diagram.mjs';
import { renderExplainer } from './explainer/render.mjs';
import { probeSummary } from './ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));

function parseArgs(argv) {
  const a = {
    topics: [], batch: 1, auto: false, lang: CONFIG.lang,
    voice: null, live: true, dry: false, fresh: null, bg: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--auto') a.auto = true;
    else if (v === '--fresh') a.fresh = 'always';
    else if (v === '--no-fresh') a.fresh = 'never';
    else if (v === '--bg') a.bg = argv[++i];
    else if (v === '--format') a.format = argv[++i];
    else if (v === '--batch') a.batch = Math.max(1, Number(argv[++i]) || 1);
    else if (v === '--lang') a.lang = argv[++i];
    else if (v === '--voice') a.voice = argv[++i];
    else if (v === '--no-live') a.live = false;
    else if (v === '--dry') a.dry = true;
    else if (!v.startsWith('--')) a.topics.push(v);
  }
  if (!a.topics.length) a.auto = true;
  return a;
}

const log = (s) => console.log(s);

// --- background selection -------------------------------------------------
// config.background.tiers is the house mix (physics .5 / harvested .35 /
// publicDomain .15). The roll happens HERE, not inside assemble, because the
// physics tier has two ways to satisfy itself: record a brand new seed for this
// reel (preferred: no two posts ever share a background) or draw from the pool.
// Fresh capture is frame-stepped, so it costs real wall clock and is only taken
// when the whole reel still lands inside background.freshBudgetSeconds.

/**
 * The channel is 100% explainer: every reel draws the mechanism it is talking
 * about. The old brainrot path (physics loop + karaoke over it) is gone, so
 * --format brainrot will fail on a missing background, which is intentional.
 */
function resolveFormat(explicit) {
  return explicit || CONFIG.format || 'explainer';
}

async function makeOne(topicEntry, args, index, count) {
  const topic = topicEntry.topic;
  const t0 = Date.now();
  log(`\n[${index + 1}/${count}] ${topic}   (source: ${topicEntry.source || 'cli'})`);

  // One voice, two visual treatments: the persona and the topic depth are the
  // same either way, so the format is just how this mechanism is best shown.
  const format = resolveFormat(args.format);
  log(`  format: ${format}`);

  const script = await writeScript(topic, { lang: args.lang, log });
  const segments0 = segmentsOf(script);
  if (args.dry) {
    log(JSON.stringify(script, null, 2));
    return { script, dry: true };
  }

  // local date, not UTC: the owner posts by their calendar day
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let slug = script.slug || slugify(topic);
  let outDir = path.join(ROOT, 'out', date, slug);
  let n = 2;
  while (fs.existsSync(path.join(outDir, 'reel.mp4'))) {
    outDir = path.join(ROOT, 'out', date, `${slug}-${n++}`);
  }
  slug = path.basename(outDir);

  const segments = await synthSegments(segments0, path.join(outDir, 'segments'), {
    voice: args.voice || CONFIG.voice,
    log,
  });

  let bg;
  {
    // The scene IS the content here, so it replaces the background entirely and
    // is timed to the narration rather than looped under it.
    const diagram = await writeDiagram(topic, script, { log });
    bg = await renderExplainer({
      diagram,
      segments,
      outFile: path.join(outDir, 'scene.mp4'),
      episode: 'THE PROD MONKEY',
      log,
    });
    fs.writeFileSync(path.join(outDir, 'diagram.json'), JSON.stringify(diagram, null, 2));
  }

  const isExplainer = format === 'explainer';
  const res = await assemble({
    script,
    segments,
    outDir,
    bg,
    // the light scene needs dark words in a bar, not white words with a black rim
    subtitle: isExplainer ? CONFIG.explainerSubtitle : undefined,
    grade: isExplainer ? false : undefined,
    log,
  });

  const probe = probeSummary(res.video);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  if (!v || !a) throw new Error('rendered reel is missing a video or audio stream');
  if (v.width !== CONFIG.video.width || v.height !== CONFIG.video.height) {
    throw new Error(`rendered reel is ${v.width}x${v.height}, expected 1080x1920`);
  }

  appendHistory({ slug, topic, source: topicEntry.source || 'cli', category: topicEntry.category || null, lang: args.lang });

  const secs = (Date.now() - t0) / 1000;
  log(`  OK ${path.relative(ROOT, res.video)}`);
  log(`     ${v.codec_name} ${v.width}x${v.height} @${v.r_frame_rate} ${v.pix_fmt} + ${a.codec_name} ${a.sample_rate}Hz x${a.channels}, ${Number(probe.format.duration).toFixed(2)}s, ${(Number(probe.format.size) / 1e6).toFixed(1)} MB`);
  log(`     rendered in ${secs.toFixed(1)}s (${(secs / 60).toFixed(2)} min)`);
  return { script, ...res, probe, seconds: secs, outDir };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  let entries;
  if (args.auto) {
    const { topics, notes } = await supplyTopics(args.batch, {
      log, useGoogleSearch: args.live && CONFIG.topics.useGoogleSearch,
    });
    notes.forEach((nt) => log(`topics: ${nt}`));
    entries = topics;
  } else {
    // explicit topics first; a larger --batch is topped up from the supply
    entries = args.topics.slice(0, args.batch).map((t) => ({ topic: t, source: 'cli' }));
    if (entries.length < args.batch) {
      const { topics } = await supplyTopics(args.batch - entries.length, { log });
      entries.push(...topics);
    }
  }
  if (!entries.length) throw new Error('no topics to render');

  const done = [];
  const failed = [];
  for (let i = 0; i < entries.length; i++) {
    try {
      done.push(await makeOne(entries[i], args, i, entries.length));
    } catch (e) {
      failed.push({ topic: entries[i].topic, error: e.message });
      log(`  FAILED: ${e.message}`);
    }
  }

  const total = (Date.now() - started) / 1000;
  log(`\n${done.length}/${entries.length} reels in ${(total / 60).toFixed(2)} min` +
      (done.length ? ` (${(total / 60 / done.length).toFixed(2)} min each)` : ''));
  for (const d of done) if (!d.dry) log(`  ${path.relative(ROOT, d.video)}`);
  for (const f of failed) log(`  failed: ${f.topic} :: ${f.error}`);
  if (!done.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nfatal: ${e.message}`);
  process.exitCode = 1;
});
