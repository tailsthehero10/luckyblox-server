const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3456;

function request({ method = 'GET', pathName = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function waitForReady(serverProcess) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error('server exited before becoming ready');
    }

    try {
      await request({ pathName: '/health' });
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error('server did not become ready');
}

(async () => {
  // Run against an isolated data dir so the test never touches (or depends on)
  // the developer's tracked data/users.json. Preview mode is left at its default
  // (on) on purpose: this exercises the LIVE configuration, where the login and
  // launch routes must stay reachable even while the site itself is gated.
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-session-test-'));

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir },
    stdio: 'inherit',
  });

  try {
    await waitForReady(server);

    // Preview mode must NOT swallow the login route (regression: it used to 503
    // with "preview-mode", which locked everyone - including the owner - out).
    const loginRes = await request({
      method: 'POST',
      pathName: '/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'no-such-account', password: 'whatever' }),
    });

    assert.notEqual(loginRes.statusCode, 503, 'login must not be blocked by preview mode');
    assert.equal(loginRes.statusCode, 401, 'an unknown account must be rejected with 401');

    const loginBody = JSON.parse(loginRes.body);
    assert.equal(loginBody.ok, false, 'a rejected login must not report success');
    assert.ok(!loginBody.token, 'a rejected login must not issue a token');

    // An account with no stored credential must never authenticate with any
    // password, empty or not (regression: the route used to skip the check).
    const emptyPasswordRes = await request({
      method: 'POST',
      pathName: '/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tailsthehero10', password: '' }),
    });
    assert.equal(emptyPasswordRes.statusCode, 401, 'an empty password must never authenticate');

    // The launch route drives the client and must stay available in preview mode.
    const launchRes = await request({
      method: 'POST',
      pathName: '/api/launch-game',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 1, placeId: 1818 }),
    });

    assert.equal(launchRes.statusCode, 200, 'launch route must stay available in preview mode');
    const launchBody = JSON.parse(launchRes.body);
    assert.equal(launchBody.ok, true, 'launch route should report ok');
    assert.ok(launchBody.ticket, 'launch route should issue a real ticket');

    console.log('session-auth-flow test passed');
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
})();
