'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { makeTestDir } = require('./test-paths');

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

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

(async () => {
  const port = await availablePort();
  const dataDir = makeTestDir('luckblox-avatar-rig');
  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: path.resolve(__dirname, '..'),
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
        ready = (await get(port, '/health')).status === 200;
      } catch (error) {
        if (attempt === 79) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    assert.equal(ready, true, `bridge should start:\n${errors.join('')}`);

    for (const [rig, expectedParts] of [['R6', 6], ['R15', 15]]) {
      const response = await get(port, `/api/avatar/rig/${rig}`);
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.rig, rig);
      assert.equal(payload.parts.length, expectedParts);
      if (rig === 'R15') {
        const meshPart = payload.parts.find((part) => part.name === 'LeftHand');
        assert.equal(meshPart.meshId, 'http://www.roblox.com/asset/?id=532219986');
        assert.equal(meshPart.mesh, null);
        assert.equal(meshPart.meshGeometryIncluded, false);
      }
    }

    assert.equal((await get(port, '/api/avatar/rig/R7')).status, 404);
    for (const page of ['/users/1/profile', '/avatar?userId=1']) {
      const response = await get(port, page);
      assert.equal(response.status, 200);
      assert.doesNotMatch(response.body, /3D Avatar Preview/);
    }
    console.log('ok: avatar API exposes the supplied RBXM data without inventing mesh geometry');
  } finally {
    child.kill();
    await once(child, 'exit').catch(() => {});
    require('node:fs').rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
