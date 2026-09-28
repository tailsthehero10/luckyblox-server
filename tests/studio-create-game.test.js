'use strict';

/**
 * A game created in the Studio must appear on the SITE.
 *
 * The bug this guards: `/dev/create` and `POST /api/v1/places` wrote the .rbxlx
 * and a places.json row, and stopped. The Studio listed the new game; the site did
 * not know it existed - not in the games list, not in search, not on the home
 * page, and `/game/<id>` served a fallback. Creating a game has to put it where
 * the game pages read from (games.json).
 *
 * It also checks that the new id does not collide with an existing game, because
 * the old route built one from the clock (`Date.now() % 100000`) and could
 * overwrite a different game.
 *
 * Run: node tests/studio-create-game.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38491;

function req(pathName, { method = 'GET', body, headers = {}, form } = {}) {
  return new Promise((resolve, reject) => {
    const payload = form || body;
    const h = Object.assign({}, headers);
    if (payload && !form && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (form) h['Content-Type'] = 'application/x-www-form-urlencoded';

    const r = http.request(
      { hostname: '127.0.0.1', port: PORT, path: pathName, method, headers: h },
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
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-create-'));
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
    1818: {
      placeId: 1818, title: 'Existing Built In', description: 'd',
      developer: 'LuckyBlox Studio', authorId: 1, icon: '/gameplaceholder/card.png',
      genre: 'Adventure', playerCount: 0, likes: 0, favorites: 0,
      activeServers: [], serverList: [], votes: { likes: 0, dislikes: 0 }, tags: [],
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'places.json'), '{}');

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir, LUCKYBLOX_PREVIEW_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('creating a game in the Studio\n');

    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
    });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    // Create a game exactly as the Studio form does.
    const name = 'Probe Created Game';
    const created = await req('/dev/create', {
      method: 'POST',
      form: new URLSearchParams({ name, description: 'Made by the test.', genre: 'Racing', visibility: 'Public', maxPlayers: '12' }).toString(),
      headers: { Cookie: cookie },
    });

    let body = null;
    try { body = JSON.parse(created.body); } catch (e) { /* reported below */ }

    check('the create route reports success and an id', () => {
      assert.strictEqual(created.statusCode, 200, `expected 200, got ${created.statusCode}`);
      assert.ok(body && body.ok, `expected ok:true, got ${created.body.slice(0, 120)}`);
      assert.ok(Number(body.placeId) > 0, `expected a placeId, got ${body.placeId}`);
    });

    const placeId = body ? Number(body.placeId) : 0;

    check('the new game does NOT reuse an existing id', () => {
      assert.notStrictEqual(placeId, 1818, 'the created game took the built-in game\'s id');
    });

    check('an existing game in games.json SURVIVES the create', () => {
      // The serious one. Writing a merged view (catalog + seed + file) back to disk
      // bakes derived data into the file AND replaces real rows, because catalog
      // entries carry different ids - a stored 1818 became the catalog's 1848 and
      // the edited record was gone. A save must never destroy a different game.
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      assert.ok(
        games['1818'],
        'the existing game was DELETED by the write - the merged view was persisted '
        + `instead of the raw store (keys now: ${Object.keys(games).join(', ')})`,
      );
      assert.strictEqual(
        games['1818'].title,
        'Existing Built In',
        'the existing game was overwritten by a catalog-derived record',
      );
    });

    check('writing does not bake the map catalog into games.json', () => {
      // 1818 predates the catalog. If a derived record for it appears, the catalog
      // was persisted.
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      assert.strictEqual(
        games['1818'].mapFile,
        undefined,
        'games.json now contains catalog-derived map metadata - a merged view was written to disk',
      );
    });

    check('the game is registered where the site reads', () => {
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      const record = games[String(placeId)];
      assert.ok(record, `games.json has no record for ${placeId} - the site will not see the game`);
      assert.strictEqual(record.title, name);
      assert.strictEqual(record.genre, 'Racing');
    });

    check('it is owned by the creator', () => {
      const games = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'games.json'), 'utf8'));
      assert.strictEqual(Number(games[String(placeId)].authorId), 1);
    });

    // --- And it is reachable on the public site ---------------------------

    const gamePage = await req(`/game/${placeId}`);
    check('the public game page renders it (not a fallback)', () => {
      assert.strictEqual(gamePage.statusCode, 200);
      assert.ok(
        gamePage.body.includes(name),
        'the game page does not show the created title - it fell back to something else',
      );
    });

    const api = await req(`/api/v1/games/${placeId}`);
    check('the API returns it', () => {
      const parsed = JSON.parse(api.body);
      const g = parsed.game || {};
      assert.ok(
        JSON.stringify(g).includes(name),
        `the API response does not mention the new game: ${api.body.slice(0, 160)}`,
      );
    });

    const list = await req('/api/v1/games');
    check('it appears in the games list', () => {
      const parsed = JSON.parse(list.body);
      const found = (parsed.games || []).some((g) => Number(g.placeId) === placeId);
      assert.ok(found, `the new game is missing from the games list (${(parsed.games || []).length} games)`);
    });

    check('creating it wrote the place file too', () => {
      const places = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'places.json'), 'utf8'));
      assert.ok(places[String(placeId)], 'no places.json row for the new game');
      assert.ok(places[String(placeId)].fileName, 'the place row has no file name');
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nA game created in the Studio is visible on the site.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});