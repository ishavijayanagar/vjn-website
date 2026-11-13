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
  // 4 — programs and volunteering listings. Every sheet column lives in the
  // JSON `data` (the Sheet's headers decide the fields); ids are the old row
  // numbers and are never reused (see `counters`).
  `CREATE TABLE listings (
     resource TEXT NOT NULL,
     id INTEGER NOT NULL,
     data TEXT NOT NULL DEFAULT '{}',
     PRIMARY KEY (resource, id)
   )`,
  `CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,
  // 5 — site text and banner (Sheet tab "Site"), and the program-name list
  `CREATE TABLE site_content (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE program_titles (title TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1)`,
  // 6 — enquiries from the website forms (five Sheet tabs, one per `sheet`)
  `CREATE TABLE inquiries (
     sheet TEXT NOT NULL,
     id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'Open',
     data TEXT NOT NULL DEFAULT '{}',
     PRIMARY KEY (sheet, id)
   )`,
  // 7 — Nurturing's event-volunteer pipeline (Sheet tab "EventVolunteers")
  `CREATE TABLE ev_rows (
     row_id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     event_id TEXT NOT NULL DEFAULT '',
     data TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE INDEX ev_rows_event ON ev_rows (event_id, kind)`,
  // 8 — changes still to be copied to the Sheet (the Sheet is the backup)
  `CREATE TABLE sync_queue (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     tbl TEXT NOT NULL,
     op TEXT NOT NULL,
     key TEXT NOT NULL,
     payload TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`,
  // 9 — volunteer check-ins from the public check-in page (Sheet: one tab per month)
  `CREATE TABLE checkins (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     month TEXT NOT NULL,
     data TEXT NOT NULL DEFAULT '{}'
   )`,
  // 10 — clearer table names (purpose is in the name); data untouched
  `ALTER TABLE users RENAME TO team_users;
   ALTER TABLE promos RENAME TO promotions;
   DROP INDEX promos_event;
   CREATE INDEX promotions_event ON promotions (event_type, event_id);
   ALTER TABLE listings RENAME TO event_listings;
   ALTER TABLE counters RENAME TO id_counters;
   ALTER TABLE site_content RENAME TO site_text;
   ALTER TABLE program_titles RENAME TO program_names;
   ALTER TABLE inquiries RENAME TO website_inquiries;
   ALTER TABLE ev_rows RENAME TO event_vols;
   DROP INDEX ev_rows_event;
   CREATE INDEX event_vols_event ON event_vols (event_id, kind);
   ALTER TABLE sync_queue RENAME TO sheet_sync_queue;
   ALTER TABLE kv RENAME TO app_settings`,
  // 11 — final names chosen by the team: promotional_msgs, site_content (unchanged), app_setting
  `ALTER TABLE promotions RENAME TO promotional_msgs;
   DROP INDEX promotions_event;
   CREATE INDEX promotional_msgs_event ON promotional_msgs (event_type, event_id);
   ALTER TABLE site_text RENAME TO site_content;
   ALTER TABLE app_settings RENAME TO app_setting`,
  // 12 — state that lived in loose JSON files: logins, delivered sends, push subscriptions, promo send jobs
  `CREATE TABLE login_sessions (
     token_hash TEXT PRIMARY KEY,
     role TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'password',
     user_json TEXT NOT NULL DEFAULT 'null',
     expires_at INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX login_sessions_expiry ON login_sessions (expires_at);
   CREATE TABLE delivered_sends (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     schedule_id TEXT NOT NULL DEFAULT '',
     source_id TEXT NOT NULL DEFAULT '',
     target TEXT NOT NULL DEFAULT '',
     sent_at INTEGER NOT NULL
   ) STRICT;
   CREATE UNIQUE INDEX delivered_sends_once ON delivered_sends (schedule_id, target);
   CREATE INDEX delivered_sends_time ON delivered_sends (sent_at);
   CREATE TABLE push_subscriptions (
     endpoint TEXT PRIMARY KEY,
     keys_json TEXT NOT NULL DEFAULT '{}',
     role TEXT NOT NULL DEFAULT 'unknown',
     user_id TEXT NOT NULL DEFAULT '',
     ua TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     last_ok_at TEXT NOT NULL
   ) STRICT;
   CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
   CREATE TABLE promo_send_jobs (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL DEFAULT '{}'
   ) STRICT`,
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

let sharedDb = null;
/** The one connection the whole server uses (tests that pass their own file still call openDb). */
function shared() {
  if (!sharedDb) sharedDb = openDb();
  return sharedDb;
}

module.exports = { openDb, shared };
