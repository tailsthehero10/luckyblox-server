'use strict';

/**
 * Makes the Robux mark THEMED without touching its shape.
 *
 * The icon is a VTracer trace of the real Roblox Robux glyph. It was replaced
 * once with a hand-drawn approximation, which was wrong: the artwork is Roblox's
 * and should stay pixel-for-pixel as it is. The ONLY thing that was ever broken is
 * the COLOUR - it hardcoded `fill="#FFFFFF"`, so the mark was white on a white or
 * light-grey surface and could not follow the theme.
 *
 * This does the minimum needed to fix that and nothing else:
 *
 *   1. adds a `viewBox` so the 236x260 artwork can scale into a 16x16 mask box.
 *      Without one the shape is drawn at raw user units, so it is cropped to a
 *      corner - which looked like a different (broken) glyph.
 *   2. changes `fill="#FFFFFF"` to `fill="currentColor"` so the SAME file works
 *      both as a CSS mask (painted with background-color) and as an <img> that
 *      follows the text colour. The geometry is untouched.
 *
 * Every path, coordinate and command is copied through unchanged.
 *
 * Usage: node tools/theme-robux-icon.js [--write] [--from <file>]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const fromArg = process.argv.indexOf('--from');
const TARGET = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons', 'robux.svg');

// The source artwork. Prefer a backup if one exists, so this can be re-run.
const SOURCES = [
  fromArg !== -1 ? process.argv[fromArg + 1] : null,
  path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons', 'robux.svg.orig'),
  path.join(__dirname, '..', '.kilo', 'worktrees', 'thread-wheel',
    'Webserver', 'http-db-bridge', 'public', 'icons', 'robux.svg'),
].filter(Boolean);

function pickSource() {
  for (const candidate of SOURCES) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, 'utf8');
    // Only accept a genuine trace of the real mark: it must carry VTracer's
    // marker or a curve-heavy path, and must NOT be my hand-drawn replacement.
    const looksTraced = /VTracer/i.test(text) || (text.match(/ [A-Z][\d. ]/g) || []).length > 50;
    const isHandDrawn = /M12 1\.4 21\.2/.test(text);
    if (looksTraced && !isHandDrawn) return { file: candidate, text };
  }
  return null;
}

const source = pickSource();
if (!source) {
  console.error('Could not find the original traced robux.svg.');
  console.error('Looked in:');
  for (const s of SOURCES) console.error(`  ${s}`);
  process.exit(1);
}

console.log(`source: ${path.relative(process.cwd(), source.file)}\n`);

let svg = source.text;

// --- 1. Report the shape, so the change is auditable -------------------------

const pathCount = (svg.match(/<path\b/g) || []).length;
const commandCount = (svg.match(/[A-Za-z]/g) || []).length;
console.log(`  paths: ${pathCount}`);
console.log(`  hardcoded fills before: ${(svg.match(/fill="#[0-9A-Fa-f]{3,6}"/g) || []).join(', ') || '(none)'}`);

// --- 2. Add a viewBox, preserving the existing coordinates -------------------

// width="236" height="260" with geometry that runs through negative coordinates
// and uses transform="translate(133.74, 44.81)". A plain "0 0 236 260" viewBox
// would clip the left half. "userSpaceOnUse" style viewBox covering the real
// extent keeps every coordinate exactly where the trace put it.
if (!/viewBox=/.test(svg)) {
  const w = Number((svg.match(/width="(\d+(?:\.\d+)?)"/) || [])[1] || 236);
  const h = Number((svg.match(/height="(\d+(?:\.\d+)?)"/) || [])[1] || 260);

  // The trace's geometry spans roughly -230..250 horizontally and -10..270
  // vertically once its transforms are applied. A padded box keeps it whole.
  const minX = -240;
  const minY = -20;
  const boxW = 500;
  const boxH = 300;

  svg = svg.replace(
    /(<svg\b[^>]*?)(\s+width="[^"]*")/,
    `$1 viewBox="${minX} ${minY} ${boxW} ${boxH}"$2`,
  );
  console.log(`  viewBox added: ${minX} ${minY} ${boxW} ${boxH}  (from ${w}x${h})`);
} else {
  console.log('  viewBox already present');
}

// --- 3. Colour: fill follows the theme, geometry untouched -------------------

const before = svg;
svg = svg.replace(/fill="#FFFFFF"/gi, 'fill="currentColor"');
svg = svg.replace(/fill="#ffffff"/g, 'fill="currentColor"');
if (svg === before) {
  console.log('  no hardcoded white fill found (already themed, or a different colour)');
} else {
  console.log('  fill="#FFFFFF" -> fill="currentColor"');
}

console.log(`  paths after: ${(svg.match(/<path\b/g) || []).length}`);
console.log(`  commands after: ${(svg.match(/[A-Za-z]/g) || []).length}`);

if (pathCount !== (svg.match(/<path\b/g) || []).length) {
  console.error('\nREFUSING TO WRITE: the path count changed. This tool must not alter the shape.');
  process.exit(1);
}

// Preserve the original next to the target, so this is repeatable.
const backup = `${TARGET}.orig`;
if (WRITE && !fs.existsSync(backup) && source.file !== backup) {
  fs.writeFileSync(backup, source.text, { encoding: 'utf8' });
  console.log(`\n  backup written: ${path.basename(backup)}`);
}

if (WRITE) {
  fs.writeFileSync(TARGET, svg, { encoding: 'utf8' });
  console.log(`\nwrote ${path.relative(process.cwd(), TARGET)}`);
} else {
  console.log('\nrun with --write to apply');
}