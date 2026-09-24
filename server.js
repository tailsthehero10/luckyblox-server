const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  bindHost,
  publicPort,
  legacyPort,
  bridgePort,
  bridgeHost,
  publicBaseUrl,
  gamePort,
} = require('./server/runtimeConfig');

const rootDir = __dirname;
const savedPlacesDir = path.join(rootDir, 'saved_places');

// ---------------------------------------------------------------------------
// Which client are we serving?
//
// The launcher records the chosen client in Settings/SelectedClient.txt (e.g.
// "2021M"). AppSettings.xml and ClientSettings/ are per-client files, so serving
// them from a hardcoded folder hands the wrong client the wrong URLs - 2021M
// needs a trailing /home/ that 2022M does not have. Resolve it per request and
// fall back to the default only when the setting is missing or unknown.
// ---------------------------------------------------------------------------
const DEFAULT_CLIENT = '2022M';
const clientsRoot = path.join(rootDir, 'Clients');

function readSelectedClient() {
  try {
    const file = path.join(rootDir, 'Settings', 'SelectedClient.txt');
    if (!fs.existsSync(file)) return '';
    const value = String(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '').trim();
    // Guard against a crafted value escaping the Clients folder.
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
  } catch (error) {
    return '';
  }
}

/**
 * The client folder to read settings from. Prefers SelectedClient.txt, then the
 * static default when that has an AppSettings.xml, so behaviour never
 * regresses to a hard 404.
 */
function resolveClientDir() {
  const selected = readSelectedClient();
  if (selected) {
    const candidate = path.join(clientsRoot, selected);
    if (fs.existsSync(path.join(candidate, 'AppSettings.xml'))) {
      return candidate;
    }
  }

  return path.join(clientsRoot, DEFAULT_CLIENT);
}

if (!fs.existsSync(savedPlacesDir)) {
  fs.mkdirSync(savedPlacesDir, { recursive: true });
}

const activeRooms = [];
const users = [
  {
    id: '1',
    username: 'SystemAdmin',
    displayName: 'SystemAdmin',
    joinDate: 'Sep 2020',
    bio: 'Building low-spec Roblox experiences and local launch flows for the LuckyBlox revival project.',
    robux: 4500,
    avatar: 'https://placehold.co/120x120/232527/ffffff?text=SA',
    stats: { followers: 2831, following: 412, friends: 142, games: 27, placeVisits: 8962 }
  },
  {
    id: '2',
    username: 'Derek',
    displayName: 'Derek',
    joinDate: 'Jan 2021',
    bio: 'Explorer, builder, and classic experience fan who loves all old block-based worlds.',
    robux: 2700,
    avatar: 'https://placehold.co/120x120/232527/ffffff?text=D',
    stats: { followers: 1215, following: 204, friends: 83, games: 19, placeVisits: 5109 }
  }
];

const games = [
  {
    id: '2022M',
    title: 'Production 2022M Server Room',
    developer: 'SystemAdmin',
    genre: 'Adventure',
    players: 42,
    favorites: 612,
    likes: 84,
    dislikes: 16,
    description: 'A classic blocky survival experience designed for local live hosting and low-spec play sessions.'
  },
  {
    id: '2021M',
    title: 'Classic 2021M Town',
    developer: 'SystemAdmin',
    genre: 'Social',
    players: 31,
    favorites: 482,
    likes: 82,
    dislikes: 18,
    description: 'A local throwback social hub built to recreate the familiar dark Roblox style.'
  },
  {
    id: '2018M',
    title: 'Tower Rush',
    developer: 'Derek',
    genre: 'Action',
    players: 19,
    favorites: 304,
    likes: 78,
    dislikes: 22,
    description: 'A compact old-school platforming challenge with a lean server model and direct client launch support.'
  }
];

const catalogItems = [
  { id: 'hat-1', name: 'Classic Fedora', type: 'Hat', price: 150, color: '#E3E3E3' },
  { id: 'hat-2', name: 'Builder Cap', type: 'Hat', price: 180, color: '#B8B8B8' },
  { id: 'shirt-1', name: 'Brickwave Tee', type: 'Shirt', price: 90, color: '#00B06F' },
  { id: 'shirt-2', name: 'Night Guard Top', type: 'Shirt', price: 120, color: '#00A2FF' },
  { id: 'pants-1', name: 'Cargo Gray', type: 'Pants', price: 85, color: '#B8B8B8' },
  { id: 'gear-1', name: 'Build Hammer', type: 'Gear', price: 220, color: '#FFD166' },
  { id: 'gear-2', name: 'Launch Device', type: 'Gear', price: 260, color: '#00B06F' }
];

const places = [
  { id: '2022M', name: 'Production 2022M Server Room', status: 'Published', owner: 'SystemAdmin' },
  { id: '2021M', name: 'Classic 2021M Town', status: 'Published', owner: 'SystemAdmin' },
  { id: '2018M', name: 'Tower Rush', status: 'Draft', owner: 'Derek' }
];

function generateTicket() {
  return 'T_' + crypto.randomBytes(12).toString('hex');
}

function generateJobId() {
  return 'J_' + crypto.randomBytes(8).toString('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '127.0.0.1';
  if (socketIp === '::1' || socketIp === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }

  if (socketIp.startsWith('::ffff:')) {
    return socketIp.replace('::ffff:', '');
  }

  return socketIp;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        resolve({ raw });
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function serveHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function renderPartialLayout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="/css/roblox.css" />
</head>
<body>
  <header class="rbx-header">
    <div style="display:flex; align-items:center;">
      <div class="rbx-logo"></div>
      <a href="/home" class="rbx-nav-link" style="margin-left:15px;">Discover</a>
      <a href="/games" class="rbx-nav-link">Games</a>
      <a href="/develop" class="rbx-nav-link">Create</a>
      <a href="/users/1/profile" class="rbx-nav-link">Profile</a>
    </div>
    <div>
      <span class="rbx-nav-link" style="color: var(--rbx-green);">R$ 4,500</span>
    </div>
  </header>

  <div class="roblox-container">
    <nav class="rbx-sidebar">
      <a href="/home" class="sidebar-item">Home</a>
      <a href="/users/1/profile" class="sidebar-item">Profile</a>
      <a href="/games" class="sidebar-item">Games</a>
      <a href="/catalog" class="sidebar-item">Catalog</a>
      <a href="/develop" class="sidebar-item">Develop</a>
      <a href="/signin" class="sidebar-item">Sign in</a>
      <a href="/inventory" class="sidebar-item">Inventory</a>
    </nav>

    <main class="rbx-main-content">
      ${bodyHtml}
    </main>
  </div>
</body>
</html>`;
}

function renderHomePage() {
  const cards = games.map((game) => `
    <a href="/games/${game.id}/about" class="rbx-game-tile">
      <div class="rbx-thumb"></div>
      <div class="rbx-card-meta">
        <strong>${game.title}</strong>
        <span>${game.genre}</span>
      </div>
    </a>
  `).join('');

  return renderPartialLayout('LuckyBlox Home', `
    <div class="rbx-hero-panel">
      <div class="rbx-hero-left">
        <div class="rbx-avatar-box">
          <div class="rbx-avatar-thumb"></div>
        </div>
      </div>
      <div class="rbx-hero-right">
        <div class="rbx-page-label">Welcome back</div>
        <h1 class="rbx-h1">SystemAdmin</h1>
        <div class="rbx-stat-strip">
          <div><strong>1,285</strong><span>Followers</span></div>
          <div><strong>27</strong><span>Games</span></div>
          <div><strong>42</strong><span>Friends</span></div>
        </div>
      </div>
    </div>

    <div class="rbx-section-header">Recent games</div>
    <div class="rbx-grid">
      ${cards}
    </div>
  `);
}

function renderProfilePage(userId) {
  const user = users.find((entry) => entry.id === String(userId)) || users[0];

  const inventoryRows = [
    ['Classic Fedora', 'Hat', 'R\$ 150'],
    ['Brickwave Tee', 'Shirt', 'R\$ 90'],
    ['Cargo Gray', 'Pants', 'R\$ 85'],
    ['Launch Device', 'Gear', 'R\$ 260']
  ].map((row) => `
    <div class="rbx-inventory-row">
      <span>${row[0]}</span>
      <span>${row[1]}</span>
      <span>${row[2]}</span>
    </div>
  `).join('');

  return renderPartialLayout('Profile - LuckyBlox', `
    <div class="rbx-profile-header">
      <div class="rbx-profile-avatar"></div>
      <div class="rbx-profile-main">
        <h1 class="rbx-h1">${user.displayName}</h1>
        <p class="rbx-muted">@${user.username}</p>
        <div class="rbx-stat-strip small">
          <div><strong>${user.stats.followers}</strong><span>Followers</span></div>
          <div><strong>${user.stats.friends}</strong><span>Friends</span></div>
          <div><strong>${user.stats.games}</strong><span>Games</span></div>
        </div>
      </div>
    </div>

    <div class="rbx-two-column">
      <div class="rbx-panel">
        <div class="rbx-panel-title">About</div>
        <div class="rbx-panel-body">
          <p class="rbx-muted">Joined ${user.joinDate}</p>
          <p>${user.bio}</p>
        </div>
      </div>

      <div class="rbx-panel">
        <div class="rbx-panel-title">Statistics</div>
        <div class="rbx-panel-body">
          <div class="rbx-stat-list">
            <span>Followers</span><strong>${user.stats.followers}</strong>
            <span>Following</span><strong>${user.stats.following}</strong>
            <span>Friends</span><strong>${user.stats.friends}</strong>
            <span>Place Visits</span><strong>${user.stats.placeVisits}</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="rbx-panel">
      <div class="rbx-panel-title">Inventory</div>
      <div class="rbx-panel-body inventory">
        <div class="rbx-inventory-head">
          <span>Item</span>
          <span>Type</span>
          <span>Price</span>
        </div>
        ${inventoryRows}
      </div>
    </div>
  `);
}


function renderGamePage(gameId) {
  const game = games.find((entry) => entry.id === String(gameId)) || games[0];

  const likesPercent = game.likes;
  const dislikesPercent = game.dislikes;

  return renderPartialLayout('Game Details', `
    <div class="rbx-game-card">
      <div class="rbx-thumbnail"></div>
      <div>
        <h1 class="rbx-h1 game-title">${game.title}</h1>
        <p class="rbx-muted">By <a href="/users/1/profile" class="rbx-link">${game.developer}</a></p>
        <button class="rbx-play-button" id="gameLaunchButton">Play</button>
      </div>
    </div>

    <div class="rbx-panel" style="margin-top: 24px;">
      <div class="rbx-panel-title">Game details</div>
      <div class="rbx-panel-body">
        <div class="rbx-meta-line">
          <span>Genre: ${game.genre}</span>
          <span>Players: ${game.players}</span>
          <span>Favorites: ${game.favorites}</span>
        </div>
        <p class="rbx-muted">${game.description}</p>
      </div>
    </div>

    <div class="rbx-panel" style="margin-top: 24px;">
      <div class="rbx-panel-title">Votes</div>
      <div class="rbx-panel-body">
        <div class="rbx-vote-row">
          <span>Likes</span>
          <div class="rbx-bar"><div class="rbx-bar-fill" style="width:${likesPercent}%"></div></div>
          <strong>${likesPercent}%</strong>
        </div>
        <div class="rbx-vote-row">
          <span>Dislikes</span>
          <div class="rbx-bar"><div class="rbx-bar-fill bad" style="width:${dislikesPercent}%"></div></div>
          <strong>${dislikesPercent}%</strong>
        </div>
      </div>
    </div>

    <script>
      document.getElementById('gameLaunchButton').addEventListener('click', async function () {
        try {
          const response = await fetch('/v1/authentication-tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placeId: '${game.id}' })
          });

          const data = await response.json();
          if (!data || !data.ok || !data.ticket) {
            alert('Unable to generate ticket.');
            return;
          }

          const placeId = '${game.id}';
          window.location.href = "luckyblox-player:1+launchmode:" + data.launchMode + "+gameinfo:" + data.ticket + "+placeId:" + placeId + "+serverIp:" + data.hostIp + "+serverPort:" + data.port + "+jobId:" + data.serverJobId;
        } catch (error) {
          alert('LuckyBlox failed to launch.');
        }
      });
    </script>
  `);
}

function renderCatalogPage() {
  const items = catalogItems.map((item) => `
    <div class="rbx-store-item">
      <div class="rbx-store-icon" style="background:${item.color};"></div>
      <div class="rbx-store-text">
        <strong>${item.name}</strong>
        <span>${item.type}</span>
      </div>
      <div class="rbx-store-price">R$ ${item.price}</div>
    </div>
  `).join('');

  return renderPartialLayout('Catalog', `
    <div class="rbx-section-header">Catalog</div>
    <div class="rbx-store-grid">
      ${items}
    </div>
  `);
}

function renderDevelopPage() {
  const rows = places.map((place) => `
    <div class="rbx-dev-row">
      <span>${place.name}</span>
      <span>${place.owner}</span>
      <span>${place.status}</span>
    </div>
  `).join('');

  return renderPartialLayout('Develop', `
    <div class="rbx-section-header">Create</div>
    <div class="rbx-panel">
      <div class="rbx-panel-title">Your places</div>
      <div class="rbx-panel-body">
        <div class="rbx-dev-head">
          <span>Experience</span>
          <span>Owner</span>
          <span>Status</span>
        </div>
        ${rows}
      </div>
    </div>
  `);
}

function registerPlayer(placeId, ip) {
  let room = activeRooms.find((entry) => entry.placeId === placeId && entry.players.length < 6);

  if (!room) {
    room = {
      placeId,
      jobId: generateJobId(),
      hostIp: ip,
      port: gamePort,
      players: []
    };

    activeRooms.push(room);
  }

  const player = {
    ticket: generateTicket(),
    ip,
    connectedAt: Date.now()
  };

  room.players.push(player);

  if (room.players.length === 1) {
    return {
      ok: true,
      launchMode: 'host',
      ticket: player.ticket,
      placeId,
      hostIp: room.hostIp,
      port: room.port,
      serverJobId: room.jobId
    };
  }

  return {
    ok: true,
    launchMode: 'client',
    ticket: player.ticket,
    placeId,
    hostIp: room.hostIp,
    port: room.port,
    serverJobId: room.jobId
  };
}

function handlePublish(req, res) {
  readBody(req)
    .then((payload) => {
      const body = payload && typeof payload === 'object' ? payload : {};
      const name = String(body.name || body.placeName || 'saved_place').replace(/[^a-zA-Z0-9_\- ]/g, '_');
      const rawData = body.data || body.contents || JSON.stringify(body, null, 2);
      const fileName = name + '.rbxl';
      const filePath = path.join(savedPlacesDir, fileName);
      fs.writeFileSync(filePath, rawData, 'utf8');

      sendJson(res, 200, {
        ok: true,
        status: 'published',
        name,
        file: fileName,
        path: filePath,
        savedAt: new Date().toISOString()
      });
    })
    .catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message || 'publish failed' });
    });
}

function handleAssetListing(req, res) {
  fs.readdir(savedPlacesDir, (err, files) => {
    if (err) {
      sendJson(res, 500, { ok: false, error: 'Unable to read saved places directory' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      files: files.filter((file) => file.endsWith('.rbxl') || file.endsWith('.rbxlx'))
    });
  });
}

function normalizeBridgePath(rawPathname) {
  let pathname = String(rawPathname || '/');

  if (pathname.startsWith('/LuckBlox.site.tk')) {
    pathname = pathname.replace(/^\/LuckBlox\.site\.tk/i, '') || '/';
  }

  pathname = pathname.replace(/\/+/g, '/');
  pathname = pathname === '' ? '/' : pathname;

  const legacyPhpMap = {
    '/api/index.php': '/api/games',
    '/api/account.php': '/api/account/info',
    '/api/places.php': '/api/places',
    '/api/load.php': '/api/places',
    '/api/save.php': '/api/save-place',
    '/api/publish.php': '/api/publish-place',
    '/game/load-place-info/index.php': '/api/places',
    '/game/load-place-info.php': '/api/places',
    '/game/players.php': '/api/servers',
    '/home': '/',
    '/index.html': '/',
    '/index.php': '/',
  };

  if (legacyPhpMap[pathname]) {
    return legacyPhpMap[pathname];
  }

  return pathname;
}

// Internal origin of the Express bridge app. Never hardcode this: inside a
// container the bridge lives on 127.0.0.1 on its own internal port, and both
// the host and the port are configurable from the environment.
const bridgeOrigin = `http://${bridgeHost}:${bridgePort}`;

function rewriteLegacyBridgeUrl(req) {
  const targetUrl = new URL(req.url, 'http://127.0.0.1');
  const rawPathname = normalizeBridgePath(targetUrl.pathname);
  const legacyPlaceId = targetUrl.searchParams.get('placeid') || targetUrl.searchParams.get('placeId') || targetUrl.searchParams.get('id');

  if (rawPathname === '/api/places' && legacyPlaceId) {
    return `${bridgeOrigin}/api/places/${legacyPlaceId}/settings`;
  }

  if (rawPathname === '/api/load.php') {
    return `${bridgeOrigin}/api/places/${legacyPlaceId || 1818}/settings`;
  }

  if (rawPathname === '/api/save-place') {
    return `${bridgeOrigin}/api/save-place`;
  }

  if (rawPathname === '/api/publish-place') {
    return `${bridgeOrigin}/api/publish-place`;
  }

  return `${bridgeOrigin}${rawPathname}${targetUrl.search || ''}`;
}

function proxyToBridge(req, res) {
  const targetUrl = new URL(rewriteLegacyBridgeUrl(req));
  const headers = { ...req.headers };
  // Preserve the original public host so the bridge can build absolute URLs
  // pointing at the live Render deployment instead of localhost.
  headers['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  delete headers.host;
  delete headers.connection;

  const options = {
    hostname: targetUrl.hostname,
    port: Number(targetUrl.port || bridgePort),
    path: `${targetUrl.pathname}${targetUrl.search || ''}`,
    method: req.method,
    headers,
  };

  const upstream = http.request(options, (upstreamRes) => {
    const safeHeaders = { ...upstreamRes.headers };
    delete safeHeaders.connection;
    res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'legacy-server-proxy-failed', message: 'The live bridge app is unavailable.' }));
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const forwardedProto = req.headers['x-forwarded-proto'] || 'http';
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost';
  const url = new URL(req.url, `${forwardedProto}://${forwardedHost}`);
  let pathname = url.pathname;

  if (pathname.startsWith('/LuckBlox.site.tk')) {
    pathname = pathname.replace(/^\/LuckBlox\.site\.tk/i, '') || '/';
  }

  if (pathname === '') {
    pathname = '/';
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    res.end();
    return;
  }

  if (pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      status: 'live',
      name: 'LuckyBlox legacy bridge',
      target: bridgeOrigin,
      host: bindHost,
      port: publicPort,
      publicBaseUrl,
    });
    return;
  }

  // NOTE: /css/roblox.css is deliberately NOT served from here. The bridge owns
  // public/css/roblox.css (the real stylesheet the templates are written against);
  // serving a second copy from the proxy's own public/ folder shadowed it and the
  // live site rendered unstyled. Let it fall through to proxyToBridge below.

  // ClientSettings belongs to the bridge too. The bridge resolves the requesting
  // client (query string or ident header) and rewrites <BaseUrl> per client, so
  // 2021M and 2022M each connect to the site URL their build expects. Serving
  // them from here as well meant this proxy's copy answered first and both
  // clients were handed the same single BaseUrl - let the bridge own it.
  if (pathname === '/AppSettings.xml' || pathname.endsWith('/AppSettings.xml') || pathname.startsWith('/ClientSettings/') || pathname === '/ClientSettings') {
    proxyToBridge(req, res);
    return;
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/home' || pathname.startsWith('/LuckBlox.site.tk')) {
    proxyToBridge(req, res);
    return;
  }

  if (pathname === '/signin' || pathname === '/login' || pathname === '/games' || pathname === '/catalog' || pathname === '/develop' || pathname === '/profile' || pathname === '/account' || pathname === '/studio' || pathname === '/avatar' || pathname.startsWith('/users/') || pathname.startsWith('/game') || pathname.startsWith('/play') || pathname.startsWith('/api/') || pathname.startsWith('/v1/') || pathname.startsWith('/Login/') || pathname.startsWith('/2021/')) {
    proxyToBridge(req, res);
    return;
  }

  proxyToBridge(req, res);
});

// Bind on every network interface so the container port is reachable from the
// internet. The port itself always comes from the platform (process.env.PORT)
// via runtimeConfig, never from a hardcoded local number.
const PORT = legacyPort;
const HOST = bindHost;

// A listen error must never crash the process with an unhandled 'error' event.
// If the port is taken we log it clearly and exit non-zero so the supervisor
// can retry with backoff rather than exploding.
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[luckyblox] proxy cannot bind ${HOST}:${PORT} â€” address already in use. `
      + 'Another instance is still running, or the port was not released yet.');
    process.exit(1);
  }
  console.error(`[luckyblox] proxy server error: ${error && error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`LuckyBlox compatibility server listening on http://${HOST}:${PORT}/LuckBlox.site.tk`);
  console.log(`LuckyBlox proxy target bridge: ${bridgeOrigin}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
