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
const fs = require('fs');
const path = require('path');

const ACTIVITY_FILE = path.join(__dirname, 'activity.jsonl');
const MAX_BYTES = 512 * 1024;   // ~a few thousand rows before rotation
const READ_TAIL_BYTES = 256 * 1024;

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
 * @param {boolean}[evt.push]           also fire a Web Push notification (summary events only)
 */
function recordEvent(evt = {}) {
  try {
    const type = evt.type || (evt.ok === false ? 'err' : 'ok');
    const category = CATEGORIES.has(evt.category) ? evt.category : 'system';
    const row = {
      at: new Date().toISOString(),
      type,
      category,
      title: String(evt.title || '').slice(0, 200),
      detail: evt.detail ? String(evt.detail).slice(0, 300) : '',
      target: evt.target ? String(evt.target) : '',
      count: Number.isFinite(evt.count) ? evt.count : null,
      ok: typeof evt.ok === 'boolean' ? evt.ok : type !== 'err',
      via: evt.via ? String(evt.via) : '',
      corrId: evt.corrId ? String(evt.corrId) : '',
    };
    if (fs.existsSync(ACTIVITY_FILE) && fs.statSync(ACTIVITY_FILE).size > MAX_BYTES) {
      fs.renameSync(ACTIVITY_FILE, `${ACTIVITY_FILE}.1`);
    }
    fs.appendFileSync(ACTIVITY_FILE, `${JSON.stringify(row)}\n`);

    if (evt.push && pushSender) {
      try { pushForEvent(row); } catch { /* push must not break logging */ }
    }
    return row;
  } catch {
    /* logging must never break the caller */
    return null;
  }
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
  let text = '';
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return [];
    const { size } = fs.statSync(ACTIVITY_FILE);
    const start = Math.max(0, size - READ_TAIL_BYTES);
    const fd = fs.openSync(ACTIVITY_FILE, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }

  const sinceTs = sinceIso ? Date.parse(sinceIso) : NaN;
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      const row = JSON.parse(trimmed);
      if (!row.at) continue;
      if (!Number.isNaN(sinceTs) && Date.parse(row.at) < sinceTs) continue;
      rows.push(row);
    } catch {
      /* skip a torn line */
    }
  }
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rows.slice(0, Math.max(1, Math.min(500, limit)));
}

module.exports = { ACTIVITY_FILE, CATEGORIES, recordEvent, loadActivity, setPushSender };
