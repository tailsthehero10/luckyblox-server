'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClientLaunchUri } = require('../server/clientLaunchUri');

const root = path.resolve(__dirname, '..');

const uri = createClientLaunchUri({
  ticket: 'LB_ticket.signature+part',
  placeId: 27013,
  userId: 42,
  port: 53644,
  jobId: 'test-job:unsafe',
  baseUrl: 'https://games.example.test/path',
});

assert.match(uri, /^luckyblox-player:1\+launchmode:play/);
assert.match(uri, /\+gameinfo:LB_ticket\.signature%2Bpart/);
assert.match(uri, /\+placeId:27013\+userId:42\+serverPort:53644\+jobId:test-jobunsafe\+baseUrl:https%3A%2F%2Fgames\.example\.test$/);
assert.throws(
  () => createClientLaunchUri({ ticket: '', placeId: 27013, userId: 42, port: 53644, jobId: 'x', baseUrl: 'https://example.test' }),
  /valid place ID, valid user ID, and server URL/,
);
assert.throws(
  () => createClientLaunchUri({ ticket: 'ticket', placeId: 0, userId: 42, port: 53644, jobId: 'x', baseUrl: 'https://example.test' }),
  /valid place ID, valid user ID, and server URL/,
);

const server = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'server.js'), 'utf8');
assert.match(server, /launchURI:\s*ticket\.launchURI/);
assert.doesNotMatch(server, /launchURI:\s*playUrl/);

const home = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'home.ejs'), 'utf8');
assert.match(home, /payload\.launchURI[\s\S]{0,180}luckyblox-player:/);
assert.doesNotMatch(home, /window\.location\.href\s*=\s*payload\.playUrl/);

const gameAbout = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'game-about.ejs'), 'utf8');
assert.match(gameAbout, /data\.launchURI[\s\S]{0,500}Open LuckyBlox/);
assert.doesNotMatch(gameAbout, /window\.location\.href\s*=\s*data\.playUrl/);

const installer = fs.readFileSync(path.join(root, 'tools', 'installer', 'LuckybloxInstaller.cs'), 'utf8');
assert.match(installer, /Software\\Classes\\luckyblox-player/);
assert.match(installer, /command\.SetValue\("",.*\/Launch/);
assert.match(installer, /LaunchClientFromProtocolUri/);
assert.ok(installer.includes('Arguments = "-a " + QuoteArgument(authUrl)'));
assert.ok(installer.includes('+ " -t " + QuoteArgument(ticket)'));
assert.ok(installer.includes('+ " -j " + QuoteArgument(joinUrl)'));
assert.doesNotMatch(installer, /command\.SetValue\("",\s*"\"" \+ playerPath/);
assert.match(installer, /RegisterPlayerProtocol\(\s*Path\.Combine\(installedVersionDir/);
assert.match(installer, /TryGetValue\("baseUrl", out requestedBaseUrl\)/);

console.log('Website join handoff keeps the game page and sends launch tickets to the LuckyBlox player protocol.');
