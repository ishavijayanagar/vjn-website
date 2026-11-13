'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-'));
process.env.REACH_FILE = path.join(dir, 'reach.json');
process.env.REACH_MEDIA_DIR = path.join(dir, 'media');
const { openDb } = require('../db');
const fresh = () => { delete require.cache[require.resolve('../reach')]; return require('../reach'); };

const rec = (id, extra = {}) => ({
  id, key: `K${id}`, chat: 'g@g.us', chatName: 'Group', isGroup: true, audience: 0, kind: 'text', mime: '', text: 'hello', thumb: '',
  sentAt: 1000, via: 'api', post: `p|2026-11-13`, actor: { name: 'Asha', role: 'admin' }, checksDone: 1, nextCheckAt: 5000,
  status: 'measuring', delivered: 10, read: 4, played: 0, notDelivered: null, notRead: 6, readCurve: { 0: 1, 2: 3 },
  firstDeliveredAt: 1100, firstReadAt: null, ack: 3, replies: 1, replySamples: [{ at: 1, text: 'ok' }], reactions: { abc123: '👍' }, ...extra,
});

// an old reach.json is carried over once, and renamed
fs.writeFileSync(process.env.REACH_FILE, JSON.stringify({ version: 1, messages: { m1: rec('m1') } }));
const dbFile = path.join(dir, 'r.db');
let db = openDb(dbFile);
let reach = fresh();
reach.init({ db });
assert.ok(fs.existsSync(process.env.REACH_FILE + '.migrated'));
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM message_reach').get().n, 1);
assert.deepStrictEqual(db.prepare('SELECT hour, reads FROM message_reach_samples ORDER BY hour').all().map((x) => ({ ...x })), [{ hour: 0, reads: 1 }, { hour: 2, reads: 3 }]);
assert.deepStrictEqual(db.prepare('SELECT sender_hash, emoji FROM message_reactions').all().map((x) => ({ ...x })), [{ sender_hash: 'abc123', emoji: '👍' }]);
console.log('  ✓ reach: old reach.json carried over into messages, samples and reactions');

// a change is written; after a "restart" everything reads back identical; removal drops the children
reach._store().messages.m1.delivered = 12;
reach._store().messages.m1.readCurve[5] = 2;
delete reach._store().messages.m1.reactions.abc123;
reach._store().messages.m2 = rec('m2', { notRead: null, extraField: 'kept' });
reach._persist();
db.close();
db = openDb(dbFile);
reach = fresh();
reach.init({ db });
const back = reach._store().messages;
assert.strictEqual(back.m1.delivered, 12);
assert.deepStrictEqual(back.m1.readCurve, { 0: 1, 2: 3, 5: 2 });
assert.deepStrictEqual(back.m1.reactions, {});
assert.strictEqual(back.m2.notRead, null);
assert.strictEqual(back.m2.extraField, 'kept');
assert.deepStrictEqual(back.m2.actor, { name: 'Asha', role: 'admin' });
assert.strictEqual(back.m2.isGroup, true);
delete reach._store().messages.m2;
reach._persist();
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM message_reach').get().n, 1);
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM message_reach_samples WHERE message_id = 'm2'").get().n, 0);
console.log('  ✓ reach: changes round-trip across a restart; a pruned message takes its samples and reactions with it');

// blobs saved by the first database version are carried over and the old table is dropped
db.exec(`CREATE TABLE message_reach_blob_old (id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}') STRICT`);
db.prepare('INSERT INTO message_reach_blob_old (id, sent_at, data) VALUES (?, ?, ?)').run('m9', 1, JSON.stringify(rec('m9')));
db.close();
db = openDb(dbFile);
reach = fresh();
reach.init({ db });
assert.ok(reach._store().messages.m9);
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'message_reach_blob_old'").get().n, 0);
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM message_reach WHERE id = 'm9'").get().n, 1);
console.log('  ✓ reach: messages saved as blobs by the first version are carried over');
console.log('All reach-db tests passed');
