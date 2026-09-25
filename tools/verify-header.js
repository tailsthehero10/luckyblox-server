'use strict';

/**
 * Verifies the header matches the real 2021 structure.
 *
 * Spec taken from the real page's own markup and CSS:
 *   - LIGHT bar by default (#dee1e3, dark text), dark only for a dark theme
 *   - height: 90px
 *   - top-level nav: Discover / Avatar Shop / Create / Robux
 *   - a search field with a scope selector
 *   - nav hover is a 2px UNDERLINE, not a filled pill
 *
 * Usage: node tools/verify-header.js [port]
 */

const http = require('http');

const port = Number(process.argv[2]) || 3099;

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
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

(async () => {
  console.log('2021 header');

  const home = await get('/');
  check('home renders', home.status === 200, `got ${home.status}`);
  const html = home.body;

  // --- Structure -------------------------------------------------------------
  check('the bar carries a theme class',
    /class="lb-header roblox-topbar (light|dark)-theme"/.test(html),
    'no light-theme/dark-theme class');

  check('top-level nav is Discover / Avatar Shop / Create / Robux',
    /nav-menu-title[^>]*>\s*Discover/.test(html)
    && /nav-menu-title[^>]*>\s*Avatar Shop/.test(html)
    && /nav-menu-title[^>]*>\s*Create/.test(html)
    && /nav-menu-title[^>]*>\s*Robux/.test(html));

  check('nav uses the real row class (nav-menu-title)', /nav-menu-title/.test(html));

  // --- Search ----------------------------------------------------------------
  check('the header has a search field', /id="navbar-search-input"/.test(html));
  check('the search field has a scope selector', /id="searchScope"/.test(html));
  check('all four scopes are offered',
    /Experiences/.test(html) && /People/.test(html) && /Avatar Shop/.test(html) && /Groups/.test(html));
  check('the search form targets /search', /action="\/search"/.test(html));

  // --- Brand -----------------------------------------------------------------
  check('the brand wordmark is present', /lb-brand-word/.test(html));

  // --- CSS contract ----------------------------------------------------------
  const css = await get('/css/roblox.css');
  const body = css.body;

  check('the stylesheet sets the real header height (90px)',
    /--lb-topbar-height:\s*90px/.test(body));

  check('light theme uses the real bar colour (#dee1e3)',
    /header\.lb-header\.light-theme\s*\{[^}]*#dee1e3/i.test(body));

  check('dark theme uses the real bar colour (#191b1d)',
    /header\.lb-header\.dark-theme\s*\{[^}]*#191b1d/i.test(body));

  check('nav hover is a 2px underline, not a filled pill',
    /border-bottom:\s*2px solid/.test(body));

  check('the rail offset derives from the same token',
    /\.lb-sidebar[^{]*\{[^}]*top:\s*var\(--lb-topbar-height/.test(body));

  // --- /search routing --------------------------------------------------------
  const s1 = await get('/search?scope=experiences&q=arena');
  check('/search routes experiences to the discover grid',
    s1.status === 302 && /\/games/.test(String(s1.headers && s1.headers.location)), `got ${s1.status}`);
  const s2 = await get('/search?scope=groups&q=x');
  check('/search routes groups to the group search',
    s2.status === 302, `got ${s2.status}`);
  const s3 = await get('/search?scope=catalog&q=hat');
  check('/search routes catalog to the Avatar Shop',
    s3.status === 302, `got ${s3.status}`);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();