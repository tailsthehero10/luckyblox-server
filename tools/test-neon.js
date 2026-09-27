'use strict';
// Live check: connect to the real Neon database and round-trip a document.
// Usage: node tools/test-neon.js "<connection string>"
const store = require('../server/postgresStore');

(async () => {
  const conn = process.argv[2];
  if (!conn) {
    console.error('usage: node tools/test-neon.js "<connection string>"');
    process.exit(1);
  }
  process.env.DATABASE_URL = conn;

  // postgresStore reads DATABASE_URL at require time, so re-require it.
  delete require.cache[require.resolve('../server/postgresStore')];
  const pg = require('../server/postgresStore');

  console.log('enabled:', pg.ENABLED);

  const init = await pg.init();
  console.log('init:', init.ok ? 'schema ready' : `FAILED - ${init.error}`);
  if (!init.ok) process.exit(1);

  const probe = { __probe: true, at: new Date().toISOString(), answer: 42 };
  const wrote = await pg.writeDoc('__luckyblox_probe.json', probe);
  console.log('write:', wrote ? 'ok' : 'FAILED');

  const back = await pg.readDoc('__luckyblox_probe.json', null);
  console.log('read back:', back ? JSON.stringify(back) : 'null');
  console.log('round-trip:', back && back.answer === 42 ? 'PASS' : 'FAIL');

  const names = await pg.listDocs();
  console.log('documents in db:', names.length, names.slice(0, 10).join(', '));

  await pg.deleteDoc('__luckyblox_probe.json');
  const after = await pg.readDoc('__luckyblox_probe.json', 'GONE');
  console.log('delete:', after === 'GONE' ? 'PASS' : 'FAIL');

  console.log('\ndescribe:', JSON.stringify(pg.describe()));
  await pg.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });