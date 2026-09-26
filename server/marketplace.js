'use strict';

/**
 * LuckyBlox marketplace + economy API.
 *
 * The 2021M client does not talk to the site's HTML pages when it buys something.
 * Its own CoreScript (shared/content/scripts/CoreScripts/CoreScripts/
 * PurchasePromptScript3.lua) calls a small set of JSON endpoints, and if they are
 * missing the prompt fails with "the product could not be found" - which is
 * exactly what happens today, because the bridge implements NONE of them.
 *
 * The endpoints, taken from that script rather than invented:
 *
 *   GET  my/economy-status
 *        -> { "isMarketplaceEnabled": true }
 *
 *   GET  currency/balance
 *        -> { "robux": <number>, "tickets": "0" }
 *
 *   POST marketplace/purchase?productId=&currencyTypeId=&purchasePrice=
 *                            &locationType=Game&locationId=
 *        -> { "success": true }
 *        -> { "success": false, "status": "AlreadyOwned" | "EconomyDisabled"
 *             | "InsufficientFunds" | "NotForSale" | "InvalidRequest" }
 *
 *   POST marketplace/submitpurchase?productId=&currencyTypeId=
 *                                  &expectedUnitPrice=&placeId=&requestId=
 *        -> { "success": true, "receipt": <id>, "playerId": <id> }
 *
 *   GET  marketplace/productinfo?productId=
 *   GET  marketplace/game-pass-product-info?gamePassId=
 *   GET  marketplace/ownership/hasasset?assetId=&userId=
 *
 * Two rules shape this file:
 *
 *   1. Every value is read from the account's stored data. Nothing is a constant.
 *      The PHP endpoints this replaces answered with a hardcoded 9999999999 Robux
 *      and always said "AlreadyOwned", so a purchase never actually happened and
 *      the balance was the same for everybody.
 *
 *   2. A purchase MOVES Robux: the buyer pays, the seller is credited. A purchase
 *      that only flips an ownership flag is not a marketplace.
 *
 * Products live in data/products.json (developer products, sold per place) and
 * data/gamepasses.json (game passes, owned account-wide). Both are created from
 * the Studio side and are the reason a place's products can now be resolved.
 */

const fs = require('fs');
const path = require('path');

// Roblox's own currency ids, as the client sends them.
const CURRENCY_ROBUX = 1;
const CURRENCY_TICKETS = 2;

// Roblox's asset type ids for the two sellable things this server supports.
const ASSET_TYPE_GAME_PASS = 34;
const ASSET_TYPE_DEVELOPER_PRODUCT = 38;

/**
 * Build the marketplace routes.
 *
 * @param {object} deps  the host server's own helpers, injected so this module
 *                       never reaches into server internals directly:
 *                       getUser, saveUser, getUsers, writeJson, readJson, dataDir,
 *                       audit, resolveSessionUser, listServersForPlace
 */
function installMarketplaceRoutes(app, deps) {
  const {
    getUser,
    saveUser,
    getUsers,
    writeJson,
    readJson,
    dataDir,
    audit,
  } = deps;

  const productsPath = path.join(dataDir, 'products.json');
  const gamePassesPath = path.join(dataDir, 'gamepasses.json');

  /** Every developer product, keyed by product id. */
  function getProducts() {
    const raw = readJson(productsPath, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  /** Every game pass, keyed by pass id. */
  function getGamePasses() {
    const raw = readJson(gamePassesPath, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  /**
   * The account a request acts as.
   *
   * The client identifies itself by userId on these calls (it has already been
   * authenticated by the join ticket), and the site sends the session cookie. The
   * query wins when present because that is what the CoreScript sends; a signed-in
   * session is the fallback so a browser-side call still works.
   */
  function actingUser(req) {
    const raw = req.query.userId || req.query.userid || req.body?.userId;
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (Number.isFinite(id) && id > 0) return getUser(id);
    const sessionUser = deps.resolveSessionUser ? deps.resolveSessionUser(req) : null;
    return sessionUser || null;
  }

  function robuxOf(user) {
    const n = Number(user && user.robux);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Add or remove Robux and persist it.
   *
   * saveUser() is the single write path, so the change is mirrored to the client
   * state files and to the free remote store exactly like any other account edit.
   */
  function setRobux(user, amount) {
    const next = Math.max(0, Math.round(Number(amount) || 0));
    const updated = Object.assign({}, user, { robux: next });
    saveUser(Number(user.userId || user.id || 1), updated);
    return next;
  }

  /** The account that receives payment for a product. */
  function sellerIdOf(record) {
    const id = Number(record && (record.creatorId || record.authorId || record.sellerId));
    return Number.isFinite(id) && id > 0 ? id : 1;
  }

  // --- Economy status --------------------------------------------------------

  /**
   * Is the marketplace open? The client checks this before showing any price.
   * Reporting false makes every purchase button read "not for sale", so this is
   * what makes buying possible at all.
   */
  app.get('/my/economy-status', (req, res) => {
    res.json({ isMarketplaceEnabled: true });
  });

  // --- Balance ---------------------------------------------------------------

  /**
   * The player's real Robux.
   *
   * The client reads `robux` and shows it in its own top bar, so this is also how
   * the desktop client learns the account has currency.
   *
   * Tickets are reported as "0" because the 2021 client still asks for them and
   * treats a missing field as an error; Roblox removed Tickets, so a literal 0 is
   * the honest answer.
   */
  app.get('/currency/balance', (req, res) => {
    const user = actingUser(req);
    res.set('Cache-Control', 'no-store');
    return res.json({
      robux: user ? robuxOf(user) : 0,
      tickets: '0',
    });
  });

  // --- Product info ----------------------------------------------------------

  /**
   * Details for one product id, in the shape MarketplaceService expects.
   *
   * A developer product and a game pass are looked up in their own store first,
   * then the asset catalog. An id that exists in none of them is a genuine 404 -
   * inventing a placeholder here is what makes a game think it sold something
   * that does not exist.
   */
  function describeProduct(productId) {
    const id = String(productId);

    const pass = getGamePasses()[id];
    if (pass) {
      return {
        AssetId: Number(pass.assetId || pass.id || id),
        ProductId: Number(id),
        Name: pass.name || 'Game Pass',
        Description: pass.description || '',
        AssetTypeId: ASSET_TYPE_GAME_PASS,
        Creator: { Id: sellerIdOf(pass), Name: pass.creatorName || 'Creator', CreatorType: 'User', CreatorTargetId: sellerIdOf(pass) },
        IconImageAssetId: 0,
        Created: pass.createdAt || new Date(0).toISOString(),
        Updated: pass.updatedAt || new Date(0).toISOString(),
        PriceInRobux: Number(pass.price) || 0,
        PriceInTickets: null,
        Sales: Number(pass.sales) || 0,
        IsNew: false,
        IsForSale: pass.forSale !== false,
        IsPublicDomain: false,
        IsLimited: false,
        IsLimitedUnique: false,
        Remaining: null,
        MinimumMembershipLevel: 0,
        ContentRatingTypeId: 0,
      };
    }

    const product = getProducts()[id];
    if (product) {
      return {
        AssetId: 0,
        ProductId: Number(id),
        Name: product.name || 'Developer Product',
        Description: product.description || '',
        AssetTypeId: ASSET_TYPE_DEVELOPER_PRODUCT,
        Creator: { Id: sellerIdOf(product), Name: product.creatorName || 'Creator', CreatorType: 'User', CreatorTargetId: sellerIdOf(product) },
        IconImageAssetId: 0,
        Created: product.createdAt || new Date(0).toISOString(),
        Updated: product.updatedAt || new Date(0).toISOString(),
        PriceInRobux: Number(product.price) || 0,
        PriceInTickets: null,
        Sales: Number(product.sales) || 0,
        IsNew: false,
        IsForSale: product.forSale !== false,
        IsPublicDomain: false,
        IsLimited: false,
        IsLimitedUnique: false,
        Remaining: null,
        MinimumMembershipLevel: 0,
        ContentRatingTypeId: 0,
      };
    }

    return null;
  }

  app.get('/marketplace/productinfo', (req, res) => {
    const id = req.query.productId || req.query.assetId;
    const info = describeProduct(id);
    if (!info) {
      // A real 404, not a fabricated record: the client shows "not found" for an
      // id nothing has ever created, which is the correct behaviour.
      return res.status(404).json({ success: false, status: 'NotFound', productId: Number(id) || 0 });
    }
    return res.json(info);
  });

  app.get('/marketplace/game-pass-product-info', (req, res) => {
    const id = req.query.gamePassId || req.query.productId || req.query.assetId;
    const info = describeProduct(id);
    if (!info) {
      return res.status(404).json({ success: false, status: 'NotFound', gamePassId: Number(id) || 0 });
    }
    return res.json(info);
  });

  // --- Ownership -------------------------------------------------------------

  /**
   * Does this account own the asset?
   *
   * Ownership lives on the account (user.ownedGamePasses / user.inventory), so a
   * purchase survives a restart and is visible to the site as well as the client.
   */
  function ownsAsset(user, assetId) {
    if (!user) return false;
    const id = String(assetId);
    const passes = Array.isArray(user.ownedGamePasses) ? user.ownedGamePasses : [];
    const inventory = Array.isArray(user.inventory) ? user.inventory : [];
    return passes.map(String).includes(id) || inventory.map(String).includes(id);
  }

  app.get('/marketplace/ownership', (req, res) => {
    const user = actingUser(req);
    const ids = String(req.query.assetId || req.query.assetIds || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const result = {};
    for (const id of ids) result[id] = ownsAsset(user, id);
    return res.json({ success: true, ownership: result });
  });

  app.get('/marketplace/ownership/hasasset', (req, res) => {
    const user = actingUser(req);
    const assetId = req.query.assetId;
    return res.json({ success: true, assetId: Number(assetId) || 0, owns: ownsAsset(user, assetId) });
  });

  // --- Purchase --------------------------------------------------------------

  /**
   * Buy an asset (a game pass, a catalog item).
   *
   * Every failure the client understands is returned as a 200 with
   * `{ success: false, status }`, because that is the shape the CoreScript reads;
   * a bare HTTP error would show the player a generic failure instead of the real
   * reason.
   */
  app.post('/marketplace/purchase', (req, res) => {
    const params = Object.assign({}, req.query, req.body);
    const productId = String(params.productId || params.assetId || '');
    const user = actingUser(req);

    if (!user) return res.json({ success: false, status: 'InvalidRequest' });

    const info = describeProduct(productId);
    if (!info) return res.json({ success: false, status: 'NotFound' });
    if (!info.IsForSale) return res.json({ success: false, status: 'NotForSale' });

    const assetId = String(info.AssetId || productId);
    if (ownsAsset(user, assetId)) return res.json({ success: false, status: 'AlreadyOwned' });

    // The price is the SELLER's, never the client's claim: a client that sends
    // purchasePrice=0 must not get the item for free.
    const price = Number(info.PriceInRobux) || 0;
    const balance = robuxOf(user);

    if (price > 0 && balance < price) {
      return res.json({ success: false, status: 'InsufficientFunds' });
    }

    // Take the money, then grant the item.
    //
    // ORDER MATTERS: the balance and the ownership must be written in ONE save.
    // An earlier version called setRobux() (which saves) and then saved again from
    // the stale `user` object, so the second write silently reverted the charge -
    // the buyer got the pass for free and the seller was paid out of nothing.
    const nextBalance = Math.max(0, Math.round(balance - price));

    const owned = Array.isArray(user.ownedGamePasses) ? user.ownedGamePasses.map(String) : [];
    if (!owned.includes(assetId)) owned.push(assetId);
    const inventory = Array.isArray(user.inventory) ? user.inventory.map(String) : [];
    if (!inventory.includes(assetId)) inventory.push(assetId);

    const userId = Number(user.userId || user.id || 1);
    saveUser(userId, Object.assign({}, user, {
      robux: nextBalance,
      ownedGamePasses: owned,
      inventory,
    }));

    // Pay the seller. Without this the Robux simply vanish, which makes the
    // economy one-directional and the creator never sees a sale.
    const sellerId = sellerIdOf(getGamePasses()[productId] || getProducts()[productId]);
    if (sellerId && String(sellerId) !== String(userId)) {
      const seller = getUser(sellerId);
      if (seller) setRobux(seller, robuxOf(seller) + price);
    }

    if (audit) {
      audit('marketplace_purchase', {
        userId: String(userId),
        productId,
        price,
        balanceAfter: nextBalance,
      });
    }

    return res.json({ success: true });
  });

  /**
   * Buy a developer product (a consumable, sold per place).
   *
   * Unlike a game pass, a developer product can be bought repeatedly, so ownership
   * is NOT a blocker - that is the whole point of the two being different types.
   * The client expects a receipt back so the game's ProcessReceipt handler can
   * grant the item.
   */
  app.post('/marketplace/submitpurchase', (req, res) => {
    const params = Object.assign({}, req.query, req.body);
    const productId = String(params.productId || '');
    const user = actingUser(req);

    if (!user) return res.json({ success: false, status: 'InvalidRequest' });

    const product = getProducts()[productId];
    if (!product) return res.json({ success: false, status: 'NotFound' });
    if (product.forSale === false) return res.json({ success: false, status: 'NotForSale' });

    const price = Number(product.price) || 0;
    const balance = robuxOf(user);
    if (price > 0 && balance < price) {
      return res.json({ success: false, status: 'InsufficientFunds' });
    }

    const nextBalance = setRobux(user, balance - price);

    // A receipt is what the game hands to ProcessReceipt. It has to be unique per
    // purchase or a game that de-duplicates receipts would drop the second one.
    const receipt = `lb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const userId = Number(user.userId || user.id || 1);

    // Record the sale on the product and on the account's purchase history.
    const products = getProducts();
    products[productId] = Object.assign({}, product, {
      sales: (Number(product.sales) || 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    writeJson(productsPath, products);

    const history = Array.isArray(user.purchaseHistory) ? user.purchaseHistory.slice(-199) : [];
    history.push({ receipt, productId, price, placeId: Number(params.placeId) || null, at: new Date().toISOString() });
    saveUser(userId, Object.assign({}, getUser(userId), { purchaseHistory: history, robux: nextBalance }));

    const sellerId = sellerIdOf(product);
    if (sellerId && String(sellerId) !== String(userId)) {
      const seller = getUser(sellerId);
      if (seller) setRobux(seller, robuxOf(seller) + price);
    }

    if (audit) {
      audit('marketplace_submitpurchase', { userId: String(userId), productId, price, receipt });
    }

    return res.json({ success: true, receipt, playerId: userId });
  });

  /**
   * Validate a purchase before it is made. The client uses this to show the price
   * and to decide whether the button is enabled, so it must agree with /purchase.
   */
  app.post('/marketplace/validatepurchase', (req, res) => {
    const params = Object.assign({}, req.query, req.body);
    const productId = String(params.productId || '');
    const user = actingUser(req);
    const info = describeProduct(productId);

    if (!info) return res.json({ success: false, status: 'NotFound', productId });

    const price = Number(info.PriceInRobux) || 0;
    const balance = robuxOf(user);
    const alreadyOwned = info.AssetTypeId === ASSET_TYPE_GAME_PASS && ownsAsset(user, info.AssetId || productId);

    return res.json({
      success: true,
      productId,
      price,
      balance,
      alreadyOwned,
      canAfford: balance >= price,
      isForSale: info.IsForSale !== false,
    });
  });

  return {
    getProducts,
    getGamePasses,
    describeProduct,
    ownsAsset,
    robuxOf,
    setRobux,
  };
}

module.exports = { installMarketplaceRoutes, ASSET_TYPE_GAME_PASS, ASSET_TYPE_DEVELOPER_PRODUCT };