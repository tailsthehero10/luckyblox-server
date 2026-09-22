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
  const users = storage.readJson('users.json', {});
  assert.ok(users['1'], 'bundled user 1 was seeded');
  assert.ok(fs.existsSync(path.join(tmpDir, 'users.json')), 'file copied to temp dir');
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