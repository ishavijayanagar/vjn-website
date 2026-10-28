#!/usr/bin/env node
/** Size, rows per table and the Sheet-copy backlog of sandesha.db (used by `sandesha db`). */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const file = process.env.SANDESHA_DB_FILE || path.join(__dirname, '..', 'sandesha.db');
if (!fs.existsSync(file)) {
  console.error(`No database at ${file} (it is created the first time Sandesha starts).`);
  process.exit(1);
}
const db = new Database(file, { readonly: true });
console.log(`Database: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
for (const t of tables) {
  console.log(`  ${t.name.padEnd(16)}${db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n} rows`);
}
const q = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS o FROM sync_queue').get();
console.log(`Waiting to be copied to the Sheet: ${q.n}${q.n ? ` (oldest ${new Date(q.o).toISOString()})` : ''}`);
