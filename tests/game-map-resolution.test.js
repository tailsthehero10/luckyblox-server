const assert = require('node:assert/strict');
const { buildPlaceCatalogFromMaps, resolveRequestedPlace, normalizePlaceId } = require('../Webserver/http-db-bridge/gameMapResolver');

const catalog = buildPlaceCatalogFromMaps();
assert.ok(Array.isArray(catalog), 'catalog should be an array');
assert.ok(catalog.length > 0, 'catalog should include real map files from Maps');
assert.ok(catalog.some((entry) => entry.title && entry.filename), 'catalog entries should include real map titles and filenames');
assert.equal(normalizePlaceId(1818), 1818);
assert.equal(normalizePlaceId('2021'), 2021);
assert.equal(normalizePlaceId('bad-value'), 1818);
assert.ok(resolveRequestedPlace('2021 - Parkour 2021M.rbxl', catalog).placeId > 0);
assert.ok(resolveRequestedPlace(999999, catalog).placeId > 0);
console.log(`ok: ${catalog.length} map entries resolved`);
