'use strict';

const assert = require('assert');
const { openDb } = require('../db');
const { createInquiries } = require('../inquiries');

// Website enquiries live only in the database: nothing is queued for a Sheet, and the old copy hook is gone.
const db = openDb(':memory:');
const inq = createInquiries({ db, now: () => Date.UTC(2026, 9, 31, 20, 0, 0) });
assert.strictEqual(inq.republish, undefined);

inq.submit('volunteeringInterest', { name: 'Asha', phone: '+919845012345', area: 'JP', opportunityName: 'Hall setup', ieCompletion: 'May-2024', timestamp: '2026-10-05T10:00:00.000Z' });
inq.submit('programVolunteer', { name: 'Meena', phone: '+919777777777', programName: 'IE', programId: '4' });
inq.submit('homeQuery', { name: 'X', query: 'hi' });
inq.update({ sheet: 'volunteeringInterest', id: '1', status: 'Resolved', remarks: 'called' });
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM sheet_sync_queue').get().n, 0);
assert.strictEqual(inq.meta().total, 3);

// A row taken in from the fallback tab (a form sent while the Pi was down) is kept in the database, and the Sheet's own
// mangling is undone: a date turned into long text is put back to "May-2021".
const id = inq.adopt('inquiries:programVolunteer', { Name: 'Prakash', Whatsapp: '+919949394839', 'Program ID': '27', 'IE Completion': 'Sat May 01 2021 00:00:00 GMT+0530 (India Standard Time)' });
assert.strictEqual(JSON.parse(db.prepare("SELECT data FROM website_inquiries WHERE sheet = 'programVolunteer' AND id = ?").get(id).data)['ie completion'], 'May-2021');

// a row saved earlier with the long date text is repaired when the server starts
db.prepare("INSERT INTO website_inquiries (sheet, id, status, data) VALUES ('programVolunteer', 9, 'Open', ?)").run(JSON.stringify({ name: 'Old', 'ie completion': 'Tue Mar 01 2022 00:00:00 GMT+0530 (India Standard Time)' }));
createInquiries({ db });
assert.strictEqual(JSON.parse(db.prepare("SELECT data FROM website_inquiries WHERE sheet = 'programVolunteer' AND id = 9").get().data)['ie completion'], 'Mar-2022');
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM sheet_sync_queue').get().n, 0);

console.log('  ✓ website enquiries and event volunteers: nothing is copied to a Sheet');
