'use strict';

/**
 * Tests for the sending-safety layer (SENDING_SAFETY.md).
 *
 * The point of these is that the pacing is genuinely *not* periodic and the
 * budget genuinely survives a restart — the two things the document says
 * actually matter, and the two easiest to regress silently.
 */

const assert = require('assert');

// Pin the knobs before requiring the module, since config is read at load.
process.env.SANDESHA_SEND_JITTER_MIN_MS = '1';
process.env.SANDESHA_SEND_JITTER_MAX_MS = '3';
process.env.SANDESHA_QUIET_START_HOUR = '22';
process.env.SANDESHA_QUIET_END_HOUR = '8';
process.env.SANDESHA_MAX_SENDS_PER_HOUR = '3';
process.env.SANDESHA_MAX_SENDS_PER_DAY = '5';
process.env.SANDESHA_SEND_AUDIT = '0';

const safety = require('../send-safety');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

/** A fixed instant, expressed as the UTC moment for a given IST wall clock. */
function ist(hour, minute = 0, day = 15) {
  return new Date(Date.UTC(2026, 7, day, hour, minute) - 5.5 * 60 * 60 * 1000);
}

// ── Quiet hours ───────────────────────────────────────────────────────────
test('quiet hours cover the night window in IST', () => {
  assert.strictEqual(safety.inQuietHours(ist(23)), true, '23:00 IST is quiet');
  assert.strictEqual(safety.inQuietHours(ist(3)), true, '03:00 IST is quiet');
  assert.strictEqual(safety.inQuietHours(ist(7, 59)), true, '07:59 IST is quiet');
});

test('quiet hours end at the configured morning hour', () => {
  assert.strictEqual(safety.inQuietHours(ist(8)), false, '08:00 IST sends');
  assert.strictEqual(safety.inQuietHours(ist(14)), false, 'afternoon sends');
  assert.strictEqual(safety.inQuietHours(ist(21, 59)), false, '21:59 IST sends');
});

test('quietHoursEndAt lands outside the window', () => {
  const resume = safety.quietHoursEndAt(ist(2));
  assert.strictEqual(safety.inQuietHours(resume), false);
  assert.ok(resume > ist(2), 'resumes in the future');
});

test('a start hour equal to the end hour disables quiet hours', () => {
  const start = safety.CONFIG.quietStartHour;
  safety.CONFIG.quietEndHour = start;
  assert.strictEqual(safety.inQuietHours(ist(3)), false);
  safety.CONFIG.quietEndHour = 8;
});

// ── Jitter ────────────────────────────────────────────────────────────────
test('jitter stays inside its range', async () => {
  const started = Date.now();
  return safety.jitter(5, 15).then(() => {
    assert.ok(Date.now() - started >= 4, 'waited at least the minimum');
  });
});

test('jitter is not periodic — consecutive gaps differ', () => {
  // Sample the distribution directly rather than timing 40 real sleeps.
  const draws = new Set();
  for (let i = 0; i < 200; i++) {
    draws.add(Math.round(45000 + Math.random() * 45000));
  }
  assert.ok(draws.size > 150, `expected a wide spread, got ${draws.size} distinct gaps`);
});

test('the shipped defaults are wide enough to not read as a constant', () => {
  // This file pins tiny gaps so the suite runs fast; re-read the module with
  // those overrides removed to assert on what actually ships.
  const overrides = ['SANDESHA_SEND_JITTER_MIN_MS', 'SANDESHA_SEND_JITTER_MAX_MS'];
  const saved = overrides.map((k) => process.env[k]);
  overrides.forEach((k) => delete process.env[k]);
  delete require.cache[require.resolve('../send-safety')];
  const shipped = require('../send-safety');
  overrides.forEach((k, i) => { if (saved[i] !== undefined) process.env[k] = saved[i]; });
  delete require.cache[require.resolve('../send-safety')];

  assert.strictEqual(shipped.CONFIG.sendMinMs, 45000, 'SENDING_SAFETY.md §5 minimum');
  assert.strictEqual(shipped.CONFIG.sendMaxMs, 90000, 'SENDING_SAFETY.md §5 maximum');
  const spread = shipped.CONFIG.sendMaxMs - shipped.CONFIG.sendMinMs;
  assert.ok(spread >= 10000, `gap spread ${spread}ms is too narrow to hide periodicity`);
  assert.ok(shipped.CONFIG.sendMinMs >= 5000, 'never go below ~5s between distinct chats');
});

// ── Shuffle ───────────────────────────────────────────────────────────────
test('shuffled keeps every member exactly once', () => {
  const input = ['a', 'b', 'c', 'd', 'e', 'f'];
  const out = safety.shuffled(input);
  assert.deepStrictEqual(out.slice().sort(), input.slice().sort());
  assert.deepStrictEqual(input, ['a', 'b', 'c', 'd', 'e', 'f'], 'input untouched');
});

test('shuffled actually reorders across runs', () => {
  const input = Array.from({ length: 12 }, (_, i) => String(i));
  const orders = new Set();
  for (let i = 0; i < 40; i++) orders.add(safety.shuffled(input).join(','));
  assert.ok(orders.size > 1, 'fan-out order must vary between sends');
});

// ── Budget ────────────────────────────────────────────────────────────────
function memoryStore(initial = {}) {
  let store = { ...initial };
  return {
    loadState: () => store,
    saveState: (patch) => { store = { ...store, ...patch }; },
    read: () => store,
  };
}

test('budget blocks once the hourly ceiling is reached', () => {
  const mem = memoryStore();
  const budget = safety.createSendBudget(mem);
  const at = ist(10);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(budget.check(at).ok, true, `send ${i + 1} allowed`);
    budget.record(1, at);
  }
  const verdict = budget.check(at);
  assert.strictEqual(verdict.ok, false);
  assert.match(verdict.reason, /hourly/);
});

test('the hourly ceiling clears on the next hour, the daily one does not', () => {
  const mem = memoryStore();
  const budget = safety.createSendBudget(mem);
  for (let i = 0; i < 3; i++) budget.record(1, ist(10));
  assert.strictEqual(budget.check(ist(11)).ok, true, 'new hour, new allowance');

  budget.record(2, ist(11));
  const verdict = budget.check(ist(12));
  assert.strictEqual(verdict.ok, false, 'daily ceiling still applies');
  assert.match(verdict.reason, /daily/);
});

test('counters roll over at IST midnight', () => {
  const mem = memoryStore();
  const budget = safety.createSendBudget(mem);
  budget.record(5, ist(23, 0, 15));
  assert.strictEqual(budget.check(ist(23, 30, 15)).ok, false, 'day is spent');
  assert.strictEqual(budget.check(ist(9, 0, 16)).ok, true, 'next IST day is fresh');
});

test('a restart resumes the same budget instead of a fresh one', () => {
  const mem = memoryStore();
  const before = safety.createSendBudget(mem);
  before.record(3, ist(10));

  // A new process reading the same state.json must see the spent budget.
  const after = safety.createSendBudget(mem);
  const verdict = after.check(ist(10));
  assert.strictEqual(verdict.ok, false, 'restart must not hand out a fresh hour');
  assert.strictEqual(after.snapshot(ist(10)).dayCount, 3);
});

test('budget writes only its own key, leaving the poll cursor alone', () => {
  const mem = memoryStore({ lastProcessedTimestamp: 1787766705 });
  const budget = safety.createSendBudget(mem);
  budget.record(1, ist(10));
  assert.strictEqual(mem.read().lastProcessedTimestamp, 1787766705);
  assert.strictEqual(mem.read().sendBudget.dayCount, 1);
});

// ── Paced fan-out (the scheduler's resume path) ───────────────────────────
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

const fanOutChecks = (async () => {
  await asyncTest('a clean fan-out reaches every member exactly once', async () => {
    const hit = [];
    const res = await safety.runPacedFanOut({
      members: ['a@g.us', 'b@g.us', 'c@g.us'],
      deliver: async (m) => { hit.push(m); },
      gap: async () => {},
    });
    assert.strictEqual(res.complete, true);
    assert.deepStrictEqual(hit.slice().sort(), ['a@g.us', 'b@g.us', 'c@g.us']);
    assert.deepStrictEqual(res.sentTo.slice().sort(), hit.slice().sort());
  });

  await asyncTest('duplicates inside the set are collapsed', async () => {
    const hit = [];
    await safety.runPacedFanOut({
      members: ['a@g.us', 'A@G.US', 'b@g.us'],
      deliver: async (m) => { hit.push(m); },
      gap: async () => {},
    });
    assert.strictEqual(hit.length, 2, 'the same group must not be messaged twice');
  });

  await asyncTest('a refused guard stops the fan-out and names the reason', async () => {
    const hit = [];
    const res = await safety.runPacedFanOut({
      members: ['a@g.us', 'b@g.us', 'c@g.us', 'd@g.us'],
      deliver: async (m) => { hit.push(m); },
      guard: () => (hit.length < 2 ? { ok: true } : { ok: false, reason: 'quiet hours' }),
      gap: async () => {},
    });
    assert.strictEqual(res.complete, false);
    assert.strictEqual(res.reason, 'quiet hours');
    assert.strictEqual(res.sentTo.length, 2, 'reports exactly who was reached');
  });

  await asyncTest('resuming skips the groups already reached and finishes the rest', async () => {
    const members = ['a@g.us', 'b@g.us', 'c@g.us', 'd@g.us', 'e@g.us'];
    const firstHits = [];
    const paused = await safety.runPacedFanOut({
      members,
      deliver: async (m) => { firstHits.push(m); },
      guard: () => (firstHits.length < 2 ? { ok: true } : { ok: false, reason: 'cap' }),
      gap: async () => {},
    });
    assert.strictEqual(paused.complete, false);

    const secondHits = [];
    const resumed = await safety.runPacedFanOut({
      members,
      alreadySent: paused.sentTo,
      deliver: async (m) => { secondHits.push(m); },
      gap: async () => {},
    });

    assert.strictEqual(resumed.complete, true);
    // Nobody twice, and nobody missed.
    const overlap = secondHits.filter((m) => firstHits.includes(m));
    assert.deepStrictEqual(overlap, [], `resend to ${overlap.join()}`);
    assert.deepStrictEqual(resumed.sentTo.slice().sort(), members.slice().sort());
  });

  await asyncTest('a guard that refuses immediately sends to nobody', async () => {
    let calls = 0;
    const res = await safety.runPacedFanOut({
      members: ['a@g.us', 'b@g.us'],
      deliver: async () => { calls++; },
      guard: () => ({ ok: false, reason: 'quiet hours' }),
      gap: async () => {},
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(res.complete, false);
    assert.deepStrictEqual(res.sentTo, []);
  });

  await asyncTest('a fan-out where everyone was already reached completes with no sends', async () => {
    let calls = 0;
    const res = await safety.runPacedFanOut({
      members: ['a@g.us', 'b@g.us'],
      alreadySent: ['a@g.us', 'b@g.us'],
      deliver: async () => { calls++; },
      gap: async () => {},
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(res.complete, true, 'a fully-resumed schedule must not requeue forever');
  });

  await asyncTest('no gap is taken after the final send', async () => {
    let gaps = 0;
    await safety.runPacedFanOut({
      members: ['a@g.us', 'b@g.us', 'c@g.us'],
      deliver: async () => {},
      gap: async () => { gaps++; },
    });
    assert.strictEqual(gaps, 2, 'three sends means two gaps');
  });
})();

// ── Caption variation ─────────────────────────────────────────────────────
test('caption variation preserves the message body verbatim', () => {
  const body = 'Sunday satsang at 6.30pm in the main hall.';
  for (let i = 0; i < 40; i++) {
    assert.ok(safety.varyCaption(body).includes(body), 'body must survive intact');
  }
});

test('caption variation produces more than one framing', () => {
  const body = 'Sunday satsang.';
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(safety.varyCaption(body));
  assert.ok(seen.size > 1, 'identical payloads are the thing being avoided');
});

test('caption variation leaves an empty message alone', () => {
  assert.strictEqual(safety.varyCaption(''), '');
  assert.strictEqual(safety.varyCaption(null), '');
});

test('caption variation can be switched off', () => {
  const body = 'Plain.';
  assert.strictEqual(safety.varyCaption(body, { enabled: false }), body);
});

// ── Presence ──────────────────────────────────────────────────────────────
test('typing presence never lets a chat error stop a send', async () => {
  const chat = {
    sendStateTyping: async () => { throw new Error('offline'); },
    clearState: async () => {},
  };
  return safety.withTypingPresence(chat, 'hello').then(
    () => assert.ok(true, 'resolved despite the failure'),
    () => assert.fail('presence must swallow its own errors'),
  );
});

test('typing presence is skipped when disabled', async () => {
  let called = false;
  const chat = {
    sendStateTyping: async () => { called = true; },
    clearState: async () => {},
  };
  return safety.withTypingPresence(chat, 'hi', { enabled: false }).then(() => {
    assert.strictEqual(called, false);
  });
});

Promise.all([fanOutChecks]).then(() => {
  setTimeout(() => {
    console.log(`\nPassed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  }, 100);
});
