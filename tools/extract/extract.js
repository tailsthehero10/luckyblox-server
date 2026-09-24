'use strict';

/**
 * extract.js - pull the real 2021 profile DOM out of the archived page.
 *
 * Input : the "Avatar - Roblox" page saved from web.archive.org
 * Output: tools/extract/body.tpl  (the page body with three tokens)
 *
 * Tokens substituted into the captured DOM:
 *   {U}  the old https://www.roblox.com origin
 *   {T}  a real item thumbnail (the reference folder's noFilterXXXX files)
 *   {A}  the empty three.js <canvas> (the 3D viewport is wired up at runtime)
 *
 * Everything else - class names, the 8 tab headings, the 6 shape sliders, the
 * premium sidebar, the billing banner - is the archive's own markup, so the
 * generated page matches the reference element-for-element.
 */

const fs = require('fs');
const path = require('path');

const REFERENCE_HTML = process.argv[2]
  || 'D:\\DownLoads\\Avatar - Roblox.html';
const OUT = path.join(__dirname, 'body.tpl');

const raw = fs.readFileSync(REFERENCE_HTML, 'utf8');

// The archived page is a full document. Find the page body and cut the <main>
// element out of it (the header nav and footer are rebuilt from Navigation.css
// markup by the layout helper, so only <main> is captured here).
const mainStart = raw.indexOf('<main', raw.indexOf('data-internal-page-name="Avatar"'));
if (mainStart === -1) {
  throw new Error('could not find <main> in the archived page');
}
const mainEndTag = raw.indexOf('</main>', mainStart);
if (mainEndTag === -1) {
  throw new Error('could not find </main> in the archived page');
}
let body = raw.slice(mainStart, mainEndTag);

const beforeTokens = body.length;

// 1. The old origin. Longer paths first so /users/1/profile etc. stay intact.
body = body.split('https://www.roblox.com').join('{U}');
body = body.split('http://www.roblox.com').join('{U}');

// 2. Item thumbnails. The saved folder names the downloaded images
//    "noFilter", "noFilter(1)", "noFilter(2)" ... in document order, so they
//    are mapped positionally onto the <img> tags rather than by asset id.
//    The files are WebP with no extension in the capture; the copy in
//    Webserver/www/avatar-thumbs carries a real .webp suffix so the server
//    sends a correct Content-Type and the browser renders them.
const imageQueue = Array.from(body.matchAll(/src="((?:\.\/)?Avatar - Roblox_files\/noFilter[^"]*)"/gi))
  .map((m) => m[1]);
let thumbnailCount = 0;
body = body.replace(
  /(?:src=")((?:\.\/)?Avatar - Roblox_files\/(noFilter[^"]*?))(?:\?(?:[^"]*))?"/gi,
  (match, full, file) => {
    thumbnailCount += 1;
    return `src="/avatar-thumbs/${encodeURIComponent(file)}.webp"`;
  },
);
console.log('thumbnail <img> rewritten:', thumbnailCount, 'of', imageQueue.length);

// 3. The archived page shipped an empty three.js canvas. Keep a stable token so
//    the runtime can mount the real 3D viewport there.
body = body.replace(/<canvas data-engine="three\.js r13[^"]*"[^>]*><\/canvas>/g, '{A}');

// 4. Archived pages carry a frame-buster that would blank our page.
body = body.replace(
  /<script type="text\/javascript">\s*if \(top\.location != self\.location\)\s*\{[\s\S]*?<\/script>/g,
  '',
);

// 5. The page was saved with the dark theme class applied; the real 2021 site
//    defaulted to light, which is what the stylesheets expect.
body = body.replace(
  'classic-theme age-select-theme builder-font dark-theme classic-theme-variant-1',
  'classic-theme age-select-theme builder-font classic-theme-variant-1',
);

fs.writeFileSync(OUT, body);

const count = (needle) => body.split(needle).length - 1;
console.log('reference :', REFERENCE_HTML);
console.log('wrote     :', OUT);
console.log('chars     :', body.length, `(was ${beforeTokens})`);
console.log('tokens    : {U}=%d {A}=%d thumbs=%d',
  count('{U}'), count('{A}'), thumbnailCount);
console.log('chrome    : tabs=%d sliders=%d itemCards=%d',
  count('rbx-tab-heading'),
  count('role="slider"'),
  count('item-card-name-link'));
console.log('thumbnail files referenced:', imageQueue.length);