'use strict';

/**
 * Switches hardcoded dark icon fills to `currentColor`.
 *
 * The Robux mark had this bug (fill="#FFFFFF" - white on a white surface, fixed
 * after the owner pointed out that ONLY the colour was wrong, not the artwork).
 * Three more icons have the same fault with a dark grey fill:
 *
 *   dropdown.svg  fill="#6b6e72"
 *   like.svg      fill="#393B3D"
 *   star.svg      fill="#393B3D"
 *
 * A fixed dark fill is invisible on the dark header, so CSS had to compensate
 * with `filter: brightness(0) invert(1) !important` on every icon in the header -
 * a blanket invert that is wrong for anything already light. `currentColor` makes
 * one file correct on both surfaces with no filter at all.
 *
 * play.svg is deliberately LEFT ALONE: it is used inside a green/blue button where
 * it must be white, and it is loaded as an <img> (its own document, so
 * currentColor would resolve to black). The filter exception for it is correct and
 * is documented in roblox.css. Converting it would be the bug.
 *
 * The artwork is not touched - only the `fill` attribute value.
 *
 * Usage: node tools/theme-icons.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons');

// Icons whose fill should follow the surrounding text colour.
const TARGETS = ['dropdown.svg', 'like.svg', 'star.svg'];

// Deliberately not converted, with the reason kept next to the list so a later
// session does not "helpfully" change them.
const SKIP = {
  'play.svg': 'white glyph inside a coloured button, loaded as <img>',
  'robux.svg': 'already currentColor',
};

let changed = 0;

for (const name of TARGETS) {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) {
    console.log(`skip   ${name} (not present)`);
    continue;
  }

  const original = fs.readFileSync(file, 'utf8');
  // Only rewrite an explicit hex fill on a shape. Everything else - the path
  // data, the viewBox, the title - is carried through byte for byte.
  const next = original.replace(
    /(<(?:path|rect|circle|ellipse|polygon|polyline)\b[^>]*?)fill="#[0-9A-Fa-f]{3,6}"/g,
    '$1fill="currentColor"',
  );

  if (next === original) {
    console.log(`skip   ${name} (no hardcoded fill on a shape)`);
    continue;
  }

  // Prove only the fill moved.
  const pathsBefore = (original.match(/ d="/g) || []).length;
  const pathsAfter = (next.match(/ d="/g) || []).length;
  if (pathsBefore !== pathsAfter) {
    console.error(`REFUSING ${name}: the shape data changed (${pathsBefore} -> ${pathsAfter})`);
    process.exit(1);
  }

  const before = (original.match(/fill="[^"]+"/g) || []).join(', ');
  const after = (next.match(/fill="[^"]+"/g) || []).join(', ');
  console.log(`${WRITE ? 'fixed ' : 'would '}${name}: ${before} -> ${after}`);

  if (WRITE) {
    fs.writeFileSync(file, next, { encoding: 'utf8' });
    changed += 1;
  }
}

for (const [name, why] of Object.entries(SKIP)) {
  if (fs.existsSync(path.join(DIR, name))) console.log(`intact ${name} (${why})`);
}

console.log('');
console.log(`${changed} icon(s) ${WRITE ? 'updated' : 'to update'}`);
if (!WRITE) console.log('run with --write to apply');