'use strict';

const assert = require('node:assert/strict');
const { configureLocalEnvironment } = require('../tools/start-local');

const env = {
  LUCKYBLOX_LOCAL_PORT: '10001',
  PORT: '10000',
  HOST: '0.0.0.0',
  RENDER: 'true',
  RENDER_EXTERNAL_URL: 'https://luckyblox-server.onrender.com',
  RENDER_EXTERNAL_HOSTNAME: 'luckyblox-server.onrender.com',
  RENDER_SERVICE_ID: 'production-service',
  RENDER_DISK_PATH: '/var/data',
  PUBLIC_URL: 'https://luckyblox-server.onrender.com',
  PUBLIC_HOST: 'luckyblox-server.onrender.com',
  PUBLIC_PROTOCOL: 'https',
  LUCKYBLOX_GAME_HOST: '0.0.0.0',
  LUCKYBLOX_SYNC: 'github',
  DATABASE_URL: 'postgres://production',
};

assert.equal(configureLocalEnvironment(env), 'http://localhost:10001');
assert.equal(env.PORT, '10001');
assert.equal(env.HOST, '127.0.0.1');
assert.equal(env.LUCKYBLOX_BRIDGE_HOST, '127.0.0.1');
assert.equal(env.LUCKYBLOX_BRIDGE_PORT, '3001');
assert.equal(env.LUCKYBLOX_GAME_HOST, '127.0.0.1');
assert.equal(env.PUBLIC_URL, 'http://localhost:10001');
assert.equal(env.PUBLIC_HOST, 'localhost:10001');
assert.equal(env.PUBLIC_PROTOCOL, 'http');
assert.equal(env.LUCKYBLOX_SYNC, 'off');
assert.equal(env.DATABASE_URL.trim(), '');
assert.equal(env.RENDER, '');
assert.equal(env.RENDER_EXTERNAL_URL, '');
assert.equal(env.RENDER_EXTERNAL_HOSTNAME, '');
assert.equal(env.RENDER_SERVICE_ID, '');
assert.equal(env.RENDER_DISK_PATH, '');

assert.throws(
  () => configureLocalEnvironment({ LUCKYBLOX_LOCAL_PORT: '3001' }),
  /other than 3001/,
);
assert.throws(
  () => configureLocalEnvironment({ LUCKYBLOX_LOCAL_PORT: 'not-a-port' }),
  /valid port/,
);

console.log('ok: local startup overrides public hosting settings and isolates local data');
