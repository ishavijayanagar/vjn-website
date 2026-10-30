'use strict';

const assert = require('assert');
const { isComplimentMessage, pickReply } = require('../compliment-reply');

const norm = (d) => String(d).replace(/\D/g, '');

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

test('short thanks without mention', () => {
  assert.strictEqual(
    isComplimentMessage('Thank you 🙏', { msg: { body: 'Thank you 🙏' }, normalizePhoneDigits: norm }),
    true,
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

test('u r great and you are great', () => {
  assert.strictEqual(
    isComplimentMessage('u r great!', { msg: { body: 'u r great!' }, normalizePhoneDigits: norm }),
    true,
  );
  assert.strictEqual(
    isComplimentMessage("you're great", { msg: { body: "you're great" }, normalizePhoneDigits: norm }),
    true,
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

test('pickReply returns a string', () => {
  assert.ok(pickReply().length > 3);
});

if (failed) {
  console.log(`\nCompliment-reply: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nCompliment-reply: ${passed} passed, ${failed} failed`);
