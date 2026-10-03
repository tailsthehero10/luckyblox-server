'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

const bridgeRequire = createRequire(path.join(__dirname, '..', '..', 'http-db-bridge', 'package.json'));
const lz4 = bridgeRequire('lz4js');

function decodeBlock(source, destination) {
  return lz4.decompressBlock(source, destination, 0, source.length, 0);
}

module.exports = { decodeBlock };
