'use strict';

/**
 * Real assertions for the LuckyBlox security module.
 * Run: node tests/security.test.js
 */

const assert = require('assert');
const sec = require('../server/security');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`FAIL  - ${name}\n        ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('security.js');

test('hashPassword produces verifiable hash', () => {
  const { hash, salt } = sec.hashPassword('CorrectHorse1');
  assert.ok(hash && salt, 'hash and salt returned');
  assert.strictEqual(sec.verifyPassword('CorrectHorse1', hash, salt), true);
});

test('verifyPassword rejects wrong password', () => {
  const { hash, salt } = sec.hashPassword('CorrectHorse1');
  assert.strictEqual(sec.verifyPassword('wrong', hash, salt), false);
});

test('verifyPassword is constant-time safe on malformed input', () => {
  assert.strictEqual(sec.verifyPassword('x', 'nothex', 'saltsalt'), false);
  assert.strictEqual(sec.verifyPassword('', '', ''), false);
  assert.strictEqual(sec.verifyPassword('x', null, null), false);
});

test('password policy rejects weak passwords', () => {
  assert.strictEqual(sec.checkPasswordPolicy('short').ok, false);
  assert.strictEqual(sec.checkPasswordPolicy('alllowercase').ok, false);
  assert.strictEqual(sec.checkPasswordPolicy('password').ok, false);
  assert.strictEqual(sec.checkPasswordPolicy('aaaaaaaaaa').ok, false);
});

test('password policy accepts a strong password', () => {
  const r = sec.checkPasswordPolicy('LuckyBlox2026');
  assert.strictEqual(r.ok, true, r.errors.join(','));
  assert.ok(r.score >= 2, `score was ${r.score}`);
});

test('username policy enforces format', () => {
  assert.strictEqual(sec.checkUsernamePolicy('ab').ok, false);
  assert.strictEqual(sec.checkUsernamePolicy('has space').ok, false);
  assert.strictEqual(sec.checkUsernamePolicy('_leading').ok, false);
  assert.strictEqual(sec.checkUsernamePolicy('tailsthehero10').ok, true);
});

test('rateLimit allows up to limit then blocks', () => {
  const key = 'rl-test-' + Date.now();
  assert.strictEqual(sec.rateLimit(key, 3, 60000).allowed, true);
  assert.strictEqual(sec.rateLimit(key, 3, 60000).allowed, true);
  assert.strictEqual(sec.rateLimit(key, 3, 60000).allowed, true);
  const blocked = sec.rateLimit(key, 3, 60000);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('clearRateLimit resets a bucket', () => {
  const key = 'rl-clear-' + Date.now();
  sec.rateLimit(key, 1, 60000);
  assert.strictEqual(sec.rateLimit(key, 1, 60000).allowed, false);
  sec.clearRateLimit(key);
  assert.strictEqual(sec.rateLimit(key, 1, 60000).allowed, true);
});

test('account lockout triggers after threshold', () => {
  const user = 'lock-' + Date.now();
  for (let i = 0; i < 5; i += 1) {
    sec.registerFailedLogin(user, 6, 60000);
  }
  assert.strictEqual(sec.getLockoutState(user).locked, false, 'not locked before threshold');
  sec.registerFailedLogin(user, 6, 60000);
  assert.strictEqual(sec.getLockoutState(user).locked, true, 'locked at threshold');
  sec.clearLockout(user);
  assert.strictEqual(sec.getLockoutState(user).locked, false, 'cleared');
});

test('CSRF token round-trips and rejects tampering', () => {
  const secret = 'test-secret';
  const session = 'sess-123';
  const token = sec.createCsrfToken(session, secret);
  assert.strictEqual(sec.verifyCsrfToken(token, session, secret), true);
  assert.strictEqual(sec.verifyCsrfToken(token, 'other-session', secret), false);
  assert.strictEqual(sec.verifyCsrfToken(token, session, 'wrong-secret'), false);
  assert.strictEqual(sec.verifyCsrfToken(token + 'x', session, secret), false);
  assert.strictEqual(sec.verifyCsrfToken('garbage', session, secret), false);
});

test('generateJobId looks like a UUID', () => {
  const id = sec.generateJobId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notStrictEqual(id, sec.generateJobId());
});

test('generateSessionId is unique and prefixed', () => {
  const a = sec.generateSessionId();
  const b = sec.generateSessionId();
  assert.ok(a.startsWith('lb_'));
  assert.notStrictEqual(a, b);
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
