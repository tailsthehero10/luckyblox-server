'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { parseRobloxMesh } = await import('../Webserver/http-db-bridge/public/js/roblox-mesh.mjs');
  const headPath = path.resolve(__dirname, '..', 'shared', 'content', 'avatar', 'heads', 'head.mesh');
  const mesh = parseRobloxMesh(fs.readFileSync(headPath));

  assert.equal(mesh.version, 2);
  assert.equal(mesh.positions.length / 3, 517);
  assert.equal(mesh.indices.length / 3, 846);
  assert.ok(mesh.indices.every((index) => index < mesh.positions.length / 3));
  assert.throws(() => parseRobloxMesh(Buffer.from('not a Roblox mesh')), /Unsupported Roblox mesh format/);
  console.log('ok: supplied Roblox head mesh parses into validated triangle geometry');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
