'use strict';

/**
 * Volunteer check-ins from the public check-in page. Each one is kept here and
 * copied to the Sheet's "Checkins <yyyy-mm>" tab, one tab per month of check-in.
 * Separate from the attendance enquiries and the Nurturing attendance marking.
 */

const TZ_OFFSET_MS = 5.5 * 3600e3;

function createCheckins({ db, listings, onChange = () => {}, now = () => Date.now() }) {
  const insert = db.prepare('INSERT INTO checkins (month, data) VALUES (?, ?)');

  function programDate(programId) {
    if (!programId) return '';
    try {
      const { item } = listings.get('programs', programId, { includeHidden: true });
      return item && item.startdate ? String(item.startdate).slice(0, 10) : '';
    } catch (err) {
      return '';
    }
  }

  function record(data) {
    const text = (v) => String(v === undefined || v === null ? '' : v).trim();
    const stamp = new Date(now() + TZ_OFFSET_MS).toISOString().slice(0, 19);
    const month = stamp.slice(0, 7);
    const row = {
      timestamp: stamp,
      'program date': programDate(text(data.programId)),
      'program id': text(data.programId),
      'program name': text(data.programName),
      name: text(data.name),
      phone: text(data.phone),
      area: text(data.area),
      'ie completion': text(data.ieCompletion),
    };
    const id = Number(insert.run(month, JSON.stringify(row)).lastInsertRowid);
    onChange('checkins', 'upsert', String(id), { ...row, id: String(id), month });
    return id;
  }

  return { record };
}

module.exports = { createCheckins };
