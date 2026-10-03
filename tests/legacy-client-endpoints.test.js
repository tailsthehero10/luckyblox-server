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

function request(pathName) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
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
