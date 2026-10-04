'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeTestDir } = require('./test-paths');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3998;
const USER_ID = '1';
let sessionCookie = '';

function request(pathName, method, body) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method,
      headers: {
        host: `127.0.0.1:${PORT}`,
        ...(sessionCookie ? { cookie: sessionCookie } : {}),
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': payload.length,
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForReady(proc) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (proc.exitCode !== null) throw new Error('bridge exited before becoming ready');
    try {
      if ((await request('/health', 'GET')).status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('bridge did not become ready');
}

(async () => {
  const dataDir = makeTestDir('luckyblox-settings-avatar-data');
  const settingsDir = makeTestDir('luckyblox-settings-avatar-client-settings');
  const credentials = security.hashPassword('PersistenceTestPassword1!');
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({
    [USER_ID]: {
      userId: USER_ID,
      username: 'tailsthehero10',
      displayName: 'LuckyBlox Owner',
      role: 'owner',
      password: credentials.hash,
      passwordSalt: credentials.salt,
      passwordVersion: credentials.version,
      avatar: {},
      currentlyWearing: [],
      inventory: [],
    },
  }));

  const bridge = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: dataDir,
      LUCKYBLOX_SETTINGS_DIR: settingsDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitForReady(bridge);
    const loginResponse = await request('/api/login', 'POST', {
      username: 'tailsthehero10',
      password: 'PersistenceTestPassword1!',
    });
    assert.equal(loginResponse.status, 200);
    sessionCookie = (loginResponse.headers['set-cookie'] || [])
      .find((cookie) => /^[^=]*session=/i.test(cookie))
      ?.split(';', 1)[0] || '';
    assert.ok(sessionCookie, 'login should establish an authenticated session cookie');

    const settingsResponse = await request('/api/settings', 'POST', {
      displayName: 'Saved Display Name',
      bio: 'Persisted profile text',
      email: 'saved@example.test',
      theme: 'dark',
    });
    assert.equal(settingsResponse.status, 200, settingsResponse.body);
    assert.equal(JSON.parse(settingsResponse.body).ok, true);

    const avatarResponse = await request('/api/avatar/save', 'POST', {
      assetIds: ['12345', '67890'],
      playerAvatarType: 'R6',
      gender: 'NotSpecified',
      bodyColors: { headColorId: 24, torsoColorId: 21 },
      scales: { height: 1.1, width: 0.9 },
    });
    assert.equal(avatarResponse.status, 200);
    assert.equal(JSON.parse(avatarResponse.body).ok, true);

    const savedUser = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'))[USER_ID];
    assert.equal(savedUser.displayName, 'Saved Display Name');
    assert.equal(savedUser.userId, '1');
    assert.equal(savedUser.username, 'tailsthehero10');
    assert.equal(savedUser.bio, 'Persisted profile text');
    assert.equal(savedUser.theme, 'dark');
    assert.equal(savedUser.avatar.playerAvatarType, 'R6');
    assert.deepEqual(savedUser.avatar.bodyColors, { headColorId: 24, torsoColorId: 21 });
    assert.deepEqual(savedUser.avatar.scales, { height: 1.1, width: 0.9 });
    assert.deepEqual(savedUser.currentlyWearing, ['12345', '67890']);

    const clientUser = JSON.parse(fs.readFileSync(path.join(settingsDir, 'users', `id-${USER_ID}.json`), 'utf8'));
    assert.equal(clientUser.displayName, 'Saved Display Name');
    assert.equal(clientUser.avatar.playerAvatarType, 'R6');
    assert.deepEqual(clientUser.currentlyWearing, ['12345', '67890']);

    const invalidScaleResponse = await request('/api/avatar/save', 'POST', {
      scales: { height: 'not-a-number' },
    });
    assert.equal(invalidScaleResponse.status, 400);
    assert.equal(JSON.parse(invalidScaleResponse.body).error, 'invalid-scales');

    const boundedScaleResponse = await request('/api/avatar/save', 'POST', {
      scales: {
        height: 99,
        width: -1,
        head: 1.01,
        depth: 1.5,
        proportion: -2,
        bodyType: 4,
      },
    });
    assert.equal(boundedScaleResponse.status, 200);
    const boundedUser = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'))[USER_ID];
    assert.deepEqual(boundedUser.avatar.scales, {
      height: 1.25,
      width: 0.7,
      head: 1.01,
      depth: 1.25,
      proportion: 0,
      bodyType: 3,
    });
    console.log('settings and avatar persistence: ok');
  } catch (error) {
    console.error('settings and avatar persistence: failed');
    throw error;
  } finally {
    bridge.kill('SIGTERM');
    await new Promise((resolve) => {
      if (bridge.exitCode !== null) return resolve();
      bridge.once('exit', resolve);
      setTimeout(resolve, 2000);
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(settingsDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
