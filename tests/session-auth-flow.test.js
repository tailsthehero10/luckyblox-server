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
  // the developer's tracked data/users.json. Preview mode defaults to off, but
  // the login and launch routes are allowlisted either way and must stay
  // reachable no matter how the site itself is gated - that is what this checks.
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

    // The launch route drives the client and must stay REACHABLE in preview mode.
    //
    // "Reachable" is the point: the gate used to answer 503 preview-mode here,
    // which locked everyone out of the client. It must never do that again. But a
    // 200 is not the correct answer either for a request with no session - playing
    // requires an account, and the route used to silently fall back to user 1 (the
    // owner), which let anyone join as the owner without authenticating. So the
    // assertion is: not blocked by the preview gate (not 503), and correctly
    // refused for want of a session (401).
    const launchRes = await request({
      method: 'POST',
      pathName: '/api/launch-game',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 1, placeId: 1818 }),
    });

    assert.notEqual(launchRes.statusCode, 503, 'the launch route must not be swallowed by preview mode');
    assert.equal(
      launchRes.statusCode,
      401,
      'an unauthenticated launch must be refused rather than falling back to user 1',
    );
    const launchBody = JSON.parse(launchRes.body);
    assert.equal(launchBody.ok, false, 'a refused launch must not report success');
    assert.ok(!launchBody.ticket, 'a refused launch must not issue a ticket');
    assert.ok(launchBody.signInUrl, 'a refused launch should point at sign-in');

    console.log('session-auth-flow test passed');
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
})();
