'use strict';

/**
 * Takes in what visitors submitted while this server could not be reached.
 * The website falls back to Apps Script then, which appends to the Sheet; here
 * those rows are read back, given ids, and acknowledged so they are not read
 * twice.
 */

function createInbox({ inquiries, ev = null, sheetCall, enabled = () => true, log = () => {} }) {
  let busy = null;

  async function drainOnce() {
    if (!enabled()) return 0; // the Sheet is still the record until its data is copied in
    const { rows = [] } = await sheetCall('vjnInboxList', {});
    if (!rows.length) return 0;
    const acks = [];
    for (const r of rows) {
      try {
        const id = r.tbl === 'ev' ? ev.adopt(r.data) : inquiries.adopt(r.tbl, r.data);
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
