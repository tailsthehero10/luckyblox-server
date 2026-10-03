'use strict';

/**
 * Loads every page and reports the server-side ERROR for the ones that fail.
 *
 * tools/sweep-site.js already reports WHICH pages break; this one captures WHY by
 * starting the bridge as a child process and reading its stderr, so a 500 comes
 * back with its actual stack trace instead of just "HTTP 500".
 *
 * Run: node tools/diagnose-pages.js
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { makeTestDir } = require('../tests/test-paths');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3211;

const PAGES = [
  '/', '/games', '/catalog', '/create', '/develop',
  '/avatar?userId=1', '/profile?userId=1',
  '/friends?userId=1', '/badges?userId=1', '/inventory?userId=1',
  '/settings', '/search/groups', '/upgrades/robux', '/sitestat',
  '/game/1818', '/play?placeId=1818', '/signin', '/signup',
  '/studio', '/download',
];

function get(pathName) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: pathName, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited early');
    const r = await get('/health');
    if (r.status) return;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  throw new Error('server never became ready');
}

(async () => {
  // Pass a data dir as argv[2] to reproduce a failure that only happens against
  // real data (an empty temp dir can hide it). Omit it for an isolated run.
  const tempDataDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : makeTestDir('luckblox-diag');
  const usingLive = Boolean(process.argv[2]);
  if (usingLive) console.log(`(using the data dir at ${tempDataDir})`);

  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrLog = [];
  child.stderr.on('data', (chunk) => stderrLog.push(String(chunk)));
  child.stdout.on('data', () => { /* keep the pipe drained */ });

  try {
    await waitForReady(child);
    console.log('page diagnosis\n');

    const broken = [];
    for (const page of PAGES) {
      const res = await get(page);
      const ok = res.status >= 200 && res.status < 400;
      if (!ok) broken.push({ page, status: res.status });
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(res.status).padEnd(4)} ${page}`);
    }

    if (broken.length) {
      console.log('\n--- server stderr (the actual errors) ---');
      const text = stderrLog.join('');
      // Show only the error blocks, not the boot banner.
      const lines = text.split(/\r?\n/).filter((l) => !/^\[luckyblox\]/.test(l));
      console.log(lines.join('\n').trim().slice(0, 6000) || '(no stderr output)');
    }

    console.log(`\n${PAGES.length - broken.length}/${PAGES.length} pages ok`);
    process.exitCode = broken.length ? 1 : 0;
  } finally {
    child.kill('SIGTERM');
    // Only clean up a temp dir we created - never the operator's real data.
    if (!usingLive) {
      try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});