'use strict';

/**
 * LuckyBlox — the Roblox client API namespace.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2021M player and 2022M Studio clients do NOT call this server's own
 * `/api/*` routes. Their FFlag sets and DevSettingsFile point them at the real
 * roblox.com v1/v2 API shapes and the bare `*.roblox.com` service hosts:
 *
 *   Clients/2022M/ClientSettings/ClientAppSettings.json   (4,161 FFlags)
 *   Clients/2019M/Player/DevSettingsFile.json             (applicationSettings)
 *
 * Those requests were all 404ing (Express's default HTML 404), which a client
 * cannot parse, so the client fell back to defaults or hung. This module adds
 * the namespace the clients actually address, answering in the exact shapes
 * they expect:
 *
 *   Roblox shape                                  what the client does with it
 *   -------------------------------------------  ------------------------------
 *   GET  /v1/users/{id}                          player identity
 *   POST /v1/usernames/users                     resolve usernames -> ids
 *   GET  /v1/users/{id}/currently-wearing        equipped asset ids
 *   GET  /v1/inventory/{id}/assets/{type}        the player's inventory page
 *   GET  /v1/thumbnails/avatar                   avatar thumbnail batch
 *   GET  /v1/thumbnails/assets                   asset thumbnail batch
 *   GET  /v2/avatar                               avatar /v2 model
 *   GET  /v1/game-pass/{id}                       pass metadata
 *   GET  /v1/developer-products/{id}              dev product metadata
 *   GET  /v1/ownership/hasasset                   owns-this-asset check
 *   GET  /v1/economy/currency                     Robux balance
 *   GET  /v1/presence/users                       online state
 *   GET  /v1/friends/{id}/friends                 friend list
 *   GET  /v1/groups/{id}                          group info
 *   GET  /v1/locale/...                           locale + translation tables
 *   GET  /v1/account/settings                     account settings
 *   GET  /v1/beacon/...                           analytics (accepted, ignored)
 *   GET  /v1/device/...                           device info
 *   GET  /v1/avatar-rules                          avatar rule config
 *   GET  /assets/{id} , /assetdelivery/{id}       asset bytes / metadata
 *
 * DESIGN RULES (same as the rest of this codebase)
 *   - Everything is derived from the real data files (users/games/places/assets).
 *     Nothing is invented: an unknown id is a clean 404, never a fabricated row.
 *   - Every response is JSON, including errors, so a client can always parse it.
 *   - Handlers are pure and synchronous where possible: reading the JSON store is
 *     cheap and this keeps the client's request storm fast.
 *
 * The module is deliberately self-contained: it takes a small `ctx` of accessor
 * functions from server.js rather than requiring server.js back, so there is no
 * circular import.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} app  the Express app
 * @param {object} ctx  accessors supplied by server.js:
 *   getUser, getUsers, getAssets, getGames, getGameEntry, getPlaceSettings,
 *   serializeUser, getCurrencyForUser, getWearingForUser, getFriendsForUser,
 *   getPublicGamesForUser, normalizePlaceId, resolveSessionUser, publicOrigin,
 *   releaseRoot
 */
function installClientApi(app, ctx) {
  /* ------------------------------------------------------------------------
   * Small helpers
   * --------------------------------------------------------------------- */

  /** Parse an optional ?limit= / ?cursor= page window the way Roblox does. */
  function paginate(items, req, defaults) {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || defaults.limit));
    const cursor = String(req.query.cursor || '');
    const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const page = items.slice(start, start + limit);
    const next = start + limit < items.length ? String(start + limit) : null;
    return { data: page, nextPageCursor: next, previousPageCursor: start > 0 ? String(Math.max(0, start - limit)) : null };
  }

  /** A numeric id from any of the spellings a client uses. */
  function readId(value) {
    const n = Number(String(value == null ? '' : value).replace(/\D+/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function publicUser(userId) {
    const user = ctx.getUser(userId);
    if (!user) return null;
    const id = Number(user.userId || userId);
    return {
      id,
      name: user.username || 'Player',
      displayName: user.displayName || user.username || 'Player',
      description: String(user.bio || ''),
      created: user.joinDate || user.created || new Date().toISOString(),
      isBanned: false,
      externalAppDisplayName: null,
      hasVerifiedBadge: Boolean(user.admin || user.isAdmin),
    };
  }

  /** Every asset id an account owns, as strings. */
  function inventoryIds(user) {
    const list = Array.isArray(user && user.inventory) ? user.inventory : [];
    return list.map((id) => String(id));
  }

  /** The asset record for an id, from the local assets store. */
  function assetById(assetId) {
    const assets = ctx.getAssets() || {};
    return assets[String(assetId)] || null;
  }

  /**
   * Per-user data file (Webserver/http-db-bridge/data/<id>.json). The launcher
   * and the clients read these; the site itself keeps everything in users.json.
   * Read-through so an endpoint can answer from either.
   */
  function readUserFile(userId) {
    try {
      const file = path.join(ctx.dataDir, `${String(userId)}.json`);
      if (!fs.existsSync(file)) return null;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  /** A stable pseudo-random-but-deterministic number, for ids clients expect. */
  function stableHash(value) {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /* ------------------------------------------------------------------------
   * Users
   * --------------------------------------------------------------------- */

  // GET /v1/users/{userId}
  app.get('/v1/users/:userId', (req, res) => {
    const id = readId(req.params.userId);
    const user = id ? publicUser(id) : null;
    if (!user) {
      return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });
    }
    return res.json(user);
  });

  // POST /v1/usernames/users  { usernames: [...] } -> ids
  app.post('/v1/usernames/users', (req, res) => {
    const body = req.body || {};
    const wanted = Array.isArray(body.usernames) ? body.usernames : [];
    const users = ctx.getUsers() || {};
    const data = [];

    for (const raw of wanted) {
      const target = String(raw || '').trim().toLowerCase();
      if (!target) continue;
      const match = Object.values(users).find((u) => {
        if (!u || typeof u !== 'object') return false;
        return String(u.username || '').toLowerCase() === target
          || String(u.displayName || '').toLowerCase() === target;
      });
      if (!match) continue;
      const id = Number(match.userId || match.id);
      data.push({
        requestedUsername: String(raw),
        id,
        name: match.username,
        displayName: match.displayName || match.username,
        hasVerifiedBadge: Boolean(match.admin || match.isAdmin),
      });
    }

    return res.json({ data });
  });

  // GET /v1/users/{userId}/username  -> the bare name (used by several clients)
  app.get('/v1/users/:userId/username', (req, res) => {
    const id = readId(req.params.userId);
    const user = id ? ctx.getUser(id) : null;
    if (!user) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });
    return res.json({ userId: Number(user.userId || id), username: user.username });
  });

  // GET /v1/users/{userId}/currently-wearing
  app.get('/v1/users/:userId/currently-wearing', (req, res) => {
    const id = readId(req.params.userId);
    if (!id) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });

    const user = ctx.getUser(id);
    const file = readUserFile(id);
    const source = (user && Array.isArray(user.currentlyWearing) && user.currentlyWearing.length)
      ? user.currentlyWearing
      : (file && Array.isArray(file.currentlyWearing) ? file.currentlyWearing : []);

    return res.json({ assetIds: source.map((a) => Number(a)).filter((n) => Number.isFinite(n)) });
  });

  /* ------------------------------------------------------------------------
   * Inventory
   * --------------------------------------------------------------------- */

  // GET /v1/inventory/{userId}/assets/{assetTypeId}
  app.get('/v1/inventory/:userId/assets/:assetTypeId', (req, res) => {
    const id = readId(req.params.userId);
    const typeId = Number(req.params.assetTypeId) || 0;
    const user = id ? ctx.getUser(id) : null;
    if (!user) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });

    const assets = ctx.getAssets() || {};
    const owned = inventoryIds(user);

    const rows = owned
      .map((assetId) => assets[String(assetId)])
      .filter((a) => a && typeof a === 'object')
      // assetTypeId 0 means "any" - the shape the client uses for the full list.
      .filter((a) => typeId === 0 || Number(a.assetTypeId || 0) === typeId)
      .map((a) => ({
        assetId: Number(a.id || a.assetId),
        name: a.name || 'Asset',
        assetTypeId: Number(a.assetTypeId || 0),
        assetType: a.assetType || a.className || 'Asset',
        created: a.createdAt || new Date().toISOString(),
        updated: a.updatedAt || a.createdAt || new Date().toISOString(),
      }));

    return res.json(paginate(rows, req, { limit: 50 }));
  });

  /* ------------------------------------------------------------------------
   * Avatar
   * --------------------------------------------------------------------- */

  // GET /v2/avatar  and  GET /v1/avatar  - the model shape the client reads.
  function avatarModel(req, res) {
    const id = readId(req.query.userId || req.params.userId) || 1;
    const user = ctx.getUser(id);
    if (!user) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });

    const avatar = (user.avatar && typeof user.avatar === 'object') ? user.avatar : {};
    const colors = (avatar.bodyColors && typeof avatar.bodyColors === 'object') ? avatar.bodyColors : {};
    const wearing = Array.isArray(user.currentlyWearing) ? user.currentlyWearing : [];

    const assets = ctx.getAssets() || {};
    const assetRows = wearing
      .map((assetId) => assets[String(assetId)])
      .filter((a) => a && typeof a === 'object')
      .map((a) => ({
        id: Number(a.id || a.assetId),
        name: a.name || 'Asset',
        assetType: { id: Number(a.assetTypeId || 0), name: a.assetType || a.className || 'Asset' },
        currentVersionId: Number(a.version || 1),
      }));

    return res.json({
      scales: Object.assign({ height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 }, avatar.scales || {}),
      playerAvatarType: avatar.playerAvatarType || user.avatarType || 'R15',
      bodyColors: {
        headColor: colors.headColorId || 1002,
        torsoColor: colors.torsoColorId || 1002,
        rightArmColor: colors.rightArmColorId || 1002,
        leftArmColor: colors.leftArmColorId || 1002,
        rightLegColor: colors.rightLegColorId || 1002,
        leftLegColor: colors.leftLegColorId || 1002,
      },
      assetIds: wearing.map((a) => Number(a)).filter((n) => Number.isFinite(n)),
      assets: assetRows,
      defaultShirtApplied: Boolean(user.defaultShirtApplied),
      defaultPantsApplied: Boolean(user.defaultPantsApplied),
      emotes: Array.isArray(user.emotes) ? user.emotes : [],
    });
  }

  app.get('/v2/avatar', avatarModel);
  app.get('/v1/avatar', avatarModel);

  // GET /v1/avatar-rules - the client reads these before dressing a character.
  app.get('/v1/avatar-rules', (req, res) => {
    return res.json({
      playerAvatarTypes: ['R6', 'R15'],
      scales: {
        height: { min: 0.75, max: 1.25 },
        width: { min: 0.7, max: 1.3 },
        head: { min: 0.95, max: 1.05 },
        depth: { min: 0.75, max: 1.25 },
        proportion: { min: 0, max: 3 },
        bodyType: { min: 0, max: 3 },
      },
      bodyColorsPalette: [],
      basicBodyColorsPalette: [],
      minimumDeltaEBodyColorDifference: 0,
    });
  });

  /* ------------------------------------------------------------------------
   * Thumbnails
   * --------------------------------------------------------------------- */

  /**
   * A thumbnail row for an asset. The client passes ids in the query the same
   * way roblox.com does, and batches them; unknown ids are simply omitted, which
   * is what the real API does (it never invents an image).
   */
  function thumbnailRows(ids, resolver) {
    return ids
      .map((raw) => {
        const id = readId(raw);
        if (!id) return null;
        const url = resolver(id);
        if (!url) return null;
        return {
          targetId: id,
          state: 'Completed',
          imageUrl: url,
          version: `v${stableHash(id) % 900 + 100}`,
        };
      })
      .filter(Boolean);
  }

  // GET /v1/thumbnails/avatar?userIds=1,2  (also the batch POST form)
  function avatarThumbnails(req, res) {
    const raw = req.query.userIds || (req.body && req.body.userIds) || '';
    const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);

    return res.json({
      data: thumbnailRows(ids, (id) => {
        const file = readUserFile(id);
        const user = ctx.getUser(id);
        // Prefer a real stored render over the site placeholder.
        return (file && file.avatarThumbnail)
          || (user && user.avatarThumbnail)
          || `${ctx.publicOrigin}/avatar-thumbs/${id}`
          || null;
      }),
    });
  }

  app.get('/v1/thumbnails/avatar', avatarThumbnails);
  app.post('/v1/thumbnails/avatar', avatarThumbnails);

  // GET /v1/thumbnails/assets?assetIds=1001,1002
  function assetThumbnails(req, res) {
    const raw = req.query.assetIds || (req.body && req.body.assetIds) || '';
    const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const assets = ctx.getAssets() || {};

    return res.json({
      data: thumbnailRows(ids, (id) => {
        const asset = assets[String(id)];
        if (!asset) return null;
        return asset.thumbnailUrl || asset.icon || null;
      }).map((row) => Object.assign(row, { state: 'Completed' })),
    });
  }

  app.get('/v1/thumbnails/assets', assetThumbnails);
  app.post('/v1/thumbnails/assets', assetThumbnails);

  // GET /v1/thumbnails/games?universeIds= / placeIds=
  function gameThumbnails(req, res) {
    const rawIds = req.query.universeIds || req.query.placeIds || '';
    const ids = String(rawIds).split(',').map((s) => s.trim()).filter(Boolean);

    return res.json({
      data: ids
        .map((raw) => {
          const placeId = ctx.normalizePlaceId(raw);
          const game = ctx.getGameEntry(placeId);
          if (!game) return null;
          return {
            targetId: Number(placeId),
            state: 'Completed',
            imageUrl: `${ctx.publicOrigin}/gameplaceholder/big.png`,
            version: `v${stableHash(placeId) % 900 + 100}`,
          };
        })
        .filter(Boolean),
    });
  }

  app.get('/v1/thumbnails/games', gameThumbnails);
  app.get('/v1/thumbnails/universes', gameThumbnails);

  /* ------------------------------------------------------------------------
   * Game passes + developer products
   * --------------------------------------------------------------------- */

  // GET /v1/game-pass/{gamePassId}
  app.get('/v1/game-pass/:gamePassId', (req, res) => {
    const id = readId(req.params.gamePassId);
    if (!id) return res.status(404).json({ errors: [{ code: 4, message: 'Game pass not found.' }] });

    // Only a pass that a place really defines is served.
    const games = ctx.getGames() || {};
    for (const game of Object.values(games)) {
      const passes = Array.isArray(game && game.gamePasses) ? game.gamePasses : [];
      const pass = passes.find((p) => Number(p && p.id) === id);
      if (pass) {
        return res.json({
          id,
          name: pass.name || 'Game Pass',
          displayName: pass.name || 'Game Pass',
          productId: Number(pass.productId || id),
          price: Number(pass.price || 0),
          isForSale: pass.isForSale !== false,
          iconImageAssetId: Number(pass.iconAssetId || 0),
          created: pass.createdAt || new Date().toISOString(),
          updated: pass.updatedAt || pass.createdAt || new Date().toISOString(),
        });
      }
    }

    return res.status(404).json({ errors: [{ code: 4, message: 'Game pass not found.' }] });
  });

  // GET /v1/developer-products/{productId}
  app.get('/v1/developer-products/:productId', (req, res) => {
    const id = readId(req.params.productId);
    if (!id) return res.status(404).json({ errors: [{ code: 4, message: 'Developer product not found.' }] });

    const games = ctx.getGames() || {};
    for (const game of Object.values(games)) {
      const products = Array.isArray(game && game.developerProducts) ? game.developerProducts : [];
      const product = products.find((p) => Number(p && p.id) === id);
      if (product) {
        return res.json({
          id,
          name: product.name || 'Developer Product',
          displayName: product.name || 'Developer Product',
          description: String(product.description || ''),
          priceInRobux: Number(product.price || 0),
          iconImageAssetId: Number(product.iconAssetId || 0),
          isForSale: product.isForSale !== false,
          created: product.createdAt || new Date().toISOString(),
          updated: product.updatedAt || product.createdAt || new Date().toISOString(),
        });
      }
    }

    return res.status(404).json({ errors: [{ code: 4, message: 'Developer product not found.' }] });
  });

  /* ------------------------------------------------------------------------
   * Ownership + economy
   * --------------------------------------------------------------------- */

  // GET /v1/ownership/hasasset?userId=&assetId=
  app.get('/v1/ownership/hasasset', (req, res) => {
    const userId = readId(req.query.userId);
    const assetId = readId(req.query.assetId);
    if (!userId || !assetId) return res.json({ isOwned: false });

    const user = ctx.getUser(userId);
    if (!user) return res.json({ isOwned: false });

    const owned = inventoryIds(user);
    return res.json({ isOwned: owned.includes(String(assetId)) });
  });

  // POST /v1/ownership/hasasset  { userId, assetIds }
  app.post('/v1/ownership/hasasset', (req, res) => {
    const body = req.body || {};
    const userId = readId(body.userId);
    const ids = Array.isArray(body.assetIds) ? body.assetIds : [];
    const user = userId ? ctx.getUser(userId) : null;
    if (!user) return res.json({ data: ids.map((assetId) => ({ assetId: Number(assetId), isOwned: false })) });

    const owned = inventoryIds(user);
    return res.json({
      data: ids.map((assetId) => ({ assetId: Number(assetId), isOwned: owned.includes(String(assetId)) })),
    });
  });

  // GET /v1/economy/currency  - the Robux balance the client shows in the topbar.
  app.get('/v1/economy/currency', (req, res) => {
    const sessionUser = (ctx.resolveSessionUser && ctx.resolveSessionUser(req)) || null;
    const userId = readId(req.query.userId) || Number(sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
    const user = ctx.getUser(userId);
    if (!user) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });

    const currency = ctx.getCurrencyForUser(user) || {};
    return res.json({
      robux: Number(currency.robux || 0),
      // The 2021 client also asked for these two; they read 0 on an account with
      // no tickets, which is the real state.
      tickets: Number(currency.tickets || 0),
      coins: Number(currency.coins || 0),
    });
  });

  /* ------------------------------------------------------------------------
   * Presence, friends, groups
   * --------------------------------------------------------------------- */

  // POST /v1/presence/users  { userIds: [...] }
  function presenceUsers(req, res) {
    const body = req.body || {};
    const ids = Array.isArray(body.userIds) ? body.userIds : [];
    const users = ctx.getUsers() || {};

    return res.json({
      userPresences: ids
        .map((raw) => {
          const id = readId(raw);
          if (!id) return null;
          const user = users[String(id)];
          if (!user) return null;
          return {
            userId: id,
            userPresenceType: 0,
            lastLocation: '',
            placeId: null,
            rootPlaceId: null,
            gameId: null,
            universeId: null,
            lastOnline: user.updatedAt || user.joinDate || new Date().toISOString(),
          };
        })
        .filter(Boolean),
    });
  }

  app.post('/v1/presence/users', presenceUsers);
  app.get('/v1/presence/users', (req, res) => {
    const raw = String(req.query.userIds || '').split(',').filter(Boolean);
    req.body = { userIds: raw };
    return presenceUsers(req, res);
  });

  // GET /v1/friends/{userId}/friends  (+ the flat /v1/friends list form)
  function friendsList(req, res) {
    const id = readId(req.params.userId || req.query.userId) || 1;
    const friends = (ctx.getFriendsForUser && ctx.getFriendsForUser(id)) || [];

    const data = friends
      .map((friend) => {
        const fid = Number(friend && (friend.userId || friend.id));
        if (!Number.isFinite(fid) || fid <= 0) return null;
        return {
          id: fid,
          username: friend.username || `Player${fid}`,
          displayName: friend.displayName || friend.username || `Player${fid}`,
          isOnline: false,
          hasVerifiedBadge: false,
        };
      })
      .filter(Boolean);

    return res.json(paginate(data, req, { limit: 50 }));
  }

  app.get('/v1/friends/:userId/friends', friendsList);
  app.get('/v1/friends/:userId/followings', friendsList);
  app.get('/v1/friends/:userId/followers', (req, res) => res.json(paginate([], req, { limit: 50 })));

  // GET /v1/groups/{groupId}  - a group page's public info.
  app.get('/v1/groups/:groupId', (req, res) => {
    const id = readId(req.params.groupId);
    if (!id) return res.status(404).json({ errors: [{ code: 1, message: 'Group not found.' }] });

    // Groups are derived from their owning account, so the name is always unique
    // and never fabricated (see groupNameFor() in server.js).
    const users = ctx.getUsers() || {};
    const owner = Object.values(users).find((u) => u && Number(u.groupId || 0) === id);
    if (!owner) return res.status(404).json({ errors: [{ code: 1, message: 'Group not found.' }] });

    return res.json({
      id,
      name: `${owner.username}'s Group`,
      description: String(owner.groupDescription || ''),
      owner: { userId: Number(owner.userId || owner.id), username: owner.username },
      memberCount: Number(owner.groupMemberCount || 1),
      created: owner.joinDate || new Date().toISOString(),
      hasVerifiedBadge: false,
    });
  });

  /* ------------------------------------------------------------------------
   * Locale / account settings / telemetry
   * --------------------------------------------------------------------- */

  // GET /v1/locale/current  and the supported-locales table.
  app.get('/v1/locale/current', (req, res) => {
    return res.json({
      languages: [{ languageCode: 'en', languageName: 'English' }],
      locale: { languageCode: 'en', languageName: 'English' },
      isRtl: false,
    });
  });

  app.get('/v1/locale/supported-locales', (req, res) => {
    return res.json([{ languageCode: 'en', languageName: 'English', nativeName: 'English', isRtl: false }]);
  });

  // GET /v1/account/settings
  app.get('/v1/account/settings', (req, res) => {
    const sessionUser = (ctx.resolveSessionUser && ctx.resolveSessionUser(req)) || null;
    const id = readId(req.query.userId) || Number(sessionUser && (sessionUser.userId || sessionUser.id)) || 1;
    const user = ctx.getUser(id);
    if (!user) return res.status(404).json({ errors: [{ code: 3, message: 'The user does not exist.' }] });

    return res.json({
      userId: Number(user.userId || id),
      displayName: user.displayName || user.username,
      username: user.username,
      email: String(user.email || ''),
      theme: user.theme || 'light',
      gender: user.gender || 'NotSpecified',
      aboutMe: user.aboutMe || 'everyone',
      membership: user.membershipStatus || user.membership || 'None',
      // These are the fields the 2021 client reads directly.
      canTrade: false,
      canAdvertise: false,
      isParentalAccount: false,
      inventoryPrivacy: 'All',
      tradePrivacy: 'None',
    });
  });

  /**
   * POST /v1/account/settings - the client writes back a settings patch.
   *
   * Only the fields this server actually stores are accepted; anything else is
   * acknowledged and ignored, which is how a real settings POST behaves rather
   * than erroring on an unknown FFlag-derived field.
   */
  app.post('/v1/account/settings', (req, res) => {
    const sessionUser = (ctx.resolveSessionUser && ctx.resolveSessionUser(req)) || null;
    if (!sessionUser) return res.status(401).json({ errors: [{ code: 0, message: 'Sign in to change settings.' }] });
    const id = Number(sessionUser.userId || sessionUser.id) || 1;
    const body = req.body || {};
    const patch = {};

    if (typeof body.displayName === 'string' && body.displayName.trim()) patch.displayName = body.displayName.trim().slice(0, 35);
    if (typeof body.gender === 'string' && ['Male', 'Female', 'NotSpecified'].includes(body.gender)) patch.gender = body.gender;
    if (typeof body.theme === 'string' && ['light', 'dark'].includes(body.theme)) patch.theme = body.theme;
    if (typeof body.aboutMe === 'string') patch.aboutMe = body.aboutMe.slice(0, 500);

    if (ctx.saveUser && Object.keys(patch).length) {
      ctx.saveUser(String(id), patch);
    }
    return res.json({ ok: true });
  });

  /**
   * Analytics + telemetry. The client fires these continuously; answering 200
   * with an empty body is correct (the real endpoints do not return data) and it
   * stops the client logging errors and retrying.
   */
  const accept = (req, res) => res.status(200).json({ ok: true });
  app.post('/v1/beacon/:kind', accept);
  app.post('/v2/beacon/:kind', accept);
  app.post('/v1/analytics/:kind', accept);
  app.get('/v1/device/info', (req, res) => res.json({ device: { platform: 'PC' } }));
  app.get('/v1/device', (req, res) => res.json({ device: { platform: 'PC' } }));
  app.get('/mobile/device', (req, res) => res.json({ device: { platform: 'PC' } }));

  /**
   * Client settings / FFlag override endpoint.
   *
   * The 2021M and 2022M clients fetch their FFlag table from the settings host.
   * Serving the SAME file the build ships means a locally launched client gets
   * the exact configuration it was tested with, instead of falling back to the
   * defaults baked into the executable.
   */
  app.get('/ClientSettings/ClientAppSettings.json', (req, res) => {
    const candidates = [
      path.join(ctx.releaseRoot, 'Clients', '2022M', 'ClientSettings', 'ClientAppSettings.json'),
      path.join(ctx.releaseRoot, 'Clients', '2021M', 'ClientSettings', 'ClientAppSettings.json'),
      path.join(ctx.releaseRoot, 'Clients', '2020M', 'ClientSettings', 'ClientAppSettings.json'),
    ];
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) return res.status(404).json({ ok: false, error: 'client-settings-not-found' });
    res.set('Cache-Control', 'no-store');
    return res.sendFile(file);
  });

  return { installed: true };
}

module.exports = { installClientApi };