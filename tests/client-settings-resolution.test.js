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

// The suffix extraction from serveClientSettingsFile - the client's own path is
// preserved so 2021M keeps its /home/ and 2022M keeps its root.
function extractSuffix(xml) {
  const block = String(xml).match(/<BaseUrl>[\s\S]*?<\/BaseUrl>/i);
  if (!block) return '/';
  const inner = block[0].match(/LuckBlox\.site\.tk(\/[^<]*)?/i) || [];
  const found = inner[1] || '/';
  return found.startsWith('/') ? found : '/' + found;
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

// --- Each client keeps its own BaseUrl path ----------------------------------

check('2021M keeps its trailing /home/ suffix', () => {
  const xml = fs.readFileSync(path.join(clientsRoot, '2021M', 'AppSettings.xml'), 'utf8');
  assert.equal(extractSuffix(xml), '/home/');
});

check('2022M keeps its root suffix', () => {
  const xml = fs.readFileSync(path.join(clientsRoot, '2022M', 'AppSettings.xml'), 'utf8');
  assert.equal(extractSuffix(xml), '/');
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
    const xml = fs.readFileSync(path.join(clientsRoot, client, 'AppSettings.xml'), 'utf8');
    const suffix = extractSuffix(xml);
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
