'use strict';
// Read the live Neon database directly and report what it holds.
const conn = process.argv[2];
if (!conn) { console.error('usage: node tools/dump-neon.js "<conn>"'); process.exit(1); }
process.env.DATABASE_URL = conn;

const path = require('path');
// `pg` is installed in the bridge package, not at the repo root.
const pg = require(require.resolve('pg', {
  paths: [path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'node_modules')],
}));
(async () => {
  const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  const names = await pool.query('SELECT name, updated_at, pg_column_size(data) AS bytes FROM blobs ORDER BY name');
  console.log('rows in blobs table:', names.rows.length);
  for (const r of names.rows) {
    console.log(`  ${r.name.padEnd(26)} ${String(r.bytes).padStart(7)} bytes  ${r.updated_at.toISOString()}`);
  }

  const users = await pool.query("SELECT data FROM blobs WHERE name = 'users.json'");
  if (users.rows.length) {
    console.log('\naccounts in users.json:');
    for (const [id, u] of Object.entries(users.rows[0].data)) {
      console.log(`  id=${id}  ${u.username}  hash=${u.password ? 'yes' : 'NO'}  joined=${u.joinDate || '-'}`);
    }
  } else {
    console.log('\nusers.json row NOT found');
  }
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });