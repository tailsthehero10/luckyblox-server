'use strict';

const assert = require('node:assert/strict');
const express = require('../Webserver/http-db-bridge/node_modules/express');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { makeTestDir } = require('./test-paths');
const { installClientApi } = require('../Webserver/http-db-bridge/clientApi');

const dataDir = makeTestDir('luckblox-avatar-client-api');
const users = {
  1: {
    userId: '1',
    username: 'AvatarOwner',
    avatar: {
      playerAvatarType: 'R6',
      bodyColors: {
        headColorId: 24,
        torsoColorId: 23,
        rightArmColorId: 24,
        leftArmColorId: 24,
        rightLegColorId: 119,
        leftLegColorId: 119,
      },
      scales: { height: 1.1 },
    },
    currentlyWearing: ['501'],
    avatarThumbnail: 'http://127.0.0.1:3000/avatar-thumbs/1.webp',
  },
  2: { userId: '2', username: 'FileAvatar', currentlyWearing: [] },
};
const assets = {
  501: { id: 501, name: 'Real local shirt', assetTypeId: 11, assetType: 'Shirt', version: 3 },
  502: { id: 502, name: 'Saved pants', assetTypeId: 12, assetType: 'Pants', version: 2 },
};
const games = {
  27013: {
    placeId: 27013,
    universeId: 27014,
    title: 'A Real Test Experience',
    description: 'Experience metadata from the published game record.',
    developer: 'Real Creator',
    developerId: 42,
    creatorType: 'Group',
    thumbnail: '/game-art/test-cover.png',
    icon: '/game-art/test-icon.png',
    genre: 'Adventure',
  },
};
let activeSession = null;

fs.writeFileSync(path.join(dataDir, '2.json'), JSON.stringify({ currentlyWearing: ['502'] }));

const app = express();
app.use(express.json());
installClientApi(app, {
  getUser: (id) => users[String(id)] || null,
  getUsers: () => users,
  getAssets: () => assets,
  getGames: () => games,
  getGameEntry: (id) => games[String(id)] || null,
  getPlaceSettings: () => ({}),
  serializeUser: (id) => users[String(id)] || null,
  getCurrencyForUser: () => ({ robux: 0 }),
  getWearingForUser: () => [],
  getFriendsForUser: () => [],
  getPublicGamesForUser: () => [],
  normalizePlaceId: (id) => String(id),
  resolveSessionUser: () => activeSession,
  saveUser: (id, update) => {
    users[String(id)] = { ...users[String(id)], ...update };
    return users[String(id)];
  },
  publicOrigin: 'http://127.0.0.1:3000',
  dataDir,
  releaseRoot: path.resolve(__dirname, '..'),
});

function request(server, pathname, method = 'GET', payload = null) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: pathname,
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      } : {},
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

(async () => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const avatarResponse = await request(server, '/v1/avatar?userId=1');
    assert.equal(avatarResponse.status, 200);
    const avatar = JSON.parse(avatarResponse.body);
    assert.equal(avatar.playerAvatarType, 'R6');
    assert.equal(avatar.bodyColors.headColorId, 24);
    assert.equal(avatar.bodyColors.leftLegColorId, 119);
    assert.equal('headColor' in avatar.bodyColors, false);
    assert.deepEqual(avatar.assetIds, [501]);
    assert.equal(avatar.assets[0].name, 'Real local shirt');
    assert.equal(avatar.assets[0].currentVersionId, 3);

    const fileWearResponse = await request(server, '/v1/users/2/currently-wearing');
    assert.deepEqual(JSON.parse(fileWearResponse.body), { assetIds: [502] });
    const fileAvatarResponse = await request(server, '/v2/avatar?userId=2');
    assert.deepEqual(JSON.parse(fileAvatarResponse.body).assetIds, [502]);

    const thumbnails = JSON.parse((await request(server, '/v1/thumbnails/avatar?userIds=1,2,999')).body);
    assert.deepEqual(thumbnails.data, [
      {
        targetId: 1,
        state: 'Completed',
        imageUrl: 'http://127.0.0.1:3000/avatar-thumbs/1.webp',
        version: thumbnails.data[0].version,
      },
      { targetId: 2, state: 'Pending' },
    ]);

    const gameDetails = JSON.parse((await request(server, '/v1/games?universeIds=27014,999')).body);
    assert.deepEqual(gameDetails, {
      data: [{
        id: 27014,
        rootPlaceId: 27013,
        name: 'A Real Test Experience',
        description: 'Experience metadata from the published game record.',
        creator: { id: 42, name: 'Real Creator', type: 'Group' },
        thumbnailUrl: 'http://127.0.0.1:3000/game-art/test-cover.png',
        genre: 'Adventure',
        created: null,
        updated: null,
      }],
    });
    const gameThumbnails = JSON.parse(
      (await request(server, '/v1/thumbnails/games?universeIds=27014')).body,
    );
    assert.equal(gameThumbnails.data[0].targetId, 27014);
    assert.equal(gameThumbnails.data[0].imageUrl, 'http://127.0.0.1:3000/game-art/test-cover.png');

    const classicThumbnail = await request(server, '/thumbs/avatar.ashx?userId=1&x=48&y=48');
    assert.equal(classicThumbnail.status, 302);
    assert.equal(classicThumbnail.headers.location, 'http://127.0.0.1:3000/avatar-thumbs/1.webp');
    assert.equal((await request(server, '/thumbs/avatar.ashx?userId=2&x=48&y=48')).status, 404);

    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
    assert.equal((await request(server, '/api/avatar/thumbnail', 'POST', { image })).status, 401,
      'only an authenticated owner may update a local client portrait');
    activeSession = { userId: '1' };
    const savedThumbnail = await request(server, '/api/avatar/thumbnail', 'POST', { image });
    assert.equal(savedThumbnail.status, 200);
    assert.equal(JSON.parse(savedThumbnail.body).ok, true);

    const localThumbnails = JSON.parse(
      (await request(server, '/v1/thumbnails/avatar?userIds=1')).body,
    );
    assert.match(localThumbnails.data[0].imageUrl, /^http:\/\/127\.0\.0\.1:3000\/thumbs\/avatar\.ashx\?userId=1&v=\d+$/);
    const localImage = await request(server, '/thumbs/avatar.ashx?userId=1&x=48&y=48');
    assert.equal(localImage.status, 200);
    assert.match(localImage.headers['content-type'], /^image\/png\b/i);
    assert.ok(Buffer.from(localImage.body, 'binary').length > 0);
    assert.equal((await request(server, '/api/avatar/thumbnail', 'POST', {
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
    })).status, 400);

    assert.equal((await request(server, '/v1/avatar?userId=999')).status, 404);
    assert.equal((await request(server, '/v1/avatar?userId=1garbage')).status, 404);
    assert.equal((await request(server, '/v1/users/999')).status, 404);
    console.log('ok: client avatar APIs return saved appearance and only real available thumbnails');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
