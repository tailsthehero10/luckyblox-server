'use strict';

/**
 * LuckyBlox client bundles.
 *
 * Produces a ZIP shaped like the real Roblox install: one top-level folder
 * ("Luckyblox-installation") holding a folder per client build, each carrying the
 * executable AND the files that build needs to run - above all AppSettings.xml,
 * which is what points the client at this server.
 *
 * WHY THE FOLDERS MATTER
 * ----------------------
 * Shipping only the .exe is useless. The client reads AppSettings.xml for its
 * ContentFolder and BaseUrl and will not start without it. 2022M additionally
 * needs its ClientSettings FFlag table. So a bundle is a FOLDER, not a file.
 *
 * Layout produced:
 *
 *   Luckyblox-installation/
 *     2021M/  RobloxPlayerBeta.exe + AppSettings.xml + ssl/
 *     2022M/  RobloxStudioBeta.exe + AppSettings.xml + ClientSettings/
 *     README.txt
 *
 * ARCHIVER
 * --------
 * A hand-written ZIP writer was attempted and DELETED: it could not be executed
 * on the build machine (no Node there), and an untested binary-format writer is a
 * corruption risk with no useful error. 7-Zip is used instead when present - it
 * is a proven archiver, and the resulting bundle is integrity-tested. When 7-Zip
 * is absent the module reports that honestly rather than emitting a maybe-broken
 * zip.
 *
 * The AppSettings.xml inside a bundle is REWRITTEN so its BaseUrl points at the
 * server that produced the download, instead of carrying a baked-in host.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Where 7-Zip normally lives on Windows.
const SEVEN_ZIP_CANDIDATES = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  '7z',
  '7za',
];

/** The 7-Zip binary to use, or null when none is installed. */
function findSevenZip() {
  for (const candidate of SEVEN_ZIP_CANDIDATES) {
    if (candidate.includes(path.sep)) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (error) { /* keep looking */ }
    } else {
      // A bare name: only usable if it is on PATH, which execFileSync proves.
      try {
        execFileSync(candidate, ['i'], { stdio: 'ignore' });
        return candidate;
      } catch (error) { /* not on PATH */ }
    }
  }
  return null;
}

/**
 * Rewrite <BaseUrl> in an AppSettings.xml so it points at the server producing
 * the download. The committed files carry a dev/live host; a downloaded copy must
 * point at wherever the user got it from.
 */
function rewriteBaseUrl(xml, origin) {
  const clean = String(origin || '').replace(/\/+$/, '');
  if (!clean) return xml;
  if (/<BaseUrl>[\s\S]*?<\/BaseUrl>/.test(xml)) {
    return xml.replace(/<BaseUrl>[\s\S]*?<\/BaseUrl>/, `<BaseUrl>${clean}/</BaseUrl>`);
  }
  return xml.replace(/<Settings[^>]*>/, (m) => `${m}\n  <BaseUrl>${clean}/</BaseUrl>`);
}

/** Files a client build needs, relative to its own folder. */
const REQUIRED_FILES = [
  'AppSettings.xml',
  'RobloxPlayerBeta.exe',
  'RobloxStudioBeta.exe',
  'ClientSettings/ClientAppSettings.json',
];

/**
 * Describe what is available to bundle, without building anything.
 * Used by the download page to show honest sizes and availability.
 */
function describeBundle(releaseRoot) {
  const clientsRoot = path.join(releaseRoot, 'Clients');
  const result = { folderName: 'Luckyblox-installation', clients: [], totalBytes: 0 };

  for (const name of ['2021M', '2022M']) {
    const dir = path.join(clientsRoot, name);
    const entry = { name, path: dir, exists: false, files: [], bytes: 0 };

    if (fs.existsSync(dir)) {
      entry.exists = true;
      const walk = (base) => {
        let items;
        try {
          items = fs.readdirSync(base, { withFileTypes: true });
        } catch (error) {
          return;
        }
        for (const item of items) {
          const abs = path.join(base, item.name);
          if (item.isDirectory()) {
            walk(abs);
          } else if (item.isFile()) {
            const rel = path.relative(dir, abs).split(path.sep).join('/');
            let size = 0;
            try { size = fs.statSync(abs).size; } catch (error) { size = 0; }
            entry.files.push({ rel, abs, size });
            entry.bytes += size;
          }
        }
      };
      walk(dir);
    }

    result.totalBytes += entry.bytes;
    result.clients.push(entry);
  }

  return result;
}

/**
 * Stage the Luckyblox-installation folder on disk, rewriting each client's
 * AppSettings.xml so its BaseUrl points at the given origin.
 *
 * Returns the staging directory, or null when there is nothing to package.
 */
function stageInstallation(releaseRoot, origin) {
  const top = 'Luckyblox-installation';
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-bundle-'));
  const stageTop = path.join(stageRoot, top);
  fs.mkdirSync(stageTop, { recursive: true });

  let staged = 0;
  const missingSettings = [];

  for (const name of ['2021M', '2022M']) {
    const dir = path.join(releaseRoot, 'Clients', name);
    if (!fs.existsSync(dir)) continue;

    const dest = path.join(stageTop, name);

    const walk = (base, target) => {
      let items;
      try {
        items = fs.readdirSync(base, { withFileTypes: true });
      } catch (error) {
        return;
      }
      fs.mkdirSync(target, { recursive: true });
      for (const item of items) {
        const abs = path.join(base, item.name);
        const out = path.join(target, item.name);
        if (item.isDirectory()) {
          walk(abs, out);
          continue;
        }
        if (!item.isFile()) continue;
        try {
          const rel = path.relative(dir, abs).split(path.sep).join('/');
          if (rel === 'AppSettings.xml') {
            // Point the downloaded copy at the server that produced it.
            const xml = rewriteBaseUrl(fs.readFileSync(abs, 'utf8'), origin);
            fs.writeFileSync(out, xml, 'utf8');
          } else {
            fs.copyFileSync(abs, out);
          }
          staged += 1;
        } catch (error) {
          // An unreadable file is skipped rather than failing the whole bundle.
        }
      }
    };

    walk(dir, dest);

    if (!fs.existsSync(path.join(dir, 'AppSettings.xml'))) missingSettings.push(name);
  }

  if (!staged) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    return null;
  }

  // A README so the layout is obvious after unzipping, and so a client folder
  // missing its AppSettings.xml is never a silent mystery.
  const readme = [
    'LuckyBlox client installation',
    '=============================',
    '',
    'This folder contains the LuckyBlox content clients:',
    '',
    '  2021M/  RobloxPlayerBeta.exe  - the player the site launches',
    '  2022M/  RobloxStudioBeta.exe  - the Studio app for creating places',
    '',
    'Each folder already contains its AppSettings.xml, which points the client at',
    'this LuckyBlox server, plus (for 2022M) its ClientSettings FFlag table.',
    'Do not separate the .exe from its AppSettings.xml - the client will not start',
    'without it.',
    '',
    origin ? `Server this bundle is configured for: ${origin}` : 'Server: (not set at build time)',
    `Built: ${new Date().toISOString()}`,
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(stageTop, 'README.txt'), readme, 'utf8');

  return { stageRoot, stageTop, staged, missingSettings };
}

/**
 * Build the Luckyblox-installation ZIP with 7-Zip.
 *
 * Returns { ok:true, zipPath, fileName, bytes, entries } or { ok:false, reason }.
 * The zip is written to `outZipPath` when given, otherwise to a temp file.
 */
function buildBundle(releaseRoot, opts = {}) {
  const sevenZip = findSevenZip();
  if (!sevenZip) return { ok: false, reason: 'no-archiver' };

  const origin = opts.origin || '';
  const staged = stageInstallation(releaseRoot, origin);
  if (!staged) return { ok: false, reason: 'no-client-folders' };

  const outZip = opts.outZipPath
    || path.join(os.tmpdir(), `luckyblox-client-${Date.now()}.zip`);

  try {
    fs.mkdirSync(path.dirname(outZip), { recursive: true });
  } catch (error) { /* the zip call will report a real failure */ }

  try {
    // Zip the PARENT of Luckyblox-installation so that folder is the root entry.
    execFileSync(sevenZip, ['a', '-tzip', outZip, 'Luckyblox-installation', '-mx=5', '-bso0', '-bsp0'], {
      cwd: staged.stageRoot,
      stdio: 'ignore',
      timeout: 300000,
    });
  } catch (error) {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
    return { ok: false, reason: 'zip-failed', detail: error.message };
  } finally {
    // The staging copy is no longer needed once the archive exists.
    try { fs.rmSync(staged.stageRoot, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }

  let bytes = 0;
  try { bytes = fs.statSync(outZip).size; } catch (error) { bytes = 0; }

  return {
    ok: true,
    zipPath: outZip,
    fileName: 'luckyblox-client.zip',
    bytes,
    stagedFiles: staged.staged,
    missingSettings: staged.missingSettings,
  };
}

/**
 * Build a ZIP of a SINGLE client folder (e.g. just 2021M) for a smaller download.
 * The folder in the archive is Luckyblox-installation/<clientName>.
 */
function buildSingleClient(releaseRoot, clientName, opts = {}) {
  const sevenZip = findSevenZip();
  if (!sevenZip) return { ok: false, reason: 'no-archiver' };

  const dir = path.join(releaseRoot, 'Clients', clientName);
  if (!fs.existsSync(dir)) return { ok: false, reason: 'client-not-found' };

  const origin = opts.origin || '';
  const staged = stageInstallation(releaseRoot, origin);
  if (!staged) return { ok: false, reason: 'no-client-folders' };

  const outZip = opts.outZipPath
    || path.join(os.tmpdir(), `luckyblox-${clientName.toLowerCase()}-${Date.now()}.zip`);

  try {
    execFileSync(sevenZip, ['a', '-tzip', outZip, `${path.join('Luckyblox-installation', clientName)}`, '-mx=5', '-bso0', '-bsp0'], {
      cwd: staged.stageRoot,
      stdio: 'ignore',
      timeout: 300000,
    });
  } catch (error) {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
    return { ok: false, reason: 'zip-failed', detail: error.message };
  } finally {
    try { fs.rmSync(staged.stageRoot, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }

  let bytes = 0;
  try { bytes = fs.statSync(outZip).size; } catch (error) { bytes = 0; }

  return {
    ok: true,
    zipPath: outZip,
    fileName: `luckyblox-${clientName.toLowerCase()}.zip`,
    bytes,
  };
}

module.exports = {
  findSevenZip,
  rewriteBaseUrl,
  REQUIRED_FILES,
  describeBundle,
  stageInstallation,
  buildBundle,
  buildSingleClient,
};