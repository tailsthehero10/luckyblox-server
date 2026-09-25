'use strict';

/**
 * Verifies the two things the site was missing:
 *
 *   1. /download exists and is FAST, and tells the truth about the client.
 *   2. Joining an experience happens ON the game page - no navigation to /play.
 *
 * Usage: node tools/verify-download-and-join.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - started }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', ms: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', ms: 0, error: 'timeout' }); });
  });
}

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failures.push(`${name}${detail ? ` (${detail})` : ''}`); console.log(`FAIL  - ${name}${detail ? ` (${detail})` : ''}`); }
}

(async () => {
  console.log('download page + in-page join');

  const dl = await get('/download');
  check('/download returns 200 (it used to 404)', dl.status === 200, `got ${dl.status}`);
  if (dl.status !== 200) { console.log(`\n${passed} passed, ${failures.length} failed`); process.exit(1); }

  // "Fast" has to mean something measurable. This page renders everything from
  // server-side state, so it should not be slower than a plain page load.
  check('/download responds in under 400ms', dl.ms < 400, `${dl.ms}ms`);
  console.log(`        (${dl.ms}ms)`);

  check('shows the real install state, not a placeholder',
    /Installed|Not installed/.test(dl.body) && /dl-status/.test(dl.body));
  check('renders the published-build row', /Published build/.test(dl.body));
  check('offers the installer only via the real status',
    /Download installer/.test(dl.body) || /Installer unavailable/.test(dl.body));
  check('explains itself when no installer is published',
    /Download installer/.test(dl.body) || /No installer is published/.test(dl.body));
  check('uses the real install folder name',
    /<%= /.test(dl.body) === false && /Luckyblox/.test(dl.body), 'found raw EJS');
  check('is themed (server-rendered theme class)', /<html[^>]*class="[^"]*"/.test(dl.body));
  check('does not block on a client-side data fetch', !/fetch\('\/api\/client\/status'\)/.test(dl.body));

  const api = await get('/api/client/status');
  check('/api/client/status responds', api.status === 200, `got ${api.status}`);
  check('client status is valid JSON with ok:true',
    (() => { try { return JSON.parse(api.body).ok === true; } catch (e) { return false; } })());

  // --- In-page join ---------------------------------------------------------
  const game = await get('/game/1818');
  check('game page renders', game.status === 200, `got ${game.status}`);
  check('game page has the in-page join status panel', /id="joinStatus"/.test(game.body));
  check('join status panel is announced to assistive tech',
    /role="status"/.test(game.body) && /aria-live/.test(game.body));
  check('the join-status stylesheet is loaded', /join-status\.css/.test(game.body));
  check('Play no longer navigates to /play on a normal outcome',
    !/window\.location\.href = data\.playUrl/.test(game.body),
    'found the old /play redirect');
  check('the falling-through case reports on the page instead',
    /showJoinStatus\(/.test(game.body));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();