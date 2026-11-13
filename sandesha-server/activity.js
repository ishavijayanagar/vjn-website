/**
 * Server-side activity log.
 *
 * The admin dashboard used to keep its own list in the browser's localStorage,
 * so anything that happened while that page was closed — a scheduled send, a
 * send from the promotions app, an add-members job — never showed up. This is
 * the shared, append-only record those events write to instead.
 *
 * One JSON object per line in activity.jsonl. Rotates itself. Never throws into
 * a caller: recording an event must not break the thing being recorded.
 */
const crypto = require('crypto');

// Tests point this at a temp file so they never write into the live log.
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 20000;
const MAX_META_CHARS = 16000;

/** Known categories — kept in sync with the dashboard filter chips. */
const CATEGORIES = new Set([
  'send', 'schedule', 'members', 'group', 'set', 'contact', 'system', 'auth',
]);

/**
 * Append one event.
 * @param {object}  evt
 * @param {string} [evt.type='ok']      'ok' | 'err' | 'warn' | 'info'
 * @param {string} [evt.category='system']
 * @param {string}  evt.title           short human line
 * @param {string} [evt.detail]         optional second line
 * @param {string} [evt.target]         jid / number / name the event acted on
 * @param {number} [evt.count]          how many recipients / members / etc.
 * @param {boolean}[evt.ok]             explicit success flag (defaults from type)
 * @param {string} [evt.via]            'manual' | 'broadcast' | 'bulk' | 'scheduled' | 'api'
 * @param {string} [evt.corrId]         groups a fan-out into one logical action
 * @param {{role: string, name: string}} [evt.actor]  who started it (team + person)
 * @param {object} [evt.meta]           everything else worth showing when the row is opened:
 *                                      message, per-recipient results, errors, schedule times…
 * @param {boolean}[evt.push]           also fire a Web Push notification (summary events only)
 */
/** The log lives in the database once useDb() is called (the server does); before that, in memory. */
let db = null;
let memory = [];
let writes = 0;

function useDb(handle) { db = handle; }

function store(row) {
  if (!db) {
    memory.push(row);
    if (memory.length > 500) memory = memory.slice(-500);
    return;
  }
  db.prepare('INSERT OR IGNORE INTO activity_log (id, at, category, type, corr_id, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, Date.parse(row.at), row.category, row.type, row.corrId || '', JSON.stringify(row));
  // Keep 90 days and at most MAX_ROWS rows; checked now and then, not on every write.
  if (++writes % 200 === 0) {
    db.prepare('DELETE FROM activity_log WHERE at < ?').run(Date.now() - KEEP_MS);
    db.prepare('DELETE FROM activity_log WHERE at < (SELECT at FROM activity_log ORDER BY at DESC LIMIT 1 OFFSET ?)').run(MAX_ROWS);
  }
}

function recordEvent(evt = {}) {
  try {
    const type = evt.type || (evt.ok === false ? 'err' : 'ok');
    const category = CATEGORIES.has(evt.category) ? evt.category : 'system';
    const row = {
      at: new Date().toISOString(),
      type,
      category,
      title: String(evt.title || '').slice(0, 200),
      detail: evt.detail ? String(evt.detail).slice(0, 500) : '',
      target: evt.target ? String(evt.target) : '',
      count: Number.isFinite(evt.count) ? evt.count : null,
      ok: typeof evt.ok === 'boolean' ? evt.ok : type !== 'err',
      via: evt.via ? String(evt.via) : '',
      corrId: evt.corrId ? String(evt.corrId) : '',
      id: crypto.randomBytes(6).toString('hex'),
      actor: cleanActor(evt.actor),
      meta: capMeta(evt.meta),
    };
    store(row);

    if (evt.push && pushSender) {
      try { pushForEvent(row); } catch { /* push must not break logging */ }
    }
    return row;
  } catch {
    /* logging must never break the caller */
    return null;
  }
}

function cleanActor(actor) {
  if (!actor || typeof actor !== 'object' || !actor.role) return null;
  return {
    role: String(actor.role).slice(0, 30),
    name: String(actor.name || '').slice(0, 80),
  };
}

/**
 * Keep the detail object small enough that one row can't bloat the log:
 * long arrays (per-recipient results) are cut, then the whole thing dropped.
 */
function capMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  let out;
  try {
    out = JSON.parse(JSON.stringify(meta));
  } catch {
    return null;
  }
  if (JSON.stringify(out).length <= MAX_META_CHARS) return out;
  for (const [key, val] of Object.entries(out)) {
    if (Array.isArray(val) && val.length > 100) {
      out[key] = val.slice(0, 100);
      out[`${key}Total`] = val.length;
    } else if (typeof val === 'string' && val.length > 2000) {
      out[key] = `${val.slice(0, 2000)}…`;
    }
  }
  return JSON.stringify(out).length <= MAX_META_CHARS ? out : { truncated: true };
}

const ADMIN_ONLY = new Set(['members', 'group', 'set', 'contact', 'system', 'auth']);
const EMOJI = { ok: '✅', warn: '⚠️', err: '❌', info: '•' };

/**
 * The server wires a real push sender at startup:
 *   activity.setPushSender((audience, payload) => push.notify(audience, payload))
 * Tests never call this, so summary events log without any push side effect.
 */
let pushSender = null;
function setPushSender(fn) {
  pushSender = typeof fn === 'function' ? fn : null;
}

/** Map a summary row → a Web Push payload and hand it to the sender. */
function pushForEvent(row) {
  const audience = ADMIN_ONLY.has(row.category) ? 'admin' : 'all';
  const url = row.category === 'schedule' ? 'admin-promotions.html' : 'admin-messaging.html';
  Promise.resolve(
    pushSender(audience, {
      title: `${EMOJI[row.type] || ''} ${row.title}`.trim(),
      body: row.detail || '',
      tag: `sandesha-${row.category}`,
      url,
      kind: row.category,
      corrId: row.corrId || '',
    }),
  ).catch(() => {});
}

/**
 * Read recent events, newest first.
 * @param {{ limit?: number, sinceIso?: string }} [opts]
 * @returns {Array<object>}
 */
function loadActivity({ limit = 100, sinceIso = '' } = {}) {
  const n = Math.max(1, Math.min(500, limit));
  const sinceTs = sinceIso ? Date.parse(sinceIso) : NaN;
  const since = Number.isNaN(sinceTs) ? 0 : sinceTs;
  try {
    if (!db) {
      return memory.slice().reverse().filter((r) => Date.parse(r.at) >= since).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, n);
    }
    return db.prepare('SELECT data FROM activity_log WHERE at >= ? ORDER BY at DESC, rowid DESC LIMIT ?').all(since, n)
      .map((r) => JSON.parse(r.data));
  } catch {
    return [];
  }
}

module.exports = { CATEGORIES, recordEvent, loadActivity, setPushSender, useDb };
