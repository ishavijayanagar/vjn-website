'use strict';

/**
 * Takes in what visitors submitted while this server could not be reached.
 * The website falls back to Apps Script then, which parks the row in the Sheet as a
 * temporary buffer (not a record); here those rows are moved into the database, given
 * ids, and acknowledged so they are not read twice. The database is the only record.
 */

function createInbox({ inquiries, ev = null, sheetCall, enabled = () => true, log = () => {} }) {
  let busy = null;

  async function drainOnce() {
    if (!enabled()) return 0; // until the Sheet's data has been moved into the database (scripts/import-data.js), the Sheet is still the record
    const { rows = [] } = await sheetCall('vjnInboxList', {});
    if (!rows.length) return 0;
    const acks = [];
    for (const r of rows) {
      try {
        let id;
        if (r.tbl === 'ev') id = ev.adopt(r.data);
        else if (r.tbl === 'inquiries:volunteerAttendance' || r.tbl === 'volunteerAttendance') {
          // check-ins are kept in event_vols only
          const d = r.data || {};
          const res = ev.checkIn({ programId: d['program id'], name: d.name, phone: d.whatsapp, area: d.area, ieCompletion: d['ie completion'], at: d.timestamp });
          if (res.error) throw new Error(res.error);
          id = 'checked-in';
        } else id = inquiries.adopt(r.tbl, r.data);
        acks.push({ tbl: r.tbl, row: r.row, id });
      } catch (err) {
        log(`[inbox] skipped a row of ${r.tbl}: ${err.message}`);
      }
    }
    if (acks.length) await sheetCall('vjnInboxAck', { acks });
    return acks.length;
  }

  function drain() {
    if (busy) return busy;
    busy = drainOnce()
      .catch((err) => { log(`[inbox] ${err.message}`); return 0; })
      .finally(() => { busy = null; });
    return busy;
  }

  let timer = null;
  function start(everyMs = 5 * 60 * 1000) {
    if (timer) return;
    drain();
    timer = setInterval(drain, everyMs);
    if (timer.unref) timer.unref();
  }

  return { drain, start };
}

module.exports = { createInbox };
