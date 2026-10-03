'use strict';

function searchUsers(users, query, limit = 50) {
  const needle = String(query || '').trim().replace(/^@/, '').toLowerCase();
  if (!needle || !users || typeof users !== 'object') return { users: [], total: 0 };

  const ranked = Object.entries(users).reduce((matches, [key, user]) => {
    if (!user || typeof user !== 'object' || !user.username) return matches;
    const username = String(user.username);
    const displayName = String(user.displayName || username);
    const usernameLower = username.toLowerCase();
    const displayNameLower = displayName.toLowerCase();
    const exactUsername = usernameLower === needle;
    const exactDisplayName = displayNameLower === needle;
    const usernamePrefix = usernameLower.startsWith(needle);
    const displayNamePrefix = displayNameLower.startsWith(needle);
    const usernameMatch = usernameLower.includes(needle);
    const displayNameMatch = displayNameLower.includes(needle);

    if (!usernameMatch && !displayNameMatch) return matches;

    let rank = 5;
    if (exactUsername) rank = 0;
    else if (exactDisplayName) rank = 1;
    else if (usernamePrefix) rank = 2;
    else if (displayNamePrefix) rank = 3;
    else if (usernameMatch) rank = 4;

    const userId = Number(user.userId || user.id || key);
    if (!Number.isSafeInteger(userId) || userId <= 0) return matches;
    matches.push({ ...user, userId, _searchRank: rank });
    return matches;
  }, []);

  ranked.sort((a, b) => a._searchRank - b._searchRank
    || String(a.username).localeCompare(String(b.username))
    || a.userId - b.userId);
  return {
    users: ranked.slice(0, Math.max(0, Number(limit) || 0)).map(({ _searchRank, ...user }) => user),
    total: ranked.length,
  };
}

module.exports = { searchUsers };
