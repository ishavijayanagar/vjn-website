'use strict';

const assert = require('assert');
const { formatPairingCode, isNotifyConfigured } = require('../notify-email');

assert.strictEqual(formatPairingCode('abcd1234'), 'ABCD-1234');
assert.strictEqual(formatPairingCode('ABCD-1234'), 'ABCD-1234');
assert.strictEqual(formatPairingCode('xy'), 'XY');

const prev = {
  email: process.env.SANDESHA_NOTIFY_EMAIL,
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS
};

delete process.env.SANDESHA_NOTIFY_EMAIL;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
assert.strictEqual(isNotifyConfigured(), false);

process.env.SANDESHA_NOTIFY_EMAIL = 'a@b.c';
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_USER = 'u';
process.env.SMTP_PASS = 'p';
assert.strictEqual(isNotifyConfigured(), true);

if (prev.email === undefined) delete process.env.SANDESHA_NOTIFY_EMAIL;
else process.env.SANDESHA_NOTIFY_EMAIL = prev.email;
if (prev.host === undefined) delete process.env.SMTP_HOST;
else process.env.SMTP_HOST = prev.host;
if (prev.user === undefined) delete process.env.SMTP_USER;
else process.env.SMTP_USER = prev.user;
if (prev.pass === undefined) delete process.env.SMTP_PASS;
else process.env.SMTP_PASS = prev.pass;

console.log('notify-email.test.js: OK');
