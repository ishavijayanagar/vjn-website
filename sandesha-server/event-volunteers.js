'use strict';

/**
 * Nurturing's event-volunteer pipeline (moved from the Sheet's EventVolunteers
 * tab). One table, `kind`: "need" is a program that asked for volunteers
 * (handled state, sign-up form); "volunteer" is one recruited person
 * (attendance, WhatsApp-group flags).
 */

const crypto = require('crypto');

const TZ_OFFSET_MS = 5.5 * 3600e3;

const yes = (raw) => ['yes', 'true', '1', 'y'].includes(String(raw || '').trim().toLowerCase());

/** Digits only when it looks like a dialable number (10–13, not a LID shape). */
function digits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return '';
  if (d.charAt(0) === '1' && d.length !== 11) return '';
  return d;
}

function parseNeeded(raw) {
  const n = parseInt(String(raw || '').replace(/\D/g, ''), 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

function isOpenStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return !s || s === 'open' || s === 'active';
}

function createEventVolunteers({ db, listings, onChange = () => {}, now = () => Date.now() }) {
  const q = {
    all: db.prepare('SELECT row_id, kind, event_id, data FROM ev_rows'),
    byId: db.prepare('SELECT row_id, kind, event_id, data FROM ev_rows WHERE row_id = ?'),
    need: db.prepare("SELECT row_id, kind, event_id, data FROM ev_rows WHERE kind = 'need' AND event_id = ?"),
    vols: db.prepare("SELECT row_id, kind, event_id, data FROM ev_rows WHERE kind = 'volunteer' AND event_id = ?"),
    put: db.prepare('INSERT INTO ev_rows (row_id, kind, event_id, data) VALUES (?, ?, ?, ?) ON CONFLICT (row_id) DO UPDATE SET kind = excluded.kind, event_id = excluded.event_id, data = excluded.data'),
    del: db.prepare('DELETE FROM ev_rows WHERE row_id = ?'),
    counts: db.prepare("SELECT event_id, COUNT(*) AS n FROM ev_rows WHERE kind = 'volunteer' GROUP BY event_id"),
  };

  const stamp = () => new Date(now() + TZ_OFFSET_MS).toISOString().slice(0, 19);
  const parse = (r) => ({ ...JSON.parse(r.data), row_id: r.row_id, kind: r.kind, event_id: r.event_id });

  function write(obj) {
    const { row_id, kind, event_id, ...rest } = obj;
    q.put.run(row_id, kind, String(event_id || ''), JSON.stringify(rest));
    onChange('ev', 'upsert', row_id, obj);
  }

  /** { eventId: number of volunteers added } for the Programs progress line. */
  function counts() {
    const map = {};
    for (const r of q.counts.all()) if (r.event_id) map[r.event_id] = r.n;
    return map;
  }

  function snapshot(eventId) {
    const { item } = listings.get('programs', String(eventId), { includeHidden: true });
    if (!item) return null;
    return {
      title: item.title || '',
      date: item.date || item.startdate || '',
      startdate: item.startdate || '',
      enddate: item.enddate || '',
      status: item.status || '',
      open: isOpenStatus(item.status),
      needed: parseNeeded(item.volunteers_needed),
      wantsVolunteers: yes(item.volunteering_available),
      requirements: item.volunteer_requirements || '',
    };
  }

  function view(r) {
    return {
      rowId: r.row_id,
      name: r.volunteer_name || '',
      phone: r.phone || '',
      remarks: r.volunteer_remarks || '',
      area: r.area_of_stay || '',
      ieCompletion: r.ie_completion || '',
      attended: String(r.attended || '').toLowerCase(),
      inGroup: yes(r.in_wa_group),
      inviteSent: yes(r.invite_sent),
      attendanceAt: r.attendance_at || '',
      addedBy: r.added_by || '',
    };
  }

  function needFor(eventId) {
    const r = q.need.get(String(eventId));
    return r ? parse(r) : null;
  }

  /** Every program that asked for volunteers, joined with Nurturing's tracking. */
  function needs() {
    const programs = listings.list('programs', { includeHidden: true }).items;
    const needByEvent = {};
    const volsByEvent = {};
    for (const raw of q.all.all()) {
      const r = parse(raw);
      if (!r.event_id) continue;
      if (r.kind === 'need') needByEvent[r.event_id] = r;
      else if (r.kind === 'volunteer') (volsByEvent[r.event_id] = volsByEvent[r.event_id] || []).push(r);
    }
    const items = [];
    let unmet = 0;
    let awaitingAttendance = 0;
    for (const p of programs) {
      if (!yes(p.volunteering_available)) continue;
      const id = String(p.id);
      const needed = parseNeeded(p.volunteers_needed);
      const need = needByEvent[id] || null;
      const vols = (volsByEvent[id] || []).map(view).sort((a, b) => a.name.localeCompare(b.name));
      const open = isOpenStatus(p.status);
      const handled = !!(need && yes(need.handled));
      const addedCount = vols.length;
      const allAttendanceDone = vols.length > 0 && vols.every((v) => v.attended === 'yes' || v.attended === 'no');
      if (open && addedCount < needed) unmet++;
      if (!open && handled && vols.some((v) => v.attended === '')) awaitingAttendance++;
      items.push({
        id, title: p.title || '', date: p.date || p.startdate || '', startdate: p.startdate || '',
        enddate: p.enddate || '', slots: p.slots || [], timings: p.timings || '', status: p.status || '', open, needed,
        requirements: p.volunteer_requirements || '', handled,
        handledRemarks: need ? need.handled_remarks || '' : '',
        handledBy: need ? need.handled_by || '' : '',
        handledAt: need ? need.handled_at || '' : '',
        formId: need ? need.volunteer_form_id || '' : '',
        formShortUrl: need ? need.volunteer_form_short_url || '' : '',
        formFields: need ? String(need.volunteer_form_fields || '').split(',').filter(Boolean) : [],
        formTemplateId: need ? need.volunteer_form_template || '' : '',
        volunteers: vols, addedCount, allAttendanceDone,
      });
    }
    items.sort((a, b) => {
      const ra = a.open ? (a.addedCount < a.needed ? 0 : 1) : 2;
      const rb = b.open ? (b.addedCount < b.needed ? 0 : 1) : 2;
      if (ra !== rb) return ra - rb;
      return String(a.startdate || '').localeCompare(String(b.startdate || ''));
    });
    return { items, counts: { unmet, awaitingAttendance } };
  }

  function saveNeed(actor, data) {
    const eventId = String((data && data.eventId) || '').trim();
    if (!eventId) throw new Error('eventId required.');
    const snap = snapshot(eventId);
    if (!snap) throw new Error('Program not found.');
    const need = needFor(eventId) || { row_id: crypto.randomUUID(), kind: 'need', event_id: eventId };
    const t = stamp();
    const handled = yes(data.handled);
    need.event_title = snap.title;
    need.event_date = snap.date;
    need.needed = String(snap.needed);
    need.handled = handled ? 'yes' : 'no';
    need.handled_remarks = data.remarks === undefined || data.remarks === null ? '' : String(data.remarks);
    if (handled) {
      if (!need.handled_at) need.handled_at = t;
      need.handled_by = (actor && actor.username) || need.handled_by || '';
    } else {
      need.handled_at = '';
      need.handled_by = '';
      need.reminded_at = '';
    }
    need.updated_at = t;
    write(need);
    return { success: true };
  }

  function addVolunteer(actor, data) {
    const eventId = String((data && data.eventId) || '').trim();
    const name = String((data && data.name) || '').trim();
    const phone = digits(data && data.phone);
    const area = String((data && data.area) || '').trim();
    const fromForm = String((data && data.addedBy) || '').toLowerCase() === 'google-form';
    if (!eventId) throw new Error('eventId required.');
    if (!name) throw new Error('Volunteer name required.');
    if (!phone) throw new Error('A valid phone number is required.');
    if (!area && !fromForm) throw new Error('Area of stay is required.');

    const t = stamp();
    let need = needFor(eventId);
    // Programs (and anyone else) can add directly — confirm the need row quietly.
    if (!need || !yes(need.handled)) {
      const snap = snapshot(eventId);
      if (!snap) throw new Error('Program not found.');
      if (!need) need = { row_id: crypto.randomUUID(), kind: 'need', event_id: eventId };
      need.event_title = snap.title;
      need.event_date = snap.date;
      need.needed = String(snap.needed);
      need.handled = 'yes';
      need.handled_remarks = need.handled_remarks || '';
      if (!need.handled_at) need.handled_at = t;
      need.handled_by = (actor && actor.username) || need.handled_by || '';
      need.updated_at = t;
      write(need);
    }
    const dup = q.vols.all(eventId).some((r) => digits(parse(r).phone) === phone);
    if (dup) throw new Error("That number is already on this event's list.");
    write({
      row_id: crypto.randomUUID(), kind: 'volunteer', event_id: eventId, event_title: need.event_title || '',
      volunteer_name: name, phone, volunteer_remarks: String((data && data.remarks) || ''), area_of_stay: area,
      ie_completion: String((data && data.ieCompletion) || '').trim(),
      added_by: fromForm ? 'google-form' : (actor && actor.username) || '', attended: '', in_wa_group: 'no',
      invite_sent: 'no', updated_at: t,
    });
    return { success: true };
  }

  function volunteerRow(rowId) {
    const r = q.byId.get(String(rowId || ''));
    return r && r.kind === 'volunteer' ? parse(r) : null;
  }

  function updateVolunteer(data) {
    const row = volunteerRow(data && data.rowId);
    if (!row) throw new Error('Volunteer row not found.');
    const t = stamp();
    if (data.name !== undefined) {
      const nm = String(data.name || '').trim();
      if (nm) row.volunteer_name = nm;
    }
    if (data.phone !== undefined) {
      const p = digits(data.phone);
      if (!p) throw new Error('A valid phone number is required.');
      row.phone = p;
    }
    if (data.remarks !== undefined) row.volunteer_remarks = String(data.remarks || '');
    if (data.area !== undefined) row.area_of_stay = String(data.area || '').trim();
    if (data.attended !== undefined) {
      const a = String(data.attended || '').toLowerCase();
      row.attended = a === 'yes' || a === 'no' ? a : '';
      row.attendance_at = row.attended ? t : '';
    }
    if (data.inGroup !== undefined) row.in_wa_group = yes(data.inGroup) ? 'yes' : 'no';
    if (data.inviteSent !== undefined) row.invite_sent = yes(data.inviteSent) ? 'yes' : 'no';
    row.updated_at = t;
    write(row);
    return { success: true, volunteer: view(row) };
  }

  function deleteVolunteer(data) {
    const row = volunteerRow(data && data.rowId);
    if (!row) throw new Error('Volunteer row not found.');
    q.del.run(row.row_id);
    onChange('ev', 'delete', row.row_id, null);
    return { success: true };
  }

  function markInGroup(data) {
    const ids = (data && data.rowIds) || [];
    const field = data && data.field === 'inviteSent' ? 'invite_sent' : 'in_wa_group';
    let updated = 0;
    db.transaction(() => {
      for (const id of ids) {
        const row = volunteerRow(id);
        if (!row) continue;
        row[field] = 'yes';
        row.updated_at = stamp();
        write(row);
        updated++;
      }
    })();
    return { success: true, updated };
  }

  /** Attendance reminder candidates: handled programs that have finished with unmarked volunteers. */
  function dueAttendanceReminders() {
    const out = [];
    for (const raw of q.all.all()) {
      const need = parse(raw);
      if (need.kind !== 'need' || !yes(need.handled)) continue;
      const vols = q.vols.all(need.event_id).map(parse);
      if (!vols.some((v) => String(v.attended || '') === '')) continue;
      const snap = snapshot(need.event_id);
      if (!snap || snap.open) continue;
      const last = Date.parse(need.reminded_at || '');
      if (!Number.isNaN(last) && now() - last < 20 * 3600e3) continue;
      out.push({ need, title: need.event_title || snap.title || 'An event' });
    }
    return out;
  }

  function markReminded(need) {
    need.reminded_at = stamp();
    need.updated_at = need.reminded_at;
    write(need);
  }

  /** Form details Apps Script hands back after creating or connecting a sign-up form. */
  function setForm(actor, needsIn) {
    let updated = 0;
    for (const n of Array.isArray(needsIn) ? needsIn : []) {
      const eventId = String((n && n.event_id) || '').trim();
      if (!eventId) continue;
      const snap = snapshot(eventId);
      const need = needFor(eventId) || { row_id: crypto.randomUUID(), kind: 'need', event_id: eventId };
      if (snap) {
        need.event_title = snap.title;
        need.event_date = snap.date;
        need.needed = String(snap.needed);
      }
      for (const k of ['volunteer_form_id', 'volunteer_form_short_url', 'volunteer_form_fields', 'volunteer_form_template']) {
        if (n[k] !== undefined) need[k] = String(n[k]);
      }
      need.updated_at = stamp();
      write(need);
      updated++;
    }
    return { success: true, updated };
  }

  /**
   * A row Apps Script wrote while this server was not told (a form response).
   * Takes the Sheet's version; the Sheet row is already right, so it is not
   * copied back. Returns the row id to acknowledge.
   */
  function adopt(data) {
    const rowId = String((data && data.row_id) || '').trim();
    if (!rowId) throw new Error('row_id required.');
    const { row_id, kind, event_id, ...rest } = data;
    const fields = {};
    for (const [k, v] of Object.entries(rest)) if (!k.startsWith('_')) fields[k] = v === undefined || v === null ? '' : String(v);
    q.put.run(rowId, String(kind || 'volunteer'), String(event_id || ''), JSON.stringify(fields));
    return rowId;
  }

  function importRows(rows) {
    let added = 0;
    db.transaction(() => {
      for (const r of rows || []) {
        if (!r.row_id || q.byId.get(String(r.row_id))) continue;
        const { row_id, kind, event_id, ...rest } = r;
        const data = {};
        for (const [k, v] of Object.entries(rest)) if (!k.startsWith('_')) data[k] = v === undefined || v === null ? '' : String(v);
        q.put.run(String(row_id), String(kind), String(event_id || ''), JSON.stringify(data));
        added++;
      }
    })();
    return added;
  }

  return {
    counts, snapshot, needs, needFor, saveNeed, addVolunteer, updateVolunteer, deleteVolunteer, markInGroup,
    dueAttendanceReminders, markReminded, importRows, setForm, adopt, write, digits,
  };
}

module.exports = { createEventVolunteers, digits };
