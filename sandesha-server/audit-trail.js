'use strict';

/** Who changed what in the admin: one row per successful change (not the contents, so no personal data). */

const KEEP_MS = 365 * 24 * 60 * 60 * 1000;

function createAuditTrail(db) {
  const insert = db.prepare('INSERT INTO admin_audit_log (at, user_id, username, role, action, resource, resource_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let writes = 0;

  function record(session, action, data = {}) {
    try {
      const resource = String(data.resource || data.sheet || data.type || '').slice(0, 60);
      const resourceId = String(data.id || data.eventId || data.rowId || data.row_id || '').slice(0, 80);
      insert.run(Date.now(), String((session && session.id) || ''), String((session && session.username) || ''),
        String((session && session.role) || ''), String(action).slice(0, 60), resource, resourceId);
      if (++writes % 200 === 0) db.prepare('DELETE FROM admin_audit_log WHERE at < ?').run(Date.now() - KEEP_MS);
    } catch { /* the trail must never break a save */ }
  }

  function recent(limit = 100) {
    return db.prepare('SELECT at, username, role, action, resource, resource_id FROM admin_audit_log ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, limit)));
  }

  return { record, recent };
}

module.exports = { createAuditTrail };
