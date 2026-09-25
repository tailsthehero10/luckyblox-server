const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { gamePort, gameServerHost } = require('./runtimeConfig');

const DEFAULT_PORT_START = gamePort;
// Bind game servers on every interface so remote players on other devices can
// reach them inside the container, not just the local loopback address.
const GAME_LISTEN_HOST = gameServerHost;
const activeGameServers = [];
const serverRuntimeState = {
  lastAssignedPort: DEFAULT_PORT_START,
};

const releaseRoot = path.resolve(__dirname, '..');
const clientRoot = path.join(releaseRoot, 'Clients', '2021M');
const studioRoot = path.join(releaseRoot, 'Clients', '2022M');

function ensurePortCandidate(port) {
  const taken = activeGameServers.some((server) => Number(server.port) === Number(port));
  if (!taken) {
    return Number(port);
  }

  let candidate = Number(port) + 1;
  while (activeGameServers.some((server) => Number(server.port) === candidate)) {
    candidate += 1;
  }

  return candidate;
}

function nextAvailablePort() {
  let candidate = serverRuntimeState.lastAssignedPort;
  let tries = 0;

  while (tries < 256) {
    const port = ensurePortCandidate(candidate);
    const inUse = activeGameServers.some((server) => Number(server.port) === port);
    if (!inUse) {
      serverRuntimeState.lastAssignedPort = port;
      return port;
    }
    candidate += 1;
    tries += 1;
  }

  return DEFAULT_PORT_START + activeGameServers.length;
}

function registerServerRecord(serverRecord) {
  const exists = activeGameServers.some((server) => server.serverJobId === serverRecord.serverJobId);
  if (!exists) {
    activeGameServers.push(serverRecord);
  } else {
    const idx = activeGameServers.findIndex((server) => server.serverJobId === serverRecord.serverJobId);
    activeGameServers[idx] = { ...activeGameServers[idx], ...serverRecord };
  }

  return serverRecord;
}

function removeServerByJobId(serverJobId) {
  const idx = activeGameServers.findIndex((server) => server.serverJobId === serverJobId);
  if (idx >= 0) {
    const [removed] = activeGameServers.splice(idx, 1);
    if (removed && removed.listener && typeof removed.listener.close === 'function') {
      removed.listener.close(() => {
        console.log(`[LuckyBlox Server:${removed.serverJobId}] listener closed`);
      });
    }
    return removed;
  }
  return null;
}

function ensureServerListener(serverRecord) {
  if (!serverRecord || serverRecord.listener) {
    return serverRecord;
  }

  const listener = net.createServer((socket) => {
    const remoteAddress = socket.remoteAddress || 'unknown';
    console.log(`[LuckyBlox Server:${serverRecord.serverJobId}] connection from ${remoteAddress}`);
    socket.write(JSON.stringify({
      ok: true,
      status: 'connected',
      jobId: serverRecord.serverJobId,
      placeId: serverRecord.placeId,
      port: serverRecord.port,
      server: 'LuckyBlox local game server',
    }));
    socket.end();
  });

  listener.on('error', (error) => {
    console.error(`[LuckyBlox Server:${serverRecord.serverJobId}] listener error: ${error.message}`);
  });

  listener.listen(serverRecord.port, GAME_LISTEN_HOST, () => {
    console.log(`[LuckyBlox Server:${serverRecord.serverJobId}] listening on ${GAME_LISTEN_HOST}:${serverRecord.port}`);
  });

  serverRecord.listener = listener;
  return serverRecord;
}

function getServerForPlace(placeId) {
  return activeGameServers.find((server) => Number(server.placeId) === Number(placeId) && Array.isArray(server.currentPlayers) && server.currentPlayers.length < server.maxPlayers);
}

function buildLaunchCommand(placeId, port, jobId) {
  const robloxPlayer = path.join(clientRoot, 'RobloxPlayerBeta.exe');
  const studioPlayer = path.join(studioRoot, 'RobloxStudioBeta.exe');
  const launcherOptions = [
    '--app',
    'roblox-player',
    '--placeId', String(placeId),
    '--serverPort', String(port),
    '--jobId', String(jobId),
  ];

  // These are Windows desktop binaries. On Linux (the container) they can never
  // exist, and the local fallback used to be `cmd /c echo` - a Windows shell
  // that is also missing there. Spawning it threw ENOENT and took the whole
  // bridge process down, which surfaced to players as
  // "legacy-server-proxy-failed" on the join URL.
  //
  // A game server with no desktop client to launch is not an error: the
  // in-process listener still accepts the connection, which is what a local
  // play session actually uses. So report "no desktop client" and let the
  // caller skip the spawn instead of trying to run an executable that cannot
  // exist here.
  const candidates = [robloxPlayer, studioPlayer];
  const availableCandidate = candidates.find((candidate) => fs.existsSync(candidate));

  if (!availableCandidate) {
    return {
      command: null,
      args: [],
      type: 'none',
      reason: process.platform === 'win32'
        ? 'no local Roblox client is installed'
        : 'desktop client launch is not available on this platform',
    };
  }

  return {
    command: availableCandidate,
    args: launcherOptions,
    type: 'native-roblox',
  };
}

function spawnDedicatedServer(placeId) {
  const port = nextAvailablePort();
  const serverJobId = randomUUID();
  const serverRecord = {
    serverJobId,
    placeId: Number(placeId),
    port,
    currentPlayers: [],
    maxPlayers: 20,
    status: 'starting',
    startedAt: new Date().toISOString(),
    pid: null,
    launchCommand: null,
  };

  const launch = buildLaunchCommand(placeId, port, serverJobId);
  serverRecord.launchCommand = launch;

  // Only spawn when there is actually something to spawn. On Linux there is no
  // desktop client, and the old code still tried to run a Windows shell - the
  // spawn error propagated and killed the bridge process, which is why joining
  // a game returned "legacy-server-proxy-failed".
  if (launch.command) {
    try {
      const child = spawn(launch.command, launch.args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      serverRecord.pid = child.pid;

      child.on('error', (error) => {
        // A missing desktop client must never take the game server down with it.
        console.warn(`[LuckyBlox Server:${serverJobId}] client launch unavailable: ${error.message}`);
        serverRecord.pid = null;
      });

      child.stdout.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text.length) {
          console.log(`[LuckyBlox Server:${serverJobId}] stdout: ${text}`);
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text.length) {
          console.error(`[LuckyBlox Server:${serverJobId}] stderr: ${text}`);
        }
      });

      child.on('exit', (code, signal) => {
        console.log(`[LuckyBlox Server:${serverJobId}] exited code=${code} signal=${signal}`);
        // The desktop client exiting means the local player closed it. The
        // hosted game server listener is independent and must stay up, so the
        // record is kept and only the pid is cleared.
        serverRecord.pid = null;
      });
    } catch (error) {
      console.warn(`[LuckyBlox Server:${serverJobId}] client launch not available: ${error.message}`);
    }
  } else {
    console.log(`[LuckyBlox Server:${serverJobId}] no desktop client to launch (${launch.reason})`);
  }

  serverRecord.status = 'running';
  ensureServerListener(serverRecord);
  registerServerRecord(serverRecord);
  return serverRecord;
}

function allocatePlayerToServer(userId, placeId) {
  const targetPlaceId = Number(placeId || 1818);
  const server = getServerForPlace(targetPlaceId);

  if (server) {
    if (!server.currentPlayers.includes(String(userId))) {
      server.currentPlayers.push(String(userId));
    }
    return {
      ok: true,
      serverJobId: server.serverJobId,
      port: Number(server.port),
      placeId: Number(targetPlaceId),
      playerCount: server.currentPlayers.length,
      created: false,
    };
  }

  const newServer = spawnDedicatedServer(targetPlaceId);
  if (!newServer || !newServer.serverJobId) {
    throw new Error('Failed to create a dedicated game server instance.');
  }

  if (!newServer.currentPlayers.includes(String(userId))) {
    newServer.currentPlayers.push(String(userId));
  }

  return {
    ok: true,
    serverJobId: newServer.serverJobId,
    port: Number(newServer.port),
    placeId: Number(targetPlaceId),
    playerCount: newServer.currentPlayers.length,
    created: true,
  };
}

function removePlayerFromServer(userId, serverJobId) {
  const server = activeGameServers.find((candidate) => candidate.serverJobId === serverJobId);
  if (!server) {
    return null;
  }

  server.currentPlayers = (server.currentPlayers || []).filter((id) => String(id) !== String(userId));
  return server;
}

/**
 * Roblox-style server listing for a place. Each entry describes one running
 * job the way a client expects to see it when it asks "where can I join?".
 */
function listServersForPlace(placeId) {
  const target = Number(placeId || 1818);
  return activeGameServers
    .filter((server) => Number(server.placeId) === target)
    .map((server) => ({
      id: server.serverJobId,
      jobId: server.serverJobId,
      maxPlayers: Number(server.maxPlayers || 20),
      playing: Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0,
      playerTokens: Array.isArray(server.currentPlayers) ? server.currentPlayers.slice() : [],
      players: Array.isArray(server.currentPlayers) ? server.currentPlayers.slice() : [],
      port: Number(server.port),
      status: server.status || 'running',
      ping: 0,
      fps: 60,
    }));
}

/**
 * Full status for a single job, or null when it has gone away. Clients poll
 * this after joining so a dead job is detected instead of hanging.
 */
function getJobStatus(serverJobId) {
  const server = activeGameServers.find((candidate) => candidate.serverJobId === serverJobId);
  if (!server) {
    return null;
  }

  const players = Array.isArray(server.currentPlayers) ? server.currentPlayers : [];

  // The friendly title and the place's own limits, so a consumer (the site, or
  // the Discord companion) can name the experience without re-deriving it from
  // a local file. The orchestrator is deliberately not coupled to games.json,
  // so the title is carried on the server record when the job is created
  // (see spawnDedicatedServer / setJobTitle) and simply omitted when unknown -
  // an absent title is better than an invented one.
  return {
    ok: true,
    jobId: server.serverJobId,
    placeId: Number(server.placeId),
    placeName: server.placeName || null,
    port: Number(server.port),
    status: server.status || 'running',
    playerCount: players.length,
    maxPlayers: Number(server.maxPlayers || 20),
    slotsLeft: Math.max(0, Number(server.maxPlayers || 20) - players.length),
    players: players.slice(),
    startedAt: server.startedAt,
    uptimeSeconds: server.startedAt
      ? Math.max(0, Math.round((Date.now() - new Date(server.startedAt).getTime()) / 1000))
      : 0,
  };
}

/**
 * Attach the experience's friendly title to a running job.
 *
 * The bridge knows games.json (and therefore the real title); the orchestrator
 * does not. Rather than duplicating that lookup here, the bridge stamps the
 * title onto the record, so /api/jobs/<id> can report the name a player would
 * recognise - which is what the Discord card and any status UI need.
 */
function setJobTitle(serverJobId, placeName) {
  const server = activeGameServers.find((candidate) => candidate.serverJobId === serverJobId);
  if (!server) return false;
  server.placeName = placeName ? String(placeName) : null;
  return true;
}

/**
 * Create (or reuse) a job for a place and bind a user to it. This is the single
 * server-side entry point the launch flow uses, so the ticket, the job id and
 * the port handed to the client are always consistent with each other.
 */
function createJoinJob(userId, placeId) {
  const allocation = allocatePlayerToServer(userId, placeId);
  const status = getJobStatus(allocation.serverJobId);

  return {
    ok: true,
    jobId: allocation.serverJobId,
    serverJobId: allocation.serverJobId,
    placeId: Number(allocation.placeId),
    // The friendly name, when the bridge has stamped one onto the record.
    placeName: (status && status.placeName) || null,
    port: Number(allocation.port),
    playerCount: Number(allocation.playerCount || 0),
    maxPlayers: status ? status.maxPlayers : 20,
    slotsLeft: status ? status.slotsLeft : 20,
    created: Boolean(allocation.created),
    serverHost: GAME_LISTEN_HOST,
  };
}

/** Total players across every running job — used by the preview page. */
function getTotalPlayerCount() {
  return activeGameServers.reduce((sum, server) => {
    return sum + (Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0);
  }, 0);
}

module.exports = {
  activeGameServers,
  serverRuntimeState,
  allocatePlayerToServer,
  createJoinJob,
  getJobStatus,
  setJobTitle,
  getTotalPlayerCount,
  listServersForPlace,
  removePlayerFromServer,
  removeServerByJobId,
  registerServerRecord,
  spawnDedicatedServer,
  nextAvailablePort,
  getServerForPlace,
};
