'use strict';

/**
 * gen-classic-ejs.js - turn the captured 2021 avatar shell into an EJS partial.
 *
 * The Node bridge is what actually serves the live site on Render (and on the
 * desktop), so the real 2021 chrome has to live there. This script reads the
 * archive capture (tools/extract/avatar-shell.html) and emits
 * Webserver/http-db-bridge/views/partials/classic-avatar-shell.ejs, where:
 *
 *   {A}            -> a slot the view fills with the account's avatar figure
 *   {U}/path       -> a local /path on this site
 *   /avatar-thumbs -> served straight from /avatar-thumbs (real item art)
 *
 * Everything else is the archive's own markup: the 8 tab headings, the 5 shape
 * sliders, the billing banner, the item cards.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(__dirname, 'avatar-shell.html');
const outDir = path.join(root, 'Webserver', 'http-db-bridge', 'views', 'partials');
const out = path.join(outDir, 'classic-avatar-shell.ejs');

let shell = fs.readFileSync(src, 'utf8');

// 0. The thumbnail filenames are captured without an extension (the archive
//    saved them as bare "noFilter(1)" files). The copy under avatar-thumbs has a
//    real .webp suffix so the server sends a correct Content-Type, so add it
//    back here - otherwise every thumbnail request 404s.
//    Anchored on the closing double quote so the ")" inside "noFilter(1)" is
//    kept as part of the name.
shell = shell.replace(/\/avatar-thumbs\/([^"]+)(")/g, (match, name, quote) => {
  if (/\.(webp|png|jpe?g|gif)$/i.test(name)) return match;
  return `/avatar-thumbs/${name}.webp${quote}`;
});

// 1. The archived page's three.js canvas slot becomes an EJS include for the
//    account's avatar figure.
shell = shell.replace('{A}', '<%- include(\'avatar-figure\', { user: user, size: 300 }) %>');

// 2. Local routing: roblox.com paths are all served by this site.
shell = shell.replace(/\{U\}(\/[^"']*)?/g, (match, p) => p || '/');

// 3. The archived hrefs used the origin as a bare prefix; a few became empty.
shell = shell.replace(/href=""/g, 'href="/"');

// 4. EJS-escape: the captured DOM contains no <%= %> but it does contain `${`
//    inside inline scripts, which EJS would try to evaluate. Neutralise them.
shell = shell.replace(/\$\{/g, '\\${');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, shell);

const count = (needle) => shell.split(needle).length - 1;
console.log('captured shell :', shell.length, 'chars');
console.log('wrote          :', out);
console.log('tabs=%d sliders=%d itemCards=%d thumbs=%d remainingTokens=%d',
  count('rbx-tab-heading'),
  count('role="slider"'),
  count('item-card-container'),
  count('/avatar-thumbs/'),
  count('{U}') + count('{A}'));