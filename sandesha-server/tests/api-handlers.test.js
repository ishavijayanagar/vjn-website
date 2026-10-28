'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep test events and sessions out of the live files (set before they load).
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-test-'));
process.env.SANDESHA_ACTIVITY_FILE = path.join(testDir, 'activity.jsonl');
process.env.SANDESHA_SESSIONS_FILE = path.join(testDir, 'sessions.json');

const { createApiHandlers } = require('../api-handlers');

function makeDeps(overrides = {}) {
  const schedules = [];
  const contacts = { contacts: { alice: '919876543210' } };
  const sets = { family: ['111@g.us', '222@g.us'] };
  const jobs = new Map();

  return {
    client: {
      getChats: async () => [
        { isGroup: true, name: 'Test Group', id: { _serialized: '111@g.us' }, participants: [{ id: { _serialized: '1@c.us', user: '1' } }] },
        { isGroup: false, name: 'DM', id: { _serialized: '999@c.us' } },
      ],
      getChatById: async (jid) => ({
        name: 'Test Group',
        id: { _serialized: jid },
        participants: [{ id: { _serialized: '1@c.us', user: '111' }, name: 'Bob' }],
        fetchParticipants: async () => {},
      }),
    },
    loadSchedules: () => schedules,
    saveSchedules: (s) => { schedules.length = 0; schedules.push(...s); },
    loadContacts: () => contacts,
    saveContacts: (c) => { contacts.contacts = c.contacts; },
    loadSets: () => sets,
    parseScheduleTime: (str) => {
      if (str === '9am') {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
        return d;
      }
      return null;
    },
    validateScheduleTarget: async () => {},
    resolveAndSend: async () => {},
    formatTimeAgo: () => '1 day ago',
    getGroupParticipantCount: () => 5,
    isAnnouncementGroup: () => false,
    getGroupTypeLabel: () => 'group',
    normalizePhoneDigits: (n) => n.replace(/\D/g, ''),
    delay: async () => {},
    forwardToZeroClaw: async (msg) => `echo: ${msg}`,
    MEDIA_DIR: '/tmp',
    log: () => {},
    resolveGroupByName: async () => null,
    resolveParticipantWids: async (nums) => ({
      wids: nums.map((n) => `${n}@c.us`),
      failed: [],
      entries: nums.map((n) => ({ digits: n, wid: `${n}@c.us` })),
    }),
    pushSvc: makeFakePush(),
    ...overrides,
  };
}

function makeFakePush() {
  const subs = [];
  return {
    subs,
    getPublicKey: () => 'FAKE_VAPID_PUBLIC_KEY',
    getInternalToken: () => 'FAKE_INTERNAL_TOKEN',
    addSub: (sub, meta = {}) => {
      const row = { endpoint: sub.endpoint, keys: sub.keys || {}, role: meta.role || 'unknown', userId: meta.userId || '' };
      const i = subs.findIndex((s) => s.endpoint === sub.endpoint);
      if (i >= 0) subs[i] = row; else subs.push(row);
      return row;
    },
    removeSub: (endpoint) => {
      const i = subs.findIndex((s) => s.endpoint === endpoint);
      if (i >= 0) { subs.splice(i, 1); return true; }
      return false;
    },
    countForUser: (uid) => subs.filter((s) => s.userId === uid).length,
    loadSubs: () => subs.slice(),
    notify: async (_audience, _payload, filter) => {
      const targets = filter ? subs.filter(filter) : subs;
      return { sent: targets.length, pruned: 0 };
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(data) { this.body = data; },
  };
  return res;
}

function mockReq(method, body = '') {
  return { method, headers: { 'content-type': 'application/json' }, on: () => {} , ...{} };
}

async function readBodyHandler(req, body) {
  return {
    method: req.method,
    headers: req.headers,
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(body); },
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  await test('GET /schedules returns list', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const ok = await h.handleRequest(
      { method: 'GET' },
      res,
      { pathname: '/schedules' },
      () => true
    );
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.schedules));
  });

  await test('POST /schedules creates schedule with timeStr', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const req = { method: 'POST' };
    const origRead = require('../api-handlers');
    // use inline body via patching readBody path - call handler with JSON parse path
    const body = JSON.stringify({ message: 'hi', target: 'family', timeStr: '9am' });
    const req2 = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    const ok = await h.handleRequest(req2, res, { pathname: '/schedules' }, () => true);
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(data.schedule);
    assert.strictEqual(data.schedule.message, 'hi');
  });

  await test('POST /promo-jobs queues the post and GET reports it done', async () => {
    const sheetCalls = [];
    const deps = makeDeps({
      MEDIA_DIR: testDir,
      PROMO_JOBS_FILE: path.join(testDir, 'promo-jobs.json'),
      promoFetch: async (_url, opts) => {
        const payload = JSON.parse(opts.body);
        sheetCalls.push(payload);
        const data = payload.formType === 'adminGetImage'
          ? { base64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg' }
          : { success: true };
        return { text: async () => JSON.stringify(data) };
      },
    });
    const h = createApiHandlers(deps);
    const body = JSON.stringify({
      promoId: 'p1',
      message: 'hi',
      runAt: new Date(Date.now() + 3600e3).toISOString(),
      rows: [{ target: 'family', isSet: true }],
      flyer: { url: 'https://drive.google.com/file/d/x/view' },
      sheet: { url: 'https://script.google.com/macros/s/abc/exec', token: 't', fields: { send_at: '2026-10-28 16:00' } },
    });
    const req = { method: 'POST', on(evt, fn) { if (evt === 'data') fn(body); if (evt === 'end') fn(); } };
    const res = mockRes();
    await h.handleRequest(req, res, { pathname: '/promo-jobs' }, () => true);
    assert.strictEqual(res.statusCode, 202);
    const { job } = JSON.parse(res.body);
    assert.ok(!('token' in job));
    await new Promise((r) => setTimeout(r, 50));
    const res2 = mockRes();
    await h.handleRequest({ method: 'GET' }, res2, { pathname: '/promo-jobs' }, () => true);
    const listed = JSON.parse(res2.body).jobs.find((j) => j.id === job.id);
    assert.strictEqual(listed.status, 'done', listed.error);
    assert.strictEqual(listed.ids.length, 1);
    assert.deepStrictEqual(sheetCalls.at(-1).wa_schedule_ids, listed.ids);
    const res3 = mockRes();
    await h.handleRequest({ method: 'DELETE' }, res3, { pathname: `/promo-jobs/${job.id}` }, () => true);
    assert.strictEqual(res3.statusCode, 200);
  });

  await test('POST /schedules carries an uploaded flyer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    const flyer = path.join(dir, 'upload_1.jpg');
    fs.writeFileSync(flyer, 'jpegbytes');
    const deps = makeDeps({ MEDIA_DIR: dir });
    const h = createApiHandlers(deps);
    const res = mockRes();
    const body = JSON.stringify({
      message: 'caption', target: 'family', timeStr: '9am', filePath: flyer,
    });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/schedules' }, () => true);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.schedule.filePath, flyer);
    assert.strictEqual(data.schedule.message, 'caption');
  });

  await test('POST /schedules rejects a filePath outside MEDIA_DIR', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    const deps = makeDeps({ MEDIA_DIR: dir });
    const h = createApiHandlers(deps);
    const res = mockRes();
    const body = JSON.stringify({
      message: 'x', target: 'family', timeStr: '9am', filePath: '/etc/passwd',
    });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/schedules' }, () => true);
    assert.strictEqual(res.statusCode, 400);
  });

  await test('DELETE /schedules/:id drops the flyer it was holding', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    const flyer = path.join(dir, 'upload_2.jpg');
    fs.writeFileSync(flyer, 'jpegbytes');
    const deps = makeDeps({ MEDIA_DIR: dir });
    deps.saveSchedules([
      { id: 7, message: 'x', target: 'a', runAt: new Date().toISOString(), filePath: flyer },
    ]);
    const h = createApiHandlers(deps);
    const res = mockRes();
    await h.handleRequest({ method: 'DELETE' }, res, { pathname: '/schedules/7' }, () => true);
    assert.strictEqual(fs.existsSync(flyer), false);
  });

  await test('DELETE keeps a flyer another schedule still points at', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    const flyer = path.join(dir, 'upload_3.jpg');
    fs.writeFileSync(flyer, 'jpegbytes');
    const deps = makeDeps({ MEDIA_DIR: dir });
    const runAt = new Date().toISOString();
    deps.saveSchedules([
      { id: 8, message: 'x', target: 'a', runAt, filePath: flyer },
      { id: 9, message: 'x', target: 'b', runAt, filePath: flyer },
    ]);
    const h = createApiHandlers(deps);
    const res = mockRes();
    await h.handleRequest({ method: 'DELETE' }, res, { pathname: '/schedules/8' }, () => true);
    assert.strictEqual(fs.existsSync(flyer), true);
  });

  await test('GET /media/:name serves an uploaded flyer back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    fs.writeFileSync(path.join(dir, 'upload_9.jpg'), 'jpegbytes');
    const h = createApiHandlers(makeDeps({ MEDIA_DIR: dir }));
    const chunks = [];
    const res = {
      statusCode: 0, headers: null, body: '',
      writeHead(c, hdrs) { this.statusCode = c; this.headers = hdrs; },
      end(d) { if (d) this.body = d; },
      on() {}, once() {}, emit() {}, write(c) { chunks.push(c); return true; },
    };
    const ok = await h.handleRequest({ method: 'GET' }, res, { pathname: '/media/upload_9.jpg' }, () => true);
    assert.ok(ok);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], 'image/jpeg');
  });

  await test('GET /media refuses a path that walks out of MEDIA_DIR', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    const h = createApiHandlers(makeDeps({ MEDIA_DIR: dir }));
    const res = mockRes();
    await h.handleRequest(
      { method: 'GET' }, res, { pathname: `/media/${encodeURIComponent('../../etc/passwd')}` }, () => true,
    );
    assert.strictEqual(res.statusCode, 404);
  });

  await test('GET /media requires auth', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandesha-media-'));
    fs.writeFileSync(path.join(dir, 'upload_10.jpg'), 'x');
    const h = createApiHandlers(makeDeps({ MEDIA_DIR: dir }));
    const res = mockRes();
    let asked = false;
    await h.handleRequest({ method: 'GET' }, res, { pathname: '/media/upload_10.jpg' }, () => {
      asked = true;
      return false;
    });
    assert.strictEqual(asked, true, 'the auth gate must be consulted');
    assert.strictEqual(res.statusCode, 0, 'nothing served when auth refuses');
  });

  await test('DELETE /schedules/:id removes schedule', async () => {
    const deps = makeDeps();
    deps.saveSchedules([{ id: 123, message: 'x', target: 'a', runAt: new Date().toISOString() }]);
    const h = createApiHandlers(deps);
    const res = mockRes();
    const ok = await h.handleRequest({ method: 'DELETE' }, res, { pathname: '/schedules/123' }, () => true);
    assert.ok(ok);
    assert.strictEqual(deps.loadSchedules().length, 0);
  });

  await test('GET /contacts/search finds by name (saved contacts)', async () => {
    // saved-only search — no client.getContacts() needed
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const ok = await h.handleRequest(
      { method: 'GET' },
      res,
      { pathname: '/contacts/search', query: { q: 'alice' } },
      () => true,
    );
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(data.results.some((r) => r.name.toLowerCase().includes('alice')));
    assert.ok(data.results.some((r) => r.phone === '919876543210'));
  });

  await test('GET /contacts/search finds WA contacts after warmContactIndex', async () => {
    const deps = makeDeps({
      client: {
        getContacts: async () => [
          {
            isGroup: false, isMe: false, isUser: true, isBroadcast: false,
            isMyContact: true, name: 'Radhika Sharma', pushname: 'Radhika',
            number: '919363802383', id: { _serialized: '919363802383@c.us' },
          },
          // Duplicate LID entry for same person — should be deduped
          {
            isGroup: false, isMe: false, isUser: true, isBroadcast: false,
            isMyContact: false, name: '', pushname: 'Radhika',
            number: '919363802383', id: { _serialized: '111@lid' },
          },
        ],
        getChats: async () => [],
      },
    });
    const h = createApiHandlers(deps);
    await h.warmContactIndex();
    const res = mockRes();
    const ok = await h.handleRequest(
      { method: 'GET' },
      res,
      { pathname: '/contacts/search', query: { q: 'radhika' } },
      () => true,
    );
    assert.ok(ok);
    const data = JSON.parse(res.body);
    const radhikas = data.results.filter((r) => r.name.toLowerCase().includes('radhika'));
    assert.ok(radhikas.length > 0, 'found radhika');
    assert.strictEqual(radhikas.length, 1, 'no duplicates');
    assert.strictEqual(radhikas[0].phone, '919363802383');
  });

  await test('GET /contacts returns contacts', async () => {
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const ok = await h.handleRequest({ method: 'GET' }, res, { pathname: '/contacts' }, () => true);
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.contacts.alice, '919876543210');
  });

  await test('GET /activity returns a newest-first list, admin only', async () => {
    const deps = makeDeps({
      loadDelivered: () => [
        { target: '111@g.us', sentAt: '2020-01-01T00:00:00.000Z', sourceId: 'old-1' },
      ],
    });
    const h = createApiHandlers(deps);

    // non-admin is refused by the auth gate
    let refused = false;
    const res0 = mockRes();
    await h.handleRequest({ method: 'GET' }, res0, { pathname: '/activity', query: {} }, (_r, _s, roles) => {
      if (roles && roles.includes('admin')) { refused = true; return false; }
      return true;
    });
    assert.ok(refused, 'route must ask for the admin role');

    const res = mockRes();
    const ok = await h.handleRequest(
      { method: 'GET' },
      res,
      { pathname: '/activity', query: { limit: '50' } },
      () => true,
    );
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.activity));
    // the old delivered row is back-filled
    assert.ok(data.activity.some((e) => e.corrId === 'old-1' && e.category === 'schedule'));
    // sorted newest-first
    for (let i = 1; i < data.activity.length; i++) {
      assert.ok(Date.parse(data.activity[i - 1].at) >= Date.parse(data.activity[i].at));
    }
  });

  await test('GET /push/vapid-public-key returns the key (no auth)', async () => {
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const ok = await h.handleRequest({ method: 'GET' }, res, { pathname: '/push/vapid-public-key', query: {} }, () => true);
    assert.ok(ok);
    assert.strictEqual(JSON.parse(res.body).key, 'FAKE_VAPID_PUBLIC_KEY');
  });

  await test('POST /push/subscribe upserts and /push/unsubscribe removes', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } };

    const subReq = { method: 'POST', headers: {}, on(evt, fn) { if (evt === 'data') fn(JSON.stringify({ subscription: sub })); if (evt === 'end') fn(); } };
    await h.handleRequest(subReq, mockRes(), { pathname: '/push/subscribe', query: {} }, () => true);
    assert.strictEqual(deps.pushSvc.subs.length, 1);
    assert.strictEqual(deps.pushSvc.subs[0].endpoint, sub.endpoint);

    // upsert (same endpoint) — still one row
    const subReq2 = { method: 'POST', headers: {}, on(evt, fn) { if (evt === 'data') fn(JSON.stringify({ subscription: sub })); if (evt === 'end') fn(); } };
    await h.handleRequest(subReq2, mockRes(), { pathname: '/push/subscribe', query: {} }, () => true);
    assert.strictEqual(deps.pushSvc.subs.length, 1);

    const unsubReq = { method: 'POST', headers: {}, on(evt, fn) { if (evt === 'data') fn(JSON.stringify({ endpoint: sub.endpoint })); if (evt === 'end') fn(); } };
    await h.handleRequest(unsubReq, mockRes(), { pathname: '/push/unsubscribe', query: {} }, () => true);
    assert.strictEqual(deps.pushSvc.subs.length, 0);
  });

  await test('POST /push/notify-internal needs the shared secret', async () => {
    const deps = makeDeps();
    deps.pushSvc.subs.push({ endpoint: 'https://push.example/n', keys: {}, role: 'nurturing', userId: '' });
    const h = createApiHandlers(deps);

    const bad = mockRes();
    await h.handleRequest(
      { method: 'POST', headers: {}, on(e, fn) { if (e === 'data') fn(JSON.stringify({ token: 'nope', audience: 'nurturing', title: 't' })); if (e === 'end') fn(); } },
      bad, { pathname: '/push/notify-internal', query: {} }, () => true,
    );
    assert.strictEqual(bad.statusCode, 403);

    const ok = mockRes();
    await h.handleRequest(
      { method: 'POST', headers: {}, on(e, fn) { if (e === 'data') fn(JSON.stringify({ token: 'FAKE_INTERNAL_TOKEN', audience: 'nurturing', title: 't' })); if (e === 'end') fn(); } },
      ok, { pathname: '/push/notify-internal', query: {} }, () => true,
    );
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(JSON.parse(ok.body).sent, 1);
  });

  await test('POST /volunteers/add-to-group starts a job (admin/nurturing only)', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);

    let askedRoles = null;
    const res = mockRes();
    await h.handleRequest(
      { method: 'POST', headers: {}, on(e, fn) { if (e === 'data') fn(JSON.stringify({ groupJid: 'g@g.us', numbers: ['919845935365'] })); if (e === 'end') fn(); } },
      res, { pathname: '/volunteers/add-to-group', query: {} },
      (_r, _s, roles) => { askedRoles = roles; return true; },
    );
    assert.deepStrictEqual(askedRoles, ['admin', 'nurturing']);
    assert.ok(JSON.parse(res.body).jobId);
  });

  await test('POST /push/test reports how many were notified', async () => {
    const deps = makeDeps();
    deps.pushSvc.subs.push({ endpoint: 'https://push.example/a', keys: {}, role: 'admin', userId: '' });
    const h = createApiHandlers(deps);
    const req = { method: 'POST', headers: {}, on(evt, fn) { if (evt === 'data') fn('{}'); if (evt === 'end') fn(); } };
    const res = mockRes();
    await h.handleRequest(req, res, { pathname: '/push/test', query: {} }, () => true);
    const data = JSON.parse(res.body);
    assert.ok(data.ok);
    assert.strictEqual(typeof data.sent, 'number');
  });

  await test('POST /contacts adds contact', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const body = JSON.stringify({ name: 'bob', number: '911111111111' });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/contacts' }, () => true);
    assert.ok(deps.loadContacts().contacts.bob);
  });

  await test('getGroupsEnriched serves stale cache on detached frame', async () => {
    let calls = 0;
    const deps = makeDeps({
      client: {
        getChats: async () => {
          calls += 1;
          if (calls > 1) throw new Error("Attempted to use detached Frame 'ABC123'.");
          return [{
            isGroup: true,
            name: 'Cached Group',
            id: { _serialized: '111@g.us' },
            fetchMessages: async () => [],
          }];
        },
      },
      onSessionError: () => {},
    });
    const h = createApiHandlers(deps);
    const fresh = await h.getGroupsEnriched(true);
    assert.strictEqual(fresh.length, 1);
    assert.strictEqual(fresh[0].name, 'Cached Group');

    const stale = await h.getGroupsEnriched(true);
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].name, 'Cached Group');
    assert.strictEqual(calls, 2);
  });

  await test('getGroupsEnriched shares one run between simultaneous callers and looks at groups a few at a time', async () => {
    let chatCalls = 0;
    let running = 0;
    let peak = 0;
    const mkGroup = (n) => ({
      isGroup: true,
      name: `Group ${n}`,
      id: { _serialized: `${n}@g.us` },
      fetchMessages: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 15));
        running -= 1;
        return [];
      },
    });
    const h = createApiHandlers(makeDeps({
      client: { getChats: async () => { chatCalls += 1; return Array.from({ length: 10 }, (_, i) => mkGroup(i)); } },
    }));
    const [a, b, c] = await Promise.all([h.getGroupsEnriched(), h.getGroupsEnriched(), h.getGroupsEnriched()]);
    assert.strictEqual(chatCalls, 1, 'one trip through WhatsApp for three callers');
    assert.strictEqual(a.length, 10);
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
    assert.ok(peak > 1 && peak <= 4, `groups checked ${peak} at a time`);
  });

  await test('getGroupsEnriched uses the shared chat list when given one', async () => {
    let shared = 0;
    const h = createApiHandlers(makeDeps({
      client: { getChats: async () => { throw new Error('should not be called'); } },
      getChats: async () => { shared += 1; return [{ isGroup: true, name: 'G', id: { _serialized: '1@g.us' }, fetchMessages: async () => [] }]; },
    }));
    assert.strictEqual((await h.getGroupsEnriched(true)).length, 1);
    assert.strictEqual(shared, 1);
  });

  await test('GET /groups/inactive filters by days', async () => {
    const deps = makeDeps({
      client: {
        getChats: async () => [{
          isGroup: true,
          name: 'Old',
          id: { _serialized: '111@g.us' },
          fetchMessages: async () => [{ timestamp: Math.floor(Date.now() / 1000) - 86400 * 60 }],
        }],
      },
    });
    const h = createApiHandlers(deps);
    const groups = await h.getGroupsEnriched(true);
    assert.ok(groups[0].daysInactive >= 30);
    const res = mockRes();
    await h.handleRequest({ method: 'GET' }, res, { pathname: '/groups/inactive', query: { days: '30' } }, () => true);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data));
  });

  await test('POST /send/bulk requires numbers and message', async () => {
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const body = JSON.stringify({ numbers: '9876543210', message: 'test' });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/send/bulk' }, () => true);
    const data = JSON.parse(res.body);
    assert.ok(data.results);
  });

  await test('unknown route returns false', async () => {
    const h = createApiHandlers(makeDeps());
    const ok = await h.handleRequest({ method: 'GET' }, mockRes(), { pathname: '/nope' }, () => true);
    assert.strictEqual(ok, false);
  });

  console.log('');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed) process.exit(1);
}

run();
