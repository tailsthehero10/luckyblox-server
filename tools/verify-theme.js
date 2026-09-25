'use strict';

/**
 * Verifies the account theme is applied SITE-WIDE and SERVER-RENDERED.
 *
 * Two things are being proved, and both matter:
 *
 *   1. Every page's <html> carries theme-dark when the account's theme is dark.
 *      The theme used to be applied by a script inside settings.ejs only, so
 *      /create, /develop and every other page ignored the setting entirely.
 *
 *   2. The class is already in the served HTML, NOT added afterwards. If it were
 *      added by JS the page would paint light for a frame and then flip - the
 *      "flash" that makes a theme feel broken.
 *
 * Usage: node tools/verify-theme.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

const PAGES = [
  '/', '/games', '/catalog', '/create', '/develop',
  '/avatar?userId=1', '/profile?userId=1', '/users/1/profile',
  '/friends?userId=1', '/badges?userId=1', '/inventory?userId=1',
  '/settings', '/search/groups', '/upgrades/robux', '/sitestat',
  '/game/1818', '/play?placeId=1818', '/studio',
  '/dev/assets', '/dev/create', '/dev/docs',
];

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

(async () => {
  let passed = 0;
  const failures = [];

  // The stylesheet must actually contain the dark layer, or the class is inert.
  const css = await get('/css/roblox.css');
  const darkRuleCount = (css.body.match(/html\.theme-dark/g) || []).length;
  if (darkRuleCount > 50) {
    passed += 1;
    console.log(`  ok  - stylesheet carries a site-wide dark layer (${darkRuleCount} rules)`);
  } else {
    failures.push(`stylesheet dark layer is missing or thin (${darkRuleCount} rules)`);
    console.log(`FAIL  - stylesheet carries a site-wide dark layer (${darkRuleCount} rules)`);
  }

  for (const page of PAGES) {
    const res = await get(page);
    if (res.status === 0) { failures.push(`${page} did not respond`); console.log(`FAIL  - ${page} (no response)`); continue; }
    if (res.status === 302) { passed += 1; console.log(`  ok  - ${page} (redirect, not themed)`); continue; }
    if (res.status !== 200) { failures.push(`${page} HTTP ${res.status}`); console.log(`FAIL  - ${page} HTTP ${res.status}`); continue; }

    const htmlTag = (res.body.match(/<html[^>]*>/i) || [''])[0];
    const themed = /theme-dark/.test(htmlTag);

    // The class must be in the SERVED markup. If the only place it appears is a
    // later <script>, the page flashes light before turning dark.
    const inScriptOnly = !themed && /theme-dark/.test(res.body);

    if (themed) {
      passed += 1;
      console.log(`  ok  - ${page} server-renders theme-dark`);
    } else if (inScriptOnly) {
      failures.push(`${page} sets the theme from JS only (will flash light first)`);
      console.log(`FAIL  - ${page} sets the theme from JS only`);
    } else {
      failures.push(`${page} is not themed`);
      console.log(`FAIL  - ${page} is not themed (html tag: ${htmlTag})`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();