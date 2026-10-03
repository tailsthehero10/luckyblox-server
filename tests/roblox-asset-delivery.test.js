'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTestDir } = require('./test-paths');
const { fetchAssetContent } = require('../server/robloxAssetDelivery');

const cacheDir = makeTestDir('luckblox-asset-delivery');

(async () => {
  try {
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      assert.equal(options.redirect, 'manual');
      if (url.startsWith('https://assetdelivery.roblox.com/')) {
        const requestUrl = new URL(url);
        assert.equal(requestUrl.searchParams.get('id'), '123456');
        assert.equal(requestUrl.searchParams.get('version'), '7');
        return new Response(null, {
          status: 302,
          headers: { location: 'https://t1.rbxcdn.com/verified-asset.rbxm' },
        });
      }
      assert.equal(url, 'https://t1.rbxcdn.com/verified-asset.rbxm');
      return new Response(Buffer.from('real-rbxm-payload'), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    };

    const first = await fetchAssetContent('123456', '7', { cacheDir, fetchImpl });
    assert.equal(first.ok, true);
    assert.equal(first.contentType, 'application/octet-stream');
    assert.equal(first.buffer.toString(), 'real-rbxm-payload');
    assert.equal(first.cached, false);
    assert.equal(calls, 2);

    const cached = await fetchAssetContent('123456', '7', {
      cacheDir,
      fetchImpl: async () => { throw new Error('cache should avoid network'); },
    });
    assert.equal(cached.ok, true);
    assert.equal(cached.cached, true);
    assert.equal(cached.buffer.toString(), 'real-rbxm-payload');

    let locatorCalls = 0;
    const located = await fetchAssetContent('123459', null, {
      fetchImpl: async (url) => {
        locatorCalls += 1;
        if (url.startsWith('https://assetdelivery.roblox.com/')) {
          return new Response(JSON.stringify({
            locations: ['https://t2.rbxcdn.com/located-asset.rbxm'],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        assert.equal(url, 'https://t2.rbxcdn.com/located-asset.rbxm');
        return new Response(Buffer.from('located-payload'), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      },
    });
    assert.equal(located.ok, true);
    assert.equal(located.buffer.toString(), 'located-payload');
    assert.equal(locatorCalls, 2);

    await assert.rejects(
      fetchAssetContent('123457', null, {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.invalid/asset.rbxm' },
        }),
      }),
      /non-Roblox URL/,
    );

    const missing = await fetchAssetContent('123458', null, {
      fetchImpl: async () => new Response('not found', { status: 404 }),
    });
    assert.deepEqual(
      { ok: missing.ok, statusCode: missing.statusCode },
      { ok: false, statusCode: 404 },
    );

    let invalidIdCalls = 0;
    const invalidId = await fetchAssetContent('123/../456', null, {
      fetchImpl: async () => { invalidIdCalls += 1; },
    });
    assert.deepEqual(
      { ok: invalidId.ok, statusCode: invalidId.statusCode, reason: invalidId.reason },
      { ok: false, statusCode: 400, reason: 'invalid-asset-id' },
    );
    assert.equal(invalidIdCalls, 0);
    assert.ok(fs.existsSync(path.join(cacheDir, '123456-7.bin')));
    console.log('ok: public Roblox asset bytes are validated, versioned, and cached safely');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
