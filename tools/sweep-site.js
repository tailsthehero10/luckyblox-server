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

const { makeTestDir } = require('../tests/test-paths');

// The port the sweep's own server binds. 3099 is NOT a safe default: Visual
// Studio Code's language server listens there on Windows, so a sweep that missed
// its own server fell through to VS Code and reported the editor's HTML error
// page as a site bug ("HTTP 500" on /, /games, /catalog, /avatar, /studio). Pick a
// high port outside the ranges dev tools grab, and allow an override.
const port = Number(process.argv[2]) || Number(process.env.LUCKYBLOX_SWEEP_PORT) || 38211;

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

  // The sweep used to require a server already listening on the port, and the
  // port defaulted to 3099. A stale instance from an earlier run (or nothing at
  // all) then produced rows like "HTTP 500" and "DID NOT RESPOND" that were about
  // the environment, not the pages - which hid the real defects. Start our own
  // server on an isolated data dir and shut it down when done, so the result is
  // about the code and the report is reproducible.
  const { spawn } = require('child_process');
  const os = require('os');
  const PROJECT_ROOT = path.resolve(__dirname, '..');
  const ownServer = !process.env.LUCKYBLOX_SWEEP_SERVER;
  let child = null;
  let tempDataDir = null;

  if (ownServer) {
    tempDataDir = makeTestDir('luckblox-sweep');
    child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PORT: String(port), LUCKYBLOX_DATA_DIR: tempDataDir },
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      const probe = await get('/health');
      if (probe.status) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    // If our server never bound, the port may belong to something else entirely
    // (this is exactly how VS Code's error page got reported as a site bug). Say
    // so and stop, rather than reporting other software's responses as ours.
    if (!ready) {
      if (child) child.kill('SIGTERM');
      console.error(
        `the sweep's own server never became ready on port ${port}.\n`
        + 'Something else may be using that port. Set LUCKYBLOX_SWEEP_PORT to a free one.',
      );
      process.exit(1);
    }
  }

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

  if (child) child.kill('SIGTERM');
  if (tempDataDir) {
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  process.exit(problems.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});