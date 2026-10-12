import { api, escapeHtml } from '../api.js';
import { getState, getTargetOptions } from '../store.js';
import { toast } from '../toast.js';
import { openTargetPicker, formatTargetSummary } from '../target-picker.js';

const container = document.getElementById('page-schedule');
let showForm = false;
let formTargets = [];
let saveInFlight = false;

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
  if (!container) return;
  const { schedules, sets } = getState();
  const sorted = [...(schedules || [])].sort((a, b) => new Date(a.runAt) - new Date(b.runAt));

  if (showForm) {
    const label = formatTargetSummary(formTargets);
    const sub = formTargets.length ? `${formTargets.length} selected` : 'Pick one or more';
    container.innerHTML = `
      <div class="card">
        <h2>New schedule</h2>
        <div class="field">
          <label>Targets</label>
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
          <textarea id="sched-msg" rows="3" placeholder="Message to send"></textarea>
        </div>
        <div class="field">
          <label>When</label>
          <input type="datetime-local" id="sched-when">
        </div>
        <div class="chip-row">
          <button type="button" class="chip" data-chip="9am">9am today</button>
          <button type="button" class="chip" data-chip="Tomorrow 8am">Tomorrow 8am</button>
          <button type="button" class="chip" data-chip="in 1 hour">In 1 hour</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="sched-cancel">Cancel</button>
          <button type="button" class="btn" id="sched-save">Save</button>
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
    <div class="schedule-list">
      ${sorted.length ? sorted.map((s) => {
        const setMembers = s.isSet ? (sets[String(s.target).toLowerCase()] || []) : null;
        const targetLabel = setMembers
          ? `${s.target} · ${setMembers.length} groups`
          : s.target;
        return `
        <div class="schedule-item">
          <div class="row-between">
            <div>
              <div class="sched-time">${escapeHtml(formatCountdown(s.runAt))} · ${escapeHtml(new Date(s.runAt).toLocaleString())}</div>
              <div class="sched-target">→ ${escapeHtml(targetLabel)}</div>
              <div class="sched-body">${escapeHtml((s.message || '').slice(0, 120))}</div>
            </div>
            <button type="button" class="btn btn-sm danger" data-del="${s.id}">Cancel</button>
          </div>
        </div>`;
      }).join('') : '<p class="empty">No scheduled messages. Tap + to create one.</p>'}
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
        toast('Schedule cancelled', 'ok');
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

async function saveSchedule(timeStr, useTimeStr) {
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
    base.runAt = new Date(when).toISOString();
  }

  saveInFlight = true;
  const saveBtn = container.querySelector('#sched-save');
  const chips = [...(container.querySelectorAll('[data-chip]') || [])];
  const cancelBtn = container.querySelector('#sched-cancel');
  const prevLabel = saveBtn?.textContent || 'Save';

  // Immediate feedback
  toast(targets.length === 1 ? 'Saving schedule…' : `Saving ${targets.length} schedules…`, 'ok');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('loading');
    saveBtn.textContent = 'Saving…';
  }
  chips.forEach((c) => {
    c.disabled = true;
    c.classList.add('loading');
  });
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    let ok = 0;
    for (const t of targets) {
      await api('/schedules', {
        method: 'POST',
        body: JSON.stringify({ ...base, target: t.target, isSet: !!t.isSet }),
      });
      ok += 1;
      if (saveBtn && targets.length > 1) {
        saveBtn.textContent = `Saving ${ok}/${targets.length}…`;
      }
    }
    toast(ok === 1 ? 'Schedule saved' : `${ok} schedules saved`, 'ok');
    showForm = false;
    formTargets = [];
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  } catch (err) {
    toast(err.message, 'err');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('loading');
      saveBtn.textContent = prevLabel;
    }
    chips.forEach((c) => {
      c.disabled = false;
      c.classList.remove('loading');
    });
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
