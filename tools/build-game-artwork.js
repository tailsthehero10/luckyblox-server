'use strict';

/**
 * Build the game page's BIG thumbnail asset at exactly 1680x945.
 *
 * 1680x945 is 16:9, which is the real Roblox game-page thumbnail ratio:
 *
 *   #game-details-carousel-container { width: 640px; height: 360px }
 *   #game-details-carousel-container:before { padding-top: 56.25% }   // 9/16
 *
 * The art that shipped in the repo is the wrong shape for this slot:
 *   Big_/image (44).png             596 x 335   (1.78:1, but low resolution)
 *   Big_/image (44).1920x1080.png  1920 x 1080  (16:9, high resolution)
 *
 * 1920x1080 is already 16:9, so downscaling it to 1680x945 is a clean resize with
 * no distortion and no cropping - it is the same picture, at the size the page
 * actually asks for.
 *
 * Results go to Webserver/gameplaceholder/ as stable, predictable filenames so
 * the server can serve them without encoding the original spaces/parens in a URL.
 *
 * Usage: node tools/build-game-artwork.js [--write]
 */

const fs = require('fs');
const path = require('path');

const write = process.argv.includes('--write');

const releaseRoot = path.resolve(__dirname, '..');
const bigDir = path.join(releaseRoot, 'Webserver', 'gameplaceholder', 'Big_');

const TARGET_W = 1680;
const TARGET_H = 945;

// Highest resolution first: prefer the biggest source so the resize loses nothing.
const SOURCES = [
  { file: 'image (44).1920x1080.png', w: 1920, h: 1080 },
  { file: 'image (44).png', w: 596, h: 335 },
];

function pickSource() {
  for (const s of SOURCES) {
    const full = path.join(bigDir, s.file);
    if (fs.existsSync(full)) return { ...s, full };
  }
  return null;
}

(async () => {
  const src = pickSource();
  if (!src) {
    console.error(`No source art found in ${bigDir}`);
    console.error('Expected one of: ' + SOURCES.map((s) => s.file).join(', '));
    process.exit(1);
  }

  console.log(`source : ${src.file}  (${src.w}x${src.h})`);
  console.log(`target : ${TARGET_W}x${TARGET_H} (16:9)`);

  const sameRatio = Math.abs((src.w / src.h) - (TARGET_W / TARGET_H)) < 0.01;
  console.log(`ratio  : source ${(src.w / src.h).toFixed(4)} vs target ${(TARGET_W / TARGET_H).toFixed(4)}` +
    (sameRatio ? '  -> same, clean downscale' : '  -> DIFFERENT, would need cropping'));

  const outPath = path.join(releaseRoot, 'Webserver', 'gameplaceholder', 'game-thumb-1680x945.png');

  if (!write) {
    console.log(`\nwould write: ${path.relative(releaseRoot, outPath)}`);
    console.log('pass --write to generate');
    return;
  }

  // System.Drawing is available on Windows PowerShell hosts; this script only
  // needs to run once to produce a static asset, so it does not belong in the
  // server's runtime dependencies.
  let sharp = null;
  try { sharp = require('sharp'); } catch (e) { sharp = null; }

  if (sharp) {
    await sharp(src.full)
      .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'center' })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`written: ${path.relative(releaseRoot, outPath)}  (via sharp)`);
    return;
  }

  console.log('');
  console.log('sharp is not installed, so this script cannot resize by itself.');
  console.log('Run this instead, in PowerShell:');
  console.log('');
  console.log(`  Add-Type -AssemblyName System.Drawing`);
  console.log(`  $src = [System.Drawing.Image]::FromFile("${src.full}")`);
  console.log(`  $bmp = New-Object System.Drawing.Bitmap(${TARGET_W}, ${TARGET_H})`);
  console.log(`  $g = [System.Drawing.Graphics]::FromImage($bmp)`);
  console.log(`  $g.InterpolationMode = 'HighQualityBicubic'`);
  console.log(`  $g.DrawImage($src, 0, 0, ${TARGET_W}, ${TARGET_H})`);
  console.log(`  $bmp.Save("${outPath}", [System.Drawing.Imaging.ImageFormat]::Png)`);
  console.log(`  $g.Dispose(); $bmp.Dispose(); $src.Dispose()`);
})();