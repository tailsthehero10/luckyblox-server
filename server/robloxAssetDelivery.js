'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_REDIRECTS = 5;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const NOT_FOUND_TTL_MS = 2 * 60 * 1000;
const USER_AGENT = 'LuckyBlox/1.0';
const pending = new Map();
const notFound = new Map();

function numericId(value) {
  const text = String(value == null ? '' : value).trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : null;
}

function numericVersion(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : null;
}

function isRobloxAssetHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'roblox.com'
    || host.endsWith('.roblox.com')
    || host === 'rbxcdn.com'
    || host.endsWith('.rbxcdn.com');
}

function safeAssetUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch (error) {
    throw new Error('Roblox asset delivery returned an invalid URL.');
  }
  if (url.protocol !== 'https:' || !isRobloxAssetHost(url.hostname)) {
    throw new Error('Roblox asset delivery returned a non-Roblox URL.');
  }
  if (url.port) throw new Error('Roblox asset delivery returned an unexpected port.');
  return url;
}

async function fetchWithTimeout(fetchImpl, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.8',
        'User-Agent': USER_AGENT,
      },
    });
    return {
      response,
      finish: () => clearTimeout(timeout),
    };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function readResponse(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ASSET_BYTES) throw new Error('Roblox asset exceeds the 64 MiB download limit.');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ASSET_BYTES) {
        await reader.cancel();
        throw new Error('Roblox asset exceeds the 64 MiB download limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function cachePaths(cacheDir, id, version) {
  const key = `${id}-${version || 'latest'}`;
  return {
    data: path.join(cacheDir, `${key}.bin`),
    metadata: path.join(cacheDir, `${key}.json`),
  };
}

function readCache(cacheDir, id, version) {
  if (!cacheDir) return null;
  const paths = cachePaths(cacheDir, id, version);
  try {
    const stat = fs.statSync(paths.data);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ASSET_BYTES) return null;
    const metadata = JSON.parse(fs.readFileSync(paths.metadata, 'utf8'));
    if (!metadata || typeof metadata.contentType !== 'string') return null;
    return {
      ok: true,
      buffer: fs.readFileSync(paths.data),
      contentType: metadata.contentType,
      cached: true,
    };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error;
    }
    return null;
  }
}

function writeCache(cacheDir, id, version, buffer, contentType) {
  if (!cacheDir) return;
  fs.mkdirSync(cacheDir, { recursive: true });
  const paths = cachePaths(cacheDir, id, version);
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const dataTemp = `${paths.data}${suffix}`;
  const metadataTemp = `${paths.metadata}${suffix}`;
  try {
    fs.writeFileSync(dataTemp, buffer, { flag: 'wx' });
    fs.writeFileSync(metadataTemp, JSON.stringify({ contentType }), { flag: 'wx' });
    fs.renameSync(dataTemp, paths.data);
    fs.renameSync(metadataTemp, paths.metadata);
  } finally {
    for (const file of [dataTemp, metadataTemp]) {
      try { fs.unlinkSync(file); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

async function readAssetResponse(fetchImpl, initialUrl) {
  let url = safeAssetUrl(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const request = await fetchWithTimeout(fetchImpl, url.href);
    try {
      const response = request.response;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects === MAX_REDIRECTS) {
          throw new Error('Roblox asset delivery returned an invalid redirect.');
        }
        url = safeAssetUrl(location, url);
        if (response.body) await response.body.cancel();
        continue;
      }

      if (!response.ok) {
        if (response.body) await response.body.cancel();
        const error = new Error(`Roblox asset delivery returned HTTP ${response.status}.`);
        error.statusCode = response.status;
        throw error;
      }

      const contentType = String(response.headers.get('content-type') || 'application/octet-stream')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();

      if (contentType.includes('json')) {
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          throw new Error('Roblox asset delivery returned invalid JSON.');
        }
        if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
          const error = new Error('Roblox reports that this asset is unavailable.');
          error.statusCode = 404;
          throw error;
        }
        const nextUrl = payload && (payload.location || (Array.isArray(payload.locations) && payload.locations[0]));
        if (!nextUrl) throw new Error('Roblox asset delivery did not return asset bytes or a download location.');
        url = safeAssetUrl(nextUrl, url);
        continue;
      }
      if (contentType.includes('text/html')) {
        throw new Error('Roblox asset delivery returned an HTML page instead of asset data.');
      }

      const buffer = await readResponse(response);
      if (buffer.length === 0) throw new Error('Roblox asset delivery returned an empty asset.');
      return { buffer, contentType };
    } finally {
      request.finish();
    }
  }
  throw new Error('Roblox asset delivery exceeded the redirect limit.');
}

async function fetchAssetContent(assetId, wantedVersion, options = {}) {
  const id = numericId(assetId);
  if (!id) return { ok: false, statusCode: 400, reason: 'invalid-asset-id' };
  const version = numericVersion(wantedVersion);
  if (wantedVersion != null && wantedVersion !== '' && !version) {
    return { ok: false, statusCode: 400, reason: 'invalid-asset-version' };
  }

  const cacheDir = options.cacheDir || null;
  const cached = readCache(cacheDir, id, version);
  if (cached) return cached;

  const key = `${cacheDir || ''}:${id}:${version || 'latest'}`;
  const missingUntil = notFound.get(key);
  if (missingUntil && missingUntil > Date.now()) {
    return { ok: false, statusCode: 404, reason: 'Roblox reports that this asset is unavailable.' };
  }
  if (missingUntil) notFound.delete(key);
  if (pending.has(key)) return pending.get(key);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch().');

  const task = (async () => {
    const url = new URL('https://assetdelivery.roblox.com/v1/asset/');
    url.searchParams.set('id', id);
    if (version) url.searchParams.set('version', version);
    try {
      const result = await readAssetResponse(fetchImpl, url.href);
      let cacheError = null;
      try {
        writeCache(cacheDir, id, version, result.buffer, result.contentType);
      } catch (error) {
        cacheError = error.message;
      }
      return { ok: true, ...result, cached: false, cacheError };
    } catch (error) {
      if (error.statusCode) {
        if (error.statusCode === 403 || error.statusCode === 404) {
          notFound.set(key, Date.now() + NOT_FOUND_TTL_MS);
        }
        return { ok: false, statusCode: error.statusCode, reason: error.message };
      }
      throw error;
    }
  })();

  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

module.exports = { fetchAssetContent, isRobloxAssetHost };
