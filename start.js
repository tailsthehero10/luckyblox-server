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
const restartCounts = new Map();

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

    // Drop the dead child from the tracked list so we never try to signal it.
    const idx = children.findIndex((entry) => entry.child === child);
    if (idx >= 0) {
      children.splice(idx, 1);
    }

    // Exponential-ish backoff and a hard cap, so a crash loop cannot
    // hammer the box.
    const attempts = (restartCounts.get(name) || 0) + 1;
    restartCounts.set(name, attempts);

    if (attempts > 10) {
      console.error(`[luckyblox] ${name} crashed ${attempts} times; giving up. Fix the error and redeploy.`);
      return;
    }

    const delayMs = Math.min(1000 * attempts, 10000);
    console.error(`[luckyblox] ${name} exited (code=${code} signal=${signal}); restart #${attempts} in ${delayMs}ms`);
    setTimeout(() => {
      if (!shuttingDown) {
        startProcess(name, scriptPath, env);
      }
    }, delayMs);
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

// Boot the bridge first, then the proxy that fronts it. Each child is told its
// ROLE so runtimeConfig allocates ports deterministically and they can never
// resolve to the same port.
startProcess('bridge', path.join(rootDir, 'Webserver', 'http-db-bridge', 'server.js'), {
  ...sharedEnv,
  LUCKYBLOX_ROLE: 'bridge',
  PORT: String(bridgePort),
  LUCKYBLOX_BRIDGE_PORT: String(bridgePort),
});

// Give the bridge a moment to take its port before the proxy starts, so a slow
// container never races the two on startup.
setTimeout(() => {
  startProcess('proxy', path.join(rootDir, 'server.js'), {
    ...sharedEnv,
    LUCKYBLOX_ROLE: 'proxy',
    PORT: String(publicPort),
    LUCKYBLOX_LEGACY_PORT: String(publicPort),
    LUCKYBLOX_BRIDGE_PORT: String(bridgePort),
  });
}, 600);
