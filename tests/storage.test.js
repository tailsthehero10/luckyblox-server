'use strict';

/**
 * Proves the storage layer persists data and seeds defaults correctly.
 * Run: node tests/storage.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point storage at a temp dir BEFORE requiring it, so we test the persistent path.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-store-'));
process.env.LUCKYBLOX_DATA_DIR = tmpDir;

const storage = require('../server/storage');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`FAIL  - ${name}\n        ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('storage.js');

test('honours LUCKYBLOX_DATA_DIR', () => {
  assert.strictEqual(path.resolve(storage.dataDir), path.resolve(tmpDir));
  assert.strictEqual(storage.isPersistent, true);
});

test('seeds bundled defaults into an empty persistent dir', () => {
  // The seed is whatever the bundled data dir currently holds, so assert the
  // MECHANISM rather than a particular account: the file must have been copied
  // into the persistent dir, and reading it back must give the same content.
  //
  // This used to assert `users['1']` - the seeded owner account. That record was
  // deliberately removed: a real deployment starts empty so every name on the
  // site belongs to somebody who actually registered, and id 1 is reserved for
  // the operator (see createDefaultUsers in the bridge). Asserting the old
  // fixture made the test fail the moment the fixture was corrected.
  const seeded = path.join(tmpDir, 'users.json');
  assert.ok(fs.existsSync(seeded), 'users.json copied to the persistent dir');

  const bundled = path.join(
    path.resolve(__dirname, '..'),
    'Webserver', 'http-db-bridge', 'data', 'users.json',
  );
  const expected = JSON.parse(fs.readFileSync(bundled, 'utf8'));
  assert.deepStrictEqual(
    storage.readJson('users.json', {}),
    expected,
    'the seeded copy must match the bundled defaults exactly',
  );
});

test('writeJson then readJson round-trips', () => {
  storage.writeJson('roundtrip.json', { hello: 'world', n: 42 });
  const back = storage.readJson('roundtrip.json', {});
  assert.strictEqual(back.hello, 'world');
  assert.strictEqual(back.n, 42);
});

test('writeJson is atomic (no .tmp leftovers)', () => {
  storage.writeJson('atomic.json', { a: 1 });
  const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
  assert.strictEqual(leftovers.length, 0, `leftovers: ${leftovers.join(',')}`);
});

test('readJson returns fallback for missing file', () => {
  const v = storage.readJson('does-not-exist.json', { fallback: true });
  assert.deepStrictEqual(v, { fallback: true });
});

test('readJson returns fallback for corrupt file', () => {
  const bad = path.join(tmpDir, 'corrupt.json');
  fs.writeFileSync(bad, '{ not valid json');
  const v = storage.readJson('corrupt.json', { safe: true });
  assert.deepStrictEqual(v, { safe: true });
});

test('data survives a simulated restart (new module instance)', () => {
  storage.writeJson('accounts.json', { users: { '99': { username: 'persisted' } } });

  // Simulate a process restart by clearing the require cache and re-requiring.
  delete require.cache[require.resolve('../server/storage')];
  const storage2 = require('../server/storage');
  const back = storage2.readJson('accounts.json', {});
  assert.strictEqual(back.users['99'].username, 'persisted');
});

test('describeStorage reports persistence state', () => {
  const d = storage.describeStorage();
  assert.strictEqual(d.persistent, true);
  assert.ok(d.note.includes('survive'));
});

// Cleanup
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (error) {
  /* ignore */
}

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);