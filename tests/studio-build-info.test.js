const assert = require('node:assert/strict');
const { getStudioBuildInfo, getStudioUpdateManifest } = require('../Webserver/http-db-bridge/studioBuildInfo');

const buildInfo = getStudioBuildInfo();
assert.ok(buildInfo.buildId, 'buildId should exist');
assert.equal(buildInfo.channel, 'production');
assert.equal(buildInfo.buildType, 'Release');
assert.equal(buildInfo.baseUrl, 'http://localhost/LuckBlox.site.tk/');
assert.ok(Array.isArray(getStudioUpdateManifest().updates), 'manifest should include an updates array');
console.log(`ok: studio build ${buildInfo.buildId} ready`);
