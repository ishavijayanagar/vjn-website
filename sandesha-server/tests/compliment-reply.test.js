'use strict';

const assert = require('assert');
const { isComplimentMessage, greetingKind, greetingReply, tryComplimentReply, pickReply } = require('../compliment-reply');

const norm = (d) => String(d).replace(/\D/g, '');

let passed = 0;
let failed = 0;

const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`✅ ${name}`);
        passed++;
      })
      .catch((err) => {
        console.log(`❌ ${name}: ${err.message}`);
        failed++;
      }),
  );
}

test('thanks with @sandesha', () => {
  assert.strictEqual(
    isComplimentMessage('@sandesha thank you!', {
      msg: { body: '@sandesha thank you!' },
      mentionAliases: ['sandesha', 'sv'],
      getMyNumber: null,
      normalizePhoneDigits: norm,
    }),
    true,
  );
});

test('short thanks without mention is ignored', () => {
  assert.strictEqual(
    isComplimentMessage('Thank you 🙏', {
      msg: { body: 'Thank you 🙏' },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    false,
  );
});

test('well done with mention', () => {
  assert.strictEqual(
    isComplimentMessage('@sv well done', {
      msg: { body: '@sv well done' },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    true,
  );
});

test('u r great requires @sandesha', () => {
  assert.strictEqual(
    isComplimentMessage('u r great!', {
      msg: { body: 'u r great!' },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    false,
  );
  assert.strictEqual(
    isComplimentMessage('@sandesha u r great!', {
      msg: { body: '@sandesha u r great!' },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    true,
  );
  assert.strictEqual(
    isComplimentMessage("you're great", {
      msg: { body: "you're great" },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    false,
  );
  assert.strictEqual(
    isComplimentMessage('@sandesha u r amazing', {
      msg: { body: '@sandesha u r amazing' },
      mentionAliases: ['sandesha', 'sv'],
      normalizePhoneDigits: norm,
    }),
    true,
  );
});

test('random chat is not a compliment', () => {
  assert.strictEqual(
    isComplimentMessage('testing something', { msg: { body: 'testing something' }, normalizePhoneDigits: norm }),
    false,
  );
  assert.strictEqual(isComplimentMessage('send to family', { msg: { body: 'send to family' }, normalizePhoneDigits: norm }), false);
});

const gopts = (body) => ({ msg: { body }, mentionAliases: ['sandesha', 'sv'], normalizePhoneDigits: norm });

test('greetings with a mention are recognised', () => {
  assert.strictEqual(greetingKind('@sandesha hi', gopts('@sandesha hi')), 'plain');
  assert.strictEqual(greetingKind('@sv Hello!', gopts('@sv Hello!')), 'plain');
  assert.strictEqual(greetingKind('@sandesha namaskaram 🙏', gopts('@sandesha namaskaram 🙏')), 'plain');
  assert.strictEqual(greetingKind('@sandesha good morning', gopts('@sandesha good morning')), 'morning');
  assert.strictEqual(greetingKind('@sv gm', gopts('@sv gm')), 'morning');
  assert.strictEqual(greetingKind('@sandesha', gopts('@sandesha')), 'plain');
});

test('greetings without a mention, or longer messages, are ignored', () => {
  assert.strictEqual(greetingKind('hi', gopts('hi')), null);
  assert.strictEqual(greetingKind('good morning everyone', gopts('good morning everyone')), null);
  assert.strictEqual(greetingKind('@sandesha hi please send this to the groups', gopts('@sandesha hi please send this to the groups')), null);
  assert.strictEqual(greetingKind('@sandesha send', gopts('@sandesha send')), null);
});

test('greeting reply says what to type; thanks still gets the thanks reply', async () => {
  const out = [];
  const botReply = async (_m, t) => { out.push(t); };
  const deps = { botReply, mentionAliases: ['sandesha', 'sv'], normalizePhoneDigits: norm };
  assert.strictEqual(await tryComplimentReply({ body: '@sandesha good evening' }, deps), true);
  assert.ok(out[0].startsWith('Good evening') && out[0].includes('@sandesha send') && out[0].includes('@sandesha queue'));
  assert.ok(greetingReply('plain').includes('How can I help?'));
  assert.strictEqual(await tryComplimentReply({ body: '@sandesha thank you' }, deps), true);
  assert.ok(!out[1].includes('@sandesha send'));
  assert.strictEqual(await tryComplimentReply({ body: 'hi' }, deps), false);
});

test('pickReply returns a string', () => {
  assert.ok(pickReply().length > 3);
});

Promise.all(pending).then(() => {
  console.log(`\nCompliment-reply: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
