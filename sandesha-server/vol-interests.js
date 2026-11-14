'use strict';

/**
 * General volunteering interests, entered by the team: pasted text, a CSV/TSV file, or a photo read by AI.
 * Everything is previewed first (rows come back with their problems flagged); only what the person
 * confirms is added. The database is the record.
 */

const TZ_OFFSET_MS = 5.5 * 3600e3;
const MAX_ROWS = 500;

const FIELDS = ['name', 'whatsapp', 'area', 'ie_completion', 'vol_type', 'availability', 'profession', 'skill', 'volunteer_remarks'];

// The lists the dropdowns offer (Profession is the volunteering quiz's step 3).
const VOL_TYPES = ['In-Person Volunteering', 'Online Volunteering', 'Both'];
const AVAILABILITY = ['Weekdays', 'Weekends', 'Both'];
const PROFESSIONS = ['Student', 'IT / Tech / Design', 'Teacher / Educator', 'Business / Management', 'Homemaker', 'Retired', 'Other'];
const CALL_STATUS = ['Reached', 'Not reachable', 'Call back', 'Not interested'];
// Order assumed when the first row is not a header. The fifth column used to be "interested in"; it is read and dropped so older sheets still line up.
const POSITIONAL = ['name', 'whatsapp', 'area', 'ie_completion', '_skip', 'volunteer_remarks'];

const HEADER_WORDS = {
  name: ['name', 'full name', 'volunteer name', 'participant', 'participant name'],
  whatsapp: ['whatsapp', 'whatsapp number', 'phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number', 'number'],
  area: ['area', 'area of stay', 'location', 'locality', 'place'],
  ie_completion: ['ie completion', 'ie', 'ie completed', 'inner engineering', 'inner engineering completion'],
  vol_type: ['vol type', 'volunteering type', 'type of volunteering', 'mode'],
  availability: ['availability', 'available', 'available on'],
  profession: ['profession', 'occupation', 'work', 'work experience'],
  skill: ['skill', 'skills'],
  volunteer_remarks: ['remarks', 'volunteer remarks', 'notes', 'note', 'comment', 'comments'],
};
const HEADER_LOOKUP = new Map();
for (const [field, words] of Object.entries(HEADER_WORDS)) for (const w of words) HEADER_LOOKUP.set(w, field);

const text = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();

/** "online", "In person" -> the dropdown value; anything else is kept as written. */
function normalizeVolType(raw) {
  const s = text(raw).toLowerCase();
  if (!s) return '';
  const online = /online|remote|virtual/.test(s);
  const person = /person|on.?site|offline|physical/.test(s);
  if (/both|either|hybrid|any|all/.test(s) || (online && person)) return VOL_TYPES[2];
  if (online) return VOL_TYPES[1];
  if (person) return VOL_TYPES[0];
  return text(raw);
}

function normalizeAvailability(raw) {
  const s = text(raw).toLowerCase();
  if (!s) return '';
  const days = /weekday|week day|mon|tue|wed|thu|fri/.test(s);
  const ends = /weekend|week end|sat|sun/.test(s);
  if (/both|all|any|every/.test(s) || (days && ends)) return AVAILABILITY[2];
  if (days) return AVAILABILITY[0];
  if (ends) return AVAILABILITY[1];
  return text(raw);
}

function normalizeProfession(raw) {
  const s = text(raw).toLowerCase();
  if (!s) return '';
  const exact = PROFESSIONS.find((p) => p.toLowerCase() === s);
  if (exact) return exact;
  if (/student|study/.test(s)) return PROFESSIONS[0];
  if (/\bit\b|tech|software|design|develop|engineer|computer/.test(s)) return PROFESSIONS[1];
  if (/teach|educat|professor|lecturer|tutor/.test(s)) return PROFESSIONS[2];
  if (/business|manage|entrepreneur|self.?employed|owner/.test(s)) return PROFESSIONS[3];
  if (/home.?maker|housewife|house wife|home maker/.test(s)) return PROFESSIONS[4];
  if (/retire|pension/.test(s)) return PROFESSIONS[5];
  return text(raw);
}

/** "reached", "not reachable", "call back"… -> the dropdown value; anything else is kept as written. */
function normalizeCallStatus(raw) {
  const s = text(raw).toLowerCase();
  if (!s) return '';
  const exact = CALL_STATUS.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  if (/not.*(reach|answer|pick|connect)|unreach|no answer|switched off/.test(s)) return CALL_STATUS[1];
  if (/call.*back|callback|later|busy/.test(s)) return CALL_STATUS[2];
  if (/not.*interest|declin|no thanks|refus/.test(s)) return CALL_STATUS[3];
  if (/reach|spoke|talked|answer|connect|done/.test(s)) return CALL_STATUS[0];
  return text(raw);
}

/** +91XXXXXXXXXX for a valid Indian mobile number, or '' when it does not look like one. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : '';
}

/** Splits one line into cells, honouring "quoted, values". */
function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function pickDelimiter(lines) {
  const sample = lines.slice(0, 5).join('\n');
  const counts = { '\t': (sample.match(/\t/g) || []).length, '|': (sample.match(/\|/g) || []).length, ',': (sample.match(/,/g) || []).length, ';': (sample.match(/;/g) || []).length };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0) return best[0];
  // OCR text often separates columns with runs of spaces.
  const spaced = lines.slice(0, 5).filter((l) => /\S\s{2,}\S/.test(l)).length;
  return spaced >= Math.ceil(Math.min(lines.length, 5) / 2) ? 'spaces' : '';
}

/** Pasted text or file contents -> rows of { name, whatsapp, ... } (not yet checked). */
function parseText(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delim = pickDelimiter(lines);
  const grid = lines.map((l) => (delim === 'spaces' ? l.split(/\s{2,}/).map((c) => c.trim()) : delim ? splitLine(l, delim) : [l]));
  let map = POSITIONAL;
  const first = grid[0].map((c) => HEADER_LOOKUP.get(c.toLowerCase().replace(/[^a-z ]/g, '').trim()));
  if (first.filter(Boolean).length >= 2) {
    map = first;
    grid.shift();
  }
  return grid.slice(0, MAX_ROWS).map((cells) => {
    const row = {};
    cells.forEach((c, i) => {
      const f = map[i];
      if (f && !row[f]) row[f] = c;
    });
    // One column only (a name and a number run together): pull the number out.
    if (!delim && !row.whatsapp) {
      const m = (row.name || '').match(/(\+?\d[\d\s-]{8,}\d)/);
      if (m) { row.whatsapp = m[1]; row.name = row.name.replace(m[1], '').replace(/[\s,\-:]+$/g, '').trim(); }
    }
    return row;
  });
}

function createVolInterests({ db, extractImage = null, onChange = () => {}, now = () => Date.now() }) {
  const q = {
    insert: db.prepare(`INSERT INTO vol_interests
      (timestamp, name, whatsapp, area, ie_completion, vol_type, availability, profession, skill, volunteer_remarks, status, source, added_by, created_at)
      VALUES (@timestamp, @name, @whatsapp, @area, @ie_completion, @vol_type, @availability, @profession, @skill, @volunteer_remarks, 'Open', @source, @added_by, @created_at)`),
    has: db.prepare('SELECT 1 FROM vol_interests WHERE whatsapp = ? LIMIT 1'),
    list: db.prepare('SELECT * FROM vol_interests ORDER BY id DESC LIMIT ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM vol_interests'),
    flag: db.prepare("SELECT value FROM app_setting WHERE key = 'vol_interests_ai'"),
    setFlag: db.prepare("INSERT INTO app_setting (key, value) VALUES ('vol_interests_ai', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
  };
  const stamp = () => new Date(now() + TZ_OFFSET_MS).toISOString().slice(0, 19);

  const SOURCE_LABEL = { manual: 'Added manually', paste: 'Pasted list', ocr: 'Photo', image: 'Photo (AI)', campaign: 'Campaign call' };
  const FIELD_LABEL = { area: 'Area', vol_type: 'Vol type', availability: 'Availability', profession: 'Profession', skill: 'Skills', volunteer_remarks: 'Remarks' };

  /** "2026-11-14 13:02 asha: asked to call back" per call, newest last. */
  function callsText(raw) {
    let calls = [];
    try { calls = JSON.parse(raw || '[]'); } catch { /* none */ }
    return (Array.isArray(calls) ? calls : []).map((c) => {
      const changed = Object.entries(c.changes || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${v}`).join(', ');
      const said = [c.status, c.note].filter(Boolean).join(' - ');
      return [String(c.at || '').replace('T', ' ').slice(0, 16), c.by ? `${c.by}:` : '', said, changed ? `(${changed})` : ''].filter(Boolean).join(' ');
    }).join('\n');
  }

  /** Only these go to the Sheet: name, number, IE date, source, volunteer remarks, calling remarks (the month picks the tab). */
  function sheetRow(r) {
    return {
      month: String(r.timestamp || '').slice(0, 7), name: r.name, 'whatsapp number': r.whatsapp, 'ie completion date': r.ie_completion,
      source: SOURCE_LABEL[r.source] || r.source, 'volunteer remarks': r.volunteer_remarks, 'calling remarks': callsText(r.calling_remarks),
    };
  }
  const byId = db.prepare('SELECT * FROM vol_interests WHERE id = ?');

  /** Cleans rows and flags what is wrong with each one. Nothing is saved. */
  function check(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map((r) => {
      const row = {};
      for (const f of FIELDS) row[f] = text(r && r[f]).slice(0, f === 'volunteer_remarks' ? 1000 : 200);
      row.vol_type = normalizeVolType(row.vol_type);
      row.availability = normalizeAvailability(row.availability);
      row.profession = normalizeProfession(row.profession);
      const phone = normalizePhone(row.whatsapp);
      const issues = [];
      if (!row.name) issues.push('Name is missing');
      if (!phone) issues.push('Phone number does not look right');
      else row.whatsapp = phone;
      let duplicate = false;
      if (phone) {
        if (seen.has(phone)) { duplicate = true; issues.push('Repeated in this upload'); } else if (q.has.get(phone)) {
          duplicate = true; issues.push('Already in the list');
        }
        seen.add(phone);
      }
      // A repeat is a warning the person can override; a missing name or number cannot be saved.
      return { ...row, issues, duplicate, blocked: !row.name || !phone };
    });
  }

  function preview(data) {
    // `rows` re-checks what the person edited in the preview; `text` is a fresh paste or file.
    const rows = check(data && Array.isArray(data.rows) ? data.rows : parseText(data && data.text));
    if (!rows.length) throw Object.assign(new Error('Nothing to read. Paste some rows or upload a file.'), { status: 400 });
    return { rows };
  }

  /** AI photo reading is off until an admin switches it on (and only works when a key is set up). */
  function config() {
    const row = q.flag.get();
    return { aiConfigured: !!extractImage, aiEnabled: !!(row && row.value === '1') };
  }

  function setAi(on) {
    q.setFlag.run(on ? '1' : '0');
    return { success: true, ...config() };
  }

  async function previewImage(data) {
    if (!config().aiEnabled) throw Object.assign(new Error('AI photo reading is switched off. Use "Read on this device", or ask an admin to switch it on.'), { status: 403 });
    if (!extractImage) throw Object.assign(new Error('Reading images is not set up on the server yet.'), { status: 503 });
    const found = await extractImage({ base64: data && data.base64, mimeType: data && data.mimeType });
    const rows = check(found);
    if (!rows.length) throw Object.assign(new Error('No volunteer details were found in that image.'), { status: 422 });
    return { rows };
  }

  /** Saves the rows the person confirmed. Rows are checked again here, so a bad row never gets in. */
  function add(session, data) {
    const source = ['paste', 'file', 'ocr', 'image', 'manual'].includes(String(data && data.source)) ? data.source : 'paste';
    const allowDuplicates = !!(data && data.allowDuplicates);
    const checked = check(data && data.rows);
    if (!checked.length) throw Object.assign(new Error('Nothing to add.'), { status: 400 });
    let added = 0;
    const skipped = [];
    db.transaction(() => {
      checked.forEach((r, i) => {
        if (r.blocked || (r.duplicate && !allowDuplicates)) { skipped.push({ row: i + 1, name: r.name, reason: r.issues.join('; ') }); return; }
        const id = Number(q.insert.run({
          timestamp: stamp(), name: r.name, whatsapp: r.whatsapp, area: r.area, ie_completion: r.ie_completion,
          vol_type: r.vol_type, availability: r.availability, profession: r.profession, skill: r.skill, volunteer_remarks: r.volunteer_remarks,
          source, added_by: (session && session.username) || '', created_at: now(),
        }).lastInsertRowid);
        onChange('volInterests', 'upsert', `i${id}`, sheetRow(byId.get(id)));
        added++;
      });
    })();
    return { success: true, added, skipped };
  }

  function list(limit = 200) {
    const items = q.list.all(Math.max(1, Math.min(500, Number(limit) || 200))).map((r) => {
      let calls = [];
      try { calls = JSON.parse(r.calling_remarks || '[]'); } catch { /* keep an empty list */ }
      return { ...r, calling_remarks: Array.isArray(calls) ? calls : [] };
    });
    return { items, total: q.count.get().n };
  }

  /**
   * What a caller found out about a person, when a campaign is closed: the changed details are saved on the person's
   * entry (one is made if they have none), and the call itself is added to the history in calling_remarks.
   */
  function applyCall(session, person, campaign) {
    const phone = `+91${person.phoneKey}`;
    let row = db.prepare('SELECT * FROM vol_interests WHERE whatsapp = ? ORDER BY id DESC LIMIT 1').get(phone);
    let created = false;
    if (!row) {
      const id = Number(q.insert.run({
        timestamp: stamp(), name: text(person.name) || phone, whatsapp: phone, area: '', ie_completion: '', vol_type: '', availability: '', profession: '', skill: '',
        volunteer_remarks: '', source: 'campaign', added_by: (session && session.username) || '', created_at: now(),
      }).lastInsertRowid);
      row = byId.get(id);
      created = true;
    }
    const changes = person.changes || {};
    for (const f of Object.keys(changes)) {
      if (!Object.prototype.hasOwnProperty.call(FIELD_LABEL, f)) continue; // only the details callers may change
      db.prepare(`UPDATE vol_interests SET ${f} = ? WHERE id = ?`).run(text(changes[f]).slice(0, f === 'volunteer_remarks' ? 1000 : 200), row.id);
    }
    if (person.status || person.note || Object.keys(changes).length) {
      let history = [];
      try { history = JSON.parse(row.calling_remarks || '[]'); } catch { /* start a new list */ }
      if (!Array.isArray(history)) history = [];
      const entry = { at: stamp(), campaign_id: campaign.id, campaign: campaign.name };
      if (person.caller) entry.by = person.caller;
      if (person.status) entry.status = person.status;
      if (person.note) entry.note = person.note;
      if (Object.keys(changes).length) entry.changes = changes;
      history.push(entry);
      db.prepare('UPDATE vol_interests SET calling_remarks = ? WHERE id = ?').run(JSON.stringify(history), row.id);
    }
    onChange('volInterests', 'upsert', `i${row.id}`, sheetRow(byId.get(row.id)));
    return { id: row.id, created };
  }

  /** Queue every stored row for the Sheet again. */
  function republish() {
    const rows = db.prepare('SELECT * FROM vol_interests ORDER BY id').all();
    for (const r of rows) onChange('volInterests', 'upsert', `i${r.id}`, sheetRow(r));
    return rows.length;
  }

  return { preview, previewImage, add, list, check, config, setAi, republish, applyCall };
}

module.exports = { createVolInterests, parseText, normalizePhone, normalizeVolType, normalizeAvailability, normalizeProfession, normalizeCallStatus, FIELDS, VOL_TYPES, AVAILABILITY, PROFESSIONS, CALL_STATUS };
