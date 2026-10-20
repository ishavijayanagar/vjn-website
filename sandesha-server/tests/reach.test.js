'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-test-'));
process.env.REACH_FILE = path.join(tmp, 'reach.json');
process.env.REACH_MEDIA_DIR = path.join(tmp, 'media');
const reach = require('../reach');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

const ME = '919000000000@c.us';
const GROUP = '120363000000000001@g.us';
const GROUP2 = '120363000000000002@g.us';
let ctx = null;
let infoFor = {};

function fakeClient() {
  return {
    getChatById: async (jid) => ({
      name: jid === GROUP ? 'Vijayanagar Meditators' : 'Yoga Group',
      participants: new Array(jid === GROUP ? 101 : 51).fill(0),
    }),
    getMessageById: async (id) => ({ getInfo: async () => infoFor[id] || null }),
  };
}

function sent(chat, key, tsSec) {
  return { id: { _serialized: `true_${chat}_${key}`, id: key, remote: chat }, timestamp: tsSec };
}

function person(n, t) {
  return { id: { _serialized: `91${n}@c.us`, user: `91${n}` }, t };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  console.log('reach');
  reach._reset();
  reach.init({
    getClient: fakeClient,
    getContext: () => ctx,
    isBusy: () => false,
    ignoreChat: (jid) => jid === 'commands@g.us',
    myId: () => ME,
    log: () => {},
  });

  const t0 = Math.floor(Date.now() / 1000) - 7200; // sent two hours ago

  await test('tracks a send with its context and group size', async () => {
    ctx = { via: 'scheduled', corrId: 'sched-1', actor: { name: 'Asha', role: 'promotions' }, message: 'Hatha Yoga this Sunday' };
    reach.track(sent(GROUP, 'AAA', t0), { jid: GROUP, content: 'Hatha Yoga this Sunday!' });
    reach.track(sent(GROUP2, 'BBB', t0 + 30), { jid: GROUP2, content: 'Hatha Yoga this Sunday.' });
    ctx = null;
    await tick();
    const rec = reach._store().messages[`true_${GROUP}_AAA`];
    assert.strictEqual(rec.via, 'scheduled');
    assert.strictEqual(rec.text, 'Hatha Yoga this Sunday');
    assert.strictEqual(rec.chatName, 'Vijayanagar Meditators');
    assert.strictEqual(rec.audience, 100, 'own number excluded');
    assert.strictEqual(rec.actor.name, 'Asha');
  });

  await test('ignores the commands group and sends without an id', async () => {
    reach.track(sent('commands@g.us', 'CCC', t0), { jid: 'commands@g.us', content: 'x' });
    reach.track({}, { jid: GROUP, content: 'x' });
    assert.strictEqual(Object.keys(reach._store().messages).length, 2);
  });

  await test('message info sets delivered/read without double counting readers', async () => {
    const id = `true_${GROUP}_AAA`;
    infoFor[id] = {
      // Reader 1 shows in both lists; our own number must not count.
      delivery: [person(1, t0 + 10), person(2, t0 + 20), person(3, t0 + 30), { id: { _serialized: ME }, t: t0 }],
      read: [person(1, t0 + 60), person(4, t0 + 3700)],
      played: [],
      deliveryRemaining: 96,
      readRemaining: 98,
    };
    await reach.tick();
    const rec = reach._store().messages[id];
    assert.strictEqual(rec.delivered, 4);
    assert.strictEqual(rec.read, 2);
    assert.deepStrictEqual(rec.readCurve, { 0: 1, 1: 1 });
    assert.strictEqual(rec.firstReadAt, (t0 + 60) * 1000);
    assert.ok(rec.checksDone >= 2, 'skips checkpoints that already passed');
    assert.ok(rec.nextCheckAt > Date.now());
  });

  await test('counts quoted replies in the same group only', async () => {
    reach.onMessage({ fromMe: false, hasQuotedMsg: true, from: GROUP, body: 'Is it free?', timestamp: t0 + 100, _data: { quotedStanzaID: 'AAA' } });
    reach.onMessage({ fromMe: false, hasQuotedMsg: true, from: GROUP2, body: 'wrong group', _data: { quotedStanzaID: 'AAA' } });
    reach.onMessage({ fromMe: true, hasQuotedMsg: true, from: GROUP, body: 'mine', _data: { quotedStanzaID: 'AAA' } });
    const rec = reach._store().messages[`true_${GROUP}_AAA`];
    assert.strictEqual(rec.replies, 1);
    assert.strictEqual(rec.replySamples[0].text, 'Is it free?');
  });

  await test('reactions: changed and removed reactions count once', async () => {
    const msgId = { _serialized: `true_${GROUP}_AAA`, id: 'AAA' };
    reach.onReaction({ msgId, senderId: '911@c.us', reaction: '👍' });
    reach.onReaction({ msgId, senderId: '911@c.us', reaction: '🙏' });
    reach.onReaction({ msgId, senderId: '912@c.us', reaction: '🙏' });
    reach.onReaction({ msgId, senderId: '913@c.us', reaction: '❤️' });
    reach.onReaction({ msgId, senderId: '913@c.us', reaction: '' });
    reach.onReaction({ msgId, senderId: ME, reaction: '👍' });
    const rec = reach._store().messages[`true_${GROUP}_AAA`];
    assert.deepStrictEqual(Object.values(rec.reactions).sort(), ['🙏', '🙏']);
    assert.ok(!Object.keys(rec.reactions).some((k) => k.includes('@')), 'senders are hashed');
  });

  await test('1:1 chats take delivered/read from ticks', async () => {
    const dm = '919111111111@c.us';
    reach.track(sent(dm, 'DDD', t0), { jid: dm, content: 'Hi' });
    reach.onAck({ id: { _serialized: `true_${dm}_DDD` } }, 3);
    const rec = reach._store().messages[`true_${dm}_DDD`];
    assert.strictEqual(rec.audience, 1);
    assert.strictEqual(rec.read, 1);
    assert.strictEqual(rec.delivered, 1);
  });

  await test('summary and post detail roll groups into one post', async () => {
    const s = reach.summary(7);
    assert.strictEqual(s.totals.posts, 2, 'the scheduled fan-out is one post, the DM another');
    const { posts } = reach.listPosts({ rangeDays: 7 });
    const post = posts.find((p) => p.post.startsWith('sched-1|'));
    assert.strictEqual(post.groups, 2);
    assert.strictEqual(post.audience, 150);
    assert.strictEqual(post.read, 2);
    assert.strictEqual(post.replies, 1);
    assert.strictEqual(post.reactions, 2);
    const detail = reach.postDetail(post.post);
    assert.strictEqual(detail.groupRows[0].name, 'Vijayanagar Meditators');
    assert.strictEqual(detail.curve[0], 1);
    assert.strictEqual(detail.curve[168], 2);
    assert.strictEqual(detail.replySamples[0].group, 'Vijayanagar Meditators');
    const best = s.groups[0];
    assert.strictEqual(best.name, 'Vijayanagar Meditators');
    assert.strictEqual(best.read, 2);
  });

  await test('HTTP: promotions and admin only, GET only', async () => {
    const calls = [];
    const res = () => ({ status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } });
    const allow = (_req, _res, roles) => { calls.push(roles); return true; };
    const r = res();
    assert.strictEqual(reach.handleRequest({ method: 'GET' }, r, { pathname: '/reach/summary', query: { range: '7' } }, allow), true);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(calls[0], ['admin', 'promotions']);
    assert.strictEqual(JSON.parse(r.body).totals.posts, 2);
    assert.strictEqual(reach.handleRequest({ method: 'GET' }, res(), { pathname: '/schedules', query: {} }, allow), false);
    const r2 = res();
    reach.handleRequest({ method: 'POST' }, r2, { pathname: '/reach/summary', query: {} }, allow);
    assert.strictEqual(r2.status, 405);
  });

  console.log(`\n${passed} passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
