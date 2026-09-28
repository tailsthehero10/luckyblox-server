'use strict';

/**
 * `/settings/<section>` must be a REAL, reachable URL.
 *
 * The bug: only `/settings` existed. The four sections lived behind a `#hash` that
 * the page's own script wrote with `history.replaceState`, so
 *
 *   - `/settings/account`, `/settings/privacy`, `/settings/appearance` and
 *     `/settings/profile` all returned 404;
 *   - a refresh always came back to Profile (a hash never reaches the server);
 *   - the Back button did nothing (replaceState adds no history entry);
 *   - a shared or bookmarked link opened the wrong tab.
 *
 * This asserts the routes exist, that each one renders ITS OWN panel server-side
 * (not just the URL), that an unknown section still 404s, that the aliases the old
 * nav referenced still resolve, and that a guest is asked to sign in while keeping
 * the section they wanted.
 *
 * Run: node tests/settings-urls.test.js
 */

const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../server/security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 38511;

function req(pathName, { method = 'GET', body, headers = {}, form } = {}) {
  return new Promise((resolve, reject) => {
    const payload = form || body;
    const h = Object.assign({}, headers);
    if (payload && !h['Content-Type']) h['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: pathName, method, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitForReady(proc) {
  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) throw new Error('server exited early');
    try { await req('/health'); return; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server never became ready');
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

const SECTIONS = ['profile', 'appearance', 'privacy', 'account'];
const ALIASES = ['security', 'password'];

/** The panels the server marked visible in the delivered HTML. */
function visiblePanels(html) {
  const out = [];
  for (const m of html.matchAll(/<section class="settings-panel" id="panel-([a-z]+)"([^>]*)>/g)) {
    const attrs = m[2] || '';
    if (!/\bhidden\b/.test(attrs)) out.push(m[1]);
  }
  return out;
}

(async () => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckblox-settings-'));
  const hash = security.hashPassword('@pass@.lovely10');

  fs.writeFileSync(path.join(tempDataDir, 'users.json'), JSON.stringify({
    1: {
      userId: '1', username: 'tailsthehero10', displayName: 'tailsthehero10',
      password: hash.hash, passwordSalt: hash.salt, passwordVersion: hash.version,
      role: 'owner', membershipStatus: 'None', robux: 0,
      avatar: { bodyColors: { headColorId: 24, torsoColorId: 23 } },
      stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0 },
    },
  }));
  fs.writeFileSync(path.join(tempDataDir, 'games.json'), '{}');
  fs.writeFileSync(path.join(tempDataDir, 'places.json'), '{}');

  const server = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), LUCKYBLOX_DATA_DIR: tempDataDir, LUCKYBLOX_PREVIEW_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForReady(server);
    console.log('settings section urls\n');

    // --- Guests are redirected, and the section is preserved ---------------
    const guest = {};
    for (const slug of SECTIONS) {
      guest[slug] = await req(`/settings/${slug}`);
    }

    check('a signed-out visitor is sent to sign-in, not a 404', () => {
      for (const slug of SECTIONS) {
        const r = guest[slug];
        assert.strictEqual(r.statusCode, 302, `/settings/${slug} returned ${r.statusCode}`);
        assert.ok(
          String(r.headers.location || '').includes('redirect'),
          `/settings/${slug} did not preserve where the visitor was going`,
        );
      }
    });

    check('the section is kept in the redirect, not dropped', () => {
      for (const slug of SECTIONS) {
        const loc = String(guest[slug].headers.location || '');
        assert.ok(
          decodeURIComponent(loc).includes(`/settings/${slug}`),
          `/settings/${slug} redirected to "${loc}", losing the section`,
        );
      }
    });

    // --- Signed in: each URL renders ITS OWN panel -------------------------
    const login = await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
    });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    const pages = {};
    for (const slug of SECTIONS) {
      pages[slug] = await req(`/settings/${slug}`, { headers: { Cookie: cookie } });
    }

    check('every section returns 200 when signed in', () => {
      for (const slug of SECTIONS) {
        assert.strictEqual(pages[slug].statusCode, 200, `/settings/${slug} returned ${pages[slug].statusCode}`);
      }
    });

    check('each URL renders its OWN panel server-side, not always Profile', () => {
      // This is the part a client-side fix cannot cover: without the server
      // rendering the right panel, a refresh or a no-JS visit shows the wrong one.
      for (const slug of SECTIONS) {
        const shown = visiblePanels(pages[slug].body);
        assert.deepStrictEqual(
          shown,
          [slug],
          `/settings/${slug} rendered ${JSON.stringify(shown)} instead of ["${slug}"]`,
        );
      }
    });

    check('the nav uses real paths, not #hash links', () => {
      for (const slug of SECTIONS) {
        const html = pages[slug].body;
        assert.ok(
          !/class="settings-nav-link[^"]*"\s+role="tab"[^>]*href="#/.test(html),
          `/settings/${slug} still ships a #hash nav link`,
        );
        for (const target of SECTIONS) {
          assert.ok(
            html.includes(`href="/settings/${target}"`),
            `/settings/${slug} has no link to /settings/${target}`,
          );
        }
      }
    });

    check('the page tells the script which section is active', () => {
      // Without this the script cannot know where it is and falls back to Profile.
      for (const slug of SECTIONS) {
        assert.ok(
          new RegExp(`var BASE = "/settings"`).test(pages[slug].body)
          || /var BASE = "\/settings"/.test(pages[slug].body),
          `/settings/${slug} does not expose the base path to the script`,
        );
      }
    });

    // --- `/settings` itself -------------------------------------------------
    const root = await req('/settings', { headers: { Cookie: cookie } });
    check('/settings renders the first section by default', () => {
      assert.strictEqual(root.statusCode, 200);
      const shown = visiblePanels(root.body);
      assert.deepStrictEqual(shown, ['profile'], `default /settings showed ${JSON.stringify(shown)}`);
    });

    const queried = await req('/settings?tab=privacy', { headers: { Cookie: cookie } });
    check('/settings?tab=privacy redirects to the canonical path', () => {
      assert.strictEqual(queried.statusCode, 302, `expected a redirect, got ${queried.statusCode}`);
      assert.ok(
        String(queried.headers.location || '').includes('/settings/privacy'),
        `redirected to ${queried.headers.location}`,
      );
    });

    // --- Aliases the old nav referenced -------------------------------------
    for (const alias of ALIASES) {
      const r = await req(`/settings/${alias}`, { headers: { Cookie: cookie } });
      check(`/settings/${alias} resolves (alias) rather than 404ing`, () => {
        assert.strictEqual(r.statusCode, 200, `/settings/${alias} returned ${r.statusCode}`);
        assert.deepStrictEqual(visiblePanels(r.body), ['account'], 'the alias should open the account panel');
      });
    }

    // --- An unknown section is still a 404 ----------------------------------
    const bogus = await req('/settings/definitely-not-a-section', { headers: { Cookie: cookie } });
    check('an unknown section is still a 404', () => {
      assert.strictEqual(bogus.statusCode, 404, `expected 404, got ${bogus.statusCode}`);
    });
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(
    failures === 0
      ? '\nEvery /settings section is a real, refreshable, shareable URL.'
      : `\n${failures} FAILURE(S).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});