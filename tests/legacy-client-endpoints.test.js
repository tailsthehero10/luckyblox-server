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

function request(pathName, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method,
      headers: { host: `127.0.0.1:${PORT}` },
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
    req.end();
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
  fs.writeFileSync(path.join(dataDir, 'games.json'), JSON.stringify({
    [PLACE_ID]: {
      placeId: PLACE_ID,
      title: 'Saved Test Place',
      description: 'A place record stored by the test.',
      authorId: 17,
      author: 'TestCreator',
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
