/**
 * LuckyBlox client launcher.
 *
 * Responsibility: decide whether the *content client* (the player a browser
 * hand-off launches) is installed on this machine, and if so where.
 *
 * This is deliberately the same shape as Roblox's own install model:
 *
 *   Roblox        %LOCALAPPDATA%\Roblox\Versions\<version>\RobloxPlayerBeta.exe
 *   LuckyBlox     <install root>\Luckyblox\Versions\<version>\RobloxPlayerBeta.exe
 *
 * So the LuckyBlox client lives under a folder literally named "Luckyblox" - the
 * folder name is part of the contract and is never derived from the product's
 * display spelling. Everything else (the `Versions` sub-directory, the
 * `RobloxPlayerBeta.exe` binary name) matches what the client itself expects, so
 * a build that drops its own folder in place works without wiring.
 *
 * Resolution order, first hit wins:
 *
 *   1. LUCKYBLOX_CLIENT_PATH          - explicit override (a full .exe path)
 *   2. LUCKYBLOX_CLIENT_ROOT          - install root, "Luckyblox" appended
 *   3. %LOCALAPPDATA%\Luckyblox       - the per-user install the installer writes
 *   4. <release>/Luckyblox            - a portable install next to the server
 *   5. <release>/Clients/2021M        - the build bundled with this release
 *
 * When nothing is found the launcher reports `installed: false` and the download
 * url the site should send the user to. The server never fabricates a path.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..');

// The folder name every install root carries. Kept as its own constant because
// the installer and the runtime both key off it.
const INSTALL_FOLDER_NAME = 'Luckyblox';
const CLIENT_BINARY = process.platform === 'win32' ? 'RobloxPlayerBeta.exe' : 'RobloxPlayerBeta';
const VERSIONS_DIR = 'Versions';

/** Candidate install roots, most specific first. */
function candidateRoots() {
  const roots = [];

  if (process.env.LUCKYBLOX_CLIENT_ROOT) {
    roots.push(path.resolve(process.env.LUCKYBLOX_CLIENT_ROOT, INSTALL_FOLDER_NAME));
    roots.push(path.resolve(process.env.LUCKYBLOX_CLIENT_ROOT));
  }

  // The per-user install the custom installer targets.
  const localAppData = process.env.LOCALAPPDATA || process.env.LOCAL_APP_DATA;
  if (localAppData) {
    roots.push(path.join(localAppData, INSTALL_FOLDER_NAME));
  } else {
    // Non-Windows fallback so the same code path is testable elsewhere.
    roots.push(path.join(os.homedir(), '.local', 'share', INSTALL_FOLDER_NAME));
  }

  // A portable install sitting beside the server, then the bundled build.
  roots.push(path.join(releaseRoot, INSTALL_FOLDER_NAME));
  roots.push(path.join(releaseRoot, 'Clients', '2021M'));

  return Array.from(new Set(roots));
}

/**
 * Locate the client binary under an install root.
 *
 * Inside a root the binary is either directly present (the bundled build) or
 * one level down under Versions/<version>/ (the installer's layout, and how
 * Roblox itself lays out an install). The newest version directory wins.
 */
function findBinaryInRoot(root) {
  if (!root || !fs.existsSync(root)) return null;

  const direct = path.join(root, CLIENT_BINARY);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  const versionsDir = path.join(root, VERSIONS_DIR);
  if (!fs.existsSync(versionsDir)) return null;

  let versions;
  try {
    versions = fs.readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return null;
  }

  // Newest last after the sort, so walk backwards.
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const candidate = path.join(versionsDir, versions[i], CLIENT_BINARY);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/** Resolve the installed client binary, or null when the client is absent. */
function resolveClientBinary() {
  if (process.env.LUCKYBLOX_CLIENT_PATH) {
    const override = path.resolve(process.env.LUCKYBLOX_CLIENT_PATH);
    if (fs.existsSync(override) && fs.statSync(override).isFile()) {
      return override;
    }
  }

  for (const root of candidateRoots()) {
    const binary = findBinaryInRoot(root);
    if (binary) return binary;
  }

  return null;
}

/**
 * Where the custom installer is served from.
 *
 * The installer is a build artefact, not something the server can invent: if the
 * file is not on disk the download route 404s and the client reports the client
 * as unavailable rather than handing out a broken link.
 */
function installerPath() {
  if (process.env.LUCKYBLOX_INSTALLER_PATH) {
    return path.resolve(process.env.LUCKYBLOX_INSTALLER_PATH);
  }
  const candidates = [
    path.join(releaseRoot, 'Luckyblox', 'LuckybloxInstaller.exe'),
    path.join(releaseRoot, 'tools', 'installer', 'LuckybloxInstaller.exe'),
    path.join(releaseRoot, 'Downloads', 'LuckybloxInstaller.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

/** Full description of the local client state, for the launch API and views. */
function getClientStatus() {
  const binary = resolveClientBinary();
  const installer = installerPath();
  const installerExists = fs.existsSync(installer);

  return {
    installed: Boolean(binary),
    executablePath: binary,
    // The folder the client lives in when installed, so the UI can say where.
    installRoot: binary ? path.dirname(path.dirname(binary)) : null,
    installFolderName: INSTALL_FOLDER_NAME,
    // Whether a download can be offered at all.
    installerAvailable: installerExists,
    installerPath: installerExists ? installer : null,
    downloadUrl: installerExists ? '/download/client' : null,
    supported: process.platform === 'win32',
  };
}

module.exports = {
  INSTALL_FOLDER_NAME,
  CLIENT_BINARY,
  candidateRoots,
  resolveClientBinary,
  getClientStatus,
  installerPath,
};
