const path = require('path');
const express = require(path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'node_modules', 'express'));
const fs = require('fs');
const crypto = require('crypto');
const { publicBaseUrl, publicHostname, publicProtocol, gameServerHost } = require('./runtimeConfig');

// Absolute content URLs must point at the live public deployment, not at a
// local port, otherwise the toolbox/asset links break in the cloud.
const publicOrigin = publicBaseUrl || `${publicProtocol}://${publicHostname}`;

const releaseRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(releaseRoot, 'workspace');
const savedPlacesRoot = path.join(workspaceRoot, 'saved_places');
const uploadsRoot = path.join(releaseRoot, 'Uploads');
const bridgeRoot = path.join(releaseRoot, 'Webserver', 'http-db-bridge');
const dataRoot = path.join(bridgeRoot, 'data');
const assetsDbPath = path.join(dataRoot, 'assets.json');
const placesDbPath = path.join(dataRoot, 'places.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeFileName(name, fallbackExt = 'rbxl') {
  const baseName = String(name || `place-${Date.now()}.${fallbackExt}`)
    .replace(/\\/g, '/')
    .split('/')
    .pop();

  const safeBase = (baseName || `place-${Date.now()}.${fallbackExt}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return safeBase.includes('.') ? safeBase : `${safeBase}.${fallbackExt}`;
}

function seedAssetDatabase() {
  const defaultAssets = {
    '1001': {
      id: 1001,
      name: 'Classic Red Shirt',
      assetType: 'Shirt',
      fileName: 'classic-red-shirt.shirt',
      filePath: path.join(uploadsRoot, 'classic-red-shirt.shirt'),
      kind: 'shirt',
      creatorId: 1,
      creatorName: 'LuckyBlox Studio',
      description: 'Classic red shirt asset for local avatar testing.',
      version: 1,
      size: 0,
      updatedAt: new Date().toISOString(),
    },
    '1002': {
      id: 1002,
      name: 'Classic Blue Pants',
      assetType: 'Pants',
      fileName: 'classic-blue-pants.pants',
      filePath: path.join(uploadsRoot, 'classic-blue-pants.pants'),
      kind: 'pants',
      creatorId: 1,
      creatorName: 'LuckyBlox Studio',
      description: 'Classic blue pants asset for local avatar testing.',
      version: 1,
      size: 0,
      updatedAt: new Date().toISOString(),
    },
    '1003': {
      id: 1003,
      name: 'Robloxian Cap',
      assetType: 'Hat',
      fileName: 'robloxian-cap.hat',
      filePath: path.join(uploadsRoot, 'robloxian-cap.hat'),
      kind: 'hat',
      creatorId: 1,
      creatorName: 'LuckyBlox Studio',
      description: 'Classic cap used in the local avatar system.',
      version: 1,
      size: 0,
      updatedAt: new Date().toISOString(),
    },
  };

  if (!fs.existsSync(assetsDbPath)) {
    writeJson(assetsDbPath, defaultAssets);
  }

  return readJson(assetsDbPath, defaultAssets);
}

function seedPlaceDatabase() {
  const defaultPlaces = {
    '1818': {
      placeId: 1818,
      universeId: 1818,
      name: 'LuckyBlox Arena',
      description: 'Default local test place for Studio and launcher integration.',
      fileName: 'LuckyBlox Arena.rbxlx',
      filePath: path.join(savedPlacesRoot, 'LuckyBlox Arena.rbxlx'),
      version: 1,
      author: 'LuckyBlox Studio',
      authorId: 1,
      creators: ['LuckyBlox Studio'],
      maxPlayers: 20,
      allowHttpRequests: true,
      source: 'workspace/saved_places/LuckyBlox Arena.rbxlx',
      size: 0,
      updatedAt: new Date().toISOString(),
    },
  };

  if (!fs.existsSync(placesDbPath)) {
    writeJson(placesDbPath, defaultPlaces);
  }

  return readJson(placesDbPath, defaultPlaces);
}

function getAssetsDb() {
  return readJson(assetsDbPath, seedAssetDatabase());
}

function getPlacesDb() {
  return readJson(placesDbPath, seedPlaceDatabase());
}

function updatePlaceRecord(placeId, updates) {
  const db = getPlacesDb();
  const key = String(placeId);
  const existing = db[key] || {
    placeId: Number(placeId || 1818),
    universeId: Number(placeId || 1818),
    name: `Place ${placeId || 1818}`,
    description: 'Local Studio place',
    fileName: `place-${placeId || 1818}.rbxlx`,
    filePath: path.join(savedPlacesRoot, `place-${placeId || 1818}.rbxlx`),
    version: 1,
    author: 'LuckyBlox Studio',
    authorId: 1,
    creators: ['LuckyBlox Studio'],
    maxPlayers: 20,
    allowHttpRequests: true,
    source: `workspace/saved_places/place-${placeId || 1818}.rbxlx`,
    size: 0,
    updatedAt: new Date().toISOString(),
  };

  const next = { ...existing, ...updates, placeId: Number(placeId || existing.placeId || 1818), universeId: Number(placeId || existing.universeId || 1818), updatedAt: new Date().toISOString() };
  db[key] = next;
  writeJson(placesDbPath, db);
  return next;
}

function updateAssetRecord(assetId, updates) {
  const db = getAssetsDb();
  const key = String(assetId);
  const existing = db[key] || {
    id: Number(assetId || 0),
    name: `Asset ${assetId || 0}`,
    assetType: 'Model',
    fileName: `asset-${assetId || 0}.rbxm`,
    filePath: path.join(uploadsRoot, `asset-${assetId || 0}.rbxm`),
    kind: 'rbxm',
    creatorId: 1,
    creatorName: 'LuckyBlox Studio',
    description: 'Managed asset local payload.',
    version: 1,
    size: 0,
    updatedAt: new Date().toISOString(),
  };

  const next = { ...existing, ...updates, id: Number(assetId || existing.id || 0), updatedAt: new Date().toISOString() };
  db[key] = next;
  writeJson(assetsDbPath, db);
  return next;
}

function listSavedPlaceFiles() {
  ensureDir(savedPlacesRoot);
  const directoryEntries = fs.existsSync(savedPlacesRoot)
    ? fs.readdirSync(savedPlacesRoot, { withFileTypes: true })
    : [];

  return directoryEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(savedPlacesRoot, entry.name));
}

function findPlaceFileForId(placeId) {
  const placesDb = getPlacesDb();
  const placeKey = String(placeId);
  const entry = placesDb[placeKey];
  if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
    return entry.filePath;
  }

  const matches = listSavedPlaceFiles().filter((file) => {
    const baseName = path.basename(file).toLowerCase();
    return baseName.includes(String(placeId)) || baseName.includes('place');
  });

  return matches[0] || null;
}

function findAssetFileById(assetId) {
  const assetsDb = getAssetsDb();
  const entry = assetsDb[String(assetId)];
  if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
    return entry.filePath;
  }

  if (entry && entry.fileName) {
    const candidate = path.join(savedPlacesRoot, entry.fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const fileNameMatches = listSavedPlaceFiles().filter((file) => {
    const baseName = path.basename(file).toLowerCase();
    return baseName.includes(String(assetId)) || baseName.includes('asset');
  });

  return fileNameMatches[0] || null;
}

function createAssetRecordFromFile(fileName, filePath, kind = 'rbxl') {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const assetId = Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`);

  const record = {
    id: assetId,
    name: path.basename(fileName, path.extname(fileName)) || `Asset ${assetId}`,
    assetType: kind === 'audio' ? 'Audio' : kind === 'mesh' ? 'Mesh' : kind === 'decal' ? 'Decal' : 'Model',
    fileName: path.basename(filePath),
    filePath,
    kind,
    creatorId: 1,
    creatorName: 'LuckyBlox Studio',
    description: `Studio asset imported from ${path.basename(filePath)}`,
    version: 1,
    size: stat ? stat.size : 0,
    updatedAt: new Date().toISOString(),
  };

  const db = getAssetsDb();
  db[String(record.id)] = record;
  writeJson(assetsDbPath, db);
  return record;
}

function writePlacePayloadToStorage(fileName, buffer, defaultKind = 'rbxlx') {
  ensureDir(savedPlacesRoot);
  const resolvedName = normalizeFileName(fileName, defaultKind);
  const filePath = path.join(savedPlacesRoot, resolvedName);

  const out = fs.createWriteStream(filePath);
  out.write(buffer);
  out.end();

  return new Promise((resolve, reject) => {
    out.on('finish', () => {
      const stat = fs.statSync(filePath);
      const placeIdMatch = (() => {
        const match = resolvedName.match(/(\d+)/);
        return match ? Number(match[0]) : null;
      })();

      const finalPlaceId = Number(placeIdMatch || 1818 + Math.floor(Math.random() * 2000));
      const record = {
        placeId: finalPlaceId,
        universeId: finalPlaceId,
        name: path.basename(resolvedName, path.extname(resolvedName)) || `Place ${finalPlaceId}`,
        description: 'Published Studio place managed through the local workspace persistence layer.',
        fileName: resolvedName,
        filePath,
        version: 1,
        author: 'LuckyBlox Studio',
        authorId: 1,
        creators: ['LuckyBlox Studio'],
        maxPlayers: 20,
        allowHttpRequests: true,
        source: `workspace/saved_places/${resolvedName}`,
        size: stat.size,
        updatedAt: new Date().toISOString(),
      };

      updatePlaceRecord(finalPlaceId, record);
      resolve(record);
    });

    out.on('error', reject);
  });
}

function sendBinaryFile(res, filePath, fileName) {
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, message: 'File not found.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const safeName = fileName || path.basename(filePath);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

function buildToolboxItem(record, index = 0) {
  const id = Number(record.id || record.placeId || index + 1);
  const itemName = record.name || `Asset ${id}`;
  const kind = record.assetType || record.kind || 'Model';
  const contentUrl = record.filePath && fs.existsSync(record.filePath)
    ? `${publicOrigin}/asset/${encodeURIComponent(path.basename(record.filePath))}`
    : `${publicOrigin}/asset/?placeId=${id}`;

  return {
    assetId: id,
    assetType: kind,
    name: itemName,
    description: record.description || `${kind} item published by LuckyBlox Studio.`,
    creator: {
      id: Number(record.creatorId || 1),
      name: record.creatorName || 'LuckyBlox Studio',
    },
    category: kind,
    genres: [kind.toLowerCase()],
    created: record.updatedAt || new Date().toISOString(),
    contentUrl,
    thumbnailUrl: `https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=240&q=80`,
    version: Number(record.version || 1),
  };
}

function installedSessions() {
  const secret = process.env.LUCKBLOX_SECRET || 'luckblox-local-dev-secret';
  const activeSessions = new Map();

  return {
    signToken(payload) {
      const tokenPayload = { ...payload, issuedAt: Date.now() };
      const encoded = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
      const checksum = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
      return `${checksum}.${encoded}`;
    },
    verifyToken(token) {
      if (!token || typeof token !== 'string') {
        return null;
      }

      const [checksum, payload] = token.split('.');
      if (!checksum || !payload) {
        return null;
      }

      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (checksum !== expected) {
        return null;
      }

      try {
        return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      } catch (error) {
        return null;
      }
    },
    registerSession(userId, userPayload = {}) {
      const token = this.signToken({ userId: String(userId), ...userPayload });
      activeSessions.set(token, { userId: String(userId), ...userPayload, token, issuedAt: Date.now() });
      return token;
    },
    getSession(token) {
      return activeSessions.get(token) || null;
    },
  };
}

function installStudioApiRoutes(app) {
  if (app._studioApiInstalled) {
    return app;
  }
  app._studioApiInstalled = true;

  const sessionManager = installedSessions();

  ensureDir(savedPlacesRoot);
  ensureDir(uploadsRoot);
  ensureDir(dataRoot);
  seedAssetDatabase();
  seedPlaceDatabase();

  app.get('/asset', (req, res) => {
    const requestedId = req.query.assetId || req.query.id || req.query.placeId || req.query.file;
    const requestedFile = req.query.file || req.query.name;
    const targetFile = requestedFile ? path.join(savedPlacesRoot, normalizeFileName(requestedFile, 'rbxl')) : null;

    if (targetFile && fs.existsSync(targetFile)) {
      sendBinaryFile(res, targetFile, path.basename(targetFile));
      return;
    }

    if (requestedId) {
      const assetRecord = getAssetsDb()[String(requestedId)];
      if (assetRecord && fs.existsSync(assetRecord.filePath)) {
        sendBinaryFile(res, assetRecord.filePath, assetRecord.fileName || path.basename(assetRecord.filePath));
        return;
      }

      const placeRecord = getPlacesDb()[String(requestedId)];
      if (placeRecord && fs.existsSync(placeRecord.filePath)) {
        sendBinaryFile(res, placeRecord.filePath, placeRecord.fileName || path.basename(placeRecord.filePath));
        return;
      }
    }

    const fallback = listSavedPlaceFiles()[0];
    if (fallback) {
      sendBinaryFile(res, fallback, path.basename(fallback));
      return;
    }

    res.status(404).json({ ok: false, message: 'No file found for Studio asset request.' });
  });

  app.get('/asset/', (req, res) => {
    return app._router.handle(req, res);
  });

  app.get('/asset/:name', (req, res) => {
    const fileName = req.params.name;
    const filePath = path.join(savedPlacesRoot, normalizeFileName(fileName, 'rbxl'));
    if (fs.existsSync(filePath)) {
      sendBinaryFile(res, filePath, fileName);
      return;
    }

    const direct = path.join(savedPlacesRoot, fileName);
    if (fs.existsSync(direct)) {
      sendBinaryFile(res, direct, fileName);
      return;
    }

    const assetRecord = Object.values(getAssetsDb()).find((entry) => entry.fileName === fileName || path.basename(entry.filePath) === fileName);
    if (assetRecord && fs.existsSync(assetRecord.filePath)) {
      sendBinaryFile(res, assetRecord.filePath, assetRecord.fileName || path.basename(assetRecord.filePath));
      return;
    }

    res.status(404).json({ ok: false, message: 'Studio asset missing from saved_places.' });
  });

  app.get('/v1/assets/:id', (req, res) => {
    const id = req.params.id;
    const assetRecord = getAssetsDb()[String(id)] || Object.values(getAssetsDb()).find((entry) => entry.fileName === id || Number(entry.id) === Number(id));
    const placeRecord = getPlacesDb()[String(id)] || Object.values(getPlacesDb()).find((entry) => Number(entry.placeId) === Number(id));

    const filePath = assetRecord ? assetRecord.filePath : placeRecord ? placeRecord.filePath : findAssetFileById(id) || findPlaceFileForId(id);
    if (filePath && fs.existsSync(filePath)) {
      sendBinaryFile(res, filePath, path.basename(filePath));
      return;
    }

    res.status(404).json({ ok: false, message: `Asset ${id} not found.` });
  });

  app.post('/ide/publish/v1.0', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
    try {
      const incomingBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const fileName = req.headers['x-filename'] || req.query.name || req.headers['content-disposition'] || `studio-publish-${Date.now()}.rbxlx`;
      const kind = String(req.query.kind || 'rbxlx').toLowerCase();
      const safeName = normalizeFileName(fileName, kind.includes('rbxl') ? 'rbxlx' : kind);
      const filePath = path.join(savedPlacesRoot, safeName);

      const out = fs.createWriteStream(filePath);
      out.write(incomingBuffer);
      out.end();

      out.on('finish', () => {
        const stat = fs.statSync(filePath);
        const placeId = Number(req.query.placeId || req.body?.placeId || 1818 + Math.floor(Math.random() * 1000));
        const placeRecord = updatePlaceRecord(placeId, {
          placeId,
          universeId: placeId,
          name: req.query.name ? path.basename(req.query.name, path.extname(req.query.name)) : 'Published Studio Place',
          fileName: safeName,
          filePath,
          version: Number(req.query.version || 1),
          author: req.body?.author || 'LuckyBlox Studio',
          authorId: Number(req.body?.authorId || 1),
          size: stat.size,
          source: `workspace/saved_places/${safeName}`,
        });

        res.status(201).json({
          ok: true,
          mode: 'studio-publish',
          placeId: Number(placeRecord.placeId),
          fileName: safeName,
          filePath,
          size: stat.size,
          version: Number(placeRecord.version),
          author: placeRecord.author,
        });
      });

      out.on('error', (error) => {
        console.error('[studioApi] publish write failed', error);
        res.status(500).json({ ok: false, message: 'Failed to write Studio publish archive.', error: String(error.message || error) });
      });
    } catch (error) {
      console.error('[studioApi] publish failed', error);
      res.status(500).json({ ok: false, message: 'Studio publish request failed.', error: String(error.message || error) });
    }
  });

  app.post('/Data/Upload.ashx', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
    try {
      const incomingBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const fileName = req.query.name || req.headers['x-filename'] || `upload-${Date.now()}.rbxm`;
      const safeName = normalizeFileName(fileName, 'rbxm');
      const filePath = path.join(savedPlacesRoot, safeName);
      const stream = fs.createWriteStream(filePath);
      stream.write(incomingBuffer);
      stream.end();

      stream.on('finish', () => {
        const stat = fs.statSync(filePath);
        const assetId = Number(`${Date.now()}${Math.floor(Math.random() * 100)}`);
        const asset = createAssetRecordFromFile(safeName, filePath, 'rbxm');
        updateAssetRecord(asset.id, {
          id: asset.id,
          name: path.basename(safeName, path.extname(safeName)),
          fileName: safeName,
          filePath,
          kind: 'rbxm',
          size: stat.size,
        });

        res.status(201).json({
          ok: true,
          assetId: Number(asset.id),
          fileName: safeName,
          filePath,
          size: stat.size,
          contentType: 'application/octet-stream',
        });
      });

      stream.on('error', (error) => {
        console.error('[studioApi] upload failed', error);
        res.status(500).json({ ok: false, message: 'Upload stream failed.', error: String(error.message || error) });
      });
    } catch (error) {
      console.error('[studioApi] upload error', error);
      res.status(500).json({ ok: false, message: 'Upload request failed.', error: String(error.message || error) });
    }
  });

  app.get('/v1/toolbox/items', (req, res) => {
    const db = getAssetsDb();
    const items = Object.values(db).map((record, index) => buildToolboxItem(record, index));

    const typeQuery = String(req.query.assetType || req.query.type || '').toLowerCase();
    const termQuery = String(req.query.search || req.query.q || '').toLowerCase();

    const filtered = items.filter((item) => {
      if (typeQuery && item.assetType.toLowerCase() !== typeQuery) {
        return false;
      }

      if (termQuery && !item.name.toLowerCase().includes(termQuery) && !item.description.toLowerCase().includes(termQuery)) {
        return false;
      }

      return true;
    });

    res.json({
      ok: true,
      total: filtered.length,
      items: filtered,
      nextPageToken: null,
    });
  });

  app.get('/Game/Tools/InsertAsset.ashx', (req, res) => {
    return app._router.handle(req, res);
  });

  app.get('/v1/game-start-info', (req, res) => {
    const placeId = Number(req.query.placeId || req.query.placeid || 1818);
    const placeRecord = getPlacesDb()[String(placeId)] || Object.values(getPlacesDb())[0];

    res.json({
      ok: true,
      placeId,
      universeId: placeRecord ? Number(placeRecord.universeId || placeId) : placeId,
      maxPlayers: placeRecord ? Number(placeRecord.maxPlayers || 20) : 20,
      allowHttpRequests: true,
      serverAddress: gameServerHost,
      apiAccess: {
        avatar: true,
        publish: true,
        toolbox: true,
        teamCreate: true,
      },
      httpService: {
        enabled: true,
        allowedDomains: [publicHostname, gameServerHost].filter(Boolean),
      },
      universe: {
        id: placeRecord ? Number(placeRecord.universeId || placeId) : placeId,
        name: placeRecord ? placeRecord.name : 'LuckyBlox Arena',
      },
      permissions: {
        create: true,
        edit: true,
        publish: true,
      },
    });
  });

  app.get('/v1/places', (req, res) => {
    const places = Object.values(getPlacesDb()).map((entry) => ({
      placeId: Number(entry.placeId || 1818),
      universeId: Number(entry.universeId || entry.placeId || 1818),
      name: entry.name || 'LuckyBlox Place',
      description: entry.description || 'Local Studio place.',
      version: Number(entry.version || 1),
      author: entry.author || 'LuckyBlox Studio',
      authorId: Number(entry.authorId || 1),
      maxPlayers: Number(entry.maxPlayers || 20),
      allowHttpRequests: Boolean(entry.allowHttpRequests !== false),
      source: entry.source || 'workspace/saved_places',
      updatedAt: entry.updatedAt || new Date().toISOString(),
    }));

    res.json({ ok: true, total: places.length, places });
  });

  app.get('/v1/places/:placeId', (req, res) => {
    const placeId = Number(req.params.placeId || req.query.placeId || 1818);
    const placeRecord = getPlacesDb()[String(placeId)] || Object.values(getPlacesDb())[0];

    res.json({
      ok: true,
      placeId,
      place: placeRecord || {
        placeId,
        universeId: placeId,
        name: 'LuckyBlox Arena',
        description: 'Default local Studio place.',
        version: 1,
        author: 'LuckyBlox Studio',
        maxPlayers: 20,
        allowHttpRequests: true,
      },
    });
  });

  app.get('/v1/users/:userId', (req, res) => {
    const userId = Number(req.params.userId || req.query.userId || 1);
    res.json({
      ok: true,
      user: {
        userId,
        username: 'LocalPlayer',
        displayName: 'LocalPlayer',
        membership: 'Premium',
        role: 'Developer',
        id: userId,
      },
    });
  });

  app.get('/v1/account/info', (req, res) => {
    const userId = Number(req.query.userId || req.headers['x-user-id'] || 1);
    res.json({
      ok: true,
      user: {
        userId,
        username: 'LocalPlayer',
        displayName: 'LocalPlayer',
        membership: 'Premium',
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

  app.post('/v1/logout', (req, res) => {
    res.json({ ok: true, loggedOut: true });
  });

  app.post('/v1/places', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
    try {
      const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const body = (() => {
        try {
          return rawBuffer.length ? JSON.parse(rawBuffer.toString('utf8')) : {};
        } catch {
          return {};
        }
      })();

      const placeName = String(body.name || req.query.name || 'LuckyBlox Studio Place');
      const fileName = normalizeFileName(body.fileName || req.query.fileName || `${placeName}.rbxlx`, 'rbxlx');
      const safeFileName = normalizeFileName(fileName, 'rbxlx');
      const filePath = path.join(savedPlacesRoot, safeFileName);
      const stream = fs.createWriteStream(filePath);
      stream.write(rawBuffer.length ? rawBuffer : Buffer.from(JSON.stringify(body, null, 2)));
      stream.end();

      stream.on('finish', () => {
        const placeId = Number(body.placeId || req.query.placeId || 1818 + Math.floor(Math.random() * 5000));
        const record = updatePlaceRecord(placeId, {
          placeId,
          universeId: placeId,
          name: placeName,
          description: body.description || 'Saved from Roblox Studio local workflow.',
          fileName: safeFileName,
          filePath,
          version: Number(body.version || 1),
          author: body.author || 'LuckyBlox Studio',
          authorId: Number(body.authorId || 1),
          maxPlayers: Number(body.maxPlayers || 20),
          allowHttpRequests: body.allowHttpRequests !== false,
          source: `workspace/saved_places/${safeFileName}`,
          size: fs.statSync(filePath).size,
        });

        res.status(201).json({
          ok: true,
          mode: 'save',
          placeId: Number(record.placeId),
          universeId: Number(record.universeId || record.placeId),
          fileName: safeFileName,
          filePath,
          version: Number(record.version || 1),
          savedAt: record.updatedAt,
        });
      });

      stream.on('error', (error) => {
        res.status(500).json({ ok: false, message: 'Failed to save Studio place.', error: String(error.message || error) });
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: 'Studio place save failed.', error: String(error.message || error) });
    }
  });

  app.post('/v1/places/:placeId/publish', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
    try {
      const placeId = Number(req.params.placeId || req.query.placeId || 1818 + Math.floor(Math.random() * 5000));
      const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const fileName = normalizeFileName(req.query.name || `Place_${placeId}.rbxlx`, 'rbxlx');
      const filePath = path.join(savedPlacesRoot, fileName);
      const stream = fs.createWriteStream(filePath);
      stream.write(rawBuffer.length ? rawBuffer : Buffer.from(JSON.stringify({ placeId }, null, 2)));
      stream.end();

      stream.on('finish', () => {
        const updated = updatePlaceRecord(placeId, {
          placeId,
          universeId: placeId,
          name: req.query.name ? path.basename(req.query.name, path.extname(req.query.name)) : `Place ${placeId}`,
          fileName,
          filePath,
          version: Number(req.query.version || 1),
          author: 'LuckyBlox Studio',
          authorId: 1,
          maxPlayers: Number(req.query.maxPlayers || 20),
          allowHttpRequests: true,
          source: `workspace/saved_places/${fileName}`,
          size: fs.statSync(filePath).size,
          publishedAt: new Date().toISOString(),
        });

        res.status(201).json({
          ok: true,
          mode: 'publish',
          placeId: Number(updated.placeId),
          universeId: Number(updated.universeId || updated.placeId),
          fileName,
          filePath,
          size: fs.statSync(filePath).size,
          publishedAt: updated.publishedAt || new Date().toISOString(),
        });
      });

      stream.on('error', (error) => {
        res.status(500).json({ ok: false, message: 'Failed to publish Studio place.', error: String(error.message || error) });
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: 'Studio publish failed.', error: String(error.message || error) });
    }
  });

  app.post('/v1/login/', (req, res) => {
    const username = req.body?.username || req.query.username || 'LocalPlayer';
    const password = req.body?.password || req.query.password || 'local';
    const userId = req.body?.userId || req.query.userId || 1;
    const providedToken = req.headers.authorization || req.body?.sessionToken || req.body?.token || req.query.token;

    const verified = providedToken ? sessionManager.verifyToken(providedToken.replace(/^Bearer\s+/i, '')) : null;
    const token = verified ? providedToken : sessionManager.registerSession(userId, { username, password });

    if (!verified && username !== 'LocalPlayer' && password !== 'local' && !providedToken) {
      return res.status(401).json({ ok: false, message: 'Invalid Studio credentials.' });
    }

    res.json({
      ok: true,
      user: {
        userId: Number(userId),
        username,
        membership: 'Premium',
      },
      sessionToken: token,
      token,
      authenticated: true,
    });
  });

  return app;
}

module.exports = {
  installStudioApiRoutes,
  savedPlacesRoot,
  workspaceRoot,
  getAssetsDb,
  getPlacesDb,
  updatePlaceRecord,
  updateAssetRecord,
  buildToolboxItem,
  listSavedPlaceFiles,
};
