'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function readRuntimeConfig(env) {
  const result = spawnSync(process.execPath, [
    '-e',
    "const c=require('./server/runtimeConfig'); console.log(JSON.stringify({host:c.gameServerHost,port:c.gamePort,bind:c.bindHost}));",
  ], { cwd: projectRoot, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

const configured = readRuntimeConfig({
  ...process.env,
  PORT: '10000',
  RENDER: 'true',
  GAME_SERVER_IP: 'games.example.net',
  GAME_SERVER_PORT: '64989',
  LUCKYBLOX_GAME_HOST: 'legacy.example.net',
  LUCKYBLOX_GAME_PORT: '53640',
});
assert.equal(configured.host, 'games.example.net');
assert.equal(configured.port, 64989);
assert.equal(configured.bind, '0.0.0.0');

const legacyAliases = readRuntimeConfig({
  ...process.env,
  PORT: '10000',
  RENDER: 'true',
  GAME_SERVER_IP: '',
  GAME_SERVER_PORT: '',
  LUCKYBLOX_GAME_HOST: 'legacy.example.net',
  LUCKYBLOX_GAME_PORT: '53640',
});
assert.equal(legacyAliases.host, 'legacy.example.net');
assert.equal(legacyAliases.port, 53640);

console.log('ok: public game endpoint env keys and legacy aliases resolve correctly');
