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

const IG_USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const videoUrl = arg('--video-url');
const captionFile = arg('--caption-file');

if (!videoUrl) {
  console.error('usage: publish.mjs --video-url <url> [--caption-file <path>]');
  process.exit(2);
}
if (!IG_USER_ID || !TOKEN) {
  console.log('publish: IG_USER_ID / IG_ACCESS_TOKEN not set — skipping (reel stays unpublished).');
  process.exit(0);
}

const caption = captionFile ? readFileSync(captionFile, 'utf8').trim().slice(0, 2190) : '';
const G = 'https://graph.facebook.com/v21.0';

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

// 1. create the media container
const container = await gpost(`${IG_USER_ID}/media`, {
  media_type: 'REELS',
  video_url: videoUrl,
  caption,
  share_to_feed: 'true',
});
console.log('container:', container.id);

// 2. poll until Meta finishes fetching/transcoding (up to ~5 min)
let status = '';
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await gget(container.id, { fields: 'status_code,status' });
  status = s.status_code;
  if (status === 'FINISHED') break;
  if (status === 'ERROR') throw new Error('container error: ' + JSON.stringify(s));
  if (i % 6 === 0) console.log('  status:', status);
}
if (status !== 'FINISHED') throw new Error('container never finished (last: ' + status + ')');

// 3. publish
const pub = await gpost(`${IG_USER_ID}/media_publish`, { creation_id: container.id });
console.log('published media id:', pub.id);
