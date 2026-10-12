/**
 * Activity log — server-backed, with a small local layer.
 *
 * The server (`/activity`) is the source of truth: it records every send (bot,
 * API, bulk, broadcast, scheduled), every add-members job, and group / set /
 * contact edits, so things that happen while this page is closed still show up.
 *
 * `logActivity()` stays for *optimistic* local entries — instant feedback right
 * after an action, before the next `/activity` refresh reconciles it. Local
 * entries are capped and de-duped against the server on merge.
 */
import { api } from './api.js';

const KEY = 'sandesha_activity_log';
const MAX = 60;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch { /* storage full — silently skip */ }
}

/** Normalise a server row (`at`) or a local row (`ts`) into one shape. */
function normalise(row) {
  const ts = row.ts || row.at || new Date().toISOString();
  return {
    id: row.id || `${Date.parse(ts) || Date.now()}-${(row.title || '').length}`,
    ts,
    type: row.type || (row.ok === false ? 'err' : 'ok'),
    category: row.category || 'system',
    title: row.title || row.msg || '',
    detail: row.detail || '',
    target: row.target || '',
    count: row.count ?? null,
    via: row.via || '',
    corrId: row.corrId || '',
    _local: !!row._local,
  };
}

/**
 * Add an optimistic local activity entry.
 * @param {{ type?: string, category?: string, title: string, detail?: string,
 *           target?: string, count?: number, via?: string, corrId?: string }} opts
 */
export function logActivity(opts = {}) {
  const entries = load();
  const entry = normalise({
    ...opts,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    _local: true,
  });
  entries.unshift(entry);
  save(entries);
  window.dispatchEvent(new CustomEvent('sandesha:activity', { detail: entry }));
  return entry;
}

/** Fetch the server activity feed. Returns [] on any failure. */
export async function fetchServerActivities(limit = 150) {
  try {
    const data = await api(`/activity?limit=${limit}`);
    return Array.isArray(data?.activity) ? data.activity.map(normalise) : [];
  } catch {
    return [];
  }
}

/**
 * Merge server rows with local optimistic rows, newest first.
 * A local row is dropped once the server has an equivalent (same corrId, or
 * same minute + same category + similar title).
 */
export function mergeActivities(serverRows = [], localRows = load()) {
  const server = serverRows.map(normalise);
  const serverKeys = new Set(
    server.map((e) => e.corrId || `${e.category}|${minuteBucket(e.ts)}|${e.title}`),
  );
  const localKept = localRows
    .map(normalise)
    .filter((e) => {
      const key = e.corrId || `${e.category}|${minuteBucket(e.ts)}|${e.title}`;
      return !serverKeys.has(key);
    });
  // Persist the pruned local set so it doesn't grow forever.
  if (localKept.length !== localRows.length) save(localKept);
  return [...localKept, ...server].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

function minuteBucket(iso) {
  return Math.floor((Date.parse(iso) || 0) / 60000);
}

/**
 * Collapse a fan-out (rows sharing a corrId) into a single row.
 * Keeps a "summary" row if one exists (title starts with Broadcast/Scheduled),
 * otherwise synthesises one from the count.
 */
export function aggregateActivities(rows) {
  const out = [];
  const byCorr = new Map();
  for (const r of rows) {
    if (!r.corrId) { out.push(r); continue; }
    if (!byCorr.has(r.corrId)) byCorr.set(r.corrId, []);
    byCorr.get(r.corrId).push(r);
  }
  for (const group of byCorr.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    group.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    const summary = group.find((g) => /^(Broadcast|Scheduled|Added|Sent to)\b/i.test(g.title));
    const anyErr = group.some((g) => g.type === 'err');
    const sends = group.filter((g) => g.category === 'send');
    const base = summary || group[0];
    out.push({
      ...base,
      type: anyErr ? 'warn' : base.type,
      title: summary
        ? summary.title
        : `Sent to ${sends.length || group.length} chats`,
      count: summary?.count ?? (sends.length || group.length),
      _group: group.length,
    });
  }
  return out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

/** All merged + aggregated entries, newest first. */
export function getActivities(serverRows) {
  return aggregateActivities(mergeActivities(serverRows || [], load()));
}

/** Entries from the last N hours. */
export function getRecentActivities(hours = 24, serverRows) {
  const cutoff = Date.now() - hours * 3600000;
  return getActivities(serverRows).filter((e) => Date.parse(e.ts) >= cutoff);
}

/** Count entries by type/category in the last N hours. */
export function getActivityStats(hours = 24, serverRows) {
  const entries = getRecentActivities(hours, serverRows);
  return {
    total: entries.length,
    ok: entries.filter((e) => e.type === 'ok').length,
    err: entries.filter((e) => e.type === 'err').length,
    sends: entries
      .filter((e) => e.category === 'send')
      .reduce((n, e) => n + (e.count || 1), 0),
    schedules: entries.filter((e) => e.category === 'schedule').length,
    members: entries.filter((e) => e.category === 'members').length,
  };
}

/** Clears only the local optimistic layer — server history is untouched. */
export function clearActivities() {
  save([]);
  window.dispatchEvent(new CustomEvent('sandesha:activity-cleared'));
}
