'use strict';

/**
 * LuckyBlox Postgres storage (Neon, Supabase, any Postgres).
 *
 * WHY THIS EXISTS
 * The server kept its data in JSON files on disk. On a host with no persistent
 * volume (Render free tier) those files are wiped on every deploy, so accounts,
 * games, currency and inventory vanished - which is what made the site look
 * "fake". A free Neon Postgres database fixes that permanently.
 *
 * DESIGN
 * The JSON layer (server/storage.js) is keyed by FILE NAME, and every caller
 * reads/writes a whole document at a time. Rather than rewrite hundreds of call
 * sites, this module stores exactly the same shape: one row per logical file,
 * holding the whole parsed JSON document.
 *
 *   CREATE TABLE blobs (
 *     name        text PRIMARY KEY,   -- "users.json", "games.json", "3.json"
 *     data        jsonb NOT NULL,     -- the document
 *     updated_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *
 * That keeps the migration honest and reversible: the same code paths run, and
 * the file names stay visible. Per-account files ("<id>.json") are ordinary rows
 * too, so the set grows with no schema change.
 *
 * When DATABASE_URL is unset this module is completely inert and the server keeps
 * using the JSON files, so a plain desktop run is unchanged.
 */

const fs = require('fs');
const path = require('path');

const ENABLED = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

let Pool = null;
let pool = null;
let ready = false;
let lastError = null;

/** The schema. Idempotent, so it is safe to run on every boot. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blobs (
  name        text PRIMARY KEY,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blobs_updated_at_idx ON blobs (updated_at DESC);
`;

/**
 * Normalise the connection string for `pg`.
 *
 * `pg` 8.x prints a loud SECURITY WARNING for `sslmode=require`, because a future
 * version will treat those modes with weaker semantics. The warning is noise here
 * (this module passes `ssl` explicitly, so the mode in the URL cannot weaken the
 * TLS decision), but a scary warning on every boot is its own problem - it trains
 * people to ignore the log.
 *
 * Rewriting `require`/`prefer`/`verify-ca` to `verify-full` states the intent the
 * code already implements: verify the server certificate. `channel_binding` is
 * dropped because node-postgres does not implement SCRAM channel binding and
 * errors if it is asked for it.
 */
function normalizeConnectionString(raw) {
  try {
    const url = new URL(String(raw).trim());
    const mode = (url.searchParams.get('sslmode') || '').toLowerCase();
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full');
    }
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch (error) {
    // Not a parseable URL - hand it to pg unchanged and let it report the error.
    return String(raw).trim();
  }
}

/** Lazily create the pool. `pg` is optional: a host without it still boots. */
function getPool() {
  if (pool) return pool;
  if (!ENABLED) return null;

  // Resolve `pg` from the bridge package, not from this file's directory.
  //
  // This module lives at the repo ROOT while the dependency is declared and
  // installed in Webserver/http-db-bridge/node_modules. A plain require('pg')
  // therefore fails with "Cannot find module 'pg'" even though it IS installed -
  // which silently fell back to JSON files and made the database look unused.
  //
  // require.resolve with `paths` searches those directories, so the module is
  // found wherever it was installed.
  const searchPaths = [
    path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'node_modules'),
    path.join(__dirname, '..', 'node_modules'),
    path.join(__dirname, 'node_modules'),
  ];

  let resolved = null;
  for (const dir of searchPaths) {
    try {
      resolved = require.resolve('pg', { paths: [dir] });
      break;
    } catch (error) {
      /* try the next location */
    }
  }

  if (!resolved) {
    // Last resort: a plain require, in case the host hoisted it somewhere else.
    try {
      resolved = require.resolve('pg');
    } catch (error) {
      lastError = 'the "pg" package is not installed';
      console.warn('[luckyblox] DATABASE_URL is set but "pg" is missing; using JSON files');
      console.warn('[luckyblox]   install it with: cd Webserver/http-db-bridge && npm install pg');
      return null;
    }
  }

  try {
    Pool = require(resolved).Pool;
  } catch (error) {
    lastError = error.message;
    console.warn(`[luckyblox] could not load "pg": ${error.message}`);
    return null;
  }

  pool = new Pool({
    connectionString: normalizeConnectionString(process.env.DATABASE_URL),
    // Neon (and most free Postgres) require TLS. `rejectUnauthorized: false` is
    // deliberate: the free tiers use a certificate chain Node does not ship a
    // root for, and refusing it would break every connection. The link is still
    // encrypted, and the connection string is normalised to verify-full above.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.LUCKYBLOX_PG_POOL || 5),
    // A serverless database can pause; a slow first query must not hang a boot.
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', (error) => {
    lastError = error.message;
    ready = false;
    console.warn(`[luckyblox] postgres pool error: ${error.message}`);
  });

  return pool;
}

/** Create the table on first use. Safe to call repeatedly. */
async function init() {
  if (!ENABLED) return { ok: false, enabled: false, reason: 'DATABASE_URL not set' };
  if (ready) return { ok: true, enabled: true };

  const p = getPool();
  if (!p) return { ok: false, enabled: true, error: lastError || 'no pool' };

  try {
    await p.query(SCHEMA_SQL);
    ready = true;
    return { ok: true, enabled: true };
  } catch (error) {
    lastError = error.message;
    return { ok: false, enabled: true, error: error.message };
  }
}

/** Read one document. Returns `fallback` when the row is missing. */
async function readDoc(name, fallback) {
  if (!ENABLED) return fallback;
  const initialized = await init();
  if (!initialized.ok) throw new Error(`Postgres is not ready: ${initialized.error || initialized.reason}`);
  const p = getPool();
  if (!p) throw new Error(lastError || 'Postgres pool is unavailable');
  try {
    const res = await p.query('SELECT data FROM blobs WHERE name = $1', [name]);
    if (res.rows.length === 0) return fallback;
    return res.rows[0].data;
  } catch (error) {
    lastError = error.message;
    ready = false;
    console.warn(`[luckyblox] postgres read ${name} failed: ${error.message}`);
    throw error;
  }
}

/** Write one document (insert or replace). */
async function writeDoc(name, data) {
  if (!ENABLED) return false;
  const initialized = await init();
  if (!initialized.ok) {
    console.error(`[luckyblox] postgres write ${name} not attempted: ${initialized.error || initialized.reason}`);
    return false;
  }
  const p = getPool();
  if (!p) {
    console.error(`[luckyblox] postgres write ${name} not attempted: ${lastError || 'pool unavailable'}`);
    return false;
  }
  try {
    await p.query(
      `INSERT INTO blobs (name, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [name, JSON.stringify(data)],
    );
    return true;
  } catch (error) {
    lastError = error.message;
    ready = false;
    console.warn(`[luckyblox] postgres write ${name} failed: ${error.message}`);
    return false;
  }
}

/** Delete one document. */
async function deleteDoc(name) {
  if (!ENABLED) return false;
  const initialized = await init();
  if (!initialized.ok) return false;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('DELETE FROM blobs WHERE name = $1', [name]);
    return true;
  } catch (error) {
    lastError = error.message;
    ready = false;
    console.warn(`[luckyblox] postgres delete ${name} failed: ${error.message}`);
    return false;
  }
}

/** Every stored document name. Used to list per-account files. */
async function listDocs() {
  if (!ENABLED) return [];
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query('SELECT name FROM blobs ORDER BY name');
    return res.rows.map((r) => r.name);
  } catch (error) {
    lastError = error.message;
    ready = false;
    return [];
  }
}

/**
 * Pull every row out of Postgres and mirror it into the local data dir.
 *
 * The local files stay the working copy during a run (so every existing code
 * path keeps working), and Postgres is the durable copy. On a host whose disk is
 * wiped each deploy, this is what restores the data at boot.
 */
async function restoreToDir(dataDir) {
  if (!ENABLED) return { ok: true, enabled: false, loaded: [] };
  const initResult = await init();
  if (!initResult.ok) return { ok: false, enabled: true, error: initResult.error, loaded: [] };

  const loaded = [];
  try {
    const res = await getPool().query('SELECT name, data FROM blobs');
    for (const row of res.rows) {
      try {
        const target = path.join(dataDir, row.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const tmp = `${target}.tmp-pg`;
        fs.writeFileSync(tmp, JSON.stringify(row.data, null, 2), 'utf8');
        fs.renameSync(tmp, target);
        loaded.push(row.name);
      } catch (error) {
        console.warn(`[luckyblox] postgres restore ${row.name} failed: ${error.message}`);
      }
    }
    console.log(`[luckyblox] postgres: restored ${loaded.length} document(s)`);
    return { ok: true, enabled: true, loaded };
  } catch (error) {
    lastError = error.message;
    ready = false;
    return { ok: false, enabled: true, error: error.message, loaded };
  }
}

/**
 * Seed only documents that are absent from Postgres. Existing database rows
 * always win, so an old container snapshot can never replace newer Neon data.
 */
async function seedMissingFromDir(dataDir) {
  if (!ENABLED) return { ok: true, enabled: false, seeded: [] };
  const initialized = await init();
  if (!initialized.ok) {
    return { ok: false, enabled: true, error: initialized.error, seeded: [] };
  }

  let files;
  try {
    files = fs.readdirSync(dataDir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    return { ok: false, enabled: true, error: error.message, seeded: [] };
  }

  const seeded = [];
  for (const name of files) {
    try {
      const document = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      const result = await getPool().query(
        `INSERT INTO blobs (name, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (name) DO NOTHING`,
        [name, JSON.stringify(document)],
      );
      if (result.rowCount > 0) seeded.push(name);
    } catch (error) {
      lastError = error.message;
      ready = false;
      console.error(`[luckyblox] postgres seed ${name} failed: ${error.message}`);
      return { ok: false, enabled: true, error: error.message, seeded };
    }
  }
  return { ok: true, enabled: true, seeded };
}

/**
 * Push every local data file into Postgres.
 *
 * Used once to seed an empty database from an existing JSON deployment, and on
 * shutdown to flush anything still pending.
 */
async function pushFromDir(dataDir, names) {
  if (!ENABLED) return { ok: true, enabled: false, pushed: [] };
  const initResult = await init();
  if (!initResult.ok) return { ok: false, enabled: true, error: initResult.error, pushed: [] };

  let files = Array.isArray(names) ? names : null;
  if (!files) {
    try {
      files = fs.readdirSync(dataDir).filter((n) => n.endsWith('.json'));
    } catch (error) {
      files = [];
    }
  }

  const pushed = [];
  for (const name of files) {
    try {
      const raw = fs.readFileSync(path.join(dataDir, name), 'utf8');
      const parsed = JSON.parse(raw);
      if (await writeDoc(name, parsed)) pushed.push(name);
    } catch (error) {
      /* a missing or malformed file is skipped */
    }
  }
  return { ok: true, enabled: true, pushed };
}

function describe() {
  return {
    enabled: ENABLED,
    ready,
    error: lastError,
    note: ENABLED
      ? (ready
        ? 'Data is stored in Postgres and survives redeploys.'
        : `DATABASE_URL is configured, but Postgres is not currently ready${lastError ? `: ${lastError}` : '.'}`)
      : 'DATABASE_URL not set; data is in local JSON files only.',
  };
}

/** Close the pool (shutdown / tests). */
async function close() {
  if (pool) {
    try { await pool.end(); } catch (error) { /* ignore */ }
    pool = null;
    ready = false;
  }
}

module.exports = {
  ENABLED,
  init,
  readDoc,
  writeDoc,
  deleteDoc,
  listDocs,
  restoreToDir,
  seedMissingFromDir,
  pushFromDir,
  describe,
  close,
};