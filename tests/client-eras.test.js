'use strict';

/**
 * Proves the "client year" feature is wired end to end.
 *
 * The feature: a game is playable only on a client whose build understands it, so
 * every game carries a Year, the creator can change it, and it is shown on the
 * game page, the profile statistics and the game cards.
 *
 * The trap this guards: the year list must come from the client builds ACTUALLY
 * ON DISK. `Clients/` also holds `2022M` (the Studio editor), `2021E` (a server)
 * and several empty stubs; offering any of those as a playable "year" would
 * promise a user a client that cannot run a game.
 *
 * Run: node tests/client-eras.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const clientEras = require(path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'clientEras.js'));

const CLIENTS_DIR = path.join(PROJECT_ROOT, 'Clients');
const GAME_CARD = path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'views', 'partials', 'game-card.ejs');
const SETTINGS_VIEW = path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'views', 'dev', 'settings.ejs');
const GAME_VIEW = path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'views', 'game-about.ejs');
const PROFILE_VIEW = path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'views', 'profile.ejs');
const SERVER_JS = path.join(PROJECT_ROOT, 'Webserver', 'http-db-bridge', 'server.js');

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

console.log('client eras (Year)');

// --- Era detection -----------------------------------------------------------

check('the year is read from a client folder name', () => {
  assert.strictEqual(clientEras.yearFromClientName('2013L'), 2013);
  assert.strictEqual(clientEras.yearFromClientName('2014M'), 2014);
  assert.strictEqual(clientEras.yearFromClientName('CUSTOM-2021M'), 2021);
  assert.strictEqual(clientEras.yearFromClientName('2018E'), 2018);
});

check('a folder with no year in its name yields null, not a guess', () => {
  assert.strictEqual(clientEras.yearFromClientName('Player'), null);
  assert.strictEqual(clientEras.yearFromClientName(''), null);
  assert.strictEqual(clientEras.yearFromClientName('v2_013'), null);
});

check('the era list is non-empty and every year is real', () => {
  const years = clientEras.listClientYears();
  assert.ok(years.length > 0, 'expected at least one playable client on disk');
  for (const y of years) {
    assert.ok(Number.isSafeInteger(y) && y >= 2000 && y <= 2100, `implausible year ${y}`);
  }
});

check('every listed era has a player binary behind it', () => {
  for (const era of clientEras.listClientEras()) {
    assert.ok(era.clients.length > 0, `era ${era.year} lists no client folder`);
    for (const name of era.clients) {
      const dir = path.join(CLIENTS_DIR, name);
      assert.ok(
        clientEras.hasPlayerBinary(dir),
        `${name} is listed as era ${era.year} but has no player binary`,
      );
    }
  }
});

/**
 * The exclusions matter most: these folders exist on disk and must never be
 * offered as a playable year.
 */
check('the Studio folder is not offered as a player year', () => {
  const studioDir = path.join(CLIENTS_DIR, '2022M');
  if (!fs.existsSync(studioDir)) return; // not shipped here
  assert.strictEqual(
    clientEras.hasPlayerBinary(studioDir),
    false,
    'Clients/2022M holds the Studio editor and must not count as a player',
  );
  for (const era of clientEras.listClientEras()) {
    assert.ok(
      !era.clients.includes('2022M'),
      '2022M (Studio) leaked into the playable era list',
    );
  }
});

check('the server folder is not offered as a player year', () => {
  const serverDir = path.join(CLIENTS_DIR, '2021E');
  if (!fs.existsSync(serverDir)) return;
  for (const era of clientEras.listClientEras()) {
    assert.ok(
      !era.clients.includes('2021E'),
      '2021E is a game server and must not count as a player client',
    );
  }
});

check('the years are newest first', () => {
  const years = clientEras.listClientYears();
  const sorted = years.slice().sort((a, b) => b - a);
  assert.deepStrictEqual(years, sorted, 'years should be listed newest first');
});

// --- Coercion ----------------------------------------------------------------

check('a real year round-trips', () => {
  const years = clientEras.listClientYears();
  assert.strictEqual(clientEras.normalizeClientYear(years[0]), years[0]);
  assert.strictEqual(clientEras.normalizeClientYear(String(years[0])), years[0]);
});

check('a year with no client on disk is rejected', () => {
  // 1997 predates Roblox entirely and cannot be on disk.
  assert.strictEqual(clientEras.normalizeClientYear(1997), null);
  assert.strictEqual(clientEras.normalizeClientYear('not-a-year'), null);
});

check('resolveClientYear never returns null, so the UI has no blank Year', () => {
  assert.ok(clientEras.resolveClientYear(undefined), 'undefined must fall back to a real year');
  assert.ok(clientEras.resolveClientYear(1997), 'a bogus year must fall back to a real year');
  assert.strictEqual(
    clientEras.resolveClientYear(1997),
    clientEras.defaultClientYear(),
    'the fallback should be the newest installed era',
  );
});

// --- Wiring ------------------------------------------------------------------

check('clientYear is a creator-editable game field', () => {
  const src = fs.readFileSync(SERVER_JS, 'utf8');
  assert.ok(
    /GAME_EDITABLE_FIELDS\s*=\s*\[[\s\S]*?clientYear[\s\S]*?\]/.test(src),
    'clientYear must be in GAME_EDITABLE_FIELDS so a creator can change it',
  );
});

check('the game serializer exposes clientYear', () => {
  const src = fs.readFileSync(SERVER_JS, 'utf8');
  assert.ok(
    /clientYear:\s*clientEras\.resolveClientYear/.test(src),
    'serializeGame (and the page routes) must resolve clientYear',
  );
});

check('the Studio settings form offers a Client Year picker', () => {
  const src = fs.readFileSync(SETTINGS_VIEW, 'utf8');
  assert.ok(/name="clientYear"/.test(src), 'settings.ejs needs a clientYear select');
  assert.ok(/clientYears/.test(src), 'the picker must be driven by the detected eras');
});

check('the game page shows the year', () => {
  const src = fs.readFileSync(GAME_VIEW, 'utf8');
  assert.ok(/clientYear/.test(src), 'game-about.ejs must render the client year');
  assert.ok(/lb-game-stat-label">Year</.test(src), 'expected a "Year" statistic label');
});

check('the profile statistics show client years', () => {
  const src = fs.readFileSync(PROFILE_VIEW, 'utf8');
  assert.ok(/Client years/.test(src), 'profile.ejs must render a Client years row');
});

check('the game card exposes the year without breaking the 2013 tile', () => {
  const src = fs.readFileSync(GAME_CARD, 'utf8');
  assert.ok(/data-client-year/.test(src), 'the card should carry the year as a data attribute');
  // The card's own header documents that a visible genre/developer line is what
  // made these read as not-Roblox. A visible year row would repeat that mistake.
  assert.ok(
    !/lb-game-card-year|game-item-year/.test(src),
    'the card must not add a visible year row (see the file header)',
  );
});

console.log(
  failures === 0
    ? '\nClient years resolve to real, playable builds only.'
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;