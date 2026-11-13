'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-'));
process.env.REACH_FILE = path.join(dir, 'r.json');
process.env.REACH_MEDIA_DIR = path.join(dir, 'm');
const reach = require('../reach');
reach.init({});

const HOUR = 3600e3;
const IST = 330 * 60 * 1000;
// a send at the given IST hour, `daysAgo` days back (same wall-clock hour)
const at = (istHour, daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 24 * HOUR + IST);
  d.setUTCHours(istHour, 15, 0, 0);
  return d.getTime() - IST;
};
const rec = (id, sentAt, audience, read, extra = {}) => ({
  id, key: id, chat: 'g1@g.us', chatName: 'G1', isGroup: true, audience, kind: 'text', text: 't', sentAt, via: 'api',
  post: `p${id}`, status: 'final', delivered: audience, read, replies: 0, replySamples: [], reactions: {}, readCurve: {}, ...extra,
});

const messages = {};
let n = 0;
const add = (hour, daysAgo, audience, read, extra) => { n += 1; messages[`m${n}`] = rec(`m${n}`, at(hour, daysAgo), audience, read, extra); };
for (let i = 0; i < 3; i++) add(7, 3 + i, 100, 60);    // 6-9 am: 60% read
for (let i = 0; i < 3; i++) add(20, 3 + i, 100, 20);   // 6-9 pm: 20% read
add(13, 4, 100, 90);                                    // 12-3 pm: only one send — must not be ranked
add(7, 0.2, 100, 5);                                    // too recent to count
add(7, 5, 100, 5, { isGroup: false });                  // not a group
add(7, 6, 0, 0);                                        // no audience known
reach._reset({ version: 1, messages });

const b = reach.summary(90).bestTimes;
assert.strictEqual(b.sends, 7, 'only settled group sends with a known audience are counted');
assert.strictEqual(b.bestTime, '6 am–9 am');
const noon = b.times.find((t) => t.label === '12 pm–3 pm');
assert.strictEqual(noon.sends, 1);
assert.strictEqual(noon.enough, false);
assert.ok(b.times.find((t) => t.label === '6 am–9 am').readRate > b.times.find((t) => t.label === '6 pm–9 pm').readRate);
assert.strictEqual(b.times.length, 8);
assert.strictEqual(b.days.length, 7);
console.log('  ✓ best time: only settled group sends count, thin slots are not ranked, the best slot is named');

reach._reset({ version: 1, messages: {} });
const empty = reach.summary(30).bestTimes;
assert.strictEqual(empty.bestTime, '');
assert.strictEqual(empty.bestDay, '');
console.log('  ✓ best time: no data means no ranking');
console.log('All reach-besttime tests passed');
