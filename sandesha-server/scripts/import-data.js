#!/usr/bin/env node
/**
 * Copy the Sheet's Programs, Volunteering, Site, ProgramTitles, enquiry tabs
 * and EventVolunteers into sandesha.db, keeping their ids — and tell Apps
 * Script the Pi owns them from now on (the Sheet becomes a copy it keeps up to
 * date, and stops taking admin edits).
 *
 * Run it once, right after deploying the matching apps-script.js. Safe to run
 * again: rows already in the database are skipped.
 *
 *   node scripts/import-data.js
 */

require('../auth'); // loads .env
const { openDb } = require('../db');
const { createListings } = require('../listings');
const { createContent } = require('../content');
const { createInquiries } = require('../inquiries');
const { createEventVolunteers } = require('../event-volunteers');

async function main() {
  const url = String(process.env.VJN_APPS_SCRIPT_URL || '').trim();
  const secret = process.env.VJN_AUTH_SECRET || '';
  if (!url || !secret) throw new Error('Set VJN_APPS_SCRIPT_URL and VJN_AUTH_SECRET in .env first.');

  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ formType: 'vjnExportAll', secret }), redirect: 'follow' });
  const data = JSON.parse(await res.text());
  if (data.error) throw new Error(`Apps Script: ${data.error}`);

  const db = openDb();
  const listings = createListings({ db });
  const content = createContent({ db });
  const inquiries = createInquiries({ db });
  const ev = createEventVolunteers({ db, listings });

  const n = (label, got, total) => console.log(`  ${label}: ${got} of ${total}`);
  console.log('Imported:');
  n('programs', listings.importRows('programs', data.programs), (data.programs || []).length);
  n('volunteering', listings.importRows('volunteering', data.volunteering), (data.volunteering || []).length);
  content.importSite(data.site);
  console.log(`  site text: ${(data.site || []).length} entries`);
  content.importTitles(data.programTitles);
  console.log(`  program names: ${(data.programTitles || []).length}`);
  for (const def of inquiries.DEFS) {
    const rows = (data.inquiries || {})[def.key] || [];
    n(def.title, inquiries.importRows(def.key, rows), rows.length);
  }
  n('event volunteers', ev.importRows(data.ev), (data.ev || []).length);
  db.prepare("INSERT INTO kv (key, value) VALUES ('data_on_pi', '1') ON CONFLICT (key) DO UPDATE SET value = '1'").run();
  console.log('The Sheet is now a copy of the database; changes are made in Sandesha.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
