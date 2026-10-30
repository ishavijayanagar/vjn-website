import { api, escapeHtml } from '../api.js';
import { getState, getTargetOptions, jidToName, loadChats } from '../store.js';
import { toast } from '../toast.js';
import { openTargetPicker, formatTargetSummary } from '../target-picker.js';
import { logActivity } from '../activity-log.js';
import { startProgress, updateProgress as busUpdate, endProgress } from '../progress-bus.js';

function getScheduleContainer() {
  return document.getElementById('sandeshaSchedule') || document.getElementById('page-schedule');
}

let showForm = false;
let formTargets = [];
let saveInFlight = false;

function localMinuteValue() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatCountdown(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Due soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `in ${Math.floor(h / 24)}d`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

/**
 * Build unique schedule targets.
 * Sets are kept as a single target (scheduler expands them) so one save
 * does not create one row per group in the set.
 */
function buildScheduleTargets(selections) {
  const { sets, groups } = getState();
  const targets = [];
  const seen = new Set();

  const remember = (key, entry) => {
    const k = String(key).toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    targets.push(entry);
  };

  for (const t of selections) {
    if (!t?.value) continue;

    if (t.type === 'set') {
      const setName = String(t.value);
      const members = sets[setName.toLowerCase()] || sets[setName] || [];
      if (!members.length) {
        toast(`Set "${setName}" has no groups`, 'err');
        continue;
      }
      // One schedule for the whole set — not one per member
      remember(`set:${setName}`, { target: setName, isSet: true });
      continue;
    }

    const value = String(t.value);
    remember(value, { target: value, isSet: false });

    // Also block the matching group name/jid so set+group mixes don't double up later
    const g = (groups || []).find(
      (x) => x.jid === value || (x.name && x.name.toLowerCase() === value.toLowerCase()),
    );
    if (g?.name) seen.add(String(g.name).toLowerCase());
    if (g?.jid) seen.add(String(g.jid).toLowerCase());
  }

  return targets;
}

export function renderSchedule() {
  loadChats(); // the people in the audience picker; not awaited
  const container = getScheduleContainer();
  if (!container) return;
  const { schedules, sets } = getState();
  const sorted = [...(schedules || [])].sort((a, b) => new Date(a.runAt) - new Date(b.runAt));

  if (showForm) {
    const label = formatTargetSummary(formTargets);
    const sub = formTargets.length ? `${formTargets.length} selected` : 'Pick one or more';
    container.innerHTML = `
      <div class="sched-form-card">
        <div class="sched-form-title">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          New schedule
        </div>
        <div class="field">
          <label>To</label>
          <button type="button" class="picker-trigger" id="sched-target-btn">
            <div class="row-main">
              <div class="row-title">${escapeHtml(label)}</div>
              <div class="row-sub">${escapeHtml(sub)}</div>
            </div>
            <span class="chevron">›</span>
          </button>
        </div>
        <div class="field">
          <label>Message</label>
          <textarea id="sched-msg" rows="4" placeholder="Type your message…"></textarea>
        </div>
        <div class="field">
          <label>Date &amp; time</label>
          <input type="datetime-local" id="sched-when" min="${localMinuteValue()}" step="60">
        </div>
        <div class="quick-time-row">
          <button type="button" class="quick-time-chip" data-chip="9am">9 am today</button>
          <button type="button" class="quick-time-chip" data-chip="Tomorrow 8am">Tomorrow 8 am</button>
          <button type="button" class="quick-time-chip" data-chip="in 1 hour">In 1 hour</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn secondary btn-sm" id="sched-cancel">Cancel</button>
          <button type="button" class="btn btn-sm" id="sched-save">Save schedule</button>
        </div>
      </div>`;

    container.querySelector('#sched-target-btn')?.addEventListener('click', () => {
      openTargetPicker(
        getTargetOptions().filter((o) => o.type !== 'broadcast'),
        (picked) => {
          formTargets = Array.isArray(picked) ? picked : [picked];
          renderSchedule();
        },
        { multi: true, selected: formTargets },
      );
    });
    container.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.addEventListener('click', () => saveSchedule(chip.dataset.chip, true));
    });
    container.querySelector('#sched-cancel')?.addEventListener('click', () => {
      showForm = false;
      formTargets = [];
      renderSchedule();
    });
    container.querySelector('#sched-save')?.addEventListener('click', () => saveSchedule(null, false));
    return;
  }

  container.innerHTML = `
    <div class="sched-list">
      ${sorted.length ? sorted.map((s) => {
        const diff = new Date(s.runAt) - Date.now();
        const isOverdue = diff <= 0;
        const isSoon = !isOverdue && diff < 3600000;
        const urgencyClass = isOverdue ? 'overdue' : isSoon ? 'soon' : '';
        const countdownClass = isOverdue ? 'overdue' : isSoon ? 'soon' : '';
        const setMembers = s.isSet ? (sets[String(s.target).toLowerCase()] || []) : null;
        const resolvedName = s.isSet ? s.target : jidToName(s.target);
        const targetLabel = setMembers ? `${resolvedName} · ${setMembers.length} groups` : resolvedName;
        const msgPreview = (s.message || '').slice(0, 100);
        const dateStr = new Date(s.runAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        return `
        <div class="sched-card ${urgencyClass}">
          <div class="sched-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <div class="sched-body">
            <span class="sched-countdown ${countdownClass}">${escapeHtml(formatCountdown(s.runAt))}</span>
            <div class="sched-datetime">${escapeHtml(dateStr)}</div>
            <div class="sched-target-row">
              <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z"/></svg>
              ${escapeHtml(targetLabel)}
            </div>
            ${msgPreview ? `<div class="sched-msg-preview">${escapeHtml(msgPreview)}${(s.message || '').length > 100 ? '…' : ''}</div>` : ''}
          </div>
          <button type="button" class="sched-cancel-btn" data-del="${s.id}" aria-label="Cancel schedule">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
      }).join('') : `
        <div class="sched-empty">
          <div class="sched-empty-icon">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <h3>No scheduled messages</h3>
          <p>Tap + to schedule a message to any group, set, or contact.</p>
        </div>`}
    </div>
    <button type="button" class="fab" id="sched-fab" aria-label="New schedule">+</button>`;

  container.querySelector('#sched-fab')?.addEventListener('click', () => {
    showForm = true;
    formTargets = [];
    renderSchedule();
  });
  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this schedule?')) return;
      try {
        await api(`/schedules/${btn.dataset.del}`, { method: 'DELETE' });
        logActivity({ type: 'ok', category: 'schedule', title: 'Schedule cancelled' });
        toast('Schedule cancelled', 'ok');
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

async function saveSchedule(timeStr, useTimeStr) {
  const container = getScheduleContainer();
  if (!container) return;
  if (saveInFlight) return;

  const msg = container.querySelector('#sched-msg')?.value?.trim();
  if (!formTargets.length) { toast('Choose at least one target', 'err'); return; }
  if (!msg) { toast('Enter a message', 'err'); return; }

  const targets = buildScheduleTargets(formTargets);
  if (!targets.length) { toast('No valid targets', 'err'); return; }

  const base = { message: msg };
  if (useTimeStr && timeStr) base.timeStr = timeStr;
  else {
    const when = container.querySelector('#sched-when')?.value;
    if (!when) { toast('Pick a date and time', 'err'); return; }
    if (new Date(when).getTime() < Math.floor(Date.now() / 60000) * 60000) {
      toast('Pick a time that has not already passed', 'err');
      return;
    }
    base.runAt = new Date(when).toISOString();
  }

  saveInFlight = true;
  const saveBtn = container.querySelector('#sched-save');
  const chips = [...(container.querySelectorAll('[data-chip]') || [])];
  const cancelBtn = container.querySelector('#sched-cancel');
  const prevLabel = saveBtn?.textContent || 'Save schedule';

  if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('loading'); saveBtn.textContent = 'Saving…'; }
  chips.forEach((c) => { c.disabled = true; c.classList.add('loading'); });
  if (cancelBtn) cancelBtn.disabled = true;

  const opId = startProgress({ label: `Scheduling ${targets.length} message${targets.length > 1 ? 's' : ''}…`, total: targets.length });

  try {
    let ok = 0;
    for (const t of targets) {
      await api('/schedules', {
        method: 'POST',
        body: JSON.stringify({ ...base, target: t.target, isSet: !!t.isSet }),
      });
      ok += 1;
      busUpdate({ id: opId, done: ok, total: targets.length });
      if (saveBtn && targets.length > 1) saveBtn.textContent = `Saving ${ok}/${targets.length}…`;
    }
    const summary = ok === 1 ? 'Schedule saved' : `${ok} schedules saved`;
    endProgress({ id: opId, status: 'done', result: summary });
    logActivity({
      type: 'ok',
      category: 'schedule',
      title: summary,
      detail: base.message ? base.message.slice(0, 120) : '',
      target: targets.length === 1 ? targets[0].target : '',
      count: ok,
    });
    toast(summary, 'ok');
    showForm = false;
    formTargets = [];
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  } catch (err) {
    endProgress({ id: opId, status: 'error', result: err.message });
    logActivity({ type: 'err', category: 'schedule', title: 'Schedule failed', detail: err.message });
    toast(err.message, 'err');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('loading'); saveBtn.textContent = prevLabel; }
    chips.forEach((c) => { c.disabled = false; c.classList.remove('loading'); });
    if (cancelBtn) cancelBtn.disabled = false;
  } finally {
    saveInFlight = false;
  }
}

export function openNewSchedule() {
  showForm = true;
  formTargets = [];
  renderSchedule();
}
