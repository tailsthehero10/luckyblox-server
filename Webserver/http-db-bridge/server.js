const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildPlaceCatalogFromMaps, normalizePlaceId: normalizePlaceIdInput, resolveRequestedPlace } = require('./gameMapResolver');
const { getRobloxProfileTemplateItems } = require('./robloxTemplateSource');
const robloxApi = require('./robloxApi');
const { getStudioBuildInfo, getStudioUpdateManifest } = require('./studioBuildInfo');
const { installStudioApiRoutes } = require(path.join(__dirname, '..', '..', 'server', 'studioApi.js'));
const { installTeamCreateRoutes } = require(path.join(__dirname, '..', '..', 'server', 'teamCreate.js'));
const {
  allocatePlayerToServer,
  activeGameServers,
  createJoinJob,
  getJobStatus,
  getTotalPlayerCount,
  listServersForPlace,
  removePlayerFromServer,
  removeServerByJobId,
  getServerForPlace,
  spawnDedicatedServer,
} = require(path.join(__dirname, '..', '..', 'server', 'orchestrator.js'));

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
const storage = require(path.join(releaseRoot, 'server', 'storage.js'));
const security = require(path.join(releaseRoot, 'server', 'security.js'));

// All persisted data goes through the storage layer, which honours
// LUCKYBLOX_DATA_DIR / RENDER_DISK_PATH so accounts survive redeploys.
const dataDir = storage.dataDir;
const usersPath = storage.dataPath('users.json');
const gamesPath = storage.dataPath('games.json');
const assetsPath = storage.dataPath('assets.json');
const placesPath = storage.dataPath('places.json');
const audit = security.createAuditLogger(path.join(dataDir, 'security-audit.log'));
const uploadsRoot = path.join(releaseRoot, 'Uploads');
const mapsRoot = path.join(releaseRoot, 'Maps');
const secretKey = process.env.LUCKBLOX_SECRET || 'luckblox-local-dev-secret';
const activeTickets = new Map();
const activeSessions = new Map();

// Owner-controlled open/close switch for the whole site (see siteStatus.js).
const siteStatus = require('./siteStatus').createSiteStatus({
  storePath: storage.dataPath('site-status.json'),
  envOverride: process.env.LUCKYBLOX_SITE_STATUS || '',
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
// LuckyBlox SVG icon set (Robux, friends, create, develop, studio, ...). Views
// reference these by name instead of emoji glyphs so the UI matches Roblox's
// 2021 look everywhere.
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons')));
// Page imagery (e.g. the sign-in background). Kept as a folder so a new image can
// be dropped in without a code change.
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));
// Roblox Gotham SSm webfonts (shared/content/fonts) copied into public/fonts so
// the site renders in the real Roblox typeface instead of a system fallback.
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts')));
app.use('/legacy-nav.js', express.static(path.join(__dirname, 'public', 'legacy-nav.js')));
// Serve the site icon folder so /favicon.ico, /favicon.png and the originals in
// Webserver/site icon/ are all reachable from every page.
const siteIconDir = path.join(releaseRoot, 'Webserver', 'site icon');
app.use('/site-icon', express.static(siteIconDir));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(siteIconDir, 'luckyblox.ico')));
app.get('/favicon.png', (req, res) => res.sendFile(path.join(siteIconDir, 'luckyblox.png')));
// Sign in / sign up background. The source file lives at
// Webserver/site icon/BackgroundSigninup/sign page.jpg (a space in the name, so
// a raw static URL is awkward); expose it under a clean, space-free path.
const signBackgroundCandidates = [
  path.join(siteIconDir, 'BackgroundSigninup', 'sign page.jpg'),
  path.join(siteIconDir, 'BackgroundSigninup', 'sign page.png'),
];
app.get('/sign-background', (req, res) => {
  const file = signBackgroundCandidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    return res.status(404).send('sign background not found');
  }
  res.set('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file);
});
// Client binary assets (ClientSettings, Qml, DLLs, ...). These are per-client
// folders and not every client ships all of them - 2021M contains only
// AppSettings.xml and its exe - so resolve the selected client per request and
// fall back to the default when the folder is absent instead of 404ing.
const DEFAULT_CLIENT_DIR = path.join(releaseRoot, 'Clients', '2022M');

function resolveClientAssetDir() {
  try {
    const file = path.join(releaseRoot, 'Settings', 'SelectedClient.txt');
    if (!fs.existsSync(file)) return DEFAULT_CLIENT_DIR;
    const value = String(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return DEFAULT_CLIENT_DIR;
    const candidate = path.join(releaseRoot, 'Clients', value);
    return fs.existsSync(candidate) ? candidate : DEFAULT_CLIENT_DIR;
  } catch (error) {
    return DEFAULT_CLIENT_DIR;
  }
}

// The committed AppSettings.xml files carry a baked-in localhost BaseUrl. When
// the bridge itself is the public entry point (single-port deployment) that
// localhost URL would be handed straight to the client, so rewrite it to the
// live public origin here - the same rewrite server.js does on its own path.
// Each client's own path suffix is preserved (2021M expects a trailing /home/,
// 2022M does not) because dropping it breaks the client's routing.
function rewriteAppSettingsBaseUrl(body, origin) {
  const match = String(body).match(/<BaseUrl>[\s\S]*?<\/BaseUrl>/i);
  if (!match) return body;
  const existingPath = (match[0].match(/LuckBlox\.site\.tk(\/[^<]*)?/i) || [])[1] || '/';
  const suffix = existingPath.startsWith('/') ? existingPath : '/' + existingPath;
  return String(body).replace(
    /<BaseUrl>[\s\S]*?<\/BaseUrl>/i,
    `<BaseUrl>${origin}/LuckBlox.site.tk${suffix}</BaseUrl>`,
  );
}

// Express needs a fixed root, so mount a resolver that picks the right file on
// each request and falls back to the default client's copy.
function serveClientAsset(subPath) {
  return (req, res, next) => {
    const relative = String(req.path || '').replace(/^\/+/, '');
    const clientDir = resolveClientAssetDir();
    const own = path.join(clientDir, subPath || '', relative);

    let file = null;
    if (own.startsWith(clientDir) && fs.existsSync(own) && fs.statSync(own).isFile()) {
      file = own;
    } else {
      const shared = path.join(DEFAULT_CLIENT_DIR, subPath || '', relative);
      if (shared.startsWith(DEFAULT_CLIENT_DIR) && fs.existsSync(shared) && fs.statSync(shared).isFile()) {
        file = shared;
      }
    }

    if (!file) return next();

    if (path.basename(file).toLowerCase() === 'appsettings.xml') {
      const body = rewriteAppSettingsBaseUrl(fs.readFileSync(file, 'utf8'), publicOrigin);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      return res.send(body);
    }

    return res.sendFile(file);
  };
}

app.use('/ClientSettings', serveClientAsset('ClientSettings'));
app.use('/LuckBlox.site.tk', serveClientAsset(''));
app.use(serveClientAsset(''));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/assets', express.static(path.join(releaseRoot, 'Assets')));
app.use('/maps', express.static(mapsRoot));

// Roblox's own game placeholder art (the blocky forest card + the wide banner).
// The source files have spaces/hashes in their names, so expose them under
// stable, readable routes that templates can reference directly.
const gamePlaceholderRoot = path.join(releaseRoot, 'Webserver', 'gameplaceholder');
const GAME_CARD_PLACEHOLDER = path.join(gamePlaceholderRoot, 'Card_512x512', 'c719f9be53f9a41fd34309fe723577a69615962b.png');
const GAME_BIG_PLACEHOLDER = path.join(gamePlaceholderRoot, 'Big_', 'image (44).png');

app.get('/gameplaceholder/card.png', (req, res) => {
  if (!fs.existsSync(GAME_CARD_PLACEHOLDER)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  return res.sendFile(GAME_CARD_PLACEHOLDER);
});

app.get('/gameplaceholder/big.png', (req, res) => {
  if (!fs.existsSync(GAME_BIG_PLACEHOLDER)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  return res.sendFile(GAME_BIG_PLACEHOLDER);
});

app.use('/gameplaceholder', express.static(gamePlaceholderRoot));

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

function createSessionForUser(userId, req) {
  const user = getUser(userId);
  const sessionId = security.generateSessionId();
  const ttlMs = 1000 * 60 * 60 * 12; // 12 hours
  const expiresAt = Date.now() + ttlMs;
  const csrfToken = security.createCsrfToken(sessionId, secretKey);

  activeSessions.set(sessionId, {
    sessionId,
    userId: String(user.userId || userId || 1),
    username: user.username || 'LocalPlayer',
    csrfToken,
    ip: req ? security.clientIp(req) : 'unknown',
    userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 200) : '',
    expiresAt,
    createdAt: Date.now(),
  });

  persistSessions();
  return { sessionId, expiresAt, csrfToken };
}

// --- Session persistence -----------------------------------------------------
// Sessions are mirrored to disk so a container restart does not silently log
// every user out (which looked like broken/fake auth on Render).
const sessionsPath = storage.dataPath('sessions.json');

function persistSessions() {
  const now = Date.now();
  const serialisable = {};
  for (const [id, session] of activeSessions.entries()) {
    if (Number(session.expiresAt) > now) {
      serialisable[id] = session;
    }
  }
  try {
    storage.writeJson('sessions.json', serialisable);
  } catch (error) {
    /* sessions are best-effort; never break a request over this */
  }
}

function loadSessions() {
  const stored = storage.readJson('sessions.json', {});
  const now = Date.now();
  let loaded = 0;
  for (const [id, session] of Object.entries(stored || {})) {
    if (session && Number(session.expiresAt) > now) {
      activeSessions.set(id, session);
      loaded += 1;
    }
  }
  if (loaded > 0) {
    console.log(`[luckyblox] restored ${loaded} active session(s)`);
  }
}

function destroySession(sessionId) {
  if (sessionId) {
    activeSessions.delete(sessionId);
    persistSessions();
  }
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

function applySessionCookie(res, userId, req) {
  const { sessionId, expiresAt, csrfToken } = createSessionForUser(userId, req);
  // secure cookies require HTTPS; enable automatically in the cloud so the
  // session cookie is never sent in cleartext. Locally it stays off for http.
  const isSecure = publicBaseUrl.startsWith('https://') || Boolean(process.env.RENDER);
  res.cookie('luckblox_session', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: Math.max(1, expiresAt - Date.now()),
    path: '/',
  });
  return { sessionId, csrfToken };
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

  // Expose the CSRF token of the *current* session to views. Sign-in and
  // sign-up forms need a token even before a session exists, so we mint a fresh
  // anonymous session id + token for guests.
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  let sessionId = cookieMap.luckblox_session;
  const session = sessionId ? activeSessions.get(sessionId) : null;

  if (!session) {
    sessionId = security.generateSessionId();
    const csrfToken = security.createCsrfToken(sessionId, secretKey);
    const isSecure = publicBaseUrl.startsWith('https://') || Boolean(process.env.RENDER);
    res.cookie('luckblox_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 1000 * 60 * 60 * 12,
      path: '/',
    });
    req.csrfToken = csrfToken;
  } else {
    req.csrfToken = session.csrfToken || security.createCsrfToken(sessionId, secretKey);
  }

  res.locals.basePath = req.headers['x-base-path'] || '';
  res.locals.csrfToken = req.csrfToken;
  res.locals.currentUser = req.sessionUser;
  res.locals.isOwner = isOwnerUser(req.sessionUser);
  // Stable, locale-independent date formatting for every template.
  res.locals.formatDate = formatDate;
  next();
});

/**
 * CSRF protection for state-changing requests (POST/PUT/PATCH/DELETE).
 * Checks the `_csrf` body field or the `x-csrf-token` header against the
 * session's token. Skipped for pure JSON API clients that present a valid
 * auth ticket instead (those are authenticated separately).
 */
function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  const sessionId = cookieMap.luckblox_session;
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];

  if (!sessionId || !security.verifyCsrfToken(String(token || ''), sessionId, secretKey)) {
    audit('csrf_rejected', { path: req.path, ip: security.clientIp(req) });
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ ok: false, error: 'csrf-token-invalid', message: 'Security token missing or expired. Reload and try again.' });
    }
    return res.status(403).send('Security token invalid. Please reload the page and try again.');
  }

  return next();
}

// Use the hardened, versioned hashing from the security module instead of the
// local duplicates (the old local copy used fewer PBKDF2 iterations).
const hashPassword = security.hashPassword;
const verifyPassword = security.verifyPassword;

/**
 * The account that owns the deployment. ID 1 is the owner, matching
 * tailsthehero10 on the live site. Ownership grants creator/admin abilities.
 */
const OWNER_USER_ID = String(process.env.LUCKYBLOX_OWNER_ID || '1');
const OWNER_USERNAME = String(process.env.LUCKYBLOX_OWNER_USERNAME || 'tailsthehero10').toLowerCase();

function isOwnerUser(user) {
  if (!user) {
    return false;
  }
  const idMatch = String(user.userId || user.id || '') === OWNER_USER_ID;
  const nameMatch = String(user.username || '').toLowerCase() === OWNER_USERNAME;
  return idMatch || nameMatch;
}

/**
 * The Roblox admin badge. There is exactly ONE admin badge — you either have
 * admin or you don't. The image ships in Assets/roles/admin.png (extracted from
 * the bundled 2021M client) and is served at /assets/roles/admin.png.
 *
 * Admin is granted by:
 *   - the account being the deployment owner (ID 1 / LUCKYBLOX_OWNER_USERNAME), or
 *   - an explicit "admin": true (or "isAdmin": true) flag on the account.
 */
function isAdminUser(user) {
  if (!user) {
    return false;
  }
  if (isOwnerUser(user)) {
    return true;
  }
  return user.admin === true || user.isAdmin === true;
}

/**
 * Returns the admin badge for a user, or null when they are not an admin.
 * The badge is the single Roblox admin icon; no role tiers.
 */
function getAdminBadge(user) {
  if (!isAdminUser(user)) {
    return null;
  }

  const imagePath = path.join(releaseRoot, 'Assets', 'roles', 'admin.png');
  let hasImage = false;
  try {
    hasImage = fs.existsSync(imagePath);
  } catch (error) {
    hasImage = false;
  }

  return {
    label: 'Admin',
    imageUrl: hasImage ? '/assets/roles/admin.png' : null,
    hasImage,
  };
}

function upgradePassword(user) {
  if (!user || !user.password) return;
  // Only upgrade when the stored value is a legacy plaintext/short hash. An
  // already-hashed password must never be re-hashed (that would lock the user
  // out because the plaintext is no longer available).
  if (user.passwordSalt && user.passwordVersion >= security.HASH_VERSION) return;
  if (!user.passwordSalt && user.password.length >= 64) return; // already a hash, just unsalted-prefixed

  const { hash, salt, version } = hashPassword(user.password);
  user.password = hash;
  user.passwordSalt = salt;
  user.passwordVersion = version;
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

// NOTE: the effective getUserByUsername is defined further down (after
// OWNER_USER_ID exists, which its tie-breaking uses). A second copy used to live
// here with a plain first-match lookup; because the later declaration wins, that
// copy was dead code and its duplicate-username bug was invisible. It was
// removed so there is exactly one implementation.

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Restore any sessions that were persisted before the last restart, so a
// redeploy does not silently sign everyone out.
loadSessions();

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
  // Atomic write: temp file + rename, so an interrupted write (container
  // restart mid-save) cannot leave a half-written, corrupt data file.
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    console.error(`[luckyblox] writeJson failed for ${filePath}: ${error.message}`);
    try {
      fs.unlinkSync(tmpPath);
    } catch (cleanupError) {
      /* ignore */
    }
    throw error;
  }
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
 * Resolve the images for a user's profile: the dressed avatar and the currently
 * equipped item thumbnails.
 *
 * Two sources, in order:
 *   1. If the account is linked to a real Roblox id (user.robloxUserId), fetch
 *      the genuine headshot / full-body render from Roblox so the profile shows
 *      the actual character. Real data, not a placeholder.
 *   2. Otherwise build the view from the user's own saved `currentlyWearing`
 *      inventory, resolving each item's real Roblox name/thumbnail by asset id.
 *
 * Always returns a shape the view can render; every network call is best-effort
 * and falls back to null so a Roblox outage never breaks the page.
 */
async function resolveProfileAvatar(user) {
  const result = {
    headshotUrl: null,
    fullBodyUrl: null,
    equipped: [],
    robloxUserId: null,
  };

  const linkedId = Number(user && user.robloxUserId);
  if (Number.isFinite(linkedId) && linkedId > 0) {
    result.robloxUserId = linkedId;
    const [headshot, fullBody] = await Promise.all([
      robloxApi.getAvatarHeadshotUrl(linkedId, '150x150'),
      robloxApi.getAvatarFullBodyUrl(linkedId, '420x420'),
    ]);
    result.headshotUrl = headshot;
    result.fullBodyUrl = fullBody;
  }

  const wearing = Array.isArray(user && user.currentlyWearing) ? user.currentlyWearing : [];
  const assets = getAssets();

  const equipped = await Promise.all(wearing.map(async (rawId) => {
    const id = Number(rawId);
    const local = assets[String(rawId)] || (Number.isFinite(id) ? assets[String(id)] : null);

    // Prefer the real Roblox asset record (name + thumbnail) when the id is a
    // genuine Roblox asset id; fall back to the locally stored item.
    const details = Number.isFinite(id) && id > 0 ? await robloxApi.getAssetDetails(id) : null;
    const thumbnail = Number.isFinite(id) && id > 0 ? await robloxApi.getAssetThumbnailUrl(id) : null;

    if (!details && !local) return null;

    return {
      id,
      name: (details && details.name) || (local && local.name) || `Asset ${id}`,
      assetType: (local && (local.assetType || local.className)) || 'Asset',
      thumbnailUrl: thumbnail,
      price: details ? details.price : Number((local && local.price) || 0),
      creatorName: (details && details.creator && details.creator.name) || (local && local.creatorName) || null,
    };
  }));

  result.equipped = equipped.filter(Boolean);
  return result;
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

/**
 * Remove duplicate accounts that share a username, keeping the one a person can
 * actually sign in with.
 *
 * The data file historically held two "tailsthehero10" records (ids 1 and 2) - one
 * with a password hash, one without. Whichever a lookup happened to reach first
 * decided whether sign-in worked, which is why login looked broken. This keeps
 * the record with a credential (newest hash first, then the owner id), re-points
 * the loser's key to it so existing sessions keep resolving, and drops the rest.
 *
 * Idempotent: running it on already-unique data does nothing.
 */
function dedupeUsersByUsername() {
  const users = getUsers();
  const keys = Object.keys(users);
  if (keys.length === 0) return 0;

  const survivorFor = new Map();
  for (const key of keys) {
    const user = users[key];
    if (!user || typeof user !== 'object') continue;
    const name = String(user.username || user.displayName || '').trim().toLowerCase();
    if (!name) continue;

    const current = survivorFor.get(name);
    if (!current) {
      survivorFor.set(name, key);
      continue;
    }

    const a = users[current];
    const credentialOf = (u) => (u.password && u.passwordSalt ? 1 : 0);
    const better = credentialOf(user) - credentialOf(a) > 0
      || (credentialOf(user) === credentialOf(a)
        && Number(user.passwordVersion || 0) > Number(a.passwordVersion || 0))
      || (credentialOf(user) === credentialOf(a)
        && Number(user.passwordVersion || 0) === Number(a.passwordVersion || 0)
        && String(user.userId || '') === OWNER_USER_ID);

    survivorFor.set(name, better ? key : current);
  }

  let removed = 0;
  for (const key of keys) {
    const user = users[key];
    if (!user || typeof user !== 'object') continue;
    const name = String(user.username || user.displayName || '').trim().toLowerCase();
    if (!name) continue;
    const survivor = survivorFor.get(name);
    if (survivor && survivor !== key) {
      delete users[key];
      removed += 1;
    }
  }

  if (removed > 0) {
    // Re-key the surviving records by their own userId so keys and ids stay in
    // step, and any stale reference to a removed key cannot resurrect it.
    const compacted = {};
    for (const user of Object.values(users)) {
      const id = String(user.userId || user.id || Object.keys(compacted).length + 1);
      compacted[id] = { ...user, userId: id };
    }
    writeJson(usersPath, compacted);
    console.log(`[luckyblox] removed ${removed} duplicate account record(s) sharing a username`);
  }

  return removed;
}

function ensureSeedData() {
  if (!fs.existsSync(usersPath)) {
    writeJson(usersPath, createDefaultUsers());
  }

  // Migrate any legacy plaintext password to a salted hash at boot. The login
  // route only accepts salted hashes, so without this the default account (and
  // any account created before hashing) can never sign in — and on a fresh
  // container the seed data is regenerated every deploy, so this must run here
  // rather than relying on someone calling /luckblox-salt-setup by hand.
  upgradeLegacyPasswords();

  // Let the owner password come from the environment so it never has to be
  // committed to the repository. Set LUCKYBLOX_OWNER_PASSWORD on the host and it
  // is hashed and applied to the owner account at boot.
  applyOwnerPasswordFromEnv();

  // Collapse duplicate usernames so a lookup can never land on a record without
  // a credential (see getUserByUsername).
  dedupeUsersByUsername();

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

/**
 * Hash every stored password that is still plaintext / unsalted so login works.
 * Mirrors /luckblox-salt-setup but runs automatically on startup. Returns how
 * many accounts were upgraded.
 */
function upgradeLegacyPasswords() {
  const users = getUsers();
  let upgraded = 0;
  for (const id of Object.keys(users)) {
    const user = users[id];
    if (user && user.password && user.password.length < 64 && !user.passwordSalt) {
      upgradePassword(user);
      upgraded += 1;
    }
  }
  if (upgraded > 0) {
    console.log(`[luckyblox] upgraded ${upgraded} legacy plaintext password(s) to salted hashes`);
  }
  return upgraded;
}

/**
 * Apply the owner password supplied through LUCKYBLOX_OWNER_PASSWORD (or its
 * LUCKYBLOX_OWNER_PASSWORD_SALT companion) to the owner account. Keeping the
 * credential in an environment variable means it is never stored in the repo,
 * which matters because this project's data files are public on GitHub.
 *
 * Runs on every boot and re-hashes only when the configured password does not
 * already match, so a redeploy is idempotent. Returns true when it changed the
 * stored credential.
 */
function applyOwnerPasswordFromEnv() {
  const password = process.env.LUCKYBLOX_OWNER_PASSWORD;
  if (!password) {
    return false;
  }

  const users = getUsers();
  const owner = users[OWNER_USER_ID];
  if (!owner) {
    console.warn(`[luckyblox] LUCKYBLOX_OWNER_PASSWORD set but owner id ${OWNER_USER_ID} was not found`);
    return false;
  }

  if (owner.password && owner.passwordSalt && verifyPassword(password, owner.password, owner.passwordSalt)) {
    return false;
  }

  const { hash, salt, version } = hashPassword(password);
  owner.password = hash;
  owner.passwordSalt = salt;
  owner.passwordVersion = version;
  owner.updatedAt = new Date().toISOString();
  users[OWNER_USER_ID] = owner;
  writeJson(usersPath, users);
  console.log(`[luckyblox] applied owner password for ${owner.username || OWNER_USER_ID} from LUCKYBLOX_OWNER_PASSWORD`);
  return true;
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
  const matches = Object.values(users).filter((user) => {
    if (!user || typeof user !== 'object') {
      return false;
    }

    const usernameValue = String(user.username || user.displayName || '').trim().toLowerCase();
    return usernameValue === target;
  });

  if (matches.length === 0) {
    return null;
  }

  // Usernames are unique in practice, but the data file can contain more than
  // one record for the same name (it did: two "tailsthehero10" entries, one with
  // a password and one without). A plain first-match lookup then resolves to an
  // account that cannot sign in at all - the login reports "no credential set"
  // even though a valid credential for that username exists.
  //
  // Prefer an account that actually has a stored credential, then the
  // highest-version (newest) hash, then the owner id, so sign-in always lands on
  // the record the user can really log into.
  const found = matches.slice().sort((a, b) => {
    const credentialOf = (u) => (u.password && u.passwordSalt ? 1 : 0);
    const credentialDiff = credentialOf(b) - credentialOf(a);
    if (credentialDiff !== 0) return credentialDiff;

    const versionDiff = Number(b.passwordVersion || 0) - Number(a.passwordVersion || 0);
    if (versionDiff !== 0) return versionDiff;

    const ownerA = String(a.userId || a.id || '') === OWNER_USER_ID ? 1 : 0;
    const ownerB = String(b.userId || b.id || '') === OWNER_USER_ID ? 1 : 0;
    return ownerB - ownerA;
  })[0];

  return getUser(found.userId || found.id || 1);
}

/**
 * Push a signed-in account into the client-visible local state so the launcher,
 * Studio and the game clients read the same identity the site session holds.
 *
 * The clients do not read users.json directly - they read:
 *   Settings/username.txt              (current username)
 *   Settings/membership.txt            (current membership)
 *   Settings/users/<username>.json     (per-user profile)
 * This mirrors what the PHP auth.php / account.php endpoints write, so signing
 * up or signing in on the site is immediately visible to both clients.
 */
/**
 * Build the full record for a brand-new account, shaped the way a Roblox
 * profile is shaped (https://www.roblox.com/users/1/profile): identity, social
 * counters, currently-wearing, a starter inventory and a welcome badge. This
 * keeps Node signups identical to the PHP lb_build_new_user_record() record.
 */
/**
 * Assemble a YYYY-MM-DD birthday from the three Roblox-style dropdowns
 * (birthMonth / birthDay / birthYear). Falls back to a single birthday field so
 * older forms and API clients keep working. Returns null when incomplete.
 */
function assembleBirthday(body) {
  const source = body || {};
  if (source.birthday && /^\d{4}-\d{2}-\d{2}$/.test(String(source.birthday))) {
    return String(source.birthday);
  }
  const month = Number(source.birthMonth);
  const day = Number(source.birthDay);
  const year = Number(source.birthYear);
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= new Date().getFullYear()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

function buildNewUserRecord({ userId, username, displayName, passwordHash, passwordSalt, passwordVersion, gender, birthday }) {
  const now = new Date().toISOString();
  const starterInventory = ['1001', '1002', '1003', '1004'];
  const starterWearing = ['1001', '1002', '1003'];
  const safeBirthday = typeof birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null;
  const bodyColors = {
    headColorId: 1002,
    torsoColorId: 1002,
    rightArmColorId: 1002,
    leftArmColorId: 1002,
    rightLegColorId: 1002,
    leftLegColorId: 1002,
  };

  return {
    userId: String(userId),
    username,
    displayName: displayName || username,
    gender: gender || 'NotSpecified',
    password: passwordHash,
    passwordSalt,
    passwordVersion,
    role: 'player',
    bio: "Hi, I'm new to LuckyBlox!",
    joinDate: now,
    created: now,
    birthday: safeBirthday,
    membershipStatus: 'Premium',
    membership: 'Premium',
    robux: 100,
    currencies: { robux: 100, coins: 250, tickets: 10 },
    inventory: starterInventory,
    currentlyWearing: starterWearing,
    wearing: starterWearing,
    stats: { friends: 0, following: 0, created: 0, plays: 0, followers: 0, badges: 1, gameVisits: 0 },
    friends: [],
    following: [],
    followers: [],
    badges: [
      { id: 'welcome', name: 'Welcome to LuckyBlox', description: 'Joined LuckyBlox', icon: 'W', earnedDate: now },
    ],
    avatar: {
      gender: gender || 'NotSpecified',
      playerAvatarType: 'R15',
      scales: { height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 },
      bodyColors,
      currentlyWearing: starterWearing,
    },
    profileUrl: `/users/${userId}/profile`,
    updatedAt: now,
  };
}

function syncLocalIdentity(user) {
  if (!user || typeof user !== 'object') {
    return false;
  }

  const username = String(user.username || user.displayName || '').trim();
  if (!username) {
    return false;
  }
  const settingsRoot = path.join(releaseRoot, 'Settings');
  try {
    fs.mkdirSync(settingsRoot, { recursive: true });

    const membership = String(user.membershipStatus || user.membership || 'None') || 'None';
    fs.writeFileSync(path.join(settingsRoot, 'username.txt'), username);
    fs.writeFileSync(path.join(settingsRoot, 'membership.txt'), membership);

    const userId = String(user.userId || user.id || '1');
    const role = String(user.role || 'player') || 'player';
    const profile = {
      userId,
      username,
      displayName: String(user.displayName || username),
      membership,
      membershipStatus: membership,
      role,
      isAdmin: Boolean(user.admin || user.isAdmin || role === 'owner' || role === 'admin'),
      studioAccess: true,
      authenticated: true,
      robloxUserId: user.robloxUserId || null,
      robux: Number(user.robux) || 0,
      currencies: user.currencies && typeof user.currencies === 'object' ? user.currencies : {},
      inventory: Array.isArray(user.inventory) ? user.inventory : [],
      currentlyWearing: Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [],
      avatar: user.avatar && typeof user.avatar === 'object' ? user.avatar : {},
      gender: user.gender || (user.avatar && user.avatar.gender) || 'NotSpecified',
      joinDate: user.joinDate || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const usersDir = path.join(settingsRoot, 'users');
    fs.mkdirSync(usersDir, { recursive: true });

    const safeName = username.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'user';
    fs.writeFileSync(path.join(usersDir, `${safeName}.json`), JSON.stringify(profile, null, 2));
    fs.writeFileSync(path.join(usersDir, `id-${userId}.json`), JSON.stringify(profile, null, 2));

    return true;
  } catch (error) {
    return false;
  }
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
  const targetId = String(userId);
  const targetName = String(currentUser.username || '').toLowerCase();
  const isOwnerId = targetId === OWNER_USER_ID;

  const seen = new Set();
  const results = [];

  function add(entry) {
    const placeId = Number(entry.placeId || entry.universeId || 0);
    if (!placeId || seen.has(placeId)) {
      return;
    }
    seen.add(placeId);
    results.push(entry);
  }

  // 1. Places the user explicitly authored in places.json.
  getPublishedPlaces().forEach((entry) => {
    const matchesAuthor = String(entry.authorId) === targetId;
    const matchesUsername = String(entry.author).toLowerCase() === targetName;
    const isDefaultOwner = isOwnerId && (entry.author === 'LuckyBlox Studio' || entry.author === 'LocalPlayer');
    if (matchesAuthor || matchesUsername || isDefaultOwner) {
      add(entry);
    }
  });

  // 2. Real games from the games catalogue.
  //
  //    Only games this account actually owns are listed. It used to hand the
  //    owner (and anyone) every game on the server, which put all 48 map-derived
  //    experiences on every profile and made the panel look broken. A profile
  //    shows a person's own creations, so match on author id or developer name.
  const games = getGames();
  Object.values(games).forEach((game) => {
    const placeId = Number(game.placeId || 0);
    if (!placeId) {
      return;
    }
    const developer = String(game.developer || '').toLowerCase();
    const ownsIt = developer === targetName
      || String(game.authorId || '') === targetId
      || (isOwnerId && String(game.authorId || '') === String(OWNER_USER_ID));
    if (ownsIt) {
      add({
        placeId,
        universeId: placeId,
        name: game.title || `Game ${placeId}`,
        description: game.description || '',
        author: game.developer || currentUser.username,
        authorId: Number(userId),
        fileName: game.mapFile || `${game.title || placeId}.rbxl`,
        coverUrl: game.icon || '',
        genre: game.genre || 'Adventure',
        playerCount: Number(game.playerCount || 0),
        publishedAt: game.updatedAt || new Date().toISOString(),
      });
    }
  });

  return results;
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
    // Admin badge. When the account is an admin, the client shows the Roblox
    // admin icon next to the username. These are the fields the client checks.
    isVerified: isAdminUser(user),
    isAdmin: isAdminUser(user),
    adminBadgeUrl: isAdminUser(user) && getAdminBadge(user) && getAdminBadge(user).hasImage
      ? `${publicOrigin}/assets/roles/admin.png`
      : null,
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
installStudioApiRoutes(app, { resolveUser: (userId) => getUser(userId) });
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

// ---------------------------------------------------------------------------
// Live preview mode
// ---------------------------------------------------------------------------
// While the site is being finished we do not want the full product exposed.
// Preview mode keeps a single, self-contained page live so the deployment can
// be seen working, while every other page (and navigation) is withheld.
//
//   LUCKYBLOX_PREVIEW_MODE=on   -> force preview on  (placeholder page only)
//   LUCKYBLOX_PREVIEW_MODE=off  -> force preview off (site is finished/public)
//   unset                       -> defaults to OFF: the real site is served
//
// The default is OFF because the deployment is live and has to serve the real
// site and the client endpoints. A stale/unset env var on the host must never
// silently turn the whole site into a placeholder again; preview is now opt-in
// via LUCKYBLOX_PREVIEW_MODE=on.
const PREVIEW_MODE = String(process.env.LUCKYBLOX_PREVIEW_MODE || 'off').toLowerCase() === 'on';
const PREVIEW_STAGE = String(process.env.LUCKYBLOX_PREVIEW_STAGE || 'In development');
const PREVIEW_TEASERS = [
  'Account system',
  'Friends & presence',
  'Robux & currency',
  'Experience catalog',
  'Creator hub',
  'Server job IDs',
  'Asset pipeline',
  'Studio tooling',
];

// Paths that must keep working even while preview mode is on, because the
// running server and the launcher clients depend on them.
const PREVIEW_ALLOWLIST = [
  /^\/health$/,
  /^\/api\/preview-status$/,
  /^\/preview$/,
  // Owner control panel + admin API must survive preview mode, otherwise the
  // owner is locked out of their own open/close switch on a live deployment.
  /^\/sitestat/,
  /^\/api\/site-status$/,
  /^\/api\/admin\//,
  // Auth/session endpoints: the owner has to be able to sign in to reach the
  // control panel, and the launcher client logs in through the same routes.
  /^\/api\/login$/,
  /^\/api\/logout$/,
  /^\/api\/v1\/me$/,
  /^\/api\/account\//,
  /^\/css\//,
  /^\/fonts\//,
  /^\/assets\//,
  /^\/asset\//i,
  /^\/v1\/asset/i,
  /^\/v1\/assets\//,
  /^\/ClientSettings/,
  /^\/AppSettings\.xml$/,
  /^\/v1\//,
  /^\/Login\//,
  /^\/game\//,
  /^\/api\/launch-game$/,
  /^\/api\/servers$/,
  /^\/api\/jobs\//,
  /^\/studio\//,
  /^\/legacy-nav\.js$/,
];

function isPreviewAllowed(reqPath) {
  return PREVIEW_ALLOWLIST.some((rx) => rx.test(reqPath));
}

/** Real status for the preview page — computed from live server state. */
function getPreviewStatus() {
  let players = 0;
  for (const server of activeGameServers) {
    players += Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0;
  }

  let games = 0;
  try {
    games = Object.keys(getGames()).length;
  } catch (error) {
    games = 0;
  }

  return {
    ok: true,
    preview: true,
    stage: PREVIEW_STAGE,
    players,
    games,
    uptimeSeconds: Math.round(process.uptime()),
    at: new Date().toISOString(),
  };
}

app.get('/api/preview-status', (req, res) => {
  res.json(getPreviewStatus());
});

app.get('/preview', (req, res) => {
  res.render('preview', {
    title: 'LuckyBlox — Live Preview',
    stage: PREVIEW_STAGE,
    teasers: PREVIEW_TEASERS,
  });
});

// ---------------------------------------------------------------------------
// Site status — public status page + owner open/close controls
// ---------------------------------------------------------------------------
// The owner can flip the site between open, work in progress, maintenance and
// closed without editing code or redeploying. /sitestat always shows the real
// current status, whether or not the site is open.

/**
 * Format an ISO timestamp as a stable, locale-independent string.
 * toLocaleString() renders in the *server's* locale (which produced Arabic
 * numerals and RTL marks on a UTC box), so build the string explicitly.
 */
function formatStatusTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * Format an ISO date as a stable, locale-independent day/month/year string.
 *
 * toLocaleDateString() renders in the *server's* locale, which produced Arabic
 * numerals and an Islamic-calendar suffix on a UTC box. Build the string
 * explicitly so every visitor sees the same thing.
 */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Shared shape so the page, the sidebar and the API all agree. */
function siteStatusPayload() {
  const s = siteStatus.get();
  return {
    ok: true,
    status: s.id,
    label: s.label,
    open: s.open,
    closed: !s.open,
    headline: s.headline,
    detail: s.detail,
    note: s.note,
    updatedAt: s.updatedAt,
    updatedAtDisplay: formatStatusTime(s.updatedAt),
    updatedBy: s.updatedBy,
    source: s.source,
    readError: s.readError || null,
    checkedAt: new Date().toISOString(),
  };
}

app.get('/api/site-status', (req, res) => {
  res.json(siteStatusPayload());
});

// Public status page. Works whether the site is open or closed.
app.get('/sitestat', (req, res) => {
  const user = req.sessionUser || null;
  res.render('sitestat', {
    title: 'LuckyBlox — Site status',
    status: siteStatusPayload(),
    user,
    isOwner: Boolean(user && isOwnerUser(user)),
    canControl: Boolean(user && isOwnerUser(user)),
    validStatuses: Object.values(siteStatus.STATUSES).map((s) => ({ id: s.id, label: s.label })),
    saved: req.query.saved === '1',
    error: req.query.error || '',
  });
});

// Owner-only: change the site status.
app.post('/api/site-status', requireOwner, (req, res) => {
  const statusId = String(req.body.status || req.query.status || '').trim();
  const note = String(req.body.note || req.query.note || '').trim();
  const result = siteStatus.set(statusId, {
    note,
    updatedBy: (req.sessionUser && (req.sessionUser.username || req.sessionUser.userId)) || 'owner',
  });

  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error, valid: result.valid || siteStatus.VALID_IDS });
  }

  audit('site_status_changed', {
    ip: security.clientIp(req),
    status: statusId,
    by: String((req.sessionUser && req.sessionUser.userId) || ''),
  });

  return res.json({ ok: true, ...siteStatusPayload() });
});

// Owner control panel (form-based, so it works without JavaScript).
app.post('/sitestat/set', requireOwner, (req, res) => {
  const statusId = String(req.body.status || '').trim();
  const note = String(req.body.note || '').trim();
  const result = siteStatus.set(statusId, {
    note,
    updatedBy: (req.sessionUser && (req.sessionUser.username || req.sessionUser.userId)) || 'owner',
  });

  if (!result.ok) {
    return res.redirect('/sitestat?error=' + encodeURIComponent(result.error));
  }

  audit('site_status_changed', {
    ip: security.clientIp(req),
    status: statusId,
    by: String((req.sessionUser && req.sessionUser.userId) || ''),
    via: 'form',
  });

  return res.redirect('/sitestat?saved=1');
});

// Gate: when the site is closed, every non-essential page shows the closed
// notice instead of content. /sitestat, assets and the launcher APIs stay up so
// the status is always visible and clients keep working.
app.use((req, res, next) => {
  const state = siteStatus.get();
  if (state.open) {
    return next();
  }

  if (siteStatus.isAlwaysOpen(req.path)) {
    return next();
  }

  const wantsJson = req.path.startsWith('/api/')
    || req.path.startsWith('/v1/')
    || (req.headers.accept || '').includes('application/json');

  if (wantsJson) {
    return res.status(503).json({
      ok: false,
      error: 'site-closed',
      status: state.id,
      message: state.headline,
      detail: state.detail,
    });
  }

  return res.status(503).render('closed', {
    title: 'LuckyBlox — ' + state.label,
    status: siteStatusPayload(),
  });
});

// Gate: while preview mode is on, send every non-allowlisted page to /preview.
// Applied before any real content route so nothing leaks through.
app.use((req, res, next) => {
  if (!PREVIEW_MODE) {
    return next();
  }

  if (isPreviewAllowed(req.path)) {
    return next();
  }

  // API and client-protocol requests get a clean JSON refusal rather than HTML.
  const wantsJson = req.path.startsWith('/api/')
    || req.path.startsWith('/v1/')
    || (req.headers.accept || '').includes('application/json');

  if (wantsJson) {
    return res.status(503).json({
      ok: false,
      error: 'preview-mode',
      message: 'LuckyBlox is still being finished. Public access opens soon.',
    });
  }

  return res.redirect('/preview');
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
  destroySession(cookieMap.luckblox_session);
  audit('signout', { ip: security.clientIp(req), sessionId: cookieMap.luckblox_session || null });
  res.clearCookie('luckblox_session');
  const redirect = req.query.redirect || '/signin';
  res.redirect(redirect);
});

app.post('/logout', (req, res) => {
  const cookieMap = parseCookieHeader(req.headers.cookie || '');
  destroySession(cookieMap.luckblox_session);
  audit('signout', { ip: security.clientIp(req), sessionId: cookieMap.luckblox_session || null });
  res.clearCookie('luckblox_session');
  res.redirect(req.query.redirect || '/signin');
});

// Friendly alias so /signout works the way users expect.
app.get('/signout', (req, res) => res.redirect('/logout' + (req.query.redirect ? `?redirect=${encodeURIComponent(req.query.redirect)}` : '')));

app.post('/signup', requireCsrf, (req, res) => {
  const ip = security.clientIp(req);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const displayName = String(req.body.displayName || username || '').trim();

  const renderError = (status, message) => res.status(status).render('signup', {
    title: 'Create account - LuckyBlox',
    errorMessage: message,
    username,
    basePath: res.locals.basePath || '',
  });

  // Rate limit account creation per IP: 5 per hour.
  const rl = security.rateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    audit('signup_rate_limited', { ip, username });
    return renderError(429, `Too many accounts created from this network. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} minute(s).`);
  }

  const usernameCheck = security.checkUsernamePolicy(username);
  if (!usernameCheck.ok) {
    return renderError(400, usernameCheck.errors[0]);
  }

  if (password !== confirmPassword) {
    return renderError(400, 'Passwords do not match.');
  }

  const policy = security.checkPasswordPolicy(password);
  if (!policy.ok) {
    return renderError(400, policy.errors[0]);
  }

  const users = getUsers();
  const exists = Object.values(users).some((user) => String(user.username || user.displayName || '').toLowerCase() === username.toLowerCase());
  if (exists) {
    return renderError(409, 'That username is already taken.');
  }

  const nextId = Math.max(1, ...Object.values(users).map((user) => Number(user.userId || user.id || 1))) + 1;
  const { hash, salt, version } = hashPassword(password);
  const created = buildNewUserRecord({
    userId: nextId,
    username,
    displayName,
    passwordHash: hash,
    passwordSalt: salt,
    passwordVersion: version,
    gender: String(req.body.gender || 'NotSpecified'),
    birthday: assembleBirthday(req.body),
  });

  users[String(nextId)] = created;
  writeJson(usersPath, users);
  applySessionCookie(res, nextId, req);
  syncLocalIdentity(created);
  audit('signup_success', { ip, userId: String(nextId), username });
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
  const { hash, salt, version } = hashPassword(password);
  const created = buildNewUserRecord({
    userId: nextId,
    username,
    displayName,
    passwordHash: hash,
    passwordSalt: salt,
    passwordVersion: version,
    gender: String(req.body.gender || 'NotSpecified'),
    birthday: assembleBirthday(req.body),
  });

  users[String(nextId)] = created;
  writeJson(usersPath, users);
  applySessionCookie(res, nextId);
  syncLocalIdentity(created);
  return res.json({ ok: true, userId: String(nextId), username, displayName: created.displayName });
});

app.post('/signin', requireCsrf, (req, res) => {
  const ip = security.clientIp(req);
  const username = String(req.body.username || req.body.userName || '').trim();
  const password = String(req.body.password || '');

  const renderError = (status, message) => res.status(status).render('signin', {
    title: 'Sign in - LuckyBlox',
    errorMessage: message,
    redirect: req.body.redirect || '',
    username,
    hintMessage: '',
    basePath: res.locals.basePath || '',
  });

  // Rate limit sign-in attempts per IP (20 / 15 min) and per username (10 / 15 min).
  const ipLimit = security.rateLimit(`signin:ip:${ip}`, 20, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    audit('signin_rate_limited_ip', { ip, username });
    return renderError(429, `Too many sign-in attempts. Try again in ${Math.ceil(ipLimit.retryAfterMs / 60000)} minute(s).`);
  }
  const userLimit = security.rateLimit(`signin:user:${username.toLowerCase()}`, 10, 15 * 60 * 1000);
  if (!userLimit.allowed) {
    audit('signin_rate_limited_user', { ip, username });
    return renderError(429, 'Too many attempts for this account. Please wait a few minutes.');
  }

  // Account lockout after repeated failures.
  const lock = security.getLockoutState(username);
  if (lock.locked) {
    audit('signin_locked_out', { ip, username });
    return renderError(423, `This account is temporarily locked. Try again in ${Math.ceil(lock.retryAfterMs / 60000)} minute(s).`);
  }

  const user = getUserByUsername(username);

  if (!user) {
    security.registerFailedLogin(username);
    audit('signin_user_not_found', { ip, username });
    return renderError(401, 'We could not find that account. Try creating one first.');
  }

  // Support the current v3 hash, the legacy v2 hash, and very old plaintext.
  let valid = false;
  if (user.passwordSalt && user.password) {
    valid = verifyPassword(password, user.password, user.passwordSalt);
  } else if (user.password) {
    valid = String(user.password) === password;
  }

  if (!valid) {
    const state = security.registerFailedLogin(username);
    audit('signin_bad_password', { ip, username, failures: state.failures });
    return renderError(401, 'That password is incorrect.');
  }

  // Successful login: upgrade old hashes, clear limits, start a fresh session.
  if (user.passwordVersion !== security.HASH_VERSION) {
    upgradePassword(user);
  }
  security.clearLockout(username);
  security.clearRateLimit(`signin:user:${username.toLowerCase()}`);

  const { csrfToken } = applySessionCookie(res, user.userId || user.id || 1, req);
  // Refresh the client-visible local identity so the launcher and clients load
  // the signed-in account (inventory / avatar / membership) immediately.
  syncLocalIdentity(user);
  audit('signin_success', { ip, userId: String(user.userId || user.id), username });

  // If this sign-in came from a Studio handshake, link the account to it so the
  // 2022M Studio client picks up the session automatically.
  const studioNonce = String(req.body.studio || req.query.studio || '');
  if (studioNonce) {
    completeStudioHandshake(studioNonce, user.userId || user.id || 1);
    audit('studio_handshake_linked', { ip, userId: String(user.userId || user.id), nonce: studioNonce });
  }

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

  if (user.passwordSalt && user.password) {
    if (!verifyPassword(password, user.password, user.passwordSalt)) {
      return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
    }
  } else if (user.password && user.password !== password) {
    return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
  }

  if (Number(user.passwordVersion || 0) !== security.HASH_VERSION) {
    upgradePassword(user);
  }

  applySessionCookie(res, user.userId || user.id || 1);
  syncLocalIdentity(user);
  return res.json({ ok: true, userId: user.userId || user.id, username: user.username, displayName: user.displayName });
});

app.post('/luckblox.site.tk/signin', (req, res) => {
  const username = String(req.body.username || req.body.userName || '').trim();
  const password = String(req.body.password || '').trim();
  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ ok: false, error: 'user-not-found', message: 'We could not find that account.' });
  }

  if (user.passwordSalt && user.password) {
    if (!verifyPassword(password, user.password, user.passwordSalt)) {
      return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
    }
  } else if (user.password && user.password !== password) {
    return res.status(401).json({ ok: false, error: 'invalid-password', message: 'Incorrect password.' });
  }

  if (Number(user.passwordVersion || 0) !== security.HASH_VERSION) {
    upgradePassword(user);
  }

  applySessionCookie(res, user.userId || user.id || 1);
  syncLocalIdentity(user);
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

app.get('/profile', async (req, res) => {
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
    adminBadge: getAdminBadge(user),
    games: publishedGames,
    profileAvatar: await resolveProfileAvatar(user),
  });
});

app.get('/profile/:userId', async (req, res) => {
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
    adminBadge: getAdminBadge(user),
    games: publishedGames,
    profileAvatar: await resolveProfileAvatar(user),
  });
});

app.get('/users/:id/profile', async (req, res) => {  const userId = req.params.id || 1;
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
    adminBadge: getAdminBadge(user),
    games: publishedGames,
    profileAvatar: await resolveProfileAvatar(user),
  });
});

app.get('/account', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = req.query.userId || (sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const publishedGames = getPublicGamesForUser(userId);
  const adminBadge = getAdminBadge(user);

  res.render('account', {
    title: `${user.username} Account`,
    user,
    assets,
    // Real values for the account summary - the view used to hardcode these.
    publishedGames,
    currency: getCurrencyForUser(user),
    adminBadge,
    isAdmin: isAdminUser(user),
  });
});

app.get('/friends', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || 1);
  const user = getUser(userId);
  const friendUsers = getFriendsForUser(userId);

  res.render('friends', {
    title: 'Friends',
    user,
    friends: friendUsers,
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

/**
 * Owner-only gate. Any route wrapped with this only runs for the deployment
 * owner (ID 1 / tailsthehero10). Everyone else gets 403 — enforced server-side,
 * not just hidden in the UI.
 */
function requireOwner(req, res, next) {
  const user = req.sessionUser;
  if (!user) {
    return res.status(401).json({ ok: false, error: 'auth-required', message: 'Sign in first.' });
  }
  if (!isOwnerUser(user)) {
    audit('owner_route_denied', {
      ip: security.clientIp(req),
      userId: String(user.userId || user.id),
      path: req.path,
    });
    return res.status(403).json({ ok: false, error: 'owner-only', message: 'This area is restricted to the server owner.' });
  }
  return next();
}

/**
 * Owner diagnostics. Real server state: active jobs, uptime, storage mode,
 * security posture. This is the one place where the owner can see the internals.
 */
app.get('/api/admin/overview', requireOwner, (req, res) => {
  const store = storage.describeStorage();
  const users = getUsers();

  res.json({
    ok: true,
    owner: {
      userId: String(req.sessionUser.userId || req.sessionUser.id),
      username: req.sessionUser.username,
    },
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      publicBaseUrl,
      previewMode: PREVIEW_MODE,
      previewStage: PREVIEW_STAGE,
    },
    storage: store,
    counts: {
      users: Object.keys(users).length,
      sessions: activeSessions.size,
      tickets: activeTickets.size,
      jobs: activeGameServers.length,
      players: getTotalPlayerCount(),
      games: Object.keys(getGames()).length,
      assets: Object.keys(getAssets()).length,
    },
    jobs: activeGameServers.map((server) => ({
      jobId: server.serverJobId,
      placeId: Number(server.placeId),
      port: Number(server.port),
      playerCount: Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0,
      maxPlayers: Number(server.maxPlayers || 20),
      status: server.status || 'running',
      startedAt: server.startedAt,
    })),
  });
});

/** Owner-only: revoke every active session (useful after a suspected leak). */
app.post('/api/admin/revoke-sessions', requireOwner, (req, res) => {
  const count = activeSessions.size;
  activeSessions.clear();
  persistSessions();
  audit('owner_revoked_all_sessions', { count, by: String(req.sessionUser.userId) });
  res.json({ ok: true, revoked: count });
});

/** Owner-only: grant or update a user's role. */
app.post('/api/admin/set-role', requireOwner, (req, res) => {
  const targetId = String(req.body.userId || req.body.userid || '');
  const role = String(req.body.role || '').toLowerCase();
  const allowed = ['player', 'creator', 'moderator', 'owner'];

  if (!targetId || !allowed.includes(role)) {
    return res.status(400).json({ ok: false, error: 'invalid-request', message: `Role must be one of: ${allowed.join(', ')}.` });
  }

  const users = getUsers();
  if (!users[targetId]) {
    return res.status(404).json({ ok: false, error: 'user-not-found' });
  }

  users[targetId].role = role;
  users[targetId].updatedAt = new Date().toISOString();
  writeJson(usersPath, users);
  audit('owner_set_role', { targetId, role, by: String(req.sessionUser.userId) });

  res.json({ ok: true, userId: targetId, role });
});

app.get('/studio', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = req.query.userId || (sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
  const user = getUser(userId);
  const places = Object.values(getGames()).map((game) => ({
    placeId: Number(game.placeId || 1818),
    name: game.title || 'LuckyBlox Place',
    description: game.description || 'Local Studio place',
  }));

  res.render('studio', {
    title: 'LuckyBlox Studio',
    user,
    places,
    // Real account facts so the page stops hardcoding "Role: Creator" etc.
    currency: getCurrencyForUser(user),
    isAdmin: isAdminUser(user),
    adminBadge: getAdminBadge(user),
    // Studio 2022M connection details so the page can show the real host:port
    // the desktop client connects to, instead of a hardcoded value.
    studioHost: gameServerHost,
    studioPort: gamePort,
    assets: Object.values(getAssets()).map((asset) => ({
      id: Number(asset.id || asset.assetId) || 0,
      name: asset.name || 'Asset',
      assetType: asset.assetType || asset.className || 'Model',
    })),
  });
});

/**
 * Creator Hub — the LuckyBlox equivalent of create.roblox.com. Shows the real
 * experiences and assets belonging to the signed-in account, plus live counts.
 * Guests can view it but publishing actions prompt them to sign in.
 */
app.get('/develop', (req, res) => {
  const sessionUser = req.sessionUser;
  const userId = sessionUser ? (sessionUser.userId || sessionUser.id || 1) : (req.query.userId || 1);
  const user = getUser(userId);
  const isOwner = isOwnerUser(user);
  const signedIn = Boolean(sessionUser);

  // Real places from the store, annotated with their own game stats.
  const placesRecords = readJson(placesPath, {});
  const allGames = getGames();
  const places = Object.values(placesRecords)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const placeId = Number(entry.placeId || entry.universeId || 1818);
      const game = allGames[String(placeId)] || {};
      return {
        placeId,
        name: entry.name || game.title || `Place ${placeId}`,
        description: entry.description || game.description || '',
        visibility: String(entry.visibility || 'Public'),
        visits: Number(game.playerCount || game.visits || 0),
        authorId: Number(entry.authorId || 1),
      };
    })
    // Own experiences first; the owner sees everything.
    .filter((place) => isOwner || !signedIn || place.authorId === Number(userId));

  const assets = Object.values(getAssets()).map((asset) => ({
    id: Number(asset.id || asset.assetId) || 0,
    name: asset.name || 'Asset',
    assetType: asset.assetType || asset.className || 'Model',
    price: Number(asset.price || 0),
    creatorName: asset.creatorName || 'LuckyBlox Studio',
  }));

  const stats = {
    places: places.length,
    publicPlaces: places.filter((p) => p.visibility === 'Public').length,
    privatePlaces: places.filter((p) => p.visibility !== 'Public').length,
    assets: assets.length,
    visits: places.reduce((sum, p) => sum + Number(p.visits || 0), 0),
  };

  // Most recently updated places, for the "Recent activity" strip.
  const recent = Object.values(placesRecords)
    .filter((entry) => entry && typeof entry === 'object')
    .sort((a, b) => new Date(b.updatedAt || b.publishedAt || 0) - new Date(a.updatedAt || a.publishedAt || 0))
    .slice(0, 6)
    .map((entry) => ({
      placeId: Number(entry.placeId || entry.universeId || 1818),
      name: entry.name || `Place ${entry.placeId}`,
      updatedAt: entry.updatedAt || entry.publishedAt || '',
    }));

  res.render('develop', {
    title: 'Create - LuckyBlox',
    user,
    isOwner,
    signedIn,
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
    places: places.slice(0, 40),
    assets: assets.slice(0, 40),
    stats,
    recent,
    studioHost: gameServerHost,
    studioPort: gamePort,
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

// ---------------------------------------------------------------------------
// Studio (2022M) authentication
// ---------------------------------------------------------------------------
// Studio performs a real login handshake before it will load a place. These
// endpoints mirror what the client asks for, and they are backed by the same
// account store + session system as the website, so signing in from Studio is
// the same account you sign in with on the site.

/**
 * Studio asks for the auth URL it should open. We point it at our own site's
 * sign-in page and pass a one-time nonce so the resulting session is bound to
 * this Studio instance.
 */
app.get('/v1/studio/auth-url', (req, res) => {
  const nonce = security.generateSessionId();
  const studioSessions = getStudioHandshakes();
  studioSessions[nonce] = {
    nonce,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    client: 'studio-2022M',
    userId: null,
  };
  writeJson(studioHandshakePath, studioSessions);

  res.json({
    ok: true,
    nonce,
    authUrl: `${publicOrigin}/signin?studio=${encodeURIComponent(nonce)}`,
    expiresAt: new Date(studioSessions[nonce].expiresAt).toISOString(),
  });
});

/**
 * Studio exchange: given the nonce from the auth URL, return the account that
 * signed in and a real auth ticket Studio can use to load places.
 */
app.get('/v1/studio/authenticate', (req, res) => {
  const nonce = String(req.query.nonce || '');
  const studioSessions = getStudioHandshakes();
  const handshake = studioSessions[nonce];

  if (!handshake || Number(handshake.expiresAt) < Date.now()) {
    if (handshake) {
      delete studioSessions[nonce];
      writeJson(studioHandshakePath, studioSessions);
    }
    return res.status(401).json({ ok: false, error: 'studio-handshake-invalid', message: 'Sign in again from Studio.' });
  }

  if (!handshake.userId) {
    return res.status(202).json({ ok: false, error: 'awaiting-signin', message: 'Waiting for sign-in to complete.' });
  }

  const user = getUser(handshake.userId);
  const placeId = 1818;
  const ticket = createAuthTicket(user.userId, placeId, {
    port: gamePort,
    serverJobId: `studio-${crypto.randomUUID()}`,
  });

  audit('studio_authenticated', {
    ip: security.clientIp(req),
    userId: String(user.userId),
    nonce,
  });

  return res.json({
    ok: true,
    userId: Number(user.userId),
    username: user.username,
    displayName: user.username,
    membership: user.membershipStatus || user.membership || 'None',
    authTicket: ticket.ticket,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    isOwner: isOwnerUser(user),
  });
});

/**
 * Links a signed-in web session to a pending Studio handshake. Called by the
 * sign-in POST when `studio=<nonce>` is present, so Studio picks up the login.
 */
function completeStudioHandshake(nonce, userId) {
  if (!nonce) {
    return false;
  }
  const studioSessions = getStudioHandshakes();
  const handshake = studioSessions[nonce];
  if (!handshake || Number(handshake.expiresAt) < Date.now()) {
    return false;
  }
  handshake.userId = String(userId);
  handshake.completedAt = Date.now();
  writeJson(studioHandshakePath, studioSessions);
  return true;
}

/** Studio's own sign-in POST (used by the in-client login form if shown). */
app.post('/v1/studio/signin', requireCsrf, (req, res) => {
  const ip = security.clientIp(req);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const ipLimit = security.rateLimit(`studio-signin:${ip}`, 20, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return res.status(429).json({ ok: false, error: 'rate-limited', message: 'Too many attempts.' });
  }

  const user = getUserByUsername(username);
  if (!user || !user.password || !user.passwordSalt || !verifyPassword(password, user.password, user.passwordSalt)) {
    audit('studio_signin_failed', { ip, username });
    return res.status(401).json({ ok: false, error: 'invalid-credentials', message: 'Incorrect username or password.' });
  }

  const nonce = String(req.body.nonce || '');
  completeStudioHandshake(nonce, user.userId);
  audit('studio_signin_success', { ip, userId: String(user.userId), username });

  return res.json({ ok: true, userId: Number(user.userId), username: user.username, isOwner: isOwnerUser(user) });
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
  const username = String(req.body.username || req.body.userName || req.query.username || '');
  const password = String(req.body.password || req.body.pass || req.query.password || '');
  const users = getUsers();
  const match = Object.values(users).find((user) => String(user.username || user.displayName || '').toLowerCase() === username.toLowerCase());

  if (!match) {
    return res.status(401).json({ ok: false, error: 'invalid-credentials', message: 'Unknown username.' });
  }

  // Verify against the stored PBKDF2 hash with a constant-time compare.
  // This route previously compared a plaintext `password` field that no account
  // actually has, so the check was skipped and ANY password authenticated as
  // ANY account. Accounts missing credentials must never be signifiable.
  const hasCredential = Boolean(match.password && match.passwordSalt);
  const passwordOk = hasCredential && verifyPassword(password, match.password, match.passwordSalt);

  if (!hasCredential || !passwordOk) {
    audit('api_login_failed', {
      ip: security.clientIp(req),
      username,
      reason: hasCredential ? 'bad-password' : 'no-credential-set',
    });
    return res.status(401).json({ ok: false, error: 'invalid-credentials', message: 'Incorrect username or password.' });
  }

  const userId = Number(match.userId || match.id || 1);
  const user = serializeUser(userId);
  const ticket = createAuthTicket(userId, 1818, { port: gamePort, serverJobId: `session-${Date.now()}` });
  const sessionId = applySessionCookie(res, userId);

  audit('api_login_success', { ip: security.clientIp(req), userId: String(userId) });

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
  const placeId = Number(req.query.placeId || req.query.placeid || 0);

  // When a placeId is given, return just that place's jobs in Roblox-style shape.
  if (placeId) {
    const servers = listServersForPlace(placeId);
    return res.json({ ok: true, placeId, servers, total: servers.length });
  }

  const servers = activeGameServers.map((server) => ({
    serverJobId: server.serverJobId,
    jobId: server.serverJobId,
    placeId: Number(server.placeId || 1818),
    port: Number(server.port || gamePort),
    currentPlayers: Array.isArray(server.currentPlayers) ? server.currentPlayers : [],
    playerCount: Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0,
    maxPlayers: Number(server.maxPlayers || 20),
    status: server.status || 'running',
    startedAt: server.startedAt || new Date().toISOString(),
  }));

  res.json({ ok: true, servers, total: servers.length, totalPlayers: getTotalPlayerCount() });
});

/**
 * Roblox-style game-server listing. Clients ask this when populating the
 * "servers" list for an experience before joining one.
 */
app.get('/v1/games/:placeId/servers/Public', (req, res) => {
  const placeId = Number(req.params.placeId || req.query.placeId || 1818);
  const servers = listServersForPlace(placeId);
  const game = getGameEntry(placeId);

  res.json({
    ok: true,
    placeId,
    universeId: placeId,
    name: game.title || 'LuckyBlox Arena',
    data: servers.map((server) => ({
      id: server.jobId,
      jobId: server.jobId,
      maxPlayers: server.maxPlayers,
      playing: server.playing,
      playerTokens: server.playerTokens,
      players: server.players,
      ping: server.ping,
      fps: server.fps,
    })),
    total: servers.length,
  });
});

/**
 * Resolve the join script for a place. This is the endpoint the legacy clients
 * call to learn WHERE to connect (host, port, jobId) before they hand off to
 * the join script itself. Returns a real job bound to the caller.
 */
app.get('/v1/join-script', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = Number(req.query.userId || req.query.userid || (sessionUser ? sessionUser.userId : 1)) || 1;
  const placeId = Number(req.query.placeId || req.query.placeid || 1818);

  try {
    const job = createJoinJob(userId, placeId);
    const ticket = createAuthTicket(userId, placeId, {
      port: job.port,
      serverJobId: job.jobId,
    });

    const joinScriptUrl = `${publicOrigin}/game/Join.ashx?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket.ticket)}&serverPort=${job.port}&jobId=${encodeURIComponent(job.jobId)}`;

    audit('join_script_issued', {
      ip: security.clientIp(req),
      userId: String(userId),
      placeId,
      jobId: job.jobId,
    });

    return res.json({
      ok: true,
      status: 2,
      jobId: job.jobId,
      serverJobId: job.jobId,
      placeId,
      userId: String(userId),
      ip: gameServerHost,
      port: job.port,
      serverPort: job.port,
      maxPlayers: job.maxPlayers,
      joinScriptUrl,
      authenticationUrl: `${publicOrigin}/Login/Negotiate.ashx`,
      authenticationTicket: ticket.ticket,
      clientTicket: ticket.ticket,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      message: null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'join-script-failed',
      message: error && error.message ? error.message : 'Could not build a join script.',
    });
  }
});

/**
 * Link the signed-in account to a real Roblox account by username.
 *
 * Resolves the username through Roblox's public API and stores the resulting
 * user id on the account, so profiles can render the genuine avatar instead of a
 * placeholder. This is what removes the need to hand-link a robloxUserId.
 */
app.post('/api/link-roblox', async (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in before linking a Roblox account.' });
  }

  const username = String(req.body.username || req.query.username || '').trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: 'missing-username', message: 'Provide the Roblox username to link.' });
  }

  const match = await robloxApi.getUserByUsername(username);
  if (!match || !match.id) {
    return res.status(404).json({ ok: false, error: 'roblox-user-not-found', message: `No Roblox account named "${username}".` });
  }

  const userId = String(sessionUser.userId || sessionUser.id || 1);
  saveUser(userId, { robloxUserId: match.id, robloxUsername: match.name });
  audit('link_roblox', { userId, robloxUserId: match.id, robloxUsername: match.name });

  return res.json({
    ok: true,
    userId,
    roblox: match,
    headshotUrl: await robloxApi.getAvatarHeadshotUrl(match.id),
    fullBodyUrl: await robloxApi.getAvatarFullBodyUrl(match.id),
  });
});

/** Real Roblox catalog search by keyword, for the avatar/item pages. */
app.get('/api/roblox/asset/:assetId', async (req, res) => {
  const details = await robloxApi.getAssetDetails(req.params.assetId);
  if (!details) {
    return res.status(404).json({ ok: false, error: 'asset-not-found' });
  }
  return res.json({
    ok: true,
    asset: {
      ...details,
      thumbnailUrl: await robloxApi.getAssetThumbnailUrl(details.assetId),
    },
  });
});

app.get('/api/roblox/user/:userId', async (req, res) => {
  const user = await robloxApi.getUser(req.params.userId);
  if (!user) {
    return res.status(404).json({ ok: false, error: 'user-not-found' });
  }
  return res.json({
    ok: true,
    user: {
      ...user,
      headshotUrl: await robloxApi.getAvatarHeadshotUrl(user.id),
      fullBodyUrl: await robloxApi.getAvatarFullBodyUrl(user.id),
    },
  });
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

  // Playing requires an account. A guest must sign in first, exactly like the
  // real site: we no longer silently fall back to a demo user, which used to let
  // anyone join as user 1 without ever authenticating.
  if (!sessionUser) {
    audit('launch_game_denied', { ip: security.clientIp(req), reason: 'not-signed-in' });
    return res.status(401).json({
      ok: false,
      error: 'sign-in-required',
      message: 'You need to sign in to play.',
      signInUrl: '/signin?redirect=' + encodeURIComponent(req.originalUrl || '/'),
    });
  }

  // The launch is always attributed to the signed-in account - a client cannot
  // request a ticket for somebody else.
  const userId = Number(sessionUser.userId || sessionUser.id) || 1;
  const placeId = Number(req.body.placeId || req.body.placeid || req.query.placeId || 1818);

  try {
    // One call creates (or reuses) the job AND binds the player to it, so the
    // ticket, the jobId and the port can never disagree with each other.
    const job = createJoinJob(userId, placeId);
    const ticket = createAuthTicket(userId, placeId, {
      port: job.port,
      serverJobId: job.jobId,
    });

    const playUrl = `/play?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket.ticket)}&serverPort=${job.port}&jobId=${encodeURIComponent(job.jobId)}`;

    audit('launch_game', {
      ip: security.clientIp(req),
      userId: String(userId),
      placeId: Number(placeId),
      jobId: job.jobId,
    });

    return res.json({
      ok: true,
      started: true,
      userId: String(userId),
      placeId: Number(placeId),
      port: Number(job.port),
      // Roblox-style naming: jobId is the canonical server identifier.
      jobId: String(job.jobId),
      serverJobId: String(job.jobId),
      serverHost: job.serverHost,
      playerCount: job.playerCount,
      maxPlayers: job.maxPlayers,
      isNewServer: job.created,
      ticket: ticket.ticket,
      authTicket: ticket.authTicket,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
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

/**
 * Live status of a single job. Clients poll this after joining so they can
 * detect a dead/expired server instead of hanging forever.
 */
app.get('/api/jobs/:jobId', (req, res) => {
  const status = getJobStatus(String(req.params.jobId || ''));
  if (!status) {
    return res.status(404).json({ ok: false, error: 'job-not-found', jobId: req.params.jobId });
  }
  return res.json(status);
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

/**
 * Resolve an asset id to a stored record, accepting the several shapes the
 * asset DB can use (numeric id, string id, or a name match).
 */
function resolveAssetById(assetId) {
  const assets = getAssets();
  const wanted = String(assetId || '').trim();
  if (!wanted) {
    return null;
  }

  if (assets[wanted]) {
    return assets[wanted];
  }

  return Object.values(assets).find((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    return String(asset.id) === wanted
      || String(asset.assetId) === wanted
      || String(asset.currentVersionId) === wanted;
  }) || null;
}

// Studio handshake store: pending sign-in nonces waiting to be linked to a
// web session. Persisted so a restart mid-handshake does not corrupt state.
const studioHandshakePath = storage.dataPath('studio-handshakes.json');

function getStudioHandshakes() {
  const now = Date.now();
  const stored = readJson(studioHandshakePath, {});
  const fresh = {};
  for (const [nonce, entry] of Object.entries(stored || {})) {
    if (entry && Number(entry.expiresAt) > now) {
      fresh[nonce] = entry;
    }
  }
  return fresh;
}

/**
 * Roblox-style asset fetch. Legacy clients request assets from several paths
 * and expect the bytes plus a sensible content type, or a clean 404 when the
 * asset is unknown (so the client can fall back gracefully instead of hanging).
 *
 * Paths handled: /Asset, /asset/, /v1/asset, /v1/assets/:id
 */
function serveAssetById(req, res) {
  const rawId = req.params.id || req.query.id || req.query.assetId || req.query.assetid;
  const asset = resolveAssetById(rawId);

  if (!asset) {
    return res.status(404).json({
      ok: false,
      error: 'asset-not-found',
      assetId: rawId ? String(rawId) : null,
    });
  }

  // If we know where the file lives on disk, stream it.
  const candidatePaths = [asset.path, asset.filePath, asset.file]
    .filter(Boolean)
    .map((p) => (path.isAbsolute(p) ? p : path.join(releaseRoot, p)));

  const found = candidatePaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (error) {
      return false;
    }
  });

  if (found) {
    const binary = req.query.format === 'binary' || req.query.binary === '1';
    const contentType = binary ? 'application/octet-stream' : 'application/octet-stream';
    const stat = fs.statSync(found);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-store');
    return fs.createReadStream(found).pipe(res);
  }

  // No file on disk: return the asset metadata so the client at least knows the
  // asset exists and what type it is.
  return res.json({
    ok: true,
    assetId: Number(asset.id || asset.assetId) || null,
    name: asset.name || 'Asset',
    assetType: asset.assetType || asset.className || 'Model',
    currentVersionId: Number(asset.currentVersionId || asset.id) || null,
    description: asset.description || '',
    creatorId: Number(asset.creatorId || 1),
    creatorName: asset.creatorName || 'LuckyBlox Studio',
    version: Number(asset.version || 1),
    contentUrl: `${publicOrigin}/asset/?id=${Number(asset.id || asset.assetId) || 0}`,
    hasFile: false,
    updatedAt: asset.updatedAt || new Date().toISOString(),
  });
}

app.get('/v1/assets/:id', serveAssetById);
app.get('/v1/asset/:id', serveAssetById);
app.get('/asset/', serveAssetById);
app.get('/Asset/', serveAssetById);

/**
 * Asset metadata lookup by id, used by the client before downloading so it can
 * decide whether it already has the asset cached.
 */
app.get('/v1/asset-metadata/:id', (req, res) => {
  const asset = resolveAssetById(req.params.id);
  if (!asset) {
    return res.status(404).json({ ok: false, error: 'asset-not-found' });
  }
  return res.json({
    ok: true,
    assetId: Number(asset.id || asset.assetId) || null,
    name: asset.name || 'Asset',
    assetType: asset.assetType || asset.className || 'Model',
    currentVersionId: Number(asset.currentVersionId || asset.id) || null,
    description: asset.description || '',
    creatorId: Number(asset.creatorId || 1),
    creatorName: asset.creatorName || 'LuckyBlox Studio',
    version: Number(asset.version || 1),
    updatedAt: asset.updatedAt || new Date().toISOString(),
  });
});

/**
 * The catalogue the client and the site use to browse purchasable items. Real
 * records from the asset DB plus the built-in catalog items.
 */
app.get('/v1/catalog', (req, res) => {
  const assets = Object.values(getAssets()).map((asset) => ({
    id: Number(asset.id || asset.assetId) || 0,
    name: asset.name || 'Asset',
    assetType: asset.assetType || asset.className || 'Model',
    price: Number(asset.price || 0),
    creatorName: asset.creatorName || 'LuckyBlox Studio',
    thumbnailUrl: `${publicOrigin}/asset/?id=${Number(asset.id || asset.assetId) || 0}`,
    updatedAt: asset.updatedAt || new Date().toISOString(),
  }));

  const category = String(req.query.category || req.query.assetType || '').toLowerCase();
  const filtered = category
    ? assets.filter((a) => String(a.assetType).toLowerCase() === category)
    : assets;

  res.json({ ok: true, total: filtered.length, items: filtered });
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

/**
 * Live wallet for the signed-in visitor, used by the header so the Robux figure
 * is read from the account instead of being frozen into the rendered HTML.
 * Falls back to the anonymous demo account when there is no session, matching
 * the rest of the site's guest behaviour.
 */
app.get('/api/me', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = sessionUser ? (sessionUser.userId || sessionUser.id || 1) : 1;
  const user = getUser(userId);
  res.json({
    ok: true,
    signedIn: Boolean(sessionUser),
    user: {
      userId: Number(user.userId || userId),
      username: user.username,
      displayName: user.username,
      robux: Number(user.robux) || 0,
      currency: getCurrencyForUser(user),
    },
  });
});

app.get('/api/v1/account', (req, res) => {
  const userId = Number(req.query.userId || req.headers['x-user-id'] || 1);
  const user = getUser(userId);
  const admin = isAdminUser(user);
  const badge = getAdminBadge(user);
  res.json({
    ok: true,
    user: {
      userId: Number(user.userId || userId),
      username: user.username,
      displayName: user.username,
      membership: user.membershipStatus || user.membership || 'Premium',
      role: admin ? 'Admin' : 'Creator',
      isVerified: admin,
      isAdmin: admin,
      adminBadgeUrl: badge && badge.hasImage ? `${publicOrigin}/assets/roles/admin.png` : null,
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
  // Resolve through the public-safe serializer: getUser() returns the raw record,
  // which carries password/passwordSalt hashes that must never leave the server.
  const friendUsers = getFriendsForUser(userId);
  res.json({ ok: true, userId, friends: friendUsers, total: friendUsers.length });
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
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
    welcome: req.query.welcome === '1' || req.query.signedin === '1',
  });
});

app.get('/dev/create', requireDevAuth, (req, res) => {
  const user = getDevUser(req);
  res.render('dev/create', {
    title: 'Create - LuckyBlox Studio',
    user,
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
  });
});

app.post('/dev/create', requireDevAuth, express.urlencoded({ extended: true, limit: '50mb' }), (req, res) => {
  const body = req.body || {};
  const devUser = getDevUser(req) || {};
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
    fileName, filePath, version: 1,
    author: String(devUser.username || 'Creator'),
    authorId: Number(devUser.userId || devUser.id || 1),
    maxPlayers: placeData.maxPlayers,
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
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
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
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
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
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
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

  // Make it obvious whether accounts will survive a redeploy. On a free Render
  // instance without a disk they will not, and that looks like "fake" data.
  const store = storage.describeStorage();
  console.log(`[luckyblox] data dir: ${store.dataDir}`);
  console.log(`[luckyblox] persistence: ${store.persistent ? 'ON' : 'OFF'} - ${store.note}`);

  // Periodically prune expired rate-limit buckets so memory stays bounded.
  setInterval(() => security.pruneRateLimits(), 10 * 60 * 1000).unref();
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
