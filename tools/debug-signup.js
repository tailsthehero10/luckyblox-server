'use strict';
// Debug: perform a real signup and print the raw response.
const BASE = 'http://127.0.0.1:3001';

(async () => {
  let cookie = '';
  const keep = (res) => {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      cookie = cookie.split('; ').filter((p) => p && p.split('=')[0] !== name).concat(pair).join('; ');
    }
  };

  const page = await fetch(BASE + '/signup');
  keep(page);
  const html = await page.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrf = m ? m[1] : '';
  console.log('csrf token length:', csrf.length);
  console.log('cookie:', cookie.slice(0, 60));

  const res = await fetch(BASE + '/signup', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: 'NeonUser' + Date.now().toString().slice(-5),
      password: 'LocalPass1',
      confirmPassword: 'LocalPass1',
      _csrf: csrf,
      birthMonth: '1', birthDay: '1', birthYear: '2000',
      gender: 'NotSpecified',
    }).toString(),
    redirect: 'manual',
  });
  keep(res);
  const body = await res.text();
  console.log('\nstatus:', res.status);
  console.log('location:', res.headers.get('location'));
  console.log('content-type:', res.headers.get('content-type'));
  console.log('body length:', body.length);
  if (body.length) {
    const err = body.match(/class="auth-error"[^>]*>([\s\S]{0,300}?)<\/div>/);
    console.log('auth-error:', err ? err[1].replace(/\s+/g, ' ').trim() : '(none)');
    const title = body.match(/<title>([^<]*)<\/title>/);
    console.log('title:', title ? title[1] : '(none)');
  } else {
    console.log('BODY IS EMPTY - the request never reached the route renderer');
  }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });