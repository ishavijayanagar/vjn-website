'use strict';

/** Runs the real apps-script.js against an in-memory spreadsheet. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeSpreadsheet() {
  const tabs = {};
  function sheet(name) {
    const t = { name, rows: [] };
    const api = {
      getLastRow: () => t.rows.length,
      getLastColumn: () => Math.max(1, ...t.rows.map((r) => r.length)),
      appendRow: (vals) => { t.rows.push(vals.slice()); },
      getDataRange: () => api.getRange(1, 1, t.rows.length, api.getLastColumn()),
      deleteRow: (r) => { t.rows.splice(r - 1, 1); },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const v = (t.rows[r - 1 + i] || [])[c - 1 + j];
          return v === undefined ? '' : v;
        })),
        setValues: (vals) => {
          vals.forEach((row, i) => {
            while (t.rows.length < r + i) t.rows.push([]);
            row.forEach((v, j) => { t.rows[r - 1 + i][c - 1 + j] = v; });
          });
        },
        setValue: (v) => {
          while (t.rows.length < r) t.rows.push([]);
          t.rows[r - 1][c - 1] = v;
        },
        setFontWeight() { return this; },
        setBackground() { return this; },
      }),
    };
    t.api = api;
    return t;
  }
  return {
    tabs,
    getSheetByName: (n) => (tabs[n] ? tabs[n].api : null),
    insertSheet: (n) => { tabs[n] = sheet(n); return tabs[n].api; },
  };
}

function load(props = {}, extraBooks = {}) {
  const book = fakeSpreadsheet();
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: (id) => { if (!extraBooks[id]) throw new Error('No access'); return extraBooks[id]; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ put() {}, remove() {}, get: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, fmt.includes('HH') ? 16 : 10).replace('T', fmt.includes("'T'") ? 'T' : ' '),
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
    },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script.js'), 'utf8'), ctx);
  return { ctx, book, props };
}

const SECRET = 's3cret';

async function run() {
  let failed = 0;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.stack}`); }
  }

  await test('export stamps ids, copies every table and hands the data to the Pi', () => {
    const { ctx, book, props } = load({ VJN_AUTH_SECRET: SECRET });
    const prog = book.insertSheet('Programs');
    prog.appendRow(['title', 'status', 'startdate']);
    prog.appendRow(['IE', 'Open', '2026-11-02']);
    prog.appendRow(['Yoga', 'Closed', '2026-09-01']);
    const hq = book.insertSheet('HomeQueries');
    hq.appendRow(['Timestamp', 'Name', 'WhatsApp', 'Area', 'Query', 'Status', 'Remarks', 'In Group']);
    hq.appendRow(['2026-10-01', 'Asha', '999', 'JP', 'Hi', 'Open', '', '']);
    const out = ctx.vjnExportAll_({ secret: SECRET });
    assert.deepEqual(out.programs.map((p) => [p.id, p.title]), [['1', 'IE'], ['2', 'Yoga']]);
    assert.strictEqual(out.inquiries.homeQueries[0].name, 'Asha');
    assert.strictEqual(props.VJN_DATA_ON_PI, '1');
    const idCol = book.tabs.Programs.rows[0].indexOf('id');
    assert.deepEqual(book.tabs.Programs.rows.slice(1).map((r) => r[idCol]), ['1', '2']);
    assert.throws(() => ctx.vjnExportAll_({ secret: 'wrong' }), /Unauthorized/);
  });

  await test('mirror: upsert by id, update in place, delete, and keep a Sheet the public pages can still read', () => {
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET });
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'programs', op: 'upsert', key: '4', row: { id: '4', title: 'IE', status: 'Open', startdate: '2099-01-01' } },
      { tbl: 'programs', op: 'upsert', key: '9', row: { id: '9', title: 'Yoga', status: 'Open', startdate: '2099-02-01' } },
    ] });
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'programs', op: 'upsert', key: '4', row: { title: 'IE Updated' } },
      { tbl: 'programs', op: 'delete', key: '9' },
      { tbl: 'site', op: 'upsert', key: 'banner_text', row: { key: 'banner_text', value: 'Hello' } },
      { tbl: 'programTitles', op: 'upsert', key: 'IE', row: { title: 'IE', active: 'yes' } },
    ] });
    const rows = book.tabs.Programs.rows;
    assert.strictEqual(rows.length, 2);
    const h = rows[0];
    assert.strictEqual(rows[1][h.indexOf('title')], 'IE Updated');
    assert.strictEqual(rows[1][h.indexOf('status')], 'Open');
    // Pi is down: the public read comes from the copy, by id, not by position.
    const all = ctx.getAllItems('Programs', false);
    assert.deepEqual(all.items.map((i) => [i.id, i.title]), [['4', 'IE Updated']]);
    assert.strictEqual(ctx.getSingleItem('Programs', '4', false).item.title, 'IE Updated');
    assert.strictEqual(ctx.getSingleItem('Programs', '1', false).item, null);
    assert.strictEqual(ctx.getSiteContent().content.banner_text, 'Hello');
  });

  await test('mirror: enquiries and volunteers land in their own tabs; wrong secret refused', () => {
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET });
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'inquiries:homeQueries', op: 'upsert', key: '1', row: { timestamp: 't', name: 'Asha', query: 'Hi', status: 'Open', remarks: '' } },
      { tbl: 'ev', op: 'upsert', key: 'r1', row: { row_id: 'r1', kind: 'volunteer', event_id: '4', volunteer_name: 'Ravi' } },
    ] });
    const hq = book.tabs.HomeQueries.rows;
    assert.strictEqual(hq[1][hq[0].map((x) => x.toLowerCase()).indexOf('name')], 'Asha');
    const ev = book.tabs.EventVolunteers.rows;
    assert.strictEqual(ev[1][ev[0].indexOf('volunteer_name')], 'Ravi');
    assert.strictEqual(ev[1][ev[0].indexOf('pi_synced')], '1');
    assert.throws(() => ctx.vjnMirror_({ secret: 'no', ops: [] }), /Unauthorized/);
  });

  await test('check-ins: each month gets its own tab, rows are keyed by id', () => {
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET });
    const row = (id, month, name) => ({ id, month, timestamp: month + '-05T10:00:00', 'program name': 'IE', name, phone: '+919999999999', area: 'JP', 'ie completion': 'May-2024' });
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'checkins', op: 'upsert', key: '1', row: row('1', '2026-10', 'Asha') },
      { tbl: 'checkins', op: 'upsert', key: '2', row: row('2', '2026-11', 'Ravi') },
      { tbl: 'checkins', op: 'upsert', key: '3', row: row('3', '2026-10', 'Meena') },
    ] });
    const oct = book.tabs['Checkins 2026-10'].rows;
    assert.strictEqual(oct.length, 3);
    assert.deepEqual(oct[0].slice(0, 8), ['Timestamp', 'Program Date', 'Program ID', 'Program Name', 'Name', 'Phone', 'Area', 'IE Completion']);
    assert.strictEqual(oct[1][oct[0].indexOf('Name')], 'Asha');
    assert.strictEqual(book.tabs['Checkins 2026-11'].rows.length, 2);
    assert.ok(!oct[0].includes('Consent'));
  });

  await test('check-ins: go to the linked separate sheet, not this spreadsheet', () => {
    const other = fakeSpreadsheet();
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET }, { SHEET123: other });
    ctx.setCheckinSheet('https://docs.google.com/spreadsheets/d/SHEET123/edit');
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'checkins', op: 'upsert', key: '1', row: { id: '1', month: '2026-10', name: 'Asha' } },
    ] });
    assert.strictEqual(other.tabs['Checkins 2026-10'].rows.length, 2);
    assert.ok(!book.tabs['Checkins 2026-10']);
    assert.throws(() => ctx.setCheckinSheet('nope'), /No access/);
  });

  await test('inbox: only rows with no id are handed over, and an ack stops them coming back', () => {
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET });
    ctx.vjnMirror_({ secret: SECRET, ops: [{ tbl: 'inquiries:homeQueries', op: 'upsert', key: '1', row: { name: 'Synced', status: 'Open' } }] });
    ctx.saveHomeQuery({ name: 'While down', phone: '1', query: 'q' }); // a visitor's form, Pi unreachable
    const list = ctx.vjnInboxList_({ secret: SECRET }).rows;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].data.name, 'While down');
    ctx.vjnInboxAck_({ secret: SECRET, acks: [{ tbl: list[0].tbl, row: list[0].row, id: 7 }] });
    assert.strictEqual(ctx.vjnInboxList_({ secret: SECRET }).rows.length, 0);
    const hq = book.tabs.HomeQueries.rows;
    assert.strictEqual(hq[list[0].row - 1][hq[0].map((x) => x.toLowerCase()).indexOf('id')], '7');
  });

  await test('forms: new sign-up rows go to the Pi, a made form is handed to the page, nothing writes the copy directly', () => {
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET, VJN_DATA_ON_PI: '1' });
    // The Pi's mirror put a volunteer there; a form response then appends another without pi_synced.
    ctx.vjnMirror_({ secret: SECRET, ops: [{ tbl: 'ev', op: 'upsert', key: 'r1', row: { row_id: 'r1', kind: 'volunteer', event_id: '4', volunteer_name: 'Ravi' } }] });
    const loaded = ctx.loadEventVolunteers_();
    ctx.evAppendRow_(loaded, { row_id: 'r2', kind: 'volunteer', event_id: '4', volunteer_name: 'Form Person', phone: '9999999999', added_by: 'google-form' });
    const inbox = ctx.vjnInboxList_({ secret: SECRET }).rows;
    assert.deepEqual(inbox.map((r) => [r.tbl, r.data.row_id]), [['ev', 'r2']]);
    assert.ok(!('pi_synced' in inbox[0].data));
    ctx.vjnInboxAck_({ secret: SECRET, acks: [{ tbl: 'ev', row: inbox[0].row, id: 'r2' }] });
    assert.strictEqual(ctx.vjnInboxList_({ secret: SECRET }).rows.length, 0);
    const relay = ctx.needRelay_({ event_id: 4, event_title: 'IE', needed: '3', volunteer_form_id: 'F1', volunteer_form_fields: 'multi-program' });
    assert.strictEqual(relay.event_id, '4');
    assert.strictEqual(relay.volunteer_form_id, 'F1');
    // The reminders now live on the Pi: the Apps Script triggers do nothing.
    assert.strictEqual(ctx.remindAttendance(), undefined);
    assert.strictEqual(ctx.remindUpcomingPrograms(), undefined);
  });

  await test('admin edits are refused in the Sheet once the Pi owns the data', () => {
    const { ctx } = load({ VJN_AUTH_SECRET: SECRET, VJN_DATA_ON_PI: '1' });
    assert.throws(() => ctx.dataMovedError_(), /Sandesha is offline/);
    for (const fn of ['adminSaveItem', 'adminDeleteItem', 'adminClearClosed', 'adminSaveSite', 'adminUpdateInquiry', 'adminAddProgramTitle', 'adminSaveVolunteerNeed', 'adminAddEventVolunteer', 'adminUpdateEventVolunteer', 'adminDeleteEventVolunteer', 'adminMarkVolunteersInGroup', 'adminInquiriesAddedToGroup']) {
      assert.ok(new RegExp(`function ${fn}\\(data\\) \\{[\\s\\S]*?if \\(dataOnPi_\\(\\)\\) dataMovedError_\\(\\);`).test(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script.js'), 'utf8')), fn);
    }
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll Apps Script mirror tests passed');
}

run();
