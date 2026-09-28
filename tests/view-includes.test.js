'use strict';

/**
 * Every `include(...)` in every view must point at a file that EXISTS.
 *
 * This is the bug that took every `/dev/*` page down with a 500. EJS resolves an
 * include path RELATIVE TO THE INCLUDING FILE, so a page in `views/dev/` that
 * writes `include('partials/scripts')` looks for `views/dev/partials/scripts.ejs`
 * - which does not exist - and throws at render time. Nothing catches it earlier:
 * the file is valid JavaScript, the route is registered, the server starts fine,
 * and only the request fails.
 *
 * A nested view needs `../partials/scripts` (one level) or `../../partials/...`
 * (two levels). Getting the depth wrong is silent until a user loads the page, so
 * this walks the real tree and checks every include resolves.
 *
 * Run: node tests/view-includes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VIEWS_ROOT = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');

/** Every .ejs file under views/, at any depth. */
function allViews(dir = VIEWS_ROOT, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allViews(full, found);
    else if (entry.name.endsWith('.ejs')) found.push(full);
  }
  return found;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const views = allViews();
console.log(`view includes (${views.length} views)\n`);

// --- Every include resolves to a real file -----------------------------------

const unresolved = [];

for (const view of views) {
  const source = fs.readFileSync(view, 'utf8');
  const rel = path.relative(VIEWS_ROOT, view).replace(/\\/g, '/');

  // Match include('...') and include("..."), skipping the ones that interpolate
  // a value (those cannot be checked statically and are not used here).
  for (const match of source.matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
    let target = match[1];
    if (target.includes('<%')) continue;

    if (!target.endsWith('.ejs')) target += '.ejs';

    // EJS resolves relative to the including file; a leading '/' would be
    // root-relative, which this project does not use.
    const resolved = path.resolve(path.dirname(view), target);
    if (!fs.existsSync(resolved)) {
      unresolved.push(`${rel} -> ${match[1]}  (looked for ${path.relative(VIEWS_ROOT, resolved).replace(/\\/g, '/')})`);
    }
  }
}

check('every include() resolves to an existing view', () => {
  assert.deepStrictEqual(
    unresolved,
    [],
    `\n       ${unresolved.join('\n       ')}\n`,
  );
});

// --- The shared scripts partial is reachable from every depth -----------------

check('the shared scripts partial exists at views/partials/scripts.ejs', () => {
  assert.ok(
    fs.existsSync(path.join(VIEWS_ROOT, 'partials', 'scripts.ejs')),
    'views/partials/scripts.ejs is missing',
  );
});

check('every view that loads a page script actually includes that partial', () => {
  // A page that renders `<script>` tags but never includes the shared partial
  // will have LBLoading / legacy-nav undefined at runtime.
  const missing = [];
  for (const view of views) {
    const source = fs.readFileSync(view, 'utf8');
    const rel = path.relative(VIEWS_ROOT, view).replace(/\\/g, '/');

    // Only top-level pages, not partials themselves.
    if (rel.startsWith('partials/')) continue;

    const includesScripts = /include\(\s*['"][^'"]*partials\/scripts['"]/.test(source);
    const usesLoader = /LBLoading|lb-loading-block|lb-select\.js/.test(source);

    if (usesLoader && !includesScripts) {
      missing.push(rel);
    }
  }
  assert.deepStrictEqual(
    missing,
    [],
    `these views use the loader but never include partials/scripts:\n       ${missing.join('\n       ')}`,
  );
});

console.log(
  failures === 0
    ? `\nAll ${views.length} views include only files that exist.`
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;