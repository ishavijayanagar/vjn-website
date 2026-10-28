/**
 * Schedule screen for admin-promotions.html.
 *
 * A week rail over day-grouped rows, in the same paper-and-ink language as
 * the board. Composing lives in the Compose tab, so this screen only reads
 * and cancels.
 */
import { api, escapeHtml, escapeAttr, getApiBase, getToken } from '../api.js';
import { getState, jidToName } from '../store.js';
import { toast } from '../toast.js';
import { releaseBoardPost, markBoardPostSent } from '../vjn-sheet.js';
import { openManualSendSheet } from '../manual-send.js';
import { loadScheduleIntoCompose, pendingQueueTitles } from './promo-compose.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_LEN = 7;
const ARM_MS = 3000;

const X_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CLIP_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05 12.2 20.3a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>';

let jumpedKey = '';
let armedId = '';
let armTimer = 0;

function panel() {
  return document.getElementById('sandeshaSchedule');
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function clockOf(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Kept to one short line so rows stay the same height. */
function countdown(date) {
  const diff = date - Date.now();
  if (diff <= 0) return 'Overdue';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 12) return `in ${hours}h ${mins % 60}m`;
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function groupLabel(date, todayKey, tomorrowKey) {
  const key = dayKey(date);
  const stamp = `${DAYS[date.getDay()]} ${pad2(date.getDate())}`;
  if (key === todayKey) return `Today · ${stamp}`;
  if (key === tomorrowKey) return `Tomorrow · ${stamp}`;
  return `${stamp} ${MONTHS[date.getMonth()]}`;
}

function targetLabel(entry) {
  const { sets } = getState();
  const name = String(entry.target || '');
  if (entry.isSet) {
    const members = sets[name.toLowerCase()] || sets[name] || [];
    return members.length ? `${name} · ${members.length} groups` : name;
  }
  return jidToName(name);
}

function monthRange(days) {
  if (!days.length) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const left = MONTHS[first.getMonth()];
  const right = MONTHS[last.getMonth()];
  const year = last.getFullYear();
  return left === right ? `${left} ${year}` : `${left} — ${right} ${year}`;
}

function setKicker(text) {
  const el = document.getElementById('dayTitle');
  if (el && text) el.textContent = text;
}

function sortedSchedules() {
  const { schedules } = getState();
  return [...(schedules || [])]
    .map((s) => ({ ...s, when: new Date(s.runAt) }))
    .filter((s) => !Number.isNaN(s.when.getTime()))
    .sort((a, b) => a.when - b.when);
}

function weekHtml(days, counts, todayKey) {
  return days
    .map((date) => {
      const key = dayKey(date);
      const n = counts.get(key) || 0;
      const pips = Array.from({ length: Math.min(n, 3) }, () => '<i></i>').join('');
      return `
      <button type="button" data-jump="${key}" aria-pressed="${key === jumpedKey}"
              class="${key === todayKey ? 'is-today' : ''}" ${n ? '' : 'disabled'}>
        <div class="d">${DAYS[date.getDay()]}</div>
        <div class="n">${pad2(date.getDate())}</div>
        <div class="pips">${pips}</div>
      </button>`;
    })
    .join('');
}

function rowHtml(entry, now) {
  const overdue = entry.when <= now;
  const armed = armedId === String(entry.id);
  return `
    <div class="listrow" data-row="${escapeAttr(entry.id)}">
      <div class="time">${clockOf(entry.when)}<small>${escapeHtml(countdown(entry.when))}</small></div>
      <button type="button" class="body" data-open="${escapeAttr(entry.id)}"
              aria-label="Post this by hand">
        <div class="meta">
          <span class="chip ${overdue ? 'late' : 'queued'}">${overdue ? 'Due' : 'Queued'}</span>
          <span class="aud">${escapeHtml(targetLabel(entry))}</span>
          ${entry.filePath ? `<span class="clip" title="Has a flyer">${CLIP_ICON}</span>` : ''}
        </div>
        <div class="snippet">${escapeHtml(entry.message || 'No message')}</div>
      </button>
      ${armed
        ? `<button type="button" class="chip late" data-kill="${escapeAttr(entry.id)}">Confirm</button>`
        : `<button type="button" class="rowx" data-arm="${escapeAttr(entry.id)}" aria-label="Cancel this schedule">${X_ICON}</button>`}
    </div>`;
}

/** Schedules the server is still creating: shown at once, replaced by the real rows. */
function pendingHtml() {
  return pendingQueueTitles()
    .map((title) => `
    <div class="listrow is-pending" aria-busy="true">
      <div class="time"><svg class="pend-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.55"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg></div>
      <div class="body" style="cursor:default">
        <div class="meta"><span class="chip queued">Scheduling…</span></div>
        <div class="snippet">${escapeHtml(title)}</div>
      </div>
    </div>`)
    .join('');
}

export function renderPromoSchedule() {
  const host = panel();
  if (!host) return;

  const now = new Date();
  const first = startOfDay(now);
  const days = Array.from({ length: WEEK_LEN }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayKey = dayKey(days[0]);
  const tomorrowKey = dayKey(days[1]);

  const list = sortedSchedules();
  const counts = new Map();
  for (const entry of list) {
    const key = dayKey(entry.when);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  setKicker(monthRange(days));

  const pending = pendingHtml();
  if (!list.length && pending) {
    host.innerHTML = `<div class="week">${weekHtml(days, counts, todayKey)}</div>${pending}`;
    bind(host);
    return;
  }
  if (!list.length) {
    host.innerHTML = `
      <div class="week">${weekHtml(days, counts, todayKey)}</div>
      <div class="empty">
        <div class="mark-art">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        </div>
        <h3>The week is clear</h3>
        Anything you schedule lands here, grouped by day.<br/>
        <button type="button" class="link" data-goto-compose>Write a message</button>
      </div>`;
    bind(host);
    return;
  }

  const parts = [`<div class="week">${weekHtml(days, counts, todayKey)}</div>`, pending];
  let openKey = '';
  for (const entry of list) {
    const key = dayKey(entry.when);
    if (key !== openKey) {
      openKey = key;
      parts.push(
        `<div class="groupline" data-day="${key}">${escapeHtml(groupLabel(entry.when, todayKey, tomorrowKey))}</div>`,
      );
    }
    parts.push(rowHtml(entry, now));
  }
  parts.push(
    `<p class="note-line" style="margin-top:16px">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>
      <span>Times follow this device — ${escapeHtml(
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time',
      )}.</span>
    </p>`,
  );

  host.innerHTML = parts.join('');
  bind(host);
}

/** The queued flyer, fetched back from the server that is holding it. */
function flyerUrlFor(entry) {
  if (!entry.filePath) return '';
  const name = String(entry.filePath).split(/[\\/]/).pop();
  return `${getApiBase()}/media/${encodeURIComponent(name)}`;
}

function flyerNameFor(entry) {
  if (!entry.filePath) return '';
  return String(entry.filePath).split(/[\\/]/).pop();
}

/**
 * Posted by hand, so the queued row has to go — otherwise Sandesha sends the
 * same flyer again at the slot time.
 *
 * A Board post fans out to one row per audience list, and posting it by hand
 * covers all of them, so every sibling row goes too. Marking the Board post
 * Sent while a sibling stayed queued would send it a second time.
 */
/** Past its slot, so the scheduler may already be fanning it out. */
function overdue(entry) {
  return entry.when <= new Date();
}

/**
 * Edit a queued message.
 *
 * A row the Board queued belongs to the Board — that editor owns the copy, the
 * flyer and the slot, and already re-queues Sandesha on save. Anything written
 * in Compose is reopened there instead.
 */
function editSchedule(entry) {
  if (entry.sourceId) {
    window.dispatchEvent(new CustomEvent('promo:edit-post', {
      detail: { promoId: entry.sourceId },
    }));
    return;
  }
  loadScheduleIntoCompose(entry, siblingsOf(entry).map((s) => s.id));
  window.dispatchEvent(new CustomEvent('promo:goto', { detail: { mode: 'send' } }));
}

/** Every queued row that this one message produced. */
function siblingsOf(entry) {
  if (!entry.sourceId) return [entry];
  return sortedSchedules().filter((s) => s.sourceId && s.sourceId === entry.sourceId);
}

async function cancelAfterManualSend(entry) {
  const siblings = siblingsOf(entry);

  for (const row of siblings) {
    await api(`/schedules/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
  }

  if (entry.sourceId) {
    const marked = await markBoardPostSent(entry.sourceId);
    if (!marked) await releaseBoardPost(entry.sourceId);
  }
  window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  window.dispatchEvent(new CustomEvent('promo:board-show'));
}

function disarm() {
  clearTimeout(armTimer);
  armTimer = 0;
  armedId = '';
}

function bind(host) {
  host.querySelectorAll('[data-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.jump;
      jumpedKey = jumpedKey === key ? '' : key;
      host.querySelectorAll('[data-jump]').forEach((other) => {
        other.setAttribute('aria-pressed', String(other.dataset.jump === jumpedKey));
      });
      if (!jumpedKey) return;
      const target = host.querySelector(`.groupline[data-day="${key}"]`);
      const scroller = host.closest('.promo-panel') || host;
      if (!target) return;
      // scrollIntoView would also scroll the page behind the phone frame, so
      // move the panel's own scroller and leave room for the sticky day rail.
      const rail = host.querySelector('.week');
      const offset =
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop + offset - (rail?.offsetHeight || 0) - 8),
        behavior: 'smooth'
      });
    });
  });

  host.querySelector('[data-goto-compose]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('promo:compose', { detail: { later: true } }));
  });

  host.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = sortedSchedules().find((s) => String(s.id) === String(btn.dataset.open));
      if (!entry) return;
      disarm();
      openManualSendSheet({
        title: targetLabel(entry),
        when: `${clockOf(entry.when)} · ${countdown(entry.when)}`,
        message: entry.message || '',
        flyerUrl: flyerUrlFor(entry),
        flyerName: flyerNameFor(entry),
        // One Board post can hold a row per list; say so, because tapping
        // "I posted this" cancels every one of them.
        queuedCount: siblingsOf(entry).length,
        onEdit: overdue(entry) ? null : () => editSchedule(entry),
        onPosted: () => cancelAfterManualSend(entry),
      });
    });
  });

  host.querySelectorAll('[data-arm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      armedId = btn.dataset.arm;
      renderPromoSchedule();
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        disarm();
        renderPromoSchedule();
      }, ARM_MS);
    });
  });

  host.querySelectorAll('[data-kill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.kill;
      btn.disabled = true;
      btn.textContent = 'Cancelling…';
      disarm();
      const sourceId = sortedSchedules().find((s) => String(s.id) === String(id))?.sourceId;
      try {
        await api(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
        // A row the Board queued has to be released there too, or the Board
        // reads the missing row as "Sandesha already posted it".
        if (sourceId) await releaseBoardPost(sourceId);
        toast('Schedule cancelled', 'ok');
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      } catch (err) {
        toast(err.message || 'Could not cancel', 'err');
        renderPromoSchedule();
      }
    });
  });
}
