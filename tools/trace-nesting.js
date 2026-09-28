'use strict';

/**
 * Prints the DIV NESTING DEPTH line by line for an authenticated page, so the
 * exact point where an element fails to close is visible.
 *
 * tools/find-unclosed-auth.js says whether a page is balanced; this says WHERE.
 * It walks the rendered HTML tracking a stack, and prints the depth on the lines
 * around any element whose closer is missing.
 *
 * Usage: node tools/trace-nesting.js /settings [username] [password]
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const pagePath = process.argv[2] || '/settings';
const username = process.argv[3] || 'tailsthehero10';
const password = process.argv[4] || '@pass@.lovely10';
const PORT = 39821;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function req(pathName, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: pathName,
        method,
        headers: Object.assign(
          body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
          headers,
        ),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-trace-'));
  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir, LUCKYBLOX_PREVIEW_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    for (let i = 0; i < 60; i += 1) {
      try { await req('/health'); break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
    }

    const login = await req('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const page = await req(pagePath, { headers: { Cookie: cookie } });

    console.log(`${pagePath} -> HTTP ${page.statusCode}\n`);

    // Strip comments and scripts: their contents are text, not markup.
    const html = page.body
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '));

    const stack = [];
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    let m;
    let line = 1;
    let lastIndex = 0;

    while ((m = tagRe.exec(html))) {
      line += html.slice(lastIndex, m.index).split('\n').length - 1;
      lastIndex = m.index;

      const closing = m[1] === '/';
      const name = m[2].toLowerCase();
      const attrs = m[3] || '';
      if (VOID.has(name) || /\/\s*$/.test(attrs)) continue;

      if (closing) {
        const at = stack.map((s) => s.name).lastIndexOf(name);
        if (at === -1) {
          console.log(`line ${String(line).padStart(4)}  STRAY </${name}>          depth=${stack.length}`);
        } else {
          // Anything above the match was never closed by the time this closer ran.
          const skipped = stack.slice(at + 1);
          for (const s of skipped) {
            console.log(
              `line ${String(line).padStart(4)}  </${name}> closes <${s.name}> opened at line ${s.line}` +
              `  <-- ${s.name} WAS NEVER CLOSED  depth=${stack.length}`,
            );
          }
          stack.length = at;
        }
      } else {
        stack.push({ name, line });
      }
    }

    console.log('');
    if (stack.length) {
      console.log('STILL OPEN AT END OF DOCUMENT:');
      for (const s of stack) console.log(`  <${s.name}> opened at line ${s.line}`);
    } else {
      console.log('Nothing left open.');
    }
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});