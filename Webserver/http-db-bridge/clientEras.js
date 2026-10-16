'use strict';

/**
 * Client eras.
 *
 * LuckyBlox ships a player build for every era of Roblox it revives, and a game
 * is only playable on a client whose build is new enough to understand it. This
 * module is the ONE place that answers "which eras exist?" and "which era does a
 * given client folder belong to?".
 *
 * The list is DERIVED FROM DISK, never hardcoded: it walks `Clients/` and keeps
 * every folder that actually contains a player binary. Two consequences worth
 * knowing:
 *
 *   - Dropping a new client folder in makes its year appear everywhere (the game
 *     settings picker, the statistics rows) with no code change.
 *   - Folders that are NOT players are excluded automatically. That matters:
 *     `Clients/2022M` holds RobloxStudioBeta.exe (the Studio editor) and
 *     `Clients/2021E` is a server, and `2008M`/`2015L`/`2016L`/`2017M`/`2020L` are
 *     empty stubs. Offering any of those as a playable "year" would promise a
 *     user a client that cannot run the game.
 *
 * A folder's era is the 4-digit year in its name (`2013L` -> 2013,
 * `CUSTOM-2021M` -> 2021). A folder with no year in its name is skipped rather
 * than guessed at, because an invented year would be a lie in the UI.
 */

const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..', '..');
const clientsRoot = path.join(releaseRoot, 'Clients');

const PLAYER_BINARY = process.platform === 'win32' ? 'RobloxPlayerBeta.exe' : 'RobloxPlayerBeta';

/**
 * The year a client folder name belongs to, or null.
 *
 * `2013L` -> 2013, `CUSTOM-2021M` -> 2021, `2018E` -> 2018. Deliberately NOT a
 * bare `match(/\d{4}/)`: `Client_2013_beta` should work but `v2_013` should not,
 * so the digits must be a standalone group.
 */
function yearFromClientName(name) {
  const match = String(name || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : null;
}

/** True when this client folder actually carries a playable binary. */
function hasPlayerBinary(clientDir) {
  const candidates = [
    path.join(clientDir, PLAYER_BINARY),
    path.join(clientDir, 'Player', PLAYER_BINARY),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
    } catch (error) {
      /* try the next layout */
    }
  }
  return false;
}

let cachedEras = null;

/**
 * Every era that can actually be played, newest first.
 *
 * Each entry carries the client folders that provide it, so a caller can name
 * the exact build rather than only the year.
 *
 * @returns {Array<{year:number, clients:string[], label:string}>}
 */
function listClientEras() {
  if (cachedEras) return cachedEras;

  const byYear = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(clientsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    entries = [];
  }

  for (const name of entries) {
    const dir = path.join(clientsRoot, name);
    const year = yearFromClientName(name);
    if (year === null) continue;
    if (!hasPlayerBinary(dir)) continue;

    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(name);
  }

  cachedEras = [...byYear.entries()]
    .map(([year, clients]) => ({
      year,
      clients: clients.slice().sort(),
      label: String(year),
    }))
    .sort((a, b) => b.year - a.year);

  return cachedEras;
}

/** Just the years, newest first. */
function listClientYears() {
  return listClientEras().map((era) => era.year);
}

/**
 * The newest era on disk. Used as the default for a game that has not picked one
 * yet, so a freshly created game is playable by default rather than unplayable.
 */
function defaultClientYear() {
  const years = listClientYears();
  return years.length ? years[0] : null;
}

/**
 * Coerce a stored value into a year that actually exists on disk.
 *
 * Returns null when the value names no real era, so a caller can fall back to
 * the default instead of rendering "Year: 1997" for a typo'd or stale setting.
 */
function normalizeClientYear(value) {
  const year = Number(String(value === undefined || value === null ? '' : value).trim());
  if (!Number.isSafeInteger(year)) return null;
  return listClientYears().includes(year) ? year : null;
}

/**
 * The era to DISPLAY for a game.
 *
 * Falls back to the newest era so the statistics row always shows a real year
 * rather than blank, and a game saved before this field existed still reads
 * sensibly.
 */
function resolveClientYear(value) {
  return normalizeClientYear(value) || defaultClientYear();
}

/** Drop the memoised list (tests, and after a client folder is added at runtime). */
function resetClientEraCache() {
  cachedEras = null;
}

module.exports = {
  clientsRoot,
  PLAYER_BINARY,
  yearFromClientName,
  hasPlayerBinary,
  listClientEras,
  listClientYears,
  defaultClientYear,
  normalizeClientYear,
  resolveClientYear,
  resetClientEraCache,
};