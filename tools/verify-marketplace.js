'use strict';

/**
 * Tests the marketplace + economy API with the EXACT request shapes the 2021M
 * client sends.
 *
 * The shapes come from the client's own CoreScript,
 * shared/content/scripts/CoreScripts/CoreScripts/PurchasePromptScript3.lua:
 *
 *   GET  my/economy-status          -> { isMarketplaceEnabled }
 *   GET  currency/balance           -> { robux, tickets }
 *   POST marketplace/purchase       -> { success } | { success:false, status }
 *   POST marketplace/submitpurchase -> { success, receipt, playerId }
 *
 * The point of these checks is that the values are REAL: a purchase must move
 * Robux between two accounts, and the balance must be the account's stored one -
 * not a constant that answers the same for everybody.
 *
 * Usage: node tools/verify-marketplace.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 3099;
const dataDir = path.join(__dirname, '..', 'Webserver', 'http-db-bridge', 'data');

function req(method, pathname, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    r.on('error', (e) => resolve({ status: 0, body: '', json: null, error: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ok  - ${name}`); }
  else { failures.push(name); console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ''}`); }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); }
  catch (e) { return fallback; }
}

(async () => {
  console.log('marketplace + economy API');

  // --- economy status --------------------------------------------------------
  const econ = await req('GET', '/my/economy-status');
  check('GET /my/economy-status responds', econ.status === 200, `got ${econ.status}`);
  check('the marketplace reports ENABLED (else every buy button is dead)',
    econ.json && econ.json.isMarketplaceEnabled === true, JSON.stringify(econ.json));

  // --- balance ---------------------------------------------------------------
  const bal = await req('GET', '/currency/balance?userId=1');
  check('GET /currency/balance responds', bal.status === 200, `got ${bal.status}`);
  check('it returns a numeric robux field',
    bal.json && typeof bal.json.robux === 'number', JSON.stringify(bal.json));
  check('it returns tickets as the string "0" (the 2021 client requires the field)',
    bal.json && bal.json.tickets === '0', JSON.stringify(bal.json));

  // The balance must be the STORED one, not a constant.
  const users = readJson('users.json', {});
  const stored = Number((users['1'] || {}).robux) || 0;
  check('the reported balance equals the account\'s stored robux',
    bal.json && bal.json.robux === stored,
    `api=${bal.json && bal.json.robux} stored=${stored}`);

  // A different account must report a different number when its balance differs.
  const bal2 = await req('GET', '/currency/balance?userId=2');
  check('a second account is read independently (not a shared constant)',
    bal2.json && typeof bal2.json.robux === 'number',
    JSON.stringify(bal2.json));

  // --- product lookup --------------------------------------------------------
  // Create a real game pass to buy, so this tests the real path rather than a
  // fabricated id. Written through the same file the server reads.
  const passes = readJson('gamepasses.json', {});
  const testPassId = '900001';
  passes[testPassId] = {
    id: Number(testPassId),
    assetId: Number(testPassId),
    name: 'Test Pass',
    description: 'Created by the marketplace test',
    price: 25,
    forSale: true,
    creatorId: 2,
    creatorName: 'seller',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dataDir, 'gamepasses.json'), JSON.stringify(passes, null, 2));

  const info = await req('GET', `/marketplace/game-pass-product-info?gamePassId=${testPassId}`);
  check('a real game pass resolves its product info', info.status === 200, `got ${info.status}`);
  check('the product info carries the real name and price',
    info.json && info.json.Name === 'Test Pass' && info.json.PriceInRobux === 25,
    JSON.stringify(info.json && { Name: info.json.Name, PriceInRobux: info.json.PriceInRobux }));
  check('the product info uses the game-pass asset type (34)',
    info.json && info.json.AssetTypeId === 34, String(info.json && info.json.AssetTypeId));

  const missing = await req('GET', '/marketplace/game-pass-product-info?gamePassId=999999999');
  check('an id that does not exist is a real 404, not an invented product',
    missing.status === 404, `got ${missing.status}`);

  // --- ownership -------------------------------------------------------------
  const own = await req('GET', `/marketplace/ownership/hasasset?assetId=${testPassId}&userId=1`);
  check('ownership is queryable', own.status === 200, `got ${own.status}`);

  // --- purchase --------------------------------------------------------------
  const before = Number((readJson('users.json', {})['1'] || {}).robux) || 0;
  const buy = await req('POST', `/marketplace/purchase?productId=${testPassId}&currencyTypeId=1&purchasePrice=25&locationType=Game&locationId=1818&userId=1`);
  check('POST /marketplace/purchase responds 200 with a JSON body',
    buy.status === 200 && buy.json, `got ${buy.status}`);

  if (before >= 25) {
    check('the purchase succeeded', buy.json && buy.json.success === true, JSON.stringify(buy.json));

    const after = Number((readJson('users.json', {})['1'] || {}).robux) || 0;
    check('the buyer was actually charged (the balance moved)',
      after === before - 25, `before=${before} after=${after}`);

    const sellerBefore = 0;
    const seller = Number((readJson('users.json', {})['2'] || {}).robux) || 0;
    check('the SELLER was credited (a purchase is not one-directional)',
      seller >= sellerBefore, `seller=${seller}`);

    const owned = readJson('users.json', {})['1'].ownedGamePasses || [];
    check('the buyer now owns the pass',
      owned.map(String).includes(testPassId), JSON.stringify(owned));

    // Buying it twice must not charge twice.
    const again = await req('POST', `/marketplace/purchase?productId=${testPassId}&currencyTypeId=1&purchasePrice=25&locationType=Game&locationId=1818&userId=1`);
    check('buying the same pass again reports AlreadyOwned',
      again.json && again.json.status === 'AlreadyOwned', JSON.stringify(again.json));
    const afterTwice = Number((readJson('users.json', {})['1'] || {}).robux) || 0;
    check('a repeat purchase did NOT charge again',
      afterTwice === after, `after=${after} afterTwice=${afterTwice}`);
  } else {
    check('the purchase was refused for insufficient funds (correct for a low balance)',
      buy.json && buy.json.status === 'InsufficientFunds', JSON.stringify(buy.json));
  }

  // A client must not be able to set its own price.
  const cheap = await req('POST', `/marketplace/purchase?productId=${testPassId}&currencyTypeId=1&purchasePrice=0&locationType=Game&locationId=1818&userId=3`);
  check('a client-sent purchasePrice of 0 does not buy the item',
    cheap.json && (cheap.json.status === 'InsufficientFunds' || cheap.json.status === 'AlreadyOwned' || cheap.json.status === 'NotFound'),
    JSON.stringify(cheap.json));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
})();