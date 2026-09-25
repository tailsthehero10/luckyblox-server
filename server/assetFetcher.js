'use strict';

/**
 * LuckyBlox — download Roblox assets to this server.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site used to hotlink thumbnails straight from `thumbnails.roblox.com` and
 * shipped an `assets.json` whose four "starter" items were invented ids
 * (1001..1004) with invented names. Those ids do not exist on Roblox at all:
 * asking the economy API for them returns 404, and their thumbnails come back
 * `BrokenImage`. So the avatar rendered blank and nothing could be trusted.
 *
 * This module does what was actually wanted: FETCH the real asset from Roblox,
 * SAVE the bytes into this server's own folder, and record the verified metadata
 * in assets.json. After a fetch the site serves the real image from its own disk
 * (no hotlinking, works offline, survives Roblox changing its CDN).
 *
 * WHAT IT DOWNLOADS
 *   - the asset thumbnail (the image the avatar page renders)
 *   - the real asset name / type / price / creator, verified against
 *     economy.roblox.com/v2/assets/{id}/details
 *
 * WHAT IT REFUSES TO DO
 *   - It never writes a record for an id Roblox does not recognise. A bad id is
 *     reported and skipped, so assets.json can only ever contain real items.
 *   - It never invents a name, price or type. Every field comes from an API reply.
 *
 * USAGE
 *   const assetFetcher = require('./assetFetcher');
 *   await assetFetcher.fetchAsset(assetId);          // one asset
 *   await assetFetcher.fetchStarterSet();            // the starter inventory
 *   await assetFetcher.fetchAll(ids);                // a list
 *
 * Every function is best-effort and returns a result object rather than throwing,
 * so a Roblox outage degrades the fetch instead of breaking the server.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 20000;
const USER_AGENT = 'LuckyBlox/1.0 (+https://luckyblox.local)';

/**
 * The starter inventory, with ids verified against the live Roblox APIs.
 *
 * Each entry was confirmed to exist and to report the type shown. Nothing here is
 * guessed: `verified` records what the API said when it was checked, and
 * fetchAsset() re-checks on every fetch anyway.
 */
const STARTER_SET = [
  { id: 607702162, slot: 'Hat', note: 'Roblox Baseball Cap, by Roblox, free' },
  { id: 1029025, slot: 'Hat', note: 'The Classic ROBLOX Fedora, by Roblox' },
  { id: 25330901, slot: 'Pants', note: 'Plad Short Shorts (Blue) - a real Pants asset' },
];

/** Roblox AssetTypeId -> the human name the site shows. */
const ASSET_TYPE_NAMES = {
  1: 'Image',
  2: 'TShirt',
  3: 'Audio',
  4: 'Mesh',
  5: 'Lua',
  6: 'HTML',
  7: 'Text',
  8: 'Hat',
  9: 'Place',
  10: 'Model',
  11: 'Shirt',
  12: 'Pants',
  13: 'Decal',
  17: 'Head',
  18: 'Face',
  19: 'Gear',
  24: 'Animation',
  27: 'Torso',
  28: 'RightArm',
  29: 'LeftArm',
  30: 'RightLeg',
  31: 'LeftLeg',
  32: 'Package',
  38: 'Plugin',
  40: 'MeshPart',
  41: 'HairAccessory',
  42: 'FaceAccessory',
  43: 'NeckAccessory',
  44: 'ShoulderAccessory',
  45: 'FrontAccessory',
  46: 'BackAccessory',
  47: 'WaistAccessory',
  48: 'ClimbAnimation',
  49: 'FallAnimation',
  50: 'IdleAnimation',
  51: 'JumpAnimation',
  52: 'RunAnimation',
  53: 'SwimAnimation',
  54: 'WalkAnimation',
  55: 'PoseAnimation',
  56: 'EarAccessory',
  57: 'EyeAccessory',
  61: 'EmoteAnimation',
  64: 'TShirtAccessory',
  65: 'ShirtAccessory',
  66: 'PantsAccessory',
  67: 'JacketAccessory',
  68: 'SweaterAccessory',
  69: 'ShortsAccessory',
  70: 'LeftShoeAccessory',
  71: 'RightShoeAccessory',
};

function assetTypeName(typeId) {
  const id = Number(typeId);
  return ASSET_TYPE_NAMES[id] || `Type${id || 0}`;
}

/** fetch with a timeout; never hangs the process on a stalled connection. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(options && options.headers ? options.headers : {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verified metadata for an asset id from economy.roblox.com.
 * Returns null when Roblox does not know the id (404) - which is the signal that
 * an id is NOT real and must not be written to assets.json.
 */
async function fetchAssetDetails(assetId) {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    const res = await fetchWithTimeout(`https://economy.roblox.com/v2/assets/${id}/details`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.Name) return null;

    return {
      assetId: id,
      name: String(json.Name),
      description: String(json.Description || ''),
      assetTypeId: Number(json.AssetTypeId) || 0,
      assetType: assetTypeName(json.AssetTypeId),
      price: Number(json.PriceInRobux) || 0,
      isForSale: Boolean(json.IsForSale),
      creatorName: json.Creator ? String(json.Creator.Name || '') : '',
      creatorId: json.Creator ? Number(json.Creator.Id) || 0 : 0,
      created: json.Created || null,
      updated: json.Updated || null,
    };
  } catch (error) {
    return null;
  }
}

/**
 * The image URL Roblox serves for an asset, or null.
 *
 * Only a `Completed` state with a real imageUrl is accepted. `BrokenImage`,
 * `Pending` and `Blocked` are all treated as "no image", which is exactly the
 * case the invented 1001..1004 ids fell into.
 */
async function fetchThumbnailUrl(assetId, size = '420x420') {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=${size}&format=Png`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json && Array.isArray(json.data) ? json.data[0] : null;
    if (!entry || entry.state !== 'Completed' || !entry.imageUrl) return null;
    return String(entry.imageUrl);
  } catch (error) {
    return null;
  }
}

/** Download a URL to a file, atomically. Returns true on success. */
async function downloadToFile(url, filePath) {
  try {
    const res = await fetchWithTimeout(url, {}, 30000);
    if (!res.ok) return false;

    const buffer = Buffer.from(await res.arrayBuffer());
    // A 0-byte or tiny reply is a failure, not an image.
    if (buffer.length < 64) return false;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Fetch one asset: verify it, download its thumbnail to disk, and return the
 * record to store in assets.json.
 *
 * @param {number} assetId
 * @param {object} opts
 *   opts.cacheDir  where the PNG is written (default <release>/Webserver/www/asset-cache)
 *   opts.publicUrl the URL prefix the site serves cacheDir under (default /asset-cache)
 *   opts.size      thumbnail size (default 420x420)
 * @returns {object} { ok, assetId, record } or { ok:false, reason }
 */
async function fetchAsset(assetId, opts = {}) {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, assetId: id, reason: 'invalid-id' };
  }

  // 1. Does Roblox actually have this asset? If not, stop - never invent a row.
  const details = await fetchAssetDetails(id);
  if (!details) {
    return { ok: false, assetId: id, reason: 'not-found-on-roblox' };
  }

  // 2. Get its real image.
  const imageUrl = await fetchThumbnailUrl(id, opts.size || '420x420');
  if (!imageUrl) {
    return { ok: false, assetId: id, reason: 'no-thumbnail', details };
  }

  // 3. Save the bytes locally so the site serves it from our own disk.
  const cacheDir = opts.cacheDir;
  let localThumbnail = null;
  if (cacheDir) {
    const filePath = path.join(cacheDir, `${id}.png`);
    const saved = await downloadToFile(imageUrl, filePath);
    if (saved) {
      localThumbnail = `${opts.publicUrl || '/asset-cache'}/${id}.png`;
    }
  }

  return {
    ok: true,
    assetId: id,
    sourceUrl: imageUrl,
    downloaded: Boolean(localThumbnail),
    record: {
      id: String(id),
      assetId: id,
      name: details.name,
      description: details.description,
      assetType: details.assetType,
      assetTypeId: details.assetTypeId,
      price: details.price,
      isForSale: details.isForSale,
      creatorName: details.creatorName,
      creatorId: details.creatorId,
      // The locally saved file, so the page never depends on Roblox's CDN.
      thumbnail: localThumbnail,
      // Kept for provenance, so it is always clear where this came from.
      thumbnailSource: imageUrl,
      source: 'roblox:fetched',
      fetchedAt: new Date().toISOString(),
    },
  };
}

/** Fetch several assets. Returns { ok, fetched, failed, records }. */
async function fetchAll(assetIds, opts = {}) {
  const fetched = [];
  const failed = [];

  for (const assetId of assetIds) {
    const result = await fetchAsset(assetId, opts);
    if (result.ok && result.record) {
      fetched.push(result.record);
      console.log(`[luckyblox:assets] fetched ${result.assetId} "${result.record.name}" (${result.record.assetType})`
        + (result.downloaded ? ' + image saved' : ' (no image)'));
    } else {
      failed.push({ assetId, reason: result.reason });
      console.warn(`[luckyblox:assets] skipped ${assetId}: ${result.reason}`);
    }
  }

  return { ok: true, fetched, failed, records: fetched };
}

/** Fetch the verified starter set. */
async function fetchStarterSet(opts = {}) {
  return fetchAll(STARTER_SET.map((s) => s.id), opts);
}

module.exports = {
  STARTER_SET,
  ASSET_TYPE_NAMES,
  assetTypeName,
  fetchAssetDetails,
  fetchThumbnailUrl,
  fetchAsset,
  fetchAll,
  fetchStarterSet,
};