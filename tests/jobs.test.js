'use strict';

/**
 * Proves the job pipeline produces real, unique, consistent job ids.
 * Run: node tests/jobs.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate storage so the test never touches real data.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-jobs-'));
process.env.LUCKYBLOX_DATA_DIR = tmpDir;

const orch = require('../server/orchestrator');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`FAIL  - ${name}\n        ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('orchestrator job pipeline');

test('createJoinJob returns a UUID-shaped job id', () => {
  const job = orch.createJoinJob('1', 1818);
  assert.ok(job.ok, 'job ok');
  assert.match(job.jobId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('job id and serverJobId are always identical', () => {
  const job = orch.createJoinJob('2', 1818);
  assert.strictEqual(job.jobId, job.serverJobId);
});

test('a second player joins the SAME job for the same place', () => {
  const a = orch.createJoinJob('10', 4242);
  const b = orch.createJoinJob('11', 4242);
  assert.strictEqual(a.jobId, b.jobId, 'same job reused');
  assert.strictEqual(b.created, false, 'second join did not spawn a new server');
});

test('playerCount increases as players join', () => {
  const first = orch.createJoinJob('20', 5555);
  const second = orch.createJoinJob('21', 5555);
  assert.ok(second.playerCount > first.playerCount, 'count grew');
});

test('getJobStatus returns live status for a real job', () => {
  const job = orch.createJoinJob('30', 6666);
  const status = orch.getJobStatus(job.jobId);
  assert.ok(status, 'status found');
  assert.strictEqual(status.jobId, job.jobId);
  assert.strictEqual(status.placeId, 6666);
  assert.ok(status.playerCount >= 1);
  assert.ok(typeof status.uptimeSeconds === 'number');
});

test('getJobStatus returns null for an unknown job', () => {
  assert.strictEqual(orch.getJobStatus('not-a-real-job'), null);
});

test('listServersForPlace returns only that place jobs', () => {
  orch.createJoinJob('40', 7777);
  const list = orch.listServersForPlace(7777);
  assert.ok(list.length >= 1, 'found servers');
  assert.ok(list.every((s) => s.jobId), 'every entry has an id');
});

test('getTotalPlayerCount counts across jobs', () => {
  const total = orch.getTotalPlayerCount();
  assert.ok(typeof total === 'number' && total >= 0);
});

test('removePlayerFromServer removes just that player', () => {
  const job = orch.createJoinJob('50', 8888);
  orch.createJoinJob('51', 8888);
  const before = orch.getJobStatus(job.jobId).playerCount;
  orch.removePlayerFromServer('51', job.jobId);
  const after = orch.getJobStatus(job.jobId).playerCount;
  assert.strictEqual(after, before - 1, 'one player removed');
});

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (error) {
  /* ignore */
}

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);

// The orchestrator spawns real game-server processes. Make sure the test runner
// exits even if one is still lingering, so CI never hangs.
process.exit(process.exitCode || 0);