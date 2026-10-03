'use strict';

const assert = require('node:assert/strict');
const {
  buildLaunchCommand,
  resolveServerBinary,
} = require('../server/orchestrator');

const linuxLaunch = buildLaunchCommand(1818, 53641, 'linux-job', 'linux');
assert.deepEqual(linuxLaunch, {
  command: null,
  args: [],
  type: 'none',
  reason: 'bundled RCCService.exe is Windows-only; using the in-process listener',
});
assert.equal(resolveServerBinary('linux'), null);

console.log('orchestrator does not try to execute bundled Windows RCCService binaries on Linux.');
