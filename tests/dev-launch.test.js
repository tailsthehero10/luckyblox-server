'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, readSelectedClient, resolveClientDir } = require('../tools/dev-launch');

const releaseRoot = path.resolve(__dirname, '..');
const selectedFile = path.join(releaseRoot, 'Settings', 'SelectedClient.txt');
const selected = fs.readFileSync(selectedFile, 'utf8').replace(/^\uFEFF/, '').trim();

assert.equal(readSelectedClient(), selected, 'DEV-PLAY should follow SelectedClient.txt');
const savedClientOverride = process.env.LUCKYBLOX_DEV_CLIENT;
delete process.env.LUCKYBLOX_DEV_CLIENT;
try {
  assert.equal(parseArgs([]).client, selected, 'the CLI default should use the selected client');
} finally {
  if (savedClientOverride !== undefined) process.env.LUCKYBLOX_DEV_CLIENT = savedClientOverride;
}
assert.equal(
  path.basename(resolveClientDir(selected)),
  'Player',
  'the selected CUSTOM-2021M client resolves to its nested Player directory',
);
assert.ok(
  fs.existsSync(path.join(resolveClientDir(selected), 'RobloxPlayerBeta.exe')),
  'the selected client binary should exist',
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-dev-launch-'));
const invalidSelection = path.join(tempDir, 'SelectedClient.txt');
try {
  fs.writeFileSync(invalidSelection, '..\\Windows\\System32');
  assert.equal(readSelectedClient(invalidSelection), '2021M', 'invalid paths must not become client names');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('ok: DEV-PLAY resolves the selected client and rejects invalid selections');
