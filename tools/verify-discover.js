'use strict';

/**
 * Verifies /games matches the real Discover page layout.
 *
 * Authoritative spec, taken from the Discover page's own stylesheet:
 *
 *   .game-grid {
 *     grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
 *     column-gap: 12px;
 *     row-gap: 24px;
 *   }
 *   .game-card-thumb-container { height: 0; padding-bottom: 100% }  // SQUARE
 *   .game-card-name-info .play-button { width: 44px; height: 44px; border-radius: 8px }
 *
 * Usage: node tools/verify-discover.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failures.push(name); console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ''}`); }
}

(async () => {
  console.log('/games (Discover layout)');

  const games = await get('/games');
  check('/games renders', games.status === 200, `got ${games.status}`);
  const html = games.body;

  // The card must carry the real play affordance.
  check('cards have the Discover play button', /lb-game-card-play/.test(html));
  check('the play button is a real control with a label',
    /role="button"/.test(html) && /aria-label="Play /.test(html));
  check('the play button launches in place, not by following the card link',
    /data-launch-from-card="1"/.test(html));

  const css = (await get('/css/roblox.css')).body;

  function firstRule(pattern) {
    const re = new RegExp(pattern + '\\s*\\{([^}]*)\\}');
    const m = re.exec(css);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  }

  const grid = firstRule('\\.lb-game-grid,\\s*\\.roblox-game-grid');
  check('the grid rule exists', Boolean(grid));
  check('grid columns are the real 150px minimum',
    Boolean(grid) && /minmax\(150px/.test(grid), grid);
  check('column gap is 12px', Boolean(grid) && /column-gap:\s*12px/.test(grid), grid);
  check('row gap is 24px (double the column gap, as the real grid does)',
    Boolean(grid) && /row-gap:\s*24px/.test(grid), grid);

  const thumb = firstRule('\\.lb-game-card-thumb,\\s*\\.roblox-game-card-thumb');
  check('the card thumbnail rule exists', Boolean(thumb));
  check('the card thumbnail is SQUARE (1:1), matching Discover',
    Boolean(thumb) && /aspect-ratio:\s*1\s*\/\s*1/.test(thumb), thumb);
  check('the card is rounded 8px as on Discover',
    Boolean(thumb) && /border-radius:\s*8px/.test(thumb), thumb);

  const play = firstRule('\\.lb-game-card-play,\\s*\\.roblox-game-card-play');
  check('the play button rule exists', Boolean(play));
  check('the play button is 44x44, the real size',
    Boolean(play) && /width:\s*44px/.test(play) && /height:\s*44px/.test(play), play);
  check('the play button is 8px rounded, as on Discover',
    Boolean(play) && /border-radius:\s*8px/.test(play), play);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();