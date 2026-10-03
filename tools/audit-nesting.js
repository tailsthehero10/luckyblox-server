'use strict';

/**
 * Runs tools/trace-nesting.js over every page that needs no session, and reports
 * which ones leave an element unclosed.
 *
 * An unclosed element is the bug that produces "glitched" layout: the browser
 * silently re-nests every later block inside the unclosed one, so nothing errors
 * and the page just looks wrong. /settings shipped with exactly this - four
 * wrappers opened, three closed - so this walks the rest of the site for the same
 * defect instead of waiting to notice it by eye.
 *
 * Usage: node tools/audit-nesting.js
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const { makeTestDir } = require('../tests/test-paths');

const PORT = 39831;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Pages anyone can reach. Authenticated pages are covered by trace-nesting.js,
// which can log in.
const PAGES = [
  '/', '/games', '/catalog', '/create', '/develop',
  '/avatar?userId=1', '/profile?userId=1', '/users/1/profile',
  '/friends?userId=1', '/badges?userId=1', '/inventory?userId=1',
  '/search/groups', '/upgrades/robux', '/sitestat',
  '/game/1818', '/play?placeId=1818', '/signin', '/signup',
  '/studio', '/download',
  '/dev/docs', '/dev/docs/auth', '/dev/docs/assets', '/dev/docs/users',
  '/dev/docs/places', '/dev/docs/games',
  '/search?scope=experiences&q=a', '/search?scope=groups&q=a',
  '/search?scope=catalog&q=a', '/search?scope=people&q=a',
];

function get(pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: pathName }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * The elements still open at the end of the document.
 *
 * Comments and scripts are blanked (not deleted) so line numbers stay accurate;
 * a tag written inside them is text, not markup, and counting it is what makes
 * this kind of check cry wolf.
 */
function unclosed(html) {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '));

  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m;
  let line = 1;
  let last = 0;
  const strays = [];

  while ((m = tagRe.exec(cleaned))) {
    line += cleaned.slice(last, m.index).split('\n').length - 1;
    last = m.index;

    const name = m[2].toLowerCase();
    if (VOID.has(name) || /\/\s*$/.test(m[3] || '')) continue;

    if (m[1] === '/') {
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at === -1) strays.push({ name, line });
      else {
        // Anything above the match never got its own closer.
        for (const s of stack.slice(at + 1)) {
          strays.push({ name: `(never closed) <${s.name}> opened at line ${s.line}>`, line });
        }
        stack.length = at;
      }
    } else {
      stack.push({ name, line });
    }
  }

  return { open: stack, strays };
}

(async () => {
  const tempDataDir = makeTestDir('luckblox-nest');
  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    for (let i = 0; i < 60; i += 1) {
      try { await get('/health'); break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
    }

    const broken = [];
    let checked = 0;

    for (const page of PAGES) {
      const res = await get(page);
      // A redirect to sign-in is a legitimate answer and a different document.
      if (res.statusCode !== 200) continue;
      checked += 1;

      const { open, strays } = unclosed(res.body);
      if (open.length || strays.length) {
        broken.push({ page, open, strays });
      }
    }

    console.log(`checked ${checked} page(s)\n`);

    if (!broken.length) {
      console.log('Every page is structurally balanced.');
    } else {
      for (const b of broken) {
        console.log(`${b.page}`);
        for (const s of b.open) console.log(`    still open: <${s.name}> from line ${s.line}`);
        for (const s of b.strays) console.log(`    stray: ${s.name} at line ${s.line}`);
        console.log('');
      }
      console.log(`${broken.length} page(s) with unbalanced markup.`);
    }

    process.exitCode = broken.length ? 1 : 0;
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});