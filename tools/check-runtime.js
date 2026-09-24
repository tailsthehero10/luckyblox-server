'use strict';
// Diagnostic: print the ports runtimeConfig resolves for each role.
// Usage: node tools/check-runtime.js [bridge|proxy]
const role = process.argv[2] || '';
if (role) process.env.LUCKYBLOX_ROLE = role;

const r = require('../server/runtimeConfig');
console.log(JSON.stringify({
  role: r.role || '(none)',
  publicPort: r.publicPort,
  bridgePort: r.bridgePort,
  legacyPort: r.legacyPort,
  bindHost: r.bindHost,
  bridgeHost: r.bridgeHost,
  publicBaseUrl: r.publicBaseUrl,
}, null, 2));