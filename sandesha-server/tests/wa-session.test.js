'use strict';

const assert = require('assert');
const { isWhatsAppSessionError } = require('../wa-session');

assert.ok(isWhatsAppSessionError(new Error("Attempted to use detached Frame 'B8A5AD3C1FC6EDD3CB68F02CC66648A3'.")));
assert.ok(isWhatsAppSessionError(new Error('Session closed')));
assert.ok(isWhatsAppSessionError(new Error("Cannot read properties of undefined (reading 'getChat')")));
assert.ok(isWhatsAppSessionError(new Error("Cannot read properties of undefined (reading 'getChats')")));
assert.ok(isWhatsAppSessionError(new Error('window.WWebJS is not defined')));
assert.ok(!isWhatsAppSessionError(new Error('group not found')));
assert.ok(!isWhatsAppSessionError(new Error("Cannot read properties of undefined (reading 'name')")));

const { needsReconnect, isHelperMissingError } = require('../wa-session');
const helperMissing = new Error("Cannot read properties of undefined (reading 'getChats')");
assert.ok(isHelperMissingError(helperMissing));
// Starting up: the helpers are not there yet — do NOT restart the page.
assert.strictEqual(needsReconnect(helperMissing, 'pairing'), false);
assert.strictEqual(needsReconnect(helperMissing, 'disconnected'), false);
assert.strictEqual(needsReconnect(helperMissing, 'connecting'), false);
// Ready and still missing: the page is really broken — reconnect.
assert.strictEqual(needsReconnect(helperMissing, 'connected'), true);
// A lost frame is a real session problem whatever the state.
assert.strictEqual(needsReconnect(new Error("Attempted to use detached Frame 'X'."), 'pairing'), true);
// "Still starting" is answered with a 503 and never causes a reconnect.
const notReady = Object.assign(new Error('WhatsApp is still starting'), { code: 'WA_NOT_READY' });
assert.ok(isWhatsAppSessionError(notReady));
assert.strictEqual(needsReconnect(notReady, 'connected'), false);
assert.strictEqual(needsReconnect(new Error('group not found'), 'connected'), false);

console.log('wa-session.test.js: ok');
