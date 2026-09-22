'use strict';

/**
 * Extract the icon group from a Windows PE (.exe) file's resource section.
 *
 * Windows apps store their application icon as RT_ICON (id 3) and RT_GROUP_ICON
 * (id 14) resources. This walks the PE headers, finds .rsrc, and pulls out the
 * raw icon images, rebuilding a valid .ico file from each group.
 *
 * Usage: node tools/extract-exe-ico.js <path-to.exe> <output-dir>
 */

const fs = require('fs');
const path = require('path');

function readSections(buffer) {
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Not a valid PE file (no PE header).');
  }

  const numberOfSections = buffer.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalHeaderStart = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalHeaderStart);
  const is64 = magic === 0x20b;

  // Data directories sit at a fixed offset inside the optional header.
  const dataDirOffset = optionalHeaderStart + (is64 ? 112 : 96);
  const resourceDirRva = buffer.readUInt32LE(dataDirOffset + 2 * 8); // entry 2 = resources
  const resourceDirSize = buffer.readUInt32LE(dataDirOffset + 2 * 8 + 4);

  const sectionStart = optionalHeaderStart + optionalHeaderSize;
  const sections = [];
  for (let i = 0; i < numberOfSections; i += 1) {
    const off = sectionStart + i * 40;
    sections.push({
      virtualAddress: buffer.readUInt32LE(off + 12),
      virtualSize: buffer.readUInt32LE(off + 8),
      rawSize: buffer.readUInt32LE(off + 16),
      rawPointer: buffer.readUInt32LE(off + 20),
      name: buffer.toString('ascii', off, off + 8).replace(/\0/g, ''),
    });
  }

  return { sections, resourceDirRva, resourceDirSize };
}

function rvaToOffset(sections, rva) {
  for (const section of sections) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.rawSize) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }
  return -1;
}

function readResourceDirectory(buffer, sections, rva, depth, out) {
  const base = rvaToOffset(sections, rva);
  if (base < 0) return;

  const named = buffer.readUInt16LE(base + 12);
  const idEntries = buffer.readUInt16LE(base + 14);

  for (let i = 0; i < named + idEntries; i += 1) {
    const entry = base + 16 + i * 8;
    const nameOrId = buffer.readUInt32LE(entry);
    const offsetToData = buffer.readUInt32LE(entry + 4);
    const isDirectory = (offsetToData & 0x80000000) !== 0;
    const childRva = rva + (offsetToData & 0x7fffffff);

    if (isDirectory) {
      const id = nameOrId & 0xffff;
      if (depth === 0) {
        out.types[id] = out.types[id] || [];
      }
      if (depth === 0) {
        // descend into the type, collecting its id entries
        readResourceSubtree(buffer, sections, childRva, out, id);
      }
    }
  }
}

function readResourceSubtree(buffer, sections, rva, out, typeId) {
  const base = rvaToOffset(sections, rva);
  if (base < 0) return;

  const named = buffer.readUInt16LE(base + 12);
  const idEntries = buffer.readUInt16LE(base + 14);

  for (let i = 0; i < named + idEntries; i += 1) {
    const entry = base + 16 + i * 8;
    const nameOrId = buffer.readUInt32LE(entry);
    const offsetToData = buffer.readUInt32LE(entry + 4);
    const isDirectory = (offsetToData & 0x80000000) !== 0;
    const childRva = rva + (offsetToData & 0x7fffffff);

    if (isDirectory) {
      readResourceLeaf(buffer, sections, childRva, out, typeId, nameOrId & 0xffff);
    }
  }
}

function readResourceLeaf(buffer, sections, rva, out, typeId, nameId) {
  const base = rvaToOffset(sections, rva);
  if (base < 0) return;

  const named = buffer.readUInt16LE(base + 12);
  const idEntries = buffer.readUInt16LE(base + 14);

  for (let i = 0; i < named + idEntries; i += 1) {
    const entry = base + 16 + i * 8;
    const offsetToData = buffer.readUInt32LE(entry + 4);
    const isDirectory = (offsetToData & 0x80000000) !== 0;
    if (isDirectory) continue;

    // IMAGE_RESOURCE_DATA_ENTRY
    const dataEntryBase = rvaToOffset(sections, rva) + 0; // already at this dir
    const de = rvaToOffset(sections, rva + (offsetToData & 0x7fffffff) - rva); // relative fixup below
    const deAbs = rvaToOffset(sections, (rva - 0) + 16 + i * 8); // placeholder
    // Simpler: read from the entry we already have.
    const dataEntryRva = rva + (offsetToData & 0x7fffffff);
    const deOff = rvaToOffset(sections, dataEntryRva);
    if (deOff < 0) continue;
    const size = buffer.readUInt32LE(deOff + 4);
    const dataRva = buffer.readUInt32LE(deOff);
    const dataOff = rvaToOffset(sections, dataRva);
    if (dataOff < 0 || size <= 0 || dataOff + size > buffer.length) continue;

    out.types[typeId] = out.types[typeId] || [];
    out.types[typeId].push({
      nameId,
      size,
      data: buffer.subarray(dataOff, dataOff + size),
    });
  }
}

function buildIcoFromGroup(buffer, groupData, iconsById) {
  // ICONDIR: reserved(2), type(2)=1, count(2)
  const count = buffer.readUInt16LE(groupData + 4);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    const off = groupData + 6 + i * 14;
    const width = buffer.readUInt8(off);
    const height = buffer.readUInt8(off + 1);
    const colorCount = buffer.readUInt8(off + 2);
    const planes = buffer.readUInt16LE(off + 4);
    const bitCount = buffer.readUInt16LE(off + 6);
    const bytesInRes = buffer.readUInt32LE(off + 8);
    const id = buffer.readUInt16LE(off + 12);

    const icon = iconsById[id];
    if (!icon) continue;

    entries.push({
      width, height, colorCount, planes, bitCount,
      bytesInRes: icon.data.length,
      data: icon.data,
    });
  }

  if (entries.length === 0) return null;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = [];
  let dataOffset = 6 + entries.length * 16;
  for (const e of entries) {
    const b = Buffer.alloc(16);
    b.writeUInt8(e.width, 0);
    b.writeUInt8(e.height, 1);
    b.writeUInt8(e.colorCount, 2);
    b.writeUInt8(0, 3);
    b.writeUInt16LE(e.planes || 1, 4);
    b.writeUInt16LE(e.bitCount || 32, 6);
    b.writeUInt32LE(e.bytesInRes, 8);
    b.writeUInt32LE(dataOffset, 12);
    dir.push(b);
    dataOffset += e.bytesInRes;
  }

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

function main() {
  const input = process.argv[2];
  const outDir = process.argv[3] || 'extracted-ico';

  if (!input || !fs.existsSync(input)) {
    console.error('Usage: node tools/extract-exe-ico.js <path-to.exe> <output-dir>');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const buffer = fs.readFileSync(input);
  const { sections, resourceDirRva } = readSections(buffer);
  console.log(`Sections: ${sections.map((s) => s.name).join(', ')}`);

  const out = { types: {} };
  readResourceDirectory(buffer, sections, resourceDirRva, 0, out);

  const icons = out.types[3] || [];   // RT_ICON
  const groups = out.types[14] || []; // RT_GROUP_ICON

  console.log(`RT_ICON entries: ${icons.length}`);
  console.log(`RT_GROUP_ICON entries: ${groups.length}`);

  if (icons.length === 0 && groups.length === 0) {
    console.log('\nNo icon resources found in this binary.');
    return;
  }

  // Dump every raw icon as a .png/.bin so we can inspect them.
  const iconsById = {};
  icons.forEach((icon) => {
    iconsById[icon.nameId] = icon;
    const ext = icon.data[0] === 0x89 ? 'png' : 'bin';
    const p = path.join(outDir, `icon-${icon.nameId}.${ext}`);
    fs.writeFileSync(p, icon.data);
    console.log(`  wrote ${path.basename(p)} (${icon.size} bytes)`);
  });

  // Rebuild a proper multi-size .ico from each group.
  groups.forEach((group, i) => {
    const ico = buildIcoFromGroup(buffer, group.data, iconsById);
    if (ico) {
      const p = path.join(outDir, `app-icon-${i + 1}.ico`);
      fs.writeFileSync(p, ico);
      console.log(`  wrote ${path.basename(p)} (${ico.length} bytes)`);
    }
  });

  console.log(`\nDone. Output in ${outDir}.`);
}

main();
