const fs = require('fs');
const path = require('path');

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/i, '').trim();
}

function filenameToTitle(filename) {
  const cleaned = stripExt(filename || '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) {
    return 'LuckyBlox Arena';
  }

  return cleaned
    .replace(/\s+/g, ' ')
    .replace(/\b(\d{4})\b/g, '$1')
    .trim();
}

function parsePlaceIdFromFilename(filename) {
  const base = stripExt(filename || '');
  const match = base.match(/(^|\D)(\d{4})(?=\D|$)/);
  if (match) {
    const year = Number(match[2]);
    if (Number.isFinite(year) && year > 0) {
      return year;
    }
  }

  const fallback = Number.parseInt(base.match(/\d+/)?.[0] || '', 10);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function buildPlaceCatalogFromMaps(mapsRoot = path.resolve(__dirname, '..', '..', 'Maps')) {
  if (!fs.existsSync(mapsRoot)) {
    return [{ placeId: 1818, title: 'LuckyBlox Arena', filename: 'LuckyBlox Arena.rbxl', path: path.join(mapsRoot, 'LuckyBlox Arena.rbxl') }];
  }

  const files = fs.readdirSync(mapsRoot)
    .filter((entry) => /\.rbxlx?$/i.test(entry) && !entry.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));

  const catalog = [];
  files.forEach((file, index) => {
    const title = filenameToTitle(file);
    const placeId = parsePlaceIdFromFilename(file) ?? 1800 + index + 1;
    catalog.push({
      placeId,
      title,
      filename: file,
      path: path.join(mapsRoot, file),
      keywords: [title.toLowerCase(), file.toLowerCase()],
    });
  });

  return catalog.length > 0 ? catalog : [{ placeId: 1818, title: 'LuckyBlox Arena', filename: 'LuckyBlox Arena.rbxl', path: path.join(mapsRoot, 'LuckyBlox Arena.rbxl') }];
}

function normalizePlaceId(rawPlaceId) {
  if (rawPlaceId === undefined || rawPlaceId === null || rawPlaceId === '') {
    return 1818;
  }

  if (typeof rawPlaceId === 'number') {
    return Number.isFinite(rawPlaceId) && rawPlaceId > 0 ? rawPlaceId : 1818;
  }

  const candidate = String(rawPlaceId).trim();
  if (!candidate) {
    return 1818;
  }

  const numeric = Number(candidate);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const match = candidate.match(/(\d{4})/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 1818;
}

function resolveRequestedPlace(rawPlaceId, catalog = buildPlaceCatalogFromMaps()) {
  const fallback = catalog[0] || { placeId: 1818, title: 'LuckyBlox Arena', filename: 'LuckyBlox Arena.rbxl' };

  if (rawPlaceId === undefined || rawPlaceId === null || rawPlaceId === '') {
    return fallback;
  }

  const normalized = normalizePlaceId(rawPlaceId);
  const matchById = catalog.find((entry) => Number(entry.placeId) === Number(normalized));
  if (matchById) {
    return matchById;
  }

  const rawText = String(rawPlaceId).toLowerCase();
  const matchByText = catalog.find((entry) => {
    const hay = [entry.title, entry.filename].join(' ').toLowerCase();
    const titleMatch = hay.includes(rawText);
    const filenameMatch = rawText.includes(entry.filename.toLowerCase());
    return titleMatch || filenameMatch;
  });

  if (matchByText) {
    return matchByText;
  }

  return fallback;
}

module.exports = {
  buildPlaceCatalogFromMaps,
  parsePlaceIdFromFilename,
  normalizePlaceId,
  resolveRequestedPlace,
  filenameToTitle,
};
