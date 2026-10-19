'use strict';

/**
 * The JSON login response shape.
 *
 * `POST /api/login` is what the Next frontend and every API consumer call. Its
 * `session.sessionId` must be a STRING.
 *
 * The bug this guards: `applySessionCookie()` returns `{ sessionId, csrfToken }`,
 * and the route named that whole object `sessionId` and spread it into the
 * response. Clients reading `session.sessionId` received
 * `{ sessionId, csrfToken }` instead of an id - and the CSRF token, which is
 * meant to stay server-side, was echoed into the login body.
 *
 * Run: node tests/login-response-shape.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { makeTestDir } = require('./test-paths');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function post(port, pathname, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

(async () => {
  const port = await availablePort();
  const dataDir = makeTestDir('luckblox-login-shape');
  const credentials = security.hashPassword('ShapeTest1!');

  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({
    1: {
      userId: 1,
      username: 'ShapeProbe',
      displayName: 'Shape Probe',
      password: credentials.hash,
      passwordSalt: credentials.salt,
      passwordVersion: credentials.version,
      friends: [],
    },
  }));

  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(port), LUCKYBLOX_DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`bridge exited early:\n${errors.join('')}`);
      try {
        const res = await post(port, '/api/login', { username: 'ShapeProbe', password: 'ShapeTest1!' });
        ready = res.status === 200;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    assert.strictEqual(ready, true, `bridge should serve a login:\n${errors.join('')}`);

    console.log('login response shape');

    const ok = await post(port, '/api/login', { username: 'ShapeProbe', password: 'ShapeTest1!' });
    const payload = JSON.parse(ok.body);

    check('a valid login returns 200 and ok:true', () => {
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(payload.ok, true);
    });

    check('session.sessionId is a STRING, not an object', () => {
      assert.ok(payload.session, 'session must be present');
      assert.strictEqual(typeof payload.session.sessionId, 'string',
        `expected a string id, got ${typeof payload.session.sessionId}`);
      assert.ok(payload.session.sessionId.length > 0, 'the id must not be empty');
    });

    check('session.userId is the signed-in account', () => {
      assert.strictEqual(String(payload.session.userId), '1');
    });

    check('the CSRF token is NOT echoed into the login response', () => {
      assert.ok(!ok.body.includes('csrfToken'),
        'the CSRF token must stay server-side, not appear in the response body');
    });

    const bad = await post(port, '/api/login', { username: 'ShapeProbe', password: 'wrong' });
    check('a wrong password returns 401 invalid-credentials', () => {
      assert.strictEqual(bad.status, 401);
      assert.strictEqual(JSON.parse(bad.body).error, 'invalid-credentials');
    });
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nThe login response exposes a string session id and no CSRF token.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
