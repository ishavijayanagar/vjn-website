'use strict';

/**
 * The volunteer roster (Nurturing). It is kept in the database (headers in app_setting 'roster', one row per volunteer in volunteer_roster) and served from
 * there; the Pi refreshes it from the roster Sheet every few minutes, so the page still works
 * when Google is slow or down. Reads never call Google.
 */

const KEY = 'roster';
const EVERY_MS = 10 * 60 * 1000;
const EMPTY = { configured: false, headers: [], rows: [] };

function createRoster({ db, fetchRoster, log = () => {} }) {
  const get = db.prepare('SELECT value FROM app_setting WHERE key = ?');
  const put = db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  let timer = null;

  function read() {
    const row = get.get(KEY);
    if (!row) return { ...EMPTY };
    try {
      const { syncedAt, rows: legacyRows, ...meta } = JSON.parse(row.value);
      const have = db.prepare('SELECT data FROM volunteer_roster ORDER BY pos').all().map((r) => JSON.parse(r.data));
      // An older copy kept the rows inside the setting itself; move them over once.
      if (!have.length && Array.isArray(legacyRows) && legacyRows.length) {
        saveRows(legacyRows);
        return { ...meta, rows: legacyRows };
      }
      return { ...meta, rows: have };
    } catch {
      return { ...EMPTY };
    }
  }

  function saveRows(rows) {
    const ins = db.prepare('INSERT INTO volunteer_roster (pos, data) VALUES (?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM volunteer_roster').run();
      rows.forEach((r, i) => ins.run(i, JSON.stringify(r)));
    })();
  }

  /** Copy the Sheet into the database. Keeps the old copy if the Sheet cannot be reached. */
  async function sync() {
    try {
      const d = await fetchRoster();
      if (!d || d.error) throw new Error((d && d.error) || 'empty reply');
      const configured = d.configured !== false;
      db.transaction(() => {
        saveRows(configured ? d.rows || [] : []);
        const meta = configured ? { configured: true, title: String(d.title || ''), headers: d.headers || [] } : { configured: false, headers: [] };
        put.run(KEY, JSON.stringify({ ...meta, syncedAt: Date.now() }));
      })();
      return true;
    } catch (err) {
      log(`[roster] refresh failed, keeping the saved copy: ${err.message}`);
      return false;
    }
  }

  function start() {
    if (timer) return;
    sync();
    timer = setInterval(sync, EVERY_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { read, sync, start, stop };
}

module.exports = { createRoster };
