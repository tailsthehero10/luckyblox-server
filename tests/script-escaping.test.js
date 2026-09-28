'use strict';

/**
 * Finds `<%= ... %>` used INSIDE a `<script>` block.
 *
 * `<%= %>` HTML-escapes its output. That is what you want in markup and exactly
 * what you must NOT do in JavaScript: `JSON.stringify('light')` becomes
 * `&#34;light&#34;`, and the browser sees a syntax error. One bad value kills the
 * whole script block, so every handler defined after it silently disappears - the
 * control still LOOKS wired (an anchor still changes the URL hash, a form still
 * submits) while doing nothing.
 *
 * This is how the settings tabs broke. The fix is `<%- %>`, which emits raw.
 *
 * A value is safe to emit raw when it is JSON-stringified (quotes and backslashes
 * escaped for a JS string context) or numeric. This reports anything else so it
 * can be looked at, rather than guessing.
 *
 * Run: node tests/script-escaping.test.js
 */

const fs = require('fs');
const path = require('path');

const VIEWS_ROOT = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');

function allViews(dir = VIEWS_ROOT, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allViews(full, found);
    else if (entry.name.endsWith('.ejs')) found.push(full);
  }
  return found;
}

/**
 * The `<%= %>` expressions that sit inside a `<script>` block.
 *
 * Returns { file, line, expr } for each. `<%- %>` (raw) is fine and skipped;
 * `<%# %>` (comment) is skipped.
 */
function escapedOutputInScript(file) {
  const source = fs.readFileSync(file, 'utf8');
  const findings = [];

  // Walk each <script>...</script> region.
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;

  while ((scriptMatch = scriptRe.exec(source))) {
    const body = scriptMatch[1];
    const bodyStart = scriptMatch.index + scriptMatch[0].indexOf(body);

    // Blank out JS comments first. An EJS tag written inside a comment is prose
    // explaining the rule, not output - counting it makes this check cry wolf
    // (it flagged the very comment that documents the fix).
    const noComments = body
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

    // `<%=` ... `%>`  - escaped output. `<%-`, `<%#`, `<%` are not this.
    const outRe = /<%=[\s\S]*?%>/g;
    let outMatch;
    while ((outMatch = outRe.exec(noComments))) {
      const expr = outMatch[0].slice(3, -2).trim();
      const line = source.slice(0, bodyStart + outMatch.index).split('\n').length;
      findings.push({ file, line, expr });
    }
  }

  return findings;
}

const views = allViews();
const findings = [];

for (const view of views) {
  for (const f of escapedOutputInScript(view)) findings.push(f);
}

console.log(`script escaping (${views.length} views)\n`);

if (findings.length === 0) {
  console.log('  ok   no <script> block uses escaped output (<%= %>)');
  console.log('\nNo script block is at risk of an HTML-escaped syntax error.');
  process.exitCode = 0;
} else {
  console.log(`  FAIL ${findings.length} escaped output expression(s) inside <script>:\n`);
  for (const f of findings) {
    const rel = path.relative(VIEWS_ROOT, f.file).replace(/\\/g, '/');
    console.log(`       ${rel}:${f.line}  <%= ${f.expr} %>`);
  }
  console.log('');
  console.log('HTML-escaping turns quotes into &#34;, which is a JavaScript syntax');
  console.log('error inside a script block and kills everything defined after it.');
  console.log('Use <%- %> (raw) with JSON.stringify for strings, or <%- Number(x) %>.');
  process.exitCode = 1;
}