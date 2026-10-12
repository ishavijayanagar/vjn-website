'use strict';

const assert = require('assert');
const { isWhatsAppSessionError } = require('../wa-session');

assert.ok(isWhatsAppSessionError(new Error("Attempted to use detached Frame 'B8A5AD3C1FC6EDD3CB68F02CC66648A3'.")));
assert.ok(isWhatsAppSessionError(new Error('Session closed')));
assert.ok(!isWhatsAppSessionError(new Error('group not found')));

console.log('wa-session.test.js: ok');
