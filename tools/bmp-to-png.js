'use strict';

/**
 * Convert 32bpp BMP (as produced from RT_ICON resources) to PNG.
 * Uses only Node built-ins (zlib) — no external image libraries.
 *
 * Usage: node tools/bmp-to-png.js <file.bmp> [out.png]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function bmpToPng(buffer) {
  if (buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('Not a BMP file.');
  }

  const dataOffset = buffer.readUInt32LE(10);
  const headerSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);

  if (bpp !== 32) {
    throw new Error(`Only 32bpp supported, got ${bpp}bpp.`);
  }

  // Icons store a doubled height (image + AND mask). Half is the real height.
  const height = Math.abs(rawHeight) / 2;
  const bottomUp = rawHeight > 0;

  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const srcY = bottomUp ? (height - 1 - y) : y;
    const srcRow = dataOffset + srcY * stride;
    const dstRow = y * stride;

    for (let x = 0; x < width; x += 1) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      // BMP is BGRA, PNG wants RGBA
      pixels[d] = buffer[s + 2];
      pixels[d + 1] = buffer[s + 1];
      pixels[d + 2] = buffer[s];
      pixels[d + 3] = buffer[s + 3];
    }
  }

  // Build raw PNG scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error('Usage: node tools/bmp-to-png.js <file.bmp> [out.png]');
  process.exit(1);
}

const out = process.argv[3] || input.replace(/\.bmp$/, '.png');
const png = bmpToPng(fs.readFileSync(input));
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
