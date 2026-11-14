#!/usr/bin/env node
/** Queues every stored volunteer interest for the Sheet again (monthly tabs). Run once after linking the new sheet. */

const path = require('path');
const { openDb } = require('../db');
const { createMirror } = require('../mirror');

const db = openDb(process.env.SANDESHA_DB_FILE || path.join(__dirname, '..', 'sandesha.db'));
const mirror = createMirror({ db, send: async () => {} });
const forward = (tbl, op, key, row) => mirror.enqueue(tbl, op, key, row);
const { createVolInterests } = require('../vol-interests');
const volInterests = createVolInterests({ db, onChange: forward });
const n = volInterests.republish();
console.log(`Queued ${n} volunteer interest rows. The running Sandesha copies them to the Sheet within about 30 seconds.`);
