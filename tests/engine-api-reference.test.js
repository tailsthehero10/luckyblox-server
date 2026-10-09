'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('../Webserver/http-db-bridge/node_modules/ejs');
const {
  loadClientEngineApi,
  parseReflectionMetadata,
} = require('../Webserver/http-db-bridge/engineApiReference');

const fixture = `<?xml version="1.0"?>
<roblox version="4">
  <Item class="ReflectionMetadataClasses">
    <Item class="ReflectionMetadataClass">
      <Properties>
        <string name="Name">TestService</string>
        <string name="ClassCategory">Scripting</string>
        <string name="summary">Service summary</string>
      </Properties>
      <Item class="ReflectionMetadataFunctions">
        <Item class="ReflectionMetadataMember">
          <Properties>
            <string name="Name">RunTest</string>
            <string name="summary">Runs a test.</string>
          </Properties>
        </Item>
      </Item>
    </Item>
  </Item>
</roblox>`;

const parsedFixture = parseReflectionMetadata(fixture, {
  clientName: 'fixture',
  engineVersion: 'test-build',
});
assert.equal(parsedFixture.classCount, 1);
assert.equal(parsedFixture.memberCount, 1);
assert.deepEqual(parsedFixture.categories, ['Scripting']);
assert.deepEqual(parsedFixture.classes[0], {
  name: 'TestService',
  category: 'Scripting',
  summary: 'Service summary',
  members: [{ name: 'RunTest', kind: 'Functions', summary: 'Runs a test.' }],
});
assert.throws(() => parseReflectionMetadata('<not-xml>'), /Invalid engine reflection metadata/);

const releaseRoot = path.resolve(__dirname, '..');
const api = loadClientEngineApi(releaseRoot, 'CUSTOM-2021M');
assert.ok(api, 'selected 2021 client should have bundled reflection metadata');
assert.equal(api.clientName, 'CUSTOM-2021M');
assert.equal(api.engineVersion, '0.482.0.424268');
assert.equal(api.classCount, 262);
assert.ok(api.memberCount > 590, 'parsed reference should include the bundled class members');
const workspace = api.classes.find((item) => item.name === 'Workspace');
assert.ok(workspace, 'Workspace should be documented');
assert.ok(workspace.members.some((member) => member.name === 'FindPartOnRay'));
const bindableFunction = api.classes.find((item) => item.name === 'BindableFunction');
assert.ok(bindableFunction.members.some((member) => member.name === 'Invoke'));

ejs.renderFile(path.join(
  releaseRoot,
  'Webserver',
  'http-db-bridge',
  'views',
  'dev',
  'docs',
  'games.ejs',
), {
  title: 'Engine API test',
  themeClass: '',
  user: { robux: 0 },
  currency: { robux: 0 },
  engineApi: api,
}).then((rendered) => {
  assert.match(rendered, /CUSTOM-2021M · 0\.482\.0\.424268/);
  assert.match(rendered, /engine-api-search/);
  assert.match(rendered, /FindPartOnRay/);
  assert.match(rendered, /This bundled reflection metadata documents class names/);
  assert.doesNotMatch(rendered, /\/api\/v1\/games/);
  console.log(`ok: 2021 engine reference renders ${api.classCount} classes and ${api.memberCount} members`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
