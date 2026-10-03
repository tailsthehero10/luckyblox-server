'use strict';

const assert = require('node:assert/strict');
const { searchUsers } = require('../server/userSearch');

const users = {
  1: { userId: 1, username: 'PlayerOne', displayName: 'Nova' },
  2: { userId: 2, username: 'NovaFan', displayName: 'Player Two' },
  3: { userId: 3, username: 'SuperNova', displayName: 'Star' },
  4: { userId: 4, username: 'nobody', displayName: 'Different' },
  invalid: { username: 'NovaGhost', displayName: 'Nova' },
};

const exact = searchUsers(users, '@playerone');
assert.equal(exact.total, 1);
assert.equal(exact.users[0].userId, 1, 'exact username match is found case-insensitively');

const partial = searchUsers(users, 'nova', 2);
assert.equal(partial.total, 3, 'partial matches include username and display name');
assert.deepEqual(
  partial.users.map((user) => user.userId),
  [1, 2],
  'display-name and username-prefix matches are relevance-ranked',
);
assert.equal(searchUsers(users, '').total, 0, 'empty queries do not enumerate accounts');

console.log('ok: people search supports exact, partial, display-name and ranked matches');
