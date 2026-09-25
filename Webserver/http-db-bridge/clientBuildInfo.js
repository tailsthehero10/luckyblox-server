/**
 * LuckyBlox client build + update manifest.
 *
 * This is the SERVER half of a Roblox-style client updater.
 *
 * How Roblox does it, and what this mirrors:
 *
 *   1. The installer (and the installed client, on every launch) asks a small
 *      version endpoint for the current build of the channel it is on.
 *   2. The endpoint answers with a build id, a version string and the URL to
 *      download that build.
 *   3. If the local build id differs, the installer downloads the new build into
 *      Versions/<version>/ and updates the "current version" pointer. The old
 *      version directory is left in place until the new one is verified, so a
 *      failed download never leaves a broken install.
 *
 * This module answers step 1 and 2 with REAL data read from the release folder:
 * a version is discovered by scanning the client install roots for version
 * directories and reading the binary's own file version when available. Nothing
 * here invents a build that is not on disk - if no client is present the
 * manifest reports `available: false` and the download route refuses, exactly
 * like the installer's "no build published yet" state.
 *
 * The endpoint shapes deliberately match the ones the Roblox client installer
 * already understands (a `clientVersionUpload` style build id plus a
 * `Versions`-relative path), so a real installer can consume them with no
 * special-casing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const releaseRoot = path.resolve(__dirname, '..');
const { publicBaseUrl, publicHostname, publicProtocol } = require('./runtimeConfig');

const INSTALL_FOLDER_NAME = 'Luckyblox';
const VERSIONS_DIR = 'Versions';
const CLIENT_BINARY = process.platform === 'win32' ? 'RobloxPlayerBeta.exe' : 'RobloxPlayerBeta';
const CHANNEL = String(process.env.LUCKYBLOX_CLIENT_CHANNEL || 'production').trim() || 'production';

/**
 * Compare two version directory names the way a human reads them.
 *
 * The same trap as server/clientLauncher.js: a plain string sort puts
 * "2021.10" BEFORE "2021.9" (because '1' < '9'), so "newest wins" would select
 * the older build - and here that means the manifest would advertise and serve a
 * stale client. Segment-wise numeric comparison fixes it.
 */
function compareVersions(a, b) {
  const pa = String(a || '').split(/[.\-_]/);
  const pb = String(b || '').split(/[.\-_]/);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i += 1) {
    const ra = i < pa.length ? pa[i] : '0';
    const rb = i < pb.length ? pb[i] : '0';
    const na = Number(ra);
    const nb = Number(rb);
    const bothNumeric = Number.isFinite(na) && Number.isFinite(nb) && ra !== '' && rb !== '';

    if (bothNumeric) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (ra !== rb) {
      return ra < rb ? -1 : 1;
    }
  }

  return String(a).localeCompare(String(b));
}

/**
 * Which build the installer should fetch.
 *
 * Derived from the newest build found on disk so the manifest can never point at
 * something that does not exist. An explicit LUCKYBLOX_CLIENT_VERSION wins, which
 * is how a release pipeline pins a version before shipping the binary.
 */
function resolveSourceDir() {
  const explicit = process.env.LUCKYBLOX_CLIENT_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return path.dirname(explicit);
  }

  const roots = [];
  if (process.env.LUCKYBLOX_CLIENT_ROOT) roots.push(path.resolve(process.env.LUCKYBLOX_CLIENT_ROOT, INSTALL_FOLDER_NAME));
  const localAppData = process.env.LOCALAPPDATA || process.env.LOCAL_APP_DATA;
  if (localAppData) roots.push(path.join(localAppData, INSTALL_FOLDER_NAME));
  else roots.push(path.join(os.homedir(), '.local', 'share', INSTALL_FOLDER_NAME));
  roots.push(path.join(releaseRoot, INSTALL_FOLDER_NAME));
  roots.push(path.join(releaseRoot, 'Clients', '2021M'));

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    if (fs.existsSync(path.join(root, CLIENT_BINARY))) return root;

    const versionsDir = path.join(root, VERSIONS_DIR);
    if (!fs.existsSync(versionsDir)) continue;
    let versions;
    try {
      versions = fs.readdirSync(versionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareVersions);
    } catch (error) {
      continue;
    }
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const candidate = path.join(versionsDir, versions[i]);
      if (fs.existsSync(path.join(candidate, CLIENT_BINARY))) return candidate;
    }
  }

  return null;
}

/** A stable build id for a directory: its name when versioned, else its mtime. */
function buildIdFor(dir) {
  if (!dir) return null;
  const base = path.basename(dir);
  // A Versions/<version> path already carries the version as its id.
  if (/^\d/.test(base) || /^version-/i.test(base)) return base;

  try {
    const binary = path.join(dir, CLIENT_BINARY);
    const stat = fs.statSync(binary);
    // Size + mtime is a cheap, stable fingerprint of a build with no manifest.
    return `local-${stat.size}-${Math.floor(stat.mtimeMs)}`;
  } catch (error) {
    return base || null;
  }
}

/** Size of the client binary, for a progress/verification hint. */
function binarySize(dir) {
  if (!dir) return 0;
  try {
    return fs.statSync(path.join(dir, CLIENT_BINARY)).size;
  } catch (error) {
    return 0;
  }
}

function baseUrl() {
  const origin = publicBaseUrl
    || `${publicProtocol}://${publicHostname}`;
  return String(origin).replace(/\/+$/, '');
}

/**
 * The build descriptor the installer reads.
 *
 * `available` is the honest headline: false means there is no build on disk and
 * the installer must not try to download one.
 */
function getClientBuildInfo() {
  const dir = resolveSourceDir();
  const buildId = buildIdFor(dir);
  const version = String(process.env.LUCKYBLOX_CLIENT_VERSION || '').trim()
    || (buildId && /^\d/.test(buildId) ? buildId : null)
    || 'local-dev';

  return {
    ok: true,
    available: Boolean(dir && buildId),
    channel: CHANNEL,
    buildId: buildId || null,
    version,
    buildType: 'Release',
    // Where the client lives on this host, so the installer can copy it.
    sourceDir: dir,
    sourceBinary: dir ? path.join(dir, CLIENT_BINARY) : null,
    binaryName: CLIENT_BINARY,
    binarySize: binarySize(dir),
    // The layout the installer must reproduce: <root>/Luckyblox/Versions/<v>/.
    installFolderName: INSTALL_FOLDER_NAME,
    versionsDir: VERSIONS_DIR,
    baseUrl: baseUrl(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The update manifest.
 *
 * Mirrors Studio's: a channel, a current build, a `builds` list and an `updates`
 * list. An installer compares its own buildId against `buildId` here and only
 * downloads when they differ, which is what makes an update rather than a
 * reinstall.
 */
function getClientUpdateManifest() {
  const info = getClientBuildInfo();

  const build = info.available
    ? [{
      id: info.buildId,
      channel: info.channel,
      buildType: info.buildType,
      version: info.version,
      // A versioned path under Versions/, the same shape Roblox uses.
      downloadPath: `${INSTALL_FOLDER_NAME}/${VERSIONS_DIR}/${info.version}/${info.binaryName}`,
      downloadUrl: `${info.baseUrl}/download/client/binary?version=${encodeURIComponent(info.version)}`,
      installerUrl: `${info.baseUrl}/download/client`,
      size: info.binarySize,
      updatedAt: info.updatedAt,
    }]
    : [];

  return {
    ok: true,
    available: info.available,
    channel: info.channel,
    buildId: info.buildId,
    version: info.version,
    baseUrl: info.baseUrl,
    installFolderName: INSTALL_FOLDER_NAME,
    versionsDir: VERSIONS_DIR,
    builds: build,
    updates: info.available
      ? [{
        id: info.buildId,
        type: 'client-build',
        channel: info.channel,
        title: `LuckyBlox Player ${info.version}`,
        notes: 'Content client build served by this LuckyBlox deployment.',
        buildId: info.buildId,
      }]
      : [],
  };
}

module.exports = {
  CHANNEL,
  INSTALL_FOLDER_NAME,
  VERSIONS_DIR,
  getClientBuildInfo,
  getClientUpdateManifest,
  resolveSourceDir,
};