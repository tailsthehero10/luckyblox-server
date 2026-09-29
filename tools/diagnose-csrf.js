'use strict';
// Diagnose the 403 on POST /api/login: is a CSRF token issued, and does the
// request carry one?
const http = require('http');

const PORT = Number(process.argv[2]) || 39001;

function rq(pathName, opts) {
  return new Promise((resolve, reject) => {
    const q = http.request(
      Object.assign({ hostname: '127.0.0.1', port: PORT, path: pathName }, opts || {}),
      (x) => {
        let d = '';
        x.on('data', (v) => (d += v));
        x.on('end', () => resolve({ s: x.statusCode, sc: x.headers['set-cookie'] || [], b: d }));
      },
    );
    q.on('error', reject);
    if (opts && opts.body) q.write(opts.body);
    q.end();
  });
}

(async () => {
  const g = await rq('/signin');
  console.log('GET /signin:', g.s);
  console.log('  cookies set:', g.sc.map((c) => c.split('=')[0]).join(', ') || '(none)');

  const meta = /name="csrf-token"\s+content="([^"]+)"/.exec(g.b);
  const field = /name="_csrf"[^>]*value="([^"]+)"/.exec(g.b);
  console.log('  meta csrf   :', meta ? meta[1].slice(0, 30) + '...' : 'NOT FOUND');
  console.log('  form _csrf  :', field ? field[1].slice(0, 30) + '...' : 'NOT FOUND');

  const jar = g.sc.map((c) => c.split(';')[0]).join('; ');
  console.log('  jar:', jar || '(empty)');

  // 1. No token at all.
  const p1 = await rq('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('POST /api/login, no csrf  :', p1.s, p1.b.slice(0, 110));

  // 2. With the token as a header, and the session cookie.
  if (meta) {
    const p2 = await rq('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'tailsthehero10', password: '@pass@.lovely10' }),
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': meta[1], Cookie: jar },
    });
    console.log('POST /api/login, +csrf hdr:', p2.s, p2.b.slice(0, 110));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});