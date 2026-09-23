// One-off: set the owner (id 1) password to a known value using the server's own
// hashing, then print the row so it can be verified.
const fs = require('fs');
const path = require('path');
const security = require('./server/security.js');

const usersPath = path.join(__dirname, 'Webserver', 'http-db-bridge', 'data', 'users.json');
const password = process.argv[2];
const targetId = process.argv[3] || '1';

if (!password) {
  console.error('usage: node set-owner-password.js <password> [userId]');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const user = users[targetId];
if (!user) {
  console.error('no user with id ' + targetId);
  process.exit(1);
}

const { hash, salt, version } = security.hashPassword(password);
user.password = hash;
user.passwordSalt = salt;
user.passwordVersion = version;
user.updatedAt = new Date().toISOString();
users[targetId] = user;

fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
console.log('updated user', targetId, user.username, 'version', version);

// Verify round-trip immediately.
console.log('verifyPassword ->', security.verifyPassword(password, user.password, user.passwordSalt));
