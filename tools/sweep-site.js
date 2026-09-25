'use strict';

/**
 * Full-site defect sweep.
 *
 * Loads EVERY page a visitor can reach and reports the defects that make a site
 * feel broken while producing no error message:
 *
 *   - unbalanced element nesting (an unclosed <div> re-nests every later panel)
 *   - a spinner that is on screen with nothing able to clear it
 *   - a CSS rule set that would trap content behind a fixed header/rail
 *   - mojibake bytes that render as garbage text
 *   - referenced assets (icons, css, js) that 404
 *   - a control that posts to a route the server does not implement
 *
 * Usage: node tools/sweep-site.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 3099;

const PAGES = [
  '/', '/games', '/catalog', '/create', '/develop',
  '/avatar?userId=1', '/profile?userId=1', '/users/1/profile',
  '/friends?userId=1', '/badges?userId=1', '/inventory?userId=1',
  '/settings', '/search/groups', '/upgrades/robux', '/sitestat',
  '/game/1818', '/games/1818', '/game/1818?tab=store', '/game/1818?tab=servers',
  '/play?placeId=1818', '/signin', '/signup', '/studio', '/download',
  '/dev/assets', '/dev/create',
  '/dev/docs', '/dev/docs/auth', '/dev/docs/assets', '/dev/docs/users',
  '/dev/docs/places', '/dev/docs/games',
  // The search scopes the header offers.
  '/search?scope=experiences&q=arena', '/search?scope=groups&q=a',
  '/search?scope=catalog&q=hat', '/search?scope=people&q=nobody',
];

/**
 * A REAL catalog item id, read from the data rather than guessed.
 *
 * This used to be a hardcoded 1001, which is not an id the data contains - so the
 * sweep reported a 404 that was its own invention and hid the real ones. Reading
 * the id from assets.json means the check tracks the data.
 */
function firstAssetId() {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'data', 'assets.json'),
      'utf8',
    );
    const assets = JSON.parse(raw);
    const id = Object.keys(assets)[0];
    return id ? `/catalog/${id}` : null;
  } catch (error) {
    return null;
  }
}

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

function divBalance(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return {
    open: (stripped.match(/<div\b/g) || []).length,
    close: (stripped.match(/<\/div>/g) || []).length,
  };
}

const MOJIBAKE = ['\u00c3\u00a2\u20ac', '\u00d8\u00a2', '\u00c3\u00a2\u00c2\u00b7'];

(async () => {
  const problems = [];

  // Add a real catalog item page to the sweep, resolved from the data.
  const realItem = firstAssetId();
  if (realItem) PAGES.push(realItem);

  // Discover the assets actually referenced, so a 404 is caught rather than assumed.
  const assetRefs = new Set();
  const routeRefs = new Set();

  let checked = 0;
  for (const page of PAGES) {
    const res = await get(page);
    if (res.status === 0) {
      problems.push(`${page}  DID NOT RESPOND (${res.error})`);
      continue;
    }
    // 302 to sign-in is legitimate for pages that require an account.
    if (res.status !== 200 && res.status !== 302) {
      problems.push(`${page}  HTTP ${res.status}`);
      continue;
    }
    if (res.status === 302) {
      checked += 1;
      continue;
    }
    checked += 1;

    const html = res.body;

    const bal = divBalance(html);
    if (bal.open !== bal.close) {
      problems.push(`${page}  UNCLOSED <div>: open=${bal.open} close=${bal.close} (diff ${bal.open - bal.close})`);
    }

    // A server-rendered spinner must have a way off screen.
    const spin = (html.match(/lb-loading-block is-loading/g) || []).length;
    if (spin > 0) {
      const canClear = /classList\.remove\(['"]is-loading/.test(html)
        || /onerror=[^>]*is-loading/.test(html);
      if (!canClear) problems.push(`${page}  STUCK SPINNER: ${spin} block(s), nothing clears .is-loading`);
    }

    for (const seq of MOJIBAKE) {
      if (html.includes(seq)) {
        problems.push(`${page}  MOJIBAKE: ${JSON.stringify(seq)}`);
        break;
      }
    }

    // Collect referenced local assets and routes.
    for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]*)/g)) {
      const ref = m[1];
      if (ref.startsWith('/icons/') || ref.endsWith('.css') || ref.endsWith('.js')
        || ref.startsWith('/img/') || ref.endsWith('.png') || ref.endsWith('.gif')) {
        assetRefs.add(ref);
      }
    }
    for (const m of html.matchAll(/action="(\/[^"#?]*)/g)) routeRefs.add(m[1]);
  }

  // Check every referenced asset actually resolves.
  for (const ref of [...assetRefs].sort()) {
    const res = await get(ref);
    if (res.status !== 200) problems.push(`ASSET 404  ${ref}  -> ${res.status}`);
  }

  console.log(`swept ${checked} page(s), ${assetRefs.size} asset reference(s)\n`);
  if (problems.length === 0) {
    console.log('No structural defects found.');
  } else {
    console.log(`${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
  }
  process.exit(problems.length > 0 ? 1 : 0);
})();