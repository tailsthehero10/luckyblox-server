'use strict';
// Probe the LIVE LuckyBlox deployment to see which endpoints work and which 502.
// Run: node tools/live-probe.js

const BASE = process.env.LUCKYBLOX_LIVE_URL || 'https://luckyblox-server.onrender.com';

async function probe(label, path, options) {
  const url = BASE + path;
  const started = Date.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let body = text;
    try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
    console.log(`\n=== ${label} ===`);
    console.log(`${res.status} ${res.statusText} ${url} (${Date.now() - started}ms)`);
    console.log(body.slice(0, 900));
  } catch (error) {
    console.log(`\n=== ${label} ===`);
    console.log(`FAILED ${url}: ${error.message}`);
  }
}

(async () => {
  await probe('health', '/health');
  await probe('runtime (proxy self-report)', '/api/runtime-status');
  await probe('AppSettings', '/AppSettings.xml');
  await probe('catalog (bridge)', '/v1/games?page=1');
  await probe('users api (bridge)', '/api/users');
  await probe('launch-game', '/api/launch-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userId: 1, placeId: 1818 }),
  });
  await probe('Join.ashx (bridge)', '/game/Join.ashx?placeId=1818&userId=1&ticket=probe&serverPort=53640&jobId=probe');
})();
