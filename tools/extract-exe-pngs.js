'use strict';

/**
 * Extract embedded PNG images from a PE binary (e.g. RobloxPlayerBeta.exe).
 *
 * Scans for the PNG signature (89 50 4E 47 0D 0A 1A 0A) and walks each chunk
 * stream to the IEND chunk, writing the exact byte range out as a .png file.
 *
 * Usage: node tools/extract-exe-pngs.js <path-to.exe> <output-dir>
 *
 * Note: these images come from a third-party binary. Extracting them is a
 * technical operation; whether you may redistribute them is your call and is
 * not something this script decides.
 */

const fs = require('fs');
const path = require('path');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function findPngEnd(buffer, start) {
  // Walk PNG chunks from `start` until IEND; return index just past it.
  let offset = start + PNG_SIG.length;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (!/^[A-Za-z]{4}$/.test(type) || length > buffer.length) {
      return -1; // not a sane chunk stream
    }

    offset += 8 + length + 4; // length + type + data + crc

    if (type === 'IEND') {
      return offset;
    }
  }
  return -1;
}

function main() {
  const input = process.argv[2];
  const outDir = process.argv[3] || 'extracted-pngs';

  if (!input || !fs.existsSync(input)) {
    console.error('Usage: node tools/extract-exe-pngs.js <path-to.exe> <output-dir>');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const buffer = fs.readFileSync(input);
  console.log(`Scanning ${input} (${buffer.length} bytes)...`);

  let index = 0;
  let found = 0;
  let written = 0;

  while ((index = buffer.indexOf(PNG_SIG, index)) !== -1) {
    found += 1;
    const end = findPngEnd(buffer, index);

    if (end > 0) {
      const png = buffer.subarray(index, end);
      const name = `embedded-${String(found).padStart(3, '0')}-off${index}.png`;
      const filePath = path.join(outDir, name);
      fs.writeFileSync(filePath, png);
      written += 1;
      console.log(`  wrote ${name} (${png.length} bytes)`);
      index = end;
    } else {
      index += PNG_SIG.length;
    }
  }

  console.log(`\nFound ${found} PNG signature(s); extracted ${written} valid image(s) to ${outDir}.`);
}

main();
