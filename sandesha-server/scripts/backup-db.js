#!/usr/bin/env node
/**
 * Safe copy of sandesha.db (logins, promotion posts) into backups/, keeping
 * the newest 14. Uses SQLite's own backup, so it is fine while Sandesha runs.
 *
 *   node scripts/backup-db.js
 *   # nightly at 3am:  0 3 * * * cd ~/apps/vjn-website/sandesha-server && node scripts/backup-db.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const KEEP = 14;
const source = process.env.SANDESHA_DB_FILE || path.join(__dirname, '..', 'sandesha.db');
const dir = path.join(path.dirname(source), 'backups');

async function main() {
  if (!fs.existsSync(source)) throw new Error(`No database at ${source}`);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const target = path.join(dir, `sandesha-${stamp}.db`);
  const db = new Database(source, { readonly: true });
  await db.backup(target);
  db.close();
  const old = fs.readdirSync(dir).filter((f) => /^sandesha-.*\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  console.log(`Backed up to ${target}${old.length ? ` (removed ${old.length} old)` : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
