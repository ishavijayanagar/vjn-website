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
