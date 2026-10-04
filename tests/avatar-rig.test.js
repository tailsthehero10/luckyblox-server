'use strict';

const assert = require('node:assert/strict');
const { getRigGeometry } = require('../Webserver/http-db-bridge/avatarRig');

for (const [rig, expectedCount, expectedNames] of [
  ['R6', 6, ['Head', 'Torso', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg']],
  ['R15', 15, ['Head', 'UpperTorso', 'LowerTorso', 'LeftUpperArm', 'RightUpperArm']],
]) {
  const parsed = getRigGeometry(rig);
  assert.equal(parsed.rig, rig);
  assert.equal(parsed.parts.length, expectedCount, `${rig} exposes the body parts in its RBXM`);
  for (const name of expectedNames) {
    assert.ok(parsed.parts.some((part) => part.name === name), `${rig} includes ${name}`);
  }
  for (const part of parsed.parts) {
    assert.ok(Object.values(part.size).every((value) => Number.isFinite(value) && value > 0));
    assert.ok(Object.values(part.position).every(Number.isFinite));
    assert.equal(part.rotation.length, 9);
  }
}

const r15 = getRigGeometry('R15');
const meshPart = r15.parts.find((part) => part.name === 'LeftHand');
assert.equal(meshPart.className, 'MeshPart');
assert.equal(meshPart.meshId, 'http://www.roblox.com/asset/?id=532219986');
assert.equal(meshPart.mesh, null, 'the RBXM references, but does not embed, the original mesh geometry');
assert.equal(meshPart.meshGeometryIncluded, false);
const leftHand = r15.parts.find((part) => part.name === 'LeftHand');
const rightHand = r15.parts.find((part) => part.name === 'RightHand');
const head = r15.parts.find((part) => part.name === 'Head');
const upperTorso = r15.parts.find((part) => part.name === 'UpperTorso');
assert.deepEqual(head.size, { x: 2, y: 1, z: 1 },
  'the head mesh must be fitted to the actual dimensions of its RBXM Part');
assert.deepEqual(head.mesh.scale, { x: 1.25, y: 1.25, z: 1.25 },
  'the supplied head SpecialMesh scale must remain available to the viewer');
assert.ok(leftHand.position.x < 0 && rightHand.position.x > 0,
  'R15 part positions must be relative to the rig root, not the RBXM world pivot');
assert.ok(Math.abs(leftHand.position.z) < 1e-5 && Math.abs(rightHand.position.z) < 1e-5,
  'R15 left/right parts should share the source root plane after basis normalization');
assert.deepEqual(leftHand.rotation, [1, 0, 0, 0, 1, 0, 0, 0, 1],
  'R15 part transforms must be expressed in the root part’s basis');
assert.ok(Math.abs(
  (head.position.y - head.size.y / 2)
  - (upperTorso.position.y + upperTorso.size.y / 2)
) < 1e-5, 'R15 head bottom must align with the torso top as specified by the RBXM');
assert.equal(getRigGeometry('R6').parts.find((part) => part.name === 'Head').meshGeometryIncluded, false);
assert.equal(getRigGeometry('R6').parts.find((part) => part.name === 'Torso').shape, 'Block');

assert.throws(() => getRigGeometry('R7'), /Unsupported avatar rig/);
console.log('ok: supplied R6/R15 RBXM files parse into exact part and external-mesh references');
