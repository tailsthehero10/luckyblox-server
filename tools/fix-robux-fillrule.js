'use strict';

/**
 * Puts `fill-rule="evenodd"` on the Robux mark's OUTLINE path only.
 *
 * The mark is two paths from a VTracer trace:
 *
 *   path 1  the hexagon OUTLINE. It has an inner subpath - the counter - which
 *           `nonzero` (the SVG default) fills SOLID, so the badge read as a blob
 *           with a square centre. `evenodd` is what makes it a ring.
 *   path 2  the badge BODY. It has many inner subpaths of its own, and `evenodd`
 *           cuts THOSE out too - which turned the mark into a figure-shaped hole
 *           (the header showed a person silhouette instead of a coin).
 *
 * So the rule belongs on path 1 and NOT on path 2. Applying it uniformly was my
 * mistake; this fixes it and refuses to run if the path order is not what it
 * expects, so it cannot quietly apply the rule to the wrong shape.
 *
 * Usage: node tools/fix-robux-fillrule.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const FILE = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons', 'robux.svg');
const ORIG = `${FILE}.orig`;

// Work from the pristine trace when available, so this is idempotent.
let svg = fs.readFileSync(fs.existsSync(ORIG) ? ORIG : FILE, 'utf8');
const source = fs.existsSync(ORIG) ? ORIG : FILE;
console.log(`source: ${path.relative(process.cwd(), source)}\n`);

const paths = [...svg.matchAll(/<path\b[^>]*>/g)];
if (paths.length !== 2) {
  console.error(`expected exactly 2 paths, found ${paths.length} - refusing to guess`);
  process.exit(1);
}

// Identify the outline: it is the one whose data contains more than one "M"
// (multiple subpaths) AND is drawn earlier in the file.
const dOf = (tag) => (/ d="([^"]*)"/.exec(tag[0]) || [])[1] || '';
const subpathsOf = (tag) => (dOf(tag).match(/M/gi) || []).length;

const counts = paths.map(subpathsOf);
console.log(`  subpaths per path: ${counts.join(', ')}`);

const outlineIndex = counts[0] > 1 ? 0 : (counts[1] > 1 ? 1 : -1);
if (outlineIndex === -1) {
  console.error('  neither path has multiple subpaths - refusing to guess which is the outline');
  process.exit(1);
}
console.log(`  path ${outlineIndex + 1} is the outline (gets evenodd)`);
console.log(`  path ${outlineIndex === 0 ? 2 : 1} is the body (must NOT get evenodd)`);

// Rebuild: currentColor everywhere, evenodd on the outline only.
let out = svg;

// 1. Normalise the fills first (no fill-rule anywhere yet).
out = out.replace(/fill="#FFFFFF"/gi, 'fill="currentColor"');
out = out.replace(/fill="currentColor"\s+fill-rule="evenodd"/g, 'fill="currentColor"');
out = out.replace(/fill-rule="evenodd"\s+fill="currentColor"/g, 'fill="currentColor"');

// 2. Tag only the outline.
let seen = -1;
out = out.replace(/<path\b[^>]*>/g, (tag) => {
  seen += 1;
  if (seen !== outlineIndex) return tag;
  return tag.replace('fill="currentColor"', 'fill="currentColor" fill-rule="evenodd"');
});

// --- Verify only the intended change happened -------------------------------

const pathData = (t) => (t.match(/ d="[^"]*"/g) || []).join('|');
if (pathData(out) !== pathData(svg)) {
  console.error('\nREFUSING TO WRITE: the path geometry changed.');
  process.exit(1);
}

const rules = [...out.matchAll(/<path\b[^>]*>/g)].map((m) => /fill-rule="evenodd"/.test(m[0]));
console.log(`\n  evenodd applied to: ${rules.map((r, i) => (r ? `path ${i + 1}` : null)).filter(Boolean).join(', ') || '(none)'}`);

if (rules.filter(Boolean).length !== 1) {
  console.error('REFUSING TO WRITE: expected exactly one path to carry evenodd.');
  process.exit(1);
}

if (WRITE) {
  fs.writeFileSync(FILE, out, { encoding: 'utf8' });
  console.log(`\nwrote ${path.relative(process.cwd(), FILE)}`);
} else {
  console.log('\nrun with --write to apply');
}