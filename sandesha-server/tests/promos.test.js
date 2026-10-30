'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { openDb } = require('../db');
const { createPromos } = require('../promos');
const { createVjnUsers, hashPassword } = require('../vjn-users');
const { createVjnRoutes } = require('../vjn-routes');
const { createPromoJobs } = require('../promo-jobs');

// 2026-10-28 11:00 Kolkata (05:30 UTC)
const T0 = Date.parse('2026-10-28T05:30:00Z');

const LISTINGS = {
  programs: [
    { id: '1', title: 'Inner Engineering', date: '5 Nov', location: 'Isha Place', status: 'Open', image: 'https://drive/ie' },
    { id: '2', title: 'Old Program', status: 'Closed', image: '' },
  ],
  volunteering: [{ id: '7', title: 'Seva Day', status: 'Open', image: '' }],
};

function setup(opts = {}) {
  let clock = T0;
  let listings = opts.listings === undefined ? LISTINGS : opts.listings;
  const db = openDb(':memory:');
  const promos = createPromos({
    db,
    fetchListings: async () => {
      if (listings === null) throw new Error('sheet offline');
      return listings;
    },
    now: () => clock,
  });
  return { db, promos, tick: (ms) => { clock += ms; }, setListings: (l) => { listings = l; } };
}

async function run() {
  let failed = 0;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.stack}`); }
  }

  await test('makes a post for every open listing, none for closed ones', async () => {
    const { promos } = setup();
    const { items, counts } = await promos.list();
    assert.deepStrictEqual(items.map((i) => i.event_title).sort(), ['Inner Engineering', 'Seva Day']);
    const ie = items.find((i) => i.event_id === '1');
    assert.strictEqual(ie.event_open, true);
    assert.strictEqual(ie.flyer_url, 'https://drive/ie');
    assert.strictEqual(ie.status, 'pending');
    assert.strictEqual(counts.pending, 2);
    assert.strictEqual((await promos.list()).items.length, 2, 'listing again does not add more');
  });

  await test('status follows copy, flyer and the slot, in Kolkata time', async () => {
    const t = setup();
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    let r = await t.promos.save({ id: ie.id, message: 'Join IE', send_at: '2026-10-28 16:00' });
    assert.strictEqual(r.item.status, 'ready');
    t.tick(5.5 * 3600e3); // 16:30
    assert.strictEqual((await t.promos.list()).items.find((i) => i.id === ie.id).status, 'due');
    r = await t.promos.markSent(ie.id, 'sandesha');
    assert.strictEqual(r.item.status, 'sent');
    assert.strictEqual(r.item.sent_by, 'sandesha');
    r = await t.promos.unmarkSent(ie.id);
    assert.strictEqual(r.item.status, 'due');
  });

  await test('a future slot is not sent just because an earlier mark said so', async () => {
    const t = setup();
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    await t.promos.save({ id: ie.id, message: 'Join IE', send_at: '2026-10-28 16:00' });
    let r = await t.promos.markSent(ie.id, 'sandesha');
    assert.strictEqual(r.item.status, 'ready', 'bot mark before the slot is not a delivery');
    r = await t.promos.save({
      id: ie.id, message: 'Join IE', send_at: '2026-10-28 18:00', wa_schedule_ids: 'sched-1',
    });
    assert.strictEqual(r.item.status, 'ready');
    assert.strictEqual(r.item.sent_at, '');
    t.tick(8 * 3600e3); // 19:00, past 18:00
    r = await t.promos.markSent(ie.id, 'sandesha');
    assert.strictEqual(r.item.status, 'sent');
    r = await t.promos.markSent(ie.id, 'person');
    // A hand mark stays sent even if the clock is moved back by a new future slot
    // only when nothing is queued. Re-queue drops it.
    r = await t.promos.save({ id: ie.id, send_at: '2026-10-29 01:15', wa_schedule_ids: 'sched-2' });
    assert.notStrictEqual(r.item.status, 'sent');
    assert.strictEqual(r.item.wa_schedule_ids, 'sched-2');
  });

  await test('at most 4 posts a day; the same post can move within its day', async () => {
    const t = setup();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await t.promos.add(null, { event_type: 'programs', event_id: `9${i}`, event_title: `P${i}` })).item.id);
    for (let i = 0; i < 4; i++) await t.promos.save({ id: ids[i], send_at: `2026-11-02 1${i}:00` });
    await assert.rejects(t.promos.save({ id: ids[4], send_at: '2026-11-02 18:00' }), /Only 4 posts/);
    await t.promos.save({ id: ids[0], send_at: '2026-11-02 17:00' });
    await t.promos.markSent(ids[1], 'sandesha');
    await t.promos.save({ id: ids[4], send_at: '2026-11-02 18:00' }); // a sent post frees its slot
  });

  await test('clearing the slot clears the queue ids; ids keep their order', async () => {
    const t = setup();
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    await t.promos.save({ id: ie.id, message: 'x', send_at: '2026-11-01 10:00', wa_schedule_ids: ['4', ' 5 ', ''] });
    assert.strictEqual((await t.promos.list()).items.find((i) => i.id === ie.id).wa_schedule_ids, '4,5');
    const r = await t.promos.save({ id: ie.id, send_at: '' });
    assert.strictEqual(r.item.wa_schedule_ids, '');
  });

  await test('still draws the board from its last copy when the Sheet is offline', async () => {
    const t = setup();
    await t.promos.list();
    t.setListings(null);
    t.tick(2 * 60e3);
    const items = (await t.promos.list()).items;
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items.find((i) => i.event_id === '1').event_open, true);
    assert.strictEqual(items.find((i) => i.event_id === '1').event_title, 'Inner Engineering');
  });

  await test('a listing that closes drops out of the Library', async () => {
    const t = setup();
    await t.promos.list();
    t.setListings({ programs: [{ id: '1', title: 'Inner Engineering', status: 'Closed' }], volunteering: [] });
    t.tick(2 * 60e3);
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    assert.strictEqual(ie.event_open, false);
  });

  await test('invite messages are the copy written for each program', async () => {
    const t = setup();
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    await t.promos.save({ id: ie.id, message: 'Join IE' });
    assert.deepStrictEqual(t.promos.inviteMessages(), { messages: { 1: 'Join IE' } });
  });

  await test('imports the Sheet rows once, keeping ids and slots', async () => {
    const t = setup({ listings: { programs: [], volunteering: [] } });
    const rows = [{ id: 'abc', event_type: 'programs', event_id: '1', event_title: 'IE', message: 'm', flyer_url: 'f',
      send_at: '2026-10-29 10:00', status: 'ready', wa_schedule_ids: '3', target: '[]' }];
    assert.strictEqual(t.promos.importRows(rows), 1);
    assert.strictEqual(t.promos.importRows(rows), 0);
    const [item] = (await t.promos.list()).items;
    assert.strictEqual(item.id, 'abc');
    assert.strictEqual(item.send_at, '2026-10-29 10:00');
    assert.strictEqual(item.wa_schedule_ids, '3');
  });

  await test('routes: Promotions and admin may read; Nurturing only gets invite messages', async () => {
    const t = setup();
    const users = createVjnUsers({ db: t.db, secret: 's', now: () => T0 });
    users.importUsers([
      { id: 'a', username: 'a', role: 'admin', password_salt: 'x', password_hash: hashPassword('pw', 'x'), status: 'active' },
      { id: 'n', username: 'n', role: 'nurturing', password_salt: 'x', password_hash: hashPassword('pw', 'x'), status: 'active' },
      { id: 'g', username: 'g', role: 'programs', password_salt: 'x', password_hash: hashPassword('pw', 'x'), status: 'active' },
    ]);
    const routes = createVjnRoutes({
      users, promos: t.promos,
      readBody: async (req) => req.body || '',
      jsonResponse: (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); },
    });
    const call = async (method, pathname, body, role, query) => {
      const res = { writeHead(c) { this.statusCode = c; }, end(d) { this.body = JSON.parse(d); } };
      const headers = role ? { authorization: `Bearer ${users.login(role, 'pw').token}` } : {};
      await routes.handle({ method, body: body && JSON.stringify(body), headers }, res, { pathname, query: query || {} });
      return res;
    };
    assert.strictEqual((await call('GET', '/vjn/promos', null, 'admin')).body.items.length, 2);
    assert.strictEqual((await call('GET', '/vjn/promos', null, 'nurturing')).statusCode, 403);
    assert.strictEqual((await call('GET', '/vjn/promos', null, 'programs')).statusCode, 403);
    assert.strictEqual((await call('GET', '/vjn/promos')).statusCode, 401);
    assert.strictEqual((await call('GET', '/vjn/promos/invite-messages', null, 'nurturing')).statusCode, 200);
    const ie = (await call('GET', '/vjn/promos', null, 'admin')).body.items.find((i) => i.event_id === '1');
    const saved = await call('POST', '/vjn/promos/save', { id: ie.id, message: 'hi', send_at: '2026-11-01 10:00' }, 'admin');
    assert.strictEqual(saved.body.item.status, 'ready');
    assert.strictEqual((await call('POST', '/vjn/promos/save', { id: 'nope' }, 'admin')).statusCode, 400);
    const due = await call('GET', '/vjn/promos', null, 'admin', { due: '1' });
    assert.strictEqual(due.body.items.length, 0);
  });

  await test('a background job saves into the database for a Pi login, not the Sheet', async () => {
    const t = setup();
    const ie = (await t.promos.list()).items.find((i) => i.event_id === '1');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-'));
    const sheetCalls = [];
    const jobs = createPromoJobs({
      file: path.join(dir, 'j.json'), MEDIA_DIR: dir,
      createSchedule: async (b) => ({ id: 41, ...b }),
      cancelSchedule: async () => {},
      savePromoLocal: (token, fields) => { assert.strictEqual(token, 'v1.x.y'); return t.promos.save(fields); },
      fetchImpl: async (u, o) => {
        const payload = JSON.parse(o.body); sheetCalls.push(payload.formType);
        const data = payload.formType === 'adminGetImage' ? { base64: Buffer.from('i').toString('base64'), mimeType: 'image/png' } : { success: true };
        return { text: async () => JSON.stringify(data) };
      },
    });
    const job = jobs.start({
      promoId: ie.id, title: 'IE', message: 'Join IE', runAt: new Date(Date.now() + 3600e3).toISOString(), rows: [{ target: 'Group' }],
      flyer: { url: 'https://drive/ie' }, previousIds: [],
      sheet: { url: 'https://script.google.com/macros/s/a/exec', token: 'v1.x.y', fields: { message: 'Join IE', send_at: '2026-11-01 10:00' } },
    }, null);
    await job.done;
    assert.strictEqual(job.status, 'done', job.error);
    assert.ok(!sheetCalls.includes('adminSavePromotion'), 'the Sheet was not written');
    const saved = (await t.promos.list()).items.find((i) => i.id === ie.id);
    assert.strictEqual(saved.wa_schedule_ids, '41');
    assert.strictEqual(saved.send_at, '2026-11-01 10:00');
  });

  await test('every change to a post is queued for the Sheet copy', async () => {
    const changes = [];
    const promos = createPromos({ db: openDb(':memory:'), listingTtlMs: 0, onChange: (...a) => changes.push(a), fetchListings: async () => LISTINGS, now: () => T0 });
    const { items } = await promos.list();
    assert.ok(changes.length >= items.length && changes.every((c) => c[0] === 'promos' && c[1] === 'upsert'));
    const before = changes.length;
    await promos.save({ id: items[0].id, message: 'Join us' });
    assert.strictEqual(changes.length, before + 1);
    assert.strictEqual(changes.at(-1)[3].message, 'Join us');
    assert.ok(!('event_image' in changes.at(-1)[3]), 'only the Sheet\'s own columns are copied');
  });

  await test('Apps Script stops taking promotion writes once the Pi owns them', () => {
    const props = { VJN_PROMOS_ON_PI: '1' };
    const ctx = {
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
      Date,
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script.js'), 'utf8'), ctx);
    assert.strictEqual(ctx.promosOnPi_(), true);
    assert.strictEqual(ctx.maybeCreatePromoForListing_('programs', '1', { status: 'Open' }, {}), undefined);
    assert.strictEqual(ctx.markDuePromotions(), undefined);
    assert.throws(() => ctx.promosMovedError_(), /Promotions are on Sandesha/);
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll promos tests passed');
}

run();
