'use strict';

process.env.SANDESHA_ADMIN_PASSWORD = 'test-secret';
// Never touch the live session file — clearAllSessions() below deletes it.
process.env.SANDESHA_SESSIONS_FILE = require('path').join(
  require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'sandesha-auth-')), 'sessions.json');
process.env.SANDESHA_AUTH_DISABLED = '';

delete require.cache[require.resolve('../auth')];
const auth = require('../auth');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    failed++;
  }
}

function mockReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

console.log('='.repeat(60));
console.log('SANDESHA AUTH TESTS');
console.log('='.repeat(60));
console.log('');

auth.clearAllSessions();

assert(auth.isAuthRequired() === true, 'Auth required when password is set');
assert(auth.isAuthDisabled() === false, 'Auth not disabled by default');

const bad = auth.login('wrong');
assert(bad.ok === false, 'Login rejects wrong password');

const good = auth.login('test-secret');
assert(good.ok === true, 'Login accepts correct password');
assert(good.role === 'admin', 'Password login issues admin role');
assert(typeof good.token === 'string' && good.token.length > 0, 'Login returns token');
assert(good.expiresAt, 'Login returns expiresAt');

assert(auth.getRole(mockReq(good.token)) === 'admin', 'getRole returns admin for password login');
assert(auth.normalizeRole('promotions') === 'promotions', 'normalizeRole promotions');
assert(auth.MESSAGING_ROLES.has('admin') && auth.MESSAGING_ROLES.has('promotions'), 'Messaging roles set');

assert(auth.validateAuth(mockReq(good.token)) === true, 'validateAuth accepts valid token');
assert(auth.validateAuth(mockReq('invalid-token')) === false, 'validateAuth rejects invalid token');
assert(auth.validateAuth(mockReq()) === false, 'validateAuth rejects missing token');

auth.logout(good.token);
assert(auth.validateAuth(mockReq(good.token)) === false, 'Token invalid after logout');

// Auth disabled mode
process.env.SANDESHA_AUTH_DISABLED = '1';
delete require.cache[require.resolve('../auth')];
const authDisabled = require('../auth');

assert(authDisabled.isAuthDisabled() === true, 'SANDESHA_AUTH_DISABLED=1 disables auth flag');
assert(authDisabled.isAuthRequired() === false, 'Auth not required when disabled');
assert(authDisabled.validateAuth(mockReq()) === true, 'validateAuth passes without token when disabled');

console.log('');
console.log('='.repeat(60));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);
