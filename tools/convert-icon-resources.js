'use strict';

/**
 * Convert raw RT_ICON resource data (BMP/PNG blob) into a viewable .png.
 *
 * RT_ICON data is either a PNG (already fine) or a BMP-style DIB *without* the
 * 14-byte BMP file header. This rebuilds the BMP header so standard tooling can
 * read it, then hands off to the `sharp`-free path: we write a real .bmp.
 *
 * Usage: node tools/convert-icon-resources.js <dir>
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node tools/convert-icon-resources.js <dir>');
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));
console.log(`Found ${files.length} .bin resource(s) in ${dir}`);

for (const file of files) {
  const full = path.join(dir, file);
  const data = fs.readFileSync(full);

  // Already a PNG?
  if (data[0] === 0x89 && data[1] === 0x50) {
    console.log(`  ${file}: already PNG, skipping`);
    continue;
  }

  // DIB header: first 4 bytes = header size (should be 40 for BITMAPINFOHEADER)
  const headerSize = data.readUInt32LE(0);

  // BITMAPFILEHEADER is 14 bytes: "BM", filesize, reserved, reserved, dataOffset
  const bmpHeader = Buffer.alloc(14);
  bmpHeader.write('BM', 0, 'ascii');
  bmpHeader.writeUInt32LE(14 + data.length, 2);
  bmpHeader.writeUInt16LE(0, 6);
  bmpHeader.writeUInt16LE(0, 8);
  bmpHeader.writeUInt32LE(14 + headerSize, 10);

  // Some icons have a doubled height (AND mask); the DIB already encodes that.
  const bmp = Buffer.concat([bmpHeader, data]);
  const outName = file.replace(/\.bin$/, '.bmp');
  fs.writeFileSync(path.join(dir, outName), bmp);

  const width = data.readInt32LE(4);
  const height = Math.abs(data.readInt32LE(8));
  const bpp = data.readUInt16LE(14);
  console.log(`  ${file} -> ${outName}  (${width}x${height}, ${bpp}bpp, hdr ${headerSize})`);
}

console.log('\nDone. Open the .bmp files to see the icons.');