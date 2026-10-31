'use strict';

const assert = require('assert');
const { openDb } = require('../db');
const { createCheckins } = require('../checkins');

const db = openDb(':memory:');
const sent = [];
const listings = { get: (r, id) => ({ item: id === '4' ? { startdate: '2026-10-31' } : null }) };
// 2026-10-31 20:00 UTC is already 1 Nov in IST
const checkins = createCheckins({ db, listings, onChange: (...a) => sent.push(a), now: () => Date.UTC(2026, 9, 31, 20, 0, 0) });

const id = checkins.record({ name: ' Asha ', phone: '+919999999999', area: 'JP', programId: '4', programName: 'IE', ieCompletion: 'May-2024', consent: true });
assert.strictEqual(id, 1);
const [tbl, op, key, row] = sent[0];
assert.deepStrictEqual([tbl, op, key], ['checkins', 'upsert', '1']);
assert.strictEqual(row.month, '2026-11');
assert.strictEqual(row.name, 'Asha');
assert.strictEqual(row['program date'], '2026-10-31');
assert.strictEqual(row['ie completion'], 'May-2024');
assert.ok(!('consent' in row));
checkins.record({ name: 'X', programId: '99' });
assert.strictEqual(sent[1][3]['program date'], '');
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM checkins').get().n, 2);
console.log('  ✓ checkins record');
