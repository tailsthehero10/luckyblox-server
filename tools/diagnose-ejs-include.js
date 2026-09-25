'use strict';

/**
 * Compares how `download.ejs` and a known-good view (`catalog.ejs`) compile and
 * run their includes, with IDENTICAL inputs.
 *
 * A per-page HTTP check showed /catalog working and /download failing with
 * "include is not a function", so the difference has to be in the template itself.
 * This isolates it by rendering both through EJS directly, with the same options,
 * and reporting exactly where each one dies.
 *
 * Usage: node tools/diagnose-ejs-include.js
 */

const path = require('path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'views');

// Enough locals that neither template dies on a missing variable, so any failure
// reported is about the INCLUDE, not the data.
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
  game: { title: 'g', description: 'd', developer: 'dev' },
  placeId: 1818,
  games: [],
  featuredGame: { placeId: 1818, title: 'f', developer: 'dev', icon: '', genre: 'g', playerCount: 0, favorites: 0, description: 'd' },
  friends: [],
  items: [],
  categories: [],
  sorts: [],
  totalItems: 0,
  ownedCount: 0,
  selectedCategory: '',
  selectedSort: '',
  catalogItems: [],
  servers: [],
  activeTab: 'about',
  creatorName: 'dev',
  gameIcon: '/x.png',
  gameThumb: '/y.png',
  playing: 0, visits: 0, likes: 0, dislikes: 0, likesPercent: 0, favorites: 0,
  maxPlayers: 20, genre: 'g', serverCount: 0, createdAt: '', updatedAt: '',
  abbreviateCount: (n) => String(n),
  formatGameDate: (d) => String(d || ''),
};

function diagnose(view) {
  const file = path.join(viewsDir, `${view}.ejs`);
  const out = { view, compile: null, render: null };

  let template;
  try {
    template = ejs.compile(require('fs').readFileSync(file, 'utf8'), {
      filename: file,
      views: [viewsDir],
    });
    out.compile = 'ok';
  } catch (error) {
    out.compile = `FAILED: ${error.message.split('\n')[0]}`;
    return out;
  }

  try {
    const html = template(locals);
    out.render = `ok (${html.length} bytes)`;
  } catch (error) {
    out.render = `FAILED: ${error.message.split('\n')[0]}`;
  }
  return out;
}

for (const view of ['catalog', 'create', 'develop', 'download']) {
  const r = diagnose(view);
  console.log(`${r.view.padEnd(12)} compile=${r.compile.padEnd(8)} render=${r.render}`);
}