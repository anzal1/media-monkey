// Harvester for license-safe retention footage: the "oddly satisfying" genre
// that holds a viewer through a 40 second voiceover.
//
// LOCAL ONLY. The Pexels tier drives Chromium, and yt-dlp is a local install.
// The harvested mp4s are what matter and they are ingested into assets/clips,
// so a CI runner never runs this file.
//
// Tiers, best first:
//   pexels-web  Keyless. Search and video pages 403 a plain fetch but were
//               readable in a real browser, and the direct file URL leaks
//               through the Canva partner link on each video page
//               (a[href*="file-url="]). videos.pexels.com itself is NOT
//               bot-walled, so the download is a plain stream. Pexels License:
//               free commercial use, no attribution required.
//               STATUS: as of this build the search page answers automation
//               with a Cloudflare interstitial (403, "Just a moment..."). We do
//               not try to defeat bot detection, so this route is dead until
//               PEXELS_API_KEY is set, which switches to the official API
//               below with no other change.
//   pexels-api  Same source, used instead of the browser when PEXELS_API_KEY is set.
//   pixabay     Only when PIXABAY_API_KEY is set. Pixabay Content License.
//   youtube-cc  Only when YOUTUBE_API_KEY is set. search videoLicense=
//               creativeCommon + videoDefinition=high, then videos.list
//               part=status to CONFIRM license === 'creativeCommon', because
//               the search filter alone has been known to lie. Downloads with
//               yt-dlp. Requires attribution, which assemble.mjs puts on the post.
//               STATUS: YouTube serves this machine format 18 (360x640) and
//               nothing else. Every adaptive 1080p format needs a GVS PO token
//               or account cookies, so the tier finds legitimate CC candidates
//               and cannot download any of them at reel resolution. They are
//               banked in assets/clips/queue.json with the blocking reason, and
//               the tier disables itself for the rest of the run instead of
//               retrying a dozen times. Nothing here is 360p-upscaled: that
//               would look worse than no clip at all.
//   nasa / ia   Keyless public domain, as before.
//
// Hard line: stock APIs and the YouTube CC filter only. No meme compilations,
// no show or game footage, and reuploader channels that launder other people's
// work under a CC flag are scored down hard.
//
// Usage:
//   node factory/clips.mjs --harvest 10     # rotate the genre queries, fill the bank
//   node factory/clips.mjs --ingest         # pull in assets/clips/manual/
//   node factory/clips.mjs "ink in water" --count 2
//   node factory/clips.mjs --list
//   node factory/clips.mjs --prune [--dry]  # re-screen the bank, drop failures

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ffmpegPath, probeSummary } from './ffmpeg.mjs';
import { loadEnv } from './llm.mjs';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIPS_DIR = path.join(HERE, '..', 'assets', 'clips');
const MANUAL_DIR = path.join(CLIPS_DIR, 'manual');
const SOURCES = path.join(CLIPS_DIR, 'sources.json');
const QUEUE = path.join(CLIPS_DIR, 'queue.json');

// The genre. Motion-heavy by construction, which is why v1 needs no motion
// analysis: a hydraulic press clip is never a static shot.
const SATISFYING = [
  'hydraulic press crushing',
  'kinetic sand cutting',
  'marble run',
  'dominoes falling',
  'pressure washing',
  'soap cutting',
  'ink in water',
  'macro honey pouring',
  'cnc machining',
  'paint mixing',
  'glass blowing',
];

// Raw b-roll phrasing on purpose. Asking NASA for "nebula telescope" returns
// produced highlight packages with titles burned into the picture; asking for
// the thing itself returns the footage those packages were cut from.
const PUBLIC_DOMAIN_QUERIES = [
  'earth from orbit',
  'aurora from the space station',
  'lava flow aerial',
  'hurricane from space',
  'plasma sun closeup',
];

const IA_COLLECTIONS = ['prelinger', 'prelingerhomemovies', 'nasa', 'usgovfilms', 'FedFlix'];

const PEXELS_LICENSE = 'Pexels License (free commercial use, no attribution required)';

// --- store ---------------------------------------------------------------

function readJson(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
}
function readSources() { return readJson(SOURCES, []); }
function writeSources(rows) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  fs.writeFileSync(SOURCES, JSON.stringify(rows, null, 2), 'utf8');
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 90)}`);
  return res.json();
}

async function download(url, dest, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200000) throw new Error(`file too small (${buf.length}b), probably not video`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function ytDlpPath() {
  const candidates = [];
  const pyBin = path.join(os.homedir(), 'Library', 'Python');
  if (fs.existsSync(pyBin)) {
    for (const v of fs.readdirSync(pyBin)) candidates.push(path.join(pyBin, v, 'bin', 'yt-dlp'));
  }
  candidates.push(
    '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
  );
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// --- scoring -------------------------------------------------------------

const LAUNDERING = /(compilation|best of|top \d|#shorts|satisfying videos|no copyright|free to use|copyright free)/i;
const GENERIC_CHANNEL = /^(satisfying|relax|asmr|shorts|viral|daily|amazing|top)\b/i;
// Produced packages (agency highlight reels, mission briefings) carry burned-in
// titles and lower thirds that fight our captions. screenClip() catches them
// after the download; this catches most of them before paying for it.
const PRODUCED = /(official|highlight|briefing|explained|what'?s up|news|episode|interview|press conference|trailer|recap|documentary)/i;

/**
 * Cheap pre-download filter. Vertical or croppable-to-vertical, at least 1080
 * on the short edge, 15 to 90 seconds, and not obviously a reuploader.
 */
export function score(c) {
  let s = 0;
  const { width: w, height: h, duration: d } = c;
  if (h && w) {
    if (h > w) s += 3;                              // already vertical
    else if (h >= 1080) s += 2;                     // crops to vertical cleanly
    else if (h >= 720) s += 0.5;
    if (Math.max(w, h) >= 1920) s += 1;
  } else {
    s += 1;                                         // unknown, give it a chance
  }
  if (d) {
    if (d >= 15 && d <= 90) s += 2;
    else if (d > 90 && d <= 240) s += 0.5;
    else if (d < 8) s -= 2;
  }
  if (c.title && LAUNDERING.test(c.title)) s -= 4;
  if (c.title && PRODUCED.test(c.title)) s -= 3;
  if (c.channel && (LAUNDERING.test(c.channel) || GENERIC_CHANNEL.test(c.channel))) s -= 3;
  return s;
}

// --- pexels via browser (keyless, primary) -------------------------------

/** hd_1920_1080_30fps / hd_1080_1920_25fps -> { width, height } */
function dimsFromPexelsUrl(u) {
  const m = /_(\d{3,4})_(\d{3,4})_(\d{1,3})fps/.exec(u);
  if (!m) return {};
  return { width: Number(m[1]), height: Number(m[2]), fps: Number(m[3]) };
}

export async function pexelsBrowser(query, limit, opts = {}) {
  const log = opts.log || (() => {});
  const { findChrome } = await import('./record-bg.mjs');
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: opts.chrome || findChrome(),
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  });
  const out = [];
  try {
    const page = await browser.newPage();
    const slug = query.trim().replace(/\s+/g, '%20');
    const resp = await page.goto(`https://www.pexels.com/search/videos/${slug}/`, {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 2500));

    // As of this build the search page answers automation with a Cloudflare
    // interstitial (HTTP 403, title "Just a moment..."). We do NOT try to defeat
    // it: no stealth plugin, no challenge solving, no UA laundering. Say so
    // plainly and let the caller fall through to a tier that is allowed to work.
    const status = resp?.status?.() ?? 0;
    const title = await page.title().catch(() => '');
    if (status === 403 || /just a moment|attention required|security verification/i.test(title)) {
      throw new Error(
        `PEXELS_BOT_WALL: search page returned ${status} "${title.trim()}". The keyless browser `
        + 'route is closed; put a free PEXELS_API_KEY in .env to use the official API path instead.',
      );
    }

    const links = await page.evaluate(() => [...new Set(
      [...document.querySelectorAll('a[href^="/video/"]')].map((a) => a.getAttribute('href')),
    )]);
    log(`    pexels: ${links.length} result links for "${query}"`);

    for (const href of links) {
      if (out.length >= limit) break;
      const pageUrl = `https://www.pexels.com${href}`;
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise((r) => setTimeout(r, 900));
        const found = await page.evaluate(() => {
          const res = { partner: null, sources: [] };
          const a = document.querySelector('a[href*="file-url="]');
          if (a) {
            try {
              const u = new URL(a.href, location.origin);
              res.partner = u.searchParams.get('file-url');
            } catch { /* ignore */ }
          }
          res.sources = [...document.querySelectorAll('video source, video')]
            .map((v) => v.getAttribute('src')).filter(Boolean);
          return res;
        });
        const urls = [];
        if (found.partner) urls.push(decodeURIComponent(found.partner));
        for (const s of found.sources) if (/videos\.pexels\.com/.test(s)) urls.push(s);
        if (!urls.length) continue;

        // prefer uhd, then a natively vertical render, then whatever we have
        const pick = urls.find((u) => /-uhd_/.test(u))
          || urls.find((u) => { const d = dimsFromPexelsUrl(u); return d.height > d.width; })
          || urls[0];
        const id = (/\/video\/[^/]*-(\d+)\/?$/.exec(href) || [])[1] || String(out.length);
        out.push({
          id: `pexels-${id}`,
          url: pick.split('?')[0],
          title: (href.split('/')[2] || 'pexels video').replace(/-\d+$/, '').replace(/-/g, ' '),
          origin: 'Pexels',
          page: pageUrl,
          license: PEXELS_LICENSE,
          attribution: null,
          tier: 'harvested',
          ...dimsFromPexelsUrl(pick),
        });
      } catch (e) {
        log(`    pexels page skipped: ${e.message.slice(0, 70)}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

export async function pexelsApi(query, limit) {
  loadEnv();
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${limit}`;
  const data = await getJson(url, { Authorization: key });
  return (data.videos || []).map((v) => {
    const f = (v.video_files || []).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    return f && {
      id: `pexels-${v.id}`,
      url: f.link,
      title: v.url,
      origin: `Pexels (${v.user?.name || 'unknown'})`,
      page: v.url,
      license: PEXELS_LICENSE,
      attribution: null,
      tier: 'harvested',
      width: f.width,
      height: f.height,
      duration: v.duration,
    };
  }).filter(Boolean);
}

export async function pixabayApi(query, limit) {
  loadEnv();
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const url = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=${Math.max(3, limit)}`;
  const data = await getJson(url);
  return (data.hits || []).map((h) => {
    const v = h.videos?.large || h.videos?.medium;
    return v && v.url && {
      id: `pixabay-${h.id}`,
      url: v.url,
      title: h.tags || `pixabay ${h.id}`,
      origin: `Pixabay (${h.user || 'unknown'})`,
      page: h.pageURL,
      license: 'Pixabay Content License (free commercial use, no attribution required)',
      attribution: null,
      tier: 'harvested',
      width: v.width,
      height: v.height,
      duration: h.duration,
    };
  }).filter(Boolean);
}

// --- youtube creative commons -------------------------------------------

function isoToSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

export async function youtubeCC(query, limit, opts = {}) {
  loadEnv();
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const log = opts.log || (() => {});
  const searchUrl = 'https://www.googleapis.com/youtube/v3/search'
    + `?part=snippet&type=video&maxResults=${Math.min(25, limit * 4)}`
    + '&videoLicense=creativeCommon&videoDefinition=high&videoEmbeddable=true'
    + `&q=${encodeURIComponent(query)}&key=${key}`;
  const search = await getJson(searchUrl);
  const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];

  // The search filter is not trustworthy on its own: confirm at video level.
  const detailUrl = 'https://www.googleapis.com/youtube/v3/videos'
    + `?part=status,contentDetails,snippet&id=${ids.join(',')}&key=${key}`;
  const detail = await getJson(detailUrl);
  const out = [];
  for (const v of detail.items || []) {
    if (v.status?.license !== 'creativeCommon') {
      log(`    youtube: ${v.id} claimed CC in search but is ${v.status?.license}, dropped`);
      continue;
    }
    const dur = isoToSeconds(v.contentDetails?.duration);
    out.push({
      id: `yt-${v.id}`,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.snippet?.title || v.id,
      channel: v.snippet?.channelTitle || '',
      origin: `YouTube CC BY (${v.snippet?.channelTitle || 'unknown'})`,
      page: `https://www.youtube.com/watch?v=${v.id}`,
      license: 'Creative Commons Attribution (CC BY 3.0), verified via videos.list status.license',
      attribution: `${v.snippet?.channelTitle || 'unknown'} (CC BY)`,
      tier: 'harvested',
      needsYtDlp: true,
      duration: dur,
      height: 1080,
      width: 1920,
    });
  }
  return out;
}

// --- public domain -------------------------------------------------------

async function nasaCandidates(query, limit) {
  const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=video&page_size=25`;
  const data = await getJson(url);
  const items = (data?.collection?.items || []).slice(0, limit * 3);
  const out = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const meta = it.data?.[0] || {};
    if (!it.href) continue;
    try {
      const assets = await getJson(it.href);
      const mp4s = assets.filter((a) => a.endsWith('.mp4') && !/preview\.mp4$/.test(a));
      const pick = mp4s.find((a) => /~medium\.mp4$/.test(a))
        || mp4s.find((a) => /~small\.mp4$/.test(a))
        || mp4s.find((a) => /~mobile\.mp4$/.test(a))
        || mp4s[0];
      if (!pick) continue;
      out.push({
        id: `nasa-${(meta.nasa_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
        url: pick.replace(/^http:/, 'https:'),
        title: meta.title || meta.nasa_id || 'NASA video',
        origin: 'NASA images API',
        page: `https://images.nasa.gov/details/${meta.nasa_id}`,
        license: 'NASA media usage guidelines: generally not copyrighted, free to use',
        attribution: null,
        tier: 'publicDomain',
      });
    } catch { /* skip */ }
  }
  return out;
}

async function iaCandidates(query, limit) {
  const collections = IA_COLLECTIONS.slice();
  if (process.env.MEDIAMONKEY_ALLOW_CARTOONS === '1') collections.push('classic_cartoons');
  const q = `(${collections.map((c) => `collection:${c}`).join(' OR ')}) AND mediatype:movies AND ${JSON.stringify(query)}`;
  const url = 'https://archive.org/advancedsearch.php'
    + `?q=${encodeURIComponent(q)}`
    + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=collection'
    + `&rows=${limit * 4}&page=1&output=json`;
  const data = await getJson(url);
  const out = [];
  for (const d of data?.response?.docs || []) {
    if (out.length >= limit) break;
    try {
      const meta = await getJson(`https://archive.org/metadata/${d.identifier}`);
      const mp4 = (meta.files || []).find((f) => /\.mp4$/i.test(f.name) && Number(f.size) > 1e6);
      if (!mp4) continue;
      out.push({
        id: `ia-${String(d.identifier).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
        url: `https://archive.org/download/${d.identifier}/${encodeURIComponent(mp4.name)}`,
        title: d.title || d.identifier,
        origin: `Internet Archive (${[].concat(d.collection || []).join(', ')})`,
        page: `https://archive.org/details/${d.identifier}`,
        license: d.licenseurl || 'public domain collection (Prelinger / US government)',
        attribution: null,
        tier: 'publicDomain',
      });
    } catch { /* skip */ }
  }
  return out;
}

// --- ingest --------------------------------------------------------------

async function normalize(src, dest, seconds = 60) {
  await execFileP(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', src,
    '-t', String(seconds),
    '-an',
    '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    dest,
  ], { maxBuffer: 1 << 24 });
}

// --- screening -----------------------------------------------------------
//
// score() judges a candidate from its metadata, which cannot see what is
// actually ON the footage. Three things get through it and ruin a reel, and all
// three showed up in the first live harvest:
//   1. produced NASA packages with burned-in titles and subtitle bars, which
//      collide with our own karaoke captions,
//   2. beautiful but DEAD footage (a black starfield that barely moves),
//   3. tiny sources (352x240) upscaled to 1080x1920 into a block of mush.
// So every clip is measured after normalize and has to earn its place.
//
// KNOWN GAP: the burned-in-graphics test keys on text holding still while the
// picture moves, so an ANIMATED title card (one that slides or fades in) reads
// as texture and gets through. One NASA explainer did exactly that and was
// pulled by hand. Give new publicDomain clips one look before a batch:
//   ffmpeg -ss 18 -i assets/clips/<file> -frames:v 1 /tmp/x.png
const SCREEN = {
  minSourceEdge: 540,   // short edge of the ORIGINAL, before any upscale
  minLuma: 45,          // assemble darkens by 0.10 on top of this
  minMotion: 1.5,       // mean frame-to-frame difference
  maxStaticEdge: 1.25,  // edge energy that does NOT move == text or a logo
  edgeFloor: 0.5,       // below this there are no edges worth judging
};

/** Mean of signalstats YAVG over a sampled window, for one filter chain. */
async function meanYAVG(file, chain, o = {}) {
  const { stdout } = await execFileP(ffmpegPath(), [
    '-v', 'error', '-ss', String(o.ss ?? 3), '-t', String(o.t ?? 20), '-i', file,
    '-vf', `${chain},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    '-f', 'null', '-',
  ], { maxBuffer: 1 << 24 });
  const vals = [...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Is this normalized clip usable as a caption background?
 * @returns {Promise<{ok:boolean, why?:string, luma:number, motion:number, staticEdge:number}>}
 */
export async function screenClip(file) {
  // the lower third is where lower-thirds live, hence the name
  const lower = 'crop=iw:ih/3:0:ih*2/3,edgedetect=low=0.1:high=0.3';
  const [luma, motion, edge, edgeMotion] = await Promise.all([
    meanYAVG(file, 'fps=2'),
    meanYAVG(file, 'fps=4,tblend=all_mode=difference'),
    meanYAVG(file, `fps=2,${lower}`),
    meanYAVG(file, `fps=2,${lower},tblend=all_mode=difference`),
  ]);
  // Text sits still while the picture moves, so strong edges with weak edge
  // MOTION is the signature of burned-in graphics. Strong edges that move with
  // the frame are just texture (ink, glitter, terrain) and are welcome.
  const staticEdge = edge == null ? 0 : edge / ((edgeMotion ?? 0) + 0.01);
  const m = {
    luma: +(luma ?? 0).toFixed(1),
    motion: +(motion ?? 0).toFixed(2),
    staticEdge: +staticEdge.toFixed(2),
  };
  if (luma != null && luma < SCREEN.minLuma) {
    return { ok: false, why: `too dark to read captions over (luma ${m.luma})`, ...m };
  }
  if (motion != null && motion < SCREEN.minMotion) {
    return { ok: false, why: `barely moves (motion ${m.motion})`, ...m };
  }
  if ((edge ?? 0) > SCREEN.edgeFloor && staticEdge > SCREEN.maxStaticEdge) {
    return { ok: false, why: `burned-in titles or subtitles (static edge ${m.staticEdge})`, ...m };
  }
  return { ok: true, ...m };
}

/** Pull assets/clips/manual/*.mp4 (hand-picked) into the bank. */
export async function ingestManual(opts = {}) {
  const log = opts.log || console.log;
  if (!fs.existsSync(MANUAL_DIR)) { log('  no assets/clips/manual, nothing to ingest'); return []; }
  const meta = readJson(path.join(MANUAL_DIR, 'sources-manual.json'), []);
  const byFile = new Map(meta.map((m) => [m.file, m]));
  const rows = readSources();
  const have = new Set(rows.map((r) => r.id));
  const added = [];

  for (const f of fs.readdirSync(MANUAL_DIR)) {
    if (!f.endsWith('.mp4')) continue;
    const id = `manual-${f.replace(/\.mp4$/, '')}`;
    if (have.has(id)) continue;
    const m = byFile.get(f) || {};
    const dest = path.join(CLIPS_DIR, `${id}.mp4`);
    try {
      await normalize(path.join(MANUAL_DIR, f), dest, opts.seconds ?? 60);
      // hand-picked still gets measured: the same gate, so the bank has one
      // standard and sources.json records why every clip is in it
      const screen = await screenClip(dest);
      if (!screen.ok) throw new Error(`screened out: ${screen.why}`);
      const row = {
        id,
        file: path.basename(dest),
        title: f.replace(/\.mp4$/, '').replace(/-/g, ' '),
        origin: m.origin || 'hand-picked',
        sourceUrl: m.origin || null,
        license: m.license || 'unknown, hand-picked',
        attribution: m.attribution ?? null,
        tier: 'harvested',
        query: 'manual',
        screen: { luma: screen.luma, motion: screen.motion, staticEdge: screen.staticEdge },
        fetchedAt: new Date().toISOString(),
      };
      rows.push(row); added.push(row); have.add(id);
      writeSources(rows);
      log(`  ingested ${f} -> ${row.file}`);
    } catch (e) {
      log(`  ingest failed for ${f}: ${e.message}`);
      if (fs.existsSync(dest)) { try { fs.unlinkSync(dest); } catch {} }
    }
  }
  return added;
}

// --- the harvest ---------------------------------------------------------

// yt-dlp's own diagnosis of why a YouTube pull produced nothing usable. All of
// these mean the same thing in practice: without a PO token or account cookies
// YouTube serves this machine format 18 (360x640) and nothing else, which is
// useless for a 1080x1920 reel.
const YT_WALL = /PO Token|SABR|page needs to be reloaded|Requested format is not available|Sign in to confirm/i;

function runYtDlp(bin, args) {
  return new Promise((res) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, err }));
    p.on('error', (e) => res({ code: -1, err: e.message }));
  });
}

/**
 * Reject a source too small to fill a 1080x1920 frame. Cropping landscape to
 * vertical already costs a 1.78x upscale, so a 352x240 archive reel arrives as
 * a block of mush no matter how good the subject is.
 */
function checkSource(file) {
  const v = probeSummary(file).streams.find((s) => s.codec_type === 'video');
  const short = Math.min(v?.width || 0, v?.height || 0);
  if (short < SCREEN.minSourceEdge) {
    throw new Error(`source is ${v?.width}x${v?.height}, too small to fill 1080x1920`);
  }
}

async function fetchOne(c, opts, log) {
  const tmp = path.join(CLIPS_DIR, `.tmp-${c.id}`);
  const dest = path.join(CLIPS_DIR, `${c.id}.mp4`);
  try {
    if (c.needsYtDlp) {
      const bin = ytDlpPath();
      if (!bin) throw new Error('NO_DOWNLOADER');
      const base = [
        '-f', 'bv*[height>=1080]+ba/b', '--max-filesize', '200M',
        // a split bv+ba pick has to be muxed, and yt-dlp only finds ffmpeg on
        // PATH: point it at the same binary the rest of the factory resolved
        '--ffmpeg-location', ffmpegPath(),
        '--no-playlist', '--no-warnings', '-o', `${tmp}.%(ext)s`, c.url,
      ];
      // The default player client currently dies on "the page needs to be
      // reloaded"; dropping the tv client at least gets a real answer back.
      let r = await runYtDlp(bin, base);
      if (r.code !== 0) {
        r = await runYtDlp(bin, ['--extractor-args', 'youtube:player_client=default,-tv', ...base]);
      }
      if (r.code !== 0) {
        const line = (r.err.split('\n').filter((l) => /ERROR|WARNING/.test(l)).pop() || '')
          .replace(/\s+/g, ' ').trim();
        if (YT_WALL.test(r.err)) {
          throw new Error(`YOUTUBE_WALLED: ${line.slice(0, 160) || `yt-dlp exited ${r.code}`}`);
        }
        throw new Error(`yt-dlp exited ${r.code}: ${line.slice(0, 160)}`);
      }
      const produced = fs.readdirSync(CLIPS_DIR)
        .filter((f) => f.startsWith(`.tmp-${c.id}.`))
        .map((f) => path.join(CLIPS_DIR, f))[0];
      if (!produced) throw new Error('yt-dlp produced no file');
      checkSource(produced);
      await normalize(produced, dest, opts.seconds ?? 60);
      fs.unlinkSync(produced);
    } else {
      await download(c.url, tmp);
      checkSource(tmp);
      await normalize(tmp, dest, opts.seconds ?? 60);
      fs.unlinkSync(tmp);
    }
    const probe = probeSummary(dest);
    const v = probe.streams.find((s) => s.codec_type === 'video');
    if (!v || v.width !== 1080 || v.height !== 1920) {
      throw new Error(`normalized to ${v?.width}x${v?.height}, expected 1080x1920`);
    }
    const screen = await screenClip(dest);
    if (!screen.ok) throw new Error(`screened out: ${screen.why}`);
    log(`      screen ok: luma ${screen.luma}, motion ${screen.motion}, staticEdge ${screen.staticEdge}`);
    return {
      id: c.id,
      file: path.basename(dest),
      title: c.title,
      origin: c.origin,
      sourceUrl: c.page,
      downloadUrl: c.url,
      license: c.license,
      attribution: c.attribution ?? null,
      tier: c.tier || 'harvested',
      query: c.query,
      score: +score(c).toFixed(1),
      screen: { luma: screen.luma, motion: screen.motion, staticEdge: screen.staticEdge },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    for (const f of fs.readdirSync(CLIPS_DIR)) {
      if (f.startsWith(`.tmp-${c.id}`)) { try { fs.unlinkSync(path.join(CLIPS_DIR, f)); } catch {} }
    }
    if (fs.existsSync(dest)) { try { fs.unlinkSync(dest); } catch {} }
    throw e;
  }
}

/**
 * @param {object} o { count, queries, log }
 * @returns {Promise<{added:Array, perSource:object, queued:Array}>}
 */
export async function harvest(o = {}) {
  const log = o.log || console.log;
  const want = o.count ?? 10;
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  loadEnv();

  const rows = readSources();
  const have = new Set(rows.map((r) => r.id));
  const added = [];
  const queued = readJson(QUEUE, []);
  const perSource = {};
  const bump = (k) => { perSource[k] = (perSource[k] || 0) + 1; };

  // rotate the genre so repeat runs do not re-mine one query
  const start = rows.length % SATISFYING.length;
  const queries = o.queries?.length
    ? o.queries
    : [...SATISFYING.slice(start), ...SATISFYING.slice(0, start)];

  const hasPexelsKey = !!process.env.PEXELS_API_KEY;
  // A source that is walled is walled for the whole run: record it the first
  // time and stop paying for the retry on every remaining query (a browser
  // launch or a dozen yt-dlp round trips each).
  const blocked = {};

  for (const query of queries) {
    if (added.length >= want) break;
    log(`  query "${query}"`);
    let cands = [];

    const sources = [
      ['pexels', () => (hasPexelsKey ? pexelsApi(query, 4) : pexelsBrowser(query, 3, { log }))],
      ['pixabay', () => pixabayApi(query, 3)],
      ['youtube', () => youtubeCC(query, 3, { log })],
    ];
    for (const [name, fn] of sources) {
      if (blocked[name]) continue;
      try {
        const got = await fn();
        if (got.length) log(`    ${name}: ${got.length} candidates`);
        cands = cands.concat(got.map((c) => ({ ...c, query })));
      } catch (e) {
        log(`    ${name} failed: ${e.message.slice(0, 140)}`);
        if (/^PEXELS_BOT_WALL/.test(e.message)) {
          blocked[name] = e.message;
          log(`    ${name}: blocked for the rest of this run`);
        }
      }
    }

    cands = cands
      .filter((c) => !have.has(c.id))
      .map((c) => ({ ...c, _score: score(c) }))
      .sort((a, b) => b._score - a._score);

    let taken = 0;
    for (const c of cands) {
      if (added.length >= want || taken >= (o.perQuery ?? 2)) break;
      if (c._score < 0) { log(`    skipped ${c.id} (score ${c._score}, looks like a reupload)`); continue; }
      if (c.needsYtDlp && blocked.youtube) continue;
      try {
        log(`    fetching ${c.id} (${c.origin}, score ${c._score.toFixed(1)})`);
        const row = await fetchOne(c, o, log);
        rows.push(row); added.push(row); have.add(c.id);
        bump(c.id.split('-')[0]);
        writeSources(rows);
        taken++;
        log(`      ok -> assets/clips/${row.file}`);
      } catch (e) {
        if (e.message === 'NO_DOWNLOADER') {
          // no yt-dlp: bank the URL instead of failing the run
          queued.push({ ...c, queuedAt: new Date().toISOString() });
          fs.writeFileSync(QUEUE, JSON.stringify(queued, null, 2), 'utf8');
          log('      no downloader on PATH, queued to assets/clips/queue.json');
        } else if (/^YOUTUBE_WALLED/.test(e.message)) {
          // YouTube is serving this machine 360p only. The CC candidates are
          // still legitimate, so bank them for a later run on a box that can
          // actually pull 1080, and stop hammering the tier now.
          blocked.youtube = e.message;
          queued.push({ ...c, blocked: e.message, queuedAt: new Date().toISOString() });
          fs.writeFileSync(QUEUE, JSON.stringify(queued, null, 2), 'utf8');
          log(`      ${e.message.slice(0, 150)}`);
          log('      youtube: blocked for the rest of this run, candidate queued');
        } else {
          log(`      skipped: ${e.message.slice(0, 110)}`);
        }
      }
    }
  }

  // top up with public domain if the harvested tiers came up short
  if (added.length < want) {
    for (const query of PUBLIC_DOMAIN_QUERIES) {
      if (added.length >= want) break;
      let cands = [];
      for (const [name, fn] of [['nasa', nasaCandidates], ['ia', iaCandidates]]) {
        try { cands = cands.concat((await fn(query, 2)).map((c) => ({ ...c, query }))); }
        catch (e) { log(`    ${name} failed: ${e.message.slice(0, 80)}`); }
      }
      // same ranking as the harvested tier: produced packages last, and a
      // title that reads like a highlight reel is not worth the download
      cands = cands
        .filter((c) => !have.has(c.id))
        .map((c) => ({ ...c, _score: score(c) }))
        .sort((a, b) => b._score - a._score);
      for (const c of cands) {
        if (added.length >= want) break;
        if (c._score < 0) { log(`    skipped ${c.id} (score ${c._score}, reads like a produced package)`); continue; }
        try {
          log(`    fetching ${c.id} (${c.origin}, score ${c._score.toFixed(1)})`);
          const row = await fetchOne(c, o, log);
          rows.push(row); added.push(row); have.add(c.id);
          bump(c.id.split('-')[0]);
          writeSources(rows);
          log(`      ok -> assets/clips/${row.file}`);
        } catch (e) { log(`      skipped: ${e.message.slice(0, 110)}`); }
      }
    }
  }

  log(`  harvest: ${added.length} added, ${rows.length} in the bank`);
  for (const [name, why] of Object.entries(blocked)) log(`  blocked: ${name}: ${why.slice(0, 160)}`);
  return { added, perSource, queued, blocked };
}

/**
 * Re-screen everything already in the bank and drop what fails. Used after the
 * gate tightens, and as the cleanup for clips harvested before it existed.
 * @param {object} o { dryRun, log }
 */
export async function prune(o = {}) {
  const log = o.log || console.log;
  const rows = readSources();
  const kept = [];
  const dropped = [];
  for (const r of rows) {
    const file = path.join(CLIPS_DIR, r.file);
    if (!fs.existsSync(file)) { log(`  ${r.file}: missing, row dropped`); dropped.push({ ...r, why: 'file missing' }); continue; }
    const s = await screenClip(file);
    if (s.ok) {
      kept.push({ ...r, screen: { luma: s.luma, motion: s.motion, staticEdge: s.staticEdge } });
      log(`  keep  ${r.file}  luma ${s.luma} motion ${s.motion} staticEdge ${s.staticEdge}`);
    } else {
      dropped.push({ ...r, why: s.why });
      log(`  DROP  ${r.file}  ${s.why}`);
      if (!o.dryRun) { try { fs.unlinkSync(file); } catch { /* already gone */ } }
    }
  }
  if (!o.dryRun) writeSources(kept);
  log(`  prune: ${kept.length} kept, ${dropped.length} dropped${o.dryRun ? ' (dry run, nothing deleted)' : ''}`);
  return { kept, dropped };
}

export function clipsDir() { return CLIPS_DIR; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--list')) {
    const rows = readSources();
    for (const r of rows) {
      console.log(`${r.file}  [${r.tier}]\n  ${r.origin} | ${r.license}\n  ${r.sourceUrl || ''}` +
                  (r.attribution ? `\n  attribution: ${r.attribution}` : ''));
    }
    console.log(`${rows.length} clips`);
    process.exit(0);
  }
  if (argv.includes('--ingest')) { await ingestManual(); process.exit(0); }
  if (argv.includes('--prune')) {
    const { dropped } = await prune({ dryRun: argv.includes('--dry') });
    process.exit(dropped.length ? 0 : 0);
  }
  if (argv.includes('--harvest')) {
    await ingestManual();
    const { added, perSource, queued, blocked } = await harvest({ count: Number(flag('--harvest', 10)) });
    console.log(`per source: ${JSON.stringify(perSource)}`);
    console.log(`queued (undownloadable here): ${queued.length}`);
    for (const [name, why] of Object.entries(blocked || {})) console.log(`blocked ${name}: ${why}`);
    process.exit(added.length ? 0 : 1);
  }
  const perQuery = Number(flag('--count', 1));
  const valueFlags = new Set(['--count', '--harvest']);
  const queries = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
  await harvest({ queries, count: queries.length * perQuery, perQuery });
}
