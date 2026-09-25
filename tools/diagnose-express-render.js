'use strict';

/**
 * Renders a view through EXPRESS (not ejs directly) to see whether the include
 * machinery is bound.
 *
 * ejs.renderFile only sets opts.filename (which is what binds `include`) when the
 * `data.settings` object is present. Express supplies it. This reproduces that
 * exact call for a known-good view and for the new one, so the difference shows.
 *
 * Usage: node tools/diagnose-express-render.js <view> [view2 ...]
 */

const path = require('path');
const express = require('express');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views'));

const views = process.argv.slice(2);
if (views.length === 0) views.push('catalog', 'download');

const locals = {
  title: 'diag',
  themeClass: '',
  themeOn: false,
  user: { userId: 1, username: 'diag', avatar: {} },
  currency: { robux: 0 },
  activeNav: 'diag',
  client: {
    installed: false, executablePath: null, installFolderName: 'Luckyblox',
    installerAvailable: false, downloadUrl: null, supported: true,
  },
  build: { available: false },
  processPlatform: 'win32',
  defaultPlaceId: 1818,
  games: [],
  items: [],
  categories: [],
  sorts: [],
  totalItems: 0,
  ownedCount: 0,
  selectedCategory: '',
  selectedSort: '',
  catalogItems: [],
  friendList: [],
  friends: [],
  profileUser: { userId: 1, username: 'diag', avatar: {} },
  stats: { places: 0, assets: 0, visits: 0 },
  studioReady: true,
  isOwner: false,
};

(async () => {
  for (const view of views) {
    await new Promise((resolve) => {
      app.render(view, locals, (err, html) => {
        if (err) {
          console.log(`${view.padEnd(12)} FAILED: ${err.message.split('\n')[0]}`);
        } else {
          console.log(`${view.padEnd(12)} ok (${html.length} bytes)`);
        }
        resolve();
      });
    });
  }
})();