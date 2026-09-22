const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const net = require('net');
const path = require('path');
const fs = require('fs');

const DEFAULT_PORT_START = 53640;
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

  listener.listen(serverRecord.port, '127.0.0.1', () => {
    console.log(`[LuckyBlox Server:${serverRecord.serverJobId}] listening on 127.0.0.1:${serverRecord.port}`);
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

  const candidates = [robloxPlayer, studioPlayer];
  const availableCandidate = candidates.find((candidate) => fs.existsSync(candidate));

  if (!availableCandidate) {
    return {
      command: 'cmd',
      args: ['/c', 'echo', 'LuckyBlox server process unavailable'],
      type: 'fallback',
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

  try {
    const child = spawn(launch.command, launch.args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    serverRecord.pid = child.pid;
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
      removeServerByJobId(serverJobId);
    });
  } catch (error) {
    console.warn(`[LuckyBlox Server:${serverJobId}] client launch not available: ${error.message}`);
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

module.exports = {
  activeGameServers,
  serverRuntimeState,
  allocatePlayerToServer,
  removePlayerFromServer,
  removeServerByJobId,
  registerServerRecord,
  spawnDedicatedServer,
  nextAvailablePort,
  getServerForPlace,
};
