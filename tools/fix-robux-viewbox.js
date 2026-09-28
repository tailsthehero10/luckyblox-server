'use strict';

/**
 * Repairs the Robux mark's viewBox by MEASURING the artwork.
 *
 * The icon is a VTracer trace with two quirks that make a hand-picked viewBox
 * wrong:
 *
 *   1. the geometry sits on NEGATIVE coordinates (the trace kept its offsets), so
 *      a "0 0 W H" box clips the left half;
 *   2. each path carries its own transform="translate(x,y)", which moves it.
 *
 * My first attempt guessed the box (-240 -20 500 300) and it clipped the mark to a
 * sliver - which is why the header rendered a bare symbol instead of the Robux
 * glyph. This walks the path data, applies each translate, and derives the real
 * bounding box, then pads it slightly.
 *
 * The artwork itself is not altered: only the viewBox attribute changes.
 *
 * Usage: node tools/fix-robux-viewbox.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const FILE = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons', 'robux.svg');
const BACKUP = `${FILE}.orig`;

// Prefer the pristine original if a backup exists, so this is repeatable.
const source = fs.existsSync(BACKUP) ? BACKUP : FILE;
let svg = fs.readFileSync(source, 'utf8');

console.log(`source: ${path.relative(process.cwd(), source)}\n`);

/** Every absolute coordinate a path visits, with its translate applied. */
function boundsOf(svgText) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const pathRe = /<path\b([^>]*)\/?>/g;
  let m;

  while ((m = pathRe.exec(svgText))) {
    const attrs = m[1];
    const d = (/ d="([^"]+)"/.exec(attrs) || [])[1] || '';
    const t = /transform="translate\(([-\d.]+)[ ,]+([-\d.]+)\)"/.exec(attrs);
    const dx = t ? Number(t[1]) : 0;
    const dy = t ? Number(t[2]) : 0;

    // Walk the path commands. Only absolute commands move the pen to a known
    // point; relative ones are tracked from the current position. For a bounding
    // box this is exact for M/L/C/S/Q/T and approximate (still safe) for arcs.
    let cx = 0;
    let cy = 0;
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0;

    const num = () => Number(tokens[i++]);
    const touch = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };

    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (!/[A-Za-z]/.test(cmd)) continue;

      const rel = cmd === cmd.toLowerCase();
      const c = cmd.toUpperCase();
      const base = () => (rel ? [cx, cy] : [0, 0]);

      if (c === 'M' || c === 'L' || c === 'T') {
        const b = base();
        const x = num() + b[0];
        const y = num() + b[1];
        cx = x; cy = y;
        touch(x + dx, y + dy);
      } else if (c === 'H') {
        let x = num();
        if (rel) x += cx;
        cx = x;
        touch(x + dx, cy + dy);
      } else if (c === 'V') {
        let y = num();
        if (rel) y += cy;
        cy = y;
        touch(cx + dx, y + dy);
      } else if (c === 'C') {
        const b = base();
        const x1 = num() + b[0]; const y1 = num() + b[1];
        const x2 = num() + b[0]; const y2 = num() + b[1];
        const x = num() + b[0]; const y = num() + b[1];
        cx = x; cy = y;
        touch(x1 + dx, y1 + dy);
        touch(x2 + dx, y2 + dy);
        touch(x + dx, y + dy);
      } else if (c === 'S' || c === 'Q') {
        const b = base();
        const x1 = num() + b[0]; const y1 = num() + b[1];
        const x = num() + b[0]; const y = num() + b[1];
        cx = x; cy = y;
        touch(x1 + dx, y1 + dy);
        touch(x + dx, y + dy);
      } else if (c === 'A') {
        num(); num(); num(); num(); num();
        const b = base();
        const x = num() + b[0];
        const y = num() + b[1];
        cx = x; cy = y;
        touch(x + dx, y + dy);
      } else if (c === 'Z') {
        // closes to the subpath start; already touched
      }
    }
  }

  return { minX, minY, maxX, maxY };
}

const b = boundsOf(svg);
console.log('measured bounds of the artwork:');
console.log(`  x: ${b.minX.toFixed(1)} .. ${b.maxX.toFixed(1)}`);
console.log(`  y: ${b.minY.toFixed(1)} .. ${b.maxY.toFixed(1)}`);

if (!Number.isFinite(b.minX) || b.maxX <= b.minX) {
  console.error('\nCould not measure the artwork - refusing to write a guessed viewBox.');
  process.exit(1);
}

// A margin so no part of the outline is shaved off at 16px.
//
// The trace's outline is a FILLED shape, not a stroke - measured bounds are the
// centre of that ring, so the box must sit outside it. 4px was visibly too tight
// (the mark showed a flat shaved edge on the left and bottom at large sizes), so
// the margin is a fraction of the artwork instead of a fixed pixel count: 6% of
// the larger side scales with the icon and stays correct at any size.
const spanX = b.maxX - b.minX;
const spanY = b.maxY - b.minY;
const pad = Math.ceil(Math.max(spanX, spanY) * 0.06);

const minX = Math.floor(b.minX - pad);
const minY = Math.floor(b.minY - pad);
const w = Math.ceil(spanX + pad * 2);
const h = Math.ceil(spanY + pad * 2);

const viewBox = `${minX} ${minY} ${w} ${h}`;
console.log(`\n  -> viewBox="${viewBox}"`);

const before = svg;
if (/viewBox="/.test(svg)) {
  svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
} else {
  svg = svg.replace(/(<svg\b[^>]*?)(\s+width=")/, `$1 viewBox="${viewBox}"$2`);
}

// The shape must be untouched: every path, and every other attribute, byte for
// byte. Inserting a viewBox where there was none necessarily adds characters, so
// the comparison strips the attribute from BOTH and requires the rest to match.
const stripViewBox = (t) => t.replace(/\s*viewBox="[^"]*"/, '');
if (stripViewBox(svg) !== stripViewBox(before)) {
  console.error('\nREFUSING TO WRITE: something other than the viewBox changed.');
  process.exit(1);
}

// And the path data itself must be identical, which is the real guarantee.
const pathData = (t) => (t.match(/ d="[^"]*"/g) || []).join('|');
if (pathData(svg) !== pathData(before)) {
  console.error('\nREFUSING TO WRITE: the path geometry changed.');
  process.exit(1);
}

console.log('  shape data unchanged');

if (WRITE) {
  fs.writeFileSync(FILE, svg, { encoding: 'utf8' });
  console.log(`\nwrote ${path.relative(process.cwd(), FILE)}`);
} else {
  console.log('\nrun with --write to apply');
}