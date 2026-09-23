'use strict';

/**
 * LuckyBlox site status ("open / closed" switch).
 *
 * The owner can take the site down for maintenance or work-in-progress without
 * editing code or redeploying: the state lives in a small JSON file next to the
 * rest of the bridge data, and every page reads it on the way in.
 *
 *   open          — the site is fully available.
 *   work          — work in progress; the site is closed, visitors see a notice.
 *   maintenance   — planned maintenance; the site is closed, visitors see a notice.
 *   locked        — closed for a non-specific reason; visitors see a notice.
 *
 * Environment can force a state for a container (this is what a redeploy would
 * use), but the file is the runtime source of truth so the owner can flip the
 * switch from the UI without a deploy.
 *
 *   LUCKYBLOX_SITE_STATUS=maintenance   -> forced, file is ignored
 */

const fs = require('fs');
const path = require('path');

const STATUSES = {
  open: {
    id: 'open',
    label: 'Open',
    closed: false,
    headline: 'LuckyBlox is open',
    detail: 'Everything is running normally. Come in and play.',
  },
  work: {
    id: 'work',
    label: 'Work in progress',
    closed: true,
    headline: 'LuckyBlox is closed for work in progress',
    detail: 'The site is closed while work in progress is being done. Please check back soon.',
  },
  maintenance: {
    id: 'maintenance',
    label: 'Maintenance',
    closed: true,
    headline: 'LuckyBlox is closed for maintenance',
    detail: 'The site is closed for scheduled maintenance. Please check back soon.',
  },
  locked: {
    id: 'locked',
    label: 'Closed',
    closed: true,
    headline: 'LuckyBlox is closed',
    detail: 'The site is closed right now. Please check back soon.',
  },
};

const VALID_IDS = Object.keys(STATUSES);

/**
 * Paths that must keep answering even while the site is closed, so the status
 * page itself, assets, and the launcher clients can still function.
 *
 * The website is what closes — the launcher/client protocol stays up, because
 * people who already have the client should still be able to log in and play
 * while the web pages are down for maintenance.
 */
const ALWAYS_OPEN = [
  /^\/sitestat$/,
  /^\/api\/site-status$/,
  /^\/css\//,
  /^\/fonts\//,
  /^\/site-icon\//,
  /^\/favicon\.(ico|png)$/,
  /^\/legacy-nav\.js$/,
  /^\/health$/,
  /^\/api\/preview-status$/,
  /^\/preview$/,
  // Client / launcher protocol — login, join and launch must survive a closed site.
  /^\/Login\//,
  /^\/login$/i,
  /^\/api\/login$/,
  /^\/api\/logout$/,
  /^\/api\/launch-game$/,
  /^\/api\/servers$/,
  /^\/api\/jobs\//,
  /^\/v1\//,
  /^\/game\//,
  /^\/studio\//,
  /^\/ClientSettings\//,
  /^\/AppSettings\.xml$/,
  /^\/asset\//i,
  /^\/assets\//,
  // Status + health for the launcher's own connectivity check.
  /^\/api\/v1\/me$/,
  /^\/api\/user\//,
  /^\/api\/users\//,
  /^\/api\/badges$/,
  /^\/api\/friends$/,
  /^\/api\/site-status$/,
];

function createSiteStatus(options) {
  const storePath = options.storePath;
  const envOverride = options.envOverride;
  // Set when the state file exists but could not be trusted. Surfaced in get()
  // so an unreadable file can never masquerade as "open".
  let lastReadError = null;

  function readFileState() {
    try {
      if (!fs.existsSync(storePath)) return null;
      // Strip a UTF-8 BOM: editors and PowerShell's -Encoding UTF8 add one, and
      // JSON.parse rejects it outright.
      const text = fs.readFileSync(storePath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!text) return null;
      const raw = JSON.parse(text);
      if (!raw || typeof raw !== 'object') {
        lastReadError = 'malformed';
        return null;
      }
      if (!VALID_IDS.includes(raw.status)) {
        lastReadError = 'unknown-status:' + String(raw.status);
        return null;
      }

      lastReadError = null;
      return {
        status: raw.status,
        note: typeof raw.note === 'string' ? raw.note : '',
        updatedAt: raw.updatedAt || null,
        updatedBy: raw.updatedBy || null,
      };
    } catch (error) {
      // Record the failure rather than pretending the file said "open".
      lastReadError = error && error.message ? error.message : 'read-failed';
      return null;
    }
  }

  function writeFileState(next) {
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      // Written as plain UTF-8 with no BOM so JSON.parse always round-trips.
      fs.writeFileSync(storePath, JSON.stringify(next, null, 2), { encoding: 'utf8' });
      lastReadError = null;
      return true;
    } catch (error) {
      lastReadError = error && error.message ? error.message : 'write-failed';
      return false;
    }
  }

  function get() {
    // An explicit env override wins so a deployment can pin a state.
    if (envOverride && VALID_IDS.includes(envOverride)) {
      const preset = STATUSES[envOverride];
      return {
        ...preset,
        open: !preset.closed,
        note: '',
        updatedAt: null,
        updatedBy: 'environment',
        source: 'environment',
      };
    }

    const stored = readFileState();
    const id = stored ? stored.status : 'open';
    const preset = STATUSES[id];
    return {
      ...preset,
      open: !preset.closed,
      note: stored ? stored.note : '',
      updatedAt: stored ? stored.updatedAt : null,
      updatedBy: stored ? stored.updatedBy : null,
      source: stored ? 'file' : 'default',
      readError: stored ? null : lastReadError,
    };
  }

  function set(statusId, meta) {
    if (!VALID_IDS.includes(statusId)) {
      return { ok: false, error: 'invalid-status', valid: VALID_IDS };
    }
    const next = {
      status: statusId,
      note: (meta && typeof meta.note === 'string') ? meta.note.slice(0, 500) : '',
      updatedAt: new Date().toISOString(),
      updatedBy: (meta && meta.updatedBy) ? String(meta.updatedBy) : 'owner',
    };
    const written = writeFileState(next);
    if (!written) {
      return { ok: false, error: 'write-failed' };
    }
    return { ok: true, state: get() };
  }

  function isAlwaysOpen(reqPath) {
    return ALWAYS_OPEN.some((rx) => rx.test(reqPath));
  }

  return { get, set, isAlwaysOpen, STATUSES, VALID_IDS, storePath };}

module.exports = { createSiteStatus, STATUSES, VALID_IDS };
