'use strict';
// Proves the proxy and bridge can never resolve to the same port.
const { execFileSync } = require('child_process');
const path = require('path');

const node = process.execPath;
const rc = path.join(__dirname, '..', 'server', 'runtimeConfig.js');

const scenarios = [
  { name: 'Render (PORT=3002) bridge child', env: { PORT: '3002', LUCKYBLOX_ROLE: 'bridge', LUCKYBLOX_BRIDGE_PORT: '3001' } },
  { name: 'Render (PORT=3002) proxy child', env: { PORT: '3002', LUCKYBLOX_ROLE: 'proxy', LUCKYBLOX_BRIDGE_PORT: '3001' } },
  { name: 'Render random PORT=10000 bridge', env: { PORT: '10000', LUCKYBLOX_ROLE: 'bridge', LUCKYBLOX_BRIDGE_PORT: '3001' } },
  { name: 'Render random PORT=10000 proxy', env: { PORT: '10000', LUCKYBLOX_ROLE: 'proxy', LUCKYBLOX_BRIDGE_PORT: '3001' } },
  { name: 'Local standalone (no PORT)', env: {} },
  { name: 'Local PORT=3002 standalone', env: { PORT: '3002' } },
  { name: 'Pathological: role=proxy, bridge==public', env: { PORT: '3001', LUCKYBLOX_ROLE: 'proxy', LUCKYBLOX_BRIDGE_PORT: '3001' } },
];

let failures = 0;

for (const s of scenarios) {
  const out = execFileSync(node, ['-e',
    `const r=require(${JSON.stringify(rc)});console.log(JSON.stringify({publicPort:r.publicPort,legacyPort:r.legacyPort,bridgePort:r.bridgePort}))`,
  ], { env: { ...process.env, ...s.env, PATH: process.env.PATH }, encoding: 'utf8' }).trim();

  const v = JSON.parse(out);
  const isBridgeProcess = s.env.LUCKYBLOX_ROLE === 'bridge';
  // In bridge mode the bridge owns its port; the proxy owns publicPort.
  // In proxy/standalone mode publicPort and bridgePort MUST differ.
  const collision = isBridgeProcess ? false : v.publicPort === v.bridgePort;
  const status = collision ? 'COLLISION!' : 'safe';
  if (collision) failures += 1;

  console.log(`  ${collision ? 'FAIL' : 'ok  '} ${s.name.padEnd(42)} public=${v.publicPort} legacy=${v.legacyPort} bridge=${v.bridgePort} -> ${status}`);
}

console.log(failures === 0 ? '\nAll port allocations collision-free.' : `\n${failures} COLLISION(S) DETECTED.`);
process.exitCode = failures === 0 ? 0 : 1;