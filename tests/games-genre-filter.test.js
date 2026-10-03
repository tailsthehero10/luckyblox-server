'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { makeTestDir } = require('./test-paths');

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

(async () => {
  const port = await availablePort();
  const dataDir = makeTestDir('luckyblox-games-genres');
  fs.writeFileSync(path.join(dataDir, 'games.json'), JSON.stringify({
    1818: {
      placeId: 1818, title: 'Adventure Test World', genre: 'Adventure',
      icon: '/gameplaceholder/card.png', playerCount: 3, likes: 2, dislikes: 0,
    },
    4040: {
      placeId: 4040, title: 'Puzzle Test World', genre: 'Puzzle',
      icon: '/gameplaceholder/card.png', playerCount: 1, likes: 1, dislikes: 0,
    },
  }));

  const child = spawn(process.execPath, ['Webserver/http-db-bridge/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), LUCKYBLOX_DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`bridge exited early:\n${errors.join('')}`);
      try {
        ready = (await get(port, '/health')).status === 200;
      } catch (error) {
        if (attempt === 79) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    assert.equal(ready, true, `bridge should start:\n${errors.join('')}`);

    const discover = await get(port, '/games');
    assert.equal(discover.status, 200);
    assert.match(discover.body, /href="\/games\?genre=Puzzle"/);
    const puzzleChip = discover.body.match(/<a[^>]+href="\/games\?genre=Puzzle"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(puzzleChip, 'Puzzle genre link should render');
    assert.match(puzzleChip[0], /Puzzle/, `genre label missing from chip: ${puzzleChip[0]}`);
    assert.match(puzzleChip[0], /games-filter-count">1<\/span>/, `Puzzle count should be one: ${puzzleChip[0]}`);
    assert.doesNotMatch(discover.body, /\[object Object\]/);

    const filtered = await get(port, '/games?genre=Puzzle');
    assert.equal(filtered.status, 200);
    assert.match(filtered.body, /Puzzle Test World/);
    assert.doesNotMatch(filtered.body, /Adventure Test World/);
    const selectedPuzzleChip = filtered.body.match(/<a\b[^>]*href="\/games\?genre=Puzzle"[^>]*>/);
    assert.ok(selectedPuzzleChip, 'selected Puzzle filter link should render');
    assert.match(selectedPuzzleChip[0], /is-active/, `Puzzle link should be active: ${selectedPuzzleChip[0]}`);
    assert.match(selectedPuzzleChip[0], /aria-current="page"/, `Puzzle link should be current: ${selectedPuzzleChip[0]}`);

    const caseInsensitive = await get(port, '/games?genre=pUzZlE');
    assert.match(caseInsensitive.body, /Puzzle Test World/);
    assert.doesNotMatch(caseInsensitive.body, /Adventure Test World/);

    console.log('ok: /games genre links resolve names, show counts, and filter experiences case-insensitively');
  } finally {
    child.kill();
    await once(child, 'exit').catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
