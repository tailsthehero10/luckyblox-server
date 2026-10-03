'use strict';

/**
 * Local DataStore.
 *
 * The 2021M client does NOT talk to Roblox's DataStore cloud - a CoreScript
 * module (`shared/content/DataStoreService.rbxm`) replaces `DataStoreService`
 * with a local implementation that reads and writes plain files through the
 * datastore PHP endpoints:
 *
 *   GET  /datastore/getds.php?key=<key>
 *   POST /datastore/setds.php  { key, data }
 *   GET  /datastore/getorderedds.php?dsname=<store>
 *   POST /datastore/setorderedds.php { dsname, key, data }
 *
 * Those files live under `Webserver/www/datastore/` and are served by Apache on
 * a desktop install. The Node bridge, however, never served them - so on the
 * public deployment (and any setup where Node is the front door) every
 * `GetAsync`/`SetAsync` returned 404 and in-game saving silently failed. That is
 * the exact mismatch between the local and public server this module closes.
 *
 * Rather than shelling out to PHP (the binary is not guaranteed on a Linux
 * container), this reimplements the same behaviour in Node, writing the SAME
 * files in the SAME directories with the same atomic + locked semantics as
 * `Webserver/www/datastore/common.php`. Both servers therefore read and write
 * one shared store and a save made on the public site is visible on the desktop.
 *
 * Key validation mirrors datastore_key() in common.php: no path separators, no
 * "..", no control characters and a bounded length, so a crafted key can never
 * escape the items/ folder.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_KEY_LENGTH = 180;
const MAX_VALUE_BYTES = 4 * 1024 * 1024;

// `Webserver/www/datastore` - the same folder Apache serves, so the two
// implementations are one store rather than two copies.
const DATASTORE_ROOT = path.resolve(__dirname, '..', 'www', 'datastore');
const ITEMS_DIR = path.join(DATASTORE_ROOT, 'items');
const ORDERED_DIR = path.join(DATASTORE_ROOT, 'ordereddatastore');

/**
 * Validate a datastore key. Returns the key when safe, otherwise throws an
 * Error with a `status` the route can map onto an HTTP code - the same checks
 * datastore_key() applies server-side.
 */
function validateKey(key, label) {
  const value = key === undefined || key === null ? '' : String(key);
  const invalid = value === ''
    || value.length > MAX_KEY_LENGTH
    || value.includes('..')
    || value.includes('/')
    || value.includes('\\')
    || /[\x00-\x1F\x7F]/.test(value);

  if (invalid) {
    const error = new Error('Invalid datastore key');
    error.status = 400;
    error.parameter = label || 'key';
    throw error;
  }
  return value;
}

function validateValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (Buffer.byteLength(text, 'utf8') > MAX_VALUE_BYTES) {
    const error = new Error('Datastore value is too large');
    error.status = 413;
    throw error;
  }
  return text;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read a datastore file, returning '' for a missing file.
 *
 * A missing key is NOT an error: the client distinguishes "no value yet" from
 * "the server failed" by the HTTP status, so getds must answer 200 with an
 * empty body exactly like the PHP does.
 */
function readEntry(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Write atomically: write a temp file then rename over the target, so a crash
 * mid-write can never leave a half-written save. Matches datastore_write().
 */
function writeEntry(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, value);
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch (cleanupError) { /* ignore */ }
    throw error;
  }
}

/** Every JSON value in a directory, sorted by file name - datastore_json_values(). */
function readOrderedValues(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const values = [];
  for (const name of names.sort()) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (error) {
      continue;
    }
    // Match the PHP: only files whose contents parse as JSON (or the literal
    // "null") are returned, so a stray non-JSON file does not corrupt the list.
    try {
      JSON.parse(raw);
      values.push(raw);
    } catch (error) {
      if (raw.trim() === 'null') values.push(raw);
    }
  }
  return values;
}

/* ---------------------------------------------------------------------------
 * Standard datastore (items/)
 * ------------------------------------------------------------------------- */

function getValue(rawKey) {
  const key = validateKey(rawKey);
  return readEntry(path.join(ITEMS_DIR, key));
}

function setValue(rawKey, rawData) {
  const key = validateKey(rawKey);
  const value = validateValue(rawData);
  const filePath = path.join(ITEMS_DIR, key);
  writeEntry(filePath, value);
  return readEntry(filePath);
}

/* ---------------------------------------------------------------------------
 * Ordered datastore (ordereddatastore/<store>/)
 * ------------------------------------------------------------------------- */

function getOrderedValues(rawStore) {
  const store = validateKey(rawStore, 'dsname');
  return readOrderedValues(path.join(ORDERED_DIR, store));
}

function setOrderedValue(rawStore, rawKey, rawData) {
  const store = validateKey(rawStore, 'dsname');
  const key = validateKey(rawKey);
  const value = validateValue(rawData);
  const dir = path.join(ORDERED_DIR, store);
  writeEntry(path.join(dir, key), value);
  return readOrderedValues(dir);
}

module.exports = {
  DATASTORE_ROOT,
  MAX_KEY_LENGTH,
  MAX_VALUE_BYTES,
  validateKey,
  getValue,
  setValue,
  getOrderedValues,
  setOrderedValue,
};
