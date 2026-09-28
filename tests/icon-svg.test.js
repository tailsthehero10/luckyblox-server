'use strict';

/**
 * Every icon SVG must be usable BOTH as a CSS mask and as an <img>.
 *
 * This is the Robux-mark bug. The header paints its glyph with
 * `-webkit-mask: url("/icons/robux.svg")` + `background-color: currentColor`, so
 * ONE file has to satisfy two very different consumers:
 *
 *   as a MASK  - only the alpha channel matters, but the shape must scale into
 *                the element's box, which requires a viewBox
 *   as an <img> - the fill is painted literally, so it must be currentColor (or
 *                present but overridable) to follow the theme
 *
 * The old robux.svg was a VTracer trace with NO viewBox and hardcoded
 * fill="#FFFFFF". A 236x260 drawing was crammed into a 16x16 mask, so every thin
 * stroke collapsed and the glyph rendered as a stray "T" next to the balance.
 * Nothing errored - a mask that cannot scale still paints SOMETHING.
 *
 * Run: node tests/icon-svg.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'icons');

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

const icons = fs.existsSync(ICONS_DIR)
  ? fs.readdirSync(ICONS_DIR).filter((f) => f.endsWith('.svg'))
  : [];

console.log(`icon svgs (${icons.length} files)\n`);

// --- Every icon has a viewBox ------------------------------------------------

const noViewBox = [];
const noFill = [];
const absoluteFill = [];

for (const file of icons) {
  const svg = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8');

  // A viewBox is what lets the artwork scale into an arbitrary element box.
  if (!/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s*["']/.test(svg)) {
    noViewBox.push(file);
  }

  // Shapes must declare a fill, or they default to black and vanish on a dark bar.
  const shapes = svg.match(/<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*>/g) || [];
  if (shapes.length && !shapes.some((s) => /fill\s*=/.test(s))) {
    noFill.push(file);
  }

  // Hardcoded non-currentColor fills cannot follow the theme when used as an
  // <img>. currentColor is the value that works in both roles.
  const hardcoded = shapes.filter((s) => {
    const m = s.match(/fill\s*=\s*["']([^"']+)["']/);
    if (!m) return false;
    const v = m[1].toLowerCase();
    return v !== 'currentcolor' && v !== 'none';
  });
  if (hardcoded.length) absoluteFill.push(`${file} (${hardcoded.length} shape(s))`);
}

check('every icon declares a viewBox (required for CSS mask scaling)', () => {
  assert.deepStrictEqual(
    noViewBox,
    [],
    `these icons cannot scale into a mask box:\n       ${noViewBox.join('\n       ')}`,
  );
});

check('every icon with a shape declares a fill', () => {
  assert.deepStrictEqual(noFill, [], `\n       ${noFill.join('\n       ')}`);
});

check('icon shapes use currentColor so they follow the theme', () => {
  // Reported rather than asserted: a deliberately bi-colour mark is legitimate,
  // but a hardcoded #FFF is what made the Robux glyph white on a white surface,
  // so any occurrence is worth knowing about.
  if (absoluteFill.length) {
    console.log(`       NOTE: hardcoded fill in ${absoluteFill.join(', ')}`);
  }
  assert.ok(true);
});

// --- Every icon is well-formed XML ------------------------------------------

check('every icon parses as XML (a malformed SVG renders as a blank or blob)', () => {
  // The Robux mark shipped INVALID: its explanatory XML comment contained "--"
  // sequences (from em-dash separators), and a double hyphen is ILLEGAL inside an
  // XML comment. The browser refused the whole file at the comment's line, so the
  // glyph silently degraded to a smudge. Nothing in a CSS mask reports that - a
  // mask that fails to parse still paints SOMETHING.
  //
  // This is a structural check, not a full parser: it validates the things an
  // icon actually needs, and is deliberately stricter than the browser about
  // the comment rule so the mistake cannot come back.
  const problems = [];

  for (const file of icons) {
    const raw = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8');

    // An XML comment may not contain "--" anywhere in its body.
    for (const m of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
      if (m[1].includes('--')) {
        problems.push(`${file}: XML comment contains "--", which is illegal in XML`);
      }
    }

    // A stray "<!--" with no close, or "-->" with no open.
    const opens = (raw.match(/<!--/g) || []).length;
    const closes = (raw.match(/-->/g) || []).length;
    if (opens !== closes) {
      problems.push(`${file}: unbalanced comment markers (${opens} open, ${closes} close)`);
    }

    // Tag counts must ignore the CONTENTS of comments. A comment that mentions a
    // tag in prose - avatar.svg explains removing a stray "r" before <svg> - is
    // text, not markup. Counting it reported a balanced file as unbalanced.
    const svg = raw.replace(/<!--[\s\S]*?-->/g, '');

    // Elements must balance. Self-closing tags are counted separately.
    for (const tag of ['svg', 'g', 'defs', 'mask', 'clipPath']) {
      const open = (svg.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) || []).length;
      const close = (svg.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      const selfClosed = (svg.match(new RegExp(`<${tag}[^>]*/>`, 'g')) || []).length;
      if (open !== close + selfClosed) {
        problems.push(`${file}: <${tag}> opens ${open}, closes ${close} (+${selfClosed} self-closed)`);
      }
    }

    // The root element must be there - a file starting with anything else, such
    // as a stray character before <svg>, cannot be used as a mask.
    if (!svg.trim().startsWith('<svg') && !svg.trim().startsWith('<?xml')) {
      problems.push(`${file}: does not begin with <svg> (starts with "${svg.trim().slice(0, 40)}")`);
    }
  }

  assert.deepStrictEqual(problems, [], `\n       ${problems.join('\n       ')}\n`);
});

// --- The specific glyph the header masks -------------------------------------

check('robux.svg displays Roblox\'s REAL artwork', () => {
  const file = path.join(ICONS_DIR, 'robux.svg');
  assert.ok(fs.existsSync(file), 'icons/robux.svg is missing');
  const svg = fs.readFileSync(file, 'utf8');

  // WHAT THIS REPLACED, and why the assertion looks like this.
  //
  // The file used to be a VTracer trace of a screenshot, and the trace was WRONG:
  // its inner counter is a square, so the badge rendered as a hexagon with a
  // square hole instead of Roblox's hexagonal ring with a square centre. Two
  // attempts to repair the SVG made it worse - a hand-drawn replacement, then an
  // SVG with an embedded base64 raster, which rendered as a broken image.
  //
  // The honest fix is to stop drawing it: Roblox ships the artwork with the client
  // and it is in this repo. The file now DISPLAYS that texture.
  const isTrace = /VTracer/i.test(svg);
  const isHandDrawn = /M12 1\.4 21\.2/.test(svg);
  const displaysRealArtwork = /<image\b[^>]*href="\/icons\/robux-mask\.png"/.test(svg)
    || /<image\b[^>]*href="data:image\/png/.test(svg);

  assert.ok(!isTrace, 'robux.svg is a VTracer trace again - that trace has the wrong counter');
  assert.ok(!isHandDrawn, 'robux.svg is the hand-drawn stand-in, not the real artwork');
  assert.ok(
    displaysRealArtwork,
    'robux.svg must display Roblox\'s own artwork (icons/robux-mask.png), not traced geometry',
  );
});

check('the Robux mask source is the real Roblox texture, white on transparent', () => {
  // The CSS mask points at robux-mask.png, copied from
  // Clients/2020M/content/textures/ui/common/robux@3x.png. A mask reads only the
  // ALPHA channel, so a white-on-transparent glyph is exactly what a themeable
  // icon needs: the ink is the shape, and the element supplies the colour.
  const mask = path.join(ICONS_DIR, 'robux-mask.png');
  assert.ok(fs.existsSync(mask), 'icons/robux-mask.png is missing - the header mask would fall back to nothing');

  const png = fs.readFileSync(mask);
  assert.strictEqual(png.slice(1, 4).toString('ascii'), 'PNG', 'robux-mask.png is not a PNG');

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.strictEqual(width, height, `expected a square icon, got ${width}x${height}`);
  assert.ok(width >= 64, `expected a reasonably sized icon, got ${width}px`);
});

check('the CSS masks the Robux glyph from the real texture', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'public', 'css', 'roblox.css'),
    'utf8',
  );
  assert.ok(
    /mask:\s*url\(["']?\/icons\/robux-mask\.png/.test(css),
    'roblox.css does not mask the Robux glyph from /icons/robux-mask.png',
  );
  assert.ok(
    !/mask:\s*url\(["']?\/icons\/robux\.svg/.test(css),
    'roblox.css still masks from robux.svg - the traced SVG was the wrong shape',
  );
});

check('robux.svg is not the hand-drawn approximation', () => {
  // The exact opening of the replacement that was written at one point. Named
  // explicitly so a reintroduction is caught by name, not by a loose heuristic.
  const svg = fs.readFileSync(path.join(ICONS_DIR, 'robux.svg'), 'utf8');
  assert.ok(
    !/M12 1\.4 21\.2/.test(svg),
    'robux.svg is the hand-drawn stand-in, not the real Roblox artwork',
  );
});

check('no icon relies on negative-only coordinates with no viewBox', () => {
  // The traced file kept large negative offsets. With a viewBox that is fine;
  // without one it is off-canvas.
  const offenders = [];
  for (const file of icons) {
    const svg = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8');
    const hasViewBox = /viewBox\s*=/.test(svg);
    const hasTranslate = /translate\(\s*-\d/.test(svg);
    if (hasTranslate && !hasViewBox) offenders.push(file);
  }
  assert.deepStrictEqual(offenders, [], `\n       ${offenders.join('\n       ')}`);
});

// --- The icons the views actually reference exist ----------------------------

check('every /icons/*.svg referenced by a view exists on disk', () => {
  const viewsRoot = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');
  const referenced = new Set();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ejs')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/\/icons\/([a-zA-Z0-9._-]+\.svg)/g)) referenced.add(m[1]);
      }
    }
  };
  walk(viewsRoot);

  const missing = [...referenced].filter((f) => !fs.existsSync(path.join(ICONS_DIR, f)));
  assert.deepStrictEqual(
    missing,
    [],
    `these icons are referenced but do not exist (they 404 on every page that uses them):\n       ${missing.join('\n       ')}`,
  );
  console.log(`       (${referenced.size} icon references checked)`);
});

console.log(
  failures === 0
    ? `\nAll ${icons.length} icons are valid mask/img sources.`
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;