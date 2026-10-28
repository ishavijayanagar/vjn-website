'use strict';

/**
 * Sandesha's SQLite database (sandesha.db).
 *
 * Data the Pi owns lives here instead of in the Google Sheet. Each migration
 * runs once, in order; add new ones to the end, never edit a shipped one.
 */

const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS = [
  // 1 — VJN admin logins (moved from the Sheet's Users tab)
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     display_name TEXT NOT NULL DEFAULT '',
     role TEXT NOT NULL,
     password_salt TEXT NOT NULL DEFAULT '',
     password_hash TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'active',
     created_at TEXT NOT NULL DEFAULT '',
     revoked_before INTEGER NOT NULL DEFAULT 0
   )`,
  // 2 — promotion posts (moved from the Sheet's Promotions tab). event_* are
  // the last-seen copy of the program/volunteering listing the post is for,
  // kept so the board still draws when the Sheet cannot be reached.
  `CREATE TABLE promos (
     id TEXT PRIMARY KEY,
     event_type TEXT NOT NULL DEFAULT 'programs',
     event_id TEXT NOT NULL DEFAULT '',
     event_title TEXT NOT NULL DEFAULT '',
     message TEXT NOT NULL DEFAULT '',
     flyer_url TEXT NOT NULL DEFAULT '',
     send_at TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'pending',
     created_by TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT '',
     sent_at TEXT NOT NULL DEFAULT '',
     sent_by TEXT NOT NULL DEFAULT '',
     target TEXT NOT NULL DEFAULT '',
     wa_schedule_ids TEXT NOT NULL DEFAULT '',
     event_date TEXT NOT NULL DEFAULT '',
     event_location TEXT NOT NULL DEFAULT '',
     event_status TEXT NOT NULL DEFAULT '',
     event_image TEXT NOT NULL DEFAULT '',
     event_open INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX promos_event ON promos (event_type, event_id)`,
];

function openDb(file = process.env.SANDESHA_DB_FILE || path.join(__dirname, 'sandesha.db')) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true });
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

module.exports = { openDb };
