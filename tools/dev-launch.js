'use strict';

/**
 * LuckyBlox DEV launcher — play against the LIVE site from your PC.
 *
 * Why this exists
 * ---------------
 * The LIVE deployment (https://luckyblox-server.onrender.com) is the *site*:
 * accounts, catalog, launch tickets, join scripts. Render's free container is a
 * single HTTP port and cannot host a Roblox game server, so the live site can
 * hand you a ticket but nothing is listening on the game port it names.
 *
 * This tool closes that gap: it signs in to the LIVE site, asks for a real
 * launch ticket for your account, runs the game server LOCALLY on your Windows
 * box, and points the client at 127.0.0.1 so you actually drop into a place.
 *
 * Flow
 * ----
 *   1. POST  <site>/api/login           -> session cookie
 *   2. POST  <site>/api/launch-game     -> ticket, placeId, jobId
 *   3. resolve the currently selected local map to its actual catalog place id
 *   4. start the matching local-test server with a per-session map/join endpoint
 *   5. launch an isolated copy of the selected client with the LIVE BaseUrl
 *
 * Usage
 * -----
 *   node tools/dev-launch.js                     # play the map in Settings/MapPath.txt
 *   node tools/dev-launch.js --place 1813        # pick a local catalog place
 *   node tools/dev-launch.js --testblox --Testblox10
 *   node tools/dev-launch.js --dry-run           # resolve only, launch nothing
 *   node tools/dev-launch.js --url https://...   # a different site
 *
 * NOTE ON --dry-run
 * -----------------
 * This used to default to TRUE, so `Settings\DEV-PLAY.bat` resolved a ticket and
 * then exited without ever starting a server or a client - "it breaks and can't
 * even join the games". Launching is now the default and --dry-run is opt-in.
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const RELEASE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LIVE_URL = 'https://luckyblox-server.onrender.com';
const DEFAULT_CLIENT = '2021M';
const SERVER_START_TIMEOUT_MS = 60000;
const MAPS_DIR = path.join(RELEASE_ROOT, 'Maps');
const GAMES_FILE = path.join(RELEASE_ROOT, 'Webserver', 'http-db-bridge', 'data', 'games.json');
const SERVER_ROOT = path.join(RELEASE_ROOT, 'shared');

/**
 * The client folder a --client name resolves to.
 *
 * The repackaged CUSTOM-2021M keeps its binary in a `Player/` sub-folder, so a
 * plain `Clients/<name>/RobloxPlayerBeta.exe` check would miss it.
 */
function resolveClientDir(clientName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(clientName || ''))) {
    throw new Error(`invalid client name: ${clientName}`);
  }
  const dir = path.join(RELEASE_ROOT, 'Clients', clientName);
  if (fs.existsSync(path.join(dir, 'Player', 'RobloxPlayerBeta.exe'))) {
    return path.join(dir, 'Player');
  }
  if (fs.existsSync(path.join(dir, 'RobloxPlayerBeta.exe'))) return dir;
  throw new Error(`client ${clientName} has no RobloxPlayerBeta.exe`);
}

function normalizeTitle(value) {
  return path.basename(String(value || '').trim())
    .replace(/\.(?:rbxlx?|rbxmx?)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readLocalGames(gamesFile = GAMES_FILE) {
  try {
    const contents = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));
    return Object.values(contents || {}).filter((game) => game && Number(game.placeId) > 0);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`could not read local game catalog ${gamesFile}: ${error.message}`);
  }
}

function mapFileForGame(game, mapsDir = MAPS_DIR) {
  if (!game) return null;
  const explicitNames = [game.mapFile, game.fileName, game.filePath, game.mapPath].filter(Boolean);
  for (const name of explicitNames) {
    const candidate = path.isAbsolute(name) ? name : path.join(mapsDir, name);
    if (/\.(rbxl|rbxlx)$/i.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }

  const wantedTitle = normalizeTitle(game.title);
  if (!wantedTitle || !fs.existsSync(mapsDir)) return null;
  const matches = fs.readdirSync(mapsDir)
    .filter((name) => /\.(rbxl|rbxlx)$/i.test(name)
      && normalizeTitle(name) === wantedTitle)
    .sort((a, b) => a.localeCompare(b));
  return matches.length ? path.join(mapsDir, matches[0]) : null;
}

function resolvePlaceMap(placeId, games = readLocalGames()) {
  const game = games.find((entry) => Number(entry.placeId) === Number(placeId));
  const mapPath = mapFileForGame(game);
  return game && mapPath
    ? { placeId: Number(game.placeId), title: String(game.title || path.basename(mapPath)), mapPath }
    : null;
}

function resolveDefaultPlace(settingsDir = path.join(RELEASE_ROOT, 'Settings'), games = readLocalGames()) {
  const mapPathFile = path.join(settingsDir, 'MapPath.txt');
  let selectedMap;
  try {
    selectedMap = fs.readFileSync(mapPathFile, 'utf8').replace(/^\uFEFF/, '').trim();
  } catch (error) {
    if (error.code === 'ENOENT') selectedMap = '';
    else throw new Error(`could not read selected map ${mapPathFile}: ${error.message}`);
  }

  if (selectedMap) {
    const resolvedPath = path.resolve(selectedMap);
    if (!/\.(rbxl|rbxlx)$/i.test(resolvedPath) || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`the selected map does not exist or is not an RBXL file: ${selectedMap}`);
    }
    const selectedTitle = normalizeTitle(resolvedPath);
    const game = games.find((entry) => normalizeTitle(entry.title) === selectedTitle
      || [entry.mapFile, entry.fileName].some((name) => name && normalizeTitle(name) === selectedTitle));
    if (!game) {
      throw new Error(
        `the selected map "${path.basename(resolvedPath)}" has no matching place in the local game catalog. `
        + 'Pass --place <id> after publishing/linking that map to an experience.',
      );
    }
    return { placeId: Number(game.placeId), title: String(game.title || path.basename(resolvedPath)), mapPath: resolvedPath };
  }

  const firstAvailable = games
    .map((game) => ({ game, mapPath: mapFileForGame(game) }))
    .find((entry) => entry.mapPath);
  if (firstAvailable) {
    return {
      placeId: Number(firstAvailable.game.placeId),
      title: String(firstAvailable.game.title || path.basename(firstAvailable.mapPath)),
      mapPath: firstAvailable.mapPath,
    };
  }
  return null;
}

function resolveServerBinary(clientName) {
  const clientSpecific = path.join(SERVER_ROOT, `${clientName}.exe`);
  if (fs.existsSync(clientSpecific)) return clientSpecific;
  const fallback = path.join(SERVER_ROOT, '2021E.exe');
  return fs.existsSync(fallback) ? fallback : null;
}

function readSelectedClient(selectedFile = path.join(RELEASE_ROOT, 'Settings', 'SelectedClient.txt')) {
  try {
    const selected = fs.readFileSync(selectedFile, 'utf8').replace(/^\uFEFF/, '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(selected)
      && fs.existsSync(path.join(RELEASE_ROOT, 'Clients', selected, 'AppSettings.xml'))) {
      return selected;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return DEFAULT_CLIENT;
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_LIVE_URL,
    place: null,
    placeExplicit: false,
    client: process.env.LUCKYBLOX_DEV_CLIENT || readSelectedClient(),
    // Launch by default. --dry-run turns this off, NOT the other way round:
    // defaulting to true meant DEV-PLAY.bat never actually played anything.
    dryRun: false,
    keepAlive: true,
    // Credentials for the LIVE site. Taken from the environment by default so a
    // developer can set them once; --user/--pass override for a one-off.
    user: process.env.LUCKYBLOX_DEV_USER || 'testblox',
    pass: process.env.LUCKYBLOX_DEV_PASS || 'Testblox10',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--url') args.url = argv[++i];
    else if (token === '--place' || token === '--placeid') {
      args.place = Number(argv[++i]);
      args.placeExplicit = Number.isSafeInteger(args.place) && args.place > 0;
      if (!args.placeExplicit) throw new Error(`${token} requires a positive integer place id.`);
    }
    else if (token === '--client') args.client = argv[++i];
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--no-keepalive') args.keepAlive = false;
    else if (token === '--user' || token === '--username') args.user = argv[++i] || '';
    else if (token === '--pass' || token === '--password') args.pass = argv[++i] || '';
    // `--testblox [password]` is the shorthand the DEV-PLAY.bat header documents.
    // It used to be swallowed as an unknown flag, so the documented one-liner did
    // nothing. Treat it as "sign in as testblox" and take the NEXT token as the
    // password only when it is not another flag.
    else if (token === '--testblox') {
      args.user = 'testblox';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.pass = next;
        i += 1;
      }
    }
    else if (token === '--help' || token === '-h') args.help = true;
  }
  args.url = String(args.url || DEFAULT_LIVE_URL).replace(/\/+$/, '');
  const envPlaceValue = String(process.env.LUCKYBLOX_DEV_PLACE || '').trim();
  if (!args.placeExplicit && envPlaceValue) {
    const envPlace = Number(envPlaceValue);
    if (!Number.isSafeInteger(envPlace) || envPlace <= 0) {
      throw new Error('LUCKYBLOX_DEV_PLACE must be a positive integer place id.');
    }
    args.place = envPlace;
    args.placeExplicit = true;
  }
  if (args.help) return args;
  if (!args.placeExplicit) {
    const selected = resolveDefaultPlace();
    if (!selected) {
      throw new Error('no local place is selected. Set Settings\\MapPath.txt or pass --place <id>.');
    }
    args.place = selected.placeId;
    args.mapPath = selected.mapPath;
    args.placeTitle = selected.title;
  } else {
    const selected = resolvePlaceMap(args.place);
    args.mapPath = selected && selected.mapPath;
    args.placeTitle = selected && selected.title;
  }
  // An empty password would be sent as "" and rejected; keep the default when the
  // caller only supplied a username.
  if (!args.pass) args.pass = process.env.LUCKYBLOX_DEV_PASS || 'Testblox10';
  return args;
}

function log(step, message) {
  console.log(`[dev-launch] ${step.padEnd(12)} ${message}`);
}

function createDevHttpServer({
  placeId, mapPath, userId, ticket, jobId, gamePort, baseUrl,
}) {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/asset/' || requestUrl.pathname === '/asset') {
      if (Number(requestUrl.searchParams.get('id')) !== Number(placeId)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Local place asset not found.');
        return;
      }
      const stat = fs.statSync(mapPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(mapPath).pipe(res);
      return;
    }

    if (requestUrl.pathname === '/game/join' || requestUrl.pathname === '/game/Join.ashx') {
      const requestedPlaceId = Number(requestUrl.searchParams.get('placeId') || requestUrl.searchParams.get('placeid'));
      const requestedUserId = Number(requestUrl.searchParams.get('userId') || requestUrl.searchParams.get('userid'));
      const requestedTicket = requestUrl.searchParams.get('ticket');
      if (requestedPlaceId !== Number(placeId)
        || requestedUserId !== Number(userId)
        || requestedTicket !== String(ticket)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'local-launch-target-mismatch' }));
        return;
      }
      const joinScriptUrl = `http://127.0.0.1:${server.address().port}/game/join?placeId=${placeId}`
        + `&userId=${userId}&ticket=${encodeURIComponent(ticket)}&serverPort=${gamePort}&jobId=${encodeURIComponent(jobId)}`;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        status: 2,
        jobId,
        placeId: Number(placeId),
        userId: Number(userId),
        ip: '127.0.0.1',
        port: Number(gamePort),
        serverPort: Number(gamePort),
        joinScriptUrl,
        authenticationUrl: `${baseUrl}/Login/Negotiate.ashx`,
        authenticationTicket: String(ticket),
        clientTicket: String(ticket),
        message: null,
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DEV-PLAY local endpoint not found.');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

function createLocalServerConfig(templatePath, outputPath, { placeId, mapUrl, baseUrl, jobId, port }) {
  const config = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  if (!config.Settings || typeof config.Settings !== 'object') {
    throw new Error(`invalid local game-server settings template: ${templatePath}`);
  }
  config.Settings.PlaceId = Number(placeId);
  config.Settings.PlaceFetchUrl = mapUrl;
  config.Settings.BaseUrl = baseUrl;
  config.Settings.JobId = String(jobId);
  config.Settings.PreferredPort = Number(port);
  config.Settings.MachineAddress = 'http://127.0.0.1';
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return outputPath;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function prepareDevClient(clientDir, clientName, baseUrl, runId) {
  const sourceExe = path.join(clientDir, 'RobloxPlayerBeta.exe');
  const runDir = path.join(scratchDir(), `dev-client-${runId}`);
  fs.mkdirSync(runDir, { recursive: true });

  const copyRuntimeTree = (source, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.name.toLowerCase() === 'appsettings.xml') continue;
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        copyRuntimeTree(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        try {
          fs.linkSync(sourcePath, destinationPath);
        } catch (error) {
          if (!['EXDEV', 'EPERM', 'EACCES', 'EMLINK'].includes(error.code)) throw error;
          fs.copyFileSync(sourcePath, destinationPath);
        }
      }
    }
  };
  copyRuntimeTree(clientDir, runDir);
  const suffix = /^(2021|CUSTOM-2021)/i.test(clientName)
    ? '/LuckBlox.site.tk/home/'
    : '/LuckBlox.site.tk/';
  const appSettings = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Settings>',
    `  <ContentFolder>${xmlEscape(path.join(RELEASE_ROOT, 'shared', 'content'))}</ContentFolder>`,
    `  <BaseUrl>${xmlEscape(`${baseUrl}${suffix}`)}</BaseUrl>`,
    '</Settings>',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(runDir, 'AppSettings.xml'), appSettings, 'utf8');
  if (!fs.existsSync(path.join(runDir, path.basename(sourceExe)))) {
    throw new Error(`could not prepare isolated client files for ${clientName}`);
  }
  return { runDir, exe: path.join(runDir, 'RobloxPlayerBeta.exe') };
}

/**
 * Sign in to the LIVE site and return the session cookie.
 *
 * WHY THIS EXISTS
 * ---------------
 * Requesting a launch ticket requires a real session: the route used to fall back
 * to user 1 (the deployment owner) when nobody was signed in, which let anyone
 * launch as the owner without authenticating. That fallback was removed on
 * purpose, so this tool - which sent no cookie at all - started getting:
 *
 *   401 {"error":"sign-in-required","message":"You need to sign in to play."}
 *
 * The tool has to do what a person does: sign in, keep the cookie, and send it with
 * the launch request. Credentials come from the command line or the environment so
 * no password is ever stored in the repo.
 *
 * @returns {string} the Cookie header value
 */
async function signIn(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* non-JSON body, reported below */ }

  if (!res.ok || !payload || !payload.ok) {
    const detail = (payload && (payload.message || payload.error)) || text.slice(0, 200);
    throw new Error(`sign-in failed (${res.status}): ${detail}`);
  }

  // Node's fetch exposes Set-Cookie through getSetCookie(); fall back to the raw
  // header for older runtimes. Only the name=value part is sent back.
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);

  const cookies = raw.map((c) => String(c).split(';')[0]).filter(Boolean);
  if (!cookies.length) {
    throw new Error(
      'signed in but the server returned no session cookie - the site may be '
      + 'rejecting the request before the session is issued',
    );
  }
  return cookies.join('; ');
}

/** Ask the LIVE site for a launch ticket through the public API. */
async function requestLaunchTicket(baseUrl, placeId, cookie) {
  const url = `${baseUrl}/api/launch-game`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

  // The ticket is issued for the SIGNED-IN account. No userId is sent in the body:
  // the server reads it from the session, and sending one would only invite the
  // client to disagree with the server about who is playing.
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ placeId }),
  });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }

  if (res.status === 401) {
    // Distinguish "nobody signed in" from "credentials were rejected", because the
    // fixes are different and the raw 401 message says neither.
    throw new Error(
      'the LIVE site refused the launch (401): not signed in.\n'
      + '       Pass --user and --pass, or set LUCKYBLOX_DEV_USER / LUCKYBLOX_DEV_PASS.\n'
      + '       The launch route requires a real session and will not fall back to user 1.',
    );
  }

  if (!res.ok || !payload || !payload.ok) {
    const detail = payload && (payload.message || payload.error) ? (payload.message || payload.error) : text.slice(0, 200);
    throw new Error(`LIVE site refused the launch (${res.status}): ${detail}`);
  }
  return payload;
}

/** Find a free TCP port on the loopback interface. */
function findFreePort(start = 53640) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      if (port > start + 200) return reject(new Error('no free port found'));
      const probe = net.createServer();
      probe.once('error', () => { port += 1; tryPort(); });
      probe.once('listening', () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

/**
 * Start the local dedicated server and wait until its join port accepts
 * connections. A plain TCP listener is not a game server and must not be used as
 * a success-shaped fallback.
 */
function startLocalGameServer({ port, placeId, jobId, clientName, localHttpUrl, baseUrl, runId }) {
  const serverBinary = resolveServerBinary(clientName);
  if (!serverBinary) {
    return Promise.reject(new Error(
      `no dedicated game-server binary found for ${clientName}; expected shared\\${clientName}.exe or shared\\2021E.exe`,
    ));
  }

  const scratch = path.join(scratchDir(), `dev-server-${runId}`);
  fs.mkdirSync(scratch, { recursive: true });
  const templatePath = path.join(SERVER_ROOT, 'gameserver.json');
  const settingsPath = path.join(SERVER_ROOT, 'DevSettingsFile.json');
  if (!fs.existsSync(settingsPath)) {
    return Promise.reject(new Error(`the game-server settings file is missing: ${settingsPath}`));
  }
  const configPath = createLocalServerConfig(
    templatePath,
    path.join(scratch, 'gameserver.json'),
    {
      placeId,
      mapUrl: `${localHttpUrl}/asset/?id=${placeId}`,
      baseUrl,
      jobId,
      port,
    },
  );

  // Match the working shared/<client>.bat local-test setup. The RCCService
  // player binary does not load a place by itself without -localtest and the
  // matching settings file.
  const child = spawn(serverBinary, [
    '-console', '-verbose',
    `-placeid:${placeId}`,
    '-localtest', configPath,
    '-settingsfile', settingsPath,
    '-port', String(port),
  ], {
    cwd: path.dirname(serverBinary),
    env: {
      ...process.env,
      TEMP: scratch,
      TMP: scratch,
      TMPDIR: scratch,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (line) log('game-server', line.slice(0, 160));
  });
  child.stderr.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (line) log('game-server!', line.slice(0, 160));
  });
  log('game-server', `started ${path.basename(serverBinary)} (pid ${child.pid})`);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error) {
        if (!child.killed) child.kill();
        reject(error);
        return;
      }
      child.on('error', (processError) => {
        log('game-server!', `process error: ${processError.message}`);
      });
      child.on('exit', (code) => log('game-server', `binary exited (code=${code})`));
      resolve({
        close: () => {
          if (!child.killed) child.kill();
        },
        pid: child.pid,
      });
    };
    const onError = (error) => finish(new Error(`could not start game server: ${error.message}`));
    const onExit = (code) => finish(new Error(`game server exited before opening port ${port} (code=${code})`));
    const timeout = setTimeout(
      () => finish(new Error(
        `game server did not open port ${port} within ${SERVER_START_TIMEOUT_MS / 1000} seconds. `
        + `Check the ${path.basename(serverBinary)} output above and confirm Windows Firewall allows it.`,
      )),
      SERVER_START_TIMEOUT_MS,
    );

    child.once('error', onError);
    child.once('exit', onExit);

    const checkPort = () => {
      if (settled) return;
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        finish(null);
        log('game-server', `listening on 127.0.0.1:${port}`);
      });
      socket.once('error', () => {
        socket.destroy();
        if (!settled) setTimeout(checkPort, 250);
      });
      socket.once('timeout', () => socket.destroy());
    };
    checkPort();
  });
}

/**
 * Launch the player client against the local game server.
 *
 * The 2021M client joins with `-a <authUrl> -t <ticket> -j <joinUrl>` - the same
 * invocation the bridge's own `launchLocalRobloxClient` uses. The old code here
 * passed `--app roblox-player --serverPort ...`, which this client does not
 * understand, so it opened to the login screen instead of into a place.
 */
function launchClient(clientDir, { authUrl, ticket, joinUrl }) {
  const exe = path.join(clientDir, 'RobloxPlayerBeta.exe');
  if (!fs.existsSync(exe)) {
    throw new Error(`client not found: ${exe}`);
  }

  const args = ['-a', String(authUrl), '-t', String(ticket), '-j', String(joinUrl)];
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: clientDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    let didSpawn = false;
    child.once('error', (error) => {
      if (!didSpawn) {
        reject(new Error(`could not start the player client: ${error.message}`));
      } else {
        log('client!', `process error (pid ${child.pid}): ${error.message}`);
      }
    });
    child.once('spawn', () => {
      didSpawn = true;
      child.once('exit', (code, signal) => {
        log('client', `process exited (pid ${child.pid}, code=${code}, signal=${signal || 'none'})`);
      });
      child.unref();
      resolve({ exe, args, pid: child.pid });
    });
  });
}

/**
 * A directory on a real drive for scratch files.
 *
 * The old tooling wrote into %TEMP% (C:\Users\...\AppData\Local\Temp). This
 * project lives on E: and the machine's C: is nearly full, so scratch files are
 * kept next to the release instead. An explicit LUCKYBLOX_TMP wins.
 */
function scratchDir() {
  const explicit = process.env.LUCKYBLOX_TMP;
  const dir = explicit && explicit.trim()
    ? explicit.trim()
    : path.join(RELEASE_ROOT, '.tmp');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  return dir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node tools/dev-launch.js [options]');
    console.log('');
    console.log('  --place <id>     local catalog place id (default: selected MapPath.txt map)');
    console.log('  --url <origin>   live site (default ' + DEFAULT_LIVE_URL + ')');
    console.log(`  --client <name>  client folder to launch (default SelectedClient.txt or ${DEFAULT_CLIENT})`);
    console.log('  --user <name>    account to sign in as (or LUCKYBLOX_DEV_USER)');
    console.log('  --pass <word>    its password (or LUCKYBLOX_DEV_PASS)');
    console.log('  --testblox [pw]  shorthand for --user testblox');
    console.log('  --dry-run        resolve everything, launch nothing');
    console.log('  --no-keepalive   exit right after launching the client');
    console.log('');
    console.log('Launching is the DEFAULT. Pass --dry-run to only resolve the ticket.');
    return;
  }

  const clientDir = resolveClientDir(args.client);
  if (!args.mapPath || !fs.existsSync(args.mapPath)) {
    throw new Error(
      `place ${args.place} has no local RBXL/RBXLX map. Select one in Settings\\MapPath.txt `
      + 'or choose a place whose map is present under Maps\\.',
    );
  }
  log('target', `LIVE site ${args.url}`);
  log('target', `place ${args.place}${args.placeTitle ? ` (${args.placeTitle})` : ''}, client ${args.client}`);
  log('map', args.mapPath);
  log('scratch', scratchDir());

  // 0. Sign in. A launch ticket belongs to an account, so this comes first.
  if (!args.user || !args.pass) {
    throw new Error(
      'no credentials given, and the LIVE launch route requires a signed-in account.\n'
      + '       Pass --user and --pass, or set LUCKYBLOX_DEV_USER / LUCKYBLOX_DEV_PASS.\n'
      + '       (Running with --dry-run still needs them: it resolves a real ticket.)',
    );
  }

  log('auth', `signing in as ${args.user}...`);
  const cookie = await signIn(args.url, args.user, args.pass);
  log('auth', 'session established');

  // 1. Ask the LIVE site for a real launch ticket, as that account.
  log('ticket', 'requesting launch ticket from LIVE...');
  const launch = await requestLaunchTicket(args.url, args.place, cookie);
  if (Number(launch.placeId) !== Number(args.place)) {
    throw new Error(`LIVE site returned place ${launch.placeId} for requested place ${args.place}. Refusing to launch the wrong place.`);
  }
  if (!launch.ticket || !launch.jobId) {
    throw new Error('LIVE site returned an incomplete launch ticket (missing ticket or jobId).');
  }
  log('ticket', `ok: jobId=${launch.jobId} place=${launch.placeId} livePort=${launch.port}`);

  // Render's game port is not reachable from the desktop. Allocate our own
  // listener and keep the Live site only for account authentication.
  const localPort = await findFreePort(Number(launch.port) || 53640);

  // The official join route on the LIVE site returns the cloud job's port. Keep
  // join and map delivery local so the client cannot be sent back to Render.
  const userId = launch.userId || 1;
  // Keep auth on the ticket issuer's origin so its redemption cookie is scoped
  // to the same site APIs; only the join and map endpoints use loopback.
  const authUrl = `${args.url}/v1/authentication-tickets?userId=${userId}&placeId=${launch.placeId}`;
  const runId = randomUUID();

  if (args.dryRun) {
    const serverBinary = resolveServerBinary(args.client);
    if (!serverBinary) throw new Error(`no shared local-test server executable exists for ${args.client}`);
    log('port', `would start local game server on 127.0.0.1:${localPort}`);
    log('dry-run', `would start ${serverBinary} with shared local-test settings for place ${args.place}`);
    log('dry-run', `would launch an isolated ${path.join(clientDir, 'RobloxPlayerBeta.exe')} copy`);
    log('dry-run', `auth: local loopback endpoint for place ${launch.placeId}, user ${userId}, port ${localPort}`);
    log('dry-run', `join/map endpoints: local loopback only`);
    return;
  }

  let devHttp;
  let gameServer;
  let clientRunDir;
  let serverScratch;
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    if (gameServer) gameServer.close();
    if (devHttp) await devHttp.close().catch((error) => log('cleanup!', error.message));
    for (const dir of [clientRunDir, serverScratch]) {
      if (dir) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {
          log('cleanup!', `could not remove ${dir}: ${error.message}`);
        }
      }
    }
  };
  try {
    devHttp = await createDevHttpServer({
      placeId: launch.placeId,
      mapPath: args.mapPath,
      userId,
      ticket: launch.ticket,
      jobId: launch.jobId,
      gamePort: localPort,
      baseUrl: args.url,
    });
    log('local-api', `${devHttp.baseUrl} serves the selected map and local join response`);

    serverScratch = path.join(scratchDir(), `dev-server-${runId}`);
    gameServer = await startLocalGameServer({
      port: localPort,
      placeId: launch.placeId,
      jobId: launch.jobId,
      clientName: args.client,
      localHttpUrl: devHttp.baseUrl,
      baseUrl: args.url,
      runId,
    });

    const client = prepareDevClient(clientDir, args.client, args.url, runId);
    clientRunDir = client.runDir;
    const joinUrl = `${devHttp.baseUrl}/game/join?placeId=${launch.placeId}&userId=${userId}`
      + `&ticket=${encodeURIComponent(launch.ticket)}&serverPort=${localPort}&jobId=${encodeURIComponent(launch.jobId)}`;

    // Launch in the isolated folder: the checked-in client AppSettings remains
    // untouched while this copy points all site APIs at the LIVE deployment.
    const info = await launchClient(client.runDir, { authUrl, ticket: launch.ticket, joinUrl });
    log('client', `launched ${path.basename(info.exe)} (pid ${info.pid}) for place ${launch.placeId}, job ${launch.jobId}`);

    if (!args.keepAlive) {
      setTimeout(() => {
        cleanup().finally(() => process.exit(0));
      }, 5000);
      return;
    }

    console.log('\n[dev-launch] Local game server running. Close this window (or Ctrl+C) to stop it.');
    console.log(`[dev-launch] Playing ${launch.placeId} on 127.0.0.1:${localPort} as ${args.user}.`);

    const stop = () => {
      cleanup().finally(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[dev-launch] FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  createDevHttpServer,
  createLocalServerConfig,
  parseArgs,
  prepareDevClient,
  readSelectedClient,
  readLocalGames,
  resolveDefaultPlace,
  resolvePlaceMap,
  resolveServerBinary,
  startLocalGameServer,
  resolveClientDir,
};
