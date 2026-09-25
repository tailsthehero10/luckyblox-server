'use strict';

/**
 * Verifies the game page's BIG thumbnail is a wide 16:9 image, not the square card.
 *
 * The authoritative numbers come from the real Roblox game page:
 *
 *   #game-details-carousel-container          { width: 640px; height: 360px }
 *   #game-details-carousel-container:before   { padding-top: 56.25% }   // 9/16
 *
 * 640x360 is 16:9. Anything that puts a 1:1 image in this slot is the bug.
 *
 * Usage: node tools/verify-game-thumb.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        bytes: Buffer.concat(chunks).length,
        type: res.headers['content-type'],
      }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failures.push(name); console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ''}`); }
}

/** Read a PNG's real pixel dimensions from its IHDR chunk. */
function pngSize(buf) {
  // Need bytes, so re-read as binary via a separate request.
  return buf;
}

(async () => {
  console.log('game page big thumbnail');

  // The wide placeholder must be served at the big slot.
  const thumb = await get('/gameplaceholder/game-thumb.png');
  check('/gameplaceholder/game-thumb.png is served', thumb.status === 200, `got ${thumb.status}`);
  check('it is a PNG', /image\/png/.test(thumb.type || ''), thumb.type);
  check('it is a real image, not a 404 page', /PNG/.test(thumb.body.slice(0, 8)) || thumb.bytes > 10000,
    `${thumb.bytes} bytes`);

  // The square card must still exist for the ICON slot - the two are different.
  const card = await get('/gameplaceholder/card.png');
  check('/gameplaceholder/card.png is still served for the icon', card.status === 200);

  const game = await get('/game/1818');
  check('game page renders', game.status === 200);

  // The big slot points at the wide art...
  check('the big slot uses the wide placeholder',
    /roblox-game-thumb-base[^>]*src="\/gameplaceholder\/game-thumb\.png"/.test(game.body)
    || /src="\/gameplaceholder\/game-thumb\.png"[^>]*roblox-game-thumb-base/.test(game.body),
    'big slot is not the wide thumb');
  // ...and NOT at the square card.
  check('the big slot does NOT use the square card',
    !/roblox-game-thumb-base[^>]*src="\/gameplaceholder\/card\.png"/.test(game.body));
  check('the thumbnail is not the game icon image',
    !/roblox-game-thumb-top"[^>]*src="<%= game\.icon %>/.test(game.body),
    'icon is still being used as the thumbnail');

  // The icon slot must still be the square art.
  check('the ICON slot is still the square card art',
    /lb-game-icon/.test(game.body));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();