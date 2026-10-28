'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPromoJobs } = require('../promo-jobs');

const SHEET_URL = 'https://script.google.com/macros/s/abc123/exec';

function setup({ sheetError = '', failRow = -1, failTargets = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-jobs-'));
  const rows = [];
  const cancelled = [];
  const sheetCalls = [];
  let nextId = 1;
  const delivered = [];
  let gaps = 0;
  const jobs = createPromoJobs({
    file: path.join(dir, 'promo-jobs.json'),
    MEDIA_DIR: dir,
    createSchedule: async (body) => {
      if (rows.length === failRow) throw new Error('target not found');
      const row = { id: nextId++, ...body };
      rows.push(row);
      return row;
    },
    cancelSchedule: async (id) => { cancelled.push(String(id)); },
    sendTo: async (target, payload) => {
      if (failTargets.includes(target)) throw new Error(`${target} not found`);
      delivered.push([target, payload.message, payload.filePath]);
    },
    sendGap: async () => { gaps += 1; },
    fetchImpl: async (url, opts) => {
      const payload = JSON.parse(opts.body);
      sheetCalls.push(payload);
      let data = { success: true };
      if (payload.formType === 'adminGetImage') data = { base64: Buffer.from('img').toString('base64'), mimeType: 'image/png' };
      if (payload.formType === 'adminUploadImage') data = { url: 'https://drive.google.com/new' };
      if (payload.formType === 'adminSavePromotion' && sheetError) data = { error: sheetError };
      return { text: async () => JSON.stringify(data) };
    },
  });
  return { dir, jobs, rows, cancelled, sheetCalls, delivered, gapCount: () => gaps };
}

function input(extra = {}) {
  return {
    promoId: 'p1',
    title: 'IE',
    message: 'Hello',
    runAt: '2026-10-28T10:30:00.000Z',
    rows: [{ target: 'Group A' }, { target: 'Set B', isSet: true }],
    flyer: { url: 'https://drive.google.com/file/d/x/view' },
    previousIds: [],
    sheet: { url: SHEET_URL, token: 't', fields: { message: 'Hello', send_at: '2026-10-28 16:00', target: '[]' } },
    ...extra,
  };
}

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

  await test('queues every list, then records the ids on the sheet', async () => {
    const t = setup();
    const job = t.jobs.start(input({ previousIds: ['9'] }), null);
    assert.strictEqual(job.status, 'running');
    await job.done;
    assert.strictEqual(job.status, 'done');
    assert.deepStrictEqual(job.ids, ['1', '2']);
    assert.ok(t.rows.every((r) => r.filePath && fs.existsSync(r.filePath) && r.sourceId === 'p1'));
    const save = t.sheetCalls.find((c) => c.formType === 'adminSavePromotion');
    assert.deepStrictEqual(save.wa_schedule_ids, ['1', '2']);
    assert.strictEqual(save.send_at, '2026-10-28 16:00');
    assert.deepStrictEqual(t.cancelled, ['9']);
  });

  await test('a failed sheet save cancels the rows it queued and keeps the old ones', async () => {
    const t = setup({ sheetError: 'Only 4 posts can be scheduled on one day.' });
    const job = t.jobs.start(input({ previousIds: ['9'] }), null);
    await job.done;
    assert.strictEqual(job.status, 'failed');
    assert.match(job.error, /Only 4 posts/);
    assert.deepStrictEqual(t.cancelled, ['1', '2']);
  });

  await test('a list that fails part-way leaves nothing queued', async () => {
    const t = setup({ failRow: 1 });
    const job = t.jobs.start(input(), null);
    await job.done;
    assert.strictEqual(job.status, 'failed');
    assert.deepStrictEqual(t.cancelled, ['1']);
    assert.ok(!t.sheetCalls.some((c) => c.formType === 'adminSavePromotion'));
  });

  await test('a flyer picked on the phone is uploaded to Drive and queued', async () => {
    const t = setup();
    const job = t.jobs.start(input({
      flyer: { base64: Buffer.from('png').toString('base64'), mimeType: 'image/png', filename: 'f.png' },
    }), null);
    await job.done;
    assert.strictEqual(job.status, 'done');
    const save = t.sheetCalls.find((c) => c.formType === 'adminSavePromotion');
    assert.strictEqual(save.flyer_url, 'https://drive.google.com/new');
    assert.ok(t.rows[0].filePath.endsWith('.png'));
  });

  await test('refuses a second job for the same post while one runs', async () => {
    const t = setup();
    const job = t.jobs.start(input(), null);
    assert.throws(() => t.jobs.start(input(), null), /Still saving/);
    await job.done;
  });

  await test('refuses a sheet url that is not Apps Script', async () => {
    const t = setup();
    assert.throws(() => t.jobs.start(input({ sheet: { url: 'http://evil.test', token: 't', fields: {} } }), null), /Apps Script/);
  });

  await test('a job still running at restart is reported as failed', async () => {
    const t = setup();
    const file = path.join(t.dir, 'promo-jobs.json');
    fs.writeFileSync(file, JSON.stringify([{ id: 'pj-1', promoId: 'p1', status: 'running', updatedAt: new Date().toISOString() }]));
    const again = createPromoJobs({ file, MEDIA_DIR: t.dir, createSchedule: async () => ({}), cancelSchedule: async () => {} });
    assert.strictEqual(again.list()[0].status, 'failed');
  });

  await test('dismiss removes a finished job', async () => {
    const t = setup({ sheetError: 'nope' });
    const job = t.jobs.start(input(), null);
    await job.done;
    t.jobs.dismiss(job.id);
    assert.strictEqual(t.jobs.list().length, 0);
  });

  await test('queue job: one row per list, then drops the rows it replaces', async () => {
    const t = setup();
    const job = t.jobs.start({
      kind: 'queue', title: 'Hello', message: 'Hello', runAt: '2026-10-28T10:30:00.000Z',
      rows: [{ target: 'Group A' }, { target: 'Set B', isSet: true }],
      filePath: 'upload_1.png', previousIds: ['7', '8'],
    }, { role: 'admin', name: 'A' });
    assert.strictEqual(job.status, 'running');
    assert.strictEqual(job.kind, 'queue');
    await job.done;
    assert.strictEqual(job.status, 'done');
    assert.deepStrictEqual(job.ids, ['1', '2']);
    assert.deepStrictEqual(t.rows.map((r) => [r.target, !!r.isSet, r.filePath]), [['Group A', false, 'upload_1.png'], ['Set B', true, 'upload_1.png']]);
    assert.deepStrictEqual(t.cancelled, ['7', '8']);
    assert.strictEqual(t.sheetCalls.length, 0, 'a queue job never talks to the sheet');
  });

  await test('queue job: a failing row rolls back the rows it made and keeps the old ones', async () => {
    const t = setup({ failRow: 1 });
    const job = t.jobs.start({
      kind: 'queue', message: 'Hi', runAt: '2026-10-28T10:30:00.000Z',
      rows: [{ target: 'A' }, { target: 'B' }], previousIds: ['5'],
    }, null);
    await job.done;
    assert.strictEqual(job.status, 'failed');
    assert.match(job.error, /target not found/);
    assert.deepStrictEqual(t.cancelled, ['1'], 'the first new row is taken back; the old row 5 stays queued');
  });

  await test('queue job: rejects bad input before starting', async () => {
    const t = setup();
    const base = { kind: 'queue', message: 'Hi', runAt: '2026-10-28T10:30:00.000Z', rows: [{ target: 'A' }] };
    assert.throws(() => t.jobs.start({ ...base, rows: [] }, null), /audience/);
    assert.throws(() => t.jobs.start({ ...base, runAt: 'nope' }, null), /runAt/);
    assert.throws(() => t.jobs.start({ ...base, message: '  ' }, null), /message or attach/);
    assert.strictEqual(t.jobs.list().length, 0);
  });

  await test('queue job: shows up in the job list for the page to poll', async () => {
    const t = setup();
    const job = t.jobs.start({ kind: 'queue', message: 'Hi', runAt: '2026-10-28T10:30:00.000Z', rows: [{ target: 'A' }] }, null);
    await job.done;
    assert.strictEqual(t.jobs.list()[0].id, job.id);
    assert.strictEqual(t.jobs.list()[0].status, 'done');
  });

  await test('send job: delivers to each audience in turn with a gap between, then drops what it replaces', async () => {
    const t = setup();
    const job = t.jobs.start({
      kind: 'send', title: 'Hi', message: 'Hello', filePath: 'upload_3.jpg',
      recipients: [{ target: 'A' }, { target: 'B' }, { target: 'C' }], previousIds: ['4'],
    }, null);
    assert.strictEqual(job.status, 'running');
    assert.strictEqual(job.total, 3);
    await job.done;
    assert.strictEqual(job.status, 'done');
    assert.deepStrictEqual([job.sent, job.failed], [3, 0]);
    assert.deepStrictEqual(t.delivered.map((d) => d[0]), ['A', 'B', 'C']);
    assert.strictEqual(t.delivered[0][2], 'upload_3.jpg');
    assert.strictEqual(t.gapCount(), 2, 'a gap between audiences, none after the last');
    assert.deepStrictEqual(t.cancelled, ['4']);
  });

  await test('send job: one failure is reported but the rest still go; all failing is a failed job', async () => {
    const t = setup({ failTargets: ['B'] });
    const job = t.jobs.start({ kind: 'send', message: 'Hi', recipients: [{ target: 'A' }, { target: 'B' }, { target: 'C' }], previousIds: ['9'] }, null);
    await job.done;
    assert.strictEqual(job.status, 'done');
    assert.deepStrictEqual([job.sent, job.failed], [2, 1]);
    assert.match(job.error, /1 of 3 failed: B not found/);
    assert.deepStrictEqual(t.cancelled, ['9'], 'sent something, so the replaced rows go');

    const t2 = setup({ failTargets: ['A', 'B'] });
    const job2 = t2.jobs.start({ kind: 'send', message: 'Hi', recipients: [{ target: 'A' }, { target: 'B' }], previousIds: ['9'] }, null);
    await job2.done;
    assert.strictEqual(job2.status, 'failed');
    assert.deepStrictEqual(t2.cancelled, [], 'nothing was sent, so the queued rows stay');
  });

  await test('send job: rejects bad input, and a server that cannot send says so', async () => {
    const t = setup();
    assert.throws(() => t.jobs.start({ kind: 'send', message: 'Hi', recipients: [] }, null), /audience/);
    assert.throws(() => t.jobs.start({ kind: 'send', message: ' ', recipients: [{ target: 'A' }] }, null), /message or attach/);
    const bare = createPromoJobs({ file: path.join(t.dir, 'x.json'), MEDIA_DIR: t.dir, createSchedule: async () => ({}), cancelSchedule: async () => {} });
    assert.throws(() => bare.start({ kind: 'send', message: 'Hi', recipients: [{ target: 'A' }] }, null), /cannot send from a job/);
  });

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nAll promo-jobs tests passed');
}

run();
