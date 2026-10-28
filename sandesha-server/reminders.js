'use strict';

/**
 * Web-push reminders that Apps Script triggers used to send, now run here
 * against the database:
 *   - Nurturing: "mark volunteer attendance", once a programme with unmarked
 *     volunteers has finished (at most every 20 hours per programme)
 *   - Programs team: "Program in 2 days", once per programme
 */

const TZ_OFFSET_MS = 5.5 * 3600e3;

function createReminders({ db, ev, listings, notify, now = () => Date.now(), log = () => {} }) {
  const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const kvPut = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');

  async function attendance() {
    for (const { need, title } of ev.dueAttendanceReminders()) {
      try {
        await notify('nurturing', {
          title: 'Mark volunteer attendance',
          body: `"${title}" has finished — mark who came`,
          url: 'admin.html#volunteering',
          tag: `vjn-attendance-${need.event_id}`,
          kind: 'internal',
        });
        ev.markReminded(need);
      } catch (err) {
        log(`[reminders] attendance push failed: ${err.message}`);
      }
    }
  }

  async function upcoming() {
    const target = new Date(now() + TZ_OFFSET_MS + 2 * 86400e3).toISOString().slice(0, 10);
    const todays = listings.list('programs', { includeHidden: true }).items.filter((p) => {
      const s = String(p.status || '').trim().toLowerCase();
      return (!s || s === 'open' || s === 'active') && String(p.startdate || '') === target;
    });
    if (!todays.length) return;
    let sent = {};
    try {
      const row = kvGet.get('remind2d_sent');
      sent = row ? JSON.parse(row.value) : {};
    } catch {
      sent = {};
    }
    let changed = false;
    for (const p of todays) {
      if (sent[p.id] === target) continue;
      const first = String(p.timings || '').split('\n')[0];
      try {
        await notify('programs', {
          title: 'Program in 2 days',
          body: first ? `"${p.title}" is happening in 2 days — ${first}` : `"${p.title || 'A program'}" is happening in 2 days`,
          url: 'admin.html#events',
          tag: `vjn-program-2d-${p.id}`,
          kind: 'internal',
        });
        sent[p.id] = target;
        changed = true;
      } catch (err) {
        log(`[reminders] programme push failed for ${p.id}: ${err.message}`);
      }
    }
    if (changed) {
      const cutoff = new Date(now() + TZ_OFFSET_MS - 14 * 86400e3).toISOString().slice(0, 10);
      for (const id of Object.keys(sent)) if (sent[id] < cutoff) delete sent[id];
      kvPut.run('remind2d_sent', JSON.stringify(sent));
    }
  }

  async function tick() {
    await attendance();
    await upcoming();
  }

  let timer = null;
  function start(everyMs = 30 * 60 * 1000) {
    if (timer) return;
    timer = setInterval(() => { tick().catch((e) => log(`[reminders] ${e.message}`)); }, everyMs);
    if (timer.unref) timer.unref();
  }

  return { tick, attendance, upcoming, start };
}

module.exports = { createReminders };
