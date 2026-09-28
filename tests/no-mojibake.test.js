'use strict';

/**
 * Guards the source against mojibake.
 *
 * These files are UTF-8. If a tool ever writes one as latin-1, an em dash or
 * ellipsis is destroyed and renders on the page as garbage rather than as the
 * character it was meant to be. It has happened here before - the project notes
 * warn about it - and it is invisible in an editor that guesses the encoding, so
 * it needs a machine check rather than a careful pair of eyes.
 *
 * This comment deliberately does NOT quote a damaged sequence. Writing one as an
 * example makes THIS file contain mojibake, and the scanner then (correctly)
 * reports it - which is how the guard failed the first time it was run. See
 * tools/find-mojibake.js for the actual byte patterns; it is excluded from its
 * own scan for exactly that reason.
 *
 * The check IS tools/find-mojibake.js, run as a subprocess so there is exactly
 * one definition of what counts as mojibake. That file is excluded from its own
 * scan (it must contain the sequences to look for them), which is why it is the
 * tool rather than a copy of the patterns.
 *
 * Run: node tests/no-mojibake.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tools', 'find-mojibake.js');

const result = spawnSync(process.execPath, [tool], { encoding: 'utf8', cwd: root });
const out = `${result.stdout || ''}${result.stderr || ''}`;

console.log('mojibake guard\n');

// The tool exits 1 when it finds anything.
assert.strictEqual(
  result.status,
  0,
  'mojibake found in the source:\n'
  + out.split('\n').filter((l) => l.trim()).map((l) => `       ${l}`).join('\n'),
);

// And confirm it actually scanned something, so a silently-broken tool cannot
// pass this test by finding nothing in nothing.
const scanned = /scanned (\d+) file/.exec(out);
assert.ok(scanned, `the scanner did not report a file count:\n${out}`);
assert.ok(
  Number(scanned[1]) > 100,
  `the scanner only saw ${scanned[1]} files - it is probably failing to walk the tree`,
);

console.log(`  ok   no mojibake in ${scanned[1]} source files`);
console.log('\nThe source is clean UTF-8.');