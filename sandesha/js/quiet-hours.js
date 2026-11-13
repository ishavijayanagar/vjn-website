/**
 * Quiet hours — the window in which Sandesha sends nothing.
 *
 * The server owns the setting (GET/POST /quiet-hours, admin sets it). Pages
 * read it from here so the board can say "Held until 8:00 AM" using the same
 * hours the server enforces. The server counts hours in IST, so this does too.
 */
import { api } from './api.js';

const TZ = 'Asia/Kolkata';
const DEFAULT = { start: 22, end: 8, enabled: true };

export function currentQuiet() {
  return window.SandeshaQuiet || DEFAULT;
}

function istHour(date) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(h) % 24;
}

/** True when `date` falls inside the do-not-send window. */
export function inQuiet(date = new Date()) {
  const { start, end } = currentQuiet();
  if (start === end) return false;
  const h = istHour(date);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** "8:00 AM" for an hour 0–23. */
export function hourLabel(h) {
  const mer = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:00 ${mer}`;
}

export async function loadQuietHours() {
  try {
    const q = await api('/quiet-hours');
    if (Number.isInteger(q?.start) && Number.isInteger(q?.end)) {
      window.SandeshaQuiet = { start: q.start, end: q.end, enabled: q.start !== q.end };
      window.dispatchEvent(new CustomEvent('sandesha:quiet-hours'));
    }
  } catch { /* keep the last known (or default) window */ }
  return currentQuiet();
}

export async function saveQuietHours({ start, end }) {
  const q = await api('/quiet-hours', { method: 'POST', body: JSON.stringify({ start, end }) });
  window.SandeshaQuiet = { start: q.start, end: q.end, enabled: q.start !== q.end };
  window.dispatchEvent(new CustomEvent('sandesha:quiet-hours'));
  return currentQuiet();
}

// admin-promotions.js is a classic script and cannot import this module.
window.SandeshaQuietUtil = { inQuiet, hourLabel, currentQuiet };
