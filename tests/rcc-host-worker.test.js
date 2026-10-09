'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { loadConfig, probeTcpPort } = require('../tools/rcc-host-worker');

const ENV_KEYS = [
  'LUCKYBLOX_HOST_SITE_URL',
  'LUCKYBLOX_HOST_TOKEN',
  'GAME_SERVER_IP',
  'LUCKYBLOX_GAME_HOST',
  'GAME_SERVER_PORT',
  'LUCKYBLOX_HOST_PLACES',
  'LUCKYBLOX_HOST_PUBLIC_PORTS',
  'LUCKYBLOX_HOST_MAX_PLAYERS',
  'LUCKYBLOX_HOST_MAX_SERVERS',
];
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function configureValidHost() {
  process.env.LUCKYBLOX_HOST_SITE_URL = 'https://luckyblox-server.onrender.com/';
  process.env.LUCKYBLOX_HOST_TOKEN = 't'.repeat(32);
  process.env.GAME_SERVER_IP = 'games.example.net';
  process.env.GAME_SERVER_PORT = '53640';
  delete process.env.LUCKYBLOX_GAME_HOST;
  process.env.LUCKYBLOX_HOST_PLACES = '1806,1801';
  process.env.LUCKYBLOX_HOST_MAX_SERVERS = '2';
  delete process.env.LUCKYBLOX_HOST_PUBLIC_PORTS;
  process.env.LUCKYBLOX_HOST_MAX_PLAYERS = '20';
}

(async () => {
  try {
    configureValidHost();
    const config = loadConfig();
    assert.equal(config.siteUrl, 'https://luckyblox-server.onrender.com');
    assert.equal(config.serverHost, 'games.example.net');
    assert.deepEqual(config.places, [1806, 1801]);
    assert.equal(config.maxServers, 2);
    assert.equal(config.publicPorts.length, 2);
    assert.equal(config.publicPorts[1], config.publicPorts[0] + 1, 'without a tunnel mapping, advertised ports remain consecutive');

    process.env.LUCKYBLOX_HOST_PUBLIC_PORTS = '31000,31001';
    assert.deepEqual(loadConfig().publicPorts, [31000, 31001], 'tunnel-assigned ports can differ from RCC listen ports');
    process.env.LUCKYBLOX_HOST_PUBLIC_PORTS = '31000';
    assert.throws(() => loadConfig(), /one valid public port per allowed server slot/);
    configureValidHost();

    delete process.env.LUCKYBLOX_HOST_PLACES;
    delete process.env.LUCKYBLOX_HOST_MAX_SERVERS;
    const dynamicConfig = loadConfig();
    assert.deepEqual(dynamicConfig.places, [], 'no place allowlist means instances start on demand for any place');
    assert.equal(dynamicConfig.maxServers, 10, 'dynamic hosting has a bounded default capacity');
    configureValidHost();

    process.env.GAME_SERVER_IP = 'localhost';
    assert.throws(() => loadConfig(), /public DNS name or IPv4 address/);
    process.env.GAME_SERVER_IP = '127.0.0.1';
    assert.throws(() => loadConfig(), /public DNS name or IPv4 address/);
    configureValidHost();
    process.env.LUCKYBLOX_HOST_PLACES = '0,not-a-place';
    assert.throws(() => loadConfig(), /positive place IDs/);

    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    assert.equal(await probeTcpPort(port), true, 'the readiness probe detects an open local TCP port');
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    assert.equal(await probeTcpPort(port), false, 'the readiness probe rejects a closed TCP port');
  } finally {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log('RCC host worker configuration and TCP readiness checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
