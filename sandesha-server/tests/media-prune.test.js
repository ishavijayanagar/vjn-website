'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pruneMedia } = require('../media-prune');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-prune-'));
const now = Date.now();
const day = 24 * 3600e3;
function put(name, ageDays) {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, 'x');
  const t = new Date(now - ageDays * day);
  fs.utimesSync(abs, t, t);
  return abs;
}

const oldUnused = put('upload_old_unused.jpg', 10);
const oldQueued = put('upload_old_queued.jpg', 10);
const fresh = put('upload_fresh.jpg', 1);

const removed = pruneMedia({ dir, referenced: [oldQueued], now });
assert.strictEqual(removed, 1);
assert.ok(!fs.existsSync(oldUnused), 'an old upload nobody points at is removed');
assert.ok(fs.existsSync(oldQueued), 'an upload a queued row points at stays');
assert.ok(fs.existsSync(fresh), 'a recent upload stays, so a retry can use it');
assert.strictEqual(pruneMedia({ dir: path.join(dir, 'missing'), now }), 0, 'a missing folder is not an error');
console.log('media-prune.test.js: ok');
