'use strict';

/**
 * Proves the Postgres store round-trips data, using a FAKE `pg` module.
 *
 * Why a fake: this machine has no database, and a test that needs a live Neon
 * instance cannot run in CI or on a fresh clone. The fake implements the same
 * tiny surface postgresStore.js uses (query, connect, end), so the REAL code
 * paths - schema creation, upsert, read, delete, list, restore - all execute.
 *
 * Run: node tests/postgres-store.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

let failures = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => console.log(`  ok   ${name}`),
        (error) => { failures += 1; console.log(`  FAIL ${name}\n       ${error.message}`); },
      );
    }
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
  return undefined;
}

console.log('postgresStore.js');

// --- The fake database ---------------------------------------------------

const rows = new Map();
const queries = [];

class FakePool {
  constructor(config) {
    this.config = config;
  }

  async query(sql, params) {
    queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) {
      return { rows: [] };
    }
    if (s.startsWith('SELECT data FROM blobs WHERE name')) {
      const hit = rows.get(params[0]);
      return { rows: hit === undefined ? [] : [{ data: hit }] };
    }
    if (s.startsWith('SELECT name, data FROM blobs')) {
      return { rows: [...rows.entries()].map(([name, data]) => ({ name, data })) };
    }
    if (s.startsWith('SELECT name FROM blobs')) {
      return { rows: [...rows.keys()].sort().map((name) => ({ name })) };
    }
    if (s.startsWith('INSERT INTO blobs')) {
      rows.set(params[0], JSON.parse(params[1]));
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM blobs')) {
      rows.delete(params[0]);
      return { rows: [] };
    }
    return { rows: [] };
  }

  on() { /* the real Pool is an EventEmitter; the store only subscribes */ }
  async end() { /* nothing to close */ }
}

// Intercept require('pg') so the real module is not needed.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'pg') return 'pg';
  return originalResolve.call(this, request, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: FakePool };
  return originalLoad.call(this, request, parent, isMain);
};

process.env.DATABASE_URL = 'postgresql://user:pw@fake.neon.tech/luckyblox?sslmode=require';

const store = require('../server/postgresStore');

(async () => {
  await check('reports enabled when DATABASE_URL is set', () => {
    assert.equal(store.ENABLED, true);
  });

  await check('init creates the schema', async () => {
    const r = await store.init();
    assert.equal(r.ok, true, r.error);
    assert.ok(queries.some((q) => q.sql.startsWith('CREATE TABLE IF NOT EXISTS blobs')));
  });

  await check('a missing document returns the fallback', async () => {
    const v = await store.readDoc('nope.json', { fallback: true });
    assert.deepStrictEqual(v, { fallback: true });
  });

  await check('write then read round-trips the document', async () => {
    await store.writeDoc('users.json', { 1: { username: 'tailsthehero10' } });
    const back = await store.readDoc('users.json', {});
    assert.equal(back['1'].username, 'tailsthehero10');
  });

  await check('a second write UPDATES rather than duplicating', async () => {
    await store.writeDoc('users.json', { 1: { username: 'renamed' }, 2: { username: 'second' } });
    const back = await store.readDoc('users.json', {});
    assert.equal(back['1'].username, 'renamed');
    assert.equal(back['2'].username, 'second');
    const upserts = queries.filter((q) => q.sql.startsWith('INSERT INTO blobs')
      && q.params[0] === 'users.json');
    assert.equal(upserts.length, 2, 'expected exactly two upsert statements');
    assert.ok(/ON CONFLICT \(name\) DO UPDATE/.test(upserts[1].sql));
  });

  await check('per-account files are ordinary rows', async () => {
    await store.writeDoc('7.json', { robux: 250 });
    const back = await store.readDoc('7.json', null);
    assert.equal(back.robux, 250);
  });

  await check('listDocs reports every stored name', async () => {
    const names = await store.listDocs();
    assert.ok(names.includes('users.json'));
    assert.ok(names.includes('7.json'));
  });

  await check('delete removes the row', async () => {
    await store.writeDoc('gone.json', { a: 1 });
    await store.deleteDoc('gone.json');
    const back = await store.readDoc('gone.json', { missing: true });
    assert.deepStrictEqual(back, { missing: true });
  });

  await check('restoreToDir writes the documents to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-pg-'));
    const r = await store.restoreToDir(dir);
    assert.equal(r.ok, true, r.error);
    assert.ok(r.loaded.includes('users.json'));
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
    assert.equal(written['1'].username, 'renamed');
    // No .tmp-pg leftovers.
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.tmp-pg')).length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('pushFromDir uploads local files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-pg2-'));
    fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify({ 1818: { title: 'Crossroads' } }), 'utf8');
    const r = await store.pushFromDir(dir);
    assert.equal(r.ok, true);
    assert.ok(r.pushed.includes('games.json'));
    const back = await store.readDoc('games.json', {});
    assert.equal(back['1818'].title, 'Crossroads');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('describe reports the backend', () => {
    const d = store.describe();
    assert.equal(d.enabled, true);
    assert.ok(/Postgres/i.test(d.note));
  });

  await store.close();

  console.log(
    failures === 0
      ? '\nPostgres storage round-trips correctly.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})();