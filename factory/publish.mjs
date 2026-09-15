/*
 * publish.mjs — Instagram Reels publisher via the OFFICIAL Graph API.
 *
 * Free and sanctioned: business/creator accounts publish reels through
 * graph.facebook.com content publishing. No passwords, no private API.
 *
 *   node factory/publish.mjs --video-url <public mp4 url> --caption-file <path>
 *
 * Env: IG_USER_ID (the Instagram professional account id),
 *      IG_ACCESS_TOKEN (long-lived page-linked token with
 *      instagram_content_publish permission).
 * Exits 0 with a notice when secrets are absent, so CI can run without them.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};

let IG_USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const videoUrl = arg('--video-url');
const captionFile = arg('--caption-file');

if (!videoUrl) {
  console.error('usage: publish.mjs --video-url <url> [--caption-file <path>]');
  process.exit(2);
}
if (!TOKEN) {
  console.log('publish: IG_ACCESS_TOKEN not set — skipping (reel stays unpublished).');
  process.exit(0);
}

const caption = captionFile ? readFileSync(captionFile, 'utf8').trim().slice(0, 2190) : '';

// Two API flavors: tokens from "API setup with Instagram login" (IGAA...) talk to
// graph.instagram.com and can self-resolve their user id; classic Facebook-login
// page tokens talk to graph.facebook.com and need IG_USER_ID.
const IG_LOGIN = TOKEN.startsWith('IG') || process.env.IG_API === 'instagram';
const G = IG_LOGIN ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';

async function gpost(path, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${G}/${path}`, { method: 'POST', body });
  const j = await r.json();
  if (j.error) throw new Error(path + ': ' + JSON.stringify(j.error));
  return j;
}

async function gget(path, params) {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${G}/${path}?${q}`);
  const j = await r.json();
  if (j.error) throw new Error(path + ': ' + JSON.stringify(j.error));
  return j;
}

if (!IG_USER_ID) {
  const me = await gget('me', { fields: 'user_id,username,id' });
  IG_USER_ID = me.user_id || me.id;
  console.log('resolved account:', me.username || '?', IG_USER_ID);
}

// Meta's transcode occasionally fails on a perfectly valid file (verified: the
// same URL that returned ERROR transcoded to FINISHED minutes later). So the
// whole create-and-poll cycle is retried before the run is called a failure.
const ATTEMPTS = 3;
let containerId = null;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  // 1. create the media container
  const container = await gpost(`${IG_USER_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: 'true',
  });
  console.log(`container (attempt ${attempt}/${ATTEMPTS}):`, container.id);

  // 2. poll until Meta finishes fetching/transcoding (up to ~5 min)
  let status = '';
  let detail = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await gget(container.id, { fields: 'status_code,status' });
    status = s.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') {
      detail = s;
      break;
    }
    if (i % 6 === 0) console.log('  status:', status);
  }

  if (status === 'FINISHED') {
    containerId = container.id;
    break;
  }

  const why = detail ? JSON.stringify(detail) : 'never finished (last: ' + status + ')';
  if (attempt === ATTEMPTS) throw new Error('container failed after ' + ATTEMPTS + ' attempts: ' + why);
  const backoff = 30 * attempt;
  console.log(`  transcode ${status}, retrying in ${backoff}s: ${why}`);
  await new Promise((r) => setTimeout(r, backoff * 1000));
}

// 3. publish
const pub = await gpost(`${IG_USER_ID}/media_publish`, { creation_id: containerId });
console.log('published media id:', pub.id);
