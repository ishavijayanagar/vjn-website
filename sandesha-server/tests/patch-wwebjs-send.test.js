'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { patchSendSource } = require('../patch-wwebjs-send');

const ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)\n";

test('drops the media id before the message is handed to WhatsApp', () => {
  const next = patchSendSource(`const message = { id: newMsgKey };\n${ANCHOR}if (botOptions) {}\n`);
  assert.match(next, /delete message\.__x_id;/);
  assert.ok(next.indexOf('delete message.__x_id;') < next.indexOf(ANCHOR.trim()));
});

test('a library that already has the fix is not patched twice', () => {
  const src = `delete message.__x_id;\n${ANCHOR}`;
  assert.strictEqual(patchSendSource(src), src);
});
