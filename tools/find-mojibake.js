'use strict';

/**
 * Finds mojibake in the views and JS: UTF-8 bytes that were re-encoded as
 * latin-1, so an em dash, ellipsis or middle dot renders as garbage such as
 * "أ¢â‚¬â€" or "â€¦" on the page.
 *
 * The project notes call this out explicitly - these files are UTF-8 and must
 * never be written by a tool that re-encodes them. This is what catches it when
 * one does.
 *
 * The patterns are the classic double- and triple-encoded sequences. They are
 * built from escapes so this file stays readable ASCII and cannot itself be the
 * thing that introduces the problem it looks for.
 *
 * Run: node tools/find-mojibake.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Each entry is a mojibake sequence. Written as escapes so this source file needs
// no special encoding to be correct.
const PATTERNS = [
  { name: 'em dash (â€”)', bytes: '\u00e2\u20ac\u201d' },
  { name: 'en dash (â€“)', bytes: '\u00e2\u20ac\u201c' },
  { name: 'ellipsis (â€¦)', bytes: '\u00e2\u20ac\u00a6' },
  { name: 'middle dot (Â·)', bytes: '\u00c2\u00b7' },
  { name: 'left quote (â€œ)', bytes: '\u00e2\u20ac\u0153' },
  { name: 'right quote (â€™)', bytes: '\u00e2\u20ac\u2122' },
  // The doubly-encoded forms, which is what most of the damage here actually is:
  // UTF-8 read as latin-1, then re-encoded as UTF-8 again.
  { name: 'em dash (double: أ¢â‚¬â€) ', bytes: '\u0623\u00a2\u00e2\u201a\u00ac\u00e2\u20ac' },
  { name: 'ellipsis (double: أ¢â‚¬آ¦)', bytes: '\u0623\u00a2\u00e2\u201a\u00ac\u00e2\u201a\u00a6' },
  { name: 'middle dot (double)', bytes: '\u0623\u00a2\u00c2\u00b7' },
  { name: 'right single quote (ر™)', bytes: '\u0631\u2122' },
  { name: 'replacement char', bytes: '\ufffd' },
];

const EXTS = new Set(['.ejs', '.js', '.css', '.php', '.json', '.html', '.md']);

// This file must CONTAIN the sequences by definition (the pattern table below),
// so scanning itself would always report a hit. Everything else is fair game -
// including the notes and the tests that describe the problem.
const SKIP_FILES = new Set([
  path.resolve(__filename),
  // The repairer holds the same table in reverse.
  path.resolve(__dirname, 'fix-mojibake.js'),
]);

// Vendored trees, generated output, and a separate working tree (.kilo). These
// are not ours to edit and would only add noise - or, for .kilo, apply the same
// fix to a checkout that is not the one being served.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.kilo', 'out', 'Clients', 'shared', 'Assets',
  'Web-2013 CCS+JS', 'data',
]);

function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return files; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
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
const findings = [];

for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      const at = line.indexOf(p.bytes);
      if (at === -1) continue;
      findings.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        name: p.name,
        context: line.trim().slice(0, 100),
      });
      break; // one report per line is enough to act on
    }
  });
}

console.log(`scanned ${files.length} file(s)\n`);

if (!findings.length) {
  console.log('No mojibake found.');
  process.exitCode = 0;
} else {
  for (const f of findings) {
    console.log(`${f.file}:${f.line}  [${f.name}]`);
    console.log(`    ${f.context}`);
  }
  console.log(`\n${findings.length} line(s) with mojibake.`);
  console.log('These render as garbage on the page. Re-type the character (em dash,');
  console.log('ellipsis, middle dot) or use the HTML entity, and save as UTF-8 WITHOUT');
  console.log('a BOM.');
  process.exitCode = 1;
}