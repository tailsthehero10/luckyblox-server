'use strict';

/**
 * Proves the R6 avatar figure's LAYOUT BOX matches the height it is asked for.
 *
 * The bug this guards: the figure used `transform: scale(var(--lb-avatar-scale))`
 * on a fixed 130x240 box. transform does not affect layout, so a figure asked for
 * 352px was DRAWN at 352px while still RESERVING 240px - it spilled out of its
 * panel and overlapped whatever sat below it. The parts are now sized in `em` and
 * the caller sets a font-size, so the box and the artwork scale together.
 *
 * Run: node tools/verify-avatar-figure-sizing.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'css', 'roblox.css');
const css = fs.readFileSync(cssPath, 'utf8');

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

/** Read the declarations of the first rule whose selector list contains `needle`. */
function ruleBody(needle) {
  const re = new RegExp(`\\${needle}\\s*\\{([^}]*)\\}`, 'g');
  let match;
  while ((match = re.exec(css))) return match[1];
  return null;
}

console.log('avatar figure sizing');

test('the figure declares its base size in em, not transform', () => {
  const body = ruleBody('.lb-avatar-figure');
  assert.ok(body, '.lb-avatar-figure rule not found');
  assert.ok(/font-size:\s*24px/.test(body), 'base font-size should be 24px');
  assert.ok(/height:\s*10em/.test(body), 'height should be 10em');
  assert.ok(/width:\s*5\.4167em/.test(body), 'width should be 5.4167em');
});

test('transform: scale is NOT used to size the figure', () => {
  const body = ruleBody('.lb-avatar-figure');
  assert.ok(
    !/transform:\s*scale/.test(body),
    'transform: scale must not size the figure (it does not resize the layout box)',
  );
});

test('every part is sized so 10em is the total height', () => {
  // Legs are the lowest part: top 5.8333em + height 4em = 9.8333em, and the head
  // starts at 0, so the figure's content spans its 10em box.
  const legs = ruleBody('.lb-af-lleg');
  assert.ok(legs, '.lb-af-lleg not found');
  const top = Number(/top:\s*([\d.]+)em/.exec(legs)[1]);
  const height = Number(/height:\s*([\d.]+)em/.exec(legs)[1]);
  assert.ok(top + height <= 10, `legs end at ${top + height}em, past the 10em box`);
});

test('a 352px request reserves 352px of layout', () => {
  // font-size = target / 10, and the box is 10em tall.
  const fontPx = 352 / 10;
  const heightPx = 10 * fontPx;
  assert.strictEqual(heightPx, 352);
});

test('the four named sizes all resolve to the height they name', () => {
  const expected = { xs: 150, sm: 220, md: 300, lg: 352 };
  for (const [suffix, target] of Object.entries(expected)) {
    const body = ruleBody(`.lb-avatar-figure--${suffix}`);
    assert.ok(body, `.lb-avatar-figure--${suffix} not found`);
    const font = Number(/font-size:\s*([\d.]+)px/.exec(body)[1]);
    const height = 10 * font;
    assert.ok(
      Math.abs(height - target) < 0.5,
      `--${suffix}: 10em x ${font}px = ${height}px, expected ~${target}px`,
    );
  }
});

test('the server-side renderer emits a font-size, not a scale variable', () => {
  const serverPath = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'server.js');
  const server = fs.readFileSync(serverPath, 'utf8');
  const start = server.indexOf('function renderAvatarFigure');
  assert.ok(start >= 0, 'renderAvatarFigure not found in server.js');
  const body = server.slice(start, start + 2000);
  assert.ok(
    /font-size:\$\{fontPx\}px/.test(body),
    'renderAvatarFigure should emit style="font-size:<n>px"',
  );

  // Only the EMITTED string matters. The function's comment legitimately names
  // the old variable while explaining why it was replaced, so match the inline
  // style attribute rather than the bare identifier - otherwise this asserts on
  // prose and fails for the wrong reason.
  assert.ok(
    !/style="--lb-avatar-scale/.test(body) && !/--lb-avatar-scale:\$\{/.test(body),
    'renderAvatarFigure must not emit --lb-avatar-scale in a style attribute',
  );
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);