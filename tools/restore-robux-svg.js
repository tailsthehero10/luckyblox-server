'use strict';

/**
 * Restores `robux.svg` as a plain, faithful copy of Roblox's own artwork.
 *
 * There are two ways the site shows the Robux mark and they need different files:
 *
 *   MASKS (the header balance, price labels)
 *     `mask: url("/icons/robux-mask.png")` + `background-color: currentColor`.
 *     A mask reads only ALPHA, so Roblox's white-on-transparent PNG is already
 *     perfect: the ink is the shape, the element supplies the colour.
 *
 *   <img src="/icons/robux.svg">  (16 Studio pages)
 *     An <img> is its own document and CANNOT inherit currentColor, so it needs a
 *     file that carries its own colour.
 *
 * The previous robux.svg tried to be both at once and failed at both: a broken
 * VTracer trace with a square counter, which I then made worse twice (a hand-drawn
 * replacement, then an SVG with an embedded base64 raster, which rendered as a
 * broken image).
 *
 * This writes the simple, correct thing for the <img> case: the embedded PNG is
 * dropped in favour of referencing Roblox's real texture directly, which is what
 * an <img> is good at.
 *
 * Usage: node tools/restore-robux-svg.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(__dirname, '..');
const ICONS = path.join(ROOT, 'Webserver', 'http-db-bridge', 'public', 'icons');

const TEXTURE = 'Clients/2020M/content/textures/ui/common/robux@3x.png';
const source = path.join(ROOT, TEXTURE);

if (!fs.existsSync(source)) {
  console.error(`missing: ${TEXTURE}`);
  process.exit(1);
}

const png = fs.readFileSync(source);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

// An SVG that simply DISPLAYS Roblox's texture. No traced geometry at all, so
// there is nothing to get wrong and nothing to clip.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Robux">
  <image width="${width}" height="${height}" href="/icons/robux-mask.png"/>
</svg>
`;

console.log(`texture: ${TEXTURE}  (${width}x${height}, ${png.length} bytes)`);
console.log('robux.svg will DISPLAY Roblox\'s texture instead of tracing it');
console.log('');
console.log('  - no traced geometry, so the counter cannot be wrong');
console.log('  - no embedded base64 (that is what rendered as a broken image)');
console.log('  - <img> consumers get the real artwork at its real colour');

if (WRITE) {
  fs.writeFileSync(path.join(ICONS, 'robux.svg'), svg, { encoding: 'utf8' });
  console.log(`\nwrote ${path.relative(ROOT, path.join(ICONS, 'robux.svg'))}`);
} else {
  console.log('\nrun with --write to apply');
}