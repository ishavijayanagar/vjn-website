import { api } from '../api.js';
import { getState } from '../store.js';
import { pushSub } from '../router.js';
import { escapeHtml } from '../api.js';
import { openSend } from './send.js';
import { renderSchedule } from './schedule.js';
import { describeWhatsAppStatus } from '../wa-status.js';

const container = document.getElementById('sub-status');

function formatCountdown(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Due soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function renderHome() {
  if (!container) return;
  const { health, schedules, groups } = getState();
  const st = describeWhatsAppStatus(health, { groups: groups.length });
  const recent = sessionStorage.getItem('sandesha_last_send') || '';

  const upcoming = [...(schedules || [])]
    .filter((s) => new Date(s.runAt) > Date.now())
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
    .slice(0, 3);

  container.innerHTML = `
    <div class="card">
      <div class="row-center">
        <span class="status-dot ${st.dot}"></span>
        <div>
          <div class="status-line">${escapeHtml(st.line)}</div>
          <div class="status-sub">${escapeHtml(st.sub)}</div>
        </div>
      </div>
      ${health?.commandsGroupName ? `<div class="hint">Commands: ${escapeHtml(health.commandsGroupName)}</div>` : ''}
      ${st.showPairHelp && health?.whatsapp?.pairingCode ? `<div class="pairing-code mt-sm">${escapeHtml(health.whatsapp.pairingCode)}</div>` : ''}
    </div>

    <h2 class="section-label">Quick actions</h2>
    <div class="quick-actions">
      <button type="button" class="quick-action" data-action="send-set">
        <span class="qa-icon">SEND</span> Send to set
      </button>
      <button type="button" class="quick-action" data-action="schedule">
        <span class="qa-icon">TIME</span> Schedule
      </button>
      <button type="button" class="quick-action" data-action="broadcast">
        <span class="qa-icon">ALL</span> Broadcast
      </button>
      <button type="button" class="quick-action" data-action="refresh">
        <span class="qa-icon">SYNC</span> Refresh
      </button>
    </div>

    <div class="card">
      <h2>Upcoming schedules</h2>
      ${upcoming.length ? upcoming.map((s) => `
        <div class="schedule-item">
          <div class="sched-time">${escapeHtml(formatCountdown(s.runAt))} · ${escapeHtml(new Date(s.runAt).toLocaleString())}</div>
          <div class="sched-target">→ ${escapeHtml(s.target)}</div>
          <div class="sched-body">${escapeHtml((s.message || '').slice(0, 80))}${(s.message || '').length > 80 ? '…' : ''}</div>
        </div>`).join('') : '<p class="empty">No upcoming schedules</p>'}
    </div>

    ${recent ? `<div class="card"><h2>Recent activity</h2><p class="hint mb-0">${escapeHtml(recent)}</p></div>` : ''}`;

  container.querySelector('[data-action="send-set"]')?.addEventListener('click', () => openSend());
  container.querySelector('[data-action="schedule"]')?.addEventListener('click', () => {
    pushSub('schedule', 'Schedule');
    renderSchedule();
  });
  container.querySelector('[data-action="broadcast"]')?.addEventListener('click', async () => {
    const msg = prompt('Broadcast message to all groups:');
    if (!msg?.trim()) return;
    try {
      const r = await api('/send/broadcast', { method: 'POST', body: JSON.stringify({ message: msg.trim() }) });
      sessionStorage.setItem('sandesha_last_send', `Broadcast sent to ${r.sent}/${r.total} groups`);
      renderHome();
    } catch (err) {
      alert(err.message);
    }
  });
  container.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  });
}

export function openStatus() {
  pushSub('status', 'Status');
  renderHome();
}
