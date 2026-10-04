'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {
  createDevHttpServer,
  createLocalServerConfig,
  prepareServerRuntime,
  parseArgs,
  prepareDevClient,
  readSelectedClient,
  resolveGameMetadata,
  resolveDefaultPlace,
  resolveServerBinary,
  resolveClientDir,
  verifyTicketRedemptionRoute,
} = require('../tools/dev-launch');

const releaseRoot = path.resolve(__dirname, '..');
const selectedFile = path.join(releaseRoot, 'Settings', 'SelectedClient.txt');
const selected = fs.readFileSync(selectedFile, 'utf8').replace(/^\uFEFF/, '').trim();

assert.equal(readSelectedClient(), selected, 'DEV-PLAY should follow SelectedClient.txt');
const savedClientOverride = process.env.LUCKYBLOX_DEV_CLIENT;
const savedPlaceOverride = process.env.LUCKYBLOX_DEV_PLACE;
delete process.env.LUCKYBLOX_DEV_CLIENT;
delete process.env.LUCKYBLOX_DEV_PLACE;
try {
  assert.equal(parseArgs([]).client, selected, 'the CLI default should use the selected client');
} finally {
  if (savedClientOverride !== undefined) process.env.LUCKYBLOX_DEV_CLIENT = savedClientOverride;
  if (savedPlaceOverride !== undefined) process.env.LUCKYBLOX_DEV_PLACE = savedPlaceOverride;
}
const selectedClientDir = resolveClientDir(selected);
assert.equal(
  selectedClientDir,
  fs.existsSync(path.join(releaseRoot, 'Clients', selected, 'Player', 'RobloxPlayerBeta.exe'))
    ? path.join(releaseRoot, 'Clients', selected, 'Player')
    : path.join(releaseRoot, 'Clients', selected),
  'the selected client resolves in either supported root or Player/ layout',
);
assert.ok(
  fs.existsSync(path.join(resolveClientDir(selected), 'RobloxPlayerBeta.exe')),
  'the selected client binary should exist',
);
const localSelectedPlace = resolveDefaultPlace();
assert.ok(localSelectedPlace, 'the selected MapPath should resolve to a local published place');
const recoveredMetadata = resolveGameMetadata(
  { title: '2008 - ROBLOX World Headquarters', creatorName: 'LuckyBlox Studio', creatorId: 999 },
  1806,
  'selected map',
  [{
    placeId: 1806,
    title: '2008 - ROBLOX World Headquarters',
    developer: 'LuckyBlox Studio',
    author: 'tailsthehero10',
    authorId: 1,
    creatorName: 'tailsthehero10',
    creatorId: 1,
    creatorType: 'User',
  }],
);
assert.equal(
  recoveredMetadata.creatorName,
  'tailsthehero10',
  'the games.json account owner should override the studio developer label in a handoff',
);
assert.equal(recoveredMetadata.creatorId, 1, 'the games.json owner ID should override a stale handoff ID');
assert.equal(recoveredMetadata.creatorType, 'User');
const savedPlaceForDefault = process.env.LUCKYBLOX_DEV_PLACE;
delete process.env.LUCKYBLOX_DEV_PLACE;
try {
  assert.equal(parseArgs([]).place, localSelectedPlace.placeId, 'the default place must come from the selected local map');
} finally {
  if (savedPlaceForDefault !== undefined) process.env.LUCKYBLOX_DEV_PLACE = savedPlaceForDefault;
}
assert.ok(
  fs.existsSync(resolveServerBinary(selected)),
  'DEV-PLAY should use a bundled, client-matched shared local-test executable',
);
assert.equal(
  parseArgs(['--place', String(localSelectedPlace.placeId)]).mapPath,
  localSelectedPlace.mapPath,
  'an explicit matching place uses its real local map',
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-dev-launch-'));
const invalidSelection = path.join(tempDir, 'SelectedClient.txt');
try {
  fs.writeFileSync(invalidSelection, '..\\Windows\\System32');
  assert.equal(readSelectedClient(invalidSelection), '2021M', 'invalid paths must not become client names');

  const selectedMap = path.join(tempDir, '2015 - A Real Test Map 1.6.5.rbxl');
  const settingsDir = path.join(tempDir, 'Settings');
  fs.mkdirSync(settingsDir);
  fs.writeFileSync(selectedMap, 'real local place bytes');
  fs.writeFileSync(path.join(settingsDir, 'MapPath.txt'), selectedMap);
  const resolved = resolveDefaultPlace(settingsDir, [{
    placeId: 27013,
    title: '2015 - A Real Test Map 1.6.5',
  }]);
  assert.equal(resolved.placeId, 27013, 'place resolution uses the game catalog ID, not the year in the filename');
  assert.equal(resolved.mapPath, selectedMap);

  const template = path.join(tempDir, 'server-template.json');
  const output = path.join(tempDir, 'server-generated.json');
  fs.writeFileSync(template, JSON.stringify({ GameId: 88, Settings: { PlaceId: 1818, UniverseId: 88 } }));
  createLocalServerConfig(template, output, {
    placeId: 27013,
    mapUrl: 'http://127.0.0.1:40000/asset/?id=27013',
    baseUrl: 'https://luckyblox-server.onrender.com',
    jobId: 'test-job',
    port: 53644,
    gameMetadata: {
      title: 'A Real Test Map',
      universeId: 27014,
      creatorId: 42,
      creatorType: 'Group',
    },
  });
  const generated = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(generated.GameId, 27014, 'the RCC config must not keep the template universe id');
  assert.equal(generated.Settings.PlaceId, 27013);
  assert.equal(generated.Settings.UniverseId, 27014);
  assert.equal(generated.Settings.GameId, 'A Real Test Map');
  assert.equal(generated.Settings.CreatorId, 42);
  assert.equal(generated.Settings.CreatorType, 'Group');
  assert.equal(generated.Settings.PlaceFetchUrl, 'http://127.0.0.1:40000/asset/?id=27013');
  assert.equal(generated.Settings.PreferredPort, 53644);

  const rccSource = path.join(tempDir, 'rcc-source');
  const rccRuntime = path.join(tempDir, 'rcc-runtime');
  fs.mkdirSync(path.join(rccSource, 'content', 'avatar'), { recursive: true });
  fs.mkdirSync(path.join(rccSource, 'ssl'), { recursive: true });
  fs.writeFileSync(path.join(rccSource, 'content', 'avatar', 'fixture.txt'), 'fixture content');
  fs.writeFileSync(path.join(rccSource, 'AppSettings.xml'),
    '<Settings><BaseUrl>http://localhost/LuckBlox.site.tk/</BaseUrl><ContentFolder>content</ContentFolder></Settings>');
  fs.writeFileSync(path.join(rccSource, '21ESettings.xml'),
    '<Settings><BaseUrl>http://localhost/LuckBlox.site.tk/</BaseUrl></Settings>');
  fs.writeFileSync(path.join(rccSource, 'DevSettingsFile.json'), '{"applicationSettings":{}}');
  fs.writeFileSync(path.join(rccSource, 'CUSTOM-2021M.exe'), 'RCC binary fixture');
  fs.writeFileSync(path.join(rccSource, 'ssl', 'certificate.pem'), 'certificate fixture');
  const runtime = prepareServerRuntime(
    rccSource,
    rccRuntime,
    path.join(rccSource, 'CUSTOM-2021M.exe'),
    'CUSTOM-2021M',
    'https://example.test',
  );
  const stagedAppSettings = fs.readFileSync(path.join(rccRuntime, 'AppSettings.xml'), 'utf8');
  assert.match(stagedAppSettings, /https:\/\/example\.test\/LuckBlox\.site\.tk\/home\//);
  assert.ok(stagedAppSettings.includes(path.join(rccSource, 'content')));
  const stagedServerSettings = fs.readFileSync(path.join(rccRuntime, '21ESettings.xml'), 'utf8');
  assert.match(stagedServerSettings, /https:\/\/example\.test\/LuckBlox\.site\.tk\/home\//);
  assert.ok(stagedServerSettings.includes(path.join(rccSource, 'content')));
  assert.doesNotMatch(stagedServerSettings, /http:\/\/localhost/);
  assert.equal(runtime.settingsPath, path.join(rccRuntime, 'DevSettingsFile.json'));
  assert.ok(fs.existsSync(runtime.binary), 'RCC must run from the isolated per-launch runtime');
  assert.ok(fs.existsSync(path.join(rccRuntime, 'ssl', 'certificate.pem')));
  assert.equal(fs.readFileSync(path.join(rccRuntime, 'Content', 'avatar', 'fixture.txt'), 'utf8'), 'fixture content');
  assert.equal(fs.lstatSync(path.join(rccRuntime, 'Content')).isSymbolicLink(), false);
  assert.match(
    fs.readFileSync(path.join(rccSource, 'AppSettings.xml'), 'utf8'),
    /http:\/\/localhost\/LuckBlox\.site\.tk\//,
    'staging must not rewrite the shared RCC template',
  );

  const isolatedClient = path.join(tempDir, 'client');
  fs.mkdirSync(path.join(isolatedClient, 'ssl'), { recursive: true });
  fs.writeFileSync(path.join(isolatedClient, 'RobloxPlayerBeta.exe'), 'player executable');
  fs.writeFileSync(path.join(isolatedClient, 'AppSettings.xml'), '<Settings><BaseUrl>localhost</BaseUrl></Settings>');
  fs.writeFileSync(path.join(isolatedClient, 'ssl', 'certificate.pem'), 'ssl fixture');
  const prepared = prepareDevClient(isolatedClient, '2021M', 'https://example.test', `test-${process.pid}`);
  assert.match(fs.readFileSync(path.join(prepared.runDir, 'AppSettings.xml'), 'utf8'), /https:\/\/example\.test\/LuckBlox\.site\.tk\/home\//);
  assert.equal(
    fs.readFileSync(path.join(isolatedClient, 'AppSettings.xml'), 'utf8'),
    '<Settings><BaseUrl>localhost</BaseUrl></Settings>',
    'DEV-PLAY must not rewrite the selected client in place',
  );
  fs.rmSync(prepared.runDir, { recursive: true, force: true });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('ok: DEV-PLAY resolves the selected map/place, prepares local-test settings, and isolates the client config');

(async () => {
  let authStatus = 401;
  const authServer = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/authentication-ticket/redeem');
    res.writeHead(authStatus);
    res.end();
  });
  await new Promise((resolve, reject) => {
    authServer.once('error', reject);
    authServer.listen(0, '127.0.0.1', resolve);
  });
  try {
    const authUrl = `http://127.0.0.1:${authServer.address().port}`;
    await verifyTicketRedemptionRoute(authUrl);
    authStatus = 404;
    await assert.rejects(
      verifyTicketRedemptionRoute(authUrl),
      /ticket-redemption endpoint returned HTTP 404/,
      'DEV-PLAY must detect when the live deployment has not received the required route',
    );
  } finally {
    await new Promise((resolve, reject) => {
      authServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const mapPath = path.join(os.tmpdir(), `lb-dev-place-${process.pid}.rbxl`);
  fs.writeFileSync(mapPath, Buffer.from('actual map fixture'));
  const local = await createDevHttpServer({
    placeId: 27013,
    mapPath,
    userId: 42,
    ticket: 'test-ticket',
    jobId: 'test-job',
    gamePort: 53644,
    baseUrl: 'https://example.test',
    gameMetadata: {
      placeId: 27013,
      title: 'A Real Test Map',
      creatorName: 'LuckyBlox Test Owner',
      creatorId: 42,
      thumbnailUrl: 'https://example.test/art/test-map.png',
      iconUrl: 'https://example.test/art/test-icon.png',
      description: 'Test experience metadata',
      genre: 'Adventure',
    },
  });
  try {
    const health = await fetch(local.baseUrl);
    assert.equal(health.status, 200, 'opening the advertised local API URL should show it is running');
    const healthPayload = await health.json();
    assert.equal(healthPayload.ok, true);
    assert.equal(healthPayload.placeId, 27013);
    assert.equal(healthPayload.game.title, 'A Real Test Map');
    assert.equal(healthPayload.game.creatorName, 'LuckyBlox Test Owner');
    assert.match(healthPayload.endpoints.map, /id=27013/);
    assert.equal(healthPayload.endpoints.game, '/api/game');

    const gameInfoResponse = await fetch(`${local.baseUrl}/api/game`);
    assert.equal(gameInfoResponse.status, 200);
    const gameInfo = await gameInfoResponse.json();
    assert.equal(gameInfo.jobId, 'test-job');
    assert.equal(gameInfo.game.thumbnailUrl, 'https://example.test/art/test-map.png');
    assert.equal(gameInfo.game.iconUrl, 'https://example.test/art/test-icon.png');

    const asset = await fetch(`${local.baseUrl}/asset/?id=27013`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'actual map fixture');
    const missing = await fetch(`${local.baseUrl}/asset/?id=1818`);
    assert.equal(missing.status, 404, 'the local asset endpoint must not return a different map');
    const join = await fetch(
      `${local.baseUrl}/game/join?placeId=27013&userId=42&ticket=test-ticket`,
    );
    const payload = await join.json();
    assert.equal(payload.placeId, 27013);
    assert.equal(payload.userId, 42);
    assert.equal(payload.port, 53644, 'the client is directed to the local server port');
    assert.equal(payload.jobId, 'test-job');
    assert.equal(
      payload.authenticationUrl,
      'https://example.test/v1/authentication-ticket/redeem',
      'the join response must advertise the endpoint that redeems the player ticket and sets its cookie',
    );
    assert.equal(payload.game.title, 'A Real Test Map');
    assert.equal(payload.game.creatorName, 'LuckyBlox Test Owner');
    assert.equal(payload.game.thumbnailUrl, 'https://example.test/art/test-map.png');
    const wrongJoinPlace = await fetch(
      `${local.baseUrl}/game/join?placeId=1811&userId=42&ticket=test-ticket`,
    );
    assert.equal(wrongJoinPlace.status, 404, 'join must not silently return the selected map for another place');
  } finally {
    await local.close();
    fs.rmSync(mapPath, { force: true });
  }
  console.log('ok: DEV-PLAY local endpoints serve the selected map and advertise the local join port');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
