'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  buildLaunchCommand,
  resolveServerBinary,
} = require('../server/orchestrator');
const runtimeConfig = require('../server/runtimeConfig');
const fs = require('node:fs');
const path = require('node:path');

function loadRuntimeConfig(env) {
  const result = spawnSync(process.execPath, [
    '-e',
    "process.stdout.write(JSON.stringify(require('./server/runtimeConfig')))",
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '',
      RENDER: '',
      RENDER_EXTERNAL_HOSTNAME: '',
      HOST: '',
      BIND_HOST: '',
      PUBLIC_HOST: '',
      PUBLIC_URL: '',
      RENDER_EXTERNAL_URL: '',
      LUCKYBLOX_GAME_HOST: '',
      ...env,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const linuxLaunch = buildLaunchCommand(1818, 53641, 'linux-job', 'linux');
assert.deepEqual(linuxLaunch, {
  command: null,
  args: [],
  type: 'none',
  reason: 'bundled RCCService.exe is Windows-only; using the in-process listener',
});
assert.equal(resolveServerBinary('linux'), null);
assert.equal(runtimeConfig.gameListenHost, runtimeConfig.bindHost);
assert.notEqual(runtimeConfig.gameServerHost, '0.0.0.0');
if (!runtimeConfig.isCloud) {
  assert.equal(runtimeConfig.gameServerHost, '127.0.0.1');
}

const localConfig = loadRuntimeConfig({});
assert.equal(localConfig.gameListenHost, '0.0.0.0');
assert.equal(localConfig.gameServerHost, '127.0.0.1');
const cloudConfig = loadRuntimeConfig({
  PORT: '10000',
  RENDER_EXTERNAL_HOSTNAME: 'games.example.test',
});
assert.equal(cloudConfig.gameListenHost, '0.0.0.0');
assert.equal(cloudConfig.gameServerHost, 'games.example.test');
const explicitGameHostConfig = loadRuntimeConfig({
  PORT: '10000',
  RENDER_EXTERNAL_HOSTNAME: 'games.example.test',
  LUCKYBLOX_GAME_HOST: '198.51.100.8',
});
assert.equal(explicitGameHostConfig.gameServerHost, '198.51.100.8');

const orchestratorSource = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'orchestrator.js'),
  'utf8',
);
assert.match(
  orchestratorSource,
  /else\s*\{\s*console\.log\(\`\[LuckyBlox Server:\$\{serverJobId\}\] no desktop client to launch \(\$\{launch\.reason\}\)`\);\s*ensureServerListener\(serverRecord\);\s*\}/,
  'the JSON fallback listener must only bind when no dedicated RCCService process is launched',
);

console.log('orchestrator does not try to execute bundled Windows RCCService binaries on Linux.');
