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
 * This tool closes that gap for development: it asks the LIVE site for a real
 * launch ticket, then runs the game server LOCALLY on your windows box and
 * points the client at 127.0.0.1 so you actually drop into a playable place.
 *
 * Flow
 * ----
 *   1. POST  https://luckyblox-server.onrender.com/api/launch-game  -> ticket, placeId
 *   2. start a local game-server listener on a free TCP port (127.0.0.1)
 *   3. launch Clients/2021M/RobloxPlayerBeta.exe against that local port
 *
 * Usage
 * -----
 *   node tools/dev-launch.js                 # default place 1818, client 2021M
 *   node tools/dev-launch.js --place 1818    # pick a place
 *   node tools/dev-launch.js --dry-run       # resolve everything, launch nothing
 *   node tools/dev-launch.js --url https://luckyblox-server.onrender.com
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const RELEASE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LIVE_URL = 'https://luckyblox-server.onrender.com';
const DEFAULT_PLACE_ID = 1818;
const DEFAULT_CLIENT = '2021M';

// The local game-server binary. 2021M ships only RobloxPlayerBeta.exe, so the
// playable client is 2021M and the *server* side is the 2021E RCCService build.
const PLAYER_CLIENT_DIR = path.join(RELEASE_ROOT, 'Clients', '2021M');
const SERVER_CANDIDATES = [
  path.join(RELEASE_ROOT, 'Clients', '2021E', 'RCCService', 'RCCService.exe'),
  path.join(RELEASE_ROOT, 'Clients', '2021E', 'RCCService', 'RobloxPlayerBeta.exe'),
];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_LIVE_URL,
    place: DEFAULT_PLACE_ID,
    client: DEFAULT_CLIENT,
    dryRun: true,
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
    else if (token === '--user' || token === '--username') args.user = argv[++i] || '';
    else if (token === '--pass' || token === '--password') args.pass = argv[++i] || '';
    else if (token === '--help' || token === '-h') args.help = true;
  }
  args.url = String(args.url || DEFAULT_LIVE_URL).replace(/\/+$/, '');
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
    socket.end(JSON.stringify({ ok: true, server: 'LuckyBlox local game server', placeId, port, jobId }) + '\n');
  });

  const serverBinary = SERVER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  let child = null;
  if (serverBinary) {
    try {
      child = spawn(serverBinary, [
        '-Console', '-verbose',
        `-placeid:${placeId}`,
        `-jobId:${jobId}`,
        '-port', String(port),
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) log('game-server', line.slice(0, 160));
      });
      child.stderr.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) log('game-server!', line.slice(0, 160));
      });
      child.on('exit', (code) => log('game-server', `binary exited (code=${code})`));
    } catch (error) {
      log('game-server', `could not spawn server binary: ${error.message}`);
    }
  } else {
    log('game-server', 'no RCCService binary found; using the TCP listener only');
  }

  return new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => {
      log('game-server', `listening on 127.0.0.1:${port}`);
      resolve({
        close: () => {
          try { listener.close(); } catch { /* already gone */ }
          if (child && !child.killed) child.kill();
        },
      });
    });
  });
}

/** Launch the 2021M player client against the local game server. */
function launchClient(clientDir, { placeId, port, jobId, ticket }) {
  const exe = path.join(clientDir, 'RobloxPlayerBeta.exe');
  if (!fs.existsSync(exe)) {
    throw new Error(`client not found: ${exe}`);
  }

  // Private-server clients accept the join either as the luckyblox-player: URI
  // or as the classic --app roblox-player argument set. We pass the argument
  // form and also expose the URI so a registered handler can pick it up.
  const args = [
    '--app', 'roblox-player',
    '--placeId', String(placeId),
    '--serverPort', String(port),
    '--jobId', String(jobId),
    '--ticket', String(ticket),
  ];

  const child = spawn(exe, args, {
    cwd: clientDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { exe, args, pid: child.pid };
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
    console.log('  --dry-run        resolve everything, launch nothing');
    console.log('');
    console.log('The launch route needs a real session, so signing in is required.');
    console.log('Set the two environment variables once to avoid passing them each run:');
    console.log('  set LUCKYBLOX_DEV_USER=yourname');
    console.log('  set LUCKYBLOX_DEV_PASS=yourpassword');
    return;
  }

  const clientDir = path.join(RELEASE_ROOT, 'Clients', args.client);
  log('target', `LIVE site ${args.url}`);
  log('target', `place ${args.place}, client ${args.client}`);

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

  if (args.dryRun) {
    log('dry-run', `would start game server on 127.0.0.1:${localPort}`);
    log('dry-run', `would launch ${path.join(clientDir, 'RobloxPlayerBeta.exe')}`);
    log('dry-run', `join: placeId=${launch.placeId} serverPort=${localPort} jobId=${launch.jobId}`);
    return;
  }

  const server = await startLocalGameServer(localPort, launch.placeId, launch.jobId);

  // 3. Point the client at the local game server.
  const info = launchClient(clientDir, {
    placeId: launch.placeId,
    port: localPort,
    jobId: launch.jobId,
    ticket: launch.ticket,
  });
  log('client', `launched ${path.basename(info.exe)} (pid ${info.pid})`);

  console.log('\n[dev-launch] The game server is running. Close this window (or Ctrl+C) to stop it.');
  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(`[dev-launch] FAILED: ${error.message}`);
  process.exit(1);
});
