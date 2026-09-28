'use strict';

/**
 * Creates (or updates) the deployment OWNER account - id 1, username
 * tailsthehero10 - from `LUCKYBLOX_OWNER_PASSWORD`.
 *
 * The bridge deliberately starts with NO seeded accounts, so a fresh deployment
 * has no owner record until somebody signs up. This is the local half of the same
 * mechanism the host uses: set the password, run this, and the owner exists with a
 * real PBKDF2 hash (never a plaintext password).
 *
 * Like the login path, it stores only the hash + salt + version, so the record is
 * harmless if the data file leaks.
 *
 * Usage:
 *   set LUCKYBLOX_OWNER_PASSWORD=... & node tools/make-owner.js
 */

const fs = require('fs');
const security = require('../server/security');
const storage = require('../server/storage');

const userId = String(process.env.LUCKYBLOX_OWNER_ID || '1');
const username = String(process.env.LUCKYBLOX_OWNER_USERNAME || 'tailsthehero10');
const password = process.env.LUCKYBLOX_OWNER_PASSWORD;

if (!password) {
  console.error('set LUCKYBLOX_OWNER_PASSWORD first');
  process.exit(1);
}

const policy = security.checkPasswordPolicy(password);
// The operator sets this password themselves through the environment, which is
// already a trusted channel - the policy exists to stop VISITORS choosing a weak
// password at signup, not to overrule the person who owns the deployment. Blog
// blocking here would make it impossible to set an operator password the policy
// happens to dislike (e.g. one with no uppercase letter), with no way through.
const allowWeak = String(process.env.LUCKYBLOX_OWNER_ALLOW_WEAK_PASSWORD || '').toLowerCase() === 'on';
if (!policy.ok && !allowWeak) {
  console.error('the password does not meet the site policy:');
  for (const e of policy.errors) console.error(`  - ${e}`);
  console.error('');
  console.error('To set it anyway (you are the operator, and this is your own account),');
  console.error('re-run with LUCKYBLOX_OWNER_ALLOW_WEAK_PASSWORD=on');
  process.exit(1);
}
if (!policy.ok) {
  console.warn('WARNING: the owner password does not meet the site policy:');
  for (const e of policy.errors) console.warn(`  - ${e}`);
  console.warn('  (continuing because LUCKYBLOX_OWNER_ALLOW_WEAK_PASSWORD=on)');
}

const usersPath = storage.dataPath('users.json');
let users = {};
try {
  users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
} catch (error) {
  users = {};
}

const existing = users[userId] || {};
const { hash, salt, version } = security.hashPassword(password);

users[userId] = {
  // Preserve anything already on the account so running this twice does not wipe
  // the owner's friends, inventory or currency.
  ...existing,
  userId,
  username,
  displayName: existing.displayName || username,
  password: hash,
  passwordSalt: salt,
  passwordVersion: version,
  role: 'owner',
  membershipStatus: existing.membershipStatus || 'None',
  membership: existing.membership || 'None',
  robux: existing.robux != null ? existing.robux : 0,
  currencies: existing.currencies || { robux: 0, coins: 0, tickets: 0 },
  inventory: existing.inventory || [],
  currentlyWearing: existing.currentlyWearing || [],
  friends: existing.friends || [],
  stats: existing.stats || {
    friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 0, gameVisits: 0,
  },
  joinDate: existing.joinDate || new Date().toISOString(),
  created: existing.created || new Date().toISOString(),
  bio: existing.bio || 'Owner of this LuckyBlox deployment.',
  avatar: existing.avatar || {
    bodyColors: {
      headColorId: 24, torsoColorId: 23,
      leftArmColorId: 24, rightArmColorId: 24,
      leftLegColorId: 119, rightLegColorId: 119,
    },
    playerAvatarType: 'R6',
  },
  avatarType: existing.avatarType || 'R6',
};

storage.writeJson('users.json', users);
console.log(`owner written: id ${userId}, username ${username}`);
console.log(`  ${usersPath}`);
console.log('  password stored as a PBKDF2 hash (no plaintext)');