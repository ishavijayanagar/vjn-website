'use strict';

/**
 * Promotion posts, owned by the Pi (moved from the Sheet's Promotions tab).
 *
 * A post is the copy, flyer and slot for one program or volunteering call.
 * The program itself (title, date, place, image) stays in the Sheet; the Pi
 * pulls those through Apps Script, keeps a copy on each post, and creates a
 * post for every open listing that has none.
 *
 * Status rules, as the Sheet had them:
 *   sent                       — stays sent
 *   copy + flyer + slot passed — due
 *   copy + flyer               — ready
 *   otherwise                  — pending
 */

const crypto = require('crypto');

const MAX_PER_DAY = 4;
const LISTING_TTL_MS = 60 * 1000;
const TZ_OFFSET_MS = 5.5 * 3600e3;

function kolkata(ms) {
  const iso = new Date(ms + TZ_OFFSET_MS).toISOString();
  return { ymd: iso.slice(0, 10), hm: iso.slice(11, 16), stamp: iso.slice(0, 19) };
}

/** "2026-10-28T16:00", a Date, or messy text → "2026-10-28 16:00", or "". */
function sendAtKey(raw) {
  const s = String(raw || '').replace('T', ' ').replace(/ /g, ' ').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]} ${String(Math.min(23, parseInt(m[2], 10))).padStart(2, '0')}:${m[3]}`;
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (s === 'needs_copy' || s === 'pending') return 'pending';
  if (s === 'ready' || s === 'due' || s === 'sent') return s;
  return 'pending';
}

function normalizeScheduleIds(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return list.map((v) => String(v).trim()).filter((v) => v !== '').join(',');
}

function isOpenStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return !s || s === 'open' || s === 'active';
}

function createPromos({ db, fetchListings = async () => ({}), listingTtlMs = LISTING_TTL_MS, onChange = () => {}, now = () => Date.now() }) {
  const q = {
    all: db.prepare('SELECT * FROM promos'),
    byId: db.prepare('SELECT * FROM promos WHERE id = ?'),
    byEvent: db.prepare('SELECT id FROM promos WHERE event_type = ? AND event_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM promos'),
    insert: db.prepare(`INSERT INTO promos (id, event_type, event_id, event_title, message, flyer_url, send_at, status,
        created_by, updated_at, sent_at, sent_by, target, wa_schedule_ids, event_date, event_location, event_status,
        event_image, event_open)
      VALUES (@id, @event_type, @event_id, @event_title, @message, @flyer_url, @send_at, @status, @created_by,
        @updated_at, @sent_at, @sent_by, @target, @wa_schedule_ids, @event_date, @event_location, @event_status,
        @event_image, @event_open)`),
    update: db.prepare(`UPDATE promos SET event_title = @event_title, message = @message, flyer_url = @flyer_url,
        send_at = @send_at, status = @status, updated_at = @updated_at, sent_at = @sent_at, sent_by = @sent_by,
        target = @target, wa_schedule_ids = @wa_schedule_ids, event_date = @event_date, event_location = @event_location,
        event_status = @event_status, event_image = @event_image, event_open = @event_open WHERE id = @id`),
  };

  const COLS = ['id', 'event_type', 'event_id', 'event_title', 'message', 'flyer_url', 'send_at', 'status', 'created_by',
    'updated_at', 'sent_at', 'sent_by', 'target', 'wa_schedule_ids'];
  /** Copy a changed post to the Sheet (the Promotions tab is the backup). */
  function changed(row) {
    const out = {};
    for (const c of COLS) out[c] = row[c] === undefined || row[c] === null ? '' : String(row[c]);
    onChange('promos', 'upsert', row.id, out);
  }

  let listingCache = { at: 0, map: null };
  let listingLoading = null;

  /** key "programs:12" → listing. Stale or empty when the Sheet cannot be reached. */
  async function listings(force) {
    if (!force && listingCache.map && now() - listingCache.at < listingTtlMs) return listingCache.map;
    if (listingLoading) return listingLoading;
    listingLoading = (async () => {
      try {
        const data = await fetchListings();
        const map = {};
        for (const type of ['programs', 'volunteering']) {
          for (const item of (data && data[type]) || []) map[`${type}:${item.id}`] = item;
        }
        listingCache = { at: now(), map };
        return map;
      } catch {
        // Keep drawing the board from what was last seen; try again soon.
        listingCache = { at: listingCache.map ? now() - listingTtlMs + 15000 : 0, map: listingCache.map };
        return listingCache.map || {};
      } finally {
        listingLoading = null;
      }
    })();
    return listingLoading;
  }

  function hasListings() {
    return !!listingCache.map && Object.keys(listingCache.map).length > 0;
  }

  function listingImage(listing) {
    return String((listing && listing.image) || '').trim();
  }

  function flyerSource(row, listing) {
    const own = String(row.flyer_url || '').trim();
    if (own) return own;
    const snap = String(listing ? listingImage(listing) : row.event_image || '').trim();
    return snap;
  }

  /** Sandesha still has a row for this post, so it has not gone out. */
  function stillQueued(row) {
    return !!normalizeScheduleIds(row.wa_schedule_ids);
  }

  function slotInFuture(row) {
    const key = sendAtKey(row.send_at);
    if (!key) return false;
    const t = kolkata(now());
    return key > `${t.ymd} ${t.hm}`;
  }

  function computeStatus(row, listing) {
    const storedSent = normalizeStatus(row.status) === 'sent';
    // An earlier mark must not survive a new queue, and a bot mark made before
    // the slot (a missing row used to look like a send) is not a delivery.
    // A person marking it by hand, after the queue was cleared, still counts.
    const prematureBot = storedSent && slotInFuture(row) && String(row.sent_by || '') === 'sandesha';
    if (storedSent && !stillQueued(row) && !prematureBot) return 'sent';
    const hasCopy = String(row.message || '').trim();
    const hasFlyer = flyerSource(row, listing);
    if (hasCopy && hasFlyer) {
      const key = sendAtKey(row.send_at);
      const t = kolkata(now());
      if (key && key <= `${t.ymd} ${t.hm}`) return 'due';
      return 'ready';
    }
    return 'pending';
  }

  /** Copy what the listing says now onto the row. */
  function withListing(row, listing) {
    if (!listing) return { ...row };
    return {
      ...row,
      event_title: listing.title || row.event_title,
      event_date: listing.date || listing.startdate || listing['start date'] || '',
      event_location: listing.location || '',
      event_status: listing.status || '',
      event_image: listingImage(listing),
      event_open: isOpenStatus(listing.status) ? 1 : 0,
    };
  }

  function toItem(row, listing) {
    const merged = withListing(row, listing);
    return {
      id: merged.id,
      event_type: merged.event_type,
      event_id: merged.event_id,
      event_title: merged.event_title,
      message: merged.message,
      flyer_url: merged.flyer_url,
      send_at: sendAtKey(merged.send_at),
      status: computeStatus(merged, listing),
      created_by: merged.created_by,
      updated_at: merged.updated_at,
      sent_at: merged.sent_at,
      sent_by: merged.sent_by,
      target: merged.target,
      wa_schedule_ids: merged.wa_schedule_ids,
      event_date: merged.event_date,
      event_location: merged.event_location,
      event_status: merged.event_status,
      event_open: !!merged.event_open && (!!listing || !hasListings()),
      event_image: merged.event_image,
    };
  }

  function listingFor(map, row) {
    return map[`${row.event_type}:${row.event_id}`] || null;
  }

  function newRow(fields) {
    return {
      id: crypto.randomUUID(),
      event_type: fields.event_type === 'volunteering' ? 'volunteering' : 'programs',
      event_id: String(fields.event_id || ''),
      event_title: fields.event_title || '',
      message: fields.message || '',
      flyer_url: fields.flyer_url || '',
      send_at: sendAtKey(fields.send_at),
      status: 'pending',
      created_by: fields.created_by || '',
      updated_at: kolkata(now()).stamp,
      sent_at: '',
      sent_by: '',
      target: fields.target || '',
      wa_schedule_ids: normalizeScheduleIds(fields.wa_schedule_ids),
      event_date: '',
      event_location: '',
      event_status: '',
      event_image: '',
      event_open: 0,
    };
  }

  /** One post for every open listing that has none, and fresh listing copies on the rest. */
  async function sync(map) {
    if (!Object.keys(map).length) return;
    db.transaction(() => {
      for (const [key, listing] of Object.entries(map)) {
        const [type, ...rest] = key.split(':');
        const eventId = rest.join(':');
        if (!isOpenStatus(listing.status)) continue;
        if (q.byEvent.get(type, eventId)) continue;
        const row = withListing(newRow({
          event_type: type, event_id: eventId, event_title: listing.title, flyer_url: listingImage(listing),
        }), listing);
        row.status = computeStatus(row, listing);
        q.insert.run(row); changed(row);
      }
      for (const row of q.all.all()) {
        const listing = listingFor(map, row);
        if (!listing) continue;
        const next = withListing(row, listing);
        if (['event_title', 'event_date', 'event_location', 'event_status', 'event_image', 'event_open']
          .some((k) => next[k] !== row[k])) {
          q.update.run(next); changed(next);
        }
      }
    })();
  }

  function sortRows(items) {
    const order = { due: 0, pending: 1, ready: 2, sent: 3 };
    return items.sort((a, b) => {
      const da = order[a.status] != null ? order[a.status] : 9;
      const db2 = order[b.status] != null ? order[b.status] : 9;
      if (da !== db2) return da - db2;
      return String(b.send_at || '').localeCompare(String(a.send_at || ''));
    });
  }

  async function list({ dueOnly = false } = {}) {
    const map = await listings();
    await sync(map);
    const items = sortRows(q.all.all().map((row) => toItem(row, listingFor(map, row))));
    const due = items.filter((i) => i.status === 'due');
    const counts = { pending: 0, ready: 0, due: 0, sent: 0, needs_copy: 0 };
    for (const i of items) if (counts[i.status] !== undefined) counts[i.status]++;
    counts.needs_copy = counts.pending;
    const stamp = due.map((i) => i.id).sort().join('|');
    return { items: dueOnly ? due : items, due, counts, stamp };
  }

  function daySlotsUsed(ymd, excludeId) {
    let n = 0;
    for (const row of q.all.all()) {
      if (excludeId && row.id === String(excludeId)) continue;
      if (normalizeStatus(row.status) === 'sent') continue;
      if (sendAtKey(row.send_at).slice(0, 10) === ymd) n++;
    }
    return n;
  }

  async function itemFor(id) {
    const map = await listings();
    const row = q.byId.get(String(id));
    return toItem(row, listingFor(map, row));
  }

  /** Same fields and rules as the Sheet's adminSavePromotion. */
  async function save(data) {
    const row = q.byId.get(String((data && data.id) || '').trim());
    if (!row) throw new Error('Promotion not found.');
    const map = await listings();
    const listing = listingFor(map, row);
    if (data.message !== undefined) row.message = String(data.message || '');
    if (data.flyer_url !== undefined) row.flyer_url = String(data.flyer_url || '');
    if (!String(row.flyer_url || '').trim()) row.flyer_url = flyerSource(row, listing);
    if (data.target !== undefined) row.target = String(data.target || '');
    if (data.send_at !== undefined) {
      const next = sendAtKey(data.send_at);
      const day = next.slice(0, 10);
      if (day && daySlotsUsed(day, row.id) >= MAX_PER_DAY) {
        throw new Error(`Only ${MAX_PER_DAY} posts can be scheduled on one day.`);
      }
      row.send_at = next;
      // Off the day board means Sandesha is no longer holding a row for it.
      if (!next && data.wa_schedule_ids === undefined) row.wa_schedule_ids = '';
    }
    if (data.wa_schedule_ids !== undefined) row.wa_schedule_ids = normalizeScheduleIds(data.wa_schedule_ids);
    if (data.clear_sent) {
      row.sent_at = '';
      row.sent_by = '';
      row.status = 'ready';
    }
    // Queuing it again means this slot has not gone out.
    if (stillQueued(row) && normalizeStatus(row.status) === 'sent') {
      row.sent_at = '';
      row.sent_by = '';
      row.status = 'ready';
    }
    row.status = computeStatus(row, listing);
    row.updated_at = kolkata(now()).stamp;
    q.update.run(row); changed(row);
    return { success: true, item: toItem(row, listing) };
  }

  /** A post from the Library, for an event that has none yet. */
  async function add(actor, data) {
    const type = data.event_type === 'volunteering' ? 'volunteering' : 'programs';
    const eventId = String(data.event_id || '').trim();
    if (!eventId) throw new Error('Choose an event.');
    const map = await listings(true);
    const listing = map[`${type}:${eventId}`] || null;
    const row = withListing(newRow({
      event_type: type,
      event_id: eventId,
      event_title: (listing && listing.title) || data.event_title || '',
      flyer_url: listingImage(listing),
      created_by: (actor && actor.username) || '',
    }), listing);
    row.status = computeStatus(row, listing);
    q.insert.run(row); changed(row);
    return { success: true, item: toItem(row, listing) };
  }

  async function markSent(id, source, actor) {
    const row = q.byId.get(String(id || '').trim());
    if (!row) throw new Error('Promotion not found.');
    row.status = 'sent';
    row.sent_at = kolkata(now()).stamp;
    // Sandesha delivered it on the schedule; whoever opened the board did not.
    row.sent_by = source === 'sandesha' ? 'sandesha' : (actor && actor.username) || '';
    row.wa_schedule_ids = '';
    row.updated_at = row.sent_at;
    q.update.run(row); changed(row);
    return { success: true, item: await itemFor(row.id) };
  }

  async function unmarkSent(id) {
    const row = q.byId.get(String(id || '').trim());
    if (!row) throw new Error('Promotion not found.');
    row.sent_at = '';
    row.sent_by = '';
    row.status = 'ready';
    const map = await listings();
    row.status = computeStatus(row, listingFor(map, row));
    row.updated_at = kolkata(now()).stamp;
    q.update.run(row); changed(row);
    return { success: true, item: toItem(row, listingFor(map, row)) };
  }

  /** programId → the message Promotions wrote for it, so Nurturing can invite. */
  function inviteMessages() {
    const out = {};
    for (const row of q.all.all()) {
      if (row.event_type !== 'programs') continue;
      const msg = String(row.message || '').trim();
      if (msg) out[String(row.event_id)] = msg;
    }
    return { messages: out };
  }

  /** One-off copy of the Sheet's Promotions tab. Keeps ids and every field. */
  function importRows(rows) {
    let added = 0;
    db.transaction(() => {
      for (const r of rows || []) {
        if (!r.id || q.byId.get(String(r.id))) continue;
        const row = {
          ...newRow(r),
          id: String(r.id),
          status: normalizeStatus(r.status),
          sent_at: String(r.sent_at || ''),
          sent_by: String(r.sent_by || ''),
          updated_at: String(r.updated_at || ''),
        };
        q.insert.run(row); changed(row);
        added++;
      }
    })();
    return added;
  }

  return { list, save, add, markSent, unmarkSent, inviteMessages, importRows, sendAtKey, count: () => q.count.get().n };
}

module.exports = { createPromos, sendAtKey, MAX_PER_DAY };
