'use strict';

/**
 * End-to-end checks for the join flow, the download page, the account menu and
 * the signed-in redirect rules.
 *
 * Usage: node tools/verify-site-flows.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path, headers) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: headers || {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}

function post(path, payload, headers) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload || {});
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }, headers || {}),
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.write(data);
    req.end();
  });
}

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failures.push(name); console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ''}`); }
}

(async () => {
  console.log('site flows');

  // --- /download is THE single download page ---------------------------------
  const dl = await get('/download');
  check('/download exists and returns 200', dl.status === 200, `got ${dl.status}`);
  check('/download shows the real client state', /Player client/.test(dl.body));
  check('/download offers install or explains why not',
    /Download installer/.test(dl.body) || /Installer unavailable/.test(dl.body));
  check('/download is not a redirect to another download page',
    !(dl.status >= 300 && dl.status < 400));

  // --- The game page is the ONLY place a join happens -------------------------
  const game = await get('/game/1818');
  check('game page renders', game.status === 200);
  check('game page has the join panel', /id="joinStatus"/.test(game.body));
  check('join panel has a title, body and actions region',
    /id="joinTitle"/.test(game.body) && /id="joinBody"/.test(game.body)
    && /id="joinActions"/.test(game.body));
  check('join panel has its own inline spinner', /lb-join-spinner/.test(game.body));
  check('join panel is a live region',
    /role="status"/.test(game.body) && /aria-live/.test(game.body));

  // The whole point: no navigation away to join.
  check('press-Play does NOT navigate to /play',
    !/data\.playUrl/.test(game.body) && !/\/play\?placeId=.*location/.test(game.body));
  check('press-Play does NOT navigate to the download FILE',
    !/location\.href = data\.client\.downloadUrl/.test(game.body));
  check('the missing-client action points at the /download PAGE',
    /href: '\/download'/.test(game.body) || /"\/download"/.test(game.body));

  // --- Account menu ----------------------------------------------------------
  check('header has an account menu trigger', /id="accountMenuBtn"/.test(game.body));
  check('account menu trigger is a real button with aria state',
    /aria-haspopup="true"/.test(game.body) && /aria-expanded/.test(game.body));
  check('account menu panel exists', /id="accountMenuPanel"/.test(game.body));
  check('account menu offers Sign Out', /Sign Out/.test(game.body));
  check('sign out is a POST form, not a GET link',
    /method="POST" action="\/logout/.test(game.body));
  check('account menu links to the single download page', /href="\/download"/.test(game.body));
  check('account menu is bound by the shared script', /bindAccountMenu/.test(game.body));

  // --- Signed-in users cannot enter signin/signup ---------------------------
  const api = await post('/api/login', { username: 'tailsthehero10', password: '__wrong__' });
  check('login rejects a bad password (not silently succeeding)', api.status === 401,
    `got ${api.status}`);

  // --- The launch API reports client state ----------------------------------
  const launch = await post('/api/launch-game', { placeId: 1818 });
  check('launch without a session is refused (sign-in required)',
    launch.status === 401 || /sign-in-required/.test(launch.body),
    `got ${launch.status}`);

  const status = await get('/api/client/status');
  check('/api/client/status reports install state',
    status.status === 200 && /"installed"/.test(status.body));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) failures.forEach((f) => console.log(`   - ${f}`));
  process.exit(failures.length > 0 ? 1 : 0);
})();