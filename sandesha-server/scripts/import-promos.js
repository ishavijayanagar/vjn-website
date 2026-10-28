#!/usr/bin/env node
/**
 * Copy the Sheet's Promotions tab into sandesha.db, keeping ids, copy,
 * flyers, slots and queue ids — and tell Apps Script the Pi owns promotion
 * posts from now on (the Sheet stops taking promotion writes).
 *
 * Run it once, right after deploying the matching apps-script.js. Safe to run
 * again: posts already in the database are skipped.
 *
 *   node scripts/import-promos.js
 */

require('../auth'); // loads .env
const { openDb } = require('../db');
const { createPromos } = require('../promos');

async function main() {
  const url = String(process.env.VJN_APPS_SCRIPT_URL || '').trim();
  const secret = process.env.VJN_AUTH_SECRET || '';
  if (!url || !secret) throw new Error('Set VJN_APPS_SCRIPT_URL and VJN_AUTH_SECRET in .env first.');

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ formType: 'vjnExportPromos', secret }),
    redirect: 'follow',
  });
  const data = JSON.parse(await res.text());
  if (data.error) throw new Error(`Apps Script: ${data.error}`);

  const promos = createPromos({ db: openDb() });
  const added = promos.importRows(data.promos || []);
  console.log(`Imported ${added} of ${(data.promos || []).length} promotion posts.`);
  console.log('The Sheet no longer takes promotion changes; Sandesha is the record now.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
