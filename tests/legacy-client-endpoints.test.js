'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeTestDir } = require('./test-paths');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3991;
const PLACE_ID = 987654321;

function request(pathName, method = 'GET', body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${PORT}`, ...extraHeaders };
    let requestBody;
    if (body !== undefined) {
      requestBody = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(requestBody);
      headers.rbxauthenticationnegotiation = '1';
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}

async function waitForReady(proc) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (proc.exitCode !== null) throw new Error('bridge exited before becoming ready');
    try {
      const response = await request('/health');
      if (response.status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('bridge did not become ready');
}

(async () => {
  const dataDir = makeTestDir('luckyblox-legacy-client');
  const sessionId = 'legacy-client-test-session';
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify({
    [sessionId]: {
      sessionId,
      userId: '1',
      username: 'LegacyClientTest',
      csrfToken: 'legacy-client-test-csrf',
      expiresAt: Date.now() + 60 * 60 * 1000,
      createdAt: Date.now(),
    },
  }));
  fs.writeFileSync(path.join(dataDir, 'games.json'), JSON.stringify({
    [PLACE_ID]: {
      placeId: PLACE_ID,
      title: 'Saved Test Place',
      description: 'A place record stored by the test.',
      authorId: 17,
      author: 'TestCreator',
      creatorType: 'Group',
      icon: '/gameplaceholder/card.png',
    },
  }));

  const bridge = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: dataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitForReady(bridge);

    const product = await request(`/LuckBlox.site.tk/home/marketplace/productinfo?placeId=${PLACE_ID}`);
    assert.equal(product.status, 200);
    const productInfo = JSON.parse(product.body.toString('utf8'));
    assert.equal(productInfo.AssetId, PLACE_ID);
    assert.equal(productInfo.Name, 'Saved Test Place');
    assert.equal(productInfo.Description, 'A place record stored by the test.');
    assert.equal(productInfo.Creator.Id, 17);
    assert.equal(productInfo.Creator.Name, 'TestCreator');
    assert.equal(productInfo.Creator.CreatorType, 'Group');

    const anonymousTicketResponse = await request(`/v1/authentication-tickets?userId=1&placeId=${PLACE_ID}`);
    assert.equal(anonymousTicketResponse.status, 401, 'ticket issuance requires a signed-in LuckyBlox account');
    const issuedTicketResponse = await request('/v1/authentication-tickets', 'POST', {
      userId: 987,
      placeId: PLACE_ID,
    }, { cookie: `luckblox_session=${sessionId}` });
    assert.equal(issuedTicketResponse.status, 201);
    const ticketPayload = JSON.parse(issuedTicketResponse.body.toString('utf8'));
    const issuedTicket = ticketPayload.ticket;
    assert.ok(
      new Date(ticketPayload.expiresAt).getTime() - Date.now() >= 4 * 60 * 1000,
      'the client ticket should survive local DEV-PLAY server startup',
    );
    const redeemedTicket = await request('/v1/authentication-ticket/redeem', 'POST', {
      authenticationTicket: issuedTicket,
    });
    assert.equal(redeemedTicket.status, 200, 'the 2021 player ticket redemption endpoint accepts a real issued ticket');
    assert.deepEqual(JSON.parse(redeemedTicket.body.toString('utf8')), {});
    assert.ok(
      (redeemedTicket.headers['set-cookie'] || []).some((cookie) => cookie.startsWith('.ROBLOSECURITY=')),
      'redemption returns the player authentication cookie',
    );
    assert.ok(
      (redeemedTicket.headers['set-cookie'] || []).some((cookie) => cookie.startsWith('luckblox_session=')),
      'redemption maps the player to the LuckyBlox session',
    );
    const robloxCookie = (redeemedTicket.headers['set-cookie'] || [])
      .find((cookie) => cookie.startsWith('.ROBLOSECURITY='));
    const accountPage = await request('/account', 'GET', undefined, {
      cookie: robloxCookie.split(';', 1)[0],
    });
    assert.equal(accountPage.status, 200, 'the player cookie resolves to its LuckyBlox account session');
    assert.ok(
      !(accountPage.headers['set-cookie'] || []).some((cookie) => cookie.startsWith('luckblox_session=')),
      'a valid player cookie is not overwritten by an anonymous session cookie',
    );
    const invalidRedeem = await request('/v1/authentication-ticket/redeem', 'POST', {
      authenticationTicket: 'invalid-ticket',
    });
    assert.equal(invalidRedeem.status, 401, 'unknown launch tickets cannot be redeemed');
    const legacyJoinTicketResponse = await request(`/game/placelauncher.ashx?placeId=${PLACE_ID}&userId=1`);
    assert.equal(legacyJoinTicketResponse.status, 200);
    const legacyJoinTicket = JSON.parse(legacyJoinTicketResponse.body.toString('utf8')).authenticationTicket;
    const anonymousRedeem = await request('/v1/authentication-ticket/redeem', 'POST', {
      authenticationTicket: legacyJoinTicket,
    });
    assert.equal(anonymousRedeem.status, 401, 'tickets from anonymous legacy requests cannot create account sessions');
    const joinFromProtocol = await request(`/game/join?placeId=${PLACE_ID}&ticket=${encodeURIComponent(issuedTicket)}`);
    assert.equal(joinFromProtocol.status, 200);
    const protocolJoinPayload = JSON.parse(joinFromProtocol.body.toString('utf8'));
    assert.equal(
      protocolJoinPayload.userId,
      1,
      'protocol joins without userId must resolve the user from the signed launch ticket',
    );
    assert.equal(protocolJoinPayload.game.placeId, PLACE_ID);
    assert.ok(protocolJoinPayload.game.title, 'the client join response carries the experience title');
    assert.equal(protocolJoinPayload.game.creatorName, 'TestCreator', 'the join response uses the creator saved in games.json');
    assert.equal(protocolJoinPayload.game.creatorId, 17, 'the join response uses the creator ID saved in games.json');
    assert.equal(protocolJoinPayload.game.creatorType, 'Group', 'the join response preserves the creator type');
    assert.match(protocolJoinPayload.game.thumbnailUrl, /^https?:\/\//);

    const serializedGameResponse = await request(`/api/v1/games/${PLACE_ID}`);
    assert.equal(serializedGameResponse.status, 200);
    const serializedGame = JSON.parse(serializedGameResponse.body.toString('utf8')).game;
    assert.equal(serializedGame.creatorName, 'TestCreator', 'the game API uses the creator saved in games.json');
    assert.equal(serializedGame.creatorId, 17, 'the game API uses the creator ID saved in games.json');

    const legacySettings = await request('/home/Setting/QuietGet/ClientAppSettings?apiKey=test-key&client=CUSTOM-2021M');
    assert.equal(legacySettings.status, 200);
    assert.match(legacySettings.headers['content-type'], /^application\/json\b/);
    const clientSettings = JSON.parse(legacySettings.body.toString('utf8'));
    const expectedClientSettings = JSON.parse(fs.readFileSync(
      path.join(PROJECT_ROOT, 'Clients', 'CUSTOM-2021M', 'shared', 'ClientSettings', 'ClientAppSettings.json'),
      'utf8',
    ));
    assert.deepEqual(clientSettings, expectedClientSettings);

    const v2ApplicationSettings = await request('/home/v2/settings/application/PCDesktopClient?client=CUSTOM-2021M');
    assert.equal(v2ApplicationSettings.status, 200);
    const v2SettingsBody = JSON.parse(v2ApplicationSettings.body.toString('utf8'));
    assert.deepEqual(v2SettingsBody.applicationSettings, expectedClientSettings);

    const v1ApplicationSettings = await request('/home/v1/settings/application?applicationName=PCDesktopClient&client=CUSTOM-2021M');
    assert.equal(v1ApplicationSettings.status, 200);
    assert.deepEqual(
      JSON.parse(v1ApplicationSettings.body.toString('utf8')).applicationSettings,
      expectedClientSettings,
    );

    const platformManifestResponse = await request('/api/client/platform-content-manifest');
    assert.equal(platformManifestResponse.status, 200);
    const platformManifest = JSON.parse(platformManifestResponse.body.toString('utf8'));
    assert.equal(platformManifest.available, true);
    assert.ok(platformManifest.files.length > 0);
    assert.ok(platformManifest.files.some((file) => file.path.startsWith('pc/')));

    const platformAsset = platformManifest.files.find((file) => file.path.startsWith('pc/'));
    const platformAssetResponse = await request(`/PlatformContent/${platformAsset.path.split('/').map(encodeURIComponent).join('/')}`);
    assert.equal(platformAssetResponse.status, 200);
    assert.equal(platformAssetResponse.body.length, platformAsset.size);

    const unsupportedApplication = await request('/home/v2/settings/application/UnknownClient');
    assert.equal(unsupportedApplication.status, 400);

    const sharedSettings = await request('/home/Setting/QuietGet/ClientSharedSettings?apiKey=test-key');
    assert.equal(sharedSettings.status, 200);
    assert.deepEqual(JSON.parse(sharedSettings.body.toString('utf8')), {});

    const postedSettings = await request('/home/Setting/QuietGet/ClientAppSettings?apiKey=test-key', 'POST');
    assert.equal(postedSettings.status, 200);

    const thumbnailInfo = await request(`/home/asset-thumbnail/json?assetId=${PLACE_ID}`);
    assert.equal(thumbnailInfo.status, 200);
    const thumbnail = JSON.parse(thumbnailInfo.body.toString('utf8'));
    assert.equal(thumbnail.Final, true);
    assert.equal(thumbnail.thumbnailFinal, true);
    assert.equal(thumbnail.targetId, PLACE_ID);
    assert.equal(thumbnail.Url, `http://127.0.0.1:${PORT}/gameplaceholder/card.png`);

    const image = await request(`/home/asset-thumbnail/image?assetId=${PLACE_ID}&width=576&height=324&format=png`);
    assert.equal(image.status, 200);
    assert.match(image.headers['content-type'], /^image\/png\b/);
    assert.deepEqual(image.body.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    assert.equal((await request('/home/asset-thumbnail/json?assetId=987654322')).status, 404);
    assert.equal((await request('/home/asset-thumbnail/image?assetId=987654322')).status, 404);
    assert.equal((await request('/home/asset-thumbnail/json?assetId=not-a-number')).status, 400);
    assert.equal((await request('/home/marketplace/productinfo?placeId=987654322')).status, 404);
  } finally {
    bridge.kill('SIGTERM');
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // The test directory is disposable; a process shutdown race must not hide
      // the actual assertions above.
    }
  }

  console.log('Legacy /home client routes, place metadata, and thumbnails passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
