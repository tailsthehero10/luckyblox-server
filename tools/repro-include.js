'use strict';

/**
 * Minimal reproduction of the /download include failure.
 *
 * A bare Express app, no LuckyBlox middleware at all, serving two views that are
 * byte-identical in structure. If one works and the other does not, the fault is
 * in the template; if both fail, the fault is in how this app renders views.
 *
 * Usage: node tools/repro-include.js
 */

const express = require('express');
const path = require('path');
const http = require('http');

const viewsDir = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');

const app = express();
app.set('view engine', 'ejs');
app.set('views', viewsDir);

const locals = {
  title: 't',
  themeClass: '',
  themeOn: false,
  user: { userId: 1, username: 'u', avatar: {} },
  currency: { robux: 0 },
  activeNav: 'download',
  client: {
    installed: false, executablePath: null, installFolderName: 'Luckyblox',
    installerAvailable: false, downloadUrl: null, supported: true,
  },
  build: { available: false },
  processPlatform: 'win32',
  defaultPlaceId: 1818,
};

// One route renders the real download view, another renders a known-good view.
app.get('/dl', (req, res) => res.render('download', locals));
app.get('/good', (req, res) => res.render('create', Object.assign({}, locals, {
  studioPort: 1, studioReady: true, studioHost: 'x',
})));

const server = app.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const targets = ['/good', '/dl'];
  let done = 0;

  for (const p of targets) {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const err = (body.match(/Error: ([^<]+)/) || [])[1];
        console.log(`${p.padEnd(8)} HTTP ${res.status} ${res.status === 200 ? `ok (${body.length} bytes)` : `-> ${err}`}`);
        if (++done === targets.length) { server.close(); process.exit(0); }
      });
    }).on('error', (e) => {
      console.log(`${p} request failed: ${e.message}`);
      if (++done === targets.length) { server.close(); process.exit(0); }
    });
  }
});