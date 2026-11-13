'use strict';

/**
 * Sending safety — pacing, quiet hours, budgets and payload variety.
 *
 * Implements SENDING_SAFETY.md. None of this makes an unofficial client
 * compliant; what it removes are the *behavioural* signals that actually
 * trigger enforcement: burst velocity, perfectly periodic timing, identical
 * payloads fanned out at once, and activity at hours no human keeps.
 *
 * Every knob is overridable from .env — see .env.example.
 */

const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Kolkata';

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function envFlag(name, fallback) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Ranges come straight from SENDING_SAFETY.md §5. They are wide on purpose:
 * jitter narrow enough to stay near a constant is still a fingerprint.
 */
const CONFIG = {
  // Between chats in a scheduled fan-out, and between DMs in a bulk send.
  sendMinMs: envInt('SANDESHA_SEND_JITTER_MIN_MS', 45000),
  sendMaxMs: envInt('SANDESHA_SEND_JITTER_MAX_MS', 90000),
  // Broadcast to every group — the widest fan-out there is, so the slowest.
  broadcastMinMs: envInt('SANDESHA_BROADCAST_JITTER_MIN_MS', 60000),
  broadcastMaxMs: envInt('SANDESHA_BROADCAST_JITTER_MAX_MS', 120000),
  // Adding people to a group is the most heavily policed action of all.
  participantMinMs: envInt('SANDESHA_PARTICIPANT_JITTER_MIN_MS', 75000),
  participantMaxMs: envInt('SANDESHA_PARTICIPANT_JITTER_MAX_MS', 150000),
  // Settling pause after an upload, before the media send itself.
  mediaMinMs: envInt('SANDESHA_MEDIA_JITTER_MIN_MS', 3000),
  mediaMaxMs: envInt('SANDESHA_MEDIA_JITTER_MAX_MS', 5000),

  quietStartHour: envInt('SANDESHA_QUIET_START_HOUR', 22),
  quietEndHour: envInt('SANDESHA_QUIET_END_HOUR', 8),

  maxSendsPerHour: envInt('SANDESHA_MAX_SENDS_PER_HOUR', 30),
  maxSendsPerDay: envInt('SANDESHA_MAX_SENDS_PER_DAY', 120),

  typingSimulation: envFlag('SANDESHA_TYPING_SIMULATION', true),
  auditLog: envFlag('SANDESHA_SEND_AUDIT', true),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

/**
 * Randomised pause between sends. Fixed intervals are a machine fingerprint,
 * so every gap is drawn fresh from [minMs, maxMs].
 */
function jitter(minMs, maxMs) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return delay(lo + Math.random() * (hi - lo));
}

/** The gap between chats in a scheduled fan-out or a bulk send. */
function sendGap() {
  return jitter(CONFIG.sendMinMs, CONFIG.sendMaxMs);
}

function broadcastGap() {
  return jitter(CONFIG.broadcastMinMs, CONFIG.broadcastMaxMs);
}

function participantGap() {
  return jitter(CONFIG.participantMinMs, CONFIG.participantMaxMs);
}

function mediaSettleGap() {
  return jitter(CONFIG.mediaMinMs, CONFIG.mediaMaxMs);
}

/**
 * Fisher–Yates. Sending in a different order each time removes a second
 * periodic signal — the fan-out sequence itself.
 */
function shuffled(list) {
  const out = (list || []).slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Calendar day and hour in IST, which is the clock the centre actually keeps. */
function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = Number(get('hour')) % 24;
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour };
}

/* ── Quiet hours set from the admin page ─────────────────────────────
 * The admin can change the window without touching .env. It is saved here and
 * wins over the env defaults; start === end means "no quiet hours".
 */
const QUIET_FILE = process.env.SANDESHA_QUIET_HOURS_FILE || path.join(__dirname, 'quiet-hours.json');
const ENV_QUIET = { start: CONFIG.quietStartHour, end: CONFIG.quietEndHour };

function validHour(v) {
  return Number.isInteger(v) && v >= 0 && v <= 23;
}

function loadQuietHours() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUIET_FILE, 'utf8'));
    if (validHour(raw.start) && validHour(raw.end)) {
      CONFIG.quietStartHour = raw.start;
      CONFIG.quietEndHour = raw.end;
    }
  } catch { /* none saved — keep the .env / default window */ }
}

/** The window in force right now. */
function getQuietHours() {
  const start = CONFIG.quietStartHour;
  const end = CONFIG.quietEndHour;
  return { start, end, enabled: start !== end, active: inQuietHours() };
}

/** Save a new window. Returns { ok, error }. */
function setQuietHours({ start, end }) {
  const s = Number(start);
  const e = Number(end);
  if (!validHour(s) || !validHour(e)) return { ok: false, error: 'Hours must be whole numbers from 0 to 23.' };
  try {
    fs.writeFileSync(QUIET_FILE, JSON.stringify({ start: s, end: e }, null, 2));
  } catch (err) {
    return { ok: false, error: `Could not save: ${err.message}` };
  }
  CONFIG.quietStartHour = s;
  CONFIG.quietEndHour = e;
  return { ok: true, ...getQuietHours() };
}

/** Forget the saved window and go back to the .env / default one. */
function resetQuietHours() {
  try { fs.unlinkSync(QUIET_FILE); } catch { /* nothing saved */ }
  CONFIG.quietStartHour = ENV_QUIET.start;
  CONFIG.quietEndHour = ENV_QUIET.end;
  return getQuietHours();
}

/** True inside the do-not-send window. A window of 0..0 disables quiet hours. */
function inQuietHours(date = new Date()) {
  const { quietStartHour: start, quietEndHour: end } = CONFIG;
  if (start === end) return false;
  const { hour } = istParts(date);
  // The window normally wraps midnight (22 → 8), but need not.
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** When sending may resume — the next IST occurrence of the quiet-end hour. */
function quietHoursEndAt(date = new Date()) {
  if (!inQuietHours(date)) return date;
  const next = new Date(date.getTime());
  for (let i = 0; i < 48; i++) {
    next.setTime(next.getTime() + 30 * 60 * 1000);
    if (!inQuietHours(next)) return next;
  }
  return next;
}

/**
 * Hourly and daily send ceilings, held in state.json so a restart cannot hand
 * the account a fresh budget. Counters roll over on the IST clock.
 */
function createSendBudget({ loadState, saveState, log }) {
  const note = typeof log === 'function' ? log : () => {};
  let cache = null;

  function read() {
    if (cache) return cache;
    let stored = {};
    try {
      stored = (loadState() || {}).sendBudget || {};
    } catch {
      stored = {};
    }
    cache = {
      day: String(stored.day || ''),
      dayCount: Number(stored.dayCount) || 0,
      hour: String(stored.hour || ''),
      hourCount: Number(stored.hourCount) || 0,
    };
    return cache;
  }

  function rolled(at = new Date()) {
    const { ymd, hour } = istParts(at);
    const hourKey = `${ymd}T${String(hour).padStart(2, '0')}`;
    const b = read();
    if (b.day !== ymd) {
      b.day = ymd;
      b.dayCount = 0;
    }
    if (b.hour !== hourKey) {
      b.hour = hourKey;
      b.hourCount = 0;
    }
    return b;
  }

  function persist() {
    try {
      saveState({ sendBudget: read() });
    } catch (err) {
      note(`[BUDGET] Could not persist counters: ${err.message}`);
    }
  }

  return {
    /** @returns {{ok: boolean, reason?: string}} */
    check(at = new Date()) {
      const b = rolled(at);
      if (CONFIG.maxSendsPerHour && b.hourCount >= CONFIG.maxSendsPerHour) {
        return { ok: false, reason: `hourly cap reached (${b.hourCount}/${CONFIG.maxSendsPerHour})` };
      }
      if (CONFIG.maxSendsPerDay && b.dayCount >= CONFIG.maxSendsPerDay) {
        return { ok: false, reason: `daily cap reached (${b.dayCount}/${CONFIG.maxSendsPerDay})` };
      }
      return { ok: true };
    },

    record(n = 1, at = new Date()) {
      const b = rolled(at);
      b.dayCount += n;
      b.hourCount += n;
      persist();
      return b;
    },

    snapshot(at = new Date()) {
      const b = rolled(at);
      return {
        day: b.day,
        dayCount: b.dayCount,
        dayLimit: CONFIG.maxSendsPerDay,
        hourCount: b.hourCount,
        hourLimit: CONFIG.maxSendsPerHour,
      };
    },
  };
}

/**
 * Deliver one message to many chats, paced, shuffled, and interruptible.
 *
 * Stops early — rather than pushing through — the moment `guard` refuses, and
 * reports exactly who has already been reached. Callers persist that list and
 * pass it back as `alreadySent` on the next attempt, so a fan-out paused by
 * quiet hours or a spent budget can neither drop a chat nor message one twice.
 *
 * @param {object}   opts
 * @param {string[]} opts.members       chats to reach
 * @param {string[]} [opts.alreadySent] chats a previous attempt already reached
 * @param {function} opts.deliver       async (member) => void
 * @param {function} [opts.guard]       () => ({ok: boolean, reason?: string})
 * @param {function} [opts.gap]         async () => void, awaited between sends
 * @returns {Promise<{complete: boolean, sentTo: string[], reason?: string}>}
 */
async function runPacedFanOut({ members, alreadySent = [], deliver, guard, gap = sendGap }) {
  const seen = new Set(alreadySent.map((m) => String(m).toLowerCase()));
  const sentTo = [...alreadySent];

  // Shuffle first, then drop what is done or duplicated inside the set itself.
  const remaining = shuffled(members || []).filter((m) => {
    const key = String(m).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (let i = 0; i < remaining.length; i++) {
    const verdict = guard ? guard() : { ok: true };
    if (!verdict.ok) return { complete: false, sentTo, reason: verdict.reason };
    try {
      await deliver(remaining[i]);
    } catch (err) {
      // Say who already got it and who failed, so a retry resumes instead of
      // re-sending the groups that were delivered.
      err.sentTo = [...sentTo];
      err.failedTarget = remaining[i];
      throw err;
    }
    sentTo.push(remaining[i]);
    if (i < remaining.length - 1) await gap();
  }
  return { complete: true, sentTo };
}

/**
 * Messages go out exactly as written. This used to wrap a fan-out in a random
 * greeting line and a random closing line that nobody had typed, which put
 * words in people's mouths. Nothing is added, ever. The function stays so every
 * send path that calls it keeps working, and it is the single place that
 * guarantees it.
 */
function varyCaption(message) {
  return String(message || '');
}

/**
 * Brief typing presence before a send. A message that materialises with no
 * lead-in is a behavioural flag, and the pause scales with length the way a
 * person's would. Presence is best-effort: never let it block the send.
 */
async function withTypingPresence(chat, text, { enabled = CONFIG.typingSimulation } = {}) {
  if (!enabled || !chat || typeof chat.sendStateTyping !== 'function') return;
  try {
    await chat.sendStateTyping();
    const body = String(text || '');
    const thinkMs = Math.min(9000, 3000 + body.length * 35);
    await jitter(thinkMs * 0.7, thinkMs * 1.3);
    await chat.clearState();
  } catch {
    /* presence is cosmetic — a failure here must not stop the message */
  }
}

/**
 * One line per send, so the real interval distribution can be audited rather
 * than assumed. Rotates itself; never throws into a send path.
 */
let auditDb = null;
let auditWrites = 0;
function useDb(handle) { auditDb = handle; }

function auditSend(entry) {
  if (!CONFIG.auditLog || !auditDb) return;
  try {
    auditDb.prepare('INSERT INTO send_audit_log (at, kind, target, chars) VALUES (?, ?, ?, ?)')
      .run(Date.now(), String(entry.kind || ''), String(entry.target || ''), Number(entry.chars) || 0);
    if (++auditWrites % 500 === 0) auditDb.prepare('DELETE FROM send_audit_log WHERE at < ?').run(Date.now() - 90 * 24 * 3600e3);
  } catch {
    /* auditing must never break sending */
  }
}

loadQuietHours();

module.exports = {
  CONFIG,
  TZ,
  useDb,
  delay,
  jitter,
  sendGap,
  broadcastGap,
  participantGap,
  mediaSettleGap,
  shuffled,
  runPacedFanOut,
  istParts,
  inQuietHours,
  quietHoursEndAt,
  getQuietHours,
  setQuietHours,
  resetQuietHours,
  createSendBudget,
  varyCaption,
  withTypingPresence,
  auditSend,
};
