'use strict';

/**
 * Normalise `}/* ...` into `}` + newline + `/* ...` in a CSS file.
 *
 * Cosmetic only: two blocks jammed onto one line still parse, but they make the
 * sheet hard to scan and have already caused a misread during review. This only
 * inserts the missing line break - it never reorders or rewrites declarations.
 *
 * Usage: node tools/fix-css-formatting.js <file.css> [--write]
 * Without --write it reports what it would change.
 */

const fs = require('fs');

const file = process.argv[2];
const write = process.argv.includes('--write');

if (!file) {
  console.error('Usage: node tools/fix-css-formatting.js <file.css> [--write]');
  process.exit(1);
}

const before = fs.readFileSync(file, 'utf8');

// Only the exact jammed form, so nothing else in the file is touched.
const matches = before.match(/\}\/\*/g) || [];
const after = before.replace(/\}\/\*/g, '}\n\n/*');

if (matches.length === 0) {
  console.log(`${file}: already formatted, nothing to do`);
  process.exit(0);
}

if (write) {
  fs.writeFileSync(file, after, 'utf8');
  console.log(`${file}: normalised ${matches.length} jammed brace(s)`);
} else {
  console.log(`${file}: would normalise ${matches.length} jammed brace(s) (pass --write)`);
}