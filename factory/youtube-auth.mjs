/*
 * youtube-auth.mjs — mint the one-time YouTube refresh token.
 *
 * Run this ONCE on a machine with a browser. It opens Google's consent screen,
 * catches the redirect on a loopback port, and prints the refresh token to put
 * in the repo secrets. After that CI uploads unattended forever.
 *
 *   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node factory/youtube-auth.mjs
 *
 * The OAuth client must be of type "Desktop app": Google accepts any
 * http://127.0.0.1:<port> redirect for that type without pre-registering it,
 * which is why this can pick a free port at runtime.
 *
 * One trap worth knowing: while the OAuth consent screen is in "Testing"
 * status, Google expires refresh tokens after SEVEN DAYS. Set the publishing
 * status to "In production" before running this, or CI will start failing a
 * week later for no visible reason. An unverified personal app can go to
 * production; it just shows a warning on the consent screen you click past.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('set YT_CLIENT_ID and YT_CLIENT_SECRET first');
  process.exit(2);
}

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

const server = http.createServer();
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const redirect = `http://127.0.0.1:${server.address().port}`;

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: redirect,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',        // without this there is no refresh token
  prompt: 'consent',             // force one even if this account consented before
});

console.log('\nOpen this if the browser does not:\n\n' + authUrl + '\n');
const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
spawn(open, [authUrl], { stdio: 'ignore', detached: true }).unref();

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for consent')), 5 * 60_000);
  server.on('request', (req, res) => {
    const u = new URL(req.url, redirect);
    const c = u.searchParams.get('code');
    const err = u.searchParams.get('error');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<body style="font:16px system-ui;padding:3rem">${c ? 'Done. Close this tab and go back to the terminal.' : 'Failed: ' + err}</body>`);
    clearTimeout(timer);
    server.close();
    c ? resolve(c) : reject(new Error(err || 'no code returned'));
  });
});

const r = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  }),
});
const j = await r.json();
if (!j.refresh_token) {
  console.error('no refresh token in the response:', JSON.stringify(j, null, 2));
  console.error('\nIf you see only an access_token, revoke this app at');
  console.error('https://myaccount.google.com/permissions and run this again.');
  process.exit(1);
}

console.log('\nYT_REFRESH_TOKEN=' + j.refresh_token);
console.log('\nAdd that as a repo secret alongside YT_CLIENT_ID and YT_CLIENT_SECRET.');
