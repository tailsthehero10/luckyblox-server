'use strict';

/**
 * Starts the LuckyBlox bridge on a free port and KEEPS IT RUNNING, so a browser
 * can be pointed at it.
 *
 * This exists because the shell tooling here kills a foreground server after a
 * timeout, which left orphaned processes holding ports (and made an earlier sweep
 * report VS Code's error page as site bugs). One wrapper, one clear place to stop.
 *
 * Usage: node tools/serve.js [port]
 * Stop:  Ctrl+C, or `node tools/serve.js --stop`
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pidFile = path.join(os.tmpdir(), 'luckyblox-serve.pid');

if (process.argv[2] === '--stop') {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    process.kill(pid, 'SIGTERM');
    fs.rmSync(pidFile, { force: true });
    console.log(`stopped LuckyBlox bridge (pid ${pid})`);
  } catch (error) {
    console.log('nothing to stop');
  }
  process.exit(0);
}

const port = Number(process.argv[2]) || 39001;
const dataDir = process.env.LUCKYBLOX_DATA_DIR
  || path.join(ROOT, 'Webserver', 'http-db-bridge', 'data');

const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(port),
    LUCKYBLOX_DATA_DIR: dataDir,
    LUCKYBLOX_PREVIEW_MODE: 'off',
  },
  stdio: 'inherit',
});

fs.writeFileSync(pidFile, String(child.pid));
console.log(`LuckyBlox bridge on http://localhost:${port} (pid ${child.pid})`);
console.log('stop with: node tools/serve.js --stop');

const stop = () => {
  try { child.kill('SIGTERM'); } catch (error) { /* already gone */ }
  try { fs.rmSync(pidFile, { force: true }); } catch (error) { /* best effort */ }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  try { fs.rmSync(pidFile, { force: true }); } catch (error) { /* best effort */ }
  process.exit(code == null ? 0 : code);
});