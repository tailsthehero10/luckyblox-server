i s'use strict';
// Local probe: sign up + sign in and report what each page really renders.
// Run: node tools/probe-local.js
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3001';

let cookie = '';

function storeCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    const others = cookie.split('; ').filter((p) => p && p.split('=')[0] !== name);
    others.push(pair);
    cookie = others.join('; ');
  }
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' });
  storeCookies(res);
  const body = await res.text();
  return { status: res.status, body, location: res.headers.get('location') };
}

async function post(path, fields) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
  storeCookies(res);
  const body = await res.text();
  return { status: res.status, body, location: res.headers.get('location') };
}

function csrfOf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

function report(label, r, checks) {
  const line = [`${label.padEnd(16)} ${r.status}`];
  if (r.location) line.push(`-> ${r.location}`);
  line.push(`len=${r.body.length}`);
  console.log('  ' + line.join('  '));
  if (checks) {
    for (const [name, fn] of Object.entries(checks)) {
      let ok = false;
      try { ok = fn(r.body); } catch (e) { ok = false; }
      console.log(`      ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    }
  }
}

(async () => {
  console.log('probing ' + BASE + '\n');

  const signupPage = await get('/signup');
  const signupCsrf = csrfOf(signupPage.body);
  const username = 'Probe' + Date.now().toString().slice(-6);

  const signup = await post('/signup', {
    username,
    password: 'localpass1',
    confirmPassword: 'localpass1',
    _csrf: signupCsrf,
    birthMonth: '1', birthDay: '1', birthYear: '2000',
    gender: 'NotSpecified',
  });
  report('POST /signup', signup, {
    'not an error page': (b) => !/not available|already taken|must be/i.test(b) || signup.status === 302,
  });
  console.log(`      (signed up as ${username})`);

  // If signup did not set a session, sign in explicitly.
  let home = await get('/');
  if (!/Log Out|Sign Out|accountMenuBtn/.test(home.body)) {
    const signinPage = await get('/signin');
    const signin = await post('/signin', {
      username, password: 'localpass1', _csrf: csrfOf(signinPage.body), redirect: '/',
    });
    report('POST /signin', signin);
    home = await get('/');
  }

  report('GET /', home, {
    'signed in (account menu)': (b) => /accountMenuBtn|Sign Out/.test(b),
    'has game rows (2013)': (b) => /games-list-container/.test(b),
    'uses game-item': (b) => /class="game-item"/.test(b),
    'no old lb-game-grid': (b) => !/lb-game-grid/.test(b),
  });

  const games = await get('/games');
  report('GET /games', games, {
    'is its own page (has rows)': (b) => /games-list-container/.test(b),
    'not the home template': (b) => !/lb-friends-strip/.test(b),
    'uses game-item': (b) => /class="game-item"/.test(b),
  });

  const avatar = await get('/avatar');
  report('GET /avatar', avatar, {
    'has svg render': (b) => /lb-avatar-svg/.test(b),
    'has polygons (real 3D)': (b) => /<polygon/.test(b),
    'no old blocky figure': (b) => !/lb-avatar-figure/.test(b),
    'inventory is NOT the whole catalog': (b) => (b.match(/roblox-asset-card/g) || []).length < 60,
    'page under 80KB': (b) => b.length < 80000,
  });

  for (const p of ['/settings', '/develop', '/create', '/catalog', '/badges', '/inventory', '/profile', '/friends']) {
    const r = await get(p);
    report(p, r);
  }
})().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });