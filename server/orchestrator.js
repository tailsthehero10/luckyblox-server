const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const { gamePort, gameServerHost } = require('./runtimeConfig');

const DEFAULT_PORT_START = gamePort;
const advertisedGameHost = new URL(`http://${gameServerHost}`).hostname;
const REMOTE_SERVER_HEARTBEAT_TTL_MS = 60 * 1000;
const activeGameServers = [];
const serverRuntimeState = {
  lastAssignedPort: DEFAULT_PORT_START,
};

const releaseRoot = path.resolve(__dirname, '..');
const clientRoot = path.join(releaseRoot, 'Clients', '2021M');
const studioRoot = path.join(releaseRoot, 'Clients', '2022M');

/**
 * The DEDICATED SERVER binary, which is NOT the player client.
 *
 * This used to launch `Clients/2021M/RobloxPlayerBeta.exe` with
 * `--app roblox-player` - i.e. it started a second PLAYER window, not a game
 * server. That window cannot parse those arguments, so it exited immediately
 * with `code=1` and the job was dead before anyone could join. The 2021E build
 * ships the server-side binary under `RCCService/`.
 */
const SERVER_BINARY_CANDIDATES = [
  path.join(releaseRoot, 'Clients', '2021E', 'RCCService', 'RCCService.exe'),
  path.join(releaseRoot, 'Clients', '2021E', 'RCCService', 'RobloxPlayerBeta.exe'),
  path.join(releaseRoot, 'Clients', '2021E', 'RobloxPlayerBeta.exe'),
  path.join(releaseRoot, 'RCCService', 'RCCService.exe'),
];

/** First compatible dedicated-server binary, or null. */
function resolveServerBinary(platform = process.platform) {
  if (platform !== 'win32') return null;
  return SERVER_BINARY_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

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

function pruneStaleRemoteServers() {
  const now = Date.now();
  activeGameServers
    .filter((server) => server.remoteHost)
    .forEach((server) => {
      const lastHeartbeat = Date.parse(server.lastHeartbeatAt || '');
      if (!Number.isFinite(lastHeartbeat) || now - lastHeartbeat > REMOTE_SERVER_HEARTBEAT_TTL_MS) {
        removeServerByJobId(server.serverJobId);
      }
    });
}

function getServerForPlace(placeId) {
  pruneStaleRemoteServers();
  return activeGameServers.find((server) => Number(server.placeId) === Number(placeId) && Array.isArray(server.currentPlayers) && server.currentPlayers.length < server.maxPlayers);
}

/**
 * A scratch directory on the RELEASE drive.
 *
 * The spawned server inherits this process's environment, including TEMP, which
 * on Windows is C:\Users\<user>\AppData\Local\Temp. This project lives on E:
 * and C: is nearly full, so the child gets its own temp/tmp/cache pointing at
 * <release>\.tmp\server-<jobId> instead. LUCKYBLOX_TMP overrides.
 */
function serverScratchDir(jobId) {
  const base = process.env.LUCKYBLOX_TMP && process.env.LUCKYBLOX_TMP.trim()
    ? process.env.LUCKYBLOX_TMP.trim()
    : path.join(releaseRoot, '.tmp');
  const dir = path.join(base, `server-${jobId}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  return dir;
}

function buildLaunchCommand(placeId, port, jobId, platform = process.platform) {
  // The SERVER binary, not the player. See SERVER_BINARY_CANDIDATES above - the
  // old code launched the player client here, which exited code=1 instantly.
  const serverBinary = resolveServerBinary(platform);

  // These are Windows desktop binaries. On Linux (the container) they can never
  // exist, and the local fallback used to be `cmd /c echo` - a Windows shell
  // that is also missing there. Spawning it threw ENOENT and took the whole
  // bridge process down, which surfaced to players as
  // "legacy-server-proxy-failed" on the join URL.
  //
  // A game server with no dedicated binary cannot serve a real Roblox session.
  // Never substitute a TCP/JSON listener: legacy clients interpret this job as
  // a real game server and may crash when they receive a non-Roblox protocol.
  if (!serverBinary) {
    return {
      command: null,
      args: [],
      type: 'none',
      reason: platform === 'win32'
        ? 'no dedicated server binary found (looked for Clients/2021E/RCCService)'
        : 'the bundled RCCService binary is Windows-only and cannot run on this host',
    };
  }

  // The 2021 conference builds take a lower-case `-console` and each value as
  // its own `-key:value` token. `-Console` and a separate `-port <n>` argument
  // (the previous form) are not parsed, which is another way the server died
  // straight away.
  return {
    command: serverBinary,
    args: [
      '-console', '-verbose',
      `-placeid:${placeId}`,
      `-jobid:${jobId}`,
      `-port:${port}`,
    ],
    type: 'dedicated-server',
  };
}

function spawnDedicatedServer(placeId, platform = process.platform) {
  const port = nextAvailablePort();
  const serverJobId = randomUUID();
  const serverRecord = {
    serverJobId,
    placeId: Number(placeId),
    port,
    serverHost: advertisedGameHost,
    currentPlayers: [],
    maxPlayers: 20,
    status: 'starting',
    startedAt: new Date().toISOString(),
    pid: null,
    launchCommand: null,
  };

  const launch = buildLaunchCommand(placeId, port, serverJobId, platform);
  serverRecord.launchCommand = launch;

  if (!launch.command) {
    const error = new Error(`Cannot host this game here: ${launch.reason}`);
    error.code = 'game-server-unavailable';
    throw error;
  }

  try {
    // Keep every child temp/cache path on the release drive (E:) rather than
    // inheriting C:\Users\...\AppData, which is what filled C: up.
    const scratch = serverScratchDir(serverJobId);

    const child = spawn(launch.command, launch.args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(launch.command),
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

    serverRecord.pid = child.pid;

    child.on('error', (error) => {
      console.warn(`[LuckyBlox Server:${serverJobId}] dedicated server launch unavailable: ${error.message}`);
      serverRecord.pid = null;
      serverRecord.status = 'failed';
      removeServerByJobId(serverJobId);
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
      serverRecord.pid = null;
      serverRecord.status = 'stopped';
      removeServerByJobId(serverJobId);
    });
  } catch (error) {
    console.warn(`[LuckyBlox Server:${serverJobId}] dedicated server launch failed: ${error.message}`);
    throw error;
  }

  serverRecord.status = 'running';
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
      serverHost: server.serverHost || advertisedGameHost,
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
    serverHost: newServer.serverHost || advertisedGameHost,
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
  pruneStaleRemoteServers();
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
      host: server.serverHost || advertisedGameHost,
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
  pruneStaleRemoteServers();
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
    serverHost: server.serverHost || advertisedGameHost,
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
    serverHost: allocation.serverHost || (status && status.serverHost) || advertisedGameHost,
  };
}

/** Total players across every running job — used by the preview page. */
function getTotalPlayerCount() {
  pruneStaleRemoteServers();
  return activeGameServers.reduce((sum, server) => {
    return sum + (Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0);
  }, 0);
}

module.exports = {
  activeGameServers,
  serverRuntimeState,
  allocatePlayerToServer,
  buildLaunchCommand,
  createJoinJob,
  getJobStatus,
  setJobTitle,
  getTotalPlayerCount,
  listServersForPlace,
  removePlayerFromServer,
  removeServerByJobId,
  pruneStaleRemoteServers,
  registerServerRecord,
  spawnDedicatedServer,
  resolveServerBinary,
  nextAvailablePort,
  getServerForPlace,
};
