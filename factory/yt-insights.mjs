/*
 * yt-insights.mjs — why YouTube is not distributing the Shorts.
 *
 * Instagram gives these reels about 100x the views YouTube does, from the same
 * file. This separates the two possible causes: YouTube not showing them
 * (low views, traffic not from the Shorts feed) versus showing them and people
 * swiping away (decent views, very low average view percentage).
 *
 *   YT_CLIENT_ID=.. YT_CLIENT_SECRET=.. YT_REFRESH_TOKEN=.. node factory/yt-insights.mjs
 * Needs a refresh token minted with the analytics scope (youtube-auth.mjs).
 */
const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) { console.error('YT_* env missing'); process.exit(2); }

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
})).json();
if (!tok.access_token) { console.error('token refresh failed', tok); process.exit(1); }
const H = { authorization: `Bearer ${tok.access_token}` };
const today = new Date().toISOString().slice(0, 10);
const since = process.argv[2] || '2026-09-15';

async function report(params) {
  const q = new URLSearchParams({ ids: 'channel==MINE', startDate: since, endDate: today, ...params });
  const j = await (await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { headers: H })).json();
  if (j.error) throw new Error(j.error.message + (j.error.message.includes('scope') ? ' (re-run youtube-auth.mjs to add the analytics scope)' : ''));
  return j;
}
const table = (j) => (j.rows || []).map((r) => Object.fromEntries(j.columnHeaders.map((h, i) => [h.name, r[i]])));

const total = table(await report({ metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained' }))[0] || {};
console.log('channel since', since, JSON.stringify(total));
console.log('\ntraffic sources:');
for (const r of table(await report({ metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' }))) console.log(`  ${r.insightTrafficSourceType.padEnd(22)} ${r.views}`);
console.log('\ntop videos:');
for (const r of table(await report({ metrics: 'views,averageViewDuration,averageViewPercentage', dimensions: 'video', sort: '-views', maxResults: '15' }))) {
  console.log(`  ${r.video}  ${String(r.views).padStart(5)} views  ${String(r.averageViewDuration).padStart(4)}s avg  ${r.averageViewPercentage.toFixed(0)}% watched`);
}
