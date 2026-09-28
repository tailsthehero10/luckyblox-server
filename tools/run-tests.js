/* Runs every tests/*.test.js sequentially, printing only failures. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
let failed = [];

for (const f of files) {
  const res = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const bad = /FAIL|AssertionError|Error:/.test(out) || res.status !== 0;
  if (bad) {
    failed.push(f);
    console.log('\n========== FAIL: ' + f + ' (exit ' + res.status + ') ==========');
    console.log(out.trim());
  } else {
    console.log('ok  ' + f);
  }
}
console.log('\n' + (files.length - failed.length) + '/' + files.length + ' passed');
if (failed.length) {
  console.log('FAILED: ' + failed.join(', '));
  process.exit(1);
}