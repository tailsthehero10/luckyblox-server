'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClientLaunchUri, createDevPlayLaunchUri } = require('../server/clientLaunchUri');
const { parseLaunchUri, parseArgs } = require('../tools/dev-launch');

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

const devPlayUri = createDevPlayLaunchUri({
  ticket: 'LB_ticket.signature+part',
  placeId: 1811,
  userId: 4,
  jobId: 'selected-job',
  baseUrl: 'https://games.example.test/path',
  gameMetadata: {
    placeId: 1811,
    title: 'Classic Crossroads',
    creatorName: 'Roblox Creator',
    creatorId: 42,
    universeId: 1811,
    creatorType: 'Group',
    thumbnailUrl: 'https://games.example.test/art/crossroads.png',
    iconUrl: 'https://games.example.test/art/crossroads-icon.png',
    description: 'A classic + fun place',
    genre: 'Adventure',
  },
  playerMetadata: {
    username: 'RealPlayer',
    displayName: 'Actual Player',
    membershipType: 'None',
    accountAge: 123,
  },
});
assert.match(devPlayUri, /^luckyblox-devplay:1\+placeId:1811\+userId:4/);
assert.match(devPlayUri, /\+gameinfo:LB_ticket\.signature%2Bpart\+jobId:selected-job/);
assert.match(devPlayUri, /\+gameTitle:Classic%20Crossroads\+gameOwner:Roblox%20Creator/);
assert.match(devPlayUri, /\+gameThumbnail:https%3A%2F%2Fgames\.example\.test%2Fart%2Fcrossroads\.png/);
assert.match(devPlayUri, /\+playerName:RealPlayer\+playerDisplayName:Actual%20Player\+playerMembership:None\+playerAccountAge:123/);
assert.deepEqual(parseLaunchUri(devPlayUri), {
  placeId: 1811,
  userId: 4,
  ticket: 'LB_ticket.signature+part',
  jobId: 'selected-job',
  url: 'https://games.example.test',
  gameMetadata: {
    title: 'Classic Crossroads',
    creatorName: 'Roblox Creator',
    creatorId: '42',
    universeId: '1811',
    creatorType: 'Group',
    thumbnailUrl: 'https://games.example.test/art/crossroads.png',
    iconUrl: 'https://games.example.test/art/crossroads-icon.png',
    description: 'A classic + fun place',
    genre: 'Adventure',
    placeId: 1811,
  },
  playerMetadata: {
    username: 'RealPlayer',
    displayName: 'Actual Player',
    membershipType: 'None',
    accountAge: 123,
  },
});
const devPlayArgs = parseArgs(['--launch-uri', devPlayUri]);
assert.equal(devPlayArgs.place, 1811, 'the game page place ID must override MapPath.txt');
assert.equal(devPlayArgs.userId, 4);
assert.equal(devPlayArgs.ticket, 'LB_ticket.signature+part');
assert.equal(devPlayArgs.jobId, 'selected-job');
assert.equal(devPlayArgs.url, 'https://games.example.test');
assert.deepEqual(devPlayArgs.gameMetadata, parseLaunchUri(devPlayUri).gameMetadata);
assert.deepEqual(devPlayArgs.playerMetadata, {
  username: 'RealPlayer',
  displayName: 'Actual Player',
  membershipType: 'None',
  accountAge: 123,
});

const server = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'server.js'), 'utf8');
assert.match(server, /launchURI:\s*ticket\.launchURI/);
assert.match(server, /devPlayURI:\s*createDevPlayLaunchUri/);
assert.match(server, /game:\s*gameMetadata/);
assert.match(server, /gameMetadata,\s*playerMetadata,\s*\}\)/);
assert.doesNotMatch(server, /launchURI:\s*playUrl/);
assert.match(server, /createDevPlayLaunchUri\(\{[\s\S]{0,180}ticket:\s*ticket\.ticket,[\s\S]{0,180}placeId,[\s\S]{0,180}userId,[\s\S]{0,180}jobId:\s*job\.jobId/);

const home = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'home.ejs'), 'utf8');
assert.match(home, /payload\.launchURI[\s\S]{0,180}luckyblox-player:/);
assert.match(home, /payload\.devPlayURI[\s\S]{0,100}luckyblox-devplay:/);
assert.doesNotMatch(home, /window\.location\.href\s*=\s*payload\.playUrl/);

const play = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'play.ejs'), 'utf8');
assert.match(play, /data\.devPlayURI[\s\S]{0,100}luckyblox-devplay:/);

const gameAbout = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'game-about.ejs'), 'utf8');
assert.match(gameAbout, /data\.launchURI[\s\S]{0,500}Open LuckyBlox/);
assert.match(gameAbout, /data\.client && data\.client\.supported === false/);
assert.match(gameAbout, /data\.devPlayURI[\s\S]{0,100}luckyblox-devplay:/);
assert.match(gameAbout, /Open this game in DEV-PLAY/);
assert.match(gameAbout, /lb-join-game-icon/);
assert.match(gameAbout, /lb-join-game-title/);
assert.match(gameAbout, /By <%= creatorName/);
assert.match(gameAbout, /new AbortController\(\)/);
assert.match(gameAbout, /controller\.abort\(\);\s*\}, 20000/);
assert.match(gameAbout, /spinner\.hidden = state !== 'working'/);
assert.match(gameAbout, /showJoinState\('manual', 'Continue in LuckyBlox'/);
assert.match(server, /function gameCreatorMetadata\(game\)/);
assert.match(server, /creatorName: creator\.creatorName/);
assert.match(server, /creatorId: creator\.creatorId/);
assert.match(server, /app\.get\('\/gameplayer\/:gamename'/);
assert.match(server, /function gamePlayerSlug\(value\)/);
assert.match(server, /res\.render\('gameplayer'/);
assert.ok(
  gameAbout.indexOf('data.client && data.client.supported === false')
    < gameAbout.indexOf("if (data.launchURI && /^luckyblox-player:/i.test(data.launchURI))"),
  'the public-host DEV-PLAY instructions must appear before the direct player handoff',
);
assert.ok(
  gameAbout.includes("Settings\\\\DEV-PLAY.bat --place "),
  'the public game page must show the clicked place ID in its local DEV-PLAY command',
);
assert.doesNotMatch(gameAbout, /window\.location\.href\s*=\s*data\.playUrl/);
assert.match(gameAbout, /href="\/gameplayer\/<%= gamePlayerSlug %>"/);
const playMarkup = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'play.ejs'), 'utf8');
assert.match(playMarkup, /roblox-eyebrow">Experience/);
assert.match(playMarkup, /By <strong><%= creatorName/);
assert.match(playMarkup, /controller\.abort\(\);\s*\}, 20000/);
const gamePlayer = fs.readFileSync(path.join(root, 'Webserver', 'http-db-bridge', 'views', 'gameplayer.ejs'), 'utf8');
assert.match(gamePlayer, /data-place-id="<%= placeId %>"/);
assert.match(gamePlayer, /fetch\('\/api\/launch-game'/);
assert.match(gamePlayer, /Open this game in DEV-PLAY/);
assert.match(gamePlayer, /luckyblox-player:/);
assert.match(gamePlayer, /luckyblox-devplay:/);

const installer = fs.readFileSync(path.join(root, 'tools', 'installer', 'LuckybloxInstaller.cs'), 'utf8');
const installerBuild = fs.readFileSync(path.join(root, 'tools', 'installer', 'build-installer.bat'), 'utf8');
const devLauncher = fs.readFileSync(path.join(root, 'tools', 'dev-launch.js'), 'utf8');
assert.match(server, /const authUrl = `\$\{publicOrigin\}\/v1\/authentication-ticket\/redeem`/);
assert.match(server, /developer: game\.developer \|\| creator\.creatorName/);
assert.match(server, /creatorId: creator\.creatorId/);
assert.match(server, /normalizeGameOwnership\(current\)/);
assert.match(server, /normalizePlaceOwnership\(places\)/);
assert.doesNotMatch(server, /const authUrl = `\$\{publicOrigin\}\/v1\/authentication-tickets\?/);
assert.match(devLauncher, /const authUrl = `\$\{args\.url\}\/v1\/authentication-ticket\/redeem`/);
assert.doesNotMatch(devLauncher, /const authUrl = `\$\{args\.url\}\/v1\/authentication-tickets\?/);
assert.match(installer, /string authUrl = baseUrl \+ "\/v1\/authentication-ticket\/redeem";/);
assert.doesNotMatch(installer, /string authUrl = baseUrl \+ "\/v1\/authentication-tickets/);
assert.match(installer, /Software\\Classes\\luckyblox-player/);
assert.match(installer, /command\.SetValue\("",.*\/Launch/);
assert.match(installer, /LaunchClientFromProtocolUri/);
assert.ok(installer.includes('Arguments = "-a " + QuoteArgument(authUrl)'));
assert.ok(installer.includes('+ " -t " + QuoteArgument(ticket)'));
assert.ok(installer.includes('+ " -j " + QuoteArgument(joinUrl)'));
assert.doesNotMatch(installer, /command\.SetValue\("",\s*"\"" \+ playerPath/);
assert.match(installer, /RegisterPlayerProtocol\(\s*Path\.Combine\(installedVersionDir/);
assert.match(installer, /TryGetValue\("baseUrl", out requestedBaseUrl\)/);
assert.match(installerBuild, /\/win32icon:"\.\.\\\.\.\\Webserver\\www\\site-icon\\luckyblox\.ico"/);
assert.match(installer, /Icon = System\.Drawing\.Icon\.ExtractAssociatedIcon\(Assembly\.GetExecutingAssembly\(\)\.Location\)/);
assert.match(installer, /icon\.SetValue\("", "\\\"" \+ handlerPath \+ "\\\",0"\)/);

console.log('Website join handoff keeps the game page and sends launch tickets to the LuckyBlox player protocol.');
