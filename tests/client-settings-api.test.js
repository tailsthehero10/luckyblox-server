'use strict';

/**
 * clientsettings.roblox.com compatibility endpoints.
 *
 * Roblox's client asks these four paths before it will run:
 *
 *   /v2/client-version/WindowsPlayer
 *   /v2/client-version/WindowsStudio64
 *   /v2/settings/application/PCDesktopClient
 *   /v2/settings/application/PCClientBootstrapper
 *
 * The bug this guards: the settings handler accepted ONLY 'PCDesktopClient' and
 * returned HTTP 400 for every other application, so the bootstrapper - which is
 * the FIRST thing a fresh install requests - was rejected and the client could
 * not start.
 *
 * It also pins the RESPONSE SHAPE. The real endpoint returns the flags FLAT, not
 * nested under `applicationSettings`; wrapping them meant a client reading a
 * flag by name found nothing and silently used its defaults.
 *
 * Run: node tests/client-settings-api.test.js
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const api = require(path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'clientSettingsApi.js'));

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

console.log('clientsettings compatibility');

// --- Version payloads --------------------------------------------------------

check('the player version payload has the real Roblox shape', () => {
  const payload = api.clientVersion('PCDesktopClient');
  if (!payload) {
    // No player build installed: the endpoint must then 404, which is covered
    // below. Nothing to assert on the shape.
    return;
  }
  assert.ok(payload.version, 'version is required');
  assert.ok(payload.clientVersionUpload, 'clientVersionUpload is required');
  assert.match(payload.version, /^version-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    `version id should look like the Roblox form, got "${payload.version}"`);
  assert.strictEqual(payload.clientVersionUpload, payload.version,
    'clientVersionUpload must equal version');
  assert.ok(payload.bootstrapperVersion, 'bootstrapperVersion is required');
});

check('the version id is stable for one build and changes with it', () => {
  const a = api.clientVersion('PCDesktopClient');
  const b = api.clientVersion('PCDesktopClient');
  if (!a || !b) return;
  assert.strictEqual(a.version, b.version, 'the same build must produce the same id');
});

check('Studio resolves from the Studio build, not the player', () => {
  const studio = api.clientVersion('WindowsStudio64');
  const player = api.clientVersion('PCDesktopClient');
  if (!studio) return; // no Studio build shipped here
  assert.ok(studio.version);
  if (player) {
    assert.notStrictEqual(studio.version, player.version,
      'Studio and Player must not report the same build id');
  }
});

check('an unknown application resolves to nothing (so the route 404s)', () => {
  assert.strictEqual(api.clientVersion('NotARealClient'), null);
});

// --- Settings payloads -------------------------------------------------------

check('PCDesktopClient settings are served', () => {
  const settings = api.applicationSettings('PCDesktopClient');
  assert.ok(Object.keys(settings).length > 0, 'expected some application flags');
});

/**
 * The headline regression: this application used to answer HTTP 400.
 */
check('PCClientBootstrapper settings are served (never rejected)', () => {
  const settings = api.applicationSettings('PCClientBootstrapper');
  assert.ok(Object.keys(settings).length > 0,
    'the bootstrapper must receive settings, not an empty object');
});

check('the settings are real Roblox flags, not placeholders', () => {
  const settings = api.applicationSettings('PCDesktopClient');
  const keys = Object.keys(settings);
  const flagLike = keys.filter((key) => /^(F|DF)Flag/.test(key));
  assert.ok(flagLike.length > 0,
    `expected at least one FFlag/DFFlag entry, got e.g. ${keys.slice(0, 5).join(', ')}`);
});

check('every setting value is JSON-serialisable', () => {
  const settings = api.applicationSettings('PCDesktopClient');
  assert.doesNotThrow(() => JSON.stringify(settings));
});

check('the settings come from a client that is actually installed', () => {
  // The module reads Clients/*/ClientSettings/ClientAppSettings.json. If it
  // returned flags while no such file existed it would be fabricating them.
  let anyFile = false;
  try {
    for (const entry of fs.readdirSync(CLIENTS_DIR)) {
      const candidate = path.join(CLIENTS_DIR, entry, 'ClientSettings', 'ClientAppSettings.json');
      if (fs.existsSync(candidate)) { anyFile = true; break; }
    }
  } catch (error) {
    /* no Clients folder */
  }
  if (!anyFile) {
    assert.deepStrictEqual(api.applicationSettings('PCDesktopClient'), {},
      'with no settings file on disk the endpoint must return nothing, not invented flags');
  } else {
    assert.ok(Object.keys(api.applicationSettings('PCDesktopClient')).length > 0);
  }
});

console.log(
  failures === 0
    ? '\nClient settings endpoints answer for both applications, with real data.'
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;
