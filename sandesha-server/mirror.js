'use strict';

/**
 * The Sheet as a backup of the database.
 *
 * Every change made here is queued (sync_queue) and copied to the Sheet in
 * the background through Apps Script's `vjnMirror`. A change that cannot be
 * copied yet stays queued and is retried, so the Pi never waits on Google and
 * nothing is lost while the Sheet is unreachable. If the Pi itself is down,
 * the Sheet holds the last copy and the public pages read from it.
 */

const BATCH = 150;

function createMirror({ db, send, now = () => Date.now(), log = () => {} }) {
  const q = {
    drop: db.prepare('DELETE FROM sync_queue WHERE tbl = ? AND key = ?'),
    add: db.prepare('INSERT INTO sync_queue (tbl, op, key, payload, created_at) VALUES (?, ?, ?, ?, ?)'),
    head: db.prepare('SELECT * FROM sync_queue ORDER BY seq LIMIT ?'),
    del: db.prepare('DELETE FROM sync_queue WHERE seq = ?'),
    fail: db.prepare('UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE seq = ?'),
    count: db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM sync_queue'),
    lastErr: db.prepare("SELECT last_error FROM sync_queue WHERE last_error != '' ORDER BY seq DESC LIMIT 1"),
  };
  let timer = null;
  let running = null;

  /** tbl: programs | volunteering | site | programTitles | inquiries:<key> | ev | promos */
  function enqueue(tbl, op, key, row) {
    db.transaction(() => {
      // Only the latest state of a row matters; keep the queue small.
      q.drop.run(tbl, String(key));
      q.add.run(tbl, op, String(key), JSON.stringify(row || {}), now());
    })();
  }

  async function flushOnce() {
    const rows = q.head.all(BATCH);
    if (!rows.length) return { sent: 0 };
    try {
      await send(rows.map((r) => ({ tbl: r.tbl, op: r.op, key: r.key, row: JSON.parse(r.payload) })));
    } catch (err) {
      const msg = String(err && err.message ? err.message : err).slice(0, 300);
      db.transaction(() => { for (const r of rows) q.fail.run(msg, r.seq); })();
      throw err;
    }
    db.transaction(() => { for (const r of rows) q.del.run(r.seq); })();
    return { sent: rows.length };
  }

  /** Send everything queued, a batch at a time. Never throws; reports instead. */
  function flush() {
    if (running) return running;
    running = (async () => {
      let sent = 0;
      try {
        for (;;) {
          const r = await flushOnce();
          sent += r.sent;
          if (r.sent < BATCH) break;
        }
        return { ok: true, sent };
      } catch (err) {
        log(`[mirror] ${err.message}`);
        return { ok: false, sent, error: err.message };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function stats() {
    const c = q.count.get();
    const e = q.lastErr.get();
    return { pending: c.n, oldest: c.oldest || null, lastError: e ? e.last_error : '' };
  }

  function start(intervalMs = 30000) {
    if (timer) return;
    timer = setInterval(() => { if (stats().pending) flush(); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { enqueue, flush, stats, start, stop };
}

module.exports = { createMirror };
