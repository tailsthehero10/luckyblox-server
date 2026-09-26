'use strict';

/**
 * Minimal .env loader.
 *
 * Why this exists: `.env.example` documents every LUCKYBLOX_* setting, but
 * nothing ever read a `.env` file - there was no `dotenv` dependency and no
 * loader - so copying the example to `.env` silently did nothing. That is the
 * worst kind of configuration bug: the file looks authoritative and is ignored.
 *
 * This is deliberately dependency-free (the project ships no `dotenv`) and
 * deliberately conservative:
 *
 *   - An ALREADY-SET process.env value always wins, so a real environment
 *     variable (Render's dashboard, Docker, a shell export) is never overridden
 *     by a stray file. This is what makes the loader safe in the cloud.
 *   - Missing file is normal and silent - .env is optional.
 *   - Only KEY=VALUE lines are understood, with optional surrounding quotes.
 *     `#` starts a comment on its own line.
 *   - A malformed line is reported and skipped, never thrown, so a bad file
 *     cannot stop the server from booting.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse .env text into a plain object.
 *
 * Exported separately so it can be unit-tested without touching process.env or
 * the filesystem.
 */
function parseEnv(text) {
  const out = {};

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Allow a leading `export ` so a shell-style file also parses.
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;

    const eq = body.indexOf('=');
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = body.slice(eq + 1).trim();

    // Strip one layer of matching quotes. Unquoted values keep their content
    // verbatim, which matters for a token containing '#'.
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // An unquoted trailing comment (`KEY=value # note`) is dropped, but only
      // when the '#' is preceded by whitespace, so a token containing '#' intact.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }

  return out;
}

/**
 * Load `<root>/.env` into process.env.
 *
 * @param {string} rootDir directory holding the .env file
 * @returns {{loaded:boolean, file:string, applied:string[], skipped:string[]}}
 */
function loadEnvFile(rootDir) {
  const file = path.join(rootDir, '.env');
  const result = { loaded: false, file, applied: [], skipped: [] };

  let text;
  try {
    if (!fs.existsSync(file)) return result;
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.warn(`[luckyblox] could not read ${file}: ${error.message}`);
    return result;
  }

  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    // A real environment variable outranks the file.
    if (process.env[key] !== undefined && process.env[key] !== '') {
      result.skipped.push(key);
      continue;
    }
    process.env[key] = value;
    result.applied.push(key);
  }

  result.loaded = true;
  return result;
}

module.exports = { loadEnvFile, parseEnv };