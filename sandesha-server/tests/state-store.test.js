'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../db');
const { createStateStore } = require('../state-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
const db = openDb(path.join(dir, 'x.db'));
const store = createStateStore(db);

// schedules: order kept, replaced atomically, duplicates ignored
store.saveSchedules([{ id: 2, target: 'a', runAt: '2026-11-13T10:00:00Z' }, { id: 1, target: 'b', runAt: '2026-11-13T09:00:00Z', failed: true }, { id: 2, target: 'dup' }]);
assert.deepStrictEqual(store.loadSchedules().map((s) => s.id), [2, 1]);
store.saveSchedules([]);
assert.deepStrictEqual(store.loadSchedules(), []);

// sets
store.saveSets({ family: ['g1@g.us', 'g2@g.us'], work: [] });
assert.deepStrictEqual(store.loadSets(), { family: ['g1@g.us', 'g2@g.us'], work: [] });
store.saveSets({ family: ['g2@g.us'] });
assert.deepStrictEqual(store.loadSets(), { family: ['g2@g.us'] });

// contacts
store.saveContacts({ contacts: { Asha: '919999999999' } });
assert.deepStrictEqual(store.loadContacts(), { contacts: { Asha: '919999999999' } });

// settings
assert.strictEqual(store.getJson('bot_state'), undefined);
store.setJson('bot_state', { lastProcessedTimestamp: 5 });
assert.deepStrictEqual(store.getJson('bot_state'), { lastProcessedTimestamp: 5 });
console.log('  ✓ state store: schedules, sets, contacts and settings round-trip');

// one-time import of the old files, only into empty tables
const db2 = openDb(path.join(dir, 'y.db'));
const s2 = createStateStore(db2);
fs.writeFileSync(path.join(dir, 'groups.json'), JSON.stringify({ fam: ['a', 'b'] }));
fs.writeFileSync(path.join(dir, 'schedules.json'), JSON.stringify([{ id: 7, target: 'fam', runAt: 'x' }]));
fs.writeFileSync(path.join(dir, 'contacts.json'), JSON.stringify({ contacts: { Ravi: '1' } }));
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ lastProcessedTimestamp: 9, sendBudget: { dayCount: 1 } }));
s2.importLegacy(dir);
assert.deepStrictEqual(s2.loadSets(), { fam: ['a', 'b'] });
assert.strictEqual(s2.loadSchedules()[0].id, 7);
assert.strictEqual(s2.loadContacts().contacts.Ravi, '1');
assert.strictEqual(s2.getJson('bot_state').lastProcessedTimestamp, 9);
assert.ok(fs.existsSync(path.join(dir, 'groups.json.migrated')) && !fs.existsSync(path.join(dir, 'groups.json')));
// a second run must not overwrite newer data
fs.writeFileSync(path.join(dir, 'groups.json'), JSON.stringify({ old: ['z'] }));
s2.importLegacy(dir);
assert.deepStrictEqual(s2.loadSets(), { fam: ['a', 'b'] });
console.log('  ✓ state store: old JSON files are carried over once, never over newer data');
console.log('All state-store tests passed');
