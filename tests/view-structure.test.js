'use strict';

/**
 * Guards the view-level structural defects that read as "glitched" in a browser
 * but are invisible when you read a template by eye.
 *
 * Each of these was a REAL bug found on the live site:
 *
 *   1. An unclosed <div>. avatar.ejs, settings.ejs and develop.ejs each left a
 *      container open, so every later panel nested inside the one before it -
 *      which is what made the page look like elements were "half inside" each
 *      other. Browsers silently auto-correct this, so nothing errors; the page
 *      just lays out wrong.
 *
 *   2. Mojibake. A UTF-8 file read or written as latin-1 turns "&middot;" and an
 *      em dash into garbage ("آ·", "â€”") that renders on the page verbatim.
 *
 *   3. Sizing the avatar figure with transform: scale(), which draws the figure
 *      larger without reserving the space for it.
 *
 * Run: node tests/view-structure.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..');
const viewsDir = path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'views');
const cssDir = path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'public', 'css');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`FAIL  - ${name}\n        ${error.message}`);
    process.exitCode = 1;
  }
}

/** Every .ejs under views/, including partials. */
function allViews(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allViews(full));
    else if (entry.name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

/**
 * Count <div> open/close in the parts a browser treats as markup.
 *
 * Comments and <script> bodies are stripped first: both can legitimately contain
 * the literal text "<div>" (a comment explaining the markup, or a JS string that
 * builds it) and counting those produces a phantom imbalance.
 */
function divBalance(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    // EJS control blocks can contain markup in some branches; removing the tags
    // themselves is enough because only <div> matters here.
    .replace(/<%[-=]?[\s\S]*?%>/g, '');
  return {
    open: (stripped.match(/<div\b/g) || []).length,
    close: (stripped.match(/<\/div>/g) || []).length,
  };
}

console.log('view structure');

test('every view has balanced <div> nesting', () => {
  const broken = [];
  for (const file of allViews(viewsDir)) {
    const { open, close } = divBalance(fs.readFileSync(file, 'utf8'));
    if (open !== close) {
      broken.push(`${path.relative(viewsDir, file)}: <div>=${open} </div>=${close} (diff ${open - close})`);
    }
  }
  assert.deepStrictEqual(
    broken,
    [],
    `views with unclosed <div>:\n        ${broken.join('\n        ')}`,
  );
});

test('no view or stylesheet contains mojibake sequences', () => {
  // The byte patterns that appear when UTF-8 is read as latin-1. Matched as
  // character sequences so this works regardless of the file's own encoding.
  const bad = ['\u00c3\u00a2\u20ac', '\u00d8\u00a2', '\u00c3\u00a2\u00c2\u00b7', '\u0637\u00a2'];
  const files = allViews(viewsDir)
    .concat(fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => path.join(cssDir, f)));

  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const seq of bad) {
      if (text.includes(seq)) hits.push(`${path.basename(file)}: ${JSON.stringify(seq)}`);
    }
  }
  assert.deepStrictEqual(hits, [], `mojibake found:\n        ${hits.join('\n        ')}`);
});

test('the avatar figure is sized by font-size, not transform: scale', () => {
  const css = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  const start = css.indexOf('.lb-avatar-figure {');
  assert.ok(start >= 0, '.lb-avatar-figure rule not found');
  const body = css.slice(start, css.indexOf('}', start));
  assert.ok(
    !/transform:\s*scale/.test(body),
    'transform: scale() does not resize the layout box, so the figure overlaps what follows it',
  );
  assert.ok(/height:\s*10em/.test(body), 'expected a 10em height so font-size controls the size');
});

test('the server renderer emits a font-size for the figure', () => {
  const server = fs.readFileSync(
    path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'server.js'),
    'utf8',
  );
  const start = server.indexOf('function renderAvatarFigure');
  assert.ok(start >= 0, 'renderAvatarFigure not found');
  const body = server.slice(start, start + 2000);
  assert.ok(/font-size:\$\{fontPx\}px/.test(body), 'expected style="font-size:<n>px"');
});

test('cards fit artwork instead of cropping it (object-fit: contain)', () => {
  const css = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  // The last rule wins; find every .roblox-game-thumb-img block and check the final one.
  const re = /\.roblox-game-thumb-img\s*\{([^}]*)\}/g;
  let match;
  let last = null;
  while ((match = re.exec(css))) last = match[1];
  assert.ok(last, '.roblox-game-thumb-img rule not found');
  assert.ok(
    /object-fit:\s*contain/.test(last),
    'square game art must be fitted; cover crops the icon edges off',
  );
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);