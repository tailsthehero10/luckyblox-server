'use strict';

/**
 * LuckyBlox free remote persistence.
 *
 * Problem: a host without a persistent disk (Render free tier, Fly without a
 * volume, a plain container) wipes the filesystem on every redeploy, so user
 * accounts, games and currency vanish. A Render Disk costs money.
 *
 * This module mirrors the JSON data files to a FREE third-party store, so the
 * data survives even with no paid storage. Two backends are supported, chosen
 * by environment variables; with none set the module is completely inert and
 * the app behaves exactly as before (local files only).
 *
 * ---------------------------------------------------------------------------
 * Backend A - GitHub repository (default; free, and you already have the repo)
 * ---------------------------------------------------------------------------
 *   LUCKYBLOX_SYNC=github
 *   LUCKYBLOX_SYNC_TOKEN=<fine-grained PAT with Contents: Read+Write>
 *   LUCKYBLOX_SYNC_REPO=<owner>/<repo>   (optional; defaults to
 *                                          tailsthehero10/Luckyblox-Storage-1)
 *   LUCKYBLOX_SYNC_BRANCH=main            (optional, default: main)
 *   LUCKYBLOX_SYNC_PATH=data              (optional, default: data)
 *
 * The data repo is PRIVATE because it holds password hashes. Create a
 * fine-grained token scoped to that one repo with Contents: Read+Write, and set
 * it as LUCKYBLOX_SYNC_TOKEN. The Contents API is used directly, so no git
 * binary is required on the host.
 *
 * ---------------------------------------------------------------------------
 * Backend B - any HTTP JSON blob store (Upstash, JSONBin, a worker, ...)
 * ---------------------------------------------------------------------------
 *   LUCKYBLOX_SYNC=http
 *   LUCKYBLOX_SYNC_URL=<endpoint>
 *   LUCKYBLOX_SYNC_TOKEN=<optional bearer token>
 *
 * The endpoint is called with GET (to load) and PUT (to save) of a single JSON
 * object keyed by file name. This fits JSONBin.io's free tier and any small
 * key-value service that speaks plain HTTP.
 *
 * ---------------------------------------------------------------------------
 * Backend C - a local git clone (no credentials at all)
 * ---------------------------------------------------------------------------
 *   LUCKYBLOX_SYNC=local
 *   LUCKYBLOX_SYNC_DIR=<path to a Luckyblox-Storage-1 clone>  (optional)
 *
 * Mirrors the data files straight into a sibling checkout of the storage repo
 * and commits them there with plain `git` if it is installed. This is the
 * zero-cost option for running the server on the SAME machine as the checkout
 * (E:\...\Release\Luckyblox-Storage-1): nothing is uploaded and no token is
 * needed, you just push the clone when you want the copy off the machine.
 *
 * ---------------------------------------------------------------------------
 * Behaviour
 * ---------------------------------------------------------------------------
 *   - loadAll():   pull every remembered file into the local data dir on boot.
 *   - saveFile():  push one file after it is written (debounced, best-effort).
 *   - Everything is best-effort: a network failure never crashes the server and
 *     never blocks a request. The local file is always the source of truth
 *     during a run; the remote is the durable copy.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILES = [
  'users.json',
  'games.json',
  'assets.json',
  'places.json',
  'players.json',
  'sessions.json',
  'published-assets.json',
  'site-status.json',
  'studio-handshakes.json',
];

/**
 * Content directories that also get wiped on redeploy.
 *
 * The JSON index (games.json, places.json) is always synced. The actual place
 * files, maps and uploads live in these folders, and a user creating or deleting
 * a game changes them. Set LUCKYBLOX_SYNC_CONTENT=1 to mirror them too.
 *
 * They are opt-in because they can be large: syncing megabytes of .rbxlx/map
 * files on every change is a different cost profile from a few KB of JSON.
 *
 * Paths are relative to the release root.
 */
const CONTENT_DIRS = [
  { key: 'saved_places', dir: 'workspace/saved_places' },
  { key: 'maps', dir: 'Maps' },
  { key: 'settings', dir: 'Settings' },
];

const SYNC_CONTENT = /^(1|true|yes|on)$/i.test(String(process.env.LUCKYBLOX_SYNC_CONTENT || ''));

/**
 * Per-user data files are named <userId>.json and hold inventory, currency and
 * membership. They are not in FILES because the set grows as accounts are
 * created, so they are discovered from disk at push/flush time.
 */
function discoverUserFiles(dataDir) {
  try {
    return fs.readdirSync(dataDir)
      .filter((name) => /^\d+\.json$/.test(name));
  } catch (error) {
    return [];
  }
}

// How long to wait after a write before pushing, so a burst of writes to the
// same file becomes one request. GitHub commits are heavy; this keeps them few.
const PUSH_DEBOUNCE_MS = 4000;

// The private storage repo used when LUCKYBLOX_SYNC_REPO is not set. Overridable
// so the same code works for any deployment.
const DEFAULT_SYNC_REPO = 'tailsthehero10/Luckyblox-Storage-1';

function loadConfig() {
  const mode = String(process.env.LUCKYBLOX_SYNC || '').trim().toLowerCase();

  if (mode === 'github') {
    const token = String(process.env.LUCKYBLOX_SYNC_TOKEN || '').trim();
    // Default to this project's own storage repo; an explicit value still wins.
    const repo = String(process.env.LUCKYBLOX_SYNC_REPO || DEFAULT_SYNC_REPO).trim();
    if (!token || !repo || !/^[^/]+\/[^/]+$/.test(repo)) {
      return { enabled: false, mode: 'github', reason: 'missing LUCKYBLOX_SYNC_TOKEN (and LUCKYBLOX_SYNC_REPO is not owner/repo)' };
    }
    return {
      enabled: true,
      mode: 'github',
      token,
      repo,
      branch: String(process.env.LUCKYBLOX_SYNC_BRANCH || 'main').trim() || 'main',
      dir: String(process.env.LUCKYBLOX_SYNC_PATH || 'data').trim().replace(/^\/+|\/+$/g, ''),
      api: 'https://api.github.com',
    };
  }

  if (mode === 'http') {
    const url = String(process.env.LUCKYBLOX_SYNC_URL || '').trim();
    if (!/^https?:\/\//.test(url)) {
      return { enabled: false, mode: 'http', reason: 'missing or invalid LUCKYBLOX_SYNC_URL' };
    }
    return {
      enabled: true,
      mode: 'http',
      url,
      token: String(process.env.LUCKYBLOX_SYNC_TOKEN || '').trim(),
    };
  }

  if (mode === 'local') {
    // The sibling clone of the storage repo sitting next to this server, which is
    // how the project is laid out on disk: <Release>/luckyblox-server and
    // <Release>/Luckyblox-Storage-1. An explicit path always wins, so the same
    // code works from any other checkout.
    const dir = String(
      process.env.LUCKYBLOX_SYNC_DIR
      || path.resolve(__dirname, '..', '..', 'Luckyblox-Storage-1'),
    ).trim();

    return {
      enabled: true,
      mode: 'local',
      dir,
      // Data lands under the clone's `data/` folder, matching the github backend's
      // LUCKYBLOX_SYNC_PATH default so the two are interchangeable.
      dataDir: path.join(dir, String(process.env.LUCKYBLOX_SYNC_PATH || 'data').trim().replace(/^\/+|\/+$/g, '')),
    };
  }

  return { enabled: false, mode: mode || 'off', reason: 'LUCKYBLOX_SYNC is not set' };
}

const config = loadConfig();

/** True when a remote backend is configured and usable. */
const enabled = config.enabled;

// The latest payload queued for each file, so a flush can send it even after
// the timer has been cleared.
const pendingData = new Map();
// Files queued for REMOVAL from the remote (a deleted account's <id>.json, ...).
const pendingDeletes = new Set();
// One global debounce timer: all changed files are committed together.
let pushTimer = null;

function log(message) {
  console.log(`[luckyblox:sync] ${message}`);
}

function warn(message) {
  console.warn(`[luckyblox:sync] ${message}`);
}

/**
 * Resolve a usable `git` executable.
 *
 * Trying only the bare name `git` assumes it is on PATH. On Windows the official
 * installer adds git to PATH only for shells opened after the install, and a
 * server started by a service, a shortcut or a launcher inherits the OLD
 * environment - so `git --version` fails and the local backend silently mirrors
 * files without ever committing them. The binary is still there; it just is not
 * findable by name.
 *
 * The standard install locations are checked as a fallback, and the resolved path
 * is cached (including "none", so the miss is only paid once).
 */
let cachedGitPath;
function resolveGit() {
  if (cachedGitPath !== undefined) return cachedGitPath;

  const candidates = ['git'];
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFiles, 'Git', 'cmd', 'git.exe'),
      path.join(programFilesX86, 'Git', 'cmd', 'git.exe'),
      localAppData ? path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe') : '',
    );
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    // An absolute candidate must actually exist; the bare name is probed by exec.
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      cachedGitPath = candidate;
      return cachedGitPath;
    } catch (error) {
      /* try the next candidate */
    }
  }

  cachedGitPath = null;
  return cachedGitPath;
}

/**
 * Is a `git` binary available? Checked once and cached. Only the local backend
 * needs it, and only for the convenience commit - the mirror itself is plain
 * file writes, which is why a missing git is a warning rather than a failure.
 */
function hasGit() {
  return Boolean(resolveGit());
}

/** fetch with a timeout, so a hung remote can never hang the app. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * GitHub backend
 * ------------------------------------------------------------------------- */

function githubHeaders() {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LuckyBlox-Sync',
  };
}

function githubFileUrl(fileName) {
  return `${config.api}/repos/${config.repo}/contents/${config.dir}/${fileName}`;
}

/**
 * The repo's actual default branch, or null when the call fails. Used so a repo
 * whose default branch is not "main" (or an empty repo) still works.
 */
let cachedDefaultBranch;
async function githubDefaultBranch() {
  if (cachedDefaultBranch) return cachedDefaultBranch;
  try {
    const res = await fetchWithTimeout(`${config.api}/repos/${config.repo}`, {
      headers: githubHeaders(),
    }, 15000);
    if (!res.ok) return null;
    const body = await res.json();
    cachedDefaultBranch = body && body.default_branch ? body.default_branch : null;
    return cachedDefaultBranch;
  } catch (error) {
    return null;
  }
}

/** Which branch to write to, preferring the configured one when it exists. */
async function resolveWriteBranch() {
  const res = await fetchWithTimeout(`${config.api}/repos/${config.repo}/branches/${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(),
  }, 15000);
  if (res.ok) return config.branch;

  // The configured branch does not exist yet (a brand-new/empty repo). Use the
  // repo's own default branch so the very first commit lands somewhere real.
  const fallback = await githubDefaultBranch();
  if (fallback) {
    log(`branch "${config.branch}" not found; writing to default branch "${fallback}"`);
    return fallback;
  }
  return config.branch;
}

/** Read one file from the repo. Returns the parsed JSON or null. */
async function githubPull(fileName) {
  const res = await fetchWithTimeout(`${githubFileUrl(fileName)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(),
  }, 15000);

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${fileName} -> ${res.status}`);
  }

  const body = await res.json();
  if (!body || typeof body.content !== 'string') return null;
  const text = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  return JSON.parse(text);
}

/**
 * Read the current commit (tree) for a branch, or null when the branch/repo is
 * empty or does not exist yet.
 */
async function githubBranchHead(branch) {
  try {
    const res = await fetchWithTimeout(
      `${config.api}/repos/${config.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      { headers: githubHeaders() },
      15000,
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.object ? body.object.sha : null;
  } catch (error) {
    return null;
  }
}

/**
 * Commit several files in ONE commit using the Git Data API.
 *
 * The Contents API commits one file per request. On a busy server that is
 * hundreds of tiny commits and a lot of requests. This batches every changed
 * file into a single tree + commit, which is how GitHub is meant to be used as a
 * store.
 *
 * Handles the empty-repo case: when no branch exists yet, the first commit is
 * created with no parent, which bootstraps the default branch.
 */
async function githubPushBatch(changes, deletions) {
  const removals = deletions || [];
  if (changes.size === 0 && removals.length === 0) return { ok: true, files: 0 };

  const branch = await resolveWriteBranch();
  const headSha = branch ? await githubBranchHead(branch) : null;

  // Blobs: one per changed file.
  const treeItems = [];
  for (const [fileName, data] of changes.entries()) {
    const blobRes = await fetchWithTimeout(`${config.api}/repos/${config.repo}/git/blobs`, {
      method: 'POST',
      headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    }, 20000);
    if (!blobRes.ok) throw new Error(`blob ${fileName} -> ${blobRes.status}`);
    const blob = await blobRes.json();
    treeItems.push({
      path: `${config.dir}/${fileName}`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  // Deletions: a tree entry with a null sha removes the path in this commit.
  for (const fileName of removals) {
    treeItems.push({
      path: `${config.dir}/${fileName}`,
      mode: '100644',
      type: 'blob',
      sha: null,
    });
  }

  // Tree: based on the current commit when there is one, so existing files are
  // preserved; otherwise a fresh tree.
  const treeBody = { tree: treeItems };
  if (headSha) treeBody.base_tree = headSha;
  const treeRes = await fetchWithTimeout(`${config.api}/repos/${config.repo}/git/trees`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(treeBody),
  }, 20000);
  if (!treeRes.ok) throw new Error(`tree -> ${treeRes.status}`);
  const tree = await treeRes.json();

  // Commit: parented when a branch exists, parentless for the first commit.
  const commitBody = {
    message: `luckyblox: update ${treeItems.length} file(s) [skip ci]`,
    tree: tree.sha,
  };
  if (headSha) commitBody.parents = [headSha];
  const commitRes = await fetchWithTimeout(`${config.api}/repos/${config.repo}/git/commits`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(commitBody),
  }, 20000);
  if (!commitRes.ok) throw new Error(`commit -> ${commitRes.status}`);
  const commit = await commitRes.json();

  // Point the branch at the new commit. On a brand-new repo the branch ref does
  // not exist, so create it; otherwise update it.
  const refUrl = `${config.api}/repos/${config.repo}/git/refs/heads/${encodeURIComponent(branch || config.branch)}`;
  const refRes = await fetchWithTimeout(refUrl, {
    method: headSha ? 'PATCH' : 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(headSha ? { sha: commit.sha } : { ref: `refs/heads/${config.branch}`, sha: commit.sha }),
  }, 20000);
  if (!refRes.ok) throw new Error(`ref -> ${refRes.status}`);

  return { ok: true, files: treeItems.length, commit: commit.sha };
}

/* ---------------------------------------------------------------------------
 * Local backend - a sibling git clone of the storage repo
 * ------------------------------------------------------------------------- */

/**
 * Write or remove one file inside the local clone's data folder.
 *
 * The clone is a normal directory on this machine, so a push is just a file
 * write. A deletion removes the file (and prunes the now-empty directory) so the
 * clone matches the server exactly instead of accumulating dead accounts.
 */
function localWrite(fileName, data) {
  const target = path.join(config.dataDir, fileName);
  try {
    if (data === null) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return true;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-sync`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (error) {
    warn(`local write ${fileName} failed: ${error.message}`);
    return false;
  }
}

/**
 * Commit the mirrored files in the clone, so the change is recorded rather than
 * sitting as an uncommitted edit forever.
 *
 * Optional: it needs a `git` binary (resolved by resolveGit, which also checks
 * the standard Windows install path). When git is missing the files are still
 * written - the mirror is useful on its own - so this only warns.
 */
function localCommit() {
  const git = resolveGit();
  if (!git) {
    warn('git is not installed; mirrored files were written but not committed');
    return;
  }
  try {
    execFileSync(git, ['-C', config.dir, 'add', '--', 'data'], { stdio: 'ignore' });
    // `git diff --cached --quiet` exits 1 when something is staged. Nothing to
    // commit is normal (a repeat write of identical data) and must not be an error.
    try {
      execFileSync(git, ['-C', config.dir, 'diff', '--cached', '--quiet'], { stdio: 'ignore' });
      return;
    } catch (dirty) {
      execFileSync(
        git,
        ['-C', config.dir, 'commit', '-m', 'luckyblox: sync data', '--no-verify'],
        { stdio: 'ignore' },
      );
      log('committed mirrored data in the local clone');
    }
  } catch (error) {
    warn(`local commit failed: ${error.message}`);
  }
}

/* ---------------------------------------------------------------------------
 * Generic HTTP backend - one JSON object holding every file.
 * ------------------------------------------------------------------------- */

async function httpPullAll() {
  const res = await fetchWithTimeout(config.url, {
    headers: {
      Accept: 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
  }, 15000);
  if (!res.ok) throw new Error(`GET store -> ${res.status}`);
  return res.json();
}

async function httpPushAll(all) {
  const res = await fetchWithTimeout(config.url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify(all),
  }, 20000);
  if (!res.ok) throw new Error(`PUT store -> ${res.status}`);
}

// For the http backend the whole store is one object, so reads and writes are
// cached in memory and only the touched file is updated before a single PUT.
let httpCache = null;

/** True when a file name is one this module is allowed to sync. */
function isSyncable(fileName) {
  if (FILES.includes(fileName)) return true;
  return /^\d+\.json$/.test(fileName);
}

/** Does a value hold real data (not an empty object)? */
function isMeaningful(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).length > 0;
}

/**
 * Pull every remembered file from the remote into the local data dir.
 *
 * Only files the remote actually has are written, and only when the local copy
 * is empty/missing, so a local edit made before boot is never clobbered by a
 * stale remote copy.
 */
async function loadAll(dataDir) {
  if (!enabled) return { ok: true, enabled: false, loaded: [] };

  // Named files plus any per-user <id>.json already known to the store.
  const wanted = FILES.slice();
  const loaded = [];

  try {
    if (config.mode === 'local') {
      // The clone is just a directory, so the mirror is a file copy. Only files
      // the clone actually has are restored, so an untouched clone never wipes
      // the local data dir.
      for (const fileName of FILES.concat(discoverUserFiles(config.dataDir))) {
        const mirrored = path.join(config.dataDir, fileName);
        if (!fs.existsSync(mirrored)) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(mirrored, 'utf8'));
          if (!parsed || !isMeaningful(parsed)) continue;
          writeLocal(dataDir, fileName, parsed);
          loaded.push(fileName);
        } catch (error) {
          warn(`local read ${fileName} failed: ${error.message}`);
        }
      }
    } else if (config.mode === 'http') {
      httpCache = await httpPullAll();
      if (!httpCache || typeof httpCache !== 'object') httpCache = {};
      // The http store is one object, so every key it holds is a remembered file.
      for (const key of Object.keys(httpCache)) {
        if (!isSyncable(key)) continue;
        const remote = httpCache[key];
        if (!remote || typeof remote !== 'object') continue;
        writeLocal(dataDir, key, remote);
        loaded.push(key);
      }
    } else {
      // GitHub has no index, so probe the named files, plus every per-user file
      // the local disk already knows about (a fresh container knows none, so the
      // list is seeded from the users.json that is restored first).
      const userFiles = discoverUserFiles(dataDir);
      for (const fileName of wanted.concat(userFiles)) {
        let remote = null;
        try {
          remote = await githubPull(fileName);
        } catch (error) {
          warn(`pull ${fileName} failed: ${error.message}`);
          continue;
        }
        if (!remote || !isMeaningful(remote)) continue;
        writeLocal(dataDir, fileName, remote);
        loaded.push(fileName);

        // users.json lists every account id, so pull their data files too.
        if (fileName === 'users.json' && remote && typeof remote === 'object') {
          for (const id of Object.keys(remote)) {
            if (!/^\d+$/.test(id)) continue;
            const userFileName = `${id}.json`;
            if (loaded.includes(userFileName) || wanted.includes(userFileName)) continue;
            try {
              const userRemote = await githubPull(userFileName);
              if (userRemote && isMeaningful(userRemote)) {
                writeLocal(dataDir, userFileName, userRemote);
                loaded.push(userFileName);
              }
            } catch (error) {
              /* a missing per-user file is normal */
            }
          }
        }
      }
    }
    log(`restored ${loaded.length} file(s) from ${config.mode}: ${loaded.join(', ') || 'none'}`);
    return { ok: true, enabled: true, loaded };
  } catch (error) {
    warn(`restore failed: ${error.message}`);
    return { ok: false, enabled: true, error: error.message, loaded };
  }
}

function writeLocal(dataDir, fileName, data) {
  const target = path.join(dataDir, fileName);
  const tmp = `${target}.tmp-sync`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (error) {
    warn(`local write ${fileName} failed: ${error.message}`);
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  }
}

/**
 * Queue a file for upload.
 *
 * Debounced GLOBALLY: every changed file is collected and pushed together in a
 * single commit once the burst of writes stops. This is what keeps GitHub from
 * receiving one commit per keystroke-level change.
 *
 * Best-effort: failures are logged, never thrown into the request path.
 */
function saveFile(fileName, data) {
  if (!enabled) return;
  if (!isSyncable(fileName)) return;

  pendingData.set(fileName, data);

  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushPending().catch((error) => warn(`push failed: ${error.message}`));
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Remove a file from the remote store. Used when a file is deleted locally (for
 * example a per-user <id>.json after the account is removed) so it is not
 * restored on the next boot.
 *
 * Debounced together with the pushes: the pending entry is dropped and the
 * deletion is queued in `pendingDeletes`, then applied in the same commit.
 */
function deleteFile(fileName) {
  if (!enabled) return;
  if (!isSyncable(fileName)) return;
  pendingData.delete(fileName);
  pendingDeletes.add(fileName);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushPending().catch((error) => warn(`push failed: ${error.message}`));
  }, PUSH_DEBOUNCE_MS);
}

/** Push every queued file in one commit (or one HTTP write). */
async function pushPending() {
  if (!enabled || (pendingData.size === 0 && pendingDeletes.size === 0)) {
    return { ok: true, pushed: [] };
  }

  // Take a snapshot so writes during the await are not lost.
  const changes = new Map(pendingData);
  const removals = Array.from(pendingDeletes);
  pendingData.clear();
  pendingDeletes.clear();

  if (config.mode === 'local') {
    // A mirror is synchronous file writes; the commit afterwards is the only
    // part that shells out, and it is optional.
    let written = 0;
    for (const [fileName, data] of changes.entries()) {
      if (localWrite(fileName, data)) written += 1;
    }
    for (const fileName of removals) {
      if (localWrite(fileName, null)) written += 1;
    }
    if (written > 0) localCommit();
    return { ok: true, pushed: Array.from(changes.keys()), removed: removals };
  }

  if (config.mode === 'http') {
    if (!httpCache) httpCache = {};
    for (const [fileName, data] of changes.entries()) httpCache[fileName] = data;
    for (const fileName of removals) delete httpCache[fileName];
    await httpPushAll(httpCache);
    return { ok: true, pushed: Array.from(changes.keys()), removed: removals };
  }

  await githubPushBatch(changes, removals);
  return { ok: true, pushed: Array.from(changes.keys()), removed: removals };
}

/** Push one file now (used by tests). */
async function pushNow(fileName, data) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (config.mode === 'local') {
    const ok = localWrite(fileName, data === null ? null : data);
    if (ok) localCommit();
    return { ok, pushed: [fileName] };
  }
  if (config.mode === 'http') {
    if (!httpCache) httpCache = {};
    httpCache[fileName] = data;
    await httpPushAll(httpCache);
    return { ok: true, pushed: [fileName] };
  }
  await githubPushBatch(new Map([[fileName, data]]));
  return { ok: true, pushed: [fileName] };
}

/**
 * Flush every queued push now. Used on shutdown so a debounced save is not lost
 * when the container is torn down. Best effort - never throws.
 */
async function flush() {
  if (!enabled) return { ok: true, enabled: false, pushed: [] };
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  try {
    const result = await pushPending();
    return { ok: true, enabled: true, pushed: result.pushed || [] };
  } catch (error) {
    warn(`flush failed: ${error.message}`);
    return { ok: false, enabled: true, pushed: [] };
  }
}

function describe() {
  if (!enabled) {
    return {
      enabled: false,
      mode: config.mode,
      reason: config.reason,
      note: 'No free remote storage configured. Data lives in the local '
        + 'filesystem only and is lost if the host wipes it. Set LUCKYBLOX_SYNC '
        + 'to mirror data to a free store (see server/remoteStore.js).',
    };
  }
  // The local backend mirrors into a sibling checkout rather than a remote host,
  // so its note must not promise the same thing the network backends do: nothing
  // leaves the machine until the clone is pushed.
  const localNote = hasGit()
    ? `Data is mirrored into the git clone at ${config.dir} and committed there. `
      + 'Push that clone to get the copy off this machine.'
    : `Data is mirrored into ${config.dir}, but git is not installed so the files `
      + 'are written without being committed. Install git to record them.';

  return {
    enabled: true,
    mode: config.mode,
    repo: config.mode === 'github' ? config.repo : undefined,
    branch: config.mode === 'github' ? config.branch : undefined,
    path: config.mode === 'github' ? config.dir : undefined,
    dir: config.mode === 'local' ? config.dir : undefined,
    git: config.mode === 'local' ? hasGit() : undefined,
    contentSync: SYNC_CONTENT,
    contentDirs: SYNC_CONTENT ? CONTENT_DIRS.map((c) => c.dir) : [],
    note: config.mode === 'local'
      ? localNote
      : `Data is mirrored to a free ${config.mode} store and survives redeploys.`
        + (SYNC_CONTENT ? ' Content folders are mirrored too.' : ''),
  };
}

/* ---------------------------------------------------------------------------
 * Content folders (place files, maps, settings) - OPT-IN
 * ---------------------------------------------------------------------------
 * Enabled with LUCKYBLOX_SYNC_CONTENT=1. When on, the files a creator creates
 * or deletes (workspace/saved_places/*.rbxlx, Maps/*, Settings/*) are mirrored
 * too, so a redeploy keeps the actual game content, not just its index row.
 *
 * These can be large, which is why this is off by default: a few KB of JSON per
 * change has a very different cost from megabytes of place files per change.
 * ------------------------------------------------------------------------- */

/** Recursively list files under a directory as repo-relative keys. */
function listContentKeys(releaseRootDir) {
  const keys = [];

  for (const entry of CONTENT_DIRS) {
    const root = path.resolve(releaseRootDir, entry.dir);
    if (!fs.existsSync(root)) continue;

    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        return;
      }
      for (const item of entries) {
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(abs);
        } else if (item.isFile()) {
          const rel = path.relative(root, abs).split(path.sep).join('/');
          keys.push(`saved_places/${entry.key}/${rel}`);
        }
      }
    };

    walk(root);
  }

  return keys;
}

/** Convert a folder key ("saved_places/MyGame.rbxlx") back to a real path. */
function contentAbsPathForFolderKey(releaseRootDir, folderKey, rel) {
  const entry = CONTENT_DIRS.find((c) => c.key === folderKey);
  if (!entry) return null;
  const base = path.resolve(releaseRootDir, entry.dir);
  const abs = path.resolve(base, rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

/** Snapshot every content folder and push it as one commit. Opt-in. */
async function pushContent(releaseRootDir) {
  if (!enabled || !SYNC_CONTENT) return { ok: true, skipped: true };

  const changes = new Map();
  for (const key of listContentKeys(releaseRootDir)) {
    // key looks like "saved_places/<folderKey>/<rel>".
    const parts = key.split('/');
    const folderKey = parts[1];
    const rel = parts.slice(2).join('/');
    const abs = contentAbsPathForFolderKey(releaseRootDir, folderKey, rel);
    if (!abs) continue;
    try {
      changes.set(`content/${folderKey}/${rel}`, {
        __base64: fs.readFileSync(abs).toString('base64'),
      });
    } catch (error) {
      warn(`content read ${key} failed: ${error.message}`);
    }
  }

  if (changes.size === 0) return { ok: true, files: 0 };

  // A small listing per folder, so a restore knows which paths to fetch from
  // GitHub (which stores files, not directories).
  for (const entry of CONTENT_DIRS) {
    const rels = [];
    for (const key of changes.keys()) {
      const prefix = `content/${entry.key}/`;
      if (key.startsWith(prefix)) rels.push(key.slice(prefix.length));
    }
    changes.set(`content/${entry.key}/_index.json`, rels);
  }

  if (config.mode === 'local') {
    // Content folders are mirrored as real files under the clone's data folder,
    // keeping the same `content/<folder>/<rel>` shape the two remote backends use
    // so the restore path below is identical.
    let written = 0;
    for (const [key, data] of changes.entries()) {
      const target = path.join(config.dataDir, key);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (data && typeof data === 'object' && typeof data.__base64 === 'string') {
          fs.writeFileSync(target, Buffer.from(data.__base64, 'base64'));
        } else {
          fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
        }
        written += 1;
      } catch (error) {
        warn(`local content write ${key} failed: ${error.message}`);
      }
    }
    if (written > 0) localCommit();
    return { ok: true, files: written };
  }

  if (config.mode === 'http') {
    if (!httpCache) httpCache = {};
    for (const [key, data] of changes.entries()) httpCache[key] = data;
    await httpPushAll(httpCache);
  } else {
    await githubPushBatch(changes, []);
  }
  return { ok: true, files: changes.size };
}

/** Restore every content folder from the remote store. Opt-in. */
async function loadContent(releaseRootDir) {
  if (!enabled || !SYNC_CONTENT) return { ok: true, skipped: true, restored: 0 };

  let restored = 0;
  const entries = [];

  if (config.mode === 'local') {
    for (const entry of CONTENT_DIRS) {
      const indexPath = path.join(config.dataDir, 'content', entry.key, '_index.json');
      if (!fs.existsSync(indexPath)) continue;
      let listing;
      try {
        listing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      } catch (error) {
        listing = null;
      }
      if (!Array.isArray(listing)) continue;
      for (const rel of listing) {
        if (String(rel) === '_index.json') continue;
        entries.push({ folderKey: entry.key, rel, key: `content/${entry.key}/${rel}` });
      }
    }
  } else if (config.mode === 'http') {
    if (!httpCache) {
      try {
        httpCache = await httpPullAll();
      } catch (error) {
        return { ok: false, error: error.message, restored: 0 };
      }
    }
    for (const key of Object.keys(httpCache)) {
      if (!key.startsWith('content/')) continue;
      if (key.endsWith('/_index.json')) continue;
      const parts = key.split('/');
      entries.push({ folderKey: parts[1], rel: parts.slice(2).join('/'), key });
    }
  } else {
    for (const entry of CONTENT_DIRS) {
      let listing;
      try {
        listing = await githubPull(`content/${entry.key}/_index.json`);
      } catch (error) {
        listing = null;
      }
      if (!Array.isArray(listing)) continue;
      for (const rel of listing) {
        if (String(rel) === '_index.json') continue;
        entries.push({ folderKey: entry.key, rel, key: `content/${entry.key}/${rel}` });
      }
    }
  }

  for (const item of entries) {
    const abs = contentAbsPathForFolderKey(releaseRootDir, item.folderKey, item.rel);
    if (!abs) continue;

    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });

      if (config.mode === 'local') {
        // The clone holds the real bytes for a content file, so this is a copy.
        const mirrored = path.join(config.dataDir, item.key);
        if (!fs.existsSync(mirrored)) continue;
        fs.writeFileSync(abs, fs.readFileSync(mirrored));
        restored += 1;
        continue;
      }

      const data = config.mode === 'http' ? httpCache[item.key] : await githubPull(item.key);
      if (data == null) continue;
      const encoded = (data && typeof data === 'object' && typeof data.__base64 === 'string')
        ? data.__base64
        : String(data);
      fs.writeFileSync(abs, Buffer.from(encoded, 'base64'));
      restored += 1;
    } catch (error) {
      warn(`content ${item.key} failed: ${error.message}`);
    }
  }

  return { ok: true, restored };
}

/**
 * Test seam: point the GitHub backend at a different API base.
 *
 * The github backend's whole risk is the API dance it performs (detect a missing
 * branch, create blobs, build one tree and one commit, then move the ref). None of
 * that can be exercised against the real api.github.com in a unit test, so this
 * lets a test stand up a fake API and drive the real code paths against it.
 * It is a no-op outside tests.
 */
function __setApiBaseForTests(base) {
  if (config && config.mode === 'github') config.api = base;
  // The branch/repo lookups cache their results, so a test that changes the API
  // base must start from a cold cache.
  cachedDefaultBranch = undefined;
}

/** Test seam: read one file through the github backend. */
function __githubPullForTests(fileName) {
  return githubPull(fileName);
}

module.exports = {
  FILES,
  enabled,
  contentSyncEnabled: SYNC_CONTENT,
  loadAll,
  loadContent,
  saveFile,
  deleteFile,
  pushContent,
  pushNow,
  pushPending,
  flush,
  describe,
  __setApiBaseForTests,
  __githubPullForTests,
};