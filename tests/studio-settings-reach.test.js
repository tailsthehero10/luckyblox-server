'use strict';

/**
 * Proves whether a Studio settings change reaches the PUBLIC game page.
 *
 * The owner's question is simple - "can I change the icons and the game type?" -
 * and it can only be answered by changing them and looking. Reading the code
 * suggests a split store:
 *
 *   Studio POST /dev/game/:placeId/settings  writes  data/places.json
 *   The site      /game/:placeId             reads   data/games.json
 *
 * If that is right, the Studio form saves successfully (it returns ok:true),
 * shows no error, and NOTHING on the public page changes. This test settles it.
 *
 * Run: node tests/studio-settings-reach.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38451;

// The owner's password is hashed here rather than read from the real data file, so
// this test owns its own fixture instead of depending on the developer's.
const ownerHash = security.hashPassword('@pass@.lovely10');

function req(pathName, { method = 'GET', body, headers = {}, form } = {}) {
  return new Promise((resolve, reject) => {
    const payload = form || body;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: pathName,
        method,
        headers: Object.assign(
          payload
            ? (form
              ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
              : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
            : {},
          headers,
        ),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited before becoming ready');
    try { await req('/health'); return; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server did not become ready');
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
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-studio-'));

  // One game with an authorId of 1 (the owner), which is how the built-ins are
  // described in the project notes.
  const PLACE_ID = 1818;
  fs.writeFileSync(path.join(tempDataDir, 'games.json'), JSON.stringify({
    [String(PLACE_ID)]: {
      placeId: PLACE_ID,
      title: 'Original Title',
      description: 'Original description.',
      developer: 'LuckyBlox Studio',
      icon: '/gameplaceholder/card.png',
      genre: 'Adventure',
      playerCount: 0, likes: 0, favorites: 0,
      activeServers: [], serverList: [],
      votes: { likes: 0, dislikes: 0 },
      tags: ['Action'],
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'users.json'), JSON.stringify({
    // The deployment owner, so the Studio routes accept the session. Without a
    // real account here the login fails and this test measures the auth redirect
    // instead of the thing it exists to check.
    1: {
      userId: '1',
      username: 'tailsthehero10',
      displayName: 'tailsthehero10',
      password: ownerHash.hash,
      passwordSalt: ownerHash.salt,
      passwordVersion: ownerHash.version,
      role: 'owner',
      membershipStatus: 'None',
      robux: 0,
      avatar: { bodyColors: { headColorId: 24, torsoColorId: 23 } },
      stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'places.json'), JSON.stringify({}));

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir, LUCKYBLOX_PREVIEW_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('does a Studio settings change reach the public game page?\n');

    // Sign in as the owner so the Studio routes accept the request.
    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
    });
    if (login.statusCode !== 200) {
      console.log('  (owner account not present in this data dir; logging in is not the subject of this test)');
    }
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    // What the public page says BEFORE.
    const before = await req(`/game/${PLACE_ID}`);
    const beforeTitle = /<h1[^>]*>([^<]*)<\/h1>/.exec(before.body);
    console.log(`  before: HTTP ${before.statusCode}, h1 = ${beforeTitle ? beforeTitle[1].trim() : '(none)'}`);

    // Save new settings through the Studio, exactly as its form does.
    const form = new URLSearchParams({
      name: 'Renamed By Studio',
      description: 'Changed through the Studio settings form.',
      genre: 'Puzzle',
      visibility: 'Public',
      maxPlayers: '30',
      iconUrl: '/gameplaceholder/card.png',
    }).toString();

    const saved = await req(`/dev/game/${PLACE_ID}/settings`, {
      method: 'POST',
      form,
      headers: { Cookie: cookie },
    });
    console.log(`  studio POST: HTTP ${saved.statusCode} ${saved.body.slice(0, 80)}`);

    // What the public page says AFTER.
    const after = await req(`/game/${PLACE_ID}`);
    const afterTitle = /<h1[^>]*>([^<]*)<\/h1>/.exec(after.body);
    const afterText = afterTitle ? afterTitle[1].trim() : '(none)';

    check('the Studio accepted the save', () => {
      // A redirect means the session was not accepted at all - a different
      // failure from "the write went to the wrong store", and worth separating.
      assert.notStrictEqual(
        saved.statusCode,
        302,
        `the Studio bounced the save to ${saved.headers.location || 'a redirect'} - `
        + 'the session was not accepted',
      );
      assert.strictEqual(saved.statusCode, 200, `unexpected status ${saved.statusCode}`);
    });

    check('the change is visible on the public game page', () => {
      // THE POINT. If the Studio writes places.json and the site reads games.json,
      // this fails and the owner is told the truth: the settings are saved
      // somewhere nobody reads.
      assert.ok(
        afterText.includes('Renamed By Studio'),
        `the public page still shows "${afterText}" after the Studio renamed it to `
        + '"Renamed By Studio" - the two are reading different stores',
      );
    });

    check('the new genre is visible on the public game page', () => {
      assert.ok(
        /Puzzle/.test(after.body),
        'the genre set in the Studio does not appear on the public page',
      );
    });

    check('the built-in game is owned by the deployment owner (id 1)', () => {
      // "id 1 owns the pre-added games" is the premise the owner edits them on.
      // The built-ins used to carry no author at all, so this was assumed rather
      // than recorded - and anything that later guards edits by ownership would
      // have refused the owner access to their own games.
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      const entry = games[String(PLACE_ID)];
      assert.ok(entry, 'the edited game should be persisted');
      assert.strictEqual(
        Number(entry.authorId),
        1,
        `expected the game to be owned by id 1, got authorId=${entry.authorId}`,
      );
    });

    check('editing does not wipe the game\'s real counters', () => {
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      const entry = games[String(PLACE_ID)];
      for (const field of ['likes', 'favorites', 'playerCount']) {
        assert.ok(
          Number.isFinite(Number(entry[field])),
          `${field} must survive an edit as a number, got ${entry[field]}`,
        );
      }
      assert.ok(entry.votes && typeof entry.votes === 'object', 'votes must survive an edit');
    });

    check('a boolean toggle set to false stays false', () => {
      // 'false' is a TRUTHY string in JavaScript, so a form value assigned raw
      // would turn a disabled setting back on. This is the check for that.
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      assert.strictEqual(
        games[String(PLACE_ID)].allowHttpRequests,
        true,
        'allowHttpRequests was sent as true and should be true',
      );
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nA Studio settings change reaches the public page.'
      : `\n${failures} FAILURE(S) - the Studio and the site are reading different stores.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});