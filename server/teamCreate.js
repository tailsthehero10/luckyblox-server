const fs = require('fs');
const path = require('path');

const releaseRoot = path.resolve(__dirname, '..');
const stateRoot = path.join(releaseRoot, 'workspace', 'teamcreate');
const sessionsPath = path.join(stateRoot, 'activeTeamCreateSessions.json');

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

function createEmptySessionState() {
  return {
    placeId: 1818,
    activeDevelopers: [],
    mutations: [],
    snapshot: {},
    lastUpdated: new Date().toISOString(),
    status: 'active',
  };
}

function getAllSessions() {
  ensureDir(stateRoot);
  const fallback = {};
  return readJson(sessionsPath, fallback);
}

function persistAllSessions(sessions) {
  ensureDir(stateRoot);
  writeJson(sessionsPath, sessions);
}

function ensureSessionRecord(placeId) {
  const sessions = getAllSessions();
  const key = String(placeId);
  const existing = sessions[key] || { ...createEmptySessionState(), placeId: Number(placeId || 1818) };
  sessions[key] = existing;
  persistAllSessions(sessions);
  return sessions[key];
}

function registerDeveloper(placeId, userId) {
  const session = ensureSessionRecord(placeId);
  const developerId = String(userId);
  session.activeDevelopers = Array.from(new Set([...(session.activeDevelopers || []), developerId]));
  session.lastUpdated = new Date().toISOString();
  persistAllSessions(getAllSessions());
  return session;
}

function removeDeveloper(placeId, userId) {
  const sessions = getAllSessions();
  const key = String(placeId);
  const session = sessions[key];
  if (!session) {
    return null;
  }

  session.activeDevelopers = (session.activeDevelopers || []).filter((id) => String(id) !== String(userId));
  session.lastUpdated = new Date().toISOString();
  persistAllSessions(sessions);
  return session;
}

function applyMutation(placeId, userId, mutation) {
  const sessions = getAllSessions();
  const key = String(placeId);
  const session = sessions[key] || { ...createEmptySessionState(), placeId: Number(placeId || 1818) };
  const normalizedMutation = {
    userId: String(userId),
    mutationId: `mut-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: mutation?.type || 'property',
    path: mutation?.path || '/',
    value: mutation?.value || null,
    before: mutation?.before || null,
    after: mutation?.after || null,
    timestamp: new Date().toISOString(),
    raw: mutation || {},
  };

  session.mutations = Array.isArray(session.mutations) ? session.mutations : [];
  session.mutations.push(normalizedMutation);

  if (mutation?.path) {
    const nextSnapshot = session.snapshot && typeof session.snapshot === 'object' ? JSON.parse(JSON.stringify(session.snapshot)) : {};
    const segments = mutation.path.split('.').filter(Boolean);
    let cursor = nextSnapshot;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        cursor[segment] = mutation.value;
      } else {
        if (!cursor[segment] || typeof cursor[segment] !== 'object') {
          cursor[segment] = {};
        }
        cursor = cursor[segment];
      }
    });
    session.snapshot = nextSnapshot;
  }

  session.lastUpdated = new Date().toISOString();
  sessions[key] = session;
  persistAllSessions(sessions);
  return session;
}

function installTeamCreateRoutes(app) {
  if (app._teamCreateInstalled) {
    return app;
  }
  app._teamCreateInstalled = true;

  app.get('/v1/teamcreate/sessions/:placeId', (req, res) => {
    const placeId = Number(req.params.placeId || req.query.placeId || 1818);
    const since = req.query.since || null;
    const session = ensureSessionRecord(placeId);

    if (since) {
      const filteredMutations = (session.mutations || []).filter((mutation) => new Date(mutation.timestamp).getTime() > Number(since));
      return res.json({
        ok: true,
        placeId,
        session,
        mutations: filteredMutations,
      });
    }

    res.json({
      ok: true,
      placeId,
      session,
    });
  });

  app.post('/v1/teamcreate/sessions/:placeId/connect', (req, res) => {
    const placeId = Number(req.params.placeId || req.body.placeId || 1818);
    const userId = String(req.body.userId || req.query.userId || 'local-dev');
    const session = registerDeveloper(placeId, userId);
    res.status(200).json({ ok: true, placeId, session });
  });

  app.post('/v1/teamcreate/sessions/:placeId/mutate', (req, res) => {
    const placeId = Number(req.params.placeId || req.body.placeId || 1818);
    const userId = String(req.body.userId || req.query.userId || 'local-dev');
    const mutation = req.body.mutation || req.body || {};

    const session = applyMutation(placeId, userId, mutation);
    res.status(200).json({ ok: true, placeId, userId, session, mutation: session.mutations[session.mutations.length - 1] });
  });

  app.post('/v1/teamcreate/sessions/:placeId/disconnect', (req, res) => {
    const placeId = Number(req.params.placeId || req.body.placeId || 1818);
    const userId = String(req.body.userId || req.query.userId || 'local-dev');
    const session = removeDeveloper(placeId, userId);
    res.json({ ok: true, placeId, userId, session });
  });

  return app;
}

module.exports = {
  installTeamCreateRoutes,
  createEmptySessionState,
  ensureSessionRecord,
  registerDeveloper,
  removeDeveloper,
  applyMutation,
  getAllSessions,
};
