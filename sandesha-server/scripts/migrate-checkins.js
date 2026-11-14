#!/usr/bin/env node
/**
 * Moves the old `checkins` table into event_vols (marks the volunteer's row checked in, or adds a walk-in),
 * then, with --drop, removes the old table. Safe to re-run: a check-in already marked is left alone.
 * Stop Sandesha first, or run it while it is idle. Back up first (scripts/backup-db.js).
 */

const path = require('path');
const { openDb } = require('../db');
const { createListings } = require('../listings');
const { createEventVolunteers } = require('../event-volunteers');

const db = openDb(process.env.SANDESHA_DB_FILE || path.join(__dirname, '..', 'sandesha.db'));
const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkins'").get();
if (!has) { console.log('No checkins table: nothing to move.'); process.exit(0); }

const listings = createListings({ db, evCounts: () => ({}) });
const evLive = createEventVolunteers({ db, listings });

let marked = 0, added = 0, skipped = 0;
for (const r of db.prepare('SELECT id, data FROM checkins ORDER BY id').all()) {
  const d = JSON.parse(r.data);
  const res = evLive.checkIn({ programId: d['program id'], name: d.name, phone: d.phone, area: d.area, ieCompletion: d['ie completion'], at: d.timestamp });
  if (res.matched) marked++; else if (res.added) added++; else { skipped++; console.log(`  skipped check-in ${r.id}: ${res.error || 'no program id or phone'}`); }
}
console.log(`Moved: ${marked} marked on existing volunteers, ${added} added as walk-ins, ${skipped} skipped.`);
if (process.argv.includes('--drop')) {
  if (skipped) console.log('Not dropping the checkins table: some rows were skipped.');
  else { db.exec('DROP TABLE checkins'); console.log('Dropped the old checkins table.'); }
} else console.log('Old checkins table kept. Re-run with --drop to remove it.');
