'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookup-'));
process.env.REACH_FILE = path.join(dir, 'r.json');
process.env.REACH_MEDIA_DIR = path.join(dir, 'm');
const reach = require('../reach');

const MIN = 60000;
const calls = [];
// A browser page stand-in: records what was asked and answers like WhatsApp Web's message info.
const pupPage = {
  evaluate: async (fn, id, shortId) => {
    calls.push([id, shortId]);
    return {
      delivery: [{ id: '111@lid', t: 1 }],
      read: [{ id: '222@lid', t: Math.floor((Date.now() - 50 * MIN) / 1000) }, { id: '333@lid', t: Math.floor((Date.now() - 5 * MIN) / 1000) }],
      played: [], deliveryRemaining: 0, readRemaining: 1,
    };
  },
};
reach.init({ getClient: () => ({ pupPage }), isBusy: () => false, myId: () => null });

const sentAt = Date.now() - 60 * MIN;
const id = 'true_120363425636948021@g.us_3EB0DE85D16DC97D2EB2F1';
const rec = {
  id, key: '3EB0DE85D16DC97D2EB2F1', chat: '120363425636948021@g.us', chatName: 'Spocs', isGroup: true, audience: 32, kind: 'text', text: 't',
  sentAt, via: 'scheduled', post: 'p1', checksDone: 1, nextCheckAt: Date.now() - 1000, status: 'measuring', ack: 1,
  delivered: 0, read: 0, played: 0, replies: 0, replySamples: [], reactions: {}, readCurve: {}, infoMissing: 3,
};

(async () => {
  reach._reset({ version: 1, messages: { [id]: rec } });
  await reach.tick();
  const r = reach._store().messages[id];
  assert.deepStrictEqual(calls[0], [id, '3EB0DE85D16DC97D2EB2F1'], 'the browser is asked with the id and its short id');
  assert.strictEqual(r.delivered, 3);
  assert.strictEqual(r.read, 2);
  assert.strictEqual(r.infoMissing, 0, 'numbers arriving clear the "no numbers" mark');
  assert.ok(Object.keys(r.readCurve).length >= 1);
  console.log('  ✓ lookup: message info is read through the browser and fills the counts');

  // Delivery events now carry the four-part id (…_<id>_<me>@lid); they still find the post.
  r.ack = 1;
  reach.onAck({ id: { fromMe: true, remote: '120363425636948021@g.us', id: '3EB0DE85D16DC97D2EB2F1', _serialized: `${id}_99707800023198@lid` } }, 2);
  assert.strictEqual(reach._store().messages[id].ack, 2);
  console.log('  ✓ lookup: a delivery event with the four-part id finds the post');

  // keyOf takes only the short id, also from a four-part id string (replies that quote our post).
  reach.onAck({ id: `${id}_99707800023198@lid` }, 3);
  assert.strictEqual(reach._store().messages[id].ack, 3);
  console.log('  ✓ lookup: a four-part id string resolves to the same post');
  console.log('All reach-lookup tests passed');
})();
