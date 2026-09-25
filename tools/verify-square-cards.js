'use strict';

/**
 * Checks the SERVED site (a running server) for the square-card artwork rules.
 *
 * Why a script and not a grep: the artwork has to be square in the stylesheet the
 * browser actually receives, and the widest-banner placeholder must not be handed
 * to any card. Reading the files on disk cannot prove either.
 *
 * Usage: node tools/verify-square-cards.js [port]
 * Default port 3099.
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok  - ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  - ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

(async () => {
  let css;
  try {
    css = await get('/css/roblox.css');
  } catch (error) {
    console.error(`Could not reach http://127.0.0.1:${port} - start the server first.`);
    console.error(error.message);
    process.exit(1);
  }

  console.log('square-card artwork (served stylesheet)');

  // The LAST matching rule wins in CSS, so collect them all and test the winner.
  function lastRule(selectorPattern) {
    const re = new RegExp(selectorPattern + '\\s*\\{([^}]*)\\}', 'g');
    let match;
    let body = null;
    while ((match = re.exec(css))) body = match[1];
    return body ? body.replace(/\s+/g, ' ').trim() : null;
  }

  const thumb = lastRule('\\.lb-game-thumb,\\s*\\.roblox-game-thumb');
  check('the game page thumbnail rule exists', Boolean(thumb), 'rule not found in roblox.css');
  check(
    'the game page thumbnail is SQUARE (aspect-ratio: 1 / 1)',
    Boolean(thumb) && /aspect-ratio:\s*1\s*\/\s*1/.test(thumb),
    `winning rule: ${thumb}`,
  );

  const cardThumb = lastRule('\\.lb-game-card-thumb,\\s*\\.roblox-game-card-thumb');
  check('the game card rule exists', Boolean(cardThumb), 'rule not found');
  check(
    'game cards are SQUARE (aspect-ratio: 1 / 1)',
    Boolean(cardThumb) && /aspect-ratio:\s*1\s*\/\s*1/.test(cardThumb),
    `winning rule: ${cardThumb}`,
  );

  const thumbImg = lastRule('\\.roblox-game-thumb-img');
  check('the thumbnail image rule exists', Boolean(thumbImg), 'rule not found');
  check(
    'the thumbnail art is FITTED, never cropped (object-fit: contain)',
    Boolean(thumbImg) && /object-fit:\s*contain/.test(thumbImg),
    `winning rule: ${thumbImg}`,
  );

  const hero = lastRule('\\.lb-hero-art');
  check('the home hero art rule exists', Boolean(hero), 'rule not found');
  check(
    'the home hero art is a square box',
    Boolean(hero) && /width:\s*100px/.test(hero) && /height:\s*100px/.test(hero),
    `rule: ${hero}`,
  );

  // Now the pages themselves.
  for (const [path, label] of [['/game/1818', 'game page'], ['/', 'home page']]) {
    const html = await get(path);
    check(
      `${label} does not use the wide Big_ banner for a card`,
      !/gameplaceholder\/big\.png/.test(html),
      'found /gameplaceholder/big.png (the 596x335 wide art)',
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();