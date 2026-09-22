const assert = require('assert');
const http = require('http');
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
  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  try {
    await waitForReady(server);

    const loginRes = await request({
      method: 'POST',
      pathName: '/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'LocalPlayer', password: 'local' }),
    });

    assert.equal(loginRes.statusCode, 200, 'login endpoint should succeed for the default LocalPlayer account');
    assert.ok(
      Array.isArray(loginRes.headers['set-cookie']) && loginRes.headers['set-cookie'].some((cookie) => cookie.startsWith('luckblox_session=')),
      'login response should set a session cookie for the authenticated user'
    );

    const cookieHeader = loginRes.headers['set-cookie'][0];
    const sessionCookie = cookieHeader.split(';')[0];

    const launchRes = await request({
      method: 'POST',
      pathName: '/api/launch-game',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ placeId: 1818 }),
    });

    assert.equal(launchRes.statusCode, 200, 'launch route should succeed for an authenticated LocalPlayer session');
    const launchBody = JSON.parse(launchRes.body);
    assert.equal(String(launchBody.userId), '1', 'launch route should start with the actual default LocalPlayer account');
    assert.ok(launchBody.ticket, 'launch route should issue a real ticket for the launch session');

    console.log('session-auth-flow test passed');
  } finally {
    server.kill('SIGTERM');
  }
})();
