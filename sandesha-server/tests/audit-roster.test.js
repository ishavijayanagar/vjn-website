'use strict';
const assert = require('assert');
const { openDb } = require('../db');
const { createAuditTrail } = require('../audit-trail');
const { createRoster } = require('../roster');
const { createVjnApi } = require('../vjn-api');

(async () => {
  const db = openDb(':memory:');

  // audit trail: records who did what, not the contents
  const audit = createAuditTrail(db);
  audit.record({ id: 'u1', username: 'asha', role: 'programs' }, 'adminSaveItem', { resource: 'programs', id: '4', item: { title: 'secret' } });
  const [row] = audit.recent();
  assert.deepStrictEqual({ ...row, at: 0 }, { at: 0, username: 'asha', role: 'programs', action: 'adminSaveItem', resource: 'programs', resource_id: '4' });
  const calls = [];
  const api = createVjnApi({
    listings: { save: () => ({ id: 9 }), remove() {}, clearOnly() {} }, content: {}, inquiries: {}, ev: {},
    audit: (s, a, d) => calls.push([s.username, a, d.resource]),
  });
  api.admin({ id: 'u2', username: 'ravi', role: 'admin' }, { formType: 'adminSaveItem', resource: 'programs', item: {} });
  assert.deepStrictEqual(calls, [['ravi', 'adminSaveItem', 'programs']]);
  api.admin({ id: 'u2', username: 'ravi', role: 'admin' }, { formType: 'adminGet', type: 'nothing' });
  assert.strictEqual(calls.length, 1, 'reads are not recorded');
  console.log('  ✓ audit trail: a change is recorded with who, what and which item; reads are not');

  // roster: one row per volunteer, replaced on each refresh, old blob moved over
  let reply = { configured: true, title: 'T', headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] };
  const roster = createRoster({ db, fetchRoster: async () => reply });
  assert.strictEqual((await roster.sync()), true);
  assert.deepStrictEqual(roster.read().rows, [['1', '2'], ['3', '4']]);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM volunteer_roster').get().n, 2);
  reply = { configured: true, title: 'T', headers: ['a', 'b'], rows: [['9', '9']] };
  await roster.sync();
  assert.deepStrictEqual(roster.read().rows, [['9', '9']]);
  reply = { error: 'down' };
  assert.strictEqual(await roster.sync(), false);
  assert.deepStrictEqual(roster.read().rows, [['9', '9']], 'a failed refresh keeps the saved copy');
  db.prepare("INSERT INTO app_setting (key, value) VALUES ('roster', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ configured: true, title: 'Old', headers: ['x'], rows: [['old']] }));
  db.prepare('DELETE FROM volunteer_roster').run();
  assert.deepStrictEqual(roster.read().rows, [['old']], 'rows kept inside the old setting are moved over');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM volunteer_roster').get().n, 1);
  console.log('  ✓ roster: one row per volunteer, replaced on refresh, kept when the Sheet is down');
  console.log('All audit-roster tests passed');
})();
