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

/**
 * Bust (head + shoulders) render for a Roblox user id.
 * Public endpoint - verified 200 without authentication.
 */
async function getAvatarBustUrl(userId, size = '420x420') {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const url = `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${id}&size=${size}&format=Png&isCircular=false`;
  return firstImageUrl(await fetchJson(url));
}

/**
 * The 3D avatar render for a user id: the URL of the OBJ/MTL model pair and its
 * textures, as served by https://thumbnails.roblox.com/v1/users/avatar-3d.
 *
 * WARNING: this endpoint requires an authenticated Roblox session and returns
 * 403 for anonymous callers, so it resolves to null unless a session cookie is
 * supplied through ROBLOX_COOKIE. Callers must treat null as "unavailable" and
 * fall back to the flat render (/v1/users/avatar) rather than showing an error.
 */
async function getAvatar3dModel(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const url = `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${id}`;
  const cookie = process.env.ROBLOX_COOKIE || '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!response.ok) return null;
    const json = await response.json();
    return json && typeof json === 'object' ? json : null;
  } catch (error) {
    return null;
  }
}

/**
 * The Roblox avatar-model record for a user id, as returned by
 * https://avatar.roblox.com/v4/avatar (newer, hex colours) or
 * https://avatar.roblox.com/v1/avatar (older, numeric BrickColor ids).
 *
 * The two versions genuinely differ in the body-colour field name and format:
 *   v4  "bodyColors": { "headColor": "E8B995" }      hex string
 *   v1  "bodyColors": { "headColorId": 125 }         BrickColor number
 *
 * Both are returned here; callers normalise through normalizeAvatarModel().
 * Returns null when Roblox is unreachable or the user has no avatar model.
 */
async function getAvatarModel(userId, version = 4) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const v = Number(version) === 1 ? 1 : 4;
  const json = await fetchJson(`https://avatar.roblox.com/v${v}/avatar?userId=${id}`);
  if (!json || typeof json !== 'object') return null;
  // v4 wraps the payload in avatarModel; v1 returns it at the top level.
  return json.avatarModel && typeof json.avatarModel === 'object' ? json.avatarModel : json;
}

/**
 * BrickColor id -> hex colour, for the assets and accounts that still use the
 * numeric form. Only the colours this server actually hands out are needed, but
 * the common classics are included so a legacy id never renders as plain grey.
 */
const BRICKCOLOR_HEX = {
  1: 'F2F3', 5: 'A3A2A5', 9: 'E8E8E8', 11: '80BBDB', 18: 'CC8E69', 21: 'C4281C',
  23: '0D69AC', 24: 'F5CD30', 26: '1B2A34', 28: '287F47', 29: 'A1C48C', 37: '4B974B',
  38: 'A05F35', 45: 'B4D2E7', 1002: 'E8B995', 1004: 'E8B995', 1006: 'E8B995',
  1007: 'E8B995', 1008: 'E8B995', 1009: 'E8B995', 1010: 'E8B995', 1011: 'E8B995',
  1012: 'E8B995', 1013: 'E8B995', 1014: 'E8B995', 1015: 'E8B995', 1016: 'E8B995',
  1017: 'E8B995', 1018: 'E8B995', 1019: 'E8B995', 1020: 'E8B995', 1021: 'E8B995',
  1022: 'E8B995', 1023: 'E8B995', 1024: 'E8B995', 1025: 'E8B995', 1026: 'E8B995',
  1027: 'E8B995', 1028: 'E8B995', 1029: 'E8B995', 1030: 'E8B995', 1031: 'E8B995',
  1032: 'E8B995', 125: 'F5CD30',
};

/**
 * BrickColor id -> the part names it can colour, used to expand a stored
 * 1002/125 style record into per-part hex values.
 */
function brickColorToHex(value, fallback = 'E8B995') {
  if (value == null) return fallback;
  const raw = String(value).trim();
  // Already a hex string (v4 form, with or without a leading #).
  if (/^#?[0-9A-Fa-f]{6}$/.test(raw)) return raw.replace(/^#/, '').toUpperCase();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && BRICKCOLOR_HEX[numeric]) return BRICKCOLOR_HEX[numeric];
  return fallback;
}

/**
 * Normalise either avatar-model version into the single v1 shape this server
 * serves: numeric BrickColor ids plus per-part hex, R6/R15, scales, and the
 * equipped asset list with real names and asset types.
 *
 * `fallback` supplies the locally stored account data used when Roblox does not
 * answer - the site then still reports the account's own colours and items
 * rather than inventing or emptying the avatar.
 */
function normalizeAvatarModel(model, fallback = {}) {
  const source = model && typeof model === 'object' ? model : {};
  const local = fallback && typeof fallback === 'object' ? fallback : {};

  const srcColors = (source.bodyColors && typeof source.bodyColors === 'object')
    ? source.bodyColors : (local.bodyColors || {});

  // Accept both the hex names (headColor) and the numeric names (headColorId).
  const part = (name) => {
    const hexKey = name.toLowerCase();
    const idKey = `${hexKey}Id`;
    const idValue = srcColors[idKey] != null ? srcColors[idKey] : srcColors[name];
    const hex = srcColors[hexKey] != null
      ? brickColorToHex(srcColors[hexKey])
      : brickColorToHex(idValue);
    const numeric = Number(idValue);
    return {
      id: Number.isFinite(numeric) && numeric > 0 ? numeric : 1002,
      hex,
    };
  };

  const parts = {
    head: part('headColor'),
    torso: part('torsoColor'),
    rightArm: part('rightArmColor'),
    leftArm: part('leftArmColor'),
    rightLeg: part('rightLegColor'),
    leftLeg: part('leftLegColor'),
  };

  const scales = Object.assign(
    { height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 },
    (source.scales && typeof source.scales === 'object') ? source.scales : {},
    (local.scales && typeof local.scales === 'object') ? local.scales : {},
  );

  const assets = Array.isArray(source.assets) ? source.assets : [];

  return {
    scales,
    playerAvatarType: source.playerAvatarType || local.playerAvatarType || 'R15',
    bodyColors: {
      headColorId: parts.head.id,
      torsoColorId: parts.torso.id,
      rightArmColorId: parts.rightArm.id,
      leftArmColorId: parts.leftArm.id,
      rightLegColorId: parts.rightLeg.id,
      leftLegColorId: parts.leftLeg.id,
    },
    bodyColorHex: {
      headColor: parts.head.hex,
      torsoColor: parts.torso.hex,
      rightArmColor: parts.rightArm.hex,
      leftArmColor: parts.leftArm.hex,
      rightLegColor: parts.rightLeg.hex,
      leftLegColor: parts.leftLeg.hex,
    },
    assets: assets.map((asset) => ({
      id: Number(asset.id) || 0,
      name: asset.name || null,
      assetType: asset.assetType && typeof asset.assetType === 'object'
        ? { id: Number(asset.assetType.id) || 0, name: asset.assetType.name || 'Asset' }
        : { id: 0, name: String(asset.assetType || 'Asset') },
      currentVersionId: Number(asset.currentVersionId) || null,
      meta: asset.meta || undefined,
      supportsHeadShapes: asset.supportsHeadShapes === true ? true : undefined,
    })),
    defaultShirtApplied: source.defaultShirtApplied === true,
    defaultPantsApplied: source.defaultPantsApplied === true,
  };
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
  getAvatarBustUrl,
  getAvatar3dModel,
  getAvatarModel,
  normalizeAvatarModel,
  brickColorToHex,
  getAssetDetails,
  getAssetThumbnailUrl,
  getGameIconUrl,
  _clearCache: () => cache.clear(),
};
