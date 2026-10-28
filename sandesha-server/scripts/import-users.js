#!/usr/bin/env node
/**
 * Copy VJN admin logins from the Sheet's Users tab into sandesha.db.
 * Ids and password hashes are kept, so everyone signs in as before.
 * Safe to run again: people already in the database are skipped.
 *
 * Needs VJN_APPS_SCRIPT_URL and VJN_AUTH_SECRET in .env, and the same
 * VJN_AUTH_SECRET set as a Script Property in Apps Script.
 *
 *   node scripts/import-users.js
 */

require('../auth'); // loads .env
const { openDb } = require('../db');
const { createVjnUsers } = require('../vjn-users');

async function main() {
  const url = String(process.env.VJN_APPS_SCRIPT_URL || '').trim();
  const secret = process.env.VJN_AUTH_SECRET || '';
  if (!url || !secret) throw new Error('Set VJN_APPS_SCRIPT_URL and VJN_AUTH_SECRET in .env first.');

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ formType: 'vjnExportUsers', secret }),
    redirect: 'follow',
  });
  const data = JSON.parse(await res.text());
  if (data.error) throw new Error(`Apps Script: ${data.error}`);

  const users = createVjnUsers({ db: openDb(), secret });
  const added = users.importUsers(data.users || []);
  console.log(`Imported ${added} of ${(data.users || []).length} logins.`);
  for (const u of users.list()) console.log(`  ${u.status.padEnd(8)} ${u.role.padEnd(10)} ${u.displayName}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
