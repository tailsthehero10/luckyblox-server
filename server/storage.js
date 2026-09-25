'use strict';

/**
 * LuckyBlox persistence layer.
 *
 * Problem this solves: on a platform without a persistent disk (e.g. Render
 * free tier) every redeploy wipes the container filesystem, so user accounts,
 * friends and currency silently disappear. That makes the site look "fake".
 *
 * This module centralises where data lives and makes it survive restarts:
 *
 *   LUCKYBLOX_DATA_DIR  -> explicit data directory (point this at a mounted
 *                          Render Disk, e.g. /var/data)
 *   RENDER_DISK_PATH    -> Render Disk mount path, used as a fallback
 *
 * Resolution order:
 *   1. LUCKYBLOX_DATA_DIR                      (explicit, always wins)
 *   2. RENDER_DISK_PATH/luckblox-data          (Render Disk)
 *   3. <repo>/Webserver/http-db-bridge/data    (bundled defaults, ephemeral)
 *
 * On first boot against an empty persistent dir, the shipped defaults are
 * seeded in, so a fresh deployment has real starter accounts.
 */

const fs = require('fs');
const path = require('path');
const runtime = require('./runtimeConfig');
const remoteStore = require('./remoteStore');

const repoRoot = runtime.rootDir;
const bundledDataDir = path.join(repoRoot, 'Webserver', 'http-db-bridge', 'data');

function resolveDataDir() {
  const explicit = process.env.LUCKYBLOX_DATA_DIR;
  if (explicit && explicit.trim()) {
    return path.resolve(explicit.trim());
  }

  const renderDisk = process.env.RENDER_DISK_PATH;
  if (renderDisk && renderDisk.trim()) {
    return path.join(path.resolve(renderDisk.trim()), 'luckblox-data');
  }

  return bundledDataDir;
}

const dataDir = resolveDataDir();

/** True when data is being written somewhere that survives a redeploy. */
const isPersistent = dataDir !== bundledDataDir;

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    console.error(`[luckyblox] could not create data dir ${dataDir}: ${error.message}`);
  }
}

ensureDataDir();

/**
 * Absolute path for a data file. If a persistent dir is in use and the file is
 * missing there, the bundled default (if any) is copied in first so the app
 * boots with real starter data instead of empty state.
 */
function dataPath(fileName) {
  const target = path.join(dataDir, fileName);
  const fallback = path.join(bundledDataDir, fileName);

  if (isPersistent && !fs.existsSync(target) && fs.existsSync(fallback)) {
    try {
      fs.copyFileSync(fallback, target);
      console.log(`[luckyblox] seeded ${fileName} from bundled defaults`);
    } catch (error) {
      console.error(`[luckyblox] seed failed for ${fileName}: ${error.message}`);
    }
  }

  return target;
}

function readJson(fileName, fallback) {
  const filePath = dataPath(fileName);
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    console.error(`[luckyblox] readJson ${fileName} failed: ${error.message}`);
    return fallback;
  }
}

/**
 * Write JSON atomically: write to a temp file then rename, so a crash mid-write
 * cannot corrupt the stored data.
 */
function writeJson(fileName, data) {
  const filePath = dataPath(fileName);
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
    // Mirror to the free remote store (if configured) so the data outlives this
    // container. Debounced and best-effort - it never blocks or throws here.
    remoteStore.saveFile(fileName, data);
    return true;
  } catch (error) {
    console.error(`[luckyblox] writeJson ${fileName} failed: ${error.message}`);
    try {
      fs.unlinkSync(tmpPath);
    } catch (cleanupError) {
      /* ignore */
    }
    return false;
  }
}

/**
 * Restore data from the free remote store on boot.
 *
 * Called once during startup (see server start). A failure here is not fatal:
 * the app continues with whatever is on the local disk. When nothing is
 * configured this is a no-op, so local-only deployments are unaffected.
 */
async function restoreFromRemote() {
  ensureDataDir();
  return remoteStore.loadAll(dataDir);
}

/** Push any queued writes immediately (used on shutdown). Best effort. */
async function flushRemote() {
  return remoteStore.flush();
}

/** True when the opt-in content-folder mirroring is enabled. */
const contentSyncEnabled = remoteStore.contentSyncEnabled;

/**
 * Restore the content folders (place files, maps, settings) from the remote.
 * Opt-in via LUCKYBLOX_SYNC_CONTENT=1; a no-op otherwise.
 */
async function restoreContentFromRemote() {
  return remoteStore.loadContent(repoRoot);
}

/**
 * Push the content folders to the remote. Called after a place/map/settings
 * change so a newly created game's content survives a redeploy.
 */
async function pushContentToRemote() {
  if (!contentSyncEnabled) return { ok: true, skipped: true };
  return remoteStore.pushContent(repoRoot);
}

/**
 * Remove a local data file and mirror the deletion to the remote store, so the
 * file is not restored on the next boot. Silent when the file does not exist.
 */
function deleteJson(fileName) {
  const filePath = dataPath(fileName);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`[luckyblox] deleteJson ${fileName} failed: ${error.message}`);
  }
  remoteStore.deleteFile(fileName);
  return true;
}

/** Human-readable summary of where data is stored (logged at boot). */
function describeStorage() {
  const remote = remoteStore.describe();

  // A set LUCKYBLOX_DATA_DIR only means "a path was configured" - NOT that the
  // path is on a real mount. Setting the env var without attaching a Render Disk
  // still lands on the ephemeral container filesystem, and the old message then
  // claimed "stored on a persistent volume ... will survive redeploys", which is
  // wrong exactly when it matters. Render mounts a disk at the path in
  // RENDER_DISK_PATH; on any other host a non-bundled dir is a real local disk,
  // so only warn when we can tell the difference (i.e. we are on Render).
  const onRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  const viaRenderDisk = Boolean(process.env.RENDER_DISK_PATH && process.env.RENDER_DISK_PATH.trim());
  const unbackedOnRender = onRender && isPersistent && !viaRenderDisk;

  let note;
  if (unbackedOnRender) {
    note = `LUCKYBLOX_DATA_DIR is set to ${dataDir}, but no Render Disk is attached `
      + '(RENDER_DISK_PATH is unset), so this path is on the EPHEMERAL container '
      + 'filesystem and WILL BE LOST on redeploy. Attach a Render Disk, or set '
      + 'LUCKYBLOX_SYNC to mirror to a FREE store instead.';
  } else if (isPersistent) {
    note = 'Data is stored on a persistent volume and will survive redeploys.';
  } else if (remote.enabled) {
    note = `Data is mirrored to a free ${remote.mode} store and will survive redeploys.`;
  } else {
    note = 'Data is stored in the container filesystem and WILL BE LOST on redeploy. '
      + 'Set LUCKYBLOX_DATA_DIR / attach a Render Disk, OR set LUCKYBLOX_SYNC '
      + 'to mirror to a FREE store (see server/remoteStore.js).';
  }

  return {
    dataDir,
    // `persistent` stays the headline "will this survive?" answer, but it now
    // reports FALSE for the unbacked-on-Render case rather than trusting the flag.
    persistent: (isPersistent && !unbackedOnRender) || remote.enabled,
    localPersistent: isPersistent,
    onRender,
    viaRenderDisk,
    unbacked: unbackedOnRender,
    remote,
    note,
  };
}

module.exports = {
  dataDir,
  bundledDataDir,
  isPersistent,
  ensureDataDir,
  dataPath,
  readJson,
  writeJson,
  deleteJson,
  restoreFromRemote,
  flushRemote,
  contentSyncEnabled,
  restoreContentFromRemote,
  pushContentToRemote,
  describeStorage,
};