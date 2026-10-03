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
assert.equal(getRigGeometry('R6').parts.find((part) => part.name === 'Head').meshGeometryIncluded, false);
assert.equal(getRigGeometry('R6').parts.find((part) => part.name === 'Torso').shape, 'Block');

assert.throws(() => getRigGeometry('R7'), /Unsupported avatar rig/);
console.log('ok: supplied R6/R15 RBXM files parse into exact part and external-mesh references');
