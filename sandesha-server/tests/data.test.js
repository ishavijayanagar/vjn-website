'use strict';

const assert = require('assert');
const { openDb } = require('../db');
const { createListings } = require('../listings');
const { createContent } = require('../content');
const { createInquiries } = require('../inquiries');
const { createEventVolunteers } = require('../event-volunteers');
const { createMirror } = require('../mirror');
const { createVjnApi } = require('../vjn-api');
const { createVjnRoutes } = require('../vjn-routes');
const { createInbox } = require('../inbox');
const { createReminders } = require('../reminders');

const NOW = Date.parse('2026-10-28T05:00:00Z'); // 10:30 Kolkata

function setup(opts = {}) {
  const db = openDb(':memory:');
  const changes = [];
  const clock = { t: NOW };
  const now = () => clock.t;
  let ev = null;
  const onChange = (...a) => changes.push(a);
  const listings = createListings({ db, evCounts: () => (ev ? ev.counts() : {}), onChange, now });
  ev = createEventVolunteers({ db, listings, onChange, now });
  const content = createContent({ db, onChange });
  const inquiries = createInquiries({ db, onChange, now });
  let ready = opts.ready !== false;
  const api = createVjnApi({ listings, content, inquiries, ev, ready: () => ready });
  return { db, changes, clock, listings, ev, content, inquiries, api, setReady: (v) => { ready = v; } };
}

const admin = { role: 'admin', username: 'admin' };

async function run() {
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${err.stack}`);
    }
  }

  await test('listings: save, enrich dates and slots, hide closed from the public', () => {
    const t = setup();
    const a = t.listings.save('programs', '', { title: 'IE', startdate: '2026-11-02', enddate: '2026-11-05', starttime: '6:00 AM', endtime: '09:30', status: 'Open' });
    assert.strictEqual(a.id, '1');
    const item = t.listings.get('programs', '1').item;
    assert.strictEqual(item.date, '2026-11-02 – 2026-11-05');
    assert.strictEqual(item.timings, '6:00 AM – 9:30 AM');
    t.listings.save('programs', '', { title: 'Draft', status: 'Closed' });
    assert.deepStrictEqual(t.listings.list('programs').items.map((i) => i.title), ['IE']);
    assert.strictEqual(t.listings.list('programs', { includeHidden: true }).items.length, 2);
    assert.strictEqual(t.listings.get('programs', '2').item, null);
    t.listings.save('volunteering', '', { title: 'Hall setup', status: '' });
    assert.strictEqual(t.listings.list('volunteering').items.length, 1);
  });

  await test('listings: an update keeps fields it was not sent; ids are never reused', () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'A', location: 'Hall', status: 'Open' });
    t.listings.save('programs', '1', { title: 'A2' });
    assert.strictEqual(t.listings.get('programs', '1').item.location, 'Hall');
    t.listings.save('programs', '', { title: 'B', status: 'Open' });
    t.listings.remove('programs', '2');
    assert.strictEqual(t.listings.save('programs', '', { title: 'C' }).id, '3');
    assert.throws(() => t.listings.save('programs', '99', { title: 'x' }), /not found/);
  });

  await test('listings: a listing closes itself once its first slot has started, and the Sheet is told', () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'Today 9am', startdate: '2026-10-28', starttime: '09:00', status: 'Open' });
    t.listings.save('programs', '', { title: 'Today 6pm', startdate: '2026-10-28', starttime: '18:00', status: 'Open' });
    t.listings.save('volunteering', '', { title: 'Old', startdate: '2026-10-01', status: 'active' });
    t.changes.length = 0;
    assert.deepStrictEqual(t.listings.list('programs').items.map((i) => i.title), ['Today 6pm']);
    assert.strictEqual(t.listings.get('volunteering', '1', { includeHidden: true }).item.status, 'inactive');
    assert.ok(t.changes.some((c) => c[0] === 'programs' && c[1] === 'upsert' && c[2] === '1' && c[3].status === 'Closed'));
    assert.strictEqual(t.listings.clearClosed('programs').deleted, 1);
  });

  await test('listings: legacy spaced headers are understood on import', () => {
    const t = setup();
    t.listings.importRows('programs', [{ id: '7', title: 'X', 'start date': '2026-12-01', 'register link': 'http://r', status: 'Open' }]);
    const item = t.listings.get('programs', '7').item;
    assert.strictEqual(item.startdate, '2026-12-01');
    assert.strictEqual(item.registerlink, 'http://r');
    assert.strictEqual(t.listings.save('programs', '', { title: 'Y' }).id, '8');
  });

  await test('site text and program names', () => {
    const t = setup();
    assert.match(t.content.site().content.hero_quote, /tears of joy/);
    t.content.saveSite({ banner_text: 'Hi', unknown_key: 'x' });
    const c = t.content.site().content;
    assert.strictEqual(c.banner_text, 'Hi');
    assert.strictEqual(c.unknown_key, undefined);
    assert.strictEqual(c.about_label, 'About This Centre');
    assert.deepStrictEqual(t.content.addTitle('  Inner   Engineering '), ['Inner Engineering']);
    assert.throws(() => t.content.addTitle('inner engineering'), /already/);
  });

  await test('enquiries: submit, list newest first, update, add to group', () => {
    const t = setup();
    t.inquiries.submit('homeQuery', { name: 'Asha', phone: '9999999999', area: 'Vijayanagar', query: 'Timings?' });
    t.inquiries.submit('homeQuery', { name: 'Ravi', phone: '8888888888', query: 'Fees?' });
    t.inquiries.submit('programInterest', { name: 'Maya', phone: '7777777777', programName: 'IE', programId: '1' });
    const meta = t.inquiries.meta();
    assert.strictEqual(meta.total, 3);
    assert.strictEqual(meta.groups[0].openCount, 2);
    assert.strictEqual(meta.groups[0].latest.name, 'Ravi');
    assert.deepStrictEqual(t.inquiries.group('homeQueries').group.items.map((i) => i.name), ['Ravi', 'Asha']);
    const up = t.inquiries.update({ sheet: 'programInterest', id: '1', status: 'Resolved', remarks: 'called', inviteSent: true });
    assert.strictEqual(up.status, 'Resolved');
    assert.match(up.inviteSent, /^\d{4}-\d\d-\d\dT/);
    const g = t.inquiries.addedToGroup({ items: [{ sheet: 'homeQueries', id: '1' }], group: 'Vijayanagar' });
    assert.strictEqual(g.updated, 1);
    assert.strictEqual(t.inquiries.meta().groups[0].openCount, 1);
    assert.throws(() => t.inquiries.update({ sheet: 'nope', id: '1' }), /Unknown/);
  });

  await test('volunteers: add, duplicates, attendance, counts on the program', () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'IE', volunteering_available: 'yes', volunteers_needed: '2', status: 'Open', startdate: '2026-11-10' });
    assert.throws(() => t.ev.addVolunteer(admin, { eventId: '1', name: 'A', phone: '123', area: 'x' }), /valid phone/);
    t.ev.addVolunteer(admin, { eventId: '1', name: 'Asha', phone: '91 99999 99999', area: 'JP Nagar' });
    assert.throws(() => t.ev.addVolunteer(admin, { eventId: '1', name: 'Asha2', phone: '919999999999', area: 'x' }), /already/);
    const needs = t.ev.needs();
    assert.strictEqual(needs.items[0].addedCount, 1);
    assert.strictEqual(needs.counts.unmet, 1);
    assert.strictEqual(t.listings.list('programs', { includeHidden: true }).items[0].volunteers_added, 1);
    const rowId = needs.items[0].volunteers[0].rowId;
    t.ev.updateVolunteer({ rowId, attended: 'yes' });
    t.ev.markInGroup({ rowIds: [rowId] });
    const after = t.ev.needs().items[0];
    assert.strictEqual(after.allAttendanceDone, true);
    assert.strictEqual(after.volunteers[0].inGroup, true);
    t.ev.deleteVolunteer({ rowId });
    assert.strictEqual(t.ev.needs().items[0].addedCount, 0);
  });

  await test('api: roles are enforced and unknown requests are left to Apps Script', () => {
    const t = setup();
    const promo = { role: 'promotions', username: 'p' };
    assert.throws(() => t.api.admin(promo, { formType: 'adminSaveItem', resource: 'programs', item: { title: 'x' } }), /do not have access/);
    assert.throws(() => t.api.admin(promo, { formType: 'adminGet', type: 'inquiries' }), /do not have access/);
    assert.ok(t.api.admin(admin, { formType: 'adminSaveItem', resource: 'programs', item: { title: 'x', status: 'Open' } }).success);
    assert.strictEqual(t.api.admin(admin, { formType: 'adminGet', type: 'programs' }).items.length, 1);
    assert.strictEqual(t.api.admin(admin, { formType: 'adminGenerateFlyer' }), undefined);
    assert.strictEqual(t.api.admin(admin, { formType: 'adminGet', type: 'flyerTemplates' }), undefined);
    const many = t.api.admin(admin, { formType: 'adminGetMany', reads: [{ type: 'programs' }, { type: 'flyerTemplates' }, { type: 'volunteerNeeds' }] });
    assert.strictEqual(many.results.length, 3);
    assert.ok(many.results[0].items && many.results[1].error && many.results[2].items);
  });

  await test('api: who is signed in is answered even before the data has moved', () => {
    const t = setup({ ready: false });
    const out = t.api.admin({ id: 'u1', username: 'asha', displayName: 'Asha', role: 'nurturing' }, { formType: 'adminSession' });
    assert.deepStrictEqual(out, { user: { id: 'u1', username: 'asha', displayName: 'Asha', role: 'nurturing' } });
  });

  await test('api: nothing is handled until the Sheet data has been copied in', () => {
    const t = setup({ ready: false });
    assert.strictEqual(t.api.admin(admin, { formType: 'adminGet', type: 'programs' }), undefined);
    assert.strictEqual(t.api.publicGet('programs'), undefined);
    assert.strictEqual(t.api.publicSubmit({ formType: 'homeQuery', name: 'x' }), undefined);
  });

  await test('routes: public reads and visitor forms need no sign-in; admin api needs a team token', async () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'IE', status: 'Open' });
    t.listings.save('programs', '', { title: 'Hidden', status: 'Closed' });
    const users = { verify: (tok) => (tok === 'good' ? { role: 'programs', username: 'p' } : null) };
    const routes = createVjnRoutes({
      users, api: t.api,
      readBody: async (req) => req.body || '',
      jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    });
    const call = async (method, pathname, body, token, query) => {
      const res = {};
      await routes.handle({ method, body: body && JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} }, res, { pathname, query: query || {} });
      return res;
    };
    assert.deepStrictEqual((await call('GET', '/public/programs')).body.items.map((i) => i.title), ['IE']);
    assert.strictEqual((await call('GET', '/public/programs', null, null, { id: '2' })).body.item, null);
    assert.ok((await call('GET', '/public/site')).body.content);
    assert.strictEqual((await call('GET', '/public/nope')).status, 404);
    assert.ok((await call('POST', '/public/submit', { formType: 'homeQuery', name: 'A', phone: '9', query: 'q' })).body.success);
    assert.strictEqual((await call('POST', '/public/submit', { formType: 'adminSaveItem' })).status, 404);
    assert.strictEqual((await call('POST', '/vjn/api', { formType: 'adminGet', type: 'programs' })).status, 401);
    assert.strictEqual((await call('POST', '/vjn/api', { formType: 'adminGet', type: 'programs' }, 'good')).body.items.length, 2);
    assert.strictEqual((await call('POST', '/vjn/api', { formType: 'adminGet', type: 'inquiries' }, 'good')).status, 403);
    assert.strictEqual((await call('POST', '/vjn/api', { formType: 'adminGenerateFlyer' }, 'good')).status, 404);
  });

  await test('mirror: changes queue, coalesce, retry after a failure and clear when sent', async () => {
    const t = setup();
    const sent = [];
    let down = true;
    const mirror = createMirror({
      db: t.db,
      send: async (ops) => { if (down) throw new Error('Sheet unreachable'); sent.push(...ops); },
    });
    mirror.enqueue('programs', 'upsert', '1', { title: 'v1' });
    mirror.enqueue('programs', 'upsert', '1', { title: 'v2' });
    mirror.enqueue('programs', 'delete', '2', null);
    assert.strictEqual(mirror.stats().pending, 2);
    const bad = await mirror.flush();
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(mirror.stats().pending, 2);
    assert.match(mirror.stats().lastError, /unreachable/);
    down = false;
    assert.strictEqual((await mirror.flush()).sent, 2);
    assert.strictEqual(mirror.stats().pending, 0);
    assert.deepStrictEqual(sent.map((o) => [o.op, o.key, o.row.title]), [['upsert', '1', 'v2'], ['delete', '2', undefined]]);
  });

  await test('inbox: rows left in the Sheet while the Pi was down are adopted with new ids', async () => {
    const t = setup();
    t.inquiries.submit('homeQuery', { name: 'Before', phone: '1', query: 'q' });
    const calls = [];
    const inbox = createInbox({
      inquiries: t.inquiries,
      sheetCall: async (type, payload) => {
        calls.push([type, payload]);
        if (type === 'vjnInboxList') return { rows: [{ tbl: 'inquiries:homeQueries', row: 9, data: { Name: 'Late', Query: 'hello', Status: '' } }] };
        return { success: true };
      },
    });
    assert.strictEqual(await inbox.drain(), 1);
    assert.deepStrictEqual(calls[1][1].acks, [{ tbl: 'inquiries:homeQueries', row: 9, id: 2 }]);
    assert.deepStrictEqual(t.inquiries.group('homeQueries').group.items.map((i) => i.name), ['Late', 'Before']);
  });

  await test('forms: a sign-up form handed over by Apps Script is kept on the need row, and form responses are adopted', async () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'IE', volunteering_available: 'yes', volunteers_needed: '3', status: 'Open', startdate: '2026-11-10' });
    const out = t.api.admin(admin, { formType: 'adminSetVolunteerForm', needs: [{ event_id: '1', volunteer_form_id: 'F1', volunteer_form_short_url: 'https://forms.gle/x', volunteer_form_fields: 'template:ie', volunteer_form_template: 'ie-kannada' }] });
    assert.strictEqual(out.updated, 1);
    const item = t.ev.needs().items[0];
    assert.strictEqual(item.formId, 'F1');
    assert.strictEqual(item.formTemplateId, 'ie-kannada');
    assert.strictEqual(item.needed, 3);
    t.changes.length = 0;
    const calls = [];
    const inbox = createInbox({
      inquiries: t.inquiries, ev: t.ev,
      sheetCall: async (type, payload) => {
        calls.push([type, payload]);
        if (type === 'vjnInboxList') return { rows: [{ tbl: 'ev', row: 5, data: { row_id: 'r9', kind: 'volunteer', event_id: '1', volunteer_name: 'Form Person', phone: '9999999999', added_by: 'google-form' } }] };
        return { success: true };
      },
    });
    assert.strictEqual(await inbox.drain(), 1);
    assert.deepStrictEqual(calls[1][1].acks, [{ tbl: 'ev', row: 5, id: 'r9' }]);
    assert.strictEqual(t.ev.needs().items[0].volunteers[0].name, 'Form Person');
    assert.strictEqual(t.changes.length, 0, 'not copied back to the Sheet it came from');
    const off = createInbox({ inquiries: t.inquiries, ev: t.ev, enabled: () => false, sheetCall: async () => { throw new Error('should not be called'); } });
    assert.strictEqual(await off.drain(), 0);
  });

  await test('routes: Apps Script can ask the Pi to collect new rows, but only with the secret', async () => {
    const t = setup();
    let drained = 0;
    const routes = createVjnRoutes({
      users: { verify: () => null }, api: t.api, drainInbox: () => { drained++; }, secret: 'shh',
      readBody: async (req) => req.body || '',
      jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    });
    const post = async (body) => { const res = {}; await routes.handle({ method: 'POST', body: JSON.stringify(body), headers: {} }, res, { pathname: '/vjn/internal/drain' }); return res; };
    assert.strictEqual((await post({ secret: 'nope' })).status, 403);
    assert.strictEqual((await post({})).status, 403);
    assert.strictEqual((await post({ secret: 'shh' })).status, 200);
    assert.strictEqual(drained, 1);
  });

  await test('reminders: attendance once per finished program, and the 2-day heads-up once', async () => {
    const t = setup();
    t.listings.save('programs', '', { title: 'IE', volunteering_available: 'yes', volunteers_needed: '1', startdate: '2026-10-20', status: 'Open' });
    t.listings.list('programs'); // closes it
    t.ev.saveNeed(admin, { eventId: '1', handled: 'yes' });
    t.ev.addVolunteer(admin, { eventId: '1', name: 'Asha', phone: '9999999999', area: 'x' });
    t.listings.save('programs', '', { title: 'Soon', startdate: '2026-10-30', starttime: '18:00', status: 'Open' });
    const pushes = [];
    const r = createReminders({ db: t.db, ev: t.ev, listings: t.listings, notify: async (a, p) => { pushes.push([a, p.title]); }, now: () => t.clock.t });
    await r.tick();
    await r.tick();
    assert.deepStrictEqual(pushes, [['nurturing', 'Mark volunteer attendance'], ['programs', 'Program in 2 days']]);
  });

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nAll data tests passed');
}

run();
