'use strict';

/**
 * The volunteer roster (Nurturing). It is kept in the database (kv 'roster') and served from
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
      const { syncedAt, ...rest } = JSON.parse(row.value);
      return rest;
    } catch {
      return { ...EMPTY };
    }
  }

  /** Copy the Sheet into the database. Keeps the old copy if the Sheet cannot be reached. */
  async function sync() {
    try {
      const d = await fetchRoster();
      if (!d || d.error) throw new Error((d && d.error) || 'empty reply');
      const out = d.configured === false
        ? { ...EMPTY }
        : { configured: true, title: String(d.title || ''), headers: d.headers || [], rows: d.rows || [] };
      put.run(KEY, JSON.stringify({ ...out, syncedAt: Date.now() }));
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
