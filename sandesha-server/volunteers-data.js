'use strict';

/**
 * The volunteers data page: every volunteer record in one list, filtered, exported, or turned into a campaign
 * (a Google Sheet holding only name, phone and IE completion date).
 *
 * A record is one of:
 *   - a volunteer on a program's list (event_vols): "volunteered", or "checked in" once they turned up
 *   - a general volunteering interest entered by the team (vol_interests)
 *   - a website volunteering form (website_inquiries: the volunteering page and the program page)
 * The last two are "interest". Nothing here is stored twice: it is read from those tables each time.
 */

const { VOL_TYPES, AVAILABILITY, PROFESSIONS, CALL_STATUS, normalizeVolType, normalizeAvailability, normalizeProfession, normalizeCallStatus } = require('./vol-interests');

const TZ_OFFSET_MS = 5.5 * 3600e3;
const MAX_ROWS = 5000;

const STAGES = ['interest', 'volunteered', 'checked_in'];
const STAGE_LABEL = { interest: 'Showed interest', volunteered: 'Volunteered', checked_in: 'Checked in' };
const STAGE_RANK = { interest: 1, volunteered: 2, checked_in: 3 };

const SOURCE_LABEL = {
  'google-form': 'Google Form',
  'walk-in': 'Walk-in check-in',
  admin: 'Added by the team',
  'website-volunteering': 'Website: volunteering page',
  'website-program': 'Website: program page',
  manual: 'Added manually',
  paste: 'Pasted list',
  ocr: 'Photo',
  image: 'Photo (AI)',
};

/** The ten digits of an Indian mobile number, or '' when it does not look like one. */
function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : '';
}

/** "2026-11-14 13:02" in IST, from an ISO time (UTC if it has a zone) or an IST one already. */
function istStamp(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/(Z|[+-]\d\d:?\d\d)$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? s : new Date(t + TZ_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
  }
  return s.replace('T', ' ').slice(0, 16);
}

const text = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
const yes = (v) => ['yes', 'true', '1', 'y'].includes(String(v || '').trim().toLowerCase());
const ieYear = (ie) => { const m = String(ie || '').match(/(\d{4})/); return m ? Number(m[1]) : null; };

/** The filters, cleaned. Anything unexpected is dropped so a request can never reach past what the page offers. */
function cleanFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const list = (v, allowed) => (Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => !allowed || allowed.includes(x)).slice(0, 200);
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const pick = (v, allowed) => (allowed.includes(String(v)) ? String(v) : allowed[0]);
  return {
    programs: list(f.programs),
    stages: list(f.stages, STAGES),
    sources: list(f.sources, Object.keys(SOURCE_LABEL)),
    program_from: date(f.program_from), program_to: date(f.program_to),
    added_from: date(f.added_from), added_to: date(f.added_to),
    area: text(f.area).slice(0, 80),
    search: text(f.search).slice(0, 80),
    ie: pick(f.ie, ['any', 'has', 'none']),
    ie_from: Number(f.ie_from) >= 1990 ? Number(f.ie_from) : 0,
    ie_to: Number(f.ie_to) >= 1990 ? Number(f.ie_to) : 0,
    in_group: pick(f.in_group, ['any', 'yes', 'no']),
    attended: pick(f.attended, ['any', 'yes', 'no', 'unmarked']),
    unique: !!f.unique,
    min_checkins: Math.max(0, Math.min(99, Math.floor(Number(f.min_checkins) || 0))),
  };
}

/** Caller names, cleaned: trimmed, no blanks, no repeats (a name twice would double that caller's share), at most 20. */
function cleanCallers(raw) {
  const seen = new Set();
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const name = text(v).slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === 20) break;
  }
  return out;
}

/**
 * Hands the people out to the callers in even blocks, in order. When they do not divide evenly the first callers get
 * one more each (for 7 people and 2 callers: 4 and 3). Returns the caller for each person, and how many each has.
 */
function splitAmong(count, callers) {
  const base = Math.floor(count / callers.length);
  const extra = count % callers.length;
  const sizes = callers.map((c, i) => base + (i < extra ? 1 : 0));
  const per = [];
  callers.forEach((c, i) => { for (let n = 0; n < sizes[i]; n++) per.push(c); });
  return { per, counts: callers.map((name, i) => ({ caller: name, count: sizes[i] })) };
}

function createVolunteersData({ db, listings, sheetCall = null, volInterests = null, now = () => Date.now() }) {
  const q = {
    ev: db.prepare("SELECT row_id, event_id, data FROM event_vols WHERE kind = 'volunteer'"),
    interests: db.prepare('SELECT * FROM vol_interests'),
    web: db.prepare("SELECT sheet, id, data FROM website_inquiries WHERE sheet IN ('volunteeringInterest', 'programVolunteer')"),
    sheetAdd: db.prepare('INSERT INTO vol_campaigns (kind, name, filters, people, sheet_id, sheet_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    sheets: db.prepare('SELECT * FROM vol_campaigns ORDER BY id DESC LIMIT ?'),
    sheet: db.prepare('SELECT * FROM vol_campaigns WHERE id = ?'),
    personAdd: db.prepare('INSERT OR REPLACE INTO vol_campaign_people (campaign_id, phone_key, name, caller, sent) VALUES (?, ?, ?, ?, ?)'),
    people: db.prepare('SELECT * FROM vol_campaign_people WHERE campaign_id = ?'),
    close: db.prepare("UPDATE vol_campaigns SET status = 'closed', closed_at = ?, closed_by = ?, result = ? WHERE id = ?"),
  };
  const stamp = () => new Date(now() + TZ_OFFSET_MS).toISOString().slice(0, 19);

  function programMap() {
    const map = new Map();
    for (const p of listings.list('programs', { includeHidden: true }).items) {
      map.set(String(p.id), { id: String(p.id), title: p.title || '', date: p.startdate || '', status: p.status || '' });
    }
    return map;
  }

  /** Every volunteer record, as one flat list. */
  function records() {
    const programs = programMap();
    const out = [];
    const quiz = { vol_type: '', availability: '', profession: '', skill: '' };
    const base = (r) => ({ ...quiz, ...r, phoneKey: phoneKey(r.phone), phone: phoneKey(r.phone) ? `+91${phoneKey(r.phone)}` : text(r.phone), ie_year: ieYear(r.ie_completion) });

    for (const raw of q.ev.all()) {
      const d = JSON.parse(raw.data);
      const prog = programs.get(String(raw.event_id));
      const checkedIn = !!text(d.checked_in_at);
      out.push(base({
        key: `e${raw.row_id}`, name: text(d.volunteer_name), phone: d.phone, area: text(d.area_of_stay), ie_completion: text(d.ie_completion),
        program_id: String(raw.event_id), program: (prog && prog.title) || text(d.event_title), program_date: (prog && prog.date) || '',
        stage: checkedIn ? 'checked_in' : 'volunteered', source: SOURCE_LABEL[d.source] ? d.source : 'admin',
        in_group: yes(d.in_wa_group), attended: text(d.attended).toLowerCase() === 'yes' ? 'yes' : text(d.attended).toLowerCase() === 'no' ? 'no' : '',
        remarks: text(d.volunteer_remarks), added_at: istStamp(checkedIn ? d.checked_in_at : d.updated_at),
      }));
    }
    for (const r of q.interests.all()) {
      out.push(base({
        key: `i${r.id}`, name: text(r.name), phone: r.whatsapp, area: text(r.area), ie_completion: text(r.ie_completion),
        program_id: '', program: '', program_date: '', stage: 'interest', source: SOURCE_LABEL[r.source] ? r.source : 'manual',
        vol_type: text(r.vol_type), availability: text(r.availability), profession: text(r.profession), skill: text(r.skill),
        in_group: !!text(r.in_group), attended: '', remarks: text(r.volunteer_remarks), added_at: istStamp(r.timestamp),
      }));
    }
    for (const raw of q.web.all()) {
      const d = JSON.parse(raw.data);
      const isProgram = raw.sheet === 'programVolunteer';
      const prog = isProgram ? programs.get(String(d['program id'] || '')) : null;
      out.push(base({
        key: `w${raw.sheet}${raw.id}`, name: text(d.name), phone: d.whatsapp, area: text(d.area), ie_completion: text(d['ie completion']),
        program_id: isProgram ? text(d['program id']) : '', program: isProgram ? (prog && prog.title) || text(d['program name']) : text(d['opportunity name']),
        program_date: (prog && prog.date) || '', stage: 'interest', source: isProgram ? 'website-program' : 'website-volunteering',
        in_group: !!text(d['in group']), attended: '', remarks: text(d['volunteer remarks']), added_at: istStamp(d.timestamp),
      }));
    }
    return out;
  }

  function matches(r, f) {
    if (f.programs.length && !f.programs.includes(r.program_id)) return false;
    if (f.stages.length && !f.stages.includes(r.stage)) return false;
    if (f.sources.length && !f.sources.includes(r.source)) return false;
    if (f.program_from && !(r.program_date && r.program_date >= f.program_from)) return false;
    if (f.program_to && !(r.program_date && r.program_date <= f.program_to)) return false;
    const added = r.added_at.slice(0, 10);
    if (f.added_from && !(added && added >= f.added_from)) return false;
    if (f.added_to && !(added && added <= f.added_to)) return false;
    if (f.area && !r.area.toLowerCase().includes(f.area.toLowerCase())) return false;
    if (f.search) {
      const s = f.search.toLowerCase();
      const digits = s.replace(/\D/g, '');
      if (!r.name.toLowerCase().includes(s) && !(digits.length >= 3 && r.phoneKey.includes(digits))) return false;
    }
    if (f.ie === 'has' && !r.ie_completion) return false;
    if (f.ie === 'none' && r.ie_completion) return false;
    if (f.ie_from && !(r.ie_year && r.ie_year >= f.ie_from)) return false;
    if (f.ie_to && !(r.ie_year && r.ie_year <= f.ie_to)) return false;
    if (f.in_group === 'yes' && !r.in_group) return false;
    if (f.in_group === 'no' && r.in_group) return false;
    if (f.attended === 'yes' && r.attended !== 'yes') return false;
    if (f.attended === 'no' && r.attended !== 'no') return false;
    if (f.attended === 'unmarked' && !(r.stage !== 'interest' && r.attended === '')) return false;
    return true;
  }

  const byRecent = (a, b) => (a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : 0);

  /** The rows a person's filters select. With `unique`, one row per person (their furthest stage, newest first). */
  function query(rawFilters) {
    const f = cleanFilters(rawFilters);
    const everyone = records();
    const hit = everyone.filter((r) => matches(r, f)).sort(byRecent);
    const stageCounts = { interest: 0, volunteered: 0, checked_in: 0 };
    hit.forEach((r) => { stageCounts[r.stage]++; });
    const shape = (r, extra = {}) => ({
      key: r.key, name: r.name, phone: r.phone, area: r.area, ie_completion: r.ie_completion, program: r.program, program_id: r.program_id,
      program_date: r.program_date, stage: r.stage, stage_label: STAGE_LABEL[r.stage], source: r.source, source_label: SOURCE_LABEL[r.source],
      vol_type: r.vol_type, availability: r.availability, profession: r.profession, skill: r.skill,
      in_group: r.in_group ? 'Yes' : 'No', attended: r.attended, remarks: r.remarks, added_at: r.added_at, ...extra,
    });
    let rows;
    let people;
    if (f.unique) {
      const groups = new Map();
      for (const r of hit) {
        const k = r.phoneKey || `n:${r.name.toLowerCase()}:${r.key}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      rows = [];
      for (const g of groups.values()) {
        const check_ins = g.filter((r) => r.stage === 'checked_in').length;
        if (check_ins < f.min_checkins) continue;
        const best = g.slice().sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || byRecent(a, b))[0];
        const programsDone = new Set(g.filter((r) => r.stage !== 'interest' && r.program_id).map((r) => r.program_id));
        // The furthest record may not know everything (a check-in has no profession): take the rest from anything else
        // we hold on this person, newest first, even records the filters left out.
        const filled = { ...best };
        const theirs = best.phoneKey ? everyone.filter((x) => x.phoneKey === best.phoneKey).sort(byRecent) : g;
        for (const f of ['area', 'ie_completion', 'vol_type', 'availability', 'profession', 'skill', 'remarks']) {
          if (!filled[f]) { const other = theirs.find((x) => x[f]); if (other) filled[f] = other[f]; }
        }
        rows.push(shape(filled, { records: g.length, programs_count: programsDone.size, check_ins }));
      }
      rows.sort(byRecent);
      people = rows.length;
    } else {
      rows = hit.filter(() => true).map((r) => shape(r));
      if (f.min_checkins) {
        const counts = new Map();
        hit.forEach((r) => { if (r.stage === 'checked_in' && r.phoneKey) counts.set(r.phoneKey, (counts.get(r.phoneKey) || 0) + 1); });
        rows = rows.filter((r) => (counts.get(phoneKey(r.phone)) || 0) >= f.min_checkins);
      }
      people = new Set(hit.map((r) => r.phoneKey || r.key)).size;
    }
    return { rows: rows.slice(0, MAX_ROWS), total: rows.length, people, truncated: rows.length > MAX_ROWS, by_stage: stageCounts, filters: f };
  }

  /** What the filter controls offer: programs (with how many records each has), sources, areas, IE years. */
  function options() {
    const programs = programMap();
    const all = records();
    const count = new Map();
    for (const r of all) count.set(r.program_id, (count.get(r.program_id) || 0) + 1);
    const progList = [...programs.values()]
      .map((p) => ({ id: p.id, title: p.title, date: p.date, status: p.status, records: count.get(p.id) || 0 }))
      .filter((p) => p.records > 0)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // programs that were removed but still have people on their list
    for (const [id, n] of count) {
      if (id && !programs.has(id)) progList.push({ id, title: all.find((r) => r.program_id === id).program || `Program ${id}`, date: '', status: '', records: n });
    }
    const sources = Object.keys(SOURCE_LABEL).map((k) => ({ key: k, label: SOURCE_LABEL[k], records: all.filter((r) => r.source === k).length })).filter((s) => s.records > 0);
    const areaCount = new Map();
    for (const r of all) if (r.area) areaCount.set(r.area, (areaCount.get(r.area) || 0) + 1);
    const areas = [...areaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([a]) => a);
    const years = all.map((r) => r.ie_year).filter(Boolean);
    return {
      programs: progList, general: { id: '', title: 'General interests', records: count.get('') || 0 },
      stages: STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k] })), sources, areas,
      ie_years: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null, total: all.length,
    };
  }

  const SHEET_COLUMNS = [
    ['Name', 'name'], ['Phone', 'phone'], ['Area', 'area'], ['IE Completion Date', 'ie_completion'], ['Program', 'program'],
    ['Program Date', 'program_date'], ['Stage', 'stage_label'], ['Source', 'source_label'], ['In WhatsApp Group', 'in_group'],
    ['Attended', 'attended'], ['Remarks', 'remarks'], ['Added', 'added_at'],
  ];

  async function makeSheet(session, kind, name, filters, headers, rows, dropdowns = {}, editable = null, snapshot = null) {
    if (!sheetCall) throw Object.assign(new Error('Google Sheets is not connected on the server.'), { status: 503 });
    let made;
    try {
      made = await sheetCall('vjnCreateSheet', { title: name, headers, rows, dropdowns, ...(editable ? { editable } : {}) });
    } catch (err) {
      throw Object.assign(new Error(`The Google Sheet could not be made: ${err.message}`), { status: 502 });
    }
    const id = Number(q.sheetAdd.run(kind, name, JSON.stringify(filters), rows.length, String(made.id || ''), String(made.url || ''), (session && session.username) || '', stamp()).lastInsertRowid);
    if (snapshot) db.transaction(() => { for (const s of snapshot) q.personAdd.run(id, s.key, s.name, s.caller, JSON.stringify(s.sent)); })();
    return { id, kind, name, people: rows.length, sheet_url: made.url, created_at: stamp() };
  }

  /** A campaign: the filtered people (each person once) in a new Google Sheet with only name, phone and IE completion date. */
  async function createCampaign(session, data) {
    const name = text(data && data.name).slice(0, 80);
    if (!name) throw Object.assign(new Error('Give the campaign a name.'), { status: 400 });
    const res = query({ ...(data && data.filters), unique: true });
    const people = res.rows.filter((r) => phoneKey(r.phone));
    if (!people.length) throw Object.assign(new Error('No one with a phone number matches these filters.'), { status: 400 });
    const title = `Campaign: ${name} (${stamp().slice(0, 10)})`;
    // With callers, each person is given to one of them and the sheet gets a Caller Name column.
    const callers = cleanCallers(data && data.callers);
    const headers = ['Name', 'Phone Number', 'IE Completion Date'];
    // After the caller column: what the volunteering quiz asks, then their remarks.
    const more = ['Area of Stay', 'Vol Type', 'Availability', 'Profession', 'Skills', 'Remarks', 'Call Status', 'Call Notes'];
    let rows = people.map((r) => [r.name, r.phone, r.ie_completion]);
    const extras = people.map((r) => [r.area, r.vol_type, r.availability, r.profession, r.skill, r.remarks, '', '']);
    let assignments = [];
    if (callers.length) {
      const split = splitAmong(rows.length, callers);
      headers.push('Caller Name');
      rows = rows.map((row, i) => [...row, split.per[i]]);
      assignments = split.counts;
    }
    headers.push(...more);
    rows = rows.map((row, i) => [...row, ...extras[i]]);
    // Choices in the sheet: the quiz lists, and the callers (so a person can be handed to another caller with a click).
    const dropdowns = { 'Vol Type': VOL_TYPES, Availability: AVAILABILITY, Profession: PROFESSIONS, 'Call Status': CALL_STATUS };
    if (callers.length) dropdowns['Caller Name'] = callers;
    // Callers may only fill these; the rest (names, numbers, headers, rows) is locked.
    const editable = more;
    const ci = headers.indexOf('Caller Name');
    const snapshot = people.map((r, i) => ({
      key: phoneKey(r.phone), name: r.name, caller: ci >= 0 ? rows[i][ci] : '',
      sent: { area: r.area || '', vol_type: r.vol_type || '', availability: r.availability || '', profession: r.profession || '', skill: r.skill || '', volunteer_remarks: r.remarks || '' },
    }));
    const sheet = await makeSheet(session, 'campaign', name, { ...res.filters, callers }, headers, rows, dropdowns, editable, snapshot);
    return { success: true, campaign: sheet, skipped_no_phone: res.rows.length - people.length, title, assignments };
  }

  const CLEAN = { vol_type: normalizeVolType, availability: normalizeAvailability, profession: normalizeProfession };
  const SHEET_FIELDS = { 'Area of Stay': 'area', 'Vol Type': 'vol_type', Availability: 'availability', Profession: 'profession', Skills: 'skill', Remarks: 'volunteer_remarks' };

  /**
   * Close a campaign: read what callers filled in, save it on each person's Interests entry (history in calling_remarks,
   * changed details in the main fields), lock the sheet, and mark the campaign closed.
   */
  async function closeCampaign(session, data) {
    const c = q.sheet.get(Number(data && data.id));
    if (!c) throw Object.assign(new Error('Campaign not found.'), { status: 404 });
    if (c.kind !== 'campaign') throw Object.assign(new Error('Only campaigns can be closed.'), { status: 400 });
    if (c.status === 'closed') throw Object.assign(new Error('This campaign is already closed.'), { status: 409 });
    if (!sheetCall || !volInterests) throw Object.assign(new Error('Google Sheets is not connected on the server.'), { status: 503 });
    let sheet;
    try { sheet = await sheetCall('vjnReadSheet', { id: c.sheet_id }); }
    catch (err) { throw Object.assign(new Error(`The sheet could not be read: ${err.message}`), { status: 502 }); }
    const headers = (sheet && sheet.headers) || [];
    const col = (h) => headers.indexOf(h);
    const iPhone = col('Phone Number');
    if (iPhone < 0) throw Object.assign(new Error('The sheet has no Phone Number column any more, so nothing was saved.'), { status: 409 });
    const sentBy = new Map(q.people.all(c.id).map((p) => [p.phone_key, p]));
    const result = { rows: 0, updated: 0, new_people: 0, call_notes: 0, unmatched: 0, locked: false };
    const work = [];
    for (const row of (sheet.rows || [])) {
      const key = phoneKey(row[iPhone]);
      if (!key) continue;
      result.rows += 1;
      const was = sentBy.get(key);
      if (!was) { result.unmatched += 1; continue; }
      const sent = JSON.parse(was.sent || '{}');
      const changes = {};
      for (const [h, f] of Object.entries(SHEET_FIELDS)) {
        if (col(h) < 0) continue;
        const raw = text(row[col(h)]);
        if (!raw) continue; // a blank cell never erases what we have
        const value = CLEAN[f] ? (CLEAN[f](raw) || raw) : raw;
        if (value !== text(sent[f])) changes[f] = value;
      }
      const status = col('Call Status') >= 0 ? normalizeCallStatus(row[col('Call Status')]) : '';
      const note = col('Call Notes') >= 0 ? text(row[col('Call Notes')]).slice(0, 1000) : '';
      const caller = col('Caller Name') >= 0 ? text(row[col('Caller Name')]) : was.caller;
      if (!status && !note && !Object.keys(changes).length) continue;
      work.push({ phoneKey: key, name: was.name, caller, status, note, changes });
    }
    db.transaction(() => {
      for (const w of work) {
        const out = volInterests.applyCall(session, w, { id: c.id, name: c.name });
        if (out.created) result.new_people += 1;
        result.updated += 1;
        if (w.note) result.call_notes += 1;
      }
    })();
    try { await sheetCall('vjnLockSheet', { id: c.sheet_id }); result.locked = true; } catch { /* closing still counts; the sheet can be locked by hand */ }
    q.close.run(stamp(), (session && session.username) || '', JSON.stringify(result), c.id);
    return { success: true, id: c.id, result };
  }

  /** The filtered table as a Google Sheet, every column. */
  async function exportSheet(session, data) {
    const res = query(data && data.filters);
    if (!res.rows.length) throw Object.assign(new Error('Nothing matches these filters.'), { status: 400 });
    const name = `Volunteers export (${stamp().slice(0, 10)})`;
    const sheet = await makeSheet(session, 'export', name, res.filters, SHEET_COLUMNS.map((c) => c[0]), res.rows.map((r) => SHEET_COLUMNS.map((c) => r[c[1]] === undefined ? '' : String(r[c[1]]))));
    return { success: true, sheet };
  }

  function campaigns(limit = 50) {
    return { items: q.sheets.all(Math.max(1, Math.min(200, Number(limit) || 50))).map((r) => ({ ...r, filters: JSON.parse(r.filters || '{}'), result: JSON.parse(r.result || '{}') })) };
  }

  return { query, options, createCampaign, closeCampaign, exportSheet, campaigns, records, SHEET_COLUMNS };
}

module.exports = { createVolunteersData, cleanFilters, cleanCallers, splitAmong, phoneKey, istStamp, STAGES, SOURCE_LABEL };
