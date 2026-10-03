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

fs.writeFileSync(path.join(dataDir, '2.json'), JSON.stringify({ currentlyWearing: ['502'] }));

const app = express();
app.use(express.json());
installClientApi(app, {
  getUser: (id) => users[String(id)] || null,
  getUsers: () => users,
  getAssets: () => assets,
  getGames: () => ({}),
  getGameEntry: () => null,
  getPlaceSettings: () => ({}),
  serializeUser: (id) => users[String(id)] || null,
  getCurrencyForUser: () => ({ robux: 0 }),
  getWearingForUser: () => [],
  getFriendsForUser: () => [],
  getPublicGamesForUser: () => [],
  normalizePlaceId: (id) => String(id),
  resolveSessionUser: () => null,
  saveUser: () => {},
  publicOrigin: 'http://127.0.0.1:3000',
  dataDir,
  releaseRoot: path.resolve(__dirname, '..'),
});

function request(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path: pathname }, (response) => {
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

    const classicThumbnail = await request(server, '/thumbs/avatar.ashx?userId=1&x=48&y=48');
    assert.equal(classicThumbnail.status, 302);
    assert.equal(classicThumbnail.headers.location, 'http://127.0.0.1:3000/avatar-thumbs/1.webp');
    assert.equal((await request(server, '/thumbs/avatar.ashx?userId=2&x=48&y=48')).status, 404);
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
