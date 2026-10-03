'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { makeTestDir } = require('./test-paths');
const { installStudioApiRoutes } = require('../server/studioApi');

async function main() {
const dataDir = makeTestDir('luckblox-studio-asset-fallback');
const savedPlacesRoot = path.join(dataDir, 'saved_places');
const storedJson = {};
const writes = [];
let contentSyncCalls = 0;
const storage = {
  dataPath(fileName) {
    return path.join(dataDir, fileName);
  },
  readJson(fileName, fallback) {
    return Object.hasOwn(storedJson, fileName) ? storedJson[fileName] : fallback;
  },
  writeJson(fileName, value) {
    writes.push(fileName);
    storedJson[fileName] = value;
    fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(value));
    return true;
  },
  async pushContentToRemote() {
    contentSyncCalls += 1;
    return { ok: true, pushed: ['saved_places'] };
  },
};

const routes = new Map();
const app = {
  get(route, ...handlers) {
    routes.set(route, handlers[handlers.length - 1]);
    return this;
  },
  post(route, ...handlers) {
    routes.set(route, handlers[handlers.length - 1]);
    return this;
  },
};
let delegated = 0;
installStudioApiRoutes(app, {
  serveAssetById() {
    delegated += 1;
    return 'asset-handler';
  },
  storage,
  savedPlacesRoot,
});

try {
  const fallback = routes.get('/asset');
  assert.equal(typeof fallback, 'function');
  assert.equal(fallback({ query: { id: '9999999999999' }, params: {} }, {}), 'asset-handler');
  assert.equal(delegated, 1, '/asset must pass through to the Roblox asset handler');

  const versionedFallback = routes.get('/v1/assets/:id');
  assert.equal(typeof versionedFallback, 'function');
  assert.equal(
    versionedFallback({ query: {}, params: { id: '9999999999999' } }, {}),
    'asset-handler',
  );
  assert.equal(delegated, 2, '/v1/assets/:id must pass through to the Roblox asset handler');
  assert.equal(routes.has('/asset/'), false, 'the old self-dispatching /asset/ route must stay removed');
  assert.deepEqual(writes.sort(), ['assets.json', 'places.json']);

  const uploadedBytes = Buffer.from('actual uploaded asset bytes');
  const upload = routes.get('/Data/Upload.ashx');
  const uploadResponse = await new Promise((resolve) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };
    upload({
      body: uploadedBytes,
      query: {},
      headers: { 'x-filename': 'uploaded-test.rbxm' },
    }, response);
  });
  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(contentSyncCalls, 1);
  const uploadedRecord = storedJson['assets.json'][String(uploadResponse.payload.assetId)];
  assert.ok(uploadedRecord, 'upload metadata must use the configured persistent storage');
  assert.equal(fs.readFileSync(uploadedRecord.filePath).toString(), uploadedBytes.toString());
  assert.deepEqual(uploadResponse.payload.contentSync, { ok: true, pushed: ['saved_places'] });

  async function requestLocalAsset(handler, request) {
    return new Promise((resolve, reject) => {
      const response = new PassThrough();
      const chunks = [];
      response.setHeader = (name, value) => {
        response.headers = response.headers || {};
        response.headers[name.toLowerCase()] = value;
      };
      response.status = (statusCode) => {
        response.statusCode = statusCode;
        return response;
      };
      response.json = (payload) => {
        reject(new Error(`asset request failed: ${JSON.stringify(payload)}`));
      };
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 200,
        headers: response.headers || {},
        body: Buffer.concat(chunks),
      }));
      handler(request, response);
    });
  }

  for (const [route, request] of [
    [fallback, { query: { id: String(uploadResponse.payload.assetId) }, params: {} }],
    [versionedFallback, { query: {}, params: { id: String(uploadResponse.payload.assetId) } }],
  ]) {
    const loaded = await requestLocalAsset(route, request);
    assert.equal(loaded.headers['content-type'], 'application/octet-stream');
    assert.deepEqual(loaded.body, uploadedBytes);
  }

  const studioApi = fs.readFileSync(path.join(__dirname, '..', 'server', 'studioApi.js'), 'utf8');
  assert.doesNotMatch(studioApi, /Classic Red Shirt|Classic Blue Pants|Robloxian Cap/);
  assert.doesNotMatch(studioApi, /['"]100[123]['"]\s*:/);
  console.log('ok: Studio routes defer asset delivery and persist real asset/place indexes');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
