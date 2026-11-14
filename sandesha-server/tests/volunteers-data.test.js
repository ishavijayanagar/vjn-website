'use strict';

const assert = require('assert');
const { openDb } = require('../db');
const { createVolunteersData, cleanFilters, cleanCallers, splitAmong, phoneKey, istStamp } = require('../volunteers-data');

(async () => {
  assert.strictEqual(phoneKey('+91 98450 12345'), '9845012345');
  assert.strictEqual(phoneKey('098450 12345'), '9845012345');
  assert.strictEqual(phoneKey('12345'), '');
  assert.strictEqual(istStamp('2026-06-10T07:00:00'), '2026-06-10 07:00');
  assert.strictEqual(istStamp('2026-11-13T16:20:00.000Z'), '2026-11-13 21:50');
  // callers: names are cleaned; people are handed out in even blocks, the first callers taking any extra
  assert.deepStrictEqual(cleanCallers(['  Asha ', '', 'asha', 'Ravi', 5, null]), ['Asha', 'Ravi', '5']);
  assert.deepStrictEqual(cleanCallers('x'), []);
  assert.strictEqual(cleanCallers(Array.from({ length: 40 }, (_, i) => 'c' + i)).length, 20);
  assert.deepStrictEqual(splitAmong(5, ['A']).per, ['A', 'A', 'A', 'A', 'A']);
  assert.deepStrictEqual(splitAmong(7, ['A', 'B']).counts, [{ caller: 'A', count: 4 }, { caller: 'B', count: 3 }]);
  assert.deepStrictEqual(splitAmong(7, ['A', 'B']).per, ['A', 'A', 'A', 'A', 'B', 'B', 'B']);
  assert.deepStrictEqual(splitAmong(8, ['A', 'B', 'C']).counts.map((c) => c.count), [3, 3, 2]);
  assert.deepStrictEqual(splitAmong(2, ['A', 'B', 'C']).counts.map((c) => c.count), [1, 1, 0]); // more callers than people
  assert.deepStrictEqual(splitAmong(6, ['A', 'B', 'C']).counts.map((c) => c.count), [2, 2, 2]);
  // unknown filter values never get through
  const clean = cleanFilters({ stages: ['checked_in', 'hacker'], ie: 'weird', programs: ['1', 2], unique: 1, program_from: 'x', min_checkins: 500 });
  assert.deepStrictEqual([clean.stages, clean.ie, clean.programs, clean.unique, clean.program_from, clean.min_checkins], [['checked_in'], 'any', ['1', '2'], true, '', 99]);

  const db = openDb(':memory:');
  const listings = { list: () => ({ items: [
    { id: 1, title: 'Inner Engineering', startdate: '2026-06-10', status: 'Closed' },
    { id: 2, title: 'Hatha Yoga', startdate: '2026-09-01', status: 'Closed' },
  ] }) };
  const ev = db.prepare("INSERT INTO event_vols (row_id, kind, event_id, data) VALUES (?, 'volunteer', ?, ?)");
  ev.run('a', '1', JSON.stringify({ volunteer_name: 'Asha', phone: '919845012345', area_of_stay: 'JP Nagar', ie_completion: 'May-2024', source: 'google-form', in_wa_group: 'yes', attended: 'yes', checked_in_at: '2026-06-10T07:00:00', updated_at: '2026-06-01T10:00:00' }));
  ev.run('b', '1', JSON.stringify({ volunteer_name: 'Ravi', phone: '919888888888', area_of_stay: 'BTM', source: 'admin', updated_at: '2026-06-02T10:00:00' }));
  ev.run('c', '2', JSON.stringify({ volunteer_name: 'Asha', phone: '919845012345', area_of_stay: 'JP Nagar', ie_completion: 'May-2024', source: 'google-form', updated_at: '2026-08-20T10:00:00' }));
  ev.run('d', '2', JSON.stringify({ volunteer_name: 'Meena', phone: '919777777777', source: 'walk-in', checked_in_at: '2026-09-01T07:10:00', updated_at: '2026-09-01T07:10:00' }));
  const iv = db.prepare('INSERT INTO vol_interests (timestamp, name, whatsapp, area, ie_completion, source, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  iv.run('2026-10-05T10:00:00', 'Kiran', '+919666666666', 'BTM', 'Mar-2022', 'manual', 'asha');
  iv.run('2026-10-06T10:00:00', 'Asha', '+919845012345', 'JP Nagar', 'May-2024', 'paste', 'asha');
  db.prepare("UPDATE vol_interests SET vol_type = 'Online Volunteering', availability = 'Weekends', profession = 'Teacher / Educator', skill = 'Cooking', volunteer_remarks = 'free on Sundays' WHERE name = 'Asha'").run();
  const wi = db.prepare('INSERT INTO website_inquiries (sheet, id, status, data) VALUES (?, ?, ?, ?)');
  wi.run('volunteeringInterest', 1, 'Open', JSON.stringify({ name: 'Zed', whatsapp: '+919555555555', 'opportunity name': 'Hall setup', timestamp: '2026-10-07T10:00:00.000Z' }));
  wi.run('programVolunteer', 1, 'Open', JSON.stringify({ name: 'Asha', whatsapp: '+919845012345', 'program id': '1', 'program name': 'IE', 'ie completion': 'May-2024', 'in group': 'Fri 2026-06-12', timestamp: '2026-05-20T10:00:00.000Z' }));
  wi.run('homeQueries', 1, 'Open', JSON.stringify({ name: 'Not a volunteer', whatsapp: '+919444444444' })); // other enquiries are not volunteer records

  const vd = createVolunteersData({ db, listings, now: () => Date.UTC(2026, 10, 14, 4, 0, 0) });
  const names = (r) => r.rows.map((x) => x.name).sort().join(',');

  // everything: 4 on program lists + 2 interests + 2 website forms
  let r = vd.query({});
  assert.strictEqual(r.total, 8);
  assert.strictEqual(r.people, 5); // Asha appears four times; people are counted by phone number
  assert.deepStrictEqual(r.by_stage, { interest: 4, volunteered: 2, checked_in: 2 });

  // by program: the volunteers of Inner Engineering (its list and the website form for it)
  r = vd.query({ programs: ['1'] });
  assert.strictEqual(names(r), 'Asha,Asha,Ravi');
  assert.strictEqual(vd.query({ programs: [''] }).rows.length, 3); // general interest: no program
  assert.strictEqual(vd.query({ programs: ['1', '2'], stages: ['checked_in'] }).rows.length, 2);

  // by stage
  assert.strictEqual(names(vd.query({ stages: ['checked_in'] })), 'Asha,Meena');
  assert.strictEqual(names(vd.query({ stages: ['volunteered'] })), 'Asha,Ravi');
  assert.strictEqual(vd.query({ stages: ['interest'] }).rows.length, 4);

  // program date: "a few months ago"
  assert.strictEqual(names(vd.query({ program_from: '2026-08-01' })), 'Asha,Meena');
  assert.strictEqual(names(vd.query({ program_from: '2026-06-01', program_to: '2026-06-30' })), 'Asha,Asha,Ravi');
  assert.strictEqual(vd.query({ added_from: '2026-10-01', added_to: '2026-10-31' }).rows.length, 3); // Kiran, Asha, Zed

  // other filters
  assert.strictEqual(names(vd.query({ ie: 'none' })), 'Meena,Ravi,Zed');
  assert.strictEqual(vd.query({ ie: 'has' }).rows.length, 5);
  assert.strictEqual(names(vd.query({ ie_from: 2024, ie_to: 2024 })), 'Asha,Asha,Asha,Asha');
  assert.strictEqual(vd.query({ area: 'btm' }).rows.length, 2); // Ravi, Kiran
  assert.strictEqual(vd.query({ in_group: 'yes' }).rows.length, 2); // Asha on the list, Asha's program-page form
  assert.strictEqual(vd.query({ attended: 'yes' }).rows.length, 1);
  assert.strictEqual(names(vd.query({ attended: 'unmarked' })), 'Asha,Meena,Ravi'); // on a list, attendance not marked yet
  assert.strictEqual(vd.query({ search: '98450' }).rows.length, 4);
  assert.strictEqual(names(vd.query({ search: 'ravi' })), 'Ravi');
  assert.deepStrictEqual(vd.query({ sources: ['walk-in'] }).rows.map((x) => x.name), ['Meena']);
  assert.strictEqual(vd.query({ sources: ['website-program', 'website-volunteering'] }).rows.length, 2);

  // one row per person: their furthest stage, with how many programs and check-ins they have
  r = vd.query({ unique: true });
  assert.strictEqual(r.total, 5);
  const asha = r.rows.find((x) => x.name === 'Asha');
  assert.deepStrictEqual([asha.stage, asha.programs_count, asha.check_ins, asha.records], ['checked_in', 2, 1, 4]);
  assert.strictEqual(names(vd.query({ unique: true, min_checkins: 1 })), 'Asha,Meena');
  assert.strictEqual(names(vd.query({ unique: true, programs: ['2'] })), 'Asha,Meena');

  assert.deepStrictEqual(vd.query({ programs: [''], search: 'asha' }).rows.map((x) => [x.vol_type, x.availability, x.profession, x.skill]), [['Online Volunteering', 'Weekends', 'Teacher / Educator', 'Cooking']]);
  // what the controls offer
  const o = vd.options();
  assert.deepStrictEqual(o.programs.map((p) => p.id), ['2', '1']); // newest first
  assert.strictEqual(o.programs[1].records, 3);
  assert.strictEqual(o.general.records, 3);
  assert.ok(o.sources.some((s) => s.key === 'walk-in') && !o.sources.some((s) => s.key === 'image'));
  assert.deepStrictEqual(o.ie_years, { min: 2022, max: 2024 });
  assert.ok(o.areas.includes('JP Nagar'));
  console.log('  ✓ volunteers data: records, filters, one row per person, options');

  // campaigns: name, phone and IE completion date, then (after the caller column) what the volunteering quiz asks
  const calls = [];
  const sheetCall = async (type, payload) => { calls.push([type, payload]); return { id: 'S1', url: 'https://docs.google.com/spreadsheets/d/S1' }; };
  const vd2 = createVolunteersData({ db, listings, sheetCall, now: () => Date.UTC(2026, 10, 14, 4, 0, 0) });
  const session = { username: 'asha' };
  await assert.rejects(() => vd2.createCampaign(session, { name: '  ', filters: {} }), /name/);
  await assert.rejects(() => vd2.createCampaign(session, { name: 'x', filters: { search: 'nobody-here' } }), /No one/);
  const out = await vd2.createCampaign(session, { name: 'Thank-you call', filters: { programs: ['1', '2'], stages: ['checked_in'] } });
  assert.strictEqual(calls[0][0], 'vjnCreateSheet');
  assert.deepStrictEqual(calls[0][1].headers, ['Name', 'Phone Number', 'IE Completion Date', 'Area of Stay', 'Vol Type', 'Availability', 'Profession', 'Skills', 'Remarks', 'Call Status', 'Call Notes']);
  // Asha's check-in knows her IE date and area; her profession and the rest come from her interest entry
  assert.deepStrictEqual(calls[0][1].rows.map((x) => x.join('|')).sort(), [
    'Asha|+919845012345|May-2024|JP Nagar|Online Volunteering|Weekends|Teacher / Educator|Cooking|free on Sundays||',
    'Meena|+919777777777|||||||||',
  ].map((s) => s.trim()));
  assert.ok(calls[0][1].rows.every((x) => x.length === 11));
  // the quiz columns are dropdowns in the sheet
  assert.deepStrictEqual(calls[0][1].dropdowns, { 'Vol Type': ['In-Person Volunteering', 'Online Volunteering', 'Both'], Availability: ['Weekdays', 'Weekends', 'Both'], Profession: ['Student', 'IT / Tech / Design', 'Teacher / Educator', 'Business / Management', 'Homemaker', 'Retired', 'Other'], 'Call Status': ['Reached', 'Not reachable', 'Call back', 'Not interested'] });
  assert.deepStrictEqual(calls[0][1].editable, ['Area of Stay', 'Vol Type', 'Availability', 'Profession', 'Skills', 'Remarks', 'Call Status', 'Call Notes']);
  assert.ok(/Thank-you call/.test(calls[0][1].title));
  assert.deepStrictEqual([out.campaign.people, out.campaign.sheet_url, out.campaign.kind], [2, 'https://docs.google.com/spreadsheets/d/S1', 'campaign']);
  // with callers: a fourth column names who calls each person; no callers, no column
  assert.strictEqual(out.campaign.kind, 'campaign');
  assert.deepStrictEqual(out.assignments, []);
  calls.length = 0;
  const withCallers = await vd2.createCampaign(session, { name: 'Calls', filters: {}, callers: ['Asha', 'Ravi'] });
  assert.deepStrictEqual(calls[0][1].headers, ['Name', 'Phone Number', 'IE Completion Date', 'Caller Name', 'Area of Stay', 'Vol Type', 'Availability', 'Profession', 'Skills', 'Remarks', 'Call Status', 'Call Notes']);
  assert.deepStrictEqual(calls[0][1].rows.map((x) => x[3]), ['Asha', 'Asha', 'Asha', 'Ravi', 'Ravi']); // 5 people: 3 and 2
  assert.deepStrictEqual(calls[0][1].dropdowns['Caller Name'], ['Asha', 'Ravi']); // and callers can be switched with a click
  assert.deepStrictEqual(withCallers.assignments, [{ caller: 'Asha', count: 3 }, { caller: 'Ravi', count: 2 }]);
  assert.deepStrictEqual(vd2.campaigns().items[0].filters.callers, ['Asha', 'Ravi']);
  calls.length = 0;
  await vd2.createCampaign(session, { name: 'Solo', filters: {}, callers: ['Meena'] });
  assert.ok(calls[0][1].rows.every((x) => x[3] === 'Meena')); // one caller gets everyone
  // each person once, even when the filters match them several times
  calls.length = 0;
  await vd2.createCampaign(session, { name: 'Everyone', filters: {} });
  assert.strictEqual(calls[0][1].rows.length, 5);
  const saved = vd2.campaigns().items;
  assert.deepStrictEqual([saved[0].name, saved[0].people, saved[0].created_by, saved.find((x) => x.name === 'Thank-you call').filters.stages], ['Everyone', 5, 'asha', ['checked_in']]);

  // closing a campaign: callers' entries are saved on the people's Interests entries and the sheet is locked
  {
    const { createVolInterests } = require('../vol-interests');
    const mirrored = [];
    const vi = createVolInterests({ db, onChange: (...a) => mirrored.push(a), now: () => Date.UTC(2026, 10, 14, 4, 0, 0) });
    const log = [];
    let sheetRows = null;
    const sc = async (type, payload) => {
      log.push(type);
      if (type === 'vjnCreateSheet') { sheetRows = { headers: payload.headers, rows: payload.rows.map((r) => r.slice()) }; return { id: 'C1', url: 'https://docs.google.com/spreadsheets/d/C1' }; }
      if (type === 'vjnReadSheet') return sheetRows;
      return { success: true };
    };
    const vd4 = createVolunteersData({ db, listings, sheetCall: sc, volInterests: vi, now: () => Date.UTC(2026, 10, 14, 4, 0, 0) });
    const made2 = await vd4.createCampaign(session, { name: 'Close me', filters: { programs: ['1', '2'], stages: ['checked_in'] }, callers: ['Asha'] });
    const h = sheetRows.headers; const at = (n) => h.indexOf(n);
    const asha = sheetRows.rows.find((r) => r[0] === 'Asha');
    const meena = sheetRows.rows.find((r) => r[0] === 'Meena');
    asha[at('Profession')] = 'Retired';
    asha[at('Call Status')] = 'reached';
    asha[at('Call Notes')] = 'Will help in Jan';
    meena[at('Area of Stay')] = 'Koramangala';
    meena[at('Call Status')] = 'Call back';
    const closed = await vd4.closeCampaign(session, { id: made2.campaign.id });
    assert.deepStrictEqual(closed.result, { rows: 2, updated: 2, new_people: 1, call_notes: 1, unmatched: 0, locked: true });
    assert.deepStrictEqual(log.slice(-2), ['vjnReadSheet', 'vjnLockSheet']);
    const ashaRow = db.prepare("SELECT * FROM vol_interests WHERE whatsapp = '+919845012345'").get();
    assert.strictEqual(ashaRow.profession, 'Retired');
    assert.strictEqual(ashaRow.skill, 'Cooking');
    const hist = JSON.parse(ashaRow.calling_remarks);
    assert.deepStrictEqual([hist[0].status, hist[0].note, hist[0].by, hist[0].campaign, hist[0].changes], ['Reached', 'Will help in Jan', 'Asha', 'Close me', { profession: 'Retired' }]);
    const meenaRow = db.prepare("SELECT * FROM vol_interests WHERE whatsapp = '+919777777777'").get();
    assert.deepStrictEqual([meenaRow.source, meenaRow.area, JSON.parse(meenaRow.calling_remarks)[0].status], ['campaign', 'Koramangala', 'Call back']);
    assert.ok(mirrored.some((m) => m[0] === 'volInterests' && m[1] === 'upsert'));
    const row = vd4.campaigns().items.find((x) => x.id === made2.campaign.id);
    assert.deepStrictEqual([row.status, row.closed_by, row.result.updated], ['closed', 'asha', 2]);
    await assert.rejects(() => vd4.closeCampaign(session, { id: made2.campaign.id }), /already closed/);
    await assert.rejects(() => vd4.closeCampaign(session, { id: 9999 }), /not found/);
    const quiet = await vd4.createCampaign(session, { name: 'Quiet', filters: { programs: ['1'], stages: ['checked_in'] } });
    assert.strictEqual((await vd4.closeCampaign(session, { id: quiet.campaign.id })).result.updated, 0);
    console.log('  ✓ volunteers data: closing a campaign saves callers\' entries');
  }

  // the full table as a sheet
  calls.length = 0;
  const ex = await vd2.exportSheet(session, { filters: { programs: ['1'] } });
  assert.strictEqual(calls[0][1].headers.length, 12);
  assert.strictEqual(calls[0][1].rows.length, 3);
  assert.strictEqual(ex.sheet.kind, 'export');
  // a sheet that cannot be made leaves no record and a clear message
  const before = vd2.campaigns().items.length;
  const vd3 = createVolunteersData({ db, listings, sheetCall: async () => { throw new Error('Unauthorized.'); } });
  await assert.rejects(() => vd3.createCampaign(session, { name: 'x', filters: {} }), /could not be made/);
  assert.strictEqual(vd2.campaigns().items.length, before);
  await assert.rejects(() => createVolunteersData({ db, listings }).exportSheet(session, { filters: {} }), /not connected/);
  // the API: only admin and nurturing; a campaign is audited
  const { createVjnApi } = require('../vjn-api');
  const audited = [];
  const api = createVjnApi({ listings: {}, content: {}, inquiries: {}, ev: {}, volunteersData: vd2, audit: (se, a) => audited.push(a) });
  const nurturing = { id: 'u1', username: 'asha', role: 'nurturing' };
  const programs = { id: 'u2', username: 'p', role: 'programs' };
  assert.throws(() => api.admin(programs, { formType: 'adminGet', type: 'volunteerData', filters: {} }), /access/);
  assert.throws(() => api.admin(programs, { formType: 'adminGet', type: 'volunteerFilters' }), /access/);
  assert.strictEqual(api.admin(nurturing, { formType: 'adminGet', type: 'volunteerData', filters: { stages: ['checked_in'] } }).total, 2);
  assert.ok(api.admin(nurturing, { formType: 'adminGet', type: 'volunteerFilters' }).programs.length === 2);
  assert.ok(api.admin(nurturing, { formType: 'adminGet', type: 'volunteerSheets' }).items.length >= 2);
  assert.throws(() => api.admin(programs, { formType: 'adminVolunteerCampaign', name: 'x' }), /access/);
  const made = await api.admin(nurturing, { formType: 'adminVolunteerCampaign', name: 'Via the API', filters: { stages: ['checked_in'] } });
  assert.strictEqual(made.campaign.people, 2);
  assert.deepStrictEqual(audited, ['adminVolunteerCampaign']);
  console.log('  ✓ volunteers data: campaigns and exports');
})().catch((e) => { console.error(e); process.exit(1); });
