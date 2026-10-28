'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPromoJobs } = require('../promo-jobs');

const SHEET_URL = 'https://script.google.com/macros/s/abc123/exec';

function setup({ sheetError = '', failRow = -1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-jobs-'));
  const rows = [];
  const cancelled = [];
  const sheetCalls = [];
  let nextId = 1;
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
  return { dir, jobs, rows, cancelled, sheetCalls };
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

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nAll promo-jobs tests passed');
}

run();
