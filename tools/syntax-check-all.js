'use strict';
// Syntax-checks every tool and test file, so a broken diagnostic script is
// visible instead of being discovered later when someone runs it.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dirs = ['tools', 'tests', 'server'];
let bad = [];

for (const dir of dirs) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full).filter((x) => x.endsWith('.js'))) {
    const p = path.join(full, f);
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${dir}/${f}: ${(r.stderr || '').split('\n')[0]}`);
  }
}
console.log(bad.length ? 'SYNTAX ERRORS:\n' + bad.join('\n') : 'all files parse');
process.exit(bad.length ? 1 : 0);