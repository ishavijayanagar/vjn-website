'use strict';

/**
 * Sandesha's own state, kept in the database instead of loose JSON files:
 *   scheduled sends, group sets, contacts, and small settings (poll cursor + send budget,
 *   planning-group settings, the last group list, push heads-up memory).
 * Every write is one transaction, so a crash or power cut can no longer leave half a file.
 */

const fs = require('fs');
const path = require('path');

function createStateStore(db) {
  const getSetting = db.prepare('SELECT value FROM app_setting WHERE key = ?');
  const putSetting = db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');

  /** A small JSON value kept under a settings key (undefined if never saved). */
  function getJson(key) {
    const r = getSetting.get(key);
    if (!r) return undefined;
    try { return JSON.parse(r.value); } catch { return undefined; }
  }
  function setJson(key, value) {
    putSetting.run(key, JSON.stringify(value));
  }

  // ── scheduled sends: a list, kept in the order it was saved ───────────────
  function loadSchedules() {
    return db.prepare('SELECT data FROM scheduled_sends ORDER BY seq').all().map((r) => JSON.parse(r.data));
  }
  function saveSchedules(list) {
    const ins = db.prepare('INSERT INTO scheduled_sends (id, run_at, status, data) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM scheduled_sends').run();
      const seen = new Set();
      for (const s of list || []) {
        const id = String(s.id);
        if (seen.has(id)) continue;
        seen.add(id);
        ins.run(id, String(s.runAt || ''), String(s.status || (s.failed ? 'failed' : 'pending')), JSON.stringify(s));
      }
    })();
  }

  // ── group sets: { name: [group, ...] } ────────────────────────────────────
  function loadSets() {
    const out = {};
    for (const r of db.prepare('SELECT name FROM group_sets ORDER BY rowid').all()) out[r.name] = [];
    for (const r of db.prepare('SELECT set_name, group_jid FROM group_set_members ORDER BY pos').all()) {
      (out[r.set_name] = out[r.set_name] || []).push(r.group_jid);
    }
    return out;
  }
  function saveSets(sets) {
    const addSet = db.prepare('INSERT INTO group_sets (name) VALUES (?)');
    const addMember = db.prepare('INSERT OR IGNORE INTO group_set_members (set_name, group_jid, pos) VALUES (?, ?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM group_set_members').run();
      db.prepare('DELETE FROM group_sets').run();
      for (const [name, members] of Object.entries(sets || {})) {
        addSet.run(name);
        (Array.isArray(members) ? members : []).forEach((m, i) => addMember.run(name, String(m), i));
      }
    })();
  }

  // ── contacts: { contacts: { name: value } } ───────────────────────────────
  function loadContacts() {
    const map = {};
    for (const r of db.prepare('SELECT name, value FROM whatsapp_contacts').all()) map[r.name] = r.value;
    return { contacts: map };
  }
  function saveContacts(data) {
    const put = db.prepare('INSERT INTO whatsapp_contacts (name, value) VALUES (?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM whatsapp_contacts').run();
      for (const [name, value] of Object.entries((data && data.contacts) || {})) put.run(name, String(value));
    })();
  }

  /**
   * One-time: carry over what the old JSON files held, but only into an empty table so it can
   * never overwrite newer data. Each file is renamed to .migrated afterwards.
   */
  function importLegacy(dir, log = () => {}) {
    const take = (file, fn) => {
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) return;
      try {
        fn(JSON.parse(fs.readFileSync(p, 'utf8')));
        fs.renameSync(p, `${p}.migrated`);
        log(`[state] moved ${file} into the database`);
      } catch (err) {
        log(`[state] could not move ${file}: ${err.message}`);
      }
    };
    const empty = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
    if (empty('scheduled_sends')) take('schedules.json', (d) => { if (Array.isArray(d)) saveSchedules(d); });
    if (empty('group_sets')) take('groups.json', (d) => { if (d && typeof d === 'object') saveSets(d); });
    if (empty('whatsapp_contacts')) take('contacts.json', (d) => { if (d && typeof d === 'object') saveContacts(d); });
    if (getJson('bot_state') === undefined) take('state.json', (d) => setJson('bot_state', d));
    if (getJson('planning_config') === undefined) take('planning-config.json', (d) => setJson('planning_config', d));
    if (getJson('groups_cache') === undefined) take('groups-cache.json', (d) => setJson('groups_cache', d));
    if (getJson('push_prewarned') === undefined) take('push-prewarned.json', (d) => setJson('push_prewarned', d));
  }

  return { getJson, setJson, loadSchedules, saveSchedules, loadSets, saveSets, loadContacts, saveContacts, importLegacy };
}

module.exports = { createStateStore };
