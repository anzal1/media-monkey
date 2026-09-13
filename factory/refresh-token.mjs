/*
 * refresh-token.mjs — keeps the Instagram-login token immortal.
 *
 * Instagram-login tokens last ~60 days and can be refreshed any time after
 * they are 24h old; each refresh grants a fresh 60 days. Run weekly and the
 * token never expires.
 *
 * In CI, writing the new token back to the repo secret requires a fine-grained
 * PAT (secret GH_PAT with "secrets: write" on this repo) because the default
 * GITHUB_TOKEN cannot modify secrets. Without GH_PAT this script still
 * refreshes and then fails loudly so the run shows red instead of silently
 * letting the stored token age out.
 */
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.IG_ACCESS_TOKEN;
if (!TOKEN) {
  console.log('no IG_ACCESS_TOKEN — nothing to refresh');
  process.exit(0);
}

const r = await fetch(
  'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' +
    encodeURIComponent(TOKEN)
);
const j = await r.json();
if (!j.access_token) {
  console.error('refresh failed:', JSON.stringify(j).slice(0, 300));
  process.exit(1);
}
console.log('refreshed; expires_in days:', Math.round(j.expires_in / 86400));

if (process.env.GH_PAT && process.env.GITHUB_REPOSITORY) {
  execFileSync('gh', ['secret', 'set', 'IG_ACCESS_TOKEN', '-R', process.env.GITHUB_REPOSITORY], {
    input: j.access_token,
    env: { ...process.env, GH_TOKEN: process.env.GH_PAT },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('repo secret updated');
} else if (process.env.GITHUB_REPOSITORY) {
  console.error('refreshed OK but GH_PAT secret is missing, so the stored secret was NOT updated.');
  console.error('Create a fine-grained PAT (this repo, Secrets: read+write) and add it as GH_PAT.');
  process.exit(1);
} else {
  // local run: print nothing sensitive, just confirm
  console.log('local refresh OK (update .env manually if you want the new one locally)');
}
