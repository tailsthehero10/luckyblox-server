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
  const legacyMesh = parseRobloxMesh(Buffer.from(
    'version 1.00\r\n1\r\n'
    + '[0,0,0][0,0,1][0,0,0]'
    + '[1,0,0][0,0,1][1,0,0]'
    + '[0,1,0][0,0,1][0,1,0]',
  ));
  assert.equal(legacyMesh.version, 1);
  assert.equal(legacyMesh.positions.length / 3, 3);
  assert.equal(legacyMesh.indices.length / 3, 1);
  assert.deepEqual(Array.from(legacyMesh.uvs), [0, 0, 1, 0, 0, 1]);
  assert.throws(() => parseRobloxMesh(Buffer.from('version 1.00\n2\n[0,0,0]')), /invalid vertex or face table/);
  assert.throws(() => parseRobloxMesh(Buffer.from('not a Roblox mesh')), /Unsupported Roblox mesh format/);
  console.log('ok: supplied head mesh and legacy equipped-item meshes parse into validated triangles');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
