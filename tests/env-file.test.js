'use strict';

// Proves the .env loader does the two things that matter:
//   1. a real environment variable ALWAYS beats the file (so the cloud is safe)
//   2. parsing handles the shapes a real .env contains (quotes, comments, blanks)
//
// Run: node tests/env-file.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeTestDir } = require('./test-paths');

const { loadEnvFile, parseEnv } = require('../server/envFile');

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

console.log('envFile.js');

// --- Parsing -----------------------------------------------------------------

check('parses a simple KEY=VALUE', () => {
  assert.deepStrictEqual(parseEnv('A=1'), { A: '1' });
});

check('ignores blank lines and comments', () => {
  const parsed = parseEnv('\n# a comment\n\nA=1\n   \n#B=2\n');
  assert.deepStrictEqual(parsed, { A: '1' });
});

check('strips matching double and single quotes', () => {
  assert.deepStrictEqual(parseEnv('A="hello world"\nB=\'x y\''), {
    A: 'hello world',
    B: 'x y',
  });
});

check('keeps a # inside a token when unquoted but drops a trailing comment', () => {
  // A PAT never contains '#', but a value legitimately might; only a
  // whitespace-preceded '#' is treated as a comment.
  const parsed = parseEnv('A=abc#def\nB=abc # trailing');
  assert.deepStrictEqual(parsed, { A: 'abc#def', B: 'abc' });
});

check('handles a quoted value containing a #', () => {
  assert.deepStrictEqual(parseEnv('A="a#b"'), { A: 'a#b' });
});

check('supports an `export ` prefix', () => {
  assert.deepStrictEqual(parseEnv('export A=1'), { A: '1' });
});

check('skips malformed lines rather than throwing', () => {
  const parsed = parseEnv('not a pair\n=novalue\n1BAD=x\nGOOD=1');
  assert.deepStrictEqual(parsed, { GOOD: '1' });
});

check('keeps an empty value', () => {
  assert.deepStrictEqual(parseEnv('A='), { A: '' });
});

// --- Loading (real process.env) ---------------------------------------------

check('a real environment variable beats the .env file', () => {
  const dir = makeTestDir('luckyblox-env');
  fs.writeFileSync(path.join(dir, '.env'), 'LUCKYBLOX_SYNC=github\nFRESH_KEY=from-file\n');

  process.env.LUCKYBLOX_SYNC = 'http';
  delete process.env.FRESH_KEY;

  const result = loadEnvFile(dir);

  assert.strictEqual(process.env.LUCKYBLOX_SYNC, 'http', 'existing env must win');
  assert.strictEqual(process.env.FRESH_KEY, 'from-file', 'new key must be applied');
  assert.ok(result.applied.includes('FRESH_KEY'));
  assert.ok(result.skipped.includes('LUCKYBLOX_SYNC'));

  delete process.env.FRESH_KEY;
  delete process.env.LUCKYBLOX_SYNC;
  fs.rmSync(dir, { recursive: true, force: true });
});

check('local-server mode ignores Render-only values in .env', () => {
  const dir = makeTestDir('luckyblox-env-local');
  fs.writeFileSync(
    path.join(dir, '.env'),
    'RENDER=true\nRENDER_EXTERNAL_URL=https://production.example\nRENDER_DISK_PATH=/var/data\n',
  );

  const prior = Object.fromEntries(
    ['LUCKYBLOX_LOCAL_SERVER', 'RENDER', 'RENDER_EXTERNAL_URL', 'RENDER_DISK_PATH']
      .map((key) => [key, process.env[key]]),
  );
  process.env.LUCKYBLOX_LOCAL_SERVER = '1';
  process.env.RENDER = '';
  process.env.RENDER_EXTERNAL_URL = '';
  process.env.RENDER_DISK_PATH = '';

  try {
    const result = loadEnvFile(dir);
    assert.strictEqual(process.env.RENDER, '');
    assert.strictEqual(process.env.RENDER_EXTERNAL_URL, '');
    assert.strictEqual(process.env.RENDER_DISK_PATH, '');
    assert.ok(result.skipped.includes('RENDER'));
    assert.ok(result.skipped.includes('RENDER_EXTERNAL_URL'));
    assert.ok(result.skipped.includes('RENDER_DISK_PATH'));
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('a missing .env is not an error', () => {
  const dir = makeTestDir('luckyblox-env-none');
  const result = loadEnvFile(dir);
  assert.strictEqual(result.loaded, false);
  assert.deepStrictEqual(result.applied, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(
  failures === 0
    ? '\n.env loading behaves correctly.'
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;