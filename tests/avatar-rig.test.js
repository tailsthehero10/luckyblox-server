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

assert.throws(() => getRigGeometry('R7'), /Unsupported avatar rig/);
console.log('ok: supplied R6 and R15 RBXM assets parse into renderable rig geometry');
