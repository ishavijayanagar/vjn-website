'use strict';

/**
 * Programs and volunteering listings, owned by the Pi (moved from the Sheet's
 * Programs and Volunteering tabs). Same fields, same rules as apps-script.js:
 * the Sheet's headers are the field names, dates are kept as "yyyy-MM-dd" and
 * times as "HH:mm" (Asia/Kolkata), and a listing closes itself once its first
 * slot has started.
 */

const PROGRAM_HEADERS = [
  'title', 'description', 'startdate', 'enddate', 'starttime', 'endtime', 'starttime2', 'endtime2', 'starttime3',
  'endtime3', 'slotlabel', 'slotlabel2', 'slotlabel3', 'timings', 'location', 'duration', 'frequency', 'language',
  'image', 'flyer_image', 'registerlink', 'free_offering', 'volunteering_available', 'volunteers_needed',
  'volunteer_requirements', 'status',
];
const VOLUNTEER_HEADERS = [
  'title', 'description', 'startdate', 'enddate', 'starttime', 'endtime', 'starttime2', 'endtime2', 'starttime3',
  'endtime3', 'slotlabel', 'slotlabel2', 'slotlabel3', 'timings', 'location', 'duration', 'image', 'status',
];
const HEADERS = { programs: PROGRAM_HEADERS, volunteering: VOLUNTEER_HEADERS };

// Older sheets spell some headers with spaces.
const ALIASES = {
  registerlink: ['register link', 'registerLink'],
  free_offering: ['free offering', 'freeoffering'],
  startdate: ['start date', 'startDate'],
  enddate: ['end date', 'endDate'],
  starttime: ['start time', 'startTime'],
  endtime: ['end time', 'endTime'],
  starttime2: ['start time 2', 'startTime2'],
  endtime2: ['end time 2', 'endTime2'],
  starttime3: ['start time 3', 'startTime3'],
  endtime3: ['end time 3', 'endTime3'],
  slotlabel: ['slot label'],
  slotlabel2: ['slot label 2'],
  slotlabel3: ['slot label 3'],
  status: ['program status', 'listing status'],
  volunteers_needed: ['volunteersneeded'],
  volunteering_available: ['volunteeringavailable'],
};

const TZ_OFFSET_MS = 5.5 * 3600e3;

function kolkataParts(ms) {
  const iso = new Date(ms + TZ_OFFSET_MS).toISOString();
  return { ymd: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

function clean(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
}

function toYmd(value) {
  const s = clean(value);
  if (!s) return '';
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? '' : new Date(parsed + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function toHm(value) {
  const s = clean(value);
  if (!s) return '';
  const iso = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (iso) return `${pad2(Math.min(23, +iso[1]))}:${pad2(Math.min(59, +iso[2]))}`;
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = +ampm[1] % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    return `${pad2(h)}:${pad2(ampm[2] ? +ampm[2] : 0)}`;
  }
  return '';
}

function formatHmAmPm(hm) {
  const t = toHm(hm);
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = +h % 12 || 12;
  return `${hh}:${m} ${+h >= 12 ? 'PM' : 'AM'}`;
}

function formatSlotLine(label, start, end) {
  const a = formatHmAmPm(start);
  const b = formatHmAmPm(end);
  const range = a && b ? `${a} – ${b}` : a || b || '';
  const name = clean(label);
  return name && range ? `${name} ${range}` : name || range;
}

/** First "9 AM – 10:30 AM"-style pair found in free text. */
function parseFirstSlot(raw) {
  const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi;
  const times = [];
  let m;
  while ((m = re.exec(String(raw || ''))) && times.length < 2) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (!ap && h > 23) continue;
    times.push(`${pad2(h)}:${pad2(min)}`);
  }
  return times.length ? { start: times[0], end: times[1] || '' } : null;
}

function isClosedStatus(raw) {
  const s = clean(raw).toLowerCase().replace(/\s+/g, ' ');
  return s === 'closed' || s === 'inactive';
}

/** Rename legacy headers and keep only text values. */
function canonical(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = String(k).trim().toLowerCase();
    let name = key;
    for (const [canon, alts] of Object.entries(ALIASES)) {
      if (alts.some((a) => a.toLowerCase() === key)) name = canon;
    }
    if (out[name] === undefined || clean(out[name]) === '') out[name] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

function createListings({ db, evCounts = () => ({}), onChange = () => {}, now = () => Date.now() }) {
  const q = {
    all: db.prepare('SELECT id, data FROM listings WHERE resource = ? ORDER BY id'),
    one: db.prepare('SELECT id, data FROM listings WHERE resource = ? AND id = ?'),
    put: db.prepare('INSERT INTO listings (resource, id, data) VALUES (?, ?, ?) ON CONFLICT (resource, id) DO UPDATE SET data = excluded.data'),
    del: db.prepare('DELETE FROM listings WHERE resource = ? AND id = ?'),
    counter: db.prepare('SELECT value FROM counters WHERE name = ?'),
    setCounter: db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = MAX(value, excluded.value)'),
    maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM listings WHERE resource = ?'),
  };

  function nextId(resource) {
    const name = `listing:${resource}`;
    const last = Math.max((q.counter.get(name) || { value: 0 }).value, q.maxId.get(resource).n);
    q.setCounter.run(name, last + 1);
    return last + 1;
  }

  function resourceOf(r) {
    if (r !== 'programs' && r !== 'volunteering') throw new Error('Unknown resource. Use programs or volunteering.');
    return r;
  }

  function startOf(item) {
    return clean(item.startdate) || clean(item.date);
  }

  function startTimeOf(item) {
    const hm = toHm(item.starttime);
    if (hm) return hm;
    const slot = parseFirstSlot(item.timings);
    return slot && slot.start ? slot.start : '';
  }

  function isPastStart(item) {
    const ymd = toYmd(startOf(item));
    if (!ymd) return false;
    const t = kolkataParts(now());
    if (t.ymd > ymd) return true;
    if (t.ymd < ymd) return false;
    return t.hm >= (startTimeOf(item) || '00:00');
  }

  /** Dates, slots and the one-line timings, as the pages draw them. */
  function enrich(item) {
    const out = { ...item };
    const startYmd = toYmd(startOf(item));
    const endYmd = toYmd(clean(item.enddate) || clean(item.date));
    if (startYmd) out.startdate = startYmd;
    if (endYmd) out.enddate = endYmd;
    out.date = startYmd && endYmd && startYmd !== endYmd ? `${startYmd} – ${endYmd}` : endYmd || startYmd || '';

    const st1 = toHm(item.starttime) || startTimeOf(item);
    const et1 = toHm(item.endtime);
    if (!st1 && !et1 && item.timings) {
      const parsed = parseFirstSlot(item.timings);
      if (parsed) {
        if (parsed.start) out.starttime = parsed.start;
        if (parsed.end) out.endtime = parsed.end;
      }
    } else {
      if (st1) out.starttime = st1;
      if (et1) out.endtime = et1;
    }
    for (const k of ['starttime2', 'endtime2', 'starttime3', 'endtime3']) {
      const hm = toHm(item[k]);
      if (hm) out[k] = hm;
    }
    const labels = [clean(item.slotlabel), clean(item.slotlabel2), clean(item.slotlabel3)];
    if (labels[0]) out.slotlabel = labels[0];
    if (labels[1]) out.slotlabel2 = labels[1];
    if (labels[2]) out.slotlabel3 = labels[2];

    const slots = [];
    if (out.starttime) slots.push({ label: labels[0], start: out.starttime, end: out.endtime || '' });
    if (out.starttime2 && out.endtime2) slots.push({ label: labels[1], start: out.starttime2, end: out.endtime2 });
    if (out.starttime3 && out.endtime3) slots.push({ label: labels[2], start: out.starttime3, end: out.endtime3 });
    out.slots = slots;
    const lines = slots.map((s) => formatSlotLine(s.label, s.start, s.end)).filter(Boolean);
    if (lines.length) out.timings = lines.join('\n');
    return out;
  }

  function readRows(resource) {
    return q.all.all(resource).map((r) => ({ ...JSON.parse(r.data), id: String(r.id) }));
  }

  function store(resource, id, item) {
    const { id: _drop, slots: _slots, volunteers_added: _va, ...fields } = item;
    q.put.run(resource, Number(id), JSON.stringify(fields));
  }

  /** Close every open listing whose first slot has started. */
  function autoClose(resource) {
    const closed = [];
    db.transaction(() => {
      for (const item of readRows(resource)) {
        if (isClosedStatus(item.status) || !isPastStart(item)) continue;
        item.status = resource === 'volunteering' ? 'inactive' : 'Closed';
        store(resource, item.id, item);
        closed.push(item);
      }
    })();
    for (const item of closed) onChange(resource, 'upsert', item.id, item);
  }

  function visibleToPublic(resource, item) {
    if (resource === 'programs') return clean(item.status).toLowerCase() === 'open';
    return clean(item.status).toLowerCase() !== 'inactive';
  }

  function list(resource, { includeHidden = false } = {}) {
    resourceOf(resource);
    autoClose(resource);
    const counts = resource === 'programs' ? evCounts() : null;
    const items = [];
    for (const raw of readRows(resource)) {
      if (!includeHidden && !visibleToPublic(resource, raw)) continue;
      const item = enrich(raw);
      if (counts) item.volunteers_added = counts[item.id] || 0;
      items.push(item);
    }
    return { items };
  }

  function get(resource, id, { includeHidden = false } = {}) {
    resourceOf(resource);
    autoClose(resource);
    const row = q.one.get(resource, Number(id));
    if (!row) return { item: null };
    const raw = { ...JSON.parse(row.data), id: String(row.id) };
    if (!includeHidden && !visibleToPublic(resource, raw)) return { item: null };
    return { item: enrich(raw) };
  }

  /** Create (no id) or update (id) from what the admin form sent. */
  function save(resource, id, input) {
    resourceOf(resource);
    const incoming = canonical(input);
    const headers = HEADERS[resource];
    let item;
    let savedId;
    if (!id) {
      item = {};
      for (const h of headers) item[h] = incoming[h] === undefined ? '' : clean(incoming[h]);
      savedId = nextId(resource);
    } else {
      const row = q.one.get(resource, Number(id));
      if (!row) throw new Error('Item not found.');
      item = JSON.parse(row.data);
      for (const h of headers) if (incoming[h] !== undefined) item[h] = clean(incoming[h]);
      savedId = row.id;
    }
    store(resource, savedId, item);
    const out = { ...item, id: String(savedId) };
    onChange(resource, 'upsert', out.id, out);
    return { id: String(savedId), item: out, created: !id };
  }

  function remove(resource, id) {
    resourceOf(resource);
    if (!q.one.get(resource, Number(id))) throw new Error('Invalid item id.');
    q.del.run(resource, Number(id));
    onChange(resource, 'delete', String(id), null);
  }

  function clearClosed(resource) {
    resourceOf(resource);
    autoClose(resource);
    let deleted = 0;
    for (const item of readRows(resource)) {
      if (!isClosedStatus(item.status)) continue;
      q.del.run(resource, Number(item.id));
      onChange(resource, 'delete', item.id, null);
      deleted++;
    }
    return { deleted };
  }

  /** One-off copy of a Sheet tab; keeps the ids the rest of the data points at. */
  function importRows(resource, rows) {
    resourceOf(resource);
    let added = 0;
    db.transaction(() => {
      for (const r of rows || []) {
        const id = Number(r.id);
        if (!id || q.one.get(resource, id)) continue;
        store(resource, id, canonical(r));
        q.setCounter.run(`listing:${resource}`, id);
        added++;
      }
    })();
    return added;
  }

  return { list, get, save, remove, clearClosed, importRows, enrich, readRows, count: (r) => q.maxId.get(r).n };
}

module.exports = { createListings, toYmd, toHm, parseFirstSlot, HEADERS };
