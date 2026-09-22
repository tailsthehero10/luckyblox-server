'use strict';

/**
 * LuckyBlox process manager.
 *
 * Cloud platforms (Render) route traffic to ONE port and expect ONE foreground
 * process. This file boots both Node services, wires the internal ports through
 * the environment, supervises them, and forwards shutdown signals.
 *
 *   bridge (Express app)  -> internal port, serves the site + the Webserver/ PHP routes
 *   legacy (proxy)        -> listens on the public PORT, forwards to the bridge
 *
 * On a desktop run you can still start the two processes the old way; running
 * this file behaves the same but is what the container uses.
 */

const { spawn } = require('child_process');
const path = require('path');

const rootDir = __dirname;
const runtime = require(path.join(rootDir, 'server', 'runtimeConfig'));

// The public port is whatever the platform gave us. The bridge gets its own
// internal port so the proxy has something to forward to.
const publicPort = runtime.publicPort;
const bridgePort = runtime.bridgePort;
const bindHost = runtime.bindHost;

const sharedEnv = {
  ...process.env,
  HOST: bindHost,
  LUCKYBLOX_BRIDGE_HOST: runtime.bridgeHost,
  LUCKYBLOX_BRIDGE_PORT: String(bridgePort),
  LUCKYBLOX_GAME_HOST: runtime.gameServerHost,
  PUBLIC_HOST: runtime.publicHostname,
  PUBLIC_PROTOCOL: runtime.publicProtocol,
  PUBLIC_URL: runtime.publicBaseUrl,
};

const children = [];
let shuttingDown = false;

function startProcess(name, scriptPath, env) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[luckyblox] ${name} exited (code=${code} signal=${signal}); restarting in 2s`);
    setTimeout(() => {
      if (!shuttingDown) {
        startProcess(name, scriptPath, env);
      }
    }, 2000);
  });

  child.on('error', (error) => {
    console.error(`[luckyblox] ${name} failed to start: ${error.message}`);
  });

  children.push({ name, child });
  return child;
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[luckyblox] received ${signal}, shutting down...`);

  for (const { child } of children) {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[luckyblox] public port ${publicPort} on ${bindHost}; bridge on ${runtime.bridgeHost}:${bridgePort}`);

// Boot the bridge first, then the proxy that fronts it.
startProcess('bridge', path.join(rootDir, 'Webserver', 'http-db-bridge', 'server.js'), {
  ...sharedEnv,
  PORT: String(bridgePort),
});

startProcess('legacy', path.join(rootDir, 'server.js'), {
  ...sharedEnv,
  PORT: String(publicPort),
  LUCKYBLOX_LEGACY_PORT: String(publicPort),
});
