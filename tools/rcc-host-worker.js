'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const rootDir = path.resolve(__dirname, '..');
require('../server/envFile').loadEnvFile(rootDir);
const { gamePort } = require('../server/runtimeConfig');
const { buildLaunchCommand, resolveServerBinary } = require('../server/orchestrator');

const HEARTBEAT_INTERVAL_MS = 20000;
const REQUEST_POLL_INTERVAL_MS = 5000;
const STARTUP_TIMEOUT_MS = 120000;
const servers = [];
const startingRequests = new Set();
const reservedSlots = new Set();
const workerId = `worker-${crypto.randomUUID()}`;
let stopping = false;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadConfig() {
  const siteUrl = new URL(requiredEnv('LUCKYBLOX_HOST_SITE_URL'));
  if (!['http:', 'https:'].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password) {
    throw new Error('LUCKYBLOX_HOST_SITE_URL must be an HTTP(S) URL without credentials');
  }

  const token = requiredEnv('LUCKYBLOX_HOST_TOKEN');
  if (token.length < 32) throw new Error('LUCKYBLOX_HOST_TOKEN must contain at least 32 characters');

  const serverHost = String(process.env.GAME_SERVER_IP || process.env.LUCKYBLOX_GAME_HOST || '')
    .trim()
    .replace(/^\[|\]$/g, '');
  if (!serverHost) throw new Error('GAME_SERVER_IP is required');
  const validHost = serverHost.length <= 253
    && serverHost.toLowerCase() !== 'localhost'
    && /^[a-zA-Z0-9.-]+$/.test(serverHost)
    && serverHost.split('.').every((label) => (
      label.length > 0
      && label.length <= 63
      && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    ));
  const ipv4Parts = net.isIP(serverHost) === 4 ? serverHost.split('.').map(Number) : null;
  const privateIPv4 = ipv4Parts && (
    ipv4Parts[0] === 0 || ipv4Parts[0] === 10 || ipv4Parts[0] === 127 || ipv4Parts[0] >= 224
    || (ipv4Parts[0] === 169 && ipv4Parts[1] === 254)
    || (ipv4Parts[0] === 172 && ipv4Parts[1] >= 16 && ipv4Parts[1] <= 31)
    || (ipv4Parts[0] === 192 && ipv4Parts[1] === 168)
    || (ipv4Parts[0] === 100 && ipv4Parts[1] >= 64 && ipv4Parts[1] <= 127)
  );
  if (!validHost || privateIPv4 || (/^\d+(?:\.\d+){3}$/.test(serverHost) && net.isIP(serverHost) !== 4)) {
    throw new Error('GAME_SERVER_IP must be the public DNS name or IPv4 address of this host');
  }

  const configuredPlaces = String(process.env.LUCKYBLOX_HOST_PLACES || '').trim();
  const places = configuredPlaces
    ? [...new Set(configuredPlaces.split(',').map((value) => Number(value.trim())))]
    : [];
  if (places.some((placeId) => !Number.isSafeInteger(placeId) || placeId <= 0)) {
    throw new Error('LUCKYBLOX_HOST_PLACES must be a comma-separated list of positive place IDs when supplied');
  }

  const maxPlayers = Number(process.env.LUCKYBLOX_HOST_MAX_PLAYERS || 20);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) {
    throw new Error('LUCKYBLOX_HOST_MAX_PLAYERS must be between 1 and 100');
  }
  const maxServers = Number(process.env.LUCKYBLOX_HOST_MAX_SERVERS || Math.max(places.length, 10));
  if (!Number.isInteger(maxServers) || maxServers < 1 || maxServers > 100) {
    throw new Error('LUCKYBLOX_HOST_MAX_SERVERS must be between 1 and 100');
  }
  if (places.length > maxServers) throw new Error('Configured warm-start places exceed LUCKYBLOX_HOST_MAX_SERVERS');
  if (gamePort + maxServers - 1 > 65535) throw new Error('Configured game port range exceeds 65535');

  const configuredPublicPorts = String(process.env.LUCKYBLOX_HOST_PUBLIC_PORTS || '').trim();
  const publicPorts = configuredPublicPorts
    ? configuredPublicPorts.split(',').map((value) => Number(value.trim()))
    : Array.from({ length: maxServers }, (_, index) => gamePort + index);
  if (publicPorts.length !== maxServers
    || publicPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('LUCKYBLOX_HOST_PUBLIC_PORTS must have one valid public port per allowed server slot');
  }

  return { siteUrl: siteUrl.origin, token, serverHost, places, publicPorts, maxPlayers, maxServers };
}

function probeTcpPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(750);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForTcpPort(port, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`RCC process exited before opening TCP port ${port}`);
    }
    if (await probeTcpPort(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`RCC did not open TCP port ${port} within ${STARTUP_TIMEOUT_MS / 1000} seconds`);
}

async function sendHostRequest(config, route, payload) {
  const response = await fetch(new URL(route, `${config.siteUrl}/`), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Host API ${route} returned HTTP ${response.status}: ${body.error || body.message || 'request failed'}`);
  }
  return body;
}

function startRcc(placeId, port) {
  const jobId = `host-${crypto.randomUUID()}`;
  const launch = buildLaunchCommand(placeId, port, jobId, process.platform);
  if (!launch.command) throw new Error(`Cannot launch RCC for place ${placeId}: ${launch.reason}`);

  const scratch = path.join(os.tmpdir(), `luckyblox-rcc-${jobId}`);
  fs.mkdirSync(scratch, { recursive: true });
  const child = spawn(launch.command, launch.args, {
    cwd: path.dirname(launch.command),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TEMP: scratch,
      TMP: scratch,
      TMPDIR: scratch,
      LOCALAPPDATA: scratch,
      APPDATA: scratch,
      USERPROFILE: scratch,
      HOME: scratch,
    },
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[RCC ${jobId}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[RCC ${jobId}] ${chunk}`));
  child.on('error', (error) => {
    process.stderr.write(`[RCC ${jobId}] launch error: ${error.message}\n`);
  });

  return { child, jobId, placeId, port, scratch, registered: false, requestId: null, emptySince: null };
}

function availableSlot(config) {
  for (let slot = 0; slot < config.maxServers; slot += 1) {
    const port = gamePort + slot;
    if (reservedSlots.has(slot) || servers.some((server) => server.port === port)) continue;
    return slot;
  }
  return -1;
}

async function launchServer(config, placeId, slot, request = null) {
  const port = gamePort + slot;
  const publicPort = config.publicPorts[slot];
  if (reservedSlots.has(slot) || servers.some((server) => server.port === port)) {
    throw new Error(`Host server slot ${slot} is already reserved`);
  }
  reservedSlots.add(slot);
  let server = null;

  try {
    if (await probeTcpPort(port)) throw new Error(`Configured game port ${port} is already in use`);
    server = startRcc(placeId, port);
    server.requestId = request ? request.requestId : null;
    servers.push(server);
    server.child.once('exit', (code, signal) => {
      if (server.stopping || stopping) return;
      console.error(`RCC for place ${server.placeId} exited (code=${code}, signal=${signal}).`);
      if (server.registered) {
        sendHostRequest(config, '/api/servers/close', { jobId: server.jobId })
          .catch((error) => console.error(`Could not unregister ${server.jobId}: ${error.message}`));
      }
      const index = servers.indexOf(server);
      if (index >= 0) servers.splice(index, 1);
    });

    await waitForTcpPort(port, server.child);
    await sendHostRequest(config, '/api/servers/register', {
      jobId: server.jobId,
      requestId: request ? request.requestId : undefined,
      workerId,
      placeId,
      port: publicPort,
      serverHost: config.serverHost,
      maxPlayers: config.maxPlayers,
      playerIds: [],
    });
    server.registered = true;
    console.log(`Registered place ${placeId} at ${config.serverHost}:${publicPort} (RCC listens locally on ${port}).`);
  } catch (error) {
    if (server) await stopServer(config, server);
    if (request) {
      await sendHostRequest(config, '/api/servers/host-request-failed', {
        requestId: request.requestId,
        workerId,
        message: error.message,
      }).catch((reportError) => console.error(`Could not report failed place ${placeId}: ${reportError.message}`));
    }
    throw error;
  } finally {
    reservedSlots.delete(slot);
  }
}

async function pollHostRequests(config) {
  const response = await sendHostRequest(config, '/api/servers/host-requests', { workerId });
  for (const request of response.requests || []) {
    if (startingRequests.has(request.requestId)
      || servers.some((server) => server.requestId === request.requestId)) continue;
    if (servers.length >= config.maxServers) break;
    const slot = availableSlot(config);
    if (slot < 0) break;
    startingRequests.add(request.requestId);
    launchServer(config, Number(request.placeId), slot, request)
      .catch((error) => console.error(`Could not start place ${request.placeId}: ${error.message}`))
      .finally(() => startingRequests.delete(request.requestId));
  }
}

async function maintainServers(config) {
  for (const server of servers.slice()) {
    if (!server.registered) continue;
    try {
      const response = await sendHostRequest(config, '/api/servers/update-players', { jobId: server.jobId });
      const players = response.server && Array.isArray(response.server.currentPlayers)
        ? response.server.currentPlayers
        : [];
      if (players.length) server.emptySince = null;
      else if (!server.emptySince) server.emptySince = Date.now();
      else if (Date.now() - server.emptySince >= 10 * 60 * 1000) {
        console.log(`Stopping empty server for place ${server.placeId} after 10 minutes.`);
        await stopServer(config, server);
      }
    } catch (error) {
      console.error(`Heartbeat failed for ${server.jobId}: ${error.message}`);
    }
  }
}

async function stopServer(config, server) {
  if (server.stopping) return;
  server.stopping = true;
  if (server.registered) {
    try {
      await sendHostRequest(config, '/api/servers/close', { jobId: server.jobId });
    } catch (error) {
      console.error(`Could not unregister ${server.jobId}: ${error.message}`);
    }
  }
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill();
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
}

async function startHost(config) {
  if (process.platform !== 'win32') {
    throw new Error('This worker requires Windows because the bundled RCCService build is Windows-only');
  }
  if (!resolveServerBinary()) {
    throw new Error('No bundled RCC executable found. Install Clients/2021E/RCCService on this host.');
  }

  for (const placeId of config.places) {
    const slot = availableSlot(config);
    if (slot < 0) throw new Error('No host server slot is available for a configured warm-start place');
    await launchServer(config, placeId, slot);
  }

  const poll = setInterval(() => {
    if (servers.length < config.maxServers) {
      pollHostRequests(config).catch((error) => console.error(`Host request poll failed: ${error.message}`));
    }
  }, REQUEST_POLL_INTERVAL_MS);
  const heartbeat = setInterval(() => {
    maintainServers(config).catch((error) => console.error(`Host heartbeat maintenance failed: ${error.message}`));
  }, HEARTBEAT_INTERVAL_MS);
  poll.unref();
  heartbeat.unref();
  console.log(`Dynamic public host ready; accepting place requests (capacity ${config.maxServers} servers).`);

  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  clearInterval(poll);
  clearInterval(heartbeat);
  await stopHost(config);
}

async function stopHost(config) {
  if (stopping) return;
  stopping = true;
  await Promise.all(servers.slice().map((server) => stopServer(config, server)));
}

if (require.main === module) {
  let config;
  try {
    config = loadConfig();
    startHost(config).catch((error) => {
      console.error(`RCC host worker failed: ${error.message}`);
      if (config) stopHost(config).finally(() => process.exit(1));
      else process.exit(1);
    });
  } catch (error) {
    console.error(`RCC host worker configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { loadConfig, probeTcpPort };
