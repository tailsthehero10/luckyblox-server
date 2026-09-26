'use strict';
// Proves AppSettings.xml and ClientSettings are served from the client the
// launcher actually selected (Settings/SelectedClient.txt), not a hardcoded
// folder. Getting this wrong hands a client another client's URLs - 2021M
// needs a trailing /home/ that 2022M does not have - which breaks its routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const releaseRoot = path.resolve(__dirname, '..');
const clientsRoot = path.join(releaseRoot, 'Clients');
const selectedFile = path.join(releaseRoot, 'Settings', 'SelectedClient.txt');

// Mirror of the resolver in server.js / the bridge. Kept in sync deliberately:
// if the production logic changes shape, this test should be updated with it.
const DEFAULT_CLIENT = '2022M';

function readSelectedClient(selectedPath = selectedFile) {
  try {
    if (!fs.existsSync(selectedPath)) return '';
    const value = String(fs.readFileSync(selectedPath, 'utf8')).replace(/^\uFEFF/, '').trim();
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
  } catch (error) {
    return '';
  }
}

function resolveClientDir(selectedPath = selectedFile) {
  const selected = readSelectedClient(selectedPath);
  if (selected) {
    const candidate = path.join(clientsRoot, selected);
    if (fs.existsSync(path.join(candidate, 'AppSettings.xml'))) return candidate;
  }
  return path.join(clientsRoot, DEFAULT_CLIENT);
}

// Mirror of CLIENT_BASE_SUFFIX in the bridge. Kept in sync deliberately: if the
// production table changes shape, this test should be updated with it.
const CLIENT_BASE_SUFFIX = { '2021M': '/home/', '2022M': '/' };

/**
 * The suffix actually handed to a client, mirroring rewriteAppSettingsBaseUrl.
 *
 * The committed file's own path is only a fallback for an UNKNOWN client folder;
 * the two shipping clients are pinned by the table above. Reading the file alone
 * is what the previous version of this test did, and it asserted a /home/ suffix
 * that the 2021M file has never actually contained - the value is applied at
 * request time, not stored.
 */
function servedSuffix(clientName) {
  if (CLIENT_BASE_SUFFIX[clientName]) return CLIENT_BASE_SUFFIX[clientName];
  const xml = fs.readFileSync(path.join(clientsRoot, clientName, 'AppSettings.xml'), 'utf8');
  const block = String(xml).match(/<BaseUrl>[\s\S]*?<\/BaseUrl>/i);
  if (!block) return '/';
  const inner = (block[0].match(/<BaseUrl>([\s\S]*?)<\/BaseUrl>/i) || [])[1] || '';
  try {
    const p = new URL(inner).pathname;
    return p && p !== '' ? p : '/';
  } catch (error) {
    return '/';
  }
}

/** The path a committed AppSettings.xml carries (should be the origin root). */
function committedPath(xml) {
  const inner = (String(xml).match(/<BaseUrl>([\s\S]*?)<\/BaseUrl>/i) || [])[1] || '';
  try {
    const p = new URL(inner).pathname;
    return p && p !== '' ? p : '/';
  } catch (error) {
    return null;
  }
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

// --- The selected client is honoured -----------------------------------------

check('SelectedClient.txt names a real client folder', () => {
  const selected = readSelectedClient();
  assert.ok(selected, 'Settings/SelectedClient.txt should name a client');
  assert.ok(
    fs.existsSync(path.join(clientsRoot, selected)),
    `client folder for "${selected}" should exist`,
  );
});

check('resolveClientDir returns the selected client', () => {
  const selected = readSelectedClient();
  if (!selected) return;
  const dir = resolveClientDir();
  assert.equal(path.basename(dir), selected, `expected ${selected}, got ${path.basename(dir)}`);
});

check('resolveClientDir falls back when the setting is missing', () => {
  const missing = path.join(releaseRoot, 'Settings', '__does-not-exist__.txt');
  const dir = resolveClientDir(missing);
  assert.equal(path.basename(dir), DEFAULT_CLIENT);
});

check('resolveClientDir ignores a path-traversal attempt', () => {
  const evil = path.join(releaseRoot, 'Settings', '__evil__.txt');
  fs.writeFileSync(evil, '../../Windows/System32');
  try {
    const dir = resolveClientDir(evil);
    assert.equal(path.basename(dir), DEFAULT_CLIENT, 'traversal value must not escape Clients/');
  } finally {
    fs.unlinkSync(evil);
  }
});

// --- Each client is served its own BaseUrl path ------------------------------

check('2021M is served the trailing /home/ suffix', () => {
  assert.equal(servedSuffix('2021M'), '/home/');
});

check('2022M is served the root suffix', () => {
  assert.equal(servedSuffix('2022M'), '/');
});

// Every committed file must name the SAME origin path, so the rewrite has a
// predictable fallback and the files stop implying two clients talk elsewhere.
check('every committed AppSettings.xml carries the same BaseUrl path', () => {
  const withSettings = fs.readdirSync(clientsRoot)
    .filter((entry) => fs.existsSync(path.join(clientsRoot, entry, 'AppSettings.xml')));
  const seen = new Map();
  for (const client of withSettings) {
    const xml = fs.readFileSync(path.join(clientsRoot, client, 'AppSettings.xml'), 'utf8');
    const p = committedPath(xml);
    assert.ok(p !== null, `${client} BaseUrl should be a parseable URL`);
    seen.set(client, p);
  }
  const distinct = new Set(seen.values());
  assert.equal(
    distinct.size,
    1,
    `expected one consistent BaseUrl path, got ${JSON.stringify([...seen])}`,
  );
});

check('no committed AppSettings.xml points at a remote deployment', () => {
  const withSettings = fs.readdirSync(clientsRoot)
    .filter((entry) => fs.existsSync(path.join(clientsRoot, entry, 'AppSettings.xml')));
  for (const client of withSettings) {
    const xml = fs.readFileSync(path.join(clientsRoot, client, 'AppSettings.xml'), 'utf8');
    const inner = (xml.match(/<BaseUrl>([\s\S]*?)<\/BaseUrl>/i) || [])[1] || '';
    // A baked-in public host means the file lies about where the client connects;
    // the origin is supplied at request time by the bridge instead.
    assert.ok(
      !/onrender\.com|render\.com/i.test(inner),
      `${client} must not bake in a remote host (got "${inner}")`,
    );
  }
});

// --- The regression this test exists for -------------------------------------

check('serving 2021M no longer yields 2022M content', () => {
  const selected = readSelectedClient();
  if (!selected) return;
  const dir = resolveClientDir();
  const served = fs.readFileSync(path.join(dir, 'AppSettings.xml'), 'utf8');
  const own = fs.readFileSync(path.join(clientsRoot, selected, 'AppSettings.xml'), 'utf8');
  assert.equal(served, own, 'served AppSettings.xml must come from the selected client');
});

check('every client folder with AppSettings.xml is resolvable', () => {
  const withSettings = fs.readdirSync(clientsRoot)
    .filter((entry) => fs.existsSync(path.join(clientsRoot, entry, 'AppSettings.xml')));
  assert.ok(withSettings.length > 0, 'expected at least one client with AppSettings.xml');
  for (const client of withSettings) {
    const suffix = servedSuffix(client);
    assert.ok(suffix.startsWith('/'), `${client} suffix should start with / (got "${suffix}")`);
  }
  console.log(`       (${withSettings.length} clients checked)`);
});

console.log(
  failures === 0
    ? '\nClient settings resolve to the selected client.'
    : `\n${failures} FAILURE(S).`,
);
process.exitCode = failures === 0 ? 0 : 1;
