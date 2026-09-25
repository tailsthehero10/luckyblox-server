'use strict';

/**
 * Proves the client-version resolution picks the NEWEST build, including the
 * case a plain string sort gets backwards.
 *
 * Run: node tests/client-version-order.test.js
 *
 * Why this matters: both server/clientLauncher.js (which binary to launch) and
 * Webserver/http-db-bridge/clientBuildInfo.js (which build the manifest
 * advertises and serves) walk Versions/<v>/ and take the last entry after a
 * sort. With a plain string sort, "2021.9" > "2021.10", so both would silently
 * choose the OLDER build - a stale client with no error anywhere.
 *
 * The test builds a real Versions/ tree on disk with multi-digit segments and
 * asserts the newest one wins.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..');
const clientLauncher = require(path.join(releaseRoot, 'server', 'clientLauncher.js'));

const BINARY = process.platform === 'win32' ? 'RobloxPlayerBeta.exe' : 'RobloxPlayerBeta';

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

// A real install root with several versions, deliberately including the pair a
// string sort orders incorrectly (2021.9 vs 2021.10).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-clientver-'));
const versionsDir = path.join(root, 'Luckyblox', 'Versions');

const versions = ['2021.2', '2021.9', '2021.10', '2021.11'];
for (const version of versions) {
  const dir = path.join(versionsDir, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BINARY), `${version}-binary`);
}

console.log('client version ordering');

test('resolves the newest version, not the string-sorted last one', () => {
  // The launcher resolves through its candidate roots, where
  // LUCKYBLOX_CLIENT_ROOT is joined with the "Luckyblox" folder name - so
  // pointing the env var at our temp root drives the real code path rather
  // than a test-only entry point.
  const previous = process.env.LUCKYBLOX_CLIENT_ROOT;
  process.env.LUCKYBLOX_CLIENT_ROOT = root;

  let actual;
  try {
    actual = clientLauncher.resolveClientBinary();
  } finally {
    if (previous === undefined) delete process.env.LUCKYBLOX_CLIENT_ROOT;
    else process.env.LUCKYBLOX_CLIENT_ROOT = previous;
  }

  assert.ok(actual, 'a client binary was resolved');
  assert.ok(
    actual.includes('2021.11'),
    `expected the newest version (2021.11) but resolved ${actual}`,
  );
});

test('a string sort would have chosen 2021.9 over 2021.10 (the bug this guards)', () => {
  // Demonstrates why the numeric comparison is required: this assertion is
  // about the LANGUAGES's default sort, and it must keep holding, otherwise the
  // guard below is pointless.
  const stringSorted = versions.slice().sort();
  const lastByString = stringSorted[stringSorted.length - 1];
  assert.strictEqual(lastByString, '2021.9', 'plain sort still puts 2021.9 last');

  // And with the numeric comparison the newest is correct.
  const numericSorted = versions.slice().sort((a, b) => {
    const pa = a.split(/[.\-_]/).map(Number);
    const pb = b.split(/[.\-_]/).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const va = pa[i] || 0;
      const vb = pb[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  });
  assert.strictEqual(numericSorted[numericSorted.length - 1], '2021.11');
});

test('the manifest module resolves the same newest build', () => {
  const buildInfoPath = path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'clientBuildInfo.js');
  if (!fs.existsSync(buildInfoPath)) {
    console.log('        (skipped: clientBuildInfo.js not present)');
    return;
  }

  const previous = process.env.LUCKYBLOX_CLIENT_ROOT;
  process.env.LUCKYBLOX_CLIENT_ROOT = root;
  delete require.cache[require.resolve(buildInfoPath)];
  try {
    const clientBuildInfo = require(buildInfoPath);
    const info = clientBuildInfo.getClientBuildInfo();
    assert.strictEqual(
      info.version,
      '2021.11',
      `manifest advertised ${info.version} instead of the newest build`,
    );
  } finally {
    if (previous === undefined) delete process.env.LUCKYBLOX_CLIENT_ROOT;
    else process.env.LUCKYBLOX_CLIENT_ROOT = previous;
  }
});

try {
  fs.rmSync(root, { recursive: true, force: true });
} catch (error) {
  /* ignore */
}

console.log(`\n${passed} assertion(s) passed${process.exitCode ? ' (with failures)' : ''}`);
process.exit(process.exitCode || 0);