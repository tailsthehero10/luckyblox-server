'use strict';

/**
 * Repairs the hardcoded /dev/game/1818/settings links in the Studio views.
 *
 * All ten Studio pages hardcoded place 1818 in their nav and sidebar, so the
 * "Settings" link always opened THAT game whichever one you were looking at. The
 * link is rewritten to use a `studioPlaceId` value the routes provide, falling
 * back to the game's own id when one is in scope.
 *
 * It also injects the `studioPlaceId` local at the top of each view, so no view
 * has to remember to pass it and a page that forgets cannot crash.
 *
 * Usage: node tools/fix-studio-links.js [--write]
 */

const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const VIEWS = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views', 'dev');

function allViews(dir = VIEWS, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allViews(full, found);
    else if (entry.name.endsWith('.ejs')) found.push(full);
  }
  return found;
}

// The fallback used when a view has no game in scope at all (the API docs pages,
// the assets page). It points at the deployment's first game rather than a
// hardcoded id, so it still tracks reality.
const LINK = 'href="/dev/game/<%- studioPlaceId %>/settings"';

let changed = 0;

for (const view of allViews()) {
  const original = fs.readFileSync(view, 'utf8');
  let next = original;

  // 1. The link itself.
  next = next.replace(/href="\/dev\/game\/\d+\/settings"/g, LINK);

  // 2. The local, defined once per view.
  if (next.includes('<%- studioPlaceId %>') && !next.includes('var studioPlaceId')) {
    // Prefer a game already in scope; otherwise the first known place; otherwise
    // 1818 so the link is never empty.
    const preamble = [
      '<%',
      '  // Which game the Studio nav should open.',
      '  //',
      '  // EVERY Studio page used to hardcode /dev/game/1818/settings, so clicking',
      '  // Settings while editing any other game opened 1818 instead - the settings',
      '  // you asked for appeared not to load, and a save then wrote to the wrong',
      '  // place. This resolves the id from whatever the view actually has.',
      '  var studioPlaceId = (typeof place !== "undefined" && place && place.placeId)',
      '    ? Number(place.placeId)',
      '    : ((typeof places !== "undefined" && Array.isArray(places) && places.length)',
      '      ? Number(places[0].placeId || places[0].universeId || 1818)',
      '      : 1818);',
      '%>',
      '',
    ].join('\n');

    // Insert after the opening <body ...> so it runs before the nav renders.
    const bodyAt = next.indexOf('<body');
    if (bodyAt !== -1) {
      const lineEnd = next.indexOf('\n', bodyAt);
      next = next.slice(0, lineEnd + 1) + preamble + next.slice(lineEnd + 1);
    } else {
      next = preamble + next;
    }
  }

  if (next !== original) {
    changed += 1;
    console.log(`${WRITE ? 'fixed' : 'would fix'}  ${path.relative(VIEWS, view).replace(/\\/g, '/')}`);
    if (WRITE) fs.writeFileSync(view, next, { encoding: 'utf8' });
  }
}

console.log('');
console.log(`${changed} view(s) ${WRITE ? 'repaired' : 'to repair'}`);
if (!WRITE && changed) console.log('run with --write to apply');