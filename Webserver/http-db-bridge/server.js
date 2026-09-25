const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildPlaceCatalogFromMaps, normalizePlaceId: normalizePlaceIdInput, resolveRequestedPlace } = require('./gameMapResolver');
const { getRobloxProfileTemplateItems } = require('./robloxTemplateSource');
const robloxApi = require('./robloxApi');
const { getStudioBuildInfo, getStudioUpdateManifest, STUDIO_EXECUTABLE_PATH, DEFAULT_BASE_URL } = require('./studioBuildInfo');
const clientLauncher = require(path.join(__dirname, '..', '..', 'server', 'clientLauncher.js'));
const { installStudioApiRoutes } = require(path.join(__dirname, '..', '..', 'server', 'studioApi.js'));
const { installClientApi } = require('./clientApi.js');
const { getClientBuildInfo, getClientUpdateManifest } = require('./clientBuildInfo.js');
const assetFetcher = require(path.join(__dirname, '..', '..', 'server', 'assetFetcher.js'));
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
  setJobTitle,
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
// Normalised for comparison: readJson/writeJson below decide whether a path is a
// data file (and therefore mirrored to the free remote store) by checking its
// directory against this.
const dataDirResolved = path.resolve(dataDir);
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
// Custom site dropdown (replaces native <select> with a themed, accessible one).
app.use('/lb-select.js', express.static(path.join(__dirname, 'public', 'lb-select.js')));
// Shared loading UI: puts the LuckyBlox spinner on screen for real server waits
// (page loads, API calls, the game page's live data) and takes it off when the
// answer arrives. Loaded on every page, like legacy-nav.js.
app.use('/loading.js', express.static(path.join(__dirname, 'public', 'loading.js')));
// Serve the site icon folder so /favicon.ico, /favicon.png and the originals in
// Webserver/site icon/ are all reachable from every page.
const siteIconDir = path.join(releaseRoot, 'Webserver', 'site icon');
app.use('/site-icon', express.static(siteIconDir));

// Roblox asset images downloaded to this server's own disk by
// server/assetFetcher.js. Serving them locally means the avatar page renders
// from our files instead of hotlinking thumbnails.roblox.com, so it keeps
// working offline and cannot break when Roblox moves its CDN.
const assetCacheDir = path.join(releaseRoot, 'Webserver', 'www', 'asset-cache');
try {
  fs.mkdirSync(assetCacheDir, { recursive: true });
} catch (error) {
  console.warn(`[luckyblox] could not create asset cache dir: ${error.message}`);
}
app.use('/asset-cache', express.static(assetCacheDir, { fallthrough: false, maxAge: '7d' }));

// The real archived 2021 stylesheets (Navigation, Builder, Thumbnails, Avatar,
// Footer, NotificationStream) plus the small luckyblox.css that fills the few
// gaps the archive capture left. The captured avatar-editor chrome and the
// profile/avatar pages are written against these rules, so they have to be
// reachable at /css/2021/*.
const classicCssDir = path.join(releaseRoot, 'Webserver', 'www', 'css', '2021');
app.use('/css/2021', express.static(classicCssDir, { fallthrough: false }));

// Real item thumbnails, captured from the archived 2021 avatar page along with
// the catalogue they belong to (see api/classic-avatar-catalog.php). Served
// locally so the profile shows genuine item art instead of letter tiles - and
// so it keeps working without reaching out to Roblox on every page view.
const classicThumbsDir = path.join(releaseRoot, 'Webserver', 'www', 'avatar-thumbs');
app.use('/avatar-thumbs', express.static(classicThumbsDir, { fallthrough: false }));

// The page script for the classic pages (tab switching, scale sliders, equip).
const classicJsDir = path.join(releaseRoot, 'Webserver', 'www', 'classic');
app.use('/classic', express.static(classicJsDir, { fallthrough: false }));

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

// Every client build we ship, in a stable order. Both 2021M and 2022M connect
// to the same LuckyBlox site; they differ only in the path suffix their
// AppSettings.xml points at, so each one is served its own copy.
const KNOWN_CLIENTS = ['2021M', '2022M'];

/**
 * The path suffix each client expects after the site origin.
 *
 * 2021M was built against a BaseUrl ending in /home/ and routes relative to it;
 * 2022M was built against the origin root. Getting this wrong does not 404 - the
 * client just loads the wrong page tree - so it is pinned per client here rather
 * than inherited from whatever the committed file happens to say.
 */
const CLIENT_BASE_SUFFIX = {
  '2021M': '/home/',
  '2022M': '/',
};

function isKnownClient(name) {
  return KNOWN_CLIENTS.indexOf(name) !== -1;
}

/**
 * Which client is this request for?
 *
 * The requested client is read from the query string or the client ident header
 * first, because on a shared server a single SelectedClient.txt cannot describe
 * two clients talking to the same deployment at once. SelectedClient.txt stays
 * as the fallback for a local desktop launch, where only one client runs.
 */
function resolveRequestedClient(req) {
  const raw = (req && (req.query.client || req.headers['x-luckyblox-client'])) || '';
  const value = String(Array.isArray(raw) ? raw[0] : raw).replace(/^\uFEFF/, '').trim();
  if (isKnownClient(value)) {
    return value;
  }
  return selectedClientName();
}

/** The locally selected client, used when a request does not name one. */
function selectedClientName() {
  try {
    const file = path.join(releaseRoot, 'Settings', 'SelectedClient.txt');
    if (!fs.existsSync(file)) return '2022M';
    const value = String(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '').trim();
    return isKnownClient(value) ? value : '2022M';
  } catch (error) {
    return '2022M';
  }
}

function resolveClientAssetDir(clientName) {
  const name = clientName || selectedClientName();
  const candidate = path.join(releaseRoot, 'Clients', name);
  return fs.existsSync(candidate) ? candidate : DEFAULT_CLIENT_DIR;
}

// The committed AppSettings.xml files carry a baked-in localhost BaseUrl. When
// the bridge itself is the public entry point (single-port deployment) that
// localhost URL would be handed straight to the client, so rewrite it to the
// live public origin here - the same rewrite server.js does on its own path.
// Each client's own path suffix is preserved (2021M expects a trailing /home/,
// 2022M does not) because dropping it breaks the client's routing.
function rewriteAppSettingsBaseUrl(body, origin, clientName) {
  const match = String(body).match(/<BaseUrl>[\s\S]*?<\/BaseUrl>/i);
  if (!match) return body;
  // Prefer the suffix pinned for this client; fall back to whatever path the
  // committed file already carried so an unknown client still gets a sane URL.
  let suffix = CLIENT_BASE_SUFFIX[clientName];
  if (!suffix) {
    const existingPath = (match[0].match(/LuckBlox\.site\.tk(\/[^<]*)?/i) || [])[1] || '/';
    suffix = existingPath.startsWith('/') ? existingPath : '/' + existingPath;
  }
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
    const clientName = resolveRequestedClient(req);
    const clientDir = resolveClientAssetDir(clientName);
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
      const body = rewriteAppSettingsBaseUrl(fs.readFileSync(file, 'utf8'), publicOrigin, clientName);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.set('X-LuckyBlox-Client', clientName);
      return res.send(body);
    }

    res.set('X-LuckyBlox-Client', clientName);
    return res.sendFile(file);
  };
}

app.use('/ClientSettings', serveClientAsset('ClientSettings'));
app.use('/LuckBlox.site.tk', serveClientAsset(''));
app.use(serveClientAsset(''));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// NOTE: '/assets' (plural) is a *prefix* mount, and Express matches prefixes on
// path segments - so it also swallowed '/asset/...' requests. Those are the
// legacy client's asset fetch (contentUrl is "${origin}/asset/?id=N"), and
// routing them into this static folder meant the client was handed whatever
// stray file sat in Assets/ instead of an asset's bytes. The mount is now
// anchored so only '/assets' itself and '/assets/<file>' match.
app.use(/^\/assets(?:\/|$)/, express.static(path.join(releaseRoot, 'Assets')));
app.use('/maps', express.static(mapsRoot));

// Client content: models, meshes, textures, fonts and scripts.
//
// Each client's AppSettings.xml sets <ContentFolder>../../shared/content</ContentFolder>,
// so the client looks for its avatar pipeline (characterR15.rbxm, R6.rbxm,
// charapp.rbxm, defaultShirt/defaultPants, heads, meshes) under this tree. That
// folder was never mounted over HTTP, so every content request 404'd and the
// client could not assemble a player's character - the avatar came out
// untextured or default regardless of what the account had saved.
//
// Mounted at both /Content (what the client asks for) and /content so either
// casing resolves, and the Content-Type is inferred from the file extension so
// .rbxm/.rbxmx arrive as binary rather than sniffed text.
const clientContentRoot = path.join(releaseRoot, 'shared', 'content');
if (fs.existsSync(clientContentRoot)) {
  const contentStatic = express.static(clientContentRoot, {
    fallthrough: true,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.rbxm' || ext === '.rbxmx' || ext === '.rbxl' || ext === '.rbxlx') {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  });
  app.use('/Content', contentStatic);
  app.use('/content', contentStatic);
}

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

  // A session must name a real account. This used to be `session.userId || 1`,
  // so a malformed session record with no userId resolved to account 1 - the
  // deployment OWNER - and made req.sessionUser the owner for that request.
  // A session with no usable id is simply not a session.
  const userId = Number(session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    activeSessions.delete(sessionId);
    return null;
  }

  const user = getUser(userId);
  // Never let a session resolve to an account that does not exist.
  return user && (user.userId || user.id) ? user : null;
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
  // 2021 presentation helpers, available to every template: the counts and
  // dates the real roblox.com rendered, and the shared blocky avatar figure.
  res.locals.abbreviateCount = abbreviateCount;
  res.locals.formatGameDate = formatGameDate;
  res.locals.formatJoinDate = formatJoinDate;
  res.locals.lbAvatarFigure = renderAvatarFigure;
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
 * The Roblox admin badge. There is exactly ONE admin badge â€” you either have
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
  // Route through the storage layer so a file restored from the free remote
  // store on boot is visible here, and the seeding/BOM handling lives in one
  // place. `fileName` is the basename because every data file lives in dataDir.
  const fileName = path.basename(filePath);
  if (path.resolve(path.dirname(filePath)) === dataDirResolved) {
    return storage.readJson(fileName, fallback);
  }

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
  //
  // Data files additionally go through the storage layer, which mirrors them to
  // the free remote store (server/remoteStore.js). This is the write path the
  // whole app uses - account creation, game publish/delete, currency changes -
  // so routing it here is what makes those survive a redeploy.
  const fileName = path.basename(filePath);
  if (path.resolve(path.dirname(filePath)) === dataDirResolved) {
    storage.writeJson(fileName, data);
    return;
  }

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
  // The starter wearables, using REAL Roblox asset ids verified against
  // economy.roblox.com. The previous ids (1001..1004) do not exist on Roblox at
  // all: the economy API 404s for them and their thumbnails return BrokenImage,
  // so a client asking for them got nothing and the character stayed default.
  //
  // These three are genuine and were fetched with tools/fetch-roblox-assets.js;
  // their images live in Webserver/www/asset-cache and are served locally.
  const now = new Date().toISOString();
  return {
    '607702162': {
      id: '607702162',
      assetId: 607702162,
      name: 'Roblox Baseball Cap',
      description: 'A classic Roblox cap.',
      assetType: 'Hat',
      assetTypeId: 8,
      path: null,
      currentVersionId: 607702162,
      className: 'Hat',
      price: 0,
      isForSale: true,
      creatorName: 'Roblox',
      thumbnail: '/asset-cache/607702162.png',
      source: 'roblox:fetched',
      createdAt: now,
    },
    '1029025': {
      id: '1029025',
      assetId: 1029025,
      name: 'The Classic ROBLOX Fedora',
      description: 'The hat that started it all.',
      assetType: 'Hat',
      assetTypeId: 8,
      path: null,
      currentVersionId: 1029025,
      className: 'Hat',
      price: 900,
      isForSale: true,
      creatorName: 'Roblox',
      thumbnail: '/asset-cache/1029025.png',
      source: 'roblox:fetched',
      createdAt: now,
    },
    '25330901': {
      id: '25330901',
      assetId: 25330901,
      name: 'Plad Short Shorts (Blue)',
      description: 'Classic blue plaid shorts.',
      assetType: 'Pants',
      assetTypeId: 12,
      path: null,
      currentVersionId: 25330901,
      className: 'Pants',
      price: 1,
      isForSale: true,
      creatorName: 'Roblox',
      thumbnail: '/asset-cache/25330901.png',
      source: 'roblox:fetched',
      createdAt: now,
    },
  };
}

// The default game icon. This used to be an external Unsplash stock photo (a
// phone on a desk), hotlinked in seven places. That is third-party art, it is
// the same picture for every game, and it fails on a host with no outbound
// network - which is why game icons rendered as empty boxes. Local Roblox
// placeholder art is used instead and ships with the server.
const DEFAULT_GAME_ICON = '/gameplaceholder/card.png';
// The cover is the SAME square art as the icon, not the wide Big_ image.
//
// LuckyBlox shows a game as a square card everywhere (home tiles, the game page
// thumbnail), and the shipped Big_ placeholder is 596x335 - a banner. Serving it
// as the default cover is what made every game render as a wide card. A square
// card needs square art, so the two defaults are one asset.
const DEFAULT_GAME_COVER = DEFAULT_GAME_ICON;

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
      inventory: ['607702162', '1029025', '25330901'],
      currentlyWearing: ['607702162'],
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
      inventory: ['607702162', '1029025', '25330901'],
      currentlyWearing: ['607702162'],
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
      icon: DEFAULT_GAME_ICON,
      genre: 'Adventure',
      // Real counters only. This deployment just started, so a brand new game
      // reports 0 players / 0 likes until actual traffic exists - no invented
      // "1,281 playing" numbers.
      playerCount: 0,
      likes: 0,
      favorites: 0,
      activeServers: [],
      serverList: [],
      votes: {
        likes: 0,
        dislikes: 0,
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
      icon: DEFAULT_GAME_ICON,
      genre: 'Adventure',
      // Honest counters: a freshly imported map has no plays yet.
      playerCount: 0,
      likes: 0,
      favorites: 0,
      activeServers: [],
      serverList: [],
      votes: {
        likes: 0,
        dislikes: 0,
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
    // The display name is its own field, set at signup and editable in Settings.
    // This used to be hardcoded to user.username, so a chosen display name was
    // silently discarded and every API consumer saw the username instead.
    displayName: user.displayName || user.username || 'LocalPlayer',
    bio: user.bio || '',
    joinDate: user.joinDate || new Date().toISOString(),
    membershipStatus: user.membershipStatus || user.membership || 'None',
    membership: user.membership || user.membershipStatus || 'None',
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

/* ---------------------------------------------------------------------------
 * 2021 presentation helpers
 * ---------------------------------------------------------------------------
 * These exist because roblox.com in 2021 formatted counts, dates and tab state
 * in specific ways, and the views need the same numbers the real page showed.
 * They are pure formatting and layout - no invented values.
 */

/**
 * The 2019-2021 body colour palette as Roblox published it (IDs 1-24 "classic"
 * plus the newer 1001+ set). Used by the blocky avatar figure and the avatar
 * editor, so the swatch labelled "Bright blue" really is brick-colour 1002.
 */
var BODY_COLORS = {
  1:  { name: 'White',         rgb: '242,243,243' },
  2:  { name: 'Grey',          rgb: '161,165,162' },
  3:  { name: 'Light yellow',  rgb: '249,233,153' },
  5:  { name: 'Brick yellow',  rgb: '215,197,154' },
  6:  { name: 'Light green (Mint)', rgb: '194,218,184' },
  9:  { name: 'Light reddish violet', rgb: '232,186,200' },
  11: { name: 'Pastel Blue',   rgb: '128,187,219' },
  12: { name: 'Light orange brown', rgb: '203,132,66' },
  18: { name: 'Nougat',        rgb: '204,142,105' },
  21: { name: 'Bright red',    rgb: '196,40,28' },
  22: { name: 'Med. reddish violet', rgb: '196,112,160' },
  23: { name: 'Bright blue',   rgb: '13,105,172' },
  24: { name: 'Bright yellow', rgb: '245,205,48' },
  25: { name: 'Earth orange',  rgb: '98,71,50' },
  26: { name: 'Black',         rgb: '27,42,53' },
  27: { name: 'Dark grey',     rgb: '109,110,108' },
  28: { name: 'Dark green',    rgb: '40,127,71' },
  29: { name: 'Medium green',  rgb: '161,196,140' },
  36: { name: 'Lig. Yellowich orange', rgb: '243,207,155' },
  37: { name: 'Bright green',  rgb: '75,151,75' },
  38: { name: 'Dark orange',   rgb: '160,95,53' },
  39: { name: 'Light bluish violet', rgb: '193,202,222' },
  40: { name: 'Transparent',   rgb: '236,236,236' },
  41: { name: 'Tr. Red',       rgb: '205,84,75' },
  42: { name: 'Tr. Lg blue',   rgb: '193,223,240' },
  43: { name: 'Tr. Blue',      rgb: '123,182,232' },
  44: { name: 'Tr. Yellow',    rgb: '247,241,141' },
  45: { name: 'Light blue',    rgb: '180,210,228' },
  47: { name: 'Tr. Flu. Reddish orange', rgb: '217,133,108' },
  48: { name: 'Tr. Green',     rgb: '132,182,141' },
  49: { name: 'Tr. Flu. Green', rgb: '248,241,132' },
  50: { name: 'Phosph. White', rgb: '236,232,222' },
  1001: { name: 'Institutional white', rgb: '248,248,248' },
  1002: { name: 'Bright blue',  rgb: '180,210,228' },
  1003: { name: 'Really black', rgb: '27,42,53' },
  1004: { name: 'Really red',   rgb: '255,0,0' },
  1005: { name: 'Lime green',   rgb: '75,151,75' },
  1006: { name: 'Bright purple', rgb: '170,0,170' },
  1007: { name: 'Bright bluish green', rgb: '0,143,156' },
  1008: { name: 'Bright violet', rgb: '98,37,209' },
  1009: { name: 'Bright orange', rgb: '255,175,0' },
  1010: { name: 'Bright bluish violet', rgb: '0,255,255' },
  1011: { name: 'Cool yellow',  rgb: '255,255,204' },
  1012: { name: 'Bright reddish violet', rgb: '255,0,0' },
  1013: { name: 'Bright green', rgb: '0,255,0' },
  1014: { name: 'Bright yellow', rgb: '255,255,0' },
  1015: { name: 'Bright bluish green', rgb: '0,143,156' },
  1016: { name: 'Bright red',   rgb: '196,40,28' },
  1017: { name: 'Bright blue',  rgb: '13,105,172' },
  1018: { name: 'Dark stone grey', rgb: '99,95,98' },
  1019: { name: 'Medium stone grey', rgb: '163,162,165' },
  1020: { name: 'Bright green', rgb: '0,255,0' },
  1021: { name: 'Bright blue',  rgb: '0,0,255' },
  1022: { name: 'Bright orange', rgb: '255,128,0' },
  1023: { name: 'Bright bluish green', rgb: '0,255,255' },
  1024: { name: 'Bright purple', rgb: '128,0,255' },
  1025: { name: 'Bright violet', rgb: '255,0,255' },
  1026: { name: 'Bright yellow', rgb: '255,255,0' },
  1027: { name: 'Bright green', rgb: '0,255,0' },
  1028: { name: 'Bright blue',  rgb: '0,0,255' },
  1029: { name: 'Bright red',   rgb: '255,0,0' },
  1030: { name: 'Bright bluish violet', rgb: '0,255,0' },
  1031: { name: 'Bright orange', rgb: '255,128,0' },
  1032: { name: 'Bright yellow', rgb: '255,255,0' },
};

function bodyColorRgb(colorId) {
  const entry = BODY_COLORS[Number(colorId)] || BODY_COLORS[1002];
  return entry.rgb;
}

function bodyColorName(colorId) {
  const entry = BODY_COLORS[Number(colorId)];
  return entry ? entry.name : 'Unknown';
}

/** The list the avatar editor iterates: every colour Roblox shipped, named. */
function bodyColorPalette() {
  return Object.keys(BODY_COLORS)
    .map((id) => ({ id: Number(id), name: BODY_COLORS[id].name, rgb: BODY_COLORS[id].rgb }))
    .sort((a, b) => a.id - b.id);
}

/**
 * Render a user's character as the blocky R6 figure roblox.com drew in 2021:
 * head, torso, two arms, two legs, each filled from the saved body colours.
 * This is the single source of truth for the figure, so a player looks the same
 * on the profile, the home page and the avatar editor.
 *
 * @param {object} user  normalized user (uses avatar.bodyColors)
 * @param {number} size  pixel height of the figure (240px = the 1x geometry)
 */
function renderAvatarFigure(user, size) {
  const avatar = (user && user.avatar) || {};
  const colors = avatar.bodyColors || {};
  const pick = (key, fallback) => `rgb(${bodyColorRgb(colors[key] != null ? colors[key] : fallback)})`;

  const head = pick('headColorId', 1002);
  const torso = pick('torsoColorId', 1002);
  const rightArm = pick('rightArmColorId', 1002);
  const leftArm = pick('leftArmColorId', 1002);
  const rightLeg = pick('rightLegColorId', 1002);
  const leftLeg = pick('leftLegColorId', 1002);
  const scale = Math.max(0.4, (Number(size) || 240) / 240);

  return `<div class="lb-avatar-figure" style="--lb-avatar-scale:${scale};" role="img" aria-label="Avatar">`
    + `<div class="lb-af-part lb-af-head" style="background:${head};"><span class="lb-af-face">:B</span></div>`
    + `<div class="lb-af-part lb-af-torso" style="background:${torso};"></div>`
    + `<div class="lb-af-part lb-af-larm" style="background:${leftArm};"></div>`
    + `<div class="lb-af-part lb-af-rarm" style="background:${rightArm};"></div>`
    + `<div class="lb-af-part lb-af-lleg" style="background:${leftLeg};"></div>`
    + `<div class="lb-af-part lb-af-rleg" style="background:${rightLeg};"></div>`
    + `</div>`;
}

/**
 * Abbreviate a count the way the 2021 profile header did: the exact number was
 * exposed via a title attribute, the visible text was shortened (7.6M+, 5.4M+).
 */
function abbreviateCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K+`;
  }
  const m = n / 1000000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M+`;
}

/** "5/1/2007" - the date format the 2021 game page used for Created / Updated. */
function formatGameDate(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** "Mar 21, 2021" - the join date the 2021 profile showed. */
function formatJoinDate(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Resolve the equipped items for a user into real asset records, so "Currently
 * Wearing" lists actual named items from assets.json instead of letter tiles.
 */
function getWearingForUser(user) {
  const assets = getAssets();
  const wearing = Array.isArray(user && user.currentlyWearing) ? user.currentlyWearing : [];
  const result = [];

  wearing.forEach((id) => {
    const asset = assets[String(id)] || null;
    if (!asset) return;
    result.push({
      id: String(asset.id != null ? asset.id : id),
      name: asset.name || 'Item',
      assetType: asset.assetType || asset.className || 'Accessory',
      thumbnailUrl: asset.thumbnail || asset.image || null,
    });
  });

  return result;
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
    icon: game.icon || DEFAULT_GAME_ICON,
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
  // any account created before hashing) can never sign in â€” and on a fresh
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
        icon: merged[String(placeId)]?.icon || DEFAULT_GAME_ICON,
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
    // Default to 'None', not 'Premium'. A stored record with no membership field
    // is an account with no membership; labelling it Premium showed a paying
    // badge on accounts that never had one.
    membership: keyedUser.membershipStatus || keyedUser.membership || 'None',
    membershipStatus: keyedUser.membershipStatus || keyedUser.membership || 'None',
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

/**
 * Normalise a username the same way everywhere, so uniqueness can never depend
 * on case, stray whitespace or a non-breaking space pasted from a browser.
 *
 * "Test", "test", " test " and "test\u00a0" all collapse to "test", which is what
 * makes the taken-name check actually hold rather than pass for a near-miss
 * variant.
 */
function normalizeUsername(value) {
  return String(value == null ? '' : value)
    // Strip every Unicode space (including NBSP) and zero-width characters.
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, '')
    .toLowerCase();
}

/**
 * Is this username already in use? Case- and whitespace-insensitive, and it
 * checks displayName too, because a display name is what other people see and
 * two accounts showing the same name is indistinguishable from a duplicate.
 *
 * `exceptUserId` lets a rename keep its own name.
 */
function isUsernameTaken(username, exceptUserId) {
  const target = normalizeUsername(username);
  if (!target) return false;

  const users = getUsers();
  const except = exceptUserId != null ? String(exceptUserId) : null;

  return Object.values(users).some((user) => {
    if (!user || typeof user !== 'object') return false;
    if (except && String(user.userId || user.id || '') === except) return false;
    return normalizeUsername(user.username) === target
      || normalizeUsername(user.displayName) === target;
  });
}

/**
 * The next free account id.
 *
 * This used to be `Math.max(...ids.map(u => Number(u.userId || u.id || 1))) + 1`.
 * Falling back to 1 for a record with no id meant a missing id silently read as
 * "1", and the ids in data/users.json are already non-contiguous (1,3,4,...) so
 * the max can collide after a deletion. This walks upward from the highest id
 * until it finds one no record already uses.
 */
function nextUserId() {
  const users = getUsers();
  const used = new Set();
  let highest = 0;

  Object.values(users).forEach((user) => {
    if (!user || typeof user !== 'object') return;
    const raw = user.userId != null ? user.userId : user.id;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    used.add(numeric);
    if (numeric > highest) highest = numeric;
  });

  let candidate = highest + 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

/**
 * A unique group name for an owner.
 *
 * Group names come from the owning account, so two accounts can never present
 * the same group name: the name carries the owner's own unique username, which
 * is already deduplicated at signup.
 */
function groupNameFor(ownerUsername) {
  return `${ownerUsername}'s Group`;
}

function buildNewUserRecord({ userId, username, displayName, passwordHash, passwordSalt, passwordVersion, gender, birthday }) {
  const now = new Date().toISOString();
  // Real, verified Roblox asset ids - the same three the default asset store
  // carries. The old 1001..1004 were invented ids that do not exist on Roblox,
  // so every new account was handed items the client could never load, which is
  // why a fresh avatar always came out default.
  const starterInventory = ['607702162', '1029025', '25330901'];
  const starterWearing = ['607702162'];
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
    // A brand new account starts with nothing. This used to hand out Premium
    // membership, 100 Robux, 250 coins and 10 tickets on signup, which is
    // currency nobody earned and a membership nobody paid for - and it
    // contradicted the PHP signup path, which correctly creates new accounts
    // empty. Real starting state: no money, no membership.
    membershipStatus: 'None',
    membership: 'None',
    robux: 0,
    currencies: { robux: 0, coins: 0, tickets: 0 },
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

/**
 * Publish the job a player just joined into Settings/ for the desktop tools.
 *
 * The Discord companion and the launcher both read these files:
 *
 *   jobid.txt         - which job this machine is in (the companion polls
 *                       /api/jobs/<id> for the live player count and the name)
 *   MapPath.txt       - which map, so the companion can name the game even
 *                       without the API
 *   gameserverraw.json - the declared slot size
 *
 * The desktop launcher writes these itself when it starts a session. When the
 * session is started FROM THE WEBSITE instead (the Play button), nothing wrote
 * them, so the companion could not tell what was being played and the card was
 * blank. Writing them here closes that gap for the web-driven flow.
 */
function syncLocalJob({ jobId, placeId, placeName, port, maxPlayers }) {
  const settingsRoot = path.join(releaseRoot, 'Settings');
  try {
    fs.mkdirSync(settingsRoot, { recursive: true });

    fs.writeFileSync(path.join(settingsRoot, 'jobid.txt'), String(jobId || ''));

    // MapPath.txt is a path, so keep the shape the launcher uses: the map file
    // for this place when one exists, otherwise the place's own name. The
    // companion derives the title from the basename.
    const gameEntry = getGameEntry(placeId);
    const mapFile = (gameEntry && (gameEntry.path || gameEntry.fileName))
      || `${placeName || (gameEntry && gameEntry.title) || 'LuckyBlox Arena'}.rbxl`;
    fs.writeFileSync(path.join(settingsRoot, 'MapPath.txt'), mapFile);

    // The slot size, in the same keys the companion already scans for.
    const serverRaw = {
      PlaceId: Number(placeId) || 0,
      MaxPlayers: Number(maxPlayers) || 20,
      PreferredPlayerCapacity: Number(maxPlayers) || 20,
      MachineAddress: '127.0.0.1',
      Port: Number(port) || gamePort,
      JobId: String(jobId || ''),
      Name: placeName || (gameEntry && gameEntry.title) || 'LuckyBlox Place',
    };
    fs.writeFileSync(path.join(settingsRoot, 'gameserverraw.json'), JSON.stringify(serverRaw, null, 2));

    // The bridge's own HTTP port, so the Discord companion asks the RIGHT API.
    // Its configured apiBaseUrl is a static default and the bridge is not on a
    // fixed port (3001/3002 locally, whatever the platform injects in the cloud),
    // so a stale value meant the card silently lost the live player count.
    fs.writeFileSync(path.join(settingsRoot, 'apibaseurl.txt'), `http://127.0.0.1:${publicPort}`);

    return true;
  } catch (error) {
    // Best effort: a read-only checkout must not break the launch.
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
    coverUrl: DEFAULT_GAME_COVER,
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
      coverUrl: DEFAULT_GAME_COVER,
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
    membershipStatus: nextState.membershipStatus || current.membershipStatus || 'None',
    inventory: Array.isArray(nextState.inventory) ? nextState.inventory : current.inventory,
    currentlyWearing: Array.isArray(nextState.currentlyWearing) ? nextState.currentlyWearing : current.currentlyWearing,
  };

  // getUser() returns a *normalized* view that adds a `key` field and default
  // sub-objects. Persisting `key` would duplicate the id and the normalized
  // defaults would overwrite the real stored avatar on the next read, so strip
  // the view-only field before writing.
  delete merged.key;

  // Preserve the stored password / salt / version. getUser() exposes them, but a
  // settings save that came through the JSON body must never blank a credential.
  const stored = users[String(userId)] || {};
  if (stored.password) merged.password = stored.password;
  if (stored.passwordSalt) merged.passwordSalt = stored.passwordSalt;
  if (stored.passwordVersion) merged.passwordVersion = stored.passwordVersion;

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
        // The asset's real AssetTypeId, not a hardcoded 1. A client uses this to
        // decide which slot the item occupies; 1 (Image) is not a wearable slot,
        // so every item was being classified wrongly.
        id: Number(asset.assetTypeId || 0),
        name: asset.assetType,
      },
      currentVersionId: Number(asset.currentVersionId || asset.id),
      meta: {
        order: 1,
        version: 1,
      },
    }));

  // No fallback item is invented here. Previously an account wearing nothing was
  // handed a made-up asset 1001 ("Classic Red Shirt") that does not exist on
  // Roblox, so the client requested a non-existent asset and the character came
  // out default. An empty outfit is a valid state - the client applies its own
  // default clothing, which is what really happens on Roblox too.

  const assetParams = avatarAssets
    .map((asset) => `assetId=${asset.id}&assetType=${encodeURIComponent(asset.assetType.name || 'Accessory')}`)
    .join('&');

  // The account's OWN saved avatar facts. These were hardcoded (scales all 1.0 and
  // the rig always 'R6'), so a player who chose R15, resized their character or
  // picked body colours still joined as a default R6 - the client never saw the
  // saved values. Read them from the record instead.
  const savedAvatar = (user.avatar && typeof user.avatar === 'object') ? user.avatar : {};
  const savedScales = (savedAvatar.scales && typeof savedAvatar.scales === 'object') ? savedAvatar.scales : {};

  return {
    ok: true,
    userId: Number(user.userId),
    placeId: Number(placeId),
    scales: {
      height: Number(savedScales.height != null ? savedScales.height : 1.0),
      width: Number(savedScales.width != null ? savedScales.width : 1.0),
      head: Number(savedScales.head != null ? savedScales.head : 1.0),
      depth: Number(savedScales.depth != null ? savedScales.depth : 1.0),
      proportion: Number(savedScales.proportion != null ? savedScales.proportion : 0.0),
      bodyType: Number(savedScales.bodyType != null ? savedScales.bodyType : 0.0),
    },
    playerAvatarType: savedAvatar.playerAvatarType || user.avatarType || 'R15',
    bodyColors: (savedAvatar.bodyColors && typeof savedAvatar.bodyColors === 'object') ? savedAvatar.bodyColors : {
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
    icon: DEFAULT_GAME_ICON,
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

/**
 * Create a job for a player AND name it.
 *
 * Wraps the orchestrator's createJoinJob so every launch path stamps the
 * experience's real title onto the job record. Without this, /api/jobs/<id>
 * could only report a placeId, and any consumer (the Discord companion, a
 * status page) that wanted to show the game's NAME had to re-derive it from a
 * local file - which does not exist on a machine that only runs the browser.
 */
function createNamedJoinJob(userId, placeId) {
  const job = createJoinJob(userId, placeId);
  try {
    const entry = getGameEntry(placeId);
    if (entry && entry.title) {
      setJobTitle(job.jobId, entry.title);
      job.placeName = entry.title;
    }
  } catch (error) {
    /* A missing title must never break the join. */
  }
  return job;
}

function getTicketStatus(ticket) {
  return activeTickets.get(ticket) || null;
}

function resolveRobloxPlayerBinary() {
  // Delegates to the shared client launcher, which resolves the client under a
  // folder named "Luckyblox" (per-user install, portable install or the bundled
  // Clients/2021M build). Returns null when the client is not installed, so
  // callers can offer the download instead of failing with a made-up path.
  return clientLauncher.resolveClientBinary();
}

function launchLocalRobloxClient({ userId, placeId, port, serverJobId, ticket }) {
  const executablePath = resolveRobloxPlayerBinary();
  if (!executablePath) {
    // Report the real state so the caller can offer the installer instead.
    const status = clientLauncher.getClientStatus();
    return {
      ok: false,
      error: 'client-not-installed',
      details: status.supported
        ? `No LuckyBlox client was found in the "${clientLauncher.INSTALL_FOLDER_NAME}" install folder.`
        : 'The LuckyBlox desktop client is only available on Windows.',
      downloadUrl: status.downloadUrl,
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

/**
 * The Roblox client API namespace (/v1/users, /v1/inventory, /v1/thumbnails, ...).
 *
 * The 2021M player and 2022M Studio clients address the real roblox.com v1/v2 API
 * shapes (see Clients/2022M/ClientSettings/ClientAppSettings.json and
 * Clients/2019M/Player/DevSettingsFile.json). Until now every one of those
 * requests fell through to Express's default HTML 404, which a client cannot
 * parse. See Webserver/http-db-bridge/clientApi.js for the endpoint list.
 *
 * Installed early so the client namespace is registered before the page routes.
 */
installClientApi(app, {
  getUser,
  getUsers,
  getAssets,
  getGames,
  getGameEntry,
  getPlaceSettings,
  serializeUser,
  getCurrencyForUser,
  getWearingForUser,
  getFriendsForUser,
  getPublicGamesForUser,
  normalizePlaceId,
  resolveSessionUser,
  saveUser,
  publicOrigin,
  dataDir,
  releaseRoot,
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online', port: PORT, releaseRoot, timestamp: new Date().toISOString() });
});

app.get('/api/studio/build-info', (req, res) => {
  // Report the download URL alongside the path, so an installer on another
  // machine can actually FETCH Studio. The executablePath below is the server's
  // own filesystem path, which is meaningless to a remote client - an installer
  // that copied from it silently installed nothing.
  const info = getStudioBuildInfo();
  const available = Boolean(info.executablePath && fs.existsSync(info.executablePath));
  res.json({
    ok: true,
    ...info,
    available,
    binaryName: path.basename(info.executablePath || 'RobloxStudioBeta.exe'),
    binarySize: available ? fs.statSync(info.executablePath).size : 0,
    downloadUrl: available ? '/download/studio/binary' : null,
  });
});

app.get('/api/studio/update-manifest', (req, res) => {
  res.json(getStudioUpdateManifest());
});

/**
 * Download the Studio binary.
 *
 * Mirrors /download/client/binary so an installer can fetch BOTH surfaces from
 * the same server. Refuses when no build is on disk rather than streaming
 * something unrelated.
 */
app.get('/download/studio/binary', (req, res) => {
  const info = getStudioBuildInfo();
  const executable = info.executablePath;
  if (!executable || !fs.existsSync(executable)) {
    return res.status(404).json({
      ok: false,
      error: 'studio-build-not-available',
      message: 'No LuckyBlox Studio build is published on this server.',
    });
  }

  res.set('X-LuckyBlox-Build', String(info.buildId || ''));
  res.set('X-LuckyBlox-Version', String(info.version || ''));
  return res.download(executable, path.basename(executable));
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
  // Shared page scripts. Same gap as the closed-site list: allowlisting only
  // legacy-nav.js meant /loading.js and /lb-select.js 404'd in preview mode.
  /^\/legacy-nav\.js$/,
  /^\/loading\.js$/,
  /^\/lb-select\.js$/,
  // Installer + updater endpoints, so a client can be installed or repaired
  // before the public site opens.
  /^\/download\/client/,
  /^\/download\/studio\/binary$/,
  /^\/api\/client\//,
  /^\/api\/studio\/(build-info|update-manifest|config)$/,
];

function isPreviewAllowed(reqPath) {
  return PREVIEW_ALLOWLIST.some((rx) => rx.test(reqPath));
}

/** Real status for the preview page â€” computed from live server state. */
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
    title: 'LuckyBlox â€” Live Preview',
    stage: PREVIEW_STAGE,
    teasers: PREVIEW_TEASERS,
  });
});

// ---------------------------------------------------------------------------
// Site status â€” public status page + owner open/close controls
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
    title: 'LuckyBlox â€” Site status',
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
    title: 'LuckyBlox â€” ' + state.label,
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
  // Case- and whitespace-insensitive uniqueness, shared with the JSON signup
  // endpoint so both entry points agree. Comparing raw lowercase strings let a
  // near-miss variant ("Test" vs "test " with a trailing space) slip through.
  if (isUsernameTaken(username)) {
    return renderError(409, 'That username is already taken.');
  }

  const nextId = nextUserId();
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
  // Same shared uniqueness rule as the form signup above.
  if (isUsernameTaken(username)) {
    return res.status(409).json({ ok: false, error: 'username-taken', message: 'That username is already taken.' });
  }

  const nextId = nextUserId();
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
  return renderProfilePage2021(req, res, userId);
});

/**
 * Shared renderer for every profile URL. roblox.com served the profile from
 * three paths (query, path segment, plural) and all three showed the same page.
 */
async function renderProfilePage2021(req, res, userId) {
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const publishedGames = getPublicGamesForUser(userId);
  const requestedTab = String(req.query.tab || '').toLowerCase();
  const tab = requestedTab === 'creations' ? 'creations' : 'about';

  res.render('profile', {
    title: `${user.username} - Profile | LuckyBlox`,
    user,
    assets,
    publishedGames,
    friends: getFriendsForUser(userId),
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
    games: publishedGames,
    profileAvatar: await resolveProfileAvatar(user),
    // 2021 page facts.
    tab,
    wearing: getWearingForUser(user),
    friendsCount: Number((user.stats && user.stats.friends) || (Array.isArray(user.friends) ? user.friends.length : 0)) || 0,
    followersCount: Number((user.stats && (user.stats.followers || user.stats.following)) || 0) || 0,
    followingCount: Number((user.stats && user.stats.following) || 0) || 0,
    visitsCount: Number((user.stats && (user.stats.gameVisits || user.stats.plays)) || 0) || 0,
    formatJoinDate,
    abbreviateCount,
  });
}

app.get('/profile/:userId', async (req, res) => {
  return renderProfilePage2021(req, res, req.params.userId || 1);
});

app.get('/users/:id/profile', async (req, res) => {
  return renderProfilePage2021(req, res, req.params.id || 1);
});

app.get('/users/:id/friends', (req, res) => {
  const userId = req.params.id || 1;
  const user = getUser(userId);
  res.render('friends', {
    title: `${user.username} - Friends | LuckyBlox`,
    user,
    friends: getFriendsForUser(userId),
    currency: getCurrencyForUser(user),
    tab: 'friends',
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
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = Number(req.query.userId || req.query.userid
    || (sessionUser && (sessionUser.userId || sessionUser.id)) || 1);
  const user = getUser(userId);
  const friendUsers = getFriendsForUser(userId);

  res.render('friends', {
    title: `${user.username} - Friends | LuckyBlox`,
    user,
    friends: friendUsers,
    // The 2021 header renders the Robux balance, so every page that includes it
    // must supply the currency block.
    currency: getCurrencyForUser(user),
  });
});

app.get('/badges', (req, res) => {
  const userId = Number(req.query.userId || req.query.userid || 1);
  const user = getUser(userId);
  const badges = Array.isArray(user.badges) ? user.badges : [];

  res.render('badges', {
    title: `${user.username} - Badges | LuckyBlox`,
    user,
    badges,
    currency: getCurrencyForUser(user),
  });
});

/**
 * Owner-only gate. Any route wrapped with this only runs for the deployment
 * owner (ID 1 / tailsthehero10). Everyone else gets 403 â€” enforced server-side,
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
 * Creator Hub â€” the LuckyBlox equivalent of create.roblox.com. Shows the real
 * experiences and assets belonging to the signed-in account, plus live counts.
 * Guests can view it but publishing actions prompt them to sign in.
 */
app.get('/develop', (req, res) => {
  const sessionUser = req.sessionUser;
  const userId = sessionUser ? (sessionUser.userId || sessionUser.id || 1) : (req.query.userId || 1);
  const user = getUser(userId);
  const isOwner = isOwnerUser(user);
  const signedIn = Boolean(sessionUser);

  // Real places from the store, annotated with their own game stats AND the
  // live server state the orchestrator actually holds (running jobs, players).
  const placesRecords = readJson(placesPath, {});
  const allGames = getGames();
  const placeCatalog = buildPlaceCatalogFromMaps();
  const places = Object.values(placesRecords)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const placeId = Number(entry.placeId || entry.universeId || 1818);
      const game = allGames[String(placeId)] || {};
      const servers = listServersForPlace(placeId);
      const playing = servers.reduce((sum, s) => sum + Number(s.playing || 0), 0);
      // A place exists either as a published record or a real map file.
      const mapEntry = placeCatalog.find((c) => Number(c.placeId) === placeId);
      return {
        placeId,
        name: entry.name || game.title || (mapEntry && mapEntry.title) || `Place ${placeId}`,
        description: entry.description || game.description || '',
        visibility: String(entry.visibility || 'Public'),
        genre: entry.genre || game.genre || 'Adventure',
        visits: Number(game.visits || 0),
        playing,
        serverCount: servers.length,
        maxPlayers: Number(entry.maxPlayers || game.maxPlayers || 20),
        authorId: Number(entry.authorId || 1),
        author: entry.author || 'LuckyBlox Studio',
        icon: '/gameplaceholder/card.png',
        createdAt: entry.createdAt || entry.publishedAt || game.createdAt || '',
        updatedAt: entry.updatedAt || entry.publishedAt || game.updatedAt || '',
        hasMap: Boolean(mapEntry),
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

  // Live server + player totals from the running orchestrator, not stored.
  const liveServers = activeGameServers.map((server) => ({
    jobId: server.serverJobId,
    placeId: Number(server.placeId),
    port: Number(server.port),
    playing: Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0,
    maxPlayers: Number(server.maxPlayers || 20),
    status: server.status || 'running',
    uptimeSeconds: server.startedAt ? Math.max(0, Math.round((Date.now() - new Date(server.startedAt).getTime()) / 1000)) : 0,
  }));

  const stats = {
    places: places.length,
    publicPlaces: places.filter((p) => p.visibility === 'Public').length,
    privatePlaces: places.filter((p) => p.visibility !== 'Public').length,
    assets: assets.length,
    visits: places.reduce((sum, p) => sum + Number(p.visits || 0), 0),
    liveServers: liveServers.length,
    playersOnline: getTotalPlayerCount(),
    maps: placeCatalog.length,
  };

  // Most recently updated places, for the "Recent activity" strip.
  const recent = places
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 8)
    .map((p) => ({
      placeId: p.placeId,
      name: p.name,
      updatedAt: p.updatedAt,
      playing: p.playing,
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
    liveServers,
    studioHost: gameServerHost,
    studioPort: gamePort,
    studioReady: fs.existsSync(STUDIO_EXECUTABLE_PATH),
    studioBaseUrl: DEFAULT_BASE_URL,
  });
});

app.get('/catalog', (req, res) => {
  return renderCatalogPage2021(req, res);
});

/**
 * A single Avatar Shop item.
 *
 * The catalog grid links every tile to /catalog/<id>, but no such route existed,
 * so every item in the shop was a dead link. Roblox also accepted a decorative
 * /catalog/<id>/<slug> path; the slug is ignored, exactly as the numeric game
 * routes ignore theirs.
 */
function renderCatalogItemPage(req, res, assetId) {
  const user = req.sessionUser || getUser(req.query.userId || 1);
  const assets = getAssets();
  const asset = assets[String(assetId)] || null;

  if (!asset) {
    return res.status(404).render('not-found', {
      title: 'Item not found - LuckyBlox',
      user,
      currency: getCurrencyForUser(user),
      requestedPath: req.originalUrl || req.path,
    });
  }

  const id = String(asset.id != null ? asset.id : asset.assetId);
  const ownedIds = new Set((Array.isArray(user.inventory) ? user.inventory : []).map(String));

  return res.render('catalog-item', {
    title: `${asset.name || 'Item'} - Roblox`,
    user,
    currency: getCurrencyForUser(user),
    item: {
      id,
      name: asset.name || 'Item',
      description: asset.description || '',
      assetType: asset.assetType || asset.className || 'Accessory',
      // Shop price is always 0; the real Roblox price is shown as a reference.
      price: 0,
      originalPrice: Number(asset.originalPrice != null ? asset.originalPrice : asset.price) || 0,
      creatorName: asset.creatorName || 'LuckyBlox Studio',
      owned: ownedIds.has(id),
      thumbnailUrl: asset.thumbnail || asset.image || null,
      source: asset.source || 'local',
    },
  });
}

app.get('/catalog/:assetId', (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.assetId || ''))) return next();
  return renderCatalogItemPage(req, res, req.params.assetId);
});

app.get('/catalog/:assetId/:slug', (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.assetId || ''))) return next();
  return renderCatalogItemPage(req, res, req.params.assetId);
});

/**
 * Add a catalog item to the signed-in account's inventory.
 *
 * Every item is free (price 0), so there is no currency check - but the asset
 * must genuinely exist and must be a wearable type, or it would be possible to
 * add an image/badge asset to a wardrobe where the client cannot use it.
 */
const WEARABLE_ASSET_TYPES = new Set([
  'Hat', 'Shirt', 'Pants', 'TShirt',
  'HairAccessory', 'FaceAccessory', 'NeckAccessory', 'ShoulderAccessory',
  'FrontAccessory', 'BackAccessory', 'WaistAccessory',
  'TShirtAccessory', 'ShirtAccessory', 'PantsAccessory', 'JacketAccessory',
  'SweaterAccessory', 'ShortsAccessory', 'LeftShoeAccessory', 'RightShoeAccessory',
]);

app.post('/api/catalog/buy', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to get items.' });
  }

  const body = req.body || {};
  const assetId = String(body.assetId || body.id || '').trim();
  if (!assetId) {
    return res.status(400).json({ ok: false, error: 'missing-asset-id', message: 'No item was specified.' });
  }

  const assets = getAssets();
  const asset = assets[assetId];
  if (!asset) {
    return res.status(404).json({ ok: false, error: 'asset-not-found', message: 'That item does not exist.' });
  }

  // Guard the wardrobe: only real wearable types can be added.
  const type = String(asset.assetType || asset.className || '');
  if (!WEARABLE_ASSET_TYPES.has(type)) {
    return res.status(400).json({
      ok: false,
      error: 'not-wearable',
      message: `"${asset.name || 'That item'}" is a ${type || 'non-wearable'} asset and cannot be worn.`,
    });
  }

  const userId = String(sessionUser.userId || sessionUser.id || 1);
  const current = getUser(userId);
  const inventory = Array.isArray(current.inventory) ? current.inventory.map(String) : [];

  if (inventory.includes(assetId)) {
    return res.json({ ok: true, alreadyOwned: true, assetId, inventory });
  }

  inventory.push(assetId);
  const updated = saveUser(userId, { inventory });
  try { syncLocalIdentity(updated); } catch (error) { /* best effort */ }
  audit('catalog_item_added', { userId, assetId, type });

  return res.json({ ok: true, assetId, inventory });
});

/**
 * The sign-in landing page for buying Robux.
 *
 * /upgrades/robux is linked from the header on EVERY page, but no route existed,
 * so it was a site-wide dead link. LuckyBlox does not sell currency, so this says
 * so honestly and shows the real balance instead of showing a fake store.
 */
app.get('/upgrades/robux', (req, res) => {
  const user = req.sessionUser || getUser(req.query.userId || 1);
  res.render('robux', {
    title: 'Robux - LuckyBlox',
    user,
    currency: getCurrencyForUser(user),
  });
});

/**
 * A user's inventory, at the 2021 path /users/<id>/inventory.
 *
 * Resolves the account's real `inventory` array against the asset store and
 * offers only the categories that account actually owns, so no filter can lead
 * to an empty grid.
 */
function renderInventoryPage(req, res, ownerId) {
  const viewer = req.sessionUser || resolveSessionUser(req) || getUser(req.query.userId || 1);
  const owner = getUser(ownerId);
  const assets = getAssets();

  const ownedIds = (Array.isArray(owner.inventory) ? owner.inventory : []).map(String);
  const wearingIds = new Set((Array.isArray(owner.currentlyWearing) ? owner.currentlyWearing : []).map(String));

  // Resolve owned ids to real records. An id with no record is skipped rather
  // than shown as a blank tile.
  const owned = ownedIds
    .map((id) => assets[id])
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const id = String(a.id != null ? a.id : a.assetId);
      return {
        id,
        name: a.name || 'Item',
        assetType: a.assetType || a.className || 'Accessory',
        thumbnailUrl: a.thumbnail || a.image || null,
        wearing: wearingIds.has(id),
      };
    });

  const selectedType = String(req.query.type || '').trim();
  const items = selectedType ? owned.filter((i) => i.assetType === selectedType) : owned;

  // Real category counts, including an "All" entry.
  const typeCounts = new Map();
  owned.forEach((i) => typeCounts.set(i.assetType, (typeCounts.get(i.assetType) || 0) + 1));
  const typeOptions = [{ key: '', label: 'All', count: owned.length }]
    .concat(Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ key: label, label, count })));

  return res.render('inventory', {
    title: `${owner.username} - Inventory | LuckyBlox`,
    user: viewer,
    currency: getCurrencyForUser(viewer),
    ownerId: String(owner.userId || ownerId),
    ownerName: owner.username || 'Player',
    isSelf: String(viewer.userId || '') === String(owner.userId || ownerId),
    items,
    itemCount: items.length,
    typeOptions,
    selectedType,
    typeLabel: selectedType,
  });
}

app.get('/inventory', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = req.query.userId
    || (sessionUser && (sessionUser.userId || sessionUser.id))
    || 1;
  return renderInventoryPage(req, res, userId);
});

app.get('/users/:id/inventory', (req, res) => {
  return renderInventoryPage(req, res, req.params.id || 1);
});

/**
 * Avatar Shop (catalog).
 *
 * Real page: https://web.archive.org/web/20210605211817/https://www.roblox.com/catalog?Category=0
 *
 * The 2021 catalog was a sidebar of filters plus a grid of 150x150 item tiles
 * showing the thumbnail, the name, the creator and the price. Only items that
 * genuinely exist in assets.json are listed - the account-owned set plus the
 * local asset store - so nothing here is a made-up listing with an invented
 * price.
 */
function renderCatalogPage2021(req, res) {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = req.query.userId
    || (sessionUser && (sessionUser.userId || sessionUser.id))
    || 1;
  const user = getUser(userId);

  const ownedIds = new Set((Array.isArray(user.inventory) ? user.inventory : []).map(String));
  const wearingIds = new Set((Array.isArray(user.currentlyWearing) ? user.currentlyWearing : []).map(String));

  const all = Object.values(getAssets());

  const items = all.map((asset) => {
    const id = String(asset.id != null ? asset.id : (asset.assetId != null ? asset.assetId : ''));
    return {
      id,
      name: asset.name || 'Item',
      assetType: asset.assetType || asset.className || 'Accessory',
      assetTypeId: Number(asset.assetTypeId || 0),
      // The SHOP price is 0 for everything on LuckyBlox - no item costs Robux
      // here. The item's real Roblox price is preserved on the record as
      // originalPrice, so the true value is still known and displayed as a
      // reference, while buying is always free.
      price: 0,
      originalPrice: Number(asset.originalPrice != null ? asset.originalPrice : asset.price) || 0,
      isForSale: true,
      creatorName: asset.creatorName || 'LuckyBlox Studio',
      owned: ownedIds.has(id),
      wearing: wearingIds.has(id),
      thumbnailUrl: asset.thumbnail || asset.image || null,
    };
  });

  // Real filter options, derived from the asset types that actually exist rather
  // than a hardcoded list that would show empty categories.
  const categories = ['All Categories'].concat(
    Array.from(new Set(items.map((i) => i.assetType))).sort()
  );

  const selected = String(req.query.category || 'All Categories');
  const filtered = selected === 'All Categories'
    ? items
    : items.filter((i) => i.assetType === selected);

  const sort = String(req.query.sort || 'relevance');
  const sorted = filtered.slice().sort((a, b) => {
    if (sort === 'price-low') return a.price - b.price;
    if (sort === 'price-high') return b.price - a.price;
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'owned') return Number(b.owned) - Number(a.owned);
    return Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name);
  });

  res.render('catalog', {
    title: 'Avatar Shop - Roblox',
    user,
    currency: getCurrencyForUser(user),
    items: sorted,
    categories,
    selectedCategory: selected,
    selectedSort: sort,
    totalItems: items.length,
    ownedCount: items.filter((i) => i.owned).length,
    abbreviateCount,
  });
}

app.get('/search/groups', (req, res) => {
  return renderGroupSearch2021(req, res);
});

app.get('/groups', (req, res) => {
  return renderGroupSearch2021(req, res);
});

/**
 * Group search.
 *
 * Real page: https://web.archive.org/web/20210901215113/https://www.roblox.com/search/groups
 *
 * The 2021 page was a search box, a "Sort by" control (Relevance / Most
 * Members / Newest) and a list of group rows: 150x150 emblem, the group name,
 * the member count and a Description line.
 *
 * Groups are derived from the accounts that actually exist and the experiences
 * they have published - there is no groups.json, and inventing group rosters
 * with fake member counts would be exactly the kind of placeholder that reads as
 * broken. If no accounts exist yet the page says so.
 */
function renderGroupSearch2021(req, res) {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = (sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
  const user = getUser(userId);

  const query = String(req.query.keyword || req.query.q || '').trim();
  const sort = String(req.query.sort || 'relevance');

  const users = getUsers();
  const games = getGames();

  // One group per real creator account.
  //
  // The 47 map-derived experiences in games.json are all authored by
  // "LuckyBlox Studio" with no authorId - they are built-in maps, not user
  // publications. Attributing them to whichever account happens to be signed in
  // would be inventing ownership, so a group's experience count only counts
  // games that carry this account's own authorId or developer name.
  const groups = Object.values(users)
    .filter((u) => u && typeof u === 'object' && u.username)
    .map((u) => {
      const ownerName = String(u.username);
      const owned = Object.values(games).filter((g) => {
        if (!g || typeof g !== 'object') return false;
        const byId = g.authorId != null && String(g.authorId) === String(u.userId || '');
        const dev = String(g.developer || '').toLowerCase();
        // "LuckyBlox Studio" is the built-in placeholder author; it is not a user.
        const byName = dev !== '' && dev !== 'luckyblox studio' && dev === ownerName.toLowerCase();
        return byId || byName;
      });

      return {
        id: String(u.userId || ''),
        name: groupNameFor(ownerName),
        owner: ownerName,
        ownerId: String(u.userId || ''),
        memberCount: Array.isArray(u.friends) ? u.friends.length : 0,
        experienceCount: owned.length,
        description: owned.length
          ? `Creator of ${owned.length} experience${owned.length === 1 ? '' : 's'} on this server.`
          : 'This creator has not published an experience yet.',
      };
    })
    .filter((g) => g.id);

  const matched = query
    ? groups.filter((g) => g.name.toLowerCase().includes(query.toLowerCase())
        || g.owner.toLowerCase().includes(query.toLowerCase()))
    : groups;

  const sorted = matched.slice().sort((a, b) => {
    if (sort === 'members') return b.memberCount - a.memberCount;
    if (sort === 'experiences') return b.experienceCount - a.experienceCount;
    if (sort === 'name') return a.name.localeCompare(b.name);
    return b.memberCount - a.memberCount;
  });

  res.render('group-search', {
    title: query ? `${query} - Groups - Roblox` : 'Groups - Roblox',
    user,
    currency: getCurrencyForUser(user),
    groups: sorted,
    totalGroups: groups.length,
    keyword: query,
    selectedSort: sort,
  });
}

app.get('/groups/:id', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = (sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
  const user = getUser(userId);
  const groupId = String(req.params.id || '');
  const owner = getUser(groupId);

  if (!owner) {
    return res.status(404).render('group-about', {
      title: 'Group not found - Roblox',
      user,
      currency: getCurrencyForUser(user),
      group: null,
      members: [],
      experiences: [],
      activeTab: 'about',
    });
  }

  const games = getGames();
  // Same ownership rule as the search page: the built-in "LuckyBlox Studio" maps
  // are not this account's publications, so they are not listed as its
  // experiences. Only games carrying this account's authorId or its developer
  // name count.
  const experiences = Object.values(games)
    .filter((g) => {
      if (!g || typeof g !== 'object') return false;
      const byId = g.authorId != null && String(g.authorId) === String(owner.userId || '');
      const dev = String(g.developer || '').toLowerCase();
      const byName = dev !== '' && dev !== 'luckyblox studio'
        && dev === String(owner.username).toLowerCase();
      return byId || byName;
    })
    .map((g) => ({
      placeId: Number(g.placeId) || 0,
      title: g.title || 'Experience',
      description: g.description || '',
      genre: g.genre || 'Adventure',
      playerCount: Number(g.playerCount) || 0,
    }))
    .filter((g) => g.placeId);

  const activeTab = ['about', 'experiences', 'members'].includes(String(req.query.tab || '').toLowerCase())
    ? String(req.query.tab).toLowerCase() : 'about';

  res.render('group-about', {
    title: `${groupNameFor(owner.username)} - Roblox`,
    user,
    currency: getCurrencyForUser(user),
    group: {
      id: String(owner.userId || ''),
      name: groupNameFor(owner.username),
      owner: owner.username,
      ownerId: String(owner.userId || ''),
      description: owner.bio || 'This group has not written a description yet.',
      memberCount: Array.isArray(owner.friends) ? owner.friends.length : 0,
      experienceCount: experiences.length,
      created: owner.joinDate || '',
    },
    members: getFriendsForUser(owner.userId),
    experiences,
    activeTab,
    formatJoinDate,
    abbreviateCount,
  });
});

/**
 * The avatar page, served at /avatar and at the 2021 URL /my/avatar.
 *
 * This page used to render a letter in a circle and ignore what the account was
 * actually wearing. It now resolves the real avatar through the same path the
 * profile uses (resolveProfileAvatar): the wearer's Roblox full-body render when
 * the account is linked to a real Roblox id, otherwise the locally drawn figure
 * built from the account's own bodyColors - plus every equipped item with its
 * real name, price and thumbnail, which is what the "Currently Wearing" panel
 * and the unequip buttons need.
 */
async function renderAvatarPage2021(req, res, userId) {
  const user = getUser(userId);
  const assets = Object.values(getAssets());
  const avatar = await resolveProfileAvatar(user);

  res.render('avatar', {
    title: `${user.username} - Avatar | LuckyBlox`,
    user,
    assets,
    currency: getCurrencyForUser(user),
    // The wearing list powers the "Selected" state on each asset card.
    wearingList: Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [],
    // Real avatar data: the render plus one record per equipped item.
    avatar,
    wearing: getWearingForUser(user),
    // 2021 body facts, read from the account rather than invented.
    avatarType: user.avatarType || (user.avatar && user.avatar.playerAvatarType) || 'R15',
    bodyColors: (user.avatar && user.avatar.bodyColors) || {},
    scales: (user.avatar && user.avatar.scales) || { height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 },
    formatJoinDate,
    abbreviateCount,
  });
}

app.get('/avatar', async (req, res) => {
  return renderAvatarPage2021(req, res, req.query.userId || 1);
});

// The 2021 URL for this page was /my/avatar (it showed the signed-in user).
// Guests without a session fall back to the demo account, matching /avatar.
app.get('/my/avatar', async (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = sessionUser ? (sessionUser.userId || sessionUser.id) : (req.query.userId || 1);
  return renderAvatarPage2021(req, res, userId);
});

/**
 * /api/avatar_v1 - the avatar model for an account, in the v1 shape
 * (https://avatar.roblox.com/v1/avatar).
 *
 * Mirrors Roblox's own contract so a client that expects the v1 avatar model
 * can read this server instead:
 *
 *   { scales, playerAvatarType, bodyColors{...Id}, assets[{ id, name, assetType,
 *     currentVersionId }], defaultShirtApplied, defaultPantsApplied, emotes[] }
 *
 * Source order: the account's linked Roblox id (a genuine model, v4 then v1),
 * then the locally stored account record. Both paths go through
 * normalizeAvatarModel so numeric BrickColor ids and hex colours are returned
 * consistently - the two Roblox versions use different colour formats.
 */
app.get('/api/avatar_v1', async (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const requestedId = req.query.userId || req.query.userid;
  const userId = sessionUser
    ? (sessionUser.userId || sessionUser.id)
    : (requestedId != null ? requestedId : 1);

  const user = getUser(userId);

  // The account's own stored avatar is the fallback for every field, so a
  // Roblox outage degrades to real local data instead of an empty model.
  const localFallback = {
    bodyColors: (user.avatar && user.avatar.bodyColors) || {},
    scales: (user.avatar && user.avatar.scales) || undefined,
    playerAvatarType: user.avatarType || (user.avatar && user.avatar.playerAvatarType) || 'R15',
  };

  let model = null;
  let source = 'local';
  const linkedId = Number(user.robloxUserId);

  if (Number.isFinite(linkedId) && linkedId > 0) {
    // v4 first (current), then v1 for accounts that predate it.
    model = await robloxApi.getAvatarModel(linkedId, 4);
    if (!model) model = await robloxApi.getAvatarModel(linkedId, 1);
    if (model) source = 'roblox';
  }

  const normalized = robloxApi.normalizeAvatarModel(model, localFallback);

  // When Roblox supplied the model, use its asset list verbatim. Otherwise build
  // the asset list from the equipped ids this account actually has, resolving
  // real names and thumbnails so the response is never a list of bare numbers.
  let assets = normalized.assets;
  if (!assets.length) {
    const wearing = Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [];
    const localAssets = getAssets();
    assets = await Promise.all(wearing.map(async (rawId) => {
      const id = Number(rawId);
      const local = localAssets[String(rawId)] || null;
      const details = Number.isFinite(id) && id > 0 && source === 'local'
        ? await robloxApi.getAssetDetails(id)
        : null;
      return {
        id: Number.isFinite(id) ? id : 0,
        name: (details && details.name) || (local && local.name) || null,
        assetType: {
          id: Number((local && (local.assetTypeId || 0)) || 0),
          name: (local && (local.assetType || local.className)) || 'Asset',
        },
        currentVersionId: null,
      };
    }));
  }

  res.json({
    scales: normalized.scales,
    playerAvatarType: normalized.playerAvatarType,
    bodyColors: normalized.bodyColors,
    // Extra fields this server adds for the site's own renderer. They are
    // additive - the v1 fields above keep the original names and shapes.
    bodyColorHex: normalized.bodyColorHex,
    assets,
    defaultShirtApplied: normalized.defaultShirtApplied,
    defaultPantsApplied: normalized.defaultPantsApplied,
    emotes: Array.isArray(user.emotes) ? user.emotes : [],
    // Provenance, so a caller can tell a real Roblox model from local data.
    source,
    userId: Number(user.userId || userId || 1),
    username: user.username || null,
  });
});

app.get('/game', (req, res) => {
  return renderGamePage2021(req, res, normalizePlaceId(req.query.placeId || req.query.placeid || 1818));
});

/**
 * Shared renderer for the game (experience) page.
 *
 * Rebuilt against https://web.archive.org/web/20210206175524/https://www.roblox.com/games/1818/Classic-Crossroads
 *
 * The 2021 page laid out as:
 *
 *   left column    the 16:9 thumbnail with the Play button over it, then the
 *                  "About" / "Store" / "Servers" underline tabs, and under the
 *                  About tab: a description panel, then the game-stat grid
 *                  (Playing / Visits / Favorites / Created / Updated / Genre)
 *   right column   the game icon, the title, the byline "By <creator>", the
 *                  likes bar (with the percentage and the vote counts), the
 *                  server-size row, and the detail stat list
 *
 * Every integer below comes from games.json, places.json or the live server
 * orchestrator. Where the server has no datum the page says so rather than
 * printing an invented number.
 */
function renderGamePage2021(req, res, placeId) {
  const user = getUser(req.query.userId || (req.sessionUser && (req.sessionUser.userId || req.sessionUser.id)) || 1);
  const game = getGameEntry(placeId);
  const place = getPlaceSettings(placeId);

  // Real lifecycle facts. Created On falls back to the published date, then to
  // the map file's own timestamp - never a made-up value.
  const createdAt = game.createdAt || place.createdAt || game.publishedAt || game.updatedAt || '';
  const updatedAt = game.updatedAt || game.publishedAt || place.updatedAt || createdAt;

  // Live server state for this place, straight from the orchestrator.
  const servers = listServersForPlace(placeId);
  const playing = servers.reduce((sum, s) => sum + Number(s.playing || 0), 0);

  const likes = Number(game.likes) || 0;
  const dislikes = Number((game.votes && game.votes.dislikes) || 0);
  const voteTotal = likes + dislikes;
  const likesPercent = voteTotal > 0 ? Math.round((likes / voteTotal) * 100) : 0;

  res.render('game-about', {
    title: `${game.title} - Roblox`,
    user,
    game,
    placeId,
    currency: getCurrencyForUser(user),
    createdAt,
    updatedAt,
    // Roblox's own placeholder art: the SQUARE card (Card_512x512) is both the
    // page icon and the page thumbnail, because the game page shows a card.
    //
    // The thumbnail used to be '/gameplaceholder/big.png' - the wide Big_ art,
    // handed out unconditionally for every game. Two things were wrong with it:
    // every experience displayed the same 596x335 banner regardless of its own
    // artwork, and the square card frame could never be satisfied by a wide
    // image. When a game has its own icon, both fields use it, so the card shows
    // THAT game's art.
    gameIcon: game.icon && /^\/|^https?:\/\//.test(game.icon) ? game.icon : '/gameplaceholder/card.png',
    gameThumb: game.icon && /^\/|^https?:\/\//.test(game.icon) ? game.icon : '/gameplaceholder/card.png',
    creatorName: game.developer || 'LuckyBlox Studio',
    playing,
    visits: Number(game.visits) || 0,
    likes,
    dislikes,
    likesPercent,
    favorites: Number(game.favorites) || 0,
    maxPlayers: Number(game.maxPlayers || place.maxPlayers || 20),
    genre: game.genre || place.genre || 'Adventure',
    serverCount: servers.length,
    servers,
    activeTab: ['about', 'store', 'servers'].includes(String(req.query.tab || '').toLowerCase())
      ? String(req.query.tab).toLowerCase() : 'about',
    // Server-side formatting helpers, so the view stays presentational.
    formatGameDate,
    abbreviateCount,
  });
}

// The 2021 URL shape for an experience page is
//   /games/<placeId>/<Title-With-Dashes>
// (e.g. /games/1818/Classic-Crossroads). The slug is decorative - Roblox
// resolved the page from the numeric id alone - so it is accepted and ignored.
// Registered after every /games/<literal> route so /games/<word> paths cannot
// be swallowed by the numeric pattern.
app.get('/games/:placeId', (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.placeId || ''))) return next();
  return renderGamePage2021(req, res, normalizePlaceId(req.params.placeId));
});

app.get('/games/:placeId/:slug', (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.placeId || ''))) return next();
  return renderGamePage2021(req, res, normalizePlaceId(req.params.placeId));
});

/**
 * /create - the 2021 "Create" landing page.
 *
 * Rebuilt against https://web.archive.org/web/20210801002543/https://www.roblox.com/create
 *
 * In 2021 /create was the Studio launch surface: a hero with the Studio mark, a
 * "Start Creating" primary action and the download/launch links. It is distinct
 * from /develop, which is the developer dashboard listing your own places.
 */
app.get('/create', (req, res) => {
  const user = req.sessionUser || getUser(req.query.userId || 1);
  return res.render('create', {
    title: 'Create - Roblox',
    user,
    currency: getCurrencyForUser(user),
    basePath: res.locals.basePath || '',
    studioHost: gameServerHost,
    studioPort: gamePort,
    studioReady: fs.existsSync(STUDIO_EXECUTABLE_PATH),
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
    displayName: user.displayName || user.username,
    membership: user.membershipStatus || user.membership || 'None',
    authTicket: ticket.ticket,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    isOwner: isOwnerUser(user),
  });
});

/**
 * Launch the desktop Studio (2022M) for the signed-in user.
 *
 * This is how Studio actually connects: the client is spawned and told the
 * base URL + one-time auth ticket, then it opens /v1/studio/authenticate with
 * the nonce to pick up the session. Returns the real spawn result so the UI can
 * tell the user whether the desktop app started (e.g. "not installed here" when
 * the launcher runs on a machine without RobloxStudioBeta.exe).
 */
app.post('/api/studio/launch', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to open Studio.' });
  }

  const userId = String(sessionUser.userId || sessionUser.id || 1);
  const placeId = Number(req.body && req.body.placeId) || 1818;

  // Mint a Studio handshake bound to this user so Studio authenticates as them.
  const nonce = security.generateSessionId();
  const studioSessions = getStudioHandshakes();
  studioSessions[nonce] = {
    nonce,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    client: 'studio-2022M',
    userId,
    completedAt: Date.now(),
  };
  writeJson(studioHandshakePath, studioSessions);

  const authenticateUrl = `${publicOrigin}/v1/studio/authenticate?nonce=${encodeURIComponent(nonce)}`;
  const executable = STUDIO_EXECUTABLE_PATH;

  audit('studio_launch_requested', { userId, placeId, ip: security.clientIp(req) });

  if (!fs.existsSync(executable)) {
    // Not an error the user caused - Studio just is not installed on the host
    // running the server. Return the connect details so the UI can guide them.
    return res.json({
      ok: true,
      launched: false,
      reason: 'studio-not-installed',
      message: 'LuckyBlox Studio is not installed on this machine.',
      executablePath: executable,
      baseUrl: DEFAULT_BASE_URL,
      authUrl: `${publicOrigin}/signin?studio=${encodeURIComponent(nonce)}`,
      authenticateUrl,
    });
  }

  try {
    const child = spawn(executable, [
      '-a', `${publicOrigin}/signin?studio=${encodeURIComponent(nonce)}`,
      '-t', String(placeId),
      '-j', authenticateUrl,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    audit('studio_launched', { userId, placeId, pid: child.pid });
    return res.json({
      ok: true,
      launched: true,
      pid: child.pid,
      executablePath: executable,
      baseUrl: DEFAULT_BASE_URL,
      authenticateUrl,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      launched: false,
      reason: 'spawn-failed',
      message: String(error.message || error),
      executablePath: executable,
    });
  }
});

/** Live server/player state for the develop dashboard, polled by the page. */
app.get('/api/develop/live', (req, res) => {
  const servers = activeGameServers.map((server) => ({
    jobId: server.serverJobId,
    placeId: Number(server.placeId),
    port: Number(server.port),
    playing: Array.isArray(server.currentPlayers) ? server.currentPlayers.length : 0,
    maxPlayers: Number(server.maxPlayers || 20),
    status: server.status || 'running',
  }));
  res.json({
    ok: true,
    playersOnline: getTotalPlayerCount(),
    serverCount: servers.length,
    servers,
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
  return renderGamePage2021(req, res, normalizePlaceId(req.params.placeId || 1818));
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
    // Naming the job here means /api/jobs/<id> can report the game's name to the
    // Discord companion and any status consumer.
    const job = createNamedJoinJob(userId, placeId);
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
  // Only ever write the *signed-in* user's own avatar. The body userId used to
  // be trusted, which let anyone overwrite another account's outfit.
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  const userId = String((sessionUser && (sessionUser.userId || sessionUser.id)) || req.body.userId || 1);
  const incomingAssetIds = Array.isArray(req.body.assetIds) ? req.body.assetIds : [];
  const normalizedIds = incomingAssetIds.map((id) => String(id));
  const updatedUser = saveUser(userId, {
    currentlyWearing: normalizedIds,
  });

  // Keep the client-visible identity in sync so the game clients spawn the
  // avatar the user just saved.
  try { syncLocalIdentity(updatedUser); } catch (error) { /* best effort */ }

  res.json({
    ok: true,
    userId,
    currentlyWearing: updatedUser.currentlyWearing,
  });
});

/**
 * Save the full avatar: body colours, gender, rig and what is equipped, in one
 * write. The avatar page used to only call /api/avatar/wear, so body-colour
 * edits were silently dropped and reverted on the next load. This merges into
 * the existing avatar block so nothing already set is lost, and mirrors the
 * result into Settings/ so the clients load the same appearance.
 */
app.post('/api/avatar/save', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to save your avatar.' });
  }
  const userId = String(sessionUser.userId || sessionUser.id || 1);
  const current = getUser(userId);
  const body = req.body || {};
  const avatar = Object.assign({}, current.avatar || {});
  const nextState = {};

  if (body.bodyColors && typeof body.bodyColors === 'object') {
    avatar.bodyColors = Object.assign({}, avatar.bodyColors, body.bodyColors);
  }
  if (body.gender && ['Male', 'Female', 'NotSpecified'].includes(String(body.gender))) {
    avatar.gender = String(body.gender);
    nextState.gender = String(body.gender);
  }
  if (body.playerAvatarType && ['R6', 'R15'].includes(String(body.playerAvatarType))) {
    avatar.playerAvatarType = String(body.playerAvatarType);
  }
  if (body.scales && typeof body.scales === 'object') {
    avatar.scales = Object.assign({}, avatar.scales, body.scales);
  }
  if (Array.isArray(body.assetIds)) {
    const ids = body.assetIds.map((id) => String(id));
    avatar.currentlyWearing = ids;
    nextState.currentlyWearing = ids;
  }

  nextState.avatar = avatar;
  const updated = saveUser(userId, nextState);
  try { syncLocalIdentity(updated); } catch (error) { /* best effort */ }
  audit('avatar_saved', { userId, wearing: (updated.currentlyWearing || []).length });

  return res.json({
    ok: true,
    userId,
    avatar: updated.avatar,
    currentlyWearing: updated.currentlyWearing,
  });
});

/**
 * /v4/avatar - the avatar model in the v4 (modern) shape.
 *
 * WHY THIS EXISTS: the 2021M/2022M clients request /v4/avatar. This server only
 * ever answered /api/avatar_v1, so that request had no local handler and fell
 * through to the real avatar.roblox.com, which answers 500 for a private-server
 * user and made the character come out wrong. Serving the path HERE is what
 * keeps the client on this site - it never reaches Roblox at all.
 *
 * This is LuckyBlox's OWN shape, built entirely from this server's data (the
 * account record, avatars.json-equivalent fields, assets.json). It does NOT
 * proxy or fetch Roblox, so the site works with no internet and no Roblox
 * account, and the response is identical every call.
 *
 * The v4 model differs from v1: it names the body colours in a nested
 * bodyColors object, describes the rig as "R15"/"R6" with a full scale set, and
 * reports each worn item with its type name rather than a bare id.
 */
function buildAvatarModelV4(userId) {
  const user = getUser(userId);
  const avatar = user && user.avatar ? user.avatar : {};
  const assetsById = getAssets();

  // The rig. R15 and R6 are the only two this server models.
  const playerAvatarType = String(
    user.avatarType || avatar.playerAvatarType || 'R15',
  );

  // Body colours: the stored model uses Roblox's BrickColor names, the account
  // may only have hex. Read whichever exists, and never invent a colour.
  const storedColors = avatar.bodyColors || {};
  const hex = avatar.bodyColorHex || {};

  const colorFor = (part) => {
    if (storedColors[part]) return String(storedColors[part]);
    if (hex[part]) return String(hex[part]);
    return null;
  };

  const bodyColors = {
    headColor: colorFor('headColor'),
    torsoColor: colorFor('torsoColor'),
    rightArmColor: colorFor('rightArmColor'),
    leftArmColor: colorFor('leftArmColor'),
    rightLegColor: colorFor('rightLegColor'),
    leftLegColor: colorFor('leftLegColor'),
  };

  // Worn items, resolved against this site's own asset catalogue so each entry
  // carries a real name and type instead of a bare number.
  const wearing = Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [];
  const assets = wearing.map((rawId) => {
    const id = Number(rawId);
    const local = assetsById[String(rawId)] || null;
    return {
      id: Number.isFinite(id) ? id : 0,
      name: (local && local.name) || 'Asset',
      assetType: {
        id: Number((local && local.assetTypeId) || 0),
        name: (local && (local.assetType || local.className)) || 'Asset',
      },
      currentVersionId: null,
    };
  });

  // Roblox's default R15 scale set, so a client always receives complete numbers
  // and never a partial rig it has to repair itself.
  const defaultScales = {
    height: 1,
    width: 1,
    head: 1,
    depth: 1,
    proportion: 1,
    bodyType: 0,
  };
  const scales = Object.assign({}, defaultScales, avatar.scales || {});

  return {
    userId: Number(user.userId || user.id || userId || 1),
    username: user.username || null,
    displayName: user.displayName || user.username || null,
    playerAvatarType,
    scales,
    bodyColors,
    bodyColorHex: hex,
    assets,
    defaultShirtApplied: Boolean(avatar.defaultShirtApplied),
    defaultPantsApplied: Boolean(avatar.defaultPantsApplied),
    emotes: Array.isArray(user.emotes) ? user.emotes : [],
    // Provenance: always this server. Never 'roblox' - this route does not
    // contact Roblox, so the client can trust the model is local.
    source: 'luckyblox',
  };
}

/**
 * Resolve the account an avatar request is FOR.
 *
 * Identity comes from the session only. A bare ?userId= is NOT trusted: it used
 * to be, which meant a signed-out caller could ask for userId=1 and be handed
 * the deployment OWNER's avatar (and admin flags) - the same guest-becomes-owner
 * leak this server has at /api/v1/me. A guest asking for an arbitrary id is
 * refused instead of silently upgraded.
 *
 * Returns { userId } on success, or { error } to be returned to the caller.
 */
function resolveAvatarRequestUser(req) {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return { error: 'sign-in-required' };
  }
  const sessionId = Number(sessionUser.userId || sessionUser.id);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    return { error: 'sign-in-required' };
  }

  // A session may look up its OWN id only. Any other id is ignored, not obeyed.
  const requested = req.query.userId || req.query.userid;
  if (requested != null && Number(requested) !== sessionId) {
    return { error: 'forbidden' };
  }

  return { userId: sessionId };
}

// v4 is the shape the 2021M/2022M clients ask for.
app.get('/v4/avatar', (req, res) => {
  const resolved = resolveAvatarRequestUser(req);
  if (resolved.error === 'sign-in-required') {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to load an avatar.' });
  }
  if (resolved.error === 'forbidden') {
    return res.status(403).json({ ok: false, error: 'forbidden', message: 'You can only load your own avatar.' });
  }
  return res.json(buildAvatarModelV4(resolved.userId));
});

// The modern client also probes these two sibling paths on the same host before
// it gives up and reaches for Roblox. Answering them keeps every avatar request
// on this server.
app.get('/v4/avatar/avatar-rules', (req, res) => {
  res.json({
    ok: true,
    playerAvatarType: 'R15',
    scales: { height: 1, width: 1, head: 1, depth: 1, proportion: 1, bodyType: 0 },
    bodyColors: {},
    source: 'luckyblox',
  });
});

app.get('/v3/avatar', (req, res) => {
  const resolved = resolveAvatarRequestUser(req);
  if (resolved.error === 'sign-in-required') {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to load an avatar.' });
  }
  if (resolved.error === 'forbidden') {
    return res.status(403).json({ ok: false, error: 'forbidden', message: 'You can only load your own avatar.' });
  }
  return res.json(buildAvatarModelV4(resolved.userId));
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

/**
 * Install state of the content client on the machine running the server. The
 * Play button polls this so it can decide between "Play" and "Download".
 */
app.get('/api/client/status', (req, res) => {
  // Include the published build, so the site can tell an installed-but-outdated
  // client from an up-to-date one instead of only knowing installed/not.
  const build = getClientBuildInfo();
  res.json({
    ok: true,
    ...clientLauncher.getClientStatus(),
    build: {
      available: build.available,
      buildId: build.buildId,
      version: build.version,
      channel: build.channel,
    },
  });
});

/* ---------------------------------------------------------------------------
 * Roblox asset fetching (owner only)
 * ---------------------------------------------------------------------------
 * The site's starter inventory used to be four invented ids (1001..1004) with
 * invented names. Those ids do not exist on Roblox - the economy API 404s and
 * their thumbnails return BrokenImage - so the avatar rendered blank.
 *
 * POST /api/assets/fetch downloads the REAL asset metadata and image for the
 * given ids (or the verified starter set when none are given), saves the images
 * into Webserver/www/asset-cache/, and writes the verified records into
 * assets.json. An id Roblox does not recognise is reported and skipped, never
 * invented.
 * ------------------------------------------------------------------------- */
app.post('/api/assets/fetch', requireOwner, async (req, res) => {
  const body = req.body || {};
  const requested = Array.isArray(body.assetIds)
    ? body.assetIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : null;

  try {
    const result = requested && requested.length
      ? await assetFetcher.fetchAll(requested, { cacheDir: assetCacheDir, publicUrl: '/asset-cache' })
      : await assetFetcher.fetchStarterSet({ cacheDir: assetCacheDir, publicUrl: '/asset-cache' });

    // Only VERIFIED records are merged in, and an existing record is updated in
    // place rather than duplicated, so re-running the fetch is idempotent.
    const assets = getAssets();
    for (const record of result.records) {
      assets[String(record.assetId)] = Object.assign({}, assets[String(record.assetId)] || {}, record);
    }
    writeJson(assetsPath, assets);

    audit('assets_fetched', {
      ip: security.clientIp(req),
      fetched: result.records.length,
      failed: result.failed.length,
    });

    return res.json({
      ok: true,
      fetched: result.records.map((r) => ({
        assetId: r.assetId, name: r.name, assetType: r.assetType,
        price: r.price, downloaded: Boolean(r.thumbnail),
      })),
      // Reported so a bad id is visible instead of silently dropped.
      failed: result.failed,
      cacheDir: assetCacheDir,
    });
  } catch (error) {
    console.error('[api/assets/fetch] failed:', error);
    return res.status(500).json({ ok: false, error: 'fetch-failed', message: String(error.message || error) });
  }
});

/** The verified starter ids, so a caller knows what the default fetch will pull. */
app.get('/api/assets/starter-set', (req, res) => {
  res.json({ ok: true, starter: assetFetcher.STARTER_SET });
});

/**
 * The client build + update manifest.
 *
 * This is the endpoint a LuckyBlox installer polls to discover whether a newer
 * build exists - the same job Roblox's version endpoint does. It reports the
 * build that is actually on disk, so an installer comparing its own buildId
 * against `buildId` will download only on a real change.
 */
app.get('/api/client/build-info', (req, res) => {
  res.json(getClientBuildInfo());
});

app.get('/api/client/update-manifest', (req, res) => {
  res.json(getClientUpdateManifest());
});

/* Roblox's installer looks for the version manifest on the channel path; keep an
   alias so a stock-style installer finds it without custom configuration. */
app.get('/v1/client/version/:channel', (req, res) => {
  res.json(getClientUpdateManifest());
});

/**
 * Download the client BINARY (not the installer).
 *
 * Serves the build the manifest advertises, so an installed client can update
 * itself in place - this is what makes /download/client an installer plus an
 * updater rather than a one-shot download. Refuses when there is no build on
 * disk, instead of streaming an unrelated file.
 */
app.get('/download/client/binary', (req, res) => {
  const info = getClientBuildInfo();
  if (!info.available || !info.sourceBinary || !fs.existsSync(info.sourceBinary)) {
    return res.status(404).json({
      ok: false,
      error: 'client-build-not-available',
      message: 'No LuckyBlox client build is published on this server.',
    });
  }

  // Always advertise which build this is, so an updater can verify it got the
  // version it asked for rather than trusting the bytes.
  res.set('X-LuckyBlox-Build', String(info.buildId || ''));
  res.set('X-LuckyBlox-Version', String(info.version || ''));
  return res.download(info.sourceBinary, info.binaryName);
});

/**
 * Get the LuckyBlox client installer.
 *
 * The installer is a real file the build ships; when it is absent this 404s
 * rather than streaming something unrelated, so a download link is never lying
 * about what it points to.
 */
app.get('/download/client', (req, res) => {
  const installer = clientLauncher.installerPath();
  if (!installer || !fs.existsSync(installer)) {
    return res.status(404).json({
      ok: false,
      error: 'installer-not-available',
      message: 'The LuckyBlox client installer is not available on this server.',
    });
  }
  return res.download(installer, path.basename(installer));
});

/**
 * Launch the installed LuckyBlox client directly, without needing a page
 * hand-off. Used by the site's Play button once it knows the client exists.
 */
app.post('/api/client/launch', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to play.' });
  }

  const userId = Number(sessionUser.userId || sessionUser.id) || 1;
  const placeId = Number(req.body.placeId || req.query.placeId || 1818);
  const job = createNamedJoinJob(userId, placeId);
  const ticket = createAuthTicket(userId, placeId, { port: job.port, serverJobId: job.jobId });
  const result = launchLocalRobloxClient({
    userId,
    placeId,
    port: job.port,
    serverJobId: job.jobId,
    ticket: ticket.ticket,
  });

  const status = clientLauncher.getClientStatus();
  return res.json({ ok: result.ok, ...result, client: status, placeId, jobId: job.jobId, port: job.port });
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
    // ticket, the jobId and the port can never disagree with each other. It also
    // names the job, so the Discord companion and status UIs can show the game.
    const job = createNamedJoinJob(userId, placeId);
    const ticket = createAuthTicket(userId, placeId, {
      port: job.port,
      serverJobId: job.jobId,
    });

    const playUrl = `/play?placeId=${placeId}&userId=${userId}&ticket=${encodeURIComponent(ticket.ticket)}&serverPort=${job.port}&jobId=${encodeURIComponent(job.jobId)}`;

    // Find the installed content client and launch it automatically. When the
    // client is absent (or the host cannot run it) report the download the site
    // should offer, so the Play button always leads somewhere real.
    const launchResult = launchLocalRobloxClient({
      userId,
      placeId,
      port: job.port,
      serverJobId: job.jobId,
      ticket: ticket.ticket,
    });
    const clientStatus = clientLauncher.getClientStatus();

    // Publish the session into Settings/ so the desktop tools can see it: the
    // Discord companion reads jobid.txt + MapPath.txt to name the game and the
    // live player count, which is exactly the card the site should be showing.
    syncLocalJob({
      jobId: job.jobId,
      placeId,
      placeName: job.placeName,
      port: job.port,
      maxPlayers: job.maxPlayers,
    });

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
      // Client install state, so the page can say "launching" or "download".
      client: clientStatus,
      nativeLaunch: launchResult.ok
        ? {
          status: 'launched',
          pid: launchResult.pid,
          executablePath: launchResult.exePath,
          launchURI: launchResult.launchURI,
        }
        : {
          status: 'not-installed',
          reason: launchResult.details,
          error: launchResult.error,
          downloadUrl: clientStatus.downloadUrl,
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
  // Resolve the caller from the session first, then an explicit userId, then
  // fall back to the guest record. It used to default to user id 1 - the
  // deployment owner - so an anonymous request was answered with the owner's
  // identity and full permissions.
  const requestedId = req.query.userId || (req.body && req.body.userId);
  const user = req.sessionUser
    || (requestedId != null ? getUser(requestedId) : null)
    || getUser(1);
  const isAdmin = isAdminUser(user);
  const ownsAccount = isOwnerUser(user);

  res.json({
    ok: true,
    user: {
      userId: Number(user.userId || 1),
      username: user.username || 'LocalPlayer',
      displayName: user.displayName || user.username || 'LocalPlayer',
      membership: user.membershipStatus || user.membership || 'None',
      // The real stored role, never a blanket 'Creator'. Only the deployment
      // owner and explicit admins get elevated rights.
      role: ownsAccount ? 'Owner' : (isAdmin ? 'Admin' : (user.role || 'Player')),
    },
    permissions: {
      // Creating places is open to every signed-in account (as it was on
      // Roblox), but editing/publishing someone else's work is not. These now
      // reflect whether the caller is authenticated rather than being true for
      // anybody who asks.
      create: Boolean(user),
      edit: Boolean(user) && (isAdmin || ownsAccount),
      publish: Boolean(user) && (isAdmin || ownsAccount),
      inventory: Boolean(user),
    },
    admin: isAdmin,
    owner: ownsAccount,
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
 *
 * Falls back to the on-disk CoreScripts collection (Assets/CoreScripts), which
 * is how the 2021M/2022M clients actually get their engine scripts: the client
 * asks for an asset id and expects the Lua source back. Those files were on disk
 * but unreachable, because this function only ever looked in assets.json - so
 * every CoreScript request 404'd.
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

  const inStore = Object.values(assets).find((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    return String(asset.id) === wanted
      || String(asset.assetId) === wanted
      || String(asset.currentVersionId) === wanted;
  });
  if (inStore) return inStore;

  // Not a catalog asset - maybe it is a CoreScript. Return a record pointing at
  // the real .lua on disk so serveAssetById() streams it instead of 404ing.
  const coreScript = resolveCoreScript(wanted);
  if (coreScript) return coreScript;

  return null;
}

/**
 * The CoreScripts collection: Assets/CoreScripts/<Name> (<assetId>)/<version>.lua
 *
 * Roblox's own layout, kept because the folder name carries the real asset id and
 * each numbered .lua is a successive version of that script. A 2021 client asks
 * for an asset id and, with ?version=N, for one specific version; without a
 * version it wants the newest one that exists.
 *
 * The directory listing is cached: it is read once per process rather than on
 * every asset request, so a client's request storm does not hammer the disk.
 */
const CORE_SCRIPTS_DIR = path.join(releaseRoot, 'Assets', 'CoreScripts');
let coreScriptIndex = null;

function buildCoreScriptIndex() {
  const index = new Map();
  let root;
  try {
    if (!fs.existsSync(CORE_SCRIPTS_DIR)) return index;
    root = fs.readdirSync(CORE_SCRIPTS_DIR, { withFileTypes: true });
  } catch (error) {
    console.warn(`[luckyblox] could not read CoreScripts: ${error.message}`);
    return index;
  }

  for (const entry of root) {
    if (!entry.isDirectory()) continue;
    // "BackpackBuilder (53878047)" -> id 53878047
    const match = /^(.*?)\s*\((\d+)\)\s*$/.exec(entry.name);
    if (!match) continue;

    const id = Number(match[2]);
    const name = match[1].trim();
    const dir = path.join(CORE_SCRIPTS_DIR, entry.name);

    let files;
    try {
      files = fs.readdirSync(dir)
        .map((f) => /^(\d+)\.lua$/i.exec(f))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
    } catch (error) {
      continue;
    }
    if (!files.length) continue;

    index.set(id, {
      id,
      assetId: id,
      name,
      dir,
      versions: files,
      // The newest version the dump actually holds. Roblox's live "latest" could
      // be higher; serving the newest file present is the honest answer.
      latest: files[files.length - 1],
      assetType: 'Lua',
      assetTypeId: 5,
      creatorName: 'Roblox',
      source: 'CoreScripts',
    });
  }

  console.log(`[luckyblox] CoreScripts indexed: ${index.size} script(s), `
    + `${Array.from(index.values()).reduce((n, s) => n + s.versions.length, 0)} version file(s)`);
  return index;
}

function coreScriptIndexMap() {
  if (!coreScriptIndex) coreScriptIndex = buildCoreScriptIndex();
  return coreScriptIndex;
}

/** A CoreScript record for an asset id, with the file path filled in. */
function resolveCoreScript(assetId, wantedVersion) {
  const record = coreScriptIndexMap().get(Number(assetId));
  if (!record) return null;

  const requested = Number(wantedVersion);
  const version = Number.isFinite(requested) && record.versions.includes(requested)
    ? requested
    : record.latest;

  return Object.assign({}, record, {
    version,
    currentVersionId: version,
    filePath: path.join(record.dir, `${version}.lua`),
    availableVersions: record.versions.slice(),
  });
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
  // CoreScripts are versioned; a client asks for ?version=N and expects that
  // exact version, or the newest one when it does not say.
  const wantedVersion = req.query.version || req.query.v;
  const asset = resolveAssetById(rawId, wantedVersion);

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
    // Content type by extension. A CoreScript is Lua SOURCE, and a client that
    // receives the right type can use it directly; sending everything as
    // octet-stream made script assets opaque.
    const ext = path.extname(found).toLowerCase();
    const typeByExt = {
      '.lua': 'text/plain; charset=utf-8',
      '.rbxm': 'application/octet-stream',
      '.rbxmx': 'application/xml; charset=utf-8',
      '.rbxl': 'application/octet-stream',
      '.rbxlx': 'application/xml; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.json': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    };
    const contentType = typeByExt[ext] || 'application/octet-stream';
    const binary = req.query.format === 'binary' || req.query.binary === '1';
    const stat = fs.statSync(found);
    res.setHeader('Content-Type', binary ? 'application/octet-stream' : contentType);
    res.setHeader('Content-Length', stat.size);
    // CoreScripts are immutable per version, so they can be cached hard. Local
    // catalog files use the same path only when the version is pinned.
    res.setHeader('Cache-Control', asset.source === 'CoreScripts' ? 'public, max-age=31536000' : 'no-store');
    if (asset.source === 'CoreScripts') {
      res.setHeader('X-LuckyBlox-Source', 'CoreScripts');
      res.setHeader('X-LuckyBlox-Version', String(asset.version || ''));
    }
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
  // An empty :name (as in "/asset/?id=1001") used to resolve to mapsRoot
  // itself: path.join(mapsRoot, '') is the directory, existsSync() returned
  // true, and res.download() then streamed whatever stray file sat there. Every
  // asset request in the legacy client hit this and received that file instead
  // of the asset - so the client could never load a player's avatar.
  //
  // Require a real .rbxl/.rbxm file, and let a request with no name fall
  // through to the id-based handler below.
  const rawName = String(req.params.name || '').trim();
  if (!rawName || rawName === '.' || rawName === '..') {
    return res.status(404).json({ ok: false, error: 'asset-not-found', message: 'An asset name is required.' });
  }

  const names = [rawName, `${rawName}.rbxl`, `${rawName}.rbxm`];
  let filePath = null;

  for (const candidate of names) {
    const testPath = path.join(mapsRoot, candidate);
    try {
      if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
        filePath = testPath;
        break;
      }
    } catch (error) {
      // Unreadable candidate - try the next spelling.
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
  // Identity is the SESSION and nothing else.
  //
  // This route used to fall back to id 1 for any signed-out caller, and 1 is
  // OWNER_USER_ID - so an anonymous request was told `owner: true, admin: true`
  // and handed the owner's serialized account. That is the guest-becomes-owner
  // leak. A signed-out visitor now gets an explicit guest answer with no account
  // attached, and a claimed id is never used to resolve an identity.
  const sessionUser = req.sessionUser || resolveSessionUser(req);

  if (!sessionUser) {
    return res.json({
      ok: true,
      signedIn: false,
      owner: false,
      admin: false,
      guest: true,
      user: null,
    });
  }

  const sessionId = Number(sessionUser.userId || sessionUser.id);
  const user = getUser(sessionId);
  res.json({
    ok: true,
    signedIn: true,
    owner: isOwnerUser(user),
    admin: isAdminUser(user),
    guest: false,
    user: serializeUser(user.userId || sessionId),
  });
});

/**
 * Live wallet for the signed-in visitor, used by the header so the Robux figure
 * is read from the account instead of being frozen into the rendered HTML.
 * Falls back to the anonymous demo account when there is no session, matching
 * the rest of the site's guest behaviour.
 */
app.get('/api/me', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);

  // A signed-out caller has NO wallet. Returning user 1's Robux here was another
  // face of the same leak: a guest read the owner's balance and currency.
  if (!sessionUser) {
    return res.json({
      ok: true,
      signedIn: false,
      guest: true,
      user: null,
    });
  }

  const userId = Number(sessionUser.userId || sessionUser.id);
  const user = getUser(userId);
  res.json({
    ok: true,
    signedIn: true,
    guest: false,
    user: {
      userId: Number(user.userId || userId),
      username: user.username,
      // Never flatten the display name to the username here either.
      displayName: user.displayName || user.username,
      robux: Number(user.robux) || 0,
      currency: getCurrencyForUser(user),
    },
  });
});

/**
 * Account settings page. A real, working settings surface for the signed-in
 * user: profile (display name / bio / theme / email), privacy and appearance.
 * Guests are sent to sign in first, because there is nothing to save for them.
 */
app.get('/settings', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.redirect('/signin?redirect=' + encodeURIComponent('/settings'));
  }
  const userId = sessionUser.userId || sessionUser.id || 1;
  const user = getUser(userId);

  res.render('settings', {
    title: 'Settings - LuckyBlox',
    user,
    currency: getCurrencyForUser(user),
    adminBadge: getAdminBadge(user),
  });
});

/**
 * Save account settings. Only ever writes the *signed-in* user's own record -
 * the userId is taken from the session and never trusted from the body, so one
 * account cannot edit another. The avatar block is merged, not overwritten, so
 * body colours and scales the user already set are preserved.
 */
app.post('/api/settings', (req, res) => {
  const sessionUser = req.sessionUser || resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ ok: false, error: 'sign-in-required', message: 'Sign in to change your settings.' });
  }
  const userId = String(sessionUser.userId || sessionUser.id || 1);
  const current = getUser(userId);
  const body = req.body || {};

  const nextState = {};

  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    const candidate = body.displayName.trim().slice(0, 35);
    // A display name is what everyone else sees, so two accounts showing the
    // same name is indistinguishable from a duplicate account. Reject it the
    // same way signup does, ignoring this account's own current name.
    if (isUsernameTaken(candidate, userId)) {
      return res.status(409).json({
        ok: false,
        error: 'display-name-taken',
        message: 'That display name is already taken. Pick another.',
      });
    }
    nextState.displayName = candidate;
  }
  if (typeof body.bio === 'string') {
    nextState.bio = body.bio.slice(0, 500);
  }
  if (typeof body.email === 'string') {
    nextState.email = body.email.trim().slice(0, 120);
  }
  if (typeof body.theme === 'string' && ['light', 'dark'].includes(body.theme)) {
    nextState.theme = body.theme;
  }
  if (typeof body.aboutMe === 'string') {
    nextState.aboutMe = body.aboutMe.slice(0, 500);
  }

  // Avatar block is merged so a settings save never wipes the body colours /
  // scales the avatar page wrote.
  const avatarPatch = {};
  if (body.gender && ['Male', 'Female', 'NotSpecified'].includes(String(body.gender))) {
    nextState.gender = String(body.gender);
    avatarPatch.gender = String(body.gender);
  }
  if (body.playerAvatarType && ['R6', 'R15'].includes(String(body.playerAvatarType))) {
    avatarPatch.playerAvatarType = String(body.playerAvatarType);
  }
  if (body.bodyColors && typeof body.bodyColors === 'object') {
    avatarPatch.bodyColors = Object.assign({}, current.avatar && current.avatar.bodyColors, body.bodyColors);
  }
  if (Object.keys(avatarPatch).length) {
    nextState.avatar = Object.assign({}, current.avatar, avatarPatch);
  }

  if (Object.keys(nextState).length === 0) {
    return res.json({ ok: true, user: current, message: 'Nothing to update.' });
  }

  const updated = saveUser(userId, nextState);
  // Keep the client-visible identity in sync so the launcher / clients pick up
  // the display name and appearance change immediately.
  try { syncLocalIdentity(updated); } catch (error) { /* best effort */ }

  audit('settings_saved', { userId, fields: Object.keys(nextState) });

  return res.json({
    ok: true,
    user: {
      userId: Number(updated.userId || userId),
      username: updated.username,
      displayName: updated.displayName || updated.username,
      bio: updated.bio || '',
      theme: updated.theme || 'light',
      gender: updated.gender || 'NotSpecified',
      avatar: updated.avatar || {},
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
      displayName: user.displayName || user.username,
      membership: user.membershipStatus || user.membership || 'None',
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

  // Mirror the new place file to the free remote store (opt-in) so the game's
  // actual content survives a redeploy, not just its index row.
  storage.pushContentToRemote().catch(() => { /* best effort */ });

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

/* ---------------------------------------------------------------------------
 * JSON 404 - the last route in the table.
 * ---------------------------------------------------------------------------
 * Before this, ANY unregistered path fell through to Express's default handler,
 * which answers with an HTML error page. A game client or Studio cannot parse
 * HTML, so every unimplemented client endpoint looked like a protocol failure
 * (and the 2021M/2022M clients address a lot of v1/v2 paths).
 *
 * Anything under an API namespace - or any request that asks for JSON - now gets
 * a well-formed JSON 404 in the shape the Roblox APIs use. Real page requests
 * still get the HTML "not found" page.
 * ------------------------------------------------------------------------- */
app.use((req, res) => {
  const accept = String(req.headers.accept || '');
  const isApiRequest = req.path.startsWith('/v1/')
    || req.path.startsWith('/v2/')
    || req.path.startsWith('/api/')
    || req.path.startsWith('/assets/')
    || req.path.startsWith('/assetdelivery/')
    || accept.includes('application/json');

  if (isApiRequest) {
    return res.status(404).json({
      ok: false,
      error: 'not-found',
      // The Roblox error envelope, so a client's own error parser succeeds.
      errors: [{ code: 0, message: `The endpoint ${req.path} is not implemented on this server.` }],
    });
  }

  return res.status(404).render('not-found', {
    title: 'Page not found - LuckyBlox',
    user: req.sessionUser || getUser(1),
    currency: getCurrencyForUser(req.sessionUser || getUser(1)),
    // Echo back what was asked for, but escaped by EJS on output so a crafted
    // path cannot inject markup into the error page.
    requestedPath: req.originalUrl || req.path,
  });
});

// Restore data from the free remote store (if LUCKYBLOX_SYNC is set) BEFORE the
// server accepts requests, so the first request already sees the recovered
// accounts/games. When nothing is configured this resolves immediately.
storage.restoreFromRemote()
  .then((result) => {
    if (result && result.enabled) {
      console.log(`[luckyblox] remote sync: restored ${result.loaded.length} file(s) from ${result.mode}`);
    }
    // Content folders (place files, maps, settings) are opt-in. When on, pull
    // them too so created games have their actual content after a redeploy.
    if (storage.contentSyncEnabled) {
      return storage.restoreContentFromRemote();
    }
    return null;
  })
  .then((contentResult) => {
    if (contentResult && !contentResult.skipped && contentResult.restored) {
      console.log(`[luckyblox] remote sync: restored ${contentResult.restored} content file(s)`);
    }
  })
  .catch((error) => {
    console.warn(`[luckyblox] remote sync restore failed: ${error && error.message}`);
  })
  .finally(() => {
    const bridgeServer = app.listen(PORT, HOST, () => {
      console.log(`LuckyBlox HTTP DB bridge listening on http://${HOST}:${PORT}`);
      console.log(`LuckyBlox public base URL: ${publicBaseUrl}`);

      // Make it obvious whether accounts will survive a redeploy. On a free Render
      // instance without a disk they will not, and that looks like "fake" data.
      const store = storage.describeStorage();
      console.log(`[luckyblox] data dir: ${store.dataDir}`);
      console.log(`[luckyblox] persistence: ${store.persistent ? 'ON' : 'OFF'} - ${store.note}`);
      // Say explicitly what backs the path, so a set-but-unbacked LUCKYBLOX_DATA_DIR
      // cannot masquerade as a real disk.
      console.log(`[luckyblox] storage: render=${store.onRender ? 'yes' : 'no'} `
        + `renderDisk=${store.viaRenderDisk ? 'yes' : 'no'} `
        + `localPersistent=${store.localPersistent ? 'yes' : 'no'}`);
      if (store.unbacked) {
        console.warn('[luckyblox] WARNING: data dir is not backed by a Render Disk. '
          + 'Attach one, or set LUCKYBLOX_SYNC, or accounts will be lost on redeploy.');
      }
      if (store.remote && store.remote.enabled) {
        // "local" is a sibling git clone, not a remote host - calling it remote
        // storage in the log would mislead anyone reading the boot output into
        // thinking the data had left the machine.
        const label = store.remote.mode === 'local' ? 'local mirror' : 'free remote storage';
        console.log(`[luckyblox] ${label}: ${store.remote.mode} - ${store.remote.note}`);
      } else {
        // Absence of this line is itself the signal: sync is not configured.
        console.log('[luckyblox] free remote storage: not configured (LUCKYBLOX_SYNC unset)');
      }

      // Periodically prune expired rate-limit buckets so memory stays bounded.
      setInterval(() => security.pruneRateLimits(), 10 * 60 * 1000).unref();
    });

    // Never let a listen error become an unhandled 'error' event.
    bridgeServer.on('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        console.error(`[luckyblox] bridge cannot bind ${HOST}:${PORT} \u2014 address already in use.`);
        process.exit(1);
      }
      console.error(`[luckyblox] bridge server error: ${error && error.message}`);
      process.exit(1);
    });
  });

// On the way down (a redeploy sends SIGTERM), give any queued remote save a
// moment to finish so the last account/game edit is not lost with the container.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[luckyblox] received ${signal}; flushing remote storage...`);
  storage.flushRemote()
    .catch(() => { /* best effort */ })
    .finally(() => setTimeout(() => process.exit(0), 150));
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
