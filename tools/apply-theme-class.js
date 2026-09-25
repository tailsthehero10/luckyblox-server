'use strict';

/**
 * Add the server-rendered theme class to every view's <html> element.
 *
 * Every page renders `<html lang="en">` identically, so the account's theme is
 * applied the same way everywhere instead of by a per-page script that would need
 * remembering on each new view.
 *
 * `themeClass` is supplied by a res.locals hook in server.js, so no route has to
 * pass it. The fallback in `<%= themeClass || '' %>` keeps a view renderable on
 * its own (a unit test, a partial include) without the middleware.
 *
 * Idempotent: running it twice does not add the class twice.
 *
 * Usage: node tools/apply-theme-class.js [--write]
 */

const fs = require('fs');
const path = require('path');

const viewsDir = path.join(
  __dirname, '..', 'Webserver', 'http-db-bridge', 'views',
);
const write = process.argv.includes('--write');

const FROM = '<html lang="en">';
const TO = '<html lang="en" class="<%= themeClass || \'\' %>">';

function allViews(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allViews(full));
    else if (entry.name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

let changed = 0;
let already = 0;
let noHtml = 0;

for (const file of allViews(viewsDir)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(viewsDir, file);

  if (text.includes("class=\"<%= themeClass")) {
    already += 1;
    continue;
  }
  if (!text.includes(FROM)) {
    noHtml += 1;
    console.log(`  skipped (no bare <html lang="en">): ${rel}`);
    continue;
  }

  const updated = text.split(FROM).join(TO);
  if (write) fs.writeFileSync(file, updated, 'utf8');
  changed += 1;
  console.log(`  ${write ? 'updated' : 'would update'}: ${rel}`);
}

console.log(`\n${changed} ${write ? 'updated' : 'to update'}, ${already} already themed, ${noHtml} skipped`);
if (!write) console.log('pass --write to apply');