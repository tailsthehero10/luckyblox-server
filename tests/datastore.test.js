'use strict';

/**
 * Proves the local DataStore endpoints work on the NODE server, not just Apache.
 *
 * The 2021M client's DataStoreService replacement saves game progress through
 * /datastore/{getds,setds,getorderedds,setorderedds}.php. On a desktop install
 * Apache serves the PHP; the Node bridge used to answer 404 for every one of
 * them - so on the public deployment (and any Node-fronted setup) GetAsync threw
 * and in-game saving silently failed. This is the local-vs-public mismatch.
 *
 * These checks boot the real bridge and exercise the real HTTP routes, then
 * confirm the value landed in the SAME file Apache would read, so the two
 * servers share one store.
 *
 * Run: node tests/datastore.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { makeTestDir } = require('./test-paths');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3991;
// The shared on-disk store the PHP and the Node implementation both use.
const ITEMS_DIR = path.join(PROJECT_ROOT, 'Webserver', 'www', 'datastore', 'items');
const ORDERED_DIR = path.join(PROJECT_ROOT, 'Webserver', 'www', 'datastore', 'ordereddatastore');

function request({ pathName, method = 'GET', body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {};
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: pathName, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited before becoming ready');
    try {
      await request({ pathName: '/health' });
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

async function main() {
  const tempDataDir = makeTestDir('luckblox-ds');
  const probeKey = `__lb_test_${Date.now()}`;
  const probeStore = `__lb_ods_${Date.now()}`;
  const probeItemPath = path.join(ITEMS_DIR, probeKey);

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_BRIDGE_PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: tempDataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitForReady(server);
    console.log('local datastore (Node)');

    // A missing key is a 200 with an EMPTY body, never a 404: the client treats
    // a non-2xx as a server failure and throws, which is what broke saving.
    const missing = await request({ pathName: `/datastore/getds.php?key=${probeKey}` });
    check('a missing key answers 200 with an empty body (not 404)', () => {
      assert.equal(missing.statusCode, 200);
      assert.equal(missing.body, '');
    });

    // Write through the route the client actually uses.
    const saved = await request({
      pathName: '/datastore/setds.php',
      method: 'POST',
      body: { key: probeKey, data: '{"Money":530}' },
    });
    check('setds stores a value and echoes it back', () => {
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.body, '{"Money":530}');
    });

    const readBack = await request({ pathName: `/datastore/getds.php?key=${probeKey}` });
    check('getds returns the value just written', () => {
      assert.equal(readBack.statusCode, 200);
      assert.equal(readBack.body, '{"Money":530}');
    });

    // The proof the two implementations are ONE store: the file is exactly where
    // Apache's PHP reads it, with the value verbatim.
    check('the value lands in the shared Apache/PHP store', () => {
      assert.ok(fs.existsSync(probeItemPath), `expected ${probeItemPath} to exist`);
      assert.equal(fs.readFileSync(probeItemPath, 'utf8'), '{"Money":530}');
    });

    // Path traversal must be refused, matching datastore_key() in common.php.
    for (const bad of ['..%2F..%2Fserver%2Fstorage.js', '', 'a%2Fb', 'a%5Cb']) {
      const res = await request({ pathName: `/datastore/getds.php?key=${bad}` });
      check(`an unsafe key is rejected with 400 (${bad || '<empty>'})`, () => {
        assert.equal(res.statusCode, 400);
      });
    }

    // Ordered datastore.
    const orderedSet = await request({
      pathName: '/datastore/setorderedds.php',
      method: 'POST',
      body: { dsname: probeStore, key: '1', data: '{"score":10}' },
    });
    check('setorderedds stores and returns the ordered list', () => {
      assert.equal(orderedSet.statusCode, 200);
      assert.equal(orderedSet.body, '[{"score":10}]');
    });

    const orderedGet = await request({ pathName: `/datastore/getorderedds.php?dsname=${probeStore}` });
    check('getorderedds reads the ordered list back', () => {
      assert.equal(orderedGet.statusCode, 200);
      assert.equal(orderedGet.body, '[{"score":10}]');
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(probeItemPath, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(ORDERED_DIR, probeStore), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe Node server serves the local datastore, sharing one store with Apache.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
