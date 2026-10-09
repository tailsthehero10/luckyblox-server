'use strict';

/**
 * LUCKYBLOX_OWNER_PASSWORD must CREATE the owner on a fresh database.
 *
 * THE BUG THIS GUARDS
 * -------------------
 * `applyOwnerPasswordFromEnv()` used to return early when no record existed at the
 * owner id:
 *
 *     const owner = users[OWNER_USER_ID];
 *     if (!owner) {
 *       console.warn(`LUCKYBLOX_OWNER_PASSWORD set but owner id ... was not found`);
 *       return false;
 *     }
 *
 * So on a fresh database - or one seeded without an owner, which is what a real
 * deployment starts as - setting the password DID NOTHING. The boot log then said
 * "owner account: tailsthehero10 (id 1) via id+username", because that message
 * compares CONFIG, not stored records, so everything looked configured while every
 * sign-in answered "Unknown username". A locked-out owner with no error saying why.
 *
 * Run: node tests/owner-bootstrap.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { makeTestDir } = require('./test-paths');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38531;
const OWNER_USER = 'tailsthehero10';
const OWNER_PASS = '@pass@.lovely10';

function req(pathName, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers);
    if (body && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: pathName, method, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

/** Boot a server against `dataDir` and wait for it to answer. */
async function boot(dataDir) {
  const proc = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: dataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
      LUCKYBLOX_OWNER_USERNAME: OWNER_USER,
      LUCKYBLOX_OWNER_PASSWORD: OWNER_PASS,
      LUCKYBLOX_OWNER_JOIN_DATE: '2026-09-25T00:00:00.000Z',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (c) => { log += c; });
  proc.stderr.on('data', (c) => { log += c; });

  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited before becoming ready');
    try { await req('/health'); return { proc, getLog: () => log }; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  proc.kill('SIGTERM');
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
  console.log('owner bootstrap from the environment\n');

  let wrongPassStatus = null;

  // --- 1. A completely EMPTY database --------------------------------------
  const emptyDir = makeTestDir('luckblox-owner-empty');
  fs.writeFileSync(path.join(emptyDir, 'users.json'), '{}');

  const empty = await boot(emptyDir);
  try {
    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USER, password: OWNER_PASS }),
    });

    check('an EMPTY database gets an owner created from LUCKYBLOX_OWNER_PASSWORD', () => {
      assert.strictEqual(
        login.statusCode, 200,
        `sign-in returned ${login.statusCode}: ${login.body.slice(0, 120)}\n`
        + '       the owner was not created - this is the locked-out-with-no-error bug',
      );
    });

    check('the boot log says it created the owner', () => {
      assert.ok(
        /created owner account/i.test(empty.getLog()),
        `the server never reported creating an owner.\n       log: ${empty.getLog().slice(0, 300)}`,
      );
    });

    check('the stored record is the owner, with a HASHED password', () => {
      const users = JSON.parse(fs.readFileSync(path.join(emptyDir, 'users.json'), 'utf8'));
      const owner = users['1'];
      assert.ok(owner, 'no record at id 1');
      assert.strictEqual(owner.username, OWNER_USER);
      assert.strictEqual(owner.role, 'owner');
      assert.ok(owner.password && owner.passwordSalt, 'no credential stored');
      assert.ok(owner.password !== OWNER_PASS, 'the password was stored in PLAINTEXT');
      assert.ok(String(owner.password).length > 60, 'the password does not look hashed');
    });

    check('the new owner has the fields the site reads', () => {
      const users = JSON.parse(fs.readFileSync(path.join(emptyDir, 'users.json'), 'utf8'));
      const owner = users['1'];
      for (const field of ['displayName', 'stats', 'avatar', 'currencies', 'friends', 'inventory']) {
        assert.ok(owner[field] !== undefined, `the created owner is missing "${field}"`);
      }
      assert.strictEqual(owner.stats.friends, 0, 'counters must start at real zeros');
      assert.ok(owner.avatar && owner.avatar.bodyColors, 'no avatar block to draw');
      assert.strictEqual(owner.joinDate, '2026-09-25T00:00:00.000Z');
    });

    const wrong = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USER, password: 'not-the-password' }),
    });
    wrongPassStatus = wrong.statusCode;

    check('a WRONG password is still rejected', () => {
      assert.strictEqual(
        wrongPassStatus, 401,
        `a wrong password returned ${wrongPassStatus} - creating the account must not mean any password works`,
      );
    });
  } finally {
    empty.proc.kill('SIGTERM');
    try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // --- 2. A database that already has the owner ----------------------------
  // The env password must still apply, and must NOT wipe the rest of the account.
  const seededDir = makeTestDir('luckblox-owner-seeded');
  fs.writeFileSync(path.join(seededDir, 'users.json'), JSON.stringify({
    1: {
      userId: '1',
      username: OWNER_USER,
      displayName: OWNER_USER,
      // Deliberately a stale credential, to prove the env value takes over.
      password: 'deadbeef', passwordSalt: 'deadbeef', passwordVersion: 1,
      role: 'owner',
      robux: 4242,
      friends: [{ userId: '7', username: 'KeepMe' }],
      stats: { friends: 1, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
      avatar: { bodyColors: { headColorId: 1 }, playerAvatarType: 'R15' },
    },
  }));

  const seeded = await boot(seededDir);
  try {
    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USER, password: OWNER_PASS }),
    });

    check('an existing owner gets the configured password applied', () => {
      assert.strictEqual(login.statusCode, 200, `sign-in returned ${login.statusCode}`);
    });

    check('applying the password does NOT wipe the account', () => {
      const users = JSON.parse(fs.readFileSync(path.join(seededDir, 'users.json'), 'utf8'));
      const owner = users['1'];
      assert.strictEqual(owner.robux, 4242, 'robux was reset by the owner-password step');
      assert.strictEqual(owner.friends.length, 1, 'friends were wiped by the owner-password step');
      assert.strictEqual(owner.avatar.bodyColors.headColorId, 1, 'the saved avatar was replaced');
      assert.strictEqual(owner.joinDate, '2026-09-25T00:00:00.000Z', 'the owner join date migration was not applied');
    });

    check('booting twice does not duplicate or reset the owner', () => {
      const users = JSON.parse(fs.readFileSync(path.join(seededDir, 'users.json'), 'utf8'));
      assert.strictEqual(Object.keys(users).length, 1, `expected 1 account, found ${Object.keys(users).length}`);
    });
  } finally {
    seeded.proc.kill('SIGTERM');
    try { fs.rmSync(seededDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe owner account is created and re-applied from the environment.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});