'use strict';

/**
 * Proves the AppSettings.xml the CLIENT is handed points at the right host and
 * scheme, whichever way the request arrived.
 *
 * This is the "2021M works over HTTP and HTTPS, locally and publicly" check:
 *
 *   - a request on http://localhost:PORT      -> http://localhost:PORT/...
 *   - a request on http://127.0.0.1:PORT      -> http://127.0.0.1:PORT/...
 *   - a request behind a TLS proxy carrying
 *     X-Forwarded-Proto: https               -> https://<that host>/...
 *
 * plus the per-client path suffix (2021M needs /home/, 2022M the root).
 *
 * Run: node tests/client-baseurl-rewrite.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { makeTestDir } = require('./test-paths');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3987;

function request({ pathName = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: pathName, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function baseUrlOf(xml) {
  return (String(xml).match(/<BaseUrl>([\s\S]*?)<\/BaseUrl>/i) || [])[1] || '';
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited before becoming ready');
    try {
      await request({ pathName: '/health' });
      return;
    } catch (error) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server did not become ready');
}

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

(async () => {
  const tempDataDir = makeTestDir('luckblox-baseurl');

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      LUCKYBLOX_DATA_DIR: tempDataDir,
      LUCKYBLOX_PREVIEW_MODE: 'off',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitForReady(server);
    console.log('client BaseUrl rewrite');

    // --- Local, over plain HTTP --------------------------------------------

    const localhost2021 = await request({
      pathName: '/AppSettings.xml?client=2021M',
      headers: { host: `localhost:${PORT}` },
    });
    check('localhost http: 2021M is reachable at the local origin, with /home/', () => {
      assert.equal(localhost2021.statusCode, 200);
      assert.equal(baseUrlOf(localhost2021.body), `http://localhost:${PORT}/LuckBlox.site.tk/home/`);
    });

    const loopback2022 = await request({
      pathName: '/AppSettings.xml?client=2022M',
      headers: { host: `127.0.0.1:${PORT}` },
    });
    check('127.0.0.1 http: 2022M uses that host, at the origin root', () => {
      assert.equal(baseUrlOf(loopback2022.body), `http://127.0.0.1:${PORT}/LuckBlox.site.tk/`);
    });

    // --- Public, behind a TLS-terminating proxy ---------------------------

    const public2021 = await request({
      pathName: '/AppSettings.xml?client=2021M',
      headers: {
        host: 'luckyblox-server.onrender.com',
        'x-forwarded-proto': 'https',
      },
    });
    check('public https: the forwarded scheme and host are honoured', () => {
      assert.equal(
        baseUrlOf(public2021.body),
        'https://luckyblox-server.onrender.com/LuckBlox.site.tk/home/',
      );
    });

    const public2022 = await request({
      pathName: '/AppSettings.xml?client=2022M',
      headers: {
        host: 'luckyblox-server.onrender.com',
        'x-forwarded-proto': 'https',
      },
    });
    check('public https: 2022M keeps the origin root, not /home/', () => {
      assert.equal(
        baseUrlOf(public2022.body),
        'https://luckyblox-server.onrender.com/LuckBlox.site.tk/',
      );
    });

    // A proxy chain exposes the first hop in the header ("https, http"); the
    // FIRST value is the client-facing one.
    const chained = await request({
      pathName: '/AppSettings.xml?client=2021M',
      headers: {
        host: 'luckyblox-server.onrender.com',
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'luckyblox-server.onrender.com, internal',
      },
    });
    check('a multi-hop X-Forwarded-* header uses the first (client-facing) value', () => {
      assert.equal(
        baseUrlOf(chained.body),
        'https://luckyblox-server.onrender.com/LuckBlox.site.tk/home/',
      );
    });

    // --- It must never hand the client a host it cannot reach -------------

    check('the served file never contains the committed localhost placeholder', () => {
      // The on-disk default is http://localhost/LuckBlox.site.tk/ - correct for a
      // desktop launch, wrong for the public site. It must be substituted, not
      // passed through, whenever the caller is not on localhost.
      assert.ok(
        !baseUrlOf(public2021.body).includes('localhost'),
        `public request was served the placeholder: ${baseUrlOf(public2021.body)}`,
      );
    });

    check('both clients are served a URL under /LuckBlox.site.tk', () => {
      for (const body of [localhost2021.body, loopback2022.body, public2021.body]) {
        assert.ok(
          baseUrlOf(body).includes('/LuckBlox.site.tk'),
          `expected the app prefix in ${baseUrlOf(body)}`,
        );
      }
    });

    // Every committed client file must still be a self-consistent placeholder,
    // so a desktop launch that never touches the rewrite still works.
    check('every committed AppSettings.xml carries the localhost placeholder', () => {
      const clientsRoot = path.join(PROJECT_ROOT, 'Clients');
      const clients = fs.readdirSync(clientsRoot)
        .filter((c) => fs.existsSync(path.join(clientsRoot, c, 'AppSettings.xml')));
      assert.ok(clients.length > 0, 'expected at least one client');
      for (const client of clients) {
        const xml = fs.readFileSync(path.join(clientsRoot, client, 'AppSettings.xml'), 'utf8');
        const url = baseUrlOf(xml);
        assert.ok(
          url.startsWith('http://localhost/LuckBlox.site.tk'),
          `${client} should carry the localhost placeholder, got "${url}"`,
        );
      }
      console.log(`       (${clients.length} clients checked)`);
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nAppSettings.xml resolves to the caller\'s own origin, on http and https.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});