'use strict';

/**
 * Checks whether the Studio works over BOTH http and https.
 *
 * The owner reports: "in the normal HTTP one it just won't open, and even the save
 * won't work, and online features just won't work". That is a big claim, and it is
 * testable - so this drives the Studio over plain http and over a server that
 * behaves like the https deployment (TLS terminated in front, forwarding
 * X-Forwarded-Proto), and compares.
 *
 * What it looks at, per scheme:
 *   - does /dev/:placeId/settings RENDER (not redirect away)?
 *   - are the absolute URLs the page hands the browser https when the site is https?
 *   - does the SAVE actually persist?
 *   - does the PUBLIC page then show the change?
 *   - are there mixed-content URLs (http:// on an https page)?
 *
 * Run: node tests/studio-http-https.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38471;
const PLACE_ID = 1818;

function req(pathName, { method = 'GET', body, headers = {}, host, proto } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers);
    if (host) h.host = host;
    if (proto) h['x-forwarded-proto'] = proto;
    if (body && !h['Content-Type']) h['Content-Type'] = 'application/x-www-form-urlencoded';

    const r = http.request(
      { hostname: '127.0.0.1', port: PORT, path: pathName, method, headers: h },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited early');
    try { await req('/health'); return; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server never became ready');
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

(async () => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-scheme-'));
  const hash = security.hashPassword('@pass@.lovely10');

  fs.writeFileSync(path.join(tempDataDir, 'users.json'), JSON.stringify({
    1: {
      userId: '1', username: 'tailsthehero10', displayName: 'tailsthehero10',
      password: hash.hash, passwordSalt: hash.salt, passwordVersion: hash.version,
      role: 'owner', membershipStatus: 'None', robux: 0,
      avatar: { bodyColors: { headColorId: 24, torsoColorId: 23 } },
      stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'games.json'), JSON.stringify({
    [String(PLACE_ID)]: {
      placeId: PLACE_ID, title: 'Scheme Probe', description: 'd',
      developer: 'LuckyBlox Studio', authorId: 1, author: 'tailsthehero10',
      icon: '/gameplaceholder/card.png', genre: 'Adventure',
      playerCount: 0, likes: 0, favorites: 0,
      activeServers: [], serverList: [], votes: { likes: 0, dislikes: 0 }, tags: [],
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'places.json'), '{}');

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: tempDataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('Studio over http and https\n');

    // A session, used for both schemes (the cookie is scheme-independent here
    // because TLS is terminated in front, which is the real Render setup).
    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    // --- Over plain HTTP ---------------------------------------------------
    console.log('  -- http --');
    const httpPage = await req(`/dev/game/${PLACE_ID}/settings`, {
      headers: { Cookie: cookie },
      host: `localhost:${PORT}`,
    });

    check('http: the Studio settings page renders (does not redirect away)', () => {
      assert.strictEqual(
        httpPage.statusCode, 200,
        `expected 200, got ${httpPage.statusCode}${httpPage.headers.location ? ' -> ' + httpPage.headers.location : ''}`,
      );
      assert.ok(/id="settingsForm"/.test(httpPage.body), 'the settings form is not in the response');
    });

    check('http: the page loads its assets over the same scheme (no broken mixed scheme)', () => {
      const httpsRefs = [...httpPage.body.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
      assert.deepStrictEqual(
        httpsRefs, [],
        `an http page must not reference https assets it may not be able to reach:\n       ${httpsRefs.join('\n       ')}`,
      );
    });

    // --- The same page, as the https deployment serves it ------------------
    console.log('  -- https (TLS terminated in front) --');
    const httpsPage = await req(`/dev/game/${PLACE_ID}/settings`, {
      headers: { Cookie: cookie },
      host: 'luckyblox-server.onrender.com',
      proto: 'https',
    });

    check('https: the Studio settings page renders', () => {
      assert.strictEqual(httpsPage.statusCode, 200, `expected 200, got ${httpsPage.statusCode}`);
      assert.ok(/id="settingsForm"/.test(httpsPage.body), 'the settings form is not in the response');
    });

    check('https: nothing on the page points back at an insecure origin', () => {
      // Mixed content is the classic reason "online features just won't work":
      // the browser blocks an http subresource or fetch on an https page.
      const httpRefs = [...httpsPage.body.matchAll(/(?:src|href|action)="(http:\/\/[^"]+)"/g)].map((m) => m[1]);
      assert.deepStrictEqual(
        httpRefs, [],
        `an https page references insecure URLs (the browser will block these):\n       ${httpRefs.join('\n       ')}`,
      );
    });

    // --- The save, over https ---------------------------------------------
    const form = new URLSearchParams({
      name: 'Saved Over Https',
      description: 'x',
      genre: 'Puzzle',
      visibility: 'Public',
      maxPlayers: '24',
      iconUrl: '/gameplaceholder/card.png',
      allowHttpRequests: 'true',
      privateServerAllowed: 'true',
      allowThirdPartySales: 'true',
      isFriendsOnly: 'false',
    }).toString();

    const saved = await req(`/dev/game/${PLACE_ID}/settings`, {
      method: 'POST',
      body: form,
      headers: { Cookie: cookie, host: 'luckyblox-server.onrender.com', 'x-forwarded-proto': 'https' },
    });

    check('https: the save is accepted', () => {
      assert.notStrictEqual(saved.statusCode, 302, `the save was bounced to ${saved.headers.location}`);
      assert.strictEqual(saved.statusCode, 200, `expected 200, got ${saved.statusCode}`);
    });

    const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
    check('https: the save persisted to the store the site reads', () => {
      assert.strictEqual(games[String(PLACE_ID)].title, 'Saved Over Https');
      assert.strictEqual(games[String(PLACE_ID)].genre, 'Puzzle');
    });

    const publicPage = await req(`/game/${PLACE_ID}`, {
      host: 'luckyblox-server.onrender.com',
      proto: 'https',
    });
    check('https: the public page shows the change', () => {
      assert.ok(/Saved Over Https/.test(publicPage.body), 'the public page does not show the new title');
    });

    // --- AppSettings.xml, which the CLIENT reads ---------------------------
    const settings = await req('/AppSettings.xml?client=2021M', {
      host: 'luckyblox-server.onrender.com',
      proto: 'https',
    });
    check('https: the client is handed an https BaseUrl', () => {
      const m = /<BaseUrl>([^<]+)<\/BaseUrl>/.exec(settings.body);
      assert.ok(m, 'no BaseUrl in AppSettings.xml');
      assert.ok(
        m[1].startsWith('https://luckyblox-server.onrender.com/'),
        `expected an https origin, got ${m[1]}`,
      );
    });

    const settingsHttp = await req('/AppSettings.xml?client=2021M', { host: `localhost:${PORT}` });
    check('http: the client is handed an http BaseUrl on the local origin', () => {
      const m = /<BaseUrl>([^<]+)<\/BaseUrl>/.exec(settingsHttp.body);
      assert.ok(m, 'no BaseUrl in AppSettings.xml');
      assert.ok(
        m[1].startsWith(`http://localhost:${PORT}/`),
        `expected the local http origin, got ${m[1]}`,
      );
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe Studio works over both http and https, and the client is handed the matching scheme.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});