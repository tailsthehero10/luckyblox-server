'use strict';
// Diagnostic: reproduce exactly what start.js hands the bridge child, and show
// which port the bridge would bind.
const path = require('path');

process.env.LUCKYBLOX_ROLE = 'bridge';
process.env.PORT = '3001';
process.env.LUCKYBLOX_BRIDGE_PORT = '3001';
process.env.HOST = process.env.HOST || '0.0.0.0';

// Re-read runtimeConfig fresh (it caches nothing, but be explicit).
delete require.cache[require.resolve(path.join(__dirname, '..', 'server', 'runtimeConfig'))];
const r = require(path.join(__dirname, '..', 'server', 'runtimeConfig'));

console.log(JSON.stringify({
  'process.env.PORT': process.env.PORT,
  'process.env.LUCKYBLOX_BRIDGE_PORT': process.env.LUCKYBLOX_BRIDGE_PORT,
  role: r.role,
  resolvedPublicPort: r.publicPort,
  resolvedBridgePort: r.bridgePort,
  bridgeWouldBind: r.publicPort,
  publicBaseUrl: r.publicBaseUrl,
}, null, 2));