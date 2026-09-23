'use strict';

/**
 * Roblox public API client.
 *
 * Fetches real data from Roblox's public (unauthenticated) endpoints so the site
 * shows genuine avatars, catalog items, prices and thumbnails instead of
 * placeholder values. Everything here is best-effort: if Roblox is unreachable
 * the caller gets `null` and falls back to local data, so the site never breaks
 * on a network hiccup.
 *
 * Endpoints used (all public, no auth needed):
 *   users.roblox.com        /v1/users/{id}                       -> username, display name, created
 *   thumbnails.roblox.com   /v1/users/avatar-headshot            -> headshot image URL
 *   thumbnails.roblox.com   /v1/users/avatar                     -> full body image URL
 *   thumbnails.roblox.com   /v1/assets                           -> asset image URL
 *   economy.roblox.com      /v2/assets/{id}/details              -> item name, description, price
 *
 * Results are cached in-memory (TTL) so a busy page does not hammer Roblox and
 * so the site stays responsive.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Bound the cache so a long-running process cannot grow without limit.
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}

/**
 * Small JSON fetch with timeout. Uses the global fetch (Node 18+). Returns null
 * on any failure rather than throwing, so callers can fall back cleanly.
 */
async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const cached = cacheGet(url);
  if (cached !== null) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return cacheSet(url, null);
    }

    const json = await response.json();
    return cacheSet(url, json);
  } catch (error) {
    // Network error / timeout / abort - remember the miss briefly so we do not
    // retry the same failing URL on every request.
    return cacheSet(url, null);
  }
}

/** First completed image URL from a thumbnails.roblox.com response, or null. */
function firstImageUrl(payload) {
  const entry = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  if (!entry || entry.state !== 'Completed' || !entry.imageUrl) return null;
  return entry.imageUrl;
}

/** Real Roblox user record by id. { id, name, displayName, created, description } */
async function getUser(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const json = await fetchJson(`https://users.roblox.com/v1/users/${id}`);
  if (!json || !json.name) return null;
  return {
    id: json.id,
    name: json.name,
    displayName: json.displayName || json.name,
    created: json.created || null,
    description: json.description || '',
    hasVerifiedBadge: Boolean(json.hasVerifiedBadge),
  };
}

/** Resolve a username to a user id via users.roblox.com (POST /v1/usernames/users). */
async function getUserByUsername(username) {
  const name = String(username || '').trim();
  if (!name) return null;

  const url = 'https://users.roblox.com/v1/usernames/users';
  const cached = cacheGet(url + ':' + name.toLowerCase());
  if (cached !== null) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: true }),
    });
    clearTimeout(timer);
    if (!response.ok) return cacheSet(url + ':' + name.toLowerCase(), null);
    const json = await response.json();
    const entry = json && Array.isArray(json.data) ? json.data[0] : null;
    const value = entry ? { id: entry.id, name: entry.name, displayName: entry.displayName || entry.name } : null;
    return cacheSet(url + ':' + name.toLowerCase(), value);
  } catch (error) {
    return cacheSet(url + ':' + name.toLowerCase(), null);
  }
}

/**
 * Headshot image URL for a Roblox user id. `size` like '150x150' | '420x420'.
 * Used by profiles to render the real avatar instead of an initial letter.
 */
async function getAvatarHeadshotUrl(userId, size = '150x150') {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=${size}&format=Png&isCircular=false`;
  return firstImageUrl(await fetchJson(url));
}

/** Full-body avatar image URL for a Roblox user id (the dressed character). */
async function getAvatarFullBodyUrl(userId, size = '420x420') {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const url = `https://thumbnails.roblox.com/v1/users/avatar?userIds=${id}&size=${size}&format=Png`;
  return firstImageUrl(await fetchJson(url));
}

/** Roblox catalog item details by asset id (name, description, price, creator). */
async function getAssetDetails(assetId) {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const json = await fetchJson(`https://economy.roblox.com/v2/assets/${id}/details`);
  if (!json || !json.Name) return null;
  return {
    assetId: id,
    name: json.Name,
    description: json.Description || '',
    price: Number(json.PriceInRobux) || 0,
    isForSale: Boolean(json.IsForSale),
    assetTypeId: json.AssetTypeId || null,
    creator: json.Creator ? { id: json.Creator.Id, name: json.Creator.Name, type: json.Creator.CreatorType } : null,
    created: json.Created || null,
    updated: json.Updated || null,
  };
}

/** Thumbnail image URL for an asset id. */
async function getAssetThumbnailUrl(assetId, size = '150x150') {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=${size}&format=Png`;
  return firstImageUrl(await fetchJson(url));
}

/** Game/place icon image URL for a universe id (fallback for maps without art). */
async function getGameIconUrl(universeId, size = '150x150') {
  const id = Number(universeId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const url = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${id}&size=${size}&format=Png&isCircular=false`;
  return firstImageUrl(await fetchJson(url));
}

module.exports = {
  getUser,
  getUserByUsername,
  getAvatarHeadshotUrl,
  getAvatarFullBodyUrl,
  getAssetDetails,
  getAssetThumbnailUrl,
  getGameIconUrl,
  _clearCache: () => cache.clear(),
};
