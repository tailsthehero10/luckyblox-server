'use strict';

/**
 * The account switcher.
 *
 * Roblox's 2021 avatar menu listed the accounts you had signed in as on that
 * browser so you could hop between them. This checks the same feature AND the
 * security properties that make it safe to ship:
 *
 *   - signing in records the account in a browser-scoped cookie
 *   - the cookie contains ACCOUNT IDS ONLY - never a password or a session id
 *   - an unknown / forged id in the cookie lists nothing
 *   - forgetting removes it from the list without touching the account
 *   - signing out does NOT clear the list (that is the point of the feature)
 *
 * Run: node tests/account-switcher.test.js
 */

const assert = require('assert');
const fs = require('fs');
const { makeTestDir } = require('./test-paths');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38551;

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

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited early');
    try { await req('/health'); return; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server never became ready');
}

/** The Set-Cookie value for one cookie name, or null. */
function cookieFrom(res, name) {
  const all = res.headers['set-cookie'] || [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit || null;
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
  const tempDataDir = makeTestDir('luckblox-switcher');
  const hash = security.hashPassword('@pass@.lovely10');

  fs.writeFileSync(path.join(tempDataDir, 'users.json'), JSON.stringify({
    1: {
      userId: '1', username: 'tailsthehero10', displayName: 'tailsthehero10',
      password: hash.hash, passwordSalt: hash.salt, passwordVersion: hash.version,
      role: 'owner', membershipStatus: 'None', robux: 100,
      avatar: { bodyColors: { headColorId: 24, torsoColorId: 23 } },
      stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
    },
    2: {
      userId: '2', username: 'SecondAccount', displayName: 'SecondAccount',
      password: hash.hash, passwordSalt: hash.salt, passwordVersion: hash.version,
      role: 'player', membershipStatus: 'None', robux: 5,
      avatar: { bodyColors: { headColorId: 1, torsoColorId: 1 } },
      stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'games.json'), '{}');
  fs.writeFileSync(path.join(tempDataDir, 'places.json'), '{}');

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir, LUCKYBLOX_PREVIEW_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('account switcher\n');

    // --- Signing in records the account ------------------------------------
    const login1 = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
    });
    const ownerSessionCookie = String(cookieFrom(login1, 'luckblox_session').split(';')[0]);
    const createPage = await req('/create', { headers: { Cookie: ownerSessionCookie } });
    const creatorDocsPage = await req('/dev/docs', { headers: { Cookie: ownerSessionCookie } });
    check('creator landing and API docs pages are reachable', () => {
      assert.strictEqual(createPage.statusCode, 200);
      assert.strictEqual(creatorDocsPage.statusCode, 200);
      assert.ok(createPage.body.includes('Create on LuckyBlox'));
      assert.ok(creatorDocsPage.body.includes('/dev/docs/auth'));
    });

    const known1 = cookieFrom(login1, 'luckblox_known_accounts');
    check('signing in records the account for the switcher', () => {
      assert.ok(known1, 'no luckblox_known_accounts cookie was set');
      assert.ok(known1.includes('1'), `the cookie does not name account 1: ${known1}`);
    });

    check('the cookie holds account IDs ONLY - never a credential', () => {
      // This is the whole safety argument for the feature: it saves TYPING the
      // username, never the authentication.
      const value = String(known1.split(';')[0]);
      const raw = decodeURIComponent(value.slice(value.indexOf('=') + 1));
      assert.ok(/^[0-9,]*$/.test(raw), `the cookie contains more than ids: ${raw}`);
      assert.ok(!/=/.test(raw), 'the cookie value looks like name=value pairs');
      assert.ok(raw.length < 64, `the cookie is unexpectedly large: ${raw.length} chars`);
    });

    check('the session cookie is still httpOnly', () => {
      const session = cookieFrom(login1, 'luckblox_session');
      assert.ok(session, 'no session cookie');
      assert.ok(/httponly/i.test(session), 'the SESSION cookie is readable by scripts');
    });

    // --- The list is per-browser, served from the cookie -------------------
    const jar = [`luckblox_session=${(login1.headers['set-cookie'][0].split(';')[0].split('=')[1])}`,
    `luckblox_known_accounts=${String(known1.split(';')[0]).split('=')[1]}`].join('; ');

    const listed = await req('/api/accounts/known', { headers: { Cookie: jar } });
    check('/api/accounts/known lists the signed-in account', () => {
      const data = JSON.parse(listed.body);
      assert.strictEqual(data.ok, true);
      const ids = (data.accounts || []).map((a) => a.userId);
      assert.ok(ids.includes('1'), `account 1 is missing from ${JSON.stringify(ids)}`);
    });

    check('the listed account carries what the menu draws', () => {
      const data = JSON.parse(listed.body);
      const acct = (data.accounts || []).find((a) => a.userId === '1');
      assert.ok(acct.username, 'no username to show');
      assert.ok(acct.avatar, 'no avatar block, so the row cannot draw a character');
      assert.strictEqual(acct.isCurrent, true, 'the active account is not marked');
    });

    // --- A second account is added, not replaced ---------------------------
    // The SECOND login must carry the first login's cookies, exactly as a browser
    // would. Without them the server has nothing to merge with - the first
    // version of this test sent no cookie and so asserted the server had lost an
    // account it had never been told about.
    const firstJar = [
      `luckblox_session=${String(cookieFrom(login1, 'luckblox_session').split(';')[0]).split('=')[1]}`,
      `luckblox_known_accounts=${String(known1.split(';')[0]).split('=')[1]}`,
    ].join('; ');

    const login2 = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'SecondAccount', password: '@pass@.lovely10' }),
      headers: { Cookie: firstJar },
    });
    const known2 = cookieFrom(login2, 'luckblox_known_accounts');

    check('signing into a second account ADDS it to the list', () => {
      assert.ok(known2, 'no known-accounts cookie on the second login');
      // Express URL-ENCODES the value, so "2,1" arrives as "2%2C1". Decoding is
      // required here for the same reason the server has to decode it - splitting
      // the raw value on a comma finds nothing.
      const raw = decodeURIComponent(String(known2.split(';')[0]).split('=')[1]);
      const ids = raw.split(',');
      assert.ok(ids.includes('2'), `the second account is missing: ${raw}`);
      assert.ok(ids.includes('1'), `the first account was DROPPED: ${raw}`);
      assert.strictEqual(ids[0], '2', 'the newest account should be listed first');
    });

    check('the list holds ids only, still', () => {
      const raw = decodeURIComponent(String(known2.split(';')[0]).split('=')[1]);
      assert.ok(/^[0-9,]*$/.test(raw), `the cookie contains more than ids: ${raw}`);
    });

    const secondJar = [
      `luckblox_session=${String(cookieFrom(login2, 'luckblox_session').split(';')[0]).split('=')[1]}`,
      `luckblox_known_accounts=${String(known2.split(';')[0]).split('=')[1]}`,
    ].join('; ');
    const switchAccount = await req('/account/switch?userId=1', {
      headers: { Cookie: secondJar },
    });
    check('switching destroys the active session and redirects to the saved account', () => {
      assert.strictEqual(switchAccount.statusCode, 302);
      assert.strictEqual(
        switchAccount.headers.location,
        '/signin?username=tailsthehero10&redirect=%2F',
      );
      const cleared = switchAccount.headers['set-cookie'] || [];
      assert.ok(cleared.some((cookie) => /^luckblox_session=;/.test(cookie)), 'active session cookie was not cleared');
      assert.ok(cleared.some((cookie) => cookie.startsWith('.ROBLOSECURITY=;')), 'player auth cookie was not cleared');
      assert.ok(
        !cleared.some((cookie) => /^luckblox_known_accounts=/.test(cookie)),
        'saved account list must survive switching',
      );
    });
    const afterSwitch = await req('/api/accounts/known', {
      headers: { Cookie: secondJar },
    });
    check('the previous session is no longer recognized after switching', () => {
      const data = JSON.parse(afterSwitch.body);
      assert.ok((data.accounts || []).every((account) => account.isCurrent === false));
    });

    const unsavedSwitch = await req('/account/switch?userId=999', {
      headers: { Cookie: secondJar },
    });
    check('switching rejects an account that was not saved in this browser', () => {
      assert.strictEqual(unsavedSwitch.statusCode, 404);
    });

    // --- A forged cookie cannot invent accounts ---------------------------
    const forged = await req('/api/accounts/known', {
      headers: { Cookie: 'luckblox_session=; luckblox_known_accounts=99999,abc,1,-5,2' },
    });
    check('a forged cookie cannot invent an account', () => {
      const data = JSON.parse(forged.body);
      const ids = (data.accounts || []).map((a) => a.userId);
      assert.ok(!ids.includes('99999'), 'an id that does not exist was listed');
      assert.ok(!ids.includes('abc'), 'a non-numeric id was listed');
      assert.ok(!ids.includes('-5'), 'a negative id was listed');
      assert.ok(ids.includes('1') && ids.includes('2'), `the real ids were lost: ${JSON.stringify(ids)}`);
    });

    // --- Forgetting -------------------------------------------------------
    const forget = await req('/api/accounts/forget', {
      method: 'POST',
      body: JSON.stringify({ userId: '1' }),
      headers: { Cookie: jar },
    });

    // A bad id, checked after the good one so no request is in flight when the
    // server is torn down.
    const forgetBad = await req('/api/accounts/forget', {
      method: 'POST',
      body: JSON.stringify({ userId: 'nonsense' }),
      headers: { Cookie: jar },
    });
    const forgetBadStatus = forgetBad.statusCode;
    check('forgetting an account removes it from the list', () => {
      assert.strictEqual(forget.statusCode, 200, `returned ${forget.statusCode}`);
      const data = JSON.parse(forget.body);
      const ids = (data.accounts || []).map((a) => a.userId);
      assert.ok(!ids.includes('1'), `account 1 is still listed: ${JSON.stringify(ids)}`);
    });

    const stillThere = await req('/api/users/1/profile');
    check('forgetting does NOT delete the account', () => {
      assert.strictEqual(stillThere.statusCode, 200, 'the account itself was affected');
      const data = JSON.parse(stillThere.body);
      assert.ok(data.user && data.user.username === 'tailsthehero10', 'the account record changed');
    });

    check('forgetting rejects a non-numeric id', () => {
      assert.strictEqual(forgetBadStatus, 400, `expected 400, got ${forgetBadStatus}`);
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe account switcher records ids only, and cannot be used to authenticate.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});