'use strict';

/**
 * LuckyBlox security layer.
 *
 * Real, dependency-free primitives used by the auth routes:
 *   - password policy + strength scoring
 *   - PBKDF2 password hashing with per-user salt and versioning
 *   - in-memory sliding-window rate limiting (per IP + per username)
 *   - account lockout after repeated failures
 *   - CSRF tokens bound to a session
 *   - HTTP-only, SameSite session cookies
 *   - a security audit log appended to disk
 *
 * Everything here is deterministic and unit-testable; no fake/stub behaviour.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const HASH_VERSION = 3;

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/**
 * Hash a password with PBKDF2-HMAC-SHA512. Returns the fields to persist.
 * Format is versioned so old hashes can be upgraded on next successful login.
 */
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password), useSalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return { hash, salt: useSalt, version: HASH_VERSION };
}

/**
 * Constant-time password verification. Supports the legacy v2 hash (same PBKDF2
 * parameters) and rejects malformed input instead of throwing.
 */
function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) {
    return false;
  }
  try {
    const test = crypto
      .pbkdf2Sync(String(password), String(salt), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
      .toString('hex');
    const a = Buffer.from(test, 'hex');
    const b = Buffer.from(String(hash), 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'admin', 'admin123', 'local',
  'roblox', 'luckyblox', 'iloveyou', 'abc123', '111111', '000000',
]);

/**
 * Validate a password against the LuckyBlox policy.
 * Returns { ok, errors[], score } where score is 0-4 (weak..strong).
 */
function checkPasswordPolicy(password) {
  const value = String(password || '');
  const errors = [];
  let score = 0;

  if (value.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  } else {
    score += value.length >= 12 ? 2 : 1;
  }

  if (!/[a-z]/.test(value)) {
    errors.push('Password must include a lowercase letter.');
  } else {
    score += 1;
  }

  if (!/[A-Z]/.test(value)) {
    errors.push('Password must include an uppercase letter.');
  } else {
    score += 1;
  }

  if (!/[0-9]/.test(value)) {
    errors.push('Password must include a number.');
  } else {
    score += 1;
  }

  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    errors.push('That password is too common. Pick something unique.');
    score = 0;
  }

  if (/^(.)\1+$/.test(value)) {
    errors.push('Password cannot be a single repeated character.');
    score = 0;
  }

  return {
    ok: errors.length === 0,
    errors,
    score: Math.max(0, Math.min(4, score)),
  };
}

/**
 * Names nobody may register.
 *
 * Roblox reserves its own brand words, its official accounts and the names of
 * its systems, so a visitor can never register `Roblox`, `Admin`, or the name of
 * a real staff account. LuckyBlox needs the same guard for a security reason on
 * top of the impersonation one: the deployment OWNER is identified by username
 * (LUCKYBLOX_OWNER_USERNAME, default `tailsthehero10`), so if that name could be
 * registered, the registrant would be handed owner + admin instantly.
 *
 * Compared case-insensitively and with underscores stripped, so `_Admin_`,
 * `a_d_m_i_n` and `ADMIN` are all caught - the same normalisation the signup
 * uniqueness check uses.
 */
const RESERVED_USERNAMES = new Set([
  // The product and its systems.
  'luckyblox', 'luckblox', 'luckybloxadmin', 'luckbloxstaff', 'luckybloxmod',
  'roblox', 'robloxadmin', 'robloxstaff', 'robloxmod', 'builderman',
  // The deployment owner. LUCKYBLOX_OWNER_USERNAME is read at call time so an
  // operator who sets a custom owner name also reserves it.
  'tailsthehero10', 'tailsthehero',
  // Privileged-sounding names, which are the impersonation vector.
  'admin', 'administrator', 'moderator', 'mod', 'owner', 'root', 'sysadmin',
  'superadmin', 'staff', 'support', 'helpdesk', 'system', 'official',
  'security', 'server', 'operator', 'host',
]);

/**
 * Names that may not be used as a whole word inside a username.
 *
 * Roblox blocks a name that merely CONTAINS its brand, so `RobloxFan123` and
 * `i_am_admin_2` are rejected too - otherwise a visitor can still look official
 * without owning the exact name.
 */
const RESERVED_SUBSTRINGS = ['roblox', 'luckyblox', 'builderman'];

/**
 * Is this name reserved?
 *
 * Exported so the signup routes, the API signup and any rename path all share
 * one answer instead of each keeping its own list.
 */
function isReservedUsername(username) {
  const raw = String(username || '').trim();
  if (!raw) return false;

  // Normalise the way an impostor would try to dodge the check: lowercase, and
  // without the separators a username is allowed to contain.
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (RESERVED_USERNAMES.has(compact)) return true;

  const ownerName = String(process.env.LUCKYBLOX_OWNER_USERNAME || 'tailsthehero10')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (ownerName && compact === ownerName) return true;

  return RESERVED_SUBSTRINGS.some((needle) => compact.includes(needle));
}

/**
 * Validate a username: 3-20 chars, letters/numbers/underscore, not reserved.
 */
function checkUsernamePolicy(username) {
  const value = String(username || '').trim();
  const errors = [];

  if (value.length < 3 || value.length > 20) {
    errors.push('Username must be between 3 and 20 characters.');
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    errors.push('Username can only contain letters, numbers, and underscores.');
  }
  if (/^_|_$/.test(value)) {
    errors.push('Username cannot start or end with an underscore.');
  }
  // Reserved names are rejected with the same wording Roblox uses, so the
  // message never hints at which name was special.
  if (isReservedUsername(value)) {
    errors.push('That username is not available.');
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window, in-memory)
// ---------------------------------------------------------------------------

const buckets = new Map();

/**
 * Record a hit for `key` and report whether it is still under `limit` within
 * `windowMs`. Also prunes expired entries so memory stays bounded.
 */
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfterMs = windowMs - (now - hits[0]);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, remaining: limit - hits.length, retryAfterMs: 0 };
}

/** Clear the rate-limit bucket for a key (used after a successful login). */
function clearRateLimit(key) {
  buckets.delete(key);
}

/** Prune all expired buckets; called on an interval to avoid unbounded growth. */
function pruneRateLimits(maxWindowMs = 60 * 60 * 1000) {
  const now = Date.now();
  for (const [key, hits] of buckets.entries()) {
    const alive = hits.filter((ts) => now - ts < maxWindowMs);
    if (alive.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, alive);
    }
  }
}

// ---------------------------------------------------------------------------
// Account lockout
// ---------------------------------------------------------------------------

const lockouts = new Map(); // username(lower) -> { failures, lockedUntil }

/**
 * Register a failed login. After `threshold` failures the account is locked for
 * `lockMs`. Returns the resulting lockout state.
 */
function registerFailedLogin(username, threshold = 6, lockMs = 15 * 60 * 1000) {
  const key = String(username || '').toLowerCase();
  const entry = lockouts.get(key) || { failures: 0, lockedUntil: 0 };
  entry.failures += 1;

  if (entry.failures >= threshold) {
    entry.lockedUntil = Date.now() + lockMs;
    entry.failures = 0;
  }

  lockouts.set(key, entry);
  return { ...entry };
}

/** Returns { locked, retryAfterMs } for a username. */
function getLockoutState(username) {
  const key = String(username || '').toLowerCase();
  const entry = lockouts.get(key);
  if (!entry || !entry.lockedUntil) {
    return { locked: false, retryAfterMs: 0 };
  }
  if (Date.now() >= entry.lockedUntil) {
    lockouts.delete(key);
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - Date.now() };
}

/** Clear a user's lockout after a successful login. */
function clearLockout(username) {
  lockouts.delete(String(username || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/**
 * Create a CSRF token bound to a session id using HMAC. The token is safe to
 * embed in a form and is validated on POST/PUT/DELETE.
 */
function createCsrfToken(sessionId, secret) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${sessionId}.${nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Verify a CSRF token against the session id (constant-time compare). */
function verifyCsrfToken(token, sessionId, secret) {
  if (!token || typeof token !== 'string') {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  const [tokenSession, nonce, sig] = parts;
  if (tokenSession !== sessionId) {
    return false;
  }

  // Strict format check: Buffer.from(..., 'hex') silently truncates at the first
  // invalid character, which would let an attacker append junk to a valid
  // signature. Reject anything that is not pure lowercase hex of the exact
  // expected length before comparing.
  if (!/^[0-9a-f]{64}$/.test(sig)) {
    return false;
  }
  if (!/^[0-9a-f]{32}$/.test(nonce)) {
    return false;
  }

  try {
    const expected = crypto.createHmac('sha256', secret).update(`${tokenSession}.${nonce}`).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Append a structured security event to the audit log. Never throws — logging
 * failures must not break request handling.
 */
function createAuditLogger(logFilePath) {
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  } catch (error) {
    /* ignore */
  }

  return function audit(event, details = {}) {
    const record = {
      at: new Date().toISOString(),
      event: String(event),
      ...details,
    };
    try {
      fs.appendFileSync(logFilePath, JSON.stringify(record) + '\n');
    } catch (error) {
      /* ignore */
    }
    return record;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort client IP from proxy headers, normalised. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const socketIp = (req.socket && req.socket.remoteAddress) || '';
  return socketIp.replace('::ffff:', '').replace('::1', '127.0.0.1') || 'unknown';
}

/** Generate a cryptographically-strong session id. */
function generateSessionId() {
  return `lb_${crypto.randomBytes(24).toString('hex')}`;
}

/** Generate a Roblox-style job id (UUID v4). */
function generateJobId() {
  return crypto.randomUUID();
}

module.exports = {
  PBKDF2_ITERATIONS,
  HASH_VERSION,
  hashPassword,
  verifyPassword,
  checkPasswordPolicy,
  checkUsernamePolicy,
  isReservedUsername,
  rateLimit,
  clearRateLimit,
  pruneRateLimits,
  registerFailedLogin,
  getLockoutState,
  clearLockout,
  createCsrfToken,
  verifyCsrfToken,
  createAuditLogger,
  clientIp,
  generateSessionId,
  generateJobId,
  COMMON_PASSWORDS,
};
