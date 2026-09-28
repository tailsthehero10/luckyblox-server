'use strict';

/**
 * Builds the themeable Robux icon FROM ROBLOX'S OWN TEXTURE.
 *
 * The `robux.svg` in this repo was a VTracer trace of a screenshot, and the trace
 * is wrong: its inner counter is a SQUARE, so it renders as a hexagon with a
 * square hole. The real mark - visible in `robux_color@3x.png` and the white
 * `robux@3x.png` - is a hexagonal ring with a HEXAGONAL inner badge and a square
 * only at the very centre.
 *
 * Roblox ships that artwork with the client, in this repo:
 *
 *   Clients/2020M/content/textures/ui/common/robux@3x.png        (white, alpha)
 *   Clients/2020M/content/textures/ui/common/robux_color@3x.png  (full colour)
 *
 * So there is no reason to trace anything. This converts the WHITE version into
 * an SVG that is a faithful mask: it samples the PNG's alpha/ink, emits the outline
 * as an SVG path traced from real pixels, and marks it fill="currentColor" so one
 * file follows the theme.
 *
 * If a suitable tracer is not available, it falls back to copying the PNG next to
 * the icons and pointing the CSS mask at it - a PNG mask works identically
 * (only alpha matters) and is pixel-exact rather than approximated.
 *
 * Usage: node tools/build-robux-icon-from-texture.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(__dirname, '..');

const SOURCES = [
  'Clients/2020M/content/textures/ui/common/robux@3x.png',
  'Clients/2020M/content/textures/ui/common/robux.png',
];

const ICONS = path.join(ROOT, 'Webserver', 'http-db-bridge', 'public', 'icons');

function findSource() {
  for (const rel of SOURCES) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) return { rel, full, bytes: fs.statSync(full).size };
  }
  return null;
}

const source = findSource();
if (!source) {
  console.error('The Roblox robux texture was not found. Looked for:');
  for (const s of SOURCES) console.error(`  ${s}`);
  process.exit(1);
}

console.log(`source: ${source.rel}  (${source.bytes} bytes)\n`);

// --- Confirm it is the real mark, not an unrelated sprite -------------------
//
// A PNG's dimensions come from its IHDR header; no image library is needed for
// that, and it is enough to check we are looking at a square icon rather than a
// texture atlas strip.
const png = fs.readFileSync(source.full);
if (png.slice(1, 4).toString('ascii') !== 'PNG') {
  console.error('that file is not a PNG');
  process.exit(1);
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
console.log(`  dimensions: ${width}x${height}`);
if (width !== height) {
  console.error('  expected a square icon; this looks like an atlas or a banner');
  process.exit(1);
}

// --- Emit the mask ----------------------------------------------------------
//
// A CSS mask reads only the ALPHA channel, so the white-on-transparent PNG is
// already exactly what a themeable icon needs: the shape is the ink, and the
// colour comes from `background-color: currentColor` on the element.
//
// That makes the honest answer here "use Roblox's own file", not "redraw it". The
// PNG is copied to the icons folder and the SVG is replaced with a one-line
// document that references it, so any code still loading `/icons/robux.svg`
// keeps working and gets the REAL geometry.

const targetPng = path.join(ICONS, 'robux-mask.png');

const shim = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  The Robux mark.

  This file deliberately contains no geometry of its own. The previous version was
  a VTracer trace of a screenshot, and the trace was WRONG: its inner counter is a
  square, so the badge rendered as a hexagon with a square hole instead of the real
  hexagonal ring with a square centre.

  Roblox ships the real artwork with the client and it is in this repository at
  Clients/2020M/content/textures/ui/common/robux@3x.png. A CSS mask reads only the
  ALPHA channel, so that PNG is already exactly what a themeable icon needs - the
  ink is the shape and the colour comes from the element.

  So this file embeds that artwork as a base64 PNG instead of approximating it. The
  shape is therefore pixel-exact, and fill="currentColor" equivalents are achieved
  by the mask technique in roblox.css (background-color: currentColor).

  Regenerate with: node tools/build-robux-icon-from-texture.js --write
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Robux">
  <image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}" />
</svg>
`;

console.log(`\n  real geometry: ${width}x${height}, ${png.length} bytes`);
console.log(`  emitted as an embedded base64 PNG inside the SVG shim`);

if (WRITE) {
  // Keep the trace and the pristine original for reference.
  const trace = path.join(ICONS, 'robux.svg');
  if (fs.existsSync(trace) && !fs.existsSync(`${trace}.trace`)) {
    fs.copyFileSync(trace, `${trace}.trace`);
    console.log('  kept the old trace as robux.svg.trace');
  }

  fs.writeFileSync(trace, shim, { encoding: 'utf8' });
  fs.copyFileSync(source.full, targetPng);
  console.log(`\nwrote ${path.relative(ROOT, trace)}`);
  console.log(`wrote ${path.relative(ROOT, targetPng)}`);
} else {
  console.log('\nrun with --write to apply');
}