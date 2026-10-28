'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { openDb } = require('../db');
const { createVjnUsers, hashPassword } = require('../vjn-users');
const { createVjnRoutes } = require('../vjn-routes');

const SECRET = 'test-secret';

function setup() {
  let clock = 1_800_000_000_000;
  const notes = [];
  const users = createVjnUsers({
    db: openDb(':memory:'),
    secret: SECRET,
    notifySheet: async (n) => { notes.push(n); },
    now: () => clock,
  });
  const salt = 'abc';
  users.importUsers([
    { id: 'u-admin', username: 'admin', display_name: 'Admin', role: 'admin', password_salt: salt, password_hash: hashPassword('secret1', salt), status: 'active' },
    { id: 'u-promo', username: 'promotions', display_name: 'Promo', role: 'promotions', password_salt: salt, password_hash: hashPassword('promo12', salt), status: 'active' },
  ]);
  return { users, notes, tick: (ms) => { clock += ms; }, now: () => clock };
}

/** Load apps-script.js with just enough of the Apps Script runtime to check tokens. */
function appsScript(props) {
  const ctx = {
    Utilities: {
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    CacheService: { getScriptCache: () => ({ put() {}, remove() {}, get: () => null }) },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script.js'), 'utf8'), ctx);
  return ctx;
}

function mockRes() {
  return { statusCode: 0, body: null, writeHead(c) { this.statusCode = c; }, end(d) { this.body = JSON.parse(d); } };
}

async function run() {
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${err.stack}`);
    }
  }

  await test('imported Sheet passwords sign in; wrong ones do not', () => {
    const { users } = setup();
    const ok = users.login('admin', 'secret1');
    assert.ok(ok.token.startsWith('v1.'));
    assert.strictEqual(ok.user.role, 'admin');
    assert.strictEqual(users.login('admin', 'nope').error, 'Invalid password.');
    assert.match(users.login('nurturing', 'x').error, /not set up/);
  });

  await test('a token verifies until it expires', () => {
    const t = setup();
    const { token } = t.users.login('promotions', 'promo12');
    assert.strictEqual(t.users.verify(token).role, 'promotions');
    assert.strictEqual(t.users.verify(token.slice(0, -2) + 'xx'), null);
    t.tick(31 * 24 * 3600e3);
    assert.strictEqual(t.users.verify(token), null);
  });

  await test('disabling cuts off old tokens here and tells the Sheet', async () => {
    const t = setup();
    const admin = t.users.verify(t.users.login('admin', 'secret1').token);
    const { token } = t.users.login('promotions', 'promo12');
    t.tick(10);
    await t.users.setStatus(admin, 'u-promo', 'disabled');
    assert.strictEqual(t.users.verify(token), null);
    assert.deepStrictEqual(t.notes.at(-1), { id: 'u-promo', disabled: true, before: t.now() });
    assert.match(t.users.login('promotions', 'promo12').error, /not set up/);
    await t.users.setStatus(admin, 'u-promo', 'active');
    assert.strictEqual(t.users.verify(token), null, 'old token stays dead after re-enabling');
    assert.ok(t.users.login('promotions', 'promo12').token);
  });

  await test('a failed Sheet notice changes nothing', async () => {
    const t = setup();
    const admin = t.users.verify(t.users.login('admin', 'secret1').token);
    const failing = createVjnUsers({
      db: openDb(':memory:'), secret: SECRET, notifySheet: async () => { throw new Error('offline'); },
    });
    failing.importUsers([{ id: 'u-promo', username: 'p', role: 'promotions', status: 'active' }]);
    await assert.rejects(failing.setStatus(admin, 'u-promo', 'disabled'), /offline/);
    assert.strictEqual(failing.list()[0].status, 'active');
  });

  await test('keeps the last admin and guards your own account', async () => {
    const t = setup();
    const admin = t.users.verify(t.users.login('admin', 'secret1').token);
    await assert.rejects(t.users.setStatus(admin, 'u-admin', 'disabled'), /own account/);
    await assert.rejects(t.users.save(admin, { id: 'u-admin', role: 'programs' }), /at least one active admin|own role/);
  });

  await test('adding a person and changing a password', async () => {
    const t = setup();
    const admin = t.users.verify(t.users.login('admin', 'secret1').token);
    const added = await t.users.save(admin, { displayName: 'Nurture Team', role: 'nurturing', password: 'nurture1' });
    assert.strictEqual(added.user.username, 'nurtureteam');
    assert.ok(t.users.login('nurturing', 'nurture1').token);
    const old = t.users.login('nurturing', 'nurture1').token;
    t.tick(10);
    await t.users.save(admin, { id: added.user.id, password: 'changed1' });
    assert.strictEqual(t.users.verify(old), null);
    assert.ok(t.users.login('nurturing', 'changed1').token);
  });

  await test('refresh hands back a fresh token for a live one', () => {
    const t = setup();
    const { token } = t.users.login('admin', 'secret1');
    t.tick(5);
    const fresh = t.users.refresh(token);
    assert.notStrictEqual(fresh.token, token);
    assert.ok(t.users.verify(fresh.token));
  });

  await test('Apps Script accepts a Pi token and honours a revoke', () => {
    const t = setup();
    const { token } = t.users.login('promotions', 'promo12');
    const props = { VJN_AUTH_SECRET: SECRET };
    const gas = appsScript(props);
    const read = gas.readSession_(token);
    assert.strictEqual(read.session.role, 'promotions');
    assert.strictEqual(read.session.id, 'u-promo');
    assert.strictEqual(gas.readSession_(token.replace(/.$/, 'A')).session, undefined);
    assert.throws(() => gas.vjnRevoke_({ secret: 'wrong', id: 'u-promo' }), /Unauthorized/);
    props['vjn_rev_u-promo'] = String(t.now() + 1);
    assert.strictEqual(gas.readSession_(token).reason, 'expired');
  });

  await test('Apps Script refuses Pi tokens when no secret is set', () => {
    const t = setup();
    const gas = appsScript({});
    assert.strictEqual(gas.readSession_(t.users.login('admin', 'secret1').token).reason, 'expired');
  });

  await test('routes: login, admin-only Team, and a cap on wrong passwords', async () => {
    const t = setup();
    const routes = createVjnRoutes({
      users: t.users,
      readBody: async (req) => req.body || '',
      jsonResponse: (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); },
    });
    const call = async (method, pathname, body, token) => {
      const res = mockRes();
      const req = { method, body: body && JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} };
      await routes.handle(req, res, { pathname });
      return res;
    };
    const login = await call('POST', '/vjn/login', { role: 'admin', password: 'secret1' });
    assert.strictEqual(login.statusCode, 200);
    const list = await call('GET', '/vjn/users', null, login.body.token);
    assert.strictEqual(list.body.users.length, 2);
    const promo = (await call('POST', '/vjn/login', { role: 'promotions', password: 'promo12' })).body.token;
    assert.strictEqual((await call('GET', '/vjn/users', null, promo)).statusCode, 403);
    assert.strictEqual((await call('GET', '/vjn/users')).statusCode, 401);
    for (let i = 0; i < 10; i++) await call('POST', '/vjn/login', { role: 'admin', password: 'bad' });
    assert.strictEqual((await call('POST', '/vjn/login', { role: 'admin', password: 'secret1' })).statusCode, 429);
  });

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nAll vjn-users tests passed');
}

run();
