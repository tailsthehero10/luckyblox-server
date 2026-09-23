const assert = require('node:assert/strict');
const { getStudioBuildInfo, getStudioUpdateManifest } = require('../Webserver/http-db-bridge/studioBuildInfo');
const { publicBaseUrl, publicHostname, publicProtocol, stripTrailingSlash } =
  require('../server/runtimeConfig');

// The base URL is derived from the live deployment (localhost:3002 on the
// desktop, https://luckyblox-server.onrender.com on Render), so expect the same
// derivation rather than a hardcoded localhost string that only matches one host.
const expectedBaseUrl =
  stripTrailingSlash(publicBaseUrl || `${publicProtocol}://${publicHostname}`) + '/LuckBlox.site.tk/';

const buildInfo = getStudioBuildInfo();
assert.ok(buildInfo.buildId, 'buildId should exist');
assert.equal(buildInfo.channel, 'production');
assert.equal(buildInfo.buildType, 'Release');
assert.equal(buildInfo.baseUrl, expectedBaseUrl);
assert.ok(Array.isArray(getStudioUpdateManifest().updates), 'manifest should include an updates array');
console.log(`ok: studio build ${buildInfo.buildId} ready`);
