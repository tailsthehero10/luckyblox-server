'use strict';

/**
 * Every Studio page's "Settings" link must point at the game being viewed.
 *
 * The bug this guards: all eight Studio views hardcoded
 * `href="/dev/game/1818/settings"` in the top nav and the sidebar. Clicking
 * Settings while looking at ANY game - a game you just created, a map you
 * imported - always opened place 1818. On a deployment where 1818 is not the game
 * you were editing, the page looked like it "would not open" the settings you
 * asked for, and any save then wrote to the wrong place.
 *
 * A Studio view has one of:
 *   - `place` with a placeId (the settings page)
 *   - a list of places (home)
 *   - neither - in which case the link must still not lie about WHICH game.
 *
 * Run: node tests/studio-links.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views', 'dev');

function allViews(dir = VIEWS, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allViews(full, found);
    else if (entry.name.endsWith('.ejs')) found.push(full);
  }
  return found;
}

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

const views = allViews();
console.log(`studio links (${views.length} views)\n`);

// --- No hardcoded place id in a settings link --------------------------------

check('no Studio view hardcodes a place id in a settings link', () => {
  const offenders = [];
  for (const view of views) {
    const src = fs.readFileSync(view, 'utf8');
    const rel = path.relative(VIEWS, view).replace(/\\/g, '/');
    for (const m of src.matchAll(/href="\/dev\/game\/(\d+)\/settings"/g)) {
      offenders.push(`${rel}: href="/dev/game/${m[1]}/settings"`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'a hardcoded id means the link always opens the SAME game, whichever one you were looking at:\n'
    + offenders.map((o) => `       ${o}`).join('\n'),
  );
});

// --- The settings link must reference a variable ----------------------------

check('every settings link is built from a value, not a literal', () => {
  const offenders = [];
  for (const view of views) {
    const src = fs.readFileSync(view, 'utf8');
    const rel = path.relative(VIEWS, view).replace(/\\/g, '/');
    for (const m of src.matchAll(/href="(\/dev\/game\/[^"]*\/settings)"/g)) {
      // A literal digits-only path is the bug; `<%= ... %>` / `<%- ... %>` is fine.
      if (!m[1].includes('<%')) offenders.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `\n       ${offenders.join('\n       ')}`);
});

// --- Every Studio view that shows a game must be able to name it -------------

check('the settings page receives the place it is editing', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'server.js'),
    'utf8',
  );
  // The GET route must pass a `place` with a placeId, since the form action and
  // every nav link are built from it.
  const route = /app\.get\('\/dev\/game\/:placeId\/settings'[\s\S]*?^\}\);/m.exec(server);
  assert.ok(route, 'the /dev/game/:placeId/settings route was not found');
  assert.ok(
    /placeId:\s*Number\(/.test(route[0]),
    'the route renders without a placeId, so the form and links cannot name the game',
  );
});

// --- The Studio home must link to a real game, not the first one by luck -----

check('the Studio home builds its links from the place list', () => {
  const home = fs.readFileSync(path.join(VIEWS, 'home.ejs'), 'utf8');
  assert.ok(
    /href="\/dev\/game\/<%=\s*place\.placeId\s*%>\/settings"/.test(home),
    'the games table should link to that row\'s own placeId',
  );
});

console.log(
  failures === 0
    ? `\nAll ${views.length} Studio views link to the game you are actually viewing.`
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;