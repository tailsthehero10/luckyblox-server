'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('../Webserver/http-db-bridge/node_modules/ejs');
const {
  loadClientEngineApi,
  parseApiDump,
  parseReflectionMetadata,
} = require('../Webserver/http-db-bridge/engineApiReference');

const apiDumpFixture = {
  Classes: [{
    Name: 'TestService',
    Superclass: 'Instance',
    Tags: ['NotCreatable'],
    Members: [{
      MemberType: 'Function',
      Name: 'RunTest',
      Parameters: [
        { Name: 'value', Type: { Category: 'Primitive', Name: 'string' } },
        { Name: 'enabled', Type: { Category: 'Primitive', Name: 'bool' }, Default: 'false' },
      ],
      ReturnType: { Category: 'Primitive', Name: 'bool' },
      Security: 'None',
      Tags: ['Deprecated'],
      ThreadSafety: 'Unsafe',
    }, {
      MemberType: 'Property',
      Name: 'Enabled',
      ValueType: { Category: 'Primitive', Name: 'bool' },
      Security: { Read: 'None', Write: 'PluginSecurity' },
    }],
  }],
  Enums: [{
    Name: 'TestMode',
    Items: [{ Name: 'Off', Value: 0 }, { Name: 'On', Value: 1 }],
  }],
  Version: 1,
};

const parsedDump = parseApiDump(apiDumpFixture, {
  clientName: 'fixture',
  engineVersion: 'test-build',
});
assert.equal(parsedDump.classCount, 1);
assert.equal(parsedDump.memberCount, 2);
assert.equal(parsedDump.enumCount, 1);
assert.deepEqual(parsedDump.classes[0].members.find((member) => member.name === 'RunTest'), {
  name: 'RunTest',
  kind: 'Function',
  signature: '(value: string, enabled: bool = false): bool',
  category: '',
  tags: ['Deprecated'],
  security: 'None',
  threadSafety: 'Unsafe',
});
assert.equal(
  parsedDump.classes[0].members.find((member) => member.name === 'Enabled').security,
  'Read: None, Write: PluginSecurity',
);
assert.deepEqual(parsedDump.enums[0].items[1], { name: 'On', value: 1, tags: [] });
assert.throws(() => parseApiDump({ Classes: [] }), /class and enum arrays/);

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
assert.deepEqual(parsedFixture.categories, ['Classes only', 'Enums only']);
assert.deepEqual(parsedFixture.classes[0], {
  name: 'TestService',
  category: 'Scripting',
  summary: 'Service summary',
  superclass: '',
  tags: [],
  members: [{
    name: 'RunTest',
    kind: 'Functions',
    summary: 'Runs a test.',
    signature: '',
    category: '',
    tags: [],
    security: '',
    threadSafety: '',
  }],
});
assert.throws(() => parseReflectionMetadata('<not-xml>'), /Invalid engine reflection metadata/);

const releaseRoot = path.resolve(__dirname, '..');
const api = loadClientEngineApi(releaseRoot, 'CUSTOM-2021M');
assert.ok(api, 'selected 2021 client should have an archived API dump');
assert.equal(api.clientName, 'CUSTOM-2021M');
assert.equal(api.engineVersion, '0.482.0.424268');
assert.equal(api.sourceDate, '2021-06-07');
assert.equal(api.classCount, 489);
assert.equal(api.memberCount, 3417);
assert.equal(api.enumCount, 250);
const workspace = api.classes.find((item) => item.name === 'Workspace');
assert.ok(workspace, 'Workspace should be documented');
assert.equal(workspace.superclass, 'WorldRoot');
const raycast = api.classes.find((item) => item.name === 'WorldRoot')
  .members.find((member) => member.name === 'FindPartOnRay');
assert.equal(raycast.signature, '(ray: Ray, ignoreDescendantsInstance: Instance = nil, terrainCellsAreCubes: bool = false, ignoreWater: bool = false): Tuple');
assert.deepEqual(raycast.tags, ['Deprecated']);
assert.equal(raycast.security, 'None');
assert.ok(api.enums.find((item) => item.name === 'Material'));

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
}).then(async (rendered) => {
  assert.match(rendered, /CUSTOM-2021M · 0\.482\.0\.424268/);
  assert.match(rendered, /engine-api-search/);
  assert.match(rendered, /FindPartOnRay\(ray: Ray/);
  assert.match(rendered, /engine-api\/0\.482\.0\.424268\.json/);
  assert.match(rendered, /Material/);
  assert.match(rendered, /Thread safety:/);
  assert.match(rendered, /archived 2021-06-07 for this exact engine build/);
  assert.doesNotMatch(rendered, /\/api\/v1\/games/);
  const fallbackHtml = await ejs.renderFile(path.join(
    releaseRoot,
    'Webserver',
    'http-db-bridge',
    'views',
    'dev',
    'docs',
    'games.ejs',
  ), {
    title: 'Reflection fallback test',
    themeClass: '',
    user: { robux: 0 },
    currency: { robux: 0 },
    engineApi: parsedFixture,
  });
  assert.match(fallbackHtml, /This reflection metadata has fewer details than a full API dump/);
  assert.match(fallbackHtml, /TestService/);
  console.log(`ok: exact 2021 engine dump renders ${api.classCount} classes, ${api.memberCount} members, and ${api.enumCount} enums`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
