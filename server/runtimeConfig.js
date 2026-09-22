'use strict';

/**
 * LuckyBlox runtime configuration.
 *
 * Every network setting that used to be a hardcoded local/Windows value
 * (127.0.0.1, localhost, :3001, :3002, :53640, ...) is resolved here from
 * environment variables so the exact same code runs unchanged on a
 * Windows desktop and inside a Linux cloud container (Render/Docker).
 *
 * Environment variables used:
 *   PORT                 - the single public port the platform gives us (Render sets this)
 *   HOST / BIND_HOST     - interface to bind on; defaults to 0.0.0.0 so the
 *                          container is reachable from outside
 *   LUCKYBLOX_BRIDGE_PORT- internal port of the Express "http-db-bridge" app
 *   LUCKYBLOX_BRIDGE_HOST- internal host of the bridge (container-internal)
 *   LUCKYBLOX_LEGACY_PORT- internal port of the outer compatibility/proxy server
 *   PUBLIC_HOST / RENDER_EXTERNAL_HOSTNAME - the public hostname clients use
 *   PUBLIC_URL / RENDER_EXTERNAL_URL       - the full public base URL
 *   LUCKYBLOX_GAME_PORT  - base port for spawned game servers
 *   PHP_BIN / LUCKYBLOX_PHP - php executable used for raw PHP endpoints
 */

const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function toPort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readHostFile(fileName, fallback) {
  try {
    const fs = require('fs');
    const filePath = path.join(rootDir, 'Settings', fileName);
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const value = String(fs.readFileSync(filePath, 'utf8')).trim();
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

// The public port injected by the cloud platform. Locally we keep the classic
// desktop ports so nothing about the Windows workflow breaks.
//
// IMPORTANT: the proxy and the bridge must never resolve to the same port, or
// the second one to bind dies with EADDRINUSE. We resolve them here, in one
// place, and guarantee they differ.
const rawPort = toPort(process.env.PORT, 0);
const role = String(process.env.LUCKYBLOX_ROLE || '').toLowerCase();

let publicPort;
let bridgePort;
let legacyPort;

if (role === 'bridge') {
  // This process IS the internal bridge: take the internal port, with the
  // platform PORT only as a last-resort fallback.
  bridgePort = toPort(
    process.env.LUCKYBLOX_BRIDGE_PORT || process.env.BRIDGE_PORT,
    rawPort || 3001,
  );
  publicPort = rawPort || bridgePort;
  legacyPort = toPort(process.env.LUCKYBLOX_LEGACY_PORT, 0) || bridgePort;
} else if (role === 'proxy' || role === 'legacy') {
  // This process IS the public proxy: own the platform PORT.
  publicPort = rawPort || 3002;
  legacyPort = toPort(process.env.LUCKYBLOX_LEGACY_PORT, publicPort) || publicPort;
  bridgePort = toPort(
    process.env.LUCKYBLOX_BRIDGE_PORT || process.env.BRIDGE_PORT,
    3001,
  );
} else {
  // Standalone / single-process mode: one process serves the public port and
  // proxies to an internal bridge on a *different* port.
  publicPort = rawPort || 3002;
  legacyPort = toPort(process.env.LUCKYBLOX_LEGACY_PORT, publicPort) || publicPort;
  bridgePort = toPort(
    process.env.LUCKYBLOX_BRIDGE_PORT || process.env.BRIDGE_PORT,
    publicPort === 3001 ? 3002 : 3001,
  );
}

// Final safety net: if anything above collapsed the two onto one port, move the
// internal bridge off the public port.
if (bridgePort === publicPort && role !== 'bridge') {
  bridgePort = publicPort === 3001 ? 3002 : 3001;
}
if (legacyPort === 0) {
  legacyPort = publicPort;
}

const bindHost = process.env.HOST || process.env.BIND_HOST || '0.0.0.0';

// Public hostname used when we have to hand URLs back to a client.
const publicHostname =
  process.env.PUBLIC_HOST ||
  process.env.RENDER_EXTERNAL_HOSTNAME ||
  process.env.LUCKYBLOX_PUBLIC_HOST ||
  readHostFile('publichost.txt', '') ||
  `localhost:${publicPort}`;

const publicProtocol =
  process.env.PUBLIC_PROTOCOL ||
  (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL ? 'https' : 'http');

const publicBaseUrl = stripTrailingSlash(
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `${publicProtocol}://${publicHostname}`,
);

const gamePort = toPort(
  process.env.LUCKYBLOX_GAME_PORT || process.env.GAME_PORT,
  toPort(readHostFile('HostPort.txt', ''), 53640),
);

module.exports = {
  rootDir,
  bindHost,
  publicPort,
  bridgePort,
  legacyPort,
  role,
  bridgeHost: process.env.LUCKYBLOX_BRIDGE_HOST || '127.0.0.1',
  legacyHost: process.env.LUCKYBLOX_LEGACY_HOST || '127.0.0.1',
  publicHostname,
  publicProtocol,
  publicBaseUrl,
  gamePort,
  gameServerHost: process.env.LUCKYBLOX_GAME_HOST || bindHost,
  phpBin: process.env.PHP_BIN || process.env.LUCKYBLOX_PHP || 'php',
  isCloud: Boolean(process.env.PORT || process.env.RENDER || process.env.RENDER_EXTERNAL_HOSTNAME),
  toPort,
  stripTrailingSlash,
  readHostFile,
};
