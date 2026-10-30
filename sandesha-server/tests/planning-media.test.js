'use strict';

const assert = require('assert');
const { stanzaId, extForMedia } = require('../planning-media');

assert.strictEqual(stanzaId({ id: { id: 'ABC123', _serialized: 'true_x@y_ABC123' } }), 'ABC123');
assert.strictEqual(extForMedia({ mimetype: 'video/mp4' }), '.mp4');
assert.strictEqual(extForMedia({ mimetype: 'image/jpeg', filename: 'flyer.jpg' }), '.jpg');
console.log('planning-media: ok');
