'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-'));
process.env.REACH_FILE = path.join(dir, 'reach.json');
process.env.REACH_MEDIA_DIR = path.join(dir, 'media');
const { openDb } = require('../db');
const reach = require('../reach');

// an old reach.json is carried over once into an empty table, and renamed
fs.writeFileSync(process.env.REACH_FILE, JSON.stringify({ version: 1, messages: { 'm1': { id: 'm1', key: 'K1', sentAt: 1000 } } }));
const db = openDb(path.join(dir, 'r.db'));
reach.init({ db });
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM message_reach').get().n, 1);
assert.ok(fs.existsSync(process.env.REACH_FILE + '.migrated'));
console.log('  ✓ reach: old reach.json carried over into the database');
