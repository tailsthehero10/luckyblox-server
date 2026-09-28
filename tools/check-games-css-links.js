'use strict';
// Every view that renders the games carousel must link games.css, or its rows
// fall back to unstyled block flow (tiles stacked vertically in one tall column).
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.ejs') && !full.includes('partials')) out.push(full);
  }
  return out;
}

const rows = [];
for (const view of walk(VIEWS)) {
  const src = fs.readFileSync(view, 'utf8');
  const rendersCarousel = /games-carousel/.test(src) || /games-list-row|game-item/.test(src);
  const linksCss = /href=["']\/css\/games\.css["']/.test(src);
  if (rendersCarousel) {
    rows.push({ view: path.relative(VIEWS, view).replace(/\\/g, '/'), linksCss });
  }
}

console.log('views rendering the games carousel / tiles:\n');
let missing = 0;
for (const r of rows) {
  if (!r.linksCss) missing += 1;
  console.log(`  ${r.linksCss ? 'ok  ' : 'MISSING'}  ${r.view}`);
}
console.log(`\n${rows.length} view(s); ${missing} missing games.css`);
process.exit(missing ? 1 : 0);