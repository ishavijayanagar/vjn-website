'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SANDESHA_ADMIN_PASSWORD = 'pw';
process.env.SANDESHA_PUSH_NO_PERSIST = '1';
const { openDb } = require('../db');
const auth = require('../auth');
const push = require('../push');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
const file = path.join(dir, 's.db');

// sessions: stored by hash, survive a "restart", gone after logout
let db = openDb(file);
auth.useDb(db);
const { token } = auth.login('pw');
assert.ok(auth.getSession(token));
const row = db.prepare('SELECT * FROM login_sessions').get();
assert.notStrictEqual(row.token_hash, token);
assert.strictEqual(row.token_hash.length, 64);
db.close();
db = openDb(file);
auth.clearAllSessions(); // memory only for this check
auth.useDb(db);
assert.ok(auth.getSession(token), 'session survives a restart');
auth.logout(token);
assert.strictEqual(auth.getSession(token), null);
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM login_sessions').get().n, 0);
console.log('  ✓ sessions: kept by hash, survive a restart, removed on logout');

// push subscriptions: upsert, count, remove; the old JSON file is carried over once
const legacy = path.join(dir, 'push-subscriptions.json');
fs.writeFileSync(legacy, JSON.stringify([{ endpoint: 'https://push.example/old', keys: {}, role: 'programs', userId: 'u9' }]));
push.useDb(db, legacy);
assert.strictEqual(push.loadSubs().length, 1, 'old file carried over');
assert.ok(fs.existsSync(legacy + '.migrated') && !fs.existsSync(legacy));
assert.strictEqual(push.removeSub('https://push.example/old'), true);
push.addSub({ endpoint: 'https://push.example/a', keys: { p256dh: 'x', auth: 'y' } }, { role: 'nurturing', userId: 'u1' });
push.addSub({ endpoint: 'https://push.example/a', keys: { p256dh: 'x2', auth: 'y' } }, { role: 'nurturing', userId: 'u1' });
assert.strictEqual(push.loadSubs().length, 1);
assert.strictEqual(push.loadSubs()[0].keys.p256dh, 'x2');
assert.strictEqual(push.countForUser('u1'), 1);
assert.strictEqual(push.removeSub('https://push.example/a'), true);
assert.strictEqual(push.loadSubs().length, 0);
console.log('  ✓ push subscriptions: upsert, count, remove');
console.log('All state-table tests passed');
