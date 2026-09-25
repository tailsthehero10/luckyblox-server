'use strict';

/**
 * Proves the GitHub backend's bootstrapping logic against a FAKE GitHub API.
 *
 * The storage repo (tailsthehero10/Luckyblox-Storage-1) exists but has NO commits,
 * so there is no `main` branch yet. A naive implementation PUTs to a branch that
 * does not exist and gets a 422 - the first write fails and nothing ever syncs.
 * The code must instead detect the missing branch and create the first commit
 * without a parent, which is what this test pins down.
 *
 * It also checks the batching: several changed files must become ONE commit via
 * the Git Data API (blobs -> tree -> commit -> ref), not one commit per file.
 *
 * Run: node tests/remoteStore-github.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  - ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL  - ${name}\n        ${error.message}`);
      process.exitCode = 1;
    });
}

// --- Fake GitHub API --------------------------------------------------------
// Starts with NO branches, exactly like the real empty repo.
let branches = {};
let blobs = {};       // sha -> base64 content
let commits = [];
let trees = [];
const requests = [];

let blobSeq = 0;
let treeSeq = 0;
let commitSeq = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = req.url;
    requests.push(`${req.method} ${url}`);
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const notFound = () => send(404, { message: 'Not Found' });

    // Repo metadata - reports the default branch even when it does not exist yet.
    if (req.method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return send(200, { default_branch: 'main' });
    }

    // Does the branch exist? (empty repo -> 404, which is the whole point)
    let m = url.match(/\/repos\/[^/]+\/[^/]+\/branches\/(.+)$/);
    if (req.method === 'GET' && m) {
      const name = decodeURIComponent(m[1]);
      if (branches[name]) return send(200, { name });
      return notFound();
    }

    // Current commit for a branch.
    m = url.match(/\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/);
    if (req.method === 'GET' && m) {
      const name = decodeURIComponent(m[1]);
      if (branches[name]) return send(200, { object: { sha: branches[name] } });
      return notFound();
    }

    // Read a file's content. Real GitHub returns base64 PLUS an `encoding` field;
    // omitting the field makes the client treat base64 as UTF-8 text, which is a
    // bug in the FAKE, not in the code under test.
    m = url.match(/\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/);
    if (req.method === 'GET' && m) {
      const filePath = decodeURIComponent(m[1]);
      const found = commits.slice().reverse().find((c) => c.files[filePath]);
      if (!found) return notFound();
      return send(200, { content: found.files[filePath], encoding: 'base64' });
    }

    // Create a blob.
    if (req.method === 'POST' && /\/git\/blobs$/.test(url)) {
      const parsed = JSON.parse(body);
      const sha = `blob${++blobSeq}`;
      blobs[sha] = parsed.content;
      return send(201, { sha });
    }

    // Create a tree.
    if (req.method === 'POST' && /\/git\/trees$/.test(url)) {
      const parsed = JSON.parse(body);
      const sha = `tree${++treeSeq}`;
      trees.push({ sha, items: parsed.tree, base_tree: parsed.base_tree });
      return send(201, { sha });
    }

    // Create a commit.
    if (req.method === 'POST' && /\/git\/commits$/.test(url)) {
      const parsed = JSON.parse(body);
      const sha = `commit${++commitSeq}`;
      const treeRecord = trees.find((t) => t.sha === parsed.tree);
      const files = {};
      for (const item of (treeRecord ? treeRecord.items : [])) {
        files[item.path] = item.sha === null ? null : blobs[item.sha];
      }
      commits.push({ sha, parents: parsed.parents || [], files, message: parsed.message });
      return send(201, { sha });
    }

    // Create or update a branch ref.
    if (req.method === 'POST' && /\/git\/refs\/heads\//.test(url)) {
      const parsed = JSON.parse(body);
      const name = String(parsed.ref || '').replace('refs/heads/', '');
      branches[name] = parsed.sha;
      return send(201, { ref: parsed.ref, object: { sha: parsed.sha } });
    }
    if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(url)) {
      const name = decodeURIComponent(url.split('/git/refs/heads/')[1]);
      const parsed = JSON.parse(body);
      branches[name] = parsed.sha;
      return send(200, { object: { sha: parsed.sha } });
    }

    return send(500, { message: `unhandled ${req.method} ${url}` });
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  process.env.LUCKYBLOX_SYNC = 'github';
  process.env.LUCKYBLOX_SYNC_TOKEN = 'test-token';
  process.env.LUCKYBLOX_SYNC_REPO = 'owner/repo';

  const remoteStore = require('../server/remoteStore');
  // Point the GitHub API at the fake server.
  remoteStore.__setApiBaseForTests(`http://127.0.0.1:${port}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckyblox-gh-'));

  console.log('remoteStore.js (github backend)');

  await test('reports the github backend and the configured repo', () => {
    assert.strictEqual(remoteStore.enabled, true);
    const d = remoteStore.describe();
    assert.strictEqual(d.mode, 'github');
    assert.strictEqual(d.repo, 'owner/repo');
  });

  await test('the FIRST push bootstraps an empty repo (no branch yet)', async () => {
    // This is the case a naive Contents-API PUT fails: there is no `main` branch,
    // so writing to it 422s and nothing is ever stored.
    assert.deepStrictEqual(branches, {}, 'the repo must start empty for this test');

    await remoteStore.saveFile('users.json', { '1': { username: 'first' } });
    const result = await remoteStore.flush();

    assert.strictEqual(result.ok, true);
    assert.ok(branches.main, 'the first commit must create the main branch');
    assert.strictEqual(commits.length, 1, 'exactly one commit');
    assert.strictEqual(commits[0].parents.length, 0, 'the first commit has no parent');
  });

  await test('several changed files become ONE commit, not one per file', async () => {
    const before = commits.length;
    remoteStore.saveFile('users.json', { '1': { username: 'second' } });
    remoteStore.saveFile('games.json', { '1818': { title: 'Arena' } });
    remoteStore.saveFile('assets.json', { '1001': { name: 'Hat' } });
    const result = await remoteStore.flush();

    assert.strictEqual(result.ok, true);
    assert.strictEqual(commits.length - before, 1, 'expected a single batched commit');
    assert.ok(commits[commits.length - 1].parents.length === 1, 'later commits have a parent');
  });

  await test('a second push updates the existing branch', async () => {
    const before = branches.main;
    await remoteStore.saveFile('games.json', { '1818': { title: 'Renamed' } });
    await remoteStore.flush();
    assert.notStrictEqual(branches.main, before, 'the branch moved to the new commit');
    assert.ok(
      requests.some((r) => r.startsWith('PATCH') && r.includes('/git/refs/heads/')),
      'an existing branch is updated with PATCH',
    );
  });

  await test('reading a file back returns what was written', async () => {
    // Note the parentheses: `await fn ? a : b` parses as `(await fn) ? a : b`, which
    // awaits the function object, not its result.
    const games = await remoteStore.__githubPullForTests('games.json');
    assert.ok(games, 'the file should be readable from the store');
    assert.strictEqual(games['1818'].title, 'Renamed');
  });

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  server.close();

  console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
  process.exit(process.exitCode || 0);
})();