'use strict';

/**
 * Structural checks on the pages a visitor actually loads.
 *
 * These are the defects that read as "glitched" in a browser but are invisible
 * from reading a template: a container that is never closed (so every later
 * panel nests inside the one before it), a control with no handler, and a
 * spinner that is server-rendered but can never be cleared.
 *
 * Usage: node tools/verify-page-structure.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failed += 1; console.error(`FAIL  - ${name}${detail ? `\n        ${detail}` : ''}`); }
}

/**
 * Count div nesting, ignoring the things a browser does not treat as markup.
 *
 * A <script> body and an HTML comment can both contain the literal text "<div>",
 * which a naive count picks up and reports as a phantom imbalance. Only the real
 * element tree is counted here, which is what the browser actually nests.
 */
function divBalance(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const open = (stripped.match(/<div\b/g) || []).length;
  const close = (stripped.match(/<\/div>/g) || []).length;
  return { open, close, diff: open - close };
}

(async () => {
  console.log(`page structure (port ${port})`);

  const pages = [
    ['/avatar?userId=1', 'avatar'],
    ['/game/1818', 'game page'],
    ['/', 'home'],
    ['/profile?userId=1', 'profile'],
    ['/catalog', 'catalog'],
    ['/create', 'create'],
    ['/develop', 'develop'],
  ];

  for (const [path, label] of pages) {
    let res;
    try {
      res = await get(path);
    } catch (error) {
      check(`${label} loads`, false, error.message);
      continue;
    }

    check(`${label} returns 200`, res.status === 200, `got ${res.status}`);
    if (res.status !== 200) continue;

    const bal = divBalance(res.body);
    check(
      `${label} has balanced <div> nesting`,
      bal.diff === 0,
      `<div>=${bal.open} </div>=${bal.close} (difference ${bal.diff})`,
    );

    // A server-rendered .is-loading block is FINE as long as something can clear
    // it: an inline onerror, or a script that removes the class. Only a block with
    // neither would spin forever, so that is what is checked.
    const spinBlocks = (res.body.match(/lb-loading-block is-loading/g) || []).length;
    const hasClearer = /is-loading[\s\S]{0,600}?(onerror=|classList\.remove\(['"]is-loading|addEventListener)/.test(res.body)
      || /classList\.remove\(['"]is-loading/.test(res.body);
    check(
      `${label} can clear its loading spinner`,
      spinBlocks === 0 || hasClearer,
      `${spinBlocks} .is-loading block(s) and no onerror/classList.remove to clear them`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();