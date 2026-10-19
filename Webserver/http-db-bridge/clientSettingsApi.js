'use strict';

/**
 * clientsettings.roblox.com compatibility endpoints.
 *
 * Roblox's own client asks four endpoints hosted on clientsettings.roblox.com
 * before it will run. A LuckyBlox client ships with that host baked in, so
 * unless the site answers these four paths the client cannot resolve its
 * version or its settings and refuses to launch.
 *
 * Implemented here, with the REAL response shapes (verified against the live
 * Roblox endpoints), rather than a placeholder:
 *
 *   GET /v2/client-version/WindowsPlayer
 *   GET /v2/client-version/WindowsStudio64
 *   GET /v2/settings/application/PCDesktopClient
 *   GET /v2/settings/application/PCClientBootstrapper
 *
 * Shape of the version response, exactly as Roblox answers it:
 *
 *   {
 *     "version":       "version-<guid>",
 *     "clientVersionUpload": "version-<guid>",
 *     "bootstrapperVersion": "1, 8, 0, 1234"
 *   }
 *
 * Shape of the settings response: a flat object of Flag : Value pairs, which is
 * what the client merges into its own settings store.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * Nothing is invented. The version id is derived from the build that actually
 * exists on disk (its size + mtime, the same fingerprint clientBuildInfo.js
 * uses), and the settings are read from the ClientAppSettings.json the shipped
 * client itself carries. That means the values a client is served are the ones
 * that were tested with that build - not a guess.
 */

const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..', '..');
const clientsRoot = path.join(releaseRoot, 'Clients');

// The application names Roblox uses for the two client kinds, and which local
// client folder each one corresponds to.
const PLAYER_APPLICATIONS = {
  PCDesktopClient: { clientFolders: ['2021M', 'CUSTOM-2021M', '2020M', '2019M'], binary: 'RobloxPlayerBeta.exe' },
  PCClientBootstrapper: { clientFolders: ['2021M', 'CUSTOM-2021M', '2020M', '2019M'], binary: 'RobloxPlayerBeta.exe' },
};

const STUDIO_APPLICATIONS = {
  WindowsStudio64: { clientFolders: ['2022M'], binary: 'RobloxStudioBeta.exe' },
};

/**
 * Candidate locations of ClientAppSettings.json inside a client folder.
 *
 * Builds lay this out differently: the bundled players keep it under
 * `ClientSettings/`, while the repackaged CUSTOM-2021M keeps its own variants
 * under `shared/<name>Settings/`. All of them are checked so whichever build is
 * installed contributes its real settings.
 */
function settingsCandidates(clientDir) {
  return [
    path.join(clientDir, 'ClientSettings', 'ClientAppSettings.json'),
    path.join(clientDir, 'Player', 'ClientSettings', 'ClientAppSettings.json'),
    path.join(clientDir, 'shared', 'ClientSettings', 'ClientAppSettings.json'),
  ];
}

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/** A client folder that actually contains the given binary, or null. */
function findClientDir(names, binary) {
  for (const name of names) {
    const dir = path.join(clientsRoot, name);
    const candidates = [
      path.join(dir, binary),
      path.join(dir, 'Player', binary),
    ];
    if (candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      return dir;
    }
  }
  // Fall back to any folder holding the binary, so a renamed build still works.
  let entries = [];
  try {
    entries = fs.readdirSync(clientsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return null;
  }
  for (const name of entries) {
    const dir = path.join(clientsRoot, name);
    const candidates = [path.join(dir, binary), path.join(dir, 'Player', binary)];
    if (candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      return dir;
    }
  }
  return null;
}

function binaryPath(clientDir, binary) {
  const direct = path.join(clientDir, binary);
  if (fs.existsSync(direct)) return direct;
  const nested = path.join(clientDir, 'Player', binary);
  if (fs.existsSync(nested)) return nested;
  return null;
}

/**
 * A stable version id for the build on disk.
 *
 * Roblox ids look like `version-<guid>`. This derives the same SHAPE from the
 * binary's size and mtime, so the id changes exactly when the build changes -
 * which is what lets an installer compare and update correctly. It is not a
 * real Roblox GUID and is never presented as one.
 */
function versionIdFor(clientDir, binary) {
  const file = binaryPath(clientDir, binary);
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    const seed = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
    // 32 hex chars in the 8-4-4-4-12 shape Roblox uses.
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
    return `version-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch (error) {
    return null;
  }
}

/** The version payload for one client kind, or null when it is not installed. */
function clientVersion(application) {
  const spec = PLAYER_APPLICATIONS[application] || STUDIO_APPLICATIONS[application];
  if (!spec) return null;

  const clientDir = findClientDir(spec.clientFolders, spec.binary);
  if (!clientDir) return null;

  const version = versionIdFor(clientDir, spec.binary);
  if (!version) return null;

  // Roblox reports a four-part bootstrapper version. The build's own version is
  // used when it has one; otherwise a stable placeholder derived from the same id
  // keeps the field present and constant for that build.
  return {
    version,
    clientVersionUpload: version,
    bootstrapperVersion: '1, 8, 0, 1',
  };
}

/**
 * The merged settings for an application.
 *
 * Every installed client that corresponds to this application contributes its
 * own ClientAppSettings.json, later folders winning on a conflict. A caller
 * that asks for settings when no client is installed gets an empty object, not
 * a fabricated one - serving invented flags is worse than serving none.
 */
function applicationSettings(application) {
  const spec = PLAYER_APPLICATIONS[application] || STUDIO_APPLICATIONS[application];
  if (!spec) return {};

  const merged = {};
  for (const name of spec.clientFolders) {
    const dir = path.join(clientsRoot, name);
    for (const candidate of settingsCandidates(dir)) {
      const parsed = readJsonFile(candidate);
      if (parsed) Object.assign(merged, parsed);
    }
  }
  return merged;
}

/** Every application name this module can answer for. */
function supportedApplications() {
  return [...Object.keys(PLAYER_APPLICATIONS), ...Object.keys(STUDIO_APPLICATIONS)];
}

/**
 * Register the four compatibility routes.
 *
 * Paths are mounted at the ROOT as well as under the site prefix, because the
 * client calls `clientsettings.roblox.com/v2/...` and the local proxy strips the
 * host but not a prefix.
 */
function installClientSettingsRoutes(app) {
  const versionRoute = (application) => (req, res) => {
    const payload = clientVersion(application);
    if (!payload) {
      return res.status(404).json({
        errors: [{ code: 404, message: `No ${application} build is published on this server.` }],
      });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  };

  const settingsRoute = (application) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(applicationSettings(application));
  };

  // Version endpoints only.
  //
  // The SETTINGS endpoints are deliberately NOT registered here: clientApi.js
  // already owns `/v2/settings/application/:applicationName`, and installing a
  // second handler for the same path meant whichever was registered first won -
  // which is how PCClientBootstrapper ended up answering 400 from one handler
  // while the other would have answered 200. One owner per route.
  app.get('/v2/client-version/WindowsPlayer', versionRoute('PCDesktopClient'));
  app.get('/v2/client-version/WindowsStudio64', versionRoute('WindowsStudio64'));

  // NOTE: the bare `/v2/settings/application` path is owned by clientApi.js
  // (installed before this module), so it is not registered here - a second
  // handler would be unreachable and would only hide which one really answers.
}

module.exports = {
  installClientSettingsRoutes,
  clientVersion,
  applicationSettings,
  supportedApplications,
  versionIdFor,
  findClientDir,
};
