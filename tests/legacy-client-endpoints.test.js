'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeTestDir } = require('./test-paths');
const { resolveServerBinary } = require('../server/orchestrator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3991;
const PLACE_ID = 987654321;
const HOST_TEST_PLACE_ID = PLACE_ID + 100;
const HOST_TOKEN = 'legacy-endpoint-test-host-token-32-chars';
const HAS_DEDICATED_SERVER = Boolean(resolveServerBinary());

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
      developer: 'Test Studio',
      icon: '/gameplaceholder/card.png',
    },
    [PLACE_ID + 1]: {
      placeId: PLACE_ID + 1,
      title: 'Developer Label Is Not Owner',
      developer: 'LuckyBlox Studio',
    },
  }));

  const bridge = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: dataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
      LUCKYBLOX_HOST_TOKEN: HOST_TOKEN,
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

    const serverListResponse = await request(`/api/servers?placeId=${PLACE_ID}`);
    assert.equal(serverListResponse.status, 200);
    assert.deepEqual(
      JSON.parse(serverListResponse.body.toString('utf8')).servers,
      [],
      'the server browser lists only jobs running in the current process',
    );
    const serializedGameResponse = await request(`/api/v1/games/${PLACE_ID}`);
    assert.equal(serializedGameResponse.status, 200);
    const serializedGame = JSON.parse(serializedGameResponse.body.toString('utf8')).game;
    assert.equal(serializedGame.creatorName, 'TestCreator', 'the game API uses the creator saved in games.json');
    assert.equal(serializedGame.creatorId, 17, 'the game API uses the creator ID saved in games.json');
    assert.deepEqual(serializedGame.activeServers, [], 'games without a running server must not advertise a made-up address');
    assert.equal(serializedGame.playerCount, 0, 'games without a running server must not report stored player counts');

    const anonymousTicketResponse = await request(`/v1/authentication-tickets?userId=1&placeId=${PLACE_ID}`);
    assert.equal(anonymousTicketResponse.status, 401, 'ticket issuance requires a signed-in LuckyBlox account');
    const issuedTicketResponse = await request('/v1/authentication-tickets', 'POST', {
      userId: 987,
      placeId: PLACE_ID,
    }, { cookie: `luckblox_session=${sessionId}` });
    if (!HAS_DEDICATED_SERVER) {
      assert.equal(issuedTicketResponse.status, 503);
      assert.equal(JSON.parse(issuedTicketResponse.body.toString('utf8')).error, 'game-server-unavailable');
      const unavailableJoin = await request(`/game/join?placeId=${PLACE_ID}`);
      assert.equal(unavailableJoin.status, 503);
      assert.equal(JSON.parse(unavailableJoin.body.toString('utf8')).error, 'game-server-unavailable');
    } else {
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
    const liveGameResponse = await request(`/api/v1/games/${PLACE_ID}`);
    const liveGame = JSON.parse(liveGameResponse.body.toString('utf8')).game;
    assert.equal(liveGame.activeServers.length, 1, 'a running game server is exposed in the game API');
    assert.doesNotMatch(liveGame.activeServers[0], /:3991:/, 'game server addresses must not include the website port');

    const characterAppearance = await request(
      `/v1/avatar-fetch?placeId=${PLACE_ID}&userId=1`,
    );
    assert.equal(characterAppearance.status, 200);
    assert.match(
      characterAppearance.headers['content-type'],
      /application\/json/i,
      'the 2021 join payload avatar URL must resolve to the player appearance document',
    );
    const appearanceData = JSON.parse(characterAppearance.body.toString('utf8'));
    assert.equal(appearanceData.userId, 1);
    assert.equal(appearanceData.placeId, PLACE_ID);
    }

    const ownerFallbackResponse = await request(`/api/v1/games/${PLACE_ID + 1}`);
    assert.equal(ownerFallbackResponse.status, 200);
    const ownerFallbackGame = JSON.parse(ownerFallbackResponse.body.toString('utf8')).game;
    assert.equal(ownerFallbackGame.developer, 'LuckyBlox Studio', 'developer label remains separate');
    assert.equal(ownerFallbackGame.creatorName, 'tailsthehero10', 'developer label must not become game owner');
    assert.equal(ownerFallbackGame.creatorId, 1, 'games without explicit owner use the deployment owner ID');

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

    assert.equal((await request('/home/asset-thumbnail/json?assetId=987654323')).status, 404);
    assert.equal((await request('/home/asset-thumbnail/image?assetId=987654323')).status, 404);
    assert.equal((await request('/home/asset-thumbnail/json?assetId=not-a-number')).status, 400);
    assert.equal((await request('/home/marketplace/productinfo?placeId=987654323')).status, 404);

    const unauthenticatedHost = await request('/api/servers/register', 'POST', {
      jobId: 'untrusted-host',
      placeId: HOST_TEST_PLACE_ID,
      port: 55000,
      serverHost: 'games.example.net',
    });
    assert.equal(unauthenticatedHost.status, 401, 'untrusted clients cannot advertise fake game servers');

    const hostHeaders = { authorization: `Bearer ${HOST_TOKEN}` };
    if (!HAS_DEDICATED_SERVER) {
      const dynamicPlaceId = HOST_TEST_PLACE_ID + 1;
      const launchRequest = request('/api/launch-game', 'POST', {
        placeId: dynamicPlaceId,
      }, { cookie: `luckblox_session=${sessionId}` });
      let queuedRequest = null;
      for (let attempt = 0; attempt < 20 && !queuedRequest; attempt += 1) {
        const queueResponse = await request('/api/servers/host-requests', 'POST', {
          workerId: 'integration-test-worker',
        }, hostHeaders);
        assert.equal(queueResponse.status, 200);
        queuedRequest = JSON.parse(queueResponse.body.toString('utf8')).requests
          .find((item) => item.placeId === dynamicPlaceId) || null;
        if (!queuedRequest) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(queuedRequest, 'a join for any place queues it for an available public host');

      const dynamicRegistration = await request('/api/servers/register', 'POST', {
        jobId: 'dynamic-host-test',
        requestId: queuedRequest.requestId,
        workerId: 'integration-test-worker',
        placeId: dynamicPlaceId,
        port: 55001,
        serverHost: 'games.example.net',
        maxPlayers: 20,
        playerIds: [],
      }, hostHeaders);
      assert.equal(dynamicRegistration.status, 200, 'a worker can register the requested dynamic instance');

      const dynamicLaunch = await launchRequest;
      assert.equal(dynamicLaunch.status, 200, 'the waiting launch completes after dynamic host registration');
      const dynamicLaunchPayload = JSON.parse(dynamicLaunch.body.toString('utf8'));
      assert.equal(dynamicLaunchPayload.serverHost, 'games.example.net');
      assert.equal(dynamicLaunchPayload.port, 55001);
      await request('/api/servers/close', 'POST', { jobId: 'dynamic-host-test' }, hostHeaders);
    }

    const registeredHost = await request('/api/servers/register', 'POST', {
      jobId: 'cloud-host-test',
      placeId: HOST_TEST_PLACE_ID,
      port: 55000,
      serverHost: 'games.example.net',
      maxPlayers: 20,
      playerIds: [],
    }, hostHeaders);
    assert.equal(registeredHost.status, 200);

    const invalidHost = await request('/api/servers/register', 'POST', {
      jobId: 'bad-host',
      placeId: HOST_TEST_PLACE_ID,
      port: 55000,
      serverHost: 'localhost',
    }, hostHeaders);
    assert.equal(invalidHost.status, 400, 'remote registrations cannot advertise localhost');
    const privateAddress = await request('/api/servers/register', 'POST', {
      jobId: 'private-host',
      placeId: HOST_TEST_PLACE_ID,
      port: 55000,
      serverHost: '127.0.0.1',
    }, hostHeaders);
    assert.equal(privateAddress.status, 400, 'remote registrations cannot advertise a loopback address');

    const remoteServersResponse = await request(`/api/servers?placeId=${HOST_TEST_PLACE_ID}`);
    const remoteServers = JSON.parse(remoteServersResponse.body.toString('utf8')).servers;
    assert.equal(remoteServers.length, 1);
    assert.equal(remoteServers[0].host, 'games.example.net');
    assert.equal(remoteServers[0].port, 55000);

    const remoteGameResponse = await request(`/api/v1/games/${HOST_TEST_PLACE_ID}`);
    const remoteGame = JSON.parse(remoteGameResponse.body.toString('utf8')).game;
    assert.deepEqual(remoteGame.activeServers, ['games.example.net:55000']);

    const remoteJoinResponse = await request(`/game/Join.ashx?placeId=${HOST_TEST_PLACE_ID}&jobId=cloud-host-test&userId=1&ticket=test-ticket`);
    assert.equal(remoteJoinResponse.status, 200);
    assert.equal(JSON.parse(remoteJoinResponse.body.toString('utf8')).ip, 'games.example.net');

    const hostHeartbeat = await request('/api/servers/update-players', 'POST', {
      jobId: 'cloud-host-test',
      playerIds: ['9'],
    }, hostHeaders);
    assert.equal(hostHeartbeat.status, 200);
    const heartbeatWithoutPlayers = await request('/api/servers/update-players', 'POST', {
      jobId: 'cloud-host-test',
    }, hostHeaders);
    assert.equal(heartbeatWithoutPlayers.status, 200, 'heartbeats without player data preserve allocated player records');
    assert.equal(
      JSON.parse((await request(`/api/servers?placeId=${HOST_TEST_PLACE_ID}`)).body.toString('utf8')).servers[0].playing,
      1,
    );

    const closedHost = await request('/api/servers/close', 'POST', {
      jobId: 'cloud-host-test',
    }, hostHeaders);
    assert.equal(closedHost.status, 200);
    assert.deepEqual(
      JSON.parse((await request(`/api/servers?placeId=${HOST_TEST_PLACE_ID}`)).body.toString('utf8')).servers,
      [],
    );
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
