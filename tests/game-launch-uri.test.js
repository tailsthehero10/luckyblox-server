'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClientLaunchUri } = require('../server/clientLaunchUri');

const root = path.resolve(__dirname, '..');

const uri = createClientLaunchUri({
  ticket: 'LB_ticket.signature+part',
  placeId: 27013,
  port: 53644,
  jobId: 'test-job:unsafe',
});

assert.match(uri, /^luckyblox-player:1\+launchmode:play/);
assert.match(uri, /\+gameinfo:LB_ticket\.signature%2Bpart/);
assert.match(uri, /\+placeId:27013\+serverPort:53644\+jobId:test-jobunsafe$/);
assert.throws(
  () => createClientLaunchUri({ ticket: '', placeId: 27013, port: 53644, jobId: 'x' }),
  /launch ticket and valid place ID/,
);
assert.throws(
  () => createClientLaunchUri({ ticket: 'ticket', placeId: 0, port: 53644, jobId: 'x' }),
  /launch ticket and valid place ID/,
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
assert.match(installer, /command\.SetValue\("",.*%1/);
assert.match(installer, /RegisterPlayerProtocol\(Path\.Combine\(installedVersionDir/);

console.log('Website join handoff keeps the game page and sends launch tickets to the LuckyBlox player protocol.');
