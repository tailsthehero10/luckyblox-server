'use strict';

/**
 * Test scratch directories that live on the RELEASE drive, not on C:.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every test that boots a server isolates its data with
 * `fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-...'))`. On Windows
 * `os.tmpdir()` is C:\Users\<user>\AppData\Local\Temp. This machine's C: drive is
 * nearly full and the project lives on E:, so running the test suite should not
 * consume C: space (a few of the tests copy whole client trees).
 *
 * `makeTestDir(prefix)` returns a unique directory under <release>\.tmp\test-* on
 * the same drive as the release. Set LUCKYBLOX_TMP to point elsewhere.
 *
 * Usage:
 *   const { makeTestDir } = require('./test-paths');
 *   const tmpDir = makeTestDir('luckyblox-jobs');
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RELEASE_ROOT = path.resolve(__dirname, '..');

/** The base scratch directory for tests, on the release drive. */
function testScratchRoot() {
  const explicit = process.env.LUCKYBLOX_TMP;
  const base = explicit && explicit.trim()
    ? explicit.trim()
    : path.join(RELEASE_ROOT, '.tmp');
  const dir = path.join(base, 'test');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (error) { /* surfaced below */ }
  return dir;
}

/**
 * A unique scratch directory for a test, on the release drive.
 *
 * Falls back to os.tmpdir() only if the release drive is not writable, so a
 * read-only checkout still runs the suite instead of failing outright.
 */
function makeTestDir(prefix) {
  const name = String(prefix || 'luckyblox-test').replace(/[^a-zA-Z0-9._-]/g, '-');
  try {
    return fs.mkdtempSync(path.join(testScratchRoot(), `${name}-`));
  } catch (error) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  }
}

module.exports = { makeTestDir, testScratchRoot, RELEASE_ROOT };
