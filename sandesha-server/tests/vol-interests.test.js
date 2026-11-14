'use strict';

const assert = require('assert');
const { openDb } = require('../db');
const { createVolInterests, parseText, normalizePhone, normalizeVolType, normalizeAvailability, normalizeProfession } = require('../vol-interests');
const { createVisionExtractor, parseReply } = require('../vision-extract');
const { createVjnApi } = require('../vjn-api');

(async () => {
  assert.strictEqual(normalizePhone('098450 12345'), '+919845012345');
  assert.strictEqual(normalizePhone('+91 98450-12345'), '+919845012345');
  assert.strictEqual(normalizePhone('12345'), '');

  // header row, quoted comma, tab-separated, and a lone "name number" line
  assert.deepStrictEqual(parseText('Name,Phone,Area\n"Rao, K",9845012345,Cooking').map((r) => [r.name, r.whatsapp, r.area]), [['Rao, K', '9845012345', 'Cooking']]);
  assert.strictEqual(parseText('Meena\t9876543210\tJP\tMay-2024\tHall\tweekends')[0].volunteer_remarks, 'weekends');
  assert.deepStrictEqual(parseText('Ravi 9845012345').map((r) => [r.name, r.whatsapp]), [['Ravi', '9845012345']]);

  // the dropdown fields: values are matched to the lists, and anything else is kept as written
  assert.deepStrictEqual(['in person', 'Online', 'remote', 'Both', 'online and in person', 'hybrid', ''].map(normalizeVolType), ['In-Person Volunteering', 'Online Volunteering', 'Online Volunteering', 'Both', 'Both', 'Both', '']);
  assert.deepStrictEqual(['weekdays', 'Weekends', 'weekdays and weekends', 'both', 'Sat, Sun', 'evenings'].map(normalizeAvailability), ['Weekdays', 'Weekends', 'Both', 'Both', 'Weekends', 'evenings']);
  assert.deepStrictEqual(['student', 'Software engineer', 'teacher', 'Business owner', 'housewife', 'retired', 'Other', 'farmer'].map(normalizeProfession),
    ['Student', 'IT / Tech / Design', 'Teacher / Educator', 'Business / Management', 'Homemaker', 'Retired', 'Other', 'farmer']);
  const wide = parseText('Name,Phone,Area of stay,Volunteering type,Availability,Profession,Skill,Remarks\nAsha,9845012345,JP,online,weekends,teacher,Cooking,Sundays')[0];
  assert.deepStrictEqual([wide.vol_type, wide.availability, wide.profession, wide.skill, wide.volunteer_remarks], ['online', 'weekends', 'teacher', 'Cooking', 'Sundays']);

  const db = openDb(':memory:');
  const mirrored = [];
  const vi = createVolInterests({ db, onChange: (...a) => mirrored.push(a), now: () => Date.UTC(2026, 10, 14, 4, 0, 0) });
  const admin = { id: 'u1', username: 'asha', role: 'nurturing' };

  const pv = vi.preview({ text: 'Name,Phone,Area\nAsha,9845012345,JP\n,9845012346,BTM\nRavi,123,BTM\nAsha,98450 12345,JP' }).rows;
  assert.deepStrictEqual(pv.map((r) => [r.blocked, r.duplicate]), [[false, false], [true, false], [true, false], [false, true]]);
  assert.ok(pv[1].issues.includes('Name is missing') && pv[2].issues.some((i) => /Phone/.test(i)) && pv[3].issues.includes('Repeated in this upload'));
  assert.throws(() => vi.preview({ text: '   ' }), /Nothing to read/);

  // only good rows are saved; a repeat is skipped unless the person allows it
  let out = vi.add(admin, { rows: pv, source: 'paste' });
  assert.strictEqual(out.added, 1);
  assert.strictEqual(out.skipped.length, 3);
  out = vi.add(admin, { rows: [{ name: 'Asha', whatsapp: '9845012345' }] });
  assert.strictEqual(out.added, 0);
  assert.match(out.skipped[0].reason, /Already/);
  out = vi.add(admin, { rows: [{ name: 'Asha', whatsapp: '9845012345' }], allowDuplicates: true, source: 'image' });
  assert.strictEqual(out.added, 1);
  const rows = vi.list().items;
  assert.strictEqual(vi.list().total, 2);
  assert.deepStrictEqual([rows[0].whatsapp, rows[0].status, rows[0].source, rows[0].added_by, rows[0].timestamp], ['+919845012345', 'Open', 'image', 'asha', '2026-11-14T09:30:00']);
  // what goes to the Sheet: six things and the month, keyed i<id>; nothing else
  assert.deepStrictEqual(mirrored.slice(0, 1).map((m) => [m[0], m[1], m[2]]), [['volInterests', 'upsert', 'i1']]);
  assert.deepStrictEqual(mirrored[0][3], { month: '2026-11', name: 'Asha', 'whatsapp number': '+919845012345', 'ie completion date': '', source: 'Pasted list', 'volunteer remarks': '', 'calling remarks': '' });
  assert.ok(vi.republish() >= 1);
  // the quiz fields are cleaned by check() and saved
  const quiz = vi.check([{ name: 'Q', whatsapp: '9845011111', vol_type: 'in person', availability: 'weekdays and weekends', profession: 'software engineer', skill: ' Cooking  ' }])[0];
  assert.deepStrictEqual([quiz.vol_type, quiz.availability, quiz.profession, quiz.skill, quiz.blocked], ['In-Person Volunteering', 'Both', 'IT / Tech / Design', 'Cooking', false]);
  vi.add(admin, { rows: [quiz], source: 'manual' });
  const saved = vi.list().items[0];
  assert.deepStrictEqual([saved.vol_type, saved.availability, saved.profession, saved.skill], ['In-Person Volunteering', 'Both', 'IT / Tech / Design', 'Cooking']);
  const cols = db.prepare('pragma table_info(vol_interests)').all().map((c) => c.name);
  assert.ok(!cols.includes('opportunity_name') && !cols.includes('opportunity_id'));
  assert.ok(cols.includes('calling_remarks'));
  assert.deepStrictEqual(vi.list().items[0].calling_remarks, []); // a JSON list, empty until calls are logged
  assert.strictEqual(parseText('Meena\t9876543210\tJP\tMay-2024\tHall\tweekends')[0]._skip, 'Hall'); // the old 5th column is read and not kept
  console.log('  ✓ vol interests: parse, preview flags, add only good rows');

  // photo reading: a model reply wrapped in prose is accepted; a busy first model falls to the next
  assert.strictEqual(parseReply('Here you go:\n```json\n[{"name":"A"}]\n```').length, 1);
  assert.throws(() => parseReply('sorry, no'), /list/);
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.model);
    assert.deepStrictEqual(body.provider, { data_collection: 'deny' }); // never a provider that keeps or trains on prompts
    if (body.model === 'busy') return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '[{"name":"Meena","whatsapp":"9876543210","opportunity_name":"Hall"}]' } }] }) };
  };
  const extract = createVisionExtractor({ apiKey: 'k', models: 'busy, good', fetchImpl });
  const viImg = createVolInterests({ db, extractImage: extract });
  // off by default; an admin switches it on
  await assert.rejects(() => viImg.previewImage({ base64: 'AAAA', mimeType: 'image/png' }), /switched off/);
  assert.deepStrictEqual(viImg.config(), { aiConfigured: true, aiEnabled: false });
  viImg.setAi(true);
  assert.deepStrictEqual(vi.config(), { aiConfigured: false, aiEnabled: true }); // same db, no key set up
  const img = await viImg.previewImage({ base64: 'AAAA', mimeType: 'image/png' });
  assert.deepStrictEqual(calls, ['busy', 'good']);
  assert.strictEqual(img.rows[0].name, 'Meena');
  await assert.rejects(() => viImg.previewImage({ base64: 'AAAA', mimeType: 'application/pdf' }), /PNG, JPG/);
  assert.strictEqual(createVisionExtractor({ apiKey: '', models: 'x' }), null);
  await assert.rejects(() => vi.previewImage({ base64: 'AAAA', mimeType: 'image/png' }), /not set up/);
  assert.deepStrictEqual(parseText('Asha   9845012345   JP Nagar   May-2024   Hall').map((r) => [r.name, r.whatsapp, r.area, r.volunteer_remarks]), [['Asha', '9845012345', 'JP Nagar', undefined]]);
  console.log('  ✓ vol interests: image reading (fallback model, bad type, not configured)');

  // api: only admin and nurturing; add is audited
  const audited = [];
  const api = createVjnApi({ listings: {}, content: {}, inquiries: {}, ev: {}, volInterests: vi, audit: (s, a) => audited.push(a) });
  const programs = { id: 'u2', username: 'p', role: 'programs' };
  assert.throws(() => api.admin(programs, { formType: 'adminVolInterestPreview', text: 'a' }), /access/);
  assert.throws(() => api.admin(programs, { formType: 'adminVolInterestsAdd', rows: [] }), /access/);
  assert.throws(() => api.admin(admin, { formType: 'adminVolInterestsAiSet', enabled: true }), /access/); // nurturing cannot
  const boss = { id: 'u3', username: 'boss', role: 'admin' };
  assert.strictEqual(api.admin(boss, { formType: 'adminVolInterestsAiSet', enabled: false }).aiEnabled, false);
  assert.strictEqual(api.admin(admin, { formType: 'adminGet', type: 'volInterestsConfig' }).aiEnabled, false);
  assert.strictEqual(api.admin(admin, { formType: 'adminVolInterestPreview', text: 'Zed 9845099999' }).rows.length, 1);
  assert.strictEqual(api.admin(admin, { formType: 'adminVolInterestsAdd', rows: [{ name: 'Zed', whatsapp: '9845099999' }] }).added, 1);
  assert.deepStrictEqual(audited, ['adminVolInterestsAiSet', 'adminVolInterestsAdd']);
  assert.strictEqual(api.admin(admin, { formType: 'adminGet', type: 'volInterests' }).total, 4);
  console.log('  ✓ vol interests: roles, audit and list');
})().catch((e) => { console.error(e); process.exit(1); });
