'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { makeTestDir } = require('./test-paths');
const security = require('../server/security');

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

function request(port, pathname, options = {}) {
  const body = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || (body ? 'POST' : 'GET'),
      headers: {
        ...(options.sessionCookie ? { cookie: options.sessionCookie } : {}),
        ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function get(port, pathname, sessionCookie) {
  return request(port, pathname, { sessionCookie });
}

function cookieFrom(response) {
  const cookie = (response.headers['set-cookie'] || [])
    .find((entry) => /^[^=]*session=/i.test(entry))
    ?.split(';', 1)[0];
  assert.ok(cookie, 'login should establish an authenticated session cookie');
  return cookie;
}

(async () => {
  const port = await availablePort();
  const dataDir = makeTestDir('luckblox-avatar-rig');
  const credentials = security.hashPassword('AvatarRouteTest1!');
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({
    1: {
      userId: 1,
      username: 'tailsthehero10',
      displayName: 'LuckyBlox Owner',
      password: credentials.hash,
      passwordSalt: credentials.salt,
      passwordVersion: credentials.version,
      theme: 'light',
      avatar: { playerAvatarType: 'R6', bodyColors: {} },
      currentlyWearing: ['607702162'],
      friends: [],
    },
    2: {
      userId: 2,
      username: 'ViewerAccount',
      displayName: 'Viewer Account',
      password: credentials.hash,
      passwordSalt: credentials.salt,
      passwordVersion: credentials.version,
      theme: 'dark',
      avatar: { playerAvatarType: 'R15', bodyColors: {} },
      friends: [],
    },
  }));
  fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({
    607702162: {
      id: 607702162,
      name: 'Test Avatar Item',
      assetType: 'Hat',
      thumbnail: '/gameplaceholder/card.png',
    },
    25330901: {
      id: 25330901,
      name: 'Test Classic Pants',
      assetType: 'Pants',
      assetTypeId: 12,
    },
  }));
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

    const viewerLogin = await request(port, '/api/login', {
      method: 'POST',
      body: { username: 'ViewerAccount', password: 'AvatarRouteTest1!' },
    });
    assert.equal(viewerLogin.status, 200);
    const viewerSession = cookieFrom(viewerLogin);
    const ownerLogin = await request(port, '/api/login', {
      method: 'POST',
      body: { username: 'tailsthehero10', password: 'AvatarRouteTest1!' },
    });
    assert.equal(ownerLogin.status, 200);
    const ownerSession = cookieFrom(ownerLogin);

    for (const [rig, expectedParts] of [['R6', 6], ['R15', 15]]) {
      const response = await get(port, `/api/avatar/rig/${rig}`);
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.rig, rig);
      assert.equal(payload.parts.length, expectedParts);
      const head = payload.parts.find((part) => part.name === 'Head');
      assert.equal(head.faceTexture, '/Content/textures/face.png');
      assert.ok(head.attachments.some((attachment) => attachment.name === 'HatAttachment'));
      if (rig === 'R15') {
        const meshPart = payload.parts.find((part) => part.name === 'LeftHand');
        assert.equal(meshPart.meshId, 'http://www.roblox.com/asset/?id=532219986');
        assert.equal(meshPart.mesh, null);
        assert.equal(meshPart.meshGeometryIncluded, false);
      }
    }

    assert.equal((await get(port, '/api/avatar/rig/R7')).status, 404);
    const classicPants = await get(port, '/api/avatar/accessories/25330901');
    assert.equal(classicPants.status, 200);
    assert.deepEqual(JSON.parse(classicPants.body), {
      ok: true,
      renderable: false,
      kind: 'clothing',
      id: '25330901',
      name: 'Test Classic Pants',
      assetType: 'Pants',
    });
    const publicProfile = await get(port, '/users/1/profile', viewerSession);
    assert.equal(publicProfile.status, 200);
    assert.match(publicProfile.body, /class="theme-dark dark-theme"/);
    assert.match(publicProfile.body, /LuckyBlox Owner/);
    assert.match(publicProfile.body, /class="lb-account-name">ViewerAccount<\/span>/);
    assert.match(publicProfile.body, /data-avatar-viewer/);
    assert.match(publicProfile.body, /data-avatar-mode="portrait"/,
      'the profile picture uses a static head-focused view of this user avatar');
    assert.match(publicProfile.body, /data-avatar-mode="portrait"[^>]*><img data-avatar-portrait-image/,
      'the profile picture starts as an image, not an interactive canvas');
    assert.match(publicProfile.body, /data-avatar-mode="viewer"/,
      'the full-size avatar remains a separate interactive viewer');
    assert.match(publicProfile.body, /&quot;wearing&quot;:\[&quot;607702162&quot;\]/,
      'the profile 3D viewer receives the saved equipped asset ids');
    assert.match(publicProfile.body, /&quot;thumbnailFallbacks&quot;/,
      'the viewer receives saved Roblox asset thumbnails for restricted model fallbacks');
    assert.match(publicProfile.body, /lb-user-avatar-placeholder/);
    assert.doesNotMatch(publicProfile.body, /lb-avatar-svg/,
      'the profile and account chips must not substitute a generated avatar drawing');
    assert.match(publicProfile.body, /href="\/css\/avatar\.css"/);
    assert.doesNotMatch(publicProfile.body, /href="\/avatar\?userId=1"/);
    assert.doesNotMatch(publicProfile.body, /Customize Avatar/);

    const ownerAvatar = await get(port, '/avatar?userId=2', ownerSession);
    assert.equal(ownerAvatar.status, 200);
    assert.match(ownerAvatar.body, /LuckyBlox Owner/);
    assert.match(ownerAvatar.body, /<button class="roblox-asset-card selected"[^>]*data-select-asset="607702162"/);
    assert.match(ownerAvatar.body, /aria-pressed="true"[\s\S]*?Test Avatar Item[\s\S]*?Wearing/);
    assert.doesNotMatch(ownerAvatar.body, /<button class="roblox-secondary-button"[^>]*data-select-asset/);
    assert.doesNotMatch(ownerAvatar.body, /Viewer Account/);

    const viewerAccount = await get(port, '/account?userId=1', viewerSession);
    assert.equal(viewerAccount.status, 200);
    assert.match(viewerAccount.body, /<title>ViewerAccount Account<\/title>/);
    assert.match(viewerAccount.body, /<html lang="en" class="theme-dark dark-theme">/);
    assert.doesNotMatch(viewerAccount.body, /LuckyBlox Owner Account/);
    const ownerAccount = await get(port, '/account?userId=2', ownerSession);
    assert.equal(ownerAccount.status, 200);
    assert.match(ownerAccount.body, /<title>tailsthehero10 Account<\/title>/);
    assert.match(ownerAccount.body, /<html lang="en" class="">/);
    const viewerFriends = await get(port, '/friends?userId=1', viewerSession);
    assert.equal(viewerFriends.status, 200);
    assert.match(viewerFriends.body, /class="lb-account-name">ViewerAccount<\/span>/);

    const guestAvatar = await get(port, '/avatar?userId=1');
    assert.equal(guestAvatar.status, 302);
    assert.match(guestAvatar.headers.location, /^\/signin\?/);
    assert.equal((await get(port, '/account?userId=1')).status, 302);
    assert.equal((await get(port, '/api/admin/overview', ownerSession)).status, 200);

    assert.equal((await get(port, '/js/avatar-viewer.mjs')).status, 200);
    assert.equal((await get(port, '/vendor/three/three.module.js')).status, 200);
    const faceTexture = await get(port, '/Content/textures/face.png');
    assert.equal(faceTexture.status, 200);
    assert.match(faceTexture.headers['content-type'], /^image\/png\b/i);
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
