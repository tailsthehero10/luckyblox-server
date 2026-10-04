'use strict';

/**
 * Renders the friends page WITH friends and asserts the real 2013 row markup.
 *
 * An empty friends list renders the "no friends yet" branch, so sweeping the page
 * proves nothing about the layout that the TODO says "looks bad". This seeds two
 * accounts that are friends of each other, loads the page, and checks the markup
 * and the geometry the real Friends.css specifies:
 *
 *   .friend-container { float:left; margin:10px; width:100px; height:130px }
 *   .friend-avatar    { width:100px; height:100px }
 *
 * Run: node tests/friends-row.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { makeTestDir } = require('./test-paths');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38321;

function request(pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: pathName }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited before becoming ready');
    try {
      await request('/health');
      return;
    } catch (error) {
      await new Promise((r) => setTimeout(r, 200));
    }
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
  const tempDataDir = makeTestDir('luckblox-friends');

  // Two accounts that are friends of each other, one online and one offline, so
  // both branches of the presence dot are exercised.
  const users = {
    41: {
      userId: '41', username: 'RowProbeA', displayName: 'RowProbeA',
      status: 'online', membershipStatus: 'None',
      avatar: { bodyColors: { headColorId: 24, torsoColorId: 23, leftArmColorId: 24, rightArmColorId: 24, leftLegColorId: 119, rightLegColorId: 119 } },
      friends: [{ userId: '42', username: 'RowProbeB', status: 'offline' }],
    },
    42: {
      userId: '42', username: 'RowProbeB', displayName: 'RowProbeB',
      status: 'offline', membershipStatus: 'None',
      avatar: { bodyColors: { headColorId: 1, torsoColorId: 1, leftArmColorId: 1, rightArmColorId: 1, leftLegColorId: 1, rightLegColorId: 1 } },
      friends: [{ userId: '41', username: 'RowProbeA', status: 'online' }],
    },
  };
  fs.writeFileSync(path.join(tempDataDir, 'users.json'), JSON.stringify(users));

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('friends row');

    const res = await request('/friends?userId=41');
    check('the friends page loads', () => assert.equal(res.statusCode, 200));

    const html = res.body;

    check('renders the 2013 friends container, not a text list', () => {
      assert.ok(html.includes('lb-friends-container'), 'expected .lb-friends-container');
      assert.ok(!html.includes('lb-asset-list'), 'the old single-column list must be gone');
    });

    check('each friend is a 100x130 tile', () => {
      const tiles = (html.match(/class="lb-friend-container"/g) || []).length;
      assert.equal(tiles, 1, `expected 1 friend tile, found ${tiles}`);
    });

    check('the friend name is rendered', () => {
      assert.ok(/class="lb-friend-name">RowProbeB</.test(html), 'friend name missing from the tile');
    });

    check('a letter tile is NOT used in place of an avatar', () => {
      // The old markup printed the first letter of the name as the "avatar".
      assert.ok(!/lb-asset-icon/.test(html), 'the letter-tile avatar is still present');
    });

    check('the friend tile uses an image or neutral avatar icon, not an invented model', () => {
      assert.ok(html.includes('lb-friend-avatar-base'), 'expected the avatar image layer');
      assert.ok(html.includes('lb-user-avatar-placeholder'), 'expected a neutral avatar placeholder');
      assert.ok(!html.includes('lb-avatar-svg'), 'generated avatar drawings must not stand in for an RBXM model');
    });

    check('presence is shown on the tile', () => {
      assert.ok(/lb-friend-presence/.test(html), 'expected a presence dot on the tile');
      assert.ok(/lb-presence-offline/.test(html), 'RowProbeB is offline and should render as such');
    });

    // The CSS must carry the geometry the real sheet specifies.
    const css = fs.readFileSync(
      path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'public', 'css', 'roblox.css'),
      'utf8',
    );
    const ruleFor = (selector) => {
      const start = css.indexOf(selector + ' {');
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    };

    check('the tile is 100x130 as the real sheet specifies', () => {
      const body = ruleFor('.lb-friend-container');
      assert.ok(/width:\s*100px/.test(body), 'expected width:100px');
      assert.ok(/height:\s*130px/.test(body), 'expected height:130px');
      assert.ok(/float:\s*left/.test(body), 'expected a floated row');
    });

    check('the avatar box is 100x100 as the real sheet specifies', () => {
      const body = ruleFor('.lb-friend-avatar');
      assert.ok(/width:\s*100px/.test(body), 'expected width:100px');
      assert.ok(/height:\s*100px/.test(body), 'expected height:100px');
    });

    check('no friend avatar is hotlinked to a third-party host', () => {
      assert.ok(!/unsplash\.com/.test(html), 'friends page must not hotlink stock art');
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe friends page renders the real 2013 row.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});