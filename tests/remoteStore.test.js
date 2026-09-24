'use strict';

/**
 * Proves the free remote persistence layer round-trips data through an HTTP
 * store, so accounts survive a wiped container with no paid disk.
 *
 * Run: node tests/remoteStore.test.js
 *
 * The test stands up a tiny in-process HTTP server that behaves like the "http"
 * backend (GET returns the stored JSON, PUT replaces it), points
 * LUCKYBLOX_SYNC at it, then checks that:
 *   - loadAll() writes remote files into a fresh empty data dir
 *   - saveFile() + flush() pushes a change back up
 *   - a second loadAll() (simulated redeploy) sees the pushed change
 *   - with LUCKYBLOX_SYNC unset the module is inert (no network calls)
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// The store the fake server holds. Starts with a user whose data a "redeploy"
// would otherwise wipe.
let store = {
  'users.json': { '1': { userId: 1, username: 'tailsthehero10' } },
  '1.json': { userId: 1, robux: 4200 },
};

let getCount = 0;
let putCount = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    getCount += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store));
    return;
  }
  if (req.method === 'PUT') {
    putCount += 1;
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        store = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (error) {
        res.writeHead(400);
        res.end('{"ok":false}');
      }
    });
    return;
  }
  res.writeHead(405);
  res.end();
});

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  - ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL  - ${name}\n        ${error.message}`);
      process.exitCode = 1;
    });
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-sync-'));

  // Configure the http backend BEFORE requiring the module (it reads env once).
  process.env.LUCKYBLOX_SYNC = 'http';
  process.env.LUCKYBLOX_SYNC_URL = `http://127.0.0.1:${port}/store`;

  const remoteStore = require('../server/remoteStore');

  console.log('remoteStore.js');

  await test('reports the http backend as enabled', () => {
    assert.strictEqual(remoteStore.enabled, true);
    const d = remoteStore.describe();
    assert.strictEqual(d.enabled, true);
    assert.strictEqual(d.mode, 'http');
  });

  await test('loadAll restores remote files into an empty dir', async () => {
    const result = await remoteStore.loadAll(tmpDir);
    assert.strictEqual(result.ok, true);
    assert.ok(result.loaded.includes('users.json'), 'users.json restored');
    assert.ok(result.loaded.includes('1.json'), 'per-user file restored');

    const users = JSON.parse(fs.readFileSync(path.join(tmpDir, 'users.json'), 'utf8'));
    assert.strictEqual(users['1'].username, 'tailsthehero10');
    const user = JSON.parse(fs.readFileSync(path.join(tmpDir, '1.json'), 'utf8'));
    assert.strictEqual(user.robux, 4200);
    assert.ok(getCount >= 1, 'the store was read');
  });

  await test('saveFile + flush pushes a change back to the store', async () => {
    await remoteStore.saveFile('1.json', { userId: 1, robux: 9999 });
    const flushed = await remoteStore.flush();
    assert.strictEqual(flushed.ok, true);
    assert.ok(flushed.pushed.includes('1.json'), 'the change was pushed');
    assert.strictEqual(store['1.json'].robux, 9999);
    assert.ok(putCount >= 1, 'the store was written');
  });

  await test('a simulated redeploy sees the pushed change', async () => {
    // Redeploy = wipe the local dir, then restore from the remote again.
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = await remoteStore.loadAll(tmpDir);
    assert.strictEqual(result.ok, true);
    const user = JSON.parse(fs.readFileSync(path.join(tmpDir, '1.json'), 'utf8'));
    assert.strictEqual(user.robux, 9999, 'currency survived the wipe');
  });

  await test('per-user <id>.json files are recognised as syncable', () => {
    // Indirect: a numeric filename must be queued, a random one must not.
    remoteStore.saveFile('42.json', { userId: 42 });
    remoteStore.saveFile('notes.txt', { nope: true });
    return remoteStore.flush().then((flushed) => {
      assert.ok(flushed.pushed.includes('42.json'), 'numeric user file pushed');
      assert.ok(!flushed.pushed.includes('notes.txt'), 'non-data file ignored');
    });
  });

  // --- Inert when unconfigured ---------------------------------------------
  await test('is inert when LUCKYBLOX_SYNC is unset', async () => {
    delete process.env.LUCKYBLOX_SYNC;
    delete process.env.LUCKYBLOX_SYNC_URL;
    delete require.cache[require.resolve('../server/remoteStore')];
    const offStore = require('../server/remoteStore');
    assert.strictEqual(offStore.enabled, false);
    const result = await offStore.loadAll(tmpDir);
    assert.strictEqual(result.enabled, false);
    assert.deepStrictEqual(result.loaded, []);
  });

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  server.close();

  console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
  process.exit(process.exitCode || 0);
})();