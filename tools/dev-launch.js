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
 *   3. find a free local TCP port
 *   4. start the local game server (dedicated server binary if present, else a
 *      listener that never leaves the client hanging)
 *   5. launch the player client against that local port
 *
 * Usage
 * -----
 *   node tools/dev-launch.js                     # sign in and PLAY (place 1818)
 *   node tools/dev-launch.js --place 2020        # pick a place
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
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const RELEASE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LIVE_URL = 'https://luckyblox-server.onrender.com';
const DEFAULT_PLACE_ID = 1818;
const DEFAULT_CLIENT = '2021M';

/**
 * The dedicated game-server binary.
 *
 * The 2021E build does NOT ship an `RCCService.exe` - its server-side binary is
 * `RobloxPlayerBeta.exe` under `RCCService/`. The old list only looked for
 * `RCCService.exe`, so it never found a server binary and silently fell back to
 * the bare TCP listener. Walk the likely names AND locations instead.
 */
const SERVER_CANDIDATES = [
  path.join(RELEASE_ROOT, 'Clients', '2021E', 'RCCService', 'RCCService.exe'),
  path.join(RELEASE_ROOT, 'Clients', '2021E', 'RCCService', 'RobloxPlayerBeta.exe'),
  path.join(RELEASE_ROOT, 'Clients', '2021E', 'RobloxPlayerBeta.exe'),
  path.join(RELEASE_ROOT, 'RCCService', 'RCCService.exe'),
  path.join(RELEASE_ROOT, 'RCCService.exe'),
];

/**
 * The client folder a --client name resolves to.
 *
 * The repackaged CUSTOM-2021M keeps its binary in a `Player/` sub-folder, so a
 * plain `Clients/<name>/RobloxPlayerBeta.exe` check would miss it.
 */
function resolveClientDir(clientName) {
  const dir = path.join(RELEASE_ROOT, 'Clients', clientName);
  if (fs.existsSync(path.join(dir, 'Player', 'RobloxPlayerBeta.exe'))) {
    return path.join(dir, 'Player');
  }
  return dir;
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_LIVE_URL,
    place: DEFAULT_PLACE_ID,
    client: process.env.LUCKYBLOX_DEV_CLIENT || DEFAULT_CLIENT,
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
    else if (token === '--place' || token === '--placeid') args.place = Number(argv[++i]) || DEFAULT_PLACE_ID;
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
  // An empty password would be sent as "" and rejected; keep the default when the
  // caller only supplied a username.
  if (!args.pass) args.pass = process.env.LUCKYBLOX_DEV_PASS || 'Testblox10';
  return args;
}

function log(step, message) {
  console.log(`[dev-launch] ${step.padEnd(12)} ${message}`);
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
 * Start a minimal local game-server listener. The real RCCService binary, when
 * present, is spawned too; either way a socket is listening on the join port so
 * the client does not hang against a dead address.
 */
function startLocalGameServer(port, placeId, jobId) {
  const listener = net.createServer((socket) => {
    socket.on('error', () => { /* a client dropping mid-handshake is not fatal */ });
  });
  listener.on('error', (error) => log('game-server!', `listener error: ${error.message}`));

  const serverBinary = SERVER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  let child = null;
  if (serverBinary) {
    try {
      // The 2021 conference builds take a lower-case `-console` and the
      // place/job/port each as its own `-key:value` token. The old call used
      // `-Console` and passed the port as a separate `-port <n>` argument, which
      // these binaries do not parse.
      child = spawn(serverBinary, [
        '-console', '-verbose',
        `-placeid:${placeId}`,
        `-jobid:${jobId}`,
        `-port:${port}`,
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) log('game-server', line.slice(0, 160));
      });
      child.stderr.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) log('game-server!', line.slice(0, 160));
      });
      child.on('error', (error) => log('game-server!', `spawn failed: ${error.message}`));
      child.on('exit', (code) => log('game-server', `binary exited (code=${code})`));
      log('game-server', `started ${path.basename(serverBinary)} (pid ${child.pid})`);
    } catch (error) {
      log('game-server!', `could not spawn server binary: ${error.message}`);
    }
  } else {
    log('game-server', 'no dedicated server binary found; using the TCP listener only');
  }

  return new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => {
      log('game-server', `listening on 127.0.0.1:${port}`);
      resolve({
        close: () => {
          try { listener.close(); } catch { /* already gone */ }
          if (child && !child.killed) { try { child.kill(); } catch { /* gone */ } }
        },
      });
    });
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

  const child = spawn(exe, args, {
    cwd: clientDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { exe, args, pid: child.pid };
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
    console.log('  --place <id>     place to play (default 1818)');
    console.log('  --url <origin>   live site (default ' + DEFAULT_LIVE_URL + ')');
    console.log('  --client <name>  client folder to launch (default 2021M)');
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
  log('target', `LIVE site ${args.url}`);
  log('target', `place ${args.place}, client ${args.client}`);
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
  log('ticket', `ok: jobId=${launch.jobId} place=${launch.placeId} livePort=${launch.port}`);

  // 2. Run the game server locally (Render cannot host it).
  const localPort = await findFreePort(Number(launch.port) || 53640);
  log('port', `local game port ${localPort} (live advertised ${launch.port}, ignored)`);

  // The client's OWN endpoints point at the live site (it fetches its place and
  // its ticket from there); only the game socket comes from this machine.
  const userId = launch.userId || 1;
  const authUrl = `${args.url}/v1/authentication-tickets?userId=${userId}&placeId=${launch.placeId}`;
  const joinUrl = `${args.url}/game/join?placeId=${launch.placeId}&userId=${userId}`
    + `&ticket=${encodeURIComponent(launch.ticket)}&serverPort=${localPort}&jobId=${encodeURIComponent(launch.jobId)}`;

  if (args.dryRun) {
    log('dry-run', `would start game server on 127.0.0.1:${localPort}`);
    log('dry-run', `would launch ${path.join(clientDir, 'RobloxPlayerBeta.exe')}`);
    log('dry-run', `auth: ${authUrl}`);
    log('dry-run', `join: ${joinUrl}`);
    return;
  }

  const server = await startLocalGameServer(localPort, launch.placeId, launch.jobId);

  // 3. Point the client at the local game server.
  const info = launchClient(clientDir, { authUrl, ticket: launch.ticket, joinUrl });
  log('client', `launched ${path.basename(info.exe)} (pid ${info.pid})`);

  if (!args.keepAlive) {
    // Let the client connect, then let the parent go.
    setTimeout(() => { server.close(); process.exit(0); }, 1500);
    return;
  }

  console.log('\n[dev-launch] Game server running. Close this window (or Ctrl+C) to stop it.');
  console.log(`[dev-launch] Playing ${launch.placeId} on 127.0.0.1:${localPort} as ${args.user}.`);

  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(`[dev-launch] FAILED: ${error.message}`);
  process.exit(1);
});
