'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-'));
process.env.REACH_FILE = path.join(dir, 'r.json');
process.env.REACH_MEDIA_DIR = path.join(dir, 'm');
const reach = require('../reach');

let infoCalls = 0;
const info = { delivery: [{ id: { _serialized: 'a@c.us' }, t: 100 }, { id: { _serialized: 'b@c.us' }, t: 100 }], read: [{ id: { _serialized: 'a@c.us' }, t: 100 }], played: [], deliveryRemaining: 8, readRemaining: 9 };
const client = { getMessageById: async () => ({ getInfo: async () => { infoCalls += 1; return info; } }) };
reach.init({ getClient: () => client, isBusy: () => false, myId: () => 'me@c.us' });

const MIN = 60000;
const mk = (id, sentAt, extra = {}) => ({
  id, key: id, chat: 'g@g.us', chatName: 'G', isGroup: true, audience: 0, kind: 'text', text: 't', sentAt, via: 'api', post: `p${id}`,
  checksDone: 0, nextCheckAt: sentAt + 10 * MIN, earlyCheckAt: sentAt + 2 * MIN, status: 'measuring', ack: 0,
  delivered: 0, read: 0, played: 0, replies: 0, replySamples: [], reactions: {}, readCurve: {}, ...extra,
});

(async () => {
  // 1. the 2-minute look refreshes the counts but does not use up a regular check, and plans the 5-minute look
  const t0 = Date.now() - 3 * MIN;
  reach._reset({ version: 1, messages: { m1: mk('m1', t0) } });
  await reach.tick();
  const r = reach._store().messages.m1;
  assert.strictEqual(infoCalls, 1);
  assert.strictEqual(r.delivered, 2);
  assert.strictEqual(r.read, 1);
  assert.strictEqual(r.checksDone, 0, 'a regular check is not used up');
  assert.strictEqual(r.nextCheckAt, t0 + 10 * MIN, 'the regular schedule is untouched');
  assert.strictEqual(r.earlyCheckAt, t0 + 5 * MIN, 'the 5-minute look is planned');
  await reach.tick();
  assert.strictEqual(infoCalls, 1, 'nothing is due yet, so no extra call');
  console.log('  ✓ early look: counts appear at 2 minutes without using a regular check');

  // 2. after the 5-minute look nothing more is planned
  r.earlyCheckAt = Date.now() - 1000;
  await reach.tick();
  assert.strictEqual(infoCalls, 2);
  assert.strictEqual(r.earlyCheckAt, null);
  console.log('  ✓ early look: stops after the 5-minute look');

  // 3. an ack event asks for a look soon, but only once per 5 minutes and only in the first hour
  const t1 = Date.now() - 30000;
  reach._reset({ version: 1, messages: { m2: mk('m2', t1, { earlyCheckAt: null, earlySecondDone: true }) } });
  reach.onAck({ id: { _serialized: 'm2' } }, 2);
  const m2 = reach._store().messages.m2;
  assert.ok(m2.earlyCheckAt > Date.now() && m2.earlyCheckAt <= Date.now() + 16000, 'a look is planned a few seconds out');
  m2.earlyCheckAt = null; m2.lastEarlyAt = Date.now() - MIN; m2.ack = 0;
  reach.onAck({ id: { _serialized: 'm2' } }, 2);
  assert.strictEqual(m2.earlyCheckAt, null, 'not again within 5 minutes of the last look');
  const old = mk('m3', Date.now() - 2 * 60 * MIN, { earlyCheckAt: null, nextCheckAt: Date.now() + 5 * 60 * MIN });
  reach._reset({ version: 1, messages: { m3: old } });
  reach.onAck({ id: { _serialized: 'm3' } }, 2);
  assert.strictEqual(reach._store().messages.m3.earlyCheckAt, null, 'not after the first hour');
  console.log('  ✓ early look: an ack event triggers one, at most every 5 minutes and only in the first hour');

  // 4. the regular check still runs and clears any pending early look
  const t4 = Date.now() - 11 * MIN;
  reach._reset({ version: 1, messages: { m4: mk('m4', t4) } });
  await reach.tick();
  const m4 = reach._store().messages.m4;
  assert.strictEqual(m4.checksDone, 1);
  assert.strictEqual(m4.earlyCheckAt, null);
  console.log('  ✓ early look: the 10-minute check still runs on schedule');
  console.log('All reach-early tests passed');
})();
