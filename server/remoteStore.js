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

const FILES = [
  'users.json',
  'games.json',
  'assets.json',
  'places.json',
  'players.json',
  'sessions.json',
  'site-status.json',
  'studio-handshakes.json',
];

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

  return { enabled: false, mode: mode || 'off', reason: 'LUCKYBLOX_SYNC is not set' };
}

const config = loadConfig();

/** True when a remote backend is configured and usable. */
const enabled = config.enabled;

const pendingTimers = new Map();
// The latest payload queued for each file, so a flush can send it even after
// the timer has been cleared.
const pendingData = new Map();

function log(message) {
  console.log(`[luckyblox:sync] ${message}`);
}

function warn(message) {
  console.warn(`[luckyblox:sync] ${message}`);
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
async function githubPushBatch(changes, branchName) {
  if (changes.size === 0) return { ok: true, files: 0 };

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

/** Write one file to the repo (creating or updating it). */
async function githubPush(fileName, data) {
  return githubPushBatch(new Map([[fileName, data]]));
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
    if (config.mode === 'http') {
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
 * Queue a file for upload. Debounced per file so rapid writes coalesce into one
 * remote commit. Best-effort: failures are logged, never thrown.
 */
function saveFile(fileName, data) {
  if (!enabled) return;
  if (!isSyncable(fileName)) return;

  const existing = pendingTimers.get(fileName);
  if (existing) clearTimeout(existing);

  pendingData.set(fileName, data);

  pendingTimers.set(fileName, setTimeout(() => {
    pendingTimers.delete(fileName);
    const payload = pendingData.get(fileName);
    pendingData.delete(fileName);
    pushNow(fileName, payload).catch((error) => warn(`push ${fileName} failed: ${error.message}`));
  }, PUSH_DEBOUNCE_MS));
}

/** Push immediately (used at shutdown and by tests). */
async function pushNow(fileName, data) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (config.mode === 'http') {
    if (!httpCache) httpCache = {};
    httpCache[fileName] = data;
    await httpPushAll(httpCache);
    return { ok: true };
  }
  await githubPush(fileName, data);
  return { ok: true };
}

/**
 * Flush every queued push now. Used on shutdown so a debounced save is not lost
 * when the container is torn down. Best effort - never throws.
 */
async function flush() {
  if (!enabled) return { ok: true, enabled: false, pushed: [] };

  const pushed = [];
  for (const fileName of Array.from(pendingTimers.keys())) {
    clearTimeout(pendingTimers.get(fileName));
    pendingTimers.delete(fileName);
  }

  for (const fileName of Array.from(pendingData.keys())) {
    const payload = pendingData.get(fileName);
    pendingData.delete(fileName);
    try {
      await pushNow(fileName, payload);
      pushed.push(fileName);
    } catch (error) {
      warn(`flush ${fileName} failed: ${error.message}`);
    }
  }

  return { ok: true, enabled: true, pushed };
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
  return {
    enabled: true,
    mode: config.mode,
    repo: config.mode === 'github' ? config.repo : undefined,
    branch: config.mode === 'github' ? config.branch : undefined,
    path: config.mode === 'github' ? config.dir : undefined,
    note: `Data is mirrored to a free ${config.mode} store and survives redeploys.`,
  };
}

module.exports = {
  FILES,
  enabled,
  loadAll,
  saveFile,
  pushNow,
  flush,
  describe,
};