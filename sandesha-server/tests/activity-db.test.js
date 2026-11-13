'use strict';
const assert = require('assert');
const { openDb } = require('../db');
const activity = require('../activity');
const safety = require('../send-safety');

// without a database: kept in memory, newest first
activity.recordEvent({ title: 'one', category: 'send' });
activity.recordEvent({ title: 'two', category: 'bogus' });
let rows = activity.loadActivity({ limit: 10 });
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].category, 'system');

// with a database: stored, newest first, limit and since respected, survives a reopen
const db = openDb(':memory:');
activity.useDb(db);
activity.recordEvent({ title: 'a', category: 'send', actor: { role: 'admin', name: 'Asha' }, meta: { n: 1 } });
activity.recordEvent({ title: 'b', category: 'schedule', ok: false });
rows = activity.loadActivity({ limit: 10 });
assert.deepStrictEqual(rows.map((r) => r.title), ['b', 'a']);
assert.strictEqual(rows[1].actor.name, 'Asha');
assert.strictEqual(rows[0].ok, false);
assert.strictEqual(activity.loadActivity({ limit: 1 }).length, 1);
assert.strictEqual(activity.loadActivity({ sinceIso: new Date(Date.now() + 60000).toISOString() }).length, 0);
console.log('  ✓ activity log: kept in the database, newest first, limit and since');

safety.useDb(db);
safety.auditSend({ kind: 'text', target: 'g@g.us', chars: 12 });
const a = db.prepare('SELECT kind, target, chars FROM send_audit_log').get();
assert.deepStrictEqual({ ...a }, { kind: 'text', target: 'g@g.us', chars: 12 });
console.log('  ✓ send audit: one row per send');
console.log('All activity-db tests passed');
