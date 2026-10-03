'use strict';

/**
 * Proves the client DOWNLOAD endpoints publish the right build.
 *
 * The bug this guards: `resolveSourceDir()` scanned `Clients/` and took the
 * first folder that happened to contain a RobloxPlayerBeta.exe. Directory names
 * sort alphabetically, so `2013L` won over `2021M` and /download/client/binary
 * served an 11 MB 2013 build to every user - with a 200, no error, and no sign
 * anywhere that it was the wrong client. The build was on disk the whole time.
 *
 * It also pins the player/studio split: `Clients/2022M` holds RobloxStudioBeta.exe
 * and must never be served as the downloadable PLAYER.
 *
 * Run: node tests/client-download-build.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// A real environment variable outranks anything, but these must not leak in from
// the shell and redirect the resolver at a folder the test is not asserting on.
delete process.env.LUCKYBLOX_CLIENT_PATH;
delete process.env.LUCKYBLOX_CLIENT_ROOT;

const clientBuildInfo = require(path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'clientBuildInfo.js'));
const clientLauncher = require(path.join(PROJECT_ROOT, 'server', 'clientLauncher.js'));

const CLIENTS_DIR = path.join(PROJECT_ROOT, 'Clients');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log('client download build');

const info = clientBuildInfo.getClientBuildInfo();

check('the bundled player folder exists', () => {
  assert.ok(
    fs.existsSync(path.join(CLIENTS_DIR, '2021M')),
    'Clients/2021M should exist in the release',
  );
});

check('a build is published (available: true)', () => {
  assert.strictEqual(info.available, true, `expected a published build, got ${JSON.stringify(info)}`);
});

/**
 * The headline assertion. If the resolver ever regresses to picking whichever
 * folder sorts first, this fails and says exactly which wrong client it chose.
 */
check('the published build is 2021M, not an alphabetically earlier client', () => {
  const resolved = path.resolve(String(info.sourceDir || ''));
  const expected = path.resolve(CLIENTS_DIR, '2021M');
  assert.strictEqual(
    resolved,
    expected,
    `expected the 2021M player build (${expected}), got ${resolved}`,
  );
});

check('the served binary is the 2021M RobloxPlayerBeta.exe', () => {
  assert.ok(info.sourceBinary, 'sourceBinary should be set');
  assert.strictEqual(
    path.resolve(info.sourceBinary),
    path.resolve(CLIENTS_DIR, '2021M', 'RobloxPlayerBeta.exe'),
  );
  assert.ok(fs.existsSync(info.sourceBinary), 'the advertised binary must exist on disk');
});

check('the advertised size is the real, non-zero size of that binary', () => {
  const realSize = fs.statSync(info.sourceBinary).size;
  assert.strictEqual(info.binarySize, realSize, 'binarySize must match the file on disk');
  assert.ok(realSize > 0, 'a published build must not report 0 bytes');
});

/**
 * The player resolver must never publish the Studio editor as a player - they
 * are different products with different binaries in different folders.
 */
check('2022M (Studio) is never served as the player', () => {
  const resolved = path.resolve(String(info.sourceDir || ''));
  assert.ok(
    !resolved.toLowerCase().includes('2022m'),
    `the player endpoint resolved to the Studio folder: ${resolved}`,
  );
  assert.ok(
    !/RobloxStudioBeta/i.test(String(info.sourceBinary || '')),
    `the player endpoint resolved to a Studio binary: ${info.sourceBinary}`,
  );
});

check('the resolved binary is named RobloxPlayerBeta, not a Studio binary', () => {
  assert.strictEqual(path.basename(info.sourceBinary), clientBuildInfo.INSTALL_FOLDER_NAME ? 'RobloxPlayerBeta.exe' : '');
});

check('buildId and version are populated for the installer', () => {
  assert.ok(info.buildId, 'buildId must be set so an installer can compare builds');
  assert.ok(info.version, 'version must be set so the download path is meaningful');
});

/**
 * The CUSTOM-2021M repackage keeps its binary under Player/. The resolver has to
 * look there too, or a release shipping only that layout reports no build at all.
 */
check('a Player/-nested binary is found', () => {
  const resolveBinaryIn = clientBuildInfo.resolveBinaryIn;
  assert.strictEqual(typeof resolveBinaryIn, 'function', 'resolveBinaryIn should be exported');

  const tmp = path.join(PROJECT_ROOT, '.tmp', `player-layout-${process.pid}`);
  const playerDir = path.join(tmp, 'Player');
  try {
    fs.mkdirSync(playerDir, { recursive: true });
    fs.writeFileSync(path.join(playerDir, 'RobloxPlayerBeta.exe'), 'stub');
    const found = resolveBinaryIn(tmp);
    assert.ok(found, 'a binary under Player/ must be resolved');
    assert.strictEqual(path.resolve(found), path.resolve(playerDir, 'RobloxPlayerBeta.exe'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** The launcher and the download manifest must agree on which client ships. */
check('the launcher and the download manifest agree on the install', () => {
  const status = clientLauncher.getClientStatus(true);
  assert.strictEqual(status.installed, true, 'the client should be reported installed');
  assert.ok(status.executablePath, 'the launcher should resolve an executable path');
  assert.ok(
    status.executablePath.toLowerCase().endsWith('robloxplayerbeta.exe'),
    `the launcher resolved ${status.executablePath}, which is not a player binary`,
  );
});

console.log(
  failures === 0
    ? '\nThe download endpoints publish the 2021M player build, not another client.'
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;
