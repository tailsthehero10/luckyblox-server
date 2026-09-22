const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildPlaceCatalogFromMaps, normalizePlaceId: normalizePlaceIdInput, resolveRequestedPlace } = require('./gameMapResolver');
const { getRobloxProfileTemplateItems } = require('./robloxTemplateSource');
const { getStudioBuildInfo, getStudioUpdateManifest } = require('./studioBuildInfo');
const { installStudioApiRoutes } = require(path.join(__dirname, '..', '..', 'server', 'studioApi.js'));
const { installTeamCreateRoutes } = require(path.join(__dirname, '..', '..', 'server', 'teamCreate.js'));
const { allocatePlayerToServer, activeGameServers, removePlayerFromServer, removeServerByJobId, getServerForPlace, spawnDedicatedServer } = require(path.join(__dirname, '..', '..', 'server', 'orchestrator.js'));

const {
  bindHost,
  publicPort,
  publicBaseUrl,
  publicHostname,
  gamePort,
  gameServerHost,
} = require(path.join(__dirname, '..', '..', 'server', 'runtimeConfig'));

const app = express();

app.set('trust proxy', true);

// Inside the container the bridge listens on its own internal port, but when it
// is the only process (single-port cloud deployment) it takes process.env.PORT
// directly. Either way nothing here is hardcoded.
const PORT = publicPort;
const HOST = bindHost;
// Absolute URLs handed back to clients must point at the public deployment
// (the Render hostname in the cloud, localhost on the desktop).
const publicOrigin = publicBaseUrl || `http://${publicHostname}`;
const releaseRoot = path.resolve(__dirname, '..', '..');
const dataDir = path.join(__dirname, 'data');
const usersPath = path.join(dataDir, 'users.json');
const gamesPath = path.join(dataDir, 'games.json');
const assetsPath = path.join(dataDir, 'assets.json');
const uploadsRoot = path.join(releaseRoot, 'Uploads');
const mapsRoot = path.join(releaseRoot, 'Maps');
const secretKey = process.env.LUCKBLOX_SECRET || 'luckblox-local-dev-secret';
const activeTickets = new Map();
const activeSessions = new Map();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/legacy-nav.js', express.static(path.join(__dirname, 'public', 'legacy-nav.js')));
app.use('/ClientSettings', express.static(path.join(releaseRoot, 'Clients', '2022M', 'ClientSettings')));
app.use('/LuckBlox.site.tk', express.static(path.join(releaseRoot, 'Clients', '2022M')));
app.use(express.static(path.join(releaseRoot, 'Clients', '2022M')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/assets', express.static(path.join(releaseRoot, 'Assets')));
app.use('/maps', express.static(mapsRoot));

function parseCookieHeader(cookieHeader = '') {
  const cookieMap = {};
  const parts = String(cookieHeader || '').split(';');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    cookieMap[key] = decodeURIComponent(value);
  }

  return cookieMap;
}

function createSessionForUser(userId) {
  const user = getUser(userId);
  const sessionId = `lb_${crypto.randomBytes(20).toString('hex')}`;
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;

  activeSessions.set(sessionId, {
    sessionId,
    userId: String(user.userId || userId || 1),
    username: user.username || 'LocalPlayer',
    expiresAt,
    createdAt: Date.now(),
  });

  return { sessionId, expiresAt };
}

function resolveSessionUser(req) {
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  if (!sessionId) {
    return null;
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() > Number(session.expiresAt || 0)) {
    activeSessions.delete(sessionId);
    return null;
  }

  return getUser(session.userId || 1);
}

function applySessionCookie(res, userId) {
  const { sessionId, expiresAt } = createSessionForUser(userId);
  res.cookie('luckblox_session', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: Math.max(1, expiresAt - Date.now()),
    path: '/',
  });
  return sessionId;
}

app.use((req, res, next) => {
  const sessionUser = resolveSessionUser(req);
  if (sessionUser) {
    req.sessionUser = sessionUser;
    req.sessionUserId = String(sessionUser.userId || 1);
  } else {
    req.sessionUser = null;
    req.sessionUserId = null;
  }
  res.locals.basePath = req.headers['x-base-path'] || '';
  next();
});

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, hash, salt) {
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

function upgradePassword(user) {
  if (!user || !user.password || user.password.length < 64 || user.password.startsWith('$pbkdf2$')) return;
  const { hash, salt } = hashPassword(user.password);
  user.password = hash;
  user.passwordSalt = salt;
  user.passwordVersion = 2;
  const users = getUsers();
  users[user.userId || user.id] = user;
  writeJson(usersPath, users);
}

app.post('/luckblox-salt-setup', (req, res) => {
  const users = getUsers();
  let upgraded = 0;
  for (const id of Object.keys(users)) {
    const u = users[id];
    if (u.password && u.password.length < 64) {
      upgradePassword(u);
      upgraded++;
    }
  }
  res.json({ ok: true, upgraded, total: Object.keys(users).length });
});

function getUsers() {
  return readJson(usersPath, {});
}

function getUserByUsername(username) {
  const users = getUsers();
  return Object.values(users).find((u) => String(u.username || '').toLowerCase() === String(username || '').toLowerCase()) || null;
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

if (!fs.existsSync(mapsRoot)) {
  fs.mkdirSync(mapsRoot, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createDefaultAssets() {
  return {
    '1001': {
      id: 1001,
      name: 'Classic Red Shirt',
      assetType: 'Shirt',
      path: 'assets/1001.shirt',
      currentVersionId: 1001,
      className: 'Shirt',
      price: 0,
      createdAt: new Date().toISOString(),
    },
    '1002': {
      id: 1002,
      name: 'Classic Blue Pants',
      assetType: 'Pants',
      path: 'assets/1002.pants',
      currentVersionId: 1002,
      className: 'Pants',
      price: 0,
      createdAt: new Date().toISOString(),
    },
    '1003': {
      id: 1003,
      name: 'Robloxian Cap',
      assetType: 'Hat',
      path: 'assets/1003.hat',
      currentVersionId: 1003,
      className: 'Hat',
      price: 0,
      createdAt: new Date().toISOString(),
    },
    '1004': {
      id: 1004,
      name: 'Classic Backpack',
      assetType: 'BackAccessory',
      path: 'assets/1004.backpack',
      currentVersionId: 1004,
      className: 'BackAccessory',
      price: 0,
      createdAt: new Date().toISOString(),
    },
  };
}

function createDefaultUsers() {
  return {
    '1': {
      userId: '1',
      username: 'LocalPlayer',
      password: 'local',
      bio: 'Welcome to LuckyBlox. Build, play, and customize your avatar.',
      joinDate: '2024-01-15T00:00:00.000Z',
      membership: 'Premium',
      membershipStatus: 'Premium',
      robux: 1200,
      inventory: ['1001', '1002', '1003', '1004'],
      currentlyWearing: ['1001', '1002', '1003'],
      stats: {
        friends: 128,
        created: 42,
        plays: 743,
        followers: 96,
        badges: 14,
        gameVisits: 3200,
      },
      friends: [
        { userId: '2', username: 'tailsthehero10', status: 'online' },
        { userId: '3', username: 'Skylin', status: 'online' },
        { userId: '4', username: 'Noco', status: 'away' },
        { userId: '5', username: 'Rogue', status: 'offline' },
        { userId: '6', username: 'Astra', status: 'online' },
        { userId: '7', username: 'PixelMind', status: 'offline' },
        { userId: '8', username: 'NeonWave', status: 'online' },
      ],
      badges: [
        { id: 'b1', name: 'Welcome to Roblox', description: 'Joined LuckyBlox', icon: 'W', earnedDate: '2024-01-15T00:00:00.000Z' },
        { id: 'b2', name: 'First Build', description: 'Published your first place', icon: 'B', earnedDate: '2024-02-10T00:00:00.000Z' },
        { id: 'b3', name: 'Social Butterfly', description: 'Added 100 friends', icon: 'S', earnedDate: '2024-04-22T00:00:00.000Z' },
        { id: 'b4', name: 'Veteran', description: 'Played 1000+ games', icon: 'V', earnedDate: '2024-06-15T00:00:00.000Z' },
        { id: 'b5', name: 'Premium Member', description: 'Active Premium subscriber', icon: 'P', earnedDate: '2024-01-15T00:00:00.000Z' },
      ],
      avatar: {
        bodyColors: {
          headColorId: 1002,
          torsoColorId: 1002,
          rightArmColorId: 1002,
          leftArmColorId: 1002,
          rightLegColorId: 1002,
          leftLegColorId: 1002,
        },
      },
      updatedAt: new Date().toISOString(),
    },
    '2': {
      userId: '2',
      username: 'tailsthehero10',
      displayName: 'tailsthehero10',
      password: '67d91cbd7b3f716f5417a1ea3bcff3e9e89f11a5e3ef1def9482fd96d0ef116a52c24307f961a620c2c654cd984aaeadbc47ba1d17ab4aa831c709718c51a2d7',
      passwordSalt: '07825a4255a5d598b57ec7300ba022d6',
      passwordVersion: 2,
      bio: 'New LuckyBlox creator account.',
      joinDate: '2026-09-13T21:16:20.056Z',
      membership: 'Premium',
      membershipStatus: 'Premium',
      robux: 500,
      inventory: ['1001', '1002', '1003', '1004'],
      currentlyWearing: ['1001', '1002', '1003'],
      stats: {
        friends: 42,
        created: 1,
        plays: 0,
        followers: 0,
        badges: 3,
        gameVisits: 12,
      },
      friends: [
        { userId: '1', username: 'LocalPlayer', status: 'online' },
        { userId: '9', username: 'BuilderZ', status: 'online' },
        { userId: '10', username: 'StarDust', status: 'away' },
      ],
      badges: [
        { id: 'b1', name: 'Welcome to Roblox', description: 'Joined LuckyBlox', icon: 'W', earnedDate: '2026-09-13T21:16:20.056Z' },
        { id: 'b2', name: 'Newcomer', description: 'Created first place', icon: 'N', earnedDate: '2026-09-14T00:00:00.000Z' },
        { id: 'b3', name: 'Getting Started', description: 'Completed tutorial', icon: 'G', earnedDate: '2026-09-15T00:00:00.000Z' },
      ],
      avatar: {
        bodyColors: {
          headColorId: 1002,
          torsoColorId: 1002,
          rightArmColorId: 1002,
          leftArmColorId: 1002,
          rightLegColorId: 1002,
          leftLegColorId: 1002,
        },
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

function createDefaultGames() {
  const catalog = buildPlaceCatalogFromMaps();
  const games = {};

  if (!catalog || catalog.length === 0) {
    games['1818'] = {
      placeId: 1818,
      title: 'LuckyBlox Arena',
      description: 'A local Roblox-style competitive hub with quests, social features, and classic game discovery.',
      developer: 'LuckyBlox Studio',
      icon: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
      genre: 'Adventure',
      playerCount: 1281,
      likes: 9834,
      favorites: 4721,
      activeServers: [`${gameServerHost}:${gamePort}`],
      serverList: [`${gameServerHost}:${gamePort}`],
      votes: {
        likes: 84,
        dislikes: 16,
      },
      tags: ['Action', 'Adventure', 'Multiplayer'],
      updatedAt: new Date().toISOString(),
    };

    return games;
  }

  catalog.forEach((entry, index) => {
    const placeId = Number(entry.placeId || 1800 + index + 1);
    games[String(placeId)] = {
      placeId,
      title: entry.title || `Game ${placeId}`,
      description: 'A local map packaged as a playable LuckyBlox experience.',
      developer: 'LuckyBlox Studio',
      icon: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
      genre: 'Adventure',
      playerCount: 101 + index * 17,
      likes: 1000 + index * 71,
      favorites: 600 + index * 55,
      activeServers: [`${gameServerHost}:${gamePort}`],
      serverList: [`${gameServerHost}:${gamePort}`],
      votes: {
        likes: 78,
        dislikes: 22,
      },
      tags: ['Community', 'Playtest'],
      updatedAt: new Date().toISOString(),
      mapFile: entry.filename || null,
      mapPath: entry.path || null,
    };
  });

  return games;
}

function serializeUser(userId) {
  const user = getUser(userId);
  return {
    userId: Number(user.userId || userId || 1),
    username: user.username || 'LocalPlayer',
    displayName: user.username || 'LocalPlayer',
    bio: user.bio || '',
    joinDate: user.joinDate || new Date().toISOString(),
    membershipStatus: user.membershipStatus || user.membership || 'Premium',
    membership: user.membership || user.membershipStatus || 'Premium',
    robux: Number(user.robux) || 0,
    currency: getCurrencyForUser(user),
    avatar: user.avatar || {
      bodyColors: { headColorId: 1002, torsoColorId: 1002, rightArmColorId: 1002, leftArmColorId: 1002, rightLegColorId: 1002, leftLegColorId: 1002 },
    },
    stats: Object.assign({ friends: 0, created: 0, plays: 0, followers: 0, badges: 0, gameVisits: 0 }, user.stats || {}),
    friends: Array.isArray(user.friends) ? user.friends : [],
    badges: Array.isArray(user.badges) ? user.badges : [],
    inventory: Array.isArray(user.inventory) ? user.inventory : [],
    currentlyWearing: Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [],
    profileUrl: `/users/${user.userId || userId || 1}/profile`,
  };
}

/**
 * Normalise a user's wallet into a single currency object so the UI always has
 * real Robux / coin values, even for accounts created before this field existed.
 */
function getCurrencyForUser(user) {
  const robux = Number(user && user.robux) || 0;
  const wallets = (user && user.currencies) || {};
  return {
    robux,
    coins: Number(wallets.coins) || 0,
    tickets: Number(wallets.tickets) || Math.round(robux / 10),
    currencySymbol: 'R$',
  };
}

/**
 * Resolve a user's friends into full records (avatar initial, membership and a
 * live online/away/offline status) so the Friends panels show real data pulled
 * from users.json instead of a hardcoded sample list.
 */
function getFriendsForUser(userId) {
  const user = getUser(userId);
  const friends = Array.isArray(user.friends) ? user.friends : [];
  const statusPool = ['online', 'online', 'away', 'offline'];

  return friends.map((entry, index) => {
    const friendId = entry && entry.userId != null ? entry.userId : null;
    const friendRecord = friendId != null ? getUser(friendId) : null;
    const name = (entry && entry.username) || (friendRecord && friendRecord.username) || 'Friend';
    const status = (entry && entry.status) || statusPool[index % statusPool.length];

    return {
      userId: Number(friendId || index + 1),
      username: name,
      displayName: (friendRecord && friendRecord.username) || name,
      status,
      online: status === 'online',
      membership: (friendRecord && (friendRecord.membershipStatus || friendRecord.membership)) || 'None',
      profileUrl: `/users/${Number(friendId || index + 1)}/profile`,
    };
  });
}

function serializeGame(placeId) {
  const normalized = normalizePlaceId(placeId);
  const game = getGameEntry(normalized);
  return {
    placeId: Number(game.placeId || normalized || 1818),
    title: game.title || 'LuckyBlox Arena',
    description: game.description || 'Local LuckyBlox demo game',
    developer: game.developer || 'LuckyBlox Studio',
    genre: game.genre || 'Adventure',
    icon: game.icon || 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
    playerCount: Number(game.playerCount || 0),
    likes: Number(game.likes || 0),
    favorites: Number(game.favorites || 0),
    activeServers: Array.isArray(game.activeServers) ? game.activeServers : [`${gameServerHost}:${gamePort}`],
    serverList: Array.isArray(game.serverList) ? game.serverList : [`${gameServerHost}:${gamePort}`],
    votes: game.votes || { likes: 0, dislikes: 0 },
    tags: Array.isArray(game.tags) ? game.tags : ['Local'],
    updatedAt: game.updatedAt || new Date().toISOString(),
    aboutUrl: `/game/${Number(game.placeId || normalized || 1818)}`,
    playUrl: `/play?placeId=${Number(game.placeId || normalized || 1818)}`,
  };
}

function ensureSeedData() {
  if (!fs.existsSync(usersPath)) {
    writeJson(usersPath, createDefaultUsers());
  }

  if (!fs.existsSync(assetsPath)) {
    writeJson(assetsPath, createDefaultAssets());
  }

  if (!fs.existsSync(gamesPath)) {
    writeJson(gamesPath, createDefaultGames());
  } else {
    const current = readJson(gamesPath, {});
    if (current && typeof current === 'object' && Object.keys(current).length === 1 && current['1818']) {
      writeJson(gamesPath, createDefaultGames());
    }
  }
}

function getUsers() {
  const users = readJson(usersPath, createDefaultUsers());
  return users && typeof users === 'object' ? users : createDefaultUsers();
}

function getGames() {
  const catalog = buildPlaceCatalogFromMaps();
  const seeded = createDefaultGames();
  const persisted = readJson(gamesPath, {});

  const merged = { ...seeded, ...(persisted && typeof persisted === 'object' ? persisted : {}) };

  if (catalog && catalog.length > 0) {
    catalog.forEach((entry, index) => {
      const placeId = Number(entry.placeId || 1800 + index + 1);
      merged[String(placeId)] = {
        ...(merged[String(placeId)] || {}),
        placeId,
        title: entry.title || `Game ${placeId}`,
        description: merged[String(placeId)]?.description || 'A local map packaged as a playable LuckyBlox experience.',
        developer: merged[String(placeId)]?.developer || 'LuckyBlox Studio',
        icon: merged[String(placeId)]?.icon || 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
        genre: merged[String(placeId)]?.genre || 'Adventure',
        playerCount: Number(merged[String(placeId)]?.playerCount || 0),
        likes: Number(merged[String(placeId)]?.likes || 0),
        favorites: Number(merged[String(placeId)]?.favorites || 0),
        activeServers: Array.isArray(merged[String(placeId)]?.activeServers) ? merged[String(placeId)].activeServers : [`${gameServerHost}:${gamePort}`],
        serverList: Array.isArray(merged[String(placeId)]?.serverList) ? merged[String(placeId)].serverList : [`${gameServerHost}:${gamePort}`],
        votes: merged[String(placeId)]?.votes || { likes: 78, dislikes: 22 },
        tags: Array.isArray(merged[String(placeId)]?.tags) ? merged[String(placeId)].tags : ['Community', 'Playtest'],
        updatedAt: merged[String(placeId)]?.updatedAt || new Date().toISOString(),
        mapFile: entry.filename || null,
        mapPath: entry.path || null,
      };
    });
  }

  return merged && typeof merged === 'object' ? merged : createDefaultGames();
}

function getAssets() {
  const assets = readJson(assetsPath, createDefaultAssets());
  return assets && typeof assets === 'object' ? assets : createDefaultAssets();
}

function getUser(userId = 1) {
  const users = getUsers();
  const keyedUser = users[String(userId)] || users['1'];

  if (!keyedUser) {
    return {
      userId: String(userId),
      username: 'LocalPlayer',
      password: 'local',
      bio: 'Welcome to LuckyBlox.',
      joinDate: new Date().toISOString(),
      membershipStatus: 'None',
      membership: 'None',
      robux: 0,
      inventory: [],
      currentlyWearing: [],
      stats: { friends: 0, created: 0, plays: 0, followers: 0, badges: 0, gameVisits: 0 },
      friends: [],
      badges: [],
      avatar: { bodyColors: { headColorId: 1002, torsoColorId: 1002, rightArmColorId: 1002, leftArmColorId: 1002, rightLegColorId: 1002, leftLegColorId: 1002 } },
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    ...keyedUser,
    userId: String(keyedUser.userId || userId),
    membership: keyedUser.membershipStatus || keyedUser.membership || 'Premium',
    membershipStatus: keyedUser.membershipStatus || keyedUser.membership || 'Premium',
    robux: Number(keyedUser.robux) || 0,
    inventory: Array.isArray(keyedUser.inventory) ? keyedUser.inventory : [],
    currentlyWearing: Array.isArray(keyedUser.currentlyWearing) ? keyedUser.currentlyWearing : [],
    stats: Object.assign({ friends: 0, created: 0, plays: 0, followers: 0, badges: 0, gameVisits: 0 }, keyedUser.stats || {}),
    friends: Array.isArray(keyedUser.friends) ? keyedUser.friends : [],
    badges: Array.isArray(keyedUser.badges) ? keyedUser.badges : [],
    avatar: keyedUser.avatar || { bodyColors: { headColorId: 1002, torsoColorId: 1002, rightArmColorId: 1002, leftArmColorId: 1002, rightLegColorId: 1002, leftLegColorId: 1002 } },
  };
}

function getUserByUsername(username = '') {
  const target = String(username || '').trim().toLowerCase();
  if (!target) {
    return null;
  }

  const users = getUsers();
  const found = Object.values(users).find((user) => {
    if (!user || typeof user !== 'object') {
      return false;
    }

    const usernameValue = String(user.username || user.displayName || '').trim().toLowerCase();
    return usernameValue === target;
  });

  if (!found) {
    return null;
  }

  return getUser(found.userId || found.id || 1);
}

function getPublishedPlaces() {
  const placesFilePath = path.join(dataDir, 'places.json');
  const records = readJson(placesFilePath, {});
  const list = Object.values(records || {}).filter((entry) => entry && typeof entry === 'object');

  const profileTemplates = getRobloxProfileTemplateItems().map((entry) => ({
    placeId: Number(entry.placeId),
    universeId: Number(entry.placeId),
    name: entry.title || 'Roblox Template',
    description: 'Public Roblox template from the creator profile, used as an uncopylocked base experience.',
    author: 'Roblox',
    authorId: 998796,
    fileName: `${entry.title || 'Template'}.rbxlx`,
    source: 'https://www.roblox.com/users/998796/profile#!#creations',
    publishedAt: new Date().toISOString(),
    coverUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
  }));

  return [...list, ...profileTemplates]
    .map((entry) => ({
      placeId: Number(entry.placeId || entry.universeId || 1818),
      universeId: Number(entry.universeId || entry.placeId || 1818),
      name: entry.name || 'LuckyBlox Place',
      description: entry.description || 'Public LuckyBlox experience',
      author: entry.author || 'LuckyBlox Studio',
      authorId: Number(entry.authorId || 1),
      fileName: entry.fileName || `${entry.name || 'Place'}.rbxlx`,
      source: entry.source || '',
      publishedAt: entry.publishedAt || entry.updatedAt || new Date().toISOString(),
      coverUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
    }))
    .filter((entry, index, arr) => arr.findIndex((candidate) => Number(candidate.placeId) === Number(entry.placeId)) === index)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function getPublicGamesForUser(userId) {
  const currentUser = getUser(userId);
  const userGames = getPublishedPlaces().filter((entry) => {
    const matchesAuthor = String(entry.authorId) === String(userId);
    const matchesUsername = String(entry.author).toLowerCase() === String(currentUser.username || '').toLowerCase();
    const isDefaultUser = String(userId) === '1' && (entry.author === 'LuckyBlox Studio' || entry.author === 'LocalPlayer');
    return matchesAuthor || matchesUsername || isDefaultUser;
  });

  return userGames.slice(0, 8);
}

function getPlaceSettings(placeId) {
  const normalized = normalizePlaceId(placeId);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  const record = places[String(normalized)] || {
    placeId: normalized,
    universeId: normalized,
    name: getGameEntry(normalized).title || 'LuckyBlox Place',
    description: getGameEntry(normalized).description || 'Local Studio place',
    author: 'LocalPlayer',
    authorId: 1,
    maxPlayers: 20,
    allowHttpRequests: true,
    visibility: 'Public',
    genre: 'Adventure',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    placeId: Number(record.placeId || normalized),
    universeId: Number(record.universeId || record.placeId || normalized),
    name: record.name || 'LuckyBlox Place',
    description: record.description || 'Local Studio place',
    author: record.author || 'LocalPlayer',
    authorId: Number(record.authorId || 1),
    visibility: String(record.visibility || 'Public'),
    genre: String(record.genre || 'Adventure'),
    maxPlayers: Number(record.maxPlayers || 20),
    allowHttpRequests: record.allowHttpRequests !== false,
    privateServerAllowed: Boolean(record.privateServerAllowed !== false),
    allowThirdPartySales: Boolean(record.allowThirdPartySales !== false),
    createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function savePlaceSettings(placeId, updates) {
  const normalized = normalizePlaceId(placeId);
  const placesFilePath = path.join(dataDir, 'places.json');
  const places = readJson(placesFilePath, {});
  const current = places[String(normalized)] || {};
  const next = {
    ...current,
    ...updates,
    placeId: normalized,
    universeId: normalized,
    name: String(updates.name || current.name || 'LuckyBlox Place'),
    description: String(updates.description || current.description || 'Local Studio place'),
    author: updates.author || current.author || 'LocalPlayer',
    authorId: Number(updates.authorId || current.authorId || 1),
    maxPlayers: Number(updates.maxPlayers || current.maxPlayers || 20),
    visibility: String(updates.visibility || current.visibility || 'Public'),
    genre: String(updates.genre || current.genre || 'Adventure'),
    allowHttpRequests: updates.allowHttpRequests !== false,
    privateServerAllowed: updates.privateServerAllowed !== false,
    allowThirdPartySales: updates.allowThirdPartySales !== false,
    updatedAt: new Date().toISOString(),
  };

  places[String(normalized)] = next;
  writeJson(placesFilePath, places);
  return getPlaceSettings(normalized);
}

function saveUser(userId, nextState) {
  const users = getUsers();
  const current = getUser(userId);
  const merged = {
    ...current,
    ...nextState,
    userId: String(userId),
    updatedAt: new Date().toISOString(),
    membershipStatus: nextState.membershipStatus || current.membershipStatus || 'Premium',
    inventory: Array.isArray(nextState.inventory) ? nextState.inventory : current.inventory,
    currentlyWearing: Array.isArray(nextState.currentlyWearing) ? nextState.currentlyWearing : current.currentlyWearing,
  };

  users[String(userId)] = merged;
  writeJson(usersPath, users);
  return merged;
}

function buildAvatarPayload(userId, placeId = 1818) {
  const user = getUser(userId);
  const assets = getAssets();
  const wearingIds = new Set((user.currentlyWearing || []).map((id) => String(id)));

  const avatarAssets = Object.values(assets)
    .filter((asset) => wearingIds.has(String(asset.id)))
    .map((asset) => ({
      id: Number(asset.id),
      name: asset.name,
      assetType: {
        id: 1,
        name: asset.assetType,
      },
      currentVersionId: Number(asset.currentVersionId || asset.id),
      meta: {
        order: 1,
        version: 1,
      },
    }));

  if (avatarAssets.length === 0) {
    avatarAssets.push({
      id: 1001,
      name: 'Classic Red Shirt',
      assetType: { id: 1, name: 'Shirt' },
      currentVersionId: 1001,
      meta: { order: 1, version: 1 },
    });
  }

  const assetParams = avatarAssets
    .map((asset) => `assetId=${asset.id}&assetType=${encodeURIComponent(asset.assetType.name || 'Accessory')}`)
    .join('&');

  return {
    ok: true,
    userId: Number(user.userId),
    placeId: Number(placeId),
    scales: {
      height: 1.0,
      width: 1.0,
      head: 1.0,
      depth: 1.0,
      proportion: 0.0,
      bodyType: 0.0,
    },
    playerAvatarType: 'R6',
    bodyColors: user.avatar && user.avatar.bodyColors ? user.avatar.bodyColors : {
      headColorId: 1002,
      torsoColorId: 1002,
      rightArmColorId: 1002,
      leftArmColorId: 1002,
      rightLegColorId: 1002,
      leftLegColorId: 1002,
    },
    assets: avatarAssets,
    wearing: user.currentlyWearing || [],
    assetParams,
    defaultShirtApplied: false,
    defaultPantsApplied: false,
    emotes: [
      { assetId: 3360689775, assetName: 'Salute', position: 1 },
      { assetId: 3576968026, assetName: 'Shrug', position: 2 },
    ],
  };
}

function createAuthTicket(userId, placeId, serverContext = {}) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 60 * 1000;
  const nonce = crypto.randomBytes(16).toString('hex');

  const claim = {
    nonce,
    userId: String(userId),
    placeId: String(placeId),
    port: Number(serverContext.port || gamePort),
    serverJobId: String(serverContext.serverJobId || 'local-job'),
    issuedAt,
    expiresAt,
    version: 1,
  };

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(claim))
    .digest('hex');

  const ticket = `LB_${nonce}.${signature}`;

  activeTickets.set(ticket, {
    ticket,
    userId: String(userId),
    placeId: Number(placeId),
    port: Number(serverContext.port || gamePort),
    serverJobId: String(serverContext.serverJobId || 'local-job'),
    issuedAt,
    expiresAt,
    createdAt: new Date(issuedAt).toISOString(),
    expiresAtIso: new Date(expiresAt).toISOString(),
  });

  return {
    ticket,
    authTicket: ticket,
    expiresAt,
    claim,
    port: Number(serverContext.port || gamePort),
    serverJobId: String(serverContext.serverJobId || 'local-job'),
    launchURI: `luckyblox-player:1+launchmode:play+gameinfo:${ticket}+placeId:${placeId}+serverPort:${Number(serverContext.port || gamePort)}+jobId:${String(serverContext.serverJobId || 'local-job')}`,
  };
}

function getGameEntry(placeId) {
  const games = getGames();
  const normalizedPlaceId = normalizePlaceIdInput(placeId);
  const catalogEntry = resolveRequestedPlace(normalizedPlaceId, buildPlaceCatalogFromMaps());
  const key = String(catalogEntry.placeId || normalizedPlaceId || 1818);
  const fallback = games[key] || games['1818'] || Object.values(games)[0] || {
    placeId: Number(catalogEntry.placeId || normalizedPlaceId || 1818),
    title: catalogEntry.title || 'LuckyBlox Arena',
    description: 'Local LuckyBlox game',
    developer: 'LuckyBlox Studio',
    icon: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80',
    genre: 'Adventure',
    playerCount: 0,
    likes: 0,
    favorites: 0,
    activeServers: [`${gameServerHost}:${gamePort}`],
    serverList: [`${gameServerHost}:${gamePort}`],
    votes: { likes: 80, dislikes: 20 },
    tags: ['Playtest'],
    mapFile: catalogEntry.filename || null,
    mapPath: catalogEntry.path || null,
  };

  return games[key] || fallback;
}

function normalizePlaceId(rawPlaceId) {
  return normalizePlaceIdInput(rawPlaceId);
}

function getTicketStatus(ticket) {
  return activeTickets.get(ticket) || null;
}

function resolveRobloxPlayerBinary() {
  const clientPath = path.join(releaseRoot, 'Clients', '2021M', 'RobloxPlayerBeta.exe');
  return fs.existsSync(clientPath) ? clientPath : null;
}

function launchLocalRobloxClient({ userId, placeId, port, serverJobId, ticket }) {
  const executablePath = resolveRobloxPlayerBinary();
  if (!executablePath) {
    return {
      ok: false,
      error: 'roblox-client-not-found',
      details: 'No RobloxPlayerBeta.exe was found under the local Clients folder.',
    };
  }

  const authUrl = `${publicOrigin}/v1/authentication-tickets?userId=${userId}&placeId=${placeId}`;
  const joinUrl = `${publicOrigin}/game/join?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket)}&serverPort=${port}&jobId=${encodeURIComponent(serverJobId)}`;

  try {
    const child = spawn(executablePath, ['-a', authUrl, '-t', String(ticket), '-j', joinUrl], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });

    return {
      ok: true,
      started: true,
      pid: child.pid,
      exePath: executablePath,
      authUrl,
      joinUrl,
      launchURI: `luckyblox-player:1+launchmode:play+gameinfo:${ticket}+placeId:${placeId}+serverPort:${port}+jobId:${serverJobId}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'roblox-client-launch-failed',
      details: error && error.message ? error.message : String(error),
    };
  }
}

function writeUploadedPackage(fileName, buffer, assetKind = 'rbxl') {
  const safeName = String(fileName || `upload-${Date.now()}.${assetKind}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const filePath = path.join(mapsRoot, safeName);
  fs.writeFileSync(filePath, buffer);

  const metadataPath = path.join(dataDir, 'published-assets.json');
  const current = readJson(metadataPath, { items: [] });
  current.items = Array.isArray(current.items) ? current.items : [];
  current.items.push({
    id: `asset-${Date.now()}`,
    fileName: safeName,
    kind: assetKind,
    path: filePath,
    createdAt: new Date().toISOString(),
  });
  writeJson(metadataPath, current);

  return { fileName: safeName, filePath };
}

ensureSeedData();
installStudioApiRoutes(app);
installTeamCreateRoutes(app);

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online', port: PORT, releaseRoot, timestamp: new Date().toISOString() });
});

app.get('/api/studio/build-info', (req, res) => {
  res.json({ ok: true, ...getStudioBuildInfo() });
});

app.get('/api/studio/update-manifest', (req, res) => {
  res.json(getStudioUpdateManifest());
});

app.get('/api/studio/config', (req, res) => {
  res.json({ ok: true, ...getStudioBuildInfo(), manifest: getStudioUpdateManifest() });
});

app.get('/', (req, res) => {
  const user = getUser(req.query.userId || 1);
  const games = Object.values(getGames());
  const featuredGame = games[0] || getGameEntry(1818);
  const friends = getFriendsForUser(user.userId || 1);

  res.render('home', {
    title: 'LuckyBlox',
    user,
    games,
    featuredGame,
    friends,
    currency: getCurrencyForUser(user),
    activePlaceId: featuredGame.placeId,
  });
});

app.get('/home', (req, res) => {
  res.redirect('/');
});

app.get('/games', (req, res) => {
  const user = getUser(req.query.userId || 1);
  const games = Object.values(getGames());
  const featuredGame = games[0] || getGameEntry(1818);

  res.render('home', {
    title: 'LuckyBlox Games',
    user,
    games,
    featuredGame,
    friends: getFriendsForUser(user.userId || 1),
    currency: getCurrencyForUser(user),
    activePlaceId: req.query.placeId ? Number(req.query.placeId) : featuredGame.placeId,
  });
});

app.get('/signin', (req, res) => {
  const errorMessage = req.query.error || '';
  const hintMessage = req.query.hint || '';
  const redirect = req.query.redirect || '';
  if (req.sessionUser) {
    const dest = redirect || '/dev';
    return res.redirect(dest);
  }
  res.render('signin', {
    title: 'Sign in - LuckyBlox',
    errorMessage,
    hintMessage,
    redirect,
    username: req.query.username || '',
  });
});

app.get('/login', (req, res) => {
  if (req.sessionUser) {
    return res.redirect('/dev');
  }
  return res.redirect('/signin');
});

app.get('/signup', (req, res) => {
  const errorMessage = req.query.error || '';
  const username = req.query.username || '';
  const redirect = req.query.redirect || '';
  if (req.sessionUser) {
    return res.redirect(redirect || '/dev');
  }
  res.render('signup', {
    title: 'Create account - LuckyBlox',
    errorMessage,
    username,
    redirect,
  });
});

app.get('/logout', (req, res) => {
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  res.clearCookie('luckblox_session');
  const redirect = req.query.redirect || '/signin';
  res.redirect(redirect);
});

app.post('/logout', (req, res) => {
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  res.clearCookie('luckblox_session');
  res.redirect(req.query.redirect || '/signin');
});

app.post('/signup', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const confirmPassword = String(req.body.confirmPassword || '').trim();
  const displayName = String(req.body.displayName || username || '').trim();

  if (!username || username.length < 3) {
    return res.status(400).render('signup', {
      title: 'Create account - LuckyBlox',
      errorMessage: 'Username must be at least 3 characters.',
      username,
      basePath: res.locals.basePath || '',
    });
  }

  if (!password || password.length < 4) {
    return res.status(400).render('signup', {
      title: 'Create account - LuckyBlox',
      errorMessage: 'Password must be at least 4 characters.',
      username,
      basePath: res.locals.basePath || '',
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('signup', {
      title: 'Create account - LuckyBlox',
      errorMessage: 'Passwords do not match.',
      username,
      basePath: res.locals.basePath || '',
    });
  }

  const users = getUsers();
  const exists = Object.values(users).some((user) => String(user.username || user.displayName || '').toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(409).render('signup', {
      title: 'Create account - LuckyBlox',
      errorMessage: 'That username is already taken.',
      username,
      basePath: res.locals.basePath || '',
    });
  }

  const nextId = Math.max(1, ...Object.values(users).map((user) => Number(user.userId || user.id || 1))) + 1;
  const { hash, salt } = hashPassword(password);
  const created = {
    userId: String(nextId),
    username,
    displayName: displayName || username,
    password: hash,
    passwordSalt: salt,
    passwordVersion: 2,
    bio: 'New LuckyBlox creator account.',
    joinDate: new Date().toISOString(),
    membershipStatus: 'Premium',
    inventory: ['1001', '1002', '1003', '1004'],
    currentlyWearing: ['1001', '1002', '1003'],
    stats: { friends: 0, created: 1, plays: 0, followers: 0 },
    avatar: {
      bodyColors: {
        headColorId: 1002,
        torsoColorId: 1002,
        rightArmColorId: 1002,
        leftArmColorId: 1002,
        rightLegColorId: 1002,
        leftLegColorId: 1002,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  users[String(nextId)] = created;
  writeJson(usersPath, users);
  applySessionCookie(res, nextId);
  const redirect = req.body.redirect || req.query.redirect || '/dev';
  const bp = res.locals.basePath || '';
  return res.redirect(`${bp}${redirect}?welcome=1`);
});

app.post('/luckblox.site.tk/signup', (req, res) => {
  req.body;
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const confirmPassword = String(req.body.confirmPassword || '').trim();
  const displayName = String(req.body.displayName || username || '').trim();

  if (!username || username.length < 3) {
    return res.status(400).json({ ok: false, error: 'username-too-short', message: 'Username must be at least 3 characters.' });
  }

  if (!password || password.length < 4) {
    return res.status(400).json({ ok: false, error: 'password-too-short', message: 'Password must be at least 4 characters.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ ok: false, error: 'passwords-dont-match', message: 'Passwords do not match.' });
  }

  const users = getUsers();
  const exists = Object.values(users).some((user) => String(user.username || user.displayName || '').toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(409).json({ ok: false, error: 'username-taken', message: 'That username is already taken.' });
  }

  const nextId = Math.max(1, ...Object.values(users).map((user) => Number(user.userId || user.id || 1))) + 1;
  const { hash, salt } = hashPassword(password);
  const created = {
    userId: String(nextId),
    username,
    displayName: displayName || username,
    password: hash,
    passwordSalt: salt,
    passwordVersion: 2,
    bio: 'New LuckyBlox creator account.',
    joinDate: new Date().toISOString(),
    membershipStatus: 'Premium',
    inventory: ['1001', '1002', '1003', '1004'],
    currentlyWearing: ['1001', '1002', '1003'],
    stats: { friends: 0, created: 1, plays: 0, followers: 0 },
    avatar: {
      bodyColors: {
        headColorId: 1002, torsoColorId: 1002, rightArmColorId: 1002, leftArmColorId: 1002, rightLegColorId: 1002, leftLegColorId: 1002,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  users[String(nextId)] = created;
  writeJson(usersPath, users);
  applySessionCookie(res, nextId);
  return res.json({ ok: true, userId: String(nextId), username, displayName: created.displayName });
});

app.post('/signin', (req, res) => {
  const username = String(req.body.username || req.body.userName || '').trim();
  const password = String(req.body.password || '').trim();
  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).render('signin', {
      title: 'Sign in - LuckyBlox',
      errorMessage: 'We could not find that account. Try creating one first.',
      redirect: '',
      username,
      hintMessage: '',
      basePath: res.locals.basePath || '',
    });
  }

  if (user.passwordVersion === 2 && user.password && user.passwordSalt) {
    if (!verifyPassword(password, user.password, user.passwordSalt)) {
      return res.status(401).render('signin', {
        title: 'Sign in - LuckyBlox',
        errorMessage: 'That password is incorrect.',
        redirect: '',
        username,
        hintMessage: '',
        basePath: res.locals.basePath || '',
      });
    }
  } else if (user.password && user.password !== password) {
    return res.status(401).render('signin', {
      title: 'Sign in - LuckyBlox',
      errorMessage: 'That password is incorrect.',
      redirect: '',
      username,
      hintMessage: '',
      basePath: res.locals.basePath || '',
    });
  }

  if (user.passwordVersion !== 2) {
    upgradePassword(user);
  }

  applySessionCookie(res, user.userId || user.id || 1);
  const redirect = req.body.redirect || req.query.redirect || '/dev';
  const bp = res.locals.basePath || '';
  return res.redirect(`${bp}${redirect}?signedin=1`);
});

app.post('/luckblox.site.tk/login', (req, res) => {
  const username = String(req.body.username || req.body.userName || '').trim();
  const password = String(req.body.password || '').trim();
  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ ok: false, error: 'user-not-found', message: 'We could not find that account.' });
  }

  if (user.passwordVersion === 2 && user.password && user.passwordSalt) {
    if (!verifyPassword(password, user.password, user.passwordSalt)) {
      return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
    }
  } else if (user.password && user.password !== password) {
    return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
  }

  if (user.passwordVersion !== 2) {
    upgradePassword(user);
  }

  applySessionCookie(res, user.userId || user.id || 1);
  return res.json({ ok: true, userId: user.userId || user.id, username: user.username, displayName: user.displayName });
});

app.post('/luckblox.site.tk/signin', (req, res) => {
  const username = String(req.body.username || req.body.userName || '').trim();
  const password = String(req.body.password || '').trim();
  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ ok: false, error: 'user-not-found', message: 'We could not find that account.' });
  }

  if (user.passwordVersion === 2 && user.password && user.passwordSalt) {
    if (!verifyPassword(password, user.password, user.passwordSalt)) {
      return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
    }
  } else if (user.password && user.password !== password) {
    return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
  }

  if (user.passwordVersion !== 2) {
    upgradePassword(user);
  }

  applySessionCookie(res, user.userId || user.id || 1);
  const bp = res.locals.basePath || '';
  const redirect = req.body.redirect || req.query.redirect || '/dev';
  return res.json({ ok: true, redirect: `${bp}${redirect}?signedin=1`, userId: user.userId || user.id });
});

app.get('/luckblox.site.tk/signin', (req, res) => {
  const errorMessage = req.query.error || '';
  const hintMessage = req.query.hint || '';
  const redirect = req.query.redirect || '';
  if (req.sessionUser) {
    const bp = res.locals.basePath || '';
    const dest = redirect || '/dev';
    return res.redirect(`${bp}${dest}`);
  }
  res.render('signin', {
    title: 'Sign in - LuckyBlox',
    errorMessage,
    hintMessage,
    redirect,
    username: req.query.username || '',
    basePath: res.locals.basePath || '',
  });
});

app.get('/luckblox.site.tk/login', (req, res) => {
  const bp = res.locals.basePath || '';
  if (req.sessionUser) {
    return res.redirect(`${bp}/dev`);
  }
  return res.redirect(`${bp}/luckblox.site.tk/signin`);
});

app.get('/luckblox.site.tk/signup', (req, res) => {
  const errorMessage = req.query.error || '';
  const username = req.query.username || '';
  const redirect = req.query.redirect || '';
  if (req.sessionUser) {
    const bp = res.locals.basePath || '';
    return res.redirect(`${bp}${redirect || '/dev'}`);
  }
  res.render('signup', {
    title: 'Create account - LuckyBlox',
    errorMessage,
    username,
    redirect,
    basePath: res.locals.basePath || '',
  });
});

app.get('/luckblox.site.tk/logout', (req, res) => {
  const bp = res.locals.basePath || '';
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  res.clearCookie('luckblox_session');
  const redirect = req.query.redirect || `${bp}/luckblox.site.tk/signin`;
  res.redirect(redirect);
});

app.post('/luckblox.site.tk/logout', (req, res) => {
  const bp = res.locals.basePath || '';
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  res.clearCookie('luckblox_session');
  const redirect = req.query.redirect || `${bp}/luckblox.site.tk/signin`;
  res.redirect(redirect);
});

app.get('/profile', (req, res) => {
  const userId = req.query.userId || 1;
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const publishedGames = getPublicGamesForUser(userId);

  res.render('profile', {
    title: `${user.username} Profile`,
    user,
    assets,
    publishedGames,
    friends: getFriendsForUser(userId),
    currency: getCurrencyForUser(user),
  });
});

app.get('/profile/:userId', (req, res) => {
  const userId = req.params.userId || 1;
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const publishedGames = getPublicGamesForUser(userId);

  res.render('profile', {
    title: `${user.username} Profile`,
    user,
    assets,
    publishedGames,
    friends: getFriendsForUser(userId),
    currency: getCurrencyForUser(user),
  });
});

app.get('/users/:id/profile', (req, res) => {
  const userId = req.params.id || 1;
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const publishedGames = getPublicGamesForUser(userId);

  res.render('profile', {
    title: `${user.username} Profile`,
    user,
    assets,
    publishedGames,
    friends: getFriendsForUser(userId),
    currency: getCurrencyForUser(user),
  });
});

app.get('/account', (req, res) => {
  const user = getUser(req.query.userId || 1);
  const assets = Object.values(getAssets());

  res.render('account', {
    title: `${user.username} Account`,
    user,
    assets,
  });
});

app.get('/friends', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || 1);
  const user = getUser(userId);
  const friends = Array.isArray(user.friends) ? user.friends : [];
  const friendUsers = friends.map((f) => getUser(f.userId)).filter(Boolean);

  res.render('friends', {
    title: 'Friends',
    user,
    friends: friendUsers,
    friendStatuses: friends,
  });
});

app.get('/badges', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || 1);
  const user = getUser(userId);
  const badges = Array.isArray(user.badges) ? user.badges : [];

  res.render('badges', {
    title: 'Badges',
    user,
    badges,
  });
});

app.get('/studio', (req, res) => {
  const user = getUser(req.query.userId || 1);
  const places = Object.values(getGames()).map((game) => ({
    placeId: Number(game.placeId || 1818),
    name: game.title || 'LuckyBlox Place',
    description: game.description || 'Local Studio place',
  }));

  res.render('studio', {
    title: 'LuckyBlox Studio',
    user,
    places,
  });
});

app.get('/avatar', (req, res) => {
  const user = getUser(req.query.userId || 1);
  const assets = Object.values(getAssets());

  res.render('avatar', {
    title: `${user.username} Avatar`,
    user,
    assets,
  });
});

app.get('/game', (req, res) => {
  const placeId = normalizePlaceId(req.query.placeId || req.query.placeid || 1818);
  const user = getUser(req.query.userId || 1);
  const game = getGameEntry(placeId);

  res.render('game-about', {
    title: `${game.title} | LuckyBlox`,
    user,
    game,
    placeId,
  });
});

function legacyJoinResponse(req, res) {
  const userId = Number(req.query.userId || req.query.userid || req.query.id || 1);
  const placeId = normalizePlaceId(req.query.placeId || req.query.placeid || req.query.id || 1818);
  const ticket = req.query.ticket || `LB_${Date.now()}`;
  const requestPort = Number(req.query.serverPort || req.query.port || gamePort);
  const serverJobId = req.query.jobId || req.query.serverJobId || `game-${Date.now()}`;

  let server = activeGameServers.find((candidate) => candidate.serverJobId === serverJobId || Number(candidate.placeId) === Number(placeId));
  if (!server) {
    server = allocatePlayerToServer(userId, placeId);
  }

  const selectedPort = Number(server.port || requestPort || gamePort);
  const finalJobId = String(server.serverJobId || serverJobId);
  const joinPayload = {
    ok: true,
    status: 2,
    jobId: finalJobId,
    placeId: Number(server.placeId || placeId),
    userId: Number(userId),
    ip: gameServerHost,
    port: selectedPort,
    serverPort: selectedPort,
    joinScriptUrl: `${publicOrigin}/game/Join.ashx?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket)}&serverPort=${selectedPort}&jobId=${encodeURIComponent(finalJobId)}`,
    authenticationUrl: `${publicOrigin}/Login/Negotiate.ashx`,
    authenticationTicket: String(ticket),
    clientTicket: String(ticket),
    message: null,
  };

  return res.json(joinPayload);
}

app.get('/Login/Negotiate.ashx', (req, res) => {
  res.status(200).send('');
});

app.post('/Login/Negotiate.ashx', (req, res) => {
  res.status(200).send('');
});

app.get('/2021/Login/Negotiate.ashx', (req, res) => {
  res.status(200).send('');
});

app.post('/2021/Login/Negotiate.ashx', (req, res) => {
  res.status(200).send('');
});

app.get('/game/placelauncher.ashx', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || req.query.id || 1);
  const placeId = normalizePlaceId(req.query.placeId || req.query.placeid || req.query.placeid || 1818);
  const requestedPort = Number(req.query.port || gamePort);
  const serverJobId = req.query.jobId || req.query.serverJobId || `game-${Date.now()}`;
  const allocatedServer = allocatePlayerToServer(userId, placeId);
  const selectedPort = Number(allocatedServer.port || requestedPort || gamePort);
  const finalJobId = String(allocatedServer.serverJobId || serverJobId);
  const ticket = createAuthTicket(userId, placeId, {
    port: selectedPort,
    serverJobId: finalJobId,
  });

  const joinUrl = `${publicOrigin}/game/Join.ashx?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket.ticket)}&serverPort=${selectedPort}&jobId=${encodeURIComponent(finalJobId)}`;

  return res.json({
    ok: true,
    jobId: finalJobId,
    status: 2,
    joinScriptUrl: joinUrl,
    authenticationUrl: `${publicOrigin}/Login/Negotiate.ashx`,
    authenticationTicket: ticket.ticket,
    message: null,
  });
});

app.get('/2021/game/placelauncher.ashx', (req, res) => {
  req.query.placeId = req.query.placeId || req.query.placeid || 1818;
  return app._router.stack.find((layer) => layer.route && layer.route.path === '/game/placelauncher.ashx')?.route?.stack[0].handle(req, res);
});

app.get('/game/Join.ashx', legacyJoinResponse);
app.get('/game/Join.ashx/', legacyJoinResponse);
app.get('/2021/game/Join.ashx', legacyJoinResponse);
app.get('/2021/game/Join.ashx/', legacyJoinResponse);
app.get('/game/join', legacyJoinResponse);

app.get('/game/:placeId', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  const user = getUser(req.query.userId || 1);
  const game = getGameEntry(placeId);

  res.render('game-about', {
    title: `${game.title} | LuckyBlox`,
    user,
    game,
    placeId,
  });
});

app.get('/play', (req, res) => {
  const placeId = Number(req.query.placeId || req.query.placeid || 1818);
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const queryUserId = Number(req.query.userId || req.query.userid || (sessionUser ? sessionUser.userId : 1));
  const userId = Number.isFinite(queryUserId) && queryUserId > 0 ? queryUserId : Number(sessionUser ? sessionUser.userId : 1) || 1;
  const ticket = req.query.ticket || `LB_${Date.now()}`;
  const jobId = req.query.jobId || req.query.serverJobId || 'local-job';
  const requestPort = Number(req.query.serverPort || req.query.port || gamePort);

  const server = activeGameServers.find((s) => s.serverJobId === jobId) || activeGameServers.find((s) => Number(s.placeId) === placeId) || null;

  res.render('play', {
    title: 'LuckyBlox Play',
    user: getUser(userId),
    placeId,
    userId,
    ticket,
    jobId,
    serverPort: requestPort,
    gameName: getGameEntry(placeId).title || 'LuckyBlox Arena',
    server,
  });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || req.body.userName || req.query.username || 'LocalPlayer');
  const password = String(req.body.password || req.body.pass || req.query.password || 'local');
  const users = getUsers();
  const match = Object.values(users).find((user) => String(user.username || user.displayName || '').toLowerCase() === username.toLowerCase());

  if (!match) {
    return res.status(401).json({ ok: false, error: 'invalid-credentials', message: 'Unknown username.' });
  }

  if (match.password && password !== match.password) {
    return res.status(401).json({ ok: false, error: 'invalid-credentials', message: 'Incorrect password.' });
  }

  const userId = Number(match.userId || match.id || 1);
  const user = serializeUser(userId);
  const ticket = createAuthTicket(userId, 1818, { port: gamePort, serverJobId: `session-${Date.now()}` });
  const sessionId = applySessionCookie(res, userId);

  return res.json({
    ok: true,
    user,
    token: ticket.ticket,
    authTicket: ticket.authTicket,
    session: {
      sessionId,
      userId: user.userId,
      placeId: 1818,
      port: gamePort,
      serverJobId: ticket.serverJobId,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    },
  });
});

app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId || 1;
  const publicGames = getPublicGamesForUser(userId);
  res.json({ ok: true, user: serializeUser(userId), publishedGames: publicGames });
});

app.get('/api/users/:userId/profile', (req, res) => {
  const userId = req.params.userId || 1;
  const publicGames = getPublicGamesForUser(userId);
  res.json({ ok: true, user: serializeUser(userId), publishedGames: publicGames });
});

app.get('/api/get-player-data/:userId', (req, res) => {
  res.json({ ok: true, userId: req.params.userId, data: serializeUser(req.params.userId) });
});

app.get('/api/places/:placeId', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  res.json({ ok: true, place: serializeGame(placeId) });
});

app.get('/api/places/:placeId/settings', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  res.json({ ok: true, settings: getPlaceSettings(placeId) });
});

app.post('/api/places/:placeId/settings', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  const updates = req.body || {};
  const settings = savePlaceSettings(placeId, updates);
  res.json({ ok: true, settings });
});

app.get('/v1/places/:placeId/settings', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  res.json({ ok: true, settings: getPlaceSettings(placeId) });
});

app.get('/api/games/:placeId', (req, res) => {
  const placeId = normalizePlaceId(req.params.placeId || 1818);
  res.json({ ok: true, game: serializeGame(placeId) });
});

app.get('/api/servers', (req, res) => {
  const servers = activeGameServers.map((server) => ({
    serverJobId: server.serverJobId,
    placeId: Number(server.placeId || 1818),
    port: Number(server.port || gamePort),
    currentPlayers: Array.isArray(server.currentPlayers) ? server.currentPlayers : [],
    maxPlayers: Number(server.maxPlayers || 20),
    status: server.status || 'running',
    startedAt: server.startedAt || new Date().toISOString(),
  }));

  res.json({ ok: true, servers });
});

app.post('/api/avatar/wear', (req, res) => {
  const userId = String(req.body.userId || 1);
  const incomingAssetIds = Array.isArray(req.body.assetIds) ? req.body.assetIds : [];
  const normalizedIds = incomingAssetIds.map((id) => String(id));

  const updatedUser = saveUser(userId, {
    currentlyWearing: normalizedIds,
  });

  res.json({
    ok: true,
    userId,
    currentlyWearing: updatedUser.currentlyWearing,
  });
});

app.get('/v1/avatar-fetch', (req, res) => {
  const userId = req.query.userId || req.query.userid || 1;
  const placeId = req.query.placeId || req.query.placeid || 1818;
  const payload = buildAvatarPayload(userId, placeId);
  res.json(payload);
});

app.get('/v1/CharacterFetch.ashx', (req, res) => {
  const userId = req.query.userId || req.query.userid || 1;
  const placeId = req.query.placeId || req.query.placeid || 1818;
  const payload = buildAvatarPayload(userId, placeId);
  res.json(payload);
});

app.post('/v1/authentication-tickets', (req, res) => {
  const userId = req.body.userId || req.body.userid || req.query.userId || 1;
  const placeId = req.body.placeId || req.body.placeid || req.query.placeId || 1818;

  let allocation = null;
  try {
    allocation = allocatePlayerToServer(userId, placeId);
  } catch (error) {
    console.error('Failed to allocate player to server:', error);
    return res.status(500).json({ ok: false, error: 'server-allocation-failed' });
  }

  const ticket = createAuthTicket(userId, placeId, {
    port: allocation.port,
    serverJobId: allocation.serverJobId,
  });

  const clientExe = resolveRobloxPlayerBinary();

  res.status(201).json({
    ok: true,
    userId: String(userId),
    placeId: Number(placeId),
    port: Number(allocation.port),
    serverJobId: String(allocation.serverJobId),
    ticket: ticket.ticket,
    authTicket: ticket.authTicket,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    launchURI: ticket.launchURI,
    clientVersion: '2021M',
    clientPath: clientExe,
    clientReady: clientExe !== null,
  });
});

app.post('/v1/authentication-tickets/', (req, res) => {
  app._router.handle(req, res);
});

app.get('/v1/authentication-tickets', (req, res) => {
  const userId = req.query.userId || req.query.userid || 1;
  const placeId = req.query.placeId || req.query.placeid || 1818;
  const ticket = createAuthTicket(userId, placeId);

  res.json({
    ok: true,
    userId: String(userId),
    placeId: Number(placeId),
    ticket: ticket.ticket,
    authTicket: ticket.authTicket,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    launchURI: ticket.launchURI,
  });
});

app.get('/v1/authentication-tickets/', (req, res) => {
  const userId = req.query.userId || req.query.userid || 1;
  const placeId = req.query.placeId || req.query.placeid || 1818;
  const ticket = createAuthTicket(userId, placeId);

  res.json({
    ok: true,
    userId: String(userId),
    placeId: Number(placeId),
    ticket: ticket.ticket,
    authTicket: ticket.authTicket,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    launchURI: ticket.launchURI,
  });
});

app.get('/api/tickets/:ticket', (req, res) => {
  const ticket = getTicketStatus(req.params.ticket);
  res.json({ ok: Boolean(ticket), ticket });
});

app.post('/v1/launch-client', (req, res) => {
  const clientExe = resolveRobloxPlayerBinary();
  if (!clientExe) {
    return res.status(500).json({ ok: false, error: 'client-not-found', clientVersion: '2021M', details: 'RobloxPlayerBeta.exe not found in Clients/2021M' });
  }

  const userId = Number(req.body.userId || req.query.userId || 1);
  const placeId = Number(req.body.placeId || req.body.placeid || req.query.placeId || 1818);
  const port = Number(req.body.port || req.query.port || gamePort);
  const serverJobId = req.body.serverJobId || req.query.serverJobId || `game-${Date.now()}`;

  try {
    const authUrl = `${publicOrigin}/v1/authentication-tickets?userId=${userId}&placeId=${placeId}`;
    const joinUrl = `${publicOrigin}/game/join?placeId=${placeId}&userId=${userId}&ticket=local&serverPort=${port}&jobId=${encodeURIComponent(serverJobId)}`;

    const { spawn } = require('child_process');
    const child = spawn(clientExe, ['-a', authUrl, '-t', 'local', '-j', joinUrl], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });

    res.json({
      ok: true,
      clientVersion: '2021M',
      clientPath: clientExe,
      started: true,
      pid: child.pid,
      authUrl,
      joinUrl,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'client-launch-failed', clientVersion: '2021M', details: error.message });
  }
});

app.post('/api/launch-game', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const requestedUserId = Number(req.body.userId || req.body.userid || req.query.userId || (sessionUser ? sessionUser.userId : 1));
  const userId = Number.isFinite(requestedUserId) && requestedUserId > 0 ? requestedUserId : Number(sessionUser ? sessionUser.userId : 1) || 1;
  const placeId = Number(req.body.placeId || req.body.placeid || req.query.placeId || 1818);

  try {
    const allocation = allocatePlayerToServer(userId, placeId);
    const ticket = createAuthTicket(userId, placeId, {
      port: allocation.port,
      serverJobId: allocation.serverJobId,
    });

    const playUrl = `/play?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket.ticket)}&serverPort=${allocation.port}&jobId=${encodeURIComponent(allocation.serverJobId)}`;

    return res.json({
      ok: true,
      started: true,
      userId: String(userId),
      placeId: Number(placeId),
      port: Number(allocation.port),
      serverJobId: String(allocation.serverJobId),
      ticket: ticket.ticket,
      authTicket: ticket.authTicket,
      launchURI: playUrl,
      playUrl,
      nativeLaunch: {
        status: 'skipped',
        reason: 'Native Roblox client not reliable in this environment',
      },
    });
  } catch (error) {
    console.error('Launch failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'launch-failed',
      message: error && error.message ? error.message : 'Failed to build a playable game launch.',
    });
  }
});

app.get('/game/join', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || 1);
  const placeId = Number(req.query.placeId || req.query.placeid || 1818);
  const ticket = req.query.ticket || `LB_${Date.now()}`;
  const requestPort = Number(req.query.serverPort || req.query.port || gamePort);
  const jobId = req.query.jobId || req.query.serverJobId || `game-${Date.now()}`;

  let server = activeGameServers.find((candidate) => candidate.serverJobId === jobId || Number(candidate.placeId) === Number(placeId));
  if (!server) {
    server = allocatePlayerToServer(userId, placeId);
  }

  const joinPayload = {
    ok: true,
    status: 2,
    jobId: String(server.serverJobId || jobId),
    placeId: Number(server.placeId || placeId),
    userId: Number(userId),
    ip: gameServerHost,
    port: Number(server.port || requestPort || gamePort),
    serverPort: Number(server.port || requestPort || gamePort),
    joinScriptUrl: `${publicOrigin}/game/join?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket)}&serverPort=${Number(server.port || requestPort || gamePort)}&jobId=${encodeURIComponent(server.serverJobId || jobId)}`,
    authenticationUrl: `${publicOrigin}/Login/Negotiate.ashx`,
    authenticationTicket: String(ticket),
    clientTicket: String(ticket),
    message: null,
  };

  res.json(joinPayload);
});

app.get('/game/:placeId/servers', (req, res) => {
  const placeId = Number(req.params.placeId || req.query.placeId || req.query.placeid || 1818);
  const servers = activeGameServers
    .filter((s) => Number(s.placeId) === placeId)
    .map((s) => ({
      serverJobId: s.serverJobId,
      placeId: Number(s.placeId),
      port: Number(s.port),
      status: s.status || 'running',
      playerCount: (s.currentPlayers || []).length,
      maxPlayers: Number(s.maxPlayers || 20),
      players: (s.currentPlayers || []).slice(0, 20),
      startedAt: s.startedAt || null,
      uptime: Date.now() - new Date(s.startedAt || Date.now()).getTime(),
    }));

  const fallback = [{
    serverJobId: `fallback-${placeId}`,
    placeId,
    port: gamePort,
    status: 'available',
    playerCount: 0,
    maxPlayers: 20,
    players: [],
    startedAt: null,
    uptime: 0,
  }];

  res.json({
    ok: true,
    placeId,
    totalServers: servers.length || 1,
    maxServers: 50,
    servers: servers.length ? servers : fallback,
  });
});

app.get('/game/:placeId/join', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || req.query.id || 1);
  const placeId = Number(req.params.placeId || req.query.placeId || req.query.placeid || 1818);
  const ticket = req.query.ticket || `LB_${Date.now()}`;
  const serverJobId = req.query.serverJobId || req.query.jobId || null;

  let server = null;
  if (serverJobId) {
    server = activeGameServers.find((s) => s.serverJobId === serverJobId);
  }
  if (!server) {
    server = getServerForPlace(placeId);
  }
  if (!server) {
    const alloc = allocatePlayerToServer(userId, placeId);
    server = activeGameServers.find((s) => s.serverJobId === alloc.serverJobId);
  }

  if (!server) {
    return res.status(500).json({ ok: false, error: 'server-unavailable', message: 'No game server available.' });
  }

  const selectedPort = Number(server.port || gamePort);
  const finalJobId = String(server.serverJobId);

  const joinPayload = {
    ok: true,
    status: 2,
    jobId: finalJobId,
    serverJobId: finalJobId,
    placeId: Number(server.placeId || placeId),
    userId: Number(userId),
    ip: gameServerHost,
    port: selectedPort,
    serverPort: selectedPort,
    joinScriptUrl: `${publicOrigin}/game/Join.ashx?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket)}&serverPort=${selectedPort}&jobId=${encodeURIComponent(finalJobId)}`,
    authenticationUrl: `${publicOrigin}/Login/Negotiate.ashx`,
    authenticationTicket: ticket,
    clientTicket: ticket,
    serverInfo: {
      port: selectedPort,
      playerCount: (server.currentPlayers || []).length,
      maxPlayers: server.maxPlayers || 20,
      status: server.status || 'running',
    },
    message: null,
  };

  res.json(joinPayload);
});

app.get('/game/:placeId/players', (req, res) => {
  const placeId = Number(req.params.placeId || req.query.placeId || req.query.placeid || 1818);
  const server = activeGameServers.find((s) => Number(s.placeId) === placeId);

  if (!server) {
    return res.json({ ok: true, placeId, players: [], playerCount: 0 });
  }

  res.json({
    ok: true,
    placeId,
    serverJobId: server.serverJobId,
    port: Number(server.port || gamePort),
    playerCount: (server.currentPlayers || []).length,
    maxPlayers: Number(server.maxPlayers || 20),
    players: (server.currentPlayers || []).map((pid, idx) => ({
      userId: Number(pid),
      userName: `Player ${pid}`,
      joinedAt: server.startedAt || new Date().toISOString(),
      role: idx === 0 ? 'host' : 'player',
    })),
  });
});

app.get('/api/games', (req, res) => {
  const published = getPublishedPlaces();
  const games = published.length > 0
    ? published.map((game) => ({
        placeId: Number(game.placeId),
        title: game.name,
        description: game.description,
        developer: game.author,
        genre: 'Adventure',
        playerCount: 0,
        likes: 0,
        favorites: 0,
        activeServers: [`${gameServerHost}:${gamePort}`],
        serverList: [`${gameServerHost}:${gamePort}`],
        votes: { likes: 0, dislikes: 0 },
        tags: ['Public', 'Published'],
        updatedAt: game.publishedAt,
        aboutUrl: `/game/${game.placeId}`,
        playUrl: `/play?placeId=${game.placeId}`,
      }))
    : Object.values(getGames()).map((game) => serializeGame(game.placeId || 1818));

  res.json({ ok: true, games, total: games.length, source: 'roblox-profile-templates' });
});

app.get('/api/templates', (req, res) => {
  const templates = getRobloxProfileTemplateItems().map((template) => ({
    placeId: Number(template.placeId),
    title: template.title,
    source: 'https://www.roblox.com/users/998796/profile#!#creations',
    url: `https://www.roblox.com/games/${template.placeId}/${encodeURIComponent(template.title.replace(/\s+/g, '-'))}`,
  }));

  res.json({ ok: true, templates, total: templates.length, source: 'roblox-profile-templates' });
});

app.get('/api/account/info', (req, res) => {
  const userId = Number(req.query.userId || req.body?.userId || 1);
  const user = getUser(userId);

  res.json({
    ok: true,
    user: {
      userId: Number(user.userId || userId),
      username: user.username || 'LocalPlayer',
      displayName: user.username || 'LocalPlayer',
      membership: user.membershipStatus || 'Premium',
      role: 'Creator',
    },
    permissions: {
      create: true,
      edit: true,
      publish: true,
      inventory: true,
    },
  });
});

app.get('/api/places', (req, res) => {
  const db = readJson(path.join(dataDir, 'places.json'), getGames());
  const places = Object.values(db).map((entry) => ({
    placeId: Number(entry.placeId || 1818),
    universeId: Number(entry.universeId || entry.placeId || 1818),
    name: entry.name || 'LuckyBlox Place',
    description: entry.description || 'Local Studio place',
    fileName: entry.fileName || `${entry.name || 'place'}.rbxlx`,
    version: Number(entry.version || 1),
    author: entry.author || 'LuckyBlox Studio',
    authorId: Number(entry.authorId || 1),
    maxPlayers: Number(entry.maxPlayers || 20),
    allowHttpRequests: Boolean(entry.allowHttpRequests !== false),
  }));

  res.json({ ok: true, total: places.length, places });
});

app.post('/api/save-place', (req, res) => {
  const placeName = String(req.body?.name || req.body?.placeName || 'LuckyBlox Studio Place');
  const content = req.body?.data || req.body?.contents || JSON.stringify({
    name: placeName,
    savedAt: new Date().toISOString(),
    type: 'StudioSave',
  }, null, 2);
  const safeName = `${placeName.replace(/[^a-zA-Z0-9_. -]/g, '_') || 'LuckyBlox_Studio_Place'}.rbxlx`;
  const workspaceDir = path.join(releaseRoot, 'workspace', 'saved_places');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const filePath = path.join(workspaceDir, safeName);
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));

  const placeId = Number(req.body?.placeId || 1818 + Math.floor(Math.random() * 5000));
  const placesFilePath = path.join(dataDir, 'places.json');
  const places = readJson(placesFilePath, {});
  const record = {
    placeId,
    universeId: placeId,
    name: placeName,
    description: req.body?.description || 'Saved from local Studio workflow.',
    fileName: safeName,
    filePath,
    version: Number(req.body?.version || 1),
    author: req.body?.author || 'LocalPlayer',
    authorId: Number(req.body?.authorId || 1),
    maxPlayers: Number(req.body?.maxPlayers || 20),
    allowHttpRequests: true,
    source: `workspace/saved_places/${safeName}`,
    updatedAt: new Date().toISOString(),
  };
  places[String(placeId)] = record;
  writeJson(placesFilePath, places);

  res.json({ ok: true, mode: 'save', placeId, fileName: safeName, filePath, savedAt: record.updatedAt });
});

app.post('/api/publish-place', (req, res) => {
  const placeName = String(req.body?.name || req.body?.placeName || 'LuckyBlox Studio Publish');
  const content = req.body?.data || req.body?.contents || JSON.stringify({
    name: placeName,
    publishedAt: new Date().toISOString(),
    type: 'StudioPublish',
  }, null, 2);
  const safeName = `${placeName.replace(/[^a-zA-Z0-9_. -]/g, '_') || 'LuckyBlox_Studio_Publish'}.rbxlx`;
  const workspaceDir = path.join(releaseRoot, 'workspace', 'saved_places');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const filePath = path.join(workspaceDir, safeName);
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));

  const placeId = Number(req.body?.placeId || 1818 + Math.floor(Math.random() * 5000));
  const placesFilePath = path.join(dataDir, 'places.json');
  const places = readJson(placesFilePath, {});
  const record = {
    placeId,
    universeId: placeId,
    name: placeName,
    description: req.body?.description || 'Published from local Studio workflow.',
    fileName: safeName,
    filePath,
    version: Number(req.body?.version || 1),
    author: req.body?.author || 'LocalPlayer',
    authorId: Number(req.body?.authorId || 1),
    maxPlayers: Number(req.body?.maxPlayers || 20),
    allowHttpRequests: true,
    source: `workspace/saved_places/${safeName}`,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  places[String(placeId)] = record;
  writeJson(placesFilePath, places);

  res.status(201).json({ ok: true, mode: 'publish', placeId, fileName: safeName, filePath, publishedAt: record.publishedAt });
});

app.get('/api/assets', (req, res) => {
  res.json({ ok: true, assets: Object.values(getAssets()) });
});

app.post('/api/servers/register', (req, res) => {
  const payload = req.body || {};
  const jobId = payload.jobId || payload.serverJobId || `server-${Date.now()}`;
  const match = activeGameServers.find((server) => server.serverJobId === jobId);

  if (match) {
    match.placeId = Number(payload.placeId || match.placeId);
    match.port = Number(payload.port || match.port);
    match.currentPlayers = Array.isArray(payload.currentPlayers) ? payload.currentPlayers : match.currentPlayers || [];
    match.maxPlayers = Number(payload.maxPlayers || match.maxPlayers || 20);
    match.status = 'running';
    return res.json({ ok: true, server: match });
  }

  const serverRecord = {
    serverJobId: jobId,
    placeId: Number(payload.placeId || 1818),
    port: Number(payload.port || gamePort),
    currentPlayers: Array.isArray(payload.playerIds) ? payload.playerIds : [],
    maxPlayers: Number(payload.maxPlayers || 20),
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  activeGameServers.push(serverRecord);
  return res.json({ ok: true, server: serverRecord });
});

app.post('/api/servers/update-players', (req, res) => {
  const payload = req.body || {};
  const serverJobId = payload.jobId || payload.serverJobId;
  const server = activeGameServers.find((candidate) => candidate.serverJobId === serverJobId);

  if (!server) {
    return res.status(404).json({ ok: false, message: 'server-not-found' });
  }

  const playerIds = Array.isArray(payload.playerIds)
    ? payload.playerIds
    : Array.isArray(payload.currentPlayers)
      ? payload.currentPlayers
      : [];

  server.currentPlayers = playerIds.map((id) => String(id));
  server.maxPlayers = Number(payload.maxPlayers || server.maxPlayers || 20);
  server.currentPlayers = server.currentPlayers.slice(0, server.maxPlayers);

  return res.json({ ok: true, server });
});

app.post('/api/servers/close', (req, res) => {
  const payload = req.body || {};
  const serverJobId = payload.jobId || payload.serverJobId;
  if (serverJobId) {
    removeServerByJobId(String(serverJobId));
  }
  res.json({ ok: true, serverJobId: String(serverJobId || 'unknown') });
});

app.post('/ide/publish', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const name = req.query.name || req.body?.name || `publish-${Date.now()}.rbxl`;
  const assetKind = (req.query.kind || 'rbxl').toString().toLowerCase();
  const saved = writeUploadedPackage(name, rawBody, assetKind);

  res.json({
    ok: true,
    fileName: saved.fileName,
    path: saved.filePath,
    contentType,
    kind: assetKind,
    message: 'Studio publish saved to workspace path.',
  });
});

app.post('/Data/Upload.ashx', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const name = req.query.name || `upload-${Date.now()}.rbxm`;
  const saved = writeUploadedPackage(name, rawBody, 'rbxm');

  res.json({
    ok: true,
    fileName: saved.fileName,
    path: saved.filePath,
    message: 'Asset upload indexed and saved to workspace.',
  });
});

app.get('/asset/:name', (req, res) => {
  const names = [req.params.name, `${req.params.name}.rbxl`, `${req.params.name}.rbxm`];
  let filePath = null;

  for (const candidate of names) {
    const testPath = path.join(mapsRoot, candidate);
    if (fs.existsSync(testPath)) {
      filePath = testPath;
      break;
    }
  }

  if (!filePath) {
    return res.status(404).json({ ok: false, message: 'Asset not found.' });
  }

  res.download(filePath);
});

app.post('/asset/', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const name = req.query.name || `asset-${Date.now()}.rbxl`;
  const saved = writeUploadedPackage(name, rawBody, 'rbxl');

  res.json({
    ok: true,
    fileName: saved.fileName,
    path: saved.filePath,
    message: 'Published package stored to workspace.',
  });
});

app.get('/studio-open-place/v1/openplace', (req, res) => {
  const placeId = Number(req.query.placeId || 1818);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  const placeRecord = places[String(placeId)];

  if (!placeRecord) {
    const defaultPlace = {
      placeId: placeId,
      universeId: placeId,
      name: `Place ${placeId}`,
      description: 'Local Studio place',
      fileName: `place-${placeId}.rbxlx`,
      filePath: path.join(releaseRoot, 'workspace', 'saved_places', `place-${placeId}.rbxlx`),
      version: 1,
      author: 'LocalPlayer',
      authorId: 1,
      maxPlayers: 20,
      allowHttpRequests: true,
      visibility: 'Public',
      genre: 'Adventure',
      source: 'workspace/saved_places',
    };
    return res.json({ ok: true, place: defaultPlace });
  }

  res.json({ ok: true, place: placeRecord });
});

app.get('/api/v1/me', (req, res) => {
  const user = getUser(req.query.userId || req.headers['x-user-id'] || 1);
  res.json({ ok: true, user: serializeUser(user.userId || 1) });
});

app.get('/api/v1/account', (req, res) => {
  const userId = Number(req.query.userId || req.headers['x-user-id'] || 1);
  const user = getUser(userId);
  res.json({
    ok: true,
    user: {
      userId: Number(user.userId || userId),
      username: user.username,
      displayName: user.username,
      membership: user.membershipStatus || user.membership || 'Premium',
      role: 'Creator',
      robux: Number(user.robux) || 0,
      stats: Object.assign({ friends: 0, created: 0, plays: 0, followers: 0, badges: 0, gameVisits: 0 }, user.stats || {}),
      friendCount: Array.isArray(user.friends) ? user.friends.length : 0,
      badgeCount: Array.isArray(user.badges) ? user.badges.length : 0,
    },
    permissions: {
      create: true, edit: true, publish: true, inventory: true,
    },
  });
});

app.get('/api/friends', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || req.headers['x-user-id'] || 1);
  const user = getUser(userId);
  const friends = Array.isArray(user.friends) ? user.friends : [];
  const friendUsers = friends.map((f) => getUser(f.userId)).filter(Boolean);
  res.json({ ok: true, userId, friends: friendUsers, total: friends.length });
});

app.get('/api/badges', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || req.headers['x-user-id'] || 1);
  const user = getUser(userId);
  const badges = Array.isArray(user.badges) ? user.badges : [];
  res.json({ ok: true, userId, badges, total: badges.length });
});

app.get('/api/v1/authentication-tickets', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || req.headers['x-user-id'] || 1);
  const placeId = Number(req.query.placeId || req.query.placeid || 1818);
  const ticket = createAuthTicket(userId, placeId);
  res.json({
    ok: true, userId: String(userId), placeId, ticket: ticket.ticket,
    authTicket: ticket.authTicket, expiresAt: new Date(ticket.expiresAt).toISOString(),
  });
});

app.post('/api/v1/authentication-tickets', (req, res) => {
  const userId = Number(req.body?.userId || req.query.userId || 1);
  const placeId = Number(req.body?.placeId || req.query.placeId || 1818);
  const ticket = createAuthTicket(userId, placeId);
  res.status(201).json({
    ok: true, userId: String(userId), placeId, ticket: ticket.ticket,
    authTicket: ticket.authTicket, expiresAt: new Date(ticket.expiresAt).toISOString(),
  });
});

app.get('/api/v1/places', (req, res) => {
  const db = readJson(path.join(dataDir, 'places.json'), {});
  const places = Object.values(db).map((entry) => ({
    placeId: Number(entry.placeId || 1818),
    universeId: Number(entry.universeId || entry.placeId || 1818),
    name: entry.name || 'LuckyBlox Place',
    description: entry.description || 'Local Studio place',
    fileName: entry.fileName || `${entry.name || 'Place'}.rbxlx`,
    filePath: entry.filePath || '',
    version: Number(entry.version || 1),
    author: entry.author || 'LuckyBlox Studio',
    authorId: Number(entry.authorId || 1),
    maxPlayers: Number(entry.maxPlayers || 20),
    allowHttpRequests: entry.allowHttpRequests !== false,
    visibility: entry.visibility || 'Public',
    genre: entry.genre || 'Adventure',
    updatedAt: entry.updatedAt || new Date().toISOString(),
  }));
  res.json({ ok: true, total: places.length, places });
});

app.post('/api/v1/places', express.raw({ type: '*/*', limit: '250mb' }), (req, res) => {
  const placeName = String(req.body?.name || req.query.name || 'LuckyBlox Studio Place');
  const fileName = `${placeName.replace(/[^a-zA-Z0-9_. -]/g, '_')}.rbxlx`;
  const content = req.body?.data || req.body?.contents || JSON.stringify({ name: placeName }, null, 2);
  const savedPlacesDir = path.join(releaseRoot, 'workspace', 'saved_places');
  fs.mkdirSync(savedPlacesDir, { recursive: true });
  const filePath = path.join(savedPlacesDir, fileName);
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const placeId = Number(req.query.placeId || req.body?.placeId || 1818 + Math.floor(Math.random() * 5000));
  res.json({ ok: true, placeId, fileName, filePath, name: placeName });
});

app.get('/api/v1/places/:placeId', (req, res) => {
  const placeId = Number(req.params.placeId || 1818);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  const record = places[String(placeId)];
  if (!record) {
    return res.json({ ok: true, place: {
      placeId, universeId: placeId, name: `Place ${placeId}`, description: 'Local Studio place',
      fileName: `place-${placeId}.rbxlx`, version: 1, author: 'LocalPlayer', maxPlayers: 20,
      allowHttpRequests: true, visibility: 'Public', genre: 'Adventure',
    }});
  }
  res.json({ ok: true, place: record });
});

app.post('/api/v1/places/:placeId/publish', express.raw({ type: '*/*', limit: '250mb' }), (req, res) => {
  const placeId = Number(req.params.placeId || 1818);
  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const fileName = `${String(req.query.name || `Place_${placeId}`).replace(/[^a-zA-Z0-9_. -]/g, '_')}.rbxlx`;
  const savedPlacesDir = path.join(releaseRoot, 'workspace', 'saved_places');
  fs.mkdirSync(savedPlacesDir, { recursive: true });
  const filePath = path.join(savedPlacesDir, fileName);
  fs.writeFileSync(filePath, rawBuffer.length ? rawBuffer : Buffer.from(JSON.stringify({ placeId }, null, 2)));
  res.json({ ok: true, placeId, fileName, publishedAt: new Date().toISOString() });
});

app.get('/api/v1/games', (req, res) => {
  const games = Object.values(getGames()).map((game) => serializeGame(game.placeId || 1818));
  res.json({ ok: true, games, total: games.length });
});

app.get('/api/v1/games/:placeId', (req, res) => {
  const placeId = Number(req.params.placeId || 1818);
  const game = getGameEntry(placeId);
  res.json({ ok: true, game: serializeGame(placeId) });
});

app.get('/api/v1/assets', (req, res) => {
  const assets = Object.values(getAssets());
  res.json({ ok: true, total: assets.length, assets });
});

function getDevUser(req) {
  const sessionCookie = parseCookieHeader(req.headers.cookie || '').luckblox_session;
  const session = sessionCookie ? activeSessions.get(sessionCookie) : null;
  if (session) return getUser(Number(session.userId) || 1);
  return null;
}

function requireDevAuth(req, res, next) {
  const sessionCookie = parseCookieHeader(req.headers.cookie || '').luckblox_session;
  const session = sessionCookie ? activeSessions.get(sessionCookie) : null;
  if (session) {
    req.sessionUser = getUser(Number(session.userId) || 1);
    req.sessionUserId = String(req.sessionUser.userId || 1);
    return next();
  }
  const redirect = encodeURIComponent(req.originalUrl || '/dev');
  return res.redirect(`/signin?error=auth-required&redirect=${redirect}`);
}

app.get('/dev', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  const places = Object.values(readJson(path.join(dataDir, 'places.json'), {}));
  const games = Object.values(getGames());
  const assets = Object.values(getAssets());
  res.render('dev/home', {
    title: 'LuckyBlox Studio - dev.LuckBlox.site.tk',
    user,
    places,
    games,
    assets,
    welcome: req.query.welcome === '1' || req.query.signedin === '1',
  });
});

app.get('/dev/create', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/create', {
    title: 'Create - LuckyBlox Studio',
    user,
  });
});

app.post('/dev/create', requireDevAuth, express.urlencoded({ extended: true, limit: '50mb' }), (req, res) => {
  const body = req.body || {};
  const placeName = String(body.name || req.query.name || 'New Place');
  const fileName = `${placeName.replace(/[^a-zA-Z0-9_. -]/g, '_')}.rbxlx`;
  const savedPlacesDir = path.join(releaseRoot, 'workspace', 'saved_places');
  fs.mkdirSync(savedPlacesDir, { recursive: true });
  const filePath = path.join(savedPlacesDir, fileName);
  const placeData = {
    name: placeName,
    description: body.description || '',
    genre: body.genre || 'Adventure',
    maxPlayers: Number(body.maxPlayers || 20),
    visibility: body.visibility || 'Public',
  };
  fs.writeFileSync(filePath, JSON.stringify(placeData, null, 2));
  const placeId = Number(req.query.placeId || Date.now() % 100000);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  places[String(placeId)] = {
    placeId, universeId: placeId, name: placeName, description: placeData.description,
    fileName, filePath, version: 1, author: 'LocalPlayer', authorId: 1, maxPlayers: placeData.maxPlayers,
    allowHttpRequests: true, visibility: placeData.visibility, genre: placeData.genre, updatedAt: new Date().toISOString(),
  };
  writeJson(path.join(dataDir, 'places.json'), places);
  res.json({ ok: true, placeId, fileName, filePath });
});

app.get('/dev/game/:placeId/settings', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  const placeId = Number(req.params.placeId || 1818);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  const place = places[String(placeId)] || {
    placeId, universeId: placeId, name: `Place ${placeId}`, description: '',
    fileName: `place-${placeId}.rbxlx`, version: 1, author: 'LocalPlayer', maxPlayers: 20,
    allowHttpRequests: true, visibility: 'Public', genre: 'Adventure', iconUrl: '',
  };
  res.render('dev/settings', {
    title: `${place.name} - Settings`,
    user,
    place,
  });
});

app.post('/dev/game/:placeId/settings', requireDevAuth, (req, res) => {
  const placeId = Number(req.params.placeId || 1818);
  const places = readJson(path.join(dataDir, 'places.json'), {});
  if (!places[String(placeId)]) {
    places[String(placeId)] = {
      placeId, universeId: placeId, name: `Place ${placeId}`, version: 1, author: 'LocalPlayer', authorId: 1,
    };
  }
  const p = places[String(placeId)];
  p.name = req.body?.name || p.name;
  p.description = req.body?.description || p.description;
  p.visibility = req.body?.visibility || p.visibility;
  p.genre = req.body?.genre || p.genre;
  p.maxPlayers = Number(req.body?.maxPlayers || p.maxPlayers || 20);
  p.iconUrl = req.body?.iconUrl || p.iconUrl;
  p.updatedAt = new Date().toISOString();
  writeJson(path.join(dataDir, 'places.json'), places);
  res.json({ ok: true, place: p });
});

app.get('/dev/assets', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  const assets = Object.values(getAssets());
  const savedPlacesDir = path.join(releaseRoot, 'workspace', 'saved_places');
  const uploadedAssets = fs.existsSync(savedPlacesDir) ? fs.readdirSync(savedPlacesDir) : [];
  res.render('dev/assets', {
    title: 'Assets - LuckyBlox Studio',
    user,
    assets,
    uploadedAssets,
  });
});

app.post('/dev/assets/upload', requireDevAuth, express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const assetName = String(req.query.name || req.body?.name || `asset-${Date.now()}`);
  const assetType = String(req.query.type || req.body?.type || 'image');
  const savedAssetsDir = path.join(releaseRoot, 'workspace', 'assets');
  fs.mkdirSync(savedAssetsDir, { recursive: true });
  const ext = assetType === 'image' ? '.png' : '.rbxl';
  const fileName = `${assetName.replace(/[^a-zA-Z0-9_. -]/g, '_')}${ext}`;
  const filePath = path.join(savedAssetsDir, fileName);
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  fs.writeFileSync(filePath, data);
  const assetsDb = readJson(path.join(dataDir, 'assets.json'), {});
  const assetId = String(Date.now());
  assetsDb[assetId] = {
    id: Number(assetId), name: assetName, assetType: assetType, fileName, filePath,
    kind: assetType, creatorId: 1, creatorName: 'LocalPlayer', description: 'Uploaded asset',
    version: 1, size: data.length, updatedAt: new Date().toISOString(),
  };
  writeJson(path.join(dataDir, 'assets.json'), assetsDb);
  res.json({ ok: true, assetId, fileName, filePath, size: data.length });
});

app.get('/dev/docs', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs', {
    title: 'API Docs - LuckyBlox Studio',
    user,
  });
});

app.get('/dev/docs/games', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs/games', {
    title: 'Game Engine API - LuckyBlox Studio',
    user,
  });
});

app.get('/dev/docs/places', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs/places', {
    title: 'Place API - LuckyBlox Studio',
    user,
  });
});

app.get('/dev/docs/users', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs/users', {
    title: 'User API - LuckyBlox Studio',
    user,
  });
});

app.get('/dev/docs/assets', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs/assets', {
    title: 'Asset API - LuckyBlox Studio',
    user,
  });
});

app.get('/dev/docs/auth', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/docs/auth', {
    title: 'Auth API - LuckyBlox Studio',
    user,
  });
});

const bridgeServer = app.listen(PORT, HOST, () => {
  console.log(`LuckyBlox HTTP DB bridge listening on http://${HOST}:${PORT}`);
  console.log(`LuckyBlox public base URL: ${publicBaseUrl}`);
});

// Never let a listen error become an unhandled 'error' event.
bridgeServer.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[luckyblox] bridge cannot bind ${HOST}:${PORT} — address already in use.`);
    process.exit(1);
  }
  console.error(`[luckyblox] bridge server error: ${error && error.message}`);
  process.exit(1);
});
