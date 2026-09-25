'use strict';

/**
 * Fetch REAL Roblox assets into this server.
 *
 * Run: node tools/fetch-roblox-assets.js
 *      node tools/fetch-roblox-assets.js 607702162 25330901
 *
 * What it does:
 *   1. asks economy.roblox.com for each asset's real name/type/price/creator
 *   2. asks thumbnails.roblox.com for its real image
 *   3. SAVES the image bytes into Webserver/www/asset-cache/<id>.png
 *   4. merges the verified record into Webserver/http-db-bridge/data/assets.json
 *
 * An id Roblox does not know is reported and skipped - it is never written as a
 * made-up record. That is the whole point: assets.json can only hold real items.
 */

const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..');
const fetcher = require(path.join(releaseRoot, 'server', 'assetFetcher.js'));

const cacheDir = path.join(releaseRoot, 'Webserver', 'www', 'asset-cache');
const assetsPath = path.join(releaseRoot, 'Webserver', 'http-db-bridge', 'data', 'assets.json');
const publicUrl = '/asset-cache';

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    // Strip a UTF-8 BOM - PowerShell's Set-Content writes one, and JSON.parse
    // rejects it. (Same guard as server/storage.js.)
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[fetch-assets] could not read ${path.basename(file)}: ${error.message}`);
    return fallback;
  }
}

function writeJson(file, data) {
  // Write WITHOUT a BOM, always. A BOM here breaks every future read.
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

async function main() {
  const argIds = process.argv.slice(2)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);

  console.log('[fetch-assets] source: economy.roblox.com (metadata) + thumbnails.roblox.com (image)');
  console.log(`[fetch-assets] saving images to: ${cacheDir}`);
  console.log(`[fetch-assets] target data file:   ${assetsPath}`);
  console.log('');

  const result = argIds.length
    ? await fetcher.fetchAll(argIds, { cacheDir, publicUrl })
    : await fetcher.fetchStarterSet({ cacheDir, publicUrl });

  if (!result.records.length) {
    console.error('[fetch-assets] nothing fetched. Check the network and the ids.');
    if (result.failed.length) {
      for (const f of result.failed) console.error(`  - ${f.assetId}: ${f.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  // Merge only verified records. Existing local fields the fetch does not own
  // (e.g. a locally set price override) are preserved by the spread order.
  const assets = readJson(assetsPath, {});
  for (const record of result.records) {
    const key = String(record.assetId);
    assets[key] = Object.assign({}, assets[key] || {}, record);
  }
  writeJson(assetsPath, assets);

  console.log('');
  console.log(`[fetch-assets] wrote ${result.records.length} verified asset(s):`);
  for (const r of result.records) {
    console.log(`  ${String(r.assetId).padEnd(12)} ${r.assetType.padEnd(16)} "${r.name}"`
      + `  price=${r.price}  image=${r.thumbnail ? 'saved' : 'none'}`);
  }
  if (result.failed.length) {
    console.log('');
    console.log('[fetch-assets] skipped (not real / no image):');
    for (const f of result.failed) console.log(`  ${f.assetId}: ${f.reason}`);
  }
  console.log('');
  console.log('[fetch-assets] done.');
}

main().catch((error) => {
  console.error('[fetch-assets] fatal:', error && error.message ? error.message : error);
  process.exitCode = 1;
});