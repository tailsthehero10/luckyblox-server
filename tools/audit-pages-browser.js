'use strict';

/**
 * Loads every reachable page in a REAL browser and reports what actually broke.
 *
 * The sweep tool checks the served HTML; this checks the RENDERED page - console
 * errors, failed network requests, and whether the page drew anything at all. A
 * page can return HTTP 200 with balanced markup and still be broken: a stylesheet
 * that never loaded, a script that threw, an image set that all 404'd.
 *
 * Usage: node tools/audit-pages-browser.js [baseUrl]
 */

const { spawnSync } = require('child_process');

const BASE = process.argv[2] || 'http://localhost:39001';
const BROWSER = 'C:\\Users\\Faisa\\.codegpt\\skills\\browser-automation\\browser.mjs';

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
  '/search?scope=catalog&q=h', '/search?scope=people&q=a',
];

// The probe asks the page what the browser sees. bodyChars is the useful signal:
// a page that 200s but renders nothing has near-zero text.
const PROBE = `JSON.stringify({ bodyChars: document.body ? document.body.innerText.trim().length : 0, sheets: document.styleSheets.length, images: document.images.length })`;

console.log(`auditing ${PAGES.length} pages via a real browser\n`);

const broken = [];

for (const page of PAGES) {
  const r = spawnSync(
    process.execPath,
    [BROWSER, BASE + page, '--eval', PROBE],
    { encoding: 'utf8', timeout: 90000 },
  );

  const out = (r.stdout || '') + (r.stderr || '');

  // The browser tool prints a key/value report, not raw JSON:
  //
  //   url        http://localhost:39001/
  //   http       200
  //   title      "LuckyBlox"
  //   bodyChars  1708
  //   eval       "{\"bodyChars\":1708,\"sheets\":5}"
  //   console errors/warnings (0):
  //   requests failed (0):
  //
  // Parsing the report is more reliable than parsing the eval payload (which is
  // JSON-inside-JSON when the expression returns a string). The first version of
  // this looked for a bare JSON line, found none, and reported all 30 pages as
  // "probe returned nothing" - a tool bug masquerading as 30 site defects.
  const field = (key) => {
    const m = new RegExp(`^\\s*${key}\\s{2,}(.+)$`, 'm').exec(out);
    return m ? m[1].trim() : null;
  };

  const httpStatus = Number(field('http'));
  const bodyChars = Number(field('bodyChars'));
  const title = field('title');

  // "console errors/warnings (0):" -> 0.  A non-zero count is followed by the
  // actual messages on the lines beneath it.
  const errMatch = /console errors\/warnings \((\d+)\)/.exec(out);
  const failMatch = /requests failed \((\d+)\)/.exec(out);
  const errCount = errMatch ? Number(errMatch[1]) : -1;
  const failCount = failMatch ? Number(failMatch[1]) : -1;

  const problems = [];
  if (!Number.isFinite(httpStatus)) problems.push('the page did not report an HTTP status');
  else if (httpStatus >= 400) problems.push(`HTTP ${httpStatus}`);
  if (Number.isFinite(bodyChars) && bodyChars < 200) problems.push(`nearly empty (${bodyChars} chars of text)`);
  if (errCount > 0) problems.push(`${errCount} console error/warning`);
  if (failCount > 0) problems.push(`${failCount} failed request`);

  // Show the messages themselves, so a failure is actionable rather than a count.
  if (errCount > 0 || failCount > 0) {
    const detail = out.split(/\r?\n/)
      .filter((l) => /^\s{2,}\S/.test(l) && !/^\s*(url|http|load|title|bodyChars|patchright|text|eval)\s{2,}/.test(l))
      .slice(0, 6);
    for (const d of detail) problems.push(`   ${d.trim().slice(0, 120)}`);
  }

  if (problems.length) {
    broken.push({ page, problems, title });
    console.log(`  FAIL ${page}`);
    for (const p of problems) console.log(`         ${p}`);
  } else {
    console.log(`  ok   ${page}  (${bodyChars} chars, ${title || 'no title'})`);
  }
}

console.log('');
if (broken.length) {
  console.log(`${broken.length} of ${PAGES.length} page(s) with defects.`);
  process.exitCode = 1;
} else {
  console.log(`All ${PAGES.length} pages rendered cleanly.`);
}