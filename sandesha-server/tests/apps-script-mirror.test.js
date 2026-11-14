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
      getMaxRows: () => Math.max(1000, t.rows.length),
      setName: (n) => { t.renamed = n; },
      setFrozenRows: (n) => { t.frozen = n; },
      autoResizeColumns() {},
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const v = (t.rows[r - 1 + i] || [])[c - 1 + j];
          return v === undefined ? '' : v;
        })),
        setValues(vals) {
          vals.forEach((row, i) => {
            while (t.rows.length < r + i) t.rows.push([]);
            row.forEach((v, j) => { t.rows[r - 1 + i][c - 1 + j] = v; });
          });
          return this; // like the real Range, so calls can be chained
        },
        setValue: (v) => {
          while (t.rows.length < r) t.rows.push([]);
          t.rows[r - 1][c - 1] = v;
        },
        setNumberFormat(f) { (t.formats = t.formats || {})[c] = f; return this; },
        setDataValidation(rule) { (t.validations = t.validations || {})[c] = { rule, rows: nr }; return this; },
        setFontWeight() { return this; },
        setBackground() { return this; },
      }),
      hideColumns: (c) => { (t.hidden = t.hidden || []).push(c); },
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
    SpreadsheetApp: { newDataValidation: () => { const rule = { list: null, invalid: null }; const b = { requireValueInList(l) { rule.list = l; return b; }, setAllowInvalid(v) { rule.invalid = v; return b; }, build: () => rule }; return b; }, create: (title) => { const b = fakeSpreadsheet(); b.title = title; b.id = 'NEW1'; b.getId = () => 'NEW1'; b.getUrl = () => 'https://docs.google.com/spreadsheets/d/NEW1'; b.getSheets = () => [b.insertSheet('Sheet1')]; ctx.created = b; return b; }, getActiveSpreadsheet: () => book, openById: (id) => { if (!extraBooks[id]) throw new Error('No access'); return extraBooks[id]; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ put() {}, remove() {}, get: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, fmt.includes('HH') ? 16 : 10).replace('T', fmt.includes("'T'") ? 'T' : ' '),
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
    },
    Logger: { log() {} },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'LINK' }, Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
      getFileById: (id) => ({ id, setSharing(a, p) { ctx.shared = [id, a, p]; } }),
      getRootFolder: () => ({ removeFile() {} }),
      createFolder: (n) => ({ getId: () => 'FOLDER1', addFile(f) { ctx.filed = [n, f.id]; } }),
      getFolderById: () => ({ addFile(f) { ctx.filed = ['existing', f.id]; } }),
    },
    UrlFetchApp: { fetch: (...a) => (ctx.fetchImpl ? ctx.fetchImpl(...a) : { getResponseCode: () => 500, getContentText: () => '' }) },
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
    const oct = book.tabs['Oct 2026'].rows;
    assert.strictEqual(oct.length, 3);
    assert.deepEqual(oct[0], ['Timestamp', 'Program Date', 'Program Name', 'Name', 'Phone', 'Area', 'IE Completion', 'id']);
    assert.deepEqual(book.tabs['Oct 2026'].hidden, [8]);
    assert.strictEqual(oct[1][oct[0].indexOf('Name')], 'Asha');
    assert.strictEqual(book.tabs['Nov 2026'].rows.length, 2);
    assert.ok(!oct[0].includes('Consent'));
  });

  await test('check-ins: go to the linked separate sheet, not this spreadsheet', () => {
    const other = fakeSpreadsheet();
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET }, { SHEET123: other });
    ctx.setCheckinSheet('https://docs.google.com/spreadsheets/d/SHEET123/edit');
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'checkins', op: 'upsert', key: '1', row: { id: '1', month: '2026-10', name: 'Asha' } },
    ] });
    assert.strictEqual(other.tabs['Oct 2026'].rows.length, 2);
    assert.ok(!book.tabs['Oct 2026']);
    assert.throws(() => ctx.setCheckinSheet('nope'), /No access/);
  });

  await test('volunteer interests: monthly tabs in their own sheet with only the six columns, none in this spreadsheet', () => {
    const other = fakeSpreadsheet();
    const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET }, { INT123: other });
    ctx.setInterestSheet('https://docs.google.com/spreadsheets/d/INT123/edit');
    ctx.vjnMirror_({ secret: SECRET, ops: [
      { tbl: 'volInterests', op: 'upsert', key: 'i1', row: { month: '2026-10', name: 'Ravi', 'whatsapp number': '+919888888888', 'ie completion date': 'May 2024', source: 'Added manually', 'volunteer remarks': 'weekends', 'calling remarks': '2026-10-05 10:00 asha: called', area: 'JP' } },
      { tbl: 'volInterests', op: 'upsert', key: 'i2', row: { month: '2026-10', name: 'Meena', source: 'Pasted list' } },
    ] });
    const oct = other.tabs['Oct 2026'].rows;
    assert.deepEqual(oct[0], ['Name', 'WhatsApp Number', 'IE Completion Date', 'Source', 'Volunteer Remarks', 'Calling Remarks', 'id']);
    assert.deepEqual(oct.slice(1).map((r) => r[6]), ['i1', 'i2']);
    assert.deepEqual(oct[1].slice(0, 6), ['Ravi', '+919888888888', 'May 2024', 'Added manually', 'weekends', '2026-10-05 10:00 asha: called']); // the area was not copied
    assert.ok(other.tabs['Oct 2026'].formats, 'number and date columns are kept as text');
    assert.ok(!book.tabs['Oct 2026']);
    // the website forms are no longer routed to this sheet: their tabs are acknowledged in this spreadsheet like before
    assert.strictEqual(ctx.vjnTable_('inquiries:programVolunteer').sheet, 'ProgramVolunteer');
    assert.strictEqual(ctx.vjnTable_('inquiries:volunteeringInterest').sheet, 'VolunteeringInterest');
  });

  await test('google form response: goes straight to the Pi; only what the Pi cannot take is parked in the tab', () => {
    const answer = (title, v) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => v });
    const submit = (ctx, name, phone) => ctx.onVolunteerFormSubmit({
      source: { getId: () => 'F1' },
      response: { getItemResponses: () => [answer('Name', name), answer('WhatsApp number', phone), answer('Area of stay', 'JP')] },
    });
    const setupForm = (props) => {
      const { ctx, book } = load({ VJN_AUTH_SECRET: SECRET, SANDESHA_API_URL: 'http://pi', ...props });
      ctx.vjnMirror_({ secret: SECRET, ops: [{ tbl: 'ev', op: 'upsert', key: 'n1', row: { row_id: 'n1', kind: 'need', event_id: '4', event_title: 'IE', volunteer_form_id: 'F1', volunteer_form_fields: 'area_of_stay' } }] });
      return { ctx, tab: () => book.tabs.EventVolunteers.rows };
    };
    // the Pi takes it: nothing is written to the tab
    let { ctx, tab } = setupForm({ VJN_DATA_ON_PI: '1' });
    const calls = [];
    ctx.fetchImpl = (url, opts) => { calls.push([url, JSON.parse(opts.payload)]); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: ['added'] }) }; };
    submit(ctx, 'Asha', '+91 99999 99999');
    assert.strictEqual(calls[0][0], 'http://pi/vjn/internal/form-responses');
    assert.strictEqual(calls[0][1].secret, SECRET);
    assert.deepStrictEqual([calls[0][1].rows[0].volunteer_name, calls[0][1].rows[0].phone, calls[0][1].rows[0].event_id], ['Asha', '919999999999', '4']);
    assert.strictEqual(tab().length, 2); // header + the need row only
    // a repeat the Pi already has is dropped, not parked
    ctx.fetchImpl = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: ['duplicate'] }) });
    submit(ctx, 'Asha', '+91 99999 99999');
    assert.strictEqual(tab().length, 2);
    // the Pi is down: the response is kept in the tab for the Pi to collect later
    ({ ctx, tab } = setupForm({ VJN_DATA_ON_PI: '1' }));
    ctx.fetchImpl = () => { throw new Error('unreachable'); };
    submit(ctx, 'Ravi', '+91 98888 88888');
    assert.strictEqual(tab().length, 3);
    const hdr = tab()[0];
    assert.strictEqual(tab()[2][hdr.indexOf('volunteer_name')], 'Ravi');
    // before the data has moved to the Pi the tab is still the record
    ({ ctx, tab } = setupForm({}));
    ctx.fetchImpl = () => { throw new Error('should not be called'); };
    submit(ctx, 'Meena', '+91 97777 77777');
    assert.strictEqual(tab().length, 3);
  });

  await test('campaign sheet: made for the Pi with only the columns and rows it sends, dropdowns, filed in a folder, editable by link', () => {
    const { ctx } = load({ VJN_AUTH_SECRET: SECRET });
    assert.throws(() => ctx.vjnCreateSheet_({ secret: 'nope', headers: ['Name'], rows: [] }), /Unauthorized/);
    assert.throws(() => ctx.vjnCreateSheet_({ secret: SECRET, headers: [], rows: [] }), /No columns/);
    const out = ctx.vjnCreateSheet_({ secret: SECRET, title: 'Campaign: Thank-you call', headers: ['Name', 'Phone Number', 'IE Completion Date', 'Profession', 'Caller Name'],
      rows: [['Asha', '+919845012345', 'May-2024', 'Student', 'Ravi'], ['Meena', '+919777777777', '', '', 'Ravi']],
      dropdowns: { Profession: ['Student', 'Retired'], 'Caller Name': ['Ravi', 'Asha'], Nope: ['x'], 'IE Completion Date': [] } });
    assert.deepEqual([out.id, out.url], ['NEW1', 'https://docs.google.com/spreadsheets/d/NEW1']);
    assert.strictEqual(ctx.created.title, 'Campaign: Thank-you call');
    const rows = ctx.created.tabs.Sheet1.rows;
    assert.deepEqual(rows[0], ['Name', 'Phone Number', 'IE Completion Date', 'Profession', 'Caller Name']);
    assert.deepEqual(rows[1], ['Asha', '+919845012345', 'May-2024', 'Student', 'Ravi']); // text, so the + and the date are kept
    // dropdowns on the columns that have choices (and only those), on every data row; other values are still allowed
    const v = ctx.created.tabs.Sheet1.validations;
    assert.deepEqual(Object.keys(v), ['4', '5']);
    assert.deepEqual([v[4].rule.list, v[4].rule.invalid, v[4].rows], [['Student', 'Retired'], true, 2]);
    assert.deepEqual(v[5].rule.list, ['Ravi', 'Asha']);
    assert.strictEqual(rows.length, 3);
    assert.ok(ctx.created.tabs.Sheet1.formats, 'cells are plain text');
    assert.deepEqual(ctx.filed, ['Volunteer campaigns', 'NEW1']);
    assert.deepEqual(ctx.shared, ['NEW1', 'LINK', 'EDIT']); // callers can write in it
    // the folder is made once and reused
    ctx.vjnCreateSheet_({ secret: SECRET, headers: ['Name'], rows: [] });
    assert.strictEqual(ctx.filed[0], 'existing');
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
  });

  await test('the Sheet no longer has the old admin actions; the Google-only ones are still there', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script.js'), 'utf8');
    for (const t of ['adminLogin', 'adminLogout', 'adminSaveItem', 'adminSaveUser', 'adminSavePromotion', 'adminAddEventVolunteer', 'adminUpdateInquiry', 'adminSaveSite']) {
      assert.ok(!src.includes(`formType === "${t}"`), `${t} should be gone`);
    }
    for (const t of ['adminGenerateFlyer', 'adminCreateProgramVolunteerForm', 'adminConnectProgramVolunteerForm', 'adminListVolunteerForms', 'adminGetImage', 'vjnMirror', 'vjnInboxList']) {
      assert.ok(src.includes(`formType === "${t}"`), `${t} should stay`);
    }
    const { ctx } = load({ VJN_AUTH_SECRET: SECRET });
    for (const fn of ['adminLogin', 'adminSaveItem', 'listPromotions_', 'getVolunteerNeeds_']) assert.strictEqual(typeof ctx[fn], 'undefined', fn);
    for (const fn of ['adminGenerateFlyer', 'adminCreateProgramVolunteerForm', 'requireRole_', 'getVolunteerRoster_']) assert.strictEqual(typeof ctx[fn], 'function', fn);
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll Apps Script mirror tests passed');
}

run();
