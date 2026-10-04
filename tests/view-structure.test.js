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
 *      em dash into garbage ("آ·", "—") that renders on the page verbatim.
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
const phpWebDir = path.join(releaseRoot, 'Webserver', 'www');

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

test('profile renders the bundled rigs and identity chips never generate stand-in models', () => {
  const profile = fs.readFileSync(path.join(viewsDir, 'profile.ejs'), 'utf8');
  assert.match(profile, /lbAvatarViewer\(user,\s*128,\s*\{\s*portrait:\s*true/);
  assert.match(profile, /lbAvatarViewer\(user,\s*340\)/);

  const avatarPartial = fs.readFileSync(path.join(viewsDir, 'partials', 'avatar-figure.ejs'), 'utf8');
  assert.match(avatarPartial, /\/icons\/avatar\.svg/);
  assert.match(avatarPartial, /lb-user-avatar-image/);
  assert.doesNotMatch(avatarPartial, /lbAvatarFigure/);

  const server = fs.readFileSync(
    path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'server.js'),
    'utf8',
  );
  assert.doesNotMatch(server, /renderAvatarFigure|avatarRenderer/,
    'the website must not serve its synthetic SVG character as a Roblox avatar');
});

test('Discover content is offset by the shared fixed sidebar shell', () => {
  const gamesPage = fs.readFileSync(path.join(viewsDir, 'games.ejs'), 'utf8');
  const shellStart = gamesPage.indexOf('<div class="lb-shell">');
  const sidebar = gamesPage.indexOf("include('partials/sidebar'", shellStart);
  const main = gamesPage.indexOf('<main class="lb-main roblox-main">', sidebar);
  assert.ok(shellStart >= 0 && sidebar > shellStart && main > sidebar,
    'the sidebar and Discover content should share the rail-offset shell');
});

test('sidebar uses LuckyBlox-owned icons that match each navigation destination', () => {
  const sidebar = fs.readFileSync(path.join(viewsDir, 'partials', 'sidebar.ejs'), 'utf8');
  assert.match(sidebar, /label:\s*'Avatar Shop'[^}]*icon:\s*'\/icons\/store\.svg'/);
  assert.match(sidebar, /label:\s*'Badges'[^}]*icon:\s*'\/icons\/star\.svg'/);
});

test('shared header allows the selected light or dark theme to control its background', () => {
  const baseCss = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  const headerRule = baseCss.match(/\.lb-header,\s*\.roblox-topbar\s*\{([^}]*)\}/);
  assert.ok(headerRule, 'shared header rule not found');
  assert.doesNotMatch(
    headerRule[1],
    /background:\s*[^;]+!important/i,
    'the shared header background must not block theme-specific background colors',
  );

  const themeCss = fs.readFileSync(path.join(cssDir, 'roblox-ui.css'), 'utf8');
  assert.match(themeCss, /\.lb-header\.light-theme,[\s\S]*?\{\s*background-color:\s*var\(--rbx-header-bg-light\)/);
  assert.match(themeCss, /\.lb-header\.dark-theme,[\s\S]*?\{\s*background-color:\s*var\(--rbx-header-bg-dark\)/);
});

test('dark theme state is consistent across server-rendered pages and live settings changes', () => {
  const server = fs.readFileSync(
    path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'server.js'),
    'utf8',
  );
  assert.match(server, /themeClass\s*=\s*dark\s*\?\s*'theme-dark dark-theme'/);

  const header = fs.readFileSync(path.join(viewsDir, 'partials', 'header.ejs'), 'utf8');
  assert.match(header, /root\.classList\.toggle\('theme-dark',\s*dark\)/);
  assert.match(header, /root\.classList\.toggle\('dark-theme',\s*dark\)/);
  assert.match(header, /document\.body\.classList\.toggle\('dark-theme',\s*dark\)/);

  const settings = fs.readFileSync(path.join(viewsDir, 'settings.ejs'), 'utf8');
  assert.match(settings, /root\.classList\.toggle\('dark-theme',\s*theme === 'dark'\)/);
  assert.match(settings, /document\.body\.classList\.toggle\('dark-theme',\s*theme === 'dark'\)/);
});

test('shared page styling keeps the classic neutral canvas and flat surfaces', () => {
  const themeCss = fs.readFileSync(path.join(cssDir, 'refresh-2021.css'), 'utf8');
  assert.match(themeCss, /--rf-page:\s*#f2f4f5\s*;/);
  assert.match(themeCss, /--rf-surface:\s*#ffffff\s*;/);
  assert.match(themeCss, /--rf-line:\s*#dbdee6\s*;/);
  assert.match(themeCss, /--rf-radius(?:-sm|-lg)?:\s*2px\s*;/);
  assert.match(themeCss, /--rf-shadow-[123]:\s*none\s*;/);
});

test('dark theme styles Discover, shop, and avatar controls left white by page sheets', () => {
  const baseCss = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  assert.match(baseCss, /html\.theme-dark body :where\([\s\S]*?\.games-list-container/);
  assert.match(baseCss, /html\.theme-dark body :where\([\s\S]*?\.games-filter-chip/);
  assert.match(baseCss, /html\.theme-dark body :where\([\s\S]*?\.ci-image/);
  assert.match(baseCss, /html\.theme-dark body :where\([\s\S]*?\.av-card/);
  assert.match(baseCss, /html\.theme-dark body :where\([\s\S]*?background-color:\s*var\(--lb-surface\)\s*!important/);
  assert.match(baseCss, /html\.theme-dark body\s*\{\s*color-scheme:\s*dark/s);
});

test('Apache homepage uses local square game art and the shared 2021-style header', () => {
  const home = fs.readFileSync(
    path.join(phpWebDir, 'LuckyBlox.site', 'home', 'index.php'),
    'utf8',
  );
  const phpCss = fs.readFileSync(path.join(phpWebDir, 'style.css'), 'utf8');
  assert.match(home, /class="page home-page"/);
  assert.match(home, /href="\/style\.css\?v=\d+"/);
  assert.match(home, /class="featured-card-base"[^>]+src="\/gameplaceholder\/card\.png"/);
  assert.match(home, /class="featured-card-image"/);
  assert.match(home, /class="game-thumb-placeholder"[^>]+src="\/gameplaceholder\/card\.png"/);
  assert.match(home, /class="game-thumb-image"/);
  assert.match(phpCss, /background:\s*#dee1e3\s*!important/);
  assert.match(phpCss, /min-height:\s*90px\s*!important/);
  assert.doesNotMatch(
    phpCss,
    /url\(['"]https?:\/\/(?:static\.wikia\.nocookie\.net|tr\.rbxcdn\.com)/i,
    'the PHP site must not replace local game art with unrelated remote thumbnails',
  );
});

test('opening the mobile navigation overlays content without changing shell widths', () => {
  const responsiveCss = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  const openRuleStart = responsiveCss.indexOf('body.lb-rail-open .lb-sidebar,');
  const openRuleEnd = responsiveCss.indexOf('}', openRuleStart);
  assert.ok(openRuleStart >= 0, 'mobile drawer open rule not found');
  assert.match(responsiveCss.slice(openRuleStart, openRuleEnd), /width:\s*220px\s*!important/);
  assert.doesNotMatch(responsiveCss.slice(openRuleStart, openRuleEnd), /--lb-rail-width/);
  assert.doesNotMatch(responsiveCss, /body\.lb-rail-open\s*\{\s*--lb-rail-width/);

  const refreshedCss = fs.readFileSync(path.join(cssDir, 'refresh-2021.css'), 'utf8');
  assert.doesNotMatch(refreshedCss, /body\.lb-rail-open\s*\{\s*--rf-rail-w/);
});

test('active Discover filters keep readable text and dark icons invert site-wide', () => {
  const gamesCss = fs.readFileSync(path.join(cssDir, 'games.css'), 'utf8');
  const activeRuleStart = gamesCss.lastIndexOf('.games-filter-chip.is-active {');
  const activeRuleEnd = gamesCss.indexOf('}', activeRuleStart);
  assert.ok(activeRuleStart >= 0, 'active genre filter rule not found');
  assert.match(gamesCss.slice(activeRuleStart, activeRuleEnd), /color:\s*#ffffff\s*!important/i);

  const robloxCss = fs.readFileSync(path.join(cssDir, 'roblox.css'), 'utf8');
  assert.match(robloxCss, /html\.theme-dark img\.ch-ico\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\)\s*!important/is);
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

test('game-page icons use a real image and retain their placeholder on load failure', () => {
  const gamePage = fs.readFileSync(path.join(viewsDir, 'game-about.ejs'), 'utf8');
  const iconStart = gamePage.indexOf('id="gameIconBlock"');
  assert.ok(iconStart >= 0, 'game icon loading block should exist');
  const iconMarkup = gamePage.slice(iconStart, gamePage.indexOf('</div>', iconStart));
  assert.match(iconMarkup, /<img[^>]+src="\/gameplaceholder\/card\.png"/);
  assert.match(iconMarkup, /roblox-game-icon-top/);
  assert.match(iconMarkup, /onerror="this\.style\.display='none'/);
  assert.doesNotMatch(iconMarkup, /background-image/);
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);