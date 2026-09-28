'use strict';

/**
 * Repairs mojibake in the project's own source files.
 *
 * The damage is a UTF-8 encoding read as latin-1 and then re-encoded: an em dash
 * stored as three bytes becomes three separate characters, and re-saving that as
 * UTF-8 stores six. The result renders as "أ¢â‚¬â€" instead of "—".
 *
 * This rewrites each broken sequence back to the character it was meant to be,
 * using \u escapes so THIS file needs no special encoding to be correct.
 *
 * It only ever replaces the known-broken sequences with their intended
 * characters - it does not re-encode or reformat the file, and it writes UTF-8
 * with NO BOM.
 *
 * Usage: node tools/fix-mojibake.js            (report only)
 *        node tools/fix-mojibake.js --write    (apply)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

// broken sequence -> the character it should be
const REPAIRS = [
  // Doubly-encoded (UTF-8 -> latin-1 -> UTF-8 again): these are the majority.
  ['\u0623\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u201d', '\u2014'], // em dash
  ['\u0623\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u201c', '\u2013'], // en dash
  ['\u0623\u00a2\u00e2\u201a\u00ac\u00e2\u201a\u00a6', '\u2026'], // ellipsis
  ['\u0623\u00a2\u00c2\u00b7', '\u00b7'],                        // middle dot
  ['\u0623\u00a2\u00e2\u201a\u00ac', '\u2014'],                  // trailing em dash fragment
  // Singly-encoded.
  ['\u00e2\u20ac\u201d', '\u2014'], // em dash
  ['\u00e2\u20ac\u201c', '\u2013'], // en dash
  ['\u00e2\u20ac\u00a6', '\u2026'], // ellipsis
  ['\u00c2\u00b7', '\u00b7'],       // middle dot
  ['\u00e2\u20ac\u0153', '\u201c'], // left double quote
  ['\u00e2\u20ac\u009d', '\u201d'], // right double quote
  ['\u00e2\u20ac\u2122', '\u2019'], // right single quote
  ['\u00e2\u20ac\u02dc', '\u2018'], // left single quote
  ['\u0631\u2122', '\u2019'],       // right single quote (double)
  // A stray replacement character is reported but not guessed at.
];

// The detector and this repairer must contain the sequences they look for, so
// scanning themselves would always report a hit. Also skipped: a `.kilo/worktrees`
// copy of the repo, which is a separate working tree - editing it would apply the
// same fix to a checkout that is not the one being served.
const SKIP_FILES = new Set([
  path.resolve(__filename),
  path.resolve(__dirname, 'find-mojibake.js'),
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.kilo', 'out', 'Clients', 'shared',
  'Assets', 'Web-2013 CCS+JS', 'data']);
const EXTS = new Set(['.ejs', '.js', '.css', '.php', '.json', '.html', '.md']);

function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
      if (!SKIP_FILES.has(path.resolve(full))) files.push(full);
    }
  }
  return files;
}

const files = walk(ROOT);
let changed = 0;
let replaced = 0;

for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }

  let next = text;
  for (const [broken, fixed] of REPAIRS) {
    if (next.includes(broken)) {
      const n = next.split(broken).length - 1;
      next = next.split(broken).join(fixed);
      replaced += n;
    }
  }

  if (next !== text) {
    changed += 1;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    console.log(`${WRITE ? 'fixed' : 'would fix'}  ${rel}`);
    if (WRITE) {
      // UTF-8, no BOM. A BOM before <!DOCTYPE html> forces quirks mode.
      fs.writeFileSync(file, next, { encoding: 'utf8' });
    }
  }
}

console.log('');
console.log(`${changed} file(s), ${replaced} sequence(s) ${WRITE ? 'repaired' : 'to repair'}`);
if (!WRITE && changed) {
  console.log('run with --write to apply');
}