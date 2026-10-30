'use strict';

const assert = require('assert');
const { serializedMessageId } = require('../wweb-media-download');

assert.strictEqual(
  serializedMessageId({
    from: '99707800023198@lid',
    id: {
      fromMe: false,
      remote: '99707800023198@lid',
      id: '3A97F034BBAW753D524F',
      $1: 'false_99707800023198@lid_3A97F034BBAW753D524F',
    },
  }),
  'false_99707800023198@lid_3A97F034BBAW753D524F',
);

assert.strictEqual(
  serializedMessageId({
    from: '120363@g.us',
    id: { _serialized: 'true_120363@g.us_ABC123' },
  }),
  'true_120363@g.us_ABC123',
);

assert.strictEqual(
  serializedMessageId({
    from: '228874680049760@lid',
    id: { fromMe: true, remote: '228874680049760@lid', id: 'XYZ' },
  }),
  'true_228874680049760@lid_XYZ',
);

console.log('wweb-media-download: ok');
