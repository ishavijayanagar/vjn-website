'use strict';

/**
 * Enquiries from the public forms (Sheet tabs HomeQueries, ProgramInterest,
 * ProgramVolunteer, VolunteeringInterest, VolunteerAttendance), and what the
 * Nurturing team does with them: status, remarks, invited, added to a group.
 */

const DEFS = [
  { key: 'homeQueries', sheet: 'HomeQueries', title: 'Home queries' },
  { key: 'programInterest', sheet: 'ProgramInterest', title: 'Program interest' },
  { key: 'programVolunteer', sheet: 'ProgramVolunteer', title: 'Program volunteer' },
  { key: 'volunteeringInterest', sheet: 'VolunteeringInterest', title: 'Volunteering interest' },
  { key: 'volunteerAttendance', sheet: 'VolunteerAttendance', title: 'Volunteer attendance' },
];

const TZ_OFFSET_MS = 5.5 * 3600e3;

function statusLabel(raw) {
  const s = String(raw || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
  return s === 'resolved' || s === 'closed' || s === 'done' || s === 'inactive' ? 'Resolved' : 'Open';
}

function createInquiries({ db, onChange = () => {}, now = () => Date.now() }) {
  const q = {
    all: db.prepare('SELECT id, status, data FROM inquiries WHERE sheet = ? ORDER BY id'),
    one: db.prepare('SELECT id, status, data FROM inquiries WHERE sheet = ? AND id = ?'),
    put: db.prepare('INSERT INTO inquiries (sheet, id, status, data) VALUES (?, ?, ?, ?) ON CONFLICT (sheet, id) DO UPDATE SET status = excluded.status, data = excluded.data'),
    maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM inquiries WHERE sheet = ?'),
    tail: db.prepare('SELECT id, status, data FROM inquiries WHERE sheet = ? ORDER BY id DESC LIMIT 8'),
    counts: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END) AS open FROM inquiries WHERE sheet = ?"),
  };

  const stamp = () => new Date(now() + TZ_OFFSET_MS).toISOString().slice(0, 19);
  const defOf = (key) => DEFS.find((d) => d.key === key) || null;

  function toItem(def, row) {
    const data = JSON.parse(row.data);
    return { ...data, id: String(row.id), sheet: def.key, status: statusLabel(row.status) };
  }

  function preview(data) {
    return String(data.query || data['program name'] || data['opportunity name'] || data.area || '');
  }

  function meta() {
    const groups = DEFS.map((def) => {
      const c = q.counts.get(def.key);
      const tail = q.tail.all(def.key)[0];
      let latest = null;
      if (tail) {
        const d = JSON.parse(tail.data);
        latest = { id: String(tail.id), name: String(d.name || ''), preview: preview(d), timestamp: String(d.timestamp || '') };
      }
      return { key: def.key, title: def.title, openCount: c.open || 0, total: c.total || 0, latest, items: [], loaded: false };
    });
    return {
      groups,
      stamp: groups.map((g) => `${g.key}:${g.total}`).join('|'),
      total: groups.reduce((n, g) => n + g.total, 0),
    };
  }

  function group(key) {
    const def = defOf(key);
    if (!def) throw new Error('Unknown inquiry type.');
    const items = q.all.all(def.key).map((r) => toItem(def, r)).reverse();
    return {
      group: {
        key: def.key, title: def.title, items, openCount: items.filter((i) => i.status !== 'Resolved').length,
        total: items.length, loaded: true,
      },
    };
  }

  function nextId(sheet) {
    return q.maxId.get(sheet).n + 1;
  }

  function put(def, id, data) {
    const status = statusLabel(data.status);
    q.put.run(def.key, id, status, JSON.stringify({ ...data, status }));
    onChange(`inquiries:${def.key}`, 'upsert', String(id), { ...data, status });
    return id;
  }

  /** A form submission from a visitor. */
  function submit(formType, data) {
    const ts = String(data.timestamp || new Date(now()).toISOString());
    const text = (v) => String(v === undefined || v === null ? '' : v).trim();
    const base = { timestamp: ts, name: text(data.name), whatsapp: text(data.phone), area: text(data.area), status: 'Open', remarks: '' };
    let key;
    let row;
    if (formType === 'homeQuery') {
      key = 'homeQueries';
      row = { ...base, query: text(data.query), 'in group': '' };
    } else if (formType === 'programInterest') {
      key = 'programInterest';
      const kw = text(data.searchKeyword);
      row = {
        ...base, 'program name': text(data.programName) || kw, 'program id': text(data.programId),
        'search keyword': kw, 'invite sent': '', 'in group': '',
      };
    } else if (formType === 'programVolunteer') {
      key = 'programVolunteer';
      row = {
        ...base, 'program name': text(data.programName), 'program id': text(data.programId), 'in group': '',
        'ie completion': text(data.ieCompletion),
      };
    } else if (formType === 'volunteeringInterest') {
      key = 'volunteeringInterest';
      row = {
        ...base, 'opportunity name': text(data.opportunityName), 'opportunity id': text(data.opportunityId),
        'in group': '', 'ie completion': text(data.ieCompletion), 'volunteer remarks': text(data.remarks).slice(0, 1000),
      };
    } else if (formType === 'volunteerAttendance') {
      key = 'volunteerAttendance';
      row = {
        ...base, 'program name': text(data.programName), 'program id': text(data.programId),
        consent: data.consent ? 'Yes' : 'No', 'in group': '',
      };
    } else {
      throw new Error('Unknown form.');
    }
    const def = defOf(key);
    return { id: put(def, nextId(key), row) };
  }

  function update(data) {
    const def = defOf(data.sheet);
    if (!def) throw new Error('Unknown inquiry type.');
    const id = parseInt(data.id, 10);
    const row = Number.isNaN(id) || id < 1 ? null : q.one.get(def.key, id);
    if (!row) throw new Error('Invalid inquiry id.');
    const rec = JSON.parse(row.data);
    rec.status = statusLabel(data.status);
    rec.remarks = data.remarks === undefined || data.remarks === null ? '' : String(data.remarks);
    let inviteSent;
    if (data.inviteSent !== undefined && 'invite sent' in rec) {
      inviteSent = data.inviteSent ? stamp() : '';
      rec['invite sent'] = inviteSent;
    }
    let inGroup;
    if (data.inGroup !== undefined && 'in group' in rec) {
      inGroup = data.inGroup ? `${String(data.inGroup).trim()} · ${stamp().slice(0, 10)}` : '';
      rec['in group'] = inGroup;
    }
    put(def, id, rec);
    return { success: true, status: rec.status, inviteSent, inGroup };
  }

  function addedToGroup(data) {
    const items = Array.isArray(data && data.items) ? data.items : [];
    const name = String((data && data.group) || '').trim() || 'WhatsApp group';
    const mark = `${name} · ${stamp().slice(0, 10)}`;
    let updated = 0;
    db.transaction(() => {
      for (const it of items) {
        const def = defOf(String((it && it.sheet) || ''));
        const id = parseInt(it && it.id, 10);
        if (!def || Number.isNaN(id)) continue;
        const row = q.one.get(def.key, id);
        if (!row) continue;
        const rec = JSON.parse(row.data);
        rec.status = 'Resolved';
        rec['in group'] = mark;
        put(def, id, rec);
        updated++;
      }
    })();
    return { success: true, updated, inGroup: mark };
  }

  function importRows(key, rows) {
    const def = defOf(key);
    if (!def) throw new Error('Unknown inquiry type.');
    let added = 0;
    db.transaction(() => {
      for (const r of rows || []) {
        const id = Number(r.id);
        if (!id || q.one.get(def.key, id)) continue;
        const { id: _i, sheet: _s, ...rest } = r;
        const data = {};
        for (const [k, v] of Object.entries(rest)) data[k.toLowerCase()] = v === undefined || v === null ? '' : String(v);
        q.put.run(def.key, id, statusLabel(data.status), JSON.stringify({ ...data, status: statusLabel(data.status) }));
        added++;
      }
    })();
    return added;
  }

  /**
   * A row a visitor left in the Sheet while this server was down. Takes it in
   * with a fresh id and returns that id; the Sheet row already holds the data,
   * so it is not copied back.
   */
  function adopt(tbl, data) {
    const def = defOf(String(tbl).replace(/^inquiries:/, ''));
    if (!def) throw new Error('Unknown inquiry type.');
    const rec = {};
    for (const [k, v] of Object.entries(data || {})) rec[k.toLowerCase()] = v === undefined || v === null ? '' : String(v);
    const status = statusLabel(rec.status);
    const id = nextId(def.key);
    q.put.run(def.key, id, status, JSON.stringify({ ...rec, status }));
    return id;
  }

  return { meta, group, submit, update, addedToGroup, importRows, adopt, DEFS };
}

module.exports = { createInquiries, statusLabel, DEFS };
