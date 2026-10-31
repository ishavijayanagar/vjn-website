'use strict';

const assert = require('assert');
const {
  parsePlanningCommand,
  stripMentionTokens,
  isSandeshaMentioned,
  isAllowedPlanningOperator,
  resolveOperatorId,
  parsePlanningOperators,
  formatSetsMenu,
  parseSetChoice,
  parsePlanningQueueCommand,
  listUpcomingSchedules,
  formatQueueMenu,
  createPlanningSendWizard,
} = require('../planning-send');

const norm = (d) => {
  let x = String(d).replace(/\D/g, '');
  if (x.length === 10 && /^[6-9]\d{9}$/.test(x)) x = `91${x}`;
  return x;
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`❌ ${name}: ${err.message}`);
      failed++;
    });
}

test('stripMentionTokens removes @sandesha', () => {
  assert.strictEqual(stripMentionTokens('@sandesha send'), 'send');
  assert.strictEqual(stripMentionTokens('hi @Sandesha  send'), 'hi send');
});

test('parsePlanningCommand accepts send only', () => {
  assert.strictEqual(parsePlanningCommand('@sandesha send').ok, true);
  assert.strictEqual(parsePlanningCommand('send').ok, true);
  assert.strictEqual(parsePlanningCommand('@sandesha send this').ok, true);
  assert.strictEqual(parsePlanningCommand('@sandesha schedule').ok, false);
  assert.strictEqual(parsePlanningCommand('send to family').ok, false);

  const now = parsePlanningCommand('@sandesha send this now');
  assert.strictEqual(now.ok, true);
  assert.strictEqual(now.when, 'now');

  const at = parsePlanningCommand('@sv send this at 6pm today');
  assert.strictEqual(at.ok, true);
  assert.strictEqual(at.when, 'schedule');
  assert.strictEqual(at.timeStr, '6pm today');

  const dotTime = parsePlanningCommand('send this at 5.51pm today');
  assert.strictEqual(dotTime.ok, true);
  assert.strictEqual(dotTime.when, 'schedule');
  assert.strictEqual(dotTime.timeStr, '5.51pm today');

  const noMentionNow = parsePlanningCommand('send this now');
  assert.strictEqual(noMentionNow.ok, true);
  assert.strictEqual(noMentionNow.when, 'now');

  const full = parsePlanningCommand('@sandesha send this now to vjn_sub_center_grps');
  assert.strictEqual(full.when, 'now');
  assert.strictEqual(full.setHint, 'vjn_sub_center_grps');
});

test('isSandeshaMentioned fallback @sandesha in body', () => {
  assert.strictEqual(isSandeshaMentioned({ body: '@sandesha send' }, null, ['sandesha', 'sv'], norm), true);
  assert.strictEqual(isSandeshaMentioned({ body: '@sv send' }, null, ['sandesha', 'sv'], norm), true);
  assert.strictEqual(isSandeshaMentioned({ body: 'send' }, null, ['sandesha', 'sv'], norm), false);
});

test('isSandeshaMentioned metadata mentionedIds', () => {
  const msg = {
    body: 'send',
    mentionedIds: ['919111222333@c.us'],
  };
  assert.strictEqual(
    isSandeshaMentioned(msg, '919111222333@c.us', ['sandesha'], norm),
    true,
  );
});

test('resolveOperatorId from author', () => {
  const msg = {
    fromMe: false,
    author: '919876543210@c.us',
  };
  assert.strictEqual(resolveOperatorId(msg, '9876543210', norm, () => null), '919876543210');
  assert.strictEqual(resolveOperatorId(msg, '919999999999', norm, () => null), null);
});

test('parsePlanningOperators and second operator', () => {
  const list = parsePlanningOperators('9876543210, 9988776655', norm);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0], '919876543210');
  assert.strictEqual(list[1], '919988776655');
  const msg = { fromMe: false, author: '919988776655@c.us' };
  assert.strictEqual(resolveOperatorId(msg, list, norm, () => null), '919988776655');
});

test('isAllowedPlanningOperator fromMe when linked phone matches', () => {
  const msg = { fromMe: true, from: '120363@g.us' };
  assert.strictEqual(
    isAllowedPlanningOperator(msg, '919876543210', norm, () => '919876543210@c.us'),
    true,
  );
  assert.strictEqual(
    isAllowedPlanningOperator(msg, '919999999999', norm, () => '919876543210@c.us'),
    false,
  );
});

test('isCancel accepts @sandesha cancel', () => {
  const { stripMentionTokens } = require('../planning-send');
  assert.strictEqual(stripMentionTokens('@sandesha cancel'), 'cancel');
  const cancel = require('../planning-send');
  // isCancel is not exported — exercise via parsePlanningQueueCommand boundary
  assert.strictEqual(parsePlanningQueueCommand('@sandesha cancel 2')?.action, 'cancelSchedule');
  assert.strictEqual(parsePlanningQueueCommand('@sandesha cancel'), null);
});

test('handleIngress @sandesha cancel with no session replies', async () => {
  const replies = [];
  const wizard = createPlanningSendWizard({
    loadSets: () => ({}),
    botReply: async (_msg, text) => { replies.push(text); },
    log: () => {},
    normalizePhoneDigits: norm,
    getQuotedMessageSafe: async () => null,
    resolveQuotedTextBundle: async () => ({ text: '' }),
    sendQuotedToSet: async () => {},
    parseScheduleTime: () => null,
    validateScheduleTarget: async () => {},
    loadSchedules: () => [],
    saveSchedules: () => {},
    nextLocalScheduleId: () => 1,
    formatTimeUntil: () => 'soon',
    MEDIA_DIR: '/tmp',
    getMyNumber: () => '919876543210@c.us',
    configuredOperator: '919876543210',
    mentionAliases: ['sandesha'],
  });
  const chat = { id: { _serialized: '120363888@g.us' } };
  const msg = {
    from: chat.id._serialized,
    fromMe: true,
    body: '@sandesha cancel',
    author: '919876543210@c.us',
  };
  assert.strictEqual(await wizard.handleIngress(msg, chat), true);
  assert.ok(replies.some((r) => r.includes('No send wizard')));
});

test('parsePlanningQueueCommand queue and cancel N', () => {
  assert.deepStrictEqual(parsePlanningQueueCommand('@sandesha queue'), { action: 'list' });
  assert.deepStrictEqual(parsePlanningQueueCommand('@sv schedules'), { action: 'list' });
  assert.deepStrictEqual(parsePlanningQueueCommand('cancel 3'), { action: 'cancelSchedule', num: 3 });
  assert.strictEqual(parsePlanningQueueCommand('cancel'), null);
  assert.strictEqual(parsePlanningQueueCommand('send'), null);
});

test('listUpcomingSchedules sorts by runAt and formatQueueMenu numbers rows', () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  const later = new Date(Date.now() + 7200e3).toISOString();
  const rows = listUpcomingSchedules(() => [
    { id: 9, runAt: later, message: 'Second', target: 'family', isSet: true },
    { id: 8, runAt: future, message: 'First', target: 'vols', isSet: false },
  ]);
  assert.strictEqual(rows[0].id, 8);
  const menu = formatQueueMenu(rows);
  assert.ok(menu.includes('1. "First"'));
  assert.ok(menu.includes('2. "Second"'));
  assert.ok(menu.includes('cancel 1'));
});

test('formatSetsMenu and parseSetChoice', () => {
  const sets = { family: ['a@g.us'], all: [] };
  const { text, setKeys } = formatSetsMenu(sets);
  assert.ok(text.includes('family'));
  assert.strictEqual(setKeys.length, 2);
  assert.strictEqual(parseSetChoice('1', setKeys), 'family');
  assert.strictEqual(parseSetChoice('family', setKeys), 'family');
  assert.strictEqual(parseSetChoice('FAMILY', setKeys), 'family');
  assert.strictEqual(parseSetChoice('nope', setKeys), null);
});

test('wizard cancel clears session', async () => {
  const replies = [];
  const quoted = { hasMedia: false, body: 'Hello draft', id: { _serialized: 'q1' } };
  const chatId = '120363999@g.us';

  const wizard = createPlanningSendWizard({
    loadSets: () => ({ vols: ['1@g.us'] }),
    botReply: async (_msg, text) => { replies.push(text); },
    log: () => {},
    normalizePhoneDigits: norm,
    getQuotedMessageSafe: async () => quoted,
    resolveQuotedTextBundle: async () => ({ text: 'Hello draft' }),
    sendQuotedToSet: async () => {},
    parseScheduleTime: () => null,
    validateScheduleTarget: async () => {},
    loadSchedules: () => [],
    saveSchedules: () => {},
    nextLocalScheduleId: () => 1,
    formatTimeUntil: () => 'soon',
    MEDIA_DIR: '/tmp',
    getMyNumber: () => '919876543210@c.us',
    configuredOperator: '919876543210',
    mentionAliases: ['sandesha'],
  });

  const triggerMsg = {
    from: chatId,
    fromMe: true,
    body: '@sandesha send',
    hasQuotedMsg: true,
    author: '919876543210@c.us',
    id: { _serialized: 'trig1' },
  };

  await wizard.tryStartFromTrigger(triggerMsg, '919876543210');
  assert.ok(replies.some((r) => r.includes('Pick a set')));

  await wizard.handleSession(
    { from: chatId, fromMe: true, body: '@sandesha cancel', author: '919876543210@c.us' },
    '919876543210',
  );
  assert.ok(replies.some((r) => r.includes('cancelled')));

  const continued = await wizard.handleSession(
    { from: chatId, fromMe: true, body: '1', author: '919876543210@c.us' },
    '919876543210',
  );
  assert.strictEqual(continued, false);
});

test('handleIngress queue lists schedules and cancel N removes by id', async () => {
  const replies = [];
  const schedules = [
    {
      id: 42,
      runAt: new Date(Date.now() + 3600e3).toISOString(),
      message: 'Queued hello',
      target: 'family',
      isSet: true,
    },
  ];
  const wizard = createPlanningSendWizard({
    loadSets: () => ({}),
    botReply: async (_msg, text) => { replies.push(text); },
    log: () => {},
    normalizePhoneDigits: norm,
    getQuotedMessageSafe: async () => null,
    resolveQuotedTextBundle: async () => ({ text: '' }),
    sendQuotedToSet: async () => {},
    parseScheduleTime: () => null,
    validateScheduleTarget: async () => {},
    loadSchedules: () => schedules,
    saveSchedules: () => {},
    nextLocalScheduleId: () => 1,
    formatTimeUntil: () => 'soon',
    MEDIA_DIR: '/tmp',
    getMyNumber: () => '919876543210@c.us',
    configuredOperator: '919876543210',
    mentionAliases: ['sandesha'],
    cancelScheduleById: (id) => {
      const i = schedules.findIndex((s) => s.id === id);
      if (i === -1) return false;
      schedules.splice(i, 1);
      return true;
    },
  });

  const chat = { id: { _serialized: '120363999@g.us' } };
  const queueMsg = {
    from: chat.id._serialized,
    fromMe: true,
    body: '@sandesha queue',
    author: '919876543210@c.us',
  };
  assert.strictEqual(await wizard.handleIngress(queueMsg, chat), true);
  assert.ok(replies.some((r) => r.includes('Queued sends')));

  const cancelMsg = { ...queueMsg, body: '@sandesha cancel 1' };
  assert.strictEqual(await wizard.handleIngress(cancelMsg, chat), true);
  assert.ok(replies.some((r) => r.includes('Cancelled *#1*')));
  assert.strictEqual(schedules.length, 0);
});

setTimeout(() => {
  console.log(`\nPlanning-send: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 500);
